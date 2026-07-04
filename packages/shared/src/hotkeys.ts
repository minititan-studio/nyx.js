/**
 * hotkeys.ts — Editor hotkey registry
 *
 * Migrated from: src/node_requires/hotkeys.js (Nyx legacy)
 *
 * Key-combo format mirrors the legacy system:
 *   `Control+Alt+Meta+X`  (modifiers in that order, then the key)
 *
 *   - Letter keys: uppercase = Shift held, lowercase = no Shift
 *     e.g.  `s`         → just S
 *           `S`         → Shift+S
 *           `Control+s` → Ctrl+S
 *   - Non-letter keys use e.key directly: `Delete`, `Escape`, `F5`, etc.
 *
 * Scoping mirrors the legacy push/pop scope stack.  Handlers registered
 * with a scope string are only invoked while that scope is active on the
 * top of the stack.  Handlers registered without a scope are "global" and
 * fire whenever no more-specific scoped handler claims the event first.
 *
 * Usage:
 *   import { hotkeys } from '@nyx/shared';
 *
 *   // register
 *   hotkeys.on('Control+s', handler);
 *   hotkeys.on('Control+s', handler, 'roomEditor');
 *
 *   // scope management (e.g. when a modal opens/closes)
 *   hotkeys.push('roomEditor');
 *   hotkeys.pop();
 *
 *   // manual trigger
 *   hotkeys.trigger('Control+s');
 *
 *   // teardown
 *   hotkeys.off('Control+s', handler);
 *   hotkeys.unmount();  // removes the document keydown listener
 */

import { writable } from 'svelte/store';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A hotkey handler callback. Receives the original KeyboardEvent if fired
 *  from a real keydown event, or undefined when triggered programmatically. */
export type HotkeyHandler = (event?: KeyboardEvent) => void;

/** One registered binding. */
export interface HotkeyBinding {
    combo: string;
    scope: string | null;
    handler: HotkeyHandler;
}

/** Public shape of the observable store value. */
export interface HotkeyStoreState {
    bindings: ReadonlyArray<HotkeyBinding>;
    scopeStack: ReadonlyArray<string>;
}

// ─── Helpers (ported from legacy) ─────────────────────────────────────────────

/** Returns true for form fields where typing should not trigger shortcuts. */
function isFormField(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const name = el.nodeName.toLowerCase();
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    return (
        name === 'select' ||
        name === 'textarea' ||
        (name === 'input' &&
            type !== 'submit' &&
            type !== 'reset' &&
            type !== 'checkbox' &&
            type !== 'radio') ||
        el.isContentEditable
    );
}

/**
 * Derives the canonical combo string from a KeyboardEvent.
 *
 * Format: `Control+Alt+Meta+<key>`
 * For KeyA–KeyZ codes:
 *   - shiftKey → uppercase letter  (e.g. "S")
 *   - no shift → lowercase letter  (e.g. "s")
 * All other keys use e.key directly (e.g. "Delete", "Escape", "F5", "1").
 */
function comboFromEvent(e: KeyboardEvent): string {
    let letter: string;
    if (e.code.startsWith('Key')) {
        letter = e.shiftKey ? e.code.slice(3) : e.code.slice(3).toLowerCase();
    } else {
        letter = e.key;
    }
    return (
        (e.ctrlKey  ? 'Control+' : '') +
        (e.altKey   ? 'Alt+'     : '') +
        (e.metaKey  ? 'Meta+'    : '') +
        letter
    );
}

// ─── Hotkeys class ─────────────────────────────────────────────────────────────

class HotkeysRegistry {
    /** Scope stack — most recently pushed scope is at the end. */
    private scopeStack: string[] = [];

    /**
     * Binding store: combo → array of { scope, handler } entries.
     * Scope null means "global" (no scope restriction).
     */
    private bindings: Map<string, Array<{ scope: string | null; handler: HotkeyHandler }>> = new Map();

    /** The keydown listener added to document.body. */
    private readonly keydownListener: (e: KeyboardEvent) => void;

    constructor() {
        this.keydownListener = (e: KeyboardEvent) => {
            if (isFormField(e.target)) return;
            const combo = comboFromEvent(e);
            const prevented = this.dispatchCombo(combo, e);
            if (prevented) {
                e.preventDefault();
            }
        };
        if (typeof document !== 'undefined') {
            document.body.addEventListener('keydown', this.keydownListener);
        }
    }

    // ── Registration ────────────────────────────────────────────────────────

    /**
     * Register a handler for a combo, optionally scoped.
     *
     * @param combo   Key combo string, e.g. `Control+s`, `Delete`, `Escape`.
     * @param handler Callback to invoke.
     * @param scope   Optional scope name. If provided the handler only fires
     *                when this scope is active in the scope stack.
     */
    on(combo: string, handler: HotkeyHandler, scope: string | null = null): void {
        if (!this.bindings.has(combo)) {
            this.bindings.set(combo, []);
        }
        const list = this.bindings.get(combo)!;
        // Prevent duplicate registrations of the same handler+scope pair
        const isDuplicate = list.some(b => b.handler === handler && b.scope === scope);
        if (!isDuplicate) {
            list.push({ scope, handler });
        }
        notifyStore(this);
    }

    /**
     * Unregister a handler.
     *
     * @param combo   The combo the handler was registered under.
     * @param handler The exact handler function reference to remove.
     *                If omitted, ALL handlers for this combo are removed.
     * @param scope   Scope to match. If omitted, matches any scope.
     */
    off(combo: string, handler?: HotkeyHandler, scope?: string | null): void {
        const list = this.bindings.get(combo);
        if (!list) return;

        if (!handler) {
            // Clear all handlers for this combo
            this.bindings.set(combo, []);
        } else {
            const filtered = list.filter(b => {
                if (b.handler !== handler) return true;   // keep — different handler
                if (scope !== undefined && b.scope !== scope) return true;  // keep — different scope
                return false; // remove
            });
            this.bindings.set(combo, filtered);
        }
        notifyStore(this);
    }

    // ── Dispatch ────────────────────────────────────────────────────────────

    /**
     * Manually trigger all handlers registered for `combo`.
     * Mirrors legacy `hotkeys.trigger(code, event)`.
     *
     * @param combo The combo string to dispatch.
     * @param event The original KeyboardEvent, if available.
     * @returns true if at least one handler was called (so caller can preventDefault).
     */
    trigger(combo: string, event?: KeyboardEvent): boolean {
        return this.dispatchCombo(combo, event);
    }

    /**
     * Internal dispatch: walk scope stack (most recent first), then global.
     * Returns true if any handler was invoked.
     */
    private dispatchCombo(combo: string, event?: KeyboardEvent): boolean {
        const list = this.bindings.get(combo);
        if (!list || list.length === 0) return false;

        // Walk scope stack from most-recent to oldest
        if (this.scopeStack.length > 0) {
            for (let i = this.scopeStack.length - 1; i >= 0; i--) {
                const currentScope = this.scopeStack[i];
                const scoped = list.filter(b => b.scope === currentScope);
                if (scoped.length > 0) {
                    for (const b of scoped) {
                        b.handler(event);
                    }
                    return true;
                }
            }
        }

        // Fall through to global (scope === null) handlers
        const globals = list.filter(b => b.scope === null);
        if (globals.length > 0) {
            for (const b of globals) {
                b.handler(event);
            }
            return true;
        }

        return false;
    }

    // ── Scope management ────────────────────────────────────────────────────

    /** Returns the topmost scope key. */
    get scope(): string | undefined {
        return this.scopeStack[this.scopeStack.length - 1];
    }

    /** Replaces the entire scope stack. Accepts a space-separated string or an array. */
    set scope(val: string | string[]) {
        if (Array.isArray(val)) {
            this.scopeStack = [...val];
        } else {
            this.scopeStack = val.split(' ').filter(Boolean);
        }
        notifyStore(this);
    }

    /** Pushes a new scope onto the stack. */
    push(scope: string): void {
        this.scopeStack.push(scope);
        notifyStore(this);
    }

    /** Pops and returns the topmost scope. */
    pop(): string | undefined {
        const val = this.scopeStack.pop();
        notifyStore(this);
        return val;
    }

    /** Removes a specific scope key from anywhere in the stack. */
    remove(scope: string): boolean {
        const idx = this.scopeStack.indexOf(scope);
        if (idx === -1) return false;
        this.scopeStack.splice(idx, 1);
        notifyStore(this);
        return true;
    }

    /**
     * Truncates the stack at the given scope, removing it and all children
     * pushed after it — mirrors legacy `hotkeys.exit(scope)`.
     */
    exit(scope: string): boolean {
        const idx = this.scopeStack.indexOf(scope);
        if (idx === -1) return false;
        this.scopeStack.splice(idx, this.scopeStack.length - idx);
        notifyStore(this);
        return true;
    }

    /** Completely clears the scope stack. */
    cleanScope(): void {
        this.scopeStack.length = 0;
        notifyStore(this);
    }

    /** Returns whether the given scope is currently active in the stack. */
    inScope(scope: string): boolean {
        return this.scopeStack.includes(scope);
    }

    // ── Introspection ───────────────────────────────────────────────────────

    /** Returns all currently registered bindings as a flat array. */
    getBindings(): HotkeyBinding[] {
        const result: HotkeyBinding[] = [];
        for (const [combo, list] of this.bindings) {
            for (const { scope, handler } of list) {
                result.push({ combo, scope, handler });
            }
        }
        return result;
    }

    /** Returns a read-only copy of the current scope stack. */
    getScopeStack(): string[] {
        return [...this.scopeStack];
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    /** Removes the document keydown listener. Call on app teardown. */
    unmount(): void {
        if (typeof document !== 'undefined') {
            document.body.removeEventListener('keydown', this.keydownListener);
        }
    }
}

// ─── Singleton instance ───────────────────────────────────────────────────────

/** The global hotkey registry singleton. */
export const hotkeys = new HotkeysRegistry();

// ─── Observable Svelte store ───────────────────────────────────────────────────

/**
 * Svelte writable store that reflects the current state of the hotkey registry.
 * Components can subscribe to observe which shortcuts are active.
 *
 * The store is updated automatically whenever hotkeys are registered,
 * unregistered, or the scope changes.
 */
export const hotkeyStore = writable<HotkeyStoreState>({
    bindings: [],
    scopeStack: [],
});

/** Internal — called by HotkeysRegistry methods to push updates to the store. */
function notifyStore(registry: HotkeysRegistry): void {
    hotkeyStore.set({
        bindings: registry.getBindings(),
        scopeStack: registry.getScopeStack(),
    });
}
