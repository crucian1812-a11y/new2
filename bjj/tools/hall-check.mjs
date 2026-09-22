// Is there a hall above the boards?
//
// The art direction says a competition shot for television: the mat is the
// only brightly lit thing in the building and the crowd is a dark mass with
// catchlights in it. On the glass the dark mass had nothing behind it — the
// cleared background is (0.012, 0.014, 0.02) — so the crowd was black on black
// and the catchlights floated on nothing. A player's first read of the top
// third of every frame was a night sky with stars in it, not a room full of
// people.
//
// This counts how much of the top third of the frame is nearly black
// (tonemapped luminance under 8 of 255), on the frame the renderer draws — no
// HUD — in the positions the match lives in. It judges the middle three fifths
// of that strip: the corners are the vignette's, which takes them to 38% on
// purpose, and with the hall in place they are nearly all that is left dark.
//
//   node bjj/tools/hall-check.mjs
//   node bjj/tools/hall-check.mjs --dump out/     and write the frames out
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { encodePNG } from './png.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const SHOTS = ['STANDING', 'CLOSED_GUARD', 'MOUNT', 'SIDE_CONTROL', 'BACK'];
const DARK = 8;
// The line: under a tenth of the top third is void.
const MAX_VOID = 0.10;
const DUMP = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;
if (DUMP) mkdirSync(DUMP, { recursive: true });

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
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });

let total = 0, mid = 0;
console.log('     share of the top third of the frame that is nearly black:\n');
for (const pose of SHOTS) {
  const g = await page.evaluate(async (p) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const m = window.__bjj.match();
    if (m.state === 'ready') m.start();
    window.__bjj.setPose(p);
    await wait(900);
    window.__bjj.still(3.0);
    window.__bjj.quality(1);
    await wait(250);
    const r = window.__bjj.renderer;
    r.grabbed = null;
    r.want = true;
    for (let i = 0; i < 300 && !(r.grabbed && r.grabbed.shaded); i++) await wait(30);
    return { w: r.grabbed.w, h: r.grabbed.h, px: Array.from(r.grabbed.shaded) };
  }, pose);
  const { w, h, px } = g;
  let dark = 0, n = 0, cdark = 0, cn = 0;
  // readPixels is bottom row first: the top third of the picture is the last
  // third of the buffer.
  for (let y = Math.floor(h * 2 / 3); y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] < DARK;
    if (d) dark++;
    n++;
    // And the middle three fifths on their own: the corners belong to the
    // vignette, which takes them to 38% on purpose.
    if (x > w * 0.2 && x < w * 0.8) { if (d) cdark++; cn++; }
  }
  total += dark / n;
  mid += cdark / cn;
  console.log(`     ${pose.padEnd(14)} ${(dark / n * 100).toFixed(0).padStart(4)}%   middle ${(cdark / cn * 100).toFixed(0).padStart(3)}%`);
  if (DUMP) {
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) out.set(px.slice((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    writeFileSync(`${DUMP}/${pose}.png`, encodePNG(w, h, out));
  }
}
const mean = total / SHOTS.length, middle = mid / SHOTS.length;
console.log('');
console.log(`     the whole top third: ${(mean * 100).toFixed(0)}% (it was 47% with nothing behind the stands)`);
check(middle <= MAX_VOID, 'there is a hall above the boards',
  `${(middle * 100).toFixed(0)}% of the middle of the top third is nearly black, want ${MAX_VOID * 100}% or less`);
check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} check(s) failed` : '\nthe room is a room');
process.exitCode = fail ? 1 : 0;
