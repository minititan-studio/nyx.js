<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * RoomEntityProperties.svelte
     * Migrated from: room-entities-properties.tag
     *
     * Property inspector for the currently selected copy (or null when nothing /
     * multiple are selected). Renders x, y, depth, scale, angle, alpha and tint
     * inputs, plus a custom `extends` key-value editor.
     *
     * All mutations go through `onchange`. The `copy` prop is null when nothing is
     * selected, or when the caller prefers not to show single-entity controls.
     */
    import type { NyxCopy, NyxTemplate } from '@nyx/shared';
    import { currentProject } from '../../../stores/projectStore';

    interface Props {
        copy: NyxCopy | null;
        templates: NyxTemplate[];
        onchange: (uid: string, patch: Partial<NyxCopy>) => void;
    }
    let { copy, templates, onchange }: Props = $props();

    const selectedTemplate = $derived(
        templates.find(t => t.uid === copy?.templateUid)
    );
    const hasMatter = $derived('matter' in ($currentProject?.modules ?? {}));

    const RESERVED_PROPS = new Set([
        'alpha','anchor','angle','animationSpeed','autoUpdate','blendMode',
        'buttonMode','cacheAsBitmap','children','currentFrame','cursor',
        'filterArea','filters','height','hitArea','interactive',
        'interactiveChildren','isMask','isSprite','localTransform','loop',
        'mask','onComplete','onFrameChange','onLoop','parent','pivot',
        'playing','pluginName','position','renderable','rotation',
        'roundPixels','scale','skew','sortableChildren','sortDirty',
        'texture','textures','tint','totalFrames','transform','updateAnchor',
        'visible','width','worldAlpha','worldTransform','worldVisible',
        'x','y','zIndex',
    ]);

    function getTemplateName(uid: string): string {
        return templates.find(t => t.uid === uid)?.name ?? '(unknown)';
    }

    function num(e: Event): number {
        return parseFloat((e.target as HTMLInputElement).value) || 0;
    }

    // ── Extends editor helpers ────────────────────────────────────────────────

    function addExtendProp(): void {
        if (!copy) return;
        const exts = { ...(copy.extends ?? {}) };
        let key = 'prop';
        let n = 1;
        while (key in exts) key = `prop${n++}`;
        onchange(copy.uid, { extends: { ...exts, [key]: '' } });
    }

    function updateExtendVal(key: string, raw: string): void {
        if (!copy) return;
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        onchange(copy.uid, { extends: { ...(copy.extends ?? {}), [key]: parsed } });
    }

    function renameExtendKey(oldKey: string, newKey: string): void {
        if (!copy) return;
        const exts = { ...(copy.extends ?? {}) };
        exts[newKey.trim()] = exts[oldKey];
        delete exts[oldKey];
        onchange(copy.uid, { extends: exts });
    }

    function deleteExtendProp(key: string): void {
        if (!copy) return;
        const exts = { ...(copy.extends ?? {}) };
        delete exts[key];
        onchange(copy.uid, { extends: exts });
    }

    // ── Physics overrides helpers ─────────────────────────────────────────────

    function patchExtends(key: string, val: unknown | undefined): void {
        if (!copy) return;
        if (val === undefined) {
            onchange(copy.uid, {
                extends: Object.fromEntries(
                    Object.entries(copy.extends ?? {}).filter(([k]) => k !== key)
                )
            });
        } else {
            onchange(copy.uid, { extends: { ...(copy.extends ?? {}), [key]: val } });
        }
    }
</script>

<div class="entity-props">
    {#if copy}
        <div class="tmpl-label">
            <Icon icon="feather:box" class="feather"/>
            <span class="tmpl-name">{getTemplateName(copy.templateUid)}</span>
        </div>

        <div class="insp-grid">
            <span>X</span>
            <input type="number" step="1" value={copy.x}
                   aria-label="X"
                   onchange={(e) => onchange(copy!.uid, { x: num(e) })} />
            <span>Y</span>
            <input type="number" step="1" value={copy.y}
                   aria-label="Y"
                   onchange={(e) => onchange(copy!.uid, { y: num(e) })} />
            <!-- <span>Depth</span>
            <input type="number" step="1" value={copy.depth ?? 0}
                   aria-label="Depth"
                   onchange={(e) => onchange(copy!.uid, { depth: num(e) })} /> -->
            <span>Scale X</span>
            <input type="number" step="0.1" value={copy.scaleX ?? 1}
                   aria-label="Scale X"
                   onchange={(e) => onchange(copy!.uid, { scaleX: num(e) || 1 })} />
            <span>Scale Y</span>
            <input type="number" step="0.1" value={copy.scaleY ?? 1}
                   aria-label="Scale Y"
                   onchange={(e) => onchange(copy!.uid, { scaleY: num(e) || 1 })} />
            <span>Angle</span>
            <div class="angle-row">
                <input type="range" min="-180" max="180" step="1"
                       value={copy.angle ?? 0}
                       aria-label="Angle slider"
                       oninput={(e) => onchange(copy!.uid, { angle: num(e) })} />
                <input type="number" step="1" min="-180" max="180"
                       value={copy.angle ?? 0}
                       aria-label="Angle"
                       onchange={(e) => onchange(copy!.uid, { angle: num(e) })} />
            </div>
            <span>Alpha</span>
            <div class="angle-row">
                <input type="range" min="0" max="1" step="0.01"
                       value={copy.alpha ?? 1}
                       aria-label="Alpha slider"
                       oninput={(e) => onchange(copy!.uid, { alpha: num(e) })} />
                <input type="number" step="0.05" min="0" max="1"
                       value={copy.alpha ?? 1}
                       aria-label="Alpha"
                       onchange={(e) => onchange(copy!.uid, { alpha: Math.max(0, Math.min(1, num(e) || 1)) })} />
            </div>
            <span>Tint</span>
            <div class="tint-row">
                <input type="color" value={copy.tint ?? '#ffffff'}
                       aria-label="Tint colour"
                       oninput={(e) => onchange(copy!.uid, { tint: (e.target as HTMLInputElement).value })} />
                <input type="text" class="hex" value={copy.tint ?? '#ffffff'}
                       aria-label="Tint hex"
                       onchange={(e) => onchange(copy!.uid, { tint: (e.target as HTMLInputElement).value })} />
            </div>
        </div>

        <!-- Custom extends -->
        <div class="extends-section">
            <div class="extends-header">
                <span class="dim small">Custom properties</span>
                <button class="icon-sm" title="Add property" onclick={addExtendProp}>
                    <Icon icon="feather:plus" class="feather"/>
                </button>
            </div>
            {#each Object.entries(copy.extends ?? {}) as [key, val]}
                <div class="extend-row" class:reserved={RESERVED_PROPS.has(key)}>
                    <input type="text" class="ext-key" aria-label="Property name" value={key}
                           onchange={(e) => renameExtendKey(key, (e.target as HTMLInputElement).value)} />
                    <input type="text" class="ext-val" aria-label="Property value"
                           value={typeof val === 'string' ? val : JSON.stringify(val)}
                           onchange={(e) => updateExtendVal(key, (e.target as HTMLInputElement).value)} />
                    <button class="icon-sm danger" title="Remove property"
                            onclick={() => deleteExtendProp(key)}>
                        <Icon icon="feather:x" class="feather"/>
                    </button>
                    {#if RESERVED_PROPS.has(key)}
                        <span class="reserved-warn" title="Conflicts with a built-in PixiJS property">
                            ⚠ reserved
                        </span>
                    {/if}
                </div>
            {/each}
        </div>

        <!-- Physics overrides (only when matter catmod is enabled and template has physics on) -->
        {#if hasMatter && selectedTemplate?.physics?.enabled}
            <div class="extends-section">
                <div class="extends-header">
                    <span class="dim small">Physics Overrides</span>
                </div>
                <div class="insp-grid">
                    <span>Is Static</span>
                    <input type="checkbox"
                           aria-label="Is Static"
                           checked={!!(copy.extends?.matterStatic)}
                           onchange={(e) => patchExtends('matterStatic', (e.target as HTMLInputElement).checked ? true : undefined)} />
                    <span>Is Sensor</span>
                    <input type="checkbox"
                           aria-label="Is Sensor"
                           checked={!!(copy.extends?.matterSensor)}
                           onchange={(e) => patchExtends('matterSensor', (e.target as HTMLInputElement).checked ? true : undefined)} />
                    <span>Density</span>
                    <input type="number"
                           aria-label="Density"
                           min="0.0001" step="0.001"
                           value={copy.extends?.matterDensity as number | undefined}
                           placeholder={String(selectedTemplate?.physics?.density ?? 0.001)}
                           onchange={(e) => {
                               const v = parseFloat((e.target as HTMLInputElement).value);
                               patchExtends('matterDensity', isNaN(v) ? undefined : v);
                           }} />
                </div>
            </div>
        {/if}
    {:else}
        <p class="dim small no-sel">Select a copy in the canvas or list.</p>
    {/if}
</div>

<style>
    .entity-props {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }

    .tmpl-label {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.2rem 0;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        margin-bottom: 0.15rem;
    }
    .tmpl-label svg {
        width: 0.85rem;
        height: 0.85rem;
        fill: none;
        stroke: var(--text-dim, #888);
        stroke-width: 2;
        flex-shrink: 0;
    }
    .tmpl-name {
        font-size: 0.82rem;
        color: var(--text, #e0e0e0);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .insp-grid {
        display: grid;
        grid-template-columns: 4rem 1fr;
        gap: 0.2rem 0.4rem;
        align-items: center;
    }
    .insp-grid span {
        font-size: 0.78rem;
        color: var(--text-dim, #888);
    }
    .insp-grid input {
        width: 100%;
        box-sizing: border-box;
    }

    .angle-row {
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }
    .angle-row input[type="range"]  { flex: 1; }
    .angle-row input[type="number"] { width: 52px; flex-shrink: 0; }

    .tint-row {
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }
    .tint-row input[type="color"] {
        width: 28px;
        height: 24px;
        padding: 1px;
        border-radius: 3px;
        flex-shrink: 0;
        border: 1px solid var(--border-bright, #333);
        background: transparent;
        cursor: pointer;
    }
    .tint-row input[type="text"] {
        flex: 1;
        font-family: monospace;
    }

    input[type="number"],
    input[type="text"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.8rem;
    }
    input[type="number"]:focus,
    input[type="text"]:focus {
        outline: none;
        border-color: var(--accent1, #446adb);
    }
    input.hex { font-family: monospace; }

    /* Extends */
    .extends-section {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        border-top: 1px solid var(--border-pale, #2a2a3e);
        padding-top: 0.35rem;
    }
    .extends-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.1rem 0;
    }
    .extend-row {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        flex-wrap: wrap;
    }
    .extend-row.reserved {
        outline: 1px solid #e08030;
        border-radius: 3px;
    }
    .reserved-warn {
        width: 100%;
        font-size: 0.7rem;
        color: #e08030;
        padding: 0 2px;
    }
    .ext-key { flex: 0 0 40%; min-width: 0; box-sizing: border-box; }
    .ext-val { flex: 1 1 auto; min-width: 0; box-sizing: border-box; }

    .icon-sm {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        padding: 0;
        flex-shrink: 0;
        border: 1px solid transparent;
        border-radius: 3px;
        background: transparent;
        color: var(--text-dim, #888);
        cursor: pointer;
    }
    .icon-sm svg {
        width: 0.8rem;
        height: 0.8rem;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
    }
    .icon-sm:hover {
        color: var(--text, #e0e0e0);
        background: var(--act, #1e2233);
        border-color: var(--border-bright, #333);
    }
    .icon-sm.danger:hover {
        color: var(--danger, #e74c3c);
        border-color: var(--danger, #e74c3c);
        background: transparent;
    }

    .no-sel {
        padding: 0.4rem 0;
    }

    p  { margin: 0; font-size: 0.85rem; }
    .small { font-size: 0.78rem; }
    .dim   { color: var(--text-dim, #888); }
</style>
