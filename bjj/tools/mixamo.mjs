// Pull a rigged character out of a Mixamo FBX: the mesh, the bind pose, and
// the bone-to-vertex weights.
//
// Mixamo exports "With Skin" as a Beta mannequin split into two meshes
// (Beta_Surface, Beta_Joints) sharing one skeleton. What is worth having is not
// the mannequin — it wears no gi — but its *weights*: they are hand-quality,
// and this project computes its own by estimation.

import { readFBX, child, index, prop70 } from './fbx.mjs';

const DEG = Math.PI / 180;

// FBX stores a node's transform as a stack, not a matrix. Mixamo only ever
// uses translation, rotation and pre-rotation, so that is all this builds.
function localMatrix(model) {
  const t = prop70(model, 'Lcl Translation', [0, 0, 0]);
  const r = prop70(model, 'Lcl Rotation', [0, 0, 0]);
  const pre = prop70(model, 'PreRotation', [0, 0, 0]);
  const s = prop70(model, 'Lcl Scaling', [1, 1, 1]);
  const order = prop70(model, 'RotationOrder', [0])[0] || 0;
  const M = mul(euler(pre, 0), euler(r, order));
  M[12] = t[0]; M[13] = t[1]; M[14] = t[2];
  if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) {
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) M[c * 4 + k] *= s[c];
  }
  return M;
}

// Column-major 4x4, same convention as the renderer.
function ident() {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

function axisRot(axis, deg) {
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  const m = ident();
  if (axis === 0) { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; }
  else if (axis === 1) { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
  else { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
}

// FBX applies euler angles in the stated order, and "XYZ" means R = Rz·Ry·Rx.
function euler(r, order) {
  const seq = ORDERS[order] || ORDERS[0];
  let m = ident();
  for (let i = seq.length - 1; i >= 0; i--) m = mul(m, axisRot(seq[i], r[seq[i]]));
  return m;
}

function invRigid(m) {
  const o = ident();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c];
  const tx = m[12], ty = m[13], tz = m[14];
  o[12] = -(o[0] * tx + o[4] * ty + o[8] * tz);
  o[13] = -(o[1] * tx + o[5] * ty + o[9] * tz);
  o[14] = -(o[2] * tx + o[6] * ty + o[10] * tz);
  return o;
}

export function readMixamo(path) {
  const { root } = readFBX(path);
  const { byId, parents, children } = index(root);

  // Bones are Models of class LimbNode; the mesh is a Model with a Geometry
  // under it. Both live in the same parent/child graph.
  const models = [...byId.values()].filter((o) => o.name === 'Model');
  const bones = new Map();   // id -> { name, model, parent }
  for (const m of models) {
    if (m.fbxClass !== 'LimbNode' && !m.fbxName.startsWith('mixamorig')) continue;
    bones.set(m.props[0], { id: m.props[0], name: m.fbxName, model: m, parent: -1 });
  }
  for (const b of bones.values()) {
    for (const p of parents.get(b.id) || []) if (bones.has(p.id)) b.parent = p.id;
  }

  // World transform of every bone in the file's own rest pose.
  const world = new Map();
  const worldOf = (id) => {
    if (world.has(id)) return world.get(id);
    const b = bones.get(id);
    const local = localMatrix(b.model);
    const m = b.parent >= 0 ? mul(worldOf(b.parent), local) : local;
    world.set(id, m);
    return m;
  };
  for (const id of bones.keys()) worldOf(id);

  // Geometry, triangulated. FBX polygons end on a negative index.
  const meshes = [];
  for (const g of [...byId.values()].filter((o) => o.name === 'Geometry')) {
    const V = child(g, 'Vertices');
    const PI = child(g, 'PolygonVertexIndex');
    if (!V || !PI) continue;
    const pos = Float64Array.from(V.props[0]);
    const polyIdx = PI.props[0];
    const tris = [];
    const polyOfCorner = [];
    let start = 0;
    for (let i = 0; i < polyIdx.length; i++) {
      let v = polyIdx[i];
      const end = v < 0;
      if (end) v = -v - 1;
      polyOfCorner.push(v);
      if (end) {
        for (let k = start + 1; k < i; k++) {
          tris.push(polyOfCorner[start], polyOfCorner[k], polyOfCorner[k + 1]);
        }
        start = i + 1;
      }
    }
    meshes.push({ id: g.props[0], name: g.fbxName, pos, idx: Int32Array.from(tris), corners: polyIdx.length });
  }

  // Skin clusters: one per bone, each listing the vertices it moves. The bind
  // matrices come with them — TransformLink is the bone's world transform at
  // bind time, which is exactly what the estimation in bake-fighter.mjs is
  // trying to guess.
  const skins = new Map();  // geometry id -> [{ boneId, indices, weights, transformLink }]
  for (const d of [...byId.values()].filter((o) => o.name === 'Deformer' && o.fbxClass === 'Cluster')) {
    const ix = child(d, 'Indexes');
    const w = child(d, 'Weights');
    const link = child(d, 'TransformLink');
    if (!ix || !w) continue;
    let boneId = -1;
    for (const c of children.get(d.props[0]) || []) if (bones.has(c.id)) boneId = c.id;
    // Cluster -> Skin -> Geometry
    let geomId = -1;
    for (const p of parents.get(d.props[0]) || []) {
      for (const pp of parents.get(p.id) || []) if (meshes.some((m) => m.id === pp.id)) geomId = pp.id;
    }
    if (boneId < 0 || geomId < 0) continue;
    if (!skins.has(geomId)) skins.set(geomId, []);
    skins.get(geomId).push({
      boneId,
      boneName: bones.get(boneId).name,
      indices: ix.props[0],
      weights: w.props[0],
      transformLink: link ? Float64Array.from(link.props[0]) : null,
    });
  }

  return { bones, world, meshes, skins, mul, invRigid, euler, idx: { byId, parents, children } };
}


/* ------------------------------------------------------------- animation */

const FBX_SECOND = 46186158000;

// Curves hang off AnimationCurveNodes, which hang off a Model's property.
// Collect them into { boneId: { 'Lcl Rotation': [cx, cy, cz], ... } }.
export function readCurves(path, parsed) {
  const { byId, parents, children } = parsed.idx;
  const out = new Map();
  for (const node of [...byId.values()].filter((o) => o.name === 'AnimationCurveNode')) {
    let target = -1, which = null;
    for (const p of parents.get(node.props[0]) || []) {
      if (parsed.bones.has(p.id) && p.prop) {
        target = p.id;
        which = p.prop;
      }
    }
    if (target < 0) continue;
    const axes = { X: null, Y: null, Z: null };
    for (const c of children.get(node.props[0]) || []) {
      const curve = byId.get(c.id);
      if (!curve || curve.name !== 'AnimationCurve' || !c.prop) continue;
      const axis = c.prop.slice(-1);
      const kt = child(curve, 'KeyTime');
      const kv = child(curve, 'KeyValueFloat');
      if (kt && kv) axes[axis] = { t: kt.props[0], v: kv.props[0] };
    }
    if (!out.has(target)) out.set(target, {});
    out.get(target)[which] = axes;
  }
  return out;
}

function sampleCurve(curve, seconds) {
  if (!curve) return null;
  const { t, v } = curve;
  const want = seconds * FBX_SECOND;
  if (!t.length) return null;
  if (want <= t[0]) return v[0];
  if (want >= t[t.length - 1]) return v[v.length - 1];
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= want) lo = mid;
    else hi = mid;
  }
  // Mixamo bakes every frame, so linear between keys is exact in practice.
  const span = t[hi] - t[lo] || 1;
  const f = (want - t[lo]) / span;
  return v[lo] + (v[hi] - v[lo]) * f;
}

export function clipLength(curves) {
  let end = 0;
  for (const props of curves.values()) {
    for (const axes of Object.values(props)) {
      for (const c of Object.values(axes)) {
        if (c && c.t.length) end = Math.max(end, c.t[c.t.length - 1]);
      }
    }
  }
  return end / FBX_SECOND;
}

// World transform of every bone at a moment in the clip.
export function poseAt(parsed, curves, seconds) {
  const { bones } = parsed;
  const world = new Map();
  const localOf = (b) => {
    const anim = curves.get(b.id) || {};
    const t = prop70(b.model, 'Lcl Translation', [0, 0, 0]).slice();
    const r = prop70(b.model, 'Lcl Rotation', [0, 0, 0]).slice();
    const pre = prop70(b.model, 'PreRotation', [0, 0, 0]);
    const order = prop70(b.model, 'RotationOrder', [0])[0] || 0;
    const at = anim['Lcl Translation'];
    const ar = anim['Lcl Rotation'];
    if (at) ['X', 'Y', 'Z'].forEach((a, i) => {
      const s = sampleCurve(at[a], seconds);
      if (s !== null) t[i] = s;
    });
    if (ar) ['X', 'Y', 'Z'].forEach((a, i) => {
      const s = sampleCurve(ar[a], seconds);
      if (s !== null) r[i] = s;
    });
    const M = parsed.mul(parsed.euler(pre, 0), parsed.euler(r, order));
    M[12] = t[0]; M[13] = t[1]; M[14] = t[2];
    return M;
  };
  const walk = (id) => {
    if (world.has(id)) return world.get(id);
    const b = bones.get(id);
    const local = localOf(b);
    const m = b.parent >= 0 ? parsed.mul(walk(b.parent), local) : local;
    world.set(id, m);
    return m;
  };
  for (const id of bones.keys()) walk(id);
  return world;
}

// Mixamo numbers the rig. A character rigged once comes back with bones called
// `mixamorig:Hips`; one that has been through the auto-rigger a few times comes
// back as `mixamorig9:Hips`, and the number is per-character, not per-file.
// Matching the literal prefix works until the second character you download,
// and then it silently finds no bones at all — which is exactly how it failed.
export const bare = (name) => String(name).replace(/^mixamorig\d*:/, '');
