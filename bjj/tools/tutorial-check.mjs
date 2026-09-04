// The first minute, driven and judged.
//
// Loads the page in tutorial mode and walks a deterministic hand through the
// four verbs, checking what the lesson is for: the opponent stays passive
// through base, transition and grip, the clock is not running, each gesture is
// recognised, the coach's one attack in the defence step has an answer, and
// the lesson ends ready for a real opponent.
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root, the
// same as thumb.mjs. The lesson plays in match time — dt is capped at 50 ms
// and a software rasteriser draws a handful of frames a second, so the lesson
// runs several times slower than the wall and the waits below are generous.

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
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html?tutorial`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__bjj, null, { timeout: 60000 });

// Pointer events through the real input class, like thumb.mjs. The stick's id
// is fixed so its press outlives the evaluate that starts it.
const gesture = (fn) => page.evaluate((src) => {
  const ui = document.getElementById('ui');
  const V = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const send = (type, x, y, id) => ui.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: false,
  }));
  const tap = (x, y) => { send('pointerdown', x, y, 9); send('pointerup', x, y, 9); };
  const flick = (dir) => {
    const x = ui.clientWidth * 0.78, y = ui.clientHeight * 0.6, v = V[dir];
    send('pointerdown', x, y, 8);
    send('pointermove', x + v[0] * 44, y + v[1] * 44, 8);
    send('pointerup', x + v[0] * 44, y + v[1] * 44, 8);
  };
  const stickDown = () => { const x = ui.clientWidth * 0.2, y = ui.clientHeight * 0.6; send('pointerdown', x, y, 7); send('pointermove', x, y - 28, 7); };
  const stickUp = () => send('pointerup', ui.clientWidth * 0.2, ui.clientHeight * 0.6 - 28, 7);
  // eslint-disable-next-line no-eval
  return eval(src);
}, fn);

// Repeat a gesture until a page condition holds, giving the slow software
// renderer time to run the lesson.
const until = async (cond, act, tries = 12, gapMs = 1000) => {
  for (let k = 0; k < tries; k++) {
    await act();
    if (await page.evaluate(cond)) return true;
    await page.waitForTimeout(gapMs);
  }
  return false;
};

// A watcher that reads the match while the lesson runs, so the passivity of
// the coach's partner and the frozen clock are observed and not assumed.
let sawAttackEarly = false, clockFrozen = true;
const watch = (async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const snap = await page.evaluate(() => {
      const m = window.__bjj.match(), t = window.__bjj.tutorial();
      return { i: t ? t.i : -1, done: !!(t && t.done), attemptBy: m.attempt ? m.attempt.by : -1, time: m.time, state: m.state };
    });
    if (snap.state === 'live' && snap.i >= 0 && snap.i < 3) {
      if (snap.attemptBy === 1) sawAttackEarly = true;
      if (snap.time < 299.5) clockFrozen = false;
    }
    if (snap.done) break;
    await page.waitForTimeout(150);
  }
})();

// Start the lesson.
await gesture(`tap(ui.clientWidth * 0.5, ui.clientHeight * 0.5)`);
await page.waitForFunction(() => window.__bjj.match().state === 'live', null, { timeout: 30000, polling: 'raf' });

// 1. Base: hold the left thumb.
await gesture(`stickDown()`);
let baseOk = true;
try {
  await page.waitForFunction(() => window.__bjj.tutorial().i >= 1, null, { timeout: 60000, polling: 'raf' });
} catch { baseOk = false; }
check(baseOk, 'holding base advances the lesson');
await gesture(`stickUp()`);

// 2. Transition: a right-thumb flick.
const moved = await until(`window.__bjj.tutorial().i >= 2`, () => gesture(`flick('up')`), 12, 1000);
const movePos = await page.evaluate(() => window.__bjj.match().position);
check(moved, 'a transition advances the lesson', `now in ${movePos}`);

// 3. Grip: a tap on the ring's centre, which is not a button. A tap that lands
// on the tail of the previous move's cooldown fights nothing, so it is retried.
const ring = await page.evaluate(() => { const { cx, cy } = window.__bjj.hud.ringLayout(); return { cx, cy }; });
const gripped = await until(`window.__bjj.tutorial().i >= 3`, () => gesture(`tap(${ring.cx}, ${ring.cy})`), 15, 1000);
check(gripped, 'a grip fight advances the lesson');

// 4. Defence: the coach's opponent attacks, and the arrow has an answer. A
// missed window re-arms the attack, so the read-and-flick is retried.
let deny = null;
let defended = false;
for (let k = 0; k < 12 && !defended; k++) {
  await page.waitForFunction(() => window.__bjj.match().deny !== null, null, { timeout: 20000, polling: 'raf' });
  deny = await page.evaluate(() => ({ dir: window.__bjj.match().deny.dir, by: window.__bjj.match().attempt.by }));
  await gesture(`flick('${deny.dir}')`);
  try {
    await page.waitForFunction(() => window.__bjj.tutorial().done, null, { timeout: 5000, polling: 'raf' });
    defended = true;
  } catch { /* the window passed; the coach re-arms and we try again */ }
}
check(defended, 'the coach attacks and the answer ends the lesson',
  `deny '${deny.dir}', attacker ${deny.by === 0 ? 'player' : 'opponent'}`);

await watch;
check(!sawAttackEarly, "the coach's partner stays out of it until the defence step");
check(clockFrozen, 'the lesson is not against the clock');
check(!errors.length, 'no page errors', errors.slice(0, 2).join(' | '));

await browser.close();
console.log(fail ? `\n${fail} problem(s)` : '\nthe first minute teaches the game');
process.exit(fail ? 1 : 0);
