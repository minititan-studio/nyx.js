<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * RoomProperties.svelte
     * Migrated from: room-properties.tag
     *
     * Displays and edits the basic room settings: dimensions, background colour,
     * view mode, starting-room flag, and grid / snapping configuration.
     *
     * Intentionally self-contained — all mutations go through `onchange`.
     */
    import type { NyxRoom } from '@nyx/shared';
    import { currentProject } from '../../../stores/projectStore';

    interface Props {
        room: NyxRoom;
        onchange: (patch: Partial<NyxRoom>) => void;
    }
    let { room, onchange }: Props = $props();

    const hasMatter = $derived('matter' in ($currentProject?.modules ?? {}));
    const hasLight  = $derived('light'  in ($currentProject?.modules ?? {}));

    const VIEW_MODES = [
        { value: 'asIs',             label: 'As is' },
        { value: 'fastScale',        label: 'Fast scale' },
        { value: 'fastScaleInteger', label: 'Integer scale' },
        { value: 'expand',           label: 'Expand' },
        { value: 'scaleFit',         label: 'Scale fit' },
        { value: 'scaleFill',        label: 'Scale fill' },
    ] as const;
</script>

<div class="room-props">
    <fieldset>
        <legend>Dimensions</legend>
        <div class="field-grid">
            <span>Width</span>
            <input
                type="number" min="1" step="8"
                value={room.width}
                onchange={(e) => onchange({ width: Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || room.width) })}
            />
            <span>Height</span>
            <input
                type="number" min="1" step="8"
                value={room.height}
                onchange={(e) => onchange({ height: Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || room.height) })}
            />
        </div>
    </fieldset>

    <fieldset>
        <legend>Appearance</legend>
        <div class="field-grid">
            <span>Background</span>
            <div class="color-row">
                <input
                    type="color"
                    value={room.backgroundColor}
                    onchange={(e) => onchange({ backgroundColor: (e.target as HTMLInputElement).value })}
                />
                <input
                    type="text" class="hex"
                    value={room.backgroundColor}
                    onchange={(e) => onchange({ backgroundColor: (e.target as HTMLInputElement).value })}
                />
            </div>
            <span>View mode</span>
            <select
                value={room.viewMode}
                onchange={(e) => onchange({ viewMode: (e.target as HTMLSelectElement).value as NyxRoom['viewMode'] })}
            >
                {#each VIEW_MODES as vm}
                    <option value={vm.value}>{vm.label}</option>
                {/each}
            </select>
        </div>
    </fieldset>

    <fieldset>
        <legend>Options</legend>
        <label class="checkbox-wrap">
            <input
                type="checkbox"
                checked={room.isStartingRoom}
                onchange={(e) => onchange({ isStartingRoom: (e.target as HTMLInputElement).checked })}
            />
            <span>Starting room</span>
        </label>
    </fieldset>

    <fieldset>
        <legend>Grid / Snapping</legend>
        <div class="field-grid">
            <span>Grid X</span>
            <input
                type="number" min="1" step="1"
                value={room.gridX ?? 32}
                onchange={(e) => onchange({ gridX: Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 32) })}
            />
            <span>Grid Y</span>
            <input
                type="number" min="1" step="1"
                value={room.gridY ?? 32}
                onchange={(e) => onchange({ gridY: Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 32) })}
            />
        </div>
        <label class="checkbox-wrap" style:margin-top="0.3rem">
            <input
                type="checkbox"
                checked={room.diagonalGrid ?? false}
                onchange={(e) => onchange({ diagonalGrid: (e.target as HTMLInputElement).checked })}
            />
            <span>Diagonal grid</span>
        </label>
        <label class="checkbox-wrap">
            <input
                type="checkbox"
                checked={room.disableGrid ?? false}
                onchange={(e) => onchange({ disableGrid: (e.target as HTMLInputElement).checked })}
            />
            <span>Disable grid snapping</span>
        </label>
    </fieldset>

    {#if hasMatter}
    <fieldset>
        <legend>Physics</legend>
        <div class="field-grid">
            <span>Gravity X</span>
            <input
                type="number" step="0.1"
                value={room.matterGravity?.[0] ?? 0}
                onchange={(e) => onchange({ matterGravity: [parseFloat((e.target as HTMLInputElement).value) || 0, room.matterGravity?.[1] ?? 9.8] })}
            />
            <span>Gravity Y</span>
            <input
                type="number" step="0.1"
                value={room.matterGravity?.[1] ?? 9.8}
                onchange={(e) => onchange({ matterGravity: [room.matterGravity?.[0] ?? 0, parseFloat((e.target as HTMLInputElement).value) || 0] })}
            />
        </div>
    </fieldset>
    {/if}

    {#if hasLight}
    <fieldset>
        <legend>Lighting</legend>
        <div class="field-grid">
            <span>Ambient</span>
            <div class="color-row">
                <input
                    type="color"
                    value={room.lightAmbientColor ?? '#FFFFFF'}
                    onchange={(e) => onchange({ lightAmbientColor: (e.target as HTMLInputElement).value })}
                />
                <input
                    type="text" class="hex"
                    value={room.lightAmbientColor ?? '#FFFFFF'}
                    onchange={(e) => onchange({ lightAmbientColor: (e.target as HTMLInputElement).value })}
                />
            </div>
            <span>Opacity</span>
            <input
                type="number" min="0" max="1" step="0.05"
                value={room.lightAmbientOpacity ?? 1}
                onchange={(e) => onchange({ lightAmbientOpacity: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 1)) })}
            />
        </div>
        <label class="checkbox-wrap" style:margin-top="0.4rem">
            <input
                type="checkbox"
                checked={room.editorLightPreview ?? false}
                onchange={(e) => onchange({ editorLightPreview: (e.target as HTMLInputElement).checked })}
            />
            <span>Preview lighting in editor</span>
        </label>
        <p class="dim small hint">Simulates light and shadow on the canvas. May affect editor performance.</p>
    </fieldset>
    {/if}

    <fieldset>
        <legend>Contents</legend>
        <div class="stat-row">
            <Icon icon="feather:box" class="feather"/>
            <span>{room.copies.length} cop{room.copies.length === 1 ? 'y' : 'ies'}</span>
        </div>
        <div class="stat-row">
            <Icon icon="feather:image" class="feather"/>
            <span>{room.backgrounds.length} background{room.backgrounds.length === 1 ? '' : 's'}</span>
        </div>
        <p class="dim small">Use the Copies tab to place and select.</p>
    </fieldset>
</div>

<style>
    .room-props {
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    fieldset {
        border: 1px solid var(--border-pale, #2a2a3e);
        border-radius: 4px;
        padding: 0.5rem 0.75rem 0.75rem;
        margin-bottom: 0.6rem;
    }
    legend {
        font-size: 0.78rem;
        color: var(--text-dim, #888);
        padding: 0 0.25rem;
    }

    .field-grid {
        display: grid;
        grid-template-columns: 70px 1fr;
        gap: 0.3rem 0.5rem;
        align-items: center;
    }
    .field-grid span {
        font-size: 0.78rem;
        color: var(--text-dim, #888);
    }

    .color-row {
        display: flex;
        align-items: center;
        gap: 0.3rem;
    }

    input[type="color"] {
        width: 1.8rem;
        height: 1.8rem;
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        padding: 0;
        background: transparent;
        cursor: pointer;
    }
    input[type="number"],
    input[type="text"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.8rem;
        width: 100%;
        box-sizing: border-box;
    }
    input[type="number"]:focus,
    input[type="text"]:focus {
        outline: none;
        border-color: var(--accent1, #446adb);
    }
    input.hex { font-family: monospace; }

    select {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.8rem;
        width: 100%;
    }
    select:focus { outline: none; border-color: var(--accent1, #446adb); }

    .checkbox-wrap {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.82rem;
        cursor: pointer;
        color: var(--text, #e0e0e0);
    }

    .stat-row {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.82rem;
        margin: 0.25rem 0;
    }
    .stat-row svg {
        width: 0.85rem;
        height: 0.85rem;
        fill: none;
        stroke: var(--text-dim, #888);
        stroke-width: 2;
    }

    p { margin: 0; font-size: 0.85rem; }
    .small { font-size: 0.78rem; margin: 0.2rem 0; }
    .dim { color: var(--text-dim, #888); }
    .hint { margin-top: 0.25rem; }
</style>
