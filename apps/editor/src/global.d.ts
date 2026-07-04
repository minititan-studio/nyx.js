/// <reference types="vite/client" />
import type { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions, SaveDialogReturnValue } from 'electron';
import type { NyxProject } from '@nyx/shared';
import type { NyxMod } from '@nyx/plugin-api';

/**
 * Typed declaration for the contextBridge API exposed by electron/preload.ts.
 * This makes window.electronAPI fully type-safe in all Svelte components.
 */
declare global {
    interface Window {
        electronAPI: {
            window: {
                maximize:         () => Promise<void>;
                minimize:         () => Promise<void>;
                unmaximize:       () => Promise<void>;
                isMaximized:      () => Promise<boolean>;
                close:            () => Promise<void>;
                confirmClose:     () => Promise<void>;
                onCloseRequested: (callback: () => void) => () => void;
            };
            dialog: {
                showOpenDialog:  (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
                showSaveDialog:  (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
                showConfirm: (opts: { message: string; detail?: string; confirmLabel?: string; cancelLabel?: string }) => Promise<boolean>;
                showAlert:   (opts: { message: string; detail?: string }) => Promise<void>;
            };
            shell: {
                openExternal:     (url: string)  => Promise<void>;
                showItemInFolder: (path: string) => Promise<void>;
            };
            file: {
                writeText: (filePath: string, content: string) => Promise<{ success: boolean }>;
                readText:  (filePath: string) => Promise<{ content: string }>;
            };
            gameServer: {
                export:  (project: NyxProject, projectFilePath: string) => Promise<{ dir: string }>;
                exportTo: (project: NyxProject, projectFilePath: string, dir: string) => Promise<{ dir: string }>;
                exportDesktop: (opts: {
                    gameDir:   string;
                    outDir:    string;
                    appName:   string;
                    appId:     string;
                    version:   string;
                    platforms: Array<'win' | 'mac' | 'linux'>;
                }) => Promise<{ outDir: string }>;
                onExportProgress: (callback: (msg: string) => void) => () => void;
                start:   ()                    => Promise<{ port: number }>;
                stop:    ()                    => Promise<void>;
                getUrl:  ()                    => Promise<string | null>;
            };
            project: {
                open:          (filePath: string)                          => Promise<{ project: NyxProject; filePath: string }>;
                save:          (filePath: string, project: NyxProject)      => Promise<{ success: boolean }>;
                new:           (opts: { name: string; savePath?: string }) => Promise<{ project: NyxProject; filePath: string | null }>;
                ensureDirs:    (projectDir: string)                        => Promise<{ success: boolean }>;
                validatePaths: (paths: string[])                           => Promise<string[]>;
            };
            texture: {
                import: (opts: { sourcePath: string; projectFilePath: string; uid: string }) =>
                    Promise<{ origname: string }>;
                saveGenerated: (opts: { pngData: number[]; projectFilePath: string; uid: string }) =>
                    Promise<{ origname: string }>;
            };
            font: {
                import: (opts: { sourcePath: string; projectFilePath: string; uid: string }) =>
                    Promise<{ origname: string }>;
            };
            sound: {
                import: (opts: { sourcePaths: string[]; projectFilePath: string }) =>
                    Promise<Array<{ uid: string; origname: string }>>;
            };
            /** nyxMod (plugin) management — list and load manifests */
            nyxmod: {
                list:         ()             => Promise<NyxMod[]>;
                loadManifest: (name: string) => Promise<NyxMod>;
            };
            system: {
                networkInterfaces: () => Promise<{ name: string; address: string }[]>;
            };
            devtools: {
                toggle: () => Promise<void>;
                open:   () => Promise<void>;
                close:  () => Promise<void>;
            };
            zoom: {
                in:    () => Promise<void>;
                out:   () => Promise<void>;
                reset: () => Promise<void>;
            };
            script: {
                create: (opts: { assetType: 'template' | 'behavior' | 'script' | 'room' | 'uiLayer'; name: string; projectFilePath: string }) =>
                    Promise<{ scriptPath: string }>;
                /** Subscribe to external file changes. Returns a disposer function. */
                onFileChanged: (callback: (data: { relativePath: string }) => void) => () => void;
            };
            engine: {
                getTypes: () => Promise<{ content: string; globals: string; error: string | null }>;
                getNyxModTypes: () => Promise<Array<{ nyxmod: string; content: string }>>;
            };
            vscode: {
                open: (projectDir: string) => Promise<{ success: boolean }>;
            };
            settings: {
                getAll: () => Record<string, unknown>;
                set:    (key: string, value: unknown) => Promise<void>;
            };
            platform: NodeJS.Platform;
        };
    }
}

export {};
