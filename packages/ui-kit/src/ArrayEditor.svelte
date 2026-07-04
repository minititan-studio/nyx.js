<script lang="ts">
  /**
   * ArrayEditor — editable list of string items
   * Ported from: src/riotTags/shared/array-editor.tag
   *
   * Behavior preserved:
   * - Renders each item as an editable text field
   * - Each row has a delete (×) button on the right
   * - "Add item" button at the bottom appends an empty string
   * - Editing a field updates the value in place
   * - onchange fires after every mutation (add, delete, edit)
   * - Items array is treated immutably — always cloned before mutation
   */

  interface Props {
    items?: string[];
    placeholder?: string;
    addLabel?: string;
    onchange?: (items: string[]) => void;
  }

  let {
    items = $bindable([]),
    placeholder = 'Value…',
    addLabel = 'Add item',
    onchange,
  }: Props = $props();

  function emit(next: string[]): void {
    items = next;
    onchange?.(next);
  }

  function addItem(): void {
    emit([...items, '']);
  }

  function removeItem(index: number): void {
    emit(items.filter((_, i) => i !== index));
  }

  function onItemInput(index: number, e: Event): void {
    const next = [...items];
    next[index] = (e.target as HTMLInputElement).value;
    emit(next);
  }
</script>

<div class="array-editor">
  <ul class="array-editor__list">
    {#each items as item, i (i)}
      <li class="array-editor__row">
        <input
          class="array-editor__field"
          type="text"
          value={item}
          {placeholder}
          oninput={(e) => onItemInput(i, e)}
          aria-label="Item {i + 1}"
        />
        <button
          class="array-editor__delete"
          type="button"
          onclick={() => removeItem(i)}
          aria-label="Remove item {i + 1}"
          title="Remove"
        >×</button>
      </li>
    {/each}
  </ul>

  <button
    class="array-editor__add"
    type="button"
    onclick={addItem}
  >+ {addLabel}</button>
</div>

<style>
  .array-editor {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }

  .array-editor__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .array-editor__row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .array-editor__field {
    flex: 1;
    padding: 3px 6px;
    background: var(--background-deeper);
    border: 1px solid var(--border-pale);
    border-radius: 3px;
    color: var(--text);
    font-size: 13px;
    outline: none;
    min-width: 0;
  }

  .array-editor__field:focus {
    border-color: var(--accent1);
  }

  .array-editor__delete {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--text-dim);
    font-size: 16px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    flex-shrink: 0;
    transition: background 0.1s, color 0.1s;
  }

  .array-editor__delete:hover {
    background: var(--error);
    color: #fff;
    border-color: var(--error);
  }

  .array-editor__add {
    align-self: flex-start;
    padding: 4px 10px;
    background: var(--background-alt);
    border: 1px solid var(--border-pale);
    border-radius: 3px;
    color: var(--text-dim);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .array-editor__add:hover {
    background: var(--accent1);
    color: #fff;
    border-color: var(--accent1);
  }
</style>
