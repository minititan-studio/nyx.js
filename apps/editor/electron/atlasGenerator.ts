import sharp from 'sharp';
import path from 'path';
import type { NyxTexture } from '@nyx/shared';
import type { TextureShape, AtlasFrameMeta } from '@nyx/shared';

const MAX_ATLAS_SIZE = 4096;
const PADDING = 2;

interface FrameEntry {
    textureName: string;
    frameIndex: number;
    width: number;
    height: number;
    buffer: Buffer;
    pivot: { x: number; y: number };
    shape: TextureShape;
}

interface PackedSlot extends FrameEntry {
    atlasIndex: number;
    x: number;
    y: number;
}

export interface AtlasPackResult {
    atlasFiles: { name: string; buffer: Buffer }[];
    jsonFiles: { name: string; json: string }[];
    /** Names of textures successfully packed (used to skip them in copyAssets). */
    packedTextureNames: Set<string>;
}

export async function packAtlases(
    textures: NyxTexture[],
    projectDir: string
): Promise<AtlasPackResult> {
    // ── Phase 1: Extract frames from source PNGs ──────────────────────────────
    const frames: FrameEntry[] = [];
    const packableNames = new Set<string>();

    for (const tex of textures) {
        if (!tex.origname) continue;
        const srcPath = path.join(projectDir, 'img', tex.origname);
        const [cols, rows] = tex.grid ?? [1, 1];
        const frameW = tex.width;
        const frameH = tex.height;
        if (frameW <= 0 || frameH <= 0) continue;

        const offx    = tex.offx    ?? 0;
        const offy    = tex.offy    ?? 0;
        const marginx = tex.marginx ?? 0;
        const marginy = tex.marginy ?? 0;
        const pivot   = { x: tex.axis[0], y: tex.axis[1] };
        // CollisionShape and TextureShape are structurally identical unions.
        const shape   = tex.shape as unknown as TextureShape
                     ?? ({ type: 'rect', top: 0, left: 0, right: frameW, bottom: frameH } as TextureShape);

        let allFramesOk = true;
        const texFrames: FrameEntry[] = [];

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const left = Math.round(offx + col * (frameW + marginx));
                const top  = Math.round(offy + row * (frameH + marginy));
                try {
                    const buffer = await sharp(srcPath)
                        .extract({ left, top, width: Math.round(frameW), height: Math.round(frameH) })
                        .ensureAlpha()
                        .png()
                        .toBuffer();
                    texFrames.push({
                        textureName: tex.name,
                        frameIndex: row * cols + col,
                        width: Math.round(frameW),
                        height: Math.round(frameH),
                        buffer,
                        pivot,
                        shape,
                    });
                } catch {
                    allFramesOk = false;
                    break;
                }
            }
            if (!allFramesOk) break;
        }

        if (allFramesOk) {
            frames.push(...texFrames);
            packableNames.add(tex.name);
        }
    }

    if (frames.length === 0) {
        return { atlasFiles: [], jsonFiles: [], packedTextureNames: new Set() };
    }

    // ── Phase 2: Shelf-pack frames ────────────────────────────────────────────
    // Sort tallest first for better row utilisation.
    frames.sort((a, b) => b.height - a.height || b.width - a.width);

    const slots: PackedSlot[] = [];
    let ai = 0, cx = 0, cy = 0, rowH = 0;

    for (const frame of frames) {
        // Start new row if frame doesn't fit horizontally.
        if (cx + frame.width > MAX_ATLAS_SIZE) {
            cx = 0;
            cy += rowH + PADDING;
            rowH = 0;
        }
        // Start new atlas if frame doesn't fit vertically.
        if (cy + frame.height > MAX_ATLAS_SIZE) {
            ai++;
            cx = 0;
            cy = 0;
            rowH = 0;
        }
        slots.push({ ...frame, atlasIndex: ai, x: cx, y: cy });
        cx += frame.width + PADDING;
        rowH = Math.max(rowH, frame.height);
    }

    // ── Phase 3: Compute per-atlas dimensions ─────────────────────────────────
    const atlasDims: { w: number; h: number }[] = [];
    for (const slot of slots) {
        const idx = slot.atlasIndex;
        if (!atlasDims[idx]) atlasDims[idx] = { w: 0, h: 0 };
        atlasDims[idx].w = Math.max(atlasDims[idx].w, slot.x + slot.width);
        atlasDims[idx].h = Math.max(atlasDims[idx].h, slot.y + slot.height);
    }

    // ── Phase 4: Composite PNGs and generate JSONs ────────────────────────────
    const atlasCount = atlasDims.length;
    const atlasFiles: { name: string; buffer: Buffer }[] = [];
    const jsonFiles:  { name: string; json: string }[] = [];

    for (let idx = 0; idx < atlasCount; idx++) {
        const { w, h } = atlasDims[idx];
        const slotsForAtlas = slots.filter(s => s.atlasIndex === idx);
        const pngName  = `atlas_${idx}.png`;
        const jsonName = `atlas_${idx}.json`;

        try {
            // Composite PNG
            const pngBuffer = await sharp({
                create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
            })
                .composite(slotsForAtlas.map(s => ({ input: s.buffer, left: s.x, top: s.y })))
                .png()
                .toBuffer();

            atlasFiles.push({ name: pngName, buffer: pngBuffer });

            // Build Texture Packer JSON
            const framesDict: Record<string, AtlasFrameMeta> = {};
            const animsDict: Record<string, string[]> = {};

            // Order frames by textureName + frameIndex for deterministic output.
            const ordered = [...slotsForAtlas].sort((a, b) =>
                a.textureName.localeCompare(b.textureName) || a.frameIndex - b.frameIndex
            );

            for (const slot of ordered) {
                const frameName = `${slot.textureName}_${slot.frameIndex}`;
                framesDict[frameName] = {
                    frame:            { x: slot.x, y: slot.y, w: slot.width, h: slot.height },
                    rotated:          false,
                    trimmed:          false,
                    spriteSourceSize: { x: 0, y: 0, w: slot.width, h: slot.height },
                    sourceSize:       { w: slot.width, h: slot.height },
                    pivot:            slot.pivot,
                    shape:            slot.shape,
                };
                if (!animsDict[slot.textureName]) animsDict[slot.textureName] = [];
            }

            // Build animation arrays in frame order (0, 1, 2 ...).
            for (const texName of Object.keys(animsDict)) {
                const texSlots = ordered
                    .filter(s => s.textureName === texName)
                    .sort((a, b) => a.frameIndex - b.frameIndex);
                animsDict[texName] = texSlots.map(s => `${s.textureName}_${s.frameIndex}`);
            }

            const atlasJson = JSON.stringify({
                frames:     framesDict,
                animations: animsDict,
                meta: {
                    image: pngName,
                    size:  { w, h },
                    scale: '1',
                },
            });

            jsonFiles.push({ name: jsonName, json: atlasJson });
        } catch (err) {
            console.warn('[Nyx atlas] Failed to composite atlas', idx, ':', err instanceof Error ? err.message : err);
            // Remove these textures from packed set so they fall back to individual copy.
            for (const slot of slotsForAtlas) {
                packableNames.delete(slot.textureName);
            }
        }
    }

    return { atlasFiles, jsonFiles, packedTextureNames: packableNames };
}
