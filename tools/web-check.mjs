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
import { report } from './budget.mjs';
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
await page.waitForTimeout(TOUCH ? 1500 : 6000);

// What the game says about itself, through the `?probe` window.
const probe = () => page.evaluate(() => window.__weg || null);

// A real touch sequence, dispatched as DOM events on the canvas.
//
// Playwright's touchscreen can tap and nothing else, and a thumbstick is
// entirely about the drag. These are genuine TouchEvents with a real
// identifier, which is the only way to test two fingers at once — and two
// fingers at once is the whole reason the controls exist: steering while
// swinging is what an action game is.
const touchSeq = (steps) =>
  page.evaluate(async (steps) => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const live = new Map();
    const fire = (type, ids) => {
      const list = ids.map((id) => {
        const p = live.get(id);
        return new Touch({
          identifier: id,
          target: c,
          clientX: r.left + p.x,
          clientY: r.top + p.y,
          pageX: r.left + p.x,
          pageY: r.top + p.y,
        });
      });
      const all = [...live.keys()].map((id) => {
        const p = live.get(id);
        return new Touch({
          identifier: id,
          target: c,
          clientX: r.left + p.x,
          clientY: r.top + p.y,
          pageX: r.left + p.x,
          pageY: r.top + p.y,
        });
      });
      c.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          changedTouches: list,
          touches: type === 'touchend' ? all.filter((t) => ids.indexOf(t.identifier) < 0) : all,
          targetTouches: type === 'touchend' ? all.filter((t) => ids.indexOf(t.identifier) < 0) : all,
        })
      );
    };
    for (const s of steps) {
      if (s.wait) {
        await new Promise((r2) => setTimeout(r2, s.wait));
        continue;
      }
      live.set(s.id, { x: s.x, y: s.y });
      fire(s.type, [s.id]);
      if (s.type === 'touchend') live.delete(s.id);
    }
  }, steps);

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
let walked_button = null;
if (TOUCH) {
  const box = await page.locator('canvas').boundingBox();

  // Positions come from the game's own viewport, mapped back to CSS pixels.
  // Guessing them from the canvas size is how the first version of this test
  // pressed empty screen and reported the controls broken.
  const v0 = await probe();
  const sx = box.width / (v0 && v0.vw ? v0.vw : box.width);
  const sy = box.height / (v0 && v0.vh ? v0.vh : box.height);
  const W = (v0 && v0.vw ? v0.vw : box.width) * sx;
  const H = (v0 && v0.vh ? v0.vh : box.height) * sy;

  // The stick is tested first, before the skeletons arrive. They spawn eleven
  // metres out and take about five seconds to close, and once six of them are
  // pressed against him he cannot move whatever the thumb says — which is
  // correct behaviour and made the first version of this test report the
  // controls broken.
  const ox = W * 0.22;
  const oy = H * 0.62;
  const hold = (dx) => {
    const out = [{ type: 'touchstart', id: 1, x: ox, y: oy }];
    for (let i = 1; i <= 6; i++)
      out.push({ type: 'touchmove', id: 1, x: ox + (dx * i) / 6, y: oy }, { wait: 30 });
    return out;
  };

  const a0 = await probe();
  await touchSeq(hold(-150));
  await page.waitForTimeout(1600);
  const left = await probe();
  await touchSeq([{ type: 'touchend', id: 1, x: ox - 150, y: oy }]);

  await touchSeq(hold(150));
  await page.waitForTimeout(1600);
  const right = await probe();
  await touchSeq([{ type: 'touchend', id: 1, x: ox + 150, y: oy }]);

  // Untouched, for comparison: he must not wander off on his own, or "he
  // moved" proves nothing about the thumb.
  const b0 = await probe();
  await page.waitForTimeout(1600);
  const b1 = await probe();
  const drift = b0 && b1 ? Math.hypot(b1.x - b0.x, b1.z - b0.z) : -1;

  // And an ability button pressed by a second finger while the stick is still
  // down: the case single-pointer mouse emulation cannot serve at all.
  const cx = W - 92 * sx;
  const cy = H - 88 * sy;
  const before = await probe();
  await touchSeq([
    { type: 'touchstart', id: 1, x: ox, y: oy },
    { wait: 120 },
    { type: 'touchmove', id: 1, x: ox - 90, y: oy },
    { wait: 120 },
    { type: 'touchstart', id: 2, x: cx - 116 * sx, y: cy - 20 * sy },
    { wait: 250 },
    { type: 'touchend', id: 2, x: cx - 116 * sx, y: cy - 20 * sy },
    { wait: 350 },
  ]);
  const after = await probe();
  await touchSeq([{ type: 'touchend', id: 1, x: ox - 90, y: oy }]);
  walked_button = {
    fired: after && before ? after.cd[1] > 0.1 && before.cd[1] <= 0.1 : false,
    stillSteering: after ? Math.hypot(after.sx || 0, after.sy || 0) > 0.3 : false,
  };

  const measured = await framerate(3000);
  walked = {
    drift,
    reach: left && right ? Math.hypot(right.x - left.x, right.z - left.z) : -1,
    hp: right ? right.hp : -1,
    tilt: left ? Math.hypot(left.sx || 0, left.sy || 0) : 0,
    fps: measured,
    tris: right && right.tris ? right.tris : -1,
    frame: right || null,
    from: a0,
    left,
    right,
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
  const { drift, reach, hp, fps } = walked;
  console.log(
    `thumbstick: he covers ${reach.toFixed(1)} units between opposite holds, ` +
      `${drift.toFixed(1)} when untouched; ${hp.toFixed(0)} hp left` +
      ` (stick read ${walked.tilt.toFixed(2)} at full hold; ` +
      `x went ${walked.left.x.toFixed(1)} then ${walked.right.x.toFixed(1)})`
  );
  console.log(
    `ability button under a second finger: ` +
      `${walked_button && walked_button.fired ? 'fires' : 'DID NOT FIRE'}, ` +
      `and the stick ${walked_button && walked_button.stillSteering ? 'keeps steering' : 'WAS DROPPED'}`
  );
  console.log(
    `frame rate: ${fps.toFixed(1)} fps — on a software rasteriser, so this is ` +
      `useful only against another run of the same kind`
  );
  if (!(reach > 3.0 && reach > drift * 2.5)) {
    console.log('the thumbstick does not steer him — the game is unplayable on a phone');
    process.exit(1);
  }
  if (!(walked_button && walked_button.fired && walked_button.stillSteering)) {
    console.log('a second finger cannot use an ability while the stick is held — one thumb or the other');
    process.exit(1);
  }
  if (walked.frame && walked.frame.draws !== undefined) {
    console.log('cost of a frame, which does not depend on the hardware:');
    if (report(walked.frame) > 0) {
      console.log('over budget — ask the device that matters before shipping this');
      process.exit(1);
    }
  }
}
if (!ok || !painted) {
  console.log(`${bad.length} error line(s); the build did not start`);
  process.exit(1);
}
console.log('the exported build runs in a browser');
