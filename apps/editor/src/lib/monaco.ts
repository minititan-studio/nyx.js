import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';

// Vite's ?worker query bundles each worker as a self-contained chunk and
// returns a Worker constructor class. This works both in dev (dev-server serves
// the worker bundle on-the-fly) and in production (Rollup emits a real chunk).
// The old getWorkerUrl approach returned a filename that only existed in the
// production build output, causing a 404 → MIME-type error in dev mode.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import TsWorker     from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import JsonWorker   from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker    from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker   from 'monaco-editor/esm/vs/language/html/html.worker?worker';

const _workerCache = new Map<string, Worker>();
(self as Record<string, unknown>).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
        if (_workerCache.has(label)) return _workerCache.get(label)!;
        let w: Worker;
        if (label === 'typescript' || label === 'javascript') w = new TsWorker();
        else if (label === 'json')                            w = new JsonWorker();
        else if (label === 'css' || label === 'scss' || label === 'less') w = new CssWorker();
        else if (label === 'html' || label === 'handlebars' || label === 'razor') w = new HtmlWorker();
        else w = new EditorWorker();
        _workerCache.set(label, w);
        return w;
    }
};

// One-time compiler settings mirroring the legacy codeEditorHelpers.js setup.
// noLib + allowNonTsExtensions avoids pulling in lib.dom.d.ts while still
// giving us type-checking for user-supplied .d.ts extras.
monaco.languages.typescript.javascriptDefaults.setEagerModelSync(false);
monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    noLib: true,
    allowNonTsExtensions: true,
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    downlevelIteration: true,
    alwaysStrict: true
});
monaco.languages.typescript.typescriptDefaults.setEagerModelSync(false);
monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    noLib: true,
    allowNonTsExtensions: true,
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    downlevelIteration: true,
    alwaysStrict: true
});

export type SupportedLanguage = 'javascript' | 'typescript' | 'coffeescript';

export interface EditorOptions {
    language?: SupportedLanguage;
    value?: string;
    readOnly?: boolean;
    theme?: string;
}

/**
 * Creates a Monaco editor instance inside `container`.
 * Caller is responsible for calling `.dispose()` when done.
 */
export function createEditor(
    container: HTMLElement,
    options: EditorOptions = {}
): monaco.editor.IStandaloneCodeEditor {
    // Lazy-load engine types on first editor open — keeps the TS worker off the
    // project selector screen where it would consume RAM with no user benefit.
    import('./nyxTypes.js').then(m => m.registerNyxTypes()).catch(() => {});
    const editor = monaco.editor.create(container, {
        value:                options.value   ?? '',
        language:             options.language ?? 'javascript',
        readOnly:             options.readOnly ?? false,
        theme:                options.theme    ?? 'vs-dark',
        minimap:              { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap:             'on',
        fontSize:             13,
        fontFamily:           'Cascadia Code, Fira Code, Consolas, monospace',
        fontLigatures:        true,
        lineHeight:           20,
        fixedOverflowWidgets: true,
        colorDecorators:      true,
        automaticLayout:      true,
        scrollbar: {
            verticalHasArrows:   true,
            horizontalHasArrows: true,
            arrowSize:           24
        },

        // ── IntelliSense UX — match VS Code defaults ──────────────────────────
        quickSuggestions:               { other: true, comments: false, strings: true },
        suggestOnTriggerCharacters:     true,
        acceptSuggestionOnEnter:        'on',
        acceptSuggestionOnCommitCharacter: true,
        tabCompletion:                  'on',
        wordBasedSuggestions:           'off',   // semantic only — no word noise
        parameterHints:                 { enabled: true, cycle: true },
        suggest: {
            showMethods:        true,
            showFunctions:      true,
            showConstructors:   true,
            showFields:         true,
            showVariables:      true,
            showClasses:        true,
            showInterfaces:     true,
            showModules:        true,
            showProperties:     true,
            showKeywords:       true,
            showConstants:      true,
            showEnums:          true,
            showEnumMembers:    true,
            showTypeParameters: true,
            showSnippets:       true,
            filterGraceful:     true,
            localityBonus:      true,   // rank nearby variables higher
        },
    });

    // Bubble Ctrl+S up to the app-level save handler rather than letting Monaco
    // consume it (same behaviour as legacy extendHotkeys in codeEditorHelpers.js).
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        document.body.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'S', code: 'KeyS', ctrlKey: true, bubbles: true })
        );
    });

    return editor;
}

export { monaco };
