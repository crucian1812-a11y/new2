// Does a pose sit on a seam of the grip solver?
//
// blend-check lists a third of its transitions with the deepest moment in the
// first or last few hundredths of the blend, where the arc is zero and no
// route or arc can reach. They were put down to the poses' own contact — a
// forearm held by the sleeve, eleven centimetres deep and declared. Probed a
// hundredth at a time, they are not that. OPEN_GUARD>MOUNT_X is 6 cm *at* the
// pose and 14 cm a ten-thousandth of the way out of it, because A's right
// forearm has moved thirty-two centimetres in between.
//
// The cause is the two-bone solve's choice of elbow (solveTwoBone in
// skeleton.js). It takes the candidate folded the pose's way when the pose's
// own fold, read across the solve plane, is over FOLD_SURE (sin 10°), and the
// nearer one below it — and where the two rules disagree, crossing the line
// swings the elbow to the other side of the shoulder–hand line. Open guard
// reads 0.186 at the pose against a line of 0.174. Anything moves it across:
// the arc swells in un-smoothstepped time (unsmooth in rig.js), whose slope
// is infinite at both ends, so a ten-thousandth of the blend already carries
// the shoulder six millimetres.
//
// So the pose that pose-check and pose-relax judge, at exactly t = 0, is on
// one branch, and every path out of it and every hold loop round it is on the
// other — which is what the game shows. Side control is the worst of it:
// B's left forearm 30–34 cm, at every transition in or out.
//
// This walks every blend end a thousandth of the way in and reports any bone
// that moves more than five centimetres doing it. Report only: it is the
// measurer for the next piece of work, not a line in the battery yet.
//
//   node bjj/tools/seam-check.mjs           ends with a jump, worst first
//   node bjj/tools/seam-check.mjs --poses   the same, summed by pose

import { PairRig } from '../src/game/rig.js';
import { Overlap } from '../src/game/collide.js';
import { BONES, BONE_INDEX } from '../src/render/skeleton.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { HOLD_LOOPS } from '../src/game/poses.js';

const BY_POSE = process.argv.includes('--poses');
const STEP = 0.001;
const LINE = 0.05;

const rig = new PairRig();
rig.live = false;
const overlap = new Overlap();

function sample(from, to, t) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(from, to, t, 0.016);
  const at = [];
  for (const role of ['A', 'B']) {
    for (const [name] of BONES) {
      const w = rig.skel[role].world[BONE_INDEX[name]];
      at.push([`${role}.${name}`, w[12], w[13], w[14]]);
    }
  }
  return { depth: overlap.measure(rig.skel.A, rig.skel.B).deepest, at };
}

function jump(a, b) {
  let most = 0, who = '';
  for (let i = 0; i < a.at.length; i++) {
    const d = Math.hypot(a.at[i][1] - b.at[i][1], a.at[i][2] - b.at[i][2], a.at[i][3] - b.at[i][3]);
    if (d > most) { most = d; who = a.at[i][0]; }
  }
  return { most, who };
}

const BLENDS = [
  ...TRANSITIONS.flatMap((tr) => visualEnds(tr).map((to) => [tr.from, to])),
  ...Object.entries(HOLD_LOOPS).flatMap(([pos, loop]) => loop.map((v) => [pos, v])),
];
const seen = new Set();
const rows = [];
for (const [from, to] of BLENDS) {
  const key = `${from}>${to}`;
  if (from === to || seen.has(key)) continue;
  seen.add(key);
  for (const [t0, t1, end] of [[0, STEP, from], [1, 1 - STEP, to]]) {
    const a = sample(from, to, t0), b = sample(from, to, t1);
    const j = jump(a, b);
    if (j.most > LINE) rows.push({ key, end, ...j, depth: a.depth, after: b.depth });
  }
}

const cm = (m) => (m * 100).toFixed(0).padStart(3);
rows.sort((a, b) => b.most - a.most);
if (BY_POSE) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.end}  ${r.who}`;
    const e = by.get(k) || { n: 0, most: 0 };
    e.n++; e.most = Math.max(e.most, r.most);
    by.set(k, e);
  }
  for (const [k, e] of [...by].sort((a, b) => b[1].most * b[1].n - a[1].most * a[1].n)) {
    console.log(`${cm(e.most)}cm  ${String(e.n).padStart(2)}×  ${k}`);
  }
} else {
  for (const r of rows) {
    console.log(`${cm(r.most)}cm  ${r.who.padEnd(14)} leaving ${r.end.padEnd(16)} ${r.key.padEnd(30)}` +
      ` depth ${cm(r.depth)} → ${cm(r.after)}cm`);
  }
}
console.log(`\n${rows.length} blend ends move a bone more than ${LINE * 100} cm in the first ${STEP * 1000}/1000 of the blend`);
