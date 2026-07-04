// lightIsEmitter is set by the exporter only when the template has isEmitter: true.
// Previously this checked `this.lightShape` which was always truthy (default 'soft'), making
// every copy a light emitter — that was a bug. Now it requires an explicit opt-in.
if (templates.isCopy(this) && this.lightIsEmitter) {
    const tex = typeof this.lightTexture === 'string'
        ? res.getTexture(this.lightTexture, 0)
        : light.getDefaultTexture(this.lightShape || 'soft');
    this.light = light.add(tex, this.x, this.y, {
        tint: u.hexToPixi(this.lightColor || '#FFFFFF'),
        scaleFactor: this.lightScale === void 0 ? 1 : this.lightScale,
        copyOpacity: this.lightOpacity === void 0 ? true : this.lightOpacity,
        owner: this,
        castShadows: Boolean(this.lightCastShadows),
        shadowRadius: this.lightRadius || 300,
        lightType: this.lightType || 'point',
        coneAngle: this.lightConeAngle || 90
    });
    this.light.scale.x = this.light.scale.y = this.lightScale || 1;
}
