/**
 * Runtime global declarations for the Nyx game runtime.
 * This file MUST NOT contain top-level imports — otherwise TypeScript
 * treats it as a module and the declare statements become local, not global.
 */

// ─── Legacy textureShape type alias (no import — inlined) ────────────────────

/** @deprecated Use TextureShape from @nyx/shared instead. */
declare type textureShape =
    | { type: 'rect'; top: number; bottom: number; left: number; right: number }
    | { type: 'circle'; r: number }
    | { type: 'strip'; points: { x: number; y: number }[]; closedStrip: boolean }
    | { type: 'point' };

// ─── Neutralino desktop pack stubs ───────────────────────────────────────────
// The Neutralino APIs are only called when `'NL_OS' in window` is true,
// meaning the game is running inside a Neutralino desktop wrapper.
// In Electron builds the window.electronAPI is used instead.
// We declare Neutralino as any to avoid import errors in the ported runtime.

declare var NL_OS: string | undefined;
declare var Neutralino: {
    init(): void;
    app: { exit(code?: number): Promise<void> };
    events: {
        on(event: string, handler: () => void): Promise<void>;
        off(event: string, handler: () => void): Promise<void>;
    };
    window: {
        setAlwaysOnTop(flag: boolean): Promise<void>;
        setFullScreen(): Promise<void>;
        exitFullScreen(): Promise<void>;
        isFullScreen(): Promise<boolean>;
    };
    [key: string]: unknown;
};

// ─── require stub ────────────────────────────────────────────────────────────
// require() is used in index.ts to detect whether the game is running in
// an Electron context (older versions). It is conditionally wrapped in try/catch
// so it is safe to declare as any if unavailable.
declare function require(module: string): unknown;

// ─── camera global ───────────────────────────────────────────────────────────

interface ICameraGlobal {
    x: number;
    y: number;
    /** Rotation of the camera in degrees. */
    angle: number;
    width: number;
    height: number;
    /** Target x the camera drifts toward (set this to move smoothly). */
    targetX: number;
    /** Target y the camera drifts toward (set this to move smoothly). */
    targetY: number;
    /** Copy or DisplayObject to follow, or `false`/`undefined` to disable. */
    follow: object | false | undefined;
    followX: boolean;
    followY: boolean;
    borderX: number | null;
    borderY: number | null;
    minX: number | undefined;
    maxX: number | undefined;
    minY: number | undefined;
    maxY: number | undefined;
    /** Smooth camera follow factor (0 = instant, ~0.9 = very smooth). */
    drift: number;
    shake: number;
    shakeDecay: number;
    shakeX: number;
    shakeY: number;
    shakeFrequency: number;
    shakePhase: number;
    shakePhaseX: number;
    shakePhaseY: number;
    shakeMax: number;
    shiftX: number;
    shiftY: number;
    referenceLength: number;
    scale: { x: number; y: number };
    readonly computedX: number;
    readonly computedY: number;
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    /** Move camera toward (x, y), respecting the drift setting. */
    moveTo(x: number, y: number): void;
    /** Instantly snap camera to (x, y), resetting shake phase. */
    teleportTo(x: number, y: number): void;
    uiToGameCoord(x: number, y: number): { x: number; y: number };
    gameToUiCoord(x: number, y: number): { x: number; y: number };
    getTopLeftCorner(): { x: number; y: number };
    getTopRightCorner(): { x: number; y: number };
    getBottomLeftCorner(): { x: number; y: number };
    getBottomRightCorner(): { x: number; y: number };
    contains(obj: object): boolean;
    realign(room: object): void;
}

declare var camera: ICameraGlobal;

// ─── tween global ────────────────────────────────────────────────────────────

type TweenEasingFunction = (t: number) => number;

interface ITween extends Promise<void> {
    stop(): void;
    readonly done: boolean;
}

interface ITweenOptions {
    obj:       Record<string, unknown>;
    fields:    Record<string, number>;
    /** Duration in milliseconds. Default: 1000. */
    duration?: number;
    /** Easing function. Default: tween.easeInOut. */
    curve?:    TweenEasingFunction;
    /** Use UI time scale (unaffected by game pause). Default: false. */
    isUi?:     boolean;
    /** Suppress unhandled promise rejection on interruption. Default: false. */
    silent?:   boolean;
}

// ─── emitters global ─────────────────────────────────────────────────────────

interface IEmitterTandem {
    x: number;
    y: number;
    /** Kill the tandem and remove all its particles immediately. */
    kill: boolean;
    /** Pause all particle emission. */
    pause(): void;
    /** Resume particle emission. */
    resume(): void;
    /** Shift the whole tandem by (dx, dy). */
    shiftX(dx: number): void;
    shiftY(dy: number): void;
}

interface ITandemSettings {
    /** Override the room this tandem is added to. */
    room?: object;
    /** Attach to a parent DisplayObject instead of placing in the room. */
    parent?: object;
    /** Scale factor applied to all emitters in the tandem. */
    scale?: { x: number; y: number };
    /** Rotation offset in degrees. */
    rotation?: number;
    /** If true, the tandem stops after one wave and auto-removes. */
    killOnEnd?: boolean;
}

declare var emitters: {
    /**
     * Fire a named emitter tandem at (x, y).
     * @param name The name of the emitter tandem as defined in the editor.
     * @param x World x position.
     * @param y World y position.
     * @param settings Optional settings (room override, scale, etc.).
     */
    fire(name: string, x: number, y: number, settings?: ITandemSettings): IEmitterTandem;
    /**
     * Attach a named emitter tandem to a game object.
     * @param parent The game object to attach to.
     * @param name The name of the emitter tandem.
     * @param settings Optional settings.
     */
    follow(parent: object, name: string, settings?: ITandemSettings): IEmitterTandem;
    /**
     * Stop all active tandems with the given name.
     * @param name The tandem name to stop.
     * @param kill If true, remove particles immediately. Default: false.
     */
    stopByName(name: string, kill?: boolean): void;
    /** Stop all active emitter tandems in the current room. */
    stopAll(kill?: boolean): void;
};

declare var tween: {
    add(options: ITweenOptions): ITween;
    readonly linear:          TweenEasingFunction;
    readonly easeInOut:       TweenEasingFunction;
    readonly easeOut:         TweenEasingFunction;
    readonly easeIn:          TweenEasingFunction;
    readonly easeOutBack:     TweenEasingFunction;
    readonly easeInBack:      TweenEasingFunction;
    readonly easeOutElastic:  TweenEasingFunction;
    readonly easeOutBounce:   TweenEasingFunction;
};
