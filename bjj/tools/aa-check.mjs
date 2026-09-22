// What the edges cost when the phone cannot hold sixty — and what smoothing
// would have to beat.
//
// The scene is drawn offscreen and the context has no antialiasing, so an
// edge is as smooth as the pixel count makes it: a device ratio up to 2.5, and
// when a phone cannot hold sixty frames the adaptive resolution drops to 62%
// and is stretched back up. A critic's pass called that a staircase and asked
// for FXAA.
//
// FXAA was written, in the post pass, and measured here — and thrown out:
// against the same instant rendered at twice the resolution and averaged down
// two by two, it moved the edges 5% *further* from the clean picture at full
// resolution and 2% at 62%, with strict thresholds and with loose ones. What a
// stretched frame is short of is detail, not smoothness, and at full
// resolution the classic filter blurs more than the edge was wrong. An
// earlier run of this file said the opposite, +6 to +12%, and that run was
// the hall's lighting drifting between grabs taken a quarter of a second
// apart (HANDOFF, «сцена светлеет по ходу прогона»): the same raw frame read
// again later was 30 from the reference instead of 23. So every version is
// now drawn inside one frame, from one instant — see the `{ name, dpr, q }`
// passes of `want` in renderer.js — and the repeat is checked to be exact.
//
// What it does report is the number that matters: how much further from the
// clean picture the edges are at 62% than at 100%. That is the cost of the
// adaptive resolution, and anything that buys frames back — a lower device
// ratio ceiling, a cheaper pass — is worth that much on every silhouette.
// A future attempt at smoothing (MSAA on the scene target, say) is judged here
// against the "100%" column and has to come in under it.
//
//   node bjj/tools/aa-check.mjs
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const SHOTS = ['MOUNT', 'SIDE_CONTROL', 'CLOSED_GUARD', 'STANDING'];
const W = 640, H = 300;

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });

async function frames(pose) {
  return page.evaluate(async (p) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const m = window.__bjj.match();
    if (m.state === 'ready') m.start();
    window.__bjj.setPose(p);
    await wait(700);
    window.__bjj.still(3.0);
    window.__bjj.rig.live = false;
    window.__bjj.quality(1);
    await wait(250);
    const r = window.__bjj.renderer;
    r.grabbed = null;
    r.want = [
      { name: 'ref', dpr: 2, q: 1 },
      { name: 'low', dpr: 1, q: 0.62 },
      { name: 'full', dpr: 1, q: 1 },
      { name: 'low2', dpr: 1, q: 0.62 },
      'last',
    ];
    for (let i = 0; i < 300 && !(r.grabbed && r.grabbed.shots); i++) await wait(30);
    const out = {};
    for (const [k, v] of Object.entries(r.grabbed.shots)) if (v.px) out[k] = { w: v.w, h: v.h, px: Array.from(v.px) };
    return out;
  }, pose);
}

const lum = (a, i) => 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
function measure(f) {
  const { ref } = f, w = f.low.w, h = f.low.h;
  // The reference, two by two into one.
  const R = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) s += lum(ref.px, ((y * 2 + dy) * ref.w + x * 2 + dx) * 4);
    R[y * w + x] = s / 4;
  }
  // Only where the clean picture has an edge; the rest is flat and would
  // dilute the number.
  const err = (g) => {
    let e = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      if (Math.abs(R[k + 1] - R[k - 1]) + Math.abs(R[k + w] - R[k - w]) < 40) continue;
      e += Math.abs(lum(g.px, k * 4) - R[k]);
      n++;
    }
    return e / Math.max(1, n);
  };
  return { low: err(f.low), full: err(f.full), low2: err(f.low2) };
}

console.log('     distance to the clean picture on its edges (mean luminance error, 0-255):\n');
console.log('     pose              62%     100%');
let lo = 0, fu = 0, same = true;
for (const pose of SHOTS) {
  const f = await frames(pose);
  if (!f.low || f.low.w !== W || f.ref.w !== W * 2) { console.log(`     ${pose}: the frames did not come back at the sizes asked for`); fail++; continue; }
  const r = measure(f);
  if (r.low !== r.low2) same = false;
  lo += r.low; fu += r.full;
  console.log(`     ${pose.padEnd(14)} ${r.low.toFixed(1).padStart(7)} ${r.full.toFixed(1).padStart(8)}`);
}
console.log('');
check(same, 'the same instant drawn twice is the same picture', 'every version comes out of one frame');
console.log(`     the adaptive resolution at its floor costs ${((lo / fu - 1) * 100).toFixed(0)}% more edge error than full resolution`);
check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} check(s) failed` : '\nmeasured');
process.exitCode = fail ? 1 : 0;
