// Headless Chrome screenshots at scroll positions, plus console errors. Dev tool only.
// usage: node scripts/shot.mjs <url> <outDir> <width>x<height> <scrollY,scrollY,...|ids> [--lite]
import { spawn } from 'node:child_process'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
const [url, out = '.shots', size = '1440x900', stops = '0', ...flags] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'shot-'));
const port = 9300 + Math.floor(Math.random() * 500);
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tgt; for (let i = 0; i < 50; i++) { try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); if (tgt) break; } catch {} await sleep(200); }
const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + d.params.exceptionDetails.exception?.description);
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('log: ' + d.params.entry.text); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); r({ timeout: method }); } }, 60000); });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 760 });
const pre = flags.includes('--lite') ? "localStorage.setItem('lite','1');" : "localStorage.setItem('lite','0');";
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${pre}localStorage.setItem('seenIntro','1')}catch(e){}` });
await send('Page.navigate', { url }); await sleep(Number(process.env.WAIT || 14000));
await fs.mkdir(out, { recursive: true });
const evalJS = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
const list = stops.split(',');
for (const [i, s] of list.entries()) {
  const go = (t) => `(window.__lenis ? window.__lenis.scrollTo(${t}, { immediate: true, force: true }) : (typeof ${t} === 'number' ? scrollTo(0, ${t}) : document.querySelector(${t}).scrollIntoView()))`;
  if (/^\d+$/.test(s)) await evalJS(go(s)); else if (s.startsWith('#') || s.startsWith('.')) await evalJS(go(`'${s}'`)); else if (s.startsWith('+')) await evalJS(go(`scrollY + innerHeight * ${s.slice(1)}`)); else await evalJS(s);
  await sleep(2600);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  if (!shot.result) { console.log('shot timeout', s); continue; }
  await fs.writeFile(path.join(out, `${W}-${String(i).padStart(2, '0')}.jpg`), Buffer.from(shot.result.data, 'base64'));
}
console.log(JSON.stringify(await evalJS(`({cls: document.documentElement.className, canvas: !!document.querySelector('.stage canvas'), h: document.body.scrollHeight, overflowX: document.documentElement.scrollWidth > innerWidth, dbg: window.__dbg})`)));
console.log(logs.slice(0, 20).join('\n'));
ws.close(); ch.kill(); process.exit(0);
