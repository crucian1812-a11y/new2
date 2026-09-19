// The walk to the middle of the mat.
//
// Between the tap on «Начать» and the first press there used to be nothing: the
// title card cut to two men already locked up in a standing tie, and the only
// thing between the two pictures was the half-second of black that covers every
// cut in this game. It reads as the game starting rather than as a fight
// starting, and a fight starting is the one thing this screen is for.
//
// So: they come on from opposite ends, they meet, they touch hands, the referee
// calls it on. Four seconds, and none of it is a cutscene — it is the same
// skeletons, the same skinning and the same step planner the rest of the game
// uses, with a small state machine in front.
//
// Three things this is deliberately not.
//
// It is not the pair rig. The pair rig's whole premise is that two bodies in
// contact are one object with two roots, and two men walking towards each other
// are not in contact and not one object. They are two of what the referee is:
// a solo skeleton with authored poses, a blend, and feet that stay where they
// are put. That machinery already exists and is shared through step.js.
//
// It is not authored frame by frame. The legs come out of the step planner, the
// arms swing off the same foot phase, and the only authored thing is four
// upper-body poses.
//
// And it does not end wherever it happens to end. The last frame of the walkout
// is the first frame of the fight, and a seam there would be the one jerk in
// the game that every single player sees. So the walk ends on the standing
// pose's own root positions, and the last phase blends the skeletons into
// exactly the quaternions the rig will take over with. `intro-check` measures
// what is left.

import {
  Skeleton, poseToQuats, blendQuats, solveTwoBone, BONE_COUNT, BONE_INDEX,
  HAND_REST, TIP_REST,
} from '../render/skeleton.js';
import { makeFeet, plantFeet, groundFeet } from './step.js';
import { POSES } from './poses.js';
import { quat, qCopy, qEuler, qMul, v3 } from '../core/m4.js';

// Hands, spread into every pose here for the same reason the referee spreads
// them into his: a man whose fingers disagree with the fighters' is a third
// pair of hands in a game with one definition of a hand.
const HANDS = {
  fingL: [-HAND_REST, 0, 0], handLTip: [-TIP_REST, 0, 0],
  fingR: [-HAND_REST, 0, 0], handRTip: [-TIP_REST, 0, 0],
};

// The upper body, four ways. The legs are never in here — they belong to the
// step planner, and a pose that also had an opinion about them would be two
// things fighting over one knee.
const P = {
  // Walking on. Tall, loose, chin level: a man coming out to compete, not a man
  // already in a fight.
  walk: {
    root: { p: [0, 0.961, 0], r: [0, 0, 0] },
    j: {
      ...HANDS,
      hips: [-2, 0, 0], spine: [3, 0, 0], chest: [2, 0, 0], neck: [-4, 0, 0], head: [3, 0, 0],
      clavL: [0, 0, 5], armL: [-12, 7, -9], foreL: [-34, 0, 0], handL: [-6, 0, 0],
      clavR: [0, 0, -5], armR: [-12, -7, 9], foreR: [-34, 0, 0], handR: [-6, 0, 0],
      // Mid-stride, not at attention: the left leg forward and the right
      // behind. A walker whose legs start as each other's mirror image has two
      // feet that hit the planner's stride threshold on the same frame for the
      // whole walk, and there is nothing downstream that would ever break the
      // tie — see the note on `busy` in step.js.
      thighL: [-11, 5, 3], shinL: [8, 0, 0], footL: [-3, 0, 0],
      thighR: [7, -5, -3], shinR: [10, 0, 0], footR: [-6, 0, 0],
    },
  },
  // The hand out. Right arm forward and open, weight slightly onto the front
  // foot, a small bow of the head — the slap before a roll.
  slap: {
    root: { p: [0, 0.955, 0], r: [0, 0, 0] },
    j: {
      ...HANDS,
      hips: [-4, 0, 0], spine: [6, 0, 0], chest: [4, 0, 0], neck: [2, 0, 0], head: [6, 0, 0],
      clavL: [0, 0, 5], armL: [-14, 8, -10], foreL: [-38, 0, 0], handL: [-6, 0, 0],
      clavR: [-4, 0, -10], armR: [-62, -6, 14], foreR: [-24, 0, 0], handR: [-4, 0, 0],
      thighL: [-4, 5, 3], shinL: [8, 0, 0], footL: [-3, 0, 0],
      thighR: [-4, -5, -3], shinR: [8, 0, 0], footR: [-3, 0, 0],
    },
  },
  // And the fist. Elbow in, knuckles forward at chest height, chin coming back
  // up — the second half of the same greeting and the last friendly thing
  // either of them does.
  bump: {
    root: { p: [0, 0.958, 0], r: [0, 0, 0] },
    j: {
      ...HANDS,
      hips: [-3, 0, 0], spine: [5, 0, 0], chest: [3, 0, 0], neck: [-2, 0, 0], head: [2, 0, 0],
      clavL: [0, 0, 5], armL: [-14, 8, -10], foreL: [-40, 0, 0], handL: [-6, 0, 0],
      clavR: [-2, 0, -12], armR: [-40, -8, 16], foreR: [-62, 0, 0], handR: [-4, 0, 0],
      thighL: [-4, 5, 3], shinL: [8, 0, 0], footL: [-3, 0, 0],
      thighR: [-4, -5, -3], shinR: [8, 0, 0], footR: [-3, 0, 0],
    },
  },
};

const QUATS = {};
for (const k in P) QUATS[k] = poseToQuats(Array.from({ length: BONE_COUNT }, () => quat()), P[k]);
// And the one pose that is not authored here: where the fight begins. Taken
// from the library rather than copied, so a round of pose work moves the end of
// the walkout with it and the seam cannot rot.
const STAND = {
  A: poseToQuats(Array.from({ length: BONE_COUNT }, () => quat()), POSES.STANDING.A),
  B: poseToQuats(Array.from({ length: BONE_COUNT }, () => quat()), POSES.STANDING.B),
};

// How long each part takes, in seconds. The walk is the only one with anything
// to do, so it gets most of it.
export const PHASES = { in: 2.6, slap: 0.75, bump: 0.75, set: 0.55 };
export const INTRO_TIME = PHASES.in + PHASES.slap + PHASES.bump + PHASES.set;
// Where they come on from, in metres along the line they end up on. The mat is
// eight metres across, so this is inside the tatami and outside the picture the
// standing shot holds.
const ENTER = 2.55;

// A walk on, rather than the referee's brisk repositioning. Shorter steps, more
// time in the air, and less overshoot — and every one of those numbers came off
// the judge rather than out of taste.
//
// With the referee's gait (0.44 / 0.30 / 1.4) these two cover 1.89 m in 2.6 s,
// which peaks at 1.09 m/s, and at that pace his numbers ask for a step of a
// metre: the foot crosses under the body at 5.4 m/s and the knee has to go with
// it, 13.8 cm in a frame. A stride of 0.32 with 0.38 s of swing and a lead of
// 0.8 asks for 0.65 m, which the leg does at 1.7 m/s.
const ENTRY_GAIT = { STRIDE: 0.32, SWING: 0.38, LIFT: 0.06, LEAD: 0.8 };

// How close they stand to touch hands, and where the hands meet.
//
// Not the same as where they stand to fight, and that is the whole point. The
// standing pose puts them 1.32 m apart, and at that distance two men cannot
// reach each other: the shoulder sits about 0.55 m from the middle and the arm
// is 0.52 long, so even with both arms straight the fingertips stay a hand's
// breadth apart — the judge measured 27.8 cm with the arms as authored, two men
// greeting the air. So they close to a metre to say hello and take the extra
// half-step back as they settle into their stance, which is what two people
// actually do.
//
// And the hands are put on a point rather than aimed at one. Both men reach for
// the same place, so wherever the pose leaves the arm the two hands arrive
// together — the same two-bone solver the grips use, and for the same reason:
// the pose is the intent, the solver makes it true.
//
// The two targets are not the same point, and the first version's were. Both
// hands aimed at dead centre meet exactly — and then keep going, because each
// arm is solving for a point the other hand is already occupying: the judge
// read A's forearm 8.8 cm inside B's fingers. Palms meet at the middle, so each
// hand stops a palm's width short of it, on its own side.
const MEET = 0.52;
const PALM = 0.055;
const SLAP_AT = 1.30;
const BUMP_AT = 1.22;

const _bq = quat();
function addEuler(sk, bone, x, y, z) {
  const i = BONE_INDEX[bone];
  if (i === undefined) return;
  qEuler(_bq, x, y, z);
  qMul(sk.local[i], sk.local[i], _bq);
}

// One man walking on. Two of these make a walkout.
class Entrant {
  constructor(role) {
    this.role = role;
    this.skel = new Skeleton();
    this.feet = makeFeet();
    this.q = Array.from({ length: BONE_COUNT }, () => quat());
    // Where he ends, straight out of the standing pose: the walk has no opinion
    // about where the fight starts.
    const end = POSES.STANDING[role].root;
    this.endZ = end.p[2];
    this.endY = end.p[1];
    this.yaw = end.r[1];
    // Where he stops to say hello, which is nearer than where he stands to
    // fight. See MEET.
    this.meetZ = Math.sign(end.p[2] || 1) * MEET;
    this._palm = v3(0, 0, 0);
    // Which way he comes from is which side he ends on.
    this.fromZ = Math.sign(end.p[2] || 1) * ENTER;
    // Which way his knees bend: forwards, in the direction he is facing. The
    // same convention the camera's orbit uses — yaw 0 looks down +z.
    const yr = (this.yaw * Math.PI) / 180;
    this.forward = v3(Math.sin(yr), 0, Math.cos(yr));
    this.z = this.fromZ;
    this.vz = 0;
    this.phase = 0;
    // Set on the frame a foot lands, so a footstep can be played on the step
    // rather than every so many centimetres of travel. The game's own footsteps
    // are the second kind and it shows: main.js plays one every 40 cm of the
    // pair's drift, over a step that may not have happened.
    this.landed = false;
  }

  // Everything above the hips, as one blend across the three authored poses and
  // then into the standing pose. One expression rather than a switch, because
  // the seam at the end of it is the thing that has to be continuous.
  // The middle of the mat at a given height, a palm's width back on his own
  // side of it.
  palmAt(y) {
    this._palm[0] = 0;
    this._palm[1] = y;
    this._palm[2] = Math.sign(this.endZ || 1) * PALM;
    return this._palm;
  }

  _upper(t) {
    const { in: tIn, slap, bump } = PHASES;
    this.reach = 0;
    this.reachAt = null;
    if (t < tIn) {
      // Walking: the arms swing off the feet, added on top rather than written
      // into the pose, so the walk pose keeps its own shoulders.
      for (let i = 0; i < BONE_COUNT; i++) qCopy(this.q[i], QUATS.walk[i]);
      return 0;
    }
    if (t < tIn + slap) {
      // Into the hand, and out of it again: a greeting is a reach and a return,
      // not a pose held for three quarters of a second.
      const u = (t - tIn) / slap;
      const w = Math.sin(u * Math.PI);
      blendQuats(this.q, QUATS.walk, QUATS.slap, w);
      this.reach = w;
      this.reachAt = this.palmAt(SLAP_AT);
      return 0;
    }
    if (t < tIn + slap + bump) {
      const u = (t - tIn - slap) / bump;
      const w = Math.sin(u * Math.PI);
      blendQuats(this.q, QUATS.walk, QUATS.bump, w);
      this.reach = w;
      this.reachAt = this.palmAt(BUMP_AT);
      return 0;
    }
    // And the last of it: into exactly what the rig will take over with.
    const u = Math.min(1, (t - tIn - slap - bump) / PHASES.set);
    blendQuats(this.q, QUATS.walk, STAND[this.role], u * u * (3 - 2 * u));
    return u;
  }

  update(dt, t) {
    // Where he is on the mat. He walks in over the first phase and stands still
    // for the rest of it; the ease is a cubic in and out, so he arrives without
    // stopping dead and leaves without a lurch.
    const settle = this._upper(t);
    // Where he is on the mat: in to the greeting distance over the first phase,
    // still while they say hello, and the half-step back into his stance over
    // the settle. Both eases are cubic, so he arrives without stopping dead and
    // steps back without a lurch.
    const u = Math.min(1, t / PHASES.in);
    const s = u * u * (3 - 2 * u);
    const back = settle * settle * (3 - 2 * settle);
    const wasZ = this.z;
    this.z = this.fromZ + (this.meetZ - this.fromZ) * s + (this.endZ - this.meetZ) * back;
    this.vz = dt > 0 ? (this.z - wasZ) / dt : 0;
    for (let i = 0; i < BONE_COUNT; i++) {
      const q = this.skel.local[i], v = this.q[i];
      q[0] = v[0]; q[1] = v[1]; q[2] = v[2]; q[3] = v[3];
    }

    // Breathing, and the arm swing, both added on top and both fading out as he
    // settles into the pose the rig is about to take over. Anything still
    // moving at the seam is a jerk on the first frame of the fight.
    const calm = 1 - settle;
    this.phase += dt;
    const br = Math.sin(this.phase * 1.5) * calm;
    addEuler(this.skel, 'chest', br * 1.2, 0, 0);
    addEuler(this.skel, 'spine', br * 0.6, 0, 0);
    addEuler(this.skel, 'neck', -br * 0.5, 0, 0);
    // The arms swing against the legs. The phase is the swinging foot's own, so
    // the arm is never out of step with the step — that is the whole trick, and
    // it is why this reads as walking rather than as a mannequin being slid.
    const f = this.feet.find((x) => x.t < 1);
    if (f && calm > 0) {
      const sw = Math.sin(f.t * Math.PI) * 14 * calm;
      // Which arm leads depends on which foot is travelling.
      const lead = this.feet[0] === f ? 1 : -1;
      addEuler(this.skel, 'armL', -sw * lead, 0, 0);
      addEuler(this.skel, 'armR', sw * lead, 0, 0);
    }

    this.skel.rootPos[0] = 0;
    this.skel.rootPos[1] = this.endY;
    this.skel.rootPos[2] = this.z;
    qEuler(this.skel.rootRot, 0, this.yaw, 0);
    this.skel.pose();
    // The hand on the other man's. Both reach for the same point, so wherever
    // the pose leaves the arm the two of them arrive together.
    if (this.reach > 0.01) {
      solveTwoBone(this.skel, 'armR', 'foreR', 'handR', this.reachAt, null, this.reach);
    }
    // And letting go of both. The held feet and the lift onto the tatami are
    // the two things about him that are not in the pose, so both fade out over
    // the settle — otherwise the last frame of the walk is the pose plus a foot
    // correction and the first frame of the fight is the pose, and the
    // difference between them is a jerk every player sees, every match.
    const air = this.feet.map((f) => f.t < 1);
    plantFeet(this.skel, this.feet, dt, 0, this.vz, ENTRY_GAIT, this.forward, calm);
    this.landed = this.feet.some((f, i) => air[i] && f.t >= 1);
    groundFeet(this.skel, 0.05, calm);
    this.skel.finishSkin();
  }
}

export class Walkout {
  constructor() {
    this.a = new Entrant('A');
    this.b = new Entrant('B');
    this.t = 0;
    this.done = false;
    // What the outside world watches for: the moment the hands actually meet,
    // so a sound can land on it rather than near it.
    this.slapped = false;
    this.bumped = false;
  }

  reset() {
    this.t = 0;
    this.done = false;
    this.slapped = false;
    this.bumped = false;
    this.a = new Entrant('A');
    this.b = new Entrant('B');
    // One frame with no time in it, so the first drawn frame is a posed man
    // rather than a skeleton in its bind pose.
    this.a.update(0, 0);
    this.b.update(0, 0);
  }

  update(dt) {
    if (this.done) return;
    const was = this.t;
    this.t = Math.min(INTRO_TIME, this.t + dt);
    // The two beats worth hearing, each fired once, on the frame the reach is
    // at full stretch rather than on the frame the phase begins.
    const slapAt = PHASES.in + PHASES.slap / 2;
    const bumpAt = PHASES.in + PHASES.slap + PHASES.bump / 2;
    if (!this.slapped && was < slapAt && this.t >= slapAt) this.slapped = true;
    if (!this.bumped && was < bumpAt && this.t >= bumpAt) this.bumped = true;
    this.a.update(dt, this.t);
    this.b.update(dt, this.t);
    if (this.t >= INTRO_TIME) this.done = true;
  }

  // Where the camera should look: the middle of the two of them, rising from
  // the mat to chest height as they close.
  focus(out) {
    const ha = this.a.skel.world[BONE_INDEX.chest];
    const hb = this.b.skel.world[BONE_INDEX.chest];
    out[0] = (ha[12] + hb[12]) / 2;
    out[1] = (ha[13] + hb[13]) / 2;
    out[2] = (ha[14] + hb[14]) / 2;
    return out;
  }

  // How far the pair reaches from that point, the same number the match camera
  // computes every frame and for the same reason: the lens opens to hold them.
  spread() {
    const c = this.focus(_focus);
    let far = 0;
    for (const sk of [this.a.skel, this.b.skel]) {
      for (const w of sk.world) {
        const d = Math.hypot(w[12] - c[0], w[13] - c[1], w[14] - c[2]);
        if (d > far) far = d;
      }
    }
    return far;
  }
}

const _focus = v3(0, 0, 0);

// And the man on the title card, who was a photograph.
//
// He is the match fighter held in the game's own standing pose, posed once at
// load and never touched again — which is the right mesh and the wrong thing to
// do with it. The first picture anybody sees of this game was a still, and a
// still of a rendered man reads as a bug rather than as a portrait: everything
// else on the screen moves, the hall lights flicker, the crowd hums, and he
// does not blink.
//
// What he does now is what a man waiting to fight does. He breathes, he shifts
// his weight from one foot to the other, and every so often he looks somewhere
// else. Nothing here is a new mechanism: the breath is the referee's, added on
// top of the pose rather than written over a joint; the weight shift moves the
// hips and lets the step planner hold the feet where they are, which is what a
// weight shift *is*; and the look is a few degrees on the neck.
//
// The three cycles are deliberately incommensurate — 4.6, 11.3 and 17.9
// seconds — so the loop never lands on itself. A title card is on screen for as
// long as somebody is deciding, and a figure that visibly repeats every four
// seconds is worse than one that does not move at all.
const IDLE_BREATH = 4.6;
const IDLE_SWAY = 11.3;
const IDLE_LOOK = 17.9;
// How far the weight goes across. Two centimetres of hip: enough that the
// silhouette changes, small enough that the feet never have to step.
const SWAY = 0.022;

export class TitleIdle {
  constructor(role = 'A') {
    this.skel = new Skeleton();
    this.feet = makeFeet();
    this.q = poseToQuats(Array.from({ length: BONE_COUNT }, () => quat()), POSES.STANDING[role]);
    this.t = 0;
    this.base = v3(0, POSES.STANDING[role].root.p[1], 0);
    this.yaw = 0;
  }

  // Where he stands and which way he faces. Separate from the constructor
  // because the title card's framing is the title card's business.
  place(x, y, z, yawDeg) {
    this.base[0] = x; this.base[1] = y; this.base[2] = z;
    this.yaw = yawDeg;
    this.update(0);
    return this;
  }

  update(dt) {
    this.t += dt;
    for (let i = 0; i < BONE_COUNT; i++) {
      const q = this.skel.local[i], v = this.q[i];
      q[0] = v[0]; q[1] = v[1]; q[2] = v[2]; q[3] = v[3];
    }
    const br = Math.sin((this.t / IDLE_BREATH) * Math.PI * 2);
    addEuler(this.skel, 'chest', br * 1.3, 0, 0);
    addEuler(this.skel, 'spine', br * 0.7, 0, 0);
    addEuler(this.skel, 'neck', -br * 0.6, 0, 0);
    // The weight, and the roll that goes with it. A man moving his hips two
    // centimetres to the left leans his shoulders the other way to stay over
    // his feet, which is the half of this that makes it read as weight rather
    // than as a wobble.
    const sw = Math.sin((this.t / IDLE_SWAY) * Math.PI * 2);
    addEuler(this.skel, 'hips', 0, 0, sw * 1.6);
    addEuler(this.skel, 'chest', 0, 0, -sw * 2.2);
    // And where he is looking. Slow, small, and off its own clock.
    const lk = Math.sin((this.t / IDLE_LOOK) * Math.PI * 2);
    addEuler(this.skel, 'neck', 0, lk * 5, 0);
    addEuler(this.skel, 'head', lk * 1.5, lk * 3, 0);

    const c = Math.cos((this.yaw * Math.PI) / 180), s = Math.sin((this.yaw * Math.PI) / 180);
    const dx = sw * SWAY;
    this.skel.rootPos[0] = this.base[0] + dx * c;
    this.skel.rootPos[1] = this.base[1];
    this.skel.rootPos[2] = this.base[2] - dx * s;
    qEuler(this.skel.rootRot, 0, this.yaw, 0);
    this.skel.pose();
    // The feet stay where they are and the legs take up the difference, which
    // is the whole of what shifting your weight looks like. Two centimetres is
    // nowhere near the planner's stride, so he never steps.
    plantFeet(this.skel, this.feet, dt, 0, 0, ENTRY_GAIT, null);
    this.skel.finishSkin();
  }

  // How far he reaches from a point, so the title camera can open its lens
  // enough to hold him. It used not to be passed at all, and the shot cut him
  // off at the shin.
  spread(at) {
    let far = 0;
    for (const w of this.skel.world) {
      const d = Math.hypot(w[12] - at[0], w[13] - at[1], w[14] - at[2]);
      if (d > far) far = d;
    }
    return far;
  }
}
