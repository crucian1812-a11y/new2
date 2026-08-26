// Is the baked fighter actually riggable?
//
// A bad bake does not throw — it loads fine and then an arm stays behind when
// the body moves, or a whole limb turns out to be welded to the pelvis. These
// are the properties that have to hold for the skinning shader to produce a
// person, checked without a browser.

import { readFileSync, existsSync } from 'fs';
import { decodeFighter } from '../src/render/asset.js';
import { BONE_COUNT, BONES, TIPS } from '../src/render/skeleton.js';

// A rigged fighter and a static prop are both valid assets and only one of
// them has anything to say about bones.
const path = process.argv[2] || 'bjj/assets/fighter.bin';
if (!existsSync(path)) {
  console.log(`no baked fighter at ${path} — the game falls back to the procedural body`);
  process.exit(0);
}

const raw = readFileSync(path);
const m = decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
const n = m.pos.length / 3;

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

check(n > 2000, 'the mesh has enough geometry to hold a silhouette', `${n} verts, ${m.count / 3} tris`);
check(m.count % 3 === 0, 'the index buffer is whole triangles');

let maxIdx = 0;
for (const v of m.idx) if (v > maxIdx) maxIdx = v;
check(maxIdx < n, 'every index is in range', `max ${maxIdx} of ${n}`);

let badBone = 0;
for (const b of m.bone) if (!(b >= 0 && b < BONE_COUNT)) badBone++;
check(badBone === 0, 'every bone index names a real bone', `${badBone} bad`);

let badW = 0;
for (let i = 0; i < n; i++) {
  const s = m.wt[i * 2] + m.wt[i * 2 + 1];
  if (Math.abs(s - 1) > 0.01) badW++;
}
check(badW === 0, 'weights sum to one', `${badW} vertices off`);

let badN = 0, zeroN = 0;
for (let i = 0; i < n; i++) {
  const l = Math.hypot(m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]);
  if (l < 1e-4) zeroN++;
  else if (Math.abs(l - 1) > 0.08) badN++;
}
check(badN / n < 0.01, 'normals are unit length', `${badN} of ${n} off`);
// Not a tolerance question. One zero normal becomes NaN in the shader, and the
// bloom blur turns that NaN into a black rectangle far bigger than the triangle
// it came from.
check(zeroN === 0, 'no normal is zero length', `${zeroN} of ${n}`);

// Bounds: a fighter standing on the mat, not a fighter the size of the arena
// and not one buried in it.
let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (let i = 0; i < n; i++) {
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], m.pos[i * 3 + k]);
    hi[k] = Math.max(hi[k], m.pos[i * 3 + k]);
  }
}
const H = hi[1] - lo[1];
check(H > 1.5 && H < 1.9, 'the fighter is a person-sized person', `${H.toFixed(2)} m tall`);
check(Math.abs(lo[1]) < 0.12, 'the feet are on the mat, not through it', `lowest y ${lo[1].toFixed(3)}`);
check(hi[0] - lo[0] < 1.3, 'the fighter fits in a human envelope', `${(hi[0] - lo[0]).toFixed(2)} m wide`);

const owned = new Set(m.bone);
const rigged = owned.size > 1;
console.log(`     this is a ${rigged ? 'rigged fighter' : 'static prop (everything on the root bone)'}`);

if (rigged) {
  // Every bone that carries skin must actually own some. A limb with no
  // vertices bound to it is a limb that will not move — the failure that looks
  // like the character being partly paralysed.
  const missing = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const name = BONES[i][0];
    if (TIPS.has(name)) continue;
    if (!owned.has(i)) missing.push(name);
  }
  check(missing.length === 0, 'every bone drives some geometry', missing.join(',') || `${owned.size} bones used`);

  // Both halves have to be represented, or the character is skinned to one
  // side and folds up the first time it is posed.
  const counts = new Map();
  for (const b of m.bone) counts.set(b, (counts.get(b) || 0) + 1);
  const share = (name) => (counts.get(BONES.findIndex((b) => b[0] === name)) || 0) / n;
  for (const [l, r] of [['armL', 'armR'], ['thighL', 'thighR'], ['handL', 'handR']]) {
    const a = share(l), b = share(r);
    const bal = Math.min(a, b) / Math.max(a, b, 1e-9);
    check(bal > 0.45, `${l} and ${r} carry comparable geometry`, `${(bal * 100).toFixed(0)}% balanced`);
  }
} else {
  let allRoot = true;
  for (let i = 0; i < n; i++) if (m.wt[i * 2] < 0.999) allRoot = false;
  check(allRoot, 'a static prop rides the root bone rigidly');
}

// Feet, specifically. The fit invents nothing it can measure, but the toe joint
// was invented once and came out 9.9 cm against the rig's 16, so the warp scaled
// everything weighted to the foot by 1.6 and the fighter grew flippers. It did
// not fail any check, because nothing was checking the size of a foot.
{
  const feet = [[], []];
  for (let i = 0; i < n; i++) {
    if (m.pos[i * 3 + 1] > lo[1] + 0.16) continue;
    feet[m.pos[i * 3] > 0 ? 0 : 1].push(m.pos[i * 3 + 2]);
  }
  const lengths = feet.filter((f) => f.length > 30).map((f) => Math.max(...f) - Math.min(...f));
  const worst = lengths.length ? Math.max(...lengths) : 0;
  check(
    lengths.length === 2 && worst > 0.17 && worst < 0.34,
    'the feet are foot-sized',
    `${lengths.map((l) => (l * 100).toFixed(0) + 'cm').join(' / ') || 'not found'}`
  );
}

const mats = new Set(m.mat);
check(mats.has(0) && mats.has(1), 'the fighter has both skin and cloth on it',
  `materials present: ${[...mats].sort().join(',')}`);

console.log(`\n${(raw.length / 1024).toFixed(0)} KB on disk`);
console.log(fail ? `${fail} check(s) failed` : 'the bake is sound');
process.exit(fail ? 1 : 0);
