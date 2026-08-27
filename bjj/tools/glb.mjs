// Reading a GLB, including its animation.
//
// The other GLB reader in this repo (inside bake-fighter.mjs) wants vertices;
// this one wants motion, so it lives on its own. Between them they cover what
// glTF is used for here and nothing else: no materials, no textures, no PBR.

import { readFileSync } from 'fs';
import { m4, m4mul, m4compose } from '../src/core/m4.js';

const COMPONENT = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGLB(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a glb`);
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
  return new GLB(json, bin);
}

class GLB {
  constructor(json, bin) {
    this.json = json;
    this.bin = bin;
    this.byName = new Map();
    (json.nodes || []).forEach((n, i) => { if (n.name) this.byName.set(n.name, i); });
    this.parent = new Int32Array((json.nodes || []).length).fill(-1);
    (json.nodes || []).forEach((n, i) => { for (const c of n.children || []) this.parent[c] = i; });
    this._acc = new Map();
  }

  accessor(i) {
    if (this._acc.has(i)) return this._acc.get(i);
    const a = this.json.accessors[i];
    const bv = this.json.bufferViews[a.bufferView];
    const Type = COMPONENT[a.componentType];
    const n = a.count * SIZE[a.type];
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    // The bin chunk is a view into a Buffer with no alignment guarantee, so the
    // bytes are copied rather than aliased.
    const bytes = this.bin.buffer.slice(
      this.bin.byteOffset + start,
      this.bin.byteOffset + start + n * Type.BYTES_PER_ELEMENT
    );
    const out = new Type(bytes);
    this._acc.set(i, out);
    return out;
  }

  clips() {
    return (this.json.animations || []).map((a, i) => ({ index: i, name: a.name || `clip${i}`, seconds: this.length(i) }));
  }

  length(index) {
    const a = this.json.animations[index];
    let t = 0;
    for (const s of a.samplers) {
      const acc = this.json.accessors[s.input];
      if (acc.max) t = Math.max(t, acc.max[0]);
      else { const times = this.accessor(s.input); t = Math.max(t, times[times.length - 1]); }
    }
    return t;
  }

  // The local transform of every node at time `t`, with the animation's
  // channels applied over the node's own rest transform.
  local(index, t) {
    const nodes = this.json.nodes;
    const trs = nodes.map((n) => ({
      t: n.translation ? n.translation.slice() : [0, 0, 0],
      r: n.rotation ? n.rotation.slice() : [0, 0, 0, 1],
      s: n.scale ? n.scale.slice() : [1, 1, 1],
    }));
    const anim = this.json.animations[index];
    for (const ch of anim.channels) {
      const s = anim.samplers[ch.sampler];
      const times = this.accessor(s.input);
      const values = this.accessor(s.output);
      const path = ch.target.path;
      const n = path === 'rotation' ? 4 : 3;
      const v = sample(times, values, n, s.interpolation || 'LINEAR', t);
      const d = trs[ch.target.node];
      if (path === 'translation') d.t = v;
      else if (path === 'rotation') d.r = v;
      else if (path === 'scale') d.s = v;
    }
    return trs;
  }

  // World matrices for every node, at time `t`. Scale is composed in only where
  // a node actually carries one — this rig does not, and skipping it keeps the
  // matrices in the same form the game's skeleton uses.
  world(index, t) {
    const trs = this.local(index, t);
    const out = new Array(trs.length).fill(null);
    const build = (i) => {
      if (out[i]) return out[i];
      const d = trs[i];
      const m = m4compose(m4(), new Float32Array(d.r), d.t);
      if (d.s[0] !== 1 || d.s[1] !== 1 || d.s[2] !== 1) {
        for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= d.s[c];
      }
      const p = this.parent[i];
      out[i] = p < 0 ? m : m4mul(m4(), build(p), m);
      return out[i];
    };
    for (let i = 0; i < trs.length; i++) build(i);
    return out;
  }

  // World matrix lookup by node name, for a set of world matrices.
  at(world, name) {
    const i = this.byName.get(name);
    return i === undefined ? null : world[i];
  }
}

// One keyframed value at time t. Step and linear are what this pack uses;
// cubic spline is here because glTF allows it and silently reading the tangents
// as values would look like motion rather than like an error.
function sample(times, values, n, interp, t) {
  const last = times.length - 1;
  if (t <= times[0]) return slice(values, 0, n, interp);
  if (t >= times[last]) return slice(values, last, n, interp);
  let i = 0;
  while (i < last && times[i + 1] < t) i++;
  if (interp === 'STEP') return slice(values, i, n, interp);
  const u = (t - times[i]) / (times[i + 1] - times[i]);
  const a = slice(values, i, n, interp);
  const b = slice(values, i + 1, n, interp);
  if (interp === 'CUBICSPLINE') {
    const dt = times[i + 1] - times[i];
    const outA = tangent(values, i, n, 2), inB = tangent(values, i + 1, n, 0);
    const u2 = u * u, u3 = u2 * u;
    return a.map((v, k) =>
      (2 * u3 - 3 * u2 + 1) * v + dt * (u3 - 2 * u2 + u) * outA[k] +
      (-2 * u3 + 3 * u2) * b[k] + dt * (u3 - u2) * inB[k]);
  }
  if (n === 4) return qslerp(a, b, u);
  return a.map((v, k) => v + (b[k] - v) * u);
}

const slice = (values, i, n, interp) => {
  const stride = interp === 'CUBICSPLINE' ? n * 3 : n;
  const off = i * stride + (interp === 'CUBICSPLINE' ? n : 0);
  return Array.from(values.subarray(off, off + n));
};
const tangent = (values, i, n, which) => Array.from(values.subarray(i * n * 3 + which * n, i * n * 3 + which * n + n));

function qslerp(a, b, u) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return a.map((v, k) => v + (bb[k] - v) * u);
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - u) * th) / s, wb = Math.sin(u * th) / s;
  return a.map((v, k) => v * wa + bb[k] * wb);
}
