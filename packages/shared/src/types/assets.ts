import type { TemplateBaseClass } from './exporterContracts.js';

/**
 * Asset type discriminant used for icon mapping, tab routing, and the asset browser.
 */
export type AssetType =
    | 'texture'
    | 'template'
    | 'room'
    | 'sound'
    | 'font'
    | 'style'
    | 'behavior'
    | 'script'
    | 'enum'
    | 'emitterTandem'
    | 'uiLayer';

/** Minimal base shape shared by all asset objects. */
export interface NyxAsset {
    uid: string;
    name: string;
    type: AssetType;
    /** Unix timestamp (Date.now()) */
    lastModified: number;
}

// ─── Texture ────────────────────────────────────────────────────────────────

export type CollisionShape =
    | { type: 'rect';   top: number; bottom: number; left: number; right: number }
    | { type: 'circle'; r: number }
    | { type: 'strip';  points: { x: number; y: number }[]; closedStrip: boolean }
    | { type: 'point' };

export interface NyxTexture extends NyxAsset {
    type: 'texture';
    /** Source filename relative to project assets/textures/ dir */
    origname: string;
    /** [cols, rows] — number of animation frames per axis */
    grid: [number, number];
    /** Frame width in pixels */
    width: number;
    /** Frame height in pixels */
    height: number;
    /** Left offset (skip this many px before first frame) */
    offx: number;
    /** Top offset */
    offy: number;
    /** Horizontal margin between frames */
    marginx: number;
    /** Vertical margin between frames */
    marginy: number;
    /** Pivot point [x, y] as fraction of frame (0–1) */
    axis: [number, number];
    /** Padding added around the sprite in the atlas */
    padding: number;
    /** Collision shape */
    shape: CollisionShape;
    /** Frame index for collision preview */
    frame: number;
}

export function defaultTexture(uid: string, name: string): NyxTexture {
    return {
        uid, name, type: 'texture', lastModified: Date.now(),
        origname: '', grid: [1, 1], width: 64, height: 64,
        offx: 0, offy: 0, marginx: 0, marginy: 0,
        axis: [0.5, 0.5], padding: 1, frame: 0,
        shape: { type: 'rect', top: 0, bottom: 64, left: 0, right: 64 }
    };
}

// ─── Template ───────────────────────────────────────────────────────────────

export type { TemplateBaseClass };

export type LightShape = 'soft' | 'circle' | 'point';

export interface NyxTemplateLightConfig {
    /**
     * Opt-in gate: when false this template does NOT spawn a light sprite.
     * Previously every template with a default `shape` value was silently an emitter — that was a bug.
     */
    isEmitter: boolean;
    /** UID of the light texture asset, or null for procedural shape */
    textureUid: string | null;
    shape: LightShape;
    color: string;
    /** Whether light opacity follows copy alpha */
    opacityFollowsCopy: boolean;
    scale: number;

    /** Whether this copy occludes light from other emitters (independent of emitter role) */
    lightBlocker: boolean;

    /** Emits shadow rays from this light source. Only relevant when isEmitter is true. */
    lightCastShadows: boolean;
    lightRadius: number;
    lightType: 'point' | 'spot';
    lightConeAngle: number;
}

export type PhysicsConstraintType = 'none' | 'pin' | 'rope';

export interface NyxTemplatePhysics {
    enabled: boolean;
    density: number;
    /** Bounciness — Matter.js restitution */
    restitution: number;
    friction: number;
    staticFriction: number;
    airFriction: number;
    isStatic: boolean;
    isSensor: boolean;
    /** Pivot point that stays fixed in world space (pin joint to world) */
    fixedPivot: { x: number; y: number };
    /** Collision filter group label (matched at runtime to a numeric mask) */
    collisionGroup: string;
    lockAxisX: boolean;
    lockAxisY: boolean;
    lockRotation: boolean;
    /** Per-body gravity multiplier. 1 = normal, 0 = weightless, 2 = double. */
    gravityScale: number;
    /** Kinematic body: no gravity, no air drag, moves only via script velocity. */
    kinematic: boolean;
    constraint: {
        type: PhysicsConstraintType;
        /** Rope natural length in pixels */
        ropeLength: number;
        /** Constraint stiffness 0–1 */
        stiffness: number;
        /** Constraint damping 0–1 */
        damping: number;
    };
}

export interface NyxTemplate extends NyxAsset {
    type: 'template';
    baseClass: TemplateBaseClass;
    /** UID of the assigned texture, or null for none */
    textureUid: string | null;
    /** Render depth (z-order) */
    depth: number;
    /** Starting animation frame */
    frame: number;
    /** Assigned behavior UIDs */
    behaviors: string[];
    /** Custom fields set in the editor (nyxmod-injected fields) */
    extends: Record<string, unknown>;
    physics: NyxTemplatePhysics;
    light: NyxTemplateLightConfig;
    /**
     * Path to the TypeScript class file, relative to the project root.
     * e.g. "src/templates/Player.ts"
     * Set when the script file is created on disk.
     */
    scriptPath: string;
}

export function defaultTemplate(uid: string, name: string): NyxTemplate {
    return {
        uid, name, type: 'template', lastModified: Date.now(),
        baseClass: 'AnimatedSprite', textureUid: null, depth: 0, frame: 0,
        behaviors: [], extends: {},
        physics: {
            enabled: false, density: 1, restitution: 0.2, friction: 0.3,
            staticFriction: 0.1, airFriction: 0.01,
            isStatic: false, isSensor: false,
            fixedPivot: { x: 0, y: 0 }, collisionGroup: '',
            lockAxisX: false, lockAxisY: false, lockRotation: false,
            gravityScale: 1, kinematic: false,
            constraint: { type: 'none', ropeLength: 64, stiffness: 0.05, damping: 0.05 },
        },
        light: {
            isEmitter: false,
            textureUid: null,
            shape: 'soft',
            color: '#FFFFFF',
            opacityFollowsCopy: true,
            scale: 1,
            lightBlocker: false,
            lightCastShadows: false,
            lightRadius: 100,
            lightType: 'point',
            lightConeAngle: 30,
        },
        scriptPath: '',
    };
}

// ─── Room ────────────────────────────────────────────────────────────────────

export interface NyxCopy {
    uid: string;
    templateUid: string;
    x: number;
    y: number;
    frame?: number;
    depth?: number;
    /** Horizontal scale factor. Default 1. */
    scaleX?: number;
    /** Vertical scale factor. Default 1. */
    scaleY?: number;
    /** Rotation in degrees. Default 0. */
    angle?: number;
    /** Opacity 0–1. Default 1. */
    alpha?: number;
    /** CSS hex tint color. Default #ffffff. */
    tint?: string;
    extends?: Record<string, unknown>;
}

export interface NyxBackground {
    uid: string;
    textureUid: string;
    depth: number;
    x: number;
    y: number;
    parallaxX: number;
    parallaxY: number;
    repeatX: boolean;
    repeatY: boolean;
    movementX: number;
    movementY: number;
}

export interface NyxTile {
    x: number;
    y: number;
    opacity: number;
    tint: number;
    frame: number;
    scale: { x: number; y: number };
    rotation: number;
    /** uid of a NyxTexture asset */
    texture: string;
    physicsOverride?: {
        enabled?: boolean;
        friction?: number;
        restitution?: number;
    };
    // ── Light module fields (all optional; only shown/used when light module is enabled) ──

    /** This specific tile occludes light from other emitters. */
    lightBlocker?: boolean;
    /**
     * This specific tile acts as a light emitter at its world position.
     * When set, overrides the parent layer's lightEmitter setting for this tile.
     * TODO: tile emitter runtime — create a light at this tile's world position in beforeroomoncreate.
     */
    lightEmitter?: boolean;
    /** Procedural shape for this tile's emitted light. Default 'soft'. */
    lightEmitterShape?: LightShape;
    /** CSS hex color for this tile's emitted light. Default '#FFFFFF'. */
    lightEmitterColor?: string;
    /** Scale multiplier for this tile's emitted light. Default 1. */
    lightEmitterScale?: number;
    /** This tile's emitted light casts shadow rays. Only relevant when lightEmitter is true. */
    lightCastShadows?: boolean;
    lightRadius?: number;
    lightType?: 'point' | 'spot';
    lightConeAngle?: number;
}

export interface NyxTileLayer {
    depth: number;
    tiles: NyxTile[];
    extends: Record<string, unknown>;
    hidden?: boolean;
    cache: boolean;
    physicsEnabled?: boolean;
    physicsFriction?: number;
    physicsRestitution?: number;

    // ── Light module fields (all optional; only shown/used when light module is enabled) ──

    /** All tiles in this layer block light from other emitters. */
    lightBlocker?: boolean;

    /**
     * All tiles in this layer act as light emitters.
     * TODO: tile emitter runtime — create lights at each tile's world position in beforeroomoncreate.
     */
    lightEmitter?: boolean;
    /** Procedural shape used when no texture is assigned. Default 'soft'. */
    lightEmitterShape?: LightShape;
    /** CSS hex color for emitted light. Default '#FFFFFF'. */
    lightEmitterColor?: string;
    /** Scale multiplier for emitted lights. Default 1. */
    lightEmitterScale?: number;

    /** Emitted lights cast shadow rays. Only relevant when lightEmitter is true. */
    lightCastShadows?: boolean;
    /** Shadow ray-cast radius in pixels. Default 300. */
    lightRadius?: number;
    /** Light distribution geometry. Default 'point'. */
    lightType?: 'point' | 'spot';
    /** Cone half-angle in degrees; only used when lightType is 'spot'. Default 90. */
    lightConeAngle?: number;
}

// ─── UI Overlay ─────────────────────────────────────────────────────────────

/** Screen anchor for a UI widget. Position x/y is an offset from this point. */
export type NyxUIAnchor =
    | 'topLeft'    | 'topCenter'    | 'topRight'
    | 'middleLeft' | 'center'       | 'middleRight'
    | 'bottomLeft' | 'bottomCenter' | 'bottomRight';

interface NyxUIWidgetBase {
    uid: string;
    name: string;
    anchor: NyxUIAnchor;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Rotation in degrees. Default 0. */
    rotation: number;
    visible: boolean;
    /** Opacity 0–1 */
    alpha: number;
    /** UID of parent widget, or undefined for root-level widgets. */
    parentUid?: string;
    /** Optional drop-shadow. Undefined = no shadow. */
    shadow?: {
        enabled: boolean;
        color: string;    // #RRGGBB or #RRGGBBAA
        blur: number;
        offsetX: number;
        offsetY: number;
    };
}

export interface NyxUILabel extends NyxUIWidgetBase {
    type: 'label';
    text: string;
    fontSize: number;
    color: string;
    fontFamily: string;
    align: 'left' | 'center' | 'right';
    bold: boolean;
    italic: boolean;
}

export interface NyxUIButton extends NyxUIWidgetBase {
    type: 'button';
    text: string;
    fontSize: number;
    textColor: string;
    backgroundColor: string;
    hoverColor: string;
    borderRadius: number;
    fontFamily: string;
}

export interface NyxUIImage extends NyxUIWidgetBase {
    type: 'image';
    /** UID of a NyxTexture, or null */
    textureUid: string | null;
    tint: string;
    keepAspect: boolean;
}

export interface NyxUIPanel extends NyxUIWidgetBase {
    type: 'panel';
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    borderRadius: number;
}

export interface NyxUIProgressBar extends NyxUIWidgetBase {
    type: 'progressbar';
    /** 0.0 – 1.0 */
    value: number;
    fillColor: string;
    backgroundColor: string;
    borderRadius: number;
    direction: 'horizontal' | 'vertical';
}

export type NyxUIWidget = NyxUILabel | NyxUIButton | NyxUIImage | NyxUIPanel | NyxUIProgressBar;
export type NyxUIWidgetType = NyxUIWidget['type'];

// ─── UI Layer ────────────────────────────────────────────────────────────────

/** A reusable, named screen-space UI layout that can be assigned to any room. */
export interface NyxUILayer extends NyxAsset {
    type: 'uiLayer';
    widgets: NyxUIWidget[];
    /**
     * Optional path to a TypeScript UILayer subclass file, relative to the project root.
     * e.g. "src/ui-layers/HUD.ts"
     * Only set when the user adds a script to this layer.
     */
    scriptPath?: string;
}

export function defaultUILayer(uid: string, name: string): NyxUILayer {
    return { uid, name, type: 'uiLayer', lastModified: Date.now(), widgets: [] };
}

export function defaultUIWidget(type: NyxUIWidgetType, uid: string, name: string): NyxUIWidget {
    const base: NyxUIWidgetBase = {
        uid, name, anchor: 'topLeft', x: 100, y: 20,
        width: 200, height: 40, rotation: 0, visible: true, alpha: 1,
    };
    switch (type) {
        case 'label':       return { ...base, type, text: 'Label', fontSize: 16, color: '#ffffff', fontFamily: 'sans-serif', align: 'left', bold: false, italic: false };
        case 'button':      return { ...base, type, text: 'Button', fontSize: 14, textColor: '#ffffff', backgroundColor: '#2d6aff', hoverColor: '#1a50cc', borderRadius: 6, fontFamily: 'sans-serif' };
        case 'image':       return { ...base, type, textureUid: null, tint: '#ffffff', keepAspect: true };
        case 'panel':       return { ...base, type, backgroundColor: '#1a1a2e', borderColor: '#444466', borderWidth: 1, borderRadius: 4 };
        case 'progressbar': return { ...base, type, value: 1.0, fillColor: '#2ecc71', backgroundColor: '#333333', borderRadius: 3, direction: 'horizontal' };
    }
}

// ─── Room ────────────────────────────────────────────────────────────────────

export interface NyxRoom extends NyxAsset {
    type: 'room';
    width: number;
    height: number;
    backgroundColor: string;
    copies: NyxCopy[];
    backgrounds: NyxBackground[];
    tiles: NyxTileLayer[];
    /** UIDs of NyxUILayer assets mounted when this room is active. */
    uiLayerUids: string[];
    isStartingRoom: boolean;
    viewMode: 'asIs' | 'fastScale' | 'fastScaleInteger' | 'expand' | 'scaleFit' | 'scaleFill';
    /** Grid / snapping */
    gridX: number;
    gridY: number;
    diagonalGrid: boolean;
    disableGrid: boolean;
    /** uid of the last tileset texture picked by the user */
    lastPickedTileset?: string;
    /** UIDs of room-scoped behaviors applied to this room */
    behaviors: string[];
    /**
     * Optional path to a TypeScript Room subclass file, relative to the project root.
     * e.g. "src/rooms/Level1.ts"
     * Only set when the user adds room event scripts.
     */
    scriptPath?: string;
    /** Matter.js gravity vector [x, y]. Only used when the matter nyxmod is enabled. Default [0, 9.8]. */
    matterGravity?: [number, number];
    /**
     * Show a light-simulation overlay on the room editor canvas.
     * Only shown / relevant when the `light` nyxmod is enabled in project settings.
     */
    editorLightPreview?: boolean;
    /**
     * Base ambient colour of the light overlay.
     * White (#FFFFFF) = no effect (fully lit); black (#000000) = total darkness where unlit.
     * Passed to `light.ambientColor` in beforeroomoncreate. Defaults to '#FFFFFF'.
     */
    lightAmbientColor?: string;
    /**
     * Overall opacity of the MULTIPLY light overlay sprite (0 = invisible, 1 = full effect).
     * Passed to `light.opacity` in beforeroomoncreate. Defaults to 1.
     * Named `lightAmbientOpacity` to distinguish from the per-copy `lightOpacity` boolean.
     */
    lightAmbientOpacity?: number;
}

export function defaultRoom(uid: string, name: string): NyxRoom {
    return {
        uid, name, type: 'room', lastModified: Date.now(),
        width: 1024, height: 768, backgroundColor: '#000000',
        copies: [], backgrounds: [], tiles: [], uiLayerUids: [],
        isStartingRoom: false, viewMode: 'fastScale',
        gridX: 32, gridY: 32, diagonalGrid: false, disableGrid: false,
        behaviors: [],
    };
}

// ─── Sound ───────────────────────────────────────────────────────────────────

export interface NyxSoundVariant {
    uid: string;
    /** Source filename relative to project assets/sounds/ dir */
    origname: string;
}

export interface NyxSoundEffect {
    enabled: boolean;
    min: number;
    max: number;
}

export interface NyxSound extends NyxAsset {
    type: 'sound';
    preload: boolean;
    variants: NyxSoundVariant[];
    volume: NyxSoundEffect;
    pitch: NyxSoundEffect;
    distortion: NyxSoundEffect;
    reverb: { enabled: boolean; decayMin: number; decayMax: number; reverse: boolean };
}

export function defaultSound(uid: string, name: string): NyxSound {
    return {
        uid, name, type: 'sound', lastModified: Date.now(),
        preload: true, variants: [],
        volume:     { enabled: false, min: 1,    max: 1 },
        pitch:      { enabled: false, min: 1,    max: 1 },
        distortion: { enabled: false, min: 0,    max: 0 },
        reverb:     { enabled: false, decayMin: 2, decayMax: 2, reverse: false }
    };
}

// ─── Font (Typeface) ─────────────────────────────────────────────────────────

export interface NyxFont extends NyxAsset {
    type: 'font';
    /** Source filename relative to project assets/fonts/ dir */
    origname: string;
    /** CSS font-family name */
    family: string;
    weight: number;
    italic: boolean;
    /** Pixel size for the bitmap atlas (if generated) */
    bitmapSize: number;
    /** Glyphs to include in bitmap atlas */
    bitmapCharset: string;
}

export function defaultFont(uid: string, name: string): NyxFont {
    return {
        uid, name, type: 'font', lastModified: Date.now(),
        origname: '', family: name, weight: 400, italic: false,
        bitmapSize: 32, bitmapCharset: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?- '
    };
}

// ─── Style ───────────────────────────────────────────────────────────────────

export interface NyxStyleFont {
    family: string;
    size: number;
    lineHeight: number;
    weight: number;
    italic: boolean;
}

export interface NyxStyleFill {
    type: 'solid' | 'linearGradient';
    color: string;
    /** Gradient stop colors */
    gradientColors?: string[];
}

export interface NyxStyleStroke {
    enabled: boolean;
    color: string;
    width: number;
    lineJoin: 'round' | 'bevel' | 'miter';
}

export interface NyxStyleShadow {
    enabled: boolean;
    color: string;
    blur: number;
    x: number;
    y: number;
}

export interface NyxStyle extends NyxAsset {
    type: 'style';
    font: NyxStyleFont;
    fill: NyxStyleFill;
    stroke: NyxStyleStroke;
    shadow: NyxStyleShadow;
    halign: 'left' | 'center' | 'right';
    valign: 'top' | 'middle' | 'bottom';
    wordWrap: boolean;
    wordWrapWidth: number;
}

export function defaultStyle(uid: string, name: string): NyxStyle {
    return {
        uid, name, type: 'style', lastModified: Date.now(),
        font: { family: 'sans-serif', size: 16, lineHeight: 1.4, weight: 400, italic: false },
        fill: { type: 'solid', color: '#ffffff' },
        stroke: { enabled: false, color: '#000000', width: 2, lineJoin: 'round' },
        shadow: { enabled: false, color: '#000000', blur: 4, x: 2, y: 2 },
        halign: 'left', valign: 'top', wordWrap: false, wordWrapWidth: 300
    };
}

// ─── Behavior ────────────────────────────────────────────────────────────────

export type BehaviorType = 'template' | 'room';

export interface NyxFieldSchema {
    name: string;
    type: 'number' | 'text' | 'boolean' | 'color';
    default: unknown;
}

export interface NyxBehavior extends NyxAsset {
    type: 'behavior';
    behaviorType: BehaviorType;
    specification: NyxFieldSchema[];
    /**
     * Path to the TypeScript Behavior subclass file, relative to the project root.
     * e.g. "src/behaviors/Gravity.ts"
     */
    scriptPath: string;
}

export function defaultBehavior(uid: string, name: string): NyxBehavior {
    return {
        uid, name, type: 'behavior', lastModified: Date.now(),
        behaviorType: 'template', specification: [],
        scriptPath: '',
    };
}

// ─── Script ─────────────────────────────────────────────────────────────────

export interface NyxScript extends NyxAsset {
    type: 'script';
    /**
     * Path to the TypeScript file, relative to the project root.
     * e.g. "src/scripts/helpers.ts"
     */
    scriptPath: string;
}

export function defaultScript(uid: string, name: string): NyxScript {
    return {
        uid, name, type: 'script', lastModified: Date.now(),
        scriptPath: '',
    };
}

// ─── Enum ────────────────────────────────────────────────────────────────────

export interface NyxEnum extends NyxAsset {
    type: 'enum';
    values: string[];
}

export function defaultEnum(uid: string, name: string): NyxEnum {
    return {
        uid, name, type: 'enum', lastModified: Date.now(),
        values: ['Variant1']
    };
}

// ─── Emitter Tandem ──────────────────────────────────────────────────────────

export interface NyxEmitterSettings {
    uid: string;
    name: string;
    textureUid: string | null;
    maxParticles: number;
    spawnRate: number;
    /** Lifetime in seconds */
    lifetimeMin: number;
    lifetimeMax: number;
    /** Speed pixels/s */
    speedMin: number;
    speedMax: number;
    /** Angle in degrees */
    angleMin: number;
    angleMax: number;
    /** Start alpha (0–1) */
    alphaStart: number;
    /** End alpha */
    alphaEnd: number;
    /** Start scale */
    scaleStart: number;
    /** End scale */
    scaleEnd: number;
    /** Start color */
    colorStart: string;
    /** End color */
    colorEnd: string;
    /** Gravity y-component pixels/s² (positive = down) */
    gravity: number;
    /** Gravity x-component pixels/s² (positive = right) */
    gravityX: number;
    /** Initial particle rotation min, degrees */
    rotationMin: number;
    /** Initial particle rotation max, degrees */
    rotationMax: number;
    /** Rotation speed min, degrees/s (negative = CCW) */
    rotationSpeedMin: number;
    /** Rotation speed max, degrees/s */
    rotationSpeedMax: number;
    /** Blend mode for particles */
    blendMode: 'normal' | 'add' | 'multiply' | 'screen';
    /** How texture frames are used when the texture has multiple frames */
    textureBehavior: 'textureRandom' | 'animatedSingle';
    /** Frame rate for animatedSingle mode */
    animatedSingleFramerate: number;
    /** Particles emitted per spawn wave (burst count) */
    particlesPerWave: number;
    /** Probability 0–1 of spawning each wave */
    spawnChance: number;
    /** Total emitter lifetime in seconds; -1 = infinite */
    emitterLifetime: number;
    /** Spawn shape */
    spawnShape: 'point' | 'circle' | 'ring' | 'rect' | 'burst';
    /** Outer radius for circle / ring / burst spawn */
    spawnRadius: number;
    /** Inner radius for ring spawn */
    spawnInnerRadius: number;
    /** Width for rect spawn */
    spawnRectWidth: number;
    /** Height for rect spawn */
    spawnRectHeight: number;
    /** Spawn-point offset X from the emitter origin */
    spawnOffsetX: number;
    /** Spawn-point offset Y from the emitter origin */
    spawnOffsetY: number;
    /** Frame index (0-based) used when textureBehavior === 'singleFrame' */
    textureFrame: number;
}

export interface NyxEmitterTandem extends NyxAsset {
    type: 'emitterTandem';
    emitters: NyxEmitterSettings[];
    isUi: boolean;
}

export function defaultEmitter(uid: string): NyxEmitterSettings {
    return {
        uid, name: 'Emitter', textureUid: null,
        maxParticles: 100, spawnRate: 10,
        lifetimeMin: 1, lifetimeMax: 2,
        speedMin: 50, speedMax: 150,
        angleMin: 0, angleMax: 360,
        alphaStart: 1, alphaEnd: 0,
        scaleStart: 1, scaleEnd: 0.5,
        colorStart: '#ffffff', colorEnd: '#888888',
        gravity: 0, gravityX: 0,
        rotationMin: 0, rotationMax: 0,
        rotationSpeedMin: 0, rotationSpeedMax: 0,
        blendMode: 'normal',
        textureBehavior: 'textureRandom', animatedSingleFramerate: 10,
        particlesPerWave: 1, spawnChance: 1, emitterLifetime: -1,
        spawnShape: 'point', spawnRadius: 50, spawnInnerRadius: 0,
        spawnRectWidth: 100, spawnRectHeight: 100,
        spawnOffsetX: 0, spawnOffsetY: 0,
        textureFrame: 0
    };
}

export function defaultEmitterTandem(uid: string, name: string): NyxEmitterTandem {
    return {
        uid, name, type: 'emitterTandem', lastModified: Date.now(),
        emitters: [defaultEmitter(crypto.randomUUID())],
        isUi: false
    };
}

// ─── Discriminated union & helpers ──────────────────────────────────────────

export type AnyNyxAsset =
    | NyxTexture | NyxTemplate | NyxRoom | NyxSound | NyxFont
    | NyxStyle | NyxBehavior | NyxScript | NyxEnum | NyxEmitterTandem | NyxUILayer;

/**
 * A folder in the project asset tree.
 * Contains mixed sub-folders and assets.
 */
export interface NyxFolder {
    uid: string;
    name: string;
    type: 'folder';
    colorClass?: string;
    entries: NyxProjectEntry[];
}

/** A discriminated union for anything that can appear in the asset tree. */
export type NyxProjectEntry = AnyNyxAsset | NyxFolder;
