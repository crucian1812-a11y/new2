// Does a hand look like a hand?
//
// A player wrote «от кистей полезли выросты» and the tool that answered was
// skin-check, which found torn triangles and fixed them: 112 stretched edges
// down to 14. The tearing was real. It was not what he was looking at. On the
// title screen, where a fighter stands close to the camera, the hands still
// read as a spread claw, and three explanations were tried and all three were
// wrong — the rest curl (swept 26 to 60 degrees), the rim light (zeroed), the
// torn skin (already fixed). The plan wrote the fourth down honestly: it is the
// source mesh, whose fingers are long, straight and fanned apart, and noted
// that there was no number for it.
//
// This is the number. Look at the fingers the way an eye looks at them — down
// the palm — and ask how much air is between them.
//
//   fan     how much wider the finger mass is at the tips than at the knuckles.
//           A hand at rest tapers: the fingers converge, fan is under one. A
//           claw spreads.
//   gaps    the air trapped between the fingers, in square centimetres, inside
//           the outline: the width of the whole spread minus the skin in it.
//           Fingers that touch enclose nothing.
//   runs    how many separate fingers you can count across one line. Four is a
//           fan; a relaxed hand shows one or two.
//
// The view is not assumed. The finger cloud's own principal axes give length,
// spread and thickness, so the same code reads both source characters without
// a hand-written frame for each.
//
// Only the fingers, never the palm and never the thumb: the selection is by
// weight, everything the baker put on `fing*`/`hand*Tip` at half or more. The
// thumb is FOLDed onto the palm bone and drops out of the picture by itself,
// which is right — a thumb is supposed to stand away from the hand.
//
//   node bjj/tools/hand-check.mjs             both fighters, rest and grip
//   node bjj/tools/hand-check.mjs --dump out/ and the pictures it measured
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Skeleton, BONE_INDEX, HAND_REST, HAND_GRIP, TIP_REST, TIP_GRIP } from '../src/render/skeleton.js';
import { decodeFighter } from '../src/render/asset.js';
import { quat, qEuler, qMul } from '../src/core/m4.js';
import { encodePNG } from './png.mjs';

const argv = process.argv.slice(2);
const DUMP = (() => { const i = argv.indexOf('--dump'); return i >= 0 ? argv[i + 1] : null; })();

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// The lines. A hand at rest is not a fist and not a board: the fingers lie
// together and taper in, and what little air is between them is a seam, not a
// window. `gaps` is the one the eye actually reacts to, so it carries both
// lines; `fan` and `runs` are there to say which way it is wrong.
//
// Set from what a gathered hand measures, not from what this one does: the
// claw is the fault being fixed, and a line drawn around it would bless it.
const GAP = 3, GAP_FAIL = 8;            // mm of daylight in a typical cut
const AIR = 1.5, AIR_FAIL = 4.0;        // cm² of gaps wider than two millimetres

const MM = 0.0005;                       // half a millimetre a pixel

// Either the shipped pair or a pair named on the command line, which is how
// a bake being tried out is measured without putting it in the game first.
const load = (n) => {
  const r = readFileSync(n.includes('/') ? n : new URL(`../assets/${n}`, import.meta.url));
  return decodeFighter(r.buffer.slice(r.byteOffset, r.byteOffset + r.length));
};

function invRigid(m) {
  const o = new Float64Array(16);
  o[0] = m[0]; o[1] = m[4]; o[2] = m[8];
  o[4] = m[1]; o[5] = m[5]; o[6] = m[9];
  o[8] = m[2]; o[9] = m[6]; o[10] = m[10];
  o[12] = -(o[0] * m[12] + o[4] * m[13] + o[8] * m[14]);
  o[13] = -(o[1] * m[12] + o[5] * m[13] + o[9] * m[14]);
  o[14] = -(o[2] * m[12] + o[6] * m[13] + o[10] * m[14]);
  o[15] = 1;
  return o;
}
const xf = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

// Jacobi on a symmetric 3x3: the finger cloud's own axes, sorted longest first.
function axes(c) {
  let a = [[c[0], c[1], c[2]], [c[1], c[3], c[4]], [c[2], c[4], c[5]]];
  let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let s = 0; s < 40; s++) {
    let p = 0, q = 1, big = Math.abs(a[0][1]);
    for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(a[i][j]) > big) { big = Math.abs(a[i][j]); p = i; q = j; }
    if (big < 1e-14) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const cs = Math.cos(th), sn = Math.sin(th);
    const rot = (M) => {
      for (let k = 0; k < 3; k++) {
        const mp = M[k][p], mq = M[k][q];
        M[k][p] = cs * mp - sn * mq; M[k][q] = sn * mp + cs * mq;
      }
    };
    rot(a); a = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[j][i]));  // transpose
    rot(a); a = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[j][i]));
    rot(v);
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return order.map((i) => [v[0][i], v[1][i], v[2][i]]);
}

// One hand, one state: rasterise the fingers seen down the palm and read the
// three numbers off the mask.
function measure(m, side, curl) {
  const sk = new Skeleton();
  if (curl) {
    const _q = quat();
    const add = (b, x) => { const i = BONE_INDEX[b]; qEuler(_q, x, 0, 0); qMul(sk.local[i], sk.local[i], _q); };
    add('fing' + side, -curl[0]); add('hand' + side + 'Tip', -curl[1]);
  }
  sk.pose();

  const chain = ['hand' + side, 'fing' + side, 'hand' + side + 'Tip'].map((b) => BONE_INDEX[b]);
  const n = m.pos.length / 3;
  // Fingers only, and by the weights the baker wrote rather than by a box in
  // space: a hand that has been gathered must be selected the same way as one
  // that has not, or the measurement moves with the fix.
  const isFinger = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    let w = 0;
    for (let k = 0; k < 2; k++) if (m.bone[v * 2 + k] === chain[1] || m.bone[v * 2 + k] === chain[2]) w += m.wt[v * 2 + k];
    if (w >= 0.5) isFinger[v] = 1;
  }

  const P = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 2; k++) {
      const w = m.wt[v * 2 + k]; if (w <= 0) continue;
      const s = sk.skin.subarray(m.bone[v * 2 + k] * 16, m.bone[v * 2 + k] * 16 + 16);
      const px = m.pos[v * 3], py = m.pos[v * 3 + 1], pz = m.pos[v * 3 + 2];
      x += w * (s[0] * px + s[4] * py + s[8] * pz + s[12]);
      y += w * (s[1] * px + s[5] * py + s[9] * pz + s[13]);
      z += w * (s[2] * px + s[6] * py + s[10] * pz + s[14]);
    }
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
  }
  const inv = invRigid(sk.world[chain[0]]);
  const L = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) {
    const q = xf(inv, P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    L[v * 3] = q[0]; L[v * 3 + 1] = q[1]; L[v * 3 + 2] = q[2];
  }

  // The cloud's own frame: e0 down the fingers, e1 across them, e2 through the
  // palm. That last one is the direction the eye is looking from.
  let cx = 0, cy = 0, cz = 0, cnt = 0;
  for (let v = 0; v < n; v++) if (isFinger[v]) { cx += L[v * 3]; cy += L[v * 3 + 1]; cz += L[v * 3 + 2]; cnt++; }
  cx /= cnt; cy /= cnt; cz /= cnt;
  const c = [0, 0, 0, 0, 0, 0];
  for (let v = 0; v < n; v++) {
    if (!isFinger[v]) continue;
    const dx = L[v * 3] - cx, dy = L[v * 3 + 1] - cy, dz = L[v * 3 + 2] - cz;
    c[0] += dx * dx; c[1] += dx * dy; c[2] += dx * dz;
    c[3] += dy * dy; c[4] += dy * dz; c[5] += dz * dz;
  }
  const [e0, e1] = axes(c);
  // Point e0 away from the knuckle, so "the tip end" is the same end on both
  // hands and on a mesh that has been changed under it.
  const knuck = xf(inv, sk.world[chain[1]][12], sk.world[chain[1]][13], sk.world[chain[1]][14]);
  const dotK = (knuck[0] - cx) * e0[0] + (knuck[1] - cy) * e0[1] + (knuck[2] - cz) * e0[2];
  if (dotK > 0) for (let i = 0; i < 3; i++) e0[i] = -e0[i];

  const S = [], U = [];
  for (let v = 0; v < n; v++) {
    const dx = L[v * 3] - cx, dy = L[v * 3 + 1] - cy, dz = L[v * 3 + 2] - cz;
    S.push(dx * e0[0] + dy * e0[1] + dz * e0[2]);
    U.push(dx * e1[0] + dy * e1[1] + dz * e1[2]);
  }
  let s0 = Infinity, s1 = -Infinity, u0 = Infinity, u1 = -Infinity;
  for (let v = 0; v < n; v++) if (isFinger[v]) {
    if (S[v] < s0) s0 = S[v]; if (S[v] > s1) s1 = S[v];
    if (U[v] < u0) u0 = U[v]; if (U[v] > u1) u1 = U[v];
  }
  const pad = 0.004;
  s0 -= pad; s1 += pad; u0 -= pad; u1 += pad;
  const W = Math.ceil((u1 - u0) / MM), H = Math.ceil((s1 - s0) / MM);
  const mask = new Uint8Array(W * H);
  const px = (v) => [Math.round((U[v] - u0) / MM), Math.round((s1 - S[v]) / MM)];
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t], b = m.idx[t + 1], d = m.idx[t + 2];
    if (!(isFinger[a] && isFinger[b] && isFinger[d])) continue;
    const p = [px(a), px(b), px(d)];
    const xlo = Math.max(0, Math.min(p[0][0], p[1][0], p[2][0])), xhi = Math.min(W - 1, Math.max(p[0][0], p[1][0], p[2][0]));
    const ylo = Math.max(0, Math.min(p[0][1], p[1][1], p[2][1])), yhi = Math.min(H - 1, Math.max(p[0][1], p[1][1], p[2][1]));
    const dd = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
    for (let y = ylo; y <= yhi; y++) for (let x = xlo; x <= xhi; x++) {
      const d1 = dd(x, y, p[0][0], p[0][1], p[1][0], p[1][1]);
      const d2 = dd(x, y, p[1][0], p[1][1], p[2][0], p[2][1]);
      const d3 = dd(x, y, p[2][0], p[2][1], p[0][0], p[0][1]);
      if (!(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))) mask[y * W + x] = 1;
    }
    // And the edges, walked. A triangle thinner than a pixel can contain no
    // pixel centre at all, and a finger built out of those reads as a row of
    // holes: this counted eight fingers on a hand that has four.
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const n2 = Math.max(Math.abs(p[j][0] - p[i][0]), Math.abs(p[j][1] - p[i][1]));
      for (let k = 0; k <= n2; k++) {
        const x = Math.round(p[i][0] + (p[j][0] - p[i][0]) * (k / (n2 || 1)));
        const y = Math.round(p[i][1] + (p[j][1] - p[i][1]) * (k / (n2 || 1)));
        if (x >= 0 && x < W && y >= 0 && y < H) mask[y * W + x] = 1;
      }
    }
  }

  // Read the mask. Rows run from the fingertips down to the knuckle.
  //
  // Three numbers, and the first version of this file had the wrong two. Total
  // air between the fingers sounds like the measure and is not: four fingers
  // lying against each other still leave a hairline slit ninety millimetres
  // long, and that slit is two and a half square centimetres — as much as the
  // spread the eye objects to. And a ratio of widths at the two ends moves
  // when the selection boundary moves, which it does the moment the geometry
  // is touched, so a fix could make it worse while the picture got better.
  //
  //   gap      the widest air between two fingers, in millimetres. This is the
  //            one the eye reacts to: a hand at rest shows a seam, a claw
  //            shows daylight.
  //   spread   the angle between the outermost two fingers, from the drift of
  //            their centres up the hand. Parallel is zero; a fan opens out.
  //   air      the same gaps in area, counting only ones over two millimetres,
  //            so a seam does not read as a hole.
  let runs = 0, airPx = 0;
  const widest = [];
  const rows = [];
  for (let y = 0; y < H; y++) {
    const run = [];
    let lo = -1;
    for (let x = 0; x < W; x++) {
      const on = mask[y * W + x];
      if (on && lo < 0) lo = x;
      if ((!on || x === W - 1) && lo >= 0) { run.push([lo, on ? x : x - 1]); lo = -1; }
    }
    if (!run.length) { rows.push(null); continue; }
    let w0 = 0;
    for (let i = 1; i < run.length; i++) {
      const w = run[i][0] - run[i - 1][1] - 1;
      if (w > w0) w0 = w;
      if (w * MM > 0.002) airPx += w;
    }
    if (run.length > 1) widest.push(w0);
    if (run.length > runs) runs = run.length;
    rows.push(run);
  }
  // The middle of the cuts, not the worst one. The worst single row is the
  // notch where two fingers part company at the knuckle, which is anatomy and
  // is there on a closed fist too; it moved by a millimetre while the hand in
  // the picture went from a fan to a hand. What the eye reads is how much
  // daylight a typical cut across the fingers shows.
  widest.sort((a, b) => a - b);
  const gap = widest.length ? widest[widest.length >> 1] : 0;
  const wide = widest.length ? widest[widest.length - 1] : 0;
  return { gap: gap * MM * 1000, wide: wide * MM * 1000, air: airPx * MM * MM * 1e4, runs, mask, W, H };
}

const STATES = [['rest', [HAND_REST, TIP_REST]], ['grip', [HAND_GRIP, TIP_GRIP]]];
const named = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--dump');
const FIGHTERS = named.length
  ? named.map((f, i) => [String.fromCharCode(65 + i), f])
  : [['A', 'fighter.bin'], ['B', 'fighter-b.bin']];

console.log('  who state hand    gap mm  worst mm   air cm²  fingers');
let worstGap = { v: 0 }, worstAir = { v: 0 };
for (const [who, file] of FIGHTERS) {
  const m = load(file);
  for (const [sn, curl] of STATES) {
    for (const side of ['L', 'R']) {
      const r = measure(m, side, curl);
      console.log(`   ${who}   ${sn.padEnd(5)} ${side}    ${r.gap.toFixed(1).padStart(6)} ${r.wide.toFixed(1).padStart(9)} ` +
        `${r.air.toFixed(2).padStart(9)}      ${r.runs}`);
      const label = `${who} ${sn} ${side}`;
      if (r.gap > worstGap.v) worstGap = { v: r.gap, label, runs: r.runs };
      if (r.air > worstAir.v) worstAir = { v: r.air, label };
      if (DUMP) {
        mkdirSync(DUMP, { recursive: true });
        const img = new Uint8Array(r.W * r.H * 4);
        for (let i = 0; i < r.W * r.H; i++) {
          const on = r.mask[i];
          img[i * 4] = on ? 40 : 250; img[i * 4 + 1] = on ? 40 : 250;
          img[i * 4 + 2] = on ? 50 : 250; img[i * 4 + 3] = 255;
        }
        writeFileSync(join(DUMP, `hand-${who}-${sn}-${side}.png`), encodePNG(r.W, r.H, img));
      }
    }
  }
}
if (DUMP) console.log(`\n     wrote the pictures it measured into ${DUMP}`);

console.log('');
check(worstGap.v <= GAP_FAIL, 'the fingers lie together',
  `${worstGap.v.toFixed(1)}mm of daylight between them at worst (${worstGap.label}, ${worstGap.runs} apart), line ${GAP_FAIL.toFixed(0)}`);
check(worstAir.v <= AIR_FAIL, 'and there is no window through the hand',
  `${worstAir.v.toFixed(2)}cm² of it at worst (${worstAir.label}), line ${AIR_FAIL.toFixed(1)}`);
if (worstGap.v > GAP && worstGap.v <= GAP_FAIL)
  console.log(`     work list: ${worstGap.label} still shows ${worstGap.v.toFixed(1)}mm of daylight (want ${GAP.toFixed(0)})`);
if (worstAir.v > AIR && worstAir.v <= AIR_FAIL)
  console.log(`     work list: ${worstAir.label} still shows ${worstAir.v.toFixed(2)}cm² of air (want ${AIR.toFixed(1)})`);

console.log(`\n${fail ? `${fail} check(s) failed` : 'a hand that reads as a hand'}`);
process.exitCode = fail ? 1 : 0;
