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
  HAND_REST, HAND_GRIP, TIP_REST, TIP_GRIP,
} from '../render/skeleton.js';
import { quat, qEuler, qMul, qSlerp, v3, v3set, v3lerp, m4point, smooth, clamp } from '../core/m4.js';

const _t = v3();
const _t2 = v3();
const _t3 = v3();
const _t4 = v3();
const _t5 = v3();
const _t6 = v3();
// Shoulder to wrist on the rest skeleton: 0.275 + 0.245.
// Where the skin is, relative to the bone that carries it. Measured on the
// baked fighter in its rest pose: the sole sits 8.3 cm below the ankle bone and
// the front of the knee sticks 10 cm out from the knee joint.
//
// `_ground` used to stand the *bones* on the mat: it plants an ankle 4.2 cm
// above it, which puts the sole four centimetres inside. Measured with
// tools/weight-check.mjs, which skins the real mesh — the mat is drawn at
// y = 0.05 and it is the skin that has to sit on it.
//
const SOLE = 0.083;
// How close the ankle may come to the hip before the knee has to fold past what
// a knee folds. Thigh 42.5 cm, shin 41 cm, and joint-check's limit is 155
// degrees, which puts the ankle 18.1 cm from the hip; a centimetre of margin on
// top of that.
const LEG_MIN = 0.19;
// How fast the foot clamp may change its mind, in seconds. See _ground.
// Measured with shake-check over twelve matches: 16.3 teleports a minute with
// the clamp applied outright, 12.2 at 0.08 s, 11.7 at 0.12, 13.1 at 0.20 —
// long enough that the correction is not a jump, short enough that a foot is
// not left through the floor long enough to see.
const PLANT_EASE = 0.12;
const ARM_REACH = 0.52;
// A hand closes on something, and lets go of it, over about a fifth of a
// second. See the top of _grips for what the number is holding back.
const GRIP_EASE = 0.20;
// And a goal may not run away from the hand faster than a hand travels.
// Whatever it does beyond that is carried as slack and bled off over
// SLACK_BLEED seconds, so the hand catches up by moving rather than by cutting.
const GOAL_SPEED = 3.2;
const SLACK_BLEED = 0.18;
// And the corners of that ease are rounded over this, so a hand does not go
// from still to two metres a second in one frame. See _easeHand.
const GRIP_ROUND = 0.09;
// And what the sim asks of a body arrives over a quarter of a second rather
// than in one frame. `working` in main.js flips the instant an attempt starts,
// so effort stepped from a third to its ceiling between two frames — and
// everything effort scales stepped with it: the breath, the tremor, the reach
// of a hold loop. Every arm displaced at once, twice per attempt, sixty times
// a match.
const DRIVE_EASE = 0.25;
const _q = quat();
const _rq = quat();
const _b1 = quat();
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
    // A hand thrown at the other man's collar: 1 the moment it goes, 0 when it
    // is back. Measurement leaves it at zero, so nothing that judges a pose or
    // a path ever sees it.
    this.fight = { A: 0, B: 0 };
    // The same four, as the body has them: what the sim asks for arrives here
    // over DRIVE_EASE rather than in one frame. `fight` is not eased — it is a
    // spike by design, and the reach it drives is already zero at its peak.
    this.drive = { A: { effort: 0, slack: 0, gas: 0 }, B: { effort: 0, slack: 0, gas: 0 } };
    // Where each man is in his own breath. It has to be integrated rather than
    // read off the clock — see _life.
    this.breath = { A: 0, B: 0 };
    // What each hand is doing as the picture has it, rather than as the pose
    // asks: the eased weight, the last thing it was told to hold, and the slack
    // it is carrying while it catches up with a goal that jumped. See _grips.
    this.hands = {};
    // Whether a foot through the mat is put back on it. Off only while
    // seat-solve is deciding where a pose sits — see _ground.
    this.plantFeet = true;
    // How much lift each foot is currently being given by the clamp in
    // _ground. It is eased rather than applied outright, so the correction
    // cannot move a leg faster than a leg moves.
    this._plant = { A: { footL: 0, footR: 0 }, B: { footL: 0, footR: 0 } };
    // Whether this rig is being watched or measured.
    //
    // The easing below is a function of elapsed time, and a solver does not
    // advance time: arc-solve samples a path at whatever t it likes, in
    // whatever order, and blend-check and pose-check take single frames. Carry
    // state across those and the measurement depends on what was measured
    // before it, which would make every number in the battery a function of
    // its own call order. So the rig snaps by default and eases only for
    // something that is actually playing — main.js, and the tools that play
    // real matches.
    this.live = false;
  }

  invalidate(id) { invalidatePose(id); }

  // Back to the top of the clock. Tools set the rig's clock to zero before a
  // sample so that what they measure is the pose and not the moment; the breath
  // keeps its own phase now (see _life), so it has to be rewound with it —
  // otherwise the thirty-eighth pose in a sweep is measured with two thirds of
  // a radian of breath on it that the first one did not have, which is exactly
  // how turtle came to report eight centimetres of arm inside an arm.
  rewind() {
    this.time = 0;
    this.breath.A = 0;
    this.breath.B = 0;
  }

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
    const eff = Math.max(this.drive.A.effort, this.drive.B.effort);
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
    const eff = Math.max(this.drive.A.effort, this.drive.B.effort);
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
    this._settle(dt);
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
      this._ground(sk, role, dt);
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
  _ground(sk, role, dt) {
    const FLOOR = 0.05;
    // The lift is gone, and this is the note it left.
    //
    // It used to raise a man until his *knees* were on the mat, as a stand-in
    // for tuning every pose's height by hand. Two things were wrong with it.
    // It grounded bones rather than skin, so a knee it called "on the mat" was
    // four centimetres inside it; and lifting by the knees is only right for a
    // man who is kneeling — for a man on his back it hoists him off the floor
    // by his shins. Worse, it fought the pose: seat-solve pushes a pair down to
    // the mat and this pushed it back up, and the two never agreed.
    //
    // Where a pose sits is now the pose's own business — tools/seat-solve.mjs
    // puts every one of them on the mat and tools/weight-check.mjs holds them
    // there. A blend between two seated poses stays seated, which is what the
    // lift was really for.
    // And a foot that is through the mat is put back on it. A safety net for a
    // blend, not a mechanism: it clamps the ankle to a fixed height, so while a
    // pose is being seated it has to be off, or the seat pushes the pair down
    // and this holds the foot where it was and the two never agree. Four poses
    // sat in exactly that limit cycle before seat-solve learned to switch it.
    //
    // And it has a speed now, which it did not, and that cost a round's worth
    // of shake. Once the poses were seated properly the ankles came to rest
    // *on* the line this tests against, and a correction recomputed from
    // scratch every frame against a line the foot is sitting on is a correction
    // that jumps. Measured with shake-check over twelve matches: 16.3 teleports
    // a minute over 1500 m/s² against a line of 15, and the worst joint in the
    // whole game was the shin this was solving; with the clamp switched off
    // entirely, 2.4.
    //
    // Three guesses about the shape of it were wrong, and each is worth a line
    // so nobody spends the afternoon again. Ramping the strength in over the
    // last three centimetres changed the number by nothing at all. Stopping the
    // IK from choosing the other side for the knee: nothing. Dropping the
    // minimum leg length: nothing. And at *half* weight there were more
    // teleports than at full — 27.9 against 16.3 — which is the signature of a
    // correction that jumps rather than of one that is too strong.
    //
    // So it is not the shape, it is the speed: the lift now eases towards what
    // the foot wants over PLANT_EASE rather than being applied outright, and
    // the leg cannot be moved faster than a leg moves. 16.3 → 11.7. Snap rather
    // than ease when the rig is not live, so every measurer still sees the pose
    // and not the frame it happens to be on.
    if (!this.plantFeet) return;
    const held = this._plant[role];
    for (const [th, sh, ft] of [['thighL', 'shinL', 'footL'], ['thighR', 'shinR', 'footR']]) {
      sk.boneHead(_t, ft);
      // How much of a lift the foot wants, and how much of it it gets this
      // frame. The want is a hard test against a fixed height and it changes as
      // fast as the pose does; a leg does not. Eased, the correction cannot
      // move faster than PLANT_EASE lets it, and the shin stops being the
      // fastest thing on the mat.
      const want = Math.max(0, FLOOR + SOLE - 0.008 - _t[1]);
      const k = this.live && dt > 0 ? Math.min(1, dt / PLANT_EASE) : 1;
      held[ft] += (want - held[ft]) * k;
      if (held[ft] <= 0.001) continue;
      _t[1] += held[ft];
      // A leg cannot be shorter than a folded leg.
      //
      // The target is a height, and pulling a foot up to it shortens the
      // distance from the hip — past a point the only way to close that
      // distance is to fold the knee past what a knee folds. The thigh is
      // 42.5 cm and the shin 41, so at joint-check's 155-degree limit the hip
      // is 18.1 cm from the ankle: any closer and the solver is inventing a
      // joint. Measured after the poses were seated, this fired on
      // SIDE_CONTROL>MOUNT and bent a knee to 173 degrees for 105 samples.
      sk.boneHead(_t3, th);
      const dx = _t[0] - _t3[0], dy = _t[1] - _t3[1], dz = _t[2] - _t3[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < LEG_MIN && d > 1e-4) {
        const k = LEG_MIN / d;
        _t[0] = _t3[0] + dx * k;
        _t[1] = _t3[1] + dy * k;
        _t[2] = _t3[2] + dz * k;
      }
      solveTwoBone(sk, th, sh, ft, _t, null, 1);
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

  // How much of a grip is on, easing towards what the pose asks.
  //
  // Two stages, and the second one is not decoration. A rate limit alone gets
  // the release down to a fifth of a second but leaves a corner at each end of
  // the ramp — the hand goes from still to two metres a second in one frame,
  // which is the jerk this whole exercise is about, just smaller. The second
  // pass is a light low-pass that rounds those corners off; measured, it is
  // worth more than the rate limit itself at the top end of the distribution.
  _easeHand(st, want, dt) {
    if (st.raw === undefined) st.raw = st.w;
    const step = dt / GRIP_EASE;
    st.raw += clamp(want - st.raw, -step, step);
    st.w += (st.raw - st.w) * (1 - Math.exp(-dt / GRIP_ROUND));
  }

  // What the sim asks for, arriving at the body over a moment. Snapped when the
  // rig is not live, so a solver sees exactly what it set.
  _settle(dt) {
    const k = this.live && dt > 0 ? Math.min(1, dt / DRIVE_EASE) : 1;
    for (const role of ['A', 'B']) {
      const d = this.drive[role];
      d.effort += (this.effort[role] - d.effort) * k;
      d.slack += (this.slack[role] - d.slack) * k;
      d.gas += (this.gas[role] - d.gas) * k;
    }
  }

  _life(role, sk, from, to, e) {
    const T = this.time;
    this._inertia(role, sk, e === undefined ? 0 : this._dt);
    const eff = this.drive[role].effort;
    const slack = this.drive[role].slack;
    const gas = this.drive[role].gas;
    const ground = POSES[to].ground;

    // Breath: faster and deeper the harder they are working — and it does not
    // come back down when they stop. A man three minutes in is still heaving
    // between exchanges, and that is the whole difference between a fighter
    // who is tired and a bar that says he is.
    // A breath advances its own phase.
    //
    // This was `Math.sin(T * rate)` with the rate a function of effort and
    // fatigue — and both of those change every single frame, because stamina
    // drains continuously. So the *phase* jumped every frame rather than the
    // speed changing: three minutes in, T is around 180, and a thousandth of a
    // change in rate moves the argument of the sine by a fifth of a radian.
    // The chest, the spine and the neck all hang off this, and both arms hang
    // off the chest.
    //
    // Measured with tools/shake-check.mjs, it was the largest single source of
    // shake in the game by an order of magnitude: switching the breath off
    // dropped the ninetieth percentile of joint acceleration from 105 m/s² to
    // 14, while switching the whole effort tremor off changed it by nothing at
    // all. A player saw it as "дрожат неестественно", which is exactly what a
    // torso whose breathing phase is re-randomised sixty times a second is.
    const rate = 1.1 + eff * 2.6 + gas * 2.0;
    this.breath[role] += rate * (this._dt || 0);
    const breath = Math.sin(this.breath[role]) * (0.55 + eff * 1.6 + gas * 2.4);
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

    // Strain, and a shiver on top of it.
    //
    // This was one thing and it was in the worst possible band. Two sines at
    // 17 and 27 rad/s — 2.7 and 4.4 Hz — at 1.6 degrees on the shoulder, which
    // is three and a half centimetres of wrist. Fast enough that the eye reads
    // vibration rather than movement, slow enough that no frame hides it, and
    // wide enough to see across the mat: a player called it "дрожат и дёргаются
    // неестественно", and measured with shake-check it was the largest single
    // source of shake in the game — switching effort off dropped the hard
    // accelerations from 11.8% of joint-frames to 5.5%.
    //
    // A man straining is two things, so this is two things. The strain is slow
    // and wide: about a second a cycle, a centimetre at the wrist, and it reads
    // as somebody pushing. The shiver is fast and small: six hertz, three
    // millimetres, which is what a loaded limb actually does and what gives the
    // close camera something to see. Neither is in the band between.
    if (eff > 0.01) {
      const strain = (f, a) => (Math.sin(T * f) + Math.sin(T * f * 1.61 + 1.3)) * a * eff;
      const shiver = (f, a) => Math.sin(T * f + 0.7) * a * eff;
      addEuler(sk, 'armL', strain(5.5, 1.1) + shiver(38, 0.32), 0, strain(4.3, 0.8));
      addEuler(sk, 'armR', strain(5.3, -1.1) + shiver(36.6, -0.32), 0, strain(4.1, -0.8));
      addEuler(sk, 'hips', strain(3.7, 0.6), strain(3.1, 0.9), 0);
      if (ground) {
        addEuler(sk, 'thighL', strain(4.6, 0.9), 0, 0);
        addEuler(sk, 'thighR', strain(4.9, -0.9), 0, 0);
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

    // Where the pose put each elbow, remembered before anything moves.
    //
    // The solver decides which side the elbow goes on from a pole vector, and
    // with none supplied it uses the arm's *current* direction — which is the
    // authored one on the first pass and, by the second, a direction that has
    // already been swung most of the way towards the target. Once the pole and
    // the goal are nearly parallel the plane they define is noise, and the
    // elbow lands on whichever side the noise pointed: measured across the
    // library, the back's right elbow was authored at -82 degrees and came out
    // of three passes at +155.
    //
    // Snapshotting it here makes all three passes solve the same shape of arm.
    // It is the sentence the solver's own comment already claims — the pose
    // decides how the arm is bent, IK decides where the hand ends up — made
    // true for passes two and three as well as one.
    for (const g of list) {
      const sk = this.skel[g.role];
      const L = g.hand === 'L';
      sk.boneHead(_t3, L ? 'armL' : 'armR');
      sk.boneHead(_t2, L ? 'foreL' : 'foreR');
      g.pole = [_t2[0] - _t3[0], _t2[1] - _t3[1], _t2[2] - _t3[2]];
    }
    // The grip fight itself.
    //
    // Whichever hand is holding least is the one that goes: a man with a
    // collar and a sleeve does not let go of either to slap at another grip,
    // and a man holding nothing throws whatever is free. It reaches across to
    // the near lapel and comes back inside half a second, over the top of
    // whatever the pose had that hand doing — so a hand with a real grip is
    // pulled off it briefly and returns, which is what losing and re-taking a
    // grip looks like from outside.
    for (const role of ['A', 'B']) {
      const f = this.fight[role];
      if (f <= 0.02) continue;
      const held = (h) => {
        const g = list.find((o) => o.role === role && o.hand === h);
        return g ? g.w : 0;
      };
      const hand = held('L') <= held('R') ? 'L' : 'R';
      const w = Math.sin(Math.PI * (1 - f)) * 0.85;
      if (w < 0.02) continue;
      const found = list.find((o) => o.role === role && o.hand === hand);
      const reach = {
        role, hand, self: false, w,
        point: hand === 'L' ? 'lapelR' : 'lapelL',
        pole: found ? found.pole : null,
      };
      if (found && found.w > w) continue;   // his real grip is worth more
      if (found) list.splice(list.indexOf(found), 1);
      list.push(reach);
    }

    // Nothing a hand does may happen between two frames.
    //
    // A grip's weight is how far the hand is pulled off the pose towards what
    // it is holding, so *changing* that weight moves the hand, and changing it
    // in one frame teleports it. Two things used to change it in one frame.
    // `fit` releases a grip over the last five centimetres of the arm's reach
    // — a window in distance — and during a transition the distance to a point
    // on the other man changes by two to five centimetres a frame, so the
    // release could complete inside one; and a grip under two per cent weight
    // was skipped outright.
    //
    // Measured with tools/shake-check.mjs, which walks a transition at sixty
    // frames a second and watches every joint: **every transition in the game
    // had a single-frame jump of thirty to sixty-seven centimetres in it, and
    // all of them were hands.** On HALF_GUARD>BACK a hand sat fifty-one
    // centimetres off the pose, held there by a grip on a sleeve it could not
    // reach, and arrived back at the pose in one frame when the grip let go.
    //
    // So the weight eases, the goal is rate-limited, and a hand whose grip has
    // gone on holding onto its last target while it opens. The three of them
    // are one rule: a hand travels.
    const dt = this._dt || 0;
    const snap = !this.live || dt <= 0;
    const live = new Set();
    for (const g of list) {
      const key = g.role + g.hand;
      live.add(key);
      const st = this.hands[key] || (this.hands[key] = { w: 0, o: v3(0, 0, 0), p: v3(0, 0, 0), had: false });
      g.st = st;
      // Where it is being asked to reach, before anything is smoothed.
      const ok = this._goal(_t4, g, false);
      // How much of it the arm can honour, as the last pass of the last frame
      // measured it.
      //
      // Not measured here: the three passes exist because the targets move as
      // each other's bodies are solved, and a distance taken before any of them
      // have run is the wrong distance. Taken here it read 52 cm on a target
      // that ends the frame at 48, faded the grip to three quarters, and left
      // two hands in open guard fourteen centimetres off sleeves they were
      // holding — pose-check said so on the first run.
      // Snapped, the fade is the solver's own business and this must not read
      // a value left behind by whatever was measured before: pose-check walks
      // thirty-eight poses on one rig, and a fit remembered from the last one
      // put two hands in turtle twelve centimetres off knees they were holding.
      const want = snap ? g.w : g.w * (st.fit === undefined ? 1 : st.fit);
      if (snap) {
        st.w = st.raw = want;
        v3set(st.o, 0, 0, 0);
      } else {
        this._easeHand(st, want, dt);
        // The goal itself: anything it moves beyond a hand's speed becomes
        // slack the hand carries and bleeds off.
        if (st.had && ok) {
          const dx = _t4[0] - st.p[0], dy = _t4[1] - st.p[1], dz = _t4[2] - st.p[2];
          const len = Math.hypot(dx, dy, dz);
          const cap = GOAL_SPEED * dt;
          if (len > cap && len > 1e-6) {
            const k = 1 - cap / len;
            st.o[0] += dx * k; st.o[1] += dy * k; st.o[2] += dz * k;
          }
        }
        const bleed = Math.exp(-dt / SLACK_BLEED);
        st.o[0] *= bleed; st.o[1] *= bleed; st.o[2] *= bleed;
      }
      if (ok) { v3set(st.p, _t4[0], _t4[1], _t4[2]); st.had = true; }
      st.point = g.point; st.self = !!g.self; st.role = g.role; st.hand = g.hand;
      st.pole = g.pole;
      g.eff = st.w;
    }
    // Hands whose grip has gone: they open over the same fifth of a second,
    // still holding what they were holding. Without this the release is the
    // jump — the whole distance the grip was pulling, in one frame.
    if (!snap) {
      for (const key in this.hands) {
        if (live.has(key)) continue;
        const st = this.hands[key];
        if (st.w <= 0.02 || !st.point) { st.w = 0; continue; }
        this._easeHand(st, 0, dt);
        const bleed = Math.exp(-dt / SLACK_BLEED);
        st.o[0] *= bleed; st.o[1] *= bleed; st.o[2] *= bleed;
        list.push({ role: st.role, hand: st.hand, point: st.point, self: st.self,
                    w: st.w, eff: st.w, pole: st.pole, st, ghost: true });
      }
    }
    for (const g of list) g.pass = 1 - Math.pow(1 - clamp(g.eff, 0, 1), 1 / PASSES);

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
    // At the knuckles and again at the second joint, which is how a finger
    // closes. It used to be one rotation of the fingertip bone by sixteen
    // degrees, and the number was small for a reason that has gone away: the
    // hand was a single capsule from the palm to the fingertip, so bending it
    // swept a wide arc through whatever the hand was near, and at thirty-four
    // degrees it put eight poses over the line. The hand has a knuckle row now
    // and two capsules that follow it, so the bend is where the joint is.
    for (const role of ['A', 'B']) {
      const sk = this.skel[role];
      let any = false;
      for (const L of [true, false]) {
        // Always, not only when something is being held: a hand with no grip
        // on it still belongs to a person, and the rest angle is what stops it
        // being a plank. See HAND_REST in skeleton.js.
        const w = this.curl[role + (L ? 'L' : 'R')] || 0;
        addEuler(sk, L ? 'fingL' : 'fingR', -(HAND_REST + w * (HAND_GRIP - HAND_REST)), 0, 0);
        addEuler(sk, L ? 'handLTip' : 'handRTip', -(TIP_REST + w * (TIP_GRIP - TIP_REST)), 0, 0);
        any = true;
      }
      if (any) sk.pose();
    }
  }

  // Where one hand is being asked to reach, in the world, this frame.
  //
  // Two targets crossfade in space: a hand letting go of a lapel and taking a
  // neck travels between them rather than changing which one it is on. `slack`
  // adds whatever the hand has not caught up with yet — see _grips.
  _goal(out, g, slack = true) {
    const def = GRIP_POINTS[g.point];
    if (!def) return false;
    const other = this.skel[g.self ? g.role : g.role === 'A' ? 'B' : 'A'];
    m4point(out, other.world[BONE_INDEX[def[0]]], def[1]);
    if (g.alt) {
      const alt = GRIP_POINTS[g.alt.point];
      if (alt) {
        const oth = this.skel[g.alt.self ? g.role : g.role === 'A' ? 'B' : 'A'];
        m4point(_t5, oth.world[BONE_INDEX[alt[0]]], alt[1]);
        const k = g.alt.w / Math.max(1e-6, (g.baseW || 0) + g.alt.w);
        // Around the shoulder, not straight through it.
        //
        // A straight line between two holds is the wrong path for a hand,
        // because the two ends are both about an arm's length away and the
        // middle of the line is not: on BACK>RNC, the lapel and the neck are
        // half a metre out each and the point between them passes close enough
        // to the shoulder to fold the elbow to 173 degrees. joint-check caught
        // it the first time this ran. So the direction turns and the reach
        // changes, which is what an arm does.
        this.skel[g.role].boneHead(_t6, g.hand === 'L' ? 'armL' : 'armR');
        const ax = out[0] - _t6[0], ay = out[1] - _t6[1], az = out[2] - _t6[2];
        const bx = _t5[0] - _t6[0], by = _t5[1] - _t6[1], bz = _t5[2] - _t6[2];
        const la = Math.hypot(ax, ay, az) || 1e-6;
        const lb = Math.hypot(bx, by, bz) || 1e-6;
        let dx = ax / la + (bx / lb - ax / la) * k;
        let dy = ay / la + (by / lb - ay / la) * k;
        let dz = az / la + (bz / lb - az / la) * k;
        const dl = Math.hypot(dx, dy, dz) || 1e-6;
        const r = la + (lb - la) * k;
        out[0] = _t6[0] + (dx / dl) * r;
        out[1] = _t6[1] + (dy / dl) * r;
        out[2] = _t6[2] + (dz / dl) * r;
      }
    }
    if (slack && g.st) { out[0] += g.st.o[0]; out[1] += g.st.o[1]; out[2] += g.st.o[2]; }
    return true;
  }

  _solveGrips(list) {
    for (const g of list) {
      if (g.eff < 0.02) continue;
      if (!this._goal(_t2, g)) continue;
      const sk = this.skel[g.role];
      const L = g.hand === 'L';
      const upper = L ? 'armL' : 'armR';

      // How much of the grip the arm can honour, from where everything is now.
      //
      // Out of reach, the analytic solver has no choice but to point the arm
      // straight at the target, and a straight arm aimed at a collar a metre
      // away is the single most broken-looking thing a rig can do — so a grip
      // past the arm's length lets go over the few centimetres beyond it.
      //
      // And the same at the other end, which is new: a hand cannot hold
      // something inside its own shoulder. Below about twelve centimetres the
      // two bones of an arm have to fold past what an elbow folds — 155 degrees
      // is joint-check's limit and the geometry reaches it at 0.116 m. On
      // BACK>RNC the sleeve B is holding passes within five centimetres of B's
      // own shoulder halfway through the blend, and the elbow came out at 173.
      sk.boneHead(_t3, upper);
      const d = Math.hypot(_t2[0] - _t3[0], _t2[1] - _t3[1], _t2[2] - _t3[2]);
      let fit = 1 - smooth(clamp((d - ARM_REACH * 0.97) / (ARM_REACH * 0.11), 0, 1));
      // Remembered for the ease, which needs it a frame before it can be
      // measured. See _grips.
      if (g.st) g.st.fit = fit;
      const wPass = g.pass * fit;
      if (wPass < 0.02) continue;
      solveTwoBone(
        sk,
        upper,
        L ? 'foreL' : 'foreR',
        L ? 'handL' : 'handR',
        _t2, g.pole || null, wPass
      );
      // Remember how closed this hand should be. Applied after the passes, not
      // inside them: a pose() in the middle of a pass changes the targets the
      // rest of the pass is solving against, and the whole point of three
      // passes is that they converge on one another.
      const key = g.role + (L ? 'L' : 'R');
      this.curl[key] = Math.max(this.curl[key] || 0, wPass);
    }
  }
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
      // Two different targets for one hand: the hand travels from the one to
      // the other over the blend.
      //
      // The incoming target used to win outright the moment it was more than
      // half faded in, on the argument that blending two targets puts the hand
      // somewhere neither pose ever asked for. What it actually did was
      // teleport: measured on BACK>RNC, at the midpoint of the blend the goal
      // changed from the lapel to the neck and the hand moved **fifty-seven
      // centimetres in one frame**. Every transition in the game had a jump
      // like it, and a player reported the fight as "дёргаются".
      //
      // A hand that slides from a lapel to a neck over half a second is not
      // somewhere neither pose asked for. It is a hand letting go of one thing
      // and taking another, which is what the transition is.
      if (w > found.w) { found.point = g.point; found.self = g.self; found.w = Math.max(found.w, w); }
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
