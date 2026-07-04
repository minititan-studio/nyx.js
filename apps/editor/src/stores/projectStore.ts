import { derived, get, writable } from 'svelte/store';
import type { AssetType, NyxAsset, NyxFolder, NyxProject, AnyNyxAsset, NyxProjectEntry } from '@nyx/shared';
import { electronAPI } from '../lib/electron.js';
import { openedAssets, activeTab } from './editorStore.js';
import {
    defaultTexture, defaultTemplate, defaultRoom, defaultSound,
    defaultFont, defaultStyle, defaultBehavior, defaultScript,
    defaultEnum, defaultEmitterTandem, defaultUILayer
} from '@nyx/shared';

/**
 * Whether a project is currently open.
 * Replaces legacy: window.projectOpened boolean + riot.update() calls.
 */
export const projectOpened = writable<boolean>(false);

/**
 * The currently loaded project object.
 * Replaces legacy: window.currentProject global.
 */
export const currentProject = writable<NyxProject | null>(null);

/** Open a project — sets both stores atomically. */
export function loadProject(project: NyxProject): void {
    currentProject.set(project);
    projectOpened.set(true);
}

/** Set of asset UIDs modified since the last save. */
export const dirtyAssetUids = writable<Set<string>>(new Set());

// ── Per-asset undo / redo history ─────────────────────────────────────────────

const MAX_UNDO_HISTORY = 100;

/** Previous states for undo, keyed by uid. Push = before edit, pop = undo. */
const assetUndoStacks = new Map<string, AnyNyxAsset[]>();
/** Re-applicable states for redo, keyed by uid. */
const assetRedoStacks = new Map<string, AnyNyxAsset[]>();
/** State of each asset when its tab was opened or last saved. Used by Discard. */
const assetBaselines  = new Map<string, AnyNyxAsset>();

function _pushUndo(uid: string, before: AnyNyxAsset): void {
    const stack = assetUndoStacks.get(uid);
    if (!stack) return; // only track assets that have an open tab
    stack.push(JSON.parse(JSON.stringify(before)) as AnyNyxAsset);
    if (stack.length > MAX_UNDO_HISTORY) stack.shift();
    assetRedoStacks.set(uid, []); // new edit invalidates redo
}

function _applySnapshot(snapshot: AnyNyxAsset): void {
    const type = snapshot.type as AssetType;
    currentProject.update(p => {
        if (!p) return p;
        const arr = p[TYPE_TO_ARRAY[type]] as AnyNyxAsset[];
        const idx = arr.findIndex(a => a.uid === snapshot.uid);
        if (idx === -1) return p;
        const newArr = [...arr];
        newArr[idx] = snapshot;
        syncToTree(p.assets, snapshot.uid, snapshot);
        return { ...p, [TYPE_TO_ARRAY[type]]: newArr };
    });
    openedAssets.update(list => list.map(a => a.uid === snapshot.uid ? snapshot : a));
    activeTab.update(tab =>
        typeof tab === 'object' && (tab as NyxAsset).uid === snapshot.uid ? snapshot : tab
    );
}

/**
 * Register an asset as having an open tab.
 * Snapshots its current state as the undo baseline and initialises empty stacks.
 */
export function snapshotAssetBaseline(asset: AnyNyxAsset): void {
    assetBaselines.set(asset.uid, JSON.parse(JSON.stringify(asset)) as AnyNyxAsset);
    assetUndoStacks.set(asset.uid, []);
    assetRedoStacks.set(asset.uid, []);
}

/** Undo the last change to an asset. Returns true if an undo was applied. */
export function undoAsset(uid: string): boolean {
    const undoStack = assetUndoStacks.get(uid);
    if (!undoStack || undoStack.length === 0) return false;
    const current = get(openedAssets).find(a => a.uid === uid);
    if (!current) return false;
    const prev = undoStack.pop()!;
    const redoStack = assetRedoStacks.get(uid) ?? [];
    redoStack.push(JSON.parse(JSON.stringify(current)) as AnyNyxAsset);
    assetRedoStacks.set(uid, redoStack);
    _applySnapshot(prev);
    const baseline = assetBaselines.get(uid);
    const clean = !!baseline && JSON.stringify(prev) === JSON.stringify(baseline);
    dirtyAssetUids.update(s => { clean ? s.delete(uid) : s.add(uid); return s; });
    return true;
}

/** Redo the last undone change. Returns true if a redo was applied. */
export function redoAsset(uid: string): boolean {
    const redoStack = assetRedoStacks.get(uid);
    if (!redoStack || redoStack.length === 0) return false;
    const current = get(openedAssets).find(a => a.uid === uid);
    if (!current) return false;
    const next = redoStack.pop()!;
    const undoStack = assetUndoStacks.get(uid) ?? [];
    undoStack.push(JSON.parse(JSON.stringify(current)) as AnyNyxAsset);
    assetUndoStacks.set(uid, undoStack);
    _applySnapshot(next);
    dirtyAssetUids.update(s => { s.add(uid); return s; });
    return true;
}

/** Revert an asset to its baseline (last save or tab-open). Clears history. */
export function discardAssetChanges(uid: string): void {
    const baseline = assetBaselines.get(uid);
    if (baseline) _applySnapshot(baseline);
    dirtyAssetUids.update(s => { s.delete(uid); return s; });
    clearAssetHistory(uid);
}

/** Remove all history for an asset. Call when its tab is closed. */
export function clearAssetHistory(uid: string): void {
    assetUndoStacks.delete(uid);
    assetRedoStacks.delete(uid);
    assetBaselines.delete(uid);
}

/** Reset to the project selector screen. */
export function closeProject(): void {
    currentProject.set(null);
    projectOpened.set(false);
    dirtyAssetUids.set(new Set());
    assetUndoStacks.clear();
    assetRedoStacks.clear();
    assetBaselines.clear();
}

// ── Asset type → project array key map ────────────────────────────────────────
const TYPE_TO_ARRAY: Record<AssetType, keyof NyxProject> = {
    texture:       'textures',
    template:      'templates',
    room:          'rooms',
    sound:         'sounds',
    font:          'fonts',
    style:         'styles',
    behavior:      'behaviors',
    script:        'scripts',
    enum:          'enums',
    emitterTandem: 'emitterTandems',
    uiLayer:       'uiLayers',
};

/**
 * Check whether a name is already taken for a given asset type.
 * Mirrors legacy resources.areTaken / resources.checkAssetName logic.
 */
export function isNameTaken(name: string, type: AssetType): boolean {
    const project = get(currentProject);
    if (!project) return false;
    const arr = project[TYPE_TO_ARRAY[type]] as NyxAsset[];
    return arr.some(a => a.name.toLowerCase() === name.toLowerCase());
}

/**
 * Create a new typed asset with type-specific defaults, add it to the project,
 * and return it. Optionally adds it inside a specific folder in the asset tree.
 *
 * Mirrors legacy: resources.createAsset(type, folder, payload)
 */
export function createAsset(
    type: AssetType,
    name: string,
    targetFolder: NyxFolder | null = null
): AnyNyxAsset {
    const project = get(currentProject);
    if (!project) throw new Error('[projectStore] No project is open');

    const uid = crypto.randomUUID();
    let asset: AnyNyxAsset;

    switch (type) {
        case 'texture':       asset = defaultTexture(uid, name); break;
        case 'template':      asset = defaultTemplate(uid, name); break;
        case 'room':          asset = defaultRoom(uid, name); break;
        case 'sound':         asset = defaultSound(uid, name); break;
        case 'font':          asset = defaultFont(uid, name); break;
        case 'style':         asset = defaultStyle(uid, name); break;
        case 'behavior':      asset = defaultBehavior(uid, name); break;
        case 'script':        asset = defaultScript(uid, name); break;
        case 'enum':          asset = defaultEnum(uid, name); break;
        case 'emitterTandem': asset = defaultEmitterTandem(uid, name); break;
        case 'uiLayer':       asset = defaultUILayer(uid, name); break;
    }

    currentProject.update(p => {
        if (!p) return p;
        // 1. Add to the flat typed array (used by exporter)
        (p[TYPE_TO_ARRAY[type]] as AnyNyxAsset[]).push(asset);
        // 2. Add to the asset tree (used by the browser)
        if (targetFolder) {
            targetFolder.entries.push(asset);
        } else {
            p.assets.push(asset);
        }
        return p;
    });

    return asset;
}

/**
 * Walk the project asset tree and replace the entry whose uid matches `uid`
 * with `next`. Recurses into NyxFolder.entries automatically.
 *
 * This must be called inside currentProject.update() so the store mutation
 * is atomic. Returns true when the entry was found and replaced.
 */
function syncToTree(entries: NyxProjectEntry[], uid: string, next: AnyNyxAsset): boolean {
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.type === 'folder') {
            if (syncToTree((e as NyxFolder).entries, uid, next)) return true;
        } else if ((e as NyxAsset).uid === uid) {
            entries[i] = next;
            return true;
        }
    }
    return false;
}

/**
 * Update fields on an existing asset in-place (by uid).
 * Triggers a project store update so all subscribers re-render.
 * Also syncs the new asset reference into:
 *   - p.assets (hierarchical tree) — critical for correct serialization
 *   - openedAssets + activeTab     — so open editors see updated props
 *
 * @param uid   UID of the asset to update.
 * @param type  Asset type (needed to locate the flat array).
 * @param patch Fields to merge into the asset.
 */
/**
 * Push the current state of an open asset onto its undo stack without making any changes.
 * Call this at the START of a multi-step drag so the whole drag collapses to one undo entry.
 */
export function pushAssetUndoSnapshot(uid: string): void {
    const stack = assetUndoStacks.get(uid);
    if (!stack) return;
    const current = get(openedAssets).find(a => a.uid === uid);
    if (!current) return;
    stack.push(JSON.parse(JSON.stringify(current)) as AnyNyxAsset);
    if (stack.length > MAX_UNDO_HISTORY) stack.shift();
    assetRedoStacks.set(uid, []);
}

/** Returns the number of available undo steps for an open asset tab. */
export function getUndoStackSize(uid: string): number {
    return assetUndoStacks.get(uid)?.length ?? 0;
}

/** Returns the number of available redo steps for an open asset tab. */
export function getRedoStackSize(uid: string): number {
    return assetRedoStacks.get(uid)?.length ?? 0;
}

export function updateAsset<T extends NyxAsset>(
    uid: string,
    type: AssetType,
    patch: Partial<Omit<T, 'uid' | 'type'>>,
    skipHistory = false
): void {
    let updated: T | null = null;

    currentProject.update(p => {
        if (!p) return p;
        const arr = p[TYPE_TO_ARRAY[type]] as unknown as T[];
        const idx = arr.findIndex(a => a.uid === uid);
        if (idx === -1) return p;
        if (!skipHistory) _pushUndo(uid, arr[idx] as unknown as AnyNyxAsset);
        updated = { ...arr[idx], ...patch, lastModified: Date.now() };
        // New array + new project object so Svelte 5 fine-grained reactivity
        // detects the change even when the array reference was previously stable.
        const newArr = [...arr] as T[];
        newArr[idx] = updated;
        syncToTree(p.assets, uid, updated as AnyNyxAsset);
        return { ...p, [TYPE_TO_ARRAY[type]]: newArr };
    });

    // Propagate the new asset reference into the open-tab stores so every
    // open editor receives the updated `asset` prop and re-renders.
    if (updated) {
        const next = updated as T;
        openedAssets.update(list => list.map(a => (a.uid === uid ? next : a)));
        activeTab.update(tab =>
            typeof tab === 'object' && (tab as NyxAsset).uid === uid ? next : tab
        );
        dirtyAssetUids.update(s => { s.add(uid); return s; });
    }
}

/**
 * Look up a typed asset by uid from the flat typed arrays.
 * Returns null if the asset is not found.
 */
export function getAssetByUid(uid: string, type: AssetType): AnyNyxAsset | null {
    const project = get(currentProject);
    if (!project) return null;
    const arr = project[TYPE_TO_ARRAY[type]] as AnyNyxAsset[];
    return arr.find(a => a.uid === uid) ?? null;
}

/**
 * Like createAsset(), but also scaffolds a TypeScript class file on disk for
 * template, behavior, and script assets. Returns a Promise that resolves once
 * the script file has been written and the asset's scriptPath is set.
 *
 * Use this instead of createAsset() when the user creates a new scripted asset.
 */
export async function createAssetWithScript(
    type: 'template' | 'behavior' | 'script' | 'uiLayer',
    name: string,
    targetFolder: NyxFolder | null = null,
): Promise<AnyNyxAsset> {
    const asset = createAsset(type, name, targetFolder);
    const filePath = get(projectFilePath);
    if (filePath) {
        const { scriptPath } = await electronAPI().script.create({
            assetType: type,
            name,
            projectFilePath: filePath,
        });
        updateAsset(asset.uid, type, { scriptPath } as Parameters<typeof updateAsset>[2]);
    }
    const arr = type === 'template' ? 'templates'
               : type === 'behavior' ? 'behaviors'
               : type === 'uiLayer'  ? 'uiLayers'
               : 'scripts';
    return get(currentProject)?.[arr]?.find((a: { uid: string }) => a.uid === asset.uid) ?? asset;
}

/**
 * Create a new folder in the asset tree.
 * Optionally nests it inside a parent folder.
 */
export function createFolder(
    name: string,
    parentFolder: NyxFolder | null = null
): NyxFolder {
    const project = get(currentProject);
    if (!project) throw new Error('[projectStore] No project is open');

    const folder: NyxFolder = {
        uid: crypto.randomUUID(),
        name,
        type: 'folder',
        entries: [],
    };

    currentProject.update(p => {
        if (!p) return p;
        if (parentFolder) {
            parentFolder.entries.push(folder);
        } else {
            p.assets.push(folder);
        }
        return p;
    });

    return folder;
}

// ── Tree helpers ─────────────────────────────────────────────────────────────

/** Remove the entry with the given uid from the tree (folders or assets). */
function removeFromTree(entries: NyxProjectEntry[], uid: string): boolean {
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.type === 'folder') {
            if (e.uid === uid) { entries.splice(i, 1); return true; }
            if (removeFromTree((e as NyxFolder).entries, uid)) return true;
        } else if ((e as NyxAsset).uid === uid) {
            entries.splice(i, 1); return true;
        }
    }
    return false;
}

/** Walk the tree to find an entry by uid. */
function findEntryByUid(entries: NyxProjectEntry[], uid: string): NyxProjectEntry | null {
    for (const e of entries) {
        if (e.uid === uid) return e;
        if (e.type === 'folder') {
            const found = findEntryByUid((e as NyxFolder).entries, uid);
            if (found) return found;
        }
    }
    return null;
}

/** Collect all typed assets inside a folder subtree. */
function collectAssetsFromFolder(folder: NyxFolder): Array<{ uid: string; type: AssetType }> {
    const result: Array<{ uid: string; type: AssetType }> = [];
    for (const e of folder.entries) {
        if (e.type === 'folder') {
            result.push(...collectAssetsFromFolder(e as NyxFolder));
        } else {
            result.push({ uid: (e as NyxAsset).uid, type: (e as NyxAsset).type as AssetType });
        }
    }
    return result;
}

// ── Asset deletion / rename ───────────────────────────────────────────────────

/**
 * Delete a single asset. Removes it from the flat typed array, the asset tree,
 * and any open editor tabs.
 */
export function deleteAsset(uid: string, type: AssetType): void {
    currentProject.update(p => {
        if (!p) return p;
        (p[TYPE_TO_ARRAY[type]] as AnyNyxAsset[]) =
            (p[TYPE_TO_ARRAY[type]] as AnyNyxAsset[]).filter(a => a.uid !== uid);
        removeFromTree(p.assets, uid);
        return p;
    });
    openedAssets.update(list => list.filter(a => a.uid !== uid));
    activeTab.update(tab => {
        if (typeof tab === 'object' && (tab as NyxAsset).uid === uid) {
            return get(openedAssets)[0] ?? 'assets';
        }
        return tab;
    });
}

/**
 * Rename a folder in the asset tree by uid.
 */
export function renameFolder(folderUid: string, newName: string): void {
    currentProject.update(p => {
        if (!p) return p;
        const entry = findEntryByUid(p.assets, folderUid);
        if (entry?.type === 'folder') (entry as NyxFolder).name = newName;
        return p;
    });
}

/**
 * Delete a folder and all its contents recursively.
 * Removes all contained assets from flat typed arrays and closes their tabs.
 */
export function deleteFolderWithContents(folderUid: string): void {
    const project = get(currentProject);
    if (!project) return;
    const entry = findEntryByUid(project.assets, folderUid);
    if (!entry || entry.type !== 'folder') return;

    const toRemove = collectAssetsFromFolder(entry as NyxFolder);
    const uidsToRemove = new Set(toRemove.map(a => a.uid));

    currentProject.update(p => {
        if (!p) return p;
        for (const { uid, type } of toRemove) {
            (p[TYPE_TO_ARRAY[type]] as AnyNyxAsset[]) =
                (p[TYPE_TO_ARRAY[type]] as AnyNyxAsset[]).filter(a => a.uid !== uid);
        }
        removeFromTree(p.assets, folderUid);
        return p;
    });
    openedAssets.update(list => list.filter(a => !uidsToRemove.has(a.uid)));
    activeTab.update(tab => {
        if (typeof tab === 'object' && uidsToRemove.has((tab as NyxAsset).uid)) {
            return get(openedAssets)[0] ?? 'assets';
        }
        return tab;
    });
}

/**
 * Move any asset or folder to the root of the asset tree.
 * If the entry is already at the root, this is a no-op.
 */
export function moveEntryToRoot(uid: string): void {
    currentProject.update(p => {
        if (!p) return p;
        if (p.assets.some(e => e.uid === uid)) return p; // already at root
        const entry = findEntryByUid(p.assets, uid);
        if (!entry) return p;
        removeFromTree(p.assets, uid);
        p.assets.push(entry);
        return p;
    });
}

/**
 * Unwrap a folder: move all its direct and nested children up into the parent
 * at the folder's position, then remove the folder node itself.
 */
export function unwrapFolder(folderUid: string, parentFolder: NyxFolder | null): void {
    currentProject.update(p => {
        if (!p) return p;
        const parentEntries = parentFolder ? parentFolder.entries : p.assets;
        const idx = parentEntries.findIndex(e => e.uid === folderUid);
        if (idx === -1) return p;
        const folder = parentEntries[idx] as NyxFolder;
        parentEntries.splice(idx, 1, ...folder.entries);
        return p;
    });
}

// ── File I/O (Electron IPC) ───────────────────────────────────────────────────

/** Path to the currently open project file, or null for unsaved new projects. */
export const projectFilePath = writable<string | null>(null);

/**
 * The project's root directory (dirname of projectFilePath), with forward slashes.
 * Use this everywhere an asset URL needs to be constructed — never strip the
 * file extension from projectFilePath directly, because the filename may not
 * end in a predictable extension.
 */
export const currentProjectDir = derived(
    projectFilePath,
    fp => {
        if (!fp) return null;
        const normalized = fp.replace(/\\/g, '/');
        const idx = normalized.lastIndexOf('/');
        return idx === -1 ? '.' : normalized.slice(0, idx);
    },
);

/**
 * Open a .ict file via Electron IPC, parse it, and load it into the store.
 * Also records the path in the editor settings recent-projects list.
 */
export async function openProjectFile(filePath: string): Promise<void> {
    const { project } = await electronAPI().project.open(filePath);
    loadProject(project);
    projectFilePath.set(filePath);

    // Update recent-projects list in userData settings
    const raw      = (window.electronAPI.settings.getAll()['lastProjects'] as string) ?? '';
    const paths    = raw.split(';').filter(Boolean);
    const filtered = paths.filter(p => p !== filePath);
    filtered.unshift(filePath);
    void window.electronAPI.settings.set('lastProjects', filtered.slice(0, 20).join(';'));
}

/**
 * Save the current project to its file.
 * Throws if no project is open or no file path is set.
 */
export async function saveProjectFile(filePath?: string): Promise<void> {
    const project = get(currentProject);
    if (!project) throw new Error('[projectStore] No project open');

    const path = filePath ?? get(projectFilePath);
    if (!path) throw new Error('[projectStore] No save path — use Save As');

    // Strip Svelte 5 reactive Proxy wrappers before sending over Electron IPC,
    // which uses structuredClone internally and cannot serialize Proxy objects.
    const plain = JSON.parse(JSON.stringify(project)) as NyxProject;
    await electronAPI().project.save(path, plain);
    projectFilePath.set(path);
    dirtyAssetUids.set(new Set());
    // Refresh baselines so Discard after a save restores to the saved state.
    for (const asset of get(openedAssets)) {
        if (assetBaselines.has(asset.uid)) {
            assetBaselines.set(asset.uid, JSON.parse(JSON.stringify(asset)) as AnyNyxAsset);
        }
    }
}

/**
 * Create a new project via Electron IPC and load it into the store.
 * If savePath is provided, the file is written immediately.
 */
export async function createProjectFile(
    name:      string,
    savePath?: string,
): Promise<void> {
    const { project, filePath } = await electronAPI().project.new({
        name,
        savePath,
    });
    loadProject(project);
    projectFilePath.set(filePath);

    if (filePath) {
        const raw      = (window.electronAPI.settings.getAll()['lastProjects'] as string) ?? '';
        const paths    = raw.split(';').filter(Boolean);
        const filtered = paths.filter(p => p !== filePath);
        filtered.unshift(filePath);
        void window.electronAPI.settings.set('lastProjects', filtered.slice(0, 20).join(';'));
    }
}
