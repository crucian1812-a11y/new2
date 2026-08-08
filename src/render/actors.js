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

/** Tapered capsule between two screen points. */
function capsule(ctx, x0, y0, x1, y1, r0, r1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1e-4;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const a = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(x0 + nx * r0, y0 + ny * r0);
  ctx.lineTo(x1 + nx * r1, y1 + ny * r1);
  ctx.arc(x1, y1, r1, a + Math.PI / 2, a - Math.PI / 2, true);
  ctx.lineTo(x0 - nx * r0, y0 - ny * r0);
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
export function poseHumanoid(st, build = {}) {
  const {
    hipH = 47,
    chestH = 71,
    neckH = 82,
    headH = 92,
    shoulderW = 13.5,
    hipW = 9,
    thigh = 24,
    shin = 23,
    upperArm = 19,
    foreArm = 18,
  } = build;

  const t = st.t;
  const anim = st.anim || 'idle';
  const at = st.animT || 0;
  const speed = st.speed || 0;
  const p = {};

  // --- base sway -----------------------------------------------------------
  let lean = 0; // forward lean, radians
  let bob = 0;
  let twist = 0; // torso rotation about up-axis
  let crouch = 0;

  const runPhase = st.phase || 0;
  const walkAmt = clamp01(speed);

  if (walkAmt > 0.01) {
    lean += 0.16 * walkAmt;
    bob += Math.sin(runPhase * 2) * 2.2 * walkAmt;
    twist += Math.sin(runPhase) * 0.22 * walkAmt;
  } else {
    bob += Math.sin(t * 1.8) * 0.9;
    lean += Math.sin(t * 0.7) * 0.02;
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
    armSwingR = -Math.sin(runPhase) * 0.75 * walkAmt;
    armSwingL = Math.sin(runPhase) * 0.75 * walkAmt;
  } else {
    armSwingR = Math.sin(t * 1.8 + 0.4) * 0.05 - 0.1;
    armSwingL = Math.sin(t * 1.8) * 0.05 - 0.1;
  }

  switch (anim) {
    case 'attack': {
      // 0 .. 0.35 wind up, 0.35 .. 0.55 strike, rest recover
      const k = at;
      if (k < 0.35) {
        const e = k / 0.35;
        armSwingR = lerp(armSwingR, -1.9, e);
        armLiftR = lerp(0, 0.85, e);
        elbowR = lerp(0.5, 1.5, e);
        twist -= 0.5 * e;
        lean -= 0.1 * e;
        weaponSpin = -1.5 * e;
      } else if (k < 0.55) {
        const e = (k - 0.35) / 0.2;
        const ee = e * e * (3 - 2 * e);
        armSwingR = lerp(-1.9, 1.5, ee);
        armLiftR = lerp(0.85, -0.25, ee);
        elbowR = lerp(1.5, 0.12, ee);
        twist = lerp(-0.5, 0.62, ee);
        lean = lerp(lean - 0.1, lean + 0.34, ee);
        weaponSpin = lerp(-1.5, 2.4, ee);
      } else {
        const e = (k - 0.55) / 0.45;
        armSwingR = lerp(1.5, -0.1, e);
        armLiftR = lerp(-0.25, 0, e);
        elbowR = lerp(0.12, 0.5, e);
        twist = lerp(0.62, 0, e);
        lean = lerp(lean + 0.34, lean, e);
        weaponSpin = lerp(2.4, 0, e);
      }
      break;
    }
    case 'attack2': {
      // Reverse sweep, so consecutive swings alternate.
      const k = at;
      if (k < 0.32) {
        const e = k / 0.32;
        armSwingR = lerp(armSwingR, 1.3, e);
        armLiftR = lerp(0, -0.5, e);
        elbowR = lerp(0.5, 1.3, e);
        twist += 0.5 * e;
        weaponSpin = 2.2 * e;
      } else if (k < 0.52) {
        const e = (k - 0.32) / 0.2;
        const ee = e * e * (3 - 2 * e);
        armSwingR = lerp(1.3, -1.5, ee);
        armLiftR = lerp(-0.5, 0.7, ee);
        elbowR = lerp(1.3, 0.2, ee);
        twist = lerp(0.5, -0.55, ee);
        lean += 0.3 * ee;
        weaponSpin = lerp(2.2, -1.9, ee);
      } else {
        const e = (k - 0.52) / 0.48;
        armSwingR = lerp(-1.5, -0.1, e);
        armLiftR = lerp(0.7, 0, e);
        elbowR = lerp(0.2, 0.5, e);
        twist = lerp(-0.55, 0, e);
        weaponSpin = lerp(-1.9, 0, e);
      }
      break;
    }
    case 'thrust': {
      const k = at;
      if (k < 0.4) {
        const e = k / 0.4;
        armSwingR = lerp(armSwingR, -1.2, e);
        elbowR = lerp(0.5, 1.7, e);
        twist -= 0.35 * e;
      } else if (k < 0.55) {
        const e = (k - 0.4) / 0.15;
        armSwingR = lerp(-1.2, 0.15, e);
        elbowR = lerp(1.7, 0.02, e);
        twist = lerp(-0.35, 0.25, e);
        lean += 0.4 * e;
      } else {
        const e = (k - 0.55) / 0.45;
        armSwingR = lerp(0.15, -0.1, e);
        elbowR = lerp(0.02, 0.5, e);
        twist = lerp(0.25, 0, e);
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
      crouch += at * hipH * 0.9;
      lean += at * 0.5;
      armSwingR = lerp(armSwingR, 1.4, at);
      armSwingL = lerp(armSwingL, 1.2, at);
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
  // Spine tilts forward about the hip.
  const spine = (h) => {
    const dh = h - hipH;
    return [sl * dh, 0, hipH + cl * dh + bob - crouch];
  };

  p.hip = [0, 0, hipH + bob - crouch];
  p.chest = spine(chestH);
  p.neck = spine(neckH);
  p.head = spine(headH);

  const ct = Math.cos(twist);
  const stw = Math.sin(twist);
  const twistPt = (base, sideOff) => [
    base[0] - stw * sideOff,
    base[1] + ct * sideOff,
    base[2],
  ];

  p.shoulderL = twistPt(p.chest, shoulderW);
  p.shoulderR = twistPt(p.chest, -shoulderW);
  p.hipL = [p.hip[0], hipW, p.hip[2]];
  p.hipR = [p.hip[0], -hipW, p.hip[2]];

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
  const legPose = (hipPt, phase, side) => {
    let hipA;
    let kneeA;
    let liftZ = 0;
    if (anim === 'die') {
      hipA = -1.2 - side * 0.3;
      kneeA = 0.9;
    } else if (anim === 'dash') {
      hipA = side > 0 ? -0.9 : 0.7;
      kneeA = 1.1;
    } else if (walkAmt > 0.01) {
      hipA = Math.sin(phase) * 0.85 * walkAmt;
      kneeA = Math.max(0, Math.sin(phase - 0.9)) * 1.25 * walkAmt;
      liftZ = Math.max(0, Math.sin(phase - 0.4)) * 5 * walkAmt;
    } else {
      hipA = Math.sin(t * 1.8 + side) * 0.02;
      kneeA = 0.06;
    }
    const a1 = hipA - Math.PI / 2;
    const kx = hipPt[0] + Math.cos(a1) * thigh;
    const kz = hipPt[2] + Math.sin(a1) * thigh;
    // Knees flex backwards, so the shin rotates the opposite way to the thigh.
    const a2 = a1 - kneeA;
    const fx = kx + Math.cos(a2) * shin;
    const fz = Math.max(0, kz + Math.sin(a2) * shin) + liftZ;
    return { knee: [kx, hipPt[1], kz], foot: [fx, hipPt[1], fz] };
  };

  const lL = legPose(p.hipL, runPhase, 1);
  const lR = legPose(p.hipR, runPhase + Math.PI, -1);
  p.kneeL = lL.knee;
  p.footL = lL.foot;
  p.kneeR = lR.knee;
  p.footR = lR.foot;

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
  const bone = (a, b, r0, r1, base, dark, light, depth) => {
    const A = P[a];
    const B = P[b];
    if (!A || !B) return;
    capsule(ctx, A[0] - 1.4, A[1] - 2.2, B[0] - 1.4, B[1] - 2.2, r0 * s, r1 * s);
    ctx.fillStyle = css(tint(rimC), rimA);
    ctx.fill();
    capsule(ctx, A[0], A[1], B[0], B[1], r0 * s, r1 * s);
    ctx.fillStyle = css(tint(shadeFor(depth, base, dark, light)));
    ctx.fill();
    capsule(ctx, A[0] - 1.1, A[1] - 1.7, B[0] - 1.1, B[1] - 1.7, r0 * s * 0.5, r1 * s * 0.5);
    ctx.fillStyle = css(tint(light), 0.2);
    ctx.fill();
  };

  const M = def.colors;

  // Draw order: whatever is furthest from the camera goes first.
  const parts = [];
  const push = (depth, fn) => parts.push({ d: depth, fn });

  // Cloak behind the body
  if (def.cape) {
    push(-2, () => drawCape(ctx, P, D, def, st, s, cosF, sinF, px, py, tint));
  }

  // Legs
  const legOrder = D.hipL > D.hipR ? ['R', 'L'] : ['L', 'R'];
  for (const side of legOrder) {
    push(D['hip' + side] - 0.4, () => {
      const lw = def.limbScale ?? 1;
      bone('hip' + side, 'knee' + side, 7.2 * lw, 5.4 * lw, M.legs, M.legsDark, M.legsLight, D['hip' + side]);
      bone('knee' + side, 'foot' + side, 5.4 * lw, 3.8 * lw, M.legs, M.legsDark, M.legsLight, D['hip' + side]);
      // Boot
      const F = P['foot' + side];
      ctx.save();
      ctx.translate(F[0], F[1]);
      ctx.fillStyle = css(tint(shadeFor(D['hip' + side], M.boots, M.legsDark, M.legsLight)));
      ctx.beginPath();
      ctx.ellipse(cosF * 2.4 * s, 0, 6.4 * s * lw, 4 * s * lw, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    });
  }

  // Far arm
  const armFar = D.shoulderL < D.shoulderR ? 'L' : 'R';
  const armNear = armFar === 'L' ? 'R' : 'L';

  const drawArm = (side) => {
    const lw = def.limbScale ?? 1;
    bone('shoulder' + side, 'elbow' + side, 6.2 * lw, 4.8 * lw, M.arms, M.armsDark, M.armsLight, D['shoulder' + side]);
    bone('elbow' + side, 'hand' + side, 4.8 * lw, 3.6 * lw, M.arms, M.armsDark, M.armsLight, D['shoulder' + side]);
    // Pauldron
    if (def.pauldrons) {
      const S = P['shoulder' + side];
      ctx.beginPath();
      ctx.ellipse(S[0], S[1] - 1.5 * s, 8.4 * s * lw, 6.4 * s * lw, 0, 0, TAU);
      ctx.fillStyle = css(tint(shadeFor(D['shoulder' + side] + 0.3, M.metal, M.metalDark, M.metalLight)));
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(S[0] - 1.8 * s, S[1] - 3.4 * s, 5.2 * s * lw, 3.2 * s * lw, 0, 0, TAU);
      ctx.fillStyle = css(tint(M.metalLight), 0.45);
      ctx.fill();
      if (def.runes) {
        // Light caught in the groove around the rim of the shoulder plate.
        ctx.beginPath();
        ctx.ellipse(S[0], S[1] - 1.5 * s, 8.4 * s * lw, 6.4 * s * lw, 0, 0.5, Math.PI - 0.5);
        ctx.strokeStyle = css(def.runes.color, 0.8);
        ctx.lineWidth = 1.3 * s;
        ctx.stroke();
      }
    }
    // Hand
    const Hd = P['hand' + side];
    ctx.beginPath();
    ctx.arc(Hd[0], Hd[1], 4.1 * s * lw, 0, TAU);
    ctx.fillStyle = css(tint(shadeFor(D['shoulder' + side], M.hands || M.arms, M.armsDark, M.armsLight)));
    ctx.fill();
  };

  push(D['shoulder' + armFar] - 0.3, () => drawArm(armFar));

  // Torso + head
  push(0, () => {
    drawTorso(ctx, P, D, def, s, tint, rimC, rimA, emis);
    drawHead(ctx, P, D, def, st, s, cosF, sinF, tint, emis, rimC, rimA);
  });

  // Near arm and whatever it's holding
  push(D['shoulder' + armNear] + 0.4, () => {
    if (def.offhand && def.offhand !== 'none') {
      const oh = def.weaponHand === 'L' ? 'R' : 'L';
      if (oh === armNear) drawOffhand(ctx, P, D, def, st, s, cosF, sinF, tint, emis);
    }
    drawArm(armNear);
  });

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

function drawTorso(ctx, P, D, def, s, tint, rimC, rimA, emis) {
  const M = def.colors;
  const hipL = P.hipL;
  const hipR = P.hipR;
  const shL = P.shoulderL;
  const shR = P.shoulderR;
  const widen = def.torsoWide ?? 1;

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(lerp(shL[0], shR[0], -0.16 * widen), shL[1] - 1 * s);
    ctx.quadraticCurveTo(
      lerp(shL[0], hipL[0], 0.5) - 2 * s * widen,
      lerp(shL[1], hipL[1], 0.5),
      hipL[0] - 1 * s,
      hipL[1] + 2 * s
    );
    ctx.lineTo(hipR[0] + 1 * s, hipR[1] + 2 * s);
    ctx.quadraticCurveTo(
      lerp(shR[0], hipR[0], 0.5) + 2 * s * widen,
      lerp(shR[1], hipR[1], 0.5),
      lerp(shR[0], shL[0], -0.16 * widen),
      shR[1] - 1 * s
    );
    ctx.closePath();
  };

  // Rim ghost
  ctx.save();
  ctx.translate(-1.4, -2.4);
  path();
  ctx.fillStyle = css(tint(rimC), rimA);
  ctx.fill();
  ctx.restore();

  path();
  const g = ctx.createLinearGradient(shL[0], shL[1] - 6 * s, hipR[0], hipR[1]);
  g.addColorStop(0, css(tint(M.torsoLight)));
  g.addColorStop(0.45, css(tint(M.torso)));
  g.addColorStop(1, css(tint(M.torsoDark)));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  ctx.clip();
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
    ctx.strokeStyle = css(M.torsoDark, 0.7);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const x = lerp(shL[0], shR[0], (i * 0.37) % 1);
      const y = lerp(shL[1], hipL[1], t);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (i % 2 ? 3 : -3), y + 5);
      ctx.stroke();
    }
  } else if (def.torso === 'robe') {
    const rg = ctx.createLinearGradient(0, P.chest[1], 0, hipL[1] + 8 * s);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, css(M.torsoDark, 0.85));
    ctx.fillStyle = rg;
    ctx.fillRect(shL[0] - 20 * s, P.chest[1] - 4 * s, 40 * s, 60 * s);
  }
  ctx.restore();

  // Belt
  ctx.beginPath();
  ctx.moveTo(hipL[0] - 1.5 * s, hipL[1] - 1 * s);
  ctx.lineTo(hipR[0] + 1.5 * s, hipR[1] - 1 * s);
  ctx.lineWidth = 3 * s;
  ctx.strokeStyle = css(tint(M.belt || PAL.leatherDark));
  ctx.stroke();

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
  ctx.fillStyle = css(tint(M.skinDark || M.armsDark));
  ctx.fill();

  // Rim ghost
  ctx.beginPath();
  ctx.ellipse(H[0] - 1.4, H[1] - 2.4, r * 1.03, r * 1.1, 0, 0, TAU);
  ctx.fillStyle = css(tint(rimC), rimA);
  ctx.fill();

  // Skull
  ctx.beginPath();
  ctx.ellipse(H[0], H[1], r, r * 1.08, 0, 0, TAU);
  const g = ctx.createRadialGradient(H[0] - r * 0.4, H[1] - r * 0.5, r * 0.1, H[0], H[1], r * 1.3);
  g.addColorStop(0, css(tint(M.skinLight || M.armsLight)));
  g.addColorStop(0.55, css(tint(M.skin || M.arms)));
  g.addColorStop(1, css(tint(M.skinDark || M.armsDark)));
  ctx.fillStyle = g;
  ctx.fill();

  // The face is only drawn when the character is turned toward the camera.
  const front = clamp01(sinF * 1.4 + 0.25);
  if (front > 0.05 && def.helm !== 'greathelm' && def.helm !== 'skull') {
    ctx.save();
    ctx.globalAlpha = front;
    ctx.fillStyle = 'rgba(14,12,14,0.75)';
    const ex = r * 0.36;
    ctx.beginPath();
    ctx.ellipse(H[0] - ex - cosF * r * 0.22, H[1] - r * 0.1, r * 0.16, r * 0.2, 0, 0, TAU);
    ctx.ellipse(H[0] + ex - cosF * r * 0.22, H[1] - r * 0.1, r * 0.16, r * 0.2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
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

  drawHelm(ctx, def, H, r, s, cosF, sinF, tint, M);
}

function drawHelm(ctx, def, H, r, s, cosF, sinF, tint, M) {
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
    ctx.beginPath();
    ctx.moveTo(H[0] - r * 1.12, H[1] - r * 0.95);
    ctx.lineTo(H[0] + r * 1.12, H[1] - r * 0.95);
    ctx.lineTo(H[0] + r * 1.04, H[1] + r * 1.1);
    ctx.quadraticCurveTo(H[0], H[1] + r * 1.5, H[0] - r * 1.04, H[1] + r * 1.1);
    ctx.closePath();
    const g = ctx.createLinearGradient(H[0] - r, 0, H[0] + r, 0);
    g.addColorStop(0, css(metL));
    g.addColorStop(0.35, css(met));
    g.addColorStop(1, css(metD));
    ctx.fillStyle = g;
    ctx.fill();
    // Eye slit and breathing holes
    const front = clamp01(sinF * 1.5 + 0.2);
    if (front > 0.03) {
      ctx.save();
      ctx.globalAlpha = front;
      ctx.fillStyle = 'rgba(8,9,12,0.9)';
      ctx.fillRect(H[0] - r * 0.9 - cosF * r * 0.2, H[1] - r * 0.25, r * 1.8, r * 0.3);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(H[0] + i * r * 0.3 - cosF * r * 0.2, H[1] + r * 0.55, r * 0.09, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    // Cross reinforcement
    ctx.strokeStyle = css(metD, 0.7);
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.moveTo(H[0] - cosF * r * 0.2, H[1] - r * 0.95);
    ctx.lineTo(H[0] - cosF * r * 0.2, H[1] + r * 1.2);
    ctx.stroke();
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
    // Shadow inside the cowl
    const front = clamp01(sinF * 1.4 + 0.2);
    if (front > 0.03) {
      ctx.save();
      ctx.globalAlpha = front;
      ctx.fillStyle = 'rgba(6,6,10,0.85)';
      ctx.beginPath();
      ctx.ellipse(H[0] - cosF * r * 0.3, H[1] + r * 0.12, r * 0.82, r * 0.92, 0, 0, TAU);
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
      emis(gx, gy, 9 * s, gem, 0.85);
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
    ctx.strokeStyle = css(tint(PAL.bone));
    ctx.lineWidth = 2.2 * s;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * 3 * s);
      ctx.quadraticCurveTo(L * 0.4, i * 5 * s, L * 0.62, i * 3.4 * s);
      ctx.stroke();
    }
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
    if (emis) emis(Hd[0], Hd[1] - 2 * s, 11 * s, gem, 0.85);
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
  p.snout = [headFwd + 15 + lunge * 1.2, 0, headH - 5 + bounce * 0.6 - crouch - headDrop];
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

  const bone = (a, b, r0, r1, base, dark, light, depth) => {
    const A = P[a];
    const B = P[b];
    capsule(ctx, A[0] - 1.2, A[1] - 2, B[0] - 1.2, B[1] - 2, r0 * s, r1 * s);
    ctx.fillStyle = css(tint(rimC), rimA);
    ctx.fill();
    capsule(ctx, A[0], A[1], B[0], B[1], r0 * s, r1 * s);
    ctx.fillStyle = css(tint(shadeFor(depth, base, dark, light)));
    ctx.fill();
    capsule(ctx, A[0] - 1, A[1] - 1.5, B[0] - 1, B[1] - 1.5, r0 * s * 0.5, r1 * s * 0.5);
    ctx.fillStyle = css(tint(light), 0.16);
    ctx.fill();
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
  // Shaggy back
  if (def.shaggy) {
    ctx.save();
    ctx.strokeStyle = css(tint(M.torsoDark), 0.8);
    ctx.lineWidth = 1.5;
    const A = P.hind;
    const B = P.neck;
    for (let i = 0; i < 18; i++) {
      const t = i / 17;
      const x = lerp(A[0], B[0], t);
      const y = lerp(A[1], B[1], t) - 10 * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (i % 2 ? 4 : -4), y - 6 - (i % 3) * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Head
  bone('neck', 'head', 8, 7, M.torso, M.torsoDark, M.torsoLight, 0.4);
  bone('head', 'snout', 6, 3.2, M.torso, M.torsoDark, M.torsoLight, 0.5);
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
