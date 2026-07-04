const physicsConfig = {
    physicLoop: void 0,
    runnerTickRate: void 0, // Can set a default value here, e.g. 60
    runnerTickRateLog: false,
    runnerTickRateLogInterval: null,
    physicsTickInterval: 1000 / 60,
    runnerUpdateInterval: null,
    runnerPause: false,
    lastPhysicsUpdateTime: performance.now(),
    matterTickPerSecond: 0,
    renderCountPerSecond: 0,
    alphaInterpRender: 0,
    isInterpolation: false,
    InterpolateType: void 0,

    // Angle interpolation function
    interpolateAngle: function(a0, a1, alpha) {
        let delta = a1 - a0;
        if (delta > Math.PI) {
            delta -= 2 * Math.PI;
        } else if (delta < -Math.PI) {
            delta += 2 * Math.PI;
        }
        return a0 + delta * alpha;
    }
};


window.matter = {
    killCompound(compound){
        // Mark copies for deletion
        compound.arrCopies.forEach(copy => copy.kill = true)
        // Remove the compound body from the world
        Matter.World.remove(rooms.current.matterWorld, compound);

    },
    createCompound(arrCopies){
        let parts = arrCopies.map(body => body.matterBody)
        // Merge parts into one compound body
        const compound = Matter.Body.create({
            parts: parts
        });
        for(let i = 0; i < arrCopies.length; i++){
            // Mark copies as compound parts; add a reference to the compound body
            arrCopies[i].compound = compound;
            // Remove the source parts from the world
            Matter.World.remove(rooms.current.matterWorld, arrCopies[i].matterBody);
            // Update references to the body in copies
            arrCopies[i].matterBody = compound.parts[i+1]; // i = 0 это сам compound
        }
        // Add the compound body to the world
        Matter.Composite.add(rooms.current.matterWorld, compound);
        // Return the compound body with a reference to its copies
        compound.arrCopies = arrCopies;
        return compound;
    },
    on(event, callback) {
        Matter.Events.on(rooms.current.matterEngine, event, callback);
    },
    off(event, callback) {
        Matter.Events.off(rooms.current.matterEngine, event, callback);
    },

    teleport(copy, x, y) {
        Matter.Body.setPosition(copy.matterBody, {
            x,
            y
        });
        copy.x = x;
        copy.y = y;
    },
    push(copy, forceX, forceY, fromX, fromY) {
        if (fromX === void 0) {
            Matter.Body.applyForce(copy.matterBody, copy.matterBody.position, {
                x: forceX,
                y: forceY
            });
        } else {
            Matter.Body.applyForce(copy.matterBody, {
                x: fromX,
                y: fromY
            }, {
                x: forceX,
                y: forceY
            });
        }
    },
    spin(copy, speed) {
        Matter.Body.setAngularVelocity(copy.matterBody, u.degToRad(speed));
    },
    rotate(copy, angle) {
        Matter.Body.setAngle(copy.matterBody, u.degToRad(angle));
    },
    rotateBy(copy, angle) {
        Matter.Body.rotate(copy.matterBody, u.degToRad(angle));
    },
    scale(copy, x, y) {
        Matter.Body.scale(copy, x, y);
        copy.scale.x = x;
        copy.scale.y = y;
    },
    launch(copy, hspeed, vspeed) {
        Matter.Body.setVelocity(copy.matterBody, {
            x: hspeed,
            y: vspeed
        });
    },

    pin(copy) {
        const constraint = Matter.Constraint.create({
            bodyB: copy.matterBody,
            pointA: {
                x: copy.x,
                y: copy.y
            },
            length: 0
        });
        Matter.World.add(rooms.current.matterWorld, constraint);
        return constraint;
    },
    tie(copy, position, stiffness = 0.05, damping = 0.05) {
        const constraint = Matter.Constraint.create({
            bodyB: copy.matterBody,
            pointA: position,
            pointB: {
                x: 0,
                y: 0
            },
            stiffness,
            damping
        });
        Matter.World.add(rooms.current.matterWorld, constraint);
        return constraint;
    },
    rope(copy, length, stiffness = 0.05, damping = 0.05) {
        const constraint = Matter.Constraint.create({
            pointA: copy.position,
            bodyB: copy.matterBody,
            length,
            stiffness,
            damping
        });
        Matter.World.add(rooms.current.matterWorld, constraint);
        return constraint;
    },
    tieTogether(copy1, copy2, stiffness, damping) {
        const constraint = Matter.Constraint.create({
            bodyA: copy1.matterBody,
            bodyB: copy2.matterBody,
            stiffness,
            damping
        });
        Matter.World.add(rooms.current.matterWorld, constraint);
        return constraint;
    },
    onCreate(copy) {
        const options = {
            isStatic: copy.matterStatic,
            isSensor: copy.matterSensor,
            restitution: copy.matterRestitution || 0.1,
            friction: copy.matterFriction === void 0 ? 1 : copy.matterFriction,
            frictionStatic: copy.matterFrictionStatic === void 0 ? 0.1 : copy.matterFrictionStatic,
            frictionAir: copy.matterFrictionAir || 0.01,
            density: copy.matterDensity || 0.001
        };
        if (copy.shape.type === 'rect') {
            copy.matterBody = Matter.Bodies.rectangle(
                copy.x - copy.shape.left,
                copy.y - copy.shape.top,
                copy.shape.left + copy.shape.right,
                copy.shape.top + copy.shape.bottom,
                options
            );
        }
        if (copy.shape.type === 'circle') {
            copy.matterBody = Matter.Bodies.circle(
                copy.x,
                copy.y,
                copy.shape.r,
                options
            );
        }
        if (copy.shape.type === 'strip') {
            const vertices = Matter.Vertices.create(copy.shape.points);
            copy.matterBody = Matter.Bodies.fromVertices(copy.x, copy.y, vertices, options);
        }

        Matter.Body.setCentre(copy.matterBody, {
            x: (copy.texture.defaultAnchor.x - 0.5) * copy.texture.width,
            y: (copy.texture.defaultAnchor.y - 0.5) * copy.texture.height
        }, true);
        Matter.Body.setPosition(copy.matterBody, copy.position);
        Matter.Body.setAngle(copy.matterBody, u.degToRad(copy.angle));
        Matter.Body.scale(copy.matterBody, copy.scale.x, copy.scale.y);

        Matter.World.add(rooms.current.matterWorld, copy.matterBody);
        copy.matterBody.copy = copy;

        if (copy.matterLockRotation) {
            Matter.Body.setInertia(copy.matterBody, Infinity);
        }

        if (copy.matterKinematic) {
            copy.matterBody.frictionAir = 0;
            window.matter.setGravityScale(copy, 0);
        } else if (copy.matterGravityScale !== undefined && copy.matterGravityScale !== 1) {
            window.matter.setGravityScale(copy, copy.matterGravityScale);
        }

        if (copy.matterLockAxisX) {
            copy.matterBody._matterLockAxisX = true;
        }
        if (copy.matterLockAxisY) {
            copy.matterBody._matterLockAxisY = true;
        }
        if (copy.matterLockAxisX || copy.matterLockAxisY) {
            const engine = rooms.current.matterEngine;
            if (!engine._AxisLockHooked) {
                engine._AxisLockHooked = true;
                Matter.Events.on(engine, 'beforeUpdate', function() {
                    for (const body of Matter.Composite.allBodies(engine.world)) {
                        if (body._matterLockAxisX) {
                            body.force.x = 0;
                            Matter.Body.setVelocity(body, { x: 0, y: body.velocity.y });
                        }
                        if (body._matterLockAxisY) {
                            body.force.y = 0;
                            Matter.Body.setVelocity(body, { x: body.velocity.x, y: 0 });
                        }
                    }
                });
            }
        }

        if (copy.matterFixPivot && copy.matterFixPivot[0]) {
            [copy.pivot.x] = copy.matterFixPivot;
        }
        if (copy.matterFixPivot && copy.matterFixPivot[1]) {
            [, copy.pivot.y] = copy.matterFixPivot;
        }

        if (copy.matterConstraint === 'pinpoint') {
            copy.constraint = window.matter.pin(copy);
        } else if (copy.matterConstraint === 'rope') {
            copy.constraint = window.matter.rope(
                copy,
                copy.matterRopeLength === 0 ? 64 : copy.matterRopeLength,
                copy.matterRopeStiffness === 0 ? 0.05 : copy.matterRopeStiffness,
                copy.matterRopeDamping === 0 ? 0.05 : copy.matterRopeDamping
            );
        }

        if (copy.matterCollisionCategory !== undefined) {
            copy.matterBody.collisionFilter = {
                category: copy.matterCollisionCategory,
                mask:     copy.matterCollisionMask ?? -1,
                group:    0
            };
        }
        copy.matterBody._matterGroup = copy.matterCollisionGroup ?? '';
    },
    getGroup(copy) {
        if (!copy || !copy.matterBody) return '';
        return copy.matterBody._matterGroup ?? '';
    },
    inGroup(copy, groupName) {
        if (!copy || !copy.matterBody) return false;
        return (copy.matterBody._matterGroup ?? '') === groupName;
    },
    createStaticTilemap(tilemap) {
        const options = {
            isStatic: true,
            isSensor: false,
            restitution: tilemap.matterRestitution ?? 0.1,
            friction: tilemap.matterFriction ?? 1
        };
        for (const tile of tilemap.tiles) {
            window.matter.createStaticTile(tile, options);
        }
    },
    createStaticTile(tile, options) {
        const {shape} = tile.sprite;
        if (!shape || shape.type === 'point') return;

        // tile.x/y are always the top-left corner in data space.
        // sprite.x/y may differ (center-anchored for rotation), so read origin from data.
        const sx = tile.sprite.scale.x;
        const sy = tile.sprite.scale.y;
        const ox = tile.x;
        const oy = tile.y;

        if (shape.type === 'rect') {
            const cx = ox + (shape.right - shape.left) * sx / 2;
            const cy = oy + (shape.bottom - shape.top) * sy / 2;
            tile.matterBody = Matter.Bodies.rectangle(
                cx, cy,
                (shape.left + shape.right) * Math.abs(sx),
                (shape.top  + shape.bottom) * Math.abs(sy),
                options
            );
        } else if (shape.type === 'circle') {
            tile.matterBody = Matter.Bodies.circle(
                ox, oy,
                shape.r * Math.max(Math.abs(sx), Math.abs(sy)),
                options
            );
        } else if (shape.type === 'strip') {
            const verts = Matter.Vertices.create(
                shape.points.map(p => ({ x: ox + p.x * sx, y: oy + p.y * sy }))
            );
            tile.matterBody = Matter.Bodies.fromVertices(ox, oy, verts, options);
        }

        if (!tile.matterBody) return;
        if (tile.sprite.rotation !== 0) {
            Matter.Body.setAngle(tile.matterBody, tile.sprite.rotation);
        }
        Matter.World.add(rooms.current.matterWorld, tile.matterBody);
    },
    getImpact(pair) {
        const {bodyA, bodyB} = pair;
        if (bodyA.isSensor || bodyB.isSensor) {
            return 0;
        }
        // Because static objects are Infinity-ly heavy, and Infinity * 0 returns NaN,
        // We should compute mass for static objects manually.
        const massA = bodyA.mass === Infinity ? 0 : bodyA.mass,
              massB = bodyB.mass === Infinity ? 0 : bodyB.mass;
        const impact = /*(bodyA.mass + bodyB.mass) */ u.pdc(
            // This tells how much objects are moving in opposite directions
            bodyA.velocity.x * massA,
            bodyA.velocity.y * massA,
            bodyB.velocity.x * massB,
            bodyB.velocity.y * massB
        );
        return impact;
    },
    walkOverWithRulebook(rulebook, pairs) {
        if (!pairs.length || !rulebook.length) {
            return;
        }
        for (const pair of pairs) {
            const impact = window.matter.getImpact(pair);
            const bodies = [pair.bodyA, pair.bodyB];
            for (const body of bodies) {
                if (!body.copy) {
                    continue;
                }
                for (const rule of rulebook) {
                    if (body.copy.template === rule.mainTemplate) {
                        const otherBody = pair.bodyA === body ? pair.bodyB : pair.bodyA;
                        // eslint-disable-next-line max-depth
                        if (rule.any ||
                            (otherBody.copy && rule.otherTemplate === otherBody.copy.template)) {
                            rule.func.apply(body.copy, [otherBody.copy || otherBody.tile, impact]);
                        }
                    }
                }
            }
        }
    },
    // --- Velocity helpers ---
    setVelX(copy, vx) {
        Matter.Body.setVelocity(copy.matterBody, { x: vx, y: copy.matterBody.velocity.y });
    },
    setVelY(copy, vy) {
        Matter.Body.setVelocity(copy.matterBody, { x: copy.matterBody.velocity.x, y: vy });
    },
    addVelocity(copy, dvx, dvy) {
        const v = copy.matterBody.velocity;
        Matter.Body.setVelocity(copy.matterBody, { x: v.x + dvx, y: v.y + dvy });
    },
    getVelocity(copy) {
        const { x, y } = copy.matterBody.velocity;
        return { x, y };
    },
    clampVelocity(copy, maxX, maxY) {
        const v = copy.matterBody.velocity;
        Matter.Body.setVelocity(copy.matterBody, {
            x: Math.max(-maxX, Math.min(maxX, v.x)),
            y: Math.max(-maxY, Math.min(maxY, v.y))
        });
    },

    // --- Impulse (instant velocity kick proportional to 1/mass) ---
    impulse(copy, ix, iy) {
        const body = copy.matterBody;
        Matter.Body.setVelocity(body, {
            x: body.velocity.x + ix / body.mass,
            y: body.velocity.y + iy / body.mass
        });
    },

    // --- Runtime property setters ---
    setDrag(copy, drag) {
        copy.matterBody.frictionAir = drag;
    },
    setMass(copy, mass) {
        Matter.Body.setMass(copy.matterBody, mass);
    },
    setFriction(copy, friction) {
        copy.matterBody.friction = friction;
    },
    setStatic(copy, isStatic) {
        Matter.Body.setStatic(copy.matterBody, isStatic);
    },

    // --- Sleep control ---
    sleep(copy) {
        Matter.Sleeping.set(copy.matterBody, true);
    },
    wake(copy) {
        Matter.Sleeping.set(copy.matterBody, false);
    },
    isSleeping(copy) {
        return copy.matterBody.isSleeping === true;
    },

    // --- Per-body gravity scale (1 = normal, 0 = no gravity, 2 = double) ---
    setGravityScale(copy, scale) {
        copy.matterBody._matterGravityScale = scale;
        const engine = rooms.current.matterEngine;
        if (!engine._GravityScaleHooked) {
            engine._GravityScaleHooked = true;
            Matter.Events.on(engine, 'beforeUpdate', function() {
                const gx = engine.gravity.x * engine.gravity.scale;
                const gy = engine.gravity.y * engine.gravity.scale;
                for (const body of Matter.Composite.allBodies(engine.world)) {
                    if (body._matterGravityScale !== undefined && body._matterGravityScale !== 1) {
                        const delta = body._matterGravityScale - 1;
                        Matter.Body.applyForce(body, body.position, {
                            x: gx * body.mass * delta,
                            y: gy * body.mass * delta
                        });
                    }
                }
            });
        }
    },
    isGrounded(copy, distance = 6) {
        const body = copy.matterBody;
        const allBodies = Matter.Composite.allBodies(rooms.current.matterWorld);
        const others = allBodies.filter(b => b !== body && !b.isSensor);
        const bottom = body.bounds.max.y;
        const cx = body.position.x;
        const hw = (body.bounds.max.x - body.bounds.min.x) * 0.4;
        const pts = [
            { x: cx - hw, y: bottom },
            { x: cx,      y: bottom },
            { x: cx + hw, y: bottom }
        ];
        for (const pt of pts) {
            if (Matter.Query.ray(others, pt, { x: pt.x, y: pt.y + distance }).length > 0) {
                return true;
            }
        }
        return false;
    },
    rulebookStart: [],
    rulebookActive: [],
    rulebookEnd: []
};
