// Boot the real page, play it for a while with synthetic swipes, and insist
// that nothing threw and that the picture is not black.
//
// A renderer can fail in a way no unit test sees: a shader that links on the
// desktop and not on a phone, a uniform that silently clamps, a frame that is
// technically drawn and entirely dark. This is the check for that.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const browser = await chromium.launch({
  // The sandbox ships a browser; CHROME_PATH points at it when the npm copy
  // and the installed one disagree about their version number.
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 812, height: 375 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// Start it, then swipe around for a few seconds the way a player would.
await page.mouse.click(600, 200);
const dirs = [[0, -90], [0, 90], [-90, 0], [90, 0]];
for (let i = 0; i < 22; i++) {
  const [dx, dy] = dirs[i % 4];
  await page.mouse.move(620, 200);
  await page.mouse.down();
  await page.mouse.move(620 + dx, 200 + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(320);
}

const stats = await page.evaluate(() => window.__stats);
check(!!stats, 'the loop is running', JSON.stringify(stats));

// Say out loud which renderer this ran on. Headless Chrome falls back to a
// software rasteriser without telling you, and a software rasteriser is the
// first thing you blame when the picture is wrong — which makes it the last
// thing you should be guessing about.
const renderer = await page.evaluate(() => {
  const gl = document.getElementById('gl').getContext('webgl2');
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const soft = /swiftshader|llvmpipe|lavapipe|software/i.test(renderer);
console.log(`     renderer: ${renderer}${soft ? '  (SOFTWARE — frame rate here means nothing)' : ''}`);
check(errors.length === 0, 'no errors on the page', errors.slice(0, 3).join(' | '));
// Only where the frame rate means anything. Under SwiftShader it does not —
// this box draws four or five frames a second and a phone with a GPU draws
// sixty — and the check used to pass regardless for a worse reason: the fps
// readout was computed from a dt capped at 50 ms and could not go below 20.
// What is worth checking under software GL is that the loop is advancing at
// all, which the position and the clock in __stats say.
if (soft) check(stats && stats.fps > 0.5, 'the loop advances under software GL', stats && `${stats.fps} fps`);
else check(stats && stats.fps > 30, 'frame rate is sane', stats && `${stats.fps} fps`);

// Is anything actually drawn? Sample the framebuffer and look for colour.
const shot = await page.screenshot({ type: 'png' });
// Ask the renderer to sample its own frame before it is presented; a read
// after the swap is not defined to return anything at all.
const probe = await page.evaluate(async () => {
  window.__bjj.renderer.probe = true;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = window.__bjj.renderer;
  return { lum: r.lum || [], nan: r.hdrNaN || null };
});
const lum = probe.lum;
check(
  probe.nan !== null && probe.nan.nan === 0,
  'no NaN reached the HDR buffer',
  probe.nan ? `${probe.nan.nan} of ${probe.nan.sampled * 3} channels` : 'probe did not run'
);
const bright = lum.filter((v) => v > 12).length;
check(bright >= 10, 'the mat is actually lit', `${bright}/16 samples above black`);
check(shot.length > 20000, 'the frame encodes to a real image', `${(shot.length / 1024) | 0}kb`);

/* ---------------------------------------------------- what a score looks like */

// Three points used to arrive as a grey line in the corner, in the same size
// and the same place as «стоп». The pill says the number and what it was for,
// in the colour of whoever it belongs to — so what is checked here is that it
// appears at all, that it is the right man's colour, and that it goes: a thing
// that pops up on its own and clears itself is a thing that can quietly stop
// doing either.
{
  const punch = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const g = window.__bjj;
    const cv = g.hud.canvas, c2 = cv.getContext('2d');
    const dpr = cv.width / cv.clientWidth;
    const L = g.hud.punchLayout();
    // What the pill puts on the glass: the fill under its middle, and which
    // way the colour leans across the whole of it. Both read off the HUD's own
    // layout rather than off numbers copied out of it.
    const read = () => {
      const x0 = Math.round((L.x - 70) * dpr), x1 = Math.round((L.x + 70) * dpr);
      const y0 = Math.round((L.y - L.h / 2) * dpr), y1 = Math.round((L.y + L.h / 2) * dpr);
      const d = c2.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let green = 0, red = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 40) continue;
        if (d[i + 1] > d[i] + 30) green++;
        if (d[i] > d[i + 1] + 30) red++;
      }
      const mid = c2.getImageData(Math.round(L.x * dpr), Math.round(L.y * dpr), 1, 1).data;
      return { green, red, mid: [mid[0], mid[1], mid[2], mid[3]] };
    };
    const held = (fn, ms = 20000) => {
      const t0 = Date.now();
      return (async () => { while (!fn() && Date.now() - t0 < ms) await wait(80); return fn(); })();
    };
    const m = g.match();
    // Nothing else on the glass first.
    //
    // The pill is read at the pixel, and the first version of this read
    // whatever the match happened to be doing: the swipes above can leave a
    // submission running, and the submission panel paints across the middle of
    // the screen — the same middle the pill sits in. It reported an opaque
    // green pixel where the pill was not, and a red pill as green.
    m.state = 'live';
    m.sub = null; m.attempt = null; m.deny = null; m.hold = null;
    await wait(120);
    const before = read();
    // The same call the match makes when a hold is paid off.
    m.onEvent({ kind: 'points', by: 0, points: 4, note: 'прошёл гард' });
    await held(() => g.punch() && g.punch().t > 0.25);
    const mine = read();
    await held(() => !g.punch());
    const after = read();
    m.onEvent({ kind: 'points', by: 1, points: 2, note: 'свип' });
    await held(() => g.punch() && g.punch().t > 0.25);
    const his = read();
    await held(() => !g.punch());
    return { before, mine, after, his };
  });
  check(punch.mine.mid[3] > 200 && punch.before.mid[3] < 200,
    'a score puts a pill on the glass', `alpha ${punch.before.mid[3]} → ${punch.mine.mid[3]}`);
  check(punch.after.mid[3] < 200, 'and it clears itself', `alpha back to ${punch.after.mid[3]}`);
  check(punch.mine.green > punch.mine.red && punch.his.red > punch.his.green,
    'and it is the colour of whoever scored',
    `yours ${punch.mine.green}g/${punch.mine.red}r, his ${punch.his.red}r/${punch.his.green}g`);
}

// And the half-second of slow motion a four-point moment buys. The cut and the
// roar were always there; what was missing was time to see the pass happen.
{
  const beat = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const g = window.__bjj;
    const m = g.match();
    const idle = g.slow();
    m.onEvent({ kind: 'position', tr: { big: true, dir: 'left' }, to: m.position });
    const lit = g.slow();
    const t0 = Date.now();
    while (g.slow() > 0 && Date.now() - t0 < 20000) await wait(60);
    return { idle, lit, spent: g.slow(), took: (Date.now() - t0) / 1000 };
  });
  check(beat.idle === 0 && beat.lit > 0.3, 'a four-point moment buys a beat of slow motion',
    `${beat.lit.toFixed(2)}s`);
  check(beat.spent === 0 && beat.took < 4, 'and the beat is spent, not held',
    `gone after ${beat.took.toFixed(1)}s of wall clock`);
}

/* ------------------------------------------------- the shell round a match */

// Title, match, result, and the next man out — without a reload, and with the
// belt still there after one. This is the part of the game that is not the
// match, and until the ladder existed there was nothing here to check.
{
  const ladder = await page.evaluate(async () => {
    const ui = document.getElementById('ui');
    const press = () => {
      for (const type of ['pointerdown', 'pointerup']) {
        ui.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientX: 600, clientY: 200, bubbles: true }));
      }
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const m0 = window.__bjj.match();
    const belt0 = m0.f[1].name && localStorage.getItem('bjj.progress');
    // Run the clock out rather than playing it out: what is being checked is
    // the shell, and the sim has four hundred matches of its own in sim-check.
    m0.f[0].points = 2;
    // And press a real move first, so the разбор has something to name and the
    // gym check below is not passing on an empty match. The swipes above are a
    // thumb on glass and they mostly land on a grip fight; this is the ring's
    // own door, pressed through the same входы the player's thumb reaches.
    for (let i = 0; i < 6; i++) {
      if (m0.tape.some((r) => r.k === 'press' && r.res === 'go')) break;
      const o = m0.options(0);
      const dir = Object.keys(o).find((k) => o[k]);
      if (dir) m0.input(0, dir);
      await wait(350);
    }
    m0.time = 0.1;
    // Waited for, not slept through: this page draws one frame a second under
    // a software rasteriser and the clock only moves when a frame does.
    const until = async (fn, ms = 30000) => {
      const t0 = Date.now();
      while (!fn() && Date.now() - t0 < ms) await wait(200);
      return fn();
    };
    await until(() => window.__bjj.match().state === 'over');
    const over = window.__bjj.match().state;
    // Two points against the man at your own rung is a promotion, so the belt
    // card is what comes up first — and it refuses a press for the first eight
    // tenths of a second on purpose, because the bell, the roar and the card
    // all land in the same instant. A tool that presses straight through the
    // ceremony is a tool that would not notice the ceremony disappearing.
    const belt = window.__bjj.promo();
    const shown = belt && { label: belt.label, beatOf: belt.beatOf, nextMan: belt.nextMan };
    press();
    const early = !!window.__bjj.promo();
    await until(() => window.__bjj.promo() && window.__bjj.promo().t > 0.9);
    // The belt is drawn rather than written, so it is read at the pixel: the
    // band has to be the belt's own colour and the bar at its end has to be
    // the bar. Everything else about this card is a string a test could pass
    // while the screen showed nothing at all.
    const paint = (() => {
      const hud = window.__bjj.hud;
      const cv = hud.canvas;
      const g = cv.getContext('2d');
      const dpr = cv.width / cv.clientWidth;
      const at = (x, y) => {
        const d = g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
      };
      const L = hud.promoLayout();
      const p = window.__bjj.promo();
      return {
        want: p.col.map((v) => Math.round(v * 255)),
        // Below the middle of the band, out of the highlight and above the
        // shadow: the cloth itself.
        band: at(L.band.x + L.band.w * 0.3, L.band.y + L.band.h * 0.55),
        bar: at(L.bar.x + L.bar.w / 2, L.bar.y + L.bar.h * 0.55),
      };
    })();
    press();
    await until(() => !window.__bjj.promo());
    const gone = !window.__bjj.promo();
    press();
    await until(() => window.__bjj.match() !== m0);
    const m1 = window.__bjj.match();
    const goes = m0.tape.filter((r) => r.k === 'press' && r.res === 'go');
    const card = window.__bjj.hud.result;
    // The thread from a finished match to the room next door, read here rather
    // than in the gym block below: that one runs after a reload, and a reload
    // is a fresh page with nothing behind it. The check passed for two runs on
    // exactly that — «the match named nothing», every time.
    window.__bjj.openGym();
    const r0 = window.__bjj.gym().rows[0].tr;
    return {
      pressed: goes.length, keys: goes.map((r) => r.key).slice(0, 3),
      named: card && card.drill ? card.drill.key : null,
      first: window.__bjj.gym().first,
      top: `${r0.from}|${r0.role}|${r0.dir}`,
      over, shown, early, gone, paint,
      next: m1.state, fresh: m1 !== m0, saved: localStorage.getItem('bjj.progress'), belt0,
    };
  });
  check(ladder.over === 'over', 'the match ends on the clock', ladder.over);
  check(ladder.pressed > 0, 'and the player got a move off in it',
    `${ladder.pressed} presses went through: ${ladder.keys.join(', ') || 'none'}`);
  // The one thread between losing a fight and doing something about it: the
  // разбор names the move the player kept reaching for, and the room puts that
  // move on its first row.
  check(!!ladder.named && ladder.named === ladder.first && ladder.first === ladder.top,
    'the move the разбор names is the room\u2019s first row',
    `card ${ladder.named || 'named nothing'}, room ${ladder.top}`);
  check(!!ladder.shown, 'a win on your own rung puts the belt on the screen',
    ladder.shown ? `${ladder.shown.label} ПОЯС, выиграл у ${ladder.shown.beatOf}, дальше ${ladder.shown.nextMan}` : 'no card');
  check(ladder.early, 'and the first touch, in the same instant as the bell, does not wipe it');
  {
    const { want, band, bar } = ladder.paint;
    // The sheen rides on top of the cloth, so this is a band of tolerance and
    // not an equality: what is being caught is a belt drawn in the wrong
    // colour, or not drawn at all.
    const near = band.every((v, i) => i === 3 ? v > 250 : Math.abs(v - want[i]) <= 26);
    check(near, 'the band on it is the belt\u2019s own colour',
      `rgb(${band.slice(0, 3)}) against rgb(${want})`);
    // And the black bar at the end of it is not the belt: on the blue belt the
    // two differ by the whole of the blue.
    const apart = Math.abs(bar[0] - band[0]) + Math.abs(bar[1] - band[1]) + Math.abs(bar[2] - band[2]);
    check(apart > 40 && bar[3] > 250, 'and the rank bar at its end is a bar',
      `rgb(${bar.slice(0, 3)}), ${apart} apart from the cloth`);
  }
  check(ladder.gone, 'a touch takes it away once it has been up long enough to read');
  check(ladder.fresh && ladder.next !== 'over', 'a touch puts the next man on the mat', ladder.next);
  check(!!ladder.saved, 'the ladder is written down', ladder.saved || 'nothing in localStorage');
  {
    // And who it was written against. The ladder says how far you got; the
    // record beside each name says which of the five you own.
    const rec = ladder.saved && JSON.parse(ladder.saved).rec;
    check(!!rec && rec.white && rec.white[0] === 1 && rec.white[1] === 0,
      'and so is the record against the man you beat',
      rec ? `white ${rec.white && rec.white.join('—')}` : 'no record kept');
  }
  const kept = await page.evaluate(() => localStorage.getItem('bjj.progress'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => localStorage.getItem('bjj.progress'));
  check(after === kept, 'and it survives a reload', `${after}`);
}

// The room next door. drill-check plays every drill in Node and measures what
// each round is worth; what it cannot see is the wiring — whether the door on
// the title card opens, whether a row in the list starts the drill it names,
// and whether the pair actually arrives in the position that drill starts
// from. Three questions, all of them about this page.
{
  const gym = await page.evaluate(async () => {
    const g = window.__bjj;
    g.openGym();
    const rows = g.gym().rows.map((r) => ({ name: r.tr.name, from: r.tr.from }));

    g.startDrill(0);
    await new Promise((r) => setTimeout(r, 400));
    const d = g.drill();
    const at = g.match().position;
    g.endDrill();
    await new Promise((r) => setTimeout(r, 200));
    return { rows, name: d && d.tr.name, want: d && d.tr.from, at,
             pages: g.gym().pages, back: g.gym().screen, after: !!g.drill() };
  });
  check(gym.rows.length > 0 && gym.pages > 1, 'the room has a list in it',
    `${gym.rows.length} on the page, ${gym.pages} pages, first «${gym.rows[0] && gym.rows[0].name}»`);
  check(gym.name === gym.rows[0].name, 'a row starts the drill it names',
    `${gym.name} vs ${gym.rows[0].name}`);
  check(gym.at === gym.want, 'and the pair starts where that drill starts',
    `${gym.at} vs ${gym.want}`);
  check(gym.back === 'gym' && !gym.after, 'and leaving one puts you back in the room');

}

// Fatigue is checked in pose-check, not here.
//
// It was here, comparing the frame with a fresh fighter against the frame with
// a spent one, and every version of that check passed with the whole feature
// commented out. Three reasons, all worth knowing before trying again:
// comparing PNG bytes says 99% for a one-pixel change; comparing pixels is
// swamped by half-a-pixel jitter on the edges; and the scene brightens as it
// runs — six identical passes measured 97.9, 97.9, 98.3, 99.1, 100.5, 101.5 —
// so any two readings taken at different times differ by more than the thing
// being measured, and a palindrome only cancels the linear part of it.
//
// What is exactly measurable is what fatigue does to the skeleton, and that is
// measured where skeletons are measured.

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
