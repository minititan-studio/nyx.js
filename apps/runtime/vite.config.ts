import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * apps/runtime Vite config.
 *
 * The runtime is a library bundle — it is NOT a standalone app.
 * It gets injected with project data at export time via template placeholders.
 * This config builds it as an ES module library so the editor exporter
 * can bundle it together with a game project.
 *
 * Module aliases mirror the legacy ct.release tsconfig baseUrl + paths,
 * so all bare-specifier imports (e.g. `import mainCamera from 'camera'`)
 * resolve correctly inside Vite.
 */
export default defineConfig({
    build: {
        outDir: 'dist',
        // Disable minification so /*!@placeholder@*/ markers survive into dist/nyx.js
        // and can be substituted by the Phase 8 exporter at game-export time.
        minify: false,
        lib: {
            entry: {
                'nyx':  resolve(__dirname, 'src/index.ts'),
                'pixi': resolve(__dirname, 'src/index.pixi.ts')
            },
            formats: ['es'],
            fileName: (_, entryName) => `${entryName}.js`
        },
        rollupOptions: {
            // pixi.js and @pixi/* are kept external for nyx.js only;
            // index.pixi.ts deliberately bundles them so the game gets one pixi.js
            // that includes PIXI core + @pixi/sound + @pixi/particle-emitter.
            external: (id, importer) => {
                // Only treat pixi packages as external when building nyx.js (index.ts),
                // not when building pixi.js (index.pixi.ts).
                if (!importer) return false;
                if (importer.includes('index.pixi')) return false;
                return ['pixi.js', 'pixi.js-legacy', '@pixi/sound', '@pixi/particle-emitter'].some(
                    pkg => id === pkg || id.startsWith(pkg + '/')
                );
            }
        }
    },
    resolve: {
        alias: {
            // Bare-specifier module aliases — match the legacy tsconfig paths
            'camera':      resolve(__dirname, 'src/camera.ts'),
            'index':       resolve(__dirname, 'src/index.ts'),
            'rooms':       resolve(__dirname, 'src/rooms.ts'),
            'sounds':      resolve(__dirname, 'src/sounds.ts'),
            'styles':      resolve(__dirname, 'src/styles.ts'),
            'res':         resolve(__dirname, 'src/res.ts'),
            'u':           resolve(__dirname, 'src/u.ts'),
            'fittoscreen': resolve(__dirname, 'src/fittoscreen.ts'),
            '@nyx/shared': resolve(__dirname, '../../packages/shared/src/index.ts')
        }
    }
});
