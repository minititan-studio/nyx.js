import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { electronAPI } from './electron.js';
import { patchEngineTypes, generateWidgetMapTypes } from './projectTypes.js';
import { currentProject } from '../stores/projectStore.js';

let registered = false;
let rawEngineContent = '';
let engineLibDisposable:  { dispose(): void } | null = null;
let widgetMapDisposable:  { dispose(): void } | null = null;

export async function registerNyxTypes(): Promise<void> {
    if (registered) return;
    registered = true;

    const prev = monaco.languages.typescript.typescriptDefaults.getCompilerOptions();
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        ...prev,
        noLib: false,
        target:           monaco.languages.typescript.ScriptTarget.ES2020,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        noEmit:           true,
        strict:           true,
        baseUrl: 'file:///',
        paths:   { '@nyx/engine': ['node_modules/@nyx/engine/index'] },
    });

    const api = electronAPI();

    try {
        const { content, globals, error } = await api.engine.getTypes();

        if (error || !content) {
            console.warn('[Nyx] @nyx/engine types unavailable — IntelliSense disabled.', error ?? '(empty content)');
            return;
        }

        // Store the raw content so we can re-patch it when the project changes.
        rawEngineContent = content;

        // Initial registration with unpatched types (no project loaded yet).
        engineLibDisposable = monaco.languages.typescript.typescriptDefaults.addExtraLib(
            content,
            'file:///node_modules/@nyx/engine/index.ts',
        );

        if (globals) {
            monaco.languages.typescript.typescriptDefaults.addExtraLib(
                globals,
                'file:///nyx-runtime-globals.d.ts',
            );
        }
    } catch (err) {
        console.warn('[Nyx] Could not load @nyx/engine types for Monaco:', err);
    }

    try {
        const nyxmodTypes = await api.engine.getNyxModTypes();
        if (nyxmodTypes.length > 0) {
            const combined = nyxmodTypes.map(({ content }) => content).join('\n\n');
            monaco.languages.typescript.typescriptDefaults.addExtraLib(
                combined,
                'file:///nyx-mod-types.d.ts',
            );
        }
    } catch (err) {
        console.warn('[Nyx] Could not load nyxmod types for Monaco — nyxmod IntelliSense will be unavailable:', err);
    }

    // Re-patch types when the project changes, but debounced — updateAsset() fires
    // the store on every pointermove during drags, and each addExtraLib() call sends
    // the full type file to the TypeScript worker and invalidates its analysis cache.
    // 1.5 s of inactivity is enough to catch saves/renames without hammering the worker.
    let _patchTimer: ReturnType<typeof setTimeout> | null = null;

    function applyProjectTypes(project: Parameters<typeof patchEngineTypes>[1] | null): void {
        engineLibDisposable?.dispose();
        widgetMapDisposable?.dispose();

        if (project) {
            engineLibDisposable = monaco.languages.typescript.typescriptDefaults.addExtraLib(
                patchEngineTypes(rawEngineContent, project),
                'file:///node_modules/@nyx/engine/index.ts',
            );
            widgetMapDisposable = monaco.languages.typescript.typescriptDefaults.addExtraLib(
                generateWidgetMapTypes(project),
                'file:///nyx-widget-map.d.ts',
            );
        } else {
            engineLibDisposable = monaco.languages.typescript.typescriptDefaults.addExtraLib(
                rawEngineContent,
                'file:///node_modules/@nyx/engine/index.ts',
            );
            widgetMapDisposable = null;
        }
    }

    currentProject.subscribe(project => {
        if (!rawEngineContent) return;
        if (_patchTimer !== null) clearTimeout(_patchTimer);
        _patchTimer = setTimeout(() => {
            _patchTimer = null;
            applyProjectTypes(project);
        }, 1500);
    });
}
