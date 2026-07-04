/**
 * dialogs.ts — Electron-safe wrappers for alert() / confirm().
 * Native browser dialogs (alert, confirm, prompt) are disabled in Electron's
 * renderer process. These helpers route through IPC to the main process instead.
 */
import { electronAPI, isElectron } from './electron.js';

export async function showConfirm(message: string, detail?: string): Promise<boolean> {
    if (isElectron()) {
        return electronAPI().dialog.showConfirm({ message, detail });
    }
    return confirm(detail ? `${message}\n\n${detail}` : message);
}

export async function showAlert(message: string, detail?: string): Promise<void> {
    if (isElectron()) {
        await electronAPI().dialog.showAlert({ message, detail });
    } else {
        alert(detail ? `${message}\n\n${detail}` : message);
    }
}
