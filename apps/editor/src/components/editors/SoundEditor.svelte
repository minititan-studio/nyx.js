<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * SoundEditor.svelte
     * Migrated from: editors/sound-editor/
     *
     * Import audio variants, preview playback, and set audio effects
     * (volume randomization, pitch, distortion, reverb).
     */
    import { get } from 'svelte/store';
    import { signals } from '../../stores/editorStore.js';
    import { updateAsset, projectFilePath } from '../../stores/projectStore.js';
    import { electronAPI, isElectron } from '../../lib/electron.js';
    import type { NyxSound, NyxSoundVariant } from '@nyx/shared';

    interface Props { asset: NyxSound; }
    let { asset }: Props = $props();

    let preload   = $state(asset.preload);
    let variants  = $state<NyxSoundVariant[]>(JSON.parse(JSON.stringify(asset.variants)));
    let volume    = $state(JSON.parse(JSON.stringify(asset.volume)));
    let pitch     = $state(JSON.parse(JSON.stringify(asset.pitch)));
    let distortion = $state(JSON.parse(JSON.stringify(asset.distortion)));
    let reverb    = $state(JSON.parse(JSON.stringify(asset.reverb)));
    let prevUid = asset.uid;

    // Audio preview
    let activeAudio = $state<HTMLAudioElement | null>(null);
    let playingUid  = $state<string | null>(null);

    // Reset only when a different asset is loaded into this slot
    $effect(() => {
        if (asset.uid === prevUid) return;
        prevUid    = asset.uid;
        preload    = asset.preload;
        variants   = JSON.parse(JSON.stringify(asset.variants));
        volume     = JSON.parse(JSON.stringify(asset.volume));
        pitch      = JSON.parse(JSON.stringify(asset.pitch));
        distortion = JSON.parse(JSON.stringify(asset.distortion));
        reverb     = JSON.parse(JSON.stringify(asset.reverb));
    });

    function persist() {
        updateAsset<NyxSound>(asset.uid, 'sound', {
            preload, variants, volume, pitch, distortion, reverb
        });
        signals.emit('assetChanged');
    }

    function getProjectSoundUrl(origname: string): string {
        const fp = get(projectFilePath);
        if (!fp || !origname) return '';
        const dir = fp.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        return `nyx-asset://localhost/${dir}/snd/${encodeURIComponent(origname)}`;
    }

    async function addVariant() {
        if (!isElectron()) return;
        const fp = get(projectFilePath);
        if (!fp) return;
        const result = await electronAPI().dialog.showOpenDialog({
            title: 'Import sound file',
            filters: [{ name: 'Audio files', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'] }],
            properties: ['openFile', 'multiSelections']
        });
        if (result.canceled || result.filePaths.length === 0) return;
        // Copy files into <projDir>/snd/ as s<uuid><ext> via main process
        const imported = await electronAPI().sound.import({
            sourcePaths: result.filePaths,
            projectFilePath: fp,
        });
        variants = [...variants, ...imported];
        persist();
    }

    function removeVariant(uid: string) {
        if (playingUid === uid) stopPreview();
        variants = variants.filter(v => v.uid !== uid);
        persist();
    }

    function playPreview(v: NyxSoundVariant) {
        stopPreview();
        const url = getProjectSoundUrl(v.origname);
        if (!url) return;
        const audio = new Audio(url);
        audio.onended = () => { if (playingUid === v.uid) { playingUid = null; activeAudio = null; } };
        audio.onerror = () => { if (playingUid === v.uid) { playingUid = null; activeAudio = null; } };
        audio.play().catch(() => { playingUid = null; activeAudio = null; });
        activeAudio = audio;
        playingUid  = v.uid;
    }

    function stopPreview() {
        if (activeAudio) {
            activeAudio.pause();
            activeAudio.currentTime = 0;
            activeAudio = null;
        }
        playingUid = null;
    }

</script>

<div class="sound-editor">
    <!-- ── Left: variants + settings ── -->
    <div class="props-col">
        <div class="prop-header">
            <h3 class="nm">{asset.name}</h3>
        </div>

        <div class="props-body">
            <!-- Variants -->
            <fieldset>
                <legend>Sound variants ({variants.length})</legend>
                <p class="dim small">Multiple variants are picked randomly at runtime.</p>

                {#each variants as v}
                    <div class="variant-row">
                        <button
                            class="inline square play-btn"
                            class:playing={playingUid === v.uid}
                            title={playingUid === v.uid ? 'Stop' : 'Preview'}
                            onclick={() => playingUid === v.uid ? stopPreview() : playPreview(v)}
                        >
                            <Icon icon={`feather:${playingUid === v.uid ? 'square' : 'play'}`} class="feather"/>
                        </button>
                        <span class="variant-name">{v.origname}</span>
                        <button class="inline square" title="Remove" onclick={() => removeVariant(v.uid)}>
                            <Icon icon="feather:trash-2" class="feather"/>
                        </button>
                    </div>
                {/each}

                {#if variants.length === 0}
                    <p class="dim small center">No variants. Import a sound file.</p>
                {/if}

                <button class="wide mt" onclick={addVariant} disabled={!isElectron()}>
                    <Icon icon="feather:plus" class="feather"/>
                    <span>Import variant…</span>
                </button>
            </fieldset>

            <!-- Global settings -->
            <fieldset>
                <legend>Settings</legend>
                <label class="checkbox-wrap">
                    <input type="checkbox" bind:checked={preload} onchange={persist} />
                    <span>Preload on room start</span>
                </label>
            </fieldset>

            <!-- Volume -->
            <fieldset>
                <legend>
                    <label class="checkbox-wrap inline">
                        <input type="checkbox" bind:checked={volume.enabled} onchange={persist} />
                        <span>Volume randomization</span>
                    </label>
                </legend>
                {#if volume.enabled}
                    <div class="field-grid">
                        <span>Min</span>
                        <input type="number" bind:value={volume.min} oninput={persist} min="0" max="1" step="0.05" />
                        <span>Max</span>
                        <input type="number" bind:value={volume.max} oninput={persist} min="0" max="1" step="0.05" />
                    </div>
                {/if}
            </fieldset>

            <!-- Pitch -->
            <fieldset>
                <legend>
                    <label class="checkbox-wrap inline">
                        <input type="checkbox" bind:checked={pitch.enabled} onchange={persist} />
                        <span>Pitch randomization</span>
                    </label>
                </legend>
                {#if pitch.enabled}
                    <div class="field-grid">
                        <span>Min</span>
                        <input type="number" bind:value={pitch.min} oninput={persist} step="0.05" />
                        <span>Max</span>
                        <input type="number" bind:value={pitch.max} oninput={persist} step="0.05" />
                    </div>
                {/if}
            </fieldset>

            <!-- Distortion -->
            <fieldset>
                <legend>
                    <label class="checkbox-wrap inline">
                        <input type="checkbox" bind:checked={distortion.enabled} onchange={persist} />
                        <span>Distortion</span>
                    </label>
                </legend>
                {#if distortion.enabled}
                    <div class="field-grid">
                        <span>Min</span>
                        <input type="number" bind:value={distortion.min} oninput={persist} min="0" max="1" step="0.05" />
                        <span>Max</span>
                        <input type="number" bind:value={distortion.max} oninput={persist} min="0" max="1" step="0.05" />
                    </div>
                {/if}
            </fieldset>

            <!-- Reverb -->
            <fieldset>
                <legend>
                    <label class="checkbox-wrap inline">
                        <input type="checkbox" bind:checked={reverb.enabled} onchange={persist} />
                        <span>Reverb</span>
                    </label>
                </legend>
                {#if reverb.enabled}
                    <div class="field-grid">
                        <span>Decay min</span>
                        <input type="number" bind:value={reverb.decayMin} oninput={persist} step="0.1" min="0" />
                        <span>Decay max</span>
                        <input type="number" bind:value={reverb.decayMax} oninput={persist} step="0.1" min="0" />
                        <span>Reverse</span>
                        <label class="checkbox-wrap">
                            <input type="checkbox" bind:checked={reverb.reverse} onchange={persist} />
                            <span>Reverse IR</span>
                        </label>
                    </div>
                {/if}
            </fieldset>
        </div>

    </div>

    <!-- ── Right: waveform / visual placeholder ── -->
    <div class="wave-col">
        <div class="wave-label dim">Waveform</div>
        <div class="wave-stage">
            {#if variants.length > 0}
                <div class="wave-hint dim">
                    <Icon icon="feather:music" class="feather hero" />
                    <p>{variants.length} variant{variants.length !== 1 ? 's' : ''}</p>
                    <p class="small">Waveform visualizer — Phase 6</p>
                </div>
            {:else}
                <div class="wave-hint dim">
                    <Icon icon="feather:volume-x" class="feather hero" />
                    <p>No sound loaded.</p>
                    <p class="small">Import a variant to get started.</p>
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .sound-editor {
        display: flex;
        flex-flow: row nowrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    .props-col {
        flex: 0 0 300px;
        overflow-y: auto;
        background: var(--background, #1a1a2e);
        border-right: 1px solid var(--border-bright, #333);
        display: flex;
        flex-direction: column;
    }

    .prop-header { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }
    h3 { font-size: 0.9rem; margin: 0; }

    .props-body { flex: 1 1 auto; overflow-y: auto; padding: 0.75rem; }

    fieldset { border: 1px solid var(--border-pale, #2a2a3e); border-radius: 4px; padding: 0.5rem 0.75rem 0.75rem; margin-bottom: 0.6rem; }
    legend   { font-size: 0.78rem; color: var(--text-dim, #888); padding: 0 0.25rem; }

    .variant-row {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.25rem 0;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        &:last-of-type { border-bottom: none; }
    }

    .variant-name { flex: 1 1 auto; font-size: 0.8rem; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .play-btn { color: var(--text-dim, #888); &.playing { color: var(--accent1, #446adb); } }

    .field-grid { display: grid; grid-template-columns: 70px 1fr; gap: 0.3rem 0.5rem; align-items: center; }
    label { font-size: 0.8rem; color: var(--text-dim, #888); }

    .checkbox-wrap { display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; cursor: pointer; color: var(--text, #e0e0e0); &.inline { display: inline-flex; } }

    input[type="text"],
    input[type="number"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.4rem;
        font-size: 0.82rem;
        width: 100%;
        box-sizing: border-box;
        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .mt     { margin-top: 0.5rem; }
    .wide   { width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.35rem; }
    .small  { font-size: 0.78rem; margin: 0.2rem 0; }
    .center { text-align: center; }
    .dim    { color: var(--text-dim, #888); }

    .footer { padding: 0.75rem; border-top: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }

    /* Wave preview */
    .wave-col { flex: 1 1 auto; display: flex; flex-direction: column; background: var(--background-deeper, #111122); overflow: hidden; }
    .wave-label { padding: 0.4rem 0.75rem; font-size: 0.75rem; border-bottom: 1px solid var(--border-pale, #2a2a3e); flex-shrink: 0; }
    .wave-stage { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; }
    .wave-hint  { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; text-align: center; }
    .hero       { width: 3rem; height: 3rem; fill: none; stroke: currentColor; stroke-width: 1; margin-bottom: 0.5rem; }
    p           { margin: 0; font-size: 0.85rem; }

    button {
        cursor: pointer;
        background: var(--background, #1a1a2e);
        border: 1px solid var(--border-bright, #333);
        color: var(--text, #e0e0e0);
        border-radius: 4px;
        padding: 0.25rem 0.5rem;
        font-size: 0.82rem;
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        transition: all 0.12s;
        &.inline  { background: transparent; border-color: transparent; }
        &.square  { width: 1.6rem; height: 1.6rem; padding: 0; justify-content: center; }
        &.success { background: var(--success, #27ae60); border-color: var(--success, #27ae60); color: #fff; font-weight: 600; }
        &.success:hover { background: #1e8449; }
        &:hover   { background: var(--act, #1e2233); border-color: var(--acttext, #7ec8e3); color: var(--acttext, #7ec8e3); }
        &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
        :global(svg.feather) { width: 0.82rem; height: 0.82rem; fill: none; stroke: currentColor; stroke-width: 2; }
    }
</style>
