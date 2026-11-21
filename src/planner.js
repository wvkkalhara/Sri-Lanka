// The route planner. Pure client-side; nothing leaves the browser.
// Every id coming from the URL or storage is checked against the place list before use,
// and all output is built with DOM APIs (textContent), never HTML strings.
import { PLACES, REGIONS } from './data/places.js';
import { project, driveHours, AIRPORT } from './geo.js';

const BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));
const REGION = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
const ICONIC = new Set(['sigiriya', 'kandy', 'ninearch', 'galle', 'yala', 'polonnaruwa', 'mirissa', 'hortonplains', 'dambulla', 'arugambay', 'trincomalee', 'jaffna', 'ellarock', 'udawalawe']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const PRESETS = {
  classic: { month: 2, days: [['sigiriya', 'pidurangala'], ['polonnaruwa', 'minneriya'], ['dambulla', 'kandy'], ['peradeniya', 'nuwaraeliya'], ['ninearch', 'ellarock'], ['udawalawe', 'mirissa'], ['galle']] },
  full: { month: 2, days: [['anuradhapura'], ['mihintale', 'ritigala'], ['sigiriya', 'pidurangala'], ['polonnaruwa', 'minneriya'], ['dambulla', 'kandy'], ['peradeniya', 'ambuluwawa'], ['nuwaraeliya', 'stclairs'], ['hortonplains'], ['ninearch', 'ellarock'], ['diyaluma', 'liptons'], ['udawalawe', 'yala'], ['mirissa', 'coconuthill'], ['galle', 'unawatuna'], ['bentota', 'colombo']] },
  east: { month: 7, days: [['sigiriya', 'pidurangala'], ['minneriya', 'polonnaruwa'], ['trincomalee'], ['pigeonisland'], ['pasikudah'], ['galoya'], ['arugambay'], ['kumana'], ['ninearch', 'ellarock'], ['kandy']] },
  hidden: { month: 3, days: [['yapahuwa', 'aukana'], ['ritigala', 'pidurangala'], ['knuckles'], ['meemure'], ['ambuluwawa', 'gartmore'], ['belihuloya', 'bambarakanda'], ['diyaluma', 'liptons'], ['bundala', 'kataragama'], ['rekawa', 'mulkirigala'], ['dondra', 'hiriketiya'], ['sinharaja'], ['bentota']] },
};

// ---------- the algorithm ----------
export function buildPlan({ days, month, loves, pace, hidden }) {
  const budget = { slow: 5, steady: 7, full: 9.5 }[pace] ?? 7;
  const score = (p) => {
    let s = p.kinds.filter((k) => loves.has(k)).length * 2;
    if (hidden && p.kinds.includes('hidden')) s += 2;
    if (ICONIC.has(p.id)) s += hidden ? 0.5 : 1.5;
    s += p.months.includes(month) ? 2 : -6;
    return s;
  };
  const scored = PLACES.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const regionScore = {};
  for (const { p, s } of scored) (regionScore[p.region] ||= []).push(s);
  const ranked = Object.entries(regionScore)
    .map(([r, ss]) => [r, ss.slice(0, 3).reduce((a, b) => a + b, 0)])
    .sort((a, b) => b[1] - a[1]);
  const usable = days - 1; // the last morning is the drive to the airport
  const nReg = Math.max(1, Math.min(ranked.length, Math.round(usable / (pace === 'slow' ? 3.2 : pace === 'full' ? 2 : 2.5))));
  let chosen = ranked.slice(0, nReg).map(([r]) => r);

  // order the regions as the shortest loop from the airport (n ≤ 7: try every order)
  const cen = (r) => ({ id: `region:${r}`, lat: REGION[r].lat, lon: REGION[r].lon, region: r });
  let best = chosen, bestD = Infinity;
  const perm = (arr, l = 0) => {
    if (l === arr.length) {
      let d = 0, prev = AIRPORT;
      for (const r of arr) { d += driveHours(prev, cen(r)); prev = cen(r); }
      d += driveHours(prev, AIRPORT);
      if (d < bestD) { bestD = d; best = arr.slice(); }
      return;
    }
    for (let i = l; i < arr.length; i++) { [arr[l], arr[i]] = [arr[i], arr[l]]; perm(arr, l + 1); [arr[l], arr[i]] = [arr[i], arr[l]]; }
  };
  perm(chosen.slice());
  chosen = best;

  // share the days by region score, at least one per region
  const total = chosen.reduce((a, r) => a + regionScore[r].slice(0, 3).reduce((x, y) => x + y, 0), 0);
  let alloc = chosen.map((r) => Math.max(1, Math.round((usable * regionScore[r].slice(0, 3).reduce((x, y) => x + y, 0)) / total)));
  while (alloc.reduce((a, b) => a + b, 0) > usable) { const i = alloc.indexOf(Math.max(...alloc)); alloc[i]--; }
  while (alloc.reduce((a, b) => a + b, 0) < usable) { const i = alloc.indexOf(Math.min(...alloc)); alloc[i]++; }

  const out = []; let prev = AIRPORT;
  chosen.forEach((r, ri) => {
    const pool = scored.filter((x) => x.p.region === r).map((x) => x.p);
    for (let d = 0; d < alloc[ri]; d++) {
      const day = []; let left = budget;
      if (d === 0) left -= Math.min(budget - 1.5, driveHours(prev, pool[0] || cen(r)));
      while (pool.length) {
        // next stop: the best-scoring place within reach, nearest first among equals
        pool.sort((a, b) => (score(b) - score(a)) * 2 + (driveHours(prev, a) - driveHours(prev, b)));
        const p = pool[0], cost = Math.min(p.hours, 10) + (day.length ? driveHours(prev, p) : 0);
        if (day.length && cost > left) break;
        if (!day.length && p.hours >= 24 && d < alloc[ri] - 1) { /* an overnight place fills the day */ }
        day.push(p.id); pool.shift(); left -= cost; prev = p;
        if (p.hours >= 24 || day.length >= 4) break;
      }
      out.push(day);
    }
  });
  return out;
}

// ---------- trains ----------
// The lines a visitor would use, with rough hours from the start of each line to the station nearest each place.
// Kandy–Nanu Oya is left out: closed after Cyclone Ditwah (expected back in 2027). Times are approximate.
const LINES = [
  { name: 'the Main Line', stops: { colombo: 0, peradeniya: 2.6, kandy: 2.75 } },
  { name: 'the coastal line', stops: { colombo: 0, bentota: 1.6, hikkaduwa: 2.3, galle: 2.8, unawatuna: 2.9, koggala: 3.1, mirissa: 3.5 } },
  { name: 'the hill-country line from Nanu Oya', scenic: true, stops: { nuwaraeliya: 0, hortonplains: 0.9, liptons: 2.2, ellarock: 3.1, ninearch: 3.35 } },
  { name: 'the Northern Line', stops: { colombo: 0, anuradhapura: 4.5, jaffna: 7.5 } },
  { name: 'the Trincomalee line', stops: { colombo: 0, trincomalee: 7 } },
  { name: 'the Batticaloa line', stops: { colombo: 0, polonnaruwa: 6, pasikudah: 7.5 } },
];
// A train worth suggesting between two stops: on the same open line, at least half an hour apart, and not much
// slower than driving. Returns { line, h } or null.
export function trainFor(a, b) {
  if (!a?.id || !b?.id || a.id === b.id) return null;
  for (const l of LINES) {
    const x = l.stops[a.id], y = l.stops[b.id];
    if (x === undefined || y === undefined) continue;
    const h = Math.abs(x - y) + 0.5; // plus getting to and from the stations
    if (h < 0.75) continue;
    if (l.scenic || h <= driveHours(a, b) * 1.6 + 0.5) return { line: l.name, h, scenic: !!l.scenic };
  }
  return null;
}
export const trainText = (t) => `${t.scenic ? 'Better by train: the slow, scenic ride' : 'Or by train'} on ${t.line}: about ${t.h < 1 ? Math.round(t.h * 60) + ' min' : (Math.round(t.h * 2) / 2) + ' h'}, station to station. Check the timetable before you go.`;

export function warningsFor(days, month) {
  const ids = new Set(days.flat()), w = [];
  const hills = [...ids].some((id) => BY_ID[id]?.region === 'hills');
  const off = [...ids].filter((id) => BY_ID[id] && !BY_ID[id].months.includes(month)).map((id) => BY_ID[id].name);
  if (off.length) w.push(`Out of season in ${MONTHS[month - 1]}: ${off.join(', ')}. Expect rain, rough sea or closures; the month dial shows when each is at its best.`);
  if (hills) w.push('Rail: the Kandy–Nanu Oya section is closed after Cyclone Ditwah (expected back in 2027). Drive to Nanu Oya and take the train from there to Ella.');
  if (ids.has('yala') && [9, 10].includes(month)) w.push('Yala block 1 usually closes for a few weeks in September and October. Ask your driver about block 5 or swap for Udawalawe.');
  if (ids.has('kandy') && [7, 8].includes(month)) w.push('The Esala Perahera fills Kandy for ten nights in July or August. Book rooms months ahead.');
  if ([...ids].some((id) => BY_ID[id]?.region === 'east') && [11, 12, 1, 2].includes(month)) w.push('The east coast has its monsoon now: rough sea and closed beach bars. Consider the south instead.');
  if ([...ids].some((id) => ['south', 'west'].includes(BY_ID[id]?.region)) && [5, 6, 7, 8, 9].includes(month)) w.push('South-west monsoon: the south and west coasts have rough sea and rain showers. Swim only at sheltered bays.');
  return w;
}

// ---------- share links: #plan=… holds only place ids ----------
export const enc = (days, m) => btoa(JSON.stringify({ m, d: days })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function decodePlan(s) {
  try {
    if (!/^[A-Za-z0-9_-]{1,4000}$/.test(s)) return null;
    const o = JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
    const m = Number.isInteger(o.m) && o.m >= 1 && o.m <= 12 ? o.m : 1;
    if (!Array.isArray(o.d) || o.d.length > 30) return null;
    const d = o.d.filter(Array.isArray).map((day) => day.filter((id) => typeof id === 'string' && BY_ID[id]).slice(0, 6));
    return d.length ? { m, d } : null;
  } catch { return null; }
}

// ---------- the UI ----------
export function initPlanner(root, { getMonth, setMonth, openPlace, toast }) {
  const form = root.querySelector('.planner-form');
  const list = root.querySelector('.itinerary');
  const svg = root.querySelector('.route-map svg');
  const daysIn = form.elements.days, daysOut = form.elements.daysOut;
  let plan = null, month = getMonth();

  const store = { get() { try { return decodePlan(localStorage.getItem('plan') || ''); } catch { return null; } }, set(v) { try { localStorage.setItem('plan', v); } catch { /* private mode */ } } };

  function settings() {
    return {
      days: +daysIn.value, month: +form.elements.month.value, pace: form.elements.pace.value,
      loves: new Set([...form.querySelectorAll('input[name=love]:checked')].map((i) => i.value)), hidden: form.elements.hidden.checked,
    };
  }
  function syncMonth(m) { month = m; form.elements.month.value = String(m); }
  daysIn.addEventListener('input', () => { daysOut.value = daysIn.value; });
  form.elements.month.addEventListener('change', () => setMonth(+form.elements.month.value));

  form.querySelector('[data-plan-build]').addEventListener('click', () => {
    const s = settings(); if (!s.loves.size) s.loves.add('heritage');
    show(buildPlan(s), s.month);
  });
  form.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = PRESETS[b.dataset.preset]; if (!p) return;
    setMonth(p.month); daysIn.value = String(p.days.length + 1); daysOut.value = daysIn.value;
    show(p.days.map((d) => d.slice()), p.month);
  }));
  form.querySelector('[data-plan-share]').addEventListener('click', async () => {
    if (!plan) return toast('Build a route first.');
    const url = `${location.origin}${location.pathname}#plan=${enc(plan, month)}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied. It holds only the place names, nothing about you.'); }
    catch { history.replaceState(null, '', `#plan=${enc(plan, month)}`); toast('Link is in the address bar.'); }
  });
  form.querySelector('[data-plan-print]').addEventListener('click', () => { if (!plan) return toast('Build a route first.'); window.print(); });

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function svgEl(tag, attrs) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  function show(days, m) {
    plan = days.filter((d) => d.length); syncMonth(m);
    store.set(enc(plan, m));
    list.replaceChildren();
    const warn = warningsFor(plan, m);
    for (const w of warn) list.append(el('li', 'warn', w));
    let prev = AIRPORT, totalDrive = 0;
    const arrive = el('li', 'day-card');
    arrive.append(el('h3', null, 'Day 1 · Land in Colombo'));
    arrive.append(el('p', 'drive', `${MONTHS[m - 1]}. Collect your driver or SIM at the airport, then head for ${(REGION[BY_ID[plan[0]?.[0]]?.region]?.name ?? 'the coast').replace(/^The /, 'the ')}.`));
    list.append(arrive);
    plan.forEach((day, i) => {
      const li = el('li', 'day-card');
      const reg = REGION[BY_ID[day[0]].region];
      li.append(el('h3', null, `Day ${i + 2} · ${reg.name.replace(/^The /, '')}`));
      const from = prev;
      const dh = day.reduce((acc, id) => { const h = driveHours(prev, BY_ID[id]); prev = BY_ID[id]; return acc + h; }, 0);
      totalDrive += dh;
      li.append(el('p', 'drive', dh < 0.4 ? 'Short local hops' : `About ${dh < 1 ? Math.round(dh * 60) + ' min' : dh.toFixed(1) + ' h'} on the road`));
      const tr = trainFor(from, BY_ID[day[0]]); if (tr) li.append(el('p', 'drive train', trainText(tr)));
      const ul = el('ul');
      day.forEach((id, j) => {
        const p = BY_ID[id], row = el('li');
        const a = el('a', null, p.name); a.href = `#place-${id}`; a.addEventListener('click', (e) => { e.preventDefault(); openPlace(id); });
        const x = el('button', 'x', 'Remove'); x.type = 'button'; x.setAttribute('aria-label', `Remove ${p.name}`);
        x.addEventListener('click', () => { day.splice(j, 1); show(plan, month); });
        row.append(a, x); ul.append(row);
      });
      li.append(ul); list.append(li);
    });
    const home = el('li', 'day-card');
    const back = driveHours(prev, AIRPORT); totalDrive += back;
    home.append(el('h3', null, `Day ${plan.length + 2} · Back to the airport`));
    home.append(el('p', 'drive', `About ${back.toFixed(1)} h. In all, roughly ${Math.round(totalDrive)} hours of driving over the trip.`));
    list.append(home);
    drawRoute();
  }

  function drawRoute() {
    svg.replaceChildren();
    const pts = [AIRPORT, ...plan.flat().map((id) => BY_ID[id]), AIRPORT].map((p) => { const { u, v } = project(p.lat, p.lon); return [u * 1000, v * 1644, p]; });
    const d = 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
    svg.append(svgEl('path', { d }), svgEl('path', { d, class: 'ink' }));
    const seen = new Set();
    pts.forEach(([x, y, p], i) => {
      if (seen.has(p.id)) return; seen.add(p.id);
      svg.append(svgEl('circle', { cx: x, cy: y, r: p.id === 'airport' ? 13 : 10 }));
    });
  }

  function addPlace(id) {
    if (!BY_ID[id]) return;
    if (!plan) plan = [];
    if (plan.flat().includes(id)) return toast(`${BY_ID[id].name} is already on your route.`);
    const r = BY_ID[id].region;
    const idx = plan.findIndex((d) => d.some((x) => BY_ID[x].region === r));
    if (idx >= 0) plan[idx].push(id); else plan.push([id]);
    show(plan, month); toast(`${BY_ID[id].name} added to your route.`);
  }

  // restore: link first, then the visitor's own saved plan
  const fromHash = location.hash.startsWith('#plan=') ? decodePlan(location.hash.slice(6)) : null;
  const saved = fromHash || store.get();
  if (saved) { setMonth(saved.m); show(saved.d, saved.m); daysIn.value = String(Math.min(21, Math.max(3, saved.d.length + 1))); daysOut.value = daysIn.value; }
  else syncMonth(month);

  return { syncMonth, addPlace, has: (id) => !!plan?.flat().includes(id) };
}
