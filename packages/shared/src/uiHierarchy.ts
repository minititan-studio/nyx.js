import type { NyxUIWidget } from './types/assets.js';

export interface UIHierarchyDiagnostic {
    type: 'duplicate-uid' | 'self-parent' | 'missing-parent' | 'cycle';
    widgetName: string;
    widgetUid: string;
    detail?: string;
}

export interface UIHierarchyResult {
    parentMap: Map<string, string>;
    roots: Set<string>;
    diagnostics: UIHierarchyDiagnostic[];
}

export function validateUIHierarchy(widgets: NyxUIWidget[]): UIHierarchyResult {
    const byUid = new Map<string, NyxUIWidget>();
    const diagnostics: UIHierarchyDiagnostic[] = [];

    for (const widget of widgets) {
        if (byUid.has(widget.uid)) {
            diagnostics.push({
                type: 'duplicate-uid',
                widgetName: widget.name,
                widgetUid: widget.uid,
            });
            continue;
        }
        byUid.set(widget.uid, widget);
    }

    const parentMap = new Map<string, string>();
    const roots = new Set<string>();

    for (const [uid, widget] of byUid) {
        if (!widget.parentUid) {
            roots.add(uid);
        } else if (widget.parentUid === uid) {
            diagnostics.push({ type: 'self-parent', widgetName: widget.name, widgetUid: uid });
            roots.add(uid);
        } else if (!byUid.has(widget.parentUid)) {
            diagnostics.push({
                type: 'missing-parent',
                widgetName: widget.name,
                widgetUid: uid,
                detail: widget.parentUid,
            });
            roots.add(uid);
        } else {
            parentMap.set(uid, widget.parentUid);
        }
    }

    // Cycle detection: walk each uid's parent chain; if we revisit a uid already
    // in the current walk's path, the first repeated uid is in a cycle — evict it.
    const globalVisited = new Set<string>();

    for (const startUid of parentMap.keys()) {
        if (globalVisited.has(startUid)) continue;

        const path: string[] = [];
        const pathSet = new Set<string>();
        let cur: string | undefined = startUid;

        while (cur !== undefined && !globalVisited.has(cur)) {
            if (pathSet.has(cur)) {
                // cur is the entry point of the cycle; evict it from parentMap
                const widget = byUid.get(cur)!;
                diagnostics.push({ type: 'cycle', widgetName: widget.name, widgetUid: cur });
                parentMap.delete(cur);
                roots.add(cur);
                break;
            }
            path.push(cur);
            pathSet.add(cur);
            cur = parentMap.get(cur);
        }

        for (const uid of path) {
            globalVisited.add(uid);
        }
    }

    return { parentMap, roots, diagnostics };
}

export function getDescendants(uid: string, widgets: NyxUIWidget[]): Set<string> {
    const childrenMap = new Map<string, string[]>();

    for (const widget of widgets) {
        if (widget.parentUid) {
            const siblings = childrenMap.get(widget.parentUid) ?? [];
            siblings.push(widget.uid);
            childrenMap.set(widget.parentUid, siblings);
        }
    }

    const result = new Set<string>();
    const queue: string[] = [uid];

    while (queue.length > 0) {
        const current = queue.shift()!;
        result.add(current);
        const children = childrenMap.get(current);
        if (children) {
            for (const child of children) {
                if (!result.has(child)) {
                    queue.push(child);
                }
            }
        }
    }

    return result;
}
