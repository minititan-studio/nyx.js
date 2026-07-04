<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * DebuggerPanel.svelte
     * Phase 7D — functional debugger with split layout, game controls,
     * console log capture, and network address modal.
     *
     * Game controls (pause, restart room, switch room) use contentWindow injection
     * when the game is same-origin (localhost). Console capture uses postMessage
     * interception installed after iframe load.
     *
     * True JS breakpoints/stepping require V8 inspector protocol wired into the
     * ct.js runtime — that is a Phase 8+ engine concern, not an editor UI concern.
     */
    import { electronAPI, isElectron } from '../lib/electron.js';

    interface Props {
        url: string | null;
        onrestart?: () => void;
    }
    let { url, onrestart }: Props = $props();

    // ── UI state ───────────────────────────────────────────────────────────
    let iframeEl       = $state<HTMLIFrameElement | undefined>(undefined);
    let iframeLoaded   = $state(false);
    let gamePaused     = $state(false);
    let showInspector  = $state(true);
    let activeInspTab  = $state<'console' | 'state'>('console');
    let showNetModal   = $state(false);
    let showRoomMenu   = $state(false);

    // Persisted layout prefs
    const _dbgS = window.electronAPI.settings.getAll();
    let verticalLayout = $state(_dbgS['dbg-layout'] !== 'horizontal');
    let inspSize       = $state(Math.max(140, (_dbgS['dbg-insp-size'] as number | undefined) ?? 220));

    // ── Console ────────────────────────────────────────────────────────────
    interface LogEntry { id: number; level: 'log' | 'warn' | 'error' | 'info'; text: string; }
    let logEntries = $state<LogEntry[]>([]);
    let logIdSeq   = 0;
    let logEl      = $state<HTMLDivElement | undefined>(undefined);

    // ── Network modal ──────────────────────────────────────────────────────
    let netAddresses = $state<{ name: string; address: string }[]>([]);

    // ── Room list (polled from iframe after load) ──────────────────────────
    let roomList = $state<string[]>([]);

    // ── Derived ───────────────────────────────────────────────────────────
    function extractPort(u: string | null): string | null {
        if (!u) return null;
        try { return new URL(u).port; } catch { return null; }
    }
    const gamePort = $derived(extractPort(url));

    // ── Reset on URL change ────────────────────────────────────────────────
    $effect(() => {
        void url;
        iframeLoaded = false;
        gamePaused   = false;
        logEntries   = [];
        roomList     = [];
    });

    // ── postMessage listener (captures game console output) ───────────────
    $effect(() => {
        function onMessage(e: MessageEvent) {
            const d = e.data as Record<string, unknown> | null;
            if (!d || d['type'] !== 'ct-debugger') return;
            const entry: LogEntry = {
                id:    logIdSeq++,
                level: (['log','warn','error','info'].includes(String(d['level'])) ? d['level'] : 'log') as LogEntry['level'],
                text:  String(d['args'] ?? d['text'] ?? ''),
            };
            logEntries = [...logEntries.slice(-499), entry];
            // Scroll to bottom
            setTimeout(() => logEl?.scrollTo({ top: logEl.scrollHeight }), 0);
        }
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    });

    // ── iframe load ────────────────────────────────────────────────────────
    function handleLoad() {
        iframeLoaded = true;
        gamePaused   = false;
        injectConsoleInterceptor();
        pollRoomList();
    }

    function injectConsoleInterceptor() {
        try {
            const cw = iframeEl?.contentWindow as Record<string, unknown> | null;
            if (!cw || !cw['console']) return;
            const con = cw['console'] as Record<string, unknown>;
            for (const level of ['log', 'warn', 'error', 'info'] as const) {
                const orig = (con[level] as (...a: unknown[]) => void).bind(con);
                con[level] = (...args: unknown[]) => {
                    orig(...args);
                    window.postMessage({ type: 'ct-debugger', level, args: args.map(String).join(' ') }, '*');
                };
            }
        } catch { /* cross-origin — no injection possible */ }
    }

    function pollRoomList() {
        try {
            const cw = iframeEl?.contentWindow as Record<string, unknown> | null;
            if (!cw) return;
            const rooms = cw['rooms'] as Record<string, unknown> | undefined;
            if (rooms?.['templates'] && typeof rooms['templates'] === 'object') {
                roomList = Object.keys(rooms['templates'] as object);
            }
        } catch { /* cross-origin */ }
    }

    // ── Game controls ──────────────────────────────────────────────────────
    function reloadFrame() {
        if (!iframeEl) return;
        iframeLoaded = false;
        gamePaused   = false;
        iframeEl.src = iframeEl.src;
    }

    function togglePause() {
        if (!iframeEl) return;
        try {
            const cw = iframeEl.contentWindow as Record<string, unknown> | null;
            const app = cw?.['pixiApp'] as Record<string, unknown> | undefined;
            const ticker = app?.['ticker'] as Record<string, unknown> | undefined;
            if (!ticker) return;
            if (!gamePaused) {
                (ticker['stop'] as () => void)();
                gamePaused = true;
            } else {
                (ticker['start'] as () => void)();
                gamePaused = false;
            }
        } catch { /* cross-origin */ }
    }

    function restartRoom() {
        if (!iframeEl) return;
        try {
            const cw    = iframeEl.contentWindow as Record<string, unknown> | null;
            const rooms = cw?.['rooms'] as Record<string, unknown> | undefined;
            const cur   = rooms?.['current'] as Record<string, unknown> | undefined;
            const name  = cur?.['name'] as string | undefined;
            if (name && typeof rooms?.['switch'] === 'function') {
                (rooms['switch'] as (n: string) => void)(name);
            }
        } catch { /* cross-origin */ }
    }

    function switchRoom(name: string) {
        if (!iframeEl) return;
        showRoomMenu = false;
        try {
            const cw    = iframeEl.contentWindow as Record<string, unknown> | null;
            const rooms = cw?.['rooms'] as Record<string, unknown> | undefined;
            if (typeof rooms?.['switch'] === 'function') {
                (rooms['switch'] as (n: string) => void)(name);
            }
        } catch { /* cross-origin */ }
    }

    function makeScreenshot() {
        if (!iframeEl) return;
        try {
            const canvas = iframeEl.contentWindow?.document.querySelector('canvas') as HTMLCanvasElement | null;
            if (!canvas) return;
            canvas.toBlob(blob => {
                if (!blob) return;
                const blobUrl = URL.createObjectURL(blob);
                const a       = document.createElement('a');
                a.href        = blobUrl;
                a.download    = 'screenshot.png';
                a.click();
                URL.revokeObjectURL(blobUrl);
            }, 'image/png');
        } catch { /* cross-origin */ }
    }

    function openExternal() {
        if (!url) return;
        if (isElectron()) {
            electronAPI().shell.openExternal(url);
        } else {
            window.open(url, '_blank');
        }
    }

    function flipLayout() {
        verticalLayout = !verticalLayout;
        void window.electronAPI.settings.set('dbg-layout', verticalLayout ? 'vertical' : 'horizontal');
    }

    async function openNetModal() {
        showNetModal = true;
        if (isElectron() && netAddresses.length === 0) {
            netAddresses = await electronAPI().system.networkInterfaces();
        }
    }

    // ── Gutter resize ──────────────────────────────────────────────────────
    function onGutterMouseDown(e: MouseEvent) {
        e.preventDefault();
        const startPos  = verticalLayout ? e.clientX : e.clientY;
        const startSize = inspSize;

        const overlay       = document.createElement('div');
        overlay.style.cssText = `position:fixed;inset:0;z-index:9999;cursor:${verticalLayout ? 'ew' : 'ns'}-resize`;
        document.body.appendChild(overlay);

        function onMove(ev: MouseEvent) {
            const delta = verticalLayout ? startPos - ev.clientX : startPos - ev.clientY;
            inspSize = Math.max(160, Math.min(640, startSize + delta));
        }
        function onUp() {
            document.body.removeChild(overlay);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',  onUp);
            void window.electronAPI.settings.set('dbg-insp-size', inspSize);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    }
</script>

<!-- ══ Debugger Panel ═══════════════════════════════════════════════════════ -->
<div class="debugger-panel">

    <!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
    <div class="dbg-toolbar">
        {#if url}
            <!-- Game controls -->
            <button class="tool-btn" class:active={gamePaused}
                    title={gamePaused ? 'Resume (pixiApp.ticker.start)' : 'Pause (pixiApp.ticker.stop)'}
                    onclick={togglePause}>
                <Icon icon={`feather:${gamePaused ? 'play' : 'pause'}`} class="feather"/>
            </button>
            <button class="tool-btn" title="Restart game (full re-export + reload)" onclick={onrestart}>
                <Icon icon="feather:rotate-cw" class="feather"/>
            </button>
            <button class="tool-btn" title="Restart current room" onclick={restartRoom}>
                <Icon icon="feather:refresh-cw" class="feather"/>
            </button>
            <!-- Room switch dropdown -->
            <div class="room-menu-wrap">
                <button class="tool-btn" title="Switch room" onclick={() => { pollRoomList(); showRoomMenu = !showRoomMenu; }}>
                    <Icon icon="feather:map" class="feather"/>
                </button>
                {#if showRoomMenu}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="room-dropdown" onmouseleave={() => (showRoomMenu = false)}>
                        {#each roomList as room}
                            <button class="room-item" onclick={() => switchRoom(room)}>{room}</button>
                        {/each}
                        {#if roomList.length === 0}
                            <span class="room-item dim">No rooms found</span>
                        {/if}
                    </div>
                {/if}
            </div>
            <button class="tool-btn" title="Reload iframe" onclick={reloadFrame}>
                <Icon icon="feather:rotate-ccw" class="feather"/>
            </button>

            <div class="sep"></div>

            <button class="tool-btn" title="Screenshot (canvas capture)" onclick={makeScreenshot}>
                <Icon icon="feather:camera" class="feather"/>
            </button>
            <button class="tool-btn" title="Network addresses" onclick={openNetModal}>
                <Icon icon="feather:smartphone" class="feather"/>
            </button>
            <button class="tool-btn" title="Open in browser" onclick={openExternal}>
                <Icon icon="feather:external-link" class="feather"/>
            </button>

            <div class="sep"></div>

            <button class="tool-btn" title="Flip layout (vertical ↔ horizontal)" onclick={flipLayout}>
                <Icon icon="feather:layout" class="feather"/>
            </button>
            <button class="tool-btn" class:active={showInspector} title="Toggle inspector panel"
                    onclick={() => (showInspector = !showInspector)}>
                <Icon icon="feather:terminal" class="feather"/>
            </button>

            <span class="url-display">{url}</span>
            {#if !iframeLoaded}
                <span class="loading-badge">Loading…</span>
            {/if}
        {:else}
            <span class="hint-text">Press F5 to build and run the project.</span>
        {/if}
    </div>

    <!-- ── Content ─────────────────────────────────────────────────────────── -->
    {#if url}
        <div class="split-area" class:vertical={verticalLayout}>

            <!-- Game iframe -->
            <iframe
                bind:this={iframeEl}
                src={url}
                class="game-frame"
                title="Game Preview"
                onload={handleLoad}
                allow="autoplay; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups"
            ></iframe>

            {#if showInspector}
                <!-- Resize gutter -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <div
                    class="gutter"
                    class:vertical={verticalLayout}
                    role="separator"
                    aria-orientation={verticalLayout ? 'vertical' : 'horizontal'}
                    onmousedown={onGutterMouseDown}
                ></div>

                <!-- Inspector -->
                <div
                    class="inspector"
                    style={verticalLayout ? `width:${inspSize}px` : `height:${inspSize}px`}
                >
                    <div class="insp-tabbar">
                        <button class="insp-tab" class:active={activeInspTab === 'console'}
                                onclick={() => (activeInspTab = 'console')}>Console</button>
                        <button class="insp-tab" class:active={activeInspTab === 'state'}
                                onclick={() => (activeInspTab = 'state')}>State</button>
                        <div class="insp-tab-spacer"></div>
                        {#if activeInspTab === 'console'}
                            <button class="insp-tab-action" title="Clear console" onclick={() => (logEntries = [])}>
                                <Icon icon="feather:trash-2" class="feather sm" />
                            </button>
                        {/if}
                    </div>

                    {#if activeInspTab === 'console'}
                        <div class="console-log" bind:this={logEl}>
                            {#each logEntries as entry (entry.id)}
                                <div class="log-row" class:lvl-warn={entry.level === 'warn'} class:lvl-error={entry.level === 'error'}>
                                    <span class="log-badge {entry.level}">{entry.level[0].toUpperCase()}</span>
                                    <span class="log-text">{entry.text}</span>
                                </div>
                            {/each}
                            {#if logEntries.length === 0}
                                <p class="console-hint dim">
                                    Console messages from the game will appear here.<br />
                                    <span class="small">Requires same-origin game or runtime postMessage integration.</span>
                                </p>
                            {/if}
                        </div>

                    {:else}
                        <!-- State / variable inspector -->
                        <div class="state-panel">
                            <div class="state-section">
                                <div class="state-heading">Runtime state</div>
                                <p class="dim small">
                                    Live variable inspection requires the ct.js runtime to emit
                                    <code>ct-debugger</code> postMessage events with game state.
                                    Wire into the runtime to populate this panel.
                                </p>
                            </div>
                            <div class="state-section">
                                <div class="state-heading">Breakpoints</div>
                                <p class="dim small">
                                    Source-level breakpoints require V8 inspector protocol integration
                                    (Phase 8 engine work). Use browser DevTools for now.
                                </p>
                                <button class="open-devtools-btn" onclick={openExternal} title="Open game in browser for DevTools access">
                                    <Icon icon="feather:external-link" class="feather"/>
                                    Open in browser
                                </button>
                            </div>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>

    {:else}
        <!-- Empty state -->
        <div class="empty-state">
            <Icon icon="feather:play-circle" class="feather hero-icon" aria-hidden="true" />
            <p>No game running.</p>
            <p class="dim">Press <kbd>F5</kbd> to export and launch a preview.</p>
        </div>
    {/if}
</div>

<!-- ── Network Modal ─────────────────────────────────────────────────────── -->
{#if showNetModal}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-backdrop" role="presentation" onclick={() => (showNetModal = false)}></div>
    <div class="net-modal" role="dialog" aria-modal="true" aria-label="Network addresses">
        <div class="net-modal-header">
            <span>Network addresses</span>
            <button onclick={() => (showNetModal = false)} title="Close">
                <Icon icon="feather:x" class="feather"/>
            </button>
        </div>
        <div class="net-modal-body">
            {#each netAddresses as iface}
                {@const addr = `http://${iface.address}:${gamePort ?? ''}/`}
                <div class="net-row">
                    <span class="net-iface dim">{iface.name}</span>
                    <code class="net-addr">{addr}</code>
                    <button class="net-copy" title="Copy" onclick={() => navigator.clipboard.writeText(addr)}>
                        <Icon icon="feather:copy" class="feather"/>
                    </button>
                </div>
            {/each}
            {#if netAddresses.length === 0}
                <p class="dim small" style:padding="0.5rem 0">No external IPv4 interfaces found.</p>
            {/if}
            <p class="dim small" style:margin-top="0.75rem">
                Open these URLs on a device on the same network to test on mobile.
            </p>
        </div>
    </div>
{/if}


<style>
    .debugger-panel {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background: #0d0d1a;
        overflow: hidden;
        position: relative;
    }

    /* ── Toolbar ─────────────────────────────────────────────────────────── */
    .dbg-toolbar {
        display: flex;
        flex-flow: row nowrap;
        align-items: center;
        gap: 0.15rem;
        padding: 0.2rem 0.4rem;
        background: var(--background, #1a1a2e);
        border-bottom: 1px solid var(--border-bright, #333);
        flex-shrink: 0;
        min-height: 2rem;
    }

    .tool-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.7rem; height: 1.7rem;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 3px;
        color: var(--text-dim, #888);
        cursor: pointer;
        transition: all 0.1s;
        :global(svg.feather) { width: 0.82rem; height: 0.82rem; fill: none; stroke: currentColor; stroke-width: 2; }
        &:hover  { background: var(--act, #1e2233); border-color: var(--border-bright, #333); color: var(--text, #e0e0e0); }
        &.active { background: rgba(68,106,219,0.2); border-color: var(--accent1, #446adb); color: var(--accent1, #446adb); }
    }

    .sep { width: 1px; height: 1.1rem; background: var(--border-bright, #333); margin: 0 0.1rem; flex-shrink: 0; }

    .url-display {
        flex: 1 1 auto;
        font-size: 0.7rem;
        color: var(--text-dim, #888);
        font-family: monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        padding-left: 0.3rem;
    }

    .loading-badge {
        font-size: 0.7rem;
        color: var(--warning, #f5a623);
        flex-shrink: 0;
        padding-right: 0.3rem;
    }

    .hint-text { font-size: 0.8rem; color: var(--text-dim, #888); padding-left: 0.3rem; }

    /* ── Room dropdown ───────────────────────────────────────────────────── */
    .room-menu-wrap { position: relative; }
    .room-dropdown {
        position: absolute;
        top: calc(100% + 2px); left: 0;
        z-index: 200;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        min-width: 140px;
        max-height: 200px;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .room-item {
        display: block; width: 100%;
        padding: 0.3rem 0.6rem;
        background: transparent; border: none;
        color: var(--text, #e0e0e0); font-size: 0.8rem;
        text-align: left; cursor: pointer;
        &:hover { background: var(--act, #1e2233); }
        &.dim { color: var(--text-dim, #888); cursor: default; }
    }

    /* ── Split area ──────────────────────────────────────────────────────── */
    .split-area {
        flex: 1 1 auto;
        display: flex;
        flex-direction: row;
        overflow: hidden;
        min-height: 0;

        &.vertical {
            flex-direction: row;
            .gutter { width: 4px; height: 100%; cursor: ew-resize; }
            .inspector { height: 100%; flex-shrink: 0; }
        }
        &:not(.vertical) {
            flex-direction: column;
            .gutter { width: 100%; height: 4px; cursor: ns-resize; }
            .inspector { width: 100%; flex-shrink: 0; }
        }
    }

    .game-frame {
        flex: 1 1 auto;
        border: none;
        display: block;
        background: #000;
        min-width: 0; min-height: 0;
    }

    .gutter {
        background: var(--border-bright, #333);
        flex-shrink: 0;
        transition: background 0.1s;
        &:hover { background: var(--accent1, #446adb); }
    }

    /* ── Inspector ───────────────────────────────────────────────────────── */
    .inspector {
        display: flex;
        flex-direction: column;
        background: var(--background, #1a1a2e);
        border-left: 1px solid var(--border-bright, #333);
        overflow: hidden;
        min-width: 160px; min-height: 100px;
    }

    .insp-tabbar {
        display: flex;
        align-items: center;
        background: var(--background-deeper, #111122);
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }
    .insp-tab {
        padding: 0.3rem 0.7rem;
        font-size: 0.75rem;
        background: transparent; border: none;
        color: var(--text-dim, #888); cursor: pointer;
        border-bottom: 2px solid transparent;
        &.active { color: var(--text, #e0e0e0); border-bottom-color: var(--accent1, #446adb); }
        &:hover:not(.active) { color: var(--text, #e0e0e0); }
    }
    .insp-tab-spacer { flex: 1 1 auto; }
    .insp-tab-action {
        display: inline-flex; align-items: center; justify-content: center;
        width: 1.5rem; height: 1.5rem; padding: 0; margin: 0 0.2rem;
        background: transparent; border: 1px solid transparent; border-radius: 3px;
        color: var(--text-dim, #888); cursor: pointer;
        :global(svg.feather.sm) { width: 0.75rem; height: 0.75rem; fill: none; stroke: currentColor; stroke-width: 2; }
        &:hover { background: var(--act, #1e2233); border-color: var(--border-bright, #333); color: var(--text, #e0e0e0); }
    }

    /* ── Console ─────────────────────────────────────────────────────────── */
    .console-log {
        flex: 1 1 auto;
        overflow-y: auto;
        font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
        font-size: 0.75rem;
        line-height: 1.4;
    }
    .log-row {
        display: flex;
        align-items: flex-start;
        gap: 0.4rem;
        padding: 0.15rem 0.5rem;
        border-bottom: 1px solid transparent;
        &.lvl-warn  { background: rgba(245,166,35,0.07);  border-bottom-color: rgba(245,166,35,0.15); }
        &.lvl-error { background: rgba(231,76,60,0.1);    border-bottom-color: rgba(231,76,60,0.2); }
    }
    .log-badge {
        flex-shrink: 0;
        width: 1rem; text-align: center;
        font-weight: 700; font-size: 0.65rem;
        padding-top: 0.1rem;
        &.log   { color: var(--text-dim, #888); }
        &.info  { color: #58a6ff; }
        &.warn  { color: #f5a623; }
        &.error { color: #e74c3c; }
    }
    .log-text { flex: 1 1 auto; color: var(--text, #e0e0e0); word-break: break-word; white-space: pre-wrap; }
    .console-hint {
        padding: 0.75rem; line-height: 1.6;
        font-size: 0.78rem; font-family: inherit;
        margin: 0;
    }

    /* ── State panel ─────────────────────────────────────────────────────── */
    .state-panel { flex: 1 1 auto; overflow-y: auto; padding: 0.5rem; }
    .state-section { margin-bottom: 0.75rem; }
    .state-heading {
        font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.05em; color: var(--text-dim, #888);
        margin-bottom: 0.3rem;
    }
    .open-devtools-btn {
        display: inline-flex; align-items: center; gap: 0.3rem;
        margin-top: 0.4rem; padding: 0.25rem 0.5rem;
        font-size: 0.78rem; cursor: pointer;
        background: transparent; border: 1px solid var(--border-bright, #333);
        border-radius: 3px; color: var(--text, #e0e0e0);
        &:hover { border-color: var(--acttext, #7ec8e3); color: var(--acttext, #7ec8e3); }
        :global(svg.feather) { width: 0.78rem; height: 0.78rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }

    /* ── Empty state ─────────────────────────────────────────────────────── */
    .empty-state {
        flex: 1 1 auto;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 0.4rem; color: var(--text-dim, #888); font-size: 0.9rem;
    }
    .hero-icon { width: 4rem; height: 4rem; fill: none; stroke: var(--border-bright, #333); stroke-width: 1; margin-bottom: 0.5rem; }
    p { margin: 0.15rem 0; }
    .dim   { color: var(--text-dim, #888); }
    .small { font-size: 0.78rem; }
    kbd {
        display: inline-block; padding: 0.1rem 0.4rem;
        font-family: monospace; font-size: 0.75rem;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px; color: var(--acttext, #7ec8e3);
    }

    /* ── Network modal ───────────────────────────────────────────────────── */
    .modal-backdrop {
        position: fixed; inset: 0; z-index: 300;
        background: rgba(0,0,0,0.5);
    }
    .net-modal {
        position: fixed; z-index: 301;
        top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 6px;
        min-width: 320px; max-width: 480px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        overflow: hidden;
    }
    .net-modal-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        font-weight: 600; font-size: 0.85rem;
        button {
            display: inline-flex; align-items: center; justify-content: center;
            width: 1.5rem; height: 1.5rem; padding: 0;
            background: transparent; border: none; cursor: pointer;
            color: var(--text-dim, #888);
            :global(svg.feather) { width: 0.85rem; height: 0.85rem; fill: none; stroke: currentColor; stroke-width: 2; }
            &:hover { color: var(--text, #e0e0e0); }
        }
    }
    .net-modal-body { padding: 0.75rem; }
    .net-row {
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.3rem 0;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
    }
    .net-iface { font-size: 0.75rem; flex: 0 0 80px; }
    .net-addr  { flex: 1 1 auto; font-size: 0.8rem; color: var(--acttext, #7ec8e3); word-break: break-all; }
    .net-copy  {
        display: inline-flex; align-items: center; justify-content: center;
        width: 1.4rem; height: 1.4rem; padding: 0; flex-shrink: 0;
        background: transparent; border: 1px solid transparent; border-radius: 3px; cursor: pointer;
        color: var(--text-dim, #888);
        :global(svg.feather) { width: 0.75rem; height: 0.75rem; fill: none; stroke: currentColor; stroke-width: 2; }
        &:hover { border-color: var(--border-bright, #333); color: var(--text, #e0e0e0); }
    }
    code { font-family: monospace; }
</style>
