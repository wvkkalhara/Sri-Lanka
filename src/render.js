// Build-time renderer: turns the data into static, escaped HTML.
// Runs in Node inside the Vite plugin. Nothing here ships to the browser.
import { PLACES, REGIONS, KINDS } from './data/places.js';
import { VERBS, FAQ, STATS } from './data/content.js';
import PHOTOS from './data/photos.json';
import { project } from './geo.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const byId = Object.fromEntries(PLACES.map((p) => [p.id, p]));
const regionName = Object.fromEntries(REGIONS.map((r) => [r.id, r.name]));

export function monthRange(ms) {
  if (ms.length === 12) return 'All year';
  // compress into runs, wrapping December → January
  const set = new Set(ms), runs = [];
  let start = ms.find((m) => !set.has(((m + 10) % 12) + 1)) ?? ms[0];
  let m = start, run = [m], guard = 0;
  while (guard++ < 24) {
    const n = (m % 12) + 1;
    if (set.has(n) && n !== start) { run.push(n); m = n; continue; }
    runs.push(run);
    const next = ms.find((x) => !runs.flat().includes(x));
    if (next == null) break;
    start = next; m = next; run = [m];
  }
  return runs.map((r) => (r.length === 1 ? MONTHS[r[0] - 1] : `${MONTHS[r[0] - 1]}–${MONTHS[r[r.length - 1] - 1]}`)).join(', ');
}
const hoursLabel = (h) => (h >= 24 ? 'Stay a night' : h < 1 ? 'Under an hour' : `${h} h`);

export function pic(id, { sizes = '100vw', cls = '', eager = false, alt } = {}) {
  const p = PHOTOS[id];
  const a = esc(alt ?? p?.alt ?? byId[id]?.name ?? '');
  if (!p) return `<div class="ph ${cls}" role="img" aria-label="${a}"></div>`;
  const ws = p.widths;
  const set = (ext) => ws.map((w) => `${import.meta.env.BASE_URL}img/${p.file}-${w}.${ext} ${w}w`).join(', ');
  const fb = `${import.meta.env.BASE_URL}img/${p.file}-${ws.includes(1280) ? 1280 : ws[ws.length - 1]}.jpg`;
  return `<picture class="pic c-${id} ${cls}">` +
    `<source type="image/avif" srcset="${set('avif')}" sizes="${esc(sizes)}">` +
    `<source type="image/webp" srcset="${set('webp')}" sizes="${esc(sizes)}">` +
    `<img src="${fb}" alt="${a}" width="${p.w}" height="${p.h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}

function hero() {
  return `
<div class="stage" aria-hidden="true"><img class="relief" src="${import.meta.env.BASE_URL}terrain/relief.webp" alt="" width="946" height="1555"><div class="pins-layer"></div></div>
<h1 id="title" class="name"><span class="name-a">Sri</span> <span class="name-b">Lanka</span><span class="sr-only">: a 3D field guide to every beautiful place on the island</span></h1>
<section class="hero" id="top" aria-labelledby="title">
  <div class="hero-stage">
    <div class="hero-copy">
      <p class="lead">Every beautiful place on the island, flown over in real 3D terrain, with the season, the route and the price for each.</p>
      <div class="actions">
        <a class="btn" href="#plan">Plan a trip</a>
        <button class="link" type="button" data-open-app>Open the 3D app</button>
      </div>
      <ul class="hero-links">
        <li><a href="#places">All ${PLACES.length} places</a></li>
        <li><a href="#hidden">Hidden ones</a></li>
        <li><a href="#practical">Practical</a></li>
      </ul>
    </div>
    <figure class="hero-photo">${pic('sigiriya', { sizes: '(max-width: 760px) 100vw, 26vw', eager: true, alt: 'Sigiriya rock rising out of forest' })}</figure>
  </div>
</section>`;
}

function monthDial() {
  return `
<div class="dial" role="group" aria-labelledby="dial-label">
  <span id="dial-label" class="dial-label">Travelling in</span>
  <div class="dial-months">${MONTHS.map((m, i) => `<button type="button" data-month="${i + 1}" aria-pressed="false">${m}</button>`).join('')}</div>
  <output class="dial-out" aria-live="polite"></output>
</div>`;
}

function journey() {
  return `
<div class="journey" id="journey">
  <h2 class="sr-only">The island, region by region</h2>
  ${REGIONS.map((r, i) => {
    const places = PLACES.filter((p) => p.region === r.id);
    const lead = places.find((p) => PHOTOS[p.id]) || places[0];
    return `
  <section class="chapter" id="r-${r.id}" data-region="${r.id}" data-index="${i}" aria-labelledby="h-${r.id}">
    <div class="chapter-card">
      <h2 id="h-${r.id}">${esc(r.name)}</h2>
      <p>${esc(r.line)}</p>
      <ul class="chapter-places">${places.map((p) => `<li><a href="#place-${p.id}" data-place="${p.id}">${esc(p.name)}</a></li>`).join('')}</ul>
    </div>
    <figure class="chapter-photo">${pic(lead.id, { sizes: '(max-width: 760px) 100vw, 30vw' })}<figcaption>${esc(lead.name)}</figcaption></figure>
  </section>`;
  }).join('')}
</div>`;
}

function statement() {
  const ids = ['ninearch', 'mirissa', 'polonnaruwa'];
  return `
<section class="statement" aria-label="The island in one sentence">
  <div class="statement-pin"><p>${esc(STATS)}</p></div>
  ${ids.map((id, i) => `<figure class="statement-photo s${i + 1}">${pic(id, { sizes: '(max-width: 760px) 70vw, 38vw' })}</figure>`).join('')}
</section>`;
}

function hidden() {
  const list = PLACES.filter((p) => p.kinds.includes('hidden') && PHOTOS[p.id]).slice(0, 8);
  return `
<section class="hidden" id="hidden" aria-labelledby="h-hidden">
  <div class="hidden-stage">
    ${pic('knuckles', { cls: 'hidden-bg', sizes: '100vw', alt: '' })}
    <h2 id="h-hidden">The places locals keep</h2>
    <ol class="hidden-track">
      ${list.map((p, i) => `
      <li class="hcard">
        ${pic(p.id, { sizes: '(max-width: 760px) 100vw, 720px' })}
        <div class="hcard-text"><h3><a href="#place-${p.id}" data-place="${p.id}">${esc(p.name)}</a></h3><p>${esc(p.insider)}</p></div>
      </li>`).join('')}
    </ol>
  </div>
</section>`;
}

function atlas() {
  return `
<section class="atlas" id="places" aria-labelledby="h-places">
  <div class="atlas-head">
    <h2 id="h-places">All ${PLACES.length} places</h2>
    <p>Filter by what you love and the month you travel. Every row opens the full guide: why go, the detail most visitors miss, how to get there and what it costs.</p>
  </div>
  <form class="filters" aria-label="Filter places">
    <label class="search"><span class="sr-only">Search places</span><input type="search" name="q" placeholder="Search: waterfall, Jaffna, leopard…" autocomplete="off" maxlength="40"></label>
    <div class="chips" role="group" aria-label="Kind of place">
      ${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="false">${esc(v)}</button>`).join('')}
    </div>
    <label class="season-only"><input type="checkbox" name="season"> In season for my month</label>
  </form>
  <div class="atlas-body">
    <table class="lineup">
      <caption class="sr-only">Places in Sri Lanka</caption>
      <thead><tr><th scope="col">Place</th><th scope="col">Kind</th><th scope="col">Best months</th><th scope="col">Time</th></tr></thead>
      ${REGIONS.map((r) => `
      <tbody data-region="${r.id}">
        <tr class="day"><th colspan="4" scope="rowgroup">${esc(r.name)}</th></tr>
        ${PLACES.filter((p) => p.region === r.id).map((p) => `
        <tr id="place-${p.id}" data-id="${p.id}" data-kinds="${p.kinds.join(' ')}" data-months="${p.months.join(' ')}">
          <td><a href="#place-${p.id}" data-place="${p.id}">${esc(p.name)}</a>${p.kinds.includes('hidden') ? ' <span class="tag">hidden</span>' : ''}</td>
          <td>${esc(p.kinds.filter((k) => k !== 'hidden').map((k) => KINDS[k]).slice(0, 2).join(', '))}</td>
          <td>${monthRange(p.months)}</td>
          <td>${hoursLabel(p.hours)}</td>
        </tr>`).join('')}
      </tbody>`).join('')}
    </table>
    <p class="atlas-empty" hidden>No place matches. Clear a filter.</p>
  </div>
  <noscript>${PLACES.map(placeArticle).join('')}</noscript>
</section>`;
}

export function placeArticle(p) {
  return `
<article class="place" id="guide-${p.id}">
  ${pic(p.id, { sizes: '(max-width: 760px) 100vw, 60vw' })}
  <h3>${esc(p.name)}${p.local ? ` <span lang="si">${esc(p.local)}</span>` : ''}</h3>
  <p>${esc(p.summary)}</p>
  <dl>
    <dt>The detail most miss</dt><dd>${esc(p.insider)}</dd>
    <dt>Getting there</dt><dd>${esc(p.access)}</dd>
    <dt>Best months</dt><dd>${monthRange(p.months)}</dd>
    <dt>Entry</dt><dd>${esc(p.fee)}</dd>
    <dt>Tip</dt><dd>${esc(p.tip)}</dd>
  </dl>
</article>`;
}

function wildlife() {
  return `
<section class="triptych" aria-labelledby="h-wild">
  <div class="triptych-stage">
    <div class="triptych-head"><h2 id="h-wild">Leopard, whale and elephant in one week</h2><p>Yala, Mirissa and Udawalawe sit within three hours of each other on the south coast.</p></div>
    <div class="triptych-row">
      <figure class="tp tp-l">${pic('whale', { sizes: '360px' })}</figure>
      <figure class="tp tp-c">${pic('leopard', { sizes: '(max-width: 760px) 80vw, 760px' })}</figure>
      <figure class="tp tp-r">${pic('elephant', { sizes: '360px' })}</figure>
    </div>
  </div>
</section>`;
}

function verbs() {
  return `
<section class="verbs" id="practical" aria-label="How to travel the island">
  ${VERBS.map((v) => `
  <article class="verb">
    ${pic(v.photo, { cls: 'verb-bg', sizes: '100vw', alt: '' })}
    <h2 class="verb-word">${esc(v.verb)}</h2>
    <p class="verb-text">${esc(v.text)}</p>
  </article>`).join('')}
</section>`;
}

function planner() {
  return `
<section class="planner" id="plan" aria-labelledby="h-plan">
  <div class="planner-head">
    <h2 id="h-plan">Plan the route</h2>
    <p>Pick the days, the month and what you love. The planner chooses the coast in season, orders the stops into one loop from the airport and estimates every drive.</p>
  </div>
  <div class="planner-grid">
    <form class="planner-form" aria-label="Trip settings">
      <fieldset><legend>Ready-made trips</legend>
        <div class="presets">
          <button type="button" class="chip" data-preset="classic">7 days, the classics</button>
          <button type="button" class="chip" data-preset="full">14 days, the full island</button>
          <button type="button" class="chip" data-preset="east">10 days, east-coast summer</button>
          <button type="button" class="chip" data-preset="hidden">12 days, the hidden island</button>
        </div>
      </fieldset>
      <label class="field">Days <output name="daysOut">10</output><input type="range" name="days" min="3" max="21" value="10"></label>
      <label class="field">Month
        <select name="month">${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select>
      </label>
      <fieldset><legend>What you love</legend>
        <div class="chips">${['heritage', 'hike', 'water', 'wild', 'beach', 'town'].map((k) => `<label class="chip-check"><input type="checkbox" name="love" value="${k}" ${['heritage', 'wild', 'beach'].includes(k) ? 'checked' : ''}> ${esc(KINDS[k])}</label>`).join('')}</div>
      </fieldset>
      <fieldset><legend>Pace</legend>
        <div class="chips">${[['slow', 'Slow'], ['steady', 'Steady'], ['full', 'Full']].map(([v, l], i) => `<label class="chip-check"><input type="radio" name="pace" value="${v}" ${i === 1 ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      </fieldset>
      <label class="chip-check"><input type="checkbox" name="hidden"> Prefer hidden places</label>
      <div class="planner-actions">
        <button type="button" class="btn" data-plan-build>Build my route</button>
        <button type="button" class="link" data-plan-share>Copy link</button>
        <button type="button" class="link" data-plan-print>Print</button>
      </div>
    </form>
    <div class="planner-out">
      <div class="route-map" aria-hidden="true"><img src="${import.meta.env.BASE_URL}terrain/relief.webp" alt="" width="946" height="1555" loading="lazy"><svg viewBox="0 0 1000 1644" preserveAspectRatio="none"></svg></div>
      <ol class="itinerary" aria-live="polite"><li class="itinerary-empty">Choose your settings, then build the route. With JavaScript off, use the region list above: each region is a two to four day base.</li></ol>
    </div>
  </div>
</section>`;
}

function faq() {
  return `
<section class="faq" aria-labelledby="h-faq">
  <div class="qa"><h2 id="h-faq" class="q soft">Before you fly</h2><div></div></div>
  ${FAQ.map((f) => `<div class="qa"><h3 class="q">${esc(f.q)}</h3><p class="a">${esc(f.a)}</p></div>`).join('')}
</section>`;
}

function credits() {
  const rows = Object.entries(PHOTOS).map(([, p]) =>
    `<li><a href="${esc(p.page)}" rel="noopener noreferrer license" target="_blank">${esc(p.title)}</a> by ${esc(p.artist || 'unknown')}, ${p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" rel="noopener noreferrer license" target="_blank">${esc(p.license)}</a>` : esc(p.license)}</li>`).join('');
  return `
<section class="credits" id="credits" aria-labelledby="h-credits">
  <details><summary><h2 id="h-credits">Photographs and data</h2></summary>
  <p>Photographs from Wikimedia Commons under free licences, resized and compressed. Terrain from the open AWS Terrain Tiles dataset (Mapzen / Tilezen). Facts checked November 2026; prices and timetables change, so confirm at the gate.</p>
  <ul>${rows}</ul></details>
</section>`;
}

function footer() {
  return `
<footer class="foot">
  <span>A field guide to Sri Lanka</span>
  <nav aria-label="Footer"><a href="#places">Places</a><a href="#plan">Plan</a><a href="#practical">Practical</a><a href="#credits">Credits</a></nav>
  <span>2026 · No cookies, no tracking</span>
</footer>`;
}

export function renderBody() {
  return [`<div class="world">`, hero(), journey(), monthDial(), `</div>`, statement(), hidden(), atlas(), wildlife(), verbs(), planner(), faq(), credits(), footer()].join('\n');
}
export function renderDial() { return monthDial(); }

// Serialisable data for the client (no HTML).
export function clientData() {
  const photos = Object.fromEntries(Object.entries(PHOTOS).map(([id, p]) => [id, { file: p.file, widths: p.widths, w: p.w, h: p.h, color: p.color, page: p.page, original: p.url, artist: p.artist, license: p.license }]));
  return { photos, pins: PLACES.map((p) => ({ id: p.id, ...project(p.lat, p.lon) })) };
}
