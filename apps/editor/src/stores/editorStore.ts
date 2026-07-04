import mitt from 'mitt';
import { writable } from 'svelte/store';
import type { NyxAsset } from '@nyx/shared';

// ─── Theme ───────────────────────────────────────────────────────────────────

export const THEMES = [
    'Alma Sakura',
    'Day',
    'Forest',
    'Ghost',
    'Golden Eye',
    'HC Black',
    'Horizon',
    'Lucas Dracula',
    'Night',
    'Nord',
    'One Dark Pro',
    'Pooxel Blue',
    'Pooxel Green',
    'Rose Pine',
    'Rose Pine Dawn',
    'Rose Pine Moon',
    'Spring Stream',
    'Synthwave',
    'Teracat',
] as const;

export type ThemeName = typeof THEMES[number];

const _editorSettings = window.electronAPI.settings.getAll();

export const currentTheme = writable<ThemeName>(
    (_editorSettings['nyx-theme'] as ThemeName) ?? 'Night'
);

currentTheme.subscribe((t: ThemeName) => {
    document.documentElement.setAttribute('data-theme', t);
    void window.electronAPI.settings.set('nyx-theme', t);
});

/**
 * Typed pub/sub event bus — replaces legacy window.signals + window.orders.
 *
 * Emit:   signals.emit('eventName', payload)
 * Listen: signals.on('eventName', handler)
 * Remove: signals.off('eventName', handler)
 */
type EditorEvents = {
    projectLoaded: void;
    resetAll: void;
    saveProject: void;
    projectSaved: void;
    assetChanged: void;
    assetRemoved: string;                         // asset uid
    globalTabChanged: string | NyxAsset;
    assetBrowserPinChanged: void;
    codeFontUpdated: void;
    specialFontUpdated: void;
    openAsset: string | NyxAsset;
    openAssets: (string | NyxAsset)[];
    openActions: void;
    nyxModAdded: string;     // module name
    nyxModRemoved: string;   // module name
    // ── Hotkey-driven actions ────────────────────────────────────────────
    /** Undo the last action in the active editor context. */
    undo: void;
    /** Redo the last undone action in the active editor context. */
    redo: void;
    /** Open the "new asset" dialog in the current context. */
    newAsset: void;
    /** Close the active modal / deselect the active selection. */
    closeModal: void;
};

export const signals = mitt<EditorEvents>();

/**
 * Currently open asset tabs — replaces legacy window.openedAssets.
 * Ordered list; index determines Ctrl+3..Ctrl+10 hotkey assignment.
 */
export const openedAssets = writable<NyxAsset[]>([]);

/**
 * Active tab identifier.
 * String values: 'assets' | 'project' | 'menu' | 'debug' | 'patrons'
 * Object value: a NyxAsset reference (when an asset editor is active)
 */
export const activeTab = writable<string | NyxAsset>('assets');

/**
 * Per-tab dirty (unsaved) flags, indexed in sync with openedAssets.
 */
export const tabsDirty = writable<boolean[]>([]);

/**
 * When a sub-editor within an asset tab is actively editing a *different* asset
 * (e.g. the room editor's UI tab edits a NyxUILayer), it sets this to the uid of
 * that asset so Ctrl+Z/Ctrl+Y undo the correct stack instead of the parent tab.
 * Must be cleared (set to null) when the sub-editor loses focus or unmounts.
 */
export const undoTargetOverride = writable<string | null>(null);

/**
 * Whether the asset browser side panel is pinned.
 * Persisted to userData editor-settings.json key 'pinAssetBrowser'.
 */
export const assetBrowserPinned = writable<boolean>(
    _editorSettings['pinAssetBrowser'] === 'on'
);

assetBrowserPinned.subscribe(val => {
    void window.electronAPI.settings.set('pinAssetBrowser', val ? 'on' : 'off');
    signals.emit('assetBrowserPinChanged');
});
