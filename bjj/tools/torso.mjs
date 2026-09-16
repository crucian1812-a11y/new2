// What a spine does, in three numbers that do not mix.
//
// One definition, because two things read it: `torso-check` judges the library
// and `pose-relax` pays for the excess. A copy here and a copy there is how
// this project last spent a round chasing a number the solver could not see —
// the same reason `grip-pairs.mjs` exists.
//
// Bending forward over somebody is most of what grappling is and a spine has
// eighty degrees of it; bending sideways runs out near thirty-five; rotation
// near forty-five. Measured as one angle they are indistinguishable, and the
// first version of this did exactly that and called thirteen torsos of thirty
// broken when only the forward half of the number was large.
//
// Split: the trunk's direction against the hips' own frame gives forward and
// sideways separately, and the chest's rotation about the trunk's length gives
// the twist.
//
// Calibrated on the one pose whose answer is known — a man standing upright
// reads 9 degrees forward, 0 sideways, 0 twist. A frame that cannot say that
// is not worth reading further down.
import { BONE_INDEX, quatFromMat } from '../src/render/skeleton.js';
import { quat, qMul } from '../src/core/m4.js';

// A textbook person, one side each. The softest thing in either file: a limber
// person beats all four, which is why the judge prints a work list rather than
// a line and the solver only pays past them.
export const TORSO_LIM = { fwd: 80, back: 30, side: 35, tw: 45 };

const P = (sk, b) => { const m = sk.world[BONE_INDEX[b]]; return [m[12], m[13], m[14]]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const _qU = quat(), _qL = quat(), _qI = quat(), _qR = quat();

export function readTorso(sk) {
  // The hips' frame taken from the body rather than from matrix columns: up
  // the pelvis, across between the hip joints, forward from the two.
  const up = nrm(sub(P(sk, 'spine'), P(sk, 'hips')));
  const left = nrm(sub(P(sk, 'thighL'), P(sk, 'thighR')));
  const fwd = nrm(crs(left, up));
  const trunk = nrm(sub(P(sk, 'neck'), P(sk, 'spine')));
  const cf = dot(trunk, fwd), cs = dot(trunk, left), cu = dot(trunk, up);
  quatFromMat(_qU, sk.world[BONE_INDEX.hips]);
  quatFromMat(_qL, sk.world[BONE_INDEX.chest]);
  _qI[0] = -_qU[0]; _qI[1] = -_qU[1]; _qI[2] = -_qU[2]; _qI[3] = _qU[3];
  qMul(_qR, _qL, _qI);
  const a = 2 * Math.atan2(_qR[0] * up[0] + _qR[1] * up[1] + _qR[2] * up[2], _qR[3]);
  return {
    fwd: (Math.atan2(cf, cu) * 180) / Math.PI,
    side: (Math.atan2(cs, Math.hypot(cu, cf)) * 180) / Math.PI,
    tw: (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI,
  };
}

// How many degrees past a person this torso is, on its worst axis.
export const torsoOver = (r) => Math.max(
  r.fwd - TORSO_LIM.fwd, -r.fwd - TORSO_LIM.back,
  Math.abs(r.side) - TORSO_LIM.side, Math.abs(r.tw) - TORSO_LIM.tw,
);

// And on every axis at once, which is what a cost wants: knee-on-belly was
// past three of the four, and a term that only ever sees the worst one would
// trade a backbend for a sideways lean and call it progress.
export function torsoExcess(r) {
  return Math.max(0, r.fwd - TORSO_LIM.fwd)
    + Math.max(0, -r.fwd - TORSO_LIM.back)
    + Math.max(0, Math.abs(r.side) - TORSO_LIM.side)
    + Math.max(0, Math.abs(r.tw) - TORSO_LIM.tw);
}

// What a solver pays. Each axis squared on its own and then added: summing the
// degrees first and squaring once lets a big backbend hide behind a small
// sideways lean, and knee-on-belly was past three of the four at once.
// Radians, so the number sits in the same range as the metre-based terms
// around it.
export function torsoCost(r) {
  const d = Math.PI / 180;
  let c = 0;
  for (const e of [
    r.fwd - TORSO_LIM.fwd,
    -r.fwd - TORSO_LIM.back,
    Math.abs(r.side) - TORSO_LIM.side,
    Math.abs(r.tw) - TORSO_LIM.tw,
  ]) if (e > 0) c += (e * d) * (e * d);
  return c;
}

// The names a report uses for what is wrong.
export function torsoWhy(r) {
  return [
    r.fwd > TORSO_LIM.fwd ? 'forward' : null,
    -r.fwd > TORSO_LIM.back ? 'backward' : null,
    Math.abs(r.side) > TORSO_LIM.side ? 'sideways' : null,
    Math.abs(r.tw) > TORSO_LIM.tw ? 'twisted' : null,
  ].filter(Boolean).join('+');
}
