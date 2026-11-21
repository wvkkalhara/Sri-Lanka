# Sri Lanka — the island, flown over

An immersive, fast, secure guide to every beautiful place in Sri Lanka, for tech-minded foreign travellers.

## The idea
On this site, **the island's real terrain** (open elevation data, 2,508 m at Pidurutalagala down to the ocean
trench) becomes **the pinned poster**: it holds the screen while the regions pass over it. The name is split to
the corners — SRI top-left, LANKA bottom-right — and the 3D island sits between them.

**The live thing:** a month dial. Pick your travel month and the island re-weathers itself — rain clouds sweep in
on the coast that has its monsoon, the places that are in season light up, and the trip planner re-routes.

## Research summary (Nov 2026)
- Award-level 3D sites in 2026 run on Three.js + GSAP ScrollTrigger + Lenis; immersive 3D is now the majority of
  Awwwards Sites of the Day. The difference between "demo" and "premium" is lighting, damping (lerp everything),
  restrained post-processing and strict performance budgets (DPR cap, render-on-demand, code-split 3D).
- Skills installed into `.claude/skills/`: `awwwards-3d` (MIT, Three.js/GSAP/Lenis patterns) and
  `awwwards-animations`. Design direction dealt by `design-taste-frontend` (pinned-poster, Archivo, cobalt on sand).
- Travel facts that change the advice right now:
  - Tourist ETA is **free for 40 nationalities since 25 May 2026**; apply only at eta.gov.lk (copycat sites charge).
  - Cyclone Ditwah (Nov 2025): **Nanu Oya–Badulla (Ella, Nine Arch) reopened June 2026**; Kandy–Nanu Oya still closed,
    expected 2027. Coastal line Colombo–Galle–Matara normal.
  - Emergency: Police 119, Ambulance 1990, Tourism hotline 1912.
  - Sigiriya US$35 (most reliable fee); others vary — the site always says "confirm at the gate".

## Architecture
- Vite, vanilla JS modules, no framework. All content rendered into static HTML at build time from
  `src/data/places.js` → works with JavaScript off, indexable, instant first paint.
- 3D (`three`) is code-split and only loaded when the device and the visitor want it.
- Real terrain: AWS Terrain Tiles (z9) → `public/terrain/height.png` + `relief.webp` fallback map.
- Photos: Wikimedia Commons, free licences only, credited per image; AVIF/WebP up to 3840 px (4K),
  link to the full-resolution original (often 6–8K) from every photo.
- Zero third-party requests at runtime: fonts, scripts, images, all self-hosted.

## Fallback ladder
1. No JavaScript → full static guide, every place, practical info.
2. "Just the info" switch (always visible) → no WebGL, no smooth scroll, no pins; remembered per visitor.
3. Auto-lite when: WebGL missing or context lost, `prefers-reduced-motion`, Save-Data, 2G/3G, < 4 GB device memory.
4. Skip button on the intro flight; nothing ever blocks reading.
5. Images: AVIF → WebP → JPEG, sized placeholders, colour background if all fail.

## Security
Strict CSP (`default-src 'self'`, no inline script, no eval, `object-src 'none'`, `frame-ancestors 'none'`),
Trusted Types, HSTS, nosniff, no-referrer, Permissions-Policy denying sensors. User input (planner, URL hash)
is validated against a whitelist of ids and rendered with `textContent` only. Plans are stored only in the
visitor's own browser.
