<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * ProjectSelector.svelte
     * Migrated from: project-selector.tag (ct.js legacy)
     *
     * Shows: list of recent projects, create new project form,
     * bundled examples, bundled templates.
     * Displayed when no project is open (App.svelte root condition).
     */
    import { onMount } from 'svelte';
    import { openProjectFile, createProjectFile } from '../stores/projectStore.js';
    import { electronAPI, isElectron, localPathToUrl } from '../lib/electron.js';

    type Tab = 'projects' | 'create' | 'examples' | 'templates';
    type Language = 'typescript';

    // ── State ────────────────────────────────────────────────────────────────
    let tab = $state<Tab>('projects');

    // Recent projects list — from userData editor-settings.json (semicolon-separated)
    let latestProjects = $state<string[]>([]);

    // Bundled project lists (resolved via Electron IPC — placeholder until Phase 6)
    let exampleProjects = $state<string[]>([]);
    let templateProjects = $state<string[]>([]);

    // New project form
    let projectName = $state('');
    let projectLanguage = $state<Language>('typescript');
    let savePath = $state('');

    // Update notification (itch.io version check)
    let newVersion = $state<string | null>(null);

    // ── Helpers ───────────────────────────────────────────────────────────────

    function getProjectName(projectPath: string): string {
        const parts = projectPath.replace(/\\/g, '/').split('/');
        const file  = parts[parts.length - 1] ?? '';
        return file.replace(/\.[^.]+$/, ''); // strip any extension
    }

    function getProjectThumbnail(projectPath: string): string {
        const dir = projectPath.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        return localPathToUrl(dir + '/img/splash.png');
    }

    function openExternal(url: string) {
        electronAPI().shell.openExternal(url);
    }

    // ── Recent projects ───────────────────────────────────────────────────────

    async function loadRecentProjects() {
        const raw = (window.electronAPI.settings.getAll()['lastProjects'] as string) ?? '';
        if (!raw) {
            latestProjects = [];
            return;
        }
        const paths = raw.split(';').filter(Boolean);
        // Validate which paths still exist on disk (via IPC)
        if (isElectron()) {
            try {
                latestProjects = await electronAPI().project.validatePaths(paths);
                void window.electronAPI.settings.set('lastProjects', latestProjects.join(';'));
            } catch {
                latestProjects = paths;
            }
        } else {
            latestProjects = paths;
        }
    }

    function forgetProject(projectPath: string) {
        latestProjects = latestProjects.filter(p => p !== projectPath);
        void window.electronAPI.settings.set('lastProjects', latestProjects.join(';'));
    }

    async function cloneProject(projectPath: string) {
        const result = await electronAPI().dialog.showSaveDialog({
            defaultPath: savePath || '',
            buttonLabel: 'Save project here',
            filters: [{ name: 'Nyx Project', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) return;
        let dest = result.filePath;
        if (!dest.endsWith('.json')) dest += '.json';
        // File copy deferred to Phase 6 (fs access via IPC)
        console.warn('[ProjectSelector] clone deferred — fs IPC not yet wired:', projectPath, '->', dest);
    }

    // ── Open project ──────────────────────────────────────────────────────────

    let openError = $state<string | null>(null);

    async function openProjectFromPath(projectPath: string) {
        openError = null;
        try {
            await openProjectFile(projectPath);
            // openProjectFile updates latestProjects in userData settings; refresh list
            const _raw = (window.electronAPI.settings.getAll()['lastProjects'] as string) ?? '';
            latestProjects = _raw.split(';').filter(Boolean);
        } catch (err) {
            openError = `Could not open project: ${err instanceof Error ? err.message : String(err)}`;
            console.error('[ProjectSelector] open failed:', err);
        }
    }

    async function browseForProject() {
        const result = await electronAPI().dialog.showOpenDialog({
            title: 'Open Nyx Project',
            buttonLabel: 'Open',
            filters: [{ name: 'Nyx Project', extensions: ['json'] }],
            properties: ['openFile']
        });
        if (result.canceled || !result.filePaths.length) return;
        openProjectFromPath(result.filePaths[0]!);
    }

    // ── Create project ────────────────────────────────────────────────────────

    function setProjectName(e: Event) {
        const input = e.target as HTMLInputElement;
        // Only allow alphanumeric and underscore
        projectName = input.value.replace(/[^a-zA-Z_0-9]/g, '');
        input.value = projectName;
    }

    async function chooseProjectFolder() {
        const result = await electronAPI().dialog.showOpenDialog({
            title: 'Select project folder',
            buttonLabel: 'Save project here',
            properties: ['openDirectory']
        });
        if (result.canceled || !result.filePaths.length) return;
        savePath = result.filePaths[0]!;
    }

    let createError = $state<string | null>(null);
    let creating    = $state(false);

    async function createProject() {
        if (!projectName.trim() || /[^a-zA-Z_0-9]/.test(projectName)) {
            createError = 'Project name must only contain letters, numbers, and underscores.';
            return;
        }
        createError = null;
        creating    = true;
        try {
            const baseDir    = savePath || '.';
            const targetPath = `${baseDir}/${projectName}/${projectName}.json`;
            await createProjectFile(projectName, targetPath);
        } catch (err) {
            createError = `Could not create project: ${err instanceof Error ? err.message : String(err)}`;
            console.error('[ProjectSelector] create failed:', err);
        } finally {
            creating = false;
        }
    }

    // ── Update check ──────────────────────────────────────────────────────────

    async function checkForUpdates() {
        const ONE_HOUR = 1000 * 60 * 60;
        const _us = window.electronAPI.settings.getAll();
        const lastCheck = (_us['lastUpdateCheck'] as string) ?? null;
        const lastVersion = (_us['lastUpdateCheckVersion'] as string) ?? null;
        const currentVersion = '0.0.0-nyx'; // Phase 6 will read from package.json

        const needsCheck = !lastCheck || (Date.now() - Number(lastCheck)) > ONE_HOUR;
        if (!needsCheck && lastVersion && lastVersion !== currentVersion) {
            newVersion = lastVersion;
            return;
        }
        if (!needsCheck) return;

        try {
            const platform = electronAPI().platform === 'win32' ? 'win64'
                : electronAPI().platform === 'linux' ? 'linux64'
                : 'osx64';
            const resp = await fetch(
                `https://itch.io/api/1/x/wharf/latest?target=comigo/ct&channel_name=${platform}`
            );
            const json = await resp.json() as { latest?: string; errors?: string[] };
            if (!json.errors && json.latest) {
                void window.electronAPI.settings.set('lastUpdateCheck', String(Date.now()));
                void window.electronAPI.settings.set('lastUpdateCheckVersion', json.latest);
                if (json.latest !== currentVersion) {
                    newVersion = json.latest;
                }
            }
        } catch {
            // Non-fatal — no network or itch.io unreachable
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    onMount(() => {
        loadRecentProjects();
        // checkForUpdates();
    });
</script>

<div class="project-selector">
    <!-- Top bar: language toggle (deferred to Phase 5 i18n) -->
    <div class="project-selector-topbar">
        <h1 class="project-selector-title">Nyx Studio</h1>
    </div>

    <div class="flexrow project-selector-aMainSection">
        <!-- Left panel: tabs + tab body -->
        <div class="aPanel flexfix nogrow project-selector-leftPanel">
            <ul class="aNav tabs flexfix-header nb" role="tablist">
                <li class="nbl" role="tab" tabindex="0"
                    class:active={tab === 'projects'}
                    onclick={() => (tab = 'projects')}
                    onkeydown={(e) => e.key === 'Enter' && (tab = 'projects')}>
                    <Icon icon="feather:folder" aria-hidden="true" class="feather"/>
                    <span>Latest</span>
                </li>
                <li role="tab" tabindex="0"
                    class:active={tab === 'create'}
                    onclick={() => (tab = 'create')}
                    onkeydown={(e) => e.key === 'Enter' && (tab = 'create')}>
                    <Icon icon="feather:plus" aria-hidden="true" class="feather"/>
                    <span>New Project</span>
                </li>
                <li role="tab" tabindex="0"
                    class:active={tab === 'examples'}
                    onclick={() => (tab = 'examples')}
                    onkeydown={(e) => e.key === 'Enter' && (tab = 'examples')}>
                    <Icon icon="feather:book-open" aria-hidden="true" class="feather"/>
                    <span>Examples</span>
                </li>
                <li class="nbr" role="tab" tabindex="0"
                    class:active={tab === 'templates'}
                    onclick={() => (tab = 'templates')}
                    onkeydown={(e) => e.key === 'Enter' && (tab = 'templates')}>
                    <Icon icon="feather:layout" aria-hidden="true" class="feather"/>
                    <span>Templates</span>
                </li>
            </ul>

            <!-- Tab: Latest Projects -->
            {#if tab === 'projects'}
                <div class="flexfix-body pad">
                    <div class="flexrow">
                        <h2 class="nmt">Latest Projects</h2>
                        <button class="inline nml nmr nogrow"
                                onclick={browseForProject}>
                            <Icon icon="feather:folder" aria-hidden="true" class="feather"/>
                            <span>Browse…</span>
                        </button>
                    </div>

                    {#if openError}
                        <p class="error-note">{openError}</p>
                    {/if}

                    {#if latestProjects.length}
                        <ul class="Cards largeicons nmb">
                            {#each latestProjects as project (project)}
                                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                                <li class="aCard"
                                    tabindex="0"
                                    onclick={() => openProjectFromPath(project)}
                                    onkeydown={(e) => e.key === 'Enter' && openProjectFromPath(project)}
                                    title={project}>
                                    <div class="aCard-aThumbnail">
                                        <img src={getProjectThumbnail(project)}
                                             alt=""
                                             onerror={(e) => {
                                                 (e.target as HTMLImageElement).src =
                                                     'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
                                             }} />
                                    </div>
                                    <div class="aCard-Properties">
                                        <span>{getProjectName(project)}</span>
                                    </div>
                                    <div class="aCard-Actions">
                                        <button class="tiny forcebackground"
                                                title="Clone project"
                                                onclick={(e) => { e.stopPropagation(); cloneProject(project); }}>
                                            <Icon icon="feather:copy" aria-hidden="true" class="feather"/>
                                        </button>
                                        <button class="tiny forcebackground"
                                                title="Remove from list"
                                                onclick={(e) => { e.stopPropagation(); forgetProject(project); }}>
                                            <Icon icon="feather:x" aria-hidden="true" class="feather"/>
                                        </button>
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <div class="center pad project-selector-emptyState">
                            <p>No recent projects.</p>
                            <p>Create a new project or browse for an existing one.</p>
                        </div>
                    {/if}
                </div>
            {/if}

            <!-- Tab: New Project -->
            {#if tab === 'create'}
                <div class="flexfix-body pad">
                    <div id="theNewProjectField">
                        <h2 class="nmt">New Project</h2>

                        <div class="theNewProjectField-aLabel">
                            <b>Project name</b>
                        </div>
                        <div class="theNewProjectField-aValue">
                            <input
                                type="text"
                                placeholder="MyGame"
                                pattern={"[a-zA-Z_0-9]{1,}"}
                                oninput={setProjectName}
                                value={projectName}
                                maxlength={64}
                            />
                        </div>

                        <div class="theNewProjectField-aLabel">
                            <b>Save folder</b>
                        </div>
                        <div class="theNewProjectField-aValue flexrow">
                            <button class="inline nogrow"
                                    onclick={chooseProjectFolder}>
                                <Icon icon="feather:folder" aria-hidden="true" class="feather"/>
                                <span>Choose…</span>
                            </button>
                            <div class="aSpacer nogrow"></div>
                            <span class="crop small">
                                {savePath
                                    ? savePath + '/' + (projectName || '…')
                                    : '(choose a folder)'}
                            </span>
                        </div>

                        {#if createError}
                            <p class="error-note">{createError}</p>
                        {/if}

                        <button class="big theNewProjectField-aButton"
                                disabled={creating}
                                onclick={createProject}>
                            <Icon icon={`feather:${creating ? 'loader' : 'plus'}`} aria-hidden="true" class="feather"/>
                            <span>{creating ? 'Creating…' : 'Create'}</span>
                        </button>
                    </div>
                </div>
            {/if}

            <!-- Tab: Examples -->
            {#if tab === 'examples'}
                <div class="flexfix-body pad">
                    <div class="flexrow">
                        <h2 class="nmt">Examples</h2>
                        <button class="inline nml nmr nogrow"
                                onclick={browseForProject}>
                            <Icon icon="feather:folder" aria-hidden="true" class="feather"/>
                            <span>Browse…</span>
                        </button>
                    </div>
                    {#if exampleProjects.length}
                        <ul class="Cards largeicons nmb">
                            {#each exampleProjects as project (project)}
                                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                                <li class="aCard"
                                    tabindex="0"
                                    onclick={() => openProjectFromPath(project)}
                                    onkeydown={(e) => e.key === 'Enter' && openProjectFromPath(project)}
                                    title={project}>
                                    <div class="aCard-aThumbnail">
                                        <img src={getProjectThumbnail(project)} alt="" />
                                    </div>
                                    <div class="aCard-Properties">
                                        <span>{getProjectName(project)}</span>
                                    </div>
                                    <div class="aCard-Actions">
                                        <button class="tiny"
                                                title="Clone example"
                                                onclick={(e) => { e.stopPropagation(); cloneProject(project); }}>
                                            <Icon icon="feather:copy" aria-hidden="true" class="feather"/>
                                        </button>
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <div class="center pad project-selector-emptyState">
                            <p>No bundled examples found.</p>
                        </div>
                    {/if}
                </div>
            {/if}

            <!-- Tab: Templates -->
            {#if tab === 'templates'}
                <div class="flexfix-body pad">
                    <h2 class="nmt">Templates</h2>
                    <p class="nmt">Start from a pre-built template. A copy will be created.</p>
                    {#if templateProjects.length}
                        <ul class="Cards largeicons nmb">
                            {#each templateProjects as project (project)}
                                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                                <li class="aCard"
                                    tabindex="0"
                                    onclick={() => cloneProject(project)}
                                    onkeydown={(e) => e.key === 'Enter' && cloneProject(project)}
                                    title={project}>
                                    <div class="aCard-aThumbnail">
                                        <img src={getProjectThumbnail(project)} alt="" />
                                    </div>
                                    <div class="aCard-Properties">
                                        <span>{getProjectName(project)}</span>
                                    </div>
                                    <div class="aCard-Actions">
                                        <button class="tiny"
                                                title="Use template"
                                                onclick={(e) => { e.stopPropagation(); cloneProject(project); }}>
                                            <Icon icon="feather:copy" aria-hidden="true" class="feather"/>
                                        </button>
                                    </div>
                                </li>
                            {/each}
                        </ul>
                    {:else}
                        <div class="center pad project-selector-emptyState">
                            <p>No bundled templates found.</p>
                        </div>
                    {/if}
                </div>
            {/if}
        </div><!-- /left panel -->

        <!-- Right aside: branding + links -->
        <aside class="flexcol project-selector-aside">
            <div class="project-selector-logo">
                <svg viewBox="0 0 100 100" class="anIllustration wide" aria-label="Nyx Studio logo">
                    <text y="60" x="50" text-anchor="middle" font-size="28" font-weight="700"
                          fill="currentColor">Nyx</text>
                    <text y="80" x="50" text-anchor="middle" font-size="12"
                          fill="currentColor" opacity="0.6">Studio</text>
                </svg>
            </div>

            <div class="center">
                <small>v0.1.0-nyx (dev)</small>
                {#if newVersion}
                    <div class="project-selector-updateBadge">
                        <span>Update available: {newVersion}</span>
                    </div>
                {/if}
            </div>

            <div class="aSpacer"></div>

            <div class="center project-selector-SocialLinks">
                <!-- eslint-disable-next-line no-script-url -->
                <button class="inline" title="GitHub"
                        onclick={() => openExternal('https://github.com/ct-js/ct-js')}>
                    <Icon icon="feather:github" aria-hidden="true" class="feather"/>
                </button>
                <button class="inline" title="Discord"
                        onclick={() => openExternal('https://discord.gg/yuvuDW5')}>
                    <Icon icon="feather:message-circle" aria-hidden="true" class="feather"/>
                </button>
            </div>
        </aside>
    </div><!-- /flexrow -->
</div>

<style>
    /* ── Layout shell ───────────────────────────────────────────────────────── */
    .project-selector {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--background, #1a1a2e);
        color: var(--text, #e0e0e0);
        box-sizing: border-box;
    }

    .project-selector-topbar {
        padding: 0.5rem 1rem;
        border-bottom: 1px solid var(--border-bright, #333);
        flex-shrink: 0;
    }

    .project-selector-title {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        opacity: 0.8;
    }

    .project-selector-aMainSection {
        flex: 1 1 auto;
        overflow: hidden;
        display: flex;
        flex-flow: row nowrap;

        & > * {
            flex: 1 1 auto;
        }
    }

    /* ── Left panel ─────────────────────────────────────────────────────────── */
    .project-selector-leftPanel {
        min-width: 0;
        max-width: 680px;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-right: 1px solid var(--border-pale, #2a2a3e);
    }

    /* ── Flex utilities (scoped) ────────────────────────────────────────────── */
    .flexrow {
        display: flex;
        flex-flow: row nowrap;
        & > * { flex: 1 1 auto; }
    }

    .flexcol {
        display: flex;
        flex-direction: column;
    }

    .flexfix {
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .flexfix-header {
        flex-shrink: 0;
    }

    .flexfix-body {
        flex: 1 1 auto;
        overflow: auto;
        min-height: 0;
    }

    .nogrow { flex: 0 0 auto !important; }
    .pad { padding: 1rem; }
    .nmt { margin-top: 0; }
.nmb { margin-bottom: 0; }
    .nml { margin-left: 0; }
    .nmr { margin-right: 0; }
    .nb { border: 0 !important; }
    .nbl { border-left: 0 !important; }
    .nbr { border-right: 0 !important; }
    .center { text-align: center; }
    .error-note { color: var(--error, #e74c3c); font-size: 0.82rem; margin: 0.4rem 0; padding: 0.3rem 0.5rem; background: rgba(231,76,60,0.1); border-radius: 3px; border-left: 3px solid var(--error, #e74c3c); }
    .crop {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: inline-block;
        vertical-align: text-bottom;
        max-width: 100%;
    }
    .small { font-size: 0.85em; }
    .wide { width: 100%; }

    /* ── Tab navigation ─────────────────────────────────────────────────────── */
    .aNav.tabs {
        background: var(--background, #1a1a2e);
        border-radius: 4px 4px 0 0;
        border-top: 1px solid var(--border-bright, #333);
        border-left: 1px solid var(--border-bright, #333);
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: row;
        list-style: none;

        li {
            text-align: center;
            cursor: pointer;
            border-right: 1px solid var(--border-pale, #2a2a3e);
            border-bottom: 1px solid var(--border-bright, #333);
            flex: 1 1 auto;
            padding: 0.4rem 0.75rem;
            margin: 0;
            transition: all 0.15s ease;
            box-shadow: 0 0 transparent inset;
            display: flex;
            align-items: center;
            gap: 0.4rem;
            user-select: none;

            &:hover, &.active {
                color: var(--acttext, #7ec8e3);
                box-shadow: 0 -2px var(--accent1, #446adb) inset;

                svg { color: var(--accent1, #446adb); }
            }

            &:active {
                background: var(--acttext, #7ec8e3);
                color: var(--background, #1a1a2e);
                box-shadow: 0 -2px var(--acttext, #7ec8e3) inset;
            }

            :global(svg.feather) {
                width: 1rem;
                height: 1rem;
                flex-shrink: 0;
            }
        }

        &.nb { border: 0; }
        &.nb li { border-bottom: 0; }
    }

    /* ── Panel ──────────────────────────────────────────────────────────────── */
    .aPanel {
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        box-sizing: border-box;
        position: relative;
    }

    /* ── Cards grid ─────────────────────────────────────────────────────────── */
    .Cards {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15em, 1fr));
        gap: 0.3em;

        &.largeicons {
            li {
                text-align: center;
                position: relative;
                flex-flow: column nowrap;
            }

            .aCard-aThumbnail {
                max-width: 100%;
                width: unset;
                margin-right: 0;

                img {
                    width: unset;
                    height: unset;
                    max-width: 100%;
                    max-height: 10rem;
                    margin: 0;
                }
            }

            .aCard-Properties {
                flex: 0 0 auto;
                margin: 0.5rem 0;
            }
        }
    }

    .aCard {
        background: var(--background, #1a1a2e);
        padding: 0.5rem 1rem;
        gap: 0.5rem;
        margin: 0;
        box-sizing: border-box;
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 4px;
        vertical-align: top;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        flex-flow: column nowrap;
        align-items: center;
        justify-content: center;

    }

    .aCard:hover {
        border-color: var(--acttext, #7ec8e3);
    }

    .aCard-Properties {
        flex: 1 1 auto;
        overflow: hidden;
        width: 100%;

        span {
            font-family: monospace;
            width: 100%;
            display: inline-block;
            vertical-align: middle;
            text-overflow: ellipsis;
            white-space: nowrap;
            overflow: hidden;
            line-height: 1.5em;
        }
    }

    .aCard-aThumbnail {
        width: 4rem;
        flex: 0 0 auto;
        margin-right: 0;
        margin-bottom: 0.25rem;
        line-height: 0;

        img {
            width: 4rem;
            height: 4rem;
            max-width: 4rem;
            object-fit: contain;
            border-radius: 4px;
            pointer-events: none;
        }
    }

    .aCard-Actions {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        opacity: 0;
        transition: opacity 0.15s ease;
        display: flex;
        gap: 0.25rem;

        .aCard:hover & {
            opacity: 1;
        }
    }

    /* ── Spacer ─────────────────────────────────────────────────────────────── */
    .aSpacer {
        width: 1rem;
        height: 1rem;
    }

    /* ── Empty state ────────────────────────────────────────────────────────── */
    .project-selector-emptyState {
        color: var(--text, #e0e0e0);
        opacity: 0.5;
        padding: 2rem 1rem;
    }

    /* ── New project form ───────────────────────────────────────────────────── */
    #theNewProjectField {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        max-width: 480px;
    }

    .theNewProjectField-aLabel {
        margin-top: 0.75rem;
    }

    .theNewProjectField-aValue {
        margin-bottom: 0.25rem;

        input {
            width: 100%;
            box-sizing: border-box;
            padding: 0.4rem 0.6rem;
            background: var(--background-deeper, #111122);
            border: 1px solid var(--border-bright, #333);
            border-radius: 4px;
            color: var(--text, #e0e0e0);
            font-size: 1rem;

            &:focus {
                outline: none;
                border-color: var(--accent1, #446adb);
            }
        }
    }

    .theNewProjectField-aButton {
        margin-top: 1rem;
        align-self: flex-start;
    }

    /* ── Right aside ────────────────────────────────────────────────────────── */
    .project-selector-aside {
        /* max-width: 220px; */
        /* flex: 0 0 220px; */
        padding: 1rem;

        align-items: center;
        gap: 0.5rem;
        border-left: 1px solid var(--border-pale, #2a2a3e);
        overflow: hidden;
    }

    .project-selector-logo {
        width: 100%;
        max-width: 440px;
        margin-bottom: 0.5rem;
        color: var(--accent1, #446adb);
    }

    .anIllustration {
        color: var(--accent1, #446adb);
    }

    .project-selector-updateBadge {
        margin-top: 0.25rem;
        padding: 0.2rem 0.5rem;
        background: var(--warning, #f5a623);
        color: #fff;
        border-radius: 4px;
        font-size: 0.8em;
    }

    .project-selector-SocialLinks {
        display: flex;
        gap: 0.5rem;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: auto;
    }

    /* ── Button base (minimal — full theme in Phase 5 ui-kit) ──────────────── */
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
            background: var(--act, #223);
            border-color: var(--acttext, #7ec8e3);
            color: var(--acttext, #7ec8e3);
        }

        &.big {
            padding: 0.5rem 1.25rem;
            font-size: 1rem;
        }

        &.tiny {
            padding: 0.15rem 0.3rem;
            font-size: 0.75rem;
        }

        &.inline {
            background: transparent;
            border-color: transparent;

            &:hover {
                border-color: var(--acttext, #7ec8e3);
            }
        }

        &.forcebackground {
            background: var(--background, #1a1a2e);
        }

        :global(svg.feather) {
            width: 1rem;
            height: 1rem;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
    }

    h2 {
        font-size: 1rem;
        margin: 0 0 0.5rem;
    }
</style>
