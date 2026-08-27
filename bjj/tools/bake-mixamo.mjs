// Bake a rigged Mixamo character into the game's fighter format.
//
// This exists because the other baker has to guess. bake-fighter.mjs takes a
// generated sculpt — a shell of triangles with no skeleton and no weights —
// estimates where the joints are from the silhouette, warps the shell onto the
// canonical rig, and then invents skin weights by seeding a few vertices and
// diffusing along mesh edges. It works, and every stage of it is an estimate
// stacked on the last, which is why the feet came out forty-four centimetres
// long the first time.
//
// A Mixamo export needs none of that. The skeleton is in the file. The bind
// matrix of every bone is in the file, as the cluster's TransformLink. The skin
// weights are in the file, authored by whatever made the character. All this has
// to do is say which mixamorig bone is which of our twenty-four, move the mesh
// from their bind pose to ours, and fold sixty-seven bones' worth of weights
// down onto twenty-four.
//
//   node bjj/tools/bake-mixamo.mjs bjj/art/mixamo/body-block.fbx --out bjj/assets/fighter.bin

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { readMixamo } from './mixamo.mjs';
import { Skeleton, BONES, BONE_COUNT, BONE_INDEX } from '../src/render/skeleton.js';

const argv = process.argv.slice(2);
const SRC = argv.find((a) => !a.startsWith('-')) || 'bjj/art/mixamo/body-block.fbx';
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const OUT = flag('out', 'bjj/assets/fighter.bin');
const HEIGHT = +flag('height', 1.78);
const REPORT = argv.includes('--report');
// The character came in a t-shirt and shorts. This sport is played in a gi, and
// the game is played on its lapels and its belt, so by default the source's own
// clothes are dropped and the gi that body.js already knows how to build — with
// a collar, a skirt and a belt — is put on the body instead. --nogi keeps what
// the character arrived in.
const NOGI = argv.includes('--nogi');

/* --------------------------------------------------------- the bone map */

// Ours on the left, theirs on the right. Everything mixamorig has that we do
// not — fingers, eyes, the second and third spine segment, the toe ends — folds
// into the nearest of ours that is an ancestor of it, which is the entry in
// FOLD. Nothing is dropped: a weight on a finger becomes a weight on the hand,
// and the hand is what the game animates anyway.
const MAP = {
  hips: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck',
  head: 'Head', headTop: 'HeadTop_End',
  clavL: 'LeftShoulder', armL: 'LeftArm', foreL: 'LeftForeArm',
  handL: 'LeftHand', handLTip: 'LeftHandMiddle3',
  clavR: 'RightShoulder', armR: 'RightArm', foreR: 'RightForeArm',
  handR: 'RightHand', handRTip: 'RightHandMiddle3',
  thighL: 'LeftUpLeg', shinL: 'LeftLeg', footL: 'LeftFoot', toeL: 'LeftToeBase',
  thighR: 'RightUpLeg', shinR: 'RightLeg', footR: 'RightFoot', toeR: 'RightToeBase',
};

// Which of ours a mixamorig bone's weight belongs to, when it is not one we map
// directly. Prefix match, longest first.
const FOLD = [
  ['LeftHand', 'handL'], ['RightHand', 'handR'],
  ['LeftToe', 'toeL'], ['RightToe', 'toeR'],
  ['LeftEye', 'head'], ['RightEye', 'head'],
  ['Spine1', 'chest'], ['Spine2', 'chest'], ['Spine', 'spine'],
];

function ourBoneFor(mixName) {
  const bare = mixName.replace('mixamorig:', '');
  for (const [our, their] of Object.entries(MAP)) if (their === bare) return our;
  for (const [prefix, our] of FOLD) if (bare.startsWith(prefix)) return our;
  return null;
}

/* ------------------------------------------------------- matrix helpers */

const mul = (a, b) => {
  const o = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                     a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
};

function invRigid(m) {
  const o = new Float64Array(16);
  o[15] = 1;
  // The bind matrices carry a uniform scale; take it out before transposing.
  const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
  const k = s2 > 1e-12 ? 1 / s2 : 1;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c] * k;
  const tx = m[12], ty = m[13], tz = m[14];
  o[12] = -(o[0] * tx + o[4] * ty + o[8] * tz);
  o[13] = -(o[1] * tx + o[5] * ty + o[9] * tz);
  o[14] = -(o[2] * tx + o[6] * ty + o[10] * tz);
  return o;
}

const xform = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/* ------------------------------------------------------------- the bake */

const parsed = readMixamo(SRC);
const byName = new Map();
for (const b of parsed.bones.values()) byName.set(b.name.replace('mixamorig:', ''), b);

// Our canonical skeleton in its bind pose. This is the target.
const rig = new Skeleton();
rig.pose();
const ourBind = BONES.map((_, i) => rig.bind[i]);

// Their bind pose, from the cluster TransformLinks where they exist and from
// the node hierarchy where they do not.
const theirBind = new Map();
for (const list of parsed.skins.values()) {
  for (const c of list) {
    if (c.transformLink && !theirBind.has(c.boneName)) {
      theirBind.set(c.boneName.replace('mixamorig:', ''), Float64Array.from(c.transformLink));
    }
  }
}
for (const [bare, b] of byName) {
  if (!theirBind.has(bare)) theirBind.set(bare, Float64Array.from(parsed.world.get(b.id)));
}

// Their scale, measured off the mesh rather than the skeleton: the skeleton's
// top bone is the crown and a person is a little taller than their crown, but
// the mesh is exactly as tall as the character is.
let lo = Infinity, hi = -Infinity;
for (const m of parsed.meshes) {
  for (let i = 1; i < m.pos.length; i += 3) { lo = Math.min(lo, m.pos[i]); hi = Math.max(hi, m.pos[i]); }
}
const theirHeight = hi - lo;
const SCALE = HEIGHT / theirHeight;
console.log(`source stands ${theirHeight.toFixed(0)} units tall; scaling by ${SCALE.toFixed(5)} to ${HEIGHT} m`);

// The per-bone move: from their bind space into ours.
//
// The order matters and it is easy to get wrong, which it was: the inverse bind
// takes a vertex from their world into the bone's own space and leaves it in
// the source file's units, which are centimetres. Feeding that to our bind
// matrix, which is in metres, puts the mesh a hundred times too far from the
// origin — thirty-three metres under the floor, in this case. The scale belongs
// between the two, on the way out of their space and before ours.
//
// A per-bone scale goes in the same place, and it is not optional. The source
// and the rig are both a metre seventy-eight and they are not the same shape:
// this character's ankle sits eleven centimetres off the floor and the rig's
// sits at six, so a foot moved rigidly onto the rig's ankle bone hangs five
// centimetres through the mat and stays there in every pose. Scaling each bone
// by the ratio of its length to ours puts the child joint where our child joint
// is, and the mesh between them follows the blend.
const move = new Array(BONE_COUNT).fill(null);
const missing = [];
const childOf = new Array(BONE_COUNT).fill(-1);
for (let i = 0; i < BONE_COUNT; i++) {
  const par = BONES[i][1];
  if (par >= 0 && childOf[par] < 0) childOf[par] = i;
}

const origin = (m) => [m[12], m[13], m[14]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// A bone's frame, built the same way from both rigs.
//
// Not the bind matrix. A bind matrix carries whatever rest orientation the
// rig's author chose, and the two authors did not choose the same one: this
// character's foot bone points forward along the foot and ours points straight
// down, so moving a foot from one bind frame to the other rotates it ninety
// degrees and stands the character on its toes twelve centimetres in the air.
//
// What both rigs agree on is where the joints are. So the frame is built from
// the direction to the child joint, squared up against the way the character
// faces, and that is the same frame in both — which is the whole point.
function frameOf(o, dir) {
  const y = norm(dir);
  // Anything not parallel to the bone will do as a reference; +Z is the way
  // both of these characters face in their rest pose.
  let ref = Math.abs(y[2]) > 0.94 ? [0, 1, 0] : [0, 0, 1];
  const z = norm(sub(ref, [y[0] * dot(y, ref), y[1] * dot(y, ref), y[2] * dot(y, ref)]));
  const x = cross(y, z);
  const m = new Float64Array(16);
  m[0] = x[0]; m[1] = x[1]; m[2] = x[2];
  m[4] = y[0]; m[5] = y[1]; m[6] = y[2];
  m[8] = z[0]; m[9] = z[1]; m[10] = z[2];
  m[12] = o[0]; m[13] = o[1]; m[14] = o[2];
  m[15] = 1;
  return m;
}

// Both rigs' joint positions, ours in metres and theirs scaled to match.
const ourPos = BONES.map((_, i) => origin(ourBind[i]));
const theirPos = new Array(BONE_COUNT).fill(null);
for (let i = 0; i < BONE_COUNT; i++) {
  const tb = theirBind.get(MAP[BONES[i][0]]);
  if (tb) theirPos[i] = [tb[12] * SCALE, tb[13] * SCALE, tb[14] * SCALE];
}

// Bone directions. A tip has no child of its own, so it borrows its parent's.
function dirsOf(P) {
  const D = new Array(BONE_COUNT).fill(null);
  for (let i = 0; i < BONE_COUNT; i++) {
    const j = childOf[i];
    if (j >= 0 && P[i] && P[j] && len(sub(P[j], P[i])) > 1e-5) D[i] = norm(sub(P[j], P[i]));
  }
  for (let i = 0; i < BONE_COUNT; i++) {
    if (D[i]) continue;
    const par = BONES[i][1];
    D[i] = (par >= 0 && D[par]) || [0, -1, 0];
  }
  return D;
}
const ourDir = dirsOf(ourPos);
const theirDir = dirsOf(theirPos);

const scales = [];
for (let i = 0; i < BONE_COUNT; i++) {
  if (!theirPos[i]) { missing.push(BONES[i][0]); continue; }

  // Length ratio to the child joint, so the child lands on our child.
  let s = 1;
  const j = childOf[i];
  if (j >= 0 && theirPos[j]) {
    const tl = len(sub(theirPos[j], theirPos[i]));
    if (tl > 1e-4) s = Math.max(0.6, Math.min(1.6, len(sub(ourPos[j], ourPos[i])) / tl));
  } else if (BONES[i][1] >= 0) {
    s = scales.length ? scales[scales.length - 1][1] : 1;
  }
  scales.push([BONES[i][0], s]);

  const theirF = frameOf(theirPos[i], theirDir[i]);
  const ourF = frameOf(ourPos[i], ourDir[i]);
  const inv = invRigid(theirF);
  // Their world (already in metres) -> their bone frame -> scaled -> our frame.
  for (let k = 0; k < 15; k++) inv[k] *= s;
  const scaledInv = new Float64Array(inv);
  // invRigid gave a unit frame; the scale above multiplied the translation too,
  // which is what we want: the offset from the joint scales with the bone.
  move[i] = mul(ourF, scaledInv);
}
if (missing.length) console.warn('no source bone for:', missing.join(', '));
if (REPORT) {
  console.log('per-bone scale:');
  for (const [n, sc] of scales) if (Math.abs(sc - 1) > 0.02) console.log(`  ${n.padEnd(9)} x${sc.toFixed(2)}`);
}

/* --------------------------------------------------------- mesh merging */

const sourceFloor = lo;

// Which of our materials each part of the character wears. The parts arrive
// unnamed and in no particular order, so they are identified the way a person
// would: by which bones move them and how far up the body they sit.
function classify(mesh, clusters) {
  const bones = new Set(clusters.map((c) => c.boneName.replace('mixamorig:', '')));
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < mesh.pos.length; i += 3) {
    lo = Math.min(lo, mesh.pos[i]); hi = Math.max(hi, mesh.pos[i]);
  }
  const top = (hi - sourceFloor) / theirHeight;
  const bot = (lo - sourceFloor) / theirHeight;
  // Eyeballs stay, as their own material. The other baker draws eyes onto a
  // face because its sculpt has none; this character came with sockets, lids,
  // a nose and a mouth already modelled, and drawing features on top of that
  // fights the geometry — the first attempt put a smear across the bridge of
  // the nose. Where a mesh has a real face, shade it and leave it alone.
  if ([...bones].some((b) => b.endsWith('Eye'))) return { kind: 'eyes', mat: 7 };
  // Eyelashes and brows: a hair material, but material 8 so the outline pass
  // knows to leave them alone. They are two triangles thick and an inverted
  // hull turns them into a black stripe across the face.
  if (bones.size <= 2 && bones.has('Head') && mesh.pos.length / 3 < 400) return { kind: 'brows', mat: 8 };
  if (bones.has('Head') && bot > 0.82) return { kind: 'hair', mat: 5 };
  // The body is the only part the arms move, and in a T-pose it is the only
  // part that is wider than it is thick by a factor of two.
  if (bones.has('LeftHand') || bones.has('RightHand')) return { kind: 'body', mat: 0 };
  if (bot < 0.12 && top < 0.2) return { kind: 'shoes', mat: -1 };
  if (bot > 0.42) return { kind: 'shirt', mat: 1 };
  return { kind: 'trousers', mat: 2 };
}

const P = [], NRM = [], BONE = [], WT = [], MAT = [], IDX = [];
let base = 0;
const parts = [];

for (const mesh of parsed.meshes) {
  const clusters = parsed.skins.get(mesh.id) || [];
  const info = classify(mesh, clusters);
  parts.push({ ...info, verts: mesh.pos.length / 3, tris: mesh.idx.length / 3 });
  if (info.mat < 0) continue;   // barefoot: the body under the shoes is real

  const n = mesh.pos.length / 3;
  // Fold their weights onto our bones.
  const acc = Array.from({ length: n }, () => new Map());
  for (const c of clusters) {
    const our = ourBoneFor(c.boneName);
    if (our === null) continue;
    const bi = BONE_INDEX[our];
    for (let k = 0; k < c.indices.length; k++) {
      const v = c.indices[k];
      const w = c.weights[k];
      if (v < 0 || v >= n || !(w > 0)) continue;
      acc[v].set(bi, (acc[v].get(bi) || 0) + w);
    }
  }

  for (let v = 0; v < n; v++) {
    // Top two bones, renormalised. The vertex format carries two and on a body
    // two is enough — the third is always under a couple of per cent.
    const pairs = [...acc[v].entries()].sort((a, b) => b[1] - a[1]);
    let b0 = pairs[0] ? pairs[0][0] : BONE_INDEX.hips;
    let b1 = pairs[1] ? pairs[1][0] : b0;
    let w0 = pairs[0] ? pairs[0][1] : 1;
    let w1 = pairs[1] ? pairs[1][1] : 0;
    const sum = w0 + w1 || 1;
    w0 /= sum; w1 /= sum;

    const x = mesh.pos[v * 3] * SCALE, y = mesh.pos[v * 3 + 1] * SCALE, z = mesh.pos[v * 3 + 2] * SCALE;
    const m0 = move[b0] || move[BONE_INDEX.hips];
    const m1 = move[b1] || m0;
    const p0 = xform(m0, x, y, z);
    const p1 = xform(m1, x, y, z);
    P.push(p0[0] * w0 + p1[0] * w1, p0[1] * w0 + p1[1] * w1, p0[2] * w0 + p1[2] * w1);
    BONE.push(b0, b1);
    WT.push(w0, w1);
    MAT.push(info.mat);
  }
  for (let i = 0; i < mesh.idx.length; i++) IDX.push(base + mesh.idx[i]);
  base += n;
}

console.log('parts:');
for (const p of parts) {
  console.log(`  ${p.kind.padEnd(9)} ${String(p.verts).padStart(5)} verts  ${String(p.tris).padStart(5)} tris  ` +
    (p.mat < 0 ? 'dropped' : `material ${p.mat}`));
}

/* ----------------------------------------------------------------- the gi */

function normals(P, idx) {
  const N = new Float64Array(P.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
  }
  let zero = 0;
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]);
    if (l < 1e-12) { N[i] = 0; N[i + 1] = 1; N[i + 2] = 0; zero++; }
    else { N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  }
  if (zero) console.warn(`warning: ${zero} degenerate normals`);
  return N;
}


// The gi is the body, pushed out.
//
// The first version wrapped the rig in body.js's tubes — a stack of twelve-sided
// cylinders of fixed radius, sized for the procedural mannequin they were
// written for. On an actual human body they read as a sack: barrel torso,
// spherical shoulders, and a hard ring where one cylinder met the next. A gi is
// loose, but it is loose *over a person*, and the shape it takes is the
// person's shape plus a couple of centimetres of cotton.
//
// So the garment is built from the body's own triangles. Take the part of the
// mesh the jacket covers, copy it, push every vertex out along its normal by
// the thickness of the cloth, and hem the open edges back down to the skin. It
// fits by construction, it carries the body's own skin weights so it deforms
// with it for free, and it costs nothing to author.
//
// Only the pieces the body has no shape for come from body.js: the collar and
// the belt, which are not offsets of anything.

// The garment regions, in the bind pose. The rig stands with its arms down, so
// every hem on a gi — the sleeve, the trouser cuff, the collar — is a
// horizontal plane, and a plane gives a clean edge.
function garmentOf(y, boneName, beltY, collarY, sleeveY, cuffY) {
  const arm = ['clavL', 'clavR', 'armL', 'armR'].includes(boneName);
  const fore = boneName === 'foreL' || boneName === 'foreR';
  const torso = ['spine', 'chest', 'neck'].includes(boneName);
  const leg = ['thighL', 'thighR', 'shinL', 'shinR'].includes(boneName);

  if (y > collarY) return 0;                                   // bare neck and head
  if (arm) return 1;
  if (fore) return y > sleeveY ? 1 : 0;                        // mid-forearm sleeve
  if (torso) return 1;
  if (boneName === 'hips') return y > beltY - 0.14 ? 1 : 2;
  if (leg) return y > cuffY ? 2 : 0;                           // bare ankles and feet
  return 0;
}

function inflate(want, thickness, mat) {
  // Triangles all of whose corners are in the region. A triangle straddling the
  // hem is left out, and the boundary it leaves behind is what gets stitched.
  const keep = [];
  for (let t = 0; t < IDX.length; t += 3) {
    const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
    if (MAT[a] !== 0 || MAT[b] !== 0 || MAT[c] !== 0) continue;   // skin only
    if (want(a) && want(b) && want(c)) keep.push(a, b, c);
  }
  if (!keep.length) return 0;

  // One offset copy per vertex used, and one un-offset copy for the hem, made
  // only where the hem needs it.
  const outer = new Map();
  const addOuter = (v) => {
    let n = outer.get(v);
    if (n !== undefined) return n;
    n = P.length / 3;
    P.push(pos0(v, 0) + NRM0[v * 3] * thickness,
           pos0(v, 1) + NRM0[v * 3 + 1] * thickness,
           pos0(v, 2) + NRM0[v * 3 + 2] * thickness);
    BONE.push(BONE[v * 2], BONE[v * 2 + 1]);
    WT.push(WT[v * 2], WT[v * 2 + 1]);
    MAT.push(mat);
    outer.set(v, n);
    return n;
  };

  const tris = [];
  for (let t = 0; t < keep.length; t += 3) {
    tris.push(addOuter(keep[t]), addOuter(keep[t + 1]), addOuter(keep[t + 2]));
  }

  // Boundary edges: used by exactly one kept triangle. Each becomes a quad
  // running from the outer shell back to the skin, so the hem has a thickness
  // and you never see the inside of the jacket through its own opening.
  const edge = new Map();
  const key = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);
  for (let t = 0; t < keep.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = keep[t + e], b = keep[t + ((e + 1) % 3)];
      const k = key(a, b);
      const found = edge.get(k);
      if (found) found.n++;
      else edge.set(k, { a, b, n: 1 });
    }
  }
  const inner = new Map();
  const addInner = (v) => {
    let n = inner.get(v);
    if (n !== undefined) return n;
    n = P.length / 3;
    P.push(pos0(v, 0) + NRM0[v * 3] * 0.002,
           pos0(v, 1) + NRM0[v * 3 + 1] * 0.002,
           pos0(v, 2) + NRM0[v * 3 + 2] * 0.002);
    BONE.push(BONE[v * 2], BONE[v * 2 + 1]);
    WT.push(WT[v * 2], WT[v * 2 + 1]);
    MAT.push(mat);
    inner.set(v, n);
    return n;
  };
  let hems = 0;
  for (const { a, b, n } of edge.values()) {
    if (n !== 1) continue;
    const oa = outer.get(a), ob = outer.get(b);
    const ia = addInner(a), ib = addInner(b);
    tris.push(oa, ob, ib, oa, ib, ia);
    hems++;
  }

  for (const v of tris) IDX.push(v);
  return { verts: outer.size + inner.size, tris: tris.length / 3, hems };
}

if (!NOGI) {
  // The body's own normals, needed before the merged mesh has any. Computed on
  // the skin triangles only, which is all the offset uses.
  var NRM0 = normals(new Float64Array(P), Uint32Array.from(IDX));
  var pos0 = (v, k) => P[v * 3 + k];

  const beltY = ourPos[BONE_INDEX.hips][1] + 0.055;
  const collarY = ourPos[BONE_INDEX.neck][1] + 0.035;
  const sleeveY = ourPos[BONE_INDEX.handL][1] + 0.05;
  const cuffY = ourPos[BONE_INDEX.footL][1] + 0.055;
  const boneName = (v) => BONES[BONE[v * 2]][0];
  const region = (v) =>
    garmentOf(P[v * 3 + 1], boneName(v), beltY, collarY, sleeveY, cuffY);

  if (REPORT) {
    const hist = {};
    for (let v = 0; v < MAT.length; v++) {
      if (MAT[v] !== 0) continue;
      const k = `${boneName(v)}->${region(v)}`;
      hist[k] = (hist[k] || 0) + 1;
    }
    console.log('region by bone:', Object.entries(hist).sort((a, b) => b[1] - a[1])
      .slice(0, 20).map(([k, n]) => `${k}:${n}`).join(' '));
  }
  // Only the sleeves are inflated from the body.
  //
  // The character's own shirt and trousers are proper tailored garments and
  // they stay — recoloured, they are the gi's body. What they are not is a gi's
  // *sleeve*: the shirt stops at the shoulder. The body under it carries the
  // arm, so the sleeve is that arm pushed out, from the shoulder down to
  // mid-forearm where a gi's sleeve ends.
  //
  // Inflating the torso as well was the first attempt and it came out coarse:
  // of the body mesh's seven thousand vertices, four and a half thousand are in
  // the head. A character built to be dressed has a low-polygon body under the
  // clothes, and the clothes are where the detail is.
  const sleeve = inflate(
    (v) => ['clavL', 'clavR', 'armL', 'armR'].includes(boneName(v)) ||
           ((boneName(v) === 'foreL' || boneName(v) === 'foreR') && P[v * 3 + 1] > sleeveY),
    0.03, 1
  );
  console.log(`sleeves: ${sleeve.tris} tris (${sleeve.hems} hem edges)`);

  // The belt and the skirt are measured onto the jacket, not assumed.
  //
  // body.js builds both at a fixed radius, sized for the mannequin it was
  // written against. On this character the belt came out a centimetre narrower
  // than the jacket and disappeared inside it — which is why a black belt
  // rendered as a pale band, because the pale band was the jacket and the belt
  // was never visible at all. The fix is to ask the jacket how wide it is.
  const SECTORS = 28;
  const hipsY = ourPos[BONE_INDEX.hips][1];

  // The widest garment vertex in each angular sector over a band of heights,
  // measured from the body's own axis.
  // Only the trunk counts. The rig stands with its arms down, so at hip height
  // the widest garment vertex is a sleeve, not a waist — measured naively this
  // came out twenty-four centimetres of half-width, which is a shoulder, and
  // the skirt built on it was a board.
  const TRUNK = new Set(['hips', 'spine', 'thighL', 'thighR']);

  function profile(yLo, yHi) {
    const r = new Array(SECTORS).fill(0);
    for (let v = 0; v < MAT.length; v++) {
      if (MAT[v] !== 1 && MAT[v] !== 2) continue;
      if (!TRUNK.has(BONES[BONE[v * 2]][0])) continue;
      const y = P[v * 3 + 1];
      if (y < yLo || y > yHi) continue;
      const x = P[v * 3], z = P[v * 3 + 2];
      const d = Math.hypot(x, z);
      let k = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * SECTORS) % SECTORS;
      if (k < 0) k += SECTORS;
      if (d > r[k]) r[k] = d;
    }
    // Fill any empty sector from its neighbours, and smooth once so the ring
    // does not scallop between one measurement and the next.
    for (let pass = 0; pass < 2; pass++) {
      const c = r.slice();
      for (let k = 0; k < SECTORS; k++) {
        const a = c[(k + SECTORS - 1) % SECTORS], b = c[(k + 1) % SECTORS];
        r[k] = c[k] > 0 ? c[k] * 0.6 + (a + b) * 0.2 : (a + b) / 2;
      }
    }
    return r;
  }

  const hips = BONE_INDEX.hips;
  const ring = (yOf, rOf, rows, mat) => {
    const first = P.length / 3;
    for (let row = 0; row < rows; row++) {
      const t = rows === 1 ? 0 : row / (rows - 1);
      for (let k = 0; k < SECTORS; k++) {
        const a = (k / SECTORS) * Math.PI * 2 - Math.PI;
        const rad = rOf(t, k);
        P.push(Math.cos(a) * rad, yOf(t, k, a), Math.sin(a) * rad);
        BONE.push(hips, hips);
        WT.push(1, 0);
        MAT.push(mat);
      }
    }
    for (let row = 0; row + 1 < rows; row++) {
      for (let k = 0; k < SECTORS; k++) {
        const k2 = (k + 1) % SECTORS;
        const a = first + row * SECTORS + k, b = first + row * SECTORS + k2;
        const c = first + (row + 1) * SECTORS + k2, d = first + (row + 1) * SECTORS + k;
        IDX.push(a, b, c, a, c, d);
      }
    }
    return first;
  };

  // The skirt: the jacket's tail, hanging from under the belt to mid-thigh. It
  // starts below the belt, not above it — carried up over the waist it was a
  // second barrel around the jacket, wider than the man inside it.
  const waist = profile(hipsY - 0.02, hipsY + 0.10);
  if (REPORT) console.log('waist profile cm:', waist.map((r) => (r * 100).toFixed(0)).join(' '));
  // A gi jacket is split up both sides and its tails hang past the split, so
  // the hem is not a horizontal cut. Built as one it read as a card taped to
  // the front of the fighter.
  ring(
    (t, k, a) => hipsY + 0.02 - t * (0.215 - 0.125 * Math.pow(Math.abs(Math.cos(a)), 2.2)),
    (t, k) => waist[k] + 0.006 + t * 0.020,
    5, 1
  );

  // The belt over it, wider again, with the two ends of the knot at the front.
  const over = profile(beltY - 0.08, beltY + 0.08);
  ring(
    (t) => beltY - 0.032 + t * 0.064,
    (t, k) => Math.max(over[k], waist[k]) + 0.016,
    2, 3
  );
  {
    const frontR = Math.max(over[Math.floor(SECTORS * 0.25)], waist[Math.floor(SECTORS * 0.25)]) + 0.018;
    for (const dx of [-0.055, 0.055]) {
      const f = P.length / 3;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          P.push(dx + (c ? 0.032 : -0.032), beltY + 0.030 - r * 0.20, frontR + 0.006);
          BONE.push(hips, hips);
          WT.push(1, 0);
          MAT.push(3);
        }
      }
      IDX.push(f, f + 1, f + 3, f, f + 3, f + 2);
    }
  }

  // The collar, measured the same way.
  //
  // body.js builds it as a flat ribbon fifteen centimetres in front of the
  // chest bone, which is where the front of the mannequin was. On a real chest
  // it floated: a white card hanging off the sternum. Here it is two strips
  // running from the base of the neck down to the belt, each one riding the
  // measured front of the jacket and closing towards the middle as it goes, so
  // it lies on the chest and makes the V a gi has.
  {
    const chest = profile(ourPos[BONE_INDEX.chest][1] - 0.06, ourPos[BONE_INDEX.chest][1] + 0.10);
    const front = (Math.max(chest[Math.floor(SECTORS * 0.25)], 0.10) + waist[Math.floor(SECTORS * 0.25)]) / 2;
    const topY = ourPos[BONE_INDEX.neck][1] - 0.01;
    const botY = beltY - 0.02;
    const ROWS = 5;
    const iChest = BONE_INDEX.chest;
    const iSpine = BONE_INDEX.spine;
    for (const side of [1, -1]) {
      const first = P.length / 3;
      for (let r = 0; r < ROWS; r++) {
        const t = r / (ROWS - 1);
        const y = topY + (botY - topY) * t;
        // Open at the throat, crossed at the waist: the offset from the middle
        // shrinks as it goes down and the strip leans inward with it.
        const off = 0.085 * (1 - t) + 0.012 * t;
        const z = front * (1 - t * 0.18) + 0.008;
        // Above the ribs the collar rides the chest bone, below them the spine,
        // so it folds with the torso rather than sliding across it.
        const b = t < 0.55 ? iChest : iSpine;
        for (let c = 0; c < 2; c++) {
          const w = 0.030;
          P.push(side * (off + (c ? w : -w) * 0.5), y, z - (c ? 0.004 : 0));
          BONE.push(b, b);
          WT.push(1, 0);
          MAT.push(4);
        }
      }
      for (let r = 0; r + 1 < ROWS; r++) {
        const a = first + r * 2, b2 = first + r * 2 + 1;
        const c2 = first + (r + 1) * 2 + 1, d = first + (r + 1) * 2;
        if (side > 0) IDX.push(a, b2, c2, a, c2, d);
        else IDX.push(a, c2, b2, a, d, c2);
      }
    }
  }
  // Nothing is taken from body.js any more.
  console.log('belt, skirt and collar all measured onto the jacket');
}

const pos = new Float64Array(P);
const idx = Uint32Array.from(IDX);
console.log(`\nmerged ${pos.length / 3} verts  ${idx.length / 3} tris`);
if (pos.length / 3 > 65535) throw new Error('too many vertices for a 16-bit index buffer');

/* ------------------------------------------------ stand it on the floor */

// The retarget lands the mesh on our rig, but the rig's hips are at a fixed
// height and the source's proportions are its own, so the feet end up a little
// above or below the mat. Drop it until the lowest vertex is on the floor.
let minY = Infinity;
for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i]);
console.log(`floor: lowest vertex sits at ${(minY * 100).toFixed(1)}cm`);
if (Math.abs(minY) > 0.045) {
  console.warn(
    'warning: the mesh does not stand on the rig. A big offset here means a ' +
    'limb was retargeted onto a bone of the wrong length; check the per-bone ' +
    'scales with --report rather than shifting the mesh, because shifting it ' +
    'moves the skin off the skeleton and every pose inherits the error.'
  );
}

/* ----------------------------------------------------- normals and UVs */

// Cylindrical about the body's own axis, which is all the noise textures need.
function uvs(P) {
  const UV = new Float64Array((P.length / 3) * 2);
  for (let v = 0; v < P.length / 3; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    UV[v * 2] = Math.atan2(z, x + 0.0001) * 1.1;
    UV[v * 2 + 1] = y * 8;
  }
  return UV;
}

const N = normals(pos, idx);
const UV = uvs(pos);

/* ---------------------------------------------------------- the eyeballs */

// Two spheres in two sockets, and nothing in the file says which way they look.
// So the shader is told: for every eyeball vertex, how far round the sphere it
// is from the direction the head faces. The front cap is the iris, the very
// middle of it is the pupil, the rest is sclera — and because it is measured in
// the bind pose it stays correct however the head is turned afterwards.
{
  const eye = [];
  for (let v = 0; v < MAT.length; v++) if (MAT[v] === 7) eye.push(v);
  if (eye.length) {
    // Left and right, split at the middle of the head.
    let mid = 0;
    for (const v of eye) mid += pos[v * 3];
    mid /= eye.length;
    for (const side of [-1, 1]) {
      const set = eye.filter((v) => (pos[v * 3] - mid) * side >= 0);
      if (!set.length) continue;
      let c = [0, 0, 0];
      for (const v of set) for (let k = 0; k < 3; k++) c[k] += pos[v * 3 + k];
      for (let k = 0; k < 3; k++) c[k] /= set.length;
      let r = 0;
      for (const v of set) {
        r = Math.max(r, Math.hypot(pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]));
      }
      r = Math.max(r, 1e-4);
      for (const v of set) {
        UV[v * 2] = (pos[v * 3] - c[0]) / r;
        UV[v * 2 + 1] = (pos[v * 3 + 2] - c[2]) / r;   // +Z is the way the face looks
      }
    }
    console.log(`eyes: ${eye.length} verts across two eyeballs`);
  }
}

/* ------------------------------------------------------------- reports */

if (REPORT) {
  const counts = {};
  for (const v of MAT) counts[v] = (counts[v] || 0) + 1;
  console.log('material split:', Object.entries(counts)
    .map(([k, v]) => `${['skin', 'jacket', 'pants', 'belt', 'lapel', 'hair', 'face', 'eye', 'lashes'][k]}:${v}`).join(' '));
  const per = new Array(BONE_COUNT).fill(0);
  for (let v = 0; v < BONE.length; v += 2) per[BONE[v]]++;
  console.log('vertices per bone:');
  for (let i = 0; i < BONE_COUNT; i++) console.log(`  ${BONES[i][0].padEnd(9)} ${per[i]}`);
}

/* ------------------------------------------------------------- encoding */

function encode(P, N, UV, bone, wt, mat, idx) {
  const n = P.length / 3;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], P[i * 3 + k]);
    mx[k] = Math.max(mx[k], P[i * 3 + k]);
  }
  let uvMax = 0;
  for (let i = 0; i < UV.length; i++) uvMax = Math.max(uvMax, Math.abs(UV[i]));

  const HEAD = 48;
  const buf = Buffer.alloc(HEAD + n * 17 + idx.length * 2 + 8);
  let o = 0;
  buf.write('BJJF', o); o += 4;
  buf.writeUInt16LE(1, o); o += 2;
  buf.writeUInt16LE(0, o); o += 2;
  buf.writeUInt32LE(n, o); o += 4;
  buf.writeUInt32LE(idx.length, o); o += 4;
  for (const v of [mn[0], mn[1], mn[2], mx[0], mx[1], mx[2], uvMax, 0]) { buf.writeFloatLE(v, o); o += 4; }
  const s = [0, 1, 2].map((k) => 65535 / Math.max(mx[k] - mn[k], 1e-6));
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    buf.writeUInt16LE(Math.round((P[i * 3 + k] - mn[k]) * s[k]), o); o += 2;
  }
  for (let i = 0; i < n * 3; i++) {
    buf.writeInt8(Math.max(-127, Math.min(127, Math.round(N[i] * 127))), o); o += 1;
  }
  for (let i = 0; i < n * 2; i++) {
    buf.writeInt16LE(Math.round((UV[i] / uvMax) * 32767), o); o += 2;
  }
  for (let i = 0; i < n * 2; i++) { buf.writeUInt8(bone[i], o); o += 1; }
  for (let i = 0; i < n; i++) { buf.writeUInt8(Math.round(wt[i * 2] * 255), o); o += 1; }
  for (let i = 0; i < n; i++) { buf.writeUInt8(mat[i], o); o += 1; }
  for (let i = 0; i < idx.length; i++) { buf.writeUInt16LE(idx[i], o); o += 2; }
  return buf.subarray(0, o);
}

const out = encode(pos, N, UV, BONE, WT, MAT, idx);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`\nwrote ${OUT}  ${(out.length / 1024).toFixed(0)} KB  ${pos.length / 3} verts  ${idx.length / 3} tris`);
