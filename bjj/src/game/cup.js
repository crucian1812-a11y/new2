// The tournament: what a belt is won in.
//
// The ladder was one fight per belt — beat the man at your rung and his belt
// is yours. It was a list of five fights, and nothing about the second match
// mattered more than the first: a loss cost nothing, a win was one step, and
// the next press put the same man back on the mat.
//
// A tournament is the thing a belt is actually won in. The men between you
// and the one wearing the belt are the bracket, the man himself is the final,
// and a loss anywhere in it is a loss of the whole thing: back to the first
// round of the next one. The stake is the three fights in a row.
//
// The bracket is the men up to your rung — at most three, the two below it
// and the one on it — so it grows as you climb: the white belt's is one fight
// (the first fight of the game is not the place for a bracket), the blue
// belt's two, and from purple on a full three. Nobody new is invented for it:
// the five men and their styles are the field, and the final is always the
// man whose belt you are taking, the one the ladder put in front of you.
//
// Pure: no DOM, no storage. main.js keeps the state in the progress record it
// already saves, and human-check reads the odds of a whole bracket off the
// same function.

export const CUP_SIZE = 3;

// The rungs you fight, in order, at `rank`.
export function bracket(rank) {
  const out = [];
  for (let i = Math.max(0, rank - CUP_SIZE + 1); i <= rank; i++) out.push(i);
  return out;
}

// What each round is called, counted back from the final, which is what a
// round is called by.
const ROUND = ['ФИНАЛ', 'ПОЛУФИНАЛ', 'ЧЕТВЕРТЬФИНАЛ'];
const SHORT = ['ФИНАЛ', '½', '¼'];
export function roundName(rank, stage, short = false) {
  const back = bracket(rank).length - 1 - stage;
  return (short ? SHORT : ROUND)[Math.max(0, Math.min(ROUND.length - 1, back))];
}

// The rung the next cup fight is against.
export function cupMan(rank, stage) {
  const b = bracket(rank);
  return b[Math.max(0, Math.min(b.length - 1, stage))];
}

// A cup fight has ended. Returns what it meant, and the stage to be in next:
//   next    through to the next round
//   title   the final is won: the belt
//   out     lost, and the next tournament starts from its first round
export function cupAfter(rank, stage, won) {
  const n = bracket(rank).length;
  if (!won) return { kind: 'out', stage: 0, round: roundName(rank, stage) };
  if (stage + 1 >= n) return { kind: 'title', stage: 0, round: roundName(rank, stage) };
  return { kind: 'next', stage: stage + 1, round: roundName(rank, stage), nextRound: roundName(rank, stage + 1) };
}

// The chance of winning the whole thing, given the chance against each rung.
// The fights are independent — nothing carries from one to the next, not
// fatigue, not posture — so it is the product.
export function cupOdds(rank, winRate) {
  return bracket(rank).reduce((p, r) => p * winRate(r), 1);
}
