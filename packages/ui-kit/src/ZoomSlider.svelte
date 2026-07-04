<script lang="ts">
  /**
   * ZoomSlider — range slider with +/- buttons and zoom label
   * Ported from: src/riotTags/shared/zoom-slider.tag
   *
   * Behavior preserved:
   * - Shows current zoom as a percentage label (e.g. "150%")
   * - Range input slider spanning min–max
   * - `-` button decrements by one step
   * - `+` button increments by one step
   * - Value is clamped to [min, max]
   * - onchange fires on every interaction
   */

  interface Props {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    onchange?: (v: number) => void;
  }

  let {
    value = $bindable(1),
    min = 0.1,
    max = 4,
    step = 0.1,
    onchange,
  }: Props = $props();

  let percentLabel = $derived(Math.round(value * 100) + '%');

  function clamp(v: number): number {
    return Math.max(min, Math.min(max, v));
  }

  function roundToStep(v: number): number {
    const decimals = (step.toString().split('.')[1] ?? '').length;
    return parseFloat((Math.round(v / step) * step).toFixed(decimals));
  }

  function commit(raw: number): void {
    const next = clamp(roundToStep(raw));
    value = next;
    onchange?.(next);
  }

  function onSliderInput(e: Event): void {
    commit(Number((e.target as HTMLInputElement).value));
  }

  function decrement(): void {
    commit(value - step);
  }

  function increment(): void {
    commit(value + step);
  }
</script>

<span class="zoom-slider">
  <button
    class="zoom-slider__btn"
    type="button"
    onclick={decrement}
    disabled={value <= min}
    aria-label="Zoom out"
    title="Zoom out"
  >−</button>

  <input
    class="zoom-slider__range"
    type="range"
    {min}
    {max}
    {step}
    value={value}
    oninput={onSliderInput}
    aria-label="Zoom level"
  />

  <button
    class="zoom-slider__btn"
    type="button"
    onclick={increment}
    disabled={value >= max}
    aria-label="Zoom in"
    title="Zoom in"
  >+</button>

  <span class="zoom-slider__label">{percentLabel}</span>
</span>

<style>
  .zoom-slider {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text);
    user-select: none;
  }

  .zoom-slider__btn {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--background-alt);
    border: 1px solid var(--border-pale);
    border-radius: 3px;
    color: var(--text);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .zoom-slider__btn:hover:not(:disabled) {
    background: var(--background-deeper);
    border-color: var(--border-bright);
  }

  .zoom-slider__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .zoom-slider__range {
    width: 100px;
    cursor: pointer;
    accent-color: var(--accent1);
  }

  .zoom-slider__label {
    min-width: 40px;
    text-align: right;
    color: var(--text-dim);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
</style>
