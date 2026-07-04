import {required, default as uLib} from './u';
import type {TextureShape, ExportedTiledTexture, ExportedFolder, ExportedAsset} from '@nyx/shared';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type {sound as pixiSound, Sound, Options as SoundOptions} from '@pixi/sound';
import {pixiSoundPrefix, exportedSounds, soundMap, pixiSoundInstances} from './sounds.js';

type AssetType = 'template' | 'room' | 'sound' | 'style' | 'texture' | 'tandem' | 'font' | 'behavior' | 'script';

import * as pixiMod from 'pixi.js';
import {settings} from './index';
declare var PIXI: typeof pixiMod & {
    sound: typeof pixiSound
};

export type CtjsTexture = pixiMod.Texture & {
    shape: TextureShape,
    hitArea: pixiMod.Polygon | pixiMod.Circle | pixiMod.Rectangle;
    defaultAnchor: {
        x: number,
        y: number
    }
};
export type CtjsAnimation = CtjsTexture[] & {
    shape: TextureShape,
    hitArea: pixiMod.Polygon | pixiMod.Circle | pixiMod.Rectangle;
    defaultAnchor: {
        x: number,
        y: number
    }
};

export interface ITextureOptions {
    anchor?: { x: number; y: number };
    shape?: TextureShape;
    grid?: [number, number];
    frameWidth?: number;
    frameHeight?: number;
    offx?: number;
    offy?: number;
    marginx?: number;
    marginy?: number;
}

const loadingScreen = document.querySelector('.ct-aLoadingScreen') as HTMLDivElement,
      loadingBar = loadingScreen.querySelector('.ct-aLoadingBar') as HTMLDivElement;

export const textures: Record<string, CtjsAnimation> = {};
export const skeletons: Record<string, any> = {};

const normalizeAssetPath = (path: string): string[] => {
    path = path.replace(/\\/g, '/');
    if (path[0] === '/') {
        path = path.slice(1);
    }
    return path.split('/').filter(empty => empty);
};
const getEntriesByPath = (nPath: string[]): (ExportedAsset | ExportedFolder)[] => {
    if (!resLib.tree) {
        throw new Error('[res] Asset tree was not exported; check your project\'s export settings.');
    }
    let current = resLib.tree;
    for (const subpath of nPath) {
        const folder = current.find(i => i.name === subpath && i.type === 'folder');
        if (!folder) {
            throw new Error(`[res] Could not find folder ${subpath} in path ${nPath.join('/')}`);
        }
        current = (folder as ExportedFolder).entries;
    }
    return current;
};

/**
 * An object that manages and stores textures and other assets,
 * also exposing API for dynamic asset loading.
 */
const resLib = {
    sounds: soundMap,
    pixiSounds: pixiSoundInstances,
    textures: {} as Record<string, CtjsAnimation>,
    tree: [/*!@assetTree@*/][0] as (ExportedFolder | ExportedAsset)[] | false,
    /**
     * Loads and executes a script by its URL
     * @param {string} url The URL of the script file, with its extension.
     * Can be relative or absolute.
     * @returns {Promise<void>}
     * @async
     */
    loadScript(url: string = required('url', 'res.loadScript')): Promise<void> {
        var script = document.createElement('script');
        script.src = url;
        const promise = new Promise<void>((resolve, reject) => {
            script.onload = () => {
                resolve();
            };
            script.onerror = () => {
                reject();
            };
        });
        document.getElementsByTagName('head')[0].appendChild(script);
        return promise;
    },
    /**
     * Loads an individual image as a named Nyx texture.
     * @param {string|boolean} url The path to the source image.
     * @param {string} name The name of the resulting Nyx texture
     * as it will be used in your code.
     * @param {ITextureOptions} textureOptions Information about texture's axis
     * and collision shape.
     * @returns {Promise<CtjsAnimation>} The imported animation, ready to be used.
     */
    async loadTexture(
        url: string = required('url', 'res.loadTexture'),
        name: string = required('name', 'res.loadTexture'),
        textureOptions: ITextureOptions = {}
    ): Promise<CtjsAnimation> {
        let base: pixiMod.Texture;
        try {
            base = await PIXI.Assets.load(url);
        } catch (e) {
            console.error(`[res] Could not load image ${url}`);
            throw e;
        }

        const shape  = textureOptions.shape  || ({} as TextureShape);
        const anchor = textureOptions.anchor || { x: 0, y: 0 };
        const defaultAnchorPt = new PIXI.Point(anchor.x, anchor.y);

        const [cols, rows] = textureOptions.grid ?? [1, 1];
        const frameW  = textureOptions.frameWidth  ?? (base.width  / cols);
        const frameH  = textureOptions.frameHeight ?? (base.height / rows);
        const offx    = textureOptions.offx    ?? 0;
        const offy    = textureOptions.offy    ?? 0;
        const marginx = textureOptions.marginx ?? 0;
        const marginy = textureOptions.marginy ?? 0;

        const frames: CtjsTexture[] = [];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = offx + col * (frameW + marginx);
                const y = offy + row * (frameH + marginy);
                const frame = new PIXI.Texture(
                    base.baseTexture as pixiMod.BaseTexture,
                    new PIXI.Rectangle(x, y, frameW, frameH)
                ) as CtjsTexture;
                frame.shape = shape;
                frame.defaultAnchor = defaultAnchorPt;
                frames.push(frame);
            }
        }

        const ctTexture = frames as unknown as CtjsAnimation;
        ctTexture.shape = shape;
        ctTexture.defaultAnchor = defaultAnchorPt;
        const hitArea = uLib.getHitArea(shape);
        if (hitArea) {
            ctTexture.hitArea = hitArea;
            for (const frame of frames) {
                frame.hitArea = hitArea;
            }
        }
        resLib.textures[name] = ctTexture;
        // Register the full base texture under the texture name so PIXI.Sprite.from(name)
        // works and shows the complete source image (PIXI caches by URL, not by name).
        PIXI.Texture.addToCache(base, name);
        return ctTexture;
    },
    /**
     * Loads a Texture Packer compatible .json file with its source image,
     * adding Nyx textures to the game.
     * @param {string} url The path to the JSON file that describes the atlas' textures.
     * @returns A promise that resolves into an array
     * of all the loaded textures' names.
     */
    async loadAtlas(url: string = required('url', 'res.loadAtlas')): Promise<string[]> {
        const sheet = await PIXI.Assets.load<pixiMod.Spritesheet>(url);
        for (const animation in sheet.animations) {
            const tex = sheet.animations[animation];
            const animData = sheet.data.animations as pixiMod.utils.Dict<string[]>;
            for (let i = 0, l = animData[animation].length; i < l; i++) {
                const a = animData[animation],
                      f = a[i];
                (tex[i] as CtjsTexture).shape = (
                    sheet.data.frames[f] as pixiMod.ISpritesheetFrameData & {shape: TextureShape}
                ).shape;
            }
            (tex as CtjsAnimation).shape = (tex[0] as CtjsTexture).shape || ({} as TextureShape);
            resLib.textures[animation] = tex as CtjsAnimation;
            // Register frame 0 under the texture name so PIXI.Sprite.from(name) works
            // (e.g. for UI image widgets). Mirrors the addToCache call in loadTexture().
            if (tex.length > 0) {
                PIXI.Texture.addToCache(tex[0], animation);
            }
            const hitArea = uLib.getHitArea(resLib.textures[animation].shape);
            if (hitArea) {
                resLib.textures[animation].hitArea = hitArea;
                for (const frame of resLib.textures[animation]) {
                    frame.hitArea = hitArea;
                }
            }
            // Apply pivot/anchor from atlas frame data (Nyx extended format).
            const firstFrameKey = animData[animation]?.[0];
            if (firstFrameKey) {
                const frameExtra = sheet.data.frames[firstFrameKey] as pixiMod.ISpritesheetFrameData & { pivot?: { x: number; y: number } };
                if (frameExtra.pivot) {
                    const anchorPt = new PIXI.Point(frameExtra.pivot.x, frameExtra.pivot.y);
                    (resLib.textures[animation] as CtjsAnimation).defaultAnchor = anchorPt;
                    for (const frame of resLib.textures[animation]) {
                        (frame as CtjsTexture).defaultAnchor = anchorPt;
                    }
                }
            }
        }
        return Object.keys(sheet.animations);
    },
    /**
     * Unloads the specified atlas by its URL and removes all the textures
     * it has introduced to the game.
     * Will do nothing if the specified atlas was not loaded (or was already unloaded).
     */
    async unloadAtlas(url: string = required('url', 'res.unloadAtlas')): Promise<void> {
        const {animations} = PIXI.Assets.get(url);
        if (!animations) {
            // eslint-disable-next-line no-console
            console.log(`[res] Attempt to unload an atlas that was not loaded/was unloaded already: ${url}`);
            return;
        }
        for (const animation of animations) {
            delete resLib.textures[animation];
        }
        await PIXI.Assets.unload(url);
    },
    /**
     * Loads a bitmap font by its XML file.
     * @param url The path to the XML file that describes the bitmap fonts.
     * @returns A promise that resolves into the font's name (the one you've passed with `name`).
     */
    async loadBitmapFont(url: string = required('url', 'res.loadBitmapFont')): Promise<void> {
        await PIXI.Assets.load(url);
    },
    async unloadBitmapFont(url: string = required('url', 'res.unloadBitmapFont')): Promise<void> {
        await PIXI.Assets.unload(url);
    },
    /**
     * Loads a sound.
     * @param path Path to the sound
     * @param name The name of the sound as it will be used in a Nyx game.
     * @param preload Whether to start loading now or postpone it.
     * Postponed sounds will load when a game tries to play them, or when you manually
     * trigger the download with `sounds.load(name)`.
     * @returns A promise with the name of the imported sound.
     */
    loadSound(
        path: string = required('path', 'res.loadSound'),
        name: string = required('name', 'res.loadSound'),
        preload = true
    ): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const opts: SoundOptions = {
                url: path,
                preload
            };
            if (preload) {
                opts.loaded = (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resLib.pixiSounds[name] = asset;
                        resolve(name);
                    }
                };
            }
            const asset = PIXI.sound.add(name, opts);
            if (!preload) {
                resolve(name);
            }
        });
    },

    async loadGame(): Promise<void> {
        // !! This method is intended to be filled by Nyx Studio and be executed
        // exactly once at game startup.
        const changeProgress = (percents: number) => {
            loadingScreen.setAttribute('data-progress', String(percents));
            loadingBar.style.width = percents + '%';
        };

        /* eslint-disable prefer-destructuring */
        let atlases: string[] = [/*!@atlases@*/][0];
        let bitmapFonts: string[] = [/*!@bitmapFonts@*/][0];
        const tiledImages: Record<string, ExportedTiledTexture> = [/*!@tiledImages@*/][0];
        /* eslint-enable prefer-destructuring */

        // Workaround for NW.js randomly caching files coming from filesystem
        // Fixes https://github.com/ct-js/ct-js/issues/94
        if (settings.isDebug) {
            atlases = atlases.map(atlas => atlas + '?q=' + Date.now());
            bitmapFonts = bitmapFonts.map(font => font + '?q=' + Date.now());
            for (const name in tiledImages) {
                tiledImages[name].source += '?q=' + Date.now();
            }
            for (const sound of exportedSounds) {
                for (const variant of sound.variants) {
                    variant.source += '?q=' + Date.now();
                }
            }
        }

        const totalAssets = atlases.length;
        let assetsLoaded = 0;
        const loadingPromises: Promise<unknown>[] = [];

        loadingPromises.push(...atlases.map(atlas =>
            resLib.loadAtlas(atlas)
            .then(texturesNames => {
                assetsLoaded++;
                changeProgress(assetsLoaded / totalAssets * 100);
                return texturesNames;
            })));

        for (const name in tiledImages) {
            const ti = tiledImages[name];
            loadingPromises.push(resLib.loadTexture(
                ti.source,
                name,
                {
                    anchor:      ti.anchor,
                    shape:       ti.shape,
                    grid:        ti.grid,
                    frameWidth:  ti.frameWidth,
                    frameHeight: ti.frameHeight,
                    offx:        ti.offx,
                    offy:        ti.offy,
                    marginx:     ti.marginx,
                    marginy:     ti.marginy,
                }
            ));
        }
        for (const font in bitmapFonts) {
            loadingPromises.push(resLib.loadBitmapFont(bitmapFonts[font]));
        }
        for (const sound of exportedSounds) {
            for (const variant of sound.variants) {
                loadingPromises.push(resLib.loadSound(
                    variant.source,
                    `${pixiSoundPrefix}${variant.uid}`,
                    sound.preload
                ));
            }
        }

        /*!@res@*/
        /*!%res%*/

        await Promise.all(loadingPromises);
        loadingScreen.classList.add('hidden');
    },
    /**
     * Gets a pixi.js texture from a Nyx texture name,
     * so that it can be used in pixi.js objects.
     * @param name The name of the Nyx texture, or -1 for an empty texture
     * @catnipAsset name:texture
     * @param [frame] The frame to extract
     * @returns {PIXI.Texture|PIXI.Texture[]} If `frame` was specified,
     * returns a single PIXI.Texture. Otherwise, returns an array
     * with all the frames of this Nyx texture.
     */
    getTexture: ((
        name: string | -1,
        frame?: number
    ): CtjsAnimation | CtjsTexture | pixiMod.Texture | pixiMod.Texture[] => {
        if (frame === null) {
            frame = void 0;
        }
        if (name === -1) {
            if (frame !== void 0) {
                return PIXI.Texture.EMPTY;
            }
            return [PIXI.Texture.EMPTY];
        }
        if (!(name in resLib.textures)) {
            throw new Error(`Attempt to get a non-existent texture ${name}`);
        }
        const tex = resLib.textures[name];
        if (frame !== void 0) {
            return tex[frame];
        }
        return tex;
    }) as {
        (name: -1): [pixiMod.Texture];
        (name: -1, frame: 0): typeof PIXI.Texture.EMPTY;
        (name: -1, frame: number): never;
        (name: string): CtjsAnimation;
        (name: string, frame: number): CtjsTexture;
    },
    /**
     * Returns the collision shape of the given texture.
     * @param name The name of the Nyx texture, or -1 for an empty collision shape
     * @catnipAsset name:texture
     */
    getTextureShape(name: string | -1): TextureShape {
        if (name === -1) {
            return {
                type: 'point'
            };
        }
        if (!(name in resLib.textures)) {
            throw new Error(`Attempt to get a shape of a non-existent texture ${name}`);
        }
        return resLib.textures[name].shape;
    },
    /**
     * Gets direct children of a folder
     * @catnipIcon folder
     */
    getChildren(path?: string): ExportedAsset[] {
        return getEntriesByPath(normalizeAssetPath(path || ''))
            .filter(entry => entry.type !== 'folder') as ExportedAsset[];
    },
    /**
     * Gets direct children of a folder, filtered by asset type
     * @catnipIcon folder
     */
    getOfType(type: AssetType | 'folder', path?: string): (ExportedAsset | ExportedFolder)[] {
        return getEntriesByPath(normalizeAssetPath(path || ''))
            .filter(entry => entry.type === type);
    },
    /**
     * Gets all the assets inside of a folder, including in subfolders.
     * @catnipIcon folder
     */
    getAll(path?: string): ExportedAsset[] {
        const folderEntries = getEntriesByPath(normalizeAssetPath(path || '')),
              entries: ExportedAsset[] = [];
        const walker = (currentList: (ExportedFolder | ExportedAsset)[]) => {
            for (const entry of currentList) {
                if (entry.type === 'folder') {
                    walker(entry.entries);
                } else {
                    entries.push(entry);
                }
            }
        };
        walker(folderEntries);
        return entries;
    },
    /**
     * Get all the assets inside of a folder, including in subfolders, filtered by type.
     * @catnipIcon folder
     */
    getAllOfType(type: AssetType | 'folder', path?: string): (ExportedAsset | ExportedFolder)[] {
        const folderEntries = getEntriesByPath(normalizeAssetPath(path || '')),
              entries: (ExportedAsset | ExportedFolder)[] = [];
        const walker = (currentList: (ExportedFolder | ExportedAsset)[]) => {
            for (const entry of currentList) {
                if (entry.type === 'folder') {
                    walker(entry.entries);
                }
                // No `else` to allow querying for all subfolders
                if (entry.type === type) {
                    entries.push(entry);
                }
            }
        };
        walker(folderEntries);
        return entries;
    }
};


/*!@fonts@*/

export default resLib;
