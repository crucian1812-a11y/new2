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
import { ARCS, VIAS } from './arcs.js';
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
const _b1 = quat();
const _b2 = quat();
const _p1 = v3();
const _p2 = v3();

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

// The offline pose solver edits POSES in place and needs the cache to notice.
// Nothing at runtime ever calls this — poses do not change during a match.
export function invalidatePose(id) {
  CACHE.delete(id + 'A');
  CACHE.delete(id + 'B');
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

  invalidate(id) { invalidatePose(id); }

  // from/to are pose ids, t is 0..1 across the transition.
  apply(from, to, t, dt) {
    this.time += dt;
    const e = smooth(clamp(t, 0, 1));

    // Mid-transition, give the two of them room.
    //
    // A transition is a slerp between two paired poses, and the straight line
    // between two valid tangles runs through invalid ones: halfway from closed
    // guard to a sweep, an arm is inside a ribcage. No amount of tuning either
    // endpoint fixes it, because neither endpoint is wrong.
    //
    // This used to be one number — push them apart a little, close again at the
    // end — and it was not enough by a long way. With the endpoints down to
    // eight centimetres the worst moment in flight was still twenty-nine, and
    // nothing measured it, because everything measured poses. blend-check.mjs
    // measures it now and arcs.js holds the answer: one small vector per
    // transition, in the pair's own frame, solved offline against the same
    // capsules the poses were. It is a lot more honest than a scalar — a thigh
    // through a hip needs to move a particular way, not just outwards.
    // Two lobes, not one.
    //
    // A single correction peaking at the halfway mark cannot fix a collision at
    // a third of the way through and a different one at five sixths, and
    // several transitions have exactly that. Two overlapping bumps — one
    // weighted towards the start of the blend, one towards the end, both zero
    // at either end — give the path a shape instead of a bulge.
    const arc = ARCS[from + '>' + to];
    const via = from === to ? null : VIAS[from + '>' + to];
    const bell = from === to ? 0 : Math.sin(clamp(t, 0, 1) * Math.PI);
    const w0 = bell * (1 - t) * 2;
    const w1 = bell * t * 2;
    const gap = bell * (arc ? 0 : 0.062);
    for (const role of ['A', 'B']) {
      const sk = this.skel[role];
      const qa = quatsOf(from, role);
      const qb = quatsOf(to, role);
      const qv = via ? quatsOf(via, role) : null;
      if (qv) {
        // A curve through a third pose, not a straight line to the second.
        //
        // Some transitions cannot be done in a straight line at all. Taking
        // side control from the back means a leg has to come out from between
        // the other man's and travel round him, and every point on the straight
        // line between those two tangles has it going through him instead — a
        // correction that swells in the middle cannot route a limb around a
        // body, it can only shove the body.
        //
        // So the path is a quadratic through a third pose from the library,
        // built the way a Bézier is: slerp to the middle pose, slerp from it,
        // slerp between those. The middle pose is only ever pulled to half
        // weight, so the pair leans through it rather than visiting it.
        for (let i = 0; i < BONE_COUNT; i++) {
          qSlerp(_b1, qa[i], qv[i], e);
          qSlerp(_b2, qv[i], qb[i], e);
          qSlerp(sk.local[i], _b1, _b2, e);
        }
      } else {
        for (let i = 0; i < BONE_COUNT; i++) qSlerp(sk.local[i], qa[i], qb[i], e);
      }

      const ra = POSES[from][role].root;
      const rb = POSES[to][role].root;
      if (via) {
        const rv = POSES[via][role].root;
        v3lerp(_p1, ra.p, rv.p, e);
        v3lerp(_p2, rv.p, rb.p, e);
        v3lerp(_t, _p1, _p2, e);
      } else {
        v3lerp(_t, ra.p, rb.p, e);
      }
      // Root rotation is interpolated as a quaternion, not as three angles.
      // A sweep passes through 180 degrees of roll and euler blending puts the
      // fighter through the floor on the way.
      qEuler(_q, ra.r[0], ra.r[1], ra.r[2]);
      qEuler(_rq, rb.r[0], rb.r[1], rb.r[2]);
      if (via) {
        const rv = POSES[via][role].root;
        qEuler(_b1, rv.r[0], rv.r[1], rv.r[2]);
        qSlerp(_b2, _q, _b1, e);
        qSlerp(_b1, _b1, _rq, e);
        qSlerp(sk.rootRot, _b2, _b1, e);
      } else {
        qSlerp(sk.rootRot, _q, _rq, e);
      }
      // A waypoint can turn a fighter as well as move him. Half the fixes in
      // flight are a twist: side control to mount is the top man's whole body
      // rotating over the bottom one, and the straight line between those two
      // attitudes goes through him rather than around.
      if (arc) {
        for (let l = 0; l < arc.length; l++) {
          const d = arc[l].r && arc[l].r[role];
          if (!d) continue;
          const w = l === 0 ? w0 : w1;
          qEuler(_q, d[0] * w, d[1] * w, d[2] * w);
          qMul(sk.rootRot, sk.rootRot, _q);
        }
      }

      // Place the pair frame: rotate the local offset by the frame yaw, then
      // translate. Then spin the fighter by the same yaw.
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      // The scramble gap pushes each of them away from the pair's own centre,
      // so it opens the tangle rather than sliding it sideways.
      const away = Math.hypot(_t[0], _t[2]) || 1;
      let gx = _t[0] + (_t[0] / away) * gap;
      let gz = _t[2] + (_t[2] / away) * gap;
      let gy = _t[1] + gap * 0.35;
      // The solved arc, half to each of them in opposite directions, so it
      // opens the tangle rather than sliding it across the mat.
      if (arc) {
        const dir = role === 'A' ? 0.5 : -0.5;
        for (let l = 0; l < arc.length; l++) {
          const lobe = arc[l];
          if (!lobe.p) continue;
          const half = (l === 0 ? w0 : w1) * dir;
          gx += lobe.p[0] * half;
          gy += lobe.p[1] * half;
          gz += lobe.p[2] * half;
        }
      }
      sk.rootPos[0] = this.origin[0] + gx * c + gz * s;
      sk.rootPos[1] = gy;
      sk.rootPos[2] = this.origin[2] - gx * s + gz * c;
      qEuler(_q, 0, (this.yaw * 180) / Math.PI, 0);
      qMul(sk.rootRot, _q, sk.rootRot);

      // The waypoint's joint deltas, if this transition has any. They ride on
      // top of the slerp with the same swell, so both endpoints are untouched.
      if (arc) {
        for (let l = 0; l < arc.length; l++) {
          const j = arc[l].j && arc[l].j[role];
          if (!j) continue;
          const w = l === 0 ? w0 : w1;
          for (const bone in j) {
            const d = j[bone];
            addEuler(sk, bone, d[0] * w, d[1] * w, d[2] * w);
          }
        }
      }
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
