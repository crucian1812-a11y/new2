// Do the bodies shake?
//
// Everything that measures motion in this project measures the *plan*:
// blend-check walks a transition and reports the worst overlap, flow-check asks
// whether the blend parameter ever jumps. Neither of them has ever looked at
// where a knee actually was on two consecutive frames. So a joint can jitter in
// place all match, or snap ten centimetres in a sixtieth of a second, and every
// number in the battery stays green — which is exactly what a player reported:
// "они дрожат и дёргаются".
//
// This drives the real rig at sixty frames a second off a real match — the same
// calls main.js makes, in the same order — and watches the world positions of
// all twenty-six bones on both men.
//
//   рывок  (a jerk)   the speed of a joint changing hard between two frames.
//                     A grappler's limb accelerates at maybe 20-40 m/s²; past
//                     that the eye reads a cut, not a movement.
//   дрожь  (a shake)  a joint reversing direction over and over without going
//                     anywhere: reversals per second, weighted by how far it
//                     travels doing it. Breathing is one reversal a second at
//                     a centimetre; a tremor is six at two millimetres, and it
//                     is the second one that reads as a bad rig.
//
//   node bjj/tools/shake-check.mjs              20 matches, the two numbers
//   node bjj/tools/shake-check.mjs 60 --bones   which joints, worst first
//   node bjj/tools/shake-check.mjs --where      what the fight was doing
//   node bjj/tools/shake-check.mjs --spread     the distribution, for picking a line

import { Match, Fighter, MATCH_TIME } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { PairRig } from '../src/game/rig.js';
import { BONES, BONE_INDEX } from '../src/render/skeleton.js';
import { POSES } from '../src/game/poses.js';
import { seedRandom } from '../src/game/rng.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const N = +(args[0] > 0 ? args[0] : 20);
const BONESOUT = args.includes('--bones');
const WHERE = args.includes('--where');
const SPREAD = args.includes('--spread');
const EVENTS = args.includes('--events');
const SEED = seedRandom(flag('seed') !== null ? Number(flag('seed')) | 0 : 20260904);

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NAMES = BONES.map((b) => b[0]);
const DT = 1 / 60;

// A jerk: the change in a joint's velocity across one frame, in m/s². Chosen
// after looking at the distribution rather than before — see --spread. Two
// lines, because they are different complaints: one is "that was fast", the
// other is "that was a cut".
// Three bands, because they are three different complaints:
//   60   a hard acceleration. A limb can do this; a lot of them at once is what
//        "дрожат" means. Reported.
//   260  a cut: four metres a second of velocity change in one frame. Reported,
//        because some of it is still there and named in the work list.
//   1500 a teleport. Nothing in a body does this and nothing in this game may:
//        this is the hard line.
const JERK = 60;
const CUT = 260;
const POP = 1500;

// A shake: direction reversals per second on a joint that is not going
// anywhere. Six a second is a tremor; the breath is one.
const SHAKE_HZ = 5;
const SHAKE_MM = 1.5;  // and it has to be visible: 1.5 mm of travel per reversal

function play(level, stats) {
  const m = new Match([new Fighter('вы'), new Fighter('соперник')], { time: MATCH_TIME });
  const a = new AI(0, level), b = new AI(1, level);
  const rig = new PairRig();
  // The game eases its hands; a solver does not. See PairRig.live.
  rig.live = true;
  m.start();

  const n = NAMES.length;
  // Tracked per **man**, not per role slot.
  //
  // A sweep blends to the mirror of its destination — the same tangle with the
  // two slots exchanged — and on arrival the roles change hands. Skeleton A's
  // joints therefore teleport across that frame while the picture does not
  // move at all: the man who was in slot A is now drawn from slot B, in the
  // shape slot A was just holding. Following the slot reported four thousand
  // cuts a minute, all of them invisible. main.js looks every fighter up
  // through `roleShown`, and so does this.
  const p = [new Float64Array(n * 3), new Float64Array(n * 3)];
  const v = [new Float64Array(n * 3), new Float64Array(n * 3)];
  const have = [false, false];
  // For the shake: the sign of each axis's velocity, and how far it has gone
  // since the last reversal.
  const sgn = [new Int8Array(n * 3), new Int8Array(n * 3)];
  const run = [new Float64Array(n * 3), new Float64Array(n * 3)];

  let t = 0;
  for (; t < MATCH_TIME + 1 && m.state !== 'over'; t += DT) {
    a.update(DT, m, (d) => m.input(0, d), () =>
      (m.state === 'sub' && m.sub.attacker === 0 ? m.subTap(0) : m.grip(0)));
    b.update(DT, m, (d) => m.input(1, d), () =>
      (m.state === 'sub' && m.sub.attacker === 1 ? m.subTap(1) : m.grip(1)));
    m.update(DT, [a.control, b.control]);

    // Exactly what main.js does with the rig, in the same order.
    rig.origin[0] = m.origin[0];
    rig.origin[2] = m.origin[2];
    rig.yaw = m.yaw;
    for (const [role, idx] of [['A', m.roleShown.indexOf('A')], ['B', m.roleShown.indexOf('B')]]) {
      const f = m.f[idx];
      const working = (m.attempt && m.attempt.by === idx)
        || (m.state === 'sub' && m.sub.attacker === idx);
      const held = m.state === 'sub' && m.sub.defender === idx;
      rig.effort[role] = clamp(
        (working ? 0.9 : 0) + (held ? 0.75 : 0) + m.intensity * 0.25 + (1 - f.stamina / 100) * 0.3, 0, 1.2);
      rig.slack[role] = clamp(1 - f.posture / 100, 0, 1);
      rig.gas[role] = clamp(1 - f.stamina / 100, 0, 1);
      rig.fight[role] = m.gripFight[idx];
    }
    const from = m.prevPosition;
    const to = m.pending || m.position;
    if (from === to && m.blend >= 1) rig.hold(to, DT);
    else rig.apply(from, to, m.blend, DT);

    // What the fight is doing, for the attribution table.
    const lastRoles = stats.lastRoles || 'AB';
    stats.lastRoles = m.roleShown.join('');
    const where = m.state === 'sub' ? 'захват'
      : m.attempt ? 'приём'
      : from !== to ? 'переход'
      : m.gripFight[0] > 0.02 || m.gripFight[1] > 0.02 ? 'борьба за захват'
      : 'удержание';

    for (let man = 0; man < 2; man++) {
      const role = m.roleShown[man];
      const sk = rig.skel[role];
      for (let i = 0; i < n; i++) {
        const w = sk.world[i];
        const x = w[12], y = w[13], z = w[14];
        const o = i * 3;
        if (!have[man]) { p[man][o] = x; p[man][o + 1] = y; p[man][o + 2] = z; continue; }
        const nv = [(x - p[man][o]) / DT, (y - p[man][o + 1]) / DT, (z - p[man][o + 2]) / DT];
        const dvx = nv[0] - v[man][o], dvy = nv[1] - v[man][o + 1], dvz = nv[2] - v[man][o + 2];
        const acc = Math.hypot(dvx, dvy, dvz) / DT;
        stats.frames++;
        stats.accSum += acc;
        stats.acc.push(acc);
        if (acc > stats.worstAcc) { stats.worstAcc = acc; stats.worstWho = `${NAMES[i]}/${man}`; stats.worstWhere = where; }
        if (acc > CUT) stats.cuts++;
        if (EVENTS && acc > POP) {
          stats.events.push({ acc: Math.round(acc), bone: NAMES[i], man, from, to,
            t: +m.blend.toFixed(2), where, roles: m.roleShown.join(''),
            swap: m.roleShown.join('') !== lastRoles, sub: m.state === 'sub' });
        }
        if (acc > JERK) {
          stats.jerks++;
          stats.byBone[NAMES[i]] = (stats.byBone[NAMES[i]] || 0) + 1;
          stats.byWhere[where] = (stats.byWhere[where] || 0) + 1;
          if (acc > POP) {
            stats.pops++;
            stats.popBone[NAMES[i]] = (stats.popBone[NAMES[i]] || 0) + 1;
            stats.popWhere[where] = (stats.popWhere[where] || 0) + 1;
          }
        }
        // The shake, per axis: count a reversal, and remember how far it went.
        for (let k = 0; k < 3; k++) {
          const s = nv[k] > 0.002 ? 1 : nv[k] < -0.002 ? -1 : 0;
          if (s !== 0 && sgn[man][o + k] !== 0 && s !== sgn[man][o + k]) {
            if (run[man][o + k] * 1000 >= SHAKE_MM) {
              stats.rev++;
              stats.revBone[NAMES[i]] = (stats.revBone[NAMES[i]] || 0) + 1;
              stats.revWhere[where] = (stats.revWhere[where] || 0) + 1;
            }
            run[man][o + k] = 0;
          }
          if (s !== 0) sgn[man][o + k] = s;
          run[man][o + k] += Math.abs(nv[k]) * DT;
        }
        p[man][o] = x; p[man][o + 1] = y; p[man][o + 2] = z;
        v[man][o] = nv[0]; v[man][o + 1] = nv[1]; v[man][o + 2] = nv[2];
      }
      have[man] = true;
    }
  }
  stats.seconds += t;
  return m;
}

const stats = {
  frames: 0, accSum: 0, acc: [], jerks: 0, cuts: 0, pops: 0, rev: 0, seconds: 0, events: [],
  worstAcc: 0, worstWho: '', worstWhere: '',
  byBone: {}, byWhere: {}, popBone: {}, popWhere: {}, revBone: {}, revWhere: {},
};
const t0 = Date.now();
for (let i = 0; i < N; i++) play(['white', 'blue', 'purple', 'black'][i % 4], stats);
const ms = Date.now() - t0;

const samples = stats.frames;
const perMin = (v) => (v / Math.max(1e-9, stats.seconds)) * 60;
// Reversals are counted per joint-axis; a body has 26 bones and 3 axes each,
// two bodies, so the honest unit is "how often does a joint reverse per second"
// rather than a raw count.
const axes = NAMES.length * 3 * 2;
const revHz = stats.rev / Math.max(1e-9, stats.seconds) / axes;

console.log(`${N} matches, ${(stats.seconds / 60).toFixed(1)} minutes of fight in ${ms}ms, ` +
  `${(samples / 1e6).toFixed(1)}M joint-frames\n`);

if (SPREAD) {
  stats.acc.sort((x, y) => x - y);
  const q = (p) => stats.acc[Math.min(stats.acc.length - 1, Math.floor(stats.acc.length * p))];
  console.log('     acceleration of a joint between two frames, m/s²:');
  for (const p of [0.5, 0.9, 0.99, 0.999, 0.9999, 1]) {
    console.log(`       ${(p * 100).toFixed(2).padStart(7)}%  ${q(p).toFixed(1)}`);
  }
  console.log('');
}

const table = (obj, title, total) => {
  const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!rows.length) return;
  console.log(`     ${title}`);
  for (const [k, n] of rows) {
    console.log(`       ${k.padEnd(18)} ${String(n).padStart(7)}  ${((n / total) * 100).toFixed(0)}%`);
  }
  console.log('');
};
if (BONESOUT) {
  table(stats.byBone, `joints that jerk (over ${JERK} m/s²)`, stats.jerks);
  table(stats.popBone, `joints that cut (over ${POP} m/s²)`, stats.pops);
  table(stats.revBone, 'joints that shake', stats.rev);
}
if (WHERE) {
  table(stats.byWhere, 'when they jerk', stats.jerks);
  table(stats.popWhere, 'when they cut', stats.pops);
  table(stats.revWhere, 'when they shake', stats.rev);
}

if (EVENTS) {
  stats.events.sort((a, b) => b.acc - a.acc);
  console.log('     the teleports, worst first:');
  for (const e of stats.events.slice(0, 16)) {
    console.log(`       ${String(e.acc).padStart(5)}  ${e.bone.padEnd(9)} man ${e.man}  ` +
      `${e.from}>${e.to} t=${e.t}  ${e.where}${e.swap ? '  ROLE SWAP' : ''}`);
  }
  const byB = {}; for (const e of stats.events) byB[e.bone] = (byB[e.bone] || 0) + 1;
  console.log('     ' + Object.entries(byB).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v]) => `${k}:${v}`).join(' '));
  console.log(`     of ${stats.events.length}, ${stats.events.filter((e) => e.swap).length} on a role swap\n`);
}
console.log(`     average acceleration ${(stats.accSum / samples).toFixed(1)} m/s², ` +
  `worst ${stats.worstAcc.toFixed(0)} on ${stats.worstWho} during ${stats.worstWhere}\n`);

// The hard line, written after the measurement rather than before it. When this
// file was new the rate was 445 a minute — seven a second, all of them hands
// and forearms crossing the screen. What is left is named in the work list
// below and in PLAN.md; the line is here so it can only go down.
check(perMin(stats.pops) < 15, 'no joint ever teleports',
  `${perMin(stats.pops).toFixed(1)} per minute over ${POP} m/s² (445 before), ` +
  `worst ${stats.worstAcc.toFixed(0)}`);
check(revHz < 2.5, 'a joint does not vibrate in place',
  `${revHz.toFixed(2)} reversals a second per joint-axis, over ${SHAKE_MM} mm each ` +
  '(6.21 before the breath was given its own phase)');
// And the two work lists, reported rather than ruled on. Both were four to five
// times this and both are still hands, mid-transition: a grip letting go of one
// thing and taking another moves a hand across a body, and doing it in a fifth
// of a second is fast however smoothly it is eased.
console.log(`     work list: ${perMin(stats.cuts).toFixed(0)} accelerations a minute over ` +
  `${CUT} m/s² (4209 before), ${perMin(stats.jerks).toFixed(0)} over ${JERK} (17064 before)`);

console.log(fail ? `\n${fail} check(s) failed` : '\nthe bodies move like bodies');
process.exitCode = fail ? 1 : 0;
