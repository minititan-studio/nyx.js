# Attributions

nyx.js builds on the work of many open-source projects. This file documents
the third-party code incorporated into the project, with their respective
licenses and copyright notices.

If you believe an attribution is missing or incorrect, please open an issue.

---

## Direct ancestors

### ct.js

Portions of `packages/engine` and `apps/runtime` are adapted from
[ct.js](https://github.com/ct-js/ct-js)'s `app/data/ct.release` runtime.

- **License**: MIT
- **Copyright**: Cosmo Myzrail Gorynych and ct.js contributors
- **Source**: https://github.com/ct-js/ct-js

nyx.js is a standalone game engine and editor — it is not a fork of ct.js and
does not aim for project-file compatibility — but it owes the original
authors credit for the runtime patterns it builds on.

---

## Runtime dependencies (bundled with exported games)

### PixiJS 7

2D WebGL/Canvas renderer that powers the runtime.

- **License**: MIT
- **Copyright**: Mathew Groves, Chad Engler, and PixiJS contributors
- **Source**: https://github.com/pixijs/pixijs

### @pixi/particle-emitter, @pixi/sound, pixi.js-legacy

PixiJS ecosystem packages used by the runtime.

- **License**: MIT
- **Copyright**: PixiJS contributors

---

## Editor dependencies

### Electron

Desktop application framework.

- **License**: MIT
- **Copyright**: GitHub Inc. and Electron contributors

### Svelte + Vite

UI framework and build tool.

- **License**: MIT
- **Copyright**: Rich Harris (Svelte), Evan You (Vite), and respective contributors

### Monaco Editor

Code editor component embedded in the editor.

- **License**: MIT
- **Copyright**: Microsoft Corporation

### Sharp

Image processing used by the atlas generator.

- **License**: Apache License 2.0
- **Copyright**: Lovell Fuller and contributors
- **Source**: https://github.com/lovell/sharp

### electron-updater, electron-vite, electron-builder, esbuild, js-yaml, mitt, Iconify

- **License**: MIT
- See each package's repository for full copyright notices.

---

## Vendored libraries (`apps/editor/resources/nyx.libs/`)

These are catmod-style modules that can be enabled per-project. They originate
from the [ct.js](https://github.com/ct-js/ct-js) catmod ecosystem (MIT) and its
community contributors. Every module ships its own `LICENSE` file in its
directory — the table below is a summary; the per-directory `LICENSE` is
authoritative.

Most modules are MIT, copyright Cosmo Myzrail Gorynych and ct.js contributors.
The exceptions and third-party-wrapping modules are listed explicitly.

| Module             | License          | Copyright / origin                                                    |
|--------------------|------------------|-----------------------------------------------------------------------|
| akatemplate        | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| assert             | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| capture            | MIT              | Cosmo Myzrail Gorynych, Thomas, and ct.js contributors                |
| cutscene           | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| desktop            | MIT              | Cosmo Myzrail Gorynych, Ehan Ahamed, and ct.js contributors           |
| filters            | MIT              | SN and ct.js contributors — wraps PixiJS Filters (MIT)                |
| flow               | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| fs                 | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| gamedistribution   | MIT (wrapper)    | Ulises Freitas — loads the GameDistribution SDK (proprietary) at runtime; SDK not bundled |
| gamepad            | MIT              | SN, Araujo921, Cosmo Myzrail Gorynych, and ct.js contributors         |
| keyboard           | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| keyboard.polyfill  | MIT / Unlicense  | Joshua Bell (W3C keyboard-map polyfill)                               |
| light              | MIT              | Cosmo Myzrail Gorynych and ct.js contributors (substantially modified in nyx.js) |
| matter             | MIT              | Matter.js © Liam Brummitt and contributors (bundled, `includes/matter.min.js`); catmod wrapper © Cosmo Myzrail Gorynych |
| nakama             | Apache-2.0       | Heroic Labs (Nakama JS client); catmod © Alexandar Gyurov            |
| nanoid             | MIT              | Andrey Sitnik and contributors (nanoid algorithm)                    |
| noise              | MIT / ISC        | Joseph Gentle (noisejs); adapted by Cosmo Myzrail Gorynych           |
| pathfinder         | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| place              | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| pointer            | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| pointer.polyfill   | MIT              | jQuery Foundation and contributors (PEP)                             |
| random             | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| requests           | MIT              | Banbury and ct.js contributors                                        |
| signals            | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| splashscreen       | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| sprite             | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| storage            | MIT              | naturecodevoid and ct.js contributors                                 |
| supabase           | MIT (wrapper)    | Ehan Ahamed — uses @supabase/supabase-js (MIT, © Supabase Inc.) at runtime; not bundled |
| transition         | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| tween              | MIT              | Cosmo Myzrail Gorynych, kkornushin, and ct.js contributors            |
| vkeys              | MIT              | Cosmo Myzrail Gorynych and ct.js contributors                         |
| yarn               | MIT              | Cosmo Myzrail Gorynych (ct.yarn; Bondage.js lineage)                  |

For the canonical license text of each module, see the `LICENSE` file inside
its directory under `apps/editor/resources/nyx.libs/<module>/`.

---

## Notes on derivative work

Where this project adapts code from ct.js, we preserve the MIT license terms
and have not relicensed any original ct.js code. The MIT license of nyx.js
applies to original nyx.js code; portions adapted from ct.js remain under
their original MIT license per ct.js's terms.
