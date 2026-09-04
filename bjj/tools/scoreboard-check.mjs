// The jumbotron tells the truth.
//
// Г2's measure: the board over the mat shows the match's own score. The frame
// is frozen with the art tooling's hooks, and the whole frame is drawn several
// times inside one callback — each pass with a different score or clock — so
// the only thing that differs between the readbacks is the board itself. Two
// grabs a frame apart would not do: the fighters breathe and the grain crawls,
// and a score change is a dozen pixels against thousands that moved on their
// own. (See `scoreShots` in renderer.js.)
//
// The camera sees two faces of the cube — the front screen and a narrow side
// sliver — so every number appears twice. That is fine: both faces carry the
// same left-to-right line, so the questions are asked of the centroids and the
// ordering, which survive the double exposure:
//
//   · the board shows the score            (points and clock move pixels)
//   · each number belongs to its fighter   (left score left of right score)
//   · the digits read left-to-right        (tens left of units, not mirrored)
//   · the clock is live, between the scores
//   · and none of it leaves the jumbotron
//
//   node bjj/tools/scoreboard-check.mjs [--dump out/]
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root, the
// same as thumb.mjs.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { encodePNG } from './png.mjs';

const PORT = +(process.env.PORT || 8099);
const args = process.argv.slice(2);
const dump = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null;

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
         '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
         '--disable-backgrounding-occluded-windows'],
});
const ctx = await browser.newContext({ viewport: { width: 812, height: 375 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__bjj, null, { timeout: 60000 });

// Start the match, then freeze everything that could move between grabs: the
// sim, the rig's procedural life, the camera and the broadcast grain.
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  const x = ui.clientWidth * 0.5, y = ui.clientHeight * 0.5;
  ui.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: false }));
  ui.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: false }));
});
await page.waitForFunction(() => window.__bjj.match().state === 'live', null, { timeout: 30000, polling: 'raf' });
await page.evaluate(() => {
  window.__frozen = true;
  window.__blend = null;
  window.__still = 60;
  window.__crowd = 0;
  window.__spot = 0;
  window.__gas = 0;
});

// One instant, scored six ways. `base` is 0-0 at 5:00; then one slot at a time:
// the left tens and units, the clock's minutes, the right units — plus a frame
// with both scores moved, to ask the board for everything at once.
const base = [0, 0], clock0 = 300;
const shots = await page.evaluate(([spec]) => new Promise((res) => {
  const r = window.__bjj.renderer;
  r.grabbed = null;
  r.scoreShots = spec;
  const t0 = performance.now();
  (function poll() {
    if (r.grabbed && r.grabbed.scoreShots) {
      res(r.grabbed.scoreShots.map((s) => ({ w: r.grabbed.w, h: r.grabbed.h, px: Array.from(s.px) })));
      return;
    }
    if (performance.now() - t0 > 30000) { res(null); return; }
    setTimeout(poll, 40);
  })();
}), [[
  [base, clock0],           // 0-0  5:00
  [[1, 0], clock0],         // left units 0->1
  [[10, 0], clock0],        // left tens  0->1
  [[0, 9], clock0],         // right units 0->9
  [[0, 10], clock0],        // right tens 0->1
  [base, 120],              // clock minutes 5->2
  [[9, 7], clock0],         // both scores
]]);

if (!shots) {
  console.log('FAIL no grabs — the renderer never came back');
  process.exit(1);
}

const [Z, leftUnits, leftTens, rightUnits, rightTens, clock, both] = shots;

// The pixels where two frames differ, as a set of (x, y) plus a centroid.
const THR = 8;   // a real change; the control floor is exactly zero
const mask = (a, b) => {
  let n = 0, sx = 0, sy = 0, x0 = a.w, x1 = 0, y0 = a.h, y1 = 0;
  const set = new Set();
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4;
      const d = Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]);
      if (d > THR) {
        set.add(y * 10000 + x);
        n++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (!n) return null;
  return { set, n, cx: sx / n, cy: sy / n, x0, x1, y0, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

const mLu = mask(Z, leftUnits);   // slot 1, left units
const mLt = mask(Z, leftTens);    // slot 0, left tens
const mRu = mask(Z, rightUnits);  // slot 7, right units
const mRt = mask(Z, rightTens);   // slot 6, right tens
const mC  = mask(Z, clock);       // slot 2, clock minutes
const mB  = mask(Z, both);        // everything

const inter = (a, b) => { let n = 0; for (const k of a.set) if (b.set.has(k)) n++; return n; };

check(!!mB && mB.n > 100, 'the board shows the score',
  mB ? `${mB.n} px, ${mB.w}×${mB.h}` : 'nothing changed');

// Each number belongs to its own fighter: the left score's digits sit to the
// left of the right score's, on the board as on the scorebug.
check(!!mLu && !!mRu && mLu.cx < mRu.cx, 'each number belongs to its own fighter',
  mLu && mRu ? `left cx ${mLu.cx.toFixed(0)}, right cx ${mRu.cx.toFixed(0)}` : '');

// Not mirrored: a digit's tens column is to the left of its units column, for
// both fighters. A mirrored board would put the tens on the right.
check(!!mLt && !!mLu && mLt.cx < mLu.cx, 'the left score reads left-to-right',
  mLt && mLu ? `tens cx ${mLt.cx.toFixed(0)}, units cx ${mLu.cx.toFixed(0)}` : '');
check(!!mRt && !!mRu && mRt.cx < mRu.cx, 'the right score reads left-to-right',
  mRt && mRu ? `tens cx ${mRt.cx.toFixed(0)}, units cx ${mRu.cx.toFixed(0)}` : '');

// The clock is live, and it lives between the two scores.
check(!!mC && mC.n > 20, 'the clock is live', mC ? `${mC.n} px` : 'nothing changed');
check(!!mLu && !!mC && !!mRu && mLu.cx < mC.cx && mC.cx < mRu.cx, 'the clock sits between the scores',
  mLu && mC && mRu ? `left ${mLu.cx.toFixed(0)}, clock ${mC.cx.toFixed(0)}, right ${mRu.cx.toFixed(0)}` : '');

// None of it leaves the jumbotron: the board hangs high in the frame (top of
// the readback, which is bottom-up) and never covers more than a corner of it.
check(!!mB && mB.y0 > 280 && mB.y1 < 366, 'the scoreboard stays on the jumbotron',
  mB ? `rows ${mB.y0}-${mB.y1} of ${mB.h}` : '');
check(!!mB && mB.n < 812 * 375 * 0.15,
  'the scoreboard is a corner of the frame', mB ? `${((mB.n / (812 * 375)) * 100).toFixed(1)}% of pixels` : '');

check(!errors.length, 'no page errors', errors.slice(0, 2).join(' | '));

if (dump) {
  mkdirSync(dump, { recursive: true });
  writeFileSync(join(dump, 'board-0-0.png'), encodePNG(Z.w, Z.h, new Uint8Array(Z.px)));
  writeFileSync(join(dump, 'board-9-7.png'), encodePNG(both.w, both.h, new Uint8Array(both.px)));
  console.log(`\nwrote ${join(dump, 'board-0-0.png')} and ${join(dump, 'board-9-7.png')}`);
}

await browser.close();
console.log(fail ? `\n${fail} problem(s)` : '\nthe jumbotron tells the truth');
process.exit(fail ? 1 : 0);
