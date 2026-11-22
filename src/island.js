// The island in 3D: real elevation data rendered as a printed relief map (sand land, cobalt contours,
// cobalt sea with bathymetry), monsoon clouds that follow the chosen month, and a camera that flies
// region to region as the page scrolls. Loaded only when the device and the visitor want it.
import * as THREE from 'three';
import { TERRAIN, ASPECT } from './geo.js';

const W = 10, H = W * ASPECT;              // world size of the island map
const VSCALE = 0.36 / 2500;                // metres → world units (~3× vertical exaggeration)
const COL = { sand: 0xe6dbc7, ink: 0x062b8a, sea: 0x1747b8, deep: 0x041d5e, night: 0x041d5e };

const toWorld = (u, v) => new THREE.Vector3((u - 0.5) * W, 0, (v - 0.5) * H);

// Which clouds show in which month: [south-west monsoon, north-east monsoon, inter-monsoon storms]
const WEATHER = {
  1: [0, .8, 0], 2: [0, .45, .1], 3: [0, 0, .45], 4: [.15, 0, .7], 5: [.85, 0, .25], 6: [1, 0, 0], 7: [.9, 0, 0],
  8: [.8, 0, 0], 9: [.75, 0, .2], 10: [.2, .3, .9], 11: [0, .9, .5], 12: [0, 1, .15],
};

async function loadHeights(url) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const max = TERRAIN.maxElevation;
  const elev = new Float32Array(img.width * img.height);
  for (let i = 0; i < elev.length; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], land = d[i * 4 + 2] > 127;
    elev[i] = land ? Math.max(4, (r / 255) * max) : -(g / 255) * 3000;
  }
  return { elev, w: img.width, h: img.height };
}

function sample(hm, u, v) {
  const x = Math.min(hm.w - 1.001, Math.max(0, u * (hm.w - 1))), y = Math.min(hm.h - 1.001, Math.max(0, v * (hm.h - 1)));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * hm.w + x0;
  const a = hm.elev[i], b = hm.elev[i + 1], c = hm.elev[i + hm.w], d = hm.elev[i + hm.w + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

const terrainVert = /* glsl */`
  attribute float elev;
  varying float vElev; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  void main() {
    vElev = elev; vUv = uv; vN = normalize(normalMatrix * normal);
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const terrainFrag = /* glsl */`
  precision highp float;
  uniform vec3 uSand, uInk, uSea, uDeep, uNight, uSun; uniform float uFogNear, uFogFar;
  varying float vElev; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  float iso(float v, float w) { float f = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4); return 1.0 - min(f / w, 1.0); }
  void main() {
    float e = vElev; vec3 col;
    if (e > 0.0) {
      vec3 n = normalize(vN);
      float diff = clamp(dot(n, normalize(uSun)), 0.0, 1.0);
      col = uSand * mix(0.62, 1.06, diff);
      col = mix(col, uSand * 0.84, smoothstep(700.0, 2400.0, e) * 0.35);
      col = mix(col, uInk, max(iso(e / 100.0, 1.0) * 0.28, iso(e / 500.0, 1.4) * 0.7));
    } else {
      float d = clamp(-e / 3000.0, 0.0, 1.0);
      col = mix(uSea, uDeep, sqrt(d));
      col = mix(col, uSea * 1.35, iso(-e / 500.0, 1.0) * 0.22);
    }
    float coast = 1.0 - min(abs(e) / max(fwidth(e), 1e-3) / 1.4, 1.0);
    col = mix(col, uInk, coast * 0.95);
    vec2 eu = min(vUv, 1.0 - vUv); float edge = smoothstep(0.0, 0.08, min(eu.x, eu.y));
    if (e <= 0.0) col = mix(uDeep, col, edge);
    float dist = length(vW - cameraPosition);
    col = mix(col, uNight, smoothstep(uFogNear, uFogFar, dist));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const cloudVert = /* glsl */`
  attribute float group; attribute float seed;
  uniform float uTime, uPx; uniform vec3 uWeights; uniform vec2 uWind[3];
  varying float vA;
  void main() {
    float w = group < 0.5 ? uWeights.x : (group < 1.5 ? uWeights.y : uWeights.z);
    vec2 wind = group < 0.5 ? uWind[0] : (group < 1.5 ? uWind[1] : uWind[2]);
    vec3 p = position;
    float t = fract(uTime * 0.012 + seed);
    p.xz += wind * (t - 0.5) * 3.0;
    p.y += sin(uTime * 0.4 + seed * 30.0) * 0.04;
    vA = w * smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.85, t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uPx * (0.9 + seed) * 70.0 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const cloudFrag = /* glsl */`
  precision mediump float; uniform vec3 uColor; varying float vA;
  void main() { vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.15, d) * vA * 0.55; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

export async function createIsland({ stage, pins, places, regions, onPin, onFail, month = 1, lowPower = false }) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, alpha: false, powerPreference: 'high-performance' });
  let dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(COL.night);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.prepend(canvas);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onFail?.('context lost'); }, { once: true });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const hm = await loadHeights(`${import.meta.env.BASE_URL}terrain/height.png`);

  // ---------- terrain mesh ----------
  const segX = lowPower ? 150 : 300, segY = Math.round(segX * ASPECT);
  const geo = new THREE.PlaneGeometry(W, H, segX, segY);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const elev = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const e = sample(hm, uv.getX(i), 1 - uv.getY(i));
    elev[i] = e; pos.setY(i, e > 0 ? e * VSCALE : 0);
  }
  geo.setAttribute('elev', new THREE.BufferAttribute(elev, 1));
  geo.computeVertexNormals();
  const terrainMat = new THREE.ShaderMaterial({
    vertexShader: terrainVert, fragmentShader: terrainFrag,
    uniforms: {
      uSand: { value: new THREE.Color(COL.sand) }, uInk: { value: new THREE.Color(COL.ink) },
      uSea: { value: new THREE.Color(COL.sea) }, uDeep: { value: new THREE.Color(COL.deep) },
      uNight: { value: new THREE.Color(COL.night) }, uSun: { value: new THREE.Vector3(-0.6, 0.7, 0.35) },
      uFogNear: { value: 18 }, uFogFar: { value: 46 },
    },
  });
  scene.add(new THREE.Mesh(geo, terrainMat));
  // ocean skirt so the map never ends in the void
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: COL.deep }));
  skirt.rotation.x = -Math.PI / 2; skirt.position.y = -0.01; scene.add(skirt);

  // ---------- pins ----------
  const heightAt = (u, v) => Math.max(0, sample(hm, u, v)) * VSCALE;
  const pinGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6); pinGeo.translate(0, 0.11, 0);
  const headGeo = new THREE.SphereGeometry(0.034, 12, 8);
  const pinMat = new THREE.MeshBasicMaterial({ color: COL.ink });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const sticks = new THREE.InstancedMesh(pinGeo, pinMat, pins.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, pins.length);
  const m4 = new THREE.Matrix4(), pinPos = [];
  pins.forEach((p, i) => {
    const v = toWorld(p.u, p.v); v.y = heightAt(p.u, p.v); pinPos.push(v.clone());
    m4.makeTranslation(v.x, v.y, v.z); sticks.setMatrixAt(i, m4);
    m4.makeTranslation(v.x, v.y + 0.23, v.z); heads.setMatrixAt(i, m4);
  });
  scene.add(sticks, heads);
  const inSeasonColor = new THREE.Color(COL.sand), offColor = new THREE.Color(0x7d8fbf);
  function paintPins(m) {
    pins.forEach((p, i) => heads.setColorAt(i, places[p.id].months.includes(m) ? inSeasonColor : offColor));
    heads.instanceColor.needsUpdate = true;
  }

  // DOM labels for the current region (crisp text, real links)
  const layer = stage.querySelector('.pins-layer');
  const labels = pins.map((p) => {
    const a = document.createElement('a');
    a.className = 'pin-label'; a.href = `#place-${p.id}`; a.dataset.place = p.id; a.textContent = places[p.id].name;
    a.tabIndex = -1; layer.append(a); return a;
  });

  // ---------- clouds ----------
  const N = lowPower ? 160 : 320, cp = new Float32Array(N * 3), cg = new Float32Array(N), cs = new Float32Array(N);
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < N; i++) {
    const g = i % 3; cg[i] = g; cs[i] = Math.random();
    let u, v;
    if (g === 0) { u = rnd(0.05, 0.55); v = rnd(0.55, 1.0); }          // south-west & hills
    else if (g === 1) { u = rnd(0.35, 1.0); v = rnd(0.0, 0.7); }       // north & east
    else { u = rnd(0.15, 0.9); v = rnd(0.1, 0.95); }                   // inter-monsoon, island-wide
    const w = toWorld(u, v); cp.set([w.x, rnd(0.8, 1.3), w.z], i * 3);
  }
  const cgeo = new THREE.BufferGeometry();
  cgeo.setAttribute('position', new THREE.BufferAttribute(cp, 3));
  cgeo.setAttribute('group', new THREE.BufferAttribute(cg, 1));
  cgeo.setAttribute('seed', new THREE.BufferAttribute(cs, 1));
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uPx: { value: dpr }, uWeights: { value: new THREE.Vector3(...WEATHER[month]) },
      uWind: { value: [new THREE.Vector2(0.7, -0.7), new THREE.Vector2(-0.7, 0.7), new THREE.Vector2(0.2, 0.1)] },
      uColor: { value: new THREE.Color(0xf4efe6) },
    },
  });
  scene.add(new THREE.Points(cgeo, cloudMat));
  const weightTarget = new THREE.Vector3(...WEATHER[month]);

  // ---------- camera poses ----------
  const pose = (target, dist, tilt, az) => ({ target, dist, tilt, az });
  const HERO = pose(new THREE.Vector3(1.5, 0, 0.9), 21, 0.95, -0.35);
  const INTRO = pose(new THREE.Vector3(0, 0, 0), 60, 1.45, 0);
  const keys = regions.map((r) => {
    const { u, v } = r.uv; const t = toWorld(u, v);
    return pose(t, r.dist * 9.5, r.tilt, -0.3 + (r.az || 0));
  });
  const cur = { ...HERO, target: HERO.target.clone() };
  const want = { ...HERO, target: HERO.target.clone() };
  let introT = 1, introDone = true;

  function setFromPose(p) {
    const ct = Math.cos(p.tilt), st = Math.sin(p.tilt);
    camera.position.set(p.target.x + Math.sin(p.az) * ct * p.dist, p.target.y + st * p.dist, p.target.z + Math.cos(p.az) * ct * p.dist);
    camera.lookAt(p.target);
  }
  const smooth = (x) => x * x * (3 - 2 * x);
  function mix(a, b, t) { return { target: a.target.clone().lerp(b.target, t), dist: a.dist + (b.dist - a.dist) * t, tilt: a.tilt + (b.tilt - a.tilt) * t, az: a.az + (b.az - a.az) * t }; }

  let progress = -1, activeRegion = -1, mouseX = 0, mouseY = 0;
  function computeWant() {
    let p;
    if (progress <= -1) p = HERO;
    else if (progress < 0) p = mix(HERO, keys[0], smooth(progress + 1));
    else { const i = Math.min(keys.length - 1, Math.floor(progress)), f = smooth(Math.min(1, progress - i)); p = i >= keys.length - 1 ? keys[keys.length - 1] : mix(keys[i], keys[i + 1], f); }
    if (!introDone) p = mix(INTRO, p, smooth(introT));
    want.target.copy(p.target); want.dist = p.dist; want.tilt = p.tilt; want.az = p.az + mouseX * 0.06;
    want.tilt += mouseY * 0.03;
  }

  // ---------- interaction ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pickSpheres = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshBasicMaterial({ visible: false }), pins.length);
  pins.forEach((p, i) => { m4.makeTranslation(pinPos[i].x, pinPos[i].y + 0.3, pinPos[i].z); pickSpheres.setMatrixAt(i, m4); });
  scene.add(pickSpheres);
  let hover = -1;
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = ((e.clientX - r.left) / r.width) * 2 - 1; mouseY = ((e.clientY - r.top) / r.height) * 2 - 1;
    ndc.set(mouseX, -mouseY); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(pickSpheres)[0];
    const h = hit ? hit.instanceId : -1;
    if (h !== hover) { hover = h; canvas.style.cursor = h >= 0 ? 'pointer' : ''; dirty = true; }
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('click', () => { if (hover >= 0) onPin?.(pins[hover].id); });

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let running = false, dirty = true, frames = 0, slow = 0, visible = true;
  const v3 = new THREE.Vector3();
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w < 760 ? 46 : 32; camera.updateProjectionMatrix(); dirty = true;
  }
  const ro = new ResizeObserver(resize); ro.observe(stage); resize();

  const labelW = [];
  function updateLabels() {
    const w = stage.clientWidth, h = stage.clientHeight;
    // candidates: the active region's places (and the hovered pin), placed greedily without overlap
    const cands = [];
    labels.forEach((el, i) => {
      const want = (activeRegion >= 0 && places[pins[i].id].region === regions[activeRegion].id) || i === hover;
      if (want) {
        v3.copy(pinPos[i]); v3.y += 0.36; v3.project(camera);
        if (v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05) {
          const inS = places[pins[i].id].months.includes(currentMonth);
          cands.push({ i, x: ((v3.x + 1) / 2) * w, y: ((1 - v3.y) / 2) * h, pri: (i === hover ? 0 : 10) + (inS ? 0 : 5) + v3.z, inS });
          return;
        }
      }
      if (el.classList.contains('on')) { el.classList.remove('on'); el.tabIndex = -1; }
    });
    cands.sort((a, b) => a.pri - b.pri);
    const placed = [];
    for (const c of cands) {
      const el = labels[c.i];
      const lw = (labelW[c.i] ||= el.offsetWidth || 140), lh = 30;
      const r = { l: c.x - lw / 2, r: c.x + lw / 2, t: c.y - lh - 6, b: c.y - 6 };
      const clash = placed.some((p) => r.l < p.r + 6 && r.r > p.l - 6 && r.t < p.b + 4 && r.b > p.t - 4);
      if (clash && c.i !== hover) { if (el.classList.contains('on')) { el.classList.remove('on'); el.tabIndex = -1; } continue; }
      placed.push(r);
      el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px) translate(-50%, -100%) translateY(-6px)`;
      if (!el.classList.contains('on')) { el.classList.add('on'); el.tabIndex = 0; }
      el.classList.toggle('off-season', !c.inS);
    }
  }

  let currentMonth = month; paintPins(month);
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    computeWant();
    const k = 1 - Math.pow(1 - 0.075, dt * 60);
    cur.target.lerp(want.target, k); cur.dist += (want.dist - cur.dist) * k; cur.tilt += (want.tilt - cur.tilt) * k; cur.az += (want.az - cur.az) * k;
    setFromPose(cur);
    cloudMat.uniforms.uTime.value = t;
    cloudMat.uniforms.uWeights.value.lerp(weightTarget, 1 - Math.pow(0.97, dt * 60));
    renderer.render(scene, camera);
    updateLabels();
    // adaptive quality: drop resolution if frames are slow
    frames++; if (dt > 0.028) slow++;
    if (frames === 90) { if (slow > 45 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); cloudMat.uniforms.uPx.value = dpr; resize(); } frames = 0; slow = 0; }
  }
  function start() { if (running || !visible || document.hidden) return; running = true; clock.getDelta(); requestAnimationFrame(frame); }
  function stop() { running = false; }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  setFromPose(cur); renderer.render(scene, camera);
  start();

  return {
    setProgress(p, region) { progress = p; activeRegion = region; },
    setMonth(m) { currentMonth = m; weightTarget.set(...WEATHER[m]); paintPins(m); },
    setVisible(v) { visible = v; v ? start() : stop(); },
    intro(duration = 2.6, onEnd) {
      introDone = false; introT = 0; const t0 = performance.now();
      const tick = () => { if (introDone) return; introT = Math.min(1, (performance.now() - t0) / (duration * 1000)); if (introT >= 1) { introDone = true; onEnd?.(); } else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    },
    skipIntro() { introDone = true; introT = 1; },
    dispose() { stop(); ro.disconnect(); window.removeEventListener('pointermove', onMove); renderer.dispose(); canvas.remove(); labels.forEach((l) => l.remove()); },
  };
}
