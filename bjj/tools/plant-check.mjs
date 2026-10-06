// Are a pose's feet where the pose puts them?
//
// Every judge of a pose looks at it after the rig is done with it, and one of
// the things the rig does is put the feet on the mat (rig._ground): a foot
// written under the floor is lifted back onto it by a two-bone solve whose
// plane is the thigh's own forward. The pose never sees that, and nothing
// measured it. The triangle's working variant drops the caught man 28 cm and
// leaves his legs where they were, so both feet are written a third of a
// metre under the mat, the clamp lifts them forty centimetres, and the solve
// turns his thigh 67° in its socket — the largest single source of hip-turn
// samples in hinge-check (52 of 82). With the clamp off the same loop turns
// the hip from 49° down to 21°.
//
// This reads, for every pose, how far the clamp lifts each foot. A foot the
// clamp has to lift a few centimetres is a foot pressed into the mat; one it
// lifts a hand's breadth or more is a leg written through the floor, and the
// knee and hip the clamp builds for it are the clamp's, not the pose's.
// Report only, for now: it is the measurer for the next piece of work.
//
//   node bjj/tools/plant-check.mjs

import { PairRig } from '../src/game/rig.js';
import { POSES } from '../src/game/poses.js';

const LINE = 0.03;

const rig = new PairRig();
rig.live = false;
const rows = [];
for (const id of Object.keys(POSES)) {
  // A mirror is its base with the roles swapped: the same feet.
  if (POSES[id].refereeOnly || POSES[id].mirrorOf) continue;
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(id, id, 1, 0.016);
  for (const role of ['A', 'B']) {
    for (const foot of ['footL', 'footR']) {
      const lift = rig._plant[role][foot] || 0;
      if (lift > LINE) rows.push({ lift, where: `${id} ${role}.${foot}` });
    }
  }
}
rows.sort((a, b) => b.lift - a.lift);
for (const r of rows) console.log(`${(r.lift * 100).toFixed(0).padStart(3)} cm  ${r.where}`);
console.log(`\n${rows.length} feet the pose writes more than ${LINE * 100} cm under the mat, lifted by the clamp`);
