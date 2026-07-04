import { writable } from 'svelte/store';

// Read all settings once at module load (synchronous IPC, port-independent).
const _s = window.electronAPI.settings.getAll();

function settingsStore<T>(key: string, defaultVal: T) {
    const init: T = key in _s ? (_s[key] as T) : defaultVal;
    const store = writable<T>(init);
    store.subscribe(val => { void window.electronAPI.settings.set(key, val); });
    return store;
}

export const THEMES = [
    'AlmaSakura', 'Day', 'Forest', 'Ghost', 'GoldenEye',
    'HCBlack', 'Horizon', 'LucasDracula', 'Night', 'Nord',
    'OneDarkPro', 'PooxelBlue', 'PooxelGreen', 'RosePine',
    'RosePineDawn', 'RosePineMoon', 'SpringStream', 'Synthwave', 'Teracat'
] as const;

export type ThemeName = typeof THEMES[number];

export const CODE_FONTS = [
    { label: 'Default',    value: '' },
    { label: 'Pooxel (Basis)', value: 'Basis, monospace' },
    { label: 'Old School', value: 'Monaco, Menlo, "Ubuntu Mono", Consolas, source-code-pro, monospace' },
    { label: 'System',     value: 'monospace' },
] as const;

export const uiTheme        = settingsStore<ThemeName>('UItheme', 'Night');
export const codeFontFamily = settingsStore<string>('fontFamily', '');
export const codeLigatures  = settingsStore<boolean>('codeLigatures', true);
export const codeDense      = settingsStore<boolean>('codeDense', false);
export const disableSounds  = settingsStore<boolean>('disableSounds', false);
export const debuggerMode   = settingsStore<'automatic' | 'split' | 'multiwindow'>('debuggerMode', 'automatic');
export const forceProdDebug = settingsStore<boolean>('forceProductionForDebug', false);
