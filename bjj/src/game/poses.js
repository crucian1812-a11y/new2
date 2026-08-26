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
// `hold` is what makes the pose this position and not the one next door, in a
// form pose-check and the pose solver can both read: the mounted man's hips are
// over his opponent's and his knees are on opposite sides, the man in back
// control is behind and above. Without it a solver asked only to stop the two
// of them overlapping will happily slide the top man off into side control and
// leave the label saying MOUNT. See intent.js.
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
      root: { p: [0.004, 0.864, -0.31], r: [0, 6, 0] },
      j: {
        hips: [-10, -6, 0.8], spine: [17, 1.5, 6], chest: [13, -1.5, 9.8], neck: [-3.9, 9.9, 16], head: [-4, 0, 0],
        clavL: [8.4, 9, 27.5], armL: [-118.2, 57.8, 28.8], foreL: [-144.5, 16.6, 22.7],
        clavR: [4.6, 25.8, 3.7], armR: [-71.7, -20.1, 21.9], foreR: [-64, 0, 0],
        thighL: [-26, 12, 6], shinL: [40, 0, 0], footL: [-18, -8, 0],
        thighR: [16, -14, -6], shinR: [30, 0, 0], footR: [-46, 12, 0],
      },
    },
    B: {
      root: { p: [-0.06, 0.85, 0.34], r: [0, 186, 0] },
      j: {
        hips: [-10, -3.7, 0], spine: [11, -0.7, 6.8], chest: [7, 6, 6.8], neck: [6.7, 0.9, 25.7], head: [-5.4, 0, 1.6],
        clavL: [37.8, 0, 19.3], armL: [-75.2, 11.1, -8.8], foreL: [-98.8, -33.6, -29.1],
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
      root: { p: [-0.045, 0.615, -0.31], r: [0, 0, 0] },
      j: {
        hips: [16, -24.7, 18.1], spine: [37, 12.1, 9.1], chest: [20.3, -4.4, 14.4], neck: [7.8, 0, 0], head: [-8, 0, 0],
        clavL: [24.9, -8.9, -28.1], armL: [-13, 8.9, 25.2], foreL: [-43.6, -14, -26],
        clavR: [-42.6, 54.1, 0.6], armR: [-79.9, -16.9, 29.8], foreR: [-48.1, 8.4, 19.6],
        thighL: [1.3, 6, 12.5], shinL: [92, 0, 0], footL: [24, 0, 0],
        thighR: [18.6, -14.2, -26.7], shinR: [92, 0, 0], footR: [24, 0, 0],
      },
    },
    B: {
      root: { p: [-0.011, 0.34, -0.04], r: [-90, 180, 0] },
      j: {
        hips: [14, 18, 12], spine: [13.1, 16.5, 33.8], chest: [4, 17.3, -17.1], neck: [-24, 0, 0], head: [16, 0, 0],
        clavL: [3.1, -7.4, -0.6], armL: [-87.2, 19.3, -31.2], foreL: [-57.2, -1.5, -0.7],
        clavR: [-33.5, 25.5, -17.1], armR: [-109.6, -27.2, 18.6], foreR: [-75, 21.3, 17.5],
        thighL: [-65.9, 10.1, 9.1], shinL: [139.1, -2.2, -10.7], footL: [-10, 0, 0],
        thighR: [-115.4, 13.4, 5.3], shinR: [142.9, -3.7, 16.1], footR: [-10, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.hips', by: 0.24 },
      { straddle: 'A.chest', with: ['B.shinL', 'B.shinR'], by: 0.11 },
    ],
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
        hips: [10.3, -6.7, -18.7], spine: [19.6, -9.7, -6.7], chest: [8, -1.5, 3.8], neck: [8, 0, 0],
        clavL: [-5.2, -16.5, 24.4], armL: [-89.1, 29.1, -20.9], foreL: [-34.7, -0.7, 3.9],
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
        thighR: [-117.5, -7.7, -11.2], shinR: [56.3, 3, 1.5], footR: [-20, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.chest', by: 0.24 },
    ],
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
      root: { p: [0.202, 0.48, -0.15], r: [0, 24, 0] },
      j: {
        hips: [7.8, 0, 24], spine: [38, -6, 33], chest: [-2, -6, 9], neck: [12.5, 0, -0.7], head: [-10, 0, 0],
        clavL: [-20.8, 9.8, 34.4], armL: [-105.6, 61.1, 5.9], foreL: [-45.1, 9.1, -0.6],
        clavR: [0, 0, -7.5], armR: [-61.7, -8, 20], foreR: [-49.3, 14.3, -15.6],
        thighL: [-30.7, 10, 14], shinL: [104, 0, 0], footL: [10, 0, 0],
        thighR: [0, 38.8, -20.5], shinR: [97.6, 4.6, -3.7], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.1, 0.275, 0.07], r: [-72, 156, -22] },
      j: {
        hips: [19, -13.5, -4.5], spine: [-6.2, 28.5, 19.5], chest: [5.3, 15, -9], neck: [-20, 0, 0], head: [14, 0, 6],
        clavL: [10.7, 25.6, -10.1], armL: [-92.5, 34.5, -26.6], foreL: [-81.8, -8, -5.1],
        clavR: [15.9, -0.7, -32.4], armR: [-17.3, 27.2, 12.4], foreR: [-41.4, 28.6, 6.1],
        thighL: [-86, 8, 18], shinL: [88, 0, 0], footL: [-14, 0, 0],
        thighR: [-62.9, -38.9, -27.7], shinR: [84.8, -13.4, 13.5], footR: [-14, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.chest', by: 0.16 },
      { of: 'A.chest', near: 'B.chest', within: 0.36 },
    ],
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
      root: { p: [0.27, 0.33, 0.25], r: [8, 100, 0] },
      j: {
        hips: [-42, -27, -7.5], spine: [57.8, -24, 22.6], chest: [52, -24, 18.8], neck: [17.8, 9, -4.5], head: [-30, 0, 0],
        clavL: [-14.9, -24.7, -14.4], armL: [-72.9, 38.8, -57.1], foreL: [-117.4, 9.1, 7.6],
        clavR: [12.8, -35.9, -18.7], armR: [-38.7, -31.5, 34.9], foreR: [-125.1, 5.3, -8.1],
        thighL: [-50.4, 10.3, 15], shinL: [113.6, -2.2, 2.3], footL: [16, 0, 0],
        thighR: [-8, -29.4, -16.8], shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.275, -0.03], r: [-90, 180, 0] },
      j: {
        hips: [16, -7.5, 6], spine: [-2, -11.2, 6], chest: [8, -3.7, 12], neck: [-3.7, 24.1, 16.5], head: [23.5, 8.6, -11.9],
        clavL: [-25.3, -5.9, 17], armL: [-139.7, 22.5, -38.4], foreL: [-110.9, 9.1, 3.8],
        clavR: [4.6, -21, 4.4], armR: [-51.1, -31.7, 10.8], foreR: [-75.2, 5.4, -5.1],
        thighL: [-28, 6, 12], shinL: [46, 0, 0], footL: [-16, 0, 0],
        thighR: [-16, -6, -10], shinR: [34, 0, 0], footR: [-16, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.chest', by: 0.16 },
      { of: 'A.chest', near: 'B.chest', within: 0.3 },
    ],
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
      root: { p: [0.06, 0.588, 0.045], r: [-6, 100, 0] },
      j: {
        hips: [-29.5, -24, 6], spine: [-11.7, -11.2, 48.8], chest: [-21.7, -2.2, 35.3], neck: [13.5, 0, -0.7], head: [-16, 0, 0],
        clavL: [6.1, 12.9, 10.3], armL: [-49.6, 17.9, -28.4], foreL: [-72.7, -0.7, -2.1],
        clavR: [-8.9, -17.9, 7.7], armR: [-52.5, -5.6, 29.5], foreR: [-37.6, 27.9, 21.2],
        thighL: [-124, 10, 22], shinL: [58, 0, 0], footL: [8, 0, 0],
        thighR: [-12, -17, -50], shinR: [21.3, 0.1, -18], footR: [-30, 0, 0],
      },
    },
    B: {
      root: { p: [-0.155, 0.253, 0.023], r: [-90, 180, 0] },
      j: {
        hips: [13, 52.5, -10.5], spine: [-18.5, -6.7, 15], chest: [0.5, 27, 27], neck: [-16, 0, 0], head: [12, -24, 0],
        clavL: [1.5, 18, 31.1], armL: [-116.4, 48.8, -29.9], foreL: [-83.2, -4.5, -2.2],
        clavR: [-20.1, -11.9, -33.6], armR: [-71.4, -29.9, 26.1], foreR: [-78, 0, 0],
        thighL: [-34, 6, 12], shinL: [52, 0, 0], footL: [-16, 0, 0],
        thighR: [-20, -6, -10], shinR: [40, 0, 0], footR: [-16, 0, 0],
      },
    },
    hold: [
      { of: 'A.hips', above: 'B.chest', by: 0.34 },
      { of: 'A.hips', near: 'B.chest', within: 0.32 },
    ],
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
      root: { p: [0.008, 0.538, 0.055], r: [0, 0, 0] },
      j: {
        hips: [24.1, 4.5, 0], spine: [8.9, 9.8, -32.1], chest: [30.9, -13.3, -18.6], neck: [12, 0, 0], head: [-10, 0, 0],
        clavL: [6.1, -17.8, -9.7], armL: [-88.1, 13.1, -26.7], foreL: [-72.8, 1.8, 3.1],
        clavR: [7, 14.5, 39], armR: [-82.2, -6.8, 36.7], foreR: [-81.9, -3.7, 3.1],
        thighL: [-4.7, 14.5, 78.5], shinL: [98, 0, 0], footL: [18, 0, 0],
        thighR: [1.4, -15.8, -43.1], shinR: [98, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0.016, 0.275, 0.255], r: [-90, 180, 0] },
      j: {
        hips: [20, -15.5, -6], spine: [6, -0.7, -11.2], chest: [13.8, 17.3, 17.3], neck: [-20, 0, 0], head: [14, 0, 0],
        clavL: [-8.1, -25.5, 1], armL: [-151.4, 47, 13.1], foreL: [-120.6, 6.2, 6.1],
        clavR: [12.1, 23.3, -16], armR: [-173.9, 1.8, 25.3], foreR: [-95.2, 0.8, -0.7],
        thighL: [-27.6, -8.1, -9.4], shinL: [33.4, 0, 0], footL: [-14, 0, 0],
        thighR: [-26.9, -6.7, -2.4], shinR: [36.3, 0, 0], footR: [-14, 0, 0],
      },
    },
    hold: [
      { of: 'A.hips', above: 'B.hips', by: 0.17 },
      { of: 'A.hips', near: 'B.hips', within: 0.17 },
      { straddle: 'B.chest', with: ['A.shinL', 'A.shinR'], by: 0.13 },
    ],
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
        hips: [0, -3, -12.6], spine: [22, -12, 0], chest: [20, -9, 9], neck: [16, 0, 0], head: [-12, 8, 0],
        clavL: [-1.5, -10.4, 11.1], armL: [-134.4, 27, -50], foreL: [-95, 8.4, 3],
        clavR: [9, 0, -14], armR: [-107.5, -40.4, 3.1], foreR: [-126.7, -51.7, -35.2],
        thighL: [-70, 12.8, 24.3], shinL: [76, 0, 0], footL: [-14, 0, 0],
        thighR: [-70, -15, -22], shinR: [76, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.354, -0.06], r: [-16, 4, 4] },
      j: {
        hips: [-8, -16.5, -4.5], spine: [6, 0, -6], chest: [-2, -6, -34.5], neck: [-6, 0, 0], head: [6, 0, 0],
        clavL: [-41.9, 14.3, 9.4], armL: [-140.7, 7.1, -31.9], foreL: [-54.7, 3.8, -8.9],
        clavR: [-3.6, 30.9, -27], armR: [-104.6, -18.1, 44.8], foreR: [-80.2, 4.6, 4.6],
        thighL: [-56, 8, 14], shinL: [86, 0, 0], footL: [-10, 0, 0],
        thighR: [-56, -8, -14], shinR: [86, 0, 0], footR: [-10, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.hips', by: 0.2 },
      { of: 'A.chest', near: 'B.chest', within: 0.34 },
      { straddle: 'B.hips', with: ['A.shinL', 'A.shinR'], by: 0.1 },
    ],
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
      root: { p: [0.046, 0.6, -0.58], r: [10, 14, 0] },
      j: {
        hips: [-6, 24.8, 32.4], spine: [38, 18.8, 12], chest: [82.1, 12, 6], neck: [10.8, 0, 1.5], head: [-15.7, 2.3, 0.8],
        clavL: [52.7, -5.9, 31.8], armL: [-64, 44.3, -11.1], foreL: [-79.9, 12.8, 19.5],
        clavR: [-11.2, 19.5, -22.8], armR: [-88.2, -19.1, 43.1], foreR: [-50.5, -2.8, -6],
        thighL: [-40, 10, 14], shinL: [104, 0, 0], footL: [8, 0, 0],
        thighR: [-14, -12, -12], shinR: [88, 0, 0], footR: [14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.078, 0.428, 0.12], r: [64, 176, 0] },
      j: {
        hips: [-6, 24, 5.4], spine: [-24.1, 23.4, 30.8], chest: [-55.7, 47.4, -47.9], neck: [-32.7, 0, 0.8], head: [22.5, -0.7, 3],
        clavL: [30.1, 45.2, -8.4], armL: [-43, 16.8, -22], foreL: [-116, 0, 0],
        clavR: [42.9, -23.1, 22.2], armR: [-13.6, 2.8, 31.8], foreR: [-107, 2.3, 3.8],
        thighL: [36.4, 51.1, 48.6], shinL: [164.6, -20.9, 6.8], footL: [12, 0, 0],
        thighR: [25.9, 4.7, -52.9], shinR: [157.9, 24.8, -8.2], footR: [12, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.chest', by: 0.16 },
      { of: 'A.chest', near: 'B.chest', within: 0.36 },
    ],
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
      root: { p: [0.004, 0.413, -0.408], r: [-26, 8, 8] },
      j: {
        hips: [-6, -12.7, -10.5], spine: [18, 0, 6], chest: [-7.9, -10.5, 3], neck: [18, 0, 0], head: [-14, 10, 0],
        clavL: [6.8, 0.8, 23], armL: [-159.9, 39.8, -36.1], foreL: [-131.7, 1.5, 1.5],
        clavR: [5.3, -11.1, -30.6], armR: [-122.6, -27.2, 57.1], foreR: [-130.1, 2.3, -0.7],
        thighL: [-74, 15.8, 24.8], shinL: [72, 0, 0], footL: [-14, 0, 0],
        thighR: [-75.5, -16.5, -24], shinR: [75.8, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.026, 0.41, -0.06], r: [-10, 4, 4] },
      j: {
        hips: [-6, -2.2, -12.7], spine: [-10, -5.2, 0], chest: [-2.2, 16.6, -12.7], neck: [-23, -17.2, -22.3], head: [-6.6, 27.2, 1.6],
        clavL: [-9.6, 12.8, 23.5], armL: [-141.7, 36.8, -43.9], foreL: [-118.7, -6.6, -0.7],
        clavR: [5.5, -1.4, -5.4], armR: [-130.3, -41.1, 36.6], foreR: [-117.2, -5.9, -1.5],
        thighL: [-52, 8, 14], shinL: [92, 0, 0], footL: [-10, 0, 0],
        thighR: [-52, -8, -14], shinR: [92, 0, 0], footR: [-10, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.hips', by: 0.2 },
      { of: 'A.chest', near: 'B.chest', within: 0.34 },
      { straddle: 'B.hips', with: ['A.shinL', 'A.shinR'], by: 0.1 },
    ],
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
      root: { p: [-0.004, 0.34, 0.36], r: [-54, 176, 0] },
      j: {
        hips: [14, 15.8, 6], spine: [-28.7, 20.3, 21.1], chest: [-12, 28.5, 29.4], neck: [-10, 0, 0], head: [8, 0, 0],
        clavL: [-27.7, 29.4, 57.9], armL: [-97.2, 16, -42.1], foreL: [-122.8, 21.1, 31.6],
        clavR: [-52.4, -12.7, -50.1], armR: [-68.1, -31.5, 34.1], foreR: [-116.9, -35, -34.5],
        thighL: [-68.7, 9.5, 12], shinL: [26, 0, 0], footL: [-16, 0, 0],
        thighR: [-66.7, -17, -20], shinR: [30, 0, 0], footR: [-16, 0, 0],
      },
    },
    B: {
      root: { p: [-0.052, 0.211, -0.326], r: [-90, 176, 18] },
      j: {
        hips: [-2, -3, -6], spine: [-6, 0, 0], chest: [-4, 0, 2.3], neck: [-17.5, 0.8, 0.8], head: [14, 0, 0],
        clavL: [0, 0, 20], armL: [-176, 20, -26.2], foreL: [-6.7, 42.2, 0.8],
        clavR: [-1.5, -17.2, -20.1], armR: [-87.3, -27.2, 29.5], foreR: [-105.4, 0, -0.7],
        thighL: [-30, 6, 12], shinL: [50, 0, 0], footL: [-14, 0, 0],
        thighR: [-22, -6, -10], shinR: [44, 0, 0], footR: [-14, 0, 0],
      },
    },
    hold: [
      // The armbar is the hips, not the arms: they are pressed into the
      // shoulder of the trapped arm, that arm is between the thighs, and both
      // of A's legs are down across B — one over the chest, one over the face.
      // Without the last two the solver is happy to leave A on his back with
      // his legs in the air next to a man who is not being armbarred.
      { of: 'A.hips', near: 'B.armL', within: 0.26 },
      { straddle: 'B.armL', with: ['A.thighL', 'A.thighR'], by: 0.07 },
      // Lying across him, not lying next to him: one leg over the chest, one
      // over the face, and both of them down.
      { of: 'A.shinL', near: 'B.chest', within: 0.3 },
      { of: 'A.shinR', near: 'B.head', within: 0.32 },
      { of: 'A.shinL', below: 0.42 },
      { of: 'A.shinR', below: 0.42 },
    ],
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
      root: { p: [0.023, 0.5, -0.257], r: [30, 0, 0] },
      j: {
        hips: [-4, 6, -4.5], spine: [18.5, 10.5, 12], chest: [18.8, 15, 21.8], neck: [19.8, 0.8, -1.5], head: [-19.5, -0.7, 0],
        clavL: [6.8, 1.6, 49.3], armL: [-171.7, 0, -53.5], foreL: [-46.7, -2.9, -4.5],
        clavR: [-6.6, 30.8, -26.3], armR: [-90.5, -26.7, 36], foreR: [-58.6, 12.8, 11.3],
        thighL: [7.1, 30.6, 10.8], shinL: [96, 0, 0], footL: [20, 0, 0],
        thighR: [-7.9, -7.9, -15.2], shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0.004, 0.3, 0.085], r: [-64, 180, 0] },
      j: {
        hips: [20.8, 6, -12], spine: [-17.5, -39, -20.2], chest: [-16.5, 0.8, 8.4], neck: [-30, 0, 0], head: [20, 0, 0],
        clavL: [22.5, -5.9, 24.3], armL: [-102.4, 32.4, -30.2], foreL: [-104.8, 9.8, 3.9],
        clavR: [0.8, 7.6, -15.1], armR: [-92.7, -24, 34], foreR: [-84, 0, 0],
        thighL: [-158.9, 15.8, 6.1], shinL: [126, -3.7, -1.5], footL: [-10, 0, 0],
        thighR: [-56.9, -8.1, -21.2], shinR: [147.5, 0.8, 9.3], footR: [-10, 0, 0],
      },
    },
    hold: [
      { of: 'A.head', near: 'B.hips', within: 0.34 },
      // The figure-four: both of B's legs are round A's neck and neither of
      // them is pointing at the ceiling.
      { of: 'A.head', near: 'B.thighL', within: 0.3 },
      { of: 'B.shinL', near: 'A.neck', within: 0.28 },
      { of: 'B.footL', below: 0.5 },
      { of: 'B.footR', below: 0.5 },
    ],
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
        clavL: [0, 3.8, -28.4], armL: [-78, 28, -50], foreL: [-113.7, -0.7, -0.7],
        clavR: [-32.9, 12.1, -12], armR: [-83.2, -35.9, 40.8], foreR: [-118, 0, 0],
        thighL: [-56, 14, 20], shinL: [108, 0, 0], footL: [14, 0, 0],
        thighR: [-18, 8.8, -22], shinR: [101.8, 1.5, -1.5], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.215, -0.011], r: [-90, 180, 8] },
      j: {
        hips: [10, 13.5, 6], spine: [-5, 9, 6], chest: [0.8, 5.3, 6], neck: [-34.7, -0.7, 0.8], head: [1.5, -27.5, 6],
        clavL: [2.3, 15.1, 45], armL: [-151.5, 45.3, -60], foreL: [-112, 0, 6],
        clavR: [-24.5, -33.6, -15.9], armR: [-58.7, -19.7, 33], foreR: [-72, 0, 0],
        thighL: [-30, 6, 12], shinL: [48, 0, 0], footL: [-16, 0, 0],
        thighR: [-18, -6, -10], shinR: [36, 0, 0], footR: [-16, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.chest', by: 0.14 },
      { of: 'A.chest', near: 'B.chest', within: 0.4 },
    ],
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
        hips: [-3.5, 0, -6], spine: [28, 6, 0], chest: [22.3, 6, 0], neck: [-26.6, -0.7, -9.7], head: [-4.1, -8, -18.5],
        clavL: [-61.3, -15.6, -21.1], armL: [-103.5, 99.4, 48.2], foreL: [-69.1, 18.2, 45.1],
        clavR: [33.1, 27.2, 8.6], armR: [-51.1, -24.1, 9.8], foreR: [-10.6, 13.7, -33.7],
        thighL: [-5.5, 11.8, 15.1], shinL: [98, 0, 0], footL: [20, 0, 0],
        thighR: [-8.5, -8, -12], shinR: [98, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.3, 0.16], r: [-56, 180, 0] },
      j: {
        hips: [22, 0, 0], spine: [-18, 0, -6.7], chest: [-8, 0, -6], neck: [-22, 0, 0], head: [16, 0, 0],
        clavL: [6, 6, 24], armL: [-135.3, 39.3, -18.2], foreL: [-128.2, 17.3, 46.6],
        clavR: [-1.5, 2.3, -22.7], armR: [-139.5, -23, 43.5], foreR: [-120, 0, 0],
        thighL: [-171, -3.2, -11.2], shinL: [97.3, -3.7, 5.4], footL: [-10, 0, 0],
        thighR: [-141.2, -30.4, -23.2], shinR: [92.8, 19.5, -18.7], footR: [-10, 0, 0],
      },
    },
    hold: [
      { of: 'A.head', near: 'B.chest', within: 0.32 },
      // The head is under the arm. That is the whole technique.
      { of: 'A.head', near: 'B.foreL', within: 0.24 },
      { of: 'A.head', below: 0.62 },
    ],
    grips: [
      { role: 'B', hand: 'L', point: 'neck' },
      { role: 'B', hand: 'R', point: 'wristL', self: true },
          { role: 'A', hand: 'L', point: 'beltBack' },
      { role: 'A', hand: 'R', point: 'hipL' },
    ],
  }),
};

export const POSE_IDS = Object.keys(POSES);
