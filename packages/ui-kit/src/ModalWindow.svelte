<script lang="ts">
  /**
   * ModalWindow — centered dialog with backdrop
   * Ported from: src/riotTags/shared/modal-window.tag
   *
   * Behavior preserved:
   * - Semi-transparent backdrop covers entire viewport
   * - Centered dialog box with title bar + close button + slot content
   * - Clicking the backdrop closes the modal (calls onclose)
   * - Escape key closes the modal
   * - Fade/scale transition on open/close
   * - `open` prop controls visibility
   */

  import { fade, scale } from 'svelte/transition';

  interface Props {
    open?: boolean;
    title?: string;
    wide?: boolean;
    onclose?: () => void;
    children?: import('svelte').Snippet;
    actions?: import('svelte').Snippet;
  }

  let {
    open = false,
    title = '',
    wide = false,
    onclose,
    children,
    actions,
  }: Props = $props();

  function onBackdropClick(e: MouseEvent): void {
    // Only close if the backdrop itself was clicked (not the dialog content)
    if ((e.target as HTMLElement).classList.contains('modal-backdrop')) {
      onclose?.();
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose?.();
    }
  }
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    transition:fade={{ duration: 150 }}
    onclick={onBackdropClick}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div
      class="modal-window"
      class:wide
      transition:scale={{ duration: 150, start: 0.94 }}
    >
      <!-- Title bar -->
      <div class="modal-window__titlebar">
        <span class="modal-window__title">{title}</span>
        <button
          class="modal-window__close"
          type="button"
          onclick={() => onclose?.()}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>

      <!-- Body -->
      <div class="modal-window__body">
        {#if children}
          {@render children()}
        {/if}
      </div>

      <!-- Optional action buttons row -->
      {#if actions}
        <div class="modal-window__actions">
          {@render actions()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-window {
    background: var(--background);
    border: 1px solid var(--border-bright);
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    min-width: 320px;
    max-width: 600px;
    width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-window.wide {
    max-width: 900px;
  }

  /* Title bar */
  .modal-window__titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 10px 16px;
    background: var(--background-deeper);
    border-bottom: 1px solid var(--border-pale);
    flex-shrink: 0;
  }

  .modal-window__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .modal-window__close {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 3px;
    line-height: 1;
    margin-left: 8px;
    flex-shrink: 0;
    transition: background 0.1s, color 0.1s;
  }

  .modal-window__close:hover {
    background: var(--error);
    color: #fff;
  }

  /* Body */
  .modal-window__body {
    padding: 16px;
    overflow-y: auto;
    flex: 1;
    color: var(--text);
    font-size: 13px;
  }

  /* Actions row */
  .modal-window__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border-pale);
    background: var(--background-deeper);
    flex-shrink: 0;
  }
</style>
