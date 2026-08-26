// The paired pose library.
//
// Read the note at the top of skeleton.js first: every entry here is one
// keyframe of a two-body object. `A` and `B` are roles, not fighters — A is
// always the one in the better position — and the sim decides which of the two
// people on the mat is playing which role.
//
// Coordinates are in the pair frame: a patch of mat with its origin between
// the two of them and +Z pointing the way A is facing at the start of the
// exchange. The sim slides and spins that frame around the arena; nothing in
// this file needs to know where on the mat the fight has drifted to.
//
// `root.r` is [pitch, yaw, roll] in degrees, applied Y-X-Z. Lying on your back
// with your head towards +Z is [-90, 180, 0]; face down is [90, 180, 0].
//
// `j` holds only the joints that differ from rest. Rest is a relaxed standing
// A-pose: arms straight down at the sides, legs straight. Every angle below is
// a departure from that, which is why a pose reads as a short list rather than
// twenty-four lines of noise.
//
// `grips` are the contact points. Each says "this hand of this role holds that
// point on the other", and after the blend the arm is solved onto it by IK.
// That is what keeps a collar grip on the collar for the whole of a pass
// instead of only on the two keyframes it was authored on.

const P = (id, o) => ({ id, ...o });

/* --------------------------------------------------------------- standing */

const STANCE_ARMS = {
  clavL: [0, 0, 8], armL: [-58, 8, -16], foreL: [-84, 0, 0], handL: [-12, 0, 0],
  clavR: [0, 0, -8], armR: [-58, -8, 16], foreR: [-84, 0, 0], handR: [-12, 0, 0],
};
const STANCE_LEGS = {
  thighL: [-16, 10, 5], shinL: [24, 0, 0], footL: [-12, -8, 0],
  thighR: [8, -12, -5], shinR: [18, 0, 0], footR: [-30, 10, 0],
};
const STANCE_SPINE = { hips: [-6, 0, 0], spine: [7, 0, 0], chest: [4, 0, 0], neck: [-4, 0, 0] };

export const POSES = {

  STANDING: P('STANDING', {
    name: 'Стойка',
    label: 'STANDING',
    points: 0, top: null, ground: false,
    A: {
      root: { p: [0, 0.885, -0.66], r: [0, 0, 0] },
      j: { ...STANCE_SPINE, ...STANCE_ARMS, ...STANCE_LEGS },
    },
    B: {
      root: { p: [0, 0.885, 0.66], r: [0, 180, 0] },
      j: { ...STANCE_SPINE, ...STANCE_ARMS, ...STANCE_LEGS },
    },
    grips: [],
  }),

  CLINCH: P('CLINCH', {
    name: 'Клинч',
    label: 'CLINCH',
    points: 0, top: null, ground: false,
    A: {
      root: { p: [0.06, 0.83, -0.34], r: [0, 6, 0] },
      j: {
        hips: [-16, 0, 0], spine: [11, 0, 0], chest: [7, 0, 0], neck: [8, 0, 0], head: [-4, 0, 0],
        clavL: [0, 0, 14], armL: [-104, 14, -30], foreL: [-72, 0, 0],
        clavR: [0, 0, -10], armR: [-74, -18, 24], foreR: [-64, 0, 0],
        thighL: [-26, 12, 6], shinL: [40, 0, 0], footL: [-18, -8, 0],
        thighR: [16, -14, -6], shinR: [30, 0, 0], footR: [-46, 12, 0],
      },
    },
    B: {
      root: { p: [-0.06, 0.83, 0.34], r: [0, 186, 0] },
      j: {
        hips: [-16, 0, 0], spine: [11, 0, 0], chest: [7, 0, 0], neck: [8, 0, 0], head: [-4, 0, 0],
        clavL: [0, 0, 14], armL: [-104, 14, -30], foreL: [-72, 0, 0],
        clavR: [0, 0, -10], armR: [-74, -18, 24], foreR: [-64, 0, 0],
        thighL: [-26, 12, 6], shinL: [40, 0, 0], footL: [-18, -8, 0],
        thighR: [16, -14, -6], shinR: [30, 0, 0], footR: [-46, 12, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'neck' },
      { role: 'A', hand: 'R', point: 'sleeveL' },
      { role: 'B', hand: 'L', point: 'neck' },
      { role: 'B', hand: 'R', point: 'sleeveL' },
    ],
  }),

  /* ---------------------------------------------------------- guard game - */

  // A kneels inside B's closed guard. Scores nothing for either — this is the
  // position the whole sport is an argument about.
  CLOSED_GUARD: P('CLOSED_GUARD', {
    name: 'Закрытая гвардия',
    label: 'CLOSED GUARD',
    points: 0, top: 'A', ground: true, guardOf: 'B',
    A: {
      root: { p: [0, 0.60, -0.34], r: [0, 0, 0] },
      j: {
        hips: [-8, 0, 0], spine: [10, 0, 0], chest: [6, 0, 0], neck: [10, 0, 0], head: [-8, 0, 0],
        clavL: [0, 0, 10], armL: [-62, 14, -20], foreL: [-16, 0, 0],
        clavR: [0, 0, -10], armR: [-62, -14, 20], foreR: [-16, 0, 0],
        thighL: [-4, 6, 8], shinL: [92, 0, 0], footL: [24, 0, 0],
        thighR: [-4, -6, -8], shinR: [92, 0, 0], footR: [24, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.235, 0.02], r: [-90, 180, 0] },
      j: {
        hips: [8, 0, 0], spine: [-14, 0, 0], chest: [-8, 0, 0], neck: [-24, 0, 0], head: [16, 0, 0],
        clavL: [0, 0, 12], armL: [-76, 20, -26], foreL: [-64, 0, 0],
        clavR: [0, 0, -12], armR: [-76, -20, 26], foreR: [-64, 0, 0],
        thighL: [-96, 4, 3], shinL: [118, 0, -16], footL: [-10, 0, 0],
        thighR: [-96, -4, -3], shinR: [118, 0, 16], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'sleeveR' },
      { role: 'B', hand: 'R', point: 'lapelL' },
      { role: 'A', hand: 'L', point: 'lapelR' },
    ],
  }),

  // Legs open, feet on hips: the working guard, where sweeps come from.
  OPEN_GUARD: P('OPEN_GUARD', {
    name: 'Открытая гвардия',
    label: 'OPEN GUARD',
    points: 0, top: 'A', ground: true, guardOf: 'B',
    A: {
      root: { p: [0, 0.66, -0.62], r: [0, 0, 0] },
      j: {
        hips: [-10, 0, 0], spine: [12, 0, 0], chest: [8, 0, 0], neck: [8, 0, 0],
        clavL: [0, 0, 10], armL: [-84, 14, -24], foreL: [-46, 0, 0],
        clavR: [0, 0, -10], armR: [-84, -14, 24], foreR: [-46, 0, 0],
        thighL: [-16, 8, 10], shinL: [86, 0, 0], footL: [16, 0, 0],
        thighR: [-42, -8, -8], shinR: [64, 0, 0], footR: [-20, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.25, 0.10], r: [-78, 180, 0] },
      j: {
        hips: [6, 0, 0], spine: [-18, 0, 0], chest: [-10, 0, 0], neck: [-28, 0, 0], head: [18, 0, 0],
        clavL: [0, 0, 12], armL: [-70, 24, -30], foreL: [-72, 0, 0],
        clavR: [0, 0, -12], armR: [-70, -24, 30], foreR: [-72, 0, 0],
        thighL: [-116, 6, 12], shinL: [42, 0, 0], footL: [-24, 0, 0],
        thighR: [-98, -10, -18], shinR: [66, 0, 0], footR: [-20, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'sleeveR' },
      { role: 'B', hand: 'R', point: 'sleeveL' },
    ],
  }),

  HALF_GUARD: P('HALF_GUARD', {
    name: 'Полугвардия',
    label: 'HALF GUARD',
    points: 0, top: 'A', ground: true, guardOf: 'B',
    A: {
      root: { p: [0.16, 0.44, -0.16], r: [0, 24, 0] },
      j: {
        hips: [-14, 0, 0], spine: [14, 0, 0], chest: [10, 0, 0], neck: [14, 0, 0], head: [-10, 0, 0],
        clavL: [0, 0, 14], armL: [-96, 16, -34], foreL: [-52, 0, 0],
        clavR: [0, 0, -12], armR: [-58, -20, 26], foreR: [-30, 0, 0],
        thighL: [-30, 10, 14], shinL: [104, 0, 0], footL: [10, 0, 0],
        thighR: [-6, -10, -10], shinR: [84, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.10, 0.26, 0.10], r: [-72, 156, -22] },
      j: {
        hips: [10, 0, 0], spine: [-16, 0, 0], chest: [-6, 0, 0], neck: [-20, 0, 0], head: [14, 0, 0],
        clavL: [0, 0, 16], armL: [-98, 26, -38], foreL: [-58, 0, 0],
        clavR: [0, 0, -10], armR: [-46, -18, 22], foreR: [-64, 0, 0],
        thighL: [-86, 8, 18], shinL: [88, 0, 0], footL: [-14, 0, 0],
        thighR: [-72, -6, -12], shinR: [96, 0, 0], footR: [-14, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'sleeveR' },
      { role: 'A', hand: 'L', point: 'lapelR' },
    ],
  }),

  /* --------------------------------------------------------- top control - */

  SIDE_CONTROL: P('SIDE_CONTROL', {
    name: 'Сторона',
    label: 'SIDE CONTROL',
    points: 3, top: 'A', ground: true,
    A: {
      root: { p: [0.30, 0.33, 0.16], r: [8, 100, 0] },
      j: {
        hips: [-18, 0, 0], spine: [36, 0, 0], chest: [22, 0, 0], neck: [26, 0, 0], head: [-30, 0, 0],
        clavL: [0, 0, 14], armL: [-64, 26, -58], foreL: [-104, 0, 0],
        clavR: [0, 0, -12], armR: [-44, -30, 34], foreR: [-96, 0, 0],
        thighL: [-52, 14, 18], shinL: [112, 0, 0], footL: [16, 0, 0],
        thighR: [-8, -16, -14], shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.215, 0.0], r: [-90, 180, 0] },
      j: {
        hips: [4, 0, 0], spine: [-8, 0, 0], chest: [-4, 0, 0], neck: [-18, 0, 0], head: [10, -20, 0],
        clavL: [0, 0, 20], armL: [-118, 30, -46], foreL: [-84, 0, 0],
        clavR: [0, 0, -16], armR: [-52, -22, 28], foreR: [-70, 0, 0],
        thighL: [-28, 6, 12], shinL: [46, 0, 0], footL: [-16, 0, 0],
        thighR: [-16, -6, -10], shinR: [34, 0, 0], footR: [-16, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'headBack' },
      { role: 'A', hand: 'R', point: 'lapelL' },
    ],
  }),

  KNEE_ON_BELLY: P('KNEE_ON_BELLY', {
    name: 'Колено на животе',
    label: 'KNEE ON BELLY',
    points: 2, top: 'A', ground: true,
    A: {
      root: { p: [0.06, 0.52, 0.00], r: [-6, 100, 0] },
      j: {
        hips: [-10, 0, 0], spine: [10, 0, 0], chest: [6, 0, 0], neck: [12, 0, 0], head: [-16, 0, 0],
        clavL: [0, 0, 14], armL: [-58, 20, -30], foreL: [-72, 0, 0],
        clavR: [0, 0, -12], armR: [-34, -20, 24], foreR: [-46, 0, 0],
        thighL: [-124, 10, 22], shinL: [58, 0, 0], footL: [8, 0, 0],
        thighR: [-6, -14, -26], shinR: [34, 0, 0], footR: [-30, 0, 0],
      },
    },
    B: {
      root: { p: [-0.14, 0.215, 0.0], r: [-90, 180, 0] },
      j: {
        hips: [4, 0, 0], spine: [-8, 0, 0], chest: [-4, 0, 0], neck: [-16, 0, 0], head: [12, -24, 0],
        clavL: [0, 0, 22], armL: [-124, 30, -48], foreL: [-90, 0, 0],
        clavR: [0, 0, -18], armR: [-70, -24, 32], foreR: [-78, 0, 0],
        thighL: [-34, 6, 12], shinL: [52, 0, 0], footL: [-16, 0, 0],
        thighR: [-20, -6, -10], shinR: [40, 0, 0], footR: [-16, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'A', hand: 'R', point: 'beltBack' },
    ],
  }),

  MOUNT: P('MOUNT', {
    name: 'Маунт',
    label: 'MOUNT',
    points: 4, top: 'A', ground: true,
    A: {
      root: { p: [0, 0.50, -0.02], r: [0, 0, 0] },
      j: {
        hips: [-6, 0, 0], spine: [8, 0, 0], chest: [6, 0, 0], neck: [12, 0, 0], head: [-10, 0, 0],
        clavL: [0, 0, 12], armL: [-92, 16, -26], foreL: [-40, 0, 0],
        clavR: [0, 0, -12], armR: [-92, -16, 26], foreR: [-40, 0, 0],
        thighL: [-6, 8, 26], shinL: [104, 0, 0], footL: [18, 0, 0],
        thighR: [-6, -8, -26], shinR: [104, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.215, 0.30], r: [-90, 180, 0] },
      j: {
        hips: [2, 0, 0], spine: [-6, 0, 0], chest: [-2, 0, 0], neck: [-20, 0, 0], head: [14, 0, 0],
        clavL: [0, 0, 22], armL: [-126, 26, -44], foreL: [-96, 0, 0],
        clavR: [0, 0, -22], armR: [-126, -26, 44], foreR: [-96, 0, 0],
        thighL: [-24, 6, 10], shinL: [40, 0, 0], footL: [-14, 0, 0],
        thighR: [-24, -6, -10], shinR: [40, 0, 0], footR: [-14, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'A', hand: 'R', point: 'lapelL' },
    ],
  }),

  BACK: P('BACK', {
    name: 'Спина',
    label: 'BACK CONTROL',
    points: 4, top: 'A', ground: true,
    A: {
      root: { p: [0, 0.34, -0.28], r: [-24, 8, 6] },
      j: {
        hips: [-6, 0, 0], spine: [10, 0, 0], chest: [8, 0, 0], neck: [16, 0, 0], head: [-12, 8, 0],
        clavL: [0, 0, 20], armL: [-124, 24, -44], foreL: [-104, 0, 0],
        clavR: [0, 0, -20], armR: [-118, -24, 42], foreR: [-96, 0, 0],
        thighL: [-70, 12, 22], shinL: [76, 0, 0], footL: [-14, 0, 0],
        thighR: [-70, -12, -22], shinR: [76, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.44, -0.06], r: [-16, 4, 4] },
      j: {
        hips: [-8, 0, 0], spine: [6, 0, 0], chest: [4, 0, 0], neck: [-6, 0, 0], head: [6, 0, 0],
        clavL: [0, 0, 16], armL: [-104, 22, -38], foreL: [-84, 0, 0],
        clavR: [0, 0, -16], armR: [-104, -22, 38], foreR: [-84, 0, 0],
        thighL: [-56, 8, 14], shinL: [86, 0, 0], footL: [-10, 0, 0],
        thighR: [-56, -8, -14], shinR: [86, 0, 0], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'B', hand: 'R', point: 'wristL' },
    ],
  }),

  TURTLE: P('TURTLE', {
    name: 'Черепаха',
    label: 'TURTLE',
    points: 0, top: 'A', ground: true,
    A: {
      root: { p: [0.02, 0.56, -0.44], r: [10, 14, 0] },
      j: {
        hips: [-18, 0, 0], spine: [14, 0, 0], chest: [10, 0, 0], neck: [16, 0, 0], head: [-12, 0, 0],
        clavL: [0, 0, 16], armL: [-104, 20, -36], foreL: [-56, 0, 0],
        clavR: [0, 0, -14], armR: [-98, -20, 34], foreR: [-52, 0, 0],
        thighL: [-40, 10, 14], shinL: [104, 0, 0], footL: [8, 0, 0],
        thighR: [-14, -12, -12], shinR: [88, 0, 0], footR: [14, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.42, 0.12], r: [64, 176, 0] },
      j: {
        hips: [-12, 0, 0], spine: [-16, 0, 0], chest: [-10, 0, 0], neck: [-26, 0, 0], head: [30, 0, 0],
        clavL: [0, 0, 14], armL: [-46, 16, -22], foreL: [-116, 0, 0],
        clavR: [0, 0, -14], armR: [-46, -16, 22], foreR: [-116, 0, 0],
        thighL: [-14, 6, 8], shinL: [124, 0, 0], footL: [12, 0, 0],
        thighR: [-14, -6, -8], shinR: [124, 0, 0], footR: [12, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'A', hand: 'R', point: 'beltBack' },
    ],
  }),

  /* -------------------------------------------------------- submissions -- */

  RNC: P('RNC', {
    name: 'Удушение сзади',
    label: 'REAR NAKED CHOKE',
    points: 4, top: 'A', ground: true, submission: 'choke', from: 'BACK',
    A: {
      root: { p: [0, 0.34, -0.30], r: [-28, 8, 8] },
      j: {
        hips: [-6, 0, 0], spine: [12, 0, 0], chest: [10, 0, 0], neck: [18, 0, 0], head: [-14, 10, 0],
        clavL: [0, 0, 26], armL: [-136, 30, -52], foreL: [-128, 0, 0],
        clavR: [0, 0, -24], armR: [-128, -28, 48], foreR: [-134, 0, 0],
        thighL: [-74, 12, 24], shinL: [72, 0, 0], footL: [-14, 0, 0],
        thighR: [-74, -12, -24], shinR: [72, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.44, -0.06], r: [-10, 4, 4] },
      j: {
        hips: [-6, 0, 0], spine: [-4, 0, 0], chest: [-6, 0, 0], neck: [-14, 0, 0], head: [12, 0, 0],
        clavL: [0, 0, 22], armL: [-138, 30, -50], foreL: [-118, 0, 0],
        clavR: [0, 0, -22], armR: [-138, -30, 50], foreR: [-118, 0, 0],
        thighL: [-52, 8, 14], shinL: [92, 0, 0], footL: [-10, 0, 0],
        thighR: [-52, -8, -14], shinR: [92, 0, 0], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'neck' },
      { role: 'B', hand: 'L', point: 'wristR', self: true },
    ],
  }),

  ARMBAR: P('ARMBAR', {
    name: 'Рычаг локтя',
    label: 'ARMBAR',
    points: 4, top: 'A', ground: true, submission: 'joint', from: 'MOUNT',
    A: {
      root: { p: [0, 0.28, 0.18], r: [-58, 176, 0] },
      j: {
        hips: [-4, 0, 0], spine: [-10, 0, 0], chest: [-6, 0, 0], neck: [-10, 0, 0], head: [8, 0, 0],
        clavL: [0, 0, 18], armL: [-120, 24, -40], foreL: [-108, 0, 0],
        clavR: [0, 0, -18], armR: [-120, -24, 40], foreR: [-108, 0, 0],
        thighL: [-104, 8, 12], shinL: [26, 0, 0], footL: [-16, 0, 0],
        thighR: [-96, -8, -14], shinR: [30, 0, 0], footR: [-16, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.215, -0.30], r: [-90, 176, 18] },
      j: {
        hips: [4, 0, 0], spine: [-6, 0, 0], chest: [-4, 0, 0], neck: [-16, 0, 0], head: [14, 0, 0],
        clavL: [0, 0, 26], armL: [-176, 20, -30], foreL: [-6, 0, 0],
        clavR: [0, 0, -18], armR: [-92, -22, 34], foreR: [-104, 0, 0],
        thighL: [-30, 6, 12], shinL: [50, 0, 0], footL: [-14, 0, 0],
        thighR: [-22, -6, -10], shinR: [44, 0, 0], footR: [-14, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'wristL' },
      { role: 'A', hand: 'R', point: 'wristL' },
    ],
  }),

  TRIANGLE: P('TRIANGLE', {
    name: 'Треугольник',
    label: 'TRIANGLE CHOKE',
    points: 0, top: 'B', ground: true, submission: 'choke', from: 'CLOSED_GUARD', invert: true,
    A: {
      root: { p: [0, 0.44, -0.24], r: [32, 0, 0] },
      j: {
        hips: [-16, 0, 0], spine: [20, 0, 0], chest: [12, 0, 0], neck: [22, 0, 0], head: [-18, 0, 0],
        clavL: [0, 0, 20], armL: [-168, 18, -28], foreL: [-16, 0, 0],
        clavR: [0, 0, -16], armR: [-84, -20, 30], foreR: [-58, 0, 0],
        thighL: [-8, 8, 10], shinL: [96, 0, 0], footL: [20, 0, 0],
        thighR: [-8, -8, -10], shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.27, 0.10], r: [-64, 180, 0] },
      j: {
        hips: [14, 0, 0], spine: [-22, 0, 0], chest: [-12, 0, 0], neck: [-30, 0, 0], head: [20, 0, 0],
        clavL: [0, 0, 16], armL: [-92, 24, -34], foreL: [-84, 0, 0],
        clavR: [0, 0, -16], armR: [-92, -24, 34], foreR: [-84, 0, 0],
        thighL: [-150, 12, 6], shinL: [126, 0, -12], footL: [-10, 0, 0],
        thighR: [-126, -18, -22], shinR: [140, 0, 10], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'wristL' },
      { role: 'B', hand: 'R', point: 'kneeL', self: true },
    ],
  }),

  KIMURA: P('KIMURA', {
    name: 'Кимура',
    label: 'KIMURA',
    points: 3, top: 'A', ground: true, submission: 'joint', from: 'SIDE_CONTROL',
    A: {
      root: { p: [0.26, 0.36, 0.26], r: [12, 116, 0] },
      j: {
        hips: [-16, 0, 0], spine: [34, 0, 0], chest: [20, 0, 0], neck: [24, 0, 0], head: [-28, 0, 0],
        clavL: [0, 0, 18], armL: [-78, 28, -50], foreL: [-116, 0, 0],
        clavR: [0, 0, -18], armR: [-72, -30, 46], foreR: [-118, 0, 0],
        thighL: [-56, 14, 20], shinL: [108, 0, 0], footL: [14, 0, 0],
        thighR: [-12, -16, -16], shinR: [92, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.215, 0.0], r: [-90, 180, 8] },
      j: {
        hips: [4, 0, 0], spine: [-8, 0, 0], chest: [-6, 0, 0], neck: [-16, 0, 0], head: [12, -26, 0],
        clavL: [0, 0, 30], armL: [-156, 34, -54], foreL: [-118, 0, 0],
        clavR: [0, 0, -16], armR: [-58, -22, 30], foreR: [-72, 0, 0],
        thighL: [-30, 6, 12], shinL: [48, 0, 0], footL: [-16, 0, 0],
        thighR: [-18, -6, -10], shinR: [36, 0, 0], footR: [-16, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'R', point: 'wristL' },
      { role: 'A', hand: 'L', point: 'wristR', self: true },
    ],
  }),

  GUILLOTINE: P('GUILLOTINE', {
    name: 'Гильотина',
    label: 'GUILLOTINE',
    points: 0, top: 'B', ground: true, submission: 'choke', from: 'CLOSED_GUARD', invert: true,
    A: {
      root: { p: [0, 0.40, -0.20], r: [56, 0, 0] },
      j: {
        hips: [-14, 0, 0], spine: [22, 0, 0], chest: [14, 0, 0], neck: [10, 0, 0], head: [-8, 0, 0],
        clavL: [0, 0, 14], armL: [-70, 16, -24], foreL: [-52, 0, 0],
        clavR: [0, 0, -14], armR: [-70, -16, 24], foreR: [-52, 0, 0],
        thighL: [-10, 8, 12], shinL: [98, 0, 0], footL: [20, 0, 0],
        thighR: [-10, -8, -12], shinR: [98, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.30, 0.16], r: [-56, 180, 0] },
      j: {
        hips: [16, 0, 0], spine: [-18, 0, 0], chest: [-8, 0, 0], neck: [-22, 0, 0], head: [16, 0, 0],
        clavL: [0, 0, 24], armL: [-146, 28, -46], foreL: [-126, 0, 0],
        clavR: [0, 0, -22], armR: [-138, -26, 42], foreR: [-120, 0, 0],
        thighL: [-118, 8, 18], shinL: [104, 0, 0], footL: [-10, 0, 0],
        thighR: [-118, -8, -18], shinR: [104, 0, 0], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'neck' },
      { role: 'B', hand: 'R', point: 'wristL', self: true },
    ],
  }),
};

export const POSE_IDS = Object.keys(POSES);
