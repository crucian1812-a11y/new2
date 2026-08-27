// A transition, frame by frame.
//
// pose-check and the contact sheet both look at endpoints, and a transition is
// not its endpoints. Two poses can each be clean and the slerp between them run
// through a moment where a forearm is inside a ribcage, or where one fighter
// pops a foot through the mat and puts it back. Nothing in the project could
// see that moment, because the sim never stops on it.
//
// This stops on it. Eleven frames across one blend, from the same camera, so
// the middle of an exchange can be judged the way the endpoints already are.
//
//   node bjj/tools/strip.mjs CLOSED_GUARD MOUNT out/
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdirSync } from 'fs';

const from = process.argv[2];
const to = process.argv[3];
const out = process.argv[4] || 'strip';
const STEPS = +(process.env.STEPS || 11);
const PORT = +(process.env.PORT || 8099);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 480, height: 380 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

for (let i = 0; i < STEPS; i++) {
  const t = i / (STEPS - 1);
  await page.evaluate(([f, g, tt]) => {
    window.__bjj.setBlend(f, g, tt);
    const c = window.__bjj.camera;
    c.orbit = c.targetOrbit = 2.5;
    c.cutHold = 99;
    c._shot = 'ground';
    c.dist = 2.7;
    c.height = 1.05;
    c.aimY = 0.5;
    c.fovDeg = 36;
  }, [from, to, t]);
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${out}/${String(i).padStart(2, '0')}.png` });
}
console.log(`${from} -> ${to}: ${STEPS} frames in ${out}/`);
await browser.close();
