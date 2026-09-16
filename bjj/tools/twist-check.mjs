// The one rotation an elbow does not have.
//
// A player looked at an overhead frame of the mount and said the elbows are
// turned in a way a person's are not. They were, and nothing in the battery
// could have said so — on purpose, which is the part worth writing down.
//
// `joint-check` measures how far a joint is folded and deliberately refuses to
// measure which *way*, because its first two versions asked that question by
// comparing the bend against the upper bone's own X, and the upper bone's X
// depends on a roll nothing controls. That reasoning is sound and it closed the
// wrong door: the roll nobody controls is itself the fault.
//
// This measures the roll and only the roll: the relative rotation between two
// consecutive bones, about the lower bone's own length. At the elbow that
// quantity has a name — pronation, the radius turning over the ulna — and a
// person has about eighty-five degrees of it each way from neutral. At the knee
// there is almost none, maybe forty degrees with the knee bent and none with it
// straight. Nothing else about the pose enters into it, so there is no
// reference pose to be wrong about.
//
// Zero is this rig's bind pose, arms hanging with the palms turned in, which is
// roughly a person's neutral. That is the one assumption in the number.
//
//   node bjj/tools/twist-check.mjs           poses and blends, the summary
//   node bjj/tools/twist-check.mjs --all     every joint over the line
//   node bjj/tools/twist-check.mjs --no-ik   without the grips, to place blame
import { PairRig } from '../src/game/rig.js';
import { POSES, POSITION_IDS, HOLD_LOOPS } from '../src/game/poses.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { JUDGE_STEPS } from './grid.mjs';

const ALL = process.argv.includes('--all');
// The grips are inverse kinematics: they weld a hand to a lapel and are free to
// roll the forearm to get there, because until now nothing looked. Switching
// them off separates a pose that was authored wrong from a solver that is
// twisting it — the same switch joint-check carries, and for the same reason.
const NO_IK = process.argv.includes('--no-ik');

// What a person's forearm and shin actually do, in degrees off neutral.
const LIMIT = { fore: 85, shin: 40 };
// Where it stops being a work list and starts being visible. A forearm past a
// right angle beyond its limit is not pronation, it is a break.
const FAIL = { fore: 130, shin: 75 };

const PAIRS = [['armL', 'foreL'], ['armR', 'foreR'], ['thighL', 'shinL'], ['thighR', 'shinR']];
const limitOf = (lo) => (lo.startsWith('fore') ? LIMIT.fore : LIMIT.shin);
const failOf = (lo) => (lo.startsWith('fore') ? FAIL.fore : FAIL.shin);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
// The rotation part of a world matrix, as its three basis columns. A bone
// points down its own Y in this skeleton, so column 1 is the length.
const col = (m, i) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];

// Roll of the lower bone about its own length, against the upper bone.
//
// Both X axes are flattened onto the plane across that length and the angle
// between what is left is taken. Anything the two bones share — where the limb
// points, how far the joint is folded — lies along the axis and drops out.
function roll(mUp, mLo) {
  const axis = nrm(col(mLo, 1));
  const flat = (v) => nrm([v[0] - dot(v, axis) * axis[0], v[1] - dot(v, axis) * axis[1], v[2] - dot(v, axis) * axis[2]]);
  const a = flat(col(mUp, 0)), b = flat(col(mLo, 0));
  return (Math.atan2(dot(crs(a, b), axis), Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI;
}

const rig = new PairRig();
// The path, not a performance of it: the step planner and the inertia both
// depend on the frame before, and a sampled blend is not a frame before
// anything. The same line every other judge in this folder carries.
rig.live = false;
if (NO_IK) rig._grips = () => {};

const rows = [];
function look(id, kind, from, to, t) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(from, to, t, 0.016);
  for (const role of ['A', 'B']) {
    const sk = rig.skel[role];
    for (const [up, lo] of PAIRS) {
      const deg = roll(sk.world[BONE_INDEX[up]], sk.world[BONE_INDEX[lo]]);
      rows.push({ id, kind, role, joint: lo, deg, over: Math.abs(deg) - limitOf(lo), t });
    }
  }
}

for (const id of POSITION_IDS) look(id, 'pose', id, id, 1);
const seen = new Set();
for (const tr of TRANSITIONS) {
  for (const to of visualEnds(tr)) {
    const key = `${tr.from}>${to}`;
    if (tr.from === to || seen.has(key)) continue;
    seen.add(key);
    for (let i = 0; i < JUDGE_STEPS; i++) look(key, 'blend', tr.from, to, i / (JUDGE_STEPS - 1));
  }
}
for (const [pos, loop] of Object.entries(HOLD_LOOPS)) {
  for (const v of loop) {
    const key = `${pos}>${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let i = 0; i < JUDGE_STEPS; i++) look(key, 'hold', pos, v, i / (JUDGE_STEPS - 1));
  }
}

// One line per place, not per sample: a blend that rolls a forearm holds it
// rolled for a dozen samples and would otherwise fill the report by itself.
const worst = new Map();
for (const r of rows) {
  const k = `${r.id}|${r.role}.${r.joint}`;
  const was = worst.get(k);
  if (!was || r.over > was.over) worst.set(k, r);
}
const list = [...worst.values()].sort((a, b) => b.over - a.over);
const bad = list.filter((r) => r.over > 0);
const fails = list.filter((r) => Math.abs(r.deg) > failOf(r.joint));

for (const r of (ALL ? bad : bad.slice(0, 10))) {
  const at = r.kind === 'pose' ? '' : ` at t=${r.t.toFixed(2)}`;
  console.log(`${Math.abs(r.deg) > failOf(r.joint) ? '!' : ' '} ${r.id.padEnd(30)} ${(r.role + '.' + r.joint).padEnd(10)} ` +
    `${r.deg.toFixed(0).padStart(5)}°  (limit ${limitOf(r.joint)})${at}`);
}
if (!ALL && bad.length > 10) console.log(`  … and ${bad.length - 10} more, --all for every one`);

const poses = bad.filter((r) => r.kind === 'pose').length;
console.log();
console.log(`${bad.length} of ${worst.size} joints rolled past what a person can do` +
  `, ${poses} of them in a still pose`);
console.log(`worst ${list[0].deg.toFixed(0)}° on ${list[0].role}.${list[0].joint} in ${list[0].id}` +
  `${NO_IK ? '  (grips off)' : ''}`);
if (fails.length) {
  console.log(`\n${fails.length} past the line where it reads as a break` +
    ` (${FAIL.fore}° at the elbow, ${FAIL.shin}° at the knee)`);
  process.exitCode = 1;
} else {
  console.log('\nnothing is turned the wrong way round');
}
