<script lang="ts">
    import Icon from "@iconify/svelte";
    /**
     * EmitterTandemEditor.svelte
     * Migrated from: editors/emitter-tandem-editor/
     *
     * Phase 7C Step D — live PixiJS particle preview.
     *
     * Architecture:
     *   - Left col  : emitter list tabs (add / remove / rename / active highlight)
     *   - Middle col: per-emitter property fields (all NyxEmitterSettings fields)
     *   - Right col : live PixiJS canvas — custom particle engine that mirrors
     *                 `@pixi/particle-emitter` v3 behavior without adding the dep.
     *
     * Preview features (matching legacy emitter-tandem-editor.tag):
     *   - All emitters in the tandem rendered simultaneously
     *   - Mouse-follow: moving pointer over preview pans emitter origin to cursor
     *   - Reset button: clears all particles and restarts simulation
     *   - FPS + live particle count overlay (PIXI.Text inspector)
     *   - Preview background colour picker
     *   - ResizeObserver keeps canvas filling its parent panel
     *   - `needsRebuild` flag: settings changes are batched to the ticker,
     *     avoiding full PixiApp recreation on every keypress
     *   - Proper cleanup: all particles, containers, and the PIXI app are
     *     destroyed when the component unmounts
     *
     * Svelte 5 only — $props / $state / $effect / $derived. No export let / $:.
     */

    import * as PIXI from 'pixi.js';
    import { get } from 'svelte/store';
    import { untrack } from 'svelte';
    import ColorPicker from '@nyx/ui-kit/ColorPicker.svelte';
    import { signals } from '../../stores/editorStore.js';
    import { updateAsset, currentProject, projectFilePath } from '../../stores/projectStore.js';
    import { defaultEmitter } from '@nyx/shared';
    import type { NyxEmitterTandem, NyxEmitterSettings, NyxTexture } from '@nyx/shared';

    // ── Props ────────────────────────────────────────────────────────────────────

    interface Props { asset: NyxEmitterTandem; }
    let { asset }: Props = $props();

    // ── Reactive editor state ────────────────────────────────────────────────────

    let emitters  = $state<NyxEmitterSettings[]>(untrack(() => JSON.parse(JSON.stringify(asset.emitters))));
    let isUi      = $state(untrack(() => asset.isUi));
    let activeIdx = $state(0);
    let prevUid   = untrack(() => asset.uid);

    $effect(() => {
        const uid = asset.uid;
        if (uid === prevUid) return;
        prevUid = uid;
        untrack(() => {
            emitters  = JSON.parse(JSON.stringify(asset.emitters));
            isUi      = asset.isUi;
            activeIdx = 0;
        });
    });

    const active   = $derived(emitters[activeIdx] as NyxEmitterSettings | undefined);
    const textures = $derived($currentProject?.textures ?? []);

    // ── Persistence ───────────────────────────────────────────────────────────────

    function persist() {
        updateAsset<NyxEmitterTandem>(asset.uid, 'emitterTandem', { emitters, isUi });
        signals.emit('assetChanged');
    }

    // ── Emitter list management ──────────────────────────────────────────────────

    function addEmitter() {
        const em = defaultEmitter(crypto.randomUUID());
        em.name  = `Emitter ${emitters.length + 1}`;
        emitters = [...emitters, em];
        activeIdx = emitters.length - 1;
        persist();
    }

    function removeEmitter(i: number) {
        if (emitters.length <= 1) return;
        emitters = emitters.filter((_, idx) => idx !== i);
        if (activeIdx >= emitters.length) activeIdx = emitters.length - 1;
        persist();
    }

    // ── Particle system types ────────────────────────────────────────────────────

    interface Particle {
        sprite:        PIXI.Sprite;
        vx:            number;
        vy:            number;
        grav:          number;
        gravX:         number;
        rotationSpeed: number; // radians/s
        elapsed:       number;
        maxLife:       number;
        alphaStart:    number;
        alphaEnd:      number;
        scaleStart:    number;
        scaleEnd:      number;
        r0: number; g0: number; b0: number;
        r1: number; g1: number; b1: number;
        ox: number;
        oy: number;
    }

    interface EmitterState {
        uid:        string;
        settings:   NyxEmitterSettings;
        particles:  Particle[];
        spawnAccum: number;
        container:  PIXI.Container;
        frames:     PIXI.Texture[];
        offsetX:    number;
        offsetY:    number;
        burstFired: boolean;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    function hexToRgb(hex: string): [number, number, number] {
        const n = parseInt(hex.replace('#', ''), 16) || 0;
        return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    }

    function lerpColor(
        r0: number, g0: number, b0: number,
        r1: number, g1: number, b1: number,
        t: number
    ): number {
        return (Math.round(r0 + (r1 - r0) * t) << 16)
             | (Math.round(g0 + (g1 - g0) * t) << 8)
             |  Math.round(b0 + (b1 - b0) * t);
    }

    function getTexUrl(origname: string): string | null {
        const fp = get(projectFilePath);
        if (!fp || !origname) return null;
        const dir = fp.replace(/[\\/][^\\/]+$/, '').replace(/\\/g, '/');
        return `nyx-asset://localhost/${dir}/img/${encodeURIComponent(origname)}`;
    }

    function makeFallback(renderer: PIXI.Renderer): PIXI.Texture {
        const g = new PIXI.Graphics();
        g.beginFill(0xffffff).drawCircle(0, 0, 8).endFill();
        const tex = renderer.generateTexture(g, {
            scaleMode: PIXI.SCALE_MODES.LINEAR,
            resolution: 1,
        });
        g.destroy();
        return tex;
    }

    function sliceFrames(texData: NyxTexture, base: PIXI.BaseTexture): PIXI.Texture[] {
        const [cols, rows] = texData.grid;
        const out: PIXI.Texture[] = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = texData.offx + c * (texData.width + texData.marginx);
                const y = texData.offy + r * (texData.height + texData.marginy);
                out.push(new PIXI.Texture(base, new PIXI.Rectangle(x, y, texData.width, texData.height)));
            }
        }
        return out.length > 0 ? out : [new PIXI.Texture(base)];
    }

    function drawShapeOverlay(gfx: PIXI.Graphics, em: NyxEmitterSettings | undefined, cx: number, cy: number): void {
        gfx.clear();
        if (!em) return;
        const shape = em.spawnShape ?? 'point';
        const ox = cx + (em.spawnOffsetX ?? 0);
        const oy = cy + (em.spawnOffsetY ?? 0);
        if (shape === 'point' || shape === 'burst') {
            gfx.lineStyle(1, 0x44aaff, 0.7);
            gfx.moveTo(ox - 7, oy); gfx.lineTo(ox + 7, oy);
            gfx.moveTo(ox, oy - 7); gfx.lineTo(ox, oy + 7);
            return;
        }
        gfx.lineStyle(1, 0x44aaff, 0.6);
        gfx.beginFill(0x2255aa, 0.1);
        if (shape === 'circle') {
            gfx.drawCircle(ox, oy, em.spawnRadius ?? 50);
        } else if (shape === 'ring') {
            const inner = em.spawnInnerRadius ?? 0;
            const outer = em.spawnRadius ?? 50;
            gfx.drawCircle(ox, oy, outer);
            if (inner > 0) {
                gfx.beginHole();
                gfx.drawCircle(ox, oy, inner);
                gfx.endHole();
            }
        } else if (shape === 'rect') {
            const w = em.spawnRectWidth  ?? 100;
            const h = em.spawnRectHeight ?? 100;
            gfx.drawRect(ox - w / 2, oy - h / 2, w, h);
        }
        gfx.endFill();
    }

    function destroyState(state: EmitterState): void {
        for (const p of state.particles) {
            if (!p.sprite.destroyed) p.sprite.destroy();
        }
        if (!state.container.destroyed) state.container.destroy({ children: false });
    }

    const BLEND_MAP: Record<string, number> = {
        normal:   PIXI.BLEND_MODES.NORMAL,
        add:      PIXI.BLEND_MODES.ADD,
        multiply: PIXI.BLEND_MODES.MULTIPLY,
        screen:   PIXI.BLEND_MODES.SCREEN,
    };

    /** Compute spawn XY for a single particle based on the emitter shape settings. */
    function getSpawnPos(s: NyxEmitterSettings, baseX: number, baseY: number): { x: number; y: number } {
        const ox = (s.spawnOffsetX ?? 0) + baseX;
        const oy = (s.spawnOffsetY ?? 0) + baseY;
        const shape = s.spawnShape ?? 'point';
        if (shape === 'circle') {
            const r = Math.random() * (s.spawnRadius ?? 50);
            const a = Math.random() * Math.PI * 2;
            return { x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r };
        }
        if (shape === 'ring') {
            const inner = s.spawnInnerRadius ?? 0;
            const outer = s.spawnRadius ?? 50;
            const r = inner + Math.random() * (outer - inner);
            const a = Math.random() * Math.PI * 2;
            return { x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r };
        }
        if (shape === 'rect') {
            const w = (s.spawnRectWidth  ?? 100) / 2;
            const h = (s.spawnRectHeight ?? 100) / 2;
            return { x: ox + (Math.random() * 2 - 1) * w, y: oy + (Math.random() * 2 - 1) * h };
        }
        // 'point' and 'burst'
        return { x: ox, y: oy };
    }

    function spawnOne(state: EmitterState): void {
        const s = state.settings;
        if (state.particles.length >= s.maxParticles) return;
        if (Math.random() > (s.spawnChance ?? 1)) return;

        const pos    = getSpawnPos(s, state.offsetX, state.offsetY);
        const deg    = s.angleMin + Math.random() * (s.angleMax - s.angleMin);
        const rad    = deg * Math.PI / 180;
        const speed  = s.speedMin + Math.random() * (s.speedMax - s.speedMin);
        const life   = s.lifetimeMin + Math.random() * (s.lifetimeMax - s.lifetimeMin);
        const initRotDeg  = (s.rotationMin ?? 0) + Math.random() * ((s.rotationMax ?? 0) - (s.rotationMin ?? 0));
        const rotSpeedDeg = (s.rotationSpeedMin ?? 0) + Math.random() * ((s.rotationSpeedMax ?? 0) - (s.rotationSpeedMin ?? 0));

        const behavior = state.settings.textureBehavior ?? 'textureRandom';
        let sprite: PIXI.Sprite;
        if (behavior === 'animatedSingle' && state.frames.length > 1) {
            const anim = new PIXI.AnimatedSprite(state.frames);
            anim.animationSpeed = (s.animatedSingleFramerate ?? 10) / 60;
            anim.play();
            sprite = anim;
        } else {
            const frame = state.frames[Math.floor(Math.random() * state.frames.length)];
            sprite = new PIXI.Sprite(frame);
        }
        sprite.anchor.set(0.5);
        sprite.alpha    = s.alphaStart;
        sprite.scale.set(s.scaleStart);
        sprite.rotation = initRotDeg * Math.PI / 180;
        sprite.blendMode = BLEND_MAP[s.blendMode ?? 'normal'] ?? PIXI.BLEND_MODES.NORMAL;
        sprite.x = pos.x;
        sprite.y = pos.y;
        state.container.addChild(sprite);

        const [r0, g0, b0] = hexToRgb(s.colorStart);
        const [r1, g1, b1] = hexToRgb(s.colorEnd);
        state.particles.push({
            sprite,
            vx: Math.cos(rad) * speed, vy: Math.sin(rad) * speed,
            grav: s.gravity ?? 0, gravX: s.gravityX ?? 0,
            rotationSpeed: rotSpeedDeg * Math.PI / 180,
            elapsed: 0, maxLife: Math.max(life, 0.01),
            alphaStart: s.alphaStart, alphaEnd: s.alphaEnd,
            scaleStart: s.scaleStart, scaleEnd: s.scaleEnd,
            r0, g0, b0, r1, g1, b1,
            ox: pos.x, oy: pos.y,
        });
    }

    function tickState(state: EmitterState, dt: number): void {
        const s = state.settings;
        const shape = s.spawnShape ?? 'point';

        // Burst: fire all particles in first tick, then never spawn again
        if (shape === 'burst' && !state.burstFired) {
            state.burstFired = true;
            const count = Math.min(s.particlesPerWave ?? 1, s.maxParticles);
            for (let i = 0; i < count; i++) spawnOne(state);
        } else if (shape !== 'burst') {
            const perWave = Math.max(s.particlesPerWave ?? 1, 1);
            state.spawnAccum += dt * s.spawnRate;
            while (state.spawnAccum >= 1) {
                for (let i = 0; i < perWave; i++) spawnOne(state);
                state.spawnAccum -= 1;
            }
        }

        // Update
        const alive: Particle[] = [];
        for (const p of state.particles) {
            p.elapsed += dt;
            if (p.elapsed >= p.maxLife) {
                p.sprite.destroy();
                continue;
            }
            const t = p.elapsed / p.maxLife;
            p.vx += p.gravX * dt;
            p.vy += p.grav  * dt;
            p.sprite.x        += p.vx * dt;
            p.sprite.y        += p.vy * dt;
            p.sprite.rotation += p.rotationSpeed * dt;
            p.sprite.alpha = p.alphaStart + (p.alphaEnd - p.alphaStart) * t;
            const sc = p.scaleStart + (p.scaleEnd - p.scaleStart) * t;
            p.sprite.scale.set(sc);
            p.sprite.tint = lerpColor(p.r0, p.g0, p.b0, p.r1, p.g1, p.b1, t);
            alive.push(p);
        }
        state.particles = alive;
    }

    // ── PixiJS canvas element refs ───────────────────────────────────────────────

    let canvasEl  = $state<HTMLCanvasElement | null>(null);
    let previewEl = $state<HTMLDivElement    | null>(null);

    // ── Preview options ───────────────────────────────────────────────────────────

    function parseSavedBg(): number {
        const raw = (window.electronAPI.settings.getAll()['nyxTandemPreviewBg'] as string) ?? '0x1a1a2e';
        const n = parseInt(raw, 16);
        return isNaN(n) ? 0x1a1a2e : n;
    }

    let previewBg     = $state<number>(parseSavedBg());
    let showBgPicker  = $state(false);
    const bgHex       = $derived('#' + previewBg.toString(16).padStart(6, '0'));
    let inspectorText = $state('');

    const livePreviewBg = { value: parseSavedBg() };

    function applyBg(hex: string): void {
        const n = parseInt(hex.replace('#', ''), 16);
        if (isNaN(n)) return;
        previewBg          = n;
        livePreviewBg.value = n;
        void window.electronAPI.settings.set('nyxTandemPreviewBg', '0x' + hex.replace('#', ''));
    }

    // ── Mutable state read by the PixiJS ticker ──────────────────────────────────

    let liveEmitters:  NyxEmitterSettings[] = [];
    let liveActiveIdx  = 0;
    let needsRebuild   = false;
    let mouseOffsetX   = 0;
    let mouseOffsetY   = 0;
    let mouseInCanvas  = false;

    $effect(() => {
        liveEmitters = emitters.map(e => ({ ...e }));
        needsRebuild = true;
    });

    $effect(() => { liveActiveIdx = activeIdx; });

    // ── PixiJS application lifecycle ─────────────────────────────────────────────

    $effect(() => {
        if (!canvasEl) return;

        // Defer one frame so the browser completes flex layout before PixiJS
        // queries WebGL capabilities — a 0×0 canvas makes getParameter() return 0.
        let pixiCleanup: (() => void) | undefined;
        let rafId = requestAnimationFrame(() => { pixiCleanup = initPixi(canvasEl!); });
        return () => { cancelAnimationFrame(rafId); pixiCleanup?.(); };
    });

    function initPixi(canvasEl: HTMLCanvasElement): (() => void) | undefined {
        let app: PIXI.Application;
        try {
            app = new PIXI.Application({
                view:            canvasEl,
                width:           Math.max(canvasEl.clientWidth  || 360, 1),
                height:          Math.max(canvasEl.clientHeight || 360, 1),
                backgroundColor: livePreviewBg.value,
                antialias:       true,
                autoDensity:     true,
                resolution:      window.devicePixelRatio || 1,
            });
        } catch (e) {
            // WebGL unavailable (e.g. hardware accel disabled or canvas not ready).
            console.warn('[EmitterEditor] WebGL init failed — preview unavailable:', e);
            inspectorText = 'Preview unavailable (WebGL error)';
            return;
        }

        const stage    = app.stage;
        const fallback = makeFallback(app.renderer as PIXI.Renderer);
        const texCache = new Map<string, PIXI.Texture[]>();
        let   states:  EmitterState[] = [];

        const inspector = new PIXI.Text('', {
            fill: 0xffffff,
            dropShadow: true,
            dropShadowDistance: 2,
            dropShadowAngle: Math.PI * 0.75,
            fontSize: 13,
        });
        inspector.x = 8;
        inspector.y = 8;
        stage.addChild(inspector);

        const shapeGfx = new PIXI.Graphics();
        stage.addChildAt(shapeGfx, stage.children.indexOf(inspector));

        const ro = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            if (width > 0 && height > 0) {
                app.renderer.resize(width, height);
                for (const st of states) {
                    st.container.x = app.renderer.width  / 2;
                    st.container.y = app.renderer.height / 2;
                }
            }
        });
        if (previewEl) ro.observe(previewEl);

        function buildStates(emList: NyxEmitterSettings[]): void {
            for (const st of states) {
                destroyState(st);
                if (!st.container.destroyed) stage.removeChild(st.container);
            }
            states = [];

            for (const em of emList) {
                const container = new PIXI.Container();
                container.x = app.renderer.width  / 2;
                container.y = app.renderer.height / 2;
                stage.addChildAt(container, stage.children.indexOf(shapeGfx));

                let frames: PIXI.Texture[] = [fallback];
                if (em.textureUid) {
                    const texData = $currentProject?.textures.find(t => t.uid === em.textureUid) as NyxTexture | undefined;
                    if (texData?.origname) {
                        const cached = texCache.get(em.textureUid);
                        if (cached) {
                            frames = cached;
                        } else {
                            const url = getTexUrl(texData.origname);
                            if (url) {
                                const base = PIXI.BaseTexture.from(url);
                                frames = sliceFrames(texData, base);
                                texCache.set(em.textureUid, frames);
                            }
                        }
                    }
                }

                states.push({
                    uid:        em.textureUid ?? '',
                    settings:   em,
                    particles:  [],
                    spawnAccum: 0,
                    container,
                    frames,
                    offsetX:    0,
                    offsetY:    0,
                    burstFired: false,
                });
            }
        }

        app.ticker.add(() => {
            if (livePreviewBg) {
                (app.renderer as PIXI.Renderer).background.color = livePreviewBg.value;
            }

            if (needsRebuild) {
                buildStates(liveEmitters);
                needsRebuild = false;
            }

            for (const st of states) {
                if (mouseInCanvas) {
                    st.offsetX = mouseOffsetX;
                    st.offsetY = mouseOffsetY;
                } else {
                    st.offsetX = 0;
                    st.offsetY = 0;
                }
            }

            const dt    = app.ticker.deltaMS / 1000;
            let total   = 0;
            for (const st of states) {
                tickState(st, dt);
                total += st.particles.length;
            }

            const fps = Math.round(1000 / app.ticker.deltaMS);
            inspectorText = `FPS: ${fps}  particles: ${total}`;
            inspector.text = inspectorText;

            const activeEm = liveEmitters[liveActiveIdx];
            const cx = app.renderer.width  / 2 + (mouseInCanvas ? mouseOffsetX : 0);
            const cy = app.renderer.height / 2 + (mouseInCanvas ? mouseOffsetY : 0);
            drawShapeOverlay(shapeGfx, activeEm, cx, cy);
        });

        buildStates(liveEmitters);
        needsRebuild = false;

        return () => {
            ro.disconnect();
            // Stop the ticker first so no new particles are spawned during cleanup.
            app.ticker.stop();
            fallback.destroy(true);
            for (const frames of texCache.values()) {
                const base = frames[0]?.baseTexture;
                for (const f of frames) f.destroy(false);
                base?.destroy();
            }
            // children:true lets PIXI atomically destroy the stage and all sprites.
            app.destroy(false, { children: true });
        };
    }

    // ── Mouse-follow handlers ────────────────────────────────────────────────────

    function onPreviewPointerMove(e: PointerEvent): void {
        if (!canvasEl) return;
        const rect = canvasEl.getBoundingClientRect();
        mouseOffsetX  = e.offsetX - rect.width  / 2;
        mouseOffsetY  = e.offsetY - rect.height / 2;
        mouseInCanvas = true;
    }

    function onPreviewPointerOut(): void {
        mouseInCanvas = false;
        mouseOffsetX  = 0;
        mouseOffsetY  = 0;
    }

    function resetPreview(): void {
        needsRebuild = true;
    }
</script>

<!-- ── Layout ──────────────────────────────────────────────────────────────── -->
<div class="emitter-editor">

    <!-- Far-left: emitter list -->
    <div class="emitter-list-col">
        <div class="col-header">
            <span class="small dim">Emitters</span>
            <button class="inline square" title="Add emitter" onclick={addEmitter}>
                <Icon icon="feather:plus" class="feather"/>
            </button>
        </div>

        {#each emitters as em, i}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
                class="emitter-item"
                class:active={i === activeIdx}
                role="option"
                aria-selected={i === activeIdx}
                tabindex="0"
                onclick={() => { activeIdx = i; }}
                onkeydown={(e) => e.key === 'Enter' && (activeIdx = i)}
            >
                <Icon icon="feather:star" class="feather"/>
                <span>{em.name}</span>
                {#if emitters.length > 1}
                    <button
                        class="inline square remove-btn"
                        title="Remove emitter"
                        onclick={(e) => { e.stopPropagation(); removeEmitter(i); }}
                    >
                        <Icon icon="feather:x" class="feather"/>
                    </button>
                {/if}
            </div>
        {/each}

        <div class="global-opts">
            <label class="checkbox-wrap">
                <input type="checkbox" bind:checked={isUi} onchange={persist} />
                <span class="small">UI layer</span>
            </label>
        </div>
    </div>

    <!-- Middle: per-emitter properties -->
    {#if active}
        <div class="props-col">
            <div class="prop-header">
                <input
                    type="text"
                    class="name-input"
                    bind:value={active.name}
                    oninput={persist}
                    spellcheck={false}
                    placeholder="Emitter name"
                />
            </div>

            <div class="props-body">

                <!-- Texture -->
                <fieldset>
                    <legend>Texture</legend>
                    <select bind:value={active.textureUid} onchange={persist} class="wide-select">
                        <option value={null}>(none — white circle)</option>
                        {#each textures as tex}
                            <option value={tex.uid}>{tex.name}</option>
                        {/each}
                    </select>
                    <div class="field-grid" style="margin-top:0.4rem">
                        <span>Behavior</span>
                        <select bind:value={active.textureBehavior} onchange={persist} class="wide-select">
                            <option value="textureRandom">Random frame</option>
                            <option value="animatedSingle">Animated</option>
                        </select>
                        {#if (active.textureBehavior ?? 'textureRandom') === 'animatedSingle'}
                            <span>Framerate</span>
                            <input type="number" bind:value={active.animatedSingleFramerate} oninput={persist} min="1" max="60" step="1" />
                        {/if}
                    </div>
                </fieldset>

                <!-- Spawn -->
                <fieldset>
                    <legend>Spawning</legend>
                    <div class="field-grid">
                        <span>Max particles</span>
                        <input type="number" bind:value={active.maxParticles}     oninput={persist} min="1" max="10000" />
                        <span>Rate / s</span>
                        <input type="number" bind:value={active.spawnRate}        oninput={persist} min="0" step="1" />
                        <span>Per wave</span>
                        <input type="number" bind:value={active.particlesPerWave} oninput={persist} min="1" step="1" title="Particles emitted per spawn event" />
                        <span>Chance</span>
                        <input type="number" bind:value={active.spawnChance}      oninput={persist} min="0" max="1" step="0.05" title="Probability 0–1 of spawning each wave" />
                        <span>Emitter life</span>
                        <input type="number" bind:value={active.emitterLifetime}  oninput={persist} step="0.5" title="Seconds; -1 = infinite" />
                        <span>Lifetime min</span>
                        <input type="number" bind:value={active.lifetimeMin}      oninput={persist} step="0.1" min="0.01" />
                        <span>Lifetime max</span>
                        <input type="number" bind:value={active.lifetimeMax}      oninput={persist} step="0.1" min="0.01" />
                    </div>
                </fieldset>

                <!-- Shape and Positioning -->
                <fieldset>
                    <legend>Shape &amp; Positioning</legend>
                    <div class="field-grid">
                        <span>Shape</span>
                        <select bind:value={active.spawnShape} onchange={persist} class="wide-select">
                            <option value="point">Point</option>
                            <option value="circle">Circle</option>
                            <option value="ring">Ring</option>
                            <option value="rect">Rectangle</option>
                            <option value="burst">Burst</option>
                        </select>
                        {#if (active.spawnShape ?? 'point') !== 'point' && active.spawnShape !== 'rect'}
                            <span>Radius</span>
                            <input type="number" bind:value={active.spawnRadius} oninput={persist} min="0" step="5" />
                        {/if}
                        {#if active.spawnShape === 'ring'}
                            <span>Inner radius</span>
                            <input type="number" bind:value={active.spawnInnerRadius} oninput={persist} min="0" step="5" />
                        {/if}
                        {#if active.spawnShape === 'rect'}
                            <span>Width</span>
                            <input type="number" bind:value={active.spawnRectWidth}  oninput={persist} min="0" step="5" />
                            <span>Height</span>
                            <input type="number" bind:value={active.spawnRectHeight} oninput={persist} min="0" step="5" />
                        {/if}
                        <span>Offset X</span>
                        <input type="number" bind:value={active.spawnOffsetX} oninput={persist} step="5" />
                        <span>Offset Y</span>
                        <input type="number" bind:value={active.spawnOffsetY} oninput={persist} step="5" />
                    </div>
                </fieldset>

                <!-- Motion -->
                <fieldset>
                    <legend>Velocity</legend>
                    <div class="field-grid">
                        <span>Speed min</span>
                        <input type="number" bind:value={active.speedMin} oninput={persist} step="5" />
                        <span>Speed max</span>
                        <input type="number" bind:value={active.speedMax} oninput={persist} step="5" />
                        <span>Angle min °</span>
                        <input type="number" bind:value={active.angleMin} oninput={persist} min="0" max="360" />
                        <span>Angle max °</span>
                        <input type="number" bind:value={active.angleMax} oninput={persist} min="0" max="360" />
                        <span>Gravity Y</span>
                        <input type="number" bind:value={active.gravity}  oninput={persist} step="10" title="Vertical gravity pixels/s² (positive=down)" />
                        <span>Gravity X</span>
                        <input type="number" bind:value={active.gravityX} oninput={persist} step="10" title="Horizontal gravity pixels/s² (positive=right)" />
                    </div>
                </fieldset>

                <!-- Rotation -->
                <fieldset>
                    <legend>Rotation</legend>
                    <div class="field-grid">
                        <span>Start min °</span>
                        <input type="number" bind:value={active.rotationMin}      oninput={persist} step="5" />
                        <span>Start max °</span>
                        <input type="number" bind:value={active.rotationMax}      oninput={persist} step="5" />
                        <span>Speed min °/s</span>
                        <input type="number" bind:value={active.rotationSpeedMin} oninput={persist} step="10" title="Negative = counter-clockwise" />
                        <span>Speed max °/s</span>
                        <input type="number" bind:value={active.rotationSpeedMax} oninput={persist} step="10" />
                    </div>
                </fieldset>

                <!-- Appearance -->
                <fieldset>
                    <legend>Appearance over lifetime</legend>
                    <div class="field-grid">
                        <span>Scale start</span>
                        <input type="number" bind:value={active.scaleStart} oninput={persist} step="0.05" min="0" />
                        <span>Scale end</span>
                        <input type="number" bind:value={active.scaleEnd}   oninput={persist} step="0.05" min="0" />
                        <span>Alpha start</span>
                        <input type="number" bind:value={active.alphaStart} oninput={persist} step="0.05" min="0" max="1" />
                        <span>Alpha end</span>
                        <input type="number" bind:value={active.alphaEnd}   oninput={persist} step="0.05" min="0" max="1" />
                        <span>Color start</span>
                        <ColorPicker value={active.colorStart} onchange={(c) => { active.colorStart = c; persist(); }} />
                        <span>Color end</span>
                        <ColorPicker value={active.colorEnd}   onchange={(c) => { active.colorEnd   = c; persist(); }} />
                        <span>Blend mode</span>
                        <select bind:value={active.blendMode} onchange={persist} class="wide-select">
                            <option value="normal">Normal</option>
                            <option value="add">Additive</option>
                            <option value="multiply">Multiply</option>
                            <option value="screen">Screen</option>
                        </select>
                    </div>
                </fieldset>

            </div>
        </div>
    {/if}

    <!-- Right: live PixiJS preview -->
    <div class="preview-col" bind:this={previewEl}>

        <!-- Toolbar -->
        <div class="preview-bar">
            <Icon icon="feather:star" class="feather bar-icon dim" />
            <span class="small dim">Live preview</span>
            <span class="preview-stats small dim">{inspectorText}</span>
            <div class="bar-spacer"></div>
            <button
                class="inline small"
                title="Change preview background"
                onclick={() => { showBgPicker = !showBgPicker; }}
            >
                <span class="color-swatch" style="background:{bgHex};"></span>
                <span class="small">BG</span>
            </button>
            <button class="inline square" title="Reset simulation" onclick={resetPreview}>
                <Icon icon="feather:rotate-cw" class="feather"/>
            </button>
        </div>

        {#if showBgPicker}
            <div class="bg-picker-row">
                <span class="small dim">Background</span>
                <ColorPicker value={bgHex} onchange={(c) => applyBg(c)} />
                <button class="inline small" title="Close" onclick={() => { showBgPicker = false; }}>
                    <Icon icon="feather:x" class="feather"/>
                </button>
            </div>
        {/if}

        <canvas
            bind:this={canvasEl}
            class="preview-canvas"
            onpointermove={onPreviewPointerMove}
            onpointerout={onPreviewPointerOut}
        ></canvas>

        <div class="preview-hint small dim">
            Move pointer over canvas to follow cursor
        </div>

    </div>
</div>

<style>
    /* ── Root layout ─────────────────────────────────────────────────────────── */
    .emitter-editor {
        display: flex;
        flex-flow: row nowrap;
        width: 100%;
        height: 100%;
        overflow: hidden;
    }

    /* ── Emitter list column ─────────────────────────────────────────────────── */
    .emitter-list-col {
        flex: 0 0 140px;
        border-right: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .col-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.4rem 0.5rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    .emitter-item {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.3rem 0.5rem;
        border: none;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        background: transparent;
        color: var(--text-dim, #888);
        cursor: pointer;
        font-size: 0.8rem;
        text-align: left;
        width: 100%;
        transition: background 0.12s;

        &:hover  { background: var(--act, #1e2233); color: var(--text, #e0e0e0); }
        &.active {
            background: var(--background-deeper, #111122);
            color: var(--acttext, #7ec8e3);
            border-left: 2px solid var(--accent1, #446adb);
        }

        span { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        :global(svg.feather) {
            width: 0.75rem; height: 0.75rem;
            fill: none; stroke: currentColor; stroke-width: 2;
            flex-shrink: 0;
        }
    }

    .remove-btn { opacity: 0; transition: opacity 0.12s; flex-shrink: 0; }
    .emitter-item:hover .remove-btn { opacity: 1; }

    .global-opts {
        padding: 0.5rem;
        border-top: 1px solid var(--border-pale, #2a2a3e);
        margin-top: auto;
    }

    /* ── Properties column ───────────────────────────────────────────────────── */
    .props-col {
        flex: 0 0 280px;
        border-right: 1px solid var(--border-bright, #333);
        background: var(--background, #1a1a2e);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .prop-header {
        padding: 0.4rem 0.5rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    .name-input {
        background: transparent;
        border: 1px solid transparent;
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.15rem 0.3rem;
        font-size: 0.9rem;
        font-weight: 600;
        width: 100%;
        box-sizing: border-box;

        &:focus {
            outline: none;
            border-color: var(--accent1, #446adb);
            background: var(--background-deeper, #111122);
        }
    }

    .props-body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 0.75rem;
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
        grid-template-columns: 80px 1fr;
        gap: 0.25rem 0.5rem;
        align-items: center;

        span { font-size: 0.78rem; color: var(--text-dim, #888); }
    }

    input[type="number"] {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.8rem;
        width: 100%;
        box-sizing: border-box;

        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    select.wide-select {
        background: var(--background-deeper, #111122);
        border: 1px solid var(--border-bright, #333);
        border-radius: 3px;
        color: var(--text, #e0e0e0);
        padding: 0.2rem 0.3rem;
        font-size: 0.78rem;
        width: 100%;

        &:focus { outline: none; border-color: var(--accent1, #446adb); }
    }

    .checkbox-wrap {
        display: flex; align-items: center; gap: 0.35rem;
        font-size: 0.82rem; cursor: pointer; color: var(--text, #e0e0e0);
    }

    /* ── Preview column ──────────────────────────────────────────────────────── */
    .preview-col {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: #0a0a12;
        min-width: 200px;
    }

    .preview-bar {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.3rem 0.5rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
    }

    :global(.bar-icon) {
        width: 0.75rem; height: 0.75rem;
        fill: none; stroke: currentColor; stroke-width: 2;
        flex-shrink: 0;
    }

    .preview-stats {
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 160px;
    }

    .bar-spacer { flex: 1 1 auto; }

    .color-swatch {
        display: inline-block;
        width: 0.85rem;
        height: 0.85rem;
        border-radius: 2px;
        border: 1px solid var(--border-bright, #444);
        vertical-align: middle;
    }

    .bg-picker-row {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.3rem 0.6rem;
        border-bottom: 1px solid var(--border-pale, #2a2a3e);
        flex-shrink: 0;
        background: var(--background-deeper, #111122);

        input[type="text"].hex { width: 6rem; }
    }

    .preview-canvas {
        display: block;
        flex: 1 1 auto;
        width: 100%;
        height: 100%;
        min-height: 0;
        cursor: crosshair;
    }

    .preview-hint {
        padding: 0.2rem 0.6rem;
        flex-shrink: 0;
        border-top: 1px solid var(--border-pale, #2a2a3e);
        font-style: italic;
    }

    /* ── Shared utilities ────────────────────────────────────────────────────── */
    .small { font-size: 0.78rem; }
    .dim   { color: var(--text-dim, #888); }

    /* ── Buttons ─────────────────────────────────────────────────────────────── */
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
        &.square  { width: 1.5rem; height: 1.5rem; padding: 0; justify-content: center; }
        &.small   { font-size: 0.75rem; padding: 0.15rem 0.4rem; }

        &:hover {
            background: var(--act, #1e2233);
            border-color: var(--acttext, #7ec8e3);
            color: var(--acttext, #7ec8e3);
        }

        &:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }

        :global(svg.feather) {
            width: 0.82rem; height: 0.82rem;
            fill: none; stroke: currentColor; stroke-width: 2;
        }
    }
</style>
