# CLAUDE.md — nyx.js Development Protocol
Version: 2.2
Project: nyx.js — standalone 2D game engine and editor

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)


# PRIMARY OBJECTIVE

nyx.js is a **standalone 2D game engine and editor** — not a ct.js fork or compatibility layer.

- ct.js project files (`.ict`) are not supported and never will be
- All scripting uses TypeScript class files on disk, not embedded code strings in JSON

Stack:
- **Editor**: Electron + Svelte + Vite + TypeScript
- **Runtime**: PixiJS 7 + TypeScript (`apps/runtime/`)
- **Scripts**: TypeScript classes extending `@nyx/engine` base classes
- **Project format**: JSON (`project.json`) — metadata only, no code


# HARD RULES (NON-NEGOTIABLE)

## RULE 1 — ONE MODULE AT A TIME
Never rewrite multiple systems in one pass.

Only work on:
- one component,
- one package,
- or one IPC domain at a time.

## RULE 2 — NO UI REDESIGN
Do not replace the existing editor UI with generic layouts.

Forbidden:
- generic admin templates
- arbitrary card/grid layouts
- simplified mockups that lose editor density
- removing existing panels or tabs without explicit approval

## RULE 3 — NO CODE STRINGS IN PROJECT.JSON
Script code always lives in `.ts` files under `src/`.
`project.json` stores only metadata (`scriptPath`, `uid`, `name`, asset refs, settings).

Never write event code, function bodies, or script content into `project.json` or any other JSON file.

## RULE 4 — NEVER INVENT NEW ARCHITECTURE MID-TASK
Architecture changes require explicit approval.

Do not change:
- store patterns
- project format schema
- base class API surface
- IPC channel names
without approval.

## RULE 5 — PRESERVE USER WORKFLOW
Must preserve:
- keyboard shortcuts
- context menus
- drag/drop flows
- tab behavior
- editor panel interactions


# PROJECT STRUCTURE

```
/apps
  /editor          ← Electron + Svelte editor
  /runtime         ← PixiJS game runtime (bundled into exported games)

/packages
  /engine          ← @nyx/engine — Template/Behavior/Room base classes + game API types
  /project-format  ← project.json reader/writer
  /ui-kit          ← shared Svelte UI components
  /plugin-api      ← catmod (plugin) type definitions
  /shared          ← types, event catalog, hotkeys, tooltips
```


# SCRIPTING SYSTEM RULES

## Script files
- One TypeScript class file per Template (`src/templates/Player.ts`)
- One TypeScript class file per Behavior (`src/behaviors/Gravity.ts`)
- Room scripts are optional (`src/rooms/Level1.ts`) — only created when user adds room events
- All classes use `import { Template, Behavior, Room, actions } from '@nyx/engine'`

## Event → method mapping
- Lifecycle events (onCreate, onStep, onDraw, onDestroy, and Before/After variants) → optional method overrides
- Pointer events (onPointerClick, onPointerOver, etc.) → optional method overrides; base class auto-registers PIXI listener if method exists
- Timer events → call `this.startTimer(id, ms)` in `onCreate()`, then override `onTimer1()` etc.
- Animation events → optional method overrides
- **Action events** → no wrapper method; the editor's Add Event picker inserts an `if (actions.isPressed('X'))` stub into `onStep()`

## Editor event picker
Still exists. Clicking an event **inserts a method stub into the script file** — it does not store code in JSON.


# REQUIRED TASK FORMAT

For every implementation task:

## 1. Task Scope
Exact module/step being worked on.

## 2. Files Changed
List of files to be modified or created.

## 3. Behavior Contract
What the change does and what must not break.

## 4. Implementation
Only the requested code.

## 5. Verification
How to confirm it works.


# CODE QUALITY REQUIREMENTS

All output must:
- compile without errors (TypeScript strict mode)
- use proper types — no `any` unless unavoidable and documented
- avoid dead code
- avoid mock/placeholder data unless marked `// TODO`
- separate IPC logic (main.ts) from UI logic (Svelte components) cleanly


# FORBIDDEN BEHAVIORS

Claude must NEVER:

- Store script code in `project.json` or any JSON file
- Use embedded code strings anywhere in the scripting system
- Load or reference ct.js `.ict` project files
- Rewrite unrelated modules
- Rename APIs or IPC channels without notice
- Merge multiple implementation steps into one response
- Invent placeholder fake implementations unless clearly marked


# WHEN UNCERTAIN

Ask:
> "Ambiguity detected: [describe the question]. Which approach should I follow?"

Never assume — ask first.


# RESPONSE SIZE LIMIT

One step per response. Never combine implementation steps unless explicitly asked.

Work one step at a time.
