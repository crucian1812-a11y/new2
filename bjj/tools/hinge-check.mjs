// Do the knees and elbows bend the way a knee and an elbow bend?
//
// joint-check asks how far a joint is folded, and twist-check how far the
// lower bone is rolled about its own length. Neither asks which *way* it is
// folded, and a player named it: the legs in the techniques are often bent
// unnaturally, and the arms too. They were. Read in the upper bone's own frame
// — which is the frame the skin is carried in, so it is the frame the eye
// reads a kneecap and the crook of an elbow in — a fifth of the samples had a
// forearm folded backwards against its own upper arm, some by more than a
// right angle, and a third had a knee bent sideways, by up to 74°. The rig now
// turns the upper bones so they fold the way they fold (swivelHinges), as far
// as the hip and the shoulder turn.
//
// joint-check's first versions were abandoned for asking this, on the grounds
// that the upper bone's roll is uncontrolled and invisible on a capsule. The
// fighters are skinned meshes now: the roll is exactly what the skin shows,
// and an uncontrolled roll is the fault rather than a reason not to look.
//
// Each joint is read as where the lower bone points, seen from the upper one:
//
//   сгиб    forward or back in the upper bone's own plane — a knee folds its
//           shin back, an elbow its forearm forward, and neither goes more
//           than a little past straight the other way
//   вбок    out of that plane: a knee has almost none, an elbow its carrying
//           angle and a little more
//   поворот the upper bone turned about its own length: a hip turns about 45°
//           either way, a shoulder about 90
//
// Zero is the bind pose: legs straight down, arms hanging with the palms in.
// The signs are read off the standing position, whose knees and elbows are
// unambiguously bent: knees at -30, elbows at +84.
//
// The lines are a ratchet rather than a pass: see NOW below.
//
//   node bjj/tools/hinge-check.mjs           poses and blends
//   node bjj/tools/hinge-check.mjs --all     the worst of each, by pose
//   node bjj/tools/hinge-check.mjs --poses   poses only, which is quick

import { PairRig } from '../src/game/rig.js';
import { POSES, HOLD_LOOPS } from '../src/game/poses.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { JUDGE_STEPS } from './grid.mjs';
import { readLimbs, HIP_TURN, SHOULDER_TURN, KNEE_BACK, KNEE_SIDE, ELBOW_BACK, ELBOW_SIDE } from './limbs.mjs';

const ALL = process.argv.includes('--all');
const POSES_ONLY = process.argv.includes('--poses');


const rig = new PairRig();
rig.live = false;
const rows = [];
function sample(what) {
  for (const role of ['A', 'B']) {
    for (const r of readLimbs(rig.skel[role])) rows.push({ what, role, ...r });
  }
}
for (const id of Object.keys(POSES)) {
  if (POSES[id].refereeOnly) continue;
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(id, id, 1, 0.016);
  sample(id);
}
if (!POSES_ONLY) {
  const seen = new Set();
  const BLENDS = [
    ...TRANSITIONS.flatMap((tr) => visualEnds(tr).map((to) => [tr.from, to])),
    ...Object.entries(HOLD_LOOPS).flatMap(([pos, loop]) => loop.map((v) => [pos, v])),
  ];
  for (const [from, to] of BLENDS) {
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    for (let i = 1; i < JUDGE_STEPS - 1; i++) {
      const t = i / (JUDGE_STEPS - 1);
      rig.effort.A = rig.effort.B = 0;
      rig.slack.A = rig.slack.B = 0;
      rig.rewind();
      rig.applyAt(from, to, t, 0.016);
      sample(`${key} @${t.toFixed(2)}`);
    }
  }
}

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const who = (r) => `${r.n}${r.s} of ${r.role} in ${r.what}`;
// Where the library stands, poses and blends together, once the rig began
// turning upper bones so knees and elbows fold the way they fold
// (swivelHinges). What is left is where a pose or a blend has put a knee or an
// elbow somewhere the hip or the shoulder cannot turn it to, and that is the
// pose's to fix, offline, with pose-relax and the arcs together (LIMB_W; see
// PLAN.md). Until then a line may not get worse than this, with 5% for the
// noise a re-solved arc brings. Was, before the rig turned anything: knees
// sideways 7847, elbows backwards 5178, elbows sideways 10138, hips 1094,
// shoulders 972. Poses only: all zero but hips 36 and shoulders 98.
// The one knee folded forwards is a single frame of KNEE_ON_BELLY>ARMBAR at
// t=0.46, where the leg's own solve flips the knee to the other side of the
// hip-to-ankle line; before the rig turned anything that knee was folded
// forwards, and 73° sideways, from t=0.40 to 0.48.
const NOW = { 'knee-back': 1, 'knee-side': 2103, 'elbow-back': 1372, 'elbow-side': 3718, 'hip-turn': 1093, 'shoulder-turn': 948 };
function judge(label, joint, bad, say, key) {
  const over = rows.filter((r) => r.n === joint && bad(r));
  const worst = over.sort((a, b) => say(b) - say(a))[0];
  const n = rows.filter((r) => r.n === joint).length;
  const cap = POSES_ONLY ? Infinity : Math.floor(NOW[key] * 1.05 + 0.5);
  check(over.length <= cap, label, worst
    ? `${over.length} of ${n} samples, worst ${say(worst).toFixed(0)}° over (${who(worst)}); ` +
      `${POSES_ONLY ? 'poses only' : `no more than ${cap}`}`
    : `all ${n} samples`);
  if (ALL && over.length) {
    const by = new Map();
    for (const r of over) {
      const k = `${r.n}${r.s} of ${r.role} in ${r.what.split(' @')[0]}`;
      by.set(k, Math.max(by.get(k) || 0, say(r)));
    }
    for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP || 15))) console.log(`       ${v.toFixed(0).padStart(4)}°  ${k}`);
  }
}
console.log(`     ${rows.length / 16} bodies, ${POSES_ONLY ? 'poses only' : 'poses and blends'}\n`);
judge('колено: folds its shin back, not forward', 'knee', (r) => r.fwd > KNEE_BACK, (r) => r.fwd - KNEE_BACK, 'knee-back');
judge('колено: and not sideways', 'knee', (r) => Math.abs(r.out) > KNEE_SIDE, (r) => Math.abs(r.out) - KNEE_SIDE, 'knee-side');
judge('локоть: folds its forearm forward, not back', 'elbow', (r) => r.fwd < -ELBOW_BACK, (r) => -r.fwd - ELBOW_BACK, 'elbow-back');
judge('локоть: and not far sideways', 'elbow', (r) => Math.abs(r.out) > ELBOW_SIDE, (r) => Math.abs(r.out) - ELBOW_SIDE, 'elbow-side');
judge('бедро: turned no further than a hip turns', 'hip', (r) => Math.abs(r.turn) > HIP_TURN, (r) => Math.abs(r.turn) - HIP_TURN, 'hip-turn');
judge('плечо: turned no further than a shoulder turns', 'shoulder', (r) => Math.abs(r.turn) > SHOULDER_TURN, (r) => Math.abs(r.turn) - SHOULDER_TURN, 'shoulder-turn');
console.log(fail ? `\n${fail} check(s) failed` : '\nno worse than it was; the rest is the work list');
process.exitCode = fail ? 1 : 0;
