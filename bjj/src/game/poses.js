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
      root: { p: [0.004, 0.856, -0.31], r: [0, 6, 0] },
      j: {
        hips: [-10, -6, 0.8], spine: [17, 1.5, 6], chest: [13, -1.5, 9.8], neck: [1.3, 4.6, 6.1], head: [-4, 0, 0],
        clavL: [6, 9, 27.5], armL: [-122, 53.9, 13.7], foreL: [-119.9, 3, 0.8],
        clavR: [3, 9.9, -3.9], armR: [-71.7, -13.4, 28.6], foreR: [-64, 0, 0],
        thighL: [-26, 12, 6], shinL: [40, 0, 0], footL: [-18, -8, 0],
        thighR: [16, -14, -6], shinR: [30, 0, 0], footR: [-46, 12, 0],
      },
    },
    B: {
      root: { p: [-0.06, 0.838, 0.34], r: [0, 186, 0] },
      j: {
        hips: [-10, -3.7, 0], spine: [11, -0.7, 6.8], chest: [7, 6, 6.8], neck: [5.9, -2.2, 19.6], head: [-5.4, 0, 1.6],
        clavL: [33.9, 0, 19.3], armL: [-71.6, 11.1, -11.9], foreL: [-87.6, -32.9, -29.1],
        clavR: [0.8, 18.1, -9.9], armR: [-74.6, -21.6, 20.3], foreR: [-56.4, -2.2, 7.6],
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
      root: { p: [0, 0.66, -0.34], r: [0, 0, 0] },
      j: {
        hips: [4, -6.7, -18], spine: [22, 0, -9.7], chest: [18.8, -7.5, -12.7], neck: [7.8, 0, 0], head: [-8, 0, 0],
        clavL: [-2.2, -36.7, -10.1], armL: [-13.9, -6.2, -3.4], foreL: [-43.6, -16.4, -20.9],
        clavR: [-12, 17.3, -1.7], armR: [-62, -20.7, 20], foreR: [-30.2, 15, 8.3],
        thighL: [-4, 6, 12.5], shinL: [92, 0, 0], footL: [24, 0, 0],
        thighR: [5.8, -10.5, -25.2], shinR: [92, 0, 0], footR: [24, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.265, 0.02], r: [-90, 180, 0] },
      j: {
        hips: [20, 18, 18], spine: [-2, 0, 12], chest: [-2, 6, 6], neck: [-24, 0, 0], head: [16, 0, 0],
        clavL: [5.3, -12.7, -0.7], armL: [-85.7, 17.8, -35], foreL: [-57.2, -1.5, -0.7],
        clavR: [-30.6, 12, 0], armR: [-107.4, -14.6, 32], foreR: [-76.7, 21.2, 17.4],
        thighL: [-99.7, 2.5, 1.5], shinL: [132.3, 1.5, -13], footL: [-10, 0, 0],
        thighR: [-95.2, 8.8, 5.3], shinR: [130, 1.5, 10.8], footR: [-10, 0, 0],
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
      root: { p: [-0.064, 0.585, -0.508], r: [0, 0, 0] },
      j: {
        hips: [6.5, -6, -24.7], spine: [18.8, -6, -12.7], chest: [14, 0, -8.2], neck: [8, 0, 0],
        clavL: [2.3, -16.5, 18.3], armL: [-77.9, 32.8, -18.7], foreL: [-40.7, 6.8, 7.6],
        clavR: [0, 22.5, -7], armR: [-73.4, -20, 23.3], foreR: [-41.5, -1.4, -2.2],
        thighL: [-16, 6.5, 10], shinL: [86, 0, 0], footL: [16, 0, 0],
        thighR: [-42, -8, -8], shinR: [64, 0, 0], footR: [-20, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.284, 0.07], r: [-78, 180, 0] },
      j: {
        hips: [18.8, 0, 0.8], spine: [-5.2, -12, -12.7], chest: [-4, 0, -6], neck: [-28, 0, 0], head: [18, 0, 0],
        clavL: [-3.7, -12, 3.8], armL: [-78.2, 27.1, -25.4], foreL: [-77.2, -5.1, -4.4],
        clavR: [-2.2, 12, 0], armR: [-70, -26.2, 30.8], foreR: [-79.5, -5.9, -5.2],
        thighL: [-116, 16.6, 13.5], shinL: [42, 0, 0], footL: [-24, 0, 0],
        thighR: [-98, -10.7, -18], shinR: [66, 0, 0], footR: [-20, 0, 0],
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
      root: { p: [0.21, 0.48, -0.15], r: [0, 24, 0] },
      j: {
        hips: [-17, 0, 18], spine: [44, -6, 21], chest: [-2, -6, 15], neck: [12.5, 0, -0.7], head: [-10, 0, 0],
        clavL: [22.5, -25.5, 42.5], armL: [-83.9, 37, -19.7], foreL: [-52.7, 0.8, 3.9],
        clavR: [-9, 0, -1.5], armR: [-64, -26, 20], foreR: [-38.2, 4.5, -15],
        thighL: [-30.7, 10, 14], shinL: [104, 0, 0], footL: [10, 0, 0],
        thighR: [-12, 32.8, -20.5], shinR: [96.8, 4.6, -3.7], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.1, 0.275, 0.07], r: [-72, 156, -22] },
      j: {
        hips: [19, -12, -6], spine: [-6.2, 27, 6], chest: [-0.7, 10.5, 3], neck: [-20, 0, 0], head: [14, 0, 0],
        clavL: [12.8, 15.8, 6.3], armL: [-85.9, 38.9, -23], foreL: [-67.7, 0.8, 2.3],
        clavR: [16.6, -8.9, 4.3], armR: [-27.9, -2.2, 30.3], foreR: [-64, 2.3, 0.8],
        thighL: [-86, 8, 18], shinL: [88, 0, 0], footL: [-14, 0, 0],
        thighR: [-79.5, -21.7, -28.5], shinR: [90, 0, 0], footR: [-14, 0, 0],
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
      root: { p: [0.3, 0.33, 0.25], r: [8, 100, 0] },
      j: {
        hips: [-36, -24, -12], spine: [58.5, -18, 12], chest: [52, -24, 18], neck: [26, 0, 0], head: [-30, 0, 0],
        clavL: [-9.7, -24.7, -4], armL: [-67.7, 34.3, -54.2], foreL: [-113.7, 8.3, 7.6],
        clavR: [2.3, -33.7, -9], armR: [-33.5, -33, 36.3], foreR: [-112.5, -1.5, -8.2],
        thighL: [-52, 14, 18], shinL: [112, 0, 0], footL: [16, 0, 0],
        thighR: [-14, -28.7, -17.7], shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.245, -0.03], r: [-90, 180, 0] },
      j: {
        hips: [16, -7.5, 6], spine: [-2, 0, 6], chest: [8, -3.7, 18], neck: [3.8, 20.3, 18], head: [28, 3.3, -8.2],
        clavL: [-10.4, 6.1, 11], armL: [-118, 36.8, -40.7], foreL: [-86.2, 0.8, 0],
        clavR: [6.8, -22.5, 6.6], armR: [-48.2, -20.5, 28], foreR: [-70, 0, 0],
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
      root: { p: [0.165, 0.505, 0], r: [-6, 100, 0] },
      j: {
        hips: [-17.5, -6, 6], spine: [-13.2, -15, 19.5], chest: [-21.7, -7.5, 22.5], neck: [13.5, 0, -0.7], head: [-16, 0, 0],
        clavL: [0.8, 15.8, 10.3], armL: [-54.9, 17.9, -28.4], foreL: [-77.2, -3, -2.9],
        clavR: [-3.7, -18.7, 10.6], armR: [-45.1, -10.9, 32.4], foreR: [-42.9, 12.1, 9.8],
        thighL: [-124, 10, 22], shinL: [58, 0, 0], footL: [8, 0, 0],
        thighR: [-6, -14, -38], shinR: [34, 0, 0], footR: [-30, 0, 0],
      },
    },
    B: {
      root: { p: [-0.215, 0.313, 0.068], r: [-90, 180, 0] },
      j: {
        hips: [19, 34.5, -4.5], spine: [5.5, 6, 6], chest: [6.5, 19.5, 3], neck: [-16, 0, 0], head: [12, -24, 0],
        clavL: [0, 0, 22], armL: [-124, 30, -48], foreL: [-90, 0, 0],
        clavR: [-14.9, 0.8, -23.2], armR: [-70.7, -24.7, 31.3], foreR: [-78, 0, 0],
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
      root: { p: [0.008, 0.56, 0.025], r: [0, 0, 0] },
      j: {
        hips: [18.8, 4.5, 6], spine: [26, -3, -5.9], chest: [26.3, -2.2, -21.7], neck: [12, 0, 0], head: [-10, 0, 0],
        clavL: [3.8, -17.9, -6.7], armL: [-82.9, 9.3, -32], foreL: [-58.7, 5.4, 3.8],
        clavR: [-3.6, 21.8, 4.5], armR: [-89.7, -5.4, 36.6], foreR: [-55.7, 0, -0.7],
        thighL: [-5.5, 8.5, 57.5], shinL: [98, 0, 0], footL: [18, 0, 0],
        thighR: [-4, -10.7, -56.7], shinR: [98, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0.023, 0.245, 0.285], r: [-90, 180, 0] },
      j: {
        hips: [14, -9.6, 0], spine: [0, -6.7, -5.2], chest: [7.8, 5.3, 11.3], neck: [-20, 0, 0], head: [14, 0, 0],
        clavL: [0, 0, 22], armL: [-126, 26, -44], foreL: [-96, 0, 0],
        clavR: [0, 0, -22], armR: [-126, -26, 44], foreR: [-96, 0, 0],
        thighL: [-21, -1.4, -2], shinL: [37.8, 0, 0], footL: [-14, 0, 0],
        thighR: [-26.2, -6.7, -7.7], shinR: [40, 0, 0], footR: [-14, 0, 0],
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
      root: { p: [-0.022, 0.36, -0.44], r: [-22, 8, 6] },
      j: {
        hips: [-6, -9, 6], spine: [16, -12, 0], chest: [14, -9, 9], neck: [16, 0, 0], head: [-12, 8, 0],
        clavL: [-12, -4.5, 2], armL: [-131.5, 24, -44], foreL: [-107, 5.3, 0],
        clavR: [0, 0, -20], armR: [-118, -24, 42], foreR: [-96, 0, 0],
        thighL: [-70, 12.8, 24.3], shinL: [76, 0, 0], footL: [-14, 0, 0],
        thighR: [-70, -12, -22], shinR: [76, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.391, -0.06], r: [-16, 4, 4] },
      j: {
        hips: [-8, -9, -4.5], spine: [6, 0, -6], chest: [-2, -6, -27], neck: [-6, 0, 0], head: [6, 0, 0],
        clavL: [0, 0, 16], armL: [-104, 22, -38], foreL: [-84, 0, 0],
        clavR: [-12.7, 12.8, -13.7], armR: [-104.7, -15.2, 46.3], foreR: [-81.7, 1.5, 1.5],
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
      root: { p: [0.02, 0.6, -0.58], r: [10, 14, 0] },
      j: {
        hips: [-18, 18, 6.8], spine: [20, 18.8, 12], chest: [37.1, 12, 6], neck: [10.8, 0, 1.5], head: [-15.7, 2.3, 0.8],
        clavL: [42.1, -0.7, 10.8], armL: [-69.4, 39.6, -22.4], foreL: [-55.2, 28.5, 30.8],
        clavR: [14.3, 22.5, -19.2], armR: [-91.2, -1.2, 55.8], foreR: [-50.5, 3.8, 3.8],
        thighL: [-40, 10, 14], shinL: [104, 0, 0], footL: [8, 0, 0],
        thighR: [-14, -12, -12], shinR: [88, 0, 0], footR: [14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.026, 0.42, 0.12], r: [64, 176, 0] },
      j: {
        hips: [-12, 24, 0], spine: [-16, -29.2, -3], chest: [-10, 6, -2.2], neck: [-32.7, 0, 0.8], head: [22.5, -0.7, 3],
        clavL: [5.3, 6.1, 11], armL: [-43, 16.8, -22], foreL: [-116, 0, 0],
        clavR: [15.8, 6.8, 6.3], armR: [-32.4, 3.6, 34.8], foreR: [-108.5, 3.8, 3.8],
        thighL: [-14, 6, 8], shinL: [124, 0, 0], footL: [12, 0, 0],
        thighR: [-14, 27.1, -17], shinR: [124, 0, 0], footR: [12, 0, 0],
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
      root: { p: [0, 0.36, -0.46], r: [-26, 8, 8] },
      j: {
        hips: [-12, 0, -10.5], spine: [12, 0, 12], chest: [10, 0, 3], neck: [18, 0, 0], head: [-14, 10, 0],
        clavL: [6, 0, 40.3], armL: [-154, 28.5, -52], foreL: [-131.7, -1.5, 0],
        clavR: [0, 0, -24], armR: [-128, -28, 48], foreR: [-134, 0, 0],
        thighL: [-74, 12, 24], shinL: [72, 0, 0], footL: [-14, 0, 0],
        thighR: [-75.5, -16.5, -24], shinR: [75.8, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.44, -0.06], r: [-10, 4, 4] },
      j: {
        hips: [-6, -7.5, -6], spine: [-4, -4.5, -6], chest: [-6, 12.1, -7.5], neck: [-14, -15, -11.2], head: [15.1, 0.8, -3],
        clavL: [0, 0, 22], armL: [-138, 30, -50], foreL: [-118, 0, 0],
        clavR: [7.6, 3.8, -18.2], armR: [-135.7, -32.2, 50.8], foreR: [-118, 0, 0],
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
      root: { p: [0, 0.4, 0.3], r: [-54, 176, 0] },
      j: {
        hips: [-16, 15.8, 0], spine: [-16.7, 21.8, 3.8], chest: [-12, 10.5, 6.1], neck: [-10, 0, 0], head: [8, 0, 0],
        clavL: [-27.7, 22.6, 52.6], armL: [-99.6, 24.9, -39.2], foreL: [-123.6, 13.5, 16.6],
        clavR: [-1.5, 0, -5.9], armR: [-96.6, -33, 31.8], foreR: [-107.2, -16.4, -18],
        thighL: [-104, 8, 12], shinL: [26, 0, 0], footL: [-16, 0, 0],
        thighR: [-96, -8, -14], shinR: [30, 0, 0], footR: [-16, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.211, -0.296], r: [-90, 176, 18] },
      j: {
        hips: [4, 0, 0], spine: [-6, 0, 0], chest: [-4, 0, 0], neck: [-16, 0, 0], head: [14, 0, 0],
        clavL: [0, 0, 26], armL: [-176, 20, -27.7], foreL: [-6.7, 24.1, 0.8],
        clavR: [-0.7, -7.5, -14.2], armR: [-89.7, -22, 34], foreR: [-104, 0, 0],
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
      root: { p: [0.03, 0.5, -0.31], r: [30, 0, 0] },
      j: {
        hips: [-16, 0, -6], spine: [26, 12, 6], chest: [24, 9, 6], neck: [22, 0, 0], head: [-18, 0, 0],
        clavL: [6, 9, 26], armL: [-165, 15, -28], foreL: [-25.7, -5.2, 0],
        clavR: [-1.5, 6.8, -16.7], armR: [-84.7, -19.2, 30], foreR: [-58, 0, 0],
        thighL: [6.3, 30.6, 10.8], shinL: [96, 0, 0], footL: [20, 0, 0],
        thighR: [-8, -8, -10], shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.27, 0.13], r: [-64, 180, 0] },
      j: {
        hips: [14, 0, 0], spine: [-22, -9, -19.5], chest: [-12, 0, -0.7], neck: [-30, 0, 0], head: [20, 0, 0],
        clavL: [24, 0, 21.3], armL: [-109.9, 29.3, -37], foreL: [-116.9, 5.3, 0.9],
        clavR: [0.8, 6.8, -14.4], armR: [-92, -24, 34], foreR: [-84, 0, 0],
        thighL: [-164.9, 15.8, 6.8], shinL: [126, 0, -5.2], footL: [-10, 0, 0],
        thighR: [-126, -21.7, -22], shinR: [140, 0, 10], footR: [-10, 0, 0],
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
      root: { p: [0.31, 0.4, 0.274], r: [12, 116, 0] },
      j: {
        hips: [-29.5, -12, -6], spine: [32.5, -6, 6], chest: [32, -6, 6], neck: [24, 0, 0], head: [-28, 0, 0],
        clavL: [0, 4.5, -3.7], armL: [-78, 28, -50], foreL: [-113.7, -0.7, -0.7],
        clavR: [-9, 6.8, -12], armR: [-80.2, -35.2, 41.5], foreR: [-118, 0, 0],
        thighL: [-56, 14, 20], shinL: [108, 0, 0], footL: [14, 0, 0],
        thighR: [-18, 8.8, -22], shinR: [101.8, 1.5, -1.5], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.215, -0.011], r: [-90, 180, 8] },
      j: {
        hips: [10, 13.5, 6], spine: [1, 15, 6], chest: [0.8, 15, 0], neck: [-37, -0.7, 0.8], head: [1.5, -27.5, 6],
        clavL: [4.6, 15.1, 40.5], armL: [-151.5, 45.3, -60], foreL: [-112, 0, 6],
        clavR: [3.8, 12.8, -32.5], armR: [-58.7, -19.7, 33], foreR: [-72, 0, 0],
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
      root: { p: [-0.03, 0.44, -0.37], r: [50, 0, 0] },
      j: {
        hips: [-8, 0, -6], spine: [28, 6, 0], chest: [16.3, 6, 0], neck: [-21.4, -5.2, -9.7], head: [8.5, -11.1, -29.1],
        clavL: [2.3, 3.1, 7.3], armL: [-67.7, 14.5, -25.5], foreL: [-52, 0, 0],
        clavR: [8.3, 1.5, -12.5], armR: [-67.7, -9.2, 30], foreR: [-51.2, 0, 0],
        thighL: [-22, 4.3, 6.8], shinL: [98, 0, 0], footL: [20, 0, 0],
        thighR: [-10, -8, -12], shinR: [98, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.3, 0.16], r: [-56, 180, 0] },
      j: {
        hips: [22, 0, 0], spine: [-18, 0, -6], chest: [-8, 0, -6], neck: [-22, 0, 0], head: [16, 0, 0],
        clavL: [6, 6, 24], armL: [-143.7, 25, -28], foreL: [-128.2, 17.3, 20.3],
        clavR: [-1.5, 2.3, -22.7], armR: [-139.5, -23, 43.5], foreR: [-120, 0, 0],
        thighL: [-117.2, 15.5, 24], shinL: [104, 0, 0], footL: [-10, 0, 0],
        thighR: [-124.7, -15.5, -24.7], shinR: [104, 0, 0], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'neck' },
      { role: 'B', hand: 'R', point: 'wristL', self: true },
    ],
  }),
};

export const POSE_IDS = Object.keys(POSES);
