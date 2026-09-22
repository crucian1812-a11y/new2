// Where to stand to photograph a position.
//
// The title card is six pictures of real positions (src/game/gallery.js), and
// the only thing authored about a picture is the angle it is taken from: how
// far round the pair the camera stands, how high, and how long the lens is.
// Everything else — the distance, the truck, the framing — is computed from the
// pose, so those three numbers are the whole of the composition.
//
// Choosing them by eye is exactly what this project does not do. So they are
// solved, against the same numbers `poster-check` judges the plates on, read
// off the same frames the game draws:
//
//   оба        how much of each man is in the picture. A position photographed
//              end-on is one man with a foot sticking out of him
//   контраст   the men against the room behind them
//   разбор     the line where the two of them touch. Two white jackets against
//              each other are one shape without it, and this is the number the
//              print exists to raise
//   фигуры     how much of the frame they are
//   лепка      and whether the jacket still has folds in it
//
// Every one of those is a pixel measurement of the shipped frame, taken through
// the renderer's own identity mask — so what is being maximised is the picture
// a player gets, not a proxy for it.
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.
//
//   node bjj/tools/plate-solve.mjs              every plate, the best five each
//   node bjj/tools/plate-solve.mjs --plate 3    one of them
//   node bjj/tools/plate-solve.mjs --step 30    coarser and faster
//   node bjj/tools/plate-solve.mjs --plate 2 --orbits 70,75,80,85,90 --elev 22,30,38
//                                              a second pass round a winner
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import { PLATES } from '../src/game/gallery.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const ONLY = flag('plate', null);
const STEP = +flag('step', 20);
const ELEVS = flag('elev', '7,16,26').split(',').map(Number);
// A second pass round a winner: the coarse sweep walks the whole circle in
// twenty degree steps, and the angle it lands on is the best of eighteen rather
// than the best there is.
const ORBITS = flag('orbits', null);
const PORT = +(process.env.PORT || 8099);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });
await page.evaluate(() => { window.__bjj.quality(1); window.__bjj.toTitle(); window.__bjj.still(3.0); });

// One frame, measured. The same block poster-check reads, kept here rather than
// shared because a solver that imports its judge's code cannot be checked by it
// — and because this one runs a few thousand times and wants nothing it does
// not use.
const shoot = (k, orbit, elev) => page.evaluate(async ([k, orbit, elev]) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const g = window.__bjj.gallery();
  if (g.i !== k) window.__bjj.plate(k);
  g.plate.orbit = orbit;
  g.plate.elev = elev;
  g.frame();
  const r = window.__bjj.renderer;
  r.grabbed = null;
  r.want = true;
  for (let t = 0; t < 400 && !r.grabbed; t++) await wait(16);
  if (!r.grabbed) return null;
  const { w, h, shaded, id } = r.grabbed;
  const L = new Float32Array(w * h), who = new Uint8Array(w * h);
  for (let q = 0; q < w * h; q++) {
    const o = q * 4;
    L[q] = 0.2126 * shaded[o] + 0.7152 * shaded[o + 1] + 0.0722 * shaded[o + 2];
    who[q] = id[o] > 60 ? 1 : id[o + 1] > 60 ? 2 : 0;
  }
  let men = 0, a = 0, b = 0, sum = 0, sum2 = 0, bg = 0, bgs = 0, seam = 0, seamLit = 0;
  let blown = 0, edge = 0;
  const E = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = y * w + x;
      if (who[q]) {
        men++;
        if (who[q] === 1) a++; else b++;
        sum += L[q]; sum2 += L[q] * L[q];
        if (L[q] > 245) blown++;
        if (x < E || y < E || x >= w - E || y >= h - E) edge++;
        for (const [n2, q2] of [[who[q + 1], q + 1], [who[q + w], q + w]]) {
          if (n2 && n2 !== who[q]) { seam++; if (Math.abs(L[q] - L[q2]) >= 6) seamLit++; }
        }
      } else { bg++; bgs += L[q]; }
    }
  }
  const mean = men ? sum / men : 0;
  return {
    men: men / (w * h), a: a / (w * h), b: b / (w * h), edge,
    contrast: mean - (bg ? bgs / bg : 0),
    sd: men ? Math.sqrt(Math.max(0, sum2 / men - mean * mean)) : 0,
    seam: seam ? seamLit / seam : 0, seamN: seam,
    blown: men ? blown / men : 0,
    dist: g.dist,
  };
}, [k, orbit, elev]);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// What a good plate is worth, in one number. Each term is normalised on what a
// good picture of this kind actually reads — sixty levels of contrast, half the
// seam visible, a twentieth of the frame for the man who shows least — so that
// no single term can buy the others.
const score = (m) => (
  1.0 * clamp01(m.contrast / 60) +
  1.0 * m.seam +
  1.0 * clamp01(Math.min(m.a, m.b) / 0.05) +
  0.6 * clamp01(m.men / 0.25) +
  0.4 * clamp01(m.sd / 100)
);
// And what disqualifies one outright.
const gate = (m) => m && Math.min(m.a, m.b) >= 0.012 && m.men >= 0.06 && m.men <= 0.40
  && m.edge <= 40 && m.blown <= 0.08;

const list = ONLY != null ? [Number(ONLY)] : PLATES.map((_, i) => i);
const kept = new Map();
for (const k of list) {
  const rows = [];
  const circle = ORBITS
    ? ORBITS.split(',').map(Number)
    : Array.from({ length: Math.ceil(360 / STEP) }, (_, j) => j * STEP);
  for (const orbit of circle) {
    for (const elev of ELEVS) {
      const m = await shoot(k, orbit, elev);
      if (!m) continue;
      rows.push({ orbit, elev, m, ok: gate(m), s: gate(m) ? score(m) : -1 });
    }
  }
  rows.sort((x, y) => y.s - x.s);
  kept.set(k, rows.filter((r) => r.ok).slice(0, 10));
  const here = PLATES[k];
  console.log();
  console.log(`=== ${k}. ${here.pose}   authored ${here.orbit}/${here.elev}, lens ${here.fov}`);
  for (const r of rows.slice(0, 6)) {
    const m = r.m;
    console.log(`  orbit ${String(r.orbit).padStart(3)}  elev ${String(r.elev).padStart(2)}  ` +
      `score ${r.s.toFixed(2)}  men ${(m.men * 100).toFixed(1)}% ` +
      `(${(m.a * 100).toFixed(1)}/${(m.b * 100).toFixed(1)})  contrast ${m.contrast.toFixed(0)}  ` +
      `seam ${(m.seam * 100).toFixed(0)}%  sd ${m.sd.toFixed(0)}  ${m.dist.toFixed(1)}m`);
  }
  const mine = rows.find((r) => r.orbit === here.orbit && r.elev === here.elev);
  if (mine) console.log(`  (the authored angle scores ${mine.s.toFixed(2)})`);
}

// And the six together, which is not the same as six bests.
//
// A gallery shot from one side of the mat is one picture six times, and nothing
// a single plate is measured on can say so — every term in the score is about
// that plate alone. So the last step is an assignment rather than a maximum: of
// the ten best angles for each plate, take the set of six whose scores add up
// highest *and* which are at least forty degrees apart in bearing. Forty is the
// smallest gap at which two plates of different positions do not read as the
// same camera; it costs, here, about a tenth of a point.
const SPREAD = 40;
if (list.length === PLATES.length && [...kept.values()].every((r) => r.length)) {
  const arr = list.map((k) => kept.get(k));
  const sep = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  let best = null;
  const pick = [];
  const walk = (i, sum) => {
    if (i === arr.length) {
      if (!best || sum > best.sum) best = { sum, take: pick.slice() };
      return;
    }
    // Nothing further down this plate's list can beat the best already found.
    if (best && sum + arr.slice(i).reduce((a, r) => a + r[0].s, 0) <= best.sum) return;
    for (const cand of arr[i]) {
      if (pick.some((p) => sep(p.orbit, cand.orbit) < SPREAD)) continue;
      pick.push(cand);
      walk(i + 1, sum + cand.s);
      pick.pop();
    }
  };
  walk(0, 0);
  console.log();
  console.log(`=== the six, ${SPREAD}° apart   total ${best ? best.sum.toFixed(2) : '—'}`);
  if (!best) {
    console.log('  no set of six is that far apart — widen the sweep or drop SPREAD');
  } else {
    best.take.forEach((r, i) => {
      console.log(`  { pose: '${PLATES[i].pose}', orbit: ${r.orbit}, elev: ${r.elev}, ` +
        `fov: ${PLATES[i].fov} },   // ${r.s.toFixed(2)}`);
    });
  }
}
await browser.close();
