// Downloads the small previews and lays them out as contact sheets for picking by eye.
import fs from 'node:fs/promises'; import sharp from 'sharp';
const C = JSON.parse(await fs.readFile('raw/candidates.json', 'utf8'));
await fs.mkdir('raw/thumbs', { recursive: true }); await fs.mkdir('raw/sheets', { recursive: true });
const UA = { 'User-Agent': 'island-guide-builder/1.0 (static site build script)' };
const jobs = []; for (const [id, l] of Object.entries(C)) l.forEach((c, i) => jobs.push({ id, i, c }));
let n = 0; await Promise.all(Array.from({ length: 3 }, async () => { while (n < jobs.length) { const j = jobs[n++]; const f = `raw/thumbs/${j.id}-${j.i}.jpg`;
  try { await fs.access(f); } catch { for (let a = 0; a < 3; a++) { try { const r = await fetch(j.c.thumb, { headers: UA }); if (r.ok) { await fs.writeFile(f, Buffer.from(await r.arrayBuffer())); break; } } catch {} await new Promise((r) => setTimeout(r, 1500)); } } } }));
const ids = Object.keys(C).filter((k) => C[k].length); const per = 10; const TW = 260, TH = 160, LW = 130;
for (let s = 0; s * per < ids.length; s++) {
  const chunk = ids.slice(s * per, s * per + per); const comps = [];
  for (const [r, id] of chunk.entries()) {
    comps.push({ input: Buffer.from(`<svg width="${LW}" height="${TH}"><text x="4" y="30" font-size="18" font-family="Arial">${id}</text></svg>`), left: 0, top: r * TH });
    for (let i = 0; i < C[id].length; i++) { try { comps.push({ input: await sharp(`raw/thumbs/${id}-${i}.jpg`).resize(TW - 6, TH - 6, { fit: 'cover' }).toBuffer(), left: LW + i * TW, top: r * TH });
      comps.push({ input: Buffer.from(`<svg width="30" height="26"><rect width="30" height="26" fill="#000"/><text x="8" y="19" fill="#fff" font-size="18" font-family="Arial">${i}</text></svg>`), left: LW + i * TW, top: r * TH }); } catch {} }
  }
  await sharp({ create: { width: LW + 6 * TW, height: chunk.length * TH, channels: 3, background: '#fff' } }).composite(comps).jpeg({ quality: 70 }).toFile(`raw/sheets/sheet-${s}.jpg`);
}
console.log('sheets', Math.ceil(ids.length / per));
