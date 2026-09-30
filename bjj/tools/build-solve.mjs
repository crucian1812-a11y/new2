// How heavy and how light a man the pose library can hold.
//
// A build (src/render/build.js) scales each part of a man across its bone —
// the trunk in width and in depth, the neck, and each segment of each limb —
// and leaves the skeleton alone, because the poses are paired and the
// skeleton is what they are paired on. That makes a weight class possible and
// it makes it cost something: every pose in the library has two men in
// contact, and a thicker pair is deeper inside each other in every one of
// them, and lower into the mat wherever they lie on it. A thinner pair floats:
// the grips are held off a chest that is no longer there and the back of a man
// in guard is off the tatami.
//
// So the two ends of the scale are solved here, not chosen. A build is judged
// on everything the library does — every pose held, every transition and every
// hold loop at blend-check's own eighty-one samples — by how much it *moves*
// the two things a player can see: every contact between the two men — each
// one on its own, how much deeper it goes, or for parts that were touching,
// how far apart they come — and the lowest point of skin under each of them. Both men wear the build,
// because a tournament is fought inside one weight class and that is the worst
// case the class has. Each end is grown one part at a time, always the part
// that buys the most body for the least depth, until nothing more fits under
// BUILD_COST.
//
// «Body» is volume: a capsule's cross-section times its length, which is why
// the belly and the thighs go first and the forearms last — a forearm is thin,
// it is round a neck in half the library, and it costs depth for almost no
// weight.
//
//   node bjj/tools/build-solve.mjs           report
//   node bjj/tools/build-solve.mjs --write   and write src/game/build-room.js
//   node bjj/tools/build-solve.mjs --check   re-measure the table as written

import { readFileSync, writeFileSync } from 'node:fs';
import { PairRig } from '../src/game/rig.js';
import { POSES, HOLD_LOOPS } from '../src/game/poses.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap, CAPSULES } from '../src/game/collide.js';
import { decodeFighter } from '../src/render/asset.js';
import { REGIONS, BASE_BUILD, shapeMesh, capsuleScale } from '../src/render/build.js';
import { skinLite } from './skin-lite.mjs';
import { JUDGE_STEPS } from './grid.mjs';

const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');
// What a build may move either number by, in metres. The base lean may add a
// centimetre (tools/base-room.mjs); a weight class is a bigger thing to show
// and is allowed half as much again — and it is a change of the man, not a
// change of the moment, so it is paid in every frame rather than while the
// thumb is down.
export const BUILD_COST = 0.015;
const STEP = 0.005;
// And no part past a quarter either way, whatever the library would let
// through: past that it is not a weight class, it is a different species.
const BOUND = [0.75, 1.3];
const MAT_Y = 0.05;
// A man counts as on the mat where his lowest skin is within this of it.
const ON_MAT = 0.04;
// Skin within this of a man's lowest point is what can become the lowest
// point under a build; nothing moves further than a build is allowed to.
const NEAR_LOW = 0.06;

const rig = new PairRig();
rig.live = false;

// Every moment to judge: the poses held, and every blend the rig runs.
const moments = [];
for (const id of Object.keys(POSES)) moments.push([id, id, 1]);
const seen = new Set();
const BLENDS = [
  ...TRANSITIONS.flatMap((tr) => visualEnds(tr).map((to) => [tr.from, to])),
  ...Object.entries(HOLD_LOOPS).flatMap(([pos, loop]) => loop.map((v) => [pos, v])),
];
for (const [from, to] of BLENDS) {
  const key = `${from}>${to}`;
  if (from === to || seen.has(key)) continue;
  seen.add(key);
  for (let i = 0; i < JUDGE_STEPS; i++) moments.push([from, to, i / (JUDGE_STEPS - 1)]);
}

// The rig's answer at each, kept: a build does not move a bone, so the
// skeletons are the same for every candidate and are posed once.
const snap = (sk) => ({
  world: sk.world.map((m) => Float32Array.from(m)),
  skin: Float32Array.from(sk.skin),
});
const frames = moments.map(([from, to, t]) => {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(from, to, t, 0.016);
  return { A: snap(rig.skel.A), B: snap(rig.skel.B) };
});

// Both baked men, because either can be in either role.
const loadMesh = (name) => {
  const raw = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  return decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
};
const LITES = ['fighter.bin', 'fighter-b.bin'].map((f) => {
  const l = skinLite(loadMesh(f));
  return { ...l, nrm: new Float32Array(l.pos.length) };
});

function skinY(lite, pos, skin, v) {
  let y = 0;
  for (let k = 0; k < 4; k++) {
    const w = lite.wt[v * 4 + k];
    if (w <= 0) continue;
    const o = lite.bone[v * 4 + k] * 16;
    y += w * (skin[o + 1] * pos[v * 3] + skin[o + 5] * pos[v * 3 + 1] + skin[o + 9] * pos[v * 3 + 2] + skin[o + 13]);
  }
  return y;
}

// The baseline, and for every man on the mat the few vertices that could be
// his lowest under any build.
const overlap = new Overlap();
const T0 = performance.now();
const NP = CAPSULES.length * CAPSULES.length;
const _pens = new Float32Array(NP);
const base = frames.map((f) => {
  const deep = Float32Array.from(overlap.pens(f.A, f.B, _pens));
  const low = [];
  for (const role of ['A', 'B']) {
    for (let li = 0; li < LITES.length; li++) {
      const lite = LITES[li];
      const n = lite.pos.length / 3;
      const ys = new Float32Array(n);
      let lo = Infinity;
      for (let v = 0; v < n; v++) { ys[v] = skinY(lite, lite.pos, f[role].skin, v); if (ys[v] < lo) lo = ys[v]; }
      if (lo > MAT_Y + ON_MAT) continue;
      const near = [];
      for (let v = 0; v < n; v++) if (ys[v] < lo + NEAR_LOW) near.push(v);
      low.push({ role, li, lo, near });
    }
  }
  return { deep, low };
});

// What a build costs: the most it moves either number, anywhere.
function cost(build, why = false) {
  overlap.setBuild(0, build).setBuild(1, build);
  const shaped = LITES.map((l) => shapeMesh(l, build).pos);
  let worst = 0, at = -1, kind = '';
  for (let i = 0; i < frames.length; i++) {
    // Each contact on its own: how much deeper it went, or — for two parts
    // that were touching — how far apart they came.
    const was = base[i].deep, now = overlap.pens(frames[i].A, frames[i].B, _pens);
    for (let k = 0; k < NP; k++) {
      const d = now[k] > 0 ? now[k] - Math.max(0, was[k]) : was[k] >= 0 ? -now[k] : 0;
      if (d > worst) { worst = d; at = i; kind = `contact ${CAPSULES[(k / CAPSULES.length) | 0][0]}–${CAPSULES[k % CAPSULES.length][0]}`; }
    }
    for (const L of base[i].low) {
      let lo = Infinity;
      const pos = shaped[L.li], skin = frames[i][L.role].skin;
      for (const v of L.near) { const y = skinY(LITES[L.li], pos, skin, v); if (y < lo) lo = y; }
      const s = Math.abs(lo - L.lo);
      if (s > worst) { worst = s; at = i; kind = `mat, ${L.role}`; }
    }
  }
  overlap.setBuild(0, null).setBuild(1, null);
  if (!why) return worst;
  const [from, to, t] = moments[at] || ['-', '-', 0];
  return { worst, where: from === to ? `${from} (${kind})` : `${from}>${to} at t=${t.toFixed(2)} (${kind})` };
}

// How much of a man a build adds, as a fraction of the baked man's volume.
const PART_VOL = (() => {
  const out = {};
  let total = 0;
  const rest = frames[0];   // any posed skeleton will do for the lengths
  for (const [a, b, r0, r1, z0, z1] of CAPSULES) {
    const ma = rest.A.world[BONE_INDEX[a]], mb = rest.A.world[BONE_INDEX[b]];
    const len = Math.hypot(mb[12] - ma[12], mb[13] - ma[13], mb[14] - ma[14]);
    const r = (r0 + r1) / 2, z = (z0 + z1) / 2;
    const vol = Math.PI * r * r * z * len;
    total += vol;
    out[a] = vol;
  }
  for (const k of Object.keys(out)) out[k] /= total;
  return out;
})();
function mass(build) {
  let m = 0;
  for (const [a, share] of Object.entries(PART_VOL)) {
    const [sw, sd] = capsuleScale(build, a);
    m += share * (sw * sd - 1);
  }
  return m;
}

// Coarse steps first and the fine one last: the cost is a maximum over six
// thousand moments and has no gradient to follow, and a greedy walk in steps
// of half a per cent from one is a thousand evaluations.
function solve(sign) {
  const b = { ...BASE_BUILD };
  let c = 0;
  for (const step of [STEP * 4, STEP * 2, STEP]) for (;;) {
    let best = null;
    for (const r of REGIONS) {
      const v = b[r] + sign * step;
      if (v < BOUND[0] || v > BOUND[1]) continue;
      const trial = { ...b, [r]: v };
      const tc = cost(trial);
      if (tc > BUILD_COST) continue;
      const gain = Math.abs(mass(trial) - mass(b));
      const score = gain / Math.max(1e-4, tc - c);
      if (!best || score > best.score) best = { r, v, tc, score };
    }
    if (!best) break;
    b[best.r] = +best.v.toFixed(4);
    c = best.tc;
  }
  return b;
}

const fmt = (b) => REGIONS.map((r) => `${r} ${b[r].toFixed(3)}`).join('  ');
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

console.log(`${frames.length} moments judged, ${base.reduce((n, b) => n + b.low.length, 0)} of them men on the mat, ` +
  `${base.reduce((n, b) => n + b.low.reduce((m, l) => m + l.near.length, 0), 0)} vertices near the mat ` +
  `(${((performance.now() - T0) / 1000).toFixed(1)}s)`);
if (process.argv.includes('--profile')) {
  let t = performance.now(); cost({ ...BASE_BUILD, trunkW: 1.05 });
  console.log(`one cost: ${((performance.now() - t) / 1000).toFixed(2)}s`);
  process.exit(0);
}

if (CHECK) {
  const { BUILD_ROOM } = await import('../src/game/build-room.js');
  let bad = 0;
  for (const end of ['heavy', 'light']) {
    const b = BUILD_ROOM[end];
    const c = cost(b, true);
    const ok = c.worst <= BUILD_COST + 1e-4;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${end.padEnd(5)} ${pct(mass(b))} of a man, moves the picture ` +
      `${(c.worst * 100).toFixed(1)}cm (line ${(BUILD_COST * 100).toFixed(1)}) — ${c.where}`);
  }
  if (bad) process.exitCode = 1;
} else {
  const heavy = solve(+1);
  const hc = cost(heavy, true);
  console.log(`heavy  ${fmt(heavy)}\n       ${pct(mass(heavy))} of a man, costs ${(hc.worst * 100).toFixed(1)}cm at ${hc.where}`);
  const light = solve(-1);
  const lc = cost(light, true);
  console.log(`light  ${fmt(light)}\n       ${pct(mass(light))} of a man, costs ${(lc.worst * 100).toFixed(1)}cm at ${lc.where}`);
  if (WRITE) {
    const row = (b) => `{ ${REGIONS.map((r) => `${r}: ${b[r]}`).join(', ')} }`;
    writeFileSync(new URL('../src/game/build-room.js', import.meta.url),
`// Generated by tools/build-solve.mjs — do not edit by hand.
//
// The heaviest and the lightest build the pose library holds with both men
// wearing it: no more than ${(BUILD_COST * 100).toFixed(1)} cm added to or taken from the deepest
// contact between them, or to how far either is into the mat, in any pose or
// at any of blend-check's samples of any blend. See src/render/build.js.
//
//   heavy ${pct(mass(heavy))} of a man, light ${pct(mass(light))}
export const BUILD_ROOM = {
  heavy: ${row(heavy)},
  light: ${row(light)},
};
`);
    console.log('wrote src/game/build-room.js');
  }
}
