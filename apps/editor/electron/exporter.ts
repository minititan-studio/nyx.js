/**
 * Phase 8 — Game Exporter
 *
 * Produces a playable HTML5 build from a NyxProject by:
 * 1. Ensuring apps/runtime/dist/nyx.js is built (auto-builds on first export)
 * 2. Reading the built runtime bundle and substituting /*!@placeholder@*\/ markers
 * 3. Generating JavaScript for all project assets (rooms, templates, sounds, etc.)
 * 4. Copying project textures and sounds to the export directory
 * 5. Writing index.html, nyx.css, nyx.js, and pixi.js
 *
 * Placeholder convention (in the runtime source):
 *   [slash]*!@key@*[slash]  — project data injected via template substitution
 *   [slash]*!%key%*[slash]  — catmod lifecycle injection points
 * Both patterns are replaced; the regex handles the bare [slash]*@..*[slash] variant too.
 */

import fs      from 'fs';
import path    from 'path';
import esbuild from 'esbuild';
import { execSync } from 'child_process';
import type { NyxProject, NyxUIWidget } from '@nyx/shared';
import { packAtlases } from './atlasGenerator';

const emptyCodeMap = () => ({ thisOnCreate: '', thisOnStep: '', thisOnDraw: '', thisOnDestroy: '' });

// ── Engine path resolution ────────────────────────────────────────────────────
// __dirname = apps/editor/out/electron/ in dev; inside app.asar in packaged build
function getEngineSrcPath(): string {
    const { app } = require('electron') as typeof import('electron');
    const base = app.isPackaged
        ? path.join(process.resourcesPath, 'engine', 'src', 'index.ts')
        : path.join(__dirname, '../../../../packages/engine/src/index.ts');
    return base.replace(/\\/g, '/');
}

// ── Script bundle generation ──────────────────────────────────────────────────

function generateEntryContent(project: NyxProject): string {
    const templates  = (project.templates  ?? []).filter(t => t.scriptPath);
    const behaviors  = (project.behaviors  ?? []).filter(b => b.scriptPath);
    const rooms      = (project.rooms      ?? []).filter(r => r.scriptPath);
    const uiLayers   = (project.uiLayers   ?? []).filter(l => l.scriptPath);

    const lines: string[] = [
        `import { registerTemplate, registerBehavior, registerRoom, registerUILayer, registry } from '@nyx/engine';`,
    ];

    for (const t of templates) {
        const cls = path.basename(t.scriptPath, '.ts');
        lines.push(`import { ${cls} } from './${t.scriptPath.replace(/\\/g, '/')}';`);
    }
    for (const b of behaviors) {
        const cls = path.basename(b.scriptPath, '.ts');
        lines.push(`import { ${cls} } from './${b.scriptPath.replace(/\\/g, '/')}';`);
    }
    for (const r of rooms) {
        const cls = path.basename(r.scriptPath!, '.ts');
        lines.push(`import { ${cls} } from './${r.scriptPath!.replace(/\\/g, '/')}';`);
    }
    for (const l of uiLayers) {
        const cls = path.basename(l.scriptPath!, '.ts');
        lines.push(`import { ${cls} } from './${l.scriptPath!.replace(/\\/g, '/')}';`);
    }

    lines.push('');

    for (const t of templates) lines.push(`registerTemplate(${JSON.stringify(t.name)}, ${path.basename(t.scriptPath, '.ts')});`);
    for (const b of behaviors) lines.push(`registerBehavior(${JSON.stringify(b.name)}, ${path.basename(b.scriptPath, '.ts')});`);
    for (const r of rooms)     lines.push(`registerRoom(${JSON.stringify(r.name)}, ${path.basename(r.scriptPath!, '.ts')});`);
    for (const l of uiLayers)  lines.push(`registerUILayer(${JSON.stringify(l.name)}, ${path.basename(l.scriptPath!, '.ts')});`);

    // Expose UILayer registry to the ct.js runtime (accessed via window.uiLayerRegistry in ui.ts)
    lines.push(`(window as Record<string,unknown>)['uiLayerRegistry'] = registry.uiLayers;`);

    // UID→name map so the bridge can find behaviors in ct.js runtime (keyed by UID)
    const behUidMap: Record<string, string> = {};
    for (const b of behaviors) behUidMap[b.uid] = b.name;

    lines.push('');
    lines.push(`const _bhUids: Record<string,string> = ${JSON.stringify(behUidMap)};`);
    lines.push(`(function _bridgeClasses() {`);
    lines.push(`  function applyOwn(Cls: {prototype: object}, def: Record<string,unknown>) {`);
    lines.push(`    const desc = Object.getOwnPropertyDescriptors(Cls.prototype);`);
    lines.push(`    for (const [k, d] of Object.entries(desc)) {`);
    lines.push(`      if (k !== 'constructor' && typeof (d as PropertyDescriptor).value === 'function') {`);
    lines.push(`        const fn = (d as PropertyDescriptor).value as (...a: unknown[]) => unknown;`);
    lines.push(`        def[k] = function(this: unknown, ...a: unknown[]) { return fn.apply(this, a); };`);
    lines.push(`      }`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`  const w = window as Record<string,unknown>;`);
    lines.push(`  const ct = w['templates'] as Record<string,unknown> | undefined;`);
    lines.push(`  const ctT  = (ct?.['templates']          as Record<string,Record<string,unknown>>) ?? {};`);
    lines.push(`  const ctBT = (ct?.['behaviorsTemplates'] as Record<string,Record<string,unknown>>) ?? {};`);
    lines.push(`  for (const [name, Cls] of Object.entries(registry.templates))`);
    lines.push(`    if (ctT[name]) applyOwn(Cls, ctT[name]);`);
    lines.push(`  for (const [uid, name] of Object.entries(_bhUids)) {`);
    lines.push(`    const Cls = registry.behaviors[name];`);
    lines.push(`    if (!Cls) { console.warn('[Nyx] Behavior not in registry:', name, '(uid:', uid, ')'); continue; }`);
    lines.push(`    if (!ctBT[uid]) ctBT[uid] = {};`);
    lines.push(`    applyOwn(Cls, ctBT[uid]);`);
    lines.push(`  }`);
    lines.push(`  const ctR = ((w['rooms'] as Record<string,unknown>)?.['templates'] as Record<string,Record<string,unknown>>) ?? {};`);
    lines.push(`  const _roomMap: Record<string,string> = { onRoomStart: 'onCreate', onRoomEnd: 'onLeave', onStep: 'onStep', onDraw: 'onDraw' };`);
    lines.push(`  for (const [name, Cls] of Object.entries(registry.rooms)) {`);
    lines.push(`    const def = ctR[name]; if (!def) continue;`);
    lines.push(`    const rdesc = Object.getOwnPropertyDescriptors(Cls.prototype);`);
    lines.push(`    for (const [k, d] of Object.entries(rdesc)) {`);
    lines.push(`      if (k === 'constructor' || typeof (d as PropertyDescriptor).value !== 'function') continue;`);
    lines.push(`      const fn = (d as PropertyDescriptor).value as (...a: unknown[]) => unknown;`);
    lines.push(`      const ctKey = _roomMap[k];`);
    lines.push(`      if (ctKey) {`);
    lines.push(`        def[ctKey] = function(this: unknown, ...a: unknown[]) { return fn.apply(this, a); };`);
    lines.push(`      } else {`);
    lines.push(`        if (!def['extends']) def['extends'] = {};`);
    lines.push(`        (def['extends'] as Record<string,unknown>)[k] = function(this: unknown, ...a: unknown[]) { return fn.apply(this, a); };`);
    lines.push(`      }`);
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push(`})();`);

    return lines.join('\n');
}

async function generateScriptsBundle(
    project:    NyxProject,
    projectDir: string,
    outDir:     string,
): Promise<void> {
    const hasScripts = [
        ...(project.templates ?? []), ...(project.behaviors ?? []),
        ...(project.rooms ?? []),     ...(project.uiLayers  ?? []),
    ].some(a => (a as {scriptPath?: string}).scriptPath);
    if (!hasScripts) return;

    await esbuild.build({
        stdin: {
            contents:   generateEntryContent(project),
            resolveDir: projectDir,
            loader:     'ts',
        },
        bundle:   true,
        outfile:  path.join(outDir, 'scripts.js'),
        platform: 'browser',
        target:   'es2020',
        format:   'iife',
        alias:    { '@nyx/engine': getEngineSrcPath() },
        define:   { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'silent',
    });
}

// ── Paths ─────────────────────────────────────────────────────────────────────
// __dirname = apps/editor/out/electron/ in dev/prod
const RUNTIME_ROOT = path.join(__dirname, '../../../runtime');
const RUNTIME_DIST = path.join(RUNTIME_ROOT, 'dist', 'nyx.js');
const RUNTIME_CSS  = path.join(RUNTIME_ROOT, 'src', 'nyx.css');
// pixi.js is our own bundle (PIXI core + @pixi/sound + @pixi/particle-emitter), not the raw npm package
const PIXI_DIST    = path.join(RUNTIME_ROOT, 'dist', 'pixi.js');

function getNyxLibsDir(): string {
    // Mirror the logic from main.ts
    const { app } = require('electron') as typeof import('electron');
    return app.isPackaged
        ? path.join(process.resourcesPath, 'nyx.libs')
        : path.join(__dirname, '../../resources/nyx.libs');
}

// ── Runtime build ─────────────────────────────────────────────────────────────

function newestMtimeMs(dir: string): number {
    let newest = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            newest = Math.max(newest, newestMtimeMs(full));
        } else {
            newest = Math.max(newest, fs.statSync(full).mtimeMs);
        }
    }
    return newest;
}

function ensureRuntimeBuilt(): void {
    const { app } = require('electron') as typeof import('electron');
    const distExists = fs.existsSync(RUNTIME_DIST) && fs.existsSync(PIXI_DIST);
    if (app.isPackaged) {
        if (!distExists) throw new Error(
            'Runtime dist files are missing from the packaged application. ' +
            'Ensure apps/runtime/dist/ is included in extraResources.'
        );
        return;
    }
    if (distExists) {
        const bundleMtime = fs.statSync(RUNTIME_DIST).mtimeMs;
        const srcMtime    = newestMtimeMs(path.join(RUNTIME_ROOT, 'src'));
        if (srcMtime <= bundleMtime) return;
    }
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    try {
        execSync(`${pnpm} run build`, {
            cwd: RUNTIME_ROOT,
            stdio: 'pipe',
            timeout: 120_000,
        });
    } catch (err) {
        throw new Error(
            `Failed to build the Nyx runtime.\n` +
            `Run: cd apps/runtime && pnpm run build\n` +
            String((err as { stderr?: Buffer }).stderr ?? err)
        );
    }
}

// ── Template substitution ─────────────────────────────────────────────────────
/**
 * Replaces /*!@key@*\/ markers (project data: templates, rooms, catmods, etc.).
 * Does NOT touch /*!%key%*\/ catmod lifecycle markers.
 */
function substituteAt(source: string, vars: Record<string, string>): string {
    for (const [key, value] of Object.entries(vars)) {
        const re = new RegExp(`\\/\\*!? ?@${key}@ ?\\*\\/`, 'g');
        source = source.replace(re, () => value);
    }
    return source;
}

/**
 * Replaces /*!%key%*\/ markers (catmod lifecycle hooks: onbeforecreate, oncreate, etc.).
 * Does NOT touch /*!@key@*\/ project-data markers.
 */
function substitutePct(source: string, vars: Record<string, string>): string {
    for (const [key, value] of Object.entries(vars)) {
        const re = new RegExp(`\\/\\*!? ?%${key}% ?\\*\\/`, 'g');
        source = source.replace(re, () => value);
    }
    return source;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function texName(project: NyxProject, uid: string | null | undefined): string | undefined {
    if (!uid) return undefined;
    const textures: NyxProject['textures'] = project.textures ?? [];
    return textures.find(t => t.uid === uid)?.name;
}

function tmplName(project: NyxProject, uid: string): string | undefined {
    const templates: NyxProject['templates'] = project.templates ?? [];
    return templates.find(t => t.uid === uid)?.name;
}

// ── Rooms generator ───────────────────────────────────────────────────────────
interface RoomsResult {
    code: string;
    rootOnCreate: string;
    rootOnStep:   string;
    rootOnDraw:   string;
    rootOnLeave:  string;
    startRoom:  string;
    startWidth: number;
    startHeight: number;
}

/** Resolve image widget textureUid → texture name so the runtime can call PIXI.Sprite.from(name). */
function resolveUiWidgets(project: NyxProject, widgets: NyxUIWidget[]): NyxUIWidget[] {
    return widgets.map(w => {
        if (w.type === 'image' && w.textureUid) {
            const name = texName(project, w.textureUid);
            return { ...w, textureUid: name ?? null };
        }
        return w;
    });
}

function genRooms(project: NyxProject): RoomsResult {
    const hasMatter = 'matter' in (project.modules ?? {});
    const hasLight  = 'light'  in (project.modules ?? {});
    const rooms: NyxProject['rooms'] = project.rooms ?? [];
    const startRoom = rooms.find(r => r.isStartingRoom) ?? rooms[0];
    if (!startRoom) throw new Error('Project has no rooms. Add at least one room before exporting.');

    let rootOnCreate = '';
    let rootOnStep   = '';
    let rootOnDraw   = '';
    let rootOnLeave  = '';

    let code = 'rooms.templates = {\n';

    for (const room of rooms) {
        const rev     = emptyCodeMap();
        rootOnCreate += rev.thisOnCreate;
        rootOnStep   += rev.thisOnStep;
        rootOnDraw   += rev.thisOnDraw;
        rootOnLeave  += rev.thisOnDestroy;

        const objects = room.copies
            .map(copy => {
                const name = tmplName(project, copy.templateUid);
                if (!name) return null;
                const tintHex = copy.tint;
                return JSON.stringify({
                    template:         name,
                    x:                copy.x,
                    y:                copy.y,
                    scale:            { x: copy.scaleX ?? 1, y: copy.scaleY ?? 1 },
                    rotation:         copy.angle ?? 0,
                    opacity:          copy.alpha  ?? 1,
                    tint:             tintHex ? parseInt(tintHex.replace('#', ''), 16) : undefined,
                    exts:             copy.extends ?? {},
                    customProperties: copy.extends ?? {},
                });
            })
            .filter(Boolean)
            .join(',\n        ');

        const bgs = room.backgrounds
            .map(bg => {
                const name = texName(project, bg.textureUid);
                if (!name) return null;
                let repeat: string;
                if (bg.repeatX && bg.repeatY) repeat = 'repeat';
                else if (bg.repeatX)          repeat = 'repeat-x';
                else if (bg.repeatY)          repeat = 'repeat-y';
                else                          repeat = 'no-repeat';
                return JSON.stringify({
                    texture: name,
                    depth:   bg.depth,
                    exts: {
                        movementX: bg.movementX, movementY: bg.movementY,
                        parallaxX: bg.parallaxX, parallaxY: bg.parallaxY,
                        repeat,
                        scaleX: 1, scaleY: 1,
                        shiftX: bg.x, shiftY: bg.y,
                    },
                });
            })
            .filter(Boolean)
            .join(',\n        ');

        const onCreate = rev.thisOnCreate;
        const onStep   = rev.thisOnStep;
        const onDraw   = rev.thisOnDraw;
        const onLeave  = rev.thisOnDestroy;

        code += `  ${JSON.stringify(room.name)}: {\n`;
        code += `    name: ${JSON.stringify(room.name)},\n`;
        code += `    width: ${room.width}, height: ${room.height},\n`;
        code += `    backgroundColor: ${JSON.stringify(room.backgroundColor)},\n`;
        code += `    objects: [${objects ? '\n        ' + objects + '\n      ' : ''}],\n`;
        code += `    bgs: [${bgs ? '\n        ' + bgs + '\n      ' : ''}],\n`;
        const tilesJson = JSON.stringify((room.tiles ?? []).map(layer => ({
            depth:   layer.depth,
            cache:   layer.cache ?? true,
            extends: {
                        ...(layer.extends ?? {}),
                        ...(hasMatter && layer.physicsEnabled ? {
                            matterMakeStatic:  true,
                            matterFriction:    layer.physicsFriction    ?? 1,
                            matterRestitution: layer.physicsRestitution ?? 0.1,
                        } : {}),
                        ...(layer.lightBlocker ? { lightBlocker: true } : {}),
                        // Layer-level light emitter config — read by beforeroomoncreate injection
                        ...(hasLight && layer.lightEmitter ? {
                            lightEmitter:      true,
                            lightEmitterShape: layer.lightEmitterShape ?? 'soft',
                            lightEmitterColor: layer.lightEmitterColor ?? '#FFFFFF',
                            lightEmitterScale: layer.lightEmitterScale ?? 1,
                            lightCastShadows:  layer.lightCastShadows  ?? false,
                            lightRadius:       layer.lightRadius       ?? 300,
                            lightType:         layer.lightType         ?? 'point',
                            lightConeAngle:    layer.lightConeAngle    ?? 90,
                        } : {}),
                    },
            tiles:   layer.tiles.map(tile => {
                const tex = (project.textures ?? []).find(t => t.uid === tile.texture);
                if (!tex) return null;
                return {
                    texture:  tex.name,
                    frame:    tile.frame    ?? 0,
                    x: tile.x, y: tile.y,
                    width:    tex.width     ?? 0,
                    height:   tex.height    ?? 0,
                    opacity:  tile.opacity  ?? 1,
                    tint:     tile.tint     ?? 0xffffff,
                    scale:    tile.scale    ?? { x: 1, y: 1 },
                    rotation: tile.rotation ?? 0,
                    ...(tile.lightBlocker ? { lightBlocker: true } : {}),
                    // Per-tile light emitter config — overrides layer-level emitter settings
                    ...(hasLight && tile.lightEmitter ? {
                        lightEmitter:      true,
                        lightEmitterShape: tile.lightEmitterShape ?? 'soft',
                        lightEmitterColor: tile.lightEmitterColor ?? '#FFFFFF',
                        lightEmitterScale: tile.lightEmitterScale ?? 1,
                        lightCastShadows:  tile.lightCastShadows  ?? false,
                        lightRadius:       tile.lightRadius       ?? 300,
                        lightType:         tile.lightType         ?? 'point',
                        lightConeAngle:    tile.lightConeAngle    ?? 90,
                    } : {}),
                };
            }).filter(Boolean),
        })));
        const assignedLayers = (room.uiLayerUids ?? [])
            .map(uid => (project.uiLayers ?? []).find(l => l.uid === uid))
            .filter((l): l is NonNullable<typeof l> => l !== undefined);
        const layerWidgets = assignedLayers.flatMap(l => l.widgets);
        const uiJson = JSON.stringify(resolveUiWidgets(project, layerWidgets));
        const uiLayerNamesJson = JSON.stringify(assignedLayers.map(l => l.name));
        code += `    tiles: ${tilesJson}, behaviors: ${JSON.stringify(room.behaviors ?? [])}, ui: ${uiJson}, uiLayerNames: ${uiLayerNamesJson}, isUi: false, follow: -1,\n`;
        const roomExtends: Record<string, unknown> = {};
        if (hasMatter && room.matterGravity) {
            roomExtends.matterGravity = room.matterGravity;
        }
        code += `    extends: ${JSON.stringify(roomExtends)}, bindings: {},\n`;
        code += `    onCreate:  function onCreate()  { ${onCreate}  },\n`;
        code += `    onStep:    function onStep()    { ${onStep}    },\n`;
        code += `    onDraw:    function onDraw()    { ${onDraw}    },\n`;
        code += `    onLeave:   function onLeave()   { ${onLeave}   },\n`;
        code += `  },\n`;
    }

    code += '};\n';
    return { code, rootOnCreate, rootOnStep, rootOnDraw, rootOnLeave,
             startRoom: startRoom.name, startWidth: startRoom.width, startHeight: startRoom.height };
}

// ── Templates generator ───────────────────────────────────────────────────────
function genTemplates(project: NyxProject, catlibsDir: string): string {
    const hasMatter = 'matter' in (project.modules ?? {});
    const hasLight  = 'light'  in (project.modules ?? {});

        // Build lookup: group name → { category bitmask, collision mask }
        const physicsGroupLookup = new Map<string, { category: number; mask: number }>();
        for (let gi = 0; gi < (project.physicsGroups ?? []).length; gi++) {
            const g = project.physicsGroups[gi];
            physicsGroupLookup.set(g.name, { category: 1 << gi, mask: g.mask });
        }

    // Collect extends keys that hold texture UIDs across all enabled catmods.
    const textureExtendsKeys = new Set<string>();
    for (const lib of Object.keys(project.modules ?? {})) {
        const modPath = path.join(catlibsDir, lib, 'module.json');
        if (!fs.existsSync(modPath)) continue;
        let modJson: { templateExtends?: unknown[] } | null = null;
        try { modJson = JSON.parse(fs.readFileSync(modPath, 'utf-8')); }
        catch { continue; }
        if (!modJson?.templateExtends) continue;
        const walk = (items: unknown[]) => {
            for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                const f = item as Record<string, unknown>;
                if (f.type === 'group' && Array.isArray(f.items)) {
                    walk(f.items as unknown[]);
                } else if (f.type === 'texture' && typeof f.key === 'string') {
                    textureExtendsKeys.add(f.key.split('@@')[0]);
                }
            }
        };
        walk(modJson.templateExtends);
    }

    let code = 'templates.templates = {\n';
    for (const tmpl of (project.templates ?? [])) {
        const tex = texName(project, tmpl.textureUid);
        const ev  = emptyCodeMap();

        // Merge physics UI fields into extends as matter catmod keys.
        // The matter catmod reads this.matterEnable (from extends), not template.physics.
        let resolvedExtends: Record<string, unknown> = { ...(tmpl.extends ?? {}) };
        if (hasMatter && tmpl.physics?.enabled) {
            const ph = tmpl.physics;
            const constraintType = ph.constraint?.type;
            resolvedExtends = {
                matterEnable:         true,
                matterStatic:         ph.isStatic         ?? false,
                matterSensor:         ph.isSensor         ?? false,
                matterDensity:        ph.density          ?? 0.001,
                matterRestitution:    ph.restitution      ?? 0.1,
                matterFriction:       ph.friction         ?? 1,
                matterFrictionStatic: ph.staticFriction   ?? 0.1,
                matterFrictionAir:    ph.airFriction      ?? 0.01,
                matterLockRotation:   ph.lockRotation     ?? false,
                matterLockAxisX:      ph.lockAxisX        ?? false,
                matterLockAxisY:      ph.lockAxisY        ?? false,
                matterGravityScale:   ph.gravityScale     ?? 1,
                matterKinematic:      ph.kinematic        ?? false,
                matterCollisionCategory: physicsGroupLookup.get(ph.collisionGroup ?? '')?.category ?? 0x0001,
                matterCollisionMask:     physicsGroupLookup.get(ph.collisionGroup ?? '')?.mask     ?? -1,
                matterCollisionGroup:    ph.collisionGroup ?? '',
                matterFixPivot:       [ph.fixedPivot?.x ?? 0, ph.fixedPivot?.y ?? 0],
                matterConstraint:     constraintType === 'pin' ? 'pinpoint'
                                    : constraintType === 'rope' ? 'rope'
                                    : undefined,
                matterRopeLength:     ph.constraint?.ropeLength  ?? 64,
                matterRopeStiffness:  ph.constraint?.stiffness   ?? 0.05,
                matterRopeDamping:    ph.constraint?.damping     ?? 0.05,
                ...resolvedExtends,  // explicit extends override physics defaults
            };
        }

        // Merge light UI fields into extends as light catmod keys.
        // The light catmod reads this.lightTexture, this.lightColor etc. (from extends), not template.light.
        // Blocker and emitter roles are independent: blocker is always exported when module is active;
        // emitter fields are only exported when the template has explicitly opted in (isEmitter: true).
        if (hasLight && tmpl.light) {
            const lc = tmpl.light;

            // Blocker role — always relevant when light module is active.
            const lightBase: Record<string, unknown> = {
                lightBlocker: lc.lightBlocker ?? false,
            };

            // Emitter role — only when the template is explicitly opted in.
            // lightIsEmitter is the runtime gate checked by onbeforecreate.js.
            if (lc.isEmitter) {
                lightBase.lightIsEmitter   = true;
                lightBase.lightTexture     = lc.textureUid        ?? -1;
                lightBase.lightShape       = lc.shape             ?? 'soft';
                lightBase.lightColor       = lc.color             ?? '#FFFFFF';
                lightBase.lightOpacity     = lc.opacityFollowsCopy ?? true;
                lightBase.lightScale       = lc.scale             ?? 1;
                lightBase.lightCastShadows = lc.lightCastShadows  ?? false;
                lightBase.lightRadius      = lc.lightRadius       ?? 300;
                lightBase.lightType        = lc.lightType         ?? 'point';
                lightBase.lightConeAngle   = lc.lightConeAngle    ?? 90;
            }

            resolvedExtends = {
                ...lightBase,
                ...resolvedExtends,  // explicit extends still override (backward compat)
            };
        }

        // Resolve catmod texture-type extends fields from UID → name.
        for (const key of textureExtendsKeys) {
            if (key in resolvedExtends && typeof resolvedExtends[key] === 'string') {
                resolvedExtends[key] = texName(project, resolvedExtends[key] as string) ?? -1;
            }
        }

        code += `  ${JSON.stringify(tmpl.name)}: {\n`;
        code += `    name: ${JSON.stringify(tmpl.name)},\n`;
        code += `    depth: ${tmpl.depth},\n`;
        if (tex) code += `    texture: ${JSON.stringify(tex)},\n`;
        code += `    baseClass: ${JSON.stringify(tmpl.baseClass)},\n`;
        code += `    visible: true, behaviors: ${JSON.stringify(tmpl.behaviors ?? [])},\n`;
        code += `    extends: ${JSON.stringify(resolvedExtends)},\n`;
        code += `    blendMode: 0, animationFPS: 30, playAnimationOnStart: true, loopAnimation: true,\n`;
        code += `    onCreate:  function onCreate()  { ${ev.thisOnCreate}  },\n`;
        code += `    onStep:    function onStep()    { ${ev.thisOnStep}    },\n`;
        code += `    onDraw:    function onDraw()    { ${ev.thisOnDraw}    },\n`;
        code += `    onDestroy: function onDestroy() { ${ev.thisOnDestroy} },\n`;
        code += `  },\n`;
    }
    code += '};\n';
    return code;
}

// ── Sounds generator ──────────────────────────────────────────────────────────
function genSounds(project: NyxProject): string {
    const exported = (project.sounds ?? []).map(snd => ({
        uid:     snd.uid,
        name:    snd.name,
        preload: snd.preload,
        variants: (snd.variants ?? []).map(v => ({
            uid:    v.uid,
            source: `snd/${v.uid}${path.extname(v.origname)}`,
        })),
        volume:     snd.volume,
        pitch:      snd.pitch,
        distortion: snd.distortion,
        reverb: {
            enabled:    snd.reverb.enabled,
            secondsMin: snd.reverb.decayMin,
            secondsMax: snd.reverb.decayMax,
            decayMin:   snd.reverb.decayMin,
            decayMax:   snd.reverb.decayMax,
            reverse:    snd.reverb.reverse,
        },
    }));
    return JSON.stringify(exported);
}

// ── Tiled images generator (no atlas packing — copy originals) ────────────────
function genTiledImages(project: NyxProject, skipNames: Set<string> = new Set()): string {
    const obj: Record<string, unknown> = {};
    for (const tex of (project.textures ?? [])) {
        if (!tex.origname) continue;
        if (skipNames.has(tex.name)) continue;
        obj[tex.name] = {
            source:      `img/${tex.origname}`,
            shape:       tex.shape,
            anchor:      { x: tex.axis[0], y: tex.axis[1] },
            grid:        tex.grid     ?? [1, 1],
            frameWidth:  tex.width,
            frameHeight: tex.height,
            offx:        tex.offx     ?? 0,
            offy:        tex.offy     ?? 0,
            marginx:     tex.marginx  ?? 0,
            marginy:     tex.marginy  ?? 0,
        };
    }
    return JSON.stringify(obj);
}

// ── Behaviors generator ───────────────────────────────────────────────────────
function genBehaviors(project: NyxProject): { templates: string; rooms: string } {
    const tmplEntries: string[] = [];
    const roomEntries: string[] = [];

    for (const bh of (project.behaviors ?? [])) {
        const ev = emptyCodeMap();

        const parts: string[] = [];
        if (ev.thisOnCreate)  parts.push(`thisOnCreate:  function() { ${ev.thisOnCreate}  }`);
        if (ev.thisOnStep)    parts.push(`thisOnStep:    function() { ${ev.thisOnStep}    }`);
        if (ev.thisOnDraw)    parts.push(`thisOnDraw:    function() { ${ev.thisOnDraw}    }`);
        if (ev.thisOnDestroy) parts.push(`thisOnDestroy: function() { ${ev.thisOnDestroy} }`);

        const obj   = `{ ${parts.join(', ')} }`;
        const entry = `  ${JSON.stringify(bh.uid)}: ${obj}`;

        if (bh.behaviorType === 'room') roomEntries.push(entry);
        else                            tmplEntries.push(entry);
    }

    return {
        templates: `{\n${tmplEntries.join(',\n')}\n}`,
        rooms:     `{\n${roomEntries.join(',\n')}\n}`,
    };
}

// ── Misc generators ───────────────────────────────────────────────────────────
function genEnums(project: NyxProject): string {
    return (project.enums ?? []).map(e =>
        `var ${e.name} = {\n${(e.values ?? []).map((v, i) => `  ${v}: ${i},`).join('\n')}\n};\n`
    ).join('');
}

function genGlobalVars(project: NyxProject): string {
    return (project.globalVars ?? []).map(v => {
        let val: string;
        switch (v.type) {
            case 'string':  val = JSON.stringify(v.value); break;
            case 'number':  val = v.value || '0'; break;
            case 'boolean': val = v.value === 'true' ? 'true' : 'false'; break;
            default:        val = v.value || 'undefined';
        }
        return `var ${v.name} = ${val};`;
    }).join('\n');
}

function genActions(project: NyxProject): string {
    return (project.actions ?? []).map(a =>
        `inputs.addAction(${JSON.stringify(a.name)}, ${JSON.stringify(a.methods)});`
    ).join('\n');
}

function genUserScripts(_project: NyxProject): string {
    // User scripts are bundled separately into scripts.js by generateScriptsBundle().
    // This slot (/*!@userScripts@*/) is intentionally left empty.
    return '';
}

function genCatmods(project: NyxProject, catlibsDir: string): string {
    let code = '';
    for (const lib of Object.keys(project.modules ?? {})) {
        const indexPath = path.join(catlibsDir, lib, 'index.js');
        if (fs.existsSync(indexPath)) {
            const content = fs.readFileSync(indexPath, 'utf-8');
            code += `\n/* NyxMod: ${lib} */\n${content}\n`;
            // nyx.js is an ES module — top-level const/let/var are module-scoped, NOT
            // window-scoped. scripts.js is a separate ES module and cannot see catmod
            // globals unless they are explicitly on window. Detect column-0 declarations
            // (indented ones are block-scoped inside the catmod's own block) and expose them.
            const match = content.match(/^(?:const|let|var)\s+(\w+)\s*=/m);
            if (match) {
                code += `window.${match[1]} = ${match[1]};\n`;
            }
        }
    }
    return code;
}

// ── Content type generator ────────────────────────────────────────────────────
type FieldSpec = { name: string; readableName: string; type: string; structure: string; mappedType?: string };

function resolveAssetRef(uid: unknown, type: string, project: NyxProject): unknown {
    if (typeof uid !== 'string' || !uid) return uid;
    switch (type) {
        case 'texture':       return project.textures?.find(t => t.uid === uid)?.name ?? uid;
        case 'template':      return project.templates?.find(t => t.uid === uid)?.name ?? uid;
        case 'room':          return project.rooms?.find(r => r.uid === uid)?.name ?? uid;
        case 'sound':         return project.sounds?.find(s => s.uid === uid)?.name ?? uid;
        case 'font':          return project.fonts?.find(f => f.uid === uid)?.name ?? uid;
        case 'style':         return project.styles?.find(s => s.uid === uid)?.name ?? uid;
        case 'behavior':      return project.behaviors?.find(b => b.uid === uid)?.name ?? uid;
        case 'emitterTandem': return project.emitterTandems?.find(e => e.uid === uid)?.name ?? uid;
        default:              return uid;
    }
}

function unwrapContentEntry(
    entry: Record<string, unknown>,
    spec: FieldSpec[],
    project: NyxProject
): Record<string, unknown> {
    const fieldMap = new Map(spec.map(f => [f.name || f.readableName, f]));
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(entry)) {
        const field = fieldMap.get(key);
        if (!field) { out[key] = val; continue; }
        if (field.structure === 'array') {
            out[key] = (val as unknown[]).map(v => resolveAssetRef(v, field.type, project));
        } else if (field.structure === 'map') {
            const inMap = val as Record<string, unknown>;
            const outMap: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(inMap)) {
                const rk = String(resolveAssetRef(k, field.type, project));
                outMap[rk] = resolveAssetRef(v, field.mappedType ?? field.type, project);
            }
            out[key] = outMap;
        } else {
            out[key] = resolveAssetRef(val, field.type, project);
        }
    }
    return out;
}

function genContent(project: NyxProject): string {
    const db: Record<string, unknown[]> = {};
    for (const ct of (project.contentTypes ?? [])) {
        const key = ct.name || ct.readableName;
        db[key] = (ct.entries ?? []).map(entry =>
            unwrapContentEntry(entry as Record<string, unknown>, ct.specification as FieldSpec[], project)
        );
    }
    const json = JSON.stringify(db);
    return `"${json.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ── Styles generator ──────────────────────────────────────────────────────────
function genStyles(project: NyxProject): string {
    let out = '';
    for (const s of (project.styles ?? [])) {
        const o: Record<string, unknown> = {
            fontFamily: s.font.family,
            fontSize:   s.font.size,
            fontStyle:  s.font.italic ? 'italic' : 'normal',
            fontWeight: s.font.weight,
            align:      s.halign,
            lineJoin:   'round',
            lineHeight: s.font.lineHeight || s.font.size * 1.35,
        };
        if (s.fill.type === 'solid') {
            o.fill = s.fill.color;
        } else if (s.fill.type === 'linearGradient' && s.fill.gradientColors?.length) {
            o.fill = s.fill.gradientColors;
            o.fillGradientType = 0;
        }
        if (s.stroke.enabled) {
            o.strokeThickness = s.stroke.width;
            o.stroke          = s.stroke.color;
            o.lineJoin        = s.stroke.lineJoin;
        }
        if (s.shadow.enabled) {
            o.dropShadow         = true;
            o.dropShadowBlur     = s.shadow.blur;
            o.dropShadowColor    = s.shadow.color;
            o.dropShadowAngle    = Math.atan2(s.shadow.y, s.shadow.x);
            o.dropShadowDistance = Math.hypot(s.shadow.x, s.shadow.y);
        }
        if (s.wordWrap) {
            o.wordWrap      = true;
            o.wordWrapWidth = s.wordWrapWidth;
        }
        out += `\nstyles.new(\n    ${JSON.stringify(s.name)},\n    ${JSON.stringify(o, null, '    ')});\n`;
    }
    return out;
}

// ── Emitter tandem generator ──────────────────────────────────────────────────

function ctEmitterToExported(em: NyxProject['emitterTandems'][number]['emitters'][number], textureName: string | null): unknown {
    const hasGravity = (em.gravity ?? 0) !== 0 || (em.gravityX ?? 0) !== 0;
    const speedMax   = em.speedMax ?? 0;
    const speedMin   = em.speedMin ?? 0;
    const shape      = em.spawnShape ?? 'point';
    const ox         = em.spawnOffsetX ?? 0;
    const oy         = em.spawnOffsetY ?? 0;

    const moveBehavior = hasGravity
        ? {
            type: 'moveAcceleration',
            config: {
                minStart: speedMin,
                maxStart: speedMax,
                accel:    { x: em.gravityX ?? 0, y: em.gravity ?? 0 },
                rotate:   false  // gravity is world-space — don't rotate with particle direction
            }
        }
        : {
            type: 'moveSpeed',
            config: {
                speed:   { list: [{ value: speedMax, time: 0 }, { value: speedMax, time: 1 }] },
                minMult: speedMax > 0 ? speedMin / speedMax : 1
            }
        };

    const spawnBehavior = shape === 'burst'
        ? {
            type: 'spawnBurst',
            config: { type: 'torus', data: { innerRadius: 0, radius: em.spawnRadius ?? 0, x: ox, y: oy, rotation: true } }
        }
        : shape === 'rect'
        ? {
            type: 'spawnShape',
            config: { type: 'rect', data: {
                x: ox - (em.spawnRectWidth  ?? 100) / 2,
                y: oy - (em.spawnRectHeight ?? 100) / 2,
                width:  em.spawnRectWidth  ?? 100,
                height: em.spawnRectHeight ?? 100
            } }
        }
        : {
            // point / circle / ring all use torus; innerRadius=0 for circle/point
            type: 'spawnShape',
            config: { type: 'torus', data: {
                innerRadius: shape === 'ring' ? (em.spawnInnerRadius ?? 0) : 0,
                radius:      shape === 'point' ? 0 : (em.spawnRadius ?? 50),
                x: ox, y: oy,
                rotation: true
            } }
        };

    return {
        texture:                 textureName ?? '',
        textureBehavior:         em.textureBehavior         ?? 'textureRandom',
        animatedSingleFramerate: em.animatedSingleFramerate ?? 10,
        settings: {
            delay:            0,
            frequency:        1 / Math.max(em.spawnRate ?? 1, 0.001),
            lifetime:         { min: em.lifetimeMin ?? 1, max: em.lifetimeMax ?? 2 },
            spawnChance:      em.spawnChance      ?? 1,
            emitterLifetime:  em.emitterLifetime  ?? -1,
            maxParticles:     em.maxParticles     ?? 100,
            addAtBack:        false,
            particlesPerWave: em.particlesPerWave ?? 1,
            pos:              { x: ox, y: oy },
            behaviors: [
                {
                    type: 'alpha',
                    config: { alpha: { list: [{ value: em.alphaStart ?? 1, time: 0 }, { value: em.alphaEnd ?? 0, time: 1 }] } }
                },
                {
                    // Index 1 — runtime tint code reads behaviors[1] by index
                    type: 'color',
                    config: { color: { list: [
                        { value: (em.colorStart ?? '#ffffff').replace('#', ''), time: 0 },
                        { value: (em.colorEnd   ?? '#888888').replace('#', ''), time: 1 }
                    ] } }
                },
                {
                    type: 'blendMode',
                    config: { blendMode: em.blendMode ?? 'normal' }
                },
                {
                    type: 'scale',
                    config: {
                        scale:   { list: [{ value: em.scaleStart ?? 1, time: 0 }, { value: em.scaleEnd ?? 0.5, time: 1 }] },
                        minMult: 1
                    }
                },
                moveBehavior,
                spawnBehavior,
                {
                    type: 'rotation',
                    config: {
                        minStart: em.rotationMin      ?? 0,
                        maxStart: em.rotationMax      ?? 0,
                        minSpeed: em.rotationSpeedMin ?? 0,
                        maxSpeed: em.rotationSpeedMax ?? 0
                    }
                }
            ]
        }
    };
}

function genTandems(project: NyxProject): string {
    const tandems: Record<string, unknown> = {};
    for (const tandem of (project.emitterTandems ?? [])) {
        tandems[tandem.name] = tandem.emitters.map(em => {
            const textureName = project.textures?.find(t => t.uid === em.textureUid)?.name ?? null;
            return ctEmitterToExported(em, textureName);
        });
    }
    return JSON.stringify(tandems, null, '    ');
}

// ── Font export — copies files to fonts/, returns @font-face CSS ──────────────
function genFonts(project: NyxProject, projectFilePath: string, outDir: string): string {
    const projectDir = path.dirname(projectFilePath);
    const srcDir = path.join(projectDir, 'fonts');
    const dstDir = path.join(outDir, 'fonts');
    fs.mkdirSync(dstDir, { recursive: true });

    let css = '';
    for (const font of (project.fonts ?? [])) {
        if (!font.origname) continue;
        const src = path.join(srcDir, font.origname);
        if (!fs.existsSync(src)) continue;
        fs.copyFileSync(src, path.join(dstDir, font.origname));
        const ext = path.extname(font.origname).toLowerCase().slice(1);
        const fmt = ext === 'ttf' ? 'truetype' : ext === 'otf' ? 'opentype' : ext;
        css += `@font-face {\n`
             + `  font-family: ${JSON.stringify(font.family)};\n`
             + `  font-weight: ${font.weight};\n`
             + `  font-style: ${font.italic ? 'italic' : 'normal'};\n`
             + `  src: url(${JSON.stringify('fonts/' + font.origname)}) format(${JSON.stringify(fmt)});\n`
             + `}\n`;
    }
    return css;
}

// ── NyxMod field substitution ─────────────────────────────────────────────────
type NyxModField = { key?: string; type?: string; fields?: NyxModField[] };

function parseCatmodKeys(
    fields: NyxModField[] | undefined,
    str: string,
    libValues: Record<string, unknown>,
    project: NyxProject
): string {
    if (!fields?.length) return str;
    let out = str;
    for (const field of fields) {
        if (!field.key) continue;
        const parts = field.key.split('@@');
        if (parts.length > 1) parts.pop();
        const cleanKey = parts.join('@@');
        const val = libValues[cleanKey];
        const re = new RegExp('(/\\*)?%' + cleanKey + '%(\\*/)?', 'g');
        // For unset values, use field.default so module defaults are honoured on first export.
        const effective = val ?? (field as {default?: unknown}).default;
        if (field.type === 'checkbox') {
            out = out.replace(re, effective ? 'true' : 'false');
        } else if (field.type === 'table' && Array.isArray(effective) && field.fields?.length) {
            const resolved = (effective as Record<string, unknown>[]).map(row => {
                const resolvedRow = { ...row };
                for (const subField of field.fields!) {
                    if (!subField.key) continue;
                    const subParts = subField.key.split('@@');
                    const assetType = subParts.length > 1 ? subParts[subParts.length - 1] : null;
                    const subCleanKey = (subParts.length > 1 ? subParts.slice(0, -1) : subParts).join('@@');
                    if (assetType && subCleanKey in resolvedRow) {
                        resolvedRow[subCleanKey] = resolveAssetRef(resolvedRow[subCleanKey], assetType, project);
                    }
                }
                return resolvedRow;
            });
            out = out.replace(re, () => JSON.stringify(resolved));
        } else {
            const sub = effective == null ? '' : typeof effective === 'object' ? JSON.stringify(effective) : String(effective);
            out = out.replace(re, () => sub);
        }
    }
    return out;
}

// ── NyxMod lifecycle injections ───────────────────────────────────────────────
const INJECTION_KEYS = [
    'load', 'start', 'switch',
    'onbeforecreate', 'oncreate', 'ondestroy',
    'beforedraw', 'beforestep', 'afterdraw', 'afterstep', 'beforeframe',
    'beforeroomoncreate', 'roomoncreate', 'roomonleave',
    'afterroomdraw', 'beforeroomdraw', 'beforeroomstep', 'afterroomstep',
    'css', 'res', 'resload', 'htmltop', 'htmlbottom',
    'templates', 'rooms',
] as const;
type InjKey = typeof INJECTION_KEYS[number];

function genCatmodInjections(project: NyxProject, catlibsDir: string): Record<InjKey, string> {
    const inj = Object.fromEntries(INJECTION_KEYS.map(k => [k, ''])) as Record<InjKey, string>;

    for (const lib of Object.keys(project.modules ?? {})) {
        const modPath = path.join(catlibsDir, lib, 'module.json');
        if (!fs.existsSync(modPath)) continue;
        let modJson: { fields?: Array<{ key?: string; type?: string }> } | null = null;
        try { modJson = JSON.parse(fs.readFileSync(modPath, 'utf-8')); }
        catch { continue; }
        if (!modJson) continue;

        const libValues = (project.modules[lib] ?? {}) as Record<string, unknown>;
        const injDir = path.join(catlibsDir, lib, 'injections');
        if (!fs.existsSync(injDir)) continue;

        for (const fname of fs.readdirSync(injDir)) {
            const key = path.basename(fname, path.extname(fname)) as InjKey;
            if (!(INJECTION_KEYS as readonly string[]).includes(key)) continue;
            const content = fs.readFileSync(path.join(injDir, fname), 'utf-8');
            inj[key] += parseCatmodKeys(modJson.fields, content, libValues, project);
        }
    }
    return inj;
}

// ── CSS generator ─────────────────────────────────────────────────────────────
function applyCssConditional(css: string, key: string, keep: boolean): string {
    const blockRe = new RegExp(`\\/\\*if @${key}@\\*\\/[\\s\\S]*?\\/\\*endif @${key}@\\*\\/`, 'g');
    if (keep) {
        return css
            .replace(new RegExp(`\\/\\*if @${key}@\\*\\/`, 'g'), '')
            .replace(new RegExp(`\\/\\*endif @${key}@\\*\\/`, 'g'), '');
    }
    return css.replace(blockRe, '');
}

function genCss(project: NyxProject): string {
    let css = fs.existsSync(RUNTIME_CSS) ? fs.readFileSync(RUNTIME_CSS, 'utf-8') : FALLBACK_CSS;

    const accent = project.settings?.branding?.accent ?? '#446adb';
    const hex    = parseInt(accent.replace('#', ''), 16);
    const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
    const fg = (0.299 * r + 0.587 * g + 0.114 * b) > 128 ? '#000000' : '#ffffff';
    const invert = project.settings?.branding?.invertPreloaderScheme ?? false;

    css = css.replace(/\/\*!? ?@accent@\*\//g, accent);
    css = css.replace(/\/\*!? ?@preloaderbackground@\*\//g, invert ? fg     : accent);
    css = css.replace(/\/\*!? ?@preloaderforeground@\*\//g, invert ? accent : fg);

    css = applyCssConditional(css, 'pixelatedrender', project.settings?.rendering?.pixelatedrender ?? false);
    css = applyCssConditional(css, 'hidecursor',      project.settings?.rendering?.hideCursor      ?? false);
    css = applyCssConditional(css, 'hidemadewithctjs', false);

    return css;
}

const FALLBACK_CSS = `
html,body{margin:0;padding:0;background:#000;width:100%;height:100vh;overflow:hidden}
#ct{position:relative;display:inline-block;width:100%;height:100%;line-height:0;-webkit-user-select:none;user-select:none}
.ct-aLoadingScreen{position:absolute;inset:0;background:#446adb;z-index:2;display:flex;align-items:center;justify-content:center}
.ct-aLoadingProgress{text-align:center;color:#fff;font-family:sans-serif;padding:2rem}
.ct-aLoadingBar{height:3px;background:#fff;width:0%;margin-top:1rem;border-radius:2px;transition:width 1s}
.ct-Errors{position:absolute;inset:0;z-index:10;pointer-events:none}
`;

// ── HTML generator ────────────────────────────────────────────────────────────
function genHtml(project: NyxProject, htmltop = '', htmlbottom = ''): string {
    const title  = project.settings?.authoring?.title ?? project.name;
    const accent = project.settings?.branding?.accent ?? '#446adb';
    const loadingText = project.settings?.branding?.customLoadingText ?? 'Loading…';
    const hasScripts = [
        ...(project.templates ?? []), ...(project.behaviors ?? []),
        ...(project.rooms     ?? []), ...(project.uiLayers  ?? []),
    ].some(a => (a as {scriptPath?: string}).scriptPath);
    // All three are static imports in a single inline module so they share one
    // browser task. Microtasks (including loading.then()) only drain after all
    // three have evaluated — preventing ctSplashscreen from firing before
    // scripts.js has run _bridgeClasses to wire up user template methods.
    const bootScript = [
        `import './pixi.js';`,
        `import './nyx.js';`,
        ...(hasScripts ? [`import './scripts.js';`] : []),
    ].join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"/>
  <title>${title}</title>
  <meta name="theme-color" content="${accent}"/>
  <meta name="generator" content="Nyx Studio"/>
  <link rel="stylesheet" href="nyx.css"/>${htmltop ? '\n' + htmltop : ''}
</head>
<body touch-action="none">
  <div id="ct">
    <div class="ct-aLoadingScreen">
      <div class="ct-aLoadingProgress">
        <span class="ct-aLoadingLabel">${loadingText}</span>
        <div class="ct-aLoadingBar" data-progress="0" style="width:0%"></div>
      </div>
    </div>
    <div class="ct-Errors"></div>
  </div>
  <script type="module">${bootScript}</script>${htmlbottom ? '\n' + htmlbottom : ''}
</body>
</html>`;
}

// ── Asset copying ─────────────────────────────────────────────────────────────
async function copyAssets(
    project: NyxProject,
    projectFilePath: string,
    outDir: string,
    skipTextureNames: Set<string> = new Set()
): Promise<void> {
    const projectDir = path.dirname(projectFilePath);

    // Textures
    const imgSrc = path.join(projectDir, 'img');
    const imgDst = path.join(outDir, 'img');
    fs.mkdirSync(imgDst, { recursive: true });
    if (fs.existsSync(imgSrc)) {
        for (const tex of (project.textures ?? [])) {
            if (!tex.origname) continue;
            if (skipTextureNames.has(tex.name)) continue;
            const src = path.join(imgSrc, tex.origname);
            const dst = path.join(imgDst, tex.origname);
            if (fs.existsSync(src)) fs.copyFileSync(src, dst);
        }
    }

    // Sounds
    const sndSrc = path.join(projectDir, 'snd');
    const sndDst = path.join(outDir, 'snd');
    fs.mkdirSync(sndDst, { recursive: true });
    if (fs.existsSync(sndSrc)) {
        for (const snd of (project.sounds ?? [])) {
            for (const variant of snd.variants) {
                if (!variant.origname) continue;
                const src = path.join(sndSrc, variant.origname);
                const ext = path.extname(variant.origname);
                const dst = path.join(sndDst, `${variant.uid}${ext}`);
                if (fs.existsSync(src)) fs.copyFileSync(src, dst);
            }
        }
    }

    // NyxMod includes
    const catlibsDir = getNyxLibsDir();
    for (const lib of Object.keys(project.modules ?? {})) {
        const includesDir = path.join(catlibsDir, lib, 'includes');
        if (fs.existsSync(includesDir)) {
            copyDirRecursive(includesDir, outDir);
        }
    }

    // Project include folder (custom static files)
    const includeDir = path.join(projectDir, 'include');
    if (fs.existsSync(includeDir)) copyDirRecursive(includeDir, outDir);
}

function copyDirRecursive(src: string, dst: string): void {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDirRecursive(s, d);
        else fs.copyFileSync(s, d);
    }
}

// ── Main export entry point ───────────────────────────────────────────────────
export async function exportProject(
    project:         NyxProject,
    projectFilePath: string,
    outDir:          string
): Promise<void> {
    const projectDir = path.dirname(projectFilePath);

    // 1. Ensure runtime is built
    ensureRuntimeBuilt();

    // 2. Prepare output directory
    fs.mkdirSync(outDir, { recursive: true });
    // Clear stale output but keep img/ if textures haven't changed
    for (const entry of fs.readdirSync(outDir)) {
        if (entry !== 'img') fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
    }

    // 3. Bundle user TypeScript classes → scripts.js (before generating HTML)
    await generateScriptsBundle(project, projectDir, outDir);

    // 4. Generate all project data
    const rooms      = genRooms(project);
    const behaviors  = genBehaviors(project);
    const catlibsDir = getNyxLibsDir();
    const catmods    = genCatmods(project, catlibsDir);
    const inj        = genCatmodInjections(project, catlibsDir);
    const fontsCss   = genFonts(project, projectFilePath, outDir);

    // 4a. Pack textures into atlases and write atlas files to outDir/img/
    const imgDst = path.join(outDir, 'img');
    fs.mkdirSync(imgDst, { recursive: true });
    const atlasResult = await packAtlases(project.textures ?? [], projectDir);
    for (const af of atlasResult.atlasFiles) {
        fs.writeFileSync(path.join(imgDst, af.name), af.buffer);
    }
    for (const jf of atlasResult.jsonFiles) {
        fs.writeFileSync(path.join(imgDst, jf.name), jf.json, 'utf-8');
    }
    const atlasJsonPaths = atlasResult.jsonFiles.map(f => `img/${f.name}`);

    // Build tiledImages only for textures that were NOT packed into an atlas.
    const unpackedTiledImages = genTiledImages(project, atlasResult.packedTextureNames);

    // /*!@key@*/ markers — project data, metadata, generated JS blocks
    const atVars: Record<string, string> = {
        // Metadata & settings
        version:        '5.3.1-nyx',
        projectmeta:      JSON.stringify({
            name:    project.settings?.authoring?.title    ?? project.name,
            author:  project.settings?.authoring?.author   ?? '',
            site:    project.settings?.authoring?.site     ?? '',
            version: (project.settings?.authoring?.version ?? [0,1,0]).join('.') +
                     (project.settings?.authoring?.versionPostfix ?? ''),
        }),
        autocloseDesktop: String(project.settings?.export?.autocloseDesktop ?? false),
        highDensity:      String(project.settings?.rendering?.highDensity   ?? false),
        pixelatedrender:  String(project.settings?.rendering?.pixelatedrender ?? false),
        debug:            'false',
        production:       'true',
        maxfps:           String(project.settings?.rendering?.maxFPS ?? 60),
        startwidth:       String(rooms.startWidth),
        startheight:      String(rooms.startHeight),
        startroom:        rooms.startRoom,
        viewMode:         project.settings?.rendering?.viewMode ?? 'fastScale',
        transparent:      String(project.settings?.rendering?.transparent ?? false),
        showErrors:       String(project.settings?.export?.showErrors ?? false),
        reportLink:       JSON.stringify(project.settings?.export?.errorsLink ?? ''),

        // Asset data (JSON-serialised so they survive the [/*!@x@*/][0] wrapper)
        atlases:              JSON.stringify(atlasJsonPaths),
        bitmapFonts:          '[]',
        tiledImages:          unpackedTiledImages,
        sounds:               genSounds(project),
        assetTree:            'false',
        contentTypes:         genContent(project),
        tandemTemplates:      genTandems(project),
        behaviorsTemplates:   behaviors.templates,
        behaviorsRooms:       behaviors.rooms,

        // Generated JS code blocks
        rooms:            rooms.code,
        templates:        genTemplates(project, catlibsDir),
        enums:            genEnums(project),
        globalVars:       genGlobalVars(project),
        actions:          genActions(project),
        userScripts:      genUserScripts(project),
        startupScripts:   '',
        catmods,
        styles:           genStyles(project),
        fonts:            '',
        scriptAssets:     '',

        // Root room event code
        rootRoomOnCreate: rooms.rootOnCreate,
        rootRoomOnStep:   rooms.rootOnStep,
        rootRoomOnDraw:   rooms.rootOnDraw,
        rootRoomOnLeave:  rooms.rootOnLeave,
    };

    // /*!%key%*/ markers — catmod lifecycle hooks only.
    // Kept separate so catmod code never lands in /*!@key@*/ per-template slots
    // (which would double-fire: CopyProto.onBeforeCreateModifier has both markers).
    const pctVars: Record<string, string> = {
        onbeforecreate:     inj.onbeforecreate,
        res:                inj.res,
        resload:            inj.resload,
        load:               inj.load,
        start:              inj.start,
        switch:             inj.switch,
        oncreate:           inj.oncreate,
        ondestroy:          inj.ondestroy,
        beforedraw:         inj.beforedraw,
        beforestep:         inj.beforestep,
        afterdraw:          inj.afterdraw,
        afterstep:          inj.afterstep,
        beforeframe:        inj.beforeframe,
        beforeroomoncreate: inj.beforeroomoncreate,
        roomoncreate:       inj.roomoncreate,
        roomonleave:        inj.roomonleave,
        afterroomdraw:      inj.afterroomdraw,
        beforeroomdraw:     inj.beforeroomdraw,
        beforeroomstep:     inj.beforeroomstep,
        afterroomstep:      inj.afterroomstep,
        css:                inj.css,
        // NyxMod room/template registration blocks (e.g. transition's CTTRANSITIONEMPTYROOM)
        rooms:              inj.rooms,
        templates:          inj.templates,
    };

    // 4. Substitute placeholders in the runtime bundle.
    // Two passes: @key@ (project data) then %key% (catmod lifecycle hooks).
    // Keeping them separate prevents catmod code from landing in both
    // /*!%onbeforecreate%*/ AND /*!@onbeforecreate@*/ slots inside
    // CopyProto.onBeforeCreateModifier, which would fire matter.onCreate() twice.
    let ctJs = fs.readFileSync(RUNTIME_DIST, 'utf-8');
    ctJs = substituteAt(ctJs, atVars);
    ctJs = substitutePct(ctJs, pctVars);

    // 5. Write output files
    fs.writeFileSync(path.join(outDir, 'nyx.js'),     ctJs,         'utf-8');
    fs.writeFileSync(path.join(outDir, 'nyx.css'),    genCss(project) + fontsCss, 'utf-8');
    fs.writeFileSync(path.join(outDir, 'index.html'), genHtml(project, inj.htmltop, inj.htmlbottom), 'utf-8');

    // 6. Copy pixi.js
    if (fs.existsSync(PIXI_DIST)) {
        fs.copyFileSync(PIXI_DIST, path.join(outDir, 'pixi.js'));
    }

    // 7. Copy project assets (textures, sounds, catmod includes)
    await copyAssets(project, projectFilePath, outDir, atlasResult.packedTextureNames);
}
