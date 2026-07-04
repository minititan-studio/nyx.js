if (this === rooms.current) {
    (function ctLightRender() {
        // Ensure worldTransform is fresh before any coordinate conversion.
        rooms.current.updateTransform();
        const rwt = rooms.current.worldTransform;

        // Extract world scale from the affine matrix (handles zoom/HiDPI correctly).
        // This mirrors what setFromMatrix(owner.worldTransform) does for copy lights.
        const worldScaleX = Math.sqrt(rwt.a * rwt.a + rwt.b * rwt.b);
        const worldScaleY = Math.sqrt(rwt.c * rwt.c + rwt.d * rwt.d);

        // Update tile emitter lights: convert room-space position → screen-space,
        // and propagate world scale so the gradient sprite matches the shadow polygon size.
        // Without the scale update, the gradient renders at scaleFactor only (missing
        // viewport/camera scale), while the shadow polygon is in screen-space pixels —
        // causing a size mismatch that makes the gradient look harsh at the clip edge.
        for (const l of light.lights) {
            if (l._tileRoomX !== undefined) {
                l.x = rwt.a * l._tileRoomX + rwt.c * l._tileRoomY + rwt.tx;
                l.y = rwt.b * l._tileRoomX + rwt.d * l._tileRoomY + rwt.ty;
                l.scale.x = worldScaleX * (l.scaleFactor || 1);
                l.scale.y = worldScaleY * (l.scaleFactor || 1);
            }
        }

        light.update();
        light.render();
    })();
}
