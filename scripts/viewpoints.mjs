// Where each place's photo was taken: the camera location (and heading, when recorded) from its Wikimedia Commons
// file page. Run to refresh: npm run viewpoints. Output: src/data/viewpoints.json { placeId: { lat, lon, heading? } }.
// Only kept when the camera is within 15 km of the place (a wrong or default location is worse than none).
import fs from 'node:fs/promises';
import PHOTOS from '../src/data/photos.json' with { type: 'json' };
import { PLACES } from '../src/data/places.js';
const UA = { 'User-Agent': 'island-guide-builder/1.0 (static site build script)' };
const hav = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
const out = {}; const ids = PLACES.map((p) => p.id).filter((id) => PHOTOS[id]?.page);
for (let i = 0; i < ids.length; i += 40) {
  const batch = ids.slice(i, i + 40), titles = batch.map((id) => decodeURIComponent(PHOTOS[id].page.split('/wiki/')[1]).replace(/_/g, ' '));
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=coordinates&coprop=type|name|dim|globe&coprimary=all&colimit=max&titles=${encodeURIComponent(titles.join('|'))}`;
  const j = await (await fetch(url, { headers: UA })).json();
  const norm = Object.fromEntries((j.query.normalized || []).map((n) => [n.from, n.to]));
  const byTitle = Object.fromEntries(Object.values(j.query.pages).map((p) => [p.title, p]));
  batch.forEach((id, k) => {
    const pg = byTitle[norm[titles[k]] || titles[k]]; const cs = pg?.coordinates || [];
    const cam = cs.find((c) => c.type === 'camera') || cs[0]; if (!cam) return;
    const place = PLACES.find((p) => p.id === id); const d = hav(place.lat, place.lon, cam.lat, cam.lon);
    if (d > 15 || d < 0.05) return;
    out[id] = { lat: +cam.lat.toFixed(5), lon: +cam.lon.toFixed(5), km: +d.toFixed(2) };
  });
  // headings live in the file description's {{Location}} template
  const rv = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(titles.join('|'))}`, { headers: UA })).json();
  for (const p of Object.values(rv.query.pages)) {
    const txt = p.revisions?.[0]?.slots?.main?.['*'] || ''; const m = txt.match(/heading:(-?\d+(\.\d+)?)/);
    const k = titles.findIndex((t) => (norm[t] || t) === p.title); const id = batch[k];
    if (m && out[id]) out[id].heading = +m[1];
  }
}
await fs.writeFile('src/data/viewpoints.json', JSON.stringify(out, null, 0));
console.log(`${Object.keys(out).length} of ${ids.length} photos have a usable camera location`);
