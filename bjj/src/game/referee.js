// The third man on the mat.
//
// Everything in this game happens between two people, and the two of them are
// one object: the paired poses, the rig, the collision judge and the camera all
// assume exactly two skeletons that belong to each other. A referee belongs to
// nobody. He stands off to one side, watches, crouches when the fight goes to
// the ground, calls it on and calls it off — and none of that is a paired pose,
// because there is no pair.
//
// So he is his own small thing: one skeleton, four authored poses, and a state
// machine that reads the match the way the HUD does. He is also the reason
// main.js no longer says "two" anywhere — the renderer always took a list.
//
// The poses are in the same form as the halves of a paired pose (`root` and a
// dictionary of joint angles in degrees off the rest pose), so they are read by
// the same poseToQuats and blended by the same blendQuats. Nothing here is new
// machinery; it is the existing machinery with one body in it.
//
// The root heights are not guesses either: pose-check stands him up and
// measures where his feet land, and both of the first two numbers were wrong —
// four centimetres through the mat standing, thirteen above it crouching.

import {
  Skeleton, poseToQuats, blendQuats, solveTwoBone, BONE_COUNT, BONE_INDEX,
  HAND_REST, TIP_REST,
} from '../render/skeleton.js';
import { quat, qEuler, v3, v3set } from '../core/m4.js';

// Where he stands: this far from the middle of the fight, and this far round
// from the camera's own bearing. Round from the camera and not from the pair,
// because the pair spins and the camera cuts, and the one thing he must never
// be is between the two of them and the lens. A hundred and fifty degrees puts
// him beyond the fight and off to one side of it, which is where a referee
// stands and also where he is out of the way.
const DIST = 2.35;
const AROUND = (150 * Math.PI) / 180;
// How fast he walks to keep that distance, in metres a second. He is not
// running; the pair drifts about a metre a second at most.
const STEP = 1.3;
// How close he ever gets to the middle of the fight, walking or standing.
//
// The same circle he stands on, so the walk is an arc along it rather than a
// chord across it, and the two numbers cannot drift apart. At 1.55 — the pair's
// own width plus a little — he still clipped somebody by fifteen centimetres,
// because in side control a leg reaches most of the way there on its own; the
// distance he stands at is what he has to keep while moving too.
const KEEP_OUT = DIST;

// He holds nothing for the whole match and still has hands. Spread into every
// pose below rather than typed into each: the fighters get the same angles from
// the rig, and a referee whose fingers disagree with theirs is a third man with
// somebody else's hands. See HAND_REST in skeleton.js.
const HANDS = {
  fingL: [-HAND_REST, 0, 0], handLTip: [-TIP_REST, 0, 0],
  fingR: [-HAND_REST, 0, 0], handRTip: [-TIP_REST, 0, 0],
};

const P = {
  // At ease, weight even, hands loose in front. This is most of his match.
  stand: {
    root: { p: [0, 0.925, 0], r: [0, 0, 0] },
    j: {
      ...HANDS,
      hips: [-3, 0, 0], spine: [4, 0, 0], chest: [3, 0, 0], neck: [-6, 0, 0], head: [4, 0, 0],
      clavL: [0, 0, 6], armL: [-16, 8, -10], foreL: [-46, 0, 0], handL: [-8, 0, 0],
      clavR: [0, 0, -6], armR: [-16, -8, 10], foreR: [-46, 0, 0], handR: [-8, 0, 0],
      thighL: [-4, 6, 4], shinL: [8, 0, 0], footL: [-4, 0, 0],
      thighR: [-4, -6, -4], shinR: [8, 0, 0], footR: [-4, 0, 0],
    },
  },
  // Down on the balls of his feet where he can see a hand tap. This is what a
  // referee does the moment the fight hits the floor, and it is the pose that
  // makes him read as watching rather than standing about.
  crouch: {
    root: { p: [0, 0.545, 0], r: [0, 0, 0] },
    j: {
      ...HANDS,
      hips: [-24, 0, 0], spine: [22, 0, 0], chest: [12, 0, 0], neck: [-16, 0, 0], head: [10, 0, 0],
      clavL: [0, 0, 8], armL: [-38, 14, -14], foreL: [-72, 0, 0], handL: [-10, 0, 0],
      clavR: [0, 0, -8], armR: [-38, -14, 14], foreR: [-72, 0, 0], handR: [-10, 0, 0],
      thighL: [-62, 8, 10], shinL: [86, 0, 0], footL: [-18, 0, 0],
      thighR: [-62, -8, -10], shinR: [86, 0, 0], footR: [-18, 0, 0],
    },
  },
  // The call: one arm swept out over the mat. Start, and every score.
  call: {
    root: { p: [0, 0.925, 0], r: [0, 0, 0] },
    j: {
      ...HANDS,
      hips: [-3, 0, 0], spine: [4, 0, -4], chest: [3, 0, -6], neck: [-6, 0, 0], head: [2, 0, 0],
      clavL: [0, 0, 6], armL: [-14, 8, -10], foreL: [-40, 0, 0], handL: [-8, 0, 0],
      clavR: [-8, 0, -22], armR: [-96, -12, 26], foreR: [-16, 0, 0], handR: [-6, 0, 0],
      thighL: [-4, 6, 4], shinL: [8, 0, 0], footL: [-4, 0, 0],
      thighR: [-4, -6, -4], shinR: [8, 0, 0], footR: [-4, 0, 0],
    },
  },
  // Both hands up: that is enough, stop.
  stop: {
    root: { p: [0, 0.925, 0], r: [0, 0, 0] },
    j: {
      ...HANDS,
      hips: [-3, 0, 0], spine: [2, 0, 0], chest: [4, 0, 0], neck: [-10, 0, 0], head: [8, 0, 0],
      clavL: [-10, 0, 16], armL: [-128, 22, -18], foreL: [-34, 0, 0], handL: [-6, 0, 0],
      clavR: [-10, 0, -16], armR: [-128, -22, 18], foreR: [-34, 0, 0], handR: [-6, 0, 0],
      thighL: [-6, 6, 5], shinL: [10, 0, 0], footL: [-4, 0, 0],
      thighR: [-6, -6, -5], shinR: [10, 0, 0], footR: [-4, 0, 0],
    },
  },
};

const QUATS = {};
for (const k in P) QUATS[k] = poseToQuats(Array.from({ length: BONE_COUNT }, () => quat()), P[k]);

export const REFEREE_POSES = P;

export class Referee {
  constructor() {
    this.skel = new Skeleton();
    this.pose = 'stand';
    this.from = 'stand';
    this.blend = 1;
    this.t = 0;
    this.hold = 0;             // seconds left of a gesture that must finish
    this.x = 2.0;
    this.z = 0;
    this.yaw = 0;
    this.placed = false;
    this._q = Array.from({ length: BONE_COUNT }, () => quat());
    // He walks, for the same reason the fighters do: a man crossing a mat with
    // his soles glued to it is the most visible wrong thing in a frame. Same
    // planner as rig.js's, smaller: he never moves faster than a stroll.
    this.feet = [0, 1].map(() => ({ at: v3(0, 0, 0), from: v3(0, 0, 0), to: v3(0, 0, 0), t: 1, set: false }));
    this._tmp = v3(0, 0, 0);
  }

  // The same step planner as the pair rig's, with the numbers a walk needs
  // rather than a scramble: he only ever repositions, and a foot that is not
  // moving stays where it was put.
  _step(dt, vx, vz) {
    const STRIDE = 0.26, SWING = 0.28, LIFT = 0.06, LEAD = 1.4;
    const busy = this.feet.some((f) => f.t < 1);
    const names = [['thighL', 'shinL', 'footL'], ['thighR', 'shinR', 'footR']];
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const [th, sh, ft] = names[i];
      this.skel.boneHead(this._tmp, ft);
      const px = this._tmp[0], py = this._tmp[1], pz = this._tmp[2];
      if (!f.set) { v3set(f.at, px, py, pz); f.set = true; f.t = 1; continue; }
      if (f.t < 1) {
        f.t = Math.min(1, f.t + dt / SWING);
        const u = f.t, s = u * u * (3 - 2 * u);
        f.at[0] = f.from[0] + (f.to[0] - f.from[0]) * s;
        f.at[2] = f.from[2] + (f.to[2] - f.from[2]) * s;
        f.at[1] = py + Math.sin(Math.PI * u) * LIFT;
      } else {
        const drag = Math.hypot(px - f.at[0], pz - f.at[2]);
        if (drag > STRIDE && !busy) {
          v3set(f.from, f.at[0], f.at[1], f.at[2]);
          v3set(f.to, px + vx * SWING * LEAD, py, pz + vz * SWING * LEAD);
          f.t = 0;
        }
        f.at[1] = py;
      }
      solveTwoBone(this.skel, th, sh, ft, f.at, null, 1);
    }
  }

  // A gesture that outranks whatever he would be doing otherwise, for a while.
  gesture(name, seconds) {
    if (this.pose !== name) { this.from = this.pose; this.blend = 0; }
    this.pose = name;
    this.hold = seconds;
  }

  // Put him on the mat.
  //
  // The fighters have had this since the beginning — the pair frame is lifted
  // until the knees are on the tatami — and he never did: his hip height came
  // straight out of the pose and whatever the legs did below it was where the
  // feet ended up. In the crouch that is six centimetres under the mat at the
  // toe, and up to fifteen while he is going down into it, because the hip
  // height is interpolated in a straight line and the knee angle is not.
  //
  // Feet you cannot see him standing on, under a body with bent knees, is a man
  // sitting on a chair that is not there. Nothing caught it: pose-check was
  // reading the ankle, which sits a centimetre above the mat while the toe is
  // six below it, so the number looked right and the picture did not.
  //
  // Only ever lifts, and only from below, so nothing here can push him into a
  // pose he was not in.
  _ground() {
    const FLOOR = 0.05;
    let lo = Infinity;
    for (const b of ['footL', 'footR', 'toeL', 'toeR']) {
      lo = Math.min(lo, this.skel.world[BONE_INDEX[b]][13]);
    }
    const lift = FLOOR + 0.012 - lo;
    if (lift > 0.002) {
      this.skel.rootPos[1] += lift;
      this.skel.pose();
    }
  }

  update(dt, state, ground, origin, camBearing) {
    this.t += dt;
    this.hold = Math.max(0, this.hold - dt);

    // Where he wants to be: off to one side of the pair, at arm's length plus
    // a step, facing them.
    const a = camBearing + AROUND;
    const tx = origin[0] + Math.sin(a) * DIST;
    const tz = origin[2] + Math.cos(a) * DIST;
    if (!this.placed) { this.x = tx; this.z = tz; this.placed = true; }
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    // A dead zone, so he is not shuffling on the spot every frame the pair
    // breathes. Below a third of a metre he stays where he is.
    if (d > 0.32) {
      const k = Math.min(1, (STEP * dt) / d);
      this.x += dx * k;
      this.z += dz * k;
    }
    // Round them, not through them.
    //
    // He is placed off the camera's bearing, so a cut to the other side of the
    // action sends his target most of the way round the mat — faster than he
    // walks, so he lags behind it and the straight line he takes to catch up
    // goes through the fight. Measured across every position and the whole
    // circle, he was thirty-eight centimetres *inside* somebody.
    //
    // A referee keeps his distance whatever he is doing, so the walk is done on
    // a circle rather than a chord: he may step towards his target, and then he
    // is pushed back out to arm's length of the pair. It costs nothing when he
    // is already outside it, which is almost always.
    const rx = this.x - origin[0], rz = this.z - origin[2];
    const r = Math.hypot(rx, rz);
    if (r < KEEP_OUT) {
      const push = r > 1e-4 ? KEEP_OUT / r : 1;
      this.x = origin[0] + (r > 1e-4 ? rx * push : KEEP_OUT);
      this.z = origin[2] + (r > 1e-4 ? rz * push : 0);
    }
    const lastX = this.x - dx * (d > 0.32 ? Math.min(1, (STEP * dt) / d) : 0);
    const lastZ = this.z - dz * (d > 0.32 ? Math.min(1, (STEP * dt) / d) : 0);
    const want = Math.atan2(origin[0] - this.x, origin[2] - this.z);
    let turn = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.yaw += turn * Math.min(1, dt * 4);

    // What he is doing. A held gesture wins; otherwise he watches from wherever
    // he can see best.
    if (!this.hold) {
      // He stands up to walk and crouches to watch.
      //
      // He was doing both at once: the crouch is what he goes into the moment
      // the fight hits the floor, and the walk that keeps him at arm's length
      // ran underneath it, so he crossed the mat in a deep squat — sliding,
      // because a squat has nowhere to put a step. Nobody moves like that. The
      // dead zone below is what "arrived" means, and it is the same number, so
      // he settles into the crouch exactly when he stops.
      const moving = d > 0.32;
      const next = state === 'over' ? 'stop'
        : state === 'ready' ? 'stand'
        : ground && !moving ? 'crouch' : 'stand';
      if (next !== this.pose) { this.from = this.pose; this.pose = next; this.blend = 0; }
    }
    this.blend = Math.min(1, this.blend + dt * 2.6);

    blendQuats(this._q, QUATS[this.from], QUATS[this.pose], this.blend);
    for (let i = 0; i < BONE_COUNT; i++) {
      const q = this.skel.local[i], s = this._q[i];
      q[0] = s[0]; q[1] = s[1]; q[2] = s[2]; q[3] = s[3];
    }
    // Breathing, so he is not a statue: one number, on the chest, because at
    // this distance that is all anybody can see.
    const br = Math.sin(this.t * 1.6) * 0.9;
    qEuler(this.skel.local[3], br, 0, 0);

    const ph = P[this.from].root.p[1] + (P[this.pose].root.p[1] - P[this.from].root.p[1]) * this.blend;
    this.skel.rootPos[0] = this.x;
    this.skel.rootPos[1] = ph;
    this.skel.rootPos[2] = this.z;
    qEuler(this.skel.rootRot, 0, (this.yaw * 180) / Math.PI, 0);
    this.skel.pose();
    this._step(dt, (this.x - lastX) / Math.max(dt, 1e-4), (this.z - lastZ) / Math.max(dt, 1e-4));
    this._ground();
    this.skel.finishSkin();
  }
}
