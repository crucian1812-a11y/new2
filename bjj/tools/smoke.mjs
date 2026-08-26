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
check(errors.length === 0, 'no errors on the page', errors.slice(0, 3).join(' | '));
check(stats && stats.fps > 8, 'frame rate is sane under software GL', stats && `${stats.fps} fps`);

// Is anything actually drawn? Sample the framebuffer and look for colour.
const shot = await page.screenshot({ type: 'png' });
// Ask the renderer to sample its own frame before it is presented; a read
// after the swap is not defined to return anything at all.
const lum = await page.evaluate(async () => {
  window.__bjj.renderer.probe = true;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return window.__bjj.renderer.lum || [];
});
const bright = lum.filter((v) => v > 12).length;
check(bright >= 10, 'the mat is actually lit', `${bright}/16 samples above black`);
check(shot.length > 20000, 'the frame encodes to a real image', `${(shot.length / 1024) | 0}kb`);

await browser.close();
console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
