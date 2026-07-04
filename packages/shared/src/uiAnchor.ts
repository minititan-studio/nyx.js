import type { NyxUIAnchor } from './types/assets.js';

/** Fractional X position of an anchor point (0 = left, 0.5 = center, 1 = right) */
export function anchorFracX(anchor: NyxUIAnchor): number {
    return anchor.includes('Right') ? 1
        : (anchor.includes('Center') || anchor === 'center') ? 0.5
        : 0;
}

/** Fractional Y position of an anchor point (0 = top, 0.5 = middle, 1 = bottom) */
export function anchorFracY(anchor: NyxUIAnchor): number {
    return anchor.startsWith('bottom') ? 1
        : (anchor.startsWith('middle') || anchor === 'center') ? 0.5
        : 0;
}

/**
 * Resolves an anchor to pixel base coordinates within a W×H reference rect.
 * Pass screen dimensions for root widgets, parent.width/height for children.
 */
export function anchorBasePixels(
    anchor: NyxUIAnchor,
    W: number,
    H: number
): { bx: number; by: number } {
    return { bx: anchorFracX(anchor) * W, by: anchorFracY(anchor) * H };
}
