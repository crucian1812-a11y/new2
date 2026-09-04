// Elbows and knees, which only bend one way.
//
// Everything else in the battery asks whether two bodies are in the same place
// or whether a pose is still the position it says it is. Nothing asked whether
// the bodies themselves are possible. An elbow is a hinge: it folds towards the
// biceps and it stops at straight, and a forearm that has gone past straight or
// swung out sideways reads as broken from any distance — more obviously than
// eight centimetres of overlap, because everybody knows what an arm does.
//
// One number per joint, and it took three tries to arrive at the right one.
//
// The first two versions asked which *way* the joint was folded, by comparing
// the bend axis against the upper bone's own X. That reads plausibly and is
// wrong: the bone's X depends on how the arm is rolled about its own length,
// the IK does not control that roll, and the roll is invisible on a capsule —
// so two arms that look identical can report opposite directions. It said the
// grip IK was folding mount's elbow to 182 degrees and turtle's backwards, and
// on the unambiguous measure below those same elbows are at 96 and 85.
//
// What survives is the angle between the two bone segments. It does not care
// about roll, it is what the eye sees, and a person's elbow and knee both stop
// near 150:
//
//   bend   how far it is folded, 0 straight, taken from the world pose after
//          the rig has finished — so authored angles, the arc corrections and
//          the IK that welds a hand to a lapel are judged together.
//
//   node bjj/tools/joint-check.mjs           poses and blends, the summary
//   node bjj/tools/joint-check.mjs --all     every joint over the limit

import { PairRig } from '../src/game/rig.js';
import { POSES, HOLD_LOOPS } from '../src/game/poses.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { JUDGE_STEPS } from './grid.mjs';

const ALL = process.argv.includes('--all');
// Who is bending them. The poses are authored as one number per joint and that
// number is always inside the range; what the rig does on top of it — the arc
// corrections mid-blend, and the IK that welds a hand to a lapel — is not
// obliged to stay there. This switch takes the grips out so the two can be told
// apart, which is the difference between fixing a pose and fixing a solver.
const NO_IK = process.argv.includes('--no-ik');
const STEPS = JUDGE_STEPS;

// What a person's elbow and knee actually do, in degrees.
//
// An elbow folds to about 145 and a knee to about 140; neither goes past
// straight by more than a few degrees, and neither has any sideways travel
// worth the name — what little there is at the knee only exists when it is
// bent. The allowances here are deliberately generous, because the job is to
// catch a limb that is obviously wrong rather than to model a joint.
const MAX_BEND = 155;

const CHAINS = [
  ['elbow L', 'armL', 'foreL', 'handL'],
  ['elbow R', 'armR', 'foreR', 'handR'],
  ['knee L', 'thighL', 'shinL', 'footL'],
  ['knee R', 'thighR', 'shinR', 'footR'],
];

const rig = new PairRig();
rig.live = false;
if (NO_IK) rig._grips = () => {};

const head = (sk, b) => {
  const m = sk.world[BONE_INDEX[b]];
  return [m[12], m[13], m[14]];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const DEG = 180 / Math.PI;

// The axis a joint is allowed to hinge about, in the parent bone's own frame.
//
// Every bone in this rig runs down its local -Y, so a hinge between two of them
// turns about X. Which way round is flexion is read off the rest of the body
// rather than assumed: the sign is fixed below from a pose whose elbows and
// knees are unambiguously bent.
// The angle between the two bone segments, and nothing else.
//
// The note at the top of this file has said so for a while and the code did
// not: it still projected the bend onto the upper bone's own X and read the
// angle off atan2 against it. That is the roll-dependent measure the note
// describes retiring, and it survived because the two obviously broken numbers
// beside it — which way it bent, how far sideways — were taken out and this one
// was not, and nobody measured it again afterwards.
//
// What it did wrong is specific. atan2(dot(u×f, ax), dot(u, f)) returns nearly
// 180 whenever the two bones are more than a right angle apart and the bend is
// out of the hinge's plane, because the numerator collapses and only the sign
// of the denominator is left. So an arm bent a comfortable hundred degrees
// somewhere off-axis reported as folded double. Across every pose and blend it
// called 413 samples over the line, worst 180 degrees; the same samples on the
// segment angle are 20, worst 175, and the three deepest of the old list are
// arms at 111, 113 and 101 degrees, which is a person holding a grip.
//
// acos of the dot product has no such failure and no second reading. 0 is a
// straight arm, 180 is a hand on its own shoulder.
function measure(sk, upper, mid, lower) {
  const a = head(sk, upper), b = head(sk, mid), c = head(sk, lower);
  const u = norm(sub(b, a));
  const f = norm(sub(c, b));
  return { bend: Math.acos(Math.min(1, Math.max(-1, dot(u, f)))) * DEG };
}

/* ------------------------------------------------------------------ sample */

const rows = [];
function sample(what, sk, role) {
  for (const [name, u, m, l] of CHAINS) {
    rows.push({ what, role, name, bend: measure(sk, u, m, l).bend });
  }
}

for (const id of Object.keys(POSES)) {
  if (POSES[id].refereeOnly) continue;
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(id, id, 1, 0.016);
  sample(id, rig.skel.A, 'A');
  sample(id, rig.skel.B, 'B');
}

const seen = new Set();
const BLENDS = [
  ...TRANSITIONS.flatMap((tr) => visualEnds(tr).map((to) => [tr.from, to])),
  ...Object.entries(HOLD_LOOPS).flatMap(([pos, loop]) => loop.map((v) => [pos, v])),
];
for (const [from, to] of BLENDS) {
  const key = `${from}>${to}`;
  if (from === to || seen.has(key)) continue;
  seen.add(key);
  for (let i = 0; i < STEPS; i++) {
    const t = i / (STEPS - 1);
    rig.effort.A = rig.effort.B = 0;
    rig.slack.A = rig.slack.B = 0;
    rig.rewind();
    rig.applyAt(from, to, t, 0.016);
    sample(`${key} @${t.toFixed(2)}`, rig.skel.A, 'A');
    sample(`${key} @${t.toFixed(2)}`, rig.skel.B, 'B');
  }
}

/* ------------------------------------------- the rest of the joints, by range */

// How far each joint is turned from rest, as one angle.
//
// The obvious way to ask this is to read the pose's three authored numbers back
// out and compare each against a limit, and that was the third mistake in this
// file: a rotation has more than one triple that describes it, so a knee bent
// 114 degrees also reads as a shin twisted through half a turn, and a forearm
// carrying a little roll reads 163 where the arm you can see is at 141.
// Canonicalising helps and does not fix it.
//
// The total angle of the local rotation has no such ambiguity. It says less —
// it cannot tell a neck turned sideways from one bent forward — but what it
// says is true, and a joint turned further from rest than the joint turns is
// wrong whichever way it went. Limits are the generous end of a healthy adult.
const ROM = {
  spine: 50, chest: 50, neck: 75, head: 50,
  clavL: 45, clavR: 45,
  armL: 175, armR: 175,
  // No forearm here on purpose. Its rotation relative to the upper arm is the
  // elbow's fold *plus* pronation, and pronation is nearly free — a forearm
  // turns something like 180 degrees on its own axis, which is why a total of
  // 178 on the back's right forearm sits beside a fold of 138 that is fine. The
  // fold is what matters and the check above measures it without the roll in.
  handL: 90, handR: 90,
  thighL: 145, thighR: 145,
  // Knee flexion plus what the tibia turns under it.
  shinL: 168, shinR: 168,
  footL: 65, footR: 65,
};

const turnOf = (q) => 2 * Math.acos(Math.min(1, Math.abs(q[3]))) * DEG;

const romBad = [];
for (const id of Object.keys(POSES)) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(id, id, 1, 0.016);
  for (const role of ['A', 'B']) {
    for (const bone of Object.keys(ROM)) {
      const turn = turnOf(rig.skel[role].local[BONE_INDEX[bone]]);
      const over = turn - ROM[bone];
      if (over > 1) romBad.push({ id, role, bone, turn, lim: ROM[bone], over });
    }
  }
}
romBad.sort((a, b) => b.over - a.over);

/* ------------------------------------------------------------------ report */

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const worstOf = (key, limit) => {
  const bad = rows.filter((r) => r[key] > limit).sort((a, b) => b[key] - a[key]);
  return { bad, top: bad[0] };
};

const bend = worstOf('bend', MAX_BEND);
const say = (r) => `${r.name} of ${r.role} in ${r.what}`;

check(
  bend.bad.length === 0,
  'nothing folds further than an elbow or a knee folds',
  bend.top ? `worst ${bend.top.bend.toFixed(0)}deg, ${say(bend.top)}` +
    ` (${bend.bad.length} of ${rows.length} samples)` : `all within ${MAX_BEND}deg over ${rows.length} samples`
);

if (process.argv.includes('--dist')) {
  const q = (arr, p) => arr.length ? arr[Math.floor((arr.length - 1) * p)] : 0;
  const v = rows.map((r) => r.bend).sort((a, b) => a - b);
  console.log(`\n     bend: median ${q(v, .5).toFixed(0)}  p90 ${q(v, .9).toFixed(0)}  ` +
    `p99 ${q(v, .99).toFixed(0)}  max ${q(v, 1).toFixed(0)}`);
  const byJoint = new Map();
  for (const r of rows) byJoint.set(r.name, Math.max(byJoint.get(r.name) || 0, r.bend));
  console.log('\n     worst fold per joint:');
  for (const [k, v2] of byJoint) console.log(`     ${v2.toFixed(0).padStart(3)}deg  ${k}`);
}

if (ALL) {
  for (const [label, set] of [['over-folded', bend.bad]]) {
    if (!set.length) continue;
    console.log(`\n     ${label}:`);
    const byWhat = new Map();
    for (const r of set) {
      const k = `${r.name} of ${r.role} in ${r.what.split(' @')[0]}`;
      const v = Math.max(byWhat.get(k) || 0, r.bend);
      byWhat.set(k, v);
    }
    for (const [k, v] of [...byWhat].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`     ${v.toFixed(0).padStart(3)}deg  ${k}`);
    }
  }
}

check(
  romBad.length === 0,
  'no joint is turned further than it turns',
  romBad.length
    ? `${romBad.length} over, worst ${romBad[0].bone} at ${romBad[0].turn.toFixed(0)}deg ` +
      `in ${romBad[0].id} (${romBad[0].role}), limit ${romBad[0].lim}`
    : `${Object.keys(ROM).length} joints across every pose`
);

if (romBad.length && (ALL || process.argv.includes('--rom'))) {
  console.log('\n     turned too far, worst first:');
  for (const r of romBad.slice(0, 30)) {
    console.log(`     ${r.over.toFixed(0).padStart(3)}deg over  ${r.id.padEnd(18)} ${r.role}.${r.bone}` +
      ` = ${r.turn.toFixed(0)}deg  (limit ${r.lim})`);
  }
}

console.log(fail ? `\n${fail} check(s) failed` : '\nthe joints are joints');
process.exitCode = fail ? 1 : 0;
