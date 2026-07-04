<script lang="ts">
    /**
     * App.svelte — Root component.
     * Mirrors legacy root-tag.tag behavior:
     *   - Shows ProjectSelector when no project is open
     *   - Shows AppView when a project is loaded
     *
     * Phase 3: real ProjectSelector and AppView components wired in.
     */
    import type { Component } from 'svelte';
    import { projectOpened } from './stores/projectStore.js';
    import ProjectSelector from './components/ProjectSelector.svelte';
    import { TooltipLayer } from '@nyx/ui-kit';
    import { uiTheme, codeFontFamily } from './stores/themeStore.js';

    // AppView (and its entire dependency chain — Monaco, PIXI, all editors) is
    // lazy-loaded the first time a project is opened. This keeps the project
    // selector screen free of the ~10 MB Monaco bundle and its TypeScript worker.
    let AppView = $state<Component | null>(null);

    $effect(() => {
        if ($projectOpened && !AppView) {
            import('./components/AppView.svelte').then(m => { AppView = m.default; });
        }
    });

    $effect(() => {
        document.getElementById('nyx-root')?.setAttribute('data-theme', $uiTheme);
    });

    $effect(() => {
        const root = document.documentElement;
        if ($codeFontFamily) {
            root.style.setProperty('--code-font', $codeFontFamily);
        } else {
            root.style.removeProperty('--code-font');
        }
    });
</script>

<div id="nyx-root">
    {#if $projectOpened && AppView}
        <svelte:component this={AppView} />
    {:else if !$projectOpened}
        <ProjectSelector />
    {/if}
</div>

<!-- Global tooltip layer — mounted once, reads activeTooltip store -->
<TooltipLayer />

<style>
    #nyx-root {
        display: flex;
        flex-direction: column;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        background: #1a1a2e;
        color: #e0e0e0;
        font-family: sans-serif;
    }
</style>
