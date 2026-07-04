<script lang="ts">
  /**
   * AssetInput — Inline asset reference picker with modal.
   * Ported from: src/riotTags/shared/asset-input.tag
   *
   * Behavior preserved:
   * - Shows asset name (or "None") + a "pick" button
   * - Clicking "pick" opens a modal with a search input and scrollable asset list
   * - Clicking an asset in the modal sets value and closes the modal
   * - "Clear" button sets value to null
   * - onchange is called on every value change
   */

  import ModalWindow from './ModalWindow.svelte';

  interface AssetEntry {
    uid: string;
    name: string;
  }

  interface Props {
    value?: string | null;
    assetType?: string;
    assets?: AssetEntry[];
    onchange?: (uid: string | null) => void;
  }

  let {
    value = null,
    assetType = '',
    assets = [],
    onchange,
  }: Props = $props();

  let modalOpen = $state(false);
  let searchQuery = $state('');

  const currentAsset = $derived(
    value != null ? assets.find(a => a.uid === value) ?? null : null
  );

  const filteredAssets = $derived(
    searchQuery.trim() === ''
      ? assets
      : assets.filter(a =>
          a.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
  );

  function openModal(e: MouseEvent): void {
    e.stopPropagation();
    searchQuery = '';
    modalOpen = true;
  }

  function closeModal(): void {
    modalOpen = false;
  }

  function pickAsset(uid: string): void {
    modalOpen = false;
    onchange?.(uid);
  }

  function clearAsset(e: MouseEvent): void {
    e.stopPropagation();
    onchange?.(null);
  }
</script>

<span class="asset-input">
  <button
    class="asset-input__pick"
    type="button"
    title="Pick {assetType}"
    onclick={openModal}
  >
    {currentAsset ? currentAsset.name : 'None'}
  </button>

  {#if value != null}
    <button
      class="asset-input__clear"
      type="button"
      title="Clear"
      onclick={clearAsset}
      aria-label="Clear asset"
    >
      ✕
    </button>
  {/if}
</span>

<ModalWindow
  open={modalOpen}
  title="Select {assetType}"
  onclose={closeModal}
>
  <div class="asset-input__modal-body">
    <input
      class="asset-input__search"
      type="search"
      placeholder="Search…"
      bind:value={searchQuery}
      autocomplete="off"
    />
    <ul class="asset-input__list">
      {#each filteredAssets as asset (asset.uid)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="asset-input__list-item"
          class:asset-input__list-item--active={asset.uid === value}
          onclick={() => pickAsset(asset.uid)}
          title={asset.name}
        >
          {asset.name}
        </li>
      {/each}
      {#if filteredAssets.length === 0}
        <li class="asset-input__list-empty">No assets found</li>
      {/if}
    </ul>
  </div>
</ModalWindow>

<style>
  .asset-input {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .asset-input__pick {
    background: var(--background-deeper, #161616);
    color: var(--text, #ccc);
    border: 1px solid var(--border-bright, #333);
    border-radius: 3px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: border-color 0.1s;
  }

  .asset-input__pick:hover {
    border-color: var(--accent1, #4af);
  }

  .asset-input__clear {
    background: none;
    border: 1px solid var(--border-bright, #333);
    color: var(--text-dim, #888);
    border-radius: 3px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: background 0.1s, color 0.1s;
  }

  .asset-input__clear:hover {
    background: var(--error, #c44);
    color: #fff;
    border-color: transparent;
  }

  /* Modal body */
  .asset-input__modal-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 200px;
  }

  .asset-input__search {
    width: 100%;
    box-sizing: border-box;
    background: var(--background-deeper, #161616);
    color: var(--text, #ccc);
    border: 1px solid var(--border-bright, #333);
    border-radius: 3px;
    padding: 5px 8px;
    font-size: 12px;
    outline: none;
  }

  .asset-input__search:focus {
    border-color: var(--accent1, #4af);
  }

  .asset-input__list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    max-height: 320px;
    border: 1px solid var(--border-bright, #333);
    border-radius: 3px;
  }

  .asset-input__list-item {
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text, #ccc);
    cursor: pointer;
    border-bottom: 1px solid var(--border-bright, #222);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.08s;
  }

  .asset-input__list-item:last-child {
    border-bottom: none;
  }

  .asset-input__list-item:hover {
    background: var(--background-deeper, #1e1e1e);
  }

  .asset-input__list-item--active {
    background: var(--accent1, #4af);
    color: #000;
  }

  .asset-input__list-item--active:hover {
    background: var(--accent1, #4af);
  }

  .asset-input__list-empty {
    padding: 12px 10px;
    font-size: 12px;
    color: var(--text-dim, #888);
    text-align: center;
    font-style: italic;
  }
</style>
