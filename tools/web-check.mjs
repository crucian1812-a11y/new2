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
const page = await (await browser.newContext({ viewport: { width: 900, height: 506 } })).newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[404?] ${r.url()} ${r.failure()?.errorText}`));

await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load' });

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
await page.waitForTimeout(8000);
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
if (!ok || !painted) {
  console.log(`${bad.length} error line(s); the build did not start`);
  process.exit(1);
}
console.log('the exported build runs in a browser');
