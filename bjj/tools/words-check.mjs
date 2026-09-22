// What the screen says, and in which language.
//
// The game speaks Russian, and a critic's pass found it saying «твой пояс:
// WHITE» on the title card and «white belt — ещё раз» on the result: the
// ladder's own keys, printed where a sentence was meant. Nobody reads source
// for that; it is only visible on the glass. So this reads the glass: every
// string the HUD hands to fillText, on the title card, in the room, through
// live positions, a submission from both sides, the result card and the belt
// card, and every word in Latin letters that is not on the list below.
//
// The list is the scoreboard and the sport's own vocabulary, on purpose:
//   · the scorebug is an IBJJF board — IBJJF · ADULTO, ADV, and the referee's
//     COMBATE — and a Russian broadcast shows it as it is;
//   · the grey line under each position is its English name (MOUNT, CLOSED
//     GUARD), which is what the move is called in every Russian gym too;
//   · JIU-JITSU is the name on the door.
// Anything else in Latin letters is a key or a placeholder that escaped.
//
//   node bjj/tools/words-check.mjs
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const ALLOWED = new Set(['JIU', 'JITSU', 'IBJJF', 'ADULTO', 'ADV', 'COMBATE']);

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Every string any 2D canvas is asked to draw, and on which screen.
await page.addInitScript(() => {
  window.__said = new Map();
  window.__screen = 'load';
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...rest) {
    const s = String(t);
    const k = s + '\u0000' + window.__screen;
    if (!window.__said.has(k)) window.__said.set(k, [s, window.__screen]);
    return orig.call(this, t, ...rest);
  };
});
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html?seed=11`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });

const at = (name) => page.evaluate((n) => { window.__screen = n; }, name);
const wait = (ms) => page.waitForTimeout(ms);

await at('title'); await wait(1500);
await at('room'); await page.evaluate(() => window.__bjj.openGym()); await wait(1200);
await at('match');
await page.evaluate(() => { window.__bjj.toTitle(); window.__bjj.match().start(); });
const poses = await page.evaluate(() => Object.keys(window.__bjj.POSES).filter((k) => !window.__bjj.POSES[k].waypoint));
for (const p of poses) {
  await page.evaluate((q) => window.__bjj.setPose(q), p);
  await wait(250);
}
await at('submission');
await page.evaluate(async () => {
  const { TRANSITIONS } = await import('/bjj/src/game/positions.js');
  const m = window.__bjj.match();
  const tr = TRANSITIONS.find((t) => t.sub && t.from === 'MOUNT');
  m._startSub(0, tr);
});
await wait(800);
await page.evaluate(async () => {
  const { TRANSITIONS } = await import('/bjj/src/game/positions.js');
  const m = window.__bjj.match();
  m.sub = null; m.state = 'live';
  m._startSub(1, TRANSITIONS.find((t) => t.sub && t.from === 'BACK'));
});
await wait(800);
await at('result, lost');
await page.evaluate(() => { const m = window.__bjj.match(); m.sub = null; m.state = 'live'; m.f[1].points = 4; m._finish(1, 'points'); });
await wait(1500);
await at('result, won');
await page.evaluate(() => { window.__bjj.toTitle(); const m = window.__bjj.match(); m.start(); m.f[0].points = 4; m._finish(0, 'points'); });
await wait(2500);

const said = await page.evaluate(() => [...window.__said.values()]);
const labels = new Set((await page.evaluate(() => Object.values(window.__bjj.POSES).map((p) => p.label || '')))
  .flatMap((l) => l.toUpperCase().split(/[^A-Z]+/)).filter(Boolean));

const bad = [];
for (const [text, where] of said) {
  const words = text.match(/[A-Za-z]{2,}/g) || [];
  const stray = words.filter((w) => !ALLOWED.has(w.toUpperCase()) && !labels.has(w.toUpperCase()));
  if (stray.length) bad.push(`«${text}» (${where})`);
}
const screens = new Set(said.map(([, w]) => w));
console.log(`     ${said.length} distinct strings on ${screens.size} screens: ${[...screens].join(', ')}`);
check(['title', 'room', 'match', 'submission', 'result, lost', 'result, won'].every((s) => screens.has(s)),
  'every screen was read', [...screens].join(', '));
check(bad.length === 0, 'the screen speaks Russian',
  bad.length ? `${bad.length} strings in Latin letters: ${bad.slice(0, 6).join(', ')}` : 'Latin only where the list allows it');
check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
await browser.close();
console.log(fail ? `\n${fail} check(s) failed` : '\nthe screen speaks one language');
process.exitCode = fail ? 1 : 0;
