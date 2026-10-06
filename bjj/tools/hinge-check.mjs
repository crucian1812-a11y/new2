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
// Where the library stands, poses and blends together. Was, before the rig
// turned anything: knees sideways 7847, elbows backwards 5178, elbows sideways
// 10138, hips 1094, shoulders 972, knees forwards 119. Once the rig turned
// upper bones so knees and elbows fold the way they fold (swivelHinges):
// 2103, 1372, 3718, 1093, 948, 1. Then the grips were made to fold an elbow
// the pose's way rather than the nearer way (solveTwoBone), the arms that hold
// grips were put on them where that was worth it (pose-relax --bake-grips) and
// the arcs were re-solved with the limbs as a tie-break rather than the main
// term: the numbers below. The poses on their own are all zero but seven knee
// samples (MOUNT_WORK's top man, 57° sideways) and a few hips and shoulders a
// handful of degrees over. Then the foot on the mat was solved in the thigh's
// own plane (rig._ground) and everything was re-solved again: knees sideways
// 433 → 72 and shoulders 725 → 617, for elbows sideways 98 → 130 and one
// elbow sample 6° backwards, in HALF_GUARD>OPEN_GUARD's new route. Then a hand
// changing holds was made to travel between them rather than switch at the
// midpoint (rig collect/alt), which alone took elbows sideways to 187, and the
// arcs were re-solved against blend-check's refined walk: knees 64, elbows
// sideways 124 and backwards 0, hips 93; shoulders came back at 642, inside
// their 5% but not under 617, so that line stays where it was. What is
// left is mostly in the blends, and a line may not get worse than this, with
// 5% for the noise a re-solved arc brings. Then the poses that sat on a seam
// of the grip solve had the limb the rig builds written into them
// (seam-bake.mjs), the arcs through them were re-solved and two thighs were
// turned by a measured six degrees: knees sideways 59, elbows sideways 45,
// hips 82, shoulders 215 — the shoulders' first real move since the rig began
// turning them. Then the triangle's working variant had its caught man's feet
// taken out of the mat — forty centimetres down, and the ground clamp turning
// his thigh to lift them (plant-check.mjs, pose-relax's PLANT_W) — and its
// loop re-solved: hips 62.
const NOW = { 'knee-back': 0, 'knee-side': 58, 'elbow-back': 0, 'elbow-side': 40, 'hip-turn': 62, 'shoulder-turn': 215 };
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
    // The worst of each, and how many samples it brings: the line is a count,
    // and the transition that breaks it is the one with the most samples, not
    // always the one with the worst degree.
    const by = new Map();
    for (const r of over) {
      const k = `${r.n}${r.s} of ${r.role} in ${r.what.split(' @')[0]}`;
      const e = by.get(k) || { worst: 0, n: 0 };
      e.worst = Math.max(e.worst, say(r)); e.n++;
      by.set(k, e);
    }
    const order = process.env.BY_COUNT ? (a, b) => b[1].n - a[1].n : (a, b) => b[1].worst - a[1].worst;
    for (const [k, v] of [...by].sort(order).slice(0, +(process.env.TOP || 15))) {
      console.log(`       ${v.worst.toFixed(0).padStart(4)}°  ${String(v.n).padStart(3)}×  ${k}`);
    }
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
