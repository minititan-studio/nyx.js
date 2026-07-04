<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * RoomEntitiesList.svelte
     * Migrated from: room-entities-list.tag
     *
     * Scrollable list of copies placed in the room. Each row shows the template
     * name, world-space position, and a delete button. Clicking a row fires
     * `onselect`. Supports search filtering and Ctrl/Shift multi-select.
     */
    import type { NyxRoom, NyxTemplate, NyxCopy } from '@nyx/shared';

    interface Props {
        room: NyxRoom;
        templates: NyxTemplate[];
        selectedUids: Set<string>;
        onselect: (uid: string, multi?: boolean) => void;
        ondelete: (uid: string) => void;
    }
    let { room, templates, selectedUids, onselect, ondelete }: Props = $props();

    let searchQuery = $state('');

    function getTemplate(uid: string): NyxTemplate | undefined {
        return templates.find(t => t.uid === uid);
    }

    const filtered = $derived(
        room.copies.filter(c => {
            if (!searchQuery.trim()) return true;
            const tmpl = getTemplate(c.templateUid);
            return tmpl?.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ?? false;
        })
    );

    function handleRowClick(e: MouseEvent, copy: NyxCopy): void {
        onselect(copy.uid, e.ctrlKey || e.metaKey || e.shiftKey);
    }

    function handleDelete(e: MouseEvent, uid: string): void {
        e.stopPropagation();
        ondelete(uid);
    }
</script>

<div class="entities-list">
    <div class="search-wrap">
        <input
            type="text"
            placeholder="Search copies…"
            bind:value={searchQuery}
            aria-label="Search copies"
        />
        <Icon icon="feather:search" class="feather search-icon" />
    </div>

    <ul class="list" role="listbox" aria-label="Room copies">
        {#each filtered as copy (copy.uid)}
            {@const tmpl = getTemplate(copy.templateUid)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_interactive_supports_focus -->
            <li
                class="list-row"
                class:selected={selectedUids.has(copy.uid)}
                role="option"
                aria-selected={selectedUids.has(copy.uid)}
                onclick={(e) => handleRowClick(e, copy)}
                title="{tmpl?.name ?? '(unknown)'} @ {copy.x}, {copy.y}"
            >
                <span class="tmpl-name">{tmpl?.name ?? '(unknown)'}</span>
                <span class="pos dim">
                    {Math.round(copy.x)}, {Math.round(copy.y)}
                </span>
                <button
                    class="del-btn"
                    title="Delete copy"
                    onclick={(e) => handleDelete(e, copy.uid)}
                    aria-label="Delete {tmpl?.name ?? 'copy'}"
                >
                    <Icon icon="feather:x" class="feather"/>
                </button>
            </li>
        {/each}
        {#if filtered.length === 0}
            <li class="empty dim small">
                {searchQuery.trim() ? 'No matches.' : 'No copies placed yet.'}
            </li>
        {/if}
    </ul>

    <div class="count-bar dim small">
        {room.copies.length} cop{room.copies.length === 1 ? 'y' : 'ies'} total
        {#if searchQuery.trim() && filtered.length !== room.copies.length}
            &nbsp;· {filtered.length} shown
        {/if}
    </div>
</div>

<style>
    .entities-list {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .search-wrap {
        position: relative;
        flex-shrink: 0;
        padding: 0.35rem 0.5rem 0.3rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
    }
    .search-wrap input {
        width: 100%;
        box-sizing: border-box;
        padding: 0.2rem 0.35rem 0.2rem 1.6rem;
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        font-size: 0.8rem;
    }
    .search-wrap input:focus {
        outline: none;
        border-color: var(--accent1, #446adb);
    }
    .search-icon {
        position: absolute;
        left: 0.85rem;
        top: 50%;
        transform: translateY(-50%);
        width: 0.8rem;
        height: 0.8rem;
        fill: none;
        stroke: var(--text-dim, #888);
        stroke-width: 2;
        pointer-events: none;
    }

    .list {
        flex: 1 1 auto;
        overflow-y: auto;
        list-style: none;
        margin: 0;
        padding: 0.15rem 0;
    }

    .list-row {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.22rem 0.5rem;
        cursor: pointer;
        font-size: 0.8rem;
        color: var(--text, #e0e0e0);
        transition: background 0.08s;
        border-left: 2px solid transparent;
    }
    .list-row:hover {
        background: var(--act, #1e2233);
    }
    .list-row.selected {
        background: rgba(68, 106, 219, 0.15);
        border-left-color: var(--accent1, #446adb);
    }

    .tmpl-name {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .pos {
        flex-shrink: 0;
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    .del-btn {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.3rem;
        height: 1.3rem;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 3px;
        color: var(--text-dim, #888);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.1s, color 0.1s;
    }
    .list-row:hover .del-btn {
        opacity: 1;
    }
    .del-btn:hover {
        color: var(--danger, #e74c3c);
        border-color: var(--danger, #e74c3c);
    }
    .del-btn svg {
        width: 0.7rem;
        height: 0.7rem;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
    }

    .empty {
        padding: 0.5rem 0.75rem;
        list-style: none;
    }

    .count-bar {
        flex-shrink: 0;
        padding: 0.25rem 0.5rem;
        border-top: 1px solid var(--border-pale, #2a2a3e);
    }

    .small { font-size: 0.78rem; }
    .dim   { color: var(--text-dim, #888); }
</style>
