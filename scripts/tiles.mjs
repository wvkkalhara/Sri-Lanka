// Bakes the whole island as a grid of sharp tiles the app streams around the camera.
// One tile = one Web Mercator z11 square (~19.5 km): Sentinel-2 cloudless (EOX, 4×4 z13 tiles = 1024 px, ≈19 m/px)
// and AWS Terrain Tiles (terrarium, 2×2 z12 tiles = 512 px, ≈38 m/px) with a 1 px border from the neighbours,
// so adjacent tiles meet without cracks. Only tiles that touch land are kept.
// Output: public/tiles/<x>_<y>.{webp,png} + public/tiles/index.json
import sharp from 'sharp'; import fs from 'node:fs/promises'; import path from 'node:path';
import meta from '../public/terrain/meta.json' with { type: 'json' };
const Z = 11;
const UA = { 'User-Agent': 'island-guide-builder/1.0 (static site build script)' };
const SRC = {
  sat: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${z}/${y}/${x}.jpg`,
  dem: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
};
const EXT = { sat: 'jpg', dem: 'png' };
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };
await fs.mkdir('raw/dtiles', { recursive: true }); await fs.mkdir('public/tiles', { recursive: true });

const once = new Map(); // workers share neighbour tiles: fetch each one once
const get = (kind, z, x, y) => { const k = `${kind}-${z}-${x}-${y}`; if (!once.has(k)) once.set(k, fetchTile(kind, z, x, y)); return once.get(k); };
async function fetchTile(kind, z, x, y) {
  const f = path.join('raw/dtiles', `${kind}-${z}-${x}-${y}.${EXT[kind]}`);
  try { await fs.access(f); await sharp(f).stats(); return f; } catch { await fs.rm(f, { force: true }); } // missing or corrupt → fetch again
  for (let a = 0; a < 5; a++) {
    try { const r = await fetch(SRC[kind](z, x, y), { headers: UA }); if (r.ok) { const buf = Buffer.from(await r.arrayBuffer()); await sharp(buf).stats(); await fs.writeFile(f, buf); return f; } if (r.status === 404) return null; } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
  }
  return null;
}
// mosaic of tiles [x0..x0+n) × [y0..y0+n) at zoom z, each 256 px
async function mosaic(kind, z, x0, y0, n) {
  const jobs = []; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) jobs.push(get(kind, z, x0 + i, y0 + j).then((f) => f && { input: f, left: i * 256, top: j * 256 }));
  const comps = (await Promise.all(jobs)).filter(Boolean);
  const bg = kind === 'dem' ? { r: 128, g: 0, b: 0 } : { r: 10, g: 39, b: 49 }; // sea level / deep water
  return sharp(await sharp({ create: { width: n * 256, height: n * 256, channels: 3, background: bg } }).composite(comps).removeAlpha().png().toBuffer());
}

const X0 = Math.floor(lon2x(meta.bounds.west, Z)), X1 = Math.floor(lon2x(meta.bounds.east, Z));
const Y0 = Math.floor(lat2y(meta.bounds.north, Z)), Y1 = Math.floor(lat2y(meta.bounds.south, Z));
const all = []; for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) all.push([x, y]);
const keep = []; let i = 0, n = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < all.length) {
    const [x, y] = all[i++]; const out = `public/tiles/${x}_${y}`;
    try { await fs.access(`${out}.webp`); keep.push(`${x}_${y}`); n++; continue; } catch {}
    // terrain: 4×4 z12 tiles around the 2×2 core, crop the core plus a 1 px border → 514×514
    const dem = await mosaic('dem', 12, 2 * x - 1, 2 * y - 1, 4);
    const crop = await dem.extract({ left: 255, top: 255, width: 514, height: 514 }).raw().toBuffer({ resolveWithObject: true });
    const px = crop.data; let land = 0;
    for (let k = 0; k < px.length; k += 3) if (px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768 > 2) land++;
    n++;
    if (land < 400) { console.log(`${n}/${all.length} ${x}_${y} sea`); continue; }
    await sharp(px, { raw: { width: 514, height: 514, channels: 3 } }).png({ compressionLevel: 9 }).toFile(`${out}.png`);
    const sat = await mosaic('sat', 13, 4 * x, 4 * y, 4);
    await sat.webp({ quality: 74 }).toFile(`${out}.webp`);
    keep.push(`${x}_${y}`); console.log(`${n}/${all.length} ${x}_${y} land`);
  }
}));
keep.sort();
await fs.writeFile('public/tiles/index.json', JSON.stringify({ z: Z, tiles: keep }));
console.log(`kept ${keep.length} tiles`);
