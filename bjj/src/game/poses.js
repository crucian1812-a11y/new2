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
      root: { p: [0, 0.674, -0.66], r: [0, 0, 0] },
      j: { ...STANCE_SPINE, ...STANCE_ARMS, ...STANCE_LEGS },
    },
    B: {
      root: { p: [0, 0.674, 0.66], r: [0, 180, 0] },
      j: { ...STANCE_SPINE, ...STANCE_ARMS, ...STANCE_LEGS },
    },
    grips: [],
  }),

  CLINCH: P('CLINCH', {
    name: 'Клинч',
    label: 'CLINCH',
    points: 0, top: null, ground: false,
    A: {
      root: { p: [0.024, 0.653, -0.222], r: [0, 6, 0] },
      j: {
        hips: [-18.2, -6, 13.6], spine: [36.5, 1.5, -1.5], chest: [16, 0.8, 0.9], neck: [-19.3, -5.7, -3.2], head: [-2.5, 0.8, 0],
        clavL: [29.5, -8.7, 28.3], armL: [-107.5, 50.5, 18.4], foreL: [-145, 17.6, 23.7],
        clavR: [4.7, 14.1, 14.3], armR: [-73.1, -23, 18.2], foreR: [-64, 0, -3.5],
        thighL: [-31.8, 13.6, 6.1], shinL: [37.9, 0.8, 2.3], footL: [-19.4, -7.2, 0.8],
        thighR: [20.7, -14.7, -3], shinR: [30.8, 0, 1.5], footR: [-46, 13.5, 0.8],
      },
    },
    B: {
      root: { p: [-0.109, 0.594, 0.313], r: [0, 186, 0] },
      j: {
        hips: [-24.9, -9.6, 4.6], spine: [30.5, -0.6, -1.4], chest: [7, 5.3, 4], neck: [6.8, -5.8, -12.3], head: [-4.6, 0, 0.1],
        clavL: [19.2, -11.9, 21.1], armL: [-102.8, 30.8, 7], foreL: [-120.1, -32, -41.4],
        clavR: [0.8, -6.4, 5.1], armR: [-76, -25.3, 19.6], foreR: [-60.9, -2.2, 3.2],
        thighL: [-14.6, 13.6, 4.6], shinL: [44.6, 1.5, -2.2], footL: [-14.1, -8, -0.6],
        thighR: [17.5, -13.2, -4.5], shinR: [30.8, 0, 3], footR: [-42.1, 12.1, 0.8],
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
      root: { p: [-0.014, 0.48, -0.31], r: [0, 0, 0] },
      j: {
        hips: [16, -22.4, 23.4], spine: [36.3, 17.4, 13.6], chest: [15.9, -14.1, 12.3], neck: [7.9, -0.7, -2.2], head: [-11.7, -0.7, 1.5],
        clavL: [31.7, -5, -26.4], armL: [-12.2, 15, 33.6], foreL: [-39, -11.6, -40.1],
        clavR: [-25.6, 36.8, 0.4], armR: [-76.8, -25, 25.5], foreR: [-47.2, 12.2, 12.3],
        thighL: [22.4, 11.3, 14], shinL: [93.5, 0, 0], footL: [24, 0, 0],
        thighR: [26.2, -17.1, -26.7], shinR: [91.3, 0.8, 1.6], footR: [27.1, 1.6, 0.9],
      },
    },
    B: {
      root: { p: [-0.015, 0.242, -0.055], r: [-90, 180, 0] },
      j: {
        hips: [8.8, 17.3, 9.9], spine: [14.7, 24.1, 30.9], chest: [6.3, 10.6, -34.2], neck: [-20.1, 1.6, -0.7], head: [16, -2.2, -0.7],
        clavL: [2.3, 3.1, -2], armL: [-88.6, 27.6, -29.7], foreL: [-59.2, 0.8, 0.8],
        clavR: [-31.1, 25.6, -19.2], armR: [-107.3, -36.9, 8.2], foreR: [-82.5, 16.8, 19.8],
        thighL: [-52.3, 13.2, 14.5], shinL: [145.1, -2.9, -9.9], footL: [-10, 0.8, 0],
        thighR: [-114.6, 15, 5.3], shinR: [153.5, -4.3, 16.2], footR: [-10, -0.7, 0],
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
      root: { p: [-0.114, 0.63, -0.433], r: [0, 0, 0] },
      j: {
        hips: [11.8, -0.7, -11.9], spine: [15.9, -15.7, -6.7], chest: [9.6, 2.3, 2.3], neck: [6.5, 0, 0],
        clavL: [7.6, -6.7, 29], armL: [-89.1, 28.4, -20.9], foreL: [-41.4, -7.4, 8.4],
        clavR: [-17.2, 37.6, -20.4], armR: [-79.3, -14.6, 21.9], foreR: [-36.1, 4.7, -5.1],
        thighL: [-10.5, 7.3, 12.4], shinL: [100.3, -2.2, 2.3], footL: [19.8, 0, 0.8],
        thighR: [-38.2, -4.9, -7.2], shinR: [65.5, 0.8, 0], footR: [-18.5, -0.7, -0.7],
      },
    },
    B: {
      root: { p: [0.023, 0.258, 0.07], r: [-78, 180, 0] },
      j: {
        hips: [12.9, -6.7, 15.9], spine: [10.6, -3.6, -20], chest: [-0.2, 7.6, 3.1], neck: [-24.2, -0.6, 0], head: [18.1, -0.7, 0.1],
        clavL: [-14.8, -24.6, 8.4], armL: [-86.3, 28.6, -25.4], foreL: [-76.4, -4.3, -2.9],
        clavR: [-15.6, 10.6, -4.5], armR: [-75.8, -26.1, 32.3], foreR: [-74.2, -5.8, -3.6],
        thighL: [-104.6, 19, 15], shinL: [34.7, -5.8, -2.9], footL: [-20.1, -0.7, -0.7],
        thighR: [-112.8, -2.4, -8.9], shinR: [33.2, 14.4, 1.5], footR: [-18.4, 0, 0.8],
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
      root: { p: [0.199, 0.509, -0.105], r: [0, 24, 0] },
      j: {
        hips: [-2.6, -18, 34.5], spine: [20.9, -19.5, 21], chest: [-7.1, -21, 19.6], neck: [11, 0, -0.7], head: [-7, 0, 0],
        clavL: [-18.5, 14.2, 26.7], armL: [-122.1, 81.5, 10.5], foreL: [-75, -5, -4.2],
        clavR: [37.6, -22.4, 3.9], armR: [-34.6, 2.7, -12.1], foreR: [-65.5, 40.7, 18.3],
        thighL: [-32.1, 16.8, 14], shinL: [104.8, 0, 0], footL: [10, 3, 0],
        thighR: [-13.5, 54, -11.4], shinR: [87.9, 9.2, -8.1], footR: [11.3, -4.4, 0],
      },
    },
    B: {
      root: { p: [-0.108, 0.255, 0.026], r: [-72, 156, -22] },
      j: {
        hips: [2.6, -11.2, -19.5], spine: [13.4, 23.4, 36.1], chest: [25.7, 2.3, -3.7], neck: [-14.7, 7.5, 0.8], head: [13.3, 0.8, 6.1],
        clavL: [15.4, 15.2, -22.1], armL: [-84.8, 45.2, -15.9], foreL: [-109.2, -6.4, -4.3],
        clavR: [10.1, 10.1, -38.2], armR: [-15.7, 38, 5.8], foreR: [-34.5, 34, 22],
        thighL: [-79.1, 15.6, 22.6], shinL: [91, 0, 0.8], footL: [-14, 0, 0.8],
        thighR: [-71, -42.6, -28.4], shinR: [77.3, -9.6, 11.3], footR: [-14, 0.8, 0],
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
      root: { p: [0.278, 0.281, 0.28], r: [8, 100, 0] },
      j: {
        hips: [-55.4, -25.4, -19.5], spine: [43.9, -10.4, 16.2], chest: [32.4, -6.8, 13.5], neck: [25.3, 6.2, 29.4], head: [6.1, 15.9, 6.9],
        clavL: [-12.5, -29.9, -28.6], armL: [-87.7, 42, -48.6], foreL: [-121.8, 28.7, 12.2],
        clavR: [33.2, -23.8, -11.9], armR: [-32.6, -4.4, 56], foreR: [-123.5, 9.2, -11.7],
        thighL: [-54, 1.3, 2.3], shinL: [112.2, -14.9, 22.6], footL: [8.5, -9.7, -3.7],
        thighR: [-8.7, -23.3, -23.5], shinR: [86.3, 1.5, -1.5], footR: [17, 12.8, 0.8],
      },
    },
    B: {
      root: { p: [-0.154, 0.275, -0.03], r: [-90, 180, 0] },
      j: {
        hips: [16, -7.5, 6], spine: [-3.4, -17.2, 6], chest: [10.3, -3.7, 12], neck: [-6.6, 49.6, 4.5], head: [1.1, 24.4, 12.3],
        clavL: [-17.8, -11.9, 22.3], armL: [-129.2, 22.5, -38.4], foreL: [-104.9, 14.4, 3.8],
        clavR: [-11.7, -23.1, 38.3], armR: [-92.2, -57.8, -6.3], foreR: [-59.3, 2.5, 1],
        thighL: [-31.7, 12.8, 12.1], shinL: [42.3, -3, -1.5], footL: [-15.2, 2.3, 2.3],
        thighR: [-16.7, -4.5, -9.9], shinR: [37.1, 4.6, 3.1], footR: [-14.4, 3.2, 1.7],
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
      root: { p: [0.056, 0.598, 0.045], r: [-6, 100, 0] },
      j: {
        hips: [-25.7, -30, 10.5], spine: [-7.1, -17.9, 47.3], chest: [-26.7, -19.4, 41.3], neck: [3.8, -12, 3.8], head: [-17.5, -6.7, 0],
        clavL: [4, 11.4, 10.3], armL: [-49.6, 19.4, -28.4], foreL: [-68.9, 0.8, -2.1],
        clavR: [-0.5, -11.9, 15.3], armR: [-32.2, 12.4, 37.8], foreR: [-32.3, 37.8, 29.6],
        thighL: [-125.4, 10, 22.8], shinL: [59.6, 0, 0], footL: [8, -0.7, 0],
        thighR: [-34.4, -11, -50], shinR: [12.6, 7, -10.3], footR: [-21.5, -2.7, 10.7],
      },
    },
    B: {
      root: { p: [-0.151, 0.237, 0.027], r: [-90, 180, 0] },
      j: {
        hips: [16, 72, -3.7], spine: [-16.9, -18.6, 15], chest: [4.4, 24.9, 37.6], neck: [-14.5, -0.7, -0.7], head: [12, -24.7, -0.7],
        clavL: [-5.7, 19.6, 35.2], armL: [-118.4, 43.1, -32.6], foreL: [-83.1, -5.2, -2.2],
        clavR: [-22.9, -12.5, -32.7], armR: [-71.2, -32.1, 26.1], foreR: [-76.4, -0.7, 0],
        thighL: [-37, 2.3, 11.3], shinL: [52.8, 0, 0], footL: [-16, 0, 0.8],
        thighR: [-20.7, -6, -10], shinR: [40.8, 0, -0.7], footR: [-16, 0, 0],
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
      root: { p: [0.005, 0.555, 0.089], r: [0, 0, 0] },
      j: {
        hips: [47.5, 27.1, -4.5], spine: [3.1, 31.8, -38], chest: [43.8, -22.2, -21.4], neck: [22.6, 2.3, 0.1], head: [-10.6, 5.4, 1.6],
        clavL: [14.5, -13.9, -19.3], armL: [-97.6, 13.1, -24.4], foreL: [-82.5, 5.6, 1.6],
        clavR: [23.7, 7.9, 39.2], armR: [-82.1, -4.4, 39], foreR: [-109.5, 12.1, 10.8],
        thighL: [-3.9, 12.3, 77.8], shinL: [97.3, 0, 0], footL: [18, 1.5, 0],
        thighR: [3, -14.3, -1], shinR: [98, 0, 0.8], footR: [17.3, 0, 0.8],
      },
    },
    B: {
      root: { p: [0.02, 0.266, 0.248], r: [-90, 180, 0] },
      j: {
        hips: [23.1, -25.9, -21], spine: [8.4, -10.3, -8.8], chest: [20, 10.6, 23.5], neck: [-2, 2.3, -3], head: [11.8, 1.6, 3.1],
        clavL: [0.7, -43.4, 11.1], armL: [-157.2, 47.9, 11.6], foreL: [-123.4, 22.1, 11.5],
        clavR: [2.5, 15.3, -18.1], armR: [-173.6, 19.3, 29.3], foreR: [-73.9, -11.8, -5.1],
        thighL: [-29.8, -6.5, -6.3], shinL: [36.5, 0.8, 0], footL: [-7.9, 0.8, -5.9],
        thighR: [-25.3, -9.6, -3.1], shinR: [37.1, 0.8, 0.9], footR: [-13.9, 0.8, 2.3],
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
      root: { p: [0.008, 0.313, -0.462], r: [-22, 8, 6] },
      j: {
        hips: [6.1, -3, -24.6], spine: [10, -18, 3], chest: [14, 0, 15.8], neck: [25.1, 0.8, 3.8], head: [-11.2, 8.8, 0.8],
        clavL: [3, -4.4, 14.2], armL: [-144.9, 24, -50], foreL: [-89.6, -1.3, 6.8],
        clavR: [11.4, 24.2, -4.1], armR: [-94, -26, 8.4], foreR: [-114.5, -52.4, -48.6],
        thighL: [-66.9, 24.8, 28.9], shinL: [87.3, -8.1, 2.4], footL: [-16.1, 0, 0.1],
        thighR: [-61.6, -19.5, -30.9], shinR: [78.3, -1.5, 0.8], footR: [-10.9, 2.3, -0.7],
      },
    },
    B: {
      root: { p: [0.03, 0.293, -0.06], r: [-16, 4, 4] },
      j: {
        hips: [-20, -32.8, -4.5], spine: [5.3, -5.9, -5.2], chest: [-9.4, -6.6, -47.9], neck: [5.4, -18.7, -8.1], head: [19.5, -8.2, 3.8],
        clavL: [-24.5, -3.5, 26.9], armL: [-134.5, 11.7, -34.8], foreL: [-65.1, 0.8, -11],
        clavR: [9.8, 12.7, -33], armR: [-95.5, -27.8, 30.6], foreR: [-84.7, 4.7, 8.4],
        thighL: [-49.9, 8, 14], shinL: [82.3, 0, -0.7], footL: [-11.5, 0.8, 0],
        thighR: [-60.4, -4.9, -12.5], shinR: [86.9, 8.3, -8.2], footR: [-10.7, 0, -1.5],
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
      root: { p: [0.054, 0.536, -0.437], r: [10, 14, 0] },
      j: {
        hips: [-6, 12.8, 38.4], spine: [41.8, 23.4, 18], chest: [34.6, 6.6, -1.2], neck: [21.4, -4.5, 5.3], head: [-14.1, 0, 2.3],
        clavL: [30, -26.1, 15.7], armL: [10.3, 3.2, -66.5], foreL: [-54.2, 54.3, 24.9],
        clavR: [-14.9, 19.5, -40.8], armR: [-116.7, -7.1, 53.6], foreR: [5.9, 8.6, -32.2],
        thighL: [-40, 4, 14], shinL: [104, 0, 0], footL: [8, 0, 0],
        thighR: [-6.5, -5.2, -2.2], shinR: [91, 3, 1.5], footR: [20, 4.5, 6],
      },
    },
    B: {
      root: { p: [-0.176, 0.304, 0.12], r: [64, 176, 0] },
      j: {
        hips: [-0.7, 21.8, 12.9], spine: [-32.3, 18.4, 27.4], chest: [-32.8, 37.7, -25.6], neck: [-12.4, 12, 21.8], head: [25.5, 3.8, 3],
        clavL: [3.1, 14.5, -42.1], armL: [-64.7, 23.6, -25.7], foreL: [-116, -4.5, -0.7],
        clavR: [27.5, -34.3, 3.2], armR: [-18.8, -1, 27.3], foreR: [-105.5, 2.3, 6.8],
        thighL: [56.8, 54.1, 64.5], shinL: [149.7, -7.3, 10.6], footL: [15.1, 2.3, 2.3],
        thighR: [40.2, 7.8, -58.1], shinR: [151.2, 27.1, -6.6], footR: [14.3, 2.3, 0.8],
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
      root: { p: [0.005, 0.288, -0.415], r: [-26, 8, 8] },
      j: {
        hips: [0, -7.4, -5.9], spine: [12, -15.7, -3.7], chest: [-7.9, -10.5, 12.1], neck: [18, 0, 0], head: [-14.7, 10, 0],
        clavL: [6.1, 1.6, 23.8], armL: [-162.1, 39.8, -32.3], foreL: [-142.8, 1.5, 1.5],
        clavR: [5.4, -14, -31.3], armR: [-122.6, -27.2, 57.1], foreR: [-129.3, 2.3, -0.7],
        thighL: [-68.7, 24.9, 33.8], shinL: [69.2, -3.6, 6.9], footL: [-17.7, 1.5, -2.2],
        thighR: [-68.7, -35.1, -40.4], shinR: [76.6, 6, -6], footR: [-14, 1.7, -6.7],
      },
    },
    B: {
      root: { p: [-0.041, 0.293, -0.056], r: [-10, 4, 4] },
      j: {
        hips: [-12, -6.7, -12.7], spine: [-4, -0.7, 0], chest: [-2.2, 18.1, -8.2], neck: [-20, -17.9, -25.9], head: [-9.5, 25.1, 2.5],
        clavL: [-18.5, 24.2, 28.9], armL: [-147.6, 41.3, -42.4], foreL: [-118.7, -19.6, -0.7],
        clavR: [6.3, -8, 0.7], armR: [-129.5, -40.3, 38.9], foreR: [-117.2, -5.9, -1.5],
        thighL: [-50.4, 8, 14], shinL: [93.5, -0.7, 0], footL: [-10, -1.5, 0],
        thighR: [-50.5, -7.2, -13.2], shinR: [92, 0, -0.7], footR: [-10, 0, 0],
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
      root: { p: [-0.401, 0.247, 0.398], r: [-90, 90, 0] },
      j: {
        hips: [16.8, -6, 3.1], spine: [17.7, 7.9, 36.1], chest: [21.5, 1.6, 12.1], neck: [-3.9, 0.8, -0.7], head: [21.3, 0.8, 2.3],
        clavL: [-22.3, -20.7, 36.5], armL: [-117.7, 22.8, -36.2], foreL: [-68.1, -7.5, -0.7],
        clavR: [-4.5, 18.8, -26.6], armR: [-112.4, -26.5, 33.3], foreR: [-107, 1.6, 5.4],
        thighL: [-48.5, 0, 52.9], shinL: [5.7, 13, -2.9], footL: [-14.2, 2.3, 1.5],
        thighR: [-15.7, -20.8, -20.9], shinR: [63.2, -20.9, -10.3], footR: [-3.7, -25.3, -44.8],
      },
    },
    B: {
      root: { p: [-0.011, 0.249, 0.016], r: [-90, 180, 0] },
      j: {
        hips: [6.1, 19.7, 0], spine: [14.6, 11.4, 0], chest: [6, 9.8, 12.8], neck: [-10.2, 3, 1.5], head: [13, 0, 3],
        // The trapped arm reaches across to A's chest, which is what pulls it
        // straight; the free one is stacked under him where it can do nothing.
        clavL: [6.8, -4.4, 43.3], armL: [-90.9, 44.1, -14.9], foreL: [-32.6, 10.7, 0.8],
        clavR: [29.6, 24.2, -18.6], armR: [-50.3, -16.1, 25.7], foreR: [-61.3, 9.2, 8.4],
        thighL: [-28.7, 9.9, 8.5], shinL: [37.6, -2.2, 0], footL: [-11.2, 0.8, -1.5],
        thighR: [-19.9, -6, -5.7], shinR: [38.8, 2.3, 0], footR: [-12, 0.8, 0.8],
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
      root: { p: [0.053, 0.53, -0.253], r: [30, 0, 0] },
      j: {
        hips: [12.6, 13.5, -5.2], spine: [-1, 10.5, 5.3], chest: [2.5, 16.5, 25.6], neck: [20.6, 7.6, -6.6], head: [-19.4, -2.1, 0],
        clavL: [1.5, -2.4, 44.6], armL: [-163.4, 0.8, -55], foreL: [-49.5, -11.1, -26.2],
        clavR: [-7.8, 19.6, -23.2], armR: [-91.9, -34.1, 34.5], foreR: [-56.3, 10.7, 12.1],
        thighL: [4.9, 29.9, 7.8], shinL: [97.6, 0, 6.8], footL: [20, 0.8, -0.7],
        thighR: [7.3, -7.1, -12.9], shinR: [96.8, 0.8, -0.7], footR: [20.8, 0.8, 0.8],
      },
    },
    B: {
      root: { p: [0.004, 0.292, 0.123], r: [-64, 180, 0] },
      j: {
        hips: [20.1, 5.3, -10.5], spine: [-1.7, -36.7, -30.7], chest: [-13.5, 14.4, 8.5], neck: [-31.5, 0, 0.8], head: [20, 0.8, 0.8],
        clavL: [18.8, -8, 37.1], armL: [-103, 33.2, -28.6], foreL: [-98.8, 22.8, 14.5],
        clavR: [0.8, 15.1, -15.1], armR: [-92.7, -24, 34], foreR: [-84, 0, 3],
        thighL: [-144, 9.5, 5.4], shinL: [127.6, -14.9, 13.6], footL: [-10, 0.8, -0.7],
        thighR: [-52.3, -8.8, -14.4], shinR: [150.6, -10.4, 14.6], footR: [-10, 0, -1.5],
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
      root: { p: [0.34, 0.385, 0.237], r: [12, 116, 0] },
      j: {
        hips: [-35.5, -19.3, -10.4], spine: [41.6, -20.8, 10.5], chest: [40.5, -17, -4.5], neck: [34.6, -4.4, 5.3], head: [-21.2, -6, 0],
        clavL: [1.6, 3.2, -44.7], armL: [-70.2, 34.2, -45.4], foreL: [-112.9, 0.2, 0],
        clavR: [-37.9, -5.7, -9], armR: [-77.9, -49.3, 37.1], foreR: [-116.3, 0, 0],
        thighL: [-62.7, 11, 18.5], shinL: [102, -5.2, 5.3], footL: [8, -0.7, 0.8],
        thighR: [-8.2, 8.8, -24.2], shinR: [101.1, 0.8, -1.5], footR: [6.9, 1.6, 9.1],
      },
    },
    B: {
      root: { p: [-0.157, 0.276, 0], r: [-90, 180, 8] },
      j: {
        hips: [17.6, 8.3, 6], spine: [-13.2, -2.2, 12], chest: [3.9, 3.1, 5.4], neck: [-34.6, -0.7, 0.1], head: [1.5, -27.5, 5.3],
        clavL: [5.9, 18.1, 41.9], armL: [-160.2, 67.2, -50.1], foreL: [-94.6, -9.6, -3.7],
        clavR: [-16, -34.3, -19.8], armR: [-55.6, -26.4, 28.5], foreR: [-72, 1.6, 0.8],
        thighL: [-41.2, 6, 11.3], shinL: [48.8, -0.7, -0.7], footL: [-15.2, 0, 0],
        thighR: [-30.6, -3.7, -10], shinR: [36, -0.7, 0], footR: [-16, 0, 0],
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
      root: { p: [0.041, 0.319, -0.348], r: [50, 0, 0] },
      j: {
        hips: [-7.1, -11.2, -6], spine: [26.6, 0, -6], chest: [1.4, -10.4, 3], neck: [-36.9, -14.1, -10.2], head: [-25.7, 4.1, -15.4],
        clavL: [-31.4, -14.7, -6.5], armL: [-120.5, 100.4, 43.9], foreL: [-69.6, 24.4, 49.6],
        clavR: [36.3, 18.9, -2], armR: [-43.5, -60.6, -26.8], foreR: [-25.4, 1.9, -22.9],
        thighL: [22.4, 17.2, 22.7], shinL: [98.1, 0, 0], footL: [19.3, 0.8, 0],
        thighR: [11.2, -9.5, -13.5], shinR: [102.6, 0, -0.7], footR: [19.3, 0, -2.9],
      },
    },
    B: {
      root: { p: [0, 0.303, 0.201], r: [-56, 180, 0] },
      j: {
        hips: [16.1, 28.6, 19.6], spine: [5.4, -22.3, -14.7], chest: [8, -13.5, -19.4], neck: [-15.1, -0.7, -0.7], head: [17.6, 0.8, 0.8],
        clavL: [15.2, 13.5, 24.1], armL: [-140.4, 61.2, -15.8], foreL: [-124.4, 15.2, 53.5],
        clavR: [-14.7, -4.3, -34.5], armR: [-143.1, -1.1, 51.9], foreR: [-77.8, -13.3, -17.1],
        thighL: [-141.9, -15.5, -9.4], shinL: [92.3, -15.6, 14.5], footL: [-8.5, 0, 0],
        thighR: [-143.1, 2.5, 28.8], shinR: [87.7, 22.5, -27.7], footR: [-10, 0, 0],
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
      root: { p: [0.22, 0.51, 0.196], r: [16, 62, 0] },
      j: {
        hips: [-35.2, -3.7, 2.8], spine: [43.6, -15, 9.2], chest: [39.7, -27.5, 8.1],
        neck: [23.5, 6, -6], head: [-24, 0, -0.7], clavL: [-16.9, -24.2, -24.4],
        armL: [-81.6, 45.3, -44.5], foreL: [-98.7, 8, 6], clavR: [3.1, -33, -30.7],
        armR: [-54.2, -24.2, 31.3], foreR: [-111.2, 3.9, -2.5], thighL: [-64.7, 13.3, 17.3],
        shinL: [96.8, 0.1, 0], footL: [13.3, 0.8, -0.7], thighR: [-6.1, -42.3, 0.6],
        shinR: [80.5, 16.6, -11.8], footR: [-4.3, -15.6, 4.6],
      },
    },
    B: {
      root: { p: [-0.13, 0.257, 0.01], r: [-90, 180, 0] },
      j: {
        hips: [22, -8, 6], spine: [-2, -0.7, 7.5], chest: [3.6, -17.4, 18],
        neck: [6.6, 52.7, 14.6], head: [33.9, 14.4, -4.4], clavL: [-17.4, 4.6, 14],
        armL: [-131.6, 23.5, -38], foreL: [-112.4, 9, 4], clavR: [7.3, -20.2, 20.6],
        armR: [-48.7, -28.2, 14], foreR: [-76, 6, -6], thighL: [-40, 6.8, 12],
        shinL: [46, 0, -0.7], footL: [-16, 6, 0], thighR: [-16, -6, -8.5],
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
      root: { p: [0.07, 0.531, 0.05], r: [6, 46, 0] },
      j: {
        hips: [22.8, 11, 9], spine: [39.8, -5, -14], chest: [34.8, -16.2, -4],
        neck: [15.6, 0, 0], head: [-14, 0, 0], clavL: [1.3, -24.4, -28.2],
        armL: [-77.6, 11, -35.5], foreL: [-95.2, 7.5, 4], clavR: [4, 10, 27.5],
        armR: [-105.7, 11.8, 53.8], foreR: [-100.2, 17.8, 25.8], thighL: [-20.4, 13.6, 62],
        shinL: [96, 0, 0], footL: [14, 0, 0], thighR: [-95.8, 9.5, -11.7],
        shinR: [42.2, 10.6, -10.3], footR: [2.7, -2.8, -0.7],
      },
    },
    B: {
      root: { p: [0.05, 0.255, 0.23], r: [-90, 180, 0] },
      j: {
        hips: [18.5, -8, -17.2], spine: [18, -5.9, -1.4], chest: [18.3, 26.3, 12.1],
        neck: [-20, 0, 0], head: [14, 0, -0.7], clavL: [-6.8, -41.2, 7.9],
        armL: [-151.3, 44.1, 11.6], foreL: [-122.1, 9.2, 7.6], clavR: [17.4, 23.3, -16.7],
        armR: [-186.6, 4.1, 24.6], foreR: [-92.9, 2.4, 0.1], thighL: [-17.1, -12.6, -11.5],
        shinL: [24.6, 3.1, 3.8], footL: [-2.7, 0.1, -4.3], thighR: [-35, -11.8, -1.6],
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
      root: { p: [0.27, 0.391, 0.26], r: [10, 104, 0] },
      j: {
        hips: [-44.2, -56.7, 6], spine: [45.3, -22, -7.7], chest: [45.7, -15.6, 4.5],
        neck: [24.4, 5.8, -2.2], head: [-19.2, -0.7, 2.3], clavL: [-15.4, -33, -20.6],
        armL: [-90.2, 42, -50], foreL: [-125.6, 10.4, 2.3], clavR: [19.5, -31.7, -12],
        armR: [-44, -33, 39.4], foreR: [-98.6, -2.1, -10.2], thighL: [-36.7, 8.8, 41.6],
        shinL: [34.6, 2.3, 0], footL: [10, 0, -2.2], thighR: [-28.3, -1.2, -48.1],
        shinR: [40.5, -5.9, 1], footR: [12.4, 1.5, 3.1],
      },
    },
    B: {
      root: { p: [-0.124, 0.245, 0.004], r: [-90, 180, 0] },
      j: {
        hips: [15.3, 0.1, 6], spine: [-2, -6.6, 6], chest: [11.8, -17.1, 16.6],
        neck: [1.6, 46, 9], head: [19.1, 29, -14], clavL: [-24.5, -2.8, 17],
        armL: [-135.9, 28.6, -35.4], foreL: [-110, 1.6, 3.8], clavR: [6.1, -21, 7.4],
        armR: [-50.3, -36.2, 10.8], foreR: [-75.9, 6.2, -5], thighL: [-33.2, -0.7, 12],
        shinL: [41.5, 0, 0], footL: [-16, 0, 0], thighR: [-28.7, -3.7, -10],
        shinR: [28.8, 0, -0.7], footR: [-16, 0, 0],
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

  // The middle of falling into a guard.
  //
  // Four transitions end in a guard and all four fail in the same place and the
  // same way: at nine tenths of the way there, with a thigh inside a thigh, 20
  // to 21 cm deep. docs/POSE-STUDY.md pinned it down — during the drop one man
  // is already on the mat and the other is still standing, and their knees end
  // up in the *same two lateral bands*: measured on STANDING>OPEN_GUARD_X at
  // t=0.85, A's knees sat at x = -0.32 and +0.21 and B's at -0.33 and +0.24.
  // The straight line then takes each thigh to its destination by the shortest
  // path, which is through the other man's.
  //
  // No search fixes that: arc-solve, the single-limb lobe sweep, route-arc over
  // every pose in the library and a first hand-typed GUARD_ENTRY all came back
  // at 18.5 to 20 cm, because a nudge cannot route a limb around a body. What
  // was missing is a pose in which the legs are already round the right way,
  // and the blend goes through it.
  //
  // Lifted out of the blend itself (tools/waypoint-from.mjs) at the moment
  // before the crossing and then relaxed, so it is the shape the movement
  // already had, minus the collision.
  GUARD_ENTRY: P('GUARD_ENTRY', {
    name: 'Падение в гард',
    label: 'OPEN GUARD',
    points: 0, top: 'B', ground: true, waypoint: true,
    A: {
      root: { p: [0.095, 0.277, -0.012], r: [-67.6, 111.9, 48.7] },
      j: {
        hips: [14.2, -0.5, 13.7], spine: [1.1, -3.2, -11], chest: [2.3, 5.1, -2.7],
        neck: [-24.4, 0, 0], head: [15.3, 0, 0], clavL: [-8.8, -19, 7.4],
        armL: [-80.3, 20.4, -18.8], foreL: [-78.2, -4.4, -3.7], handL: [-1.8, 0, 0],
        clavR: [-12.2, 10.9, -6.1], armR: [-72.3, -21.2, 28.2], foreR: [-80.2, -4.4, -3.7],
        handR: [-1.8, 0, 0.8], thighL: [-76, -161.6, -159.8], shinL: [31.1, -5.6, 4.2],
        footL: [-22.2, -1.2, 0.1], thighR: [-86, -162.6, 154.3], shinR: [29.6, 5.7, 1.8],
        footR: [-21.5, 1.4, 0.8],
      },
    },
    B: {
      root: { p: [-0.057, 0.547, -0.379], r: [0, 27, 0] },
      j: {
        hips: [2.8, 1.9, -22.8], spine: [16.2, -13.1, -11.3], chest: [12.6, -1.3, -2.8],
        neck: [3.6, 0, 0], clavL: [5.5, -9.1, 27.1], armL: [-84.4, 16.7, -10.9],
        foreL: [-45.2, -6.1, 9.4], handL: [-1.8, 0, 0], clavR: [-9.8, 31.9, -19],
        armR: [-73.8, -4.5, 27.7], foreR: [-48.5, 7.5, 1.7], handR: [-1.8, 0, 0.8],
        thighL: [-22.6, 2.5, 9.2], shinL: [76.7, -2.2, 2.3], footL: [8.9, -1.2, 0.5],
        thighR: [-26.9, -9.6, -16.2], shinR: [58.6, 5.3, -6.7], footR: [-19.2, 3, 0.1],
      },
    },
    hold: [
      // The whole point of the pose, and the thing the straight line gets
      // wrong: the man going to his back has a knee either side of the other
      // man's hips. Not both on one side, which is what a blend does when it
      // takes each thigh to its destination by the shortest path and sweeps
      // them through each other on the way.
      { straddle: 'B.hips', with: ['A.shinL', 'A.shinR'], by: 0.10 },
      // He is under him and they are together: this is a guard being entered,
      // not two men falling side by side.
      { of: 'B.chest', above: 'A.chest', by: 0.15 },
      { of: 'B.chest', near: 'A.chest', within: 0.6 },
    ],
  }),

  // The middle of getting a guard back from underneath mount.
  //
  // The other half of the same problem GUARD_ENTRY solves. Falling into a guard
  // from the feet and recovering one from under a mount are different shapes —
  // one man is descending in the first and rising in the second — and the study
  // in docs/POSE-STUDY.md said so before either existed. Sampled from the blend
  // at the moment before the thighs cross, then relaxed.
  GUARD_RECOVER: P('GUARD_RECOVER', {
    name: 'Возврат гарда',
    label: 'CLOSED GUARD',
    points: 0, top: 'B', ground: true, waypoint: true,
    A: {
      root: { p: [-0.024, 0.244, -0.02], r: [-74.8, 82.3, 82.3] },
      j: {
        hips: [11.7, 19.3, 20.2], spine: [11.4, 24.5, 19.3], chest: [9.9, 6.3, -26.6],
        neck: [-14.9, 0.8, 0.8], head: [13, -0.5, -0.5], clavL: [7.3, -2.4, -5.5],
        armL: [-89.8, -3.4, 0], foreL: [-60.7, 1.1, 1], clavR: [-28.1, 18.8, -7.2],
        armR: [-75.6, 148.4, -164], foreR: [-82.3, 19.8, 17.5], thighL: [-43.2, 11.6, 26.4],
        shinL: [41.5, 176.1, 170.7], footL: [-5.1, 2.5, 1.5], thighR: [-62.6, -156.6, 171.9],
        shinR: [28.5, 170.3, -162.4], footR: [-6.7, -0.6, 0],
      },
    },
    B: {
      root: { p: [-0.013, 0.465, -0.307], r: [-2, 15.1, 15.1] },
      j: {
        hips: [10.9, -24.1, 23.5], spine: [27.9, 15.8, 3.3], chest: [18.5, -3, 10.2],
        neck: [5.7, 0, 0.4], head: [-5.4, 0.7, 0.4], clavL: [29.4, -10.4, -21.1],
        armL: [-28.2, 9.9, 38.9], foreL: [-51.1, -6.8, -31.3], clavR: [-19.1, 35.5, -1.6],
        armR: [-86.6, -82.9, 92.2], foreR: [-53.3, 9.9, 18.1], thighL: [7.3, 5.6, 10.7],
        shinL: [86.2, 0.8, 0.7], footL: [19.5, 0, 0], thighR: [28, -16.9, -22.9],
        shinR: [85.3, 0, 0], footR: [19.4, 0, -0.6],
      },
    },
    hold: [
      // The same sentence as GUARD_ENTRY and for the same reason: the man
      // going underneath has a knee either side of the other man's hips. That
      // is what recovering a guard *is*, and it is the one thing a straight
      // line between mount and a guard cannot do — it takes each thigh the
      // short way and sweeps them through each other at nine tenths.
      { straddle: 'B.hips', with: ['A.shinL', 'A.shinR'], by: 0.10 },
      // Hips already clear of the mat and the chests apart: this is the moment
      // the bottom man has made room, not the moment he is still flat.
      { of: 'B.chest', above: 'A.chest', by: 0.12 },
      { of: 'B.chest', near: 'A.chest', within: 0.6 },
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
      root: { p: [0.001, 0.314, -0.415], r: [-22, 8, 6] },
      j: {
        hips: [2.3, -6.7, -36.6], spine: [24, -28.5, 2.3], chest: [22, -5, -1.5],
        neck: [25.3, 1.5, 3.8], head: [-11.2, 11.8, -6], clavL: [-2.2, 2.4, 22.4],
        armL: [-128.4, 32.3, -50], foreL: [-90.6, -2.8, -9.7], clavR: [27.1, 14.4, -19.1],
        armR: [-84.9, -17.7, 8.5], foreR: [-116.8, -59.1, -54.5], thighL: [-75.5, 21.9, 26.6],
        shinL: [79.6, -11.9, 3.8], footL: [-15.5, 5.3, 2.3], thighR: [-89, -21, -27.2],
        shinR: [82.5, 1.5, -2.2], footR: [-13.2, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.288, -0.02], r: [-16, 4, 4] },
      j: {
        hips: [-14, -32.2, -5.2], spine: [-3.9, -24.7, -13.5], chest: [-5.7, -10.5, -48],
        neck: [12.4, -9.7, 0.8], head: [16, -2, 6], clavL: [-24.5, 6.2, 30.5],
        armL: [-148.4, 8.7, -37.9], foreL: [-56.8, 2.3, -12.6], clavR: [9.6, 17.4, -29],
        armR: [-89.5, -31.5, 31.4], foreR: [-82.4, 6.3, 12.2], thighL: [-53, 8, 12.5],
        shinL: [86, 0, 3.8], footL: [-8.5, 0.8, 3], thighR: [-60.5, -6.5, -6.5],
        shinR: [89.8, 1.5, 3], footR: [-6.2, 4.5, -1.5],
      },
    },
  }),

  RNC_WORK: P('RNC_WORK', {
    // Сжатие: A подтягивает предплечья и уводит голову вниз, у B
    // выгибается спина и руки тянут захват от горла.
    name: 'Удушение — сжатие',
    variantOf: 'RNC',
    A: {
      root: { p: [0.005, 0.382, -0.417], r: [-26, 8, 8] },
      j: {
        hips: [0, -11.2, -6], spine: [18, 3, 9.9], chest: [-13.9, -10.5, -1.3],
        neck: [25, 0, 0], head: [-21, 10, 0], clavL: [-1.5, -0.7, 14.3],
        armL: [-160.6, 39.8, -32.3], foreL: [-137.5, 1.5, 1.5], clavR: [5.3, -15.4, -33.5],
        armR: [-122.6, -27.2, 57.1], foreR: [-136, 3.1, -0.7], thighL: [-77.6, 25.8, 31.6],
        shinL: [69.2, -5.8, 9.9], footL: [-18.4, -2.1, 0.1], thighR: [-72.4, -23.8, -34.5],
        shinR: [78.9, 12.8, -9.7], footR: [-16.2, -0.7, -2.9],
      },
    },
    B: {
      root: { p: [-0.03, 0.363, -0.084], r: [-10, 4, 4] },
      j: {
        hips: [-2, -1.5, -20.2], spine: [-11, 2.4, 0.8], chest: [3.3, 25.7, -6.7],
        neck: [-25.9, -21.7, -29], head: [-13, 28, 1.6], clavL: [-17.8, 23.4, 22.1],
        armL: [-148.8, 40.7, -42.3], foreL: [-124.7, -17.4, -0.7], clavR: [7.1, -11.7, 0.7],
        armR: [-130.3, -41, 36], foreR: [-123.2, -5.1, -1.5], thighL: [-52, 8, 14],
        shinL: [93.5, -1.5, 0], footL: [-10, 0, 0], thighR: [-52, -8, -14],
        shinR: [90.5, 0, 0], footR: [-10, 0, 0],
      },
    },
  }),

  HALF_GUARD_WORK: P('HALF_GUARD_WORK', {
    // A продавливает колено наружу и наваливается плечом; B ставит
    // раму и уходит на бок, поднимая щит коленом.
    name: 'Полугард — проход',
    variantOf: 'HALF_GUARD',
    A: {
      root: { p: [0.176, 0.483, -0.145], r: [0, 24, 0] },
      j: {
        hips: [7.9, -1.5, 36], spine: [17.1, -19.4, 20.3], chest: [-6.5, -26.1, 5.3],
        neck: [12.5, 0, 2.3], head: [-10, 0, 0], clavL: [-16, -4.2, 40.6],
        armL: [-117.5, 57.4, 2.9], foreL: [-76.2, 1.7, -5.7], clavR: [33, -27.7, -13.2],
        armR: [-30.1, 3.4, 8.1], foreR: [-66.4, 47.7, 16.2], thighL: [-25.4, 19, 28.3],
        shinL: [107, 0, 0], footL: [10, 0, 0.8], thighR: [-21.5, 44.5, -24.2],
        shinR: [99.1, 13.7, -9.7], footR: [-2, -15.6, 3.9],
      },
    },
    B: {
      root: { p: [-0.069, 0.259, 0.076], r: [-72, 156, -22] },
      j: {
        hips: [4, -0.7, 9.1], spine: [-1, 16.6, 35.4], chest: [25.7, 4.2, 0.1],
        neck: [-24.5, 0, 0.8], head: [14, 3, 6.8], clavL: [13.2, 22, -23.3],
        armL: [-89.4, 46.7, -17.5], foreL: [-104, -2.3, -3.5], clavR: [2.2, 10.2, -41.5],
        armR: [-28, 30.3, 2.1], foreR: [-24.8, 43.7, 18.3], thighL: [-79, 8.8, 18],
        shinL: [88, 0, 0], footL: [-14, 0, 0], thighR: [-71, -45.6, -29.2],
        shinR: [82.7, -14.1, 10.6], footR: [-14, 0, 0.8],
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
      root: { p: [0.042, 0.516, 0.06], r: [0, 0, 0] },
      j: {
        hips: [60.9, 10.5, -12], spine: [-21.7, 32, -32.4], chest: [44, -14.6, -7.8],
        neck: [24, -3, -1.5], head: [-5.5, 0, 0], clavL: [7, -19.2, -14.1],
        armL: [-80.3, 4.1, -31.9], foreL: [-83.3, 16.2, 4.1], clavR: [24.5, -7.5, 31.4],
        armR: [-82, -5.2, 33.8], foreR: [-116.1, 18.3, 7.8], thighL: [-10.6, 21.3, 88.1],
        shinL: [103, 1.5, 0], footL: [20.3, 0.8, 0], thighR: [-9.7, -4.4, -0.8],
        shinR: [103, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0.042, 0.254, 0.219], r: [-90, 180, 0] },
      j: {
        hips: [18.8, -16.9, -6], spine: [-4, -1.4, -11.9], chest: [19.8, 11.4, 23.3],
        neck: [-14.7, 0, -1.5], head: [14, -1.5, 0], clavL: [-3.4, -36.7, 16.8],
        armL: [-160.2, 67.4, 1.1], foreL: [-113.1, 9.2, 6.1], clavR: [8.4, 10.6, -26.4],
        armR: [-212.8, 12.5, 19.3], foreR: [-83, 19.6, 5.3], thighL: [-28.3, -17.1, -18.4],
        shinL: [34.8, 3, -2.2], footL: [-6.4, 6.2, -8.8], thighR: [-41.1, -8.2, -1.6],
        shinR: [42.1, -0.7, -6], footR: [-14, -6, -1.5],
      },
    },
  }),

  SIDE_CONTROL_WORK: P('SIDE_CONTROL_WORK', {
    // A меняет бедро и вжимает плечо в челюсть; B ставит раму и
    // подтягивает колено, чтобы креветкой уйти.
    name: 'Сторона — смена бедра',
    variantOf: 'SIDE_CONTROL',
    A: {
      root: { p: [0.294, 0.297, 0.262], r: [8, 100, 0] },
      j: {
        hips: [-42, -17.9, -17.2], spine: [35.8, -19.6, 12.2], chest: [29.8, -22.7, 16.1],
        neck: [10.3, 3.8, 20.4], head: [-37.5, -1.5, -6.7], clavL: [-20, -23.8, -24],
        armL: [-98.8, 48.7, -48.8], foreL: [-121.9, 13.6, 13.6], clavR: [39.1, -23.9, -13.4],
        armR: [-44.7, -9.7, 39.4], foreR: [-145.2, 3.2, -14.8], thighL: [-52.5, -2.4, 6.8],
        shinL: [116.7, -9.7, 6.8], footL: [10.8, 0.8, -4.5], thighR: [-12.7, -9, -16.6],
        shinR: [90.1, 4.6, 0.1], footR: [8.2, -2.9, 12.2],
      },
    },
    B: {
      root: { p: [-0.09, 0.259, -0.06], r: [-90, 180, 0] },
      j: {
        hips: [16, -1.5, 6], spine: [-2, -28.4, 6], chest: [4.3, -3.7, 12],
        neck: [14.3, 61, 12.1], head: [23.5, 21.4, 2.4], clavL: [-17.7, -5.9, -5.5],
        armL: [-114.1, 22.5, -38.4], foreL: [-117.6, 3.1, 3.8], clavR: [15.3, -31.3, 10.4],
        armR: [-64.8, -40.7, 6.3], foreR: [-62.2, 2.5, -3.5], thighL: [-40.7, 6.8, 12.8],
        shinL: [52, -1.5, 0], footL: [-16, 0, 0], thighR: [-10, -7.5, -14.5],
        shinR: [30.3, -1.5, -6], footR: [-16, 0, 0],
      },
    },
  }),

  STANDING_WORK: P('STANDING_WORK', {
    // Оба меняют уровень и тянутся за захватом: передняя рука вперёд,
    // колени глубже, B заходит по кругу.
    name: 'Стойка — борьба за захват',
    variantOf: 'STANDING',
    A: {
      root: { p: [0, 0.643, -0.57], r: [0, -5, 0] },
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
      root: { p: [0.1, 0.658, 0.61], r: [0, 186, 0] },
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
      root: { p: [0.03, 0.68, -0.234], r: [0, 6, 0] },
      j: {
        hips: [-11.5, -13, 15.9], spine: [19.5, -0.2, -21.7], chest: [15.3, 0, 9.2],
        neck: [-22.7, 6.3, 8.1], head: [3.6, -0.7, 0.8], clavL: [20.5, -17.7, 23.8],
        armL: [-95.7, 42.9, 14.6], foreL: [-128.3, 15.3, 22.8], clavR: [21.4, 28.2, 28.8],
        armR: [-93.7, -33, 27.7], foreR: [-88, -0.7, 8.1], thighL: [-39.8, 12, 7.6],
        shinL: [42.1, -0.7, 3.9], footL: [-20.9, -7.2, 0.8], thighR: [27.5, -14.7, -7.4],
        shinR: [31.6, -1.4, 0], footR: [-46.7, 12, -3.7],
      },
    },
    B: {
      root: { p: [-0.126, 0.64, 0.281], r: [0, 186, 0] },
      j: {
        hips: [-16, -14.7, 6], spine: [24.1, -1.4, 0.8], chest: [5.8, 3, 4.7],
        neck: [8.6, -2, -6.3], head: [-10.6, 0.8, 0.9], clavL: [29.1, -5.9, 28.8],
        armL: [-84.4, 37, 8.5], foreL: [-103.7, -29.7, -33.6], clavR: [8.9, -5, 5.9],
        armR: [-93.3, -14.3, 27.1], foreR: [-76.4, -2.2, 1.6], thighL: [-32, 12, 8.3],
        shinL: [35.5, 0, 2.3], footL: [-20.1, -7.2, 0.8], thighR: [8.8, -14, -3.7],
        shinR: [38, 0, 1.6], footR: [-42.9, 13.6, 0.8],
      },
    },
  }),

  CLOSED_GUARD_WORK: P('CLOSED_GUARD_WORK', {
    // A выпрямляется и вжимает бёдра вниз, B уходит на бок и подбирает
    // угол, перекрещивая ноги выше.
    name: 'Закрытый гард — осанка против угла',
    variantOf: 'CLOSED_GUARD',
    A: {
      root: { p: [-0.045, 0.521, -0.341], r: [0, 0, 0] },
      j: {
        hips: [25.5, -24.7, 33.9], spine: [29.1, 14.4, 14.4], chest: [13.2, -12.6, 22],
        neck: [0.3, 0, 0], head: [-1.9, 0, 0.8], clavL: [28.8, -7.3, -22.8],
        armL: [-25.4, 15, 28.7], foreL: [-57.6, -13.2, -34], clavR: [-18.3, 38.9, 5.7],
        armR: [-80.8, -25.8, 33], foreR: [-35.5, 8.5, 16.7], thighL: [17.1, 9.9, 14.1],
        shinL: [92, 1.5, 1.6], footL: [24.8, 0.8, 0.8], thighR: [32.1, -16.4, -25.9],
        shinR: [92.8, 0.8, 0.8], footR: [24.8, 1.5, 0.8],
      },
    },
    B: {
      root: { p: [-0.015, 0.274, -0.043], r: [-84, 168, 0] },
      j: {
        hips: [18.3, 24.1, 10.5], spine: [10.9, 30.4, 12.2], chest: [6.5, 14.2, -27.4],
        neck: [-17.2, -0.7, 0], head: [10, 0.8, 0], clavL: [2.3, 0.8, -7.2],
        armL: [-99, 32.6, -30.4], foreL: [-76.9, 1.6, 1.6], clavR: [-35, 27.8, -20.1],
        armR: [-118, -34.7, 7.4], foreR: [-77.5, 19.1, 15.3], thighL: [-58.5, 17.6, 6.9],
        shinL: [148.4, -2.9, -10.7], footL: [-10, 0, 0], thighR: [-119.1, 26.9, 5.3],
        shinR: [144.8, 1.7, 11.7], footR: [-10, 0, 0],
      },
    },
  }),

  OPEN_GUARD_WORK: P('OPEN_GUARD_WORK', {
    // B выпрямляет ноги и отталкивает A от себя, дотягивая рукава;
    // A садится ниже и сбивает колени вниз.
    name: 'Открытый гард — толчок стопами',
    variantOf: 'OPEN_GUARD',
    A: {
      root: { p: [-0.064, 0.6, -0.538], r: [0, 0, 0] },
      j: {
        hips: [4.3, 6.1, -20.2], spine: [29.6, -8.2, -0.7], chest: [22, 1.5, 3.8],
        neck: [19.3, 0, 1.5], clavL: [0.8, -4.5, 18.4], armL: [-96.3, 35.9, -20.9],
        foreL: [-27.2, -7.4, 7.7], clavR: [-12.7, 35.3, -20.5], armR: [-87.3, -21.4, 25.6],
        foreR: [-40, -8.2, -3.6], thighL: [-28.2, 25.4, 7.9], shinL: [98, 19.6, -14.9],
        footL: [25.9, -11.1, 1.7], thighR: [-8.7, -21.4, -17], shinR: [77.8, 1.5, -4.5],
        footR: [-20, 0, 0],
      },
    },
    B: {
      root: { p: [0.023, 0.294, 0.066], r: [-78, 180, 0] },
      j: {
        hips: [32.8, -6, 0.8], spine: [6.8, -4.4, -17.9], chest: [6.8, 4.5, 5.4],
        neck: [-18.5, 0, 1.5], head: [13.5, 0, 0], clavL: [-1.4, -20.1, 3.1],
        armL: [-93.7, 27.1, -25.4], foreL: [-93.9, -5.1, -4.4], clavR: [-8.8, 19.5, -4.5],
        armR: [-84.9, -30.7, 32.3], foreR: [-89.7, -5.1, -4.4], thighL: [-95.7, 18.1, 14.3],
        shinL: [15.1, 1.6, 0.1], footL: [-24, 0, 0], thighR: [-101.5, -7.7, -11.2],
        shinR: [20.5, 9.9, 2.3], footR: [-20, 0, -3],
      },
    },
  }),

  KNEE_ON_BELLY_WORK: P('KNEE_ON_BELLY_WORK', {
    // A переносит колено дальше поперёк и шире ставит опорную ногу;
    // B ставит раму в колено и подбирает своё, чтобы креветкой уйти.
    name: 'Колено на животе — вес вниз',
    variantOf: 'KNEE_ON_BELLY',
    A: {
      root: { p: [0.032, 0.609, 0.045], r: [-6, 100, 0] },
      j: {
        hips: [-32.1, -32.2, 16], spine: [2.5, -21.3, 45], chest: [-2.9, -8.2, 49],
        neck: [1.1, -9.7, 3.1], head: [-22, -6, 0], clavL: [-1.2, 9.9, 19.4],
        armL: [-66.2, 23.3, -24.6], foreL: [-71.8, 4.9, -1.3], clavR: [0.8, -11.8, 19.9],
        armR: [-37, -9.9, 30.4], foreR: [-61.8, 17.1, 25], thighL: [-107.9, 15.3, 22.8],
        shinL: [45.8, 0, 0.8], footL: [8, 0, 0], thighR: [-40.9, -11.7, -54.2],
        shinR: [27, 12.9, -17.2], footR: [-18.6, 1.6, 6.2],
      },
    },
    B: {
      root: { p: [-0.165, 0.234, 0.053], r: [-90, 180, 0] },
      j: {
        hips: [10.6, 57.9, -5.2], spine: [-14.7, -8.6, 15], chest: [5.3, 29.9, 39.1],
        neck: [-19.7, -0.7, 0.8], head: [19.3, -23.2, -0.7], clavL: [3.9, 14.3, 20],
        armL: [-100, 46.2, -24.5], foreL: [-94.1, -5.2, -5.1], clavR: [-27.5, -14, -29.7],
        armR: [-62.1, -23.7, 22.5], foreR: [-89.9, 0, -0.7], thighL: [-43.9, 12.8, 17.3],
        shinL: [68, 0.8, 0], footL: [-16, 0.8, 0], thighR: [-20, -6.7, -10],
        shinR: [40, 0, 0], footR: [-16, 0.8, 0],
      },
    },
  }),

  TURTLE_WORK: P('TURTLE_WORK', {
    // A обходит к ближнему боку и заводит крюк коленом; B шагает вперёд
    // и подбирает локти к коленям, закрываясь плотнее.
    name: 'Черепаха — крюк против движения вперёд',
    variantOf: 'TURTLE',
    A: {
      root: { p: [0.114, 0.558, -0.508], r: [10, 26, 0] },
      j: {
        hips: [2.3, 31.2, 23.6], spine: [43.4, 14.8, 12.8], chest: [38.4, -8.9, 7.6],
        neck: [18.4, 0, -2.2], head: [-16.4, 0.1, 0.1], clavL: [30, -21, 21.3],
        armL: [-31.9, 28.7, -41.7], foreL: [-66.3, 44.4, 33.8], clavR: [-4.2, 35.4, -29.3],
        armR: [-111.8, -10, 79], foreR: [-38.1, -25.8, -20.8], thighL: [-29.1, 0.4, 18.6],
        shinL: [97.6, 4.6, 3.1], footL: [12.6, 0.1, 3.8], thighR: [-48.4, -14.5, -13.7],
        shinR: [90, 0, -3], footR: [11, -0.7, 0],
      },
    },
    B: {
      root: { p: [-0.039, 0.251, 0.074], r: [64, 176, 0] },
      j: {
        hips: [14.3, 0.8, 22.7], spine: [-34, 9.8, 30.3], chest: [-40.1, 32.3, -18.2],
        neck: [-25.7, -0.7, 1.6], head: [33.5, -0.7, 4.5], clavL: [-2, 39.3, 21.6],
        armL: [-101.6, 34.4, -6.7], foreL: [-125.2, -0.7, 4.6], clavR: [35.3, -25, 7.4],
        armR: [-18.3, -2.3, 27.4], foreR: [-110.9, 5.4, 6.9], thighL: [46.2, 46, 36.1],
        shinL: [154.1, -2, 22.8], footL: [32.4, 0.1, 0.1], thighR: [24.9, 1.9, -53.6],
        shinR: [153.9, 44.5, 2.3], footR: [12, 0, 0],
      },
    },
  }),

  ARMBAR_WORK: P('ARMBAR_WORK', {
    // A сводит колени и поднимает таз; B доворачивает большой палец вверх
    // и тянется свободной рукой на замок — рука при этом остаётся прямой.
    name: 'Рычаг локтя — сведение колен',
    variantOf: 'ARMBAR',
    A: {
      root: { p: [-0.404, 0.252, 0.36], r: [-90, 90, 0] },
      j: {
        hips: [11.2, -6, 13.6], spine: [6.8, 25, 41.5], chest: [20, -3.5, 24.3],
        neck: [-3.9, 0.8, -2.2], head: [23.5, -1.5, -0.7], clavL: [-20.9, -20.1, 35.1],
        armL: [-110.2, 15.3, -38.4], foreL: [-88, -6, -0.7], clavR: [-5.6, 3.9, -25.8],
        armR: [-108.8, -14.5, 40], foreR: [-115.2, -3.6, 6.2], thighL: [-34.9, 1.5, 45.1],
        shinL: [15, -1.3, -2.2], footL: [-12.7, 0.1, -1.5], thighR: [-20.7, 6.1, -22.9],
        shinR: [34.8, 1.6, -3.7], footR: [-8.1, 3.9, -2.9],
      },
    },
    B: {
      root: { p: [-0.029, 0.246, -0.044], r: [-90, 180, 0] },
      j: {
        hips: [17.1, 4, 4.6], spine: [11.7, 26.1, 0.8], chest: [11.2, 6.6, 6.9],
        neck: [-4.1, 4.6, -2.9], head: [4.1, 0.8, -2.2], clavL: [19.3, 9.1, 41.4],
        armL: [-79.3, 49.8, -12], foreL: [-54.2, -5.1, 14.1], clavR: [23.6, 19.7, -23.1],
        armR: [-61.8, -19.9, 26.6], foreR: [-74, 8.5, 4.7], thighL: [-14.1, 24.2, 17.6],
        shinL: [61.3, 0.8, -2.2], footL: [-11.2, 0.8, 0.8], thighR: [-9.3, -5.9, -6.4],
        shinR: [38.1, -0.7, -4.4], footR: [-12.7, 0, 0.8],
      },
    },
  }),

  TRIANGLE_WORK: P('TRIANGLE_WORK', {
    // B уходит на угол, подрезает голеностоп и тянет голову вниз;
    // A выпрямляется и уводит плечо от петли.
    name: 'Треугольник — угол и подтяг головы',
    variantOf: 'TRIANGLE',
    A: {
      root: { p: [-0.011, 0.412, -0.304], r: [30, 0, 0] },
      j: {
        hips: [2, 18, -21.7], spine: [-9.2, 10.5, 30], chest: [0.8, 20.3, 19.6],
        neck: [11.8, 0.8, -14.2], head: [-11.5, -3.7, 0], clavL: [-1.2, 0.6, 42.8],
        armL: [-166.9, -1.4, -70.2], foreL: [-49.5, -0.6, -13.4], clavR: [-10.1, 30.9, -26.8],
        armR: [-79.6, -34, 30.8], foreR: [-47.3, 12.8, 12.9], thighL: [13.9, 37.4, 22.1],
        shinL: [96, 0, 0], footL: [20, 0.8, 0.8], thighR: [1.9, -19, -20.3],
        shinR: [96.8, 1.5, 0.8], footR: [21.6, -0.7, 2.3],
      },
    },
    B: {
      root: { p: [0.064, 0.293, 0.115], r: [-58, 190, 0] },
      j: {
        hips: [28.8, 16, -14.5], spine: [-2.4, -34.3, -27.4], chest: [-8.5, 10.6, 2.4],
        neck: [-14.5, 0, 0], head: [14, 2.3, 0], clavL: [20.4, -8.8, 31.1],
        armL: [-114.1, 35.5, -28.6], foreL: [-111.7, 9.9, 3.9], clavR: [8.3, 19.6, -21.1],
        armR: [-110.7, -24, 28], foreR: [-104, 6, 6], thighL: [-142.5, 21.4, -0.8],
        shinL: [130, -9.7, 5.3], footL: [-10, 0, 0], thighR: [-42, -3.5, -19.7],
        shinR: [145.5, 1.6, 10.8], footR: [-10, 0, 0],
      },
    },
  }),

  KIMURA_WORK: P('KIMURA_WORK', {
    // A доворачивает кисть вверх по спине и наваливается; B тянет руку
    // вниз к своему поясу и вкручивается в него боком.
    name: 'Кимура — доворот кисти за спину',
    variantOf: 'KIMURA',
    A: {
      root: { p: [0.371, 0.398, 0.253], r: [12, 116, 0] },
      j: {
        hips: [-39.4, -14.9, -17.2], spine: [43.7, -14.9, 2.4], chest: [46.9, -9.7, 9.2],
        neck: [41.3, -0.7, 0], head: [-28, 0, 0], clavL: [5.6, 6.9, -42],
        armL: [-85.3, 36.1, -49.2], foreL: [-129.1, 0.1, -3], clavR: [-36, 4, 0],
        armR: [-87.1, -56.6, 31.1], foreR: [-125, -9, -4.5], thighL: [-72.7, 11, 14.8],
        shinL: [110.6, -0.7, 3.1], footL: [8, -3.7, 1.5], thighR: [-20.1, 8.1, -16.7],
        shinR: [101.8, 0.8, -0.7], footR: [19.6, 0, 0.8],
      },
    },
    B: {
      root: { p: [-0.105, 0.307, -0.007], r: [-90, 180, 8] },
      j: {
        hips: [5, -0.1, 6], spine: [-3.4, 6.2, 6], chest: [5.4, 2.1, 6],
        neck: [-26.7, -0.7, 0.8], head: [-6.5, -26, 7.5], clavL: [0.6, 16.7, 41.2],
        armL: [-137.4, 62.2, -44.4], foreL: [-84.7, -12.6, -2.9], clavR: [-21.8, -33.6, -13.3],
        armR: [-68.7, -19.7, 33], foreR: [-84, 0, 0], thighL: [-42, 6, 12],
        shinL: [60, 0, 0], footL: [-16, 0, 0], thighR: [-24, -6, -10],
        shinR: [31.5, 0, 0], footR: [-16, 0, 0],
      },
    },
  }),

  GUILLOTINE_WORK: P('GUILLOTINE_WORK', {
    // B прогибается назад и сводит локти; A подставляет руку и уводит
    // подбородок в сторону, подшагивая ближе.
    name: 'Гильотина — прогиб и сведение локтей',
    variantOf: 'GUILLOTINE',
    A: {
      root: { p: [0.041, 0.299, -0.379], r: [50, 0, 0] },
      j: {
        hips: [14.6, -5.9, -6], spine: [10.1, -6.6, -6], chest: [-8.4, -6.5, -3],
        neck: [-48, -31.2, -20], head: [-26, 1.1, -12.7], clavL: [-30.2, -25.1, -2.9],
        armL: [-123.3, 90.6, 47.1], foreL: [-83.3, 20.7, 48.2], clavR: [34.9, 19.5, 26.2],
        armR: [-54.2, -71.1, -29.1], foreR: [-10.7, -3.4, -14.7], thighL: [13.8, 26.8, 28.6],
        shinL: [117.8, 9, 0], footL: [20, 0, 0], thighR: [14.8, -8.7, -10.4],
        shinR: [98.8, 0.8, -0.7], footR: [20, -2.2, -0.7],
      },
    },
    B: {
      root: { p: [-0.03, 0.292, 0.18], r: [-48, 180, 0] },
      j: {
        hips: [12.6, 20.3, 23.3], spine: [0.5, -26.9, -5.9], chest: [-10.7, -11.2, -18.6],
        neck: [-28.6, 0.8, 0.8], head: [27.3, 1.5, -0.7], clavL: [21.9, -4.4, 18.1],
        armL: [-140.4, 84.6, -8.3], foreL: [-122.9, 13.8, 56.2], clavR: [-5.8, -22.9, -32.9],
        armR: [-153.3, -14.7, 37.1], foreR: [-85.1, -6.6, -5.9], thighL: [-142.2, -27.4, -2.5],
        shinL: [97.4, -14.2, 16], footL: [-7.7, 2.3, 1.5], thighR: [-141.1, 6.1, 35.7],
        shinR: [84.7, 29.3, -17.2], footR: [-4, 6, 6],
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
      root: { p: [-0.022, 0.393, -0.376], r: [-22, 8, 6] },
      j: {
        hips: [11.3, 9, -16.6], spine: [24, -12, 6], chest: [16, -3, 21],
        neck: [26.4, 0.1, 0], head: [-20, 13.3, 0], clavL: [10.5, -4.4, -10.5],
        armL: [-152.8, 34, -50], foreL: [-110.1, -1.3, 0.8], clavR: [10.7, 22.7, -16.1],
        armR: [-95.4, -46.8, 4], foreR: [-107.2, -55.3, -40.3], thighL: [-61.2, 12.8, 24.3],
        shinL: [84, 0.8, -0.7], footL: [-14, 0, 0], thighR: [-66.4, -32.9, -42.9],
        shinR: [81.3, 3.8, -2.1], footR: [-14.6, 0.8, -2.2],
      },
    },
    B: {
      root: { p: [0.06, 0.277, 0.023], r: [-16, 4, 4] },
      j: {
        hips: [-6, -30.7, 3], spine: [-4.1, 2.9, -18.7], chest: [-2.8, -5.5, -49.2],
        neck: [21.6, 5.5, -1.5], head: [20, -15.5, 0], clavL: [-23.6, -4.9, 33.7],
        armL: [-128.5, 11, -37.1], foreL: [-56.1, -6.6, -13.3], clavR: [5.7, 18.4, -34.9],
        armR: [-86.2, -28.5, 32.1], foreR: [-69.6, 0.9, 6.9], thighL: [-54.2, 8.8, 12.5],
        shinL: [89, -0.7, 0.8], footL: [-9.2, -1.5, -0.7], thighR: [-66.2, -2, -14.7],
        shinR: [100.5, 1.6, -5.2], footR: [-6.9, -2.9, -2.1],
      },
    },
  }),

  RNC_WORK2: P('RNC_WORK2', {
    // A переставляет замок выше и заводит вторую руку глубже; B прячет
    // подбородок, вкручивается в душащую руку и упирается пятками.
    name: 'Удушение — перехват выше',
    variantOf: 'RNC',
    A: {
      root: { p: [-0.029, 0.373, -0.403], r: [-26, 8, 8] },
      j: {
        hips: [0.8, -6.7, 0], spine: [22.6, -8.2, -2.2], chest: [-1.4, -12, -1.3],
        neck: [29.1, 3, -0.7], head: [-20.4, 10, -0.7], clavL: [6.6, 1.6, 20.8],
        armL: [-157.9, 48.6, -22.5], foreL: [-120.1, 5.3, 6], clavR: [6.2, -18.5, -28.9],
        armR: [-134.1, -27.2, 62.2], foreR: [-121.5, 0.8, 0], thighL: [-57.5, 28.7, 35.5],
        shinL: [75.8, -3.7, -0.7], footL: [-15.4, -0.7, 0.9], thighR: [-51.7, -18, -30.7],
        shinR: [75.9, -0.7, 0.8], footR: [-14.7, -2.9, -5.9],
      },
    },
    B: {
      root: { p: [-0.011, 0.289, -0.064], r: [-10, 4, 4] },
      j: {
        hips: [-4, 8.7, -10.4], spine: [4, 5.4, -4.4], chest: [-1.5, 17.9, -14.1],
        neck: [-9.2, -13.7, -25.1], head: [-7.6, 23.4, 2.5], clavL: [-14.8, 28.7, 28.1],
        armL: [-134.7, 39.1, -44.5], foreL: [-101.9, -13.6, -1.4], clavR: [8.7, -6.5, 0.1],
        armR: [-118.7, -37.2, 40.6], foreR: [-105.9, -5.9, -0.7], thighL: [-62, 8, 14],
        shinL: [100.8, 0, 0], footL: [-10, 0, 0], thighR: [-59.7, -8, -14],
        shinR: [100, 0, -1.5], footR: [-10, 0, 0],
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
      root: { p: [0.165, 0.509, -0.106], r: [0, 24, 0] },
      j: {
        hips: [-6, -25.5, 12], spine: [25.4, -13.5, 25.7], chest: [1.8, -14.1, 26],
        neck: [14.3, 0, -0.7], head: [-17.4, 0, 0.8], clavL: [-21.6, 12, 35],
        armL: [-124.5, 70.6, 8.2], foreL: [-53.6, 7.7, -7.3], clavR: [28.1, -14.8, -10.3],
        armR: [-25.3, 1.3, -4.6], foreR: [-50.5, 37.8, 43.9], thighL: [-43.6, 11.6, 24.6],
        shinL: [112, -6, 6.8], footL: [10, 0, 0], thighR: [-16.9, 42.6, -10.5],
        shinR: [89, 6.1, -8.9], footR: [0.8, -8.2, 6.8],
      },
    },
    B: {
      root: { p: [-0.104, 0.293, 0.093], r: [-72, 156, -22] },
      j: {
        hips: [30.5, 7, 8.8], spine: [7.9, 31.6, 28.6], chest: [14.4, -7, -28.9],
        neck: [-7.9, 0, -0.7], head: [8, 0, 5.3], clavL: [8.5, 16.8, -27.8],
        armL: [-99, 57.5, -14.5], foreL: [-99.7, -4.8, -4.3], clavR: [3.6, 8.4, -37.9],
        armR: [-15.8, 45.5, 14.3], foreR: [-27.8, 33.2, 13], thighL: [-94.4, 8, 18],
        shinL: [95.8, 1.5, 0], footL: [-14, 0, 0], thighR: [-52.7, -53, -50.8],
        shinR: [80, -0.5, -7.4], footR: [-16.1, -7.5, -2.2],
      },
    },
  }),

  MOUNT_WORK2: P('MOUNT_WORK2', {
    // A уводит одну ногу в обвив и садится на бедро; B ставит раму
    // и подбирает колено, отбирая полугард.
    name: 'Маунт — обвив против креветки',
    variantOf: 'MOUNT',
    A: {
      root: { p: [-0.028, 0.537, 0.108], r: [0, 0, 0] },
      j: {
        hips: [29.1, 24, 4.3], spine: [8.7, 38.4, -28.6], chest: [44.5, -12.6, -24.5],
        neck: [27, -4.5, -1.5], head: [-4, -1.5, 1.5], clavL: [4.7, -23, -38.9],
        armL: [-88.8, 13.1, -26.7], foreL: [-96, 4.8, -5.9], clavR: [0.4, -3.4, 43.6],
        armR: [-103.3, -9.7, 26.3], foreR: [-79.5, -11.6, 2.6], thighL: [-12.6, 29.6, 77.4],
        shinL: [115.3, 0.8, 1.5], footL: [19.6, 0.8, 0], thighR: [24.1, -27.7, -7.2],
        shinR: [83.8, -2.2, -2.2], footR: [18.8, -3.7, 0.8],
      },
    },
    B: {
      root: { p: [0.055, 0.259, 0.255], r: [-90, 180, 0] },
      j: {
        hips: [22, -22.5, -3], spine: [12.8, 13.3, -5.2], chest: [19.1, 13.8, 4.6],
        neck: [4.1, 5.3, 4.5], head: [7.5, 6, 0], clavL: [4.6, -41.8, 13.7],
        armL: [-143.5, 44.9, 10.2], foreL: [-101.8, 23.5, 11.4], clavR: [7.7, 10.7, -42.1],
        armR: [-139.7, 4.9, 9.6], foreR: [-98.5, -11.7, -8.1], thighL: [-36, -10.4, -8.6],
        shinL: [48.7, -2.2, -2.2], footL: [-10.1, 5.4, -4.3], thighR: [-21.1, -5.9, -1.6],
        shinR: [29.1, -0.7, 0], footR: [-14, 0, 0],
      },
    },
  }),

  SIDE_CONTROL_WORK2: P('SIDE_CONTROL_WORK2', {
    // A обходит ногами к голове; B встаёт на мост и вкручивается внутрь,
    // отбирая место под подхват.
    name: 'Сторона — шаг на север-юг',
    variantOf: 'SIDE_CONTROL',
    A: {
      root: { p: [0.329, 0.303, 0.17], r: [10, 128, 0] },
      j: {
        hips: [-38, -46.8, -31.5], spine: [36.2, -12.9, 29.1], chest: [48.8, -9.8, 3.2],
        neck: [10.5, -7.4, -4.2], head: [-25.5, 0, 6], clavL: [-2.8, -38.1, -22.5],
        armL: [-74.5, 40.4, -48], foreL: [-135.5, 10, 7.6], clavR: [27.1, -36.5, -15.4],
        armR: [-21.9, -44.9, 32.8], foreR: [-108.7, 9.9, -4.9], thighL: [-47.3, -3.1, -1.4],
        shinL: [116.4, -17.1, 11.3], footL: [22, 4.5, 6], thighR: [-15.5, -24.1, -7.7],
        shinR: [109.1, 2.3, 2.3], footR: [20.1, 0.1, 3.8],
      },
    },
    B: {
      root: { p: [-0.105, 0.271, -0.034], r: [-90, 180, 0] },
      j: {
        hips: [20, -25.5, 12], spine: [0, -7.2, 6], chest: [14.5, 3.3, 12],
        neck: [3.7, 47.7, -1.2], head: [9.7, 34.3, -0.5], clavL: [-8.8, -5.9, 30.7],
        armL: [-123.7, 22.5, -28.5], foreL: [-71.7, 28.7, 21.9], clavR: [-0.4, -30.7, 17.3],
        armR: [-76, -40.7, 7.8], foreR: [-87.3, 7.8, -20.5], thighL: [-41.2, 6.8, 6.8],
        shinL: [59.3, 0, 0], footL: [-16, 0, 0], thighR: [-38, -3, -5.5],
        shinR: [42.5, 8.3, 0.8], footR: [-15.2, 5.3, 0.9],
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
