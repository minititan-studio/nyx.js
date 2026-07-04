<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * AppView.svelte
     * Migrated from: app-view.tag (ct.js legacy)
     *
     * Main editor shell — top nav bar, scrollable asset tab strip,
     * pinnable/resizable left side panel, main content area.
     */
    import { onMount, onDestroy } from 'svelte';
    import {
        signals,
        openedAssets,
        activeTab,
        tabsDirty,
        assetBrowserPinned,
        undoTargetOverride
    } from '../stores/editorStore.js';
    import { closeProject, currentProject, saveProjectFile, projectFilePath, dirtyAssetUids, snapshotAssetBaseline, undoAsset, redoAsset, discardAssetChanges, clearAssetHistory } from '../stores/projectStore.js';
    import { get } from 'svelte/store';
    import { electronAPI } from '../lib/electron.js';
    import { showAlert } from '../lib/dialogs.js';
    import AssetFolderTree from './AssetFolderTree.svelte';
    import AssetBrowser from './AssetBrowser.svelte';
    import ProjectSettings from './ProjectSettings.svelte';
    import MainMenu from './MainMenu.svelte';
    import DebuggerPanel from './DebuggerPanel.svelte';
    import TextureEditor from './editors/TextureEditor.svelte';
    import TemplateEditor from './editors/TemplateEditor.svelte';
    import RoomEditor from './editors/RoomEditor.svelte';
    import SoundEditor from './editors/SoundEditor.svelte';
    import FontEditor from './editors/FontEditor.svelte';
    import StyleEditor from './editors/StyleEditor.svelte';
    import BehaviorEditor from './editors/BehaviorEditor.svelte';
    import ScriptEditor from './editors/ScriptEditor.svelte';
    import EnumEditor from './editors/EnumEditor.svelte';
    import EmitterTandemEditor from './editors/EmitterTandemEditor.svelte';
    import UILayerEditor from './editors/UILayerEditor.svelte';
    import { isElectron } from '../lib/electron.js';
    import { hotkeys } from '@nyx/shared';
    import DndProcessor from './DndProcessor.svelte';
    import type {
        NyxAsset, NyxTexture, NyxTemplate, NyxRoom, NyxSound, NyxFont,
        NyxStyle, NyxBehavior, NyxScript, NyxEnum, NyxEmitterTandem, NyxUILayer
    } from '@nyx/shared';

    // Type-cast helpers — needed because Svelte templates can't use `as` in expressions
    const asTexture       = (a: NyxAsset) => a as NyxTexture;
    const asTemplate      = (a: NyxAsset) => a as NyxTemplate;
    const asRoom          = (a: NyxAsset) => a as NyxRoom;
    const asSound         = (a: NyxAsset) => a as NyxSound;
    const asFont          = (a: NyxAsset) => a as NyxFont;
    const asStyle         = (a: NyxAsset) => a as NyxStyle;
    const asBehavior      = (a: NyxAsset) => a as NyxBehavior;
    const asScript        = (a: NyxAsset) => a as NyxScript;
    const asEnum          = (a: NyxAsset) => a as NyxEnum;
    const asEmitterTandem = (a: NyxAsset) => a as NyxEmitterTandem;
    const asUILayer       = (a: NyxAsset) => a as NyxUILayer;

    // ── State ─────────────────────────────────────────────────────────────────
    let exportingProject = $state(false);
    let showPrelaunchSave = $state(false);
    let showCloseTabConfirm = $state(false);
    let pendingCloseAsset = $state<NyxAsset | null>(null);
    let pendingCloseIndex = $state<number>(-1);
    let showExitConfirm = $state(false);
    let disposeCloseListener: (() => void) | null = null;
    /** URL of the running game server. Null = not started. */
    let gameServerUrl = $state<string | null>(null);

    // Scroll shadow indicators on the tab strip
    let scrollableLeft = $state(false);
    let scrollableRight = $state(false);

    // Side panel resize
    const MIN_PANEL_WIDTH = 150;
    let isDragging = false;
    let panelWidth = $state<number>(
        (window.electronAPI.settings.getAll()['assetsTreeWidth'] as number | undefined) ?? 240
    );

    // DOM refs (imperative — not reactive state, but $state silences the warning)
    let tabsWrapEl = $state<HTMLUListElement | undefined>(undefined);
    let containerEl = $state<HTMLDivElement | undefined>(undefined);
    let leftPanelEl = $state<HTMLDivElement | undefined>(undefined);

    // Derived: is the left panel visible?
    const showSidePanel = $derived(
        $activeTab === 'assets' || $assetBrowserPinned
    );

    // ── Global asset search ───────────────────────────────────────────────────
    let searchQuery     = $state('');
    let searchHighlight = $state(-1);
    let searchFocused   = $state(false);
    let searchInputEl   = $state<HTMLInputElement | undefined>(undefined);

    const searchResults = $derived.by(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q || !$currentProject) return [] as NyxAsset[];
        const all: NyxAsset[] = [
            ...$currentProject.textures,
            ...$currentProject.templates,
            ...$currentProject.rooms,
            ...$currentProject.sounds,
            ...$currentProject.fonts,
            ...$currentProject.styles,
            ...$currentProject.behaviors,
            ...$currentProject.scripts,
            ...$currentProject.enums,
            ...$currentProject.emitterTandems,
        ];
        return all.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8);
    });

    const searchOpen = $derived(searchFocused && searchQuery.trim().length > 0);

    $effect(() => {
        void searchResults;
        searchHighlight = -1;
    });

    function onSearchKeyDown(e: KeyboardEvent) {
        if (!searchOpen) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            searchHighlight = Math.min(searchHighlight + 1, searchResults.length - 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            searchHighlight = Math.max(searchHighlight - 1, 0);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const target = searchHighlight >= 0 ? searchResults[searchHighlight] : searchResults[0];
            if (target) commitSearchResult(target);
        } else if (e.key === 'Escape') {
            searchQuery = '';
            searchFocused = false;
            searchInputEl?.blur();
        }
    }

    function commitSearchResult(asset: NyxAsset) {
        openAsset(asset);
        searchQuery = '';
        searchFocused = false;
        searchHighlight = -1;
    }

    // ── Icon map (mirrors legacy resources.resourceToIconMap) ─────────────────
    const iconMap: Record<string, string> = {
        texture:       'image',
        template:      'box',
        room:          'layout',
        sound:         'volume-2',
        font:          'type',
        style:         'droplet',
        behavior:      'activity',
        script:        'code',
        enum:          'list',
        emitterTandem: 'star'
    };

    // ── Tab management ────────────────────────────────────────────────────────

    function changeTab(tab: string | NyxAsset) {
        activeTab.set(tab);
        signals.emit('globalTabChanged', tab);
        if (typeof tab === 'string') {
            signals.emit(`${tab}Focus` as keyof typeof signals._);
        }
        setTimeout(updateScrollShadows, 0);
    }

    function openAsset(asset: NyxAsset) {
        openedAssets.update(list => {
            if (list.includes(asset)) return list;
            snapshotAssetBaseline(asset);
            // Insert next to current asset tab if possible
            const current = $activeTab;
            const pos = typeof current !== 'string' ? list.indexOf(current) : -1;
            const newList = [...list];
            if (pos !== -1) {
                newList.splice(pos + 1, 0, asset);
            } else {
                newList.push(asset);
            }
            return newList;
        });
        changeTab(asset);
        updateTabsDirty();
    }

    function closeAsset(e: Event, asset: NyxAsset, ind: number) {
        e.stopPropagation();
        e.preventDefault();
        const dirty = $tabsDirty[ind] ?? false;
        if (dirty) {
            pendingCloseAsset = asset;
            pendingCloseIndex = ind;
            showCloseTabConfirm = true;
            return;
        }
        doCloseTab(asset, ind);
    }

    function doCloseTab(asset: NyxAsset, ind: number) {
        clearAssetHistory(asset.uid);
        openedAssets.update(list => list.filter((_, i) => i !== ind));
        if ($activeTab === asset) {
            changeTab('assets');
        }
        updateTabsDirty();
    }

    async function confirmApplyAndClose() {
        showCloseTabConfirm = false;
        await saveProject();
        if (pendingCloseAsset) doCloseTab(pendingCloseAsset, pendingCloseIndex);
        pendingCloseAsset = null;
        pendingCloseIndex = -1;
    }

    function confirmDiscardAndClose() {
        showCloseTabConfirm = false;
        if (pendingCloseAsset) {
            discardAssetChanges(pendingCloseAsset.uid);
            doCloseTab(pendingCloseAsset, pendingCloseIndex);
        }
        pendingCloseAsset = null;
        pendingCloseIndex = -1;
    }

    function cancelClose() {
        showCloseTabConfirm = false;
        pendingCloseAsset = null;
        pendingCloseIndex = -1;
    }

    // ── Exit confirmation (window close with dirty assets) ────────────────────

    function handleCloseRequested() {
        const anyDirty = $tabsDirty.some(Boolean);
        if (!anyDirty) {
            electronAPI().window.confirmClose();
        } else {
            showExitConfirm = true;
        }
    }

    async function confirmSaveAndExit() {
        showExitConfirm = false;
        await saveProject();
        electronAPI().window.confirmClose();
    }

    function confirmDiscardAndExit() {
        showExitConfirm = false;
        electronAPI().window.confirmClose();
    }

    function updateTabsDirty() {
        const dirty = $dirtyAssetUids;
        tabsDirty.set($openedAssets.map(a => dirty.has(a.uid)));
    }

    // ── Save & run ────────────────────────────────────────────────────────────

    let saveError = $state<string | null>(null);

    async function saveProject() {
        if (!$currentProject) return;
        try {
            // If no path yet, prompt Save As
            if (!$projectFilePath) {
                const result = await electronAPI().dialog.showSaveDialog({
                    title: 'Save project',
                    defaultPath: `${$currentProject.name}.json`,
                    filters: [{ name: 'Nyx project', extensions: ['json'] }],
                });
                if (result.canceled || !result.filePath) return;
                await saveProjectFile(result.filePath);
            } else {
                await saveProjectFile();
            }
            saveError = null;
            signals.emit('projectSaved');
        } catch (err) {
            saveError = err instanceof Error ? err.message : String(err);
            console.error('[AppView] saveProject failed:', err);
        }
    }

    function tryRunProject() {
        if (exportingProject) return;
        const anyDirty = $tabsDirty.some(Boolean);
        if (anyDirty) {
            showPrelaunchSave = true;
        } else {
            runProject();
        }
    }

    async function runProject() {
        if (exportingProject) return;
        if (!isElectron()) {
            console.warn('[AppView] runProject() requires Electron');
            return;
        }
        // Guard against stale preload builds that predate the gameServer IPC.
        // If this triggers, the user just needs to restart the dev server.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gs = (electronAPI() as any).gameServer as Window['electronAPI']['gameServer'] | undefined;
        if (!gs) {
            await showAlert(
                'Game server API unavailable.',
                'The preload script was not rebuilt yet. Close the app and restart with: pnpm dev'
            );
            return;
        }
        exportingProject = true;
        try {
            const proj     = JSON.parse(JSON.stringify($currentProject));
            const filePath = $projectFilePath;
            if (!proj || !filePath) {
                await showAlert('Save the project before running it.');
                return;
            }
            await gs.export(proj, filePath);
            const { port } = await gs.start();
            gameServerUrl = `http://127.0.0.1:${port}/`;
            changeTab('debug');
        } catch (e) {
            console.error('[AppView] runProject() failed:', e);
        } finally {
            exportingProject = false;
        }
    }

    function cancelLaunch() {
        showPrelaunchSave = false;
    }

    function launchNoApply() {
        showPrelaunchSave = false;
        runProject();
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    //
    // The hotkeys registry (packages/shared/src/hotkeys.ts) owns the global
    // keydown listener and dispatches to registered handlers by combo string.
    // AppView registers the editor-wide actions here and also handles a few
    // raw key events (F5, F11, Ctrl+1..0) that are not emitted as signals.

    /** Global hotkey handlers registered by this component. */
    function onHotkeySave()    { saveProject(); }
    function onHotkeyUndo() {
        const override = get(undoTargetOverride);
        if (override) { undoAsset(override); return; }
        const tab = $activeTab;
        if (typeof tab === 'object') undoAsset(tab.uid);
        else signals.emit('undo');
    }
    function onHotkeyRedo() {
        const override = get(undoTargetOverride);
        if (override) { redoAsset(override); return; }
        const tab = $activeTab;
        if (typeof tab === 'object') redoAsset(tab.uid);
        else signals.emit('redo');
    }
    function onHotkeyNewAsset(){ signals.emit('newAsset'); }
    function onHotkeyEscape()  { signals.emit('closeModal'); }

    /**
     * Raw keydown listener kept on `document` for shortcuts that depend on
     * tab-index state (Ctrl+1..0) or non-signal actions (F5, F11).
     * Form-field filtering is handled inside the hotkeys registry for
     * registered combos; this handler does its own guard for raw combos.
     */
    function onKeyDown(e: KeyboardEvent) {
        const tag = (e.target as HTMLElement).tagName.toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) return;

        if (e.key === 'F5') {
            e.preventDefault();
            tryRunProject();
        } else if (e.key === 'F11') {
            e.preventDefault();
            electronAPI().window.isMaximized().then(max => {
                if (max) electronAPI().window.unmaximize();
                else     electronAPI().window.maximize();
            });
        } else if (e.ctrlKey && e.key === '1') {
            e.preventDefault(); changeTab('project');
        } else if (e.ctrlKey && e.key === '2') {
            e.preventDefault(); changeTab('assets');
        } else if (e.ctrlKey && /^[3-9]$/.test(e.key)) {
            e.preventDefault();
            const idx = parseInt(e.key, 10) - 3;
            const asset = $openedAssets[idx];
            if (asset) changeTab(asset);
        } else if (e.ctrlKey && e.key === '0') {
            // Ctrl+0 → 10th tab (idx 7)
            e.preventDefault();
            const asset = $openedAssets[7];
            if (asset) changeTab(asset);
        }
        // Ctrl+S / Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Escape / Ctrl+N
        // are handled by the hotkeys registry via the handlers registered
        // in onMount — no duplicated handling needed here.
    }

    // ── Horizontal tab scroll ─────────────────────────────────────────────────

    function scrollHorizontally(e: WheelEvent) {
        if (!tabsWrapEl) return;
        const newLeft = tabsWrapEl.scrollLeft + e.deltaY;
        tabsWrapEl.scrollLeft = newLeft;
        updateScrollShadows(newLeft);
    }

    function updateScrollShadows(val?: number) {
        if (!tabsWrapEl) return;
        const v = val ?? tabsWrapEl.scrollLeft;
        scrollableLeft  = v > 0;
        scrollableRight = v < tabsWrapEl.scrollWidth - tabsWrapEl.clientWidth;
    }

    // ── Side panel resize ─────────────────────────────────────────────────────

    function onDividerMouseDown(e: MouseEvent) {
        e.preventDefault();
        isDragging = true;
        document.body.style.cursor    = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup',   handleMouseUp);
    }

    function handleMouseMove(e: MouseEvent) {
        if (!isDragging || !containerEl) return;
        const rect = containerEl.getBoundingClientRect();
        let w = e.clientX - rect.left;
        const maxW = rect.width * 0.8;
        w = Math.max(MIN_PANEL_WIDTH, Math.min(w, maxW));
        panelWidth = w;
    }

    function handleMouseUp() {
        isDragging = false;
        void window.electronAPI.settings.set('assetsTreeWidth', panelWidth);
        document.body.style.cursor    = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup',   handleMouseUp);
    }

    function revalidatePanelWidth() {
        if (!containerEl) return;
        const maxW = containerEl.getBoundingClientRect().width * 0.8;
        if (panelWidth > maxW) panelWidth = Math.max(MIN_PANEL_WIDTH, maxW);
    }

    // ── Signals ───────────────────────────────────────────────────────────────

    function onSaveProjectSignal() { saveProject(); }
    function onResetAll() { closeProject(); }
    function onOpenAsset(asset: string | NyxAsset) {
        if (typeof asset === 'string') {
            const uid  = asset;
            const proj = get(currentProject);
            if (!proj) return;
            const found = (
                [...proj.textures, ...proj.templates, ...proj.rooms,
                 ...proj.sounds, ...proj.fonts, ...proj.styles,
                 ...proj.behaviors, ...proj.scripts, ...proj.enums,
                 ...proj.emitterTandems, ...(proj.uiLayers ?? [])] as NyxAsset[]
            ).find(a => a.uid === uid);
            if (found) openAsset(found);
            return;
        }
        openAsset(asset);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    onMount(() => {
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', revalidatePanelWidth);
        signals.on('saveProject', onSaveProjectSignal);
        signals.on('resetAll', onResetAll);
        signals.on('openAsset', onOpenAsset);
        if (isElectron()) {
            disposeCloseListener = electronAPI().window.onCloseRequested(handleCloseRequested);
        }
        setTimeout(updateScrollShadows, 100);

        // ── Global hotkeys via registry ──────────────────────────────────────
        // These combos use the canonical format from hotkeys.ts:
        //   Ctrl = 'Control', letter keys are lowercase (no shift).
        hotkeys.on('Control+s',       onHotkeySave);     // Ctrl+S  → save
        hotkeys.on('Control+z',       onHotkeyUndo);     // Ctrl+Z  → undo
        hotkeys.on('Control+Z',       onHotkeyRedo);     // Ctrl+Shift+Z → redo
        hotkeys.on('Control+y',       onHotkeyRedo);     // Ctrl+Y  → redo (Windows alt)
        hotkeys.on('Control+n',       onHotkeyNewAsset); // Ctrl+N  → new asset
        hotkeys.on('Escape',          onHotkeyEscape);   // Escape  → close modal / deselect
    });

    // Keep tabsDirty in sync reactively whenever opened tabs or dirty set changes
    $effect(() => {
        const dirty = $dirtyAssetUids;
        tabsDirty.set($openedAssets.map(a => dirty.has(a.uid)));
    });

    // Open DevTools when entering the debug tab, close when leaving it.
    $effect(() => {
        if (!isElectron()) return;
        if ($activeTab === 'debug') {
            electronAPI().devtools.open();
        } else {
            electronAPI().devtools.close();
        }
    });

    onDestroy(() => {
        document.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', revalidatePanelWidth);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup',   handleMouseUp);
        signals.off('saveProject', onSaveProjectSignal);
        signals.off('resetAll', onResetAll);
        signals.off('openAsset', onOpenAsset);
        disposeCloseListener?.();

        // ── Unregister global hotkeys ────────────────────────────────────────
        hotkeys.off('Control+s',       onHotkeySave);
        hotkeys.off('Control+z',       onHotkeyUndo);
        hotkeys.off('Control+Z',       onHotkeyRedo);
        hotkeys.off('Control+y',       onHotkeyRedo);
        hotkeys.off('Control+n',       onHotkeyNewAsset);
        hotkeys.off('Escape',          onHotkeyEscape);

        // Stop the game server when the editor is unmounted
        if (isElectron() && gameServerUrl) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const gs = (electronAPI() as any).gameServer as Window['electronAPI']['gameServer'] | undefined;
            gs?.stop().catch(() => { /* ignore */ });
            gameServerUrl = null;
        }
    });
</script>

<!-- ══ Top nav bar ══════════════════════════════════════════════════════════ -->
<div class="app-view">
    <nav class="nogrow flexrow" aria-label="Main toolbar">
        <!-- Fixed left tabs -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <ul class="aNav tabs nogrow" role="tablist">
            <li class="limitwidth" role="tab" tabindex="0"
                class:active={$activeTab === 'menu'}
                onclick={() => changeTab('menu')}
                onkeydown={(e) => e.key === 'Enter' && changeTab('menu')}
                title="Main Menu">
                <Icon icon="feather:menu" class="feather nmr" aria-hidden="true" />
            </li>
            <li class="limitwidth" role="tab" tabindex="0"
                onclick={saveProject}
                onkeydown={(e) => e.key === 'Enter' && saveProject()}
                title="Save (Ctrl+S)">
                <Icon icon="feather:save" aria-hidden="true" class="feather"/>
            </li>
            <li class="nbl nogrow noshrink" role="tab" tabindex="0"
                class:active={$activeTab === 'debug'}
                onclick={tryRunProject}
                onkeydown={(e) => e.key === 'Enter' && tryRunProject()}
                title="Run / Debug (F5)">
                {#if exportingProject}
                    <Icon icon="feather:refresh-ccw" class="feather rotateccw" aria-hidden="true" />
                {:else}
                    <Icon icon="material-symbols:play-arrow" aria-hidden="true" class="feather"/>
                {/if}
                {#if $activeTab !== 'debug'}
                    <span>Run</span>
                {:else}
                    <span>Restart</span>
                {/if}
            </li>
            <li class="nogrow noshrink" role="tab" tabindex="0"
                class:active={$activeTab === 'project'}
                onclick={() => changeTab('project')}
                onkeydown={(e) => e.key === 'Enter' && changeTab('project')}
                title="Project (Ctrl+1)">
                <Icon icon="feather:sliders" aria-hidden="true" class="feather"/>
                <span>Project</span>
            </li>
            <li class="nogrow noshrink" role="tab" tabindex="0"
                class:active={$activeTab === 'assets'}
                onclick={() => changeTab('assets')}
                onkeydown={(e) => e.key === 'Enter' && changeTab('assets')}
                title="Assets (Ctrl+2)">
                <Icon icon="feather:folder" aria-hidden="true" class="feather"/>
                <span>Assets</span>
            </li>
        </ul>

        <!-- Scrollable asset tab strip -->
        <div class="aTabsWrapper"
             class:shadowleft={scrollableLeft}
             class:shadowright={scrollableRight}
             onwheel={scrollHorizontally}>
            <ul class="aNav flexrow xscroll" bind:this={tabsWrapEl}>
                {#each $openedAssets as asset, ind (asset.uid)}
                    <li class="nogrow"
                        role="tab"
                        tabindex="0"
                        class:active={asset === $activeTab}
                        onclick={() => changeTab(asset)}
                        onkeydown={(e) => e.key === 'Enter' && changeTab(asset)}
                        onauxclick={(e) => closeAsset(e, asset, ind)}
                        title={asset.name}>
                        <Icon icon={`feather:${iconMap[asset.type] ?? 'file'}`} aria-hidden="true" class="feather"/>
                        <span>{asset.name}</span>
                        {#if $tabsDirty[ind]}
                            <!-- Unsaved indicator: dot → X on hover -->
                            <button class="tab-close-btn warning"
                                    onclick={(e) => closeAsset(e, asset, ind)}
                                    title="Unsaved changes — click to close"
                                    aria-label="Close unsaved tab">
                                <Icon icon="feather:circle" class="feather anActionableIcon" aria-hidden="true" />
                                <!-- <Icon icon="material-symbols:close-rounded" class="feather anActionableIcon close-icon" aria-hidden="true" /> -->
                            </button>
                        {:else}
                            <button class="tab-close-btn"
                                    aria-label="Close tab"
                                    onclick={(e) => closeAsset(e, asset, ind)}>
                                <Icon icon="material-symbols:close-rounded" aria-hidden="true" class="feather"/>
                            </button>
                        {/if}
                    </li>
                {/each}
            </ul>
        </div>

        <!-- Global asset search -->
        <div class="nogrow search-wrap">
            <Icon icon="material-symbols:search" aria-hidden="true" class="feather search-icon"/>
            <input
                bind:this={searchInputEl}
                bind:value={searchQuery}
                class="search-input"
                type="search"
                placeholder="Search assets…"
                onfocus={() => searchFocused = true}
                onblur={() => setTimeout(() => { searchFocused = false; }, 150)}
                onkeydown={onSearchKeyDown}
                autocomplete="off"
                aria-label="Search assets"
            />
            {#if searchOpen}
                <div class="search-results" role="listbox" aria-label="Search results">
                    {#each searchResults as result, i (result.uid)}
                        <!-- svelte-ignore a11y_interactive_supports_focus -->
                        <div
                            class="search-result"
                            class:highlighted={i === searchHighlight}
                            role="option"
                            aria-selected={i === searchHighlight}
                            onpointerdown={() => commitSearchResult(result)}
                        >
                            <Icon icon="feather:{iconMap[result.type] ?? 'file'}" class="feather" aria-hidden="true"/>
                            <span class="result-name">{result.name}</span>
                            <span class="result-type">{result.type}</span>
                        </div>
                    {:else}
                        <p class="no-results">No assets found</p>
                    {/each}
                </div>
            {/if}
        </div>
    </nav>

    <!-- ══ Body row ═══════════════════════════════════════════════════════════ -->
    <div class="flexrow app-view-anIdeWrap" bind:this={containerEl}>

        <!-- Left side panel (conditional) -->
        {#if showSidePanel}
            <div class="app-view-aSideviewBrowser flexfix"
                 bind:this={leftPanelEl}
                 style="width: {panelWidth}px">
                <div class="flexfix-header">
                    <button class="inline toright"
                            title={$assetBrowserPinned ? 'Unpin panel' : 'Pin panel'}
                            onclick={() => assetBrowserPinned.update(v => !v)}>
                        <Icon icon={`feather:${$assetBrowserPinned ? 'material-symbols:lock' : 'material-symbols:lock-open'}`} aria-hidden="true" class="feather"/>
                    </button>
                    <h3 class="nm">Assets</h3>
                </div>
                <div class="flexfix-body">
                    <AssetFolderTree
                        path={[]}
                        depth={0}
                        showassets={true}
                        entries={$currentProject?.assets ?? []}
                        onassetclick={(asset) => signals.emit('openAsset', asset)}
                    />
                </div>
            </div>

            <!-- Drag divider — intentional resize handle, mouse events required -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="aVerticalDivider"
                 role="separator"
                 aria-label="Drag to resize panel"
                 tabindex="-1"
                 onmousedown={onDividerMouseDown}></div>
        {/if}

        <!-- Main content area -->
        <div class="flexitem relative">
            <!-- Main Menu panel -->
            {#if $activeTab === 'menu'}
                <div class="aView">
                    <MainMenu />
                </div>
            {/if}

            <!-- Project settings panel -->
            {#if $activeTab === 'project'}
                <div class="aView">
                    <ProjectSettings />
                </div>
            {/if}

            <!-- Asset browser panel -->
            {#if $activeTab === 'assets'}
                <div class="aView">
                    <AssetBrowser />
                </div>
            {/if}

            <!-- Debugger / game preview panel -->
            {#if $activeTab === 'debug'}
                <div class="aView">
                    <DebuggerPanel
                        url={gameServerUrl}
                        onrestart={tryRunProject}
                    />
                </div>
            {/if}

            <!-- Patrons panel (Phase 5) -->
            {#if $activeTab === 'patrons'}
                <div class="aView phase4-placeholder" data-phase="5">
                    Patrons (Phase 5)
                </div>
            {/if}

            <!-- Open asset editors -->
            {#each $openedAssets as asset (asset.uid)}
                {#if asset === $activeTab}
                    <div class="aView">
                        {#if asset.type === 'texture'}
                            <TextureEditor asset={asTexture(asset)} />
                        {:else if asset.type === 'template'}
                            <TemplateEditor asset={asTemplate(asset)} />
                        {:else if asset.type === 'room'}
                            <RoomEditor asset={asRoom(asset)} />
                        {:else if asset.type === 'sound'}
                            <SoundEditor asset={asSound(asset)} />
                        {:else if asset.type === 'font'}
                            <FontEditor asset={asFont(asset)} />
                        {:else if asset.type === 'style'}
                            <StyleEditor asset={asStyle(asset)} />
                        {:else if asset.type === 'behavior'}
                            <BehaviorEditor asset={asBehavior(asset)} />
                        {:else if asset.type === 'script'}
                            <ScriptEditor asset={asScript(asset)} />
                        {:else if asset.type === 'enum'}
                            <EnumEditor asset={asEnum(asset)} />
                        {:else if asset.type === 'emitterTandem'}
                            <EmitterTandemEditor asset={asEmitterTandem(asset)} />
                        {:else if asset.type === 'uiLayer'}
                            <UILayerEditor asset={asUILayer(asset)} />
                        {/if}
                    </div>
                {/if}
            {/each}
        </div>
    </div>

    <!-- ══ Save error toast ══════════════════════════════════════════════════ -->
    {#if saveError}
        <div class="save-error-toast" role="alert">
            <Icon icon="feather:alert-circle" aria-hidden="true" class="feather"/>
            <span>Save failed: {saveError}</span>
            <button onclick={() => saveError = null} aria-label="Dismiss">
                <Icon icon="material-symbols:close-rounded" class="feather"/>
            </button>
        </div>
    {/if}

    <!-- ══ Pre-launch save dialog ═════════════════════════════════════════════ -->
    {#if showPrelaunchSave}
        <div class="aDimmer fixed pad">
            <button class="aDimmer-aCloseButton" aria-label="Cancel" onclick={cancelLaunch}>
                <Icon icon="material-symbols:close-rounded" aria-hidden="true" class="feather"/>
            </button>
            <div class="aModal pad npb flexfix app-view-anAssetConfirmDialog">
                <div class="flexfix-header">
                    <h2 class="nmt">Apply unsaved changes?</h2>
                    <p>The following assets have unsaved changes:</p>
                </div>
                <div class="flexfix-body">
                    <ul class="aStripedList">
                        {#each $openedAssets as asset, ind}
                            {#if $tabsDirty[ind]}
                                <li>
                                    <Icon icon={`feather:${iconMap[asset.type] ?? 'file'}`} aria-hidden="true" class="feather"/>
                                    <span> {asset.name}</span>
                                </li>
                            {/if}
                        {/each}
                    </ul>
                </div>
                <div class="inset flexrow flexfix-footer">
                    <button class="nogrow" onclick={cancelLaunch}>
                        <Icon icon="material-symbols:undo" aria-hidden="true" class="feather"/>
                        <span>Go back</span>
                    </button>
                    <div class="aSpacer"></div>
                    <button class="nogrow" onclick={launchNoApply}>
                        <Icon icon="material-symbols:play-arrow" aria-hidden="true" class="feather"/>
                        <span>Run without applying</span>
                    </button>
                    <div class="aSpacer"></div>
                    <button class="nogrow success" onclick={() => { showPrelaunchSave = false; runProject(); }}>
                        <Icon icon="material-symbols:check" aria-hidden="true" class="feather"/>
                        <span>Apply and run</span>
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- ══ Exit with unapplied changes dialog ═══════════════════════════════════ -->
    {#if showExitConfirm}
        <div class="aDimmer fixed pad">
            <div class="aModal pad npb flexfix app-view-anAssetConfirmDialog">
                <div class="flexfix-header">
                    <h2 class="nmt">Unapplied changes</h2>
                    <p>The following assets have unapplied changes:</p>
                </div>
                <div class="flexfix-body">
                    <ul class="aStripedList">
                        {#each $openedAssets as asset, ind}
                            {#if $tabsDirty[ind]}
                                <li>
                                    <Icon icon={`feather:${iconMap[asset.type] ?? 'file'}`} aria-hidden="true" class="feather"/>
                                    <span> {asset.name}</span>
                                </li>
                            {/if}
                        {/each}
                    </ul>
                </div>
                <div class="inset flexrow flexfix-footer">
                    <button class="nogrow danger" onclick={confirmDiscardAndExit}>
                        <Icon icon="material-symbols:close-rounded" aria-hidden="true" class="feather"/>
                        <span>Discard &amp; exit</span>
                    </button>
                    <div class="aSpacer"></div>
                    <button class="nogrow" onclick={() => showExitConfirm = false}>
                        <span>Cancel</span>
                    </button>
                    <div class="aSpacer"></div>
                    <button class="nogrow success" onclick={confirmSaveAndExit}>
                        <Icon icon="material-symbols:check" aria-hidden="true" class="feather"/>
                        <span>Save &amp; exit</span>
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- ══ Close-tab unapplied changes dialog ════════════════════════════════════ -->
    {#if showCloseTabConfirm && pendingCloseAsset}
        <div class="aDimmer fixed pad">
            <button class="aDimmer-aCloseButton" aria-label="Cancel" onclick={cancelClose}>
                <Icon icon="material-symbols:close-rounded" aria-hidden="true" class="feather"/>
            </button>
            <div class="aModal pad app-view-anAssetConfirmDialog">
                <h2 class="nmt">Select action</h2>
                <p>The <strong>{pendingCloseAsset.name}</strong> asset has unapplied changes. What would you like to do with it?</p>
                <div class="inset flexrow">
                    <button class="nogrow danger" onclick={confirmDiscardAndClose}>
                        <Icon icon="material-symbols:close-rounded" aria-hidden="true" class="feather"/>
                        <span>Discard</span>
                    </button>
                    <div class="aSpacer"></div>
                    <button class="nogrow" onclick={cancelClose}>
                        <span>Cancel</span>
                    </button>
                    <div class="aSpacer"></div>
                    <button class="nogrow success" onclick={confirmApplyAndClose}>
                        <Icon icon="material-symbols:check" aria-hidden="true" class="feather"/>
                        <span>Apply</span>
                    </button>
                </div>
            </div>
        </div>
    {/if}
</div>

<!-- DnD import overlay — active whenever files are dragged over the editor window -->
<DndProcessor />

<style type="scss">
    /* ── Shell ──────────────────────────────────────────────────────────────── */
    .app-view {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--background, #1a1a2e);
        color: var(--text, #e0e0e0);
    }

    /* ── Flex utilities ─────────────────────────────────────────────────────── */
    .flexrow {
        display: flex;
        flex-flow: row nowrap;
        & > * { flex: 1 1 auto; }
    }

    .flexfix {
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .flexfix-header { flex-shrink: 0; padding: 0.5rem; }
    .flexfix-body   { flex: 1 1 auto; overflow: auto; min-height: 0; }

    .flexitem   { flex: 1 1 auto; }
    .nogrow     { flex: 0 0 auto !important; }
    .noshrink   { flex-shrink: 0 !important; }
    .relative   { position: relative; }

    .nm  { margin: 0; }
    .nmt { margin-top: 0; }
    .npb { padding-bottom: 0; }

    /* ── Nav bar ────────────────────────────────────────────────────────────── */
    nav.flexrow {
        flex-wrap: nowrap;
        border-bottom: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        flex-shrink: 0;
        align-items: stretch;
    }

    /* ── Tab nav ────────────────────────────────────────────────────────────── */
    .aNav.tabs {
        background: var(--background, #1a1a2e);
        border-top: 1px solid var(--border-bright, #333);
        border-left: 1px solid var(--border-bright, #333);
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: row;
        list-style: none;

        li {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            text-align: center;
            cursor: pointer;
            border-right: 1px solid var(--border-pale, #2a2a3e);
            border-bottom: 1px solid var(--border-bright, #333);
            flex: 1 1 auto;
            list-style: none;
            padding: 0.5rem 1rem;
            margin: 0;
            transition: all 0.15s ease;
            box-shadow: 0 0 transparent inset;
            user-select: none;
            white-space: nowrap;

            &:hover, &.active {
                color: var(--acttext, #7ec8e3);
                box-shadow: 0 -2px var(--accent1, #446adb) inset;
                svg { color: var(--accent1, #446adb); }
            }

            &:active {
                background: var(--acttext, #7ec8e3);
                color: var(--background, #1a1a2e);
            }

            :global(svg.feather) {
                width: 1rem;
                height: 1rem;
                fill: none;
                stroke: currentColor;
                stroke-width: 2;
                stroke-linecap: round;
                stroke-linejoin: round;
                flex-shrink: 0;
            }
        }

        &.nogrow { flex: 0 0 auto; }
    }

    .limitwidth {
        max-width: 5rem;
        min-width: 3rem;
        box-sizing: border-box;
    }

    .nbl { border-left: 0 !important; }

    /* ── Scrollable tab wrapper ──────────────────────────────────────────────── */
    .aTabsWrapper {
        background: var(--background-deeper, #111122);
        border-bottom: 1px solid var(--border-bright, #333);
        border-right: 1px solid var(--border-bright, #333);
        width: 0;
        flex: 1 1 1rem;
        position: relative;
        overflow: hidden;

        .aNav { 
            margin: 0; 
            padding: 0;
            
            border-radius: 0; 
            // border-left: 0; 
            // border-top: 0; 

            border-top: 1px solid var(--border-bright, #333);
            border-left: 1px solid var(--border-bright, #333);

            list-style: none;
        }

        /* Shadow overlays for scroll indication */
        &::before, &::after {
            position: absolute;
            content: '';
            background: radial-gradient(farthest-side at 50% 50%, rgba(0,0,0,0.35), transparent);
            background-repeat: no-repeat;
            width: 1rem;
            height: 100%;
            top: 0;
            background-size: 2rem 100%;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s ease;
            z-index: 1;
        }
        &::before {
            left: 0;
            background-position: -1rem 0;
        }
        &::after {
            right: 0;
            background-position: 0 0;
        }
        &.shadowleft::before  { opacity: 1; }
        &.shadowright::after  { opacity: 1; }
    }

    .xscroll {
        overflow-x: auto;
        overflow-y: hidden;
        height: 100%;
        scrollbar-width: none;
        &::-webkit-scrollbar { display: none; }

        li {
            margin: 0;
            padding: 0.5rem 1rem;

            border-right: 1px solid var(--border-pale, #2a2a3e);
            border-bottom: 1px solid var(--border-bright, #333);

            border-radius: 0 !important;
            // border-bottom: 0;
            // padding-right: 0.5rem;
            background: var(--background, #1a1a2e);
            white-space: nowrap;
            flex-shrink: 0;
        }

        .anActionableIcon {
            width: 1.25rem;
            height: 1.25rem;
            vertical-align: -4px;
            margin-left: 0.25rem;
            margin-right: 0;
            cursor: pointer;
        }
    }

    /* ── Tab close button ───────────────────────────────────────────────────── */
    .tab-close-btn {
        background: transparent;
        border: none;
        padding: 0;
        margin-left: 0.25rem;
        display: inline-flex;
        align-items: center;
        cursor: pointer;
        color: inherit;
        opacity: 0.5;
        line-height: 0;

        &:hover { opacity: 1; }

        /* Unsaved: show dot by default, X on tab hover */
        &.warning {
            color: var(--warning, #f5a623);

            .close-icon { display: none; }
        }
    }

    li:hover .tab-close-btn.warning {
        .close-icon { display: inline-block; }
    }

    .warning { color: var(--warning, #f5a623); }

    /* ── Global asset search ────────────────────────────────────────────────── */
    .search-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0 0.6rem;
        border-left: 1px solid var(--border-pale, #2a2a3e);
        border-bottom: 1px solid var(--border-bright, #333);

        :global(svg.feather.search-icon) {
            width: 0.9rem; height: 0.9rem;
            flex-shrink: 0;
            fill: none; stroke: var(--text-dim, #888);
            stroke-width: 2;
        }
    }

    .search-input {
        background: transparent;
        border: none;
        outline: none;
        color: var(--text, #e0e0e0);
        font-size: 0.8rem;
        width: 160px;
        padding: 0;

        &::placeholder { color: var(--text-dim, #888); }
        &::-webkit-search-cancel-button { display: none; }
        &:focus { width: 200px; }

        transition: width 0.15s ease;
    }

    .search-results {
        position: absolute;
        top: calc(100% + 2px);
        right: 0;
        min-width: 260px;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 6px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.5);
        z-index: 1000;
        overflow: hidden;

        .no-results {
            padding: 0.5rem 0.8rem;
            font-size: 0.8rem;
            color: var(--text-dim, #888);
            margin: 0;
        }
    }

    .search-result {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.35rem 0.8rem;
        cursor: pointer;
        color: var(--text, #e0e0e0);
        font-size: 0.82rem;
        user-select: none;

        &:hover, &.highlighted {
            background: var(--act, #1e2233);
            color: var(--acttext, #7ec8e3);
        }

        .result-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .result-type { font-size: 0.7rem; color: var(--text-dim, #888); white-space: nowrap; flex-shrink: 0; }

        :global(svg.feather) {
            width: 0.8rem; height: 0.8rem; flex-shrink: 0;
            fill: none; stroke: currentColor; stroke-width: 2;
        }
    }

    /* ── Body ───────────────────────────────────────────────────────────────── */
    .app-view-anIdeWrap {
        flex: 1 1 auto;
        overflow: hidden;
        display: flex;
        flex-flow: row nowrap;
        & > * { flex: 1 1 auto; }
    }

    /* ── Side panel ─────────────────────────────────────────────────────────── */
    .app-view-aSideviewBrowser {
        flex: 0 0 auto;
        height: 100%;
        overflow: auto;
        box-sizing: border-box;
        border-right: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        min-width: 150px;
    }

    /* ── Drag divider ───────────────────────────────────────────────────────── */
    .aVerticalDivider {
        flex: 0 0 4px;
        width: 4px;
        height: 100%;
        cursor: col-resize;
        background: var(--border-pale, #2a2a3e);
        transition: background 0.15s ease;

        &:hover { background: var(--accent1, #446adb); }
    }

    /* ── Main content ───────────────────────────────────────────────────────── */
    .aView {
        overflow: auto;
        background: var(--background-deeper, #111122);
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        bottom: 0;
    }

    /* ── Phase 4 placeholder ────────────────────────────────────────────────── */
    .phase4-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        font-size: 0.9rem;
        opacity: 0.3;
        pointer-events: none;
    }

    /* ── Dimmer (modal overlay) ─────────────────────────────────────────────── */
    .aDimmer {
        position: fixed;
        background-color: rgba(0, 0, 0, 0.65);
        left: 0; right: 0; top: 0; bottom: 0;
        width: 100%; height: 100%;
        z-index: 60;
        display: flex;
        flex-flow: column nowrap;
        align-items: center;
        justify-content: center;

        &.fixed { position: fixed; }
        &.pad   { padding: 1rem; }
    }

    .aDimmer-aCloseButton {
        position: absolute;
        right: 1rem;
        top: 1rem;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.3rem 0.5rem;
        cursor: pointer;

        :global(svg.feather) {
            width: 1rem; height: 1rem;
            fill: none; stroke: currentColor;
            stroke-width: 2;
        }
    }

    .aModal {
        max-height: 90%;
        overflow: auto;
        box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        position: relative;
    }

    .app-view-anAssetConfirmDialog {
        width: 45rem;
        max-width: 95vw;
    }

    .inset {
        background: var(--background-deeper, #111122);
        padding: 1rem;
        margin: 0 -1rem;
        border-top: 1px solid var(--border-pale, #2a2a3e);
    }

    .aStripedList {
        margin: 0.5rem 0;
        padding: 0;

        li {
            list-style: none;
            padding: 0.2em 0.8em;
            margin: 0;
            border-bottom: 1px solid var(--border-pale, #2a2a3e);

            &:last-child { border-bottom: 0; }
        }
    }

    .aSpacer { width: 1rem; height: 1rem; flex: 0 0 1rem; }

    /* ── Button base ────────────────────────────────────────────────────────── */
    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.3rem 0.6rem;
        font-size: 0.9rem;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        transition: all 0.15s ease;

        &:hover {
            background: var(--act, #1e2233);
            border-color: var(--acttext, #7ec8e3);
            color: var(--acttext, #7ec8e3);
        }

        &.inline {
            background: transparent;
            border-color: transparent;
        }

        &.success {
            background: var(--success, #27ae60);
            border-color: var(--success, #27ae60);
            color: #fff;
        }

        :global(svg.feather) {
            width: 1rem; height: 1rem;
            fill: none; stroke: currentColor;
            stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
        }
    }

    .toright { float: right !important; }

    h2 { font-size: 1rem; margin: 0 0 0.5rem; }
    h3 { font-size: 0.9rem; margin: 0; }

    .rotateccw {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(-360deg); }
    }

    /* ── Save error toast ───────────────────────────────────────────────────── */
    .save-error-toast {
        position: fixed;
        bottom: 1rem;
        left: 50%;
        transform: translateX(-50%);
        z-index: 200;
        background: var(--error-bg, #3a1a1a);
        border: 1px solid var(--error, #f44336);
        color: var(--error, #f44336);
        border-radius: 4px;
        padding: 0.5rem 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.85rem;
        max-width: 480px;

        :global(.feather) { width: 1rem; height: 1rem; flex-shrink: 0; }
        button {
            background: none;
            border: none;
            cursor: pointer;
            color: inherit;
            padding: 0;
            margin-left: 0.25rem;
            opacity: 0.7;
            &:hover { opacity: 1; }
        }
    }
</style>
