import * as pixi from 'pixi.js';
import * as particles from '@pixi/particle-emitter';
import {sound as pixiSound, filters as pixiSoundFilters} from '@pixi/sound';

/* eslint-disable @typescript-eslint/no-explicit-any */
// ES module namespace objects are sealed — spread into a plain extensible object
const PIXI = { ...pixi } as any;
PIXI.particles = particles;
PIXI.sound = pixiSound;
PIXI.sound.filters = pixiSoundFilters;
(window as any).PIXI = PIXI;
export { PIXI };
