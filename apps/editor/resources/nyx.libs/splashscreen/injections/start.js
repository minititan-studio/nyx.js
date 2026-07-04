(function ctSplashscreen() {
    let   slides          = [/*%slides%*/][0] || [];
    const [transDur]      = [/*%transitionDuration%*/];
    const bgColor         = '/*%backgroundColor%*/';
    const transColor      = u.hexToPixi('/*%transitionColor%*/');
    const [skippable]     = [/*%skippable%*/];
    const showBranding    = [/*%showNyxBranding%*/][0];

    // Runtime fallback: if branding is on and no builtin slide is in the array yet, prepend one.
    if (showBranding && !slides.some(function(s) { return s.__nyxBuiltin; })) {
        slides = [{ __nyxBuiltin: true, effect: 'none', duration: 2000, fill: true }].concat(slides);
    }

    if (!slides.length) return;

    const transitionDuration = (transDur > 0 ? transDur : 500);
    const oldStartingName    = rooms.starting;
    const oldRoom            = rooms.templates[oldStartingName];

    // Lazy canvas texture for the built-in Nyx branding slide.
    let _nyxTex = null;
    function getNyxTex() {
        if (_nyxTex) return _nyxTex;
        const bc = document.createElement('canvas');
        bc.width = 512; bc.height = 288;
        const bx = bc.getContext('2d');
        bx.fillStyle = '#12122a';
        bx.fillRect(0, 0, 512, 288);
        bx.fillStyle = '#7ec8e3';
        bx.font = 'bold 100px system-ui, sans-serif';
        bx.textAlign = 'center';
        bx.textBaseline = 'middle';
        bx.fillText('Nyx', 256, 120);
        bx.font = '26px system-ui, sans-serif';
        bx.fillStyle = 'rgba(200,220,255,0.75)';
        bx.fillText('Made with Nyx', 256, 210);
        _nyxTex = PIXI.Texture.from(bc);
        return _nyxTex;
    }

    let currentIndex  = 0;
    let advanceTimer  = null;   // native setTimeout handle

    function cancelTimer() {
        if (advanceTimer !== null) {
            clearTimeout(advanceTimer);
            advanceTimer = null;
        }
    }

    function advance() {
        cancelTimer();
        currentIndex++;
        if (currentIndex >= slides.length) {
            rooms.starting = oldStartingName;
            rooms.switch(oldStartingName);
        } else {
            rooms.switch('CTSPLASHSCREEN');
        }
    }

    function createSlide() {
        const slide = slides[currentIndex];
        if (!slide) { advance(); return; }

        const slideDuration = (slide.duration > 0 ? slide.duration : 2000);

        // Resolve logo texture.
        const texSource = slide.__nyxBuiltin
            ? getNyxTex()
            : res.getTexture(slide.texture, 0);

        const logo = new PIXI.Sprite(texSource);
        logo.anchor.set(0.5);
        logo.x = camera.width  / 2;
        logo.y = camera.height / 2;
        const logoW = logo.width  || 1;
        const logoH = logo.height || 1;
        const fit   = Math.min(camera.width / logoW, camera.height / logoH);
        logo.scale.set(slide.fill ? fit : fit * 0.5);
        rooms.current.addChild(logo);

        // Optional zoom effect (fire-and-forget tween).
        if (slide.effect === 'zoomIn') {
            const end = logo.scale.x;
            logo.scale.set(end * 0.9);
            tween.add({ obj: logo.scale, fields: { x: end, y: end },
                        duration: slideDuration, isUi: true, silent: true }).catch(function() {});
        } else if (slide.effect === 'zoomOut') {
            const end = logo.scale.x * 0.9;
            tween.add({ obj: logo.scale, fields: { x: end, y: end },
                        duration: slideDuration, isUi: true, silent: true }).catch(function() {});
        }

        // Fade overlay (visual only — does not gate advance()).
        const overlay = new PIXI.Graphics();
        overlay.beginFill(transColor);
        overlay.drawRect(0, 0, camera.width + 1, camera.height + 1);
        overlay.endFill();
        overlay.alpha = 1;
        rooms.current.addChild(overlay);

        // Fade in.
        tween.add({ obj: overlay, fields: { alpha: 0 },
                    duration: transitionDuration, isUi: true, silent: true }).catch(function() {});

        // Fade out before the slide ends, then advance — all via native setTimeout.
        // No promise chains; advance() is guaranteed to fire.
        advanceTimer = setTimeout(function() {
            advanceTimer = null;
            tween.add({ obj: overlay, fields: { alpha: 1 },
                        duration: transitionDuration, isUi: true, silent: true }).catch(function() {});
            setTimeout(function() {
                advance();
            }, transitionDuration);
        }, slideDuration - transitionDuration);
    }

    inputs.addAction('CTSPLASHSCREENAnyInput', [
        { code: 'gamepad.Any',     multiplier: 1 },
        { code: 'mouse.Left',      multiplier: 1 },
        { code: 'touch.Any',       multiplier: 1 },
        { code: 'keyboard.Escape', multiplier: 1 },
        { code: 'keyboard.Space',  multiplier: 1 }
    ]);

    rooms.templates.CTSPLASHSCREEN = {
        name: 'CTSPLASHSCREEN',
        backgroundColor: bgColor,
        width:  oldRoom.width,
        height: oldRoom.height,
        objects: [], bgs: [], tiles: [],
        behaviors: [], bindings: {},
        follow: -1, isUi: false, extends: {},
        ui: [], uiLayerNames: [],
        onCreate: function onCreate()  { createSlide(); },
        onDraw:   function onDraw()    { void 0; },
        onLeave:  function onLeave()   { cancelTimer(); },
        onStep:   function onStep() {
            if (skippable && actions.CTSPLASHSCREENAnyInput.pressed) {
                advance();
            }
        }
    };

    rooms.starting = 'CTSPLASHSCREEN';
})();
