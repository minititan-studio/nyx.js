/**
 * packager.ts — Desktop game packaging via electron-builder.
 *
 * Takes an already-exported web game folder (index.html + ct.js + assets) and
 * wraps it in a minimal Electron shell, then drives electron-builder's
 * programmatic API to produce platform-specific installers / binaries.
 *
 * Supported targets:
 *   win   → NSIS installer (.exe)  x64
 *   mac   → DMG image              arm64 + x64 (universal build possible but
 *                                  cross-compilation requires macOS host)
 *   linux → AppImage               x64
 */

import { build } from 'electron-builder';
import type { Configuration, CliOptions } from 'electron-builder';
import * as path from 'path';
import * as fs from 'fs';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DesktopPlatform = 'win' | 'mac' | 'linux';

export interface PackageOptions {
    /** Absolute path to the exported web game folder (contains index.html). */
    gameDir: string;
    /** Absolute path where the packaged app output should be written. */
    outDir: string;
    /** Human-readable game title (used as productName and window title). */
    appName: string;
    /** Unique reverse-DNS app id, e.g. "com.studio.mygame". */
    appId: string;
    /** Semver version string, e.g. "1.0.0". */
    version: string;
    /** Target desktop platforms. Defaults to ['win'] if empty. */
    platforms: DesktopPlatform[];
    /** Optional progress callback — called with human-readable status messages. */
    onProgress?: (msg: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Minimal Electron main.js written into the game dir before packaging.
 * The game shell simply opens a BrowserWindow and loads index.html.
 * Node integration is intentionally disabled — the game uses no Node APIs.
 */
const GAME_MAIN_JS = `
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 720,
        useContentSize: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    win.setMenu(null);
    win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (require('electron').BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
`.trimStart();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sanitise the app name into a valid npm package name. */
function toPackageName(appName: string): string {
    return appName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '') || 'game';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Package an exported web game directory into one or more desktop installers.
 *
 * electron-builder is invoked via its programmatic API so we stay in-process
 * and can relay progress messages back to the renderer via onProgress.
 *
 * @throws if electron-builder fails or the gameDir does not contain index.html.
 */
export async function packageGame(opts: PackageOptions): Promise<void> {
    const { gameDir, outDir, appName, appId, version, onProgress } = opts;
    const platforms: DesktopPlatform[] = opts.platforms.length > 0 ? opts.platforms : ['win'];

    const progress = (msg: string): void => { onProgress?.(msg); };

    // ── Validate game dir ──────────────────────────────────────────────────────
    const indexHtml = path.join(gameDir, 'index.html');
    if (!fs.existsSync(indexHtml)) {
        throw new Error(
            `packageGame: gameDir does not contain index.html.\n` +
            `Expected: ${indexHtml}\n` +
            `Make sure the web export step completed successfully first.`
        );
    }

    // ── Write electron shell files into gameDir ────────────────────────────────
    progress('Writing Electron shell into game directory…');

    const packageName = toPackageName(appName);

    const gamePkg = {
        name:    packageName,
        version: version || '1.0.0',
        main:    'main.js',
        private: true,
    };
    fs.writeFileSync(
        path.join(gameDir, 'package.json'),
        JSON.stringify(gamePkg, null, 2),
        'utf-8'
    );
    fs.writeFileSync(path.join(gameDir, 'main.js'), GAME_MAIN_JS, 'utf-8');

    // ── Build electron-builder config ─────────────────────────────────────────
    progress('Preparing electron-builder configuration…');

    fs.mkdirSync(outDir, { recursive: true });

    const config: Configuration = {
        appId:       appId || `com.game.${packageName}`,
        productName: appName,
        copyright:   `Copyright © ${new Date().getFullYear()} ${appName}`,
        directories: {
            app:    gameDir,
            output: outDir,
        },
        files: ['**/*'],
        // Disable asar so the HTML5 game assets remain as plain files.
        // This avoids module-resolution issues with pixi.js and ct.js at runtime.
        asar: false,
    };

    // Platform-specific targets
    if (platforms.includes('win')) {
        config.win = {
            target: [{ target: 'nsis', arch: ['x64'] }],
            icon:   undefined, // No icon bundled by default; add later if branding is wired
        };
        config.nsis = {
            oneClick:          true,
            allowToChangeInstallationDirectory: false,
            perMachine:        false,
        };
    }
    if (platforms.includes('mac')) {
        config.mac = {
            target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
            category: 'public.app-category.games',
        };
    }
    if (platforms.includes('linux')) {
        config.linux = {
            target: [{ target: 'AppImage', arch: ['x64'] }],
            category: 'Game',
        };
    }

    // ── Run electron-builder ───────────────────────────────────────────────────
    progress('Starting electron-builder — this may take a few minutes…');

    const cliOpts: CliOptions = {
        config,
        projectDir: gameDir,
    };

    // Select which platforms to build
    if (platforms.includes('win'))   cliOpts.win   = [];
    if (platforms.includes('mac'))   cliOpts.mac   = [];
    if (platforms.includes('linux')) cliOpts.linux = [];

    try {
        await build(cliOpts);
    } catch (err) {
        throw new Error(
            `electron-builder failed:\n${String(err instanceof Error ? err.message : err)}`
        );
    }

    progress(`Desktop packaging complete. Output: ${outDir}`);
}
