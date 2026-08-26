// One pose from four sides.
//
// The contact sheet shoots every pose from the same three-quarter angle, which
// is the right shot for comparing fifteen of them and the wrong one for judging
// any single one: a mount that looks fine from the front can have both knees on
// the same side of the man underneath and the camera will never say so.
//
//   node bjj/tools/angles.mjs MOUNT out/
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdirSync } from 'fs';

const pose = process.argv[2] || 'MOUNT';
const out = process.argv[3] || 'angles';
const PORT = +(process.env.PORT || 8099);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 520, height: 400 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// Front, side, overhead, back. Overhead is the one that catches legs on the
// wrong side of a hip, which is the error a pose solver is happiest to make.
const VIEWS = [
  ['front', 0, 1.0, 2.6, 34],
  ['side', Math.PI / 2, 1.0, 2.6, 34],
  ['top', 0.8, 2.5, 2.2, 42],
  ['back', Math.PI, 1.0, 2.6, 34],
];

for (const [name, orbit, height, dist, fov] of VIEWS) {
  await page.evaluate(([p, o, h, d, f]) => {
    window.__bjj.setPose(p);
    const c = window.__bjj.camera;
    c.orbit = c.targetOrbit = o;
    c.cutHold = 99;
    c.dist = d;
    c.height = h;
    c.aimY = 0.44;
    c.fovDeg = f;
  }, [pose, orbit, height, dist, fov]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${pose}-${name}.png` });
  console.log(`${pose}-${name}`);
}
await browser.close();
