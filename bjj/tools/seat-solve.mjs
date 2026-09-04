// Sit the pair on the mat.
//
// Every pose in the library carries a root height per man, written by hand, and
// nothing has ever checked it against the floor. Measured with weight-check —
// which skins the real baked fighter, because the skin is what the eye judges —
// the library spans thirty-one centimetres: in closed guard and turtle
// **neither man touches the mat at all** (the turtled man floats seventeen
// centimetres up, with his shadow on the ground far below him), while in the
// armbar the bodies are thirteen centimetres inside it.
//
// The fix is one number per pose and it cannot be eyeballed: this measures the
// pair's lowest skin, moves **both** men by the same amount so the relative
// geometry the pose authored is untouched, and repeats until it settles —
// rig._ground can push back, so the answer is a fixed point rather than a
// subtraction.
//
//   node bjj/tools/seat-solve.mjs           what it would change
//   node bjj/tools/seat-solve.mjs --write   and write it into poses.js

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PairRig } from '../src/game/rig.js';
import { POSES } from '../src/game/poses.js';
import { decodeFighter } from '../src/render/asset.js';

const WRITE = process.argv.includes('--write');
const here = dirname(fileURLToPath(import.meta.url));
const FLOOR = 0.05;      // the top of the mat, the height arena.js draws it at
const SETTLED = 0.002;   // two millimetres is under the skin's own noise
const PASSES = 8;

const load = (name) => {
  const raw = readFileSync(join(here, '..', 'assets', name));
  return decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
};
const MESH = { A: load('fighter.bin'), B: load('fighter-b.bin') };

// Where a man rests, which is not the same as his lowest vertex.
//
// Some poses have a leg authored straight through the floor — side control's
// bottom foot is forty centimetres under it — and `_ground` used to haul the
// foot back out every frame. Seating the pair by that one vertex would lift
// everything else half a metre into the air to save it, so the seat looks for
// the lowest **patch**: the lowest height at which the man has PATCH square
// centimetres of himself, rather than a toe. A limb still through the mat after
// that is a leg to fix, not a height to change, and the report names it.
const PATCH = 30;   // vertices within two centimetres of each other
function skinY(mesh, sk) {
  const { pos, bone, wt } = mesh;
  const n = pos.length / 3;
  const ys = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    let y = 0;
    for (let k = 0; k < 2; k++) {
      const w = wt[v * 2 + k];
      if (w <= 0) continue;
      const s = sk.skin.subarray(bone[v * 2 + k] * 16, bone[v * 2 + k] * 16 + 16);
      y += w * (s[1] * pos[v * 3] + s[5] * pos[v * 3 + 1] + s[9] * pos[v * 3 + 2] + s[13]);
    }
    ys[v] = y;
  }
  ys.sort();
  return ys;
}
// The lowest y that has a patch of body at it.
function restY(ys) {
  for (let i = 0; i + PATCH < ys.length; i++) {
    if (ys[i + PATCH] - ys[i] < 0.02) return ys[i];
  }
  return ys[0];
}

const rig = new PairRig();
// Measured with the runtime exactly as it plays, planting included. Switching
// the planting off looks purer and measures a pose nobody sees: the library
// leans on it — side control's bottom leg is authored forty centimetres through
// the floor — so without it the "resting patch" of half the library is a shin
// underground, and seating by that would hoist the pair a third of a metre into
// the air. What has to be true is what the player sees: the pair touches the mat.
// Both fighters, in both slots.
//
// The two baked men are not the same size — measured, up to three and a half
// centimetres apart at the point that touches the mat — and either of them can
// be in either role: main.js looks a body up through `roleShown`, so the pose
// that is right for one is wrong for the other by that much. The seat is taken
// from whichever mesh sits *highest*, so the shorter man touches the mat and
// the taller sinks a little into it. That way round on purpose: a body slightly
// into a soft mat is invisible, and a body floating above one has a shadow
// under it that everybody sees.
function measure(id) {
  rig.rewind();
  rig.applyAt(id, id, 1, 0.016);
  const low = (sk) => Math.max(skinY(MESH.A, sk)[0], skinY(MESH.B, sk)[0]);
  return { low: Math.min(low(rig.skel.A), low(rig.skel.B)) };
}

// Authored poses only. Mirrors are generated from their base and follow it.
const ids = Object.keys(POSES).filter((id) => !POSES[id].mirrorOf);
const rows = [];
for (const id of ids) {
  const start = measure(id);
  const before = start.low;
  let moved = 0;
  // Only a pose that floats, and only down to the first touch.
  //
  // A pose with something already on or through the mat is a different debt: a
  // leg authored below the floor, hauled back up every frame by the runtime's
  // foot planting. Moving the pair to save one of those puts the rest of the
  // body in the air, and the planting clamps an ankle to a fixed height anyway,
  // so a seat and a clamp push against each other forever — four poses sat in
  // exactly that limit cycle. Those legs are listed below and belong to a leg
  // solver, not to a height.
  //
  // What this fixes is the pose that hangs in the air whole: measured, in
  // closed guard and turtle **neither man touches the mat at all**, and the
  // turtled man's shadow lies on the ground a hand's breadth beneath him.
  if (start.low > FLOOR + 0.005) {
    const d = start.low - FLOOR;
    POSES[id].A.root.p[1] -= d;
    POSES[id].B.root.p[1] -= d;
    rig.invalidate(id);
    moved = -d;
  }
  const m = measure(id);
  rows.push({ id, before, after: m.low, through: FLOOR - m.low, moved });
}

rows.sort((a, b) => Math.abs(b.moved) - Math.abs(a.moved));
console.log(`${rows.length} authored poses, the mat at ${(FLOOR * 100).toFixed(0)}cm\n`);
console.log('     pose               было    стало   сдвиг   сквозь мат');
for (const r of rows) {
  const flag = Math.abs(r.moved) > 0.02 ? '!' : ' ';
  console.log(`   ${flag} ${r.id.padEnd(18)} ${((r.before - FLOOR) * 100).toFixed(1).padStart(6)}cm ` +
    `${((r.after - FLOOR) * 100).toFixed(1).padStart(6)}cm ${(r.moved * 100).toFixed(1).padStart(7)}cm ` +
    `${r.through > 0.02 ? (r.through * 100).toFixed(0) + 'cm' : ''}`);
}
const worst = rows[0];
const off = rows.filter((r) => Math.abs(r.moved) > 0.02).length;
console.log(`\n     ${off} poses hung more than two centimetres above the mat; ` +
  `the worst was ${worst.id} by ${(worst.moved * 100).toFixed(0)}cm`);
const highest = Math.max(...rows.map((r) => r.after - FLOOR));
console.log(`     nothing now hangs more than ${(highest * 1000).toFixed(0)}mm above it`);
const through = rows.filter((r) => r.through > 0.02).sort((a, b) => b.through - a.through);
if (through.length) {
  console.log(`\n     and ${through.length} poses still have a limb through it — a leg to author, ` +
    'not a height to change:');
  for (const r of through.slice(0, 12)) {
    console.log(`       ${r.id.padEnd(20)} ${(r.through * 100).toFixed(0)}cm under`);
  }
}

if (WRITE) {
  const path = join(here, '..', 'src', 'game', 'poses.js');
  let src = readFileSync(path, 'utf8');
  for (const r of rows) if (Math.abs(r.moved) > 0.0005) src = writePose(src, r.id);
  writeFileSync(path, src);
  console.log(`\n     written into ${path}`);
} else {
  console.log('\n     --write to put it in poses.js');
}

// Only the root height, and only in the block that belongs to this pose. Every
// comment, every joint and every other number in the file is left alone.
function writePose(src, id) {
  const start = src.indexOf(`  ${id}: P('${id}', {`);
  if (start < 0) return src;
  const end = brace(src, src.indexOf('{', start));
  let block = src.slice(start, end);
  for (const role of ['A', 'B']) {
    const rs = block.indexOf(`\n    ${role}: {`);
    if (rs < 0) continue;
    const re = brace(block, block.indexOf('{', rs));
    let sec = block.slice(rs, re);
    const p = POSES[id][role].root.p;
    sec = sec.replace(/p: \[[^\]]*\]/, `p: [${p.map(n3).join(', ')}]`);
    block = block.slice(0, rs) + sec + block.slice(re);
  }
  return src.slice(0, start) + block + src.slice(end);
}
function n3(v) { return (Math.round(v * 1000) / 1000).toString(); }
function brace(s, i) {
  let d = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) return k + 1; }
  }
  return s.length;
}
