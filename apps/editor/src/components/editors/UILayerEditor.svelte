<script lang="ts">
    import Icon from '@iconify/svelte';
    import { onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { createEditor } from '../../lib/monaco.js';
    import { electronAPI } from '../../lib/electron.js';
    import {
        currentProject, currentProjectDir, updateAsset,
        projectFilePath,
    } from '../../stores/projectStore.js';
    import { signals } from '../../stores/editorStore.js';
    import {
        CORE_EVENTS, EVENT_CATEGORIES,
        buildMethodStub,
    } from '@nyx/shared';
    import type { NyxUILayer, NyxRoom } from '@nyx/shared';
    import type { EventDef } from '@nyx/shared';
    import RoomEditor from './RoomEditor.svelte';

    interface Props { asset: NyxUILayer; }
    let { asset }: Props = $props();

    const liveLayer = $derived(
        ($currentProject?.uiLayers?.find(l => l.uid === asset.uid)) ?? asset
    );

    // ── Tab state ─────────────────────────────────────────────────────────────
    let showScript      = $state(false);
    // Tracks whether the script tab was ever opened — keeps Monaco mounted after first use
    let scriptMounted   = $state(false);

    // ── Event picker ──────────────────────────────────────────────────────────

    // Lifecycle events from CORE_EVENTS (uiLayer category only)
    const lifecycleEvents = $derived(
        Object.entries(CORE_EVENTS).filter(([, def]) =>
            def.applicable.includes('uiLayer') && def.category === 'uiLayer'
        )
    );

    type WidgetEventDef = { name: string; icon: string; inMount?: boolean; code: (n: string) => string };

    const WIDGET_TYPE_ICONS: Record<string, string> = {
        label: 'type', button: 'square', image: 'image', panel: 'layout', progressbar: 'bar-chart-2',
    };

    // Per-widget-type relevant snippets — tailored to what each widget actually supports
    const WIDGET_EVENTS: Record<string, WidgetEventDef[]> = {
        button: [
            { name: 'On Click',     icon: 'zap',        inMount: true, code: n => `ui.onButtonClick('${n}', () => {\n    // handle click\n  });` },
            { name: 'On Hover',     icon: 'move',       inMount: true, code: n => `ui.on('${n}', 'pointerover', () => {\n    // \n  });` },
            { name: 'On Out',       icon: 'log-out',    inMount: true, code: n => `ui.on('${n}', 'pointerout', () => {\n    // \n  });` },
            { name: 'Show',         icon: 'eye',                       code: n => `ui.show('${n}');` },
            { name: 'Hide',         icon: 'eye-off',                   code: n => `ui.hide('${n}');` },
        ],
        label: [
            { name: 'Set Text',     icon: 'type',                      code: n => `ui.setText('${n}', 'Hello');` },
            { name: 'Fade In',      icon: 'sunrise',                   code: n => `ui.fadeIn('${n}');` },
            { name: 'Fade Out',     icon: 'sunset',                    code: n => `ui.fadeOut('${n}');` },
            { name: 'Show',         icon: 'eye',                       code: n => `ui.show('${n}');` },
            { name: 'Hide',         icon: 'eye-off',                   code: n => `ui.hide('${n}');` },
        ],
        progressbar: [
            { name: 'Set Progress', icon: 'bar-chart-2',               code: n => `ui.setProgress('${n}', value); // 0.0 – 1.0` },
            { name: 'Animate To',   icon: 'trending-up',               code: n => `ui.animateProgress('${n}', 0.5, 300); // target 0.0–1.0, ms` },
            { name: 'Fade In',      icon: 'sunrise',                   code: n => `ui.fadeIn('${n}');` },
            { name: 'Fade Out',     icon: 'sunset',                    code: n => `ui.fadeOut('${n}');` },
            { name: 'Show',         icon: 'eye',                       code: n => `ui.show('${n}');` },
            { name: 'Hide',         icon: 'eye-off',                   code: n => `ui.hide('${n}');` },
        ],
        image: [
            { name: 'On Click',     icon: 'zap',        inMount: true, code: n => `ui.onButtonClick('${n}', () => {\n    // \n  });` },
            { name: 'On Hover',     icon: 'move',       inMount: true, code: n => `ui.on('${n}', 'pointerover', () => {\n    // \n  });` },
            { name: 'Fade In',      icon: 'sunrise',                   code: n => `ui.fadeIn('${n}');` },
            { name: 'Fade Out',     icon: 'sunset',                    code: n => `ui.fadeOut('${n}');` },
            { name: 'Show',         icon: 'eye',                       code: n => `ui.show('${n}');` },
            { name: 'Hide',         icon: 'eye-off',                   code: n => `ui.hide('${n}');` },
        ],
        panel: [
            { name: 'On Click',     icon: 'zap',        inMount: true, code: n => `ui.onButtonClick('${n}', () => {\n    // \n  });` },
            { name: 'Open',         icon: 'maximize-2',                code: n => `ui.open('${n}');` },
            { name: 'Close',        icon: 'minimize-2',                code: n => `ui.close('${n}');` },
            { name: 'Fade In',      icon: 'sunrise',                   code: n => `ui.fadeIn('${n}');` },
            { name: 'Fade Out',     icon: 'sunset',                    code: n => `ui.fadeOut('${n}');` },
        ],
    };


    function insertLifecycleEvent(lib: string, eventKey: string, def: EventDef) {
        if (!monacoEditor) return;
        const stub = buildMethodStub(lib, eventKey);
        insertStubAtEnd(stub);
    }

    function insertWidgetEvent(widgetName: string, ev: WidgetEventDef) {
        if (!monacoEditor) return;
        if (ev.inMount) {
            insertOrAppendToMethod('onMount', ev.code(widgetName));
        } else {
            insertOrAppendToMethod('onStep', ev.code(widgetName));
        }
        activeWidgetUid = null;
        widgetMenuOpen  = false;
    }

    // Cascading widget menu state
    let widgetMenuOpen  = $state(false);
    let activeWidgetUid = $state<string | null>(null);
    function toggleWidgetMenu() { widgetMenuOpen = !widgetMenuOpen; activeWidgetUid = null; }

    function insertStubAtEnd(stub: string) {
        if (!monacoEditor) return;
        const model = monacoEditor.getModel();
        if (!model) return;
        const lineCount = model.getLineCount();
        const lastLine = model.getLineContent(lineCount);
        // Insert before the closing brace of the class
        const closingLine = findClassClosingBrace(model);
        const insertLine = closingLine > 0 ? closingLine : lineCount;
        const insertCol = 1;
        monacoEditor.executeEdits('event-picker', [{
            range: { startLineNumber: insertLine, startColumn: insertCol, endLineNumber: insertLine, endColumn: insertCol },
            text: '\n' + stub,
        }]);
        monacoEditor.focus();
    }

    function insertOrAppendToMethod(methodName: string, snippet: string) {
        if (!monacoEditor) return;
        const model = monacoEditor.getModel();
        if (!model) return;
        const text = model.getValue();
        const methodRegex = new RegExp(`${methodName}\\s*\\(([^)]*)\\)\\s*\\{`);
        const match = methodRegex.exec(text);
        if (match) {
            // Find the method body end and insert before the closing brace
            const startOffset = match.index + match[0].length;
            const pos = model.getPositionAt(startOffset);
            // Find next closing brace line
            const lineCount = model.getLineCount();
            for (let ln = pos.lineNumber; ln <= lineCount; ln++) {
                const content = model.getLineContent(ln);
                if (content.trim() === '}') {
                    monacoEditor.executeEdits('event-picker', [{
                        range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
                        text: '    ' + snippet + '\n',
                    }]);
                    monacoEditor.focus();
                    return;
                }
            }
        } else {
            // Method doesn't exist — insert a full onMount stub containing the snippet
            const stub = `  ${methodName}() {\n    ${snippet}\n  }\n`;
            insertStubAtEnd(stub);
        }
    }

    function findClassClosingBrace(model: { getLineCount(): number; getLineContent(n: number): string }): number {
        const lineCount = model.getLineCount();
        for (let ln = lineCount; ln >= 1; ln--) {
            if (model.getLineContent(ln).trim() === '}') return ln;
        }
        return lineCount;
    }

    // ── Monaco script editor ──────────────────────────────────────────────────
    let editorEl: HTMLElement | undefined;
    let monacoEditor: ReturnType<typeof createEditor> | undefined;
    let scriptContent   = $state('');
    let scriptError     = $state<string | null>(null);
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    function absPath(sp: string | undefined): string | null {
        const dir = get(currentProjectDir);
        if (!sp || !dir) return null;
        return `${dir}/${sp.replace(/\\/g, '/')}`;
    }

    async function loadScriptFromPath(sp: string) {
        const abs = absPath(sp);
        if (!abs) { scriptContent = ''; scriptError = null; return; }
        try {
            const { content } = await electronAPI().file.readText(abs);
            scriptContent = content;
            scriptError = null;
            // Push directly to Monaco if it already exists (avoids a second-effect timing gap)
            if (monacoEditor && monacoEditor.getValue() !== content) {
                monacoEditor.setValue(content);
            }
        } catch {
            scriptError = `Could not read: ${sp}`;
            scriptContent = '';
        }
    }

    function saveScriptDebounced() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            const sp = get(currentProject)?.uiLayers?.find(l => l.uid === asset.uid)?.scriptPath;
            const abs = absPath(sp);
            if (!abs) return;
            const toSave = monacoEditor?.getValue() ?? '';
            try {
                await electronAPI().file.writeText(abs, toSave);
                signals.emit('assetChanged');
            } catch { /* ignore */ }
        }, 500);
    }

    async function openScript(): Promise<void> {
        let sp = liveLayer.scriptPath;
        if (!sp) {
            const fp = get(projectFilePath);
            if (!fp) return;
            const result = await electronAPI().script.create({
                assetType: 'uiLayer',
                name: liveLayer.name,
                projectFilePath: fp,
            });
            sp = result.scriptPath;
            updateAsset<NyxUILayer>(liveLayer.uid, 'uiLayer', { scriptPath: sp });
            signals.emit('assetChanged');
        }
        // Load content before revealing the tab so Monaco initialises with the right value
        await loadScriptFromPath(sp);
        scriptMounted = true;
        showScript = true;
    }

    $effect(() => {
        if (!showScript || !editorEl) return;
        if (monacoEditor) return;
        monacoEditor = createEditor(editorEl, { value: scriptContent, language: 'typescript' });
        monacoEditor.onDidChangeModelContent(() => {
            saveScriptDebounced();
        });
    });

    $effect(() => {
        if (!monacoEditor || !showScript) return;
        const cur = monacoEditor.getValue();
        if (cur !== scriptContent) monacoEditor.setValue(scriptContent);
    });

    onDestroy(() => {
        clearTimeout(saveTimer);
        monacoEditor?.dispose();
    });

    // Synthetic room — not persisted in the project
    const syntheticRoom = $derived<NyxRoom>({
        uid:             `__ui_preview__${asset.uid}`,
        name:            asset.name,
        type:            'room',
        lastModified:    asset.lastModified,
        width:           1280,
        height:          720,
        backgroundColor: '#1a1a2e',
        copies: [], backgrounds: [], tiles: [],
        uiLayerUids:     [asset.uid],
        isStartingRoom:  false,
        viewMode:        'fastScale',
        gridX: 32, gridY: 32,
        diagonalGrid:    false,
        disableGrid:     false,
        behaviors:       [],
    });
</script>

<div class="ui-layer-editor">
    <div class="layer-toolbar">
        <span class="layer-name">{liveLayer.name}</span>
        <div class="tab-group">
            <button class="tab-btn" class:active={!showScript} onclick={() => { showScript = false; }}>
                <Icon icon="material-symbols:layers" class="feather"/>
                Widgets
            </button>
            <button class="tab-btn" class:active={showScript}
                    title={liveLayer.scriptPath ? 'Edit script' : 'Create script'}
                    onclick={openScript}>
                <Icon icon="material-symbols:code" class="feather"/>
                Script
            </button>
        </div>
    </div>

    <!-- Script pane: stays in DOM once opened so Monaco doesn't get destroyed on tab switch -->
    {#if scriptMounted}
        <div class="script-pane" style:display={showScript ? 'flex' : 'none'}>
            {#if scriptError}
                <div class="script-error">{scriptError}</div>
            {:else if !liveLayer.scriptPath}
                <div class="script-hint dim">Click Script above to create a UILayer class.</div>
            {:else}
                <!-- Event picker sidebar -->
                <div class="event-picker">
                    <!-- Lifecycle -->
                    <div class="event-group">
                        <div class="event-group-label">
                            <Icon icon="feather:layers" class="feather"/>
                            Lifecycle
                        </div>
                        {#each lifecycleEvents as [key, def] (key)}
                            {@const parts = key.split('_')}
                            <button class="event-btn" onclick={() => insertLifecycleEvent(parts[0], parts.slice(1).join('_'), def)}>
                                <Icon icon="feather:plus" class="feather"/>
                                {def.name}
                            </button>
                        {/each}
                    </div>

                    <!-- Widget cascading menu -->
                    {#if liveLayer.widgets.length > 0}
                        <div class="event-group">
                            <div class="event-group-label">
                                <Icon icon="feather:layers" class="feather"/>
                                Widgets
                            </div>
                            <div class="widget-menu-wrap">
                                <button class="widget-menu-trigger" onclick={toggleWidgetMenu}>
                                    <Icon icon="feather:plus" class="feather"/>
                                    Widget +
                                    <Icon icon="feather:{widgetMenuOpen ? 'chevron-up' : 'chevron-down'}" class="feather" style="margin-left:auto"/>
                                </button>

                                {#if widgetMenuOpen}
                                    <!-- Level 1: widget list -->
                                    <div class="cascade-l1">
                                        {#each liveLayer.widgets as widget (widget.uid)}
                                            <div class="cascade-item"
                                                 class:active={activeWidgetUid === widget.uid}
                                                 onclick={() => { activeWidgetUid = activeWidgetUid === widget.uid ? null : widget.uid; }}>
                                                <Icon icon="feather:{activeWidgetUid === widget.uid ? 'chevron-down' : 'chevron-right'}" class="feather" style="opacity:.35;flex-shrink:0;width:12px"/>
                                                <Icon icon="feather:{WIDGET_TYPE_ICONS[widget.type] ?? 'box'}" class="feather" style="flex-shrink:0;opacity:.7"/>
                                                <span class="cascade-name">{widget.name}</span>

                                                <!-- Level 2: events for this widget -->
                                                {#if activeWidgetUid === widget.uid}
                                                    {@const evs = WIDGET_EVENTS[widget.type] ?? []}
                                                    <div class="cascade-l2">
                                                        {#each evs as ev}
                                                            <button class="cascade-ev"
                                                                    onclick={(e) => { e.stopPropagation(); insertWidgetEvent(widget.name, ev); }}>
                                                                <Icon icon="feather:{ev.icon}" class="feather"/>
                                                                {ev.name}
                                                            </button>
                                                        {/each}
                                                    </div>
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/if}
                </div>
                <!-- Monaco editor -->
                <div class="monaco-host" bind:this={editorEl}></div>
            {/if}
        </div>
    {/if}

    <!-- Widgets canvas — unmount when script tab is active to avoid PixiJS overhead -->
    {#if !showScript}
        <RoomEditor asset={syntheticRoom} uiOnlyMode={true} />
    {/if}
</div>

<style>
    .ui-layer-editor {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }
    .layer-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px;
        border-bottom: 1px solid var(--border-pale);
        flex-shrink: 0;
        background: var(--background);
    }
    .layer-name { font-size: 13px; font-weight: 600; flex: 1; }
    .tab-group  { display: flex; gap: 4px; }
    .tab-btn {
        display: flex; align-items: center; gap: 4px;
        padding: 3px 9px; font-size: 11px;
        background: var(--background-deeper);
        border: 1px solid var(--border-pale);
        border-radius: 4px;
        color: var(--text); cursor: pointer;
    }
    .tab-btn:hover  { border-color: var(--accent1); color: #fff; }
    .tab-btn.active { border-color: var(--accent1); background: color-mix(in srgb, var(--accent1) 15%, transparent); color: #fff; }

    .script-pane {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: row;
    }

    /* ── Event picker ─────────────────────────────────────────────────────── */
    .event-picker {
        width: 170px;
        min-width: 170px;
        max-width: 170px;
        border-right: 1px solid var(--border-pale);
        overflow-x: hidden;
        overflow-y: auto;
        background: var(--background);
        padding: 8px 0 12px;
        box-sizing: border-box;
    }

    .event-group { margin-bottom: 10px; }

    .event-group-label {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 0 8px 4px;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        opacity: 0.4;
        white-space: nowrap;
    }

    /* Lifecycle + generic event buttons */
    .event-btn {
        display: flex;
        align-items: center;
        gap: 5px;
        width: 100%;
        padding: 4px 10px;
        font-size: 11px;
        background: none;
        border: none;
        color: var(--text);
        cursor: pointer;
        text-align: left;
        box-sizing: border-box;
        overflow: hidden;
    }
    .event-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }

    /* ── Widget cascade ───────────────────────────────────────────────────── */
    .widget-menu-wrap {
        padding: 0 6px;
        box-sizing: border-box;
        width: 100%;
        overflow: hidden;
    }

    .widget-menu-trigger {
        display: flex;
        align-items: center;
        gap: 5px;
        width: 100%;
        padding: 5px 8px;
        font-size: 11px;
        font-weight: 600;
        background: color-mix(in srgb, var(--accent1) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--accent1) 25%, transparent);
        border-radius: 5px;
        color: var(--accent1);
        cursor: pointer;
        text-align: left;
        box-sizing: border-box;
    }
    .widget-menu-trigger:hover { background: color-mix(in srgb, var(--accent1) 18%, transparent); }

    /* L1 widget list */
    .cascade-l1 {
        margin-top: 4px;
        background: rgba(0,0,0,0.2);
        border: 1px solid var(--border-pale);
        border-radius: 5px;
        overflow: hidden;
    }

    .cascade-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 5px 6px;
        font-size: 11px;
        cursor: pointer;
        min-width: 0;
        overflow: hidden;
    }
    .cascade-item:hover   { background: rgba(255,255,255,0.05); }
    .cascade-item.active  { background: color-mix(in srgb, var(--accent1) 12%, transparent); }

    .cascade-name {
        flex: 1;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        font-size: 11px;
    }

    /* L2 event list — inline below the item */
    .cascade-l2 {
        border-left: 2px solid color-mix(in srgb, var(--accent1) 20%, transparent);
        margin: 0 6px 4px 22px;
        padding: 2px 0;
        overflow: hidden;
    }

    .cascade-ev {
        display: flex;
        align-items: center;
        gap: 5px;
        width: 100%;
        padding: 3px 6px;
        font-size: 11px;
        background: none;
        border: none;
        color: var(--text-dim);
        cursor: pointer;
        text-align: left;
        box-sizing: border-box;
        overflow: hidden;
        white-space: nowrap;
    }
    .cascade-ev:hover { background: color-mix(in srgb, var(--accent1) 15%, transparent); color: #fff; }

    .monaco-host { flex: 1; min-width: 0; height: 100%; }

    .script-error { padding: 12px; color: #ff5f57; font-size: 12px; }
    .script-hint  { padding: 16px; font-size: 12px; flex: 1; }
</style>
