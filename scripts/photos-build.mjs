// Downloads the chosen photographs at up to 3840 px and encodes AVIF / WebP / JPEG at several widths.
// Writes src/data/photos.json (credits + sizes) and src/data/photos.css (placeholder colours, CSP-safe).
import fs from 'node:fs/promises'; import sharp from 'sharp';
const C = JSON.parse(await fs.readFile('raw/candidates.json', 'utf8'));
const PICKS = {
  sigiriya: 0, polonnaruwa: 0, anuradhapura: 2, pidurangala: 5, mihintale: 0, dambulla: 4, minneriya: 4, aukana: 0, yapahuwa: 4, ritigala: 3,
  kandy: 1, peradeniya: 3, hortonplains: 1, adamspeak: 1, ninearch: 4, ellarock: 5, nuwaraeliya: 1, meemure: 3, mulkirigala: 1, knuckles: 1,
  bambarakanda: 1, diyaluma: 1, liptons: 4, stclairs: 3, kitulgala: 1, sinharaja: 3, gartmore: 0, belihuloya: 2, ambuluwawa: 3,
  udawalawe: 2, galle: 0, yala: 2, mirissa: 3, unawatuna: 0, rekawa: 0, bundala: 3, kalpitiya: 1, hikkaduwa: 0, wilpattu: 4,
  colombo: 0, bentota: 2, koggala: 0, dondra: 0, arugambay: 3, kataragama: 0, trincomalee: 0, pigeonisland: 0, kumana: 3, pasikudah: 1,
  jaffna: 4, galoya: 3, pointpedro: 0, delft: 0, casuarina: 0, nainativu: 0, mannar: 1, tea: 1, train: 5, whale: 2, food: 5, perahera: 2,
  leopard: 0, elephant: ['minneriya', 0], surf: ['arugambay', 0],
  // added November 2026
  dalawella: 0, weligama: 3, tangalle: 2, hummanaya: 1, ussangoda: 1, kalametiya: 1, kanneliya: 3, sithulpawwa: 2, kirinda: 1,
  ramboda: 1, devon: 5, aberdeen: 0, dunhinda: 2, hakgala: 1, adisham: 2, dambatenne: 0, madulsima: 0, namunukula: 1, bopath: 0,
  sembuwatta: 5, riverston: 0, threetemples: 0, udawattakele: 0, namaluyana: 1, nalanda: 0, aluvihare: 5, hurulu: 1, marblebeach: 0,
  kanniya: 3, batticaloa: 2, kudumbigala: 1, muhudu: 3, lahugala: 1, keerimalai: 3, jaffnafort: 4, negombo: 1, kelaniya: 2, lotustower: 0,
};
const WIDTHS = [640, 1280, 1920, 2560, 3840];
const UA = { 'User-Agent': 'island-guide-builder/1.0 (static site build script)' };
await fs.mkdir('raw/full', { recursive: true }); await fs.mkdir('public/img', { recursive: true });
let manifest = {}; try { manifest = JSON.parse(await fs.readFile('src/data/photos.json', 'utf8')); } catch {}
const entries = Object.entries(PICKS); let n = 0;
async function one([id, pick]) {
  const [src, i] = Array.isArray(pick) ? pick : [id, pick];
  const c = C[src]?.[i]; if (!c) return console.log('missing', id);
  const f = `raw/full/${id}.jpg`;
  try { await fs.access(f); } catch {
    const url = c.w > 3840 ? c.thumb.replace(/\/\d+px-/, '/3840px-') : c.url;
    for (let a = 0; a < 5; a++) { try { const r = await fetch(url, { headers: UA }); if (r.ok) { await fs.writeFile(f, Buffer.from(await r.arrayBuffer())); break; } console.log(id, r.status); } catch (e) { console.log(id, e.message); } await new Promise((r) => setTimeout(r, 3000 * (a + 1))); }
  }
  const img = sharp(f).rotate(); const m = await img.metadata();
  const widths = WIDTHS.filter((w) => w <= m.width); if (!widths.length) widths.push(m.width);
  for (const w of widths) {
    const base = `public/img/${id}-${w}`;
    try { await fs.access(`${base}.webp`); await fs.access(`${base}.avif`); continue; } catch {}
    const r = sharp(f).rotate().resize({ width: w });
    await r.clone().avif({ quality: w > 2000 ? 45 : 52, effort: 1 }).toFile(`${base}.avif`);
    await r.clone().webp({ quality: 74 }).toFile(`${base}.webp`);
    if (w === 1280 || w === widths[widths.length - 1]) await r.clone().jpeg({ quality: 78, mozjpeg: true }).toFile(`${base}.jpg`);
  }
  const { dominant } = await sharp(f).stats(); const hex = '#' + [dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const h = Math.round((m.height / m.width) * widths[widths.length - 1]);
  manifest[id] = { file: id, widths, w: widths[widths.length - 1], h, color: hex, title: c.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), artist: c.artist, license: c.license, licenseUrl: c.licenseUrl, page: c.page, url: c.url, origW: c.w, origH: c.h };
  console.log('ok', id, widths.at(-1));
  await fs.writeFile('src/data/photos.json', JSON.stringify(manifest, null, 1));
}
await Promise.all(Array.from({ length: 4 }, async () => { while (n < entries.length) await one(entries[n++]); }));
await fs.writeFile('src/data/photos.json', JSON.stringify(manifest, null, 1));
await fs.writeFile('src/data/photos.css', Object.entries(manifest).map(([id, p]) => `.c-${id}{--c:${p.color}}`).join('\n') + '\n');
