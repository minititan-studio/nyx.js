<script lang="ts">
  /**
   * ColorInput — inline color swatch + hex text field
   * Ported from: src/riotTags/shared/color-input.tag
   *
   * Behavior preserved:
   * - Colored swatch square on the left; clicking it opens a native color picker
   * - Hex text field allows direct hex editing (#RRGGBB)
   * - Changes from either control emit onchange with the new hex string
   * - Native <input type="color"> is kept hidden and programmatically clicked
   */

  interface Props {
    value?: string;
    disabled?: boolean;
    onchange?: (color: string) => void;
  }

  let {
    value = $bindable('#ffffff'),
    disabled = false,
    onchange,
  }: Props = $props();

  let nativeInput: HTMLInputElement | undefined = $state();
  let hexText = $state(normalizeHex(value));

  $effect(() => {
    hexText = normalizeHex(value);
  });

  /** Ensure #RRGGBB format, fall back to white */
  function normalizeHex(raw: string): string {
    const s = raw?.trim() ?? '';
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    // 3-digit short form
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      const [, r, g, b] = s;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    // bare 6 hex digits
    if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`.toLowerCase();
    return '#ffffff';
  }

  function commit(hex: string): void {
    const normalized = normalizeHex(hex);
    value = normalized;
    hexText = normalized;
    onchange?.(normalized);
  }

  function onSwatchClick(): void {
    if (disabled) return;
    nativeInput?.click();
  }

  function onNativeChange(e: Event): void {
    commit((e.target as HTMLInputElement).value);
  }

  function onHexInput(e: Event): void {
    const raw = (e.target as HTMLInputElement).value;
    if (/^#?[0-9a-fA-F]{6}$/.test(raw.trim())) {
      commit(raw.trim());
    }
  }

  function onHexBlur(e: Event): void {
    // Reset to last valid value if the field contains garbage
    const raw = (e.target as HTMLInputElement).value;
    if (!/^#?[0-9a-fA-F]{6}$/.test(raw.trim())) {
      hexText = normalizeHex(value);
    }
  }
</script>

<span class="color-input" class:disabled>
  <!-- Hidden native color picker (for palette/OS color dialog) -->
  <input
    bind:this={nativeInput}
    class="color-input__native"
    type="color"
    value={normalizeHex(value)}
    {disabled}
    onchange={onNativeChange}
    aria-hidden="true"
    tabindex="-1"
  />

  <!-- Colored swatch -->
  <button
    class="color-input__swatch"
    type="button"
    style:background={normalizeHex(value)}
    onclick={onSwatchClick}
    {disabled}
    aria-label="Open color picker"
    title={normalizeHex(value)}
  ></button>

  <!-- Hex text field -->
  <input
    class="color-input__hex"
    type="text"
    maxlength={7}
    value={hexText}
    {disabled}
    oninput={onHexInput}
    onblur={onHexBlur}
    spellcheck={false}
    aria-label="Hex color value"
  />
</span>

<style>
  .color-input {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
  }

  .color-input__native {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }

  .color-input__swatch {
    width: 22px;
    height: 22px;
    border: 1px solid var(--border-bright);
    border-radius: 3px;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: border-color 0.1s;
  }

  .color-input__swatch:hover {
    border-color: var(--accent1);
  }

  .color-input.disabled .color-input__swatch {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .color-input__hex {
    width: 78px;
    padding: 2px 6px;
    background: var(--background-deeper);
    border: 1px solid var(--border-pale);
    border-radius: 3px;
    color: var(--text);
    font-size: 12px;
    font-family: monospace;
    outline: none;
  }

  .color-input__hex:focus {
    border-color: var(--accent1);
  }

  .color-input.disabled .color-input__hex {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
