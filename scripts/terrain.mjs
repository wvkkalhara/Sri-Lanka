// Fetches open AWS Terrain Tiles (Terrarium encoding, public dataset) for Sri Lanka,
// stitches them, crops to the island's bounds and writes:
//  public/terrain/height.png  – 8-bit heightmap (land 0..2524 m mapped to 1..255, sea = 0..)
//  public/terrain/meta.json   – bounds + scale so the 3D scene and pins share one projection
//  public/terrain/relief.webp – a printed-map style hillshade used as the no-WebGL fallback
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const Z = 9;
const B = { west: 79.45, east: 82.05, south: 5.75, north: 9.98 };
const lon2x = (lon) => ((lon + 180) / 360) * 2 ** Z;
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z;
};
const x0 = Math.floor(lon2x(B.west)), x1 = Math.floor(lon2x(B.east));
const y0 = Math.floor(lat2y(B.north)), y1 = Math.floor(lat2y(B.south));
const cache = 'raw/terrain';
const tiles = [];
for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
  const f = path.join(cache, `${Z}-${x}-${y}.png`);
  try { await fs.access(f); } catch {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
    const r = await fetch(url, { headers: { 'User-Agent': 'terrain-builder/1.0' } });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    await fs.writeFile(f, Buffer.from(await r.arrayBuffer()));
  }
  tiles.push({ input: f, left: (x - x0) * 256, top: (y - y0) * 256 });
}
const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
const mosaic = await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
  .composite(tiles).removeAlpha().raw().toBuffer();
// crop window in mosaic pixels
const cx0 = Math.round((lon2x(B.west) - x0) * 256), cx1 = Math.round((lon2x(B.east) - x0) * 256);
const cy0 = Math.round((lat2y(B.north) - y0) * 256), cy1 = Math.round((lat2y(B.south) - y0) * 256);
const w = cx1 - cx0, h = cy1 - cy0;
const elev = new Float32Array(w * h);
let max = 0, min = 0;
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  const k = ((cy0 + j) * W + (cx0 + i)) * 3;
  const e = mosaic[k] * 256 + mosaic[k + 1] + mosaic[k + 2] / 256 - 32768;
  elev[j * w + i] = e; if (e > max) max = e; if (e < min) min = e;
}
// Heightmap: R = land height (0..max -> 0..255), G = sea depth (0..-3000 -> 0..255), B = land mask
const out = Buffer.alloc(w * h * 3);
for (let p = 0; p < w * h; p++) {
  const e = elev[p];
  out[p * 3] = e > 0 ? Math.max(1, Math.round((e / max) * 255)) : 0;
  out[p * 3 + 1] = e <= 0 ? Math.round(Math.sqrt(Math.min(1, -e / 3000)) * 255) : 0; // sqrt scale: more levels in the shallows
  out[p * 3 + 2] = e > 0 ? 255 : 0;
}
// The open bathymetry is coarse and blocky in places (Gulf of Mannar); blur the sea-depth channel only.
{
  const g = Buffer.alloc(w * h); for (let p = 0; p < w * h; p++) g[p] = out[p * 3 + 1];
  const gb = await sharp(g, { raw: { width: w, height: h, channels: 1 } }).blur(9).extractChannel(0).raw().toBuffer(); // keep it one channel (sharp would expand to RGB)
  for (let p = 0; p < w * h; p++) if (out[p * 3 + 2] === 0) out[p * 3 + 1] = Math.max(gb[p], out[p * 3 + 1] > 0 ? 1 : 0);
}
await fs.mkdir('public/terrain', { recursive: true });
await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 9 }).toFile('public/terrain/height.png');

// Printed-map relief in the palette: sand land shaded toward dark sand, cobalt 500 m contours and coast,
// cobalt sea darkening with depth. Same look as the 3D shader, used when WebGL is off.
const sand = [201, 214, 168], shadow = [58, 92, 60], cobalt = [11, 36, 24], sea = [16, 84, 82], deep = [5, 26, 22];
const rel = Buffer.alloc(w * h * 3);
const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
const mixc = (a, b, t) => a.map((v, k) => Math.round(v + (b[k] - v) * t));
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  const p = j * w + i, e = elev[p];
  const L = elev[j * w + Math.max(0, i - 1)], R = elev[j * w + Math.min(w - 1, i + 1)];
  const U = elev[Math.max(0, j - 1) * w + i], D = elev[Math.min(h - 1, j + 1) * w + i];
  let c;
  if (e <= 0) {
    c = mixc(sea, deep, Math.sqrt(Math.min(1, -e / 3000)));
  } else {
    const dx = (R - L) / 2 / 225, dy = (D - U) / 2 / 225;
    const slope = Math.atan(Math.hypot(dx, dy) * 1.6), aspect = Math.atan2(dy, -dx);
    let s2 = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect);
    s2 = Math.max(0, Math.min(1, s2));
    c = mixc(sand, shadow, Math.min(1, (1 - s2) * 1.3));
    const band = (v) => Math.floor(v / 500);
    if (band(e) !== band(R) || band(e) !== band(D)) c = mixc(c, cobalt, 0.65);
  }
  if ((e > 0) !== (R > 0) || (e > 0) !== (D > 0)) c = cobalt;
  rel.set(c, p * 3);
}
await sharp(rel, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 82 }).toFile('public/terrain/relief.webp');
await fs.writeFile('public/terrain/meta.json', JSON.stringify({ bounds: B, zoom: Z, width: w, height: h, maxElevation: Math.round(max), minElevation: Math.round(min), source: 'AWS Terrain Tiles (Mapzen/Tilezen terrarium), open data' }, null, 2));
await fs.copyFile('public/terrain/meta.json', 'src/data/terrain-meta.json');
console.log({ w, h, max, min });
