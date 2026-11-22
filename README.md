# Sri Lanka 3D: the island field guide

An installable 3D web app: real terrain draped with Sentinel-2 satellite imagery, 101 places, a route planner that
draws and flies your trip in 3D, a guided tour, search (`/` or Ctrl K), live lat/lon/elevation readout, "near me",
offline support. Devices that can't (or visitors who prefer not to) get the **info view**: the same content as a
fast, plain page, which is also what search engines and no-JavaScript visitors see.

> **Licence note:** this is a free, non-commercial site (decided November 2026). That matters for two sources:
> the satellite layer, *Sentinel-2 cloudless 2024 by EOX*, is **CC BY-NC-SA 4.0** (credit it, no commercial use, and
> the tiles derived from it in `public/tiles/` stay under the same licence), and the free Open-Meteo weather API is
> for non-commercial use (CC BY 4.0 data). Both are credited on the Info page. If the site ever earns money (ads,
> bookings, paid plans), license the imagery from EOX (or switch the default style to "relief", open data only) and
> move to an Open-Meteo paid plan first.
See [PLAN.md](PLAN.md) for the research and the design idea.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm run preview    # serve the production build on :4173
```

Data scripts (already run; re-run only to refresh):

```bash
npm run terrain        # real elevation → public/terrain/{height.png, relief.webp, meta.json}
npm run tiles          # sharp satellite + terrain tile grid → public/tiles/
npm run photos:find    # search Wikimedia Commons → raw/candidates.json
node scripts/contact.mjs   # contact sheets in raw/sheets/ for picking by eye
npm run photos:build   # chosen photos → public/img (AVIF/WebP/JPEG up to 3840 px) + credits
npm run roads          # real road times between all places (OSRM / OpenStreetMap) → src/data/roads.json
npm run viewpoints     # where each photo was taken (Wikimedia Commons camera locations) → src/data/viewpoints.json
```

## Deploy

The site is a static `dist/` folder. `netlify.toml` is ready for Netlify (connect the repository, it builds itself);
Cloudflare Pages works the same way (build `npm run build`, output `dist`). Both read the security headers from
`public/_headers`. Set `VITE_ARCGIS_KEY` in the host's environment variables for the close-up aerial imagery.
**GitHub Pages:** `.github/workflows/pages.yml` builds the site for `https://<user>.github.io/<repository>/` and
publishes it on every push to `main`. One-time setup: Settings → Pages → Source: **GitHub Actions** (not "Deploy from a
branch", which would publish the unbuilt source). GitHub Pages cannot send the `_headers` security headers; the
Content-Security-Policy still applies through the meta tag. For a custom domain, set `BASE_PATH` to `/` in the workflow.

`.github/workflows/build.yml` builds every push on GitHub and fails if the build or the security headers break.

## What is where

| File | What it does |
| --- | --- |
| `src/data/places.js` | Every place: coordinates, seasons, fees, insider detail, access, tips. Edit content here. |
| `src/data/content.js` | The practical answers (visa, cyclone status, emergency numbers). |
| `src/render.js` | Build-time renderer: writes all content into `index.html` as static HTML. |
| `src/app/world.js` | 3D engine: satellite terrain, water sheen, sky, monsoon clouds, the real sun for any month and hour (time-of-day slider, `[` `]` keys, `L` or the Live button to follow the clock in Sri Lanka), sub-metre Esri aerial imagery streamed for close-ups (needs `VITE_ARCGIS_KEY`, see `.env.example`; Sentinel-2 is always the fallback), a dense close-up terrain patch (~23 m mesh from SRTM 30 m, streamed from AWS Terrain Tiles; falls back to the local 38 m heights), relief that eases from 3.5× height on the island view to ~1.7× up close, pins, street-level "Walk here" photos from Mapillary (lazy-loaded viewer; needs `VITE_MAPILLARY_TOKEN`; its one `new Function` is replaced at build time so the strict CSP stays intact), routes, map controls, camera flights. |
| `src/app/app.js` | The app: live weather with the Live button, printable itinerary (Print / PDF), "Photo spot" flights to where each photo was taken, router (`#/explore`, `#/place/<id>`, `#/trip`, `#/tour`, `#/info`), panels, search, tour, HUD, bottom sheet. |
| `src/app/app.css` | Green design system for the app. |
| `public/sw.js`, `public/manifest.webmanifest` | Offline + install. |
| `scripts/satellite.mjs` | Downloads and stitches the island-wide satellite imagery (≈150 m/px). |
| `scripts/tiles.mjs` | Bakes the whole island as a grid of sharp tiles (one Web Mercator z11 square, ~19.5 km): satellite ≈19 m/px + terrain ≈38 m/px → `public/tiles/`. The app streams the ones around wherever the camera looks once you zoom in, fades them in, and blends them into the island so the edge of the sharp area never shows. Cached offline. |
| `src/planner.js` | Route planner, presets, share links, real road times (`src/data/roads.json`), train suggestions (Kandy–Nanu Oya left out until it reopens), season warnings. |
| `src/main.js` | Chooses app or info view; the info view's filters, place sheet and planner. |

## Fallbacks

- **No JavaScript:** every place, region and answer is in the HTML.
- **"Just the info" button** (top right, remembered): no 3D, no smooth scroll, no pinned scenes.
- **Automatic info view** when WebGL is missing, the visitor prefers reduced motion, Save-Data is on, the
  connection is 2G, or the device has under 4 GB of memory. The WebGL context dying mid-visit also switches over.
- **Skip intro** button on the opening flight; scrolling also skips it.
- 3D quality drops itself (pixel ratio) on slow frames; rendering stops when the island is off screen or the tab is hidden.

## Security

- Everything the site needs is self-hosted (fonts, scripts, images, terrain). Three optional streams: Esri aerial imagery and AWS Terrain
  Tiles (SRTM heights) when you zoom in close, and Open-Meteo weather while Live is on, plus Mapillary street photos when a visitor taps Walk here. All are cookie-less CORS fetches allowed by
  name in the CSP, are skipped on Save-Data/2G, time out, switch themselves off after repeated failures, and fall back
  to the self-hosted data.
- Strict Content-Security-Policy (meta tag + `public/_headers` for Netlify / Cloudflare Pages):
  `default-src 'self'`, no inline script or style, no `eval`, Trusted Types, `object-src 'none'`, `frame-ancestors 'none'`.
- HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a Permissions-Policy that denies sensors,
  COOP/CORP same-origin.
- Visitor input (search, planner, `#plan=` / `#place-` links) is validated against the list of place ids and rendered
  with `textContent` only. Plans live in the visitor's own browser; share links hold place ids and a month, nothing else.
- No cookies, no analytics, no tracking.

On a host without `_headers` support, set the same headers in its config (Vercel: `vercel.json` headers).

## Credits

Photographs: Wikimedia Commons contributors, free licences, each credited on the page (Photographs and data) and
linked to its original (full resolution, often 4000–8000 px). Terrain: AWS Terrain Tiles (Mapzen / Tilezen), open data.
Typeface: Archivo (SIL Open Font License). Facts checked November 2026; fees and timetables change.
