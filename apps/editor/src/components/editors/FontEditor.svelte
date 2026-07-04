<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * FontEditor.svelte
     * Migrated from: editors/typeface-editor.tag
     *
     * Edit a NyxFont: import a font file, set family name, weight, italic flag,
     * and preview the font rendered at various sizes.
     */
    import { get } from 'svelte/store';
    import { signals } from '../../stores/editorStore.js';
    import { updateAsset, projectFilePath } from '../../stores/projectStore.js';
    import { electronAPI, isElectron } from '../../lib/electron.js';
    import type { NyxFont } from '@nyx/shared';

    interface Props { asset: NyxFont; }
    let { asset }: Props = $props();

    let origname      = $state(asset.origname);
    let family        = $state(asset.family);
    let weight        = $state(asset.weight);
    let italic        = $state(asset.italic);
    let bitmapSize    = $state(asset.bitmapSize);
    let bitmapCharset = $state(asset.bitmapCharset);
    let previewText   = $state('The quick brown fox jumps over the lazy dog 0123456789');
    let prevUid       = asset.uid;

    // Reset only when a different asset is loaded into this slot
    $effect(() => {
        if (asset.uid === prevUid) return;
        prevUid       = asset.uid;
        origname      = asset.origname;
        family        = asset.family;
        weight        = asset.weight;
        italic        = asset.italic;
        bitmapSize    = asset.bitmapSize;
        bitmapCharset = asset.bitmapCharset;
    });

    // ── @font-face injection ──────────────────────────────────────────────────
    // Registers the project font with the browser so the live preview renders
    // with the real typeface instead of falling back to sans-serif.
    // The $effect re-runs (and removes the old tag) whenever family/weight/
    // italic/origname change — e.g. when the user edits the Family field.
    $effect(() => {
        if (!origname || !family) return;
        const fp = get(projectFilePath);
        if (!fp) return;
        const dir = fp.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        const url = `nyx-asset://localhost/${dir}/fonts/${encodeURIComponent(origname)}`;
        const style = document.createElement('style');
        style.textContent =
            `@font-face { font-family: '${family.replace(/'/g, "\\'")}'; ` +
            `src: url('${url}'); ` +
            `font-weight: ${weight}; font-style: ${italic ? 'italic' : 'normal'}; }`;
        document.head.appendChild(style);
        return () => style.remove();   // cleanup on next run or unmount
    });

    // ── Persistence ───────────────────────────────────────────────────────────

    function persist() {
        updateAsset<NyxFont>(asset.uid, 'font', {
            origname, family, weight, italic, bitmapSize, bitmapCharset
        });
        signals.emit('assetChanged');
    }

    // ── File import ───────────────────────────────────────────────────────────

    async function importFont() {
        if (!isElectron()) return;
        const fp = get(projectFilePath);
        if (!fp) return;
        const result = await electronAPI().dialog.showOpenDialog({
            title: 'Import font file',
            filters: [{ name: 'Font files', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
            properties: ['openFile']
        });
        if (result.canceled || result.filePaths.length === 0) return;
        const sourcePath     = result.filePaths[0];
        const sourceName     = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
        const inferredFamily = sourceName.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]/g, ' ');
        // Copy the font file into <projDir>/fonts/f<uid><ext>
        const { origname: copied } = await electronAPI().font.import({
            sourcePath,
            projectFilePath: fp,
            uid: asset.uid
        });
        origname = copied;
        family   = inferredFamily;
        persist();
        // $effect above will re-run and inject @font-face automatically
    }

    const PREVIEW_SIZES = [12, 16, 24, 32, 48];
</script>

<div class="font-editor">
    <!-- ── Left: properties ── -->
    <div class="props-col">
        <div class="prop-header">
            <h3 class="nm">{asset.name}</h3>
        </div>

        <div class="props-body">
            <!-- Source file -->
            <fieldset>
                <legend>Source file</legend>
                <div class="file-row">
                    <span class="filename dim">{origname || '(no file)'}</span>
                    <button onclick={importFont} disabled={!isElectron()}>
                        <Icon icon="feather:folder" class="feather"/>
                        <span>Import…</span>
                    </button>
                </div>
            </fieldset>

            <!-- Font properties -->
            <fieldset>
                <legend>Properties</legend>
                <div class="field-grid">
                    <span>Family</span>
                    <input type="text" bind:value={family} oninput={persist} placeholder="Font Family" />
                    <span>Weight</span>
                    <select bind:value={weight} onchange={persist}>
                        {#each [100,200,300,400,500,600,700,800,900] as w}
                            <option value={w}>{w}</option>
                        {/each}
                    </select>
                    <span>Italic</span>
                    <label class="checkbox-wrap">
                        <input type="checkbox" bind:checked={italic} onchange={persist} />
                        <span>Italic</span>
                    </label>
                </div>
            </fieldset>

            <!-- Bitmap atlas -->
            <fieldset>
                <legend>Bitmap atlas</legend>
                <div class="field-grid">
                    <span>Size (px)</span>
                    <input type="number" bind:value={bitmapSize} oninput={persist} min="8" max="128" />
                    <span>Charset</span>
                    <textarea
                        class="charset-area"
                        bind:value={bitmapCharset}
                        oninput={persist}
                        rows="3"
                        spellcheck={false}
                    ></textarea>
                </div>
            </fieldset>
        </div>

    </div>

    <!-- ── Right: preview ── -->
    <div class="preview-col">
        <div class="preview-label dim">Preview — {family || asset.name}</div>
        <div class="preview-input-row">
            <input
                type="text"
                bind:value={previewText}
                class="preview-input"
                placeholder="Enter preview text…"
            />
        </div>
        <div class="preview-stage">
            {#each PREVIEW_SIZES as size}
                <div class="preview-row">
                    <span class="size-label dim">{size}px</span>
                    <span
                        class="preview-text"
                        style="font-family: '{family}', sans-serif; font-size: {size}px; font-weight: {weight}; font-style: {italic ? 'italic' : 'normal'};"
                    >{previewText}</span>
                </div>
            {/each}
        </div>
    </div>
</div>

<style>
    .font-editor {
        display: flex;
        flex-flow: row nowrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .props-col {
        flex: 0 0 280px;
        overflow-y: auto;
        background: var(--background, #1a1a2e);
        border-right: 1px solid var(--border-bright, #333);
        display: flex;
        flex-direction: column;
    }

    .prop-header { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border-pale, #2a2a3e); }
    h3 { font-size: 0.9rem; }

    .props-body { flex: 1 1 auto; overflow-y: auto; padding: 0.75rem; }

    fieldset {
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 4px;
        padding: 0.5rem 0.75rem 0.75rem;
        margin-bottom: 0.6rem;
    }
    legend { font-size: 0.78rem; color: var(--text-dim, #888); padding: 0 0.25rem; }

    .field-grid {
        display: grid;
        grid-template-columns: 70px 1fr;
        gap: 0.3rem 0.5rem;
        align-items: start;
    }

    label { font-size: 0.8rem; color: var(--text-dim, #888); line-height: 1.6; }

    .checkbox-wrap {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.82rem;
        cursor: pointer;
        color: var(--text, #e0e0e0);
    }

    .file-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .filename {
        flex: 1 1 auto;
        font-size: 0.8rem;
        font-family: monospace;
        word-break: break-all;
    }

    input[type="text"],
    input[type="number"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.4rem;
        font-size: 0.82rem;
        width: 100%;
        box-sizing: border-box;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    select {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.82rem;
        width: 100%;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .charset-area {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.4rem;
        font-size: 0.75rem;
        font-family: monospace;
        resize: vertical;
        width: 100%;
        box-sizing: border-box;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .footer { padding: 0.75rem; border-top: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }
    .wide { width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.35rem; }
    .nm   { margin: 0; }
    .dim  { color: var(--text-dim, #888); }

    /* Preview */
    .preview-col {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--background-deeper, #111122);
    }

    .preview-label { padding: 0.4rem 0.75rem; font-size: 0.75rem; border-bottom: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }

    .preview-input-row {
        padding: 0.4rem 0.75rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    .preview-input {
        width: 100%;
        box-sizing: border-box;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.3rem 0.5rem;
        font-size: 0.85rem;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .preview-stage { flex: 1 1 auto; overflow-y: auto; padding: 1rem 1.5rem; }

    .preview-row {
        display: flex;
        align-items: baseline;
        gap: 1rem;
        margin-bottom: 0.75rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        padding-bottom: 0.6rem;
    }

    .size-label { flex: 0 0 36px; font-size: 0.72rem; text-align: right; }
    .preview-text { flex: 1 1 auto; color: var(--text, #e0e0e0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.25rem 0.6rem;
        font-size: 0.82rem;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        transition: all 0.12s;
        &.success { background: var(--success, #27ae60); border-color: var(--success, #27ae60); color: #fff; font-weight: 600; }
        &.success:hover { background: #1e8449; }
        &:hover   { background: var(--act, #1e2233); border-color: var(--acttext, #7ec8e3); color: var(--acttext, #7ec8e3); }
        &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        :global(svg.feather) { width: 0.85rem; height: 0.85rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }
</style>
