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
      root: { p: [0.004, 0.868, -0.246], r: [0, 6, 0] },
      j: {
        hips: [-6.2, -6, -5.2], spine: [21.5, 1.5, 0], chest: [16, 0, 6.1], neck: [-21.1, 6.1, 9.3], head: [-2.5, 0, 0],
        clavL: [21.2, 2.3, 24.5], armL: [-109.2, 49.6, 20.6], foreL: [-142.2, 12.9, 26.5],
        clavR: [5.4, 17.6, 9.7], armR: [-71.7, -22.3, 19.7], foreR: [-64, 0, 1.5],
        thighL: [-26, 12, 6], shinL: [40, 0, 0], footL: [-18, -8, 0],
        thighR: [16, -14, -6], shinR: [30, 0, 0], footR: [-46, 12, 0],
      },
    },
    B: {
      root: { p: [-0.09, 0.839, 0.317], r: [0, 186, 0] },
      j: {
        hips: [-10, -12.7, 0], spine: [11, -1.4, 6.8], chest: [5.5, 6, 6.9], neck: [9.7, 2.4, 5.5], head: [-5.4, 0, 1.6],
        clavL: [25, -0.7, 24.6], armL: [-93.9, 26.9, 7], foreL: [-113, -31.3, -35.1],
        clavR: [-0.7, 8.4, -3.2], armR: [-75.3, -22.3, 19.6], foreR: [-56.4, -2.2, 7.6],
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
      root: { p: [-0.026, 0.589, -0.31], r: [0, 0, 0] },
      j: {
        hips: [10, -23.2, 25.6], spine: [43, 12.9, 12.1], chest: [15.1, -5.9, 13], neck: [6.3, 0, 0], head: [-8, 0, 0],
        clavL: [32.4, -7.3, -25], armL: [-12.2, 13.5, 33.5], foreL: [-42.8, -12.4, -32.7],
        clavR: [-26.4, 34.5, 0.3], armR: [-76.1, -20.6, 27.6], foreR: [-47.3, 12.9, 21.9],
        thighL: [11.1, 8.3, 14], shinL: [92, 0, 0], footL: [24, 0, 0],
        thighR: [23.1, -15.7, -26.7], shinR: [92, 0, 0], footR: [24, 0, 0],
      },
    },
    B: {
      root: { p: [-0.011, 0.34, -0.04], r: [-90, 180, 0] },
      j: {
        hips: [14.8, 18, 12], spine: [13.1, 24, 26.3], chest: [4, 11.3, -23.8], neck: [-19.5, 0.8, 0], head: [16, 0, 0],
        clavL: [3.8, 1.6, -5], armL: [-89.4, 20.8, -31.2], foreL: [-59.4, 0.8, 0.8],
        clavR: [-33.5, 24.8, -15.6], armR: [-107.3, -34.7, 12.6], foreR: [-79.5, 21.3, 19],
        thighL: [-61.4, 13.1, 9.9], shinL: [139.1, -2.2, -10.7], footL: [-10, 0, 0],
        thighR: [-115.4, 13.4, 5.3], shinR: [151.9, -4.4, 15.4], footR: [-10, 0, 0],
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
        hips: [4.3, -0.7, -12.7], spine: [25.6, -15.7, -6.7], chest: [8.8, -2.2, 3.8], neck: [5, 0, 0],
        clavL: [6.8, -10.5, 30.4], armL: [-89.1, 29.1, -20.9], foreL: [-37.7, -6.7, 9.9],
        clavR: [-12.7, 36.8, -19], armR: [-78.6, -13.2, 24.8], foreR: [-47.5, 3.8, -2.2],
        thighL: [-16, 6.5, 10], shinL: [86, 0, 0], footL: [16, 0, 0],
        thighR: [-42, -8, -8], shinR: [64, 0, 0], footR: [-20, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.254, 0.096], r: [-78, 180, 0] },
      j: {
        hips: [24.8, -6, 0.8], spine: [0.8, -3.7, -11.2], chest: [2.8, 6, -2.2], neck: [-28, 0, 0], head: [18, 0, 0],
        clavL: [-8.9, -22.4, 7.6], armL: [-82.7, 28.6, -25.4], foreL: [-77.2, -5.1, -4.4],
        clavR: [-12.6, 13.5, -6], armR: [-72.9, -24.7, 32.3], foreR: [-79.5, -4.4, -4.4],
        thighL: [-110.7, 16.6, 13.5], shinL: [34.6, -5.2, -2.2], footL: [-24, 0, 0],
        thighR: [-117.5, -1.7, -11.2], shinR: [39.1, 5.3, 2.3], footR: [-20, 0, 0],
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
      root: { p: [0.191, 0.48, -0.12], r: [0, 24, 0] },
      j: {
        hips: [1, -12, 24], spine: [32, -12, 27], chest: [0.3, -15, 8.3], neck: [11, 0, -0.7], head: [-10, 0, 0],
        clavL: [-20.2, 11.2, 33.4], armL: [-114.6, 69.4, 7.4], foreL: [-47.3, 8.4, -7.3],
        clavR: [26.3, -17.2, -2.2], armR: [-39.9, 9.4, -2.4], foreR: [-67.9, 44.4, 12.9],
        thighL: [-30.7, 10, 14], shinL: [104, 0, 0], footL: [10, 0, 0],
        thighR: [-4.5, 46.4, -12.2], shinR: [98.4, 4.6, -3.7], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.115, 0.245, 0.055], r: [-72, 156, -22] },
      j: {
        hips: [19, -13.5, -3], spine: [-1.7, 24.8, 26.3], chest: [16.6, 12, -9], neck: [-14.7, 6, 0], head: [14, 0, 5.3],
        clavL: [7.7, 9.1, -16.1], armL: [-91.6, 43.6, -17.5], foreL: [-93.7, -8.7, -5.8],
        clavR: [1.8, 13, -39.8], armR: [-29.3, 40.1, 18.4], foreR: [-30.1, 35.4, 13.7],
        thighL: [-86, 8, 18], shinL: [88, 0, 0], footL: [-14, 0, 0],
        thighR: [-62.8, -38.9, -27.7], shinR: [84.8, -13.4, 13.5], footR: [-14, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.chest', by: 0.16 },
      { of: 'A.chest', near: 'B.chest', within: 0.36 },
    ],
    // The cross-collar, not the back of the head. Measured from where this pose
    // puts the top man's shoulder, the back of the head is 105% of his arm away —
    // the rig lets go of a grip it cannot make, and the hand hangs by the ear. The
    // far lapel is 51% away, and flattening a man out with a cross-collar grip is
    // what half guard top does anyway.
    grips: [
      { role: 'B', hand: 'L', point: 'sleeveR' },
      { role: 'A', hand: 'L', point: 'lapelR' },
          { role: 'A', hand: 'R', point: 'lapelL' },
      { role: 'B', hand: 'R', point: 'lapelL' },
    ],
  }),

  /* --------------------------------------------------------- top control - */

  SIDE_CONTROL: P('SIDE_CONTROL', {
    name: 'Сторона',
    label: 'SIDE CONTROL',
    points: 3, top: 'A', ground: true,
    A: {
      root: { p: [0.263, 0.281, 0.25], r: [8, 100, 0] },
      j: {
        hips: [-48, -33.7, -13.5], spine: [45.4, -10.4, 15.4], chest: [44.4, -14.3, 14.1], neck: [23.8, 6.1, 17.3], head: [-15.7, 6.8, 0.8],
        clavL: [-14.1, -33.7, -23.4], armL: [-75.9, 43.3, -51.8], foreL: [-115.9, 13.6, 13.6],
        clavR: [18.1, -23.1, -18.7], armR: [-38.7, -18, 34.9], foreR: [-134, 12.1, -7.3],
        thighL: [-52.6, 10.3, 15], shinL: [111.4, -2.9, 3.1], footL: [16, 0, 0],
        thighR: [-2, -23.4, -22.8], shinR: [78, 0, -6], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.275, -0.03], r: [-90, 180, 0] },
      j: {
        hips: [16, -7.5, 6], spine: [-2, -11.2, 6], chest: [9.5, -3.7, 12], neck: [2.3, 30.1, 10.5], head: [35.5, 20.6, 0.1],
        clavL: [-13.3, -5.9, 16.3], armL: [-133.7, 22.5, -38.4], foreL: [-110.9, 8.4, 3.8],
        clavR: [9.9, -24, -0.1], armR: [-61.6, -39.2, 10.8], foreR: [-81.9, 6.2, -5.8],
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
        hips: [-29.5, -24, 6], spine: [-10.9, -10.4, 48.8], chest: [-22.4, -2.2, 35.3], neck: [13.5, 0, -0.7], head: [-16, 0, 0],
        clavL: [5.4, 12.9, 10.3], armL: [-49.6, 17.9, -28.4], foreL: [-72.7, -0.7, -2.1],
        clavR: [-9.6, -17.9, 7.7], armR: [-52.5, -5.6, 30.3], foreR: [-37.6, 28.7, 21.2],
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
      root: { p: [0.001, 0.568, 0.085], r: [0, 0, 0] },
      j: {
        hips: [45.1, 22.5, -4.5], spine: [8.2, 24.1, -36.6], chest: [36.2, -19.3, -21.6], neck: [12, 0, 0], head: [-10, 0, 0],
        clavL: [9.9, -23, -15.7], armL: [-94.8, 13.1, -26.7], foreL: [-82.5, 4.8, 1.6],
        clavR: [17.6, 5.5, 42], armR: [-82.1, -6.8, 36.7], foreR: [-93.8, 3.1, 3.9],
        thighL: [-4.7, 14.5, 78.5], shinL: [98, 0, 0], footL: [18, 0, 0],
        thighR: [1.5, -12.8, -7], shinR: [98, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0.02, 0.275, 0.255], r: [-90, 180, 0] },
      j: {
        hips: [20, -27.5, -18], spine: [6, -0.7, -5.2], chest: [13.8, 11.3, 23.3], neck: [-8, 0, 0], head: [14, 0, 0],
        clavL: [-0.8, -41.2, 7.9], armL: [-151.3, 44.1, 11.6], foreL: [-122.1, 9.2, 7.6],
        clavR: [23.4, 29.3, -16.7], armR: [-180.6, 10.1, 24.6], foreR: [-86.9, -3.6, 0.1],
        thighL: [-27.6, -8.1, -9.4], shinL: [33.4, 0, 0], footL: [-14, 0, 0],
        thighR: [-26.9, -6.7, -2.4], shinR: [36.3, 0, 0], footR: [-14, 0, 0],
      },
    },
    hold: [
      { of: 'A.hips', above: 'B.hips', by: 0.17 },
      { of: 'A.hips', near: 'B.hips', within: 0.17 },
      { straddle: 'B.chest', with: ['A.shinL', 'A.shinR'], by: 0.13 },
    ],
    // The man underneath frames on the near hip and fights the far sleeve. Both
    // hips was the authored intent and only one of them is inside his arm: the far
    // one measures 104%, so that hand was holding nothing.
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'A', hand: 'R', point: 'lapelL' },
          { role: 'B', hand: 'L', point: 'hipR' },
      { role: 'B', hand: 'R', point: 'sleeveL' },
    ],
  }),

  BACK: P('BACK', {
    name: 'Спина',
    label: 'BACK CONTROL',
    points: 4, top: 'A', ground: true,
    A: {
      root: { p: [0.008, 0.39, -0.44], r: [-22, 8, 6] },
      j: {
        hips: [12, 3, -24.6], spine: [16, -18, 3], chest: [14, 0, 9], neck: [22, 0, 3], head: [-12, 8, 0],
        clavL: [4.5, -4.4, 14.1], armL: [-138.9, 24, -50], foreL: [-77.7, -1.3, 6.8],
        clavR: [7.5, 16.6, -8.7], armR: [-103, -30.6, 3.1], foreR: [-128.2, -54.7, -37.4],
        thighL: [-70, 12.8, 24.3], shinL: [76, 0, 0], footL: [-14, 0, 0],
        thighR: [-70.7, -19.5, -25], shinR: [76, -0.7, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.35, -0.06], r: [-16, 4, 4] },
      j: {
        hips: [-8, -21, -4.5], spine: [5.3, -4.4, -6], chest: [-8.7, -6.6, -47.9], neck: [-9, 0, 0], head: [6, 0, 0],
        clavL: [-26.1, 3.1, 22.2], armL: [-136.1, 10.2, -34.9], foreL: [-61.4, 2.3, -11.8],
        clavR: [7.5, 17.9, -39.2], armR: [-97.8, -32.3, 30.6], foreR: [-81.7, 8.4, 9.1],
        thighL: [-56, 8, 14], shinL: [86, 0, 0], footL: [-10, 0, 0],
        thighR: [-53, -8, -14], shinR: [86, 0, 0], footR: [-10, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.hips', by: 0.2 },
      { of: 'A.chest', near: 'B.chest', within: 0.34 },
      { straddle: 'B.hips', with: ['A.shinL', 'A.shinR'], by: 0.1 },
    ],
    // Both men used to hold the same wrist, and both hands landed on the same four
    // centimetres of it — so the two forearms had to come from the same direction
    // and passed straight through each other, thirteen centimetres of it. The
    // defender takes the choking arm instead: two hands on the sleeve, which is
    // what anybody does with a seatbelt on them, and the arms now stack rather
    // than cross.
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
      { role: 'B', hand: 'R', point: 'sleeveL' },
          { role: 'A', hand: 'R', point: 'wristL', self: true },
      { role: 'B', hand: 'L', point: 'sleeveL' },
    ],
  }),

  TURTLE: P('TURTLE', {
    name: 'Черепаха',
    label: 'TURTLE',
    points: 0, top: 'A', ground: true,
    A: {
      root: { p: [0.024, 0.66, -0.497], r: [10, 14, 0] },
      j: {
        hips: [-6, 18.8, 38.4], spine: [41.8, 20.3, 18], chest: [40.6, 6.6, 0.3], neck: [18.3, 0, 1.5], head: [-15.7, 2.3, 0.8],
        clavL: [30, -18.6, 24.7], armL: [-43, 16.6, -34.3], foreL: [-80.6, 4.6, 9],
        clavR: [-12.7, 19.5, -40.8], armR: [-106.2, -13.1, 49.1], foreR: [-24.2, -6.5, -25.5],
        thighL: [-40, 10, 14], shinL: [104, 0, 0], footL: [8, 0, 0],
        thighR: [-14, -12, -12], shinR: [88, 0, 0], footR: [14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.146, 0.428, 0.12], r: [64, 176, 0] },
      j: {
        hips: [10.5, 16.5, 12.9], spine: [-32.3, 19.1, 27.4], chest: [-32.8, 37.7, -25.6], neck: [-17.7, 9, 18.8], head: [22.5, -0.7, 3],
        clavL: [19.6, 23.5, -8.4], armL: [-60.2, 22.8, -22], foreL: [-116, 0, 0],
        clavR: [29, -26.8, 16.6], armR: [-13.6, 2.8, 31.8], foreR: [-107, 2.3, 3.8],
        thighL: [50.7, 51.1, 50.1], shinL: [152.6, -19.4, 11.3], footL: [12.8, 0, 0],
        thighR: [37.9, 4.7, -58.9], shinR: [151.9, 24.8, -8.2], footR: [12, 0, 0],
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
        hips: [-6, -12.7, -10.5], spine: [18, 0, 6], chest: [-7.9, -10.5, 3.8], neck: [18, 0, 0], head: [-14, 10, 0],
        clavL: [6.8, 0.8, 23], armL: [-159.9, 39.8, -36.1], foreL: [-131.7, 1.5, 1.5],
        clavR: [5.3, -13.3, -30.6], armR: [-122.6, -27.2, 57.1], foreR: [-130.1, 2.3, -0.7],
        thighL: [-74, 15.8, 24.8], shinL: [72, 0, 0], footL: [-14, 0, 0],
        thighR: [-75.5, -16.5, -24], shinR: [75.8, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.026, 0.41, -0.06], r: [-10, 4, 4] },
      j: {
        hips: [-6, -2.2, -12.7], spine: [-10, -5.2, 0], chest: [-2.2, 16.6, -14.2], neck: [-23, -17.2, -23], head: [-8.8, 28, 2.4],
        clavL: [-9.6, 13.6, 23.5], armL: [-141.7, 36.8, -43.9], foreL: [-118.7, -7.3, -0.7],
        clavR: [4.8, -1.4, -4.6], armR: [-130.3, -41.8, 35.9], foreR: [-117.2, -5.9, -1.5],
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
      root: { p: [-0.382, 0.263, 0.39], r: [-90, 90, 0] },
      j: {
        hips: [22, -12, 3.1], spine: [11.7, 19.9, 44.3], chest: [21.5, -3.7, 18.8], neck: [-16, 1.5, 0], head: [22, 0, 0],
        clavL: [-17.8, -22.2, 36.5], armL: [-105.7, 22.8, -36.2], foreL: [-81.7, -7.5, -0.7],
        clavR: [-2.2, 12.8, -18.4], armR: [-105, -22, 34], foreR: [-100.4, 3, 6.1],
        thighL: [-31.4, 0, 52.9], shinL: [14.6, 2.4, -2.2], footL: [-12, 0, 0],
        thighR: [-6, -4.4, -25.5], shinR: [48, -6.7, 0], footR: [-12, 0, 0],
      },
    },
    B: {
      root: { p: [-0.03, 0.147, 0.02], r: [-90, 180, 0] },
      j: {
        hips: [12, 7.6, 0], spine: [3.3, 9.8, 0], chest: [12, 6.8, 12.8], neck: [-14, 0, 0], head: [11.5, 1.5, 1.5],
        // The trapped arm reaches across to A's chest, which is what pulls it
        // straight; the free one is stacked under him where it can do nothing.
        clavL: [6.8, -6.7, 42.5], armL: [-85.7, 42.5, -15.7], foreL: [-43.2, 3.1, 2.3],
        clavR: [24.3, 21.2, -23.1], armR: [-51.1, -18.4, 26.4], foreR: [-60.6, 8.4, 6.1],
        thighL: [-10, 15.1, 14.5], shinL: [42.8, 0, 0], footL: [-12, 0, 0],
        thighR: [-16.9, -6, -8], shinR: [38, 0, 0], footR: [-12, 0, 0],
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
    // Three hands were authored onto the same four centimetres of one wrist,
    // and the two attacking forearms had nowhere to come from but the same
    // direction — thirteen centimetres of one inside the other. An armbar is
    // held along the arm, not at a point: one hand at the wrist, one further
    // down the forearm.
    grips: [
      { role: 'A', hand: 'L', point: 'wristL' },
      { role: 'A', hand: 'R', point: 'sleeveL' },
      // And the defender holds his own collar rather than the same wrist the
      // attacker has: three hands on one point is not a grip, it is a knot.
      { role: 'B', hand: 'R', point: 'lapelL', self: true },
    ],
  }),

  TRIANGLE: P('TRIANGLE', {
    name: 'Треугольник',
    label: 'TRIANGLE CHOKE',
    points: 0, top: 'B', ground: true, submission: 'choke', from: 'CLOSED_GUARD', invert: true,
    A: {
      root: { p: [0.053, 0.515, -0.257], r: [30, 0, 0] },
      j: {
        hips: [2, 12, -4.5], spine: [12.5, 10.5, 6], chest: [6.8, 15, 27.8], neck: [19.8, 6.8, -6.7], head: [-19.5, -2.2, 0],
        clavL: [6.6, 1.3, 44.6], armL: [-169.4, 0.8, -55], foreL: [-46.6, -11.9, -20.2],
        clavR: [-10.3, 21.8, -25.5], armR: [-92.7, -29.7, 34.5], foreR: [-57.1, 11.3, 12.8],
        thighL: [7.1, 30.6, 10.8], shinL: [96, 0, 0], footL: [20, 0, 0],
        thighR: [-11.6, -6.4, -9.2], shinR: [97.5, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0.004, 0.3, 0.115], r: [-64, 180, 0] },
      j: {
        hips: [20.8, 6, -12], spine: [-2.5, -39, -30.7], chest: [-15, 9.8, 7.7], neck: [-31.5, 0, 0], head: [20, 0, 0],
        clavL: [18.8, -6.6, 30.3], armL: [-104.6, 33.2, -29.4], foreL: [-100.3, 16.6, 11.4],
        clavR: [2.3, 15.1, -15.1], armR: [-92.7, -24, 34], foreR: [-84, 0, 0],
        thighL: [-144, 8, 5.4], shinL: [126, -11.2, 12.8], footL: [-10, 0, 0],
        thighR: [-52.4, -5.1, -21.2], shinR: [149, 0.8, 9.3], footR: [-10, 0, 0],
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
      root: { p: [0.34, 0.385, 0.275], r: [12, 116, 0] },
      j: {
        hips: [-35.5, -14.2, -12], spine: [33.3, -12.7, 7.5], chest: [30.6, -10.5, -2.2], neck: [27, 0, 0], head: [-28, 0, 0],
        clavL: [-0.7, 6.8, -44.1], armL: [-73.4, 30.3, -48.5], foreL: [-113.7, -0.7, 0],
        clavR: [-36.6, 0.9, -9], armR: [-77.9, -47.9, 36.3], foreR: [-115.7, 0, 0],
        thighL: [-56, 14, 20], shinL: [108, 0, 0], footL: [14, 0, 0],
        thighR: [-18, 8.8, -22], shinR: [101.8, 1.5, -1.5], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.157, 0.271, -0.011], r: [-90, 180, 8] },
      j: {
        hips: [10, 12, 6], spine: [-5.7, 9, 6], chest: [-1.4, 5.3, 6], neck: [-34.7, -0.7, 0.8], head: [1.5, -27.5, 6],
        clavL: [-3.2, 15, 35.8], armL: [-151.4, 59.6, -53.9], foreL: [-95.4, -5.9, -1.5],
        clavR: [-23.6, -31.3, -14.6], armR: [-58.7, -19.7, 33], foreR: [-72, 0, 0],
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
      root: { p: [0.041, 0.395, -0.374], r: [50, 0, 0] },
      j: {
        hips: [-2.7, -11.2, -6], spine: [22, -0.7, -6], chest: [11.8, -8.2, -3], neck: [-50.5, -17.9, -8.1], head: [-26.5, 3.3, -15.5],
        clavL: [-36.1, -27.6, 1.5], armL: [-113.2, 100.2, 43.8], foreL: [-72.8, 21.3, 49.6],
        clavR: [39.2, 22.5, 14.5], armR: [-43.6, -45, -17.2], foreR: [-16.5, 11.5, -29.8],
        thighL: [0.5, 13.3, 15.9], shinL: [97.3, 0, 0], footL: [20, 0, 0],
        thighR: [-1.7, -8, -10.5], shinR: [98, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.353, 0.171], r: [-56, 180, 0] },
      j: {
        hips: [21.3, 23.3, 18.1], spine: [-0.7, -20.9, -11.9], chest: [-10.2, -13.5, -13.5], neck: [-16, -1.5, 0], head: [16, 0, 0],
        clavL: [15.8, 13.5, 24], armL: [-129.3, 55.1, -16.6], foreL: [-123.7, 16.6, 52.6],
        clavR: [-13.4, -7.4, -33.1], armR: [-143.2, -9.5, 48.1], foreR: [-83.9, -5.9, -10.4],
        thighL: [-144.2, -3.6, -9.4], shinL: [93.7, -14.9, 13.7], footL: [-10, 0, 0],
        thighR: [-143.1, 2.5, 28.8], shinR: [89.9, 24, -27.7], footR: [-10, 0, 0],
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


  /* ---------------------------------------------- and one that is neither - */
  //
  // A waypoint: not a position the fight can be in, and not a variant of one.
  //
  // Seven of the nine transitions still on the work list fail in exactly the
  // same place — the top man's right thigh through the bottom man's legs, on
  // the way across the body into side control or mount. Routing them through
  // an existing position was the cheap answer and it took them from 28 cm to
  // 20; none of the fifteen is the shape that is actually missing, which is
  // the middle of a hip switch: weight forward on the shoulder, hips high, the
  // driving leg swung wide of the other man rather than over him.
  //
  // So it is authored, once, and `via-pick` may route through it. It is marked
  // `waypoint` so the graph does not think the fight can be in it: no edges
  // lead here, and `sim-check` would rightly complain about a position that
  // cannot be reached.
  ACROSS: P('ACROSS', {
    name: 'Через корпус',
    label: 'SIDE CONTROL',
    points: 0, top: 'A', ground: true, waypoint: true,
    A: {
      root: { p: [0.22, 0.523, 0.2], r: [16, 62, 0] },
      j: {
        hips: [-41.2, -3.7, 8.8], spine: [44.3, -8.3, 9.2], chest: [39.7, -27.5, 8.1],
        neck: [22, 6, -6], head: [-24, 0, 0], clavL: [-23.7, -30.2, -19.2],
        armL: [-75, 45.3, -44.5], foreL: [-98, 8, 6], clavR: [6.8, -33, -30.7],
        armR: [-47.5, -38.5, 31.3], foreR: [-111.2, 6, -8], thighL: [-64, 14, 18],
        shinL: [96, 0, 0], footL: [14, 0, 0], thighR: [-16, -51.5, -10.7],
        shinR: [77.3, 6, -6.7], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.13, 0.27, 0.01], r: [-90, 180, 0] },
      j: {
        hips: [22, -2, 6], spine: [-2, 0, 7.5], chest: [2.8, -8.5, 18],
        neck: [1.3, 37.5, 13.8], head: [30.8, 14.3, -8.2], clavL: [-24.2, -5.2, 17],
        armL: [-137.7, 23.5, -38], foreL: [-111, 9, 4], clavR: [5.8, -24, 15.3],
        armR: [-51, -32, 11], foreR: [-76, 6, -6], thighL: [-28, 6, 12],
        shinL: [46, 0, 0], footL: [-16, 0, 0], thighR: [-16, -6, -10],
        shinR: [34, 0, 0], footR: [-16, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.chest', by: 0.2 },
      { of: 'A.chest', near: 'B.chest', within: 0.34 },
    ],
    grips: [
      { role: 'A', hand: 'L', point: 'headBack' },
      { role: 'A', hand: 'R', point: 'lapelL' },
    ],
  }),

  // The other two halves of the same problem.
  //
  // ACROSS is the middle of a hip switch and it won exactly one route, which
  // said what was wrong with it rather than with the idea: the seven that were
  // left are not all one movement. Coming to mount and coming to side control
  // are different shapes, and neither is a hip switch.
  //
  // MOUNT_ENTRY is the middle of a knee slide: hips high and turned, the far
  // leg already posted wide on the other side, and the driving knee travelling
  // over the belt line rather than through the legs it is leaving.
  //
  // SIDE_ENTRY is a sprawl: hips back and low, both legs long and wide behind
  // the man on top, chest coming down across. Every transition that ends in
  // side control fails in the same place — the right thigh through the legs —
  // and a sprawl is the shape in which that thigh is nowhere near them.
  MOUNT_ENTRY: P('MOUNT_ENTRY', {
    name: 'Заход в маунт',
    label: 'MOUNT',
    points: 0, top: 'A', ground: true, waypoint: true,
    A: {
      root: { p: [0.07, 0.6, 0.05], r: [6, 46, 0] },
      j: {
        hips: [19, 8, 6], spine: [42.8, -2, -14], chest: [40.8, -8.7, -4],
        neck: [14.8, 0, 0], head: [-14, 0, 0], clavL: [1.3, -24.4, -28.2],
        armL: [-79.2, 11, -35.5], foreL: [-96, 7.5, 4], clavR: [4, 10, 27.5],
        armR: [-105.7, 11.8, 53.8], foreR: [-100.2, 17.8, 25.8], thighL: [-22, 12, 62],
        shinL: [96, 0, 0], footL: [14, 0, 0], thighR: [-86.2, 10.1, -13.2],
        shinR: [54, 6, -3.7], footR: [10, 0, 0],
      },
    },
    B: {
      root: { p: [0.05, 0.305, 0.234], r: [-90, 180, 0] },
      j: {
        hips: [24.5, -8, -17.2], spine: [12, -5.9, -7.4], chest: [18.3, 26.3, 15.1],
        neck: [-20, 0, 0], head: [14, 0, -0.7], clavL: [-6.8, -41.2, 7.9],
        armL: [-151.3, 44.1, 11.6], foreL: [-122.1, 9.2, 7.6], clavR: [17.4, 23.3, -16.7],
        armR: [-186.6, 4.1, 24.6], foreR: [-92.9, 2.4, 0.1], thighL: [-17.1, -12.6, -10.1],
        shinL: [33.4, 0, 0], footL: [-14, 0, 0], thighR: [-29.1, -5.9, -1.6],
        shinR: [34.1, 0, 0], footR: [-14, 0, 0],
      },
    },
    hold: [
      { of: 'A.hips', above: 'B.hips', by: 0.26 },
      { of: 'A.hips', near: 'B.hips', within: 0.3 },
    ],
    grips: [
      { role: 'A', hand: 'L', point: 'lapelR' },
    ],
  }),

  SIDE_ENTRY: P('SIDE_ENTRY', {
    name: 'Заход в сторону',
    label: 'SIDE CONTROL',
    points: 0, top: 'A', ground: true, waypoint: true,
    A: {
      root: { p: [0.27, 0.42, 0.26], r: [10, 104, 0] },
      j: {
        hips: [-30, -44, 0], spine: [45.2, -16.8, 9.4], chest: [44.8, -17.9, 8.9],
        neck: [16, 8, -6], head: [-26, 0, 0], clavL: [-14, -36, -16.2],
        armL: [-81.2, 42, -50], foreL: [-119.7, 5.8, 3.8], clavR: [18, -34, -6],
        armR: [-44, -30, 37.8], foreR: [-124.5, 7.5, -8], thighL: [-24, 8, 40],
        shinL: [30, 0, 0], footL: [10, 0, 0], thighR: [-6, -14, -34],
        shinR: [26, 0, 0], footR: [10, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.275, -0.03], r: [-90, 180, 0] },
      j: {
        hips: [16, -7.5, 6], spine: [-2, -5.2, 6], chest: [8, -6.7, 12],
        neck: [-3.7, 42.1, 10.5], head: [23.5, 25.1, -11.1], clavL: [-25.3, -3.6, 17],
        armL: [-141.2, 26.3, -38.4], foreL: [-110.1, 7.6, 3.8], clavR: [4.6, -21, 4.4],
        armR: [-51.1, -31.7, 10.8], foreR: [-75.9, 6.2, -5.8], thighL: [-28, 6, 12],
        shinL: [46, 0, 0], footL: [-16, 0, 0], thighR: [-16, -6, -10],
        shinR: [34, 0, 0], footR: [-16, 0, 0],
      },
    },
    hold: [
      { of: 'A.chest', above: 'B.chest', by: 0.22 },
      { of: 'A.chest', near: 'B.chest', within: 0.36 },
    ],
    grips: [
      { role: 'A', hand: 'L', point: 'headBack' },
      { role: 'A', hand: 'R', point: 'lapelL' },
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
    variantOf: 'BACK',
    A: {
      root: { p: [0.023, 0.384, -0.445], r: [-22, 8, 6] },
      j: {
        hips: [3, -6.7, -32.1], spine: [24, -16.5, -3], chest: [22, -5, 18],
        neck: [26, 0, 1.5], head: [-12, 11, 0], clavL: [-2.2, 2.4, 21.6],
        armL: [-128.4, 32.3, -50], foreL: [-86.9, -2.8, -9.7], clavR: [21.8, 21, -27.5],
        armR: [-97.7, -31.3, 3.2], foreR: [-129.6, -65.2, -46.4], thighL: [-77, 16.6, 27.3],
        shinL: [81, 0, 0], footL: [-14, 0, 0], thighR: [-77, -15, -25],
        shinR: [81, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.354, -0.05], r: [-16, 4, 4] },
      j: {
        hips: [-8, -19.5, -4.5], spine: [2.8, -10.5, -6], chest: [-5.7, -4.5, -49.5],
        neck: [-2.7, -6.7, -2.2], head: [13, -8, 0], clavL: [-21.6, 10.6, 19.9],
        armL: [-139.4, 10.2, -33.4], foreL: [-50.9, 2.3, -12.6], clavR: [6.6, 18.1, -36.5],
        armR: [-91.8, -37.5, 31.4], foreR: [-80.2, 6.2, 7.7], thighL: [-56, 8, 14],
        shinL: [86, 0, 0], footL: [-10, 0, 0], thighR: [-56, -8, -14],
        shinR: [86, 0, 0], footR: [-10, 0, 0],
      },
    },
  }),

  RNC_WORK: P('RNC_WORK', {
    // Сжатие: A подтягивает предплечья и уводит голову вниз, у B
    // выгибается спина и руки тянут захват от горла.
    name: 'Удушение — сжатие',
    variantOf: 'RNC',
    A: {
      root: { p: [0.004, 0.423, -0.409], r: [-26, 8, 8] },
      j: {
        hips: [-6, -12.7, -10.5], spine: [18, 0, 7.6], chest: [-13.9, -10.5, -0.7],
        neck: [25, 0, 0], head: [-21, 10, 0], clavL: [8.3, -0.7, 22.3],
        armL: [-164.4, 39.8, -35.3], foreL: [-134.7, 1.5, 1.5], clavR: [5.3, -12.5, -31.3],
        armR: [-122.6, -27.2, 57.1], foreR: [-135.3, 3.1, -0.7], thighL: [-74, 15.8, 24.8],
        shinL: [72, 0, 0], footL: [-14, 0, 0], thighR: [-75.5, -16.5, -25.5],
        shinR: [75.8, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.026, 0.415, -0.066], r: [-10, 4, 4] },
      j: {
        hips: [-2, -2.2, -12.7], spine: [-17, -5.9, -0.7], chest: [3.3, 16.6, -12.7],
        neck: [-28.2, -18.7, -23], head: [-8, 27.2, 1.6], clavL: [-11.1, 15.8, 22.8],
        armL: [-141.7, 37.6, -43.1], foreL: [-124.7, -6.6, -0.7], clavR: [4.8, -2.8, -3.8],
        armR: [-130.3, -41.8, 34.4], foreR: [-123.2, -6.6, -1.5], thighL: [-52, 8, 14],
        shinL: [92, 0, 0], footL: [-10, 0, 0], thighR: [-52, -8, -14],
        shinR: [92, 0, 0], footR: [-10, 0, 0],
      },
    },
  }),

  HALF_GUARD_WORK: P('HALF_GUARD_WORK', {
    // A продавливает колено наружу и наваливается плечом; B ставит
    // раму и уходит на бок, поднимая щит коленом.
    name: 'Полугард — проход',
    variantOf: 'HALF_GUARD',
    A: {
      root: { p: [0.202, 0.455, -0.13], r: [0, 24, 0] },
      j: {
        hips: [13.9, -6, 30], spine: [20, -12, 21], chest: [-3.5, -18.7, 2.3],
        neck: [12.5, 0, 2.3], head: [-10, 0, 0], clavL: [-18.4, 0.9, 39.8],
        armL: [-111.6, 57.4, 2.9], foreL: [-57.7, 3.2, -5.7], clavR: [31.5, -21.7, -5.9],
        armR: [-35.4, 6.3, 8.1], foreR: [-67.2, 50.5, 10.7], thighL: [-30.7, 10, 14],
        shinL: [104, 0, 0], footL: [10, 0, 0], thighR: [-15.5, 44.4, -20.5],
        shinR: [103.6, 4.6, -3.7], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.084, 0.28, 0.05], r: [-72, 156, -22] },
      j: {
        hips: [13, -10.5, 5.3], spine: [-1.7, 18.8, 29.3], chest: [16.6, 11.6, -7.5],
        neck: [-26, 0, 0], head: [14, 3, 7.5], clavL: [10.8, 18.1, -15.3],
        armL: [-91.7, 45.1, -18.3], foreL: [-90.7, -7.1, -4.3], clavR: [3.7, 12.4, -40.1],
        armR: [-31, 34, 9.5], foreR: [-24.1, 43.6, 17.5], thighL: [-79, 8, 18],
        shinL: [88, 0, 0], footL: [-14, 0, 0], thighR: [-65, -42.6, -29.2],
        shinR: [84.1, -14.1, 14.3], footR: [-14, 0, 0],
      },
    },
  }),

  MOUNT_WORK: P('MOUNT_WORK', {
    // A подтягивает колени под подмышки и садится весом вниз —
    // не вперёд: маунт и так стоит на границе своего замысла, а тяжёлый
    // маунт это низкий таз и грудь над грудью. B ставит мост.
    name: 'Маунт — колени вверх',
    variantOf: 'MOUNT',
    A: {
      root: { p: [0.042, 0.548, 0.075], r: [0, 0, 0] },
      j: {
        hips: [62.4, 10.5, -12], spine: [-15.7, 35.7, -32.4], chest: [44, -18.4, -7.8],
        neck: [12, 0, 0], head: [-10, 0, 0], clavL: [7, -20, -24.6],
        armL: [-80.3, 4.1, -31.9], foreL: [-80.3, 7.9, 7.1], clavR: [23.7, 8.3, 38.1],
        armR: [-82, -9, 31.5], foreR: [-99, 0.2, 5.5], thighL: [-9.9, 16.8, 85.8],
        shinL: [103, 0, 0], footL: [18, 0, 0], thighR: [-9.7, -4.4, -0.8],
        shinR: [103, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0.042, 0.271, 0.234], r: [-90, 180, 0] },
      j: {
        hips: [18, -23, -6], spine: [-4, -0.7, -11.9], chest: [19.8, 11.3, 23.3],
        neck: [-20, 0, 0], head: [14, 0, 0], clavL: [-8, -36.7, 16.8],
        armL: [-158, 58.4, 1.1], foreL: [-113.1, 9.2, 6.1], clavR: [9.1, 16.6, -18.9],
        armR: [-212.8, 11, 20.8], foreR: [-90.5, 13.6, 5.3], thighL: [-27.6, -17.1, -18.4],
        shinL: [42.2, 0, 0.8], footL: [-14, 0, 0], thighR: [-35.1, -8.2, -2.4],
        shinR: [42.1, -0.7, 0], footR: [-14, 0, 0],
      },
    },
  }),

  SIDE_CONTROL_WORK: P('SIDE_CONTROL_WORK', {
    // A меняет бедро и вжимает плечо в челюсть; B ставит раму и
    // подтягивает колено, чтобы креветкой уйти.
    name: 'Сторона — смена бедра',
    variantOf: 'SIDE_CONTROL',
    A: {
      root: { p: [0.26, 0.31, 0.228], r: [8, 100, 0] },
      j: {
        hips: [-48, -18, -18], spine: [36.5, -24.9, 18.1], chest: [40.3, -22.7, 13.1],
        neck: [16.3, -7.5, -0.7], head: [-36, 0, 0], clavL: [-20.9, -28.4, -21.1],
        armL: [-90.6, 45.6, -49.6], foreL: [-115.9, 15.1, 13.6], clavR: [24.8, -17.9, -13.4],
        armR: [-44.7, -16.5, 36.4], foreR: [-141.5, 6.1, -8.1], thighL: [-45.1, 4.3, 14.3],
        shinL: [113.6, -2.2, 2.3], footL: [16, 0, 0], thighR: [0, -21.9, -16.8],
        shinR: [90, 0, 1.5], footR: [20, 0, 3],
      },
    },
    B: {
      root: { p: [-0.12, 0.275, -0.06], r: [-90, 180, 0] },
      j: {
        hips: [16, 4.5, 6], spine: [-2, -23.2, 6], chest: [2, -3.7, 12],
        neck: [8.3, 40.6, 20.3], head: [37, 19.9, -5.1], clavL: [-23.8, -5.9, 2],
        armL: [-133.7, 22.5, -38.4], foreL: [-110.9, 9.1, 3.8], clavR: [5.4, -21.7, 10.4],
        armR: [-60.3, -31.7, 10.8], foreR: [-75.2, 5.4, -5.1], thighL: [-37, 6, 12],
        shinL: [55, 0, 0], footL: [-16, 0, 0], thighR: [-16, -6, -10],
        shinR: [34, 0, 0], footR: [-16, 0, 0],
      },
    },
  }),

  STANDING_WORK: P('STANDING_WORK', {
    // Оба меняют уровень и тянутся за захватом: передняя рука вперёд,
    // колени глубже, B заходит по кругу.
    name: 'Стойка — борьба за захват',
    variantOf: 'STANDING',
    A: {
      root: { p: [0, 0.84, -0.57], r: [0, -5, 0] },
      j: {
        hips: [-3.5, 0, 0], spine: [13, 0, 0], chest: [7, 0, 0],
        neck: [-2, 0, 0], clavL: [6, 0, 12], armL: [-72, 18, -10],
        foreL: [-66, 0, 0], handL: [-18, 0, 0], clavR: [0, 0, -8],
        armR: [-64, -14, 20], foreR: [-92, 0, 0], handR: [-12, 0, 0],
        thighL: [-24, 10, 5], shinL: [36, 0, 0], footL: [-12, -8, 0],
        thighR: [2, -12, -5], shinR: [28, 0, 0], footR: [-30, 10, 0],
      },
    },
    B: {
      root: { p: [0.1, 0.855, 0.61], r: [0, 186, 0] },
      j: {
        hips: [-3, 8, 0], spine: [12, -6, 0], chest: [6, 6, 0],
        neck: [-2, 0, 0], clavL: [0, 0, 8], armL: [-62, 14, -13],
        foreL: [-92, 0, 0], handL: [-12, 0, 0], clavR: [6, 0, -12],
        armR: [-74, -16, 10], foreR: [-68, 0, 0], handR: [-18, 0, 0],
        thighL: [-22, 10, 5], shinL: [34, 0, 0], footL: [-12, -8, 0],
        thighR: [3, -12, -5], shinR: [26, 0, 0], footR: [-30, 10, 0],
      },
    },
  }),

  CLINCH_WORK: P('CLINCH_WORK', {
    // Пуммелинг: A вкручивает правую руку под плечо, B отвечает своей.
    // Головы меняются местами, ноги подшагивают.
    name: 'Клинч — перехват подхвата',
    variantOf: 'CLINCH',
    A: {
      root: { p: [-0.007, 0.838, -0.234], r: [0, 6, 0] },
      j: {
        hips: [-11.5, -10, -5.2], spine: [19.5, 3.5, 0], chest: [15.3, 0, 10.6],
        neck: [-28.1, 8.4, 11.6], head: [2, 0, 0], clavL: [22.7, -3.7, 23.8],
        armL: [-97.2, 43.6, 14.6], foreL: [-127.7, 15.2, 25.8], clavR: [21.4, 28.9, 18],
        armR: [-93.7, -33, 27.7], foreR: [-88, 0, 9.5], thighL: [-34, 12, 6],
        shinL: [48, 0, 0], footL: [-18, -8, 0], thighR: [16, -14, -6],
        shinR: [30, 0, 0], footR: [-46, 12, 0],
      },
    },
    B: {
      root: { p: [-0.118, 0.821, 0.281], r: [0, 186, 0] },
      j: {
        hips: [-10, -14.7, 6], spine: [15, -1.4, 0.8], chest: [4.3, 3, 6.1],
        neck: [10, -0.6, 4.8], head: [-11.4, 0, 1.6], clavL: [33.3, -0.7, 24.9],
        armL: [-83.1, 35.4, 7], foreL: [-95.2, -31.3, -33.6], clavR: [7.3, 3.2, 2.8],
        armR: [-93.3, -14.3, 25.6], foreR: [-76.4, -2.2, 1.6], thighL: [-26, 12, 6],
        shinL: [40, 0, 0], footL: [-18, -8, 0], thighR: [8, -14, -6],
        shinR: [38, 0, 0], footR: [-46, 12, 0],
      },
    },
  }),

  CLOSED_GUARD_WORK: P('CLOSED_GUARD_WORK', {
    // A выпрямляется и вжимает бёдра вниз, B уходит на бок и подбирает
    // угол, перекрещивая ноги выше.
    name: 'Закрытый гард — осанка против угла',
    variantOf: 'CLOSED_GUARD',
    A: {
      root: { p: [-0.06, 0.604, -0.357], r: [0, 0, 0] },
      j: {
        hips: [24, -24.7, 32.4], spine: [37.3, 12.9, 15.1], chest: [13.1, -7.4, 19.7],
        neck: [1, 0, 0], head: [-2.7, 0, 0], clavL: [30.9, -5.8, -25.8],
        armL: [-26.2, 12.7, 33.5], foreL: [-57.6, -13.2, -28.2], clavR: [-19.1, 38.1, 8.6],
        armR: [-86.9, -19.1, 35.2], foreR: [-34, 6.9, 21.9], thighL: [16.3, 8.3, 14],
        shinL: [92, 0, 0], footL: [24, 0, 0], thighR: [29.1, -15.7, -26.7],
        shinR: [92, 0, 0], footR: [24, 0, 0],
      },
    },
    B: {
      root: { p: [-0.001, 0.373, -0.04], r: [-84, 168, 0] },
      j: {
        hips: [18.3, 30, 12], spine: [10.1, 27.3, 15.1], chest: [6.5, 13.4, -26.7],
        neck: [-17.2, -0.7, 0], head: [10, 0.8, 0], clavL: [2.3, -1.5, -6.5],
        armL: [-99.8, 29.6, -30.4], foreL: [-75.4, 1.6, 1.6], clavR: [-35, 24.8, -20.1],
        armR: [-118, -34.7, 8.9], foreR: [-79, 19.1, 15.3], thighL: [-63.8, 16.1, 5.4],
        shinL: [149.1, -2.9, -10.7], footL: [-10, 0, 0], thighR: [-120.6, 23.9, 5.3],
        shinR: [144, -0.6, 11.7], footR: [-10, 0, 0],
      },
    },
  }),

  OPEN_GUARD_WORK: P('OPEN_GUARD_WORK', {
    // B выпрямляет ноги и отталкивает A от себя, дотягивая рукава;
    // A садится ниже и сбивает колени вниз.
    name: 'Открытый гард — толчок стопами',
    variantOf: 'OPEN_GUARD',
    A: {
      root: { p: [-0.083, 0.6, -0.538], r: [0, 0, 0] },
      j: {
        hips: [4.3, 6.1, -18.7], spine: [29.6, -8.2, -0.7], chest: [22, 1.5, 3.8],
        neck: [20, 0, 0], clavL: [-5.2, -10.5, 24.4], armL: [-91.1, 35.1, -20.9],
        foreL: [-28.7, -6.7, 6.2], clavR: [-12.7, 35.3, -20.5], armR: [-85.8, -21.4, 25.6],
        foreR: [-38.5, -6, -2.9], thighL: [-26, 6.5, 10], shinL: [98, 1.5, 0],
        footL: [16, 0, 0], thighR: [-44, -8.7, -9.5], shinR: [74.8, 0, -3],
        footR: [-20, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.294, 0.066], r: [-78, 180, 0] },
      j: {
        hips: [32.8, -6, 0.8], spine: [6.8, -3.7, -17.2], chest: [6.8, 6, 3.8],
        neck: [-20, 0, 0], head: [12, 0, 0], clavL: [-1.4, -20.9, 3.1],
        armL: [-93.7, 27.1, -25.4], foreL: [-94.7, -5.1, -4.4], clavR: [-5.1, 19.5, -4.5],
        armR: [-84.9, -30.7, 32.3], foreR: [-92, -4.4, -4.4], thighL: [-95.7, 18.1, 14.3],
        shinL: [19.6, 0.1, 0.1], footL: [-24, 0, 0], thighR: [-101.5, -7.7, -11.2],
        shinR: [24.9, 3.8, 2.3], footR: [-20, 0, -3],
      },
    },
  }),

  KNEE_ON_BELLY_WORK: P('KNEE_ON_BELLY_WORK', {
    // A переносит колено дальше поперёк и шире ставит опорную ногу;
    // B ставит раму в колено и подбирает своё, чтобы креветкой уйти.
    name: 'Колено на животе — вес вниз',
    variantOf: 'KNEE_ON_BELLY',
    A: {
      root: { p: [0.065, 0.606, 0.075], r: [-6, 100, 0] },
      j: {
        hips: [-30.7, -20.2, 4], spine: [-4.3, -15.3, 47.2], chest: [-17.2, -2.2, 36.8],
        neck: [18.3, -0.7, -0.7], head: [-16, 0, 0], clavL: [6.1, 12.9, 10.3],
        armL: [-59.6, 17.9, -28.4], foreL: [-84.7, -0.7, -2.1], clavR: [-7.4, -17.9, 5.5],
        armR: [-58.2, -1.8, 37.1], foreR: [-50.8, 30.2, 22.7], thighL: [-108, 16, 22],
        shinL: [48, 0, 0], footL: [8, 0, 0], thighR: [-26, -21.5, -54.2],
        shinR: [28.4, -0.7, -18], footR: [-30, 0, 0],
      },
    },
    B: {
      root: { p: [-0.165, 0.253, 0.053], r: [-90, 180, 0] },
      j: {
        hips: [11.3, 56.3, -5.2], spine: [-15.5, -8.6, 15], chest: [5.3, 28.3, 20.3],
        neck: [-22, 0, 0], head: [20, -24, 0], clavL: [1.5, 22.5, 30.4],
        armL: [-99.4, 46.1, -24.6], foreL: [-95.7, -4.5, -2.9], clavR: [-20.8, -11.8, -32.8],
        armR: [-61.4, -23.1, 26.9], foreR: [-90, 0, 0], thighL: [-50, 6, 12],
        shinL: [68, 0, 0], footL: [-16, 0, 0], thighR: [-20, -6, -10],
        shinR: [40, 0, 0], footR: [-16, 0, 0],
      },
    },
  }),

  TURTLE_WORK: P('TURTLE_WORK', {
    // A обходит к ближнему боку и заводит крюк коленом; B шагает вперёд
    // и подбирает локти к коленям, закрываясь плотнее.
    name: 'Черепаха — крюк против движения вперёд',
    variantOf: 'TURTLE',
    A: {
      root: { p: [0.045, 0.701, -0.508], r: [10, 26, 0] },
      j: {
        hips: [8.3, 34.1, 25], spine: [47.1, 14.8, 12.8], chest: [42.8, -5.3, -1.5],
        neck: [15.3, 0.8, 1.5], head: [-15.7, 2.3, 0.8], clavL: [29.2, -20.3, 23.5],
        armL: [-45.5, 29.4, -38], foreL: [-79.1, 28.6, 29.3], clavR: [-11.2, 33.8, -31],
        armR: [-106.7, -11.6, 66.9], foreR: [-48.7, -22.2, -15.7], thighL: [-30, 10, 14],
        shinL: [96, 0, 0], footL: [8, 0, 0], thighR: [-38, -22, -22],
        shinR: [96, 0, 0], footR: [14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.044, 0.383, 0.07], r: [64, 176, 0] },
      j: {
        hips: [10.5, 15, 17.4], spine: [-34.8, 11.2, 30.3], chest: [-39.4, 31.4, -25],
        neck: [-33.2, 0, 0.8], head: [30.5, -0.7, 3], clavL: [0.9, 40.8, 20.1],
        armL: [-85.4, 26.6, -15.2], foreL: [-126, 0, 0], clavR: [35.3, -23.6, 10.4],
        armR: [-23.6, 2.8, 31.8], foreR: [-117, 2.3, 3.8], thighL: [47.5, 48.9, 44.9],
        shinL: [154.1, -2.8, 22.8], footL: [25.6, 0.8, 0.8], thighR: [21.9, 4.7, -52.9],
        shinR: [153.9, 24.8, -2.2], footR: [12, 0, 0],
      },
    },
  }),

  ARMBAR_WORK: P('ARMBAR_WORK', {
    // A сводит колени и поднимает таз; B доворачивает большой палец вверх
    // и тянется свободной рукой на замок — рука при этом остаётся прямой.
    name: 'Рычаг локтя — сведение колен',
    variantOf: 'ARMBAR',
    A: {
      root: { p: [-0.408, 0.271, 0.36], r: [-90, 90, 0] },
      j: {
        hips: [20.8, -6, 8.3], spine: [1.5, 27.1, 41.2], chest: [14, -8.9, 21.1],
        neck: [-10, 0, 0], head: [23.5, -1.5, 0], clavL: [-20.9, -26.1, 35.1],
        armL: [-116.2, 15.3, -38.4], foreL: [-94.2, -6, -0.7], clavR: [-5.2, 5.3, -18.4],
        armR: [-111.2, -16, 40], foreR: [-110.1, -3, 3.1], thighL: [-43.2, 1.5, 51.1],
        shinL: [27.6, 1.6, -0.7], footL: [-12, 0, 0], thighR: [-14, -5.2, -22.2],
        shinR: [35.5, -6, 0], footR: [-12, 0, 0],
      },
    },
    B: {
      root: { p: [-0.056, 0.151, -0.04], r: [-90, 180, 0] },
      j: {
        hips: [22.3, 3.1, 6], spine: [4.1, 17.8, 0], chest: [13.3, 7.3, 6.1],
        neck: [-5, 0, 0], head: [4, 0, 0], clavL: [19.3, 7.5, 41.4],
        armL: [-84, 49.8, -12], foreL: [-48.4, 0.1, 15.5], clavR: [24.3, 18.9, -23.9],
        armR: [-60.4, -20.7, 25.7], foreR: [-73.3, 7.7, 4.6], thighL: [-18, 18.1, 13.8],
        shinL: [57.5, 0, 0], footL: [-12, 0, 0], thighR: [-16.2, -6, -8],
        shinR: [38, 0, 0], footR: [-12, 0, 0],
      },
    },
  }),

  TRIANGLE_WORK: P('TRIANGLE_WORK', {
    // B уходит на угол, подрезает голеностоп и тянет голову вниз;
    // A выпрямляется и уводит плечо от петли.
    name: 'Треугольник — угол и подтяг головы',
    variantOf: 'TRIANGLE',
    A: {
      root: { p: [-0.007, 0.52, -0.304], r: [30, 0, 0] },
      j: {
        hips: [-10, 12, -10.5], spine: [12.5, 16.5, 18], chest: [6.8, 21, 15.8],
        neck: [11.8, 0.8, -4.5], head: [-11.5, -0.7, 0], clavL: [7.8, 0.6, 41.3],
        armL: [-170, -1.4, -70.2], foreL: [-46.6, 0.1, -10.4], clavR: [-6.5, 34.6, -24.7],
        armR: [-83.4, -25.9, 36], foreR: [-47.3, 15.8, 15.1], thighL: [8.6, 31.4, 10.1],
        shinL: [96, 0, 0], footL: [20, 0, 0], thighR: [-4.1, -14.6, -18.9],
        shinR: [96, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0.064, 0.35, 0.115], r: [-58, 190, 0] },
      j: {
        hips: [28.8, 16, -10], spine: [-2.4, -34.3, -21.4], chest: [-8.5, 5.3, 2.4],
        neck: [-16, 0, 0], head: [14, 0, 0], clavL: [15.8, -6.6, 24.3],
        armL: [-117.1, 34.7, -27.1], foreL: [-112.5, 11.4, 3.9], clavR: [6.8, 13.6, -21.1],
        armR: [-110.7, -24, 28], foreR: [-104, 6, 6], thighL: [-141.8, 13.1, -0.8],
        shinL: [130, -9.7, 5.3], footL: [-10, 0, 0], thighR: [-51.9, -9.6, -21.2],
        shinR: [145.5, 0.8, 9.3], footR: [-10, 0, 0],
      },
    },
  }),

  KIMURA_WORK: P('KIMURA_WORK', {
    // A доворачивает кисть вверх по спине и наваливается; B тянет руку
    // вниз к своему поясу и вкручивается в него боком.
    name: 'Кимура — доворот кисти за спину',
    variantOf: 'KIMURA',
    A: {
      root: { p: [0.33, 0.355, 0.275], r: [12, 116, 0] },
      j: {
        hips: [-33.5, -14.2, -6.7], spine: [37.6, -11.2, 6.8], chest: [37.9, -10.5, 10.6],
        neck: [30, 0, 0], head: [-34, 0, 0], clavL: [6.3, 6.9, -42.9],
        armL: [-86.1, 36.1, -48.5], foreL: [-126.9, 0, -0.7], clavR: [-35.3, 3.2, -1.5],
        armR: [-86.4, -59.6, 31.1], foreR: [-125.2, -6, -4.5], thighL: [-66, 14, 20],
        shinL: [118, 0, 0], footL: [14, 0, 0], thighR: [-12, 8.1, -16],
        shinR: [101.8, 1.5, -1.5], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.101, 0.226, -0.011], r: [-90, 180, 8] },
      j: {
        hips: [14, 8, 6], spine: [-5.7, 9, 6], chest: [0.8, 2.8, 6],
        neck: [-26.7, -0.7, 0.8], head: [-6.5, -26, 7.5], clavL: [-5.5, 13.5, 38.9],
        armL: [-135.9, 58.4, -42.9], foreL: [-87.1, -7.4, 0], clavR: [-21.1, -33.6, -15.6],
        armR: [-68.7, -19.7, 33], foreR: [-84, 0, 0], thighL: [-42, 6, 12],
        shinL: [60, 0, 0], footL: [-16, 0, 0], thighR: [-18, -6, -10],
        shinR: [36, 0, 0], footR: [-16, 0, 0],
      },
    },
  }),

  GUILLOTINE_WORK: P('GUILLOTINE_WORK', {
    // B прогибается назад и сводит локти; A подставляет руку и уводит
    // подбородок в сторону, подшагивая ближе.
    name: 'Гильотина — прогиб и сведение локтей',
    variantOf: 'GUILLOTINE',
    A: {
      root: { p: [0.041, 0.371, -0.375], r: [50, 0, 0] },
      j: {
        hips: [-2.7, -11.2, -6], spine: [27.3, -1.5, -6], chest: [5.8, -9.7, -9],
        neck: [-48.8, -26.9, -22.4], head: [-24.5, 2.6, -7.5], clavL: [-35.6, -29.7, 10.3],
        armL: [-116.7, 93.5, 43.8], foreL: [-85.8, 19.8, 48.1], clavR: [24.3, 27.6, 24.7],
        armR: [-52.8, -51.8, -18.7], foreR: [-4, 10, -27.6], thighL: [-9.5, 17.8, 19.6],
        shinL: [117, 9, 0], footL: [20, 0, 0], thighR: [-1.7, -8, -10.5],
        shinR: [98, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.376, 0.18], r: [-48, 180, 0] },
      j: {
        hips: [19.3, 21.8, 23.3], spine: [-7, -20.2, -6.7], chest: [-25, -13.5, -13.5],
        neck: [-30.2, 0, 0], head: [22, 0, 0], clavL: [23.3, 10.5, 18],
        armL: [-150.3, 62.6, -2.6], foreL: [-132.7, 19.6, 66.6], clavR: [-10.4, -16.4, -34.6],
        armR: [-154.1, -18.5, 37.1], foreR: [-93.4, -2.9, -8.9], thighL: [-145.2, -12.6, -0.3],
        shinL: [88.4, -15.7, 14.5], footL: [-10, 0, 0], thighR: [-142.6, 3.8, 31.1],
        shinR: [80.9, 23.3, -23.2], footR: [-10, 0, 0],
      },
    },
  }),

  /* ------------------------------------------- and a second lap of it -- */
  //
  // A loop between two poses is a metronome, and a long hold reads as one.
  // Each of the five positions the fight actually lives in gets a second thing
  // to be doing, so the cycle runs position -> first -> position -> second and
  // comes back round changed.

  BACK_WORK2: P('BACK_WORK2', {
    // A ведёт руку к подбородку и подбирает крюки; B отрывает захват
    // двумя руками и сползает вниз, пряча подбородок.
    name: 'Спина — охота за рукой',
    variantOf: 'BACK',
    A: {
      root: { p: [0.008, 0.41, -0.38], r: [-22, 8, 6] },
      j: {
        hips: [6, 9, -10.6], spine: [24, -12, 6], chest: [22, -3, 15],
        neck: [22.5, 0, 0], head: [-20, 14, 0], clavL: [4.5, -4.4, -0.9],
        armL: [-156.6, 34, -50], foreL: [-104.2, -1.3, 0.8], clavR: [7.5, 18.1, -17.7],
        armR: [-93.2, -45.3, 3.1], foreR: [-108.9, -56.9, -41.9], thighL: [-62, 12.8, 24.3],
        shinL: [84, 0, 0], footL: [-14, 0, 0], thighR: [-65.7, -27.7, -31],
        shinR: [84, -2.2, 0.8], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.32, -0.026], r: [-16, 4, 4] },
      j: {
        hips: [0, -15, -4.5], spine: [-3.4, 1.4, -6], chest: [-1.3, 0.5, -50],
        neck: [2.8, 11.5, 0], head: [14, -8, 0], clavL: [-26.8, -1.4, 29],
        armL: [-127.1, 10.2, -37.1], foreL: [-50.9, -5.2, -13.3], clavR: [5.7, 18.4, -38.7],
        armR: [-86.3, -34.5, 32.1], foreR: [-71.9, 3.9, 3.9], thighL: [-64, 8, 14],
        shinL: [86, 0, 0], footL: [-10, 0, 0], thighR: [-64, -8, -14],
        shinR: [86, 0, 0], footR: [-10, 0, 0],
      },
    },
  }),

  RNC_WORK2: P('RNC_WORK2', {
    // A переставляет замок выше и заводит вторую руку глубже; B прячет
    // подбородок, вкручивается в душащую руку и упирается пятками.
    name: 'Удушение — перехват выше',
    variantOf: 'RNC',
    A: {
      root: { p: [-0.026, 0.44, -0.388], r: [-26, 8, 8] },
      j: {
        hips: [0, -6.7, -10.5], spine: [24, 0, 6], chest: [-1.4, -12, 3.1],
        neck: [26, 3, 0], head: [-22, 10, 0], clavL: [13.3, 1.6, 23],
        armL: [-158.1, 48.6, -25.6], foreL: [-120.4, 5.3, 6], clavR: [6.1, -13.3, -29.1],
        armR: [-132.6, -27.2, 63.6], foreR: [-121.6, 0.8, 0], thighL: [-66.7, 18.8, 27.1],
        shinL: [72, 0, 0], footL: [-14, 0, 0], thighR: [-67.5, -16.5, -24],
        shinR: [75.8, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.026, 0.39, -0.06], r: [-10, 4, 4] },
      j: {
        hips: [2, 8.6, -12.7], spine: [-2, 0.8, -3.7], chest: [-1.5, 8.1, -15.7],
        neck: [-16, -13.7, -22.2], head: [-13, 24.8, 3.2], clavL: [-9.6, 14.4, 24.3],
        armL: [-131.7, 36.8, -44.6], foreL: [-106.7, -7.3, -0.7], clavR: [4.8, 3.1, -3.1],
        armR: [-120.3, -41.8, 35.2], foreR: [-105.2, -5.9, -1.5], thighL: [-62, 8, 14],
        shinL: [100, 0, 0], footL: [-10, 0, 0], thighR: [-62, -8, -14],
        shinR: [100, 0, 0], footR: [-10, 0, 0],
      },
    },
  }),

  HALF_GUARD_WORK2: P('HALF_GUARD_WORK2', {
    // B поднимает щит коленом и отталкивает бедро; A выдёргивает
    // зажатую ногу назад и роняет бедро на мат.
    //
    // Работа тут в ногах, и это второй заход. Первым был написан подхват
    // против кросс-фейса — он вёл предплечья двоих навстречу друг другу
    // (правое A держит лацкан B, левое B держит рукав A: они и так лежат
    // вдоль), и на середине петли предплечья менялись сторонами: 14 см,
    // которые дуга не умела свести ниже десяти. Дефект замысла, а не дуги.
    // Здесь руки расходятся, а не сходятся: правая A опускается, левая B
    // идёт вверх.
    name: 'Полугард — щит коленом',
    variantOf: 'HALF_GUARD',
    A: {
      root: { p: [0.221, 0.443, -0.08], r: [0, 24, 0] },
      j: {
        hips: [3, -24, 24], spine: [25.3, -18, 27], chest: [4.8, -9, 13.1],
        neck: [15, 0, -0.7], head: [-16, 0, 0], clavL: [-20.2, 11.2, 33.4],
        armL: [-115.8, 66.7, 7.4], foreL: [-49.3, 8.4, -7.3], clavR: [18.8, -29.2, -11.2],
        armR: [-31.4, 2.7, -6.1], foreR: [-63.6, 41.4, 24.2], thighL: [-40.7, 10, 14.8],
        shinL: [112, 0, 0], footL: [10, 0, 0], thighR: [-10.2, 34.2, -13.7],
        shinR: [108.4, 4.6, -3.7], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.111, 0.261, 0.063], r: [-72, 156, -22] },
      j: {
        hips: [23, 2.5, 3.5], spine: [1.8, 30.8, 26.3], chest: [13.6, 4, -9.7],
        neck: [-8.7, 0, 0], head: [8, 0, 5.3], clavL: [-1.3, 10.6, -20.6],
        armL: [-102.8, 54.4, -16], foreL: [-91.7, -7.2, -4.3], clavR: [1.9, 11.3, -40.3],
        armR: [-31.3, 43.9, 19.2], foreR: [-26.3, 32.4, 12.2], thighL: [-96, 8, 18],
        shinL: [98, 0, 0], footL: [-14, 0, 0], thighR: [-52, -39.6, -30.7],
        shinR: [77.6, -11.9, 12.8], footR: [-14, 0, 0],
      },
    },
  }),

  MOUNT_WORK2: P('MOUNT_WORK2', {
    // A уводит одну ногу в обвив и садится на бедро; B ставит раму
    // и подбирает колено, отбирая полугард.
    name: 'Маунт — обвив против креветки',
    variantOf: 'MOUNT',
    A: {
      root: { p: [-0.028, 0.546, 0.108], r: [0, 0, 0] },
      j: {
        hips: [29.1, 28.5, 4.3], spine: [8.7, 31.6, -28.6], chest: [44.5, -14.1, -24.5],
        neck: [12, -1.5, 0], head: [-4, 0, 0], clavL: [4.7, -23, -32.9],
        armL: [-94.8, 13.1, -26.7], foreL: [-96, 4.8, -5.9], clavR: [10.1, 3.3, 42],
        armR: [-102.6, -6.8, 36.7], foreR: [-86.3, -3.6, 9.2], thighL: [-18.7, 22.8, 77.3],
        shinL: [110, 0, 0], footL: [18, 0, 0], thighR: [24, -22.5, -9.5],
        shinR: [86, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0.055, 0.268, 0.255], r: [-90, 180, 0] },
      j: {
        hips: [22, -22.5, -3], spine: [12.8, 13.3, -5.2], chest: [19.1, 13.8, 6.1],
        neck: [-8, 6, -1.5], head: [7.5, 0, 0], clavL: [-7.5, -42.6, 8.4],
        armL: [-141.3, 44.9, 10.9], foreL: [-108.6, 9.2, 7.6], clavR: [18.9, 19.6, -18.9],
        armR: [-172.1, 2.6, 17.1], foreR: [-88.9, -2.8, -5.9], thighL: [-31.6, -15.6, -9.4],
        shinL: [49.4, 0, 0], footL: [-14, 0, 0], thighR: [-18.9, -6.7, -2.4],
        shinR: [28.3, 0, 0], footR: [-14, 0, 0],
      },
    },
  }),

  SIDE_CONTROL_WORK2: P('SIDE_CONTROL_WORK2', {
    // A обходит ногами к голове; B встаёт на мост и вкручивается внутрь,
    // отбирая место под подхват.
    name: 'Сторона — шаг на север-юг',
    variantOf: 'SIDE_CONTROL',
    A: {
      root: { p: [0.313, 0.299, 0.166], r: [10, 128, 0] },
      j: {
        hips: [-44, -35.7, -25.5], spine: [45.2, -9.3, 17.1], chest: [46.5, -17.4, 3.9],
        neck: [26.1, -2.9, 0.8], head: [-31.5, 0, 0], clavL: [-8.9, -38.2, -19.6],
        armL: [-79.9, 41.1, -48], foreL: [-122.9, 3.9, 6.1], clavR: [30.1, -35.1, -14.1],
        armR: [-26.4, -44.2, 26.7], foreR: [-124.5, 18.8, 0.2], thighL: [-38.4, 14.8, 9],
        shinL: [111.1, -16.4, 11.3], footL: [16, 0, 0], thighR: [-20, -29.4, -16.8],
        shinR: [106, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.275, -0.03], r: [-90, 180, 0] },
      j: {
        hips: [20, -25.5, 12], spine: [0, -7.2, 6], chest: [17.5, -5.7, 12],
        neck: [11.8, 46.7, 4.6], head: [21.5, 25.9, -7.4], clavL: [-10.3, 0.1, 29],
        armL: [-123.7, 22.5, -30.9], foreL: [-80.1, 21.1, 12.8], clavR: [0.9, -22.5, 7.4],
        armR: [-64.1, -34.7, 7.8], foreR: [-65.1, 5.5, -5.8], thighL: [-42, 6, 12],
        shinL: [60, 0, 0], footL: [-16, 0, 0], thighR: [-26, -6, -10],
        shinR: [44, 0, 0], footR: [-16, 0, 0],
      },
    },
  }),

};

// A variant is its position doing something, so everything that says *which*
// position it is comes from the position itself: the label on the HUD, the
// points it is worth, who is on top, what makes it that position and where the
// hands are. A variant declares only what it is a variant of and what the two
// of them look like. Written out twice, the two copies drift — and a variant
// that has quietly become a different position is exactly the failure the
// `hold` block exists to catch.
const VARIANT_OWN = new Set(['id', 'name', 'A', 'B', 'variantOf']);
for (const p of Object.values(POSES)) {
  if (!p.variantOf) continue;
  const base = POSES[p.variantOf];
  if (!base) throw new Error(`${p.id} is a variant of ${p.variantOf}, which does not exist`);
  for (const k of Object.keys(base)) if (!VARIANT_OWN.has(k)) p[k] = base[k];
}

// Poses that also exist with their two slots exchanged.
//
// A sweep is the two of them trading places, and the pose library on its own
// cannot say that. SIDE_CONTROL has slot A on top, and so does MOUNT, so the
// blend from one to the other carries the top man to the top — whoever the
// sweep belonged to. Measured on the hips, the two never cross: slot A's pelvis
// stays above slot B's for the whole of every sweep in the game, and the only
// thing that ever changed hands was the label, in the final frame.
//
// The mirror is the same tangle stored the other way round. Blending into it
// carries each body to the other's place, which is the motion; arriving flips
// the roles, which renders identically to the last frame of the blend, so the
// exchange costs nothing at the join.
//
// Nothing is authored twice: A and B are exchanged, and so is every reference
// to a role inside `hold` and `grips`.
// Everything a fight can arrive in with the two men exchanged. That is every
// position with a top and a bottom that some transition can reach from either
// side — which, once the takedowns were included, is all of them except the
// two that have no top at all: nobody is on top in the stance or the clinch,
// so there is nothing to exchange.
const MIRRORS = [
  'SIDE_CONTROL', 'MOUNT', 'BACK', 'CLOSED_GUARD',
  // The three the takedowns need. A double leg out of the stance puts the man
  // who shot on top — and until now it did that by relabelling both of them in
  // one frame, because standing is the one place the graph cannot know in
  // advance which of the two will shoot.
  'OPEN_GUARD', 'HALF_GUARD', 'TURTLE',
];
const flipRole = (r) => (r === 'A' ? 'B' : r === 'B' ? 'A' : r);
const flipRef = (ref) =>
  (typeof ref === 'string' && /^[AB]\./.test(ref) ? flipRole(ref[0]) + ref.slice(1) : ref);
export const mirrorId = (id) => id + '_X';
for (const id of MIRRORS) {
  const p = POSES[id];
  if (!p) throw new Error(`no pose to mirror: ${id}`);
  POSES[mirrorId(id)] = {
    ...p,
    id: mirrorId(id),
    mirrorOf: id,
    A: p.B,
    B: p.A,
    top: flipRole(p.top),
    hold: (p.hold || []).map((h) => {
      const o = { ...h };
      for (const k of ['of', 'above', 'near', 'far', 'straddle']) if (o[k]) o[k] = flipRef(o[k]);
      if (o.with) o.with = o.with.map(flipRef);
      return o;
    }),
    grips: (p.grips || []).map((g) => ({ ...g, role: flipRole(g.role) })),
  };
}

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
export const POSITION_IDS = Object.keys(POSES)
  .filter((id) => !POSES[id].variantOf && !POSES[id].waypoint && !POSES[id].mirrorOf);

// Poses that exist only to be passed through: see ACROSS. They are real poses —
// solved, measured, held to the same standards — and they are not places the
// fight can be in, so nothing in the graph leads to one.
export const WAYPOINT_IDS = Object.keys(POSES).filter((id) => POSES[id].waypoint);
