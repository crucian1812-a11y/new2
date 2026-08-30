// Elbows and knees, which only bend one way.
//
// Everything else in the battery asks whether two bodies are in the same place
// or whether a pose is still the position it says it is. Nothing asked whether
// the bodies themselves are possible. An elbow is a hinge: it folds towards the
// biceps and it stops at straight, and a forearm that has gone past straight or
// swung out sideways reads as broken from any distance — more obviously than
// eight centimetres of overlap, because everybody knows what an arm does.
//
// Three numbers per joint, all taken from the world pose after the rig has
// finished with it, so authored angles, the arc corrections and the IK that
// welds a hand to a lapel are all judged together rather than only the first:
//
//   bend       how far it is folded. 0 is straight.
//   past       how far past straight it has gone the wrong way.
//   sideways   how far the hinge axis has left the axis it hinges on.
//
//   node bjj/tools/joint-check.mjs           poses and blends, the summary
//   node bjj/tools/joint-check.mjs --all     every joint over the limit

import { PairRig } from '../src/game/rig.js';
import { POSES, HOLD_LOOPS } from '../src/game/poses.js';
import { TRANSITIONS, visualTo } from '../src/game/positions.js';
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
const MAX_PAST = 8;     // degrees past straight, the wrong way
const MAX_SIDE = 22;    // degrees the hinge axis may wander off its own axis

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
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const DEG = 180 / Math.PI;

// The axis a joint is allowed to hinge about, in the parent bone's own frame.
//
// Every bone in this rig runs down its local -Y, so a hinge between two of them
// turns about X. Which way round is flexion is read off the rest of the body
// rather than assumed: the sign is fixed below from a pose whose elbows and
// knees are unambiguously bent.
function measure(sk, upper, mid, lower) {
  const a = head(sk, upper), b = head(sk, mid), c = head(sk, lower);
  const u = norm(sub(b, a));
  const f = norm(sub(c, b));
  // Signed, about the joint's own hinge, with atan2 rather than acos.
  //
  // The first version of this took the unsigned angle and read the direction
  // off the sign of the cross product, and that is unstable exactly where it
  // matters: near full fold the cross product is short and its direction is
  // noise, so a correctly folded elbow could report as bent backwards. atan2
  // against the hinge axis is stable everywhere and gives the fold and its
  // direction in one number, in the same convention the poses are authored in.
  const m = sk.world[BONE_INDEX[upper]];
  const ax = norm([m[0], m[1], m[2]]);   // the X column: the hinge
  const turn = cross(u, f);
  const flex = Math.atan2(dot(turn, ax), dot(u, f)) * DEG;
  // How much of the bend is not about the hinge at all.
  //
  // Only asked of a joint that is actually bent. The bend axis is the cross
  // product of the two bone directions, and near straight and near fully folded
  // that vector is almost nothing, so its direction is noise — asking it there
  // reported eight thousand sideways elbows that were simply straight ones.
  const bendAmt = Math.abs(flex);
  const side = bendAmt < 15 || bendAmt > 165
    ? 0
    : Math.acos(Math.min(1, Math.abs(dot(norm(turn), ax)))) * DEG;
  return { flex, bend: Math.abs(flex), side, sign: Math.sign(flex) };
}

/* --------------------------------------------------- which way is forwards */

// Fix the sign of flexion from a pose that is unambiguous about it: in the
// stance both elbows are folded and both knees are bent, so whatever sign they
// come out as is the sign a joint is meant to have.
rig.applyAt('STANDING', 'STANDING', 1, 0.016);
const FLEX = {};
for (const [name, u, m, l] of CHAINS) {
  FLEX[name] = measure(rig.skel.A, u, m, l).sign || 1;
}

/* ------------------------------------------------------------------ sample */

const rows = [];
function sample(what, sk, role) {
  for (const [name, u, m, l] of CHAINS) {
    const r = measure(sk, u, m, l);
    // Past straight the wrong way: the joint has bend, and the bend is about
    // the axis the other way round from the one it hinges on.
    const past = r.sign && r.sign !== FLEX[name] ? Math.abs(r.flex) : 0;
    rows.push({ what, role, name, bend: r.bend, past, side: r.side });
  }
}

for (const id of Object.keys(POSES)) {
  if (POSES[id].refereeOnly) continue;
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.time = 0;
  rig.applyAt(id, id, 1, 0.016);
  sample(id, rig.skel.A, 'A');
  sample(id, rig.skel.B, 'B');
}

const seen = new Set();
const BLENDS = [
  ...TRANSITIONS.map((tr) => [tr.from, visualTo(tr)]),
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
    rig.time = 0;
    rig.applyAt(from, to, t, 0.016);
    sample(`${key} @${t.toFixed(2)}`, rig.skel.A, 'A');
    sample(`${key} @${t.toFixed(2)}`, rig.skel.B, 'B');
  }
}

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

const past = worstOf('past', MAX_PAST);
const side = worstOf('side', MAX_SIDE);
const bend = worstOf('bend', MAX_BEND);

const say = (r) => `${r.name} of ${r.role} in ${r.what}`;

check(
  past.bad.length === 0,
  'no elbow or knee bends backwards',
  past.top ? `worst ${past.top.past.toFixed(0)}deg past straight, ${say(past.top)}` +
    ` (${past.bad.length} of ${rows.length} samples)` : `${rows.length} samples`
);
check(
  side.bad.length === 0,
  'no elbow or knee hinges sideways',
  side.top ? `worst ${side.top.side.toFixed(0)}deg off its own axis, ${say(side.top)}` +
    ` (${side.bad.length} of ${rows.length})` : `all within ${MAX_SIDE}deg`
);
check(
  bend.bad.length === 0,
  'nothing folds further than a joint folds',
  bend.top ? `worst ${bend.top.bend.toFixed(0)}deg, ${say(bend.top)}` +
    ` (${bend.bad.length} of ${rows.length})` : `all within ${MAX_BEND}deg`
);

if (process.argv.includes('--dist')) {
  const q = (arr, p) => arr.length ? arr[Math.floor((arr.length - 1) * p)] : 0;
  for (const key of ['bend', 'past', 'side']) {
    const v = rows.map((r) => r[key]).sort((a, b) => a - b);
    console.log(`\n     ${key}: median ${q(v, .5).toFixed(0)}  p90 ${q(v, .9).toFixed(0)}  ` +
      `p99 ${q(v, .99).toFixed(0)}  max ${q(v, 1).toFixed(0)}`);
  }
  const byJoint = new Map();
  for (const r of rows) byJoint.set(r.name, Math.max(byJoint.get(r.name) || 0, r.side));
  console.log('\n     worst sideways per joint:');
  for (const [k, v] of byJoint) console.log(`     ${v.toFixed(0).padStart(3)}deg  ${k}`);
}

if (ALL) {
  for (const [label, set] of [['backwards', past.bad], ['sideways', side.bad], ['over-folded', bend.bad]]) {
    if (!set.length) continue;
    console.log(`\n     ${label}:`);
    const byWhat = new Map();
    for (const r of set) {
      const k = `${r.name} of ${r.role} in ${r.what.split(' @')[0]}`;
      const v = Math.max(byWhat.get(k) || 0, r.past || r.side || r.bend);
      byWhat.set(k, v);
    }
    for (const [k, v] of [...byWhat].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`     ${v.toFixed(0).padStart(3)}deg  ${k}`);
    }
  }
}

console.log(fail ? `\n${fail} check(s) failed` : '\nthe joints are joints');
process.exitCode = fail ? 1 : 0;
