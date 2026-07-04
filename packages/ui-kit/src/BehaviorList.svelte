<script lang="ts">
  /**
   * BehaviorList — Behavior attachment list.
   * Ported from: src/riotTags/shared/behavior-list.tag
   *
   * Behavior preserved:
   * - Shows each attached behavior by name with Up/Down reorder buttons and a Remove button
   * - "Add behavior" button opens an inline dropdown of available (not yet attached) behaviors
   * - Clicking an item in the dropdown adds it and closes the dropdown
   * - Move-up / move-down arrows are hidden (opacity:0) at the list boundaries
   * - onchange called after every mutation
   */

  interface BehaviorEntry {
    uid: string;
    name: string;
  }

  interface Props {
    value?: string[];
    behaviors?: BehaviorEntry[];
    onchange?: (uids: string[]) => void;
  }

  let {
    value = [],
    behaviors = [],
    onchange,
  }: Props = $props();

  // Local mutable copy so we don't mutate the caller's array in-place
  let attached = $state<string[]>([...value]);

  // Keep in sync when prop changes externally
  $effect(() => {
    attached = [...value];
  });

  let dropdownOpen = $state(false);
  let dropdownSearch = $state('');

  const available = $derived(
    behaviors.filter(b => !attached.includes(b.uid))
  );

  const filteredAvailable = $derived(
    dropdownSearch.trim() === ''
      ? available
      : available.filter(b =>
          b.name.toLowerCase().includes(dropdownSearch.toLowerCase())
        )
  );

  function getName(uid: string): string {
    return behaviors.find(b => b.uid === uid)?.name ?? uid;
  }

  function moveUp(index: number): void {
    if (index === 0) return;
    const next = [...attached];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    attached = next;
    onchange?.(attached);
  }

  function moveDown(index: number): void {
    if (index === attached.length - 1) return;
    const next = [...attached];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    attached = next;
    onchange?.(attached);
  }

  function removeBehavior(uid: string): void {
    attached = attached.filter(id => id !== uid);
    onchange?.(attached);
  }

  function addBehavior(uid: string): void {
    attached = [...attached, uid];
    dropdownOpen = false;
    dropdownSearch = '';
    onchange?.(attached);
  }

  function toggleDropdown(): void {
    dropdownOpen = !dropdownOpen;
    if (dropdownOpen) dropdownSearch = '';
  }

  function closeDropdown(): void {
    dropdownOpen = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="behavior-list" onkeydown={e => e.key === 'Escape' && closeDropdown()}>
  {#if attached.length > 0}
    <ul class="behavior-list__list">
      {#each attached as uid, i (uid)}
        <li class="behavior-list__item">
          <span class="behavior-list__name" title={getName(uid)}>
            {getName(uid)}
          </span>

          <span class="behavior-list__spacer"></span>

          <span class="behavior-list__actions">
            <button
              class="behavior-list__icon-btn"
              type="button"
              title="Move up"
              style={i === 0 ? 'opacity:0;pointer-events:none' : ''}
              onclick={() => moveUp(i)}
              tabindex={i === 0 ? -1 : 0}
            >
              ▲
            </button>

            <button
              class="behavior-list__icon-btn"
              type="button"
              title="Move down"
              style={i === attached.length - 1 ? 'opacity:0;pointer-events:none' : ''}
              onclick={() => moveDown(i)}
              tabindex={i === attached.length - 1 ? -1 : 0}
            >
              ▼
            </button>

            <button
              class="behavior-list__icon-btn behavior-list__icon-btn--remove"
              type="button"
              title="Remove behavior"
              onclick={() => removeBehavior(uid)}
            >
              ✕
            </button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="behavior-list__add-wrap">
    <button
      class="behavior-list__add-btn"
      type="button"
      onclick={toggleDropdown}
    >
      + Add behavior
    </button>

    {#if dropdownOpen}
      <div class="behavior-list__dropdown">
        <input
          class="behavior-list__dropdown-search"
          type="search"
          placeholder="Search behaviors…"
          bind:value={dropdownSearch}
          autocomplete="off"
        />
        <ul class="behavior-list__dropdown-list">
          {#each filteredAvailable as b (b.uid)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <li
              class="behavior-list__dropdown-item"
              onclick={() => addBehavior(b.uid)}
              title={b.name}
            >
              {b.name}
            </li>
          {/each}
          {#if filteredAvailable.length === 0}
            <li class="behavior-list__dropdown-empty">No behaviors available</li>
          {/if}
        </ul>
      </div>
    {/if}
  </div>
</div>

<style>
  .behavior-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    position: relative;
  }

  /* Attached list */
  .behavior-list__list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border-bright, #333);
    border-radius: 3px;
    overflow: hidden;
  }

  .behavior-list__item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 4px 10px;
    font-size: 12px;
    color: var(--text, #ccc);
    border-bottom: 1px solid var(--border-bright, #222);
    background: var(--background-deeper, #161616);
    min-height: 28px;
  }

  .behavior-list__item:nth-child(even) {
    background: var(--background, #1e1e1e);
  }

  .behavior-list__item:last-child {
    border-bottom: none;
  }

  .behavior-list__name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .behavior-list__spacer {
    flex: 0 0 4px;
  }

  .behavior-list__actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .behavior-list__icon-btn {
    background: none;
    border: none;
    color: var(--text-dim, #888);
    font-size: 10px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 2px;
    line-height: 1;
    transition: background 0.1s, color 0.1s;
  }

  .behavior-list__icon-btn:hover {
    background: var(--background, #1e1e1e);
    color: var(--text, #ccc);
  }

  .behavior-list__icon-btn--remove:hover {
    background: var(--error, #c44);
    color: #fff;
  }

  /* Add behavior button */
  .behavior-list__add-wrap {
    position: relative;
  }

  .behavior-list__add-btn {
    width: 100%;
    background: var(--background-deeper, #161616);
    color: var(--text, #ccc);
    border: 1px dashed var(--border-bright, #333);
    border-radius: 3px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.1s, background 0.1s;
  }

  .behavior-list__add-btn:hover {
    border-color: var(--accent1, #4af);
    background: var(--background, #1e1e1e);
  }

  /* Dropdown */
  .behavior-list__dropdown {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    z-index: 1000;
    background: var(--background, #1e1e1e);
    border: 1px solid var(--border-bright, #333);
    border-radius: 3px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    max-height: 220px;
  }

  .behavior-list__dropdown-search {
    box-sizing: border-box;
    width: 100%;
    background: var(--background-deeper, #161616);
    color: var(--text, #ccc);
    border: none;
    border-bottom: 1px solid var(--border-bright, #333);
    padding: 5px 8px;
    font-size: 12px;
    outline: none;
    flex-shrink: 0;
  }

  .behavior-list__dropdown-search:focus {
    border-bottom-color: var(--accent1, #4af);
  }

  .behavior-list__dropdown-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
  }

  .behavior-list__dropdown-item {
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

  .behavior-list__dropdown-item:last-child {
    border-bottom: none;
  }

  .behavior-list__dropdown-item:hover {
    background: var(--accent1, #4af);
    color: #000;
  }

  .behavior-list__dropdown-empty {
    padding: 10px;
    font-size: 12px;
    color: var(--text-dim, #888);
    text-align: center;
    font-style: italic;
  }
</style>
