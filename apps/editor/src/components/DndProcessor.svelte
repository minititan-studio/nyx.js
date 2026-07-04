<script lang="ts">
    /**
     * DndProcessor.svelte
     * Migrated from: src/riotTags/dnd-processor.tag
     *
     * Listens for document-level drag-and-drop events. When the user drags files
     * from the OS over the editor window a full-screen overlay appears. On drop,
     * recognised file types are imported into the current project:
     *   Textures  — .png / .jpg / .jpeg / .gif / .bmp / .webp
     *   Fonts     — .ttf / .otf
     *   Sounds    — .wav / .mp3 / .ogg / .aac / .flac
     *
     * Assets are created at root level (null folder). Users can move them in the
     * browser afterwards. Texture width/height are measured via createImageBitmap
     * so the editor starts with correct frame dimensions.
     */
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import Icon from '@iconify/svelte';
    import {
        currentProject,
        projectFilePath,
        createAsset,
        updateAsset,
    } from '../stores/projectStore.js';
    import { electronAPI, isElectron } from '../lib/electron.js';

    // ── Dimension helper ──────────────────────────────────────────────────────
    async function getImgDims(file: File): Promise<{
        width: number; height: number;
        shape: { type: 'rect'; top: number; bottom: number; left: number; right: number };
    }> {
        const bmp = await createImageBitmap(file);
        const w = bmp.width, h = bmp.height;
        bmp.close();
        return { width: w, height: h, shape: { type: 'rect', top: 0, bottom: h, left: 0, right: w } };
    }

    // ── Per-type import helpers ───────────────────────────────────────────────
    async function importTexture(file: File): Promise<void> {
        if (!isElectron()) return;
        const fp = get(projectFilePath);
        if (!fp) return;
        const name  = file.name.replace(/\.[^.]+$/, '');
        const asset = createAsset('texture', name, null);
        try {
            const [{ origname }, dims] = await Promise.all([
                electronAPI().texture.import({
                    sourcePath: (file as unknown as { path: string }).path,
                    projectFilePath: fp,
                    uid: asset.uid,
                }),
                getImgDims(file),
            ]);
            updateAsset(asset.uid, 'texture', { origname, ...dims });
        } catch (e) {
            console.error('[DnD] texture import failed:', e);
        }
    }

    async function importFont(file: File): Promise<void> {
        if (!isElectron()) return;
        const fp = get(projectFilePath);
        if (!fp) return;
        const name  = file.name.replace(/\.[^.]+$/, '');
        const asset = createAsset('font', name, null);
        try {
            const { origname } = await electronAPI().font.import({
                sourcePath: (file as unknown as { path: string }).path,
                projectFilePath: fp,
                uid: asset.uid,
            });
            updateAsset(asset.uid, 'font', { origname });
        } catch (e) {
            console.error('[DnD] font import failed:', e);
        }
    }

    async function importSound(file: File): Promise<void> {
        if (!isElectron()) return;
        const fp = get(projectFilePath);
        if (!fp) return;
        const name  = file.name.replace(/\.[^.]+$/, '');
        const asset = createAsset('sound', name, null);
        try {
            const variants = await electronAPI().sound.import({
                sourcePaths: [(file as unknown as { path: string }).path],
                projectFilePath: fp,
            });
            updateAsset(asset.uid, 'sound', { variants });
        } catch (e) {
            console.error('[DnD] sound import failed:', e);
        }
    }

    // ── Batch processor ───────────────────────────────────────────────────────
    async function processFiles(fileList: FileList): Promise<void> {
        if (!get(currentProject)) return;
        for (const file of fileList) {
            const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
            if (/^(png|jpe?g|gif|bmp|webp)$/.test(ext)) {
                await importTexture(file);
            } else if (/^(ttf|otf)$/.test(ext)) {
                await importFont(file);
            } else if (/^(wav|mp3|ogg|aac|flac)$/.test(ext)) {
                await importSound(file);
            }
        }
    }

    // ── Drag state ────────────────────────────────────────────────────────────
    let dropping  = $state(false);
    let dragTimer = 0;

    function onDragOver(e: DragEvent): void {
        if (!e.dataTransfer?.types.includes('Files')) return;
        clearTimeout(dragTimer);
        dropping = true;
        e.preventDefault();
        e.stopPropagation();
    }

    function onDragLeave(e: DragEvent): void {
        dragTimer = window.setTimeout(() => { dropping = false; }, 25);
        e.preventDefault();
    }

    function onDrop(e: DragEvent): void {
        dropping = false;
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer?.files;
        if (files?.length) processFiles(files);
    }

    onMount(() => {
        document.addEventListener('dragover',   onDragOver);
        document.addEventListener('dragleave',  onDragLeave);
        document.addEventListener('drop',       onDrop);
    });

    onDestroy(() => {
        document.removeEventListener('dragover',   onDragOver);
        document.removeEventListener('dragleave',  onDragLeave);
        document.removeEventListener('drop',       onDrop);
        clearTimeout(dragTimer);
    });
</script>

{#if dropping}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="dnd-overlay" aria-hidden="true">
        <div class="dnd-inner">
            <Icon icon="feather:download" class="dnd-icon" aria-hidden="true"/>
            <p class="dnd-label">Drop to import</p>
            <p class="dnd-hint">Textures · Fonts · Sounds</p>
        </div>
    </div>
{/if}

<style>
    .dnd-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: color-mix(in srgb, var(--background-deeper, #111122) 88%, transparent);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
    }

    .dnd-inner {
        border: 2px dashed var(--accent2, #7ec8e3);
        border-radius: 12px;
        padding: 3rem 5rem;
        text-align: center;
        color: var(--text, #e0e0e0);

        .dnd-label {
            font-size: 1.4rem;
            font-weight: 600;
            margin: 0.6rem 0 0.25rem;
        }
        .dnd-hint {
            font-size: 0.85rem;
            color: var(--text-dim, #888);
            margin: 0;
        }
    }

    :global(svg.dnd-icon) {
        width: 3rem;
        height: 3rem;
        fill: none;
        stroke: var(--accent2, #7ec8e3);
        stroke-width: 1.5;
    }
</style>
