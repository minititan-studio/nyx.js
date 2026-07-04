<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * RoomBackgroundsEditor.svelte
     * Migrated from: room-backgrounds-editor.tag
     *
     * List of room backgrounds with add/remove and per-background field editing:
     * texture dropdown, depth, x/y offset, parallax X/Y, movement X/Y,
     * and repeat X/Y toggles.
     *
     * All mutations go through `onchange(backgrounds)`.
     */
    import type { NyxRoom, NyxTexture, NyxBackground } from '@nyx/shared';

    interface Props {
        room: NyxRoom;
        textures: NyxTexture[];
        onchange: (backgrounds: NyxBackground[]) => void;
    }
    let { room, textures, onchange }: Props = $props();

    function addBackground(): void {
        const bg: NyxBackground = {
            uid:         crypto.randomUUID(),
            textureUid:  '',
            depth:       0,
            x:           0,
            y:           0,
            parallaxX:   1,
            parallaxY:   1,
            movementX:   0,
            movementY:   0,
            repeatX:     true,
            repeatY:     true,
        };
        onchange([...room.backgrounds, bg]);
    }

    function removeBackground(uid: string): void {
        onchange(room.backgrounds.filter(b => b.uid !== uid));
    }

    function updateBg<K extends keyof NyxBackground>(uid: string, key: K, value: NyxBackground[K]): void {
        onchange(room.backgrounds.map(b => b.uid === uid ? { ...b, [key]: value } : b));
    }

    function numVal(e: Event): number {
        return parseFloat((e.target as HTMLInputElement).value) || 0;
    }
    function intVal(e: Event): number {
        return parseInt((e.target as HTMLInputElement).value, 10) || 0;
    }
</script>

<div class="bg-editor">
    <ul class="bg-list">
        {#each room.backgrounds as bg, idx (bg.uid)}
            <li class="bg-card">
                <details open={idx === 0}>
                    <summary class="bg-card-header">
                        <span class="crop">
                            {textures.find(t => t.uid === bg.textureUid)?.name ?? '(no texture)'}
                        </span>
                        <button
                            class="icon-sm danger"
                            title="Remove background"
                            onclick={(e) => { e.stopPropagation(); removeBackground(bg.uid); }}
                        >
                            <Icon icon="feather:trash-2" class="feather"/>
                        </button>
                    </summary>

                    <div class="bg-fields">
                        <span class="field-label">Texture</span>
                        <select
                            class="full-w"
                            value={bg.textureUid}
                            onchange={(e) => updateBg(bg.uid, 'textureUid', (e.target as HTMLSelectElement).value)}
                        >
                            <option value="">(none)</option>
                            {#each textures as tex}
                                <option value={tex.uid}>{tex.name}</option>
                            {/each}
                        </select>

                        <span class="field-label">Depth</span>
                        <input
                            type="number" step="1" class="full-w"
                            value={bg.depth}
                            aria-label="Depth"
                            onchange={(e) => updateBg(bg.uid, 'depth', intVal(e))}
                        />

                        <span class="field-label">Offset</span>
                        <div class="xy-row">
                            <label>
                                X<input
                                    type="number" step="8"
                                    value={bg.x}
                                    onchange={(e) => updateBg(bg.uid, 'x', numVal(e))}
                                />
                            </label>
                            <label>
                                Y<input
                                    type="number" step="8"
                                    value={bg.y}
                                    onchange={(e) => updateBg(bg.uid, 'y', numVal(e))}
                                />
                            </label>
                        </div>

                        <span class="field-label">Parallax</span>
                        <div class="xy-row">
                            <label>
                                X<input
                                    type="number" step="0.1"
                                    value={bg.parallaxX}
                                    onchange={(e) => updateBg(bg.uid, 'parallaxX', numVal(e))}
                                />
                            </label>
                            <label>
                                Y<input
                                    type="number" step="0.1"
                                    value={bg.parallaxY}
                                    onchange={(e) => updateBg(bg.uid, 'parallaxY', numVal(e))}
                                />
                            </label>
                        </div>

                        <span class="field-label">Movement</span>
                        <div class="xy-row">
                            <label>
                                X<input
                                    type="number" step="1"
                                    value={bg.movementX}
                                    onchange={(e) => updateBg(bg.uid, 'movementX', numVal(e))}
                                />
                            </label>
                            <label>
                                Y<input
                                    type="number" step="1"
                                    value={bg.movementY}
                                    onchange={(e) => updateBg(bg.uid, 'movementY', numVal(e))}
                                />
                            </label>
                        </div>

                        <span class="field-label">Repeat</span>
                        <div class="repeat-row">
                            <label class="check-label">
                                <input
                                    type="checkbox"
                                    checked={bg.repeatX}
                                    onchange={(e) => updateBg(bg.uid, 'repeatX', (e.target as HTMLInputElement).checked)}
                                />
                                X
                            </label>
                            <label class="check-label">
                                <input
                                    type="checkbox"
                                    checked={bg.repeatY}
                                    onchange={(e) => updateBg(bg.uid, 'repeatY', (e.target as HTMLInputElement).checked)}
                                />
                                Y
                            </label>
                        </div>
                    </div>
                </details>
            </li>
        {/each}
    </ul>

    {#if room.backgrounds.length === 0}
        <p class="dim small empty-hint">No backgrounds yet.</p>
    {/if}

    <button class="add-btn" onclick={addBackground}>
        <Icon icon="feather:plus" class="feather"/>
        Add background
    </button>
</div>

<style>
    .bg-editor {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .bg-list {
        list-style: none;
        margin: 0;
        padding: 0;
        flex: 1 1 auto;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding-bottom: 0.25rem;
    }

    .bg-card {
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 4px;
        background: var(--background-deeper, #111122);
        overflow: hidden;
    }

    .bg-card-header {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.25rem 0.5rem;
        cursor: pointer;
        font-size: 0.82rem;
        color: var(--text, #e0e0e0);
        list-style: none;
    }
    .bg-card-header::-webkit-details-marker { display: none; }
    .bg-card-header:hover { background: var(--act, #1e2233); }
    .bg-card-header .crop {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .bg-fields {
        display: grid;
        grid-template-columns: 5rem 1fr;
        gap: 0.25rem 0.5rem;
        align-items: center;
        padding: 0.4rem 0.5rem 0.5rem;
        border-top: 1px solid var(--border-pale, #2a2a3e);
    }
    .field-label {
        font-size: 0.78rem;
        color: var(--text-dim, #888);
    }
    .full-w { width: 100%; box-sizing: border-box; }

    .xy-row {
        display: flex;
        gap: 0.35rem;
    }
    .xy-row label {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        font-size: 0.78rem;
        color: var(--text-dim, #888);
        flex: 1 1 0;
    }
    .xy-row label input {
        flex: 1 1 0;
        width: 0;
        min-width: 0;
    }

    .repeat-row {
        display: flex;
        gap: 0.75rem;
    }
    .check-label {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.82rem;
        color: var(--text, #e0e0e0);
        cursor: pointer;
    }

    select,
    input[type="number"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.8rem;
    }
    select:focus,
    input[type="number"]:focus {
        outline: none;
        border-color: var(--accent1, #446adb);
    }

    .add-btn {
        flex-shrink: 0;
        margin-top: 0.25rem;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.3rem;
        padding: 0.3rem;
        font-size: 0.82rem;
        background: transparent;
        border: 1px dashed var(--border-bright, #333);
        border-radius: 4px;
        color: var(--text-dim, #888);
        cursor: pointer;
    }
    .add-btn:hover {
        color: var(--text, #e0e0e0);
        border-color: var(--accent1, #446adb);
    }
    .add-btn svg {
        width: 0.85rem;
        height: 0.85rem;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
    }

    .icon-sm {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        padding: 0;
        flex-shrink: 0;
        border: 1px solid transparent;
        border-radius: 3px;
        background: transparent;
        color: var(--text-dim, #888);
        cursor: pointer;
    }
    .icon-sm svg {
        width: 0.8rem;
        height: 0.8rem;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
    }
    .icon-sm:hover {
        color: var(--text, #e0e0e0);
        background: var(--act, #1e2233);
        border-color: var(--border-bright, #333);
    }
    .icon-sm.danger:hover {
        color: var(--danger, #e74c3c);
        border-color: var(--danger, #e74c3c);
        background: transparent;
    }

    .empty-hint { padding: 0.25rem 0; }
    p     { margin: 0; font-size: 0.85rem; }
    .small { font-size: 0.78rem; }
    .dim   { color: var(--text-dim, #888); }
</style>
