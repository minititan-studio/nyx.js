<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * TileEditor.svelte
     * Migrated from: room-editor/room-tile-editor.tag
     *
     * Left-panel tile subsystem: tileset picker, tile selection canvas,
     * and tile layer management list.  Tile painting onto the PixiJS canvas
     * is Phase 7C — this component only manages selection state and layer data.
     */
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { currentProject, projectFilePath, updateAsset, pushAssetUndoSnapshot } from '../../stores/projectStore.js';
    import type { NyxRoom, NyxTexture, NyxTileLayer } from '@nyx/shared';

    interface TileSelection {
        textureUid: string;
        startX: number;
        startY: number;
        spanX: number;
        spanY: number;
    }

    type TileToolMode = 'paint' | 'erase' | 'select';

    interface Props {
        room: NyxRoom;
        activeTileLayerIdx: number;
        tileToolMode?: TileToolMode;
        ontileselection?: (sel: TileSelection) => void;
        onlayerchange?: (idx: number) => void;
    }

    let {
        room,
        activeTileLayerIdx = $bindable(0),
        tileToolMode       = $bindable<TileToolMode>('paint'),
        ontileselection,
        onlayerchange,
    }: Props = $props();

    // ── Tileset state ─────────────────────────────────────────────────────────
    let pickingTileset    = $state(false);
    let currentTexture    = $state<NyxTexture | null>(null);
    let currentImg        = $state<HTMLImageElement | null>(null);
    let canvasEl          = $state<HTMLCanvasElement | undefined>(undefined);

    // ── Tile selection state ──────────────────────────────────────────────────
    let tileX             = $state(0);
    let tileY             = $state(0);
    let tileSpanX         = $state(1);
    let tileSpanY         = $state(1);
    let tileStartX        = 0;
    let tileStartY        = 0;
    let selectingTile     = false;

    const textures   = $derived($currentProject?.textures ?? []);
    const layers     = $derived(room.tiles ?? []);

    // ── Restore last used tileset on mount ────────────────────────────────────
    onMount(() => {
        const lastUid = room.lastPickedTileset;
        if (lastUid) {
            const tex = ($currentProject?.textures ?? []).find(t => t.uid === lastUid);
            if (tex) loadTexture(tex);
        }
    });

    function getTexUrl(origname: string): string | null {
        const fp = get(projectFilePath);
        if (!fp || !origname) return null;
        const dir = fp.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        return `nyx-asset://localhost/${dir}/img/${encodeURIComponent(origname)}`;
    }

    async function loadTexture(tex: NyxTexture): Promise<void> {
        currentTexture = tex;
        currentImg     = null;
        const url = getTexUrl(tex.origname);
        if (!url) return;
        const img = new Image();
        img.src   = url;
        await new Promise<void>((res) => {
            img.onload  = () => res();
            img.onerror = () => res();
        });
        currentImg = img;
        tileX = tileY = 0;
        tileSpanX = tileSpanY = 1;
        redrawCanvas();
        emitSelection();
    }

    // ── Canvas drawing ────────────────────────────────────────────────────────

    function redrawCanvas(): void {
        if (!canvasEl || !currentTexture || !currentImg) return;
        const tex = currentTexture;
        const img = currentImg;
        const ctx = canvasEl.getContext('2d');
        if (!ctx) return;

        canvasEl.width  = img.naturalWidth;
        canvasEl.height = img.naturalHeight;

        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.drawImage(img, 0, 0);

        // Draw tile grid
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth   = 1;
        const cols = tex.grid[0] || 1;
        const rows = tex.grid[1] || 1;
        for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
                const x = tex.offx + col * (tex.width + tex.marginx);
                const y = tex.offy + row * (tex.height + tex.marginy);
                ctx.strokeRect(x + 0.5, y + 0.5, tex.width, tex.height);
            }
        }

        // Draw selection highlight
        const selX = tex.offx + tileX * (tex.width + tex.marginx);
        const selY = tex.offy + tileY * (tex.height + tex.marginy);
        const selW = tex.width  * tileSpanX + tex.marginx * (tileSpanX - 1);
        const selH = tex.height * tileSpanY + tex.marginy * (tileSpanY - 1);

        ctx.strokeStyle = '#00d4ff';
        ctx.lineWidth   = 2;
        ctx.strokeRect(selX - 0.5, selY - 0.5, selW + 1, selH + 1);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth   = 1;
        ctx.strokeRect(selX - 1.5, selY - 1.5, selW + 3, selH + 3);
    }

    $effect(() => {
        // Re-draw whenever selection state changes
        tileX; tileY; tileSpanX; tileSpanY;
        redrawCanvas();
    });

    // ── Pointer interaction for tile selection ────────────────────────────────

    function canvasTileCoords(e: PointerEvent): { col: number; row: number } | null {
        if (!canvasEl || !currentTexture) return null;
        const bbox  = canvasEl.getBoundingClientRect();
        const scaleX = canvasEl.width  / bbox.width;
        const scaleY = canvasEl.height / bbox.height;
        const px = (e.clientX - bbox.left) * scaleX;
        const py = (e.clientY - bbox.top)  * scaleY;
        const tex = currentTexture;
        let col = Math.floor((px - tex.offx) / (tex.width  + tex.marginx));
        let row = Math.floor((py - tex.offy) / (tex.height + tex.marginy));
        col = Math.max(0, Math.min(tex.grid[0] - 1, col));
        row = Math.max(0, Math.min(tex.grid[1] - 1, row));
        return { col, row };
    }

    function onPointerDown(e: PointerEvent): void {
        if (!currentTexture) return;
        const coords = canvasTileCoords(e);
        if (!coords) return;
        selectingTile = true;
        tileStartX = coords.col;
        tileStartY = coords.row;
        tileX = coords.col;
        tileY = coords.row;
        tileSpanX = 1;
        tileSpanY = 1;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent): void {
        if (!selectingTile) return;
        const coords = canvasTileCoords(e);
        if (!coords) return;
        tileX     = Math.min(tileStartX, coords.col);
        tileY     = Math.min(tileStartY, coords.row);
        tileSpanX = Math.abs(tileStartX - coords.col) + 1;
        tileSpanY = Math.abs(tileStartY - coords.row) + 1;
    }

    function onPointerUp(e: PointerEvent): void {
        if (!selectingTile) return;
        onPointerMove(e);
        selectingTile = false;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        emitSelection();
    }

    function emitSelection(): void {
        if (!currentTexture || !ontileselection) return;
        ontileselection({
            textureUid: currentTexture.uid,
            startX: tileX,
            startY: tileY,
            spanX: tileSpanX,
            spanY: tileSpanY,
        });
    }

    // ── Tileset picker ────────────────────────────────────────────────────────

    function openPicker(): void {
        pickingTileset = true;
    }

    async function selectTileset(uid: string): Promise<void> {
        pickingTileset = false;
        const tex = textures.find(t => t.uid === uid);
        if (!tex) return;
        updateAsset<NyxRoom>(room.uid, 'room', { lastPickedTileset: uid });
        await loadTexture(tex);
    }

    // ── Tile layer management ─────────────────────────────────────────────────

    function mutateLayers(fn: (layers: NyxTileLayer[]) => void): void {
        const next: NyxTileLayer[] = JSON.parse(JSON.stringify(room.tiles ?? []));
        fn(next);
        updateAsset<NyxRoom>(room.uid, 'room', { tiles: next });
    }

    function addLayer(): void {
        pushAssetUndoSnapshot(room.uid);
        const depth = layers.length > 0 ? (layers[layers.length - 1].depth - 10) : -10;
        mutateLayers(ls => ls.push({ depth, tiles: [], extends: {}, cache: true }));
        activeTileLayerIdx = layers.length; // will point to newly pushed item after reactivity
        onlayerchange?.(activeTileLayerIdx);
    }

    function deleteLayer(idx: number): void {
        if (!confirm(`Delete tile layer at depth ${layers[idx]?.depth}?`)) return;
        pushAssetUndoSnapshot(room.uid);
        mutateLayers(ls => ls.splice(idx, 1));
        activeTileLayerIdx = Math.max(0, Math.min(activeTileLayerIdx, layers.length - 2));
        onlayerchange?.(activeTileLayerIdx);
    }

    function toggleLayerVisible(idx: number): void {
        pushAssetUndoSnapshot(room.uid);
        mutateLayers(ls => { ls[idx].hidden = !ls[idx].hidden; });
    }

    function setLayerDepth(idx: number, rawValue: string): void {
        const depth = parseInt(rawValue, 10);
        if (!isFinite(depth)) return;
        pushAssetUndoSnapshot(room.uid);
        mutateLayers(ls => {
            ls[idx].depth = depth;
            ls.sort((a, b) => b.depth - a.depth);
        });
    }

    function setLayerCache(idx: number, val: boolean): void {
        pushAssetUndoSnapshot(room.uid);
        mutateLayers(ls => { ls[idx].cache = val; });
    }

    function selectLayer(idx: number): void {
        activeTileLayerIdx = idx;
        onlayerchange?.(idx);
    }
</script>

<div class="tile-editor">
    <!-- ── Tileset picker button ── -->
    <div class="tileset-header">
        <button class="wide-btn" onclick={openPicker}>
            <Icon icon="feather:search" class="feather"/>
            {currentTexture ? currentTexture.name : 'Find tileset…'}
        </button>
    </div>

    <!-- ── Tool mode toolbar ── -->
    <div class="tile-toolbar">
        <button class="tool-btn" class:active={tileToolMode === 'paint'}  onclick={() => { tileToolMode = 'paint';  }} title="Paint tiles (LMB)">
            <Icon icon="feather:edit-2" class="feather"/>
            Paint
        </button>
        <button class="tool-btn" class:active={tileToolMode === 'erase'}  onclick={() => { tileToolMode = 'erase';  }} title="Erase tiles (RMB)">
            <Icon icon="feather:x-square" class="feather"/>
            Erase
        </button>
        <button class="tool-btn" class:active={tileToolMode === 'select'} onclick={() => { tileToolMode = 'select'; }} title="Select tiles">
            <Icon icon="feather:mouse-pointer" class="feather"/>
            Select
        </button>
    </div>

    <!-- ── Tileset canvas ── -->
    <div class="tileset-canvas-wrap">
        {#if currentImg && currentTexture}
            <canvas
                bind:this={canvasEl}
                class="tileset-canvas"
                onpointerdown={onPointerDown}
                onpointermove={onPointerMove}
                onpointerup={onPointerUp}
            ></canvas>
        {:else}
            <div class="no-tileset">
                {currentTexture ? 'Loading…' : 'No tileset selected'}
            </div>
        {/if}
    </div>

    <!-- ── Layer list ── -->
    <div class="layer-list">
        {#each layers as layer, i}
            <div class="layer-row" class:active={activeTileLayerIdx === i}>
                <label class="layer-vis" title="Toggle visibility">
                    <input type="checkbox"
                           checked={!layer.hidden}
                           onchange={() => toggleLayerVisible(i)} />
                </label>

                <button class="layer-name" onclick={() => selectLayer(i)}>
                    Layer {layer.depth}
                </button>

                <input class="depth-input"
                       type="number"
                       step="1"
                       value={layer.depth}
                       aria-label="Depth"
                       onchange={(e) => setLayerDepth(i, (e.target as HTMLInputElement).value)} />

                <button class="icon-sm danger" title="Delete layer" onclick={() => deleteLayer(i)}>
                    <Icon icon="feather:trash-2" class="feather"/>
                </button>
            </div>
        {/each}

        {#if layers.length === 0}
            <p class="dim-note">No tile layers. Add one below.</p>
        {/if}

        <button class="add-layer-btn" onclick={addLayer}>
            <Icon icon="feather:plus" class="feather"/>
            Add tile layer
        </button>
    </div>

    {#if layers[activeTileLayerIdx]}
        <div class="layer-options">
            <label class="check-row">
                <input type="checkbox"
                       checked={layers[activeTileLayerIdx].cache}
                       onchange={(e) => setLayerCache(activeTileLayerIdx, (e.target as HTMLInputElement).checked)} />
                <span>Cache layer</span>
            </label>
            <p class="dim-note small">Caching improves performance but may cause visual glitches with animated tiles.</p>
        </div>
    {/if}
</div>

<!-- ── Tileset picker overlay ── -->
{#if pickingTileset}
    <div class="picker-overlay" role="dialog" aria-modal="true" aria-label="Pick tileset">
        <div class="picker-panel">
            <div class="picker-header">
                <span>Select tileset</span>
                <button class="icon-sm" onclick={() => { pickingTileset = false; }}>
                    <Icon icon="feather:x" class="feather"/>
                </button>
            </div>
            <div class="picker-list">
                {#each textures as tex}
                    <button class="picker-item" onclick={() => selectTileset(tex.uid)}>
                        {tex.name}
                    </button>
                {:else}
                    <p class="dim-note">No textures in this project.</p>
                {/each}
            </div>
        </div>
    </div>
{/if}

<style>
.tile-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
}

.tileset-header {
    padding: 0.3rem;
    border-bottom: 1px solid var(--clr-border, #3a3a3a);
    flex-shrink: 0;
}

.wide-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.3rem 0.5rem;
    background: var(--clr-bg2, #2a2a2a);
    border: 1px solid var(--clr-border, #3a3a3a);
    border-radius: 3px;
    color: inherit;
    cursor: pointer;
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.wide-btn:hover { background: var(--clr-bg3, #333); }
.wide-btn :global(.feather) { width: 14px; height: 14px; flex-shrink: 0; }

.tileset-canvas-wrap {
    flex: 1 1 0;
    overflow: auto;
    background: #111;
    min-height: 80px;
}

.tileset-canvas {
    display: block;
    width: 100%;
    height: auto;
    image-rendering: pixelated;
    cursor: crosshair;
    user-select: none;
}

.no-tileset {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 80px;
    color: var(--clr-text-dim, #666);
    font-size: 0.8rem;
}

.layer-list {
    flex-shrink: 0;
    border-top: 1px solid var(--clr-border, #3a3a3a);
    max-height: 160px;
    overflow-y: auto;
    padding: 0.2rem;
}

.layer-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.25rem;
    border-radius: 3px;
}
.layer-row.active { background: rgba(0,180,255,0.1); }
.layer-vis { flex-shrink: 0; }

.layer-name {
    flex: 1;
    text-align: left;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 0.82rem;
    padding: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.layer-name:hover { color: var(--clr-accent, #00d4ff); }

.depth-input {
    width: 52px;
    font-size: 0.78rem;
    padding: 1px 3px;
    background: var(--clr-bg2, #2a2a2a);
    border: 1px solid var(--clr-border, #3a3a3a);
    border-radius: 2px;
    color: inherit;
}

.icon-sm {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: inherit;
    opacity: 0.5;
}
.icon-sm:hover { opacity: 1; color: #f55; }
.icon-sm :global(.feather) { width: 12px; height: 12px; }

.add-layer-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    width: 100%;
    padding: 0.25rem 0.4rem;
    background: transparent;
    border: 1px dashed var(--clr-border, #3a3a3a);
    border-radius: 3px;
    color: var(--clr-text-dim, #888);
    cursor: pointer;
    font-size: 0.8rem;
    margin-top: 0.2rem;
}
.add-layer-btn:hover { border-color: var(--clr-accent, #00d4ff); color: var(--clr-accent, #00d4ff); }
.add-layer-btn :global(.feather) { width: 12px; height: 12px; }

.layer-options {
    flex-shrink: 0;
    padding: 0.3rem 0.4rem;
    border-top: 1px solid var(--clr-border, #3a3a3a);
    font-size: 0.8rem;
}

.check-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
}

.dim-note {
    color: var(--clr-text-dim, #777);
    font-size: 0.78rem;
    margin: 0.2rem 0;
    padding: 0 0.2rem;
}
.dim-note.small { font-size: 0.72rem; }

.picker-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
}

.picker-panel {
    background: var(--clr-bg, #1e1e1e);
    border: 1px solid var(--clr-border, #3a3a3a);
    border-radius: 5px;
    width: 320px;
    max-height: 480px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--clr-border, #3a3a3a);
    font-weight: 600;
    font-size: 0.9rem;
}
.picker-header .icon-sm { opacity: 0.6; }
.picker-header .icon-sm:hover { opacity: 1; }
.picker-header .icon-sm :global(.feather) { width: 16px; height: 16px; }

.picker-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.picker-item {
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 0.35rem 0.5rem;
    color: inherit;
    cursor: pointer;
    font-size: 0.85rem;
}
.picker-item:hover {
    background: var(--clr-bg2, #2a2a2a);
    border-color: var(--clr-border, #3a3a3a);
}

.tile-toolbar {
    display: flex;
    flex-shrink: 0;
    gap: 0.2rem;
    padding: 0.25rem 0.3rem;
    border-bottom: 1px solid var(--clr-border, #3a3a3a);
}

.tool-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    justify-content: center;
    padding: 0.2rem 0.4rem;
    background: var(--clr-bg2, #2a2a2a);
    border: 1px solid var(--clr-border, #3a3a3a);
    border-radius: 3px;
    color: inherit;
    cursor: pointer;
    font-size: 0.78rem;
    opacity: 0.65;
    white-space: nowrap;
}
.tool-btn:hover { opacity: 0.9; background: var(--clr-bg3, #333); }
.tool-btn.active {
    opacity: 1;
    border-color: var(--clr-accent, #00d4ff);
    color: var(--clr-accent, #00d4ff);
    background: rgba(0, 212, 255, 0.08);
}
.tool-btn :global(.feather) { width: 12px; height: 12px; flex-shrink: 0; }
</style>
