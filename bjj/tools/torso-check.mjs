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
// Split properly: the trunk's direction against the hips' own frame gives the
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
import { BONE_INDEX, quatFromMat } from '../src/render/skeleton.js';
import { JUDGE_STEPS } from './grid.mjs';
import { quat, qMul } from '../src/core/m4.js';

const ALL = process.argv.includes('--all');

// What a person's spine does, in degrees, one side each.
const LIM = { fwd: 80, back: 30, side: 35, tw: 45 };

const P = (sk, b) => { const m = sk.world[BONE_INDEX[b]]; return [m[12], m[13], m[14]]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const _qU = quat(), _qL = quat(), _qI = quat(), _qR = quat();

// Rotation of the chest on the hips, about the trunk's own length.
function twistOn(mUp, mLo, up) {
  quatFromMat(_qU, mUp);
  quatFromMat(_qL, mLo);
  _qI[0] = -_qU[0]; _qI[1] = -_qU[1]; _qI[2] = -_qU[2]; _qI[3] = _qU[3];
  qMul(_qR, _qL, _qI);
  const a = 2 * Math.atan2(_qR[0] * up[0] + _qR[1] * up[1] + _qR[2] * up[2], _qR[3]);
  return (Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI;
}

function read(sk) {
  // The hips' frame taken from the body rather than from matrix columns: up
  // the pelvis, across between the hip joints, forward from the two.
  const up = nrm(sub(P(sk, 'spine'), P(sk, 'hips')));
  const left = nrm(sub(P(sk, 'thighL'), P(sk, 'thighR')));
  const fwd = nrm(crs(left, up));
  const trunk = nrm(sub(P(sk, 'neck'), P(sk, 'spine')));
  const cf = dot(trunk, fwd), cs = dot(trunk, left), cu = dot(trunk, up);
  return {
    fwd: (Math.atan2(cf, cu) * 180) / Math.PI,
    side: (Math.atan2(cs, Math.hypot(cu, cf)) * 180) / Math.PI,
    tw: twistOn(sk.world[BONE_INDEX.hips], sk.world[BONE_INDEX.chest], up),
  };
}

const over = (r) => Math.max(
  r.fwd - LIM.fwd, -r.fwd - LIM.back,
  Math.abs(r.side) - LIM.side, Math.abs(r.tw) - LIM.tw,
);

const rig = new PairRig();
// The path, not a performance of it — the same line every judge here carries.
rig.live = false;

const rows = [];
function look(id, kind, from, to, t) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(from, to, t, 0.016);
  for (const role of ['A', 'B']) rows.push({ id, kind, role, t, ...read(rig.skel[role]) });
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
  const why = [
    r.fwd > LIM.fwd ? 'forward' : null,
    -r.fwd > LIM.back ? 'backward' : null,
    Math.abs(r.side) > LIM.side ? 'sideways' : null,
    Math.abs(r.tw) > LIM.tw ? 'twisted' : null,
  ].filter(Boolean).join('+');
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
