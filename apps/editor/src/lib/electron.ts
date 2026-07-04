/**
 * Safe accessor for window.electronAPI.
 *
 * Throws a descriptive error if called outside of Electron (e.g. in a
 * plain browser), which makes debugging much easier than the generic
 * "Cannot read properties of undefined" TypeError.
 *
 * Usage:
 *   import { electronAPI } from '$lib/electron';
 *   const result = await electronAPI().dialog.showOpenDialog({ ... });
 */
export function electronAPI(): Window['electronAPI'] {
    const api = window.electronAPI;
    if (!api) {
        throw new Error(
            '[Nyx] window.electronAPI is undefined.\n' +
            'This app must run inside Electron. ' +
            'If you are seeing this in a browser, open the Electron dev window instead.\n' +
            'If you are in Electron, the preload script may not have loaded — ' +
            'check that out/preload/preload.js exists and the preload path in main.ts is correct.'
        );
    }
    return api;
}

/**
 * Returns true when running inside Electron (preload was injected).
 * Use this for conditional UI that differs between Electron and browser preview.
 */
export function isElectron(): boolean {
    return typeof window !== 'undefined' && !!window.electronAPI;
}

/**
 * Convert an absolute local file path to a nyx-asset:// URL that Electron
 * can load in the renderer without hitting Chromium's file:// origin block.
 *
 * NW.js allowed file:// natively; Electron requires a registered protocol.
 * The nyx-asset:// handler in main.ts maps it back to the real file.
 */
export function localPathToUrl(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    // Use an explicit 'localhost' host to avoid the WHATWG URL parser treating
    // a Windows drive letter (e.g. 'D:') as the hostname+port-separator, which
    // would turn 'nyx-asset:///D:/path' into 'nyx-asset://d/path'.
    return `nyx-asset://localhost/${normalized}`;
}
