<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * ExportPanel.svelte
     * Migrated from: src/riotTags/main-menu/main-menu-deploy.tag
     *                src/riotTags/main-menu/export-desktop-panel.tag
     *
     * Modal panel for exporting the current project as a web folder or desktop
     * application. Preserves the two-tab layout from legacy deploy UI.
     */
    import ModalWindow from '@nyx/ui-kit/ModalWindow.svelte';
    import { currentProject, projectFilePath } from '../stores/projectStore.js';
    import { get } from 'svelte/store';
    import { electronAPI, isElectron } from '../lib/electron.js';

    interface Props {
        open: boolean;
        onclose: () => void;
    }

    let { open, onclose }: Props = $props();

    // ── Tab state ──────────────────────────────────────────────────────────────
    type Tab = 'web' | 'desktop';
    let activeTab = $state<Tab>('web');

    // ── Shared state ───────────────────────────────────────────────────────────
    let outDir = $state<string>('');
    let working = $state(false);

    // Status: null = idle, string = message (success or error)
    let statusMessage = $state<string | null>(null);
    let statusIsError = $state(false);

    // ── Desktop-tab extra state ────────────────────────────────────────────────
    let platformWindows = $state(true);
    let platformMac     = $state(true);
    let platformLinux   = $state(true);

    // Log lines for the desktop export (mirrors legacy pre.selectable log)
    let logLines = $state<string[]>([]);

    // ── Derived readiness checks ───────────────────────────────────────────────
    /** Title required for desktop export — mirrors legacy validation message. */
    const projectTitle = $derived(
        $currentProject?.settings?.authoring?.title ?? ''
    );
    const appId = $derived(
        $currentProject?.settings?.authoring?.appId ?? ''
    );

    // ── Helper: pick output folder ─────────────────────────────────────────────
    async function pickOutDir(): Promise<void> {
        if (!isElectron()) return;
        const { canceled, filePaths } = await electronAPI().dialog.showOpenDialog({
            title:       'Choose export output folder',
            buttonLabel: 'Export here',
            properties:  ['openDirectory', 'createDirectory'],
        });
        if (!canceled && filePaths?.[0]) {
            outDir = filePaths[0];
            // Reset status when the user picks a new folder
            statusMessage = null;
        }
    }

    // ── Web export ─────────────────────────────────────────────────────────────
    async function exportWeb(): Promise<void> {
        if (!isElectron() || working) return;
        const proj = get(currentProject);
        const fp   = get(projectFilePath);
        if (!proj || !fp) return;
        if (!outDir) {
            statusMessage = 'Please choose an output folder first.';
            statusIsError = true;
            return;
        }

        working = true;
        statusMessage = null;
        try {
            const plain = JSON.parse(JSON.stringify(proj)) as typeof proj;
            await electronAPI().gameServer.exportTo(plain, fp, outDir);
            statusMessage = `Exported successfully to:\n${outDir}`;
            statusIsError = false;
            // Reveal the folder in the OS file explorer
            await electronAPI().shell.showItemInFolder(outDir);
        } catch (e) {
            statusMessage = String((e as Error)?.message ?? e);
            statusIsError = true;
            console.error('[ExportPanel] web export failed:', e);
        } finally {
            working = false;
        }
    }

    // ── Desktop export ─────────────────────────────────────────────────────────
    // Two-step flow:
    //   Step 1 — exportTo: produce the HTML5 web build in a temp subfolder
    //   Step 2 — exportDesktop: wrap that web build into platform installers
    //            via electron-builder (packager.ts in the main process)
    async function exportDesktop(): Promise<void> {
        if (!isElectron() || working) return;
        const proj = get(currentProject);
        const fp   = get(projectFilePath);
        if (!proj || !fp) return;
        if (!outDir) {
            statusMessage = 'Please choose an output folder first.';
            statusIsError = true;
            return;
        }
        if (!platformWindows && !platformMac && !platformLinux) {
            statusMessage = 'Select at least one target platform.';
            statusIsError = true;
            return;
        }

        const selectedPlatforms: Array<'win' | 'mac' | 'linux'> = [];
        if (platformWindows) selectedPlatforms.push('win');
        if (platformMac)     selectedPlatforms.push('mac');
        if (platformLinux)   selectedPlatforms.push('linux');

        // Derive metadata from the project
        const appName   = proj.settings?.authoring?.title   ?? proj.name ?? 'Game';
        const appId     = proj.settings?.authoring?.appId   ?? `com.nyxgame.${proj.name ?? 'game'}`;
        const verParts  = proj.settings?.authoring?.version ?? [0, 1, 0];
        const version   = verParts.join('.');

        // Step 1 — export the HTML5 web build into <outDir>/web-build/
        const gameDir = `${outDir}/web-build`;

        working = true;
        statusMessage = null;
        logLines = ['Step 1/2 — Exporting HTML5 web build…'];

        // Subscribe to progress events from the main process
        const api = electronAPI();
        const disposeProgress = api.gameServer.onExportProgress((msg: string) => {
            logLines = [...logLines, msg];
        });

        try {
            const plain = JSON.parse(JSON.stringify(proj)) as typeof proj;

            await api.gameServer.exportTo(plain, fp, gameDir);
            logLines = [...logLines, 'Step 1/2 — Web build complete.'];

            // Step 2 — wrap with electron-builder
            logLines = [...logLines, 'Step 2/2 — Running electron-builder…'];
            await api.gameServer.exportDesktop({
                gameDir,
                outDir,
                appName,
                appId,
                version,
                platforms: selectedPlatforms,
            });

            logLines = [...logLines, `Done. Output: ${outDir}`];
            statusMessage = `Desktop build complete:\n${outDir}`;
            statusIsError = false;
            await api.shell.showItemInFolder(outDir);
        } catch (e) {
            const msg = String((e as Error)?.message ?? e);
            logLines = [...logLines, `Error: ${msg}`];
            statusMessage = msg;
            statusIsError = true;
            console.error('[ExportPanel] desktop export failed:', e);
        } finally {
            disposeProgress();
            working = false;
        }
    }

    // ── Reset state when panel closes ─────────────────────────────────────────
    $effect(() => {
        if (!open) {
            // Defer reset so the closing transition finishes first
            setTimeout(() => {
                statusMessage = null;
                statusIsError = false;
                logLines = [];
                working = false;
            }, 200);
        }
    });
</script>

<ModalWindow {open} title="Export Game" wide {onclose}>
    <!-- ── Tab bar ─────────────────────────────────────────────────────────── -->
    <div class="ep-tabs">
        <button
            class="ep-tab"
            class:active={activeTab === 'web'}
            onclick={() => { activeTab = 'web'; statusMessage = null; logLines = []; }}
        >
            <Icon icon="feather:globe" class="feather"/>
            Web folder
        </button>
        <button
            class="ep-tab"
            class:active={activeTab === 'desktop'}
            onclick={() => { activeTab = 'desktop'; statusMessage = null; logLines = []; }}
        >
            <Icon icon="feather:monitor" class="feather"/>
            Desktop app
        </button>
    </div>

    <!-- ── Tab: Web ────────────────────────────────────────────────────────── -->
    {#if activeTab === 'web'}
        <div class="ep-body">
            <p class="ep-hint">
                Exports a playable HTML5 build (index.html, nyx.js, nyx.css, pixi.js
                and all project assets) into a local folder you choose.
            </p>

            <div class="ep-field">
                <label class="ep-label">Output folder</label>
                <div class="ep-row">
                    <input
                        class="ep-path"
                        type="text"
                        readonly
                        value={outDir}
                        placeholder="(no folder chosen)"
                    />
                    <button class="ep-btn" onclick={pickOutDir}>
                        <Icon icon="feather:folder" class="feather"/>
                        Choose…
                    </button>
                </div>
            </div>

            {#if statusMessage}
                <div class="ep-status" class:error={statusIsError} class:success={!statusIsError}>
                    {#each statusMessage.split('\n') as line}
                        <div>{line}</div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- Actions row rendered inside the modal via the actions slot pattern —
             ModalWindow doesn't pass snippets here, so we inline below the body. -->
        <div class="ep-actions">
            <button class="ep-btn secondary" onclick={onclose}>Close</button>
            <button
                class="ep-btn primary"
                onclick={exportWeb}
                disabled={working || !outDir}
            >
                {#if working}
                    <Icon icon="feather:refresh-ccw" class="feather spin" />
                    Exporting…
                {:else}
                    <Icon icon="feather:upload-cloud" class="feather"/>
                    Export to web
                {/if}
            </button>
        </div>

    <!-- ── Tab: Desktop ────────────────────────────────────────────────────── -->
    {:else}
        <div class="ep-body">
            <!-- Validation notices (mirrors legacy .aPanel.error / .warning / .success) -->
            {#if !projectTitle}
                <div class="ep-notice error">
                    A project title is required before desktop export. Set it in
                    Project Settings → Branding.
                </div>
            {/if}
            {#if !appId}
                <div class="ep-notice warning">
                    An App ID is recommended for desktop builds (e.g.
                    <code>dev.nyxgame.mygame</code>). Set it in Project Settings →
                    Branding.
                </div>
            {/if}
            {#if projectTitle && appId}
                <div class="ep-notice success">
                    Project looks good — ready to export.
                </div>
            {/if}

            <!-- Target platforms -->
            <div class="ep-field">
                <label class="ep-label">Target platforms</label>
                <div class="ep-platforms">
                    <label class="ep-check">
                        <input type="checkbox" bind:checked={platformWindows} />
                        <Icon icon="feather:monitor" class="feather"/>
                        Windows
                    </label>
                    <label class="ep-check">
                        <input type="checkbox" bind:checked={platformMac} />
                        <Icon icon="feather:airplay" class="feather"/>
                        macOS
                    </label>
                    <label class="ep-check">
                        <input type="checkbox" bind:checked={platformLinux} />
                        <Icon icon="feather:terminal" class="feather"/>
                        Linux
                    </label>
                </div>
            </div>

            <!-- Output folder -->
            <div class="ep-field">
                <label class="ep-label">Output folder</label>
                <div class="ep-row">
                    <input
                        class="ep-path"
                        type="text"
                        readonly
                        value={outDir}
                        placeholder="(no folder chosen)"
                    />
                    <button class="ep-btn" onclick={pickOutDir}>
                        <Icon icon="feather:folder" class="feather"/>
                        Choose…
                    </button>
                </div>
            </div>

            <!-- Build log (mirrors legacy pre.selectable) -->
            {#if logLines.length > 0}
                <div class="ep-field">
                    <label class="ep-label">Build log</label>
                    <pre class="ep-log">{#each logLines as line}<div>{line}</div>{/each}</pre>
                </div>
            {/if}

            {#if statusMessage && logLines.length === 0}
                <div class="ep-status" class:error={statusIsError} class:success={!statusIsError}>
                    {#each statusMessage.split('\n') as line}
                        <div>{line}</div>
                    {/each}
                </div>
            {/if}
        </div>

        <div class="ep-actions">
            <button class="ep-btn secondary" onclick={onclose}>Close</button>
            <button
                class="ep-btn primary"
                onclick={exportDesktop}
                disabled={working || !outDir}
            >
                {#if working}
                    <Icon icon="feather:refresh-ccw" class="feather spin" />
                    Working…
                {:else}
                    <Icon icon="feather:upload" class="feather"/>
                    Export desktop
                {/if}
            </button>
        </div>
    {/if}
</ModalWindow>

<style>
    /* ── Tab bar ─────────────────────────────────────────────────────────────── */
    .ep-tabs {
        display: flex;
        gap: 0;
        border-bottom: 1px solid var(--border-bright, #333);
        margin: -16px -16px 16px; /* bleed to ModalWindow body edges */
        padding: 0 4px;
        background: var(--background-deeper, #111122);
    }

    .ep-tab {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.45rem 0.85rem;
        font-size: 0.82rem;
        cursor: pointer;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--text-dim, #888);
        transition: color 0.12s, border-color 0.12s;

        :global(svg.feather) {
            width: 0.82rem; height: 0.82rem;
            fill: none; stroke: currentColor; stroke-width: 2;
        }

        &:hover {
            color: var(--text, #e0e0e0);
        }

        &.active {
            color: var(--accent1, #7ec8e3);
            border-bottom-color: var(--accent1, #7ec8e3);
        }
    }

    /* ── Body ────────────────────────────────────────────────────────────────── */
    .ep-body {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .ep-hint {
        margin: 0;
        font-size: 0.8rem;
        color: var(--text-dim, #888);
        line-height: 1.4;
    }

    /* ── Form fields ─────────────────────────────────────────────────────────── */
    .ep-field {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }

    .ep-label {
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--text-dim, #888);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .ep-row {
        display: flex;
        gap: 0.4rem;
        align-items: center;
    }

    .ep-path {
        flex: 1;
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        color: var(--text, #e0e0e0);
        font-size: 0.8rem;
        padding: 0.28rem 0.5rem;
        font-family: monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: default;

        &::placeholder { color: var(--text-dim, #888); font-family: inherit; }
    }

    /* ── Platform checkboxes ─────────────────────────────────────────────────── */
    .ep-platforms {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .ep-check {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.82rem;
        color: var(--text, #e0e0e0);
        cursor: pointer;
        user-select: none;

        input[type="checkbox"] {
            accent-color: var(--accent1, #7ec8e3);
            width: 14px; height: 14px;
            cursor: pointer;
        }

        :global(svg.feather) {
            width: 0.82rem; height: 0.82rem;
            fill: none; stroke: currentColor; stroke-width: 2;
        }
    }

    /* ── Validation notices ──────────────────────────────────────────────────── */
    .ep-notice {
        padding: 0.45rem 0.7rem;
        border-radius: 4px;
        font-size: 0.8rem;
        line-height: 1.4;
        border: 1px solid transparent;

        code {
            font-family: monospace;
            font-size: 0.85em;
            background: rgba(0,0,0,0.25);
            padding: 0 0.25em;
            border-radius: 2px;
        }

        &.error   { background: rgba(231,76,60,0.15);  border-color: rgba(231,76,60,0.45);  color: #f08080; }
        &.warning { background: rgba(230,126,34,0.15); border-color: rgba(230,126,34,0.45); color: #e8a87c; }
        &.success { background: rgba(39,174,96,0.15);  border-color: rgba(39,174,96,0.45);  color: #7edfa0; }
    }

    /* ── Build log ───────────────────────────────────────────────────────────── */
    .ep-log {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        padding: 0.5rem 0.7rem;
        font-size: 0.75rem;
        font-family: monospace;
        color: var(--text, #e0e0e0);
        max-height: 140px;
        overflow-y: auto;
        margin: 0;
        line-height: 1.5;
        user-select: text;
    }

    /* ── Status banner ───────────────────────────────────────────────────────── */
    .ep-status {
        padding: 0.45rem 0.7rem;
        border-radius: 4px;
        font-size: 0.8rem;
        line-height: 1.5;
        border: 1px solid transparent;
        font-family: monospace;

        &.error   { background: rgba(231,76,60,0.15);  border-color: rgba(231,76,60,0.45);  color: #f08080; }
        &.success { background: rgba(39,174,96,0.15);  border-color: rgba(39,174,96,0.45);  color: #7edfa0; }
    }

    /* ── Actions row ─────────────────────────────────────────────────────────── */
    .ep-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--border-bright, #333);
        margin-top: 0.75rem;
    }

    /* ── Shared button styles ────────────────────────────────────────────────── */
    .ep-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.3rem 0.65rem;
        font-size: 0.82rem;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        color: var(--text, #e0e0e0);
        transition: all 0.12s ease;

        :global(svg.feather) {
            width: 0.82rem; height: 0.82rem;
            fill: none; stroke: currentColor; stroke-width: 2;
        }

        &:hover:not(:disabled) {
            border-color: var(--accent1, #7ec8e3);
            color: var(--accent1, #7ec8e3);
        }

        &:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        &.primary {
            background: var(--accent1, #7ec8e3);
            border-color: var(--accent1, #7ec8e3);
            color: #0d1117;
            font-weight: 600;

            &:hover:not(:disabled) {
                filter: brightness(1.1);
                color: #0d1117;
            }
        }

        &.secondary {
            background: transparent;
        }
    }

    /* ── Spinner animation ───────────────────────────────────────────────────── */
    @keyframes spin-ccw {
        from { transform: rotate(0deg); }
        to   { transform: rotate(-360deg); }
    }

    :global(svg.feather.spin) {
        animation: spin-ccw 0.9s linear infinite;
    }
</style>
