// A foot that is not moving stays where it was put.
//
// Everything on this mat that crosses it has to do this, and until now two
// things did it with two copies of the same twenty lines: the pair rig, and the
// referee. The walkout wanted a third, which is the point at which a copy stops
// being a copy and starts being the mistake this project keeps paying for — a
// definition in two places, drifting, with nobody watching the gap.
//
// So the planner is here, and the numbers are the caller's. The referee and the
// walkout share both; the pair rig keeps its own copy and its own numbers, and
// that is deliberate rather than unfinished: its planner is tangled with the
// ground clamp that lifts a pair until the knees are on the tatami, and its
// numbers are load-bearing for three measurements in the battery (the planted
// foot in pose-check, the hover in weight-check, the jerk in shake-check).
// Moving it is its own task with its own measurement, not a side effect of a
// title card.
//
// What the numbers mean, and why they are related rather than free:
//
//   STRIDE  how far a foot may be dragged before it picks itself up
//   SWING   how long it spends in the air
//   LIFT    how high the arc goes
//   LEAD    how far past the body's own travel it lands, so the step arrives
//           ahead of where the man is going rather than under where he was
//
// STRIDE and SWING are matched so that a planted foot outlasts the other's
// swing at the walker's top speed. A stride of 0.44 m and a swing of 0.30 s
// leave the stance at 0.34 s at 1.3 m/s, and the foot is there to be seen. The
// referee's first numbers were 0.26 and 0.30, and at anything past a slow walk
// the swing outlasted the stance, both feet left the mat at once, and he
// crossed the tatami on castors.
import { solveTwoBone } from '../render/skeleton.js';
import { v3, v3set } from '../core/m4.js';

// What a walk is, for anybody who does not want to name four numbers.
export const WALK = { STRIDE: 0.44, SWING: 0.30, LIFT: 0.07, LEAD: 1.4 };

const NAMES = [['thighL', 'shinL', 'footL'], ['thighR', 'shinR', 'footR']];

// The state a pair of feet carries between frames. One per walker.
export const makeFeet = () => [0, 1].map(() => ({
  at: v3(0, 0, 0), from: v3(0, 0, 0), to: v3(0, 0, 0), t: 1, set: false,
}));

// Plant them. `skel` must already be posed this frame — this reads where the
// pose put each foot and then solves the leg back to where the foot actually
// is, so it is a correction on top of the pose and never the pose itself.
//
// `vx, vz` is the body's own velocity, which is what a step leads with. Only
// one foot travels at a time: `busy` is why, and without it a walker at speed
// lifts both and floats.
//
// `busy` is read inside the loop and not once before it, and that is not
// tidiness. Read once, it is false for both feet on the frame they both want to
// go, so both go — and two feet that start together stay together for as long
// as the walk lasts, because nothing after that ever breaks the symmetry. The
// walkout found it immediately: two men whose legs are a mirror image of each
// other crossed the mat in a two-footed hop, with the judge reporting a 26 cm
// jump at the knee. The referee has the same shape of gait and never showed it
// only because the fight he is following never leaves him perfectly symmetric.
//
// `pole` is which way a knee points, in world space, and it is passed with the
// flag that makes it *decide* rather than merely set the plane. Without that,
// the solver keeps the knee where the pose already had it, which is right for
// an arm reaching for a lapel and wrong for a leg swinging through: at the
// moment the leg passes under the body the pose's own knee is on the line from
// hip to foot, both solutions are equally near it, and the knee snaps to the
// other side. That was the other half of the same 26 cm.
const _tmp = v3(0, 0, 0);
//
// `weight` is how much of the correction to apply, and it exists for one thing:
// letting go. A walker who hands over to something else — the pair rig, at the
// end of the walkout — has to arrive as the pose and nothing else, because the
// planner's held feet are the one part of him that is not in the pose and the
// difference is a jerk on the first frame of whatever comes next.
export function plantFeet(skel, feet, dt, vx, vz, cfg = WALK, pole = null, weight = 1) {
  const { STRIDE, SWING, LIFT, LEAD } = cfg;
  for (let i = 0; i < 2; i++) {
    const busy = feet.some((f) => f.t < 1);
    const f = feet[i];
    const [th, sh, ft] = NAMES[i];
    skel.boneHead(_tmp, ft);
    const px = _tmp[0], py = _tmp[1], pz = _tmp[2];
    // First frame: wherever the pose put it is where it stands.
    if (!f.set) { v3set(f.at, px, py, pz); f.set = true; f.t = 1; continue; }
    if (f.t < 1) {
      f.t = Math.min(1, f.t + dt / SWING);
      const u = f.t, s = u * u * (3 - 2 * u);
      f.at[0] = f.from[0] + (f.to[0] - f.from[0]) * s;
      f.at[2] = f.from[2] + (f.to[2] - f.from[2]) * s;
      f.at[1] = py + Math.sin(Math.PI * u) * LIFT;
    } else {
      const drag = Math.hypot(px - f.at[0], pz - f.at[2]);
      if (drag > STRIDE && !busy) {
        v3set(f.from, f.at[0], f.at[1], f.at[2]);
        v3set(f.to, px + vx * SWING * LEAD, py, pz + vz * SWING * LEAD);
        f.t = 0;
      }
      f.at[1] = py;
    }
    if (weight > 0.001) solveTwoBone(skel, th, sh, ft, f.at, pole, weight, true);
  }
}

// Put a man on the mat rather than through it.
//
// Only ever lifts, and only from below, so nothing here can push a walker into
// a pose he was not in. The toe matters as much as the ankle and is the reason
// this exists: a bent knee puts the ankle a centimetre above the tatami while
// the toe is six below it, so a measure reading the ankle says he is standing
// and the picture says he is sitting on a chair that is not there.
export function groundFeet(skel, floor = 0.05, weight = 1) {
  let lo = Infinity;
  for (const b of ['footL', 'footR', 'toeL', 'toeR']) {
    skel.boneHead(_tmp, b);
    if (_tmp[1] < lo) lo = _tmp[1];
  }
  const lift = (floor + 0.012 - lo) * weight;
  if (lift > 0.002) {
    skel.rootPos[1] += lift;
    skel.pose();
    return lift;
  }
  return 0;
}
