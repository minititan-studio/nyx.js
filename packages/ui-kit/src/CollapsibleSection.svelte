<script lang="ts">
  /**
   * CollapsibleSection — collapsible panel with header + arrow
   * Ported from: src/riotTags/shared/collapsible-section.tag
   *
   * Behavior preserved:
   * - Header row: rotating arrow chevron + title text (bold)
   * - Clicking header toggles open/closed state
   * - Slot content is hidden (not destroyed) when collapsed
   * - `open` prop is reactive — external callers can control initial state
   * - Arrow rotates 90° when collapsed, 0° when open (pointing down/right)
   */

  import { slide } from 'svelte/transition';

  interface Props {
    title: string;
    open?: boolean;
    children?: import('svelte').Snippet;
  }

  let {
    title,
    open = $bindable(true),
    children,
  }: Props = $props();

  function toggle(): void {
    open = !open;
  }
</script>

<section class="collapsible-section">
  <button
    class="collapsible-section__header"
    type="button"
    onclick={toggle}
    aria-expanded={open}
  >
    <span class="collapsible-section__arrow" class:open>▶</span>
    <span class="collapsible-section__title">{title}</span>
  </button>

  {#if open}
    <div class="collapsible-section__body" transition:slide={{ duration: 150 }}>
      {#if children}
        {@render children()}
      {/if}
    </div>
  {/if}
</section>

<style>
  .collapsible-section {
    border: 1px solid var(--border-pale);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .collapsible-section__header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--background-deeper);
    border: none;
    cursor: pointer;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    transition: background 0.1s;
  }

  .collapsible-section__header:hover {
    background: var(--background-alt);
  }

  .collapsible-section__arrow {
    font-size: 10px;
    color: var(--text-dim);
    transition: transform 0.15s ease;
    transform: rotate(90deg); /* default = open, pointing down */
    display: inline-block;
    flex-shrink: 0;
    line-height: 1;
  }

  .collapsible-section__arrow.open {
    transform: rotate(90deg);
  }

  /* When closed, arrow points right */
  .collapsible-section__header[aria-expanded="false"] .collapsible-section__arrow {
    transform: rotate(0deg);
  }

  .collapsible-section__title {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .collapsible-section__body {
    padding: 8px 10px;
    background: var(--background);
    border-top: 1px solid var(--border-pale);
  }
</style>
