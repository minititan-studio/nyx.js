# nyx.js brand & design system

Source of truth for the nyx.js visual identity. Anything generated later —
new sizes, social cards, merch, docs art — should follow this file so the
brand stays consistent. First-party; replaces the ct.js assets that used to
live here.

---

## 1. The mark

A **crescent moon** (waxing, pointed cusps, opening right) with a **pixel
cluster** cascading diagonally out of its opening. Moon = *nyx* (night);
pixels = 2D / game-dev. The leading pixel is **cyan** as an accent spark; the
rest carry the moon's violet→pink gradient.

### Exact construction (reproduce pixel-perfect)

`viewBox="0 0 64 64"`. Copy this to rebuild the color mark:

```svg
<defs>
  <linearGradient id="g" x1="18" y1="6" x2="40" y2="60" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#B15CF7"/>
    <stop offset="0.5" stop-color="#B646DC"/>
    <stop offset="1" stop-color="#E24AA0"/>
  </linearGradient>
  <mask id="c">
    <rect width="64" height="64" fill="#000"/>
    <circle cx="26" cy="32" r="24" fill="#fff"/>
    <circle cx="43" cy="30" r="21.5" fill="#000"/>
  </mask>
</defs>
<circle cx="26" cy="32" r="24" fill="url(#g)" mask="url(#c)"/>
<rect x="39"   y="13"   width="8.4" height="8.4" rx="2.1" fill="#22D3EE"/>  <!-- accent -->
<rect x="50"   y="21.5" width="8.4" height="8.4" rx="2.1" fill="url(#g)"/>
<rect x="40.5" y="30"   width="7.2" height="7.2" rx="1.8" fill="url(#g)"/>
<rect x="51"   y="35.5" width="8.4" height="8.4" rx="2.1" fill="url(#g)"/>
```

- **Crescent** = a `r24` circle at `(26,32)` masked by a `r21.5` circle at
  `(43,30)`. Do not change these radii/offsets — they set the cusp sharpness.
- **Mono** version: drop the gradient + cyan; fill everything one flat colour
  (white on dark, `#151A2E` on light). Give the four pixels opacities
  `0.95 / 0.8 / 0.65 / 0.85` top→bottom for a little depth.
- Mark visual centre ≈ `(30.7, 32)` — use this when centring inside a badge.

### Wordmark

`nyx.js` in **Inter**, weight **800**, letter-spacing `-1.5` at 40px (scale
proportionally). The `.js` takes the accent `#B646DC` (colour) or reduced
opacity (mono). Always lowercase.

---

## 2. Colour

| Token | Hex | Role |
|-------|-----|------|
| `violet` | `#8B5CF6` | primary / UI accent |
| `purple` | `#B646DC` | wordmark `.js`, gradient mid |
| `magenta` | `#E24AA0` | gradient end |
| `cyan` | `#22D3EE` | accent spark, highlights |
| `pink` | `#EC4899` | secondary accent (sparingly) |
| `ink` | `#151A2E` | dark text / surfaces |
| `night` | `#0B1020` | primary dark background |
| `mist` | `#E5E7EB` | light background |

**Moon gradient:** `#B15CF7 → #B646DC → #E24AA0`, roughly top→bottom
(vector `(18,6)→(40,60)` in mark space).

**Text on colour:** use the darkest shade of that family, never black.

---

## 3. Typography

**Inter** everywhere. Wordmark 800; headings 600; body 400. Lowercase for the
wordmark and taglines; sentence case for UI. Tagline lockup: `build 2d worlds`
(uppercase, letter-spacing ~`0.42em`, muted violet).

---

## 4. Clear space & sizing

- **Clear space:** keep at least one pixel-square (≈ mark height ÷ 7) of empty
  space around the full lockup.
- **Min sizes:** mark ≥ 16px; full lockup ≥ 96px wide. Below 24px use the
  solid `icon-circle` / mono mark, not the gradient (gradient muddies small).
- **App icon:** mark at ~69% of the canvas, centred, on the `night→ink`
  rounded square (`rx` = 22% of size).

---

## 5. Do / Don't

**Do:** use `logo-mono-*` on busy or single-colour backgrounds · keep the cyan
accent pixel · pair the mark with the Inter wordmark.

**Don't:** recolour the moon outside the palette · rotate/stretch/skew the mark
· add drop shadows, glows, or outlines · put the gradient logo on a mid-tone
background where it loses contrast · use Title Case or ALL CAPS in the wordmark.

---

## 6. Asset index

| File | Size / viewBox | Use |
|------|----------------|-----|
| `icon.svg` | 64 | mark only, transparent — source for icons |
| `icon-mono.svg` | 64 | single-colour mark (`currentColor`) — print, watermark, small UI |
| `icon-circle.svg` | 64 | mark in a dark circular badge — favicon, avatar |
| `avatar-square.svg` | 64 | mark on a dark rounded square — social avatar |
| `logo-full.svg` | 258×72 | mark + wordmark, colour (dark text) — light backgrounds |
| `logo-mono-dark.svg` | 258×72 | all white — dark backgrounds, splash screen |
| `logo-mono-light.svg` | 258×72 | all ink — light backgrounds |
| `wordmark.svg` | ~150×64 | `nyx.js` text only, no mark |
| `github-header.svg` / `.png` | 1280×400 | repository README banner |
| `social-preview.svg` / `.png` | 1280×640 | GitHub repo social preview / `og:image` |

Rendered app/web assets (generated from these): `apps/editor/build/icon.png`
(app icon), `apps/editor/public/{favicon.svg,favicon-32.png,apple-touch-icon.png}`.

Regenerate rasters after editing any source SVG.

---

## 7. Mascot — Nyxi

**Nyxi** — a chibi astronaut companion (raster illustration, not covered by the
vectors above). Art lives in `branding/nyxi/`.

- **Committed:** optimized `.webp` (512px, ~35–45KB each) — use these in the
  app and docs.
- **Masters:** the 1024px `.png` originals (~1.6MB each) are gitignored
  (`branding/nyxi/*.png`) to keep the repo lean. Keep them locally / in an
  external store; re-run the WebP optimization if you re-export.
- **Note:** originals have a soft grey background (not transparent). For clean
  overlay on the dark UI, export transparent-background versions.

### Expressions → suggested states

| File | Moment |
|------|--------|
| `letscode` | project open / empty state |
| `compiling` | build or export running |
| `buildsuccess` | build/export succeeded |
| `crashed` | build/runtime error |
| `inspecting` | debugger / inspector |
| `hmm` | warnings / needs input |
| `takingabreak` | idle |
| `allgood`, `allset`, `goodjob`, `yes` | success / confirmations |

Keep her palette in the nyx range (violet suit accents, cyan visor glints).
