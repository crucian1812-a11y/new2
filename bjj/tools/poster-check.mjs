// Is the title card a picture?
//
// The first screen of this game used to be a rendered fighter standing in the
// hall, and a player looked at it and said what was wrong with it in one line:
// «поменяй анимации вне игры на картинки про джиу-джитсу». He is right, and
// nothing in this toolbox could have told him so — every judge here measures
// what a body does or what a body is, and none of them measures whether the
// first thing anybody sees is worth looking at.
//
// So the screen is a gallery of plates (src/game/gallery.js) and this is what a
// plate has to hold. Two halves, because the two questions are different.
//
// What the geometry says, without a browser:
//
//   рама       every bone of both men inside the window the menu leaves, at
//              every shape of glass this game runs on. A poster with a foot
//              off the edge is a mistake, not a crop — and this is the measure
//              that makes the framing computed rather than authored: if it can
//              be held at 2.2:1 and at 1.6:1 by one set of angles, nothing
//              about the composition is a lucky number
//   размер     how much of that window the pair fills. Under a third is a
//              stock photo of a gym; over one is a crop
//   место      the pair is in its own window and not behind the menu, measured
//              as the share of them that lands in the column of belt buttons
//   объектив   how far back the camera stands. A metre and a half is a fish-eye
//              of a shoulder; a poster is taken from a distance
//   внутри     the eye inside one of them, asked of the same capsules
//              camera-check asks it of — the failure that makes a frame one
//              solid black rectangle
//   зал        and the eye inside the room rather than through a wall
//   покой      the plate does not move. Not «moves slowly»: a picture that
//              breathes is a photograph with a bug in it, so the line is zero
//              millimetres over a whole page, exactly
//   страницы   every plate is reached, none is on screen for less than it
//              takes to read the caption, and the screen is blank for less
//              than a tenth of the time
//   подпись    the caption is the position's own name out of POSES, because a
//              poster that named a position itself would be a second name for
//              it
//
// And what the pixels say, which needs the browser (--pixels):
//
//   бумага     both ends of the ramp are in the picture. A duotone with
//              nothing near the paper is a black rectangle with a grey smudge,
//              which is what a hall lit for a broadcast camera prints as
//   фигуры     how much of the frame the two men are, from the renderer's own
//              identity mask rather than from a guess about brightness
//   оба        both of them are in it. One man behind another is one man
//   контраст   the men against what is behind them
//   лепка      and the men against themselves: a gi printed as one flat white
//              shape is a bedsheet, and the folds are the only thing that says
//              this is cloth on a body
//   разбор     where the two of them touch, whether the eye can find the
//              boundary. Two white jackets against each other are one shape —
//              and the thing that saves them turned out not to be the printed
//              line (which changes this by three points between its softest
//              and its hardest) but that they are in different gi. The angle
//              is what moves it: the solver takes it from 20% to 64%
//   пересвет   and what the light on them costs: a jacket burnt out to flat
//              paper has lost the folds that make it cloth
//   меню       the picture stays dark under the menu, because the menu is
//              white type and the picture is behind it
//
//   node bjj/tools/poster-check.mjs             the geometry
//   node bjj/tools/poster-check.mjs --pixels    and the print, in a browser
//   node bjj/tools/poster-check.mjs --pixels --dump out/   with the plates
import { Gallery, PLATES, HOLD, TURN_OUT, TURN_IN, CYCLE } from '../src/game/gallery.js';
import { POSES } from '../src/game/poses.js';
import { BONES } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { m4, m4mul, m4perspective, m4lookAt } from '../src/core/m4.js';

const args = process.argv.slice(2);
const PIXELS = args.includes('--pixels');
const dump = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null;

let bad = 0;
const say = (ok, name, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${text}`);
  if (!ok) bad++;
};

/* ------------------------------------------------------------- the geometry */

// The shapes of glass this game is played on. A phone held sideways is the
// first one and the one that matters; the last is a laptop window, where the
// frame is squarer and the vertical is the tight direction instead.
const GLASS = [
  ['телефон', 844 / 390],
  ['планшет', 1024 / 640],
  ['ноутбук', 1440 / 900],
];
// The window a plate is composed into, in normalised device coordinates. Kept
// here as well as in gallery.js on purpose: a judge that imports the number it
// is judging cannot fail, and the whole point of this line is that the picture
// is inside the glass and clear of the menu.
const WIN = { x0: -0.14, x1: 0.99, y0: -0.80, y1: 0.86 };
// The menu's own column, measured off hud.menuLayout at a phone's width: it
// starts at 5% of the width and is at most 37% of it, from 14% of the height
// down to the start button. In NDC, generously.
const MENU = { x0: -1, x1: -0.14, y0: -0.75, y1: 0.75 };
const NAMES = BONES.map((b) => b[0]);
const NEAR = 0.08;
const inside = new Overlap();

const view = m4(), proj = m4(), vp = m4();
const project = (g, aspect) => {
  m4perspective(proj, g.camera.fov, aspect, NEAR, 70);
  m4lookAt(view, g.camera.eye, g.camera.at, [0, 1, 0]);
  m4mul(vp, proj, view);
  const out = [];
  for (const role of ['A', 'B']) {
    const sk = g.skel[role];
    for (let i = 0; i < NAMES.length; i++) {
      const w = sk.world[i];
      const cx = vp[0] * w[12] + vp[4] * w[13] + vp[8] * w[14] + vp[12];
      const cy = vp[1] * w[12] + vp[5] * w[13] + vp[9] * w[14] + vp[13];
      const cw = vp[3] * w[12] + vp[7] * w[13] + vp[11] * w[14] + vp[15];
      out.push({ role, bone: NAMES[i], x: cx / cw, y: cy / cw, w: cw });
    }
  }
  return out;
};

console.log();
console.log('=== the plates ===');
console.log();
const rows = [];
for (let i = 0; i < PLATES.length; i++) {
  const p = PLATES[i];
  const per = [];
  for (const [, aspect] of GLASS) {
    const g = new Gallery(aspect).at(i);
    const pts = project(g, aspect);
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9, out = 0, menu = 0, near = 9;
    for (const q of pts) {
      if (q.w < near) near = q.w;
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
      if (q.x < WIN.x0 || q.x > WIN.x1 || q.y < WIN.y0 || q.y > WIN.y1) out++;
      if (q.x > MENU.x0 && q.x < MENU.x1 && q.y > MENU.y0 && q.y < MENU.y1) menu++;
    }
    const fill = Math.max((x1 - x0) / (WIN.x1 - WIN.x0), (y1 - y0) / (WIN.y1 - WIN.y0));
    const eyeIn = ['A', 'B'].some((r) => inside.contains(g.skel[r], g.camera.eye).length);
    per.push({
      aspect, out, menu, fill, near, dist: g.dist, eyeIn, n: pts.length,
      eye: [g.camera.eye[0], g.camera.eye[1], g.camera.eye[2]],
    });
  }
  const g = new Gallery(GLASS[0][1]).at(i);
  rows.push({ i, pose: p.pose, caption: g.caption, per });
  const worst = per.reduce((a, b) => (b.fill < a.fill ? b : a));
  console.log(`  ${String(i + 1)}. ${p.pose.padEnd(13)} ${g.caption.padEnd(16)} ` +
    `${per.map((q) => `${(q.fill * 100).toFixed(0)}%`).join(' / ')} of the window, ` +
    `from ${per.map((q) => q.dist.toFixed(1)).join('/')} m` +
    (worst.out ? `   ${worst.out} bones outside it` : ''));
}

console.log();
const anyOut = rows.reduce((a, r) => a + r.per.reduce((b, q) => b + q.out, 0), 0);
const worstOut = rows.find((r) => r.per.some((q) => q.out));
say(anyOut === 0, 'рама',
  `${anyOut} bones outside the window over ${rows.length} plates × ${GLASS.length} shapes of glass` +
  (worstOut ? `, worst ${worstOut.pose}` : ''));

const fills = rows.map((r) => Math.min(...r.per.map((q) => q.fill)));
const minFill = Math.min(...fills), maxFill = Math.max(...fills);
say(minFill >= 0.55 && maxFill <= 1.0, 'размер',
  `the pair fills ${(minFill * 100).toFixed(0)}–${(maxFill * 100).toFixed(0)}% of the window ` +
  '(line 55–100%)');

const inMenu = rows.reduce((a, r) => a + Math.max(...r.per.map((q) => q.menu)), 0);
say(inMenu === 0, 'место',
  `${inMenu} bones behind the menu column (line 0)`);

const MIN_DIST = 2.2;
const dists = rows.map((r) => Math.min(...r.per.map((q) => q.dist)));
say(Math.min(...dists) >= MIN_DIST, 'объектив',
  `the nearest plate is taken from ${Math.min(...dists).toFixed(2)} m ` +
  `(line ${MIN_DIST} m — nearer than that is a fish-eye of a shoulder)`);

const eyeIn = rows.filter((r) => r.per.some((q) => q.eyeIn));
say(eyeIn.length === 0, 'внутри',
  `the camera stands inside somebody on ${eyeIn.length} plates ` +
  `(line 0${eyeIn.length ? `, ${eyeIn.map((r) => r.pose).join(', ')}` : ''})`);

// The hall: the mat is 8 m across and the sponsor boards ring it at 8.4, so a
// camera past 6.5 m from the middle is standing in the furniture and one below
// the tatami is under the floor.
const eyes = rows.flatMap((r) => r.per.map((q) => q.eye));
const far = Math.max(...eyes.map((e) => Math.hypot(e[0], e[2])));
const low = Math.min(...eyes.map((e) => e[1]));
say(far <= 6.5 && low >= 0.2, 'зал',
  `the furthest camera stands ${far.toFixed(2)} m from the middle and the lowest ` +
  `${low.toFixed(2)} m off the mat (lines 6.5 m and 0.2 m)`);

// Still. Every bone of both men, over a page and a half of clock — the plate is
// posed once and the only thing that moves after that is the page.
{
  const g = new Gallery(GLASS[0][1]).at(0);
  const was = [];
  for (const role of ['A', 'B']) for (const w of g.skel[role].world) was.push(Array.from(w));
  let moved = 0;
  const steps = Math.round(HOLD * 0.98 * 60);
  for (let i = 0; i < steps; i++) g.update(1 / 60);
  let k = 0;
  for (const role of ['A', 'B']) {
    for (const w of g.skel[role].world) {
      const o = was[k++];
      moved = Math.max(moved, Math.hypot(w[12] - o[12], w[13] - o[13], w[14] - o[14]));
    }
  }
  say(moved === 0, 'покой',
    `the busiest bone moves ${(moved * 1000).toFixed(3)} mm over ${(steps / 60).toFixed(1)}s ` +
    'of one plate (line 0.000 — a picture does not breathe)');
}

// The pages. Every plate reached, in order, and the screen blank for as little
// of the time as a turn takes.
{
  const g = new Gallery(GLASS[0][1]);
  const seen = [];
  let blank = 0, frames = 0, longest = 0, run = 0;
  const steps = Math.round(CYCLE * PLATES.length * 60) + 4;
  for (let i = 0; i < steps; i++) {
    g.update(1 / 60);
    frames++;
    if (seen[seen.length - 1] !== g.i) seen.push(g.i);
    if (g.page < 0.5) { blank++; run++; longest = Math.max(longest, run); } else run = 0;
  }
  const all = new Set(seen).size === PLATES.length;
  say(all && seen.length >= PLATES.length, 'страницы',
    `${new Set(seen).size} of ${PLATES.length} plates come up in ${(CYCLE * PLATES.length).toFixed(0)}s, ` +
    `in order (${seen.slice(0, PLATES.length + 1).join('')})`);
  say(HOLD >= 4 && blank / frames <= 0.12, 'страницы',
    `each is up ${HOLD.toFixed(1)}s and the page is turning ` +
    `${((blank / frames) * 100).toFixed(0)}% of the time ` +
    `(lines 4s and 12%; the turn is ${(TURN_OUT + TURN_IN).toFixed(2)}s)`);
}

// The caption. Not «is there one» — whether it is the library's own word for
// the position on the plate.
{
  let wrong = 0;
  for (let i = 0; i < PLATES.length; i++) {
    const g = new Gallery(GLASS[0][1]).at(i);
    const want = POSES[PLATES[i].pose] && POSES[PLATES[i].pose].name;
    if (!want || g.caption !== want) wrong++;
  }
  say(wrong === 0, 'подпись',
    `${PLATES.length - wrong} of ${PLATES.length} captions are the position's own name in POSES`);
}

/* --------------------------------------------------------------- the print */

if (PIXELS) {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { encodePNG } = await import('./png.mjs');
  if (dump) mkdirSync(dump, { recursive: true });
  const PORT = +(process.env.PORT || 8099);

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });

  console.log();
  console.log('=== the print ===');
  console.log();

  const shots = [];
  for (let i = 0; i < PLATES.length; i++) {
    const out = await page.evaluate(async ([k, wantPix]) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__bjj.toTitle();
      window.__bjj.quality(1);
      const g = window.__bjj.plate(k);
      window.__bjj.still(3.0);
      await wait(350);
      const r = window.__bjj.renderer;
      r.grabbed = null;
      r.want = true;
      for (let t = 0; t < 300 && !r.grabbed; t++) await wait(30);
      if (!r.grabbed) return { error: 'no frame came back' };
      const { w, h, shaded, id } = r.grabbed;
      // Who is where, off the renderer's own identity pass: red is the first
      // man, green the second. A brightness rule would have called the mat a
      // fighter on half of these.
      const who = new Uint8Array(w * h);
      const L = new Float32Array(w * h);
      for (let q = 0; q < w * h; q++) {
        const o = q * 4;
        L[q] = 0.2126 * shaded[o] + 0.7152 * shaded[o + 1] + 0.0722 * shaded[o + 2];
        who[q] = id[o] > 60 ? 1 : id[o + 1] > 60 ? 2 : 0;
      }
      // The menu's own column, from the HUD's own layout rather than from a
      // guess: a button you can see but cannot read is the bug this catches.
      const M = window.__bjj.hud.menuLayout();
      const dpr = w / window.innerWidth;
      const menu = {
        x0: Math.round(M.left * dpr), x1: Math.round((M.left + M.mw) * dpr),
        y0: Math.round((M.top - 30) * dpr), y1: Math.round((M.start.y + M.start.h + 20) * dpr),
      };
      let men = 0, a = 0, b = 0, edge = 0, sum = 0, sum2 = 0, blown = 0;
      let bg = 0, bgSum = 0, menuSum = 0, menuN = 0, menuHot = 0;
      let seam = 0, seamLit = 0;
      const EDGE = 2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const q = y * w + x;
          const inMenu = x >= menu.x0 && x <= menu.x1 && y >= menu.y0 && y <= menu.y1;
          if (inMenu) { menuSum += L[q]; menuN++; if (L[q] > 150) menuHot++; }
          if (who[q]) {
            men++;
            if (who[q] === 1) a++; else b++;
            if (L[q] > 245) blown++;
            sum += L[q];
            sum2 += L[q] * L[q];
            if (x < EDGE || y < EDGE || x >= w - EDGE || y >= h - EDGE) edge++;
            // The seam: a pixel of one man with the other man next to it.
            const r2 = q + 1 < w * h ? who[q + 1] : 0;
            const d2 = q + w < w * h ? who[q + w] : 0;
            for (const [nb, nq] of [[r2, q + 1], [d2, q + w]]) {
              if (nb && nb !== who[q]) {
                seam++;
                if (Math.abs(L[q] - L[nq]) >= 6) seamLit++;
              }
            }
          } else {
            bg++;
            bgSum += L[q];
          }
        }
      }
      // Both ends of the ramp: the darkest and brightest hundredths of the
      // picture, over the picture's own window rather than over the menu.
      const hist = new Uint32Array(256);
      for (let q = 0; q < w * h; q++) hist[Math.max(0, Math.min(255, Math.round(L[q])))]++;
      const pct = (f) => {
        let want = f * w * h, c = 0;
        for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= want) return v; }
        return 255;
      };
      const mean = men ? sum / men : 0;
      return {
        w, h, men: men / (w * h), a: a / (w * h), b: b / (w * h), edge,
        mean, sd: men ? Math.sqrt(Math.max(0, sum2 / men - mean * mean)) : 0,
        blown: men ? blown / men : 0,
        bg: bg ? bgSum / bg : 0,
        menu: menuN ? menuSum / menuN : 0, menuHot: menuN ? menuHot / menuN : 0,
        seam, seamLit, p02: pct(0.02), p98: pct(0.98),
        shaded: wantPix ? Array.from(shaded) : null,
      };
    }, [i, !!dump]);
    if (out.error) { say(false, 'кадр', `${PLATES[i].pose}: ${out.error}`); continue; }
    shots.push({ plate: PLATES[i], ...out });
    if (dump && out.shaded) {
      // The right way up: a readback comes off the buffer bottom row first,
      // and a plate written straight out is a picture of the hall upside down.
      const px = Uint8Array.from(out.shaded);
      const flip = new Uint8Array(px.length);
      const row = out.w * 4;
      for (let y = 0; y < out.h; y++) flip.set(px.subarray(y * row, y * row + row), (out.h - 1 - y) * row);
      writeFileSync(`${dump}/plate-${i}-${PLATES[i].pose}.png`, encodePNG(out.w, out.h, flip));
    }
    console.log(`  ${PLATES[i].pose.padEnd(13)} men ${(out.men * 100).toFixed(1)}% ` +
      `(${(out.a * 100).toFixed(1)}/${(out.b * 100).toFixed(1)}), ink ${out.mean.toFixed(0)} ` +
      `against ${out.bg.toFixed(0)}, sd ${out.sd.toFixed(0)}, menu ${out.menu.toFixed(0)}, ` +
      `seam ${out.seam ? ((out.seamLit / out.seam) * 100).toFixed(0) : '—'}%`);
  }

  console.log();
  if (errors.length) say(false, 'ошибки', errors.slice(0, 3).join(' / '));
  const worstOn = (f) => shots.reduce((a, s) => (f(s) < f(a) ? s : a), shots[0]);
  const bestOn = (f) => shots.reduce((a, s) => (f(s) > f(a) ? s : a), shots[0]);

  const dark = worstOn((s) => s.p98);
  say(shots.every((s) => s.p98 >= 150 && s.p02 <= 30), 'бумага',
    `the ramp runs ${Math.min(...shots.map((s) => s.p02))}–${Math.min(...shots.map((s) => s.p98))} ` +
    `at worst (lines 30 and 150; worst ${dark.plate.pose})`);

  const small = worstOn((s) => s.men), big = bestOn((s) => s.men);
  say(shots.every((s) => s.men >= 0.06 && s.men <= 0.40), 'фигуры',
    `the two of them are ${(small.men * 100).toFixed(1)}–${(big.men * 100).toFixed(1)}% of the frame ` +
    `(line 6–40%; smallest ${small.plate.pose})`);

  const hidden = worstOn((s) => Math.min(s.a, s.b));
  say(shots.every((s) => Math.min(s.a, s.b) >= 0.012), 'оба',
    `the man who shows least is ${(Math.min(hidden.a, hidden.b) * 100).toFixed(1)}% of the frame ` +
    `(line 1.2%; ${hidden.plate.pose})`);

  const flatCon = worstOn((s) => s.mean - s.bg);
  say(shots.every((s) => s.mean - s.bg >= 25), 'контраст',
    `the men are ${(flatCon.mean - flatCon.bg).toFixed(0)} brighter than the room at worst ` +
    `(line 25; ${flatCon.plate.pose})`);

  // A quarter of the distance between the ink and the paper. Under that the men
  // are a silhouette rather than cloth on a body — which is what the print is
  // for and what a duotone will happily throw away.
  const flat = worstOn((s) => s.sd);
  say(shots.every((s) => s.sd >= 64), 'лепка',
    `the jacket's own range is ${flat.sd.toFixed(0)} of 255 at worst ` +
    `(line 64, a quarter of ink to paper; ${flat.plate.pose})`);

  const burnt = bestOn((s) => s.blown);
  say(shots.every((s) => s.blown <= 0.05), 'пересвет',
    `${(burnt.blown * 100).toFixed(1)}% of the men is burnt out at worst ` +
    `(line 5%; ${burnt.plate.pose}) — the fill's own cost, and the reason it is a dial`);

  const seams = shots.filter((s) => s.seam > 200);
  const seamWorst = seams.length ? seams.reduce((a, s) =>
    (s.seamLit / s.seam < a.seamLit / a.seam ? s : a)) : null;
  // A quarter of the seam. This is the one line here that is a judgement rather
  // than a landmark: two white jackets against each other are one shape, and
  // what tells them apart is a step in brightness across the boundary — six
  // levels, look-check's own number for "the same value at arm's length". A
  // quarter of the boundary carrying that is enough for a reader to find the
  // edge; below it the plate is a blob. The solver maximises it rather than
  // satisfying it, which is why what ships is well clear of the line.
  say(!seamWorst || seamWorst.seamLit / seamWorst.seam >= 0.25, 'разбор',
    seamWorst
      ? `where they touch, ${((seamWorst.seamLit / seamWorst.seam) * 100).toFixed(0)}% of the ` +
        `seam is a line the eye can see (line 25%; ${seamWorst.plate.pose})`
      : 'no plate has the two of them touching over 200 pixels');

  const lit = bestOn((s) => s.menu);
  say(shots.every((s) => s.menu <= 95 && s.menuHot <= 0.06), 'меню',
    `the picture under the menu is ${lit.menu.toFixed(0)} bright and ` +
    `${(lit.menuHot * 100).toFixed(1)}% of it is over 150 (lines 95 and 6%; ${lit.plate.pose})`);

  const cut = shots.filter((s) => s.edge > 40);
  say(cut.length === 0, 'рама',
    `${cut.length} plates put a man against the edge of the glass ` +
    `(line 0${cut.length ? `, ${cut.map((s) => s.plate.pose).join(', ')}` : ''})`);

  await browser.close();
}

console.log();
console.log(`${PLATES.length} plates, ${CYCLE.toFixed(1)}s a page`);
if (bad) process.exitCode = 1;
