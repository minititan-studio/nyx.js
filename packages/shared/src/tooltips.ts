/**
 * Tooltip system — ported from legacy tooltips.ts (TooltipManager class).
 *
 * The legacy system used a class with mount()/unmount() that listened to
 * mousemove on the document and found the deepest element with data-tooltip.
 * This port adapts that pattern for Svelte 5:
 *
 * - A writable store `activeTooltip` holds current tooltip state
 * - A Svelte action `tooltip(node, content)` sets data-tooltip on the element
 * - A global document mousemove listener (installed once) does the same
 *   "deepest element" search and updates the store with delays
 * - The store is read by TooltipLayer.svelte (mounted once in App root)
 *
 * Usage:
 *   <button use:tooltip={"Save project"}>Save</button>
 *
 * Or with position:
 *   <button use:tooltip={{ text: "Save project", position: "vertical" }}>Save</button>
 */

import { writable } from 'svelte/store';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TooltipState {
    visible: boolean;
    text: string;
    /** Target element — used to compute position in TooltipLayer */
    target: HTMLElement | null;
    position: 'horizontal' | 'vertical';
}

export type TooltipActionParam =
    | string
    | { text: string; position?: 'horizontal' | 'vertical' };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const activeTooltip = writable<TooltipState>({
    visible: false,
    text: '',
    target: null,
    position: 'horizontal',
});

// ---------------------------------------------------------------------------
// Global tooltip manager (singleton — mirrors legacy TooltipManager logic)
// ---------------------------------------------------------------------------

const SHOW_DELAY = 500;
const HIDE_DELAY = 250;

let activeElement: HTMLElement | null = null;
let tooltipEl: HTMLElement | null = null; // reference to the rendered tooltip DOM node
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let isVisible = false;
let listenerInstalled = false;

/** Called by TooltipLayer to register the tooltip DOM node so we can
 *  detect when the mouse is hovering over it (to keep it visible). */
export function registerTooltipElement(el: HTMLElement | null): void {
    tooltipEl = el;
}

function isMouseOverTooltip(x: number, y: number): boolean {
    if (!tooltipEl) return false;
    const elements = document.elementsFromPoint(x, y);
    return elements.includes(tooltipEl);
}

function getDeepestTooltipElement(x: number, y: number): HTMLElement | null {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
        if (el instanceof HTMLElement && el.hasAttribute('data-tooltip')) {
            return el;
        }
    }
    return null;
}

function showTooltip(target: HTMLElement): void {
    const text = target.getAttribute('data-tooltip') ?? '';
    const posAttr = target.getAttribute('data-tooltip-position');
    const position: 'horizontal' | 'vertical' =
        posAttr === 'vertical' ? 'vertical' : 'horizontal';
    isVisible = true;
    activeTooltip.set({ visible: true, text, target, position });
}

function hideTooltip(): void {
    isVisible = false;
    activeElement = null;
    activeTooltip.set({ visible: false, text: '', target: null, position: 'horizontal' });
}

function startShowTimer(target: HTMLElement): void {
    if (showTimer !== null) clearTimeout(showTimer);
    showTimer = setTimeout(() => {
        showTimer = null;
        if (activeElement === target) {
            showTooltip(target);
        }
    }, SHOW_DELAY);
}

function startHideTimer(): void {
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        hideTimer = null;
        hideTooltip();
    }, HIDE_DELAY);
}

function cancelShowTimer(): void {
    if (showTimer !== null) {
        clearTimeout(showTimer);
        showTimer = null;
    }
}

function cancelHideTimer(): void {
    if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
}

function onMouseMove(e: MouseEvent): void {
    // If mouse is over the tooltip itself — keep it alive
    if (isMouseOverTooltip(e.clientX, e.clientY)) {
        cancelHideTimer();
        return;
    }

    const deepest = getDeepestTooltipElement(e.clientX, e.clientY);

    if (deepest) {
        cancelHideTimer();

        if (activeElement !== deepest) {
            cancelShowTimer();
            activeElement = deepest;

            // Update content immediately (so it reflects the new element)
            const text = deepest.getAttribute('data-tooltip') ?? '';
            const posAttr = deepest.getAttribute('data-tooltip-position');
            const position: 'horizontal' | 'vertical' =
                posAttr === 'vertical' ? 'vertical' : 'horizontal';

            if (isVisible) {
                // Already visible — switch content and target immediately
                activeTooltip.set({ visible: true, text, target: deepest, position });
            } else {
                // Not visible — start the show delay
                startShowTimer(deepest);
            }
        } else if (isVisible) {
            // Same element, already visible — update target reference so
            // TooltipLayer can recompute position on each frame if needed.
            // We only need to nudge the store if target moved (it's fixed in
            // most cases), so do a lightweight update.
            activeTooltip.update((s: TooltipState) => ({ ...s, target: deepest }));
        }
    } else {
        // Nothing under mouse
        if (activeElement !== null) {
            startHideTimer();
        }
        cancelShowTimer();
    }
}

function onWindowScroll(): void {
    activeTooltip.update((s: TooltipState) => ({ ...s }));
}

function onWindowResize(): void {
    activeTooltip.update((s: TooltipState) => ({ ...s }));
}

/**
 * Install the global mousemove listener.
 * Called lazily the first time the `tooltip` action is used, or can be called
 * explicitly from App root via mountTooltipManager().
 */
export function mountTooltipManager(): void {
    if (listenerInstalled) return;
    listenerInstalled = true;
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('scroll', onWindowScroll, true);
    window.addEventListener('resize', onWindowResize);
}

/** Remove global listeners (call when the app is torn down). */
export function unmountTooltipManager(): void {
    if (!listenerInstalled) return;
    listenerInstalled = false;
    document.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('scroll', onWindowScroll, true);
    window.removeEventListener('resize', onWindowResize);
    cancelShowTimer();
    cancelHideTimer();
    hideTooltip();
}

// ---------------------------------------------------------------------------
// Svelte action
// ---------------------------------------------------------------------------

/**
 * Svelte use-directive that attaches tooltip content to any element.
 *
 * @example
 *   <button use:tooltip={"Save project"}>Save</button>
 *   <button use:tooltip={{ text: "Save project", position: "vertical" }}>Save</button>
 */
export function tooltip(
    node: HTMLElement,
    param: TooltipActionParam
): { update(p: TooltipActionParam): void; destroy(): void } {
    // Install the global listener lazily
    mountTooltipManager();

    function apply(p: TooltipActionParam): void {
        if (typeof p === 'string') {
            node.setAttribute('data-tooltip', p);
            node.removeAttribute('data-tooltip-position');
        } else {
            node.setAttribute('data-tooltip', p.text);
            if (p.position === 'vertical') {
                node.setAttribute('data-tooltip-position', 'vertical');
            } else {
                node.removeAttribute('data-tooltip-position');
            }
        }
    }

    apply(param);

    return {
        update(p: TooltipActionParam) {
            apply(p);
            // If this element is currently active, refresh the store content
            if (activeElement === node && isVisible) {
                const text = node.getAttribute('data-tooltip') ?? '';
                const posAttr = node.getAttribute('data-tooltip-position');
                const position: 'horizontal' | 'vertical' =
                    posAttr === 'vertical' ? 'vertical' : 'horizontal';
                activeTooltip.set({ visible: true, text, target: node, position });
            }
        },
        destroy() {
            node.removeAttribute('data-tooltip');
            node.removeAttribute('data-tooltip-position');
            // If the removed element was active, hide
            if (activeElement === node) {
                cancelShowTimer();
                cancelHideTimer();
                hideTooltip();
            }
        },
    };
}
