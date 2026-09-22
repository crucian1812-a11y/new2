// Is the walk onto the mat worth watching, and does it hand over cleanly?
//
// The walkout is the one piece of motion in this game that no existing judge
// covers. pose-check judges the library, blend-check judges the paths between
// its poses, and both of them start from the premise this thing breaks: two
// bodies in contact, driven by paired poses. Two men walking towards each other
// are neither.
//
// So it is judged on the same four things everything else here is judged on,
// with the definitions taken from wherever they already live rather than
// written again:
//
//   мат          how far skin goes under the tatami — tools/mat-model.mjs, the
//                same model arc-solve solves against and blend-check judges by
//   внутри       the deepest interpenetration between the two of them —
//                src/game/collide.js, the same capsules everything else uses
//   скольжение   the supporting foot's speed and how much of the time a foot is
//                planted — the definition in pose-check, word for word, because
//                a man crossing a mat with his soles glued to it is the most
//                visible wrong thing a frame can hold
//   встреча      whether the two right hands actually make contact during the
//                greeting, and how deep. Judged exactly the way pose-check
//                judges a contact a pose declared: it has to happen at all, and
//                it may be as deep as GRIP_ALLOW and no deeper. The first
//                version of this measured fingertip to fingertip and read 7 cm
//                for two hands that were already clasped — a distance between
//                two points inside each other is not a gap.
//   стык         the jump into the first frame of the fight
//
// The fourth is the one worth explaining. A seam there is the single jerk every
// player sees, every match, and it has no natural threshold — so it is judged
// against the walkout's own busiest frame rather than against a number somebody
// picked. If the handover moves a joint no further than the walk's own fastest
// moment does, there is nothing there to see. That is the same sentence
// blend-check makes about a transition and its ends, and it is here for the
// same reason.
//
// The other half of this file used to be the title card: a man standing on it,
// breathing, judged on three numbers that said he was not a photograph. He is
// gone — the title card is six pictures of real positions now, and a picture is
// judged on whether it is worth looking at rather than on whether it moves. See
// tools/poster-check.mjs, which took those lines' place.
//
//   node bjj/tools/intro-check.mjs           every number
//   node bjj/tools/intro-check.mjs --frames  what happens when
import { Walkout, INTRO_TIME, PHASES } from '../src/game/intro.js';
import { PairRig } from '../src/game/rig.js';
import { BONE_COUNT, BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { SUNK, skinUnder } from './mat-model.mjs';
import { pairKey, GRIP_ALLOW } from './grip-pairs.mjs';

const FRAMES = process.argv.includes('--frames');
const DT = 1 / 60;
// Where the mat is, the same height pose-check and blend-check read it at.
const MAT_Y = 0.05;

const walk = new Walkout();
walk.reset();
const overlap = new Overlap();

// What a walker's joints were doing last frame, so a step can be measured.
const prev = { A: null, B: null };
const snap = (sk) => sk.world.map((m) => [m[12], m[13], m[14]]);

let sunk = 0, sunkAt = 0, sunkWho = '';
let inside = 0, insideAt = 0, insideWhere = '';
// The planted-foot pair, pose-check's definition: the slower foot is the one
// taking the weight, and a foot within 15 cm/s of standing still is planted.
const speeds = [];
let still = 0, feet = 0;
// And the busiest thing any joint does between two frames of the walk itself,
// which is what the seam is judged against.
let busiest = 0, busiestAt = 0;
const footPrev = {};
// And the greeting: the closest the two right hands come while it is happening.
// Measured on the fingertip rather than the wrist, because what has to touch is
// the hand and the wrist of a clasped hand is a palm's width away from the
// other man's.
let meet = 0, meetAt = 0;
const GREET_FROM = PHASES.in;
const GREET_TO = PHASES.in + PHASES.slap + PHASES.bump;
// The contact the greeting is for. Everything on either right hand, against
// everything on the other's — one declared pair, the same idea grip-pairs.mjs
// carries for a pose that says which hand is holding what.
const HAND = new Set(['handR', 'fingR', 'handRTip']);
const isGreeting = (where) => {
  const [a, b] = (where || '').replace(' in ', '|').split('|');
  return HAND.has((a || '').slice(2)) && HAND.has((b || '').slice(2));
};

const rows = [];
// One frame past the end, so the last sample is the picture that actually hands
// over. Frames, not seconds: the walkout's length is seconds and the two do not
// divide, and a loop whose bound was the clamped time never ended at all.
const STEPS = Math.ceil(INTRO_TIME / DT) + 1;
for (let i = 0; i < STEPS; i++) {
  const now = Math.min(INTRO_TIME, i * DT);
  if (i > 0) walk.update(DT);
  for (const [role, e] of [['A', walk.a], ['B', walk.b]]) {
    const sk = e.skel;
    for (const b of SUNK) {
      const u = skinUnder(sk, b);
      if (u > sunk) { sunk = u; sunkAt = now; sunkWho = `${role}.${b}`; }
    }
    const ps = snap(sk);
    if (prev[role]) {
      for (let j = 0; j < ps.length; j++) {
        const d = Math.hypot(
          ps[j][0] - prev[role][j][0], ps[j][1] - prev[role][j][1], ps[j][2] - prev[role][j][2]);
        if (d > busiest) { busiest = d; busiestAt = now; }
      }
    }
    prev[role] = ps;
    // Feet, once they are both actually on the mat — the first frame has no
    // previous one to be measured against.
    for (const b of ['footL', 'footR']) {
      const m = sk.world[BONE_INDEX[b]];
      const k = role + b;
      const was = footPrev[k];
      if (was) {
        const v = Math.hypot(m[12] - was[0], m[14] - was[2]) / DT;
        footPrev[k + 'v'] = v;
      }
      footPrev[k] = [m[12], m[13], m[14]];
    }
  }
  // The slower of a man's two feet is the one he is standing on.
  if (i > 2) {
    for (const role of ['A', 'B']) {
      const vs = ['footL', 'footR'].map((b) => footPrev[role + b + 'v']).filter((v) => v != null);
      if (vs.length === 2) {
        speeds.push(Math.min(vs[0], vs[1]));
        feet += 2;
        for (const v of vs) if (v < 0.15) still++;
      }
    }
  }
  // Everything touching everything, split into the one contact this thing is
  // for and all the ones it is not — the same split pose-check makes between a
  // grip a pose declared and two bodies simply inside each other.
  const greeting = now >= GREET_FROM && now <= GREET_TO;
  for (const p of overlap.all(walk.a.skel, walk.b.skel)) {
    if (greeting && isGreeting(p.where)) {
      if (p.pen > meet) { meet = p.pen; meetAt = now; }
    } else if (p.pen > inside) {
      inside = p.pen; insideAt = now; insideWhere = p.where;
    }
  }
  const ov = { deepest: inside, where: insideWhere };
  if (FRAMES && i % 12 === 0) {
    rows.push(`   t=${now.toFixed(2)}  z ${walk.a.z.toFixed(2)} / ${walk.b.z.toFixed(2)}` +
      `   apart ${(walk.b.z - walk.a.z).toFixed(2)}m   inside ${(ov.deepest * 100).toFixed(1)}cm`);
  }
}
// The seam. The rig, started the way main.js starts it, held at STANDING for
// one frame — that is the first picture of the fight — against the last frame
// of the walk.
const rig = new PairRig();
rig.live = false;
rig.effort.A = rig.effort.B = 0;
rig.slack.A = rig.slack.B = 0;
rig.rewind();
rig.origin[0] = 0; rig.origin[2] = 0; rig.yaw = 0;
rig.applyAt('STANDING', 'STANDING', 1, DT);

let seam = 0, seamWhere = '';
for (const [role, e] of [['A', walk.a], ['B', walk.b]]) {
  const from = e.skel, to = rig.skel[role];
  for (let j = 0; j < BONE_COUNT; j++) {
    const a = from.world[j], b = to.world[j];
    const d = Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
    if (d > seam) {
      seam = d;
      seamWhere = `${role}.${Object.keys(BONE_INDEX).find((k) => BONE_INDEX[k] === j) || j}`;
    }
  }
}

speeds.sort((a, b) => a - b);
const median = speeds[speeds.length >> 1] ?? 0;
const planted = feet ? still / feet : 0;

if (FRAMES) for (const r of rows) console.log(r);

// The lines. Each one carries what it is judged against, because a number with
// no line beside it is a number nobody can act on.
const say = (ok, name, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(12)} ${text}`);
  return ok;
};
let bad = 0;

console.log();
if (!say(sunk <= 0.06, 'мат',
  `${(sunk * 100).toFixed(1)}cm of skin under the tatami (line 6cm)` +
  (sunk > 0.005 ? `, ${sunkWho} at t=${sunkAt.toFixed(2)}` : ''))) bad++;
if (!say(inside <= 0.08, 'внутри',
  `${(inside * 100).toFixed(1)}cm of one inside the other (line 8cm, a still pose's own)` +
  (inside > 0.005 ? `, ${insideWhere} at t=${insideAt.toFixed(2)}` : ''))) bad++;
if (!say(median < 0.15 && planted > 0.35, 'скольжение',
  `the supporting foot moves ${median.toFixed(2)} m/s and a foot is planted ` +
  `${(planted * 100).toFixed(0)}% of the time (lines 0.15 and 35%)`)) bad++;
if (!say(meet > 0 && meet <= GRIP_ALLOW, 'встреча',
  meet > 0
    ? `the hands meet, ${(meet * 100).toFixed(1)}cm of one in the other at t=${meetAt.toFixed(2)} ` +
      `(may be as deep as ${(GRIP_ALLOW * 100).toFixed(0)}cm, the same as a grip a pose declares)`
    : 'the hands never touch — two men greeting the air')) bad++;
if (!say(seam <= busiest, 'стык',
  `the handover moves a joint ${(seam * 100).toFixed(1)}cm, against ${(busiest * 100).toFixed(1)}cm ` +
  `in the walk's own busiest frame (t=${busiestAt.toFixed(2)})` +
  (seam > 0.001 ? `, worst ${seamWhere}` : ''))) bad++;

console.log();
console.log(`${INTRO_TIME.toFixed(2)}s of walkout, judged on what the rest of the game is judged on`);

if (bad) process.exitCode = 1;
