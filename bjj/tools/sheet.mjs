// Contact sheet: one screenshot of every paired pose, from the same camera, so
// the whole library can be judged side by side. This is the fastest loop there
// is for pose work — change a number, run this, look.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdirSync } from 'fs';

const out = process.argv[2] || 'sheet';
const PORT = +(process.env.PORT || 8099);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 640, height: 420 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const ids = await page.evaluate(() => Object.keys(window.__bjj.POSES));
for (const id of ids) {
  await page.evaluate((p) => {
    window.__bjj.setPose(p);
    // Park the camera on a fixed three-quarter angle so poses can be compared.
    const c = window.__bjj.camera;
    c.orbit = c.targetOrbit = 2.5;
    c.cutHold = 99;
    c.dist = window.__bjj.POSES[p].ground ? 2.4 : 3.9;
    c.height = window.__bjj.POSES[p].ground ? 0.85 : 1.6;
  }, id);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${id}.png` });
  console.log(id);
}
await browser.close();
