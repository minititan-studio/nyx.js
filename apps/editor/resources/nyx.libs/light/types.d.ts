type LightShape = 'soft' | 'circle' | 'point';

interface LightSpriteOptions {
    tint?: number;
    scaleFactor?: number;
    rotationFactor?: number;
    copyOpacity?: boolean;
    alpha?: number;
    angle?: number;
}

interface LightSprite extends PIXI.Sprite {
    /** The copy this light tracks, if any. */
    owner?: Copy;
    /** Multiplied against the owner's world scale each frame. */
    scaleFactor?: number;
    /** Subtracted from the owner's world angle each frame. */
    rotationFactor?: number;
    /** When true, mirrors the owner's alpha. */
    copyOpacity?: boolean;
}

declare const light: {
    /**
     * Adds a new light sprite to the light layer.
     * @param texture The PIXI texture to use for the light.
     * @param x World X position.
     * @param y World Y position.
     * @param options Optional properties applied to the sprite.
     * @returns The created LightSprite.
     */
    add(texture: PIXI.Texture, x: number, y: number, options?: LightSpriteOptions): LightSprite;

    /**
     * Removes a light sprite from the scene and destroys it.
     * Pass either a LightSprite or a copy that owns one.
     */
    remove(copyOrLight: Copy | LightSprite): void;

    /** All active light sprites. */
    lights: LightSprite[];

    /** Cached procedural textures, keyed by shape name. */
    defaultTextures: Partial<Record<LightShape, PIXI.Texture>>;

    /**
     * Returns (or creates) a procedural light texture for the given shape.
     */
    getDefaultTexture(shape: LightShape): PIXI.Texture;

    /** Re-renders the light layer into its render texture. */
    render(): void;

    /** Syncs a single light sprite to its owner's world transform. */
    updateOne(l: LightSprite): void;

    /** Syncs all active light sprites to their owners. */
    update(): void;

    /** Removes all children from the light layer without destroying them. */
    clear(): void;

    /** Ambient fill color as a PIXI hex tint (e.g. 0xRRGGBB). */
    ambientColor: number;

    /** Opacity of the composite light layer (0–1). */
    opacity: number;

    /** Called once per room to install the light layer into the stage. */
    install(): void;
};
