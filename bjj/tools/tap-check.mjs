// Does a tap on a button actually fire the move, through the real page?
//
// ring-check measures the geometry; this measures the whole path — a real
// PointerEvent on the real canvas, through Input, through main.js, into the
// match — because that path is where the bug lived. The ring looked like four
// buttons and only answered to swipes, so a tap on the button marked «+4»
// fought for a grip in silence, and every tool in the battery swiped.
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.
//
//   node bjj/tools/tap-check.mjs

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
         '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bjj && window.__bjj.match(), null, { timeout: 40000 });

const out = await page.evaluate(() => new Promise((done) => {
  const ui = document.getElementById('ui');
  const m = window.__bjj.match();
  const hud = window.__bjj.hud;
  const send = (type, x, y, id) => ui.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true,
  }));
  let id = 40;
  const tap = (x, y) => { const i = ++id; send('pointerdown', x, y, i); setTimeout(() => send('pointerup', x, y, i), 40); };

  // Start the match.
  tap(ui.clientWidth / 2, ui.clientHeight / 2);

  const r = { taps: [], grip: null, live: false };
  setTimeout(() => {
    r.live = m.state === 'live';
    const { R, cx, cy } = hud.ringLayout();
    const V = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    // One tap per button, spaced so the cooldown between moves is over.
    const dirs = Object.keys(V);
    let k = 0;
    const step = () => {
      if (k >= dirs.length) {
        // And a tap in the middle, which must still be the grip fight.
        const before = m.tape.filter((x) => x.k === 'press').length;
        const adv0 = m.gripAdv[0] + m.gripAdv[1];
        tap(cx, cy);
        setTimeout(() => {
          r.grip = {
            moves: m.tape.filter((x) => x.k === 'press').length - before,
            adv: (m.gripAdv[0] + m.gripAdv[1]) - adv0,
          };
          done(r);
        }, 1200);
        return;
      }
      const d = dirs[k++];
      const before = m.tape.filter((x) => x.k === 'press').length;
      const offered = !!m.preview(0)[d];
      tap(cx + V[d][0] * R, cy + V[d][1] * R);
      // Polled, not slept on. The page is on a software rasteriser here and a
      // frame can take a third of a second; a fixed wait measured the
      // rasteriser and reported a tap the game had simply not read yet.
      const t0 = performance.now();
      const look = () => {
        const rec = m.tape.filter((x) => x.k === 'press');
        if (rec.length > before) {
          r.taps.push({ dir: d, offered, heard: true, got: rec[rec.length - 1].dir });
          setTimeout(step, 500);
        } else if (performance.now() - t0 > 2500) {
          r.taps.push({ dir: d, offered, heard: false, got: null });
          setTimeout(step, 500);
        } else setTimeout(look, 60);
      };
      look();
    };
    step();
  }, 900);
}));

await browser.close();

console.log(`     ${out.taps.map((t) => `${t.dir}:${t.heard ? (t.got === t.dir ? 'ok' : 'wrong(' + t.got + ')') : 'lost'}`).join('  ')}`);
console.log(`     grip tap in the middle: ${out.grip.moves} moves fired, grip advantage moved ${out.grip.adv.toFixed(2)}\n`);

check(out.live, 'the match is running');
check(out.taps.length === 4 && out.taps.every((t) => t.heard && t.got === t.dir),
  'a tap on each of the four buttons is heard as that button',
  `${out.taps.filter((t) => t.heard && t.got === t.dir).length}/4`);
check(out.grip.moves === 0,
  'a tap in the middle is still the grip fight, not a move',
  `${out.grip.moves} moves fired by it`);
check(errors.length === 0, 'no errors on the page', errors.slice(0, 2).join(' | '));

console.log(fail ? `\n${fail} check(s) failed` : '\nthe buttons are buttons');
process.exitCode = fail ? 1 : 0;
