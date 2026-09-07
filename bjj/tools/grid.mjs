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
