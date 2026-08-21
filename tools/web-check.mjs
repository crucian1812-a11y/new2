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
// --vp WxH overrides the emulated screen. Frame rate here is measured on a
// software rasteriser with no GPU behind it, so the absolute number means
// little; how it scales with pixel count is what says whether the cost is
// fill rate (which a real phone GPU eats) or geometry (which it does not).
const VP = (process.argv.find((a) => a.startsWith('--vp=')) || '').slice(5);
const [VPW, VPH] = VP ? VP.split('x').map(Number) : [880, 420];
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
      ? { viewport: { width: VPW, height: VPH }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }
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

// Frame rate, counted from the browser rather than asked of the game. Godot's
// web build drives its loop from requestAnimationFrame, so counting callbacks
// measures the real thing — and it works on any build, including one already
// deployed that knows nothing about being measured.
const framerate = (ms) =>
  page.evaluate(
    (d) =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < d) requestAnimationFrame(tick);
          else res((n * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(tick);
      }),
    ms
  );

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

  // Frame rate, sampled over a second at the busiest moment — six skeletons
  // on screen, the fire lit, shadows on. A phone is the target and this is
  // the only number that says whether the world just built is affordable.
  const measured = await framerate(3000);
  walked = {
    drift,
    reach: left && right ? Math.hypot(right.x - left.x, right.z - left.z) : -1,
    hp: right ? right.hp : -1,
    fps: measured,
    tris: right && right.tris ? right.tris : -1,
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
  const { drift, reach, hp, fps, tris } = walked;
  console.log(
    `tap-to-walk: he covers ${reach.toFixed(1)} units between opposite taps, ` +
      `${drift.toFixed(1)} when untouched; ${hp.toFixed(0)} hp left`
  );
  console.log(`frame rate: ${fps.toFixed(1)} fps, ${tris > 0 ? (tris / 1000).toFixed(0) + 'k primitives' : 'primitives unknown'}`);
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
