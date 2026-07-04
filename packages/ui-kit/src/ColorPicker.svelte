<script lang="ts">
  interface Props {
    value?: string;
    disabled?: boolean;
    showAlpha?: boolean;
    onchange?: (color: string) => void;
  }

  let {
    value = $bindable('#ffffff'),
    disabled = false,
    showAlpha = false,
    onchange,
  }: Props = $props();

  let open = $state(false);
  let panelEl: HTMLDivElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  let svCanvas: HTMLCanvasElement | undefined = $state();
  let hueCanvas: HTMLCanvasElement | undefined = $state();
  let alphaCanvas: HTMLCanvasElement | undefined = $state();
  let panelX = $state(0);
  let panelY = $state(0);

  // HSVA
  let hue = $state(0);
  let sat = $state(0);
  let val = $state(1);
  let alpha = $state(1);
  let hexText = $state('FFFFFF');

  // ── Color utilities ──────────────────────────────────────────────────────

  function clamp01(n: number): number {
    return Math.max(0, Math.min(1, n));
  }

  function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const f = (n: number) => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
  }

  function hsvToHex6(h: number, s: number, v: number): string {
    const [r, g, b] = hsvToRgb(h, s, v);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }

  function parseColor(raw: string): { h: number; s: number; v: number; a: number } {
    const s = (raw ?? '').trim().toLowerCase();
    if (/^#[0-9a-f]{8}$/.test(s))
      return { ...rgbToHsv(parseInt(s.slice(1,3),16)/255, parseInt(s.slice(3,5),16)/255, parseInt(s.slice(5,7),16)/255), a: parseInt(s.slice(7,9),16)/255 };
    if (/^#[0-9a-f]{6}$/.test(s))
      return { ...rgbToHsv(parseInt(s.slice(1,3),16)/255, parseInt(s.slice(3,5),16)/255, parseInt(s.slice(5,7),16)/255), a: 1 };
    if (/^#[0-9a-f]{3}$/.test(s))
      return { ...rgbToHsv(parseInt(s[1]+s[1],16)/255, parseInt(s[2]+s[2],16)/255, parseInt(s[3]+s[3],16)/255), a: 1 };
    return { h: 0, s: 0, v: 1, a: 1 };
  }

  function buildOutput(): string {
    const hex6 = hsvToHex6(hue, sat, val);
    if (!showAlpha) return hex6;
    return `${hex6}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
  }

  // Sync from external prop (reads only `value`, writes state — no cycle)
  $effect(() => {
    const p = parseColor(value);
    hue = p.h; sat = p.s; val = p.v; alpha = p.a;
    hexText = hsvToHex6(p.h, p.s, p.v).slice(1).toUpperCase();
  });

  function commit(): void {
    const out = buildOutput();
    value = out;
    hexText = hsvToHex6(hue, sat, val).slice(1).toUpperCase();
    onchange?.(out);
  }

  let currentRgb = $derived(hsvToRgb(hue, sat, val));
  let currentHex6 = $derived(hsvToHex6(hue, sat, val));
  let hueColor = $derived(`hsl(${hue},100%,50%)`);

  // ── Canvas drawing ────────────────────────────────────────────────────────

  function drawSV(): void {
    if (!svCanvas) return;
    const ctx = svCanvas.getContext('2d')!;
    const { width: W, height: H } = svCanvas;
    const [hr, hg, hb] = hsvToRgb(hue, 1, 1);
    ctx.fillStyle = `rgb(${hr},${hg},${hb})`;
    ctx.fillRect(0, 0, W, H);
    const gW = ctx.createLinearGradient(0, 0, W, 0);
    gW.addColorStop(0, 'rgba(255,255,255,1)');
    gW.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gW;
    ctx.fillRect(0, 0, W, H);
    const gB = ctx.createLinearGradient(0, 0, 0, H);
    gB.addColorStop(0, 'rgba(0,0,0,0)');
    gB.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gB;
    ctx.fillRect(0, 0, W, H);
  }

  function drawHue(): void {
    if (!hueCanvas) return;
    const ctx = hueCanvas.getContext('2d')!;
    const { width: W, height: H } = hueCanvas;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawAlpha(): void {
    if (!alphaCanvas) return;
    const ctx = alphaCanvas.getContext('2d')!;
    const { width: W, height: H } = alphaCanvas;
    ctx.clearRect(0, 0, W, H);
    const ts = 5;
    for (let row = 0; row < Math.ceil(H / ts); row++)
      for (let col = 0; col < Math.ceil(W / ts); col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#888' : '#ccc';
        ctx.fillRect(col * ts, row * ts, ts, ts);
      }
    const [r, g, b] = currentRgb;
    const gr = ctx.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, `rgba(${r},${g},${b},0)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},1)`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  }

  // Effects track reactive reads inside the draw functions (hue, currentRgb, canvas refs)
  $effect(() => { if (svCanvas) drawSV(); });
  $effect(() => { if (hueCanvas) drawHue(); });
  $effect(() => { if (alphaCanvas) drawAlpha(); });

  // ── Drag helper ───────────────────────────────────────────────────────────

  function startDrag(onMove: (e: MouseEvent) => void): void {
    const move = (e: MouseEvent) => { e.preventDefault(); onMove(e); };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // ── SV interaction ────────────────────────────────────────────────────────

  function onSVMousedown(e: MouseEvent): void {
    e.preventDefault(); pickSV(e); startDrag(pickSV);
  }

  function pickSV(e: MouseEvent): void {
    if (!svCanvas) return;
    const rect = svCanvas.getBoundingClientRect();
    sat = clamp01((e.clientX - rect.left) / rect.width);
    val = clamp01(1 - (e.clientY - rect.top) / rect.height);
    commit();
  }

  // ── Hue bar interaction ───────────────────────────────────────────────────

  function onHueMousedown(e: MouseEvent): void {
    e.preventDefault(); pickHue(e); startDrag(pickHue);
  }

  function pickHue(e: MouseEvent): void {
    if (!hueCanvas) return;
    const rect = hueCanvas.getBoundingClientRect();
    hue = clamp01((e.clientX - rect.left) / rect.width) * 360;
    commit();
  }

  // ── Alpha bar interaction ─────────────────────────────────────────────────

  function onAlphaMousedown(e: MouseEvent): void {
    e.preventDefault(); pickAlpha(e); startDrag(pickAlpha);
  }

  function pickAlpha(e: MouseEvent): void {
    if (!alphaCanvas) return;
    const rect = alphaCanvas.getBoundingClientRect();
    alpha = clamp01((e.clientX - rect.left) / rect.width);
    commit();
  }

  // ── Input handlers ────────────────────────────────────────────────────────

  function onHexInput(e: Event): void {
    const raw = (e.target as HTMLInputElement).value.replace(/[^0-9a-fA-F]/g, '');
    if (raw.length === 6) {
      const p = rgbToHsv(parseInt(raw.slice(0,2),16)/255, parseInt(raw.slice(2,4),16)/255, parseInt(raw.slice(4,6),16)/255);
      hue = p.h; sat = p.s; val = p.v;
      commit();
    }
  }

  function onHexBlur(e: Event): void {
    (e.target as HTMLInputElement).value = hexText;
  }

  function onChannelInput(ch: 0 | 1 | 2, e: Event): void {
    const v = Math.max(0, Math.min(255, parseInt((e.target as HTMLInputElement).value) || 0));
    const rgb = [...currentRgb] as [number, number, number];
    rgb[ch] = v;
    const p = rgbToHsv(rgb[0]/255, rgb[1]/255, rgb[2]/255);
    if (p.s > 0.01) hue = p.h;
    sat = p.s; val = p.v;
    commit();
  }

  // ── Eyedropper ────────────────────────────────────────────────────────────

  async function openEyedropper(): Promise<void> {
    if (!('EyeDropper' in window)) return;
    try {
      type EyeDropperAPI = { open(): Promise<{ sRGBHex: string }> };
      const dropper = new (window as unknown as { EyeDropper: new () => EyeDropperAPI }).EyeDropper();
      const result = await dropper.open();
      const hex = result.sRGBHex;
      const p = rgbToHsv(parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255);
      hue = p.h; sat = p.s; val = p.v;
      commit();
    } catch { /* cancelled */ }
  }

  // ── Panel positioning (fixed, viewport-aware) ─────────────────────────────

  const PANEL_W = 240;
  const PANEL_H_BASE = 262; // without alpha bar
  const ALPHA_BAR_H = 22;   // bar + gap

  function positionPanel(): void {
    if (!triggerEl) return;
    const PANEL_H = PANEL_H_BASE + (showAlpha ? ALPHA_BAR_H : 0);
    const rect = triggerEl.getBoundingClientRect();
    let x = rect.left;
    let y = rect.bottom + 6;
    if (x + PANEL_W > window.innerWidth - 8) x = window.innerWidth - PANEL_W - 8;
    if (y + PANEL_H > window.innerHeight - 8) y = rect.top - PANEL_H - 6;
    if (x < 8) x = 8;
    panelX = Math.round(x);
    panelY = Math.round(y);
  }

  function toggle(): void {
    if (disabled) return;
    open = !open;
    if (open) requestAnimationFrame(positionPanel);
  }

  function onBackdropClick(e: MouseEvent): void {
    if (panelEl && !panelEl.contains(e.target as Node) && triggerEl && !triggerEl.contains(e.target as Node))
      open = false;
  }
</script>

<svelte:window onclick={open ? onBackdropClick : undefined} />

<span class="color-picker" class:disabled>
  <button
    bind:this={triggerEl}
    class="color-picker__swatch"
    type="button"
    style:--swatch-color={currentHex6}
    style:--swatch-alpha={alpha}
    onclick={toggle}
    {disabled}
    aria-label="Open color picker"
    aria-expanded={open}
    title={buildOutput()}
  ></button>
</span>

{#if open}
  <div
    bind:this={panelEl}
    class="color-picker__panel"
    style:left="{panelX}px"
    style:top="{panelY}px"
  >
    <!-- SV gradient square -->
    <div class="cp-sv-wrap">
      <canvas
        bind:this={svCanvas}
        width={440}
        height={280}
        class="cp-sv-canvas"
        onmousedown={onSVMousedown}
      ></canvas>
      <!-- Cursor: percentage position avoids canvas-px → CSS-px mismatch -->
      <span
        class="cp-sv-thumb"
        style:left="{sat * 100}%"
        style:top="{(1 - val) * 100}%"
        style:background={currentHex6}
      ></span>
    </div>

    <!-- Hue bar -->
    <div class="cp-bar-wrap" onmousedown={onHueMousedown}>
      <canvas bind:this={hueCanvas} width={440} height={24} class="cp-bar-canvas"></canvas>
      <span class="cp-bar-thumb" style:left="{(hue / 360) * 100}%" style:background={hueColor}></span>
    </div>

    <!-- Alpha bar (opt-in) -->
    {#if showAlpha}
      <div class="cp-bar-wrap" onmousedown={onAlphaMousedown}>
        <canvas bind:this={alphaCanvas} width={440} height={24} class="cp-bar-canvas cp-bar-canvas--alpha"></canvas>
        <span class="cp-bar-thumb" style:left="{alpha * 100}%"></span>
      </div>
    {/if}

    <!-- Inputs row -->
    <div class="cp-inputs">
      <div class="cp-preview" style:--swatch-color={currentHex6} style:--swatch-alpha={alpha}></div>

      <div class="cp-field cp-field--hex">
        <input
          class="cp-input"
          type="text"
          maxlength={6}
          value={hexText}
          oninput={onHexInput}
          onblur={onHexBlur}
          spellcheck={false}
          aria-label="Hex colour"
        />
        <span class="cp-label">#</span>
      </div>

      {#each ([['R',0],['G',1],['B',2]] as const) as [label, ch]}
        <div class="cp-field cp-field--rgb">
          <input
            class="cp-input"
            type="number"
            min="0" max="255" step="1"
            value={currentRgb[ch]}
            oninput={(e) => onChannelInput(ch, e)}
            aria-label={label}
          />
          <span class="cp-label">{label}</span>
        </div>
      {/each}

      <button class="cp-eyedropper" type="button" onclick={openEyedropper} title="Pick from screen" aria-label="Eyedropper">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 22l4.5-4.5"/>
          <path d="M13.5 8.5L16 6a3.5 3.5 0 114.95 4.95l-2.5 2.5-5-5z"/>
          <path d="M8.5 13.5l5-5"/>
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .color-picker {
    display: inline-block;
    position: relative;
  }

  /* ── Swatch trigger ───────────────────────────────────────────────────── */
  .color-picker__swatch {
    position: relative;
    width: 24px;
    height: 24px;
    border: 1px solid var(--border-bright);
    border-radius: 3px;
    cursor: pointer;
    padding: 0;
    display: block;
    overflow: hidden;
    background: repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 0 0 / 8px 8px;
    transition: border-color 0.1s;
  }

  .color-picker__swatch::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--swatch-color, #fff);
    opacity: var(--swatch-alpha, 1);
  }

  .color-picker__swatch:hover { border-color: var(--accent1); }
  .color-picker.disabled .color-picker__swatch { cursor: not-allowed; opacity: 0.5; }

  /* ── Panel (fixed, JS-positioned) ────────────────────────────────────── */
  .color-picker__panel {
    position: fixed;
    z-index: 9999;
    width: 240px;
    background: var(--background-deeper, #12121e);
    border: 1px solid var(--border-bright, #3a3a5a);
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ── SV square ────────────────────────────────────────────────────────── */
  .cp-sv-wrap {
    position: relative;
    width: 100%;
    height: 140px;
    border-radius: 4px;
    overflow: hidden;
    cursor: crosshair;
    flex-shrink: 0;
  }

  .cp-sv-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 4px;
  }

  .cp-sv-thumb {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.45);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  /* ── Hue / alpha bars ─────────────────────────────────────────────────── */
  .cp-bar-wrap {
    position: relative;
    height: 12px;
    border-radius: 6px;
    cursor: ew-resize;
    flex-shrink: 0;
    overflow: visible;
  }

  .cp-bar-canvas {
    display: block;
    width: 100%;
    height: 12px;
    border-radius: 6px;
  }

  /* Checkerboard underlay for alpha bar (via background on the wrap) */
  .cp-bar-canvas--alpha {
    background: repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 0 0 / 10px 10px;
    border-radius: 6px;
  }

  .cp-bar-thumb {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2.5px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.45);
    transform: translate(-50%, -50%);
    pointer-events: none;
    background: transparent;
  }

  /* ── Inputs row ───────────────────────────────────────────────────────── */
  .cp-inputs {
    display: flex;
    gap: 4px;
    align-items: flex-end;
  }

  .cp-preview {
    position: relative;
    flex: 0 0 20px;
    height: 20px;
    border-radius: 3px;
    border: 1px solid var(--border-bright, #3a3a5a);
    overflow: hidden;
    background: repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 0 0 / 8px 8px;
    flex-shrink: 0;
    align-self: flex-start;
  }

  .cp-preview::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--swatch-color, #fff);
    opacity: var(--swatch-alpha, 1);
  }

  .cp-field {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 0;
  }

  .cp-field--hex { flex: 1 1 0; min-width: 44px; }
  .cp-field--rgb { flex: 0 0 28px; }

  .cp-input {
    width: 100%;
    padding: 3px 4px;
    background: var(--background-alt, #1e1e30);
    border: 1px solid var(--border-pale, #2a2a44);
    border-radius: 4px;
    color: var(--text, #ccc);
    font-size: 11px;
    font-family: monospace;
    text-align: center;
    outline: none;
    box-sizing: border-box;
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .cp-input::-webkit-outer-spin-button,
  .cp-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .cp-input:focus { border-color: var(--accent1, #5c7aff); }

  .cp-label {
    font-size: 10px;
    color: var(--text-muted, #666);
    line-height: 1;
    font-family: monospace;
  }

  /* ── Eyedropper ───────────────────────────────────────────────────────── */
  .cp-eyedropper {
    flex: 0 0 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--background-alt, #1e1e30);
    border: 1px solid var(--border-pale, #2a2a44);
    border-radius: 4px;
    color: var(--text-muted, #888);
    cursor: pointer;
    padding: 0;
    transition: color 0.1s, border-color 0.1s;
    align-self: flex-start;
  }

  .cp-eyedropper:hover {
    color: var(--text, #ccc);
    border-color: var(--accent1, #5c7aff);
  }
</style>
