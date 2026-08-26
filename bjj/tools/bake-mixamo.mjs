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
import { buildFighterMesh } from '../src/render/body.js';

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
  if (bot > 0.42) return { kind: 'shirt', mat: NOGI ? 1 : -1 };
  return { kind: 'trousers', mat: NOGI ? 2 : -1 };
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

// Built in the rig's own bind pose, which is exactly the space the retargeted
// body now lives in, so the two meet without any fitting step at all. That is
// the payoff for warping the character onto our skeleton rather than adopting
// theirs: everything else in the project already speaks this one rig.
if (!NOGI) {
  const dressed = new Skeleton();
  dressed.pose();
  const { gi } = buildFighterMesh(dressed);
  const off = P.length / 3;
  for (let i = 0; i < gi.pos.length; i++) P.push(gi.pos[i]);
  for (let i = 0; i < gi.bone.length; i++) BONE.push(gi.bone[i]);
  for (let i = 0; i < gi.wt.length; i++) WT.push(gi.wt[i]);
  for (let i = 0; i < gi.mat.length; i++) MAT.push(gi.mat[i]);
  for (let i = 0; i < gi.idx.length; i++) IDX.push(off + gi.idx[i]);
  console.log(`gi: ${gi.pos.length / 3} verts  ${gi.idx.length / 3} tris`);
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
