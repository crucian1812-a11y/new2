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

const MAT_Y = 0.05;
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
  if (ov.deepest > 0.08) {
    info.notes.push(`${(ov.deepest * 100).toFixed(0)}cm of ${ov.where} — a limb is inside a body`);
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
console.log(problems ? `\n${problems} problem(s)` : '\nall poses clean');
process.exit(problems > 0 ? 1 : 0);

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
