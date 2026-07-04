<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * NyxModsPanel.svelte
     * Migrated from:
     *   src/riotTags/project-settings/tabs/modules/modules-settings.tag
     *   src/riotTags/project-settings/tabs/modules/module-meta.tag
     *   module-viewer (inline — original not found in legacy source)
     *
     * NyxMod management panel.
     * Left column: search + filter + card list.
     * Right column: module detail panel when a card is selected.
     */
    import { onMount } from 'svelte';
    import type { NyxMod, NyxModField } from '@nyx/plugin-api';
    import ColorPicker from '@nyx/ui-kit/ColorPicker.svelte';
    import {
        availableNyxMods,
        nyxModsLoading,
        enabledModuleNames,
        loadNyxMods,
        enableModule,
        disableModule,
    } from '../stores/nyxModStore.js';
    import { currentProject } from '../stores/projectStore.js';

    // ── Category icon map — mirrors legacy categoryToIconMap ──────────────────
    const CATEGORY_ICON: Record<string, string> = {
        customization: 'droplet',
        utilities:     'tool',
        media:         'tv',
        misc:          'loader',
        desktop:       'monitor',
        motionPlanning:'move',
        inputs:        'airplay',
        fx:            'zap',
        mobile:        'smartphone',
        integrations:  'plus-circle',
        tweaks:        'sliders',
        networking:    'globe',
        default:       'box',
    };

    function getCatmodIcon(mod: NyxMod): string {
        const cats = mod.manifest.main.categories;
        if (!cats || cats.length === 0) return CATEGORY_ICON.default;
        return CATEGORY_ICON[cats[0]] ?? CATEGORY_ICON.default;
    }

    // ── Search + category filter state ────────────────────────────────────────
    let searchValue     = $state('');
    let pickedCategories= $state<string[]>([]);

    const ALL_CATEGORIES = Object.keys(CATEGORY_ICON).filter(c => c !== 'default').sort();

    /** Count visible modules per category across all available modules. */
    let categoryCounts = $derived.by<Record<string, number>>(() => {
        const counts: Record<string, number> = {};
        for (const cat of ALL_CATEGORIES) counts[cat] = 0;
        for (const mod of $availableNyxMods) {
            for (const cat of mod.manifest.main.categories ?? []) {
                if (cat in counts) counts[cat]++;
            }
        }
        return counts;
    });

    function toggleCategory(cat: string): void {
        const idx = pickedCategories.indexOf(cat);
        if (idx !== -1) pickedCategories.splice(idx, 1);
        else pickedCategories.push(cat);
    }

    function isVisible(mod: NyxMod): boolean {
        const name    = mod.manifest.main.name.toLowerCase();
        const tagline = String(mod.manifest.main.tagline ?? '').toLowerCase();
        const q       = searchValue.toLowerCase();
        const matchSearch = !q || name.includes(q) || tagline.includes(q) ||
                            mod.name.toLowerCase().includes(q);
        const matchCat = pickedCategories.length === 0 ||
                         (mod.manifest.main.categories ?? [])
                             .some(c => pickedCategories.includes(c));
        return matchSearch && matchCat;
    }

    // ── Derived module lists ───────────────────────────────────────────────────
    let enabledMods = $derived(
        $availableNyxMods
            .filter(m => $enabledModuleNames.has(m.name))
            .sort((a, b) => a.name.localeCompare(b.name))
    );
    let availableMods = $derived(
        $availableNyxMods
            .sort((a, b) => a.name.localeCompare(b.name))
    );

    // ── Selected module (detail panel) ────────────────────────────────────────
    let selectedMod = $state<NyxMod | null>(null);

    function openModule(mod: NyxMod): void  { selectedMod = mod; }
    function closeDetail(): void            { selectedMod = null; }

    // ── Toggle enable/disable ─────────────────────────────────────────────────
    let toggling = $state<string | null>(null); // module name being toggled

    async function toggleModule(mod: NyxMod, e: MouseEvent): Promise<void> {
        e.stopPropagation();
        if (toggling) return;
        toggling = mod.name;
        try {
            if ($enabledModuleNames.has(mod.name)) {
                disableModule(mod.name);
                if (selectedMod?.name === mod.name) selectedMod = null;
            } else {
                await enableModule(mod.name);
            }
        } finally {
            toggling = null;
        }
    }

    // ── Textures list for texture-type fields ──────────────────────────────────
    let textures = $derived($currentProject?.textures ?? []);

    // ── Module field settings editing ─────────────────────────────────────────
    /** Strip @@assetType annotation from a field key (e.g. "texture@@texture" → "texture"). */
    function cleanFieldKey(key: string): string {
        return key.split('@@')[0];
    }

    function getFieldValue(modName: string, key: string): unknown {
        return $currentProject?.modules?.[modName]?.[key] ?? '';
    }

    function setFieldValue(modName: string, key: string, value: unknown): void {
        if (!$currentProject) return;
        currentProject.update(p => {
            if (!p) return p;
            const libCurrent = (p.modules[modName] ?? {}) as Record<string, unknown>;
            const lib: Record<string, unknown> = { ...libCurrent, [key]: value };

            // showNyxBranding toggle: insert or remove the Nyx preset slide entry
            if (modName === 'splashscreen' && key === 'showNyxBranding') {
                const existing = Array.isArray(libCurrent.slides)
                    ? (libCurrent.slides as Record<string, unknown>[])
                    : [];
                if (value) {
                    if (!existing.some(s => s.__nyxBuiltin)) {
                        lib.slides = [
                            { __nyxBuiltin: true, texture: -1, effect: 'none', duration: 2000, fill: true },
                            ...existing,
                        ];
                    }
                } else {
                    lib.slides = existing.filter(s => !s.__nyxBuiltin);
                }
            }

            return { ...p, modules: { ...p.modules, [modName]: lib } };
        });
    }

    function handleFieldInput(modName: string, field: NyxModField, e: Event): void {
        if (!field.key) return;
        const key = cleanFieldKey(field.key);
        const target = e.target as HTMLInputElement;
        let val: unknown = target.value;
        if (field.type === 'checkbox') val = target.checked;
        else if (field.type === 'number' || field.type === 'slider') val = Number(target.value);
        setFieldValue(modName, key, val);
    }

    // ── Table field helpers ────────────────────────────────────────────────────
    function getTableRows(modName: string, key: string): Record<string, unknown>[] {
        const val = getFieldValue(modName, key);
        return Array.isArray(val) ? (val as Record<string, unknown>[]) : [];
    }

    function addTableRow(modName: string, key: string, subFields: NyxModField[]): void {
        const rows = getTableRows(modName, key);
        const row: Record<string, unknown> = {};
        for (const sf of subFields) {
            if (!sf.key) continue;
            const sk = cleanFieldKey(sf.key);
            row[sk] = sf.default ?? (sf.type === 'checkbox' ? false : sf.type === 'number' ? 0 : -1);
        }
        setFieldValue(modName, key, [...rows, row]);
    }

    function removeTableRow(modName: string, key: string, index: number): void {
        const rows = [...getTableRows(modName, key)];
        rows.splice(index, 1);
        setFieldValue(modName, key, rows);
    }

    function moveTableRow(modName: string, key: string, index: number, dir: -1 | 1): void {
        const rows = [...getTableRows(modName, key)];
        const target = index + dir;
        if (target < 0 || target >= rows.length) return;
        [rows[index], rows[target]] = [rows[target], rows[index]];
        setFieldValue(modName, key, rows);
    }

    function setTableCell(modName: string, key: string, index: number, subKey: string, value: unknown): void {
        const rows = getTableRows(modName, key).map((r, i) =>
            i === index ? { ...r, [subKey]: value } : r
        );
        setFieldValue(modName, key, rows);
    }

    // ── Load nyxmods on mount ─────────────────────────────────────────────────
    onMount(() => { void loadNyxMods(); });
</script>

<!-- ══ NyxMods Panel ═══════════════════════════════════════════════════════════ -->
<div class="nyxmods-panel flexcol">

    <!-- ── Module list ───────────────────────────────────────────────────────── -->
    <div class="nyxmods-list flexcol">

        <!-- Search + category filter -->
        <details class="aModuleFilter" open>
            <summary>Filter</summary>
            <div class="flexrow aModuleFilterBody">
                <label class="nogrow">
                    <b>Search</b>
                    <div class="aSearchWrap nm">
                        <input
                            class="inline"
                            type="text"
                            placeholder="Name or tagline…"
                            bind:value={searchValue}
                        />
                        <Icon icon="feather:search" class="feather"/>
                    </div>
                </label>
                <div class="aModuleFilterColumns">
                    {#each ALL_CATEGORIES as cat (cat)}
                        {#if categoryCounts[cat]}
                            <label class="checkbox">
                                <input
                                    type="checkbox"
                                    checked={pickedCategories.includes(cat)}
                                    onchange={() => toggleCategory(cat)}
                                />
                                <Icon icon={`feather:${CATEGORY_ICON[cat]}`} class="feather accent1" />
                                <span>{cat} ({categoryCounts[cat]})</span>
                            </label>
                        {/if}
                    {/each}
                </div>
            </div>
        </details>

        {#if $nyxModsLoading}
            <div class="pad dim">Loading nyxmods…</div>
        {:else}
            <div class="nyxmods-sections">

                <!-- Enabled modules -->
                <details class="collapsible-section" open>
                    <summary><h3>Enabled modules</h3></summary>
                    <div class="aModuleList">
                        {#each enabledMods as mod (mod.name)}
                            {#if isVisible(mod)}
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <div
                                    class="aModuleCard"
                                    class:selected={selectedMod?.name === mod.name}
                                    onclick={() => openModule(mod)}
                                >
                                    {@render moduleCard(mod)}
                                </div>
                            {/if}
                        {/each}
                        {#if enabledMods.filter(isVisible).length === 0}
                            <p class="dim pad">No enabled modules match your filter.</p>
                        {/if}
                    </div>
                </details>

                <!-- Available modules -->
                <details class="collapsible-section" open>
                    <summary><h3>Available modules</h3></summary>
                    <div class="aModuleList">
                        {#each availableMods as mod (mod.name)}
                            {#if isVisible(mod)}
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <div
                                    class="aModuleCard"
                                    class:selected={selectedMod?.name === mod.name}
                                    onclick={() => openModule(mod)}
                                >
                                    {@render moduleCard(mod)}
                                </div>
                            {/if}
                        {/each}
                    </div>
                </details>

            </div>
        {/if}
    </div>

    <!-- ── Modal detail overlay ──────────────────────────────────────────────── -->
    {#if selectedMod}
        {@const mod     = selectedMod}
        {@const enabled = $enabledModuleNames.has(mod.name)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="modal-backdrop" onclick={closeDetail}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="nyxmods-detail flexcol" onclick={(e) => e.stopPropagation()}>

            <!-- Header -->
            <div class="detail-header flexrow">
                <div class="flexitem">
                    <h2 class="nmt nmb">
                        {#if mod.manifest.main.icon}
                            <Icon icon={`feather:${mod.manifest.main.icon}`} class="feather"/>
                        {/if}
                        {mod.manifest.main.name}
                    </h2>
                    <code class="dim">{mod.name} v{mod.manifest.main.version}</code>
                </div>
                <button class="nogrow" onclick={closeDetail} title="Close">
                    <Icon icon="feather:x" class="feather"/>
                </button>
            </div>

            {#if mod.manifest.main.tagline}
                <p class="detail-tagline">{mod.manifest.main.tagline}</p>
            {/if}

            <!-- Enable / disable toggle -->
            <div class="detail-toggle">
                <button
                    class="wide"
                    class:a-destructive={enabled}
                    disabled={toggling === mod.name}
                    onclick={(e) => toggleModule(mod, e)}
                >
                    <Icon icon={`feather:${enabled ? 'x' : 'check'}`} class="feather"/>
                    {enabled ? 'Disable module' : 'Enable module'}
                </button>
            </div>

            <!-- Dependencies -->
            {#if mod.manifest.dependencies?.length}
                <div class="detail-section">
                    <b>Dependencies</b>
                    <ul class="dependency-list">
                        {#each mod.manifest.dependencies as dep (dep)}
                            <li>
                                <Icon icon={`feather:${$enabledModuleNames.has(dep) ? 'check' : 'alert-circle'}`}
                                     class={`feather ${$enabledModuleNames.has(dep) ? 'success' : 'error'}`} />
                                {dep}
                            </li>
                        {/each}
                    </ul>
                </div>
            {/if}

            {#if mod.manifest.optionalDependencies?.length}
                <div class="detail-section">
                    <b>Optional dependencies</b>
                    <ul class="dependency-list">
                        {#each mod.manifest.optionalDependencies as dep (dep)}
                            <li>
                                <Icon icon={`feather:${$enabledModuleNames.has(dep) ? 'check' : 'alert-triangle'}`}
                                     class={`feather ${$enabledModuleNames.has(dep) ? 'success' : 'warning'}`} />
                                {dep}
                            </li>
                        {/each}
                    </ul>
                </div>
            {/if}

            <!-- Module fields (only shown when enabled) -->
            {#if enabled && mod.manifest.fields?.length}
                <div class="detail-section detail-fields">
                    <b>Module settings</b>
                    {#each mod.manifest.fields as field (field.key ?? field.name)}
                        {@render fieldEditor(mod.name, field)}
                    {/each}
                </div>
            {/if}

            <!-- Authors -->
            {#if mod.manifest.main.authors?.length}
                <div class="detail-authors">
                    {#each mod.manifest.main.authors as author (author.mail)}
                        <a
                            class="external"
                            href="mailto:{author.mail}"
                            title="Author"
                            onclick={(e) => e.stopPropagation()}
                        >
                            <Icon icon="feather:user" class="feather"/>
                            {author.name}
                        </a>
                    {/each}
                </div>
            {/if}
        </div>
        </div>
    {/if}
</div>

<!-- ── Snippets ─────────────────────────────────────────────────────────────── -->

{#snippet moduleCard(mod: NyxMod)}
    {@const enabled = $enabledModuleNames.has(mod.name)}
    <div class="flexrow">
        <div class="flexitem">
            <h3 class="nmt nmb module-name">
                {#if mod.manifest.main.icon}
                    <Icon icon={`feather:${mod.manifest.main.icon}`} class="feather"/>
                {/if}
                {mod.manifest.main.name}
            </h3>
            <code class="dim">{mod.name} v{mod.manifest.main.version}</code>
        </div>
        <!-- Enable/disable power button -->
        <button
            class="nogrow bigpower"
            class:off={!enabled}
            title={enabled ? 'Disable' : 'Enable'}
            disabled={toggling === mod.name}
            onclick={(e) => toggleModule(mod, e)}
        >
            <Icon icon={`feather:${enabled ? 'check' : 'x'}`} class="feather"/>
        </button>
    </div>
    {#if mod.manifest.main.tagline}
        <div class="hsub">{mod.manifest.main.tagline}</div>
    {/if}
    <!-- Dependency warnings -->
    {#if mod.manifest.dependencies?.length}
        <div class="dependency-inline">
            {#each mod.manifest.dependencies as dep (dep)}
                <span class:success={$enabledModuleNames.has(dep)} class:error={!$enabledModuleNames.has(dep)}>
                    <Icon icon={`feather:${$enabledModuleNames.has(dep) ? 'check' : 'alert-circle'}`} class="feather"/>
                    {dep}
                </span>
            {/each}
        </div>
    {/if}
    <!-- Category icon -->
    <div class="module-card-footer">
        <Icon icon={`feather:${getCatmodIcon(mod)}`} class="feather aModuleIcon" />
    </div>
{/snippet}

{#snippet fieldEditor(modName: string, field: NyxModField)}
    {#if field.type === 'h1' || field.type === 'h2' || field.type === 'h3' || field.type === 'h4'}
        <svelte:element this={field.type}>{field.name}</svelte:element>
    {:else if field.key}
        {@const ck = cleanFieldKey(field.key)}
        {#if field.type === 'table' && field.fields}
            <!-- ── Table field ──────────────────────────────────────────────── -->
            <div class="field-row field-row--block">
                <label>
                    {field.name}
                    {#if field.help}<span class="field-help dim">{field.help}</span>{/if}
                </label>
                <div class="nyx-mods-table">
                    <div class="nyx-mods-table-head">
                        <span class="col-num">№</span>
                        {#each field.fields as sf}
                            <span>{sf.name}</span>
                        {/each}
                        <span class="col-actions">Actions</span>
                    </div>
                    {#each getTableRows(modName, ck) as row, i (i)}
                        <div class="nyx-mods-table-row" class:nyx-row={Boolean(row.__nyxBuiltin)}>
                            <span class="col-num dim">{i}</span>
                            {#each field.fields as sf}
                                {@const sk = cleanFieldKey(sf.key ?? '')}
                                {@const cellVal = row[sk]}
                                <span class="nyx-mods-cell">
                                    {#if row.__nyxBuiltin && (sf.type === 'texture' || sf.key?.includes('@@texture'))}
                                        <span class="nyx-builtin-label">Nyx (built-in)</span>
                                    {:else if sf.type === 'texture' || sf.key?.includes('@@texture')}
                                        <select
                                            value={String(cellVal ?? -1)}
                                            onchange={(e) => setTableCell(modName, ck, i, sk, (e.target as HTMLSelectElement).value)}
                                        >
                                            <option value="-1">(none)</option>
                                            {#each textures as tex (tex.uid)}
                                                <option value={tex.uid}>{tex.name}</option>
                                            {/each}
                                        </select>
                                    {:else if sf.type === 'select' && sf.options}
                                        <select
                                            value={String(cellVal ?? sf.default ?? sf.options[0]?.value ?? '')}
                                            onchange={(e) => setTableCell(modName, ck, i, sk, (e.target as HTMLSelectElement).value)}
                                        >
                                            {#each sf.options as opt (String(opt.value))}
                                                <option value={String(opt.value)}>{opt.name}</option>
                                            {/each}
                                        </select>
                                    {:else if sf.type === 'checkbox'}
                                        <input
                                            type="checkbox"
                                            checked={Boolean(cellVal)}
                                            onchange={(e) => setTableCell(modName, ck, i, sk, (e.target as HTMLInputElement).checked)}
                                        />
                                    {:else if sf.type === 'number' || sf.type === 'slider'}
                                        <input
                                            type="number"
                                            value={Number(cellVal ?? sf.default ?? 0)}
                                            min={sf.min} max={sf.max} step={sf.step ?? 1}
                                            oninput={(e) => setTableCell(modName, ck, i, sk, Number((e.target as HTMLInputElement).value))}
                                        />
                                    {:else if sf.type === 'color'}
                                        <ColorPicker
                                            value={String(cellVal ?? sf.default ?? '#ffffff')}
                                            onchange={(c) => setTableCell(modName, ck, i, sk, c)}
                                        />
                                    {:else}
                                        <input
                                            type="text"
                                            value={String(cellVal ?? sf.default ?? '')}
                                            oninput={(e) => setTableCell(modName, ck, i, sk, (e.target as HTMLInputElement).value)}
                                        />
                                    {/if}
                                </span>
                            {/each}
                            <span class="col-actions">
                                <button class="inline small" title="Move up"    onclick={() => moveTableRow(modName, ck, i, -1)} disabled={i === 0}>↑</button>
                                <button class="inline small" title="Move down"  onclick={() => moveTableRow(modName, ck, i,  1)} disabled={i === getTableRows(modName, ck).length - 1}>↓</button>
                                <button class="inline small danger" title="Remove" onclick={() => removeTableRow(modName, ck, i)}>✕</button>
                            </span>
                        </div>
                    {/each}
                    <button class="inline" onclick={() => addTableRow(modName, ck, field.fields!)}>+ Add a row</button>
                </div>
            </div>
        {:else}
            <!-- ── Scalar field ─────────────────────────────────────────────── -->
            <div class="field-row">
                <label>
                    {field.name}
                    {#if field.help}<span class="field-help dim">{field.help}</span>{/if}
                </label>
                {#if field.type === 'checkbox'}
                    <input
                        type="checkbox"
                        checked={Boolean(getFieldValue(modName, ck))}
                        onchange={(e) => handleFieldInput(modName, field, e)}
                    />
                {:else if field.type === 'number' || field.type === 'slider' || field.type === 'sliderAndNumber'}
                    <input
                        type="number"
                        value={Number(getFieldValue(modName, ck) ?? field.default ?? 0)}
                        min={field.min} max={field.max} step={field.step ?? 1}
                        oninput={(e) => handleFieldInput(modName, field, e)}
                    />
                {:else if field.type === 'text'}
                    <textarea
                        value={String(getFieldValue(modName, ck) ?? field.default ?? '')}
                        oninput={(e) => handleFieldInput(modName, field, e)}
                    ></textarea>
                {:else if field.type === 'select' && field.options}
                    <select
                        value={String(getFieldValue(modName, ck) ?? field.default ?? field.options[0]?.value ?? '')}
                        onchange={(e) => setFieldValue(modName, ck, (e.target as HTMLSelectElement).value)}
                    >
                        {#each field.options as opt (String(opt.value))}
                            <option value={String(opt.value)}>{opt.name}</option>
                        {/each}
                    </select>
                {:else if field.type === 'color'}
                    <ColorPicker
                        value={String(getFieldValue(modName, ck) ?? field.default ?? '#000000')}
                        onchange={(c) => setFieldValue(modName, ck, c)}
                    />
                {:else if field.type === 'texture' || ck !== field.key}
                    <select
                        value={String(getFieldValue(modName, ck) ?? field.default ?? -1)}
                        onchange={(e) => setFieldValue(modName, ck, (e.target as HTMLSelectElement).value)}
                    >
                        <option value="-1">(none)</option>
                        {#each textures as tex (tex.uid)}
                            <option value={tex.uid}>{tex.name}</option>
                        {/each}
                    </select>
                {:else if field.type === 'radio' && field.options}
                    <div class="radio-group">
                        {#each field.options as opt (String(opt.value))}
                            <label class="radio">
                                <input
                                    type="radio"
                                    name="{modName}-{ck}"
                                    value={String(opt.value)}
                                    checked={getFieldValue(modName, ck) === opt.value}
                                    onchange={() => setFieldValue(modName, ck, opt.value)}
                                />
                                {opt.name}
                            </label>
                        {/each}
                    </div>
                {:else}
                    <input
                        type="text"
                        value={String(getFieldValue(modName, ck) ?? field.default ?? '')}
                        oninput={(e) => handleFieldInput(modName, field, e)}
                    />
                {/if}
            </div>
        {/if}
    {/if}
{/snippet}


<style>
    /* ── Shell ──────────────────────────────────────────────────────────────── */
    .nyxmods-panel {
        width: 100%;
        height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
    }

    /* ── Module list (full width) ───────────────────────────────────────────── */
    .nyxmods-list {
        flex: 1 1 auto;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .nyxmods-sections {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 0 0.75rem;
    }

    /* ── Filter section ─────────────────────────────────────────────────────── */
    .aModuleFilter {
        padding: 0.5rem;
        border-bottom: 1px solid var(--border, #333);
        summary { cursor: pointer; font-weight: bold; user-select: none; padding: 0.25rem 0; }
    }

    .aModuleFilterBody {
        gap: 0.75rem;
        flex-wrap: wrap;
        padding-top: 0.5rem;
    }

    .aModuleFilterColumns {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: flex-start;
    }

    .aSearchWrap {
        position: relative;
        display: flex;
        align-items: center;

        input { padding-right: 1.8rem; width: 12rem; }
        :global(.feather) {
            position: absolute;
            right: 0.4rem;
            width: 1rem; height: 1rem;
            pointer-events: none;
            opacity: 0.5;
        }
    }

    /* ── Collapsible sections ───────────────────────────────────────────────── */
    .collapsible-section {
        margin: 0.5rem 0;
        summary {
            cursor: pointer;
            user-select: none;
            h3 { display: inline; margin: 0; font-size: 0.85rem; opacity: 0.7; }
        }
    }

    /* ── Module cards ───────────────────────────────────────────────────────── */
    .aModuleList {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 0.5rem;
        padding: 0.25rem 0;
    }

    .aModuleCard {
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border, #333);
        border-radius: 4px;
        padding: 0.5rem 0.6rem;
        cursor: pointer;
        transition: border-color 0.1s;

        &:hover { border-color: var(--accent, #446adb); }
        &.selected { border-color: var(--accent, #446adb); background: var(--background-hover, #1e2045); }
    }

    .module-name {
        font-size: 0.9rem;
        display: flex;
        align-items: center;
        gap: 0.3rem;
        :global(.feather) { width: 0.9rem; height: 0.9rem; }
    }

    .hsub {
        font-size: 0.75rem;
        opacity: 0.65;
        margin-top: 0.2rem;
    }

    .dependency-inline {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
        margin-top: 0.3rem;
        font-size: 0.72rem;

        span {
            display: flex;
            align-items: center;
            gap: 0.2rem;
            :global(.feather) { width: 0.7rem; height: 0.7rem; }
        }
    }

    .module-card-footer {
        display: flex;
        justify-content: flex-end;
        margin-top: 0.25rem;
        opacity: 0.4;
        .aModuleIcon { width: 1rem; height: 1rem; }
    }

    .bigpower {
        padding: 0.3rem;
        background: var(--success-bg, #1a3a1a);
        border: 1px solid var(--success, #4caf50);
        border-radius: 3px;
        cursor: pointer;
        :global(.feather) { width: 1rem; height: 1rem; color: var(--success, #4caf50); }

        &.off {
            background: var(--background-deeper, #111);
            border-color: var(--border, #555);
            :global(.feather) { color: var(--dimmer, #555); }
        }
    }

    /* ── Modal backdrop + detail box ───────────────────────────────────────── */
    .modal-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
        backdrop-filter: blur(2px);
    }

    .nyxmods-detail {
        width: min(520px, 90%);
        max-height: 82%;
        overflow-y: auto;
        padding: 1.25rem;
        gap: 0.75rem;
        display: flex;
        flex-direction: column;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border, #444);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }

    .detail-header {
        align-items: flex-start;
        gap: 0.5rem;
        h2 {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            :global(.feather) { width: 1.1rem; height: 1.1rem; }
        }
        button {
            padding: 0.3rem;
            background: none;
            border: 1px solid var(--border, #333);
            border-radius: 3px;
            cursor: pointer;
            :global(.feather) { width: 1rem; height: 1rem; }
        }
    }

    .detail-tagline {
        font-size: 0.85rem;
        opacity: 0.7;
        margin: 0;
    }

    .detail-toggle {
        button {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            width: 100%;
            padding: 0.5rem 0.75rem;
            cursor: pointer;
            border-radius: 4px;
            :global(.feather) { width: 1rem; height: 1rem; }
        }
    }

    .detail-section {
        b { display: block; margin-bottom: 0.4rem; font-size: 0.8rem; opacity: 0.6; text-transform: uppercase; }
    }

    .dependency-list {
        list-style: none;
        margin: 0; padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        font-size: 0.85rem;

        li {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            :global(.feather) { width: 0.85rem; height: 0.85rem; }
        }
    }

    .detail-fields {
        .field-row {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            margin-bottom: 0.75rem;
            label { font-size: 0.85rem; }
            input[type="text"], input[type="number"], textarea, select {
                width: 100%;
                background: var(--background-deeper, #111);
                border: 1px solid var(--border, #333);
                color: inherit;
                border-radius: 3px;
                padding: 0.35rem 0.5rem;
                font-size: 0.85rem;
            }
            textarea { min-height: 4rem; resize: vertical; }
            &.field-row--block { margin-bottom: 1rem; }
        }
        .radio-group {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }
        .field-help {
            display: block;
            font-size: 0.75rem;
            margin-top: 0.1rem;
        }

        /* ── Table field ─────────────────────────────────────────────────────── */
        .nyx-mods-table {
            border: 1px solid var(--border, #333);
            border-radius: 4px;
            overflow: hidden;
            font-size: 0.82rem;
        }
        .nyx-mods-table-head,
        .nyx-mods-table-row {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.3rem 0.5rem;
        }
        .nyx-mods-table-head {
            background: var(--background-deeper, #111);
            font-size: 0.75rem;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            opacity: 0.7;
            span { flex: 1; }
        }
        .nyx-mods-table-row {
            border-top: 1px solid var(--border, #333);
            &:hover { background: var(--background-hover, rgba(255,255,255,0.04)); }
        }
        .nyx-mods-cell {
            flex: 1;
            select, input[type="text"], input[type="number"] {
                width: 100%;
                font-size: 0.8rem;
                padding: 0.2rem 0.35rem;
            }
            input[type="checkbox"] { margin: 0 auto; display: block; }
        }
        .col-num {
            flex: 0 0 1.4rem;
            text-align: center;
        }
        .col-actions {
            flex: 0 0 5.5rem;
            display: flex;
            gap: 0.2rem;
            justify-content: flex-end;
            button {
                padding: 0.15rem 0.35rem;
                font-size: 0.75rem;
                &.danger { color: var(--error, #f44336); }
                &:disabled { opacity: 0.3; cursor: default; }
            }
        }
        .nyx-row {
            background: rgba(126, 200, 227, 0.06);
            border-left: 2px solid rgba(126, 200, 227, 0.4);
        }
        .nyx-builtin-label {
            font-size: 0.75rem;
            opacity: 0.7;
            font-style: italic;
            padding: 0 0.25rem;
        }
        .nyx-mods-table > button {
            display: block;
            width: 100%;
            border-top: 1px solid var(--border, #333);
            border-radius: 0;
            padding: 0.4rem;
            font-size: 0.8rem;
            background: transparent;
            &:hover { background: var(--background-hover, rgba(255,255,255,0.04)); }
        }
    }

    .detail-authors {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: auto;
        padding-top: 0.5rem;
        border-top: 1px solid var(--border, #333);
        font-size: 0.8rem;

        a {
            display: flex;
            align-items: center;
            gap: 0.3rem;
            text-decoration: none;
            opacity: 0.6;
            &:hover { opacity: 1; }
            :global(.feather) { width: 0.8rem; height: 0.8rem; }
        }
    }

    /* ── Status colours (re-used from global) ───────────────────────────────── */
    :global(.success) { color: var(--success, #4caf50); }
    :global(.error)   { color: var(--error, #f44336); }
    :global(.warning) { color: var(--warning, #ff9800); }

    .pad  { padding: 0.75rem; }
    .dim  { opacity: 0.5; }
    .nmt  { margin-top: 0; }
    .nmb  { margin-bottom: 0; }
    .nm   { margin: 0; }
    .nogrow  { flex: 0 0 auto; }
    .flexrow { display: flex; flex-flow: row nowrap; 
        /* align-items: center;  */
    }
    .flexitem { flex: 1 1 auto; }
    .flexcol { display: flex; flex-direction: column; }
</style>
