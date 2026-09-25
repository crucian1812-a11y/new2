// How a knee, an elbow, a hip and a shoulder are turned — the one reading
// hinge-check judges on and pose-relax pays for, so the two cannot drift apart
// (tools/torso.mjs does the same for the spine, for the same reason).
//
// Each joint is read as where the lower bone points, seen from the upper one,
// in the upper bone's own frame — which is the frame the skin is carried in:
//
//   fwd    forward or back in the upper bone's own plane; a knee folds its
//          shin back (negative), an elbow its forearm forward (positive)
//   out    out of that plane, away from the body's middle
//   turn   the lower bone's turn about its own length, outward positive: at
//          the hip and the shoulder this is how far the thigh and the upper
//          arm are rotated in their sockets
//   lift   how far the lower bone has swung from hanging straight down
//
// Zero is the bind pose: legs straight down, arms hanging with the palms in.

import { BONE_INDEX, quatFromMat } from '../src/render/skeleton.js';

const D = 180 / Math.PI;
const qa = [0, 0, 0, 1], qb = [0, 0, 0, 1];

// Degrees. A hip turns about 45° either way; a shoulder about 90. A knee
// folds back and hardly sideways; an elbow folds forward, with its carrying
// angle and a little more sideways. Generous: the job is to catch a limb
// anybody would call broken.
export const HIP_TURN = 50, SHOULDER_TURN = 100;
export const KNEE_BACK = 5, KNEE_SIDE = 15;
export const ELBOW_BACK = 10, ELBOW_SIDE = 25;

// How far past a person each joint of one reading is, degrees, 0 when fine.
export function overBy(r) {
  switch (r.n) {
    case 'hip': return Math.max(0, Math.abs(r.turn) - HIP_TURN);
    case 'shoulder': return Math.max(0, Math.abs(r.turn) - SHOULDER_TURN);
    case 'knee': return Math.max(0, r.fwd - KNEE_BACK) + Math.max(0, Math.abs(r.out) - KNEE_SIDE);
    case 'elbow': return Math.max(0, -r.fwd - ELBOW_BACK) + Math.max(0, Math.abs(r.out) - ELBOW_SIDE);
  }
  return 0;
}

function rel(sk, iU, iL) {
  quatFromMat(qa, sk.world[iU]); quatFromMat(qb, sk.world[iL]);
  const [x1, y1, z1, w1] = [-qa[0], -qa[1], -qa[2], qa[3]], [x2, y2, z2, w2] = qb;
  return [w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2];
}
const rot = (q, v) => {
  const [x, y, z, w] = q; const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};

export function readJoint(sk, u, l, side) {
  const q = rel(sk, BONE_INDEX[u], BONE_INDEX[l]);
  const d = rot(q, [0, -1, 0]);
  const tw = ((2 * Math.atan2(q[1], q[3]) * D + 540) % 360) - 180;
  return {
    fwd: Math.atan2(d[2], -d[1]) * D,
    out: Math.atan2(d[0] * side, Math.hypot(d[1], d[2])) * D,
    turn: tw * side,
    lift: Math.acos(Math.max(-1, Math.min(1, -d[1]))) * D,
  };
}

export const JOINTS = [
  { n: 'hip', u: 'hips', l: 'thigh' },
  { n: 'knee', u: 'thigh', l: 'shin' },
  { n: 'shoulder', u: 'clav', l: 'arm' },
  { n: 'elbow', u: 'arm', l: 'fore' },
];

// Every joint of one man, as [{ n, s, fwd, out, turn, lift }].
export function readLimbs(sk) {
  const out = [];
  for (const j of JOINTS) {
    for (const [s, side] of [['L', 1], ['R', -1]]) {
      const u = j.u === 'hips' ? 'hips' : j.u + s;
      out.push({ n: j.n, s, ...readJoint(sk, u, j.l + s, side) });
    }
  }
  return out;
}

// What the four joints of each limb are past a person, as a cost: the sum of
// the squares, in radians, of how far past its range each is — the hips and
// shoulders turned too far, and the knees and elbows the rig could not turn
// round to fold the right way because the socket above them would not go
// that far (swivelHinges).
export function limbCost(sk) {
  let c = 0;
  for (const r of readLimbs(sk)) {
    const over = overBy(r) / D;
    c += over * over;
  }
  return c;
}
