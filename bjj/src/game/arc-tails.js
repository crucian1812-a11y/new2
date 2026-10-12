// Transitions whose arc dies away quickly at the ends.
//
// An arc lives in un-smoothstepped time (rig.js, arcT), and every lobe carries
// one factor of the bell sin(π·arcT). Near the end of a blend that factor goes
// as the square root of what is left of it, so at e = 0.97 the last lobe still
// pushes with a third of its strength and is falling steeply. Where a pose's
// limbs close round each other in that last stretch — open guard's shins
// round the top man's arms — the falling arc drags a limb through the other
// man and the deepest moment of the blend is three hundredths from its end:
// sixteen centimetres where the bare blend, no arc at all, is six.
//
// Listed here, a transition's lobes carry the bell twice: they vanish linearly
// in e at both ends instead of as a square root, and the solver re-solves the
// arc in that shape (it evaluates through the rig). Which transitions are here
// is a measurement — arc-solve with and without, blend-check keeps the better.
export const TAILS = new Set([
]);
