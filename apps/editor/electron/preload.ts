import { contextBridge, ipcRenderer } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';

/**
 * Exposes a safe, typed API to the renderer process.
 * Replaces the direct NW.js nw.Window / nw.App / nw.Screen globals.
 */
contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls — replaces nw.Window.get().*
    window: {
        maximize:    () => ipcRenderer.invoke('window:maximize'),
        minimize:    () => ipcRenderer.invoke('window:minimize'),
        unmaximize:  () => ipcRenderer.invoke('window:unmaximize'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        close:       () => ipcRenderer.invoke('window:close'),
        confirmClose: () => ipcRenderer.invoke('window:confirmClose'),
        onCloseRequested: (callback: () => void) => {
            const handler = () => callback();
            ipcRenderer.on('window:closeRequested', handler);
            return () => ipcRenderer.off('window:closeRequested', handler);
        },
    },

    // Native dialogs — replaces nw showOpenDialog / showSaveDialog globals
    dialog: {
        showOpenDialog:  (options: OpenDialogOptions) =>
            ipcRenderer.invoke('dialog:showOpen', options),
        showSaveDialog:  (options: SaveDialogOptions) =>
            ipcRenderer.invoke('dialog:showSave', options),
        showConfirm: (opts: { message: string; detail?: string; confirmLabel?: string; cancelLabel?: string }) =>
            ipcRenderer.invoke('dialog:showConfirm', opts) as Promise<boolean>,
        showAlert: (opts: { message: string; detail?: string }) =>
            ipcRenderer.invoke('dialog:showAlert', opts) as Promise<void>,
    },

    // Shell utilities — replaces nw.Shell.openExternal
    shell: {
        openExternal:      (url: string)    => ipcRenderer.invoke('shell:openExternal', url),
        showItemInFolder:  (path: string)   => ipcRenderer.invoke('shell:showItemInFolder', path),
    },

    // Generic file utilities
    file: {
        writeText: (filePath: string, content: string) =>
            ipcRenderer.invoke('file:writeText', filePath, content),
        readText: (filePath: string) =>
            ipcRenderer.invoke('file:readText', filePath) as Promise<{ content: string }>,
    },

    // Game server — start/stop a local HTTP server that serves the exported game
    gameServer: {
        export:   (project: unknown, projectFilePath: string)              => ipcRenderer.invoke('game:export',   project, projectFilePath),
        exportTo: (project: unknown, projectFilePath: string, dir: string) => ipcRenderer.invoke('game:exportTo', project, projectFilePath, dir),
        exportDesktop: (opts: {
            gameDir:   string;
            outDir:    string;
            appName:   string;
            appId:     string;
            version:   string;
            platforms: Array<'win' | 'mac' | 'linux'>;
        }) => ipcRenderer.invoke('game:exportDesktop', opts),
        onExportProgress: (callback: (msg: string) => void) => {
            const handler = (_event: Electron.IpcRendererEvent, msg: string): void => callback(msg);
            ipcRenderer.on('game:export:progress', handler);
            // Return a disposer so callers can clean up
            return () => ipcRenderer.off('game:export:progress', handler);
        },
        start:    ()                    => ipcRenderer.invoke('game:start'),
        stop:     ()                    => ipcRenderer.invoke('game:stop'),
        getUrl:   ()                    => ipcRenderer.invoke('game:getUrl'),
    },

    // Project file I/O — reads/writes .json project files via the main process
    project: {
        open:          (filePath: string)                                   => ipcRenderer.invoke('project:open',          filePath),
        save:          (filePath: string, project: unknown)                 => ipcRenderer.invoke('project:save',          filePath, project),
        new:           (opts: { name: string; savePath?: string })          => ipcRenderer.invoke('project:new',           opts),
        ensureDirs:    (projectDir: string)                                 => ipcRenderer.invoke('project:ensureDirs',    projectDir),
        validatePaths: (paths: string[])                                    => ipcRenderer.invoke('project:validatePaths', paths),
    },

    // Texture import — copy source file into the project's img/ folder
    texture: {
        import: (opts: { sourcePath: string; projectFilePath: string; uid: string }) =>
            ipcRenderer.invoke('texture:import', opts),
        // Save a procedurally-generated PNG (from TextureGenerator canvas) to img/
        saveGenerated: (opts: { pngData: number[]; projectFilePath: string; uid: string }) =>
            ipcRenderer.invoke('texture:saveGenerated', opts),
    },

    // Font import — copy font file into the project's fonts/ folder
    font: {
        import: (opts: { sourcePath: string; projectFilePath: string; uid: string }) =>
            ipcRenderer.invoke('font:import', opts),
    },

    // Sound import — copy one or more audio files into the project's snd/ folder
    sound: {
        import: (opts: { sourcePaths: string[]; projectFilePath: string }) =>
            ipcRenderer.invoke('sound:import', opts),
    },

    // NyxMod (plugin) API — list and load nyxmod manifests
    nyxmod: {
        list:         ()             => ipcRenderer.invoke('nyxmod:list'),
        loadManifest: (name: string) => ipcRenderer.invoke('nyxmod:loadManifest', name),
    },

    // System info — OS network interfaces for debugger networking modal
    system: {
        networkInterfaces: () => ipcRenderer.invoke('system:networkInterfaces'),
    },

    // Developer tools toggle
    devtools: {
        toggle: () => ipcRenderer.invoke('devtools:toggle'),
        open:   () => ipcRenderer.invoke('devtools:open'),
        close:  () => ipcRenderer.invoke('devtools:close'),
    },

    // Editor zoom — replaces nw.Window.get().zoomLevel
    zoom: {
        in:    () => ipcRenderer.invoke('zoom:in'),
        out:   () => ipcRenderer.invoke('zoom:out'),
        reset: () => ipcRenderer.invoke('zoom:reset'),
    },

    // Script file scaffolding — creates .ts stub files in src/templates|behaviors|scripts/
    script: {
        create: (opts: { assetType: 'template' | 'behavior' | 'script' | 'room'; name: string; projectFilePath: string }) =>
            ipcRenderer.invoke('script:create', opts) as Promise<{ scriptPath: string }>,
        onFileChanged: (callback: (data: { relativePath: string }) => void) => {
            const handler = (_e: Electron.IpcRendererEvent, data: { relativePath: string }) => callback(data);
            ipcRenderer.on('script:fileChanged', handler);
            return () => ipcRenderer.off('script:fileChanged', handler);
        },
    },

    // Engine type definitions for Monaco IntelliSense
    engine: {
        getTypes: () => ipcRenderer.invoke('engine:getTypes') as Promise<{ content: string; globals: string; error: string | null }>,
        getNyxModTypes: () => ipcRenderer.invoke('engine:getNyxModTypes') as Promise<Array<{ nyxmod: string; content: string }>>,
    },

    // VS Code integration
    vscode: {
        open: (projectDir: string) =>
            ipcRenderer.invoke('vscode:open', projectDir) as Promise<{ success: boolean }>,
    },

    // Editor settings — port-independent persistence via userData/editor-settings.json.
    // getAll() uses sendSync so stores can read initial values synchronously at module load.
    settings: {
        getAll: (): Record<string, unknown> => ipcRenderer.sendSync('settings:getAll'),
        set:    (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
    },

    // Platform info (replaces process.platform checks in renderer)
    platform: process.platform
});
