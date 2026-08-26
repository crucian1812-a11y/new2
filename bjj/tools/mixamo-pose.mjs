// Import a pose from a Mixamo clip.
//
//   node bjj/tools/mixamo-pose.mjs bjj/art/mixamo/situp-to-idle.fbx --at 1.2
//   node bjj/tools/mixamo-pose.mjs ... --at 2.1 --name SITUP --role B
//
// Prints a block in the shape src/game/poses.js uses, so a pose can be captured
// off a real clip instead of typed in degrees. It gives one fighter — a paired
// pose still needs the other half authored against it — but half a pose taken
// from motion capture beats a whole one guessed at.
//
// The transfer matches **bone directions in world space**, not rotations.
//
// Copying rotations is the obvious approach and it is wrong here, because a
// rotation is only meaningful relative to a rest pose and the two rigs do not
// share one: Mixamo binds in a T-pose with the arms out along X, this rig binds
// with the arms hanging down Y. Copy the delta and a standing figure comes out
// with its arms folded across its chest, which is exactly what the first
// version of this tool produced.
//
// Directions have no such problem. Where the Mixamo forearm points, this
// forearm is aimed, using the same solver the grips use. Bone lengths and rest
// poses drop out of it entirely. What is lost is twist about the bone's own
// axis, which the pose library barely uses and no grappling position reads.

import { readMixamo, readCurves, poseAt, clipLength } from './mixamo.mjs';
import { Skeleton, BONES, BONE_INDEX, BONE_COUNT, aimBone } from '../src/render/skeleton.js';
import { v3, v3set, v3norm, qEuler } from '../src/core/m4.js';

const argv = process.argv.slice(2);
const file = argv[0];
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
if (!file) {
  console.error('usage: mixamo-pose.mjs <clip.fbx> [--at seconds] [--name ID] [--role A|B]');
  process.exit(2);
}
const AT = +flag('at', 0);
const NAME = flag('name', 'IMPORTED');
const ROLE = flag('role', 'A');

// Which Mixamo bone each of ours follows, and which Mixamo bone it points at.
// Mixamo carries a finer spine and a full hand; several of its bones map onto
// one of ours, and aiming at a grandchild is how the extra links get absorbed.
const AIM = {
  spine: ['Spine', 'Spine2'],
  chest: ['Spine2', 'Neck'],
  neck: ['Neck', 'Head'],
  head: ['Head', 'HeadTop_End'],
  clavL: ['LeftShoulder', 'LeftArm'], armL: ['LeftArm', 'LeftForeArm'],
  foreL: ['LeftForeArm', 'LeftHand'], handL: ['LeftHand', 'LeftHandMiddle1'],
  clavR: ['RightShoulder', 'RightArm'], armR: ['RightArm', 'RightForeArm'],
  foreR: ['RightForeArm', 'RightHand'], handR: ['RightHand', 'RightHandMiddle1'],
  thighL: ['LeftUpLeg', 'LeftLeg'], shinL: ['LeftLeg', 'LeftFoot'],
  footL: ['LeftFoot', 'LeftToeBase'],
  thighR: ['RightUpLeg', 'RightLeg'], shinR: ['RightLeg', 'RightFoot'],
  footR: ['RightFoot', 'RightToeBase'],
};

const parsed = readMixamo(file);
const curves = readCurves(file, parsed);
const length = clipLength(curves);
const byName = new Map([...parsed.bones.values()].map((b) => [b.name.replace('mixamorig:', ''), b.id]));
const now = poseAt(parsed, curves, AT);
const posOf = (n) => {
  const id = byName.get(n);
  if (id === undefined) return null;
  const m = now.get(id);
  return [m[12], m[13], m[14]];
};

/* --------------------------------------------------------------- the pose */

const sk = new Skeleton();

// The hips carry the whole body's orientation, and that one *is* a rotation
// rather than a direction. Take it from two axes of the Mixamo pelvis: where
// it points up and where it faces.
{
  const hips = now.get(byName.get('Hips'));
  const up = v3norm(v3(), v3set(v3(), hips[4], hips[5], hips[6]));
  const fwd = v3norm(v3(), v3set(v3(), hips[8], hips[9], hips[10]));
  // Mixamo's pelvis frame has Y up the spine and Z out of the belly, the same
  // convention this rig uses, so the rotation transfers as it stands.
  const yaw = Math.atan2(fwd[0], fwd[2]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -up[2] * Math.cos(yaw) - up[0] * Math.sin(yaw))));
  const roll = Math.atan2(up[0] * Math.cos(yaw) - up[2] * Math.sin(yaw), up[1]);
  const d = 180 / Math.PI;
  qEuler(sk.rootRot, pitch * d, yaw * d, roll * d);
  sk.rootEuler = [pitch * d, yaw * d, roll * d].map((v) => +v.toFixed(1));
}

const theirTop = parsed.world.get(byName.get('HeadTop_End'))[13];
sk.pose();
const scale = sk.world[BONE_INDEX.headTop][13] / theirTop;

const hipsPos = posOf('Hips');
sk.rootPos[0] = hipsPos[0] * scale;
sk.rootPos[1] = hipsPos[1] * scale;
sk.rootPos[2] = hipsPos[2] * scale;
sk.pose();

// Aim every mapped bone, parents before children, so each one is solved against
// a parent that has already moved.
const dir = v3();
for (let i = 0; i < BONE_COUNT; i++) {
  const name = BONES[i][0];
  const pair = AIM[name];
  if (!pair) continue;
  const a = posOf(pair[0]);
  const b = posOf(pair[1]);
  if (!a || !b) continue;
  v3norm(dir, v3set(dir, b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  aimBone(sk, name, dir);
}

/* ------------------------------------------------------------- read it out */

// Back to the euler triple poses.js stores: qEuler builds Ry·Rx·Rz, so the
// angles come out in that order.
function quatToEulerYXZ(q) {
  const [x, y, z, w] = q;
  const m10 = 2 * (x * y + w * z);
  const m11 = 1 - 2 * (x * x + z * z);
  const m12 = 2 * (y * z - w * x);
  const m02 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + y * y);
  const m00 = 1 - 2 * (y * y + z * z);
  const m20 = 2 * (x * z - w * y);
  const sx = Math.max(-1, Math.min(1, -m12));
  const ax = Math.asin(sx);
  let ay, az;
  if (Math.abs(m12) > 0.9999) {
    ay = Math.atan2(-m20, m00);
    az = 0;
  } else {
    ay = Math.atan2(m02, m22);
    az = Math.atan2(m10, m11);
  }
  const d = 180 / Math.PI;
  return [ax * d, ay * d, az * d].map((v) => +v.toFixed(1));
}

const j = {};
for (let i = 1; i < BONE_COUNT; i++) {
  const name = BONES[i][0];
  const e = quatToEulerYXZ(sk.local[i]);
  if (Math.abs(e[0]) < 0.4 && Math.abs(e[1]) < 0.4 && Math.abs(e[2]) < 0.4) continue;
  j[name] = e;
}

const head = posOf('Head');
console.error(
  `# ${file.split('/').pop()}  ${AT.toFixed(2)}s of ${length.toFixed(2)}s   ` +
  `hips ${(hipsPos[1] * scale).toFixed(2)}m  head ${(head[1] * scale).toFixed(2)}m  ` +
  `scale ${scale.toFixed(4)}`
);

const rootPos = [sk.rootPos[0], sk.rootPos[1], sk.rootPos[2]].map((v) => +v.toFixed(3));
const order = BONES.map((b) => b[0]).filter((n) => j[n]);
console.log(`  // captured from ${file.split('/').pop()} at ${AT.toFixed(2)}s`);
console.log(`  ${NAME}: P('${NAME}', {`);
console.log(`    name: '${NAME}', label: '${NAME}',`);
console.log(`    points: 0, top: null, ground: ${rootPos[1] < 0.6},`);
console.log(`    ${ROLE}: {`);
console.log(`      root: { p: [${rootPos.join(', ')}], r: [${sk.rootEuler.join(', ')}] },`);
console.log('      j: {');
for (const n of order) console.log(`        ${n}: [${j[n].join(', ')}],`);
console.log('      },');
console.log('    },');
console.log('  }),');
