<script lang="ts">
    /**
     * TextureGenerator.svelte
     * Migrated from: editors/texture-generator.tag
     *
     * Procedurally draws a new texture onto a <canvas> and saves it as a new
     * NyxTexture asset in the current project.
     *
     * Props:
     *   folder   – optional NyxFolder to place the created asset into
     *   onclose  – called (with no args) when the user dismisses the generator
     *   oncreated – called after a texture is successfully created
     */
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import Icon from '@iconify/svelte';
    import { createAsset, isNameTaken, updateAsset, projectFilePath } from '../../stores/projectStore.js';
    import { electronAPI, isElectron } from '../../lib/electron.js';
    import type { NyxFolder, NyxTexture } from '@nyx/shared';

    // ── Props ──────────────────────────────────────────────────────────────────
    interface Props {
        folder?: NyxFolder | null;
        onclose?: () => void;
        oncreated?: (asset: NyxTexture) => void;
    }
    let { folder = null, onclose, oncreated }: Props = $props();

    // ── Generator state (mirrors legacy defaults exactly) ──────────────────────
    type FormType   = 'rect' | 'round' | 'diamond';
    type FillerType = 'none' | 'cross' | 'arrow' | 'label';

    let textureName:  string     = $state('Placeholder');
    let textureWidth: number     = $state(64);
    let textureHeight: number    = $state(64);
    let textureColor: string     = $state('#446adb');
    let textureLabel: string     = $state('');
    let form:  FormType          = $state('rect');
    let filler: FillerType       = $state('label');

    // UI state
    let nameTaken   = $state(false);
    let saving      = $state(false);
    let errorNotice = $state<HTMLElement | undefined>(undefined);

    // Canvas ref
    let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);

    /** True when the canvas should be rendered at 4× CSS scale (small texture) */
    let small = $derived(textureWidth < 64 && textureHeight < 64);

    // ── Canvas drawing (exact port of legacy refreshCanvas + drawForm) ─────────
    function drawForm(ctx: CanvasRenderingContext2D, w: number, h: number): void {
        ctx.fillStyle = textureColor;
        if (form === 'rect') {
            ctx.fillRect(0, 0, w, h);
        } else if (form === 'round') {
            ctx.beginPath();
            ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fill();
        } else if (form === 'diamond') {
            ctx.beginPath();
            ctx.moveTo(w / 2, 0);
            ctx.lineTo(w, h / 2);
            ctx.lineTo(w / 2, h);
            ctx.lineTo(0, h / 2);
            ctx.closePath();
            ctx.fill();
        }
    }

    function refreshCanvas(): void {
        if (!canvasEl) return;
        const ctx = canvasEl.getContext('2d');
        if (!ctx) return;

        canvasEl.width  = textureWidth;
        canvasEl.height = textureHeight;
        const w = canvasEl.width;
        const h = canvasEl.height;

        ctx.clearRect(0, 0, w, h);
        drawForm(ctx, w, h);

        // Determine whether the fill colour is "dark" to pick contrast ink
        const dark = isDark(textureColor);

        if (filler === 'label') {
            const label = textureLabel.trim() || `${w}×${h}`;

            // Fit text into 80% of canvas width (mirrors legacy exactly)
            ctx.font = '100px sans-serif';
            const measure = ctx.measureText(label).width;
            let k = (w * 0.8) / measure;
            if (k * 100 > h * 0.8) {
                k = (h * 0.8) / 100;
            }
            ctx.font          = `${Math.round(k * 100)}px sans-serif`;
            ctx.textBaseline  = 'middle';
            ctx.textAlign     = 'center';
            ctx.fillStyle     = dark ? '#fff' : '#000';
            ctx.fillText(label, w / 2, h / 2);

        } else if (filler === 'cross') {
            ctx.beginPath();
            ctx.strokeStyle = dark ? '#fff' : '#000';
            ctx.lineWidth   = w > 16 && h > 16 ? 2 : 1;
            if (form === 'rect') {
                ctx.moveTo(0, 0);  ctx.lineTo(w, h);
                ctx.moveTo(w, 0);  ctx.lineTo(0, h);
            } else if (form === 'round') {
                const dx = Math.cos(Math.PI / 4) * (w / 2);
                const dy = Math.sin(Math.PI / 4) * (h / 2);
                ctx.moveTo(w / 2 + dx, h / 2 + dy); ctx.lineTo(w / 2 - dx, h / 2 - dy);
                ctx.moveTo(w / 2 - dx, h / 2 + dy); ctx.lineTo(w / 2 + dx, h / 2 - dy);
            } else if (form === 'diamond') {
                ctx.moveTo(w * 0.25, h * 0.25); ctx.lineTo(w * 0.75, h * 0.75);
                ctx.moveTo(w * 0.75, h * 0.25); ctx.lineTo(w * 0.25, h * 0.75);
            }
            ctx.stroke();

        } else if (filler === 'arrow') {
            const arrowSize = Math.min(w, h) * 0.2;
            ctx.beginPath();
            ctx.strokeStyle = dark ? '#fff' : '#000';
            ctx.lineWidth   = w > 16 && h > 16 ? 2 : 1;
            ctx.moveTo(w * 0.3, h * 0.5);
            ctx.lineTo(w * 0.7, h * 0.5);
            ctx.moveTo(w * 0.7 - arrowSize, h * 0.5 - arrowSize);
            ctx.lineTo(w * 0.7, h * 0.5);
            ctx.lineTo(w * 0.7 - arrowSize, h * 0.5 + arrowSize);
            ctx.stroke();
        }
        // filler === 'none' — nothing extra to draw
    }

    // Redraw whenever any generator parameter changes
    $effect(() => {
        void textureWidth; void textureHeight; void textureColor;
        void form; void filler; void textureLabel;
        refreshCanvas();
    });

    onMount(refreshCanvas);

    // ── Luminance helper (replaces brehautColor dependency) ───────────────────
    /** Returns true when the hex colour is perceptually dark (luminance < 0.5). */
    function isDark(hex: string): boolean {
        const c = hex.replace('#', '');
        const r = parseInt(c.substring(0, 2), 16) / 255;
        const g = parseInt(c.substring(2, 4), 16) / 255;
        const b = parseInt(c.substring(4, 6), 16) / 255;
        // sRGB relative luminance (WCAG formula)
        const lin = (x: number) => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.5;
    }

    // ── Shake animation (mirrors legacy jellify) ───────────────────────────────
    function shake(el: HTMLElement): void {
        el.classList.remove('shake');
        // Force reflow so re-adding the class restarts the animation
        void el.offsetWidth;
        el.classList.add('shake');
    }

    // ── Create logic (mirrors legacy this.create) ──────────────────────────────
    /**
     * Validates name, draws canvas, converts to PNG, creates the asset, and
     * writes the image file. Returns the new asset on success, null on failure.
     */
    async function create(): Promise<NyxTexture | null> {
        nameTaken = isNameTaken(textureName, 'texture');
        if (nameTaken) {
            if (errorNotice) shake(errorNotice);
            return null;
        }

        if (!canvasEl) return null;
        refreshCanvas();

        // Convert canvas to PNG data URL, then to Uint8Array
        const dataUrl    = canvasEl.toDataURL('image/png');
        const base64     = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const binary     = atob(base64);
        const pngData    = Array.from({ length: binary.length }, (_, i) => binary.charCodeAt(i));

        // Create the NyxTexture record in the project store first (gives us a uid)
        const asset = createAsset('texture', textureName, folder) as NyxTexture;

        // Persist the generated PNG to disk via Electron IPC
        if (isElectron()) {
            const fp = get(projectFilePath);
            if (fp) {
                const { origname } = await electronAPI().texture.saveGenerated({
                    pngData,
                    projectFilePath: fp,
                    uid: asset.uid,
                });
                // Patch the asset with the image filename + correct dimensions
                updateAsset<NyxTexture>(asset.uid, 'texture', {
                    origname,
                    width:  textureWidth,
                    height: textureHeight,
                    grid:   [1, 1],
                    shape:  { type: 'rect', top: 0, bottom: textureHeight, left: 0, right: textureWidth },
                    axis:   [0.5, 0.5],
                });
            }
        }

        return asset as NyxTexture;
    }

    async function handleCreate(): Promise<void> {
        if (saving) return;
        saving = true;
        try {
            await create();
        } finally {
            saving = false;
        }
    }

    async function handleCreateAndClose(): Promise<void> {
        if (saving) return;
        saving = true;
        try {
            const asset = await create();
            if (asset) {
                oncreated?.(asset);
                onclose?.();
            }
        } finally {
            saving = false;
        }
    }

    function handleClose(): void {
        onclose?.();
    }
</script>

<div class="texture-generator flexcol tall">
    <div class="flexrow tall">
        <!-- ── Left settings panel ── -->
        <div class="aPanel texture-generator-Settings nogrow">

            <!-- Name -->
            <fieldset>
                <label class="block">
                    <b>Name</b>
                    <input
                        class="wide"
                        type="text"
                        bind:value={textureName}
                        oninput={() => { nameTaken = false; }}
                    />
                </label>
                {#if nameTaken}
                    <div class="anErrorNotice" bind:this={errorNotice}>
                        This name is already taken.
                    </div>
                {/if}
            </fieldset>

            <!-- Dimensions + colour -->
            <fieldset>
                <label class="block">
                    <b>Width</b>
                    <input
                        class="wide"
                        type="number"
                        bind:value={textureWidth}
                        min="8"
                        step="8"
                    />
                </label>
                <label class="block">
                    <b>Height</b>
                    <input
                        class="wide"
                        type="number"
                        bind:value={textureHeight}
                        min="8"
                        step="8"
                    />
                </label>
                <label class="block">
                    <b>Color</b>
                    <input
                        class="wide color-input"
                        type="color"
                        bind:value={textureColor}
                    />
                </label>
            </fieldset>

            <!-- Form -->
            <fieldset>
                <b>Form</b>
                {#each (['rect', 'round', 'diamond'] as FormType[]) as f}
                    <label class="block checkbox">
                        <input
                            type="radio"
                            name="tg-form"
                            value={f}
                            checked={form === f}
                            onchange={() => { form = f; }}
                        />
                        <span>{f.charAt(0).toUpperCase() + f.slice(1)}</span>
                    </label>
                {/each}
            </fieldset>

            <!-- Filler -->
            <fieldset>
                <b>Filler</b>
                {#each (['none', 'cross', 'arrow', 'label'] as FillerType[]) as fi}
                    <label class="block checkbox">
                        <input
                            type="radio"
                            name="tg-filler"
                            value={fi}
                            checked={filler === fi}
                            onchange={() => { filler = fi; }}
                        />
                        <span>{fi.charAt(0).toUpperCase() + fi.slice(1)}</span>
                    </label>
                {/each}
            </fieldset>

            <!-- Optional label text (visible only when filler === 'label') -->
            {#if filler === 'label'}
                <fieldset>
                    <label class="block">
                        <b>Label</b>
                        <span class="dim"> (optional)</span>
                        <input class="wide" type="text" bind:value={textureLabel} />
                    </label>
                </fieldset>
            {/if}
        </div>

        <!-- ── Canvas preview ── -->
        <div class="texture-generator-aPreview">
            <canvas
                bind:this={canvasEl}
                style="image-rendering: {small ? 'pixelated' : 'unset'}; transform: scale({small ? 4 : 1});"
            ></canvas>
            {#if small}
                <div class="texture-generator-aScalingNotice">
                    Displayed at 4×
                </div>
            {/if}
        </div>
    </div>

    <!-- ── Action buttons ── -->
    <div class="flexrow nogrow action-row">
        <button onclick={handleCreateAndClose} disabled={saving}>
            <Icon icon="feather:check" class="feather" />
            <span>Create &amp; close</span>
        </button>
        <button onclick={handleCreate} disabled={saving}>
            <Icon icon="feather:loader" class="feather" />
            <span>Create &amp; continue</span>
        </button>
        <span class="spacer"></span>
        <button class="secondary" onclick={handleClose}>
            <Icon icon="feather:x" class="feather" />
            <span>Cancel</span>
        </button>
    </div>
</div>

<style>
    .texture-generator {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--background, #1a1a2e);
        color: var(--text, #e0e0e0);
    }

    .flexcol { display: flex; flex-direction: column; }
    .flexrow { display: flex; flex-direction: row; }
    .tall    { flex: 1 1 auto; overflow: hidden; }
    .nogrow  { flex-grow: 0; flex-shrink: 0; }

    /* ── Settings panel ──────────────────────────────────────────────────── */
    .texture-generator-Settings {
        width: 220px;
        overflow-y: auto;
        border-right: 1px solid var(--border-bright, #333);
        padding: 0.5rem 0.75rem;
        background: var(--background, #1a1a2e);
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    fieldset {
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 4px;
        padding: 0.4rem 0.6rem 0.6rem;
        margin-bottom: 0.5rem;
        margin-inline: 0;
    }

    label.block {
        display: block;
        font-size: 0.82rem;
        margin-bottom: 0.25rem;
    }

    label.checkbox {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        cursor: pointer;
        padding: 0.1rem 0;
    }

    b { font-size: 0.78rem; color: var(--text-dim, #888); display: block; margin-bottom: 0.2rem; }

    input.wide {
        width: 100%;
        box-sizing: border-box;
    }

    input[type="text"],
    input[type="number"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.35rem;
        font-size: 0.82rem;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    input.color-input {
        height: 2rem;
        padding: 0.1rem 0.2rem;
        cursor: pointer;
        border-radius: 3px;
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
    }

    input[type="radio"] { cursor: pointer; }

    .anErrorNotice {
        background: var(--danger, #e74c3c);
        color: #fff;
        border-radius: 3px;
        padding: 0.2rem 0.4rem;
        font-size: 0.78rem;
        margin-top: 0.25rem;
    }

    .dim { color: var(--text-dim, #888); font-size: 0.78rem; }

    /* ── Canvas preview area ─────────────────────────────────────────────── */
    .texture-generator-aPreview {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        background:
            repeating-conic-gradient(#1a1a2e 0% 25%, #111122 0% 50%)
            0 0 / 16px 16px;
        position: relative;
    }

    canvas {
        display: block;
        image-rendering: pixelated;
        /* The inline transform-origin default is top-left; center it for the 4× scale */
        transform-origin: center center;
    }

    .texture-generator-aScalingNotice {
        position: absolute;
        bottom: 0.5rem;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.55);
        color: #ccc;
        font-size: 0.72rem;
        padding: 0.15rem 0.5rem;
        border-radius: 3px;
        pointer-events: none;
        white-space: nowrap;
    }

    /* ── Action row ──────────────────────────────────────────────────────── */
    .action-row {
        padding: 0.5rem 0.75rem;
        gap: 0.5rem;
        border-top: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        align-items: center;
    }

    .spacer { flex: 1 1 auto; }

    button {
        cursor: pointer;
        background: var(--accent1, #446adb);
        border: 1px solid var(--accent1, #446adb);
        color: #fff;
        border-radius: 4px;
        padding: 0.3rem 0.7rem;
        font-size: 0.82rem;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        transition: all 0.12s;
        &.secondary {
            background: transparent;
            border-color: var(--border-bright, #333);
            color: var(--text-dim, #888);
        }
        &:hover:not(:disabled) {
            filter: brightness(1.15);
        }
        &:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }
        :global(svg.feather) {
            width: 0.82rem; height: 0.82rem;
            fill: none; stroke: currentColor; stroke-width: 2;
        }
    }

    /* ── Shake animation (mirrors legacy jellify) ────────────────────────── */
    @keyframes shake {
        0%   { transform: translateX(0); }
        20%  { transform: translateX(-6px); }
        40%  { transform: translateX(6px); }
        60%  { transform: translateX(-4px); }
        80%  { transform: translateX(4px); }
        100% { transform: translateX(0); }
    }
    :global(.shake) {
        animation: shake 0.35s ease;
    }
</style>
