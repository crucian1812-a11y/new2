// Boot the real page, play it for a while with synthetic swipes, and insist
// that nothing threw and that the picture is not black.
//
// A renderer can fail in a way no unit test sees: a shader that links on the
// desktop and not on a phone, a uniform that silently clamps, a frame that is
// technically drawn and entirely dark. This is the check for that.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const browser = await chromium.launch({
  // The sandbox ships a browser; CHROME_PATH points at it when the npm copy
  // and the installed one disagree about their version number.
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 812, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// Start it, then swipe around for a few seconds the way a player would.
await page.mouse.click(600, 200);
const dirs = [[0, -90], [0, 90], [-90, 0], [90, 0]];
for (let i = 0; i < 22; i++) {
  const [dx, dy] = dirs[i % 4];
  await page.mouse.move(620, 200);
  await page.mouse.down();
  await page.mouse.move(620 + dx, 200 + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(320);
}

const stats = await page.evaluate(() => window.__stats);
check(!!stats, 'the loop is running', JSON.stringify(stats));

// Say out loud which renderer this ran on. Headless Chrome falls back to a
// software rasteriser without telling you, and a software rasteriser is the
// first thing you blame when the picture is wrong — which makes it the last
// thing you should be guessing about.
const renderer = await page.evaluate(() => {
  const gl = document.getElementById('gl').getContext('webgl2');
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const soft = /swiftshader|llvmpipe|lavapipe|software/i.test(renderer);
console.log(`     renderer: ${renderer}${soft ? '  (SOFTWARE — frame rate here means nothing)' : ''}`);
check(errors.length === 0, 'no errors on the page', errors.slice(0, 3).join(' | '));
// Only where the frame rate means anything. Under SwiftShader it does not —
// this box draws four or five frames a second and a phone with a GPU draws
// sixty — and the check used to pass regardless for a worse reason: the fps
// readout was computed from a dt capped at 50 ms and could not go below 20.
// What is worth checking under software GL is that the loop is advancing at
// all, which the position and the clock in __stats say.
if (soft) check(stats && stats.fps > 0.5, 'the loop advances under software GL', stats && `${stats.fps} fps`);
else check(stats && stats.fps > 30, 'frame rate is sane', stats && `${stats.fps} fps`);

// Is anything actually drawn? Sample the framebuffer and look for colour.
const shot = await page.screenshot({ type: 'png' });
// Ask the renderer to sample its own frame before it is presented; a read
// after the swap is not defined to return anything at all.
const probe = await page.evaluate(async () => {
  window.__bjj.renderer.probe = true;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = window.__bjj.renderer;
  return { lum: r.lum || [], nan: r.hdrNaN || null };
});
const lum = probe.lum;
check(
  probe.nan !== null && probe.nan.nan === 0,
  'no NaN reached the HDR buffer',
  probe.nan ? `${probe.nan.nan} of ${probe.nan.sampled * 3} channels` : 'probe did not run'
);
const bright = lum.filter((v) => v > 12).length;
check(bright >= 10, 'the mat is actually lit', `${bright}/16 samples above black`);
check(shot.length > 20000, 'the frame encodes to a real image', `${(shot.length / 1024) | 0}kb`);

/* ------------------------------------------------- the shell round a match */

// Title, match, result, and the next man out — without a reload, and with the
// belt still there after one. This is the part of the game that is not the
// match, and until the ladder existed there was nothing here to check.
{
  const ladder = await page.evaluate(async () => {
    const ui = document.getElementById('ui');
    const press = () => {
      for (const type of ['pointerdown', 'pointerup']) {
        ui.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientX: 600, clientY: 200, bubbles: true }));
      }
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const m0 = window.__bjj.match();
    const belt0 = m0.f[1].name && localStorage.getItem('bjj.progress');
    // Run the clock out rather than playing it out: what is being checked is
    // the shell, and the sim has four hundred matches of its own in sim-check.
    m0.f[0].points = 2;
    m0.time = 0.1;
    // Waited for, not slept through: this page draws one frame a second under
    // a software rasteriser and the clock only moves when a frame does.
    const until = async (fn, ms = 30000) => {
      const t0 = Date.now();
      while (!fn() && Date.now() - t0 < ms) await wait(200);
      return fn();
    };
    await until(() => window.__bjj.match().state === 'over');
    const over = window.__bjj.match().state;
    press();
    await until(() => window.__bjj.match() !== m0);
    const m1 = window.__bjj.match();
    return {
      over, next: m1.state, fresh: m1 !== m0, saved: localStorage.getItem('bjj.progress'), belt0,
    };
  });
  check(ladder.over === 'over', 'the match ends on the clock', ladder.over);
  check(ladder.fresh && ladder.next !== 'over', 'a touch puts the next man on the mat', ladder.next);
  check(!!ladder.saved, 'the ladder is written down', ladder.saved || 'nothing in localStorage');
  const kept = await page.evaluate(() => localStorage.getItem('bjj.progress'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => localStorage.getItem('bjj.progress'));
  check(after === kept, 'and it survives a reload', `${after}`);
}

// Fatigue is checked in pose-check, not here.
//
// It was here, comparing the frame with a fresh fighter against the frame with
// a spent one, and every version of that check passed with the whole feature
// commented out. Three reasons, all worth knowing before trying again:
// comparing PNG bytes says 99% for a one-pixel change; comparing pixels is
// swamped by half-a-pixel jitter on the edges; and the scene brightens as it
// runs — six identical passes measured 97.9, 97.9, 98.3, 99.1, 100.5, 101.5 —
// so any two readings taken at different times differ by more than the thing
// being measured, and a palindrome only cancels the linear part of it.
//
// What is exactly measurable is what fatigue does to the skeleton, and that is
// measured where skeletons are measured.

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
