// Turn a generated sculpt into a rigged fighter this engine can pose.
//
//   node bjj/tools/bake-fighter.mjs bjj/art/judo-study-montage.glb --component 1
//
// The input is what an AI mesh generator gives you: one triangle soup, positions
// only. No skeleton, no weights, no normals, no UVs, no materials, and several
// people welded into the same buffer. Everything below is the work of turning
// that into something a skinning shader can drive.
//
// The one decision worth explaining is which way the fitting runs. The obvious
// move is to fit a skeleton to the mesh. That is wrong here: fifteen paired
// poses are authored against *this* skeleton's proportions, and a skeleton with
// different limb lengths silently invalidates every one of them. So the fit
// runs the other way — measure the sculpt's own joints, then warp the sculpt so
// its joints land on the canonical skeleton's. The rig stays canonical, the
// pose library stays valid, and the character is the only thing that changed.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { Skeleton, BONE_COUNT, BONES } from '../src/render/skeleton.js';
import { vertexAO } from './ao.mjs';

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2);
const src = argv[0];
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
if (!src) {
  console.error(
    'usage: bake-fighter.mjs <file.glb> [--component N] [--out path] [--report]\n' +
    '                        [--static] [--tris N] [--height M]'
  );
  process.exit(2);
}
const COMPONENT = +flag('component', 1);
const OUT = flag('out', 'bjj/assets/fighter.bin');
const REPORT = argv.includes('--report');
// A static prop skips the whole rig: no joint fit, no warp, no weights. Used
// for the title-screen fighter, which never moves.
const STATIC = argv.includes('--static');
const TRIS = +flag('tris', 0);          // decimate to roughly this many
const HEIGHT = +flag('height', 0);      // override the target height, metres

/* -------------------------------------------------------------- glb parse */

function readGLB(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb');
  let off = 12, json = null, bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
    off += (4 - (off % 4)) % 4;
  }
  return { json, bin };
}

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessor(json, bin, i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const Type = CT[a.componentType];
  const n = a.count * NC[a.type];
  // The bin chunk is a view into a Buffer and is not guaranteed to be aligned
  // for the wider types, so copy rather than alias.
  const bytes = bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + start + n * Type.BYTES_PER_ELEMENT);
  return new Type(bytes);
}

/* ------------------------------------------------- weld + split into people */

// Meshy emits a seam-duplicated soup: naive connectivity sees one person as
// hundreds of shards. Weld on a 0.5 mm grid first.
function weld(pos, idx) {
  const map = new Map();
  const remap = new Int32Array(pos.length / 3);
  const out = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${Math.round(pos[i * 3] * 2000)},${Math.round(pos[i * 3 + 1] * 2000)},${Math.round(pos[i * 3 + 2] * 2000)}`;
    let v = map.get(k);
    if (v === undefined) {
      v = out.length / 3;
      map.set(k, v);
      out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    remap[i] = v;
  }
  const tri = new Int32Array(idx.length);
  for (let i = 0; i < idx.length; i++) tri[i] = remap[idx[i]];
  return { pos: new Float64Array(out), idx: tri };
}

function components(pos, idx) {
  const n = pos.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let t = 0; t < idx.length; t += 3) {
    for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(i);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

function extract(pos, idx, verts) {
  const keep = new Int32Array(pos.length / 3).fill(-1);
  verts.forEach((v, i) => (keep[v] = i));
  const P = new Float64Array(verts.length * 3);
  verts.forEach((v, i) => {
    P[i * 3] = pos[v * 3];
    P[i * 3 + 1] = pos[v * 3 + 1];
    P[i * 3 + 2] = pos[v * 3 + 2];
  });
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    if (keep[idx[t]] < 0) continue;
    tris.push(keep[idx[t]], keep[idx[t + 1]], keep[idx[t + 2]]);
  }
  return { pos: P, idx: new Int32Array(tris) };
}

/* ------------------------------------------------------------- measurement */

// The first version of this tried to find limbs by slicing the body and looking
// for the slice to break into separate blobs. That works on a naked mesh and
// fails completely on a gi: judo trousers are wide enough that the legs touch
// all the way to the ankle, and a sleeve hangs against the ribs, so the whole
// body reads as one blob from the collar to the floor.
//
// What survives contact with a kimono is the silhouette. Two facts do all the
// work here: with the arms hanging, the outermost points at any height between
// the shoulder and the wrist belong to an arm; and the feet are always apart.
// Everything else comes from the rig's own proportions, which is legitimate
// because both bodies are ordinary adult humans normalised to the same height —
// the mismatch that actually matters is width, not length.

function slab(P, y0, y1) {
  const out = [];
  for (let i = 0; i < P.length; i += 3) {
    const y = P[i + 1];
    if (y >= y0 && y < y1) out.push(i);
  }
  return out;
}

// Centroid of the outermost band on one side — the arm, or the foot.
function outerCentroid(P, ids, side, band) {
  let ext = -1e9;
  for (const i of ids) {
    const x = P[i] * side;
    if (x > ext) ext = x;
  }
  let sx = 0, sz = 0, n = 0;
  for (const i of ids) {
    if (P[i] * side < ext - band) continue;
    sx += P[i];
    sz += P[i + 2];
    n++;
  }
  return n ? { x: sx / n, z: sz / n, ext: ext * side, n } : null;
}

function widthAt(P, y0, y1) {
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < P.length; i += 3) {
    const y = P[i + 1];
    if (y < y0 || y >= y1) continue;
    if (P[i] < lo) lo = P[i];
    if (P[i] > hi) hi = P[i];
  }
  return hi - lo;
}

// The ankle-to-toe direction of one foot: take the geometry below the ankle on
// that side and look at where its front third sits relative to its middle.
function footDirection(P, ankleY, side) {
  const pts = [];
  for (let i = 0; i < P.length; i += 3) {
    if (P[i + 1] > ankleY + 0.05) continue;
    if (Math.sign(P[i]) !== side) continue;
    pts.push([P[i], P[i + 1], P[i + 2]]);
  }
  if (pts.length < 20) return null;
  pts.sort((a, b) => a[2] - b[2]);
  const front = pts.slice(Math.floor(pts.length * 0.85));
  const mid = pts.slice(Math.floor(pts.length * 0.3), Math.floor(pts.length * 0.6));
  const avg = (list) => list.reduce(
    (acc, p) => [acc[0] + p[0] / list.length, acc[1] + p[1] / list.length, acc[2] + p[2] / list.length],
    [0, 0, 0]
  );
  const a = avg(mid), b = avg(front);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

function measure(P, H, target) {
  const step = H / 110;
  // Width profile: the two peaks in it are the shoulders and the hips, and
  // those are the only two vertical landmarks a clothed body reliably gives.
  const prof = [];
  for (let y = 0; y < H; y += step) prof.push({ y: y + step / 2, w: widthAt(P, y, y + step) });
  const peak = (lo, hi) => {
    let best = null;
    for (const r of prof) {
      if (r.y < lo * H || r.y > hi * H) continue;
      if (!best || r.w > best.w) best = r;
    }
    return best;
  };
  const shoulder = peak(0.66, 0.94);
  const hip = peak(0.42, 0.64);

  const band = H * 0.055;
  const at = (y, side, w = H * 0.06) => outerCentroid(P, slab(P, y - band / 2, y + band / 2), side, w);

  const wristY = target.handL[1];
  const shoulderY = target.armL[1];
  const elbowY = target.foreL[1];
  const ankleY = target.footL[1];
  const kneeY = target.shinL[1];

  return {
    H, prof,
    shoulderPeak: shoulder ? shoulder.y : shoulderY,
    hipPeak: hip ? hip.y : target.hips[1],
    handL: at(wristY, 1), handR: at(wristY, -1),
    elbL: at(elbowY, 1), elbR: at(elbowY, -1),
    shL: at(shoulderY, 1, H * 0.09), shR: at(shoulderY, -1, H * 0.09),
    footL: at(ankleY, 1, H * 0.09), footR: at(ankleY, -1, H * 0.09),
    // Which way each foot points, from the mesh. Without this the toe joint
    // has to be invented, and an invented toe is how the feet became flippers:
    // the fabricated bone came out 9.9 cm against the rig's 16, so the warp
    // scaled everything weighted to the foot by 1.6.
    toeDirL: footDirection(P, ankleY, 1),
    toeDirR: footDirection(P, ankleY, -1),
    kneeL: at(kneeY, 1, H * 0.08), kneeR: at(kneeY, -1, H * 0.08),
    shoulderY, elbowY, wristY, ankleY, kneeY,
  };
}

/* ------------------------------------------------------- the source rig fit */

// Where each canonical bone's head sits on the *sculpt*. Heights come from the
// rig; the lateral placement is measured. An arm bone that runs down the middle
// of the torso instead of down the middle of the sleeve is the one error that
// really shows — the sleeve then swings around a pivot inside the ribcage.
function fitSource(m, target) {
  const H = m.H;
  const J = {};
  for (const [name, off] of Object.entries(target)) J[name] = [off[0], off[1], off[2]];

  // An X-histogram of the sculpt at each height says which of these joints
  // actually need moving, and the answer is fewer than you would guess. The
  // shoulder and the elbow already sit within a centimetre of the rig's, because
  // both bodies are ordinary adults at the same height — anatomy does the work.
  // What differs is the stance: the sculpt stands with its feet twice as far
  // apart as the rig and its hands further off the hips. Those two, and only
  // those two, get measured.
  //
  // Leaving the shoulder alone matters more than it sounds. An earlier version
  // measured it as well, got a centroid pulled inboard by the chest it could not
  // separate from the sleeve, and warped the joint outward into the deltoid. The
  // arm then pivoted around a point buried in the trapezius, and every pose grew
  // enormous inflated shoulder pads.
  const place = (name, meas, side, inset) => {
    if (!meas) return null;
    const x = meas.x - side * inset;
    J[name] = [x, J[name][1], meas.z];
    return x;
  };

  const handLX = place('handL', m.handL, 1, H * 0.012);
  const handRX = place('handR', m.handR, -1, H * 0.012);

  // Keep the arm a straight chain between an untouched shoulder and a measured
  // hand, so no elbow ends up outside the sleeve it lives in.
  const chain = (sh, el, hand, handX) => {
    if (handX === null) return;
    const t = (J[sh][1] - J[el][1]) / Math.max(J[sh][1] - J[hand][1], 1e-6);
    J[el] = [J[sh][0] + (handX - J[sh][0]) * t, J[el][1], J[sh][2] + (J[hand][2] - J[sh][2]) * t];
  };
  chain('armL', 'foreL', 'handL', handLX);
  chain('armR', 'foreR', 'handR', handRX);

  place('footL', m.footL, 1, H * 0.012);
  place('footR', m.footR, -1, H * 0.012);
  place('shinL', m.kneeL, 1, H * 0.022);
  place('shinR', m.kneeR, -1, H * 0.022);
  // The hip joint stays under the pelvis; only the knee and the foot move out,
  // which is what a wide stance actually is.
  J.thighL = [J.thighL[0] + (J.shinL[0] - target.shinL[0]) * 0.35, J.thighL[1], J.thighL[2]];
  J.thighR = [J.thighR[0] + (J.shinR[0] - target.shinR[0]) * 0.35, J.thighR[1], J.thighR[2]];

  J.clavL = [J.clavL[0], J.clavL[1], J.armL[2]];
  J.clavR = [J.clavR[0], J.clavR[1], J.armR[2]];
  J.handLTip = [J.handL[0], target.handLTip[1], J.handL[2]];
  J.handRTip = [J.handR[0], target.handRTip[1], J.handR[2]];
  // The toe goes along the measured foot, at exactly the length this rig's own
  // foot bone has. Matching the length is the point: it makes the warp's scale
  // factor for the foot 1.0, so the foot is carried to the rig's ankle without
  // being resized. A foot is not a proportion worth transferring anyway — it is
  // a foot.
  const footLen = Math.hypot(
    target.toeL[0] - target.footL[0], target.toeL[1] - target.footL[1], target.toeL[2] - target.footL[2]
  );
  const toe = (foot, dir, fallbackZ) => {
    const d = dir || [0, -0.34, 0.94];
    return [foot[0] + d[0] * footLen, foot[1] + d[1] * footLen, foot[2] + d[2] * footLen + fallbackZ * 0];
  };
  J.toeL = toe(J.footL, m.toeDirL, 0);
  J.toeR = toe(J.footR, m.toeDirR, 0);
  return J;
}

/* ---------------------------------------------------------------- skinning */

// Segment list in the order the weights want them: a bone owns the segment
// running from its own head to its first child's head.
function segments(joints) {
  const segs = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const name = BONES[i][0];
    let childName = null;
    for (let j = i + 1; j < BONE_COUNT; j++) {
      if (BONES[j][1] === i) {
        childName = BONES[j][0];
        break;
      }
    }
    if (!childName) continue;
    segs.push({ i, name, a: joints[name], b: joints[childName] });
  }
  return segs;
}

function distToSeg(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = (apx * abx + apy * aby + apz * abz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return { d: Math.hypot(dx, dy, dz), t };
}

// Which side of the body a bone belongs to, so an inner-thigh vertex is not
// captured by the far leg — the classic failure of nearest-bone weighting.
function sideOf(name) {
  if (name.endsWith('L')) return 1;
  if (name.endsWith('R')) return -1;
  return 0;
}


// Adjacency, as CSR. Weights are diffused over the mesh's own edges below, and
// that is the whole point of building this.
function adjacency(vertCount, idx) {
  const deg = new Int32Array(vertCount);
  const bump = (a, b) => {
    deg[a]++;
    deg[b]++;
  };
  for (let t = 0; t < idx.length; t += 3) {
    bump(idx[t], idx[t + 1]);
    bump(idx[t + 1], idx[t + 2]);
    bump(idx[t + 2], idx[t]);
  }
  const start = new Int32Array(vertCount + 1);
  for (let i = 0; i < vertCount; i++) start[i + 1] = start[i] + deg[i];
  const fill = start.slice(0, vertCount);
  const nbr = new Int32Array(start[vertCount]);
  const put = (a, b) => {
    nbr[fill[a]++] = b;
    nbr[fill[b]++] = a;
  };
  for (let t = 0; t < idx.length; t += 3) {
    put(idx[t], idx[t + 1]);
    put(idx[t + 1], idx[t + 2]);
    put(idx[t + 2], idx[t]);
  }
  return { start, nbr };
}

// Skinning weights, by seeding and then diffusing along the surface.
//
// The first version of this weighted every vertex by straight-line distance to
// the nearest two bone segments, and straight-line distance is the wrong metric
// on a body. A hand hangs four centimetres from a hip, so the skirt of the
// jacket bound to the fingers and left with them. That got patched with a table
// of per-bone "reach" multipliers — thin bones grab less, fat bones grab more —
// which is what a rigger paints by hand and is exactly as principled as it
// sounds.
//
// Diffusing over the mesh's own edges removes the need for the patch. Only
// vertices that are unambiguously nearest one bone are seeded; everything else
// is solved by letting those seeds spread across the surface. The hand cannot
// capture the jacket because there is no short path along the cloth from one to
// the other, however close they are in space. It is the cheap relative of bone
// heat, and it fixes the same failures.
function skinWeights(P, idx, segs) {
  const n = P.length / 3;
  const tAlong = new Float32Array(n);
  const nearest = new Int32Array(n);
  // How far the vertex actually is from the bone that ends up owning it. The
  // material rules need this: a hand hangs beside a hip, so "nearest bone is
  // the hand" is true of the cuff of the jacket as well as of the hand, and
  // only the distance tells them apart.
  const ownerDist = new Float32Array(n);
  const confident = new Uint8Array(n);
  const p = [0, 0, 0];

  for (let v = 0; v < n; v++) {
    p[0] = P[v * 3];
    p[1] = P[v * 3 + 1];
    p[2] = P[v * 3 + 2];
    let b0 = 0, d0 = 1e9, t0 = 0, d1 = 1e9;
    for (const s of segs) {
      const { d, t } = distToSeg(p, s.a, s.b);
      const side = sideOf(s.name);
      // A limb still only competes for vertices on its own side. This one is
      // not a fudge: a left arm has no business owning anything at negative x,
      // and no amount of diffusion recovers from seeding it there.
      const dd = d * (side !== 0 && Math.sign(p[0]) !== side ? 1 + Math.abs(p[0]) * 6 : 1);
      if (dd < d0) {
        d1 = d0;
        d0 = dd;
        b0 = s.i;
        t0 = t;
      } else if (dd < d1) {
        d1 = dd;
      }
    }
    nearest[v] = b0;
    tAlong[v] = t0;
    // Seed only where the answer is not in doubt. Everything nearer to two
    // bones at once — which is every joint — is left for the diffusion.
    confident[v] = d0 < d1 * 0.62 ? 1 : 0;
  }

  // Guarantee every bone has something to spread from, even a bone that never
  // won a confident vertex outright.
  const seedCount = new Map();
  for (let v = 0; v < n; v++) if (confident[v]) seedCount.set(nearest[v], (seedCount.get(nearest[v]) || 0) + 1);
  for (const s of segs) {
    if (seedCount.get(s.i)) continue;
    let best = -1, bd = 1e9;
    for (let v = 0; v < n; v++) {
      p[0] = P[v * 3];
      p[1] = P[v * 3 + 1];
      p[2] = P[v * 3 + 2];
      const { d } = distToSeg(p, s.a, s.b);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (best >= 0) {
      nearest[best] = s.i;
      confident[best] = 1;
    }
  }

  const { start, nbr } = adjacency(n, idx);
  let W = new Float32Array(n * BONE_COUNT);
  let W2 = new Float32Array(n * BONE_COUNT);
  for (let v = 0; v < n; v++) if (confident[v]) W[v * BONE_COUNT + nearest[v]] = 1;

  const ITER = 48;
  for (let it = 0; it < ITER; it++) {
    for (let v = 0; v < n; v++) {
      if (confident[v]) {
        W2.set(W.subarray(v * BONE_COUNT, v * BONE_COUNT + BONE_COUNT), v * BONE_COUNT);
        continue;
      }
      const a = start[v], b = start[v + 1];
      const deg = b - a;
      if (!deg) continue;
      const out = v * BONE_COUNT;
      // Averaging the neighbours, with a share of the vertex's own previous
      // value so the field relaxes rather than oscillating.
      for (let k = 0; k < BONE_COUNT; k++) W2[out + k] = W[out + k] * 0.35;
      const share = 0.65 / deg;
      for (let e = a; e < b; e++) {
        const u = nbr[e] * BONE_COUNT;
        for (let k = 0; k < BONE_COUNT; k++) W2[out + k] += W[u + k] * share;
      }
    }
    const tmp = W;
    W = W2;
    W2 = tmp;
  }

  // Two bones per vertex is what the vertex format carries, and on a body it is
  // what matters: the third is always a rounding error next to the first two.
  // Diffusion alone is not enough, and the reason is specific to sculpts like
  // this one: the hands hang against the jacket and the generator welded them
  // to it, so there *is* a short path along the surface from a fingertip to a
  // hip. The field runs down it and paints a patch of bare skin on the cloth.
  //
  // So the surface field decides the shape of the boundaries, and plain
  // distance keeps it honest: a vertex may not be claimed by a bone that is
  // more than twice as far away as the nearest one.
  const segByBone = new Map(segs.map((s2) => [s2.i, s2]));
  const nearestDist = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    p[0] = P[v * 3];
    p[1] = P[v * 3 + 1];
    p[2] = P[v * 3 + 2];
    const s2 = segByBone.get(nearest[v]);
    nearestDist[v] = s2 ? distToSeg(p, s2.a, s2.b).d : 0;
  }

  const bone = new Uint8Array(n * 2);
  const wt = new Float32Array(n * 2);
  let orphans = 0, clamped = 0;
  for (let v = 0; v < n; v++) {
    const o = v * BONE_COUNT;
    let b0 = -1, w0 = -1, b1 = -1, w1 = -1;
    for (let k = 0; k < BONE_COUNT; k++) {
      const w = W[o + k];
      if (w > w0) {
        w1 = w0; b1 = b0;
        w0 = w; b0 = k;
      } else if (w > w1) {
        w1 = w; b1 = k;
      }
    }
    if (w0 <= 1e-6) {
      // An island the diffusion never reached. Fall back to the nearest bone,
      // which is what the whole mesh used to do.
      b0 = nearest[v];
      w0 = 1;
      b1 = nearest[v];
      w1 = 0;
      orphans++;
    }
    if (b1 < 0) {
      b1 = b0;
      w1 = 0;
    }
    for (const [b, isFirst] of [[b0, true], [b1, false]]) {
      const s2 = segByBone.get(b);
      if (!s2) continue;
      p[0] = P[v * 3];
      p[1] = P[v * 3 + 1];
      p[2] = P[v * 3 + 2];
      if (distToSeg(p, s2.a, s2.b).d > nearestDist[v] * 2.0 + 0.02) {
        if (isFirst) {
          b0 = nearest[v];
          w0 = 1;
          b1 = nearest[v];
          w1 = 0;
          clamped++;
        } else {
          b1 = b0;
          w1 = 0;
        }
      }
    }
    const sum = w0 + w1;
    bone[v * 2] = b0;
    bone[v * 2 + 1] = b1;
    wt[v * 2] = w0 / sum;
    wt[v * 2 + 1] = w1 / sum;
  }

  let seeded = 0;
  for (let v = 0; v < n; v++) seeded += confident[v];
  console.log(
    `weights: ${seeded} of ${n} vertices seeded (${((seeded / n) * 100).toFixed(0)}%), ` +
    `${ITER} diffusion passes, ${clamped} clamped back to the nearest bone, ` +
    `${orphans} orphan${orphans === 1 ? '' : 's'}`
  );
  for (let v = 0; v < n; v++) {
    const s2 = segByBone.get(bone[v * 2]);
    if (!s2) continue;
    p[0] = P[v * 3];
    p[1] = P[v * 3 + 1];
    p[2] = P[v * 3 + 2];
    ownerDist[v] = distToSeg(p, s2.a, s2.b).d;
  }
  return { bone, wt, tAlong, ownerDist };
}

/* ------------------------------------------------------------------- warp */

// Move the sculpt onto the canonical skeleton. Each bone contributes a
// translate-scale-translate that carries its own segment from where the sculpt
// has it to where the rig wants it; the vertex takes the weighted blend, which
// is smooth across joints for the same reason skinning is.
function warpToRig(P, segs, source, target, bone, wt) {
  const n = P.length / 3;
  const T = segs.map((s) => {
    const childName = BONES.find((b, j) => BONES[j][1] === s.i && j > s.i)?.[0];
    const sa = source[s.name], sb = source[childName];
    const ta = target[s.name], tb = target[childName];
    const sl = Math.hypot(sb[0] - sa[0], sb[1] - sa[1], sb[2] - sa[2]) || 1e-6;
    const tl = Math.hypot(tb[0] - ta[0], tb[1] - ta[1], tb[2] - ta[2]) || 1e-6;
    // Clamped, and deliberately narrow. The fit is only ever correcting a
    // stance — a wider set of feet, hands further off the hips — and no part of
    // one adult human is 30% longer than the same part of another. A scale
    // outside this range is a measurement that went wrong, and left unchecked
    // it does not fail loudly: it quietly inflates whatever the bone owns.
    const raw = tl / sl;
    const clamped = Math.max(0.86, Math.min(1.16, raw));
    if (Math.abs(raw - clamped) > 1e-6) {
      console.log(`  warp: ${s.name} wanted x${raw.toFixed(2)}, clamped to x${clamped.toFixed(2)}`);
    }
    return { i: s.i, sa, ta, s: clamped };
  });
  const byBone = new Map(T.map((t) => [t.i, t]));
  const out = new Float64Array(P.length);
  for (let v = 0; v < n; v++) {
    let x = 0, y = 0, z = 0, wsum = 0;
    for (let k = 0; k < 2; k++) {
      const w = wt[v * 2 + k];
      if (w <= 0) continue;
      const t = byBone.get(bone[v * 2 + k]);
      if (!t) continue;
      x += w * (t.ta[0] + (P[v * 3] - t.sa[0]) * t.s);
      y += w * (t.ta[1] + (P[v * 3 + 1] - t.sa[1]) * t.s);
      z += w * (t.ta[2] + (P[v * 3 + 2] - t.sa[2]) * t.s);
      wsum += w;
    }
    if (wsum < 1e-6) {
      out[v * 3] = P[v * 3];
      out[v * 3 + 1] = P[v * 3 + 1];
      out[v * 3 + 2] = P[v * 3 + 2];
    } else {
      out[v * 3] = x / wsum;
      out[v * 3 + 1] = y / wsum;
      out[v * 3 + 2] = z / wsum;
    }
  }
  return out;
}

/* ------------------------------------------------------------- decimation */

// Vertex clustering: snap every vertex to a grid, replace each occupied cell
// with the average of what fell into it, and drop the triangles that collapse.
//
// A quadric-error decimator would keep sharper creases, but this asset is a
// menu prop seen at a fixed size, and the difference between 97 000 triangles
// and 14 000 at that size is entirely a download-size difference. The grid is
// sized by bisection because the relationship between cell size and surviving
// vertex count depends on how the surface folds, and guessing it is slower than
// measuring it.
function decimate(P, idx, targetVerts) {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], P[i + k]);
      hi[k] = Math.max(hi[k], P[i + k]);
    }
  }
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const cellsFor = (cell) => {
    const seen = new Set();
    for (let i = 0; i < P.length; i += 3) {
      seen.add(
        `${Math.floor((P[i] - lo[0]) / cell)},` +
        `${Math.floor((P[i + 1] - lo[1]) / cell)},` +
        `${Math.floor((P[i + 2] - lo[2]) / cell)}`
      );
    }
    return seen.size;
  };
  let a = span / 400, b = span / 8;
  for (let it = 0; it < 24; it++) {
    const mid = (a + b) / 2;
    if (cellsFor(mid) > targetVerts) a = mid;
    else b = mid;
  }
  const cell = (a + b) / 2;

  const map = new Map();
  const sums = [];
  const remap = new Int32Array(P.length / 3);
  for (let i = 0; i < P.length / 3; i++) {
    const k =
      `${Math.floor((P[i * 3] - lo[0]) / cell)},` +
      `${Math.floor((P[i * 3 + 1] - lo[1]) / cell)},` +
      `${Math.floor((P[i * 3 + 2] - lo[2]) / cell)}`;
    let v = map.get(k);
    if (v === undefined) {
      v = sums.length;
      map.set(k, v);
      sums.push([0, 0, 0, 0]);
    }
    const s = sums[v];
    s[0] += P[i * 3];
    s[1] += P[i * 3 + 1];
    s[2] += P[i * 3 + 2];
    s[3]++;
    remap[i] = v;
  }
  const out = new Float64Array(sums.length * 3);
  sums.forEach((s, i) => {
    out[i * 3] = s[0] / s[3];
    out[i * 3 + 1] = s[1] / s[3];
    out[i * 3 + 2] = s[2] / s[3];
  });
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a2 = remap[idx[t]], b2 = remap[idx[t + 1]], c2 = remap[idx[t + 2]];
    if (a2 === b2 || b2 === c2 || c2 === a2) continue;
    tris.push(a2, b2, c2);
  }
  return { pos: out, idx: new Int32Array(tris), cell };
}

/* ------------------------------------------------------- a static hero prop */

// No rig, no warp, no weights worth the name: one mesh bound rigidly to the
// root bone so it renders exactly as sculpted. Used for the fighter on the
// title screen, whose whole job is to stand there and look like a black belt.
//
// Materials cannot be cut by height here — the sculpt is in a striking stance
// with its fists up beside its face, so "below the sleeve" and "above the
// collar" are the same height. They are cut by landmark instead: the head is
// the mass at the top, the fists are the two clusters furthest forward at chest
// height, and both are found from the geometry rather than typed in.
function staticMaterials(P) {
  const n = P.length / 3;
  const M = new Uint8Array(n);
  let maxY = -1e9, minY = 1e9;
  for (let i = 0; i < n; i++) {
    maxY = Math.max(maxY, P[i * 3 + 1]);
    minY = Math.min(minY, P[i * 3 + 1]);
  }
  const H = maxY - minY;

  const centroid = (pick) => {
    let sx = 0, sy = 0, sz = 0, c = 0;
    for (let i = 0; i < n; i++) {
      if (!pick(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])) continue;
      sx += P[i * 3];
      sy += P[i * 3 + 1];
      sz += P[i * 3 + 2];
      c++;
    }
    return c ? [sx / c, sy / c, sz / c, c] : null;
  };

  const head = centroid((x, y) => y > maxY - H * 0.135);
  // Fists: at chest height, the two things furthest forward, split by side.
  let zCut = -1e9;
  const zs = [];
  for (let i = 0; i < n; i++) {
    const y = P[i * 3 + 1];
    if (y > minY + H * 0.62 && y < minY + H * 0.86) zs.push(P[i * 3 + 2]);
  }
  zs.sort((a, b) => a - b);
  zCut = zs.length ? zs[Math.floor(zs.length * 0.82)] : 1e9;
  const fistL = centroid((x, y, z) => x > 0 && z > zCut && y > minY + H * 0.62 && y < minY + H * 0.86);
  const fistR = centroid((x, y, z) => x <= 0 && z > zCut && y > minY + H * 0.62 && y < minY + H * 0.86);

  const near = (p, c, r) =>
    c && (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 < r * r;

  const beltLo = minY + H * 0.565, beltHi = minY + H * 0.625;
  const p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    p[0] = P[i * 3];
    p[1] = P[i * 3 + 1];
    p[2] = P[i * 3 + 2];
    let m = 1;
    if (p[1] < minY + H * 0.062) m = 0;                       // bare feet
    else if (p[1] < minY + H * 0.55) m = 2;                   // trousers
    if (near(p, head, H * 0.082)) {
      // Same hairline as the rigged bake: high at the brow, down to the nape,
      // and the face gets its own material so the shader can draw eyes on it.
      const above = p[1] - head[1];
      const front = Math.max(-1, Math.min(1, (p[2] - head[2]) / (H * 0.052)));
      const line = H * (0.020 + front * 0.030);
      if (above > line) m = 5;
      else m = front > 0.15 && above > -H * 0.02 ? 6 : 0;
    } else if (near(p, fistL, H * 0.048) || near(p, fistR, H * 0.048)) m = 0;
    else if (p[1] > beltLo && p[1] < beltHi && Math.hypot(p[0], p[2]) < H * 0.19) m = 3;
    M[i] = m;
  }
  console.log(
    `  landmarks: head ${head ? head.slice(0, 3).map((v) => v.toFixed(2)).join(',') : 'n/a'}` +
    `  fists ${[fistL, fistR].map((f) => (f ? f.slice(0, 3).map((v) => v.toFixed(2)).join(',') : 'n/a')).join(' | ')}`
  );
  return M;
}

// A planar projection, deliberately not a cylindrical one.
//
// Wrapping the UV around the body with atan2 looks like the obvious choice and
// is a trap: the angle is undefined on the body's own axis, and it does not
// only misbehave in a thin seam. Anywhere x and z are both near zero — between
// the arms and the ribs, between the thighs — the coordinate swings through
// half a turn across a few centimetres of surface. The shader recovers its
// tangent frame from screen-space derivatives of the UV, so a swing like that
// hands it a frame built from near-infinities, and whole patches of the body
// shade to black.
//
// Projecting on a diagonal has no singularity anywhere. The textures it feeds
// are noise, so the stretching on surfaces edge-on to the projection is not
// something an eye can find.
function staticUVs(P) {
  const n = P.length / 3;
  const UV = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    UV[i * 2] = (P[i * 3] * 0.76 + P[i * 3 + 2] * 0.65) * 8;
    UV[i * 2 + 1] = P[i * 3 + 1] * 8;
  }
  return UV;
}

/* -------------------------------------------------- normals, uvs, materials */

// Make the winding consistent before anything reads a normal off it.
//
// A generated sculpt is not guaranteed to have coherently wound triangles, and
// on this one about a fifth of them faced inwards. The symptom is not a hole —
// nothing here culls backfaces — it is worse: patches of the gi lit from the
// wrong side, which read as bleached blotches scattered over the cloth and look
// like a texture bug rather than a geometry one.
//
// Walk the dual graph. Two triangles sharing an edge agree only if they
// traverse that edge in opposite directions; where they do not, flip the
// neighbour. Then check the whole shell's signed volume and flip everything if
// the surface came out inside-out.
function orient(P, idx) {
  const triCount = idx.length / 3;
  const edges = new Map();
  const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t * 3 + e], b = idx[t * 3 + ((e + 1) % 3)];
      const k = key(a, b);
      let list = edges.get(k);
      if (!list) edges.set(k, (list = []));
      list.push(t);
    }
  }
  // Is the winding already consistent? Count the shared edges whose two
  // triangles walk them the same way round.
  let shared = 0, disagree = 0;
  for (const list of edges.values()) {
    if (list.length !== 2) continue;
    shared++;
    const [t0, t1] = list;
    for (let e = 0; e < 3; e++) {
      const a = idx[t0 * 3 + e], b = idx[t0 * 3 + ((e + 1) % 3)];
      for (let f = 0; f < 3; f++) {
        if (idx[t1 * 3 + f] === a && idx[t1 * 3 + ((f + 1) % 3)] === b) disagree++;
      }
    }
  }
  const rate = shared ? disagree / shared : 0;

  const seen = new Uint8Array(triCount);
  let flipped = 0;
  const flip = (t) => {
    const tmp = idx[t * 3 + 1];
    idx[t * 3 + 1] = idx[t * 3 + 2];
    idx[t * 3 + 2] = tmp;
    flipped++;
  };
  // Only walk the dual graph when there is something to fix. Decimation leaves
  // edges shared by more than two triangles, and on a mesh like that the flood
  // fill happily propagates the wrong answer across a whole limb — which shows
  // up as shredded, patchwork normals rather than as anything obviously broken.
  // If the source was already coherent, leave it alone and just check the
  // shell is not inside-out.
  const walk = rate > 0.02;
  for (let start = 0; walk && start < triCount; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    const stack = [start];
    while (stack.length) {
      const t = stack.pop();
      for (let e = 0; e < 3; e++) {
        const a = idx[t * 3 + e], b = idx[t * 3 + ((e + 1) % 3)];
        for (const n of edges.get(key(a, b))) {
          if (n === t || seen[n]) continue;
          // Does the neighbour walk this same edge the same way round?
          let same = false;
          for (let f = 0; f < 3; f++) {
            if (idx[n * 3 + f] === a && idx[n * 3 + ((f + 1) % 3)] === b) same = true;
          }
          if (same) flip(n);
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
  }
  // Signed volume of the closed shell: negative means the whole thing is
  // inside-out and every triangle needs turning.
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    vol += (
      P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
      P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
      P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])
    ) / 6;
  }
  if (vol < 0) {
    for (let t = 0; t < triCount; t++) flip(t);
  }
  return { flipped, volume: vol, rate, walked: walk };
}

function normals(P, idx) {
  const N = new Float64Array(P.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    // Not normalised: the cross product's length is twice the triangle area,
    // which is the weighting a smooth normal wants anyway.
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) {
      N[o] += nx;
      N[o + 1] += ny;
      N[o + 2] += nz;
    }
  }
  // A vertex whose adjacent faces cancel exactly ends up with a zero normal.
  // Clustering makes this happen for real: where cloth is thin, a cell swallows
  // vertices from both sides of it, and the two opposing faces sum to nothing.
  //
  // A zero normal is not a cosmetic problem. The shader normalises it, gets
  // NaN, writes NaN into the HDR target, and the bloom blur then smears that
  // NaN across a wide block of the screen — so forty-three bad vertices paint
  // half a fighter black. Fall back to the biggest face touching the vertex.
  const bad = [];
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]);
    if (l < 1e-9) {
      bad.push(i / 3);
      continue;
    }
    N[i] /= l;
    N[i + 1] /= l;
    N[i + 2] /= l;
  }
  if (bad.length) {
    const want = new Set(bad);
    const best = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      let hit = -1;
      for (let k = 0; k < 3; k++) if (want.has(idx[t + k])) hit = idx[t + k];
      if (hit < 0) continue;
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const area = Math.hypot(nx, ny, nz);
      for (let k = 0; k < 3; k++) {
        const v = idx[t + k];
        if (!want.has(v)) continue;
        const cur = best.get(v);
        if (!cur || area > cur[3]) best.set(v, [nx, ny, nz, area]);
      }
    }
    for (const v of bad) {
      const f = best.get(v);
      if (f && f[3] > 1e-12) {
        N[v * 3] = f[0] / f[3];
        N[v * 3 + 1] = f[1] / f[3];
        N[v * 3 + 2] = f[2] / f[3];
      } else {
        N[v * 3] = 0;
        N[v * 3 + 1] = 1;
        N[v * 3 + 2] = 0;
      }
    }
    console.log(`normals: repaired ${bad.length} vertices whose faces cancelled out`);
  }
  return N;
}

// Cylindrical around the owning bone — the same convention the procedural body
// uses, so the cloth and skin textures already in the game apply unchanged.
function uvs(P, segs, bone, tAlong, target) {
  const n = P.length / 3;
  const UV = new Float32Array(n * 2);
  const byBone = new Map(segs.map((s) => [s.i, s]));
  for (let v = 0; v < n; v++) {
    const s = byBone.get(bone[v * 2]);
    if (!s) continue;
    const ax = s.b[0] - s.a[0], ay = s.b[1] - s.a[1], az = s.b[2] - s.a[2];
    const len = Math.hypot(ax, ay, az) || 1e-6;
    const dx = ax / len, dy = ay / len, dz = az / len;
    // Any two vectors perpendicular to the bone will do; the seam they create
    // is hidden by the fact that both textures are noise, not a picture.
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; }
    let sx = uy * dz - uz * dy, sy = uz * dx - ux * dz, sz = ux * dy - uy * dx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const tx = dy * sz - dz * sy, ty = dz * sx - dx * sz, tz = dx * sy - dy * sx;
    const px = P[v * 3] - s.a[0], py = P[v * 3 + 1] - s.a[1], pz = P[v * 3 + 2] - s.a[2];
    const a = Math.atan2(px * tx + py * ty + pz * tz, px * sx + py * sy + pz * sz);
    UV[v * 2] = (a / Math.PI) * 1.1;
    UV[v * 2 + 1] = tAlong[v] * len * 8;
  }
  return UV;
}

// The face gets a different kind of UV.
//
// Everywhere else on the body the UV is a cylinder wrapped round a bone and it
// addresses a noise texture, so it only has to be smooth. A face has to be
// addressed like a face: the shader wants to know how far across the head a
// pixel is and how far down it is, so it can put an eye a fixed fraction of the
// way up and the same distance either side of the middle. That is what this
// writes — u is -1 at one temple and +1 at the other, v is 0 at the chin and 1
// at the hairline — over the face vertices only. Nothing else reads it and
// nothing else is touched.
function faceUVs(P, M, UV) {
  const face = [];
  for (let v = 0; v < M.length; v++) if (M[v] === 6) face.push(v);
  if (face.length < 12) return;

  // Centre on the face's own middle, not on x = 0. The static prop is a sculpt
  // that was never centred and its head sits five centimetres off the axis; an
  // eye placed three centimetres from x = 0 would land on an ear.
  let cx = 0;
  for (const v of face) cx += P[v * 3];
  cx /= face.length;

  const ys = face.map((v) => P[v * 3 + 1]).sort((a, b) => a - b);
  const minY = ys[0], maxY = ys[ys.length - 1];
  // A percentile rather than the extreme: one stray vertex from the far side of
  // the head, caught by the nearest-bone test, would otherwise set the width
  // and squash the whole face into the middle of the range.
  // Fixed units of a real face — half its width at the cheekbones, and chin to
  // brow — not the bounding box of whatever the material rule happened to
  // catch. The shader turns these into centimetres and places an eye three
  // centimetres off the middle; if the scale moved with the bake, so would the
  // eyes. bake-mixamo.mjs uses the same two numbers.
  const FACE_HALF_W = 0.065;
  const FACE_H = 0.088;
  if (maxY - minY < 1e-4) return;

  for (const v of face) {
    UV[v * 2] = (P[v * 3] - cx) / FACE_HALF_W;
    UV[v * 2 + 1] = (P[v * 3 + 1] - minY) / FACE_H;
  }
  console.log(
    `face: ${face.length} verts, ${((maxY - minY) * 100).toFixed(1)}cm tall, centred at x=${cx.toFixed(3)}`
  );
}

// 0 skin · 1 jacket · 2 pants · 3 belt · 4 lapel · 5 hair · 6 face.
// Derived from which bone owns the vertex and how far along it sits, which is
// exactly where a gi's hems are: mid-forearm, mid-shin, the collar, the belt.
// 0 skin · 1 jacket · 2 pants · 3 belt · 4 lapel · 5 hair · 6 face.
//
// Cut by height in the bind pose rather than by distance along a bone. In the
// bind pose the arms hang and the legs are straight, so every hem on a gi — the
// sleeve, the trouser cuff, the collar — is a horizontal plane, and a plane
// gives a clean edge. Parameter-along-the-bone does not: it jumps wherever the
// nearest-bone assignment flips, and the sleeve ends up with a torn edge that
// looks like damage rather than tailoring.
function materials(P, bone, target, H, ownerDist) {
  const n = P.length / 3;
  const M = new Uint8Array(n);
  const nameOf = BONES.map((b) => b[0]);
  const beltY = target.hips[1] + 0.05;
  const SLEEVE_Y = target.handL[1] + 0.045; // the cuff sits just above the wrist
  const CUFF_Y = target.footL[1] + 0.05;   // the trouser hem, just above the ankle
  const COLLAR_Y = target.neck[1] + 0.035;
  const headZ = target.head[2];
  const headY = target.head[1];

  for (let v = 0; v < n; v++) {
    const name = nameOf[bone[v * 2]];
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let m = 1;

    if (name === 'head' || name === 'headTop') {
      // Hair is the crown and the back of the skull, and the hairline is not a
      // horizontal plane. Cutting it at one height put hair across the bridge
      // of the nose — a black helmet with a chin under it, which is what every
      // screenshot showed. A real hairline sits high at the brow and drops to
      // the nape, so the cut runs with the front-to-back axis of the skull.
      const above = y - headY;
      const front = Math.max(-1, Math.min(1, (z - headZ) / 0.09));
      const line = 0.072 + front * 0.062;
      if (above > line) m = 5;
      // The face gets its own material so the shader can put a pair of eyes on
      // it. Skin everywhere else on the head — under the jaw, round the ears —
      // stays plain skin, because a feature drawn on the side of a head is a
      // smear rather than a face.
      else m = front > 0.15 && above > 0.012 ? 6 : 0;
    } else if (name === 'neck') {
      m = y > COLLAR_Y ? 0 : 1;
    } else if (name === 'handL' || name === 'handR' || name === 'handLTip' || name === 'handRTip') {
      // Bare skin only where the vertex is genuinely on the hand. The cuff of
      // the jacket is nearest the hand bone too — the hands hang against it —
      // and painting that skin puts a patch of wrist on the hip.
      m = ownerDist[v] < 0.07 ? 0 : 1;
    } else if (name === 'foreL' || name === 'foreR') {
      m = y < SLEEVE_Y ? 0 : 1;
    } else if (name === 'footL' || name === 'footR' || name === 'toeL' || name === 'toeR') {
      // A bare foot is a big thing and its bone runs up the middle of it.
      m = ownerDist[v] < 0.13 ? 0 : 2;
    } else if (name === 'shinL' || name === 'shinR') {
      m = y < CUFF_Y ? 0 : 2;
    } else if (name === 'thighL' || name === 'thighR') {
      m = 2;
    } else if (name === 'hips') {
      m = y < beltY - 0.045 ? 2 : 1;
    }

    if (m === 1 || m === 2) {
      // The belt is a band around the middle, and it has to be every vertex in
      // that band — restricting it to the two spine bones left the parts bound
      // to the upper thigh out of it, which tore ragged notches along the edge.
      if (Math.abs(y - beltY) < 0.05 && Math.hypot(x, z) < 0.3) m = 3;
      // The crossed lapels: two narrow strips running from the collarbones down
      // to the knot, which is where a gi is actually gripped.
      else if (z > 0.05 && y > beltY + 0.05 && y < COLLAR_Y) {
        const t = (COLLAR_Y - y) / Math.max(COLLAR_Y - (beltY + 0.05), 1e-6);
        const centre = 0.085 * (1 - t);   // they cross at the sternum
        if (Math.abs(Math.abs(x) - centre) < 0.032) m = 4;
      }
    }
    M[v] = m;
  }
  return M;
}

/* ------------------------------------------------------------------ output */

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
  let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, P[i * 3]); maxX = Math.max(maxX, P[i * 3]);
    minY = Math.min(minY, P[i * 3 + 1]); maxY = Math.max(maxY, P[i * 3 + 1]);
    minZ = Math.min(minZ, P[i * 3 + 2]); maxZ = Math.max(maxZ, P[i * 3 + 2]);
  }
  let uvMax = 0;
  for (let i = 0; i < UV.length; i++) uvMax = Math.max(uvMax, Math.abs(UV[i]));

  const HEAD = 48;
  const bytes = HEAD + n * (6 + 3 + 4 + 2 + 1 + 1 + 1) + idx.length * 2;
  const buf = Buffer.alloc(bytes + 8);
  let o = 0;
  buf.write('BJJF', o); o += 4;
  // Version 2 added a byte of baked ambient occlusion per vertex, on the end.
  // Version 3 fills the two spare bytes after it with the bone count: this file
  // is a list of bone indices and it has to say what it indexes into. See the
  // note in asset.js about the hand that came out as a spike.
  buf.writeUInt16LE(3, o); o += 2;          // version
  buf.writeUInt16LE(BONE_COUNT, o); o += 2; // the skeleton it was baked for
  buf.writeUInt32LE(n, o); o += 4;
  buf.writeUInt32LE(idx.length, o); o += 4;
  for (const v of [minX, minY, minZ, maxX, maxY, maxZ, uvMax, 0]) {
    buf.writeFloatLE(v, o); o += 4;
  }
  const sx = 65535 / Math.max(maxX - minX, 1e-6);
  const sy = 65535 / Math.max(maxY - minY, 1e-6);
  const sz = 65535 / Math.max(maxZ - minZ, 1e-6);
  for (let i = 0; i < n; i++) {
    buf.writeUInt16LE(Math.round((P[i * 3] - minX) * sx), o); o += 2;
    buf.writeUInt16LE(Math.round((P[i * 3 + 1] - minY) * sy), o); o += 2;
    buf.writeUInt16LE(Math.round((P[i * 3 + 2] - minZ) * sz), o); o += 2;
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      buf.writeInt8(Math.max(-127, Math.min(127, Math.round(N[i * 3 + k] * 127))), o);
      o += 1;
    }
  }
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round((UV[i * 2] / uvMax) * 32767), o); o += 2;
    buf.writeInt16LE(Math.round((UV[i * 2 + 1] / uvMax) * 32767), o); o += 2;
  }
  for (let i = 0; i < n; i++) {
    buf.writeUInt8(bone[i * 2], o); o += 1;
    buf.writeUInt8(bone[i * 2 + 1], o); o += 1;
  }
  for (let i = 0; i < n; i++) {
    buf.writeUInt8(Math.round(wt[i * 2] * 255), o); o += 1;
  }
  for (let i = 0; i < n; i++) {
    buf.writeUInt8(mat[i], o); o += 1;
  }
  for (let i = 0; i < n; i++) {
    buf.writeUInt8(Math.round(Math.min(1, Math.max(0, ao[i])) * 255), o); o += 1;
  }
  for (let i = 0; i < idx.length; i++) {
    buf.writeUInt16LE(idx[i], o); o += 2;
  }
  return buf.subarray(0, o);
}

/* -------------------------------------------------------------------- main */

const { json, bin } = readGLB(src);
const prim = json.meshes[0].primitives[0];
const rawPos = accessor(json, bin, prim.attributes.POSITION);
const rawIdx = accessor(json, bin, prim.indices);
const welded = weld(rawPos, rawIdx);
const comps = components(welded.pos, welded.idx);
console.log(`${rawPos.length / 3} verts -> ${welded.pos.length / 3} welded, ${comps.length} components`);
comps.slice(0, 8).forEach((c, i) => {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const v of c) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], welded.pos[v * 3 + k]);
    hi[k] = Math.max(hi[k], welded.pos[v * 3 + k]);
  }
  console.log(`  [${i}] ${c.length} verts  size ${hi.map((h, k) => (h - lo[k]).toFixed(3)).join(' x ')}`);
});

const one = extract(welded.pos, welded.idx, comps[COMPONENT]);
if (one.idx.length / 3 > 65535 || one.pos.length / 3 > 65535) {
  console.warn('warning: component exceeds 16-bit index range');
}

// Canonical skeleton: this is the target the sculpt is warped onto.
const sk = new Skeleton();
sk.pose();
const target = {};
for (let i = 0; i < BONE_COUNT; i++) {
  const m = sk.world[i];
  target[BONES[i][0]] = [m[12], m[13], m[14]];
}
const TARGET_H = HEIGHT > 0 ? HEIGHT : target.headTop[1];

if (TRIS > 0) {
  const before = one.idx.length / 3;
  const d = decimate(one.pos, one.idx, Math.round(TRIS * 0.52));
  one.pos = d.pos;
  one.idx = d.idx;
  console.log(
    `decimated ${before} -> ${one.idx.length / 3} triangles ` +
    `(${(one.pos.length / 3) | 0} verts, ${(d.cell * 1000).toFixed(1)} mm grid)`
  );
}

// Normalise the sculpt: feet on the floor, centred, scaled to the rig's height.
{
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < one.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], one.pos[i + k]);
      hi[k] = Math.max(hi[k], one.pos[i + k]);
    }
  }
  const s = TARGET_H / (hi[1] - lo[1]);
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  for (let i = 0; i < one.pos.length; i += 3) {
    one.pos[i] = (one.pos[i] - cx) * s;
    one.pos[i + 1] = (one.pos[i + 1] - lo[1]) * s;
    one.pos[i + 2] = (one.pos[i + 2] - cz) * s;
  }
}

if (STATIC) {
  const wind = orient(one.pos, one.idx);
  console.log(
    `winding: ${(wind.rate * 100).toFixed(1)}% of shared edges disagreed, ` +
    `${wind.walked ? 'reoriented' : 'left alone'}, turned ${wind.flipped}, ` +
    `shell volume ${Math.abs(wind.volume).toFixed(3)} m3`
  );
  const N = normals(one.pos, one.idx);
  const UV = staticUVs(one.pos);
  const MAT = staticMaterials(one.pos);
  faceUVs(one.pos, MAT, UV);
  const n = one.pos.length / 3;
  const bone = new Uint8Array(n * 2);          // everything rides the root bone
  const wt = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) wt[i * 2] = 1;
  const counts = {};
  for (const v of MAT) counts[v] = (counts[v] || 0) + 1;
  console.log('material split:', Object.entries(counts)
    .map(([k, v]) => `${['skin', 'jacket', 'pants', 'belt', 'lapel', 'hair', 'face'][k]}:${v}`).join(' '));
  const AO = bakeAO(one.pos, N, one.idx);
  const out = encode(one.pos, N, UV, bone, wt, MAT, AO, one.idx);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  console.log(
    `\nwrote ${OUT}  ${(out.length / 1024).toFixed(0)} KB  ` +
    `${n} verts  ${one.idx.length / 3} tris  (static prop, no rig)`
  );
  process.exit(0);
}

const m = measure(one.pos, TARGET_H, target);
const source = fitSource(m, target);

if (REPORT) {
  console.log('\nsilhouette landmarks (metres, rig scale):');
  // The widest slice of a standing body with its arms down is the forearms,
  // not the shoulders — these are reported only as a sanity read on the scale.
  console.log(`  widest upper  ${m.shoulderPeak.toFixed(3)}   widest lower ${m.hipPeak.toFixed(3)}`);
  for (const k of ['shL', 'elbL', 'handL', 'kneeL', 'footL']) {
    const v = m[k];
    console.log(`  ${k.padEnd(6)} outer x=${v ? v.ext.toFixed(3) : 'n/a'}  centre x=${v ? v.x.toFixed(3) : 'n/a'} z=${v ? v.z.toFixed(3) : 'n/a'}`);
  }
  console.log('\njoint fit  (sculpt -> rig):');
  for (const name of ['hips', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'thighL', 'shinL', 'footL']) {
    const s = source[name], t = target[name];
    const d = Math.hypot(s[0] - t[0], s[1] - t[1], s[2] - t[2]);
    console.log(
      `  ${name.padEnd(8)} ${s.map((v) => v.toFixed(3).padStart(7)).join(' ')}  ->  ` +
      `${t.map((v) => v.toFixed(3).padStart(7)).join(' ')}   moved ${(d * 100).toFixed(1)}cm`
    );
  }
}

// What the warp is about to do to each bone, before it does it. The scale is
// targetLength/sourceLength, so anything far from 1 means geometry is being
// inflated or crushed by the fit rather than merely moved.
{
  const rows = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const name = BONES[i][0];
    let kid = null;
    for (let k = i + 1; k < BONE_COUNT; k++) if (BONES[k][1] === i) { kid = BONES[k][0]; break; }
    if (!kid) continue;
    const len = (J, a, b) => Math.hypot(J[b][0] - J[a][0], J[b][1] - J[a][1], J[b][2] - J[a][2]);
    const sl = len(source, name, kid), tl = len(target, name, kid);
    rows.push([name, sl, tl, tl / Math.max(sl, 1e-6)]);
  }
  rows.sort((a, b) => Math.abs(Math.log(b[3])) - Math.abs(Math.log(a[3])));
  console.log('\nwarp scale per bone (target/source length):');
  for (const [n, sl, tl, r] of rows.slice(0, 8)) {
    const flag = r > 1.15 || r < 0.87 ? '  <-- distorts' : '';
    console.log(`  ${n.padEnd(9)} ${(sl * 100).toFixed(1).padStart(6)}cm -> ${(tl * 100).toFixed(1).padStart(6)}cm  x${r.toFixed(2)}${flag}`);
  }
}

const segs = segments(source);
const { bone, wt, tAlong, ownerDist } = skinWeights(one.pos, one.idx, segs);
const warped = warpToRig(one.pos, segs, source, target, bone, wt);
const wind = orient(warped, one.idx);
console.log(
  `winding: ${(wind.rate * 100).toFixed(1)}% of shared edges disagreed, ` +
  `${wind.walked ? 'reoriented' : 'left alone'}, turned ${wind.flipped} of ` +
  `${one.idx.length / 3}, shell volume ${Math.abs(wind.volume).toFixed(3)} m3`
);
const N = normals(warped, one.idx);
const targetSegs = segments(target);
const UV = uvs(warped, targetSegs, bone, tAlong, target);
const MAT = materials(warped, bone, target, TARGET_H, ownerDist);
faceUVs(warped, MAT, UV);

const counts = {};
for (const v of MAT) counts[v] = (counts[v] || 0) + 1;
console.log('\nmaterial split:', Object.entries(counts)
  .map(([k, v]) => `${['skin', 'jacket', 'pants', 'belt', 'lapel', 'hair', 'face'][k]}:${v}`).join(' '));

const AO = bakeAO(warped, N, one.idx);
const out = encode(warped, N, UV, bone, wt, MAT, AO, one.idx);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(
  `\nwrote ${OUT}  ${(out.length / 1024).toFixed(0)} KB  ` +
  `${warped.length / 3} verts  ${one.idx.length / 3} tris`
);
