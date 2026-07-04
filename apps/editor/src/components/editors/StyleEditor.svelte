<script lang="ts">
    /**
     * StyleEditor.svelte
     * Migrated from: editors/style-editor.tag (ct.js legacy)
     *
     * Edit a NyxStyle: font, fill (solid/gradient), stroke, drop-shadow,
     * alignment, and word-wrap. Live preview rendered via canvas-like CSS.
     */
    import { signals } from '../../stores/editorStore.js';
    import { updateAsset } from '../../stores/projectStore.js';
    import type { NyxStyle } from '@nyx/shared';
    import ColorPicker from '@nyx/ui-kit/ColorPicker.svelte';

    interface Props { asset: NyxStyle; }
    let { asset }: Props = $props();

    // ── Local state (mirrors asset fields) ───────────────────────────────────
    let fontFamily     = $state(asset.font.family);
    let fontSize       = $state(asset.font.size);
    let lineHeight     = $state(asset.font.lineHeight);
    let fontWeight     = $state(asset.font.weight);
    let fontItalic     = $state(asset.font.italic);

    let fillType       = $state(asset.fill.type);
    let fillColor      = $state(asset.fill.color);
    let gradColor0     = $state(asset.fill.gradientColors?.[0] ?? '#ffffff');
    let gradColor1     = $state(asset.fill.gradientColors?.[1] ?? '#000000');

    let strokeEnabled  = $state(asset.stroke.enabled);
    let strokeColor    = $state(asset.stroke.color);
    let strokeWidth    = $state(asset.stroke.width);
    let strokeJoin     = $state(asset.stroke.lineJoin);

    let shadowEnabled  = $state(asset.shadow.enabled);
    let shadowColor    = $state(asset.shadow.color);
    let shadowBlur     = $state(asset.shadow.blur);
    let shadowX        = $state(asset.shadow.x);
    let shadowY        = $state(asset.shadow.y);

    let halign         = $state(asset.halign);
    let valign         = $state(asset.valign);
    let wordWrap       = $state(asset.wordWrap);
    let wordWrapWidth  = $state(asset.wordWrapWidth);

    let previewText    = $state('Preview Text\nSecond line');
    let prevUid = asset.uid;

    // Reset only when a different asset is loaded into this slot
    $effect(() => {
        if (asset.uid === prevUid) return;
        prevUid = asset.uid;
        fontFamily    = asset.font.family;
        fontSize      = asset.font.size;
        lineHeight    = asset.font.lineHeight;
        fontWeight    = asset.font.weight;
        fontItalic    = asset.font.italic;
        fillType      = asset.fill.type;
        fillColor     = asset.fill.color;
        gradColor0    = asset.fill.gradientColors?.[0] ?? '#ffffff';
        gradColor1    = asset.fill.gradientColors?.[1] ?? '#000000';
        strokeEnabled = asset.stroke.enabled;
        strokeColor   = asset.stroke.color;
        strokeWidth   = asset.stroke.width;
        strokeJoin    = asset.stroke.lineJoin;
        shadowEnabled = asset.shadow.enabled;
        shadowColor   = asset.shadow.color;
        shadowBlur    = asset.shadow.blur;
        shadowX       = asset.shadow.x;
        shadowY       = asset.shadow.y;
        halign        = asset.halign;
        valign        = asset.valign;
        wordWrap      = asset.wordWrap;
        wordWrapWidth = asset.wordWrapWidth;
    });

    function persist() {
        updateAsset<NyxStyle>(asset.uid, 'style', {
            font: { family: fontFamily, size: fontSize, lineHeight, weight: fontWeight, italic: fontItalic },
            fill: fillType === 'solid'
                ? { type: 'solid', color: fillColor }
                : { type: 'linearGradient', color: gradColor0, gradientColors: [gradColor0, gradColor1] },
            stroke: { enabled: strokeEnabled, color: strokeColor, width: strokeWidth, lineJoin: strokeJoin },
            shadow: { enabled: shadowEnabled, color: shadowColor, blur: shadowBlur, x: shadowX, y: shadowY },
            halign, valign, wordWrap, wordWrapWidth
        });
        signals.emit('assetChanged');
    }

    // CSS preview style derived from current fields
    const previewStyle = $derived([
        `font-family: '${fontFamily}', sans-serif`,
        `font-size: ${fontSize}px`,
        `font-weight: ${fontWeight}`,
        `font-style: ${fontItalic ? 'italic' : 'normal'}`,
        `line-height: ${lineHeight}`,
        `text-align: ${halign}`,
        `color: ${fillType === 'solid' ? fillColor : gradColor0}`,
        shadowEnabled ? `text-shadow: ${shadowX}px ${shadowY}px ${shadowBlur}px ${shadowColor}` : '',
        wordWrap ? `word-break: break-word; max-width: ${wordWrapWidth}px; white-space: pre-wrap` : 'white-space: pre'
    ].filter(Boolean).join('; '));
</script>

<div class="style-editor">
    <!-- ── Left: properties ── -->
    <div class="props-col">
        <div class="prop-header">
            <h3 class="nm">{asset.name}</h3>
        </div>

        <div class="props-body">
            <!-- Font -->
            <fieldset>
                <legend>Font</legend>
                <div class="field-grid">
                    <span>Family</span>
                    <input type="text" bind:value={fontFamily} oninput={persist} placeholder="sans-serif" />
                    <span>Size (px)</span>
                    <input type="number" bind:value={fontSize} oninput={persist} min="4" max="256" />
                    <span>Line height</span>
                    <input type="number" bind:value={lineHeight} oninput={persist} min="0.5" max="4" step="0.05" />
                    <span>Weight</span>
                    <select bind:value={fontWeight} onchange={persist}>
                        {#each [100,200,300,400,500,600,700,800,900] as w}
                            <option value={w}>{w}</option>
                        {/each}
                    </select>
                    <span>Italic</span>
                    <label class="checkbox-wrap">
                        <input type="checkbox" bind:checked={fontItalic} onchange={persist} />
                        <span>Italic</span>
                    </label>
                </div>
            </fieldset>

            <!-- Fill -->
            <fieldset>
                <legend>Fill</legend>
                <div class="field-grid">
                    <span>Type</span>
                    <select bind:value={fillType} onchange={persist}>
                        <option value="solid">Solid</option>
                        <option value="linearGradient">Linear gradient</option>
                    </select>
                    {#if fillType === 'solid'}
                        <span>Color</span>
                        <ColorPicker value={fillColor} onchange={(c) => { fillColor = c; persist(); }} />
                    {:else}
                        <span>Color 1</span>
                        <ColorPicker value={gradColor0} onchange={(c) => { gradColor0 = c; persist(); }} />
                        <span>Color 2</span>
                        <ColorPicker value={gradColor1} onchange={(c) => { gradColor1 = c; persist(); }} />
                    {/if}
                </div>
            </fieldset>

            <!-- Stroke -->
            <fieldset>
                <legend>Stroke</legend>
                <div class="field-grid">
                    <span>Enabled</span>
                    <label class="checkbox-wrap">
                        <input type="checkbox" bind:checked={strokeEnabled} onchange={persist} />
                        <span>Stroke</span>
                    </label>
                    {#if strokeEnabled}
                        <span>Color</span>
                        <ColorPicker value={strokeColor} onchange={(c) => { strokeColor = c; persist(); }} />
                        <span>Width</span>
                        <input type="number" bind:value={strokeWidth} oninput={persist} min="0" max="32" />
                        <span>Join</span>
                        <select bind:value={strokeJoin} onchange={persist}>
                            <option value="round">Round</option>
                            <option value="bevel">Bevel</option>
                            <option value="miter">Miter</option>
                        </select>
                    {/if}
                </div>
            </fieldset>

            <!-- Shadow -->
            <fieldset>
                <legend>Drop shadow</legend>
                <div class="field-grid">
                    <span>Enabled</span>
                    <label class="checkbox-wrap">
                        <input type="checkbox" bind:checked={shadowEnabled} onchange={persist} />
                        <span>Shadow</span>
                    </label>
                    {#if shadowEnabled}
                        <span>Color</span>
                        <ColorPicker value={shadowColor} onchange={(c) => { shadowColor = c; persist(); }} />
                        <span>Blur</span>
                        <input type="number" bind:value={shadowBlur} oninput={persist} min="0" max="64" />
                        <span>Offset X</span>
                        <input type="number" bind:value={shadowX} oninput={persist} />
                        <span>Offset Y</span>
                        <input type="number" bind:value={shadowY} oninput={persist} />
                    {/if}
                </div>
            </fieldset>

            <!-- Alignment & word wrap -->
            <fieldset>
                <legend>Layout</legend>
                <div class="field-grid">
                    <span>H-align</span>
                    <select bind:value={halign} onchange={persist}>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                    </select>
                    <span>V-align</span>
                    <select bind:value={valign} onchange={persist}>
                        <option value="top">Top</option>
                        <option value="middle">Middle</option>
                        <option value="bottom">Bottom</option>
                    </select>
                    <span>Word wrap</span>
                    <label class="checkbox-wrap">
                        <input type="checkbox" bind:checked={wordWrap} onchange={persist} />
                        <span>Wrap</span>
                    </label>
                    {#if wordWrap}
                        <span>Wrap width</span>
                        <input type="number" bind:value={wordWrapWidth} oninput={persist} min="32" max="4096" />
                    {/if}
                </div>
            </fieldset>
        </div>

    </div>

    <!-- ── Right: preview ── -->
    <div class="preview-col">
        <div class="preview-label dim">Preview — {fontFamily}, {fontSize}px</div>
        <div class="preview-input-row">
            <textarea
                bind:value={previewText}
                class="preview-input"
                rows="2"
                spellcheck={false}
                placeholder="Enter preview text…"
            ></textarea>
        </div>
        <div class="preview-stage">
            <div class="preview-box" style={previewStyle}>{previewText}</div>
        </div>
    </div>
</div>

<style>
    .style-editor {
        display: flex;
        flex-flow: row nowrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .props-col {
        flex: 0 0 290px;
        overflow-y: auto;
        background: var(--background, #1a1a2e);
        border-right: 1px solid var(--border-bright, #333);
        display: flex;
        flex-direction: column;
    }

    .prop-header { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border-pale, #2a2a3e); }
    h3 { font-size: 0.9rem; margin: 0; }

    .props-body { flex: 1 1 auto; overflow-y: auto; padding: 0.75rem; }

    fieldset {
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 4px;
        padding: 0.5rem 0.75rem 0.75rem;
        margin-bottom: 0.6rem;
    }
    legend { font-size: 0.78rem; color: var(--text-dim, #888); padding: 0 0.25rem; }

    .field-grid {
        display: grid;
        grid-template-columns: 80px 1fr;
        gap: 0.3rem 0.5rem;
        align-items: center;
    }
    .field-grid span { font-size: 0.8rem; color: var(--text-dim, #888); }

    .checkbox-wrap {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.82rem;
        cursor: pointer;
        color: var(--text, #e0e0e0);
    }

    input[type="text"],
    input[type="number"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.4rem;
        font-size: 0.82rem;
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
        font-size: 0.82rem;
        width: 100%;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .footer { padding: 0.75rem; border-top: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }
    .wide { width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.35rem; }
    .nm   { margin: 0; }
    .dim  { color: var(--text-dim, #888); }

    /* Preview */
    .preview-col {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--background-deeper, #111122);
    }

    .preview-label { padding: 0.4rem 0.75rem; font-size: 0.75rem; border-bottom: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }

    .preview-input-row {
        padding: 0.4rem 0.75rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    .preview-input {
        width: 100%;
        box-sizing: border-box;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.3rem 0.5rem;
        font-size: 0.85rem;
        resize: none;
        font-family: monospace;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .preview-stage {
        flex: 1 1 auto;
        overflow: auto;
        padding: 2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #222;
    }

    .preview-box {
        max-width: 100%;
        overflow-wrap: break-word;
    }

    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.25rem 0.6rem;
        font-size: 0.82rem;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        transition: all 0.12s;
        &.success { background: var(--success, #27ae60); border-color: var(--success, #27ae60); color: #fff; font-weight: 600; }
        &.success:hover { background: #1e8449; }
        &:hover   { background: var(--act, #1e2233); border-color: var(--acttext, #7ec8e3); color: var(--acttext, #7ec8e3); }
        &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        :global(svg.feather) { width: 0.85rem; height: 0.85rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }
</style>
