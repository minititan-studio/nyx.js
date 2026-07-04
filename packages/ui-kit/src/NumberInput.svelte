<script lang="ts">
  /**
   * NumberInput — numeric scrubber input
   * Ported from: src/riotTags/shared/number-input.tag
   *
   * Behavior preserved:
   * - Horizontal drag on the label area scrubs the value
   * - Click-only on label focuses the text input
   * - min/max clamping applied after every change
   * - step controls increment/decrement magnitude
   * - onchange fires after every committed change
   */

  interface Props {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    wide?: boolean;
    onchange?: (v: number) => void;
    children?: import('svelte').Snippet;
  }

  let {
    value = $bindable(0),
    min = undefined,
    max = undefined,
    step = 1,
    disabled = false,
    wide = false,
    onchange,
    children,
  }: Props = $props();

  // Internal display value — kept as string so user can type freely
  let inputValue = $state(String(value));

  // Sync display when the bound prop changes externally
  $effect(() => {
    inputValue = String(value);
  });

  // --- scrubber state ---
  let dragging = $state(false);
  let dragStartX = $state(0);
  let dragStartValue = $state(0);
  let dragMoved = $state(false);

  function clamp(v: number): number {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
  }

  function roundToStep(v: number): number {
    if (step === 0) return v;
    const decimals = (step.toString().split('.')[1] ?? '').length;
    return parseFloat((Math.round(v / step) * step).toFixed(decimals));
  }

  function commit(raw: number): void {
    const clamped = clamp(roundToStep(raw));
    value = clamped;
    inputValue = String(clamped);
    onchange?.(clamped);
  }

  // --- label drag (scrubber) ---
  function onLabelMousedown(e: MouseEvent): void {
    if (disabled) return;
    dragging = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartValue = value;

    function onMousemove(me: MouseEvent): void {
      const dx = me.clientX - dragStartX;
      if (Math.abs(dx) > 2) dragMoved = true;
      if (dragMoved) {
        commit(dragStartValue + dx * step);
      }
    }

    function onMouseup(): void {
      dragging = false;
      window.removeEventListener('mousemove', onMousemove);
      window.removeEventListener('mouseup', onMouseup);
    }

    window.addEventListener('mousemove', onMousemove);
    window.addEventListener('mouseup', onMouseup);
  }

  // --- input field handlers ---
  function onInputChange(e: Event): void {
    const raw = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(raw)) {
      commit(raw);
    } else {
      // reset to last valid
      inputValue = String(value);
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      commit(value + step);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      commit(value - step);
    }
  }
</script>

<label
  class="number-input"
  class:wide
  class:disabled
  class:dragging
>
  {#if children}
    <span
      class="number-input__label"
      role="slider"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabindex={disabled ? -1 : 0}
      onmousedown={onLabelMousedown}
    >
      {@render children()}
    </span>
  {/if}
  <input
    class="number-input__field"
    type="number"
    {disabled}
    {min}
    {max}
    {step}
    value={inputValue}
    onchange={onInputChange}
    onkeydown={onKeydown}
  />
</label>

<style>
  .number-input {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text);
  }

  .number-input.wide {
    width: 100%;
  }

  .number-input__label {
    cursor: ew-resize;
    user-select: none;
    color: var(--text-dim);
    padding: 0 4px;
    border-radius: 3px;
    white-space: nowrap;
  }

  .number-input__label:hover {
    background: var(--background-alt);
    color: var(--text);
  }

  .number-input.dragging .number-input__label {
    background: var(--accent1);
    color: #fff;
  }

  .number-input.disabled .number-input__label {
    cursor: default;
    opacity: 0.5;
  }

  .number-input__field {
    width: 64px;
    padding: 2px 6px;
    background: var(--background-deeper);
    border: 1px solid var(--border-pale);
    border-radius: 3px;
    color: var(--text);
    font-size: 13px;
    text-align: right;
    outline: none;

    /* hide browser spin buttons */
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .number-input__field::-webkit-inner-spin-button,
  .number-input__field::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .number-input__field:focus {
    border-color: var(--accent1);
  }

  .number-input.wide .number-input__field {
    flex: 1;
    width: auto;
  }

  .number-input.disabled .number-input__field {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
