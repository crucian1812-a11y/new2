// The fighters' geometry, generated at load from the skeleton.
//
// There are no model files. A body is a list of limb segments; each segment is
// a tube of rings lofted from one bone's head to the next, with an elliptical
// cross-section so a ribcage is not a sausage. Vertices are weighted to the two
// bones they lie between, ramped only near the joints, which is what makes an
// elbow crease instead of collapse.
//
// The gi is the same construction at a larger radius, cut off at the sleeve and
// trouser hems, plus two lapel strips and a belt. Because it is a separate mesh
// on the same skeleton it can have its own material — a woven cloth that
// catches light quite differently from skin — and it can be recoloured per
// fighter without touching the body underneath.

import { BONE_INDEX } from './skeleton.js';

const SIDES = 12;

// [bone, childBone, r0, r1, squashZ0, squashZ1] — r is the half-width in X,
// squashZ scales it in Z, which is how a torso gets to be a torso.
const SKIN_SEGMENTS = [
  ['hips', 'spine', 0.155, 0.145, 0.72, 0.7],
  ['spine', 'chest', 0.145, 0.175, 0.7, 0.66],
  ['chest', 'neck', 0.175, 0.075, 0.66, 0.85],
  ['neck', 'head', 0.062, 0.072, 1.0, 1.0],

  ['clavL', 'armL', 0.072, 0.062, 1.0, 1.0],
  ['armL', 'foreL', 0.058, 0.046, 1.0, 1.0],
  ['foreL', 'handL', 0.048, 0.032, 1.0, 0.8],
  ['handL', 'handLTip', 0.036, 0.024, 0.55, 0.5],
  ['clavR', 'armR', 0.072, 0.062, 1.0, 1.0],
  ['armR', 'foreR', 0.058, 0.046, 1.0, 1.0],
  ['foreR', 'handR', 0.048, 0.032, 1.0, 0.8],
  ['handR', 'handRTip', 0.036, 0.024, 0.55, 0.5],

  ['thighL', 'shinL', 0.088, 0.062, 1.0, 1.0],
  ['shinL', 'footL', 0.062, 0.042, 1.0, 1.0],
  ['footL', 'toeL', 0.046, 0.032, 0.62, 0.55],
  ['thighR', 'shinR', 0.088, 0.062, 1.0, 1.0],
  ['shinR', 'footR', 0.062, 0.042, 1.0, 1.0],
  ['footR', 'toeR', 0.046, 0.032, 0.62, 0.55],
];

// The kimono. Wider than the body it covers, and it stops where cloth stops.
const GI_SEGMENTS = [
  ['hips', 'spine', 0.19, 0.184, 0.78, 0.76, 'pants'],
  ['spine', 'chest', 0.186, 0.212, 0.76, 0.72, 'jacket'],
  ['chest', 'neck', 0.212, 0.112, 0.72, 0.86, 'jacket'],
  ['clavL', 'armL', 0.096, 0.09, 1.0, 1.0, 'jacket'],
  ['armL', 'foreL', 0.085, 0.076, 1.0, 1.0, 'jacket'],
  ['foreL', 'handL', 0.078, 0.07, 1.0, 0.9, 'jacket', 0.62],
  ['clavR', 'armR', 0.096, 0.09, 1.0, 1.0, 'jacket'],
  ['armR', 'foreR', 0.085, 0.076, 1.0, 1.0, 'jacket'],
  ['foreR', 'handR', 0.078, 0.07, 1.0, 0.9, 'jacket', 0.62],
  ['thighL', 'shinL', 0.122, 0.1, 1.0, 1.0, 'pants'],
  ['shinL', 'footL', 0.095, 0.075, 1.0, 1.0, 'pants', 0.6],
  ['thighR', 'shinR', 0.122, 0.1, 1.0, 1.0, 'pants'],
  ['shinR', 'footR', 0.095, 0.075, 1.0, 1.0, 'pants', 0.6],
];

const RINGS = 5;

class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.bone = [];
    this.wt = [];
    this.mat = []; // 0 skin, 1 jacket, 2 pants, 3 belt, 4 lapel
    this.idx = [];
  }

  vert(p, n, u, b0, b1, w0, w1, mat) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u[0], u[1]);
    this.bone.push(b0, b1);
    this.wt.push(w0, w1);
    this.mat.push(mat);
    return this.pos.length / 3 - 1;
  }

  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  build() {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      uv: new Float32Array(this.uv),
      bone: new Float32Array(this.bone),
      wt: new Float32Array(this.wt),
      mat: new Float32Array(this.mat),
      idx: this.idx.length > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      count: this.idx.length,
    };
  }
}

// Bind-space position of a bone's head, read straight off the bind matrix.
function headOf(sk, name) {
  const m = sk.bind[BONE_INDEX[name]];
  return [m[12], m[13], m[14]];
}

// A vertex sitting at parameter t along bone A's segment belongs to A, except
// near the ends, where it hands part of itself to the neighbour so the joint
// creases smoothly instead of shearing.
function weightsAt(sk, ia, ib, t) {
  if (t > 0.68) {
    const k = ((t - 0.68) / 0.32) * 0.5;
    return [ia, ib, 1 - k, k];
  }
  const ip = sk.parent[ia];
  if (t < 0.3 && ip >= 0) {
    const k = ((0.3 - t) / 0.3) * 0.42;
    return [ia, ip, 1 - k, k];
  }
  return [ia, ib, 1, 0];
}

function addTube(mb, sk, seg, matId, uvScale) {
  const [an, bn, r0, r1, z0, z1] = seg;
  const cut = seg[6] === 'jacket' || seg[6] === 'pants' ? (seg[7] ?? 1) : (seg[6] ?? 1);
  const ia = BONE_INDEX[an];
  const ib = BONE_INDEX[bn];
  const A = headOf(sk, an);
  const B = headOf(sk, bn);

  // Bind-space frame for the segment: +Y down the bone, X and Z from the world
  // axes, which is safe because no rest bone is exactly vertical-degenerate
  // except the spine, and there X/Z are exactly what we want anyway.
  const ax = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const len = Math.hypot(ax[0], ax[1], ax[2]) || 1e-4;
  ax[0] /= len; ax[1] /= len; ax[2] /= len;
  let up = Math.abs(ax[1]) > 0.94 ? [0, 0, 1] : [0, 1, 0];
  let sx = [
    up[1] * ax[2] - up[2] * ax[1],
    up[2] * ax[0] - up[0] * ax[2],
    up[0] * ax[1] - up[1] * ax[0],
  ];
  let sl = Math.hypot(sx[0], sx[1], sx[2]) || 1;
  sx = [sx[0] / sl, sx[1] / sl, sx[2] / sl];
  const sz = [
    ax[1] * sx[2] - ax[2] * sx[1],
    ax[2] * sx[0] - ax[0] * sx[2],
    ax[0] * sx[1] - ax[1] * sx[0],
  ];

  const ringStart = mb.pos.length / 3;
  const p = [0, 0, 0], n = [0, 0, 0], u = [0, 0];
  for (let r = 0; r <= RINGS; r++) {
    const t = (r / RINGS) * cut;
    const rad = r0 + (r1 - r0) * t;
    const sq = z0 + (z1 - z0) * t;
    // Ends get pulled in so limbs read as capsules, not open pipes.
    const capIn = r === 0 ? 0.86 : r === RINGS && cut >= 1 ? 0.72 : 1;
    const [b0, b1, w0, w1] = weightsAt(sk, ia, ib, t);
    for (let s = 0; s < SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2;
      const cx = Math.cos(a) * rad * capIn;
      const cz = Math.sin(a) * rad * sq * capIn;
      p[0] = A[0] + ax[0] * len * t + sx[0] * cx + sz[0] * cz;
      p[1] = A[1] + ax[1] * len * t + sx[1] * cx + sz[1] * cz;
      p[2] = A[2] + ax[2] * len * t + sx[2] * cx + sz[2] * cz;
      const nx = sx[0] * Math.cos(a) + sz[0] * Math.sin(a) / (sq || 1);
      const ny = sx[1] * Math.cos(a) + sz[1] * Math.sin(a) / (sq || 1);
      const nz = sx[2] * Math.cos(a) + sz[2] * Math.sin(a) / (sq || 1);
      const nl = Math.hypot(nx, ny, nz) || 1;
      n[0] = nx / nl; n[1] = ny / nl; n[2] = nz / nl;
      u[0] = (s / SIDES) * uvScale * rad * 8;
      u[1] = t * len * uvScale * 8;
      mb.vert(p, n, u, b0, b1, w0, w1, matId);
    }
  }
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SIDES; s++) {
      const s2 = (s + 1) % SIDES;
      const a = ringStart + r * SIDES + s;
      const b = ringStart + r * SIDES + s2;
      const c = ringStart + (r + 1) * SIDES + s2;
      const d = ringStart + (r + 1) * SIDES + s;
      mb.quad(a, b, c, d);
    }
  }
  // Cap the far end of anything that was cut short (a sleeve opening) and of
  // the extremities, so no hole faces the camera.
  capRing(mb, ringStart + RINGS * SIDES, SIDES, ax, matId);
  capRing(mb, ringStart, SIDES, [-ax[0], -ax[1], -ax[2]], matId, true);
}

function capRing(mb, first, sides, normal, matId, reverse = false) {
  // A fan to the ring's own centre. Averaging the ring is exact for an ellipse
  // and cheap enough to do at load.
  let cx = 0, cy = 0, cz = 0;
  for (let s = 0; s < sides; s++) {
    cx += mb.pos[(first + s) * 3];
    cy += mb.pos[(first + s) * 3 + 1];
    cz += mb.pos[(first + s) * 3 + 2];
  }
  cx /= sides; cy /= sides; cz /= sides;
  const b0 = mb.bone[first * 2], b1 = mb.bone[first * 2 + 1];
  const w0 = mb.wt[first * 2], w1 = mb.wt[first * 2 + 1];
  const centre = mb.vert([cx, cy, cz], normal, [0.5, 0.5], b0, b1, w0, w1, matId);
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    if (reverse) mb.idx.push(centre, first + s, first + s2);
    else mb.idx.push(centre, first + s2, first + s);
  }
}

// A flat strip running down the chest — the lapel the whole gi game is played
// on. Two of them, mirrored, crossing at the sternum.
function addLapel(mb, sk, side) {
  const neck = headOf(sk, 'neck');
  const hips = headOf(sk, 'hips');
  const ib = BONE_INDEX['chest'];
  const ih = BONE_INDEX['spine'];
  const w = 0.045;
  const ring = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // From the collarbone down and inwards to the knot.
    const x = (0.085 - 0.075 * t) * side;
    const y = neck[1] + 0.02 - (neck[1] + 0.02 - (hips[1] + 0.05)) * t;
    const z = 0.13 + 0.012 * Math.sin(t * 3);
    const [bb, b1, ww, w1] = t < 0.55 ? [ib, ih, 1 - t * 0.4, t * 0.4] : [ih, ib, 1, 0];
    const a = mb.vert([x - w * side, y, z - 0.012], [0, 0.25, 0.97], [0, t * 3], bb, b1, ww, w1, 4);
    const b = mb.vert([x + w * side, y, z + 0.006], [0, 0.25, 0.97], [1, t * 3], bb, b1, ww, w1, 4);
    ring.push([a, b]);
  }
  for (let i = 0; i < steps; i++) {
    const [a0, b0] = ring[i];
    const [a1, b1] = ring[i + 1];
    if (side > 0) mb.quad(a0, b0, b1, a1);
    else mb.quad(a1, b1, b0, a0);
  }
}

function addBelt(mb, sk) {
  const hips = headOf(sk, 'hips');
  const ib = BONE_INDEX['hips'];
  const y = hips[1] + 0.055;
  const rx = 0.192, rz = 0.146;
  const first = mb.pos.length / 3;
  for (let r = 0; r < 2; r++) {
    for (let s = 0; s < SIDES * 2; s++) {
      const a = (s / (SIDES * 2)) * Math.PI * 2;
      const p = [Math.cos(a) * rx, y + (r ? 0.05 : -0.05), Math.sin(a) * rz];
      const n = [Math.cos(a), 0, Math.sin(a) * (rx / rz)];
      const nl = Math.hypot(n[0], n[1], n[2]);
      mb.vert(p, [n[0] / nl, 0, n[2] / nl], [s / 4, r], ib, ib, 1, 0, 3);
    }
  }
  for (let s = 0; s < SIDES * 2; s++) {
    const s2 = (s + 1) % (SIDES * 2);
    mb.quad(first + s, first + s2, first + SIDES * 2 + s2, first + SIDES * 2 + s);
  }
  // The two hanging ends of the knot.
  for (const dx of [-0.055, 0.055]) {
    const f = mb.pos.length / 3;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        mb.vert(
          [dx + (c ? 0.035 : -0.035), y + 0.05 - r * 0.19, rz + 0.012],
          [0, 0.1, 1], [c, r], ib, ib, 1, 0, 3
        );
      }
    }
    mb.quad(f, f + 1, f + 3, f + 2);
  }
}

// The head, which is worth its own builder. A tapered tube makes a traffic
// cone, and a cone on a body is the single fastest way to lose an audience.
// This is an ellipsoid with a real profile, a jaw that comes forward, and a
// separate hair shell over the crown and nape — at broadcast distance, hair is
// most of what tells you which way somebody is facing.
function addHead(mb, sk) {
  const ih = BONE_INDEX['head'];
  const base = headOf(sk, 'head');
  const RINGS_H = 8;
  const cy = base[1] + 0.088;
  const rx = 0.093, ry = 0.115, rz = 0.104;

  for (const [matId, grow, from, to] of [[0, 0, 0, RINGS_H], [5, 0.008, 3, RINGS_H]]) {
    const first = mb.pos.length / 3;
    for (let r = from; r <= to; r++) {
      const t = r / RINGS_H;
      const phi = (t - 0.5) * Math.PI; // -pi/2 at the chin, +pi/2 at the crown
      const c = Math.cos(phi), sn = Math.sin(phi);
      for (let i = 0; i < SIDES; i++) {
        const a = (i / SIDES) * Math.PI * 2;
        // The jaw pushes forward low down and the skull is wider high up.
        const jaw = Math.max(0, -sn) * 0.03 * Math.max(0, Math.cos(a));
        const x = Math.cos(a) * (rx + grow) * c;
        const z = Math.sin(a) * (rz + grow) * c + jaw;
        const p = [base[0] + x, cy + sn * (ry + grow), base[2] + z];
        const n = [x / rx, (sn * (ry + grow)) / ry, z / rz];
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        mb.vert(p, [n[0] / nl, n[1] / nl, n[2] / nl], [a / 2, t * 2], ih, ih, 1, 0, matId);
      }
    }
    const rows = to - from;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < SIDES; i++) {
        const i2 = (i + 1) % SIDES;
        const a = first + r * SIDES + i;
        const b = first + r * SIDES + i2;
        const c2 = first + (r + 1) * SIDES + i2;
        const d = first + (r + 1) * SIDES + i;
        mb.quad(a, b, c2, d);
      }
    }
    capRing(mb, first + rows * SIDES, SIDES, [0, 1, 0], matId);
    capRing(mb, first, SIDES, [0, -1, 0], matId, true);
  }
}

// The jacket's skirt. A gi does not stop at the belt; the tail hangs below it
// and it is the thing that reads as cloth when a body rolls.
function addSkirt(mb, sk) {
  const hips = headOf(sk, 'hips');
  const ih = BONE_INDEX['hips'];
  const first = mb.pos.length / 3;
  const rows = [
    [hips[1] + 0.10, 0.196, 0.152],
    [hips[1] - 0.02, 0.216, 0.168],
    [hips[1] - 0.115, 0.228, 0.178],
  ];
  for (const [y, rx, rz] of rows) {
    for (let i = 0; i < SIDES * 2; i++) {
      const a = (i / (SIDES * 2)) * Math.PI * 2;
      // A ragged hem: the tail is cut open at the front, so the radius dips
      // where the two halves cross.
      const flap = 1 - 0.12 * Math.max(0, Math.cos(a));
      const p = [Math.cos(a) * rx * flap, y, Math.sin(a) * rz * flap];
      const n = [Math.cos(a), 0.18, Math.sin(a) * (rx / rz)];
      const nl = Math.hypot(n[0], n[1], n[2]);
      mb.vert(p, [n[0] / nl, n[1] / nl, n[2] / nl], [i / 3, y * 6], ih, ih, 1, 0, 1);
    }
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < SIDES * 2; i++) {
      const i2 = (i + 1) % (SIDES * 2);
      const a = first + r * SIDES * 2 + i;
      const b = first + r * SIDES * 2 + i2;
      const c = first + (r + 1) * SIDES * 2 + i2;
      const d = first + (r + 1) * SIDES * 2 + i;
      mb.quad(a, b, c, d);
    }
  }
}

export function buildFighterMesh(sk) {
  const skinMB = new MeshBuilder();
  for (const seg of SKIN_SEGMENTS) addTube(skinMB, sk, seg, 0, 1.0);
  addHead(skinMB, sk);

  const giMB = new MeshBuilder();
  for (const seg of GI_SEGMENTS) {
    addTube(giMB, sk, seg, seg[6] === 'pants' ? 2 : 1, 0.55);
  }
  addSkirt(giMB, sk);
  addLapel(giMB, sk, 1);
  addLapel(giMB, sk, -1);
  addBelt(giMB, sk);

  return { skin: skinMB.build(), gi: giMB.build() };
}

// Where a hand can grab. Each is a bind-space offset from a bone, so the world
// point follows the pose for free — a lapel grip stays on the lapel when the
// opponent turns.
// Where a hand goes when it takes hold of something.
//
// Every one of these sits on the *surface* of what it grips, not on the bone
// down the middle of it. That sounds obvious and it was wrong here for a long
// time: a sleeve grip was authored three centimetres off the forearm bone,
// which is inside the forearm, so the rig dutifully welded a hand into the
// middle of an arm and drove the gripping fighter's own forearm in after it.
// Twelve centimetres of a clinch's interpenetration was this one number.
//
// The offsets are the segment's own radius from body.js plus a little, because
// a hand closing on a sleeve sits around it rather than on it.
export const GRIP_POINTS = {
  lapelL: ['chest', [0.075, 0.06, 0.15]],
  lapelR: ['chest', [-0.075, 0.06, 0.15]],
  sleeveL: ['foreL', [0.02, -0.16, 0.085]],
  sleeveR: ['foreR', [-0.02, -0.16, 0.085]],
  wristL: ['handL', [0, -0.02, 0.045]],
  wristR: ['handR', [0, -0.02, 0.045]],
  ankleL: ['footL', [0, -0.01, 0.045]],
  ankleR: ['footR', [0, -0.01, 0.045]],
  neck: ['neck', [0, 0.04, 0.075]],
  beltBack: ['hips', [0, 0.05, -0.17]],
  hipL: ['hips', [0.2, 0.03, 0]],
  hipR: ['hips', [-0.2, 0.03, 0]],
  kneeL: ['shinL', [0, -0.02, 0.1]],
  kneeR: ['shinR', [0, -0.02, 0.1]],
  headBack: ['head', [0, 0.05, -0.11]],
};
