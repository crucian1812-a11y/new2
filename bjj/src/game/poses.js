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
        hips: [-10, -6, 0.8], spine: [17, 1.5, 6], chest: [13, -1.5, 9.8], neck: [-0.9, 6.1, 9.1], head: [-4, 0, 0],
        clavL: [6.8, 9, 27.5], armL: [-122.7, 56.2, 18.2], foreL: [-128.1, 6, 6.1],
        clavR: [3.8, 14.4, -1.6], armR: [-71.7, -14.9, 27.1], foreR: [-64, 0, 0],
        thighL: [-26, 12, 6], shinL: [40, 0, 0], footL: [-18, -8, 0],
        thighR: [16, -14, -6], shinR: [30, 0, 0], footR: [-46, 12, 0],
      },
    },
    B: {
      root: { p: [-0.06, 0.838, 0.34], r: [0, 186, 0] },
      j: {
        hips: [-10, -3.7, 0], spine: [11, -0.7, 6.8], chest: [7, 6, 6.8], neck: [6.7, -0.7, 22.6], head: [-5.4, 0, 1.6],
        clavL: [35.4, 0, 19.3], armL: [-73.1, 11.1, -9.6], foreL: [-93.6, -32.9, -29.1],
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
      root: { p: [0.004, 0.63, -0.28], r: [0, 0, 0] },
      j: {
        hips: [10, -18.7, 0.8], spine: [28, 17.3, 2.3], chest: [30.8, 4.5, 9.1], neck: [7.8, 0, 0], head: [-8, 0, 0],
        clavL: [19.6, -15, -26.6], armL: [-12.4, 4.3, 18.4], foreL: [-43.6, -17.1, -20.1],
        clavR: [-23.2, 29.3, 5.1], armR: [-58.2, -8.7, 31.3], foreR: [-45.9, 3.8, 18.1],
        thighL: [1.3, 6, 12.5], shinL: [92, 0, 0], footL: [24, 0, 0],
        thighR: [17.1, -13.5, -26.7], shinR: [92, 0, 0], footR: [24, 0, 0],
      },
    },
    B: {
      root: { p: [0.004, 0.295, -0.04], r: [-90, 180, 0] },
      j: {
        hips: [20, 18, 24], spine: [0.3, 4.5, 33.8], chest: [-2, 12.8, 0], neck: [-24, 0, 0], head: [16, 0, 0],
        clavL: [3.1, -6.7, 0.1], armL: [-87.2, 19.3, -31.2], foreL: [-57.2, -1.5, -0.7],
        clavR: [-35.8, 25.5, 2.3], armR: [-108.9, -23.6, 22.3], foreR: [-68.4, 18.2, 15.2],
        thighL: [-96.7, 7.8, 5.3], shinL: [138.3, -2.2, -10.7], footL: [-10, 0, 0],
        thighR: [-100.4, 15.6, 11.3], shinR: [130, 1.5, 10.8], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'sleeveR' },
      { role: 'B', hand: 'R', point: 'lapelL' },
      { role: 'A', hand: 'L', point: 'lapelR' },
          { role: 'A', hand: 'R', point: 'hipL' },
    ],
  }),

  // Legs open, feet on hips: the working guard, where sweeps come from.
  OPEN_GUARD: P('OPEN_GUARD', {
    name: 'Открытая гвардия',
    label: 'OPEN GUARD',
    points: 0, top: 'A', ground: true, guardOf: 'B',
    A: {
      root: { p: [-0.083, 0.63, -0.478], r: [0, 0, 0] },
      j: {
        hips: [10.3, -7.5, -18.7], spine: [19.6, -9.7, -6.7], chest: [8, -1.5, 3.8], neck: [8, 0, 0],
        clavL: [-5.2, -16.5, 25.1], armL: [-87.6, 30.6, -20.9], foreL: [-34.7, -0.7, 3.9],
        clavR: [-6.7, 22.5, -8.5], armR: [-74.9, -20, 23.3], foreR: [-41.5, -1.4, -2.2],
        thighL: [-16, 6.5, 10], shinL: [86, 0, 0], footL: [16, 0, 0],
        thighR: [-42, -8, -8], shinR: [64, 0, 0], footR: [-20, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.254, 0.096], r: [-78, 180, 0] },
      j: {
        hips: [24.8, -6, 0.8], spine: [6.8, -9.7, -11.2], chest: [2.8, 6, -2.2], neck: [-28, 0, 0], head: [18, 0, 0],
        clavL: [-3.7, -12.7, 3.8], armL: [-78.2, 27.1, -25.4], foreL: [-77.2, -5.1, -4.4],
        clavR: [-2.9, 19.5, 3], armR: [-69.2, -21.7, 35.3], foreR: [-79.5, -5.9, -5.2],
        thighL: [-110.7, 16.6, 13.5], shinL: [42.8, -0.7, 0], footL: [-24, 0, 0],
        thighR: [-116, -7.7, -11.2], shinR: [56.3, 3, 1.5], footR: [-20, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'sleeveR' },
      { role: 'B', hand: 'R', point: 'sleeveL' },
          { role: 'A', hand: 'L', point: 'kneeR' },
      { role: 'A', hand: 'R', point: 'kneeL' },
    ],
  }),

  HALF_GUARD: P('HALF_GUARD', {
    name: 'Полугвардия',
    label: 'HALF GUARD',
    points: 0, top: 'A', ground: true, guardOf: 'B',
    A: {
      root: { p: [0.21, 0.48, -0.15], r: [0, 24, 0] },
      j: {
        hips: [-10.2, 0, 24], spine: [38, -6, 27], chest: [-2, -6, 9], neck: [12.5, 0, -0.7], head: [-10, 0, 0],
        clavL: [0.8, -3.7, 36.5], armL: [-97.4, 52.8, -3.2], foreL: [-52.7, 0.8, 3.9],
        clavR: [6, 0, -7.5], armR: [-64.7, -26, 20], foreR: [-56.9, 9, -11.2],
        thighL: [-30.7, 10, 14], shinL: [104, 0, 0], footL: [10, 0, 0],
        thighR: [-6, 38.8, -26.5], shinR: [97.6, 4.6, -3.7], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.1, 0.275, 0.07], r: [-72, 156, -22] },
      j: {
        hips: [19, -12, -6], spine: [-6.2, 27, 6], chest: [5.3, 4.5, 3], neck: [-26, 0, 0], head: [14, 0, 6],
        clavL: [12.8, 24.8, -6.4], armL: [-88.1, 37.4, -23.7], foreL: [-72.9, -2.9, -0.7],
        clavR: [38.4, 9.1, -9.2], armR: [-6.1, 12.1, 8.6], foreR: [-56.5, 11.3, 2.3],
        thighL: [-86, 8, 18], shinL: [88, 0, 0], footL: [-14, 0, 0],
        thighR: [-73.5, -33.7, -28.5], shinR: [85.5, -6, 6], footR: [-14, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'sleeveR' },
      { role: 'A', hand: 'L', point: 'lapelR' },
          { role: 'A', hand: 'R', point: 'headBack' },
      { role: 'B', hand: 'R', point: 'lapelL' },
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
        hips: [-36, -24, -12], spine: [64.5, -18, 12], chest: [52, -24, 18], neck: [23, 0, 10.5], head: [-30, 0, 0],
        clavL: [-9.7, -24.7, -13.7], armL: [-70.7, 38.8, -54.2], foreL: [-115.2, 9.1, 7.6],
        clavR: [8.3, -26.2, -13.5], armR: [-39.5, -36, 36.3], foreR: [-116.2, -0.7, -9.7],
        thighL: [-48.2, 8.8, 12], shinL: [115.8, -1.5, 1.5], footL: [16, 0, 0],
        thighR: [-14, -32.4, -16.9], shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.245, -0.03], r: [-90, 180, 0] },
      j: {
        hips: [16, -7.5, 6], spine: [-2, -5.2, 6], chest: [8, -3.7, 18], neck: [2.3, 22.6, 18], head: [29.5, 4.8, -8.2],
        clavL: [-32.1, 0.1, 11], armL: [-139.7, 22.5, -38.4], foreL: [-107.9, 1.5, 1.5],
        clavR: [8.3, -27, -0.9], armR: [-50.4, -27.2, 16.8], foreR: [-70.7, 2.3, -2.2],
        thighL: [-28, 6, 12], shinL: [46, 0, 0], footL: [-16, 0, 0],
        thighR: [-16, -6, -10], shinR: [34, 0, 0], footR: [-16, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'headBack' },
      { role: 'A', hand: 'R', point: 'lapelL' },
          { role: 'B', hand: 'L', point: 'neck' },
      { role: 'B', hand: 'R', point: 'hipL' },
    ],
  }),

  KNEE_ON_BELLY: P('KNEE_ON_BELLY', {
    name: 'Колено на животе',
    label: 'KNEE ON BELLY',
    points: 2, top: 'A', ground: true,
    A: {
      root: { p: [0.135, 0.505, 0.015], r: [-6, 100, 0] },
      j: {
        hips: [-11.5, -18, 0], spine: [-13.2, -7.5, 36.8], chest: [-20.2, -6.7, 31.5], neck: [13.5, 0, -0.7], head: [-16, 0, 0],
        clavL: [5.3, 13.6, 10.3], armL: [-51.1, 17.9, -28.4], foreL: [-74.2, -1.5, -2.1],
        clavR: [-8.2, -16.4, 8.4], armR: [-50.3, -7.9, 30.9], foreR: [-39.9, 19.6, 15.1],
        thighL: [-124, 10, 22], shinL: [58, 0, 0], footL: [8, 0, 0],
        thighR: [-6, -20, -50], shinR: [35.5, 3, -18], footR: [-30, 0, 0],
      },
    },
    B: {
      root: { p: [-0.185, 0.283, 0.053], r: [-90, 180, 0] },
      j: {
        hips: [19, 34.5, 1.5], spine: [-12.5, -6, 6], chest: [-5.5, 25.5, 15], neck: [-16, 0, 0], head: [12, -24, 0],
        clavL: [0.8, 18, 22], armL: [-115.7, 46.5, -30.7], foreL: [-85.5, -3, -1.5],
        clavR: [-20.1, -11.2, -29.2], armR: [-70.7, -30.7, 25.3], foreR: [-78, 0, 0],
        thighL: [-34, 6, 12], shinL: [52, 0, 0], footL: [-16, 0, 0],
        thighR: [-20, -6, -10], shinR: [40, 0, 0], footR: [-16, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'A', hand: 'R', point: 'beltBack' },
          { role: 'B', hand: 'L', point: 'kneeR' },
      { role: 'B', hand: 'R', point: 'kneeR' },
    ],
  }),

  MOUNT: P('MOUNT', {
    name: 'Маунт',
    label: 'MOUNT',
    points: 4, top: 'A', ground: true,
    A: {
      root: { p: [0.008, 0.53, 0.055], r: [0, 0, 0] },
      j: {
        hips: [18.8, 4.5, 0], spine: [15.5, 4.5, -25.4], chest: [27.1, -8.9, -25.4], neck: [12, 0, 0], head: [-10, 0, 0],
        clavL: [4.6, -14.1, -8.2], armL: [-87.4, 10.8, -30.5], foreL: [-64.7, 3.2, 3.1],
        clavR: [5.4, 15.1, 19.5], armR: [-80.7, -5.4, 36.6], foreR: [-70.7, -3, 1.5],
        thighL: [-4.7, 14.5, 78.5], shinL: [98, 0, 0], footL: [18, 0, 0],
        thighR: [-4, -10.7, -56.7], shinR: [98, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0.053, 0.275, 0.255], r: [-90, 180, 0] },
      j: {
        hips: [20, -7.3, -6], spine: [6, -0.7, -11.2], chest: [13.8, 17.3, 17.3], neck: [-20, 0, 0], head: [14, 0, 0],
        clavL: [21, -6, 1], armL: [-147, 18.5, -25.2], foreL: [-105, 3.8, 3.8],
        clavR: [8.3, 21.8, -16], armR: [-147.7, -5.7, 31.3], foreR: [-96, 0, -0.7],
        thighL: [-23.2, -2.2, -3.5], shinL: [37.1, 0, 0], footL: [-14, 0, 0],
        thighR: [-26.9, -6.7, -2.4], shinR: [36.3, 0, 0], footR: [-14, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'A', hand: 'R', point: 'lapelL' },
          { role: 'B', hand: 'L', point: 'hipR' },
      { role: 'B', hand: 'R', point: 'hipL' },
    ],
  }),

  BACK: P('BACK', {
    name: 'Спина',
    label: 'BACK CONTROL',
    points: 4, top: 'A', ground: true,
    A: {
      root: { p: [0.008, 0.39, -0.44], r: [-22, 8, 6] },
      j: {
        hips: [0, -3, -8.2], spine: [22, -12, 0], chest: [20, -9, 9], neck: [16, 0, 0], head: [-12, 8, 0],
        clavL: [0, -1.5, 5], armL: [-132.2, 27, -50], foreL: [-95, 8.3, 3],
        clavR: [6, 0, -14], armR: [-113.5, -24.7, 27.8], foreR: [-99.7, -21.7, -21.7],
        thighL: [-70, 12.8, 24.3], shinL: [76, 0, 0], footL: [-14, 0, 0],
        thighR: [-70, -15, -22], shinR: [76, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.361, -0.06], r: [-16, 4, 4] },
      j: {
        hips: [-8, -16.5, -4.5], spine: [6, 0, -6], chest: [-2, -6, -34.5], neck: [-6, 0, 0], head: [6, 0, 0],
        clavL: [-21.7, 9, 12.3], armL: [-125.7, 14.5, -35.7], foreL: [-75, 0, -3],
        clavR: [-8.2, 27.1, -21.9], armR: [-105.4, -17.4, 44.8], foreR: [-80.2, 3.8, 3.8],
        thighL: [-56, 8, 14], shinL: [86, 0, 0], footL: [-10, 0, 0],
        thighR: [-56, -8, -14], shinR: [86, 0, 0], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'B', hand: 'R', point: 'wristL' },
          { role: 'A', hand: 'R', point: 'wristL', self: true },
      { role: 'B', hand: 'L', point: 'sleeveL' },
    ],
  }),

  TURTLE: P('TURTLE', {
    name: 'Черепаха',
    label: 'TURTLE',
    points: 0, top: 'A', ground: true,
    A: {
      root: { p: [0.016, 0.6, -0.58], r: [10, 14, 0] },
      j: {
        hips: [-18, 12.8, 10.6], spine: [20, 18.8, 12], chest: [58.1, 12, 6], neck: [10.8, 0, 1.5], head: [-15.7, 2.3, 0.8],
        clavL: [48.1, 5.3, 10.8], armL: [-65.6, 47.9, -10.4], foreL: [-70.2, 22.5, 26.3],
        clavR: [6.8, 19.5, -28.9], armR: [-91.2, 0.3, 57.3], foreR: [-50.5, 3.8, 3.8],
        thighL: [-40, 10, 14], shinL: [104, 0, 0], footL: [8, 0, 0],
        thighR: [-14, -12, -12], shinR: [88, 0, 0], footR: [14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.018, 0.42, 0.12], r: [64, 176, 0] },
      j: {
        hips: [-12, 24, 0], spine: [-37.7, -7.4, 18.8], chest: [-31.7, 27.8, -22.4], neck: [-32.7, 0, 0.8], head: [22.5, -0.7, 3],
        clavL: [27.1, 27.9, -10.7], armL: [-43, 16.8, -22], foreL: [-116, 0, 0],
        clavR: [37.6, -14.9, 28.1], armR: [-13.6, 2.8, 31.8], foreR: [-107, 2.3, 3.8],
        thighL: [7.8, 27.8, 29.8], shinL: [145.8, -21.7, 7.5], footL: [12, 0, 0],
        thighR: [7.8, 5.4, -38.7], shinR: [145.8, 21.8, -8.2], footR: [12, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'A', hand: 'R', point: 'beltBack' },
          { role: 'B', hand: 'L', point: 'kneeL', self: true },
      { role: 'B', hand: 'R', point: 'kneeR', self: true },
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
        hips: [-12, 0, -10.5], spine: [12, 6, 6], chest: [10, 0, 3], neck: [18, 0, 0], head: [-14, 10, 0],
        clavL: [12, 0, 35.8], armL: [-169, 28.5, -52], foreL: [-131.7, 1.5, 0],
        clavR: [6, 0.8, -29.2], armR: [-124.2, -26.5, 54], foreR: [-134, 0, 0],
        thighL: [-74, 12, 24], shinL: [72, 0, 0], footL: [-14, 0, 0],
        thighR: [-75.5, -16.5, -24], shinR: [75.8, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.44, -0.06], r: [-10, 4, 4] },
      j: {
        hips: [-6, -7.5, -6], spine: [-4, -4.5, -6], chest: [-6, 18.1, -12], neck: [-14, -21, -15.7], head: [1.6, 14.3, -2.2],
        clavL: [-5.2, 4.5, 25], armL: [-141, 36, -44], foreL: [-118.7, -4.5, -0.7],
        clavR: [10.6, 9.8, -22.7], armR: [-136.4, -30.7, 53.8], foreR: [-118, 0.8, 0],
        thighL: [-52, 8, 14], shinL: [92, 0, 0], footL: [-10, 0, 0],
        thighR: [-52, -8, -14], shinR: [92, 0, 0], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'L', point: 'neck' },
      { role: 'A', hand: 'R', point: 'headBack' },
      { role: 'B', hand: 'L', point: 'sleeveL' },
      { role: 'B', hand: 'R', point: 'sleeveL' },
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
        clavL: [-27.7, 22.6, 56.4], armL: [-89.8, 28.7, -36.2], foreL: [-131.1, 22.5, 27.1],
        clavR: [-4.5, 0, -10.4], armR: [-93.6, -33, 31.8], foreR: [-110.2, -23.9, -24],
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
          { role: 'B', hand: 'R', point: 'wristL', self: true },
    ],
  }),

  TRIANGLE: P('TRIANGLE', {
    name: 'Треугольник',
    label: 'TRIANGLE CHOKE',
    points: 0, top: 'B', ground: true, submission: 'choke', from: 'CLOSED_GUARD', invert: true,
    A: {
      root: { p: [0.06, 0.5, -0.31], r: [30, 0, 0] },
      j: {
        hips: [-4, 6, -12], spine: [26, 18, 6], chest: [24.8, 9, 6], neck: [22, 0, 0], head: [-18, 0, 0],
        clavL: [-0.7, 8.3, 26.8], armL: [-176.2, 9, -28], foreL: [-43.7, -11.2, 0],
        clavR: [-12.7, 12.8, -23.4], armR: [-88.4, -31.2, 30], foreR: [-58.7, 6, 5.3],
        thighL: [6.3, 30.6, 10.8], shinL: [96, 0, 0], footL: [20, 0, 0],
        thighR: [-5.7, -7.2, -10], shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0.004, 0.27, 0.13], r: [-64, 180, 0] },
      j: {
        hips: [14, 0, 0], spine: [-22, -24, -20.2], chest: [-12, 3, 4.6], neck: [-30, 0, 0], head: [20, 0, 0],
        clavL: [30, -4.5, 21.3], armL: [-109.9, 28.6, -37], foreL: [-116.9, 5.3, 0.9],
        clavR: [0.8, 6.8, -14.4], armR: [-92, -24, 34], foreR: [-84, 0, 0],
        thighL: [-164.9, 15.8, 6.8], shinL: [126, 0, -5.2], footL: [-10, 0, 0],
        thighR: [-104.2, -8.9, -22], shinR: [141.5, 0, 10], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'wristL' },
      { role: 'B', hand: 'R', point: 'kneeL', self: true },
          { role: 'A', hand: 'R', point: 'hipR' },
    ],
  }),

  KIMURA: P('KIMURA', {
    name: 'Кимура',
    label: 'KIMURA',
    points: 3, top: 'A', ground: true, submission: 'joint', from: 'SIDE_CONTROL',
    A: {
      root: { p: [0.31, 0.4, 0.237], r: [12, 116, 0] },
      j: {
        hips: [-29.5, -12, -6], spine: [33.3, -6, 6], chest: [32, -6, 6], neck: [24, 0, 0], head: [-28, 0, 0],
        clavL: [0, 3.8, -23.2], armL: [-78, 28, -50], foreL: [-113.7, -0.7, -0.7],
        clavR: [-21, 12.1, -12], armR: [-83.2, -38.9, 37.8], foreR: [-118, 0, 0],
        thighL: [-56, 14, 20], shinL: [108, 0, 0], footL: [14, 0, 0],
        thighR: [-18, 8.8, -22], shinR: [101.8, 1.5, -1.5], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.215, -0.011], r: [-90, 180, 8] },
      j: {
        hips: [10, 13.5, 6], spine: [-5, 9, 6], chest: [0.8, 5.3, 6], neck: [-34.7, -0.7, 0.8], head: [1.5, -27.5, 6],
        clavL: [2.3, 15.1, 40.5], armL: [-151.5, 45.3, -60], foreL: [-112, 0, 6],
        clavR: [-17.9, -8.9, -10.7], armR: [-58.7, -19.7, 33], foreR: [-72, 0, 0],
        thighL: [-30, 6, 12], shinL: [48, 0, 0], footL: [-16, 0, 0],
        thighR: [-18, -6, -10], shinR: [36, 0, 0], footR: [-16, 0, 0],
      },
    },
    grips: [
      { role: 'A', hand: 'R', point: 'wristL' },
      { role: 'A', hand: 'L', point: 'wristR', self: true },
          { role: 'B', hand: 'R', point: 'beltBack', self: true },
    ],
  }),

  GUILLOTINE: P('GUILLOTINE', {
    name: 'Гильотина',
    label: 'GUILLOTINE',
    points: 0, top: 'B', ground: true, submission: 'choke', from: 'CLOSED_GUARD', invert: true,
    A: {
      root: { p: [-0.03, 0.44, -0.37], r: [50, 0, 0] },
      j: {
        hips: [-3.5, 0, -6], spine: [28, 6, 0], chest: [22.3, 6, 0], neck: [-26.6, -0.7, -9.7], head: [-3.4, -7.3, -13.3],
        clavL: [-41.1, -15.6, -7.6], armL: [-72.9, 58.1, 18.1], foreL: [-58.7, 4.6, 26.3],
        clavR: [28.6, 27.1, 7.1], armR: [-48.1, -27.1, 9.8], foreR: [-19.7, 12.1, -28.5],
        thighL: [-5.5, 11.8, 15.1], shinL: [98, 0, 0], footL: [20, 0, 0],
        thighR: [-8.5, -8, -12], shinR: [98, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.3, 0.16], r: [-56, 180, 0] },
      j: {
        hips: [22, 0, 0], spine: [-18, 0, -6.7], chest: [-8, 0, -6], neck: [-22, 0, 0], head: [16, 0, 0],
        clavL: [6, 6, 24], armL: [-133.1, 38.5, -18.2], foreL: [-128.2, 17.3, 42.8],
        clavR: [-1.5, 2.3, -22.7], armR: [-139.5, -23, 43.5], foreR: [-120, 0, 0],
        thighL: [-160.6, 10.3, -5.2], shinL: [99.5, -3, 4.6], footL: [-10, 0, 0],
        thighR: [-142.7, -24.5, -23.2], shinR: [92.8, 19.5, -18.7], footR: [-10, 0, 0],
      },
    },
    grips: [
      { role: 'B', hand: 'L', point: 'neck' },
      { role: 'B', hand: 'R', point: 'wristL', self: true },
          { role: 'A', hand: 'L', point: 'beltBack' },
      { role: 'A', hand: 'R', point: 'hipL' },
    ],
  }),
};

export const POSE_IDS = Object.keys(POSES);
