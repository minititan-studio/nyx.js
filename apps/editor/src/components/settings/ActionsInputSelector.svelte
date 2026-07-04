<script lang="ts">
    import { onMount } from 'svelte';
    import Icon from "@iconify/svelte";
    /**
     * ActionsInputSelector.svelte
     * Migrated from: src/riotTags/project-settings/tabs/actions-input-selector.tag
     *
     * Modal overlay for selecting input methods from enabled catmods.
     * Shows a searchable checklist of all inputMethods from enabled modules.
     */
    import { availableNyxMods, enabledModuleNames, loadNyxMods } from '../../stores/nyxModStore.js';
    import type { NyxProjectAction } from '@nyx/shared/types/project.js';

    interface Props {
        action: NyxProjectAction;
        onApply: (codes: string[]) => void;
        onCancel: () => void;
    }

    let { action, onApply, onCancel }: Props = $props();

    onMount(() => { void loadNyxMods(); });

    let searchString = $state('');
    let selectedMethods = $state<string[]>([]);

    // Input providers = enabled catmods that expose inputMethods
    const inputProviders = $derived(
        $availableNyxMods
            .filter(m => $enabledModuleNames.has(m.name) && m.manifest.inputMethods)
            .map(m => ({
                name: m.manifest.main.name,
                code: m.name,
                methods: m.manifest.inputMethods as Record<string, string>,
            }))
    );

    function matchSearch(strings: string[]): boolean {
        if (!searchString.trim()) return true;
        const q = searchString.toLowerCase();
        return strings.some(s => s.toLowerCase().includes(q));
    }

    function toggleMethod(fullCode: string) {
        const idx = selectedMethods.indexOf(fullCode);
        if (idx > -1) {
            selectedMethods = selectedMethods.filter((_, i) => i !== idx);
        } else {
            selectedMethods = [...selectedMethods, fullCode];
        }
    }

    function isAlreadyAdded(fullCode: string): boolean {
        return action.methods.some(m => m.code === fullCode);
    }

    function applySelection() {
        onApply([...selectedMethods]);
        selectedMethods = [];
        searchString = '';
    }

    function cancelSelection() {
        selectedMethods = [];
        searchString = '';
        onCancel();
    }
</script>

<!-- ══ Actions Input Selector Modal ══════════════════════════════════════════ -->
<div class="aDimmer" role="dialog" aria-modal="true">
    <div class="aPanel flexfix input-selector">

        <!-- Search header -->
        <div class="flexfix-header">
            <div class="aSearchWrap wide">
                <input
                    class="wide"
                    type="text"
                    placeholder="Search inputs…"
                    bind:value={searchString}
                    autofocus
                />
                <Icon icon="feather:search" class="feather"/>
            </div>
        </div>

        <!-- Method list -->
        <div class="flexfix-body">
            {#if inputProviders.length === 0}
                <p class="dim pad">No input modules enabled. Enable keyboard, gamepad, or pointer from the Modules tab.</p>
            {:else}
                {#each inputProviders as provider}
                    {@const visibleMethods = Object.entries(provider.methods).filter(
                        ([code, name]) => matchSearch([name, code, provider.name])
                    )}
                    {#if visibleMethods.length > 0}
                        <h2 class="provider-heading">{provider.name}</h2>
                        {#each visibleMethods as [code, name]}
                            {@const fullCode = `${provider.code}.${code}`}
                            {@const alreadyAdded = isAlreadyAdded(fullCode)}
                            {@const isChecked = selectedMethods.includes(fullCode)}
                            <label
                                class="anActionMethod checkbox"
                                class:disabled={alreadyAdded}
                                title={alreadyAdded ? 'Already in this action' : ''}
                            >
                                <code class="inline toright">{fullCode}</code>
                                <input
                                    type="checkbox"
                                    checked={isChecked || alreadyAdded}
                                    disabled={alreadyAdded}
                                    onchange={() => toggleMethod(fullCode)}
                                />
                                <span>{name}</span>
                            </label>
                        {/each}
                    {/if}
                {/each}
            {/if}
        </div>

        <!-- Footer buttons -->
        <div class="flexfix-footer">
            <div class="flexrow">
                <button class="nml secondary" onclick={cancelSelection}>
                    Cancel
                </button>
                <button
                    class="nml"
                    disabled={selectedMethods.length === 0}
                    onclick={applySelection}
                >
                    Select {selectedMethods.length > 0 ? `(${selectedMethods.length})` : ''}
                </button>
            </div>
        </div>

    </div>
</div>


<style>
    .aDimmer {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
    }

    .input-selector {
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 6px;
        width: 28rem;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .flexfix-header {
        padding: 0.75rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    .flexfix-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 0.5rem 0;
    }

    .flexfix-footer {
        padding: 0.75rem;
        border-top: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    .provider-heading {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-dim, #888);
        padding: 0.5rem 0.75rem 0.2rem;
        margin: 0;
    }

    .anActionMethod {
        display: flex;
        flex-direction: row;
        align-items: center;
        padding: 0.25rem 0.75rem;
        gap: 0.5rem;
        cursor: pointer;
        font-size: 0.82rem;

        &:hover { background: var(--act, #1e2233); }

        &.disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        code.inline {
            flex: 0 0 auto;
            min-width: 9rem;
            font-size: 0.78rem;
            color: var(--text-dim, #aaa);
        }

        span { flex: 1 1 auto; }
    }

    .aSearchWrap {
        position: relative;
        display: flex;
        align-items: center;

        input { padding-right: 2rem; }

        :global(svg.feather) {
            position: absolute;
            right: 0.5rem;
            width: 1rem; height: 1rem;
            fill: none; stroke: var(--text-dim, #888);
            stroke-width: 2; pointer-events: none;
        }
    }

    .wide { width: 100%; }

    input[type="text"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        color: var(--text, #e0e0e0);
        padding: 0.3rem 0.5rem;
        font-size: 0.85rem;
        outline: none;
        &:focus { border-color: var(--accent1, #446adb); }
    }

    .flexrow { display: flex; flex-direction: row; gap: 0.5rem; justify-content: flex-end; }
    .pad { padding: 0.75rem; }
    .dim { color: var(--text-dim, #888); font-size: 0.85rem; }
</style>
