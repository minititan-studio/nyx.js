import type { TemplateBaseClass } from '@nyx/shared';

// ── Field types ───────────────────────────────────────────────────────────────

/**
 * Visual field types recognized by the nyxmod field renderer.
 * Heading types (h1–h4) produce non-interactive section labels.
 */
export type NyxModFieldType =
    | 'h1' | 'h2' | 'h3' | 'h4'
    | 'number' | 'slider' | 'sliderAndNumber'
    | 'string' | 'text'
    | 'checkbox'
    | 'radio'
    | 'color'
    | 'table'
    | 'group'
    | string; // modules may introduce new types in the future

/** A single configurable field declared in a nyxmod's module.json. */
export interface NyxModField<T = unknown> {
    /** Displayed label */
    name: string;
    /** Field type discriminant */
    type: NyxModFieldType;
    /** JSON key written into project.modules[moduleName][key] */
    key?: string;
    /** Default value shown in the UI (not written to project unless explicitly set) */
    default?: T;
    /** Helper text shown beneath the field */
    help?: string;

    // ── radio ──────────────────────────────────────────────────────────────
    options?: Array<{ value: T; name: string; help?: string }>;

    // ── table ──────────────────────────────────────────────────────────────
    fields?: NyxModField[];

    // ── number / slider / sliderAndNumber ──────────────────────────────────
    min?: number;
    max?: number;
    step?: number;

    // ── group ──────────────────────────────────────────────────────────────
    openedByDefault?: boolean;
    /** localStorage key used to persist group open/closed state */
    lsKey?: string;
    items?: NyxModField[];
}

// ── Module categories ─────────────────────────────────────────────────────────

export type NyxModCategory =
    | 'customization'
    | 'utilities'
    | 'media'
    | 'misc'
    | 'desktop'
    | 'motionPlanning'
    | 'inputs'
    | 'fx'
    | 'mobile'
    | 'integrations'
    | 'tweaks'
    | 'networking'
    | 'default';

// ── Event system types ────────────────────────────────────────────────────────

/** A named group of related events shown as a submenu in the event picker. */
export interface EventCategory {
    name: string;
    hint?: string;
    icon: string;
    /** Localized variants (e.g. name_Ru, hint_Ru) */
    [localeKey: string]: string | undefined;
}

export type EventApplicableEntity = 'template' | 'room' | 'behavior';

export type EventArgumentType =
    | 'integer' | 'float' | 'string' | 'boolean'
    | 'template' | 'room' | 'sound' | 'tandem'
    | 'font' | 'style' | 'texture' | 'action';

export type EventCodeTarget =
    | 'thisOnStep'    | 'thisOnCreate' | 'thisOnDraw' | 'thisOnDestroy'
    | 'rootRoomOnCreate' | 'rootRoomOnStep' | 'rootRoomOnDraw' | 'rootRoomOnLeave'
    | 'thisOnAdded'   | 'thisOnRemoved';

export interface EventArgumentDeclaration {
    name: string;
    type: EventArgumentType;
    default?: unknown;
}

export interface EventLocalVarDeclaration {
    type: string;
    description?: string;
}

/**
 * Full declaration for a single event, as found in module.json `events` map
 * or the core events registry.
 */
export interface EventDeclaration {
    name: string;
    /** Template string used in the event list when the event has arguments. */
    parameterizedName?: string;
    hint?: string;
    applicable: EventApplicableEntity[];
    /** Restrict to specific template base classes when applicable includes 'template'. */
    baseClasses?: TemplateBaseClass[];
    icon: string;
    /** If true, show a thumbnail of the first asset argument in the event list. */
    useAssetThumbnail?: boolean;
    category: string;
    arguments?: Record<string, EventArgumentDeclaration>;
    /** If true, the same event can be added more than once (used with parameterized events). */
    repeatable?: boolean;
    locals?: Record<string, EventLocalVarDeclaration>;
    codeTargets: EventCodeTarget[];
    inlineCodeTemplates?: Partial<Record<EventCodeTarget, string>>;
    [key: string]: unknown;
}

// ── NyxMod manifest ───────────────────────────────────────────────────────────

export interface NyxModAuthor {
    name: string;
    mail: string;
}

/**
 * The parsed contents of a NyxMod's `module.json` file.
 * All keys mirror the `NyxModManifest` shape so existing
 * built-in modules parse without transformation.
 */
export interface NyxModManifest {
    main: {
        name: string;
        tagline: string;
        /** Localized taglines (e.g. tagline_Ru) */
        [taglineLocale: string]: string | string[] | NyxModAuthor[] | NyxModCategory[] | undefined;
        icon?: string;
        version: string;
        authors: NyxModAuthor[];
        categories?: NyxModCategory[];
    };

    /** Global module settings shown in the module details panel. */
    fields?: NyxModField[];

    /** Extra fields injected into the Template editor. */
    templateExtends?: NyxModField[];

    /** Extra fields injected into the Room editor. */
    roomExtends?: NyxModField[];

    /** Extra fields injected into Tile Layer editors. */
    tileLayerExtends?: NyxModField[];

    /** Extra fields injected into Copy (instance) editors. */
    copyExtends?: NyxModField[];

    /**
     * Input method names this module registers (e.g. keyboard, gamepad).
     * Keys = internal name, values = display name.
     */
    inputMethods?: Record<string, string>;

    /** Extra event categories declared by this module. */
    eventCategories?: Record<string, EventCategory>;

    /** Extra events declared by this module. Key = `moduleName_EventKey`. */
    events?: Record<string, EventDeclaration>;

    /** Modules that must be enabled for this module to function. */
    dependencies?: string[];

    /** Modules that enhance this module but are not strictly required. */
    optionalDependencies?: string[];
}

// ── Loaded nyxmod record ──────────────────────────────────────────────────────

/** A fully loaded nyxmod with its resolved filesystem path. */
export interface NyxMod {
    /** Directory name, used as the key in project.modules. */
    name: string;
    /** Absolute path to the nyxmod's directory on disk. */
    path: string;
    manifest: NyxModManifest;
}

/** Lightweight reference used before the manifest is loaded. */
export interface NyxModMeta {
    name: string;
    path: string;
    manifest?: NyxModManifest;
}

// ── Project libs shape ────────────────────────────────────────────────────────

/**
 * Per-module settings stored in NyxProject.libs.
 * Keys are module field keys; values are whatever the field type requires.
 */
export type NyxModSettings = Record<string, unknown>;
