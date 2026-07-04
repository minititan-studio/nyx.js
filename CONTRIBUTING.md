# Contributing to nyx.js

Thanks for your interest in nyx.js. This project is in early development, so
contributions of all sizes — bug reports, docs fixes, feature PRs — are
welcome.

Please read this document before opening a pull request.

---

## Before you start

- nyx.js is **alpha software**. APIs, project format, and editor layout are
  all subject to change. Open an issue before starting any large change so we
  can align on direction.
- This is not a fork of ct.js, and we do not plan to support ct.js project
  files (`.ict`). Patches that add ct.js compatibility will be declined.

---

## Development setup

Requires **Node.js ≥ 18** and **pnpm ≥ 10**.

```bash
git clone https://github.com/YOUR-USERNAME/nyx.js.git
cd nyx.js
pnpm install
pnpm dev          # launch the editor
pnpm lint         # run ESLint
pnpm build:all    # build every workspace package
```

The repo is a pnpm workspace monorepo. See [README.md](README.md#project-layout)
for the directory layout.

---

## Project conventions

These rules keep the codebase consistent and minimize merge conflicts. Please
follow them in PRs.

### One change per PR

Work on **one component, one package, or one IPC domain at a time**. Don't
bundle unrelated refactors into the same PR — split them up.

### No UI redesign without discussion

The editor's panel layout, density, and interactions are intentional. Don't
replace existing panels with generic admin templates or simplified card
grids. If you want to propose a UI change, open an issue first.

### Scripts live in `.ts` files — never in JSON

The scripting system is built around TypeScript classes on disk. Never store
event code, function bodies, or script content inside `project.json` or any
other JSON file. `project.json` is metadata only (`scriptPath`, `uid`, `name`,
asset references, settings).

### Preserve user workflow

When changing the editor, preserve:

- keyboard shortcuts
- context menus
- drag-and-drop flows
- tab behavior
- existing editor panels

### TypeScript strict mode

All code must compile in TypeScript strict mode. Avoid `any` unless
unavoidable, and document why when you use it.

### IPC and UI stay separated

In the editor, Electron main-process IPC logic (`apps/editor/electron/`)
stays separate from Svelte UI logic (`apps/editor/src/`). Don't mix them.

---

## Reporting bugs

Open a [bug report issue](.github/ISSUE_TEMPLATE/bug_report.md). Please include:

- nyx.js version (commit SHA if from `main`)
- OS and version
- Steps to reproduce
- What you expected to happen
- What actually happened (logs, screenshots)

For **security vulnerabilities**, do not open a public issue — see
[SECURITY.md](SECURITY.md).

---

## Proposing features

Open a [feature request issue](.github/ISSUE_TEMPLATE/feature_request.md)
before writing code for any non-trivial feature. We may want to discuss
scope, naming, or API shape before you invest time.

---

## Pull request process

1. Fork the repo and create a topic branch from `main`.
2. Make your change. Keep commits focused; squash if needed before the final
   PR.
3. Run `pnpm lint` and `pnpm build:all` and make sure both pass.
4. Open a PR against `main`. Fill out the PR template.
5. Link the related issue (if any) in the PR description.

A maintainer will review. Expect back-and-forth — the project is small and
opinionated, and we may ask you to scope the change differently than you
proposed.

---

## Code of Conduct

By participating in this project, you agree to abide by the
[Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) — the same license as the rest of the project.
