<script lang="ts">
    import Icon from "@iconify/svelte";
    import { get } from 'svelte/store';
    import { onMount, onDestroy, untrack } from 'svelte';
    import { signals } from '../../stores/editorStore.js';
    import { updateAsset, currentProject, projectFilePath, currentProjectDir } from '../../stores/projectStore.js';
    import { createEditor, monaco } from '../../lib/monaco.js';
    import { electronAPI } from '../../lib/electron.js';
    import type { NyxBehavior, BehaviorType, NyxFieldSchema } from '@nyx/shared';
    import {
        CORE_EVENTS, EVENT_CATEGORIES,
        getEventDef, buildMethodStub, buildMethodBodySnippet,
    } from '@nyx/shared';

    interface Props { asset: NyxBehavior; }
    let { asset }: Props = $props();

    // ── Asset metadata state ──────────────────────────────────────────────────
    let behaviorType  = $state<BehaviorType>(untrack(() => asset.behaviorType));
    let specification = $state<NyxFieldSchema[]>(untrack(() => JSON.parse(JSON.stringify(asset.specification))));

    const FIELD_TYPES = ['number', 'text', 'boolean', 'color'] as const;

    // ── Script file state ─────────────────────────────────────────────────────
    let scriptContent    = $state('');
    let scriptError      = $state<string | null>(null);
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSavedContent = '';
    let prevUid = untrack(() => asset.uid);

    // ── Add-event picker state ────────────────────────────────────────────────
    let showPicker = $state(false);
    interface PendingEvent {
        lib: string; eventKey: string;
        def: (typeof CORE_EVENTS)[string];
        args: Record<string, unknown>;
    }
    let pickerPending = $state<PendingEvent | null>(null);

    // ── Monaco ────────────────────────────────────────────────────────────────
    let monacoEditor: ReturnType<typeof createEditor> | undefined;
    let editorEl = $state<HTMLElement | undefined>(undefined);
    let monacoModel: monaco.editor.ITextModel | undefined;

    // ── File I/O ──────────────────────────────────────────────────────────────
    function absScriptPath(): string | null {
        const fp  = asset.scriptPath;
        const dir = get(currentProjectDir);
        if (!fp || !dir) return null;
        return `${dir}/${fp.replace(/\\/g, '/')}`;
    }

    async function loadScript() {
        const abs = absScriptPath();
        if (!abs) {
            scriptError = asset.scriptPath ? 'Save the project to load this script.' : 'No script file assigned.';
            scriptContent = '';
            return;
        }
        try {
            const { content } = await electronAPI().file.readText(abs);
            if (content === lastSavedContent && lastSavedContent !== '') return;
            scriptContent = content;
            scriptError = null;
        } catch {
            scriptError = `Could not read: ${asset.scriptPath}`;
            scriptContent = '';
        }
    }

    function saveScriptDebounced() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            const abs = absScriptPath();
            if (!abs) return;
            const toSave = scriptContent;
            lastSavedContent = toSave;
            try {
                await electronAPI().file.writeText(abs, toSave);
                signals.emit('assetChanged');
            } catch (err) {
                console.error('[Nyx] Script save failed:', err);
                if (lastSavedContent === toSave) lastSavedContent = '';
            }
        }, 500);
    }

    function openInVSCode() {
        const dir = get(currentProjectDir);
        if (!dir) return;
        electronAPI().vscode.open(dir);
    }

    // ── Monaco lifecycle ──────────────────────────────────────────────────────
    $effect(() => {
        if (!editorEl || monacoEditor) return;
        monacoEditor = createEditor(editorEl, { language: 'typescript' });
        const uri   = monaco.Uri.parse(`file:///src/behaviors/${asset.uid}.ts`);
        monacoModel = monaco.editor.getModel(uri) ?? monaco.editor.createModel(scriptContent, 'typescript', uri);
        monacoModel.setValue(scriptContent);
        monacoEditor.setModel(monacoModel);
        monacoModel.onDidChangeContent(() => {
            scriptContent = monacoModel!.getValue();
            saveScriptDebounced();
        });
    });

    $effect(() => {
        if (!monacoModel) return;
        if (monacoModel.getValue() !== scriptContent) monacoModel.setValue(scriptContent);
    });

    $effect(() => {
        if (asset.uid === prevUid) return;
        prevUid          = asset.uid;
        lastSavedContent = '';
        behaviorType     = asset.behaviorType;
        specification = JSON.parse(JSON.stringify(asset.specification));

        monacoModel?.dispose();
        monacoModel = undefined;
        if (monacoEditor) {
            const uri = monaco.Uri.parse(`file:///src/behaviors/${asset.uid}.ts`);
            monacoModel = monaco.editor.createModel('', 'typescript', uri);
            monacoEditor.setModel(monacoModel);
            monacoModel.onDidChangeContent(() => {
                scriptContent = monacoModel!.getValue();
                saveScriptDebounced();
            });
        }
        loadScript();
    });

    $effect(() => { loadScript(); });

    onMount(() => {
        return electronAPI().script.onFileChanged(({ relativePath }) => {
            const normalized = relativePath.replace(/\\/g, '/');
            const assetPath  = (asset.scriptPath ?? '').replace(/\\/g, '/');
            if (normalized === assetPath) loadScript();
        });
    });

    onDestroy(() => {
        if (saveTimer !== undefined) {
            clearTimeout(saveTimer);
            const abs = absScriptPath();
            if (abs) electronAPI().file.writeText(abs, scriptContent);
        }
        monacoModel?.dispose();
        monacoEditor?.dispose();
    });

    // ── Persistence (metadata only) ───────────────────────────────────────────
    function persist() {
        updateAsset<NyxBehavior>(asset.uid, 'behavior', { behaviorType, specification });
        signals.emit('assetChanged');
    }

    function schedulePersist() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persist, 400);
    }

    // ── Derived ───────────────────────────────────────────────────────────────
    const projectActions = $derived($currentProject?.actions ?? []);

    const METHOD_KEYWORDS = new Set([
        'if','for','while','switch','catch','finally','else','try','do',
        'function','return','const','let','var','throw','case','default',
    ]);
    const detectedMethods = $derived((() => {
        const re = /^[ \t]*(?:async[ \t]+)?([a-zA-Z_$]\w*)[ \t]*\((?:[^)(]|\([^)]*\))*\)/gm;
        return [...scriptContent.matchAll(re)]
            .map(m => m[1])
            .filter(n => n !== 'constructor' && !METHOD_KEYWORDS.has(n));
    })());

    function pickerEventsForCategory(catKey: string) {
        return Object.entries(CORE_EVENTS).filter(([, def]) => {
            if (def.category !== catKey) return false;
            const entity: 'template' | 'room' = behaviorType === 'room' ? 'room' : 'template';
            if (!def.applicable.includes(entity) && !def.applicable.includes('behavior')) return false;
            return true;
        });
    }

    // ── Event insertion ───────────────────────────────────────────────────────
    function selectPickerEvent(lib: string, eventKey: string) {
        const def = getEventDef(lib, eventKey);
        if (!def) return;
        const defaults: Record<string, unknown> = {};
        if (def.args) {
            for (const [k, a] of Object.entries(def.args)) defaults[k] = a.default ?? '';
        }
        if (def.args && Object.keys(def.args).length > 0) {
            pickerPending = { lib, eventKey, def, args: defaults };
        } else {
            insertStub(lib, eventKey, {});
        }
    }

    function insertStub(lib: string, eventKey: string, args: Record<string, unknown>) {
        const def = getEventDef(lib, eventKey);
        if (!def) return;
        const stub = buildMethodStub(lib, eventKey, args);
        if (!stub) return;

        let src = patchEngineImport(scriptContent, stub);
        const methodExists = hasMethod(src, def.methodName);

        if (methodExists && def.repeatable) {
            const snippet = buildMethodBodySnippet(lib, eventKey, args);
            src = insertSnippetIntoMethod(src, def.methodName, snippet);
        } else if (methodExists) {
            scrollToMethod(def.methodName);
            pickerPending = null;
            showPicker = false;
            return;
        } else {
            const last = src.lastIndexOf('}');
            src = last === -1
                ? src + '\n\n' + stub + '\n'
                : src.slice(0, last).trimEnd() + '\n\n' + stub + '\n}\n';
        }

        scriptContent = src;
        monacoModel?.setValue(scriptContent);
        saveScriptDebounced();
        pickerPending = null;
        showPicker = false;
    }

    function hasMethod(content: string, methodName: string): boolean {
        return new RegExp(`^[ \\t]*(?:async[ \\t]+)?${methodName}[ \\t]*\\(`, 'm').test(content);
    }

    function insertSnippetIntoMethod(content: string, methodName: string, snippet: string): string {
        const startRe = new RegExp(`^([ \\t]*(?:async[ \\t]+)?${methodName}[ \\t]*\\((?:[^)(]|\\([^)]*\\))*\\)[^{]*\\{)`, 'm');
        const startMatch = startRe.exec(content);
        if (!startMatch || startMatch.index === undefined) return content;
        const openIdx = startMatch.index + startMatch[0].length - 1;
        let depth = 1, i = openIdx + 1;
        while (i < content.length && depth > 0) {
            if (content[i] === '{') depth++;
            else if (content[i] === '}') depth--;
            i++;
        }
        const closeIdx = i - 1;
        return content.slice(0, closeIdx) + '\n' + snippet + '\n' + content.slice(closeIdx);
    }

    function patchEngineImport(content: string, stub: string): string {
        const API = ['actions', 'rooms', 'sounds', 'textures', 'u'];
        const needed = API.filter(id => new RegExp(`\\b${id}\\b`).test(stub));
        if (needed.length === 0) return content;
        const re = /import\s*\{([^}]*)\}\s*from\s*['"]@nyx\/engine['"]/;
        const m  = content.match(re);
        if (m) {
            const existing = m[1].split(',').map(s => s.trim()).filter(Boolean);
            const toAdd    = needed.filter(id => !existing.includes(id));
            if (toAdd.length === 0) return content;
            return content.replace(re, `import { ${[...existing, ...toAdd].join(', ')} } from '@nyx/engine'`);
        }
        return `import { ${needed.join(', ')} } from '@nyx/engine';\n` + content;
    }

    function scrollToMethod(methodName: string) {
        if (!monacoEditor || !monacoModel) return;
        const matches = monacoModel.findMatches(`${methodName}(`, false, false, false, null, false);
        if (matches.length > 0) {
            monacoEditor.revealLineInCenter(matches[0].range.startLineNumber);
            monacoEditor.setPosition({ lineNumber: matches[0].range.startLineNumber, column: 1 });
            monacoEditor.focus();
        }
    }

    function addField() {
        specification = [...specification, { name: `field${specification.length + 1}`, type: 'number', default: 0 }];
        persist();
    }

    function removeField(i: number) {
        specification = specification.filter((_, idx) => idx !== i);
        persist();
    }
</script>

<div class="behavior-editor">
    <!-- ── Col 1: properties ── -->
    <div class="side-panel">
        <div class="panel-header">
            <h3 class="nm">{asset.name}</h3>
        </div>

        <div class="panel-body">
            <fieldset>
                <legend>Applies to</legend>
                <label class="radio">
                    <input type="radio" bind:group={behaviorType} value="template" onchange={persist} />
                    <span>Templates</span>
                </label>
                <label class="radio">
                    <input type="radio" bind:group={behaviorType} value="room" onchange={persist} />
                    <span>Rooms</span>
                </label>
            </fieldset>

            <fieldset>
                <legend>Custom fields ({specification.length})</legend>
                {#each specification as field, i}
                    <div class="field-row">
                        <input type="text" class="field-name" bind:value={field.name}
                               oninput={schedulePersist} placeholder="fieldName" spellcheck={false} />
                        <select bind:value={field.type} onchange={persist}>
                            {#each FIELD_TYPES as ft}
                                <option value={ft}>{ft}</option>
                            {/each}
                        </select>
                        <button class="inline square" title="Remove field" onclick={() => removeField(i)}>
                            <Icon icon="feather:x" class="feather"/>
                        </button>
                    </div>
                {/each}
                <button class="wide mt" onclick={addField}>
                    <Icon icon="feather:plus" class="feather"/>
                    <span>Add field</span>
                </button>
            </fieldset>
        </div>
    </div>

    <!-- ── Col 2: script methods ── -->
    <div class="events-col">
        <div class="events-header">
            <span class="events-title">Methods</span>
            <div class="picker-wrap">
                <button class="add-event-btn" title="Add event method"
                        onclick={(e) => { e.stopPropagation(); pickerPending = null; showPicker = !showPicker; }}>
                    <Icon icon="feather:plus" class="feather"/>
                </button>
                {#if showPicker}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <div class="picker-overlay" onclick={() => { showPicker = false; pickerPending = null; }}></div>
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <div class="picker-dropdown" onclick={(e) => e.stopPropagation()}>
                        {#if pickerPending}
                            <div class="picker-args">
                                <div class="picker-args-title dim small">{pickerPending.def.name}</div>
                                {#each Object.entries(pickerPending.def.args ?? {}) as [argKey, argDef]}
                                    <div class="arg-row">
                                        <label class="arg-label dim">{argDef.name}</label>
                                        {#if argDef.type === 'action'}
                                            <select class="arg-input"
                                                    value={String(pickerPending.args[argKey] ?? '')}
                                                    onchange={(e) => { pickerPending!.args = { ...pickerPending!.args, [argKey]: (e.target as HTMLSelectElement).value }; }}>
                                                <option value="">(none)</option>
                                                {#each projectActions as action}
                                                    <option value={action.name}>{action.name}</option>
                                                {/each}
                                            </select>
                                        {:else}
                                            <input type="text" class="arg-input"
                                                   value={String(pickerPending.args[argKey] ?? '')}
                                                   oninput={(e) => { pickerPending!.args = { ...pickerPending!.args, [argKey]: (e.target as HTMLInputElement).value }; }} />
                                        {/if}
                                    </div>
                                {/each}
                                <div class="picker-args-actions">
                                    <button class="picker-insert-btn"
                                            onclick={() => insertStub(pickerPending!.lib, pickerPending!.eventKey, pickerPending!.args)}>
                                        Insert
                                    </button>
                                    <button class="picker-insert-btn secondary"
                                            onclick={() => pickerPending = null}>
                                        Back
                                    </button>
                                </div>
                            </div>
                        {:else}
                            {#each Object.entries(EVENT_CATEGORIES) as [catKey, cat]}
                                {@const catEvents = pickerEventsForCategory(catKey)}
                                {#if catEvents.length > 0}
                                    <div class="picker-cat">
                                        <Icon icon="feather:{cat.icon}" class="feather cat-icon"/>
                                        {cat.name}
                                    </div>
                                    {#each catEvents as [fullKey, def]}
                                        {@const [lib, eventKey] = [fullKey.split('_')[0], fullKey.split('_').slice(1).join('_')]}
                                        <button class="picker-item"
                                                onclick={() => selectPickerEvent(lib, eventKey)}>
                                            <Icon icon="feather:{def.icon}" class="feather"/>
                                            {def.name}
                                        </button>
                                    {/each}
                                {/if}
                            {/each}
                        {/if}
                    </div>
                {/if}
            </div>
        </div>

        {#if asset.scriptPath}
            <div class="script-path dim small">{asset.scriptPath}</div>
        {/if}

        <div class="events-list">
            {#each detectedMethods as method}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div class="event-item" onclick={() => scrollToMethod(method)}>
                    <Icon icon="feather:code" class="feather ev-icon"/>
                    <span class="event-name">{method}</span>
                </div>
            {/each}
            {#if detectedMethods.length === 0 && !scriptError}
                <p class="dim small pad">No methods detected. Click + to add.</p>
            {/if}
            {#if scriptError}
                <p class="dim small pad">{scriptError}</p>
            {/if}
        </div>
    </div>

    <!-- ── Col 3: Monaco (full .ts file) ── -->
    <div class="code-panel">
        <div class="code-header dim small">
            <Icon icon="feather:file-text" class="feather"/>
            <span class="code-path">{asset.scriptPath || 'No script file'}</span>
            <button class="inline square vscode-btn" title="Open project in VS Code" onclick={openInVSCode}>
                <Icon icon="feather:external-link" class="feather"/>
            </button>
        </div>
        {#if scriptError && !scriptContent}
            <div class="script-error">{scriptError}</div>
        {:else}
            <div bind:this={editorEl} class="code-area"></div>
        {/if}
    </div>
</div>

<style>
    .behavior-editor {
        display: flex; flex-flow: row nowrap;
        width: 100%; height: 100%; overflow: hidden;
        background: var(--background-deeper, #111122);
    }

    .side-panel {
        flex: 0 0 220px; border-right: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e); display: flex; flex-direction: column; overflow: hidden;
    }

    .panel-header { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }
    h3 { font-size: 0.9rem; margin: 0; }
    .nm { margin: 0; }
    .panel-body { flex: 1 1 auto; overflow-y: auto; padding: 0.75rem; }

    fieldset { border: 1px solid var(--border-pale, #2a2a3e); border-radius: 4px; padding: 0.5rem 0.75rem; margin: 0 0 0.75rem; }
    legend { font-size: 0.78rem; color: var(--text-dim, #888); padding: 0 0.25rem; }

    label.radio { display: flex; align-items: center; gap: 0.4rem; margin: 0.25rem 0; font-size: 0.85rem; cursor: pointer; }

    .field-row { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem; }
    .field-name {
        flex: 1 1 auto; background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333); border-radius: 3px;
        color: var(--text, #e0e0e0); padding: 0.2rem 0.4rem; font-size: 0.8rem; font-family: monospace;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }
    select {
        flex: 0 0 76px; background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333); border-radius: 3px;
        color: var(--text, #e0e0e0); padding: 0.2rem 0.3rem; font-size: 0.78rem;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }
    .wide { width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.35rem; }
    .mt   { margin-top: 0.5rem; }

    /* ── Col 2 ── */
    .events-col {
        flex: 0 0 190px; background: var(--background, #1a1a2e);
        border-right: 1px solid var(--border-bright, #333); display: flex; flex-direction: column; overflow: hidden;
    }
    .events-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0.4rem 0.5rem 0.4rem 0.75rem;
        border-bottom: 1px solid var(--border-bright, #333); flex-shrink: 0;
    }
    .events-title { font-size: 0.78rem; color: var(--text-dim, #888); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

    .script-path {
        padding: 0.25rem 0.6rem; font-size: 0.68rem; font-family: monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        border-bottom: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0;
    }

    .picker-wrap { position: relative; }
    .add-event-btn {
        background: transparent; border: 1px solid var(--border-bright, #333); border-radius: 3px;
        color: var(--text-dim, #888); cursor: pointer; width: 1.4rem; height: 1.4rem;
        display: flex; align-items: center; justify-content: center; padding: 0; transition: all 0.12s;
        &:hover { background: var(--act, #1e2233); color: var(--acttext, #7ec8e3); border-color: var(--acttext, #7ec8e3); }
        :global(svg.feather) { width: 0.8rem; height: 0.8rem; }
    }
    .picker-overlay { position: fixed; inset: 0; z-index: 99; }
    .picker-dropdown {
        position: absolute; top: calc(100% + 4px); right: 0; z-index: 100;
        min-width: 190px; max-height: 340px; overflow-y: auto;
        background: var(--background, #1a1a2e); border: 1px solid var(--border-bright, #333);
        border-radius: 4px; box-shadow: 0 4px 16px rgba(0,0,0,0.5); padding: 0.25rem 0;
    }
    .picker-cat {
        display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.6rem 0.15rem;
        font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--text-dim, #888); border-top: 1px solid var(--border-pale, #2a2a3e); margin-top: 0.2rem;
        &:first-child { border-top: none; margin-top: 0; }
        :global(svg.feather.cat-icon) { width: 0.7rem; height: 0.7rem; }
    }
    .picker-item {
        display: flex; align-items: center; gap: 0.4rem; width: 100%; padding: 0.25rem 0.75rem;
        background: transparent; border: none; color: var(--text, #e0e0e0); font-size: 0.8rem; cursor: pointer; text-align: left;
        :global(svg.feather) { width: 0.75rem; height: 0.75rem; flex-shrink: 0; }
        &:hover { background: var(--act, #1e2233); color: var(--acttext, #7ec8e3); }
    }
    .picker-args { padding: 0.5rem 0.75rem; }
    .picker-args-title { margin-bottom: 0.5rem; display: block; }
    .picker-args-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
    .picker-insert-btn {
        flex: 1; padding: 0.2rem 0.4rem; font-size: 0.78rem; cursor: pointer;
        background: var(--accent1, #446adb); border: none; border-radius: 3px; color: #fff;
        &:hover { opacity: 0.85; }
        &.secondary { background: var(--background-deeper, #111122); border: 1px solid var(--border-bright, #333); color: var(--text-dim, #888); }
    }

    .events-list { flex: 1 1 auto; overflow-y: auto; padding: 0.25rem 0; }
    .event-item {
        display: flex; align-items: center; gap: 0.35rem; padding: 0.3rem 0.4rem 0.3rem 0.6rem;
        cursor: pointer; font-size: 0.8rem; color: var(--text-dim, #888); border-left: 2px solid transparent; transition: all 0.1s;
        &:hover { background: var(--act, #1e2233); color: var(--text, #e0e0e0); }
        :global(svg.feather.ev-icon) { width: 0.75rem; height: 0.75rem; flex-shrink: 0; }
    }
    .event-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 0.78rem; }

    .arg-row { display: flex; flex-direction: column; gap: 0.2rem; margin-bottom: 0.4rem; }
    .arg-label { font-size: 0.72rem; }
    .arg-input { width: 100%; box-sizing: border-box; }

    .dim   { color: var(--text-dim, #888); }
    .small { font-size: 0.78rem; }
    .pad   { padding: 0.5rem 0.75rem; }

    input[type="text"] {
        background: var(--background-deeper, #111122); border: 1px solid var(--border-bright, #333);
        border-radius: 3px; color: var(--text, #e0e0e0); padding: 0.2rem 0.3rem; font-size: 0.8rem;
        width: 100%; box-sizing: border-box;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    /* ── Col 3 ── */
    .code-panel { flex: 1 1 auto; display: flex; flex-direction: column; overflow: hidden; }
    .code-header {
        flex-shrink: 0; display: flex; align-items: center; gap: 0.4rem;
        padding: 0.3rem 0.75rem; border-bottom: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e); font-family: monospace;
        :global(svg.feather) { width: 0.75rem; height: 0.75rem; }
    }
    .code-area { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }
    .code-path { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vscode-btn { margin-left: auto; flex-shrink: 0; }
    .script-error {
        flex: 1 1 auto; display: flex; align-items: center; justify-content: center;
        font-size: 0.82rem; color: var(--text-dim, #888); padding: 2rem; text-align: center;
    }

    button {
        cursor: pointer; background: var(--background, #1a1a2e); border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0); border-radius: 4px; padding: 0.25rem 0.5rem; font-size: 0.82rem;
        display: inline-flex; align-items: center; gap: 0.3rem; transition: all 0.12s;
        &.inline { background: transparent; border-color: transparent; }
        &.square  { width: 1.5rem; height: 1.5rem; padding: 0; justify-content: center; }
        &:hover   { background: var(--act, #1e2233); border-color: var(--acttext, #7ec8e3); color: var(--acttext, #7ec8e3); }
        &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        :global(svg.feather) { width: 0.82rem; height: 0.82rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }
</style>
