// Does the разбор tell the truth?
//
// After the whistle the game now says what the match was: how many moves you
// took, how many of them were worth points, how often you arrived somewhere
// that scores and left before the three seconds were up, how much of what came
// at you you answered. It is the only screen in the game that makes claims
// about the player, and a screen like that has exactly one job — to be right.
// A debrief that guesses is worse than no debrief: it teaches the wrong lesson
// with the authority of the game itself.
//
// So this plays matches and audits the tape against the match it came from:
//
//   · the points in the tape are the points on the scoreboard
//   · every press lands in exactly one bucket, and the buckets sum
//   · every arrival is followed by exactly one outcome — paid, or dropped
//   · every line printed is a line whose condition actually holds
//   · and the tape does not run away with the memory
//
//   node bjj/tools/tape-check.mjs           200 matches
//   node bjj/tools/tape-check.mjs 40 --show  and print some debriefs

import { Match, Fighter, MATCH_TIME } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { seedRandom, rand, randInt } from '../src/game/rng.js';
import { DIRS } from '../src/game/positions.js';

const args = process.argv.slice(2);
const N = +(args[0] > 0 ? args[0] : 200);
const SHOW = args.includes('--show');
const SEED = seedRandom(20260903);

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// The player's side is played every which way on purpose: a debrief that is
// only ever read after a good match is a debrief that has never been tested on
// the match somebody actually loses. One in five hands does nothing at all.
function play(level, style) {
  const m = new Match([new Fighter('вы'), new Fighter('соперник')], { time: MATCH_TIME });
  const ai = new AI(1, level);
  const mine = new AI(0, level);
  m.start();
  const dt = 1 / 60;
  let idle = 0;
  for (let t = 0; t < MATCH_TIME + 1 && m.state !== 'over'; t += dt) {
    if (style === 'ai') {
      mine.update(dt, m, (d) => m.input(0, d), () =>
        (m.state === 'sub' && m.sub.attacker === 0 ? m.subTap(0) : m.grip(0)));
    } else if (style === 'mash') {
      if ((idle -= dt) <= 0) { idle = 0.2 + rand() * 0.3; m.input(0, DIRS[randInt(4)]); }
    } // 'still' presses nothing, ever
    ai.update(dt, m, (d) => m.input(1, d), () =>
      (m.state === 'sub' && m.sub.attacker === 1 ? m.subTap(1) : m.grip(1)));
    m.update(dt, [{ mx: 0, mz: 0, turn: 0, drive: 0.3 }, ai.control]);
  }
  return m;
}

const BUCKETS = ['go', 'queued', 'chained', 'none', 'nostam', 'deny', 'deny-miss', 'escape', 'escape-miss'];

let worst = 0, lines = 0, empty = 0, longest = 0, longestLine = '';
let badScore = 0, badBucket = 0, orphan = 0, badClaim = 0, overflow = 0;
const seen = new Set();

const t0 = Date.now();
const styles = ['ai', 'mash', 'still'];
for (let i = 0; i < N; i++) {
  const level = ['white', 'blue', 'purple', 'black'][i % 4];
  const m = play(level, styles[i % 3]);
  const d = m.debrief();
  const tape = m.tape;
  worst = Math.max(worst, tape.length);
  if (tape.length >= 1200) overflow++;

  // 1. the tape's points are the scoreboard's points
  for (const side of [0, 1]) {
    const paid = tape.filter((r) => r.k === 'paid' && r.by === side)
      .reduce((s, r) => s + r.points, 0);
    if (paid !== m.f[side].points) badScore++;
  }

  // 2. every press in exactly one bucket
  const press = tape.filter((r) => r.k === 'press');
  const summed = BUCKETS.reduce((s, b) => s + press.filter((r) => r.res === b).length, 0);
  if (summed !== press.length) badBucket++;
  for (const r of press) if (!BUCKETS.includes(r.res)) seen.add(r.res);

  // 3. every arrival ends exactly once, paid or dropped
  const arrive = tape.filter((r) => r.k === 'arrive').length;
  const ended = tape.filter((r) => r.k === 'paid' || r.k === 'drop').length;
  // The last one can still be in flight when the clock runs out, which is a
  // hold that never ended rather than one that vanished.
  if (ended !== arrive && ended !== arrive - 1) orphan++;

  // 4. every line that got printed is a line whose condition holds
  for (const line of d.lines) {
    lines++;
    if (line.length > longest) { longest = line.length; longestLine = line; }
    const ok =
      line.startsWith('ни одного хода') ? d.go === 0
      : line.includes('ни одного за очки') ? d.go > 0 && d.scoring === 0
      : line.includes('ничего не стоили') ? d.zero >= d.scoring * 2 && d.scoring > 0
      : line.includes('раньше трёх секунд') ? d.dropped > 0 && d.droppedPts > 0
      : line.startsWith('защита:') ? d.answerable >= 3 && d.denyOk * 2 < d.answerable
      : line.includes('не хватило сил') ? d.nostam >= 3
      : line.startsWith('он взял:') ? d.theirFrom.length > 0
      : line.startsWith('чисто:') ? d.mine > d.theirs
      : line.startsWith('по очкам ровно') ? d.mine <= d.theirs
      : false;
    if (!ok) { badClaim++; if (badClaim < 4) console.log(`     claim fails: "${line}"`); }
  }
  if (!d.lines.length) empty++;
  if (SHOW && i < 6) {
    console.log(`     ${level} ${styles[i % 3]}  ${m.f[0].points}:${m.f[1].points}` +
      `  ${tape.length} on the tape`);
    for (const l of d.lines) console.log(`       · ${l}`);
  }
}
const ms = Date.now() - t0;
console.log(`\n     ${N} matches in ${ms}ms, longest tape ${worst} entries\n`);

check(badScore === 0, 'the разбор counts the same points the scoreboard does',
  `${badScore} disagreements over ${N * 2} scorecards`);
check(badBucket === 0 && seen.size === 0, 'every press lands in exactly one bucket',
  seen.size ? `unbucketed: ${[...seen].join(', ')}` : `${N} matches`);
check(orphan === 0, 'every arrival ends in points or in an advantage',
  `${orphan} matches with a hold that vanished`);
check(badClaim === 0, 'every line of the разбор is true of the tape',
  `${badClaim} false claims over ${lines} lines`);
check(empty === 0, 'there is always something to say', `${empty} blank debriefs`);
// A phone in landscape is 480 logical pixels wide and the line is 11px; past
// about sixty characters it runs off the card.
check(longest <= 62, 'the lines fit a phone',
  `longest ${longest} chars: "${longestLine}"`);
check(overflow === 0, 'the tape does not run away',
  `worst ${worst} entries — 250 presses kept whole plus whatever the rules allow`);

console.log(fail ? `\n${fail} check(s) failed` : '\nthe разбор is honest');
process.exitCode = fail ? 1 : 0;
