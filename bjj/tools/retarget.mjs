// Putting somebody else's pose on our skeleton.
//
// Lifted out of mixamo-pose.mjs unchanged, because a second importer needs it:
// the paired animation packs are GLB rather than FBX and carry two figures, but
// the transfer is the same transfer.
//
// It matches **bone directions in world space**, not rotations.
//
// Copying rotations is the obvious approach and it is wrong, because a rotation
// is only meaningful relative to a rest pose and no two rigs share one: Mixamo
// binds in a T-pose with the arms out along X, this rig binds with the arms
// hanging down Y. Copy the delta and a standing figure comes out with its arms
// folded across its chest, which is what the first version of the FBX importer
// produced.
//
// Directions have no such problem. Where their forearm points, ours is aimed,
// with the same solver the grips use. Bone lengths and rest poses drop out of
// it. What is lost is twist about the bone's own axis, which the pose library
// barely uses and no grappling position reads.

import { BONES, BONE_COUNT, aimBone } from '../src/render/skeleton.js';
import { v3, v3set, v3norm, qEuler } from '../src/core/m4.js';

// Which of their bones each of ours follows, and which one it points at. Their
// rigs carry a finer spine and a full hand; several of their bones map onto one
// of ours, and aiming at a grandchild is how the extra links get absorbed. The
// target may be a list, because the hand tip is called something different in
// every export.
export const AIM = {
  spine: ['Spine', 'Spine2'],
  chest: ['Spine2', 'Neck'],
  neck: ['Neck', 'Head'],
  head: ['Head', ['HeadTop_End', 'Head_End']],
  clavL: ['LeftShoulder', 'LeftArm'], armL: ['LeftArm', 'LeftForeArm'],
  foreL: ['LeftForeArm', 'LeftHand'],
  handL: ['LeftHand', ['LeftHandMiddle1', 'LeftHandIndex1', 'LeftHandThumb1']],
  clavR: ['RightShoulder', 'RightArm'], armR: ['RightArm', 'RightForeArm'],
  foreR: ['RightForeArm', 'RightHand'],
  handR: ['RightHand', ['RightHandMiddle1', 'RightHandIndex1', 'RightHandThumb1']],
  thighL: ['LeftUpLeg', 'LeftLeg'], shinL: ['LeftLeg', 'LeftFoot'],
  footL: ['LeftFoot', 'LeftToeBase'],
  thighR: ['RightUpLeg', 'RightLeg'], shinR: ['RightLeg', 'RightFoot'],
  footR: ['RightFoot', 'RightToeBase'],
};

const first = (posOf, names) => {
  for (const n of [names].flat()) {
    const p = posOf(n);
    if (p) return p;
  }
  return null;
};

// The hips carry the whole body's orientation, and that one *is* a rotation
// rather than a direction: taken from two axes of their pelvis, where it points
// up and where it faces. Both rigs here put Y up the spine and Z out of the
// belly, so it transfers as it stands.
export function rootFromHips(sk, hips) {
  const up = v3norm(v3(), v3set(v3(), hips[4], hips[5], hips[6]));
  const fwd = v3norm(v3(), v3set(v3(), hips[8], hips[9], hips[10]));
  const yaw = Math.atan2(fwd[0], fwd[2]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -up[2] * Math.cos(yaw) - up[0] * Math.sin(yaw))));
  const roll = Math.atan2(up[0] * Math.cos(yaw) - up[2] * Math.sin(yaw), up[1]);
  const d = 180 / Math.PI;
  qEuler(sk.rootRot, pitch * d, yaw * d, roll * d);
  sk.rootEuler = [pitch * d, yaw * d, roll * d].map((v) => +v.toFixed(1));
}

// Aim every mapped bone, parents before children, so each one is solved against
// a parent that has already moved.
export function aimAll(sk, posOf) {
  const dir = v3();
  for (let i = 0; i < BONE_COUNT; i++) {
    const name = BONES[i][0];
    const pair = AIM[name];
    if (!pair) continue;
    const a = first(posOf, pair[0]);
    const b = first(posOf, pair[1]);
    if (!a || !b) continue;
    v3norm(dir, v3set(dir, b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    aimBone(sk, name, dir);
  }
}
