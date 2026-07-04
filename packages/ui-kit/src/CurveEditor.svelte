<script lang="ts">
  /**
   * CurveEditor — Canvas-based cubic bezier easing curve editor.
   * Ported from: src/riotTags/shared/curve-editor.tag
   *
   * Behavior preserved:
   * - 150×150 canvas; coordinate system: (0,0)=top-left in CSS canvas coords
   * - Curve goes from bottom-left (time=0, value=1 in CSS-y) to top-right (time=1, value=0 in CSS-y)
   * - Two draggable control-point handles (cp1 and cp2 of the cubic bezier)
   * - Mousedown on a handle → track mousemove on document → update x,y → redraw → call onchange
   * - Draws: grid lines, the bezier curve, and handle circles connected by dashed guide lines
   * - value is [p1x, p1y, p2x, p2y] matching CSS cubic-bezier convention
   */

  import { onMount, onDestroy } from 'svelte';

  type BezierTuple = [number, number, number, number];

  interface Props {
    value?: BezierTuple;
    onchange?: (v: BezierTuple) => void;
  }

  let { value = [0.25, 0.1, 0.25, 1], onchange }: Props = $props();

  // Internal state — local copy of the control points so dragging doesn't
  // mutate the caller's array until we call onchange.
  let cp: BezierTuple = $state([...value] as BezierTuple);

  // Keep in sync when the prop changes externally
  $effect(() => {
    cp = [...value] as BezierTuple;
    draw();
  });

  const SIZE = 150;
  const HANDLE_R = 5;
  const PAD = 12; // canvas padding so handles at 0/1 aren't clipped

  let canvas: HTMLCanvasElement | undefined = $state();
  let ctx: CanvasRenderingContext2D | null = null;

  // Which handle is being dragged: 0=cp1, 1=cp2, null=none
  let dragging: 0 | 1 | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartCp: BezierTuple = [0, 0, 0, 0];

  // Map a bezier param [0..1] to canvas pixel, accounting for padding
  function toCanvasX(t: number): number {
    return PAD + t * (SIZE - PAD * 2);
  }
  function toCanvasY(v: number): number {
    // v=0 → bottom of canvas; v=1 → top. CSS y is inverted.
    return SIZE - PAD - v * (SIZE - PAD * 2);
  }

  // Inverse: canvas pixel → bezier param
  function fromCanvasX(px: number): number {
    return Math.min(1, Math.max(0, (px - PAD) / (SIZE - PAD * 2)));
  }
  function fromCanvasY(py: number): number {
    return Math.min(1, Math.max(0, (SIZE - PAD - py) / (SIZE - PAD * 2)));
  }

  function draw(): void {
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);

    const [p1x, p1y, p2x, p2y] = cp;

    // --- grid ---
    ctx.strokeStyle = 'var(--border-bright, #333)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([]);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const px = toCanvasX(t);
      const py = toCanvasY(t);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(SIZE, py);
      ctx.stroke();
    }

    // Anchor points in canvas space
    const ax0 = toCanvasX(0);
    const ay0 = toCanvasY(0); // bottom-left → value=0
    const ax1 = toCanvasX(1);
    const ay1 = toCanvasY(1); // top-right → value=1

    const cp1x = toCanvasX(p1x);
    const cp1y = toCanvasY(p1y);
    const cp2x = toCanvasX(p2x);
    const cp2y = toCanvasY(p2y);

    // --- guide lines (dashed) ---
    ctx.strokeStyle = 'var(--text-dim, #888)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.moveTo(ax0, ay0);
    ctx.lineTo(cp1x, cp1y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(ax1, ay1);
    ctx.lineTo(cp2x, cp2y);
    ctx.stroke();

    ctx.setLineDash([]);

    // --- bezier curve ---
    ctx.strokeStyle = 'var(--accent1, #4af)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax0, ay0);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ax1, ay1);
    ctx.stroke();

    // --- anchor dots ---
    ctx.fillStyle = 'var(--text-dim, #888)';
    for (const [cx, cy] of [[ax0, ay0], [ax1, ay1]] as [number, number][]) {
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- control-point handles ---
    const handleColors = ['var(--accent1, #4af)', 'var(--accent1, #4af)'];
    for (const [i, [hx, hy]] of [[0, [cp1x, cp1y]], [1, [cp2x, cp2y]]] as [number, [number, number]][]) {
      ctx.fillStyle = handleColors[i];
      ctx.strokeStyle = 'var(--background, #1e1e1e)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function hitTest(mx: number, my: number): 0 | 1 | null {
    const [p1x, p1y, p2x, p2y] = cp;
    const handles: [number, number][] = [
      [toCanvasX(p1x), toCanvasY(p1y)],
      [toCanvasX(p2x), toCanvasY(p2y)],
    ];
    for (let i = 0; i < handles.length; i++) {
      const dx = mx - handles[i][0];
      const dy = my - handles[i][1];
      if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_R + 3) {
        return i as 0 | 1;
      }
    }
    return null;
  }

  function getCanvasPos(e: MouseEvent): [number, number] {
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = SIZE / rect.width;
    const scaleY = SIZE / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  }

  function onMouseDown(e: MouseEvent): void {
    const [mx, my] = getCanvasPos(e);
    const hit = hitTest(mx, my);
    if (hit === null) return;
    e.preventDefault();
    dragging = hit;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartCp = [...cp] as BezierTuple;
  }

  function onMouseMove(e: MouseEvent): void {
    if (dragging === null || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = SIZE / rect.width;
    const scaleY = SIZE / rect.height;
    const dx = (e.clientX - dragStartX) * scaleX;
    const dy = (e.clientY - dragStartY) * scaleY;

    const newCp: BezierTuple = [...dragStartCp] as BezierTuple;
    if (dragging === 0) {
      newCp[0] = Math.min(1, Math.max(0, fromCanvasX(toCanvasX(dragStartCp[0]) + dx)));
      newCp[1] = fromCanvasY(toCanvasY(dragStartCp[1]) + dy); // y is unclamped for overshoot
    } else {
      newCp[2] = Math.min(1, Math.max(0, fromCanvasX(toCanvasX(dragStartCp[2]) + dx)));
      newCp[3] = fromCanvasY(toCanvasY(dragStartCp[3]) + dy);
    }
    cp = newCp;
    draw();
    onchange?.(cp);
  }

  function onMouseUp(): void {
    dragging = null;
  }

  onMount(() => {
    if (canvas) {
      ctx = canvas.getContext('2d');
      draw();
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  onDestroy(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  });
</script>

<div class="curve-editor">
  <canvas
    bind:this={canvas}
    width={SIZE}
    height={SIZE}
    onmousedown={onMouseDown}
    title="Drag control points to adjust easing curve"
  ></canvas>
  <div class="curve-editor__values">
    <span class="curve-editor__label">cp1</span>
    <span class="curve-editor__num">{cp[0].toFixed(2)}, {cp[1].toFixed(2)}</span>
    <span class="curve-editor__label">cp2</span>
    <span class="curve-editor__num">{cp[2].toFixed(2)}, {cp[3].toFixed(2)}</span>
  </div>
</div>

<style>
  .curve-editor {
    display: inline-flex;
    flex-direction: column;
    gap: 4px;
    user-select: none;
  }

  canvas {
    display: block;
    width: 150px;
    height: 150px;
    cursor: crosshair;
    border: 1px solid var(--border-bright, #333);
    border-radius: 3px;
    background: var(--background-deeper, #161616);
  }

  .curve-editor__values {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    color: var(--text-dim, #888);
  }

  .curve-editor__label {
    font-weight: 600;
    color: var(--text-dim, #888);
  }

  .curve-editor__num {
    color: var(--text, #ccc);
    font-variant-numeric: tabular-nums;
  }
</style>
