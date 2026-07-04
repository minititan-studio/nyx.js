# Security Policy

## Supported versions

nyx.js is pre-1.0 software. Only the latest commit on `main` is supported —
older commits and tagged pre-releases do not receive security fixes.

| Version          | Supported          |
|------------------|--------------------|
| `main` (latest)  | ✅                 |
| Anything older   | ❌                 |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately via one of these channels:

1. **GitHub Security Advisories** — preferred. Open a draft advisory at
   `https://github.com/minititan-studio/nyx.js/security/advisories/new` (link will
   work once the repo is public).
2. **Email** — send to `head@minititan.online` with subject prefix
   `[nyx.js security]`.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, ideally with a minimal proof of concept.
- The commit SHA or version where you found it.
- Your name / handle if you'd like to be credited in the fix.

## What to expect

- **Acknowledgement** within 7 days.
- **Initial assessment** within 14 days — whether we consider it a
  vulnerability and what severity.
- **Fix or mitigation** target depends on severity. Critical issues get
  prioritized; low-severity issues may be batched into the next release.
- **Public disclosure** happens after a fix is shipped, typically via a
  GitHub Security Advisory.

We do not currently offer a bug bounty.

## Scope

In-scope:

- The editor application (`apps/editor`) — Electron main process, preload,
  renderer.
- The runtime (`apps/runtime`) and its bundled output.
- The `@nyx/*` workspace packages.
- Project-format parsing — anything that reads untrusted `project.json` files
  or asset files.

Out-of-scope:

- Bugs in upstream dependencies (PixiJS, Electron, etc.) — please report
  those to the upstream project. We will pick up their fixes via dependency
  updates.
- Issues that require an attacker to already have local code execution on
  the user's machine.
- Social-engineering attacks on contributors.
