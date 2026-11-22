// The 3D app: a full-screen island you explore, with panels for places, trips, a guided tour and info.
// Every view is built with DOM APIs (no HTML strings), every id from the URL is checked against the data.
import { PLACES, REGIONS, KINDS } from '../data/places.js';
import { FAQ, VERBS } from '../data/content.js';
import PHOTOS from '../data/photos.json';
import VIEWPOINTS from '../data/viewpoints.json';
import { project, km, driveHours, AIRPORT, ASPECT } from '../geo.js';
import { buildPlan, warningsFor, PRESETS, enc, decodePlan, trainFor, trainText } from '../planner.js';

const BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));
const REGION = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } } };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => matchMedia('(max-width: 760px)').matches;

// ---------- tiny DOM builder ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
function picture(id, sizes, cls = '') {
  const p = PHOTOS[id]; if (!p) return h('div', { class: `ph ${cls}`, 'aria-hidden': 'true' });
  const set = (ext) => p.widths.map((w) => `${import.meta.env.BASE_URL}img/${p.file}-${w}.${ext} ${w}w`).join(', ');
  return h('picture', { class: `pic c-${id} ${cls}` },
    h('source', { type: 'image/avif', srcset: set('avif'), sizes }), h('source', { type: 'image/webp', srcset: set('webp'), sizes }),
    h('img', { src: `${import.meta.env.BASE_URL}img/${p.file}-${p.widths.includes(1280) ? 1280 : p.widths.at(-1)}.jpg`, alt: BY_ID[id]?.name || '', width: p.w, height: p.h, loading: 'lazy', decoding: 'async' }));
}
const thumb = (id, eager) => { const p = PHOTOS[id]; return p ? h('img', { class: 'thumb', src: `${import.meta.env.BASE_URL}img/${p.file}-640.webp`, alt: '', width: 640, height: Math.round(640 * p.h / p.w), loading: eager ? 'eager' : 'lazy', decoding: 'async' }) : h('span', { class: 'thumb ph' }); };
const fmtH = (x) => (x < 1 ? `${Math.max(10, Math.round(x * 6) * 10)} min` : `${x.toFixed(1)} h`);
const hoursLabel = (x) => (x >= 24 ? 'Stay a night' : x < 1 ? 'Under an hour' : `${x} h`);

// ---------- state ----------
const state = {
  month: Number(store.get('month')) || new Date().getMonth() + 1,
  kinds: new Set(), inSeason: false, q: '', sort: 'best',
  trip: (() => { const fromHash = location.hash.startsWith('#plan=') ? decodePlan(location.hash.slice(6)) : null; return fromHash || decodePlan(store.get('plan') || ''); })(),
  me: null, style: store.get('style') || 'satellite',
  hour: (() => { const h = Number(store.get('hour')); return h >= 5.5 && h <= 19 ? h : 15.5; })(),
};
if (state.trip?.m) state.month = state.trip.m;

let world = null, toastT;
function toast(msg) {
  let t = $('.app-toast'); if (!t) { t = h('div', { class: 'app-toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200);
}

// ---------- filtering ----------
function visiblePlaces() {
  const q = state.q.trim().toLowerCase();
  let list = PLACES.filter((p) => (!state.kinds.size || p.kinds.some((k) => state.kinds.has(k)))
    && (!state.inSeason || p.months.includes(state.month))
    && (!q || `${p.name} ${p.summary} ${p.insider} ${REGION[p.region].name} ${p.kinds.map((k) => KINDS[k]).join(' ')}`.toLowerCase().includes(q)));
  const center = world ? (() => { const t = world.controls.target; const g = { u: t.x / 10 + 0.5 }; return g; })() : null;
  if (state.sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.sort === 'me' && state.me) list.sort((a, b) => km(state.me, a) - km(state.me, b));
  else if (state.sort === 'view' && world) {
    const t = world.controls.target; const d = (p) => { const w = world.pinPos[p.id]; return (w.x - t.x) ** 2 + (w.z - t.z) ** 2; };
    list.sort((a, b) => d(a) - d(b));
  } else list.sort((a, b) => (b.months.includes(state.month) - a.months.includes(state.month)) || REGIONS.findIndex((r) => r.id === a.region) - REGIONS.findIndex((r) => r.id === b.region));
  void center;
  return list;
}
function syncWorldFilter() { if (!world) return; const v = visiblePlaces(); world.setFilter(v.length === PLACES.length ? null : new Set(v.map((p) => p.id))); }

// ---------- printable itinerary ----------
// A print-only sheet: the route on the relief map, then every day with what to know at each stop. Built from the same
// trusted place data with DOM text nodes; removed again after printing. "Save as PDF" in the dialog makes a PDF.
function printTrip(t) {
  $('.print-sheet')?.remove();
  const NS = 'http://www.w3.org/2000/svg', svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const stops = [AIRPORT, ...t.d.flat().map((id) => BY_ID[id]), AIRPORT], Wm = 600, Hm = Math.round(600 * ASPECT);
  const map = svg('svg', { viewBox: `0 0 ${Wm} ${Hm}`, class: 'print-map', role: 'img', 'aria-label': 'Route map' });
  map.append(svg('image', { href: `${import.meta.env.BASE_URL}terrain/relief.webp`, x: 0, y: 0, width: Wm, height: Hm, preserveAspectRatio: 'none' }));
  const xy = (p) => { const { u, v } = project(p.lat, p.lon); return [u * Wm, v * Hm]; };
  map.append(svg('path', { d: 'M' + stops.map((p) => xy(p).map((n) => n.toFixed(1)).join(' ')).join(' L'), class: 'route' }));
  let n = 0; const seen = new Set();
  stops.forEach((p) => { if (seen.has(p.id)) return; seen.add(p.id); const [x, y] = xy(p); map.append(svg('circle', { cx: x, cy: y, r: 7 }));
    const lab = svg('text', { x: x + 10, y: y + 4 }); lab.textContent = p.id === 'airport' ? 'Airport' : String(++n); map.append(lab); });
  let prev = AIRPORT; n = 0;
  const days = t.d.map((day, di) => {
    const from = prev, tr = trainFor(from, BY_ID[day[0]]);
    const dh = day.reduce((a, id) => { const x = driveHours(prev, BY_ID[id]); prev = BY_ID[id]; return a + x; }, 0);
    return h('section', { class: 'print-day' },
      h('h2', {}, `Day ${di + 2} · ${REGION[BY_ID[day[0]].region].name.replace(/^The /, '')}`),
      h('p', { class: 'muted' }, dh < 0.4 ? 'Short local hops.' : `About ${fmtH(dh)} on the road.`, tr ? ' ' + trainText(tr) : ''),
      ...day.map((id) => { const p = BY_ID[id]; n++;
        return h('article', {}, h('h3', {}, `${n}. ${p.name}`), h('p', {}, p.summary),
          h('dl', {}, p.hours ? [h('dt', {}, 'Time'), h('dd', {}, p.hours >= 24 ? 'A night or more' : `About ${p.hours} h`)] : null,
            p.fee ? [h('dt', {}, 'Entry'), h('dd', {}, p.fee)] : null, p.access ? [h('dt', {}, 'Getting there'), h('dd', {}, p.access)] : null,
            p.tip ? [h('dt', {}, 'Tip'), h('dd', {}, p.tip)] : null, p.insider ? [h('dt', {}, 'Insider'), h('dd', {}, p.insider)] : null)); }));
  });
  const sheet = h('div', { class: 'print-sheet' },
    h('header', {}, h('h1', {}, `Sri Lanka in ${MONTHS[t.m - 1]}: ${t.d.length + 2} days`),
      h('p', { class: 'muted' }, `${t.d.flat().length} stops. Times and fees are approximate and were checked in November 2026; confirm locally.`)),
    map, ...warningsFor(t.d, t.m).map((w) => h('p', { class: 'warn' }, w)),
    h('section', { class: 'print-day' }, h('h2', {}, 'Day 1 · Land in Colombo'), h('p', { class: 'muted' }, 'Driver or SIM at the airport.')),
    ...days,
    h('section', { class: 'print-day' }, h('h2', {}, `Day ${t.d.length + 2} · Back to the airport`), h('p', { class: 'muted' }, `About ${fmtH(driveHours(prev, AIRPORT))}.`)));
  document.body.append(sheet);
  const done = () => { sheet.remove(); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  // let the map image arrive before the dialog opens
  const img = new Image(); img.onload = img.onerror = () => window.print(); img.src = `${import.meta.env.BASE_URL}terrain/relief.webp`;
}

// ---------- month ----------
function seasonLine(m) {
  const n = PLACES.filter((p) => p.months.includes(m)).length;
  const coast = [12, 1, 2, 3].includes(m) ? 'South and west coasts dry, east in monsoon'
    : [5, 6, 7, 8, 9].includes(m) ? 'East coast and north dry, south-west in monsoon'
    : m === 4 ? 'Between monsoons, afternoon storms' : 'Inter-monsoon rain island-wide';
  return `${coast}. ${n} of ${PLACES.length} places in season.`;
}
// ---------- live weather ----------
// With Live on, the clouds follow today's real cover over each coast and the season line says what it is like right
// now. Open-Meteo (free, no key, no cookies), refreshed every 20 minutes; Save-Data, slow or failed requests, or a
// different month simply keep the monsoon climate for the month. Values are checked as numbers and shown as text only.
const WX_PTS = [['Colombo', 6.93, 79.85, 'sw'], ['Galle', 6.03, 80.22, 'sw'], ['Kandy', 7.29, 80.63, 'hill'], ['Nuwara Eliya', 6.95, 80.78, 'hill'],
  ['Trincomalee', 8.57, 81.23, 'ne'], ['Jaffna', 9.66, 80.02, 'ne'], ['Batticaloa', 7.72, 81.70, 'ne']];
const wxWord = (c) => (c >= 95 ? 'storms' : c >= 80 ? 'showers' : c >= 61 ? 'rain' : c >= 51 ? 'drizzle' : c >= 45 ? 'mist' : c >= 3 ? 'cloudy' : c >= 1 ? 'some cloud' : 'clear');
const wx = { data: null, at: 0, busy: false };
const lankaMonth = () => new Date(Date.now() + 5.5 * 3600e3).getUTCMonth() + 1;
async function refreshWeather() {
  if (wx.busy || (wx.data && Date.now() - wx.at < 20 * 60e3) || navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '')) { applyWeather(); return; }
  wx.busy = true; const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 6000);
  try {
    const q = (i) => WX_PTS.map((p) => p[i]).join(',');
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${q(1)}&longitude=${q(2)}&current=temperature_2m,cloud_cover,weather_code&timezone=Asia%2FColombo`,
      { signal: ac.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); const list = Array.isArray(j) ? j : [j];
    const rows = WX_PTS.map((p, i) => { const c = list[i]?.current || {}; return { name: p[0], side: p[3], t: +c.temperature_2m, cloud: +c.cloud_cover, code: +c.weather_code }; });
    if (rows.some((x) => !Number.isFinite(x.t) || !Number.isFinite(x.cloud) || !Number.isFinite(x.code))) throw new Error('bad weather data');
    wx.data = rows; wx.at = Date.now();
  } catch { wx.at = Date.now() - 15 * 60e3; } // try again in about five minutes
  finally { clearTimeout(timer); wx.busy = false; applyWeather(); }
}
function applyWeather() {
  const on = state.live && wx.data && state.month === lankaMonth();
  if (on) { // cloud cover per coast (0–1), and how stormy it is overall
    const side = (k) => { const r = wx.data.filter((x) => x.side === k); return r.reduce((a, x) => a + x.cloud + (x.code >= 61 ? 25 : 0), 0) / r.length / 100; };
    const clamp = (v) => Math.min(1, Math.max(0, v));
    world?.setLiveWeather([clamp(side('sw')), clamp(side('ne')), clamp(side('hill') * 0.8)]);
  } else world?.setLiveWeather(null);
  showSeason();
}
function showSeason() {
  const el = $('.season-line'); if (!el) return;
  if (state.live && wx.data && state.month === lankaMonth()) {
    const pick = ['Colombo', 'Kandy', 'Trincomalee'].map((n) => wx.data.find((x) => x.name === n));
    el.textContent = `Now: ${pick.map((x) => `${x.name} ${Math.round(x.t)}°, ${wxWord(x.code)}`).join(' · ')}.`;
    el.title = seasonLine(state.month);
  } else { el.textContent = seasonLine(state.month); el.title = ''; }
}

// on phones the month strip scrolls: keep the chosen month in the middle of it
function centreMonth(smooth = true) {
  const bar = $('.months'), b = $('.months [aria-pressed=true]'); if (!bar || !b || bar.scrollWidth <= bar.clientWidth) return;
  bar.scrollTo({ left: b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2, behavior: reduced || !smooth ? 'auto' : 'smooth' });
}
function setMonth(m) {
  if (!(m >= 1 && m <= 12)) return; state.month = m; store.set('month', String(m));
  $$('.months button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.month === m)));
  centreMonth();
  world?.setMonth(m); applyWeather(); syncWorldFilter();
  if (route.name === 'explore') renderExplore(true);
}

// ---------- time of day ----------
const clockText = (h) => { const m = Math.round((h % 1) * 60), hh = Math.floor(h); return `${((hh + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };
// the clock in Sri Lanka right now (UTC+5:30 all year, no daylight saving), as decimal hours
const lankaNow = () => { const d = new Date(Date.now() + 5.5 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60; };
let liveTimer = 0;
function setLive(on, keepHour) {
  state.live = on; store.set('live', on ? '1' : '');
  $('.daytime .live').setAttribute('aria-pressed', String(on));
  clearInterval(liveTimer);
  if (on) { if (state.month !== lankaMonth()) setMonth(lankaMonth()); liveTick(); liveTimer = setInterval(liveTick, 30e3); }
  else if (!keepHour) setHour(state.hour);
  applyWeather();
}
function liveTick() {
  if (!state.live || document.hidden) return;
  const now = lankaNow(), night = now < 5.5 || now > 19;
  // the scene has no night, so outside 5:30 am – 7 pm it holds the nearest edge: first light after midnight, blue hour before
  setHour(night ? (now < 5.5 ? 5.5 : 19) : now, { live: now, night });
  refreshWeather();
}
function setHour(h, live) {
  if (!live && state.live) setLive(false, true); // touching the slider, keys or search takes you off the live clock
  h = Math.min(19, Math.max(5.5, live ? h : Math.round(h * 4) / 4));
  state.hour = h; if (!live) store.set('hour', String(h));
  const input = $('.daytime input'), out = $('.daytime output');
  if (+input.value !== h) input.value = String(h);
  out.textContent = live?.night ? 'Night' : clockText(live ? live.live : h);
  world?.setHour(live ? Math.round(h * 12) / 12 : h); // live: the shadows rebake every 5 minutes, not every tick
  // the little sun takes the light's colour: white at noon, amber low down, gone pale blue after sunset
  const alt = world ? (world.sunAt(h).alt * 180) / Math.PI : 30;
  const dot = $('.sun-dot');
  dot.style.setProperty('--sun', alt > 20 ? '#fff3c4' : alt > 6 ? '#ffd27a' : alt > -1 ? '#ff9b5c' : '#9fb3e6');
  const phase = alt > 20 ? 'high sun' : alt > 6 ? 'golden hour' : alt > -1 ? (h < 12 ? 'sunrise' : 'sunset') : 'blue hour';
  $('.daytime').title = live?.night ? `Live: it is ${clockText(live.live)} and night in Sri Lanka, so the sky holds at ${h < 12 ? 'first light' : 'blue hour'}.`
    : live ? `Live: ${clockText(live.live)} in Sri Lanka right now, ${phase}. Move the slider to leave live.`
    : `${clockText(h)}: ${phase}. [ and ] keys step the time, L follows the clock in Sri Lanka.`;
}

// ---------- router ----------
const route = { name: 'explore', id: null };
function parse() {
  const hsh = location.hash;
  const m = hsh.match(/^#\/(explore|trip|tour|info)$/) || hsh.match(/^#\/(place)\/([a-z]+)$/);
  if (m && (m[1] !== 'place' || BY_ID[m[2]])) return { name: m[1], id: m[2] || null };
  const legacy = hsh.match(/^#place-([a-z]+)$/); if (legacy && BY_ID[legacy[1]]) return { name: 'place', id: legacy[1] };
  if (hsh.startsWith('#plan=')) return { name: 'trip', id: null };
  return { name: 'explore', id: null };
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
function render() {
  const r = parse(); const prev = route.name; Object.assign(route, r);
  if (prev === 'tour' && r.name !== 'tour') stopTour();
  $$('.tabs a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === (r.name === 'place' ? 'explore' : r.name))));
  const body = $('.panel-body');
  const swap = () => {
    if (r.name === 'place') renderPlace(r.id);
    else if (r.name === 'trip') renderTrip();
    else if (r.name === 'tour') renderTour();
    else if (r.name === 'info') renderInfo();
    else renderExplore();
    body.scrollTop = 0;
  };
  if (document.startViewTransition && !reduced && !document.hidden) {
    // a transition can be skipped (tab hidden, another one started); the panel still swaps, so the rejection is expected
    let done = false; const vt = document.startViewTransition(() => { done = true; swap(); });
    const quiet = () => {}; vt.ready.catch(quiet); vt.finished.catch(quiet); vt.updateCallbackDone.catch(quiet);
    setTimeout(() => { if (!done) vt.skipTransition(); }, 250); // no frame came (throttled window): swap without the animation
  } else swap();
  if (r.name !== 'place') world?.select(null);
  if (r.name !== 'trip') world?.setRoute(null);
}

// ---------- views ----------
function panel(...kids) { const b = $('.panel-body'); b.replaceChildren(...kids); }
function sheet(pos) { if (phone()) $('.panel').dataset.sheet = pos; }

function renderExplore(keepFocus) {
  const list = visiblePlaces();
  const inS = PLACES.filter((p) => p.months.includes(state.month)).length;
  const search = h('input', { type: 'search', class: 'field', placeholder: 'Filter: waterfall, Jaffna, leopard…', value: state.q, maxlength: 40, 'aria-label': 'Filter places',
    oninput: (e) => { state.q = e.target.value.slice(0, 40); syncWorldFilter(); renderList(); } });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Kind of place' },
    Object.entries(KINDS).map(([k, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.kinds.has(k)),
      onclick: (e) => { state.kinds.has(k) ? state.kinds.delete(k) : state.kinds.add(k); e.currentTarget.setAttribute('aria-pressed', String(state.kinds.has(k))); syncWorldFilter(); renderList(); } }, label)));
  const tools = h('div', { class: 'row' },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.inSeason || null, onchange: (e) => { state.inSeason = e.target.checked; syncWorldFilter(); renderList(); } }), `In season in ${MONTHS[state.month - 1]}`),
    h('select', { class: 'field small', 'aria-label': 'Sort', onchange: (e) => { state.sort = e.target.value; if (state.sort === 'me' && !state.me) nearMe(); else renderList(); } },
      [['best', 'Best for my month'], ['view', 'Nearest to the view'], ['az', 'A to Z'], ['me', 'Nearest to me']].map(([v, l]) => h('option', { value: v, selected: state.sort === v || null }, l))));
  const ul = h('ul', { class: 'cards' });
  function renderList() {
    const items = visiblePlaces();
    ul.replaceChildren(...items.map((p, n) => {
      const on = p.months.includes(state.month);
      return h('li', {}, h('a', { class: `card${on ? '' : ' off'}`, href: `#/place/${p.id}`,
        onpointerenter: () => world?.select(p.id), onpointerleave: () => route.name === 'explore' && world?.select(null),
        onfocus: () => world?.select(p.id) },
        thumb(p.id, n < 8),
        h('span', { class: 'card-text' },
          h('strong', {}, p.name),
          h('span', { class: 'meta' }, `${REGION[p.region].name.replace(/^The /, '')} · ${hoursLabel(p.hours)}${state.me ? ` · ${Math.round(km(state.me, p))} km` : ''}`),
          h('span', { class: 'badges' }, on ? h('span', { class: 'badge ok' }, 'In season') : h('span', { class: 'badge' }, 'Off season'), p.kinds.includes('hidden') ? h('span', { class: 'badge hid' }, 'Hidden') : null))));
    }));
    count.textContent = `${items.length} of ${PLACES.length} places · ${inS} in season in ${MONTHS[state.month - 1]}`;
  }
  const count = h('p', { class: 'muted' });
  panel(h('div', { class: 'view-head' }, h('h2', {}, 'Explore the island'), count), search, chips, tools,
    h('button', { type: 'button', class: 'link', onclick: nearMe }, state.me ? 'Update my location' : 'What is near me?'), ul);
  renderList();
  if (keepFocus) return;
  sheet('peek');
}

// Stand where the photo was taken: the camera position recorded on Wikimedia Commons, a little above the ground,
// looking along the recorded heading (or at the place when there is none).
function photoSpot(id) {
  const vp = VIEWPOINTS[id], p = BY_ID[id]; if (!vp || !world) return;
  const { u, v } = project(vp.lat, vp.lon), C = world.worldOf(u, v), P = world.pinPos[id].clone();
  C.y += 0.005; // ~150 m up, a drone's view of the photographer's spot
  let dir;
  if (vp.heading != null) { const a = (vp.heading * Math.PI) / 180; dir = C.clone().set(Math.sin(a), 0, -Math.cos(a)); }
  else dir = P.clone().sub(C).setY(0).normalize();
  const reach = Math.max(0.07, Math.min(0.6, Math.hypot(P.x - C.x, P.z - C.z)));
  const T = C.clone().addScaledVector(dir, reach);
  T.y = world.worldOf((T.x / 10) + 0.5, (T.z / (10 * ASPECT)) + 0.5).y;
  const off = C.clone().sub(T), r = off.length();
  world.flyTo({ target: T, distance: r, polar: Math.acos(Math.min(1, off.y / r)), azimuth: Math.atan2(off.x, off.z), duration: reduced ? 0.01 : 2.6 });
  toast(`Where the photo of ${p.name} was taken${vp.heading != null ? ', facing the way the camera did' : ''}.`);
}

function renderPlace(id) {
  const p = BY_ID[id]; const list = visiblePlaces(); const i = Math.max(0, list.findIndex((x) => x.id === id));
  const prev = list[(i - 1 + list.length) % list.length], next = list[(i + 1) % list.length];
  const inTrip = !!state.trip?.d.flat().includes(id);
  const ph = PHOTOS[id];
  const near = PLACES.filter((x) => x.id !== id).map((x) => ({ x, d: km(p, x) })).sort((a, b) => a.d - b.d).slice(0, 4);
  const onS = p.months.includes(state.month);
  panel(
    h('div', { class: 'row between' },
      h('a', { class: 'link', href: '#/explore' }, 'All places'),
      h('span', { class: 'row' },
        h('a', { class: 'icon-btn', href: `#/place/${prev.id}`, 'aria-label': `Previous: ${prev.name}`, title: 'Previous (←)' }, '←'),
        h('a', { class: 'icon-btn', href: `#/place/${next.id}`, 'aria-label': `Next: ${next.name}`, title: 'Next (→)' }, '→'))),
    h('figure', { class: 'place-photo' }, picture(id, '(max-width: 760px) 100vw, 460px'),
      ph ? h('a', { href: ph.page, target: '_blank', rel: 'noopener noreferrer', class: 'full' }, `Full resolution, ${ph.origW || ph.w} px`) : null),
    h('h2', { class: 'place-title' }, p.name, p.local ? h('span', { class: 'local', lang: 'si' }, p.local) : null),
    h('div', { class: 'badges' },
      h('span', { class: `badge${onS ? ' ok' : ''}` }, onS ? `In season in ${MONTHS[state.month - 1]}` : `Not ideal in ${MONTHS[state.month - 1]}`),
      h('span', { class: 'badge' }, REGION[p.region].name), ...p.kinds.map((k) => h('span', { class: 'badge' }, KINDS[k]))),
    h('p', { class: 'lead' }, p.summary),
    h('div', { class: 'insider' }, h('h3', {}, 'The detail most miss'), h('p', {}, p.insider)),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Getting there'), h('dd', {}, p.access),
      h('dt', {}, 'Time needed'), h('dd', {}, p.hours >= 24 ? 'Stay at least a night' : `About ${p.hours} h`),
      h('dt', {}, 'Entry, approx.'), h('dd', {}, p.fee),
      h('dt', {}, 'Tip'), h('dd', {}, p.tip),
      h('dt', {}, 'Coordinates'), h('dd', { class: 'num' }, `${p.lat.toFixed(4)}° N, ${p.lon.toFixed(4)}° E`)),
    h('div', { class: 'row wrap' },
      h('button', { type: 'button', class: 'btn', onclick: () => { toggleTrip(id); renderPlace(id); } }, inTrip ? 'Remove from my trip' : 'Add to my trip'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => orbit(id) }, 'Orbit in 3D'),
      VIEWPOINTS[id] ? h('button', { type: 'button', class: 'btn ghost', onclick: () => photoSpot(id), title: 'Fly to where the photographer stood' }, 'Photo spot') : null,
      h('a', { class: 'link', href: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=13/${p.lat}/${p.lon}`, target: '_blank', rel: 'noopener noreferrer' }, 'OpenStreetMap')),
    h('h3', { class: 'sub' }, 'Close by'),
    h('ul', { class: 'near' }, near.map(({ x, d }) => h('li', {}, h('a', { href: `#/place/${x.id}` }, h('span', {}, x.name), h('span', { class: 'muted num' }, `${Math.round(d)} km · ${fmtH(driveHours(p, x))}`))))),
    h('p', { class: 'muted small' }, 'Prices checked November 2026: confirm at the gate. Foreigner prices are set in US dollars and charged in rupees.'),
  );
  sheet('half');
  if (world) {
    world.select(id);
    // fly in while the sharp patch loads; then settle close and low over the real terrain
    const flight = world.flyTo({ target: world.pinPos[id], distance: 1.6, polar: 0.98, duration: reduced ? 0.01 : 2.4 });
    Promise.all([flight, world.loadDetail(id)]).then(([flew, ok]) => {
      if (flew && ok && route.name === 'place' && route.id === id) world.flyTo({ target: world.pinPos[id], distance: 0.95, polar: 1.02, duration: reduced ? 0.01 : 1.6 });
    });
  }
}

function orbit(id) {
  if (!world) return; const t = world.pinPos[id]; let a = 0; world.cancelFlight();
  const off = world.onFrame((dt) => { a += dt * 0.35; if (a > Math.PI * 2 || world.flying) return off();
    const r = 2.2, c = world.camera; c.position.set(t.x + Math.sin(a) * r * 0.7, t.y + 1.4, t.z + Math.cos(a) * r * 0.7); world.controls.target.copy(t); c.lookAt(t); });
  world.canvas.addEventListener('pointerdown', off, { once: true });
}

function toggleTrip(id) {
  if (!state.trip) state.trip = { m: state.month, d: [] };
  const d = state.trip.d; const where = d.findIndex((day) => day.includes(id));
  if (where >= 0) { d[where] = d[where].filter((x) => x !== id); state.trip.d = d.filter((x) => x.length); toast(`${BY_ID[id].name} removed from your trip.`); }
  else { const r = BY_ID[id].region; const k = d.findIndex((day) => day.some((x) => BY_ID[x].region === r)); if (k >= 0) d[k].push(id); else d.push([id]); toast(`${BY_ID[id].name} added to your trip.`); }
  saveTrip();
}
function saveTrip() { store.set('plan', state.trip?.d.length ? enc(state.trip.d, state.trip.m) : ''); $('.tabs [data-tab=trip]').dataset.count = state.trip?.d.flat().length || ''; }

function renderTrip() {
  const s = { days: Number(store.get('days')) || 10, loves: new Set((store.get('loves') || 'heritage,wild,beach').split(',').filter((k) => KINDS[k])), pace: store.get('pace') || 'steady', hidden: store.get('hidden') === '1' };
  const daysOut = h('output', {}, String(s.days));
  const form = h('div', { class: 'trip-form' },
    h('div', { class: 'chips' }, Object.entries({ classic: '7 days, the classics', full: '14 days, full island', east: '10 days, east-coast summer', hidden: '12 days, hidden island' })
      .map(([k, l]) => h('button', { type: 'button', class: 'chip', onclick: () => { const pr = PRESETS[k]; state.trip = { m: pr.month, d: pr.days.map((x) => x.slice()) }; setMonth(pr.month); saveTrip(); renderTrip(); } }, l))),
    h('label', { class: 'field-row' }, h('span', {}, 'Days ', daysOut), h('input', { type: 'range', min: 3, max: 21, value: s.days, oninput: (e) => { s.days = +e.target.value; daysOut.value = e.target.value; store.set('days', e.target.value); } })),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'What you love' }, ['heritage', 'hike', 'water', 'wild', 'beach', 'town'].map((k) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.loves.has(k)), onclick: (e) => { s.loves.has(k) ? s.loves.delete(k) : s.loves.add(k); e.currentTarget.setAttribute('aria-pressed', String(s.loves.has(k))); store.set('loves', [...s.loves].join(',')); } }, KINDS[k]))),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Pace' }, [['slow', 'Slow'], ['steady', 'Steady'], ['full', 'Full']].map(([v, l]) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(s.pace === v), onclick: (e) => { s.pace = v; store.set('pace', v); $$('[data-pace]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pace === v))); }, dataset: { pace: v } }, l))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.hidden || null, onchange: (e) => { s.hidden = e.target.checked; store.set('hidden', s.hidden ? '1' : '0'); } }), 'Prefer hidden places'),
    h('button', { type: 'button', class: 'btn', onclick: () => { if (!s.loves.size) s.loves.add('heritage'); state.trip = { m: state.month, d: buildPlan({ ...s, month: state.month }) }; saveTrip(); renderTrip(); } }, `Build a ${s.days}-day route for ${MONTHS[state.month - 1]}`));

  const out = [];
  const t = state.trip;
  if (t?.d.length) {
    const stops = [AIRPORT, ...t.d.flat().map((id) => BY_ID[id]), AIRPORT];
    let dist = 0, drive = 0; for (let i = 0; i < stops.length - 1; i++) { dist += km(stops[i], stops[i + 1]) * 1.4; drive += driveHours(stops[i], stops[i + 1]); }
    out.push(h('div', { class: 'stats' },
      h('div', {}, h('strong', {}, String(t.d.length + 2)), h('span', {}, 'days')),
      h('div', {}, h('strong', {}, String(t.d.flat().length)), h('span', {}, 'stops')),
      h('div', {}, h('strong', {}, `${Math.round(dist)}`), h('span', {}, 'km by road')),
      h('div', {}, h('strong', {}, `${Math.round(drive)}`), h('span', {}, 'hours driving'))));
    out.push(h('div', { class: 'row wrap' },
      h('button', { type: 'button', class: 'btn', onclick: () => flyRoute(stops) }, 'Fly the route'),
      h('button', { type: 'button', class: 'btn ghost', onclick: async () => { const url = `${location.origin}${location.pathname}#plan=${enc(t.d, t.m)}`; try { await navigator.clipboard.writeText(url); toast('Link copied. It holds only place names and the month.'); } catch { toast('Copy failed: your browser blocked the clipboard.'); } } }, 'Copy link'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => printTrip(t), title: 'Print, or choose "Save as PDF" in the print dialog' }, 'Print / PDF'),
      h('button', { type: 'button', class: 'link', onclick: () => { state.trip = null; saveTrip(); renderTrip(); } }, 'Clear')));
    for (const w of warningsFor(t.d, t.m)) out.push(h('p', { class: 'warn' }, w));
    let prev = AIRPORT;
    out.push(h('ol', { class: 'days' },
      h('li', {}, h('h3', {}, 'Day 1 · Land in Colombo'), h('p', { class: 'muted' }, `${MONTHS[t.m - 1]}. Driver or SIM at the airport, then on to ${REGION[BY_ID[t.d[0][0]].region].name.replace(/^The /, 'the ')}.`)),
      ...t.d.map((day, di) => {
        const from = prev, tr = trainFor(from, BY_ID[day[0]]);
        const dh = day.reduce((a, id) => { const x = driveHours(prev, BY_ID[id]); prev = BY_ID[id]; return a + x; }, 0);
        return h('li', {}, h('h3', {}, `Day ${di + 2} · ${REGION[BY_ID[day[0]].region].name.replace(/^The /, '')}`),
          h('p', { class: 'muted' }, dh < 0.4 ? 'Short local hops' : `About ${fmtH(dh)} on the road`),
          tr ? h('p', { class: 'muted small train' }, trainText(tr)) : null,
          h('ul', {}, day.map((id) => h('li', { class: 'row between' }, h('a', { href: `#/place/${id}` }, BY_ID[id].name),
            h('button', { type: 'button', class: 'link small', 'aria-label': `Remove ${BY_ID[id].name}`, onclick: () => { toggleTrip(id); renderTrip(); } }, 'Remove')))));
      }),
      h('li', {}, h('h3', {}, `Day ${t.d.length + 2} · Back to the airport`), h('p', { class: 'muted' }, `About ${fmtH(driveHours(prev, AIRPORT))}.`))));
    world?.setRoute(stops.map((p) => project(p.lat, p.lon)));
  } else world?.setRoute(null);

  panel(h('div', { class: 'view-head' }, h('h2', {}, 'Your trip'), h('p', { class: 'muted' }, 'Pick a ready-made trip or build one for your month. The route is drawn on the island and saved only in this browser.')),
    ...out, h('h3', { class: 'sub' }, t?.d.length ? 'Build a different one' : 'Build a route'), form);
  sheet('half');
  if (world && t?.d.length) world.home(1.8);
}

async function flyRoute(stops) {
  if (!world) return; const cap = $('.tour-cap'); cap.hidden = false;
  let cancelled = false; const stopIt = () => { cancelled = true; }; world.canvas.addEventListener('pointerdown', stopIt, { once: true });
  for (const s of stops) {
    if (cancelled) break;
    const p = project(s.lat, s.lon); const w = world.worldOf(p.u, p.v);
    caption(s.name, s.id && BY_ID[s.id] ? BY_ID[s.id].insider : 'Start and finish: Bandaranaike International Airport.', s.id && PHOTOS[s.id] ? s.id : null);
    if (s.id && BY_ID[s.id]) world.select(s.id);
    const ok = await world.flyTo({ target: w, distance: 3.2, polar: 0.95, duration: reduced ? 0.01 : 2.6 });
    if (!ok) break; await new Promise((r) => setTimeout(r, 1300));
  }
  cap.hidden = true; world.select(null); world.home(1.6);
}
function caption(title, text, photoId) {
  const cap = $('.tour-cap'); cap.replaceChildren(
    photoId ? picture(photoId, '320px', 'cap-photo') : h('span'),
    h('div', {}, h('p', { class: 'cap-title' }, title), h('p', {}, text)));
}

// ---------- tour ----------
let tour = null;
function renderTour() {
  let i = tour?.i ?? 0;
  const list = h('ol', { class: 'tour-list' }, REGIONS.map((r, k) => h('li', {}, h('button', { type: 'button', class: 'tour-item', 'aria-current': String(k === i), onclick: () => step(k) }, h('strong', {}, r.name), h('span', { class: 'muted' }, r.line)))));
  const playBtn = h('button', { type: 'button', class: 'btn', onclick: () => { tour.playing = !tour.playing; playBtn.textContent = tour.playing ? 'Pause' : 'Play'; if (tour.playing) schedule(); else clearTimeout(tour.t); } }, 'Pause');
  panel(h('div', { class: 'view-head' }, h('h2', {}, 'Island tour'), h('p', { class: 'muted' }, 'Eight regions, flown in order. Drag the map to take over at any time.')),
    h('div', { class: 'row wrap' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => step(i - 1) }, 'Back'), playBtn, h('button', { type: 'button', class: 'btn ghost', onclick: () => step(i + 1) }, 'Next'), h('a', { class: 'link', href: '#/explore' }, 'End tour')),
    list);
  sheet('peek');
  tour = { i, playing: true, t: 0 };
  function schedule() { clearTimeout(tour.t); tour.t = setTimeout(() => { if (tour?.playing) step(i + 1); }, 8000); }
  async function step(k) {
    i = (k + REGIONS.length) % REGIONS.length; tour.i = i;
    $$('.tour-item', list).forEach((b, n) => b.setAttribute('aria-current', String(n === i)));
    const r = REGIONS[i]; const lead = PLACES.find((p) => p.region === r.id && PHOTOS[p.id]);
    $('.tour-cap').hidden = false; caption(r.name, r.line, lead?.id);
    const { u, v } = project(r.lat, r.lon);
    if (world) await world.flyTo({ target: world.worldOf(u, v), distance: r.dist * 9, polar: r.tilt, azimuth: 0.25 + i * 0.35, duration: reduced ? 0.01 : 3.2 });
    if (tour?.playing) schedule();
  }
  world?.canvas.addEventListener('pointerdown', () => { if (tour) { tour.playing = false; clearTimeout(tour.t); playBtn.textContent = 'Play'; } }, { once: true });
  step(i);
}
function stopTour() { if (tour) clearTimeout(tour.t); tour = null; $('.tour-cap').hidden = true; }

function renderInfo() {
  panel(h('div', { class: 'view-head' }, h('h2', {}, 'Before you fly')),
    h('div', { class: 'emergency' }, ...[['119', 'Police'], ['1990', 'Ambulance, free'], ['1912', 'Tourism hotline']].map(([n, l]) => h('a', { href: `tel:${n}` }, h('strong', { class: 'num' }, n), h('span', {}, l)))),
    ...VERBS.map((v) => h('div', { class: 'qa' }, h('h3', {}, v.verb), h('p', {}, v.text))),
    ...FAQ.map((f) => h('div', { class: 'qa' }, h('h3', {}, f.q), h('p', {}, f.a))),
    h('h3', { class: 'sub' }, 'Keyboard'),
    h('dl', { class: 'keys' }, ...[['/ or Ctrl K', 'Search'], ['← →', 'Previous / next place'], ['R', 'Reset the view'], ['M', 'Satellite or relief map'], ['T', 'Start the tour'], ['[ ]', 'Earlier / later in the day'], ['L', 'Live: the sun over Sri Lanka right now'],['Esc', 'Back']].flatMap(([k, d]) => [h('dt', {}, k), h('dd', {}, d)])),
    h('h3', { class: 'sub' }, 'Data and credits'),
    h('p', { class: 'small' }, 'Terrain: AWS Terrain Tiles (Mapzen / Tilezen), open data; close-up relief from SRTM 1 arc-second (NASA / USGS), streamed from the same open tiles when you zoom in. Satellite: Sentinel-2 cloudless 2024 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0. Close-up aerial imagery: Esri World Imagery (Esri, Maxar, Earthstar Geographics), streamed only when you zoom in close. Live weather: Open-Meteo (CC BY 4.0), fetched only while Live is on. Photographs: Wikimedia Commons contributors under free licences, each linked from its place. Facts checked November 2026.'),
    h('p', { class: 'small' }, 'This app stores your month, trip and settings only in your own browser. No cookies, no analytics, no third-party requests.'));
  sheet('half');
}

// ---------- search palette ----------
function openPalette() {
  const dlg = $('.palette'); const input = $('input', dlg); const ul = $('ul', dlg);
  const cmds = [
    { label: 'Explore all places', run: () => go('#/explore') }, { label: 'Open my trip', run: () => go('#/trip') },
    { label: 'Start the island tour', run: () => go('#/tour') }, { label: 'Practical info and emergency numbers', run: () => go('#/info') },
    { label: 'Switch to relief map', run: () => setStyle('relief') }, { label: 'Switch to satellite', run: () => setStyle('satellite') },
    { label: 'Reset the view', run: () => world?.home() }, { label: 'What is near me?', run: () => { go('#/explore'); nearMe(); } },
    { label: 'Open the info view (no 3D)', run: () => { store.set('lite', '1'); location.reload(); } },
    ...MONTHS.map((m, i) => ({ label: `Travel in ${m}`, run: () => setMonth(i + 1) })),
    ...[['Sunrise', 6], ['Morning light', 8.5], ['Midday sun', 12], ['Golden hour', 17], ['Sunset', 18], ['Blue hour', 18.75]].map(([l, h]) => ({ label: `${l} (time of day)`, run: () => setHour(h) })),
    { label: 'Live: the sun over Sri Lanka right now', run: () => setLive(true) },
  ];
  let sel = 0, results = [];
  function update() {
    const q = input.value.trim().toLowerCase();
    const places = PLACES.filter((p) => !q || `${p.name} ${REGION[p.region].name} ${p.kinds.join(' ')}`.toLowerCase().includes(q)).slice(0, 8)
      .map((p) => ({ label: p.name, hint: REGION[p.region].name, id: p.id, run: () => go(`#/place/${p.id}`) }));
    const regions = REGIONS.filter((r) => q && r.name.toLowerCase().includes(q)).map((r) => ({ label: r.name, hint: 'Region', run: () => { go('#/explore'); const { u, v } = project(r.lat, r.lon); world?.flyTo({ target: world.worldOf(u, v), distance: r.dist * 9, polar: r.tilt }); } }));
    const c = cmds.filter((x) => q && x.label.toLowerCase().includes(q)).slice(0, 6).map((x) => ({ ...x, hint: 'Action' }));
    results = q ? [...places, ...regions, ...c] : [...places.slice(0, 5), ...cmds.slice(0, 6).map((x) => ({ ...x, hint: 'Action' }))];
    sel = Math.min(sel, results.length - 1);
    ul.replaceChildren(...results.map((r, i) => h('li', { role: 'option', 'aria-selected': String(i === sel), onclick: () => choose(i), onpointermove: () => { if (sel !== i) { sel = i; mark(); } } },
      r.id ? thumb(r.id) : h('span', { class: 'thumb ph' }), h('span', {}, r.label), h('span', { class: 'muted' }, r.hint))));
  }
  const mark = () => $$('li', ul).forEach((li, i) => li.setAttribute('aria-selected', String(i === sel)));
  function choose(i) { const r = results[i]; if (!r) return; dlg.close(); r.run(); }
  input.value = ''; sel = 0; update();
  input.oninput = () => { sel = 0; update(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = (sel + 1) % results.length; mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + results.length) % results.length; mark(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(sel); e.preventDefault(); }
  };
  dlg.showModal(); input.focus();
}

// ---------- near me (opt-in, computed locally) ----------
function nearMe() {
  if (!navigator.geolocation) return toast('Location is not available in this browser.');
  toast('Asking for your location. It stays on this device.');
  navigator.geolocation.getCurrentPosition((pos) => {
    state.me = { lat: pos.coords.latitude, lon: pos.coords.longitude }; state.sort = 'me';
    const B = { s: 5.75, n: 9.98, w: 79.45, e: 82.05 };
    if (state.me.lat < B.s || state.me.lat > B.n || state.me.lon < B.w || state.me.lon > B.e) toast(`You are ${Math.round(km(state.me, { lat: 7.87, lon: 80.77 }))} km from the island. Sorted by distance anyway.`);
    else if (world) { const { u, v } = project(state.me.lat, state.me.lon); world.flyTo({ target: world.worldOf(u, v), distance: 3.5, polar: 0.9 }); }
    if (route.name === 'explore') renderExplore(true);
  }, () => toast('Location was not shared. Sorting by the map view instead.'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

function setStyle(s) { state.style = s; store.set('style', s); world?.setStyle(s); $('[data-cmd=style]').textContent = s === 'relief' ? 'Satellite' : 'Relief map'; }

// ---------- labels over the 3D pins ----------
function labels() {
  const layer = $('.labels'); const els = {};
  for (const p of PLACES) { els[p.id] = h('a', { class: 'label', href: `#/place/${p.id}`, tabindex: '-1' }, p.name); layer.append(els[p.id]); }
  const widths = {}; let hover = null, frame = 0, uiRects = [];
  const canvas = world.canvas;
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect(); let best = null, bd = 22 * 22;
    for (const p of PLACES) { const s = world.screenOf(p.id); if (s.z > 1) continue; const x = (s.x + 1) / 2 * r.width, y = (1 - s.y) / 2 * r.height; const d = (x - (e.clientX - r.left)) ** 2 + (y - (e.clientY - r.top)) ** 2; if (d < bd) { bd = d; best = p.id; } }
    hover = best; canvas.style.cursor = best ? 'pointer' : '';
    const g = world.groundAt(e.clientX, e.clientY); const ro = $('.readout');
    ro.textContent = g ? `${g.lat.toFixed(4)}° N  ${g.lon.toFixed(4)}° E  ·  ${g.elev > 0 ? Math.round(g.elev) + ' m' : Math.round(-g.elev) + ' m deep'}` : '';
  }, { passive: true });
  canvas.addEventListener('click', () => { if (hover && !world.flying) go(`#/place/${hover}`); });
  world.onFrame(() => {
    const w = layer.clientWidth, hh = layer.clientHeight; const filt = new Set(visiblePlaces().map((p) => p.id));
    const sel = route.name === 'place' ? route.id : null;
    const dist = world.camera.position.distanceTo(world.controls.target);
    const cands = [];
    for (const p of PLACES) {
      const want = p.id === sel || p.id === hover || (filt.has(p.id) && (dist < 9 || p.kinds.includes('heritage') && dist < 16 || filt.size < 12));
      const el = els[p.id];
      if (!want) { if (el.classList.contains('on')) el.classList.remove('on'); continue; }
      const s = world.screenOf(p.id); if (s.z > 1 || Math.abs(s.x) > 1.05 || Math.abs(s.y) > 1.05) { el.classList.remove('on'); continue; }
      cands.push({ p, x: (s.x + 1) / 2 * w, y: (1 - s.y) / 2 * hh, pri: (p.id === sel ? -10 : p.id === hover ? -5 : 0) + (p.months.includes(state.month) ? 0 : 3) + s.z });
    }
    cands.sort((a, b) => a.pri - b.pri);
    // the floating UI counts as already placed, so labels never slide under the top bar, the panel or the HUD
    if (frame++ % 12 === 0) {
      const lr = layer.getBoundingClientRect(); const block = (sel) => { const e = $(sel); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left - lr.left, r: b.right - lr.left, t: b.top - lr.top, b: b.bottom - lr.top } : null; };
      uiRects = ['.top .tabs', '.brand', '.search-btn', '[data-cmd=info-view]', '.panel', '.months-wrap', '.tools', '.tour-cap'].map(block).filter(Boolean);
    }
    const placed = uiRects.slice(); const ui = placed.length;
    for (const c of cands) {
      const el = els[c.p.id]; const lw = (widths[c.p.id] ||= el.offsetWidth || 120);
      const r = { l: c.x - lw / 2, r: c.x + lw / 2, t: c.y - 34, b: c.y - 6 };
      if (r.t < 4 || r.l < 4 || r.r > w - 4 || placed.length - ui > 18 || placed.some((q) => r.l < q.r + 4 && r.r > q.l - 4 && r.t < q.b + 2 && r.b > q.t - 2)) { el.classList.remove('on'); continue; }
      placed.push(r); el.style.transform = `translate(${c.x.toFixed(1)}px, ${(c.y - 8).toFixed(1)}px) translate(-50%, -100%)`;
      el.classList.add('on'); el.classList.toggle('sel', c.p.id === sel); el.classList.toggle('off', !c.p.months.includes(state.month));
    }
  });
}

// ---------- custom cursor + magnetic buttons (fine pointers only) ----------
function cursor() {
  if (reduced || !matchMedia('(pointer: fine)').matches) return;
  const dot = $('.cursor'); dot.hidden = false; let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y;
  addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; const t = e.target.closest?.('a, button, input, select, .label'); dot.classList.toggle('big', !!t); }, { passive: true });
  const loop = () => { cx += (x - cx) * 0.22; cy += (y - cy) * 0.22; dot.style.transform = `translate(${cx}px, ${cy}px)`; requestAnimationFrame(loop); }; loop();
  document.addEventListener('pointermove', (e) => {
    const b = e.target.closest?.('.btn'); $$('.btn.mag').forEach((n) => { if (n !== b) { n.style.translate = ''; n.classList.remove('mag'); } });
    if (!b) return; const r = b.getBoundingClientRect(); b.classList.add('mag');
    b.style.translate = `${((e.clientX - r.left) / r.width - 0.5) * 8}px ${((e.clientY - r.top) / r.height - 0.5) * 8}px`;
  }, { passive: true });
}

// ---------- phone bottom sheet ----------
function bottomSheet() {
  const p = $('.panel'), grip = $('.grip'); let y0 = 0, start = 0, dragging = false;
  const states = ['peek', 'half', 'full'];
  grip.addEventListener('click', () => { const i = states.indexOf(p.dataset.sheet || 'peek'); p.dataset.sheet = states[(i + 1) % 3]; });
  grip.addEventListener('pointerdown', (e) => { dragging = true; y0 = e.clientY; start = p.getBoundingClientRect().top; grip.setPointerCapture(e.pointerId); p.classList.add('dragging'); });
  grip.addEventListener('pointermove', (e) => { if (!dragging) return; p.style.translate = `0 ${Math.max(-start + 60, e.clientY - y0)}px`; });
  grip.addEventListener('pointerup', (e) => {
    if (!dragging) return; dragging = false; p.classList.remove('dragging'); p.style.translate = '';
    const top = start + (e.clientY - y0), vh = innerHeight; p.dataset.sheet = top < vh * 0.3 ? 'full' : top < vh * 0.7 ? 'half' : 'peek';
  });
}

// ---------- boot ----------
export async function boot({ lowPower, onFail }) {
  const app = $('#app'); app.hidden = false; document.documentElement.classList.add('app-mode');
  document.documentElement.classList.toggle('low', !!lowPower); // no live glass blur on phones and slower machines
  $('.season-line').textContent = seasonLine(state.month);
  $$('.months button').forEach((b) => { b.setAttribute('aria-pressed', String(+b.dataset.month === state.month)); b.addEventListener('click', () => setMonth(+b.dataset.month)); });
  new ResizeObserver(() => centreMonth(false)).observe($('.months')); // keep the chosen month in view as the bar resizes
  $('.daytime input').addEventListener('input', (e) => setHour(+e.target.value));
  if (store.get('live')) setLive(true); else setHour(state.hour);
  document.addEventListener('visibilitychange', liveTick); // catch up after the tab sleeps
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cmd]'); if (!c) return;
    const cmd = c.dataset.cmd;
    if (cmd === 'search') openPalette();
    else if (cmd === 'style') setStyle(state.style === 'relief' ? 'satellite' : 'relief');
    else if (cmd === 'home') world?.home();
    else if (cmd === 'zoom-in' || cmd === 'zoom-out') { if (!world) return; const k = cmd === 'zoom-in' ? 0.7 : 1.4; const off = world.camera.position.clone().sub(world.controls.target).multiplyScalar(k); world.flyTo({ target: world.controls.target.clone(), distance: off.length(), polar: Math.acos(off.y / off.length()), azimuth: Math.atan2(off.x, off.z), duration: 0.6 }); }
    else if (cmd === 'info-view') { store.set('lite', '1'); location.reload(); }
    else if (cmd === 'skip-intro') finishIntro(true);
    else if (cmd === 'live') setLive(!state.live);
  });
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea') && e.key !== 'Escape') return;
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || e.key === '/') { e.preventDefault(); openPalette(); }
    else if (e.key === 'Escape' && !$('.palette').open && route.name !== 'explore') go('#/explore');
    else if (route.name === 'place' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { const l = visiblePlaces(); const i = l.findIndex((x) => x.id === route.id); go(`#/place/${l[(i + (e.key === 'ArrowRight' ? 1 : -1) + l.length) % l.length].id}`); }
    else if (e.key === 'r' || e.key === 'R') world?.home();
    else if (e.key === 'm' || e.key === 'M') setStyle(state.style === 'relief' ? 'satellite' : 'relief');
    else if (e.key === 't' || e.key === 'T') go('#/tour');
    else if (e.key === '[' || e.key === ']') setHour(state.hour + (e.key === ']' ? 0.5 : -0.5));
    else if (e.key === 'l' || e.key === 'L') setLive(!state.live);
  });
  addEventListener('hashchange', render);
  saveTrip(); bottomSheet();
  render(); // panels work immediately, before the 3D is ready

  const n = $('.loader-n'), bar = $('.loader-bar');
  let introDone = false;
  function finishIntro(skip) {
    if (introDone) return; introDone = true; $('.loader').classList.add('done');
    if (!world) return;
    if (skip || reduced || store.get('seenIntro')) world.home(skip ? 0.01 : 1.2); else world.intro();
    store.set('seenIntro', '1');
  }
  try {
    const { createWorld } = await import('./world.js');
    const pins = Object.fromEntries(PLACES.map((p) => [p.id, { ...project(p.lat, p.lon), months: p.months }]));
    world = await createWorld({ container: $('.globe'), places: pins, month: state.month, hour: state.hour, lowPower,
      onProgress: (f) => { const v = Math.round(f * 100); n.textContent = String(v); bar.style.scale = `${f} 1`; } });
    if (import.meta.env.DEV) window.__world = world;
    world.onCredit = (t) => { const c = $('.map-credit'); c.textContent = t || ''; c.hidden = !t; };
    world.onLost =() => { toast('3D stopped on this device. Opening the info view.'); try { sessionStorage.setItem('lite-auto', '1'); } catch {} setTimeout(() => location.reload(), 1200); };
    if (!world.hasSatellite) state.style = 'relief';
    setStyle(state.style); labels(); syncWorldFilter(); if (state.live) liveTick(); else setHour(state.hour);
    finishIntro(false);
    render();
  } catch (err) {
    console.warn('3D failed', err); onFail?.(err);
  }
}
