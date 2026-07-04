<script lang="ts">
    import Icon from "@iconify/svelte";
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { signals } from '../../stores/editorStore.js';
    import { updateAsset, projectFilePath } from '../../stores/projectStore.js';
    import { electronAPI, isElectron } from '../../lib/electron.js';
    import type { NyxTexture, CollisionShape } from '@nyx/shared';
    import ColorPicker from '@nyx/ui-kit/ColorPicker.svelte';

    interface Props { asset: NyxTexture; }
    let { asset }: Props = $props();

    let origname  = $state(asset.origname);
    let grid      = $state<[number, number]>([...asset.grid]);
    let width     = $state(asset.width);
    let height    = $state(asset.height);
    let offx      = $state(asset.offx);
    let offy      = $state(asset.offy);
    let marginx   = $state(asset.marginx);
    let marginy   = $state(asset.marginy);
    let axis      = $state<[number, number]>([...asset.axis]);
    let padding   = $state(asset.padding);
    let shape     = $state<CollisionShape>(JSON.parse(JSON.stringify(asset.shape)));
    let frameIdx  = $state(asset.frame);
    let previewBg = $state('#1a1a2e');
    let canvasEl   = $state<HTMLCanvasElement | undefined>(undefined);
    let imgEl      = $state<HTMLImageElement | undefined>(undefined);
    let imageUrl   = $state<string>('');
    let imageLoaded = $state(false);
    let justImported = false;
    let prevUid      = asset.uid;
    let zoom     = $state(1);
    let stageEl  = $state<HTMLDivElement | undefined>(undefined);
    let playing   = $state(false);
    let fps       = $state(10);
    let previewEl = $state<HTMLCanvasElement | undefined>(undefined);
    const PREVIEW_MAX = 176; // fits inside 230px panel with padding

    // ── Drag state for interactive collision editing ───────────────────────────
    type DragState =
        | null
        | { kind: 'point'; idx: number }
        | { kind: 'rect';  x0: number; y0: number }
        | { kind: 'circle' };
    let dragState = $state<DragState>(null);
    const HIT_RADIUS = 8; // canvas-space px for point snap/grab

    function getProjectImageUrl(name: string): string {
        const fp = get(projectFilePath);
        if (!fp || !name) return '';
        const dir = fp.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        return `nyx-asset://localhost/${dir}/img/${encodeURIComponent(name)}`;
    }

    $effect(() => {
        if (asset.uid === prevUid) return;
        prevUid  = asset.uid;
        playing  = false;
        origname = asset.origname;
        grid     = [...asset.grid];
        width    = asset.width;
        height   = asset.height;
        offx     = asset.offx;
        offy     = asset.offy;
        marginx  = asset.marginx;
        marginy  = asset.marginy;
        axis     = [...asset.axis];
        padding  = asset.padding;
        shape    = JSON.parse(JSON.stringify(asset.shape));
        frameIdx = asset.frame;
    });

    async function importImage() {
        if (!isElectron()) return;
        const fp = get(projectFilePath);
        if (!fp) return;
        const result = await electronAPI().dialog.showOpenDialog({
            title: 'Import texture',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
            properties: ['openFile']
        });
        if (result.canceled || result.filePaths.length === 0) return;
        const { origname: copied } = await electronAPI().texture.import({
            sourcePath: result.filePaths[0],
            projectFilePath: fp,
            uid: asset.uid,
        });
        origname     = copied;
        imageLoaded  = false;
        justImported = true;
        imageUrl     = getProjectImageUrl(copied);
    }

    function setShapeType(type: CollisionShape['type']) {
        switch (type) {
            case 'rect':
                shape = { type: 'rect', top: 0, bottom: height, left: 0, right: width };
                break;
            case 'circle':
                shape = { type: 'circle', r: Math.min(width, height) / 2 };
                break;
            case 'strip':
                shape = { type: 'strip', points: [{ x: 0, y: height / 2 }, { x: width, y: height / 2 }], closedStrip: false };
                break;
            case 'point':
                shape = { type: 'point' };
                break;
        }
        persist();
    }

    function fillRect() {
        if (shape.type === 'rect') {
            shape = { type: 'rect', top: 0, bottom: height, left: 0, right: width };
            persist();
        }
    }

    function addStripPoint() {
        if (shape.type === 'strip') {
            shape = { ...shape, points: [...shape.points, { x: width / 2, y: height / 2 }] };
            persist();
        }
    }

    function removeStripPoint(i: number) {
        if (shape.type === 'strip' && shape.points.length > 2) {
            shape = { ...shape, points: shape.points.filter((_, idx) => idx !== i) };
            persist();
        }
    }

    // ── Geometry helpers ──────────────────────────────────────────────────────
    function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return { dist: Math.hypot(px - ax, py - ay), ix: ax, iy: ay };
        const t  = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
        const ix = ax + t * dx;
        const iy = ay + t * dy;
        return { dist: Math.hypot(px - ix, py - iy), ix, iy };
    }

    // ── Canvas coord helpers ───────────────────────────────────────────────────
    function canvasCoords(e: PointerEvent | MouseEvent) {
        if (!canvasEl) return { cx: 0, cy: 0 };
        const bbox = canvasEl.getBoundingClientRect();
        return {
            cx: (e.clientX - bbox.left) * (canvasEl.width  / bbox.width),
            cy: (e.clientY - bbox.top)  * (canvasEl.height / bbox.height),
        };
    }

    function frameOrigin() {
        const cols   = grid[0] || 1;
        const selCol = frameIdx % cols;
        const selRow = Math.floor(frameIdx / cols);
        return {
            sfx: offx + selCol * (width + marginx),
            sfy: offy + selRow * (height + marginy),
        };
    }

    // ── Pointer event handlers ────────────────────────────────────────────────
    function onPointerDown(e: PointerEvent) {
        if (!canvasEl || !imageLoaded) return;
        const { cx, cy } = canvasCoords(e);
        const cols = grid[0] || 1;
        const rows = grid[1] || 1;
        const col  = Math.floor((cx - offx) / (width + marginx));
        const row  = Math.floor((cy - offy) / (height + marginy));

        if (col < 0 || col >= cols || row < 0 || row >= rows) return;

        const clicked = row * cols + col;
        if (clicked !== frameIdx) {
            // Different frame — just select it
            frameIdx = clicked;
            persist();
            return;
        }

        // Same frame → start collision interaction
        const { sfx, sfy } = frameOrigin();
        const fx = cx - sfx;
        const fy = cy - sfy;

        if (shape.type === 'strip') {
            const pts = shape.points;

            // 1. Point hit — drag existing point
            const hitIdx = pts.findIndex(pt => Math.hypot(pt.x - fx, pt.y - fy) <= HIT_RADIUS);
            if (hitIdx >= 0) {
                dragState = { kind: 'point', idx: hitIdx };
            } else {
                // 2. Segment hit — insert between the two closest neighbours
                const segCount = shape.closedStrip ? pts.length : pts.length - 1;
                let bestDist = Infinity, bestSeg = -1, bestIx = fx, bestIy = fy;
                for (let i = 0; i < segCount; i++) {
                    const a = pts[i], b = pts[(i + 1) % pts.length];
                    const { dist, ix, iy } = distToSegment(fx, fy, a.x, a.y, b.x, b.y);
                    if (dist < bestDist) { bestDist = dist; bestSeg = i; bestIx = ix; bestIy = iy; }
                }
                if (bestSeg >= 0 && bestDist <= HIT_RADIUS) {
                    const newPts = [
                        ...pts.slice(0, bestSeg + 1),
                        { x: Math.round(bestIx), y: Math.round(bestIy) },
                        ...pts.slice(bestSeg + 1),
                    ];
                    shape     = { ...shape, points: newPts };
                    dragState = { kind: 'point', idx: bestSeg + 1 };
                } else {
                    // 3. Open space — append new point at end
                    const newPts = [...pts, { x: Math.round(fx), y: Math.round(fy) }];
                    shape        = { ...shape, points: newPts };
                    dragState    = { kind: 'point', idx: newPts.length - 1 };
                }
            }
            (e.target as Element).setPointerCapture(e.pointerId);
        } else if (shape.type === 'rect') {
            const x0 = Math.round(fx);
            const y0 = Math.round(fy);
            dragState = { kind: 'rect', x0, y0 };
            shape     = { type: 'rect', left: x0, right: x0, top: y0, bottom: y0 };
            (e.target as Element).setPointerCapture(e.pointerId);
        } else if (shape.type === 'circle') {
            dragState = { kind: 'circle' };
            const dx  = fx - width  / 2;
            const dy  = fy - height / 2;
            shape     = { type: 'circle', r: Math.max(1, Math.round(Math.hypot(dx, dy))) };
            (e.target as Element).setPointerCapture(e.pointerId);
        }
    }

    function onPointerMove(e: PointerEvent) {
        const ds = dragState;
        if (!ds || !canvasEl) return;
        const { cx, cy } = canvasCoords(e);
        const { sfx, sfy } = frameOrigin();
        const fx = cx - sfx;
        const fy = cy - sfy;

        if (ds.kind === 'point' && shape.type === 'strip') {
            const pts = shape.points.map((pt, i) =>
                i === ds.idx ? { x: Math.round(fx), y: Math.round(fy) } : pt
            );
            shape = { ...shape, points: pts };
        } else if (ds.kind === 'rect' && shape.type === 'rect') {
            shape = {
                type:   'rect',
                left:   Math.round(Math.min(ds.x0, fx)),
                right:  Math.round(Math.max(ds.x0, fx)),
                top:    Math.round(Math.min(ds.y0, fy)),
                bottom: Math.round(Math.max(ds.y0, fy)),
            };
        } else if (ds.kind === 'circle' && shape.type === 'circle') {
            const dx = fx - width  / 2;
            const dy = fy - height / 2;
            shape = { type: 'circle', r: Math.max(1, Math.round(Math.hypot(dx, dy))) };
        }
    }

    function onPointerUp(_e: PointerEvent) {
        if (!dragState) return;
        dragState = null;
        persist();
    }

    function onContextMenu(e: MouseEvent) {
        if (shape.type !== 'strip') return;
        e.preventDefault();
        const { cx, cy } = canvasCoords(e);
        const { sfx, sfy } = frameOrigin();
        const fx = cx - sfx;
        const fy = cy - sfy;
        const hitIdx = shape.points.findIndex(pt => Math.hypot(pt.x - fx, pt.y - fy) <= HIT_RADIUS);
        if (hitIdx >= 0 && shape.points.length > 2) {
            shape = { ...shape, points: shape.points.filter((_, i) => i !== hitIdx) };
            persist();
        }
    }

    // ── Canvas drawing ────────────────────────────────────────────────────────
    function drawCanvas() {
        if (!canvasEl) return;
        const ctx = canvasEl.getContext('2d');
        if (!ctx) return;

        const iw = (imgEl && imageLoaded) ? imgEl.naturalWidth  : (width  + offx + marginx);
        const ih = (imgEl && imageLoaded) ? imgEl.naturalHeight : (height + offy + marginy);
        canvasEl.width  = iw;
        canvasEl.height = ih;

        ctx.clearRect(0, 0, iw, ih);
        ctx.fillStyle = previewBg;
        ctx.fillRect(0, 0, iw, ih);
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#000000';
        for (let y = 0; y < ih; y += 8)
            for (let x = 0; x < iw; x += 8)
                if (((x + y) / 8) % 2 === 0) ctx.fillRect(x, y, 8, 8);
        ctx.restore();

        if (imgEl && imageLoaded) ctx.drawImage(imgEl, 0, 0);

        const cols  = grid[0] || 1;
        const rows  = grid[1] || 1;
        const stepX = width  + marginx;
        const stepY = height + marginy;

        // Frame grid + index labels
        ctx.strokeStyle = 'rgba(68,106,219,0.45)';
        ctx.lineWidth   = 1;
        ctx.font        = 'bold 11px monospace';
        ctx.fillStyle   = 'rgba(255,255,255,0.55)';
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const fx = offx + col * stepX;
                const fy = offy + row * stepY;
                ctx.strokeRect(fx + 0.5, fy + 0.5, width - 1, height - 1);
                ctx.fillText(String(row * cols + col), fx + 4, fy + 13);
            }
        }

        // Selected frame highlight
        const selCol = frameIdx % cols;
        const selRow = Math.floor(frameIdx / cols);
        const sfx = offx + selCol * stepX;
        const sfy = offy + selRow * stepY;
        ctx.strokeStyle = '#446adb';
        ctx.lineWidth   = 2;
        ctx.strokeRect(sfx - 0.5, sfy - 0.5, width + 1, height + 1);

        // Pivot crosshair
        const px = sfx + axis[0] * width;
        const py = sfy + axis[1] * height;
        ctx.strokeStyle = '#f5a623';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(px - 5, py); ctx.lineTo(px + 5, py);
        ctx.moveTo(px, py - 5); ctx.lineTo(px, py + 5);
        ctx.stroke();

        // Collision shape + interactive handles
        ctx.strokeStyle = '#27ae60';
        ctx.lineWidth   = 1.5;

        if (shape.type === 'rect') {
            ctx.beginPath();
            ctx.strokeRect(
                sfx + shape.left + 0.5, sfy + shape.top + 0.5,
                (shape.right - shape.left) - 1, (shape.bottom - shape.top) - 1
            );
            // Corner handles
            ctx.fillStyle = '#27ae60';
            for (const [hx, hy] of [
                [shape.left,  shape.top],    [shape.right, shape.top],
                [shape.left,  shape.bottom], [shape.right, shape.bottom],
            ] as [number, number][]) {
                ctx.fillRect(sfx + hx - 3, sfy + hy - 3, 6, 6);
            }
        } else if (shape.type === 'circle') {
            const cx2 = sfx + width  / 2;
            const cy2 = sfy + height / 2;
            ctx.beginPath();
            ctx.arc(cx2, cy2, shape.r, 0, Math.PI * 2);
            ctx.stroke();
            // Radius drag handle
            ctx.fillStyle = '#27ae60';
            ctx.beginPath();
            ctx.arc(cx2 + shape.r, cy2, 4, 0, Math.PI * 2);
            ctx.fill();
        } else if (shape.type === 'strip') {
            const pts = shape.points;
            if (pts.length > 0) {
                ctx.beginPath();
                ctx.moveTo(sfx + pts[0].x, sfy + pts[0].y);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(sfx + pts[i].x, sfy + pts[i].y);
                if (shape.closedStrip) ctx.closePath();
                ctx.stroke();
            }
            // Point handles (filled circles)
            ctx.fillStyle = '#27ae60';
            for (const pt of pts) {
                ctx.beginPath();
                ctx.arc(sfx + pt.x, sfy + pt.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // ── Animation preview (separate small canvas in left panel) ───────────────
    function drawPreview() {
        if (!previewEl || !imgEl || !imageLoaded) return;
        const ctx = previewEl.getContext('2d');
        if (!ctx) return;

        const scale = Math.min(PREVIEW_MAX / Math.max(width, 1), PREVIEW_MAX / Math.max(height, 1));
        const pw = Math.max(1, Math.round(width  * scale));
        const ph = Math.max(1, Math.round(height * scale));
        previewEl.width  = pw;
        previewEl.height = ph;

        const cols   = grid[0] || 1;
        const selCol = frameIdx % cols;
        const selRow = Math.floor(frameIdx / cols);
        const sfx    = offx + selCol * (width  + marginx);
        const sfy    = offy + selRow * (height + marginy);

        ctx.fillStyle = previewBg;
        ctx.fillRect(0, 0, pw, ph);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(imgEl, sfx, sfy, width, height, 0, 0, pw, ph);
    }

    $effect(() => {
        void frameIdx; void imageLoaded; void width; void height;
        void offx; void offy; void marginx; void marginy; void grid; void previewBg;
        drawPreview();
    });

    // ── Playback ───────────────────────────────────────────────────────────────
    function totalFrames() { return (grid[0] || 1) * (grid[1] || 1); }

    function stepFrame(delta: number) {
        frameIdx = ((frameIdx + delta) + totalFrames()) % totalFrames();
    }

    $effect(() => {
        if (!playing) return;
        const id = setInterval(() => {
            frameIdx = (frameIdx + 1) % totalFrames();
        }, 1000 / Math.max(1, fps));
        return () => clearInterval(id);
    });

    function onStageWheel(e: WheelEvent) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoom = Math.max(0.25, Math.min(8, zoom * factor));
    }

    $effect(() => {
        void width; void height; void offx; void offy; void marginx; void marginy;
        void shape; void axis; void imageLoaded; void previewBg; void grid; void frameIdx;
        drawCanvas();
    });

    onMount(() => {
        if (asset.origname) imageUrl = getProjectImageUrl(asset.origname);
        stageEl?.addEventListener('wheel', onStageWheel, { passive: false });
        return () => stageEl?.removeEventListener('wheel', onStageWheel);
    });

    function onGridChange() {
        if (imageLoaded && imgEl) {
            width  = Math.floor(imgEl.naturalWidth  / (grid[0] || 1));
            height = Math.floor(imgEl.naturalHeight / (grid[1] || 1));
        }
        persist();
    }

    function persist() {
        updateAsset<NyxTexture>(asset.uid, 'texture', {
            origname, grid, width, height, offx, offy, marginx, marginy, axis, padding, shape, frame: frameIdx
        });
        signals.emit('assetChanged');
    }

    const PIVOT_PRESETS = [
        ['TL', 0, 0],   ['TC', 0.5, 0],   ['TR', 1, 0],
        ['ML', 0, 0.5], ['C',  0.5, 0.5], ['MR', 1, 0.5],
        ['BL', 0, 1],   ['BC', 0.5, 1],   ['BR', 1, 1],
    ] as const;
</script>

<div class="texture-editor">

    <!-- ── Left panel: source + slicing ── -->
    <div class="side-col left-col">
        <div class="col-header">
            <h3 class="nm">{asset.name}</h3>
        </div>
        <div class="col-body">

            <fieldset>
                <legend>Source</legend>
                <div class="file-row">
                    <span class="filename dim">{origname || '(no file)'}</span>
                </div>
                <div class="btn-row">
                    <button onclick={importImage} disabled={!isElectron()}>
                        <Icon icon="feather:folder" class="feather"/>
                        Import…
                    </button>
                </div>
                {#if imageUrl}
                    <!-- svelte-ignore a11y_missing_attribute -->
                    <img
                        bind:this={imgEl}
                        src={imageUrl}
                        style="display:none"
                        onload={() => {
                            imageLoaded = true;
                            if (imgEl) {
                                const nw = imgEl.naturalWidth;
                                const nh = imgEl.naturalHeight;
                                // Auto-set dimensions when: explicit import, OR stored grid doesn't
                                // span the actual image (catches textures created via asset browser
                                // where default 64×64 was never updated to the real image size).
                                const storedW = width  * (grid[0] || 1);
                                const storedH = height * (grid[1] || 1);
                                if (justImported || storedW !== nw || storedH !== nh) {
                                    width        = Math.floor(nw / (grid[0] || 1));
                                    height       = Math.floor(nh / (grid[1] || 1));
                                    shape        = { type: 'rect', top: 0, bottom: height, left: 0, right: width };
                                    justImported = false;
                                    persist();
                                }
                            }
                            drawCanvas();
                        }}
                    />
                {/if}
            </fieldset>

            <fieldset>
                <legend>Slicing</legend>
                <div class="field-grid">
                    <span>Columns</span>
                    <input type="number" bind:value={grid[0]} oninput={onGridChange} min="1" max="256" />
                    <span>Rows</span>
                    <input type="number" bind:value={grid[1]} oninput={onGridChange} min="1" max="256" />
                    <span>Frame W</span>
                    <input type="number" bind:value={width} oninput={persist} min="1" />
                    <span>Frame H</span>
                    <input type="number" bind:value={height} oninput={persist} min="1" />
                    <span>Off X</span>
                    <input type="number" bind:value={offx} oninput={persist} min="0" />
                    <span>Off Y</span>
                    <input type="number" bind:value={offy} oninput={persist} min="0" />
                    <span>Margin X</span>
                    <input type="number" bind:value={marginx} oninput={persist} min="0" />
                    <span>Margin Y</span>
                    <input type="number" bind:value={marginy} oninput={persist} min="0" />
                    <span>Padding</span>
                    <input type="number" bind:value={padding} oninput={persist} min="0" max="8" />
                </div>
            </fieldset>

            <fieldset class="preview-fieldset">
                <legend>Preview</legend>
                <div class="preview-stage">
                    {#if imageLoaded}
                        <canvas bind:this={previewEl} class="preview-single"></canvas>
                    {:else}
                        <div class="preview-placeholder dim">No image</div>
                    {/if}
                </div>
                <div class="preview-controls">
                    <button class="inline" title="First frame" onclick={() => { playing = false; frameIdx = 0; }}>
                        <Icon icon="feather:skip-back" class="feather"/>
                    </button>
                    <button class="inline" title="Previous frame" onclick={() => { playing = false; stepFrame(-1); }}>
                        <Icon icon="feather:chevron-left" class="feather"/>
                    </button>
                    <button class="inline play-btn" class:active={playing} title={playing ? 'Pause' : 'Play'}
                            onclick={() => { playing = !playing; }}>
                        <Icon icon={playing ? 'feather:pause' : 'feather:play'} class="feather"/>
                    </button>
                    <button class="inline" title="Next frame" onclick={() => { playing = false; stepFrame(1); }}>
                        <Icon icon="feather:chevron-right" class="feather"/>
                    </button>
                    <button class="inline" title="Last frame" onclick={() => { playing = false; frameIdx = totalFrames() - 1; }}>
                        <Icon icon="feather:skip-forward" class="feather"/>
                    </button>
                </div>
                <div class="preview-meta dim">
                    <span class="frame-counter">{frameIdx + 1} / {totalFrames()}</span>
                    <span class="preview-sep">·</span>
                    <span>FPS</span>
                    <input class="fps-input" type="number" bind:value={fps} min="1" max="60" />
                </div>
            </fieldset>

        </div>
    </div>

    <!-- ── Center: canvas ── -->
    <div class="canvas-col">
        <div class="canvas-stage" bind:this={stageEl}>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <canvas
                bind:this={canvasEl}
                class="preview-canvas"
                onpointerdown={onPointerDown}
                onpointermove={onPointerMove}
                onpointerup={onPointerUp}
                onpointerleave={onPointerUp}
                oncontextmenu={onContextMenu}
                style:cursor={dragState ? 'grabbing' : 'crosshair'}
                style:transform="scale({zoom})"
                style:transform-origin="center center"
            ></canvas>
        </div>
        <div class="canvas-footer">
            <Icon icon="feather:square"    class="feather legend-dot" style="stroke:#446adb" /> Frame
            <Icon icon="feather:crosshair" class="feather legend-dot ml" style="stroke:#f5a623" /> Pivot
            <Icon icon="feather:shield"    class="feather legend-dot ml" style="stroke:#27ae60" /> Collision
            <span class="footer-spacer"></span>
            <div class="zoom-controls">
                <button class="inline" title="Zoom out" onclick={() => { zoom = Math.max(0.25, zoom / 1.5); }}>
                    <Icon icon="feather:minus" class="feather"/>
                </button>
                <button class="inline zoom-label" title="Reset zoom to 100%" onclick={() => { zoom = 1; }}>
                    {Math.round(zoom * 100)}%
                </button>
                <button class="inline" title="Zoom in" onclick={() => { zoom = Math.min(8, zoom * 1.5); }}>
                    <Icon icon="feather:plus" class="feather"/>
                </button>
            </div>
            <span class="dim footer-sep">|</span>
            <span class="dim" style="font-size:0.72rem">Bg</span>
            <ColorPicker value={previewBg} onchange={(c) => { previewBg = c; }} />
        </div>
    </div>

    <!-- ── Right panel: pivot + collision ── -->
    <div class="side-col right-col">
        <div class="col-header">
            <span class="col-title">Pivot</span>
        </div>
        <div class="col-body">

            <fieldset>
                <legend>Rotation axis (0–1)</legend>
                <div class="field-grid">
                    <span>X</span>
                    <input type="number" bind:value={axis[0]} oninput={persist} step="0.05" min="0" max="1" />
                    <span>Y</span>
                    <input type="number" bind:value={axis[1]} oninput={persist} step="0.05" min="0" max="1" />
                </div>
                <button class="wide mt" onclick={() => { axis = [0.5, 0.5]; persist(); }}>
                    <Icon icon="feather:crosshair" class="feather"/> Image's center
                </button>
                <div class="pivot-presets mt">
                    {#each PIVOT_PRESETS as [lbl, ax, ay]}
                        <button
                            class="preset-btn"
                            class:selected={axis[0] === ax && axis[1] === ay}
                            onclick={() => { axis = [ax, ay]; persist(); }}
                        >{lbl}</button>
                    {/each}
                </div>
            </fieldset>

            <div class="col-header" style="margin-top:0.5rem">
                <span class="col-title">Collision</span>
            </div>

            <fieldset>
                <legend>Shape</legend>
                <div class="shape-radios">
                    {#each (['rect', 'circle', 'strip', 'point'] as const) as t}
                        <label class="radio">
                            <input type="radio" name="shape" checked={shape.type === t} onchange={() => setShapeType(t)} />
                            <span>{t}</span>
                        </label>
                    {/each}
                </div>

                {#if shape.type === 'rect'}
                    <div class="canvas-hint dim">Drag on canvas to draw</div>
                    <div class="field-grid mt">
                        <span>Top</span>
                        <input type="number" bind:value={shape.top}    oninput={persist} />
                        <span>Bottom</span>
                        <input type="number" bind:value={shape.bottom} oninput={persist} />
                        <span>Left</span>
                        <input type="number" bind:value={shape.left}   oninput={persist} />
                        <span>Right</span>
                        <input type="number" bind:value={shape.right}  oninput={persist} />
                    </div>
                    <button class="wide mt" onclick={fillRect}>
                        <Icon icon="feather:maximize" class="feather"/> Fill frame
                    </button>
                {/if}

                {#if shape.type === 'circle'}
                    <div class="canvas-hint dim">Drag on canvas to set radius</div>
                    <div class="field-grid mt">
                        <span>Radius</span>
                        <input type="number" bind:value={shape.r} oninput={persist} min="1" />
                    </div>
                {/if}

                {#if shape.type === 'strip'}
                    <div class="canvas-hint dim">Click canvas to add · drag to move</div>
                    <div class="points-list mt">
                        {#each shape.points as pt, i}
                            <div class="point-row">
                                <input type="number" bind:value={pt.x} oninput={persist} />
                                <span class="dim">×</span>
                                <input type="number" bind:value={pt.y} oninput={persist} />
                                <button class="inline square" onclick={() => removeStripPoint(i)} disabled={shape.points.length <= 2}>
                                    <Icon icon="feather:minus" class="feather"/>
                                </button>
                            </div>
                        {/each}
                    </div>
                    <button class="wide mt" onclick={addStripPoint}>
                        <Icon icon="feather:plus" class="feather"/> Add point
                    </button>
                    <label class="checkbox-wrap mt">
                        <input type="checkbox" bind:checked={shape.closedStrip} onchange={persist} />
                        Close shape
                    </label>
                {/if}

                {#if shape.type === 'point'}
                    <p class="dim" style="font-size:0.78rem;margin:0.5rem 0 0">Single point — no bounds.</p>
                {/if}
            </fieldset>

        </div>
    </div>

</div>

<style>
    .texture-editor {
        display: flex;
        flex-flow: row nowrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
        position: relative;
    }

    /* ── Side panels ── */
    .side-col {
        flex: 0 0 230px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--background, #1a1a2e);
    }

    .left-col  { border-right: 1px solid var(--border-bright, #333); }
    .right-col { border-left:  1px solid var(--border-bright, #333); }

    .col-header {
        padding: 0.45rem 0.75rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    h3, .col-title { font-size: 0.88rem; margin: 0; font-weight: 600; color: var(--text, #e0e0e0); }

    .col-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 0.6rem 0.65rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    /* ── Fieldsets ── */
    fieldset {
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 4px;
        padding: 0.45rem 0.65rem 0.65rem;
        margin: 0;
    }
    legend { font-size: 0.75rem; color: var(--text-dim, #888); padding: 0 0.2rem; }

    /* ── Field layouts ── */
    .file-row  { font-size: 0.78rem; margin-bottom: 0.4rem; }
    .filename  { font-family: monospace; word-break: break-all; color: var(--text-dim, #888); }
    .btn-row   { display: flex; gap: 0.4rem; flex-wrap: wrap; }

    .field-grid {
        display: grid;
        grid-template-columns: 58px 1fr;
        gap: 0.22rem 0.4rem;
        align-items: center;
    }
    .field-grid span { font-size: 0.76rem; color: var(--text-dim, #888); }

    .canvas-hint  { font-size: 0.72rem; margin: 0.35rem 0 0; font-style: italic; }

    /* ── Pivot presets ── */
    .pivot-presets {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.22rem;
    }
    .preset-btn {
        padding: 0.18rem 0;
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        background: var(--background-deeper, #111122);
        color: var(--text-dim, #888);
        cursor: pointer;
        font-size: 0.72rem;
        transition: all 0.1s;
        &:hover   { background: var(--act, #1e2233); color: var(--acttext, #7ec8e3); }
        &.selected { background: var(--accent1, #446adb); color: #fff; border-color: var(--accent1, #446adb); }
    }

    /* ── Collision ── */
    .shape-radios { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    label.radio   { display: flex; align-items: center; gap: 0.25rem; font-size: 0.78rem; cursor: pointer; color: var(--text, #e0e0e0); }

    .points-list { display: flex; flex-direction: column; gap: 0.25rem; }
    .point-row   { display: flex; align-items: center; gap: 0.25rem; }
    .point-row input { flex: 1 1 auto; }

    .checkbox-wrap { display: flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; cursor: pointer; color: var(--text, #e0e0e0); }

    /* ── Canvas center ── */
    .canvas-col {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--background-deeper, #111122);
    }

    .canvas-stage {
        flex: 1 1 auto;
        overflow: auto;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background:
            repeating-conic-gradient(#1a1a2e 0% 25%, #111122 0% 50%)
            0 0 / 16px 16px;
    }

    .preview-canvas { image-rendering: pixelated; display: block; }

    /* ── Animation preview panel ── */
    .preview-fieldset { padding-bottom: 0.5rem; }
    .preview-stage {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0.4rem;
        margin-bottom: 0.4rem;
    }
    .preview-single {
        image-rendering: pixelated;
        display: block;
        max-width: 100%;
        max-height: 160px;
    }
    .preview-placeholder { font-size: 0.75rem; }
    .preview-controls {
        display: flex;
        justify-content: center;
        gap: 0;
        margin-bottom: 0.3rem;
    }
    .play-btn        { color: var(--text-dim, #888); }
    .play-btn.active { color: var(--acttext, #7ec8e3); }
    .preview-meta {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.3rem;
        font-size: 0.72rem;
    }
    .preview-sep   { opacity: 0.4; }
    .frame-counter { font-variant-numeric: tabular-nums; }
    .fps-input {
        width: 2.6rem;
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.1rem 0.25rem;
        font-size: 0.72rem;
        text-align: center;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .canvas-footer {
        padding: 0.3rem 0.75rem;
        font-size: 0.72rem;
        border-top: 1px solid var(--border-pale, #2a2a3e);
        display: flex;
        align-items: center;
        gap: 0.3rem;
        flex-shrink: 0;
        color: var(--text-dim, #888);
    }
    :global(.legend-dot) { width: 0.68rem; height: 0.68rem; fill: none; stroke-width: 2.5; }
    :global(.ml) { margin-left: 0.6rem; }
    .footer-spacer { flex: 1 1 auto; }
    .footer-sep    { margin: 0 0.25rem; opacity: 0.3; }
    .zoom-controls { display: flex; align-items: center; gap: 0; }
    .zoom-label    { min-width: 3rem; text-align: center; font-size: 0.72rem; font-variant-numeric: tabular-nums; }

    /* ── Shared inputs ── */
    input[type="number"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.18rem 0.28rem;
        font-size: 0.78rem;
        width: 100%;
        box-sizing: border-box;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .mt   { margin-top: 0.45rem; }
    .dim  { color: var(--text-dim, #888); }
    .wide { width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.3rem; }

    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.22rem 0.45rem;
        font-size: 0.8rem;
        display: inline-flex;
        align-items: center;
        gap: 0.28rem;
        transition: all 0.1s;
        &.inline { background: transparent; border-color: transparent; }
        &.square { width: 1.4rem; height: 1.4rem; padding: 0; justify-content: center; }
        &:hover  { background: var(--act, #1e2233); border-color: var(--acttext, #7ec8e3); color: var(--acttext, #7ec8e3); }
        &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        :global(svg.feather) { width: 0.8rem; height: 0.8rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }


</style>
