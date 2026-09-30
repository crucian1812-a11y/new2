// How a man is built: one table, read by the mesh and by the collider alike.
//
// The pose library is paired — both skeletons in every frame, and the offset
// between their pelvises — so a man cannot be taller or shorter than the
// skeleton he was posed on without every grip in the library landing in the
// wrong place. What can change is how much of him there is around his bones.
// A heavyweight is not a taller middleweight; he is the same frame with more
// on it, and that is exactly the part the poses leave free.
//
// So a build is a scale on the cross-section of each part, across the bone and
// never along it: the trunk in width and in depth separately (a heavy man
// carries it in the belly as much as in the shoulders), and the neck and each
// segment of each limb by one number. Hands, feet and the head are left alone:
// they are what the grips hold and what the face is, and neither gets bigger
// with a weight class.
//
// The same numbers go to two places, and have to:
//
//   - shapeMesh() moves the baked vertices in bind space, before they reach
//     the GPU, so the skin a player sees is the built one;
//   - collide.js scales its capsules by capsuleScale(), so the ruler every
//     measurement and every solver in tools/ uses is the built one too.
//
// A heavier pair is deeper inside each other in every pose they share, and a
// lighter pair floats apart; how far each part may go is not chosen here but
// solved — see tools/build-solve.mjs and the generated table in
// src/game/build-room.js.

import { Skeleton, BONE_INDEX, BONES } from './skeleton.js';

// The parts a build can change, in the order the solver walks them.
export const REGIONS = ['trunkW', 'trunkD', 'neck', 'arm', 'fore', 'thigh', 'shin'];

// Which part each bone belongs to, and the segment its cross-section is taken
// about. The segment is the collider's own — the same pair of joints its
// capsule spans — so the axis the skin is pushed away from is the axis the
// capsule is measured from.
const SEGMENT = {
  hips: ['hips', 'spine', 'trunk'],
  spine: ['spine', 'chest', 'trunk'],
  chest: ['chest', 'neck', 'trunk'],
  // The collarbones carry the top of the shoulder, which is trunk; they have
  // no capsule of their own, so they are pushed about the chest's line.
  clavL: ['chest', 'neck', 'trunk'],
  clavR: ['chest', 'neck', 'trunk'],
  neck: ['neck', 'head', 'neck'],
  armL: ['armL', 'foreL', 'arm'],
  armR: ['armR', 'foreR', 'arm'],
  foreL: ['foreL', 'handL', 'fore'],
  foreR: ['foreR', 'handR', 'fore'],
  thighL: ['thighL', 'shinL', 'thigh'],
  thighR: ['thighR', 'shinR', 'thigh'],
  shinL: ['shinL', 'footL', 'shin'],
  shinR: ['shinR', 'footR', 'shin'],
};

export const BASE_BUILD = Object.freeze(Object.fromEntries(REGIONS.map((r) => [r, 1])));

// Across-the-bone scales for one part: [across, front to back].
export function partScale(build, part) {
  if (!build) return [1, 1];
  if (part === 'trunk') return [build.trunkW ?? 1, build.trunkD ?? 1];
  const s = build[part] ?? 1;
  return [s, s];
}

// The cross-section frame of a segment, built exactly as collide.js builds the
// frame of a capsule — `sx` across, `sz` front to back — so a scale on `sx`
// here is a scale on the capsule's own width there.
export function frameOf(A, B) {
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
  return { a: A, ax, sx, sz, len };
}

// Every bone's segment in bind space, once.
const FRAMES = (() => {
  const rest = new Skeleton();
  const at = (n) => { const m = rest.bind[BONE_INDEX[n]]; return [m[12], m[13], m[14]]; };
  const out = new Array(BONES.length).fill(null);
  for (const [bone, [a, b, part]] of Object.entries(SEGMENT)) {
    out[BONE_INDEX[bone]] = { ...frameOf(at(a), at(b)), part };
  }
  return out;
})();

// The capsule scale collide.js applies: [width, front-to-back] for the capsule
// whose first bone is `bone`. Hands, feet and the head come back as one.
export function capsuleScale(build, bone) {
  const f = FRAMES[BONE_INDEX[bone]];
  return f ? partScale(build, f.part) : [1, 1];
}

// A built copy of a baked mesh. The input is not touched: the same decoded
// file is shaped once for every man who wears it.
//
// A vertex moves by the blend of what each of its bones would do to it — the
// same weights the skinning uses — so the seam between a sleeve and a chest
// moves partly with each, the way it bends partly with each. What one bone
// does is scale the vertex's offset from that bone's line, across the line
// only: a point beyond the end of a segment is pushed out sideways like its
// neighbours and not along the bone, so nothing grows longer.
export function shapeMesh(mesh, build) {
  const n = mesh.pos.length / 3;
  const pos = new Float32Array(mesh.pos);
  const nrm = new Float32Array(mesh.nrm);
  if (!build || REGIONS.every((r) => (build[r] ?? 1) === 1)) return { ...mesh, pos, nrm };
  const { bone, wt } = mesh;
  for (let v = 0; v < n; v++) {
    const px = mesh.pos[v * 3], py = mesh.pos[v * 3 + 1], pz = mesh.pos[v * 3 + 2];
    const nx = mesh.nrm[v * 3], ny = mesh.nrm[v * 3 + 1], nz = mesh.nrm[v * 3 + 2];
    let dx = 0, dy = 0, dz = 0, mx = 0, my = 0, mz = 0;
    for (let k = 0; k < 4; k++) {
      const w = wt[v * 4 + k];
      if (w <= 0) continue;
      const f = FRAMES[bone[v * 4 + k] | 0];
      if (!f) { mx += w * nx; my += w * ny; mz += w * nz; continue; }
      const [sw, sd] = partScale(build, f.part);
      const rx = px - f.a[0], ry = py - f.a[1], rz = pz - f.a[2];
      const ox = rx * f.sx[0] + ry * f.sx[1] + rz * f.sx[2];
      const oz = rx * f.sz[0] + ry * f.sz[1] + rz * f.sz[2];
      dx += w * (ox * (sw - 1) * f.sx[0] + oz * (sd - 1) * f.sz[0]);
      dy += w * (ox * (sw - 1) * f.sx[1] + oz * (sd - 1) * f.sz[1]);
      dz += w * (ox * (sw - 1) * f.sx[2] + oz * (sd - 1) * f.sz[2]);
      // A normal goes the other way from a position under a stretch: what
      // is scaled up across the bone leans less across it.
      const qx = nx * f.sx[0] + ny * f.sx[1] + nz * f.sx[2];
      const qz = nx * f.sz[0] + ny * f.sz[1] + nz * f.sz[2];
      const cx = qx * (1 / sw - 1), cz = qz * (1 / sd - 1);
      mx += w * (nx + cx * f.sx[0] + cz * f.sz[0]);
      my += w * (ny + cx * f.sx[1] + cz * f.sz[1]);
      mz += w * (nz + cx * f.sx[2] + cz * f.sz[2]);
    }
    pos[v * 3] = px + dx; pos[v * 3 + 1] = py + dy; pos[v * 3 + 2] = pz + dz;
    const l = Math.hypot(mx, my, mz) || 1;
    nrm[v * 3] = mx / l; nrm[v * 3 + 1] = my / l; nrm[v * 3 + 2] = mz / l;
  }
  return { ...mesh, pos, nrm };
}

// A build between two solved ones: 0 is the baked man, +1 the heaviest the
// library holds, −1 the lightest. Per part, so a build keeps the shape the
// solver found rather than growing every part by the same fraction.
export function buildAt(mass, room) {
  const end = mass >= 0 ? room.heavy : room.light;
  const t = Math.min(1, Math.abs(mass));
  return Object.fromEntries(REGIONS.map((r) => [r, 1 + ((end[r] ?? 1) - 1) * t]));
}
