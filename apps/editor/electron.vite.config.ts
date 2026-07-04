import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
    main: {
        // Exclude workspace packages from externalization so Vite bundles them
        // inline. pnpm symlinks them into node_modules, so externalizeDepsPlugin
        // would mark them external — then at runtime Node.js follows their
        // package.json exports, finds ./src/index.ts, and crashes with
        // ERR_UNKNOWN_FILE_EXTENSION because it can't load raw TypeScript.
        plugins: [externalizeDepsPlugin({ exclude: ['@nyx/shared', '@nyx/project-format'] })],
        resolve: {
            alias: {
                '@nyx/shared': resolve('../../packages/shared/src/index.ts'),
                '@nyx/project-format': resolve('../../packages/project-format/src/index.ts'),
            }
        },
        build: {
            outDir: 'out/electron',
            lib: {
                entry: resolve('electron/main.ts')
            },
            rollupOptions: {
                // electron-builder is in devDeps so externalizeDepsPlugin skips it;
                // explicitly exclude it so esbuild doesn't try to bundle app-builder-lib.
                external: ['electron-builder']
            }
        }
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            outDir: 'out/preload',
            lib: {
                entry: resolve('electron/preload.ts')
            },
            rollupOptions: {
                output: {
                    // Use .cjs extension so Electron always loads this as CommonJS,
                    // even when apps/editor/package.json has "type": "module".
                    // A plain .js file in a module-type package is treated as ESM
                    // by Node/Electron, which breaks require() in the preload.
                    format: 'cjs',
                    entryFileNames: '[name].cjs'
                }
            }
        }
    },
    renderer: {
        root: '.',
        build: {
            outDir: 'out/renderer',
            rollupOptions: {
                input: resolve('index.html'),
                output: {}
            }
        },
        plugins: [svelte()],
        resolve: {
            // Ensure browser-side exports are used (svelte, svelte/*) — prevents
            // the optimizer from baking is_browser=false into the cached bundle
            conditions: ['browser', 'import', 'module', 'default'],
            alias: {
                '@': resolve('src')
            }
        },
        optimizeDeps: {
            // Never pre-bundle svelte in Node.js — it must evaluate in the browser
            // so that is_browser = typeof window !== 'undefined' resolves to true
            exclude: ['svelte', 'svelte/internal', 'svelte/store', 'svelte/transition', 'svelte/animate', 'svelte/easing'],
            // Monaco's ESM workers must be processed by Vite's optimizer so that
            // import.meta.url-based worker construction works in the renderer.
            include: ['monaco-editor']
        },
        worker: {
            format: 'es'
        }
    }
});
