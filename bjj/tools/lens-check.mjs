// The long lens: is the background soft, and is the fight still sharp?
//
// The stands behind the mat were drawn pin sharp — dark boxes with stepped
// edges, the one part of every frame that said "game" rather than "broadcast".
// A broadcast camera on a fight is a long lens at a wide aperture, and the
// post pass now softens what is far from it (DOF in renderer.js). That is only
// worth having if it softens the right things, so this renders the same
// frames twice — once as shipped, once with the soft background switched off,
// inside the same frame — and compares how much edge each region has:
//
//   трибуны   what is far from the lens (the top of the frame, nobody in it)
//             has to lose at least a quarter of its edge. Not more: the
//             broadcast grain goes on after the lens and is edge in every
//             pixel, and where the top of the frame is mostly flat roof (the
//             standing shot) grain is most of what is left — 13% gone there
//             against 44% in the closed guard, where it is all crowd
//   пара      the two men must keep all of theirs
//   мат       and so must the floor round them
//
// Edge is the mean luminance step between neighbouring pixels, which is what
// "sharp" is on a screen.
//
//   node bjj/tools/lens-check.mjs
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const SHOTS = ['STANDING', 'CLOSED_GUARD', 'SIDE_CONTROL', 'MOUNT'];

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

// Both versions from one instant, inside one frame — see `want` in
// renderer.js: the pass named 'lens' is the frame without the soft background,
// and the last pass carries the identity mask and the frame as shipped. Edge is
// read on the picture halved, two by two, so the broadcast grain (a pixel's
// worth of noise everywhere) does not stand in for detail.
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html?belt=blue`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });
const rows = {};
for (const pose of SHOTS) {
  rows[pose] = await page.evaluate(async (pose) => {
    const g = window.__bjj;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const m = g.match();
    if (m.state === 'ready') m.start();
    g.setPose(pose);
    g.rig.live = false;
    g.quality(1);
    window.__still = null;
    await wait(1500);
    window.__still = 3.0;
    await wait(400);
    const r = g.renderer;
    r.grabbed = null;
    r.want = ['lens', 'shipped'];
    for (let i = 0; i < 300 && !(r.grabbed && r.grabbed.id && r.grabbed.shots); i++) await wait(30);
    const { w, h, shaded, id } = r.grabbed;
    const flat = r.grabbed.shots.lens;
    const W = w >> 1, H = h >> 1;
    const half = (px) => {
      const o = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const k = ((y * 2 + dy) * w + x * 2 + dx) * 4;
          s += 0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2];
        }
        o[y * W + x] = s / 4;
      }
      return o;
    };
    const A = half(shaded), B = half(flat);
    // Who is where, on the halved grid: a cell is somebody if any of its four
    // pixels is.
    const who = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const k = ((y * 2 + dy) * w + x * 2 + dx) * 4;
        if (id[k] > 127 || id[k + 1] > 127) v = 2;
        else if (id[k + 2] > 127 && !v) v = 1;
      }
      who[y * W + x] = v;
    }
    const acc = { far: [0, 0, 0], pair: [0, 0, 0], mat: [0, 0, 0] };
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      // Rows are read back bottom-up: y near H is the top of the screen.
      const region = who[k] === 2 && who[k + 1] === 2 && who[k + W] === 2 ? 'pair'
        : !who[k] && !who[k + 1] && !who[k + W] ? (y > H * 0.72 ? 'far' : y < H * 0.3 ? 'mat' : null) : null;
      if (!region) continue;
      acc[region][0] += Math.abs(A[k + 1] - A[k]) + Math.abs(A[k + W] - A[k]);
      acc[region][1] += Math.abs(B[k + 1] - B[k]) + Math.abs(B[k + W] - B[k]);
      acc[region][2]++;
    }
    return Object.fromEntries(Object.entries(acc).map(([k, [a, b, n]]) => [k, [a / Math.max(1, n), b / Math.max(1, n)]]));
  }, pose);
}
await ctx.close();

console.log('     edge per halved pixel (0-255), soft background on / off:\n');
console.log('     pose            трибуны          пара             мат');
const ratio = { far: [], pair: [], mat: [] };
for (const pose of SHOTS) {
  const r = rows[pose];
  for (const k of ['far', 'pair', 'mat']) ratio[k].push(r[k][0] / Math.max(1e-6, r[k][1]));
  const f = (k) => `${r[k][0].toFixed(1).padStart(5)} / ${r[k][1].toFixed(1).padEnd(6)}`;
  console.log(`     ${pose.padEnd(14)} ${f('far')} ${f('pair')} ${f('mat')}`);
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
console.log('');
check(mean(ratio.far) <= 0.75, 'трибуны: the stands go soft',
  `${Math.round((1 - mean(ratio.far)) * 100)}% of their edge gone on average, want a quarter`);
check(Math.min(...ratio.pair) >= 0.98, 'пара: and the two men stay sharp',
  `worst keeps ${Math.round(Math.min(...ratio.pair) * 100)}% of its edge`);
check(Math.min(...ratio.mat) >= 0.97, 'мат: and so does the floor round them',
  `worst keeps ${Math.round(Math.min(...ratio.mat) * 100)}% of its edge`);
check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} check(s) failed` : '\nthe lens is a lens');
process.exitCode = fail ? 1 : 0;
