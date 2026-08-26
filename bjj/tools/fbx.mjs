// A minimal reader for binary FBX 7.x.
//
// Written because the machine has no FBX toolchain and because the only parts
// of the format this project needs are small: the mesh, the skin clusters, and
// the bone hierarchy. Everything else in an FBX — materials, takes, layers,
// video clips — is skipped by the same generic record walk that finds them.
//
// The format is a tree of records. Each record has a name, a list of typed
// properties, and nested children, and ends at a byte offset it states up
// front. Arrays of numbers are usually zlib-deflated. That is the whole thing.

import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';

export function readFBX(path) {
  const buf = readFileSync(path);
  const magic = buf.subarray(0, 21).toString('binary');
  if (!magic.startsWith('Kaydara FBX Binary')) throw new Error(`${path}: not a binary FBX`);
  const version = buf.readUInt32LE(23);
  // From 7.5 the record offsets widened to 64 bits. Nothing else changed.
  const wide = version >= 7500;
  let off = 27;
  const root = { name: '', props: [], children: [] };
  for (;;) {
    const node = readNode(buf, off, wide);
    if (!node) break;
    root.children.push(node.node);
    off = node.end;
  }
  return { version, root };
}

function readNode(buf, off, wide) {
  const num = (o) => (wide ? Number(buf.readBigUInt64LE(o)) : buf.readUInt32LE(o));
  const step = wide ? 8 : 4;
  const endOffset = num(off);
  // A null record — all offsets zero — terminates a child list.
  if (endOffset === 0) return null;
  const numProps = num(off + step);
  const propLen = num(off + step * 2);
  const nameLen = buf.readUInt8(off + step * 3);
  let p = off + step * 3 + 1;
  const name = buf.subarray(p, p + nameLen).toString('binary');
  p += nameLen;

  const props = [];
  const propsEnd = p + propLen;
  for (let i = 0; i < numProps; i++) {
    const r = readProp(buf, p);
    props.push(r.value);
    p = r.next;
  }
  p = propsEnd;

  const children = [];
  const sentinel = wide ? 25 : 13;
  while (p < endOffset - sentinel + 1) {
    const c = readNode(buf, p, wide);
    if (!c) break;
    children.push(c.node);
    p = c.end;
  }
  return { node: { name, props, children }, end: endOffset };
}

const ARRAY_KIND = {
  f: [Float32Array, 4], d: [Float64Array, 8], l: [BigInt64Array, 8],
  i: [Int32Array, 4], b: [Uint8Array, 1],
};

function readProp(buf, p) {
  const type = String.fromCharCode(buf.readUInt8(p));
  p += 1;
  switch (type) {
    case 'Y': return { value: buf.readInt16LE(p), next: p + 2 };
    case 'C': return { value: buf.readUInt8(p) !== 0, next: p + 1 };
    case 'I': return { value: buf.readInt32LE(p), next: p + 4 };
    case 'F': return { value: buf.readFloatLE(p), next: p + 4 };
    case 'D': return { value: buf.readDoubleLE(p), next: p + 8 };
    case 'L': return { value: Number(buf.readBigInt64LE(p)), next: p + 8 };
    case 'S':
    case 'R': {
      const len = buf.readUInt32LE(p);
      const raw = buf.subarray(p + 4, p + 4 + len);
      return { value: type === 'S' ? raw.toString('binary') : raw, next: p + 4 + len };
    }
    default: {
      const kind = ARRAY_KIND[type];
      if (!kind) throw new Error(`unknown FBX property type ${type} at ${p - 1}`);
      const [Type, size] = kind;
      const length = buf.readUInt32LE(p);
      const encoding = buf.readUInt32LE(p + 4);
      const compLen = buf.readUInt32LE(p + 8);
      const start = p + 12;
      let bytes = buf.subarray(start, start + compLen);
      if (encoding === 1) bytes = inflateSync(bytes);
      // The copy is needed: a Buffer view is not guaranteed to be aligned for
      // the wider element types.
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + length * size);
      let arr = new Type(copy);
      if (type === 'l') arr = Float64Array.from(arr, (v) => Number(v));
      return { value: arr, next: start + compLen };
    }
  }
}

/* ------------------------------------------------------------- navigation */

export const child = (node, name) => node.children.find((c) => c.name === name);
export const childAll = (node, name) => node.children.filter((c) => c.name === name);

// FBX names arrive as "name<NUL><SOH>Class"; only the first half is the name.
const NAME_SEP = String.fromCharCode(0);
export const cleanName = (s) => String(s || '').split(NAME_SEP)[0];

// Objects are addressed by a 64-bit id in their first property; Connections is
// a flat list of (child id, parent id) pairs that turns them into a graph.
export function index(root) {
  const objects = child(root, 'Objects');
  const byId = new Map();
  if (objects) {
    for (const o of objects.children) {
      byId.set(o.props[0], o);
      o.fbxName = cleanName(o.props[1]);
      o.fbxClass = cleanName(o.props[2]);
    }
  }
  const conns = child(root, 'Connections');
  const parents = new Map();   // child id -> [{ id, prop }]
  const children = new Map();  // parent id -> [{ id, prop }]
  if (conns) {
    for (const c of conns.children) {
      const [kind, a, b, prop] = c.props;
      if (!parents.has(a)) parents.set(a, []);
      if (!children.has(b)) children.set(b, []);
      const link = kind === 'OP' ? cleanName(prop) : null;
      parents.get(a).push({ id: b, prop: link });
      children.get(b).push({ id: a, prop: link });
    }
  }
  return { byId, parents, children };
}

// Model transforms live in a Properties70 bag as named entries.
export function prop70(node, name, fallback) {
  const bag = child(node, 'Properties70');
  if (!bag) return fallback;
  for (const p of bag.children) {
    if (cleanName(p.props[0]) !== name) continue;
    return p.props.slice(4);
  }
  return fallback;
}
