# nyx.js

> A standalone 2D game engine and editor — built with web technologies, designed to be cross-platform.

**Status:** alpha / pre-release — APIs are unstable and breaking changes are expected.

nyx.js (also branded as **Nyx Studio**) is a 2D game engine with an integrated
desktop editor. Games are authored in TypeScript and run on PixiJS 7. The
editor is an Electron app built with Svelte + Vite.

<p align="center">
  <img src="branding/github-header.png" alt="nyx.js — a standalone 2D game engine and editor" />
</p>

---

## Quick start

Requires **Node.js ≥ 18** and **pnpm ≥ 10**.

```bash
git clone https://github.com/minititan-studio/nyx.js.git
cd nyx.js
pnpm install
pnpm dev
```

This launches the editor in development mode.

### Other commands

```bash
pnpm build         # build the editor
pnpm build:all     # build every workspace package
pnpm dist          # package the editor as a desktop app
pnpm dist:win      # Windows installer
pnpm dist:mac      # macOS DMG
pnpm dist:linux    # Linux AppImage
pnpm lint          # run ESLint across the monorepo
```

---

## Project layout

```
/apps
  /editor          ← Electron + Svelte editor (Nyx Studio)
  /runtime         ← PixiJS game runtime (bundled into exported games)

/packages
  /engine          ← @nyx/engine — Template, Behavior, Room base classes
  /project-format  ← project.json reader / writer
  /ui-kit          ← shared Svelte UI components
  /plugin-api      ← catmod (plugin) type definitions
  /shared          ← shared types, event catalog, hotkeys, tooltips
```

---

## Tech stack

- **Editor**: Electron, Svelte, Vite, TypeScript, Monaco
- **Runtime**: PixiJS 7, TypeScript
- **Scripts**: TypeScript classes extending `@nyx/engine` base classes
- **Project format**: JSON (`project.json`) — metadata only, no embedded code

---

## How scripts work

Game scripts are plain TypeScript files on disk — one class per Template /
Behavior / Room — extending base classes from `@nyx/engine`. The editor's
event picker inserts method stubs into your script files; it does not store
code inside JSON. This means you can edit scripts in any IDE and use any
standard tooling (linters, formatters, version control).

```ts
import { Template, actions } from '@nyx/engine';

export class Player extends Template {
  onCreate() {
    this.speed = 4;
  }

  onStep() {
    if (actions.isPressed('MoveRight')) this.x += this.speed;
    if (actions.isPressed('MoveLeft'))  this.x -= this.speed;
  }
}
```

---

## Meet Nyxi

Nyxi is the nyx.js companion — a chibi astronaut who reacts as you build.

<p align="center">
  <img src="branding/nyxi/letscode.webp" width="150" alt="Let's code" title="Let's code" />
  <img src="branding/nyxi/compiling.webp" width="150" alt="Compiling" title="Compiling" />
  <img src="branding/nyxi/buildsuccess.webp" width="150" alt="Build success" title="Build success" />
  <img src="branding/nyxi/crashed.webp" width="150" alt="Oh no — error" title="Oh no — error" />
  <img src="branding/nyxi/allset.webp" width="150" alt="All set" title="All set" />
</p>

---

## Contributing

Contributions are welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md)
first. This is an early-stage project; expect rough edges and breaking
changes.

For security issues, see [SECURITY.md](SECURITY.md). For community
expectations, see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## Credits

nyx.js builds on [ct.js](https://github.com/ct-js/ct-js) — its runtime
patterns are the foundation that `packages/engine` and `apps/runtime` extend.
See [ATTRIBUTIONS.md](ATTRIBUTIONS.md) for the full list of third-party code
and licenses.

---

## License

[MIT](LICENSE) © 2026 Abhinav Bhasin
