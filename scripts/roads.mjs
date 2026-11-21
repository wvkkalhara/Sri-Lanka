// Real road times between every place (and the airport and region centres) for the trip planner, from one OSRM
// table request (router.project-osrm.org, OpenStreetMap data). Run only to refresh: npm run roads.
// OSRM's car speeds assume posted limits; Sri Lankan roads (buses, tuk-tuks, towns, hairpins) are slower, so the
// times are scaled by SLOW and given a fixed start-and-park overhead. Output: src/data/roads.json
import fs from 'node:fs/promises';
import { PLACES, REGIONS } from '../src/data/places.js';
const SLOW = 1.25, OVERHEAD = 0.15;
const pts = [{ id: 'airport', lat: 7.1808, lon: 79.8841 }, ...PLACES.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon })), ...REGIONS.map((r) => ({ id: `region:${r.id}`, lat: r.lat, lon: r.lon }))];
// the public server answers at most 100 points per request: ask block by block (sources × destinations)
const B = 36, blocks = []; for (let i = 0; i < pts.length; i += B) blocks.push([...pts.keys()].slice(i, i + B));
const sec = pts.map(() => pts.map(() => null));
for (const A of blocks) for (const D of blocks) {
  const idx = [...new Set([...A, ...D])], pos = new Map(idx.map((p, k) => [p, k]));
  const url = `https://router.project-osrm.org/table/v1/driving/${idx.map((i) => `${pts[i].lon},${pts[i].lat}`).join(';')}?annotations=duration&sources=${A.map((i) => pos.get(i)).join(';')}&destinations=${D.map((i) => pos.get(i)).join(';')}`;
  let j; for (let t = 0; t < 4; t++) { try { const r = await fetch(url, { headers: { 'User-Agent': 'island-guide-builder/1.0 (static site build script)' } }); j = await r.json(); if (j.code === 'Ok') break; } catch {} await new Promise((r) => setTimeout(r, 3000)); }
  if (j?.code !== 'Ok') throw new Error(`OSRM ${j?.code}`);
  A.forEach((a, x) => D.forEach((d, y) => { sec[a][d] = j.durations[x][y]; }));
  await new Promise((r) => setTimeout(r, 1200)); // be gentle with the free demo server
}
const h = sec.map((row) => row.map((s) => (s == null ? null : Math.round((s / 3600 * SLOW + OVERHEAD) * 20) / 20)));
await fs.writeFile('src/data/roads.json', JSON.stringify({ source: 'OSRM / OpenStreetMap contributors', built: new Date().toISOString().slice(0, 10), ids: pts.map((p) => p.id), h }));
console.log(`${pts.length} points, ${h.flat().filter((x) => x == null).length} unreachable pairs`);
