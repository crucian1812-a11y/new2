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
import { readMixamo, bare as bareName } from './mixamo.mjs';
import { vertexAO } from './ao.mjs';
import { decimate, deviation } from './decimate.mjs';
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
// Thin the merged mesh to about this many triangles before baking. 0 leaves it
// alone. See the decimation block at the bottom of this file.
const TRIS = +flag('tris', 0);
// Write the four strongest bones a vertex beside the mesh, to measure what the
// two-bone vertex format is costing before anybody pays to widen it.
const WEIGHTS4 = !!process.env.WEIGHTS4;
const W4 = [];

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
  handL: 'LeftHand', fingL: 'LeftHandMiddle1', handLTip: 'LeftHandMiddle3',
  clavR: 'RightShoulder', armR: 'RightArm', foreR: 'RightForeArm',
  handR: 'RightHand', fingR: 'RightHandMiddle1', handRTip: 'RightHandMiddle3',
  thighL: 'LeftUpLeg', shinL: 'LeftLeg', footL: 'LeftFoot', toeL: 'LeftToeBase',
  thighR: 'RightUpLeg', shinR: 'RightLeg', footR: 'RightFoot', toeR: 'RightToeBase',
};

// Which of ours a mixamorig bone's weight belongs to, when it is not one we map
// directly. Prefix match, longest first.
// Longest first, and the finger rows have to come before the bare hand or the
// prefix match swallows them: every `LeftHandIndex2` starts with `LeftHand`,
// which is how all fifteen finger bones used to end up on the palm.
//
// The last joint of each finger goes on the tip so that the fingers bend at two
// places rather than one; everything above it goes on the knuckle row. The
// thumb stays on the palm — see the note in skeleton.js.
const FOLD = [
  ['LeftHandIndex3', 'handLTip'], ['LeftHandIndex4', 'handLTip'],
  ['LeftHandMiddle3', 'handLTip'], ['LeftHandMiddle4', 'handLTip'],
  ['LeftHandRing3', 'handLTip'], ['LeftHandRing4', 'handLTip'],
  ['LeftHandPinky3', 'handLTip'], ['LeftHandPinky4', 'handLTip'],
  ['RightHandIndex3', 'handRTip'], ['RightHandIndex4', 'handRTip'],
  ['RightHandMiddle3', 'handRTip'], ['RightHandMiddle4', 'handRTip'],
  ['RightHandRing3', 'handRTip'], ['RightHandRing4', 'handRTip'],
  ['RightHandPinky3', 'handRTip'], ['RightHandPinky4', 'handRTip'],
  ['LeftHandIndex', 'fingL'], ['LeftHandMiddle', 'fingL'],
  ['LeftHandRing', 'fingL'], ['LeftHandPinky', 'fingL'],
  ['RightHandIndex', 'fingR'], ['RightHandMiddle', 'fingR'],
  ['RightHandRing', 'fingR'], ['RightHandPinky', 'fingR'],
  ['LeftHandThumb', 'handL'], ['RightHandThumb', 'handR'],
  ['LeftHand', 'handL'], ['RightHand', 'handR'],
  ['LeftToe', 'toeL'], ['RightToe', 'toeR'],
  ['LeftEye', 'head'], ['RightEye', 'head'],
  ['Spine1', 'chest'], ['Spine2', 'chest'], ['Spine', 'spine'],
];

function ourBoneFor(mixName) {
  const bare = bareName(mixName);
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
for (const b of parsed.bones.values()) byName.set(bareName(b.name), b);

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
      theirBind.set(bareName(c.boneName), Float64Array.from(c.transformLink));
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
  const bones = new Set(clusters.map((c) => bareName(c.boneName)));
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
  // The body is the part that runs from the feet to the head. Nothing a person
  // wears does that, and the obvious alternative — "the body is what the hand
  // bones move" — is wrong for anyone in long sleeves: a shirt whose cuffs
  // reach the wrists is skinned to the hands too, and Ch31 arrived wearing one
  // and was baked with his shirt painted as bare skin.
  if (top - bot > 0.6) return { kind: 'body', mat: 0 };
  if (bot < 0.12 && top < 0.2) return { kind: 'shoes', mat: -1 };
  if (bot > 0.42) return { kind: 'shirt', mat: 1 };
  return { kind: 'trousers', mat: 2 };
}

const P = [], NRM = [], BONE = [], WT = [], MAT = [], IDX = [];
// Vertex index -> the four bones and weights the file will carry. The two the
// baker itself works in stay where they are; this is read once, at the end,
// and only for vertices no later pass has re-weighted.
const ACC4 = new Map();
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

  const __drop = [];
  let __n3 = 0;
  for (let v = 0; v < n; v++) {
    // Top two bones, renormalised. The vertex format carries two and on a body
    // two is enough — the third is always under a couple of per cent.
    const pairs = [...acc[v].entries()].sort((a, b) => b[1] - a[1]);
    { let tot = 0; for (const e of pairs) tot += e[1];
      const kept = (pairs[0] ? pairs[0][1] : 0) + (pairs[1] ? pairs[1][1] : 0);
      __drop.push(tot > 0 ? 1 - kept / tot : 0);
      if (pairs.length > 2 && pairs[2][1] / (tot || 1) > 0.05) __n3++;
      // The four the shipped file carries. Kept beside the two the passes
      // below work in, because those passes are written against two and there
      // is no reason to teach every one of them a wider vertex.
      const four = pairs.slice(0, 4);
      let t4 = 0; for (const e of four) t4 += e[1];
      ACC4.set(P.length / 3, [0, 1, 2, 3].map((i) => four[i]
        ? [four[i][0], four[i][1] / (t4 || 1)] : [pairs[0] ? pairs[0][0] : BONE_INDEX.hips, 0])); }
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
    // A dump of what the two-bone format threw away, for the experiment that
    // decides whether a four-bone format is worth the change. Env-gated: it
    // writes nothing and costs nothing unless somebody is asking.
    if (WEIGHTS4) {
      const four = pairs.slice(0, 4);
      let t4 = 0; for (const e of four) t4 += e[1];
      W4.push(P.length / 3 - 1,
        ...[0, 1, 2, 3].flatMap((i) => four[i] ? [four[i][0], four[i][1] / (t4 || 1)] : [b0, 0]));
    }
    BONE.push(b0, b1);
    WT.push(w0, w1);
    MAT.push(info.mat);
  }
  if (WEIGHTS4) { const d = __drop.slice().sort((a, b) => a - b), q = (f) => d[Math.floor(d.length * f)] || 0;
    console.log(`two bones a vertex: dropped weight mean ${(d.reduce((a, b) => a + b, 0) / d.length * 100).toFixed(1)}%, `
      + `median ${(q(0.5) * 100).toFixed(1)}%, 90th ${(q(0.9) * 100).toFixed(1)}%, worst ${(q(0.999) * 100).toFixed(1)}%; `
      + `${__n3} of ${d.length} vertices have a third bone over 5%`); }
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
  // Nothing to inflate is a real answer, not a failure: a character who came
  // wearing long sleeves has no bare arm to push out.
  if (!keep.length) return { verts: 0, tris: 0, hems: 0 };

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
    if (ACC4.has(v)) ACC4.set(P.length / 3 - 1, ACC4.get(v));
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
    if (ACC4.has(v)) ACC4.set(P.length / 3 - 1, ACC4.get(v));
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
  console.log(sleeve.tris
    ? `sleeves: ${sleeve.tris} tris (${sleeve.hems} hem edges)`
    : 'sleeves: none needed — the character arrived in long sleeves');

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
    const FRONT = Math.floor(SECTORS * 0.25);
    // How far forward the jacket is at a given height. Taken at the collar's
    // own height row by row, not once at the chest: the body narrows sharply
    // towards the neck, and a strip held out at chest depth all the way up
    // reads as a bar across the throat rather than a collar on it.
    const frontAt = (y) => Math.max(0.085, profile(y - 0.055, y + 0.055)[FRONT]);
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
        const z = frontAt(y) + 0.008;
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

// Re-weight the fingers onto the two finger bones this rig actually has.
//
// Mixamo gives a hand fifteen bones; ours has two, and FOLD adds the source's
// weights up onto them. Adding them up is right for how much a vertex belongs
// to the hand and wrong for which bone swings it. handRTip's bind frame is the
// *middle* finger's third phalanx, so an index or a pinky fingertip, folded
// onto it, ends up rotating about a joint two or three centimetres from its
// own. The bind pose is unaffected — every transform is identity there — and
// the moment the hand closes those vertices leave on the wrong arc.
//
// What that looks like is splinters coming off the knuckles, which is how a
// player reported it. What it measures as is an edge: 112 edges past twice
// their bind length with the hand gripping, the worst 6.2x, the longest 43mm
// on a hand nine centimetres across. It is not the thinner's doing — the
// full-resolution bake is worse, 9.9x — and it is not the wrists, which never
// fold past 38 degrees.
//
// So the weights are recomputed from our own chain instead of inherited from
// theirs: a vertex is placed along handL -> fingL -> handLTip and blended
// linearly between the two joints it falls between. Only vertices that already
// carry some finger weight are touched, which is what keeps the thumb on the
// palm — FOLD puts it there and it must not curl with the fingers.
for (const side of ['L', 'R']) {
  const chain = ['hand' + side, 'fing' + side, 'hand' + side + 'Tip'].map((n) => BONE_INDEX[n]);
  if (chain.some((i) => i === undefined)) continue;
  const head = chain.map((i) => [ourBind[i][12], ourBind[i][13], ourBind[i][14]]);
  // Distance of each joint along the chain's own axis, and that axis.
  const ax = [head[2][0] - head[0][0], head[2][1] - head[0][1], head[2][2] - head[0][2]];
  const L = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  ax[0] /= L; ax[1] /= L; ax[2] /= L;
  const at = head.map((h) => (h[0] - head[0][0]) * ax[0] + (h[1] - head[0][1]) * ax[1] + (h[2] - head[0][2]) * ax[2]);
  let touched = 0;
  for (let v = 0; v < P.length / 3; v++) {
    let fingerish = 0;
    for (let k = 0; k < 2; k++)
      if (BONE[v * 2 + k] === chain[1] || BONE[v * 2 + k] === chain[2]) fingerish += WT[v * 2 + k];
    const s = (P[v * 3] - head[0][0]) * ax[0] + (P[v * 3 + 1] - head[0][1]) * ax[1] +
              (P[v * 3 + 2] - head[0][2]) * ax[2];
    // The palm past the knuckle line comes too, or it is the palm that tears.
    //
    // Re-weighting only the vertices FOLD already called finger left every
    // palm vertex beside them pinned at full hand weight, and a knuckle bend
    // pulled the two apart exactly as before: 6.2x became 4.6x and the worst
    // edge simply moved from finger-to-tip over to palm-to-finger. What has to
    // be smooth is the whole crossing, so anything past 55% of the way to the
    // knuckle joins the blend whether FOLD called it a finger or not.
    //
    // The thumb is the one thing that must not: it is off the chain's axis by
    // its own length, and a thumb that curls with the fingers is a fist. It is
    // kept out by distance from the axis rather than by name, because FOLD is
    // the only thing that knows it is a thumb and it has already thrown that
    // away.
    let off = 0;
    { const dx = P[v * 3] - (head[0][0] + ax[0] * s), dy = P[v * 3 + 1] - (head[0][1] + ax[1] * s),
        dz = P[v * 3 + 2] - (head[0][2] + ax[2] * s);
      off = Math.hypot(dx, dy, dz); }
    // And it has to already be part of this hand. In the A-pose the hands hang
    // beside the thighs, so a test on distance from the hand's axis alone
    // reaches straight into the trousers: it caught them, and a leg weighted
    // to a knuckle tore a half-metre edge across the model — 55.9x, which is
    // the measure earning its place twice in one afternoon.
    const ownsIt = BONE[v * 2] === chain[0] || BONE[v * 2] === chain[1] || BONE[v * 2] === chain[2] ||
                   BONE[v * 2 + 1] === chain[0] || BONE[v * 2 + 1] === chain[1] || BONE[v * 2 + 1] === chain[2];
    if (!ownsIt || fingerish <= 0.01) continue;   // palm and thumb keep what FOLD gave them
    // Half and half *at* the joint, not all-of-one on either side of it.
    //
    // A ramp that runs from the wrist to the knuckle hands a vertex sitting on
    // the knuckle line the whole of the finger bone, while the palm vertex
    // beside it still has the whole of the hand — which is the same cliff one
    // millimetre further along, and it measured that way: the worst edge moved
    // from finger-to-tip to palm-to-finger and barely shrank. A crease is a
    // band centred on the joint, so each band reaches fifty-fifty exactly
    // where the bone does. Bringing the palm into the blend instead was tried
    // and is worse — 8.3x against 4.6 — because a knuckle pad belongs to the
    // hand and pulling it onto the finger only moves the tear again.
    const w1 = 0.4 * Math.min(at[1] - at[0], at[2] - at[1]);
    const w2 = 0.4 * (at[2] - at[1]);
    const band = (x, c, w) => Math.min(1, Math.max(0, (x - (c - w)) / (2 * w)));
    const f1 = band(s, at[1], w1);
    const f2 = band(s, at[2], w2);
    const w = [1 - f1, f1 * (1 - f2), f1 * f2];
    // Two bones a vertex is all this format carries, so keep the two heaviest.
    const order = [0, 1, 2].sort((i, j) => w[j] - w[i]);
    const sum = w[order[0]] + w[order[1]] || 1;
    BONE[v * 2] = chain[order[0]]; WT[v * 2] = w[order[0]] / sum;
    BONE[v * 2 + 1] = chain[order[1]]; WT[v * 2 + 1] = w[order[1]] / sum;
    touched++;
  }
  if (touched) console.log(`re-weighted ${touched} finger vertices onto hand${side}/fing${side}/hand${side}Tip`);
}

// Close the fan the fingers arrive in.
//
// A player looked at the title screen and called the hands claws. Three
// explanations were tried and measured and all three were wrong — the rest
// curl (swept 26 to 60 degrees), the rim light (zeroed), the torn skin
// (already fixed, 112 stretched edges down to 14) — and the fourth was the
// mesh itself: both source characters are modelled with the fingers straight
// and spread, which is right for a T-pose and wrong for every frame of a
// fight. hand-check puts a number on it by looking down the palm at the air
// between the fingers: four to eleven square centimetres of it, and the spread
// getting wider toward the tips rather than narrower, 1.65 to 2.18 times.
//
// The rig cannot answer that. All four fingers share one `fing*` bone, so
// there is nothing to rotate a single finger with; two more bones a hand would
// buy a freedom no pose ever asks for, in a game where a hand is either open
// or on a lapel. What is wrong is the rest shape, and the rest shape is
// geometry, so it is fixed here — once, at bake time, on both characters, with
// the weights untouched.
//
// The move is a gap-closing map across the hand, and it is done on the
// silhouette rather than on the vertices, because the two cheap versions both
// fail on the same thing:
//
//   the extent of a triangle    a triangle of webbing at the base of two
//                               fingers spans the gap between them, so the
//                               gap reads as skin: 2mm of air found where the
//                               picture shows twenty.
//   the angle from an apex      fitted over both characters, the fingers are
//                               not radial from any point: the best apex still
//                               calls 95-100% of the fan skin.
//
// So: rasterise the fingers as an eye sees them — down the palm, half a
// millimetre a pixel — and read each row of that picture. A row is a cut
// across the hand; the runs of ink in it are the fingers at that height, and
// the air between the runs is what closes. Runs keep their width, so a finger
// keeps its thickness and its shape; only the gaps shrink, to GATHER of what
// they were.
//
// Rows are linked to the rows below them by overlap, which gives each finger
// an identity the mesh does not have — and that identity is what stops the two
// obvious failures. Near the knuckle the fingers are one run and nothing
// moves, so the palm and the webbing stay where they are. Past the end of the
// short fingers a row holds one run and would ask for nothing, so instead it
// keeps what its parent row asked for, and the long finger travels straight
// out rather than hooking back.
const GATHER = +(process.env.HAND_GATHER ?? 0.15);   // what is left of a gap
const GBIN = 0.0005;                                  // half a millimetre a pixel
for (const side of ['L', 'R']) {
  const chain = ['hand' + side, 'fing' + side, 'hand' + side + 'Tip'].map((n) => BONE_INDEX[n]);
  if (chain.some((i) => i === undefined)) continue;
  const head = chain.map((i) => [ourBind[i][12], ourBind[i][13], ourBind[i][14]]);
  const ax = [head[2][0] - head[0][0], head[2][1] - head[0][1], head[2][2] - head[0][2]];
  const AL = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  ax[0] /= AL; ax[1] /= AL; ax[2] /= AL;
  const along = (v) => (P[v * 3] - head[0][0]) * ax[0] + (P[v * 3 + 1] - head[0][1]) * ax[1] +
                       (P[v * 3 + 2] - head[0][2]) * ax[2];
  const perp = (v) => {
    const s = along(v);
    return [P[v * 3] - (head[0][0] + ax[0] * s), P[v * 3 + 1] - (head[0][1] + ax[1] * s),
            P[v * 3 + 2] - (head[0][2] + ax[2] * s)];
  };
  const knuck = (head[1][0] - head[0][0]) * ax[0] + (head[1][1] - head[0][1]) * ax[1] +
                (head[1][2] - head[0][2]) * ax[2];

  const nv = P.length / 3;
  const fw = new Float64Array(nv);       // how much of a vertex is finger
  const core = [];
  let smax = -Infinity;
  for (let v = 0; v < nv; v++) {
    let w = 0;
    for (let k = 0; k < 2; k++)
      if (BONE[v * 2 + k] === chain[1] || BONE[v * 2 + k] === chain[2]) w += WT[v * 2 + k];
    fw[v] = w;
    if (w >= 0.5) { core.push(v); const s = along(v); if (s > smax) smax = s; }
  }
  if (core.length < 20 || smax <= knuck) continue;

  // Which way the hand is wide, taken from the fingers themselves: the two
  // source meshes are built in different frames and the axis that is thickness
  // on one is spread on the other.
  let c = [0, 0, 0];
  for (const v of core) { const p = perp(v); c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c = c.map((x) => x / core.length);
  const t0 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const b1 = [ax[1] * t0[2] - ax[2] * t0[1], ax[2] * t0[0] - ax[0] * t0[2], ax[0] * t0[1] - ax[1] * t0[0]];
  const bl = Math.hypot(b1[0], b1[1], b1[2]); for (let i = 0; i < 3; i++) b1[i] /= bl;
  const b2 = [ax[1] * b1[2] - ax[2] * b1[1], ax[2] * b1[0] - ax[0] * b1[2], ax[0] * b1[1] - ax[1] * b1[0]];
  let U = null, bestS2 = -1;
  for (let a = 0; a < 180; a += 2) {
    const th = a * Math.PI / 180;
    const d = [0, 1, 2].map((i) => b1[i] * Math.cos(th) + b2[i] * Math.sin(th));
    let s2 = 0;
    for (const v of core) {
      const p = perp(v);
      const x = (p[0] - c[0]) * d[0] + (p[1] - c[1]) * d[1] + (p[2] - c[2]) * d[2];
      s2 += x * x;
    }
    if (s2 > bestS2) { bestS2 = s2; U = d; }
  }
  const lat = (v) => { const p = perp(v); return (p[0] - c[0]) * U[0] + (p[1] - c[1]) * U[1] + (p[2] - c[2]) * U[2]; };

  // The picture: rows from the knuckle out to the fingertips, columns across.
  const isCore = new Uint8Array(nv);
  for (const v of core) isCore[v] = 1;
  let u0 = Infinity, u1 = -Infinity;
  for (const v of core) { const u = lat(v); if (u < u0) u0 = u; if (u > u1) u1 = u; }
  u0 -= 0.010; u1 += 0.010;
  const NC = Math.ceil((u1 - u0) / GBIN) + 1, NR = Math.ceil((smax - knuck) / GBIN) + 1;
  const col = (v) => Math.round((lat(v) - u0) / GBIN);
  const row = (v) => Math.round((along(v) - knuck) / GBIN);
  // Taken again after the move, so the pass can say what it did rather than
  // what it meant to do.
  const shoot = () => {
    const mask = new Uint8Array(NC * NR);
    for (let t = 0; t < IDX.length; t += 3) {
      const a = IDX[t], b = IDX[t + 1], d = IDX[t + 2];
      if (!(isCore[a] && isCore[b] && isCore[d])) continue;
      const p = [[col(a), row(a)], [col(b), row(b)], [col(d), row(d)]];
      const xlo = Math.max(0, Math.min(p[0][0], p[1][0], p[2][0])), xhi = Math.min(NC - 1, Math.max(p[0][0], p[1][0], p[2][0]));
      const ylo = Math.max(0, Math.min(p[0][1], p[1][1], p[2][1])), yhi = Math.min(NR - 1, Math.max(p[0][1], p[1][1], p[2][1]));
      const sgn = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
      for (let y = ylo; y <= yhi; y++) for (let x = xlo; x <= xhi; x++) {
        const d1 = sgn(x, y, p[0][0], p[0][1], p[1][0], p[1][1]);
        const d2 = sgn(x, y, p[1][0], p[1][1], p[2][0], p[2][1]);
        const d3 = sgn(x, y, p[2][0], p[2][1], p[0][0], p[0][1]);
        if (!(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))) mask[y * NC + x] = 1;
      }
      // And the edges, walked: a triangle thinner than a pixel contains no
      // pixel centre, and a finger built of those reads as a row of holes —
      // which is how a hand with four fingers first measured as eight.
      for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
        const n2 = Math.max(Math.abs(p[j][0] - p[i][0]), Math.abs(p[j][1] - p[i][1]));
        for (let k = 0; k <= n2; k++) {
          const x = Math.round(p[i][0] + (p[j][0] - p[i][0]) * (k / (n2 || 1)));
          const y = Math.round(p[i][1] + (p[j][1] - p[i][1]) * (k / (n2 || 1)));
          if (x >= 0 && x < NC && y >= 0 && y < NR) mask[y * NC + x] = 1;
        }
      }
    }
    const rows = [];
    for (let y = 0; y < NR; y++) {
      const run = [];
      let lo = -1;
      for (let x = 0; x < NC; x++) {
        const on = mask[y * NC + x];
        if (on && lo < 0) lo = x;
        if ((!on || x === NC - 1) && lo >= 0) {
          const hi = on ? x : x - 1;
          // Anything thinner than three millimetres is not a finger. One
          // single-pixel speck beside the knuckle, taken for a finger, asked
          // the whole hand to slide twenty-seven millimetres sideways and
          // then handed that answer up every row above it.
          if (hi - lo + 1 >= 6) run.push({ lo, hi, d: 0 });
          lo = -1;
        }
      }
      rows.push(run);
    }
    return rows;
  };
  // The middle cut across the fingers, which is what hand-check reports and
  // what the eye reads: the worst single row is the notch where two fingers
  // part at the knuckle and it is there on a fist too.
  const midGap = (rows) => {
    const w = [];
    for (const run of rows) {
      let g = 0;
      for (let i = 1; i < run.length; i++) g = Math.max(g, run[i].lo - run[i - 1].hi - 1);
      if (run.length > 1) w.push(g);
    }
    w.sort((a, b) => a - b);
    return w.length ? w[w.length >> 1] * GBIN : 0;
  };

  const rows = shoot();
  const before = midGap(rows);
  for (const run of rows) {
    if (run.length < 2) continue;
    // Keep every run's width, shrink every gap, then slide the row back so
    // the hand closes on itself instead of drifting off the wrist.
    let cur = run[0].lo, inOld = 0, inNew = 0, wSum = 0;
    const put = [];
    for (let i = 0; i < run.length; i++) {
      put.push(cur);
      const w = run[i].hi - run[i].lo + 1;
      inOld += (run[i].lo + run[i].hi) * 0.5 * w; inNew += (cur + w * 0.5 - 0.5) * w; wSum += w;
      cur += w;
      if (i < run.length - 1) cur += (run[i + 1].lo - run[i].hi - 1) * GATHER;
    }
    const shift = (inOld - inNew) / wSum;
    for (let i = 0; i < run.length; i++) run[i].d = put[i] + shift - run[i].lo;
  }
  // A finger that has ended must not un-bend. Past the tip of the short
  // fingers a row holds one run, which has no gap to close and would ask for
  // nothing; instead it keeps what the row below it asked for, matched by
  // overlap, and the long finger travels straight out rather than hooking
  // back. Only rows with one run: handing a row's answer up wherever it was
  // larger poisoned the whole hand from a single speck.
  for (let y = 1; y < NR; y++) {
    if (rows[y].length !== 1) continue;
    const r = rows[y];
    let par = null, best = 0;
    for (const q of rows[y - 1]) {
      const ov = Math.min(r[0].hi, q.hi) - Math.max(r[0].lo, q.lo) + 1;
      if (ov > best) { best = ov; par = q; }
    }
    if (par) r[0].d = par.d;
  }

  // Row by row, with what each run was asked to do. This is how the speck was
  // found; leave it in, because the next thing that goes wrong here will go
  // wrong in the same place.
  if (process.env.HAND_TRACE) {
    console.log(`  hand${side}: NR=${NR} NC=${NC} knuck=${(knuck*1000).toFixed(0)} smax=${(smax*1000).toFixed(0)}`);
    for (let y = 0; y < NR; y += 8) {
      const r = rows[y];
      console.log(`   y=${String(y).padStart(4)} ${(y*GBIN*1000).toFixed(0).padStart(4)}mm runs=${r.length} ` +
        r.map((q) => `[${q.lo}-${q.hi} d=${q.d.toFixed(1)}]`).join(' '));
    }
  }
  const dispAt = (y, x) => {
    if (y < 0 || y >= NR) return 0;
    let best = null, near = Infinity;
    for (const r of rows[y]) {
      const dx = x < r.lo ? r.lo - x : x > r.hi ? x - r.hi : 0;
      if (dx < near) { near = dx; best = r; }
    }
    return best && near <= 8 ? best.d : 0;
  };

  let moved = 0, most = 0;
  for (let v = 0; v < nv; v++) {
    if (fw[v] <= 0.01) continue;                 // palm and thumb stay where they are
    const s = along(v);
    if (s <= knuck) continue;
    const y = (s - knuck) / GBIN, x = (lat(v) - u0) / GBIN;
    const y0 = Math.floor(y), f = y - y0;
    const d = (dispAt(y0, x) * (1 - f) + dispAt(y0 + 1, x) * f) * GBIN * Math.min(1, fw[v] / 0.5);
    if (Math.abs(d) < 1e-9) continue;
    for (let k = 0; k < 3; k++) { P[v * 3 + k] += d * U[k]; pos[v * 3 + k] = P[v * 3 + k]; }
    moved++; if (Math.abs(d) > most) most = Math.abs(d);
  }
  let fingers = 0;
  for (const run of rows) if (run.length > fingers) fingers = run.length;
  const after = midGap(shoot());
  console.log(`gathered hand${side}: ${moved} vertices, up to ${fingers} fingers apart, ` +
    `a typical cut ${(before * 1000).toFixed(1)}mm of air -> ${(after * 1000).toFixed(1)}mm, ` +
    `worst move ${(most * 1000).toFixed(1)}mm`);
}

// And fold the thumb in.
//
// The fingers were the loud half of the claw; the thumb is the half that no
// amount of rest curl can reach. FOLD puts it on the palm bone — deliberately,
// because a thumb that curls with the fingers is a fist — so whatever shape it
// arrives in, it holds in every frame of the game. It arrives standing 72mm
// off the axis of a hand 90mm long on fighter A and 57mm on the opponent: a
// hitchhiker. Swept against the picture, that thumb is the one part of a
// raised guard that does not move when HAND_REST goes from 26 degrees to 55,
// which is why sweeping the curl looked like it changed nothing.
//
// So it is folded here, the same way and for the same reason as the fingers:
// the rest shape is geometry. The thumb swings about its own base, in the
// plane that holds the hand's axis and the thumb's own direction, until its
// skin stands no further off that axis than THUMB_OFF. The angle is not
// written down — it is solved for, by bisection, so both characters land on
// the same number rather than on the same rotation.
const THUMB_OFF = +(process.env.HAND_THUMB ?? 0.042);
for (const side of ['L', 'R']) {
  const chain = ['hand' + side, 'fing' + side, 'hand' + side + 'Tip'].map((n) => BONE_INDEX[n]);
  if (chain.some((i) => i === undefined)) continue;
  const head = chain.map((i) => [ourBind[i][12], ourBind[i][13], ourBind[i][14]]);
  const ax = [head[2][0] - head[0][0], head[2][1] - head[0][1], head[2][2] - head[0][2]];
  const AL = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  for (let i = 0; i < 3; i++) ax[i] /= AL;

  // The thumb: on the palm bone, not on the fingers, and standing off the
  // axis. Found by where it is rather than by name, because FOLD is the only
  // thing that knew it was a thumb and it has already thrown that away.
  const nv = P.length / 3;
  const grp = [];
  for (let v = 0; v < nv; v++) {
    let wf = 0, wh = 0;
    for (let k = 0; k < 2; k++) {
      const b = BONE[v * 2 + k];
      if (b === chain[1] || b === chain[2]) wf += WT[v * 2 + k];
      if (b === chain[0]) wh += WT[v * 2 + k];
    }
    if (wf >= 0.5 || wh < 0.6) continue;
    const d = [P[v * 3] - head[0][0], P[v * 3 + 1] - head[0][1], P[v * 3 + 2] - head[0][2]];
    const t = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
    const r = [d[0] - ax[0] * t, d[1] - ax[1] * t, d[2] - ax[2] * t];
    const off = Math.hypot(r[0], r[1], r[2]);
    // The palm is the same bone and must not move: the ramp is zero at two
    // centimetres off the axis, which is the palm's own radius, and one at
    // four, which is past the web.
    const w = Math.min(1, Math.max(0, (off - 0.020) / 0.020));
    if (w <= 0) continue;
    grp.push({ v, off, w, t, r });
  }
  if (grp.length < 10) continue;
  const before = grp.reduce((a, g) => Math.max(a, g.off), 0);
  if (before <= THUMB_OFF) continue;

  // Its base, and the plane it swings in.
  let piv = [0, 0, 0], pn = 0, R = [0, 0, 0];
  for (const g of grp) {
    if (g.w < 0.35) { piv[0] += P[g.v * 3]; piv[1] += P[g.v * 3 + 1]; piv[2] += P[g.v * 3 + 2]; pn++; }
    if (g.w > 0.9) for (let i = 0; i < 3; i++) R[i] += g.r[i] / g.off;
  }
  if (!pn) continue;
  for (let i = 0; i < 3; i++) piv[i] /= pn;
  const RL = Math.hypot(R[0], R[1], R[2]) || 1;
  for (let i = 0; i < 3; i++) R[i] /= RL;
  // Perpendicular to both, so turning about it swings the thumb along the hand
  // rather than around it.
  const nx = [ax[1] * R[2] - ax[2] * R[1], ax[2] * R[0] - ax[0] * R[2], ax[0] * R[1] - ax[1] * R[0]];
  const NL = Math.hypot(nx[0], nx[1], nx[2]) || 1;
  for (let i = 0; i < 3; i++) nx[i] /= NL;
  // Rodrigues, about `nx` through `piv`. The sign is chosen by trying it: a
  // turn that takes the thumb further out is the other one.
  const turned = (g, th) => {
    const d = [P[g.v * 3] - piv[0], P[g.v * 3 + 1] - piv[1], P[g.v * 3 + 2] - piv[2]];
    const c = Math.cos(th), s = Math.sin(th);
    const kd = nx[0] * d[0] + nx[1] * d[1] + nx[2] * d[2];
    const cr = [nx[1] * d[2] - nx[2] * d[1], nx[2] * d[0] - nx[0] * d[2], nx[0] * d[1] - nx[1] * d[0]];
    return [0, 1, 2].map((i) => piv[i] + d[i] * c + cr[i] * s + nx[i] * kd * (1 - c));
  };
  const reach = (th) => {
    let worst = 0;
    for (const g of grp) {
      const p = turned(g, th * g.w);
      const d = [p[0] - head[0][0], p[1] - head[0][1], p[2] - head[0][2]];
      const t = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2];
      worst = Math.max(worst, Math.hypot(d[0] - ax[0] * t, d[1] - ax[1] * t, d[2] - ax[2] * t));
    }
    return worst;
  };
  const probe = 10 * Math.PI / 180;
  const sign = reach(probe) < reach(-probe) ? 1 : -1;
  let lo = 0, hi = sign * 80 * Math.PI / 180;
  if (reach(hi) > THUMB_OFF) { lo = hi; } else {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (reach(mid) > THUMB_OFF) lo = mid; else hi = mid;
    }
    lo = hi;
  }
  for (const g of grp) {
    const p = turned(g, lo * g.w);
    for (let k = 0; k < 3; k++) { P[g.v * 3 + k] = p[k]; pos[g.v * 3 + k] = p[k]; }
  }
  console.log(`folded the thumb of hand${side}: ${grp.length} vertices, ` +
    `${(before * 1000).toFixed(0)}mm off the hand's axis -> ${(reach(0) * 1000).toFixed(0)}mm, ` +
    `turned ${(Math.abs(lo) * 180 / Math.PI).toFixed(0)}°`);
}

// Find the eyeballs by their shape, for a character that welded them in.
//
// `classify` names a part by the bones that move it, and that works when the
// eyes arrive as their own submesh with eye clusters on them — fighter A's do,
// and they get material 7. Ch31's are two spheres merged into the body with no
// bones of their own, so nothing recognised them: the opponent shipped with no
// eye material at all, and look-check duly reported his eyes as worth 0.0
// levels because there was nothing to switch off.
//
// Bones cannot answer this, so shape does. An eyeball is a small closed piece
// of surface inside the head with a twin the same size mirrored across the
// centreline at the same height — which is a description of an eye and of
// nothing else on a person. Measured on the two characters: A's sit at 155.2
// and 155.3cm, 3.0cm either side of the middle, 3.5cm across; B's at 155.6cm,
// 2.7cm either side, 2.5cm across.
{
  const n = P.length / 3;
  const par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < IDX.length; t += 3) {
    const a = find(IDX[t]), b = find(IDX[t + 1]), c = find(IDX[t + 2]);
    if (a !== b) par[a] = b;
    const b2 = find(IDX[t + 1]), c2 = find(IDX[t + 2]);
    if (b2 !== c2) par[b2] = c2;
  }
  const comp = new Map();
  for (let v = 0; v < n; v++) {
    const c = find(v);
    let a = comp.get(c);
    if (!a) { a = { vs: [], lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] }; comp.set(c, a); }
    a.vs.push(v);
    for (let k = 0; k < 3; k++) {
      a.lo[k] = Math.min(a.lo[k], P[v * 3 + k]);
      a.hi[k] = Math.max(a.hi[k], P[v * 3 + k]);
    }
  }
  const headY = ourBind[BONE_INDEX.head] ? ourBind[BONE_INDEX.head][13] : 1.45;
  const cand = [];
  for (const a of comp.values()) {
    const d = [0, 1, 2].map((k) => a.hi[k] - a.lo[k]);
    const mid = [0, 1, 2].map((k) => (a.hi[k] + a.lo[k]) / 2);
    const big = Math.max(...d), small = Math.min(...d);
    // A hundred vertices, which is the clause that separates an eye from a
    // scrap of cheek. Both characters model an eyeball at 449 vertices; the
    // fragments the face breaks into are a dozen.
    if (a.vs.length < 100 || big > 0.05 || small < big * 0.6) continue;   // small, round and a real piece
    if (mid[1] < headY - 0.02) continue;                                  // inside the head
    if (Math.abs(mid[0]) < 0.005 || Math.abs(mid[0]) > 0.06) continue;    // off the centreline, not far
    cand.push({ a, mid, big });
  }
  // And it must have a twin: same height, same size, the other side.
  let eyeVerts = 0;
  for (const c of cand) {
    const twin = cand.find((o) => o !== c && o.mid[0] * c.mid[0] < 0 &&
      Math.abs(o.mid[1] - c.mid[1]) < 0.01 && Math.abs(o.big - c.big) < 0.01);
    if (!twin) continue;
    for (const v of c.a.vs) { if (MAT[v] !== 7) { MAT[v] = 7; eyeVerts++; } }
  }
  if (eyeVerts) console.log(`eyes: found ${eyeVerts} welded eyeball verts by shape and gave them their own material`);
}

// No vertex belongs to a limb and its twin at once.
//
// The characters' trousers are one surface across the crotch, and the weights
// go with it: vertices sitting between the legs carry both thighs — 0.84 of
// the left and 0.16 of the right — so they travel to the average of two legs
// that are about to go opposite ways. In BACK that drew a five-millimetre edge
// out to a hundred and forty-one, which is the whole thigh's width of trouser
// hanging in the gap.
//
// The minor share goes to the pair's common parent rather than to the bigger
// twin: the crotch of a pair of trousers belongs to the hips, and handing it
// wholly to one leg would make it follow that leg instead of staying put.
// Cutting the triangles that span the two legs (below) is the other half of
// the same fault and neither half is enough alone — a cut still leaves
// two-thigh vertices, and a re-weight still leaves a surface joining them.
const TWIN_PARENT = [
  [['thighL', 'thighR'], 'hips'], [['shinL', 'shinR'], 'hips'], [['footL', 'footR'], 'hips'],
  [['armL', 'armR'], 'chest'], [['foreL', 'foreR'], 'chest'], [['handL', 'handR'], 'chest'],
];
let straddlers = 0;
for (let v = 0; v < P.length / 3; v++) {
  for (const [[an, bn], pn] of TWIN_PARENT) {
    const a = BONE_INDEX[an], b = BONE_INDEX[bn], pa = BONE_INDEX[pn];
    if (a === undefined || b === undefined || pa === undefined) continue;
    const k0 = BONE[v * 2], k1 = BONE[v * 2 + 1];
    const onBoth = (k0 === a && k1 === b) || (k0 === b && k1 === a);
    if (!onBoth) continue;
    // Keep the heavier twin where it is; the lighter one becomes the parent.
    if (WT[v * 2] >= WT[v * 2 + 1]) BONE[v * 2 + 1] = pa;
    else BONE[v * 2] = pa;
    straddlers++;
    break;
  }
}
if (straddlers) console.log(`re-parented ${straddlers} vertices that straddled a limb and its twin`);

// Take the cliff out of the crotch.
//
// Re-parenting the two-thigh vertices onto the hips fixed who owns them and
// not how fast the ownership changes: BACK_WORK2 still had neighbours a
// five-millimetre edge apart carrying thighL 0.84/hips 0.16 and thighL
// 0.58/hips 0.42, and with the hip folded as far as that position folds it,
// a quarter of a weight is ten centimetres of trouser. skin-check called it
// 19.7x, the worst edge in the library.
//
// The gradient is what does it, so the gradient is what is smoothed — and only
// where this fault lives: vertices split between a thigh and the hips. The
// fingers, which were given their bands two blocks up, and every other joint
// on the body are left exactly as they are.
//
// Neighbours are found by position rather than by index, because this baker
// splits vertices at material and UV seams and a seam would otherwise stop the
// smoothing dead in the middle of the very patch that needs it.
{
  const n = P.length / 3;
  const key = (v) => `${Math.round(P[v * 3] * 2000)},${Math.round(P[v * 3 + 1] * 2000)},${Math.round(P[v * 3 + 2] * 2000)}`;
  const at = new Map();
  for (let v = 0; v < n; v++) {
    const k = key(v);
    let g = at.get(k); if (!g) { g = []; at.set(k, g); }
    g.push(v);
  }
  const nb = new Map();
  const link = (a, b) => { let g = nb.get(a); if (!g) { g = new Set(); nb.set(a, g); } g.add(b); };
  for (let t = 0; t < IDX.length; t += 3) {
    for (const [x, y] of [[0, 1], [1, 2], [2, 0]]) {
      const a = key(IDX[t + x]), b = key(IDX[t + y]);
      if (a !== b) { link(a, b); link(b, a); }
    }
  }
  const hip = BONE_INDEX.hips;
  const thigh = new Set([BONE_INDEX.thighL, BONE_INDEX.thighR]);
  // The hips' share at each welded position, for the vertices this applies to.
  const share = new Map();
  for (const [k, vs] of at) {
    const v = vs[0];
    const b0 = BONE[v * 2], b1 = BONE[v * 2 + 1];
    const isCrotch = (b0 === hip && thigh.has(b1)) || (b1 === hip && thigh.has(b0));
    if (!isCrotch) continue;
    share.set(k, b0 === hip ? WT[v * 2] : WT[v * 2 + 1]);
  }
  // One damped pass, and the number came from a sweep rather than from taste.
  //
  //   passes   worst edge   torn edges   of them past 40mm
  //     0        19.7x         32572          16394
  //     1        19.7x         31869          15504
  //     2        23.6x         31319          14857
  //     3        24.7x         30790          14806
  //
  // One buys nine hundred fewer long tears and costs nothing at all on the
  // worst edge. Past that it is a trade — more hip weight spread down the
  // thigh makes a new gradient of its own where the hips turn hardest, and
  // three passes walk the worst edge to within a tenth of the line the check
  // will not ship past. A gain that has to be argued for is not this one.
  for (let pass = 0; pass < 1; pass++) {
    const next = new Map();
    for (const [k, f] of share) {
      let sum = 0, cnt = 0;
      for (const j of nb.get(k) || []) { const g = share.get(j); if (g !== undefined) { sum += g; cnt++; } }
      next.set(k, cnt ? f + (sum / cnt - f) * 0.6 : f);
    }
    for (const [k, f] of next) share.set(k, f);
  }
  let smoothed = 0;
  for (const [k, f] of share) {
    for (const v of at.get(k)) {
      const b0 = BONE[v * 2];
      if (b0 === hip) { WT[v * 2] = f; WT[v * 2 + 1] = 1 - f; }
      else { WT[v * 2] = 1 - f; WT[v * 2 + 1] = f; }
      smoothed++;
    }
  }
  if (smoothed) console.log(`smoothed the thigh-to-hip weight across ${smoothed} crotch vertices`);
}

// Unsew the legs.
//
// The source characters stand in an A-pose with the inner thighs touching, and
// their trousers are one surface across the gap: 39 triangles have one corner
// driven by the left thigh and another by the right. In bind they are three
// millimetres wide and invisible. Spread the legs — which is most of this
// sport — and each one is stretched into a sail: measured on BACK_WORK, one of
// them reaches 118 square centimetres, a sheet wider than a hand strung
// between the knees. It survives decimation untouched because a seam is not
// something the thinner is allowed to move, and it was in the full-resolution
// bake too, so it is the character's own topology and not anything this file
// did to it.
//
// A triangle that spans a left limb and its right twin is never right on a
// grappler: those two bones are meant to move independently and any surface
// joining them will be torn by the first guard. So they are cut here rather
// than solved anywhere downstream.
const TWINS = [['thighL', 'thighR'], ['shinL', 'shinR'], ['footL', 'footR'],
               ['handL', 'handR'], ['foreL', 'foreR'], ['armL', 'armR']];
// A fifth of a vertex is enough to call it that side's.
//
// At "more than half" a vertex sitting thighL 0.5 / hips 0.5 belonged to
// neither leg, so the triangle joining it to its mirror across the crotch was
// not cut and went on tearing: 26.9x became 19.7x and stayed there. What
// matters is not who owns the vertex but whether the triangle will be pulled
// in two directions, and a fifth is enough to pull.
const sideOf = (v, a, b) => {
  let wa = 0, wb = 0;
  for (let k = 0; k < 2; k++) {
    if (BONE[v * 2 + k] === a) wa += WT[v * 2 + k];
    if (BONE[v * 2 + k] === b) wb += WT[v * 2 + k];
  }
  if (wa < 0.2 && wb < 0.2) return 0;
  return wa >= wb ? 1 : 2;
};
const kept = [];
let cutTris = 0;
for (let t = 0; t < IDX.length; t += 3) {
  let bridges = false;
  for (const [an, bn] of TWINS) {
    const a = BONE_INDEX[an], b = BONE_INDEX[bn];
    if (a === undefined || b === undefined) continue;
    let mask = 0;
    for (let k = 0; k < 3; k++) mask |= sideOf(IDX[t + k], a, b);
    if (mask === 3) { bridges = true; break; }
  }
  if (bridges) { cutTris++; continue; }
  kept.push(IDX[t], IDX[t + 1], IDX[t + 2]);
}
if (cutTris) console.log(`unsewed the legs: cut ${cutTris} triangle(s) joining a limb to its twin`);
IDX.length = 0;
for (const v of kept) IDX.push(v);

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

// Ambient occlusion, baked in. See tools/ao.mjs for why a face needs it.
function bakeAO(P, N, idx) {
  const t0 = Date.now();
  const ao = vertexAO(P, N, idx);
  let sum = 0, dark = 0;
  for (const v of ao) { sum += v; if (v < 0.5) dark++; }
  console.log(`ambient occlusion: mean ${(sum / ao.length).toFixed(2)}, ` +
    `${((dark / ao.length) * 100).toFixed(1)}% of vertices see less than half the room, ` +
    `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return ao;
}

function encode(P, N, UV, bone, wt, mat, ao, idx) {
  const n = P.length / 3;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], P[i * 3 + k]);
    mx[k] = Math.max(mx[k], P[i * 3 + k]);
  }
  let uvMax = 0;
  for (let i = 0; i < UV.length; i++) uvMax = Math.max(uvMax, Math.abs(UV[i]));

  const HEAD = 48;
  const buf = Buffer.alloc(HEAD + n * 22 + idx.length * 2 + 8);
  let o = 0;
  buf.write('BJJF', o); o += 4;
  // Version 2 added a byte of baked ambient occlusion per vertex, on the end.
  // Version 3 fills the two spare bytes after it with the bone count: this file
  // is a list of bone indices and it has to say what it indexes into. See the
  // note in asset.js about the hand that came out as a spike.
  // Version 4 carries four bones a vertex instead of two — four indices and
  // three weights, the fourth being what is left. See asset.js for what the
  // cut to two was costing at a shoulder and a waist.
  buf.writeUInt16LE(4, o); o += 2;
  buf.writeUInt16LE(BONE_COUNT, o); o += 2;
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
  for (let i = 0; i < n * 4; i++) { buf.writeUInt8(bone[i], o); o += 1; }
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    buf.writeUInt8(Math.max(0, Math.min(255, Math.round(wt[i * 4 + k] * 255))), o); o += 1;
  }
  for (let i = 0; i < n; i++) { buf.writeUInt8(mat[i], o); o += 1; }
  for (let i = 0; i < n; i++) { buf.writeUInt8(Math.round(Math.min(1, Math.max(0, ao[i])) * 255), o); o += 1; }
  for (let i = 0; i < idx.length; i++) { buf.writeUInt16LE(idx[i], o); o += 2; }
  return buf.subarray(0, o);
}

/* ------------------------------------------------------------ decimation */

// --tris N thins the mesh to about N triangles before anything is measured on
// it. Off by default: the first fighter is 29 865 triangles and needs no help.
// The second arrived at 46 314 and is drawn three times a frame.
//
// It runs here, after everything that is measured off the mesh and before the
// one thing that is measured off the surface: the eyeball UVs and the gi's
// patch rectangles are per-vertex and survive a collapse untouched, because a
// collapse moves a vertex onto one that already exists and keeps that one's
// attributes; the occlusion is a property of the surface, so it is baked on
// the triangles that will actually be lit rather than on the ones that were
// thrown away.
// What each part of the body is worth keeping, as a multiplier on the cost of
// simplifying it away. See the note on `decimate`.
//
// The head's number is the one the measurement hands over without argument:
// budget-check puts it at 47% of the first fighter's vertices and 66% of the
// second's, against 15% and 23% of the screen, and it is the smoothest surface
// on the body — the place where another thousand triangles buy the least. Down
// it goes, and the eight thousand vertices that frees are the whole of this
// change.
//
// The hands and the feet are not from the screen share, and saying so matters.
// By area alone a hand deserves about one per cent of the mesh, which is a
// mitten: five fingers and a thumb are fine structure that needs a floor of
// vertices to exist at all, whatever fraction of the picture it occupies. That
// is the one place the area rule is the wrong rule, so they are protected
// instead of allocated.
const KEEP = {
  head: 0.5, headTop: 0.5, neck: 0.5,
  hips: 1.0, spine: 1.0, chest: 1.0, clavL: 1.0, clavR: 1.0,
  armL: 1.0, foreL: 1.0, armR: 1.0, foreR: 1.0,
  thighL: 1.0, shinL: 1.0, thighR: 1.0, shinR: 1.0,
  handL: 6, fingL: 6, handLTip: 6, handR: 6, fingR: 6, handRTip: 6,
  footL: 3, toeL: 3, footR: 3, toeR: 3,
};
function keepWeights(mesh) {
  const n = mesh.pos.length / 3;
  const w = new Float32Array(n).fill(1);
  const byIndex = [];
  for (const name in KEEP) if (BONE_INDEX[name] !== undefined) byIndex[BONE_INDEX[name]] = KEEP[name];
  for (let v = 0; v < n; v++) {
    // The most protected of the bones the vertex rides, so a vertex half on a
    // hand is protected like a hand rather than averaged into the forearm.
    let best = 0;
    for (let k = 0; k < 4; k++) {
      if (k > 0 && !(mesh.wt[v * 4 + k] > 0)) continue;
      best = Math.max(best, byIndex[mesh.bone[v * 4 + k]] ?? 1);
    }
    w[v] = best;
  }
  return w;
}

// The vertex the file carries: four bones, from the table taken at retarget
// time — but only where nothing has re-weighted the vertex since. The finger
// pass, the twin re-parenting and the crotch smoothing all write two bones
// deliberately, and a table older than they are would put back exactly what
// they were written to remove. Matched by the names of the two heaviest bones
// rather than by their weights: the table is normalised over four and BONE/WT
// over two, so an untouched vertex reads 0.50 in one and 0.62 in the other and
// every vertex would look rewritten.
const NV = pos.length / 3;
const BONE4 = new Array(NV * 4), WT4 = new Array(NV * 4);
let kept4 = 0;
for (let v = 0; v < NV; v++) {
  const b0 = BONE[v * 2], b1 = WT[v * 2 + 1] > 0 ? BONE[v * 2 + 1] : b0;
  const four = ACC4.get(v);
  const same = four && ((four[0][0] === b0 && four[1][0] === b1) ||
                        (four[0][0] === b1 && four[1][0] === b0));
  if (same) {
    kept4++;
    for (let k = 0; k < 4; k++) { BONE4[v * 4 + k] = four[k][0]; WT4[v * 4 + k] = four[k][1]; }
  } else {
    BONE4[v * 4] = b0; WT4[v * 4] = WT[v * 2];
    BONE4[v * 4 + 1] = b1; WT4[v * 4 + 1] = WT[v * 2 + 1];
    BONE4[v * 4 + 2] = b0; WT4[v * 4 + 2] = 0;
    BONE4[v * 4 + 3] = b0; WT4[v * 4 + 3] = 0;
  }
}
console.log(`four bones a vertex on ${kept4} of ${NV}; the rest carry the two a later pass wrote`);

let FINAL = { pos, nrm: N, uv: UV, bone: BONE4, wt: WT4, mat: MAT, ao: null, idx: Array.from(idx) };
if (TRIS > 0 && idx.length / 3 > TRIS) {
  const t0 = Date.now();
  const before = { pos, idx: Array.from(idx) };
  const thin = decimate(FINAL, TRIS, keepWeights(FINAL));
  const dev = deviation(before, thin);
  console.log(`decimated ${idx.length / 3} -> ${thin.idx.length / 3} tris, ` +
    `${pos.length / 3} -> ${thin.count} verts in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  the surface moved ${(dev.mean * 1000).toFixed(1)}mm on average, ` +
    `${(dev.worst * 1000).toFixed(0)}mm at worst, over ${dev.seen} samples`);
  FINAL = thin;
}



const AO = bakeAO(FINAL.pos, FINAL.nrm, FINAL.idx);
const out = encode(FINAL.pos, FINAL.nrm, FINAL.uv, FINAL.bone, FINAL.wt, FINAL.mat, AO, FINAL.idx);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
if (WEIGHTS4) {
  // Only where nothing has rewritten the vertex since. The finger pass, the
  // twin re-parenting and the crotch smoothing all replace weights after this
  // table was taken, and a table that disagrees with the mesh it is compared
  // against measures its own staleness: the first run of this experiment
  // charged four-bone skinning with the hand tearing that two-bone skinning
  // had already been fixed for.
  let kept = 0, dropped = 0;
  for (let i = 0; i < W4.length; i += 9) {
    const v = W4[i];
    // The two heaviest bones, by name. Not by weight: the table is normalised
    // over four and the mesh over two, so the same vertex reads 0.50 here and
    // 0.62 there and every vertex would look rewritten.
    const b0 = BONE[v * 2], b1 = WT[v * 2 + 1] > 0 ? BONE[v * 2 + 1] : b0;
    const same = (W4[i + 1] === b0 && W4[i + 3] === b1) || (W4[i + 1] === b1 && W4[i + 3] === b0);
    if (same) { kept++; continue; }
    dropped++;
    W4[i + 1] = BONE[v * 2]; W4[i + 2] = WT[v * 2];
    W4[i + 3] = BONE[v * 2 + 1]; W4[i + 4] = WT[v * 2 + 1];
    W4[i + 5] = BONE[v * 2]; W4[i + 6] = 0;
    W4[i + 7] = BONE[v * 2]; W4[i + 8] = 0;
  }
  writeFileSync(OUT + '.w4.json', JSON.stringify(W4));
  console.log(`wrote ${W4.length / 9} vertices of four-bone weights ` +
    `(${kept} as taken, ${dropped} replaced by what a later pass wrote)`);
}
console.log(`\nwrote ${OUT}  ${(out.length / 1024).toFixed(0)} KB  ` +
  `${FINAL.pos.length / 3} verts  ${FINAL.idx.length / 3} tris`);
