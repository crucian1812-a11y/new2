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
import { POSES } from '../src/game/poses.js';
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

const rows = [];
const seen = new Set();
for (const tr of TRANSITIONS) {
  const key = `${tr.from}>${tr.to}`;
  if (tr.from === tr.to || seen.has(key)) continue;
  seen.add(key);

  let worst = 0, at = 0, where = null, sunk = 0, sunkAt = 0, sunkWho = null;
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

    for (const role of ['A', 'B']) {
      for (const b of READ) {
        const m = rig.skel[role].world[BONE_INDEX[b]];
        const under = MAT_Y - 0.075 - m[13];
        if (under > sunk) { sunk = under; sunkAt = t; sunkWho = `${role}.${b}`; }
      }
    }
  }
  rows.push({ key, name: tr.name, worst, at, where, sunk, sunkAt, sunkWho });
}

rows.sort((a, b) => b.worst - a.worst);
let bad = 0, fails = 0;
for (const r of rows) {
  const flag = r.worst > LIMIT || r.sunk > 0.04;
  if (flag) bad++;
  if (r.worst > FAIL || r.sunk > 0.06) fails++;
  if (!ALL && !flag) continue;
  const line =
    `${flag ? '!' : ' '} ${r.key.padEnd(28)} worst ${(r.worst * 100).toFixed(0).padStart(3)}cm ` +
    `at t=${r.at.toFixed(2)}`;
  console.log(line);
  if (r.worst > LIMIT) console.log(`      · ${r.where}`);
  if (r.sunk > 0.04) {
    console.log(`      · ${r.sunkWho} ${(r.sunk * 100).toFixed(0)}cm under the mat at t=${r.sunkAt.toFixed(2)}`);
  }
}

const worstOverall = rows.length ? rows[0].worst : 0;
console.log(
  `\n${rows.length} transitions, worst moment ${(worstOverall * 100).toFixed(0)}cm — ` +
  (fails ? `${fails} too deep to ship` : bad ? `${bad} on the work list, none too deep` : 'all clean')
);
if (fails) process.exitCode = 1;
