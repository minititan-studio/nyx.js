<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * AssetFolderTree.svelte
     * Migrated from: src/riotTags/shared/asset-folder-tree.tag
     *
     * Recursive folder tree shown in the left side panel.
     * Supports drag-and-drop reordering of folders and assets.
     */
    // Self-import for recursion (replaces deprecated <svelte:self>)
    import AssetFolderTree from './AssetFolderTree.svelte';
    import { untrack } from 'svelte';
    import type { NyxAsset, NyxFolder, NyxProjectEntry } from '@nyx/shared';

    // ── Props ──────────────────────────────────────────────────────────────────
    interface Props {
        /** Current folder path from root → current. Empty = root level. */
        path: NyxFolder[];
        /** Depth driven by parent recursion; root starts at 0. */
        depth?: number;
        /** Show asset entries (not just folders). */
        showassets?: boolean;
        /** Called when a folder row is clicked. */
        onfolderclick?: (folder: NyxFolder | null, path: NyxFolder[]) => void;
        /** Called when an asset is clicked. */
        onassetclick?: (asset: NyxAsset) => void;
        /** Called when a drop lands on this folder. */
        ondrop?: (targetFolder: NyxFolder | null, e: DragEvent) => void;
        /** Called when a drag-move completes so parent can refresh. */
        onlayoutchanged?: () => void;
        /** Full asset list — passed as the entries at root level. */
        entries: NyxProjectEntry[];
    }

    let {
        path = [],
        depth = 0,
        showassets = false,
        onfolderclick,
        onassetclick,
        ondrop,
        onlayoutchanged,
        entries
    }: Props = $props();

    // ── State ──────────────────────────────────────────────────────────────────
    // Root is open by default; child nodes start closed.
    // untrack() reads the prop once without creating a reactive dependency —
    // the correct Svelte 5 pattern for "initialize from prop, then manage locally".
    let opened = $state(untrack(() => path.length === 0));

    // The entries for THIS level: either the current folder's entries or root list.
    const currentFolder = $derived(path.length > 0 ? path[path.length - 1] : null);
    const levelEntries  = $derived(currentFolder ? currentFolder.entries : entries);
    const folderName    = $derived(currentFolder ? currentFolder.name : 'Assets');

    // ── Icon helpers ───────────────────────────────────────────────────────────
    const iconMap: Record<string, string> = {
        texture: 'image', template: 'box', room: 'layout',
        sound: 'volume-2', font: 'type', style: 'droplet',
        behavior: 'activity', script: 'code', enum: 'list',
        emitterTandem: 'star'
    };

    function getIcon(asset: NyxAsset): string {
        return iconMap[asset.type] ?? 'file';
    }

    // ── Toggle ─────────────────────────────────────────────────────────────────
    function toggle() { opened = !opened; }

    function onOpenFolder(e: MouseEvent) {
        toggle();
        if (onfolderclick) onfolderclick(currentFolder, path);
        e.stopPropagation();
    }

    // ── Drag & Drop ────────────────────────────────────────────────────────────
    function onFolderDragStart(e: DragEvent) {
        if (!currentFolder) return;
        e.dataTransfer!.setData('text/plain', JSON.stringify({
            type: 'assetFolderDrag', folder: currentFolder.uid
        }));
        e.dataTransfer!.dropEffect = 'move';
    }

    function onAssetDragStart(e: DragEvent, asset: NyxAsset) {
        e.dataTransfer!.setData('text/plain', JSON.stringify({
            type: 'assetDrag', asset: asset.uid
        }));
        e.dataTransfer!.dropEffect = 'move';
        e.stopPropagation();
    }

    function onDropOnFolder(e: DragEvent) {
        e.preventDefault();
        if (ondrop) ondrop(currentFolder, e);
    }

    function onDragOver(e: DragEvent) { e.preventDefault(); }

    function onFolderKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter' || e.key === ' ') onOpenFolder(e as unknown as MouseEvent);
    }

    function handleAssetClick(entry: NyxProjectEntry) {
        if (entry.type !== 'folder') onassetclick?.(entry as NyxAsset);
    }

    function handleAssetDrag(e: DragEvent, entry: NyxProjectEntry) {
        if (entry.type !== 'folder') onAssetDragStart(e, entry as NyxAsset);
    }

    /** Type-safe cast from NyxProjectEntry to NyxFolder for the template. */
    function asFolder(entry: NyxProjectEntry): NyxFolder {
        return entry as NyxFolder;
    }

    /** Type-safe cast from NyxProjectEntry to NyxAsset for the template. */
    function asAsset(entry: NyxProjectEntry): NyxAsset {
        return entry as NyxAsset;
    }
</script>

<!-- ══ Folder row ══════════════════════════════════════════════════════════════ -->
<div class="noshrink">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
        class="asset-folder-tree-aFolder"
        style="padding-left: {depth * 1.2}rem"
        draggable={path.length > 0}
        role="treeitem"
        aria-expanded={opened}
        aria-selected={false}
        tabindex="0"
        onclick={onOpenFolder}
        onkeydown={onFolderKeyDown}
        ondragstart={onFolderDragStart}
        ondrop={onDropOnFolder}
        ondragover={onDragOver}
    >
        <Icon icon={`feather:${opened ? 'folder-open' : 'folder'}`} class="feather {currentFolder?.colorClass ?? ''}" />
        <span>{folderName}</span>
    </div>

    <!-- ══ Subtree (when open) ════════════════════════════════════════════════ -->
    {#if opened}
        <div class="asset-folder-tree-aSubtree" class:root={path.length === 0}>
            <!-- Recurse into child folders (self-import instead of svelte:self) -->
            {#each levelEntries.filter(e => e.type === 'folder') as folder (folder.uid)}
                <AssetFolderTree
                    path={[...path, asFolder(folder)]}
                    depth={depth + 1}
                    {showassets}
                    {entries}
                    {onfolderclick}
                    {onassetclick}
                    {ondrop}
                    {onlayoutchanged}
                />
            {/each}

            <!-- Assets at this level (when showassets=true) -->
            {#if showassets}
                {#each levelEntries.filter(e => e.type !== 'folder') as asset (asset.uid)}
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <div
                        class="asset-folder-tree-anAsset"
                        draggable="true"
                        role="treeitem"
                        aria-selected={false}
                        tabindex="0"
                        onclick={() => handleAssetClick(asset)}
                        onkeydown={(e) => e.key === 'Enter' && handleAssetClick(asset)}
                        ondragstart={(e) => handleAssetDrag(e, asset)}
                    >
                        <Icon icon={`feather:${getIcon(asAsset(asset))}`} class="feather"/>
                        <span>{asset.name}</span>
                    </div>
                {/each}
            {/if}
        </div>
    {/if}
</div>


<style>
    .noshrink { flex-shrink: 0; }

    .asset-folder-tree-aFolder {
        display: flex;
        flex-flow: row nowrap;
        align-items: center;
        gap: 0.35rem;
        cursor: pointer;
        padding: 0.2rem 0.5rem;
        border-radius: 3px;
        user-select: none;
        font-size: 0.85rem;
        white-space: nowrap;
        transition: background 0.1s ease;

        &:hover {
            background: var(--act, #1e2233);
            color: var(--acttext, #7ec8e3);
        }

        :global(svg.feather) {
            width: 1rem; height: 1rem;
            fill: none; stroke: currentColor;
            stroke-width: 2; flex-shrink: 0;
        }
    }

    .asset-folder-tree-aSubtree {
        border-left: 1px solid var(--border-pale, #2a2a3e);
        margin-left: 1rem;

        &.root { border-left: none; margin-left: 0; }
    }

    .asset-folder-tree-anAsset {
        display: flex;
        flex-flow: row nowrap;
        align-items: center;
        gap: 0.35rem;
        cursor: pointer;
        padding: 0.15rem 0.5rem;
        font-size: 0.8rem;
        white-space: nowrap;
        user-select: none;
        border-radius: 3px;
        color: var(--text-dim, #999);
        transition: background 0.1s ease;

        &:hover {
            background: var(--act, #1e2233);
            color: var(--acttext, #7ec8e3);
        }

        :global(svg.feather) {
            width: 0.85rem; height: 0.85rem;
            fill: none; stroke: currentColor;
            stroke-width: 2; flex-shrink: 0;
        }
    }
</style>
