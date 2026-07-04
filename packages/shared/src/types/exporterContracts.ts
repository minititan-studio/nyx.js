/**
 * Exporter Contracts — shared between the Nyx runtime and the editor exporter.
 * Ported from legacy src/node_requires/exporter/_exporterContracts.ts.
 * All legacy IDE interface references are inlined here so neither runtime
 * nor editor needs to import the other's types.
 */
import type * as PIXI from 'pixi.js';
import type { NyxUIWidget } from './assets.js';

// ─── Primitive types ────────────────────────────────────────────────────────

export type ResourceType =
    | 'template' | 'room' | 'sound' | 'style'
    | 'texture' | 'tandem' | 'typeface' | 'behavior' | 'script' | 'enum';

export type viewMode = 'asIs' | 'fastScale' | 'fastScaleInteger' | 'expand' | 'scaleFit' | 'scaleFill';

// ─── Texture shapes ─────────────────────────────────────────────────────────

export type TextureShapeRect     = { type: 'rect';   top: number; bottom: number; left: number; right: number; };
export type TextureShapeCircle   = { type: 'circle'; r: number; };
export type TextureShapePolyline = { type: 'strip';  points: { x: number; y: number }[]; closedStrip: boolean; };
export type TextureShapePoint    = { type: 'point'; };
export type TextureShape = TextureShapeRect | TextureShapeCircle | TextureShapePolyline | TextureShapePoint;

export type ExportedTiledTexture = {
    source: string;
    shape: TextureShape;
    anchor: { x: number; y: number };
    grid: [number, number];
    frameWidth: number;
    frameHeight: number;
    offx: number;
    offy: number;
    marginx: number;
    marginy: number;
};

/** Extended Texture Packer frame entry used in atlas JSONs. */
export interface AtlasFrameMeta {
    frame: { x: number; y: number; w: number; h: number };
    rotated: false;
    trimmed: false;
    spriteSourceSize: { x: number; y: number; w: number; h: number };
    sourceSize: { w: number; h: number };
    pivot: { x: number; y: number };
    shape: TextureShape;
}

// ─── Templates ──────────────────────────────────────────────────────────────

export type NineSliceSettings = {
    top: number; bottom: number; left: number; right: number;
    autoUpdate: boolean;
};

/** @deprecated Alias for TemplateBaseClass — use TemplateBaseClass instead */
export type BaseClass = TemplateBaseClass;

export type TemplateBaseClass =
    | 'AnimatedSprite' | 'Text' | 'BitmapText' | 'NineSlicePlane'
    | 'Container' | 'Button' | 'RepeatingTexture' | 'SpritedCounter'
    | 'TextBox' | 'ScrollBox';

export type FieldType = 'text' | 'email' | 'number' | 'password' | 'tel' | 'url';

export type ExportedTemplate = {
    name: string;
    anchorX?: number;
    anchorY?: number;
    height?: number;
    width?: number;
    depth: number;
    blendMode: PIXI.BLEND_MODES;
    visible: boolean;
    behaviors: string[];
    onStep: () => void;
    onDraw: () => void;
    onDestroy: () => void;
    onCreate: () => void;
    extends: Record<string, unknown>;
} & ({
    baseClass: 'AnimatedSprite';
    animationFPS: number;
    playAnimationOnStart: boolean;
    loopAnimation: boolean;
    texture?: string;
} | {
    baseClass: 'Text' | 'BitmapText';
    textStyle: string | -1;
    defaultText: string;
} | {
    baseClass: 'NineSlicePlane';
    nineSliceSettings: NineSliceSettings;
    texture: string;
} | {
    baseClass: 'Container';
} | {
    baseClass: 'Button';
    nineSliceSettings: NineSliceSettings;
    texture: string;
    hoverTexture?: string;
    pressedTexture?: string;
    disabledTexture?: string;
    textStyle: string | -1;
    defaultText: string;
    useBitmapText: boolean;
} | {
    baseClass: 'RepeatingTexture';
    scrollX: number;
    scrollY: number;
    isUi: boolean;
    texture: string;
    pixelPerfect: boolean;
} | {
    baseClass: 'SpritedCounter';
    spriteCount: number;
    texture: string;
} | {
    baseClass: 'TextBox';
    nineSliceSettings: NineSliceSettings;
    texture: string;
    hoverTexture?: string;
    pressedTexture?: string;
    disabledTexture?: string;
    selectionColor?: string;
    textStyle: string | -1;
    defaultText: string;
    fieldType: FieldType;
    maxTextLength: number;
    useBitmapText: boolean;
} | {
    baseClass: 'ScrollBox';
    nineSliceSettings: NineSliceSettings;
    texture: string;
});

// ─── Rooms ───────────────────────────────────────────────────────────────────

type CopyAlignment = 'start' | 'center' | 'end' | 'scale' | 'both';

export type ExportedCopy = {
    /** Template name (resolved from UID at export time) */
    template: string;
    x: number;
    y: number;
    scale: { x: number; y: number };
    rotation?: number;
    tint?: number;
    opacity?: number;
    customText?: string;
    customAnchor?: { x: number; y: number };
    customSize?: string;
    customWordWrap?: string;
    align?: {
        frame: { x1: number; y1: number; x2: number; y2: number };
        alignX: CopyAlignment;
        alignY: CopyAlignment;
        padding: { left: number; top: number; right: number; bottom: number };
    };
    /** @deprecated use customProperties */
    exts: Record<string, unknown>;
    customProperties: Record<string, unknown>;
};

export type ExportedBg = {
    texture: string;
    depth: number;
    exts: {
        movementX: number; movementY: number;
        parallaxX: number; parallaxY: number;
        repeat: 'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y';
        scaleX: number; scaleY: number;
        shiftX: number; shiftY: number;
    };
};

export type ExportedTile = {
    texture: string; frame: number;
    x: number; y: number; width: number; height: number;
    opacity: number; rotation: number;
    scale: { x: number; y: number };
    tint: number;
};

export type ExportedTilemap = {
    depth: number;
    tiles: ExportedTile[];
    cache: boolean;
    extends: { cgroup?: string } & Record<string, unknown>;
};

export type ExportedRoom = {
    name: string;
    width: number;
    height: number;
    objects: ExportedCopy[];
    bgs: ExportedBg[];
    tiles: ExportedTilemap[];
    backgroundColor: string;
    behaviors: string[];
    ui?: NyxUIWidget[];
    /** Names of UILayer assets whose scripts should be instantiated when this room mounts. */
    uiLayerNames?: string[];
    cameraConstraints?: { x1: number; y1: number; x2: number; y2: number };
    onStep: () => void;
    onDraw: () => void;
    onLeave: () => void;
    onCreate: () => void;
    isUi: boolean;
    follow: -1 | string;
    extends: Record<string, unknown>;
    bindings: Record<number, () => void>;
};

// ─── Sounds ──────────────────────────────────────────────────────────────────

type SoundRandomized = { min: number; max: number };

export type ExportedSound = {
    uid: string;
    name: string;
    variants: { uid: string; source: string }[];
    preload: boolean;
    panning?: { refDistance: number; rolloffFactor: number };
    volume?: SoundRandomized & { enabled: boolean };
    pitch?:  SoundRandomized & { enabled: boolean };
    distortion?: SoundRandomized & { enabled: boolean };
    reverb?: {
        enabled: boolean;
        secondsMin: number; secondsMax: number;
        decayMin: number; decayMax: number;
        reverse: boolean;
    };
    eq?: {
        enabled: boolean;
        bands: [
            SoundRandomized, SoundRandomized, SoundRandomized, SoundRandomized,
            SoundRandomized, SoundRandomized, SoundRandomized, SoundRandomized,
            SoundRandomized, SoundRandomized
        ];
    };
};

// ─── Behaviors ───────────────────────────────────────────────────────────────

export type ExportedBehaviorDynamic = {
    thisOnStep?: () => void;
    thisOnCreate?: () => void;
    thisOnDraw?: () => void;
    thisOnDestroy?: () => void;
    thisOnAdded?: () => void;
    thisOnRemoved?: () => void;
};
export type ExportedBehavior = 'static' | ExportedBehaviorDynamic;

// ─── Emitters ────────────────────────────────────────────────────────────────

export type ExportedEmitter = {
    texture: string;
    textureBehavior: 'singleFrame' | 'animatedRandom' | 'animatedSequential' | 'textureRandom';
    animatedSingleFramerate: number;
    settings: {
        delay: number;
        behaviors: { type: string; config: Record<string, unknown> }[];
        [key: string]: unknown;
    };
};
export type ExportedTandem = ExportedEmitter[];
export type ExportedTandems = Record<string, ExportedTandem>;

// ─── Misc ────────────────────────────────────────────────────────────────────

export type ExportedMeta = {
    name: string;
    author: string;
    site: string;
    version: string;
};

export type ExportedStyle = {
    align: 'left' | 'center' | 'right';
    fontFamily: string;
    fontSize: number;
    fontStyle: 'normal' | 'italic';
    fontWeight: '100'|'200'|'300'|'400'|'500'|'600'|'700'|'800'|'900'|'normal'|'bold'|'bolder'|'lighter';
    lineJoin: 'round';
    lineHeight: number;
    wordWrap?: boolean;
    wordWrapWidth?: number;
    fill?: string | string[];
    fillGradientType?: 0 | 1;
    stroke?: string;
    strokeThickness?: number;
    dropShadow?: boolean;
    dropShadowColor?: string;
    dropShadowBlur?: number;
    dropShadowAngle?: number;
    dropShadowDistance?: number;
};

export type ExportedSkeleton = {
    name: string;
    dataPath: string;
};

export type ExportedAsset = { type: ResourceType; name: string };
export type ExportedFolder = {
    type: 'folder';
    name: string;
    entries: (ExportedAsset | ExportedFolder)[];
};
