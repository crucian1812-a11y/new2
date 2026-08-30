// The skeleton, and the one idea the whole game rests on.
//
// You cannot animate grappling one fighter at a time. A guard pass is not
// "fighter A plays pass.anim while fighter B plays getting-passed.anim" — the
// two bodies are a single articulated object with two roots, and the moment
// they drift apart by two centimetres a shin is inside a ribcage and the shot
// is ruined.
//
// So every keyframe in this game is a PAIRED pose: one record holding the
// joint angles of both skeletons plus the offset between their hips. A
// transition is a slerp between two paired poses. Contact is then fixed up by
// IK: each pose declares which hand holds what (a lapel, a wrist, an ankle),
// and the arm chain is solved onto that point after the blend, so the grip
// stays welded through the whole move even while everything else interpolates.

import {
  quat, qIdent, qEuler, qMul, qSlerp, qBetween, m4, m4compose, m4mul,
  m4invRigid, m4dir, v3, v3set, v3copy, v3sub, v3norm, v3len, v3dot, v3cross, clamp,
} from '../core/m4.js';

// name, parent, rest offset from parent's head.
// Y up, +Z is the direction the fighter faces, +X is their left.
export const BONES = [
  ['hips', -1, [0, 0, 0]],
  ['spine', 0, [0, 0.105, 0]],
  ['chest', 1, [0, 0.145, 0]],
  ['neck', 2, [0, 0.185, 0]],
  ['head', 3, [0, 0.075, 0]],
  ['headTop', 4, [0, 0.2, 0]],

  ['clavL', 2, [0.045, 0.15, 0.005]],
  ['armL', 6, [0.135, 0.0, 0]],
  ['foreL', 7, [0, -0.275, 0]],
  ['handL', 8, [0, -0.245, 0]],
  ['handLTip', 9, [0, -0.095, 0]],

  ['clavR', 2, [-0.045, 0.15, 0.005]],
  ['armR', 11, [-0.135, 0.0, 0]],
  ['foreR', 12, [0, -0.275, 0]],
  ['handR', 13, [0, -0.245, 0]],
  ['handRTip', 14, [0, -0.095, 0]],

  ['thighL', 0, [0.085, -0.045, 0]],
  ['shinL', 16, [0, -0.425, 0]],
  ['footL', 17, [0, -0.41, 0]],
  ['toeL', 18, [0, -0.055, 0.15]],

  ['thighR', 0, [-0.085, -0.045, 0]],
  ['shinR', 20, [0, -0.425, 0]],
  ['footR', 21, [0, -0.41, 0]],
  ['toeR', 22, [0, -0.055, 0.15]],
];

export const BONE_INDEX = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
export const BONE_COUNT = BONES.length;

// Bones whose segment carries no skin: the tips exist only so the bone before
// them has a direction and a length.
export const TIPS = new Set(['headTop', 'handLTip', 'handRTip', 'toeL', 'toeR']);

const HIP_HEIGHT = 0.94;

export class Skeleton {
  constructor() {
    this.rest = BONES.map((b) => v3(b[2][0], b[2][1], b[2][2]));
    this.parent = BONES.map((b) => b[1]);
    // Each bone's own direction, in its local frame: the way its first child
    // sits. Arms and legs are built pointing down, the spine points up, so
    // there is no single "bone axis" convention to lean on — it has to be read
    // off the rest skeleton, and everything that aims a bone reads it here.
    this.axis = BONES.map(() => v3(0, 1, 0));
    for (let i = BONE_COUNT - 1; i >= 0; i--) {
      const p = BONES[i][1];
      if (p >= 0) v3norm(this.axis[p], this.rest[i]);
    }
    this.local = Array.from({ length: BONE_COUNT }, () => quat());
    this.world = Array.from({ length: BONE_COUNT }, () => m4());
    this.bind = Array.from({ length: BONE_COUNT }, () => m4());
    this.invBind = Array.from({ length: BONE_COUNT }, () => m4());
    this.skin = new Float32Array(BONE_COUNT * 16);
    this.rootPos = v3(0, HIP_HEIGHT, 0);
    this.rootRot = quat();
    this._tmpM = m4();
    this._tmpV = v3();
    this._tmpQ = quat();
    this._rootQ = quat();
    this.computeBind();
    this.pose();
  }

  // The bind pose is the rest skeleton standing at the origin. Every vertex is
  // authored in that space, so the inverse bind is what takes it back to a
  // bone's local frame before the animated world matrix puts it somewhere new.
  computeBind() {
    const t = m4();
    for (let i = 0; i < BONE_COUNT; i++) {
      m4compose(t, IDENT_Q, this.rest[i]);
      if (this.parent[i] < 0) {
        m4compose(this.bind[i], IDENT_Q, [0, HIP_HEIGHT, 0]);
      } else {
        m4mul(this.bind[i], this.bind[this.parent[i]], t);
      }
      m4invRigid(this.invBind[i], this.bind[i]);
    }
  }

  // Walk the hierarchy once, then fold in the inverse bind. Parents always come
  // before children in BONES, so one linear pass is enough — no recursion, no
  // sort, no allocation.
  pose() {
    const t = this._tmpM;
    for (let i = 0; i < BONE_COUNT; i++) {
      if (this.parent[i] < 0) {
        // The root bone carries both: where the fighter is (rootRot) and what
        // their pelvis is doing inside that (local). Dropping the second is
        // what quietly made every `hips:` line in the pose data a no-op.
        qMul(this._rootQ, this.rootRot, this.local[i]);
        m4compose(this.world[i], this._rootQ, this.rootPos);
      } else {
        m4compose(t, this.local[i], this.rest[i]);
        m4mul(this.world[i], this.world[this.parent[i]], t);
      }
    }
    for (let i = 0; i < BONE_COUNT; i++) {
      m4mul(t, this.world[i], this.invBind[i]);
      this.skin.set(t, i * 16);
    }
  }

  boneHead(out, name) {
    const m = this.world[BONE_INDEX[name]];
    return v3set(out, m[12], m[13], m[14]);
  }

  boneAxis(out, name) {
    const i = BONE_INDEX[name];
    return v3norm(out, m4dir(out, this.world[i], this.axis[i]));
  }
}

const IDENT_Q = quat();

/* ---------------------------------------------------------------- poses --- */

// A pose is a plain object: { bone: [x, y, z] } in degrees, plus `root`.
// Missing bones mean "rest", which keeps the data files readable — a mount
// pose only writes the joints that differ from standing.

export function poseToQuats(out, pose) {
  for (let i = 0; i < BONE_COUNT; i++) qIdent(out[i]);
  for (const name in pose.j) {
    const i = BONE_INDEX[name];
    if (i === undefined) continue;
    const e = pose.j[name];
    qEuler(out[i], e[0], e[1], e[2]);
  }
  return out;
}

export function blendQuats(out, a, b, t) {
  for (let i = 0; i < BONE_COUNT; i++) qSlerp(out[i], a[i], b[i], t);
  return out;
}

/* ------------------------------------------------------------------- IK --- */

const _a = v3(), _b = v3(), _c = v3(), _d = v3(), _e = v3(), _f = v3();
const _q = quat(), _q2 = quat();

// Two-bone IK, solved analytically: place the end of a hand/foot chain on a
// world-space target by choosing the elbow (or knee) angle from the law of
// cosines and then swinging the whole chain to point at the goal.
//
// Working in world space and pushing the result back through the parent's
// inverse is more arithmetic than a local-space solve, but it is the only
// version that stays correct when the fighter's root is upside down, which on
// the bottom of side control it very often is.
export function solveTwoBone(sk, upper, lower, end, target, poleDir, weight = 1) {
  const iU = BONE_INDEX[upper];
  const iL = BONE_INDEX[lower];
  const iE = BONE_INDEX[end];

  sk.boneHead(_a, upper); // shoulder
  sk.boneHead(_b, lower); // elbow
  sk.boneHead(_c, end); // wrist

  const lenU = v3len(v3sub(_d, _b, _a));
  const lenL = v3len(v3sub(_d, _c, _b));

  v3sub(_d, target, _a);
  let dist = v3len(_d);
  const maxReach = (lenU + lenL) * 0.999;
  const minReach = Math.abs(lenU - lenL) * 1.001 + 1e-4;
  dist = clamp(dist, minReach, maxReach);
  v3norm(_d, _d);

  // Where the elbow has to sit for the chain to close on a target `dist` away.
  const cosU = clamp((lenU * lenU + dist * dist - lenL * lenL) / (2 * lenU * dist), -1, 1);
  const angU = Math.acos(cosU);

  // Bend plane: the goal direction crossed with the pole vector. With no pole
  // given, the pole is wherever the authored pose already put the elbow, which
  // is the behaviour you want almost always — the pose decides how the arm is
  // bent, and IK only decides where the hand ends up.
  if (poleDir) v3copy(_f, poleDir);
  else v3sub(_f, _b, _a);
  v3norm(_f, _f);
  v3cross(_e, _d, _f);
  if (v3len(_e) < 1e-4) {
    // Pole parallel to the goal: any perpendicular will do, and the arm was
    // straight anyway so nothing visible depends on the choice.
    v3set(_e, -_d[1], _d[0], _d[2]);
    v3cross(_e, _d, _e);
  }
  v3norm(_e, _e);

  // Upper-bone direction = goal direction rotated by angU about the bend axis.
  rotAbout(_f, _d, _e, angU);

  applyWorldAim(sk, iU, _f, weight);
  sk.poseFrom(iU);

  // With the shoulder placed, the elbow's new world position is known; aim the
  // forearm straight at the target from there.
  sk.boneHead(_b, lower);
  v3sub(_f, target, _b);
  v3norm(_f, _f);
  applyWorldAim(sk, iL, _f, weight);
  sk.poseFrom(iL);
  return iE;
}

function rotAbout(out, v, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const dot = v3dot(axis, v);
  v3cross(_tmpCross, axis, v);
  out[0] = v[0] * c + _tmpCross[0] * s + axis[0] * dot * (1 - c);
  out[1] = v[1] * c + _tmpCross[1] * s + axis[1] * dot * (1 - c);
  out[2] = v[2] * c + _tmpCross[2] * s + axis[2] * dot * (1 - c);
  return out;
}
const _tmpCross = v3();

// Turn a bone so it points along `dir` in world space, expressed as a change to
// its local rotation. Exported because retargeting needs exactly this: aiming a
// bone at a direction taken from another rig is what makes the two rigs' rest
// poses stop mattering.
export function aimBone(sk, name, dir, weight = 1) {
  applyWorldAim(sk, BONE_INDEX[name], dir, weight);
  sk.poseFrom(BONE_INDEX[name]);
}

function applyWorldAim(sk, i, dir, weight) {
  m4dir(_aim, sk.world[i], sk.axis[i]); // where the bone currently points
  v3norm(_aim, _aim);
  qBetween(_q, _aim, dir);
  if (weight < 1) qSlerp(_q, IDENT_Q, _q, weight);

  // Move that world-space delta into the bone's local frame: local' =
  // parentWorldRot^-1 * delta * parentWorldRot * local.
  const p = sk.parent[i];
  if (p < 0) {
    qMul(sk.rootRot, _q, sk.rootRot);
    return;
  }
  quatFromMat(_q2, sk.world[p]);
  const inv = _qInv;
  inv[0] = -_q2[0]; inv[1] = -_q2[1]; inv[2] = -_q2[2]; inv[3] = _q2[3];
  qMul(_qA, inv, _q);
  qMul(_qB, _qA, _q2);
  qMul(sk.local[i], _qB, sk.local[i]);
}
const _aim = v3();
const _qInv = quat(), _qA = quat(), _qB = quat();

export function quatFromMat(out, m) {
  // Assumes an orthonormal 3x3; every matrix here is rigid.
  const m00 = m[0], m01 = m[4], m02 = m[8];
  const m10 = m[1], m11 = m[5], m12 = m[9];
  const m20 = m[2], m21 = m[6], m22 = m[10];
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out[3] = 0.25 * s;
    out[0] = (m21 - m12) / s;
    out[1] = (m02 - m20) / s;
    out[2] = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out[3] = (m21 - m12) / s;
    out[0] = 0.25 * s;
    out[1] = (m01 + m10) / s;
    out[2] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out[3] = (m02 - m20) / s;
    out[0] = (m01 + m10) / s;
    out[1] = 0.25 * s;
    out[2] = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out[3] = (m10 - m01) / s;
    out[0] = (m02 + m20) / s;
    out[1] = (m12 + m21) / s;
    out[2] = 0.25 * s;
  }
  return out;
}

// Re-run the hierarchy from one bone downwards. IK edits a shoulder and then
// immediately needs the elbow's new world position; recomputing all 24 bones
// twice per arm per fighter per frame is waste the phone can feel.
Skeleton.prototype.poseFrom = function (start) {
  const t = this._tmpM;
  for (let i = start; i < BONE_COUNT; i++) {
    if (this.parent[i] < 0) {
      qMul(this._rootQ, this.rootRot, this.local[i]);
      m4compose(this.world[i], this._rootQ, this.rootPos);
    } else if (i >= start) {
      m4compose(t, this.local[i], this.rest[i]);
      m4mul(this.world[i], this.world[this.parent[i]], t);
    }
  }
};

Skeleton.prototype.finishSkin = function () {
  const t = this._tmpM;
  for (let i = 0; i < BONE_COUNT; i++) {
    m4mul(t, this.world[i], this.invBind[i]);
    this.skin.set(t, i * 16);
  }
};
