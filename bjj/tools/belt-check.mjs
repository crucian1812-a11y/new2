// Can you read his rank off his belt?
//
// The belt is the one thing on a kimono that says who a man is, and it was a
// plain band: the knot was two flat cards hanging straight down, in the
// jacket's shade a dark strip on dark cloth. It is now a knot standing off the
// front, two ends splayed out of it, and on the longer end the rank bar —
// black on a coloured belt, red on a black one (material 9) — with two white
// degrees across it. A black bar on a brown belt in the shade of a man's own
// chest was ΔE 3 from the belt; the tape is what reads on every belt.
//
// This dresses both men in each belt of the ladder in turn and looks at each
// one from the front, three-quarters on, where the knot is:
//
//   планка   the bar is on screen and stands off the end it is sewn on by at
//            least ΔE 12 — measured against that end and not against the band,
//            so both are under the same light, and in two halves split by
//            brightness, the bar and its white degrees, because the mean of
//            the two is a grey as close to some belts as the bar is far
//   узел     the knot and the two ends hang below the band: at least a quarter
//            as much belt below the band as in it
//
// Whether the belt faces out at all is cloth-check's question, and it is the
// one that found the band lit from inside: that is a property of the file, not
// of a frame.
//
//   node bjj/tools/belt-check.mjs
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const BAR_DE = 12;
const HANG = 0.25;

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
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html?belt=white`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });

const BELTS = await page.evaluate(() => Object.keys(window.__bjj.BELT_COL));

// One man from the front: the camera three-quarters on to his chest at belt
// height, close enough that the knot is a few dozen pixels across — about
// what the walk-on and the hero shot give.
async function look(belt, who) {
  return page.evaluate(async ([belt, who]) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const g = window.__bjj;
    const m = g.match();
    if (m.state === 'ready') m.start();
    for (const f of m.f) f.beltCol.set(g.BELT_COL[belt]);
    g.setPose('STANDING');
    g.rig.live = false;
    g.quality(1);
    window.__still = 1;
    await wait(500);
    // Skeleton A is drawn first, so it is the red channel of the identity
    // pass; which fighter wears it is the match's business (roleShown).
    const sk = g.rig.skel[who];
    const hips = sk.world[g.BONE_INDEX.hips];
    const chest = sk.world[g.BONE_INDEX.chest];
    // His facing: the chest's forward axis, flattened.
    const fx = chest[8], fz = chest[10];
    const c = g.camera;
    c._focus[0] = hips[12]; c._focus[2] = hips[14];
    const face = Math.atan2(fx, fz);
    c._shot = 'stand';
    c.orbit = c.targetOrbit = face + 0.45;
    c.dist = 1.3; c.height = hips[13] + 0.05; c.aimY = hips[13] - 0.02; c.fovDeg = 30; c.shake = 0;
    await wait(700);
    const r = g.renderer;
    r.grabbed = null;
    r.want = true;
    for (let i = 0; i < 300 && !(r.grabbed && r.grabbed.id); i++) await wait(30);
    const { w, h, shaded, id, mat } = r.grabbed;
    const chan = who === 'A' ? 0 : 1;
    const mine = (k) => id[k * 4 + chan] > 127;
    // The band: rows where his belt is most of a run across him. Everything
    // of material 3 or 9 below the band's bottom row is knot and ends.
    const rows = new Array(h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (mine(k) && mat[k * 4] === 3) rows[y]++;
    }
    const peak = Math.max(...rows);
    let lo = h, hi = -1;
    for (let y = 0; y < h; y++) if (rows[y] > peak * 0.6) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    // Rows are read bottom-up: a smaller y is lower on the screen.
    const band = [], below = [], tail = [], bar = [];
    const mean = (list) => {
      if (!list.length) return null;
      const s = [0, 0, 0];
      for (const k of list) for (let i = 0; i < 3; i++) s[i] += shaded[k * 4 + i];
      return s.map((v) => v / list.length);
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (!mine(k)) continue;
      const mt = mat[k * 4];
      if (mt === 9) bar.push(k);
      if (mt === 3 || mt === 9) (y >= lo && y <= hi ? band : y < lo ? below : []).push(k);
      if (mt === 3 && y < lo) tail.push(k);
    }
    // The bar is two things, the bar and the tape across it, and the mean of
    // black and white is a grey that sits close to half the belts there are.
    // Split at its median brightness; each half is compared on its own.
    const Lk = (k) => shaded[k * 4] * 0.2126 + shaded[k * 4 + 1] * 0.7152 + shaded[k * 4 + 2] * 0.0722;
    const sorted = bar.slice().sort((a, b) => Lk(a) - Lk(b));
    const half = sorted.length >> 1;
    return {
      band: band.length, below: below.length, bar: bar.length, tailRGB: mean(tail),
      barDark: mean(sorted.slice(0, half)), barLight: mean(sorted.slice(half)),
    };
  }, [belt, who]);
}

function lab([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
console.log('     belt     man   bar ΔE   below/band');
let worstBar = null, worstHang = null;
for (const belt of BELTS) {
  for (const who of ['A', 'B']) {
    const r = await look(belt, who);
    const bar = r.barDark && r.tailRGB ? Math.max(dE(r.barDark, r.tailRGB), dE(r.barLight, r.tailRGB)) : 0;
    const hang = r.below / Math.max(1, r.band);
    console.log(`     ${belt.padEnd(8)} ${who}     ${bar.toFixed(0).padStart(5)}    ${hang.toFixed(2).padStart(6)}` +
      `   (${r.band} px of band, ${r.bar} of bar)`);
    if (!worstBar || bar < worstBar.bar) worstBar = { bar, belt, who, n: r.bar };
    if (!worstHang || hang < worstHang.hang) worstHang = { hang, belt, who };
  }
}
console.log('');
check(worstBar.n > 20 && worstBar.bar >= BAR_DE, 'планка: the rank bar is on the end and reads',
  `worst ${worstBar.belt} on ${worstBar.who}: ΔE ${worstBar.bar.toFixed(0)} over ${worstBar.n} px, want ${BAR_DE}`);
check(worstHang.hang >= HANG, 'узел: the knot and its ends hang in front',
  `worst ${worstHang.belt} on ${worstHang.who}: ${worstHang.hang.toFixed(2)} of the band, want ${HANG}`);
check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} check(s) failed` : '\nthe belt says who he is');
process.exitCode = fail ? 1 : 0;
