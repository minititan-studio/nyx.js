<script lang="ts">
    /**
     * TooltipLayer.svelte — Global floating tooltip overlay.
     * Ported from: legacy tooltips.ts (TooltipManager DOM layer)
     *
     * Mount once at the app root. Reads `activeTooltip` store and renders
     * a positioned tooltip div that mirrors the legacy `.tooltip` element.
     *
     * Positioning logic preserves legacy behavior:
     * - Horizontal (default): left or right of target, pointer vertically centered
     * - Vertical: above or below target, pointer horizontally centered
     * - Stays inside the viewport (5px padding)
     * - 10px gap between target and tooltip box
     */
    import { onMount, onDestroy } from 'svelte';
    import { activeTooltip, registerTooltipElement, mountTooltipManager, unmountTooltipManager } from '@nyx/shared';

    // Position computed from target element rect
    let tooltipDivEl = $state<HTMLDivElement | undefined>(undefined);

    let left = $state(0);
    let top = $state(0);
    let pointerLeft = $state<number | null>(null);
    let pointerTop = $state<number | null>(null);
    let placement = $state<'left' | 'right' | 'above' | 'below'>('right');

    const GAP = 10;
    const PADDING = 5;

    function reposition(target: HTMLElement, tooltipEl: HTMLElement): void {
        const targetRect  = target.getBoundingClientRect();
        const tooltipRect = tooltipEl.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const isVertical = $activeTooltip.position === 'vertical';

        if (isVertical) {
            // Try above first
            let placeAbove = true;
            let t = targetRect.top - tooltipRect.height - GAP;
            if (t < PADDING) {
                placeAbove = false;
                t = targetRect.bottom + GAP;
            }
            if (t + tooltipRect.height > vh - PADDING) {
                t = vh - tooltipRect.height - PADDING;
            }

            let l = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
            l = Math.max(PADDING, Math.min(l, vw - tooltipRect.width - PADDING));

            placement  = placeAbove ? 'above' : 'below';
            top        = isFinite(t) ? t : 0;
            left       = isFinite(l) ? l : 0;

            // Pointer: horizontally aligned with target center
            const targetCenterX = targetRect.left + targetRect.width / 2;
            const raw = targetCenterX - left - 6;
            pointerLeft = Math.min(tooltipRect.width - 6, Math.max(6, raw));
            pointerTop  = null;
        } else {
            // Horizontal: left or right of target
            const targetCenterX = targetRect.left + targetRect.width / 2;
            const placeLeft = targetCenterX > vw / 2;
            placement = placeLeft ? 'left' : 'right';

            let t = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
            t = Math.max(PADDING, Math.min(t, vh - tooltipRect.height - PADDING));

            let l: number;
            if (placeLeft) {
                l = targetRect.left - tooltipRect.width - GAP;
                if (l < PADDING) l = PADDING;
            } else {
                l = targetRect.right + GAP;
                if (l + tooltipRect.width > vw - PADDING) {
                    l = vw - tooltipRect.width - PADDING;
                }
            }

            top  = isFinite(t) ? t : 0;
            left = isFinite(l) ? l : 0;

            // Pointer: vertically aligned with target center
            const targetCenterY = targetRect.top + targetRect.height / 2;
            const raw = targetCenterY - top - 6;
            pointerTop  = Math.min(tooltipRect.height - 6, Math.max(6, raw));
            pointerLeft = null;
        }
    }

    // Re-run reposition whenever the store changes (new target or content update)
    $effect(() => {
        const state = $activeTooltip;
        if (!state.visible || !state.target || !tooltipDivEl) return;
        // Run in a microtask so the tooltip has rendered at its new size first
        requestAnimationFrame(() => {
            if (state.target && tooltipDivEl) {
                reposition(state.target, tooltipDivEl);
            }
        });
    });

    onMount(() => {
        mountTooltipManager();
    });

    onDestroy(() => {
        unmountTooltipManager();
        registerTooltipElement(null);
    });

    // Register/unregister the tooltip DOM element so the manager can detect
    // when the mouse is hovering over the tooltip itself.
    $effect(() => {
        registerTooltipElement(tooltipDivEl ?? null);
    });
</script>

{#if $activeTooltip.visible && $activeTooltip.text}
    <div
        bind:this={tooltipDivEl}
        class="tooltip tooltip--{placement}"
        class:tooltip--visible={$activeTooltip.visible}
        style:left="{left}px"
        style:top="{top}px"
        role="tooltip"
    >
        <div
            class="tooltip__pointer"
            style:left={pointerLeft !== null ? `${pointerLeft}px` : ''}
            style:top={pointerTop !== null ? `${pointerTop}px` : ''}
        ></div>
        <div class="tooltip__content">{$activeTooltip.text}</div>
    </div>
{/if}

<style>
    .tooltip {
        position: fixed;
        z-index: 99999;
        max-width: 280px;
        max-height: 50vh;
        overflow-y: auto;
        background: var(--background-deeper, #1a1a2e);
        color: var(--text, #e0e0e0);
        border: 1px solid var(--border-bright, #4a4a6a);
        border-radius: 4px;
        font-size: 12px;
        line-height: 1.4;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
        pointer-events: auto; /* hoverable — keeps tooltip visible */

        /* Fade transition controlled by .tooltip--visible class */
        opacity: 0;
        transition: opacity 0.15s ease;
    }

    .tooltip--visible {
        opacity: 1;
    }

    .tooltip__content {
        padding: 6px 10px;
        white-space: pre-wrap;
        word-break: break-word;
    }

    /* Triangular pointer */
    .tooltip__pointer {
        position: absolute;
        width: 0;
        height: 0;
    }

    /* Right of target → pointer points left (on the left edge of the tooltip) */
    .tooltip--right .tooltip__pointer {
        left: -6px;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-right: 6px solid var(--border-bright, #4a4a6a);
    }

    /* Left of target → pointer points right */
    .tooltip--left .tooltip__pointer {
        right: -6px;
        left: auto;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-left: 6px solid var(--border-bright, #4a4a6a);
    }

    /* Below target → pointer points up */
    .tooltip--below .tooltip__pointer {
        top: -6px;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 6px solid var(--border-bright, #4a4a6a);
    }

    /* Above target → pointer points down */
    .tooltip--above .tooltip__pointer {
        bottom: -6px;
        top: auto;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 6px solid var(--border-bright, #4a4a6a);
    }
</style>
