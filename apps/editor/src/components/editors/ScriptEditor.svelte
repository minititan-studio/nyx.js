<script lang="ts">
    import { onDestroy } from 'svelte';
    import { signals } from '../../stores/editorStore.js';
    import { updateAsset } from '../../stores/projectStore.js';
    import { createEditor, monaco } from '../../lib/monaco.js';
    import type { NyxScript, ScriptLanguage } from '@nyx/shared';

    interface Props { asset: NyxScript; }
    let { asset }: Props = $props();

    let editorEl: HTMLElement;
    let lineCount = $state(1);

    // Holds the live Monaco instance and debounce handle.
    // Not reactive state — we manage lifecycle manually.
    let monacoEditor: ReturnType<typeof createEditor> | undefined;
    let codeTimer: ReturnType<typeof setTimeout> | undefined;
    let prevUid = asset.uid;

    function persist() {
        if (!monacoEditor) return;
        const code     = monacoEditor.getValue();
        const language = (monacoEditor.getModel()?.getLanguageId() ?? 'javascript') as ScriptLanguage;
        updateAsset<NyxScript>(asset.uid, 'script', { code, language });
        signals.emit('assetChanged');
    }

    function schedulePersist() {
        clearTimeout(codeTimer);
        codeTimer = setTimeout(persist, 400);
    }

    // Create the editor once the DOM element is bound.
    $effect(() => {
        if (!editorEl || monacoEditor) return;

        monacoEditor = createEditor(editorEl, {
            value:    asset.code,
            language: asset.language,
        });

        lineCount = monacoEditor.getModel()?.getLineCount() ?? 1;

        monacoEditor.onDidChangeModelContent(() => {
            lineCount = monacoEditor!.getModel()?.getLineCount() ?? 1;
            schedulePersist();
        });
    });

    // When a different asset is loaded into this editor slot, swap the model
    // content without destroying and recreating the editor — avoids a layout
    // flash and preserves undo history isolation via a new model per asset.
    $effect(() => {
        if (!monacoEditor || asset.uid === prevUid) return;
        prevUid = asset.uid;

        const oldModel = monacoEditor.getModel();
        oldModel?.dispose();

        const newModel = monaco.editor.createModel(asset.code, asset.language);
        monacoEditor.setModel(newModel);
        lineCount = newModel.getLineCount();

        newModel.onDidChangeContent(() => {
            lineCount = monacoEditor!.getModel()?.getLineCount() ?? 1;
            schedulePersist();
        });
    });

    function onLanguageChange(e: Event) {
        const lang = (e.target as HTMLSelectElement).value as ScriptLanguage;
        const model = monacoEditor?.getModel();
        if (model) {
            monaco.editor.setModelLanguage(model, lang);
        }
        // Persist immediately — language is metadata, not debounced.
        clearTimeout(codeTimer);
        persist();
    }

    onDestroy(() => {
        clearTimeout(codeTimer);
        monacoEditor?.getModel()?.dispose();
        monacoEditor?.dispose();
    });

    const LANG_LABELS: Record<ScriptLanguage, string> = {
        javascript:   'JavaScript',
        coffeescript: 'CoffeeScript',
    };
</script>

<div class="script-editor">
    <!-- ── Toolbar ── -->
    <div class="toolbar flexrow nogrow">
        <h2 class="nm grow">{asset.name}</h2>

        <label class="dim small">Language:</label>
        <select value={asset.language} onchange={onLanguageChange}>
            {#each Object.entries(LANG_LABELS) as [val, label]}
                <option value={val}>{label}</option>
            {/each}
        </select>
    </div>

    <!-- ── Monaco editor area ── -->
    <div bind:this={editorEl} class="code-area"></div>

    <!-- ── Status bar ── -->
    <div class="status-bar nogrow">
        <span class="dim ml">{lineCount} lines</span>
    </div>
</div>

<style>
    .script-editor {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--background-deeper, #111122);
    }

    .toolbar {
        padding: 0.4rem 0.75rem;
        border-bottom: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        gap: 0.5rem;
        align-items: center;
        flex-shrink: 0;
    }

    .flexrow { display: flex; flex-flow: row nowrap; align-items: center; }
    .nogrow  { flex: 0 0 auto; }
    .grow    { flex: 1 1 auto; }
    .nm      { margin: 0; }

    h2 { font-size: 0.95rem; }

    label.small { font-size: 0.8rem; }

    select {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.4rem;
        font-size: 0.82rem;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .code-area {
        flex: 1 1 auto;
        width: 100%;
        min-height: 0;
        /* Monaco measures this container — it must not be 0px tall */
        position: relative;
    }

    .status-bar {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.2rem 0.75rem;
        font-size: 0.75rem;
        background: var(--background, #1a1a2e);
        border-top: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    .dim { color: var(--text-dim, #888); }
    .ml  { margin-left: auto; }
</style>
