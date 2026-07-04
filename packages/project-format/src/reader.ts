/**
 * reader.ts — project reader.
 *
 * Reads a project.json file and returns a NyxProject.
 * The on-disk format IS the NyxProject shape — no transformation needed.
 * Missing fields are filled with safe defaults.
 */
import * as fs from 'fs';
import type { NyxProject, NyxProjectSettings, NyxRoom, NyxTemplate, NyxTemplateLightConfig } from '@nyx/shared';
import { createNewProject } from './newProject.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/** Read and parse a project.json file from disk. */
export async function readProjectFile(filePath: string): Promise<NyxProject> {
    const text = await fs.promises.readFile(filePath, 'utf8');
    return parseProjectText(text);
}

/** Parse raw JSON text into a NyxProject, filling in any missing fields. */
export function parseProjectText(text: string): NyxProject {
    const raw = JSON.parse(text) as Record<string, unknown>;
    // Backwards-compatible migration: old project.json used "libs", new format uses "modules"
    if ('libs' in raw && !('modules' in raw)) {
        raw.modules = raw.libs;
    }
    return normalizeProject(raw as Partial<NyxProject>);
}

/** Convert a partial/unknown project object to a fully-typed NyxProject. */
export function buildNyxProject(raw: Partial<NyxProject>): NyxProject {
    return normalizeProject(raw);
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function normalizeRoom(r: Partial<NyxRoom>): NyxRoom {
    const partial = { ...r } as Record<string, unknown>;
    // Drop legacy ui[] field that may exist in old project files
    delete partial['ui'];
    return { ...partial, uiLayerUids: r.uiLayerUids ?? [] } as NyxRoom;
}

function normalizeTemplate(t: Partial<NyxTemplate>): NyxTemplate {
    const ext = { ...(t.extends ?? {}) } as Record<string, unknown>;

    return {
        ...(t as NyxTemplate),
        extends: ext,
        light: t.light ?? {
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
        physics: t.physics ?? {
            enabled: false, density: 1, restitution: 0.2, friction: 0.3,
            staticFriction: 0.1, airFriction: 0.01,
            isStatic: false, isSensor: false,
            fixedPivot: { x: 0, y: 0 }, collisionGroup: '',
            lockAxisX: false, lockAxisY: false, lockRotation: false,
            gravityScale: 1, kinematic: false,
            constraint: { type: 'none', ropeLength: 64, stiffness: 0.05, damping: 0.05 },
        },
    };
}

function normalizeProject(raw: Partial<NyxProject>): NyxProject {
    const defaults = createNewProject({ name: raw.name ?? 'Untitled' });
    return {
        nyxVersion:     raw.nyxVersion    ?? '1.0.0',
        name:           raw.name           ?? 'Untitled',
        textures:       raw.textures       ?? [],
        templates:      (raw.templates ?? []).map(t => normalizeTemplate(t as Partial<NyxTemplate>)),
        rooms:          (raw.rooms ?? []).map(normalizeRoom),
        sounds:         raw.sounds         ?? [],
        fonts:          raw.fonts          ?? [],
        styles:         raw.styles         ?? [],
        behaviors:      raw.behaviors      ?? [],
        scripts:        raw.scripts        ?? [],
        enums:          raw.enums          ?? [],
        emitterTandems: raw.emitterTandems ?? [],
        uiLayers:       raw.uiLayers       ?? [],
        assets:         raw.assets         ?? [],
        modules:        raw.modules        ?? {},
        actions:        raw.actions        ?? [],
        globalVars:     raw.globalVars     ?? [],
        physicsGroups:  raw.physicsGroups  ?? [],
        contentTypes:   raw.contentTypes   ?? [],
        settings:       mergeSettings(raw.settings, defaults.settings),
    };
}

function mergeSettings(
    raw: NyxProjectSettings | undefined,
    defaults: NyxProjectSettings,
): NyxProjectSettings {
    if (!raw) return defaults;
    return {
        authoring:  { ...defaults.authoring,  ...(raw.authoring  ?? {}) },
        rendering:  { ...defaults.rendering,  ...(raw.rendering  ?? {}) },
        export:     { ...defaults.export,     ...(raw.export     ?? {}) },
        branding:   { ...defaults.branding,   ...(raw.branding   ?? {}) },
    };
}
