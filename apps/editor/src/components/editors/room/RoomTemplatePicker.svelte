<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * RoomTemplatePicker.svelte
     * Migrated from: room-editor/room-template-picker.tag
     *
     * Searchable list of project templates used to pick which template
     * to place on the room canvas.  Texture thumbnails are loaded via the
     * same nyx-asset:// protocol used by the PixiJS canvas.
     */
    import { get } from 'svelte/store';
    import { projectFilePath } from '../../../stores/projectStore.js';
    import type { NyxTemplate, NyxTexture } from '@nyx/shared';

    interface Props {
        templates: NyxTemplate[];
        textures: NyxTexture[];
        selectedUid: string | null;
        onselect: (uid: string) => void;
    }

    let { templates, textures, selectedUid, onselect }: Props = $props();

    let query = $state('');

    const filtered = $derived(
        query.trim() === ''
            ? templates
            : templates.filter(t =>
                t.name.toLowerCase().includes(query.trim().toLowerCase())
            )
    );

    /** Build the nyx-asset:// URL for a texture origname. Returns null when unavailable. */
    function getThumbUrl(origname: string): string | null {
        const fp = get(projectFilePath);
        if (!fp || !origname) return null;
        const dir = fp.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        return `nyx-asset://localhost/${dir}/img/${encodeURIComponent(origname)}`;
    }

    /** Returns the NyxTexture for a template (or null). */
    function getTexture(tmpl: NyxTemplate): NyxTexture | null {
        if (!tmpl.textureUid) return null;
        return textures.find(t => t.uid === tmpl.textureUid) ?? null;
    }

    /**
     * Deterministic pastel hex colour from a uid — same algorithm as RoomEditor
     * so the placeholder swatch colour is consistent across the UI.
     */
    function uidToColorHex(uid: string): string {
        let h = 0;
        for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
        const hue = (h % 360) / 360;
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
        const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    /** Image error → fall back to the placeholder swatch (hide the <img>). */
    function onImgError(e: Event): void {
        (e.currentTarget as HTMLImageElement).style.display = 'none';
    }
</script>

<div class="rtp-root">
    <div class="rtp-search">
        <Icon icon="feather:search" class="feather search-icon" aria-hidden="true" />
        <input
            class="rtp-input"
            type="search"
            placeholder="Filter templates…"
            bind:value={query}
            aria-label="Filter templates"
        />
    </div>

    <div class="rtp-list" role="listbox" aria-label="Templates">
        {#if filtered.length === 0}
            <p class="rtp-empty">
                {templates.length === 0 ? 'No templates in this project.' : 'No templates match.'}
            </p>
        {:else}
            {#each filtered as tmpl (tmpl.uid)}
                {@const tex = getTexture(tmpl)}
                {@const thumbUrl = tex?.origname ? getThumbUrl(tex.origname) : null}
                {@const isSelected = selectedUid === tmpl.uid}

                <!-- svelte-ignore a11y_interactive_supports_focus -->
                <div
                    class="rtp-entry"
                    class:selected={isSelected}
                    role="option"
                    aria-selected={isSelected}
                    onclick={() => onselect(tmpl.uid)}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(tmpl.uid); } }}
                    tabindex="0"
                    title={tmpl.name}
                >
                    <div class="rtp-thumb" style:background={uidToColorHex(tmpl.uid)}>
                        {#if thumbUrl}
                            <img
                                class="rtp-thumb-img"
                                src={thumbUrl}
                                alt={tmpl.name}
                                onerror={onImgError}
                            />
                        {:else}
                            <!-- No texture assigned — placeholder icon -->
                            <Icon icon="feather:image" class="feather placeholder-icon" aria-hidden="true" />
                        {/if}
                    </div>
                    <span class="rtp-name">{tmpl.name}</span>
                </div>
            {/each}
        {/if}
    </div>
</div>

<style>
    .rtp-root {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        overflow: hidden;
        min-height: 0;
    }

    /* ── Search bar ── */
    .rtp-search {
        position: relative;
        flex-shrink: 0;
        margin-bottom: 0.35rem;
    }

    .search-icon {
        position: absolute;
        left: 0.4rem;
        top: 50%;
        transform: translateY(-50%);
        width: 0.78rem;
        height: 0.78rem;
        fill: none;
        stroke: var(--text-dim, #888);
        stroke-width: 2;
        pointer-events: none;
    }

    .rtp-input {
        width: 100%;
        box-sizing: border-box;
        padding: 0.28rem 0.4rem 0.28rem 1.5rem;
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        font-size: 0.8rem;
        outline: none;

        &:focus {
            border-color: var(--accent1, #446adb);
        }

        /* remove default browser search clear button on Webkit */
        &::-webkit-search-cancel-button { display: none; }
    }

    /* ── Scrollable list ── */
    .rtp-list {
        flex: 1 1 auto;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.12rem;
    }

    .rtp-empty {
        font-size: 0.78rem;
        color: var(--text-dim, #888);
        margin: 0.4rem 0;
        text-align: center;
    }

    /* ── Entry row ── */
    .rtp-entry {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.22rem 0.4rem;
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 3px;
        background: var(--background-deeper, #111122);
        color: var(--text, #e0e0e0);
        cursor: pointer;
        font-size: 0.8rem;
        user-select: none;
        transition: border-color 0.1s, background 0.1s;

        &:hover {
            border-color: var(--border-bright, #333);
            background: var(--act, #1e2233);
        }

        &:focus-visible {
            outline: 2px solid var(--accent1, #446adb);
            outline-offset: -1px;
        }

        &.selected {
            border-color: var(--accent1, #446adb);
            background: rgba(68, 106, 219, 0.15);
        }
    }

    /* ── Thumbnail cell ── */
    .rtp-thumb {
        position: relative;
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        border-radius: 3px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .rtp-thumb-img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        image-rendering: pixelated;
    }

    .placeholder-icon {
        width: 0.9rem;
        height: 0.9rem;
        fill: none;
        stroke: rgba(255, 255, 255, 0.45);
        stroke-width: 2;
        flex-shrink: 0;
    }

    /* ── Name label ── */
    .rtp-name {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
