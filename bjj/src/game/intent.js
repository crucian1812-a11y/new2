// What a position means, in a form a machine can check.
//
// The collision solver made the poses stop overlapping and in two places it did
// it by sliding the top man off to the side, because "not inside each other" is
// satisfied just as well by side control as by mount. From overhead the mount
// had both knees on the same side of the man underneath. The solver was not
// wrong; it was told half the problem.
//
// This is the other half. Each position declares the handful of facts that make
// it that position and not a neighbouring one — the mounted man's hips are over
// his opponent's hips and his knees are on opposite sides, the man in back
// control is behind and above, the man passing the guard has his shoulder past
// the far hip. Three predicates cover all of it:
//
//   above     one point is at least this far over another, vertically
//   below     one point is no higher than this off the mat
//   near      one point is within this far of another, along the mat
//   straddle  two points are on opposite sides of a body's own left-right axis
//
// The pose solver pays for breaking them and pose-check reports them, so a pose
// that drifts out of its own position says so instead of quietly becoming a
// different position with the right label on it.

import { BONE_INDEX } from '../render/skeleton.js';

function point(skel, ref) {
  const [role, bone] = ref.split('.');
  const m = skel[role].world[BONE_INDEX[bone]];
  return [m[12], m[13], m[14]];
}

// A bone's own left-right axis, in the world. For the torso bones this is the
// direction the body is wide in, which is the axis a knee has to be one side of.
function lateral(skel, ref) {
  const [role, bone] = ref.split('.');
  const m = skel[role].world[BONE_INDEX[bone]];
  const l = Math.hypot(m[0], m[1], m[2]) || 1;
  return [m[0] / l, m[1] / l, m[2] / l];
}

// Each returns how badly it is broken, in metres. Zero means satisfied.
//
// `slack` is what the report allows and the solver does not. These are design
// intent rather than physical law, and the rig adds breathing and effort on top
// of every pose, so three centimetres either way is not a position turning into
// a different position. The solver is given no slack at all, so it keeps
// pushing towards the middle of the constraint instead of parking on its edge.
export function violations(skel, hold, slack = 0) {
  const out = [];
  for (const h of hold || []) {
    if (h.above) {
      const a = point(skel, h.of), b = point(skel, h.above);
      const gap = a[1] - b[1];
      const miss = (h.by ?? 0.15) - gap - slack;
      if (miss > 0) out.push({ miss, why: `${h.of} is only ${(gap * 100).toFixed(0)}cm above ${h.above}` });
    } else if (h.below !== undefined) {
      const a = point(skel, h.of);
      const miss = a[1] - h.below - slack;
      if (miss > 0) out.push({ miss, why: `${h.of} is ${(a[1] * 100).toFixed(0)}cm up in the air` });
    } else if (h.near) {
      const a = point(skel, h.of), b = point(skel, h.near);
      const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
      const miss = d - (h.within ?? 0.25) - slack;
      if (miss > 0) out.push({ miss, why: `${h.of} is ${(d * 100).toFixed(0)}cm from ${h.near} across the mat` });
    } else if (h.straddle) {
      const o = point(skel, h.straddle);
      const lat = lateral(skel, h.straddle);
      const m = h.by ?? 0.09;
      const side = (ref) => {
        const p = point(skel, ref);
        return (p[0] - o[0]) * lat[0] + (p[1] - o[1]) * lat[1] + (p[2] - o[2]) * lat[2];
      };
      const s1 = side(h.with[0]), s2 = side(h.with[1]);
      // Either assignment of the two points to the two sides will do; take the
      // one that is closer to true, so the solver is not asked to swap legs.
      const one = Math.max(0, m - s1) + Math.max(0, s2 + m);
      const other = Math.max(0, m - s2) + Math.max(0, s1 + m);
      const miss = Math.min(one, other) - slack;
      if (miss > 0.001) {
        out.push({ miss, why: `${h.with[0]} and ${h.with[1]} are the same side of ${h.straddle}` });
      }
    }
  }
  return out;
}

export function intentCost(skel, hold) {
  let c = 0;
  for (const v of violations(skel, hold)) c += v.miss * v.miss;
  return c;
}
