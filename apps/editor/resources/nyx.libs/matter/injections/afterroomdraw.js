
if (this !== rooms.current || !this.matterDebugGraphics || !this.matterEngine) return;

const g = this.matterDebugGraphics;
g.clear();
if (!window.NYX_PHYSICS_DEBUG) return;

const bodies = Matter.Composite.allBodies(this.matterEngine.world);
for (const body of bodies) {
    // compound bodies expose parts[0] as the parent — skip it, draw parts[1+]
    const parts = (body.parts && body.parts.length > 1) ? body.parts.slice(1) : [body];
    for (const part of parts) {
        const verts = part.vertices;
        if (!verts || verts.length === 0) continue;
        const color = body.isStatic ? 0x00e5ff : 0xff4757;
        g.lineStyle(1, color, 0.85);
        g.moveTo(verts[0].x, verts[0].y);
        for (let i = 1; i < verts.length; i++) {
            g.lineTo(verts[i].x, verts[i].y);
        }
        g.lineTo(verts[0].x, verts[0].y);
    }
}
