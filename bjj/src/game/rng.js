// One stream of random numbers for the whole match, and a way to start it over.
//
// Everything the fight decides by chance — which transition the AI reaches for,
// whether a denial is read or guessed, where a submission's tap window sits,
// which way an escape flick goes — came out of `Math.random()`, and a match
// built on that cannot be run twice. That costs three things at once: there is
// no replay, there is no lockstep to build a network match on, and every
// measurement of the fight is a measurement of a different fight. `sim-check`
// has a check that "every position is reached" which fails now and then on the
// rare ones, and nobody could ever tell whether a change had caused that or
// the dice had.
//
// So the fight draws from here instead. Mulberry32: thirty-two bits of state,
// four lines, a period of four billion and a distribution good enough for a
// game — this is not a place that needs a cryptographic generator, it is a
// place that needs the same fight twice.
//
// Deliberately one global stream rather than a generator per fighter. The sim
// is one thread doing one thing at a time, so the order of the draws is the
// order of the code, and one stream keeps that order visible: seed it, run,
// and every number lands where it landed last time. The presentation — camera
// shake, the pitch of a footstep, crowd noise — stays on Math.random, because
// none of it feeds back into the fight and none of it has to agree between two
// machines.

let state = 0;

export function seedRandom(seed) {
  // A seed of 0 is a legal seed and an easy accident, so it is mixed rather
  // than used: mulberry32 from a zero state is not stuck, but it starts in a
  // corner of its cycle and the first few draws are visibly cold.
  state = (Math.imul(seed >>> 0 || 0x9e3779b9, 0x85ebca6b) ^ 0x27d4eb2f) >>> 0;
  return seed >>> 0;
}

// Where an unseeded game starts. A page that nobody seeded should still play a
// different match every time it is opened.
seedRandom((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

export function rand() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// The two shapes the fight actually asks for.
export function randInt(n) {
  return (rand() * n) | 0;
}

export function pick(list) {
  return list.length ? list[(rand() * list.length) | 0] : null;
}
