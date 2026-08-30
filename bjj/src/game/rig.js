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

import { POSES, HOLD_LOOPS } from './poses.js';
import { ARCS, VIAS } from './arcs.js';

// Where along the path a via bites.
//
// A via used to be one pose leaned through at the exact middle, and the routes
// it fixed were the ones whose collision was there. Ranking every candidate
// for the nine transitions still on the work list said the rest are not:
// their worst moment is at t = 0.6 to 0.72, past the middle, where a bump
// peaking at 0.5 has already faded to a third of itself. A better pose in the
// middle cannot help a path that goes wrong after it.
//
// So a via may say when as well as what. `POSE@late` and `POSE@early` are
// cubics with a doubled endpoint — control points (A, A, V, B) and
// (A, V, B, B) — whose weight for V peaks at two thirds and one third
// respectively. Plain `POSE` is the quadratic it always was, evaluated by the
// same three slerps, so none of the routes already solved move by a hair.
//
// Parsed on demand and memoised by the string itself, not snapshotted at load.
// via-pick and arc-solve try candidates by assigning into VIAS and blending,
// and a table built once at import time ignores them: the first version of
// this took every route in the file as final and reported that no pose helps
// anywhere. Keying the memo on the value means a changed route is a changed
// plan, and an unchanged one costs a map lookup.
const _plans = new Map();
function planFor(key) {
  const v = VIAS[key];
  if (v === undefined) return null;
  let p = _plans.get(v);
  if (!p) {
    const bits = v.split('@');
    // `POSE`, `POSE@late`, `POSE@late+A`. The role suffix says the curve is
    // one man's: in every transition still on the work list it is the top
    // man's leg that has to travel round, and the man underneath is lying
    // still. Leaning him through a third pose as well moves him out from
    // under his own legs and invents a collision that was not there.
    const plus = bits[1] ? bits[1].split('+') : [];
    p = { pose: bits[0], at: plus[0] || 'mid', role: plus[1] || null };
    _plans.set(v, p);
  }
  return p;
}
import { GRIP_POINTS } from '../render/body.js';
import {
  Skeleton, BONE_INDEX, BONE_COUNT, poseToQuats, solveTwoBone,
} from '../render/skeleton.js';
import { quat, qEuler, qMul, qSlerp, qCopy, v3, v3set, v3lerp, m4point, smooth, clamp } from '../core/m4.js';

const _t = v3();
const _t2 = v3();
const _t3 = v3();
// Shoulder to wrist on the rest skeleton: 0.275 + 0.245.
const ARM_REACH = 0.52;
const _q = quat();
const _rq = quat();
const _b1 = quat();
const _keepU = quat();
const _keepL = quat();
const _b2 = quat();
// A deterministic scatter for the hold loop: same inputs, same numbers, every
// run and every machine.
function hash2(a, b) {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) | 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// What lags behind the skeleton, and by how much. A head weighs five kilos and
// is held on by muscle that is not infinitely stiff; a forearm swings; a hand
// arrives last. Everything else on this rig is bone against bone and does not.
// The smoothstep, undone. s = t*t*(3-2t) has one root in [0,1] and this is it.
function unsmooth(s) {
  const c = clamp(1 - 2 * s, -1, 1);
  return 0.5 - Math.sin(Math.asin(c) / 3);
}

// The shape of a transition in time.
//
// It was a smoothstep: the same acceleration as deceleration, a symmetric bell,
// which is the curve of something being carried rather than something throwing
// itself. Everything a body does to move another body has three parts — it
// gathers, it goes, and it arrives — and the middle one is much faster than a
// bell.
//
// Kept inside [0, 1] on purpose. A wind-up that reads as one would run the
// blend backwards past the pose it started from, and a slerp extrapolated past
// its ends is not a pose any more; the gather is a hesitation instead, which
// costs an eighth of the time and buys the same read.
function weight(t) {
  if (t < 0.14) {
    const u = t / 0.14;
    return 0.05 * u * u;
  }
  const u = (t - 0.14) / 0.86;
  return 0.05 + 0.95 * (1 - Math.pow(1 - u, 2.3));
}

// Weighted by what each part costs when it is wrong. A head that lags is free:
// nothing collides with a head at close range that is not already touching it.
// Hands are the opposite — they are what grips and what the collision judge
// spends most of its time on — so they lag least, and that is a compromise
// with the geometry rather than with the physics.
const LAG_BONES = [['head', 1.3], ['neck', 0.6], ['foreL', 1.1], ['foreR', 1.1], ['handL', 1.0], ['handR', 1.0]];

const _p1 = v3();
const _p2 = v3();
const _p3 = v3();
const _b3 = quat();
const _c1 = quat();
const _c2 = quat();

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
    // Where each foot is standing, and whether it is in the air on its way to
    // somewhere else. See _step: this is what makes walking a walk.
    // How fast the pair is crossing the mat, smoothed. The step planner needs
    // it to know where to put a foot down: a step lands where the body is
    // going, not where it has been.
    this.vel = v3(0, 0, 0);
    this._lastOrigin = v3(0, 0, 0);
    // The two layers that depend on what happened last frame rather than on
    // the pose: the step planner and the inertia. A tool stepping along a path
    // is not moving through time — it jumps a few centimetres per sample and
    // visits transitions in whatever order it likes — so both are switched off
    // for measurement, and what is measured is the path itself.
    this.live = true;
    this.lag = true;
    this.walk = true;

    this.inert = { A: {}, B: {} };
    for (const role of ['A', 'B']) {
      for (const [bone] of LAG_BONES) {
        this.inert[role][bone] = { set: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0 };
      }
    }
    this.feet = {
      A: [{ at: v3(0, 0, 0), from: v3(0, 0, 0), to: v3(0, 0, 0), t: 1, set: false },
          { at: v3(0, 0, 0), from: v3(0, 0, 0), to: v3(0, 0, 0), t: 1, set: false }],
      B: [{ at: v3(0, 0, 0), from: v3(0, 0, 0), to: v3(0, 0, 0), t: 1, set: false },
          { at: v3(0, 0, 0), from: v3(0, 0, 0), to: v3(0, 0, 0), t: 1, set: false }],
    };
    this.yaw = 0;
    this.time = 0;
    // Extra per-role motion the sim asks for: struggle amplitude and a droop
    // that grows as posture is lost.
    this.effort = { A: 0, B: 0 };
    this.slack = { A: 0, B: 0 };
    // How far out of gas each of them is, 0 to 1. Separate from effort on
    // purpose: effort is what a man is doing this second and stops when he
    // stops, and gas is what three minutes have done to him and does not.
    this.gas = { A: 0, B: 0 };
  }

  invalidate(id) { invalidatePose(id); }

  // from/to are pose ids, t is 0..1 across the transition.
  // Holding a position.
  //
  // A held position used to be one pose with breathing on it, and the fight
  // spends three quarters of its time held — mostly on somebody's back. So a
  // position with variants cycles through them: out to the variant quickly, the
  // way a grappler takes ground, and back slowly, the way he settles onto it.
  //
  // The phase resets when the position changes, so every hold starts from the
  // pose the transition into it ended on and nothing jumps.
  hold(id, dt) {
    const loop = HOLD_LOOPS[id];
    if (!loop || !loop.length) return this.apply(id, id, 1, dt);
    if (this.heldId !== id) {
      this.heldId = id;
      this.heldT = 0;
      this.legN = 0;
      this.legT = 0;
      this._leg(id);
    }
    // Work harder and the cycle runs faster and reaches further: the two are
    // the same fact about a man under pressure, and the effort the sim already
    // tracks is where it is written.
    const eff = Math.max(this.effort.A, this.effort.B);
    this.heldT += dt;
    this.legT += dt;
    if (this.legT >= this.legDur) {
      this.legT -= this.legDur;
      this.legN++;
      this._leg(id);
    }
    const u = this.legT / this.legDur;
    const raw = u < this.legOut ? u / this.legOut : 1 - (u - this.legOut) / (1 - this.legOut);
    this.apply(id, loop[this.legN % loop.length], smooth(raw) * (0.55 + 0.45 * eff) * this.legReach, dt);
  }

  // Each trip out to a variant and back gets its own length, its own reach and
  // its own shape.
  //
  // Without this the loop is a metronome, and pose-check says by how much: held
  // for forty seconds, closed guard used to repeat itself 99% at exactly five
  // seconds and half guard 97% at ten. A third variant would have moved the
  // repeat to fifteen seconds and left it at 99%, which is why the count of
  // poses was the wrong thing to add — the evenness was the fault, not the
  // shortness.
  //
  // The numbers come out of a hash of the position and the lap, not out of
  // Math.random: the same hold plays the same way twice, which is what lets a
  // measurement of it mean anything.
  _leg(id) {
    const eff = Math.max(this.effort.A, this.effort.B);
    const period = 5.4 - 2.0 * eff;
    const r = (k) => hash2(this._idSeed(id), this.legN * 3 + k);
    this.legDur = period * (0.70 + 0.62 * r(0));
    this.legReach = 0.72 + 0.28 * r(1);
    // How much of the leg is spent going out. Quick out and slow back is what
    // a hip switch looks like; how quick varies too.
    this.legOut = 0.30 + 0.18 * r(2);
  }

  _idSeed(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return h;
  }

  apply(from, to, t, dt) {
    this.time += dt;
    this._dt = dt;
    if (dt > 1e-5) {
      const k = Math.min(1, dt * 8);
      this.vel[0] += ((this.origin[0] - this._lastOrigin[0]) / dt - this.vel[0]) * k;
      this.vel[2] += ((this.origin[2] - this._lastOrigin[2]) / dt - this.vel[2]) * k;
      this._lastOrigin[0] = this.origin[0];
      this._lastOrigin[2] = this.origin[2];
    }
    const raw = clamp(t, 0, 1);
    const inPlaceCurve = from === to || POSES[to].variantOf === from || POSES[from].variantOf === to;
    // The timing curve, and the only place it lives.
    //
    // Everything below this line works in the pose parameter, not the clock:
    // where the pair is between two poses, not how long it has taken to get
    // there. That separation is not tidiness, it is a bug that was found by
    // making it — reshaping the timing moved the samples blend-check takes
    // along the path, and the work list went from one transition to eleven
    // without a single pose or correction changing. The path had always had
    // those moments in it; the judge had been stepping over them.
    return this.applyAt(from, to, inPlaceCurve ? smooth(raw) : weight(raw), dt, inPlaceCurve);
  }

  // The same blend, addressed by where it is rather than by when.
  //
  // Tools drive this directly and step it uniformly, so what they measure is
  // the path itself; the game goes through `apply`, which decides the timing.
  applyAt(from, to, e, dt, inPlaceKnown) {
    this._dt = dt;
    const inPlaceCurve = inPlaceKnown !== undefined ? inPlaceKnown
      : from === to || POSES[to].variantOf === from || POSES[from].variantOf === to;

    // The landing was tried here and taken out again.
    //
    // A body that stops after throwing itself somewhere does not stop dead, so
    // the pelvis of the man who arrives dropped three centimetres and came back
    // up over a third of a second. It reads well and it costs exactly what it
    // is worth: three centimetres of somebody else, at the moment the two of
    // them are closest. The work list went from one transition to seventeen and
    // two hold loops became too deep to ship. Dropping both men together costs
    // nothing in geometry and reads as the camera moving rather than as a
    // landing, and the impact already has a camera impulse behind it (see
    // onMatchEvent). The timing curve below is where the weight comes from.

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
    // A position moving inside itself is not a transition. Its two poses are a
    // few centimetres apart and share their intent and their grips, so there is
    // nothing to route around: no arc, no via, and above all no default gap —
    // prising the pair apart six centimetres in the middle of a held mount is a
    // pulse, and a held mount is what the fight looks like most of the time.
    const inPlace = from === to || POSES[to].variantOf === from || POSES[from].variantOf === to;
    // Anything that is not a position moving inside itself ends the hold. A
    // transition lands on the base pose, so a loop resumed from the middle of
    // its cycle would jump on arrival — leaving and coming back to the same
    // position has to start the cycle again.
    if (!inPlace) this.heldId = null;
    const arc = ARCS[from + '>' + to];
    const plan = inPlace ? null : planFor(from + '>' + to);
    const late = plan ? plan.at === 'late' : false;
    const early = plan ? plan.at === 'early' : false;
    // The arc is a correction to the pose, not to the clock.
    //
    // Every arc in arcs.js was solved by sampling the blend at uniform t, when
    // t and the pose were related by a smoothstep. Reshaping that curve moves
    // the pose without moving the correction, and the two stop lining up: the
    // solver's work would be applied a tenth of a second from where it belongs.
    // Undoing the smoothstep gives the parameter the solver used — the same
    // pose gets the same correction it was solved with, whatever the timing
    // curve does.
    const arcT = unsmooth(e);
    const bell = from === to ? 0 : Math.sin(arcT * Math.PI);
    // The lobes' weights. Two of them — one leaning early, one late — was
    // enough for everything that has come off the work list; the seven that
    // are left fail at t = 0.42 to 0.85 and want a shape rather than a tilt,
    // so the count is whatever the solved arc has. The family is the same
    // either way — Bernstein bumps scaled by L — so a two-lobe arc evaluates
    // exactly as it always did.
    const lobeW = (L, k) => {
      if (L === 2) return k === 0 ? bell * (1 - arcT) * 2 : bell * arcT * 2;
      let c = 1;                                     // binomial(L-1, k)
      for (let i = 0; i < k; i++) c = (c * (L - 1 - i)) / (i + 1);
      return bell * L * c * Math.pow(arcT, k) * Math.pow(1 - arcT, L - 1 - k);
    };
    // The blanket nudge apart is for a transition with no solved arc yet. A
    // position moving inside itself gets none of it: prising a held mount apart
    // by six centimetres in the middle of its own breathing cycle is a pulse,
    // and it is a solved arc or nothing.
    const gap = inPlace ? 0 : bell * (arc ? 0 : 0.062);
    for (const role of ['A', 'B']) {
      const sk = this.skel[role];
      // A role-restricted via is a straight line for the other man.
      const via = plan && (!plan.role || plan.role === role) ? plan.pose : null;
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
        if (late || early) {
          // De Casteljau on four control points, two of which are the same
          // pose. (A, A, V, B) leans late; (A, V, B, B) leans early.
          for (let i = 0; i < BONE_COUNT; i++) {
            const p1 = late ? qa[i] : qv[i];
            const p2 = late ? qv[i] : qb[i];
            qSlerp(_b1, qa[i], p1, e);
            qSlerp(_b2, p1, p2, e);
            qSlerp(_b3, p2, qb[i], e);
            qSlerp(_c1, _b1, _b2, e);
            qSlerp(_c2, _b2, _b3, e);
            qSlerp(sk.local[i], _c1, _c2, e);
          }
        } else {
          for (let i = 0; i < BONE_COUNT; i++) {
            qSlerp(_b1, qa[i], qv[i], e);
            qSlerp(_b2, qv[i], qb[i], e);
            qSlerp(sk.local[i], _b1, _b2, e);
          }
        }
      } else {
        for (let i = 0; i < BONE_COUNT; i++) qSlerp(sk.local[i], qa[i], qb[i], e);
      }

      const ra = POSES[from][role].root;
      const rb = POSES[to][role].root;
      if (via) {
        const rv = POSES[via][role].root;
        if (late || early) {
          const c1 = late ? ra.p : rv.p;
          const c2 = late ? rv.p : rb.p;
          v3lerp(_p1, ra.p, c1, e);
          v3lerp(_p2, c1, c2, e);
          v3lerp(_p3, c2, rb.p, e);
          v3lerp(_p1, _p1, _p2, e);
          v3lerp(_p2, _p2, _p3, e);
          v3lerp(_t, _p1, _p2, e);
        } else {
          v3lerp(_p1, ra.p, rv.p, e);
          v3lerp(_p2, rv.p, rb.p, e);
          v3lerp(_t, _p1, _p2, e);
        }
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
        qEuler(_b3, rv.r[0], rv.r[1], rv.r[2]);
        if (late || early) {
          const c1 = late ? _q : _b3;
          const c2 = late ? _b3 : _rq;
          qSlerp(_b1, _q, c1, e);
          qSlerp(_b2, c1, c2, e);
          qSlerp(_c1, c2, _rq, e);
          qSlerp(_c2, _b1, _b2, e);
          qSlerp(_b2, _b2, _c1, e);
          qSlerp(sk.rootRot, _c2, _b2, e);
        } else {
          qSlerp(_b2, _q, _b3, e);
          qSlerp(_b1, _b3, _rq, e);
          qSlerp(sk.rootRot, _b2, _b1, e);
        }
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
          const w = lobeW(arc.length, l);
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
          const half = lobeW(arc.length, l) * dir;
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
          const w = lobeW(arc.length, l);
          for (const bone in j) {
            const d = j[bone];
            addEuler(sk, bone, d[0] * w, d[1] * w, d[2] * w);
          }
        }
      }
      this._life(role, sk, from, to, e);
      sk.pose();
      this._ground(sk);
      this._step(role, sk, dt, !POSES[to].ground && !POSES[from].ground);
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

  // A step, instead of a slide.
  //
  // Standing, the sim walks the pair around the mat at over a metre a second by
  // moving the frame both fighters hang off. Every bone goes with it, including
  // the feet, so a man crossing the mat did it with his soles glued to it —
  // measured at 1.35 m/s under a foot that was supposed to be planted, with the
  // footstep sound playing over a step that never happened.
  //
  // So the feet get to disagree with the pose. Each one remembers where on the
  // mat it is standing and is solved back to that spot by the same two-bone IK
  // that puts knees on the ground. When the pose has dragged it more than a
  // stride away, it swings: a fixed time, an arc up and over, and it plants
  // again ahead of where the body is going. Only one foot travels at a time,
  // which is what stops this becoming a hop.
  //
  // It is deliberately not a gait: nothing here knows about walk cycles or
  // contact timing. It is the smallest thing that makes a moving fighter look
  // like he is carrying his own weight.
  _step(role, sk, dt, standing) {
    const feet = this.feet[role];
    const names = [['thighL', 'shinL', 'footL'], ['thighR', 'shinR', 'footR']];
    if (!standing || !this.live || !this.walk) {
      // On the ground the pose owns the feet completely.
      feet[0].set = feet[1].set = false;
      return;
    }
    // Sized against the speed the sim actually walks at. The pair covers 1.35
    // metres a second, so a foot that only made up half its drag never caught
    // up: both feet were in the air more often than not and the measured
    // supporting-foot speed stayed at 0.22 m/s. A step has to land ahead of the
    // body, not where the body was.
    const STRIDE = 0.30;     // how far a foot may be dragged before it moves
    const SWING = 0.22;      // seconds in the air
    const LIFT = 0.075;      // how high it comes up on the way
    const LEAD = 1.6;        // how far past the landing point it reaches
    const busy = feet.some((f) => f.t < 1);
    for (let i = 0; i < 2; i++) {
      const f = feet[i];
      const [th, sh, ft] = names[i];
      sk.boneHead(_t, ft);
      const px = _t[0], py = _t[1], pz = _t[2];
      if (!f.set) {
        v3set(f.at, px, py, pz);
        f.set = true;
        f.t = 1;
        continue;
      }
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / SWING);
        const u = f.t;
        const s2 = u * u * (3 - 2 * u);
        f.at[0] = f.from[0] + (f.to[0] - f.from[0]) * s2;
        f.at[2] = f.from[2] + (f.to[2] - f.from[2]) * s2;
        f.at[1] = py + Math.sin(Math.PI * u) * LIFT;
      } else {
        const drag = Math.hypot(px - f.at[0], pz - f.at[2]);
        if (drag > STRIDE && !busy) {
          v3set(f.from, f.at[0], f.at[1], f.at[2]);
          // Where the body will be when this foot lands, plus a little: the
          // target is decided once, at the start of the swing. Recomputing it
          // every frame from a foot that is being dragged along by the body
          // makes it run away — measured at 2.9 m/s under a foot that was
          // supposed to be planted, which is twice the speed of the man.
          v3set(f.to,
            px + this.vel[0] * SWING * LEAD, py,
            pz + this.vel[2] * SWING * LEAD);
          f.t = 0;
        }
        // A planted foot keeps its place on the mat but takes its height from
        // the pose, so crouching still lowers it onto the tatami.
        f.at[1] = py;
      }
      solveTwoBone(sk, th, sh, ft, f.at, null, 1);
    }
  }

  // Breathing, effort, and the sag of a broken posture. All of it is additive
  // on top of the authored pose, so a pose never has to be authored twice for
  // "tired" and "fresh".
  // Nothing arrives at once.
  //
  // Every bone in this rig used to land exactly where the pose said, at exactly
  // the moment it said, which is the difference between animation and a
  // slideshow of positions: a head follows the shoulders it sits on, a forearm
  // swings after the elbow that carries it. This is that lag, and it is taken
  // from the frame before — the world matrices still hold last frame's pose
  // when this runs, so the acceleration of each bone is already there to read.
  //
  // A spring chasing the acceleration rather than the acceleration itself: raw
  // acceleration is a step function at the start of every movement and reads as
  // a twitch. The response is bounded in degrees because the pose is the
  // intent; this only ever says the body has not caught up with it yet.
  _inertia(role, sk, dt) {
    if (!this.live || !this.lag || dt <= 1e-5) return;
    const st = this.inert[role];
    for (const [bone, k] of LAG_BONES) {
      const m = sk.world[BONE_INDEX[bone]];
      const p = st[bone];
      const x = m[12], y = m[13], z = m[14];
      if (!p.set) {
        p.set = true; p.x = x; p.y = y; p.z = z;
        continue;
      }
      // A jump is not a movement. The tooling steps from one pose straight to
      // another, and a match cuts to a new position the same way; a quarter of
      // a metre in one frame is a teleport, and answering it with inertia
      // flings the hands for a tenth of a second afterwards — which is how
      // this first showed up, as a centimetre and a half of extra overlap in
      // a clinch that pose-check had never failed before.
      if (Math.hypot(x - p.x, y - p.y, z - p.z) > 0.25) {
        p.x = x; p.y = y; p.z = z;
        p.vx = p.vy = p.vz = 0;
        p.rx = p.rz = 0;
        continue;
      }
      const vx = (x - p.x) / dt, vy = (y - p.y) / dt, vz = (z - p.z) / dt;
      const ax = (vx - p.vx) / dt, az = (vz - p.vz) / dt;
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
      // A dead zone, so breathing is not an event. A held pose still moves —
      // the chest rises, the head shifts a centimetre — and without this the
      // lag answered that too and quietly deepened the contact in a clinch by
      // a centimetre and a half, which pose-check duly failed. Real movement
      // is five to twenty metres a second squared; a breath is under one.
      const soften = (v) => (v > 1.2 ? v - 1.2 : v < -1.2 ? v + 1.2 : 0);
      const c = Math.min(1, dt * 11);
      p.rx += (clamp(-soften(az) * k * 0.5, -6, 6) - p.rx) * c;
      p.rz += (clamp(soften(ax) * k * 0.5, -6, 6) - p.rz) * c;
      if (Math.abs(p.rx) > 0.05 || Math.abs(p.rz) > 0.05) addEuler(sk, bone, p.rx, 0, p.rz);
    }
  }

  _life(role, sk, from, to, e) {
    const T = this.time;
    this._inertia(role, sk, e === undefined ? 0 : this._dt);
    const eff = this.effort[role];
    const slack = this.slack[role];
    const gas = this.gas[role];
    const ground = POSES[to].ground;

    // Breath: faster and deeper the harder they are working — and it does not
    // come back down when they stop. A man three minutes in is still heaving
    // between exchanges, and that is the whole difference between a fighter
    // who is tired and a bar that says he is.
    const rate = 1.1 + eff * 2.6 + gas * 2.0;
    const breath = Math.sin(T * rate) * (0.55 + eff * 1.6 + gas * 2.4);
    addEuler(sk, 'chest', breath * 1.1, 0, 0);
    addEuler(sk, 'spine', breath * 0.6, 0, 0);
    addEuler(sk, 'neck', -breath * 0.5 + slack * 9, 0, 0);
    addEuler(sk, 'head', slack * 6, Math.sin(T * 0.7) * 1.5, 0);
    // The shoulders go with it. Heaving is the shape of a shoulder girdle
    // lifting, not of a chest inflating, and at this distance the girdle is
    // what is seen.
    if (gas > 0.01) {
      const lift = Math.max(0, breath) * gas;
      addEuler(sk, 'clavL', -lift * 5.5, 0, -lift * 3.4);
      addEuler(sk, 'clavR', -lift * 5.5, 0, lift * 3.4);
      // And the arms stop being carried. Not the collapse `slack` describes —
      // this is weight: elbows hanging lower than they hung in the first
      // minute, and a head that is no longer being held up either.
      addEuler(sk, 'armL', gas * 7, 0, 0);
      addEuler(sk, 'armR', gas * 7, 0, 0);
      addEuler(sk, 'neck', gas * 3.5, 0, 0);
      addEuler(sk, 'head', gas * 4, 0, 0);
    }

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
    // Three times.
    //
    // Half the grips in the library hold a sleeve, and a sleeve is a point on
    // the other man's forearm — which is itself moved, a moment later, by his
    // own grip. Solved once, in list order, a hand closes on where the forearm
    // was and is left holding air: measured across the pose library, six of
    // them were between eleven and fifty-nine centimetres off targets they
    // could comfortably reach. A second pass re-reads the targets after
    // everything has moved, and a third settles the pairs that hold each other's
    // sleeves — that one is circular by nature and converges rather than
    // resolves. Measured across the library: 4.7 cm of average air before,
    // 0.2 cm after, and the worst case 59 cm down to 6.
    //
    // The weight is split across the passes rather than applied whole in each:
    // a two-bone solve at half weight moves the hand half way, so three of them
    // would land it seven eighths of the way there and a grip that is supposed
    // to be releasing would be gripping harder.
    const PASSES = 3;
    for (const g of list) g.pass = 1 - Math.pow(1 - g.w, 1 / PASSES);
    this.curl = {};
    for (let pass = 0; pass < PASSES; pass++) this._solveGrips(list);

    // And the hands close.
    //
    // The whole game is grips, and until now a hand holding a lapel was the
    // same flat paddle as a hand hanging by a hip: the mesh has a palm and a
    // thumb, the rig has two bones for it, and neither was ever asked to do
    // anything. They bend by how much of the grip is on, so a grip fading out
    // opens the hand as it goes.
    //
    // Only the finger bone, and not far. The collider wraps a hand in a
    // capsule and cannot tell fingers round cloth from a fist through a chest,
    // so a closing hand reads to it as depth: at thirty-four degrees on both
    // bones it put eight poses over the line. This is the angle that says
    // "holding" and costs nothing.
    for (const role of ['A', 'B']) {
      const sk = this.skel[role];
      let any = false;
      for (const L of [true, false]) {
        const w = this.curl[role + (L ? 'L' : 'R')] || 0;
        if (w < 0.05) continue;
        addEuler(sk, L ? 'handLTip' : 'handRTip', -w * 16, 0, 0);
        any = true;
      }
      if (any) sk.pose();
    }
  }

  _solveGrips(list) {
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
      // Released only when it is actually out of reach.
      //
      // The fade used to start at nine tenths of the arm — 47 cm of a 52 cm
      // arm — and most grips in the library sit at 48 to 50: a seatbelt, a
      // cross-face, a hand on a far hip. All of them were permanently half
      // released, and a half-released grip is a hand hanging in the air near
      // the thing it is supposed to be holding. Measured across the pose
      // library it was ten to forty-two centimetres of air.
      //
      // So: hold anything the arm can reach, and let go over the few
      // centimetres past it. Beyond that the analytic solver has no choice but
      // to point the arm straight at the target, and a straight arm aimed at
      // somebody's collar from a metre away is the single most broken-looking
      // thing a rig can do — which is what the fade is for, and it still does
      // it, just at the distance where it is true.
      const fit = 1 - smooth(clamp((d - reach * 0.97) / (reach * 0.11), 0, 1));
      const w = g.pass * fit;
      if (w < 0.02) continue;

      // Hold it only as hard as the elbow allows.
      //
      // The analytic solver places the elbow correctly for the *position* of
      // the hand and has nothing to say about the joint it leaves behind. At
      // full weight, and at partial weight most of all — where the upper arm is
      // only part of the way to its solution while the forearm is aimed all the
      // way at the target — it folds elbows past what an elbow does and, nine
      // hundred times a library, folds them the other way entirely. Measured
      // with joint-check: 3672 samples bending backwards with the grips on
      // against 288 with them off, so this is where nearly all of it came from.
      //
      // The answer is the one the reach fade already takes: a hand exactly on
      // the lapel is not worth an arm that cannot exist. Back the weight off
      // until the elbow is an elbow again, and let the hand fall short — which
      // is at worst where the pose put it, and the pose is right about arms.
      const fore = L ? 'foreL' : 'foreR';
      const hand = L ? 'handL' : 'handR';
      qCopy(_keepU, sk.local[BONE_INDEX[upper]]);
      qCopy(_keepL, sk.local[BONE_INDEX[fore]]);
      let used = w;
      for (const scale of [1, 0.55, 0.3, 0.15, 0]) {
        used = w * scale;
        if (scale < 1) {
          qCopy(sk.local[BONE_INDEX[upper]], _keepU);
          qCopy(sk.local[BONE_INDEX[fore]], _keepL);
          sk.poseFrom(BONE_INDEX[upper]);
        }
        if (used < 0.02) break;
        solveTwoBone(sk, upper, fore, hand, _t2, null, used);
        if (elbowIsAnElbow(sk, upper, fore, hand)) break;
      }
      if (used < 0.02) continue;
      const w2 = used;

      // Remember how closed this hand should be. Applied after the passes, not
      // inside them: a pose() in the middle of a pass changes the targets the
      // rest of the pass is solving against, and the whole point of three
      // passes is that they converge on one another.
      const key = g.role + (L ? 'L' : 'R');
      this.curl[key] = Math.max(this.curl[key] || 0, w2);
    }
  }
}

// Is this still a hinge?
//
// The fold, signed about the upper bone's own X — which is the axis every joint
// in this rig turns about, and the axis the poses are authored in. Flexion is
// negative there for an elbow, so a positive reading is an arm bending the
// wrong way and anything past about 150 is one folded through itself.
//
// Deliberately generous: the job is to stop a limb that is obviously broken,
// not to model a joint. joint-check holds the whole library to the same numbers
// and reports what is left.
const _eu = v3(), _ef = v3(), _ec = v3();
function elbowIsAnElbow(sk, upper, mid, low) {
  sk.boneHead(_eu, upper);
  sk.boneHead(_ef, mid);
  sk.boneHead(_ec, low);
  const ux = _ef[0] - _eu[0], uy = _ef[1] - _eu[1], uz = _ef[2] - _eu[2];
  const fx = _ec[0] - _ef[0], fy = _ec[1] - _ef[1], fz = _ec[2] - _ef[2];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const fl = Math.hypot(fx, fy, fz) || 1;
  const u = [ux / ul, uy / ul, uz / ul];
  const f = [fx / fl, fy / fl, fz / fl];
  const m = sk.world[BONE_INDEX[upper]];
  const al = Math.hypot(m[0], m[1], m[2]) || 1;
  const ax = [m[0] / al, m[1] / al, m[2] / al];
  const cx = u[1] * f[2] - u[2] * f[1];
  const cy = u[2] * f[0] - u[0] * f[2];
  const cz = u[0] * f[1] - u[1] * f[0];
  const along = cx * ax[0] + cy * ax[1] + cz * ax[2];
  const flex = Math.atan2(along, u[0] * f[0] + u[1] * f[1] + u[2] * f[2]) * (180 / Math.PI);
  return flex <= 6 && flex >= -152;
}

function collect(out, grips, w) {
  if (!grips || w <= 0) return;
  for (const g of grips) {
    const found = out.find((o) => o.role === g.role && o.hand === g.hand);
    if (found) {
      // The same hand on the same point in both poses is not a crossfade. It is
      // one grip that never let go, and its weight is the sum rather than the
      // greater of the two.
      //
      // Taking the greater fades it to a half at the midpoint of every blend,
      // and a half-weight grip does not hold: the hand drifts off the lapel
      // exactly halfway through the pass, which is where the pass is most
      // tangled and least forgiving. It cost a held position a twenty-eight
      // centimetre swing of the arm before anything measured a held position.
      if (found.point === g.point && !found.self === !g.self) {
        found.w = Math.min(1, found.w + w);
        continue;
      }
      // Two different targets for one hand: the incoming one wins outright once
      // it is more than half faded in. Blending two targets would put the hand
      // somewhere neither pose ever asked for, which looks like a bug.
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
