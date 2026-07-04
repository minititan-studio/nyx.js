import { get, writable, derived } from 'svelte/store';
import type { NyxMod, NyxModManifest } from '@nyx/plugin-api';
import { currentProject } from './projectStore.js';
import { signals } from './editorStore.js';
import { electronAPI } from '../lib/electron.js';

/**
 * Full list of nyxMods available on disk (built-ins bundled in resources/).
 * Populated once on first call to loadNyxMods().
 */
export const availableNyxMods = writable<NyxMod[]>([]);

/** True while the initial nyxMod list is being fetched from the main process. */
export const nyxModsLoading = writable<boolean>(false);

/**
 * Derived store — the set of currently enabled module names for the open project.
 * Reads directly from currentProject.modules so it stays in sync automatically.
 */
export const enabledModuleNames = derived(
    currentProject,
    ($project) => new Set($project ? Object.keys($project.modules) : [])
);

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Fetch all available nyxMods from the main process and populate availableNyxMods.
 * Safe to call multiple times — returns immediately if already loaded.
 */
export async function loadNyxMods(): Promise<void> {
    if (get(availableNyxMods).length > 0) return;
    nyxModsLoading.set(true);
    try {
        const list = await electronAPI().nyxmod.list();
        availableNyxMods.set(list);
    } finally {
        nyxModsLoading.set(false);
    }
}

// ── Enable / disable ──────────────────────────────────────────────────────────

/**
 * Enable a nyxMod for the current project.
 * Loads the manifest if not yet in availableNyxMods, then writes defaults
 * for any fields that have a `key` and a `default` value.
 *
 * Mirrors legacy: resources/modules/index.ts → enableModule()
 */
export async function enableModule(name: string): Promise<void> {
    const project = get(currentProject);
    if (!project) throw new Error('[nyxModStore] No project open');
    if (name in project.modules) return; // already enabled

    // Ensure manifest is loaded
    let nyxMod = get(availableNyxMods).find(m => m.name === name);
    if (!nyxMod) {
        nyxMod = await electronAPI().nyxmod.loadManifest(name);
        availableNyxMods.update(list => [...list, nyxMod!]);
    }

    const settings: Record<string, unknown> = {};
    applyDefaults(nyxMod.manifest, settings);

    currentProject.update(p => {
        if (!p) return p;
        return { ...p, modules: { ...p.modules, [name]: settings } };
    });

    signals.emit('nyxModAdded', name);
}

/**
 * Disable a nyxMod for the current project — removes it from project.modules.
 * Mirrors legacy: resources/modules/index.ts → disableModule()
 */
export function disableModule(name: string): void {
    const project = get(currentProject);
    if (!project) throw new Error('[nyxModStore] No project open');
    if (!(name in project.modules)) return; // already disabled

    currentProject.update(p => {
        if (!p) return p;
        const modules = { ...p.modules };
        delete modules[name];
        return { ...p, modules };
    });

    signals.emit('nyxModRemoved', name);
}

/**
 * Re-apply default field values for a nyxMod without overwriting existing settings.
 * Mirrors legacy: resources/modules/index.ts → addDefaults()
 */
export function reapplyNyxModDefaults(name: string): void {
    const nyxMod = get(availableNyxMods).find(m => m.name === name);
    if (!nyxMod) return;

    currentProject.update(p => {
        if (!p || !(name in p.modules)) return p;
        const settings = { ...p.modules[name] };
        applyDefaults(nyxMod.manifest, settings);
        return { ...p, modules: { ...p.modules, [name]: settings } };
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Write default values from a nyxmod's fields into a settings object,
 * but only for keys that are not already set.
 */
function applyDefaults(manifest: NyxModManifest, settings: Record<string, unknown>): void {
    for (const field of manifest.fields ?? []) {
        if (!field.key || field.key in settings) continue;
        if (field.default !== undefined) {
            settings[field.key] = field.default;
        } else if (field.type === 'number' || field.type === 'slider' || field.type === 'sliderAndNumber') {
            settings[field.key] = 0;
        } else if (field.type === 'checkbox') {
            settings[field.key] = false;
        } else {
            settings[field.key] = '';
        }
    }
}
