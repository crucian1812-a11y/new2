// Screenshot / smoke-test driver. Usage:
//   node tools/shot.mjs <url-path> <out.png> [--w 980 --h 441 --dpr 3 --wait 2000 --full]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const urlPath = args[0] || '/index.html';
const out = args[1] || 'shot.png';
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const has = (n) => args.includes('--' + n);

const W = +flag('w', 980);
const H = +flag('h', 441);
const DPR = +flag('dpr', 2);
const WAIT = +flag('wait', 2500);
const PORT = +flag('port', 8099);

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: DPR,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 15; 24122RKC7G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));

await page.goto(`http://127.0.0.1:${PORT}${urlPath}`, { waitUntil: 'load' });
await page.waitForTimeout(WAIT);

const stats = await page.evaluate(() => window.__stats || null);
await page.screenshot({ path: out, fullPage: has('full') });
console.log(JSON.stringify({ stats, logs }, null, 2));
await browser.close();
