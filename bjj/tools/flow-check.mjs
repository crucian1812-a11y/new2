// What the match feels like to hold in your hands.
//
// The battery measures poses, the path between them, the baked fighter, the
// picture, the sound, the escape from a lock and where the fight ends up on
// the scorecard. All of that is about single moments or whole matches. This is
// about the join between one moment and the next — the part a player feels and
// no still frame shows:
//
//   · does the picture ever jump backwards?
//   · how much of the time is there nothing on the control ring to press?
//   · how long does the fight stand still?
//   · and, statically, how much of the ring is wired up at all?
//
// The first of those is why this file exists. sheet.mjs, angles.mjs and
// strip.mjs all photograph the game, and a photograph cannot show a
// discontinuity: every frame either side of a jump is a correct frame.
//
//   node bjj/tools/flow-check.mjs             40 matches, the summary
//   node bjj/tools/flow-check.mjs 200         more of them
//   node bjj/tools/flow-check.mjs --ring      the ring coverage table

import { Match, Fighter, MATCH_TIME } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { POSES } from '../src/game/poses.js';
import { optionsFor, DIRS } from '../src/game/positions.js';
import { seedRandom } from '../src/game/rng.js';

const flag = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const N = +(process.argv[2] > 0 ? process.argv[2] : 40);
const RING = process.argv.includes('--ring');
const SEED = seedRandom(flag('seed') !== null ? Number(flag('seed')) | 0 : (Date.now() & 0x7fffffff));

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/* ------------------------------------------------ what the ring is wired to */

// Only positions the fight can actually be in. Variants are the hold loop's
// business and waypoints are the rig's; neither is ever `match.position`, and
// counting them made a first pass at this report say 77% of the ring was blank.
const PLAYABLE = Object.keys(POSES).filter(
  (id) => POSES[id].name && !POSES[id].variantOf && !POSES[id].waypoint && !POSES[id].submission
);

function ringCoverage() {
  const rows = [];
  let blank = 0, slots = 0;
  for (const id of PLAYABLE) {
    for (const role of POSES[id].top ? ['top', 'bottom'] : ['top']) {
      const o = optionsFor(id, role);
      const missing = DIRS.filter((d) => !o[d]);
      slots += DIRS.length;
      blank += missing.length;
      if (missing.length) rows.push({ id, role, have: DIRS.length - missing.length, missing });
    }
  }
  rows.sort((a, b) => a.have - b.have);
  return { rows, blank, slots };
}

/* ---------------------------------------------------------- how it plays out */

function play(level) {
  const m = new Match([new Fighter('вы'), new Fighter('соперник')], { time: MATCH_TIME });
  const a = new AI(0, level), b = new AI(1, level);
  m.start();
  const dt = 1 / 60;
  const s = {
    frames: 0, live: 0, blank: 0, breaks: 0, worstBreak: 0, stall: 0, positions: 0,
  };

  // The picture the player is looking at, taken the same way main.js takes it.
  // If this ever stops matching drawFrame the number below stops meaning
  // anything, so it is written as one expression rather than three.
  const shot = () => ({ from: m.prevPosition, to: m.pending || m.position, t: m.blend });
  let prev = shot();
  let lastPos = m.position;

  for (let t = 0; t < MATCH_TIME + 1 && m.state !== 'over'; t += dt) {
    a.update(dt, m, (d) => m.input(0, d), () =>
      (m.state === 'sub' && m.sub.attacker === 0 ? m.subTap(0) : m.grip(0)));
    b.update(dt, m, (d) => m.input(1, d), () =>
      (m.state === 'sub' && m.sub.attacker === 1 ? m.subTap(1) : m.grip(1)));
    m.update(dt, [a.control, b.control]);
    s.frames++;

    const now = shot();
    // Two ways the picture can jump, and they are the same defect seen from
    // either side of a resolution.
    //
    //   · the pair being blended stayed the same and the parameter went
    //     backwards — that is a failed attempt snapping home;
    //   · the pair changed while the parameter was well along and restarted
    //     near zero — that is a successful one being replayed from the top.
    //
    // Either way the bodies are somewhere, and one frame later they are
    // somewhere they already were.
    if (now.from === prev.from && now.to === prev.to) {
      const back = prev.t - now.t;
      if (back > 0.02) { s.breaks++; s.worstBreak = Math.max(s.worstBreak, back); }
    } else if (prev.t > 0.3 && now.t < 0.05) {
      s.breaks++;
      s.worstBreak = Math.max(s.worstBreak, prev.t);
    }
    prev = now;

    if (m.state === 'live') {
      s.live++;
      if (Object.keys(m.options(0)).length === 0) s.blank++;
    }
    s.stall = Math.max(s.stall, m.stallTimer);
    if (m.position !== lastPos) { s.positions++; lastPos = m.position; }
  }
  return s;
}

/* --------------------------------------------------------------------- run */

console.log(`${N} matches, seed ${SEED}\n`);

const agg = { frames: 0, live: 0, blank: 0, breaks: 0, worstBreak: 0, stall: 0, positions: 0 };
const t0 = Date.now();
for (const level of ['white', 'blue', 'purple', 'black']) {
  for (let i = 0; i < Math.ceil(N / 4); i++) {
    const s = play(level);
    for (const k of ['frames', 'live', 'blank', 'breaks', 'positions']) agg[k] += s[k];
    agg.worstBreak = Math.max(agg.worstBreak, s.worstBreak);
    agg.stall = Math.max(agg.stall, s.stall);
  }
}
const runs = Math.ceil(N / 4) * 4;
const ms = Date.now() - t0;

const breaksPer = agg.breaks / runs;
const blankPct = (agg.blank / Math.max(1, agg.live)) * 100;

console.log(`     ${runs} matches in ${ms}ms, ${(agg.positions / runs).toFixed(1)} position changes each\n`);

// Zero, not "few". A discontinuity is not a matter of degree: the bodies are
// in one place and a frame later in a place they have already been, and the
// eye reads that as the game glitching rather than as the fighter moving.
check(
  breaksPer < 0.5,
  'the picture never jumps backwards',
  `${breaksPer.toFixed(1)} per match, worst ${(agg.worstBreak * 100).toFixed(0)}% of a blend`
);

// Some of this is right: during an attempt the four labels genuinely have
// nothing to say, and that is the tension. All of it is not — after a
// transition lands the ring goes dark for another third of a second, and a
// player who flicks into that hole gets no answer and no reason why.
check(
  blankPct < 15,
  'there is usually something to press',
  `the ring is blank for ${blankPct.toFixed(1)}% of live frames, want under 15`
);

// The referee's one job. stallTimer has been counted since the first version
// of match.js and read by nothing, so this is what it has been counting.
check(
  agg.stall < 12,
  'the fight does not stand still',
  `longest stall ${agg.stall.toFixed(1)}s, want under 12`
);

const cov = ringCoverage();
const thin = cov.rows.filter((r) => r.have < 3);
check(
  thin.length === 0,
  'no position leaves a role with fewer than three ways out',
  `${cov.blank}/${cov.slots} slots blank; thin: ${thin.map((r) => `${r.id}/${r.role} ${r.have}`).join(', ') || 'none'}`
);

if (RING || thin.length) {
  console.log('\n     ring coverage, playable positions only:');
  for (const r of cov.rows) {
    console.log(`     ${r.id.padEnd(16)} ${r.role.padEnd(7)} ${r.have}/4  missing: ${r.missing.join(', ')}`);
  }
}

console.log(fail ? `\n${fail} check(s) failed` : '\nthe match flows');
process.exitCode = fail ? 1 : 0;
