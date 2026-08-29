// Pose lint. Runs the rig headless — no browser, no GPU — and asks of every
// paired pose the questions a person would ask looking at it:
//
//   is anybody through the mat?
//   is a hand somewhere an arm cannot reach?
//   are the two of them actually touching, or acting at a distance?
//   is either of them inside the other?
//
// Eyeballing fifteen poses in a contact sheet catches the gross errors. This
// catches the ones that only show up from the other side of the camera.

import { PairRig } from '../src/game/rig.js';
import { POSES } from '../src/game/poses.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { GRIP_POINTS } from '../src/render/body.js';
import { m4point, v3 } from '../src/core/m4.js';
import { violations } from '../src/game/intent.js';

const MAT_Y = 0.05;
const _t = v3();
// Shoulder to wrist on the rest skeleton, the same number rig.js uses.
const ARM = 0.52;
const rig = new PairRig();
const overlap = new Overlap();
// Knees are in the list because half the contact in this sport is a knee:
// knee on belly, a knee cutting through, a knee wedged in a hip.
const READ = [
  'headTop', 'handL', 'handR', 'footL', 'footR', 'hips', 'chest', 'shinL', 'shinR',
];

let problems = 0;
const rows = [];

for (const id of Object.keys(POSES)) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.time = 0;
  rig.apply(id, id, 1, 0.016);

  const info = { id, notes: [] };
  const pos = {};
  for (const role of ['A', 'B']) {
    const sk = rig.skel[role];
    pos[role] = {};
    for (const b of READ) {
      const m = sk.world[BONE_INDEX[b]];
      pos[role][b] = [m[12], m[13], m[14]];
    }
    // Through the floor. A little is fine — a shoulder digs into foam — but a
    // hip 8 cm under the mat is a pose nobody authored on purpose.
    for (const b of READ) {
      const y = pos[role][b][1];
      if (y < MAT_Y - 0.075) {
        info.notes.push(`${role}.${b} under the mat by ${((MAT_Y - y) * 100).toFixed(0)}cm`);
      }
    }
    // Is the hand on the thing it is holding?
    //
    // This is the claim the whole grip system exists to make — a hand on a
    // lapel stays on the lapel for the length of a pass — and nothing measured
    // it. Two different faults hide behind one number, so both are named:
    //
    //   out of reach  the pose asks for a grip the arm cannot make. The rig is
    //                 right to let go; the pose is what is wrong.
    //   loose         the target is within reach and the hand is not on it.
    //
    for (const g of POSES[id].grips || []) {
      if (g.role !== role) continue;
      const def = GRIP_POINTS[g.point];
      if (!def) continue;
      const other = rig.skel[g.self ? role : role === 'A' ? 'B' : 'A'];
      m4point(_t, other.world[BONE_INDEX[def[0]]], def[1]);
      const sh = sk.world[BONE_INDEX[g.hand === 'L' ? 'armL' : 'armR']];
      const h = sk.world[BONE_INDEX[g.hand === 'L' ? 'handL' : 'handR']];
      const reach = Math.hypot(sh[12] - _t[0], sh[13] - _t[1], sh[14] - _t[2]) / ARM;
      const gap = Math.hypot(h[12] - _t[0], h[13] - _t[1], h[14] - _t[2]);
      if (reach > 1.0) {
        info.notes.push(`${role}.hand${g.hand} cannot reach the ${g.point} it holds ` +
          `(${(reach * 100).toFixed(0)}% of the arm)`);
      } else if (gap > 0.06) {
        info.notes.push(`${role}.hand${g.hand} is ${(gap * 100).toFixed(0)}cm off the ${g.point} ` +
          `it holds, and could reach it (${(reach * 100).toFixed(0)}%)`);
      }
      info.grip = Math.max(info.grip || 0, reach > 1.0 ? 0 : gap);
    }

    // Arms that had to straighten to reach their grip.
    for (const [hand, sh] of [['handL', 'armL'], ['handR', 'armR']]) {
      const a = sk.world[BONE_INDEX[sh]];
      const h = sk.world[BONE_INDEX[hand]];
      const d = Math.hypot(h[12] - a[12], h[13] - a[13], h[14] - a[14]);
      // A joint lock straightens an arm on purpose; that is the technique.
      if (d > 0.515 && POSES[id].submission !== 'joint') {
        info.notes.push(`${role}.${hand} at full stretch (${(d * 100).toFixed(0)}cm)`);
      }
    }
  }

  // Contact. Two people in a grappling position are never more than a forearm
  // apart at their closest point; if they are, the pose is two solos.
  let closest = 1e9;
  for (const b of READ) {
    for (const c of READ) {
      const d = dist(pos.A[b], pos.B[c]);
      if (d < closest) closest = d;
    }
  }
  // Standing is the one pose where they are meant to be apart.
  if (closest > 0.34 && id !== 'STANDING') {
    info.notes.push(`no contact — closest pair is ${(closest * 100).toFixed(0)}cm`);
  }

  // Interpenetration, properly. Both bodies are covered by capsules down the
  // bones and every pair is tested. The old version compared two chest points
  // and passed everything, which is how fifteen poses shipped with limbs up to
  // 21 cm inside each other.
  const ov = overlap.measure(rig.skel.A, rig.skel.B);
  info.overlap = ov.deepest;
  // Contact the pose itself asked for is judged more loosely.
  //
  // A guillotine is an arm around a head — the pose says so in its own `hold`,
  // "the head is under the arm, that is the whole technique" — and a capsule
  // model has no way to represent an arm around anything: a forearm at the
  // throat and a head are two solids reading eight centimetres into each other
  // however carefully the pose is authored. Where the author has declared that
  // two parts must be near each other, they are allowed to be inside each other
  // rather further than parts that have no business touching at all.
  const declared = new Set();
  for (const h of POSES[id].hold || []) {
    if (h.of && h.near) declared.add([h.of, h.near].sort().join('|'));
  }
  const pair = ov.where && ov.where.replace(' in ', '|').split('|').sort().join('|');
  const limit = declared.has(pair) ? 0.12 : 0.08;
  if (ov.deepest > limit) {
    info.notes.push(`${(ov.deepest * 100).toFixed(0)}cm of ${ov.where} — a limb is inside a body`);
  }

  // Is it still the position it says it is? See intent.js — this catches the
  // failure the overlap number cannot, which is a pose that fixed its
  // collisions by quietly becoming a different position.
  for (const v of violations(rig.skel, POSES[id].hold, 0.04)) {
    info.notes.push(`not ${id} any more — ${v.why}`);
  }

  info.closest = closest;
  rows.push(info);
  problems += info.notes.length;
}

for (const r of rows) {
  const tag = r.notes.length ? '!' : ' ';
  console.log(
    `${tag} ${r.id.padEnd(15)} contact ${(r.closest * 100).toFixed(0).padStart(3)}cm` +
    `   deepest overlap ${(r.overlap * 100).toFixed(0).padStart(3)}cm`
  );
  for (const n of r.notes) console.log(`      · ${n}`);
}
// Does fatigue move the man?
//
// The rig carries three channels on top of the authored pose: effort, which is
// what he is doing this second; slack, which is his posture gone; and gas,
// which is what three minutes have done to him. Only the third is fatigue, and
// it is the one that has to be visible without a HUD bar — heavier breathing
// that does not stop when he stops, shoulders that lift with it, arms carried
// lower.
//
// Measured here rather than on screen because here it is exact. A frame
// comparison could not tell the feature from the renderer's own noise: see the
// note in tools/smoke.mjs.
const gasMove = (() => {
  let T = 3.0;
  const at = (gas) => {
    rig.effort.A = rig.effort.B = 0.2;
    rig.slack.A = rig.slack.B = 0;
    rig.gas.A = rig.gas.B = gas;
    rig.time = T;
    rig.invalidate('MOUNT');
    rig.apply('MOUNT', 'MOUNT', 1, 0.016);
    return READ.concat(['clavL', 'clavR', 'armL', 'armR', 'neck'])
      .map((b) => { const m = rig.skel.A.world[BONE_INDEX[b]]; return [m[12], m[13], m[14]]; });
  };
  // Over a whole breath, not at one instant of it: the two men are in phase at
  // the top of the cycle whatever their gas, and a reading taken there says
  // fatigue does nothing.
  let sum = 0, worst = 0, n = 0;
  for (let k = 0; k < 12; k++) {
    T = 3.0 + k * 0.11;
    const fresh = at(0), spent = at(1);
    for (let i = 0; i < fresh.length; i++) {
      const d = Math.hypot(fresh[i][0] - spent[i][0], fresh[i][1] - spent[i][1], fresh[i][2] - spent[i][2]);
      sum += d; n++;
      if (d > worst) worst = d;
    }
  }
  return { mean: sum / n, worst };
})();
const gasOk = gasMove.worst > 0.02 && gasMove.mean > 0.006;
if (!gasOk) problems++;
console.log(
  `${gasOk ? ' ' : '!'} fatigue moves the man ` +
  `${(gasMove.mean * 100).toFixed(1)}cm on average, ${(gasMove.worst * 100).toFixed(1)}cm at the most, ` +
  'with effort and posture held'
);

console.log(problems ? `\n${problems} problem(s)` : '\nall poses clean');
process.exit(problems > 0 ? 1 : 0);

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
