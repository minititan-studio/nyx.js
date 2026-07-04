<script lang="ts">
    /**
     * RoomInspector.svelte
     *
     * Floating inspector panel that shows editable properties for whatever is
     * currently selected in the room canvas: a copy, a tile layer, or a tile.
     *
     * Layout: position:absolute top-right of the canvas column.
     * All mutations go through `onpatch` with a full structuredClone of the room.
     */
    import Icon from "@iconify/svelte";
    import { ColorPicker } from '@nyx/ui-kit';
    import type { NyxRoom, NyxCopy, NyxTemplate, NyxTileLayer, NyxTile, LightShape } from '@nyx/shared';
    import { currentProject } from '../../../stores/projectStore';

    // ── Selection discriminants ───────────────────────────────────────────────

    type CopySelection      = { type: 'copy';       copyUid: string };
    type TileLayerSelection = { type: 'tile-layer'; layerIdx: number };
    type TileSelection      = { type: 'tile';       layerIdx: number; tileIdx: number };
    export type RoomSelection = CopySelection | TileLayerSelection | TileSelection | null;

    // ── Props ─────────────────────────────────────────────────────────────────

    interface Props {
        selection: RoomSelection;
        room: NyxRoom;
        templates: NyxTemplate[];
        onpatch: (updatedRoom: NyxRoom) => void;
    }
    let { selection, room, templates, onpatch }: Props = $props();

    // ── Derived helpers ───────────────────────────────────────────────────────

    const hasMatter = $derived('matter' in ($currentProject?.modules ?? {}));
    const hasLight  = $derived('light'  in ($currentProject?.modules ?? {}));

    /** The selected copy object, or null. */
    const selectedCopy = $derived((): NyxCopy | null => {
        if (selection?.type !== 'copy') return null;
        return room.copies.find(c => c.uid === selection.copyUid) ?? null;
    });

    /** Template for the selected copy. */
    const selectedTemplate = $derived((): NyxTemplate | null => {
        const copy = selectedCopy();
        if (!copy) return null;
        return templates.find(t => t.uid === copy.templateUid) ?? null;
    });

    /** The selected tile layer, or null. */
    const selectedLayer = $derived((): NyxTileLayer | null => {
        if (selection?.type !== 'tile-layer' && selection?.type !== 'tile') return null;
        return room.tiles[selection.layerIdx] ?? null;
    });

    /** The selected tile, or null. */
    const selectedTile = $derived((): NyxTile | null => {
        if (selection?.type !== 'tile') return null;
        return room.tiles[selection.layerIdx]?.tiles[selection.tileIdx] ?? null;
    });

    // ── Header label ──────────────────────────────────────────────────────────

    const headerLabel = $derived((): string => {
        if (!selection) return '';
        if (selection.type === 'copy') {
            const copy = selectedCopy();
            if (!copy) return 'Copy';
            const tmpl = templates.find(t => t.uid === copy.templateUid);
            return `Copy: ${tmpl?.name ?? '(unknown)'}`;
        }
        if (selection.type === 'tile-layer') {
            return `Tile Layer ${selection.layerIdx + 1}`;
        }
        if (selection.type === 'tile') {
            const tile = selectedTile();
            if (!tile) return 'Tile';
            return `Tile [${tile.x}, ${tile.y}]`;
        }
        return '';
    });

    // ── RESERVED props for copy extends ──────────────────────────────────────

    const RESERVED_PROPS = new Set([
        'alpha','anchor','angle','animationSpeed','autoUpdate','blendMode',
        'buttonMode','cacheAsBitmap','children','currentFrame','cursor',
        'filterArea','filters','height','hitArea','interactive',
        'interactiveChildren','isMask','isSprite','localTransform','loop',
        'mask','onComplete','onFrameChange','onLoop','parent','pivot',
        'playing','pluginName','position','renderable','rotation',
        'roundPixels','scale','skew','sortableChildren','sortDirty',
        'texture','textures','tint','totalFrames','transform','updateAnchor',
        'visible','width','worldAlpha','worldTransform','worldVisible',
        'x','y','zIndex',
    ]);

    // ── Utility ───────────────────────────────────────────────────────────────

    function num(e: Event): number {
        return parseFloat((e.target as HTMLInputElement).value) || 0;
    }

    /**
     * Convert a numeric tint (0xRRGGBB) to a CSS hex string (#rrggbb).
     * NyxTile.tint is stored as a number; ColorPicker expects a CSS string.
     */
    function numTintToHex(n: number): string {
        return `#${(n >>> 0).toString(16).padStart(6, '0')}`;
    }

    function hexTintToNum(hex: string): number {
        return parseInt(hex.replace('#', ''), 16) || 0xffffff;
    }

    // ── Copy mutation helpers ─────────────────────────────────────────────────

    function patchCopy(patch: Partial<NyxCopy>): void {
        const copy = selectedCopy();
        if (!copy) return;
        const r = structuredClone(room);
        const idx = r.copies.findIndex(c => c.uid === copy.uid);
        if (idx === -1) return;
        Object.assign(r.copies[idx], patch);
        onpatch(r);
    }

    function addExtendProp(): void {
        const copy = selectedCopy();
        if (!copy) return;
        const exts = { ...(copy.extends ?? {}) };
        let key = 'prop';
        let n = 1;
        while (key in exts) key = `prop${n++}`;
        patchCopy({ extends: { ...exts, [key]: '' } });
    }

    function updateExtendVal(key: string, raw: string): void {
        const copy = selectedCopy();
        if (!copy) return;
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        patchCopy({ extends: { ...(copy.extends ?? {}), [key]: parsed } });
    }

    function renameExtendKey(oldKey: string, newKey: string): void {
        const copy = selectedCopy();
        if (!copy) return;
        const exts = { ...(copy.extends ?? {}) };
        exts[newKey.trim()] = exts[oldKey];
        delete exts[oldKey];
        patchCopy({ extends: exts });
    }

    function deleteExtendProp(key: string): void {
        const copy = selectedCopy();
        if (!copy) return;
        const exts = { ...(copy.extends ?? {}) };
        delete exts[key];
        patchCopy({ extends: exts });
    }

    function patchCopyExtends(key: string, val: unknown | undefined): void {
        const copy = selectedCopy();
        if (!copy) return;
        if (val === undefined) {
            patchCopy({
                extends: Object.fromEntries(
                    Object.entries(copy.extends ?? {}).filter(([k]) => k !== key)
                )
            });
        } else {
            patchCopy({ extends: { ...(copy.extends ?? {}), [key]: val } });
        }
    }

    // ── Tile Layer mutation helpers ───────────────────────────────────────────

    function patchLayer(patch: Partial<NyxTileLayer>): void {
        if (selection?.type !== 'tile-layer' && selection?.type !== 'tile') return;
        const layerIdx = selection.layerIdx;
        const r = structuredClone(room);
        if (!r.tiles[layerIdx]) return;
        Object.assign(r.tiles[layerIdx], patch);
        onpatch(r);
    }

    // ── Tile mutation helpers ─────────────────────────────────────────────────

    function patchTile(patch: Partial<NyxTile>): void {
        if (selection?.type !== 'tile') return;
        const { layerIdx, tileIdx } = selection;
        const r = structuredClone(room);
        if (!r.tiles[layerIdx]?.tiles[tileIdx]) return;
        Object.assign(r.tiles[layerIdx].tiles[tileIdx], patch);
        onpatch(r);
    }

    function patchTilePhysicsOverride(patch: Partial<NonNullable<NyxTile['physicsOverride']>>): void {
        const tile = selectedTile();
        if (!tile || selection?.type !== 'tile') return;
        const existing = tile.physicsOverride ?? {};
        patchTile({ physicsOverride: { ...existing, ...patch } });
    }

    function setTilePhysicsOverrideEnabled(checked: boolean): void {
        const tile = selectedTile();
        if (!tile || selection?.type !== 'tile') return;
        if (checked) {
            patchTile({ physicsOverride: { ...(tile.physicsOverride ?? {}), enabled: true } });
        } else {
            // Remove the enabled key to revert to "inherit"
            const existing = { ...(tile.physicsOverride ?? {}) };
            delete existing.enabled;
            patchTile({ physicsOverride: existing });
        }
    }
</script>

{#if selection}
<div class="room-inspector" onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()}>

    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div class="insp-header">
        {#if selection.type === 'copy'}
            <Icon icon="feather:box" class="feather insp-icon"/>
        {:else if selection.type === 'tile-layer'}
            <Icon icon="feather:layers" class="feather insp-icon"/>
        {:else if selection.type === 'tile'}
            <Icon icon="feather:grid" class="feather insp-icon"/>
        {/if}
        <span class="insp-title">{headerLabel()}</span>
    </div>

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- COPY SECTION                                                        -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    {#if selection.type === 'copy'}
        {#if selectedCopy()}
            {@const copy = selectedCopy()!}

            <div class="insp-grid">
                <span>X</span>
                <input type="number" step="1" value={copy.x}
                       aria-label="X"
                       onchange={(e) => patchCopy({ x: num(e) })} />
                <span>Y</span>
                <input type="number" step="1" value={copy.y}
                       aria-label="Y"
                       onchange={(e) => patchCopy({ y: num(e) })} />
                <span>Scale X</span>
                <input type="number" step="0.1" value={copy.scaleX ?? 1}
                       aria-label="Scale X"
                       onchange={(e) => patchCopy({ scaleX: num(e) || 1 })} />
                <span>Scale Y</span>
                <input type="number" step="0.1" value={copy.scaleY ?? 1}
                       aria-label="Scale Y"
                       onchange={(e) => patchCopy({ scaleY: num(e) || 1 })} />
                <span>Angle</span>
                <div class="slider-row">
                    <input type="range" min="-180" max="180" step="1"
                           value={copy.angle ?? 0}
                           aria-label="Angle slider"
                           oninput={(e) => patchCopy({ angle: num(e) })} />
                    <input type="number" step="1" min="-180" max="180"
                           value={copy.angle ?? 0}
                           aria-label="Angle"
                           onchange={(e) => patchCopy({ angle: num(e) })} />
                </div>
                <span>Alpha</span>
                <div class="slider-row">
                    <input type="range" min="0" max="1" step="0.01"
                           value={copy.alpha ?? 1}
                           aria-label="Alpha slider"
                           oninput={(e) => patchCopy({ alpha: num(e) })} />
                    <input type="number" step="0.05" min="0" max="1"
                           value={copy.alpha ?? 1}
                           aria-label="Alpha"
                           onchange={(e) => patchCopy({ alpha: Math.max(0, Math.min(1, num(e) || 1)) })} />
                </div>
                <span>Tint</span>
                <div class="tint-row">
                    <ColorPicker
                        value={copy.tint ?? '#ffffff'}
                        onchange={(c) => patchCopy({ tint: c })}
                    />
                    <input type="text" class="hex" value={copy.tint ?? '#ffffff'}
                           aria-label="Tint hex"
                           onchange={(e) => patchCopy({ tint: (e.target as HTMLInputElement).value })} />
                </div>
            </div>

            <!-- Custom extends -->
            <div class="extends-section">
                <div class="extends-header">
                    <span class="dim small">Custom properties</span>
                    <button class="icon-sm" title="Add property" onclick={addExtendProp}>
                        <Icon icon="feather:plus" class="feather"/>
                    </button>
                </div>
                {#each Object.entries(copy.extends ?? {}) as [key, val]}
                    <div class="extend-row" class:reserved={RESERVED_PROPS.has(key)}>
                        <input type="text" class="ext-key" aria-label="Property name" value={key}
                               onchange={(e) => renameExtendKey(key, (e.target as HTMLInputElement).value)} />
                        <input type="text" class="ext-val" aria-label="Property value"
                               value={typeof val === 'string' ? val : JSON.stringify(val)}
                               onchange={(e) => updateExtendVal(key, (e.target as HTMLInputElement).value)} />
                        <button class="icon-sm danger" title="Remove property"
                                onclick={() => deleteExtendProp(key)}>
                            <Icon icon="feather:x" class="feather"/>
                        </button>
                        {#if RESERVED_PROPS.has(key)}
                            <span class="reserved-warn" title="Conflicts with a built-in PixiJS property">
                                ⚠ reserved
                            </span>
                        {/if}
                    </div>
                {/each}
            </div>

            <!-- Physics overrides -->
            {#if hasMatter && selectedTemplate()?.physics?.enabled}
                <div class="extends-section">
                    <div class="extends-header">
                        <span class="dim small">Physics Overrides</span>
                    </div>
                    <div class="insp-grid">
                        <span>Is Static</span>
                        <input type="checkbox"
                               aria-label="Is Static"
                               checked={!!(copy.extends?.matterStatic)}
                               onchange={(e) => patchCopyExtends('matterStatic', (e.target as HTMLInputElement).checked ? true : undefined)} />
                        <span>Is Sensor</span>
                        <input type="checkbox"
                               aria-label="Is Sensor"
                               checked={!!(copy.extends?.matterSensor)}
                               onchange={(e) => patchCopyExtends('matterSensor', (e.target as HTMLInputElement).checked ? true : undefined)} />
                        <span>Density</span>
                        <input type="number"
                               aria-label="Density"
                               min="0.0001" step="0.001"
                               value={copy.extends?.matterDensity as number | undefined}
                               placeholder={String(selectedTemplate()?.physics?.density ?? 0.001)}
                               onchange={(e) => {
                                   const v = parseFloat((e.target as HTMLInputElement).value);
                                   patchCopyExtends('matterDensity', isNaN(v) ? undefined : v);
                               }} />
                    </div>
                </div>
            {/if}
        {/if}
    {/if}

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- TILE LAYER SECTION                                                  -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    {#if selection.type === 'tile-layer'}
        {#if selectedLayer()}
            {@const layer = selectedLayer()!}

            <div class="insp-grid">
                <span>Depth</span>
                <input type="number" step="1" value={layer.depth}
                       aria-label="Depth"
                       onchange={(e) => patchLayer({ depth: num(e) })} />
            </div>

            <div class="extends-section">
                <label class="check-row">
                    <input type="checkbox"
                           aria-label="Cache layer"
                           checked={layer.cache}
                           onchange={(e) => patchLayer({ cache: (e.target as HTMLInputElement).checked })} />
                    <span>Cache layer</span>
                </label>
                <p class="dim small note">Caching improves performance but may cause visual glitches with animated tiles.</p>

                <div class="physics-subsection">
                    <label class="check-row">
                        <input type="checkbox"
                               aria-label="Physics enabled"
                               checked={Boolean(layer.physicsEnabled)}
                               onchange={(e) => patchLayer({ physicsEnabled: (e.target as HTMLInputElement).checked })} />
                        <Icon icon="mdi:atom" class="feather"/>
                        <span>Physics (static colliders)</span>
                    </label>

                    {#if layer.physicsEnabled}
                        <div class="insp-grid physics-indent">
                            <span>Friction</span>
                            <input type="number" min="0" max="1" step="0.01"
                                   aria-label="Friction"
                                   value={layer.physicsFriction ?? 1}
                                   onchange={(e) => patchLayer({ physicsFriction: parseFloat((e.target as HTMLInputElement).value) || 0 })} />
                            <span>Restitution</span>
                            <input type="number" min="0" max="1" step="0.01"
                                   aria-label="Restitution"
                                   value={layer.physicsRestitution ?? 0.1}
                                   onchange={(e) => patchLayer({ physicsRestitution: parseFloat((e.target as HTMLInputElement).value) || 0 })} />
                        </div>
                    {/if}

                    {#if hasLight}
                        <!-- ── Light: Blocker ──────────────────────────────── -->
                        <label class="check-row">
                            <input type="checkbox"
                                   aria-label="Blocks light"
                                   checked={Boolean(layer.lightBlocker)}
                                   onchange={(e) => patchLayer({ lightBlocker: (e.target as HTMLInputElement).checked })} />
                            <Icon icon="mdi:brightness-7" class="feather"/>
                            <span>Blocks light</span>
                        </label>

                        <!-- ── Light: Emitter ──────────────────────────────── -->
                        <label class="check-row">
                            <input type="checkbox"
                                   aria-label="Light emitter"
                                   checked={Boolean(layer.lightEmitter)}
                                   onchange={(e) => patchLayer({ lightEmitter: (e.target as HTMLInputElement).checked })} />
                            <Icon icon="mdi:lightbulb-outline" class="feather"/>
                            <span>Light emitter</span>
                        </label>
                        {#if layer.lightEmitter}
                            <div class="insp-grid light-indent">
                                <span>Shape</span>
                                <select value={layer.lightEmitterShape ?? 'soft'}
                                        onchange={(e) => patchLayer({ lightEmitterShape: (e.target as HTMLSelectElement).value as LightShape })}>
                                    <option value="soft">Soft circle</option>
                                    <option value="circle">Hard circle</option>
                                    <option value="point">Point</option>
                                </select>
                                <span>Color</span>
                                <input type="color"
                                       value={layer.lightEmitterColor ?? '#ffffff'}
                                       oninput={(e) => patchLayer({ lightEmitterColor: (e.target as HTMLInputElement).value })} />
                                <span>Scale</span>
                                <input type="number" step="0.1" min="0.01"
                                       value={layer.lightEmitterScale ?? 1}
                                       oninput={(e) => patchLayer({ lightEmitterScale: parseFloat((e.target as HTMLInputElement).value) || 1 })} />
                            </div>

                            <!-- Cast shadows sub-section -->
                            <label class="check-row light-indent">
                                <input type="checkbox"
                                       aria-label="Cast shadows"
                                       checked={Boolean(layer.lightCastShadows)}
                                       onchange={(e) => patchLayer({ lightCastShadows: (e.target as HTMLInputElement).checked })} />
                                <span>Cast shadows</span>
                            </label>
                            {#if layer.lightCastShadows}
                                <div class="insp-grid light-indent">
                                    <span>Radius (px)</span>
                                    <input type="number" step="10" min="0"
                                           value={layer.lightRadius ?? 300}
                                           oninput={(e) => patchLayer({ lightRadius: parseFloat((e.target as HTMLInputElement).value) || 300 })} />
                                    <span>Type</span>
                                    <select value={layer.lightType ?? 'point'}
                                            onchange={(e) => patchLayer({ lightType: (e.target as HTMLSelectElement).value as 'point' | 'spot' })}>
                                        <option value="point">Point (360°)</option>
                                        <option value="spot">Spot (cone)</option>
                                    </select>
                                    {#if (layer.lightType ?? 'point') === 'spot'}
                                        <span>Cone angle (deg)</span>
                                        <input type="number" step="5" min="1" max="360"
                                               value={layer.lightConeAngle ?? 90}
                                               oninput={(e) => patchLayer({ lightConeAngle: parseFloat((e.target as HTMLInputElement).value) || 90 })} />
                                    {/if}
                                </div>
                            {/if}
                        {/if}
                    {/if}

                    {#if !hasMatter}
                        <p class="dim small note">Enable Matter.js in Project Settings to use physics.</p>
                    {/if}
                </div>
            </div>
        {/if}
    {/if}

    <!-- ════════════════════════════════════════════════════════════════════ -->
    <!-- TILE SECTION                                                        -->
    <!-- ════════════════════════════════════════════════════════════════════ -->
    {#if selection.type === 'tile'}
        {#if selectedTile()}
            {@const tile = selectedTile()!}
            {@const parentLayer = selectedLayer()}

            <div class="insp-grid">
                <!-- Position: read-only (tiles snap to grid) -->
                <span class="dim">Pos X</span>
                <input type="number" value={tile.x} disabled aria-label="Tile X (read-only)" />
                <span class="dim">Pos Y</span>
                <input type="number" value={tile.y} disabled aria-label="Tile Y (read-only)" />

                <span>Scale X</span>
                <input type="number" step="0.1" value={tile.scale?.x ?? 1}
                       aria-label="Scale X"
                       onchange={(e) => patchTile({ scale: { x: num(e) || 1, y: tile.scale?.y ?? 1 } })} />
                <span>Scale Y</span>
                <input type="number" step="0.1" value={tile.scale?.y ?? 1}
                       aria-label="Scale Y"
                       onchange={(e) => patchTile({ scale: { x: tile.scale?.x ?? 1, y: num(e) || 1 } })} />

                <span>Rotation</span>
                <div class="slider-row">
                    <input type="range" min="0" max="360" step="1"
                           value={tile.rotation ?? 0}
                           aria-label="Rotation slider"
                           oninput={(e) => patchTile({ rotation: num(e) })} />
                    <input type="number" step="1" min="0" max="360"
                           value={tile.rotation ?? 0}
                           aria-label="Rotation"
                           onchange={(e) => patchTile({ rotation: num(e) })} />
                </div>

                <span>Opacity</span>
                <div class="slider-row">
                    <input type="range" min="0" max="1" step="0.01"
                           value={tile.opacity ?? 1}
                           aria-label="Opacity slider"
                           oninput={(e) => patchTile({ opacity: num(e) })} />
                    <input type="number" step="0.01" min="0" max="1"
                           value={tile.opacity ?? 1}
                           aria-label="Opacity"
                           onchange={(e) => patchTile({ opacity: Math.max(0, Math.min(1, num(e))) })} />
                </div>

                <span>Tint</span>
                <div class="tint-row">
                    <ColorPicker
                        value={numTintToHex(tile.tint ?? 0xffffff)}
                        onchange={(c) => patchTile({ tint: hexTintToNum(c) })}
                    />
                    <input type="text" class="hex"
                           value={numTintToHex(tile.tint ?? 0xffffff)}
                           aria-label="Tint hex"
                           onchange={(e) => patchTile({ tint: hexTintToNum((e.target as HTMLInputElement).value) })} />
                </div>
            </div>

            {#if hasLight}
                <!-- ── Light: Blocker ──────────────────────────────────── -->
                <label class="check-row" style="margin-top:0.5rem">
                    <input type="checkbox"
                           aria-label="Blocks light"
                           checked={Boolean(tile.lightBlocker)}
                           onchange={(e) => patchTile({ lightBlocker: (e.target as HTMLInputElement).checked })} />
                    <Icon icon="mdi:brightness-7" class="feather"/>
                    <span>Blocks light</span>
                </label>

                <!-- ── Light: Emitter ──────────────────────────────────── -->
                <label class="check-row">
                    <input type="checkbox"
                           aria-label="Light emitter"
                           checked={Boolean(tile.lightEmitter)}
                           onchange={(e) => patchTile({ lightEmitter: (e.target as HTMLInputElement).checked })} />
                    <Icon icon="mdi:lightbulb-outline" class="feather"/>
                    <span>Light emitter</span>
                </label>
                {#if tile.lightEmitter}
                    <div class="insp-grid light-indent">
                        <span>Shape</span>
                        <select value={tile.lightEmitterShape ?? 'soft'}
                                onchange={(e) => patchTile({ lightEmitterShape: (e.target as HTMLSelectElement).value as LightShape })}>
                            <option value="soft">Soft circle</option>
                            <option value="circle">Hard circle</option>
                            <option value="point">Point</option>
                        </select>
                        <span>Color</span>
                        <input type="color"
                               value={tile.lightEmitterColor ?? '#ffffff'}
                               oninput={(e) => patchTile({ lightEmitterColor: (e.target as HTMLInputElement).value })} />
                        <span>Scale</span>
                        <input type="number" step="0.1" min="0.01"
                               value={tile.lightEmitterScale ?? 1}
                               oninput={(e) => patchTile({ lightEmitterScale: parseFloat((e.target as HTMLInputElement).value) || 1 })} />
                    </div>

                    <label class="check-row light-indent">
                        <input type="checkbox"
                               aria-label="Cast shadows"
                               checked={Boolean(tile.lightCastShadows)}
                               onchange={(e) => patchTile({ lightCastShadows: (e.target as HTMLInputElement).checked })} />
                        <span>Cast shadows</span>
                    </label>
                    {#if tile.lightCastShadows}
                        <div class="insp-grid light-indent">
                            <span>Radius (px)</span>
                            <input type="number" step="10" min="0"
                                   value={tile.lightRadius ?? 300}
                                   oninput={(e) => patchTile({ lightRadius: parseFloat((e.target as HTMLInputElement).value) || 300 })} />
                            <span>Type</span>
                            <select value={tile.lightType ?? 'point'}
                                    onchange={(e) => patchTile({ lightType: (e.target as HTMLSelectElement).value as 'point' | 'spot' })}>
                                <option value="point">Point (360°)</option>
                                <option value="spot">Spot (cone)</option>
                            </select>
                            {#if (tile.lightType ?? 'point') === 'spot'}
                                <span>Cone angle (deg)</span>
                                <input type="number" step="5" min="1" max="360"
                                       value={tile.lightConeAngle ?? 90}
                                       oninput={(e) => patchTile({ lightConeAngle: parseFloat((e.target as HTMLInputElement).value) || 90 })} />
                            {/if}
                        </div>
                    {/if}
                {/if}
            {/if}

            <!-- Physics override (only when parent layer has physicsEnabled) -->
            {#if parentLayer?.physicsEnabled}
                <div class="extends-section">
                    <div class="extends-header">
                        <span class="dim small">Physics Override</span>
                    </div>

                    <div class="insp-grid">
                        <span>Override</span>
                        <label class="check-row inline">
                            <input type="checkbox"
                                   aria-label="Physics override enabled"
                                   checked={tile.physicsOverride?.enabled === true}
                                   onchange={(e) => setTilePhysicsOverrideEnabled((e.target as HTMLInputElement).checked)} />
                            <span class="dim small">
                                {tile.physicsOverride?.enabled === true
                                    ? 'Overriding layer'
                                    : tile.physicsOverride?.enabled === false
                                        ? 'Disabled'
                                        : 'Inherit from layer'}
                            </span>
                        </label>

                        {#if tile.physicsOverride?.enabled === true}
                            <span>Friction</span>
                            <input type="number" min="0" max="1" step="0.01"
                                   aria-label="Friction override"
                                   value={tile.physicsOverride?.friction ?? parentLayer.physicsFriction ?? 1}
                                   onchange={(e) => patchTilePhysicsOverride({ friction: parseFloat((e.target as HTMLInputElement).value) || 0 })} />
                            <span>Restitution</span>
                            <input type="number" min="0" max="1" step="0.01"
                                   aria-label="Restitution override"
                                   value={tile.physicsOverride?.restitution ?? parentLayer.physicsRestitution ?? 0.1}
                                   onchange={(e) => patchTilePhysicsOverride({ restitution: parseFloat((e.target as HTMLInputElement).value) || 0 })} />
                        {/if}
                    </div>
                </div>
            {/if}
        {/if}
    {/if}

</div>
{/if}

<style>
    /* ── Floating panel container ─────────────────────────────────────────── */
    .room-inspector {
        position: absolute;
        right: 8px;
        top: 8px;
        width: 240px;
        max-height: calc(100% - 16px);
        overflow-y: auto;
        overflow-x: hidden;

        background: color-mix(in srgb, var(--background-deeper, #111122) 92%, transparent);
        border: 1px solid var(--border-bright, #333);
        border-radius: 5px;
        padding: 0.55rem 0.6rem 0.65rem;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);

        display: flex;
        flex-direction: column;
        gap: 0.4rem;

        /* Prevent interactions from propagating to canvas below */
        pointer-events: all;
        z-index: 10;
    }

    /* ── Scrollbar ────────────────────────────────────────────────────────── */
    .room-inspector::-webkit-scrollbar { width: 4px; }
    .room-inspector::-webkit-scrollbar-track { background: transparent; }
    .room-inspector::-webkit-scrollbar-thumb {
        background: var(--border-bright, #333);
        border-radius: 2px;
    }

    /* ── Header ───────────────────────────────────────────────────────────── */
    .insp-header {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        padding-bottom: 0.3rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        margin-bottom: 0.1rem;
        flex-shrink: 0;
    }
    .insp-header :global(.insp-icon) {
        width: 0.85rem;
        height: 0.85rem;
        fill: none;
        stroke: var(--text-dim, #888);
        stroke-width: 2;
        flex-shrink: 0;
    }
    .insp-title {
        font-size: 0.82rem;
        color: var(--text, #e0e0e0);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* ── Property grid ────────────────────────────────────────────────────── */
    .insp-grid {
        display: grid;
        grid-template-columns: 4.5rem 1fr;
        gap: 0.2rem 0.4rem;
        align-items: center;
    }
    .insp-grid span {
        font-size: 0.78rem;
        color: var(--text-dim, #888);
    }
    .insp-grid input:not([type="checkbox"]) {
        width: 100%;
        box-sizing: border-box;
    }

    /* ── Slider + number combos ──────────────────────────────────────────── */
    .slider-row {
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }
    .slider-row input[type="range"]  { flex: 1; min-width: 0; }
    .slider-row input[type="number"] { width: 50px; flex-shrink: 0; }

    /* ── Tint row ─────────────────────────────────────────────────────────── */
    .tint-row {
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }
    .tint-row input[type="text"] {
        flex: 1;
        font-family: monospace;
    }

    /* ── Inputs ───────────────────────────────────────────────────────────── */
    input[type="number"],
    input[type="text"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.8rem;
    }
    input[type="number"]:focus,
    input[type="text"]:focus {
        outline: none;
        border-color: var(--accent1, #446adb);
    }
    input[type="number"]:disabled,
    input[type="text"]:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    input.hex { font-family: monospace; }

    /* ── Extends / sections ───────────────────────────────────────────────── */
    .extends-section {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        border-top: 1px solid var(--border-pale, #2a2a3e);
        padding-top: 0.35rem;
    }
    .extends-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.1rem 0;
    }
    .extend-row {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        flex-wrap: wrap;
    }
    .extend-row.reserved {
        outline: 1px solid #e08030;
        border-radius: 3px;
    }
    .reserved-warn {
        width: 100%;
        font-size: 0.7rem;
        color: #e08030;
        padding: 0 2px;
    }
    .ext-key { flex: 0 0 40%; min-width: 0; box-sizing: border-box; }
    .ext-val { flex: 1 1 auto; min-width: 0; box-sizing: border-box; }

    /* ── Check rows ──────────────────────────────────────────────────────── */
    .check-row {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.82rem;
        cursor: pointer;
        color: var(--text, #e0e0e0);
    }
    .check-row.inline {
        cursor: default;
    }
    .check-row :global(svg) {
        width: 0.82rem;
        height: 0.82rem;
        fill: none;
        stroke: var(--text-dim, #888);
        stroke-width: 2;
        flex-shrink: 0;
    }

    /* ── Physics sub-section ─────────────────────────────────────────────── */
    .physics-subsection {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding-top: 0.2rem;
    }
    .physics-indent {
        margin-left: 0.6rem;
    }
    .light-indent {
        margin-left: 0.6rem;
        padding-left: 0.5rem;
        border-left: 2px solid var(--border-pale, #2a2a3e);
    }

    /* ── Icon buttons ────────────────────────────────────────────────────── */
    .icon-sm {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        padding: 0;
        flex-shrink: 0;
        border: 1px solid transparent;
        border-radius: 3px;
        background: transparent;
        color: var(--text-dim, #888);
        cursor: pointer;
    }
    .icon-sm :global(svg) {
        width: 0.8rem;
        height: 0.8rem;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
    }
    .icon-sm:hover {
        color: var(--text, #e0e0e0);
        background: var(--act, #1e2233);
        border-color: var(--border-bright, #333);
    }
    .icon-sm.danger:hover {
        color: var(--danger, #e74c3c);
        border-color: var(--danger, #e74c3c);
        background: transparent;
    }

    /* ── Notes / hints ───────────────────────────────────────────────────── */
    .note {
        margin: 0.1rem 0 0;
    }

    p  { margin: 0; font-size: 0.85rem; }
    .small { font-size: 0.78rem; }
    .dim   { color: var(--text-dim, #888); }
</style>
