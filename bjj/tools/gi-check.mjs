// Can you see the man against the mat?
//
// The competition square is dark blue — u_matInner, (0.043, 0.105, 0.245) — and
// the ladder dressed its first two opponents in blue. By eye that looked like a
// man half swallowed by the mat. And the referee's kit was the black belt's
// kimono to two decimals, so the last fight of the ladder had three men in
// black on it.
//
// Measured, the first was mostly wrong and the second exactly right. This takes
// the renderer's own identity pass (see `want` in renderer.js) and walks the
// opponent's outline — his kimono, materials 1, 2 and 4, against the pixel just
// outside him — and counts how much of that edge is closer than ΔE 10 in
// CIELAB: the stretches where he and the background are the same colour. The
// outline pass does most of the work for every kimono: white loses 13% of its
// edge, the ladder's colours 16–21%, and the one that loses most is the light
// blue, not the navy. The referee in his old kit was ΔE 3 from the black
// kimono; that one was real.
//
//   node bjj/tools/gi-check.mjs
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const SHOTS = ['MOUNT', 'SIDE_CONTROL', 'BACK', 'CLOSED_GUARD', 'STANDING'];
// The line, set off the player's own white kimono, which is the best case this
// mat allows: it loses 13% of its edge on average and 20% in mount, where the
// man underneath is in the top man's shadow whatever he wears. Every kimono
// on the ladder has to stay within about half as much again on average, and no
// position may lose more than a third of an outline. The frames are pinned but
// not identical run to run — the referee and the camera settle wherever the
// previous pose left them — and a single position moves by five points or so,
// which is what the margins are for.
const LOST_MEAN = 0.22;
const LOST_EACH = 0.35;
// And the referee against the darkest kimono he stands next to.
const REF_MIN = 12;

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
const ctx = await browser.newContext({ viewport: { width: 640, height: 300 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html?belt=white`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });

const roster = await page.evaluate(() => Object.entries(window.__bjj.ROSTER)
  .map(([belt, r]) => ({ belt, name: r.name, giCol: Array.from(r.giCol) })));
// `--ref r,g,b` dresses the referee in something else for the run.
const REF = process.argv.includes('--ref') ? process.argv[process.argv.indexOf('--ref') + 1].split(',').map(Number) : null;
if (REF) await page.evaluate((c) => window.__bjj.REF_GI.set(c), REF);
// `--try r,g,b;r,g,b` measures candidate colours instead of the ladder.
const TRY = process.argv.includes('--try') ? process.argv[process.argv.indexOf('--try') + 1] : null;
if (TRY) {
  roster.length = 0;
  for (const c of TRY.split(';')) roster.push({ belt: c, name: 'try', giCol: c.split(',').map(Number) });
}
// Among candidates, the darkest is the one the referee is judged against.
const TRY_DARK = TRY ? roster.reduce((a, b) => (b.giCol.reduce((x, y) => x + y) < a.giCol.reduce((x, y) => x + y) ? b : a)).belt : null;

async function look(pose, giCol) {
  return page.evaluate(async ([p, col]) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const m = window.__bjj.match();
    if (m.state === 'ready') m.start();
    m.f[1].giCol.set(col);
    window.__bjj.setPose(p);
    await wait(600);
    window.__bjj.still(3.0);
    window.__bjj.quality(1);
    window.__bjj.rig.live = false;
    await wait(300);
    const r = window.__bjj.renderer;
    r.grabbed = null;
    r.want = true;
    for (let i = 0; i < 300 && !(r.grabbed && r.grabbed.id); i++) await wait(30);
    const g = r.grabbed;
    if (!g) return { error: 'no frame came back' };
    const { w, h, shaded, id, mat } = g;
    // Which channel is the opponent this frame: the renderer draws role A
    // first, and the roles move with the fight.
    const opp = m.roleShown.indexOf('A') === 1 ? 0 : 1;
    const who = new Uint8Array(w * h);
    for (let i = 0, k = 0; k < w * h; i += 4, k++) {
      who[k] = id[i] > 127 ? 1 : id[i + 1] > 127 ? 2 : id[i + 2] > 127 ? 3 : 0;
    }
    const mine = opp + 1;
    const isGi = (k) => who[k] === mine && (mat[k * 4] === 1 || mat[k * 4] === 2 || mat[k * 4] === 4);
    // Along his outline: a pixel of kimono at his edge, and a pixel of nobody
    // just outside it. What is behind him is not one colour — the crest
    // under the fight is white and yellow on blue — so the two sides are
    // compared pixel by pixel, and what comes back is how much of his edge the
    // background swallows.
    const edges = [];
    const refPx = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      if (who[k] === 3 && (mat[k * 4] === 1 || mat[k * 4] === 2 || mat[k * 4] === 4)) refPx.push(k);
      if (!isGi(k)) continue;
      // One step out must be nobody (this is his edge), and the sample is
      // taken five steps out: the outline pass draws a grey rim two or three
      // pixels wide around every body and is not in the identity mask, so the
      // nearest pixels outside him are the rim, not the mat.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (who[(y + dy) * w + (x + dx)] !== 0) continue;
        const X = x + dx * 5, Y = y + dy * 5;
        if (X < 0 || X >= w || Y < 0 || Y >= h) continue;
        const j = Y * w + X;
        if (who[j] !== 0) continue;
        edges.push([shaded[k * 4], shaded[k * 4 + 1], shaded[k * 4 + 2],
          shaded[j * 4], shaded[j * 4 + 1], shaded[j * 4 + 2]]);
      }
    }
    // And the mean of his kimono and of the referee's, for the referee's own
    // question, which is about colour and not about an edge.
    const meanOf = (list) => {
      if (!list.length) return null;
      let r = 0, g = 0, b = 0;
      for (const k of list) { r += shaded[k * 4]; g += shaded[k * 4 + 1]; b += shaded[k * 4 + 2]; }
      return [r / list.length, g / list.length, b / list.length];
    };
    const giPx = [];
    for (let k = 0; k < w * h; k++) if (isGi(k)) giPx.push(k);
    return { edges, gi: meanOf(giPx), ref: meanOf(refPx), refN: refPx.length };
  }, [pose, giCol]);
}

// sRGB 0..255 to CIELAB, D65.
function lab([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// A stretch of outline is lost when the two sides are closer than this.
const LOST = 10;
console.log(`     how much of each kimono's outline the background swallows (ΔE under ${LOST}):\n`);
console.log('     ' + 'belt'.padEnd(8) + SHOTS.map((s) => s.slice(0, 12).padStart(13)).join('') + '     mean');
const rows = [];
let blackRef = null;
for (const r of roster) {
  const d = [];
  for (const pose of SHOTS) {
    const g = await look(pose, r.giCol);
    if (g.error || !g.edges || g.edges.length < 50) { d.push(NaN); continue; }
    let lost = 0;
    for (const e of g.edges) if (dE([e[0], e[1], e[2]], [e[3], e[4], e[5]]) < LOST) lost++;
    d.push(lost / g.edges.length);
    if ((r.belt === 'black' || r.belt === TRY_DARK) && g.ref && g.refN > 200) (blackRef ||= []).push(dE(g.gi, g.ref));
  }
  const good = d.filter((v) => !Number.isNaN(v));
  const mean = good.reduce((a, b) => a + b, 0) / Math.max(1, good.length);
  rows.push({ ...r, d, mean, max: Math.max(...good) });
  const f = (v) => (Number.isNaN(v) ? '—' : Math.round(v * 100) + '%');
  console.log('     ' + `${r.belt}`.padEnd(8) + d.map((v) => f(v).padStart(13)).join('') + f(mean).padStart(9));
}
console.log('');
const worst = rows.reduce((a, b) => (b.mean > a.mean ? b : a));
check(worst.mean <= LOST_MEAN, 'every kimono on the ladder keeps its outline against the mat',
  `worst is ${worst.belt} (${worst.name}), ${Math.round(worst.mean * 100)}% of the edge lost, want ${Math.round(LOST_MEAN * 100)}% or less`);
const high = rows.reduce((a, b) => (b.max > a.max ? b : a));
check(high.max <= LOST_EACH, 'in every position, not just on average',
  `worst is ${high.belt} in ${SHOTS[high.d.indexOf(high.max)]}, ${Math.round(high.max * 100)}%, want ${Math.round(LOST_EACH * 100)}% or less`);
if (blackRef) {
  const m = blackRef.reduce((a, b) => a + b, 0) / blackRef.length;
  check(m >= REF_MIN, 'and the referee is not a third man in black',
    `his kit against the black kimono: ΔE ${m.toFixed(0)}, want ${REF_MIN} (over ${blackRef.length} frames he was in)`);
} else {
  console.log('     the referee was not in any of the black belt\'s frames');
}
// And the lapel. The whole gi game is played on it, and the V it makes down
// the chest is most of what says kimono rather than pyjamas — and for as long
// as the baker had it nine centimetres inside the chest it was 0 to 50 pixels
// of any frame. Measured on a standing pair with the camera turned to face
// each man in turn: his collar (material 4) as a share of his jacket, and how
// far it is in colour from the jacket around it.
const LAPEL_SHARE = 0.03, LAPEL_DE = 12;
const lapels = await page.evaluate(async (kits) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const m = window.__bjj.match();
  if (m.state === 'ready') m.start();
  const out = [];
  for (const [ki, kit] of kits.entries()) for (const turn of [0, Math.PI]) {
    m.f[1].giCol.set(kit);
    window.__bjj.still(null);
    window.__bjj.setPose('STANDING');
    await wait(600);
    const cam = window.__bjj.camera;
    cam.orbit += turn; cam.targetOrbit = cam.orbit;
    await wait(900);
    window.__bjj.still(3.0);
    window.__bjj.quality(1);
    await wait(300);
    const r = window.__bjj.renderer;
    r.grabbed = null;
    r.want = true;
    for (let i = 0; i < 300 && !(r.grabbed && r.grabbed.id); i++) await wait(30);
    const { w, h, shaded, id, mat } = r.grabbed;
    const whoAt = (k) => (id[k * 4] > 127 ? 1 : id[k * 4 + 1] > 127 ? 2 : 0);
    for (const who of [1, 2]) {
      const acc = { 1: [0, 0, 0, 0], 4: [0, 0, 0, 0] };
      // And the edge: each collar pixel against the jacket pixels right beside
      // it, which is where the eye finds a lapel. A mean over the whole jacket
      // mixes in a lit sleeve and a back in shadow.
      const edge = [];
      for (let k = 0, i = 0; k < w * h; k++, i += 4) {
        const mt = mat[i];
        if (whoAt(k) !== who || (mt !== 1 && mt !== 4)) continue;
        const a = acc[mt]; a[0] += shaded[i]; a[1] += shaded[i + 1]; a[2] += shaded[i + 2]; a[3]++;
        if (mt !== 4) continue;
        const x = k % w, y = (k / w) | 0;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const j = Y * w + X;
          if (whoAt(j) !== who || mat[j * 4] !== 1) continue;
          r += shaded[j * 4]; g += shaded[j * 4 + 1]; b += shaded[j * 4 + 2]; n++;
        }
        if (n) edge.push([shaded[i], shaded[i + 1], shaded[i + 2], r / n, g / n, b / n]);
      }
      out.push({ turn, who, kit: ki, jacket: acc[1], collar: acc[4], edge });
    }
  }
  window.__bjj.still(null);
  return out;
}, roster.map((r) => r.giCol));
// Each man, from whichever side shows his chest; the opponent in every kimono
// on the ladder, and the worst of them is what is reported.
const meanOf = (a) => [a[0] / Math.max(1, a[3]), a[1] / Math.max(1, a[3]), a[2] / Math.max(1, a[3])];
for (const who of [1, 2]) {
  let worst = null;
  for (let ki = 0; ki < roster.length; ki++) {
    const mine = lapels.filter((l) => l.who === who && l.kit === ki);
    if (!mine.length) continue;
    const best = mine.reduce((a, b) => (b.collar[3] > a.collar[3] ? b : a));
    const share = best.collar[3] / Math.max(1, best.collar[3] + best.jacket[3]);
    // The median over the collar's edge pixels of the distance to the cloth
    // beside them.
    const ds = best.edge.map((e) => dE([e[0], e[1], e[2]], [e[3], e[4], e[5]])).sort((a, b) => a - b);
    const d = ds.length ? ds[ds.length >> 1] : 0;
    const score = Math.min(share / LAPEL_SHARE, d / LAPEL_DE);
    if (!worst || score < worst.score) worst = { score, share, d, kit: roster[ki].belt };
  }
  // Both men's collars have to be on their chests: that is what the buried
  // collar failed, and it fails at once if it happens again. How far the lapel
  // stands off the cloth is held on the player's own white kimono, which is the
  // one he is looking at all match. On the ladder's dark kimonos, with the
  // chest out of the key light, it is ΔE 3 or so — which is what a navy lapel
  // in shade looks like on a broadcast too — and it is printed, not failed.
  const line = `${who === 2 ? `worst in the ${worst.kit} belt's kimono: ` : ''}` +
    `${(worst.share * 100).toFixed(1)}% of his jacket, ΔE ${worst.d.toFixed(0)} from the cloth beside it`;
  if (who === 1) {
    check(worst.share >= LAPEL_SHARE && worst.d >= LAPEL_DE, 'the player\'s lapel is on his chest and reads',
      `${line}; want ${LAPEL_SHARE * 100}% and ΔE ${LAPEL_DE}`);
  } else {
    check(worst.share >= LAPEL_SHARE, 'and the opponent\'s is on his', `${line}; want ${LAPEL_SHARE * 100}%`);
  }
}
check(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));

await browser.close();
console.log(fail ? `\n${fail} check(s) failed` : '\nyou can tell them apart');
process.exitCode = fail ? 1 : 0;
