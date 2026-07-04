import { app, BrowserWindow, shell, ipcMain, dialog, protocol } from 'electron';
import os from 'os';
import { exportProject } from './exporter.js';
import { packageGame } from './packager.js';
import type { DesktopPlatform } from './packager.js';
import type { NyxProject } from '@nyx/shared';

// Must be called before app.whenReady() — registers nyx-asset:// as a
// privileged scheme so the renderer can load local project files without
// hitting Chromium's file:// cross-origin block.
protocol.registerSchemesAsPrivileged([{
    scheme: 'nyx-asset',
    privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);
import { join } from 'path';
import * as http from 'http';
import * as fs from 'fs';
import * as nodePath from 'path';
// Note: electron-vite injects __dirname via import.meta.dirname at compile time

// Keep a global reference to avoid garbage collection
let mainWindow: BrowserWindow | null = null;

// Set to true by window:confirmClose once the renderer has resolved any
// unsaved-changes dialogs. Lets the close event through on the second pass.
let canClose = false;

// ── NyxMod (nyx.libs) directory ───────────────────────────────────────────────
// Dev:  out/electron/  →  ../../resources/nyx.libs
// Prod: process.resourcesPath/nyx.libs
const NYXLIBS_DIR: string = app.isPackaged
    ? nodePath.join(process.resourcesPath, 'nyx.libs')
    : nodePath.join(__dirname, '../../resources/nyx.libs');

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        show: false, // show after ready-to-show to avoid flash
        autoHideMenuBar: true,
        webPreferences: {
            preload: join(__dirname, '../preload/preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show();
    });

    mainWindow.on('close', (e) => {
        if (!canClose && !mainWindow?.webContents.isCrashed()) {
            e.preventDefault();
            mainWindow?.webContents.send('window:closeRequested');
        }
    });

    // Open external links in the OS browser, not in Electron
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Dev: load Vite dev server; Prod: load built index.html
    if (process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
        // mainWindow.webContents.openDevTools();

        // After: open manually with F12 / Ctrl+Shift+I, or via MainMenu → Troubleshooting → Toggle DevTools
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }
}

app.whenReady().then(() => {
    // Serve local project assets (textures, sounds, fonts) to the renderer.
    // Uses fs.readFile directly so percent-encoded paths and missing files are
    // handled gracefully (404) instead of letting net.fetch throw ERR_UNEXPECTED.
    protocol.handle('nyx-asset', async (request) => {
        try {
            const url     = new URL(request.url);
            const encoded = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
            // Decode percent-encoding (%20 → space, %2C → comma, etc.) to get the
            // real filesystem path, then normalise separators for Windows.
            const fsPath  = decodeURIComponent(encoded).replace(/\//g, nodePath.sep);
            const data    = await fs.promises.readFile(fsPath);
            const ext     = nodePath.extname(fsPath).toLowerCase();
            const mime: Record<string, string> = {
                '.png': 'image/png',        '.jpg': 'image/jpeg',  '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',        '.webp': 'image/webp', '.bmp': 'image/bmp',
                '.svg': 'image/svg+xml',
                '.ttf': 'font/truetype',    '.otf': 'font/opentype',
                '.woff': 'font/woff',       '.woff2': 'font/woff2',
                '.ogg': 'audio/ogg',        '.mp3': 'audio/mpeg',  '.wav': 'audio/wav',
            };
            return new Response(data, {
                headers: { 'Content-Type': mime[ext] ?? 'application/octet-stream' }
            });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    });

    createWindow();

    app.on('activate', () => {
        // macOS: re-create window when dock icon is clicked
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ── Editor settings — persisted to userData/editor-settings.json ─────────────
// ipcRenderer.sendSync is used by the renderer stores for synchronous initial
// reads; writes are async (fire-and-forget for UI prefs is fine).
const SETTINGS_PATH = nodePath.join(app.getPath('userData'), 'editor-settings.json');

function readAllSettings(): Record<string, unknown> {
    try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')); } catch { return {}; }
}

ipcMain.on('settings:getAll', (event) => {
    event.returnValue = readAllSettings();
});

ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    const s = readAllSettings();
    s[key] = value;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8');
});

// IPC: maximize / minimize window (replaces NW.js window APIs)
ipcMain.handle('window:maximize',    () => mainWindow?.maximize());
ipcMain.handle('window:minimize',    () => mainWindow?.minimize());
ipcMain.handle('window:unmaximize',  () => mainWindow?.unmaximize());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('window:close',       () => mainWindow?.close());
ipcMain.handle('window:confirmClose', () => { canClose = true; mainWindow?.close(); });

ipcMain.handle('devtools:toggle', () => mainWindow?.webContents.toggleDevTools());
ipcMain.handle('devtools:open',   () => mainWindow?.webContents.openDevTools());
ipcMain.handle('devtools:close',  () => mainWindow?.webContents.closeDevTools());

ipcMain.handle('zoom:in', () => {
    if (!mainWindow) return;
    const f = parseFloat(mainWindow.webContents.getZoomFactor().toFixed(1));
    mainWindow.webContents.setZoomFactor(Math.min(f + 0.1, 2.0));
});
ipcMain.handle('zoom:out', () => {
    if (!mainWindow) return;
    const f = parseFloat(mainWindow.webContents.getZoomFactor().toFixed(1));
    mainWindow.webContents.setZoomFactor(Math.max(f - 0.1, 0.5));
});
ipcMain.handle('zoom:reset', () => {
    mainWindow?.webContents.setZoomFactor(1.0);
});

// ── Script file scaffolding ────────────────────────────────────────────────────

/** Convert any asset name to a valid PascalCase TypeScript class identifier. */
function toClassName(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/(?:^|\s+)(\w)/g, (_, c: string) => c.toUpperCase());
}

function generateScriptStub(assetType: 'template' | 'behavior' | 'script' | 'room' | 'uiLayer', className: string, assetName?: string): string {
    if (assetType === 'template') {
        return [
            `import { Template } from '@nyx/engine';`,
            ``,
            `export class ${className} extends Template {`,
            `  onCreate() {`,
            `    // your code here`,
            `  }`,
            ``,
            `  onStep() {`,
            `    // your code here`,
            `  }`,
            `}`,
            ``,
        ].join('\n');
    }
    if (assetType === 'behavior') {
        return [
            `import { Behavior } from '@nyx/engine';`,
            ``,
            `export class ${className} extends Behavior {`,
            `  onCreate() {`,
            `    // your code here`,
            `  }`,
            ``,
            `  onStep() {`,
            `    // your code here`,
            `  }`,
            `}`,
            ``,
        ].join('\n');
    }
    if (assetType === 'room') {
        return [
            `import { Room } from '@nyx/engine';`,
            ``,
            `export class ${className} extends Room {`,
            `  onRoomStart() {`,
            `    // your code here`,
            `  }`,
            ``,
            `  onStep() {`,
            `    // your code here`,
            `  }`,
            `}`,
            ``,
        ].join('\n');
    }
    if (assetType === 'uiLayer') {
        const layerName = assetName ?? className;
        return [
            `import { UILayer, ui } from '@nyx/engine';`,
            ``,
            `/** Widget names available in this layer. */`,
            `type LayerWidget = NyxWidgetNames[${JSON.stringify(layerName)}];`,
            ``,
            `export class ${className} extends UILayer {`,
            `  onMount() {`,
            `    // called when this layer's widgets are shown`,
            `  }`,
            ``,
            `  onStep() {`,
            `    // called every frame while this layer is active`,
            `  }`,
            ``,
            `  onUnmount() {`,
            `    // called when this layer is removed`,
            `  }`,
            `}`,
            ``,
        ].join('\n');
    }
    // script
    return [
        `import { actions, rooms, u } from '@nyx/engine';`,
        ``,
        `// Script: ${className}`,
        `// Add exported functions or shared constants here.`,
        ``,
    ].join('\n');
}

ipcMain.handle('script:create', async (_, opts: {
    assetType: 'template' | 'behavior' | 'script' | 'room' | 'uiLayer';
    name: string;
    projectFilePath: string;
}) => {
    const projectDir = nodePath.dirname(opts.projectFilePath);
    const subdir = opts.assetType === 'template' ? 'templates'
                 : opts.assetType === 'behavior' ? 'behaviors'
                 : opts.assetType === 'room'     ? 'rooms'
                 : opts.assetType === 'uiLayer'  ? 'ui-layers'
                 : 'scripts';

    const className = toClassName(opts.name) || 'Script';
    const fileName  = `${className}.ts`;
    const srcDir    = nodePath.join(projectDir, 'src', subdir);
    await fs.promises.mkdir(srcDir, { recursive: true });

    const absPath    = nodePath.join(srcDir, fileName);
    const scriptPath = `src/${subdir}/${fileName}`;

    // Atomic exclusive create — silently skip if file already exists (EEXIST)
    try {
        await fs.promises.writeFile(absPath, generateScriptStub(opts.assetType, className, opts.name), { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    return { scriptPath };
});

// IPC: native file dialogs (replaces NW.js showOpenDialog / showSaveDialog globals)
ipcMain.handle('dialog:showOpen', (_, opts) =>
    dialog.showOpenDialog(mainWindow!, opts));
ipcMain.handle('dialog:showSave', (_, opts) =>
    dialog.showSaveDialog(mainWindow!, opts));
ipcMain.handle('dialog:showConfirm', async (_, opts: {
    message: string; detail?: string; confirmLabel?: string; cancelLabel?: string;
}) => {
    const { response } = await dialog.showMessageBox(mainWindow!, {
        type:      'question',
        buttons:   [opts.cancelLabel ?? 'Cancel', opts.confirmLabel ?? 'OK'],
        defaultId: 1, cancelId: 0,
        message:   opts.message,
        detail:    opts.detail,
    });
    return response === 1;
});
ipcMain.handle('dialog:showAlert', async (_, opts: { message: string; detail?: string }) => {
    await dialog.showMessageBox(mainWindow!, {
        type: 'info', buttons: ['OK'],
        message: opts.message, detail: opts.detail,
    });
});

// IPC: shell utilities (replaces nw.Shell.openExternal)
ipcMain.handle('shell:openExternal', (_, url: string) =>
    shell.openExternal(url));

ipcMain.handle('shell:showItemInFolder', (_, folderPath: string) =>
    shell.showItemInFolder(folderPath));

// IPC: generic file write (used for preset export, future editors)
ipcMain.handle('file:writeText', async (_, filePath: string, content: string) => {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return { success: true };
});
ipcMain.handle('file:readText', async (_, filePath: string) => {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return { content };
});

// IPC: list external IPv4 network interfaces (used by debugger networking modal)
ipcMain.handle('system:networkInterfaces', () => {
    const ifaces = os.networkInterfaces();
    const result: { name: string; address: string }[] = [];
    for (const [name, addrs] of Object.entries(ifaces)) {
        for (const addr of (addrs ?? [])) {
            if (addr.family === 'IPv4' && !addr.internal) {
                result.push({ name, address: addr.address });
            }
        }
    }
    return result;
});

// ── Project file I/O ──────────────────────────────────────────────────────────
// Delegate all serialization to @nyx/project-format (bundled inline by
// electron-vite via the alias + exclude config in electron.vite.config.ts).
import { readProjectFile, writeProjectFile, createNewProject } from '@nyx/project-format';


/** Create empty project dirs (img/, snd/, fonts/). */
async function ensureProjectDirs(projectDir: string): Promise<void> {
    await Promise.all([
        fs.promises.mkdir(nodePath.join(projectDir, 'img'),   { recursive: true }),
        fs.promises.mkdir(nodePath.join(projectDir, 'snd'),   { recursive: true }),
        fs.promises.mkdir(nodePath.join(projectDir, 'fonts'), { recursive: true }),
    ]);
}

// ── Script file watcher ────────────────────────────────────────────────────────
// Watches src/**/*.ts in the project folder and notifies the renderer when any
// script file changes externally (e.g. saved from VS Code).
// Note: fs.watch recursive mode works on Windows and macOS but not Linux.

// ── Workspace file generation ─────────────────────────────────────────────────
// Writes tsconfig.json and nyx.code-workspace into the project directory so
// VS Code gets full TypeScript autocomplete for @nyx/engine types.
// Files marked with _nyxGenerated:true are overwritten on every open;
// user-modified files (marker absent) are left alone.

function getEngineSrcPath(): string {
    const base = app.isPackaged
        ? nodePath.join(process.resourcesPath, 'engine', 'src', 'index.ts')
        : nodePath.join(app.getAppPath(), '..', '..', 'packages', 'engine', 'src', 'index.ts');
    return base.replace(/\\/g, '/');
}

function getSharedSrcPath(): string {
    const base = app.isPackaged
        ? nodePath.join(process.resourcesPath, 'shared', 'src', 'index.ts')
        : nodePath.join(app.getAppPath(), '..', '..', 'packages', 'shared', 'src', 'index.ts');
    return base.replace(/\\/g, '/');
}

async function canOverwrite(filePath: string): Promise<boolean> {
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content) as Record<string, unknown>;
        return parsed['_nyxGenerated'] === true || parsed['_nyxGenerated'] === true;
    } catch {
        return true; // File doesn't exist or not valid JSON — safe to write
    }
}

function buildProjectTypesDts(project: NyxProject): string {
    function union(names: string[]): string {
        if (names.length === 0) return 'string';
        return names.map(n => JSON.stringify(n)).join(' | ');
    }
    const widgetMap = project.uiLayers
        .filter(l => l.widgets.length > 0)
        .map(l => `    ${JSON.stringify(l.name)}: ${union(l.widgets.map((w: { name: string }) => w.name))};`)
        .join('\n');

    return [
        `// Auto-generated by Nyx Studio — do not edit. Regenerated on project open/save.`,
        ``,
        `declare type NyxRoomName     = ${union(project.rooms.map(r => r.name))};`,
        `declare type NyxTemplateName = ${union(project.templates.map(t => t.name))};`,
        `declare type NyxActionName   = ${union(project.actions.map(a => a.name))};`,
        `declare type NyxTextureName  = ${union(project.textures.map(t => t.name))};`,
        `declare type NyxSoundName    = ${union(project.sounds.map(s => s.name))};`,
        `declare type NyxUILayerName  = ${union(project.uiLayers.map(l => l.name))};`,
        `declare type NyxWidgetName   = ${union(project.uiLayers.flatMap(l => l.widgets.map((w: { name: string }) => w.name)))};`,
        ``,
        `/** Widget names keyed by UILayer name. Use \`type LayerWidget = NyxWidgetNames['HUD']\` in UILayer scripts. */`,
        `declare type NyxWidgetNames = {`,
        widgetMap || `    [layer: string]: string;`,
        `};`,
    ].join('\n');
}

function patchEngineContent(content: string, project: NyxProject): string {
    function union(names: string[]): string {
        if (names.length === 0) return 'string';
        return names.map(n => JSON.stringify(n)).join(' | ');
    }
    const patches: [RegExp, string][] = [
        [/export type RoomName\s*=\s*string;/,     `export type RoomName = ${union(project.rooms.map(r => r.name))};`],
        [/export type TemplateName\s*=\s*string;/, `export type TemplateName = ${union(project.templates.map(t => t.name))};`],
        [/export type ActionName\s*=\s*string;/,   `export type ActionName = ${union(project.actions.map(a => a.name))};`],
        [/export type TextureName\s*=\s*string;/,  `export type TextureName = ${union(project.textures.map(t => t.name))};`],
        [/export type SoundName\s*=\s*string;/,    `export type SoundName = ${union(project.sounds.map(s => s.name))};`],
        [/export type UILayerName\s*=\s*string;/,  `export type UILayerName = ${union(project.uiLayers.map(l => l.name))};`],
        [/export type WidgetName\s*=\s*string;/,   `export type WidgetName = ${union(project.uiLayers.flatMap(l => l.widgets.map((w: { name: string }) => w.name)))};`],
    ];
    let patched = content;
    for (const [regex, replacement] of patches) {
        patched = patched.replace(regex, replacement);
    }
    return patched;
}

async function writeProjectTypeFile(projectDir: string, project: NyxProject): Promise<void> {
    // Write global utility types (NyxWidgetNames etc.) for UILayer stubs
    const globalsDest = nodePath.join(projectDir, 'nyx-project-types.d.ts');
    await fs.promises.writeFile(globalsDest, buildProjectTypesDts(project), 'utf-8');

    // Write patched engine types so tsconfig paths can point here for VS Code autocomplete
    const engineSrc = getEngineSrcPath();
    try {
        const raw = await fs.promises.readFile(engineSrc, 'utf-8');
        const patched = patchEngineContent(raw, project);
        const engineDest = nodePath.join(projectDir, 'nyx-engine-types.ts');
        await fs.promises.writeFile(engineDest, patched, 'utf-8');
    } catch {
        // Engine source not found — skip (VS Code will fall back to plain string types)
    }
}

async function generateWorkspaceFiles(projectDir: string): Promise<void> {
    const tsconfigFile  = nodePath.join(projectDir, 'tsconfig.json');
    const workspaceFile = nodePath.join(projectDir, 'nyx.code-workspace');

    if (await canOverwrite(tsconfigFile)) {
        // Collect absolute paths to all nyxmod type declaration files so VS Code
        // picks them up alongside the project's own src/**/*.ts scripts.
        const nyxLibsDir = app.isPackaged
            ? nodePath.join(process.resourcesPath, 'nyx.libs')
            : nodePath.join(app.getAppPath(), 'resources', 'nyx.libs');
        const nyxmodTypeFiles: string[] = [];
        try {
            const entries = await fs.promises.readdir(nyxLibsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const typesFile = nodePath.join(nyxLibsDir, entry.name, 'types.d.ts').replace(/\\/g, '/');
                if (fs.existsSync(typesFile)) nyxmodTypeFiles.push(typesFile);
            }
        } catch { /* nyx.libs not found — skip nyxmod types */ }

        // Runtime globals (camera, tween, etc.) must be in the generated tsconfig
        // so VS Code knows about them when type-checking game scripts.
        const runtimeGlobalsPath = (app.isPackaged
            ? nodePath.join(process.resourcesPath, 'runtime', 'src', 'types', 'runtime-globals.d.ts')
            : nodePath.join(app.getAppPath(), '..', '..', 'apps', 'runtime', 'src', 'types', 'runtime-globals.d.ts')
        ).replace(/\\/g, '/');
        const extraFiles: string[] = fs.existsSync(runtimeGlobalsPath) ? [runtimeGlobalsPath] : [];

        const tsconfig: Record<string, unknown> = {
            _nyxGenerated: true,
            compilerOptions: {
                target: 'ES2020',
                module: 'ES2020',
                moduleResolution: 'bundler',
                strict: true,
                noEmit: true,
                paths: {
                    '@nyx/engine':  ['./nyx-engine-types.ts'],
                    '@nyx/shared':  [getSharedSrcPath()],
                },
            },
            include: ['src/**/*.ts'],
        };
        const allFiles = [...extraFiles, ...nyxmodTypeFiles, './nyx-project-types.d.ts'];
        tsconfig['files'] = allFiles;
        await fs.promises.writeFile(tsconfigFile, JSON.stringify(tsconfig, null, 2), 'utf-8');
    }

    if (await canOverwrite(workspaceFile)) {
        const tsSdkPath = nodePath.join(app.getAppPath(), 'node_modules', 'typescript', 'lib').replace(/\\/g, '/');
        const workspace = {
            _nyxGenerated: true,
            folders: [{ path: '.' }],
            settings: {
                'typescript.tsdk': tsSdkPath,
                'typescript.enablePromptUseWorkspaceTsdk': true,
            },
        };
        await fs.promises.writeFile(workspaceFile, JSON.stringify(workspace, null, 2), 'utf-8');
    }
}

let scriptWatcher: import('fs').FSWatcher | null = null;
let watcherGeneration = 0;

function startScriptWatcher(projectDir: string): void {
    const gen = ++watcherGeneration;
    scriptWatcher?.close();
    scriptWatcher = null;

    try {
        // Watch the project root recursively — works even before src/ exists.
        // fs.watch recursive mode is reliable on Windows and macOS.
        scriptWatcher = fs.watch(projectDir, { recursive: true }, (_event, filename) => {
            // Discard events from a stale watcher (fired after project switch)
            if (gen !== watcherGeneration) return;
            if (!filename) return;
            const normalized = filename.replace(/\\/g, '/');
            // Only forward TypeScript files under src/
            if (!normalized.startsWith('src/') || !normalized.endsWith('.ts')) return;
            mainWindow?.webContents.send('script:fileChanged', { relativePath: normalized });
        });
    } catch {
        // fs.watch can fail in restricted environments — not critical
    }
}

/** IPC: return the @nyx/engine TypeScript source so Monaco can load its types */
ipcMain.handle('engine:getTypes', async () => {
    const p = getEngineSrcPath();
    if (!fs.existsSync(p)) {
        return { content: '', globals: '', error: `Engine types not found at: ${p}` };
    }
    try {
        const content = await fs.promises.readFile(p, 'utf-8');
        const globalsPath = app.isPackaged
            ? nodePath.join(process.resourcesPath, 'runtime', 'src', 'types', 'runtime-globals.d.ts')
            : nodePath.join(app.getAppPath(), '..', '..', 'apps', 'runtime', 'src', 'types', 'runtime-globals.d.ts');
        let globals = '';
        try {
            globals = await fs.promises.readFile(globalsPath, 'utf-8');
        } catch {
            // non-critical — Monaco still works for engine types without runtime globals
        }
        return { content, globals, error: null };
    } catch (err) {
        return { content: '', globals: '', error: String(err) };
    }
});

/** IPC: return all nyxmod types.d.ts files so Monaco can load nyxmod type definitions */
ipcMain.handle('engine:getNyxModTypes', async () => {
    const dir = app.isPackaged
        ? nodePath.join(process.resourcesPath, 'nyx.libs')
        : nodePath.join(app.getAppPath(), 'resources', 'nyx.libs');
    const results: Array<{ nyxmod: string; content: string }> = [];
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const typesFile = nodePath.join(dir, entry.name, 'types.d.ts');
            try {
                const content = await fs.promises.readFile(typesFile, 'utf-8');
                results.push({ nyxmod: entry.name, content });
            } catch {
                console.warn(`[getNyxModTypes] skipping ${entry.name}: could not read types.d.ts`);
            }
        }
    } catch (err) {
        console.warn('[getNyxModTypes] could not read nyx.libs dir:', err);
    }
    return results;
});

/** IPC: open a project.json file */
ipcMain.handle('project:open', async (_, filePath: string) => {
    const project    = await readProjectFile(filePath);
    const projectDir = nodePath.dirname(filePath);
    startScriptWatcher(projectDir);
    generateWorkspaceFiles(projectDir).catch(() => {}); // fire-and-forget
    writeProjectTypeFile(projectDir, project).catch(() => {});
    return { project, filePath };
});

/** IPC: save a NyxProject to a .json project file */
ipcMain.handle('project:save', async (_, filePath: string, project: NyxProject) => {
    await writeProjectFile(project, filePath);
    const projectDir = nodePath.dirname(filePath);
    writeProjectTypeFile(projectDir, project).catch(() => {});
    return { success: true };
});

/** IPC: create and (optionally) save a new empty project */
ipcMain.handle('project:new', async (_, opts: { name: string; savePath?: string }) => {
    const project: NyxProject = createNewProject({ name: opts.name });
    if (opts.savePath) {
        const projDir = nodePath.dirname(opts.savePath);
        await ensureProjectDirs(projDir);
        await writeProjectFile(project, opts.savePath);
        startScriptWatcher(projDir);
        generateWorkspaceFiles(projDir).catch(() => {});
    }
    return { project, filePath: opts.savePath ?? null };
});

/** IPC: open the project in VS Code (workspace file if available) */
ipcMain.handle('vscode:open', async (_, projectDir: string) => {
    const { spawn } = await import('child_process');
    const workspaceFile = nodePath.join(projectDir, 'nyx.code-workspace');
    const target = fs.existsSync(workspaceFile) ? workspaceFile : projectDir;
    // Pass target as a separate argv element — never interpolated into a shell string.
    // On Windows, code is a .cmd file so we invoke via cmd.exe /c explicitly.
    const [cmd, args] = process.platform === 'win32'
        ? ['cmd', ['/c', 'code', target]]
        : ['code', [target]];
    const proc = spawn(cmd, args, { shell: false, detached: true, stdio: 'ignore' });
    proc.on('error', () => { shell.openPath(projectDir); });
    proc.unref();
    return { success: true };
});

/** IPC: ensure project sub-directories exist */
ipcMain.handle('project:ensureDirs', async (_, projectDir: string) => {
    await ensureProjectDirs(projectDir);
    return { success: true };
});

/** IPC: validate which paths in a list actually exist on disk */
ipcMain.handle('project:validatePaths', async (_, paths: string[]) => {
    const results = await Promise.all(
        paths.map(async p => {
            try { await fs.promises.access(p); return p; }
            catch { return null; }
        })
    );
    return results.filter((p): p is string => p !== null);
});

// ── Game server ────────────────────────────────────────────────────────────────

let gameServer: http.Server | null = null;
let gameServerPort = 0;

function getGameExportDir(): string {
    return nodePath.join(app.getPath('userData'), 'nyx-game-export');
}

function getMime(ext: string): string {
    const m: Record<string, string> = {
        '.html': 'text/html', '.js': 'application/javascript',
        '.mjs': 'application/javascript', '.css': 'text/css',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml',
        '.json': 'application/json', '.wasm': 'application/wasm',
        '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    };
    return m[ext] ?? 'application/octet-stream';
}

// Phase 8: real ct.js exporter — builds playable HTML5 game from project data
ipcMain.handle('game:export', async (_, project: NyxProject, projectFilePath: string) => {
    const dir = getGameExportDir();
    await exportProject(project, projectFilePath, dir);
    return { dir };
});

// Export to a user-specified directory (used by MainMenu "Export for desktop")
ipcMain.handle('game:exportTo', async (_, project: NyxProject, projectFilePath: string, outDir: string) => {
    await exportProject(project, projectFilePath, outDir);
    return { dir: outDir };
});

// ── Desktop game packaging ─────────────────────────────────────────────────────
// Two-step flow:
//   1. game:exportTo  — produces the HTML5 web game in outDir  (already above)
//   2. game:exportDesktop — wraps that web game into platform installers via electron-builder
//
// The renderer calls these sequentially; keeping them separate lets the UI
// show distinct progress for each step and avoids blocking game:exportTo.
ipcMain.handle(
    'game:exportDesktop',
    async (
        event,
        opts: {
            gameDir:   string;
            outDir:    string;
            appName:   string;
            appId:     string;
            version:   string;
            platforms: DesktopPlatform[];
        }
    ): Promise<{ outDir: string }> => {
        const send = (msg: string): void => {
            // Guard: the sender window may have been destroyed during a long build
            if (!event.sender.isDestroyed()) {
                event.sender.send('game:export:progress', msg);
            }
        };

        try {
            await packageGame({
                gameDir:   opts.gameDir,
                outDir:    opts.outDir,
                appName:   opts.appName,
                appId:     opts.appId,
                version:   opts.version,
                platforms: opts.platforms,
                onProgress: send,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Send the error as a progress message so the renderer can display it,
            // then re-throw so the IPC promise rejects (ExportPanel can catch it).
            send(`ERROR: ${message}`);
            throw new Error(message);
        }

        return { outDir: opts.outDir };
    }
);

// Start the static file server (idempotent — reuses existing if already running)
ipcMain.handle('game:start', async () => {
    if (gameServer) {
        return { port: gameServerPort };
    }
    const dir = getGameExportDir();
    gameServer = http.createServer(async (req, res) => {
        try {
            let urlPath = (req.url ?? '/').split('?')[0];
            if (urlPath === '/') urlPath = '/index.html';
            const filePath = nodePath.join(dir, urlPath);
            // Prevent path traversal
            if (!filePath.startsWith(dir)) {
                res.writeHead(403); res.end('Forbidden'); return;
            }
            const data = await fs.promises.readFile(filePath);
            const ext  = nodePath.extname(filePath);
            res.writeHead(200, {
                'Content-Type': getMime(ext),
                'Cache-Control': 'no-store',
            });
            res.end(data);
        } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
        }
    });
    await new Promise<void>((resolve, reject) => {
        gameServer!.listen(0, '127.0.0.1', () => {
            const addr = gameServer!.address() as { port: number };
            gameServerPort = addr.port;
            resolve();
        });
        gameServer!.once('error', reject);
    });
    return { port: gameServerPort };
});

ipcMain.handle('game:stop', () => {
    if (gameServer) {
        gameServer.close();
        gameServer = null;
        gameServerPort = 0;
    }
});

ipcMain.handle('game:getUrl', () => {
    if (!gameServer || !gameServerPort) return null;
    return `http://127.0.0.1:${gameServerPort}/`;
});

// ── Texture import ────────────────────────────────────────────────────────────

/**
 * IPC: copy a source image into the project's img/ folder.
 * Mirrors legacy importImageToTexture: dest is always i<uid><ext> so the
 * origname is stable and independent of the user's original filename.
 */
ipcMain.handle('texture:import', async (_, opts: {
    sourcePath: string;
    projectFilePath: string;
    uid: string;
}): Promise<{ origname: string }> => {
    const projDir = require("path").dirname(opts.projectFilePath);
    const imgDir  = nodePath.join(projDir, 'img');
    await fs.promises.mkdir(imgDir, { recursive: true });

    const ext      = nodePath.extname(opts.sourcePath).toLowerCase() || '.png';
    const origname = `i${opts.uid}${ext}`;
    const destPath = nodePath.join(imgDir, origname);
    await fs.promises.copyFile(opts.sourcePath, destPath);
    return { origname };
});

/**
 * IPC: write a PNG buffer (from the texture generator canvas) into the
 * project's img/ folder as i<uid>.png.
 * The buffer is received as a number[] (serialized Uint8Array) over the
 * contextBridge — we convert it back to a Buffer before writing.
 */
ipcMain.handle('texture:saveGenerated', async (_, opts: {
    pngData: number[];
    projectFilePath: string;
    uid: string;
}): Promise<{ origname: string }> => {
    const projDir  = require("path").dirname(opts.projectFilePath);
    const imgDir   = nodePath.join(projDir, 'img');
    await fs.promises.mkdir(imgDir, { recursive: true });
    const origname = `i${opts.uid}.png`;
    const destPath = nodePath.join(imgDir, origname);
    await fs.promises.writeFile(destPath, Buffer.from(opts.pngData));
    return { origname };
});

// ── Font import ───────────────────────────────────────────────────────────────
// Copies the source font file into <projDir>/fonts/ as f<uid><ext>.
ipcMain.handle('font:import', async (_, opts: {
    sourcePath:      string;
    projectFilePath: string;
    uid:             string;
}): Promise<{ origname: string }> => {
    const projDir  = require("path").dirname(opts.projectFilePath);
    const fontDir  = nodePath.join(projDir, 'fonts');
    await fs.promises.mkdir(fontDir, { recursive: true });
    const ext      = nodePath.extname(opts.sourcePath).toLowerCase() || '.ttf';
    const origname = `f${opts.uid}${ext}`;
    await fs.promises.copyFile(opts.sourcePath, nodePath.join(fontDir, origname));
    return { origname };
});

// ── Sound import ──────────────────────────────────────────────────────────────
// Copies one or more audio source files into <projDir>/snd/ as s<uid><ext>.
// Each variant gets a new UUID so orignames are stable across renames.
ipcMain.handle('sound:import', async (_, opts: {
    sourcePaths:     string[];
    projectFilePath: string;
}): Promise<Array<{ uid: string; origname: string }>> => {
    const projDir = require("path").dirname(opts.projectFilePath);
    const sndDir  = nodePath.join(projDir, 'snd');
    await fs.promises.mkdir(sndDir, { recursive: true });
    return Promise.all(opts.sourcePaths.map(async (p) => {
        const uid      = crypto.randomUUID();
        const ext      = nodePath.extname(p).toLowerCase() || '.wav';
        const origname = `s${uid}${ext}`;
        await fs.promises.copyFile(p, nodePath.join(sndDir, origname));
        return { uid, origname };
    }));
});

// ── NyxMod (plugin) API ────────────────────────────────────────────────────────

type NyxModManifestRaw = Record<string, unknown>;

interface NyxModRecord {
    name: string;
    path: string;
    manifest: NyxModManifestRaw;
}

/**
 * IPC: list all installed nyxmods from NYXLIBS_DIR.
 * Returns an array of { name, path, manifest } objects.
 * Modules without a module.json are silently skipped.
 */
ipcMain.handle('nyxmod:list', async (): Promise<NyxModRecord[]> => {
    let entries: { name: string; isDirectory(): boolean }[];
    try {
        entries = await fs.promises.readdir(NYXLIBS_DIR, { withFileTypes: true });
    } catch {
        return []; // nyx.libs dir missing — return empty list
    }

    const results = await Promise.all(
        entries
            .filter(e => e.isDirectory())
            .map(async (e): Promise<NyxModRecord | null> => {
                const modPath      = nodePath.join(NYXLIBS_DIR, e.name);
                const manifestPath = nodePath.join(modPath, 'module.json');
                try {
                    const raw = await fs.promises.readFile(manifestPath, 'utf8');
                    return { name: e.name, path: modPath, manifest: JSON.parse(raw) as NyxModManifestRaw };
                } catch {
                    return null;
                }
            })
    );

    return results.filter((r: NyxModRecord | null): r is NyxModRecord => r !== null);
});

/**
 * IPC: load a single nyxmod's manifest by its directory name.
 * Throws if the module or its module.json does not exist.
 */
ipcMain.handle('nyxmod:loadManifest', async (_, name: string): Promise<NyxModRecord> => {
    const modPath      = nodePath.join(NYXLIBS_DIR, name);
    const manifestPath = nodePath.join(modPath, 'module.json');
    const raw          = await fs.promises.readFile(manifestPath, 'utf8');
    return { name, path: modPath, manifest: JSON.parse(raw) as NyxModManifestRaw };
});
