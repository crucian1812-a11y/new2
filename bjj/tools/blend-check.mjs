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
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { readFileSync } from 'node:fs';
import { decodeFighter } from '../src/render/asset.js';
import { skinLite, skinInto } from './skin-lite.mjs';
import { Overlap } from '../src/game/collide.js';
import { JUDGE_STEPS } from './grid.mjs';

const ALL = process.argv.includes('--all');
// Forty-one samples, not thirteen.
//
// Thirteen was chosen because a blend is short and the deep part of it is
// broad. It is not: the deepest moment of a transition is often a single
// crossing a couple of hundredths of the blend wide, and a grid that coarse
// steps straight over it. Measured against a sixty-one point sweep, this file
// was under-reporting eight of the forty-three transitions by seven
// centimetres or more — TURTLE>STANDING said 7 cm and was 19 — and the worst
// moment in the whole graph was 25 cm while the summary line said 19.
//
// Worse, arc-solve searched on the same thirteen points, so the solver could
// and did push a collision into the gap between two of them and call it fixed:
// the mount's second hold loop came out of the solver three centimetres deeper
// than it went in, and both tools agreed it was clean.
//
// Different-sized grids do not fix that — tried, and the solver still came out
// five centimetres better than this file measured. The solver's grid has to be
// a *refinement* of this one, which is why both numbers live in grid.mjs and
// that file refuses to load if they stop lining up.
const STEPS = JUDGE_STEPS;
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
// And two more for the other direction.
//
// Everything above measures bodies going *into* each other, and `sunk`
// measures them going into the mat. Nothing measured them coming off it, and
// that is a gap the solver can walk through: arc-solve is asked to stop two
// tangles intersecting, and pulling the pair straight up is a perfectly good
// answer to that question. Twelve transitions took it — the worst lifts the
// whole pair twenty-four centimetres, which on screen is two men fighting a
// hand's breadth above the tatami with their shadow lying underneath them.
//
// The baseline is the straight line between the two endpoints' own heights,
// not the mat: a transition that ends standing is meant to rise, and asking it
// not to would be asking the wrong question. What this measures is what the
// correction *added* on top — the same shape as the correction itself, zero at
// both ends.
// Through the mat, on the skin: where it goes on the work list and where it
// stops being shippable. The first number is judgement — a body pressing into
// foam is not a body through the floor — and the second is written after the
// measurement rather than before it, the way shake-check's was: it sits just
// above where the library stands the day the measure was written, so it can
// only ever come down. It opened with a third of the graph on the list.
const SUNK_LIMIT = 0.06;
const SUNK_FAIL = 0.32;
const LIFT_LIMIT = 0.06;
const LIFT_FAIL = 0.12;

const rig = new PairRig();
// Measuring the path, not a performance of it: the step planner and the
// inertia both depend on the frame before, and stepping a transition in
// forty-one jumps is not a frame before anything.
rig.live = false;
const overlap = new Overlap();
const READ = ['headTop', 'handL', 'handR', 'footL', 'footR', 'hips', 'chest'];
// Through the mat, measured on the skin rather than on a list of bones.
//
// This used to ask seven bones whether any of them was more than seven and a
// half centimetres below the mat — a blanket allowance standing in for "how far
// the skin hangs below a bone", and a list with no knee in it. The knee is the
// shin bone's own origin and it is what half this sport puts on the floor, and
// its skin hangs to the ankle, so the one part most likely to be through the
// tatami was the one part the measure could not see. Measured properly: a third
// of the graph puts skin more than six centimetres under, and the worst of them
// buries a whole shin — 29 cm at the middle of OPEN_GUARD>SIDE_CONTROL.
//
// It reads tools/skin-lite.mjs, the same subset pose-relax solves against:
// eighty-one blends at thirty-three samples is affordable on four thousand
// vertices and is not on eleven thousand.
const loadMesh = (name) => {
  const raw = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  return decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
};
const LITE = { A: skinLite(loadMesh('fighter.bin')), B: skinLite(loadMesh('fighter-b.bin')) };
const MAXV = Math.max(LITE.A.pos.length, LITE.B.pos.length) / 3;
const _xyz = new Float64Array(MAXV * 3), _who = new Uint16Array(MAXV);
// Either baked man can be in either role and they differ by three and a half
// centimetres at the point that touches the mat, so this judges the one that
// sits *higher* — the same rule weight-check and seat-solve use.
function skinUnder(sk) {
  let best = -9;
  for (const mk of ['A', 'B']) {
    const n = skinInto(LITE[mk], sk, _xyz, _who);
    let lo = 9;
    for (let v = 0; v < n; v++) if (_xyz[v * 3 + 1] < lo) lo = _xyz[v * 3 + 1];
    if (lo > best) best = lo;
  }
  return MAT_Y - best;
}
// What can be the lowest thing on a grappler. Not the same list as READ: the
// top of the head is never the part touching the mat, and the knees — which
// are the shin bones' own origins — carry half the positions in this game.
const LOW = ['handL', 'handR', 'footL', 'footR', 'hips', 'shinL', 'shinR', 'chest', 'head'];

// Everything the rig ever slerps through: the graph's transitions, and the
// loops a held position runs while it is held. The loops are shorter and
// gentler, and they are also on screen for three quarters of the match, so a
// bad moment in one is worth more than a bad moment in a transition.
const BLENDS = [
  // `visualTo`, not `to`: a sweep blends to the mirror of its destination, and
  // that is the path the eye is on, so that is the path to judge.
  ...TRANSITIONS.flatMap((tr) => visualEnds(tr).map(
    (to) => ({ from: tr.from, to, name: tr.name, kind: 'transition' }))),
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
  const low = new Array(STEPS);
  for (let i = 0; i < STEPS; i++) {
    const t = i / (STEPS - 1);
    // Fresh every sample: the rig integrates breathing off its own clock, and
    // a measurement that depends on how many frames came before it is not a
    // measurement.
    rig.effort.A = rig.effort.B = 0;
    rig.slack.A = rig.slack.B = 0;
    rig.rewind();
    rig.applyAt(tr.from, tr.to, t, 0.016);

    const ov = overlap.measure(rig.skel.A, rig.skel.B);
    if (ov.deepest > worst) { worst = ov.deepest; at = t; where = ov.where; }
    if (i === 0 || i === STEPS - 1) ends = Math.max(ends, ov.deepest);

    for (const role of ['A', 'B']) {
      const under = skinUnder(rig.skel[role]);
      if (under > sunk) { sunk = under; sunkAt = t; sunkWho = role; }
    }
    let lo = Infinity;
    for (const role of ['A', 'B']) {
      for (const b of LOW) lo = Math.min(lo, rig.skel[role].world[BONE_INDEX[b]][13]);
    }
    low[i] = lo;
  }
  // How far the pair came off the mat, over and above the straight line
  // between where it sits at either end.
  let lift = 0, liftAt = 0;
  for (let i = 1; i < STEPS - 1; i++) {
    const t = i / (STEPS - 1);
    const base = low[0] * (1 - t) + low[STEPS - 1] * t;
    if (low[i] - base > lift) { lift = low[i] - base; liftAt = t; }
  }
  rows.push({ key, name: tr.name, kind: tr.kind, worst, at, where, sunk, sunkAt, sunkWho, ends, lift, liftAt });
}

rows.sort((a, b) => b.worst - a.worst);
const bad = { hold: 0, move: 0 }, fails = { hold: 0, move: 0 };
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
  const flag = r.worst > limit || r.sunk > SUNK_LIMIT || r.lift > LIFT_LIMIT;
  const bucket = r.kind === 'hold' ? 'hold' : 'move';
  if (flag) bad[bucket]++;
  if (r.worst > fail || r.sunk > SUNK_FAIL || r.lift > LIFT_FAIL) fails[bucket]++;
  if (!ALL && !flag) continue;
  const line =
    `${flag ? '!' : ' '} ${r.key.padEnd(28)} worst ${(r.worst * 100).toFixed(0).padStart(3)}cm ` +
    `at t=${r.at.toFixed(2)}`;
  console.log(line);
  if (r.worst > limit) console.log(`      · ${r.where}`);
  if (r.sunk > SUNK_LIMIT) {
    console.log(`      · ${r.sunkWho} ${(r.sunk * 100).toFixed(0)}cm under the mat at t=${r.sunkAt.toFixed(2)}`);
  }
  if (r.lift > LIFT_LIMIT) {
    console.log(`      · the pair is ${(r.lift * 100).toFixed(0)}cm off the mat at t=${r.liftAt.toFixed(2)}`);
  }
}

const worstOverall = rows.length ? rows[0].worst : 0;
const holds = rows.filter((r) => r.kind === 'hold');
const worstHold = holds.reduce((m, r) => Math.max(m, r.worst), 0);
const overEnds = holds.reduce((m, r) => Math.max(m, r.worst - r.ends), 0);
// Two counts, two lines. They were one, and a run with five unsolved hold
// loops in it reported "43 transitions — 5 too deep to ship" while every
// transition in the list was fine.
const verdict = (n, f, b) =>
  f ? `${f} too deep to ship` : b ? `${b} on the work list, none too deep` : 'all clean';
console.log(
  `\n${holds.length} hold loops, worst moment ${(worstHold * 100).toFixed(0)}cm — ` +
  `${(overEnds * 100).toFixed(0)}cm deeper than the poses they run between, ` +
  verdict(holds.length, fails.hold, bad.hold)
);
console.log(
  `${rows.length - holds.length} transitions, worst moment ${(worstOverall * 100).toFixed(0)}cm — ` +
  verdict(rows.length - holds.length, fails.move, bad.move)
);
const worstSunk = rows.reduce((m, r) => Math.max(m, r.sunk), 0);
const inMat = rows.filter((r) => r.sunk > SUNK_LIMIT).length;
console.log(
  `through the mat: worst ${(worstSunk * 100).toFixed(0)}cm of skin, ${inMat} of ${rows.length} blends over ` +
  `${(SUNK_LIMIT * 100).toFixed(0)}cm`
);
const worstLift = rows.reduce((m, r) => Math.max(m, r.lift), 0);
const offMat = rows.filter((r) => r.lift > LIFT_LIMIT).length;
console.log(
  `off the mat: worst ${(worstLift * 100).toFixed(0)}cm, ${offMat} of ${rows.length} blends over ` +
  `${(LIFT_LIMIT * 100).toFixed(0)}cm`
);
if (fails.hold + fails.move) process.exitCode = 1;
