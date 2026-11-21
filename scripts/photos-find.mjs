// Searches Wikimedia Commons for freely licensed, high-resolution photographs of each place.
// One relevance search per place (always scoped to Sri Lanka), ranked by Commons quality flags and size.
// Writes raw/candidates.json. Nothing is downloaded here except small previews for review.
import fs from 'node:fs/promises';
import { QUERIES } from './photo-queries.mjs';
const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'island-guide-builder/1.0 (static site build script)';
const OK = /^(cc0|public domain|cc by(-sa)? [1-4]\.0)/i;
const strip = (s = '') => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
async function search(q) {
  const u = new URL(API);
  Object.entries({ action: 'query', format: 'json', generator: 'search', gsrsearch: q, gsrnamespace: '6', gsrlimit: '30',
    prop: 'imageinfo|categories', clcategories: 'Category:Quality images|Category:Featured pictures on Wikimedia Commons|Category:Valued images sorted by promotion date',
    cllimit: 'max', iiprop: 'url|size|extmetadata|mime', iiurlwidth: '400' }).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let a = 0; a < 4; a++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (r.ok) return Object.values((await r.json()).query?.pages || {}); } catch {}
    await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
  }
  return [];
}
let prev = {}; try { prev = JSON.parse(await fs.readFile('raw/candidates.json', 'utf8')); } catch {}
const out = prev; const ids = Object.keys(QUERIES).filter((k) => !(prev[k]?.length)); let next = 0;
async function worker() {
  while (next < ids.length) {
    const id = ids[next++]; const q = QUERIES[id];
    const pages = await search(`${q} Sri Lanka`);
    const list = [];
    for (const p of pages) {
      const ii = p.imageinfo?.[0]; if (!ii || !/jpeg/.test(ii.mime)) continue;
      const m = ii.extmetadata || {}; const lic = strip(m.LicenseShortName?.value);
      if (!OK.test(lic) || ii.width < 2400 || ii.width < ii.height * 1.05) continue;
      const q = (p.categories || []).length;
      list.push({ title: p.title, w: ii.width, h: ii.height, thumb: ii.thumburl, url: ii.url, page: ii.descriptionurl, quality: q,
        license: lic, licenseUrl: m.LicenseUrl?.value || '', artist: strip(m.Artist?.value).slice(0, 80), score: q * 3 + Math.min(ii.width, 6000) / 2000 - p.index / 10 });
    }
    out[id] = list.sort((a, b) => b.score - a.score).slice(0, 6);
    process.stdout.write(`${id}:${out[id].length} `);
  }
}
await Promise.all(Array.from({ length: 1 }, worker));
await fs.writeFile('raw/candidates.json', JSON.stringify(out, null, 1));
