import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
    plugins: [svelte({ compilerOptions: { runes: true } })],
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            formats: ['es'],
            fileName: 'index'
        },
        rollupOptions: {
            // svelte is a peer dep — don't bundle it
            external: ['svelte', 'svelte/store', 'svelte/transition', 'svelte/animate', 'svelte/easing', '@nyx/shared'],
            output: { preserveModules: true }
        },
        outDir: 'dist'
    }
});
