<script lang="ts">
  /**
   * AssetSelector — Standalone modal asset browser.
   * Ported from: src/riotTags/shared/asset-selector.tag
   *
   * Behavior preserved:
   * - Full-screen dimmer modal
   * - `open` prop controls visibility
   * - Search input filters the asset list
   * - Clicking an asset calls onselect with the uid and closes the modal
   * - Clicking the dimmer backdrop or close button calls onclose
   * - Escape key calls onclose (delegated to ModalWindow)
   */

  import ModalWindow from './ModalWindow.svelte';

  interface AssetEntry {
    uid: string;
    name: string;
  }

  interface Props {
    open?: boolean;
    assetType?: string;
    assets?: AssetEntry[];
    onselect?: (uid: string) => void;
    onclose?: () => void;
  }

  let {
    open = false,
    assetType = '',
    assets = [],
    onselect,
    onclose,
  }: Props = $props();

  let searchQuery = $state('');

  // Reset search whenever the modal opens
  $effect(() => {
    if (open) {
      searchQuery = '';
    }
  });

  const filteredAssets = $derived(
    searchQuery.trim() === ''
      ? assets
      : assets.filter(a =>
          a.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
  );

  function pickAsset(uid: string): void {
    onselect?.(uid);
    onclose?.();
  }
</script>

<ModalWindow
  {open}
  title="Select {assetType}"
  onclose={onclose}
>
  <div class="asset-selector__body">
    <input
      class="asset-selector__search"
      type="search"
      placeholder="Search…"
      bind:value={searchQuery}
      autocomplete="off"
    />

    <ul class="asset-selector__list">
      {#each filteredAssets as asset (asset.uid)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          class="asset-selector__list-item"
          onclick={() => pickAsset(asset.uid)}
          title={asset.name}
        >
          {asset.name}
        </li>
      {/each}
      {#if filteredAssets.length === 0}
        <li class="asset-selector__list-empty">No assets found</li>
      {/if}
    </ul>
  </div>
</ModalWindow>

<style>
  .asset-selector__body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 200px;
  }

  .asset-selector__search {
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

  .asset-selector__search:focus {
    border-color: var(--accent1, #4af);
  }

  .asset-selector__list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    max-height: 380px;
    border: 1px solid var(--border-bright, #333);
    border-radius: 3px;
  }

  .asset-selector__list-item {
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

  .asset-selector__list-item:last-child {
    border-bottom: none;
  }

  .asset-selector__list-item:hover {
    background: var(--accent1, #4af);
    color: #000;
  }

  .asset-selector__list-empty {
    padding: 12px 10px;
    font-size: 12px;
    color: var(--text-dim, #888);
    text-align: center;
    font-style: italic;
  }
</style>
