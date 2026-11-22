// The world: real elevation + Sentinel-2 satellite colour, an animated ocean shaded by real bathymetry,
// sky, monsoon clouds, pins, 3D routes, free map controls and scripted camera flights.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { TERRAIN, ASPECT, project as projectFn } from '../geo.js';

export const W = 10, H = W * ASPECT;
const VSCALE = 0.3 / 2500;
const C = {
  zenith: 0x3d79a8, horizon: 0xd3dfd8, ground: 0x6f8c84, sunCol: 0xfff0d8, deep: 0x0b3a52, shallow: 0x2a8f94,
  lime: 0xf2a33a, cream: 0xf2f2f2, reliefLow: 0x2e5a3c, reliefHigh: 0xd9e4b8, contour: 0x0b2418,
};
export const toWorld = (u, v) => new THREE.Vector3((u - 0.5) * W, 0, (v - 0.5) * H);
export const toUV = (x, z) => ({ u: x / W + 0.5, v: z / H + 0.5 });

// ---------- the real sun over Sri Lanka ----------
// Position for a month and a clock time (Sri Lanka time, UTC+5:30), from the NOAA approximations for declination and
// the equation of time. World axes: +x east, -z north, +y up.
const LAT = (7.87 * Math.PI) / 180, LON = 80.77, MID_DAY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
export function sunAt(month, hour) {
  const g = (2 * Math.PI * (MID_DAY[month - 1] - 1)) / 365;
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const H = ((hour + (eot + 4 * (LON - 82.5)) / 60 - 12) * 15 * Math.PI) / 180; // hour angle; UTC+5:30 is the 82.5° E meridian
  const alt = Math.asin(Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(LAT) - Math.sin(LAT) * Math.cos(H)); // from north, clockwise
  return { alt, az, dir: new THREE.Vector3(Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)) };
}
const SUN = new THREE.Vector3(0, 1, 0);
let SDX = 0, SDZ = 1, TAN_E = 1, BVEX = 1; // BVEX: the height scale shadows are baked for (see uVex)
function aimSun(dir) {
  SUN.copy(dir).normalize(); const h = Math.hypot(SUN.x, SUN.z) || 1;
  SDX = SUN.x / h; SDZ = SUN.z / h; TAN_E = Math.max(SUN.y, 0.015) / h; // at and below the horizon: everything in shade
}
// Baked light per vertex: a soft sun shadow (march towards the sun over the heightfield) and ambient occlusion
// (how far the ground sits below its surroundings). hy(x, z) → world height.
function bakeShadow(x, z, y0, hy, d0 = 0.006, steps = 30) {
  let s = 1, d = d0;
  for (let i = 0; i < steps && s > 0; i++) { s = Math.min(s, (12 * (BVEX * (y0 - hy(x + SDX * d, z + SDZ * d)) + d * TAN_E)) / d); d *= 1.17; }
  return Math.max(0, Math.min(1, s));
}
function bakeLight(x, z, y0, hy) {
  let acc = 0;
  for (let a = 0; a < 8; a++) { const c = Math.cos(a * 0.785), sn = Math.sin(a * 0.785); acc += hy(x + c * 0.02, z + sn * 0.02) + hy(x + c * 0.07, z + sn * 0.07); }
  return [bakeShadow(x, z, y0, hy), Math.max(0.45, Math.min(1.1, 1 - (acc / 16 - y0) * 7))];
}
// Light and sky for a sun altitude (radians): white noon, golden low sun, rose-and-indigo blue hour.
const SKY = {
  // sun: linear RGB + strength; the rest are sRGB hex
  day: { sun: [1, 0.87, 0.69, 1.1], zen: 0x3d79a8, hor: 0xd3dfd8, gnd: 0x6f8c84, glow: 0, exp: 1.5 },
  gold: { sun: [1, 0.5, 0.2, 2.1], zen: 0x3a6c9c, hor: 0xecd0ae, gnd: 0x56685f, glow: 0.6, exp: 1.7 },
  dusk: { sun: [0.85, 0.26, 0.12, 0.35], zen: 0x2a4378, hor: 0x8088a6, gnd: 0x3a4a56, glow: 0.9, exp: 2.6 },
};
function lightFor(alt, out) {
  const deg = (alt * 180) / Math.PI, s = THREE.MathUtils.smoothstep;
  const a = s(deg, 3, 28), b = s(deg, -4, 3); // a: day vs gold, b: gold vs dusk
  const mix3 = (k) => { const x = SKY.dusk[k], y = SKY.gold[k], z = SKY.day[k]; return [x, y, z]; };
  const col = (k) => { const [x, y, z] = mix3(k); return new THREE.Color(x).lerp(new THREE.Color(y), b).lerp(new THREE.Color(z), a); };
  const num = (k) => { const [x, y, z] = mix3(k); return THREE.MathUtils.lerp(THREE.MathUtils.lerp(x, y, b), z, a); };
  const sc = [0, 1, 2, 3].map((i) => THREE.MathUtils.lerp(THREE.MathUtils.lerp(SKY.dusk.sun[i], SKY.gold.sun[i], b), SKY.day.sun[i], a));
  out.uSunCol.value.setRGB(sc[0], sc[1], sc[2]).multiplyScalar(sc[3]);
  out.uZenith.value.copy(col('zen')); out.uHorizon.value.copy(col('hor')); out.uGround.value.copy(col('gnd'));
  out.uGlow.value = num('glow');
  return num('exp');
}
const WEATHER = { 1: [0, .8, 0], 2: [0, .45, .1], 3: [0, 0, .45], 4: [.15, 0, .7], 5: [.85, 0, .25], 6: [1, 0, 0], 7: [.9, 0, 0], 8: [.8, 0, 0], 9: [.75, 0, .2], 10: [.2, .3, .9], 11: [0, .9, .5], 12: [0, 1, .15] };

async function fetchProgress(url, onBytes) {
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  const total = +r.headers.get('content-length') || 0; const reader = r.body.getReader(); const parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onBytes?.(got, total); }
  return new Blob(parts);
}

function readHeights(bitmap) {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height); const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0); const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const elev = new Float32Array(bitmap.width * bitmap.height), max = TERRAIN.maxElevation;
  for (let i = 0; i < elev.length; i++) elev[i] = d[i * 4 + 2] > 127 ? Math.max(3, (d[i * 4] / 255) * max) : -((d[i * 4 + 1] / 255) ** 2) * 3000;
  return { elev, w: bitmap.width, h: bitmap.height };
}
export function sampleH(hm, u, v) {
  const x = Math.min(hm.w - 1.001, Math.max(0, u * (hm.w - 1))), y = Math.min(hm.h - 1.001, Math.max(0, v * (hm.h - 1)));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * hm.w + x0, e = hm.elev;
  return (e[i] * (1 - fx) + e[i + 1] * fx) * (1 - fy) + (e[i + hm.w] * (1 - fx) + e[i + hm.w + 1] * fx) * fy;
}

// ---------- shaders ----------
// One shared atmosphere: sky colour by direction, sun, aerial haze, and a monsoon cloud field. Land, sea, sky and
// clouds all read it, so the horizon, the haze on distant hills and the reflections in the water always agree.
const ATMOS = /* glsl */`
  uniform vec3 uSun, uSunCol, uZenith, uHorizon, uGround, uCloudW, uClear; uniform float uTime, uCloudY, uGlow; uniform vec2 uMapMin, uMapSize, uHaze;
  vec2 sunShift(float dy){ return uSun.xz / max(uSun.y, .2) * dy; }       // where a cloud's shadow falls; capped at low sun
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; } return s; }
  vec3 skyCol(vec3 d){
    float h = d.y, mu = max(dot(d, uSun), 0.);
    vec3 c = mix(uHorizon, uZenith, pow(smoothstep(-.02, .7, h), .5));
    c = mix(c, uGround, smoothstep(0., -.2, h));
    // low sun: a warm band along the horizon, strongest on the sun's side (the rest of the sky stays cool)
    vec2 hz = normalize(d.xz + 1e-5), sz = normalize(uSun.xz + 1e-5); float side = dot(hz, sz) * .5 + .5;
    c += uGlow * vec3(1., .42, .16) * pow(side, 3.) * exp(-abs(h) * 9.) * .55;
    return c + uSunCol * (pow(mu, 6.) * .18 + pow(mu, 48.) * .35);      // forward scattering around the sun
  }
  // monsoon weather: which coast is wet this month decides how much of the sky fills in
  float cloudAt(vec2 xz){
    vec2 m = (xz - uMapMin) / uMapSize;
    float sw = smoothstep(.85, .15, length((m - vec2(.2, .85)) * vec2(1., .8)));
    float ne = smoothstep(.85, .15, length((m - vec2(.8, .2)) * vec2(1., .8)));
    float cov = clamp(.16 + uCloudW.x * sw * .34 + uCloudW.y * ne * .34 + uCloudW.z * .16, 0., .6);
    vec2 p = xz * .5 + vec2(uTime * .010, uTime * .004);
    float n = fbm(p) * .8 + fbm(p * 3.7 - vec2(uTime * .02, 0.)) * .25;
    float c = smoothstep(1. - cov, 1. - cov + .22, n * .95 + .05);
    float r = uClear.z; if (r > 0.) c *= smoothstep(r * .5, r * 1.3, length(xz - uClear.xy)); // part over what you look at
    return c;
  }
  vec3 aerial(vec3 col, vec3 w){
    vec3 d = w - cameraPosition; float dist = length(d); vec3 v = d / dist;
    float f = 1. - exp(-max(0., dist - uHaze.x) * uHaze.y);
    return mix(col, skyCol(normalize(vec3(v.x, max(v.y, 0.) + .015, v.z))), clamp(f, 0., 1.));
  }`;
// Heights are baked at the island-view exaggeration; uVex scales them above sea level as you zoom in (see "relief
// scale"), and the normal is re-derived for that scale so the light stays right.
const VEX = /* glsl */`
  uniform float uVex; float vex(float y){ return y > .002 ? .002 + (y - .002) * uVex : y; }
  vec3 vexN(vec3 n){ return normalize(mat3(modelMatrix) * vec3(n.x, n.y / uVex, n.z)); }`;
const landVert = /* glsl */`
  attribute float elev, shade, ao; varying float vE, vSh, vAO; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vK;
  ${VEX}
  void main(){ vE = elev; vSh = shade; vAO = ao; vUv = uv; vK = 0.; vN = vexN(normal); vec3 p = position; p.y = vex(p.y); vec4 w = modelMatrix * vec4(p,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
// Streamed sharp tile: blends from the island's base heights/imagery (k=0) to its own (k=1) by distance from the
// point the camera looks at, so the edge of the loaded area is invisible, and fades in when it arrives.
const tileVert = /* glsl */`
  attribute float elev, by, shade, ao; uniform vec3 uFocus; uniform float uIn;
  varying float vE, vSh, vAO; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vK;
  ${VEX}
  void main(){ vE = elev; vSh = shade; vAO = ao; vUv = uv; vN = vexN(normal);
    float k = uIn * (1. - smoothstep(uFocus.z * .7, uFocus.z * .95, length(position.xz - uFocus.xy))); vK = k;
    vec3 p = position; p.y = vex(mix(by, position.y, k));
    vec4 w = modelMatrix * vec4(p,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const landFrag = /* glsl */`
  precision highp float;
  ${ATMOS}
  uniform sampler2D uSat, uBase, uMask, uHi; uniform vec4 uRect, uGrid, uMaskInfo, uHiRect, uDetRect; uniform float uHiK, uDetOn; uniform float uDetail, uUseMask; uniform float uStyle, uHasSat; uniform vec3 uLow, uHigh, uContour, uLime; uniform float uSel; uniform vec2 uSelUV;
  varying float vE, vSh, vAO; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vK;
  float iso(float v, float w){ float f = abs(fract(v-.5)-.5)/max(fwidth(v),1e-4); return 1.-min(f/w,1.); }
  void main(){
    if (uUseMask > .5) {                                  // a streamed sharp tile covers this square
      vec2 t = uGrid.xy + vec2(vUv.x, 1. - vUv.y) * uGrid.zw; vec2 c = (floor(t) - uMaskInfo.xy + .5) / uMaskInfo.zw;
      if (c.x > 0. && c.x < 1. && c.y > 0. && c.y < 1. && texture2D(uMask, c).r > .5) discard;
    }
    // the close-up terrain patch covers this ground
    if (uDetOn > .5 && vW.x > uDetRect.x && vW.x < uDetRect.z && vW.z > uDetRect.y && vW.z < uDetRect.w) discard;
    vec3 n = normalize(vN); float diff = max(dot(n, uSun), 0.);
    vec3 sat = texture2D(uSat, vec2(vUv.x, 1. - vUv.y)).rgb;
    if (uDetail > .5) {
      vec2 b = mix(uRect.xy, uRect.zw, vUv); vec3 bs = texture2D(uBase, vec2(b.x, 1. - b.y)).rgb;
      sat = mix(bs, sat, vK * smoothstep(-3., 4., vE));   // water keeps the island's tone so the tiles never show as squares at sea
    }
    // close-up aerial photo patch (sub-metre), feathered into the satellite colour around its edge
    float hm = 0.;
    if (uHiK > .001) {
      vec2 hp = ((vW.xz - uMapMin) / uMapSize - uHiRect.xy) / uHiRect.zw;
      if (hp.x > 0. && hp.x < 1. && hp.y > 0. && hp.y < 1.) {
        vec4 hi = texture2D(uHi, hp); vec2 e = min(hp, 1. - hp);
        float soft = texture2D(uHi, hp, 4.5).a;              // a blurred mip of the alpha feathers the edge of any tile still missing
        hm = hi.a * smoothstep(.5, .97, soft) * uHiK * smoothstep(0., .07, min(e.x, e.y)); sat = mix(sat, hi.rgb, hm);
      }
    }
    // satellite colour → surface colour: lift the flat, hazy Sentinel greens into tropical ones (aerial photos need less)
    float l = dot(sat, vec3(.2126, .7152, .0722));
    vec3 alb = mix(vec3(l), sat, 1.12 - hm * .07);
    alb *= vec3(1.04, 1., .9);                                                 // warmer, less neon
    // sunlight (with baked terrain shadow and moving cloud shadow) + sky light (with ambient occlusion)
    float sh = vSh;
    if (vE > -5.) { vec2 cp = vW.xz + sunShift(uCloudY - vW.y); sh *= 1. - .6 * cloudAt(cp); }
    vec3 skyAmb = mix(uGround, uZenith * 1.2 + uHorizon * .3, n.y * .5 + .5);
    vec3 lit = alb * (uSunCol * diff * sh * 1.45 + skyAmb * .85 * vAO);
    vec3 relief = vE > 0. ? mix(uLow, uHigh, smoothstep(0., 2300., vE)) * (0.45 + 0.75 * diff * (0.35 + 0.65 * vSh)) : mix(vec3(.12,.42,.40), vec3(.03,.13,.14), smoothstep(0., 2200., -vE));
    if (vE > 0.) relief = mix(relief, uContour, max(iso(vE/100.,1.)*.25, iso(vE/500.,1.3)*.6));
    else relief = mix(relief, vec3(.5,.75,.6), iso(-vE/250.,1.)*.25);
    vec3 col = mix(mix(relief, lit, uHasSat), relief, uStyle);
    col = mix(aerial(col, vW), col, uStyle * .7);
    gl_FragColor = vec4(col, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const seaVert = /* glsl */`
  varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const seaFrag = /* glsl */`
  precision highp float;
  ${ATMOS}
  uniform float uStyle; uniform vec3 uDeep, uShallow; uniform sampler2D uDepth;
  varying vec3 vW;
  void main(){
    // Inside the map the real satellite water (on the land mesh) shows through; this layer adds sky reflection and
    // sun glitter, and becomes open ocean beyond the map edge.
    vec2 m = (vW.xz - uMapMin) / uMapSize;
    float inside = step(0., m.x) * step(m.x, 1.) * step(0., m.y) * step(m.y, 1.);
    vec2 em = min(m, 1. - m); float edge = inside * smoothstep(0., .1, min(em.x, em.y));
    vec2 p = mod(vW.xz, 64.) * 5.; float t = uTime * .35;
    float h1 = noise(p + vec2(t, t * .7)), h2 = noise(p * 2.3 - vec2(t * .8, t * 1.3)), h3 = noise(p * 6.1 + vec2(t * 1.7, -t));
    // ripples flatten with distance (as a real sea does once the waves are smaller than a pixel): no shimmer or blocks
    vec3 vv = normalize(cameraPosition - vW); float dist0 = length(vW - cameraPosition), amp = smoothstep(.04, .35, vv.y) / (1. + dist0 * dist0 * 5.);
    vec3 n = normalize(vec3(((h1 - .5) * .35 + (h2 - .5) * .2 + (h3 - .5) * .1) * amp, 1., ((h2 - .5) * .35 + (h3 - .5) * .12) * amp));
    vec3 v = normalize(cameraPosition - vW); vec3 r = reflect(-v, n); r.y = abs(r.y);
    float fres = .02 + .98 * pow(1. - max(dot(n, v), 0.), 5.);
    float glint = (pow(max(dot(r, uSun), 0.), 700.) * 3. + pow(max(dot(r, uSun), 0.), 60.) * .25) * (1. - uStyle);
    float shade = 1. - .5 * cloudAt(vW.xz + sunShift(uCloudY));
    vec3 refl = skyCol(r) * .82;
    // real bathymetry (heightmap G channel, sqrt-encoded): turquoise over shelves, ink-blue over the deep
    vec4 dm = texture2D(uDepth, clamp(m, 0., 1.)); float depth = mix(3000., dm.g * dm.g * 3000., edge); // fades to open ocean towards the map edge: no straight line through the shallows
    vec3 body = mix(uShallow, uDeep, smoothstep(2., 45., depth));   // only the shelf: 8-bit depth would band over the open ocean
    vec3 deep = body * (.55 + .45 * shade) * (skyCol(vec3(0., 1., 0.)) * .9 + .25);
    vec3 col = mix(deep, refl, fres) + uSunCol * glint * shade;
    // deep water is drawn here everywhere (no seam at the map edge); the shallows let the satellite's reefs and lagoons through
    float see = edge * (1. - smoothstep(3., 28., depth));
    float a = mix(1., clamp(fres * .85 + glint * shade, 0., 1.), see);
    col = aerial(col, vW);
    float far = 1. - exp(-max(0., length(vW - cameraPosition) - uHaze.x) * uHaze.y); a = mix(a, 1., far);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const skyFrag = /* glsl */`
  ${ATMOS}
  varying vec3 vP;
  void main(){ vec3 d = normalize(vP); vec3 c = skyCol(d);
    float mu = dot(d, uSun); c += uSunCol * smoothstep(.9994, .9998, mu) * 8. * smoothstep(-.004, .004, d.y); // the sun's disc, gone below the horizon
    gl_FragColor = vec4(c, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const cloudVert = /* glsl */`
  varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const cloudFrag = /* glsl */`
  precision highp float;
  ${ATMOS}
  varying vec3 vW;
  void main(){
    float c = cloudAt(vW.xz); if (c < .01) discard;
    // light: thinner towards the sun = brighter rim; thick cores and undersides go blue-grey
    float toward = cloudAt(vW.xz + uSun.xz * .07);
    float light = exp(-toward * 1.6);
    bool below = cameraPosition.y < uCloudY;
    float amb = clamp(dot(uZenith, vec3(.3, .6, .1)) / .167, .22, 1.);        // the sky's own light: dims at blue hour
    vec3 sc = uSunCol / max(uSunCol.r, 1e-3) * min(uSunCol.r * 1.15, 1.25);   // the sun's hue at a capped strength: peach at sunset, not clipped white
    vec3 col = mix(vec3(.55, .6, .66) * amb, sc + vec3(.1) * amb, below ? light * .55 : light);
    col = mix(col, skyCol(vec3(0., 1., 0.)), .12);
    float a = c * .9 * smoothstep(.03, .3, abs(cameraPosition.y - uCloudY));
    col = aerial(col, vW);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const routeFrag = /* glsl */`
  uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
  void main(){ float dash = step(.45, fract(vUv.x * 60. - uTime * 1.5)); gl_FragColor = vec4(uColor * (.75 + .5 * dash), .95);
  #include <colorspace_fragment>
  }`;

export async function createWorld({ container, places, month = 1, hour = 15.5, lowPower = false, onProgress }) {
  aimSun(sunAt(month, hour).dir); // before anything is baked
  // ---------- load (with real byte progress for the preloader) ----------
  const prog = { h: 0, s: 0 }; const report = () => onProgress?.(Math.min(1, prog.h * 0.25 + prog.s * 0.75));
  const satURL = lowPower ? `${import.meta.env.BASE_URL}terrain/satellite-sm.webp` : `${import.meta.env.BASE_URL}terrain/satellite.webp`;
  const [hBlob, sBlob] = await Promise.all([
    fetchProgress(`${import.meta.env.BASE_URL}terrain/height.png`, (g, t) => { prog.h = t ? g / t : 0.5; report(); }),
    fetchProgress(satURL, (g, t) => { prog.s = t ? g / t : 0.5; report(); }).catch(() => null),
  ]);
  const hBitmap = await createImageBitmap(hBlob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); const hm = readHeights(hBitmap);
  const satBitmap = sBlob ? await createImageBitmap(sBlob).catch(() => null) : null;

  // ---------- renderer ----------
  const canvas = document.createElement('canvas'); canvas.className = 'world-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  let dpr = Math.min(devicePixelRatio || 1, lowPower ? 1.25 : 1.75); renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.5;
  container.prepend(canvas);
  const scene = new THREE.Scene();
  scene.fog = null;
  const camera = new THREE.PerspectiveCamera(36, 1, 0.04, 400);

  // the shared atmosphere every shader reads (see ATMOS)
  const atmU = {
    uSun: { value: SUN }, uSunCol: { value: new THREE.Color(C.sunCol).multiplyScalar(1.1) }, uZenith: { value: new THREE.Color(C.zenith) },
    uHorizon: { value: new THREE.Color(C.horizon) }, uGround: { value: new THREE.Color(C.ground) }, uCloudW: { value: new THREE.Vector3(...WEATHER[month]) },
    uClear: { value: new THREE.Vector3() }, uTime: { value: 0 }, uCloudY: { value: 1.3 }, uMapMin: { value: new THREE.Vector2(-W / 2, -H / 2) },
    uMapSize: { value: new THREE.Vector2(W, H) }, uHaze: { value: new THREE.Vector2(20, 0.02) }, uGlow: { value: 0 },
  };
  renderer.toneMappingExposure = lightFor(Math.asin(SUN.y), atmU);

  // sky dome (follows the camera so the horizon is always at infinity)
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fragmentShader: skyFrag, uniforms: atmU,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  }));
  sky.frustumCulled = false; scene.add(sky);

  // ---------- streamed tile grid (Web Mercator z11 squares, see scripts/tiles.mjs) ----------
  const TZ = 11, TB = TERRAIN.bounds;
  const lon2x = (lon) => ((lon + 180) / 360) * 2 ** TZ;
  const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** TZ; };
  const gx0 = lon2x(TB.west), gx1 = lon2x(TB.east), gy0 = lat2y(TB.north), gy1 = lat2y(TB.south);
  const MX = Math.floor(gx0), MY = Math.floor(gy0), MW = Math.floor(gx1) - MX + 1, MH = Math.floor(gy1) - MY + 1;
  const maskData = new Uint8Array(MW * MH * 4);
  const maskTex = new THREE.DataTexture(maskData, MW, MH); maskTex.magFilter = maskTex.minFilter = THREE.NearestFilter; maskTex.needsUpdate = true;

  // ---------- land ----------
  const segX = lowPower ? 180 : 360, segY = Math.round(segX * ASPECT);
  const geo = new THREE.PlaneGeometry(W, H, segX, segY); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv, elev = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) { const e = sampleH(hm, uv.getX(i), 1 - uv.getY(i)); elev[i] = e; pos.setY(i, e > 0 ? 0.002 + e * VSCALE : Math.max(-0.012, e * 0.000004)); }
  geo.setAttribute('elev', new THREE.BufferAttribute(elev, 1)); geo.computeVertexNormals();
  const baseY = (x, z) => { const e = sampleH(hm, x / W + 0.5, z / H + 0.5); return e > 0 ? 0.002 + e * VSCALE : 0; };
  { const sh = new Float32Array(pos.count), ao = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) { const [a, b] = bakeLight(pos.getX(i), pos.getZ(i), Math.max(0, pos.getY(i)), baseY); sh[i] = a; ao[i] = b; }
    geo.setAttribute('shade', new THREE.BufferAttribute(sh, 1)); geo.setAttribute('ao', new THREE.BufferAttribute(ao, 1)); }
  const satTex = satBitmap ? new THREE.Texture(satBitmap) : new THREE.Texture();
  if (satBitmap) { satTex.colorSpace = THREE.SRGBColorSpace; satTex.anisotropy = renderer.capabilities.getMaxAnisotropy(); satTex.flipY = false; satTex.needsUpdate = true; }
  // close-up aerial photo patch: N×N web-mercator tiles drawn into one canvas (see "close-up aerial imagery" below)
  const HN = lowPower ? 4 : 8, HPX = 256;
  const hiCan = document.createElement('canvas'); hiCan.width = hiCan.height = HN * HPX;
  const hiTex = new THREE.CanvasTexture(hiCan); hiTex.colorSpace = THREE.SRGBColorSpace; hiTex.flipY = false; hiTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const landU = {
    ...atmU, uHi: { value: hiTex }, uHiRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uHiK: { value: 0 }, uSat: { value: satTex }, uHasSat: { value: satBitmap ? 1 : 0 }, uStyle: { value: 0 },
    uLow: { value: new THREE.Color(C.reliefLow) }, uHigh: { value: new THREE.Color(C.reliefHigh) }, uContour: { value: new THREE.Color(C.contour) },
    uBase: { value: null }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uDetail: { value: 0 },
    uMask: { value: maskTex }, uUseMask: { value: 1 }, uGrid: { value: new THREE.Vector4(gx0, gy0, gx1 - gx0, gy1 - gy0) },
    uMaskInfo: { value: new THREE.Vector4(MX, MY, MW, MH) }, uFocus: { value: new THREE.Vector3(0, 0, 0) },
    uLime: { value: new THREE.Color(C.lime) }, uSel: { value: 0 }, uSelUV: { value: new THREE.Vector2(-1, -1) },
    uDetRect: { value: new THREE.Vector4() }, uDetOn: { value: 0 }, uVex: { value: 1 },
  };
  landU.uBase.value = satTex;
  const land = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: landVert, fragmentShader: landFrag, uniforms: landU }));
  scene.add(land);

  // ---------- ocean (depth from the same heightmap's G channel) ----------
  const depthTex = new THREE.Texture(hBitmap); depthTex.flipY = false; depthTex.colorSpace = THREE.NoColorSpace; depthTex.needsUpdate = true;
  const seaU = { ...atmU, uStyle: { value: 0 }, uDeep: { value: new THREE.Color(C.deep) }, uShallow: { value: new THREE.Color(C.shallow) }, uDepth: { value: depthTex } };
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShaderMaterial({ vertexShader: seaVert, fragmentShader: seaFrag, uniforms: seaU, transparent: true, depthWrite: false }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = 0.001; scene.add(sea);

  // ---------- clouds: one layer of drifting cumulus, thicker over whichever coast has its monsoon ----------
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.ShaderMaterial({ vertexShader: cloudVert, fragmentShader: cloudFrag, uniforms: atmU, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  clouds.rotation.x = -Math.PI / 2; clouds.position.y = atmU.uCloudY.value; clouds.renderOrder = 2; clouds.frustumCulled = false; scene.add(clouds);
  const weightTarget = new THREE.Vector3(...WEATHER[month]); let liveW = null;

  // ---------- pins ----------
  const tiles = new Map(); // key "x_y" → { x, y, u0, u1, v0, v1, state, dem, mesh, in }
  const focus = landU.uFocus.value;
  const tileKey = (u, v) => `${Math.floor(gx0 + u * (gx1 - gx0))}_${Math.floor(gy0 + v * (gy1 - gy0))}`;
  // terrarium tile is 514 px: the 512 px square plus a 1 px border, so neighbours sample identical edge heights
  const sampleTile = (t, u, v) => {
    const d = t.dem, x = Math.min(512.999, Math.max(0, ((u - t.u0) / (t.u1 - t.u0)) * 512 + 0.5)), y = Math.min(512.999, Math.max(0, ((v - t.v0) / (t.v1 - t.v0)) * 512 + 0.5));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * 514 + x0;
    return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + 514] * (1 - fx) + d[i + 515] * fx) * fy;
  };
  const tileK = (t, x, z) => t.in * (1 - THREE.MathUtils.smoothstep(Math.hypot(x - focus.x, z - focus.y), focus.z * 0.7, focus.z * 0.95));
  const det = { cur: null, building: false, leaving: false, want: '', wantT: 0, job: 0, fails: 0, netOff: false, builds: 0, ms: 0, src: '' }; // close-up terrain patch
  const tileElev = (u, v) => { const t = tiles.get(tileKey(u, v)); return t?.state === 'ready' ? sampleTile(t, u, v) : sampleH(hm, u, v); };
  const elevAt = (u, v) => { if (det.cur) { const e = patchAt(det.cur, (u - 0.5) * W, (v - 0.5) * H, true); if (e === e) return e; } return tileElev(u, v); };
  const yOf = (e) => (e > 0 ? 0.002 + e * VSCALE : 0);
  const vexY = (y) => (y > 0.002 ? 0.002 + (y - 0.002) * landU.uVex.value : y); // as the shaders draw it
  const heightAt = (u, v) => vexY(heightRaw(u, v));
  const heightRaw = (u, v) => {
    if (det.cur) { const y = patchAt(det.cur, (u - 0.5) * W, (v - 0.5) * H); if (y === y) return Math.max(0, y); }
    const yb = yOf(sampleH(hm, u, v)); const t = tiles.get(tileKey(u, v)); if (t?.state !== 'ready') return yb;
    const k = tileK(t, (u - 0.5) * W, (v - 0.5) * H); return k > 0 ? yb + (yOf(sampleTile(t, u, v)) - yb) * k : yb;
  };
  const ids = Object.keys(places); const pinPos = {};
  const stickGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.14, 6); stickGeo.translate(0, 0.07, 0);
  const sticks = new THREE.InstancedMesh(stickGeo, new THREE.MeshBasicMaterial({ color: C.cream, toneMapped: false }), ids.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), ids.length);
  const m4 = new THREE.Matrix4();
  const reseat = () => ids.forEach((id) => { pinPos[id].y = heightAt(places[id].u, places[id].v); });
  ids.forEach((id, i) => { const p = places[id]; const v = toWorld(p.u, p.v); v.y = heightAt(p.u, p.v); pinPos[id] = v;
    m4.makeTranslation(v.x, v.y, v.z); sticks.setMatrixAt(i, m4); m4.makeTranslation(v.x, v.y + 0.19, v.z); heads.setMatrixAt(i, m4); });
  scene.add(sticks, heads);
  const cOn = new THREE.Color(C.lime), cOff = new THREE.Color(0x8c8c8c), cSel = new THREE.Color(0xffffff);
  let selected = null, filterSet = null;
  let pinK = 1;
  function paintPins() {
    ids.forEach((id, i) => {
      const vis = !filterSet || filterSet.has(id);
      heads.setColorAt(i, id === selected ? cSel : !vis ? cOff : places[id].months.includes(currentMonth) ? cOn : cOff);
      const s = (id === selected ? 1.5 : vis ? 1 : 0.55) * pinK; const v = pinPos[id];
      m4.makeScale(s, s, s).setPosition(v.x, v.y + 0.145 * pinK, v.z); heads.setMatrixAt(i, m4);
      m4.makeScale(pinK, pinK, pinK).setPosition(v.x, v.y, v.z); sticks.setMatrixAt(i, m4);
    });
    heads.instanceColor.needsUpdate = true; heads.instanceMatrix.needsUpdate = true; sticks.instanceMatrix.needsUpdate = true;
  }
  function rescalePins() { const k = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) / 9, 0.005, 1.6); if (Math.abs(k - pinK) / pinK > 0.04) { pinK = k; paintPins(); } }

  // selection ring: a flat pulsing ring at the chosen pin
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 64), new THREE.MeshBasicMaterial({ color: C.lime, transparent: true, depthWrite: false, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);

  // ---------- route ----------
  let route = null;
  const routeU = { uTime: { value: 0 }, uColor: { value: new THREE.Color(C.lime) } };
  function setRoute(stops) {
    if (route) { scene.remove(route); route.geometry.dispose(); route = null; }
    if (!stops || stops.length < 2) return null;
    const pts = [];
    for (let s = 0; s < stops.length - 1; s++) {
      const a = stops[s], b = stops[s + 1], n = 30;
      for (let k = 0; k < n; k++) { const t = k / n, u = a.u + (b.u - a.u) * t, v = a.v + (b.v - a.v) * t;
        const p = toWorld(u, v); p.y = heightAt(u, v) + 0.035 + Math.sin(t * Math.PI) * 0.12; pts.push(p); }
    }
    const last = stops[stops.length - 1]; const pl = toWorld(last.u, last.v); pl.y = heightAt(last.u, last.v) + 0.035; pts.push(pl);
    const curve = new THREE.CatmullRomCurve3(pts);
    route = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 2, 0.012, 6, false),
      new THREE.ShaderMaterial({ uniforms: routeU, fragmentShader: routeFrag, transparent: true,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }' }));
    route.userData.vex = landU.uVex.value; scene.add(route); return curve;
  }

  // ---------- controls ----------
  const controls = new MapControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, minDistance: 0.05, maxDistance: 34, maxPolarAngle: 1.32, zoomSpeed: 1.1, rotateSpeed: 0.6 });
  camera.position.set(2.5, 16, 14); controls.target.set(0.4, 0, 0.6); controls.update();
  const clampTarget = () => { controls.target.x = THREE.MathUtils.clamp(controls.target.x, -W * 0.6, W * 0.6); controls.target.z = THREE.MathUtils.clamp(controls.target.z, -H * 0.6, H * 0.6);
    const tu = toUV(controls.target.x, controls.target.z); const gy = tu.u >= 0 && tu.u <= 1 && tu.v >= 0 && tu.v <= 1 ? heightAt(tu.u, tu.v) : 0;
    controls.target.y += (gy - controls.target.y) * 0.15; };

  // scripted flights: interpolate target + spherical offset with an ease; any user input cancels
  let flight = null;
  const sph = new THREE.Spherical();
  function flyTo({ target, distance, polar = 0.9, azimuth, duration = 2.2 }) {
    sph.setFromVector3(camera.position.clone().sub(controls.target));
    const from = { t: controls.target.clone(), r: sph.radius, p: sph.phi, a: sph.theta };
    let a1 = azimuth ?? sph.theta; while (a1 - from.a > Math.PI) a1 -= Math.PI * 2; while (a1 - from.a < -Math.PI) a1 += Math.PI * 2;
    const to = { t: target.clone(), r: distance ?? sph.radius, p: polar, a: a1 };
    return new Promise((res) => { flight = { from, to, t0: performance.now(), dur: duration * 1000, res, arc: from.t.distanceTo(to.t) > 2 ? 0.35 : 0 }; });
  }
  const cancelFlight = () => { if (flight) { flight.res(false); flight = null; } };
  canvas.addEventListener('pointerdown', cancelFlight); canvas.addEventListener('wheel', cancelFlight, { passive: true });
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  function stepFlight(now) {
    const f = flight, k = Math.min(1, (now - f.t0) / f.dur), e = ease(k);
    controls.target.lerpVectors(f.from.t, f.to.t, e);
    const r = f.from.r + (f.to.r - f.from.r) * e + Math.sin(k * Math.PI) * f.arc * f.from.t.distanceTo(f.to.t) * 2;
    sph.set(r, f.from.p + (f.to.p - f.from.p) * e, f.from.a + (f.to.a - f.from.a) * e);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
    camera.lookAt(controls.target);
    if (k >= 1) { flight = null; f.res(true); }
  }

  // ---------- picking without raycasting the mesh: ray-march the heightfield ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function groundAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect(); ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); const o = ray.ray.origin, d = ray.ray.direction; if (d.y >= -1e-4) return null;
    let y = 0; let p;
    for (let i = 0; i < 6; i++) { const t = (y - o.y) / d.y; p = o.clone().addScaledVector(d, t); const { u, v } = toUV(p.x, p.z); y = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? heightAt(u, v) : 0; }
    const { u, v } = toUV(p.x, p.z); if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const B = TERRAIN.bounds; const lon = B.west + u * (B.east - B.west);
    const my = (lat) => { const q = (lat * Math.PI) / 180; return Math.log(Math.tan(q) + 1 / Math.cos(q)); };
    const yN = my(B.north), yS = my(B.south), merc = yN + (yS - yN) * v, lat = (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
    return { lat, lon, elev: elevAt(u, v), point: p };
  }
  const tmpV = new THREE.Vector3();
  function screenOf(id, out = tmpV) { out.copy(pinPos[id]); out.y += 0.17 * pinK; out.project(camera); return out; }

  // ---------- loop ----------
  let vexStill = 0;
  const clock = new THREE.Clock(); let running = false, frames = 0, slow = 0, currentMonth = month;
  const listeners = new Set();
  function resize() { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < 760 ? 48 : 36; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  function frame(now) {
    if (!running) return; requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    if (flight) stepFlight(now); else { controls.update(); clampTarget(); }
    { // relief scale: heights read at 3.5× over the whole island, easing to ~1.7× at the closest zoom, where the aerial
      // photos would otherwise smear down cliffs that aren't there. Shadows re-bake for the new scale once it settles.
      const cd = camera.position.distanceTo(controls.target), u = landU.uVex;
      const t = THREE.MathUtils.smoothstep(Math.log(cd), Math.log(0.08), Math.log(2.5)), want = (1.7 + 1.8 * t) / 3.5;
      if (Math.abs(want - u.value) > 2e-4) { u.value += (want - u.value) * Math.min(1, dt * 6); reseat(); paintPins(); vexStill = 0; }
      else u.value = want;
      if (route) route.scale.y = u.value / route.userData.vex;
      if (Math.abs(BVEX - u.value) > u.value * 0.08 && (vexStill += dt) > 0.6) { BVEX = u.value; vexStill = 0; runBake(); }
    }
    { // never inside a hill: close up, steep ground can rise between the camera and what it looks at
      const cu = toUV(camera.position.x, camera.position.z);
      if (cu.u >= 0 && cu.u <= 1 && cu.v >= 0 && cu.v <= 1) {
        const floor = heightAt(cu.u, cu.v) + Math.max(0.003, camera.position.distanceTo(controls.target) * 0.1);
        if (camera.position.y < floor) { camera.position.y = floor; camera.lookAt(controls.target); }
      }
    }
    atmU.uTime.value = t; routeU.uTime.value = t;
    atmU.uCloudW.value.lerp(weightTarget, 1 - Math.pow(0.97, dt * 60));
    { // haze thickens as you get lower; clouds part over what you are looking at once you zoom in
      const cd = camera.position.distanceTo(controls.target), ch = Math.max(0.05, camera.position.y);
      const nz = THREE.MathUtils.clamp(cd * 0.04, 0.002, 0.04); // near plane follows you down for close-ups
      if (Math.abs(nz - camera.near) > camera.near * 0.15) { camera.near = nz; camera.updateProjectionMatrix(); }
      atmU.uHaze.value.set(cd * 1.1, 0.3 / (ch + 1.1));
      atmU.uClear.value.set(controls.target.x, controls.target.z, camera.position.y > atmU.uCloudY.value ? cd * 0.45 * (1 - THREE.MathUtils.smoothstep(cd, 5, 8)) : 0);
      sky.position.copy(camera.position); clouds.position.x = camera.position.x; clouds.position.z = camera.position.z;
    }
    if (selected) { const v = pinPos[selected], k = (t * 0.8) % 1; ring.visible = true; ring.position.set(v.x, v.y + 0.01, v.z); ring.scale.setScalar(pinK * (1 + k * 1.6)); ring.material.opacity = 1 - k; } else ring.visible = false;
    rescalePins();
    renderer.render(scene, camera);
    listeners.forEach((f) => f(dt));
    frames++; if (dt > 0.028) slow++;
    if (frames === 120) { if (slow > 60 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); } frames = 0; slow = 0; }
  }
  const start = () => { if (running || document.hidden) return; running = true; clock.getDelta(); requestAnimationFrame(frame); };
  const stop = () => { running = false; };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); api.onLost?.(); }, { once: true });
  currentMonth = month; paintPins(); start();

  let styleTarget = 0;
  onFrame(() => { landU.uStyle.value += (styleTarget - landU.uStyle.value) * 0.08; seaU.uStyle.value = landU.uStyle.value; });
  function onFrame(f) { listeners.add(f); return () => listeners.delete(f); }

  // ---------- streaming: keep the sharp tiles around wherever the camera looks ----------
  const MAX_TILES = lowPower ? 9 : 25, SEG = lowPower ? 96 : 160, SKIRT = 0.03;
  let avail = null; const failed = new Set(), waiters = new Map(); let inflight = 0;
  const indexReady = fetch(`${import.meta.env.BASE_URL}tiles/index.json`).then((r) => r.json()).then((j) => { avail = new Set(j.tiles); }).catch(() => { avail = new Set(); });
  const setMask = (t, on) => { maskData[((t.y - MY) * MW + (t.x - MX)) * 4] = on ? 255 : 0; maskTex.needsUpdate = true; };
  const yV = (e) => (e > 0 ? 0.002 + e * VSCALE : Math.max(-0.012, e * 0.000004)); // same as the island mesh

  function buildTile(t, img) {
    const n = SEG + 1, ring = 4 * SEG, count = n * n + ring;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uvs = new Float32Array(count * 2), el = new Float32Array(count), by = new Float32Array(count);
    const Y = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, s = i / SEG, r = j / SEG, u = t.u0 + s * (t.u1 - t.u0), v = t.v0 + r * (t.v1 - t.v0);
      const e = sampleTile(t, u, v); Y[k] = yV(e);
      pos.set([(u - 0.5) * W, Y[k], (v - 0.5) * H], k * 3); uvs.set([s, 1 - r], k * 2); el[k] = e; by[k] = yV(sampleH(hm, u, v));
    }
    const dx = ((t.u1 - t.u0) * W) / SEG, dz = ((t.v1 - t.v0) * H) / SEG;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const at = (a, b) => Y[Math.min(SEG, Math.max(0, b)) * n + Math.min(SEG, Math.max(0, a))];
      const nx = -(at(i + 1, j) - at(i - 1, j)) / (2 * dx), nz = -(at(i, j + 1) - at(i, j - 1)) / (2 * dz), l = Math.hypot(nx, 1, nz);
      nor.set([nx / l, 1 / l, nz / l], (j * n + i) * 3);
    }
    // skirt: a short wall hanging under the tile's rim hides any gap where it meets the coarser island
    const rim = [];
    for (let i = 0; i < SEG; i++) rim.push(i);
    for (let j = 0; j < SEG; j++) rim.push(j * n + SEG);
    for (let i = SEG; i > 0; i--) rim.push(SEG * n + i);
    for (let j = SEG; j > 0; j--) rim.push(j * n);
    const idx = [];
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
    rim.forEach((src, q) => {
      const k = n * n + q; pos.set([pos[src * 3], pos[src * 3 + 1] - SKIRT, pos[src * 3 + 2]], k * 3); nor.set(nor.subarray(src * 3, src * 3 + 3), k * 3);
      uvs.set(uvs.subarray(src * 2, src * 2 + 2), k * 2); el[k] = el[src]; by[k] = by[src] - SKIRT;
      const nextSrc = rim[(q + 1) % ring], nextK = n * n + (q + 1) % ring; idx.push(src, k, nextSrc, nextSrc, k, nextK);
    });
    // baked light for the tile: its own heights inside, the island's outside
    const sh = new Float32Array(count), ao = new Float32Array(count);
    const hy = (x, z) => { const u = x / W + 0.5, v = z / H + 0.5; return yOf(u >= t.u0 && u <= t.u1 && v >= t.v0 && v <= t.v1 ? sampleTile(t, u, v) : sampleH(hm, u, v)); };
    for (let k = 0; k < n * n; k++) { const [a, b] = bakeLight(pos[k * 3], pos[k * 3 + 2], Math.max(0, pos[k * 3 + 1]), hy); sh[k] = a; ao[k] = b; }
    rim.forEach((src, q) => { sh[n * n + q] = sh[src]; ao[n * n + q] = ao[src]; });
    t.hy = hy; t.nn = n * n; t.rim = rim; // kept for re-baking shadows when the hour changes
    const g = new THREE.BufferGeometry();
    g.setAttribute('shade', new THREE.BufferAttribute(sh, 1)); g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); g.setAttribute('elev', new THREE.BufferAttribute(el, 1)); g.setAttribute('by', new THREE.BufferAttribute(by, 1));
    g.setIndex(idx); g.computeBoundingSphere();
    const tex = new THREE.Texture(img); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); tex.needsUpdate = true;
    const uni = { ...landU, uSat: { value: tex }, uHasSat: { value: 1 }, uDetail: { value: 1 }, uUseMask: { value: 0 }, uIn: { value: 0 },
      uRect: { value: new THREE.Vector4(t.u0, 1 - t.v1, t.u1, 1 - t.v0) } };
    const mat = new THREE.ShaderMaterial({ vertexShader: tileVert, fragmentShader: landFrag, uniforms: uni, side: THREE.DoubleSide });
    t.mesh = new THREE.Mesh(g, mat); t.mesh.frustumCulled = true; scene.add(t.mesh);
  }

  async function loadTile(key) {
    const [x, y] = key.split('_').map(Number);
    const t = { key, x, y, u0: (x - gx0) / (gx1 - gx0), u1: (x + 1 - gx0) / (gx1 - gx0), v0: (y - gy0) / (gy1 - gy0), v1: (y + 1 - gy0) / (gy1 - gy0), state: 'loading', in: 0 };
    tiles.set(key, t); inflight++;
    try {
      const [img, dem] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}tiles/${key}.webp`).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then((b) => createImageBitmap(b)),
        fetch(`${import.meta.env.BASE_URL}tiles/${key}.png`).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })),
      ]);
      if (tiles.get(key) !== t) { img.close(); dem.close(); return; }
      const c = new OffscreenCanvas(514, 514); const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(dem, 0, 0); dem.close();
      const px = cx.getImageData(0, 0, 514, 514).data; t.dem = new Float32Array(514 * 514);
      for (let i = 0; i < t.dem.length; i++) t.dem[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      buildTile(t, img); t.state = 'ready'; setMask(t, true);
      waiters.get(key)?.forEach((f) => f(true)); waiters.delete(key);
    } catch (e) {
      tiles.delete(key); failed.add(key); waiters.get(key)?.forEach((f) => f(false)); waiters.delete(key);
    } finally { inflight--; }
  }
  function dropTile(t) {
    tiles.delete(t.key); if (!t.mesh) return; setMask(t, false); scene.remove(t.mesh);
    t.mesh.geometry.dispose(); t.mesh.material.uniforms.uSat.value.source.data?.close?.(); t.mesh.material.uniforms.uSat.value.dispose(); t.mesh.material.dispose();
  }

  let tick = 0, lastFocus = '';
  onFrame((dt) => {
    // the fade-in of fresh tiles, every frame
    let fading = false;
    tiles.forEach((t) => { if (t.state === 'ready' && t.in < 1) { t.in = Math.min(1, t.in + dt * 1.6); t.mesh.material.uniforms.uIn.value = t.in; fading = true; } });
    const d = camera.position.distanceTo(controls.target);
    const reach = (dd) => Math.min(dd * 1.3 + 0.5, lowPower ? 1.5 : 2.5);
    focus.set(controls.target.x, controls.target.z, reach(d) * (1 - THREE.MathUtils.smoothstep(d, 2.4, 3.4)));
    if (++tick % 8 || !avail) return;
    const f = `${focus.x.toFixed(2)},${focus.y.toFixed(2)},${focus.z.toFixed(2)}`;
    if (fading || f !== lastFocus) { lastFocus = f; reseat(); paintPins(); }
    // what to have loaded: around the destination while flying in, else around the target
    let c = controls.target, dd = d;
    if (flight && flight.to.r < 3.4) { c = flight.to.t; dd = flight.to.r; }
    const want = [];
    if (dd < 3.4) {
      const R = reach(dd) + 0.5, { u, v } = toUV(c.x, c.z);
      const cx = Math.floor(gx0 + u * (gx1 - gx0)), cy = Math.floor(gy0 + v * (gy1 - gy0));
      for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 5; x <= cx + 5; x++) {
        const key = `${x}_${y}`; if (!avail.has(key) || failed.has(key)) continue;
        const wx = ((x + 0.5 - gx0) / (gx1 - gx0) - 0.5) * W, wz = ((y + 0.5 - gy0) / (gy1 - gy0) - 0.5) * H, dist = Math.hypot(wx - c.x, wz - c.z);
        if (dist < R) want.push({ key, dist });
      }
      want.sort((a, b) => a.dist - b.dist); want.length = Math.min(want.length, MAX_TILES);
    }
    const keep = new Set(want.map((w) => w.key));
    for (const w of want) { if (inflight >= 3) break; if (!tiles.has(w.key)) loadTile(w.key); }
    if (tiles.size > MAX_TILES) {
      const extra = [...tiles.values()].filter((t) => t.state === 'ready' && !keep.has(t.key))
        .map((t) => ({ t, dist: Math.hypot(((t.u0 + t.u1) / 2 - 0.5) * W - c.x, ((t.v0 + t.v1) / 2 - 0.5) * H - c.z) })).sort((a, b) => b.dist - a.dist);
      for (let i = 0, over = tiles.size - MAX_TILES; i < over && i < extra.length; i++) dropTile(extra[i].t);
    }
  });

  // ---------- close-up aerial imagery ----------
  // Below ~25 km up, Sentinel-2 (10–19 m a pixel) turns to mush, so sub-metre aerial photos are streamed into a
  // patch under the point you look at, at the zoom that matches your screen. Everything degrades gracefully:
  // Sentinel-2 is always underneath; the patch fades in tile by tile; it never starts on Save-Data or 2G/3G,
  // waits until the camera settles (no downloads mid-flight), times out slow tiles, and switches itself off for
  // the visit after repeated failures. Production needs VITE_ARCGIS_KEY (an ArcGIS Location Platform key).
  const ESRI = 'Imagery © Esri, Maxar, Earthstar Geographics';
  const HI = (() => {
    const key = import.meta.env.VITE_ARCGIS_KEY;
    if (key) return (z, x, y) => `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false&token=${encodeURIComponent(key)}`;
    if (import.meta.env.DEV) return (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false`;
    return null;
  })();
  const conn = navigator.connection;
  const slowNet = () => !!conn && (conn.saveData || /2g/.test(conn.effectiveType || '')); // Save-Data or 2G: Sentinel-2 only
  const thinNet = () => !!conn && conn.effectiveType === '3g'; // 3G: only the middle of the patch, one zoom less deep
  const SPANX = gx1 - gx0, SPANY = gy1 - gy0;
  const hctx = hiCan.getContext('2d'), hiOld = document.createElement('canvas'); hiOld.width = hiOld.height = HN * HPX;
  const hi = { z: 0, ox: 0, oy: 0, queue: [], active: 0, fails: 0, off: !HI, dirty: false, lastUp: 0, want: '', wantT: 0, got: 0, credit: false };
  const hiCtl = new Set();
  function hiZoom() { // the web-mercator zoom whose pixels match the screen's at the point you look at
    const d = camera.position.distanceTo(controls.target), wpp = (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / canvas.height;
    return 11 + Math.log2(W / (SPANX * 256 * wpp));
  }
  function hiRecentre(z, ox, oy) {
    // carry what is already drawn into the new frame (scaled), so nothing flashes while the new tiles arrive
    const o = hiOld.getContext('2d'); o.clearRect(0, 0, hiOld.width, hiOld.height); o.drawImage(hiCan, 0, 0);
    hctx.clearRect(0, 0, hiCan.width, hiCan.height);
    if (hi.z) { const k = 2 ** (z - hi.z); hctx.drawImage(hiOld, (hi.ox * k - ox) * HPX, (hi.oy * k - oy) * HPX, HN * HPX * k, HN * HPX * k); }
    hi.z = z; hi.ox = ox; hi.oy = oy; hi.dirty = true;
    const s = 2 ** (z - 11);
    landU.uHiRect.value.set((ox / s - gx0) / SPANX, (oy / s - gy0) / SPANY, HN / s / SPANX, HN / s / SPANY);
    hiCtl.forEach((c) => c.abort()); hiCtl.clear();
    const c = (HN - 1) / 2; hi.queue = [];
    const reach = thinNet() ? 2.2 : HN;
    for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) { const d = Math.hypot(i - c, j - c); if (d <= reach) hi.queue.push({ z, x: ox + i, y: oy + j, d }); }
    hi.queue.sort((a, b) => a.d - b.d); // centre first
    hiPump();
  }
  async function hiFetch(z, x, y, signal) {
    const get = (zz, xx, yy) => fetch(HI(zz, xx, yy), { signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'origin' });
    let r = await get(z, x, y);
    if (r.status === 404 && z > 15) { // no photo this deep here: use the quarter of the parent tile, upscaled
      r = await get(z - 1, x >> 1, y >> 1); if (!r.ok) return null;
      return createImageBitmap(await r.blob(), (x & 1) * 128, (y & 1) * 128, 128, 128, { resizeWidth: 256, resizeHeight: 256, resizeQuality: 'high' });
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`imagery ${r.status}`);
    return createImageBitmap(await r.blob());
  }
  function hiPump() {
    while (!hi.off && hi.active < (lowPower ? 3 : 6) && hi.queue.length) {
      const q = hi.queue.shift(); hi.active++;
      const ac = new AbortController(); hiCtl.add(ac); let late = false;
      const timer = setTimeout(() => { late = true; ac.abort(); }, 10000);
      hiFetch(q.z, q.x, q.y, ac.signal).then((bmp) => {
        hi.fails = 0; if (!bmp) return;
        if (q.z === hi.z && q.x >= hi.ox && q.x < hi.ox + HN && q.y >= hi.oy && q.y < hi.oy + HN) {
          const px = (q.x - hi.ox) * HPX, py = (q.y - hi.oy) * HPX; hctx.clearRect(px, py, HPX, HPX); hctx.drawImage(bmp, px, py, HPX, HPX); hi.dirty = true; hi.got++;
        }
        bmp.close?.();
      }).catch(() => {
        if (ac.signal.aborted && !late) return; // re-centred: not a failure
        if (++hi.fails >= 8) { hi.off = true; hi.queue = []; } // the network or the service is struggling: stay on Sentinel-2
      }).finally(() => { clearTimeout(timer); hiCtl.delete(ac); hi.active--; hiPump(); });
    }
  }
  onFrame((dt) => {
    const zf = hiZoom(), on = !hi.off && zf >= 13.7 && !slowNet();
    landU.uHiK.value += ((on && hi.z ? 1 : 0) - landU.uHiK.value) * Math.min(1, dt * 3);
    const show = landU.uHiK.value > 0.05 && hi.got > 0;
    if (show !== hi.credit) { hi.credit = show; api.onCredit?.(show ? ESRI : null); }
    if (hi.dirty && performance.now() - hi.lastUp > (lowPower ? 400 : 200)) { hiTex.needsUpdate = true; hi.dirty = false; hi.lastUp = performance.now(); }
    if (!on || flight) { hi.wantT = 0; return; }
    const z = Math.min(lowPower || thinNet() ? 17 : 18, Math.max(14, Math.round(zf + 0.2) - (thinNet() ? 1 : 0))), s = 2 ** (z - 11), tu = toUV(controls.target.x, controls.target.z);
    const cx = (gx0 + tu.u * SPANX) * s, cy = (gy0 + tu.v * SPANY) * s;
    if (z === hi.z && Math.abs(cx - (hi.ox + HN / 2)) < HN / 4 && Math.abs(cy - (hi.oy + HN / 2)) < HN / 4) { hi.wantT = 0; return; }
    // only move the patch once the view has held still for a moment, so zooming or dragging doesn't waste downloads
    const want = `${z}/${Math.round(cx - HN / 2)}/${Math.round(cy - HN / 2)}`;
    if (want !== hi.want) { hi.want = want; hi.wantT = 0; return; }
    if ((hi.wantT += dt) < 0.3) return;
    hiRecentre(z, Math.round(cx - HN / 2), Math.round(cy - HN / 2)); hi.wantT = 0;
  });

  // ---------- close-up terrain ----------
  // The sharp tiles carry a vertex every ~120 m, so up close hills melt into smooth cones (Sigiriya!). Once you zoom
  // in, a dense patch (a vertex every ~23 m) is laid over the ground you look at, built from the finest open
  // elevation for Sri Lanka: SRTM 1″ (30 m), streamed as AWS Terrain Tiles z13 (19 m a pixel, CORS-open). Its rim is
  // pinned to the coarse surface and it grows out of whatever was shown before, so nothing pops. Fallbacks: offline,
  // Save-Data/2G, slow or failing downloads → the patch is built from the 38 m heights already here (still 3× sharper);
  // downloads that arrive late upgrade it in place. Built in short slices between frames, never mid-flight.
  const DG = lowPower ? 160 : 256, DN = DG + 1, DZ = 13, DSKIRT = 0.01, DPX = 1024, P13 = 2 ** (DZ - TZ) * 256;
  const DEM_URL = (x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${DZ}/${x}/${y}.png`;
  const demCache = new Map(); // "x_y" → Float32Array(256²) | null (no data there); most recent last
  const demCan = new OffscreenCanvas(256, 256), demCtx = demCan.getContext('2d', { willReadFrequently: true });
  const detCans = [0, 1].map(() => { const c = document.createElement('canvas'); c.width = c.height = DPX; return c; }); let detFlip = 0;
  const detVert = /* glsl */`
    attribute float elev, by, shade, ao; uniform float uMorph;
    varying float vE, vSh, vAO; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vK;
    ${VEX}
    void main(){ vE = elev; vSh = shade; vAO = ao; vUv = uv; vK = 1.; vN = vexN(normal);
      vec3 p = position; p.y = vex(mix(by, position.y, uMorph));
      vec4 w = modelMatrix * vec4(p,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

  // height (or elevation in metres) of a built patch at world (x, z) as shown right now; NaN outside it
  function patchAt(p, x, z, metres = false) {
    const s = (x - p.x0) / p.cell, r = (z - p.z0) / p.cell; if (!(s >= 0 && r >= 0 && s <= DG && r <= DG)) return NaN;
    const i = Math.min(DG - 1, s | 0), j = Math.min(DG - 1, r | 0), fx = s - i, fy = r - j;
    const Y = metres ? (q) => p.E[q] : (q) => p.by[q] + (p.Y[q] - p.by[q]) * p.m;
    const a = Y(j * DN + i), b = Y(j * DN + i + 1), c = Y((j + 1) * DN + i), d = Y((j + 1) * DN + i + 1);
    return fx + fy <= 1 ? a + fx * (b - a) + fy * (c - a) : d + (1 - fx) * (c - d) + (1 - fy) * (b - d); // same triangles as the mesh
  }
  // the coarse surface exactly as the tile (or island) mesh draws it
  function coarseY(x, z) {
    const u = x / W + 0.5, v = z / H + 0.5, t = tiles.get(tileKey(u, v));
    if (t?.state === 'ready' && t.mesh) {
      const s = ((u - t.u0) / (t.u1 - t.u0)) * SEG, r = ((v - t.v0) / (t.v1 - t.v0)) * SEG, n = SEG + 1;
      const i = Math.min(SEG - 1, Math.max(0, Math.floor(s))), j = Math.min(SEG - 1, Math.max(0, Math.floor(r))), fx = s - i, fy = r - j;
      const P = t.mesh.geometry.attributes.position.array, B = t.mesh.geometry.attributes.by.array, k = tileK(t, x, z);
      const Y = (q) => B[q] + (P[q * 3 + 1] - B[q]) * k;
      const a = Y(j * n + i), b = Y(j * n + i + 1), c = Y((j + 1) * n + i), d = Y((j + 1) * n + i + 1);
      return fx + fy <= 1 ? a + fx * (b - a) + fy * (c - a) : d + (1 - fx) * (c - d) + (1 - fy) * (b - d);
    }
    return yV(sampleH(hm, u, v));
  }
  const shownY = (x, z) => { if (det.cur) { const y = patchAt(det.cur, x, z); if (y === y) return y; } return coarseY(x, z); };

  async function demTile(x, y) { // Float32Array of metres | null (no data) | undefined (not now: use the fallback)
    const k = `${x}_${y}`;
    if (demCache.has(k)) { const v = demCache.get(k); demCache.delete(k); demCache.set(k, v); return v; }
    if (det.netOff || slowNet() || !navigator.onLine) return undefined;
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(DEM_URL(x, y), { signal: ac.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (r.status === 404 || r.status === 403) { demCache.set(k, null); return null; }
      if (!r.ok) throw new Error(`terrain ${r.status}`);
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      demCtx.clearRect(0, 0, 256, 256); demCtx.drawImage(bmp, 0, 0); bmp.close();
      const px = demCtx.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) e[i] = Math.min(2600, Math.max(-500, px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768)); // Sri Lanka's real range: a bad tile can't spike
      det.fails = 0; demCache.set(k, e);
      while (demCache.size > (lowPower ? 24 : 48)) demCache.delete(demCache.keys().next().value);
      return e;
    } catch { if (++det.fails >= 6) det.netOff = true; return undefined; } // the network is struggling: stay on local heights
    finally { clearTimeout(timer); }
  }
  // z13 elevation at world (x, z) from the downloaded tiles, NaN where one is missing
  function sample13(x, z) {
    const px = (gx0 + (x / W + 0.5) * SPANX) * P13 - 0.5, py = (gy0 + (z / H + 0.5) * SPANY) * P13 - 0.5;
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    const at = (a, b) => { const d = demCache.get(`${a >> 8}_${b >> 8}`); return d ? d[(b & 255) * 256 + (a & 255)] : NaN; };
    return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
  }
  function tileReady(key) {
    if (!avail?.has(key) || failed.has(key)) return Promise.resolve(false);
    const t = tiles.get(key); if (t?.state === 'ready') return Promise.resolve(true);
    if (!t) loadTile(key);
    return new Promise((res) => { if (!waiters.has(key)) waiters.set(key, []); waiters.get(key).push(res); });
  }

  async function startPatch(cx, cz, S) {
    const id = ++det.job, x0 = cx - S / 2, z0 = cz - S / 2, cell = S / DG; det.building = id;
    try {
      // what this patch needs: the sharp tiles under it (colour) and the z13 terrain tiles (shape)
      const u0 = x0 / W + 0.5, v0 = z0 / H + 0.5, u1 = u0 + S / W, v1 = v0 + S / H, keys = new Set();
      for (const u of [u0, (u0 + u1) / 2, u1]) for (const v of [v0, (v0 + v1) / 2, v1]) keys.add(tileKey(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))));
      const tx = (u) => Math.floor((gx0 + u * SPANX) * 2 ** (DZ - TZ)), ty = (v) => Math.floor((gy0 + v * SPANY) * 2 ** (DZ - TZ));
      const jobs = [...keys].map(tileReady);
      for (let y = ty(v0); y <= ty(v1); y++) for (let x = tx(u0); x <= tx(u1); x++) jobs.push(demTile(x, y));
      // build with whatever arrived within a moment; anything later upgrades the patch in place
      const all = Promise.allSettled(jobs); let late = false;
      const got = jobs.map(() => false); jobs.forEach((j, i) => j.then((v) => { got[i] = !!v; }));
      await Promise.race([all, new Promise((r) => setTimeout(() => { late = true; r(); }, 1200))]);
      if (id !== det.job) return;
      const had = got.filter(Boolean).length;
      const p = await buildPatch(id, x0, z0, S, cell);
      if (!p) return; p.had = had;
      // late arrivals upgrade it, but only if something new really came (a struggling network can't loop it)
      if (late) all.then((rs) => { const now = rs.filter((r) => r.value).length; if (now > p.had && det.cur === p) det.upgrade = p; });
      else p.had = Infinity;
    } finally { if (det.building === id) det.building = false; }
  }

  async function buildPatch(id, x0, z0, S, cell) {
    const t0 = performance.now(), nn = DN * DN, ring = 4 * DG, count = nn + ring;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
    const E = new Float32Array(count), by = new Float32Array(count), Y = new Float32Array(nn), sh = new Float32Array(count), ao = new Float32Array(count);
    const p = { x0, z0, cell, S, E, Y, by, m: 0, t: 0, nn, d0: cell * 1.5, bakedFor };
    let from13 = 0;
    const slice = lowPower ? 5 : 8; let tick = performance.now();
    const breathe = async () => { if (performance.now() - tick > slice) { await new Promise((r) => setTimeout(r, 0)); tick = performance.now(); } return id === det.job; };
    // heights: the real z13 terrain, else the local 38 m; the rim fades to the coarse surface it sits in
    const EDGE = 10;
    for (let j = 0; j < DN; j++) {
      for (let i = 0; i < DN; i++) {
        const q = j * DN + i, x = x0 + i * cell, z = z0 + j * cell, u = x / W + 0.5, v = z / H + 0.5;
        let e = sample13(x, z); if (e === e) from13++; else e = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? tileElev(u, v) : -100;
        const c = shownY(x, z), w = THREE.MathUtils.smoothstep(Math.min(i, j, DG - i, DG - j), 0, EDGE);
        E[q] = e; by[q] = c; Y[q] = c + (yV(e) - c) * w;
        pos[q * 3] = x; pos[q * 3 + 1] = Y[q]; pos[q * 3 + 2] = z; uvs[q * 2] = i / DG; uvs[q * 2 + 1] = 1 - j / DG;
      }
      if (!(await breathe())) return null;
    }
    for (let j = 0; j < DN; j++) for (let i = 0; i < DN; i++) {
      const at = (a, b) => Y[Math.min(DG, Math.max(0, b)) * DN + Math.min(DG, Math.max(0, a))];
      const nx = -(at(i + 1, j) - at(i - 1, j)) / (2 * cell), nz = -(at(i, j + 1) - at(i, j - 1)) / (2 * cell), l = Math.hypot(nx, 1, nz);
      const q = (j * DN + i) * 3; nor[q] = nx / l; nor[q + 1] = 1 / l; nor[q + 2] = nz / l;
    }
    // light: shadows marched from a few metres out; occlusion at the patch's own scale on top of the island-scale one
    const pm = { ...p, m: 1 };
    const hy = (x, z) => { const y = patchAt(pm, x, z); if (y === y) return Math.max(0, y); const u = x / W + 0.5, v = z / H + 0.5; return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? yOf(tileElev(u, v)) : 0; };
    const r1 = cell * 3, r2 = cell * 10;
    for (let j = 0; j < DN; j++) {
      for (let i = 0; i < DN; i++) {
        const q = j * DN + i, x = pos[q * 3], z = pos[q * 3 + 2], y0 = Math.max(0, Y[q]);
        let a0 = 0, a1 = 0, a2 = 0;
        for (let a = 0; a < 8; a++) { const c = Math.cos(a * 0.785), sn = Math.sin(a * 0.785); a0 += hy(x + c * 0.02, z + sn * 0.02) + hy(x + c * 0.07, z + sn * 0.07); a1 += hy(x + c * r1, z + sn * r1); a2 += hy(x + c * r2, z + sn * r2); }
        const w = THREE.MathUtils.smoothstep(Math.min(i, j, DG - i, DG - j), 0, EDGE);
        const fine = Y[q] <= 0.002 ? 1 : bakeShadow(x, z, y0, hy, p.d0, 36);
        sh[q] = w < 1 && Y[q] > 0.002 ? bakeShadow(x, z, y0, hy) + (fine - bakeShadow(x, z, y0, hy)) * w : fine;
        ao[q] = Math.max(0.4, Math.min(1.1, 1 - (a0 / 16 - y0) * 7 - ((a1 + a2) / 16 - y0) * 14 * w));
      }
      if (!(await breathe())) return null;
    }
    // skirt: a short wall under the rim hides any hairline where the patch meets the coarser ground
    const rim = [];
    for (let i = 0; i < DG; i++) rim.push(i);
    for (let j = 0; j < DG; j++) rim.push(j * DN + DG);
    for (let i = DG; i > 0; i--) rim.push(DG * DN + i);
    for (let j = DG; j > 0; j--) rim.push(j * DN);
    const idx = new Uint32Array(DG * DG * 6 + ring * 6); let o = 0;
    for (let j = 0; j < DG; j++) for (let i = 0; i < DG; i++) { const a = j * DN + i, b = a + 1, c = a + DN, d = c + 1; idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
    rim.forEach((src, q) => {
      const k = nn + q; pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - DSKIRT; pos[k * 3 + 2] = pos[src * 3 + 2];
      nor.set(nor.subarray(src * 3, src * 3 + 3), k * 3); uvs.set(uvs.subarray(src * 2, src * 2 + 2), k * 2);
      E[k] = E[src]; by[k] = by[src] - DSKIRT; sh[k] = sh[src]; ao[k] = ao[src];
      const nextSrc = rim[(q + 1) % ring], nextK = nn + ((q + 1) % ring); idx[o++] = src; idx[o++] = k; idx[o++] = nextSrc; idx[o++] = nextSrc; idx[o++] = k; idx[o++] = nextK;
    });
    // colour: the island image under the sharp tiles, cropped to the patch
    const can = detCans[(detFlip ^= 1)], cx = can.getContext('2d'); cx.fillStyle = '#0a2731'; cx.fillRect(0, 0, DPX, DPX);
    const k = DPX / S;
    if (satBitmap) cx.drawImage(satBitmap, (x0 + W / 2 - 0) * -k, (z0 + H / 2) * -k, W * k, H * k);
    let sharp = 0;
    tiles.forEach((t) => {
      if (t.state !== 'ready' || !t.mesh) return; const tx0 = (t.u0 - 0.5) * W, tz0 = (t.v0 - 0.5) * H, tw = (t.u1 - t.u0) * W, th = (t.v1 - t.v0) * H;
      if (tx0 > x0 + S || tz0 > z0 + S || tx0 + tw < x0 || tz0 + th < z0) return;
      cx.drawImage(t.mesh.material.uniforms.uSat.value.image, (tx0 - x0) * k, (tz0 - z0) * k, tw * k, th * k); sharp++;
    });
    const tex = new THREE.CanvasTexture(can); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('elev', new THREE.BufferAttribute(E, 1)); g.setAttribute('by', new THREE.BufferAttribute(by, 1));
    g.setAttribute('shade', new THREE.BufferAttribute(sh, 1)); g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
    const uni = { ...landU, uSat: { value: tex }, uHasSat: { value: satBitmap || sharp ? 1 : 0 }, uDetail: { value: 1 }, uUseMask: { value: 0 }, uDetOn: { value: 0 }, uMorph: { value: 0 },
      uRect: { value: new THREE.Vector4(x0 / W + 0.5, 1 - ((z0 + S) / H + 0.5), (x0 + S) / W + 0.5, 1 - (z0 / H + 0.5)) } };
    p.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: detVert, fragmentShader: landFrag, uniforms: uni, side: THREE.DoubleSide }));
    p.hy = hy; p.rim = rim;
    if (id !== det.job) { disposePatch(p); return null; }
    // swap: the new patch starts exactly where the old surface was, then grows into the real shape
    const old = det.cur; det.cur = p; scene.add(p.mesh); if (old) disposePatch(old);
    const e = cell / 8; landU.uDetRect.value.set(x0 + e, z0 + e, x0 + S - e, z0 + S - e); landU.uDetOn.value = 1;
    det.builds++; det.ms = Math.round(performance.now() - t0); det.src = from13 > nn * 0.9 ? 'srtm-30m' : from13 ? 'mixed' : 'local-38m';
    if (bakedFor !== p.bakedFor) runBake(); // the hour moved while it was being built
    return p;
  }
  function disposePatch(p) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.uniforms.uSat.value.dispose(); p.mesh.material.dispose(); }

  onFrame((dt) => {
    const p = det.cur;
    if (p) { // grow in (or melt back out when leaving)
      const t = det.leaving ? Math.max(0, p.t - dt * 1.8) : Math.min(1, p.t + dt * 1.4);
      if (t !== p.t) { p.t = t; p.m = THREE.MathUtils.smoothstep(t, 0, 1); p.mesh.material.uniforms.uMorph.value = p.m; reseat(); paintPins(); }
      if (det.leaving && t === 0) { disposePatch(p); det.cur = null; landU.uDetOn.value = 0; det.leaving = false; reseat(); paintPins(); }
    }
    const d = camera.position.distanceTo(controls.target), c = controls.target;
    const inside = Math.abs(c.x) < W / 2 && Math.abs(c.z) < H / 2;
    if (flight || d > 0.27 || !inside) { if (det.cur && !flight) det.leaving = true; det.wantT = 0; if (flight || d > 0.27) det.job++; return; }
    det.leaving = false;
    const S = d < (det.cur?.S === 0.2 ? 0.14 : 0.11) ? 0.2 : 0.44, cell = S / DG;
    const cx = THREE.MathUtils.clamp(Math.round(c.x / cell) * cell, -W / 2 + S / 2, W / 2 - S / 2), cz = THREE.MathUtils.clamp(Math.round(c.z / cell) * cell, -H / 2 + S / 2, H / 2 - S / 2);
    if (det.upgrade && det.upgrade === det.cur && !det.building) { det.upgrade = null; startPatch(det.cur.x0 + S / 2, det.cur.z0 + S / 2, det.cur.S); return; }
    if (det.cur && det.cur.S === S && Math.abs(cx - (det.cur.x0 + S / 2)) < S * 0.2 && Math.abs(cz - (det.cur.z0 + S / 2)) < S * 0.2) { det.wantT = 0; return; }
    if (det.building) return;
    const want = `${S}/${cx.toFixed(4)}/${cz.toFixed(4)}`;
    if (want !== det.want) { det.want = want; det.wantT = 0; return; }
    if ((det.wantT += dt) < 0.35) return; // wait for the view to settle
    det.wantT = 0; det.want = ''; startPatch(cx, cz, S);
  });

  // ---------- time of day ----------
  // Light and sky follow the slider at once. Terrain shadows are re-marched in the background in short slices between
  // frames, then the island and every tile swap in together, so they always agree (no brighter squares).
  let currentHour = hour, bakeRun = 0; const bakeStats = { ms: 0 };
  function* rebakeJob() {
    const t0 = performance.now();
    const jobs = [...[...tiles.values()].filter((t) => t.state === 'ready').map((t) => ({ g: t.mesh.geometry, hy: t.hy, n: t.nn, rim: t.rim, alive: () => tiles.get(t.key) === t })),
      { g: geo, hy: baseY, n: geo.attributes.position.count }];
    const dp = det.cur; if (dp) jobs.push({ g: dp.mesh.geometry, hy: dp.hy, n: dp.nn, rim: dp.rim, d0: dp.d0, steps: 36, alive: () => det.cur === dp });
    for (const j of jobs) {
      const p = j.g.attributes.position.array; j.out = new Float32Array(j.g.attributes.shade.count);
      for (let k = 0; k < j.n; k++) {
        const y = p[k * 3 + 1]; j.out[k] = y <= 0.002 ? 1 : bakeShadow(p[k * 3], p[k * 3 + 2], y, j.hy, j.d0, j.steps); // sea floor: never sunlit directly
        if ((k & 511) === 511) yield;
      }
      if (j.rim) j.rim.forEach((src, q) => { j.out[j.n + q] = j.out[src]; });
    }
    for (const j of jobs) if (!j.alive || j.alive()) { j.g.attributes.shade.array.set(j.out); j.g.attributes.shade.needsUpdate = true; }
    bakeStats.ms = Math.round(performance.now() - t0);
  }
  function runBake() {
    const id = ++bakeRun, job = rebakeJob();
    const slice = () => {
      if (id !== bakeRun) return; // a newer hour superseded this one
      const t0 = performance.now();
      while (performance.now() - t0 < (lowPower ? 5 : 8)) if (job.next().done) return;
      setTimeout(slice, 0); // yield so frames keep rendering while it works
    };
    setTimeout(slice, 0);
  }
  let bakedFor = `${month}:${hour}`;
  function setHour(h) {
    currentHour = Math.min(19, Math.max(5.5, h));
    const key = `${currentMonth}:${currentHour}`; if (key === bakedFor) return; bakedFor = key;
    aimSun(sunAt(currentMonth, currentHour).dir);
    renderer.toneMappingExposure = lightFor(Math.asin(SUN.y), atmU);
    runBake();
  }

  const api = {
    camera, controls, canvas, pinPos, hasSatellite: !!satBitmap, debug: { land, sea, scene, bakeStats, hi, hiZoom, det },
    flyTo, cancelFlight, groundAt, screenOf, onFrame, setRoute,
    worldOf: (u, v) => { const p = toWorld(u, v); p.y = heightAt(u, v); return p; },
    get flying() { return !!flight; },
    setMonth(m) { currentMonth = m; weightTarget.set(...(liveW || WEATHER[m])); paintPins(); setHour(currentHour); }, // the sun's path changes with the season
    setLiveWeather(w) { liveW = w; weightTarget.set(...(w || WEATHER[currentMonth])); }, // today's cloud cover, or null for the month's climate
    setHour, get hour() { return currentHour; }, sunAt: (h) => sunAt(currentMonth, h),
    select(id) { selected = id; if (id) { const p = places[id]; landU.uSelUV.value.set(p.u, 1 - p.v); } paintPins(); },
    setFilter(set) { filterSet = set; paintPins(); },
    setStyle(s) { styleTarget = s === 'relief' ? 1 : 0; },
    // Make sure the sharp tile under a place is there (it also streams on its own as the camera arrives).
    async loadDetail(id) {
      await indexReady; const p = places[id]; if (!p) return false; const key = tileKey(p.u, p.v);
      if (!avail.has(key) || failed.has(key)) return false;
      const t = tiles.get(key); if (t?.state === 'ready') return true;
      if (!t) loadTile(key);
      return new Promise((res) => { if (!waiters.has(key)) waiters.set(key, []); waiters.get(key).push(res); });
    },
    clearDetail() {},
    home(duration = 2.2) { return flyTo({ target: new THREE.Vector3(0.3, 0, 0.5), distance: 19, polar: 0.72, azimuth: 0.18, duration }); },
    intro() { camera.position.set(0, 70, 8); controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0); return api.home(3.4); },
    pause: stop, resume: start,
    dispose() { stop(); ro.disconnect(); controls.dispose(); renderer.dispose(); canvas.remove(); },
  };
  return api;
}
