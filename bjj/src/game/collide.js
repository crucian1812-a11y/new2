// How far inside each other the two fighters are.
//
// This started as a solver that pushed them apart and it did not work: rotating
// a limb out of one collision drives it into the next, and on this pose library
// three passes moved the worst case from 21.5 cm to 21.9 cm. That is written
// down rather than deleted because the failure is informative — a runtime fix
// cannot rescue poses that are wrong by twenty centimetres, and there is no
// clever version of it that can.
//
// What survived is the measurement, which turned out to be the valuable half.
// Fifteen paired poses were authored by typing joint angles with no feedback at
// all about whether the two bodies occupied the same space; they overlapped and
// nothing ever said so. Now pose-check says so, every run, and the number is
// what pose work is aimed at.
//
// The proxy is built from the same table body.js builds the mesh from, and that
// matters more than it sounds. The first version wrapped every bone in a round
// capsule of a single radius, and a torso is not round — it is 21 cm across and
// 15 cm deep, and it tapers to a neck. A round 17.5 cm capsule on the chest
// bone puts a ball of that radius where the throat is, so an arm wrapped round
// a neck — which is most of this sport — read as fourteen centimetres of
// interpenetration when the arm was exactly where it belonged. Half the
// failures the first version reported were the ruler's fault, not the pose's.
//
// So: tapered, elliptical, taken from the gi segments where there is cloth and
// from the skin segments where there is not. Cloth still squashes, flesh still
// gives, and two people in a grappling position genuinely occupy some of the
// same space; a few centimetres is contact and reads as pressure. Past about
// 8 cm a limb is inside a body, and it looks like it.

import { Skeleton, BONE_INDEX } from '../render/skeleton.js';
import { v3, v3set, v3len, clamp } from '../core/m4.js';

// [bone, child, r0, r1, squashZ0, squashZ1] — r is the half-width across the
// body, squashZ scales it front-to-back. Same convention as body.js, and the
// numbers are the gi's where the gi covers the limb, the skin's where it does
// not (head, hands, feet) plus a couple of millimetres for skin itself.
const CAPSULES = [
  ['hips', 'spine', 0.190, 0.184, 0.78, 0.76],
  ['spine', 'chest', 0.186, 0.212, 0.76, 0.72],
  ['chest', 'neck', 0.212, 0.112, 0.72, 0.86],
  ['neck', 'head', 0.066, 0.078, 1.0, 1.0],
  ['head', 'headTop', 0.098, 0.086, 1.0, 1.0],

  ['armL', 'foreL', 0.085, 0.076, 1.0, 1.0],
  ['foreL', 'handL', 0.078, 0.070, 1.0, 0.9],
  ['handL', 'handLTip', 0.040, 0.026, 0.55, 0.5],
  ['armR', 'foreR', 0.085, 0.076, 1.0, 1.0],
  ['foreR', 'handR', 0.078, 0.070, 1.0, 0.9],
  ['handR', 'handRTip', 0.040, 0.026, 0.55, 0.5],

  ['thighL', 'shinL', 0.122, 0.100, 1.0, 1.0],
  ['shinL', 'footL', 0.095, 0.075, 1.0, 1.0],
  ['footL', 'toeL', 0.050, 0.034, 0.62, 0.55],
  ['thighR', 'shinR', 0.122, 0.100, 1.0, 1.0],
  ['shinR', 'footR', 0.095, 0.075, 1.0, 1.0],
  ['footR', 'toeR', 0.050, 0.034, 0.62, 0.55],
];

// The subset of those the renderer uses to darken one body where the other
// presses on it. Twelve rather than seventeen because it is a loop in a
// fragment shader and hands and feet are small enough that their own shadow
// map entry covers them; the radii are the same numbers, from the same table,
// so the shape that occludes is the shape that collides.
export const OCCLUDERS = CAPSULES.filter(([a]) =>
  ['hips', 'spine', 'chest', 'head', 'armL', 'foreL', 'armR', 'foreR',
   'thighL', 'shinL', 'thighR', 'shinR'].includes(a));

const _a = v3(), _b = v3(), _n = v3();

// The cross-section frame of a bone, built exactly the way body.js builds the
// tube it wraps, so the ellipse the collider uses is the ellipse on screen.
//
// It is built once, in bind space, and carried into the pose by the bone's own
// matrix — not rebuilt from the posed bone. Rebuilding loses the roll: a
// fighter lying on his side has a torso axis pointing the same way as a
// fighter lying on his back, and the collider would call him 21 cm wide in the
// direction he is only 15 cm deep.
function frameOf(A, B) {
  const ax = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const len = Math.hypot(ax[0], ax[1], ax[2]) || 1e-4;
  ax[0] /= len; ax[1] /= len; ax[2] /= len;
  const up = Math.abs(ax[1]) > 0.94 ? [0, 0, 1] : [0, 1, 0];
  let sx = [
    up[1] * ax[2] - up[2] * ax[1],
    up[2] * ax[0] - up[0] * ax[2],
    up[0] * ax[1] - up[1] * ax[0],
  ];
  const sl = Math.hypot(sx[0], sx[1], sx[2]) || 1;
  sx = [sx[0] / sl, sx[1] / sl, sx[2] / sl];
  const sz = [
    ax[1] * sx[2] - ax[2] * sx[1],
    ax[2] * sx[0] - ax[0] * sx[2],
    ax[0] * sx[1] - ax[1] * sx[0],
  ];
  return { sx, sz };
}

// Closest points between two segments, and where along each they fell — the
// parameters are what the taper needs. The standard clamped solve; the
// degenerate cases matter here because a hand capsule is short enough to be
// nearly a point.
function segClosest(p1, q1, p2, q2, out1, out2) {
  const d1x = q1[0] - p1[0], d1y = q1[1] - p1[1], d1z = q1[2] - p1[2];
  const d2x = q2[0] - p2[0], d2y = q2[1] - p2[1], d2z = q2[2] - p2[2];
  const rx = p1[0] - p2[0], ry = p1[1] - p2[1], rz = p1[2] - p2[2];
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  const EPS = 1e-8;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  v3set(out1, p1[0] + d1x * s, p1[1] + d1y * s, p1[2] + d1z * s);
  v3set(out2, p2[0] + d2x * t, p2[1] + d2y * t, p2[2] + d2z * t);
  return [s, t];
}

// How far the elliptical cross-section reaches in the direction the other body
// is in. Only the part of that direction across the bone counts: along the bone
// the segment itself already accounts for the length.
function radiusToward(c, u, dx, dy, dz) {
  const rx = c.r0 + (c.r1 - c.r0) * u;
  const rz = rx * (c.z0 + (c.z1 - c.z0) * u);
  const px = dx * c.sx[0] + dy * c.sx[1] + dz * c.sx[2];
  const pz = dx * c.sz[0] + dy * c.sz[1] + dz * c.sz[2];
  const m = Math.hypot(px, pz);
  if (m < 1e-6) return rx;
  const nx = px / m, nz = pz / m;
  return 1 / Math.hypot(nx / rx, nz / rz);
}

// The bind-space cross-section of every capsule, read off the rest skeleton
// once. Every skeleton shares it; nothing about it depends on the pose.
const BIND = (() => {
  const rest = new Skeleton();
  return CAPSULES.map(([a, b]) => {
    const ma = rest.bind[BONE_INDEX[a]];
    const mb = rest.bind[BONE_INDEX[b]];
    return frameOf([ma[12], ma[13], ma[14]], [mb[12], mb[13], mb[14]]);
  });
})();

// Rotate a bind-space direction into the posed world by a bone's matrix. The
// bone matrix is world = pose * invBind ... only for skinning; here the axes
// belong to the bone itself, so the bone's own rotation is what carries them.
function rot(out, m, v) {
  out[0] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
  out[1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
  out[2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
  return out;
}

export class Overlap {
  constructor() {
    this.caps = [[], []];
    for (const side of [0, 1]) {
      CAPSULES.forEach(([a, b, r0, r1, z0, z1], i) => {
        this.caps[side].push({
          a, b, r0, r1, z0, z1, bind: BIND[i],
          p: v3(), q: v3(), sx: [1, 0, 0], sz: [0, 0, 1],
        });
      });
    }
  }

  _gather(sk, list) {
    for (const c of list) {
      const ma = sk.world[BONE_INDEX[c.a]];
      const mb = sk.world[BONE_INDEX[c.b]];
      v3set(c.p, ma[12], ma[13], ma[14]);
      v3set(c.q, mb[12], mb[13], mb[14]);
      const s = sk.skin.subarray(BONE_INDEX[c.a] * 16, BONE_INDEX[c.a] * 16 + 16);
      rot(c.sx, s, c.bind.sx);
      rot(c.sz, s, c.bind.sz);
    }
  }

  // Every overlapping pair. The pose solver needs the whole picture, not the
  // worst of it: a search that only ever sees the deepest collision cannot tell
  // the difference between fixing one and moving it somewhere else.
  all(skA, skB) {
    this._gather(skA, this.caps[0]);
    this._gather(skB, this.caps[1]);
    const out = [];
    for (const ca of this.caps[0]) {
      for (const cb of this.caps[1]) {
        const pen = this._pair(ca, cb);
        if (pen > 0) out.push({ pen, where: `A.${ca.a} in B.${cb.a}` });
      }
    }
    return out;
  }

  _pair(ca, cb) {
    const [s, t] = segClosest(ca.p, ca.q, cb.p, cb.q, _a, _b);
    v3set(_n, _a[0] - _b[0], _a[1] - _b[1], _a[2] - _b[2]);
    const d = v3len(_n);
    if (d > 0.5) return 0;
    const ux = d > 1e-6 ? _n[0] / d : 0;
    const uy = d > 1e-6 ? _n[1] / d : 1;
    const uz = d > 1e-6 ? _n[2] / d : 0;
    const ra = radiusToward(ca, s, -ux, -uy, -uz);
    const rb = radiusToward(cb, t, ux, uy, uz);
    return ra + rb - d;
  }

  // The deepest overlap between the two, and which pair of parts caused it.
  measure(skA, skB) {
    this._gather(skA, this.caps[0]);
    this._gather(skB, this.caps[1]);
    let deepest = 0, where = null;
    for (const ca of this.caps[0]) {
      for (const cb of this.caps[1]) {
        const pen = this._pair(ca, cb);
        if (pen > deepest) {
          deepest = pen;
          where = `A.${ca.a} in B.${cb.a}`;
        }
      }
    }
    return { deepest, where };
  }
}
