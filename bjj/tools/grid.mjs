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
export const JUDGE_STEPS = 41;
export const SOLVE_STEPS = 81;

const ratio = (SOLVE_STEPS - 1) / (JUDGE_STEPS - 1);
if (!Number.isInteger(ratio) || ratio < 1) {
  throw new Error(
    `the solver's grid must refine the judge's: ${SOLVE_STEPS} samples do not contain all ${JUDGE_STEPS}`
  );
}
