// Bootstrap: open the 3D app when the device can, otherwise the info view (the static guide in the HTML).
import './styles.css';
import './app/app.css';
import { PLACES, REGIONS, KINDS } from './data/places.js';
import PHOTOS from './data/photos.json';
import { project } from './geo.js';
import { initPlanner } from './planner.js';

const root = document.documentElement;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } } };

// ---------------------------------------------------------------------------
// Offline + install (service worker caches the shell, terrain and visited photos)
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator && !import.meta.env.DEV) addEventListener('load', () => {
  // Trusted Types is enforced: a named policy that allows exactly one script URL, the service worker.
  const SW = `${import.meta.env.BASE_URL}sw.js`;
  const tt = window.trustedTypes?.createPolicy?.('sw', { createScriptURL: (u) => { if (u !== SW) throw new TypeError('blocked'); return u; } });
  navigator.serviceWorker.register(tt ? tt.createScriptURL(SW) : SW).catch(() => {});
});

// ---------------------------------------------------------------------------
// Which mode?
// ---------------------------------------------------------------------------
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const conn = navigator.connection || {};
const weak = conn.saveData || /2g/.test(conn.effectiveType || '') || (navigator.deviceMemory && navigator.deviceMemory < 4);
const hasGL = (() => { try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; } })();
const choice = store.get('lite');
// an automatic fallback (3D failed to start, or the GPU reset) lasts for this visit only; a visitor's own choice is remembered
const session = { get: () => { try { return sessionStorage.getItem('lite-auto'); } catch { return null; } }, set: () => { try { sessionStorage.setItem('lite-auto', '1'); } catch {} } };
const forceLite = new URLSearchParams(location.search).has('lite'); // a shareable link to the plain page
const wantApp = !forceLite && hasGL && session.get() !== '1' && (choice === '0' || (choice === null && !weak && !reduced));
const lowPower = matchMedia('(max-width: 760px)').matches || (navigator.hardwareConcurrency || 8) <= 4;

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-app]')) {
    if (!hasGL) { alert('This browser has no WebGL 2, so the 3D app cannot run here.'); return; }
    store.set('lite', '0'); try { sessionStorage.removeItem('lite-auto'); } catch {} location.reload();
  }
});

if (wantApp) {
  import('./app/app.js').then((m) => m.boot({ lowPower, onFail: () => { session.set(); location.reload(); } }))
    .catch(() => guide());
} else guide();

// ---------------------------------------------------------------------------
// The info view: static guide + light enhancements (filters, place sheet, planner)
// ---------------------------------------------------------------------------
function guide() {
  root.classList.add('lite');
  pageMotion();
  $('#app')?.remove();
  const BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));
  const REGION = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (!hasGL) $$('[data-open-app]').forEach((b) => b.remove());

  // month
  const listeners = new Set();
  let month = Number(store.get('month')) || new Date().getMonth() + 1;
  const setMonth = (m) => { if (!(m >= 1 && m <= 12)) return; month = m; store.set('month', String(m)); listeners.forEach((f) => f(m)); };
  const onMonth = (f) => { listeners.add(f); f(month); };
  const seasonLine = (m) => {
    const good = PLACES.filter((p) => p.months.includes(m)).length;
    const coast = [12, 1, 2, 3].includes(m) ? 'South and west coasts are dry; the east has its monsoon.'
      : [5, 6, 7, 8, 9].includes(m) ? 'East coast and north are dry; the south-west has its monsoon.'
      : m === 4 ? 'Between monsoons: most of the island is good, with afternoon storms.' : 'Inter-monsoon: rain island-wide, quiet and green.';
    return `${coast} ${good} of ${PLACES.length} places are in season.`;
  };
  onMonth((m) => { $$('.dial-months button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.month === m))); $$('.dial-out').forEach((o) => { o.textContent = seasonLine(m); }); });
  document.addEventListener('click', (e) => { const b = e.target.closest('.dial-months button'); if (b) setMonth(+b.dataset.month); });

  let toastTimer;
  const toast = (msg) => { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); } t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200); };

  // place sheet
  const sheet = $('dialog.sheet');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function picture(id, sizes) {
    const p = PHOTOS[id]; if (!p) return null; const pic = el('picture', `pic c-${id}`);
    for (const [type, ext] of [['image/avif', 'avif'], ['image/webp', 'webp']]) { const s = el('source'); s.type = type; s.srcset = p.widths.map((w) => `${import.meta.env.BASE_URL}img/${p.file}-${w}.${ext} ${w}w`).join(', '); s.sizes = sizes; pic.append(s); }
    const img = el('img'); img.src = `${import.meta.env.BASE_URL}img/${p.file}-${p.widths.includes(1280) ? 1280 : p.widths.at(-1)}.jpg`; img.alt = BY_ID[id]?.name || ''; img.width = p.w; img.height = p.h; img.decoding = 'async'; pic.append(img); return pic;
  }
  let planner;
  function openPlace(id, push = true) {
    const p = BY_ID[id]; if (!p) return;
    sheet.replaceChildren();
    const close = el('button', 'link sheet-close', 'Close'); close.type = 'button'; close.addEventListener('click', () => sheet.close());
    const fig = el('figure', 'sheet-photo'); const pic = picture(id, '(max-width: 760px) 100vw, 760px');
    if (pic) { fig.append(pic); const ph = PHOTOS[id]; const a = el('a', null, `Full resolution (${ph.origW || ph.w} px) · ${ph.license}`); a.href = ph.page; a.target = '_blank'; a.rel = 'noopener noreferrer'; fig.append(a); }
    const body = el('div', 'sheet-body'); const hd = el('h2', null, p.name); hd.id = 'sheet-title';
    if (p.local) { const s = el('span', 'local', p.local); s.lang = 'si'; hd.append(s); }
    const meta = el('div', 'sheet-meta');
    meta.append(el('span', null, REGION[p.region].name), ...p.kinds.map((k) => el('span', null, KINDS[k])), el('span', null, p.months.includes(month) ? `In season in ${MONTHS[month - 1]}` : `Not ideal in ${MONTHS[month - 1]}`));
    const dl = el('dl');
    for (const [k, v] of [['The detail most miss', p.insider], ['Getting there', p.access], ['Time needed', p.hours >= 24 ? 'Stay at least a night' : `About ${p.hours} h`], ['Entry (approx.)', p.fee], ['Tip', p.tip]]) dl.append(el('dt', null, k), el('dd', null, v));
    const mini = el('div', 'sheet-mini'); const mimg = el('img'); mimg.src = `${import.meta.env.BASE_URL}terrain/relief.webp`; mimg.alt = `Map: ${p.name} on the island`; mini.append(mimg);
    const dot = el('i'); const { u, v } = project(p.lat, p.lon); dot.style.left = `${u * 100}%`; dot.style.top = `${v * 100}%`; mini.append(dot);
    const actions = el('div', 'sheet-actions'); const add = el('button', 'btn', 'Add to my route'); add.type = 'button';
    add.addEventListener('click', () => { planner?.addPlace(id); sheet.close(); });
    const maps = el('a', 'link', 'Open on OpenStreetMap'); maps.href = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=13/${p.lat}/${p.lon}`; maps.target = '_blank'; maps.rel = 'noopener noreferrer';
    actions.append(add, maps);
    body.append(hd, el('p', 'lead', p.summary), meta, dl, mini, el('p', 'note', 'Prices checked November 2026. Confirm at the gate; foreigner prices are set in US dollars and charged in rupees.'), actions);
    sheet.append(close, fig, body); if (!sheet.open) sheet.showModal(); sheet.scrollTop = 0;
    if (push) history.replaceState(null, '', `#place-${id}`);
  }
  sheet.addEventListener('close', () => { if (location.hash.startsWith('#place-')) history.replaceState(null, '', location.pathname); });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-place]'); if (a) { e.preventDefault(); openPlace(a.dataset.place); return; }
    const row = e.target.closest('.lineup tr[data-id]'); if (row && !e.target.closest('a')) openPlace(row.dataset.id);
  });

  // atlas filters
  const form = $('.filters');
  if (form) {
    const kinds = new Set(); const rows = $$('.lineup tr[data-id]'); const empty = $('.atlas-empty');
    form.addEventListener('submit', (e) => e.preventDefault());
    const apply = () => {
      const q = form.elements.q.value.trim().toLowerCase().slice(0, 40); const season = form.elements.season.checked; let shown = 0;
      for (const r of rows) {
        const p = BY_ID[r.dataset.id];
        const ok = (!kinds.size || p.kinds.some((k) => kinds.has(k))) && (!q || `${p.name} ${p.summary} ${p.insider} ${REGION[p.region].name} ${p.kinds.join(' ')}`.toLowerCase().includes(q)) && (!season || p.months.includes(month));
        r.hidden = !ok; r.classList.toggle('is-off', !p.months.includes(month)); if (ok) shown++;
      }
      $$('.lineup tbody').forEach((tb) => { tb.hidden = !tb.querySelector('tr[data-id]:not([hidden])'); }); empty.hidden = shown > 0;
    };
    form.addEventListener('input', apply);
    $$('.chip[data-kind]', form).forEach((b) => b.addEventListener('click', () => { const k = b.dataset.kind; kinds.has(k) ? kinds.delete(k) : kinds.add(k); b.setAttribute('aria-pressed', String(kinds.has(k))); apply(); }));
    onMonth(apply);
  }
  planner = initPlanner($('#plan'), { getMonth: () => month, setMonth, openPlace, toast });
  onMonth((m) => planner.syncMonth(m));
  if (location.hash.startsWith('#place-')) { const id = location.hash.slice(7); if (BY_ID[id]) requestAnimationFrame(() => openPlace(id, false)); }
}

// ---------------------------------------------------------------------------
// Motion on the plain page: each block rises in as it arrives (transform and opacity only, once). The plain page keeps
// its scenes flat and fast on purpose; with reduced motion nothing moves at all.
// ---------------------------------------------------------------------------
function pageMotion() {
  if (reduced) { root.classList.add('still'); return; }
  root.classList.add('moving');
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('.chapter-card, .chapter-photo, .atlas-head, .planner > *, .faq > *, .verbs > *, .triptych > *, .statement-text').forEach((el, i) => { el.classList.add('rise'); el.style.setProperty('--d', `${(i % 3) * 70}ms`); io.observe(el); });
  setTimeout(() => document.querySelectorAll('.rise:not(.in)').forEach((el) => el.classList.add('in')), 3500); // never leave content hidden
}
