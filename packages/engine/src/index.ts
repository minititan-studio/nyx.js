/**
 * @nyx/engine — Nyx Game Engine base classes and runtime API types.
 *
 * Import from this package in your game scripts:
 *
 *   import { Template, Behavior, Room, actions, rooms, sounds, u } from '@nyx/engine';
 *
 *   export class Player extends Template {
 *     speed = 5;
 *     onCreate() { this.x = 100; }
 *     onStep()   { if (actions.isPressed('MoveRight')) this.x += this.speed; }
 *   }
 */

// ── Project-aware asset name types ───────────────────────────────────────────
// These are declared as `string` here so the engine compiles standalone.
// The editor injects a generated `nyx-project-types.d.ts` via Monaco's
// addExtraLib which re-declares these as string literal unions from the
// loaded project's asset names.
export type RoomName     = string;
export type TemplateName = string;
export type ActionName   = string;
export type TextureName  = string;
export type SoundName    = string;
export type UILayerName  = string;
export type WidgetName   = string;

// ── Runtime API types ─────────────────────────────────────────────────────────

export interface SoundOptions {
    volume?: number;
    pitch?:  number;
    loop?:   boolean;
    /** Spatial audio: position in world space */
    x?: number;
    y?: number;
}

export interface ActionsAPI {
    /** True while the action input is held down. */
    isDown(name: ActionName): boolean;
    /** True on the first frame the action was pressed. */
    isPressed(name: ActionName): boolean;
    /** True on the first frame the action was released. */
    isReleased(name: ActionName): boolean;
    /** Analog value of the action (-1 to 1 for axes, 0 or 1 for buttons). */
    value(name: ActionName): number;
}

export interface RoomsAPI {
    /** Navigate to a different room by name. */
    go(name: RoomName): void;
    /** Append a room's contents on top of the current room. */
    append(name: RoomName, params?: Record<string, unknown>): void;
    /** Remove a previously appended room. */
    remove(name: RoomName): void;
    /** The currently active room instance. Undefined before the first room loads. */
    readonly current: Room | undefined;
    /** Names of all defined rooms in the project. */
    readonly list: RoomName[];
}

export interface TemplatesAPI {
    /** Create a copy of a template in the current room. */
    copy(template: TemplateName, x?: number, y?: number, params?: Record<string, unknown>): Template;
    /** Create a copy of a template inside a specific room. */
    copyIntoRoom(template: TemplateName, room: Room, x?: number, y?: number, params?: Record<string, unknown>): Template;
    /** Apply a function to every copy in the current room. */
    each(func: (copy: Template) => void): void;
    /** Apply a function to every copy of a given template. */
    withTemplate(template: TemplateName, func: (this: Template) => void): void;
    /** True if at least one copy of this template exists in the room. */
    exists(template: TemplateName): boolean;
    /** Type guard — true if `obj` is a live copy. */
    isCopy(obj: unknown): obj is Template;
    /** True if a copy has not been killed. */
    valid(obj: unknown): boolean;
    /** All live copies, keyed by template name. */
    readonly list: Record<string, Template[]>;
}

export interface TexturesAPI {
    /** Get a loaded texture by name. Returns a PIXI.Texture at runtime. */
    get(name: TextureName): unknown;
}

export interface UIWidgetHandle {
    readonly visible:   boolean;
    readonly alpha:     number;
    readonly x:         number;
    readonly y:         number;
    readonly rotation:  number;  // degrees
    readonly scale:     number;  // uniform (reads scale.x)
    /** Fill value (0–1) for progressbar widgets; undefined for all other types. */
    readonly value?:    number | undefined;
}

export type UIEventType = 'click' | 'pointerdown' | 'pointerup' | 'pointerover' | 'pointerout';

/** Easing function: progress t ∈ [0,1] → eased value. */
export type UIEasingFunction = (t: number) => number;

export interface UIApi {
    /** Get a read-only widget handle by its name. Returns undefined if not found. */
    get(name: WidgetName): UIWidgetHandle | undefined;
    /** Immediately set one or more visual properties. `rotation` in degrees, `scale` uniform. */
    set(name: WidgetName, props: Partial<{ alpha: number; x: number; y: number; rotation: number; scale: number; visible: boolean }>): void;
    /** Update the text content of a label or button widget. */
    setText(name: WidgetName, text: string): void;
    /** Set a progressbar fill value (0.0 – 1.0). */
    setProgress(name: WidgetName, value: number): void;
    /**
     * Smoothly tween a progressbar's fill from its current value to `target`.
     * Returns a Promise that resolves when the tween completes.
     * Uses UI time scale — survives game pause.
     */
    animateProgress(name: WidgetName, target: number, duration?: number, curve?: UIEasingFunction): Promise<void>;
    /** Make a widget visible. */
    show(name: WidgetName): void;
    /** Hide a widget. */
    hide(name: WidgetName): void;
    /**
     * Animate one or more visual properties over time. Returns a Promise that
     * resolves when the animation completes. Uses UI time scale by default.
     */
    animate(name: WidgetName, props: Partial<{ alpha: number; x: number; y: number; rotation: number; scale: number }>, duration?: number, curve?: UIEasingFunction, isUi?: boolean): Promise<void>;
    /** Fade a widget in: sets alpha=0, shows it, then animates alpha to 1. */
    fadeIn(name: WidgetName, duration?: number, curve?: UIEasingFunction): Promise<void>;
    /** Fade a widget out: animates alpha to 0, then hides it. */
    fadeOut(name: WidgetName, duration?: number, curve?: UIEasingFunction): Promise<void>;
    /** Open a panel with a springy scale+fade-in animation. */
    open(name: WidgetName, duration?: number): Promise<void>;
    /** Close a panel with a scale+fade-out animation, then hide and reset it. */
    close(name: WidgetName, duration?: number): Promise<void>;
    /**
     * Register a pointer event handler on any widget.
     * Handlers are cleared when the room switches.
     */
    on(name: WidgetName, event: UIEventType, handler: () => void): void;
    /** Shorthand for `ui.on(name, 'click', handler)`. */
    onButtonClick(name: WidgetName, handler: () => void): void;
    /**
     * Mount a named layer's widgets additively (does not clear existing widgets).
     * Use `unmountLayer` to remove them later.
     */
    mountLayer(layerUid: string, widgets: import('@nyx/shared').NyxUIWidget[]): void;
    /** Remove all widgets that were mounted as part of a given named layer. */
    unmountLayer(layerUid: string): void;
}

export interface SoundsAPI {
    /** Play a sound by name. Returns a handle to control playback. */
    play(name: SoundName, options?: SoundOptions): unknown;
    /** Stop all instances of a sound. */
    stop(name: SoundName): void;
    /** Stop all sounds. */
    stopAll(): void;
    /** Get or set the volume of a sound (0–1). Returns the current volume. */
    volume(name: SoundName, volume?: number): number;
}

export interface UtilsAPI {
    /** Euclidean distance between two points. */
    distance(x1: number, y1: number, x2: number, y2: number): number;
    /** Angle in degrees from point 1 to point 2 (0 = right, clockwise). */
    direction(x1: number, y1: number, x2: number, y2: number): number;
    /** Move a point by a given distance in a given direction (degrees). */
    rotate(x: number, y: number, angle: number): { x: number; y: number };
    /** Rotate a point around a center. */
    rotatePoint(x: number, y: number, cx: number, cy: number, angle: number): { x: number; y: number };
    /** Clamp val to [min, max]. */
    clamp(val: number, min: number, max: number): number;
    /** Random float in [from, to]. */
    random(from: number, to: number): number;
    /** Random integer in [from, to] inclusive. */
    randomInt(from: number, to: number): number;
    /** Convert degrees to radians. */
    toRad(degrees: number): number;
    /** Convert radians to degrees. */
    toDeg(radians: number): number;
    /** Linear interpolation between a and b by t (0–1). */
    lerp(a: number, b: number, t: number): number;
    /** Seconds elapsed since the last frame (framerate-independent). */
    readonly deltaTime: number;
    /** Same as deltaTime but not affected by game speed scaling. */
    readonly deltaTimeUi: number;
    /** Fixed timestep in seconds (1 / fixedFps). Always constant — unaffected by frame rate. */
    readonly fixedTime: number;
}

// ── Runtime API — delegates to Nyx globals when running in-game ──────────────
//
// When bundled into scripts.js via esbuild and loaded into a Nyx game, these
// objects forward to the Nyx runtime globals (actions, rooms, sounds, u).
// In the editor (outside a game context) they return safe no-op values.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = () => (globalThis as any);

export const actions: ActionsAPI = {
    // Nyx actions namespace: actions['Name'] = { down, pressed, released, value }
    isDown:    (name) => g().actions?.[name]?.down     === true,
    isPressed: (name) => g().actions?.[name]?.pressed  === true,
    isReleased:(name) => g().actions?.[name]?.released === true,
    value:     (name) => Number(g().actions?.[name]?.value ?? 0),
};


export const templates: TemplatesAPI = {
    copy:         (template, x = 0, y = 0, params = {}) => g().templates?.copy?.(template, x, y, params),
    copyIntoRoom: (template, room, x = 0, y = 0, params = {}) => g().templates?.copyIntoRoom?.(template, room, x, y, params),
    each:         (func)           => g().templates?.each?.(func),
    withTemplate: (template, func) => g().templates?.withTemplate?.(template, func),
    exists:       (template)       => Boolean(g().templates?.exists?.(template)),
    isCopy:       (obj): obj is Template => Boolean(g().templates?.isCopy?.(obj)),
    valid:        (obj)            => Boolean(g().templates?.valid?.(obj)),
    get list(): Record<string, Template[]> { return g().templates?.list ?? {}; },
};

export const rooms: RoomsAPI = {
    // Nyx room API: rooms.switch(name), rooms.append(name), rooms.remove(name)
    go:    (name)          => g().rooms?.switch?.(name),
    append:(name, params)  => g().rooms?.append?.(name, params),
    remove:(name)          => g().rooms?.remove?.(name),
    get current(): Room | undefined { return g().rooms?.current as Room | undefined; },
    get list():    RoomName[] { return g().rooms?.list ?? []; },
};

export const textures: TexturesAPI = {
    // Nyx: res.getTexture(name) or PIXI.Assets.get(name)
    get: (name) => g().res?.getTexture?.(name) ?? g().PIXI?.Assets?.get?.(name),
};

export const sounds: SoundsAPI = {
    // Nyx sounds API
    play:    (name, opts)  => g().sounds?.play?.(name, opts),
    stop:    (name)        => g().sounds?.stop?.(name),
    stopAll: ()            => g().sounds?.stopAll?.(),
    volume:  (name, vol)   => {
        if (vol !== undefined) g().sounds?.volume?.(name, vol);
        return Number(g().sounds?.volume?.(name) ?? 0);
    },
};

export const ui: UIApi = {
    get:           (name)                         => g().ui?.get?.(name),
    set:           (name, props)                  => g().ui?.set?.(name, props),
    setText:       (name, text)                   => g().ui?.setText?.(name, text),
    setProgress:      (name, value)                => g().ui?.setProgress?.(name, value),
    animateProgress:  (name, target, dur, curve)  => g().ui?.animateProgress?.(name, target, dur, curve) ?? Promise.resolve(),
    show:          (name)                         => g().ui?.show?.(name),
    hide:          (name)                         => g().ui?.hide?.(name),
    animate:       (name, props, dur, curve, isUi) => g().ui?.animate?.(name, props, dur, curve, isUi) ?? Promise.resolve(),
    fadeIn:        (name, dur, curve)             => g().ui?.fadeIn?.(name, dur, curve) ?? Promise.resolve(),
    fadeOut:       (name, dur, curve)             => g().ui?.fadeOut?.(name, dur, curve) ?? Promise.resolve(),
    open:          (name, dur)                    => g().ui?.open?.(name, dur) ?? Promise.resolve(),
    close:         (name, dur)                    => g().ui?.close?.(name, dur) ?? Promise.resolve(),
    on:            (name, ev, fn)                 => g().ui?.on?.(name, ev, fn),
    onButtonClick: (name, fn)                     => g().ui?.onButtonClick?.(name, fn),
    mountLayer:    (uid, widgets)                 => g().ui?.mountLayer?.(uid, widgets),
    unmountLayer:  (uid)                          => g().ui?.unmountLayer?.(uid),
};

export const u: UtilsAPI = {
    // Delegate to Nyx u.* where available, with pure-JS fallbacks
    distance:    (x1, y1, x2, y2) => g().u?.distance?.(x1,y1,x2,y2) ?? Math.hypot(x2-x1, y2-y1),
    direction:   (x1, y1, x2, y2) => g().u?.direction?.(x1,y1,x2,y2) ?? (Math.atan2(y2-y1, x2-x1)*180/Math.PI),
    rotate:      (x, y, angle)    => g().u?.rotate?.(x,y,angle) ?? (
                                         (r => ({ x: x*Math.cos(r)-y*Math.sin(r), y: x*Math.sin(r)+y*Math.cos(r) }))
                                         (angle*Math.PI/180)
                                     ),
    rotatePoint: (x, y, cx, cy, angle) => {
        const r  = angle * Math.PI / 180;
        const dx = x - cx, dy = y - cy;
        return { x: cx + dx*Math.cos(r) - dy*Math.sin(r), y: cy + dx*Math.sin(r) + dy*Math.cos(r) };
    },
    clamp:    (val, min, max) => Math.min(Math.max(val, min), max),
    random:   (from, to)     => from + Math.random() * (to - from),
    randomInt:(from, to)     => Math.floor(from + Math.random() * (to - from + 1)),
    toRad:    (deg)          => deg * Math.PI / 180,
    toDeg:    (rad)          => rad * 180 / Math.PI,
    lerp:     (a, b, t)      => a + (b - a) * t,
    // Nyx: u.delta (physics delta), u.deltaUi (UI delta, unscaled)
    get deltaTime()   { return Number(g().u?.delta   ?? 1); },
    get deltaTimeUi() { return Number(g().u?.deltaUi ?? 1); },
    get fixedTime() { return Number(g().u?.fixedTime ?? (1 / 50)); },
};

/**
 * Optional: call this from a custom runtime to inject real
 * implementations. When using Nyx as the runtime, this is not needed —
 * the api objects above delegate to Nyx globals automatically.
 */
export function _registerRuntime(impl: {
    actions?:  Partial<ActionsAPI>;
    rooms?:    Partial<RoomsAPI>;
    textures?: Partial<TexturesAPI>;
    sounds?:   Partial<SoundsAPI>;
    ui?:       Partial<UIApi>;
    u?:        Partial<UtilsAPI>;
}): void {
    if (impl.actions)  Object.assign(actions,  impl.actions);
    if (impl.rooms)    Object.assign(rooms,    impl.rooms);
    if (impl.textures) Object.assign(textures, impl.textures);
    if (impl.sounds)   Object.assign(sounds,   impl.sounds);
    if (impl.ui)       Object.assign(ui,       impl.ui);
    if (impl.u)        Object.assign(u,        impl.u);
}

// ── Template base class ───────────────────────────────────────────────────────

export abstract class Template {
    // ── Position & transform ──────────────────────────────────────────────────
    x:      number = 0;
    y:      number = 0;
    depth:  number = 0;
    angle:  number = 0;
    scaleX: number = 1;
    scaleY: number = 1;
    alpha:  number = 1;

    // ── Movement ──────────────────────────────────────────────────────────────
    /** Pixels per second along `direction`. */
    speed:     number = 0;
    /** Direction of movement in degrees (0 = right, clockwise). */
    direction: number = 0;
    /** Horizontal speed component (pixels/s). */
    hspeed:    number = 0;
    /** Vertical speed component (pixels/s). */
    vspeed:    number = 0;
    /** Gravitational acceleration (pixels/s²). Adds to vspeed each frame. */
    gravity:    number = 0;
    /** Direction of gravity in degrees (270 = down). */
    gravityDir: number = 270;
    /** Friction applied to speed each frame (0–1 multiplier). */
    friction:   number = 0;

    // ── Identity ──────────────────────────────────────────────────────────────
    /** Unique instance ID assigned by the runtime. */
    readonly uid: string = '';
    /** Name of the template class this copy was created from. */
    readonly templateName: string = '';
    /** Active texture name. */
    texture: string = '';
    /** Set to true to remove this copy at the end of the current frame. */
    kill: boolean = false;
    /**
     * Whether this copy is active. When false, onStep/onFixedStep/onDraw do not fire.
     * Setting to false fires onDisable(); setting back to true fires onEnable().
     */
    active: boolean = true;

    // ── Collision bounds (runtime-populated from texture collision mask) ───────
    /**
     * Bounding offsets relative to the copy's pivot point, in pixels.
     * Populated by the runtime; equivalent to Nyx's `this.shape`.
     * Use these in collision events:
     *   const myBottom = this.y + this.shape.bottom;
     *   const otherTop = other.y + other.shape.top;
     */
    shape: { top: number; bottom: number; left: number; right: number } = { top: 0, bottom: 0, left: 0, right: 0 };

    // ── Internal timer state ──────────────────────────────────────────────────
    /** @internal — managed by startTimer/stopTimer */
    _timer1: number = 0; _timer2: number = 0; _timer3: number = 0;
    _timer4: number = 0; _timer5: number = 0; _timer6: number = 0;

    // ── Timer helpers ─────────────────────────────────────────────────────────

    /** Start timer N to fire onTimerN() after `ms` milliseconds. */
    startTimer(id: 1 | 2 | 3 | 4 | 5 | 6, ms: number): void {
        (this as unknown as Record<string, number>)[`_timer${id}`] = ms;
    }

    /** Cancel timer N. */
    stopTimer(id: 1 | 2 | 3 | 4 | 5 | 6): void {
        (this as unknown as Record<string, number>)[`_timer${id}`] = 0;
    }

    // ── Movement helpers ──────────────────────────────────────────────────────

    /**
     * Apply speed to position using `direction`, respecting deltaTime.
     * Call this in onStep() to move the copy.
     */
    move(): void {
        const dt = u.deltaTime;
        this.x += this.speed * Math.cos(this.direction * Math.PI / 180) * dt;
        this.y += this.speed * Math.sin(this.direction * Math.PI / 180) * dt;
    }

    /**
     * Add velocity in a given direction (degrees) to hspeed/vspeed.
     * Useful for impulses, knockback, etc.
     */
    addSpeed(spd: number, dir: number): void {
        this.hspeed += spd * Math.cos(dir * Math.PI / 180);
        this.vspeed += spd * Math.sin(dir * Math.PI / 180);
    }

    // ── Lifecycle events — override in subclass ───────────────────────────────

    onCreate?():       void;
    onBeforeCreate?(): void;

    onStep?():       void;
    onBeforeStep?(): void;
    onAfterStep?():  void;
    onFixedStep?():  void;

    onDraw?():       void;
    onBeforeDraw?(): void;
    onAfterDraw?():  void;

    onDestroy(): void {}

    onEnable?():  void;
    onDisable?(): void;

    // ── Pointer events — auto-registered by runtime if method is defined ──────

    onPointerClick?():     void;
    onPointerRightClick?():void;
    onPointerEnter?():     void;
    onPointerLeave?():     void;
    onPointerDown?():      void;
    onPointerUp?():        void;
    onPointerUpOutside?(): void;

    // ── Timer events — fired by runtime after startTimer() delay ─────────────

    onTimer1?(): void;
    onTimer2?(): void;
    onTimer3?(): void;
    onTimer4?(): void;
    onTimer5?(): void;
    onTimer6?(): void;

    // ── Animation — PIXI AnimatedSprite surface (runtime-set) ────────────────

    /** Playback speed of the sprite animation (1 = normal, 0.5 = half speed). */
    animationSpeed: number = 1;
    /** Current animation frame index (read-only at runtime). */
    readonly frame: number = 0;
    /** True while the animation is playing. */
    readonly isPlaying: boolean = false;

    /** Start playing the animation from the current frame. */
    play(): void {}
    /** Stop the animation on the current frame. */
    stop(): void {}
    /** Jump to `frame` and start playing. */
    gotoAndPlay(frame: number): void {}
    /** Jump to `frame` and stop. */
    gotoAndStop(frame: number): void {}

    // ── Animation events — AnimatedSprite templates only ─────────────────────

    onAnimationLoop?():  void;
    onAnimationEnd?():   void;
    onFrameChange?():    void;

    // ── Input events — TextBox templates only ────────────────────────────────

    onTextChange?(): void;
    onTextInput?():  void;

    // ── Physics collision events (populated by the matter runtime) ────────────

    onContactTemplate?(other: Template, impact: number): void;
    onContactAny?(other: Template | null, impact: number): void;
    onCollisionTemplate?(other: Template, impact: number): void;
    onCollisionAny?(other: Template | null, impact: number): void;
    onCollisionEndTemplate?(other: Template, impact: number): void;
    onCollisionEndAny?(other: Template | null, impact: number): void;
}

// ── Behavior base class ───────────────────────────────────────────────────────

export abstract class Behavior {
    /** The template instance this behavior is attached to. Set by the runtime. */
    host!: Template;

    onCreate?():          void;
    onStep?():            void;
    onFixedStep?():       void;
    onDraw?():            void;
    onDestroy?():         void;
    onEnable?():          void;
    onDisable?():         void;
    onBehaviorAdded?():   void;
    onBehaviorRemoved?(): void;
}

// ── Room base class ───────────────────────────────────────────────────────────

export abstract class Room {
    readonly name: string = '';
    width:  number = 1024;
    height: number = 768;

    onRoomStart?():  void;
    onStep?():       void;
    onFixedStep?():  void;
    onDraw?():       void;
    onRoomEnd?():    void;

    /** Fired when the browser/app window loses focus. */
    onAppBlur?():  void;
    /** Fired when the browser/app window gains focus. */
    onAppFocus?(): void;
}

// ── UILayer base class ────────────────────────────────────────────────────────

/**
 * Base class for UI layer scripts.
 * Extend this in `src/ui-layers/YourLayer.ts` to add logic to a UI layer.
 *
 * ```ts
 * import { UILayer, ui } from '@nyx/engine';
 * export class HUD extends UILayer {
 *     onMount() { ui.setProgress('healthBar', 1.0); }
 *     onStep()  { ui.setProgress('healthBar', vars.health / vars.maxHealth); }
 * }
 * ```
 */
export abstract class UILayer {
    /** Called once when the layer's widgets are mounted into the scene. */
    onMount?():   void;
    /** Called every frame while the layer is active. */
    onStep?():    void;
    /** Called when the layer is removed (room switch or explicit unmount). */
    onUnmount?(): void;
}

// ── Class registry — populated by esbuild bundle at export time ───────────────

export type TemplateConstructor = new () => Template;
export type BehaviorConstructor = new () => Behavior;
export type RoomConstructor     = new () => Room;
export type UILayerConstructor  = new () => UILayer;

export const registry: {
    templates: Record<string, TemplateConstructor>;
    behaviors: Record<string, BehaviorConstructor>;
    rooms:     Record<string, RoomConstructor>;
    uiLayers:  Record<string, UILayerConstructor>;
} = {
    templates: {},
    behaviors: {},
    rooms:     {},
    uiLayers:  {},
};

/** Register a Template class by name. Called from the esbuild bundle entry point. */
export function registerTemplate(name: string, cls: TemplateConstructor): void {
    registry.templates[name] = cls;
}

/** Register a Behavior class by name. */
export function registerBehavior(name: string, cls: BehaviorConstructor): void {
    registry.behaviors[name] = cls;
}

/** Register a Room class by name. */
export function registerRoom(name: string, cls: RoomConstructor): void {
    registry.rooms[name] = cls;
}

/** Register a UILayer class by name. */
export function registerUILayer(name: string, cls: UILayerConstructor): void {
    registry.uiLayers[name] = cls;
}
