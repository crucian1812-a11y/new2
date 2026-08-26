// Driving two skeletons from one paired pose.
//
// The order matters and it is the same order every frame:
//
//   1. slerp both skeletons from the pose they were in to the pose they are
//      going to, including the offset between their hips;
//   2. put that pair frame down on the mat wherever the fight has drifted to;
//   3. add the small motions that stop a held position looking like a
//      photograph — breathing, the tremor of a stalled bridge, the sag of a
//      posture that has been broken;
//   4. weld the hands to whatever they are gripping.
//
// Steps 3 and 4 are in that order deliberately. Breathing has to move the
// chest before the arm is solved onto the lapel, otherwise the grip slides
// with every breath, which is the exact thing IK is here to prevent.

import { POSES } from './poses.js';
import { GRIP_POINTS } from '../render/body.js';
import {
  Skeleton, BONE_INDEX, BONE_COUNT, poseToQuats, solveTwoBone,
} from '../render/skeleton.js';
import { quat, qEuler, qMul, qSlerp, v3, v3lerp, m4point, smooth, clamp } from '../core/m4.js';

const _t = v3();
const _t2 = v3();
const _t3 = v3();
// Shoulder to wrist on the rest skeleton: 0.275 + 0.245.
const ARM_REACH = 0.52;
const _q = quat();
const _rq = quat();

// Cache the quaternion form of every authored pose once. Converting fifteen
// poses' worth of degrees to quaternions every frame is pure waste, and the
// data never changes.
const CACHE = new Map();
function quatsOf(poseId, role) {
  const key = poseId + role;
  let c = CACHE.get(key);
  if (!c) {
    c = Array.from({ length: BONE_COUNT }, () => quat());
    poseToQuats(c, POSES[poseId][role]);
    CACHE.set(key, c);
  }
  return c;
}

export class PairRig {
  constructor() {
    this.skel = { A: new Skeleton(), B: new Skeleton() };
    // Where on the mat the exchange is happening, and which way it faces.
    this.origin = v3(0, 0, 0);
    this.yaw = 0;
    this.time = 0;
    // Extra per-role motion the sim asks for: struggle amplitude and a droop
    // that grows as posture is lost.
    this.effort = { A: 0, B: 0 };
    this.slack = { A: 0, B: 0 };
  }

  // from/to are pose ids, t is 0..1 across the transition.
  apply(from, to, t, dt) {
    this.time += dt;
    const e = smooth(clamp(t, 0, 1));
    for (const role of ['A', 'B']) {
      const sk = this.skel[role];
      const qa = quatsOf(from, role);
      const qb = quatsOf(to, role);
      for (let i = 0; i < BONE_COUNT; i++) qSlerp(sk.local[i], qa[i], qb[i], e);

      const ra = POSES[from][role].root;
      const rb = POSES[to][role].root;
      v3lerp(_t, ra.p, rb.p, e);
      // Root rotation is interpolated as a quaternion, not as three angles.
      // A sweep passes through 180 degrees of roll and euler blending puts the
      // fighter through the floor on the way.
      qEuler(_q, ra.r[0], ra.r[1], ra.r[2]);
      qEuler(_rq, rb.r[0], rb.r[1], rb.r[2]);
      qSlerp(sk.rootRot, _q, _rq, e);

      // Place the pair frame: rotate the local offset by the frame yaw, then
      // translate. Then spin the fighter by the same yaw.
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      sk.rootPos[0] = this.origin[0] + _t[0] * c + _t[2] * s;
      sk.rootPos[1] = _t[1];
      sk.rootPos[2] = this.origin[2] - _t[0] * s + _t[2] * c;
      qEuler(_q, 0, (this.yaw * 180) / Math.PI, 0);
      qMul(sk.rootRot, _q, sk.rootRot);

      this._life(role, sk, from, to, e);
      sk.pose();
      this._ground(sk);
    }

    // Grips are resolved after both skeletons are posed, because a grip on the
    // opponent needs the opponent to already be where they are going to be.
    this._grips(from, to, e);

    this.skel.A.finishSkin();
    this.skel.B.finishSkin();
  }

  // Put the pose on the floor.
  //
  // Authored angles are never exactly right about the ground, and they cannot
  // be: the same kneeling pose has to work at the top of a blend, at the bottom
  // of one, and with a breath cycle added on top. Rather than tune every leg
  // by hand and then watch it sink anyway the moment two poses cross-fade, the
  // pose declares roughly what it means and this makes it true — lift until
  // the knees are on the mat, then plant whichever feet are still through it.
  //
  // It only ever pushes up, and only from below, so a fighter whose legs are
  // deliberately in the air is left alone.
  _ground(sk) {
    const FLOOR = 0.05;
    let lift = 0;
    for (const b of ['shinL', 'shinR']) {
      sk.boneHead(_t, b);
      lift = Math.max(lift, FLOOR + 0.055 - _t[1]);
    }
    if (lift > 0.002) {
      // The cap matters: a pose that is genuinely airborne — the top of a
      // throw — would otherwise get shoved onto the mat by its own knees.
      sk.rootPos[1] += Math.min(lift, 0.24);
      sk.pose();
    }
    for (const [th, sh, ft] of [['thighL', 'shinL', 'footL'], ['thighR', 'shinR', 'footR']]) {
      sk.boneHead(_t, ft);
      if (_t[1] < FLOOR + 0.035) {
        _t[1] = FLOOR + 0.042;
        solveTwoBone(sk, th, sh, ft, _t, null, 1);
      }
    }
  }

  // Breathing, effort, and the sag of a broken posture. All of it is additive
  // on top of the authored pose, so a pose never has to be authored twice for
  // "tired" and "fresh".
  _life(role, sk, from, to, e) {
    const T = this.time;
    const eff = this.effort[role];
    const slack = this.slack[role];
    const ground = POSES[to].ground;

    // Breath: faster and deeper the harder they are working.
    const rate = 1.1 + eff * 2.6;
    const breath = Math.sin(T * rate) * (0.55 + eff * 1.6);
    addEuler(sk, 'chest', breath * 1.1, 0, 0);
    addEuler(sk, 'spine', breath * 0.6, 0, 0);
    addEuler(sk, 'neck', -breath * 0.5 + slack * 9, 0, 0);
    addEuler(sk, 'head', slack * 6, Math.sin(T * 0.7) * 1.5, 0);

    // Effort tremor. Two frequencies so it does not read as a sine wave, and
    // scaled by the limb's leverage — a shoulder shakes more than a wrist.
    if (eff > 0.01) {
      const j = (f, a) => (Math.sin(T * f) + Math.sin(T * f * 1.61 + 1.3)) * a * eff;
      addEuler(sk, 'armL', j(17, 1.6), 0, j(13, 1.2));
      addEuler(sk, 'armR', j(16.4, -1.6), 0, j(12.3, -1.2));
      addEuler(sk, 'hips', j(11, 0.9), j(9, 1.4), 0);
      if (ground) {
        addEuler(sk, 'thighL', j(14, 1.4), 0, 0);
        addEuler(sk, 'thighR', j(14.7, -1.4), 0, 0);
      }
    }

    // Posture: as it goes, the spine folds and the head drops. This is the
    // read the player needs at a glance, so it is deliberately overstated.
    if (slack > 0.01) {
      addEuler(sk, 'spine', slack * 12, 0, 0);
      addEuler(sk, 'chest', slack * 8, 0, 0);
      addEuler(sk, 'armL', slack * 10, 0, 0);
      addEuler(sk, 'armR', slack * 10, 0, 0);
    }
  }

  _grips(from, to, e) {
    // A grip fades with the pose it belongs to, so a hand releases a lapel over
    // the same window the body spends leaving the position.
    const list = [];
    collect(list, POSES[from].grips, 1 - e);
    collect(list, POSES[to].grips, e);
    for (const g of list) {
      if (g.w < 0.02) continue;
      const sk = this.skel[g.role];
      const other = this.skel[g.self ? g.role : g.role === 'A' ? 'B' : 'A'];
      const def = GRIP_POINTS[g.point];
      if (!def) continue;
      const bi = BONE_INDEX[def[0]];
      m4point(_t2, other.world[bi], def[1]);
      const L = g.hand === 'L';
      const upper = L ? 'armL' : 'armR';

      // If the target is out of reach the analytic solver has no choice but to
      // point the arm straight at it, and a straight arm aimed at somebody's
      // collar from a metre away is the single most broken-looking thing a rig
      // can do. Fade the grip out instead: the hand goes back to where the pose
      // put it, which is at worst approximately right.
      sk.boneHead(_t3, upper);
      const reach = ARM_REACH;
      const d = Math.hypot(_t2[0] - _t3[0], _t2[1] - _t3[1], _t2[2] - _t3[2]);
      const fit = 1 - smooth(clamp((d - reach * 0.90) / (reach * 0.16), 0, 1));
      const w = g.w * fit;
      if (w < 0.02) continue;

      solveTwoBone(
        sk,
        upper,
        L ? 'foreL' : 'foreR',
        L ? 'handL' : 'handR',
        _t2, null, w
      );
    }
  }
}

function collect(out, grips, w) {
  if (!grips || w <= 0) return;
  for (const g of grips) {
    const found = out.find((o) => o.role === g.role && o.hand === g.hand);
    // Two poses can grip with the same hand. The incoming one wins outright
    // once it is more than half faded in; blending two targets would put the
    // hand somewhere neither pose ever asked for, which looks like a bug.
    if (found) {
      if (w > found.w) {
        found.point = g.point;
        found.self = g.self;
        found.w = Math.max(found.w, w);
      }
      continue;
    }
    out.push({ ...g, w });
  }
}

function addEuler(sk, bone, x, y, z) {
  const i = BONE_INDEX[bone];
  if (i === undefined) return;
  qEuler(_q, x, y, z);
  qMul(sk.local[i], sk.local[i], _q);
}
