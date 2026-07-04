<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * ProjectSettings.svelte
     * Migrated from: src/riotTags/project-settings/project-settings.tag
     *                src/riotTags/project-settings/tabs/main-settings.tag
     *                src/riotTags/project-settings/tabs/rendering-settings.tag
     *                src/riotTags/project-settings/tabs/actions-settings.tag
     */
    import { currentProject } from '../stores/projectStore.js';
    import NyxModsPanel from './NyxModsPanel.svelte';
    import ActionsInputSelector from './settings/ActionsInputSelector.svelte';
    import { enableModule } from '../stores/nyxModStore.js';
    import { electronAPI } from '../lib/electron.js';
    import { showConfirm, showAlert } from '../lib/dialogs.js';
    import type { NyxProjectAuthoring, NyxProjectRendering, NyxProjectAction, NyxProjectVariable, NyxProjectBranding, NyxProjectExport, IContentType, IFieldSchema, FieldSchemaType, NyxPhysicsGroup } from '@nyx/shared/types/project.js';
    import type { NyxScript } from '@nyx/shared/types/assets.js';

    type SettingsTab =
        | 'main' | 'actions' | 'branding' | 'content'
        | 'modules' | 'rendering' | 'variables' | 'scripts' | 'export' | 'physics';

    interface TabDef { id: SettingsTab; label: string; icon: string; }

    const TABS: TabDef[] = [
        { id: 'main',      label: 'Project',   icon: 'settings'  },
        { id: 'actions',   label: 'Actions',   icon: 'airplay'   },
        { id: 'branding',  label: 'Branding',  icon: 'droplet'   },
        { id: 'content',   label: 'Content',   icon: 'layers'    },
        { id: 'modules',   label: 'Modules',   icon: 'ctmod'     },
        { id: 'rendering', label: 'Rendering', icon: 'monitor'   },
        { id: 'variables', label: 'Variables', icon: 'code'      },
        { id: 'scripts',   label: 'Scripts',   icon: 'terminal'  },
        { id: 'export',    label: 'Export',    icon: 'package'   },
        { id: 'physics',   label: 'Physics',   icon: 'zap'       },
    ];

    let activeTab = $state<SettingsTab>('main');

    // ── Typed accessors — avoids casting in template ───────────────────────────
    function authoring(): NyxProjectAuthoring {
        const s = $currentProject?.settings?.authoring as Partial<NyxProjectAuthoring> | undefined;
        return {
            title:          s?.title          ?? '',
            author:         s?.author         ?? '',
            site:           s?.site           ?? '',
            version:        s?.version        ?? [1, 0, 0],
            versionPostfix: s?.versionPostfix ?? '',
            appId:          s?.appId          ?? '',
        };
    }

    function rendering(): NyxProjectRendering {
        const r = $currentProject?.settings?.rendering as Partial<NyxProjectRendering> | undefined;
        return {
            maxFPS:                  r?.maxFPS                  ?? 60,
            pixelatedrender:         r?.pixelatedrender         ?? false,
            highDensity:             r?.highDensity             ?? false,
            usePixiLegacy:           r?.usePixiLegacy           ?? false,
            transparent:             r?.transparent             ?? false,
            hideCursor:              r?.hideCursor              ?? false,
            viewMode:                r?.viewMode                ?? 'fastScale',
            desktopMode:             r?.desktopMode             ?? 'windowed',
            mobileScreenOrientation: r?.mobileScreenOrientation ?? 'unspecified',
        };
    }

    // ── Mutators — write into currentProject.settings ─────────────────────────
    function setAuthoring<K extends keyof NyxProjectAuthoring>(key: K, value: NyxProjectAuthoring[K]) {
        if (!$currentProject) return;
        const a = ($currentProject.settings.authoring ?? {}) as NyxProjectAuthoring;
        (a as Record<string, unknown>)[key] = value;
        $currentProject.settings.authoring = a;
        $currentProject = $currentProject;
    }

    function setRendering<K extends keyof NyxProjectRendering>(key: K, value: NyxProjectRendering[K]) {
        if (!$currentProject) return;
        const r = ($currentProject.settings.rendering ?? {}) as NyxProjectRendering;
        (r as Record<string, unknown>)[key] = value;
        $currentProject.settings.rendering = r;
        $currentProject = $currentProject;
    }

    function setVersionPart(idx: 0 | 1 | 2, raw: string) {
        const n = Math.max(0, parseInt(raw, 10) || 0);
        const v: [number, number, number] = [...authoring().version] as [number, number, number];
        v[idx] = n;
        setAuthoring('version', v);
    }

    // ── Actions tab state ──────────────────────────────────────────────────────
    let addingMethodForAction = $state<NyxProjectAction | null>(null);
    let nameTaken = $state<string | undefined>(undefined);

    function getActions(): NyxProjectAction[] {
        return $currentProject?.actions ?? [];
    }

    function mutateActions(fn: (actions: NyxProjectAction[]) => void) {
        if (!$currentProject) return;
        const actions = [...($currentProject.actions ?? [])];
        fn(actions);
        $currentProject.actions = actions;
        $currentProject = $currentProject;
    }

    function addNewAction() {
        mutateActions(actions => actions.push({ name: 'NewAction', methods: [] }));
    }

    async function deleteAction(action: NyxProjectAction) {
        if (!await showConfirm(`Delete action "${action.name}"?`)) return;
        mutateActions(actions => {
            const idx = actions.indexOf(action);
            if (idx > -1) actions.splice(idx, 1);
        });
    }

    function checkActionName(action: NyxProjectAction, value: string) {
        nameTaken = undefined;
        action.name = value.trim();
        const duplicate = getActions().find(a => a !== action && a.name === action.name);
        if (duplicate) nameTaken = action.name;
        $currentProject = $currentProject!;
    }

    function deleteMethod(action: NyxProjectAction, code: string) {
        mutateActions(() => {
            const idx = action.methods.findIndex(m => m.code === code);
            if (idx > -1) action.methods.splice(idx, 1);
        });
    }

    function setMethodMultiplier(action: NyxProjectAction, code: string, value: number) {
        mutateActions(() => {
            const m = action.methods.find(m => m.code === code);
            if (m) m.multiplier = value;
        });
    }

    function applyMethodSelection(action: NyxProjectAction, codes: string[]) {
        const actionName = action.name;
        currentProject.update(p => {
            if (!p) return p;
            return {
                ...p,
                actions: p.actions.map(a => {
                    if (a.name !== actionName) return a;
                    const existing = new Set(a.methods.map(m => m.code));
                    const toAdd = codes.filter(c => !existing.has(c)).map(c => ({ code: c }));
                    return toAdd.length > 0 ? { ...a, methods: [...a.methods, ...toAdd] } : a;
                }),
            };
        });
        addingMethodForAction = null;
    }

    async function ensureModulesEnabled(names: string[]) {
        await Promise.all(names.map(n => enableModule(n)));
    }

    async function addXYMovementPreset() {
        await ensureModulesEnabled(['pointer', 'gamepad', 'keyboard', 'vkeys']);
        if (!$currentProject) return;
        $currentProject.actions = [
            { name: 'MoveX', methods: [
                { code: 'keyboard.KeyD' }, { code: 'keyboard.KeyA', multiplier: -1 },
                { code: 'keyboard.ArrowRight' }, { code: 'keyboard.ArrowLeft', multiplier: -1 },
                { code: 'gamepad.Right' }, { code: 'gamepad.Left', multiplier: -1 },
                { code: 'gamepad.LStickX' }, { code: 'vkeys.Vjoy1X' },
            ]},
            { name: 'MoveY', methods: [
                { code: 'keyboard.KeyW', multiplier: -1 }, { code: 'keyboard.KeyS' },
                { code: 'keyboard.ArrowUp', multiplier: -1 }, { code: 'keyboard.ArrowDown' },
                { code: 'gamepad.Up', multiplier: -1 }, { code: 'gamepad.Down' },
                { code: 'gamepad.LStickY' }, { code: 'vkeys.Vjoy1Y' },
            ]},
            { name: 'Jump', methods: [
                { code: 'keyboard.Space' }, { code: 'vkeys.Vk2' }, { code: 'gamepad.Button1' },
            ]},
            { name: 'Sprint', methods: [
                { code: 'keyboard.ShiftLeft' }, { code: 'keyboard.ShiftRight' },
                { code: 'vkeys.Vk3' }, { code: 'gamepad.Button2' },
            ]},
            { name: 'Crouch', methods: [
                { code: 'keyboard.ControlLeft' }, { code: 'keyboard.ControlRight' },
                { code: 'vkeys.Vk4' }, { code: 'gamepad.Button3' },
            ]},
            { name: 'Shoot', methods: [
                { code: 'pointer.Primary' }, { code: 'vkeys.Vk1' },
                { code: 'gamepad.L2' }, { code: 'gamepad.R2' },
            ]},
        ];
        $currentProject = $currentProject;
    }

    async function addTouchAndMousePreset() {
        await ensureModulesEnabled(['pointer']);
        if (!$currentProject) return;
        $currentProject.actions = [
            { name: 'Press',    methods: [{ code: 'pointer.Primary' }] },
            { name: 'AltPress', methods: [{ code: 'pointer.Secondary' }, { code: 'pointer.Double' }] },
            { name: 'Scale',    methods: [{ code: 'pointer.DeltaPinch' }, { code: 'pointer.Wheel' }] },
        ];
        $currentProject = $currentProject;
    }

    async function importCustomPreset() {
        const result = await electronAPI().dialog.showOpenDialog({
            title: 'Import action preset',
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile'],
        });
        if (result.canceled || !result.filePaths[0]) return;
        try {
            const text = await (await fetch(`file://${result.filePaths[0]}`)).text();
            const preset = JSON.parse(text);
            if (!preset?.actions) { await showAlert('Not a valid ct.js action preset.'); return; }
            if (preset.inputModules?.length) await ensureModulesEnabled(preset.inputModules);
            if (!$currentProject) return;
            $currentProject.actions = preset.actions;
            $currentProject = $currentProject;
        } catch {
            await showAlert('Failed to import preset.');
        }
    }

    async function exportActionPreset() {
        if (!$currentProject) return;
        const title = ($currentProject.settings?.authoring as { title?: string } | undefined)?.title ?? 'ct.js project';
        const result = await electronAPI().dialog.showSaveDialog({
            title: 'Export action preset',
            defaultPath: `Actions from ${title}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return;
        const modules = new Set<string>();
        for (const action of $currentProject.actions) {
            for (const method of action.methods) {
                modules.add(method.code.split('.').slice(0, -1).join('.'));
            }
        }
        const writeData = { inputModules: [...modules], actions: $currentProject.actions };
        await electronAPI().file.writeText(result.filePath, JSON.stringify(writeData, null, 2));
    }

    // ── Variables tab logic ────────────────────────────────────────────────────
    const VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z_0-9]*$/;

    const RESERVED_NAMES = new Set([
        // nyx.js runtime names
        'actions','backgrounds','behaviors','Camera','camera','CtAction','content',
        'emitters','inputs','res','rooms','scripts','sounds','styles','templates',
        'Tilemap','Tile','tilemaps','timer','u','meta','settings','pixiApp',
        // JS keywords
        'break','case','catch','class','const','continue','debugger','default',
        'delete','do','else','export','extends','finally','for','function','if',
        'import','in','instanceof','let','new','return','super','switch','this',
        'throw','try','typeof','var','void','while','with','yield',
    ]);

    function validateVariableName(name: string): boolean {
        return name.trim() !== '' && VARIABLE_NAME_PATTERN.test(name);
    }

    function getCleanVariableValue(v: NyxProjectVariable): string | number | boolean {
        if (v.type === 'raw' || v.type === 'number') return v.value;
        if (v.type === 'boolean') return v.value === 'true';
        try { return JSON.parse(v.value); } catch { return v.value; }
    }

    function mutateVars(fn: (vars: NyxProjectVariable[]) => void) {
        if (!$currentProject) return;
        const vars = [...($currentProject.globalVars ?? [])];
        fn(vars);
        $currentProject.globalVars = vars;
        $currentProject = $currentProject;
    }

    function addNewVariable() {
        const vars = $currentProject?.globalVars ?? [];
        let name = 'globalVar';
        let n = 1;
        while (vars.some(v => v.name === name)) name = `globalVar${n++}`;
        mutateVars(vs => vs.push({ name, type: 'number', value: '0' }));
    }

    function removeVariable(index: number) {
        mutateVars(vs => vs.splice(index, 1));
    }

    function renameVariable(index: number, newName: string) {
        mutateVars(vs => { vs[index].name = newName.trim(); });
    }

    function changeVariableType(index: number, newType: NyxProjectVariable['type']) {
        mutateVars(vs => {
            const v = vs[index];
            if (v.type === newType) return;
            if (newType === 'string')  v.value = JSON.stringify(v.value);
            else if (newType === 'number')  v.value = (Number(v.value) || 0).toString();
            else if (newType === 'boolean') v.value = Boolean(v.value).toString();
            v.type = newType;
        });
    }

    function updateVariableValue(index: number, e: Event) {
        const v = $currentProject?.globalVars?.[index];
        if (!v) return;
        const input = e.target as HTMLInputElement | HTMLTextAreaElement;
        mutateVars(vs => {
            if (vs[index].type === 'boolean') {
                vs[index].value = (input as HTMLInputElement).checked.toString();
            } else if (vs[index].type === 'number' || vs[index].type === 'raw') {
                vs[index].value = input.value;
            } else {
                vs[index].value = JSON.stringify(input.value);
            }
        });
    }

    // ── Branding tab ──────────────────────────────────────────────────────────
    function branding(): NyxProjectBranding {
        const b = $currentProject?.settings?.branding as Partial<NyxProjectBranding> | undefined;
        return {
            icon:                      b?.icon                      ?? '',
            splashScreen:              b?.splashScreen              ?? '',
            forceSmoothIcons:          b?.forceSmoothIcons          ?? false,
            forceSmoothSplashScreen:   b?.forceSmoothSplashScreen   ?? false,
            accent:                    b?.accent                    ?? '#446adb',
            invertPreloaderScheme:     b?.invertPreloaderScheme     ?? false,
            hideLoadingLogo:           b?.hideLoadingLogo           ?? false,
            alternativeLogo:           b?.alternativeLogo           ?? false,
            customLoadingText:         b?.customLoadingText         ?? '',
        };
    }

    function setBranding<K extends keyof NyxProjectBranding>(key: K, value: NyxProjectBranding[K]) {
        if (!$currentProject) return;
        const b = ($currentProject.settings.branding ?? {}) as NyxProjectBranding;
        (b as Record<string, unknown>)[key] = value;
        $currentProject.settings.branding = b;
        $currentProject = $currentProject;
    }

    // ── Export tab ────────────────────────────────────────────────────────────
    function exportSettings(): NyxProjectExport {
        const e = $currentProject?.settings?.export as Partial<NyxProjectExport> | undefined;
        return {
            showErrors:        e?.showErrors        ?? true,
            errorsLink:        e?.errorsLink        ?? '',
            autocloseDesktop:  e?.autocloseDesktop  ?? false,
            codeModifier:      e?.codeModifier      ?? 'none',
            bundleAssetTree:   e?.bundleAssetTree   ?? false,
            bundleAssetTypes:  e?.bundleAssetTypes  ?? {
                texture: true, template: true, room: true, behavior: true,
                script: true, font: true, sound: true, style: true, tandem: true,
            },
        };
    }

    function setExport<K extends keyof NyxProjectExport>(key: K, value: NyxProjectExport[K]) {
        if (!$currentProject) return;
        const ex = ($currentProject.settings.export ?? {}) as NyxProjectExport;
        (ex as Record<string, unknown>)[key] = value;
        $currentProject.settings.export = ex;
        $currentProject = $currentProject;
    }

    function setBundleAssetType(type: keyof NyxProjectExport['bundleAssetTypes'], checked: boolean) {
        if (!$currentProject) return;
        const ex = ($currentProject.settings.export ?? {}) as NyxProjectExport;
        const types = { ...(ex.bundleAssetTypes ?? {}) } as NyxProjectExport['bundleAssetTypes'];
        types[type] = checked;
        ex.bundleAssetTypes = types;
        $currentProject.settings.export = ex;
        $currentProject = $currentProject;
    }

    const ASSET_TYPE_KEYS: Array<keyof NyxProjectExport['bundleAssetTypes']> = [
        'texture','template','room','behavior','script','font','sound','style','tandem',
    ];

    // ── Physics groups tab ─────────────────────────────────────────────────────
    function getPhysicsGroups(): NyxPhysicsGroup[] {
        return $currentProject?.physicsGroups ?? [];
    }

    function mutatePhysicsGroups(fn: (groups: NyxPhysicsGroup[]) => void) {
        if (!$currentProject) return;
        const groups = [...($currentProject.physicsGroups ?? [])];
        fn(groups);
        $currentProject.physicsGroups = groups;
        $currentProject = $currentProject;
    }

    function addPhysicsGroup() {
        if (getPhysicsGroups().length >= 32) return;
        mutatePhysicsGroups(groups => groups.push({ name: `Group${groups.length + 1}`, mask: -1 }));
    }

    async function deletePhysicsGroup(index: number) {
        const name = getPhysicsGroups()[index]?.name ?? '';
        if (!await showConfirm(`Delete physics group "${name}"? Templates using it will fall back to the default group.`)) return;
        mutatePhysicsGroups(groups => {
            groups.splice(index, 1);
            // Rebuild masks: removed group shifts all higher bits down
            for (const g of groups) {
                const lo = g.mask & ((1 << index) - 1);
                const hi = (g.mask >> (index + 1)) << index;
                g.mask = lo | hi;
            }
        });
    }

    function renamePhysicsGroup(index: number, value: string) {
        mutatePhysicsGroups(groups => { groups[index].name = value.trim() || groups[index].name; });
    }

    function groupsCollide(groups: NyxPhysicsGroup[], i: number, j: number): boolean {
        if (i >= groups.length || j >= groups.length) return true;
        return (groups[i].mask & (1 << j)) !== 0;
    }

    function toggleCollision(i: number, j: number) {
        mutatePhysicsGroups(groups => {
            const catI = 1 << i;
            const catJ = 1 << j;
            const colliding = (groups[i].mask & catJ) !== 0;
            if (colliding) {
                groups[i].mask &= ~catJ;
                if (i !== j) groups[j].mask &= ~catI;
            } else {
                groups[i].mask |= catJ;
                if (i !== j) groups[j].mask |= catI;
            }
        });
    }

    // ── Scripts tab ───────────────────────────────────────────────────────────
    let selectedScript = $state<NyxScript | null>(null);

    function addNewProjectScript() {
        if (!$currentProject) return;
        const names = $currentProject.scripts.map(s => s.name);
        let name = 'New Script';
        let n = 1;
        while (names.includes(name)) name = `New Script ${n++}`;
        const script: NyxScript = {
            uid: crypto.randomUUID(),
            name,
            code: '',
            language: 'javascript',
        };
        $currentProject.scripts = [...$currentProject.scripts, script];
        $currentProject = $currentProject;
        selectedScript = script;
    }

    async function deleteProjectScript(script: NyxScript) {
        if (!$currentProject) return;
        if (!await showConfirm(`Delete script "${script.name}"?`)) return;
        $currentProject.scripts = $currentProject.scripts.filter(s => s !== script);
        $currentProject = $currentProject;
        if (selectedScript === script) selectedScript = $currentProject.scripts[0] ?? null;
    }

    function moveScriptUp(script: NyxScript) {
        if (!$currentProject) return;
        const arr = [...$currentProject.scripts];
        const idx = arr.indexOf(script);
        if (idx <= 0) return;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        $currentProject.scripts = arr;
        $currentProject = $currentProject;
    }

    function moveScriptDown(script: NyxScript) {
        if (!$currentProject) return;
        const arr = [...$currentProject.scripts];
        const idx = arr.indexOf(script);
        if (idx < 0 || idx >= arr.length - 1) return;
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        $currentProject.scripts = arr;
        $currentProject = $currentProject;
    }

    function updateScriptCode(script: NyxScript, value: string) {
        if (!$currentProject) return;
        script.code = value;
        $currentProject = $currentProject;
    }

    function updateScriptName(script: NyxScript, value: string) {
        if (!$currentProject) return;
        script.name = value.trim();
        $currentProject = $currentProject;
    }

    // ── Content tab ───────────────────────────────────────────────────────────
    let selectedContentTypeIndex = $state<number>(-1);
    let contentView = $state<'types' | 'entries'>('types');

    const FIELD_TYPE_OPTIONS: Array<{ value: FieldSchemaType; label: string }> = [
        { value: 'text',            label: 'Text' },
        { value: 'textfield',       label: 'Text field (multiline)' },
        { value: 'code',            label: 'Code' },
        { value: 'number',          label: 'Number' },
        { value: 'sliderAndNumber', label: 'Slider & number' },
        { value: 'checkbox',        label: 'Checkbox' },
        { value: 'color',           label: 'Color' },
        { value: 'texture',         label: 'Texture (UID)' },
        { value: 'template',        label: 'Template (UID)' },
        { value: 'room',            label: 'Room (UID)' },
        { value: 'sound',           label: 'Sound (UID)' },
        { value: 'tandem',          label: 'Emitter tandem (UID)' },
        { value: 'typeface',        label: 'Font (UID)' },
        { value: 'behavior',        label: 'Behavior (UID)' },
        { value: 'script',          label: 'Script (UID)' },
        { value: 'style',           label: 'Style (UID)' },
    ];

    function contentFieldTypeOptions(): Array<{ value: FieldSchemaType; label: string }> {
        const enums = $currentProject?.enums ?? [];
        return [
            ...FIELD_TYPE_OPTIONS,
            ...enums.map(e => ({ value: `enum@${e.uid}` as FieldSchemaType, label: `Enum: ${e.name}` })),
        ];
    }

    function mutateContentTypes(fn: (types: IContentType[]) => void) {
        if (!$currentProject) return;
        const types: IContentType[] = JSON.parse(JSON.stringify($currentProject.contentTypes ?? []));
        fn(types);
        $currentProject.contentTypes = types;
        $currentProject = $currentProject;
    }

    function addContentType() {
        if (!$currentProject) return;
        const existing = $currentProject.contentTypes ?? [];
        let name = 'contentType';
        let n = 1;
        while (existing.some(ct => ct.name === name)) name = `contentType${n++}`;
        mutateContentTypes(types => types.push({ name, readableName: '', icon: 'copy', specification: [], entries: [] }));
        selectedContentTypeIndex = ($currentProject.contentTypes ?? []).length - 1;
        contentView = 'types';
    }

    async function deleteContentType(index: number) {
        if (!await showConfirm('Delete this content type?', 'All its entries will be lost.')) return;
        mutateContentTypes(types => types.splice(index, 1));
        const newLen = ($currentProject?.contentTypes ?? []).length;
        selectedContentTypeIndex = newLen > 0 ? Math.min(index, newLen - 1) : -1;
        contentView = 'types';
    }

    function setContentTypeProp<K extends keyof IContentType>(index: number, key: K, value: IContentType[K]) {
        mutateContentTypes(types => { (types[index] as Record<string, unknown>)[key as string] = value; });
    }

    function addSpecField(typeIndex: number) {
        mutateContentTypes(types => types[typeIndex].specification.push({
            name: '', readableName: '', type: 'text', required: false, structure: 'atomic',
        }));
    }

    function removeSpecField(typeIndex: number, fieldIndex: number) {
        mutateContentTypes(types => types[typeIndex].specification.splice(fieldIndex, 1));
    }

    function setSpecField<K extends keyof IFieldSchema>(typeIndex: number, fieldIndex: number, key: K, value: IFieldSchema[K]) {
        mutateContentTypes(types => {
            (types[typeIndex].specification[fieldIndex] as Record<string, unknown>)[key as string] = value;
        });
    }

    function defaultEntryValue(field: IFieldSchema): unknown {
        if (field.structure === 'array') return [];
        if (field.structure === 'map')   return {};
        switch (field.type) {
            case 'checkbox':        return false;
            case 'number':
            case 'sliderAndNumber': return 0;
            case 'color':           return '#ffffff';
            default:                return '';
        }
    }

    function addContentEntry(typeIndex: number) {
        mutateContentTypes(types => {
            const spec = types[typeIndex].specification;
            const entry: Record<string, unknown> = {};
            for (const f of spec) entry[f.name] = defaultEntryValue(f);
            types[typeIndex].entries.push(entry);
        });
    }

    function removeContentEntry(typeIndex: number, entryIndex: number) {
        mutateContentTypes(types => types[typeIndex].entries.splice(entryIndex, 1));
    }

    function setEntryValue(typeIndex: number, entryIndex: number, fieldName: string, value: unknown) {
        if (!$currentProject) return;
        const ct = $currentProject.contentTypes[typeIndex];
        if (!ct) return;
        ct.entries[entryIndex][fieldName] = value;
        $currentProject = $currentProject;
    }

    const VIEW_MODES: Array<{ value: NyxProjectRendering['viewMode']; label: string; desc: string }> = [
        { value: 'asIs',             label: 'As is',               desc: 'No scaling applied' },
        { value: 'fastScale',        label: 'Fast scale',          desc: 'Scale to fit, keep aspect ratio' },
        { value: 'fastScaleInteger', label: 'Fast scale (integer)', desc: 'Integer scaling only' },
        { value: 'expand',           label: 'Expand',              desc: 'Expand viewport to fill screen' },
        { value: 'scaleFit',         label: 'Scale fit',           desc: 'Scale to fit with letterboxing' },
        { value: 'scaleFill',        label: 'Scale fill',          desc: 'Scale to fill, crop edges' },
    ];
</script>

<!-- ══ Project Settings ═══════════════════════════════════════════════════════ -->
<div class="project-settings aPanel aView flexrow">

    <!-- ── Sidebar nav ──────────────────────────────────────────────────────── -->
    <aside class="nogrow noshrink">
        <ul class="aNav vertical nbr">
            {#each TABS as tab (tab.id)}
                <li
                    class:active={activeTab === tab.id}
                    title={tab.label}
                    role="tab"
                    tabindex="0"
                    onclick={() => activeTab = tab.id}
                    onkeydown={(e) => e.key === 'Enter' && (activeTab = tab.id)}
                >
                    <Icon icon={`feather:${tab.icon}`} class="feather"/>
                    <span>{tab.label}</span>
                </li>
            {/each}
        </ul>
    </aside>

    <!-- ── Main content ──────────────────────────────────────────────────────── -->
    <main class="tall">

        <!-- ── Main / Project tab ──────────────────────────────────────────── -->
        {#if activeTab === 'main'}
            {#if $currentProject}
            {@const a = authoring()}
            <div class="settings-panel pad">
                <h2>Project</h2>

                <fieldset>
                    <label class="block">
                        <b>Project title</b>
                        <input type="text" value={a.title}
                               oninput={(e) => setAuthoring('title', (e.target as HTMLInputElement).value)} />
                    </label>
                    <label class="block">
                        <b>Author</b>
                        <input type="text" value={a.author}
                               oninput={(e) => setAuthoring('author', (e.target as HTMLInputElement).value)} />
                    </label>
                    <label class="block">
                        <b>Site / URL</b>
                        <input type="text" value={a.site}
                               oninput={(e) => setAuthoring('site', (e.target as HTMLInputElement).value)} />
                    </label>
                </fieldset>

                <fieldset>
                    <b>Version</b>
                    <div class="version-row">
                        <input class="short" type="number" min="0" value={a.version[0]}
                               onchange={(e) => setVersionPart(0, (e.target as HTMLInputElement).value)} />
                        <span>.</span>
                        <input class="short" type="number" min="0" value={a.version[1]}
                               onchange={(e) => setVersionPart(1, (e.target as HTMLInputElement).value)} />
                        <span>.</span>
                        <input class="short" type="number" min="0" value={a.version[2]}
                               onchange={(e) => setVersionPart(2, (e.target as HTMLInputElement).value)} />
                        <input class="postfix" type="text" placeholder="e.g. beta"
                               value={a.versionPostfix}
                               oninput={(e) => setAuthoring('versionPostfix', (e.target as HTMLInputElement).value)} />
                    </div>
                </fieldset>

                <fieldset>
                    <label class="block">
                        <b>App ID</b>
                        <small>Reverse-domain identifier, e.g. com.studio.mygame</small>
                        <input type="text" value={a.appId}
                               oninput={(e) => setAuthoring('appId', (e.target as HTMLInputElement).value)} />
                    </label>
                </fieldset>

                <fieldset>
                    <label class="block">
                        <b>Backup copies</b>
                        <small>Number of auto-backups to keep (0 = disabled)</small>
                        <input class="short" type="number" min="0" max="25"
                               value={$currentProject.backups ?? 3}
                               onchange={(e) => {
                                   if ($currentProject) {
                                       $currentProject.backups = Math.max(0, parseInt((e.target as HTMLInputElement).value, 10) || 0);
                                       $currentProject = $currentProject;
                                   }
                               }} />
                    </label>
                </fieldset>
            </div>
            {/if}

        <!-- ── Rendering tab ───────────────────────────────────────────────── -->
        {:else if activeTab === 'rendering'}
            {#if $currentProject}
            {@const r = rendering()}
            <div class="settings-panel pad">
                <h2>Rendering</h2>

                <fieldset>
                    <label class="block">
                        <b>Max FPS</b>
                        <input class="short" type="number" min="1" value={r.maxFPS}
                               onchange={(e) => setRendering('maxFPS', Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 60))} />
                    </label>
                </fieldset>

                <fieldset>
                    <label class="block checkbox">
                        <input type="checkbox" checked={r.pixelatedrender}
                               onchange={(e) => setRendering('pixelatedrender', (e.target as HTMLInputElement).checked)} />
                        <span>Pixelated render — disables anti-aliasing, ideal for pixel art</span>
                    </label>
                    <label class="block checkbox">
                        <input type="checkbox" checked={r.highDensity}
                               onchange={(e) => setRendering('highDensity', (e.target as HTMLInputElement).checked)} />
                        <span>High-density display support (retina / HiDPI)</span>
                    </label>
                    <label class="block checkbox">
                        <input type="checkbox" checked={r.usePixiLegacy}
                               onchange={(e) => setRendering('usePixiLegacy', (e.target as HTMLInputElement).checked)} />
                        <span>Use PixiJS legacy renderer (WebGL 1 fallback)</span>
                    </label>
                    <label class="block checkbox">
                        <input type="checkbox" checked={r.transparent}
                               onchange={(e) => setRendering('transparent', (e.target as HTMLInputElement).checked)} />
                        <span>Transparent canvas background</span>
                    </label>
                    <label class="block checkbox">
                        <input type="checkbox" checked={r.hideCursor}
                               onchange={(e) => setRendering('hideCursor', (e.target as HTMLInputElement).checked)} />
                        <span>Hide system cursor over the game canvas</span>
                    </label>
                </fieldset>

                <h3>Viewport mode</h3>
                <fieldset>
                    {#each VIEW_MODES as vm}
                        <label class="block checkbox">
                            <input type="radio" name="viewMode" value={vm.value}
                                   checked={r.viewMode === vm.value}
                                   onchange={() => setRendering('viewMode', vm.value)} />
                            <span><b>{vm.label}</b> — {vm.desc}</span>
                        </label>
                    {/each}
                </fieldset>

                <h3>Desktop builds</h3>
                <fieldset>
                    <b>Launch mode</b>
                    {#each (['maximized', 'fullscreen', 'windowed'] as const) as mode}
                        <label class="checkbox">
                            <input type="radio" name="desktopMode" value={mode}
                                   checked={r.desktopMode === mode}
                                   onchange={() => setRendering('desktopMode', mode)} />
                            <span>{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                        </label>
                    {/each}
                </fieldset>

                <h3>Mobile builds</h3>
                <fieldset>
                    <b>Screen orientation</b>
                    {#each (['unspecified', 'landscape', 'portrait'] as const) as ori}
                        <label class="checkbox">
                            <input type="radio" name="mobileOrientation" value={ori}
                                   checked={r.mobileScreenOrientation === ori}
                                   onchange={() => setRendering('mobileScreenOrientation', ori)} />
                            <span>{ori.charAt(0).toUpperCase() + ori.slice(1)}</span>
                        </label>
                    {/each}
                </fieldset>

                <h3>Physics</h3>
                <fieldset>
                    <label class="block checkbox">
                        <input type="checkbox"
                               checked={Boolean($currentProject?.modules?.matter?.debugMatterMarquee)}
                               onchange={(e) => {
                                   if (!$currentProject) return;
                                   $currentProject.modules.matter = {
                                       ...($currentProject.modules.matter ?? {}),
                                       debugMatterMarquee: (e.target as HTMLInputElement).checked,
                                   };
                                   $currentProject = $currentProject;
                               }} />
                        <span>Show physics body outlines (Matter.js debug overlay)</span>
                    </label>
                </fieldset>
            </div>
            {/if}

        <!-- ── Actions tab ────────────────────────────────────────────────── -->
        {:else if activeTab === 'actions'}
            {#if $currentProject}
            {@const actions = getActions()}
            <div class="settings-panel pad">
                <h2>Actions &amp; Input</h2>

                {#if actions.length === 0}
                    <!-- Empty state -->
                    <p class="dim">No actions defined yet.</p>
                    <div class="button-group">
                        <button class="nml" onclick={addNewAction}>
                            <Icon icon="feather:plus" class="feather"/>
                            <span>Make from scratch</span>
                        </button>
                    </div>
                    <h3>Presets</h3>
                    <div class="button-group">
                        <button class="nml" onclick={addXYMovementPreset}>
                            <Icon icon="feather:move" class="feather"/>
                            <span>XY Movement (keyboard + gamepad)</span>
                        </button>
                        <button class="nml" onclick={addTouchAndMousePreset}>
                            <Icon icon="feather:smartphone" class="feather"/>
                            <span>Touch &amp; Mouse</span>
                        </button>
                        <button class="nml" onclick={importCustomPreset}>
                            <Icon icon="feather:download" class="feather"/>
                            <span>Import preset…</span>
                        </button>
                    </div>
                {:else}
                    <!-- Action list header -->
                    <div class="actions-header hide-small">
                        <div class="col-name"><b>Action name</b></div>
                        <div class="col-methods"><b>Input methods</b></div>
                    </div>

                    <!-- Action rows -->
                    {#each actions as action}
                        <div class="action-row">
                            <!-- Name column -->
                            <div class="col-name">
                                <div class="name-field">
                                    <input
                                        type="text"
                                        placeholder="Action name"
                                        value={action.name}
                                        onchange={(e) => checkActionName(action, (e.target as HTMLInputElement).value)}
                                    />
                                    {#if nameTaken === action.name}
                                        <span class="anErrorNotice">Name already taken</span>
                                    {/if}
                                    {#if action.name.trim() === ''}
                                        <span class="anErrorNotice">Cannot be empty</span>
                                    {/if}
                                </div>
                            </div>

                            <!-- Methods column -->
                            <div class="col-methods">
                                <ul class="aStripedList method-list">
                                    {#each action.methods as method}
                                        <li class="method-row">
                                            <code class="inline">{method.code}</code>
                                            <div class="multiplier-field">
                                                <span class="dim">×</span>
                                                <input
                                                    class="short"
                                                    type="number"
                                                    step="0.1"
                                                    value={method.multiplier ?? 1}
                                                    onchange={(e) => setMethodMultiplier(action, method.code, parseFloat((e.target as HTMLInputElement).value) || 1)}
                                                />
                                            </div>
                                            <button
                                                class="icon-btn"
                                                title="Remove method"
                                                onclick={() => deleteMethod(action, method.code)}
                                            >
                                                <Icon icon="feather:x" class="feather"/>
                                            </button>
                                        </li>
                                    {/each}
                                </ul>
                                <button class="nml small" onclick={() => addingMethodForAction = action}>
                                    <Icon icon="feather:plus" class="feather"/>
                                    <span>Add method</span>
                                </button>
                            </div>

                            <!-- Delete action button -->
                            <button class="icon-btn danger" title="Delete action" onclick={() => deleteAction(action)}>
                                <Icon icon="feather:x" class="feather"/>
                            </button>
                        </div>
                    {/each}

                    <!-- Footer buttons -->
                    <div class="button-group mt">
                        <button class="nml" onclick={addNewAction}>
                            <Icon icon="feather:plus" class="feather"/>
                            <span>Add action</span>
                        </button>
                        <button class="nml secondary" onclick={exportActionPreset}>
                            <Icon icon="feather:upload" class="feather"/>
                            <span>Export preset</span>
                        </button>
                    </div>
                {/if}
            </div>

            <!-- Input selector overlay -->
            {#if addingMethodForAction}
                <ActionsInputSelector
                    action={addingMethodForAction}
                    onApply={(codes) => applyMethodSelection(addingMethodForAction!, codes)}
                    onCancel={() => addingMethodForAction = null}
                />
            {/if}
            {/if}

        <!-- ── Modules tab ─────────────────────────────────────────────────── -->
        {:else if activeTab === 'modules'}
            <NyxModsPanel />

        <!-- ── Variables tab ───────────────────────────────────────────────── -->
        {:else if activeTab === 'variables'}
            {#if $currentProject}
            {@const globalVars = $currentProject.globalVars ?? []}
            <div class="settings-panel pad">
                <h2>Global Variables</h2>

                <div class="aTableWrap">
                    <table class="aNiceTable vars-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Default value</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each globalVars as variable, index}
                                <tr>
                                    <!-- Name -->
                                    <td>
                                        <input
                                            type="text"
                                            value={variable.name}
                                            onchange={(e) => renameVariable(index, (e.target as HTMLInputElement).value)}
                                        />
                                        {#if !validateVariableName(variable.name)}
                                            <div class="var-error">
                                                <Icon icon="feather:alert-triangle" class="feather"/>
                                                Invalid name
                                            </div>
                                        {:else if RESERVED_NAMES.has(variable.name)}
                                            <div class="var-error">
                                                <Icon icon="feather:alert-triangle" class="feather"/>
                                                Reserved name
                                            </div>
                                        {/if}
                                    </td>

                                    <!-- Type -->
                                    <td>
                                        <select
                                            value={variable.type}
                                            onchange={(e) => changeVariableType(index, (e.target as HTMLSelectElement).value as NyxProjectVariable['type'])}
                                        >
                                            <option value="string">string</option>
                                            <option value="number">number</option>
                                            <option value="boolean">boolean</option>
                                            <option value="raw">raw (JS)</option>
                                        </select>
                                    </td>

                                    <!-- Default value -->
                                    <td>
                                        {#if variable.type === 'boolean'}
                                            <label class="checkbox">
                                                <input
                                                    type="checkbox"
                                                    checked={variable.value === 'true'}
                                                    onchange={(e) => updateVariableValue(index, e)}
                                                />
                                                <code class="monospace">{variable.value}</code>
                                            </label>
                                        {:else if variable.type === 'raw'}
                                            <textarea
                                                class="monospace wide"
                                                rows="2"
                                                value={getCleanVariableValue(variable).toString()}
                                                onchange={(e) => updateVariableValue(index, e)}
                                            ></textarea>
                                        {:else}
                                            <input
                                                type={variable.type === 'number' ? 'number' : 'text'}
                                                value={getCleanVariableValue(variable).toString()}
                                                onchange={(e) => updateVariableValue(index, e)}
                                            />
                                        {/if}
                                    </td>

                                    <!-- Delete -->
                                    <td>
                                        <button class="icon-btn danger" title="Remove variable" onclick={() => removeVariable(index)}>
                                            <Icon icon="feather:delete" class="feather"/>
                                        </button>
                                    </td>
                                </tr>
                            {/each}

                            {#if globalVars.length === 0}
                                <tr>
                                    <td colspan="4" class="dim center">No global variables defined yet.</td>
                                </tr>
                            {/if}

                            <tr>
                                <td colspan="4">
                                    <button class="success toright" onclick={addNewVariable}>
                                        <Icon icon="feather:plus" class="feather"/>
                                        <span>Add variable</span>
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <p class="dim hint">
                    Global variables are accessible from any script in your game.
                    Use <code>raw</code> type for complex expressions like arrays or objects.
                </p>
            </div>
            {/if}

        <!-- ── Branding tab ────────────────────────────────────────────────── -->
        {:else if activeTab === 'branding'}
            {#if $currentProject}
            {@const b = branding()}
            {@const textures = $currentProject.textures}
            <div class="settings-panel pad">
                <h2>Branding</h2>

                <fieldset>
                    <label class="block">
                        <b>Game icon texture</b>
                        <small>Texture used as the app icon on desktop/mobile builds.</small>
                        <select
                            value={b.icon}
                            onchange={(e) => setBranding('icon', (e.target as HTMLSelectElement).value)}
                        >
                            <option value="">(none)</option>
                            {#each textures as tex}
                                <option value={tex.uid}>{tex.name}</option>
                            {/each}
                        </select>
                    </label>
                    <label class="block checkbox">
                        <input type="checkbox" checked={b.forceSmoothIcons}
                               onchange={(e) => setBranding('forceSmoothIcons', (e.target as HTMLInputElement).checked)} />
                        <span>Force smooth scaling for game icon</span>
                    </label>
                </fieldset>

                <fieldset>
                    <label class="block">
                        <b>Splash screen texture</b>
                        <small>Texture shown during game loading. Leave blank to use default.</small>
                        <select
                            value={b.splashScreen}
                            onchange={(e) => setBranding('splashScreen', (e.target as HTMLSelectElement).value)}
                        >
                            <option value="">(none)</option>
                            {#each textures as tex}
                                <option value={tex.uid}>{tex.name}</option>
                            {/each}
                        </select>
                    </label>
                    <label class="block checkbox">
                        <input type="checkbox" checked={b.forceSmoothSplashScreen}
                               onchange={(e) => setBranding('forceSmoothSplashScreen', (e.target as HTMLInputElement).checked)} />
                        <span>Force smooth scaling for splash screen</span>
                    </label>
                </fieldset>

                <fieldset>
                    <label class="block">
                        <b>Accent color</b>
                        <small>Color of the preloader progress bar.</small>
                        <div class="color-row">
                            <input type="color" value={b.accent}
                                   oninput={(e) => setBranding('accent', (e.target as HTMLInputElement).value)} />
                            <input type="text" value={b.accent} placeholder="#446adb"
                                   oninput={(e) => setBranding('accent', (e.target as HTMLInputElement).value)} />
                        </div>
                    </label>
                </fieldset>

                <fieldset>
                    <label class="block checkbox">
                        <input type="checkbox" checked={b.invertPreloaderScheme}
                               onchange={(e) => setBranding('invertPreloaderScheme', (e.target as HTMLInputElement).checked)} />
                        <span>Invert preloader color scheme (dark → light)</span>
                    </label>
                    <label class="block checkbox">
                        <input type="checkbox" checked={b.hideLoadingLogo}
                               onchange={(e) => setBranding('hideLoadingLogo', (e.target as HTMLInputElement).checked)} />
                        <span>Hide ct.js logo on loading screen</span>
                    </label>
                    <label class="block checkbox">
                        <input type="checkbox" checked={b.alternativeLogo}
                               onchange={(e) => setBranding('alternativeLogo', (e.target as HTMLInputElement).checked)} />
                        <span>Use alternative ct.js logo</span>
                    </label>
                </fieldset>

                <fieldset>
                    <label class="block">
                        <b>Custom loading text</b>
                        <small>Text shown beneath the loading bar. Leave blank for default.</small>
                        <input type="text" value={b.customLoadingText} placeholder="Loading…"
                               oninput={(e) => setBranding('customLoadingText', (e.target as HTMLInputElement).value)} />
                    </label>
                </fieldset>
            </div>
            {/if}

        <!-- ── Export tab ──────────────────────────────────────────────────── -->
        {:else if activeTab === 'export'}
            {#if $currentProject}
            {@const ex = exportSettings()}
            <div class="settings-panel pad">
                <h2>Export</h2>

                <h3>Error reporting</h3>
                <fieldset>
                    <label class="block checkbox">
                        <input type="checkbox" checked={ex.showErrors}
                               onchange={(e) => setExport('showErrors', (e.target as HTMLInputElement).checked)} />
                        <span>Show runtime errors in game overlay</span>
                    </label>
                    {#if ex.showErrors}
                        <label class="block">
                            <span class="dim">Error reporting URL (optional)</span>
                            <input type="url" value={ex.errorsLink} placeholder="https://…"
                                   oninput={(e) => setExport('errorsLink', (e.target as HTMLInputElement).value)} />
                        </label>
                    {/if}
                </fieldset>

                <h3>Desktop builds</h3>
                <fieldset>
                    <label class="block checkbox">
                        <input type="checkbox" checked={ex.autocloseDesktop}
                               onchange={(e) => setExport('autocloseDesktop', (e.target as HTMLInputElement).checked)} />
                        <span>Auto-close desktop window when game ends</span>
                    </label>
                </fieldset>

                <h3>Code modifier</h3>
                <fieldset>
                    {#each (['none', 'minify', 'obfuscate'] as const) as modifier}
                        <label class="block checkbox">
                            <input type="radio" name="codeModifier" value={modifier}
                                   checked={ex.codeModifier === modifier}
                                   onchange={() => setExport('codeModifier', modifier)} />
                            <span>
                                <b>{modifier.charAt(0).toUpperCase() + modifier.slice(1)}</b>
                                {#if modifier === 'obfuscate'}
                                    <span class="warn"> — may cause issues with some modules</span>
                                {/if}
                            </span>
                        </label>
                    {/each}
                </fieldset>

                <h3>Asset tree</h3>
                <fieldset>
                    <label class="block checkbox">
                        <input type="checkbox" checked={ex.bundleAssetTree}
                               onchange={(e) => setExport('bundleAssetTree', (e.target as HTMLInputElement).checked)} />
                        <span>Bundle asset folder tree into exported game</span>
                    </label>
                    {#if ex.bundleAssetTree}
                        <div class="asset-type-grid">
                            {#each ASSET_TYPE_KEYS as type}
                                <label class="checkbox">
                                    <input type="checkbox"
                                           checked={ex.bundleAssetTypes[type]}
                                           onchange={(e) => setBundleAssetType(type, (e.target as HTMLInputElement).checked)} />
                                    <span>{type}</span>
                                </label>
                            {/each}
                        </div>
                    {/if}
                </fieldset>
            </div>
            {/if}

        <!-- ── Scripts tab ─────────────────────────────────────────────────── -->
        {:else if activeTab === 'scripts'}
            {#if $currentProject}
            <div class="scripts-layout">
                <!-- Sidebar -->
                <aside class="scripts-sidebar flexfix nogrow noshrink">
                    <ul class="aMenu flexfix-body">
                        {#each $currentProject.scripts as script}
                            <li
                                class:active={selectedScript === script}
                                onclick={() => selectedScript = script}
                                role="option"
                                aria-selected={selectedScript === script}
                                tabindex="0"
                                onkeydown={(e) => e.key === 'Enter' && (selectedScript = script)}
                            >
                                <span class="crop">{script.name}</span>
                                <div class="script-actions">
                                    {#if $currentProject.scripts.indexOf(script) > 0}
                                        <button class="icon-btn" title="Move up"
                                                onclick={(e) => { e.stopPropagation(); moveScriptUp(script); }}>
                                            <Icon icon="feather:arrow-up" class="feather"/>
                                        </button>
                                    {/if}
                                    {#if $currentProject.scripts.indexOf(script) < $currentProject.scripts.length - 1}
                                        <button class="icon-btn" title="Move down"
                                                onclick={(e) => { e.stopPropagation(); moveScriptDown(script); }}>
                                            <Icon icon="feather:arrow-down" class="feather"/>
                                        </button>
                                    {/if}
                                    <button class="icon-btn danger" title="Delete script"
                                            onclick={(e) => { e.stopPropagation(); deleteProjectScript(script); }}>
                                        <Icon icon="feather:delete" class="feather"/>
                                    </button>
                                </div>
                            </li>
                        {/each}
                    </ul>
                    <button class="flexfix-footer" onclick={addNewProjectScript}>
                        <Icon icon="feather:plus" class="feather"/>
                        <span>Add script</span>
                    </button>
                </aside>

                <!-- Editor pane -->
                {#if selectedScript}
                    <div class="script-editor-pane flexfix tall">
                        <div class="flexfix-header pad-sm">
                            <b>Name</b>
                            <input type="text" value={selectedScript.name}
                                   onchange={(e) => updateScriptName(selectedScript!, (e.target as HTMLInputElement).value)} />
                        </div>
                        <textarea
                            class="flexfix-body code-area monospace"
                            value={selectedScript.code}
                            oninput={(e) => updateScriptCode(selectedScript!, (e.target as HTMLTextAreaElement).value)}
                            spellcheck="false"
                        ></textarea>
                    </div>
                {:else}
                    <div class="dim pad tall center-content">
                        {#if $currentProject.scripts.length === 0}
                            <p>No scripts yet. Scripts added here run once when the game starts.</p>
                        {:else}
                            <p>Select a script from the list to edit it.</p>
                        {/if}
                    </div>
                {/if}
            </div>
            {/if}

        <!-- ── Content tab ─────────────────────────────────────────────────── -->
        {:else if activeTab === 'content'}
            {#if $currentProject}
            {@const ctypes = $currentProject.contentTypes ?? []}
            <div class="content-tab-layout">

                <!-- Left: type list -->
                <aside class="content-type-list nogrow noshrink">
                    <div class="ct-list-header">
                        <span class="ct-list-title">Content types</span>
                        <button class="icon-btn" title="Add content type" onclick={addContentType}>
                            <Icon icon="feather:plus" class="feather"/>
                        </button>
                    </div>
                    <ul class="aNav vertical nbr ct-nav">
                        {#each ctypes as ct, i}
                            <li
                                class:active={selectedContentTypeIndex === i}
                                role="option"
                                aria-selected={selectedContentTypeIndex === i}
                                tabindex="0"
                                onclick={() => { selectedContentTypeIndex = i; contentView = 'types'; }}
                                onkeydown={(e) => e.key === 'Enter' && (selectedContentTypeIndex = i)}
                            >
                                <Icon icon={`feather:${ct.icon || 'copy'}`} class="feather"/>
                                <span class="ct-name">{ct.readableName || ct.name || '(unnamed)'}</span>
                                {#if ct.name}<code class="ct-code">{ct.name}</code>{/if}
                            </li>
                        {/each}
                        {#if ctypes.length === 0}
                            <li class="ct-empty dim">No content types yet.</li>
                        {/if}
                    </ul>
                    <button class="ct-add-btn" onclick={addContentType}>
                        <Icon icon="feather:plus" class="feather"/>
                        <span>Add type</span>
                    </button>
                </aside>

                <!-- Right: editor panel -->
                <div class="content-editor tall">
                    {#if selectedContentTypeIndex < 0 || selectedContentTypeIndex >= ctypes.length}
                        <div class="ct-empty-state pad dim">
                            <Icon icon="feather:layers" class="feather big" />
                            <p>Select a content type from the list, or create one.</p>
                        </div>
                    {:else}
                        {@const ct = ctypes[selectedContentTypeIndex]}
                        {@const typeIndex = selectedContentTypeIndex}

                        {#if contentView === 'types'}
                        <!-- Schema editor -->
                        <div class="settings-panel pad">
                            <div class="ct-editor-header">
                                <h2>
                                    <Icon icon={`feather:${ct.icon || 'copy'}`} class="feather"/>
                                    {ct.readableName || ct.name || '(unnamed)'}
                                </h2>
                                <button class="icon-btn danger" title="Delete content type"
                                        onclick={() => deleteContentType(typeIndex)}>
                                    <Icon icon="feather:trash-2" class="feather"/>
                                </button>
                            </div>

                            <fieldset>
                                <label class="block">
                                    <b>Code name</b>
                                    <small>Used in scripts as <code>content.{ct.name || 'name'}</code>. Must be a valid identifier.</small>
                                    <input type="text" value={ct.name}
                                           oninput={(e) => setContentTypeProp(typeIndex, 'name', (e.target as HTMLInputElement).value)} />
                                </label>
                                <label class="block">
                                    <b>Readable name</b>
                                    <small>Displayed in the editor UI.</small>
                                    <input type="text" value={ct.readableName}
                                           oninput={(e) => setContentTypeProp(typeIndex, 'readableName', (e.target as HTMLInputElement).value)} />
                                </label>
                                <label class="block">
                                    <b>Icon</b>
                                    <small>A Feather icon name (e.g. <code>copy</code>, <code>star</code>, <code>user</code>).</small>
                                    <input type="text" value={ct.icon}
                                           oninput={(e) => setContentTypeProp(typeIndex, 'icon', (e.target as HTMLInputElement).value)} />
                                </label>
                            </fieldset>

                            <h3>Field specification</h3>
                            <div class="aTableWrap">
                                <table class="aNiceTable spec-table">
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Readable name</th>
                                            <th title="Required">Req</th>
                                            <th>Structure</th>
                                            <th>Type</th>
                                            <th title="Mapped value type (map only)">Map type</th>
                                            <th title="Fixed length (array only)">Length</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each ct.specification as field, fi}
                                            <tr>
                                                <td>
                                                    <input type="text" value={field.name}
                                                           oninput={(e) => setSpecField(typeIndex, fi, 'name', (e.target as HTMLInputElement).value)} />
                                                </td>
                                                <td>
                                                    <input type="text" value={field.readableName}
                                                           oninput={(e) => setSpecField(typeIndex, fi, 'readableName', (e.target as HTMLInputElement).value)} />
                                                </td>
                                                <td class="center">
                                                    <input type="checkbox" checked={field.required}
                                                           onchange={(e) => setSpecField(typeIndex, fi, 'required', (e.target as HTMLInputElement).checked)} />
                                                </td>
                                                <td>
                                                    <select value={field.structure}
                                                            onchange={(e) => setSpecField(typeIndex, fi, 'structure', (e.target as HTMLSelectElement).value as IFieldSchema['structure'])}>
                                                        <option value="atomic">Atomic</option>
                                                        <option value="array">Array</option>
                                                        <option value="map">Map</option>
                                                    </select>
                                                </td>
                                                <td>
                                                    <select value={field.type}
                                                            onchange={(e) => setSpecField(typeIndex, fi, 'type', (e.target as HTMLSelectElement).value as FieldSchemaType)}>
                                                        {#each contentFieldTypeOptions() as opt}
                                                            <option value={opt.value}>{opt.label}</option>
                                                        {/each}
                                                    </select>
                                                </td>
                                                <td>
                                                    {#if field.structure === 'map'}
                                                        <select value={field.mappedType ?? 'text'}
                                                                onchange={(e) => setSpecField(typeIndex, fi, 'mappedType', (e.target as HTMLSelectElement).value as FieldSchemaType)}>
                                                            {#each contentFieldTypeOptions() as opt}
                                                                <option value={opt.value}>{opt.label}</option>
                                                            {/each}
                                                        </select>
                                                    {:else}
                                                        <span class="dim">—</span>
                                                    {/if}
                                                </td>
                                                <td>
                                                    {#if field.structure === 'array'}
                                                        <input type="number" min="0" value={field.fixedLength ?? ''}
                                                               style="width:5rem"
                                                               oninput={(e) => {
                                                                   const v = (e.target as HTMLInputElement).value;
                                                                   setSpecField(typeIndex, fi, 'fixedLength', v ? Number(v) : undefined);
                                                               }} />
                                                    {:else}
                                                        <span class="dim">—</span>
                                                    {/if}
                                                </td>
                                                <td>
                                                    <button class="icon-btn danger" title="Remove field"
                                                            onclick={() => removeSpecField(typeIndex, fi)}>
                                                        <Icon icon="feather:delete" class="feather"/>
                                                    </button>
                                                </td>
                                            </tr>
                                        {/each}
                                        {#if ct.specification.length === 0}
                                            <tr>
                                                <td colspan="8" class="dim center">No fields defined. Add a field below.</td>
                                            </tr>
                                        {/if}
                                        <tr>
                                            <td colspan="8">
                                                <button onclick={() => addSpecField(typeIndex)}>
                                                    <Icon icon="feather:plus" class="feather"/>
                                                    <span>Add field</span>
                                                </button>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div class="ct-entries-link">
                                <button class="success" onclick={() => contentView = 'entries'}>
                                    <Icon icon="feather:arrow-right" class="feather"/>
                                    <span>Edit entries ({ct.entries.length})</span>
                                </button>
                                <small class="dim">Data rows that conform to the field specification above.</small>
                            </div>
                        </div>

                        {:else}
                        <!-- Entries editor -->
                        <div class="settings-panel pad">
                            <div class="ct-editor-header">
                                <button class="icon-btn" title="Back to schema" onclick={() => contentView = 'types'}>
                                    <Icon icon="feather:arrow-left" class="feather"/>
                                </button>
                                <h2>
                                    <Icon icon={`feather:${ct.icon || 'copy'}`} class="feather"/>
                                    {ct.readableName || ct.name}: entries
                                </h2>
                            </div>

                            {#if ct.specification.length === 0}
                                <p class="dim">Define fields in the schema first before adding entries.</p>
                            {:else}
                                <div class="aTableWrap">
                                    <table class="aNiceTable entries-table">
                                        <thead>
                                            <tr>
                                                {#each ct.specification as field}
                                                    <th title={field.name}>{field.readableName || field.name}</th>
                                                {/each}
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each ct.entries as entry, ei}
                                                <tr>
                                                    {#each ct.specification as field}
                                                        <td>
                                                            {#if field.structure === 'array' || field.structure === 'map'}
                                                                <textarea
                                                                    class="monospace wide"
                                                                    rows="2"
                                                                    value={JSON.stringify(entry[field.name] ?? (field.structure === 'array' ? [] : {}))}
                                                                    onchange={(e) => {
                                                                        try { setEntryValue(typeIndex, ei, field.name, JSON.parse((e.target as HTMLTextAreaElement).value)); }
                                                                        catch { /* invalid JSON — leave as-is */ }
                                                                    }}
                                                                ></textarea>
                                                            {:else if field.type === 'checkbox'}
                                                                <input type="checkbox"
                                                                       checked={Boolean(entry[field.name])}
                                                                       onchange={(e) => setEntryValue(typeIndex, ei, field.name, (e.target as HTMLInputElement).checked)} />
                                                            {:else if field.type === 'number' || field.type === 'sliderAndNumber'}
                                                                <input type="number"
                                                                       value={Number(entry[field.name] ?? 0)}
                                                                       oninput={(e) => setEntryValue(typeIndex, ei, field.name, Number((e.target as HTMLInputElement).value))} />
                                                            {:else if field.type === 'color'}
                                                                <div class="color-row">
                                                                    <input type="color"
                                                                           value={String(entry[field.name] ?? '#ffffff')}
                                                                           oninput={(e) => setEntryValue(typeIndex, ei, field.name, (e.target as HTMLInputElement).value)} />
                                                                    <input type="text"
                                                                           value={String(entry[field.name] ?? '#ffffff')}
                                                                           oninput={(e) => setEntryValue(typeIndex, ei, field.name, (e.target as HTMLInputElement).value)} />
                                                                </div>
                                                            {:else if field.type === 'textfield' || field.type === 'code'}
                                                                <textarea
                                                                    class:monospace={field.type === 'code'}
                                                                    class="wide"
                                                                    rows="2"
                                                                    value={String(entry[field.name] ?? '')}
                                                                    oninput={(e) => setEntryValue(typeIndex, ei, field.name, (e.target as HTMLTextAreaElement).value)}
                                                                ></textarea>
                                                            {:else if field.type.startsWith('enum@')}
                                                                {@const enumUid = field.type.slice(5)}
                                                                {@const enumAsset = ($currentProject?.enums ?? []).find(e => e.uid === enumUid)}
                                                                {#if enumAsset}
                                                                    <select value={String(entry[field.name] ?? enumAsset.values[0] ?? '')}
                                                                            onchange={(e) => setEntryValue(typeIndex, ei, field.name, (e.target as HTMLSelectElement).value)}>
                                                                        {#each enumAsset.values as v}
                                                                            <option value={v}>{v}</option>
                                                                        {/each}
                                                                    </select>
                                                                {:else}
                                                                    <input type="text" value={String(entry[field.name] ?? '')}
                                                                           oninput={(e) => setEntryValue(typeIndex, ei, field.name, (e.target as HTMLInputElement).value)} />
                                                                {/if}
                                                            {:else}
                                                                <input type="text" value={String(entry[field.name] ?? '')}
                                                                       oninput={(e) => setEntryValue(typeIndex, ei, field.name, (e.target as HTMLInputElement).value)} />
                                                            {/if}
                                                        </td>
                                                    {/each}
                                                    <td>
                                                        <button class="icon-btn danger" title="Delete entry"
                                                                onclick={() => removeContentEntry(typeIndex, ei)}>
                                                            <Icon icon="feather:delete" class="feather"/>
                                                        </button>
                                                    </td>
                                                </tr>
                                            {/each}
                                            {#if ct.entries.length === 0}
                                                <tr>
                                                    <td colspan={(ct.specification.length + 1).toString()} class="dim center">
                                                        No entries yet.
                                                    </td>
                                                </tr>
                                            {/if}
                                            <tr>
                                                <td colspan={(ct.specification.length + 1).toString()}>
                                                    <button class="success" onclick={() => addContentEntry(typeIndex)}>
                                                        <Icon icon="feather:plus" class="feather"/>
                                                        <span>Add entry</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            {/if}
                        </div>
                        {/if}

                    {/if}
                </div>
            </div>
            {/if}

        <!-- ── Physics tab ─────────────────────────────────────────────────── -->
        {:else if activeTab === 'physics'}
            {#if $currentProject}
            {@const groups = getPhysicsGroups()}
            <div class="settings-panel pad">
                <h2>Physics Groups</h2>
                <p class="dim small">Define named groups for collision filtering. Each template can be assigned a group in its physics settings. Max 32 groups.</p>

                <div style="margin-bottom: 1rem;">
                    {#each groups as group, i}
                        <div class="aRow" style="gap: 0.5rem; display: flex; margin-bottom: 0.3rem; align-items: center;">
                            <span class="dim small" style="min-width: 1.5rem; text-align: right;">{i + 1}</span>
                            <input type="text" value={group.name}
                                onchange={(e) => renamePhysicsGroup(i, (e.target as HTMLInputElement).value)}
                                style="flex: 1;" />
                            <button class="dangerSwitch square" onclick={() => deletePhysicsGroup(i)} title="Delete group">
                                <Icon icon="feather:trash-2" class="feather" />
                            </button>
                        </div>
                    {/each}
                    <button onclick={addPhysicsGroup} disabled={groups.length >= 32}>
                        <Icon icon="feather:plus" class="feather" /> Add Group
                    </button>
                </div>

                {#if groups.length >= 2}
                <h3>Collision Matrix</h3>
                <p class="dim small">Check to allow collision between groups.</p>
                <div style="overflow-x: auto;">
                    <table class="physics-matrix">
                        <thead>
                            <tr>
                                <th></th>
                                {#each groups as g}<th class="matrix-header">{g.name}</th>{/each}
                            </tr>
                        </thead>
                        <tbody>
                            {#each groups as groupA, i}
                            <tr>
                                <th class="matrix-row-header">{groupA.name}</th>
                                {#each groups as _groupB, j}
                                <td class="matrix-cell">
                                    <input type="checkbox"
                                        checked={groupsCollide(groups, i, j)}
                                        onchange={() => toggleCollision(i, j)} />
                                </td>
                                {/each}
                            </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
                {/if}
            </div>
            {/if}
        {/if}

    </main>
</div>


<style>
    .project-settings {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--background-deeper, #111122);
        display: flex;
        flex-flow: row nowrap;
    }

    .nogrow  { flex: 0 0 auto; }
    .noshrink { flex-shrink: 0; }
    .flexrow { flex-direction: row; }
    .tall    { flex: 1 1 auto; overflow: auto; min-width: 0; }
    .pad     { padding: 1rem; }

    /* ── Sidebar ────────────────────────────────────────────────────────────── */
    aside {
        border-right: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        display: flex;
        flex-direction: column;
        padding: 0.5rem 0;
        min-width: 10rem;
    }

    .aNav.vertical {
        list-style: none;
        margin: 0; padding: 0;
        display: flex;
        flex-direction: column;

        li {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.4rem 0.8rem;
            cursor: pointer;
            font-size: 0.85rem;
            white-space: nowrap;
            border-left: 3px solid transparent;
            user-select: none;
            transition: background 0.1s, color 0.1s;

            &:hover {
                background: var(--act, #1e2233);
                color: var(--acttext, #7ec8e3);
            }

            &.active {
                color: var(--acttext, #7ec8e3);
                border-left-color: var(--accent1, #446adb);
                background: var(--act, #1e2233);
            }

            :global(svg.feather) {
                width: 1rem; height: 1rem;
                fill: none; stroke: currentColor;
                stroke-width: 2; flex-shrink: 0;
            }
        }
    }

    .nbr li { border-right: none; }

    /* ── Settings panel ─────────────────────────────────────────────────────── */
    .settings-panel {
        max-width: 42rem;
        color: var(--text, #e0e0e0);

        h2 {
            font-size: 1rem;
            margin: 0 0 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid var(--border-pale, #2a2a3e);
        }

        h3 {
            font-size: 0.85rem;
            margin: 1rem 0 0.4rem;
            color: var(--text-dim, #aaa);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
    }

    fieldset {
        border: none;
        margin: 0 0 0.75rem;
        padding: 0;
    }

    label.block {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        margin-bottom: 0.6rem;

        b { font-size: 0.82rem; }
        small { color: var(--text-dim, #888); font-size: 0.78rem; }
    }

    label.checkbox {
        display: flex;
        flex-direction: row;
        align-items: baseline;
        gap: 0.5rem;
        margin-bottom: 0.4rem;
        font-size: 0.85rem;
        cursor: pointer;
    }

    input[type="text"],
    input[type="number"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 4px;
        color: var(--text, #e0e0e0);
        padding: 0.3rem 0.5rem;
        font-size: 0.85rem;
        outline: none;
        width: 100%;

        &:focus { border-color: var(--accent1, #446adb); }
    }

    input.short  { width: 4rem; }
    input.postfix { width: 5rem; }

    .version-row {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.25rem;

        span { color: var(--text-dim, #888); }
    }

    .dim  { color: var(--text-dim, #888); font-size: 0.85rem; }

    /* ── Actions tab ────────────────────────────────────────────────────────── */
    .button-group {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.4rem;
        margin-bottom: 0.75rem;

        &.mt { margin-top: 0.75rem; }
    }

    .actions-header {
        display: flex;
        flex-direction: row;
        font-size: 0.78rem;
        color: var(--text-dim, #888);
        padding: 0 0 0.3rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        margin-bottom: 0.4rem;
    }

    .col-name    { flex: 0 0 14rem; padding-right: 0.5rem; }
    .col-methods { flex: 1 1 auto; min-width: 0; }

    .action-row {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 0.5rem;
        padding: 0.4rem 0;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);

        .name-field {
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
        }
    }

    .method-list {
        list-style: none;
        margin: 0 0 0.3rem;
        padding: 0;
    }

    .method-row {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
        padding: 0.15rem 0;
        font-size: 0.82rem;

        code.inline {
            flex: 1 1 auto;
            font-size: 0.78rem;
            color: var(--text-dim, #aaa);
        }
    }

    .multiplier-field {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        flex-shrink: 0;
    }

    .icon-btn {
        background: none;
        border: none;
        padding: 0.15rem;
        cursor: pointer;
        color: var(--text-dim, #888);
        display: flex;
        align-items: center;
        border-radius: 3px;
        flex-shrink: 0;

        &:hover { color: var(--text, #e0e0e0); background: var(--act, #1e2233); }
        &.danger:hover { color: #e07070; }

        :global(svg.feather) { width: 0.9rem; height: 0.9rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }

    .anErrorNotice {
        font-size: 0.75rem;
        color: #e07070;
    }

    .hide-small { display: none; }

    button.small {
        font-size: 0.78rem;
        padding: 0.2rem 0.5rem;
    }

    /* ── Variables tab ──────────────────────────────────────────────────────── */
    .aTableWrap {
        overflow-x: auto;
        margin-bottom: 0.75rem;
    }

    .vars-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.83rem;

        th {
            text-align: left;
            padding: 0.35rem 0.5rem;
            border-bottom: 2px solid var(--border-bright, #333);
            color: var(--text-dim, #888);
            font-weight: 600;
        }

        td {
            padding: 0.3rem 0.5rem;
            border-bottom: 1px solid var(--border-pale, #2a2a3e);
            vertical-align: middle;
        }

        select {
            background: var(--background-deeper, #111122);
            border: 1px solid var(--border-bright, #333);
            border-radius: 4px;
            color: var(--text, #e0e0e0);
            padding: 0.25rem 0.4rem;
            font-size: 0.82rem;
            outline: none;
            &:focus { border-color: var(--accent1, #446adb); }
        }

        textarea {
            background: var(--background-deeper, #111122);
            border: 1px solid var(--border-bright, #333);
            border-radius: 4px;
            color: var(--text, #e0e0e0);
            padding: 0.25rem 0.4rem;
            font-size: 0.82rem;
            resize: vertical;
            outline: none;
            &:focus { border-color: var(--accent1, #446adb); }
        }
    }

    .var-error {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        color: #e07070;
        font-size: 0.75rem;
        margin-top: 0.15rem;

        :global(svg.feather) { width: 0.8rem; height: 0.8rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }

    .center { text-align: center; }
    .hint { margin-top: 0.5rem; font-size: 0.8rem; }
    .monospace { font-family: monospace; }
    .wide { width: 100%; }

    .toright { float: right; }
    .warn { color: #e0a070; font-size: 0.8rem; }

    /* ── Branding tab ───────────────────────────────────────────────────────── */
    .color-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.25rem;

        input[type="color"] {
            width: 2.5rem;
            height: 2rem;
            padding: 0.1rem;
            border: 1px solid var(--border-bright, #333);
            border-radius: 4px;
            background: none;
            cursor: pointer;
        }
    }

    /* ── Export tab ─────────────────────────────────────────────────────────── */
    .asset-type-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 1.25rem;
        margin-top: 0.4rem;
        padding-left: 1.5rem;
    }

    /* ── Scripts tab ────────────────────────────────────────────────────────── */
    .scripts-layout {
        display: flex;
        flex-direction: row;
        height: 100%;
        overflow: hidden;
    }

    .scripts-sidebar {
        width: 14rem;
        border-right: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        display: flex;
        flex-direction: column;
        overflow: hidden;

        ul.aMenu {
            list-style: none;
            margin: 0; padding: 0;
            overflow-y: auto;
            flex: 1 1 auto;

            li {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0.4rem 0.6rem;
                cursor: pointer;
                font-size: 0.83rem;
                user-select: none;

                &:hover  { background: var(--act, #1e2233); }
                &.active { background: var(--act, #1e2233); color: var(--acttext, #7ec8e3); }

                .crop { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            }
        }

        .flexfix-footer {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.5rem 0.6rem;
            border-top: 1px solid var(--border-pale, #2a2a3e);
            background: none;
            border-left: none; border-right: none; border-bottom: none;
            color: var(--text, #e0e0e0);
            cursor: pointer;
            font-size: 0.83rem;
            width: 100%;
            text-align: left;

            &:hover { background: var(--act, #1e2233); }

            :global(svg.feather) { width: 0.9rem; height: 0.9rem; fill: none; stroke: currentColor; stroke-width: 2; }
        }
    }

    .script-actions {
        display: flex;
        gap: 0.15rem;
        flex-shrink: 0;
    }

    .script-editor-pane {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;

        .flexfix-header {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 0.75rem;
            border-bottom: 1px solid var(--border-pale, #2a2a3e);
            flex-shrink: 0;

            b { white-space: nowrap; font-size: 0.82rem; }

            input {
                flex: 1;
                background: var(--background-deeper, #111122);
                border: 1px solid var(--border-bright, #333);
                border-radius: 4px;
                color: var(--text, #e0e0e0);
                padding: 0.25rem 0.4rem;
                font-size: 0.83rem;
                outline: none;
                &:focus { border-color: var(--accent1, #446adb); }
            }
        }
    }

    .code-area {
        flex: 1 1 auto;
        resize: none;
        background: var(--background-deeper, #111122);
        border: none;
        color: var(--text, #e0e0e0);
        padding: 0.75rem;
        font-size: 0.83rem;
        line-height: 1.5;
        outline: none;
        tab-size: 4;
    }

    .pad-sm { padding: 0.5rem 0.75rem; }
    .center-content { display: flex; align-items: center; justify-content: center; }

    button.success {
        background: var(--accent1, #446adb);
        color: #fff;
        border: none;
        border-radius: 4px;
        padding: 0.3rem 0.75rem;
        font-size: 0.83rem;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;

        &:hover { filter: brightness(1.1); }

        :global(svg.feather) { width: 0.9rem; height: 0.9rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }

    /* ── Content tab ─────────────────────────────────────────────────────────── */
    .content-tab-layout {
        display: flex;
        flex-flow: row nowrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .content-type-list {
        width: 14rem;
        border-right: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .ct-list-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--border-bright, #333);
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--secondary, #999);
    }

    .ct-nav {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 0.25rem 0;

        li {
            display: flex;
            align-items: baseline;
            gap: 0.4rem;
            padding: 0.35rem 0.75rem;
            cursor: pointer;
            font-size: 0.85rem;
            user-select: none;
            flex-wrap: wrap;

            &.active { background: var(--accent1-muted, rgba(68,106,219,0.2)); color: var(--accent1, #446adb); }
            &:hover:not(.active) { background: var(--hover, rgba(255,255,255,0.05)); }
            &.ct-empty { pointer-events: none; padding: 0.75rem; font-style: italic; }

            :global(svg.feather) { width: 0.85rem; height: 0.85rem; flex-shrink: 0; }
            code.ct-code { font-size: 0.72rem; color: var(--secondary, #888); margin-left: auto; }
        }
    }

    .ct-add-btn {
        flex-shrink: 0;
        margin: 0.5rem;
        font-size: 0.82rem;
        display: flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.3rem 0.6rem;
        background: transparent;
        border: 1px dashed var(--border-bright, #444);
        border-radius: 4px;
        color: var(--secondary, #aaa);
        cursor: pointer;
        width: calc(100% - 1rem);
        justify-content: center;
        &:hover { border-color: var(--accent1, #446adb); color: var(--accent1, #446adb); }
        :global(svg.feather) { width: 0.8rem; height: 0.8rem; }
    }

    .content-editor {
        flex: 1 1 auto;
        overflow-y: auto;
        min-width: 0;
    }

    .ct-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 0.75rem;
        :global(svg.feather.big) { width: 3rem; height: 3rem; opacity: 0.3; }
    }

    .ct-editor-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1rem;

        h2 { margin: 0; display: flex; align-items: center; gap: 0.5rem; flex: 1; }
        :global(svg.feather) { width: 1rem; height: 1rem; }
    }

    .ct-entries-link {
        margin-top: 1.25rem;
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .spec-table {
        td input[type="text"], td input[type="number"] { width: 100%; min-width: 4rem; }
        td select { width: 100%; min-width: 7rem; }
        td.center { text-align: center; vertical-align: middle; }
    }

    .entries-table {
        td input[type="text"], td input[type="number"] { width: 100%; min-width: 5rem; }
        td select { width: 100%; }
        td textarea.wide { width: 100%; min-width: 6rem; resize: vertical; }
    }

    .physics-matrix { border-collapse: collapse; }
    .physics-matrix th, .physics-matrix td { padding: 0.25rem 0.4rem; text-align: center; }
    .matrix-header { writing-mode: vertical-rl; transform: rotate(180deg); font-weight: normal; max-width: 2rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .matrix-row-header { text-align: right; font-weight: normal; max-width: 8rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .matrix-cell { border: 1px solid var(--clrBorder, #333); }
</style>
