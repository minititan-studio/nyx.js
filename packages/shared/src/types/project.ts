import type { NyxProjectEntry, NyxTexture, NyxTemplate, NyxRoom, NyxSound, NyxFont, NyxStyle, NyxBehavior, NyxScript, NyxEnum, NyxEmitterTandem, NyxUILayer } from './assets.js';



// ── Physics collision groups ──────────────────────────────────────────────────

/** A named physics collision group. Category bitmask = 1 << index in the physicsGroups array. */
export interface NyxPhysicsGroup {
    /** Display name, e.g. "Player", "Enemy", "World" */
    name: string;
    /**
     * Bitmask of which group categories this group collides with.
     * Bit j set = collides with group at index j. Default -1 = collide with all.
     */
    mask: number;
}

// ── Global variables ──────────────────────────────────────────────────────────

/**
 * A single declared global variable. Values are always stored as strings:
 * - string: JSON.stringify(value)
 * - number: raw numeric string
 * - boolean: "true" | "false"
 * - raw: verbatim JS expression
 */
export interface NyxProjectVariable {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'raw';
    value: string;
}

// ── Action / input system ─────────────────────────────────────────────────────

/** A single input binding within an action. Mirrors legacy Nyx action method shape. */
export interface NyxProjectActionMethod {
    /** Full dotted code, e.g. "keyboard.KeyA" or "gamepad.LStickX" */
    code: string;
    /** Scale factor applied to the raw input value. Default 1. */
    multiplier?: number;
}

/** A named game action that aggregates one or more input methods. */
export interface NyxProjectAction {
    name: string;
    methods: NyxProjectActionMethod[];
}

// ── Content subsystem ─────────────────────────────────────────────────────────

/** All valid field type strings for IFieldSchema. Legacy names preserved for .ict compatibility. */
export type FieldSchemaType =
    | 'text' | 'textfield' | 'code' | 'number' | 'sliderAndNumber'
    | 'checkbox' | 'color'
    | 'texture' | 'template' | 'room' | 'sound'
    | 'tandem' | 'typeface'   // legacy names — do not rename
    | 'behavior' | 'script' | 'style' | 'enum'
    | `enum@${string}`;       // dynamic enum reference

export type FieldSchemaStructure = 'atomic' | 'array' | 'map';

/** One field definition within a content type's specification. Mirrors IFieldSchema.d.ts. */
export interface IFieldSchema {
    name: string;
    readableName: string;
    type: FieldSchemaType;
    required: boolean;
    structure: FieldSchemaStructure;
    /** Only relevant when structure === 'map'. */
    mappedType?: FieldSchemaType;
    /** Only relevant when structure === 'array'. */
    fixedLength?: number;
}

/** A named content type: schema definition + stored data entries. */
export interface IContentType {
    name: string;
    readableName: string;
    icon: string;
    specification: IFieldSchema[];
    entries: Record<string, unknown>[];
}

// ── Settings sub-types ────────────────────────────────────────────────────────

/** Mirrors legacy currentProject.settings.authoring */
export interface NyxProjectAuthoring {
    title: string;
    author: string;
    site: string;
    /** Semantic version tuple [major, minor, patch] */
    version: [number, number, number];
    versionPostfix: string;
    appId: string;
}

/** Mirrors legacy currentProject.settings.rendering */
export interface NyxProjectRendering {
    maxFPS: number;
    pixelatedrender: boolean;
    highDensity: boolean;
    usePixiLegacy: boolean;
    transparent: boolean;
    hideCursor: boolean;
    viewMode: 'asIs' | 'fastScale' | 'fastScaleInteger' | 'expand' | 'scaleFit' | 'scaleFill';
    desktopMode: 'maximized' | 'fullscreen' | 'windowed';
    mobileScreenOrientation: 'unspecified' | 'landscape' | 'portrait';
}

/** Mirrors legacy currentProject.settings.branding */
export interface NyxProjectBranding {
    /** UID of the texture used as the game icon, or '' if not set */
    icon: string;
    /** UID of the texture used as the splash screen, or '' if not set */
    splashScreen: string;
    forceSmoothIcons: boolean;
    forceSmoothSplashScreen: boolean;
    /** Hex color string for the preloader accent bar */
    accent: string;
    invertPreloaderScheme: boolean;
    hideLoadingLogo: boolean;
    alternativeLogo: boolean;
    customLoadingText: string;
}

/** Mirrors legacy currentProject.settings.export */
export interface NyxProjectExport {
    showErrors: boolean;
    errorsLink: string;
    autocloseDesktop: boolean;
    /** Desktop build targets */
    windows: boolean;
    linux: boolean;
    mac: boolean;
    codeModifier: 'none' | 'minify' | 'obfuscate';
    bundleAssetTree: boolean;
    bundleAssetTypes: {
        texture: boolean; template: boolean; room: boolean;
        behavior: boolean; script: boolean; font: boolean;
        sound: boolean; style: boolean; tandem: boolean;
    };
}

export interface NyxProjectSettings {
    authoring: NyxProjectAuthoring;
    rendering: NyxProjectRendering;
    branding: NyxProjectBranding;
    export: NyxProjectExport;
    /** Additional settings added by future phases */
    [key: string]: unknown;
}

/** Root  project type. Serialized to project.json — code never lives here. */
export interface NyxProject {
    /** Nyx schema version */
    nyxVersion: string;

    /** Project metadata */
    name: string;

    /**
     * Flat typed asset collections — used by the exporter.
     * Mirrors legacy window.currentProject.textures etc.
     */
    textures: NyxTexture[];
    templates: NyxTemplate[];
    rooms: NyxRoom[];
    sounds: NyxSound[];
    fonts: NyxFont[];
    styles: NyxStyle[];
    behaviors: NyxBehavior[];
    scripts: NyxScript[];
    enums: NyxEnum[];
    emitterTandems: NyxEmitterTandem[];
    uiLayers: NyxUILayer[];

    /**
     * Hierarchical asset tree — used by the asset browser.
     * Root-level entries: mix of typed assets and NyxFolder objects.
     * Mirrors legacy window.currentProject.assets.
     */
    assets: NyxProjectEntry[];

    /**
     * Enabled nyxmods and their per-project settings.
     * Key = module directory name (e.g. 'place'), value = field settings object.
     * Renamed from legacy `libs` — migration shim in reader.ts handles old files.
     */
    modules: Record<string, Record<string, unknown>>;

    /** Number of backup copies to keep. Default 3. */
    backups?: number;

    /** Input action definitions — mirrors legacy window.currentProject.actions */
    actions: NyxProjectAction[];

    /** Declared global variables — mirrors legacy window.currentProject.globalVars */
    globalVars: NyxProjectVariable[];

    /** Named physics collision groups. Category = 1 << index. Max 32 groups. */
    physicsGroups: NyxPhysicsGroup[];

    /** Content type definitions + data entries — mirrors legacy window.currentProject.contentTypes */
    contentTypes: IContentType[];

    settings: NyxProjectSettings;
}
