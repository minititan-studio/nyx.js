<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * AssetBrowser.svelte
     * Migrated from: src/riotTags/shared/asset-browser.tag
     *
     * Full-panel asset browser: breadcrumb nav, sort controls, search,
     * layout switcher (cards / largeCards / list), and the asset grid.
     */
    import { onMount, onDestroy } from 'svelte';
    import { signals } from '../stores/editorStore.js';
    import {
        currentProject, createAsset, createAssetWithScript, createFolder, isNameTaken,
        updateAsset, deleteAsset, renameFolder, deleteFolderWithContents, unwrapFolder, moveEntryToRoot,
        projectFilePath,
    } from '../stores/projectStore.js';
    import { get } from 'svelte/store';
    import ContextMenu from './ContextMenu.svelte';
    import type { MenuItem } from './ContextMenu.svelte';
    import { showConfirm } from '../lib/dialogs.js';
    import { electronAPI, isElectron } from '../lib/electron.js';
    import type { AssetType, NyxAsset, NyxFolder, NyxProjectEntry, AnyNyxAsset, NyxTemplate, NyxTexture } from '@nyx/shared';
    import TextureGenerator from './editors/TextureGenerator.svelte';

    // ── Types ──────────────────────────────────────────────────────────────────
    type Layout = 'cards' | 'largeCards' | 'list';
    type SortKey = 'date' | 'name' | 'type';

    const NS_KEY = 'assetBrowser';
    const _ab = window.electronAPI.settings.getAll();

    // ── State ──────────────────────────────────────────────────────────────────
    let layout      = $state<Layout>((_ab[`${NS_KEY}.layout`] as Layout) ?? 'cards');
    let sort        = $state<SortKey>((_ab[`${NS_KEY}.sort`] as SortKey) ?? 'date');
    let searchText  = $state('');
    let groupByType = $state((_ab[`${NS_KEY}.groupByType`] as string) === 'true');
    let refreshKey  = $state(0);

    /** Folder navigation stack — [root, sub1, sub2, …]. Empty = project root. */
    let folderStack = $state<NyxFolder[]>([]);

    const currentFolder = $derived<NyxFolder | null>(
        folderStack.length > 0 ? folderStack[folderStack.length - 1] : null
    );

    /**
     * Raw entries — always spreads so downstream deriveds see a new reference
     * after in-place mutations. refreshKey forces re-run when assetChanged fires.
     */
    const rawEntries = $derived<NyxProjectEntry[]>((() => {
        void refreshKey;
        return currentFolder ? [...currentFolder.entries] : [...($currentProject?.assets ?? [])];
    })());

    /** Entries filtered by the search query — shared by flat and grouped views. */
    const filteredEntries = $derived<NyxProjectEntry[]>((() => {
        const q = searchText.trim().toLowerCase();
        if (!q) return rawEntries;
        return rawEntries.filter(e => e.name.toLowerCase().includes(q));
    })());

    /** Flat sorted view — folders first, then assets by the active sort key. */
    const displayEntries = $derived<NyxProjectEntry[]>((() => {
        const q = searchText.trim().toLowerCase();
        let items = [...filteredEntries];
        if (!q) {
            const folders = items.filter(e => e.type === 'folder');
            const assets  = items.filter(e => e.type !== 'folder') as NyxAsset[];
            if (sort === 'name')  assets.sort((a, b) => a.name.localeCompare(b.name));
            if (sort === 'date')  assets.sort((a, b) => b.lastModified - a.lastModified);
            if (sort === 'type')  assets.sort((a, b) => a.type.localeCompare(b.type));
            items = [...folders, ...assets];
        }
        return items;
    })());

    // ── Create asset state ─────────────────────────────────────────────────────
    /** Whether the asset-type dropdown is visible. */
    let showCreateMenu = $state(false);

    /** Which asset type was picked; null = no prompt open. */
    let promptingType = $state<AssetType | null>(null);

    /** Current value of the name input in the prompt. */
    let promptName = $state('');

    // Per-type extra fields shown in the creation modal
    let promptFilePath    = $state('');        // texture / sound / font — source file
    let promptRoomWidth   = $state(1024);      // room — width
    let promptRoomHeight  = $state(768);       // room — height
    let promptBehaviorType = $state<'template' | 'room'>('template'); // behavior subtype

    const PRIORITY_TYPES: AssetType[] = ['texture', 'template', 'room'];
    const OTHER_TYPES: AssetType[] = ['sound', 'font', 'style', 'behavior', 'script', 'enum', 'emitterTandem', 'uiLayer'];

    /** Types that need a file picker during creation */
    const FILE_TYPES: AssetType[] = ['texture', 'sound', 'font'];

    const promptNameInvalid = $derived(
        promptName.trim() === '' ||
        (promptingType !== null && isNameTaken(promptName.trim(), promptingType))
    );
    const promptNameEmpty   = $derived(promptName.trim() === '');
    const promptNameTaken   = $derived(
        !promptNameEmpty &&
        promptingType !== null &&
        isNameTaken(promptName.trim(), promptingType)
    );

    function openCreateMenu() { showCreateMenu = !showCreateMenu; }

    function pickAssetType(type: AssetType) {
        showCreateMenu     = false;
        promptingType      = type;
        promptName         = 'New ' + type.charAt(0).toUpperCase() + type.slice(1);
        promptFilePath     = '';
        promptRoomWidth    = 1024;
        promptRoomHeight   = 768;
        promptBehaviorType = 'template';
    }

    function pickFolder() {
        showCreateMenu  = false;
        promptingType   = null;
        promptName      = 'New Folder';
        promptingFolder = true;
    }

    let promptingFolder = $state(false);
    let showTextureGenerator = $state(false);

    function cancelPrompt() {
        promptingType   = null;
        promptingFolder = false;
        promptName      = '';
        promptFilePath  = '';
    }

    async function browseFile(type: AssetType) {
        if (!isElectron()) return;
        const filterMap: Record<string, { name: string; extensions: string[] }[]> = {
            texture: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
            sound:   [{ name: 'Audio',  extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'] }],
            font:    [{ name: 'Fonts',  extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
        };
        const result = await electronAPI().dialog.showOpenDialog({
            title: `Import ${type} file`,
            filters: filterMap[type] ?? [],
            properties: ['openFile']
        });
        if (result.canceled || result.filePaths.length === 0) return;
        const path = result.filePaths[0];
        promptFilePath = path;
        // Auto-fill name from filename (strip extension)
        const base = path.split(/[\\/]/).pop() ?? path;
        const noExt = base.replace(/\.[^.]+$/, '');
        if (promptName.startsWith('New ')) promptName = noExt;
    }

    async function submitPrompt() {
        const name = promptName.trim();
        if (!name) return;
        if (promptingFolder) {
            const folder = createFolder(name, currentFolder);
            cancelPrompt();
            signals.emit('assetChanged');
            folderStack = [...folderStack, folder];
            return;
        }
        if (!promptingType) return;
        if (isNameTaken(name, promptingType)) return;

        let asset: AnyNyxAsset;

        // Templates, behaviors, and scripts need a .ts file created on disk
        if (promptingType === 'template' || promptingType === 'behavior' || promptingType === 'script') {
            asset = await createAssetWithScript(promptingType, name, currentFolder);
        } else {
            asset = createAsset(promptingType, name, currentFolder) as AnyNyxAsset;
        }

        // Apply extra fields collected in the modal
        if (promptFilePath) {
            if (promptingType === 'texture' && isElectron()) {
                const fp = get(projectFilePath);
                if (fp) {
                    try {
                        const { origname: copied } = await electronAPI().texture.import({
                            sourcePath: promptFilePath,
                            projectFilePath: fp,
                            uid: asset.uid,
                        });
                        Object.assign(asset, { origname: copied });
                    } catch (e) {
                        console.error('[AssetBrowser] texture import failed:', e);
                    }
                }
            } else {
                const origname = promptFilePath.split(/[\\/]/).pop() ?? promptFilePath;
                Object.assign(asset, { origname });
            }
        }
        if (promptingType === 'room') {
            Object.assign(asset, { width: promptRoomWidth, height: promptRoomHeight });
        }
        if (promptingType === 'behavior') {
            Object.assign(asset, { behaviorType: promptBehaviorType });
        }

        cancelPrompt();
        signals.emit('assetChanged');
        signals.emit('openAsset', asset);
    }

    function onPromptKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !promptNameInvalid) submitPrompt();
        if (e.key === 'Escape') cancelPrompt();
    }

    // Close dropdown when clicking outside — uses window listener instead of
    // attaching to the non-interactive wrapper div (avoids ARIA issues).
    function onWindowClick() {
        if (showCreateMenu) showCreateMenu = false;
    }

    const onAssetChanged = () => { refreshKey++; };
    onMount(() => {
        window.addEventListener('click', onWindowClick);
        signals.on('assetChanged', onAssetChanged);
    });
    onDestroy(() => {
        window.removeEventListener('click', onWindowClick);
        signals.off('assetChanged', onAssetChanged);
    });

    /** Svelte action: focus the element when it mounts. Avoids autofocus a11y warning. */
    function focusOnMount(el: HTMLElement) {
        el.focus();
    }

    // ── Type grouping ──────────────────────────────────────────────────────────
    const TYPE_ORDER = ['folder','texture','template','room','sound','font','style','behavior','script','enum','emitterTandem','uiLayer'];
    const TYPE_LABELS: Record<string, string> = {
        folder: 'Folders', texture: 'Textures', template: 'Templates', room: 'Rooms',
        sound: 'Sounds', font: 'Fonts', style: 'Styles', behavior: 'Behaviors',
        script: 'Scripts', enum: 'Enums', emitterTandem: 'Emitters', uiLayer: 'UI Layers',
    };

    const groupedEntries = $derived<{ type: string; label: string; entries: NyxProjectEntry[] }[]>((() => {
        if (!groupByType) return [];
        const groups = new Map<string, NyxProjectEntry[]>();
        for (const e of filteredEntries) {
            if (!groups.has(e.type)) groups.set(e.type, []);
            groups.get(e.type)!.push(e);
        }
        for (const [, arr] of groups) {
            if (sort === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
            if (sort === 'date') arr.sort((a, b) => ((b as NyxAsset).lastModified ?? 0) - ((a as NyxAsset).lastModified ?? 0));
        }
        return TYPE_ORDER
            .filter(t => groups.has(t))
            .map(t => ({ type: t, label: TYPE_LABELS[t] ?? t, entries: groups.get(t)! }));
    })());

    function setGroupByType(v: boolean) {
        groupByType = v;
        void window.electronAPI.settings.set(`${NS_KEY}.groupByType`, String(v));
    }

    // ── Icon map ───────────────────────────────────────────────────────────────
    const iconMap: Record<string, string> = {
        texture: 'material-symbols:image', template: 'material-symbols:box-rounded', room: 'material-symbols:mobile-layout',
        sound: 'material-symbols:volume-up', font: 'material-symbols:type-specimen', style: 'tabler:droplet',
        behavior: 'material-symbols:activity-zone', script: 'material-symbols:code', enum: 'material-symbols:list',
        emitterTandem: 'material-symbols:star', folder: 'material-symbols:folder',
        uiLayer: 'material-symbols:layers',
    };

    // ── Thumbnail helpers ──────────────────────────────────────────────────────
    function getProjectImageUrl(name: string): string {
        const fp = get(projectFilePath);
        if (!fp || !name) return '';
        const dir = fp.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        return `nyx-asset://localhost/${dir}/img/${encodeURIComponent(name)}`;
    }

    const texOrignames = $derived<Map<string, string>>((() => {
        const map = new Map<string, string>();
        for (const tex of ($currentProject?.textures ?? [])) {
            if (tex.origname) map.set(tex.uid, tex.origname);
        }
        return map;
    })());

    function getThumbnailUrl(entry: NyxProjectEntry): string | null {
        if (entry.type === 'folder') return null;
        const asset = entry as AnyNyxAsset;
        if (asset.type === 'texture') {
            const orig = (asset as NyxTexture).origname;
            return orig ? getProjectImageUrl(orig) : null;
        }
        if (asset.type === 'template') {
            const uid = (asset as NyxTemplate).textureUid;
            const orig = uid ? texOrignames.get(uid) : undefined;
            return orig ? getProjectImageUrl(orig) : null;
        }
        return null;
    }

    // ── Navigation ─────────────────────────────────────────────────────────────
    function navigateTo(folder: NyxFolder) {
        folderStack = [...folderStack, folder];
    }

    function goUp() {
        folderStack = folderStack.slice(0, -1);
    }

    function moveUpTo(folder: NyxFolder | null) {
        if (!folder) { folderStack = []; return; }
        const idx = folderStack.indexOf(folder);
        if (idx !== -1) folderStack = folderStack.slice(0, idx + 1);
    }

    // ── Sort & Layout ──────────────────────────────────────────────────────────
    function setSort(key: SortKey) {
        sort = key;
        void window.electronAPI.settings.set(`${NS_KEY}.sort`, key);
    }

    function setLayout(l: Layout) {
        layout = l;
        void window.electronAPI.settings.set(`${NS_KEY}.layout`, l);
    }

    // ── Asset interaction ──────────────────────────────────────────────────────
    function onEntryClick(entry: NyxProjectEntry) {
        if (entry.type === 'folder') {
            navigateTo(entry as NyxFolder);
        } else {
            signals.emit('openAsset', entry as NyxAsset);
        }
    }

    function onEntryDragStart(e: DragEvent, entry: NyxProjectEntry) {
        const kind = entry.type === 'folder' ? 'assetFolderDrag' : 'assetDrag';
        const key  = entry.type === 'folder' ? 'folder' : 'asset';
        e.dataTransfer!.setData('text/plain', JSON.stringify({ type: kind, [key]: entry.uid }));
        e.dataTransfer!.dropEffect = 'move';
    }

    // ── Inline rename modal ───────────────────────────────────────────────────
    /** null = closed; uid===null means it's a folder */
    let renameTarget = $state<{ uid: string; assetType: AssetType | null; currentName: string } | null>(null);
    let renameInput  = $state('');

    function beginRename(uid: string, assetType: AssetType | null, currentName: string) {
        renameTarget = { uid, assetType, currentName };
        renameInput  = currentName;
    }

    function submitRename() {
        if (!renameTarget) return;
        const n = renameInput.trim();
        if (n && n !== renameTarget.currentName) {
            if (renameTarget.assetType === null) {
                renameFolder(renameTarget.uid, n);
            } else {
                updateAsset(renameTarget.uid, renameTarget.assetType, { name: n } as Partial<NyxAsset>);
                signals.emit('assetChanged');
            }
        }
        renameTarget = null;
    }

    // ── Context menu ──────────────────────────────────────────────────────────
    let ctxMenu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

    function openContextMenu(e: MouseEvent, entry: NyxProjectEntry) {
        e.preventDefault();
        e.stopPropagation();
        if (entry.type === 'folder') {
            const folder = entry as NyxFolder;
            ctxMenu = {
                x: e.clientX, y: e.clientY,
                items: [
                    {
                        icon: 'edit', label: 'Rename',
                        click: () => beginRename(folder.uid, null, folder.name)
                    },
                    { type: 'separator' },
                    {
                        icon: 'package', label: 'Unwrap folder',
                        click: async () => {
                            if (!await showConfirm(`Unwrap "${folder.name}"?`, 'Its contents will be moved to the current folder.')) return;
                            unwrapFolder(folder.uid, currentFolder);
                        }
                    },
                    {
                        icon: 'trash', label: 'Delete folder',
                        click: async () => {
                            if (!await showConfirm(`Delete "${folder.name}"?`, 'The folder and all its contents will be permanently deleted.')) return;
                            deleteFolderWithContents(folder.uid);
                            if (folderStack.some(f => f.uid === folder.uid)) moveUpTo(null);
                            signals.emit('assetChanged');
                        }
                    },
                ]
            };
        } else {
            const asset = entry as NyxAsset;
            ctxMenu = {
                x: e.clientX, y: e.clientY,
                items: [
                    ...(asset.type === 'texture' ? [{
                        icon: 'material-symbols:box-rounded', label: 'Create a template from it',
                        click: () => createTemplateFromTexture(asset)
                    }, { type: 'separator' as const }] : []),
                    {
                        icon: 'material-symbols:link-rounded', label: 'Open',
                        click: () => signals.emit('openAsset', asset)
                    },
                    {
                        icon: 'material-symbols:content-copy-outline', label: 'Copy name',
                        click: () => navigator.clipboard.writeText(asset.name).catch(() => {})
                    },
                    {
                        icon: 'material-symbols:edit', label: 'Rename',
                        click: () => beginRename(asset.uid, asset.type as AssetType, asset.name)
                    },
                    { type: 'separator' },
                    {
                        icon: 'material-symbols:delete', label: 'Delete',
                        click: async () => {
                            if (!await showConfirm(`Delete "${asset.name}"?`, 'This cannot be undone.')) return;
                            deleteAsset(asset.uid, asset.type as AssetType);
                            signals.emit('assetChanged');
                        }
                    },
                ]
            };
        }
    }

    // ── Create template from texture ──────────────────────────────────────────
    async function createTemplateFromTexture(textureAsset: NyxAsset): Promise<void> {
        const template = await createAssetWithScript('template', textureAsset.name, currentFolder) as NyxTemplate;
        updateAsset<NyxTemplate>(template.uid, 'template', { textureUid: textureAsset.uid });
        signals.emit('assetChanged');
        signals.emit('openAsset', template);
    }

    // ── Drag-over root area ────────────────────────────────────────────────────
    function onRootDragOver(e: DragEvent) { e.preventDefault(); }
    function onRootDrop(e: DragEvent) {
        const raw = e.dataTransfer?.getData('text/plain');
        if (!raw) return;
        try {
            const data = JSON.parse(raw) as { type: string; asset?: string; folder?: string };
            const uid = data.asset ?? data.folder;
            if (uid) moveEntryToRoot(uid);
        } catch { /* invalid drag payload */ }
    }
</script>

<!-- ══ Asset Browser ══════════════════════════════════════════════════════════ -->
<div class="asset-browser flexfix">
    <!-- ── Header: breadcrumb + sort + search + layout ───────────────────── -->
    <div class="flexfix-header flexrow">
        <!-- Breadcrumb -->
        <div class="asset-browser-Breadcrumbs grow">
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <span
                class="crumb {folderStack.length === 0 ? 'crumb-current' : 'crumb-link'}"
                role="button"
                tabindex="0"
                onclick={() => moveUpTo(null)}
                onkeydown={(e) => e.key === 'Enter' && moveUpTo(null)}
            >Assets</span>
            {#each folderStack as folder, i}
                <Icon icon="material-symbols:chevron-right" class="feather crumb-sep" />
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <span
                    class="crumb {i === folderStack.length - 1 ? 'crumb-current' : 'crumb-link'}"
                    role="button"
                    tabindex="0"
                    onclick={() => moveUpTo(folder)}
                    onkeydown={(e) => e.key === 'Enter' && moveUpTo(folder)}
                >{folder.name}</span>
            {/each}
            {#if folderStack.length > 0}
                <button class="inline square" title="Go up" onclick={goUp}>
                    <Icon icon="mdi:chevron-up" class="feather"/>
                </button>
            {/if}
        </div>

        <!-- Create new asset button + dropdown.
             The stopPropagation prevents the window click listener from immediately
             closing the menu when the + button is clicked. All real interactivity
             is on the <button> elements inside — the wrapper is purely structural. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="nogrow create-wrap" onclick={(e) => e.stopPropagation()}>
            <button class="success" title="Create new asset (or folder)" onclick={openCreateMenu}>
                <Icon icon="material-symbols:add" class="feather"/>
                <span>New</span>
            </button>
            {#if showCreateMenu}
                <div class="create-menu" role="menu">
                    {#each PRIORITY_TYPES as type}
                        <button role="menuitem" onclick={() => pickAssetType(type)}>
                            <Icon icon={`feather:${iconMap[type]}`} class="feather"/>
                            <span>{type.charAt(0).toUpperCase() + type.slice(1)}</span>
                        </button>
                    {/each}
                    <div class="menu-separator"></div>
                    {#each OTHER_TYPES as type}
                        <button role="menuitem" onclick={() => pickAssetType(type)}>
                            <Icon icon={`feather:${iconMap[type] ?? 'file'}`} class="feather"/>
                            <span>{type.charAt(0).toUpperCase() + type.slice(1)}</span>
                        </button>
                    {/each}
                    <div class="menu-separator"></div>
                    <button role="menuitem" onclick={pickFolder}>
                        <Icon icon="feather:folder-plus" class="feather"/>
                        <span>New Folder</span>
                    </button>
                    <div class="menu-separator"></div>
                    <button role="menuitem" onclick={() => { showCreateMenu = false; showTextureGenerator = true; }}>
                        <Icon icon="material-symbols:image" class="feather"/>
                        <span>Placeholder texture</span>
                    </button>
                </div>
            {/if}
        </div>

        <!-- Sort buttons -->
        <div class="nogrow flexrow controls">
            <div class="aButtonGroup">
                <button class="inline square" class:selected={sort === 'date'}
                        title="Sort by date" onclick={() => setSort('date')}>
                    <Icon icon="feather:clock" class="feather"/>
                </button>
                <button class="inline square" class:selected={sort === 'name'}
                        title="Sort by name" onclick={() => setSort('name')}>
                    <Icon icon="feather:type" class="feather"/>
                </button>
                <button class="inline square" class:selected={sort === 'type'}
                        title="Sort by type" onclick={() => setSort('type')}>
                    <Icon icon="feather:grid" class="feather"/>
                </button>
            </div>

            <!-- Layout switcher -->
            <div class="aButtonGroup nml">
                <button class="inline square" class:selected={layout === 'list'}
                        title="List view" onclick={() => setLayout('list')}>
                    <Icon icon="feather:list" class="feather"/>
                </button>
                <button class="inline square" class:selected={layout === 'cards'}
                        title="Cards view" onclick={() => setLayout('cards')}>
                    <Icon icon="feather:grid" class="feather"/>
                </button>
                <button class="inline square" class:selected={layout === 'largeCards'}
                        title="Large cards" onclick={() => setLayout('largeCards')}>
                    <Icon icon="feather:image" class="feather"/>
                </button>
                <button class="inline square" class:selected={groupByType}
                        title="Group by type" onclick={() => setGroupByType(!groupByType)}>
                    <Icon icon="material-symbols:category-outline" class="feather"/>
                </button>
            </div>

            <!-- Search -->
            <div class="aSearchWrap">
                <Icon icon="feather:search" class="feather search-icon" />
                <input
                    type="text"
                    placeholder="Search…"
                    bind:value={searchText}
                    class="inline"
                />
            </div>
        </div>
    </div>

    <!-- ── Asset grid / list ────────────────────────────────────────────────── -->
    <div
        class="flexfix-body asset-browser-grid {layout}"
        role="list"
        ondragover={onRootDragOver}
        ondrop={onRootDrop}
    >
        {#if filteredEntries.length === 0}
            <div class="empty-hint">
                {searchText ? 'No assets match your search.' : 'This folder is empty.'}
            </div>
        {:else if groupByType}
            {#each groupedEntries as group (group.type)}
                <div class="type-group-header">
                    <Icon icon={iconMap[group.type] ?? 'material-symbols:folder'} class="feather group-icon" />
                    <span class="group-label">{group.label}</span>
                    <span class="group-count dim">({group.entries.length})</span>
                </div>
                {#each group.entries as entry (entry.uid)}
                    {@const thumbUrl = getThumbnailUrl(entry)}
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <div
                        class="asset-tile {entry.type}"
                        role="button"
                        tabindex="0"
                        draggable="true"
                        onclick={() => onEntryClick(entry)}
                        onkeydown={(e) => e.key === 'Enter' && onEntryClick(entry)}
                        ondragstart={(e) => onEntryDragStart(e, entry)}
                        oncontextmenu={(e) => openContextMenu(e, entry)}
                    >
                        <div class="asset-tile-thumb">
                            {#if thumbUrl}
                                <img src={thumbUrl} alt={entry.name} class="tile-img" />
                            {:else}
                                <Icon icon={iconMap[entry.type] ?? 'material-symbols:insert-drive-file'} class="feather"/>
                            {/if}
                        </div>
                        <span class="asset-tile-name">{entry.name}</span>
                        {#if layout !== 'list'}
                            <span class="asset-tile-type">{entry.type}</span>
                        {/if}
                    </div>
                {/each}
            {/each}
        {:else}
            {#each displayEntries as entry (entry.uid)}
                {@const thumbUrl = getThumbnailUrl(entry)}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                    class="asset-tile {entry.type}"
                    role="button"
                    tabindex="0"
                    draggable="true"
                    onclick={() => onEntryClick(entry)}
                    onkeydown={(e) => e.key === 'Enter' && onEntryClick(entry)}
                    ondragstart={(e) => onEntryDragStart(e, entry)}
                    oncontextmenu={(e) => openContextMenu(e, entry)}
                >
                    <div class="asset-tile-thumb">
                        {#if thumbUrl}
                            <img src={thumbUrl} alt={entry.name} class="tile-img" />
                        {:else}
                            <Icon icon={iconMap[entry.type] ?? 'material-symbols:insert-drive-file'} class="feather"/>
                        {/if}
                    </div>
                    <span class="asset-tile-name">{entry.name}</span>
                    {#if entry.type !== 'folder' && layout !== 'list'}
                        <span class="asset-tile-type">{entry.type}</span>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>

    <!-- ══ New Asset / Folder name prompt ════════════════════════════════════ -->
    {#if showTextureGenerator}
        <div class="aDimmer" role="dialog" aria-modal="true" aria-label="Generate placeholder texture">
            <div class="aModal texture-gen-modal">
                <h2>Placeholder texture</h2>
                <TextureGenerator
                    folder={currentFolder}
                    onclose={() => { showTextureGenerator = false; }}
                    oncreated={() => { showTextureGenerator = false; signals.emit('assetChanged'); }}
                />
            </div>
        </div>
    {/if}

    {#if promptingType !== null || promptingFolder}
        <div class="aDimmer" role="dialog" aria-modal="true" aria-label="Name new asset">
            <div class="aModal pad npb">
                <h2 class="nmt">
                    {promptingFolder ? 'New Folder' : `New ${promptingType}`}
                </h2>

                <!-- Name -->
                <p class="dim nmb">Name:</p>
                <div class="prompt-input-wrap relative">
                    <input
                        type="text"
                        bind:value={promptName}
                        class:error={promptNameInvalid && promptName.trim() !== ''}
                        onkeydown={onPromptKeyDown}
                        use:focusOnMount
                        spellcheck={false}
                    />
                    {#if promptNameTaken}
                        <div class="anErrorNotice">Name is already taken</div>
                    {:else if promptNameEmpty}
                        <div class="anErrorNotice">Name cannot be empty</div>
                    {/if}
                </div>

                <!-- Per-type extra fields -->
                {#if promptingType && FILE_TYPES.includes(promptingType)}
                    <p class="dim nmb mt">Source file:</p>
                    <div class="file-pick-row">
                        <span class="file-pick-name dim">{promptFilePath ? (promptFilePath.split(/[\\/]/).pop() ?? promptFilePath) : '(optional — import later)'}</span>
                        <button class="nogrow" onclick={() => promptingType && browseFile(promptingType)}>
                            <Icon icon="feather:folder" class="feather"/>
                            <span>Browse…</span>
                        </button>
                    </div>
                {/if}

                {#if promptingType === 'room'}
                    <p class="dim nmb mt">Dimensions:</p>
                    <div class="dim-row">
                        <span class="dim small">W</span>
                        <input type="number" bind:value={promptRoomWidth}  min="1" class="dim-input" aria-label="Room width" />
                        <span class="dim small">H</span>
                        <input type="number" bind:value={promptRoomHeight} min="1" class="dim-input" aria-label="Room height" />
                        <span class="dim small">px</span>
                    </div>
                {/if}

                {#if promptingType === 'behavior'}
                    <p class="dim nmb mt">Applies to:</p>
                    <div class="radio-row">
                        <label class="radio-label">
                            <input type="radio" bind:group={promptBehaviorType} value="template" />
                            <span>Templates</span>
                        </label>
                        <label class="radio-label">
                            <input type="radio" bind:group={promptBehaviorType} value="room" />
                            <span>Rooms</span>
                        </label>
                    </div>
                {/if}

                <div class="inset flexrow nmb">
                    <button class="nogrow" onclick={cancelPrompt}>
                        <Icon icon="feather:x" class="feather"/>
                        <span>Cancel</span>
                    </button>
                    <div class="aSpacer"></div>
                    <button class="nogrow success" disabled={promptNameInvalid} onclick={submitPrompt}>
                        <Icon icon="feather:check" class="feather"/>
                        <span>Create</span>
                    </button>
                </div>
            </div>
        </div>
    {/if}
</div>

{#if ctxMenu}
    <ContextMenu
        x={ctxMenu.x}
        y={ctxMenu.y}
        items={ctxMenu.items}
        onclose={() => ctxMenu = null}
    />
{/if}

{#if renameTarget}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="rename-overlay"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        onpointerdown={(e) => { if (e.target === e.currentTarget) renameTarget = null; }}
    >
        <div class="rename-modal">
            <p class="rename-label">Rename <strong>{renameTarget.currentName}</strong></p>
            <input
                type="text"
                bind:value={renameInput}
                use:focusOnMount
                onkeydown={(e) => {
                    if (e.key === 'Enter') submitRename();
                    if (e.key === 'Escape') renameTarget = null;
                }}
            />
            <div class="rename-actions">
                <button onclick={() => renameTarget = null}>Cancel</button>
                <button
                    class="success"
                    disabled={!renameInput.trim() || renameInput.trim() === renameTarget.currentName}
                    onclick={submitRename}
                >Rename</button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* ── Shell ──────────────────────────────────────────────────────────────── */
    .asset-browser {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--background-deeper, #111122);
    }

    .flexfix-header {
        flex-shrink: 0;
        padding: 0.4rem 0.6rem;
        border-bottom: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        align-items: center;
        gap: 0.4rem;
    }

    .flexfix-body {
        flex: 1 1 auto;
        overflow: auto;
        min-height: 0;
    }

    .flexrow { display: flex; flex-flow: row nowrap; align-items: center; }
    .grow    { flex: 1 1 auto; min-width: 0; }
    .nogrow  { flex: 0 0 auto; }

    /* ── Breadcrumb ─────────────────────────────────────────────────────────── */
    .asset-browser-Breadcrumbs {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        flex-wrap: wrap;
        font-size: 0.85rem;
        overflow: hidden;
    }

    .crumb {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: default;
        padding: 0.1rem 0.25rem;
        border-radius: 3px;
    }

    .crumb-link {
        cursor: pointer;
        color: var(--acttext, #7ec8e3);
        &:hover { text-decoration: underline; }
    }

    .crumb-current { font-weight: 600; }

    .crumb-sep {
        width: 0.85rem; height: 0.85rem;
        fill: none; stroke: var(--text-dim, #888);
        stroke-width: 2; flex-shrink: 0;
    }

    /* ── Controls row ───────────────────────────────────────────────────────── */
    .controls { gap: 0.3rem; }

    .aButtonGroup {
        display: inline-flex;
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        overflow: hidden;

        button { border: none; border-radius: 0; border-right: 1px solid var(--border-bright, #333); }
        button:last-child { border-right: none; }
        button.selected { background: var(--accent1, #446adb); color: #fff; }
    }

    .nml { margin-left: 0 !important; }

    .aSearchWrap {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        overflow: hidden;
        padding: 0 0.3rem;
        background: var(--background-deeper, #111122);

        .search-icon {
            width: 0.85rem; height: 0.85rem;
            fill: none; stroke: var(--text-dim, #888);
            stroke-width: 2; flex-shrink: 0;
        }

        input {
            background: transparent;
            border: none;
            outline: none;
            color: var(--text, #e0e0e0);
            padding: 0.2rem 0.3rem;
            font-size: 0.8rem;
            width: 120px;
        }
    }

    /* ── Grid ───────────────────────────────────────────────────────────────── */
    .asset-browser-grid {
        padding: 0.5rem;

        &.cards {
            display: flex;
            flex-flow: row wrap;
            align-content: flex-start;
            gap: 0.4rem;
        }

        &.largeCards {
            display: flex;
            flex-flow: row wrap;
            align-content: flex-start;
            gap: 0.5rem;
        }

        &.list {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
        }
    }

    /* ── Asset tile ─────────────────────────────────────────────────────────── */
    .asset-tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        border-radius: 4px;
        border: 1px solid var(--border-pale, #2a2a3e);
        background: var(--background, #1a1a2e);
        user-select: none;
        transition: all 0.12s ease;
        overflow: hidden;
        text-align: center;

        &:hover {
            border-color: var(--accent1, #446adb);
            background: var(--act, #1e2233);
        }

        /* Cards layout */
        .cards & {
            width: 90px;
            padding: 0.5rem 0.3rem 0.3rem;
        }

        /* Large cards layout */
        .largeCards & {
            width: 120px;
            padding: 0.6rem 0.3rem 0.4rem;
        }

        /* List layout */
        .list & {
            flex-direction: row;
            gap: 0.5rem;
            padding: 0.2rem 0.5rem;
            width: 100%;
            text-align: left;
            justify-content: flex-start;

            .asset-tile-thumb { width: 1.2rem; height: 1.2rem; flex-shrink: 0; }
        }
    }

    .asset-tile-thumb {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 3rem;
        height: 3rem;
        flex-shrink: 0;

        .largeCards & { width: 4rem; height: 4rem; }

        :global(svg.feather) {
            width: 60%;
            height: 60%;
            fill: none;
            stroke: var(--acttext, #7ec8e3);
            stroke-width: 1.5;
        }
    }

    .asset-tile.folder .asset-tile-thumb svg { stroke: var(--warning, #f5a623); }

    .asset-tile-name {
        font-size: 0.72rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
        padding: 0 0.2rem;
        color: var(--text, #e0e0e0);

        .list & { font-size: 0.85rem; flex: 1 1 auto; }
    }

    .asset-tile-type {
        font-size: 0.65rem;
        color: var(--text-dim, #888);
        text-transform: capitalize;
    }

    /* ── Empty state ────────────────────────────────────────────────────────── */
    .empty-hint {
        width: 100%;
        padding: 2rem;
        text-align: center;
        color: var(--text-dim, #888);
        font-size: 0.85rem;
    }

    /* ── Buttons ────────────────────────────────────────────────────────────── */
    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.25rem 0.4rem;
        font-size: 0.85rem;
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        transition: all 0.12s ease;

        &.inline { background: transparent; border-color: transparent; }
        &.square  { width: 1.8rem; height: 1.8rem; padding: 0; justify-content: center; }

        &:hover {
            background: var(--act, #1e2233);
            border-color: var(--acttext, #7ec8e3);
            color: var(--acttext, #7ec8e3);
        }

        :global(svg.feather) {
            width: 0.9rem; height: 0.9rem;
            fill: none; stroke: currentColor;
            stroke-width: 2;
        }

        &.success {
            background: var(--success, #27ae60);
            border-color: var(--success, #27ae60);
            color: #fff;
            font-weight: 600;
            padding: 0.3rem 0.6rem;

            &:hover { background: #1e8449; border-color: #1e8449; color: #fff; }
        }

        &:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            pointer-events: none;
        }
    }

    /* ── Create menu ────────────────────────────────────────────────────────── */
    .create-wrap {
        position: relative;
    }

    .create-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        z-index: 50;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
        min-width: 160px;
        padding: 0.25rem 0;
        display: flex;
        flex-direction: column;

        button {
            width: 100%;
            border: none;
            border-radius: 0;
            padding: 0.3rem 0.75rem;
            justify-content: flex-start;
            font-size: 0.82rem;
            background: transparent;

            &:hover {
                background: var(--act, #1e2233);
                color: var(--acttext, #7ec8e3);
                border: none;
            }
        }
    }

    .menu-separator {
        height: 1px;
        background: var(--border-pale, #2a2a3e);
        margin: 0.2rem 0;
    }

    /* ── Name prompt modal ──────────────────────────────────────────────────── */
    .aDimmer {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        z-index: 60;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
    }

    .aModal {
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 6px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        width: 380px;
        max-width: 95vw;
        display: flex;
        flex-direction: column;
    }

    .texture-gen-modal {
        width: 640px;
        height: 480px;
        overflow: hidden;
        padding: 0;
    }

    .texture-gen-modal h2 {
        padding: 0.75rem 1rem 0.5rem;
        margin: 0;
        border-bottom: 1px solid var(--border-bright, #333);
        font-size: 0.95rem;
        flex-shrink: 0;
    }

    .texture-gen-modal :global(.texture-generator) {
        flex: 1 1 auto;
        min-height: 0;
    }

    .pad  { padding: 1rem; }
    .npb  { padding-bottom: 0; }
    .nmb  { margin-bottom: 0; }
    .nmt  { margin-top: 0; }
    .dim  { color: var(--text-dim, #888); font-size: 0.85rem; }

    h2 { font-size: 1rem; margin: 0 0 0.75rem; }
    p  { margin: 0 0 0.5rem; }

    .prompt-input-wrap {
        position: relative;
        margin: 0.5rem 0;
    }

    .relative { position: relative; }

    input[type="text"] {
        width: 100%;
        box-sizing: border-box;
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        color: var(--text, #e0e0e0);
        padding: 0.4rem 0.6rem;
        font-size: 0.9rem;
        outline: none;

        &:focus { border-color: var(--accent1, #446adb); }
        &.error { border-color: var(--danger, #e74c3c); }
    }

    .anErrorNotice {
        font-size: 0.75rem;
        color: var(--danger, #e74c3c);
        margin-top: 0.25rem;
    }

    .mt  { margin-top: 0.6rem; }

    .file-pick-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.25rem;
    }

    .file-pick-name {
        flex: 1 1 auto;
        font-size: 0.78rem;
        font-family: monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .dim-row {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin-top: 0.25rem;
    }

    .dim-input {
        width: 80px;
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.25rem 0.4rem;
        font-size: 0.85rem;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .radio-row {
        display: flex;
        gap: 1rem;
        margin-top: 0.25rem;
    }

    .radio-label {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.85rem;
        cursor: pointer;
        color: var(--text, #e0e0e0);
    }

    .inset {
        border-top: 1px solid var(--border-pale, #2a2a3e);
        padding: 0.75rem 1rem;
        margin: 0.75rem -1rem 0;
        display: flex;
        flex-flow: row nowrap;
        align-items: center;
        background: var(--background-deeper, #111122);
        border-radius: 0 0 6px 6px;
    }

    .flexrow { display: flex; flex-flow: row nowrap; align-items: center; }
    .nogrow  { flex: 0 0 auto; }
    .aSpacer { flex: 1 1 auto; }

    /* ── Rename modal ──────────────────────────────────────────────────────── */
    .rename-overlay {
        position: fixed;
        inset: 0;
        z-index: 10000;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .rename-modal {
        background: var(--background-alt, #1e1e30);
        border: 1px solid var(--border-bright, #444);
        border-radius: 6px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        padding: 1.25rem 1.5rem;
        min-width: 22rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;

        input[type="text"] {
            width: 100%;
            background: var(--background-deeper, #111122);
            border: 1px solid var(--border-bright, #444);
            border-radius: 4px;
            color: var(--text, #e0e0e0);
            padding: 0.4rem 0.6rem;
            font-size: 0.9rem;
            &:focus { outline: 1px solid var(--accent1, #446adb); border-color: var(--accent1, #446adb); }
        }
    }

    .rename-label { margin: 0; font-size: 0.9rem; }

    .rename-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }

    /* ── Tile image thumbnail ───────────────────────────────────────────────── */
    .tile-img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        image-rendering: pixelated;
        border-radius: 2px;
    }

    /* ── Type group header ──────────────────────────────────────────────────── */
    .type-group-header {
        flex-basis: 100%;
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.3rem 0.2rem 0.2rem;
        margin-top: 0.6rem;
        border-bottom: 1px solid var(--border-bright, #333);
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--text-dim, #888);

        &:first-child { margin-top: 0; }

        :global(svg.feather) {
            width: 0.85rem; height: 0.85rem;
            fill: none; stroke: var(--text-dim, #888);
            stroke-width: 2; flex-shrink: 0;
        }
    }

    .group-label { flex: 1 1 auto; }

    .group-count {
        font-size: 0.7rem;
        font-weight: 400;
    }
</style>
