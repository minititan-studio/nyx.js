// Create static light sprites for tile emitters.
// Runs in roomoncreate — AFTER tiles are fully constructed and tile.sprite is assigned.
// beforeroomoncreate fires before tileLayers are populated, so that's too early.
//
// Per-tile lightEmitter takes precedence over the layer-level flag.
// Per-tile emitter fields override the layer defaults via ?? chaining.
if (this === rooms.current && rooms.current.tileLayers) {
    for (const layer of rooms.current.tileLayers) {
        for (const tile of layer.tiles) {
            const shouldEmit = tile.lightEmitter ?? layer.lightEmitter ?? false;
            if (!shouldEmit) continue;
            if (!tile.sprite) continue;

            // Compute tile centre in ROOM SPACE.
            // afterroomdraw converts this to screen-space every frame using room.worldTransform,
            // so the light tracks the camera correctly (same pattern as the shadow blocker system).
            const fw = tile.sprite.texture.width;
            const fh = tile.sprite.texture.height;
            const sx = (tile.scale && tile.scale.x) || 1;
            const sy = (tile.scale && tile.scale.y) || 1;
            const cx = tile.x + fw * sx * 0.5;
            const cy = tile.y + fh * sy * 0.5;

            const shape       = tile.lightEmitterShape ?? layer.lightEmitterShape ?? 'soft';
            const color       = tile.lightEmitterColor ?? layer.lightEmitterColor ?? '#FFFFFF';
            const scaleFactor = tile.lightEmitterScale ?? layer.lightEmitterScale ?? 1;
            const castShadows = tile.lightCastShadows  ?? layer.lightCastShadows  ?? false;
            const radius      = tile.lightRadius       ?? layer.lightRadius       ?? 300;
            const lightType   = tile.lightType         ?? layer.lightType         ?? 'point';
            const coneAngle   = tile.lightConeAngle    ?? layer.lightConeAngle    ?? 90;

            // Capsule gradient texture: flat sides along the tile's long axis.
            // lightAspect is also stored on the sprite so updateOne can make the
            // shadow polygon elliptical (matching the gradient shape).
            const tileAspect = (fw * Math.abs(sx)) / (fh * Math.abs(sy));
            const tex = light.getOblongTexture(tileAspect);
            const l = light.add(tex, cx, cy, {
                tint:         u.hexToPixi(color),
                scaleFactor,
                copyOpacity:  false,
                castShadows,
                shadowRadius: radius,
                lightType,
                coneAngle,
                lightAspect:  tileAspect,
            });
            // Apply scale immediately — updateOne only multiplies scaleFactor when an owner exists.
            l.scale.x = l.scale.y = scaleFactor;
            // Store room-space centre so afterroomdraw can convert to screen-space each frame.
            l._tileRoomX = cx;
            l._tileRoomY = cy;
        }
    }
}
