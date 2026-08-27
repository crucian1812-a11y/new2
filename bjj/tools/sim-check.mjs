// Headless matches. The rules engine, the AI and the rig are all plain modules,
// so a thousand matches can be played in a couple of seconds with no browser
// anywhere near it — which is the only way to find out whether the numbers in
// positions.js actually produce a sport.
//
// What it is looking for: that matches end, that they end in more than one way,
// that no position is a dead end or an absorbing state, and that the belt
// levels are actually ordered.

import { Match, Fighter, MATCH_TIME } from '../src/game/match.js';
import { AI, AI_LEVELS } from '../src/game/ai.js';
import { POSES } from '../src/game/poses.js';
import { TRANSITIONS } from '../src/game/positions.js';

const DT = 1 / 30;
const N = +(process.argv[2] || 200);

function play(l0, l1, seenPos, seenTr) {
  const a = new Fighter('A');
  const b = new Fighter('B');
  const m = new Match([a, b], { time: MATCH_TIME });
  const ai0 = new AI(0, l0);
  const ai1 = new AI(1, l1);
  m.start();
  let steps = 0;
  const cap = Math.ceil((MATCH_TIME + 5) / DT);
  while (m.state !== 'over' && steps++ < cap) {
    for (const ai of [ai0, ai1]) {
      ai.update(DT, m,
        (d) => m.input(ai.i, d),
        () => (m.state === 'sub' && m.sub.attacker === ai.i ? m.subTap(ai.i) : m.grip(ai.i)));
    }
    m.update(DT, [ai0.control, ai1.control]);
    seenPos.add(m.position);
    if (m.attempt) seenTr.add(key(m.attempt.tr));
  }
  return { m, steps, cap };
}

function randomPlay(seenPos, seenTr) {
  const m = new Match([new Fighter('A'), new Fighter('B')], { time: 120 });
  m.start();
  let steps = 0;
  const dirs = ['up', 'down', 'left', 'right'];
  while (m.state !== 'over' && steps++ < 120 / DT) {
    for (const i of [0, 1]) {
      m.f[i].stamina = 100; // coverage, not balance: never gate on gas
      if (Math.random() < 0.12) m.input(i, dirs[(Math.random() * 4) | 0]);
      if (m.state === 'sub' && m.sub.attacker === i && Math.random() < 0.2) m.subTap(i);
    }
    m.update(DT, [ZERO, ZERO]);
    seenPos.add(m.position);
    if (m.attempt) seenTr.add(key(m.attempt.tr));
  }
}
const ZERO = { mx: 0, mz: 0, turn: 0, drive: 0 };

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/* --- one belt against itself: does a match look like a match? ------------- */
const seenPos = new Set();
const seenTr = new Set();
const outcomes = { submission: 0, points: 0, advantages: 0, draw: 0 };
let hung = 0;
let totalPoints = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const { m, steps, cap } = play('purple', 'purple', seenPos, seenTr);
  if (steps >= cap) hung++;
  outcomes[m.winBy] = (outcomes[m.winBy] || 0) + 1;
  totalPoints += m.f[0].points + m.f[1].points;
}
const ms = Date.now() - t0;

check(hung === 0, 'every match reaches an end', `${N} matches in ${ms}ms`);
check(outcomes.submission > 0, 'submissions happen', JSON.stringify(outcomes));
check(outcomes.points > 0, 'matches also go to the scorecard');
check(
  outcomes.submission / N < 0.8,
  'not every match is a submission',
  `${((outcomes.submission / N) * 100).toFixed(0)}% by submission`
);
check(totalPoints / N > 2, 'points are actually scored', `${(totalPoints / N).toFixed(1)} per match`);

// The role belongs in the key. Half guard's back-take is authored twice, once
// for the man on top and once for the man on the bottom, and without the role
// the two collapse into one — which is how this check reported 46 of 47
// forever, with nothing actually missing.
function key(t) { return `${t.from}>${t.role}>${t.dir}>${t.to}`; }

/* --- coverage: is any of the graph unreachable? -------------------------- */
const allPos = Object.keys(POSES);
const missPos = allPos.filter((p) => !seenPos.has(p));
check(missPos.length === 0, 'every position is reached', missPos.join(',') || `${seenPos.size}/${allPos.length}`);

// The AI will never play a losing move, which is correct of it and useless for
// coverage. A random agent walks the whole graph instead, and proves that every
// edge in it can be run without the sim falling over.
for (let i = 0; i < 120; i++) randomPlay(seenPos, seenTr);
const allTr = TRANSITIONS.map(key);
const missTr = allTr.filter((t) => !seenTr.has(t));
check(
  missTr.length === 0,
  'every transition is reachable and runs',
  missTr.length ? `missing ${missTr.length}: ${missTr.slice(0, 4).join(' ')}` : `${seenTr.size}/${allTr.length}`
);

/* --- do the belts rank? -------------------------------------------------- */
const M = Math.max(60, Math.floor(N / 2));
const s = new Set();
let whiteWins = 0;
for (let i = 0; i < M; i++) {
  const { m } = play('black', 'white', s, s);
  if (m.winner === 1) whiteWins++;
}
const blackRate = 1 - whiteWins / M;
check(blackRate > 0.6, 'a black belt beats a white belt', `${(blackRate * 100).toFixed(0)}% over ${M}`);

/* --- and is the ladder monotone? ---------------------------------------- */
const rates = [];
for (const lvl of AI_LEVELS) {
  let w = 0;
  for (let i = 0; i < 40; i++) {
    const { m } = play(lvl, 'blue', s, s);
    if (m.winner === 0) w++;
  }
  rates.push([lvl, w / 40]);
}
console.log('     vs blue: ' + rates.map(([l, r]) => `${l} ${(r * 100).toFixed(0)}%`).join('  '));
check(rates[4][1] >= rates[0][1], 'black outperforms white against a fixed opponent');

console.log(fail ? `\n${fail} check(s) failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
