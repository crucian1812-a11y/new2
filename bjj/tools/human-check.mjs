// Can a person win this game?
//
// Everything else in the battery measures the game against itself. sim-check
// plays the AI against the AI and reports a balanced ladder; lines.mjs showed a
// perfect-information bot beating a blue belt 90% of the time by taking the
// scoring move. Both of those describe a player who reads the position graph in
// zero milliseconds, and neither of them is a person.
//
// A person is late. He sees the ring after it changes, decides after he sees
// it, and his thumb takes another eighth of a second to travel. tools/thumb.mjs
// models exactly that, on the real page, through the real input handler — and
// it is honest precisely because it is slow: three matches take five minutes,
// so it can answer "is the window long enough" and it cannot answer "who wins
// out of two hundred".
//
// This is the fast half of that pair. The same lateness, headless, at a
// thousand matches a minute. It plays through the same public queries the HUD
// draws from — options(), preview(), denyRead(), visibleEscape(), sub.phase —
// and reads nothing the screen does not show.
//
//   node bjj/tools/human-check.mjs                  the ladder, 120 matches a belt
//         — by default a phone player: 450 ms to react, and 150 ms to turn his
//           head from the two men on the mat to the ring in the corner of his eye
//   node bjj/tools/human-check.mjs 400
//   node bjj/tools/human-check.mjs --react 250      a faster hand
//   node bjj/tools/human-check.mjs --plan likely    the naive line
//   node bjj/tools/human-check.mjs --why            where the points went
//
// The line it holds: an ordinary hand playing the obvious sensible line beats
// a white belt more often than it loses. A game whose first opponent cannot be
// beaten by a person is not a difficulty setting, it is a wall.

import { Match, Fighter, MATCH_TIME } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { DIRS } from '../src/game/positions.js';
import { seedRandom, rand, randInt } from '../src/game/rng.js';
import { SKILL_STEP } from '../src/game/skills.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const N = +(args[0] > 0 ? args[0] : 120);
const CFG = {
  react: +flag('react', 450),   // ms from a thing appearing to the thumb moving
  jitter: +flag('jitter', 90),  // one sigma on that
  beat: +flag('beat', 90),      // one sigma on the tap that has to land on a beat
  plan: flag('plan', 'points'),
  belts: flag('belts', 'white,blue,purple,black').split(','),
  window: flag('window', null),   // seconds to answer an attack; null = the game's own
  // What it costs to look somewhere else. A player is watching two men on a
  // mat, not the ring; the ring turning red is in the corner of his eye, and
  // the head turn is paid once, on the reaction that needs it. thumb.mjs has
  // had this since it was written and could never answer with it, because a
  // browser on a software rasteriser runs the match at a third of real time
  // and the delay is in match seconds either way — the whole measurement gets
  // a threefold discount it never earned. Here the clock is the loop, so the
  // cost is exactly what it says.
  attention: +flag('attention', 150),
  // How much of the training mode the hand has done, 0 to 3, as a flat level
  // on every move. The room hands a drilled move a few per cent (see
  // src/game/skills.js) and the question that number has to answer is asked
  // here: does a fully drilled player still meet the same ladder? A constant
  // rather than a store, because the interesting case is the top of it.
  skill: +flag('skill', 0),
  // How hard the left thumb leans, held for the whole match. The controls say
  // "the left thumb carries the base", and a player who reads that holds it.
  // It sat at 0.3 here without anybody asking what the number did, and it did
  // plenty: the hand that never touched the left half of the screen beat a
  // white belt 88% of the time, the one that held the base 44%. See the sweep
  // at the bottom.
  drive: +flag('drive', 0.3),
};
const WHY = args.includes('--why');
const SEED = seedRandom(flag('seed') !== null ? Number(flag('seed')) | 0 : 20260903);

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

let spare = null;
function gauss(sigma) {
  if (spare !== null) { const v = spare; spare = null; return v * sigma; }
  let u, v, s;
  do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const f = Math.sqrt(-2 * Math.log(s) / s);
  spare = v * f;
  return u * f * sigma;
}
const late = () => Math.max(0.05, (CFG.react + gauss(CFG.jitter)) / 1000);

/* ------------------------------------------------------------------ a hand */

// What a person does with the four labels and the red ring, and nothing else.
//
// Three habits, and every one of them costs time:
//
//   · a threat appears -> he looks, picks one of the doors the ring shows him,
//     and his thumb arrives `react` later. If the window shut in the meantime
//     the flick still goes; that is what a real late flick does.
//   · the ring is free -> he thinks for a beat, then takes a move by his plan.
//   · a lock -> he taps at the beat he can see coming, or swipes the way out.
class Hand {
  constructor(plan) {
    this.plan = plan;
    this.focus = null;    // what he is currently looking at
    this.timer = -1;      // seconds until the thumb lands
    this.dir = null;      // what it will land on
    this.what = null;     // 'deny' | 'move' | 'escape'
    this.tapped = false;  // this beat, already tapped
    this.target = 0;
    this.turns = 0;
  }

  update(dt, m) {
    if (m.state === 'over') return;

    if (m.state === 'sub') return this._sub(dt, m);

    // A threat: the ring turns red and shows what can be answered.
    const read = m.attempt && m.attempt.defender === 0 ? m.denyRead(0) : null;
    if (read && read.length) {
      if (this.what !== 'deny') {
        this.what = 'deny';
        this.timer = late() + this._turnTo('deny');
        // He can only pick from what he was shown. One door is a read, two is
        // a coin, four is a guess — which is exactly what denyRead promises.
        this.dir = read[randInt(read.length)];
      }
      this.timer -= dt;
      if (this.timer <= 0 && this.dir) { m.input(0, this.dir); this.dir = null; }
      return;
    }
    if (this.what === 'deny') { this.what = null; this.timer = -1; this.dir = null; }

    if (m.state !== 'live') return;

    // Offence. He is not holding the ring in his head: he looks at it, decides,
    // and moves — and the looking and deciding is the same delay as everything
    // else, plus the beat it takes to compare four labels.
    if (this.what !== 'move') {
      this.what = 'move';
      this.timer = late() + 0.25 + rand() * 0.35 + this._turnTo('move');
      this.dir = null;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.what = null;

    const opts = m.options(0);
    const dirs = Object.keys(opts);
    if (!dirs.length) return;
    const pv = m.preview(0);
    const pick = this._choose(dirs, pv, m);
    if (pick) m.input(0, pick);
    // And a hand on the collar between moves, because that is what the other
    // pad is for and a player who never touches it is not the player to
    // measure. Not every beat: it is a second thing to think about.
    else if (rand() < 0.3) m.grip(0);
  }

  // Turning the head from one thing to another, charged once per turn.
  _turnTo(kind) {
    if (this.focus === kind) return 0;
    this.focus = kind;
    this.turns++;
    return CFG.attention / 1000;
  }

  _choose(dirs, pv, m) {
    if (this.plan === 'random') return dirs[randInt(dirs.length)];
    const val = (d) => {
      const tr = pv[d];
      if (!tr) return -1;
      if (this.plan === 'likely') return tr.base;
      // 'arc': what the ring now prints beside each button — what it pays and
      // the chance the dice will use — and the plain sum a person does with
      // two numbers: take the most points per try. A submission is the match.
      // 'arc': the number the ring now prints beside each button, read the
      // way a person reads a percentage — take the likeliest. It does no
      // better than the table ever did (see the calibration below for why the
      // number still matters), and it is kept as the line that reads it.
      if (this.plan === 'arc') return m.chanceOf(tr, 0);
      // 'points': take a scoring move if one is offered, else the likeliest.
      return (tr.points > 0 ? 10 : 0) + tr.base;
    };
    let best = null, bv = -1;
    for (const d of dirs) { const v = val(d); if (v > bv) { bv = v; best = d; } }
    return best;
  }

  _sub(dt, m) {
    const s = m.sub;
    if (!s) return;
    if (s.attacker === 0) {
      // The beat is drawn as a closing ring, so it is anticipated, not reacted
      // to: nobody reacts inside 190 ms. He aims at the middle of the window
      // and misses it by his own timing.
      if (s.phase < 0.4) { this.tapped = false; this.target = 0.75 + gauss(CFG.beat / 1000 * 1.15); }
      if (!this.tapped && s.phase >= this.target) { this.tapped = true; m.subTap(0); }
      return;
    }
    // Underneath: the way out, if the lock is young enough to show one.
    const dir = m.visibleEscape(0);
    const shown = dir || DIRS[randInt(4)];
    if (this.what !== 'escape') {
      this.what = 'escape';
      this.timer = late() + this._turnTo('escape');
      this.dir = shown;
    }
    this.timer -= dt;
    if (this.timer <= 0) { m.input(0, this.dir); this.what = null; }
  }
}

/* --------------------------------------------------------------------- run */

function play(level, plan, drive = CFG.drive) {
  const m = new Match([new Fighter('вы'), new Fighter('соперник')],
    { time: MATCH_TIME, ...(CFG.window ? { denyWindow: +CFG.window } : {}),
      ...(CFG.skill ? { skill: (tr, by) => (by === 0 ? 1 + SKILL_STEP * CFG.skill : 1) } : {}) });
  const ai = new AI(1, level);
  const hand = new Hand(plan);
  m.start();
  const dt = 1 / 60;
  for (let t = 0; t < MATCH_TIME + 1 && m.state !== 'over'; t += dt) {
    hand.update(dt, m);
    ai.update(dt, m, (d) => m.input(1, d), () =>
      (m.state === 'sub' && m.sub.attacker === 1 ? m.subTap(1) : m.grip(1)));
    m.update(dt, [{ mx: 0, mz: 0, turn: 0, drive }, ai.control]);
  }
  return m;
}

// The ring prints a chance beside every button, and it has to be a chance
// the dice agree with. The number the press saw is on the tape (chanceOf at
// the instant of the press, before the attempt's own cost comes off), and the
// attempt it became is on the tape too; a denied attempt never rolled, so it
// is left out — the ring promises what happens if he does not read you.
const BANDS = [['red', 0, 0.35], ['amber', 0.35, 0.6], ['green', 0.6, 1.01]];
const cal = BANDS.map(() => ({ said: 0, n: 0, landed: 0 }));
function calibrate(m) {
  const seen = {};
  for (const e of m.tape) {
    if (e.k === 'press' && e.res === 'go' && e.chance != null) (seen[e.name] ||= []).push(e.chance);
    else if (e.k === 'try' && e.by === 0) {
      const q = (seen[e.name] || []).shift();
      if (q == null || e.res === 'denied') continue;
      const b = cal[BANDS.findIndex(([, lo, hi]) => q >= lo && q < hi)];
      b.n++; b.said += q; if (e.res === 'landed') b.landed++;
    }
  }
}

console.log(`${N} matches a belt, seed ${SEED}, plan "${CFG.plan}", ` +
  `hand ${CFG.react}±${CFG.jitter} ms` +
  (CFG.attention ? `, ${CFG.attention} ms to turn its head` : ', perfectly vigilant') + '\n');

const rows = [];
const t0 = Date.now();
for (const belt of CFG.belts) {
  const r = { belt, wins: 0, draws: 0, mine: 0, theirs: 0, d: null, agg: {} };
  for (let i = 0; i < N; i++) {
    const m = play(belt, CFG.plan);
    if (m.winner === 0) r.wins++;
    else if (m.winner === null) r.draws++;
    r.mine += m.f[0].points;
    r.theirs += m.f[1].points;
    const d = m.debrief();
    calibrate(m);
    for (const k of ['go', 'scoring', 'zero', 'arrived', 'held', 'dropped', 'droppedPts',
                     'denyOk', 'denyMiss', 'answerable', 'threats', 'nostam', 'queued', 'none']) {
      r.agg[k] = (r.agg[k] || 0) + d[k];
    }
    if (!r.d) r.d = d;
  }
  rows.push(r);
}
const ms = Date.now() - t0;

console.log('     belt      wins    очки     он');
for (const r of rows) {
  console.log(`     ${r.belt.padEnd(8)}  ${String(Math.round(r.wins / N * 100)).padStart(3)}%  ` +
    `${(r.mine / N).toFixed(1).padStart(6)}  ${(r.theirs / N).toFixed(1).padStart(5)}` +
    (r.draws ? `   ничьих ${Math.round(r.draws / N * 100)}%` : ''));
}
console.log(`\n     ${rows.length * N} matches in ${ms}ms`);

if (WHY) {
  console.log('\n     per match, what the hand did:');
  console.log('     belt      ходов  за очки  впустую  пришёл  удержал  упустил  защит');
  for (const r of rows) {
    const a = r.agg, p = (k) => (a[k] / N).toFixed(1).padStart(5);
    console.log(`     ${r.belt.padEnd(8)}  ${p('go')}  ${p('scoring')}   ${p('zero')}   ` +
      `${p('arrived')}   ${p('held')}   ${p('dropped')}   ` +
      `${a.answerable ? Math.round(a.denyOk / a.answerable * 100) : 0}%`);
  }
}

// The line. A player with an ordinary hand, playing the obvious sensible line —
// take the scoring move when one is offered — has to be able to beat the first
// opponent on the ladder more often than not. Everything above white is allowed
// to be hard; white is the tutorial with a belt on.
const white = rows.find((r) => r.belt === 'white');
if (white) {
  check(white.wins / N > 0.5, 'a person can beat a white belt',
    `${Math.round(white.wins / N * 100)}% of ${N}, ${(white.mine / N).toFixed(1)}:${(white.theirs / N).toFixed(1)}`);
}
// And the defence has to be a defence. This is the number that was one per cent
// while nothing in the battery was watching it: a window shorter than a hand
// turns half the game into a cutscene the player is asked to sit through.
const denied = rows.reduce((s, r) => s + r.agg.denyOk, 0);
const askable = rows.reduce((s, r) => s + r.agg.answerable, 0);
check(denied / Math.max(1, askable) > 0.4, 'and can answer what can be answered',
  `${Math.round(denied / Math.max(1, askable) * 100)}% of ${askable} readable attacks, ` +
  'across every belt');

// And the ladder still has to be a ladder: harder belts win more.
const wr = rows.map((r) => r.wins / N);
check(wr.every((v, i) => i === 0 || v <= wr[i - 1] + 0.12),
  'the ladder still goes one way', wr.map((v) => Math.round(v * 100) + '%').join(' > '));

// And the colours mean what they say. Each band's attempts have to land about
// as often as the ring said they would: within eight points on average, and
// inside the band itself — green is not allowed to land like amber.
console.log('\n     what the ring said, and what the dice did (attempts not denied):');
BANDS.forEach(([name, lo, hi], k) => {
  const b = cal[k];
  if (!b.n) return;
  const said = b.said / b.n, did = b.landed / b.n;
  console.log(`     ${name.padEnd(6)} ${String(b.n).padStart(6)} tries   said ${Math.round(said * 100)}%   landed ${Math.round(did * 100)}%`);
  check(Math.abs(did - said) < 0.08 && did >= lo - 0.05 && did < hi + 0.05,
    `the ${name} on the ring is honest`, `said ${Math.round(said * 100)}%, landed ${Math.round(did * 100)}%`);
});

// The left thumb has to be worth using.
//
// One of the two thumbs was a trap: holding the base cost stamina every second
// and bought a twelfth of a chance at the moment of a move, so the best thing
// to do with it was nothing. The sweep holds it at five levels for the whole
// match — the naive reading of "carry the base" — against the belts a new
// player actually meets. It has to pay to hold it somewhere in the middle, and
// by enough to be felt, not by noise.
{
  const LEVELS = [0, 0.25, 0.5, 0.75, 1];
  const M = 150;
  console.log(`\n     the left thumb held for the whole match, ${M} matches a cell:`);
  console.log('     belt      ' + LEVELS.map((d) => ('drive ' + d).padStart(11)).join(''));
  // White is in there to show the thumb does not hurt against the first man
  // on the ladder; the size of the gain is judged where there is room for
  // one. Against white the bare hand already wins five times in six, and ten
  // points above that is a ceiling rather than a lever.
  for (const belt of ['white', 'blue', 'purple']) {
    const w = LEVELS.map((d) => {
      let k = 0;
      for (let i = 0; i < M; i++) if (play(belt, CFG.plan, d).winner === 0) k++;
      return k / M;
    });
    console.log(`     ${belt.padEnd(8)}  ` + w.map((v) => (Math.round(v * 100) + '%').padStart(11)).join(''));
    const best = w.indexOf(Math.max(...w));
    check(best > 0, `holding the base pays against ${belt}`,
      `best at drive ${LEVELS[best]}, ${Math.round(w[best] * 100)}% against ${Math.round(w[0] * 100)}% without it`);
    if (belt !== 'white') check(Math.round((w[best] - w[0]) * 100) >= 10, `and by enough to feel against ${belt}`,
      `+${Math.round((w[best] - w[0]) * 100)} points, want at least 10`);
    // And not a throttle to floor: all of it has to cost more than some of it.
    check(w[w.length - 1] < w[best], `leaning with everything is not the answer against ${belt}`,
      `${Math.round(w[w.length - 1] * 100)}% at full lean`);
  }
}

console.log(fail ? `\n${fail} check(s) failed` : '\nthe game can be played');
process.exitCode = fail ? 1 : 0;
