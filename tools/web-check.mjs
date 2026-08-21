// Does the exported build actually start in a browser?
//
// "It exported" and "it runs" are different claims. A Godot web build can
// export cleanly and then die in the browser on any of: a missing MIME type,
// a threaded template asking for SharedArrayBuffer that GitHub Pages will
// never grant, or WebGL2 being unavailable. None of those show up in the
// export log, and all of them look identical from the outside — a black page.
//
// So this serves the build over HTTP, opens it in Chromium, and waits for the
// engine to say it is running. It fails loudly rather than saving a black
// screenshot and calling it a deployment.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const ROOT = process.argv[2] || 'build/web';
const OUT = process.argv[3] || '/tmp/shots/web.png';
// --touch emulates a phone and checks the game can actually be played with a
// finger. That is not a detail: there is no WASD on a touch screen, and the
// first build that went up could be hit by tapping but could not be walked,
// so it looked like the game was broken rather than the controls missing.
const TOUCH = process.argv.includes('--touch');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream', '.png': 'image/png', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  try {
    await stat(p);
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch {
    res.writeHead(404).end('no');
  }
});
await new Promise((r) => server.listen(8123, r));

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (
  await browser.newContext(
    TOUCH
      ? { viewport: { width: 880, height: 420 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
      : { viewport: { width: 900, height: 506 } }
  )
).newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[404?] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(`http://127.0.0.1:8123/index.html${TOUCH ? '?probe' : ''}`, { waitUntil: 'load' });

// Godot removes its own status overlay once the engine is up. Waiting on a
// drawn frame instead of a fixed sleep is what makes this a check.
let ok = false;
try {
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas');
      if (!c || !c.width) return false;
      const s = document.getElementById('status');
      return !s || s.style.visibility === 'hidden' || getComputedStyle(s).display === 'none';
    },
    null,
    { timeout: 180000 }
  );
  ok = true;
} catch {}

// Let a few frames land so the shot is of the game, not of frame zero.
await page.waitForTimeout(6000);

// What the game says about itself, through the `?probe` window.
const probe = () => page.evaluate(() => window.__weg || null);

let walked = null;
if (TOUCH) {
  const box = await page.locator('canvas').boundingBox();
  const mid = box.y + box.height * 0.55;
  // Untouched first: he must not wander off on his own, or "he moved" proves
  // nothing about the tap.
  const a0 = await probe();
  await page.waitForTimeout(3500);
  const a1 = await probe();
  const drift = a0 && a1 ? Math.hypot(a1.x - a0.x, a1.z - a0.z) : -1;

  await page.touchscreen.tap(box.x + box.width * 0.12, mid);
  await page.waitForTimeout(4000);
  const left = await probe();
  await page.touchscreen.tap(box.x + box.width * 0.88, mid);
  await page.waitForTimeout(4500);
  const right = await probe();

  walked = {
    drift,
    reach: left && right ? Math.hypot(right.x - left.x, right.z - left.z) : -1,
    hp: right ? right.hp : -1,
  };
}

await page.screenshot({ path: OUT });

const painted = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return c ? { w: c.width, h: c.height } : null;
});

await browser.close();
server.close();

const bad = logs.filter((l) => /pageerror|404\?|\[error\]/.test(l));
for (const l of logs.slice(-25)) console.log(l);
console.log(`canvas ${painted ? `${painted.w}x${painted.h}` : 'MISSING'}, engine started: ${ok}`);
if (walked) {
  const { drift, reach, hp } = walked;
  console.log(
    `tap-to-walk: he covers ${reach.toFixed(1)} units between opposite taps, ` +
      `${drift.toFixed(1)} when untouched; ${hp.toFixed(0)} hp left`
  );
  if (!(reach > 3.0 && reach > drift * 2.5)) {
    console.log('tapping the ground does not move him — the game is unplayable on a phone');
    process.exit(1);
  }
}
if (!ok || !painted) {
  console.log(`${bad.length} error line(s); the build did not start`);
  process.exit(1);
}
console.log('the exported build runs in a browser');
