// Is a sent arena worth taking?
//
// The same question `clip-check` asks of an animation pack, asked of a room.
// A hall arrives as an FBX full of promising names — Tatami_Main, Scoreboard,
// Bleacher_L_Tier_0 — and none of them say whether the mat is the size this
// sport uses, whether the geometry is anything the game does not already build
// itself in fifty lines, or whether the textures are pictures or flat colours
// with a file wrapped round them.
//
// The comparison it makes is against `src/render/arena.js`, because that is
// what a sent arena has to beat. The game builds its own hall out of boxes; an
// FBX of boxes is not an upgrade, it is the same thing with someone else's
// name printed on it.
//
//   node bjj/tools/scene-check.mjs arena.fbx
//   node bjj/tools/scene-check.mjs arena.fbx --dump out/   textures as PNG
//
// Reads binary FBX 7.x directly (tools/fbx.mjs); no converter needed.

import { writeFileSync, mkdirSync } from 'fs';
import { basename } from 'path';
import { readFBX, child, childAll, cleanName } from './fbx.mjs';
import { buildArena, ARENA_AREA, ARENA_HALF } from '../src/render/arena.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node bjj/tools/scene-check.mjs <arena.fbx> [--dump out/]');
  process.exit(2);
}
const di = process.argv.indexOf('--dump');
const DUMP = di >= 0 ? process.argv[di + 1] || 'out' : null;

const { version, root } = readFBX(file);
const objs = child(root, 'Objects');
const conns = child(root, 'Connections');
const byId = new Map();
for (const o of objs.children) byId.set(o.props[0], o);

// The unit the file is in. An FBX says so in GlobalSettings and the answer is
// almost always centimetres; a file that says nothing and means metres puts a
// hundred-metre mat on the screen, which is the loudest possible bug and still
// worth catching in a number rather than in a screenshot.
const gs = child(root, 'GlobalSettings');
const settings = props70(gs);
const cmPerUnit = settings['UnitScaleFactor'] ? settings['UnitScaleFactor'][0] : 1;
const toM = cmPerUnit / 100;

// ------------------------------------------------------------- geometry

let tris = 0, verts = 0, boxes = 0, noNormals = 0, noUV = 0;
const geomOf = new Map();
for (const c of conns.children) {
  const o = byId.get(c.props[1]);
  if (o && o.name === 'Geometry') geomOf.set(c.props[2], o);
}

const models = [];
for (const m of childAll(objs, 'Model')) {
  const p = props70(m);
  const t = (p['Lcl Translation'] || [0, 0, 0]).map((v) => v * toM);
  const s = p['Lcl Scaling'] || [1, 1, 1];
  const g = geomOf.get(m.props[0]);
  let size = [0, 0, 0], vcount = 0;
  if (g) {
    const V = child(g, 'Vertices').props[0];
    const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (let i = 0; i < V.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (V[i + k] < min[k]) min[k] = V[i + k];
        if (V[i + k] > max[k]) max[k] = V[i + k];
      }
    }
    size = [0, 1, 2].map((k) => (max[k] - min[k]) * s[k] * toM);
    vcount = V.length / 3;
    verts += vcount;
    let run = 0;
    for (const x of child(g, 'PolygonVertexIndex').props[0]) {
      run++;
      if (x < 0) { tris += run - 2; run = 0; }
    }
    // A box is 24 vertices and 12 triangles, and that is the whole point of
    // the count: the game already has a box builder.
    if (vcount === 24) boxes++;
    if (!child(g, 'LayerElementNormal')) noNormals++;
    if (!child(g, 'LayerElementUV')) noUV++;
  }
  models.push({ name: cleanName(m.props[1]), t, size, verts: vcount });
}

const meshes = models.filter((m) => m.verts > 0);
const bounds = [0, 1, 2].map((k) => {
  let lo = 1e9, hi = -1e9;
  for (const m of meshes) {
    lo = Math.min(lo, m.t[k] - m.size[k] / 2);
    hi = Math.max(hi, m.t[k] + m.size[k] / 2);
  }
  return [lo, hi];
});

const mine = buildArena();
console.log(`${basename(file)} — FBX ${version}, ${cmPerUnit === 1 ? 'centimetres' : cmPerUnit + ' cm per unit'}`);
console.log(`  ${meshes.length} meshes, ${tris} triangles, ${verts} vertices` +
  `   (${boxes} of them plain boxes)`);
console.log(`  the game builds ${mine.count / 3} triangles of hall for itself`);
console.log(`  spans ${(bounds[0][1] - bounds[0][0]).toFixed(1)} × ` +
  `${(bounds[2][1] - bounds[2][0]).toFixed(1)} m, ` +
  `${(bounds[1][1] - bounds[1][0]).toFixed(1)} m tall`);

const notes = [];
if (noNormals) notes.push(`${noNormals} mesh(es) carry no normals`);
if (noUV) notes.push(`${noUV} mesh(es) carry no UVs`);
if (boxes === meshes.length) {
  notes.push('every mesh is a plain box — this is the shape the game already generates, ' +
    'so what is on offer is the layout and the textures, not the geometry');
}

// The mat. This game is played on an eight metre competition square with three
// metres of safety around it, and that is not decoration: the sim pushes the
// pair back inside it and the camera frames it.
const mat = meshes
  .filter((m) => /tatami|mat/i.test(m.name) && m.size[0] > 1 && m.size[2] > 1)
  .sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2])[0];
if (!mat) {
  notes.push('no mat found — nothing here is a flat square wider than a metre');
} else {
  const outer = Math.max(
    ...meshes.filter((m) => /tatami|mat/i.test(m.name))
      .map((m) => Math.max(Math.abs(m.t[0]) + m.size[0] / 2, Math.abs(m.t[2]) + m.size[2] / 2))
  );
  console.log(`  mat: ${mat.name} ${mat.size[0].toFixed(1)} × ${mat.size[2].toFixed(1)} m, ` +
    `matted out to ${outer.toFixed(1)} m from centre`);
  if (Math.abs(mat.size[0] - ARENA_AREA) > 0.5) {
    notes.push(`its competition square is ${mat.size[0].toFixed(1)} m; the game plays on ${ARENA_AREA}`);
  }
  if (outer < ARENA_HALF - 0.5) {
    notes.push(`only ${(outer - ARENA_AREA / 2).toFixed(1)} m of mat outside the square; ` +
      `the game needs ${ARENA_HALF - ARENA_AREA / 2} and pushes the fighters onto it`);
  }
}

// ------------------------------------------------------------- textures

if (DUMP) mkdirSync(DUMP, { recursive: true });
const textures = [];
for (const v of childAll(objs, 'Video')) {
  const c = child(v, 'Content');
  if (!c || !c.props[0]) continue;
  const b = Buffer.from(c.props[0]);
  const name = cleanName(v.props[1]);
  const png = b.length > 24 && b.subarray(1, 4).toString() === 'PNG';
  const t = { name, bytes: b.length,
              w: png ? b.readUInt32BE(16) : 0, h: png ? b.readUInt32BE(20) : 0,
              kind: png ? 'PNG' : b[0] === 0xff && b[1] === 0xd8 ? 'JPEG' : 'unknown' };
  textures.push(t);
  if (DUMP) writeFileSync(`${DUMP}/${name}.png`, b);
}
if (textures.length) {
  console.log(`  ${textures.length} embedded textures, ` +
    `${(textures.reduce((s, t) => s + t.bytes, 0) / 1024).toFixed(0)}KB:`);
  for (const t of textures) {
    console.log(`     ${t.name.padEnd(14)} ${t.w}×${t.h} ${t.kind}  ${(t.bytes / 1024).toFixed(1)}KB`);
  }
  const odd = textures.filter((t) => t.kind === 'unknown');
  if (odd.length) notes.push(`${odd.length} texture(s) in a format nothing here can read`);
}
if (DUMP) console.log(`  textures written to ${DUMP}/`);

console.log('');
for (const n of notes) console.log(`  · ${n}`);
console.log(notes.length
  ? `\n${notes.length} thing(s) to decide before using it`
  : '\nnothing in the way of using it as it stands');

function props70(node) {
  const out = {};
  const p = node && child(node, 'Properties70');
  if (p) for (const q of p.children) out[String(q.props[0])] = q.props.slice(4).map(Number);
  return out;
}
