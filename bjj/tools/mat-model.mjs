// Where the skin is, cheaply enough to put inside a search.
//
// This lives on its own because two things read it and a copy of it in each
// would be the one mistake this project keeps paying for: the solver and the
// judge measuring different things and nobody noticing for a round. arc-solve
// solves against this; ruler-check scores it against the real baked skin.
//
// It used to be a table of "how far the skin hangs below this bone", nine
// numbers, most of them capsule radii. pose-relax threw that table away when it
// started reading the baked mesh, and blend-check followed; arc-solve could
// not, because it evaluates its cost tens of thousands of times over
// twenty-four samples each and skinning four thousand vertices per sample is
// its three minutes multiplied by ten.
//
// The obvious repair — measure the table honestly instead of guessing it — was
// tried and does not work. Measured against the real skin over the whole
// library, the distance from a shin bone to the lowest skin that hangs off it
// runs from 13 to 46 cm (the table said 10), because "shin" here is the knee
// and its skin reaches the ankle: how far down it goes depends on how the leg
// is bent. No constant is within a hand's breadth of right.
//
// So the model changes shape rather than value: the lowest point of the segment
// from a bone to its child, minus a radius that fades from one end to the
// other. Two numbers a bone instead of one, fitted by grid search against the
// baked skin over 188 samples per bone. The chest is the worst of them — it is
// a straight limb approximating a torso — and that is the model's ceiling.
// What the whole thing is actually worth is not asserted here: ruler-check
// measures it against the skin, over the same blends blend-check judges.
import { BONE_INDEX } from '../src/render/skeleton.js';

// The mat, in the same place both rulers put it.
export const MAT_Y = 0.05;

// bone: [child, radius at the bone, radius at the child]
export const SKIN_SEG = {
  handL: ['fingL', 0.020, 0.035], handR: ['fingR', 0.010, 0.035],
  footL: ['toeL', 0.050, -0.020], footR: ['toeR', 0.040, -0.020],
  hips: ['spine', 0.225, -0.020], chest: ['neck', 0.215, -0.020],
  shinL: ['footL', 0.055, 0.040], shinR: ['footR', 0.050, 0.045],
  thighL: ['shinL', 0.090, 0.055], thighR: ['shinR', 0.095, 0.055],
  foreL: ['handL', 0.045, 0.020], foreR: ['handR', 0.045, 0.030],
  armL: ['foreL', 0.035, 0.045], armR: ['foreR', 0.040, 0.040],
  head: ['headTop', 0.065, 0.075],
};

// Every bone that carries skin able to reach the floor. Not a hand-picked list
// of "the parts that touch the mat": the knee is the shin bone's own origin,
// and the one part most likely to be through the tatami was the one part the
// old list could not see.
export const SUNK = Object.keys(SKIN_SEG);

// How far the skin hanging off one bone reaches below the mat, or zero.
export function skinUnder(sk, b) {
  const seg = SKIN_SEG[b];
  if (!seg) return 0;
  const i = BONE_INDEX[b], j = BONE_INDEX[seg[0]];
  if (i === undefined || j === undefined) return 0;
  const y0 = sk.world[i][13], y1 = sk.world[j][13];
  let low = Infinity;
  for (let k = 0; k <= 4; k++) {
    const t = k / 4;
    const y = y0 + (y1 - y0) * t - (seg[1] + (seg[2] - seg[1]) * t);
    if (y < low) low = y;
  }
  return MAT_Y - low;
}

// The deepest any of it goes on one fighter, which is what a cost term and a
// report both actually want.
export function deepestUnder(sk) {
  let d = 0;
  for (const b of SUNK) {
    const u = skinUnder(sk, b);
    if (u > d) d = u;
  }
  return d;
}
