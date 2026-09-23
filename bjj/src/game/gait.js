// Walking, as a cycle rather than as a correction.
//
// step.js plants a foot where the pose last put it and lets the body slide on
// until the foot has been dragged far enough to be worth picking up. That is a
// good answer for a fight, where nobody walks — a man shuffles a few
// centimetres and the pose decides everything else. It is the wrong answer for
// a walk, and the walkout was built on it: measured, the pelvis never moved (0°
// of turn, 0° of tilt, the height changing only when the ground clamp pushed
// it), the planted leg was dragged 45° behind the hip before it let go (a
// person stops at 10–15°), the knee in the swing folded 47° (60–65°), and the
// stance foot was never flat — the sole followed the shin, so the toes pointed
// 30–60° into the mat for the whole walk. On the screen that is a man skating
// on tiptoe with a mannequin's hips.
//
// So a walk here is a gait cycle, driven by distance and not by time: the
// phase advances by how far the body went over how long a stride is at this
// speed, so a man who slows takes shorter steps and a man who stops stops.
// Each foot is on the ground for 62% of its cycle and in the air for the rest,
// the two half a cycle apart, which leaves the two short stretches of double
// support a walk has and a run does not. Everything else follows the phase:
//
//   the foot       down heel first with the toes up, flat through the middle
//                  of the stance, and peeled off the mat about the ball of the
//                  foot at the end of it — the roll is what makes a step read
//                  as a step
//   the pelvis     highest over the planted foot and lowest in double
//                  support, turned towards the leg that is forward, dropped on
//                  the side that is swinging, and carried over the foot that
//                  holds it up
//   the trunk      turned against the pelvis, so the shoulders stay square
//   the arms       swung against the legs, the elbow bending more on the way
//                  forward than on the way back
//
// The numbers are the ones a gait lab reports for an adult at an ordinary walk
// and gait-check holds the result to them; they scale down with speed, so the
// first and the last step of a walk are the small ones.
//
// The legs are placed, then solved: the ankle goes where the foot's roll puts
// it and the two-bone solver bends the knee to reach it, with the knee told
// which way it points. If the pelvis is too high for a leg to reach, the
// pelvis comes down — a straight leg is the last thing to give, never the foot.

import { solveTwoBone, BONE_INDEX, quatFromMat } from '../render/skeleton.js';
import { quat, qEuler, qMul, qSlerp, v3 } from '../core/m4.js';

// The shape of a step, all as fractions of the cycle or of a stride.
export const GAIT = {
  DUTY: 0.60,        // of a foot's cycle on the ground
  STEP0: 0.26,       // step length at a standstill, m
  STEP_V: 0.26,      // and how much longer per m/s
  STEP_MAX: 0.62,
  RATE_MIN: 0.85,    // strides a second, however slow: a walk that starts takes a step
  AHEAD: 0.58,       // where the heel lands, as a share of the step ahead of the hip
  LIFT: 0.075,       // how high the ankle goes in the swing, m, at full speed
  HEEL_STRIKE: 14,   // toes up as the heel lands, degrees
  TOE_OFF: 32,       // heel up as the foot leaves, degrees
  BOB: 0.028,        // pelvis rise and fall, m, peak to peak
  SWAY: 0.018,       // pelvis over the planted foot, m
  TURN: 5,           // pelvis turn towards the forward leg, degrees either way
  LIST: 3.5,         // pelvis drop on the swinging side, degrees either way
  ARM: 17,           // shoulder swing, degrees either way
  ELBOW: 14,         // extra elbow bend at the front of the swing
  FULL: 1.1,         // the speed, m/s, at which all of the above is at full size
  HIP_W: 0.085,      // half the distance between the feet
  BACK_MAX: 0.34,    // the furthest a planted foot trails the hips before it has to go, m
};

// The foot, in the rig's own terms: where the ankle sits over a flat sole, and
// the two points it rolls about.
const ANKLE_UP = 0.067;          // toe head 1.2 cm off the mat, ankle 5.5 above it
const HEEL = [0, -ANKLE_UP, -0.05];
// Rolled onto the toes about their tip, which the rig has as a bone head: a
// pivot short of it would put the toe through the mat as the heel comes up.
const BALL = [0, -0.055, 0.15];

const LEGS = [
  { th: 'thighL', sh: 'shinL', ft: 'footL', side: 1 },
  { th: 'thighR', sh: 'shinR', ft: 'footR', side: -1 },
];

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const DEG = Math.PI / 180;

// A point in the foot's frame, turned by the foot's pitch about the lateral axis
// and by the heading about the vertical.
function footPoint(out, p, pitch, yaw) {
  const c = Math.cos(pitch * DEG), s = Math.sin(pitch * DEG);
  // Pitch: toes up is positive, so a point ahead of the ankle rises.
  const y = p[1] * c + p[2] * s;
  const z = -p[1] * s + p[2] * c;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  out[0] = p[0] * cy + z * sy;
  out[1] = y;
  out[2] = -p[0] * sy + z * cy;
  return out;
}

// Where the ankle is when the sole's reference point is at (gx, floor, gz) and
// the foot is pitched: rolled about the heel when the toes are up and about
// the ball when the heel is up, so the pivot stays on the mat.
const _piv = v3(), _rel = v3(), _flat = v3();
function anklePos(out, gx, gz, floor, pitch, yaw) {
  const pivot = pitch >= 0 ? HEEL : BALL;
  // Where the pivot is with the foot flat…
  footPoint(_piv, pivot, 0, yaw);
  // …and where the ankle is relative to it once the foot is pitched.
  footPoint(_rel, pivot, pitch, yaw);
  out[0] = gx + _piv[0] - _rel[0];
  out[1] = floor + ANKLE_UP + _piv[1] - _rel[1];
  out[2] = gz + _piv[2] - _rel[2];
  return out;
}

const _wq = quat(), _pq = quat(), _yq = quat(), _inv = quat(), _loc = quat();

export class Gait {
  constructor(cfg = GAIT) {
    this.cfg = cfg;
    // Foot 0 is about to leave: a walk starts with a step, not with both feet
    // being dragged until one of them gives.
    this.phase = cfg.DUTY - 0.02;
    this.speed = 0;
    this.last = null;
    this.feet = LEGS.map(() => ({
      g: [0, 0],      // where the sole is (or last was) on the mat
      from: [0, 0], to: [0, 0],
      air: false, u: 0, pitch: 0, lift: 0, set: false,
    }));
    this.ankle = [v3(), v3()];
    // What the walker reads to move his upper body, all zero at a standstill.
    this.out = { bob: 0, sway: 0, turn: 0, list: 0, arm: 0, elbowL: 0, elbowR: 0, amp: 0, step: 0 };
    this.landed = false;
  }

  // Where the sole of a foot is when it stands square under the hips.
  _home(out, i, x, z, yaw) {
    const side = LEGS[i].side * this.cfg.HIP_W;
    out[0] = x + Math.cos(yaw) * side;
    out[1] = z - Math.sin(yaw) * side;
    return out;
  }

  // Advance the cycle. `x, z` is where the pelvis is going this frame and
  // `yaw` which way the walker faces, in radians. Returns nothing; read
  // `out` for the pelvis and the arms, then call `legs` once the body is posed.
  step(dt, x, z, yaw) {
    const c = this.cfg;
    this.landed = false;
    if (!this.last) this.last = [x, z];
    const vx = dt > 0 ? (x - this.last[0]) / dt : 0;
    const vz = dt > 0 ? (z - this.last[1]) / dt : 0;
    this.last[0] = x; this.last[1] = z;
    const v = Math.hypot(vx, vz);
    // Smoothed a little: speed read off a frame's travel is noisy, and the
    // step length hangs off it.
    this.speed += (v - this.speed) * Math.min(1, dt * 10);
    const sp = this.speed;
    const amp = Math.min(1, sp / c.FULL);
    const stepLen = Math.min(c.STEP_MAX, c.STEP0 + c.STEP_V * sp);
    const stride = 2 * stepLen;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      if (!f.set) { this._home(f.g, i, x, z, yaw); f.set = true; }
    }
    // The cycle runs on distance. Standing still, it only finishes a step
    // that is already in the air, at the pace the step started with.
    const moving = sp > 0.04;
    const swinging = this.feet.some((f) => f.air);
    const was = this.phase;
    if (moving) this.phase += Math.max((sp * dt) / stride, c.RATE_MIN * dt * Math.min(1, sp / 0.15));
    else if (swinging) this.phase += dt / Math.max(0.5, this._lastCycle || 1.1);
    if (moving) this._lastCycle = Math.min(stride / Math.max(0.05, sp), 1 / c.RATE_MIN);
    const dirx = v > 1e-4 ? vx / v : Math.sin(yaw), dirz = v > 1e-4 ? vz / v : Math.cos(yaw);

    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const ph = (((this.phase + 0.5 * i) % 1) + 1) % 1;
      const phWas = (((was + 0.5 * i) % 1) + 1) % 1;
      const inAir = ph >= c.DUTY;
      const T = (1 - c.DUTY) * (this._lastCycle || 1.1);
      // A foot left too far behind goes now, and the cycle goes with it. The
      // first step of a walk is where this happens: the foot that did not step
      // first stood at the start line while the body left it, and the lab's
      // 10–20° of hip extension became 34.
      if (moving && !f.air && !this.feet[1 - i].air) {
        const back = -((f.g[0] - x) * dirx + (f.g[1] - z) * dirz);
        if (back > c.BACK_MAX && ph < c.DUTY) {
          this.phase += c.DUTY - ph;
          continue;
        }
      }
      if (inAir && !f.air && (moving || phWas < c.DUTY)) {
        // Off the mat: from where it stands to where it will land — ahead of
        // where the hips will be when it does, and out to its own side.
        f.air = true;
        f.from[0] = f.g[0]; f.from[1] = f.g[1];
      }
      if (f.air) {
        // On the cycle while walking — and when the cycle has already put
        // this foot back on the ground, it is on the ground. Stopped, the
        // step in the air finishes at its own pace, under the hips.
        f.u = moving ? (inAir ? (ph - c.DUTY) / (1 - c.DUTY) : 1) : Math.min(1, f.u + dt / Math.max(0.2, T));
        // The landing point, re-aimed every frame so a walker who changes
        // pace or direction mid-step still lands under himself.
        const left = (1 - f.u) * T;
        const hx = x + vx * left, hz = z + vz * left;
        this._home(f.to, i, hx, hz, yaw);
        // Faded with the pace rather than switched off with it: a step that is
        // in the air as he stops lands shorter, not somewhere else.
        const ahead = c.AHEAD * stepLen * Math.min(1, sp / 0.3);
        f.to[0] += dirx * ahead;
        f.to[1] += dirz * ahead;
        const s = smooth(f.u);
        f.g[0] = f.from[0] + (f.to[0] - f.from[0]) * s;
        f.g[1] = f.from[1] + (f.to[1] - f.from[1]) * s;
        f.lift = c.LIFT * (0.35 + 0.65 * amp) * Math.sin(Math.PI * Math.pow(f.u, 0.8));
        // Heel up at the start, square through the middle, toes up to land.
        const off = -c.TOE_OFF * amp * (1 - smooth(f.u / 0.45));
        const on = c.HEEL_STRIKE * amp * smooth((f.u - 0.55) / 0.45);
        f.pitch = off + on;
        if (f.u >= 1 || (moving && !inAir)) {
          f.air = false; f.u = 0; f.lift = 0;
          this.landed = true;
        }
      } else {
        f.lift = 0;
        // Flat for most of the stance: rolled down off the heel at the start
        // of it and up onto the ball at the end.
        const us = ph / c.DUTY;
        const heel = moving ? c.HEEL_STRIKE * amp * (1 - smooth(us / 0.14)) : 0;
        const toe = moving ? -c.TOE_OFF * amp * smooth((us - 0.6) / 0.4) : 0;
        f.pitch = heel + toe;
      }
    }

    // A walker who has stopped with his feet apart steps them back under
    // himself, one and then the other, rather than standing in a lunge.
    if (!moving && !this.feet.some((f) => f.air)) {
      let worst = -1, far = 0.07;
      const home = [0, 0];
      for (let i = 0; i < 2; i++) {
        this._home(home, i, x, z, yaw);
        const d = Math.hypot(home[0] - this.feet[i].g[0], home[1] - this.feet[i].g[1]);
        if (d > far) { far = d; worst = i; }
      }
      if (worst >= 0) {
        const f = this.feet[worst];
        f.air = true; f.u = 0;
        f.from[0] = f.g[0]; f.from[1] = f.g[1];
        this._lastCycle = this._lastCycle || 1.1;
      }
    }

    // The pelvis and the arms, off the same phase. Foot 0 lands at phase 0.
    const p = this.phase * Math.PI * 2;
    const o = this.out;
    o.amp = amp;
    o.step = stepLen;
    // Highest over a planted foot (a quarter of the way into each half), lowest
    // in double support.
    o.bob = c.BOB * amp * 0.5 * (1 - Math.cos(2 * (p - 0.06 * Math.PI * 2)));
    o.sway = c.SWAY * amp * Math.sin(p - 0.06 * Math.PI * 2);
    o.turn = c.TURN * amp * Math.cos(p);
    o.list = c.LIST * amp * Math.sin(p - 0.06 * Math.PI * 2);
    o.arm = c.ARM * amp * Math.cos(p);
    o.elbowL = c.ELBOW * amp * Math.max(0, -Math.cos(p));
    o.elbowR = c.ELBOW * amp * Math.max(0, Math.cos(p));
  }

  // Put the feet where the cycle says, once the body has been posed. `weight`
  // lets go of all of it, for handing a walker over to something else.
  legs(sk, floor, yaw, pole, weight = 1) {
    if (weight <= 0.001) return;
    // A leg cannot reach further than it is long; if the pelvis is too high
    // for either foot, the pelvis comes down, once, before anything is solved.
    let drop = 0;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], L = LEGS[i];
      anklePos(this.ankle[i], f.g[0], f.g[1], floor, f.pitch, yaw);
      this.ankle[i][1] += f.lift;
      const hip = sk.world[BONE_INDEX[L.th]];
      const reach = this._reach || (this._reach = legLength(sk));
      const dx = this.ankle[i][0] - hip[12], dy = this.ankle[i][1] - hip[13], dz = this.ankle[i][2] - hip[14];
      const horiz = Math.hypot(dx, dz), want = reach * 0.997;
      if (horiz < want) {
        const need = -Math.sqrt(want * want - horiz * horiz);   // dy the leg can manage
        if (dy < need) drop = Math.max(drop, need - dy);
      }
    }
    if (drop > 0) {
      // Never more than a knee's worth: past that the foot is simply short.
      sk.rootPos[1] -= Math.min(drop, 0.08) * weight;
      sk.pose();
    }
    const w = weight;
    for (let i = 0; i < 2; i++) {
      const L = LEGS[i];
      solveTwoBone(sk, L.th, L.sh, L.ft, this.ankle[i], pole, w, true);
      // And the foot itself turned to its roll, rather than riding the shin.
      const fi = BONE_INDEX[L.ft];
      qEuler(_yq, 0, yaw / DEG, 0);
      qEuler(_pq, -this.feet[i].pitch, 0, 0);
      qMul(_wq, _yq, _pq);
      quatFromMat(_inv, sk.world[sk.parent[fi]]);
      _inv[0] = -_inv[0]; _inv[1] = -_inv[1]; _inv[2] = -_inv[2];
      qMul(_loc, _inv, _wq);
      qSlerp(sk.local[fi], sk.local[fi], _loc, w);
      sk.poseFrom(fi);
    }
  }
}

// How high the pelvis rides over a walking man's feet: the leg nearly
// straight over the planted foot, the way a walking knee is at mid-stance
// (about 10° of bend), the hip joint below the root by the rig's own offset.
export function walkHeight(sk, floor) {
  const hip = sk.rest[BONE_INDEX.thighL];
  return floor + ANKLE_UP - hip[1] + legLength(sk) * 0.996;
}

function legLength(sk) {
  const a = sk.rest[BONE_INDEX.shinL], b = sk.rest[BONE_INDEX.footL];
  return Math.hypot(a[0], a[1], a[2]) + Math.hypot(b[0], b[1], b[2]);
}
