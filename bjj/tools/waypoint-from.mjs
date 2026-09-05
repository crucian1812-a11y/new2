// Take a pose off a blend.
//
// A waypoint is the true middle of a movement, and the middle of a movement is
// very hard to type: ACROSS, MOUNT_ENTRY and SIDE_ENTRY were each authored by
// hand against the rendered skeleton and each took a day. But the blend already
// goes through the middle — badly, with a thigh inside a thigh, which is the
// whole complaint — so the shape is *nearly* right and only the crossing is
// wrong. This lifts the pair out of the blend at whatever moment you name and
// prints it as a pose block; pose-relax then pushes the limbs out of each other
// while keeping everything else, and what comes out is the middle of the
// movement with the crossing gone.
//
// The runtime layers are off: no grips (they are IK and would be re-solved from
// the pose anyway), no foot planting, no procedural life, and no arc — the arc
// is a correction to a path, and this is authoring the path's middle.
//
//   node bjj/tools/waypoint-from.mjs STANDING OPEN_GUARD_X 0.85 GUARD_ENTRY

import { PairRig } from '../src/game/rig.js';
import { POSES } from '../src/game/poses.js';
import { ARCS, VIAS } from '../src/game/arcs.js';
import { BONES, BONE_COUNT } from '../src/render/skeleton.js';

const [from, to, tArg, name] = process.argv.slice(2);
if (!POSES[from] || !POSES[to]) {
  console.error('usage: waypoint-from.mjs FROM TO t NAME');
  process.exit(1);
}
const t = +tArg;
const id = name || 'WAYPOINT';

// qEuler builds Ry·Rx·Rz, so the angles come back out in that order. Same
// conversion tools/mixamo-pose.mjs uses to read a pose off an animation.
function quatToEulerYXZ(q) {
  const [x, y, z, w] = q;
  const m10 = 2 * (x * y + w * z);
  const m11 = 1 - 2 * (x * x + z * z);
  const m12 = 2 * (y * z - w * x);
  const m02 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + y * y);
  const m00 = 1 - 2 * (y * y + z * z);
  const m20 = 2 * (x * z - w * y);
  const ax = Math.asin(Math.max(-1, Math.min(1, -m12)));
  let ay, az;
  if (Math.abs(m12) > 0.9999) { ay = Math.atan2(-m20, m00); az = 0; }
  else { ay = Math.atan2(m02, m22); az = Math.atan2(m10, m11); }
  const d = 180 / Math.PI;
  return [ax * d, ay * d, az * d].map((v) => +v.toFixed(1));
}

const rig = new PairRig();
rig.plantFeet = false;
rig._grips = () => {};
rig._step = () => {};
rig._ground = () => {};
// No correction: the middle of the straight path is what is being authored.
for (const k of Object.keys(ARCS)) if (k === `${from}>${to}`) delete ARCS[k];
delete VIAS[`${from}>${to}`];
rig.rewind();
rig.applyAt(from, to, t, 0.016);

const out = [];
out.push(`  ${id}: P('${id}', {`);
out.push(`    name: '',`);
out.push(`    label: '${to.replace(/_X$/, '').replace(/_/g, ' ')}',`);
out.push(`    points: 0, top: '${POSES[to].top || 'A'}', ground: true, waypoint: true,`);
for (const role of ['A', 'B']) {
  const sk = rig.skel[role];
  const e = quatToEulerYXZ(sk.rootRot);
  out.push(`    ${role}: {`);
  out.push(`      root: { p: [${[sk.rootPos[0], sk.rootPos[1], sk.rootPos[2]]
    .map((v) => +v.toFixed(3)).join(', ')}], r: [${e.join(', ')}] },`);
  const parts = [];
  // From 0: the hips carry a joint rotation of their own in this format.
  for (let i = 0; i < BONE_COUNT; i++) {
    const q = sk.local[i];
    const a = quatToEulerYXZ(q);
    if (Math.abs(a[0]) < 0.4 && Math.abs(a[1]) < 0.4 && Math.abs(a[2]) < 0.4) continue;
    parts.push(`${BONES[i][0]}: [${a.join(', ')}]`);
  }
  out.push('      j: {');
  for (let i = 0; i < parts.length; i += 3) {
    out.push(`        ${parts.slice(i, i + 3).join(', ')},`);
  }
  out.push('      },');
  out.push('    },');
}
out.push('  }),');
console.log(out.join('\n'));
