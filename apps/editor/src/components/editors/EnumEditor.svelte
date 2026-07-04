<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * EnumEditor.svelte
     * Migrated from: editors/enum-editor.tag
     *
     * Edit a NyxEnum asset: list of string variant names.
     * Values must match /^[a-zA-Z][a-zA-Z0-9]*$/ (valid TS identifiers).
     */
    import { signals } from '../../stores/editorStore.js';
    import { updateAsset, currentProject } from '../../stores/projectStore.js';
    import type { NyxEnum } from '@nyx/shared';

    interface Props { asset: NyxEnum; }
    let { asset }: Props = $props();

    let values = $state<string[]>([...asset.values]);
    let nameInput = $state('');
    let inputEls = $state<HTMLInputElement[]>([]);
    let prevUid = asset.uid;
    let persistTimer: ReturnType<typeof setTimeout> | undefined;

    const VALID = /^[a-zA-Z][a-zA-Z0-9]*$/;

    function sanitize(v: string) {
        return v.replace(/[^a-zA-Z0-9]/g, '').replace(/^[^a-zA-Z]+/, '');
    }

    // Reset only when a different asset is loaded into this slot
    $effect(() => {
        if (asset.uid === prevUid) return;
        prevUid = asset.uid;
        values = [...asset.values];
    });

    function persist() {
        updateAsset<NyxEnum>(asset.uid, 'enum', { values });
        signals.emit('assetChanged');
    }

    function addVariant() {
        let base = 'Variant';
        let n = values.length + 1;
        while (values.includes(`${base}${n}`)) n++;
        values = [...values, `${base}${n}`];
        persist();
    }

    function removeVariant(i: number) {
        values = values.filter((_, idx) => idx !== i);
        persist();
    }

    function onInput(e: Event, i: number) {
        const raw = (e.target as HTMLInputElement).value;
        const clean = sanitize(raw);
        values[i] = clean;
        (e.target as HTMLInputElement).value = clean;
        clearTimeout(persistTimer);
        persistTimer = setTimeout(persist, 300);
    }

    function onKeyUp(e: KeyboardEvent, i: number) {
        if (e.key === 'Enter') {
            addVariant();
            setTimeout(() => {
                const last = inputEls[inputEls.length - 1];
                if (last) { last.focus(); last.select(); }
            }, 0);
        }
    }

    function copyCode(v: string) {
        navigator.clipboard.writeText(`${asset.name}.${v}`);
    }

    /** Derive the TypeScript enum name (PascalCase, no spaces) */
    function tsName(n: string) {
        return n.replace(/[^a-zA-Z0-9]/g, '_').replace(/^[^a-zA-Z]+/, '') || 'Enum';
    }
</script>

<div class="enum-editor aView pad">
    <h1 class="nmt">{asset.name}</h1>

    <ul class="aStripedList">
        {#each values as value, i}
            <li class="enum-row">
                <input
                    type="text"
                    value={value}
                    pattern="[a-zA-Z][a-zA-Z0-9]*"
                    oninput={(e) => onInput(e, i)}
                    onkeyup={(e) => onKeyUp(e, i)}
                    bind:this={inputEls[i]}
                    spellcheck={false}
                />
                <code class="inline dim">{tsName(asset.name)}.{value}</code>
                <button class="inline square" title="Copy code" onclick={() => copyCode(value)}>
                    <Icon icon="feather:copy" class="feather"/>
                </button>
                <button class="inline square danger" title="Remove variant" onclick={() => removeVariant(i)}>
                    <Icon icon="feather:trash-2" class="feather"/>
                </button>
            </li>
        {/each}
    </ul>

    <button class="wide mt" onclick={addVariant}>
        <Icon icon="feather:plus" class="feather"/>
        <span>Add variant</span>
    </button>

    <p class="dim mt">
        Use <code>{tsName(asset.name)}.VariantName</code> in scripts to reference a variant.
    </p>

</div>

<style>
    .enum-editor {
        display: flex;
        flex-direction: column;
        height: 100%;
        box-sizing: border-box;
        overflow-y: auto;
    }

    h1 { font-size: 1.1rem; margin-bottom: 1rem; }

    .aStripedList {
        list-style: none;
        padding: 0; margin: 0;
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        overflow: hidden;
    }

    .enum-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.3rem 0.5rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        &:last-child { border-bottom: none; }
        &:nth-child(odd) { background: var(--background-deeper, #111122); }
    }

    input[type="text"] {
        flex: 0 0 160px;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.4rem;
        font-size: 0.85rem;
        font-family: monospace;
        &:focus { border-color: var(--accent1, #446adb); outline: none; }
    }

    code.inline {
        flex: 1 1 auto;
        font-size: 0.78rem;
        color: var(--text-dim, #888);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: monospace;
    }

    .mt { margin-top: 0.75rem; }

    .wide {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
    }

    .aSpacer { flex: 1 1 auto; min-height: 1rem; }

    .footer-actions {
        display: flex;
        justify-content: flex-end;
        padding-top: 1rem;
        border-top: 1px solid var(--border-pale, #2a2a3e);
        margin-top: 0.5rem;
    }

    p.dim { font-size: 0.8rem; color: var(--text-dim, #888); margin: 0.5rem 0 0; }
    code { font-family: monospace; font-size: 0.82em; }

    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.25rem 0.5rem;
        font-size: 0.85rem;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        transition: all 0.12s ease;
        &.inline { background: transparent; border-color: transparent; }
        &.square  { width: 1.6rem; height: 1.6rem; padding: 0; justify-content: center; }
        &.success { background: var(--success, #27ae60); border-color: var(--success, #27ae60); color: #fff; font-weight: 600; padding: 0.3rem 0.8rem; }
        &.danger  { &:hover { color: var(--danger, #e74c3c); border-color: var(--danger, #e74c3c); } }
        &:hover   { background: var(--act, #1e2233); border-color: var(--acttext, #7ec8e3); color: var(--acttext, #7ec8e3); }
        &.success:hover { background: #1e8449; border-color: #1e8449; color: #fff; }
        &.inline:hover  { background: var(--act, #1e2233); }
        :global(svg.feather) { width: 0.85rem; height: 0.85rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }
</style>
