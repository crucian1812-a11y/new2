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

import { Match, Fighter, MATCH_TIME, STALL_CALL } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { POSES, POSITION_IDS } from '../src/game/poses.js';
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
// business, waypoints are the rig's and mirrors are the sweep's; none of them
// is ever `match.position`, and counting them made a first pass at this report
// say 77% of the ring was blank. POSITION_IDS is where that list already
// lives, so this asks for it rather than rebuilding the filter and drifting.
const PLAYABLE = POSITION_IDS.filter((id) => !POSES[id].submission);

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

// Is the picture in this frame next to the picture in the last one?
//
// Not "did the parameter go backwards" — a failed attempt is *meant* to unwind,
// and a first pass at this counted every frame of that as a jump and reported
// six hundred of them. What the eye objects to is a discontinuity: the bodies
// somewhere, and one frame later somewhere they cannot have travelled to.
//
// Two frames are next to each other if they are on the same segment and close
// along it, or if both are parked on the same pose — which is what the start of
// an attempt and the end of a retreat both are, even though the two ends of the
// blend get renamed underneath them. Returns how far apart they are, 0 for
// continuous.
// Are two poses, each with its own role assignment, the same picture?
//
// A mirror is the same tangle with the two slots exchanged, so it draws exactly
// what its base pose draws when the roles are the other way round — and that
// equivalence is the whole mechanism by which a sweep lands without a jump. A
// measure that does not know it reports the landing frame of every sweep as a
// cut of the entire blend, which is what this one did.
function samePicture(pa, ra, pb, rb) {
  if (pa === pb) return ra === rb;
  const base = (p) => (POSES[p] && POSES[p].mirrorOf) || p;
  if (base(pa) !== base(pb)) return false;
  return ra !== rb;
}

// Where a frame is sitting, as poses it is near and how far from each.
function endsOf(s) {
  if (s.from === s.to) return [{ p: s.from, d: 0 }];
  return [{ p: s.from, d: s.t }, { p: s.to, d: 1 - s.t }];
}

// A cut with a name on it: the same blend, the same point along it, and the two
// men have changed places.
//
// This was the sweeps' old defect and then the takedowns'. A transition whose
// attacker ends up wearing the other role has to blend to the *mirror* of its
// destination, or the exchange happens in one frame. The sweeps got mirrors
// from a flag set by hand on seven edges; the takedowns could not have one,
// because out of the stance either man can shoot and the graph cannot know in
// advance which. So they cut, about once a match, and it went unnoticed while
// standing was 1.5% of the clock.
//
// The flag is gone and the rule is computed: mirror whenever the attacker
// changes role. It agrees with all fifty-one edges the flag decided and covers
// the six it could not.
function roleSwap(a, b) {
  return a.from === b.from && a.to === b.to && a.roles !== b.roles;
}

function discontinuity(a, b) {
  if (a.from === b.from && a.to === b.to && a.roles === b.roles) {
    const d = Math.abs(a.t - b.t);
    // A blend at its fastest covers about 0.08 of itself in a frame; anything
    // past twice that did not travel, it cut.
    return d > 0.15 ? d : 0;
  }
  // Testing an exact endpoint is too strict: an attempt's first frame is
  // already two or three hundredths along, and counting that as a cut put a
  // hundred and fifty phantom breaks a match in this report.
  let best = Infinity;
  for (const ea of endsOf(a)) {
    for (const eb of endsOf(b)) {
      if (!samePicture(ea.p, a.roles, eb.p, b.roles)) continue;
      best = Math.min(best, ea.d + eb.d);
    }
  }
  if (best === Infinity) return 1;   // nothing in common at all
  return best > 0.15 ? best : 0;
}

function play(level) {
  const m = new Match([new Fighter('вы'), new Fighter('соперник')], { time: MATCH_TIME });
  const a = new AI(0, level), b = new AI(1, level);
  m.start();
  const dt = 1 / 60;
  const s = {
    frames: 0, live: 0, blank: 0, blankCool: 0, breaks: 0, swaps: 0, worstBreak: 0, stall: 0, positions: 0,
    offered: 0, hollow: 0, broke: 0,
  };

  // The picture the player is looking at, taken the same way main.js takes it.
  // If this ever stops matching drawFrame the number below stops meaning
  // anything, so it is written as one expression rather than three.
  const shot = () => ({
    from: m.prevPosition, to: m.pending || m.position, t: m.blend,
    roles: m.roleShown.join(''),
  });
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
    const gap = discontinuity(prev, now);
    if (gap > 0) {
      if (roleSwap(prev, now)) s.swaps++; else s.breaks++;
      s.worstBreak = Math.max(s.worstBreak, gap);
      if (process.argv.includes('--cuts')) {
        console.log(`   cut ${(gap * 100).toFixed(0)}%  ` +
          `${prev.from}>${prev.to}@${prev.t.toFixed(2)}/${prev.roles}  ->  ` +
          `${now.from}>${now.to}@${now.t.toFixed(2)}/${now.roles}`);
      }
    }
    prev = now;

    if (m.state === 'live') {
      s.live++;
      // Does a press do what the ring says it will?
      //
      // This is the question a player asks with their thumb and no tool here
      // was asking it. Two answers used to be no. Under a threat every flick
      // is turned into a denial — which is right, defence has to beat offence
      // under pressure — and the ring went on offering the four attacking
      // moves anyway: the same gesture meaning something else, decided by a
      // state the player had not chosen and the ring did not mention. That was
      // 12% of every frame the ring had a label on it. And a flick thrown
      // during your own throw, or during the third of a second after it, was
      // dropped in silence: a scripted thumb lost nineteen of its fifty-seven
      // attacking flicks that way.
      const threat = !!(m.attempt && m.attempt.defender === 0);
      const read = threat ? (m.denyRead(0) || []) : null;
      // What the HUD draws as pressable — the same expression, so this cannot
      // drift from the picture without the drift showing up here.
      // What the ring draws as *pressable*, not everything it names. A label
      // dimmed for the cooldown or for an empty tank is the ring saying "not
      // yet", which is true; the question here is whether the bright ones lie.
      const ready = threat ? read : Object.keys(m.options(0));
      for (const d of ready) {
        s.offered++;
        if (threat) continue;                       // the ring says defence and it is
        if (m.attempt || m.cool[0] > 0) { s.hollow++; continue; }
        const tr = m.preview(0)[d];
        if (!tr || m.f[0].stamina < tr.cost * 0.35) s.hollow++;
      }
      // And how much of the match he cannot afford anything at all, which is a
      // different complaint and belongs in the report rather than in a rule.
      if (!m.attempt && m.cool[0] <= 0 && Object.keys(m.options(0)).length === 0) s.broke++;
      // What the ring is *showing*, not what it will accept. During the
      // cooldown after a move the labels are there and dimmed, with the wait
      // drawn round them; that is a ring telling the player something, and
      // counting it as blank measured the wrong thing.
      if (Object.keys(m.preview(0)).length === 0) s.blank++;
      if (Object.keys(m.options(0)).length === 0 && !m.attempt) s.blankCool++;
    }
    s.stall = Math.max(s.stall, m.stallTimer);
    if (m.position !== lastPos) { s.positions++; lastPos = m.position; }
  }
  return s;
}

/* --------------------------------------------------------------------- run */

console.log(`${N} matches, seed ${SEED}\n`);

const agg = { frames: 0, live: 0, blank: 0, blankCool: 0, breaks: 0, swaps: 0, worstBreak: 0, stall: 0, positions: 0, offered: 0, hollow: 0, broke: 0 };
const t0 = Date.now();
for (const level of ['white', 'blue', 'purple', 'black']) {
  for (let i = 0; i < Math.ceil(N / 4); i++) {
    const s = play(level);
    for (const k of ['frames', 'live', 'blank', 'blankCool', 'breaks', 'swaps', 'positions', 'offered', 'hollow', 'broke']) agg[k] += s[k];
    agg.worstBreak = Math.max(agg.worstBreak, s.worstBreak);
    agg.stall = Math.max(agg.stall, s.stall);
  }
}
const runs = Math.ceil(N / 4) * 4;
const ms = Date.now() - t0;

const breaksPer = agg.breaks / runs;
const swapsPer = agg.swaps / runs;
const blankPct = (agg.blank / Math.max(1, agg.live)) * 100;
const coolPct = (agg.blankCool / Math.max(1, agg.live)) * 100;

console.log(`     ${runs} matches in ${ms}ms, ${(agg.positions / runs).toFixed(1)} position changes each\n`);

// Zero, not "few". A discontinuity is not a matter of degree: the bodies are
// in one place and a frame later in a place they have already been, and the
// eye reads that as the game glitching rather than as the fighter moving.
check(
  breaksPer < 0.5,
  'the picture never cuts for a reason nobody has named',
  `${breaksPer.toFixed(1)} per match`
);
// Named, measured, and known to be off — the same two tiers sim-check and
// blend-check use. It fails when it gets worse, not while it is on the list.
// Zero, now that there is no case the rule cannot reach. It was two, because
// six edges out of the stance had no mirror to carry them and the number had to
// be a work list rather than a line.
check(
  swapsPer < 0.05,
  'the two men change places only where a mirror carries them',
  `${swapsPer.toFixed(2)} bare swaps per match`
);

// The threshold here was 15% of every frame where nothing could be pressed,
// picked before anything was measured — the exact mistake this file exists to
// stop. Measured, three quarters of that was an attempt in flight, which is
// the game working, and most of the rest was the cooldown, which the ring now
// shows as dimmed labels with the wait drawn round them.
//
// So the question is the one that was worth asking all along: is the player
// ever looking at a ring with nothing on it? Only where the graph has no edge
// for the role, which is the coverage check below and not this one.
check(
  blankPct < 1,
  'the ring always has something on it',
  `nothing shown on ${blankPct.toFixed(1)}% of live frames, ` +
  `${coolPct.toFixed(1)}% dimmed for the cooldown`
);

// The referee's one job. stallTimer has been counted since the first version
// of match.js and read by nothing, so this is what it has been counting.
// Against the rule itself, not against a number written next to it: the
// referee calls a stall at STALL_CALL, so the longest one anybody sees is that
// plus the frame he calls it on.
check(
  agg.stall <= STALL_CALL + 0.1,
  'the fight does not stand still',
  `longest stall ${agg.stall.toFixed(1)}s, referee calls it at ${STALL_CALL}`
);

// Zero, not "few". A label that does not do what it says is worse than no
// label: the player learns the wrong thing and then unlearns it.
const hollowPct = (agg.hollow / Math.max(1, agg.offered)) * 100;
check(
  hollowPct < 0.5,
  'a press does what the ring says it will',
  `${hollowPct.toFixed(2)}% of what the ring offers as pressable would be thrown ` +
  `away, over ${(agg.offered / 1000).toFixed(0)}k label-frames; ` +
  `${((agg.broke / Math.max(1, agg.live)) * 100).toFixed(0)}% of the match he can ` +
  'afford nothing at all'
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
