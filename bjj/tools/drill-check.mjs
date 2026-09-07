// Is the room worth walking into?
//
// A training mode can fail in three ways and only one of them looks like a
// bug. It can offer a drill the ring cannot actually perform — the move is in
// the table but not under that role, so the player sits in a position pressing
// a button that is not there. It can offer one nobody can pass, which is worse
// than not offering it: the game asked you to do a thing sixty times and then
// said no. And it can hand back a bonus big enough that the ladder stops being
// a ladder, which is the failure a screenshot never shows.
//
// So: every drill is checked against the graph, every drill is played, and the
// bonus is measured on the ladder itself.
//
//   node bjj/tools/drill-check.mjs           the catalogue and every round
//   node bjj/tools/drill-check.mjs 60        that many runs a round
//   node bjj/tools/drill-check.mjs --worst   and name the ten hardest
import { Match, Fighter } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { POSES } from '../src/game/poses.js';
import { optionsFor } from '../src/game/positions.js';
import { seedRandom } from '../src/game/rng.js';
import { Drill, DRILLS, ROUNDS, REPS, NEED, drillOrder } from '../src/game/drills.js';
import { Skills, SKILL_MAX, SKILL_STEP, keyOf, NO_SKILL } from '../src/game/skills.js';

const args = process.argv.slice(2);
const N = +(args[0] > 0 ? args[0] : 40);
const WORST = args.includes('--worst');
seedRandom(20260907);

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/* ------------------------------------------------------ the catalogue --- */

// Every drill has to be a thing the ring will offer. The table is indexed by
// position and role; a drill whose move does not come back out of that index
// under the role the drill puts the player in is a drill you cannot press.
const broken = [];
for (const { tr } of DRILLS) {
  const p = POSES[tr.from];
  if (!p) { broken.push(`${tr.name}: ${tr.from} is not a pose`); continue; }
  if (!POSES[tr.to]) { broken.push(`${tr.name}: ${tr.to} is not a pose`); continue; }
  const tag = tr.role === 'any' ? 'top' : tr.role;
  const got = optionsFor(tr.from, tag)[tr.dir];
  if (got !== tr) broken.push(`${tr.name}: ${tr.from}/${tag}/${tr.dir} does not lead back to it`);
}
check(broken.length === 0, 'every drill is a move the ring offers',
  broken.length ? broken.slice(0, 3).join('; ') : `${DRILLS.length} drills`);

// The order the room shows them in has to be an order, not a shuffle: same
// store, same list, every time, or a player loses their place between visits.
const s0 = new Skills(false);
const a = drillOrder(s0).map((d) => keyOf(d.tr)).join(',');
const b = drillOrder(s0).map((d) => keyOf(d.tr)).join(',');
check(a === b, 'the list is in the same order twice running');
// And the least drilled really is first: that is the whole of the ordering
// rule and it is the one thing a player will notice if it stops being true.
const s1 = new Skills(false);
s1.raise(DRILLS[0].tr, 3);
check(keyOf(drillOrder(s1)[drillOrder(s1).length - 1].tr) === keyOf(DRILLS[0].tr),
  'a drill taken to three sinks to the bottom of the list');

/* --------------------------------------------------------- playing it --- */

// A hand that knows what it came for, and knows what it costs.
//
// It presses the drill's own button — but not before the move is worth
// pressing. A submission cold is worth a third of its nominal rate and a
// four-point position not much more; that is the game's oldest rule about the
// difference between a technique and a set-up, and a hand that ignores it
// measures a player who does not know how to play. So on those it fights for
// grips first, which is exactly what the middle round's own hint tells the
// player to do, and presses when it has them.
//
// The first version did not, and reported the triangle drill as impossible:
// zero passes in a hundred at a chance of one in ten. The drill was fine. The
// hand was pressing a submission on a man whose posture it had never touched.
function play(entry, round, belt) {
  const you = new Fighter('вы', { technique: 0.55, strength: 0.5, cardio: 0.55 });
  const opp = new Fighter('партнёр', { technique: 0.55, strength: 0.55, cardio: 0.5 });
  const m = new Match([you, opp], { time: 3600 });
  const ai = new AI(1, belt);
  const d = new Drill(entry, round, null);
  d.reset(m);
  m.start();
  const dt = 1 / 60;
  const control = { mx: 0, mz: 0, turn: 0, drive: 0.6 };
  // How long this rep has been setting up, so a hand that cannot get its grips
  // eventually goes anyway rather than standing there for four minutes.
  const setUp = d.tr.sub || d.tr.big;
  let since = 0, reps = d.tries;
  for (let t = 0; t < 240 && d.phase !== 'done'; t += dt) {
    if (d.tries !== reps) { reps = d.tries; since = 0; }
    since += dt;
    if (m.state === 'live' && d.phase === 'set' && !m.attempt) {
      const ready = !setUp || m.gripAdv[0] >= 0.7 || m.f[1].posture < 65 || since > 4;
      if (ready && m.options(0)[d.tr.dir] === d.tr) m.input(0, d.tr.dir);
      else m.grip(0);
    }
    if (d.partnerThinks) {
      ai.update(dt, m,
        (dir) => (d.letThrough(m) ? m.input(1, dir) : null),
        () => (d.letThrough(m)
          ? (m.state === 'sub' && m.sub.attacker === 1 ? m.subTap(1) : m.grip(1))
          : null));
    }
    m.update(dt, [control, d.partnerThinks ? ai.control : { mx: 0, mz: 0, turn: 0, drive: 0 }]);
    m.time = 3600;
    d.update(dt, m);
  }
  return d;
}

// The lines, and they are not drawn on the worst single drill.
//
// That was the first version and it was the trap this project keeps walking
// into: one number off the end of a distribution, measured over ten runs, is
// noise with a name. It condemned the whole cooperative round because the
// back take out of closed guard — the hardest edge in the graph, and labelled
// as such where it is written — came out at eight passes in ten.
//
// What actually matters is different for each round and none of it is the
// minimum:
//
//   на месте     every drill has to come off, because it is the first thing a
//                beginner meets and "the partner is standing still" failing is
//                the game telling him it is broken.
//   с защитой    the middle of the list has to come off, and nothing may be
//                impossible. A drill that takes four goes is a drill.
//   в спарринге  the same, lower: this round is supposed to be a fight.
const FLOOR = [0.6, 0.05, 0.02];    // no drill may be worse than this
const MID = [0.9, 0.7, 0.45];       // and the median has to be at least this

console.log(`\n${DRILLS.length} drills, ${N} runs a round, need ${NEED[0]} of ${REPS}\n`);
console.log('     round          passed   worst drill');
const rows = [];
for (let r = 0; r < ROUNDS.length; r++) {
  let pass = 0, runs = 0;
  const byDrill = [];
  for (const entry of DRILLS) {
    let hit = 0;
    for (let i = 0; i < N; i++) { if (play(entry, r, 'white').passed) hit++; }
    byDrill.push({ tr: entry.tr, rate: hit / N });
    pass += hit; runs += N;
  }
  byDrill.sort((x, y) => x.rate - y.rate);
  rows.push({ r, rate: pass / runs, byDrill });
  console.log(`     ${ROUNDS[r].title.padEnd(14)} ${(pass / runs * 100).toFixed(0).padStart(5)}%   ` +
    `${byDrill[0].tr.name} ${(byDrill[0].rate * 100).toFixed(0)}%`);
}
console.log('');
const work = [];
for (const row of rows) {
  const list = row.byDrill;
  const med = list[list.length >> 1].rate;
  const worst = list[0];
  check(worst.rate >= FLOOR[row.r] && med >= MID[row.r],
    `«${ROUNDS[row.r].title}» can be passed`,
    `median ${(med * 100).toFixed(0)}% (line ${(MID[row.r] * 100).toFixed(0)}), ` +
    `worst ${(worst.rate * 100).toFixed(0)}% on «${worst.tr.name}» from ${worst.tr.from} ` +
    `(line ${(FLOOR[row.r] * 100).toFixed(0)})`);
  // Under a quarter is still a drill somebody will bounce off four times.
  // Named with its number rather than hidden under a line drawn to fit it.
  const hard = list.filter((d) => d.rate < 0.25);
  if (hard.length) work.push(`${ROUNDS[row.r].title}: ${hard.length} under 25% ` +
    `(worst «${hard[0].tr.name}» ${(hard[0].rate * 100).toFixed(0)}%)`);
}
if (work.length) console.log(`\n     work list: ${work.join('; ')}`);

if (WORST) {
  console.log('\n     the ten that fight back hardest, cooperative round:');
  for (const d of rows[0].byDrill.slice(0, 10)) {
    console.log(`       ${d.tr.name.padEnd(22)} ${d.tr.from.padEnd(18)} ` +
      `base ${d.tr.base.toFixed(2)}  passed ${(d.rate * 100).toFixed(0)}%`);
  }
}

/* ------------------------------------------------- what it is worth ----- */

// The bonus, at the top of it. Not the whole ladder — human-check does that,
// and it does it with a hand that is late, which is the honest test. This is
// the arithmetic check beside it: a fully drilled move is worth what skills.js
// says it is worth and no more.
const s3 = new Skills(false);
s3.raise(DRILLS[0].tr, SKILL_MAX);
const m = new Match([new Fighter('a'), new Fighter('b')],
  { skill: (tr, by) => (by === 0 ? s3.bonus(tr) : 1) });
const base = new Match([new Fighter('a'), new Fighter('b')]);
const tr = DRILLS[0].tr;
const got = m.chanceOf(tr, 0) / base.chanceOf(tr, 0);
check(Math.abs(got - (1 + SKILL_STEP * SKILL_MAX)) < 0.02,
  'a drilled move is worth exactly what the store says',
  `${((got - 1) * 100).toFixed(0)}% on «${tr.name}», store says ${(SKILL_STEP * SKILL_MAX * 100).toFixed(0)}%`);
check(NO_SKILL.bonus(tr) === 1, 'and the opponent never gets one');
// The other side of the same coin: the store must not reach the man it is not
// about. A match built without a skill function is the ladder as it was.
check(base.chanceOf(tr, 1) === new Match([new Fighter('a'), new Fighter('b')]).chanceOf(tr, 1),
  'a match with no store is the match there was');

console.log(`\n${fail ? `${fail} check(s) failed` : 'the room is worth walking into'}`);
process.exitCode = fail ? 1 : 0;
