// Does any writing on the screen land on other writing?
//
// The HUD and the menus are drawn by hand onto a canvas, and a canvas does not
// lay anything out: every label is put at a coordinate someone worked out, and
// two of them can share a coordinate on a screen nobody worked it out for. On
// a 480-pixel-wide phone the tournament row of the menu printed the man's name
// straight over the round's chip — «РАФАЭЛ» across «ФИНАЛ», both unreadable —
// and nothing in the battery looks at text, only at buttons (ring-check) and
// at whether the frame is black (smoke).
//
// This boots the page, and for each screen the game has (the menu, the gym,
// the fighter card, a match) on each size it is held at, catches every
// fillText of one frame on the visible canvas, turns it into the box it covers
// on the glass — measured by the browser, with the font and letter spacing it
// was drawn in — and reports any two different strings whose boxes overlap.
// The same string drawn twice in nearly the same place is a shadow or an
// outline, not a collision, and is left alone.
//
//   node bjj/tools/text-check.mjs           report, exit 1 on a collision
//   node bjj/tools/text-check.mjs --boxes   and every box of every screen

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const BOXES = process.argv.includes('--boxes');
// The phones ring-check holds the game on, plus the narrowest the game will
// still draw, where the collision above was found.
const SCREENS = [
  ['narrow', 480, 315],
  ['iPhone SE', 667, 375],
  ['iPhone 13', 844, 390],
  ['Pixel 7', 892, 412],
  ['iPad mini', 1024, 768],
];
// How much two boxes must share, in CSS pixels each way, to be a collision:
// glyph boxes are generous at the edges, and two words on one line set a
// letter's width apart will touch by a pixel without anybody seeing it.
const SLACK = 2;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

let fail = 0;
for (const [name, w, h] of SCREENS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const P = CanvasRenderingContext2D.prototype;
    const fill = P.fillText;
    P.fillText = function (text, x, y, maxW) {
      const log = window.__textLog;
      if (log && this.canvas.isConnected && String(text).trim()) {
        const m = this.measureText(text);
        let wd = m.width;
        if (maxW !== undefined && wd > maxW) wd = maxW;
        const a = this.textAlign, dir = this.direction;
        const left = a === 'center' ? x - wd / 2
          : a === 'right' || (a === 'end' && dir !== 'rtl') ? x - wd : x;
        const t = this.getTransform();
        // The canvas is drawn at its own resolution and shown at the page's.
        const r = this.canvas.getBoundingClientRect();
        const k = r.width / this.canvas.width;
        const pts = [[left, y - m.actualBoundingBoxAscent], [left + wd, y + m.actualBoundingBoxDescent]]
          .map(([px, py]) => [(t.a * px + t.c * py + t.e) * k + r.left, (t.b * px + t.d * py + t.f) * k + r.top]);
        log.push({
          text: String(text), alpha: this.globalAlpha,
          x0: Math.min(pts[0][0], pts[1][0]), y0: Math.min(pts[0][1], pts[1][1]),
          x1: Math.max(pts[0][0], pts[1][0]), y1: Math.max(pts[0][1], pts[1][1]),
        });
      }
      return fill.call(this, text, x, y, maxW);
    };
  });
  await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const frame = () => page.evaluate(() => new Promise((res) => {
    window.__textLog = [];
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const out = window.__textLog;
      window.__textLog = null;
      res(out);
    }));
  }));
  const views = [
    ['menu', async () => {}],
    ['gym', () => page.evaluate(() => window.__bjj.openGym())],
    ['fighter', () => page.evaluate(() => window.__bjj.openFighter())],
    // A match in each kind of position: the ring's labels and what they pay
    // are different words in each, and the longest ones are what collide.
    ...['STANDING', 'CLOSED_GUARD', 'SIDE_CONTROL', 'MOUNT', 'BACK', 'HALF_GUARD', 'KNEE_ON_BELLY', 'TURTLE']
      .map((pose, i) => [`match ${pose}`, () => page.evaluate(([p, first]) => {
        if (first) window.__bjj.match().start();
        window.__bjj.setPose(p);
      }, [pose, i === 0])]),
  ];
  for (const [view, open] of views) {
    await open();
    await page.waitForTimeout(900);
    // Only what can be read: a label at a few per cent alpha is fading out.
    const boxes = (await frame()).filter((b) => b.alpha > 0.15 && b.x1 - b.x0 > 1);
    if (BOXES) for (const b of boxes) console.log(`   ${name} ${view}  «${b.text}» ${b.x0.toFixed(0)},${b.y0.toFixed(0)}–${b.x1.toFixed(0)},${b.y1.toFixed(0)}`);
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i], q = boxes[j];
        const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0);
        const oy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
        if (ox <= SLACK || oy <= SLACK) continue;
        // A shadow or an outline: the same words, a pixel or two apart.
        if (p.text === q.text && Math.abs(p.x0 - q.x0) < 4 && Math.abs(p.y0 - q.y0) < 4) continue;
        const [a, b] = [p.text, q.text].sort();
        hits.push(`«${a}» and «${b}» (${ox.toFixed(0)}×${oy.toFixed(0)}px)`);
      }
    }
    const uniq = [...new Set(hits)];
    console.log(`${uniq.length ? 'FAIL' : 'ok  '} ${name} ${w}×${h} ${view}: ${boxes.length} labels` +
      (uniq.length ? `, ${uniq.length} on top of each other` : ', none on another'));
    for (const u of uniq) console.log(`       ${u}`);
    if (uniq.length) fail++;
  }
  await ctx.close();
}
await browser.close();
console.log(fail ? `\n${fail} screen(s) with writing on writing` : '\nno writing lands on other writing');
process.exit(fail ? 1 : 0);
