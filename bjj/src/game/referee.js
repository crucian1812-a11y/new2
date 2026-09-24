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
  Skeleton, poseToQuats, blendQuats, BONE_COUNT, BONE_INDEX,
  HAND_REST, TIP_REST,
} from '../render/skeleton.js';
import { groundFeet } from './step.js';
import { Gait, GAIT, setWorldRot } from './gait.js';
import { Shuffle } from './shuffle.js';
import { solveTwoBone } from '../render/skeleton.js';

// Where the tatami is, the height every judge reads it at.
const MAT_Y = 0.05;
const GAIT_BOB = GAIT.BOB;
import { v3, v3set as _v3set } from '../core/m4.js';
import { quat, qCopy, qEuler, qMul } from '../core/m4.js';

// Where he stands: this far from the middle of the fight, and this far round
// from the camera's own bearing. Round from the camera and not from the pair,
// because the pair spins and the camera cuts, and the one thing he must never
// be is between the two of them and the lens.
//
// It was a hundred and fifty degrees, "beyond the fight and off to one side of
// it" — and beyond was the half that showed. That is nearly on the lens's own
// axis, a metre and a half past the pair, and on the screen it put a quarter
// of him inside the pair's box on 57% of frames: a dark figure standing
// between the two heads. A hundred and ten is beside the fight and a little
// past it, at the edge of the picture rather than in the middle of it — 0.2%
// (tools/camera-check.mjs), and still in the frame. And on the left of it:
// the right of the screen is the ring under the player's thumb, and at plus a
// hundred and ten he stood behind the buttons.
const DIST = 2.35;
const AROUND = (-110 * Math.PI) / 180;
// How fast he is allowed to walk, in metres a second. This is a ceiling, not a
// pace: the spring below eases him up to whatever speed the situation needs
// and clamps him here, so a camera cut is a brisk stroll rather than a sprint.
const VMAX = 1.3;
// The dead zone he keeps around his target. He starts walking when the target
// is ENGAGE metres away, and only stops once it is back inside RELEASE *and*
// he has actually slowed down. Two numbers, not one, so the target drifting
// with the camera does not flip him between walking and standing every frame.
// How close he ever gets to the middle of the fight, walking or standing.
//
// The same circle he stands on, so the walk is an arc along it rather than a
// chord across it, and the two numbers cannot drift apart. At 1.55 — the pair's
// own width plus a little — he still clipped somebody by fifteen centimetres,
// because in side control a leg reaches most of the way there on its own; the
// distance he stands at is what he has to keep while moving too.
const KEEP_OUT = DIST;
// How wide the sector he may not stand in, either side of the camera's own
// bearing. Forty degrees is the lens plus a shoulder: he can be at the edge of
// the picture, he cannot be in the middle of it. See the clamp in update().
const BLOCKS = (40 * Math.PI) / 180;
// The two radii of the walking dead zone (see above).
const ENGAGE = 0.5;
const RELEASE = 0.2;
// Walking, or stepping in his stance.
//
// He faces the fight, so nearly everything he did was sideways, and he did it
// with the walk onto the mat: a forward gait run sideways lands each step
// "ahead" — the far side of the other foot. Measured (stance-check), his feet
// crossed by 19 cm when the camera cut and he went round, splayed 63 cm past
// his stance, and a foot flew at 8 m/s while he followed a fight shuffling
// under him. A referee does two different things there. Going somewhere —
// the other side of the mat after a cut — he turns and walks, and that is the
// walkout's gait, facing where he goes. Keeping his place — the fight moved
// half a metre — he steps sideways in his stance facing it, never crossing
// his feet, at no more than a stance can carry (shuffle.js). WALK_ON is how
// far away his mark has to be for him to turn and walk; WALK_OFF is how close
// he comes before he turns back to the fight.
const WALK_ON = 0.9;
const WALK_OFF = 0.35;
const V_STANCE = 0.45;

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

const _bq = quat();
const _fq = quat();
const _head = v3();
const _ankles = [v3(), v3()];
// Add a small Euler rotation to a bone's local quaternion, in place. The same
// idea as rig.js's addEuler: breathing is added on top of the authored pose
// rather than written over a joint, so the pose keeps its own neck and the
// torso reads as breathing rather than as being replaced by it.
function addEuler(sk, bone, x, y, z) {
  const i = BONE_INDEX[bone];
  if (i === undefined) return;
  qEuler(_bq, x, y, z);
  qMul(sk.local[i], sk.local[i], _bq);
}

export class Referee {
  constructor() {
    this.skel = new Skeleton();
    this.pose = 'stand';
    this.blend = 1;
    this.t = 0;
    this.hold = 0;             // seconds left of a gesture that must finish
    this.x = 2.0;
    this.z = 0;
    this.yaw = 0;
    this.placed = false;
    this.moving = false;
    this.vx = 0;
    this.vz = 0;
    // A pose change blends from wherever he actually is. These hold the state
    // to blend from — the quaternion state and the root height at the moment
    // the change was asked for — so a change of mind never snaps him back to
    // the start of the pose he was leaving.
    this._fromQ = Array.from({ length: BONE_COUNT }, (_, i) => qCopy(quat(), QUATS.stand[i]));
    this._rootFrom = P.stand.root.p[1];
    this._q = Array.from({ length: BONE_COUNT }, () => quat());
    // He walks, for the same reason the fighters do: a man crossing a mat with
    // his soles glued to it is the most visible wrong thing in a frame. It was
    // step.js's planner, a foot picked up once the pose had dragged it far
    // enough: the sole rode the shin (7° off flat on a planted foot in the
    // middle, 15° at the ninetieth percentile) and nothing above the knees
    // knew he was walking. It is the walkout's gait cycle now (gait.js), with
    // his own stance as where his feet go when he stops.
    this.gait = new Gait();
    this.shuffle = new Shuffle();
    this.mode = 'stance';
    this._homes = [[0, 0, 0], [0, 0, 0]];
    this._left = [1, 0];
    // Which way his knees bend. See step.js: without it the solver keeps the
    // knee wherever the pose left it, and a leg swinging through the vertical
    // has no opinion worth keeping.
    this._fwd = v3(0, 0.25, 1);
  }

  // Change what he is doing, starting from wherever the blend has him now.
  //
  // The straight version — `from = pose; blend = 0` — is only smooth when the
  // old pose had finished. The camera drifts, the pair turns and the fight
  // goes up and down, so he changes his mind mid-move all the time; restarting
  // the blend from the authored pose sent his hips a quarter of a metre in one
  // frame, which read as a twitch. Capturing the current state and blending
  // from it keeps every change continuous.
  switchTo(name) {
    if (name === this.pose) return;
    // Capture the blended state as it stands right now, then blend from it.
    blendQuats(this._fromQ, this._fromQ, QUATS[this.pose], this.blend);
    this._rootFrom += (P[this.pose].root.p[1] - this._rootFrom) * this.blend;
    this._fromCrouch = this.pose === 'crouch';
    this.pose = name;
    this.blend = 0;
  }

  // A gesture that outranks whatever he would be doing otherwise, for a while.
  gesture(name, seconds) {
    this.switchTo(name);
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
  _ground() { return groundFeet(this.skel); }

  // Off his stance and into a walk: a fresh cycle standing where his feet are,
  // with the foot further behind the way he is going leaving first.
  _toWalk(speed) {
    const g = new Gait();
    const dirx = speed > 1e-3 ? this.vx / speed : 0, dirz = speed > 1e-3 ? this.vz / speed : 0;
    let behind = 0, most = Infinity;
    for (let i = 0; i < 2; i++) {
      const f = this.shuffle.feet[i];
      // Feet that have never been put down (his first frame) the walk puts
      // down itself, under him.
      if (!f.set) continue;
      g.feet[i].g[0] = f.g[0]; g.feet[i].g[1] = f.g[1]; g.feet[i].set = true;
      const ahead = (f.g[0] - this.x) * dirx + (f.g[1] - this.z) * dirz;
      if (ahead < most) { most = ahead; behind = i; }
    }
    g.phase = g.cfg.DUTY - 0.02 - 0.5 * behind;
    g.last = [this.x, this.z];
    g.vel = [this.vx, this.vz];
    g.speed = speed;
    this.gait = g;
    this.mode = 'walk';
  }

  // And back: the feet stay where the walk put them, and the stance takes
  // them from there.
  _toStance() {
    for (let i = 0; i < 2; i++) {
      const f = this.gait.feet[i];
      this.shuffle.plant(i, f.g[0], f.g[1], this.yaw);
    }
    this.mode = 'stance';
  }

  // His feet in his stance, one at a time — the pair rig's way (see its _step).
  _stance(dt) {
    const sk = this.skel;
    const names = [['thighL', 'shinL', 'footL'], ['thighR', 'shinR', 'footR']];
    const heights = [0, 0];
    for (let i = 0; i < 2; i++) {
      const ft = names[i][2];
      sk.boneHead(_head, ft);
      const m = sk.world[BONE_INDEX[ft]];
      const h = this._homes[i];
      h[0] = _head[0]; h[1] = _head[2]; h[2] = Math.atan2(m[8], m[10]);
      heights[i] = _head[1];
    }
    const hm = sk.world[BONE_INDEX.hips];
    const ll = Math.hypot(hm[0], hm[2]) || 1;
    this._left[0] = hm[0] / ll; this._left[1] = hm[2] / ll;
    this.shuffle.update(dt, this._homes, this._left);
    for (let i = 0; i < 2; i++) {
      const f = this.shuffle.feet[i];
      _v3set(_ankles[i], f.g[0], heights[i] + f.lift, f.g[1]);
    }
    for (let i = 0; i < 2; i++) {
      const [th, sh, ft] = names[i];
      const f = this.shuffle.feet[i];
      // Flat on the mat, the way the walk puts it, turned to its own heading.
      qEuler(_fq, 0, (f.yaw * 180) / Math.PI, 0);
      solveTwoBone(sk, th, sh, ft, _ankles[i], this._fwd, 1, true);
      setWorldRot(sk, BONE_INDEX[ft], _fq, 1);
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
    // Follow the target the way a man crosses a mat, not a stop-motion puppet.
    //
    // A hard speed cap has him chase a target that is itself drifting: he
    // catches it, stands still, falls behind, chases it again — a few times a
    // minute, and each burst too short for a step, so he twitches and slides.
    // Instead he is a critically damped spring: he eases up to speed, settles
    // into the target's own pace, and eases back down, so the only time he
    // visibly starts or stops is when the target genuinely did. The dead zone
    // keeps him from creeping the last few centimetres, and the two thresholds
    // keep a drifting target from flip-flopping him.
    if (!this.moving && d > ENGAGE) this.moving = true;
    if (this.moving) {
      const K = 5, DAMP = 2 * Math.sqrt(K);
      this.vx += (dx * K - this.vx * DAMP) * dt;
      this.vz += (dz * K - this.vz * DAMP) * dt;
      // At arm's length from the fight, the part of that heading into it is
      // taken off: his mark is usually across the fight, and the way there is
      // round it. Left in, the spring aimed him through the pair, the circle
      // below pushed him back out onto the arc, and he faced one way and went
      // another.
      {
        const rx = this.x - origin[0], rz = this.z - origin[2], rr = Math.hypot(rx, rz);
        if (rr > 1e-4 && rr < KEEP_OUT + 0.05) {
          const ux = rx / rr, uz = rz / rr, into = this.vx * ux + this.vz * uz;
          if (into < 0) { this.vx -= into * ux; this.vz -= into * uz; }
        }
      }
      const v = Math.hypot(this.vx, this.vz);
      // Walking, he gets up to speed only as fast as he comes round to face
      // the way he is going: a man turns and then walks, rather than
      // setting off sideways at a stride.
      let cap = V_STANCE;
      if (this.mode === 'walk' && v > 1e-3) {
        const facing = (Math.sin(this.yaw) * this.vx + Math.cos(this.yaw) * this.vz) / v;
        cap = V_STANCE + (VMAX - V_STANCE) * Math.max(0, Math.min(1, (facing - 0.75) / 0.2));
      }
      if (v > cap) { const s = cap / v; this.vx *= s; this.vz *= s; }
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      if (d < RELEASE && Math.hypot(this.vx, this.vz) < 0.18) this.moving = false;
    } else if (this.vx || this.vz) {
      // Arrived: what is left of his pace runs out over a tenth of a second
      // rather than in one frame. Zeroed at once, the landing point of a foot
      // still in the air jumped with it — 707 m/s² at the toe (gait-check).
      const k = Math.exp(-dt * 10);
      this.vx *= k; this.vz *= k;
      if (Math.hypot(this.vx, this.vz) < 0.01) this.vx = this.vz = 0;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
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
    // And never in the wedge between the lens and the fight.
    //
    // The note at the top of this file says it in as many words — "the one
    // thing he must never be is between the two of them and the lens" — and
    // until now nothing enforced it. Standing still he is fine: his target is
    // 150 degrees round from the camera's own bearing. Walking is the problem.
    // A cut sends that target most of the way round the mat, he takes seconds
    // to get there, and the way round passes the camera. A player photographed
    // exactly that: the referee crossing the lens with his back to it, a black
    // shape over the whole right of the frame, and the fight behind him.
    //
    // He is already pinned to a circle around the pair by KEEP_OUT, so the rule
    // is one angular clamp: stay out of the sector the camera looks through. He
    // slides to whichever edge of it is nearer, which keeps him walking rather
    // than teleporting, and outside the sector — almost always — it costs
    // nothing at all.
    {
      const a = Math.atan2(this.x - origin[0], this.z - origin[2]);
      let off = a - camBearing;
      while (off > Math.PI) off -= 2 * Math.PI;
      while (off < -Math.PI) off += 2 * Math.PI;
      if (Math.abs(off) < BLOCKS) {
        const edge = camBearing + (off >= 0 ? BLOCKS : -BLOCKS);
        const rr = Math.hypot(this.x - origin[0], this.z - origin[2]) || KEEP_OUT;
        this.x = origin[0] + Math.sin(edge) * rr;
        this.z = origin[2] + Math.cos(edge) * rr;
      }
    }

    // Where he is actually going. Not the spring's velocity: that points at
    // his mark, and the mark is usually across the fight, so the circle above
    // turns the chord into an arc round it. Facing the chord he walked the arc
    // sideways, which is the crossed feet all over again.
    if (!this._tv) { this._tv = [0, 0]; this._px = this.x; this._pz = this.z; }
    if (dt > 0) {
      const k = Math.min(1, dt * 8);
      this._tv[0] += ((this.x - this._px) / dt - this._tv[0]) * k;
      this._tv[1] += ((this.z - this._pz) / dt - this._tv[1]) * k;
    }
    this._px = this.x; this._pz = this.z;
    // Turn and walk, or keep his stance: see WALK_ON. Only between steps, so
    // the feet handed from one to the other are both on the mat.
    const speed = Math.hypot(this._tv[0], this._tv[1]);
    if (this.mode === 'stance' && this.moving && d > WALK_ON && !this.shuffle.feet.some((f) => f.air)) {
      this._toWalk(speed);
    } else if (this.mode === 'walk' && (d < WALK_OFF || !this.moving) && speed < V_STANCE &&
               !this.gait.feet.some((f) => f.air)) {
      this._toStance();
    }

    // He faces the fight, except while he is walking somewhere, when he faces
    // where he is going.
    const want = this.mode === 'walk' && speed > 0.25
      ? Math.atan2(this._tv[0], this._tv[1])
      : Math.atan2(origin[0] - this.x, origin[2] - this.z);
    let turn = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    // No faster than a man turns: about 90° a second walking, a little more
    // turning on the spot. Faster than that his hips came round 40° inside one
    // step, and the foot in the air landed across the one on the mat.
    const most = (this.mode === 'walk' ? 1.6 : 3.0) * dt;
    this.yaw += Math.max(-most, Math.min(most, turn * Math.min(1, dt * 4)));

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
      const next = state === 'over' ? 'stop'
        : state === 'ready' ? 'stand'
        : ground && !this.moving ? 'crouch' : 'stand';
      if (next !== this.pose) this.switchTo(next);
    }
    // Up out of the crouch more slowly than down into it: the crouch stands
    // wider, and a man getting up brings his feet in under him as he rises.
    // At the speed he goes down, a foot still planted wide was out of reach
    // of the hips before the other had finished its step.
    const rate = this.pose === 'stand' && this._fromCrouch ? 1.7 : 2.6;
    this.blend = Math.min(1, this.blend + dt * rate);

    blendQuats(this._q, this._fromQ, QUATS[this.pose], this.blend);
    for (let i = 0; i < BONE_COUNT; i++) {
      const q = this.skel.local[i], s = this._q[i];
      q[0] = s[0]; q[1] = s[1]; q[2] = s[2]; q[3] = s[3];
    }
    // Breathing, added to the chest like the fighters' rather than written
    // over a joint. It was applied as an overwrite on the neck, which quietly
    // discarded whatever the pose had the neck doing and left him breathing
    // through a joint nobody breathes through.
    const br = Math.sin(this.t * 1.6);
    addEuler(this.skel, 'chest', br * 1.1, 0, 0);
    addEuler(this.skel, 'spine', br * 0.6, 0, 0);
    addEuler(this.skel, 'neck', -br * 0.5, 0, 0);

    const ph = this._rootFrom + (P[this.pose].root.p[1] - this._rootFrom) * this.blend;
    const yawDeg = (this.yaw * 180) / Math.PI;
    this.skel.rootPos[0] = this.x;
    this.skel.rootPos[1] = ph;
    this.skel.rootPos[2] = this.z;
    qEuler(this.skel.rootRot, 0, yawDeg, 0);
    this.skel.pose();
    // On the mat first, as the pose stands him (see _ground), so the walk
    // starts from his own height rather than bending his knees to reach it.
    const lift = this._ground() || 0;
    const ph2 = ph + lift;
    // Which way his knees bend (see _fwd): the way he faces.
    _v3set(this._fwd, Math.sin(this.yaw), 0.25, Math.cos(this.yaw));
    if (this.mode === 'stance') {
      this._stance(dt);
      this._ground();
      this.skel.finishSkin();
      return;
    }
    // Where his pose puts his feet, read before anything moves them: that is
    // where they go when he stops.
    const g = this.gait;
    g.stance(this.skel, this.x, this.z);
    g.step(dt, this.x, this.z, this.yaw);
    const o = g.out;
    if (o.amp > 0.005) {
      // The walk above the hips, the walkout's: pelvis turned to the forward
      // leg and dropped on the swinging side, trunk and head turned back
      // against it, arms swinging against the legs — the arms only when they
      // are hanging, not in the middle of a call.
      addEuler(this.skel, 'spine', 0, o.turn * 0.8, -o.list * 0.5);
      addEuler(this.skel, 'chest', 0, o.turn * 0.7, -o.list * 0.3);
      addEuler(this.skel, 'neck', 0, -o.turn * 0.3, -o.list * 0.2);
      addEuler(this.skel, 'head', 0, -o.turn * 0.2, 0);
      const arms = this.pose === 'stand' ? 1 : 0;
      addEuler(this.skel, 'armL', o.arm * arms, 0, 0);
      addEuler(this.skel, 'armR', -o.arm * arms, 0, 0);
      addEuler(this.skel, 'foreL', -o.elbowL * arms, 0, 0);
      addEuler(this.skel, 'foreR', -o.elbowR * arms, 0, 0);
      const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      this.skel.rootPos[0] = this.x + c * o.sway;
      this.skel.rootPos[1] = ph2 + o.bob - 0.5 * GAIT_BOB * o.amp;
      this.skel.rootPos[2] = this.z - sn * o.sway;
      qEuler(this.skel.rootRot, 0, yawDeg - o.turn, o.list);
      this.skel.pose();
    }
    g.legs(this.skel, MAT_Y, this.yaw, this._fwd, 1);
    this._ground();
    this.skel.finishSkin();
  }
}
