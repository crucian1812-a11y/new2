// The middle of a transition.
//
// pose-check looks at fifteen poses. The game spends a good part of its time
// somewhere else: on the straight line between two of them. A slerp between two
// valid tangles runs through invalid ones — halfway from closed guard to a
// sweep, an arm can be inside a ribcage — and no amount of work on either
// endpoint fixes it, because neither endpoint is wrong.
//
// The rig already eases the pair apart across the middle of a blend for exactly
// this reason. What it did not have was a way to tell whether that was enough.
// This walks every transition in the position graph, samples it, and reports
// the worst moment of each.
//
//   node bjj/tools/blend-check.mjs          the summary
//   node bjj/tools/blend-check.mjs --all    every transition, worst first

import { PairRig } from '../src/game/rig.js';
import { POSES, HOLD_LOOPS } from '../src/game/poses.js';
import { TRANSITIONS } from '../src/game/positions.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';

const ALL = process.argv.includes('--all');
const STEPS = 13;
const MAT_Y = 0.05;
// Two thresholds, because a moment in flight is not a pose.
//
// A pose is held for seconds and eight centimetres is the line. A transition
// runs in half a second, so its worst region lasts something like a tenth of
// one, and a thigh pressed that far into a hip for a tenth of a second reads as
// weight rather than as a glitch. So: report anything over eleven centimetres,
// because that is the work list, but only fail over twenty-two, because that is
// where it starts being seen.
const LIMIT = 0.11;
const FAIL = 0.22;

const rig = new PairRig();
const overlap = new Overlap();
const READ = ['headTop', 'handL', 'handR', 'footL', 'footR', 'hips', 'chest'];

// Everything the rig ever slerps through: the graph's transitions, and the
// loops a held position runs while it is held. The loops are shorter and
// gentler, and they are also on screen for three quarters of the match, so a
// bad moment in one is worth more than a bad moment in a transition.
const BLENDS = [
  ...TRANSITIONS.map((tr) => ({ from: tr.from, to: tr.to, name: tr.name, kind: 'transition' })),
  ...Object.entries(HOLD_LOOPS).flatMap(([pos, loop]) =>
    loop.map((v) => ({ from: pos, to: v, name: POSES[v].name, kind: 'hold' }))),
];

const rows = [];
const seen = new Set();
for (const tr of BLENDS) {
  const key = `${tr.from}>${tr.to}`;
  if (tr.from === tr.to || seen.has(key)) continue;
  seen.add(key);

  let worst = 0, at = 0, where = null, sunk = 0, sunkAt = 0, sunkWho = null, ends = 0;
  for (let i = 0; i < STEPS; i++) {
    const t = i / (STEPS - 1);
    // Fresh every sample: the rig integrates breathing off its own clock, and
    // a measurement that depends on how many frames came before it is not a
    // measurement.
    rig.effort.A = rig.effort.B = 0;
    rig.slack.A = rig.slack.B = 0;
    rig.time = 0;
    rig.apply(tr.from, tr.to, t, 0.016);

    const ov = overlap.measure(rig.skel.A, rig.skel.B);
    if (ov.deepest > worst) { worst = ov.deepest; at = t; where = ov.where; }
    if (i === 0 || i === STEPS - 1) ends = Math.max(ends, ov.deepest);

    for (const role of ['A', 'B']) {
      for (const b of READ) {
        const m = rig.skel[role].world[BONE_INDEX[b]];
        const under = MAT_Y - 0.075 - m[13];
        if (under > sunk) { sunk = under; sunkAt = t; sunkWho = `${role}.${b}`; }
      }
    }
  }
  rows.push({ key, name: tr.name, kind: tr.kind, worst, at, where, sunk, sunkAt, sunkWho, ends });
}

rows.sort((a, b) => b.worst - a.worst);
let bad = 0, fails = 0;
for (const r of rows) {
  // A hold is judged against its own ends, not against a number.
  //
  // It is on screen for as long as the position lasts, so a moment in it is
  // seen the way a pose is seen — but both of its ends are poses that already
  // passed pose-check, and some of them sit at eight centimetres because a
  // forearm wrapped round a throat reads as overlap and always will. The
  // question worth asking of the path between them is whether it introduces
  // anything the two poses do not already have.
  const limit = r.kind === 'hold' ? r.ends + 0.02 : LIMIT;
  const fail = r.kind === 'hold' ? r.ends + 0.03 : FAIL;
  const flag = r.worst > limit || r.sunk > 0.04;
  if (flag) bad++;
  if (r.worst > fail || r.sunk > 0.06) fails++;
  if (!ALL && !flag) continue;
  const line =
    `${flag ? '!' : ' '} ${r.key.padEnd(28)} worst ${(r.worst * 100).toFixed(0).padStart(3)}cm ` +
    `at t=${r.at.toFixed(2)}`;
  console.log(line);
  if (r.worst > limit) console.log(`      · ${r.where}`);
  if (r.sunk > 0.04) {
    console.log(`      · ${r.sunkWho} ${(r.sunk * 100).toFixed(0)}cm under the mat at t=${r.sunkAt.toFixed(2)}`);
  }
}

const worstOverall = rows.length ? rows[0].worst : 0;
const holds = rows.filter((r) => r.kind === 'hold');
const worstHold = holds.reduce((m, r) => Math.max(m, r.worst), 0);
const overEnds = holds.reduce((m, r) => Math.max(m, r.worst - r.ends), 0);
console.log(
  `\n${holds.length} hold loops, worst moment ${(worstHold * 100).toFixed(0)}cm — ` +
  `${(overEnds * 100).toFixed(0)}cm deeper than the poses they run between`
);
console.log(
  `${rows.length - holds.length} transitions, worst moment ${(worstOverall * 100).toFixed(0)}cm — ` +
  (fails ? `${fails} too deep to ship` : bad ? `${bad} on the work list, none too deep` : 'all clean')
);
if (fails) process.exitCode = 1;
