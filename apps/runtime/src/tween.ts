import { NyxTimer } from './timer';

// ── Easing type ───────────────────────────────────────────────────────────────

/** Normalized easing function: progress t ∈ [0,1] → eased value (may exceed [0,1]). */
export type EasingFunction = (t: number) => number;

// ── Easing curves ─────────────────────────────────────────────────────────────

export const linear:         EasingFunction = t => t;
export const easeInOut:      EasingFunction = t => {
    t *= 2;
    if (t < 1) return 0.5 * t * t;
    t--;
    return -0.5 * (t * (t - 2) - 1);
};
export const easeOut:        EasingFunction = t => -t * (t - 2);
export const easeIn:         EasingFunction = t => t * t;
export const easeOutBack:    EasingFunction = t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
export const easeInBack:     EasingFunction = t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
};
export const easeOutElastic: EasingFunction = t => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
};
export const easeOutBounce:  EasingFunction = t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1)       return n1 * t * t;
    if (t < 2 / d1)       return n1 * (t -= 1.5   / d1) * t + 0.75;
    if (t < 2.5 / d1)     return n1 * (t -= 2.25  / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface ITweenOptions {
    obj:       Record<string, unknown>;
    fields:    Record<string, number>;
    /** Duration in milliseconds. Default: 1000. */
    duration?: number;
    /** Easing function. Default: easeInOut. */
    curve?:    EasingFunction;
    /** Use UI time scale (unaffected by game pause). Default: false. */
    isUi?:     boolean;
    /** Suppress unhandled promise rejection on interruption. Default: false. */
    silent?:   boolean;
}

export interface ITween extends Promise<void> {
    /** Stop the animation mid-way. The promise rejects. */
    stop(): void;
    readonly done: boolean;
}

// ── Internal record ───────────────────────────────────────────────────────────

interface TweenRecord {
    obj:       Record<string, unknown>;
    fields:    Record<string, number>;
    starting:  Record<string, number>;
    curve:     EasingFunction;
    duration:  number;
    timer:     NyxTimer;
    resolveFn: () => void;
    rejectFn:  (r: unknown) => void;
    silent:    boolean;
}

// ── Module ────────────────────────────────────────────────────────────────────

const tweenLib = {

    tweens: new Set<TweenRecord>(),

    add(options: ITweenOptions): ITween {
        const duration = options.duration ?? 1000;
        const curve    = options.curve    ?? easeInOut;
        const isUi     = options.isUi     ?? false;
        const silent   = options.silent   ?? false;

        // Snapshot starting values synchronously before any async gap.
        const starting: Record<string, number> = {};
        for (const field in options.fields) {
            starting[field] = (options.obj[field] as number) ?? 0;
        }

        const timer = new NyxTimer(duration, 'tween', isUi);

        let resolveFn!: () => void;
        let rejectFn!:  (r: unknown) => void;
        const promise = new Promise<void>((res, rej) => {
            resolveFn = res;
            rejectFn  = rej;
        });

        const record: TweenRecord = {
            obj: options.obj, fields: options.fields,
            starting, curve, duration, timer, resolveFn, rejectFn, silent,
        };

        // Room-switch rejection from NyxTimer propagates to our promise.
        timer.promise.catch((reason: unknown) => {
            tweenLib.tweens.delete(record);
            if (!silent) rejectFn(reason);
        });

        tweenLib.tweens.add(record);

        return Object.assign(promise, {
            stop(): void {
                timer.reject({ code: 0, info: 'Stopped by game logic', from: 'tween' });
            },
            get done(): boolean { return timer.done; },
        }) as ITween;
    },

    /**
     * Advance all active tweens by one frame.
     * Called by the game loop in index.ts after timerM.updateTimers().
     */
    update(): void {
        for (const rec of tweenLib.tweens) {
            if (rec.timer.rejected || rec.timer.done) {
                if (rec.timer.done) {
                    for (const field in rec.fields) {
                        (rec.obj as Record<string, number>)[field] = rec.fields[field];
                    }
                    rec.resolveFn();
                }
                tweenLib.tweens.delete(rec);
                continue;
            }
            if ((rec.obj as { kill?: boolean }).kill) {
                rec.timer.reject({ code: 2, info: 'Copy is killed', from: 'tween' });
                tweenLib.tweens.delete(rec);
                continue;
            }

            let a = (rec.timer.time * 1000) / rec.duration;
            if (a > 1) a = 1;

            for (const field in rec.fields) {
                const s = rec.starting[field];
                (rec.obj as Record<string, number>)[field] = s + (rec.fields[field] - s) * rec.curve(a);
            }

            if (a >= 1) {
                for (const field in rec.fields) {
                    (rec.obj as Record<string, number>)[field] = rec.fields[field];
                }
                rec.resolveFn();
                rec.timer.resolve();
                tweenLib.tweens.delete(rec);
            }
        }
    },

    /** Cancel all active tweens. Called on room switch. */
    clear(): void {
        for (const rec of tweenLib.tweens) {
            if (!rec.timer.settled) {
                rec.timer.reject({ code: 1, info: 'Room switched', from: 'tween' });
            }
        }
        tweenLib.tweens.clear();
    },

    // Easing curves re-exported so users write: tween.add({ curve: tween.easeOutBack })
    linear, easeInOut, easeOut, easeIn,
    easeOutBack, easeInBack, easeOutElastic, easeOutBounce,
};

export default tweenLib;
