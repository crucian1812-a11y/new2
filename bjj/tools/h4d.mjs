// Real people in contact, read into this rig: Harmony4D → paired poses.
//
// Harmony4D (CMU, NeurIPS 2024) is twenty-odd synchronised cameras on two
// people wrestling, grappling, doing MMA, triangulated into 3D. Every pose in
// this library was written by hand, and the knee-on-belly round showed what
// that costs: a pelvis turned so the other man's belly sat *behind* the top
// man's hip, there from the first commit to the last, invisible to every judge
// until a transition through it spun a thigh in its socket. Nobody on a real
// mat can be photographed like that. So this reads what the cameras saw.
//
// What comes in is joint *positions*: COCO-WholeBody, 133 keypoints a person
// a frame, in metres. What the rig wants is joint *rotations* in its own frame
// with its own bone lengths. So only directions are taken from the data — each
// bone is turned so it points where the person's bone pointed, and is twisted
// by the next bone along (a thigh by its shin, a shin by its foot, an upper arm
// by its forearm) — and lengths stay the rig's. The pair is placed by the
// offset between their pelvises, scaled by the ratio of leg lengths.
//
// Two things the keypoints cannot say. How the spine curves between a pelvis
// and a chest: the bend is split evenly between hips, spine and chest, the
// twist between spine and chest. And where on a bone a keypoint sits: the
// table below says it, and the same table makes the synthetic keypoints of
// the round trip, so whatever it gets wrong, the round trip cannot hide by
// agreeing with itself on everything else.
//
//   node bjj/tools/h4d.mjs --roundtrip     every pose here → keypoints → back;
//                                          the converter's own error, in cm
//   node bjj/tools/h4d.mjs SEQ_DIR [from] [to] [--every N]
//                                          a downloaded sequence: per frame,
//                                          the pair as a pose block
//
// SEQ_DIR is one sequence of the dataset, e.g. train/02_grappling/001_grappling,
// with processed_data/poses3d/*.npy in it. Reading .npy needs no Python: the
// files are pickled dicts of float arrays, and the reader below takes only the
// one shape they come in.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Skeleton, BONES, BONE_INDEX, poseToQuats } from '../src/render/skeleton.js';
import { POSES } from '../src/game/poses.js';

const D = 180 / Math.PI;

// --- small 3D helpers, doubles throughout -----------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mid = (a, b) => mul(add(a, b), 0.5);
// The part of `v` across the axis `a` (unit).
const across = (v, a) => sub(v, mul(a, dot(v, a)));

// 3x3 as rows; a rotation's columns are where it sends x, y and z.
const mFromCols = (x, y, z) => [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
const mT = (m) => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
const mMul = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const mVec = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

// An orthonormal frame from a primary direction and a second one beside it.
function frame(p, s) {
  const a = norm(p);
  const n = norm(cross(a, s));
  return mFromCols(a, n, cross(a, n));
}
// The rotation that carries rest directions (p0, s0) onto target ones (p, s).
const align = (p0, s0, p, s) => mMul(frame(p, s), mT(frame(p0, s0)));

function quatOf(m) {
  const t = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4]; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s]; }
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
}
function matOf(q) {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}
// qEuler builds Ry·Rx·Rz; the same inverse waypoint-from and pose-relax use,
// with the second solution taken when it reads more like a hinge.
function eulerYXZ(q) {
  const m = matOf(q);
  const ax = Math.asin(Math.max(-1, Math.min(1, -m[1][2])));
  let ay, az;
  if (Math.abs(m[1][2]) > 0.9999) { ay = Math.atan2(-m[2][0], m[0][0]); az = 0; }
  else { ay = Math.atan2(m[0][2], m[2][2]); az = Math.atan2(m[1][0], m[1][1]); }
  const wrap = (a) => ((a + 540) % 360) - 180;
  const one = [ax * D, ay * D, az * D], two = [wrap(180 - one[0]), wrap(one[1] + 180), wrap(one[2] + 180)];
  const off = (e) => Math.abs(e[1]) + Math.abs(e[2]);
  return (off(two) < off(one) ? two : one).map((v) => +v.toFixed(1));
}
function axisAngle(ax, deg) {
  const h = deg * Math.PI / 360, s = Math.sin(h);
  return matOf([ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]);
}
function slerpM(a, b, t) {
  // Between two rotation matrices, by way of their quaternions.
  let qa = quatOf(a), qb = quatOf(b);
  let c = dot4(qa, qb);
  if (c < 0) { qb = qb.map((v) => -v); c = -c; }
  if (c > 0.9995) return matOf(normq(qa.map((v, i) => v + (qb[i] - v) * t)));
  const th = Math.acos(c), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return matOf(qa.map((v, i) => v * wa + qb[i] * wb));
}
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const normq = (q) => { const l = Math.hypot(...q); return q.map((v) => v / l); };

// --- the keypoints ---------------------------------------------------------
// COCO-WholeBody indices: 17 body, 6 feet, 68 face (skipped), 21 a hand.
export const KP = {
  nose: 0, eyeL: 1, eyeR: 2, earL: 3, earR: 4, shoL: 5, shoR: 6, elbL: 7, elbR: 8,
  wriL: 9, wriR: 10, hipL: 11, hipR: 12, kneeL: 13, kneeR: 14, ankL: 15, ankR: 16,
  bigToeL: 17, smallToeL: 18, heelL: 19, bigToeR: 20, smallToeR: 21, heelR: 22,
  // Each hand: root, then four a finger from the thumb; MCPs are the first of each.
  indexL: 96, middleL: 100, pinkyL: 108, indexR: 117, middleR: 121, pinkyR: 129,
};

// Where each keypoint sits on this rig: a bone and an offset in its frame, in
// metres at bind scale. Left is +x, up +y, forward +z; the right side mirrors.
// Hips, knees, ankles, shoulders, elbows and wrists are joints and need no
// offset; the rest are a body's surface or a hand's knuckles, guessed once here
// and checked by the round trip.
function sites(s) {
  const x = s === 'L' ? 1 : -1;
  return {
    ['hip' + s]: ['thigh' + s, [0, 0, 0]],
    ['knee' + s]: ['shin' + s, [0, 0, 0]],
    ['ank' + s]: ['foot' + s, [0, 0, 0]],
    ['sho' + s]: ['arm' + s, [0, 0, 0]],
    ['elb' + s]: ['fore' + s, [0, 0, 0]],
    ['wri' + s]: ['hand' + s, [0, 0, 0]],
    ['bigToe' + s]: ['foot' + s, [-0.025 * x, -0.06, 0.16]],
    ['smallToe' + s]: ['foot' + s, [0.035 * x, -0.06, 0.12]],
    ['heel' + s]: ['foot' + s, [0, -0.07, -0.05]],
    // Palm in, thumb forward: the index side of the hand is +z.
    ['index' + s]: ['hand' + s, [0, -0.085, 0.03]],
    ['middle' + s]: ['hand' + s, [0, -0.09, 0]],
    ['pinky' + s]: ['hand' + s, [0, -0.075, -0.035]],
    ['ear' + s]: ['head', [0.075 * x, 0.05, -0.01]],
    ['eye' + s]: ['head', [0.032 * x, 0.085, 0.085]],
  };
}
export const SITES = { ...sites('L'), ...sites('R'), nose: ['head', [0, 0.06, 0.11]] };

// Bind positions of every joint and site, so rest directions come from the
// same numbers the synthetic keypoints do.
const BIND = (() => {
  const sk = new Skeleton();
  for (const q of sk.local) { q[0] = q[1] = q[2] = 0; q[3] = 1; }
  sk.rootPos[0] = sk.rootPos[1] = sk.rootPos[2] = 0;
  sk.rootRot[0] = sk.rootRot[1] = sk.rootRot[2] = 0; sk.rootRot[3] = 1;
  sk.pose();
  const at = (b) => { const m = sk.world[BONE_INDEX[b]]; return [m[12], m[13], m[14]]; };
  const out = {};
  for (const [b] of BONES) out[b] = at(b);
  for (const [k, [b, o]] of Object.entries(SITES)) out[k] = add(at(b), o);
  return out;
})();
const restDir = (a, b) => sub(BIND[b], BIND[a]);
const NECK_REACH = len(sub(mid(BIND.earL, BIND.earR), BIND.neck));
const CLAV_LEN = len(sub(BIND.armL, BIND.clavL));
// How high a heel keypoint sits off the mat under a standing man.
const HEEL_UP = 0.03;

// --- keypoints off one of our own skeletons (for the round trip) ----------
export function keypointsOf(sk) {
  const out = {};
  for (const [k, [b, o]] of Object.entries(SITES)) {
    const m = sk.world[BONE_INDEX[b]];
    const p = [m[12], m[13], m[14]];
    const r = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
    out[k] = add(p, mVec(r, o));
  }
  return out;
}

// --- keypoints → this rig --------------------------------------------------
// `k` is { name: [x, y, z] } in metres, y up. Returns { root, j, world } where
// world is the rotation each bone was solved to, for whoever wants to check.
export function solve(k, scale = 1) {
  const P = {};
  for (const n in k) P[n] = mul(k[n], scale);
  const W = {};
  const up = sub(mid(P.shoL, P.shoR), mid(P.hipL, P.hipR));
  // The pelvis: its line from the hips. The chest: its line from the
  // shoulders. Each is free to pitch about its own line — two hip points and
  // two shoulder points cannot say how far — and the spine takes half the turn
  // between them. The two pitches are the ones that put this rig's shoulders,
  // collarbones at rest, on the shoulder keypoints: the trunk's lengths are
  // the rig's, so the curve that reaches is the curve the person had.
  const xh = norm(sub(P.hipL, P.hipR)), xs = norm(sub(P.shoL, P.shoR));
  const hips0 = align([1, 0, 0], [0, 1, 0], xh, up), chest0 = align([1, 0, 0], [0, 1, 0], xs, up);
  const trunk = (a, c) => {
    const h = mMul(axisAngle(xh, a), hips0), ch = mMul(axisAngle(xs, c), chest0);
    return { hips: h, chest: ch, spine: slerpM(h, ch, 0.5) };
  };
  const miss = (a, c) => {
    const t = trunk(a, c);
    const hp = placeRoot(P, t.hips).pos;
    const sp = add(hp, mVec(t.hips, BIND.spine));
    const cp = add(sp, mVec(t.spine, sub(BIND.chest, BIND.spine)));
    let e = 0;
    // The collarbone turns to aim the shoulder, so what it cannot fix is only
    // the distance: from where it hinges to the shoulder keypoint, its own
    // length. A tenth of the way toward it resting, so of two trunks that both
    // reach, the one with the shoulders where they hang wins.
    for (const s of ['L', 'R']) {
      const pivot = add(cp, mVec(t.chest, sub(BIND['clav' + s], BIND.chest)));
      e += (len(sub(P['sho' + s], pivot)) - CLAV_LEN) ** 2;
      e += 0.1 * len(sub(add(cp, mVec(t.chest, sub(BIND['arm' + s], BIND.chest))), P['sho' + s])) ** 2;
    }
    // And the neck has to reach the head: the base of it sits as far from
    // the middle of the ears as it does on this rig.
    const np = add(cp, mVec(t.chest, sub(BIND.neck, BIND.chest)));
    e += (len(sub(mid(P.earL, P.earR), np)) - NECK_REACH) ** 2;
    return e + 1e-6 * (a * a + c * c);
  };
  let best = { a: 0, c: 0, e: miss(0, 0) };
  for (let a = -60; a <= 60; a += 10) for (let c = -60; c <= 60; c += 10) {
    const e = miss(a, c); if (e < best.e) best = { a, c, e };
  }
  for (let step = 5; step > 0.05; step /= 2) {
    for (let moved = true; moved;) {
      moved = false;
      for (const [da, dc] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const e = miss(best.a + da, best.c + dc);
        if (e < best.e - 1e-12) { best = { a: best.a + da, c: best.c + dc, e }; moved = true; }
      }
    }
  }
  Object.assign(W, trunk(best.a, best.c));
  // Neck and head: the neck points at the middle of the ears; the head turns
  // to put the ears across and the nose in front.
  const ears = mid(P.earL, P.earR);
  const chestPos = add(placeRoot(P, W.hips).pos, mVec(W.hips, BIND.spine));
  const neckBase = add(add(chestPos, mVec(W.spine, sub(BIND.chest, BIND.spine))), mVec(W.chest, sub(BIND.neck, BIND.chest)));
  W.neck = align(restDir('neck', 'head'), [1, 0, 0], sub(ears, neckBase), sub(P.earL, P.earR));
  W.head = align([1, 0, 0], sub(BIND.nose, mid(BIND.earL, BIND.earR)), sub(P.earL, P.earR), sub(P.nose, ears));
  for (const s of ['L', 'R']) {
    // The collarbone aims the shoulder joint at the shoulder keypoint.
    const clavPos = add(neckBase, mVec(W.chest, sub(BIND['clav' + s], BIND.neck)));
    W['clav' + s] = align(restDir('clav' + s, 'arm' + s), [0, 0, 1], sub(P['sho' + s], clavPos), mVec(W.chest, [0, 0, 1]));
    // Upper arm: at the elbow, twisted so the forearm folds forward.
    const ua = sub(P['elb' + s], P['sho' + s]), fa = sub(P['wri' + s], P['elb' + s]);
    const fwdArm = twistRef(ua, fa, +1, mVec(W.chest, [0, 0, 1]));
    W['arm' + s] = align([0, -1, 0], [0, 0, 1], ua, fwdArm);
    // Forearm and hand: turned by the knuckles, index side forward.
    const thumbSide = sub(P['index' + s], P['pinky' + s]);
    W['fore' + s] = align([0, -1, 0], [0, 0, 1], fa, across(thumbSide, norm(fa)));
    W['hand' + s] = align(restDir('hand' + s, 'middle' + s), restDir('pinky' + s, 'index' + s),
      sub(P['middle' + s], P['wri' + s]), thumbSide);
    // Thigh: at the knee, twisted so the shin folds back.
    const th = sub(P['knee' + s], P['hip' + s]), sh = sub(P['ank' + s], P['knee' + s]);
    const toes = mid(P['bigToe' + s], P['smallToe' + s]);
    const footFwd = sub(toes, P['ank' + s]);
    W['thigh' + s] = align([0, -1, 0], [0, 0, 1], th, twistRef(th, sh, -1, footFwd));
    // Shin: at the ankle, twisted so the foot points forward.
    W['shin' + s] = align([0, -1, 0], [0, 0, 1], sh, footFwd);
    // Foot: at the toes, rolled by the line across them.
    W['foot' + s] = align(restDir('foot' + s, 'bigToe' + s), sub(BIND['smallToe' + s], BIND['bigToe' + s]),
      sub(P['bigToe' + s], P['ank' + s]), sub(P['smallToe' + s], P['bigToe' + s]));
  }
  // World rotations → the local ones the pose format holds.
  const parentOf = Object.fromEntries(BONES.map(([b, p]) => [b, p >= 0 ? BONES[p][0] : null]));
  const root = placeRoot(P, W.hips);
  const j = {};
  for (const b of Object.keys(W)) {
    const p = parentOf[b];
    const local = p ? mMul(mT(W[p] || worldOfParent(W, parentOf, p)), W[b]) : mMul(mT(root.rot), W[b]);
    const e = eulerYXZ(quatOf(local));
    if (Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2]) > 0.2) j[b] = e;
  }
  return { root: { p: root.pos.map((v) => +v.toFixed(3)), r: eulerYXZ(quatOf(root.rot)) }, j, world: W };
}
// A parent with no solved rotation of its own (the tips) has none to give.
function worldOfParent(W, parentOf, p) {
  for (let b = p; b; b = parentOf[b]) if (W[b]) return W[b];
  return mFromCols([1, 0, 0], [0, 1, 0], [0, 0, 1]);
}
// The direction a bone's +z should take: the next bone's lean across it, with
// `sign` saying which way that bone folds. Straight limbs have no lean; then
// the fallback, which is where the body faces.
function twistRef(bone, next, sign, fallback) {
  const a = norm(bone);
  const c = across(next, a);
  const w = len(c) / (len(next) || 1);
  const f = norm(across(fallback, a));
  if (w < 0.05) return f;
  const g = mul(norm(c), sign);
  // Blend toward the fallback as the fold vanishes, so a nearly straight knee
  // does not spin on a centimetre of noise.
  const k = Math.min(1, (w - 0.05) / 0.15);
  return add(mul(g, k), mul(f, 1 - k));
}
// The root carries the heading; the hips joint carries the pelvis inside it,
// the way the authored poses split them.
function placeRoot(P, hips) {
  const hm = mid(P.hipL, P.hipR);
  const pos = sub(hm, mVec(hips, mid(BIND.hipL, BIND.hipR)));
  const f = mVec(hips, [0, 0, 1]);
  const yaw = Math.atan2(f[0], f[2]);
  const rot = matOf([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
  return { pos, rot };
}

// --- FK of a pose block on a bare skeleton ---------------------------------
export function skeletonOf(pose) {
  const sk = new Skeleton();
  poseToQuats(sk.local, pose);
  const r = pose.root.r;
  const q = [0, 0, 0, 1];
  // qEuler from m4.js, without importing a Float32 array into doubles.
  const h = r.map((v) => v * Math.PI / 360);
  const [cx, cy, cz] = h.map(Math.cos), [sx, sy, sz] = h.map(Math.sin);
  q[0] = sx * cy * cz + cx * sy * sz; q[1] = cx * sy * cz - sx * cy * sz;
  q[2] = cx * cy * sz - sx * sy * cz; q[3] = cx * cy * cz + sx * sy * sz;
  sk.rootRot.set(q);
  sk.rootPos.set(pose.root.p);
  sk.pose();
  return sk;
}

// --- the round trip --------------------------------------------------------
function roundtrip() {
  const per = {};
  let worst = { d: 0 };
  for (const [id, pose] of Object.entries(POSES)) {
    for (const role of ['A', 'B']) {
      if (!pose[role]) continue;
      const sk = skeletonOf(pose[role]);
      const got = skeletonOf(solve(keypointsOf(sk)));
      for (const [b] of BONES) {
        const m1 = sk.world[BONE_INDEX[b]], m2 = got.world[BONE_INDEX[b]];
        const d = Math.hypot(m1[12] - m2[12], m1[13] - m2[13], m1[14] - m2[14]);
        (per[b] ||= []).push(d);
        if (d > worst.d) worst = { d, b, id, role };
      }
    }
  }
  const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
  console.log('bone        median   p90    max   (cm, joint position after keypoints → pose)');
  for (const [b, a] of Object.entries(per)) {
    console.log(`  ${b.padEnd(9)} ${(pct(a, 0.5) * 100).toFixed(1).padStart(6)} ${(pct(a, 0.9) * 100).toFixed(1).padStart(6)} ${(Math.max(...a) * 100).toFixed(1).padStart(6)}`);
  }
  console.log(`worst ${(worst.d * 100).toFixed(1)} cm: ${worst.b} of ${worst.role} in ${worst.id}`);
  // What a camera would see: the keypoints themselves, off the solved pose.
  // The joints inside the trunk are not on that list and cannot be — a curve
  // of three spine joints behind two shoulders and two hips is unobservable —
  // and they are not what a viewer reads either.
  const kpErr = {};
  for (const pose of Object.values(POSES)) for (const role of ['A', 'B']) {
    if (!pose[role]) continue;
    const sk = skeletonOf(pose[role]);
    const k0 = keypointsOf(sk), k1 = keypointsOf(skeletonOf(solve(k0)));
    for (const n in k0) (kpErr[n.replace(/[LR]$/, '')] ||= []).push(len(sub(k0[n], k1[n])));
  }
  console.log('\nkeypoint   median   p90    max   (cm, what a camera sees)');
  for (const [n, a] of Object.entries(kpErr)) {
    console.log(`  ${n.padEnd(9)} ${(pct(a, 0.5) * 100).toFixed(1).padStart(6)} ${(pct(a, 0.9) * 100).toFixed(1).padStart(6)} ${(Math.max(...a) * 100).toFixed(1).padStart(6)}`);
  }
}

// --- .npy: a pickled dict of float arrays ---------------------------------
// np.save of a dict writes a 0-d object array, which is a pickle. Only what
// those files contain is understood: protocol-2+ pickles of a dict of str →
// numpy arrays, rebuilt by numpy.core.multiarray._reconstruct.
export function readPoseNpy(file) {
  const buf = readFileSync(file);
  const hl = buf.readUInt16LE(8);
  const body = buf.subarray(10 + hl);
  const top = unpickle(body);
  return top && top.nd ? top.value : top;
}
function unpickle(b) {
  const stack = [], marks = [], memo = [];
  let i = 0;
  const pop = () => stack.pop();
  const popMark = () => { const m = marks.pop(); return stack.splice(m); };
  const u32 = () => { const v = b.readUInt32LE(i); i += 4; return v; };
  for (;;) {
    const op = b[i++];
    switch (op) {
      case 0x80: i++; break;                                 // PROTO
      case 0x95: i += 8; break;                              // FRAME
      case 0x63: { const a = readLine(), c = readLine(); stack.push({ glob: a + '.' + c }); break; } // GLOBAL
      case 0x93: { const c = pop(), a = pop(); stack.push({ glob: a + '.' + c }); break; } // STACK_GLOBAL
      case 0x8c: { const n = b[i++]; stack.push(b.toString('utf8', i, i + n)); i += n; break; } // SHORT_BINUNICODE
      case 0x58: { const n = u32(); stack.push(b.toString('utf8', i, i + n)); i += n; break; }  // BINUNICODE
      case 0x55: { const n = b[i++]; stack.push(b.toString('latin1', i, i + n)); i += n; break; } // SHORT_BINSTRING
      case 0x43: { const n = b[i++]; stack.push(b.subarray(i, i + n)); i += n; break; } // SHORT_BINBYTES
      case 0x42: { const n = u32(); stack.push(b.subarray(i, i + n)); i += n; break; }  // BINBYTES
      case 0x4b: stack.push(b[i++]); break;                   // BININT1
      case 0x4d: stack.push(b.readUInt16LE(i)); i += 2; break; // BININT2
      case 0x4a: stack.push(b.readInt32LE(i)); i += 4; break; // BININT
      case 0x88: stack.push(true); break; case 0x89: stack.push(false); break; case 0x4e: stack.push(null); break;
      case 0x29: stack.push([]); break;                       // EMPTY_TUPLE
      case 0x85: stack.push([pop()]); break;                  // TUPLE1
      case 0x86: { const y = pop(), x = pop(); stack.push([x, y]); break; }
      case 0x87: { const z = pop(), y = pop(), x = pop(); stack.push([x, y, z]); break; }
      case 0x28: marks.push(stack.length); break;             // MARK
      case 0x74: stack.push(popMark()); break;                // TUPLE
      case 0x5d: stack.push([]); break;                       // EMPTY_LIST
      case 0x7d: stack.push(new Map()); break;                // EMPTY_DICT
      case 0x65: { const items = popMark(); stack[stack.length - 1].push(...items); break; } // APPENDS
      case 0x61: { const v = pop(); stack[stack.length - 1].push(v); break; } // APPEND
      case 0x75: { const items = popMark(); const d = stack[stack.length - 1]; for (let k = 0; k < items.length; k += 2) d.set(items[k], items[k + 1]); break; } // SETITEMS
      case 0x73: { const v = pop(), k = pop(); stack[stack.length - 1].set(k, v); break; } // SETITEM
      case 0x71: memo[b[i++]] = stack[stack.length - 1]; break; // BINPUT
      case 0x72: memo[u32()] = stack[stack.length - 1]; break;  // LONG_BINPUT
      case 0x94: memo.push(stack[stack.length - 1]); break;      // MEMOIZE
      case 0x68: stack.push(memo[b[i++]]); break;               // BINGET
      case 0x6a: stack.push(memo[u32()]); break;                // LONG_BINGET
      case 0x52: { const args = pop(), f = pop(); stack.push(reduce(f, args)); break; } // REDUCE
      case 0x62: { const st = pop(); build(stack[stack.length - 1], st); break; }      // BUILD
      case 0x2e: return pop();                                 // STOP
      default: throw new Error(`pickle opcode 0x${op.toString(16)} at ${i - 1} is not one these files use`);
    }
  }
  function readLine() { const e = b.indexOf(0x0a, i); const s = b.toString('latin1', i, e); i = e + 1; return s; }
}
function reduce(f, args) {
  if (/_reconstruct$/.test(f.glob)) return { nd: true };
  if (/numpy\.dtype$/.test(f.glob)) return { dtype: args[0] };
  if (/_codecs\.encode$/.test(f.glob)) return Buffer.from(args[0], 'latin1');
  throw new Error(`pickle builds ${f.glob}, which these files do not`);
}
function build(o, st) {
  if (!o || !o.nd) return;   // a dtype's state: nothing needed from it
  // ndarray state: (version, shape, dtype, fortran, data)
  const [, shape, dt, , data] = st;
  const kind = dt.dtype;
  // The outer 0-d object array np.save writes around a dict: its data is the
  // list of objects, and the one object is the dict.
  if (kind === 'O8' || kind === 'O4') { o.value = data[0]; return; }
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const n = shape.reduce((a, c) => a * c, 1);
  const arr = kind === 'f4' ? new Float32Array(n) : new Float64Array(n);
  for (let k = 0; k < n; k++) arr[k] = kind === 'f4' ? bytes.readFloatLE(k * 4) : bytes.readDoubleLE(k * 8);
  o.shape = shape; o.data = arr;
}

// --- a downloaded sequence -------------------------------------------------
export function convertSequence(dir, from = 0, to = 1e9, every = 1) {
  const pd = join(dir, 'processed_data', 'poses3d');
  if (!existsSync(pd)) throw new Error(`no ${pd}`);
  const files = readdirSync(pd).filter((f) => f.endsWith('.npy')).sort()
    .filter((f) => { const n = parseInt(f, 10); return n >= from && n <= to; })
    .filter((_, i) => i % every === 0);
  const frames = files.map((f) => {
    const d = readPoseNpy(join(pd, f));
    const people = [...d.keys()].sort().map((name) => {
      const a = d.get(name);
      const c = a.shape[1];
      const kp = {};
      for (const [n, idx] of Object.entries(KP)) kp[n] = [a.data[idx * c], a.data[idx * c + 1], a.data[idx * c + 2]];
      return { name, kp };
    });
    return { f, people };
  });
  // The data's own up: the ankles of a whole sequence spread over the mat,
  // so the direction they vary least in is the floor's normal.
  const ankles = frames.flatMap((fr) => fr.people.flatMap((p) => [p.kp.ankL, p.kp.ankR]));
  const { up, floor } = floorOf(ankles, frames);
  const legOf = (kp) => (len(sub(kp.kneeL, kp.hipL)) + len(sub(kp.ankL, kp.kneeL)) + len(sub(kp.kneeR, kp.hipR)) + len(sub(kp.ankR, kp.kneeR))) / 2;
  const ours = len(restDir('thighL', 'shinL')) + len(restDir('shinL', 'footL'));
  return frames.map((fr) => ({
    f: fr.f,
    names: fr.people.map((p) => p.name),
    poses: fr.people.map((p) => solve(toYUp(p.kp, up, floor), ours / legOf(p.kp))),
  }));
}
function sequence(dir, from, to, every) {
  for (const fr of convertSequence(dir, from, to, every)) {
    const out = fr.poses;
    console.log(`// ${fr.f}: ${fr.names.join(' + ')}`);
    for (const [i, s] of out.entries()) {
      console.log(`  ${'AB'[i]}: { root: { p: [${s.root.p.join(', ')}], r: [${s.root.r.join(', ')}] },`);
      console.log(`    j: { ${Object.entries(s.j).map(([b, e]) => `${b}: [${e.join(', ')}]`).join(', ')} } },`);
    }
  }
}
function floorOf(pts, frames) {
  const c = pts.reduce((a, p) => add(a, p), [0, 0, 0]).map((v) => v / pts.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = sub(p, c); for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r][k] += d[r] * d[k]; }
  // Smallest eigenvector by inverse iteration on C + εI.
  let v = [0.3, 0.9, 0.2];
  const eps = 1e-9 * (C[0][0] + C[1][1] + C[2][2]);
  for (let it = 0; it < 50; it++) v = norm(solve3([[C[0][0] + eps, C[0][1], C[0][2]], [C[1][0], C[1][1] + eps, C[1][2]], [C[2][0], C[2][1], C[2][2] + eps]], v));
  // Which way is up: heads are above hips more often than not.
  const sgn = frames.reduce((a, fr) => a + fr.people.reduce((b, p) => b + dot(sub(p.kp.nose, mid(p.kp.hipL, p.kp.hipR)), v), 0), 0);
  let up = sgn < 0 ? mul(v, -1) : v;
  // Better than either, when there is one: a man standing. Ankles say little
  // on the ground — in a guard half of them are in the air — but a bout
  // starts on its feet, and a standing body's ankles-to-nose line is the
  // vertical. Standing is the longest a body gets in the sequence, give or
  // take a tenth.
  const stretch = frames.flatMap((fr) => fr.people.map((p) => sub(p.kp.nose, mid(p.kp.ankL, p.kp.ankR))));
  const tallest = Math.max(...stretch.map(len));
  const standing = stretch.filter((d) => len(d) > 0.9 * tallest && dot(d, up) > 0.5 * len(d));
  if (standing.length) up = norm(standing.reduce((a2, d) => add(a2, norm(d)), [0, 0, 0]));
  // The floor: each frame's lowest keypoint is on the mat or near it, and
  // one triangulation glitch in a thousand frames should not sink the rest,
  // so a low percentile of those, less the height a heel keypoint sits at.
  const lows = frames.map((fr) => Math.min(...fr.people.flatMap((p) => Object.values(p.kp).map((q) => dot(q, up))))).sort((a2, b2) => a2 - b2);
  const floor = lows[Math.floor((lows.length - 1) * 0.02)] - HEEL_UP;
  return { up, floor };
}
function solve3(m, b) {
  const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  return [0, 1, 2].map((k) => det(m.map((r, i) => r.map((v, j) => (j === k ? b[i] : v)))) / d);
}
// Rotate the data so `up` is +y and the floor is at 0 (ankle height off it is
// the rig's business: the feet are planted on the mat at runtime).
function toYUp(kp, up, floor) {
  const x = norm(across([1, 0, 0], up)), z = cross(x, up);
  const out = {};
  for (const n in kp) { const p = kp[n]; out[n] = [dot(p, x), dot(p, up) - floor, dot(p, z)]; }
  return out;
}

// --- CLI ------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--roundtrip')) roundtrip();
  else if (args[0]) {
    const ev = args.indexOf('--every');
    const every = ev >= 0 ? +args[ev + 1] : 1;
    const nums = args.slice(1).filter((a, i, all) => /^\d+$/.test(a) && all[i - 1] !== '--every').map(Number);
    sequence(args[0], nums[0] ?? 0, nums[1] ?? 1e9, every);
  } else {
    console.error('node bjj/tools/h4d.mjs --roundtrip | SEQ_DIR [from] [to] [--every N]');
    process.exit(1);
  }
}
