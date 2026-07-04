/**
 * writer.ts — project writer.
 *
 * Serializes a NyxProject to project.json.
 * The NyxProject shape IS the on-disk format — no transformation needed.
 */
import * as fs from 'fs';
import * as nodePath from 'path';
import type { NyxProject } from '@nyx/shared';

const NYX_VERSION = '1.0.0';

// ─── Public API ───────────────────────────────────────────────────────────────

/** Serialize a NyxProject to a JSON string. */
export function serializeProject(project: NyxProject): string {
    return JSON.stringify({ ...project, nyxVersion: NYX_VERSION }, null, 2);
}

/**
 * Write a NyxProject to a project.json file.
 * Creates a single .backup alongside the file before overwriting.
 */
export async function writeProjectFile(
    project:  NyxProject,
    filePath: string,
): Promise<void> {
    await fs.promises.mkdir(nodePath.dirname(filePath), { recursive: true });

    try {
        await fs.promises.access(filePath);
        await fs.promises.copyFile(filePath, filePath + '.backup');
    } catch {
        // File does not exist yet — no backup needed
    }

    await fs.promises.writeFile(filePath, serializeProject(project), 'utf8');
    await fs.promises.rm(filePath + '.recovery', { force: true }).catch(() => {});
}
