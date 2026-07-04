<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * ContextMenu.svelte
     * Migrated from: src/riotTags/shared/context-menu.tag
     *
     * Generic popup context menu. Renders at (x,y), auto-constrained to viewport.
     * Closes on outside pointer-down or Escape.
     */
    import { onMount } from 'svelte';

    export interface MenuItem {
        label?: string;
        icon?: string;
        /** 'separator' renders a divider line */
        type?: 'separator';
        click?: () => void;
        disabled?: boolean;
    }

    interface Props {
        items: MenuItem[];
        x: number;
        y: number;
        onclose: () => void;
    }

    let { items, x, y, onclose }: Props = $props();

    let menuEl = $state<HTMLDivElement | undefined>(undefined);
    let posX = $state(0);
    let posY = $state(0);

    onMount(() => {
        if (!menuEl) return;
        const rect = menuEl.getBoundingClientRect();
        let nx = x;
        let ny = y;
        if (nx + rect.width  > window.innerWidth)  nx = window.innerWidth  - rect.width  - 4;
        if (ny + rect.height > window.innerHeight) ny = window.innerHeight - rect.height - 4;
        posX = Math.max(4, nx);
        posY = Math.max(4, ny);
        // Focus first enabled item for keyboard nav
        menuEl.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });

    $effect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') { e.stopPropagation(); onclose(); }
        }
        function onPointerDown(e: PointerEvent) {
            if (!menuEl?.contains(e.target as Node)) onclose();
        }
        document.addEventListener('keydown',    onKeyDown,    { capture: true });
        document.addEventListener('pointerdown', onPointerDown, { capture: true });
        return () => {
            document.removeEventListener('keydown',    onKeyDown,    true);
            document.removeEventListener('pointerdown', onPointerDown, true);
        };
    });

    function handleClick(item: MenuItem) {
        if (item.disabled || item.type === 'separator') return;
        onclose();
        item.click?.();
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={menuEl}
    class="context-menu"
    style="left:{posX}px;top:{posY}px"
    role="menu"
    tabindex="-1"
    oncontextmenu={(e) => e.preventDefault()}
>
    {#each items as item}
        {#if item.type === 'separator'}
            <hr class="cm-sep" />
        {:else}
            <button
                class="cm-item"
                role="menuitem"
                disabled={item.disabled}
                onclick={() => handleClick(item)}
            >
                {#if item.icon}
                    <Icon icon={`feather:${item.icon}`} class="feather"/>
                {/if}
                <span>{item.label ?? ''}</span>
            </button>
        {/if}
    {/each}
</div>

<style>
    .context-menu {
        position: fixed;
        z-index: 9999;
        background: var(--background-alt, #1c1c2e);
        border: 1px solid var(--border-bright, #444);
        border-radius: 4px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.55);
        padding: 3px 0;
        min-width: 11rem;
        font-size: 0.85rem;
        user-select: none;
    }

    .cm-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.3rem 0.85rem;
        background: none;
        border: none;
        border-radius: 0;
        color: var(--text, #ddd);
        cursor: pointer;
        text-align: left;
        font-size: 0.85rem;
        font-family: inherit;

        &:hover:not(:disabled) {
            background: var(--accent1-muted, rgba(68, 106, 219, 0.25));
            color: var(--accent1, #7b9ef0);
        }

        &:disabled {
            opacity: 0.4;
            cursor: default;
        }

        :global(svg.feather) {
            width: 0.9rem;
            height: 0.9rem;
            flex-shrink: 0;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
        }
    }

    .cm-sep {
        margin: 3px 0;
        border: none;
        border-top: 1px solid var(--border-bright, #444);
    }
</style>
