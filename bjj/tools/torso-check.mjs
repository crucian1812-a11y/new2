// The spine, split into the three things it actually does.
//
// After the elbows were straightened a player asked what else in the library
// looks wrong, and five hypotheses were measured. Four found nothing:
//
//   a limb swung behind the body      2 of 120, both at the margin
//   a wrist or ankle turned over      the measure was junk, see below
//   a hand in the air holding nothing 0 — the library grips with almost every
//                                     hand, and the seven free ones are all
//                                     within five to ten centimetres of
//                                     something
//   a limb held straight as a stick   0 of 120; the straightest elbow in the
//                                     library is bent 37 degrees
//
// This is the fifth and it found something. It also took two tries, and the
// first try is the lesson: it measured the angle between the hips' up and the
// chest's up and called the result a lean. That is a mixture. Bending forward
// over somebody is most of what grappling is and a spine has eighty degrees of
// it; bending sideways runs out at about thirty-five. One number cannot hold
// both, and with them mixed thirteen torsos of thirty looked broken when the
// forward half of the number was doing nothing wrong.
//
// Split properly, in tools/torso.mjs so that pose-relax pays for exactly what
// this judges: the trunk's direction against the hips' own frame gives the
// forward bend and the sideways bend separately, and the chest's rotation about
// the trunk's length gives the twist.
//
// The numbers are a textbook person: eighty degrees forward, thirty back,
// thirty-five sideways, forty-five of rotation. They are the softest thing
// here — a limber person beats all four — so this reports a work list and does
// not fail the battery.
//
// Calibrated on the one pose whose answer is known: a man standing upright
// reads 9 degrees forward, 0 sideways, 0 twist. A frame that cannot say that
// is not worth reading further down.
//
//   node bjj/tools/torso-check.mjs           poses and blends, the summary
//   node bjj/tools/torso-check.mjs --all     every torso over a line
import { PairRig } from '../src/game/rig.js';
import { POSITION_IDS, HOLD_LOOPS } from '../src/game/poses.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { JUDGE_STEPS } from './grid.mjs';
import { readTorso, TORSO_LIM as LIM, torsoOver as over, torsoWhy } from './torso.mjs';

const ALL = process.argv.includes('--all');

const rig = new PairRig();
// The path, not a performance of it — the same line every judge here carries.
rig.live = false;

const rows = [];
function look(id, kind, from, to, t) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(from, to, t, 0.016);
  for (const role of ['A', 'B']) rows.push({ id, kind, role, t, ...readTorso(rig.skel[role]) });
}

for (const id of POSITION_IDS) look(id, 'pose', id, id, 1);
const seen = new Set();
for (const tr of TRANSITIONS) {
  for (const to of visualEnds(tr)) {
    const key = `${tr.from}>${to}`;
    if (tr.from === to || seen.has(key)) continue;
    seen.add(key);
    for (let i = 0; i < JUDGE_STEPS; i++) look(key, 'blend', tr.from, to, i / (JUDGE_STEPS - 1));
  }
}
for (const [pos, loop] of Object.entries(HOLD_LOOPS)) {
  for (const v of loop) {
    const key = `${pos}>${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let i = 0; i < JUDGE_STEPS; i++) look(key, 'hold', pos, v, i / (JUDGE_STEPS - 1));
  }
}

// One line per torso, not per sample.
const worst = new Map();
for (const r of rows) {
  const k = `${r.id}|${r.role}`;
  const was = worst.get(k);
  if (!was || over(r) > over(was)) worst.set(k, r);
}
const list = [...worst.values()].sort((a, b) => over(b) - over(a));
const bad = list.filter((r) => over(r) > 0);

for (const r of (ALL ? bad : bad.slice(0, 12))) {
  const at = r.kind === 'pose' ? '' : ` at t=${r.t.toFixed(2)}`;
  const why = torsoWhy(r);
  console.log(`  ${r.id.padEnd(30)} ${r.role}  fwd ${r.fwd.toFixed(0).padStart(4)}°  ` +
    `side ${r.side.toFixed(0).padStart(4)}°  twist ${r.tw.toFixed(0).padStart(4)}°   ${why}${at}`);
}
if (!ALL && bad.length > 12) console.log(`  … and ${bad.length - 12} more, --all for every one`);

const poses = bad.filter((r) => r.kind === 'pose').length;
console.log();
console.log(`${bad.length} of ${worst.size} torsos past what a textbook spine does` +
  `, ${poses} of them in a still pose`);
console.log(`limits: ${LIM.fwd}° forward, ${LIM.back}° back, ${LIM.side}° sideways, ${LIM.tw}° of rotation`);
console.log('a work list, not a line: a limber person beats all four');
