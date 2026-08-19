// Characters are not sprites. They are little articulated rigs posed in 3D
// and projected through the same 2.5D transform as the world, which is why
// they can face any of 360 directions, occlude their own limbs correctly, and
// swing a weapon that actually travels through an arc.
//
// Local axes:  +x = the character's forward,  +y = its left,  +z = up.
// After rotating by `facing`, a point (dx,dy,dz) lands on screen at
// (dx, dy * ISO_Y - dz) — exactly the world transform, so a sword tip and a
// tree root agree about where the ground is.

import { TAU, clamp01, lerp, clamp } from '../core/math.js';
import { css, mixc, PAL } from './palette.js';
import { ISO_Y } from './renderer.js';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * The shape of a limb between two screen points.
 *
 * This was a straight tapered capsule, and a straight taper is the single
 * loudest thing that says "these are tubes with a person drawn on them". No
 * limb on a body is a cone: an upper arm swells at the deltoid and thins at
 * the elbow, a calf carries almost all its mass in the top third and runs to
 * nothing at the ankle, a thigh is thickest where it leaves the hip. So each
 * side of the limb now bows out through a mid station — `belly` is how far
 * past the straight taper that station sits, `mid` is where along the limb it
 * falls. The two sides bow independently of the end caps, so the silhouette
 * is a proper spindle rather than a pill, and the cost is two quadratics
 * instead of two lines.
 *
 * `belly = 0` reproduces the old shape exactly, which is what flat things —
 * blades, straps, bones — still want.
 */
function capsule(ctx, x0, y0, x1, y1, r0, r1, belly = 0, mid = 0.42) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1e-4;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const a = Math.atan2(dy, dx);
  // A quadratic only reaches half way to its control point, so the control
  // sits at twice the bulge to put the curve where the bulge was asked for.
  const mx = x0 + dx * mid;
  const my = y0 + dy * mid;
  const rm = lerp(r0, r1, mid);
  const cr = rm + rm * belly * 2;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * r0, y0 + ny * r0);
  if (belly > 0) ctx.quadraticCurveTo(mx + nx * cr, my + ny * cr, x1 + nx * r1, y1 + ny * r1);
  else ctx.lineTo(x1 + nx * r1, y1 + ny * r1);
  ctx.arc(x1, y1, r1, a + Math.PI / 2, a - Math.PI / 2, true);
  if (belly > 0) ctx.quadraticCurveTo(mx - nx * cr, my - ny * cr, x0 - nx * r0, y0 - ny * r0);
  else ctx.lineTo(x0 - nx * r0, y0 - ny * r0);
  ctx.arc(x0, y0, r0, a - Math.PI / 2, a + Math.PI / 2, true);
  ctx.closePath();
}

/** Rotation of a local point into world-relative offsets. */
function rot(p, cosF, sinF) {
  return [p[0] * cosF - p[1] * sinF, p[0] * sinF + p[1] * cosF, p[2]];
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/**
 * Builds a humanoid pose in local space. Every value is in "character units"
 * where 100 = full height; the caller scales.
 */
/**
 * The distance a figure covers in one full walk cycle, in character units.
 *
 * Taken from the length of its own leg — about two and a half times it, which
 * is what a running human does — so a crabling on stumps takes short quick
 * steps and something long-limbed takes long slow ones, and neither has to be
 * tuned by hand. The game multiplies this by the figure's world size to know
 * how far it must travel before the cycle comes round again; the pose swings
 * the leg through exactly the same distance. That agreement is the whole
 * trick: while the foot is down it tracks backwards at the speed the body
 * moves forward, so it stays on its patch of ground instead of skating.
 */
export function strideChar(build = {}) {
  const { thigh = 24, shin = 23 } = build;
  return (thigh + shin) * 2.6;
}

export function poseHumanoid(st, build = {}) {
  const {
    hipH = 47,
    chestH = 71,
    // Short neck, big head. Diablo II's figures were stocky on purpose — a
    // long neck at this size reads as a head balanced on a post, and the
    // silhouette loses the heavy, armoured weight the game is after.
    neckH = 79,
    headH = 88,
    // Wide in the shoulder, narrow in the hip. The figures are meant to be
    // stocky, but the arms used to be nearly half the width of the chest they
    // hung beside, and a body whose limbs outweigh its trunk reads as a
    // mannequin however well it is shaded. Widening the shoulders and taking
    // the limbs in (below) is what turns the same rig into a person.
    shoulderW = 15,
    hipW = 9.4,
    thigh = 24,
    shin = 23,
    upperArm = 19,
    foreArm = 18,
    // How this particular thing moves. Every figure in the game shared one
    // walk, and a screen of six different monsters all stepping the same way
    // reads as one animation in six paint jobs however different the bodies
    // are. These are the handful of dials that separate a shamble from a
    // swagger from a march, and they cost nothing: the cycle is the same, the
    // proportions of it are not.
    stoop = 0, // permanent forward lean — a hunched, dragging thing
    sway = 0, // extra roll per step: a swagger, or a heavy thing rolling
    bounce = 1, // vertical travel per step
    armSwing = 1, // how freely the arms swing; near zero is stiff or bound
    limp = 0, // one leg favoured: the body dips onto it and it drags
    jitter = 0, // per-frame twitch — something held together by will alone
  } = build;

  const t = st.t;
  const anim = st.anim || 'idle';
  const at = st.animT || 0;
  const speed = st.speed || 0;
  const p = {};

  // --- base sway -----------------------------------------------------------
  let lean = 0; // forward lean, radians
  let roll = 0; // sideways lean of the spine, radians — positive leans left
  let bob = 0;
  let twist = 0; // shoulder rotation about the up-axis
  let pelvis = 0; // pelvis rotation about the up-axis
  let list = 0; // pelvis tilt: how much higher the left hip rides than the right
  let crouch = 0;

  const runPhase = st.phase || 0;
  const walkAmt = clamp01(speed);
  // How hard the figure is turning, in radians per second, and how much of its
  // own weight that throws sideways. A body going round a corner banks into
  // it; a body that does not is on rails.
  const turn = clamp(st.turn || 0, -6, 6);
  // Every figure needs its own clock or a pack of them breathes in unison,
  // which is the most inhuman thing a crowd can do.
  const seed = st.seed || 0;

  if (walkAmt > 0.01) {
    lean += 0.16 * walkAmt;
    bob += Math.sin(runPhase * 2) * 2.2 * walkAmt * bounce;
    twist += Math.sin(runPhase) * 0.22 * walkAmt;
    // A swagger, or the roll of something too heavy to keep upright over one
    // foot: the trunk tips towards whichever leg is holding it.
    roll += Math.sin(runPhase) * sway * walkAmt;
    // A limp is the body falling onto the bad leg once a cycle. It is a
    // vertical thing, not a horizontal one — the foot still lands where the
    // ground says it must, so the drag reads without the figure skating.
    if (limp > 0) bob -= Math.max(0, Math.sin(runPhase)) * limp * 3.4 * walkAmt;

    // The pelvis and the shoulders turn *against* each other. This is the
    // whole difference between a walk and a wind-up toy: the arm that swings
    // forward drags the shoulder with it, and the leg that swings forward
    // drags the hip, and since those are opposite legs the two girdles wind
    // in opposite directions across the waist.
    pelvis -= Math.sin(runPhase) * 0.16 * walkAmt;

    // And the pelvis tilts. With all the weight on one leg, the hip on the
    // *unsupported* side has nothing under it and drops — the abductors on
    // the standing side pay for holding it up at all. In the cycle below the
    // left leg is in stance while sin(phase) is positive, so that is exactly
    // when the right hip falls away.
    list += Math.sin(runPhase) * 1.7 * walkAmt;
  } else {
    // Standing is not a pose, it is a slow argument between two legs about
    // which of them is holding the body up. The weight drifts from one to the
    // other every few seconds; the loaded hip rides high, the spine bends the
    // other way to put the head back over the feet, and the free leg unlocks.
    // This is contrapposto, and it is the reason a carved figure from 450 BC
    // looks alive and a mannequin does not.
    const w = Math.sin(t * 0.42 + seed);
    bob += Math.sin(t * 1.8 + seed) * 0.9;
    lean += Math.sin(t * 0.7 + seed) * 0.02;
    list += w * 2.1;
    roll -= w * 0.05;
    twist += w * 0.05;
  }

  // Banking. Lean into the turn like a runner, and no further than a runner.
  roll += clamp(turn * 0.06, -0.16, 0.16) * (0.35 + walkAmt * 0.65);
  lean += stoop;
  // Breathing. The chest lifts and the shoulders come up with it, slower than
  // the idle sway so the two never line up into one pulse.
  const breath = Math.sin(t * 0.85 + seed * 1.7);
  bob += breath * 0.35 * (1 - walkAmt * 0.6);
  // A twitch, for things that should not be walking at all.
  if (jitter > 0) {
    const j = (n) => (Math.sin(t * 47 + n * 12.9898 + seed) * 43758.5453) % 1;
    twist += j(1) * jitter;
    lean += j(2) * jitter * 0.6;
    bob += j(3) * jitter * 6;
  }

  // --- animation overlays --------------------------------------------------
  let armSwingR = 0; // right arm forward/back in the sagittal plane
  let armSwingL = 0;
  let armLiftR = 0; // right arm raised sideways
  let armLiftL = 0;
  let elbowR = 0.5;
  let elbowL = 0.5;
  let weaponSpin = 0;

  if (walkAmt > 0.01) {
    armSwingR = -Math.sin(runPhase) * 0.75 * walkAmt * armSwing;
    armSwingL = Math.sin(runPhase) * 0.75 * walkAmt * armSwing;
  } else {
    armSwingR = Math.sin(t * 1.8 + 0.4) * 0.05 - 0.1;
    armSwingL = Math.sin(t * 1.8) * 0.05 - 0.1;
  }

  // The rotation the shoulders carry through a swing, as a function of time.
  //
  // A blow is not the arm. It starts at the ground, goes up through the hips,
  // across the shoulders and out along the arm last of all, and each link
  // reaches its peak a moment after the one below it — that lag is the whole
  // reason a strike looks like it carries force instead of being waved. So
  // the swing's rotation is a curve that can be *sampled twice*: once for the
  // shoulders, and once slightly earlier for the pelvis, which is what puts
  // the hips ahead of the chest.
  //
  // The recovery overshoots and comes back, because a body that has just
  // thrown its whole weight one way cannot stop dead on the mark.
  const swingCurve = (k, back, through) => {
    if (k < 0.35) {
      // Wind-up, which is itself the anticipation for the strike — but it
      // opens with a small counter-move, a settle away before the coil.
      const e = k / 0.35;
      return back * e - back * 0.14 * Math.sin(Math.min(1, k / 0.09) * Math.PI);
    }
    if (k < 0.55) {
      const e = (k - 0.35) / 0.2;
      return lerp(back, through, e * e * (3 - 2 * e));
    }
    const e = (k - 0.55) / 0.45;
    // Settle: past the mark, then back to it.
    return through * ((1 - e) - 0.2 * Math.sin(Math.PI * e));
  };
  // How far ahead of the shoulders the hips run. A tenth of the animation is
  // about a frame and a half at these speeds, which is exactly the amount you
  // read as "he put his body into it" rather than as a mistimed pose.
  const LEAD = 0.1;

  switch (anim) {
    case 'attack': {
      // 0 .. 0.35 wind up, 0.35 .. 0.55 strike, rest recover
      const k = at;
      twist += swingCurve(k, -0.5, 0.62);
      pelvis += swingCurve(Math.min(1, k + LEAD), -0.5, 0.62) * 0.8;
      if (k < 0.35) {
        const e = k / 0.35;
        armSwingR = lerp(armSwingR, -1.9, e);
        armLiftR = lerp(0, 0.85, e);
        elbowR = lerp(0.5, 1.5, e);
        lean -= 0.1 * e;
        weaponSpin = -1.5 * e;
      } else if (k < 0.55) {
        const e = (k - 0.35) / 0.2;
        const ee = e * e * (3 - 2 * e);
        armSwingR = lerp(-1.9, 1.5, ee);
        armLiftR = lerp(0.85, -0.25, ee);
        elbowR = lerp(1.5, 0.12, ee);
        lean = lerp(lean - 0.1, lean + 0.34, ee);
        weaponSpin = lerp(-1.5, 2.4, ee);
        // The weight goes down and forward into the blow.
        crouch += 2.6 * ee;
        list -= 2.4 * ee;
      } else {
        const e = (k - 0.55) / 0.45;
        armSwingR = lerp(1.5, -0.1, e);
        armLiftR = lerp(-0.25, 0, e);
        elbowR = lerp(0.12, 0.5, e);
        lean = lerp(lean + 0.34, lean, e);
        weaponSpin = lerp(2.4, 0, e);
        crouch += 2.6 * (1 - e);
        list -= 2.4 * (1 - e);
      }
      break;
    }
    case 'attack2': {
      // Reverse sweep, so consecutive swings alternate.
      const k = at;
      // Same chain, wound the other way: the hips open first and drag the
      // shoulders round after them.
      twist += swingCurve(k, 0.5, -0.55);
      pelvis += swingCurve(Math.min(1, k + LEAD), 0.5, -0.55) * 0.8;
      if (k < 0.32) {
        const e = k / 0.32;
        armSwingR = lerp(armSwingR, 1.3, e);
        armLiftR = lerp(0, -0.5, e);
        elbowR = lerp(0.5, 1.3, e);
        weaponSpin = 2.2 * e;
      } else if (k < 0.52) {
        const e = (k - 0.32) / 0.2;
        const ee = e * e * (3 - 2 * e);
        armSwingR = lerp(1.3, -1.5, ee);
        armLiftR = lerp(-0.5, 0.7, ee);
        elbowR = lerp(1.3, 0.2, ee);
        lean += 0.3 * ee;
        weaponSpin = lerp(2.2, -1.9, ee);
        crouch += 2.2 * ee;
        list += 2.4 * ee;
      } else {
        const e = (k - 0.52) / 0.48;
        armSwingR = lerp(-1.5, -0.1, e);
        armLiftR = lerp(0.7, 0, e);
        elbowR = lerp(0.2, 0.5, e);
        weaponSpin = lerp(-1.9, 0, e);
        crouch += 2.2 * (1 - e);
        list += 2.4 * (1 - e);
      }
      break;
    }
    case 'thrust': {
      const k = at;
      twist += swingCurve(k, -0.35, 0.25);
      pelvis += swingCurve(Math.min(1, k + LEAD), -0.35, 0.25) * 0.8;
      if (k < 0.4) {
        const e = k / 0.4;
        armSwingR = lerp(armSwingR, -1.2, e);
        elbowR = lerp(0.5, 1.7, e);
      } else if (k < 0.55) {
        const e = (k - 0.4) / 0.15;
        armSwingR = lerp(-1.2, 0.15, e);
        elbowR = lerp(1.7, 0.02, e);
        // A lunge is the one attack whose whole point is the weight going
        // forward and down onto the front foot.
        lean += 0.4 * e;
        crouch += 3.4 * e;
      } else {
        const e = (k - 0.55) / 0.45;
        armSwingR = lerp(0.15, -0.1, e);
        elbowR = lerp(0.02, 0.5, e);
        lean += 0.4 * (1 - e);
        crouch += 3.4 * (1 - e);
      }
      break;
    }
    case 'cast': {
      const k = at;
      const up = Math.sin(clamp01(k * 1.6) * Math.PI);
      armLiftR = 1.1 * up;
      armLiftL = 1.1 * up;
      armSwingR = -0.5 * up;
      armSwingL = -0.5 * up;
      elbowR = elbowL = lerp(0.5, 1.1, up);
      lean -= 0.14 * up;
      break;
    }
    case 'hit': {
      const e = 1 - at;
      lean -= 0.42 * e * e;
      bob -= 2.5 * e;
      armSwingR += 0.5 * e;
      armSwingL += 0.5 * e;
      twist += 0.2 * e;
      // A blow does not fold a body straight backwards. It knocks it off its
      // own axis, and the recoil unloads one hip as the weight comes off it.
      roll += 0.22 * e * e;
      list -= 2.2 * e;
      break;
    }
    case 'dash': {
      lean += 0.55;
      crouch += 8;
      armSwingR = -1.1;
      armSwingL = 1.1;
      break;
    }
    case 'die': {
      // Falls the way it was hit. `dieBack` is +1 when the blow came from in
      // front and drove the body over backwards, -1 when it came from behind
      // and pitched it onto its face; everything a body does on the way down
      // reverses with it, so the two deaths do not read as the same animation
      // played twice.
      const back = st.dieBack ?? 1;
      crouch += at * hipH * 0.9;
      lean += at * 0.62 * back;
      armSwingR = lerp(armSwingR, 1.4 * back, at);
      armSwingL = lerp(armSwingL, 1.2 * back, at);
      twist += at * 0.34 * back;
      // Nothing falls squarely. The body rolls onto one hip on the way down,
      // which is what stops the death reading as a hinge.
      roll += at * 0.4 * back;
      list += at * 2.6 * back;
      break;
    }
    case 'roar': {
      const up = Math.sin(clamp01(at * 1.2) * Math.PI);
      armLiftR = 1.5 * up;
      armLiftL = 1.5 * up;
      armSwingR = -1.0 * up;
      armSwingL = -1.0 * up;
      lean -= 0.3 * up;
      break;
    }
  }

  const cl = Math.cos(lean);
  const sl = Math.sin(lean);
  const sr = Math.sin(roll);
  // The spine tilts forward about the hip and bends sideways with it, so
  // everything stacked above the pelvis — chest, neck, head, both shoulders —
  // travels together instead of the trunk pivoting inside a rigid body.
  const spine = (h) => {
    const dh = h - hipH;
    return [sl * dh, sr * dh, hipH + cl * dh + bob - crouch];
  };

  p.hip = [0, 0, hipH + bob - crouch];
  p.chest = spine(chestH);
  p.neck = spine(neckH);
  p.head = spine(headH);

  // The head rides quieter than the body carrying it. A walking figure's
  // pelvis rises and falls twice a stride; its head barely does, because the
  // neck spends the whole cycle paying that motion back to keep the eyes
  // level. Leaving the head welded to the top of the bob is what makes a
  // marching figure look like it is being bounced on a stick.
  const stabilise = bob * 0.45 * walkAmt;
  p.neck[2] -= stabilise * 0.55;
  p.head[2] -= stabilise;

  // Where the head is pointed, as an offset from where the body is pointed.
  //
  // A figure whose head is welded to its chest can only ever look where it is
  // walking. People do the opposite: the head goes first and the body follows
  // it round the corner, and a creature circling something keeps its eyes on
  // the thing it is circling however its feet are carrying it. `lookAt` is a
  // world angle the caller can aim; the neck will only give it so much before
  // the shoulders have to come too.
  let headYaw = clamp(turn * 0.09, -0.5, 0.5) - twist * 0.6;
  if (st.lookAt !== undefined) {
    let d = st.lookAt - (st.facing || 0);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    headYaw += clamp(d, -1.05, 1.05);
  } else if (walkAmt < 0.02) {
    // Standing, the head drifts around the way an idle person's does.
    headYaw += Math.sin(t * 0.31 + seed * 2.3) * 0.34;
  }
  p.headYaw = clamp(headYaw, -1.2, 1.2);

  const ct = Math.cos(twist);
  const stw = Math.sin(twist);
  const twistPt = (base, sideOff, ang) => {
    const c = ang === undefined ? ct : Math.cos(ang);
    const sn = ang === undefined ? stw : Math.sin(ang);
    return [base[0] - sn * sideOff, base[1] + c * sideOff, base[2]];
  };

  p.shoulderL = twistPt(p.chest, shoulderW);
  p.shoulderR = twistPt(p.chest, -shoulderW);
  p.hipL = twistPt(p.hip, hipW, pelvis);
  p.hipR = twistPt(p.hip, -hipW, pelvis);
  // The legs hang from where the hips would be with the pelvis level. If the
  // tilt drove them too, the standing leg would lift its own foot off the
  // ground every time the pelvis rolled over it — the tilt is the pelvis
  // moving *about* a planted leg, not with it.
  const legL = [p.hipL[0], p.hipL[1], p.hipL[2]];
  const legR = [p.hipR[0], p.hipR[1], p.hipR[2]];
  p.hipL[2] += list;
  p.hipR[2] -= list;
  // The waist and the crotch, which is where the pelvis gets drawn between.
  p.waist = twistPt([p.hip[0] + sl * 9, sr * 9, p.hip[2] + cl * 9], 0, pelvis);
  p.groin = [p.hip[0], 0, p.hip[2] - 7.5];

  // --- arms ----------------------------------------------------------------
  const arm = (sh, swing, lift, bend, side) => {
    // swing rotates in the forward/up plane, lift pushes the elbow outward.
    const a1 = swing - Math.PI / 2;
    const ex = sh[0] + Math.cos(a1) * upperArm * Math.cos(lift * 0.9);
    const ez = sh[2] + Math.sin(a1) * upperArm * Math.cos(lift * 0.9);
    const ey = sh[1] + side * Math.sin(lift) * upperArm * 0.9;
    const a2 = a1 + bend;
    const hx = ex + Math.cos(a2) * foreArm;
    const hz = ez + Math.sin(a2) * foreArm;
    const hy = ey + side * Math.sin(lift * 0.6) * foreArm * 0.5;
    return { elbow: [ex, ey, ez], hand: [hx, hy, hz], handAngle: a2 };
  };

  const aR = arm(p.shoulderR, armSwingR, armLiftR, elbowR, -1);
  const aL = arm(p.shoulderL, armSwingL, armLiftL, elbowL, 1);
  p.elbowR = aR.elbow;
  p.handR = aR.hand;
  p.elbowL = aL.elbow;
  p.handL = aL.hand;
  p.handAngleR = aR.handAngle;
  p.handAngleL = aL.handAngle;
  p.weaponSpin = weaponSpin;

  // --- legs ----------------------------------------------------------------
  //
  // The stride the caller is advancing the phase by, in character units. Half
  // of it is covered by each leg's stance, so the foot has to travel from a
  // quarter-stride in front of the hip to a quarter-stride behind it while it
  // is on the ground — at exactly the rate the body moves forward, which is
  // what makes it stay on its patch of earth instead of skating over it.
  const stride = strideChar(build);
  const reach = thigh + shin;
  const swingAmp = Math.min(0.95, Math.asin(Math.min(0.92, stride * 0.25 / reach)));
  // Below a slow walk the cycle blends out into the idle sway; a figure that
  // is barely moving has no gait worth planting.
  const gait = clamp01((walkAmt - 0.06) / 0.22);

  // Which leg is carrying the body while it stands: +1 the left, -1 the right.
  // The same slow oscillator the pelvis tilts with, so the loaded hip and the
  // straight leg are always the same one.
  const bearing = Math.sin(t * 0.42 + seed);

  const legPose = (hipPt, phase, side) => {
    let hipA;
    let kneeA;
    let liftZ = 0;
    // The ankle, in radians: positive is toes up, negative is heel up. A leg
    // that ends in a rigid plank is the last thing keeping a good walk from
    // reading as a real one — a foot lands on its heel, rolls flat under the
    // body, and leaves off the toe, and that roll is three quarters of what
    // the eye reads as "pushing off the ground".
    let ankle = 0;
    let splay = 0; // how far the foot sits out from under its hip
    if (anim === 'die') {
      const back = st.dieBack ?? 1;
      hipA = (-1.2 - side * 0.3) * back;
      kneeA = 0.9;
      ankle = -0.3 * back;
    } else if (anim === 'dash') {
      hipA = side > 0 ? -0.9 : 0.7;
      kneeA = 1.1;
      ankle = side > 0 ? 0.3 : -0.55;
    } else if (walkAmt > 0.01) {
      // Stance runs from 0 to π: the leg sweeps back through the whole stride
      // as a straight line in ground distance, not as a sine — a sine spends
      // most of the contact loitering near the extremes, which is exactly
      // where a real foot is moving fastest relative to the hip.
      const ph = ((phase % TAU) + TAU) % TAU;
      if (ph < Math.PI) {
        const k = ph / Math.PI;
        // sin(hipA) is what puts the foot forward or back, so the angle is the
        // arcsine of the linear ground position — the leg is a pendulum whose
        // tip has to move at constant speed.
        hipA = Math.asin(clamp(Math.sin(swingAmp) * (1 - 2 * k), -0.999, 0.999));
        // A trace of knee bend under load, and none of the lift: the foot is
        // on the ground.
        kneeA = 0.06 + Math.sin(ph) * 0.1;
        liftZ = 0;
        // Heel strike, roll to flat by a third of the way through, then the
        // heel comes up and the whole push happens over the toe.
        ankle = k < 0.32 ? lerp(0.36, 0, k / 0.32) : lerp(0, -0.62, (k - 0.32) / 0.68);
      } else {
        // Swing: the leg comes through fast, folds at the knee to clear the
        // ground, and reaches out to plant again.
        const k = (ph - Math.PI) / Math.PI;
        const e = k * k * (3 - 2 * k);
        hipA = Math.asin(clamp(Math.sin(swingAmp) * (2 * e - 1), -0.999, 0.999));
        kneeA = Math.sin(k * Math.PI) * 1.35;
        liftZ = Math.sin(k * Math.PI) * 4.5;
        // Off the toe, then the foot pulls up hard to clear the ground and
        // drops its toe again to meet it.
        ankle = k < 0.45 ? lerp(-0.62, 0.42, k / 0.45) : lerp(0.42, 0.36, (k - 0.45) / 0.55);
      }
      hipA *= gait;
      kneeA *= gait;
      liftZ *= gait;
      ankle *= gait;
      // The bad leg never straightens and never quite clears the ground.
      if (limp > 0 && side > 0) {
        kneeA += limp * 0.55 * gait;
        liftZ *= 1 - limp * 0.6;
        ankle = lerp(ankle, -0.1, limp * 0.7);
      }
      if (gait < 1) {
        hipA += Math.sin(t * 1.8 + side) * 0.02 * (1 - gait);
        kneeA += 0.06 * (1 - gait);
      }
    } else {
      // Standing. The leg the weight is on locks out straight and takes the
      // foot square under the hip; the free one softens at the knee, slides
      // out and forward, and rests on its heel. Which leg is which drifts
      // back and forth on the same slow clock the pelvis tilts on.
      const load = clamp01(side * bearing * 1.6); // 1 loaded, 0 free
      hipA = Math.sin(t * 1.8 + side) * 0.02 + (1 - load) * 0.17;
      kneeA = 0.05 + (1 - load) * 0.3;
      ankle = (1 - load) * 0.2;
      splay = (1 - load) * 2.4;
    }
    const a1 = hipA - Math.PI / 2;
    const kx = hipPt[0] + Math.cos(a1) * thigh;
    const kz = hipPt[2] + Math.sin(a1) * thigh;
    // Knees flex backwards, so the shin rotates the opposite way to the thigh.
    const a2 = a1 - kneeA;
    const fx = kx + Math.cos(a2) * shin;
    const fz = Math.max(0, kz + Math.sin(a2) * shin) + liftZ;
    const fy = hipPt[1] + side * splay;
    return { knee: [kx, lerp(hipPt[1], fy, 0.4), kz], foot: [fx, fy, fz], ankle };
  };

  const lL = legPose(legL, runPhase, 1);
  const lR = legPose(legR, runPhase + Math.PI, -1);
  p.kneeL = lL.knee;
  p.footL = lL.foot;
  p.kneeR = lR.knee;
  p.footR = lR.foot;
  p.ankleL = lL.ankle;
  p.ankleR = lR.ankle;

  return p;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function shadeFor(depth, base, dark, light) {
  // depth: -1 far, +1 near. Far limbs sink into shadow, near limbs catch light.
  const t = clamp01(0.5 + clamp(depth * 0.8, -0.5, 0.5));
  return mixc(dark, mixc(base, light, clamp01((t - 0.58) * 1.8)), clamp01(t * 1.5));
}

// The key light. Diablo II's sprites were pre-rendered under one fixed lamp
// up and to the left, and every frame of every unit agreed about it — which
// is most of why a screen full of unrelated monsters still looked like one
// photograph. Nothing here is allowed to disagree with this vector.
let KEY_X = -0.62;
let KEY_Y = -0.78;

/**
 * Points the key light at whatever is actually burning nearby.
 *
 * Diablo II baked its lighting into the sprites, so a character's highlight
 * never moved — the trade it made for pre-rendered detail. We draw the rig
 * live, so we can do the thing it could not: when you walk past a fire the
 * hot edge crosses the armour and settles on the side facing the flame.
 * Callers set this per actor, in screen space, before drawing.
 */
export function setKeyLight(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) {
    KEY_X = -0.62;
    KEY_Y = -0.78;
    return;
  }
  KEY_X = dx / len;
  KEY_Y = dy / len;
}

/**
 * Paints a limb as a lit cylinder instead of a flat pill.
 *
 * A gradient is run across the limb's short axis — the direction the surface
 * normal actually turns — from a near-black terminator on the shadow side,
 * through the body colour, to a narrow hot band where the key light grazes
 * it. The band is deliberately narrow and bright: broad soft shading reads as
 * clay, while a tight specular reads as metal or oiled leather, and at this
 * resolution that contrast is the only thing carrying the form.
 */
function cylinderFill(ctx, x0, y0, x1, y1, r0, r1, base, dark, light, spec) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1e-4;
  // Short axis of the limb, pointed into the key light.
  let nx = -dy / len;
  let ny = dx / len;
  if (nx * KEY_X + ny * KEY_Y < 0) {
    nx = -nx;
    ny = -ny;
  }
  const mx = (x0 + x1) * 0.5;
  const my = (y0 + y1) * 0.5;
  const r = Math.max(r0, r1);
  const g = ctx.createLinearGradient(mx - nx * r, my - ny * r, mx + nx * r, my + ny * r);

  // The ramp that makes a shape read as a solid object rather than a painted
  // one. A plain light-to-dark gradient looks like paper because real
  // surfaces do not get steadily darker — they reach a *core shadow* just
  // inside the shadow edge and then come back up, because light bouncing off
  // whatever the object is standing on hits the far edge. That bounce is the
  // whole trick: without it a limb is a shaded disc, with it the eye reads a
  // cylinder it could put a hand around.
  g.addColorStop(0.0, css(mixc(dark, base, 0.28))); // reflected light
  g.addColorStop(0.13, css(dark)); // core shadow, the darkest band
  g.addColorStop(0.3, css(mixc(dark, base, 0.72)));
  g.addColorStop(0.52, css(base));
  g.addColorStop(0.76, css(light));
  g.addColorStop(0.88, css(spec)); // the hot line where the light grazes
  g.addColorStop(1.0, css(mixc(light, base, 0.5))); // turning away again
  return g;
}

/**
 * Shades a sphere the way a sphere actually behaves: the highlight sits off
 * the centre towards the light, the terminator is a curve rather than a
 * straight edge, and the shadow side lifts again at the rim. Used for heads,
 * joints and helm crowns — anything the eye expects to be round.
 */
function sphereFill(ctx, cx, cy, r, base, dark, light, spec) {
  const lx = cx + KEY_X * r * 0.52;
  const ly = cy + KEY_Y * r * 0.52;
  const g = ctx.createRadialGradient(lx, ly, r * 0.04, cx - KEY_X * r * 0.3, cy - KEY_Y * r * 0.3, r * 1.32);
  g.addColorStop(0, css(spec));
  g.addColorStop(0.16, css(light));
  g.addColorStop(0.42, css(base));
  g.addColorStop(0.72, css(mixc(base, dark, 0.8)));
  g.addColorStop(0.88, css(dark));
  g.addColorStop(1, css(mixc(dark, base, 0.34))); // rim bounce
  return g;
}

/**
 * Occlusion where two parts meet. Everywhere one form enters another there is
 * a tight pool of darkness, and it is the single cheapest thing that stops a
 * figure looking like separate pieces laid on top of each other.
 */
function contactAO(ctx, x, y, r, strength = 0.5) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(6,5,7,${strength})`);
  g.addColorStop(0.55, `rgba(6,5,7,${(strength * 0.45).toFixed(3)})`);
  g.addColorStop(1, 'rgba(6,5,7,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/**
 * Draws one articulated actor.
 *  ctx      target 2D context (screen space, already at device pixels)
 *  def      appearance definition
 *  st       animation state { t, anim, animT, facing, speed, phase, flash, alpha }
 *  px, py   screen position of the actor's feet
 *  s        pixels per character unit
 *  emis     optional (x, y, r, colour, alpha) callback for the bloom buffer
 */
export function drawActor(ctx, def, st, px, py, s, emis) {
  const facing = st.facing || 0;
  const cosF = Math.cos(facing);
  const sinF = Math.sin(facing);
  const build = def.build || {};
  const p = def.pose ? def.pose(st, build) : poseHumanoid(st, build);

  // Project every joint once.
  const P = {};
  const D = {};
  for (const k in p) {
    const v = p[k];
    if (!Array.isArray(v)) continue;
    const r = rot(v, cosF, sinF);
    P[k] = [px + r[0] * s, py + (r[1] * ISO_Y - r[2]) * s];
    D[k] = r[1] / 20; // depth, roughly -1..1
  }
  P.__spin = p.weaponSpin || 0;

  // The head has its own heading. Everything that belongs to the face — the
  // features, the visor slot, the eye glow, a hood's opening — is drawn
  // against these instead of the body's, so the skull can turn on the neck.
  const hFace = facing + (p.headYaw || 0);
  const hcos = Math.cos(hFace);
  const hsin = Math.sin(hFace);

  const flash = st.flash || 0;
  const alpha = st.alpha ?? 1;
  const tint = (c) => (flash > 0 ? mixc(c, [255, 236, 220], flash) : c);

  const rimC = def.rim || PAL.moon;
  const rimA = (def.rimA ?? 0.5) * (1 - flash * 0.6);

  ctx.save();
  if (alpha < 1) ctx.globalAlpha = alpha;

  // A bone: rim ghost first, then the body. The sliver of rim that survives
  // on the upper-left edge is the moon catching the figure.
  // Three tones per limb: moon rim on the upper-left edge, the body colour,
  // and a soft highlight inset from that edge. Flat capsules look like toys;
  // these read as cylinders.
  // A dark contour under every limb. Diablo II's units sat on busy ground and
  // stayed legible because the palette gave them a near-black edge; without
  // one, a figure at this pixel size dissolves into whatever it stands on.
  const contour = [8, 7, 9];

  const bone = (a, b, r0, r1, base, dark, light, depth, bands = 0, belly = 0, mid = 0.42) => {
    const A = P[a];
    const B = P[b];
    if (!A || !B) return;
    // Silhouette, slightly fatter than the limb, so the edge survives.
    capsule(ctx, A[0], A[1], B[0], B[1], r0 * s + 1, r1 * s + 1, belly, mid);
    ctx.fillStyle = css(contour, 0.85);
    ctx.fill();

    const d = clamp01(0.5 + clamp(depth * 0.8, -0.5, 0.5));
    // Far limbs lose the highlight and sink towards the contour; near limbs
    // get the full ramp. This is what keeps a swinging arm readable against
    // the torso it crosses.
    const b0 = tint(mixc(dark, base, 0.35 + d * 0.65));
    const bd = tint(mixc(contour, dark, 0.55 + d * 0.3));
    const bl = tint(mixc(base, light, 0.45 + d * 0.5));
    const bs = tint(mixc(light, [255, 250, 236], 0.3 * d));
    capsule(ctx, A[0], A[1], B[0], B[1], r0 * s, r1 * s, belly, mid);
    ctx.fillStyle = cylinderFill(ctx, A[0], A[1], B[0], B[1], r0 * s, r1 * s, b0, bd, bl, bs);
    ctx.fill();

    // Banding. A limb in armour is not one smooth tube — it is a stack of
    // lames, and the dark seam between each with a lit lip above it is what
    // separates a knight's arm from a sausage. Only armoured parts ask for
    // it; bare skin and cloth stay smooth.
    if (bands > 0) {
      ctx.save();
      capsule(ctx, A[0], A[1], B[0], B[1], r0 * s, r1 * s, belly, mid);
      ctx.clip();
      const dx = B[0] - A[0];
      const dy = B[1] - A[1];
      const len = Math.hypot(dx, dy) || 1e-4;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy * r0 * s * 1.6;
      const ny = ux * r0 * s * 1.6;
      for (let i = 1; i <= bands; i++) {
        const t = i / (bands + 1);
        const cx = A[0] + dx * t;
        const cy = A[1] + dy * t;
        ctx.strokeStyle = 'rgba(7,6,8,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - nx, cy - ny);
        ctx.lineTo(cx + nx, cy + ny);
        ctx.stroke();
        ctx.strokeStyle = css(tint(light), 0.4);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - nx - ux * 1.6, cy - ny - uy * 1.6);
        ctx.lineTo(cx + nx - ux * 1.6, cy + ny - uy * 1.6);
        ctx.stroke();
      }
      ctx.restore();
    }

    // The moon catching the top-left edge, on top of the key light.
    if (rimA > 0.01) {
      capsule(ctx, A[0] - 1.2, A[1] - 1.8, B[0] - 1.2, B[1] - 1.8, r0 * s * 0.42, r1 * s * 0.42);
      ctx.fillStyle = css(tint(rimC), rimA * 0.5);
      ctx.fill();
    }
  };

  /**
   * A cop: the hard disc capping an elbow or a knee. Real armour puts a
   * separate, more domed plate over every joint, and at a distance that disc
   * is what tells you the limb bends there instead of just tapering.
   */
  const cop = (joint, r, depth) => {
    const J = P[joint];
    if (!J) return;
    const rr = r * s;
    // The joint sits in a pocket of its own shadow before the plate goes on.
    contactAO(ctx, J[0], J[1], rr * 1.5, 0.4);
    ctx.beginPath();
    ctx.ellipse(J[0], J[1], rr, rr * 0.92, 0, 0, TAU);
    ctx.fillStyle = css(contour, 0.9);
    ctx.fill();
    const d = clamp01(0.5 + clamp(depth * 0.8, -0.5, 0.5));
    const mBase = tint(M.metal || M.arms);
    const mLight = tint(mixc(M.metalLight || M.armsLight, [255, 250, 240], 0.2 * d));
    const mDark = tint(mixc(M.metalDark || M.armsDark, contour, 0.55));
    const mSpec = tint(mixc(M.metalLight || M.armsLight, [255, 255, 250], 0.55));
    ctx.beginPath();
    ctx.ellipse(J[0], J[1], rr * 0.82, rr * 0.76, 0, 0, TAU);
    ctx.fillStyle = sphereFill(ctx, J[0], J[1], rr * 0.82, mBase, mDark, mLight, mSpec);
    ctx.fill();
  };

  const M = def.colors;

  // Draw order: whatever is furthest from the camera goes first.
  const parts = [];
  const push = (depth, fn) => parts.push({ d: depth, fn });

  if (def.quiver) push(-2.4, () => drawQuiver(ctx, P, def, s, cosF, sinF, tint));

  // Cloak behind the body
  if (def.cape) {
    push(-2, () => drawCape(ctx, P, D, def, st, s, cosF, sinF, px, py, tint));
  }

  // Legs
  const legOrder = D.hipL > D.hipR ? ['R', 'L'] : ['L', 'R'];
  for (const side of legOrder) {
    push(D['hip' + side] - 0.4, () => {
      const lw = def.limbScale ?? 1;
      const legPlate = def.pauldrons ? 2 : 0;
      const HP = P['hip' + side];
      // The body casts down onto the top of the thigh — a real form shadow,
      // not just a darker paint, which is what tells you the torso is in
      // front of the leg and above it.
      if (HP) contactAO(ctx, HP[0], HP[1] - 1 * s, 10 * s * lw, 0.5);
      // A thigh carries its mass high and a calf higher still; both run out to
      // almost nothing at the joint below. Armour flattens the swell — a
      // cuisse is a shell over the leg, not the leg — so plated figures get
      // about half as much of it.
      const soft = legPlate ? 0.5 : 1;
      bone('hip' + side, 'knee' + side, 6.6 * lw, 5 * lw, M.legs, M.legsDark, M.legsLight, D['hip' + side], legPlate, 0.17 * soft, 0.3);
      if (legPlate) cop('knee' + side, 4.5 * lw, D['hip' + side]);
      bone('knee' + side, 'foot' + side, 5 * lw, 3.5 * lw, M.legs, M.legsDark, M.legsLight, D['hip' + side], legPlate, 0.24 * soft, 0.26);
      drawBoot(ctx, P['foot' + side], def, s, lw, cosF, tint, D['hip' + side], contour, p['ankle' + side] || 0);
    });
  }

  // Far arm
  const armFar = D.shoulderL < D.shoulderR ? 'L' : 'R';
  const armNear = armFar === 'L' ? 'R' : 'L';

  const drawArm = (side) => {
    const lw = def.limbScale ?? 1;
    const plated = def.pauldrons ? 2 : 0;
    // Where the arm enters the body. Without this the limb reads as laid on
    // top of the chest rather than socketed into it.
    const SH = P['shoulder' + side];
    if (SH) contactAO(ctx, SH[0], SH[1] + 2 * s, 9 * s * lw, 0.42);
    // Deltoid and biceps high on the upper arm; the forearm's mass sits just
    // below the elbow and runs out to a narrow wrist.
    const soft = plated ? 0.5 : 1;
    bone('shoulder' + side, 'elbow' + side, 5 * lw, 4 * lw, M.arms, M.armsDark, M.armsLight, D['shoulder' + side], plated, 0.2 * soft, 0.34);
    if (plated) cop('elbow' + side, 3.8 * lw, D['shoulder' + side]);
    bone('elbow' + side, 'hand' + side, 4 * lw, 3 * lw, M.arms, M.armsDark, M.armsLight, D['shoulder' + side], plated, 0.16 * soft, 0.28);

    // Spaulder. Two overlapping lames with straight edges and a hard ridge
    // along the top, rather than the pale sphere this used to be — a sphere
    // has no direction, and armour is the most directional thing a figure
    // wears.
    if (def.pauldrons) {
      const S = P['shoulder' + side];
      const w = 8.6 * s * lw;
      const h = 6.2 * s * lw;
      const d = clamp01(0.5 + clamp((D['shoulder' + side] + 0.3) * 0.8, -0.5, 0.5));
      for (let lame = 1; lame >= 0; lame--) {
        const k = 1 - lame * 0.18;
        const oy = lame * h * 0.52;
        ctx.beginPath();
        ctx.moveTo(S[0] - w * k, S[1] - h * 0.15 + oy);
        ctx.lineTo(S[0] - w * k * 0.72, S[1] - h * 0.78 + oy);
        ctx.lineTo(S[0] + w * k * 0.62, S[1] - h * 0.66 + oy);
        ctx.lineTo(S[0] + w * k, S[1] + h * 0.1 + oy);
        ctx.lineTo(S[0] + w * k * 0.66, S[1] + h * 0.62 + oy);
        ctx.lineTo(S[0] - w * k * 0.78, S[1] + h * 0.5 + oy);
        ctx.closePath();
        ctx.strokeStyle = css(contour, 0.9);
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.stroke();
        const g = ctx.createLinearGradient(S[0] - w, S[1] - h, S[0] + w * 0.7, S[1] + h);
        g.addColorStop(0, css(tint(mixc(M.metalLight, [255, 250, 240], 0.3 * d))));
        g.addColorStop(0.34, css(tint(M.metal)));
        g.addColorStop(1, css(tint(mixc(M.metalDark, contour, 0.55))));
        ctx.fillStyle = g;
        ctx.fill();
        // The ridge along the top edge — a single bright line does more for
        // "this is steel" than any amount of soft shading underneath it.
        ctx.beginPath();
        ctx.moveTo(S[0] - w * k * 0.94, S[1] - h * 0.2 + oy);
        ctx.lineTo(S[0] - w * k * 0.7, S[1] - h * 0.74 + oy);
        ctx.lineTo(S[0] + w * k * 0.58, S[1] - h * 0.62 + oy);
        ctx.strokeStyle = css(tint(mixc(M.metalLight, [255, 255, 250], 0.5)), 0.75);
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      if (def.runes) {
        ctx.beginPath();
        ctx.ellipse(S[0], S[1] - 1.5 * s, w, h, 0, 0.5, Math.PI - 0.5);
        ctx.strokeStyle = css(def.runes.color, 0.8);
        ctx.lineWidth = 1.3 * s;
        ctx.stroke();
      }
    }

    // Hand.
    //
    // A hand was a circle, or later a four-sided plate, and at the size the
    // figures are drawn now that is the first thing the eye catches as wrong:
    // it is the one part of a body that is unmistakably made of separate
    // pieces, and reading it as a mitten flattens the whole arm. So it is
    // built the way a hand is built — a palm block, four fingers laid across
    // it in segments, a thumb set apart at an angle, and knuckles where they
    // hinge. Every piece takes its own light from the same lamp as the rest.
    const Hd = P['hand' + side];
    drawHand(ctx, Hd, P['elbow' + side], def, s, lw, tint, D['shoulder' + side]);
  };

  push(D['shoulder' + armFar] - 0.3, () => drawArm(armFar));

  // Pelvis, torso, head. The pelvis goes on before the trunk so the belt line
  // is the trunk's own bottom edge rather than a band stuck over it.
  push(0, () => {
    drawPelvis(ctx, P, D, def, s, tint, contour);
    drawTorso(ctx, P, D, def, s, tint, rimC, rimA, emis, cosF, sinF);
    drawNeck(ctx, P, def, s, tint);
    drawHead(ctx, P, D, def, st, s, hcos, hsin, tint, emis, rimC, rimA);
  });

  // Cloth that hangs from the belt: a surcoat, a robe's skirt, a kilt of
  // rags. Over the pelvis and the near leg, under the arms and whatever they
  // are carrying.
  if (def.skirt) push(0.12, () => drawSkirt(ctx, P, D, def, st, s, cosF, sinF, tint, contour));

  // Near arm and whatever it's holding
  push(D['shoulder' + armNear] + 0.4, () => {
    if (def.offhand && def.offhand !== 'none') {
      const oh = def.weaponHand === 'L' ? 'R' : 'L';
      if (oh === armNear) drawOffhand(ctx, P, D, def, st, s, cosF, sinF, tint, emis);
    }
    drawArm(armNear);
  });

  if (def.carapace) {
    // Above both arms in the sort: a crustacean's shell is the outside of it,
    // and everything else — head, limbs, claw — comes out from underneath.
    push(1.2, () => drawCarapace(ctx, P, def, s, tint));
  }

  const wHand = def.weaponHand || 'R';
  push(D['shoulder' + wHand] + 0.6, () => {
    if (def.weapon && def.weapon !== 'none') {
      drawWeapon(ctx, P, D, def, st, s, cosF, sinF, tint, emis);
    }
    if (def.offhand && def.offhand !== 'none') {
      const oh = wHand === 'L' ? 'R' : 'L';
      if (oh === armFar) drawOffhand(ctx, P, D, def, st, s, cosF, sinF, tint, emis);
    }
  });

  parts.sort((a, b) => a.d - b.d);
  for (const part of parts) part.fn();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Body pieces
// ---------------------------------------------------------------------------

/**
 * Carved sigils that glow through the armour. Drawn in the torso's local
 * frame: `u` runs across the chest, `v` from collar (0) to belt (1).
 */
function drawRunes(ctx, P, def, s, emis) {
  const R = def.runes;
  const shL = P.shoulderL;
  const shR = P.shoulderR;
  const hipL = P.hipL;
  const hipR = P.hipR;
  const at = (u, v) => [
    lerp(lerp(shL[0], shR[0], u), lerp(hipL[0], hipR[0], u), v),
    lerp(lerp(shL[1], shR[1], u), lerp(hipL[1], hipR[1], u), v),
  ];
  // Two columns of short strokes — a lightning ladder, not readable script.
  const strokes = [
    [0.5, 0.18, 0, -3.2, 0, 3.2],
    [0.5, 0.18, 0, -3.2, -2.6, -0.4],
    [0.5, 0.18, 0, -3.2, 2.6, -0.4],
    [0.36, 0.42, 0, -2.6, 2.2, 0],
    [0.36, 0.42, 2.2, 0, 0, 2.6],
    [0.64, 0.42, 0, -2.6, -2.2, 0],
    [0.64, 0.42, -2.2, 0, 0, 2.6],
    [0.5, 0.66, -2.4, -2.2, 0, 0],
    [0.5, 0.66, 0, 0, 2.4, 2.2],
    [0.5, 0.66, 0, 0, 2.4, -2.2],
  ];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // A dark groove under the light sells the idea that the metal is cut, not
  // painted; the glow then looks like something behind the plate.
  for (const pass of [
    [css(PAL.orderBlack ?? [0, 0, 0], 0.55), 2.6, 1.2, 1.2],
    [css(R.color, 0.95), 1.5, 0, 0],
  ]) {
    ctx.strokeStyle = pass[0];
    ctx.lineWidth = pass[1] * s;
    for (const [u, v, ax, ay, bx, by] of strokes) {
      const o = at(u, v);
      ctx.beginPath();
      ctx.moveTo(o[0] + ax * s + pass[2], o[1] + ay * s + pass[3]);
      ctx.lineTo(o[0] + bx * s + pass[2], o[1] + by * s + pass[3]);
      ctx.stroke();
    }
  }
  if (emis) {
    const c = at(0.5, 0.42);
    emis(c[0], c[1], 16 * s, R.color, R.glow ?? 0.5);
  }
}

/**
 * A boot.
 *
 * The leg used to end in a flat ellipse laid on the ground, which is a shadow,
 * not a foot — and it is the last thing in the figure the eye travels to
 * before it reaches the mud, so it decides whether the character is standing
 * on the ground or floating over it. A boot has three parts worth drawing at
 * this size: a sole that meets the earth in a hard dark line, an upper that
 * turns over the toes, and a cuff where the leg goes in. The toe points where
 * the figure faces, so a turning character's feet turn with it.
 */
function drawBoot(ctx, F, def, s, lw, cosF, tint, depth, contour, ankle = 0) {
  if (!F) return;
  const M = def.colors;
  const base = tint(shadeFor(depth, M.boots, M.legsDark, M.legsLight));
  const lit = tint(mixc(M.boots, M.legsLight, 0.5));
  const len = 7.4 * s * lw;
  // The boot is drawn in profile with its toe out along +x, and mirrored to
  // face the way the figure does. It used to be drawn pointing right whatever
  // the character was doing, so half the compass had a knight walking one way
  // on feet aimed the other — the sort of thing nobody names and everybody
  // sees. `fore` is how much of the foot's length survives the projection:
  // side on it is the whole boot, coming at the camera it is a stub.
  const dir = cosF < 0 ? -1 : 1;
  const fore = Math.abs(cosF);
  const toe = fore * len * 0.55;

  ctx.save();
  ctx.translate(F[0], F[1]);
  ctx.scale(dir, 1);

  // Heel strike and toe-off. The foot pivots on whichever end is still on the
  // ground — the heel when the toes are up, the toes when the heel is up —
  // and only as far as the projection lets you see it, so a figure walking
  // towards the camera does not waggle its boot at you.
  if (Math.abs(ankle) > 0.01) {
    const pivot = ankle > 0 ? -len * 0.5 : len * 0.6 + toe;
    ctx.translate(pivot, 1.1 * s);
    ctx.rotate(-ankle * 0.5 * fore);
    ctx.translate(-pivot, -1.1 * s);
  }

  // Sole: flat on the ground, longer than the boot above it, near-black. This
  // is the line that puts the figure on the floor.
  ctx.beginPath();
  ctx.ellipse(toe * 0.9, 1.1 * s, len * 0.95, 3.1 * s * lw, 0, 0, TAU);
  ctx.fillStyle = css(contour, 0.9);
  ctx.fill();

  // Upper: the mass of the boot, rolling from the ankle down over the toes.
  ctx.beginPath();
  ctx.moveTo(-len * 0.52, -0.6 * s);
  ctx.quadraticCurveTo(-len * 0.6, -4.4 * s * lw, -len * 0.1, -5 * s * lw);
  ctx.quadraticCurveTo(len * 0.34 + toe * 0.3, -4.6 * s * lw, len * 0.62 + toe, -1.4 * s * lw);
  ctx.quadraticCurveTo(len * 0.86 + toe, 0.6 * s, len * 0.5 + toe, 1.2 * s);
  ctx.lineTo(-len * 0.46, 1.2 * s);
  ctx.closePath();
  const g = ctx.createLinearGradient(-len * 0.5, -5 * s, len * 0.6, 1.5 * s);
  g.addColorStop(0, css(lit));
  g.addColorStop(0.45, css(base));
  g.addColorStop(1, css(tint(mixc(M.boots, contour, 0.6))));
  ctx.fillStyle = g;
  ctx.fill();

  // Cuff: a band of leather turned over at the top, and the seam under it.
  ctx.beginPath();
  ctx.ellipse(-len * 0.05, -4.6 * s * lw, len * 0.44, 1.7 * s * lw, 0, 0, TAU);
  ctx.fillStyle = css(tint(mixc(M.boots, M.legsLight, 0.34)));
  ctx.fill();
  ctx.strokeStyle = css(contour, 0.55);
  ctx.lineWidth = Math.max(0.7, 0.8 * s);
  ctx.stroke();

  // A lit lip along the top of the toe box, which is what makes it leather
  // rather than a wedge of colour.
  ctx.strokeStyle = css(lit, 0.5);
  ctx.lineWidth = Math.max(0.7, 0.9 * s);
  ctx.beginPath();
  ctx.moveTo(-len * 0.12, -4.6 * s * lw);
  ctx.quadraticCurveTo(len * 0.34 + toe * 0.3, -4.2 * s * lw, len * 0.58 + toe, -1.5 * s * lw);
  ctx.stroke();
  ctx.restore();
}

/**
 * The pelvis, and the belt across it.
 *
 * The rig had a waist and it had two legs and there was nothing between them:
 * the torso stopped at a flat line and two tubes came out of the bottom of it.
 * That gap is why the figures read as a doll with the legs pushed into a body
 * — a real pelvis is a solid, and the heaviest solid in the whole figure. It
 * is a wedge, wide at the belt and narrowing to the crotch, with the thighs
 * hanging off its outside corners, and it is the piece the eye uses to tell
 * whether a body has weight on it.
 *
 * Drawn between the legs and the torso, and rotated with the hips rather than
 * the shoulders, so a walking figure's waist visibly winds against its chest.
 */
function drawPelvis(ctx, P, D, def, s, tint, contour) {
  const L = P.hipL;
  const R = P.hipR;
  const G = P.groin;
  if (!L || !R || !G) return;
  const M = def.colors;
  const lw = def.limbScale ?? 1;
  const wide = (def.torsoWide ?? 1) * lw;

  // Corners: the belt line is a little wider than the hip joints, and the
  // crotch sits below and between them.
  const ox = (R[0] - L[0]) * 0.16;
  const oy = (R[1] - L[1]) * 0.16;
  const lx = L[0] - ox;
  const ly = L[1] - oy - 1.2 * s;
  const rx = R[0] + ox;
  const ry = R[1] + oy - 1.2 * s;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.quadraticCurveTo(rx + ox * 0.5, ry + (G[1] - ry) * 0.55, G[0] + (rx - G[0]) * 0.34, G[1]);
  ctx.quadraticCurveTo(G[0], G[1] + 1.2 * s, G[0] + (lx - G[0]) * 0.34, G[1]);
  ctx.quadraticCurveTo(lx - ox * 0.5, ly + (G[1] - ly) * 0.55, lx, ly);
  ctx.closePath();
  ctx.strokeStyle = css(contour, 0.85);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const d = clamp01(0.5 + clamp(D.hip * 0.8, -0.5, 0.5));
  const g = ctx.createLinearGradient(lx + KEY_X * 8 * s, ly + KEY_Y * 8 * s, G[0] - KEY_X * 6 * s, G[1]);
  g.addColorStop(0, css(tint(mixc(M.legsLight, [255, 248, 232], 0.2 * d))));
  g.addColorStop(0.4, css(tint(M.legs)));
  g.addColorStop(1, css(tint(mixc(M.legsDark, contour, 0.4))));
  ctx.fillStyle = g;
  ctx.fill();

  // The seam where the legs part, and the pool of shadow it sits in. Two
  // strokes, and the wedge stops being a plate and becomes a body.
  ctx.beginPath();
  ctx.moveTo(G[0], G[1]);
  ctx.lineTo((lx + rx) * 0.5, (ly + ry) * 0.5 + 1.5 * s);
  ctx.strokeStyle = 'rgba(8,7,9,0.45)';
  ctx.lineWidth = Math.max(0.8, 1.1 * s);
  ctx.stroke();
  contactAO(ctx, G[0], G[1] - 1 * s, 7 * s * wide, 0.36);

  // The belt. Every figure in the game has one — a line across the waist is
  // how a garment gets divided into a top and a bottom at all — and it is the
  // cheapest possible way to read the pelvis as separate from the chest.
  const bw = 2.6 * s * wide;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.lineTo(rx, ry + bw);
  ctx.lineTo(lx, ly + bw);
  ctx.closePath();
  const bg = ctx.createLinearGradient(lx, ly, lx, ly + bw);
  const belt = tint(M.belt || M.boots || M.legsDark);
  bg.addColorStop(0, css(mixc(belt, [255, 240, 210], 0.35)));
  bg.addColorStop(0.5, css(belt));
  bg.addColorStop(1, css(mixc(belt, contour, 0.6)));
  ctx.fillStyle = bg;
  ctx.fill();

  // A buckle, only when there is a front to hang it on.
  const bx = (lx + rx) * 0.5;
  const by = (ly + ry) * 0.5;
  ctx.beginPath();
  ctx.rect(bx - 1.5 * s, by + bw * 0.1, 3 * s, bw * 0.8);
  ctx.fillStyle = css(tint(mixc(M.metal || M.legsLight, [255, 246, 220], 0.3)), 0.9);
  ctx.fill();
  ctx.strokeStyle = css(contour, 0.7);
  ctx.lineWidth = Math.max(0.6, 0.7 * s);
  ctx.stroke();
  ctx.restore();
}

/**
 * One hand, articulated.
 *
 * Oriented along the forearm so the fingers point away from the elbow — a
 * hand drawn axis-aligned reads as a paddle stuck on the end of the arm no
 * matter how much detail it carries. Armoured hands get plate lames with
 * hard seams; bare hands get soft segments and a visible thumb pad. The
 * whole thing is drawn in the limb's own local frame and then rotated, which
 * keeps the finger seams parallel to the fingers instead of to the screen.
 */
function drawHand(ctx, Hd, Elb, def, s, lw, tint, depth) {
  if (!Hd) return;
  const M = def.colors;
  const armoured = !!def.pauldrons;
  // One hand unit: roughly a finger's width. It used to be 3.1, which built a
  // hand as wide as the figure's own head — anatomically a hand is about the
  // height of a face, and this rig draws it splayed rather than in profile, so
  // it was reading as a boxing glove on the end of every arm. Two thirds the
  // size puts it back in proportion and lets the fingers stay separate.
  const u = 2.15 * s * lw;
  const contour = [8, 7, 9];

  // Point the hand away from the elbow.
  let ang = Math.PI / 2;
  if (Elb) ang = Math.atan2(Hd[1] - Elb[1], Hd[0] - Elb[0]);

  const d = clamp01(0.5 + clamp(depth * 0.8, -0.5, 0.5));
  const base = tint(armoured ? M.metal || M.arms : M.hands || M.skin || M.arms);
  const dark = tint(mixc(armoured ? M.metalDark || M.armsDark : M.skinDark || M.armsDark, contour, 0.45));
  const light = tint(
    mixc(armoured ? M.metalLight || M.armsLight : M.skinLight || M.armsLight, [255, 250, 240], 0.18 * d)
  );

  ctx.save();
  ctx.translate(Hd[0], Hd[1]);
  ctx.rotate(ang);
  ctx.lineJoin = 'round';

  // Everything below is in hand-local space: +x runs out to the fingertips,
  // +y across the knuckles.
  const plate = (x0, y0, w, h, r, fill) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, r);
    else ctx.rect(x0, y0, w, h);
    ctx.strokeStyle = css(contour, 0.9);
    ctx.lineWidth = Math.max(0.8, u * 0.22);
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  const ramp = (x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, css(light));
    g.addColorStop(0.45, css(base));
    g.addColorStop(1, css(dark));
    return g;
  };

  // Wrist cuff, behind everything.
  plate(-u * 1.5, -u * 0.95, u * 0.9, u * 1.9, u * 0.25, ramp(-u * 1.5, -u, -u * 0.6, u));

  // Palm.
  plate(-u * 0.8, -u * 0.85, u * 1.7, u * 1.7, u * 0.3, ramp(-u * 0.8, -u * 0.85, u * 0.9, u * 0.85));

  // Thumb, set below the palm and angled off it. Without the thumb a hand is
  // a glove; with it the pose reads as a grip.
  ctx.save();
  ctx.translate(-u * 0.4, u * 0.75);
  ctx.rotate(0.75);
  plate(0, -u * 0.34, u * 1.25, u * 0.68, u * 0.3, ramp(0, -u * 0.34, u, u * 0.34));
  ctx.restore();

  // Four fingers across the knuckles, each in two segments, each shorter and
  // set slightly further back than the one before — the fan that makes a
  // hand read as a hand.
  for (let f = 0; f < 4; f++) {
    const y = -u * 0.72 + f * u * 0.48;
    const shrink = f === 3 ? 0.78 : 1 - Math.abs(f - 1) * 0.06;
    const x0 = u * 0.85 - (f === 3 ? u * 0.16 : 0);
    const segA = u * 0.62 * shrink;
    const segB = u * 0.5 * shrink;
    plate(x0, y - u * 0.2, segA, u * 0.4, u * 0.18, ramp(x0, y - u * 0.2, x0 + segA, y + u * 0.2));
    plate(
      x0 + segA + u * 0.06,
      y - u * 0.18,
      segB,
      u * 0.36,
      u * 0.16,
      ramp(x0 + segA, y - u * 0.18, x0 + segA + segB, y + u * 0.18)
    );
    // Knuckle: a small dome where the finger hinges on the palm.
    if (armoured) {
      ctx.beginPath();
      ctx.arc(x0 - u * 0.04, y, u * 0.2, 0, TAU);
      ctx.fillStyle = css(mixc(light, [255, 255, 250], 0.3));
      ctx.fill();
    }
  }

  // A seam across the back of the palm, and the shadow the fingers drop onto
  // it. Two lines, and the hand stops being flat.
  ctx.strokeStyle = 'rgba(8,7,9,0.5)';
  ctx.lineWidth = Math.max(0.7, u * 0.16);
  ctx.beginPath();
  ctx.moveTo(u * 0.78, -u * 0.8);
  ctx.lineTo(u * 0.78, u * 0.8);
  ctx.stroke();
  ctx.strokeStyle = css(light, 0.35);
  ctx.lineWidth = Math.max(0.5, u * 0.1);
  ctx.beginPath();
  ctx.moveTo(-u * 0.6, -u * 0.62);
  ctx.lineTo(u * 0.7, -u * 0.62);
  ctx.stroke();

  ctx.restore();
}

/**
 * The neck, and the gorget over it.
 *
 * The rig has always had a `neck` joint but nothing ever drew it, so the head
 * sat in mid-air with a gap of daylight between it and the shoulders. In a
 * crowded fight that gap is invisible; standing still it is the first thing
 * you see. A short tapered column from between the shoulders to the base of
 * the skull closes it, and a collar band across the top of the chest gives
 * the head somewhere to sit rather than somewhere to hover.
 */
function drawNeck(ctx, P, def, s, tint) {
  const N = P.neck;
  const H = P.head;
  const shL = P.shoulderL;
  const shR = P.shoulderR;
  if (!N || !H || !shL || !shR) return;
  const M = def.colors;
  const midX = (shL[0] + shR[0]) * 0.5;
  const midY = (shL[1] + shR[1]) * 0.5;
  // A neck, not a chimney. This was as wide as the jaw and painted at little
  // over half brightness, which put a dark column down the middle of every
  // chest in the game — on a figure wearing a pale pelt it read as a hole
  // straight through him. It is narrower now, and the shadow is kept for the
  // hollow under the chin where it belongs.
  const wTop = 2.5 * s;
  const wBot = 3.6 * s;
  const skin = M.skin || M.arms;

  ctx.beginPath();
  ctx.moveTo(H[0] - wTop, H[1]);
  ctx.lineTo(H[0] + wTop, H[1]);
  ctx.lineTo(midX + wBot, midY + 1 * s);
  ctx.lineTo(midX - wBot, midY + 1 * s);
  ctx.closePath();
  ctx.fillStyle = css(tint(mixc(skin, M.skinDark || M.armsDark, 0.55)));
  ctx.fill();
  // The throat sits in the shadow of the jaw, deepest right under it.
  const tg = ctx.createLinearGradient(0, H[1] - 1 * s, 0, midY + 2 * s);
  tg.addColorStop(0, 'rgba(8,7,9,0.62)');
  tg.addColorStop(1, 'rgba(8,7,9,0.12)');
  ctx.fillStyle = tg;
  ctx.fill();

  // Gorget: a plate collar sitting on the shoulders, pulled up towards the
  // jaw so the throat is covered rather than left as a bare column.
  if (def.helm && def.helm !== 'none') {
    const gy = midY + (H[1] - midY) * 0.42;
    ctx.beginPath();
    ctx.ellipse(midX, gy, 7.4 * s, 3.4 * s, 0, 0, TAU);
    ctx.fillStyle = css(tint(M.metalDark || M.armsDark));
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(midX - 1 * s, gy - 1 * s, 6.4 * s, 2.6 * s, 0, 0, TAU);
    ctx.fillStyle = css(tint(M.metal || M.arms));
    ctx.fill();
  }
}

function drawTorso(ctx, P, D, def, s, tint, rimC, rimA, emis, cosF, sinF) {
  const M = def.colors;
  const hipL = P.hipL;
  const hipR = P.hipR;
  const shL = P.shoulderL;
  const shR = P.shoulderR;
  const widen = def.torsoWide ?? 1;

  // The torso's own frame: u runs across the chest from -1 at the left
  // shoulder to +1 at the right, v from the collar at 0 to the belt at 1.
  // Everything below — the silhouette, the muscle under the cloth, the folds,
  // the fur — is laid out in these coordinates, so it all leans and twists
  // with the pose instead of being pinned to the screen.
  const at = (u, v) => {
    const lx = lerp(shL[0], hipL[0], v);
    const ly = lerp(shL[1], hipL[1], v);
    const rx = lerp(shR[0], hipR[0], v);
    const ry = lerp(shR[1], hipR[1], v);
    const k = (u + 1) * 0.5;
    return [lerp(lx, rx, k), lerp(ly, ry, k)];
  };

  // The outline. It used to be a trapezoid with its sides bowed outwards — a
  // barrel, which is the one shape a torso is not. A body goes wide at the
  // shoulders, pinches at the waist and flares again at the hips, and that
  // double curve is most of what the eye uses to read a figure as a figure at
  // forty pixels tall. The collar dips between the shoulders rather than
  // running straight across, which is where the neck goes in.
  const W = 1.16 * widen;
  const path = () => {
    ctx.beginPath();
    // Up over the shoulder first. The arm is a capsule centred on the joint,
    // so it stands half its own width proud of the shoulder line — and a
    // torso that stopped at that line left a notch of daylight between the
    // body and the arm on every figure in the game. The trunk now rises into
    // a yoke over each joint, the way a trapezius does, and the arm sockets
    // into it instead of being propped beside it.
    ctx.moveTo(...at(-W * 0.94, -0.16));
    ctx.quadraticCurveTo(...at(-W * 1.08, 0.08), ...at(-W * 1.02, 0.34));
    ctx.quadraticCurveTo(...at(-W * 0.9, 0.52), ...at(-W * 0.76, 0.66));
    ctx.quadraticCurveTo(...at(-W * 0.74, 0.88), ...at(-W * 0.9, 1.04));
    ctx.lineTo(...at(W * 0.9, 1.04));
    ctx.quadraticCurveTo(...at(W * 0.74, 0.88), ...at(W * 0.76, 0.66));
    ctx.quadraticCurveTo(...at(W * 0.9, 0.52), ...at(W * 1.02, 0.34));
    ctx.quadraticCurveTo(...at(W * 1.08, 0.08), ...at(W * 0.94, -0.16));
    ctx.quadraticCurveTo(...at(0, 0.2), ...at(-W * 0.94, -0.16));
    ctx.closePath();
  };

  // Contour, then the rim ghost on the moonward edge.
  ctx.save();
  ctx.lineJoin = 'round';
  path();
  ctx.strokeStyle = 'rgba(8,7,9,0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(-1.4, -2.4);
  path();
  ctx.fillStyle = css(tint(rimC), rimA);
  ctx.fill();
  ctx.restore();

  // The chest is lit from the same lamp as everything else: hot on the upper
  // left shoulder, falling to near-black by the far hip.
  path();
  const g = ctx.createLinearGradient(
    shL[0] + KEY_X * 14 * s,
    shL[1] - 6 * s + KEY_Y * 10 * s,
    hipR[0] - KEY_X * 12 * s,
    hipR[1] - KEY_Y * 8 * s
  );
  // The chest is the largest surface on the figure, so it is where a flat
  // ramp is most obvious. Same recipe as the limbs: hot edge, body, core
  // shadow just inside the far side, then a lift at the very edge where
  // light bounces back off the ground.
  g.addColorStop(0, css(tint(mixc(M.torsoLight, [255, 248, 232], 0.34))));
  g.addColorStop(0.22, css(tint(M.torsoLight)));
  g.addColorStop(0.52, css(tint(M.torso)));
  // The far side goes deep but not black: past this the whole lower half of
  // every torso turned into a hole with a lit collar floating over it.
  g.addColorStop(0.82, css(tint(mixc(M.torsoDark, [10, 9, 11], 0.25))));
  g.addColorStop(1, css(tint(mixc(M.torsoDark, M.torso, 0.42))));
  ctx.fillStyle = g;
  ctx.fill();


  ctx.save();
  ctx.clip();

  // A body under the clothes.
  //
  // Whatever the garment is, the shape it hangs on is not a plank: the chest
  // is two masses either side of a hollow, it narrows into the waist, and the
  // collarbones cast down from the shoulders. Painting that in first, before
  // any cloth or steel, is what stops every torso in the game reading as a bib
  // hung between two shoulders — and because it is drawn in the torso's own
  // frame it leans and twists with the pose.
  //
  const halfW = Math.abs(shR[0] - shL[0]) * 0.5 || 6 * s;
  // How much of the front of the body is turned towards the camera. Nipples,
  // necklines and laces belong to the front; on a figure walking away they
  // must not show through its back.
  const front = clamp01(sinF * 1.3 + 0.3);

  const softBlob = (u, v, rx, ry, color, alpha, rot = 0) => {
    const [x, y] = at(u, v);
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0, css(tint(color), alpha));
    g.addColorStop(1, css(tint(color), 0));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  // Pectoral masses, lit on top and shadowed underneath, with the hollow of
  // the sternum between them.
  const chestLight = tint(mixc(M.torsoLight, [255, 248, 232], 0.2));
  softBlob(-0.42, 0.2, halfW * 0.62, halfW * 0.5, chestLight, 0.3 * (0.35 + front * 0.65));
  softBlob(0.42, 0.2, halfW * 0.62, halfW * 0.5, chestLight, 0.22 * (0.35 + front * 0.65));
  softBlob(-0.42, 0.42, halfW * 0.6, halfW * 0.34, M.torsoDark, 0.4 * front);
  softBlob(0.42, 0.42, halfW * 0.6, halfW * 0.34, M.torsoDark, 0.4 * front);
  softBlob(0, 0.3, halfW * 0.28, halfW * 0.58, M.torsoDark, 0.26);

  // The shoulders cast down onto the chest, and the waist sits in shadow under
  // the ribs — the two occlusions that give a torso its depth.
  softBlob(-0.86, 0.02, halfW * 0.5, halfW * 0.4, [8, 7, 9], 0.4);
  softBlob(0.86, 0.02, halfW * 0.5, halfW * 0.4, [8, 7, 9], 0.4);
  softBlob(0, 0.98, halfW * 1.2, halfW * 0.34, [8, 7, 9], 0.2);

  // Surface treatment
  if (def.torso === 'plate') {
    ctx.strokeStyle = css(M.metalDark, 0.55);
    ctx.lineWidth = 1.6 * s * 0.5;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      ctx.beginPath();
      ctx.moveTo(lerp(shL[0], hipL[0], t) - 4 * s, lerp(shL[1], hipL[1], t));
      ctx.quadraticCurveTo(
        lerp(P.chest[0], P.hip[0], t),
        lerp(P.chest[1], P.hip[1], t) + 2 * s,
        lerp(shR[0], hipR[0], t) + 4 * s,
        lerp(shR[1], hipR[1], t)
      );
      ctx.stroke();
    }
    // Specular sheen down the breastplate
    const sg = ctx.createLinearGradient(shL[0], 0, shR[0], 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.32, 'rgba(226,236,250,0.22)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(shL[0] - 20 * s, shL[1] - 10 * s, 40 * s, 60 * s);
    if (def.runes) drawRunes(ctx, P, def, s, emis);
  } else if (def.torso === 'surcoat') {
    // The Order's black cross on white linen.
    const cx = lerp(P.chest[0], P.hip[0], 0.42);
    const cy = lerp(P.chest[1], P.hip[1], 0.42);
    ctx.fillStyle = css(tint(M.emblem || PAL.orderBlack), 0.9);
    ctx.fillRect(cx - 1.7 * s, cy - 7 * s, 3.4 * s, 14 * s);
    ctx.fillRect(cx - 6 * s, cy - 1.7 * s, 12 * s, 3.4 * s);
    ctx.fillRect(cx - 3.4 * s, cy - 8.4 * s, 6.8 * s, 2 * s);
    ctx.fillRect(cx - 3.4 * s, cy + 6.4 * s, 6.8 * s, 2 * s);
    ctx.fillRect(cx - 7.4 * s, cy - 3.4 * s, 2 * s, 6.8 * s);
    ctx.fillRect(cx + 5.4 * s, cy - 3.4 * s, 2 * s, 6.8 * s);
  } else if (def.torso === 'mail') {
    ctx.fillStyle = css(M.metalDark, 0.5);
    for (let y = shL[1]; y < hipL[1] + 4 * s; y += 2.4 * s) {
      for (let x = shL[0] - 2 * s; x < shR[0] + 2 * s; x += 2.4 * s) {
        ctx.fillRect(x + ((y / (2.4 * s)) % 2) * 1.2 * s, y, 1.2 * s, 1.2 * s);
      }
    }
  } else if (def.torso === 'fur') {
    // A pelt thrown over the shoulders, not a hairy shirt. What says fur at
    // this size is the edge: a heavy mass across the top of the chest ending
    // in a ragged fringe, with the light catching the crest of it. The strands
    // underneath are the last five percent, and they only work because the
    // silhouette above them already reads.
    const fur = tint(mixc(M.torso, M.torsoDark, 0.35));
    const furL = tint(mixc(M.torsoLight, [255, 246, 226], 0.15));
    ctx.beginPath();
    ctx.moveTo(...at(-1.28, 0.02));
    ctx.quadraticCurveTo(...at(0, -0.22), ...at(1.28, 0.02));
    // Ragged hem. Regular teeth read as a saw blade, so the depth of each
    // tuft is pulled from a fixed irregular sequence and two of them hang
    // noticeably longer than the rest.
    const tufts = 9;
    for (let i = tufts; i >= 0; i--) {
      const u = -1.28 + (i / tufts) * 2.56;
      const deep = 0.24 + ((i * 0.618) % 1) * 0.13 + (i === 3 || i === 7 ? 0.12 : 0);
      const [cx2, cy2] = at(u + 1.28 / tufts, deep - 0.09);
      ctx.quadraticCurveTo(cx2, cy2, ...at(u, deep));
    }
    ctx.closePath();
    const [fx0, fy0] = at(-1.2, -0.24);
    const [fx1, fy1] = at(1.1, 0.46);
    const fg = ctx.createLinearGradient(fx0, fy0, fx1, fy1);
    // A pelt sits on top of what it covers, so it stays lighter than the body
    // under it all the way across — going dark at the bottom turned it into a
    // hole in the chest.
    fg.addColorStop(0, css(furL));
    fg.addColorStop(0.45, css(tint(mixc(M.torsoLight, M.torso, 0.5))));
    fg.addColorStop(1, css(fur));
    ctx.fillStyle = fg;
    ctx.fill();
    // Locks, hanging from the hem rather than combed down the chest — the
    // fringe is where fur reads, the middle of a pelt is just a colour.
    ctx.lineCap = 'round';
    for (let i = 0; i < 20; i++) {
      const u = -1.2 + (i / 19) * 2.4;
      const v0 = 0.1 + ((i * 0.37) % 1) * 0.1;
      const [x0, y0] = at(u, v0);
      const [x1, y1] = at(u + (i % 2 ? 0.05 : -0.05), v0 + 0.16);
      ctx.strokeStyle = css(i % 3 ? tint(mixc(M.torsoDark, M.torso, 0.3)) : furL, 0.24);
      ctx.lineWidth = Math.max(0.6, 0.75 * s);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.3, y0 + (y1 - y0) * 0.7, x1, y1);
      ctx.stroke();
    }
    // The crest of the pelt over the shoulders, where the moon catches it.
    ctx.strokeStyle = css(furL, 0.5);
    ctx.lineWidth = Math.max(0.8, 1.2 * s);
    ctx.beginPath();
    ctx.moveTo(...at(-1.1, -0.02));
    ctx.quadraticCurveTo(...at(0, -0.22), ...at(1.1, -0.02));
    ctx.stroke();
    // A strap across the chest holding it on.
    if (front > 0.05) {
      ctx.save();
      ctx.globalAlpha = front;
      const [sx0, sy0] = at(-0.9, 0.05);
      const [sx1, sy1] = at(0.55, 0.85);
      ctx.strokeStyle = css(tint(M.belt || PAL.leatherDark));
      ctx.lineWidth = 2.4 * s;
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
      ctx.strokeStyle = css(tint(mixc(M.belt || PAL.leatherDark, [255, 240, 210], 0.35)), 0.5);
      ctx.lineWidth = Math.max(0.7, 0.8 * s);
      ctx.beginPath();
      ctx.moveTo(sx0 - 0.9 * s, sy0);
      ctx.lineTo(sx1 - 0.9 * s, sy1);
      ctx.stroke();
      ctx.restore();
    }
  } else if (def.torso === 'robe') {
    // Cloth hangs in folds, and folds are what a robe is. Each one is a dark
    // trough with a lit ridge beside it, all of them converging slightly
    // towards the belt because that is where the cloth is gathered.
    for (let i = 0; i < 5; i++) {
      const u0 = -0.82 + i * 0.41;
      const u1 = u0 * 0.72;
      const wob = (i % 2 ? 1 : -1) * 0.08;
      const [x0, y0] = at(u0, 0.12);
      const [xm, ym] = at(u0 * 0.85 + wob, 0.55);
      const [x1, y1] = at(u1, 1.02);
      ctx.strokeStyle = css(tint(mixc(M.torsoDark, [8, 7, 9], 0.35)), 0.5);
      ctx.lineWidth = 2.2 * s;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(xm, ym, x1, y1);
      ctx.stroke();
      ctx.strokeStyle = css(tint(M.torsoLight), 0.28);
      ctx.lineWidth = Math.max(0.7, 1 * s);
      ctx.beginPath();
      ctx.moveTo(x0 - 1.6 * s, y0);
      ctx.quadraticCurveTo(xm - 1.6 * s, ym, x1 - 1.6 * s, y1);
      ctx.stroke();
    }
    // The opening, laced across, and the collar standing away from the neck.
    if (front > 0.05) {
      ctx.save();
      ctx.globalAlpha = front;
      const [nx0, ny0] = at(-0.34, -0.04);
      const [nx1, ny1] = at(0, 0.44);
      const [nx2, ny2] = at(0.34, -0.04);
      ctx.beginPath();
      ctx.moveTo(nx0, ny0);
      ctx.quadraticCurveTo(nx1, ny1 - 4 * s, nx1, ny1);
      ctx.quadraticCurveTo(nx1, ny1 - 4 * s, nx2, ny2);
      ctx.closePath();
      ctx.fillStyle = css(tint(mixc(M.torsoDark, [8, 7, 9], 0.55)));
      ctx.fill();
      ctx.strokeStyle = css(tint(M.torsoLight), 0.45);
      ctx.lineWidth = Math.max(0.7, 0.9 * s);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const v = 0.08 + i * 0.11;
        const [lx0, ly0] = at(-0.2 + i * 0.02, v);
        const [lx1, ly1] = at(0.2 - i * 0.02, v + 0.03);
        ctx.strokeStyle = css(tint(M.belt || PAL.leatherDark), 0.8);
        ctx.lineWidth = Math.max(0.6, 0.7 * s);
        ctx.beginPath();
        ctx.moveTo(lx0, ly0);
        ctx.lineTo(lx1, ly1);
        ctx.stroke();
      }
      ctx.restore();
    }
  } else if (def.torso === 'bare') {
    // Skin. The ribs catch light along the flank and the belly falls into
    // shadow under them; two marks, and the chest stops being a board.
    if (front > 0.05) {
      ctx.save();
      ctx.globalAlpha = front;
      ctx.strokeStyle = css(tint(M.torsoDark), 0.4);
      ctx.lineWidth = Math.max(0.7, 0.9 * s);
      for (let i = 0; i < 3; i++) {
        const v = 0.52 + i * 0.12;
        for (const sgn of [-1, 1]) {
          const [rx0, ry0] = at(sgn * 0.72, v);
          const [rx1, ry1] = at(sgn * 0.18, v + 0.06);
          ctx.beginPath();
          ctx.moveTo(rx0, ry0);
          ctx.quadraticCurveTo(sgn > 0 ? rx0 : rx1, (ry0 + ry1) * 0.5, rx1, ry1);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
  ctx.restore();

  // Belt, with a buckle on the front of it. The buckle is four pixels of
  // metal that tell you the figure is wearing something rather than painted.
  ctx.beginPath();
  ctx.moveTo(hipL[0] - 1.5 * s, hipL[1] - 1 * s);
  ctx.lineTo(hipR[0] + 1.5 * s, hipR[1] - 1 * s);
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = css(tint(M.belt || PAL.leatherDark));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hipL[0] - 1.5 * s, hipL[1] - 2.1 * s);
  ctx.lineTo(hipR[0] + 1.5 * s, hipR[1] - 2.1 * s);
  ctx.lineWidth = Math.max(0.6, 0.7 * s);
  ctx.strokeStyle = css(tint(mixc(M.belt || PAL.leatherDark, [255, 240, 210], 0.4)), 0.45);
  ctx.stroke();
  if (front > 0.08 && !def.carapace) {
    const bx = lerp(hipL[0], hipR[0], 0.5);
    const by = lerp(hipL[1], hipR[1], 0.5) - 1 * s;
    ctx.save();
    ctx.globalAlpha = front;
    ctx.beginPath();
    ctx.rect(bx - 2.2 * s, by - 2 * s, 4.4 * s, 4 * s);
    ctx.fillStyle = css(tint(M.metal || M.armsLight));
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,7,9,0.7)';
    ctx.lineWidth = Math.max(0.6, 0.8 * s);
    ctx.stroke();
    ctx.fillStyle = css(tint(mixc(M.metalLight || M.armsLight, [255, 255, 245], 0.4)), 0.8);
    ctx.fillRect(bx - 1.6 * s, by - 1.5 * s, 3.2 * s, 1 * s);
    ctx.restore();
  }

  // Robe skirt for casters
  if (def.torso === 'robe') {
    ctx.beginPath();
    ctx.moveTo(hipL[0] - 2 * s, hipL[1] - 2 * s);
    ctx.quadraticCurveTo(hipL[0] - 8 * s, hipL[1] + 14 * s, hipL[0] - 6.5 * s, hipL[1] + 30 * s);
    ctx.lineTo(hipR[0] + 6.5 * s, hipR[1] + 30 * s);
    ctx.quadraticCurveTo(hipR[0] + 8 * s, hipR[1] + 14 * s, hipR[0] + 2 * s, hipR[1] - 2 * s);
    ctx.closePath();
    const sg = ctx.createLinearGradient(0, hipL[1], 0, hipL[1] + 30 * s);
    sg.addColorStop(0, css(tint(M.torso)));
    sg.addColorStop(1, css(tint(M.torsoDark)));
    ctx.fillStyle = sg;
    ctx.fill();
  }
}

/**
 * A quiver, slung across the back.
 *
 * The huntress carried a bow and nothing to put in it. From the front all you
 * see is three shafts and their fletching standing over her shoulder, which is
 * the whole point: it is a silhouette detail, and silhouette is what survives
 * at forty pixels. It hangs from the right hip to the left shoulder and is
 * drawn behind everything, so the body always covers whatever part of it is
 * facing away.
 */
function drawQuiver(ctx, P, def, s, cosF, sinF, tint) {
  const M = def.colors;
  const shL = P.shoulderL;
  const hipR = P.hipR;
  if (!shL || !hipR) return;
  // Sits over the shoulder the bow arm is not using.
  const flip = (def.weaponHand || 'R') === 'L' ? 1 : -1;
  const bx = lerp(P.hip[0], hipR[0], 0.4) + cosF * 3 * s * flip;
  const by = P.hip[1] - 2 * s;
  const tx = lerp(P.chest[0], shL[0], 0.55) + cosF * 4 * s * flip;
  const ty = shL[1] - 4 * s;

  const leather = tint(M.belt || PAL.leatherDark);
  const leatherL = tint(mixc(M.belt || PAL.leatherDark, [255, 236, 200], 0.4));

  // The tube.
  capsule(ctx, bx, by, tx, ty, 4.6 * s, 3.8 * s);
  ctx.fillStyle = 'rgba(8,7,9,0.85)';
  ctx.fill();
  capsule(ctx, bx, by, tx, ty, 3.8 * s, 3.1 * s);
  ctx.fillStyle = cylinderFill(
    ctx, bx, by, tx, ty, 3.8 * s, 3.1 * s,
    leather,
    tint(mixc(M.belt || PAL.leatherDark, [8, 7, 9], 0.55)),
    leatherL,
    tint(mixc(leatherL, [255, 250, 240], 0.4))
  );
  ctx.fill();
  // Two bands round it.
  ctx.strokeStyle = css(tint(mixc(M.belt || PAL.leatherDark, [8, 7, 9], 0.4)), 0.85);
  ctx.lineWidth = Math.max(0.9, 1.3 * s);
  for (const t of [0.3, 0.66]) {
    const cx = lerp(bx, tx, t);
    const cy = lerp(by, ty, t);
    const nx = -(ty - by);
    const ny = tx - bx;
    const len = Math.hypot(nx, ny) || 1;
    ctx.beginPath();
    ctx.moveTo(cx - (nx / len) * 3.6 * s, cy - (ny / len) * 3.6 * s);
    ctx.lineTo(cx + (nx / len) * 3.6 * s, cy + (ny / len) * 3.6 * s);
    ctx.stroke();
  }

  // Arrows: shafts out of the mouth of it, each with a nock and fletching.
  const ax = tx - (bx - tx) * 0.06;
  const ay = ty - (by - ty) * 0.06;
  for (let i = -1; i <= 1; i++) {
    const sx = ax + i * 2.6 * s;
    const sy = ay - Math.abs(i) * 0.6 * s;
    const ex = sx + i * 2.2 * s - cosF * 1.5 * s;
    const ey = sy - 11 * s;
    ctx.strokeStyle = css(tint(mixc(PAL.wood || M.belt, [40, 30, 20], 0.2)));
    ctx.lineWidth = Math.max(0.9, 1.2 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Fletching — two feathers, one lit and one in shade.
    ctx.beginPath();
    ctx.moveTo(ex, ey + 1 * s);
    ctx.lineTo(ex - 2.2 * s, ey - 2.4 * s);
    ctx.lineTo(ex, ey - 3.4 * s);
    ctx.closePath();
    ctx.fillStyle = css(tint(def.fletching || [188, 176, 150]), 0.92);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ex, ey + 1 * s);
    ctx.lineTo(ex + 2.2 * s, ey - 2.4 * s);
    ctx.lineTo(ex, ey - 3.4 * s);
    ctx.closePath();
    ctx.fillStyle = css(tint(mixc(def.fletching || [188, 176, 150], [20, 18, 16], 0.45)), 0.92);
    ctx.fill();
  }
  void sinF;
}

/**
 * A shell over the back and shoulders.
 *
 * The crabling was a brown man with a claw. What makes a thing read as a
 * crustacean at forty pixels is not its colour but its outline: a hard domed
 * plate sitting proud of the body, scalloped along its lower edge, with the
 * limbs coming out from under it. So the shell is drawn outside the torso's
 * own silhouette — it is allowed to overhang — with segment seams across it
 * and a row of spines down each side.
 */
function drawCarapace(ctx, P, def, s, tint) {
  const M = def.colors;
  const shL = P.shoulderL;
  const shR = P.shoulderR;
  const hipL = P.hipL;
  const hipR = P.hipR;
  if (!shL || !hipL) return;
  const at = (u, v) => {
    const lx = lerp(shL[0], hipL[0], v);
    const ly = lerp(shL[1], hipL[1], v);
    const rx = lerp(shR[0], hipR[0], v);
    const ry = lerp(shR[1], hipR[1], v);
    const k = (u + 1) * 0.5;
    return [lerp(lx, rx, k), lerp(ly, ry, k)];
  };
  const shell = tint(def.shell || M.torso);
  const shellD = tint(mixc(def.shell || M.torso, [10, 8, 6], 0.6));
  const shellL = tint(mixc(def.shellLight || M.torsoLight, [255, 236, 200], 0.3));

  ctx.beginPath();
  ctx.moveTo(...at(-1.62, 0.5));
  ctx.quadraticCurveTo(...at(-1.74, -0.12), ...at(-0.95, -0.5));
  ctx.quadraticCurveTo(...at(0, -0.74), ...at(0.95, -0.5));
  ctx.quadraticCurveTo(...at(1.74, -0.12), ...at(1.62, 0.5));
  // Scalloped hem — six lobes, the way a carapace plates over the abdomen.
  for (let i = 5; i >= 0; i--) {
    const u = -1.62 + (i / 5) * 3.24;
    const [x, y] = at(u, 0.5);
    const [cx, cy] = at(u + 0.32, 0.68);
    ctx.quadraticCurveTo(cx, cy, x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(8,7,9,0.9)';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  const [gx0, gy0] = at(-1.1, -0.35);
  const [gx1, gy1] = at(1.2, 0.7);
  const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
  g.addColorStop(0, css(shellL));
  g.addColorStop(0.34, css(shell));
  g.addColorStop(1, css(shellD));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();
  // Segment seams, following the dome.
  for (let i = 1; i <= 3; i++) {
    const v = -0.38 + i * 0.22;
    ctx.beginPath();
    ctx.moveTo(...at(-1.45, v + 0.16));
    ctx.quadraticCurveTo(...at(0, v - 0.14), ...at(1.45, v + 0.16));
    ctx.strokeStyle = css(shellD, 0.75);
    ctx.lineWidth = 1.8 * s;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(...at(-1.45, v + 0.1));
    ctx.quadraticCurveTo(...at(0, v - 0.2), ...at(1.45, v + 0.1));
    ctx.strokeStyle = css(shellL, 0.35);
    ctx.lineWidth = Math.max(0.7, 0.9 * s);
    ctx.stroke();
  }
  // Pitting on the crest, where the light hits hardest.
  ctx.fillStyle = css(shellD, 0.5);
  for (let i = 0; i < 14; i++) {
    const u = -1.1 + ((i * 0.317) % 1) * 2.2;
    const v = -0.44 + ((i * 0.618) % 1) * 0.78;
    const [x, y] = at(u, v);
    ctx.beginPath();
    ctx.ellipse(x, y, 1.1 * s, 0.8 * s, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Spines along both edges, bone-pale and pointing back and out.
  ctx.strokeStyle = css(tint(def.spine || PAL.bone), 0.9);
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.lineCap = 'round';
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const v = -0.34 + i * 0.24;
      const [x0, y0] = at(sgn * 1.45, v);
      const [x1, y1] = at(sgn * 1.78, v - 0.26);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
}

/**
 * Eyes on stalks. Two of them, on a low bob of their own so they never sit
 * quite still, with the glow taken from whatever the creature's eyes are.
 */
function drawEyestalks(ctx, H, r, s, t, cosF, tint, def, emis) {
  const col = def.glowEyes || PAL.amber;
  const stalk = tint(def.shell || def.colors.torso);
  for (const sgn of [-1, 1]) {
    const wob = Math.sin(t * 2.3 + (sgn > 0 ? 1.7 : 0)) * r * 0.12;
    const bx = H[0] + sgn * r * 0.42 - cosF * r * 0.2;
    const by = H[1] - r * 0.5;
    const tx = bx + sgn * r * 0.5 + wob;
    const ty = by - r * 1.15;
    ctx.strokeStyle = 'rgba(8,7,9,0.85)';
    ctx.lineWidth = Math.max(1.4, 2.6 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + sgn * r * 0.1, by - r * 0.7, tx, ty);
    ctx.stroke();
    ctx.strokeStyle = css(stalk);
    ctx.lineWidth = Math.max(0.9, 1.6 * s);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + sgn * r * 0.1, by - r * 0.7, tx, ty);
    ctx.stroke();
    // The bead on top.
    ctx.beginPath();
    ctx.ellipse(tx, ty, r * 0.26, r * 0.28, 0, 0, TAU);
    ctx.fillStyle = 'rgba(8,7,9,0.9)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(tx, ty, r * 0.19, r * 0.21, 0, 0, TAU);
    ctx.fillStyle = css(col, 0.95);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(tx - r * 0.06, ty - r * 0.07, r * 0.07, r * 0.07, 0, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,240,0.8)';
    ctx.fill();
    if (emis) emis(tx, ty, r * 1.1, col, 0.7);
  }
}

/**
 * A face, on a head about ten pixels across.
 *
 * Two dark dots for eyes is what this was, and two dark dots is a doll. But
 * there is no room here for a drawing either: by the time the world buffer is
 * scaled to a phone the whole head is a thumbnail. So the face is built the
 * way a painter blocks one in before any detail — as values in the right
 * places. A brow that shadows the sockets, a nose that catches light on one
 * side and casts on the other, cheekbones, a mouth in the shadow under them.
 * Blurred down to nothing it still reads as a face, because the arrangement
 * of light and dark is what the eye recognises, not the features.
 *
 * Everything is offset against `cosF` so the features sit on the front of the
 * head and slide round it as the figure turns, and the light side is taken
 * from the same key light the armour uses.
 */
function drawFace(ctx, H, r, cosF, front, tint, M, def) {
  const x = H[0] - cosF * r * 0.26;
  const y = H[1];
  const dark = tint(M.skinDark || M.armsDark);
  const lit = tint(M.skinLight || M.armsLight);
  const side = KEY_X < 0 ? -1 : 1; // which cheek the lamp is on

  ctx.save();
  ctx.globalAlpha = front;

  // Brow. A band across the top of the face, dark underneath where it hangs
  // over the eyes — this one shape does most of the work.
  ctx.fillStyle = css(mixc(dark, [10, 9, 12], 0.45), 0.5);
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.22, r * 0.66, r * 0.3, 0, 0, TAU);
  ctx.fill();

  // Eyes, set into that shadow, with a glint on the lit side of each.
  const ex = r * 0.34;
  ctx.fillStyle = 'rgba(12,10,13,0.82)';
  ctx.beginPath();
  ctx.ellipse(x - ex, y - r * 0.1, r * 0.17, r * 0.14, 0, 0, TAU);
  ctx.ellipse(x + ex, y - r * 0.1, r * 0.17, r * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = css(lit, 0.5);
  ctx.beginPath();
  ctx.ellipse(x - ex + side * r * 0.07, y - r * 0.15, r * 0.06, r * 0.05, 0, 0, TAU);
  ctx.ellipse(x + ex + side * r * 0.07, y - r * 0.15, r * 0.06, r * 0.05, 0, 0, TAU);
  ctx.fill();

  // Nose: a lit ridge with its own shadow beside it. A face with no nose is a
  // mask, and the shadow is more of the nose than the ridge is.
  ctx.fillStyle = css(mixc(dark, [10, 9, 12], 0.3), 0.42);
  ctx.beginPath();
  ctx.moveTo(x - side * r * 0.04, y - r * 0.16);
  ctx.quadraticCurveTo(x - side * r * 0.2, y + r * 0.16, x - side * r * 0.12, y + r * 0.3);
  ctx.lineTo(x + side * r * 0.06, y + r * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = css(lit, 0.36);
  ctx.beginPath();
  ctx.moveTo(x + side * r * 0.02, y - r * 0.16);
  ctx.quadraticCurveTo(x + side * r * 0.08, y + r * 0.1, x + side * r * 0.04, y + r * 0.26);
  ctx.lineTo(x + side * r * 0.13, y + r * 0.24);
  ctx.closePath();
  ctx.fill();

  // Cheekbone on the lit side, hollow under it on the other.
  ctx.fillStyle = css(lit, 0.22);
  ctx.beginPath();
  ctx.ellipse(x + side * r * 0.46, y + r * 0.1, r * 0.26, r * 0.18, side * 0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = css(mixc(dark, [10, 9, 12], 0.25), 0.3);
  ctx.beginPath();
  ctx.ellipse(x - side * r * 0.5, y + r * 0.16, r * 0.24, r * 0.22, -side * 0.4, 0, TAU);
  ctx.fill();

  if (def.beard) {
    // A beard is a silhouette change, so it is drawn as a mass with a ragged
    // lower edge rather than as strokes that would vanish at this size.
    const b = tint(def.beard);
    ctx.fillStyle = css(b);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.72, y + r * 0.06);
    ctx.quadraticCurveTo(x - r * 0.66, y + r * 1.32, x, y + r * 1.5);
    ctx.quadraticCurveTo(x + r * 0.66, y + r * 1.32, x + r * 0.72, y + r * 0.06);
    ctx.quadraticCurveTo(x, y + r * 0.62, x - r * 0.72, y + r * 0.06);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(mixc(b, [255, 250, 240], 0.3), 0.5);
    ctx.beginPath();
    ctx.moveTo(x - r * 0.66, y + r * 0.16);
    ctx.quadraticCurveTo(x - r * 0.4, y + r * 0.9, x - r * 0.12, y + r * 1.16);
    ctx.lineTo(x - r * 0.3, y + r * 1.1);
    ctx.quadraticCurveTo(x - r * 0.56, y + r * 0.8, x - r * 0.7, y + r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  // Mouth: a shadow line, with the lower lip catching a little light under it.
  ctx.fillStyle = 'rgba(14,10,12,0.55)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.56, r * 0.24, r * 0.07, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = css(lit, 0.2);
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.68, r * 0.18, r * 0.05, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawHead(ctx, P, D, def, st, s, cosF, sinF, tint, emis, rimC, rimA) {
  const M = def.colors;
  const H = P.head;
  const N = P.neck;
  const r = (def.headR ?? 7.6) * s;
  // Neck
  ctx.beginPath();
  ctx.moveTo(N[0] - 3.4 * s, N[1]);
  ctx.lineTo(N[0] + 3.4 * s, N[1]);
  ctx.lineTo(H[0] + 2.8 * s, H[1] + 1 * s);
  ctx.lineTo(H[0] - 2.8 * s, H[1] + 1 * s);
  ctx.closePath();
  ctx.fillStyle = css(tint(M.skinDark || M.armsDark));  // silhouette under the face
  ctx.fill();

  // Rim ghost
  ctx.beginPath();
  ctx.ellipse(H[0] - 1.4, H[1] - 2.4, r * 1.03, r * 1.1, 0, 0, TAU);
  ctx.fillStyle = css(tint(rimC), rimA);
  ctx.fill();

  // Skull, shaded as an actual sphere — highlight off-centre towards the
  // lamp, a core shadow inside the shadow edge, and the rim lifting again
  // where light bounces back onto it.
  ctx.beginPath();
  ctx.ellipse(H[0], H[1], r, r * 1.08, 0, 0, TAU);
  ctx.fillStyle = sphereFill(
    ctx,
    H[0],
    H[1],
    r,
    tint(M.skin || M.arms),
    tint(M.skinDark || M.armsDark),
    tint(M.skinLight || M.armsLight),
    tint(mixc(M.skinLight || M.armsLight, [255, 245, 230], 0.5))
  );
  ctx.fill();
  // The jaw sits in the shadow of the skull above it.
  contactAO(ctx, H[0], H[1] + r * 0.95, r * 0.8, 0.35);

  // The face is only drawn when the character is turned toward the camera.
  const front = clamp01(sinF * 1.4 + 0.25);
  if (front > 0.05 && def.helm !== 'greathelm' && def.helm !== 'skull') {
    drawFace(ctx, H, r, cosF, front, tint, M, def);
  }

  if (def.glowEyes) {
    const front2 = clamp01(sinF * 1.3 + 0.35);
    if (front2 > 0.02) {
      const ex = r * 0.34;
      const ey = H[1] - r * 0.12;
      ctx.save();
      ctx.globalAlpha = front2;
      ctx.fillStyle = css(def.glowEyes, 0.95);
      ctx.beginPath();
      ctx.ellipse(H[0] - ex - cosF * r * 0.2, ey, r * 0.17, r * 0.13, 0, 0, TAU);
      ctx.ellipse(H[0] + ex - cosF * r * 0.2, ey, r * 0.17, r * 0.13, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      if (emis) emis(H[0], ey, r * 1.5, def.glowEyes, 0.75 * front2);
    }
  }

  if (def.eyestalks) drawEyestalks(ctx, H, r, s, st.t || 0, cosF, tint, def, emis);

  drawHelm(ctx, def, H, r, s, cosF, sinF, tint, M, emis);
}

function drawHelm(ctx, def, H, r, s, cosF, sinF, tint, M, emis) {
  const helm = def.helm || 'none';
  if (helm === 'none') {
    // Hair
    if (def.hair) {
      ctx.beginPath();
      ctx.ellipse(H[0], H[1] - r * 0.42, r * 1.04, r * 0.82, 0, Math.PI, TAU);
      ctx.fillStyle = css(tint(def.hair));
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(H[0] - cosF * r * 0.5, H[1] + r * 0.1, r * 0.55, r * 0.9, 0, 0, TAU);
      ctx.fillStyle = css(tint(def.hair), 0.9);
      ctx.fill();
    }
    return;
  }
  const met = tint(M.metal);
  const metD = tint(M.metalDark);
  const metL = tint(M.metalLight);

  if (helm === 'greathelm') {
    // A great helm is a riveted drum with a domed crown, a face plate that
    // sits proud of it, and a flare at the bottom where it rests on the
    // shoulders. Drawn as a single silhouette it is a bucket; the parts are
    // what make it armour.
    const front = clamp01(sinF * 1.5 + 0.2);
    const cx = H[0] - cosF * r * 0.2;

    // Skull of the helm.
    ctx.beginPath();
    ctx.moveTo(H[0] - r * 1.12, H[1] - r * 0.72);
    ctx.quadraticCurveTo(H[0] - r * 1.05, H[1] - r * 1.18, H[0], H[1] - r * 1.24);
    ctx.quadraticCurveTo(H[0] + r * 1.05, H[1] - r * 1.18, H[0] + r * 1.12, H[1] - r * 0.72);
    ctx.lineTo(H[0] + r * 1.06, H[1] + r * 1.02);
    ctx.quadraticCurveTo(H[0], H[1] + r * 1.46, H[0] - r * 1.06, H[1] + r * 1.02);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(8,7,9,0.9)';
    ctx.lineWidth = Math.max(1, 1.3 * s);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = sphereFill(ctx, H[0], H[1] - r * 0.1, r * 1.35, met, metD, metL, mixc(metL, [255, 255, 250], 0.45));
    ctx.fill();

    // The crown is a separate, brighter plate riveted over the top.
    ctx.beginPath();
    ctx.moveTo(H[0] - r * 1.06, H[1] - r * 0.66);
    ctx.quadraticCurveTo(H[0], H[1] - r * 1.3, H[0] + r * 1.06, H[1] - r * 0.66);
    ctx.quadraticCurveTo(H[0], H[1] - r * 0.44, H[0] - r * 1.06, H[1] - r * 0.66);
    ctx.closePath();
    ctx.fillStyle = css(mixc(metL, met, 0.35));
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,7,9,0.55)';
    ctx.lineWidth = Math.max(0.8, 0.9 * s);
    ctx.stroke();

    if (front > 0.03) {
      ctx.save();
      ctx.globalAlpha = front;

      // Eye slits: a recess, so a dark band with a lit lip along its top
      // edge where the plate above it turns away.
      const slitY = H[1] - r * 0.22;
      const slitH = r * 0.3;
      for (const sx of [-1, 1]) {
        ctx.fillStyle = 'rgba(6,6,9,0.95)';
        ctx.fillRect(cx + sx * r * 0.12, slitY, sx * r * 0.78, slitH);
      }
      ctx.fillStyle = css(metL, 0.5);
      ctx.fillRect(cx - r * 0.9, slitY - r * 0.09, r * 1.8, r * 0.09);
      ctx.fillStyle = 'rgba(8,7,9,0.45)';
      ctx.fillRect(cx - r * 0.9, slitY + slitH, r * 1.8, r * 0.07);

      // Breath holes, in the two staggered rows a real helm carries.
      ctx.fillStyle = 'rgba(8,8,11,0.8)';
      for (let row = 0; row < 2; row++) {
        for (let i = -2; i <= 2; i++) {
          if (row === 1 && Math.abs(i) === 2) continue;
          ctx.beginPath();
          ctx.arc(cx + (i + row * 0.5) * r * 0.28, H[1] + r * (0.5 + row * 0.26), r * 0.075, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Reinforcing bands: one down the face, one across the brow, each a dark
    // strap with a lit edge on the side facing the lamp.
    const band = (x0, y0, x1, y1, w) => {
      ctx.strokeStyle = css(mixc(metD, [10, 10, 14], 0.3), 0.85);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = css(metL, 0.42);
      ctx.lineWidth = Math.max(0.6, w * 0.3);
      ctx.beginPath();
      ctx.moveTo(x0 - w * 0.34, y0);
      ctx.lineTo(x1 - w * 0.34, y1);
      ctx.stroke();
    };
    band(cx, H[1] - r * 1.2, cx, H[1] + r * 1.24, 2.1 * s);
    band(cx - r * 1.02, H[1] - r * 0.52, cx + r * 1.02, H[1] - r * 0.52, 1.7 * s);

    // Rivets around the rim and at the band crossing.
    const rivet = (rx, ry, rr) => {
      ctx.beginPath();
      ctx.arc(rx, ry, rr, 0, TAU);
      ctx.fillStyle = css(metD);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(rx - rr * 0.3, ry - rr * 0.3, rr * 0.5, 0, TAU);
      ctx.fillStyle = css(mixc(metL, [255, 255, 250], 0.4));
      ctx.fill();
    };
    const rr = Math.max(0.9, r * 0.11);
    rivet(cx, H[1] - r * 0.52, rr);
    rivet(cx - r * 0.86, H[1] + r * 0.98, rr * 0.85);
    rivet(cx + r * 0.86, H[1] + r * 0.98, rr * 0.85);
    rivet(cx - r * 0.9, H[1] - r * 0.86, rr * 0.8);
    rivet(cx + r * 0.9, H[1] - r * 0.86, rr * 0.8);

  } else if (helm === 'kettle') {
    ctx.beginPath();
    ctx.ellipse(H[0], H[1] - r * 0.42, r * 1.05, r * 0.9, 0, Math.PI, TAU);
    ctx.fillStyle = css(met);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(H[0], H[1] - r * 0.3, r * 1.7, r * 0.32, 0, 0, TAU);
    const bg = ctx.createLinearGradient(H[0] - r * 1.7, 0, H[0] + r * 1.7, 0);
    bg.addColorStop(0, css(metL));
    bg.addColorStop(0.5, css(met));
    bg.addColorStop(1, css(metD));
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(H[0] - r * 0.35, H[1] - r * 0.8, r * 0.4, r * 0.25, -0.5, 0, TAU);
    ctx.fillStyle = css(metL, 0.55);
    ctx.fill();
  } else if (helm === 'hood') {
    // A deep cowl with a peak and a mantle over the shoulders.
    ctx.beginPath();
    ctx.moveTo(H[0] - r * 1.5, H[1] + r * 1.5);
    ctx.quadraticCurveTo(H[0] - r * 1.55, H[1] - r * 1.5, H[0] - r * 0.15, H[1] - r * 1.62);
    ctx.quadraticCurveTo(H[0] + r * 1.05, H[1] - r * 1.55, H[0] + r * 1.42, H[1] - r * 0.35);
    ctx.quadraticCurveTo(H[0] + r * 1.62, H[1] + r * 0.9, H[0] + r * 1.5, H[1] + r * 1.5);
    ctx.quadraticCurveTo(H[0], H[1] + r * 0.55, H[0] - r * 1.5, H[1] + r * 1.5);
    ctx.closePath();
    const g = ctx.createLinearGradient(H[0] - r, H[1] - r, H[0] + r, H[1] + r);
    g.addColorStop(0, css(tint(def.hoodLight || M.torsoLight)));
    g.addColorStop(1, css(tint(def.hood || M.torsoDark)));
    ctx.fillStyle = g;
    ctx.fill();
    // The fold where the cloth turns over the brow, and the seam running back
    // over the crown — two lines, and the cowl stops being a bag.
    ctx.strokeStyle = css(tint(mixc(def.hood || M.torsoDark, [8, 8, 12], 0.4)), 0.7);
    ctx.lineWidth = Math.max(0.8, 1.1 * s);
    ctx.beginPath();
    ctx.moveTo(H[0] - r * 1.4, H[1] + r * 0.5);
    ctx.quadraticCurveTo(H[0] - cosF * r * 0.4, H[1] - r * 1.1, H[0] + r * 1.34, H[1] - r * 0.1);
    ctx.stroke();
    ctx.strokeStyle = css(tint(def.hoodLight || M.torsoLight), 0.28);
    ctx.lineWidth = Math.max(0.7, 0.9 * s);
    ctx.beginPath();
    ctx.moveTo(H[0] - r * 1.34, H[1] + r * 0.44);
    ctx.quadraticCurveTo(H[0] - cosF * r * 0.4, H[1] - r * 1.2, H[0] + r * 1.28, H[1] - r * 0.16);
    ctx.stroke();

    // Shadow inside the cowl, and what survives it.
    //
    // A deep hood does not show a face; it shows the fact that there is one.
    // The cowl's own shadow is kept almost black, and then the two things a
    // torch would still find in there — the wet of the eyes and the line of
    // the cheekbone — are put back on top of it. That reads as a hooded figure
    // at any size, where a lit face under a hood just reads as a hat.
    const front = clamp01(sinF * 1.4 + 0.2);
    if (front > 0.03) {
      ctx.save();
      ctx.globalAlpha = front;
      const fx = H[0] - cosF * r * 0.3;
      ctx.fillStyle = 'rgba(6,6,10,0.88)';
      ctx.beginPath();
      ctx.ellipse(fx, H[1] + r * 0.12, r * 0.82, r * 0.92, 0, 0, TAU);
      ctx.fill();
      const glint = def.glowEyes || mixc(M.skinLight || M.armsLight, [255, 250, 235], 0.3);
      ctx.fillStyle = css(glint, def.glowEyes ? 0.95 : 0.5);
      ctx.beginPath();
      ctx.ellipse(fx - r * 0.3, H[1] - r * 0.02, r * 0.13, r * 0.1, 0, 0, TAU);
      ctx.ellipse(fx + r * 0.3, H[1] - r * 0.02, r * 0.13, r * 0.1, 0, 0, TAU);
      ctx.fill();
      if (def.glowEyes && emis) emis(fx, H[1] - r * 0.02, r * 1.4, def.glowEyes, 0.6 * front);
      // A sliver of jaw at the very bottom of the cowl. Any bigger and it
      // stops reading as a chin catching light and starts reading as a mouth
      // hanging open.
      ctx.fillStyle = css(mixc(M.skin || M.arms, [255, 240, 220], 0.15), 0.24);
      ctx.beginPath();
      ctx.ellipse(fx, H[1] + r * 0.86, r * 0.4, r * 0.11, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  } else if (helm === 'horned') {
    ctx.beginPath();
    ctx.ellipse(H[0], H[1] - r * 0.28, r * 1.06, r * 0.95, 0, Math.PI, TAU);
    ctx.fillStyle = css(met);
    ctx.fill();
    ctx.strokeStyle = css(tint(PAL.bone));
    ctx.lineWidth = 2.6 * s;
    ctx.lineCap = 'round';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(H[0] + d * r * 0.85, H[1] - r * 0.6);
      ctx.quadraticCurveTo(H[0] + d * r * 2.1, H[1] - r * 1.2, H[0] + d * r * 1.7, H[1] - r * 2.1);
      ctx.stroke();
    }
  } else if (helm === 'skull') {
    ctx.beginPath();
    ctx.ellipse(H[0], H[1], r * 1.02, r * 1.1, 0, 0, TAU);
    const g = ctx.createRadialGradient(H[0] - r * 0.4, H[1] - r * 0.5, r * 0.1, H[0], H[1], r * 1.3);
    g.addColorStop(0, css(tint(PAL.bone)));
    g.addColorStop(1, css(tint(PAL.boneDark)));
    ctx.fillStyle = g;
    ctx.fill();
    const front = clamp01(sinF * 1.4 + 0.25);
    if (front > 0.03) {
      ctx.save();
      ctx.globalAlpha = front;
      ctx.fillStyle = 'rgba(8,7,9,0.9)';
      ctx.beginPath();
      ctx.ellipse(H[0] - r * 0.38 - cosF * r * 0.2, H[1] - r * 0.12, r * 0.24, r * 0.28, 0, 0, TAU);
      ctx.ellipse(H[0] + r * 0.38 - cosF * r * 0.2, H[1] - r * 0.12, r * 0.24, r * 0.28, 0, 0, TAU);
      ctx.fill();
      ctx.fillRect(H[0] - r * 0.16 - cosF * r * 0.2, H[1] + r * 0.35, r * 0.32, r * 0.4);
      ctx.restore();
    }
  }
}

/**
 * Cloth hanging from the belt: a knight's surcoat, a robe's skirt, a corpse's
 * rags.
 *
 * Every figure in the game was wearing trousers, which is a strange thing for
 * a crusading order and a stranger one for a sorcerer, and it is also the
 * reason they all read as the same doll in different paint: two legs on show
 * from the hip down is the most generic silhouette a humanoid has. Cloth over
 * the top of them changes the outline, which is the only part of a
 * forty-pixel figure the eye reliably gets.
 *
 * It is not simulated. It does not need to be: a hem does exactly three
 * things, and all three are functions of the pose the figure is already in.
 * It swings out where a knee is driving through it. It trails behind the
 * direction of travel. And it splits open around the legs when they part.
 */
function drawSkirt(ctx, P, D, def, st, s, cosF, sinF, tint, contour) {
  const K = def.skirt;
  const L = P.hipL;
  const R = P.hipR;
  if (!K || !L || !R) return;
  const M = def.colors;
  const base = tint(K.color || M.torso);
  const light = tint(K.light || M.torsoLight);
  const dark = tint(K.dark || M.torsoDark);
  const len = (K.len ?? 26) * s;
  const flare = K.flare ?? 1.3;
  const split = clamp01(K.split ?? 0.45);
  const speed = clamp01(st.speed || 0);

  // The belt line, and the two directions the cloth answers to: down, which is
  // gravity, and forward, which is where the body is going.
  // The belt line runs a little wider than the hip joints and a little above
  // them, so the cloth overlaps the bottom of the trunk instead of butting
  // against it and leaving a seam of daylight across the waist.
  const waist = K.waist ?? 1.3;
  const cx = (L[0] + R[0]) * 0.5;
  const cy = (L[1] + R[1]) * 0.5;
  const ux = (R[0] - L[0]) * 0.5 * waist;
  const uy = (R[1] - L[1]) * 0.5 * waist;
  const fx = cosF;
  const fy = sinF * ISO_Y;
  // Trailing. Cloth is always a beat behind the body wearing it, so the hem
  // sits back along the line of travel — and further back the faster it goes.
  const trailX = -fx * len * 0.3 * speed;
  const trailY = -fy * len * 0.3 * speed;
  // And the knees push it. The hem over each leg follows that leg's knee,
  // which is what makes the two halves of a surcoat cross and open as the
  // figure walks rather than swinging as one board.
  const kick = (K.kick ?? 0.26) * len * 0.06;
  const kickL = P.kneeL ? clamp((P.kneeL[0] - L[0]) * 0.34, -kick, kick) : 0;
  const kickR = P.kneeR ? clamp((P.kneeR[0] - R[0]) * 0.34, -kick, kick) : 0;
  const kickLy = P.kneeL ? (P.kneeL[1] - L[1]) * 0.08 : 0;
  const kickRy = P.kneeR ? (P.kneeR[1] - R[1]) * 0.08 : 0;

  const belt = (u) => [cx + ux * u, cy + uy * u - 3.4 * s];
  const hem = (u) => {
    const k = (u + 1) * 0.5; // 0 at the left hip, 1 at the right
    // Cloth hangs, so the hem sags towards the middle of each panel rather
    // than running straight between its corners.
    const sag = (1 - u * u) * 1.6 * s;
    return [
      cx + ux * u * flare + trailX + lerp(kickL, kickR, k),
      cy + uy * u * flare + trailY + len + sag + lerp(kickLy, kickRy, k),
    ];
  };

  ctx.save();
  ctx.lineJoin = 'round';

  // One garment with a slit up the front, not two boards hung side by side.
  // Drawn as a single outline: down one flared edge, along the hem, up into
  // the slit and down again, along the rest of the hem and back up the other
  // edge. The slit opens as far as the legs have parted, so a standing figure
  // is closed and a striding one flies apart.
  const gap = split * (0.08 + speed * 0.3);
  const notchTop = 1 - clamp01(split);
  const notch = [
    lerp(belt(0)[0], hem(0)[0], notchTop),
    lerp(belt(0)[1], hem(0)[1], notchTop),
  ];
  const bL = belt(-1);
  const bR = belt(1);
  const hL = hem(-1);
  const hR = hem(1);
  const hLi = hem(-gap);
  const hRi = hem(gap);

  // The outer edges bow *outwards*: cloth pushed away from the body by the
  // hips under it, not a straight line down from the belt.
  const edge = (b, h, side) => {
    const mx = (b[0] + h[0]) * 0.5 + side * Math.abs(h[0] - b[0]) * 0.18 + side * 2.4 * s;
    const my = (b[1] + h[1]) * 0.5;
    ctx.quadraticCurveTo(mx, my, h[0], h[1]);
  };

  ctx.beginPath();
  ctx.moveTo(bL[0], bL[1]);
  ctx.lineTo(bR[0], bR[1]);
  edge(bR, hR, 1);
  ctx.quadraticCurveTo((hR[0] + hRi[0]) * 0.5, (hR[1] + hRi[1]) * 0.5 + 1.4 * s, hRi[0], hRi[1]);
  if (split > 0.02) {
    ctx.lineTo(notch[0], notch[1]);
    ctx.lineTo(hLi[0], hLi[1]);
  }
  ctx.quadraticCurveTo((hL[0] + hLi[0]) * 0.5, (hL[1] + hLi[1]) * 0.5 + 1.4 * s, hL[0], hL[1]);
  edge(hL, bL, -1);
  ctx.closePath();

  ctx.strokeStyle = css(contour, 0.85);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const g = ctx.createLinearGradient(
    bL[0] + KEY_X * 10 * s,
    bL[1] + KEY_Y * 10 * s,
    hR[0] - KEY_X * 6 * s,
    hR[1] + 4 * s
  );
  g.addColorStop(0, css(mixc(light, [255, 248, 232], 0.3)));
  g.addColorStop(0.3, css(mixc(base, light, 0.35)));
  g.addColorStop(0.66, css(base));
  // The hem is the part furthest from any lamp and closest to the ground, and
  // cloth that does not go dark down there floats.
  g.addColorStop(1, css(mixc(dark, base, 0.25)));
  ctx.fillStyle = g;
  ctx.fill();

  // Folds. Cloth hangs in verticals that converge on the belt, and a dark
  // crease with a lit ridge beside it is the whole difference between a skirt
  // and a triangle of paint. They stop short of the hem so the bottom edge
  // stays a single silhouette.
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 5; i++) {
    const u = -0.8 + i * 0.4;
    const b = belt(u);
    const h = hem(u * (1 + gap * 0.4));
    const deep = 1 - Math.abs(u) * 0.25;
    ctx.beginPath();
    ctx.moveTo(b[0], b[1] + 1.5 * s);
    ctx.quadraticCurveTo((b[0] + h[0]) * 0.5 - 1.4 * s, (b[1] + h[1]) * 0.5, h[0], h[1]);
    ctx.strokeStyle = css(dark, 0.42 * deep);
    ctx.lineWidth = Math.max(0.8, 1.3 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b[0] + 1.5 * s, b[1] + 1.5 * s);
    ctx.quadraticCurveTo((b[0] + h[0]) * 0.5 + 0.2 * s, (b[1] + h[1]) * 0.5, h[0] + 1.5 * s, h[1]);
    ctx.strokeStyle = css(light, 0.22 * deep);
    ctx.lineWidth = Math.max(0.6, 0.8 * s);
    ctx.stroke();
  }
  // The body's own shadow across the top of the cloth, where the trunk
  // overhangs it.
  const bc = belt(0);
  contactAO(ctx, bc[0], bc[1] + 1 * s, Math.abs(ux) * 1.6, 0.4);
  ctx.restore();

  // The emblem rides on the cloth, not on the chest, when the def asks for it.
  if (K.emblem) {
    const e = hem(0);
    const b = belt(0);
    const ex = lerp(b[0], e[0], 0.42);
    const ey = lerp(b[1], e[1], 0.42);
    const w = 3 * s;
    ctx.fillStyle = css(tint(K.emblem), 0.85);
    ctx.fillRect(ex - w * 0.32, ey - w * 1.5, w * 0.64, w * 3);
    ctx.fillRect(ex - w * 1.2, ey - w * 0.32, w * 2.4, w * 0.64);
  }
  ctx.restore();
}

function drawCape(ctx, P, D, def, st, s, cosF, sinF, px, py, tint) {
  const M = def.colors;
  const shL = P.shoulderL;
  const shR = P.shoulderR;

  // A cloak hangs off the back. Facing the camera you should see only its
  // edges past the shoulders; facing away it covers the whole figure.
  const away = clamp01(0.5 - sinF * 0.5);
  const widthK = 0.44 + 0.56 * away;
  const lenK = 0.55 + 0.45 * away;

  const cx = (shL[0] + shR[0]) / 2;
  const lx = cx + (shL[0] - cx) * widthK;
  const rx = cx + (shR[0] - cx) * widthK;
  const topY = (shL[1] + shR[1]) / 2 - 2 * s;

  // Trails opposite to travel and lifts when running.
  const drift = (st.speed || 0) * 16 + 5;
  const flap = Math.sin(st.t * 6 + (st.phase || 0)) * 3 * (0.4 + (st.speed || 0));
  const backX = -cosF * drift * s;
  const backY = (-sinF * drift * ISO_Y - drift * 0.5) * s;
  const len = (def.capeLen ?? 44) * s * lenK;

  ctx.beginPath();
  ctx.moveTo(shL[0], topY);
  ctx.lineTo(shR[0], topY);
  ctx.quadraticCurveTo(rx + backX * 0.6 + flap, topY + len * 0.55 + backY * 0.4, rx + backX + flap * 1.6, topY + len + backY);
  ctx.quadraticCurveTo(cx + backX, topY + len * 1.16 + backY, lx + backX - flap * 1.6, topY + len + backY);
  ctx.quadraticCurveTo(lx + backX * 0.6 - flap, topY + len * 0.55 + backY * 0.4, shL[0], topY);
  ctx.closePath();
  const g = ctx.createLinearGradient(lx, topY, rx, topY + len);
  g.addColorStop(0, css(tint(def.capeColorLight || M.torsoLight)));
  g.addColorStop(0.5, css(tint(def.capeColor || M.torso)));
  g.addColorStop(1, css(tint(def.capeColorDark || M.torsoDark)));
  ctx.fillStyle = g;
  ctx.fill();
  // Fold lines
  ctx.strokeStyle = 'rgba(12,12,16,0.28)';
  ctx.lineWidth = 1.4;
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    ctx.beginPath();
    ctx.moveTo(lerp(shL[0], shR[0], t), topY);
    ctx.lineTo(lerp(lx, rx, t) + backX * 0.9, topY + len * (0.9 + t * 0.1) + backY);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

function drawWeapon(ctx, P, D, def, st, s, cosF, sinF, tint, emis) {
  const hand = def.weaponHand || 'R';
  const Hd = P['hand' + hand];
  const El = P['elbow' + hand];
  if (!Hd) return;
  const M = def.colors;
  // The weapon points away from the forearm, twisted by the swing.
  const fa = Math.atan2(Hd[1] - El[1], Hd[0] - El[0]);
  const ang = fa + (p_weaponSpin(P) || 0) * 0.34 + (def.weaponTilt ?? 0);
  const L = (def.weaponLen ?? 40) * s;
  const w = def.weapon;

  ctx.save();
  ctx.translate(Hd[0], Hd[1]);
  ctx.rotate(ang);

  const metal = tint(def.weaponMetal || M.metal || PAL.steel);
  const metalD = tint(def.weaponMetalDark || M.metalDark || PAL.steelDark);
  const metalL = tint(def.weaponMetalLight || M.metalLight || PAL.steelLight);
  const wood = tint(PAL.wood);

  if (w === 'sword' || w === 'greatsword') {
    const bl = w === 'greatsword' ? L * 1.35 : L;
    const bw = w === 'greatsword' ? 4.4 * s : 3.2 * s;
    // Grip
    ctx.fillStyle = css(tint(PAL.leatherDark));
    ctx.fillRect(-9 * s, -1.6 * s, 11 * s, 3.2 * s);
    // Pommel
    ctx.fillStyle = css(metalD);
    ctx.beginPath();
    ctx.arc(-10 * s, 0, 2.6 * s, 0, TAU);
    ctx.fill();
    // Crossguard
    ctx.fillStyle = css(metal);
    ctx.fillRect(1 * s, -7 * s, 2.8 * s, 14 * s);
    // Blade
    ctx.beginPath();
    ctx.moveTo(3 * s, -bw);
    ctx.lineTo(bl - 7 * s, -bw * 0.8);
    ctx.lineTo(bl, 0);
    ctx.lineTo(bl - 7 * s, bw * 0.8);
    ctx.lineTo(3 * s, bw);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -bw, 0, bw);
    g.addColorStop(0, css(metalL));
    g.addColorStop(0.42, css(metal));
    g.addColorStop(0.55, css(metalL));
    g.addColorStop(1, css(metalD));
    ctx.fillStyle = g;
    ctx.fill();
    // Fuller
    ctx.strokeStyle = css(metalD, 0.5);
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.moveTo(5 * s, 0);
    ctx.lineTo(bl - 9 * s, 0);
    ctx.stroke();
  } else if (w === 'axe') {
    ctx.fillStyle = css(wood);
    ctx.fillRect(-9 * s, -1.8 * s, L * 0.82, 3.6 * s);
    ctx.beginPath();
    ctx.moveTo(L * 0.5, -3 * s);
    ctx.quadraticCurveTo(L * 0.72, -13 * s, L * 0.86, -6 * s);
    ctx.quadraticCurveTo(L * 0.9, 0, L * 0.86, 6 * s);
    ctx.quadraticCurveTo(L * 0.72, 13 * s, L * 0.5, 3 * s);
    ctx.closePath();
    const g = ctx.createLinearGradient(L * 0.5, 0, L * 0.9, 0);
    g.addColorStop(0, css(metalD));
    g.addColorStop(0.6, css(metal));
    g.addColorStop(1, css(metalL));
    ctx.fillStyle = g;
    ctx.fill();
  } else if (w === 'mace') {
    // Haft with an iron ferrule, then the flanged head.
    ctx.fillStyle = css(wood);
    ctx.fillRect(-9 * s, -1.8 * s, L * 0.78, 3.6 * s);
    ctx.fillStyle = css(metalD);
    ctx.fillRect(L * 0.62, -2.3 * s, 5 * s, 4.6 * s);
    ctx.fillStyle = css(metalD);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.beginPath();
      ctx.moveTo(L * 0.82 + Math.cos(a) * 5 * s, Math.sin(a) * 5 * s);
      ctx.lineTo(L * 0.82 + Math.cos(a) * 10 * s, Math.sin(a) * 10 * s);
      ctx.lineTo(L * 0.82 + Math.cos(a + 0.5) * 5 * s, Math.sin(a + 0.5) * 5 * s);
      ctx.closePath();
      ctx.fill();
    }
    const hg = ctx.createRadialGradient(
      L * 0.82 - 2 * s,
      -2 * s,
      0.5 * s,
      L * 0.82,
      0,
      6.5 * s
    );
    hg.addColorStop(0, css(metalL));
    hg.addColorStop(0.6, css(metal));
    hg.addColorStop(1, css(metalD));
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(L * 0.82, 0, 6 * s, 0, TAU);
    ctx.fill();
    if (def.weaponGlow) {
      // Something is loose inside the head, and it wants out.
      ctx.strokeStyle = css(def.weaponGlow, 0.85);
      ctx.lineWidth = 1.4 * s;
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + 0.4;
        ctx.beginPath();
        ctx.arc(L * 0.82, 0, 4.2 * s, a, a + 1.1);
        ctx.stroke();
      }
      ctx.fillStyle = css(def.weaponGlow, 0.9);
      ctx.beginPath();
      ctx.arc(L * 0.82, 0, 1.9 * s, 0, TAU);
      ctx.fill();
      if (emis) {
        const wx = Hd[0] + Math.cos(ang) * L * 0.82;
        const wy = Hd[1] + Math.sin(ang) * L * 0.82;
        emis(wx, wy, 13 * s, def.weaponGlow, 0.8);
      }
    }
  } else if (w === 'spear') {
    ctx.fillStyle = css(wood);
    ctx.fillRect(-L * 0.4, -1.6 * s, L * 1.3, 3.2 * s);
    ctx.beginPath();
    ctx.moveTo(L * 0.9, -4 * s);
    ctx.lineTo(L * 1.18, 0);
    ctx.lineTo(L * 0.9, 4 * s);
    ctx.closePath();
    ctx.fillStyle = css(metalL);
    ctx.fill();
  } else if (w === 'staff') {
    ctx.fillStyle = css(wood);
    ctx.fillRect(-L * 0.45, -2 * s, L * 1.4, 4 * s);
    // Knotted head holding a stone
    ctx.fillStyle = css(tint(PAL.woodLight));
    ctx.beginPath();
    ctx.arc(L * 0.92, 0, 5.5 * s, 0, TAU);
    ctx.fill();
    const gem = def.gem || PAL.amber;
    ctx.fillStyle = css(tint(gem));
    ctx.beginPath();
    ctx.arc(L * 0.92, 0, 3.4 * s, 0, TAU);
    ctx.fill();
    if (emis) {
      const gx = Hd[0] + Math.cos(ang) * L * 0.92;
      const gy = Hd[1] + Math.sin(ang) * L * 0.92;
      emis(gx, gy, 8 * s, gem, 0.65);
    }
  } else if (w === 'bow') {
    // Held across the body with the limbs upright, not as a hoop lying flat.
    ctx.save();
    ctx.rotate(-Math.PI / 2);
    const R = L * 0.62;
    const open = 1.15; // half-angle of the stave
    ctx.strokeStyle = css(wood);
    ctx.lineWidth = 2.8 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, R, -open, open);
    ctx.stroke();
    // Recurved tips
    ctx.lineWidth = 2 * s;
    for (const d of [-1, 1]) {
      const ax = Math.cos(d * open) * R;
      const ay = Math.sin(d * open) * R;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(ax - R * 0.16, ay + d * R * 0.22, ax - R * 0.32, ay + d * R * 0.3);
      ctx.stroke();
    }
    // Grip
    ctx.strokeStyle = css(tint(PAL.leatherDark));
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.arc(0, 0, R, -0.22, 0.22);
    ctx.stroke();
    // String
    ctx.strokeStyle = 'rgba(226,220,200,0.7)';
    ctx.lineWidth = 1.1 * s;
    ctx.beginPath();
    ctx.moveTo(Math.cos(-open) * R - R * 0.32, Math.sin(-open) * R - R * 0.3);
    ctx.lineTo(Math.cos(open) * R - R * 0.32, Math.sin(open) * R + R * 0.3);
    ctx.stroke();
    ctx.restore();
  } else if (w === 'claw') {
    // A pincer, not three fingernails. Two chitin halves on one hinge: a heavy
    // fixed jaw below and a lighter one above that opens as the thing winds up
    // and slams shut on the strike. The serrations along the inside are what
    // make it a crab's claw and not a pair of tongs.
    const shell = tint(def.shell || PAL.bone);
    const shellD = tint(mixc(def.shell || PAL.bone, [12, 8, 6], 0.55));
    const shellL = tint(mixc(def.shell || PAL.bone, [255, 240, 210], 0.45));
    // Wind-up opens it, the strike closes it.
    let gape = 0.34;
    if (st.anim === 'attack' || st.anim === 'attack2') {
      gape = st.animT < 0.36 ? 0.34 + st.animT * 1.6 : Math.max(0.06, 0.9 - (st.animT - 0.36) * 3.4);
    }
    // The wrist knuckle the two halves hinge on.
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.3, L * 0.26, 0, 0, TAU);
    ctx.fillStyle = sphereFill(ctx, 0, 0, L * 0.3, shell, shellD, shellL, shellL);
    ctx.fill();

    const jaw = (dir, len, thick) => {
      ctx.save();
      ctx.rotate(dir * gape);
      ctx.beginPath();
      ctx.moveTo(L * 0.1, dir * thick * 0.2);
      ctx.quadraticCurveTo(L * 0.5, dir * thick, L * len, dir * thick * 0.34);
      ctx.quadraticCurveTo(L * (len + 0.16), 0, L * len, -dir * thick * 0.08);
      ctx.quadraticCurveTo(L * 0.5, -dir * thick * 0.1, L * 0.1, -dir * thick * 0.2);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(8,7,9,0.9)';
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.stroke();
      const g = ctx.createLinearGradient(0, -dir * thick, L * len, dir * thick);
      g.addColorStop(0, css(shellL));
      g.addColorStop(0.5, css(shell));
      g.addColorStop(1, css(shellD));
      ctx.fillStyle = g;
      ctx.fill();
      // Teeth along the closing edge.
      ctx.fillStyle = css(shellD, 0.9);
      for (let i = 0; i < 4; i++) {
        const t = 0.24 + i * 0.16;
        ctx.beginPath();
        ctx.moveTo(L * len * t, -dir * thick * 0.12);
        ctx.lineTo(L * len * (t + 0.07), -dir * thick * 0.12);
        ctx.lineTo(L * len * (t + 0.035), dir * thick * 0.18);
        ctx.closePath();
        ctx.fill();
      }
      // A hard lit ridge along the back of the jaw.
      ctx.strokeStyle = css(shellL, 0.6);
      ctx.lineWidth = Math.max(0.7, 1 * s);
      ctx.beginPath();
      ctx.moveTo(L * 0.16, dir * thick * 0.62);
      ctx.quadraticCurveTo(L * 0.55, dir * thick * 0.92, L * len * 0.94, dir * thick * 0.36);
      ctx.stroke();
      ctx.restore();
    };
    jaw(1, 1.05, 5.2 * s);
    jaw(-1, 0.92, 3.8 * s);
  } else if (w === 'scythe') {
    ctx.fillStyle = css(wood);
    ctx.fillRect(-L * 0.35, -2 * s, L * 1.2, 4 * s);
    ctx.beginPath();
    ctx.moveTo(L * 0.82, 0);
    ctx.quadraticCurveTo(L * 1.3, -6 * s, L * 1.25, -24 * s);
    ctx.quadraticCurveTo(L * 1.05, -8 * s, L * 0.8, -4 * s);
    ctx.closePath();
    ctx.fillStyle = css(metalL);
    ctx.fill();
  }

  ctx.restore();

  // Motion arc while striking — reads as speed without a particle system.
  const anim = st.anim;
  if ((anim === 'attack' || anim === 'attack2' || anim === 'thrust') && st.animT > 0.33 && st.animT < 0.68) {
    const k = clamp01((st.animT - 0.33) / 0.35);
    const alpha = Math.sin(k * Math.PI) * 0.5;
    const spread = anim === 'thrust' ? 0.4 : 2.1;
    const dir = anim === 'attack2' ? -1 : 1;
    ctx.save();
    ctx.translate(Hd[0], Hd[1]);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = css(def.trail || PAL.steelLight, alpha);
    ctx.lineWidth = 3.5 * s;
    ctx.beginPath();
    ctx.arc(0, 0, L * 0.85, ang - dir * spread * (1 - k) - dir * 0.2, ang + dir * 0.1);
    ctx.stroke();
    ctx.lineWidth = 1.4 * s;
    ctx.strokeStyle = css([255, 255, 255], alpha * 0.8);
    ctx.stroke();
    ctx.restore();
  }
}

// Small accessor so drawWeapon can read the spin the pose produced.
function p_weaponSpin(P) {
  return P.__spin || 0;
}

function drawOffhand(ctx, P, D, def, st, s, cosF, sinF, tint, emis) {
  const hand = def.weaponHand === 'L' ? 'R' : 'L';
  const Hd = P['hand' + hand];
  const El = P['elbow' + hand];
  if (!Hd) return;
  const M = def.colors;
  const fa = Math.atan2(Hd[1] - El[1], Hd[0] - El[0]);

  if (def.offhand === 'shield') {
    ctx.save();
    ctx.translate(Hd[0], Hd[1]);
    ctx.rotate(fa * 0.25);
    const rw = 11 * s;
    const rh = 15 * s;
    ctx.beginPath();
    ctx.moveTo(-rw, -rh);
    ctx.lineTo(rw, -rh);
    ctx.lineTo(rw, rh * 0.25);
    ctx.quadraticCurveTo(0, rh * 1.35, -rw, rh * 0.25);
    ctx.closePath();
    const g = ctx.createLinearGradient(-rw, -rh, rw, rh);
    g.addColorStop(0, css(tint(def.shieldLight || M.metalLight)));
    g.addColorStop(0.5, css(tint(def.shieldColor || PAL.orderWhite)));
    g.addColorStop(1, css(tint(def.shieldDark || M.metalDark)));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = css(tint(def.shieldEmblem || PAL.orderBlack), 0.88);
    ctx.fillRect(-1.9 * s, -rh * 0.8, 3.8 * s, rh * 1.6);
    ctx.fillRect(-rw * 0.72, -2 * s, rw * 1.44, 4 * s);
    ctx.restore();
    ctx.strokeStyle = css(tint(M.metalDark), 0.85);
    ctx.lineWidth = 1.8 * s;
    ctx.stroke();
    ctx.restore();
  } else if (def.offhand === 'torch') {
    ctx.save();
    ctx.translate(Hd[0], Hd[1]);
    ctx.rotate(fa - 0.5);
    ctx.fillStyle = css(tint(PAL.wood));
    ctx.fillRect(-4 * s, -1.4 * s, 16 * s, 2.8 * s);
    const fx = 17 * s;
    const g = ctx.createRadialGradient(fx, 0, 0, fx, 0, 7 * s);
    g.addColorStop(0, css(PAL.torchCore, 0.95));
    g.addColorStop(0.5, css(PAL.torch, 0.7));
    g.addColorStop(1, css(PAL.torch, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, 0, 7 * s, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (emis) {
      emis(Hd[0] + Math.cos(fa - 0.5) * 17 * s, Hd[1] + Math.sin(fa - 0.5) * 17 * s, 12 * s, PAL.torch, 0.9);
    }
  } else if (def.offhand === 'orb') {
    const gem = def.gem || PAL.bogfire;
    ctx.fillStyle = css(tint(gem), 0.9);
    ctx.beginPath();
    ctx.arc(Hd[0], Hd[1] - 2 * s, 4.4 * s, 0, TAU);
    ctx.fill();
    // Kept small on purpose: the bloom buffer blurs whatever goes into it and
    // adds it back over the frame, so an orb this close to the body washes the
    // figure holding it before it ever reads as a light.
    if (emis) emis(Hd[0], Hd[1] - 2 * s, 7 * s, gem, 0.5);
  }
}

// ---------------------------------------------------------------------------
// Non-humanoid body plans
// ---------------------------------------------------------------------------

/** Wolf / dire beast: four legs, low slung, head thrust forward. */
export function poseQuadruped(st, build = {}) {
  const { bodyLen = 40, bodyH = 42, legLen = 32, headFwd = 32, headH = 48 } = build;
  const t = st.t;
  const phase = st.phase || 0;
  const speed = clamp01(st.speed || 0);
  const p = {};
  let crouch = 0;
  let lunge = 0;
  let headDrop = 0;

  const at = st.animT || 0;
  if (st.anim === 'attack') {
    if (at < 0.4) {
      crouch += 6 * (at / 0.4);
      headDrop += 4 * (at / 0.4);
    } else if (at < 0.6) {
      const e = (at - 0.4) / 0.2;
      lunge += 16 * e;
      crouch -= 4 * e;
      headDrop -= 8 * e;
    } else {
      const e = (at - 0.6) / 0.4;
      lunge += 16 * (1 - e);
    }
  } else if (st.anim === 'die') {
    crouch += at * bodyH * 0.8;
  } else if (st.anim === 'hit') {
    crouch += (1 - at) * 4;
  }

  const bounce = speed > 0.02 ? Math.abs(Math.sin(phase)) * 4 * speed : Math.sin(t * 1.6) * 0.8;
  const bz = bodyH + bounce - crouch;

  // Haunches sit lower than the shoulders, which is what makes a wolf a wolf.
  p.hind = [-bodyLen * 0.5 + lunge * 0.3, 0, bz - 2];
  p.chestC = [bodyLen * 0.44 + lunge, 0, bz + 4];
  p.neck = [bodyLen * 0.66 + lunge, 0, bz + 7 - headDrop * 0.4];
  p.head = [headFwd + lunge * 1.2, 0, headH + bounce * 0.6 - crouch - headDrop];
  p.snout = [headFwd + 11 + lunge * 1.2, 0, headH - 5.5 + bounce * 0.6 - crouch - headDrop];
  p.tail = [-bodyLen * 0.74, Math.sin(t * 4 + phase) * 5, bz + 4];
  p.tailTip = [-bodyLen * 1.15, Math.sin(t * 4 + phase + 1) * 12, bz + 10 + Math.sin(t * 3) * 4];

  const leg = (baseX, side, ph) => {
    const swing = speed > 0.02 ? Math.sin(ph) * 0.85 * speed : Math.sin(t * 1.6 + side) * 0.03;
    const lift = speed > 0.02 ? Math.max(0, Math.sin(ph - 0.5)) * 5 * speed : 0;
    const kx = baseX + Math.sin(swing) * legLen * 0.5;
    const kz = bz - legLen * 0.52;
    const fx = kx + Math.sin(swing) * legLen * 0.55;
    const fz = Math.max(0, kz - legLen * 0.5) + lift;
    return { hip: [baseX, side * 8, bz], knee: [kx, side * 8, kz], foot: [fx, side * 8, fz] };
  };

  const fl = leg(bodyLen * 0.4 + lunge, 1, phase);
  const fr = leg(bodyLen * 0.4 + lunge, -1, phase + Math.PI);
  const bl = leg(-bodyLen * 0.42, 1, phase + Math.PI);
  const br = leg(-bodyLen * 0.42, -1, phase);
  p.flHip = fl.hip;
  p.flKnee = fl.knee;
  p.flFoot = fl.foot;
  p.frHip = fr.hip;
  p.frKnee = fr.knee;
  p.frFoot = fr.foot;
  p.blHip = bl.hip;
  p.blKnee = bl.knee;
  p.blFoot = bl.foot;
  p.brHip = br.hip;
  p.brKnee = br.knee;
  p.brFoot = br.foot;
  return p;
}

export function drawQuadruped(ctx, def, st, px, py, s, emis) {
  const facing = st.facing || 0;
  const cosF = Math.cos(facing);
  const sinF = Math.sin(facing);
  const p = poseQuadruped(st, def.build || {});
  const P = {};
  const D = {};
  for (const k in p) {
    const r = rot(p[k], cosF, sinF);
    P[k] = [px + r[0] * s, py + (r[1] * ISO_Y - r[2]) * s];
    D[k] = r[1] / 14;
  }
  const M = def.colors;
  const flash = st.flash || 0;
  const tint = (c) => (flash > 0 ? mixc(c, [255, 236, 220], flash) : c);
  const rimC = def.rim || PAL.moon;
  const rimA = (def.rimA ?? 0.45) * (1 - flash * 0.6);

  ctx.save();
  if ((st.alpha ?? 1) < 1) ctx.globalAlpha = st.alpha;

  // The beasts were painted flat — one colour per part, picked by which way
  // the part faced — while the men beside them were lit as cylinders. Next to
  // a knight with a terminator running down his arm, a wolf read as a cutout
  // of a wolf. Same recipe as the humanoid now: a near-black contour to hold
  // it off the ground, a cylinder gradient across the short axis, and the moon
  // on the upper edge.
  const contour = [8, 7, 9];
  const bone = (a, b, r0, r1, base, dark, light, depth) => {
    const A = P[a];
    const B = P[b];
    if (!A || !B) return;
    capsule(ctx, A[0], A[1], B[0], B[1], r0 * s + 1, r1 * s + 1);
    ctx.fillStyle = css(contour, 0.85);
    ctx.fill();
    const d = clamp01(0.5 + clamp(depth * 0.8, -0.5, 0.5));
    capsule(ctx, A[0], A[1], B[0], B[1], r0 * s, r1 * s);
    ctx.fillStyle = cylinderFill(
      ctx, A[0], A[1], B[0], B[1], r0 * s, r1 * s,
      tint(mixc(dark, base, 0.35 + d * 0.65)),
      tint(mixc(contour, dark, 0.55 + d * 0.3)),
      tint(mixc(base, light, 0.45 + d * 0.5)),
      tint(mixc(light, [255, 250, 236], 0.3 * d))
    );
    ctx.fill();
    if (rimA > 0.01) {
      capsule(ctx, A[0] - 1.2, A[1] - 1.8, B[0] - 1.2, B[1] - 1.8, r0 * s * 0.42, r1 * s * 0.42);
      ctx.fillStyle = css(tint(rimC), rimA * 0.5);
      ctx.fill();
    }
  };

  /** A muscle mass laid over the frame — haunch, shoulder, cheek. */
  const mass = (joint, rx, ry, depth, rot = 0) => {
    const J = P[joint];
    if (!J) return;
    ctx.save();
    ctx.translate(J[0], J[1]);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * s, ry * s, 0, 0, TAU);
    const d = clamp01(0.5 + clamp(depth * 0.8, -0.5, 0.5));
    ctx.fillStyle = sphereFill(
      ctx, 0, 0, Math.max(rx, ry) * s,
      tint(mixc(M.torsoDark, M.torso, 0.35 + d * 0.65)),
      tint(mixc(contour, M.torsoDark, 0.6)),
      tint(mixc(M.torso, M.torsoLight, 0.5)),
      tint(mixc(M.torsoLight, [255, 250, 240], 0.3))
    );
    ctx.fill();
    ctx.restore();
  };

  const legPair = (pre, depth) => {
    bone(pre + 'Hip', pre + 'Knee', 5.2, 3.6, M.legs, M.legsDark, M.legsLight, depth);
    bone(pre + 'Knee', pre + 'Foot', 3.6, 2.6, M.legs, M.legsDark, M.legsLight, depth);
    const F = P[pre + 'Foot'];
    ctx.beginPath();
    ctx.ellipse(F[0], F[1], 4 * s, 2.4 * s, 0, 0, TAU);
    ctx.fillStyle = css(tint(M.legsDark));
    ctx.fill();
  };

  const far = [];
  const near = [];
  for (const pre of ['fl', 'fr', 'bl', 'br']) {
    (D[pre + 'Hip'] < 0 ? far : near).push(pre);
  }
  for (const pre of far) legPair(pre, -1);

  // Tail
  bone('hind', 'tail', 3, 2.4, M.torso, M.torsoDark, M.torsoLight, 0);
  bone('tail', 'tailTip', 2.4, 1.2, M.torso, M.torsoDark, M.torsoLight, 0);

  // Body — deep chest tapering to a narrow waist.
  bone('hind', 'chestC', 11.5, 13.5, M.torso, M.torsoDark, M.torsoLight, 0.2);
  bone('chestC', 'neck', 12, 8, M.torso, M.torsoDark, M.torsoLight, 0.3);
  // The two masses that make an animal read as an animal: the haunch driving
  // the back leg and the shoulder under the front one.
  mass('hind', 13, 11, 0.1, 0.2);
  mass('chestC', 12, 11.5, 0.3, -0.15);

  // Shaggy back — tapered tufts along the spine rather than a row of pins,
  // each one leaning back the way fur lies on a running animal.
  if (def.shaggy) {
    ctx.save();
    const A = P.hind;
    const B = P.neck;
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      const x = lerp(A[0], B[0], t);
      const y = lerp(A[1], B[1], t) - 10 * s;
      const len = (4.5 + ((i * 0.618) % 1) * 3.6) * s;
      const lean = (B[0] - A[0]) / (Math.hypot(B[0] - A[0], B[1] - A[1]) || 1);
      ctx.beginPath();
      ctx.moveTo(x - 2.2 * s, y + 1.5 * s);
      ctx.quadraticCurveTo(x - lean * len * 0.4, y - len * 0.7, x - lean * len * 0.8, y - len);
      ctx.quadraticCurveTo(x + 0.4 * s, y - len * 0.5, x + 2.2 * s, y + 1.5 * s);
      ctx.closePath();
      ctx.fillStyle = css(tint(i % 3 ? M.torsoDark : mixc(M.torsoDark, M.torso, 0.5)), 0.9);
      ctx.fill();
    }
    ctx.restore();
  }

  // The ruff: a collar of thick fur where the neck meets the shoulders. On a
  // wolf it is the widest part of the animal from the front, and it is what
  // stops the head reading as a knob on the end of a tube.
  if (def.ruff !== false) {
    const N = P.neck;
    const C = P.chestC;
    if (N && C) {
      const ax = N[0] - C[0];
      const ay = N[1] - C[1];
      const al = Math.hypot(ax, ay) || 1;
      const ux = ax / al;
      const uy = ay / al;
      const cx = N[0] - ux * 3 * s;
      const cy = N[1] - uy * 3 * s;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(uy, ux));
      ctx.beginPath();
      const spikes = 13;
      for (let i = 0; i <= spikes; i++) {
        const a = -Math.PI / 2 + (i / spikes) * Math.PI * 2;
        const rr = (i % 2 ? 13 : 11) * s;
        const x = Math.cos(a) * rr * 0.5;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = css(contour, 0.8);
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i <= spikes; i++) {
        const a = -Math.PI / 2 + (i / spikes) * Math.PI * 2;
        const rr = (i % 2 ? 11.6 : 9.8) * s;
        const x = Math.cos(a) * rr * 0.5;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const rg = ctx.createLinearGradient(-8 * s, -12 * s, 6 * s, 12 * s);
      rg.addColorStop(0, css(tint(mixc(M.torsoLight, [255, 248, 232], 0.2))));
      rg.addColorStop(0.5, css(tint(M.torso)));
      rg.addColorStop(1, css(tint(mixc(M.torsoDark, contour, 0.4))));
      ctx.fillStyle = rg;
      ctx.fill();
      ctx.restore();
    }
  }

  // Head
  bone('neck', 'head', 8.5, 7.6, M.torso, M.torsoDark, M.torsoLight, 0.4);
  bone('head', 'snout', 6.4, 4, M.torso, M.torsoDark, M.torsoLight, 0.5);
  const Hd = P.head;
  const Sn = P.snout;
  // Muzzle top and nose
  ctx.beginPath();
  ctx.arc(Sn[0], Sn[1], 2.6 * s, 0, TAU);
  ctx.fillStyle = css(tint(M.legsDark));
  ctx.fill();
  // Ears — tall triangles, the wolf's whole read at small size.
  for (const d of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(Hd[0] + d * 4.2 * s, Hd[1] - 4 * s);
    ctx.lineTo(Hd[0] + d * 7.4 * s, Hd[1] - 16 * s);
    ctx.lineTo(Hd[0] + d * 1.2 * s, Hd[1] - 7 * s);
    ctx.closePath();
    ctx.fillStyle = css(tint(shadeFor(d * 0.5, M.torso, M.torsoDark, M.torsoLight)));
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(Hd[0] + d * 4.4 * s, Hd[1] - 5.4 * s);
    ctx.lineTo(Hd[0] + d * 6.2 * s, Hd[1] - 13 * s);
    ctx.lineTo(Hd[0] + d * 2.8 * s, Hd[1] - 7.4 * s);
    ctx.closePath();
    ctx.fillStyle = css(tint(M.torsoDark), 0.75);
    ctx.fill();
  }
  // Eyes
  const front = clamp01(sinF * 1.3 + 0.3);
  if (front > 0.03 && def.glowEyes) {
    ctx.save();
    ctx.globalAlpha = front;
    ctx.fillStyle = css(def.glowEyes, 0.95);
    ctx.beginPath();
    ctx.ellipse(Hd[0] - 2.4 * s - cosF * s, Hd[1] - 1 * s, 1.5 * s, 1.1 * s, 0, 0, TAU);
    ctx.ellipse(Hd[0] + 2.4 * s - cosF * s, Hd[1] - 1 * s, 1.5 * s, 1.1 * s, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (emis) emis(Hd[0], Hd[1] - 1 * s, 8 * s, def.glowEyes, 0.7 * front);
  }
  // Teeth on the lunge
  if (st.anim === 'attack' && st.animT > 0.35 && st.animT < 0.7) {
    ctx.fillStyle = css(tint(PAL.bone), 0.9);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(Sn[0] + i * 1.4 * s, Sn[1] - 1 * s);
      ctx.lineTo(Sn[0] + i * 1.4 * s + 0.7 * s, Sn[1] + 2.6 * s);
      ctx.lineTo(Sn[0] + i * 1.4 * s + 1.4 * s, Sn[1] - 1 * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  for (const pre of near) legPair(pre, 1);
  ctx.restore();
}

/** Bog wraith: no legs, a hovering column of rag and mist. */
export function drawWraith(ctx, def, st, px, py, s, emis) {
  const t = st.t;
  const facing = st.facing || 0;
  const cosF = Math.cos(facing);
  const sinF = Math.sin(facing);
  const M = def.colors;
  const flash = st.flash || 0;
  const tint = (c) => (flash > 0 ? mixc(c, [255, 240, 230], flash) : c);
  const hover = Math.sin(t * 1.5) * 4 * s;
  const H = (def.build?.height ?? 92) * s;
  const alpha = (st.alpha ?? 1) * (def.ghostly ? 0.86 : 1);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Shoulders hunched under the cowl, then rags streaming down into mist.
  const shoulderY = py - H * 0.82 - hover;
  const ribbons = 9;
  for (let i = 0; i < ribbons; i++) {
    const u = i / (ribbons - 1) - 0.5;
    const topX = px + u * 22 * s;
    const sway = Math.sin(t * 2.0 + i * 1.1) * 6 * s;
    const len = H * (0.74 + 0.22 * Math.cos(u * 2.6));
    const wdt = (2.6 + 2.4 * Math.cos(u * 2.2)) * s;
    ctx.beginPath();
    ctx.moveTo(topX - wdt, shoulderY);
    ctx.quadraticCurveTo(topX + sway * 0.4 - wdt, shoulderY + len * 0.55, topX + sway - wdt * 0.4, shoulderY + len);
    ctx.quadraticCurveTo(topX + sway * 1.3, shoulderY + len * 1.1, topX + sway + wdt * 0.4, shoulderY + len * 0.94);
    ctx.quadraticCurveTo(topX + sway * 0.4 + wdt, shoulderY + len * 0.5, topX + wdt, shoulderY);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, shoulderY, 0, shoulderY + len);
    g.addColorStop(0, css(tint(M.torsoLight), 0.92));
    g.addColorStop(0.45, css(tint(M.torso), 0.78));
    g.addColorStop(1, css(tint(M.torsoDark), 0.02));
    ctx.fillStyle = g;
    ctx.fill();
  }

  // Shoulder mantle
  ctx.beginPath();
  ctx.moveTo(px - 24 * s, shoulderY + 8 * s);
  ctx.quadraticCurveTo(px - 20 * s, shoulderY - 10 * s, px, shoulderY - 12 * s);
  ctx.quadraticCurveTo(px + 20 * s, shoulderY - 10 * s, px + 24 * s, shoulderY + 8 * s);
  ctx.quadraticCurveTo(px, shoulderY + 2 * s, px - 24 * s, shoulderY + 8 * s);
  ctx.closePath();
  const mg = ctx.createLinearGradient(px - 24 * s, shoulderY - 12 * s, px + 24 * s, shoulderY + 8 * s);
  mg.addColorStop(0, css(tint(M.torsoLight)));
  mg.addColorStop(1, css(tint(M.torsoDark)));
  ctx.fillStyle = mg;
  ctx.fill();

  // Cowl — narrow and peaked, not a dome.
  const hx = px - cosF * 2 * s;
  const hy = py - H - hover + 2 * s;
  ctx.beginPath();
  ctx.moveTo(hx - 11 * s, hy + 13 * s);
  ctx.quadraticCurveTo(hx - 13 * s, hy - 12 * s, hx - cosF * 3 * s, hy - 17 * s);
  ctx.quadraticCurveTo(hx + 13 * s, hy - 12 * s, hx + 11 * s, hy + 13 * s);
  ctx.quadraticCurveTo(hx, hy + 5 * s, hx - 11 * s, hy + 13 * s);
  ctx.closePath();
  const hg = ctx.createLinearGradient(hx - 11 * s, hy - 17 * s, hx + 11 * s, hy + 13 * s);
  hg.addColorStop(0, css(tint(M.torsoLight)));
  hg.addColorStop(1, css(tint(M.torsoDark)));
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hx - cosF * 2.5 * s, hy + 1 * s, 6.5 * s, 8.5 * s, 0, 0, TAU);
  ctx.fillStyle = 'rgba(4,6,10,0.92)';
  ctx.fill();

  // Eyes
  const front = clamp01(sinF * 1.3 + 0.35);
  if (front > 0.03) {
    const glow = def.glowEyes || PAL.bogfire;
    ctx.save();
    ctx.globalAlpha = front * alpha;
    ctx.fillStyle = css(glow, 0.95);
    ctx.beginPath();
    ctx.ellipse(hx - 3 * s - cosF * s, hy, 2.1 * s, 1.6 * s, 0, 0, TAU);
    ctx.ellipse(hx + 3 * s - cosF * s, hy, 2.1 * s, 1.6 * s, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (emis) emis(hx, hy, 14 * s, glow, 0.85 * front);
  }

  // Grasping hands
  const reach = st.anim === 'attack' ? Math.sin(clamp01(st.animT * 2) * Math.PI) : 0;
  for (const d of [-1, 1]) {
    const ax = px + d * (20 + reach * 12) * s + cosF * reach * 16 * s;
    const ay = py - H * 0.66 - hover + Math.sin(t * 2 + d) * 3 * s + sinF * reach * 9 * s;
    ctx.strokeStyle = css(tint(M.legs || M.torsoLight), 0.9);
    ctx.lineWidth = 2.2 * s;
    ctx.lineCap = 'round';
    for (let f = -1; f <= 1; f++) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(ax + d * 5 * s, ay + 4 * s, ax + d * 7 * s + f * 2 * s, ay + 9 * s + Math.abs(f) * 2 * s);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Chooses the right body plan. */
/**
 * The figure's shadow on the ground.
 *
 * Until now every actor sat on a soft ellipse, which says "something is here"
 * but nothing about what. Diablo II laid down the unit's own silhouette,
 * flattened onto the floor and sheared away from the light, and that is what
 * made its characters look like they were standing in the scene rather than
 * pasted onto it — the shadow changes shape as the figure moves, so the eye
 * gets a second, free read of the pose.
 *
 * Drawn from the same joints as the body, but every part is one flat dark
 * fill: no gradients, no contours, no detail. A shadow has no interior, and
 * skipping all of that is what keeps a second pass over the rig cheap.
 */
export function drawActorShadow(ctx, def, st, px, py, s, sunDir) {
  if (def.plan === 'wraith') return; // it doesn't touch the ground
  const facing = st.facing || 0;
  const cosF = Math.cos(facing);
  const sinF = Math.sin(facing);
  const build = def.build || {};
  const p = def.pose ? def.pose(st, build) : poseHumanoid(st, build);

  // Shear away from the key light, and squash onto the floor plane.
  const lx = sunDir ? sunDir[0] : -0.5;
  const ly = sunDir ? sunDir[1] : -0.75;
  const len = Math.hypot(lx, ly) || 1;
  const shear = (-lx / len) * 0.85;
  const squash = 0.42;

  const P = {};
  for (const k in p) {
    const v = p[k];
    if (!Array.isArray(v)) continue;
    const r = rot(v, cosF, sinF);
    // Height above the ground becomes length along the floor, which is what
    // makes a raised arm throw a longer shadow than a planted foot.
    const h = r[2];
    P[k] = [px + r[0] * s + h * shear * s, py + (r[1] * ISO_Y - h * squash) * s];
  }

  ctx.save();
  ctx.globalAlpha = (st.alpha ?? 1) * 0.42;
  ctx.fillStyle = '#000';
  const limb = (a, b, r0, r1) => {
    const A = P[a];
    const B = P[b];
    if (!A || !B) return;
    capsule(ctx, A[0], A[1], B[0], B[1], r0 * s, r1 * s);
    ctx.fill();
  };
  const lw = def.limbScale ?? 1;
  if (def.plan === 'quadruped') {
    for (const side of ['L', 'R']) {
      limb('hipF' + side, 'footF' + side, 4 * lw, 3 * lw);
      limb('hipB' + side, 'footB' + side, 4 * lw, 3 * lw);
    }
    limb('chest', 'hip', 9 * lw, 8 * lw);
    limb('neck', 'head', 6 * lw, 6 * lw);
  } else {
    for (const side of ['L', 'R']) {
      limb('hip' + side, 'knee' + side, 6.4 * lw, 5 * lw);
      limb('knee' + side, 'foot' + side, 5 * lw, 3.6 * lw);
      limb('shoulder' + side, 'elbow' + side, 5.6 * lw, 4.4 * lw);
      limb('elbow' + side, 'hand' + side, 4.4 * lw, 3.4 * lw);
    }
    // Torso as one slab between the shoulders and the hips.
    const shL = P.shoulderL;
    const shR = P.shoulderR;
    const hipL = P.hipL;
    const hipR = P.hipR;
    if (shL && shR && hipL && hipR) {
      ctx.beginPath();
      ctx.moveTo(shL[0], shL[1] - 2 * s);
      ctx.lineTo(shR[0], shR[1] - 2 * s);
      ctx.lineTo(hipR[0], hipR[1] + 2 * s);
      ctx.lineTo(hipL[0], hipL[1] + 2 * s);
      ctx.closePath();
      ctx.fill();
    }
    const H = P.head;
    if (H) {
      ctx.beginPath();
      ctx.ellipse(H[0], H[1], (def.headR ?? 7.6) * s, (def.headR ?? 7.6) * s * 0.9, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function renderActor(ctx, def, st, px, py, s, emis) {
  switch (def.plan) {
    case 'quadruped':
      return drawQuadruped(ctx, def, st, px, py, s, emis);
    case 'wraith':
      return drawWraith(ctx, def, st, px, py, s, emis);
    default:
      return drawActor(ctx, def, st, px, py, s, emis);
  }
}
