// Numbers for the picture.
//
// Everything else in this toolbox measures geometry, balance or bytes. How the
// frame reads was measured by looking at it, which is how the game ended up
// with an ambient term that is a ramp on world height — a knee pressed into a
// ribcage lit exactly like a knee in the air at the same height — and nobody
// could say by how much that was wrong.
//
// The instrument is an identity pass: the renderer draws the same frame twice
// without presenting the second, once shaded and once with each fighter in a
// colour channel of his own (see `want` in renderer.js). That gives an exact
// mask per body — no segmentation, no差 rendering, no shadows or bloom leaking
// into it — and from the mask, three things worth knowing:
//
//   merge    where the two men touch on screen, how often the pixels either
//            side of the boundary are the same brightness. This is "the tangle
//            is an unreadable white mass", as a percentage.
//   range    the spread of brightness inside one body, and how much of him is
//            clipped white. This is "the gi has no tonal range".
//   relief   the variation inside a patch of sleeve, which is what a fold is.
//            Measured on a bent arm and on a straight one: cloth that answers
//            the pose reads differently in the two.
//
//   node bjj/tools/look-check.mjs            the standing frame and four holds
//   node bjj/tools/look-check.mjs --dump out/  and write the masks out to look at
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodePNG } from './png.mjs';

const args = process.argv.slice(2);
const dump = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null;
const PORT = +(process.env.PORT || 8099);
if (dump) mkdirSync(dump, { recursive: true });

// The frames worth judging: the position the match lives in most, the two
// tangles that read worst, and a standing frame for the close-up materials.
const SHOTS = ['MOUNT', 'SIDE_CONTROL', 'CLOSED_GUARD', 'BACK', 'STANDING'];
// Two brightness values within this of each other, either side of the line
// where two bodies meet, are the same value to an eye at arm's length.
const SAME = 6;

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
const ctx = await browser.newContext({ viewport: { width: 800, height: 420 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });

// One frame's worth of numbers, computed where the pixels are.
//
// The same frame is grabbed twice — with the contact term on and with it off —
// and the rig's clock is pinned first, so the two differ in exactly one thing.
// That is what makes the effect measurable rather than the tangle's own
// darkness measurable.
async function look(pose) {
  return page.evaluate(async (p) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const m = window.__bjj.match();
    if (m.state === 'ready') m.start();
    window.__bjj.setPose(p);
    // The rig has to settle: grips are solved after the blend and the pose
    // arrives over a few frames.
    await wait(700);
    window.__bjj.still(3.0);
    await wait(200);
    const r = window.__bjj.renderer;

    const grab = async (ao) => {
      r.contactAO = ao;
      r.grabbed = null;
      r.want = true;
      for (let i = 0; i < 200 && !r.grabbed; i++) await wait(30);
      return r.grabbed;
    };
    const on = await grab(true);
    const off = await grab(false);
    if (!on || !off) return { error: 'no frame came back' };

    const { w, h, shaded, id } = on;
    const lum = (px, k) => 0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2];
    const L = new Float32Array(w * h);
    const L0 = new Float32Array(w * h);
    const who = new Uint8Array(w * h);       // 0 nobody, 1 red, 2 green, 3 blue
    for (let i = 0, k = 0; i < shaded.length; i += 4, k++) {
      L[k] = lum(shaded, i);
      L0[k] = lum(off.shaded, i);
      who[k] = id[i] > 127 ? 1 : id[i + 1] > 127 ? 2 : id[i + 2] > 127 ? 3 : 0;
    }

    // Where the other man is near, in screen space: B's mask grown by a
    // handful of pixels, in two one-dimensional passes.
    const R = Math.max(4, Math.round(h * 0.02));
    const nearB = new Uint8Array(w * h);
    for (let k = 0; k < who.length; k++) if (who[k] === 2) nearB[k] = 1;
    const tmp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let d = -R; d <= R && !v; d++) {
          const j = x + d;
          if (j >= 0 && j < w && nearB[y * w + j]) v = 1;
        }
        tmp[y * w + x] = v;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = 0;
        for (let d = -R; d <= R && !v; d++) {
          const j = y + d;
          if (j >= 0 && j < h && tmp[j * w + x]) v = 1;
        }
        nearB[y * w + x] = v;
      }
    }

    // merge: along the boundary between the two fighters, how often the two
    // sides are the same brightness. Reported, not checked: at a contact line
    // some of that is honest.
    let seam = 0, same = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        if (who[k] !== 1) continue;
        for (const n of [k + 1, k - 1, k + w, k - w]) {
          if (who[n] !== 2) continue;
          seam++;
          if (Math.abs(L[k] - L[n]) < 6) same++;
        }
      }
    }

    // What the contact term did, pixel by pixel, near the other man and away
    // from him. A gradient darkens the near band and leaves the rest alone; a
    // global dimming darkens both and is worth nothing.
    let dNear = 0, nNear = 0, dFar = 0, nFar = 0;
    const vals = [];
    let clipped = 0, n = 0, flatN = 0, flat = 0;
    for (let k = 0; k < who.length; k++) {
      if (who[k] !== 1) continue;
      n++;
      vals.push(L[k]);
      const i = k * 4;
      if (shaded[i] > 250 && shaded[i + 1] > 250 && shaded[i + 2] > 250) clipped++;
      if (nearB[k]) { dNear += L0[k] - L[k]; nNear++; } else { dFar += L0[k] - L[k]; nFar++; }
      const nb = [k + 1, k - 1, k + w, k - w];
      if (nb.every((j) => j >= 0 && j < who.length && who[j] === 1)) {
        flatN++;
        const mean = (L[nb[0]] + L[nb[1]] + L[nb[2]] + L[nb[3]]) / 4;
        if (Math.abs(L[k] - mean) < 2) flat++;
      }
    }
    vals.sort((a, b) => a - b);
    const q = (f) => (vals.length ? vals[Math.floor(vals.length * f)] : 0);

    // relief: the spread inside a disc on a limb, which is what a fold is.
    const rel = (bone) => {
      const sk = window.__bjj.rig.skel.A;
      const mm = sk.world[window.__bjj.BONE_INDEX[bone]];
      const vp = r.viewProj;
      const X = mm[12], Y = mm[13], Z = mm[14];
      const cx = vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12];
      const cy = vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13];
      const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
      if (cw <= 0) return null;
      const px = ((cx / cw) * 0.5 + 0.5) * w;
      const py = ((cy / cw) * 0.5 + 0.5) * h;   // readPixels is bottom-up
      const RR = Math.max(6, Math.round(h * 0.05));
      let s = 0, s2 = 0, c = 0;
      for (let y = Math.max(0, py - RR | 0); y < Math.min(h, py + RR); y++) {
        for (let x = Math.max(0, px - RR | 0); x < Math.min(w, px + RR); x++) {
          const k = y * w + x;
          if (who[k] !== 1) continue;
          s += L[k]; s2 += L[k] * L[k]; c++;
        }
      }
      return c > 40 ? Math.sqrt(Math.max(0, s2 / c - (s / c) ** 2)) : null;
    };

    const out = {
      w, h, pixels: n, seam, merged: seam ? same / seam : 0,
      near: nNear > 400 ? dNear / nNear : null,
      far: nFar > 400 ? dFar / nFar : null,
      p5: q(0.05), p95: q(0.95), clipped: n ? clipped / n : 0,
      flat: flatN ? flat / flatN : 0,
      relief: { foreL: rel('foreL'), foreR: rel('foreR'), thighL: rel('thighL') },
    };
    if (window.__dump) { out.shaded = Array.from(shaded); out.id = Array.from(id); }
    return out;
  }, pose);
}

console.log('  frame            of A  | darkened near / away |  seam  merged | flat |  relief fore/thigh');
const rows = [];
for (const pose of SHOTS) {
  if (dump) await page.evaluate(() => { window.__dump = true; });
  const r = await look(pose);
  if (r.error) { check(false, `${pose}: ${r.error}`); continue; }
  rows.push({ pose, ...r });
  const f = (v, w2 = 6) => (v === null || v === undefined ? '--'.padStart(w2) : v.toFixed(1).padStart(w2));
  console.log(
    `  ${pose.padEnd(14)} ${String(r.pixels).padStart(6)} | ${f(r.near)} ${f(r.far)}` +
    `        | ${String(r.seam).padStart(5)} ${(r.merged * 100).toFixed(0).padStart(4)}%` +
    ` | ${(r.flat * 100).toFixed(0).padStart(3)}% ` +
    ` | ${['foreL', 'foreR', 'thighL'].map((b) => (r.relief[b] === null ? ' -- ' : r.relief[b].toFixed(1))).join(' ')}`
  );
  if (dump) {
    const png = (name, data) => {
      // readPixels hands the frame back bottom row first.
      const flip = new Uint8Array(r.w * r.h * 4);
      const row = r.w * 4;
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < row; x++) flip[y * row + x] = data[(r.h - 1 - y) * row + x];
      }
      writeFileSync(`${dump}/${pose}-${name}.png`, encodePNG(r.w, r.h, flip));
    };
    png('shaded', r.shaded);
    png('id', r.id);
  }
}
await browser.close();

/* --------------------------------------------------------------- verdicts */

// The claim is physical and it is about a gradient: a body is darker where
// another body presses on it, and not darker anywhere else.
//
// Taken across the frames rather than in the worst of them, because the band
// this is measured in is a screen-space one and in two of the four positions
// that is the wrong shape. Two men on screen can overlap without touching —
// an arm in front of a chest a foot behind it — and two men can be pressed
// together where neither silhouette meets the other, which is most of closed
// guard and back control. Where the stack is honest (mount, side control) the
// band is the contact; where it is not, the number says nothing either way.
// The median is what survives that.
const med = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[xs.length >> 1] : 0);
const tangles = rows.filter((r) => r.near !== null && r.far !== null && r.seam > 150);
const near = med(tangles.map((r) => r.near));
check(tangles.length > 1 && near > 5, 'contact darkens the body it presses on',
  tangles.map((r) => `${r.pose} ${r.near.toFixed(1)}`).join(', '));
const ratio = med(tangles.map((r) => r.near / Math.max(0.4, r.far)));
check(ratio > 1.5, 'and it is a gradient, not a dimmer switch',
  tangles.map((r) => `${r.pose} ${(r.near / Math.max(0.4, r.far)).toFixed(1)}x`).join(', '));
const worst = tangles.length ? Math.max(...tangles.map((r) => r.merged)) : 0;
console.log(`  (${(worst * 100).toFixed(0)}% of the longest seam is the same brightness either side` +
  ' — at a contact line that is partly honest, which is why it is not a check)');
const clip = Math.max(...rows.map((r) => r.clipped));
check(clip < 0.01, 'nobody is clipped white', `${(clip * 100).toFixed(1)}%`);
const flat = Math.max(...rows.map((r) => r.flat));
check(flat < 0.55, 'a body is not a shell of one flat value',
  `${(flat * 100).toFixed(0)}% of it is within two of its neighbours`);

if (errors.length) for (const e of errors) check(false, 'page error', e);
console.log(fail ? `\n${fail} problem(s)` : '\nthe picture reads');
process.exit(fail ? 1 : 0);
