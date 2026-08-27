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

// Held positions share their intent and their grips with the variant of
// themselves that they move through while they are held: the same position
// doing something is still the same position, and if what makes it that
// position is edited it has to be edited once.
const BACK_HOLD = [
      { of: 'A.chest', above: 'B.hips', by: 0.2 },
      { of: 'A.chest', near: 'B.chest', within: 0.34 },
      { straddle: 'B.hips', with: ['A.shinL', 'A.shinR'], by: 0.1 },
];
const BACK_GRIPS = [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'B', hand: 'R', point: 'wristL' },
          { role: 'A', hand: 'R', point: 'wristL', self: true },
      { role: 'B', hand: 'L', point: 'sleeveL' },
];
const RNC_HOLD = [
      { of: 'A.chest', above: 'B.hips', by: 0.2 },
      { of: 'A.chest', near: 'B.chest', within: 0.34 },
      { straddle: 'B.hips', with: ['A.shinL', 'A.shinR'], by: 0.1 },
];
const RNC_GRIPS = [
      { role: 'A', hand: 'L', point: 'neck' },
      { role: 'A', hand: 'R', point: 'headBack' },
      { role: 'B', hand: 'L', point: 'sleeveL' },
      { role: 'B', hand: 'R', point: 'sleeveL' },
];
const HALF_GUARD_HOLD = [
      { of: 'A.chest', above: 'B.chest', by: 0.16 },
      { of: 'A.chest', near: 'B.chest', within: 0.36 },
];
const HALF_GUARD_GRIPS = [
      { role: 'B', hand: 'L', point: 'sleeveR' },
      { role: 'A', hand: 'L', point: 'lapelR' },
          { role: 'A', hand: 'R', point: 'headBack' },
      { role: 'B', hand: 'R', point: 'lapelL' },
];
const MOUNT_HOLD = [
      { of: 'A.hips', above: 'B.hips', by: 0.17 },
      { of: 'A.hips', near: 'B.hips', within: 0.17 },
      { straddle: 'B.chest', with: ['A.shinL', 'A.shinR'], by: 0.13 },
];
const MOUNT_GRIPS = [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'A', hand: 'R', point: 'lapelL' },
          { role: 'B', hand: 'L', point: 'hipR' },
      { role: 'B', hand: 'R', point: 'hipL' },
];
const SIDE_CONTROL_HOLD = [
      { of: 'A.chest', above: 'B.chest', by: 0.16 },
      { of: 'A.chest', near: 'B.chest', within: 0.3 },
];
const SIDE_CONTROL_GRIPS = [
      { role: 'A', hand: 'L', point: 'headBack' },
      { role: 'A', hand: 'R', point: 'lapelL' },
          { role: 'B', hand: 'L', point: 'neck' },
      { role: 'B', hand: 'R', point: 'hipL' },
];

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
    name: 'Закрытый гард',
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
    name: 'Открытый гард',
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
    name: 'Полугард',
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
    hold: HALF_GUARD_HOLD,
    grips: HALF_GUARD_GRIPS,
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
    hold: SIDE_CONTROL_HOLD,
    grips: SIDE_CONTROL_GRIPS,
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
    hold: MOUNT_HOLD,
    grips: MOUNT_GRIPS,
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
    hold: BACK_HOLD,
    grips: BACK_GRIPS,
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
    hold: RNC_HOLD,
    grips: RNC_GRIPS,
  }),

  ARMBAR: P('ARMBAR', {
    name: 'Рычаг локтя',
    label: 'ARMBAR',
    points: 4, top: 'A', ground: true, submission: 'joint', from: 'MOUNT',
    // Authored, not relaxed into shape.
    //
    // The solver could satisfy every constraint on this position with the two
    // of them lying side by side, because the thing that makes an armbar an
    // armbar is a *layout*: the two spines cross at right angles, A's hips are
    // jammed into the shoulder of the trapped arm, and A's legs run out across
    // the man underneath — one over the chest, one over the face. That is a
    // frame to be worked out on paper, not searched for.
    //
    // B lies along +Z with his head at the far end. A lies across him with his
    // head at -X, which is the yaw that puts a supine fighter's head that way:
    // pitch -90 lays him on his back with his head at -Z, and 90 degrees of yaw
    // swings it round to -X. A's legs then leave his hips towards +X, which is
    // straight over B, and rolling the thighs about their own axis — which for
    // a fighter in this attitude is the world's vertical — splays one leg
    // towards B's head and one towards his hips without lifting either.
    A: {
      root: { p: [-0.374, 0.27, 0.39], r: [-90, 90, 0] },
      j: {
        hips: [16, -12, 1.5], spine: [16, 27.8, 30], chest: [20, -0.7, 30], neck: [-16, 0, 0], head: [22, 0, 0],
        clavL: [-11.2, -14.2, 30.5], armL: [-104.2, 22.8, -38.5], foreL: [-84, -6, -0.7],
        clavR: [-3, 6.8, -21.5], armR: [-102, -22, 34], foreR: [-88.5, 2.3, 2.3],
        thighL: [-32.2, 0, 51.3], shinL: [24.3, 0.8, -0.7], footL: [-12, 0, 0],
        thighR: [-6, -4.5, -32.2], shinR: [42, -6, 0], footR: [-12, 0, 0],
      },
    },
    B: {
      root: { p: [-0.03, 0.14, 0.02], r: [-90, 180, 0] },
      j: {
        hips: [12, 6.8, 0], spine: [4, 11.3, 0], chest: [12, 6.8, 12.8], neck: [-14, 0, 0], head: [10, 0, 0],
        // The trapped arm reaches across to A's chest, which is what pulls it
        // straight; the free one is stacked under him where it can do nothing.
        clavL: [1.5, -6, 44], armL: [-82, 38, -18], foreL: [-38, -3, 6],
        clavR: [30, 30, -42], armR: [-55.7, -17, 30], foreR: [-59.2, 8.3, 9],
        thighL: [-16, 6, 10], shinL: [42, 0, 0], footL: [-12, 0, 0],
        thighR: [-16.2, -6, -8], shinR: [38, 0, 0], footR: [-12, 0, 0],
      },
    },
    hold: [
      // The hips, not the arms. They are pressed into the shoulder of the
      // trapped arm and that arm is between the thighs.
      { of: 'A.hips', near: 'B.armL', within: 0.24 },
      { straddle: 'B.armL', with: ['A.thighL', 'A.thighR'], by: 0.07 },
      // Straight, which is the technique — and stated as a distance rather
      // than as a height, because an arm extended towards a man lying beside
      // you is horizontal. The earlier version asked for it to point at the
      // ceiling and got a pose nobody in this sport has ever been in.
      { of: 'B.handL', far: 'B.armL', atLeast: 0.46 },
      // Lying across him, not next to him, and neither leg in the air.
      { of: 'A.chest', below: 0.44 },
      { of: 'A.shinL', near: 'B.chest', within: 0.3 },
      { of: 'A.shinR', near: 'B.head', within: 0.34 },
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

  /* ------------------------------------------------- the same, working - */
  //
  // A held position is a photograph with breathing on it, and the fight
  // spends most of its time in one. Each of these is the position it names
  // with the two of them doing something in it — a hip switched, a knee
  // walked up, a frame posted — and the rig cycles the pair of them slowly
  // for as long as the position is held. They are poses like any other:
  // solved by pose-relax, measured by pose-check, and they carry the same
  // `hold`, so a variant that has quietly become another position fails.

  BACK_WORK: P('BACK_WORK', {
    // A тянет сиденье ремня и подбирает крюки выше; B прячет шею и
    // разворачивается к обхватывающей руке.
    name: 'Спина — работа',
    label: 'BACK CONTROL',
    points: 4, top: 'A', ground: true, variantOf: 'BACK',
    A: {
      root: { p: [0.008, 0.384, -0.46], r: [-22, 8, 6] },
      j: {
        hips: [0, -12.7, -27.6], spine: [24, -12, 0], chest: [22, -11, 9],
        neck: [20, 0, 0], head: [-12, 8, 0], clavL: [-2.2, -3.6, 14.1],
        armL: [-128.4, 32.3, -50], foreL: [-92.2, 12.2, 6.8], clavR: [14.3, 0, -14],
        armR: [-109, -37.4, -0.6], foreR: [-131.9, -63.7, -35.2], thighL: [-77, 16.6, 27.3],
        shinL: [81, 0, 0], footL: [-14, 0, 0], thighR: [-77, -15, -25],
        shinR: [81, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.354, -0.05], r: [-16, 4, 4] },
      j: {
        hips: [-8, -16.5, -4.5], spine: [2, 0, -6], chest: [-2, -12, -34.5],
        neck: [-8.7, -9.7, -2.2], head: [13, -8, 0], clavL: [-34.4, 15.8, 6.4],
        armL: [-146.9, 6.4, -31.9], foreL: [-49.4, 5.3, -10.4], clavR: [5.9, 35.4, -30],
        armR: [-105.3, -20.3, 44.1], foreR: [-78.7, 5.4, 5.4], thighL: [-56, 8, 14],
        shinL: [86, 0, 0], footL: [-10, 0, 0], thighR: [-56, -8, -14],
        shinR: [86, 0, 0], footR: [-10, 0, 0],
      },
    },
    hold: BACK_HOLD,
    grips: BACK_GRIPS,
  }),

  RNC_WORK: P('RNC_WORK', {
    // Сжатие: A подтягивает предплечья и уводит голову вниз, у B
    // выгибается спина и руки тянут захват от горла.
    name: 'Удушение — сжатие',
    label: 'REAR NAKED CHOKE',
    points: 4, top: 'A', ground: true, variantOf: 'RNC',
    submission: 'choke', from: 'BACK',
    A: {
      root: { p: [0.004, 0.423, -0.409], r: [-26, 8, 8] },
      j: {
        hips: [-6, -12.7, -10.5], spine: [18, 0, 6.8], chest: [-13.9, -10.5, 2.3],
        neck: [25, 0, 0], head: [-21, 10, 0], clavL: [8.3, -0.7, 22.3],
        armL: [-161.4, 39.8, -36.1], foreL: [-134.7, 1.5, 1.5], clavR: [5.3, -11.8, -31.3],
        armR: [-122.6, -27.2, 57.1], foreR: [-135.3, 3.1, -0.7], thighL: [-74, 15.8, 24.8],
        shinL: [72, 0, 0], footL: [-14, 0, 0], thighR: [-75.5, -16.5, -25.5],
        shinR: [75.8, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.026, 0.415, -0.066], r: [-10, 4, 4] },
      j: {
        hips: [-2, -2.2, -12.7], spine: [-17, -5.9, -0.7], chest: [3.3, 16.6, -12.7],
        neck: [-28.2, -18.7, -23], head: [-7.3, 27.2, 1.6], clavL: [-11.1, 14.3, 22.8],
        armL: [-141.7, 37.6, -43.1], foreL: [-124.7, -6.6, -0.7], clavR: [4.8, -2.1, -4.6],
        armR: [-130.3, -41.8, 35.1], foreR: [-123.2, -6.6, -1.5], thighL: [-52, 8, 14],
        shinL: [92, 0, 0], footL: [-10, 0, 0], thighR: [-52, -8, -14],
        shinR: [92, 0, 0], footR: [-10, 0, 0],
      },
    },
    hold: RNC_HOLD,
    grips: RNC_GRIPS,
  }),

  HALF_GUARD_WORK: P('HALF_GUARD_WORK', {
    // A продавливает колено наружу и наваливается плечом; B ставит
    // раму и уходит на бок, поднимая щит коленом.
    name: 'Полугард — проход',
    label: 'HALF GUARD',
    points: 0, top: 'A', ground: true, variantOf: 'HALF_GUARD',
    A: {
      root: { p: [0.217, 0.47, -0.13], r: [0, 24, 0] },
      j: {
        hips: [13.8, -6, 30], spine: [26, 0, 33], chest: [-2, -6, 3],
        neck: [12.5, 0, -0.7], head: [-10, 0, 0], clavL: [-17, 4.6, 32.2],
        armL: [-101.1, 55.1, 0.7], foreL: [-47.3, 12.9, -1.3], clavR: [0, 0, -7.5],
        armR: [-58.7, -14, 20], foreR: [-47.8, 13.6, -17.1], thighL: [-30.7, 10, 14],
        shinL: [104, 0, 0], footL: [10, 0, 0], thighR: [-8, 42.8, -20.5],
        shinR: [103.6, 4.6, -3.7], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.11, 0.28, 0.05], r: [-72, 156, -22] },
      j: {
        hips: [13, -16.5, -4.5], spine: [-6.2, 28.5, 19.5], chest: [5.3, 18.3, -12],
        neck: [-23, 0, 0], head: [14, 3, 6], clavL: [10.7, 25.6, -10.1],
        armL: [-92.5, 34.5, -26.6], foreL: [-82.5, -8, -5.1], clavR: [30.9, -2.2, -24.1],
        armR: [-19.8, 29.5, 10.2], foreR: [-39.9, 30.1, 6.9], thighL: [-79, 8, 18],
        shinL: [88, 0, 0], footL: [-14, 0, 0], thighR: [-62.1, -39.6, -27.7],
        shinR: [84.8, -13.4, 13.5], footR: [-14, 0, 0],
      },
    },
    hold: HALF_GUARD_HOLD,
    grips: HALF_GUARD_GRIPS,
  }),

  MOUNT_WORK: P('MOUNT_WORK', {
    // A подтягивает колени под подмышки и садится весом вниз —
    // не вперёд: маунт и так стоит на границе своего замысла, а тяжёлый
    // маунт это низкий таз и грудь над грудью. B ставит мост.
    name: 'Маунт — колени вверх',
    label: 'MOUNT',
    points: 4, top: 'A', ground: true, variantOf: 'MOUNT',
    A: {
      root: { p: [0.008, 0.54, 0.045], r: [0, 0, 0] },
      j: {
        hips: [21.1, 10.5, -6], spine: [4.4, 23.3, -38.1], chest: [36.9, -13.3, -20.1],
        neck: [12, 0, 0], head: [-10, 0, 0], clavL: [5.4, -17.8, -17.9],
        armL: [-90.1, 13.1, -26.7], foreL: [-75.8, 9.3, 8.4], clavR: [4.8, 13, 44.3],
        armR: [-85.9, -6.8, 36.7], foreR: [-87.9, -4.4, 2.4], thighL: [-10.7, 14.5, 87.3],
        shinL: [103, 0, 0], footL: [18, 0, 0], thighR: [-9.8, -9, -26.3],
        shinR: [103, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0.016, 0.289, 0.249], r: [-90, 180, 0] },
      j: {
        hips: [24, -17, -6], spine: [8, -0.7, -11.2], chest: [13.8, 17.3, 17.3],
        neck: [-20, 0, 0], head: [14, 0, 0], clavL: [1.7, -27, -0.5],
        armL: [-156.6, 51.5, 1.1], foreL: [-119.1, 6.2, 6.1], clavR: [15.1, 24.8, -16],
        armR: [-181.4, 1.8, 23.8], foreR: [-89.2, 2.3, -0.7], thighL: [-27.6, -17.1, -18.4],
        shinL: [42.2, 0, 0.8], footL: [-14, 0, 0], thighR: [-35.1, -8.2, -2.4],
        shinR: [42.1, -0.7, 0], footR: [-14, 0, 0],
      },
    },
    hold: MOUNT_HOLD,
    grips: MOUNT_GRIPS,
  }),

  SIDE_CONTROL_WORK: P('SIDE_CONTROL_WORK', {
    // A меняет бедро и вжимает плечо в челюсть; B ставит раму и
    // подтягивает колено, чтобы креветкой уйти.
    name: 'Сторона — смена бедра',
    label: 'SIDE CONTROL',
    points: 3, top: 'A', ground: true, variantOf: 'SIDE_CONTROL',
    A: {
      root: { p: [0.26, 0.325, 0.22], r: [8, 100, 0] },
      j: {
        hips: [-42, -12, -13.5], spine: [57.8, -30, 28.6], chest: [58, -24, 18.8],
        neck: [16.3, 4.5, -6.7], head: [-30, 0, 0], clavL: [-20.9, -27.7, -15.1],
        armL: [-79.4, 39.6, -55.6], foreL: [-115.9, 9.1, 7.6], clavR: [12.8, -29.9, -19.4],
        armR: [-38.7, -31.5, 36.4], foreR: [-125.8, 6.1, -8.1], thighL: [-48.9, 7.3, 14.3],
        shinL: [113.6, -2.2, 2.3], footL: [16, 0, 0], thighR: [0, -27.9, -16.8],
        shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.275, -0.06], r: [-90, 180, 0] },
      j: {
        hips: [16, -7.5, 6], spine: [-2, -17.2, 6], chest: [2, -3.7, 12],
        neck: [2.3, 28.6, 20.3], head: [25, 10.9, -11.1], clavL: [-25.3, -5.9, 17],
        armL: [-142.7, 22.5, -38.4], foreL: [-110.9, 9.1, 3.8], clavR: [5.4, -15.7, 10.4],
        armR: [-60.3, -31.7, 10.8], foreR: [-75.2, 5.4, -5.1], thighL: [-37, 6, 12],
        shinL: [55, 0, 0], footL: [-16, 0, 0], thighR: [-16, -6, -10],
        shinR: [34, 0, 0], footR: [-16, 0, 0],
      },
    },
    hold: SIDE_CONTROL_HOLD,
    grips: SIDE_CONTROL_GRIPS,
  }),

};

export const POSE_IDS = Object.keys(POSES);

// What each held position cycles through while it is held.
//
// Derived rather than declared: a variant says which position it is a variant
// of, and that is the only place the fact is written down. Adding one is adding
// a pose.
export const HOLD_LOOPS = (() => {
  const m = {};
  for (const p of Object.values(POSES)) {
    if (p.variantOf) (m[p.variantOf] = m[p.variantOf] || []).push(p.id);
  }
  return m;
})();

// Positions the game can actually be in — the graph's nodes, without the
// variants that only exist inside one of them.
export const POSITION_IDS = Object.keys(POSES).filter((id) => !POSES[id].variantOf);
