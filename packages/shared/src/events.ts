/**
 * events.ts — event catalog.
 *
 * Each entry in CORE_EVENTS defines one available event type.
 * Key format: `${lib}_${eventKey}` (e.g. 'core_OnCreate').
 *
 * Instead of generating code strings (old system), events now define:
 *   - methodName: the method to insert in the script class
 *   - stubBody:   optional stub body (uses %%argName%% placeholders)
 *   - setupCode:  optional call to insert in onCreate() first (e.g. for timers)
 */

export type EventApplicable = 'template' | 'room' | 'behavior' | 'uiLayer';

export interface EventArgDef {
    name: string;
    type: 'string' | 'boolean' | 'integer' | 'float' | 'action' | 'text';
    default?: unknown;
}

export interface EventDef {
    name: string;
    category: string;
    icon: string;
    applicable: EventApplicable[];
    /** Only show for templates whose baseClass is in this list */
    baseClasses?: string[];
    /** Allow adding the same event more than once (e.g. action events) */
    repeatable?: boolean;
    /** Arguments for parametrized events */
    args?: Record<string, EventArgDef>;
    /** Method name to insert as a stub in the script file */
    methodName: string;
    /** Parameter list string inserted verbatim into the method signature, e.g. "other: Template" */
    methodParams?: string;
    /**
     * For parametrized events: the stub body to insert inside the method.
     * Uses %%argName%% placeholders that are replaced with the chosen arg value.
     */
    stubBody?: string;
    /**
     * For events that require setup first (e.g. timers): a one-liner to insert
     * into the existing onCreate() method.
     */
    setupCode?: string;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

const lifecycle: Record<string, EventDef> = {
    core_OnCreate: {
        name: 'On Create',
        category: 'lifecycle', icon: 'sun',
        applicable: ['template'],
        methodName: 'onCreate',
    },
    core_OnEnable: {
        name: 'On Enable',
        category: 'lifecycle', icon: 'toggle-right',
        applicable: ['template', 'behavior'],
        methodName: 'onEnable',
    },
    core_OnDisable: {
        name: 'On Disable',
        category: 'lifecycle', icon: 'toggle-left',
        applicable: ['template', 'behavior'],
        methodName: 'onDisable',
    },
    core_OnBeforeCreate: {
        name: 'Before Create',
        category: 'lifecycle', icon: 'sun',
        applicable: ['template'],
        methodName: 'onBeforeCreate',
    },
    core_OnStep: {
        name: 'On Step',
        category: 'lifecycle', icon: 'skip-back',
        applicable: ['template', 'room'],
        methodName: 'onStep',
    },
    core_OnBeforeStep: {
        name: 'Before Step',
        category: 'lifecycle', icon: 'skip-back',
        applicable: ['template'],
        methodName: 'onBeforeStep',
    },
    core_OnAfterStep: {
        name: 'After Step',
        category: 'lifecycle', icon: 'skip-back',
        applicable: ['template'],
        methodName: 'onAfterStep',
    },
    core_OnFixedStep: {
        name: 'On Fixed Update',
        category: 'lifecycle', icon: 'activity',
        applicable: ['template', 'room', 'behavior'],
        methodName: 'onFixedStep',
    },
    core_OnDraw: {
        name: 'On Draw',
        category: 'lifecycle', icon: 'skip-forward',
        applicable: ['template', 'room'],
        methodName: 'onDraw',
    },
    core_OnBeforeDraw: {
        name: 'Before Draw',
        category: 'lifecycle', icon: 'skip-forward',
        applicable: ['template'],
        methodName: 'onBeforeDraw',
    },
    core_OnAfterDraw: {
        name: 'After Draw',
        category: 'lifecycle', icon: 'skip-forward',
        applicable: ['template'],
        methodName: 'onAfterDraw',
    },

    core_OnDestroy: {
        name: 'On Destroy',
        category: 'lifecycle', icon: 'trash-2',
        applicable: ['template'],
        methodName: 'onDestroy',
    },
    core_OnRoomStart: {
        name: 'On Room Start',
        category: 'lifecycle', icon: 'sun',
        applicable: ['room'],
        methodName: 'onRoomStart',
    },
    core_OnRoomEnd: {
        name: 'On Room End',
        category: 'lifecycle', icon: 'trash-2',
        applicable: ['room'],
        methodName: 'onRoomEnd',
    },
    core_OnBehaviorAdded: {
        name: 'On Behavior Added',
        category: 'lifecycle', icon: 'plus-circle',
        applicable: ['behavior'],
        methodName: 'onBehaviorAdded',
    },
    core_OnBehaviorRemoved: {
        name: 'On Behavior Removed',
        category: 'lifecycle', icon: 'minus-circle',
        applicable: ['behavior'],
        methodName: 'onBehaviorRemoved',
    },
};

// ── Actions (parametrized) ────────────────────────────────────────────────────

const actionsEvents: Record<string, EventDef> = {
    core_OnActionPress: {
        name: 'On Action Press',
        category: 'actions', icon: 'zap',
        applicable: ['template', 'room'],
        repeatable: true,
        args: { action: { name: 'Action', type: 'action', default: '' } },
        methodName: 'onStep',
        stubBody: `  if (actions.isPressed(%%action%%)) {\n    // your code here\n  }`,
    },
    core_OnActionRelease: {
        name: 'On Action Release',
        category: 'actions', icon: 'zap-off',
        applicable: ['template', 'room'],
        repeatable: true,
        args: { action: { name: 'Action', type: 'action', default: '' } },
        methodName: 'onStep',
        stubBody: `  if (actions.isReleased(%%action%%)) {\n    // your code here\n  }`,
    },
    core_OnActionDown: {
        name: 'On Action Down',
        category: 'actions', icon: 'activity',
        applicable: ['template', 'room'],
        repeatable: true,
        args: { action: { name: 'Action', type: 'action', default: '' } },
        methodName: 'onStep',
        stubBody: `  if (actions.isDown(%%action%%)) {\n    const value = actions.value(%%action%%);\n    // your code here\n  }`,
    },
};

// ── Pointer events ────────────────────────────────────────────────────────────

const pointer: Record<string, EventDef> = {
    core_OnPointerClick: {
        name: 'On Click',
        category: 'pointer', icon: 'mouse-pointer',
        applicable: ['template'],
        methodName: 'onPointerClick',
    },
    core_OnPointerSecondaryClick: {
        name: 'On Right Click',
        category: 'pointer', icon: 'mouse-pointer',
        applicable: ['template'],
        methodName: 'onPointerRightClick',
    },
    core_OnPointerEnter: {
        name: 'On Pointer Enter',
        category: 'pointer', icon: 'log-in',
        applicable: ['template'],
        methodName: 'onPointerEnter',
    },
    core_OnPointerLeave: {
        name: 'On Pointer Leave',
        category: 'pointer', icon: 'log-out',
        applicable: ['template'],
        methodName: 'onPointerLeave',
    },
    core_OnPointerDown: {
        name: 'On Pointer Down',
        category: 'pointer', icon: 'arrow-down-circle',
        applicable: ['template'],
        methodName: 'onPointerDown',
    },
    core_OnPointerUp: {
        name: 'On Pointer Up',
        category: 'pointer', icon: 'arrow-up-circle',
        applicable: ['template'],
        methodName: 'onPointerUp',
    },
    core_OnPointerUpOutside: {
        name: 'On Pointer Up Outside',
        category: 'pointer', icon: 'external-link',
        applicable: ['template'],
        methodName: 'onPointerUpOutside',
    },
};

// ── Timers ────────────────────────────────────────────────────────────────────

function makeTimer(n: number): EventDef {
    return {
        name: `Timer ${n}`,
        category: 'timers', icon: 'clock',
        applicable: ['template', 'room'],
        methodName: `onTimer${n}`,
        setupCode: `this.startTimer(${n}, 1000); // set delay in ms`,
    };
}

const timers: Record<string, EventDef> = {
    core_Timer1: makeTimer(1),
    core_Timer2: makeTimer(2),
    core_Timer3: makeTimer(3),
    core_Timer4: makeTimer(4),
    core_Timer5: makeTimer(5),
    core_Timer6: makeTimer(6),
};

// ── Animation (AnimatedSprite only) ──────────────────────────────────────────

const animation: Record<string, EventDef> = {
    core_OnAnimationLoop: {
        name: 'On Animation Loop',
        category: 'animation', icon: 'repeat',
        applicable: ['template'], baseClasses: ['AnimatedSprite'],
        methodName: 'onAnimationLoop',
    },
    core_OnAnimationComplete: {
        name: 'On Animation Complete',
        category: 'animation', icon: 'check-circle',
        applicable: ['template'], baseClasses: ['AnimatedSprite'],
        methodName: 'onAnimationEnd',
    },
    core_OnFrameChange: {
        name: 'On Frame Change',
        category: 'animation', icon: 'film',
        applicable: ['template'], baseClasses: ['AnimatedSprite'],
        methodName: 'onFrameChange',
    },
};

// ── Physics (Matter.js collision events) ─────────────────────────────────────

const physics: Record<string, EventDef> = {
    matter_ContactTemplate: {
        name: 'Contact with a template',
        category: 'physics', icon: 'zap',
        applicable: ['template'],
        methodName: 'onContactTemplate',
        methodParams: 'other: Template',
        stubBody: [
            `  // 'other' is the full copy instance — all its properties and methods are available.`,
            `  // other.x, other.y — world position`,
            `  // other.shape.top / .bottom / .left / .right — bounds offsets from pivot`,
            `  // other.kill()  — destroy other`,
            `  // if ('STOMP' in other) (other as any).STOMP();  — call custom method`,
            `  // your code here`,
        ].join('\n'),
    },
    matter_ContactAny: {
        name: 'Contact with anything',
        category: 'physics', icon: 'zap',
        applicable: ['template'],
        methodName: 'onContactAny',
        methodParams: 'other: Template | null',
        stubBody: [
            `  // 'other' is null when touching a static tile or tilemap.`,
            `  if (!other) return;`,
            `  // other.x, other.y, other.shape.* — position and bounds`,
            `  // other.kill()  — destroy other`,
            `  // if ('myMethod' in other) (other as any).myMethod();`,
            `  // your code here`,
        ].join('\n'),
    },
    matter_CollisionTemplate: {
        name: 'Collision with a template',
        category: 'physics', icon: 'activity',
        applicable: ['template'],
        methodName: 'onCollisionTemplate',
        methodParams: 'other: Template',
        stubBody: [
            `  // Fires every frame while overlapping 'other'. Can't be used in dynamic behaviors.`,
            `  // other.x, other.y, other.shape.* — position and bounds`,
            `  // other.kill()  — destroy other`,
            `  // if ('myMethod' in other) (other as any).myMethod();`,
            `  // your code here`,
        ].join('\n'),
    },
    matter_CollisionAny: {
        name: 'Collision with anything',
        category: 'physics', icon: 'activity',
        applicable: ['template'],
        methodName: 'onCollisionAny',
        methodParams: 'other: Template | null',
        stubBody: [
            `  // Fires every frame while overlapping. 'other' is null for static tiles/tilemaps.`,
            `  if (!other) return;`,
            `  // other.x, other.y, other.shape.* — position and bounds`,
            `  // other.kill()  — destroy other`,
            `  // your code here`,
        ].join('\n'),
    },
    matter_CollisionEndTemplate: {
        name: 'Collision end with a template',
        category: 'physics', icon: 'minus-circle',
        applicable: ['template'],
        methodName: 'onCollisionEndTemplate',
        methodParams: 'other: Template',
        stubBody: [
            `  // Fires once when overlap ends. 'other' may already be killed.`,
            `  // your code here`,
        ].join('\n'),
    },
    matter_CollisionEndAny: {
        name: 'Collision end with anything',
        category: 'physics', icon: 'minus-circle',
        applicable: ['template'],
        methodName: 'onCollisionEndAny',
        methodParams: 'other: Template | null',
        stubBody: [
            `  // Fires once when overlap ends. 'other' is null for static tiles/tilemaps.`,
            `  if (!other) return;`,
            `  // your code here`,
        ].join('\n'),
    },
};

// ── Application events (room only) ───────────────────────────────────────────

const app: Record<string, EventDef> = {
    core_OnAppBlur: {
        name: 'On App Blur',
        category: 'app', icon: 'minimize-2',
        applicable: ['room'],
        methodName: 'onAppBlur',
    },
    core_OnAppFocus: {
        name: 'On App Focus',
        category: 'app', icon: 'maximize-2',
        applicable: ['room'],
        methodName: 'onAppFocus',
    },
};

// ── Input (TextBox only) ──────────────────────────────────────────────────────

const input: Record<string, EventDef> = {
    core_OnTextChange: {
        name: 'On Text Change',
        category: 'input', icon: 'edit-3',
        applicable: ['template'], baseClasses: ['TextBox'],
        methodName: 'onTextChange',
    },
    core_OnTextInput: {
        name: 'On Text Input',
        category: 'input', icon: 'type',
        applicable: ['template'], baseClasses: ['TextBox'],
        methodName: 'onTextInput',
    },
};

// ── UILayer events ────────────────────────────────────────────────────────────

const uiLayerEvents: Record<string, EventDef> = {
    uiLayer_OnMount: {
        name: 'On Mount',
        category: 'uiLayer', icon: 'layers',
        applicable: ['uiLayer'],
        methodName: 'onMount',
    },
    uiLayer_OnStep: {
        name: 'On Step',
        category: 'uiLayer', icon: 'skip-back',
        applicable: ['uiLayer'],
        methodName: 'onStep',
    },
    uiLayer_OnUnmount: {
        name: 'On Unmount',
        category: 'uiLayer', icon: 'x-circle',
        applicable: ['uiLayer'],
        methodName: 'onUnmount',
    },
    uiLayer_OnWidgetClick: {
        name: 'On Button Click',
        category: 'uiLayerWidgets', icon: 'mouse-pointer',
        applicable: ['uiLayer'],
        repeatable: true,
        methodName: 'onMount',
        stubBody: `ui.onButtonClick('%%widgetName%%', () => {\n    // handle click\n  });`,
        args: { widgetName: { name: 'Widget name', type: 'text', default: 'myButton' } },
    },
    uiLayer_OnWidgetPointerOver: {
        name: 'On Widget Hover',
        category: 'uiLayerWidgets', icon: 'move',
        applicable: ['uiLayer'],
        repeatable: true,
        methodName: 'onMount',
        stubBody: `ui.on('%%widgetName%%', 'pointerover', () => {\n    // handle hover\n  });`,
        args: { widgetName: { name: 'Widget name', type: 'text', default: 'myWidget' } },
    },
};

// ── Combined catalog ──────────────────────────────────────────────────────────

export const CORE_EVENTS: Record<string, EventDef> = {
    ...lifecycle,
    ...actionsEvents,
    ...pointer,
    ...timers,
    ...animation,
    ...physics,
    ...input,
    ...app,
    ...uiLayerEvents,
};

export const EVENT_CATEGORIES: Record<string, { name: string; icon: string }> = {
    lifecycle: { name: 'Lifecycle',   icon: 'rotate-cw'    },
    actions:   { name: 'Actions',     icon: 'zap'          },
    pointer:   { name: 'Pointer',     icon: 'mouse-pointer' },
    timers:    { name: 'Timers',      icon: 'clock'        },
    animation: { name: 'Animation',   icon: 'film'         },
    physics:        { name: 'Physics',      icon: 'box'           },
    input:          { name: 'Input',        icon: 'type'          },
    app:            { name: 'Application',  icon: 'monitor'       },
    uiLayer:        { name: 'Lifecycle',    icon: 'layers'        },
    uiLayerWidgets: { name: 'Widget Events', icon: 'mouse-pointer' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getEventDef(lib: string, eventKey: string): EventDef | undefined {
    return CORE_EVENTS[`${lib}_${eventKey}`];
}

export function getEventDisplayName(lib: string, eventKey: string, args?: Record<string, unknown>): string {
    const def = getEventDef(lib, eventKey);
    if (!def) return `${lib}:${eventKey}`;
    if (def.args && args) {
        const argParts: string[] = [];
        for (const [k, argDef] of Object.entries(def.args)) {
            const v = args[k];
            if (v !== undefined && v !== '' && v !== argDef.default) {
                argParts.push(String(v));
            }
        }
        if (argParts.length) return `${def.name} (${argParts.join(', ')})`;
    }
    return def.name;
}

/**
 * Build a method stub string to insert into a script class for a given event.
 * Substitutes %%argName%% placeholders with JSON-stringified arg values.
 *
 * Returns an empty string if the event key is unknown.
 */
/**
 * Substitute %%key%% placeholders in a stub body string.
 */
export function applyStubArgs(body: string, args: Record<string, unknown>): string {
    let out = body;
    for (const [key, val] of Object.entries(args)) {
        out = out.replace(new RegExp(`%%${key}%%`, 'g'), JSON.stringify(val));
    }
    return out;
}

/**
 * Build a full method stub for insertion into a class body.
 * Methods are indented 2 spaces (class body standard) and their
 * bodies are indented 4 spaces total.
 */
export function buildMethodStub(lib: string, eventKey: string, args?: Record<string, unknown>): string {
    const def = getEventDef(lib, eventKey);
    if (!def) return '';

    let rawBody = def.stubBody ?? '  // your code here';
    if (args) rawBody = applyStubArgs(rawBody, args);

    // Indent each body line by 2 more spaces so the total inside a 2-space method is 4 spaces
    const indentedBody = rawBody
        .split('\n')
        .map(line => (line.trim() ? '  ' + line : line))
        .join('\n');

    const lines: string[] = [];
    if (def.setupCode) {
        lines.push(`  // In onCreate: ${def.setupCode}`);
    }
    lines.push(`  ${def.methodName}(${def.methodParams ?? ''}) {`);
    lines.push(indentedBody);
    lines.push(`  }`);
    return lines.join('\n');
}

/**
 * Return just the body snippet (without the method wrapper) for inserting
 * into an already-existing method. Indented for a 4-space method body.
 */
export function buildMethodBodySnippet(lib: string, eventKey: string, args?: Record<string, unknown>): string {
    const def = getEventDef(lib, eventKey);
    if (!def) return '';
    let rawBody = def.stubBody ?? '    // your code here';
    if (args) rawBody = applyStubArgs(rawBody, args);
    // Ensure 4-space indent
    return rawBody
        .split('\n')
        .map(line => (line.trim() ? '  ' + line : line))
        .join('\n');
}
