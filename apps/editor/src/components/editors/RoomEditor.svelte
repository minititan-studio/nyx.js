<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * RoomEditor.svelte
     * Migrated from: editors/room-editor/
     *
     * Room properties (dimensions, bg color, view mode, event code) + a PixiJS
     * scene canvas for placing template copies.
     * Canvas rendering (PixiJS scene) is Phase 6; this phase delivers the full
     * property panel and a placeholder canvas with grid overlay.
     */
    import { onDestroy, untrack } from 'svelte';
    import { get } from 'svelte/store';
    import * as PIXI from 'pixi.js';
    import { signals, undoTargetOverride } from '../../stores/editorStore.js';
    import { updateAsset, pushAssetUndoSnapshot, getUndoStackSize, getRedoStackSize, undoAsset, redoAsset, currentProject, projectFilePath } from '../../stores/projectStore.js';
    import { openedAssets } from '../../stores/editorStore.js';
    import type { NyxRoom, NyxUILayer, NyxTemplate, NyxCopy, NyxTexture, NyxBackground, NyxTile, NyxTileLayer, NyxUIWidget } from '@nyx/shared';
    import { anchorBasePixels, anchorFracX, anchorFracY } from '../../lib/uiAnchor.js';
    import TileEditor from './TileEditor.svelte';
    import RoomProperties from './room/RoomProperties.svelte';
    import RoomEntitiesList from './room/RoomEntitiesList.svelte';
    import RoomBackgroundsEditor from './room/RoomBackgroundsEditor.svelte';
    import RoomEventsEditor from './room/RoomEventsEditor.svelte';
    import RoomTemplatePicker from './room/RoomTemplatePicker.svelte';
    import RoomUIEditor from './room/RoomUIEditor.svelte';
    import RoomInspector from './room/RoomInspector.svelte';
    import type { RoomSelection } from './room/RoomInspector.svelte';

    interface Props { asset: NyxRoom; uiOnlyMode?: boolean; }
    let { asset, uiOnlyMode = false }: Props = $props();

    let width           = $state(asset.width);
    let height          = $state(asset.height);
    let backgroundColor = $state(asset.backgroundColor);
    let isStartingRoom  = $state(asset.isStartingRoom);
    let viewMode        = $state(asset.viewMode);
    let gridX           = $state(asset.gridX ?? 32);
    let gridY           = $state(asset.gridY ?? 32);
    let diagonalGrid         = $state(asset.diagonalGrid ?? false);
    let disableGrid          = $state(asset.disableGrid ?? false);
    let editorLightPreview   = $state(asset.editorLightPreview    ?? false);
    let lightAmbientColor    = $state(asset.lightAmbientColor    ?? '#FFFFFF');
    let lightAmbientOpacity  = $state(asset.lightAmbientOpacity  ?? 1);
    let activeTab       = $state<'settings' | 'backgrounds' | 'copies' | 'tiles' | 'ui' | 'code'>(uiOnlyMode ? 'ui' : 'settings');
    let selectedWidgetUids = $state(new Set<string>());
    /** Single selected widget UID, or null when 0 or 2+ are selected. */
    const selectedWidgetUid = $derived(
        selectedWidgetUids.size === 1 ? [...selectedWidgetUids][0] : null
    );
    let activeTileLayerIdx = $state(0);
    let prevUid = asset.uid;

    const VIEW_MODES = [
        { value: 'asIs',             label: 'As is' },
        { value: 'fastScale',        label: 'Fast scale' },
        { value: 'fastScaleInteger', label: 'Integer scale' },
        { value: 'expand',           label: 'Expand' },
        { value: 'scaleFit',         label: 'Scale fit' },
        { value: 'scaleFill',        label: 'Scale fill' },
    ] as const;

    // Always-fresh room data from the live store — avoids stale `asset` prop
    // references when updateAsset creates new objects (same pattern as `templates`).
    const liveRoom    = $derived(
        ($currentProject?.rooms?.find((r): r is NyxRoom => r.uid === asset.uid)) ?? asset
    );
    const copies      = $derived(liveRoom.copies);
    const backgrounds = $derived(liveRoom.backgrounds);

    // When in the UI tab the active undo target is the UILayer, not the room.
    const effectiveUndoUid = $derived(
        activeTab === 'ui' && activeUiLayerUid ? activeUiLayerUid : asset.uid
    );
    // Reactive undo/redo availability — re-evaluates whenever openedAssets changes,
    // which happens on every updateAsset / undoAsset / redoAsset call.
    const canUndoRoom = $derived(!!$openedAssets && getUndoStackSize(effectiveUndoUid) > 0);
    const canRedoRoom = $derived(!!$openedAssets && getRedoStackSize(effectiveUndoUid) > 0);

    // When the UI sub-tab is active, route Ctrl+Z to the active UILayer's undo stack
    // instead of the room's, since widget edits go to the UILayer asset.
    $effect(() => {
        if (activeTab === 'ui' && activeUiLayerUid) {
            undoTargetOverride.set(activeUiLayerUid);
        } else {
            undoTargetOverride.set(null);
        }
        return () => undoTargetOverride.set(null);
    });

    // After undo/redo the room snapshot may have fewer copies or tile layers than
    // before, leaving stale indices in the selection sets. Prune them reactively.
    $effect(() => {
        const copies = liveRoom.copies;
        const tiles  = liveRoom.tiles ?? [];
        untrack(() => {
            const validCopyUids = new Set(copies.map(c => c.uid));
            const nextCopySel   = new Set([...selectedCopyUids].filter(u => validCopyUids.has(u)));
            if (nextCopySel.size !== selectedCopyUids.size) selectedCopyUids = nextCopySel;

            const nextTileSel = selectedTiles.filter(st =>
                st.layerIdx < tiles.length &&
                st.tileIdx  < (tiles[st.layerIdx]?.tiles.length ?? 0)
            );
            if (nextTileSel.length !== selectedTiles.length) selectedTiles = nextTileSel;
        });
    });

    let activeUiLayerUid = $state<string | null>(uiOnlyMode ? (asset.uiLayerUids?.[0] ?? null) : null);
    const allUiLayers   = $derived($currentProject?.uiLayers ?? []);
    const activeUiLayer = $derived(
        allUiLayers.find(l => l.uid === activeUiLayerUid) ?? null
    );
    const activeUiWidgets = $derived(activeUiLayer?.widgets ?? []);

    // Always read the authoritative widget list from the store — never from the
    // potentially-stale `activeUiWidgets` derived in rapid-fire drag handlers.
    function getFreshActiveWidgets(): NyxUIWidget[] {
        if (!activeUiLayerUid) return [];
        return get(currentProject)?.uiLayers?.find(l => l.uid === activeUiLayerUid)?.widgets ?? [];
    }

    // All widgets from every layer assigned to this room — used for canvas rendering.
    const allAssignedUiWidgets = $derived(
        (liveRoom.uiLayerUids ?? [])
            .flatMap(uid => allUiLayers.find(l => l.uid === uid)?.widgets ?? [])
    );

    // Auto-select the first assigned layer when the room opens or its layer list changes.
    $effect(() => {
        const uids = liveRoom.uiLayerUids ?? [];
        if (activeUiLayerUid === null && uids.length > 0) {
            activeUiLayerUid = uids[0];
        }
    });

    // Reset only when a different asset is loaded into this slot
    $effect(() => {
        if (asset.uid === prevUid) return;
        prevUid         = asset.uid;
        width           = asset.width;
        height          = asset.height;
        backgroundColor = asset.backgroundColor;
        isStartingRoom  = asset.isStartingRoom;
        viewMode        = asset.viewMode;
        gridX           = asset.gridX ?? 32;
        gridY           = asset.gridY ?? 32;
        diagonalGrid         = asset.diagonalGrid ?? false;
        disableGrid          = asset.disableGrid ?? false;
        editorLightPreview   = asset.editorLightPreview    ?? false;
        lightAmbientColor    = asset.lightAmbientColor    ?? '#FFFFFF';
        lightAmbientOpacity  = asset.lightAmbientOpacity  ?? 1;
    });

    function persist(extra: Partial<NyxRoom> = {}) {
        updateAsset<NyxRoom>(asset.uid, 'room', {
            width, height, backgroundColor, isStartingRoom, viewMode,
            gridX, gridY, diagonalGrid, disableGrid, editorLightPreview,
            lightAmbientColor, lightAmbientOpacity,
            ...extra,
        });
        signals.emit('assetChanged');
    }

    // All templates for the add-copy picker
    const templates = $derived($currentProject?.templates ?? []);

    // ── Unified canvas selection (drives RoomInspector) ──────────────────────
    const roomSelection = $derived((): RoomSelection => {
        if (selectedCopyUids.size === 1) {
            return { type: 'copy', copyUid: [...selectedCopyUids][0] };
        }
        if (selectedTiles.length === 1) {
            return { type: 'tile', layerIdx: selectedTiles[0].layerIdx, tileIdx: selectedTiles[0].tileIdx };
        }
        // Tile-layer fallback: only while the tiles tab is open (no specific object selected)
        if (activeTab === 'tiles' && liveRoom.tiles?.length > 0) {
            return { type: 'tile-layer', layerIdx: activeTileLayerIdx };
        }
        return null;
    });

    // ── PixiJS read-only canvas ───────────────────────────────────────────────

    let canvasEl    = $state<HTMLCanvasElement | undefined>(undefined);
    let stageEl     = $state<HTMLDivElement | undefined>(undefined);
    let pixiApp = $state<PIXI.Application | null>(null);

    // Camera state (zoom + pan)
    let camX    = $state(0);
    let camY    = $state(0);
    let camZoom = $state(1);

    // Interaction state
    let activeTool       = $state<'select' | 'place' | 'erase'>('select');
    let selectedTemplate = $state<NyxTemplate | null>(null);
    let selectedCopyUids = $state(new Set<string>());

    // Tile painting state — updated by TileEditor via ontileselection
    interface TileSel { textureUid: string; startX: number; startY: number; spanX: number; spanY: number; }
    let currentTileSel = $state<TileSel | null>(null);
    let tilePainting   = $state(false);
    let tileErasing    = $state(false);

    // Texture cache: url → loaded PIXI.Texture (persists across scene rebuilds)
    const texCache = new Map<string, PIXI.Texture>();
    // Serial number: incremented on each loadAndBuild call to cancel stale renders
    let buildSerial = 0;
    let uiLayerRef: PIXI.Container | null = null;
    /** Render texture for the light-preview lightmap — destroyed at the start of each buildScene. */
    let lightOverlayTex: PIXI.RenderTexture | null = null;

    // Drag state (select mode)
    let dragging              = $state(false);
    let dragStartX            = 0, dragStartY = 0;
    let dragCopyPositions: Map<string, { x: number; y: number }> = new Map();

    // Mouse world position — tracked for ghost preview
    let mousePosW = $state<{ wx: number; wy: number } | null>(null);

    // Handle types for copy/tile transform gizmos
    type HandleType = 'move' | 'rotate' | 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

    interface HandleDragState {
        copyUid: string;
        handle: HandleType;
        startClientX: number;
        startClientY: number;
        origX: number;
        origY: number;
        origScaleX: number;
        origScaleY: number;
        origAngle: number;
        origFw: number;
        origFh: number;
        origAx: number;
        origAy: number;
        startWorldAngle: number;
    }
    let handleDrag = $state<HandleDragState | null>(null);

    // Tile tool mode — 'paint' | 'erase' | 'select'
    type TileToolMode = 'paint' | 'erase' | 'select';
    let tileToolMode = $state<TileToolMode>('paint');

    // Marquee (rect) selection for copies
    let marqueeStart = $state<{ wx: number; wy: number } | null>(null);
    let marqueeEnd   = $state<{ wx: number; wy: number } | null>(null);

    interface SelectedTile { layerIdx: number; tileIdx: number; }
    let selectedTiles = $state<SelectedTile[]>([]);

    // Reset tile selection when active layer changes
    $effect(() => {
        void activeTileLayerIdx;
        selectedTiles = [];
    });

    interface TileHandleDragState {
        layerIdx: number;
        tileIdx: number;
        handle: HandleType;
        startClientX: number;
        startClientY: number;
        origX: number;
        origY: number;
        origScaleX: number;
        origScaleY: number;
        origRotation: number;
        origFw: number;
        origFh: number;
        startWorldAngle: number;
        allOrigPositions: Array<{ layerIdx: number; tileIdx: number; origX: number; origY: number }>;
    }
    let tileHandleDrag = $state<TileHandleDragState | null>(null);

    // ── UI widget gizmo state ─────────────────────────────────────────────────
    // Stage pixel dimensions — updated by ResizeObserver for overlay math
    let stageW = $state(800);
    let stageH = $state(600);
    $effect(() => {
        if (!stageEl) return;
        stageW = stageEl.clientWidth;
        stageH = stageEl.clientHeight;
        const ro = new ResizeObserver(() => {
            stageW = stageEl!.clientWidth;
            stageH = stageEl!.clientHeight;
        });
        ro.observe(stageEl);
        return () => ro.disconnect();
    });

    type UIHandleType = 'move' | 'rotate' | 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';
    interface UIHandleDragState {
        handle: UIHandleType;
        startClientX: number; startClientY: number;
        origX: number; origY: number;
        origW: number; origH: number;
        origRot: number;
        /** Original x/y of every selected widget — used for multi-select move. */
        origPositions: Map<string, { x: number; y: number }>;
    }
    let uiHandleDrag = $state<UIHandleDragState | null>(null);

    /** Pixel bounds of the selected UI widget(s) within the canvas overlay. */
    const uiHandleData = $derived(() => {
        if (activeTab !== 'ui' || selectedWidgetUids.size === 0) return null;
        if (selectedWidgetUids.size === 1) {
            const uid = [...selectedWidgetUids][0];
            const w = activeUiWidgets.find(ww => ww.uid === uid);
            if (!w) return null;
            const pos = getWidgetScreenPos(uid);
            if (!pos) return null;
            return { w, px: pos.px, py: pos.py, pw: w.width * camZoom, ph: w.height * camZoom, multi: false };
        }
        // Multi-select: AABB enclosing all selected widgets in screen space
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const uid of selectedWidgetUids) {
            const ww = activeUiWidgets.find(x => x.uid === uid);
            if (!ww) continue;
            const pos = getWidgetScreenPos(uid);
            if (!pos) continue;
            minX = Math.min(minX, pos.px);
            minY = Math.min(minY, pos.py);
            maxX = Math.max(maxX, pos.px + ww.width * camZoom);
            maxY = Math.max(maxY, pos.py + ww.height * camZoom);
        }
        if (!isFinite(minX)) return null;
        return { w: null, px: minX, py: minY, pw: maxX - minX, ph: maxY - minY, multi: true };
    });

    function onUIHandlePointerDown(ev: PointerEvent, handle: UIHandleType): void {
        ev.stopPropagation();
        const primaryUid = selectedWidgetUid;
        const primary = primaryUid ? activeUiWidgets.find(ww => ww.uid === primaryUid) : null;
        // Capture original positions of all selected widgets for multi-select move
        const origPositions = new Map<string, { x: number; y: number }>();
        for (const uid of selectedWidgetUids) {
            const ww = activeUiWidgets.find(x => x.uid === uid);
            if (ww) origPositions.set(uid, { x: ww.x, y: ww.y });
        }
        if (activeUiLayerUid) pushAssetUndoSnapshot(activeUiLayerUid);
        uiHandleDrag = {
            handle,
            startClientX: ev.clientX, startClientY: ev.clientY,
            origX: primary?.x ?? 0, origY: primary?.y ?? 0,
            origW: primary?.width ?? 0, origH: primary?.height ?? 0,
            origRot: primary?.rotation ?? 0,
            origPositions,
        };
        if (stageEl) stageEl.setPointerCapture(ev.pointerId);
    }

    // Stable template name lookup
    function getTemplate(uid: string): NyxTemplate | undefined {
        return templates.find(t => t.uid === uid);
    }

    /** Deterministic hue from a string uid → pastel PIXI colour int */
    function uidToColor(uid: string): number {
        let h = 0;
        for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
        const hue = (h % 360) / 360;
        // HSL(hue, 0.55, 0.55) → RGB
        const s = 0.55, l = 0.55;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        const hi = Math.floor(hue * 6);
        if      (hi === 0) { r = c; g = x; }
        else if (hi === 1) { r = x; g = c; }
        else if (hi === 2) { g = c; b = x; }
        else if (hi === 3) { g = x; b = c; }
        else if (hi === 4) { r = x; b = c; }
        else               { r = c; b = x; }
        return (((r + m) * 255) << 16 | ((g + m) * 255) << 8 | ((b + m) * 255)) >>> 0;
    }

    /** Parse CSS hex colour string to PIXI int (0xRRGGBB). Strips alpha byte if 8-char #RRGGBBAA. */
    function hexToPixi(hex: string): number {
        return parseInt((hex.startsWith('#') ? hex.slice(1, 7) : hex.slice(0, 6)), 16);
    }

    /** Extract 0–1 alpha from an 8-char #RRGGBBAA hex string; returns 1 for 6-char. */
    function hexAlphaPixi(hex: string): number {
        if (hex.length === 9) return parseInt(hex.slice(7, 9), 16) / 255;
        return 1;
    }

    /** Convert uid colour int to CSS hex string for inline styles */
    function uidToColorHex(uid: string): string {
        return `#${uidToColor(uid).toString(16).padStart(6, '0')}`;
    }

    /** Convert screen pixel coords → world (room) coords */
    function screenToWorld(sx: number, sy: number): { x: number; y: number } {
        if (!stageEl) return { x: 0, y: 0 };
        const rect = stageEl.getBoundingClientRect();
        return {
            x: (sx - rect.left - camX) / camZoom,
            y: (sy - rect.top  - camY) / camZoom,
        };
    }

    /** Returns uid of the topmost copy at world-space point, or null */
    function hitTestCopies(wx: number, wy: number): string | null {
        const project = get(currentProject);
        for (let i = liveRoom.copies.length - 1; i >= 0; i--) {
            const c       = liveRoom.copies[i];
            const tmpl    = getTemplate(c.templateUid);
            const texData = tmpl?.textureUid
                ? project?.textures.find(t => t.uid === tmpl.textureUid)
                : null;
            const fw  = texData?.width  ?? 32;
            const fh  = texData?.height ?? 32;
            const ax  = texData?.axis[0] ?? 0.5;
            const ay  = texData?.axis[1] ?? 0.5;
            const sx  = c.scaleX ?? 1;
            const sy  = c.scaleY ?? 1;
            const sw  = fw * Math.abs(sx);
            const sh  = fh * Math.abs(sy);
            const x0  = sx >= 0 ? c.x - ax * sw : c.x - (1 - ax) * sw;
            const y0  = sy >= 0 ? c.y - ay * sh : c.y - (1 - ay) * sh;
            if (wx >= x0 && wx <= x0 + sw && wy >= y0 && wy <= y0 + sh) return c.uid;
        }
        return null;
    }

    /** Returns { layerIdx, tileIdx } of the topmost tile at world-space point across all layers */
    function hitTestTiles(wx: number, wy: number): SelectedTile | null {
        const project = get(currentProject);
        if (!liveRoom.tiles?.length) return null;
        // Search layers top-to-bottom (highest depth first visually)
        for (let li = liveRoom.tiles.length - 1; li >= 0; li--) {
            const layer = liveRoom.tiles[li];
            if (layer.hidden) continue;
            for (let i = layer.tiles.length - 1; i >= 0; i--) {
                const tile    = layer.tiles[i];
                const texData = project?.textures.find(t => t.uid === tile.texture);
                const tsx = tile.scale?.x ?? 1;
                const tsy = tile.scale?.y ?? 1;
                const tw  = (texData?.width  ?? 32) * Math.abs(tsx);
                const th  = (texData?.height ?? 32) * Math.abs(tsy);
                const tl  = tsx >= 0 ? tile.x : tile.x - tw;
                const tt  = tsy >= 0 ? tile.y : tile.y - th;
                if (wx >= tl && wx < tl + tw && wy >= tt && wy < tt + th) {
                    return { layerIdx: li, tileIdx: i };
                }
            }
        }
        return null;
    }

    function updateSelectedTiles(patch: Partial<NyxTile>): void {
        if (selectedTiles.length === 0) return;
        const nextTiles = JSON.parse(JSON.stringify(liveRoom.tiles)) as NyxTileLayer[];
        for (const st of selectedTiles) {
            const tile = nextTiles?.[st.layerIdx]?.tiles[st.tileIdx];
            if (tile) Object.assign(tile, patch);
        }
        updateAsset<NyxRoom>(asset.uid, 'room', { tiles: nextTiles });
        signals.emit('assetChanged');
    }

    function deleteSelectedTiles(): void {
        if (selectedTiles.length === 0) return;
        pushAssetUndoSnapshot(asset.uid);
        const nextTiles = JSON.parse(JSON.stringify(liveRoom.tiles)) as NyxTileLayer[];
        const byLayer = new Map<number, number[]>();
        for (const st of selectedTiles) {
            if (!byLayer.has(st.layerIdx)) byLayer.set(st.layerIdx, []);
            byLayer.get(st.layerIdx)!.push(st.tileIdx);
        }
        for (const [li, indices] of byLayer) {
            for (const ti of [...indices].sort((a, b) => b - a)) {
                nextTiles[li].tiles.splice(ti, 1);
            }
        }
        updateAsset<NyxRoom>(asset.uid, 'room', { tiles: nextTiles });
        selectedTiles = [];
        signals.emit('assetChanged');
    }

    function tileMultiVal<K extends keyof NyxTile>(key: K): NyxTile[K] | undefined {
        if (selectedTiles.length === 0) return undefined;
        const vals = selectedTiles.map(st => liveRoom.tiles?.[st.layerIdx]?.tiles[st.tileIdx]?.[key]);
        const first = JSON.stringify(vals[0]);
        return vals.every(v => JSON.stringify(v) === first) ? vals[0] : undefined;
    }

    function tileScaleMultiVal(axis: 'x' | 'y'): number | undefined {
        if (selectedTiles.length === 0) return undefined;
        const vals = selectedTiles.map(st => liveRoom.tiles?.[st.layerIdx]?.tiles[st.tileIdx]?.scale?.[axis] ?? 1);
        return vals.every(v => v === vals[0]) ? vals[0] : undefined;
    }

    /** Build the nyx-asset:// URL for a texture origname relative to the open project */
    function getTexUrl(origname: string): string | null {
        const fp = get(projectFilePath);
        if (!fp || !origname) return null;
        const dir = fp.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        return `nyx-asset://localhost/${dir}/img/${encodeURIComponent(origname)}`;
    }

    /**
     * Extract frame-0 sub-texture from a fully-loaded base texture using ct.js
     * frame-grid metadata.  Formula from legacy textures/index.ts:
     *   x = offx + row*(width+marginx),  y = offy + col*(height+marginy)
     * Frame 0 → row=0, col=0 → x=offx, y=offy.
     */
    function getFrameTexture(url: string | null, base: PIXI.Texture, texData: NyxTexture): PIXI.Texture {
        const fw = texData.width  > 0 ? texData.width  : base.baseTexture.realWidth;
        const fh = texData.height > 0 ? texData.height : base.baseTexture.realHeight;
        const rx = texData.offx;
        const ry = texData.offy;
        const bw = base.baseTexture.realWidth;
        const bh = base.baseTexture.realHeight;
        if (rx === 0 && ry === 0 && fw >= bw && fh >= bh) return base;
        const clampedW = Math.max(1, Math.min(fw, bw - rx));
        const clampedH = Math.max(1, Math.min(fh, bh - ry));
        const frameKey = `${url ?? ''}#${rx},${ry},${clampedW},${clampedH}`;
        const cached = texCache.get(frameKey);
        if (cached) return cached;
        const frameTex = new PIXI.Texture(base.baseTexture, new PIXI.Rectangle(rx, ry, clampedW, clampedH));
        texCache.set(frameKey, frameTex);
        return frameTex;
    }

    function getFrameTextureByRect(url: string | null, base: PIXI.Texture, fx: number, fy: number, fw: number, fh: number): PIXI.Texture {
        const clampedW = Math.max(1, Math.min(fw, base.baseTexture.realWidth  - fx));
        const clampedH = Math.max(1, Math.min(fh, base.baseTexture.realHeight - fy));
        const frameKey = `${url ?? ''}#${fx},${fy},${clampedW},${clampedH}`;
        const cached = texCache.get(frameKey);
        if (cached) return cached;
        const frameTex = new PIXI.Texture(base.baseTexture, new PIXI.Rectangle(Math.max(0, fx), Math.max(0, fy), clampedW, clampedH));
        texCache.set(frameKey, frameTex);
        return frameTex;
    }

    // ── Background management ─────────────────────────────────────────────────

    function addBackground(): void {
        const bg: NyxBackground = {
            uid:         crypto.randomUUID(),
            textureUid:  '',
            depth:       0,
            x:           0,
            y:           0,
            parallaxX:   1,
            parallaxY:   1,
            movementX:   0,
            movementY:   0,
            repeatX:     true,
            repeatY:     true,
        };
        updateAsset<NyxRoom>(asset.uid, 'room', {
            backgrounds: [...liveRoom.backgrounds, bg],
        });
        signals.emit('assetChanged');
    }

    function removeBackground(bgUid: string): void {
        updateAsset<NyxRoom>(asset.uid, 'room', {
            backgrounds: liveRoom.backgrounds.filter(b => b.uid !== bgUid),
        });
        signals.emit('assetChanged');
    }

    function updateBackground<K extends keyof NyxBackground>(bgUid: string, key: K, value: NyxBackground[K]): void {
        updateAsset<NyxRoom>(asset.uid, 'room', {
            backgrounds: liveRoom.backgrounds.map(b =>
                b.uid === bgUid ? { ...b, [key]: value } : b
            ),
        });
        signals.emit('assetChanged');
    }

    // ── Copy property inspector ───────────────────────────────────────────────

    // The single selected copy (or null for multi/none)
    const singleSelectedCopy = $derived(
        selectedCopyUids.size === 1
            ? liveRoom.copies.find(c => c.uid === [...selectedCopyUids][0]) ?? null
            : null
    );

    function updateSelectedCopies<K extends keyof NyxCopy>(key: K, value: NyxCopy[K]): void {
        updateAsset<NyxRoom>(asset.uid, 'room', {
            copies: liveRoom.copies.map(c =>
                selectedCopyUids.has(c.uid) ? { ...c, [key]: value } : c
            ),
        });
        signals.emit('assetChanged');
    }

    function updateCopyExtend(uid: string, key: string, rawValue: string): void {
        let parsed: unknown;
        try { parsed = JSON.parse(rawValue); } catch { parsed = rawValue; }
        updateAsset<NyxRoom>(asset.uid, 'room', {
            copies: liveRoom.copies.map(c => {
                if (c.uid !== uid) return c;
                return { ...c, extends: { ...(c.extends ?? {}), [key]: parsed } };
            }),
        });
        signals.emit('assetChanged');
    }

    function renameCopyExtend(uid: string, oldKey: string, newKey: string): void {
        updateAsset<NyxRoom>(asset.uid, 'room', {
            copies: liveRoom.copies.map(c => {
                if (c.uid !== uid) return c;
                const exts = { ...(c.extends ?? {}) };
                exts[newKey.trim()] = exts[oldKey];
                delete exts[oldKey];
                return { ...c, extends: exts };
            }),
        });
        signals.emit('assetChanged');
    }

    function deleteCopyExtend(uid: string, key: string): void {
        updateAsset<NyxRoom>(asset.uid, 'room', {
            copies: liveRoom.copies.map(c => {
                if (c.uid !== uid) return c;
                const exts = { ...(c.extends ?? {}) };
                delete exts[key];
                return { ...c, extends: exts };
            }),
        });
        signals.emit('assetChanged');
    }

    function addCopyExtend(uid: string): void {
        const copy = liveRoom.copies.find(c => c.uid === uid);
        if (!copy) return;
        const exts = { ...(copy.extends ?? {}) };
        let key = 'prop';
        let n = 1;
        while (key in exts) key = `prop${n++}`;
        updateAsset<NyxRoom>(asset.uid, 'room', {
            copies: liveRoom.copies.map(c =>
                c.uid === uid ? { ...c, extends: { ...exts, [key]: '' } } : c
            ),
        });
        signals.emit('assetChanged');
    }

    function deleteSelected(): void {
        if (selectedCopyUids.size === 0) return;
        updateAsset<NyxRoom>(asset.uid, 'room', {
            copies: liveRoom.copies.filter(c => !selectedCopyUids.has(c.uid)),
        });
        selectedCopyUids = new Set();
        signals.emit('assetChanged');
    }

    function onHandlePointerDown(e: PointerEvent, copyUid: string, handle: HandleType): void {
        e.stopPropagation();
        const copy = liveRoom.copies.find(c => c.uid === copyUid);
        if (!copy) return;
        const project = get(currentProject);
        const tmpl    = getTemplate(copy.templateUid);
        const texData = tmpl?.textureUid
            ? project?.textures.find(t => t.uid === tmpl.textureUid)
            : null;
        const fw = texData?.width  ?? 32;
        const fh = texData?.height ?? 32;
        const ax = texData?.axis[0] ?? 0.5;
        const ay = texData?.axis[1] ?? 0.5;
        pushAssetUndoSnapshot(asset.uid);
        const { x: smx, y: smy } = screenToWorld(e.clientX, e.clientY);
        handleDrag = {
            copyUid, handle,
            startClientX:    e.clientX,
            startClientY:    e.clientY,
            origX:           copy.x,
            origY:           copy.y,
            origScaleX:      copy.scaleX  ?? 1,
            origScaleY:      copy.scaleY  ?? 1,
            origAngle:       copy.angle   ?? 0,
            origFw: fw, origFh: fh, origAx: ax, origAy: ay,
            startWorldAngle: Math.atan2(smy - copy.y, smx - copy.x) * 180 / Math.PI,
        };
        if (stageEl) stageEl.setPointerCapture(e.pointerId);
    }

    function onTileHandlePointerDown(e: PointerEvent, layerIdx: number, tileIdx: number, handle: HandleType): void {
        e.stopPropagation();
        const tile = liveRoom.tiles?.[layerIdx]?.tiles[tileIdx];
        if (!tile) return;
        const project = get(currentProject);
        const texData = project?.textures.find(t => t.uid === tile.texture);
        const fw = texData?.width  ?? 32;
        const fh = texData?.height ?? 32;
        pushAssetUndoSnapshot(asset.uid);
        const { x: smx, y: smy } = screenToWorld(e.clientX, e.clientY);
        tileHandleDrag = {
            layerIdx, tileIdx, handle,
            startClientX:    e.clientX,
            startClientY:    e.clientY,
            origX:           tile.x,
            origY:           tile.y,
            origScaleX:      tile.scale?.x ?? 1,
            origScaleY:      tile.scale?.y ?? 1,
            origRotation:    tile.rotation ?? 0,
            origFw: fw, origFh: fh,
            startWorldAngle: Math.atan2(smy - (tile.y + fh * (tile.scale?.y ?? 1) * 0.5), smx - (tile.x + fw * (tile.scale?.x ?? 1) * 0.5)) * 180 / Math.PI,
            allOrigPositions: selectedTiles.map(st => {
                const t = liveRoom.tiles?.[st.layerIdx]?.tiles[st.tileIdx];
                return { layerIdx: st.layerIdx, tileIdx: st.tileIdx, origX: t?.x ?? 0, origY: t?.y ?? 0 };
            }),
        };
        if (stageEl) stageEl.setPointerCapture(e.pointerId);
    }

    function eraseCopy(uid: string): void {
        updateAsset<NyxRoom>(asset.uid, 'room', {
            copies: liveRoom.copies.filter(c => c.uid !== uid),
        });
        if (selectedCopyUids.has(uid)) {
            const s = new Set(selectedCopyUids);
            s.delete(uid);
            selectedCopyUids = s;
        }
        signals.emit('assetChanged');
    }

    /** Returns the shared value for a copy field across all selected copies,
     *  or undefined if they differ (multi-selection "multiple values" case). */
    function multiVal<K extends keyof NyxCopy>(key: K): NyxCopy[K] | undefined {
        const selected = liveRoom.copies.filter(c => selectedCopyUids.has(c.uid));
        if (selected.length === 0) return undefined;
        const first = selected[0][key];
        return selected.every(c => c[key] === first) ? first : undefined;
    }

    // ── Transform handle data (screen-space, axis-aligned) ────────────────────

    type CopyHandleInfo = {
        uid: string; px: number; py: number; pw: number; ph: number;
        cx: number; cy: number;
    };

    const copyHandleData = $derived<CopyHandleInfo[]>(
        (activeTab !== 'code' && activeTool === 'select')
            ? liveRoom.copies
                .filter(c => selectedCopyUids.has(c.uid))
                .map((c): CopyHandleInfo | null => {
                    const tmpl    = templates.find(t => t.uid === c.templateUid);
                    const texData = tmpl?.textureUid
                        ? ($currentProject?.textures ?? []).find(t => t.uid === tmpl.textureUid)
                        : null;
                    const fw  = texData?.width  ?? 32;
                    const fh  = texData?.height ?? 32;
                    const ax  = texData?.axis[0] ?? 0.5;
                    const ay  = texData?.axis[1] ?? 0.5;
                    const sx  = c.scaleX ?? 1;
                    const sy  = c.scaleY ?? 1;
                    const sw  = fw * Math.abs(sx);
                    const sh  = fh * Math.abs(sy);
                    const visLeft = sx >= 0 ? c.x - ax * sw : c.x - (1 - ax) * sw;
                    const visTop  = sy >= 0 ? c.y - ay * sh : c.y - (1 - ay) * sh;
                    return {
                        uid: c.uid,
                        px: visLeft * camZoom + camX,
                        py: visTop  * camZoom + camY,
                        pw: sw * camZoom,
                        ph: sh * camZoom,
                        cx: c.x * camZoom + camX,
                        cy: c.y * camZoom + camY,
                    };
                })
                .filter((h): h is CopyHandleInfo => h !== null)
            : []
    );

    type TileHandleInfo = {
        layerIdx: number; tileIdx: number;
        px: number; py: number; pw: number; ph: number;
        cx: number; cy: number;
        rotation: number;
    };

    const tileHandleData = $derived<TileHandleInfo[]>(
        selectedTiles.flatMap((st): TileHandleInfo[] => {
            const layer = liveRoom.tiles?.[st.layerIdx];
            if (!layer) return [];
            const tile    = layer.tiles[st.tileIdx];
            if (!tile) return [];
            const texData = ($currentProject?.textures ?? []).find(t => t.uid === tile.texture);
            const fw  = texData?.width  ?? 32;
            const fh  = texData?.height ?? 32;
            const tsx = tile.scale?.x ?? 1;
            const tsy = tile.scale?.y ?? 1;
            const sw  = fw * Math.abs(tsx);
            const sh  = fh * Math.abs(tsy);
            const visLeft = tsx >= 0 ? tile.x : tile.x - sw;
            const visTop  = tsy >= 0 ? tile.y : tile.y - sh;
            return [{
                layerIdx: st.layerIdx,
                tileIdx:  st.tileIdx,
                px: visLeft * camZoom + camX,
                py: visTop  * camZoom + camY,
                pw: sw * camZoom,
                ph: sh * camZoom,
                cx: (visLeft + sw / 2) * camZoom + camX,
                cy: (visTop  + sh / 2) * camZoom + camY,
                rotation: tile.rotation ?? 0,
            }];
        })
    );

    const RESERVED_COPY_PROPS = new Set([
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

    function uiPlaceholder(w: number, h: number): PIXI.Graphics {
        const g = new PIXI.Graphics();
        g.lineStyle(1, 0xaaaaaa, 0.5);
        g.beginFill(0x333333, 0.4);
        g.drawRect(0, 0, w, h);
        g.endFill();
        return g;
    }

    /**
     * Build the ancestor chain [widget, parent, grandparent, ..., root] for a given UID.
     * Returns null if the UID is unknown or a cycle is detected.
     */
    function buildAncestorChain(uid: string): import('@nyx/shared').NyxUIWidget[] | null {
        const widgets = getFreshActiveWidgets();
        const chain: import('@nyx/shared').NyxUIWidget[] = [];
        const visited = new Set<string>();
        let cur: string | undefined = uid;
        while (cur) {
            if (visited.has(cur)) return null; // cycle — bail out safely
            visited.add(cur);
            const w = widgets.find(x => x.uid === cur);
            if (!w) return null;
            chain.push(w);
            cur = w.parentUid;
        }
        return chain;
    }

    /**
     * Screen-space top-left corner of a UI widget (CSS pixels relative to the stage).
     * Iterative — safe against cycles in parentUid.
     */
    // Returns the screen-space TOP-LEFT corner of a widget (for gizmo drawing).
    // x/y is now the widget's CENTER offset from its anchor, so we subtract half-size.
    function getWidgetScreenPos(uid: string): { px: number; py: number } | null {
        const chain = buildAncestorChain(uid);
        if (!chain) return null;
        let cx = 0, cy = 0; // center in screen space, accumulated through the chain
        for (let i = chain.length - 1; i >= 0; i--) {
            const w = chain[i];
            if (i === chain.length - 1) {
                // Root: anchor base in room space → center
                cx = (anchorFracX(w.anchor) * liveRoom.width  + w.x) * camZoom + camX;
                cy = (anchorFracY(w.anchor) * liveRoom.height + w.y) * camZoom + camY;
            } else {
                const parent = chain[i + 1];
                // Parent top-left = parent center − parent.size/2
                const plx = cx - parent.width  * camZoom / 2;
                const ply = cy - parent.height * camZoom / 2;
                cx = plx + (anchorFracX(w.anchor) * parent.width  + w.x) * camZoom;
                cy = ply + (anchorFracY(w.anchor) * parent.height + w.y) * camZoom;
            }
        }
        // Return the top-left of the innermost widget
        const leaf = chain[0];
        return { px: cx - leaf.width * camZoom / 2, py: cy - leaf.height * camZoom / 2 };
    }

    /**
     * World-space position of a widget's top-left corner (no camera transform).
     * Iterative — safe against cycles in parentUid.
     */
    // Returns the world-space CENTER of a widget (for reparenting math).
    function getWidgetWorldPos(uid: string): { x: number; y: number } | null {
        const chain = buildAncestorChain(uid);
        if (!chain) return null;
        let cx = 0, cy = 0;
        for (let i = chain.length - 1; i >= 0; i--) {
            const w = chain[i];
            if (i === chain.length - 1) {
                cx = anchorFracX(w.anchor) * liveRoom.width  + w.x;
                cy = anchorFracY(w.anchor) * liveRoom.height + w.y;
            } else {
                const parent = chain[i + 1];
                const plx = cx - parent.width  / 2;
                const ply = cy - parent.height / 2;
                cx = plx + anchorFracX(w.anchor) * parent.width  + w.x;
                cy = ply + anchorFracY(w.anchor) * parent.height + w.y;
            }
        }
        return { x: cx, y: cy }; // CENTER in world space
    }

    /**
     * World-space rotation of a widget in degrees (sum of ancestor rotations + own).
     * Iterative — safe against cycles in parentUid.
     */
    function getWidgetWorldRotation(uid: string): number {
        const chain = buildAncestorChain(uid);
        if (!chain) return 0;
        return chain.reduce((sum, w) => sum + (w.rotation ?? 0), 0);
    }

    function reparentWidgetKeepWorld(widgetUid: string, newParentUid: string | undefined): void {
        const widgets = getFreshActiveWidgets();
        const w = widgets.find(ww => ww.uid === widgetUid);
        if (!w) return;

        const worldPos = getWidgetWorldPos(widgetUid);
        const worldRot = getWidgetWorldRotation(widgetUid);
        if (worldPos === null) return;

        let newX: number;
        let newY: number;
        let newRot: number;

        if (newParentUid) {
            const newParent = widgets.find(p => p.uid === newParentUid);
            if (!newParent) return;
            const parentWorldPos = getWidgetWorldPos(newParentUid);
            const parentWorldRot = getWidgetWorldRotation(newParentUid);
            if (parentWorldPos === null) return;
            // worldPos and parentWorldPos are both centers.
            // child.x = childCenter - (parentCenter - parent.size/2) - anchorFrac * parent.size
            newX   = worldPos.x - (parentWorldPos.x - newParent.width  / 2) - anchorFracX(w.anchor) * newParent.width;
            newY   = worldPos.y - (parentWorldPos.y - newParent.height / 2) - anchorFracY(w.anchor) * newParent.height;
            newRot = worldRot - parentWorldRot;
        } else {
            newX   = worldPos.x - anchorFracX(w.anchor) * liveRoom.width;
            newY   = worldPos.y - anchorFracY(w.anchor) * liveRoom.height;
            newRot = worldRot;
        }

        const newWidgets = widgets.map(ww =>
            ww.uid === widgetUid
                ? { ...ww, parentUid: newParentUid, x: newX, y: newY, rotation: newRot } as NyxUIWidget
                : ww
        );
        if (activeUiLayerUid) updateAsset<NyxUILayer>(activeUiLayerUid, 'uiLayer', { widgets: newWidgets });
        signals.emit('assetChanged');
    }

    /**
     * Build a PixiJS container for a UI widget for the editor preview.
     * @param refW  Anchor reference width  — parent.width for children, screen width for roots.
     * @param refH  Anchor reference height — parent.height for children, screen height for roots.
     */
    function buildEditorWidget(w: NyxUIWidget, W: number, H: number, refW?: number, refH?: number): PIXI.Container {
        const { bx, by } = anchorBasePixels(w.anchor, refW ?? W, refH ?? H);
        const ctr = new PIXI.Container();
        // x/y is the widget's CENTER offset from the anchor point.
        ctr.x        = bx + w.x;
        ctr.y        = by + w.y;
        ctr.pivot.set(w.width / 2, w.height / 2);
        ctr.rotation = (w.rotation ?? 0) * Math.PI / 180;
        ctr.alpha    = w.visible ? w.alpha : Math.min(w.alpha, 0.25);
        ctr.name     = w.uid;

        switch (w.type) {
            case 'panel': {
                const g = new PIXI.Graphics();
                if (w.borderWidth > 0) g.lineStyle(w.borderWidth, hexToPixi(w.borderColor), hexAlphaPixi(w.borderColor));
                g.beginFill(hexToPixi(w.backgroundColor), hexAlphaPixi(w.backgroundColor));
                g.drawRoundedRect(0, 0, w.width, w.height, w.borderRadius);
                g.endFill();
                ctr.addChild(g);
                break;
            }
            case 'label': {
                const t = new PIXI.Text(w.text, {
                    fontSize:   w.fontSize,
                    fill:       w.color,
                    fontFamily: w.fontFamily || 'sans-serif',
                    fontWeight: w.bold   ? 'bold'   : 'normal',
                    fontStyle:  w.italic ? 'italic' : 'normal',
                    align:      w.align,
                } as PIXI.TextStyle);
                ctr.addChild(t);
                break;
            }
            case 'button': {
                const g = new PIXI.Graphics();
                g.beginFill(hexToPixi(w.backgroundColor), hexAlphaPixi(w.backgroundColor));
                g.drawRoundedRect(0, 0, w.width, w.height, w.borderRadius);
                g.endFill();
                const t = new PIXI.Text(w.text, {
                    fontSize:   w.fontSize,
                    fill:       w.textColor,
                    fontFamily: w.fontFamily || 'sans-serif',
                    fontWeight: 'bold',
                } as PIXI.TextStyle);
                t.anchor.set(0.5, 0.5);
                t.x = w.width  / 2;
                t.y = w.height / 2;
                ctr.addChild(g);
                ctr.addChild(t);
                break;
            }
            case 'image': {
                if (w.textureUid) {
                    const texData = get(currentProject)?.textures.find(t => t.uid === w.textureUid);
                    const url     = texData?.origname ? getTexUrl(texData.origname) : null;
                    const pixiTex = url ? texCache.get(url) : null;
                    if (pixiTex?.valid && texData) {
                        const sprite = new PIXI.Sprite(pixiTex);
                        sprite.tint  = hexToPixi(w.tint);
                        if (w.keepAspect) {
                            const scale = Math.min(w.width / pixiTex.width, w.height / pixiTex.height);
                            sprite.scale.set(scale);
                        } else {
                            sprite.width  = w.width;
                            sprite.height = w.height;
                        }
                        ctr.addChild(sprite);
                    } else {
                        ctr.addChild(uiPlaceholder(w.width, w.height));
                    }
                } else {
                    ctr.addChild(uiPlaceholder(w.width, w.height));
                }
                break;
            }
            case 'progressbar': {
                const bg = new PIXI.Graphics();
                bg.beginFill(hexToPixi(w.backgroundColor), hexAlphaPixi(w.backgroundColor));
                bg.drawRoundedRect(0, 0, w.width, w.height, w.borderRadius);
                bg.endFill();
                const fill = new PIXI.Graphics();
                fill.beginFill(hexToPixi(w.fillColor), hexAlphaPixi(w.fillColor));
                const clamped = Math.max(0, Math.min(1, w.value));
                if (w.direction === 'horizontal') {
                    fill.drawRoundedRect(0, 0, w.width * clamped, w.height, w.borderRadius);
                } else {
                    const fh = w.height * clamped;
                    fill.drawRoundedRect(0, w.height - fh, w.width, fh, w.borderRadius);
                }
                fill.endFill();
                ctr.addChild(bg);
                ctr.addChild(fill);
                break;
            }
        }
        // Drop shadow (mirrors runtime ui.ts logic)
        if (w.shadow?.enabled) {
            const s = w.shadow;
            const sg = new PIXI.Graphics();
            const radius = 'borderRadius' in w ? (w as { borderRadius: number }).borderRadius : 0;
            sg.beginFill(hexToPixi(s.color), hexAlphaPixi(s.color));
            if (radius > 0) {
                sg.drawRoundedRect(0, 0, w.width, w.height, radius);
            } else {
                sg.drawRect(0, 0, w.width, w.height);
            }
            sg.endFill();
            sg.x = s.offsetX;
            sg.y = s.offsetY;
            if (s.blur > 0) {
                sg.filters = [new PIXI.filters.BlurFilter(s.blur * 0.5)];
            }
            ctr.addChildAt(sg, 0);
        }

        ctr.eventMode = 'static' as unknown as PIXI.EventMode;
        ctr.cursor    = 'pointer';
        ctr.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
            if (activeTab === 'ui') {
                if (e.shiftKey) {
                    const s = new Set(selectedWidgetUids);
                    if (s.has(w.uid)) s.delete(w.uid); else s.add(w.uid);
                    selectedWidgetUids = s;
                } else {
                    selectedWidgetUids = new Set([w.uid]);
                }
            }
        });
        return ctr;
    }

    // ── Light-preview shadow-casting helpers (pure math, no runtime deps) ─────

    const _LEPS = 1e-5;

    function _raySegDist(
        ox: number, oy: number, dx: number, dy: number,
        ax: number, ay: number, bx: number, by: number,
    ): number {
        const sdx = bx - ax, sdy = by - ay;
        const denom = dx * sdy - dy * sdx;
        if (Math.abs(denom) < _LEPS) return Infinity;
        const t2 = (dx * (oy - ay) - dy * (ox - ax)) / denom;
        if (t2 < -_LEPS || t2 > 1 + _LEPS) return Infinity;
        const t1 = Math.abs(dx) > Math.abs(dy)
            ? ((ax - ox) + sdx * t2) / dx
            : ((ay - oy) + sdy * t2) / dy;
        return t1 > -_LEPS ? t1 : Infinity;
    }

    function _castRay(
        ox: number, oy: number, angle: number, radius: number, segs: number[],
    ): { x: number; y: number } {
        const dx = Math.cos(angle), dy = Math.sin(angle);
        let nearest = radius;
        for (let i = 0; i < segs.length; i += 4) {
            const t = _raySegDist(ox, oy, dx, dy, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
            if (t < nearest) nearest = t;
        }
        return { x: ox + dx * nearest, y: oy + dy * nearest };
    }

    function _pushAABB(segs: number[], l: number, t: number, r: number, b: number): void {
        segs.push(l, t, r, t,  r, t, r, b,  r, b, l, b,  l, b, l, t);
    }

    /**
     * Compute a visibility (shadow) polygon for a point emitter at (ox, oy)
     * with the given radius, against the provided AABB segments.
     * Returns a flat [x0,y0, x1,y1, ...] array sorted by angle.
     */
    function _visibilityPoly(ox: number, oy: number, radius: number, segs: number[]): number[] {
        const angles: number[] = [];
        for (let i = 0; i < segs.length; i += 4) {
            for (let e = 0; e <= 2; e += 2) {
                const a = Math.atan2(segs[i + e + 1] - oy, segs[i + e] - ox);
                angles.push(a - _LEPS, a, a + _LEPS);
            }
        }
        const MIN_RAYS = 128;
        for (let i = 0; i < MIN_RAYS; i++) {
            angles.push((Math.PI * 2 / MIN_RAYS) * i - Math.PI);
        }
        angles.sort((a, b) => a - b);
        const pts: number[] = [];
        for (const angle of angles) {
            const p = _castRay(ox, oy, angle, radius, segs);
            pts.push(p.x, p.y);
        }
        return pts;
    }

    /**
     * Cached gradient textures for the light preview (keyed by shape string).
     * Persists across buildScene calls — destroyed only when the PIXI app is torn down.
     */
    const _gradTexCache = new Map<string, PIXI.Texture>();

    /**
     * Get (or create) a soft-radial or oblong capsule gradient texture.
     * Mirrors light.getDefaultTexture('soft') and light.getOblongTexture(aspect)
     * from the runtime so the editor preview matches the in-game look exactly.
     */
    function _getGradTex(aspect: number): PIXI.Texture {
        const key = aspect === 1 ? 'soft'
            : 'oblong_' + (Math.round(aspect * 20) / 20).toFixed(2);
        const cached = _gradTexCache.get(key);
        if (cached) return cached;

        const SIZE = 512, half = SIZE / 2;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext('2d')!;

        if (aspect === 1) {
            // Soft area-light radial gradient (matches runtime 'soft' shape)
            const g = ctx.createRadialGradient(half, half, 0, half, half, half);
            g.addColorStop(0,    'rgba(255,255,255,1)');
            g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
            g.addColorStop(0.65, 'rgba(255,255,255,0.4)');
            g.addColorStop(0.85, 'rgba(255,255,255,0.1)');
            g.addColorStop(1,    'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, SIZE, SIZE);
        } else {
            // Oblong capsule gradient — ported from light.getOblongTexture
            let ax: number, ay: number, bx: number, by: number, capR: number;
            if (aspect <= 1) {          // tall / square — long axis is Y
                capR = half * aspect;
                const hl = Math.max(0, half - capR);
                ax = half; ay = half - hl; bx = half; by = half + hl;
            } else {                    // wide — long axis is X
                capR = half / aspect;
                const hl = Math.max(0, half - capR);
                ax = half - hl; ay = half; bx = half + hl; by = half;
            }
            const baxc = bx - ax, bayc = by - ay;
            const lenSq = baxc * baxc + bayc * bayc;
            const img = ctx.createImageData(SIZE, SIZE);
            const d = img.data;
            for (let py = 0; py < SIZE; py++) {
                for (let px = 0; px < SIZE; px++) {
                    const pax = px - ax, pay = py - ay;
                    const t = lenSq > 0
                        ? Math.max(0, Math.min(1, (pax * baxc + pay * bayc) / lenSq)) : 0;
                    const dxx = pax - baxc * t, dyy = pay - bayc * t;
                    const nd = Math.sqrt(dxx * dxx + dyy * dyy) / capR;
                    let alpha: number;
                    if      (nd <= 0.35) alpha = 1.00 - 0.15 * (nd          / 0.35);
                    else if (nd <= 0.65) alpha = 0.85 - 0.45 * ((nd - 0.35) / 0.30);
                    else if (nd <= 0.85) alpha = 0.40 - 0.30 * ((nd - 0.65) / 0.20);
                    else if (nd <= 1.00) alpha = 0.10 - 0.10 * ((nd - 0.85) / 0.15);
                    else                 alpha = 0;
                    const i = (py * SIZE + px) * 4;
                    d[i] = d[i + 1] = d[i + 2] = 255;
                    d[i + 3] = Math.round(Math.max(0, alpha) * 255);
                }
            }
            ctx.putImageData(img, 0, 0);
        }
        const tex = PIXI.Texture.from(canvas);
        tex.defaultAnchor.set(0.5, 0.5);
        _gradTexCache.set(key, tex);
        return tex;
    }

    /**
     * Build a screen-space lightmap and composite it onto the stage via MULTIPLY.
     *
     * Why screen-space?  The room canvas may be smaller than the editor window and
     * panning/zooming must keep lights locked to world positions.  Rendering in
     * screen-space (camX + roomX * camZoom) gives correct coverage for both.
     *
     * Light rendering mirrors the runtime:
     *   • Each emitter uses a soft-radial or oblong gradient texture (SCREEN blend).
     *   • Shadow-casting emitters clip the gradient through a visibility-polygon mask.
     *   • The accumulated lightLayer is composited onto the scene with MULTIPLY.
     */
    function drawLightPreview(stage: PIXI.Container): void {
        if (!editorLightPreview || !pixiApp) return;
        const project = get(currentProject);
        if (!('light' in (project?.modules ?? {}))) return;

        const W = pixiApp.screen.width;
        const H = pixiApp.screen.height;

        // Room-space → screen-space helpers
        const toSx = (rx: number) => camX + rx * camZoom;
        const toSy = (ry: number) => camY + ry * camZoom;

        // ── 1. Blocker segments (screen-space AABBs) ─────────────────────────
        const blockerSegs: number[] = [];

        for (const copy of liveRoom.copies) {
            const tmpl = getTemplate(copy.templateUid);
            if (!tmpl?.light?.lightBlocker) continue;
            const texData = tmpl.textureUid
                ? project?.textures.find(t => t.uid === tmpl.textureUid)
                : null;
            const fw = texData?.width  ?? 32;
            const fh = texData?.height ?? 32;
            const ax = texData?.axis[0] ?? 0.5;
            const ay = texData?.axis[1] ?? 0.5;
            const sw = fw * Math.abs(copy.scaleX ?? 1);
            const sh = fh * Math.abs(copy.scaleY ?? 1);
            _pushAABB(blockerSegs,
                toSx(copy.x - ax * sw), toSy(copy.y - ay * sh),
                toSx(copy.x - ax * sw + sw), toSy(copy.y - ay * sh + sh),
            );
        }

        for (const layer of liveRoom.tiles ?? []) {
            if (layer.hidden) continue;
            for (const tile of layer.tiles) {
                if (!layer.lightBlocker && !tile.lightBlocker) continue;
                const texData = project?.textures.find(t => t.uid === tile.texture);
                const fw  = texData?.width  ?? 32;
                const fh  = texData?.height ?? 32;
                const tsx = Math.abs(tile.scale?.x ?? 1);
                const tsy = Math.abs(tile.scale?.y ?? 1);
                const rot = ((tile.rotation ?? 0) * Math.PI) / 180;
                const cos = Math.cos(rot), sin = Math.sin(rot);
                const hw  = fw * tsx * 0.5, hh = fh * tsy * 0.5;
                const cx  = tile.x + fw * tsx * 0.5;
                const cy  = tile.y + fh * tsy * 0.5;
                const corners = ([ [-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh] ] as [number,number][])
                    .map(([lx, ly]) => ({
                        x: toSx(cx + lx * cos - ly * sin),
                        y: toSy(cy + lx * sin + ly * cos),
                    }));
                _pushAABB(blockerSegs,
                    Math.min(...corners.map(c => c.x)), Math.min(...corners.map(c => c.y)),
                    Math.max(...corners.map(c => c.x)), Math.max(...corners.map(c => c.y)),
                );
            }
        }

        // ── 2. Emitters (screen-space position + radius) ─────────────────────
        interface Emitter {
            sx: number; sy: number;
            color: number;
            radius: number;  // screen-space radius (already * camZoom)
            shadows: boolean;
            aspect: number;  // w/h for oblong gradient; 1 for copies
        }
        const emitters: Emitter[] = [];

        for (const copy of liveRoom.copies) {
            const tmpl = getTemplate(copy.templateUid);
            if (!tmpl?.light?.isEmitter) continue;
            const rawCol = parseInt((tmpl.light.color ?? '#ffffff').replace('#', ''), 16);
            emitters.push({
                sx: toSx(copy.x), sy: toSy(copy.y),
                color:   isNaN(rawCol) ? 0xffffff : rawCol,
                radius:  (tmpl.light.lightRadius ?? 300) * (tmpl.light.scale ?? 1) * camZoom,
                shadows: tmpl.light.lightCastShadows ?? false,
                aspect:  1,
            });
        }

        for (const layer of liveRoom.tiles ?? []) {
            if (layer.hidden) continue;
            for (const tile of layer.tiles) {
                if (!(tile.lightEmitter ?? layer.lightEmitter)) continue;
                const texData = project?.textures.find(t => t.uid === tile.texture);
                const fw  = texData?.width  ?? 32;
                const fh  = texData?.height ?? 32;
                const tsx = tile.scale?.x ?? 1;
                const tsy = tile.scale?.y ?? 1;
                const rawCol = parseInt(
                    (tile.lightEmitterColor ?? layer.lightEmitterColor ?? '#ffffff').replace('#', ''), 16
                );
                const tileAspect = (fw * Math.abs(tsx)) / (fh * Math.abs(tsy));
                emitters.push({
                    sx:      toSx(tile.x + fw * tsx * 0.5),
                    sy:      toSy(tile.y + fh * tsy * 0.5),
                    color:   isNaN(rawCol) ? 0xffffff : rawCol,
                    radius:  (tile.lightRadius ?? layer.lightRadius ?? 300)
                             * (tile.lightEmitterScale ?? layer.lightEmitterScale ?? 1) * camZoom,
                    shadows: tile.lightCastShadows ?? layer.lightCastShadows ?? false,
                    aspect:  tileAspect,
                });
            }
        }

        // ── 3. Build screen-sized lightmap render texture ─────────────────────
        lightOverlayTex = PIXI.RenderTexture.create({ width: W, height: H });

        // Ambient darkness fill — uses the room's lightAmbientColor setting
        const darkG = new PIXI.Graphics();
        darkG.beginFill(hexToPixi(lightAmbientColor), 1);
        darkG.drawRect(0, 0, W, H);
        darkG.endFill();
        pixiApp.renderer.render(darkG, { renderTexture: lightOverlayTex, clear: true });
        darkG.destroy();

        // Each emitter: gradient sprite (SCREEN blend) optionally clipped by visibility mask
        const GRAD_HALF = 256; // gradient texture is 512×512, anchor at centre (256,256)
        for (const em of emitters) {
            const gradScale = em.radius / GRAD_HALF;
            const tex = _getGradTex(em.aspect);

            if (em.shadows && blockerSegs.length > 0) {
                // Shadow-cast: clip gradient to the lit visibility polygon via a stencil mask
                const poly = _visibilityPoly(em.sx, em.sy, em.radius, blockerSegs);
                if (poly.length < 4) continue;

                const maskGfx = new PIXI.Graphics();
                maskGfx.beginFill(0xffffff, 1);
                maskGfx.drawPolygon(poly);
                maskGfx.endFill();

                const grad = new PIXI.Sprite(tex);
                grad.blendMode = PIXI.BLEND_MODES.SCREEN;
                grad.anchor.set(0.5, 0.5);
                grad.x = em.sx; grad.y = em.sy;
                grad.scale.set(gradScale);
                grad.tint = em.color;
                grad.mask = maskGfx;

                const tmp = new PIXI.Container();
                tmp.addChild(maskGfx);
                tmp.addChild(grad);
                pixiApp.renderer.render(tmp, { renderTexture: lightOverlayTex, clear: false });
                grad.mask = null;
                tmp.destroy({ children: true });
            } else {
                // No shadows: just a gradient sprite at the emitter position
                const grad = new PIXI.Sprite(tex);
                grad.blendMode = PIXI.BLEND_MODES.SCREEN;
                grad.anchor.set(0.5, 0.5);
                grad.x = em.sx; grad.y = em.sy;
                grad.scale.set(gradScale);
                grad.tint = em.color;
                pixiApp.renderer.render(grad, { renderTexture: lightOverlayTex, clear: false });
                grad.destroy();
            }
        }

        // ── 4. Composite lightmap over the full stage via MULTIPLY ────────────
        const lightSprite = new PIXI.Sprite(lightOverlayTex);
        lightSprite.blendMode = PIXI.BLEND_MODES.MULTIPLY;
        lightSprite.alpha = lightAmbientOpacity;
        stage.addChild(lightSprite);
    }

    function buildScene(): void {
        if (!pixiApp) return;
        const project = get(currentProject);
        const stage   = pixiApp.stage;
        // Destroy the previous lightmap render texture (not in texCache, must be freed manually).
        if (lightOverlayTex) { lightOverlayTex.destroy(true); lightOverlayTex = null; }
        // Destroy old display objects to free GPU geometry buffers; texture:false
        // preserves the base textures that are reused via texCache.
        for (const child of stage.removeChildren()) child.destroy({ children: true, texture: false });
        stage.eventMode = 'static' as unknown as PIXI.EventMode;

        // ── Full-canvas background — room bg color fills the whole editor area ──
        const fullBg = new PIXI.Graphics();
        fullBg.beginFill(hexToPixi(liveRoom.backgroundColor));
        fullBg.drawRect(0, 0, pixiApp.screen.width, pixiApp.screen.height);
        fullBg.endFill();
        stage.addChild(fullBg);

        const cam = new PIXI.Container();
        cam.x = camX;
        cam.y = camY;
        cam.scale.set(camZoom);
        stage.addChild(cam);

        // ── Solid background fill for room area ──────────────────────────────
        const bgFill = new PIXI.Graphics();
        bgFill.beginFill(hexToPixi(liveRoom.backgroundColor));
        bgFill.drawRect(0, 0, liveRoom.width, liveRoom.height);
        bgFill.endFill();
        cam.addChild(bgFill);

        // ── Grid overlay — covers the entire visible canvas, not just the room ─
        if (!disableGrid && gridX > 0 && gridY > 0) {
            const grid = new PIXI.Graphics();
            // Grid color matches boundaryBase (opposite brightness of room bg)
            const bg = hexToPixi(liveRoom.backgroundColor);
            const r = (bg >> 16) & 0xff;
            const g = (bg >> 8) & 0xff;
            const b = bg & 0xff;
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const boundaryBase = lum > 127 ? 0x000000 : 0xffffff;

            grid.lineStyle(1, boundaryBase, 0.2);

            const sw = pixiApp.screen.width;
            const sh = pixiApp.screen.height;
            // World-space extent of the visible screen
            const wx0 = Math.floor((-camX / camZoom) / gridX) * gridX - gridX;
            const wx1 = Math.ceil(((sw - camX) / camZoom) / gridX) * gridX + gridX;
            const wy0 = Math.floor((-camY / camZoom) / gridY) * gridY - gridY;
            const wy1 = Math.ceil(((sh - camY) / camZoom) / gridY) * gridY + gridY;

            if (diagonalGrid) {
                // Diamond grid: two sets of 45° lines spaced by gridX × gridY.
                // Forward  (TL→BR): y/gridY = x/gridX − k  →  y = (x/gridX − k) * gridY
                const kFMin = Math.floor(wx0 / gridX - wy1 / gridY) - 1;
                const kFMax = Math.ceil(wx1  / gridX - wy0 / gridY) + 1;
                for (let k = kFMin; k <= kFMax; k++) {
                    grid.moveTo(wx0, (wx0 / gridX - k) * gridY);
                    grid.lineTo(wx1, (wx1 / gridX - k) * gridY);
                }
                // Backward (TR→BL): y/gridY = k − x/gridX  →  y = (k − x/gridX) * gridY
                const kBMin = Math.floor(wx0 / gridX + wy0 / gridY) - 1;
                const kBMax = Math.ceil(wx1  / gridX + wy1 / gridY) + 1;
                for (let k = kBMin; k <= kBMax; k++) {
                    grid.moveTo(wx0, (k - wx0 / gridX) * gridY);
                    grid.lineTo(wx1, (k - wx1 / gridX) * gridY);
                }
            } else {
                for (let gx = wx0; gx <= wx1; gx += gridX) {
                    grid.moveTo(gx, wy0); grid.lineTo(gx, wy1);
                }
                for (let gy = wy0; gy <= wy1; gy += gridY) {
                    grid.moveTo(wx0, gy); grid.lineTo(wx1, gy);
                }
            }
            cam.addChild(grid);
        }

        // ── Backgrounds (higher depth = further back, render first) ──────────
        const sortedBgs = [...liveRoom.backgrounds].sort((a, b) => b.depth - a.depth);
        for (const bg of sortedBgs) {
            const texData = project?.textures.find(t => t.uid === bg.textureUid);
            const url     = texData?.origname ? getTexUrl(texData.origname) : null;
            const pixiTex = url ? texCache.get(url) : null;

            if (pixiTex?.valid && texData) {
                const frameTex = getFrameTexture(url, pixiTex, texData);
                const ts = new PIXI.TilingSprite(frameTex, liveRoom.width, liveRoom.height);
                ts.tilePosition.set(bg.x, bg.y);
                cam.addChild(ts);
            } else {
                // Placeholder while texture loads or when no texture assigned
                const g = new PIXI.Graphics();
                g.beginFill(0x334466, 0.45);
                g.lineStyle(1, 0x6688aa, 0.35);
                g.drawRect(0, 0, liveRoom.width, liveRoom.height);
                g.endFill();
                cam.addChild(g);
            }
        }

        // ── Tile layers (sorted low-depth-first so high-depth renders on top) ──
        const sortedTileLayers = [...(liveRoom.tiles ?? [])].sort((a, b) => a.depth - b.depth);
        for (const layer of sortedTileLayers) {
            if (layer.hidden) continue;
            for (const tile of layer.tiles) {
                const texData = project?.textures.find(t => t.uid === tile.texture);
                const url     = texData?.origname ? getTexUrl(texData.origname) : null;
                const pixiTex = url ? texCache.get(url) : null;
                if (!pixiTex?.valid || !texData) continue;

                const col = (texData.grid[0] > 0 ? tile.frame % texData.grid[0] : 0);
                const row = (texData.grid[0] > 0 ? Math.floor(tile.frame / texData.grid[0]) : 0);
                const fx  = texData.offx + col * (texData.width  + texData.marginx);
                const fy  = texData.offy + row * (texData.height + texData.marginy);
                const fw  = texData.width  || pixiTex.baseTexture.realWidth;
                const fh  = texData.height || pixiTex.baseTexture.realHeight;
                const frameTex = getFrameTextureByRect(url, pixiTex, fx, fy, fw, fh);
                const tSx = tile.scale?.x ?? 1;
                const tSy = tile.scale?.y ?? 1;
                const sp = new PIXI.Sprite(frameTex);
                sp.anchor.set(0.5, 0.5);
                sp.x        = tile.x + fw * tSx * 0.5;
                sp.y        = tile.y + fh * tSy * 0.5;
                sp.alpha    = tile.opacity ?? 1;
                sp.tint     = tile.tint ?? 0xffffff;
                sp.scale.set(tSx, tSy);
                sp.rotation = ((tile.rotation ?? 0) * Math.PI) / 180;
                cam.addChild(sp);
            }
        }

        // ── Selected tile highlights ─────────────────────────────────────────
        for (const st of selectedTiles) {
            const selLayer = liveRoom.tiles?.[st.layerIdx];
            const selTile  = selLayer?.tiles[st.tileIdx];
            if (selTile) {
                const texDataS = project?.textures.find(t => t.uid === selTile.texture);
                const sSx = selTile.scale?.x ?? 1;
                const sSy = selTile.scale?.y ?? 1;
                const sfw = texDataS?.width  ?? 32;
                const sfh = texDataS?.height ?? 32;
                const tw  = sfw * Math.abs(sSx);
                const th  = sfh * Math.abs(sSy);
                const hl  = new PIXI.Graphics();
                hl.lineStyle(2, 0xffd700, 1);
                hl.drawRect(-tw / 2 - 1, -th / 2 - 1, tw + 2, th + 2);
                hl.x        = selTile.x + sfw * sSx * 0.5;
                hl.y        = selTile.y + sfh * sSy * 0.5;
                hl.rotation = ((selTile.rotation ?? 0) * Math.PI) / 180;
                cam.addChild(hl);
            }
        }

        // ── Copies (copy.depth takes priority over template depth) ───────────
        const fallbackStyle = new PIXI.TextStyle({
            fontSize: 10,
            fill: 0xffffff,
            dropShadow: true,
            dropShadowBlur: 2,
            dropShadowDistance: 1,
            dropShadowColor: 0x000000,
        });

        const sortedCopies = [...liveRoom.copies].sort((a, b) => {
            const da = a.depth ?? getTemplate(a.templateUid)?.depth ?? 0;
            const db = b.depth ?? getTemplate(b.templateUid)?.depth ?? 0;
            return db - da;
        });

        for (const copy of sortedCopies) {
            const tmpl       = getTemplate(copy.templateUid);
            const selected   = selectedCopyUids.has(copy.uid);
            const copyRot    = ((copy.angle ?? 0) * Math.PI) / 180;
            const copySx     = copy.scaleX ?? 1;
            const copySy     = copy.scaleY ?? 1;
            const copyAlpha  = copy.alpha  ?? 1;
            const copyTint   = hexToPixi(copy.tint ?? '#ffffff');
            let spriteW = 32, spriteH = 32, anchorX = 0.5, anchorY = 0.5;
            let hasSprite = false;

            if (tmpl?.textureUid) {
                const texData = project?.textures.find(t => t.uid === tmpl.textureUid);
                const url     = texData?.origname ? getTexUrl(texData.origname) : null;
                const pixiTex = url ? texCache.get(url) : null;

                if (pixiTex?.valid && texData) {
                    const frameTex = getFrameTexture(url, pixiTex, texData);
                    const sp = new PIXI.Sprite(frameTex);
                    // axis is stored as 0-1 fraction in Nyx (directly maps to PIXI anchor)
                    anchorX = texData.axis[0];
                    anchorY = texData.axis[1];
                    sp.anchor.set(anchorX, anchorY);
                    sp.x        = copy.x;
                    sp.y        = copy.y;
                    sp.rotation = copyRot;
                    sp.scale.set(copySx, copySy);
                    sp.alpha    = copyAlpha;
                    sp.tint     = copyTint;
                    cam.addChild(sp);
                    spriteW   = frameTex.width;
                    spriteH   = frameTex.height;
                    hasSprite = true;
                }
            }

            
            if (!hasSprite) {
                // Fallback: coloured rectangle with template name label
                const color = uidToColor(copy.templateUid);
                const g = new PIXI.Graphics();
                g.beginFill(color, 0.75);
                g.drawRect(-16, -16, 32, 32);
                g.endFill();
                g.lineStyle(1, 0xffffff, 0.25);
                g.drawRect(-16, -16, 32, 32);
                g.x        = copy.x;
                g.y        = copy.y;
                g.rotation = copyRot;
                g.scale.set(copySx, copySy);
                g.alpha    = copyAlpha;
                cam.addChild(g);
                if (tmpl) {
                    const label = new PIXI.Text(tmpl.name, fallbackStyle);
                    label.anchor.set(0.5, 0);
                    label.x     = copy.x;
                    label.y     = copy.y + 18 * copySy;
                    label.alpha = copyAlpha;
                    cam.addChild(label);
                }
            }

            // Selection highlight — axis-aligned bounds scaled to copy scale
            if (selected) {
                const hl = new PIXI.Graphics();
                hl.lineStyle(2, 0x00ffff, 1);
                const sw = spriteW * Math.abs(copySx);
                const sh = spriteH * Math.abs(copySy);
                hl.drawRect(
                    copy.x - anchorX * sw - 1,
                    copy.y - anchorY * sh - 1,
                    sw + 2,
                    sh + 2
                );
                cam.addChild(hl);
            }
        }

        // ── Light preview ────────────────────────────────────────────────────
        // Rendered in screen-space and added directly to stage so darkness covers
        // the whole editor canvas, not just the room area.
        drawLightPreview(stage);

        // Editor overlay: boundary + ghost previews sit above the light preview.
        // Uses the same cam transform so room-space coords work without adjustment.
        const editorOverlay = new PIXI.Container();
        editorOverlay.x = camX; editorOverlay.y = camY; editorOverlay.scale.set(camZoom);
        stage.addChild(editorOverlay);

        // ── Room boundary outline ────────────────────────────────────────────
        // Keep boundary/grid contrast even when the room background is similar.
        // We choose a boundary color opposite in brightness to the room background.
        const border = new PIXI.Graphics();

        const bg = hexToPixi(liveRoom.backgroundColor);
        const r = (bg >> 16) & 0xff;
        const g = (bg >> 8) & 0xff;
        const b = bg & 0xff;
        // Perceived luminance (sRGB) in [0..255]
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const boundaryBase = lum > 127 ? 0x000000 : 0xffffff;

        // // Soft fill to separate from grid/background.
        // border.beginFill(boundaryBase, 0.18);
        // border.drawRect(0, 0, liveRoom.width, liveRoom.height);
        // border.endFill();

        // Strong outline on top.
        border.lineStyle(1, boundaryBase, 0.9);
        border.drawRect(0, 0, liveRoom.width, liveRoom.height);
        editorOverlay.addChild(border);

        // ── Ghost preview: template placement ────────────────────────────────
        if (mousePosW && activeTool === 'place' && selectedTemplate) {
            const { wx, wy } = mousePosW;
            const snapX    = disableGrid ? 1 : (gridX || 1);
            const snapY    = disableGrid ? 1 : (gridY || 1);
            const snappedX = Math.round(wx / snapX) * snapX;
            const snappedY = Math.round(wy / snapY) * snapY;
            const texDataG = selectedTemplate.textureUid
                ? project?.textures.find(t => t.uid === selectedTemplate!.textureUid)
                : null;
            const urlG     = texDataG?.origname ? getTexUrl(texDataG.origname) : null;
            const pixiTexG = urlG ? texCache.get(urlG) : null;
            if (pixiTexG?.valid && texDataG) {
                const ghost = new PIXI.Sprite(getFrameTexture(urlG, pixiTexG, texDataG));
                ghost.anchor.set(texDataG.axis[0], texDataG.axis[1]);
                ghost.x     = snappedX;
                ghost.y     = snappedY;
                ghost.alpha = 0.5;
                editorOverlay.addChild(ghost);
            } else {
                const ghost = new PIXI.Graphics();
                ghost.beginFill(uidToColor(selectedTemplate.uid), 0.4);
                ghost.drawRect(-16, -16, 32, 32);
                ghost.endFill();
                ghost.x = snappedX;
                ghost.y = snappedY;
                editorOverlay.addChild(ghost);
            }
        }

        // ── Ghost preview: tile placement ─────────────────────────────────────
        if (mousePosW && activeTab === 'tiles' && !tileErasing && tileToolMode !== 'select' && currentTileSel) {
            const { wx, wy } = mousePosW;
            const sel  = currentTileSel;
            const texG = project?.textures.find(t => t.uid === sel.textureUid);
            if (texG) {
                const tw    = (texG.width + texG.marginx) * sel.spanX - texG.marginx;
                const th    = (texG.height + texG.marginy) * sel.spanY - texG.marginy;
                const snapX = disableGrid ? 1 : (gridX || 1);
                const snapY = disableGrid ? 1 : (gridY || 1);
                const tx    = Math.round(wx / snapX) * snapX;
                const ty    = Math.round(wy / snapY) * snapY;
                const urlG  = texG.origname ? getTexUrl(texG.origname) : null;
                const pixiTexG = urlG ? texCache.get(urlG) : null;
                if (pixiTexG?.valid) {
                    const fx = texG.offx + sel.startX * (texG.width  + texG.marginx);
                    const fy = texG.offy + sel.startY * (texG.height + texG.marginy);
                    const fw = texG.width  || pixiTexG.baseTexture.realWidth;
                    const fh = texG.height || pixiTexG.baseTexture.realHeight;
                    const frameTex = getFrameTextureByRect(urlG, pixiTexG, fx, fy, fw * sel.spanX, fh * sel.spanY);
                    const ghost = new PIXI.Sprite(frameTex);
                    ghost.anchor.set(0, 0);
                    ghost.x     = tx;
                    ghost.y     = ty;
                    ghost.alpha = 0.5;
                    editorOverlay.addChild(ghost);
                } else {
                    const ghost = new PIXI.Graphics();
                    ghost.beginFill(0x6688aa, 0.4);
                    ghost.drawRect(0, 0, tw || 32, th || 32);
                    ghost.endFill();
                    ghost.x = tx;
                    ghost.y = ty;
                    editorOverlay.addChild(ghost);
                }
            }
        }

        // ── UI layer — anchored to the room viewport, not the editor canvas ─────
        const uiLayer = new PIXI.Container();
        uiLayer.x = camX;
        uiLayer.y = camY;
        uiLayer.scale.set(camZoom);
        const uiW = liveRoom.width;
        const uiH = liveRoom.height;
        const uiWidgets = allAssignedUiWidgets;
        // Index by uid for parent lookup
        const uiByUid = new Map<string, NyxUIWidget>();
        for (const w of uiWidgets) uiByUid.set(w.uid, w);
        // Build containers with correct anchor reference (parent dims for children)
        const uiContainers = new Map<string, PIXI.Container>();
        for (const w of uiWidgets) {
            const parent = w.parentUid ? uiByUid.get(w.parentUid) : undefined;
            const refW = parent ? parent.width  : uiW;
            const refH = parent ? parent.height : uiH;
            uiContainers.set(w.uid, buildEditorWidget(w, uiW, uiH, refW, refH));
        }
        // Wire hierarchy: children go inside parent container, roots go to uiLayer
        for (const w of uiWidgets) {
            const ctr = uiContainers.get(w.uid)!;
            if (w.parentUid) {
                const parent = uiContainers.get(w.parentUid);
                if (parent) { parent.addChild(ctr); continue; }
            }
            uiLayer.addChild(ctr);
        }
        // Only show UI overlay when the UI tab is active.
        if (activeTab === 'ui') {
            stage.addChild(uiLayer);
        }
        uiLayerRef = uiLayer;

        pixiApp.renderer.render(pixiApp.stage);
    }

    /**

     * Load any uncached textures needed for the current scene, then call
     * buildScene(). Uses a serial counter to discard renders that were
     * superseded by a newer trigger.
     */
    async function loadAndBuild(): Promise<void> {
        if (!pixiApp) return;
        const serial      = ++buildSerial;
        const capturedApp = pixiApp; // detect if app is replaced/destroyed during async gap
        const project = get(currentProject);
        const fp      = get(projectFilePath);

        if (project && fp) {
            const toLoad: string[] = [];
            for (const bg of liveRoom.backgrounds) {
                const texData = project.textures.find(t => t.uid === bg.textureUid);
                if (texData?.origname) {
                    const url = getTexUrl(texData.origname);
                    if (url && !texCache.has(url)) toLoad.push(url);
                }
            }
            for (const copy of liveRoom.copies) {
                const tmpl = getTemplate(copy.templateUid);
                if (tmpl?.textureUid) {
                    const texData = project.textures.find(t => t.uid === tmpl.textureUid);
                    if (texData?.origname) {
                        const url = getTexUrl(texData.origname);
                        if (url && !texCache.has(url)) toLoad.push(url);
                    }
                }
            }
            for (const layer of liveRoom.tiles ?? []) {
                for (const tile of layer.tiles) {
                    const texData = project.textures.find(t => t.uid === tile.texture);
                    if (texData?.origname) {
                        const url = getTexUrl(texData.origname);
                        if (url && !texCache.has(url)) toLoad.push(url);
                    }
                }
            }
            for (const w of allAssignedUiWidgets) {
                if (w.type === 'image' && w.textureUid) {
                    const texData = project?.textures.find(t => t.uid === w.textureUid);
                    if (texData?.origname) {
                        const url = getTexUrl(texData.origname);
                        if (url && !texCache.has(url)) toLoad.push(url);
                    }
                }
            }
            // Preload the active tileset so first-paint tiles appear immediately
            if (currentTileSel) {
                const selTex = project.textures.find(t => t.uid === currentTileSel!.textureUid);
                if (selTex?.origname) {
                    const url = getTexUrl(selTex.origname);
                    if (url && !texCache.has(url)) toLoad.push(url);
                }
            }
            if (toLoad.length > 0) {
                await Promise.all(
                    toLoad.map(url =>
                        PIXI.Texture.fromURL(url)
                            .then(t => {
                                if (pixiApp !== capturedApp) {
                                    // App was destroyed/replaced while loading — purge from global cache.
                                    PIXI.Texture.removeFromCache(t);
                                    return;
                                }
                                texCache.set(url, t);
                            })
                            .catch(() => {})
                    )
                );
            }
        }

        if (serial === buildSerial) buildScene();
    }

    function centerCamera(): void {
        if (!stageEl) return;
        const { clientWidth: sw, clientHeight: sh } = stageEl;
        const fitZoom = Math.min((sw - 80) / liveRoom.width, (sh - 80) / liveRoom.height, 2);
        camZoom = Math.max(0.05, fitZoom);
        camX    = (sw - liveRoom.width  * camZoom) / 2;
        camY    = (sh - liveRoom.height * camZoom) / 2;
    }

    function resizeApp(): void {
        if (!pixiApp || !stageEl) return;
        const { clientWidth: w, clientHeight: h } = stageEl;
        pixiApp.renderer.resize(w, h);
    }

    // Rebuild scene whenever asset data, camera, selection, or placement state changes.
    $effect(() => {
        if (!pixiApp) return;
        void [liveRoom, camX, camY, camZoom, selectedCopyUids, selectedTiles, currentTileSel,
              activeTool, selectedTemplate, activeTab, tileToolMode,
              gridX, gridY, disableGrid, diagonalGrid,
              allAssignedUiWidgets, selectedWidgetUids, handleDrag, tileHandleDrag];
        void loadAndBuild();
    });

    // Init PixiJS once the canvas element is mounted.
    // Only tracks canvasEl + stageEl — all other reads are wrapped in untrack()
    // to prevent the effect from reacting to scene/camera state changes
    // (the rebuild effect above handles those).
    $effect(() => {
        if (!canvasEl || !stageEl) return;

        const app = new PIXI.Application({
            view:        canvasEl,
            width:       stageEl.clientWidth  || 800,
            height:      stageEl.clientHeight || 600,
            backgroundAlpha: 0,
            antialias:   true,
            resolution:  window.devicePixelRatio || 1,
            autoDensity: true,
        });
        // Assign reactively so the rebuild effect wakes up and draws the first frame
        pixiApp = app;
        // Stop continuous render loop — we call renderer.render() explicitly at the
        // end of buildScene() so frames only draw when something actually changed.
        app.ticker.stop();
        // Center camera without tracking camX/camY/camZoom as deps of THIS effect
        untrack(centerCamera);

        const stage = stageEl;
        const ro = new ResizeObserver(() => {
            if (!app.renderer || !stage) return;
            app.renderer.resize(stage.clientWidth, stage.clientHeight);
            stageW = stage.clientWidth;
            stageH = stage.clientHeight;
            untrack(() => void loadAndBuild());
        });
        ro.observe(stage);

        const onKeyDown = (e: KeyboardEvent) => {
            untrack(() => {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    if (selectedCopyUids.size > 0) deleteSelected();
                    else if (selectedTiles.length > 0) deleteSelectedTiles();
                }

            });
        };
        window.addEventListener('keydown', onKeyDown);

        return () => {
            ro.disconnect();
            window.removeEventListener('keydown', onKeyDown);
            // Remove from PIXI's global TextureCache before clearing local map —
            // prevents stale cache entries from causing white boxes on next open.
            for (const tex of texCache.values()) PIXI.Texture.removeFromCache(tex);
            texCache.clear();
            if (lightOverlayTex) { lightOverlayTex.destroy(true); lightOverlayTex = null; }
            for (const [, tex] of _gradTexCache) tex.destroy(true);
            _gradTexCache.clear();
            app.destroy(false, { children: true, texture: true });
            pixiApp = null;
        };
    });

    // ── Canvas pan + zoom ─────────────────────────────────────────────────────

    let panning   = $state(false);
    let panStartX = 0, panStartY = 0;
    let panCamX0  = 0, panCamY0  = 0;

    function onWheel(e: WheelEvent): void {
        e.preventDefault();
        if (!stageEl) return;
        const rect  = stageEl.getBoundingClientRect();
        const mx    = e.clientX - rect.left;
        const my    = e.clientY - rect.top;
        const delta = e.deltaY > 0 ? 0.85 : 1 / 0.85;
        const newZ  = Math.max(0.05, Math.min(8, camZoom * delta));
        // Zoom toward cursor
        camX = mx - (mx - camX) * (newZ / camZoom);
        camY = my - (my - camY) * (newZ / camZoom);
        camZoom = newZ;
    }

    function eraseTileAt(wx: number, wy: number, layerIdx: number, skipHistory = false): void {
        const layer = liveRoom.tiles?.[layerIdx];
        if (!layer) return;
        const project = get(currentProject);
        for (let i = layer.tiles.length - 1; i >= 0; i--) {
            const tile    = layer.tiles[i];
            const texData = project?.textures.find(t => t.uid === tile.texture);
            const tw = texData?.width  ?? 32;
            const th = texData?.height ?? 32;
            if (wx >= tile.x && wx < tile.x + tw && wy >= tile.y && wy < tile.y + th) {
                const nextTiles = JSON.parse(JSON.stringify(liveRoom.tiles)) as typeof liveRoom.tiles;
                nextTiles[layerIdx].tiles.splice(i, 1);
                updateAsset<NyxRoom>(asset.uid, 'room', { tiles: nextTiles }, skipHistory);
                break;
            }
        }
    }

    function onPointerDown(e: PointerEvent): void {
        // ── UI tab: LMB on empty canvas deselects widget ──────────────────────
        // (Widget and gizmo clicks stop propagation themselves, so they won't reach here)
        if (activeTab === 'ui' && e.button === 0) {
            selectedWidgetUids = new Set();
            return;
        }

        // ── Select mode: LMB hits copies then tiles across all tabs ──────────
        if (activeTool === 'select' && e.button === 0) {
            const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

            // Copies take priority
            const hitUid = hitTestCopies(wx, wy);
            if (hitUid) {
                selectedTiles = [];
                if (e.shiftKey) {
                    const s = new Set(selectedCopyUids);
                    if (s.has(hitUid)) s.delete(hitUid); else s.add(hitUid);
                    selectedCopyUids = s;
                } else if (!selectedCopyUids.has(hitUid)) {
                    selectedCopyUids = new Set([hitUid]);
                }
                pushAssetUndoSnapshot(asset.uid);
                dragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                dragCopyPositions = new Map(
                    liveRoom.copies
                        .filter(c => selectedCopyUids.has(c.uid))
                        .map(c => [c.uid, { x: c.x, y: c.y }])
                );
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                return;
            }

            // Then tiles
            const hitTile = hitTestTiles(wx, wy);
            if (hitTile) {
                selectedCopyUids = new Set();
                if (e.shiftKey) {
                    const idx = selectedTiles.findIndex(s => s.layerIdx === hitTile.layerIdx && s.tileIdx === hitTile.tileIdx);
                    selectedTiles = idx >= 0 ? selectedTiles.filter((_, i) => i !== idx) : [...selectedTiles, hitTile];
                } else if (!selectedTiles.some(s => s.layerIdx === hitTile.layerIdx && s.tileIdx === hitTile.tileIdx)) {
                    selectedTiles = [hitTile];
                }
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                return;
            }

            // Nothing hit on tiles tab → let tiles tab logic handle painting/erasing
            if (activeTab === 'tiles') {
                selectedCopyUids = new Set();
                // fall through — tiles tab block below will run
            } else {
                // Empty space on any other tab → marquee
                selectedCopyUids = new Set();
                selectedTiles = [];
                marqueeStart = { wx, wy };
                marqueeEnd   = { wx, wy };
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                return;
            }
        }

        // ── Tiles tab: LMB = select/paint, RMB = erase (intercept before pan) ──
        if (activeTab === 'tiles' && (e.button === 0 || e.button === 2)) {
            const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

            if (e.button === 2) {
                // RMB: erase tile at cursor (only in paint/erase mode) — deselect first
                if (tileToolMode === 'select') return;
                selectedTiles = [];
                if (activeTileLayerIdx >= 0 && activeTileLayerIdx < (liveRoom.tiles?.length ?? 0)) {
                    pushAssetUndoSnapshot(asset.uid);
                    eraseTileAt(wx, wy, activeTileLayerIdx, true);
                    tileErasing  = true;
                    tilePainting = true;
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }
                return;
            }

            // LMB in select mode: only select existing tiles, never paint
            if (tileToolMode === 'select') {
                const hitTile = hitTestTiles(wx, wy);
                if (hitTile) {
                    if (e.shiftKey) {
                        const idx = selectedTiles.findIndex(s => s.layerIdx === hitTile.layerIdx && s.tileIdx === hitTile.tileIdx);
                        selectedTiles = idx >= 0 ? selectedTiles.filter((_, i) => i !== idx) : [...selectedTiles, hitTile];
                    } else {
                        selectedTiles = [hitTile];
                    }
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                } else {
                    selectedTiles = [];
                }
                return;
            }

            // LMB in paint mode: clicking an existing tile selects it; empty space paints
            const hitTile = hitTestTiles(wx, wy);
            if (hitTile) {
                if (e.shiftKey) {
                    const idx = selectedTiles.findIndex(s => s.layerIdx === hitTile.layerIdx && s.tileIdx === hitTile.tileIdx);
                    selectedTiles = idx >= 0 ? selectedTiles.filter((_, i) => i !== idx) : [...selectedTiles, hitTile];
                } else {
                    selectedTiles = [hitTile];
                }
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                return;
            }
            selectedTiles = [];

            if (currentTileSel) {
                const sel = currentTileSel;
                const tex = get(currentProject)?.textures.find(t => t.uid === sel.textureUid);
                if (tex && activeTileLayerIdx >= 0 && activeTileLayerIdx < (liveRoom.tiles?.length ?? 0)) {
                    const tw = (tex.width  + tex.marginx) * sel.spanX - tex.marginx;
                    const th = (tex.height + tex.marginy) * sel.spanY - tex.marginy;
                    const snapX = disableGrid ? 1 : Math.max(1, tw);
                    const snapY = disableGrid ? 1 : Math.max(1, th);
                    const tx = Math.round(wx / snapX) * snapX;
                    const ty = Math.round(wy / snapY) * snapY;
                    const frame = sel.startY * (tex.grid[0] || 1) + sel.startX;
                    const newTile = {
                        x: tx, y: ty, opacity: 1, tint: 0xffffff,
                        frame, scale: { x: 1, y: 1 }, rotation: 0, texture: sel.textureUid,
                    };
                    pushAssetUndoSnapshot(asset.uid);
                    const nextTiles = JSON.parse(JSON.stringify(liveRoom.tiles)) as typeof liveRoom.tiles;
                    nextTiles[activeTileLayerIdx].tiles.push(newTile);
                    updateAsset<NyxRoom>(asset.uid, 'room', { tiles: nextTiles }, true);
                    signals.emit('assetChanged');
                    tileErasing  = false;
                    tilePainting = true;
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }
            }
            return;
        }

        // Middle-click or right-click (non-tile tabs): pan
        if (e.button === 1 || e.button === 2) {
            panning   = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panCamX0  = camX;
            panCamY0  = camY;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            return;
        }

        if (e.button !== 0) return;

        const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);

        if (activeTool === 'place' && selectedTemplate) {
            // Place a new copy at the clicked world position, snapping to grid
            const snapX = disableGrid ? 1 : (gridX || 1);
            const snapY = disableGrid ? 1 : (gridY || 1);
            const newCopy: NyxCopy = {
                uid:         crypto.randomUUID(),
                templateUid: selectedTemplate.uid,
                x:           Math.round(wx / snapX) * snapX,
                y:           Math.round(wy / snapY) * snapY,
            };
            updateAsset<NyxRoom>(asset.uid, 'room', {
                copies: [...liveRoom.copies, newCopy],
            });
            signals.emit('assetChanged');
            return;
        }

        // Erase mode: click a copy to remove it
        if (activeTool === 'erase') {
            const hitUid = hitTestCopies(wx, wy);
            if (hitUid) eraseCopy(hitUid);
            return;
        }

    }

    // Track last painted tile position to avoid duplicates when dragging
    let lastPaintX = -Infinity;
    let lastPaintY = -Infinity;

    function onPointerMove(e: PointerEvent): void {
        // Always track world-space mouse position for ghost previews
        const _wp = screenToWorld(e.clientX, e.clientY);
        mousePosW = { wx: _wp.x, wy: _wp.y };

        if (panning) {
            camX = panCamX0 + (e.clientX - panStartX);
            camY = panCamY0 + (e.clientY - panStartY);
            return;
        }

        // Copy transform handle drag
        if (handleDrag) {
            const hd = handleDrag;
            const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
            const dx = (e.clientX - hd.startClientX) / camZoom;
            const dy = (e.clientY - hd.startClientY) / camZoom;
            let patch: Partial<NyxCopy> = {};

            if (hd.handle === 'move') {
                const snapX = disableGrid ? 1 : (gridX || 1);
                const snapY = disableGrid ? 1 : (gridY || 1);
                patch.x = Math.round((hd.origX + dx) / snapX) * snapX;
                patch.y = Math.round((hd.origY + dy) / snapY) * snapY;
            } else if (hd.handle === 'rotate') {
                const cur = Math.atan2(wy - hd.origY, wx - hd.origX) * 180 / Math.PI;
                let a = hd.origAngle + (cur - hd.startWorldAngle);
                while (a >  180) a -= 360;
                while (a < -180) a += 360;
                // Snap rotation to 15° increments when grid is enabled
                if (!disableGrid) a = Math.round(a / 15) * 15;
                patch.angle = a;
            } else {
                // Edge-based resize: snap the dragged edge to grid, keep the opposite edge fixed.
                // Position is then derived from fixedEdge + ax * newSize — always consistent with scale.
                const isLeft  = hd.handle === 'nw' || hd.handle === 'w' || hd.handle === 'sw';
                const isRight = hd.handle === 'ne' || hd.handle === 'e' || hd.handle === 'se';
                const isTop   = hd.handle === 'nw' || hd.handle === 'n' || hd.handle === 'ne';
                const isBot   = hd.handle === 'sw' || hd.handle === 's' || hd.handle === 'se';
                if (isRight || isLeft) {
                    const origSw    = Math.abs(hd.origFw * hd.origScaleX);
                    const snapW     = !disableGrid && gridX > 0 ? gridX : 1;
                    const leftEdge  = hd.origX - hd.origAx * origSw;
                    const rightEdge = hd.origX + (1 - hd.origAx) * origSw;
                    if (isRight) {
                        const snappedRight = Math.round((rightEdge + dx) / snapW) * snapW;
                        const rawW = snappedRight - leftEdge;
                        const newSw = rawW >= 0 ? Math.max(snapW, rawW) : Math.min(-snapW, rawW);
                        patch.scaleX = (newSw / hd.origFw) * Math.sign(hd.origScaleX || 1);
                        patch.x = leftEdge + hd.origAx * newSw;
                    } else {
                        const snappedLeft = Math.round((leftEdge + dx) / snapW) * snapW;
                        const rawW = rightEdge - snappedLeft;
                        const newSw = rawW >= 0 ? Math.max(snapW, rawW) : Math.min(-snapW, rawW);
                        patch.scaleX = (newSw / hd.origFw) * Math.sign(hd.origScaleX || 1);
                        patch.x = snappedLeft + hd.origAx * newSw;
                    }
                }
                if (isTop || isBot) {
                    const origSh  = Math.abs(hd.origFh * hd.origScaleY);
                    const snapH   = !disableGrid && gridY > 0 ? gridY : 1;
                    const topEdge = hd.origY - hd.origAy * origSh;
                    const botEdge = hd.origY + (1 - hd.origAy) * origSh;
                    if (isBot) {
                        const snappedBot = Math.round((botEdge + dy) / snapH) * snapH;
                        const rawH = snappedBot - topEdge;
                        const newSh = rawH >= 0 ? Math.max(snapH, rawH) : Math.min(-snapH, rawH);
                        patch.scaleY = (newSh / hd.origFh) * Math.sign(hd.origScaleY || 1);
                        patch.y = topEdge + hd.origAy * newSh;
                    } else {
                        const snappedTop = Math.round((topEdge + dy) / snapH) * snapH;
                        const rawH = botEdge - snappedTop;
                        const newSh = rawH >= 0 ? Math.max(snapH, rawH) : Math.min(-snapH, rawH);
                        patch.scaleY = (newSh / hd.origFh) * Math.sign(hd.origScaleY || 1);
                        patch.y = snappedTop + hd.origAy * newSh;
                    }
                }
            }
            updateAsset<NyxRoom>(asset.uid, 'room', {
                copies: liveRoom.copies.map(c => c.uid === hd.copyUid ? { ...c, ...patch } : c),
            }, true);
            signals.emit('assetChanged');
            return;
        }

        // Tile transform handle drag
        if (tileHandleDrag) {
            const hd = tileHandleDrag;
            const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
            const dx = (e.clientX - hd.startClientX) / camZoom;
            const dy = (e.clientY - hd.startClientY) / camZoom;
            const nextTiles = JSON.parse(JSON.stringify(liveRoom.tiles)) as NyxTileLayer[];
            const tile = nextTiles?.[hd.layerIdx]?.tiles[hd.tileIdx];
            if (tile) {
                if (hd.handle === 'move') {
                    const snapX = disableGrid ? 1 : Math.max(1, gridX);
                    const snapY = disableGrid ? 1 : Math.max(1, gridY);
                    for (const pos of hd.allOrigPositions) {
                        const t = nextTiles?.[pos.layerIdx]?.tiles[pos.tileIdx];
                        if (t) {
                            t.x = Math.round((pos.origX + dx) / snapX) * snapX;
                            t.y = Math.round((pos.origY + dy) / snapY) * snapY;
                        }
                    }
                } else if (hd.handle === 'rotate') {
                    const tileCx = hd.origX + hd.origFw * hd.origScaleX * 0.5;
                    const tileCy = hd.origY + hd.origFh * hd.origScaleY * 0.5;
                    const cur = Math.atan2(wy - tileCy, wx - tileCx) * 180 / Math.PI;
                    let a = hd.origRotation + (cur - hd.startWorldAngle);
                    while (a >  180) a -= 360;
                    while (a < -180) a += 360;
                    // Snap rotation to 15° increments when grid is enabled
                    if (!disableGrid) a = Math.round(a / 15) * 15;
                    tile.rotation = a;
                } else {
                    // Tiles are top-left anchored (ax=0, ay=0).
                    // Same edge-based formula: snap dragged edge, keep opposite fixed.
                    const isLeft  = hd.handle === 'nw' || hd.handle === 'w' || hd.handle === 'sw';
                    const isRight = hd.handle === 'ne' || hd.handle === 'e' || hd.handle === 'se';
                    const isTop   = hd.handle === 'nw' || hd.handle === 'n' || hd.handle === 'ne';
                    const isBot   = hd.handle === 'sw' || hd.handle === 's' || hd.handle === 'se';
                    if (isRight || isLeft) {
                        const origSw    = Math.abs(hd.origFw * hd.origScaleX);
                        const snapW     = !disableGrid && gridX > 0 ? gridX : 1;
                        const leftEdge  = hd.origX;            // ax=0
                        const rightEdge = hd.origX + origSw;
                        if (isRight) {
                            const snappedRight = Math.round((rightEdge + dx) / snapW) * snapW;
                            const rawW = snappedRight - leftEdge;
                            const newSw = rawW >= 0 ? Math.max(snapW, rawW) : Math.min(-snapW, rawW);
                            tile.scale = { ...tile.scale, x: (newSw / hd.origFw) * Math.sign(hd.origScaleX || 1) };
                            // tile.x stays at leftEdge (no change needed)
                        } else {
                            const snappedLeft = Math.round((leftEdge + dx) / snapW) * snapW;
                            const rawW = rightEdge - snappedLeft;
                            const newSw = rawW >= 0 ? Math.max(snapW, rawW) : Math.min(-snapW, rawW);
                            tile.scale = { ...tile.scale, x: (newSw / hd.origFw) * Math.sign(hd.origScaleX || 1) };
                            tile.x = snappedLeft;
                        }
                    }
                    if (isTop || isBot) {
                        const origSh  = Math.abs(hd.origFh * hd.origScaleY);
                        const snapH   = !disableGrid && gridY > 0 ? gridY : 1;
                        const topEdge = hd.origY;              // ay=0
                        const botEdge = hd.origY + origSh;
                        if (isBot) {
                            const snappedBot = Math.round((botEdge + dy) / snapH) * snapH;
                            const rawH = snappedBot - topEdge;
                            const newSh = rawH >= 0 ? Math.max(snapH, rawH) : Math.min(-snapH, rawH);
                            tile.scale = { ...tile.scale, y: (newSh / hd.origFh) * Math.sign(hd.origScaleY || 1) };
                            // tile.y stays at topEdge (no change needed)
                        } else {
                            const snappedTop = Math.round((topEdge + dy) / snapH) * snapH;
                            const rawH = botEdge - snappedTop;
                            const newSh = rawH >= 0 ? Math.max(snapH, rawH) : Math.min(-snapH, rawH);
                            tile.scale = { ...tile.scale, y: (newSh / hd.origFh) * Math.sign(hd.origScaleY || 1) };
                            tile.y = snappedTop;
                        }
                    }
                }
                updateAsset<NyxRoom>(asset.uid, 'room', { tiles: nextTiles }, true);
                signals.emit('assetChanged');
            }
            return;
        }

        // UI widget handle drag (screen-space — no camera transform)
        if (uiHandleDrag) {
            const hd = uiHandleDrag;
            const dx = e.clientX - hd.startClientX;
            const dy = e.clientY - hd.startClientY;
            const w  = activeUiWidgets.find(ww => ww.uid === selectedWidgetUid);
            if (w) {
                const patch: Record<string, unknown> = {};
                if (hd.handle === 'move') {
                    if (selectedWidgetUids.size > 1) {
                        // Multi-select: apply world-space delta to all selected root widgets.
                        // Skip any widget whose parent is also selected (parent drag carries it).
                        const dxWorld = dx / camZoom;
                        const dyWorld = dy / camZoom;
                        if (activeUiLayerUid) updateAsset<NyxUILayer>(activeUiLayerUid, 'uiLayer', {
                            widgets: getFreshActiveWidgets().map(ww => {
                                if (!selectedWidgetUids.has(ww.uid)) return ww;
                                if (ww.parentUid && selectedWidgetUids.has(ww.parentUid)) return ww;
                                const orig = hd.origPositions.get(ww.uid);
                                if (!orig) return ww;
                                return { ...ww, x: orig.x + dxWorld, y: orig.y + dyWorld };
                            })
                        }, true);
                        signals.emit('assetChanged');
                        return;
                    }
                    const snapX = disableGrid ? 1 : (gridX || 1);
                    const snapY = disableGrid ? 1 : (gridY || 1);
                    patch.x = Math.round((hd.origX + dx / camZoom) / snapX) * snapX;
                    patch.y = Math.round((hd.origY + dy / camZoom) / snapY) * snapY;
                } else if (hd.handle === 'rotate') {
                    const stageRect = stageEl!.getBoundingClientRect();
                    // origX/origY is the CENTER — no half-size addition needed
                    const cx = stageRect.left + (anchorFracX(w.anchor) * liveRoom.width  + hd.origX) * camZoom + camX;
                    const cy = stageRect.top  + (anchorFracY(w.anchor) * liveRoom.height + hd.origY) * camZoom + camY;
                    const startA = Math.atan2(hd.startClientY - cy, hd.startClientX - cx) * 180 / Math.PI;
                    const curA   = Math.atan2(e.clientY        - cy, e.clientX        - cx) * 180 / Math.PI;
                    let rot = hd.origRot + (curA - startA);
                    rot = Math.round(rot / 15) * 15;
                    patch.rotation = rot;
                } else {
                    // Resize — project CSS-pixel delta onto widget's rotated local axes, then convert to room units
                    const θ    = (hd.origRot ?? 0) * Math.PI / 180;
                    const cosθ = Math.cos(θ);
                    const sinθ = Math.sin(θ);
                    const lx   = ( dx * cosθ + dy * sinθ) / camZoom;
                    const ly   = (-dx * sinθ + dy * cosθ) / camZoom;
                    const isLeft  = hd.handle === 'nw' || hd.handle === 'w'  || hd.handle === 'sw';
                    const isRight = hd.handle === 'ne' || hd.handle === 'e'  || hd.handle === 'se';
                    const isTop   = hd.handle === 'nw' || hd.handle === 'n'  || hd.handle === 'ne';
                    const isBot   = hd.handle === 'sw' || hd.handle === 's'  || hd.handle === 'se';
                    let newX = hd.origX, newY = hd.origY;
                    let newW = hd.origW, newH = hd.origH;
                    if (isRight) {
                        newW = Math.max(8, hd.origW + lx);
                    } else if (isLeft) {
                        const dw = Math.min(hd.origW - 8, lx);
                        newW = hd.origW - dw;
                        // Center shifts by half the edge movement (right edge stays fixed)
                        newX = hd.origX + (dw / 2) * cosθ;
                        newY = hd.origY + (dw / 2) * sinθ;
                    }
                    if (isBot) {
                        newH = Math.max(8, hd.origH + ly);
                    } else if (isTop) {
                        const dh = Math.min(hd.origH - 8, ly);
                        newH = hd.origH - dh;
                        // Center shifts by half the edge movement (bottom edge stays fixed)
                        newX = newX - (dh / 2) * sinθ;
                        newY = newY + (dh / 2) * cosθ;
                    }
                    const snapX = disableGrid ? 1 : (gridX || 1);
                    const snapY = disableGrid ? 1 : (gridY || 1);
                    newW = Math.max(snapX, Math.round(newW / snapX) * snapX);
                    newH = Math.max(snapY, Math.round(newH / snapY) * snapY);
                    patch.x = newX; patch.y = newY;
                    patch.width = newW; patch.height = newH;
                }
                if (activeUiLayerUid) updateAsset<NyxUILayer>(activeUiLayerUid, 'uiLayer', {
                    widgets: getFreshActiveWidgets().map(ww => ww.uid === selectedWidgetUid ? { ...ww, ...patch } as NyxUIWidget : ww)
                }, true);
                signals.emit('assetChanged');
            }
            return;
        }

        // Tile drag-erase (RMB held)
        if (tilePainting && tileErasing) {
            const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
            eraseTileAt(wx, wy, activeTileLayerIdx, true);
            return;
        }
        // Tile drag-paint (LMB held)
        if (tilePainting && !tileErasing && currentTileSel) {
            const sel = currentTileSel;
            const tex = get(currentProject)?.textures.find(t => t.uid === sel.textureUid);
            if (tex && activeTileLayerIdx >= 0 && activeTileLayerIdx < (liveRoom.tiles?.length ?? 0)) {
                const tw = (tex.width  + tex.marginx) * sel.spanX - tex.marginx;
                const th = (tex.height + tex.marginy) * sel.spanY - tex.marginy;
                const snapX = disableGrid ? 1 : (gridX || 1);
                const snapY = disableGrid ? 1 : (gridY || 1);
                const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
                const tx = Math.round(wx / snapX) * snapX;
                const ty = Math.round(wy / snapY) * snapY;
                if (tx !== lastPaintX || ty !== lastPaintY) {
                    lastPaintX = tx;
                    lastPaintY = ty;
                    const frame = sel.startY * (tex.grid[0] || 1) + sel.startX;
                    const nextTiles = JSON.parse(JSON.stringify(liveRoom.tiles)) as typeof liveRoom.tiles;
                    nextTiles[activeTileLayerIdx].tiles.push({
                        x: tx, y: ty, opacity: 1, tint: 0xffffff,
                        frame, scale: { x: 1, y: 1 }, rotation: 0, texture: sel.textureUid,
                    });
                    updateAsset<NyxRoom>(asset.uid, 'room', { tiles: nextTiles }, true);
                }
            }
            return;
        }
        // Marquee rect update
        if (marqueeStart) {
            const _mwp = screenToWorld(e.clientX, e.clientY);
            marqueeEnd = { wx: _mwp.x, wy: _mwp.y };
            untrack(() => buildScene());
            return;
        }
        if (dragging && dragCopyPositions.size > 0) {
            const dx    = (e.clientX - dragStartX) / camZoom;
            const dy    = (e.clientY - dragStartY) / camZoom;
            const snapX = disableGrid ? 1 : (gridX || 1);
            const snapY = disableGrid ? 1 : (gridY || 1);
            const updatedCopies = liveRoom.copies.map(c => {
                const orig = dragCopyPositions.get(c.uid);
                if (!orig) return c;
                return {
                    ...c,
                    x: Math.round((orig.x + dx) / snapX) * snapX,
                    y: Math.round((orig.y + dy) / snapY) * snapY,
                };
            });
            updateAsset<NyxRoom>(asset.uid, 'room', { copies: updatedCopies }, true);
        }
        untrack(() => buildScene());
    }

    function onPointerUp(e: PointerEvent): void {
        if (handleDrag) {
            handleDrag = null;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            signals.emit('assetChanged');
            return;
        }
        if (tileHandleDrag) {
            tileHandleDrag = null;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            signals.emit('assetChanged');
            return;
        }
        if (uiHandleDrag) {
            uiHandleDrag = null;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            signals.emit('assetChanged');
            return;
        }
        // Commit marquee rect-select
        if (marqueeStart && marqueeEnd) {
            const minX = Math.min(marqueeStart.wx, marqueeEnd.wx);
            const maxX = Math.max(marqueeStart.wx, marqueeEnd.wx);
            const minY = Math.min(marqueeStart.wy, marqueeEnd.wy);
            const maxY = Math.max(marqueeStart.wy, marqueeEnd.wy);
            // Only apply selection if the user dragged a meaningful rect
            if (maxX - minX > 2 || maxY - minY > 2) {
                const project = get(currentProject);
                const inRect = liveRoom.copies.filter(c => {
                    const tmpl    = getTemplate(c.templateUid);
                    const texData = tmpl?.textureUid
                        ? project?.textures.find(t => t.uid === tmpl.textureUid)
                        : null;
                    const fw  = texData?.width  ?? 32;
                    const fh  = texData?.height ?? 32;
                    const ax  = texData?.axis[0] ?? 0.5;
                    const ay  = texData?.axis[1] ?? 0.5;
                    const sx  = c.scaleX ?? 1;
                    const sy  = c.scaleY ?? 1;
                    const sw  = fw * Math.abs(sx);
                    const sh  = fh * Math.abs(sy);
                    const cx0 = sx >= 0 ? c.x - ax * sw : c.x - (1 - ax) * sw;
                    const cy0 = sy >= 0 ? c.y - ay * sh : c.y - (1 - ay) * sh;
                    const cx1 = cx0 + sw;
                    const cy1 = cy0 + sh;
                    return cx1 >= minX && cx0 <= maxX && cy1 >= minY && cy0 <= maxY;
                });
                selectedCopyUids = new Set(inRect.map(c => c.uid));

                // Select all tiles overlapping the marquee rect
                selectedTiles = [];
                for (let li = 0; li < (liveRoom.tiles?.length ?? 0); li++) {
                    const layer = liveRoom.tiles![li];
                    for (let ti = 0; ti < layer.tiles.length; ti++) {
                        const tile    = layer.tiles[ti];
                        const texData = project?.textures.find(t => t.uid === tile.texture);
                        const tsx = tile.scale?.x ?? 1;
                        const tsy = tile.scale?.y ?? 1;
                        const tw  = (texData?.width  ?? 32) * Math.abs(tsx);
                        const th  = (texData?.height ?? 32) * Math.abs(tsy);
                        const tl  = tsx >= 0 ? tile.x : tile.x - tw;
                        const tt  = tsy >= 0 ? tile.y : tile.y - th;
                        if (tl + tw >= minX && tl <= maxX && tt + th >= minY && tt <= maxY) {
                            selectedTiles = [...selectedTiles, { layerIdx: li, tileIdx: ti }];
                        }
                    }
                }
            }
            marqueeStart = null;
            marqueeEnd   = null;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            return;
        }
        if (panning) {
            panning = false;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        }
        if (tilePainting) {
            tilePainting = false;
            tileErasing  = false;
            lastPaintX   = lastPaintY = -Infinity;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            signals.emit('assetChanged');
        }
        if (dragging) {
            // Pre-drag state was already captured by pushAssetUndoSnapshot at drag start.
            dragging = false;
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            signals.emit('assetChanged');
        }
    }

    // pixiApp cleanup is handled by the $effect return above.
</script>

<div class="room-editor">
    <!-- ── Left: property panel ── -->
    <div class="props-col">
        <div class="prop-header">
            <h3 class="nm">{asset.name}</h3>
            {#if isStartingRoom}
                <span class="badge-start">Starting room</span>
            {/if}
        </div>

        {#if !uiOnlyMode}
        <div class="prop-tabs">
            <button class="prop-tab" class:active={activeTab === 'settings'}    onclick={() => { activeTab = 'settings'; }}>Settings</button>
            <button class="prop-tab" class:active={activeTab === 'backgrounds'} onclick={() => { activeTab = 'backgrounds'; }}>BG</button>
            <button class="prop-tab" class:active={activeTab === 'copies'}
                    onclick={() => { activeTab = 'copies'; selectedTiles = []; }}>Copies</button>
            <button class="prop-tab" class:active={activeTab === 'tiles'}
                    onclick={() => { activeTab = 'tiles'; activeTool = 'select'; selectedTemplate = null; }}>Tiles</button>
            <button class="prop-tab" class:active={activeTab === 'ui'}
                    onclick={() => { activeTab = 'ui'; activeTool = 'select'; selectedTemplate = null; }}>UI</button>
            <button class="prop-tab" class:active={activeTab === 'code'}        onclick={() => { activeTab = 'code'; }}>Events</button>
        </div>
        {/if}

        <div class="props-body" class:no-pad={activeTab === 'tiles'}>
            {#if activeTab === 'settings'}
                <RoomProperties
                    room={liveRoom}
                    onchange={(patch) => {
                        // Apply scalar fields to local state first so canvas stays in sync
                        if ('width'           in patch) width           = patch.width!;
                        if ('height'          in patch) height          = patch.height!;
                        if ('backgroundColor' in patch) backgroundColor = patch.backgroundColor!;
                        if ('isStartingRoom'  in patch) isStartingRoom  = patch.isStartingRoom!;
                        if ('viewMode'        in patch) viewMode        = patch.viewMode!;
                        if ('gridX'           in patch) gridX           = patch.gridX!;
                        if ('gridY'           in patch) gridY           = patch.gridY!;
                        if ('diagonalGrid'         in patch) diagonalGrid         = patch.diagonalGrid!;
                        if ('disableGrid'          in patch) disableGrid          = patch.disableGrid!;
                        if ('editorLightPreview'   in patch) editorLightPreview   = patch.editorLightPreview!;
                        if ('lightAmbientColor'   in patch) lightAmbientColor   = patch.lightAmbientColor!;
                        if ('lightAmbientOpacity' in patch) lightAmbientOpacity = patch.lightAmbientOpacity!;
                        persist(patch);
                    }}
                />
            {/if}

            {#if activeTab === 'backgrounds'}
                <RoomBackgroundsEditor
                    room={liveRoom}
                    textures={$currentProject?.textures ?? []}
                    onchange={(bgs) => {
                        updateAsset<NyxRoom>(asset.uid, 'room', { backgrounds: bgs });
                        signals.emit('assetChanged');
                    }}
                />
            {/if}

            {#if activeTab === 'copies'}
                <div class="tool-row">
                    <button class="tool-btn" class:active={activeTool === 'select'}
                            onclick={() => { activeTool = 'select'; }}>
                        <Icon icon="feather:mouse-pointer" class="feather"/>
                        Select
                    </button>
                    <button class="tool-btn" class:active={activeTool === 'place'}
                            onclick={() => { activeTool = 'place'; }}>
                        <Icon icon="feather:plus" class="feather"/>
                        Place
                    </button>
                    {#if activeTool === 'place' && selectedTemplate}
                        <span class="place-indicator" title={selectedTemplate.name}>
                            <span class="place-swatch" style:background={uidToColorHex(selectedTemplate.uid)}></span>
                            <span class="place-name">{selectedTemplate.name}</span>
                        </span>
                    {/if}
                    <button class="tool-btn erase-btn" class:active={activeTool === 'erase'}
                            onclick={() => { activeTool = 'erase'; selectedCopyUids = new Set(); }}>
                        <Icon icon="feather:x-circle" class="feather"/>
                        Erase
                    </button>
                </div>

                {#if activeTool === 'select'}
                    <!-- Entity list -->
                    <div class="entities-list-wrap">
                        <RoomEntitiesList
                            room={liveRoom}
                            templates={templates}
                            selectedUids={selectedCopyUids}
                            onselect={(uid, multi) => {
                                if (multi) {
                                    const s = new Set(selectedCopyUids);
                                    if (s.has(uid)) s.delete(uid); else s.add(uid);
                                    selectedCopyUids = s;
                                } else {
                                    selectedCopyUids = new Set([uid]);
                                }
                            }}
                            ondelete={(uid) => eraseCopy(uid)}
                        />
                    </div>

                    {#if selectedCopyUids.size > 0}
                        <div class="sel-info">
                            <span class="dim small">{selectedCopyUids.size} selected</span>
                            <button class="danger-sm" onclick={deleteSelected}>
                                <Icon icon="feather:trash-2" class="feather"/>
                                Delete
                            </button>
                        </div>

                        {#if selectedCopyUids.size > 1}
                            <!-- Multi-selection: only bulk-editable fields -->
                            <div class="copy-inspector">
                                <div class="insp-grid">
                                    <span>X</span>
                                    <input aria-label="X" type="number" step="1"
                                           value={multiVal('x') ?? ''}
                                           placeholder={multiVal('x') === undefined ? '—' : String(multiVal('x'))}
                                           onchange={(e) => updateSelectedCopies('x', parseFloat((e.target as HTMLInputElement).value) || 0)} />
                                    <span>Y</span>
                                    <input aria-label="Y" type="number" step="1"
                                           value={multiVal('y') ?? ''}
                                           placeholder={multiVal('y') === undefined ? '—' : String(multiVal('y'))}
                                           onchange={(e) => updateSelectedCopies('y', parseFloat((e.target as HTMLInputElement).value) || 0)} />
                                    <!-- <span>Depth</span>
                                    <input aria-label="Depth" type="number" step="1"
                                           value={multiVal('depth') ?? ''}
                                           placeholder={multiVal('depth') === undefined ? '—' : String(multiVal('depth'))}
                                           onchange={(e) => updateSelectedCopies('depth', parseFloat((e.target as HTMLInputElement).value) || 0)} /> -->
                                    <span>Scale X</span>
                                    <input aria-label="Scale X" type="number" step="0.1"
                                           value={multiVal('scaleX') ?? ''}
                                           placeholder={multiVal('scaleX') === undefined ? '—' : String(multiVal('scaleX'))}
                                           onchange={(e) => updateSelectedCopies('scaleX', parseFloat((e.target as HTMLInputElement).value) || 1)} />
                                    <span>Scale Y</span>
                                    <input aria-label="Scale Y" type="number" step="0.1"
                                           value={multiVal('scaleY') ?? ''}
                                           placeholder={multiVal('scaleY') === undefined ? '—' : String(multiVal('scaleY'))}
                                           onchange={(e) => updateSelectedCopies('scaleY', parseFloat((e.target as HTMLInputElement).value) || 1)} />
                                    <span>Angle</span>
                                    <input aria-label="Angle" type="number" step="1" min="-180" max="180"
                                           value={multiVal('angle') ?? ''}
                                           placeholder={multiVal('angle') === undefined ? '—' : String(multiVal('angle'))}
                                           onchange={(e) => updateSelectedCopies('angle', parseFloat((e.target as HTMLInputElement).value) || 0)} />
                                    <span>Alpha</span>
                                    <input aria-label="Alpha" type="number" step="0.05" min="0" max="1"
                                           value={multiVal('alpha') ?? ''}
                                           placeholder={multiVal('alpha') === undefined ? '—' : String(multiVal('alpha'))}
                                           onchange={(e) => updateSelectedCopies('alpha', Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 1)))} />
                                </div>
                            </div>
                        {/if}
                    {/if}
                {/if}

                {#if activeTool === 'place'}
                    <RoomTemplatePicker
                        templates={templates}
                        textures={$currentProject?.textures ?? []}
                        selectedUid={selectedTemplate?.uid ?? null}
                        onselect={(uid) => {
                            selectedTemplate = templates.find(t => t.uid === uid) ?? null;
                        }}
                    />
                {/if}
            {/if}

            {#if activeTab === 'tiles'}
                <div class="tile-hint-row">
                    <Icon icon="feather:edit-2" class="feather dim-icon"/>
                    <span class="dim small">LMB paint · RMB erase · click/shift=select · Del=delete</span>
                </div>
                <TileEditor
                    room={liveRoom}
                    bind:activeTileLayerIdx
                    bind:tileToolMode
                    ontileselection={(sel) => { currentTileSel = sel; tileErasing = false; }}
                />
                {#if selectedTiles.length > 0}
                    <div class="sel-info">
                        <span class="dim small">{selectedTiles.length} tile{selectedTiles.length === 1 ? '' : 's'} selected</span>
                        <button class="danger-sm" onclick={deleteSelectedTiles}>
                            <Icon icon="feather:trash-2" class="feather"/>
                            Delete
                        </button>
                    </div>
                    <div class="copy-inspector">
                        <div class="insp-grid">
                            <span>X</span>
                            <input aria-label="X" type="number" step="1"
                                   value={tileMultiVal('x') ?? ''}
                                   placeholder={tileMultiVal('x') === undefined ? '—' : ''}
                                   onchange={(e) => updateSelectedTiles({ x: parseFloat((e.target as HTMLInputElement).value) || 0 })} />
                            <span>Y</span>
                            <input aria-label="Y" type="number" step="1"
                                   value={tileMultiVal('y') ?? ''}
                                   placeholder={tileMultiVal('y') === undefined ? '—' : ''}
                                   onchange={(e) => updateSelectedTiles({ y: parseFloat((e.target as HTMLInputElement).value) || 0 })} />
                            <span>Scale X</span>
                            <input aria-label="Scale X" type="number" step="0.1"
                                   value={tileScaleMultiVal('x') ?? ''}
                                   placeholder={tileScaleMultiVal('x') === undefined ? '—' : ''}
                                   onchange={(e) => {
                                       const v = parseFloat((e.target as HTMLInputElement).value) || 1;
                                       updateSelectedTiles({ scale: { x: v, y: tileScaleMultiVal('y') ?? 1 } });
                                   }} />
                            <span>Scale Y</span>
                            <input aria-label="Scale Y" type="number" step="0.1"
                                   value={tileScaleMultiVal('y') ?? ''}
                                   placeholder={tileScaleMultiVal('y') === undefined ? '—' : ''}
                                   onchange={(e) => {
                                       const v = parseFloat((e.target as HTMLInputElement).value) || 1;
                                       updateSelectedTiles({ scale: { x: tileScaleMultiVal('x') ?? 1, y: v } });
                                   }} />
                            <span>Rotation</span>
                            <input aria-label="Rotation" type="number" step="1" min="-180" max="180"
                                   value={tileMultiVal('rotation') ?? ''}
                                   placeholder={tileMultiVal('rotation') === undefined ? '—' : ''}
                                   onchange={(e) => updateSelectedTiles({ rotation: parseFloat((e.target as HTMLInputElement).value) || 0 })} />
                            <span>Opacity</span>
                            <input aria-label="Opacity" type="number" step="0.05" min="0" max="1"
                                   value={tileMultiVal('opacity') ?? ''}
                                   placeholder={tileMultiVal('opacity') === undefined ? '—' : ''}
                                   onchange={(e) => updateSelectedTiles({ opacity: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 1)) })} />
                        </div>
                    </div>
                {/if}
            {/if}

            {#if activeTab === 'ui'}
                <RoomUIEditor
                    activeLayer={activeUiLayer}
                    allLayers={allUiLayers}
                    roomLayerUids={liveRoom.uiLayerUids ?? []}
                    textures={$currentProject?.textures ?? []}
                    selectedUid={selectedWidgetUid}
                    onlayerchange={(widgets) => {
                        if (activeUiLayerUid) {
                            updateAsset<NyxUILayer>(activeUiLayerUid, 'uiLayer', { widgets });
                            signals.emit('assetChanged');
                        }
                    }}
                    onlayeruidschange={(uids) => {
                        updateAsset<NyxRoom>(asset.uid, 'room', { uiLayerUids: uids });
                        signals.emit('assetChanged');
                    }}
                    onactivelayerchange={(uid) => { activeUiLayerUid = uid; }}
                    onselect={(uid) => { selectedWidgetUids = uid ? new Set([uid]) : new Set(); }}
                    onreparent={reparentWidgetKeepWorld}
                    hidePicker={uiOnlyMode}
                />
            {/if}

        </div>

        <div class="footer">
        </div>
    </div>

    <!-- ── Right: PixiJS scene canvas or events editor ── -->
    <div class="canvas-col">
        {#if activeTab === 'code'}
            <div class="events-fill">
                <RoomEventsEditor
                    asset={liveRoom}
                    onscriptpathcreated={(path) => {
                        updateAsset<NyxRoom>(asset.uid, 'room', { scriptPath: path });
                        signals.emit('assetChanged');
                    }}
                />
            </div>
        {/if}
        <div class="canvas-toolbar" class:hidden={activeTab === 'code'}>
            <button class="inline square" title="Undo (Ctrl+Z)" disabled={!canUndoRoom}
                    onclick={() => undoAsset(effectiveUndoUid)}>
                <Icon icon="feather:corner-up-left" class="feather"/>
            </button>
            <button class="inline square" title="Redo (Ctrl+Shift+Z)" disabled={!canRedoRoom}
                    onclick={() => redoAsset(effectiveUndoUid)}>
                <Icon icon="feather:corner-up-right" class="feather"/>
            </button>
            <div class="sep"></div>
            <button class="inline square" title="Fit to view" onclick={centerCamera}>
                <Icon icon="feather:maximize" class="feather"/>
            </button>
            <div class="sep"></div>
            <button class="inline square" title="Zoom in"
                    onclick={() => { camZoom = Math.min(8, camZoom * (1/0.85)); }}>
                <Icon icon="feather:zoom-in" class="feather"/>
            </button>
            <button class="inline square" title="Zoom out"
                    onclick={() => { camZoom = Math.max(0.05, camZoom * 0.85); }}>
                <Icon icon="feather:zoom-out" class="feather"/>
            </button>
            <div class="sep"></div>
            <span class="dim small">{width} × {height}px</span>
            <span class="dim small">{Math.round(camZoom * 100)}%</span>
            <div class="sep"></div>
            <span class="dim small">{copies.length} cop{copies.length === 1 ? 'y' : 'ies'}</span>
            <span class="dim small tip">Scroll=zoom · {activeTab === 'tiles' ? 'RMB=erase' : 'RMB=pan'} · {activeTab === 'tiles' ? (currentTileSel ? 'LMB=paint · click tile=select · drag=fill' : 'Pick a tileset — LMB=select tile') : activeTool === 'place' ? 'LMB=place copy' : activeTool === 'erase' ? 'LMB=erase copy' : 'LMB=select · drag=multi-select · Del=delete'}</span>
        </div>

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="canvas-stage"
            class:hidden={activeTab === 'code'}
            style:cursor={panning || dragging || handleDrag || tileHandleDrag ? 'grabbing' : activeTab === 'tiles' && tileErasing ? 'not-allowed' : activeTab === 'tiles' && tileToolMode === 'select' ? 'default' : (activeTab === 'tiles' && currentTileSel) || activeTool === 'place' ? 'crosshair' : activeTool === 'erase' ? 'not-allowed' : 'default'}
            bind:this={stageEl}
            onwheel={onWheel}
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerUp}
            onpointerleave={() => { mousePosW = null; untrack(() => buildScene()); }}
            oncontextmenu={(e) => e.preventDefault()}
        >
            <canvas bind:this={canvasEl}></canvas>

            <!-- Transform handles overlay — copy (cyan) + tile (gold) + UI (orange) + marquee -->
            {#if copyHandleData.length > 0 || tileHandleData.length > 0 || (marqueeStart && marqueeEnd) || (activeTab === 'ui' && uiHandleData())}
            <svg class="handles-svg">
                {#each copyHandleData as h (h.uid)}
                    {@const H = 5}
                    {@const mtx = h.px + h.pw / 2}
                    {@const ry  = h.py - 22}
                    <rect x={h.px} y={h.py} width={h.pw} height={h.ph}
                          fill="none" stroke="#00e5ff" stroke-width="1.5" stroke-dasharray="5 3"
                          pointer-events="none" />
                    <line x1={mtx} y1={h.py} x2={mtx} y2={ry}
                          stroke="#00e5ff" stroke-width="1" stroke-dasharray="3 2"
                          pointer-events="none" />
                    <circle cx={mtx} cy={ry} r={H + 1}
                            fill="none" stroke="#00e5ff" stroke-width="1.5"
                            style="cursor:crosshair;pointer-events:auto"
                            onpointerdown={(ev) => onHandlePointerDown(ev, h.uid, 'rotate')} />
                    <circle cx={h.cx} cy={h.cy} r={H}
                            fill="#00e5ff" stroke="#1a1a2e" stroke-width="1.5"
                            style="cursor:move;pointer-events:auto"
                            onpointerdown={(ev) => onHandlePointerDown(ev, h.uid, 'move')} />
                    {#each ([
                        ['nw', h.px,           h.py,           'nw-resize'],
                        ['n',  h.px+h.pw/2,    h.py,           'n-resize' ],
                        ['ne', h.px+h.pw,       h.py,           'ne-resize'],
                        ['w',  h.px,           h.py+h.ph/2,    'w-resize' ],
                        ['e',  h.px+h.pw,       h.py+h.ph/2,    'e-resize' ],
                        ['sw', h.px,           h.py+h.ph,       'sw-resize'],
                        ['s',  h.px+h.pw/2,    h.py+h.ph,       's-resize' ],
                        ['se', h.px+h.pw,       h.py+h.ph,       'se-resize'],
                    ] as [HandleType, number, number, string][]) as hk}
                        <rect x={hk[1]-H} y={hk[2]-H} width={H*2} height={H*2} rx="1"
                              fill="#1a1a2e" stroke="#00e5ff" stroke-width="1.5"
                              style={`cursor:${hk[3]};pointer-events:auto`}
                              onpointerdown={(ev) => onHandlePointerDown(ev, h.uid, hk[0])} />
                    {/each}
                {/each}

                {#each tileHandleData as h (`${h.layerIdx},${h.tileIdx}`)}
                    {@const H = 5}
                    {@const mtx = h.px + h.pw / 2}
                    {@const ry  = h.py - 22}
                    <g transform="rotate({h.rotation} {h.cx} {h.cy})">
                    <rect x={h.px} y={h.py} width={h.pw} height={h.ph}
                          fill="none" stroke="#ffd700" stroke-width="1.5" stroke-dasharray="5 3"
                          pointer-events="none" />
                    <line x1={mtx} y1={h.py} x2={mtx} y2={ry}
                          stroke="#ffd700" stroke-width="1" stroke-dasharray="3 2"
                          pointer-events="none" />
                    <circle cx={mtx} cy={ry} r={H + 1}
                            fill="none" stroke="#ffd700" stroke-width="1.5"
                            style="cursor:crosshair;pointer-events:auto"
                            onpointerdown={(ev) => onTileHandlePointerDown(ev, h.layerIdx, h.tileIdx, 'rotate')} />
                    <circle cx={h.cx} cy={h.cy} r={H}
                            fill="#ffd700" stroke="#1a1a2e" stroke-width="1.5"
                            style="cursor:move;pointer-events:auto"
                            onpointerdown={(ev) => onTileHandlePointerDown(ev, h.layerIdx, h.tileIdx, 'move')} />
                    {#each ([
                        ['nw', h.px,           h.py,           'nw-resize'],
                        ['n',  h.px+h.pw/2,    h.py,           'n-resize' ],
                        ['ne', h.px+h.pw,       h.py,           'ne-resize'],
                        ['w',  h.px,           h.py+h.ph/2,    'w-resize' ],
                        ['e',  h.px+h.pw,       h.py+h.ph/2,    'e-resize' ],
                        ['sw', h.px,           h.py+h.ph,       'sw-resize'],
                        ['s',  h.px+h.pw/2,    h.py+h.ph,       's-resize' ],
                        ['se', h.px+h.pw,       h.py+h.ph,       'se-resize'],
                    ] as [HandleType, number, number, string][]) as hk}
                        <rect x={hk[1]-H} y={hk[2]-H} width={H*2} height={H*2} rx="1"
                              fill="#1a1a2e" stroke="#ffd700" stroke-width="1.5"
                              style={`cursor:${hk[3]};pointer-events:auto`}
                              onpointerdown={(ev) => onTileHandlePointerDown(ev, h.layerIdx, h.tileIdx, hk[0])} />
                    {/each}
                    </g>
                {/each}

                <!-- Marquee rect-select overlay -->
                {#if marqueeStart && marqueeEnd}
                    {@const mx = Math.min(marqueeStart.wx, marqueeEnd.wx) * camZoom + camX}
                    {@const my = Math.min(marqueeStart.wy, marqueeEnd.wy) * camZoom + camY}
                    {@const mw = Math.abs(marqueeEnd.wx - marqueeStart.wx) * camZoom}
                    {@const mh = Math.abs(marqueeEnd.wy - marqueeStart.wy) * camZoom}
                    <rect x={mx} y={my} width={mw} height={mh}
                          fill="rgba(0,229,255,0.07)" stroke="#00e5ff" stroke-width="1"
                          stroke-dasharray="4 3" pointer-events="none" />
                {/if}

                <!-- ── UI gizmo (orange) — selected widget transform handles ── -->
                {#if activeTab === 'ui' && uiHandleData()}
                    {@const hd  = uiHandleData()!}
                    {@const H   = 5}
                    {@const rot = hd.w ? (hd.w.rotation ?? 0) : 0}
                    {@const cx  = hd.px + hd.pw / 2}
                    {@const cy  = hd.py + hd.ph / 2}
                    <g transform="rotate({rot} {cx} {cy})">
                        <rect x={hd.px} y={hd.py} width={hd.pw} height={hd.ph}
                              fill="none" stroke="#ff9500" stroke-width="1.5" stroke-dasharray="5 3"
                              pointer-events="none" />
                        {#if !hd.multi}
                            <line x1={cx} y1={hd.py} x2={cx} y2={hd.py - 24}
                                  stroke="#ff9500" stroke-width="1" stroke-dasharray="3 2" pointer-events="none" />
                            <circle cx={cx} cy={hd.py - 24} r={H + 1}
                                    fill="none" stroke="#ff9500" stroke-width="1.5"
                                    style="cursor:crosshair;pointer-events:auto"
                                    onpointerdown={(ev) => onUIHandlePointerDown(ev, 'rotate')} />
                        {/if}
                        <circle cx={cx} cy={cy} r={H}
                                fill="#ff9500" stroke="#1a1a2e" stroke-width="1.5"
                                style="cursor:move;pointer-events:auto"
                                onpointerdown={(ev) => onUIHandlePointerDown(ev, 'move')} />
                        {#each ([
                            ['nw', hd.px,                hd.py,                'nw-resize'],
                            ['n',  hd.px + hd.pw / 2,   hd.py,                'n-resize' ],
                            ['ne', hd.px + hd.pw,        hd.py,                'ne-resize'],
                            ['w',  hd.px,                hd.py + hd.ph / 2,    'w-resize' ],
                            ['e',  hd.px + hd.pw,        hd.py + hd.ph / 2,    'e-resize' ],
                            ['sw', hd.px,                hd.py + hd.ph,        'sw-resize'],
                            ['s',  hd.px + hd.pw / 2,   hd.py + hd.ph,        's-resize' ],
                            ['se', hd.px + hd.pw,        hd.py + hd.ph,        'se-resize'],
                        ] as [UIHandleType, number, number, string][]) as hk}
                            <rect x={hk[1]-H} y={hk[2]-H} width={H*2} height={H*2} rx="1"
                                  fill="#1a1a2e" stroke="#ff9500" stroke-width="1.5"
                                  style={`cursor:${hk[3]};pointer-events:auto`}
                                  onpointerdown={(ev) => onUIHandlePointerDown(ev, hk[0])} />
                        {/each}
                    </g>
                {/if}
            </svg>
            {/if}

            <!-- Floating property inspector overlay — shown when a copy, tile-layer, or tile is selected -->
            <RoomInspector
                selection={roomSelection()}
                room={liveRoom}
                templates={templates}
                onpatch={(updated) => {
                    updateAsset<NyxRoom>(asset.uid, 'room', updated);
                    signals.emit('assetChanged');
                }}
            />
        </div>
    </div>
</div>

<style>
    .room-editor {
        display: flex;
        flex-flow: row nowrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .props-col {
        flex: 0 0 260px;
        background: var(--background, #1a1a2e);
        border-right: 1px solid var(--border-bright, #333);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .prop-header {
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    h3 { font-size: 0.9rem; margin: 0; flex: 1 1 auto; }

    .badge-start {
        font-size: 0.68rem;
        padding: 0.1rem 0.4rem;
        background: var(--accent1, #446adb);
        border-radius: 10px;
        color: #fff;
        white-space: nowrap;
    }

    .prop-tabs { display: flex; flex-shrink: 0; border-bottom: 1px solid var(--border-bright, #333); }
    .prop-tab {
        flex: 1 1 auto;
        padding: 0.3rem 0;
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: var(--text-dim, #888);
        cursor: pointer;
        font-size: 0.78rem;
        transition: all 0.12s;
        &:hover  { color: var(--text, #e0e0e0); }
        &.active { color: var(--acttext, #7ec8e3); border-bottom-color: var(--accent1, #446adb); }
    }

    .props-body { flex: 1 1 auto; overflow-y: auto; padding: 0.75rem; display: flex; flex-direction: column; }
    .props-body.no-pad { padding: 0; overflow: hidden; }

    /* Shared form controls used by the multi-select inspector */
    input[type="number"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.8rem;
        width: 100%;
        box-sizing: border-box;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .nm     { margin: 0; }
    .small  { font-size: 0.78rem; margin: 0.2rem 0; }
    .dim    { color: var(--text-dim, #888); }

    .footer { padding: 0.75rem; border-top: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }

    /* Canvas area */
    .canvas-col {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--background-deeper, #111122);
    }

    .canvas-toolbar {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        padding: 0.25rem 0.5rem;
        border-bottom: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        flex-shrink: 0;
    }

    .sep { width: 1px; height: 1.2rem; background: var(--border-bright, #333); margin: 0 0.25rem; }

    .active-tool {
        background: var(--accent1, #446adb) !important;
        color: #fff !important;
    }

    .canvas-stage {
        flex: 1 1 auto;
        overflow: hidden;
        position: relative;
        cursor: default;

        canvas {
            display: block;
            width: 100%;
            height: 100%;
        }
    }

    .handles-svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
    }

    .tip        { margin-left: auto; opacity: 0.3; font-size: 0.72rem; }
    .hidden     { display: none; }
    .events-fill { flex: 1 1 auto; min-height: 0; overflow: hidden; }

    /* Tiles tab — hint row */
    .tile-hint-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.25rem 0.5rem;
        border-bottom: 1px solid var(--border-bright, #333);
        flex-shrink: 0;
        opacity: 0.6;
        font-size: 0.75rem;
        :global(svg.dim-icon) { width: 0.75rem; height: 0.75rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }

    /* Copies tab — tool row */
    .tool-row { display: flex; gap: 0.35rem; margin-bottom: 0.4rem; flex-shrink: 0; }
    .tool-btn {
        flex: 1 1 auto;
        padding: 0.25rem;
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        background: var(--background-deeper, #111122);
        color: var(--text-dim, #888);
        cursor: pointer;
        font-size: 0.78rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.3rem;
        transition: all 0.12s;
        &:hover  { color: var(--text, #e0e0e0); }
        &.active { background: var(--accent1, #446adb); border-color: var(--accent1, #446adb); color: #fff; }
        :global(svg.feather) { width: 0.78rem; height: 0.78rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }
    .tool-btn.erase-btn.active {
        background: var(--danger, #e74c3c);
        border-color: var(--danger, #e74c3c);
        color: #fff;
    }

    /* Copies tab — entity list wrapper */
    .entities-list-wrap {
        flex: 0 0 auto;
        max-height: 180px;
        overflow: hidden;
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 4px;
        margin-bottom: 0.35rem;
        display: flex;
        flex-direction: column;
    }

    .sel-info {
        display: flex; align-items: center; justify-content: space-between;
        margin-bottom: 0.4rem;
    }
    .danger-sm {
        padding: 0.2rem 0.4rem;
        border: 1px solid var(--danger, #e74c3c);
        border-radius: 3px;
        background: transparent;
        color: var(--danger, #e74c3c);
        cursor: pointer;
        font-size: 0.75rem;
        display: inline-flex; align-items: center; gap: 0.25rem;
        &:hover { background: var(--danger, #e74c3c); color: #fff; }
        :global(svg.feather) { width: 0.75rem; height: 0.75rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }

    /* Copies tab — place mode: selected-template indicator in the tool row */
    .place-indicator {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.2rem 0.4rem;
        border: 1px solid var(--accent1, #446adb);
        border-radius: 3px;
        background: rgba(68, 106, 219, 0.12);
        font-size: 0.78rem;
        color: var(--text, #e0e0e0);
        max-width: 7rem;
        overflow: hidden;
    }
    .place-swatch {
        width: 0.72rem;
        height: 0.72rem;
        border-radius: 2px;
        flex-shrink: 0;
    }
    .place-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1 1 auto;
    }

    p { margin: 0; font-size: 0.85rem; }

    /* Multi-selection inspector (single-copy is handled by the floating RoomInspector) */
    .copy-inspector {
        display: flex; flex-direction: column; gap: 0.4rem;
        border-top: 1px solid var(--border-pale, #2a2a3e); padding-top: 0.4rem; margin-top: 0.2rem;
    }
    .insp-grid {
        display: grid; grid-template-columns: 4rem 1fr; gap: 0.2rem 0.4rem; align-items: center;
        span { font-size: 0.78rem; color: var(--text-dim, #888); }
        input { width: 100%; box-sizing: border-box; }
    }

    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.25rem 0.5rem;
        font-size: 0.82rem;
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        transition: all 0.12s;
        &.inline  { background: transparent; border-color: transparent; }
        &.square  { width: 1.8rem; height: 1.8rem; padding: 0; justify-content: center; }
        &:hover   { background: var(--act, #1e2233); border-color: var(--acttext, #7ec8e3); color: var(--acttext, #7ec8e3); }
        &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        :global(svg.feather) { width: 0.85rem; height: 0.85rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }

    /* ── UI gizmo SVG ───────────────────────────────────────────────────── */
    .ui-handles-svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
    }

</style>
