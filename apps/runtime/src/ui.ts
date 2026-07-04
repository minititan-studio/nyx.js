import type * as pixiMod from 'pixi.js';
import type { NyxUIWidget, NyxUIProgressBar } from '@nyx/shared';
import { anchorBasePixels, validateUIHierarchy } from '@nyx/shared';
import mainCamera from './camera';
import type tweenLibType from './tween';
import type { EasingFunction } from './tween';

// Injected by index.ts after both modules are loaded — avoids circular imports.
let _tweenLib: typeof tweenLibType | null = null;
export function setTweenLib(lib: typeof tweenLibType): void {
    _tweenLib = lib;
}

declare var PIXI: typeof pixiMod;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns 0xRRGGBB integer (strips alpha byte if 8-char hex)
function hexColor(hex: string): number {
    return parseInt((hex.startsWith('#') ? hex.slice(1, 7) : hex.slice(0, 6)), 16);
}

// Returns 0-1 alpha from 8-char hex (#RRGGBBAA), or 1 for 6-char
function hexAlpha(hex: string): number {
    if (hex.length === 9) return parseInt(hex.slice(7, 9), 16) / 255;
    return 1;
}

// ── Runtime widget entry ──────────────────────────────────────────────────────

interface WidgetEntry {
    data:      NyxUIWidget;
    container: pixiMod.Container;
    textNode?: pixiMod.Text;
    fillNode?: pixiMod.Graphics;
}

// ── Fill helper for progressbar (called on init and setProgress) ──────────────

function redrawFill(g: pixiMod.Graphics, w: NyxUIProgressBar): void {
    g.clear();
    g.beginFill(hexColor(w.fillColor), hexAlpha(w.fillColor));
    if (w.direction === 'horizontal') {
        g.drawRoundedRect(0, 0, w.width * w.value, w.height, w.borderRadius);
    } else {
        const fh = w.height * w.value;
        g.drawRoundedRect(0, w.height - fh, w.width, fh, w.borderRadius);
    }
    g.endFill();
}

// ── Widget builder ────────────────────────────────────────────────────────────

/**
 * Build a single widget container.
 * @param refW  Reference width for anchor resolution (screen width for roots,
 *              parent.width for children).
 * @param refH  Reference height for anchor resolution.
 */
function buildEntry(w: NyxUIWidget, refW: number, refH: number): WidgetEntry {
    const { bx, by } = anchorBasePixels(w.anchor, refW, refH);
    const ctr = new PIXI.Container() as pixiMod.Container;
    // x/y is the widget's CENTER offset from the anchor point.
    // pivot at center so rotation is around the widget's own center.
    ctr.x        = bx + w.x;
    ctr.y        = by + w.y;
    ctr.pivot.set(w.width / 2, w.height / 2);
    ctr.rotation = (w.rotation ?? 0) * Math.PI / 180;
    ctr.alpha    = w.alpha;
    ctr.visible  = w.visible;

    const entry: WidgetEntry = { data: w, container: ctr };

    switch (w.type) {
        case 'panel': {
            const g = new PIXI.Graphics();
            if (w.borderWidth > 0) g.lineStyle(w.borderWidth, hexColor(w.borderColor), hexAlpha(w.borderColor));
            g.beginFill(hexColor(w.backgroundColor), hexAlpha(w.backgroundColor));
            g.drawRoundedRect(0, 0, w.width, w.height, w.borderRadius);
            g.endFill();
            ctr.addChild(g);
            break;
        }
        case 'label': {
            const t = new PIXI.Text(w.text, {
                fontSize:   w.fontSize,
                fill:       w.color,
                fontFamily: w.fontFamily || 'sans-serif',
                fontWeight: w.bold   ? 'bold'   : 'normal',
                fontStyle:  w.italic ? 'italic' : 'normal',
                align:      w.align,
            } as pixiMod.TextStyle);
            ctr.addChild(t);
            entry.textNode = t;
            break;
        }
        case 'button': {
            const g = new PIXI.Graphics();
            g.beginFill(hexColor(w.backgroundColor), hexAlpha(w.backgroundColor));
            g.drawRoundedRect(0, 0, w.width, w.height, w.borderRadius);
            g.endFill();
            const t = new PIXI.Text(w.text, {
                fontSize:   w.fontSize,
                fill:       w.textColor,
                fontFamily: w.fontFamily || 'sans-serif',
                fontWeight: 'bold',
            } as pixiMod.TextStyle);
            t.anchor.set(0.5, 0.5);
            t.x = w.width  / 2;
            t.y = w.height / 2;
            ctr.addChild(g);
            ctr.addChild(t);
            ctr.eventMode = 'static' as unknown as pixiMod.EventMode;
            ctr.cursor    = 'pointer';
            const hoverColor  = hexColor(w.hoverColor);
            const normalColor = hexColor(w.backgroundColor);
            ctr.on('pointerover',  () => { g.tint = hoverColor; });
            ctr.on('pointerout',   () => { g.tint = normalColor; });
            entry.textNode = t;
            break;
        }
        case 'image': {
            try {
                const sprite = w.textureUid
                    ? PIXI.Sprite.from(w.textureUid)
                    : null;
                if (sprite && sprite.texture.valid) {
                    // Atlas frames carry the gameplay defaultAnchor (e.g. 0.5,0.5).
                    // UI widgets position via the container pivot — sprite always starts at (0,0).
                    sprite.anchor.set(0, 0);
                    sprite.tint = hexColor(w.tint);
                    if (w.keepAspect) {
                        const scale = Math.min(
                            w.width  / sprite.texture.width,
                            w.height / sprite.texture.height
                        );
                        sprite.scale.set(scale);
                    } else {
                        sprite.width  = w.width;
                        sprite.height = w.height;
                    }
                    ctr.addChild(sprite);
                } else {
                    ctr.addChild(placeholder(w.width, w.height));
                }
            } catch {
                ctr.addChild(placeholder(w.width, w.height));
            }
            break;
        }
        case 'progressbar': {
            const bg = new PIXI.Graphics();
            bg.beginFill(hexColor(w.backgroundColor), hexAlpha(w.backgroundColor));
            bg.drawRoundedRect(0, 0, w.width, w.height, w.borderRadius);
            bg.endFill();
            const fill = new PIXI.Graphics();
            redrawFill(fill, w);
            ctr.addChild(bg);
            ctr.addChild(fill);
            entry.fillNode = fill;
            break;
        }
    }

    // Drop shadow — draws a blurred shape behind the widget content
    if (w.shadow?.enabled) {
        const s = w.shadow;
        const sg = new PIXI.Graphics();
        const shadowColor = hexColor(s.color);
        const shadowAlpha = hexAlpha(s.color);
        const radius = 'borderRadius' in w ? (w as { borderRadius: number }).borderRadius : 0;
        sg.beginFill(shadowColor, shadowAlpha);
        if (radius > 0) {
            sg.drawRoundedRect(0, 0, w.width, w.height, radius);
        } else {
            sg.drawRect(0, 0, w.width, w.height);
        }
        sg.endFill();
        sg.x = s.offsetX;
        sg.y = s.offsetY;
        if (s.blur > 0) {
            sg.filters = [new PIXI.filters.BlurFilter(s.blur * 0.5)];
        }
        ctr.addChildAt(sg, 0);
    }

    return entry;
}

function placeholder(w: number, h: number): pixiMod.Graphics {
    const g = new PIXI.Graphics();
    g.lineStyle(1, 0xaaaaaa, 0.5);
    g.beginFill(0x333333, 0.4);
    g.drawRect(0, 0, w, h);
    g.endFill();
    return g;
}

// ── UiLayerManager singleton ──────────────────────────────────────────────────

type UIEventType = 'click' | 'pointerdown' | 'pointerup' | 'pointerover' | 'pointerout';
// pixi event name → UIEventType
const PIXI_EVENT_MAP: Record<UIEventType, string> = {
    click:      'pointertap',
    pointerdown:'pointerdown',
    pointerup:  'pointerup',
    pointerover:'pointerover',
    pointerout: 'pointerout',
};

let _layer: pixiMod.Container | null = null;
const _widgets = new Map<string, WidgetEntry>(); // keyed by widget name
// event handlers registered by room scripts — cleared on mount()
const _handlers = new Map<string, Partial<Record<UIEventType, () => void>>>();
// Maps layerUid → Set of widget names that were mounted as part of that layer
const _layerMembership = new Map<string, Set<string>>();

// UILayer script instances active in the current room — keyed by layer name
interface UILayerInstance { onMount?(): void; onStep?(): void; onUnmount?(): void; }
const _scriptInstances: UILayerInstance[] = [];

function getUILayerRegistry(): Record<string, new () => UILayerInstance> {
    return ((window as Record<string, unknown>)['uiLayerRegistry'] as Record<string, new () => UILayerInstance>) ?? {};
}

function getLayer(): pixiMod.Container {
    if (!_layer) {
        _layer = new PIXI.Container();
        (_layer as pixiMod.Container & { isUi: boolean }).isUi = true;
    }
    return _layer;
}

const uiModule = {
    /** The screen-space PIXI container. Add this to the stage above all rooms. */
    get layer(): pixiMod.Container { return getLayer(); },

    /**
     * Build and display all widgets for the given room data.
     * Wires parent-child hierarchy; child anchors are relative to parent dimensions.
     * Call after mainCamera.reset() so camera dimensions are correct.
     */
    mount(widgets: NyxUIWidget[], layerNames?: string[]): void {
        const layer = getLayer();
        layer.removeChildren();
        _widgets.clear();
        _handlers.clear();

        const W = mainCamera.width;
        const H = mainCamera.height;

        const { parentMap, diagnostics } = validateUIHierarchy(widgets);

        // Emit one warning per validation diagnostic
        for (const d of diagnostics) {
            console.warn(`[ui] ${d.type}: widget "${d.widgetName}" (${d.widgetUid})${d.detail ? ' — ' + d.detail : ''}`);
        }

        // Build all widget entries with correct reference dimensions
        const entryByUid = new Map<string, WidgetEntry>();
        for (const w of widgets) {
            const parentUid = parentMap.get(w.uid);
            const parent = parentUid !== undefined
                ? widgets.find(pw => pw.uid === parentUid)
                : undefined;
            const refW = parent?.width  ?? W;
            const refH = parent?.height ?? H;
            const entry = buildEntry(w, refW, refH);
            entryByUid.set(w.uid, entry);
            _widgets.set(w.name, entry);
        }

        // Wire parent-child hierarchy; root widgets go to the layer
        for (const w of widgets) {
            const entry = entryByUid.get(w.uid)!;
            if (parentMap.has(w.uid)) {
                const parentEntry = entryByUid.get(parentMap.get(w.uid)!);
                if (parentEntry) {
                    parentEntry.container.addChild(entry.container);
                    continue;
                }
            }
            layer.addChild(entry.container);
        }

        // Instantiate UILayer script classes for this mount
        _scriptInstances.length = 0;
        if (layerNames?.length) {
            const reg = getUILayerRegistry();
            for (const name of layerNames) {
                const Cls = reg[name];
                if (Cls) {
                    const inst = new Cls();
                    _scriptInstances.push(inst);
                    inst.onMount?.();
                }
            }
        }
    },

    /**
     * Reposition root-level widgets using current mainCamera dimensions.
     * Child widgets follow their parents automatically via PIXI hierarchy.
     * Called by fittoscreen.updateViewport() on every viewport change.
     */
    resize(): void {
        const W = mainCamera.width;
        const H = mainCamera.height;
        for (const entry of _widgets.values()) {
            if (entry.data.parentUid) continue; // children follow parents
            const { bx, by } = anchorBasePixels(entry.data.anchor, W, H);
            entry.container.x = bx + entry.data.x;
            entry.container.y = by + entry.data.y;
        }
    },

    /** Remove all widgets (called on room clear). */
    clear(): void {
        for (const inst of _scriptInstances) inst.onUnmount?.();
        _scriptInstances.length = 0;
        getLayer().removeChildren();
        _widgets.clear();
        _handlers.clear();
        _layerMembership.clear();
    },

    /** Called every frame by the game loop — runs onStep() on all active UILayer scripts. */
    stepScripts(): void {
        for (const inst of _scriptInstances) inst.onStep?.();
    },

    /**
     * Mount a named layer's widgets additively — does not clear existing widgets.
     * Child anchors are relative to parent dimensions.
     */
    mountLayer(layerUid: string, widgets: NyxUIWidget[]): void {
        const W = mainCamera.width;
        const H = mainCamera.height;
        const layer = getLayer();
        const { parentMap, diagnostics } = validateUIHierarchy(widgets);

        for (const d of diagnostics) {
            console.warn(`[ui] ${d.type}: widget "${d.widgetName}" (${d.widgetUid})${d.detail ? ' — ' + d.detail : ''}`);
        }

        const entryByUid = new Map<string, WidgetEntry>();
        const names = new Set<string>();

        for (const w of widgets) {
            const parentUid = parentMap.get(w.uid);
            const parent = parentUid !== undefined ? widgets.find(pw => pw.uid === parentUid) : undefined;
            const refW = parent?.width  ?? W;
            const refH = parent?.height ?? H;
            const entry = buildEntry(w, refW, refH);
            entryByUid.set(w.uid, entry);
            _widgets.set(w.name, entry);
            names.add(w.name);
        }

        for (const w of widgets) {
            const entry = entryByUid.get(w.uid)!;
            if (parentMap.has(w.uid)) {
                const parentEntry = entryByUid.get(parentMap.get(w.uid)!);
                if (parentEntry) { parentEntry.container.addChild(entry.container); continue; }
            }
            layer.addChild(entry.container);
        }

        _layerMembership.set(layerUid, names);
    },

    /**
     * Remove all widgets that were mounted as part of a given named layer.
     */
    unmountLayer(layerUid: string): void {
        const names = _layerMembership.get(layerUid);
        if (!names) return;
        for (const name of names) {
            const entry = _widgets.get(name);
            if (entry) {
                entry.container.parent?.removeChild(entry.container);
                _widgets.delete(name);
            }
        }
        _handlers.forEach((_, n) => { if (names.has(n)) _handlers.delete(n); });
        _layerMembership.delete(layerUid);
    },

    // ── Script-accessible API ─────────────────────────────────────────────────

    get(name: string): {
        readonly visible:   boolean;
        readonly alpha:     number;
        readonly x:         number;
        readonly y:         number;
        readonly rotation:  number;  // degrees
        readonly scale:     number;  // uniform (reads scale.x)
        readonly value?:    number;  // 0–1 for progressbar; undefined otherwise
    } | undefined {
        const e = _widgets.get(name);
        if (!e) return undefined;
        const c = e.container;
        return {
            get visible()  { return c.visible; },
            get alpha()    { return c.alpha; },
            get x()        { return c.x; },
            get y()        { return c.y; },
            get rotation() { return c.rotation * 180 / Math.PI; },
            get scale()    { return c.scale.x; },
            get value()    { return e.data.type === 'progressbar' ? (e.data as NyxUIProgressBar).value : undefined; },
        };
    },

    /**
     * Immediately sets one or more visual properties on a named widget.
     * `rotation` is in degrees. `scale` is uniform.
     */
    set(name: string, props: Partial<{
        alpha:    number;
        x:        number;
        y:        number;
        rotation: number;
        scale:    number;
        visible:  boolean;
    }>): void {
        const e = _widgets.get(name);
        if (!e) return;
        const c = e.container;
        if (props.alpha    !== undefined) c.alpha        = props.alpha;
        if (props.x        !== undefined) c.x            = props.x;
        if (props.y        !== undefined) c.y            = props.y;
        if (props.rotation !== undefined) c.rotation     = props.rotation * Math.PI / 180;
        if (props.scale    !== undefined) c.scale.set(props.scale);
        if (props.visible  !== undefined) c.visible      = props.visible;
    },

    setText(name: string, text: string): void {
        const e = _widgets.get(name);
        if (e?.textNode) e.textNode.text = text;
    },

    setProgress(name: string, value: number): void {
        const e = _widgets.get(name);
        if (!e || e.data.type !== 'progressbar') return;
        const clamped = Math.max(0, Math.min(1, value));
        (e.data as NyxUIProgressBar).value = clamped;
        if (e.fillNode) redrawFill(e.fillNode, e.data as NyxUIProgressBar);
    },

    /**
     * Smoothly tween a progressbar's fill value from its current value to `target`.
     * Uses the same tween system as `ui.animate` — respects UI time scale (survives pause).
     */
    animateProgress(name: string, target: number, duration = 300, curve?: EasingFunction): Promise<void> {
        const e = _widgets.get(name);
        if (!e || e.data.type !== 'progressbar' || !_tweenLib) return Promise.resolve();
        const lib  = _tweenLib;
        const w    = e.data as NyxUIProgressBar;
        const fill = e.fillNode;
        if (!fill) return Promise.resolve();
        const clamped = Math.max(0, Math.min(1, target));
        // Proxy whose `value` setter redraws the fill graphics each tween tick
        const proxy: Record<string, unknown> = {};
        Object.defineProperty(proxy, 'value', {
            get: () => w.value,
            set: (v: number) => { w.value = v; redrawFill(fill, w); },
            enumerable: true, configurable: true,
        });
        return lib.add({
            obj: proxy, fields: { value: clamped },
            duration, curve: curve ?? lib.easeOut, isUi: true, silent: true,
        });
    },

    show(name: string): void {
        const e = _widgets.get(name);
        if (e) e.container.visible = true;
    },

    hide(name: string): void {
        const e = _widgets.get(name);
        if (e) e.container.visible = false;
    },

    on(name: string, event: UIEventType, handler: () => void): void {
        const e = _widgets.get(name);
        if (!e) return;
        // Store handler (one per event per widget — last wins)
        let map = _handlers.get(name);
        if (!map) { map = {}; _handlers.set(name, map); }
        map[event] = handler;
        // Make container interactive and attach PIXI listener
        e.container.eventMode = 'static' as unknown as pixiMod.EventMode;
        e.container.cursor    = 'pointer';
        e.container.on(PIXI_EVENT_MAP[event], handler);
    },

    onButtonClick(name: string, handler: () => void): void {
        this.on(name, 'click', handler);
    },

    // ── Animation API ─────────────────────────────────────────────────────────

    /**
     * Animate one or more PIXI container properties of a widget.
     * Animatable: `alpha`, `x`, `y`, `rotation` (degrees), `scale` (uniform).
     * Returns a Promise that resolves when the animation finishes.
     * Defaults to UI time scale so animations survive game pause.
     */
    animate(
        name:     string,
        props:    Partial<{ alpha: number; x: number; y: number; rotation: number; scale: number }>,
        duration = 300,
        curve?:   EasingFunction,
        isUi   = true,
    ): Promise<void> {
        const e = _widgets.get(name);
        if (!e || !_tweenLib) return Promise.resolve();
        const lib    = _tweenLib;
        const c      = e.container;
        const useCurve = curve ?? lib.easeOut;
        const promises: Promise<void>[] = [];

        // Flat numeric container properties — tween.add can write directly.
        const flatFields: Record<string, number> = {};
        if (props.alpha    !== undefined) flatFields.alpha    = props.alpha;
        if (props.x        !== undefined) flatFields.x        = props.x;
        if (props.y        !== undefined) flatFields.y        = props.y;
        if (props.rotation !== undefined) flatFields.rotation = props.rotation * Math.PI / 180;

        if (Object.keys(flatFields).length > 0) {
            promises.push(lib.add({
                obj:      c as unknown as Record<string, unknown>,
                fields:   flatFields,
                duration, curve: useCurve, isUi, silent: true,
            }));
        }

        // scale is an ObservablePoint — proxy it to a plain numeric property.
        if (props.scale !== undefined) {
            const scaleProxy = {} as Record<string, unknown>;
            Object.defineProperty(scaleProxy, 'scale', {
                get: () => c.scale.x,
                set: (v: number) => { c.scale.set(v); },
                enumerable: true, configurable: true,
            });
            promises.push(lib.add({
                obj:      scaleProxy,
                fields:   { scale: props.scale },
                duration, curve: useCurve, isUi, silent: true,
            }));
        }

        return Promise.all(promises).then(() => void 0);
    },

    /** Fade a widget in: sets alpha=0, shows it, then animates alpha to 1. */
    fadeIn(name: string, duration = 300, curve?: EasingFunction): Promise<void> {
        const e = _widgets.get(name);
        if (!e) return Promise.resolve();
        e.container.alpha   = 0;
        e.container.visible = true;
        return this.animate(name, { alpha: 1 }, duration, curve ?? _tweenLib?.easeOut);
    },

    /** Fade a widget out: animates alpha to 0, then hides it. */
    fadeOut(name: string, duration = 300, curve?: EasingFunction): Promise<void> {
        const e = _widgets.get(name);
        if (!e) return Promise.resolve();
        return this.animate(name, { alpha: 0 }, duration, curve ?? _tweenLib?.easeIn)
            .then(() => { e.container.visible = false; });
    },

    /** Open a panel with a springy scale+fade-in animation. */
    open(name: string, duration = 300): Promise<void> {
        const e = _widgets.get(name);
        if (!e) return Promise.resolve();
        e.container.alpha = 0;
        e.container.scale.set(0.85);
        e.container.visible = true;
        return this.animate(name, { alpha: 1, scale: 1 }, duration, _tweenLib?.easeOutBack);
    },

    /** Close a panel with a scale+fade-out animation, then hide and reset it. */
    close(name: string, duration = 300): Promise<void> {
        const e = _widgets.get(name);
        if (!e) return Promise.resolve();
        return this.animate(name, { alpha: 0, scale: 0.85 }, duration, _tweenLib?.easeIn)
            .then(() => {
                e.container.visible = false;
                e.container.scale.set(1);
                e.container.alpha = 1;
            });
    },
};

export default uiModule;
