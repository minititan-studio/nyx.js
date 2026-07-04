<script lang="ts">
  /**
   * HoverHint — tooltip wrapper
   * Ported from: src/riotTags/shared/hover-hint.tag
   *
   * Behavior preserved:
   * - Wraps arbitrary children via <slot>
   * - Shows a tooltip label near the cursor on hover
   * - Tooltip uses position: fixed so it escapes overflow:hidden parents
   * - Disappears when mouse leaves the trigger area
   * - Tooltip text comes from `hint` prop
   */

  interface Props {
    hint: string;
    children?: import('svelte').Snippet;
  }

  let { hint, children }: Props = $props();

  let visible = $state(false);
  let x = $state(0);
  let y = $state(0);

  function onMouseenter(e: MouseEvent): void {
    visible = true;
    x = e.clientX + 12;
    y = e.clientY + 16;
  }

  function onMousemove(e: MouseEvent): void {
    x = e.clientX + 12;
    y = e.clientY + 16;
  }

  function onMouseleave(): void {
    visible = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="hover-hint"
  onmouseenter={onMouseenter}
  onmousemove={onMousemove}
  onmouseleave={onMouseleave}
>
  {#if children}
    {@render children()}
  {/if}
</span>

{#if visible && hint}
  <div
    class="hover-hint__tooltip"
    style:left="{x}px"
    style:top="{y}px"
    role="tooltip"
  >
    {hint}
  </div>
{/if}

<style>
  .hover-hint {
    display: contents;
  }

  .hover-hint__tooltip {
    position: fixed;
    z-index: 99999;
    background: var(--background-deeper);
    color: var(--text);
    border: 1px solid var(--border-bright);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    line-height: 1.4;
    max-width: 280px;
    white-space: pre-wrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    /* Prevent tooltip from being clipped at viewport edge — handled by fixed position */
  }
</style>
