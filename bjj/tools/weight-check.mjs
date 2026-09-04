// Does the pose hold itself up?
//
// pose-check asks whether anybody is through the mat, whether a hand can reach
// what it holds, whether the two of them touch and whether one is inside the
// other. joint-check asks whether any joint is outside human range. A pose can
// pass both and still be a mannequin: a man's weight hanging a foot outside
// everything he is resting on, a shin floating three centimetres over the mat
// with nothing under it, a head looking away from the fight.
//
// Those three are what this measures, and all three are physics or anatomy
// rather than taste:
//
//   вес     where the centre of mass is, against the ground the pair actually
//           touches. Standard segment masses (Winter), the same capsules
//           collide.js builds the bodies from, and the convex hull of every
//           patch of mat under them. A pair whose weight is outside that hull
//           is a pair falling over, and a held position cannot be.
//   опора   a limb hovering. Real bodies rest on something or are plainly
//           lifted; the thing that reads as fake is the inch in between.
//   взгляд  where he is looking. In this sport people look at what they are
//           doing, and a head aimed away from the other man is a dead body.
//
//   node bjj/tools/weight-check.mjs            every pose, the table
//   node bjj/tools/weight-check.mjs --hover    what floats, and by how much
//   node bjj/tools/weight-check.mjs --loops    hold-loop variants too

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PairRig } from '../src/game/rig.js';
import { POSES } from '../src/game/poses.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { decodeFighter } from '../src/render/asset.js';

const args = process.argv.slice(2);
const HOVER = args.includes('--hover');
const LOOPS = args.includes('--loops');

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// The capsules, as collide.js has them: bone to bone, radius at each end. The
// same shapes that decide whether two men overlap decide what they rest on.
const CAPS = [
  ['hips', 'spine', 0.190, 0.184], ['spine', 'chest', 0.186, 0.212],
  ['chest', 'neck', 0.212, 0.112], ['neck', 'head', 0.066, 0.078],
  ['head', 'headTop', 0.098, 0.086],
  ['armL', 'foreL', 0.085, 0.076], ['foreL', 'handL', 0.078, 0.070],
  ['handL', 'fingL', 0.042, 0.038], ['fingL', 'handLTip', 0.038, 0.024],
  ['armR', 'foreR', 0.085, 0.076], ['foreR', 'handR', 0.078, 0.070],
  ['handR', 'fingR', 0.042, 0.038], ['fingR', 'handRTip', 0.038, 0.024],
  ['thighL', 'shinL', 0.122, 0.100], ['shinL', 'footL', 0.095, 0.075],
  ['footL', 'toeL', 0.050, 0.034],
  ['thighR', 'shinR', 0.122, 0.100], ['shinR', 'footR', 0.095, 0.075],
  ['footR', 'toeR', 0.050, 0.034],
];

// Segment masses as a fraction of the whole man (Winter, Biomechanics of Human
// Movement). They sum to one; the hands and feet are small and the trunk is
// half of him, which is the whole reason a grappler's hips decide everything.
const MASS = {
  'hips>spine': 0.142, 'spine>chest': 0.139, 'chest>neck': 0.216,
  'neck>head': 0.020, 'head>headTop': 0.061,
  'armL>foreL': 0.028, 'foreL>handL': 0.016, 'handL>fingL': 0.006,
  'armR>foreR': 0.028, 'foreR>handR': 0.016, 'handR>fingR': 0.006,
  'thighL>shinL': 0.100, 'shinL>footL': 0.0465, 'footL>toeL': 0.0145,
  'thighR>shinR': 0.100, 'shinR>footR': 0.0465, 'footR>toeR': 0.0145,
};

// The top of the mat, the same number arena.js draws it at and rig._ground
// stands on.
const FLOOR = 0.05;
const ON_MAT = 0.03;       // within three centimetres of it is resting on it
const SAMPLES = 9;

const rig = new PairRig();
const highest = (sk) => {
  const a = skinOf(MESH.A, sk), b = skinOf(MESH.B, sk);
  return a.lowest >= b.lowest ? a : b;
};
const pos = (sk, b) => { const m = sk.world[BONE_INDEX[b]]; return [m[12], m[13], m[14]]; };

// The ruler is the skin, not the capsules.
//
// A capsule is the right shape for asking whether two bodies share space — it
// is what collide.js is built from — and the wrong one for asking where the
// floor is. The foot is a capsule of five-centimetre radius around the line
// from the ankle to the toe, so its underside sits a hand's breadth below the
// sole: measured that way, a man standing on the mat reads as six centimetres
// inside it. What the eye judges is the skin, so this loads the same baked
// fighters the game draws and skins them through the same two bones.
const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => {
  const raw = readFileSync(join(here, '..', 'assets', name));
  return decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
};
const MESH = { A: load('fighter.bin'), B: load('fighter-b.bin') };

// Every skinned vertex of one man: its world position and the bone it hangs
// off. Returns the lowest point, the patch on the mat, and the lowest point of
// each bone's own skin.
function skinOf(mesh, sk) {
  const { pos: P, bone, wt } = mesh;
  const n = P.length / 3;
  const pts = [];
  const low = new Float64Array(26).fill(9);
  let lowest = 9;
  for (let v = 0; v < n; v++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 2; k++) {
      const w = wt[v * 2 + k];
      if (w <= 0) continue;
      const s = sk.skin.subarray(bone[v * 2 + k] * 16, bone[v * 2 + k] * 16 + 16);
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      x += w * (s[0] * px + s[4] * py + s[8] * pz + s[12]);
      y += w * (s[1] * px + s[5] * py + s[9] * pz + s[13]);
      z += w * (s[2] * px + s[6] * py + s[10] * pz + s[14]);
    }
    if (y < lowest) lowest = y;
    if (y <= FLOOR + ON_MAT) pts.push([x, z]);
    const b = bone[v * 2];
    if (y < low[b]) low[b] = y;
  }
  return { pts, lowest, low };
}

// Where his weight is.
function com(sk) {
  let mx = 0, my = 0, mz = 0, m = 0;
  for (const [a, b] of CAPS) {
    const w = MASS[`${a}>${b}`];
    if (!w) continue;
    const p = pos(sk, a), q = pos(sk, b);
    mx += ((p[0] + q[0]) / 2) * w;
    my += ((p[1] + q[1]) / 2) * w;
    mz += ((p[2] + q[2]) / 2) * w;
    m += w;
  }
  return [mx / m, my / m, mz / m, m];
}

function hull(pts) {
  if (pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// How far outside the base of support the weight is, in metres. Zero inside.
function outside(h, c) {
  if (h.length === 0) return 9;
  if (h.length < 3) {
    let best = 9;
    for (const q of h) best = Math.min(best, Math.hypot(q[0] - c[0], q[1] - c[1]));
    return best;
  }
  let inside = true;
  let best = 9;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const side = ex * (c[1] - a[1]) - ez * (c[0] - a[0]);
    if (side < 0) inside = false;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * ex + (c[1] - a[1]) * ez) / l2)) : 0;
    best = Math.min(best, Math.hypot(a[0] + ex * t - c[0], a[1] + ez * t - c[1]));
  }
  return inside ? 0 : best;
}

// A limb neither resting nor plainly lifted: its skin gets to within a hand's
// breadth of the mat and stops. Real bodies rest on something or are clearly
// off the ground; the inch in between is what reads as a mannequin.
const HOVER_BONES = ['handL', 'handR', 'foreL', 'foreR', 'footL', 'footR',
  'shinL', 'shinR', 'thighL', 'thighR', 'hips'];
function hovering(mine, other) {
  const out = [];
  for (const b of HOVER_BONES) {
    const low = mine.low[BONE_INDEX[b]];
    if (low > 8 || low <= FLOOR + ON_MAT || low > FLOOR + 0.09) continue;
    // Nothing of the other man under it? Then it is resting on nothing.
    if (other.lowest < low - 0.02) continue;
    out.push({ bone: b, gap: low - FLOOR });
  }
  return out;
}

// Where he is looking, against where the other man is. The head bone's local
// +Z is the face: measured on the standing pose, where the two of them are
// looking at each other and it comes out at 0.98.
function gaze(sk, other) {
  const m = sk.world[BONE_INDEX.head];
  const f = [m[8], m[9], m[10]];
  const h = [m[12], m[13], m[14]];
  const o = pos(other, 'chest');
  const to = [o[0] - h[0], o[1] - h[1], o[2] - h[2]];
  const l = Math.hypot(to[0], to[1], to[2]) || 1;
  const d = (f[0] * to[0] + f[1] * to[1] + f[2] * to[2]) / l;
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
}

const ids = Object.keys(POSES).filter((id) => LOOPS || !POSES[id].variantOf);
const rows = [];
for (const id of ids) {
  rig.rewind();
  rig.applyAt(id, id, 1, 0.016);
  const A = rig.skel.A, B = rig.skel.B;
  // Either man can be in either slot — main.js looks a body up through
  // `roleShown` — and the two baked fighters differ by up to three and a half
  // centimetres where they touch the mat. Judged on the one that sits highest,
  // which is the one that would float.
  const fa = highest(A), fb = highest(B);
  const ca = com(A), cb = com(B);
  const pairHull = hull(fa.pts.concat(fb.pts));
  const pairCom = [(ca[0] + cb[0]) / 2, (ca[2] + cb[2]) / 2];
  rows.push({
    id,
    pair: outside(pairHull, pairCom),
    A: outside(pairHull, [ca[0], ca[2]]),
    B: outside(pairHull, [cb[0], cb[2]]),
    selfA: outside(hull(fa.pts), [ca[0], ca[2]]),
    selfB: outside(hull(fb.pts), [cb[0], cb[2]]),
    lowA: fa.lowest, lowB: fb.lowest,
    matA: fa.pts.length, matB: fb.pts.length,
    hoverA: hovering(fa, fb), hoverB: hovering(fb, fa),
    gazeA: gaze(A, B), gazeB: gaze(B, A),
  });
}

console.log(`${rows.length} poses\n`);
console.log('     pose             вес пары   A      B    | взгляд A   B  | висит | низ A   B    точек');
for (const r of rows) {
  const h = r.hoverA.length + r.hoverB.length;
  const flag = r.pair > 0.06 || r.gazeA > 100 || r.gazeB > 100 || h ? '!' : ' ';
  console.log(`   ${flag} ${r.id.padEnd(16)} ${(r.pair * 100).toFixed(0).padStart(5)}cm ` +
    `${(r.A * 100).toFixed(0).padStart(4)} ${(r.B * 100).toFixed(0).padStart(6)}  | ` +
    `${r.gazeA.toFixed(0).padStart(6)}° ${r.gazeB.toFixed(0).padStart(4)}° | ${String(h || '').padStart(4)}  | ` +
    `${(r.lowA * 100).toFixed(1).padStart(5)} ${(r.lowB * 100).toFixed(1).padStart(5)}  ${String(r.matA).padStart(3)}/${String(r.matB).padEnd(3)}`);
}

if (HOVER) {
  console.log('\n     what floats:');
  for (const r of rows) {
    for (const [role, list] of [['A', r.hoverA], ['B', r.hoverB]]) {
      for (const x of list) {
        console.log(`       ${r.id.padEnd(16)} ${role}.${x.bone.padEnd(7)} ${(x.gap * 100).toFixed(1)}cm off the mat, nothing under it`);
      }
    }
  }
}

// ------------------------------------------------------------------ the lines

// Two hard ones, both physics. A body half inside the floor and a pair hanging
// in the air with its shadow beneath it are the two failures a player names
// without knowing the word for either, and both were in the library: turtle's
// top man floated seventeen centimetres up, the armbar's shins were nineteen
// centimetres inside the mat, and nothing measured either.
const under = rows.reduce((m, r) => Math.max(m, FLOOR - Math.min(r.lowA, r.lowB)), 0);
const above = rows.reduce((m, r) => Math.max(m, Math.min(r.lowA, r.lowB) - FLOOR), 0);
// Five centimetres, which is where the library sits today rather than where it
// ought to. A mat gives — a couple of centimetres of squash is a body pressing
// into it — and half guard's shoulder at 4.2 is past that and still to author.
// The line is here so it can only come down; nineteen centimetres was the
// armbar's shin before pose-relax was taught to measure to the skin.
check(under < 0.05, 'nobody is inside the mat',
  `deepest ${(under * 100).toFixed(1)}cm (19cm before, 2cm is the target)`);
check(above < 0.03, 'and every pose touches it',
  `the worst hangs ${(above * 100).toFixed(1)}cm above (17cm before)`);

// And three work lists, reported rather than ruled on. Each is real and each
// needs authoring rather than a solver: where a man's weight is, whether a limb
// is resting on anything, and where he is looking.
const worstPair = rows.reduce((a, b) => (b.pair > a.pair ? b : a));
const worstGaze = rows.reduce((a, b) => (Math.max(b.gazeA, b.gazeB) > Math.max(a.gazeA, a.gazeB) ? b : a));
const hoverN = rows.reduce((n, r) => n + r.hoverA.length + r.hoverB.length, 0);
const lowest = rows.reduce((m, r) => Math.min(m, r.lowA, r.lowB), 9);
console.log(`\n     the pair's weight is worst outside its base in ${worstPair.id}, ` +
  `by ${(worstPair.pair * 100).toFixed(0)}cm`);
console.log(`     the worst look-away is ${worstGaze.id}, ` +
  `${Math.max(worstGaze.gazeA, worstGaze.gazeB).toFixed(0)}°`);
console.log(`     ${hoverN} limbs float; the lowest surface in the library sits ` +
  `${((lowest - FLOOR) * 100).toFixed(1)}cm from the mat\n`);
console.log(fail ? `${fail} check(s) failed` : 'the poses hold themselves up');
process.exitCode = fail ? 1 : 0;
