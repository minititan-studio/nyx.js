/**
 * @nyx/shared — shared types and utilities used across all packages.
 */

export type {
    NyxProject,
    NyxProjectAuthoring, NyxProjectRendering, NyxProjectBranding, NyxProjectExport, NyxProjectSettings,
    NyxProjectAction, NyxProjectActionMethod,
    NyxProjectVariable,
    NyxPhysicsGroup,
    IFieldSchema, IContentType, FieldSchemaType, FieldSchemaStructure,
} from './types/project.js';
export type {
    NyxAsset, AssetType, NyxFolder, NyxProjectEntry, AnyNyxAsset,
    NyxTexture, NyxTemplate, NyxRoom, NyxSound, NyxFont, NyxStyle,
    NyxBehavior, NyxScript, NyxEnum, NyxEmitterTandem,
    CollisionShape, BehaviorType,
    NyxFieldSchema, NyxCopy, NyxBackground, NyxTile, NyxTileLayer, NyxSoundVariant, NyxSoundEffect,
    NyxStyleFont, NyxStyleFill, NyxStyleStroke, NyxStyleShadow,
    NyxTemplatePhysics, NyxTemplateLightConfig, LightShape, NyxEmitterSettings,
    NyxUIWidget, NyxUIWidgetType, NyxUIAnchor,
    NyxUILabel, NyxUIButton, NyxUIImage, NyxUIPanel, NyxUIProgressBar,
    NyxUILayer,
} from './types/assets.js';
export type {
    EventDef, EventArgDef, EventApplicable,
} from './events.js';
export {
    CORE_EVENTS, EVENT_CATEGORIES,
    getEventDef, getEventDisplayName, buildMethodStub, buildMethodBodySnippet,
} from './events.js';
export {
    defaultTexture, defaultTemplate, defaultRoom, defaultSound,
    defaultFont, defaultStyle, defaultBehavior, defaultScript,
    defaultEnum, defaultEmitterTandem, defaultEmitter,
    defaultUIWidget, defaultUILayer,
} from './types/assets.js';
export {
    anchorFracX,
    anchorFracY,
    anchorBasePixels,
} from './uiAnchor.js';
export type {
    UIHierarchyDiagnostic,
    UIHierarchyResult,
} from './uiHierarchy.js';
export {
    validateUIHierarchy,
    getDescendants,
} from './uiHierarchy.js';
export {
    hotkeys,
    hotkeyStore,
} from './hotkeys.js';
export type {
    HotkeyHandler,
    HotkeyBinding,
    HotkeyStoreState,
} from './hotkeys.js';

export {
    tooltip,
    activeTooltip,
    mountTooltipManager,
    unmountTooltipManager,
    registerTooltipElement,
} from './tooltips.js';
export type {
    TooltipState,
    TooltipActionParam,
} from './tooltips.js';

export type {
    ResourceType,
    viewMode,
    TextureShape,
    TextureShapeRect,
    TextureShapeCircle,
    TextureShapePolyline,
    TextureShapePoint,
    ExportedTiledTexture,
    NineSliceSettings,
    TemplateBaseClass,
    BaseClass,
    FieldType,
    ExportedTemplate,
    ExportedCopy,
    ExportedBg,
    ExportedTile,
    ExportedTilemap,
    ExportedRoom,
    ExportedSound,
    ExportedBehavior,
    ExportedBehaviorDynamic,
    ExportedEmitter,
    ExportedTandem,
    ExportedTandems,
    ExportedMeta,
    ExportedStyle,
    ExportedSkeleton,
    ExportedAsset,
    ExportedFolder,
    AtlasFrameMeta,
} from './types/exporterContracts.js';
