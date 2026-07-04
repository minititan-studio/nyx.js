import type { NyxProject } from '@nyx/shared';

function union(names: string[]): string {
    if (names.length === 0) return 'string';
    return names.map(n => JSON.stringify(n)).join(' | ');
}

/**
 * Patches the raw @nyx/engine type declaration content by replacing the
 * placeholder `export type X = string` aliases with string literal unions
 * derived from the loaded project's asset names.
 *
 * This is necessary because TypeScript cannot augment type aliases via module
 * augmentation (only interfaces/namespaces support declaration merging).
 * Patching the source directly is the only reliable approach for Monaco.
 */
export function patchEngineTypes(content: string, project: NyxProject): string {
    const patches: [RegExp, string][] = [
        [/export type RoomName\s*=\s*string;/,     `export type RoomName = ${union(project.rooms.map(r => r.name))};`],
        [/export type TemplateName\s*=\s*string;/, `export type TemplateName = ${union(project.templates.map(t => t.name))};`],
        [/export type ActionName\s*=\s*string;/,   `export type ActionName = ${union(project.actions.map(a => a.name))};`],
        [/export type TextureName\s*=\s*string;/,  `export type TextureName = ${union(project.textures.map(t => t.name))};`],
        [/export type SoundName\s*=\s*string;/,    `export type SoundName = ${union(project.sounds.map(s => s.name))};`],
        [/export type UILayerName\s*=\s*string;/,  `export type UILayerName = ${union(project.uiLayers.map(l => l.name))};`],
        [/export type WidgetName\s*=\s*string;/,   `export type WidgetName = ${union(project.uiLayers.flatMap(l => l.widgets.map(w => w.name)))};`],
    ];
    let patched = content;
    for (const [regex, replacement] of patches) {
        patched = patched.replace(regex, replacement);
    }
    return patched;
}

/**
 * Generates a global ambient .d.ts string for the per-layer widget mapped type.
 * Registered as a separate ambient extra lib (no module augmentation — purely additive).
 */
export function generateWidgetMapTypes(project: NyxProject): string {
    const widgetMap = project.uiLayers
        .filter(l => l.widgets.length > 0)
        .map(l => `    ${JSON.stringify(l.name)}: ${union(l.widgets.map(w => w.name))};`)
        .join('\n');

    return [
        `/** Per-layer widget name map — keyed by UILayer name. */`,
        `declare type NyxWidgetNames = {`,
        widgetMap || `    [layer: string]: string;`,
        `};`,
    ].join('\n');
}
