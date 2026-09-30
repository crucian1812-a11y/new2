// How finely a blend is sampled, in one place, because the two numbers are not
// independent.
//
// blend-check judges a transition by walking it and taking the deepest moment;
// arc-solve searches for a correction by doing the same thing inside its cost.
// If the solver's grid is coarser than the judge's — or merely different — the
// search can park a collision in a gap it cannot see and the judge can, and
// then "solved" and "clean" are two different claims about two different
// curves. It happened: thirteen points in both tools let the mount's second
// hold loop come out of the solver three centimetres deeper than it went in,
// with both tools calling it clean; twenty-five against forty-one still left
// the two five centimetres apart on the same table.
//
// So the solver's grid is a refinement of the judge's: every point the judge
// looks at is a point the solver looked at, and the solver looked at more.
//
// And now they are the same, because "the solver looked at more" turned out to
// have a second edge to it that nothing guarded. The rule above stops a search
// hiding a collision from the judge. It says nothing about the judge hiding
// one from the reader — and it was: on the graph as it stands, arc-solve
// reported its worst moment in flight as 21cm while blend-check, walking the
// same transitions at half the resolution, reported 17. Measured at 81 the
// judge's own numbers move:
//
//     transitions, worst    17cm -> 21cm      work list  12 -> 13
//     hold loops, worst      8cm ->  9cm      deeper than their ends  2 -> 3cm
//
// Four centimetres of that was sitting between two samples, and the line this
// file will not ship past is 22. So the graph has been one centimetre from
// unshippable while reporting five, for as long as the two numbers differed.
//
// Equal rather than finer: equality still satisfies what the paragraph above
// asks for — the solver's grid is not coarser than the judge's and not
// different from it — and doubling the solver instead would double the twenty
// minutes a full re-solve costs to buy a guarantee against a gap neither tool
// has yet been shown to have.
export const JUDGE_STEPS = 81;
export const SOLVE_STEPS = 81;

const ratio = (SOLVE_STEPS - 1) / (JUDGE_STEPS - 1);
if (!Number.isInteger(ratio) || ratio < 1) {
  throw new Error(
    `the solver's grid must refine the judge's: ${SOLVE_STEPS} samples do not contain all ${JUDGE_STEPS}`
  );
}

// And between the points, wherever the path moves too fast to be judged by
// them.
//
// Eighty-one points are a fine grid for a path that is smooth, and the path is
// not smooth everywhere. A grip lets go when its target leaves the arm's reach
// or comes inside its own shoulder, and two men holding each other's sleeves
// move each other's targets, so a release can run in a thousandth of the
// blend: a hand swings forty to seventy centimetres back to where the pose has
// it and passes through whatever is in the way. Walked on a grid twenty-five
// times finer, forty-five blends were deeper than this file's grid said by two
// centimetres or more, four of them past the line the judge ships on
// (MOUNT>CLOSED_GUARD_X 17 → 28 cm, OPEN_GUARD>MOUNT_X 9 → 26). In the game
// the hand is eased in time, so the sweep takes a fifth of a second instead
// of none — which is exactly long enough to see.
//
// A finer grid everywhere costs everywhere. So the grid stays, and any
// interval across which some joint moves more than REFINE_JUMP is split in
// two, and again, until nothing jumps or the pieces are REFINE_DEPTH halvings
// deep: the extra samples land exactly where the path is fast. One walk for
// every tool that judges a blend, so the solver and the judge still look at
// the same points.
export const REFINE_JUMP = 0.08;   // 4 cm added half as many points again as the grid has and found the same worst to a centimetre
export const REFINE_DEPTH = 6;

// Both men's joints, where they are now: the snapshot a walk compares.
export function jointsOf(rig, out) {
  let k = 0;
  for (const role of ['A', 'B']) {
    for (const m of rig.skel[role].world) { out[k++] = m[12]; out[k++] = m[13]; out[k++] = m[14]; }
  }
  return out;
}

// `at(t, i)` poses the rig at t and measures whatever its caller measures; `i`
// is the grid index, or -1 for a point added between two of them. It returns
// the joints (jointsOf) — a fresh array, which the walk keeps.
export function walkBlend(steps, at) {
  const snaps = new Array(steps);
  for (let i = 0; i < steps; i++) snaps[i] = at(i / (steps - 1), i);
  const moved = (p, q) => {
    let m = 0;
    for (let k = 0; k < p.length; k += 3) {
      const d = Math.hypot(p[k] - q[k], p[k + 1] - q[k + 1], p[k + 2] - q[k + 2]);
      if (d > m) m = d;
    }
    return m;
  };
  const split = (t0, p0, t1, p1, depth) => {
    if (depth >= REFINE_DEPTH || moved(p0, p1) <= REFINE_JUMP) return;
    const tm = (t0 + t1) / 2;
    const pm = at(tm, -1);
    split(t0, p0, tm, pm, depth + 1);
    split(tm, pm, t1, p1, depth + 1);
  };
  for (let i = 0; i < steps - 1; i++) split(i / (steps - 1), snaps[i], (i + 1) / (steps - 1), snaps[i + 1], 0);
}
