if (this === rooms.current) {
  // Dispatch to nyx Template method overrides (onContactAny, onContactTemplate, etc.)
  function MethodDispatch(pairs, anyMethod, templateMethod) {
    for (const pair of pairs) {
      const impact = window.matter.getImpact(pair);
      const bodies = [pair.bodyA, pair.bodyB];
      for (const body of bodies) {
        if (!body.copy) continue;
        const otherBody = pair.bodyA === body ? pair.bodyB : pair.bodyA;
        const other = otherBody.copy || null;
        if (typeof body.copy[anyMethod] === 'function') {
          body.copy[anyMethod](other, impact);
        }
        if (other !== null && typeof body.copy[templateMethod] === 'function') {
          body.copy[templateMethod](other, impact);
        }
      }
    }
  }

  matter.on("collisionStart", (e) => {
    const { pairs } = e;
    matter.walkOverWithRulebook(matter.rulebookStart, pairs);
    MethodDispatch(pairs, 'onContactAny', 'onContactTemplate');
  });
  matter.on("collisionActive", (e) => {
    const { pairs } = e;
    matter.walkOverWithRulebook(matter.rulebookActive, pairs);
    MethodDispatch(pairs, 'onCollisionAny', 'onCollisionTemplate');
  });
  matter.on("collisionEnd", (e) => {
    const { pairs } = e;
    matter.walkOverWithRulebook(matter.rulebookEnd, pairs);
    MethodDispatch(pairs, 'onCollisionEndAny', 'onCollisionEndTemplate');
  });
}

for (const layer of this.tileLayers) {
  if (!layer.matterMakeStatic) {
    continue;
  }
  if (this.children.indexOf(layer) === -1) {
    continue;
  }
  matter.createStaticTilemap(layer);
}

if (this === rooms.current) {
  const _dbg = new PIXI.Graphics();
  _dbg.zIndex = 999999;
  this.addChild(_dbg);
  this.matterDebugGraphics = _dbg;
  window.NYX_PHYSICS_DEBUG = Boolean([/*%debugPhysics%*/][0]);
}
