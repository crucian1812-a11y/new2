// The way out of a submission, measured with a hand.
//
// Half of the submission mini-game had never been measured by anything. The
// thumb in tools/thumb.mjs is always the one attacking — in every run it ever
// made it either had the lock or no lock happened at all — so the escape ramp,
// the rotating direction and the three-strips rule were tuned against the AI
// alone, and the AI does not read the prompt: it rolls its own `read` against
// its belt and swipes.
//
// `thumb.mjs --escape` does put the hand underneath, and it says what a browser
// can say: it takes a quarter of an hour to finish eight locks, because a
// software rasteriser runs the match at a fifth of real time. This is the same
// question asked headlessly, and nothing is lost by asking it here — the thumb
// throws its escapes through `match.input` like this does, not through a
// pointer event, and every delay in it is already in match seconds rather than
// wall seconds. Two hundred locks a second instead of one a minute, seeded, so
// a change to the rule can be judged the same afternoon it is written.
//
// The hand: a reaction of 220 ms with 60 ms of jitter, a cadence no faster than
// a flick every 0.35 s, and it reads exactly what the HUD draws — `visibleEscape`
// — never `sub.escapeDir`. When the circle is blank it guesses, one in four.
//
//   node bjj/tools/escape-check.mjs            240 locks per belt
//   node bjj/tools/escape-check.mjs 500 --seed 3

import { Match, Fighter, MATCH_TIME } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { seedRandom, rand } from '../src/game/rng.js';
import { POSES } from '../src/game/poses.js';
import { TRANSITIONS } from '../src/game/positions.js';

// Every submission in the game, and where it is thrown from.
const SUB_FROM = TRANSITIONS.filter((t) => t.sub);

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const N = +(argv.find((a) => !a.startsWith('-')) || 240);
const SEED = seedRandom(flag('seed', null) !== null ? Number(flag('seed')) | 0 : (Date.now() & 0x7fffffff));
const DT = 1 / 60;
const REACT = +flag('react', 220) / 1000;
const JITTER = +flag('jitter', 60) / 1000;
const CADENCE = +flag('cadence', 0.35);
const BELTS = ['white', 'blue', 'purple', 'black'];

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// Human timing error is not a box.
let spare = null;
function gauss(sigma) {
  if (spare !== null) { const v = spare; spare = null; return v * sigma; }
  let u = 0, v = 0, s = 0;
  do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const f = Math.sqrt(-2 * Math.log(s) / s);
  spare = v * f;
  return u * f * sigma;
}

// One lock: the AI puts a submission on the player and works it, the hand
// answers. Everything about the position is the game's own — the same
// _startSub the match uses when a submission lands.
function lock(belt, blind) {
  const m = new Match([new Fighter('You'), new Fighter('Them')], { time: MATCH_TIME });
  const ai = new AI(1, belt);
  m.start();
  // Into a lock, from wherever that lock is thrown from. A match starts
  // standing and nothing is submitted from standing, so the position is set
  // first — the same reach past `input` the art tooling's setPose makes, and
  // for the same reason: what is being measured is downstream of getting
  // there. The attacker is put on top so the transition is his to run.
  const subs = SUB_FROM[(rand() * SUB_FROM.length) | 0];
  m.prevPosition = m.position = subs.from;
  m.blend = 1;
  // Whichever side of the position this submission belongs to, the attacker
  // has to be standing on it.
  const top = POSES[m.position].top;
  if (top && subs.role !== 'any') {
    const wants = subs.role === 'top' ? top : (top === 'A' ? 'B' : 'A');
    if (m.roleOf[1] !== wants) m.roleOf = [m.roleOf[1], m.roleOf[0]];
  }
  const tr = m.options(1)[subs.dir];
  if (!tr || !tr.sub) return null;
  m._startSub(1, tr);
  if (!m.sub) return null;

  let t = 0, next = 0, last = null, plan = null;
  let flicks = 0, guesses = 0;
  while (m.state === 'sub' && t < 40) {
    t += DT;
    // The hand, which throws what it decided to throw a fifth of a second ago.
    if (plan && t >= plan.at) { const p = plan; plan = null; m.input(0, p.dir); }
    if (!plan && t > next) {
      const seen = blind ? null : m.visibleEscape(0);
      if (!seen) guesses++;
      const dir = seen || ['up', 'down', 'left', 'right'][(rand() * 4) | 0];
      // A person answers the arrow in front of them and then waits for it to
      // change; they do not throw the same direction twice at a circle that
      // still says the same thing. With nothing drawn in the circle there is
      // nothing to wait for, so the hand goes at its own cadence.
      if (dir !== last || !seen || t > next + 0.9) {
        last = dir;
        next = t + CADENCE;
        flicks++;
        plan = { at: t + REACT + gauss(JITTER), dir };
      }
    }
    // The AI attacking, through its own door.
    ai.update(DT, m, (d) => m.input(1, d),
      () => (m.state === 'sub' && m.sub.attacker === 1 ? m.subTap(1) : m.grip(1)));
    m.update(DT, [ZERO, ZERO]);
  }
  const log = m.subLog[m.subLog.length - 1];
  if (!log) return null;
  return { how: log.how, seconds: log.seconds, flicks, guesses, kind: log.kind };
}
const ZERO = { mx: 0, mz: 0, turn: 0, drive: 0 };

console.log(`${N} locks per belt, hand ${REACT * 1000}±${JITTER * 1000} ms, ` +
  `a flick every ${CADENCE}s at most, seed ${SEED}\n`);
console.log('  attacker   out   tapped  ran out |  secs  flicks  blind');

const rate = {};
for (const belt of BELTS) {
  const r = { out: 0, tap: 0, time: 0, secs: 0, flicks: 0, guesses: 0, n: 0 };
  for (let i = 0; i < N; i++) {
    const one = lock(belt, false);
    if (!one) continue;
    r.n++;
    r.secs += one.seconds;
    r.flicks += one.flicks;
    r.guesses += one.guesses;
    if (one.how === 'stripped' || one.how === 'emptied') r.out++;
    else if (one.how === 'tap') r.tap++;
    else r.time++;
  }
  rate[belt] = r.n ? r.out / r.n : 0;
  console.log(`  ${belt.padEnd(9)} ${((r.out / r.n) * 100).toFixed(0).padStart(3)}%  ` +
    `${((r.tap / r.n) * 100).toFixed(0).padStart(4)}%   ${((r.time / r.n) * 100).toFixed(0).padStart(4)}%  |` +
    ` ${(r.secs / r.n).toFixed(1).padStart(5)} ${(r.flicks / r.n).toFixed(1).padStart(6)}` +
    ` ${((r.guesses / Math.max(1, r.flicks)) * 100).toFixed(0).padStart(5)}%`);
}

// The floor: the same hand with the prompt taken away entirely. Whatever the
// rule above turns out to be worth, it is worth the difference between these
// two numbers, and if there is no difference the prompt is not doing anything.
const blindR = { out: 0, n: 0 };
for (let i = 0; i < N; i++) {
  const one = lock('blue', true);
  if (!one) continue;
  blindR.n++;
  if (one.how === 'stripped' || one.how === 'emptied') blindR.out++;
}
console.log(`  ${'(blind)'.padEnd(9)} ${((blindR.out / blindR.n) * 100).toFixed(0).padStart(3)}%` +
  '   — the same hand against a blue belt with nothing drawn in the circle\n');

// Both edges matter and for different reasons. Under a third, and the defence
// is a cutscene with a swipe in it: whoever gets the lock has won. Over two
// thirds, and no submission in this game ever finishes anybody who is awake,
// which is what the sport is mostly about.
const mid = (rate.blue + rate.purple) / 2;
check(mid > 0.3 && mid < 0.7, 'a hand finds the way out of a lock, and not every time',
  BELTS.map((b) => `${b} ${(rate[b] * 100).toFixed(0)}%`).join(', '));
// And the ladder: a better attacker has to finish more often, or the belts do
// not mean anything on this half of the game either.
check(rate.black < rate.white, 'the better the attacker, the harder it is to get out',
  `white ${(rate.white * 100).toFixed(0)}% out against black ${(rate.black * 100).toFixed(0)}%`);

console.log(fail ? `\n${fail} problem(s)` : '\nthe way out is a fight');
process.exit(fail ? 1 : 0);
