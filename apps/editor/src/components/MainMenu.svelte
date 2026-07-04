<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * MainMenu.svelte
     * Migrated from: src/riotTags/main-menu/main-menu.tag + main-menu-settings.tag
     */
    import { currentProject, closeProject, projectFilePath, openProjectFile, dirtyAssetUids } from '../stores/projectStore.js';
    import { electronAPI, isElectron } from '../lib/electron.js';
    import { signals } from '../stores/editorStore.js';
    import { get } from 'svelte/store';
    import ExportPanel from './ExportPanel.svelte';
    import ContextMenu from './ContextMenu.svelte';
    import type { MenuItem } from './ContextMenu.svelte';
    import {
        THEMES, CODE_FONTS,
        uiTheme, codeFontFamily, codeLigatures, codeDense,
        disableSounds, debuggerMode, forceProdDebug
    } from '../stores/themeStore.js';

    // ── Project actions ────────────────────────────────────────────────────────
    function saveProject() { signals.emit('saveProject'); }

    async function openProjectFolder() {
        if (!isElectron()) return;
        const fp = $projectFilePath;
        if (!fp) return;
        const dir = fp.replace(/[/\\][^/\\]+$/, '');
        await electronAPI().shell.openExternal(`file://${dir}`);
    }

    function closeCurrentProject() { closeProject(); }

    // ── External links ─────────────────────────────────────────────────────────
    function openLink(url: string) {
        if (isElectron()) electronAPI().shell.openExternal(url);
        else window.open(url, '_blank');
    }

    // ── Deploy ────────────────────────────────────────────────────────────────
    let exportOpen = $state(false);

    // ── Settings: theme submenu ───────────────────────────────────────────────
    let themeMenu = $state<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });

    function openThemeMenu(e: MouseEvent) {
        themeMenu = { open: true, x: e.clientX, y: e.clientY };
    }

    const themeItems: MenuItem[] = THEMES.map(t => ({
        label: t,
        get icon() { return $uiTheme === t ? 'feather:check' : undefined; },
        click: () => { $uiTheme = t; }
    }));

    // ── Settings: code font submenu ───────────────────────────────────────────
    let fontMenu = $state<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });

    function openFontMenu(e: MouseEvent) {
        fontMenu = { open: true, x: e.clientX, y: e.clientY };
    }

    function fontLabel(): string {
        const match = CODE_FONTS.find(f => f.value === $codeFontFamily);
        return match ? match.label : 'Custom';
    }

    const fontPresetItems: MenuItem[] = CODE_FONTS.map(f => ({
        label: f.label,
        get icon() { return $codeFontFamily === f.value ? 'feather:check' : undefined; },
        click: () => { $codeFontFamily = f.value; }
    }));

    const fontMenuItems: MenuItem[] = [
        ...fontPresetItems,
        { type: 'separator' },
        {
            label: 'Custom…',
            click: () => {
                const val = prompt('Enter font family (e.g. "JetBrains Mono", monospace):', $codeFontFamily);
                if (val !== null) $codeFontFamily = val.trim();
            }
        },
        { type: 'separator' },
        {
            get label() { return `Ligatures: ${$codeLigatures ? 'on' : 'off'}`; },
            get icon() { return $codeLigatures ? 'feather:check-square' : 'feather:square'; },
            click: () => { $codeLigatures = !$codeLigatures; }
        },
        {
            get label() { return `Dense code: ${$codeDense ? 'on' : 'off'}`; },
            get icon() { return $codeDense ? 'feather:check-square' : 'feather:square'; },
            click: () => { $codeDense = !$codeDense; }
        }
    ];

    // ── Settings: debugger layout label ──────────────────────────────────────
    const DEBUGGER_MODES = ['automatic', 'split', 'multiwindow'] as const;
    function cycleDebuggerMode() {
        const i = DEBUGGER_MODES.indexOf($debuggerMode);
        $debuggerMode = DEBUGGER_MODES[(i + 1) % DEBUGGER_MODES.length];
    }

    // ── Zoom ──────────────────────────────────────────────────────────────────
    function zoomIn()    { isElectron() && electronAPI().zoom.in(); }
    function zoomOut()   { isElectron() && electronAPI().zoom.out(); }
    function zoomReset() { isElectron() && electronAPI().zoom.reset(); }

    // ── Recent projects ───────────────────────────────────────────────────────
    function recentProjects(): { name: string; path: string }[] {
        const raw = (window.electronAPI.settings.getAll()['lastProjects'] as string) ?? '';
        return raw.split(';').filter(Boolean).slice(0, 5).map(p => ({
            path: p,
            name: p.match(/[/\\]([^/\\]+)\.json$/i)?.[1] ?? p,
        }));
    }

    // Re-derive list reactively whenever a project opens (projectFilePath changes)
    let recents = $derived.by(() => {
        void $projectFilePath; // track dependency
        return recentProjects();
    });

    async function openRecent(path: string) {
        const dirty = get(dirtyAssetUids);
        if (dirty.size > 0) {
            if (!isElectron()) return;
            const ok = await electronAPI().dialog.showConfirm({
                message: 'Unsaved changes',
                detail: 'Opening another project will discard unsaved changes. Continue?',
                confirmLabel: 'Open anyway',
                cancelLabel: 'Cancel',
            });
            if (!ok) return;
        }
        await openProjectFile(path);
    }

    // ── Troubleshooting ───────────────────────────────────────────────────────
    function toggleDevTools() {
        isElectron() && electronAPI().devtools.toggle();
    }

    async function copySystemInfo() {
        const lines = [
            `Nyx Studio`,
            `Platform: ${navigator.platform}`,
            `User agent: ${navigator.userAgent}`,
        ];
        if (isElectron()) {
            const ifaces = await electronAPI().system.networkInterfaces();
            if (ifaces.length) lines.push(`Network: ${ifaces.map(i => `${i.name} ${i.address}`).join(', ')}`);
        }
        await navigator.clipboard.writeText(lines.join('\n'));
    }
</script>

<!-- ══ Main Menu ══════════════════════════════════════════════════════════════ -->
<div class="main-menu aView pad">
    <div class="main-menu-aGrid">

        <!-- ── Project section ──────────────────────────────────────────────── -->
        <section class="main-menu-aDoubleSection">
            <h3>
                <Icon icon="feather:folder" class="feather"/>
                Project
            </h3>
            <div class="section-body">
                <button onclick={saveProject}>
                    <Icon icon="feather:save" class="feather"/>
                    Save project
                </button>
                <button onclick={openProjectFolder}>
                    <Icon icon="feather:external-link" class="feather"/>
                    Open in file explorer
                </button>
                <button class="danger" onclick={closeCurrentProject}>
                    <Icon icon="feather:log-out" class="feather"/>
                    Close project
                </button>
                {#if $currentProject}
                    <p class="meta-hint">
                        <span class="dim">Project:</span>
                        <strong>{$currentProject.name}</strong>
                    </p>
                {/if}
            </div>
        </section>

        <!-- ── Deploy section ───────────────────────────────────────────────── -->
        <section class="main-menu-aSection">
            <h3>
                <Icon icon="feather:package" class="feather"/>
                Deploy
            </h3>
            <div class="section-body">
                <button onclick={() => exportOpen = true}>
                    <Icon icon="feather:upload-cloud" class="feather"/>
                    Export game…
                </button>
            </div>
        </section>

        <!-- ── Recent Projects section ──────────────────────────────────────── -->
        <section class="main-menu-aDoubleSection">
            <h3>
                <Icon icon="feather:clock" class="feather"/>
                Recent Projects
            </h3>
            <div class="section-body">
                {#each recents as proj (proj.path)}
                    <button class="recent-item" onclick={() => openRecent(proj.path)} title={proj.path}>
                        <Icon icon="feather:file-text" class="feather"/>
                        <span class="recent-name">{proj.name}</span>
                        <span class="recent-path">{proj.path}</span>
                    </button>
                {:else}
                    <p class="dim" style="font-size:0.8rem; margin:0">No recent projects.</p>
                {/each}
            </div>
        </section>

        <!-- ── Meta / About section ─────────────────────────────────────────── -->
        <section class="main-menu-aQuadrupleSection">
            <h3>
                <Icon icon="feather:info" class="feather"/>
                About Nyx
            </h3>
            <div class="section-body links">
                <button class="inline" onclick={() => openLink('https://nyxjs.dev/')}>
                    <Icon icon="feather:globe" class="feather"/>
                    website
                </button>
                <button class="inline" onclick={() => openLink('https://docs.nyxjs.dev/')}>
                    <Icon icon="feather:book-open" class="feather"/>
                    Documentation
                </button>
                <button class="inline" onclick={() => openLink('https://discord.gg/nyxjs')}>
                    <Icon icon="feather:message-circle" class="feather"/>
                    Community Discord
                </button>
                <button class="inline" onclick={() => openLink('https://github.com/minititan-studio/nyx.js')}>
                    <Icon icon="feather:github" class="feather"/>
                    GitHub
                </button>
            </div>
        </section>

        <!-- ── Settings section ─────────────────────────────────────────────── -->
        <section class="main-menu-aDoubleSection">
            <h3>
                <Icon icon="feather:settings" class="feather"/>
                Settings
            </h3>
            <div class="section-body">
                <!-- Theme -->
                <button onclick={openThemeMenu}>
                    <Icon icon="feather:droplet" class="feather"/>
                    Theme: {$uiTheme}
                </button>
                <!-- Code font -->
                <button onclick={openFontMenu}>
                    <Icon icon="feather:type" class="feather"/>
                    Code font: {fontLabel()}
                </button>
                <!-- Toggles -->
                <button onclick={() => $disableSounds = !$disableSounds}>
                    <Icon icon={$disableSounds ? 'feather:volume-x' : 'feather:volume-2'} class="feather"/>
                    {$disableSounds ? 'Sounds: off' : 'Sounds: on'}
                </button>
                <button onclick={() => $forceProdDebug = !$forceProdDebug}>
                    <Icon icon={$forceProdDebug ? 'feather:check-square' : 'feather:square'} class="feather"/>
                    Force production for debug
                </button>
                <button onclick={cycleDebuggerMode}>
                    <Icon icon={$debuggerMode === 'split' ? 'feather:layout' : $debuggerMode === 'multiwindow' ? 'feather:copy' : 'feather:sparkles'} class="feather"/>
                    Debugger: {$debuggerMode}
                </button>
                <!-- Zoom -->
                <div class="button-row">
                    <button class="icon-btn" onclick={zoomOut} title="Zoom out">
                        <Icon icon="feather:zoom-out" class="feather"/>
                    </button>
                    <button class="flex-1" onclick={zoomReset}>100%</button>
                    <button class="icon-btn" onclick={zoomIn} title="Zoom in">
                        <Icon icon="feather:zoom-in" class="feather"/>
                    </button>
                </div>
            </div>
        </section>

        <!-- ── Troubleshooting section ───────────────────────────────────────── -->
        <section class="main-menu-aDoubleSection">
            <h3>
                <Icon icon="feather:tool" class="feather"/>
                Troubleshooting
            </h3>
            <div class="section-body">
                <button onclick={() => window.location.reload()}>
                    <Icon icon="feather:refresh-ccw" class="feather"/>
                    Reload editor
                </button>
                {#if isElectron()}
                    <button onclick={toggleDevTools}>
                        <Icon icon="feather:terminal" class="feather"/>
                        Toggle DevTools
                    </button>
                {/if}
                <button onclick={copySystemInfo}>
                    <Icon icon="feather:clipboard" class="feather"/>
                    Copy system info
                </button>
                <button class="inline" onclick={() => openLink('https://github.com/minititan-studio/nyx.js/issues/new/choose')}>
                    <Icon icon="feather:alert-circle" class="feather"/>
                    Report a bug
                </button>
            </div>
        </section>

    </div>
</div>

<!-- ── Export panel modal ─────────────────────────────────────────────────── -->
<ExportPanel open={exportOpen} onclose={() => exportOpen = false} />

<!-- ── Theme context menu ─────────────────────────────────────────────────── -->
{#if themeMenu.open}
    <ContextMenu
        items={themeItems}
        x={themeMenu.x}
        y={themeMenu.y}
        onclose={() => themeMenu = { open: false, x: 0, y: 0 }}
    />
{/if}

<!-- ── Code font context menu ─────────────────────────────────────────────── -->
{#if fontMenu.open}
    <ContextMenu
        items={fontMenuItems}
        x={fontMenu.x}
        y={fontMenu.y}
        onclose={() => fontMenu = { open: false, x: 0, y: 0 }}
    />
{/if}


<style>
    .main-menu {
        width: 100%; height: 100%;
        overflow: auto;
        background: var(--background-deeper, #111122);
        color: var(--text, #e0e0e0);
    }

    .pad { padding: 1.5rem; }

    .main-menu-aGrid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 1rem;
        max-width: 900px;
    }

    section {
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 6px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;

        h3 {
            font-size: 0.85rem;
            font-weight: 600;
            margin: 0 0 0.5rem;
            color: var(--acttext, #7ec8e3);
            display: flex;
            align-items: center;
            gap: 0.4rem;
            border-bottom: 1px solid var(--border-pale, #2a2a3e);
            padding-bottom: 0.4rem;

            :global(svg.feather) {
                width: 0.9rem; height: 0.9rem;
                fill: none; stroke: currentColor;
                stroke-width: 2; flex-shrink: 0;
            }
        }
    }

    .main-menu-aDoubleSection  { grid-column: span 2; }
    .main-menu-aQuadrupleSection { grid-column: span 2; }

    .section-body {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }

    .section-body.links { flex-direction: column; }

    .meta-hint {
        font-size: 0.8rem;
        color: var(--text-dim, #888);
        margin: 0.3rem 0 0;
    }

    .dim { color: var(--text-dim, #888); }

    .recent-item {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.1rem;
        padding: 0.3rem 0.6rem;
        .recent-name { font-weight: 600; font-size: 0.82rem; }
        .recent-path { font-size: 0.68rem; color: var(--text-dim, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        :global(svg.feather) { align-self: flex-start; margin-top: 0.1rem; }
    }

    .button-row {
        display: flex;
        gap: 0.3rem;
        align-items: center;
        .flex-1 { flex: 1; justify-content: center; }
        .icon-btn { padding: 0.3rem 0.5rem; }
    }

    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.3rem 0.6rem;
        font-size: 0.82rem;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        transition: all 0.12s ease;
        text-align: left;

        &:hover {
            background: var(--act, #1e2233);
            border-color: var(--acttext, #7ec8e3);
            color: var(--acttext, #7ec8e3);
        }

        &.inline {
            background: transparent;
            border-color: transparent;
            padding-left: 0;
        }

        &.danger {
            border-color: var(--danger, #e74c3c);
            color: var(--danger, #e74c3c);
            &:hover { background: var(--danger, #e74c3c); color: #fff; }
        }

        :global(svg.feather) {
            width: 0.85rem; height: 0.85rem;
            fill: none; stroke: currentColor;
            stroke-width: 2;
        }
    }
</style>
