/**
 * 2D visibility polygon (shadow casting).
 * All coordinates are screen-space (matching copy.worldTransform positions).
 */
const shadowcast = (function () {
    const EPSILON = 0.00001;

    function raySegment(ox, oy, dx, dy, ax, ay, bx, by) {
        const sdx = bx - ax, sdy = by - ay;
        const denom = dx * sdy - dy * sdx;
        if (Math.abs(denom) < EPSILON) return Infinity;
        const t2 = (dx * (oy - ay) - dy * (ox - ax)) / denom;
        if (t2 < -EPSILON || t2 > 1 + EPSILON) return Infinity;
        const t1 = Math.abs(dx) > Math.abs(dy)
            ? ((ax - ox) + sdx * t2) / dx
            : ((ay - oy) + sdy * t2) / dy;
        return t1 > -EPSILON ? t1 : Infinity;
    }

    function castRay(ox, oy, angle, radius, segs) {
        const dx = Math.cos(angle), dy = Math.sin(angle);
        // radius may be a function(angle)→number for oblong/elliptical lights.
        let nearest = typeof radius === 'function' ? radius(angle) : radius;
        for (let i = 0; i < segs.length; i += 4) {
            const t = raySegment(ox, oy, dx, dy, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
            if (t < nearest) nearest = t;
        }
        return { x: ox + dx * nearest, y: oy + dy * nearest };
    }

    function pushAABB(segs, l, t, r, b) {
        segs.push(l, t, r, t,  r, t, r, b,  r, b, l, b,  l, b, l, t);
    }

    function getBlockerSegments(ox, oy, radius) {
        const segs = [];
        const cullR = radius * 1.5;
        const cullR2 = cullR * cullR;

        for (const name in templates.list) {
            for (const copy of templates.list[name]) {
                if (!copy || !copy.lightBlocker) continue;
                const b = copy.getBounds();
                const cpx = Math.max(b.x, Math.min(ox, b.x + b.width));
                const cpy = Math.max(b.y, Math.min(oy, b.y + b.height));
                if ((cpx-ox)*(cpx-ox) + (cpy-oy)*(cpy-oy) > cullR2) continue;
                pushAABB(segs, b.x, b.y, b.x + b.width, b.y + b.height);
            }
        }

        const room = rooms.current;
        if (room && room.tileLayers) {
            const rwt = room.worldTransform;
            const ra = rwt.a, rb = rwt.b, rc = rwt.c, rd = rwt.d;
            const rtx = rwt.tx, rty = rwt.ty;
            for (const layer of room.tileLayers) {
                for (const tile of layer.tiles) {
                    if (!layer.lightBlocker && !tile.lightBlocker) continue;
                    if (!tile.sprite) continue;
                    // tile.sprite.texture gives the actual frame size (not the full tileset image).
                    // tile.x/y are room-space coords — use room.worldTransform for screen projection,
                    // which stays correct for cached tilemaps (sprite.worldTransform can be stale).
                    const fw = tile.sprite.texture.width;
                    const fh = tile.sprite.texture.height;
                    const sx = (tile.scale && tile.scale.x) || 1;
                    const sy = (tile.scale && tile.scale.y) || 1;
                    const rcx = tile.x + fw * sx * 0.5;
                    const rcy = tile.y + fh * sy * 0.5;
                    const hw  = Math.abs(fw * sx) * 0.5;
                    const hh  = Math.abs(fh * sy) * 0.5;
                    const rot = ((tile.rotation || 0) * Math.PI) / 180;
                    const cos = Math.cos(rot), sin = Math.sin(rot);
                    const local = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
                    const corners = local.map(([lx, ly]) => {
                        const rx = rcx + lx*cos - ly*sin;
                        const ry = rcy + lx*sin + ly*cos;
                        return [ra*rx + rc*ry + rtx, rb*rx + rd*ry + rty];
                    });
                    // Cull by closest point on the tile's screen-space AABB to the light.
                    // Center-distance cull fails for wide/tall scaled tiles where the light
                    // sits on the tile but the center is far away.
                    const minX = Math.min(corners[0][0], corners[1][0], corners[2][0], corners[3][0]);
                    const maxX = Math.max(corners[0][0], corners[1][0], corners[2][0], corners[3][0]);
                    const minY = Math.min(corners[0][1], corners[1][1], corners[2][1], corners[3][1]);
                    const maxY = Math.max(corners[0][1], corners[1][1], corners[2][1], corners[3][1]);
                    const cpx = Math.max(minX, Math.min(ox, maxX));
                    const cpy = Math.max(minY, Math.min(oy, maxY));
                    if ((cpx-ox)*(cpx-ox) + (cpy-oy)*(cpy-oy) > cullR2) continue;
                    for (let i = 0; i < 4; i++) {
                        const j = (i + 1) % 4;
                        segs.push(corners[i][0], corners[i][1], corners[j][0], corners[j][1]);
                    }
                }
            }
        }

        return segs;
    }

    function computeVisibilityPolygon(ox, oy, segs, radius, coneDir, coneHalf) {
        const isSpot = coneDir !== undefined && coneHalf !== undefined;
        const angles = [];

        if (isSpot) {
            const steps = 128;
            for (let i = 0; i <= steps; i++) {
                angles.push(coneDir - coneHalf + (coneHalf * 2 * i) / steps);
            }
        } else {
            for (let i = 0; i < segs.length; i += 4) {
                angles.push(
                    Math.atan2(segs[i + 1] - oy, segs[i]     - ox),
                    Math.atan2(segs[i + 3] - oy, segs[i + 2] - ox)
                );
            }
            for (let i = 0; i < 128; i++) {
                angles.push((i / 128) * Math.PI * 2 - Math.PI);
            }
        }

        const raw = [];
        for (const a of angles) raw.push(a - EPSILON, a, a + EPSILON);
        const poly = [...new Set(raw)].sort((a, b) => a - b)
            .map(a => castRay(ox, oy, a, radius, segs));

        if (isSpot) {
            poly.unshift({ x: ox, y: oy });
            poly.push({ x: ox, y: oy });
        }
        return poly;
    }

    return { getBlockerSegments, computeVisibilityPolygon };
})();

const light = (function addCtLight() {
    const lightLayer = new PIXI.Container(),
          {renderer} = pixiApp,
          renderTexture = PIXI.RenderTexture.create({
              width: 1024,
              height: 1024
          }),
          lightSprite = new PIXI.Sprite(renderTexture);
    let bg, ambientColor, ambientHex = 0x000000;
    lightSprite.isUi = true;
    lightSprite.blendMode = PIXI.BLEND_MODES.MULTIPLY;
    const light = {
        /**
         * @param {PIXI.Texture} texture
         * @param {number} x
         * @param {number} y
         * @returns {PIXI.Sprite}
         */
        add(texture, x, y, options) {
            const l = new PIXI.Sprite(texture);
            l.blendMode = PIXI.BLEND_MODES.SCREEN;
            l.x = x;
            l.y = y;
            if (options) {
                Object.assign(l, options);
            }
            if (l.castShadows) {
                // Hide the original sprite (used only to carry tint/alpha/scale settings).
                l.visible = false;
                // Gradient sprite provides soft radial falloff — same texture, same blend mode.
                const grad = new PIXI.Sprite(texture);
                grad.blendMode = PIXI.BLEND_MODES.SCREEN;
                grad.anchor.copyFrom(l.anchor);
                lightLayer.addChild(grad);
                l.shadowGradient = grad;
                // Polygon mask clips the gradient to the lit (non-occluded) region.
                const maskGfx = new PIXI.Graphics();
                grad.mask = maskGfx;
                l.shadowMaskGfx = maskGfx;
            }
            lightLayer.addChild(l);
            light.lights.push(l);
            return l;
        },
        /**
         * @param {PIXI.Texture | PIXI.Sprite} copyOrLight
         * @returns {void}
         */
        remove(copyOrLight) {
            copyOrLight = copyOrLight.light || copyOrLight;
            if (copyOrLight.owner) {
                delete copyOrLight.owner.light;
            }
            if (copyOrLight.shadowGradient) {
                copyOrLight.shadowGradient.destroy();
            }
            if (copyOrLight.shadowMaskGfx) {
                copyOrLight.shadowMaskGfx.destroy();
            }
            copyOrLight.destroy({
                children: true
            });
            const arr = light.lights;
            arr.splice(arr.indexOf(copyOrLight), 1);
        },
        lights: [],
        defaultTextures: {},
        getDefaultTexture(shape) {
            if (light.defaultTextures[shape]) {
                return light.defaultTextures[shape];
            }
            const size = 512, half = size / 2;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            let gradient;
            if (shape === 'circle') {
                ctx.beginPath();
                ctx.arc(half, half, half, 0, Math.PI * 2);
                ctx.fillStyle = '#FFFFFF';
                ctx.fill();
            } else if (shape === 'point') {
                // Sharp hot-spot that decays with ~1/r² physical falloff
                gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
                gradient.addColorStop(0,    'rgba(255,255,255,1)');
                gradient.addColorStop(0.04, 'rgba(255,255,255,1)');
                gradient.addColorStop(0.12, 'rgba(255,255,255,0.75)');
                gradient.addColorStop(0.25, 'rgba(255,255,255,0.35)');
                gradient.addColorStop(0.45, 'rgba(255,255,255,0.1)');
                gradient.addColorStop(0.7,  'rgba(255,255,255,0.02)');
                gradient.addColorStop(1,    'rgba(255,255,255,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, size, size);
            } else {
                // Smooth area light with a soft cubic falloff
                gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
                gradient.addColorStop(0,    'rgba(255,255,255,1)');
                gradient.addColorStop(0.35, 'rgba(255,255,255,0.85)');
                gradient.addColorStop(0.65, 'rgba(255,255,255,0.4)');
                gradient.addColorStop(0.85, 'rgba(255,255,255,0.1)');
                gradient.addColorStop(1,    'rgba(255,255,255,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, size, size);
            }
            const tex = PIXI.Texture.from(canvas);
            tex.defaultAnchor.set(0.5, 0.5);
            light.defaultTextures[shape] = tex;
            return tex;
        },
        /**
         * Generate (and cache) a capsule-gradient texture for the given aspect ratio.
         * Unlike a scaled circle (which gives a smooth oval), this produces a true oblong:
         * flat parallel sides along the long axis with rounded end caps.
         *
         * The capsule axis fills the canvas along the long dimension.
         * End-cap radius = half * min(aspect, 1/aspect), so it degenerates to a
         * standard radial gradient when aspect == 1.
         *
         * Falloff stops match getDefaultTexture('soft'):
         *   nd=0.00 → 1.00,  nd=0.35 → 0.85,  nd=0.65 → 0.40,
         *   nd=0.85 → 0.10,  nd=1.00 → 0.00
         *
         * @param {number} aspect  width / height of the emitter tile (world-space)
         * @returns {PIXI.Texture}
         */
        getOblongTexture(aspect) {
            // Round to nearest 0.05 to bound cache size while keeping shape accurate.
            const key = 'oblong_' + (Math.round(aspect * 20) / 20).toFixed(2);
            if (light.defaultTextures[key]) return light.defaultTextures[key];

            const SIZE = 512, half = SIZE / 2;
            const canvas = document.createElement('canvas');
            canvas.width = SIZE;
            canvas.height = SIZE;
            const ctx = canvas.getContext('2d');
            const imageData = ctx.createImageData(SIZE, SIZE);
            const data = imageData.data;

            // Capsule axis endpoints in texture space.
            // Long axis spans the canvas; end-cap radius = half * (short/long side ratio).
            let ax, ay, bx, by, capR;
            if (aspect <= 1) {
                // Tall or square — long axis is Y.
                capR = half * aspect;
                const hl = Math.max(0, half - capR);
                ax = half;      ay = half - hl;
                bx = half;      by = half + hl;
            } else {
                // Wide — long axis is X.
                capR = half / aspect;
                const hl = Math.max(0, half - capR);
                ax = half - hl; ay = half;
                bx = half + hl; by = half;
            }

            const baxc = bx - ax, bayc = by - ay;
            const lenSq = baxc * baxc + bayc * bayc;

            for (let py = 0; py < SIZE; py++) {
                for (let px = 0; px < SIZE; px++) {
                    // Distance from pixel to nearest point on the capsule axis segment.
                    const pax = px - ax, pay = py - ay;
                    const t   = lenSq > 0
                        ? Math.max(0, Math.min(1, (pax * baxc + pay * bayc) / lenSq))
                        : 0;
                    const dx = pax - baxc * t, dy = pay - bayc * t;
                    // nd: 0 at axis core, 1 at capsule boundary (capR).
                    // Normalising to capR (not half) means the gradient reaches exactly
                    // zero at the capsule perimeter — no hard edge where the polygon clips.
                    const nd = Math.sqrt(dx * dx + dy * dy) / capR;

                    let alpha;
                    if      (nd <= 0.35) alpha = 1.00 - 0.15 * (nd         / 0.35);
                    else if (nd <= 0.65) alpha = 0.85 - 0.45 * ((nd - 0.35) / 0.30);
                    else if (nd <= 0.85) alpha = 0.40 - 0.30 * ((nd - 0.65) / 0.20);
                    else if (nd <= 1.00) alpha = 0.10 - 0.10 * ((nd - 0.85) / 0.15);
                    else                alpha = 0;

                    const i = (py * SIZE + px) * 4;
                    data[i] = data[i + 1] = data[i + 2] = 255;
                    data[i + 3] = Math.round(Math.max(0, alpha) * 255);
                }
            }

            ctx.putImageData(imageData, 0, 0);
            const tex = PIXI.Texture.from(canvas);
            tex.defaultAnchor.set(0.5, 0.5);
            light.defaultTextures[key] = tex;
            return tex;
        },
        render() {
            const pixelScaleModifier = settings.highDensity ? (window.devicePixelRatio || 1) : 1;
            if (renderTexture.resolution !== pixelScaleModifier) {
                renderTexture.setResolution(pixelScaleModifier);
            }
            if (renderTexture.width !== pixiApp.screen.width ||
                renderTexture.height !== pixiApp.screen.height
            ) {
                renderTexture.resize(pixiApp.screen.width, pixiApp.screen.height);
                bg.width = pixiApp.screen.width;
                bg.height = pixiApp.screen.height;
                lightSprite.width = pixiApp.screen.width / pixiApp.stage.scale.x;
                lightSprite.height = pixiApp.screen.height / pixiApp.stage.scale.y;
            }
            renderer.render(lightLayer, {
                renderTexture: renderTexture
            });
        },
        updateOne(l) {
            if (l.owner) {
                if (!templates.valid(l.owner)) {
                    l.remove(l);
                    return;
                }
                l.transform.setFromMatrix(l.owner.worldTransform);
                l.scale.x *= l.scaleFactor || 1;
                l.scale.y *= l.scaleFactor || 1;
                l.angle -= l.rotationFactor || 0;
                if (l.copyOpacity) {
                    l.alpha = l.owner.alpha;
                }
            }
            if (l.castShadows && l.shadowGradient) {
                // Recompute the visibility polygon and use it as the gradient's clip mask.
                const baseRadius = (l.shadowRadius || 300) * (l.scaleFactor || 1);

                // gradScale: map texture half-size (256 px at scale=1) to the polygon radius.
                const gradScale = baseRadius / 256;
                l.shadowGradient.x     = l.x;
                l.shadowGradient.y     = l.y;
                l.shadowGradient.scale.x = gradScale;
                l.shadowGradient.scale.y = gradScale;
                l.shadowGradient.angle = l.angle;
                l.shadowGradient.tint  = l.tint  !== undefined ? l.tint  : 0xFFFFFF;
                l.shadowGradient.alpha = l.alpha !== undefined ? l.alpha : 1;

                // For oblong emitters (lightAspect != 1), cast rays with a capsule reach
                // so the visibility polygon has flat parallel sides + rounded end caps —
                // exactly matching the gradient texture shape and preventing hard clip edges.
                const aspect = l.lightAspect || 1;
                let castRadius = baseRadius;
                if (aspect !== 1) {
                    const shortRatio = aspect < 1 ? aspect : 1 / aspect;
                    const longR = baseRadius, shortR = longR * shortRatio;
                    const h = longR - shortR; // half-length of the flat (parallel) section
                    const tileAngleRad = (l.angle || 0) * (Math.PI / 180);
                    // shortAxisAngle: world-space direction of the emitter's short axis.
                    // Tall tile (aspect<1): short axis is horizontal (0° + tile rotation).
                    // Wide tile (aspect>1): short axis is vertical (90° + tile rotation).
                    const shortAxisAngle = tileAngleRad + (aspect > 1 ? Math.PI / 2 : 0);
                    castRadius = (worldAngle) => {
                        const rel  = worldAngle - shortAxisAngle;
                        const cx   = Math.cos(rel); // along short axis
                        const cy   = Math.sin(rel); // along long axis
                        // Flat side: ray exits through the side wall (at shortR, within ±h along long axis).
                        if (Math.abs(cx) > 1e-10) {
                            const t = shortR / Math.abs(cx);
                            if (Math.abs(cy * t) <= h) return t;
                        }
                        // End cap: hemisphere of radius shortR centred at ±h along long axis.
                        const disc = shortR * shortR - h * h * cx * cx;
                        return Math.abs(h * cy) + (disc >= 0 ? Math.sqrt(disc) : 0);
                    };
                }

                const segs = shadowcast.getBlockerSegments(l.x, l.y, baseRadius);
                let coneDir, coneHalf;
                if (l.lightType === 'spot') {
                    coneDir  = l.angle * (Math.PI / 180);
                    coneHalf = (l.coneAngle || 90) * (Math.PI / 360);
                }
                const poly = shadowcast.computeVisibilityPolygon(l.x, l.y, segs, castRadius, coneDir, coneHalf);
                const maskGfx = l.shadowMaskGfx;
                maskGfx.clear();
                if (poly.length >= 3) {
                    maskGfx.beginFill(0xFFFFFF, 1);
                    maskGfx.moveTo(poly[0].x, poly[0].y);
                    for (let i = 1; i < poly.length; i++) {
                        maskGfx.lineTo(poly[i].x, poly[i].y);
                    }
                    maskGfx.closePath();
                    maskGfx.endFill();
                }
            }
        },
        update() {
            rooms.current.updateTransform();
            for (const l of light.lights) {
                light.updateOne(l);
            }
        },
        clear() {
            lightLayer.removeChildren();
        },
        get ambientColor() {
            return ambientColor;
        },
        set ambientColor(color) {
            ambientColor = color;
            ambientHex = typeof color === 'string'
                ? parseInt(color.replace('#', ''), 16)
                : color;
            if (bg) {
                bg.tint = ambientColor;
            }
            return ambientColor;
        },
        get opacity() {
            return lightSprite.alpha;
        },
        set opacity(opacity) {
            lightSprite.alpha = opacity;
            return opacity;
        },
        install() {
            bg = new PIXI.Sprite(PIXI.Texture.WHITE);
            bg.width = pixiApp.screen.width;
            bg.height = pixiApp.screen.height;
            bg.tint = ambientColor;
            lightLayer.addChildAt(bg, 0);
            pixiApp.stage.addChildAt(
                lightSprite,
                pixiApp.stage.children.indexOf(rooms.current) + 1
            );
            light.render();
        }
    };
    return light;
})();
window.light = light;
