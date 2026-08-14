// Builds the single-file bundle and boots it, from a file:// URL, the way
// somebody who saved `spiel.html` to their phone would.
//
// The bundler flattens twenty-odd ES modules into one scope, so it enforces
// something the game itself never has to think about: no two modules may
// share a top-level name. A `const clamp` added to one file is invisible
// everywhere the game is developed — the dev server, every check in this
// suite, the deployed multi-file build — and breaks only the offline copy, at
// deploy time, in a log nobody reads. So it gets built and opened here.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';

const out = join(tmpdir(), `spiel-check-${process.pid}.html`);

const build = await new Promise((resolve) => {
  const p = spawn('node', ['tools/bundle.mjs', out], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (d) => (log += d));
  p.stderr.on('data', (d) => (log += d));
  p.on('close', (code) => resolve({ code, log }));
});
console.log(build.log.trim());
if (build.code !== 0) {
  console.log('BUNDLE PROBLEM');
  process.exit(1);
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 420 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto('file://' + out, { waitUntil: 'load' });

let booted = true;
await page
  .waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, { timeout: 60000 })
  .catch(() => (booted = false));

// Not just "it loaded": a run has to start and the world has to draw a frame.
const state = await page.evaluate(async () => {
  const g = window.__game;
  if (!g) return { error: 'no game' };
  g.newRun('ritter', 4242);
  await new Promise((r) => setTimeout(r, 1200));
  return {
    state: g.state,
    props: g.zone?.props.length ?? 0,
    monsters: g.monsters.length,
    worldPixels: window.__renderer ? window.__renderer.w * window.__renderer.h : 0,
  };
});
await browser.close();
await unlink(out).catch(() => {});

console.log(JSON.stringify(state));
const ok = booted && state.state === 'playing' && state.props > 0 && state.worldPixels > 0 && !errors.length;
for (const e of errors.slice(0, 8)) console.log('FAIL page error: ' + e);
if (!booted) console.log('FAIL the bundle never finished loading');
console.log(ok ? 'BUNDLE OK' : 'BUNDLE PROBLEM');
process.exit(ok ? 0 : 1);
