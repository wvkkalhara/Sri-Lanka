// Downloads Sentinel-2 cloudless (EOX, CC BY-NC-SA 4.0) tiles for the island at z10, stitches and crops them
// to exactly the terrain bounds, so the 3D mesh can use the same UVs for colour and height.
import sharp from 'sharp'; import fs from 'node:fs/promises'; import path from 'node:path';
const meta = JSON.parse(await fs.readFile('public/terrain/meta.json', 'utf8'));
const B = meta.bounds, Z = 10, LAYER = 's2cloudless-2024_3857';
const lon2x = (lon) => ((lon + 180) / 360) * 2 ** Z;
const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z; };
const x0 = Math.floor(lon2x(B.west)), x1 = Math.floor(lon2x(B.east)), y0 = Math.floor(lat2y(B.north)), y1 = Math.floor(lat2y(B.south));
const dir = 'raw/sat'; await fs.mkdir(dir, { recursive: true });
const jobs = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push({ x, y });
let i = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (i < jobs.length) { const { x, y } = jobs[i++]; const f = path.join(dir, `${Z}-${x}-${y}.jpg`);
  try { await fs.access(f); continue; } catch {}
  for (let a = 0; a < 4; a++) { try { const r = await fetch(`https://tiles.maps.eox.at/wmts/1.0.0/${LAYER}/default/g/${Z}/${y}/${x}.jpg`, { headers: { 'User-Agent': 'island-guide-builder/1.0' } }); if (r.ok) { await fs.writeFile(f, Buffer.from(await r.arrayBuffer())); break; } } catch {} await new Promise((r) => setTimeout(r, 1500)); } } }));
const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
const comps = jobs.map(({ x, y }) => ({ input: path.join(dir, `${Z}-${x}-${y}.jpg`), left: (x - x0) * 256, top: (y - y0) * 256 }));
const mosaic = await sharp({ create: { width: W, height: H, channels: 3, background: '#0b2a4a' } }).composite(comps).png().toBuffer();
const cx0 = Math.round((lon2x(B.west) - x0) * 256), cy0 = Math.round((lat2y(B.north) - y0) * 256);
const w = Math.round((lon2x(B.east) - x0) * 256) - cx0, h = Math.round((lat2y(B.south) - y0) * 256) - cy0;
const crop = sharp(mosaic).extract({ left: cx0, top: cy0, width: w, height: h });
await crop.clone().webp({ quality: 82 }).toFile('public/terrain/satellite.webp');
await crop.clone().resize({ width: Math.round(w / 2) }).webp({ quality: 80 }).toFile('public/terrain/satellite-sm.webp');
console.log('satellite', w, h, jobs.length, 'tiles');
