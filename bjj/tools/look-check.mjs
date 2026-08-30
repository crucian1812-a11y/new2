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
    // And the two live layers off. The clock is pinned but the step planner
    // and the inertia springs integrate on dt, and the head is the heaviest
    // thing hanging off those springs — which is why the noisiest region in
    // the frame is exactly the one a face measurement lives in. This is what
    // pose-check does before it measures geometry, for the same reason.
    // Full internal resolution: the adaptive one sits at 62% on a software
    // rasteriser, and an upscaled frame measures the upscaler.
    window.__bjj.quality(1);
    window.__bjj.rig.live = false;
    await wait(400);
    const r = window.__bjj.renderer;

    // One instant, five frames: the contact term off, the folds off, the face
    // off, one with nothing off at all, and the frame proper with the mask.
    // The renderer draws them all inside a single callback (see `want` in
    // renderer.js), which is what makes a difference between two of them the
    // effect of the switch and nothing else. `ctrl` is the proof of that: it
    // switches nothing, so whatever it reports is the instrument's own floor,
    // and it should be zero.
    r.grabbed = null;
    r.want = ['contact', 'folds', 'face', 'ctrl', 'all'];
    for (let i = 0; i < 300 && !(r.grabbed && r.grabbed.shots); i++) await wait(30);
    const on = r.grabbed;
    if (!on || !on.shots || !on.shots.ctrl) return { error: 'no frame came back' };
    const off = on.shots.contact, flatFrame = on.shots.folds;
    const flatFace = on.shots.face, ctrl = on.shots.ctrl;

    const { w, h, shaded, id } = on;
    const lum = (px, k) => 0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2];
    const L = new Float32Array(w * h);
    const L0 = new Float32Array(w * h);
    const Lf = new Float32Array(w * h);
    const Lc = new Float32Array(w * h);
    const Ln = new Float32Array(w * h);
    const who = new Uint8Array(w * h);       // 0 nobody, 1 red, 2 green, 3 blue
    for (let i = 0, k = 0; i < shaded.length; i += 4, k++) {
      L[k] = lum(shaded, i);
      L0[k] = lum(off, i);
      Lf[k] = lum(flatFrame, i);
      Lc[k] = lum(flatFace, i);
      Ln[k] = lum(ctrl, i);
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

    // The body, minus its own edges.
    //
    // Every measurement of surface detail below is taken here rather than on
    // the whole mask, because a silhouette is a step of a hundred levels and
    // swamps a crease worth five. Four pixels of erosion is enough to lose the
    // rim and keep the cloth.
    const inner = new Uint8Array(w * h);
    {
      const E = 4;
      const t1 = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let ok = 1;
          for (let d = -E; d <= E && ok; d++) {
            const j = x + d;
            if (j < 0 || j >= w || who[y * w + j] !== 1) ok = 0;
          }
          t1[y * w + x] = ok;
        }
      }
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          let ok = 1;
          for (let d = -E; d <= E && ok; d++) {
            const j = y + d;
            if (j < 0 || j >= h || !t1[j * w + x]) ok = 0;
          }
          inner[y * w + x] = ok;
        }
      }
    }

    // Structure at the scale of a crease.
    //
    // The first version of this counted pixels within two levels of their four
    // neighbours and called the rest flat. It measures the wrong thing: a fold
    // is a smooth gradient a centimetre or two across, which is ten pixels at
    // this distance and almost nothing between one pixel and the next, so
    // tripling the fold depth moved that number by one point in a hundred. A
    // crease lives at its own scale, so this subtracts a local mean taken at
    // that scale and reports what is left — the mean absolute deviation from a
    // six-pixel blur, inside the mask, with pixels off the body excluded from
    // the blur rather than counted as black.
    const blurMask = (src) => {
      const acc = new Float32Array(w * h), cnt = new Float32Array(w * h);
      const B = 6;
      for (let y = 0; y < h; y++) {
        let sum = 0, c = 0;
        for (let x = 0; x < w + B; x++) {
          if (x < w && who[y * w + x] === 1) { sum += src[y * w + x]; c++; }
          const o = x - B;
          if (o - B - 1 >= 0 && who[y * w + o - B - 1] === 1) { sum -= src[y * w + o - B - 1]; c--; }
          if (o >= 0 && o < w) { acc[y * w + o] = sum; cnt[y * w + o] = c; }
        }
      }
      const out = new Float32Array(w * h);
      for (let x = 0; x < w; x++) {
        let sum = 0, c = 0;
        for (let y = 0; y < h + B; y++) {
          if (y < h) { sum += acc[y * w + x]; c += cnt[y * w + x]; }
          const o = y - B;
          if (o - B - 1 >= 0) { sum -= acc[(o - B - 1) * w + x]; c -= cnt[(o - B - 1) * w + x]; }
          if (o >= 0 && o < h) out[o * w + x] = c > 0 ? sum / c : 0;
        }
      }
      return out;
    };
    const blurOn = blurMask(L);
    const blurOff = blurMask(Lf);

    // What the contact term did, pixel by pixel, near the other man and away
    // from him. A gradient darkens the near band and leaves the rest alone; a
    // global dimming darkens both and is worth nothing.
    let dNear = 0, nNear = 0, dFar = 0, nFar = 0;
    const vals = [];
    let clipped = 0, n = 0, flatN = 0, flat = 0, flatOff = 0, creaseOn = 0, creaseOff = 0, creaseN = 0, foldDelta = 0, foldNoise = 0;
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
        const meanF = (Lf[nb[0]] + Lf[nb[1]] + Lf[nb[2]] + Lf[nb[3]]) / 4;
        if (Math.abs(Lf[k] - meanF) < 2) flatOff++;
        if (inner[k]) {
          creaseOn += Math.abs(L[k] - blurOn[k]);
          creaseOff += Math.abs(Lf[k] - blurOff[k]);
          // What the folds actually changed, pixel for pixel. Band-passing the
          // frame cannot separate a crease from the curve of a forearm — both
          // live at about ten pixels — but the same frame with the folds off
          // can, and this is that difference.
          foldDelta += Math.abs(L[k] - Lf[k]);
          foldNoise += Math.abs(L[k] - Ln[k]);
          creaseN++;
        }
      }
    }
    vals.sort((a, b) => a - b);
    const q = (f) => (vals.length ? vals[Math.floor(vals.length * f)] : 0);

    // relief: the crease structure inside a disc on a limb, which is where
    // cloth is cloth. The whole-body number is dominated by hair, faces and
    // silhouette edges; a patch of sleeve is not, so this is the number that
    // answers whether the gi has folds.
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
      const RR = Math.max(6, Math.round(h * 0.045));
      let on = 0, off = 0, c = 0;
      for (let y = Math.max(0, py - RR | 0); y < Math.min(h, py + RR); y++) {
        for (let x = Math.max(0, px - RR | 0); x < Math.min(w, px + RR); x++) {
          const k = y * w + x;
          if (!inner[k]) continue;
          on += Math.abs(L[k] - blurOn[k]);
          off += Math.abs(Lf[k] - blurOff[k]);
          c++;
        }
      }
      return c > 60 ? { on: on / c, off: off / c, n: c } : null;
    };

    // The head, in screen space, and what the face does inside it.
    //
    // A face is the one surface in the frame where the eye knows what it is
    // looking at, so a flat one is expensive: everything else can be a little
    // wrong and read as a photograph of a man, and a mannequin's head reads as
    // a mannequin however good the gi is. The features on this face are drawn
    // — dark patches multiplied into the albedo — and a drawn feature is flat
    // by construction: it does not catch light on the brow, it does not put
    // shadow under the nose when the light comes from above, and it looks the
    // same painted on a ball as on a face.
    //
    // Two numbers, and only the second is a claim:
    //
    //   spread   the tonal spread over the head, which says the face is not one
    //            even patch. Drawn features raise it too, so it is reported.
    //   relief   the same frame with the features shaping the surface and
    //            without, pixel for pixel — the same instrument the folds are
    //            measured with, and the only one that can tell a shaded brow
    //            from a brown smudge.
    const project = (X, Y, Z) => {
      const vp = r.viewProj;
      const cw = vp[3] * X + vp[7] * Y + vp[11] * Z + vp[15];
      if (cw <= 0) return null;
      const cx = vp[0] * X + vp[4] * Y + vp[8] * Z + vp[12];
      const cy = vp[1] * X + vp[5] * Y + vp[9] * Z + vp[13];
      return [((cx / cw) * 0.5 + 0.5) * w, ((cy / cw) * 0.5 + 0.5) * h];
    };
    const faceLook = () => {
      const sk = window.__bjj.rig.skel.A;
      const mm = sk.world[window.__bjj.BONE_INDEX.head];
      const c = project(mm[12], mm[13], mm[14]);
      // A head is about eleven centimetres across; the radius is taken from
      // the projection of that, not from a fraction of the frame, so a
      // close-up and a wide shot measure the same amount of man.
      const s = project(mm[12], mm[13] + 0.11, mm[14]);
      if (!c || !s) return null;
      const RR = Math.hypot(s[0] - c[0], s[1] - c[1]) * 1.25;
      if (!(RR > 5)) return null;
      let d = 0, cn = 0, moved = 0, noise = 0;
      const vs = [];
      for (let y = Math.max(0, c[1] - RR | 0); y < Math.min(h, c[1] + RR); y++) {
        for (let x = Math.max(0, c[0] - RR | 0); x < Math.min(w, c[0] + RR); x++) {
          const k = y * w + x;
          if (!inner[k]) continue;
          if (Math.hypot(x - c[0], y - c[1]) > RR) continue;
          vs.push(L[k]);
          const dd = Math.abs(L[k] - Lc[k]);
          d += dd;
          noise += Math.abs(L[k] - Ln[k]);
          if (dd > 2) moved++;
          cn++;
        }
      }
      if (cn < 80) return null;
      vs.sort((a, b) => a - b);
      return {
        n: cn, r: RR,
        relief: d / cn,
        noise: noise / cn,
        moved: moved / cn,
        spread: vs[Math.floor(vs.length * 0.95)] - vs[Math.floor(vs.length * 0.05)],
      };
    };

    const out = {
      w, h, pixels: n, seam, merged: seam ? same / seam : 0,
      near: nNear > 400 ? dNear / nNear : null,
      far: nFar > 400 ? dFar / nFar : null,
      p5: q(0.05), p95: q(0.95), clipped: n ? clipped / n : 0,
      flat: flatN ? flat / flatN : 0,
      flatOff: flatN ? flatOff / flatN : 0,
      fold: creaseN ? foldDelta / creaseN : 0,
      foldNoise: creaseN ? foldNoise / creaseN : 0,
      crease: creaseN ? creaseOn / creaseN : 0,
      creaseOff: creaseN ? creaseOff / creaseN : 0,
      relief: { foreL: rel('foreL'), foreR: rel('foreR'), thighL: rel('thighL'), shinR: rel('shinR') },
      face: faceLook(),
    };
    if (window.__dump) { out.shaded = Array.from(shaded); out.id = Array.from(id); }
    return out;
  }, pose);
}

console.log('  frame            of A  | darkened near / away |  seam  merged | fold crease | relief on/off        |  face  spread');
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
    ` | ${r.fold.toFixed(1).padStart(4)}/${r.foldNoise.toFixed(1)} ${r.crease.toFixed(1).padStart(5)}` +
    ` | ${['foreL', 'foreR', 'thighL', 'shinR'].map((b) => {
      const v = r.relief[b];
      return v ? `${v.on.toFixed(1)}/${v.off.toFixed(1)}` : '  --  ';
    }).join(' ')}` +
    ` | ${r.face ? `${r.face.relief.toFixed(1).padStart(5)}/${r.face.noise.toFixed(1)} ${r.face.spread.toFixed(0).padStart(6)}` : '   --      --'}`
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
// What the folds put on the cloth, in levels of brightness, measured against
// the same frame without them.
const fold = med(rows.map((r) => r.fold - r.foldNoise));
check(fold > 2.0, 'the folds are worth something on the cloth',
  rows.map((r) => `${r.pose} ${(r.fold - r.foldNoise).toFixed(1)}`).join(', '));

// The face.
//
// Measured on the frames where the head is actually turned towards the camera
// and big enough to have pixels — in a tangle it often is neither — so this is
// the median of what came back, and it is a check only if two frames or more
// had a head to look at.
const faces = rows.map((r) => r.face).filter((f) => f && f.n > 200);
if (faces.length > 1) {
  check(med(faces.map((f) => f.relief - f.noise)) > 2.0, 'the features on the face shape the light',
    rows.filter((r) => r.face && r.face.n > 200)
      .map((r) => `${r.pose} ${(r.face.relief - r.face.noise).toFixed(1)}`).join(', '));
  console.log(`  (the head spans ${faces.map((f) => (f.r * 2).toFixed(0)).join('/')} px` +
    ` and ${(med(faces.map((f) => f.moved)) * 100).toFixed(0)}% of it moves when they are switched off)`);
} else {
  console.log('  (no frame had a head large enough to measure — face not judged)');
}

if (errors.length) for (const e of errors) check(false, 'page error', e);
console.log(fail ? `\n${fail} problem(s)` : '\nthe picture reads');
process.exit(fail ? 1 : 0);
