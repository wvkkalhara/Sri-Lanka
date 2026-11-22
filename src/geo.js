// One projection for everything: the 3D terrain, the fallback relief map and the planner route.
// Web Mercator, normalised to the terrain image bounds (u, v in 0..1).
import meta from './data/terrain-meta.json';
import roads from './data/roads.json';

const B = meta.bounds;
const mx = (lon) => (lon + 180) / 360;
const my = (lat) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};
const X0 = mx(B.west), X1 = mx(B.east), Y0 = my(B.north), Y1 = my(B.south);

export const TERRAIN = meta;
export const ASPECT = meta.height / meta.width;

export function project(lat, lon) {
  return { u: (mx(lon) - X0) / (X1 - X0), v: (my(lat) - Y0) / (Y1 - Y0) };
}

export function km(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Door-to-door road time in hours: the real road network (scripts/roads.mjs, OSRM on OpenStreetMap, scaled for
// Sri Lankan traffic) between known points; anything else falls back to a straight-line estimate.
const RI = new Map(roads.ids.map((id, i) => [id, i]));
export function driveHours(a, b) {
  const i = RI.get(a.id), j = RI.get(b.id);
  if (i !== undefined && j !== undefined) { const h = roads.h[i][j]; if (h != null) return i === j ? 0 : h; }
  return roughHours(a, b);
}
// Rough estimate: roads wind (×1.4) and the hills are slow.
const SLOW = new Set(['hills', 'kandy']);
function roughHours(a, b) {
  const d = km(a, b) * 1.4;
  const slow = SLOW.has(a.region) || SLOW.has(b.region);
  return d / (slow ? 28 : 42);
}

export const AIRPORT = { id: 'airport', name: 'Bandaranaike Airport (CMB)', lat: 7.1808, lon: 79.8841, region: 'west' };
