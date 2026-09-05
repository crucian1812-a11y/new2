// Screenshot driver. Usage:
//   node bjj/tools/shot.mjs out.png [--w 900 --h 420 --wait 2500 --pose MOUNT --scene]
//   --clip x,y,w,h   just that rectangle of the page, at the same device scale,
//                    which is how you look closely at a hand rather than
//                    squinting at a whole match.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Playwright lives wherever the machine put it; a global install is normal on
// a CI box and there is no package.json here to hang a dependency off.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const args = process.argv.slice(2);
const out = args[0] || 'shot.png';
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const W = +flag('w', 900), H = +flag('h', 420), WAIT = +flag('wait', 2500);
const PORT = +flag('port', 8099);
const POSE = flag('pose', null);
const PLAY = +flag('play', 0);   // seconds of a real match before the shutter
const PATH = flag('path', '/bjj/index.html');
const CLIP = flag('clip', null);

const browser = await chromium.launch({
  // The sandbox ships a browser; CHROME_PATH points at it when the npm copy
  // and the installed one disagree about their version number.
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack||'').split('\n').slice(0,4).join('\n')}`));
await page.goto(`http://127.0.0.1:${PORT}${PATH}`, { waitUntil: 'load' });
await page.waitForTimeout(WAIT);
if (POSE) {
  await page.evaluate((p) => { window.__bjj.match().start(); window.__bjj.setPose(p); }, POSE);
  await page.waitForTimeout(1400);
}
if (PLAY) {
  // Start the match and play it the way a thumb would, so the frame that comes
  // out is a real moment and not the title card.
  await page.mouse.click(W * 0.75, H * 0.5);
  const dirs = [[0, -90], [90, 0], [0, -90], [-90, 0]];
  const until = Date.now() + PLAY * 1000;
  let i = 0;
  while (Date.now() < until) {
    const [dx, dy] = dirs[i++ % dirs.length];
    await page.mouse.move(W * 0.76, H * 0.5);
    await page.mouse.down();
    await page.mouse.move(W * 0.76 + dx, H * 0.5 + dy, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(420);
  }
}

const stats = await page.evaluate(() => window.__stats || null);
await page.screenshot({ path: out, clip: CLIP
  ? (([x, y, w, h]) => ({ x: +x, y: +y, width: +w, height: +h }))(CLIP.split(','))
  : undefined });
console.log(JSON.stringify(stats));
if (logs.length) console.log(logs.slice(0, 12).join('\n'));
await browser.close();
