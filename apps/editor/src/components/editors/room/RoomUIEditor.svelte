<script lang="ts">
    import Icon from "@iconify/svelte";
    import ColorPicker from '@nyx/ui-kit/ColorPicker.svelte';
    import type { NyxUILayer, NyxTexture, NyxUIWidget, NyxUIWidgetType, NyxUIAnchor, UIHierarchyResult } from '@nyx/shared';
    import { defaultUIWidget, validateUIHierarchy, getDescendants } from '@nyx/shared';

    let addDropdownOpen = $state(false);

    interface Props {
        activeLayer:          NyxUILayer | null;
        allLayers:            NyxUILayer[];
        roomLayerUids:        string[];
        textures:             NyxTexture[];
        selectedUid:          string | null;
        onlayerchange:        (widgets: NyxUIWidget[]) => void;
        onlayeruidschange:    (uids: string[]) => void;
        onactivelayerchange:  (uid: string) => void;
        onselect:             (uid: string | null) => void;
        onreparent?:          (widgetUid: string, newParentUid: string | undefined) => void;
        hidePicker?:          boolean;
    }
    let { activeLayer, allLayers, roomLayerUids, textures, selectedUid,
          onlayerchange, onlayeruidschange, onactivelayerchange,
          onselect, onreparent, hidePicker = false }: Props = $props();

    const WIDGET_TYPES: { type: NyxUIWidgetType; label: string; icon: string }[] = [
        { type: 'label',       label: 'Label',    icon: 'feather:type' },
        { type: 'button',      label: 'Button',   icon: 'feather:square' },
        { type: 'image',       label: 'Image',    icon: 'feather:image' },
        { type: 'panel',       label: 'Panel',    icon: 'feather:layout' },
        { type: 'progressbar', label: 'Bar',      icon: 'feather:bar-chart-2' },
    ];

    const ANCHORS: { value: NyxUIAnchor; label: string }[] = [
        { value: 'topLeft',      label: '↖ Top Left' },
        { value: 'topCenter',    label: '↑ Top Center' },
        { value: 'topRight',     label: '↗ Top Right' },
        { value: 'middleLeft',   label: '← Middle Left' },
        { value: 'center',       label: '✛ Center' },
        { value: 'middleRight',  label: '→ Middle Right' },
        { value: 'bottomLeft',   label: '↙ Bottom Left' },
        { value: 'bottomCenter', label: '↓ Bottom Center' },
        { value: 'bottomRight',  label: '↘ Bottom Right' },
    ];

    const widgets   = $derived(activeLayer?.widgets ?? []);
    const selected  = $derived(widgets.find(w => w.uid === selectedUid) ?? null);
    const hierarchy = $derived(validateUIHierarchy(widgets));

    // ── Hierarchy tree ────────────────────────────────────────────────────────
    interface TreeNode {
        widget: NyxUIWidget;
        depth: number;
        hasChildren: boolean;
        isCollapsed: boolean;
    }

    let collapsed = $state(new Set<string>());

    function buildTreeNodes(ws: NyxUIWidget[], col: Set<string>, hier: UIHierarchyResult): TreeNode[] {
        const { parentMap, roots } = hier;
        const byUid = new Map(ws.map(w => [w.uid, w]));
        const childrenOf = new Map<string, NyxUIWidget[]>();
        for (const w of ws) {
            const pid = parentMap.get(w.uid);
            if (pid !== undefined) {
                if (!childrenOf.has(pid)) childrenOf.set(pid, []);
                childrenOf.get(pid)!.push(w);
            }
        }
        const result: TreeNode[] = [];
        function visit(w: NyxUIWidget, depth: number): void {
            const kids = childrenOf.get(w.uid) ?? [];
            result.push({ widget: w, depth, hasChildren: kids.length > 0, isCollapsed: col.has(w.uid) });
            if (!col.has(w.uid)) {
                for (const child of kids) visit(child, depth + 1);
            }
        }
        // roots is Set<string> (UIDs) — look up widget objects before visiting
        for (const rootUid of roots) {
            const rootWidget = byUid.get(rootUid);
            if (rootWidget) visit(rootWidget, 0);
        }
        // duplicate-uid widgets are excluded from byUid — surface them at root
        for (const w of ws) {
            if (!result.some(n => n.widget.uid === w.uid)) {
                result.push({ widget: w, depth: 0, hasChildren: false, isCollapsed: false });
            }
        }
        return result;
    }

    const treeNodes = $derived(buildTreeNodes(widgets, collapsed, hierarchy));

    function toggleCollapse(uid: string): void {
        const next = new Set(collapsed);
        if (next.has(uid)) next.delete(uid); else next.add(uid);
        collapsed = next;
    }

    // ── Mutations ─────────────────────────────────────────────────────────────

    function addWidget(type: NyxUIWidgetType): void {
        const uid  = crypto.randomUUID();
        const same = widgets.filter(w => w.type === type).length;
        const w    = defaultUIWidget(type, uid, `${type}${same + 1}`);
        onlayerchange([...widgets, w]);
        onselect(uid);
    }

    function deleteWidget(uid: string): void {
        onlayerchange(widgets.filter(w => w.uid !== uid));
        if (selectedUid === uid) onselect(null);
    }

    function patch(uid: string, p: Partial<NyxUIWidget>): void {
        onlayerchange(widgets.map(w => w.uid === uid ? { ...w, ...p } as NyxUIWidget : w));
    }

    function reorder(uid: string, dir: -1 | 1): void {
        const w = widgets.find(x => x.uid === uid);
        if (!w) return;
        const siblings = widgets.filter(s => (s.parentUid ?? null) === (w.parentUid ?? null));
        const sibIdx = siblings.findIndex(s => s.uid === uid);
        const nextSibIdx = sibIdx + dir;
        if (nextSibIdx < 0 || nextSibIdx >= siblings.length) return;
        const arr = [...widgets];
        const aIdx = arr.findIndex(x => x.uid === uid);
        const bIdx = arr.findIndex(x => x.uid === siblings[nextSibIdx].uid);
        [arr[aIdx], arr[bIdx]] = [arr[bIdx], arr[aIdx]];
        onlayerchange(arr);
    }
</script>

<!-- ── Layer manager ──────────────────────────────────────────────────────── -->
{#if !hidePicker}
<div class="layer-manager">
    <div class="layer-manager-header">
        <span class="layer-manager-title">UI Layers</span>

        <!-- Add layer dropdown -->
        <div class="add-layer-wrap">
            <button class="add-layer-btn" onclick={() => { addDropdownOpen = !addDropdownOpen; }}
                    title="Add a UI layer to this room"
                    disabled={allLayers.filter(l => !roomLayerUids.includes(l.uid)).length === 0}>
                <Icon icon="feather:plus" class="feather"/>
                Add
            </button>
            {#if addDropdownOpen}
                <div class="add-layer-dropdown">
                    {#each allLayers.filter(l => !roomLayerUids.includes(l.uid)) as layer (layer.uid)}
                        <button class="add-layer-item" onclick={() => {
                            onlayeruidschange([...roomLayerUids, layer.uid]);
                            onactivelayerchange(layer.uid);
                            addDropdownOpen = false;
                        }}>
                            <Icon icon="material-symbols:layers" class="feather"/>
                            {layer.name}
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
    </div>

    {#if allLayers.length === 0}
        <div class="layer-empty dim small">No UI layers yet — create one in the asset browser.</div>
    {:else if roomLayerUids.length === 0}
        <div class="layer-empty dim small">No layers assigned. Click Add to attach one.</div>
    {:else}
        <!-- Assigned layers list -->
        <div class="assigned-list">
            {#each roomLayerUids as uid (uid)}
                {@const layer = allLayers.find(l => l.uid === uid)}
                {#if layer}
                    <div class="assigned-row" class:active={activeLayer?.uid === uid}>
                        <button class="assigned-name" onclick={() => onactivelayerchange(uid)}>
                            <Icon icon="material-symbols:layers" class="feather"/>
                            {layer.name}
                        </button>
                        <button class="assigned-remove" title="Remove from room"
                                onclick={() => {
                                    onlayeruidschange(roomLayerUids.filter(u => u !== uid));
                                }}>
                            <Icon icon="feather:x" class="feather"/>
                        </button>
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>
{/if}

<!-- ── Add widget toolbar ─────────────────────────────────────────────────── -->
<div class="ui-toolbar">
    <span class="dim small">Add:</span>
    {#each WIDGET_TYPES as wt}
        <button class="add-btn" title="Add {wt.label}" onclick={() => addWidget(wt.type)}>
            <Icon icon={wt.icon} class="feather"/>
            {wt.label}
        </button>
    {/each}
</div>

<!-- ── Widget list ────────────────────────────────────────────────────────── -->
{#if activeLayer === null}
    <div class="empty-hint dim small">Select a layer above to edit its widgets.</div>
{:else if widgets.length === 0}
    <div class="empty-hint dim small">No UI widgets. Add one above.</div>
{:else}
    <div class="widget-list">
        {#each treeNodes as node (node.widget.uid)}
            {@const w = node.widget}
            <div class="widget-row" class:selected={w.uid === selectedUid}
                 style:padding-left="{node.depth * 16 + 8}px"
                 onclick={() => onselect(w.uid)}>
                {#if node.hasChildren}
                    <button class="icon-btn collapse-btn"
                            title={node.isCollapsed ? 'Expand' : 'Collapse'}
                            onclick={(e) => { e.stopPropagation(); toggleCollapse(w.uid); }}>
                        <Icon icon={node.isCollapsed ? 'feather:chevron-right' : 'feather:chevron-down'} class="feather"/>
                    </button>
                {:else}
                    <span class="collapse-spacer"></span>
                {/if}
                <Icon icon={WIDGET_TYPES.find(t => t.type === w.type)?.icon ?? 'feather:box'} class="feather type-icon"/>
                <span class="widget-name">{w.name}</span>
                <span class="dim small widget-type">{w.type}</span>
                {#if !w.visible}
                    <Icon icon="feather:eye-off" class="feather dim-icon" title="Hidden"/>
                {/if}
                {#if hierarchy.diagnostics.some(d => d.widgetUid === w.uid)}
                    <Icon icon="feather:alert-triangle" class="feather dim-icon" title="Hierarchy issue"/>
                {/if}
                <div class="row-actions">
                    <button class="icon-btn" title="Move up"   onclick={(e) => { e.stopPropagation(); reorder(w.uid, -1); }}>
                        <Icon icon="feather:chevron-up" class="feather"/>
                    </button>
                    <button class="icon-btn" title="Move down" onclick={(e) => { e.stopPropagation(); reorder(w.uid,  1); }}>
                        <Icon icon="feather:chevron-down" class="feather"/>
                    </button>
                    <button class="icon-btn danger" title="Delete" onclick={(e) => { e.stopPropagation(); deleteWidget(w.uid); }}>
                        <Icon icon="feather:trash-2" class="feather"/>
                    </button>
                </div>
            </div>
        {/each}
    </div>
{/if}

<!-- ── Property inspector ─────────────────────────────────────────────────── -->
{#if selected}
    {@const w = selected}
    <div class="insp-section">
        <div class="insp-header">Properties — <em>{w.type}</em></div>

        <div class="insp-grid">
            <!-- Name -->
            <span>Name</span>
            <input type="text" value={w.name}
                   onchange={(e) => patch(w.uid, { name: (e.target as HTMLInputElement).value })} />

            <!-- Anchor -->
            <span>Anchor</span>
            <select value={w.anchor}
                    onchange={(e) => patch(w.uid, { anchor: (e.target as HTMLSelectElement).value as NyxUIAnchor })}>
                {#each ANCHORS as a}
                    <option value={a.value}>{a.label}</option>
                {/each}
            </select>

            <!-- Position -->
            <span>X</span>
            <input type="number" step="1" value={w.x}
                   onchange={(e) => patch(w.uid, { x: parseFloat((e.target as HTMLInputElement).value) || 0 })} />
            <span>Y</span>
            <input type="number" step="1" value={w.y}
                   onchange={(e) => patch(w.uid, { y: parseFloat((e.target as HTMLInputElement).value) || 0 })} />

            <!-- Size -->
            <span>Width</span>
            <input type="number" step="1" min="1" value={w.width}
                   onchange={(e) => patch(w.uid, { width: Math.max(1, parseFloat((e.target as HTMLInputElement).value) || 1) })} />
            <span>Height</span>
            <input type="number" step="1" min="1" value={w.height}
                   onchange={(e) => patch(w.uid, { height: Math.max(1, parseFloat((e.target as HTMLInputElement).value) || 1) })} />

            <!-- Rotation -->
            <span>Rotation</span>
            <input type="number" step="1" min="-180" max="180" value={w.rotation ?? 0}
                   onchange={(e) => patch(w.uid, { rotation: parseFloat((e.target as HTMLInputElement).value) || 0 })} />

            <!-- Alpha -->
            <span>Alpha</span>
            <input type="number" step="0.05" min="0" max="1" value={w.alpha}
                   onchange={(e) => patch(w.uid, { alpha: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 1)) })} />

            <!-- Visible -->
            <span>Visible</span>
            <label class="toggle-label">
                <input type="checkbox" checked={w.visible}
                       onchange={(e) => patch(w.uid, { visible: (e.target as HTMLInputElement).checked })} />
                <span class="toggle-text">{w.visible ? 'Yes' : 'No'}</span>
            </label>

            <!-- Shadow -->
            <span>Shadow</span>
            <label class="toggle-label">
                <input type="checkbox" checked={w.shadow?.enabled ?? false}
                       onchange={(e) => patch(w.uid, {
                           shadow: { color: '#000000', blur: 8, offsetX: 4, offsetY: 4,
                                     ...(w.shadow ?? {}),
                                     enabled: (e.target as HTMLInputElement).checked }
                       })} />
                <span class="toggle-text">{w.shadow?.enabled ? 'On' : 'Off'}</span>
            </label>

            {#if w.shadow?.enabled}
                <span>Shadow color</span>
                <ColorPicker showAlpha={true} value={w.shadow.color}
                             onchange={(c) => patch(w.uid, { shadow: { ...w.shadow!, color: c } })} />
                <span>Blur</span>
                <input type="number" step="1" min="0" max="64" value={w.shadow.blur}
                       onchange={(e) => patch(w.uid, { shadow: { ...w.shadow!, blur: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) } })} />
                <span>Offset X</span>
                <input type="number" step="1" value={w.shadow.offsetX}
                       onchange={(e) => patch(w.uid, { shadow: { ...w.shadow!, offsetX: parseFloat((e.target as HTMLInputElement).value) || 0 } })} />
                <span>Offset Y</span>
                <input type="number" step="1" value={w.shadow.offsetY}
                       onchange={(e) => patch(w.uid, { shadow: { ...w.shadow!, offsetY: parseFloat((e.target as HTMLInputElement).value) || 0 } })} />
            {/if}

            <!-- Parent -->
            <span>Parent</span>
            <div class="parent-row">
                <select value={w.parentUid ?? ''}
                        onchange={(e) => {
                            const newParentUid = (e.target as HTMLSelectElement).value || undefined;
                            if (onreparent) onreparent(w.uid, newParentUid);
                            else patch(w.uid, { parentUid: newParentUid });
                        }}>
                    <option value="">— None —</option>
                    {#each widgets.filter(p => !getDescendants(w.uid, widgets).has(p.uid)) as p}
                        <option value={p.uid}>{p.name}</option>
                    {/each}
                </select>
                {#if w.parentUid}
                    <button class="icon-btn" title="Unparent" onclick={() => {
                        if (onreparent) onreparent(w.uid, undefined);
                        else patch(w.uid, { parentUid: undefined });
                    }}>
                        <Icon icon="feather:x" class="feather"/>
                    </button>
                {/if}
            </div>
        </div>

        <!-- ── Type-specific fields ──────────────────────────────────────── -->
        {#if w.type === 'label'}
            <div class="insp-grid">
                <span>Text</span>
                <input type="text" value={w.text}
                       onchange={(e) => patch(w.uid, { text: (e.target as HTMLInputElement).value })} />
                <span>Font size</span>
                <input type="number" step="1" min="6" value={w.fontSize}
                       onchange={(e) => patch(w.uid, { fontSize: Math.max(6, parseFloat((e.target as HTMLInputElement).value) || 16) })} />
                <span>Color</span>
                <ColorPicker showAlpha={true} value={w.color} onchange={(c) => patch(w.uid, { color: c })} />
                <span>Align</span>
                <select value={w.align}
                        onchange={(e) => patch(w.uid, { align: (e.target as HTMLSelectElement).value as 'left'|'center'|'right' })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                </select>
                <span>Bold</span>
                <input type="checkbox" checked={w.bold}
                       onchange={(e) => patch(w.uid, { bold: (e.target as HTMLInputElement).checked })} />
                <span>Italic</span>
                <input type="checkbox" checked={w.italic}
                       onchange={(e) => patch(w.uid, { italic: (e.target as HTMLInputElement).checked })} />
            </div>
        {/if}

        {#if w.type === 'button'}
            <div class="insp-grid">
                <span>Text</span>
                <input type="text" value={w.text}
                       onchange={(e) => patch(w.uid, { text: (e.target as HTMLInputElement).value })} />
                <span>Font size</span>
                <input type="number" step="1" min="6" value={w.fontSize}
                       onchange={(e) => patch(w.uid, { fontSize: Math.max(6, parseFloat((e.target as HTMLInputElement).value) || 14) })} />
                <span>Text color</span>
                <ColorPicker showAlpha={true} value={w.textColor} onchange={(c) => patch(w.uid, { textColor: c })} />
                <span>Background</span>
                <ColorPicker showAlpha={true} value={w.backgroundColor} onchange={(c) => patch(w.uid, { backgroundColor: c })} />
                <span>Hover color</span>
                <ColorPicker showAlpha={true} value={w.hoverColor} onchange={(c) => patch(w.uid, { hoverColor: c })} />
                <span>Radius</span>
                <input type="number" step="1" min="0" value={w.borderRadius}
                       onchange={(e) => patch(w.uid, { borderRadius: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) })} />
            </div>
        {/if}

        {#if w.type === 'image'}
            <div class="insp-grid">
                <span>Texture</span>
                <select value={w.textureUid ?? ''}
                        onchange={(e) => patch(w.uid, { textureUid: (e.target as HTMLSelectElement).value || null })}>
                    <option value="">— none —</option>
                    {#each textures as t}
                        <option value={t.uid}>{t.name}</option>
                    {/each}
                </select>
                <span>Tint</span>
                <ColorPicker showAlpha={true} value={w.tint} onchange={(c) => patch(w.uid, { tint: c })} />
                <span>Keep aspect</span>
                <input type="checkbox" checked={w.keepAspect}
                       onchange={(e) => patch(w.uid, { keepAspect: (e.target as HTMLInputElement).checked })} />
            </div>
        {/if}

        {#if w.type === 'panel'}
            <div class="insp-grid">
                <span>Background</span>
                <ColorPicker showAlpha={true} value={w.backgroundColor} onchange={(c) => patch(w.uid, { backgroundColor: c })} />
                <span>Border color</span>
                <ColorPicker showAlpha={true} value={w.borderColor} onchange={(c) => patch(w.uid, { borderColor: c })} />
                <span>Border width</span>
                <input type="number" step="1" min="0" value={w.borderWidth}
                       onchange={(e) => patch(w.uid, { borderWidth: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) })} />
                <span>Radius</span>
                <input type="number" step="1" min="0" value={w.borderRadius}
                       onchange={(e) => patch(w.uid, { borderRadius: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) })} />
            </div>
        {/if}

        {#if w.type === 'progressbar'}
            <div class="insp-grid">
                <span>Value</span>
                <input type="number" step="0.05" min="0" max="1" value={w.value}
                       onchange={(e) => patch(w.uid, { value: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 0)) })} />
                <span>Fill color</span>
                <ColorPicker showAlpha={true} value={w.fillColor} onchange={(c) => patch(w.uid, { fillColor: c })} />
                <span>Background</span>
                <ColorPicker showAlpha={true} value={w.backgroundColor} onchange={(c) => patch(w.uid, { backgroundColor: c })} />
                <span>Radius</span>
                <input type="number" step="1" min="0" value={w.borderRadius}
                       onchange={(e) => patch(w.uid, { borderRadius: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0) })} />
                <span>Direction</span>
                <select value={w.direction}
                        onchange={(e) => patch(w.uid, { direction: (e.target as HTMLSelectElement).value as 'horizontal'|'vertical' })}>
                    <option value="horizontal">Horizontal</option>
                    <option value="vertical">Vertical</option>
                </select>
            </div>
        {/if}

        {#if hierarchy.diagnostics.some(d => d.widgetUid === w.uid)}
            <div class="warn-box">
                {#each hierarchy.diagnostics.filter(d => d.widgetUid === w.uid) as d}
                    <div class="warn-row">{d.type}: {d.detail ?? ''}</div>
                {/each}
            </div>
        {/if}
    </div>
{/if}

<style>
    .ui-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--ct-modal-border, #2a2a3e);
        flex-wrap: wrap;
    }
    .add-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 3px 7px;
        font-size: 11px;
        background: var(--ct-modal-bg, #1a1a2e);
        border: 1px solid var(--ct-modal-border, #2a2a3e);
        border-radius: 4px;
        color: var(--ct-ui-text, #ccc);
        cursor: pointer;
    }
    .add-btn:hover { border-color: var(--ct-accent, #5c7aff); color: #fff; }

    .empty-hint { padding: 16px 12px; }

    .widget-list {
        display: flex;
        flex-direction: column;
        gap: 1px;
        overflow-y: auto;
        max-height: 180px;
        border-bottom: 1px solid var(--ct-modal-border, #2a2a3e);
    }
    .widget-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        cursor: pointer;
        border-radius: 3px;
        font-size: 12px;
    }
    .widget-row:hover  { background: rgba(255,255,255,0.04); }
    .widget-row.selected { background: rgba(92,122,255,0.18); }
    .widget-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .widget-type { font-size: 10px; opacity: 0.5; }
    .row-actions { display: flex; gap: 2px; opacity: 0; }
    .widget-row:hover .row-actions { opacity: 1; }
    .icon-btn {
        background: none; border: none; padding: 2px 3px;
        cursor: pointer; color: var(--ct-ui-text, #ccc); border-radius: 3px;
        display: flex; align-items: center;
    }
    .icon-btn:hover { background: rgba(255,255,255,0.1); }
    .icon-btn.danger:hover { color: #ff5f57; }
    .type-icon { opacity: 0.55; flex-shrink: 0; }
    .dim-icon  { opacity: 0.4; }
    .collapse-btn    { padding: 1px 2px; opacity: 0.55; flex-shrink: 0; }
    .collapse-btn:hover { opacity: 1; background: rgba(255,255,255,0.08); }
    .collapse-spacer { width: 18px; flex-shrink: 0; display: inline-block; }

    .insp-section {
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        overflow-y: auto;
    }
    .insp-header {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.6;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--ct-modal-border, #2a2a3e);
    }
    .insp-grid {
        display: grid;
        grid-template-columns: 80px 1fr;
        gap: 4px 8px;
        align-items: center;
        font-size: 12px;
    }
    .insp-grid span { opacity: 0.7; white-space: nowrap; }
    .insp-grid input[type="text"],
    .insp-grid input[type="number"],
    .insp-grid select {
        width: 100%;
        background: var(--ct-input-bg, #12121e);
        border: 1px solid var(--ct-modal-border, #2a2a3e);
        border-radius: 3px;
        color: inherit;
        padding: 2px 5px;
        font-size: 12px;
    }
.toggle-label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .toggle-text  { font-size: 12px; opacity: 0.8; }

    .parent-row {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .parent-row select { flex: 1; }

    .warn-box {
        background: rgba(255, 160, 0, 0.1);
        border: 1px solid rgba(255, 160, 0, 0.4);
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        color: #ffa000;
    }
    .warn-row { padding: 1px 0; }

    /* ── Layer bar ──────────────────────────────────────────────────────────── */
    .layer-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 5px 8px;
        border-bottom: 1px solid var(--ct-modal-border, #2a2a3e);
        flex-wrap: wrap;
    }
    .layer-chip {
        padding: 2px 8px;
        font-size: 11px;
        border-radius: 10px;
        border: 1px solid var(--ct-modal-border, #2a2a3e);
        background: var(--ct-modal-bg, #1a1a2e);
        color: var(--ct-ui-text, #ccc);
        cursor: pointer;
        opacity: 0.55;
        transition: opacity 0.1s, border-color 0.1s;
    }
    /* ── Layer manager ──────────────────────────────────────────────────────── */
    .layer-manager {
        border-bottom: 1px solid var(--ct-modal-border, #2a2a3e);
        flex-shrink: 0;
    }
    .layer-manager-header {
        display: flex;
        align-items: center;
        padding: 5px 8px;
        gap: 6px;
    }
    .layer-manager-title {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.45;
        flex: 1;
    }
    .layer-empty {
        padding: 6px 10px 8px;
        font-style: italic;
    }

    /* Add button + dropdown */
    .add-layer-wrap { position: relative; }
    .add-layer-btn {
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 2px 7px;
        font-size: 11px;
        background: var(--ct-modal-bg, #1a1a2e);
        border: 1px solid var(--ct-modal-border, #2a2a3e);
        border-radius: 4px;
        color: var(--ct-accent, #5c7aff);
        cursor: pointer;
    }
    .add-layer-btn:hover:not(:disabled) { border-color: var(--ct-accent, #5c7aff); background: rgba(92,122,255,0.1); }
    .add-layer-btn:disabled { opacity: 0.3; cursor: default; }
    .add-layer-dropdown {
        position: absolute;
        top: calc(100% + 3px);
        right: 0;
        z-index: 100;
        background: var(--ct-modal-bg, #1a1a2e);
        border: 1px solid var(--ct-modal-border, #2a2a3e);
        border-radius: 5px;
        box-shadow: 0 6px 18px rgba(0,0,0,0.5);
        min-width: 140px;
        padding: 4px 0;
    }
    .add-layer-item {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 5px 10px;
        font-size: 11px;
        background: none;
        border: none;
        color: var(--ct-ui-text, #ccc);
        cursor: pointer;
        text-align: left;
        white-space: nowrap;
    }
    .add-layer-item:hover { background: rgba(92,122,255,0.15); color: #fff; }

    /* Assigned list */
    .assigned-list { padding: 2px 0 6px; }
    .assigned-row {
        display: flex;
        align-items: center;
        padding: 1px 8px;
        border-radius: 3px;
        margin: 1px 4px;
    }
    .assigned-row.active { background: rgba(92,122,255,0.12); }
    .assigned-name {
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 1;
        padding: 4px 3px;
        background: none;
        border: none;
        color: var(--ct-ui-text, #ccc);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        text-align: left;
    }
    .assigned-row.active .assigned-name { color: #fff; }
    .assigned-name:hover { color: #fff; }
    .assigned-remove {
        display: flex;
        align-items: center;
        padding: 2px 3px;
        background: none;
        border: none;
        color: var(--ct-ui-text, #888);
        cursor: pointer;
        border-radius: 3px;
        opacity: 0;
    }
    .assigned-row:hover .assigned-remove { opacity: 1; }
    .assigned-remove:hover { color: #ff5f57; }
</style>
