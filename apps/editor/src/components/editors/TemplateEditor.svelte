<script lang="ts">
    import Icon from "@iconify/svelte";
    import { get } from 'svelte/store';
    import { onMount, onDestroy, untrack } from 'svelte';
    import { signals } from '../../stores/editorStore.js';
    import { updateAsset, currentProject, projectFilePath, currentProjectDir } from '../../stores/projectStore.js';
    import { createEditor, monaco } from '../../lib/monaco.js';
    import { electronAPI } from '../../lib/electron.js';
    import type { NyxTemplate, NyxTemplatePhysics, NyxTemplateLightConfig, LightShape, TemplateBaseClass } from '@nyx/shared';
    import {
        CORE_EVENTS, EVENT_CATEGORIES,
        getEventDef, getEventDisplayName, buildMethodStub, buildMethodBodySnippet,
    } from '@nyx/shared';
    import { enabledModuleNames, availableNyxMods, loadNyxMods } from '../../stores/nyxModStore.js';
    import type { NyxModField } from '@nyx/plugin-api';
    import ColorPicker from '@nyx/ui-kit/ColorPicker.svelte';

    interface Props { asset: NyxTemplate; }
    let { asset }: Props = $props();

    // Fills in missing physics fields for templates saved before the schema was extended.
    function normalizePhysics(p: Partial<NyxTemplatePhysics>): NyxTemplatePhysics {
        return {
            enabled:        p.enabled        ?? false,
            density:        p.density        ?? 1,
            restitution:    p.restitution    ?? 0.2,
            friction:       p.friction       ?? 0.3,
            staticFriction: p.staticFriction ?? 0.1,
            airFriction:    p.airFriction    ?? 0.01,
            isStatic:       p.isStatic       ?? false,
            isSensor:       p.isSensor       ?? false,
            fixedPivot:     p.fixedPivot     ?? { x: 0, y: 0 },
            collisionGroup: p.collisionGroup ?? '',
            lockAxisX:      p.lockAxisX      ?? false,
            lockAxisY:      p.lockAxisY      ?? false,
            lockRotation:   p.lockRotation   ?? false,
            gravityScale:   p.gravityScale   ?? 1,
            kinematic:      p.kinematic      ?? false,
            constraint:     p.constraint     ?? { type: 'none', ropeLength: 64, stiffness: 0.05, damping: 0.05 },
        };
    }

    function normalizeLight(l?: Partial<NyxTemplateLightConfig>): NyxTemplateLightConfig {
        return {
            isEmitter:          l?.isEmitter          ?? false,
            textureUid:         l?.textureUid         ?? null,
            shape:              l?.shape              ?? 'soft',
            color:              l?.color              ?? '#FFFFFF',
            opacityFollowsCopy: l?.opacityFollowsCopy ?? true,
            scale:              l?.scale              ?? 1,
            lightBlocker:       l?.lightBlocker       ?? false,
            lightCastShadows:   l?.lightCastShadows   ?? false,
            lightRadius:        l?.lightRadius        ?? 100,
            lightType:          l?.lightType          ?? 'point',
            lightConeAngle:     l?.lightConeAngle     ?? 30,
        };
    }

    // ── Asset metadata state (unchanged from old editor) ─────────────────────
    let baseClass       = $state<TemplateBaseClass>(untrack(() => asset.baseClass));
    let textureUid      = $state<string | null>(untrack(() => asset.textureUid));
    let depth           = $state(untrack(() => asset.depth));
    let frame           = $state(untrack(() => asset.frame));
    let behaviors       = $state<string[]>(untrack(() => [...asset.behaviors]));
    let physics         = $state<NyxTemplatePhysics>(untrack(() => normalizePhysics(asset.physics)));
    let light           = $state<NyxTemplateLightConfig>(untrack(() => normalizeLight(asset.light)));
    let templateExtends = $state<Record<string, unknown>>(untrack(() => JSON.parse(JSON.stringify(asset.extends ?? {}))));

    let activeTab = $state<string>('general');
    let newExtKey = $state('');
    let newExtVal = $state('');

    // ── NyxMod template-extends tabs ──────────────────────────────────────────
    const moduleTabs = $derived(
        $availableNyxMods.filter(m =>
            $enabledModuleNames.has(m.name) &&
            (m.manifest.templateExtends?.length ?? 0) > 0 &&
            m.name !== 'matter' && // physics tab already provides matter's template config
            m.name !== 'light'    // light tab already provides light's template config
        )
    );

    function cleanTplKey(key: string): string { return key.split('@@')[0]; }

    function getTplField(key: string): unknown {
        return templateExtends[key] ?? '';
    }

    function setTplField(key: string, value: unknown): void {
        templateExtends = { ...templateExtends, [key]: value };
        persist();
    }

    function handleTplFieldInput(field: NyxModField, e: Event): void {
        if (!field.key) return;
        const k      = cleanTplKey(field.key);
        const target = e.target as HTMLInputElement;
        let val: unknown = target.value;
        if (field.type === 'checkbox') val = target.checked;
        else if (field.type === 'number' || field.type === 'slider' || field.type === 'sliderAndNumber') val = Number(target.value);
        setTplField(k, val);
    }

    const BASE_CLASSES: TemplateBaseClass[] = [
        'AnimatedSprite', 'Text', 'BitmapText', 'NineSlicePlane',
        'Container', 'Button', 'RepeatingTexture', 'SpritedCounter', 'TextBox', 'ScrollBox'
    ];

    // ── Script file state ─────────────────────────────────────────────────────
    let scriptContent    = $state('');
    let scriptError      = $state<string | null>(null);
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSavedContent = '';          // content we last wrote; watcher events matching this are ours
    let prevUid = untrack(() => asset.uid);

    // ── Add-event picker state ────────────────────────────────────────────────
    let showPicker = $state(false);
    interface PendingEvent {
        lib: string; eventKey: string;
        def: (typeof CORE_EVENTS)[string];
        args: Record<string, unknown>;
    }
    let pickerPending = $state<PendingEvent | null>(null);

    // ── Monaco ────────────────────────────────────────────────────────────────
    let monacoEditor: ReturnType<typeof createEditor> | undefined;
    let editorEl = $state<HTMLElement | undefined>(undefined);
    let monacoModel: monaco.editor.ITextModel | undefined;

    // ── File I/O ──────────────────────────────────────────────────────────────
    function absScriptPath(): string | null {
        const fp  = asset.scriptPath;
        const dir = get(currentProjectDir);
        if (!fp || !dir) return null;
        return `${dir}/${fp.replace(/\\/g, '/')}`;
    }

    async function loadScript() {
        const abs = absScriptPath();
        if (!abs) {
            scriptError = asset.scriptPath ? 'Save the project to load this script.' : 'No script file assigned.';
            scriptContent = '';
            return;
        }
        try {
            const { content } = await electronAPI().file.readText(abs);
            // Skip reload if the content matches what we just saved (our own watcher echo)
            if (content === lastSavedContent && lastSavedContent !== '') return;
            scriptContent = content;
            scriptError = null;
        } catch {
            scriptError = `Could not read: ${asset.scriptPath}`;
            scriptContent = '';
        }
    }

    function saveScriptDebounced() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            const abs = absScriptPath();
            if (!abs) return;
            const toSave = scriptContent;
            lastSavedContent = toSave;
            try {
                await electronAPI().file.writeText(abs, toSave);
                signals.emit('assetChanged');
            } catch (err) {
                console.error('[Nyx] Script save failed:', err);
                if (lastSavedContent === toSave) lastSavedContent = '';
            }
        }, 500);
    }

    function openInVSCode() {
        const dir = get(currentProjectDir);
        if (!dir) return;
        electronAPI().vscode.open(dir);
    }

    // ── Monaco lifecycle ──────────────────────────────────────────────────────
    $effect(() => {
        if (!editorEl || monacoEditor) return;
        monacoEditor = createEditor(editorEl, { language: 'typescript' });
        const uri   = monaco.Uri.parse(`file:///src/templates/${asset.uid}.ts`);
        monacoModel = monaco.editor.getModel(uri) ?? monaco.editor.createModel(scriptContent, 'typescript', uri);
        monacoModel.setValue(scriptContent);
        monacoEditor.setModel(monacoModel);
        monacoModel.onDidChangeContent(() => {
            scriptContent = monacoModel!.getValue();
            saveScriptDebounced();
        });
    });

    // Keep Monaco in sync when content changes from outside (file reload)
    $effect(() => {
        if (!monacoModel) return;
        if (monacoModel.getValue() !== scriptContent) {
            monacoModel.setValue(scriptContent);
        }
    });

    // Reload everything when a different asset is opened in this tab slot
    $effect(() => {
        if (asset.uid === prevUid) return;
        prevUid          = asset.uid;
        lastSavedContent = '';
        baseClass        = asset.baseClass;
        textureUid      = asset.textureUid;
        depth           = asset.depth;
        frame           = asset.frame;
        behaviors       = [...asset.behaviors];
        physics         = normalizePhysics(asset.physics);
        light           = normalizeLight(asset.light);
        templateExtends = JSON.parse(JSON.stringify(asset.extends ?? {}));

        // Recreate Monaco model for the new asset
        monacoModel?.dispose();
        monacoModel = undefined;
        if (monacoEditor) {
            const uri = monaco.Uri.parse(`file:///src/templates/${asset.uid}.ts`);
            monacoModel = monaco.editor.createModel('', 'typescript', uri);
            monacoEditor.setModel(monacoModel);
            monacoModel.onDidChangeContent(() => {
                scriptContent = monacoModel!.getValue();
                saveScriptDebounced();
            });
        }
        loadScript();
    });

    // Initial file load
    $effect(() => { loadScript(); });

    // Listen for external file changes (e.g. saved from VS Code)
    onMount(() => {
        void loadNyxMods();
        return electronAPI().script.onFileChanged(({ relativePath }) => {
            const normalized = relativePath.replace(/\\/g, '/');
            const assetPath  = (asset.scriptPath ?? '').replace(/\\/g, '/');
            if (normalized === assetPath) loadScript();
        });
    });

    onDestroy(() => {
        if (saveTimer !== undefined) {
            clearTimeout(saveTimer);
            const abs = absScriptPath();
            if (abs) electronAPI().file.writeText(abs, scriptContent);
        }
        monacoModel?.dispose();
        monacoEditor?.dispose();
    });

    // ── Persistence (metadata only — script content saved to file) ────────────
    function persist() {
        updateAsset<NyxTemplate>(asset.uid, 'template', {
            baseClass, textureUid, depth, frame, behaviors, physics, light,
            extends: templateExtends,
        });
        signals.emit('assetChanged');
    }

    // ── Derived ───────────────────────────────────────────────────────────────
    const textures    = $derived($currentProject?.textures ?? []);
    const textureName = $derived(textures.find(t => t.uid === textureUid)?.name ?? '(none)');

    const textureUrl = $derived((() => {
        const fp  = $projectFilePath;
        if (!fp || !textureUid) return '';
        const tex = textures.find(t => t.uid === textureUid);
        if (!tex?.origname) return '';
        const dir = fp.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        return `nyx-asset://localhost/${dir}/img/${encodeURIComponent(tex.origname)}`;
    })());

    const allBehaviors    = $derived(($currentProject?.behaviors ?? []).filter(b => b.behaviorType === 'template'));
    const projectActions  = $derived($currentProject?.actions ?? []);
    const physicsGroups   = $derived($currentProject?.physicsGroups ?? []);

    // Methods detected in the script file: match `methodName() {` at any indent,
    // excluding JS control-flow keywords and constructor.
    const METHOD_KEYWORDS = new Set([
        'if','for','while','switch','catch','finally','else','try','do',
        'function','return','const','let','var','throw','case','default',
    ]);
    const detectedMethods = $derived((() => {
        // Handles: async? name(...) { and name(...): ReturnType { and name(...): { x: T } {
        // \([^)(]*(?:\([^)]*\)[^)(]*)*\) matches one level of nested parens in param list
        const re = /^[ \t]*(?:async[ \t]+)?([a-zA-Z_$]\w*)[ \t]*\((?:[^)(]|\([^)]*\))*\)/gm;
        return [...scriptContent.matchAll(re)]
            .map(m => m[1])
            .filter(n => n !== 'constructor' && !METHOD_KEYWORDS.has(n));
    })());

    // Picker: events applicable to this template's baseClass
    function pickerEventsForCategory(catKey: string) {
        return Object.entries(CORE_EVENTS).filter(([, def]) => {
            if (def.category !== catKey) return false;
            if (!def.applicable.includes('template')) return false;
            if (def.baseClasses && !def.baseClasses.includes(baseClass)) return false;
            return true;
        });
    }

    // ── Event insertion ───────────────────────────────────────────────────────
    function selectPickerEvent(lib: string, eventKey: string) {
        const def = getEventDef(lib, eventKey);
        if (!def) return;
        const defaults: Record<string, unknown> = {};
        if (def.args) {
            for (const [k, a] of Object.entries(def.args)) defaults[k] = a.default ?? '';
        }
        if (def.args && Object.keys(def.args).length > 0) {
            pickerPending = { lib, eventKey, def, args: defaults };
        } else {
            insertStub(lib, eventKey, {});
        }
    }

    function insertStub(lib: string, eventKey: string, args: Record<string, unknown>) {
        const def = getEventDef(lib, eventKey);
        if (!def) return;
        const stub = buildMethodStub(lib, eventKey, args);
        if (!stub) return;

        let src = patchEngineImport(scriptContent, stub);
        const methodExists = hasMethod(src, def.methodName);

        if (methodExists && def.repeatable) {
            // Repeatable event (e.g. action) + method exists → inject condition inside it
            const snippet = buildMethodBodySnippet(lib, eventKey, args);
            src = insertSnippetIntoMethod(src, def.methodName, snippet);
        } else if (methodExists) {
            // Non-repeatable + method exists → scroll to it, do nothing
            scrollToMethod(def.methodName);
            pickerPending = null;
            showPicker = false;
            return;
        } else {
            // Method doesn't exist → append full stub before last }
            const last = src.lastIndexOf('}');
            src = last === -1
                ? src + '\n\n' + stub + '\n'
                : src.slice(0, last).trimEnd() + '\n\n' + stub + '\n}\n';
        }

        scriptContent = src;
        monacoModel?.setValue(scriptContent);
        saveScriptDebounced();
        pickerPending = null;
        showPicker = false;
    }

    /** True if the file already declares a method with this name. */
    function hasMethod(content: string, methodName: string): boolean {
        return new RegExp(`^[ \\t]*(?:async[ \\t]+)?${methodName}[ \\t]*\\(`, 'm').test(content);
    }

    /**
     * Insert `snippet` just before the closing brace of the named method.
     * Uses brace counting to find the exact closing `}`.
     */
    function insertSnippetIntoMethod(content: string, methodName: string, snippet: string): string {
        // Param group handles one level of nested parens (e.g. cb: (x: number) => void)
        const startRe = new RegExp(`^([ \\t]*(?:async[ \\t]+)?${methodName}[ \\t]*\\((?:[^)(]|\\([^)]*\\))*\\)[^{]*\\{)`, 'm');
        const startMatch = startRe.exec(content);
        if (!startMatch || startMatch.index === undefined) return content;

        const openIdx = startMatch.index + startMatch[0].length - 1; // position of '{'
        let depth = 1, i = openIdx + 1;
        while (i < content.length && depth > 0) {
            if (content[i] === '{') depth++;
            else if (content[i] === '}') depth--;
            i++;
        }
        const closeIdx = i - 1; // position of matching '}'
        return content.slice(0, closeIdx) + '\n' + snippet + '\n' + content.slice(closeIdx);
    }

    /** Add any missing @nyx/engine identifiers referenced in `stub` to the import line. */
    function patchEngineImport(content: string, stub: string): string {
        const API = ['actions', 'rooms', 'sounds', 'textures', 'u'];
        const needed = API.filter(id => new RegExp(`\\b${id}\\b`).test(stub));
        if (needed.length === 0) return content;

        const re = /import\s*\{([^}]*)\}\s*from\s*['"]@nyx\/engine['"]/;
        const m  = content.match(re);
        if (m) {
            const existing = m[1].split(',').map(s => s.trim()).filter(Boolean);
            const toAdd    = needed.filter(id => !existing.includes(id));
            if (toAdd.length === 0) return content;
            return content.replace(re, `import { ${[...existing, ...toAdd].join(', ')} } from '@nyx/engine'`);
        }
        // No existing @nyx/engine import — prepend one
        return `import { ${needed.join(', ')} } from '@nyx/engine';\n` + content;
    }

    function scrollToMethod(methodName: string) {
        if (!monacoEditor || !monacoModel) return;
        const matches = monacoModel.findMatches(`${methodName}(`, false, false, false, null, false);
        if (matches.length > 0) {
            monacoEditor.revealLineInCenter(matches[0].range.startLineNumber);
            monacoEditor.setPosition({ lineNumber: matches[0].range.startLineNumber, column: 1 });
            monacoEditor.focus();
        }
    }

    function toggleBehavior(uid: string) {
        behaviors = behaviors.includes(uid) ? behaviors.filter(b => b !== uid) : [...behaviors, uid];
        persist();
    }
</script>

<div class="template-editor">
    <!-- ── Col 1: asset properties ── -->
    <div class="props-col">
        <div class="prop-header"><h3 class="nm">{asset.name}</h3></div>

        <div class="prop-tabs">
            {#each (['general', 'physics', 'behaviors'] as const) as tab}
                <button class="prop-tab" class:active={activeTab === tab}
                        onclick={() => { activeTab = tab; }}>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
            {/each}
            {#each moduleTabs as mod (mod.name)}
                <button class="prop-tab" class:active={activeTab === mod.name}
                        onclick={() => { activeTab = mod.name; }}>
                    {mod.manifest.templateExtends![0].name}
                </button>
            {/each}
            {#if $enabledModuleNames.has('light')}
                <button class="prop-tab" class:active={activeTab === 'light'}
                        onclick={() => { activeTab = 'light'; }}>
                    Light
                </button>
            {/if}
            <button class="prop-tab" class:active={activeTab === 'extends'}
                    onclick={() => { activeTab = 'extends'; }}>
                Extends
            </button>
        </div>

        <div class="props-body">
            {#if activeTab === 'general'}
                <fieldset>
                    <legend>Base class</legend>
                    <select bind:value={baseClass} onchange={persist} class="wide-select">
                        {#each BASE_CLASSES as bc}
                            <option value={bc}>{bc}</option>
                        {/each}
                    </select>
                </fieldset>

                <fieldset>
                    <legend>Texture</legend>
                    <div class="texture-row">
                        <div class="texture-thumb" class:dim={!textureUrl}>
                            {#if textureUrl}
                                <!-- svelte-ignore a11y_missing_attribute -->
                                <img src={textureUrl} class="tex-preview" />
                            {:else if textureUid}
                                <Icon icon="feather:image" class="feather"/>
                            {:else}
                                <Icon icon="feather:slash" class="feather"/>
                            {/if}
                        </div>
                        <div class="texture-info">
                            <span class="texture-name">{textureName}</span>
                            <select bind:value={textureUid} onchange={persist} class="wide-select">
                                <option value={null}>(none)</option>
                                {#each textures as tex}
                                    <option value={tex.uid}>{tex.name}</option>
                                {/each}
                            </select>
                        </div>
                    </div>
                </fieldset>

                <fieldset>
                    <legend>Rendering</legend>
                    <div class="field-grid">
                        <span>Depth</span>
                        <input type="number" bind:value={depth} oninput={persist} />
                        <span>Frame</span>
                        <input type="number" bind:value={frame} oninput={persist} min="0" />
                    </div>
                </fieldset>
            {/if}

            {#if activeTab === 'physics'}
                <fieldset>
                    <legend>
                        <label class="checkbox-wrap inline">
                            <input type="checkbox" bind:checked={physics.enabled} onchange={persist} />
                            <span>Enable physics</span>
                        </label>
                    </legend>
                    {#if physics.enabled}
                        <div class="field-grid">
                            <span>Density</span>
                            <input type="number" bind:value={physics.density} oninput={persist} step="0.1" min="0" />
                            <span>Restitution</span>
                            <input type="number" bind:value={physics.restitution} oninput={persist} step="0.05" min="0" max="1" />
                            <span>Friction</span>
                            <input type="number" bind:value={physics.friction} oninput={persist} step="0.05" min="0" max="1" />
                            <span>Static friction</span>
                            <input type="number" bind:value={physics.staticFriction} oninput={persist} step="0.05" min="0" max="1" />
                            <span>Air friction</span>
                            <input type="number" bind:value={physics.airFriction} oninput={persist} step="0.01" min="0" />
                            <span>Is static</span>
                            <label class="checkbox-wrap">
                                <input type="checkbox" bind:checked={physics.isStatic} onchange={persist} />
                                <span>Static body</span>
                            </label>
                            <span>Is sensor</span>
                            <label class="checkbox-wrap">
                                <input type="checkbox" bind:checked={physics.isSensor} onchange={persist} />
                                <span>Sensor (no collision)</span>
                            </label>
                        </div>
                    {:else}
                        <p class="dim small">Enable physics to configure.</p>
                    {/if}
                </fieldset>

                {#if physics.enabled}
                    <fieldset>
                        <legend>Collision group</legend>
                        {#if physicsGroups.length > 0}
                            <select bind:value={physics.collisionGroup} onchange={persist}>
                                <option value="">(default — collides with all)</option>
                                {#each physicsGroups as g}
                                    <option value={g.name}>{g.name}</option>
                                {/each}
                            </select>
                        {:else}
                            <p class="dim small">No groups defined. Add groups in <strong>Project Settings → Physics</strong>.</p>
                        {/if}
                    </fieldset>

                    <fieldset>
                        <legend>Fix pivot</legend>
                        <div class="field-grid">
                            <span>X</span>
                            <input type="number" bind:value={physics.fixedPivot.x} oninput={persist} />
                            <span>Y</span>
                            <input type="number" bind:value={physics.fixedPivot.y} oninput={persist} />
                        </div>
                    </fieldset>

                    <fieldset>
                        <legend>Motion</legend>
                        <div class="field-grid">
                            <span>Gravity scale</span>
                            <input type="number" bind:value={physics.gravityScale} oninput={persist}
                                step="0.1" min="0" disabled={physics.kinematic} />
                        </div>
                        <label class="checkbox-wrap row" style="margin-top: 0.4rem;">
                            <input type="checkbox" bind:checked={physics.kinematic} onchange={persist} />
                            <span>Kinematic <span class="dim small">No gravity or drag — move via script</span></span>
                        </label>
                    </fieldset>

                    <fieldset>
                        <legend>Lock axis</legend>
                        <label class="checkbox-wrap row">
                            <input type="checkbox" bind:checked={physics.lockAxisX} onchange={persist} />
                            <span>Lock X movement</span>
                        </label>
                        <label class="checkbox-wrap row">
                            <input type="checkbox" bind:checked={physics.lockAxisY} onchange={persist} />
                            <span>Lock Y movement</span>
                        </label>
                        <label class="checkbox-wrap row">
                            <input type="checkbox" bind:checked={physics.lockRotation} onchange={persist} />
                            <span>Lock rotation</span>
                        </label>
                    </fieldset>

                    <fieldset>
                        <legend>Constraint</legend>
                        <label class="checkbox-wrap row">
                            <input type="radio" name="constraintType" value="none"
                                bind:group={physics.constraint.type} onchange={persist} />
                            <span>None</span>
                        </label>
                        <label class="checkbox-wrap row">
                            <input type="radio" name="constraintType" value="pin"
                                bind:group={physics.constraint.type} onchange={persist} />
                            <span>Pin in place <span class="dim small">Keeps position but allows rotation</span></span>
                        </label>
                        <label class="checkbox-wrap row">
                            <input type="radio" name="constraintType" value="rope"
                                bind:group={physics.constraint.type} onchange={persist} />
                            <span>Rope <span class="dim small">Creates a rope with a defined length</span></span>
                        </label>
                        {#if physics.constraint.type === 'rope'}
                            <div class="field-grid" style="margin-top: 0.4rem;">
                                <span>Rope length</span>
                                <input type="number" bind:value={physics.constraint.ropeLength} oninput={persist} step="1" min="1" />
                                <span>Rope stiffness</span>
                                <input type="number" bind:value={physics.constraint.stiffness} oninput={persist} step="0.01" min="0" max="1" />
                                <span>Rope damping</span>
                                <input type="number" bind:value={physics.constraint.damping} oninput={persist} step="0.01" min="0" max="1" />
                            </div>
                        {/if}
                    </fieldset>
                {/if}
            {/if}

            {#if activeTab === 'behaviors'}
                <fieldset>
                    <legend>Assigned behaviors</legend>
                    {#if allBehaviors.length === 0}
                        <p class="dim small">No template behaviors defined in this project.</p>
                    {:else}
                        {#each allBehaviors as beh}
                            <label class="checkbox-wrap row">
                                <input type="checkbox"
                                    checked={behaviors.includes(beh.uid)}
                                    onchange={() => toggleBehavior(beh.uid)} />
                                <span>{beh.name}</span>
                            </label>
                        {/each}
                    {/if}
                </fieldset>
            {/if}

            {#each moduleTabs as mod (mod.name)}
                {#if activeTab === mod.name}
                    {#each mod.manifest.templateExtends! as field (field.key ?? field.name)}
                        {@render tplFieldEditor(field)}
                    {/each}
                {/if}
            {/each}

            {#if activeTab === 'light' && $enabledModuleNames.has('light')}
                <!-- ── EMITTER section ──────────────────────────────────── -->
                <p class="light-section-label">Emitter</p>
                <div class="field-row">
                    <label>Enable as light emitter</label>
                    <input type="checkbox" bind:checked={light.isEmitter}
                           onchange={persist} />
                </div>
                {#if light.isEmitter}
                    <div class="field-row">
                        <label>Texture</label>
                        <select bind:value={light.textureUid}
                                onchange={persist}>
                            <option value="">(none)</option>
                            {#each textures as tex}
                                <option value={tex.uid}>{tex.name}</option>
                            {/each}
                        </select>
                    </div>
                    <div class="field-row">
                        <label>Shape (no texture)</label>
                        <select bind:value={light.shape}
                                onchange={persist}>
                            <option value="soft">Soft circle</option>
                            <option value="circle">Hard circle</option>
                            <option value="point">Point light</option>
                        </select>
                    </div>
                    <div class="field-row">
                        <label>Color</label>
                        <input type="color" bind:value={light.color}
                               oninput={persist} />
                    </div>
                    <div class="field-row">
                        <label>Scale</label>
                        <input type="number" step="0.1" bind:value={light.scale}
                               oninput={persist} />
                    </div>
                    <div class="field-row">
                        <label>Opacity follows copy</label>
                        <input type="checkbox" bind:checked={light.opacityFollowsCopy}
                               onchange={persist} />
                    </div>

                    <!-- ── SHADOW sub-section (within emitter) ──────────── -->
                    <p class="light-section-label light-indent">Shadows</p>
                    <div class="field-row light-indent">
                        <label>Cast shadows</label>
                        <input type="checkbox" bind:checked={light.lightCastShadows}
                               onchange={persist} />
                    </div>
                    {#if light.lightCastShadows}
                        <div class="field-row light-indent">
                            <label>Shadow radius (px)</label>
                            <input type="number" step="10" min="0"
                                   bind:value={light.lightRadius}
                                   oninput={persist} />
                        </div>
                        <div class="field-row light-indent">
                            <label>Light type</label>
                            <select bind:value={light.lightType}
                                    onchange={persist}>
                                <option value="point">Point (360°)</option>
                                <option value="spot">Spot (cone)</option>
                            </select>
                        </div>
                        {#if light.lightType === 'spot'}
                            <div class="field-row light-indent">
                                <label>Cone angle (deg)</label>
                                <input type="number" step="5" min="1" max="360"
                                       bind:value={light.lightConeAngle}
                                       oninput={persist} />
                            </div>
                        {/if}
                    {/if}
                {/if}

                <hr class="light-sep" />

                <!-- ── BLOCKER section (independent of emitter role) ─────── -->
                <p class="light-section-label">Blocker</p>
                <div class="field-row">
                    <label>Blocks light from others</label>
                    <input type="checkbox" bind:checked={light.lightBlocker}
                           onchange={persist} />
                </div>
            {/if}

            {#if activeTab === 'extends'}
                <fieldset>
                    <legend>Custom fields (catmod extends)</legend>
                    <p class="dim small">Per-instance values injected by catmods into copies of this template.</p>
                    {#each Object.entries(templateExtends) as [key, val]}
                        <div class="ext-row">
                            <span class="ext-key dim">{key}</span>
                            <input type="text" value={String(val)}
                                oninput={(e) => {
                                    templateExtends = { ...templateExtends, [key]: (e.target as HTMLInputElement).value };
                                    persist();
                                }} />
                            <button class="inline square" title="Remove field" onclick={() => {
                                const d = { ...templateExtends };
                                delete d[key];
                                templateExtends = d;
                                persist();
                            }}>
                                <Icon icon="feather:x" class="feather"/>
                            </button>
                        </div>
                    {/each}
                    {#if Object.keys(templateExtends).length === 0}
                        <p class="dim small">No fields. Add one below.</p>
                    {/if}
                </fieldset>
                <fieldset>
                    <legend>Add field</legend>
                    <div class="ext-add-row">
                        <input type="text" bind:value={newExtKey} placeholder="name" class="ext-key-input" />
                        <input type="text" bind:value={newExtVal} placeholder="value" />
                        <button class="inline square" onclick={() => {
                            const k = newExtKey.trim();
                            if (!k) return;
                            templateExtends = { ...templateExtends, [k]: newExtVal };
                            newExtKey = ''; newExtVal = '';
                            persist();
                        }}>
                            <Icon icon="feather:plus" class="feather"/>
                        </button>
                    </div>
                </fieldset>
            {/if}
        </div>
    </div>

    <!-- ── Col 2: script methods ── -->
    <div class="events-col">
        <div class="events-header">
            <span class="events-title">Methods</span>
            <div class="picker-wrap">
                <button class="add-event-btn" title="Add event method"
                        onclick={(e) => { e.stopPropagation(); pickerPending = null; showPicker = !showPicker; }}>
                    <Icon icon="feather:plus" class="feather"/>
                </button>
                {#if showPicker}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
                    <div class="picker-overlay" onclick={() => { showPicker = false; pickerPending = null; }}></div>
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_interactive_supports_focus -->
                    <div class="picker-dropdown" onclick={(e) => e.stopPropagation()}>
                        {#if pickerPending}
                            <!-- Args form for parametrized events -->
                            <div class="picker-args">
                                <div class="picker-args-title dim small">{pickerPending.def.name}</div>
                                {#each Object.entries(pickerPending.def.args ?? {}) as [argKey, argDef]}
                                    <div class="arg-row">
                                        <label class="arg-label dim">{argDef.name}</label>
                                        {#if argDef.type === 'action'}
                                            <select class="arg-input"
                                                    value={String(pickerPending.args[argKey] ?? '')}
                                                    onchange={(e) => { pickerPending!.args = { ...pickerPending!.args, [argKey]: (e.target as HTMLSelectElement).value }; }}>
                                                <option value="">(none)</option>
                                                {#each projectActions as action}
                                                    <option value={action.name}>{action.name}</option>
                                                {/each}
                                            </select>
                                        {:else}
                                            <input type="text" class="arg-input"
                                                   value={String(pickerPending.args[argKey] ?? '')}
                                                   oninput={(e) => { pickerPending!.args = { ...pickerPending!.args, [argKey]: (e.target as HTMLInputElement).value }; }} />
                                        {/if}
                                    </div>
                                {/each}
                                <div class="picker-args-actions">
                                    <button class="picker-insert-btn"
                                            onclick={() => insertStub(pickerPending!.lib, pickerPending!.eventKey, pickerPending!.args)}>
                                        Insert
                                    </button>
                                    <button class="picker-insert-btn secondary"
                                            onclick={() => pickerPending = null}>
                                        Back
                                    </button>
                                </div>
                            </div>
                        {:else}
                            {#each Object.entries(EVENT_CATEGORIES) as [catKey, cat]}
                                {@const catEvents = pickerEventsForCategory(catKey)}
                                {#if catEvents.length > 0}
                                    <div class="picker-cat">
                                        <Icon icon="feather:{cat.icon}" class="feather cat-icon"/>
                                        {cat.name}
                                    </div>
                                    {#each catEvents as [fullKey, def]}
                                        {@const [lib, eventKey] = [fullKey.split('_')[0], fullKey.split('_').slice(1).join('_')]}
                                        <button class="picker-item"
                                                onclick={() => selectPickerEvent(lib, eventKey)}>
                                            <Icon icon="feather:{def.icon}" class="feather"/>
                                            {def.name}
                                        </button>
                                    {/each}
                                {/if}
                            {/each}
                        {/if}
                    </div>
                {/if}
            </div>
        </div>

        {#if asset.scriptPath}
            <div class="script-path dim small">{asset.scriptPath}</div>
        {/if}

        <div class="events-list">
            {#each detectedMethods as method}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div class="event-item" onclick={() => scrollToMethod(method)}>
                    <Icon icon="feather:code" class="feather ev-icon"/>
                    <span class="event-name">{method}</span>
                </div>
            {/each}
            {#if detectedMethods.length === 0 && !scriptError}
                <p class="dim small pad">No methods detected. Click + to add.</p>
            {/if}
            {#if scriptError}
                <p class="dim small pad">{scriptError}</p>
            {/if}
        </div>
    </div>

    <!-- ── Col 3: Monaco (full .ts file) ── -->
    <div class="code-panel">
        <div class="code-header dim small">
            <Icon icon="feather:file-text" class="feather"/>
            <span class="code-path">{asset.scriptPath || 'No script file'}</span>
            <button class="inline square vscode-btn" title="Open project in VS Code" onclick={openInVSCode}>
                <Icon icon="feather:external-link" class="feather"/>
            </button>
        </div>
        {#if scriptError && !scriptContent}
            <div class="script-error">{scriptError}</div>
        {:else}
            <div bind:this={editorEl} class="code-area"></div>
        {/if}
    </div>
</div>

<!-- ── NyxMod templateExtends field renderer ────────────────────────────── -->
{#snippet tplFieldEditor(field: NyxModField)}
    {#if field.type === 'group'}
        <fieldset>
            <legend>{field.name}</legend>
            {#each field.items ?? [] as item (item.key ?? item.name)}
                {@render tplFieldEditor(item)}
            {/each}
        </fieldset>
    {:else if field.type === 'h1' || field.type === 'h2' || field.type === 'h3' || field.type === 'h4'}
        <svelte:element this={field.type} class="tpl-field-heading">{field.name}</svelte:element>
    {:else if field.key}
        {@const ck = cleanTplKey(field.key)}
        <div class="field-row">
            <label>
                {field.name}
                {#if field.help}<span class="field-help dim">{field.help}</span>{/if}
            </label>
            {#if field.type === 'checkbox'}
                <input type="checkbox"
                    checked={Boolean(getTplField(ck))}
                    onchange={(e) => handleTplFieldInput(field, e)} />
            {:else if field.type === 'number' || field.type === 'slider' || field.type === 'sliderAndNumber'}
                <input type="number"
                    value={Number(getTplField(ck) ?? field.default ?? 0)}
                    min={field.min} max={field.max} step={field.step ?? 1}
                    oninput={(e) => handleTplFieldInput(field, e)} />
            {:else if field.type === 'text'}
                <textarea
                    value={String(getTplField(ck) ?? field.default ?? '')}
                    oninput={(e) => handleTplFieldInput(field, e)}></textarea>
            {:else if field.type === 'color'}
                <ColorPicker
                    value={String(getTplField(ck) ?? field.default ?? '#000000')}
                    onchange={(c) => setTplField(ck, c)} />
            {:else if field.type === 'select' && field.options}
                <select value={String(getTplField(ck) ?? field.default ?? field.options[0]?.value ?? '')}
                        onchange={(e) => setTplField(ck, (e.target as HTMLSelectElement).value)}>
                    {#each field.options as opt (String(opt.value))}
                        <option value={String(opt.value)}>{opt.name}</option>
                    {/each}
                </select>
            {:else if field.type === 'radio' && field.options}
                <div class="radio-group">
                    {#each field.options as opt (String(opt.value))}
                        <label class="radio">
                            <input type="radio"
                                name="tpl-{ck}"
                                value={String(opt.value)}
                                checked={getTplField(ck) === opt.value}
                                onchange={() => setTplField(ck, opt.value)} />
                            {opt.name}
                            {#if opt.help}<span class="field-help dim">{opt.help}</span>{/if}
                        </label>
                    {/each}
                </div>
            {:else if field.type === 'texture' || ck !== field.key}
                <select value={String(getTplField(ck) ?? field.default ?? -1)}
                        onchange={(e) => setTplField(ck, (e.target as HTMLSelectElement).value)}>
                    <option value="-1">(none)</option>
                    {#each textures as tex (tex.uid)}
                        <option value={tex.uid}>{tex.name}</option>
                    {/each}
                </select>
            {:else}
                <input type="text"
                    value={String(getTplField(ck) ?? field.default ?? '')}
                    oninput={(e) => handleTplFieldInput(field, e)} />
            {/if}
        </div>
    {/if}
{/snippet}

<style>
    .template-editor {
        display: flex;
        flex-flow: row nowrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    /* ── Col 1: properties ── */
    .props-col {
        flex: 0 0 240px;
        background: var(--background, #1a1a2e);
        border-right: 1px solid var(--border-bright, #333);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .prop-header { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }
    h3 { font-size: 0.9rem; margin: 0; }

    .prop-tabs { display: flex; flex-shrink: 0; border-bottom: 1px solid var(--border-bright, #333); }
    .prop-tab {
        flex: 1 1 auto;
        padding: 0.3rem 0;
        border: none;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: var(--text-dim, #888);
        cursor: pointer;
        font-size: 0.78rem;
        transition: all 0.12s;
        &:hover  { color: var(--text, #e0e0e0); }
        &.active { color: var(--acttext, #7ec8e3); border-bottom-color: var(--accent1, #446adb); }
    }

    .props-body { flex: 1 1 auto; overflow-y: auto; padding: 0.75rem; }

    fieldset { border: 1px solid var(--border-pale, #2a2a3e); border-radius: 4px; padding: 0.5rem 0.75rem 0.75rem; margin-bottom: 0.6rem; }
    legend   { font-size: 0.78rem; color: var(--text-dim, #888); padding: 0 0.25rem; }

    .texture-row { display: flex; align-items: center; gap: 0.5rem; }
    .texture-thumb { width: 2.5rem; height: 2.5rem; border: 1px solid var(--border-pale, #2a2a3e); border-radius: 3px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: var(--background-deeper, #111122); overflow: hidden; }
    .tex-preview { max-width: 100%; max-height: 100%; object-fit: contain; image-rendering: pixelated; display: block; }
    .texture-info { display: flex; flex-direction: column; gap: 0.3rem; flex: 1 1 auto; }
    .texture-name { font-size: 0.78rem; color: var(--text-dim, #888); }

    .wide-select { width: 100%; }

    .field-grid { display: grid; grid-template-columns: 80px 1fr; gap: 0.3rem 0.5rem; align-items: center; }
    label { font-size: 0.78rem; color: var(--text-dim, #888); }
    .checkbox-wrap { display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; cursor: pointer; color: var(--text, #e0e0e0); &.inline { display: inline-flex; } &.row { margin: 0.2rem 0; } }

    input[type="number"], input[type="text"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.8rem;
        width: 100%;
        box-sizing: border-box;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    select {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.8rem;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .nm     { margin: 0; }
    .small  { font-size: 0.78rem; margin: 0.2rem 0; }
    .dim    { color: var(--text-dim, #888); }
    .pad    { padding: 0.5rem 0.75rem; }

    .ext-row { display: flex; align-items: center; gap: 0.3rem; margin-bottom: 0.3rem; input { flex: 1 1 auto; } }
    .ext-key { flex: 0 0 80px; font-size: 0.75rem; font-family: monospace; overflow: hidden; text-overflow: ellipsis; }
    .ext-add-row { display: flex; align-items: center; gap: 0.3rem; }
    .ext-key-input { flex: 0 0 80px; }

    /* ── Light tab section structure ── */
    .light-section-label {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-dim, #888);
        margin: 0.6rem 0 0.25rem;
        padding: 0;
    }
    .light-indent {
        padding-left: 0.9rem;
        border-left: 2px solid var(--border-pale, #2a2a3e);
    }
    .light-sep {
        border: none;
        border-top: 1px solid var(--border-pale, #2a2a3e);
        margin: 0.6rem 0;
    }

    /* ── NyxMod templateExtends field rows ── */
    .field-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.4rem;
        margin-bottom: 0.4rem;
        font-size: 0.8rem;
        label { flex: 0 0 auto; max-width: 48%; display: flex; flex-direction: column; gap: 0.1rem; }
        input[type="number"], input[type="text"], select, textarea { flex: 1 1 auto; }
        textarea { resize: vertical; min-height: 3rem; }
    }
    .field-help { font-size: 0.72rem; color: var(--text-dim, #888); }
    .radio-group { display: flex; flex-direction: column; gap: 0.2rem; }
    .radio { display: flex; align-items: center; gap: 0.3rem; cursor: pointer; font-size: 0.8rem; color: var(--text, #e0e0e0); }
    .tpl-field-heading { font-size: 0.8rem; font-weight: 600; color: var(--text-dim, #888); margin: 0.6rem 0 0.2rem; text-transform: uppercase; letter-spacing: 0.04em; }

    /* ── Col 2: methods ── */
    .events-col {
        flex: 0 0 190px;
        background: var(--background, #1a1a2e);
        border-right: 1px solid var(--border-bright, #333);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .events-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.4rem 0.5rem 0.4rem 0.75rem;
        border-bottom: 1px solid var(--border-bright, #333);
        flex-shrink: 0;
    }
    .events-title { font-size: 0.78rem; color: var(--text-dim, #888); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }

    .script-path {
        padding: 0.25rem 0.6rem;
        font-size: 0.68rem;
        font-family: monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    .picker-wrap { position: relative; }

    .add-event-btn {
        background: transparent;
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text-dim, #888);
        cursor: pointer;
        width: 1.4rem; height: 1.4rem;
        display: flex; align-items: center; justify-content: center;
        padding: 0;
        transition: all 0.12s;
        &:hover { background: var(--act, #1e2233); color: var(--acttext, #7ec8e3); border-color: var(--acttext, #7ec8e3); }
        :global(svg.feather) { width: 0.8rem; height: 0.8rem; }
    }

    .picker-overlay { position: fixed; inset: 0; z-index: 99; }

    .picker-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        z-index: 100;
        min-width: 190px;
        max-height: 340px;
        overflow-y: auto;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
        padding: 0.25rem 0;
    }

    .picker-cat {
        display: flex; align-items: center; gap: 0.4rem;
        padding: 0.3rem 0.6rem 0.15rem;
        font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--text-dim, #888);
        border-top: 1px solid var(--border-pale, #2a2a3e); margin-top: 0.2rem;
        &:first-child { border-top: none; margin-top: 0; }
        :global(svg.feather.cat-icon) { width: 0.7rem; height: 0.7rem; }
    }

    .picker-item {
        display: flex; align-items: center; gap: 0.4rem;
        width: 100%; padding: 0.25rem 0.75rem;
        background: transparent; border: none;
        color: var(--text, #e0e0e0); font-size: 0.8rem; cursor: pointer; text-align: left;
        transition: background 0.1s;
        :global(svg.feather) { width: 0.75rem; height: 0.75rem; flex-shrink: 0; }
        &:hover { background: var(--act, #1e2233); color: var(--acttext, #7ec8e3); }
    }

    .picker-args {
        padding: 0.5rem 0.75rem;
    }
    .picker-args-title { margin-bottom: 0.5rem; display: block; }
    .picker-args-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
    .picker-insert-btn {
        flex: 1; padding: 0.2rem 0.4rem; font-size: 0.78rem; cursor: pointer;
        background: var(--accent1, #446adb); border: none; border-radius: 3px;
        color: #fff; transition: opacity 0.1s;
        &:hover { opacity: 0.85; }
        &.secondary { background: var(--background-deeper, #111122); border: 1px solid var(--border-bright, #333); color: var(--text-dim, #888); }
    }

    .events-list { flex: 1 1 auto; overflow-y: auto; padding: 0.25rem 0; }

    .event-item {
        display: flex; align-items: center; gap: 0.35rem;
        padding: 0.3rem 0.4rem 0.3rem 0.6rem;
        cursor: pointer; font-size: 0.8rem; color: var(--text-dim, #888);
        border-left: 2px solid transparent; transition: all 0.1s;
        &:hover { background: var(--act, #1e2233); color: var(--text, #e0e0e0); }
        :global(svg.feather.ev-icon) { width: 0.75rem; height: 0.75rem; flex-shrink: 0; }
    }
    .event-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: monospace; font-size: 0.78rem; }

    /* Args panel (inside picker) */
    .arg-row { display: flex; flex-direction: column; gap: 0.2rem; margin-bottom: 0.4rem; }
    .arg-label { font-size: 0.72rem; }
    .arg-input { width: 100%; box-sizing: border-box; }

    /* ── Col 3: code panel ── */
    .code-panel {
        flex: 1 1 auto; display: flex; flex-direction: column;
        overflow: hidden; background: var(--background-deeper, #111122);
    }

    .code-header {
        flex-shrink: 0; display: flex; align-items: center; gap: 0.4rem;
        padding: 0.3rem 0.75rem;
        border-bottom: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        font-family: monospace;
        :global(svg.feather) { width: 0.75rem; height: 0.75rem; }
    }

    .code-area { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }
    .code-path { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vscode-btn { margin-left: auto; flex-shrink: 0; }

    .script-error {
        flex: 1 1 auto; display: flex; align-items: center; justify-content: center;
        font-size: 0.82rem; color: var(--text-dim, #888); padding: 2rem;
        text-align: center;
    }

    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.25rem 0.5rem;
        font-size: 0.82rem;
        display: inline-flex; align-items: center; gap: 0.3rem;
        transition: all 0.12s;
        &.inline { background: transparent; border-color: transparent; }
        &.square  { width: 1.5rem; height: 1.5rem; padding: 0; justify-content: center; }
        &:hover   { background: var(--act, #1e2233); border-color: var(--acttext, #7ec8e3); color: var(--acttext, #7ec8e3); }
        &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        :global(svg.feather) { width: 0.82rem; height: 0.82rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }
</style>
