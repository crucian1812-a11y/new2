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
      root: { p: [0, 0.84, -0.66], r: [0, 0, 0] },
      j: { ...STANCE_SPINE, ...STANCE_ARMS, ...STANCE_LEGS },
    },
    B: {
      root: { p: [0, 0.84, 0.66], r: [0, 180, 0] },
      j: { ...STANCE_SPINE, ...STANCE_ARMS, ...STANCE_LEGS },
    },
    grips: [],
  }),

  CLINCH: P('CLINCH', {
    name: 'Клинч',
    label: 'CLINCH',
    points: 0, top: null, ground: false,
    A: {
      root: { p: [0.008, 0.821, -0.238], r: [0, 6, 0] },
      j: {
        hips: [-6.2, -6, -5.2], spine: [21.5, 1.5, 0], chest: [16, 0, 6.1], neck: [-21.1, 5.4, 7.1], head: [-2.5, 0, 0],
        clavL: [26.5, 0.8, 26], armL: [-108.4, 49.6, 20.6], foreL: [-142.9, 12.9, 26.5],
        clavR: [5.4, 16.9, 10.5], armR: [-71.7, -22.3, 19.7], foreR: [-64, 0, 1.5],
        thighL: [-26, 12, 6], shinL: [40, 0, 0], footL: [-18, -8, 0],
        thighR: [16, -14, -6], shinR: [30, 0, 0], footR: [-46, 12, 0],
      },
    },
    B: {
      root: { p: [-0.086, 0.788, 0.317], r: [0, 186, 0] },
      j: {
        hips: [-10, -12.7, -1.5], spine: [11, -1.4, 6.8], chest: [5.5, 6, 6.9], neck: [9.7, 0.1, -0.5], head: [-6.1, 0, 1.6],
        clavL: [22.8, -2.2, 24.6], armL: [-93.9, 26.9, 7], foreL: [-114.5, -31.3, -35.1],
        clavR: [0.8, 2.4, 1.3], armR: [-75.3, -22.3, 19.6], foreR: [-57.9, -2.2, 7.6],
        thighL: [-26, 12, 6], shinL: [40, 0, 0], footL: [-18, -8, 0],
        thighR: [16, -14, -6], shinR: [30, 0, 0], footR: [-46, 11.3, 0],
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
      root: { p: [-0.026, 0.514, -0.31], r: [0, 0, 0] },
      j: {
        hips: [16, -23.2, 25.6], spine: [37, 14.4, 13.6], chest: [15.1, -6.6, 8.5], neck: [6.3, 0, 0], head: [-8, 0, 0],
        clavL: [34.7, -7.3, -25], armL: [-12.2, 13.5, 33.5], foreL: [-42.8, -12.4, -35.7],
        clavR: [-24.9, 36, 0.3], armR: [-76.8, -21.3, 26.9], foreR: [-49.5, 12.9, 21.2],
        thighL: [11.1, 8.3, 14], shinL: [93.5, 0, 0], footL: [24, 0, 0],
        thighR: [28.4, -15.7, -26.7], shinR: [92, 0, 0], footR: [24, 0, -0.7],
      },
    },
    B: {
      root: { p: [-0.011, 0.257, -0.04], r: [-90, 180, 0] },
      j: {
        hips: [14.8, 18, 17.3], spine: [13.1, 24, 27.1], chest: [4.8, 9.8, -28.3], neck: [-18.7, 1.6, 0.8], head: [16, -0.7, -0.7],
        clavL: [3.8, 0.1, -3.5], armL: [-88.6, 26.8, -29.7], foreL: [-58.6, 0.8, 0.8],
        clavR: [-32.7, 24.8, -16.3], armR: [-107.3, -34.7, 12.6], foreR: [-79.5, 21.3, 19],
        thighL: [-57.6, 13.1, 9.9], shinL: [139.1, -2.9, -9.9], footL: [-10, 0, 0],
        thighR: [-115.4, 14.2, 5.3], shinR: [151.9, -5.1, 16.2], footR: [-10, -0.7, 0],
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
        hips: [4.3, -0.7, -12.7], spine: [25.6, -15.7, -6.7], chest: [8.8, -1.5, 3.8], neck: [5, 0, 0],
        clavL: [6.8, -10.5, 30.4], armL: [-89.1, 29.1, -20.9], foreL: [-38.4, -5.9, 9.9],
        clavR: [-12.7, 36.8, -19], armR: [-79.3, -12.4, 24.1], foreR: [-47.5, 4.6, -4.4],
        thighL: [-16.7, 6.5, 10.8], shinL: [86, 0, 0], footL: [16, 0, 0],
        thighR: [-42, -8, -8], shinR: [64, 0, 0], footR: [-20, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.254, 0.096], r: [-78, 180, 0] },
      j: {
        hips: [24.8, -6, 0.8], spine: [0.8, -3.7, -11.2], chest: [2.8, 6, -2.2], neck: [-28, 0, 0], head: [18, 0, 0],
        clavL: [-10.4, -22.4, 7.6], armL: [-84.2, 28.6, -25.4], foreL: [-77.2, -5.1, -4.4],
        clavR: [-12.6, 12.8, -6], armR: [-72.9, -25.4, 32.3], foreR: [-79.5, -5.1, -4.4],
        thighL: [-110.7, 16.6, 13.5], shinL: [33.1, -6.7, -2.2], footL: [-24, 0, 0],
        thighR: [-117.5, -0.2, -11.2], shinR: [31.6, 6.8, 2.3], footR: [-20, 0, 0.8],
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
      root: { p: [0.191, 0.51, -0.12], r: [0, 24, 0] },
      j: {
        hips: [-5, -18, 30], spine: [25.3, -18, 27], chest: [-5.7, -19.5, 15.1], neck: [11, 0, -0.7], head: [-10, 0, 0],
        clavL: [-22.4, 12.7, 32.7], armL: [-120.6, 74.7, 11.2], foreL: [-51.8, 5.4, -6.5],
        clavR: [32.3, -21.7, -5.9], armR: [-35.4, 4.2, -5.4], foreR: [-65.6, 43.7, 13.7],
        thighL: [-30.7, 10, 14], shinL: [104.8, 0, 0], footL: [10, 0, 0],
        thighR: [-10.5, 47.9, -9.9], shinR: [92.4, 5.4, -4.4], footR: [18, -0.7, 0],
      },
    },
    B: {
      root: { p: [-0.115, 0.241, 0.055], r: [-72, 156, -22] },
      j: {
        hips: [19, -7.5, -15], spine: [4.3, 23.3, 32.3], chest: [23.4, 6.8, -3.7], neck: [-14.7, 7.5, 0], head: [13.3, 0, 5.3],
        clavL: [13.7, 12.1, -12.4], armL: [-86.3, 44.4, -16.7], foreL: [-100.4, -7.2, -4.3],
        clavR: [7.8, 10, -38.3], armR: [-21.8, 39.4, 13.9], foreR: [-34.6, 34.7, 18.2],
        thighL: [-80, 8.8, 18], shinL: [88, 0, 0.8], footL: [-14, 0, 0.8],
        thighR: [-67.3, -44.1, -28.4], shinR: [78.8, -12.6, 13.5], footR: [-14, 0.8, 0],
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
      root: { p: [0.263, 0.281, 0.28], r: [8, 100, 0] },
      j: {
        hips: [-54, -39.7, -19.5], spine: [45.4, -10.4, 15.4], chest: [38.4, -8.3, 8.1], neck: [19.3, 7.6, 9.8], head: [-11.2, 11.3, 5.3],
        clavL: [-9.6, -33.7, -24.9], armL: [-81.9, 38.8, -50.3], foreL: [-117.4, 18.9, 12.9],
        clavR: [32.4, -23.8, -17.2], armR: [-36.4, -3.7, 36.4], foreR: [-141.5, 13.6, -2.8],
        thighL: [-57.1, 5.8, 6], shinL: [106.9, -8.9, 9.1], footL: [10, -5.2, -5.2],
        thighR: [-7.2, -28.6, -22], shinR: [84.8, 0, 0], footR: [17, 6, 0],
      },
    },
    B: {
      root: { p: [-0.15, 0.275, -0.03], r: [-90, 180, 0] },
      j: {
        hips: [16, -7.5, 6], spine: [-2, -17.2, 6], chest: [9.5, -3.7, 12], neck: [-3.7, 36.1, 10.5], head: [35.5, 20.6, -0.6],
        clavL: [-7.3, -11.9, 16.3], armL: [-127.7, 22.5, -38.4], foreL: [-110.9, 14.4, 3.8],
        clavR: [9.2, -35.2, 17.9], armR: [-69.1, -45.2, -1.2], foreR: [-75.9, 12.2, -5.8],
        thighL: [-28, 6, 13.5], shinL: [44.5, 0, 0], footL: [-16, 0, 0],
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
      root: { p: [0.06, 0.61, 0.045], r: [-6, 100, 0] },
      j: {
        hips: [-31, -24, 4.5], spine: [-6.4, -11.9, 48.8], chest: [-26.9, -2.2, 36.8], neck: [13.5, 0, -0.7], head: [-16, 0, 0],
        clavL: [3.9, 11.4, 8.8], armL: [-52.6, 19.4, -28.4], foreL: [-71.2, -0.7, -2.1],
        clavR: [-5.1, -23.9, 10.7], armR: [-48, 0.4, 30.3], foreR: [-36.1, 33.2, 24.2],
        thighL: [-124, 10, 22], shinL: [58, 0, 0], footL: [8, 0, 0],
        thighR: [-13.5, -17, -50], shinR: [22.1, 3.1, -17.2], footR: [-30, -0.7, 0],
      },
    },
    B: {
      root: { p: [-0.155, 0.261, 0.023], r: [-90, 180, 0] },
      j: {
        hips: [16, 52.5, -10.5], spine: [-21.5, -3.7, 15], chest: [0.5, 27, 31.5], neck: [-16, 0, 0], head: [12, -25.5, 0],
        clavL: [1.5, 19.5, 32.6], armL: [-119.4, 47.3, -29.9], foreL: [-83.2, -4.5, -2.2],
        clavR: [-20.1, -13.4, -35.1], armR: [-69.9, -29.9, 26.1], foreR: [-78, 0, 0],
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
      root: { p: [0.001, 0.559, 0.089], r: [0, 0, 0] },
      j: {
        hips: [45.9, 24, -4.5], spine: [7.5, 30.9, -32.1], chest: [37, -19.3, -20.8], neck: [12.8, 0.8, 0.8], head: [-9.2, 0.8, 0.8],
        clavL: [11.4, -16.2, -20.9], armL: [-100, 13.1, -26.7], foreL: [-82.5, 4.8, 1.6],
        clavR: [19.1, 2.5, 41.3], armR: [-82.1, -5.3, 36.7], foreR: [-102.8, 9.1, 6.9],
        thighL: [-4.7, 14.5, 78.5], shinL: [98, 0, 0], footL: [18, 1.5, 0],
        thighR: [3, -14.3, -1], shinR: [98, 0, 0], footR: [17.3, 0, 0],
      },
    },
    B: {
      root: { p: [0.02, 0.266, 0.255], r: [-90, 180, 0] },
      j: {
        hips: [22.3, -27.5, -18], spine: [6, -8.9, -7.4], chest: [16.1, 11.3, 23.3], neck: [-5, 0, -3], head: [14, 0, 3],
        clavL: [-0.8, -41.2, 13.2], armL: [-157.3, 47.1, 11.6], foreL: [-116.1, 19, 8.4],
        clavR: [22.7, 25.6, -18.2], armR: [-176.8, 13.9, 29.9], foreR: [-83.1, -8.8, -5.1],
        thighL: [-23.8, -8.1, -8.6], shinL: [32.7, 0.8, 0], footL: [-13.2, 0, 0],
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
      root: { p: [0.008, 0.331, -0.47], r: [-22, 8, 6] },
      j: {
        hips: [12.8, -3, -24.6], spine: [10, -18, 3], chest: [14, 0, 10.5], neck: [22.8, 0, 3], head: [-12, 8, 0],
        clavL: [3, -4.4, 9.6], armL: [-144.9, 24, -50], foreL: [-80.6, -1.3, 6.8],
        clavR: [15.1, 19.7, -6.4], armR: [-94, -27.6, 7.6], foreR: [-121.4, -50.9, -39.6],
        thighL: [-70, 12.8, 23.6], shinL: [76, -3.7, 0], footL: [-14.7, 0, -0.7],
        thighR: [-67.7, -21, -31.7], shinR: [76, -6.7, 5.3], footR: [-13.2, 0.8, 0.8],
      },
    },
    B: {
      root: { p: [0.03, 0.299, -0.06], r: [-16, 4, 4] },
      j: {
        hips: [-14, -23.9, -4.5], spine: [5.3, -4.4, -6], chest: [-9.4, -6.6, -47.9], neck: [-8.2, 0, -0.7], head: [6, 0, 3],
        clavL: [-26.1, 1.6, 22.2], armL: [-137.6, 10.2, -34.9], foreL: [-64.4, -0.7, -11.8],
        clavR: [8.3, 18.7, -35.4], armR: [-97, -33.8, 30.6], foreR: [-83.2, 3.9, 9.1],
        thighL: [-56, 8, 14], shinL: [86, -1.5, 0], footL: [-10, 0, 0],
        thighR: [-56, -8, -14], shinR: [86, 0, 0], footR: [-10, 0, 0],
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
      root: { p: [0.024, 0.536, -0.467], r: [10, 14, 0] },
      j: {
        hips: [-6, 18.8, 38.4], spine: [41.8, 21.1, 18], chest: [40.6, 6.6, -1.2], neck: [19.8, 1.5, 3], head: [-14.9, 1.5, 2.3],
        clavL: [30, -21.6, 21.7], armL: [-31, 4.6, -41], foreL: [-79.8, 6.9, 10.5],
        clavR: [-11.9, 19.5, -40.8], armR: [-110.7, -13.1, 49.1], foreR: [-10.7, 4, -31.5],
        thighL: [-40, 4, 14], shinL: [104, 0, 0], footL: [8, 0, 0],
        thighR: [-8, -6, -3], shinR: [91, 3, 1.5], footR: [17, 1.5, 6],
      },
    },
    B: {
      root: { p: [-0.176, 0.304, 0.12], r: [64, 176, 0] },
      j: {
        hips: [3, 21.8, 12.9], spine: [-32.3, 19.9, 27.4], chest: [-32.8, 37.7, -24.1], neck: [-12.4, 12, 21.8], head: [25.5, 3.8, 3],
        clavL: [13.6, 17.5, -25.6], armL: [-64.7, 22.8, -26.5], foreL: [-116, -4.5, -0.7],
        clavR: [29, -26.8, 15.1], armR: [-12.1, 4.3, 33.3], foreR: [-105.5, 2.3, 6.8],
        thighL: [53.7, 46.6, 56.1], shinL: [150.4, -11.9, 11.3], footL: [15.1, 2.3, 2.3],
        thighR: [40.2, 7, -58.1], shinR: [151.2, 27.1, -5.9], footR: [14.3, 2.3, 0.8],
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
      root: { p: [0.008, 0.362, -0.408], r: [-26, 8, 8] },
      j: {
        hips: [-6, -12.7, -10.5], spine: [18, -6, 0], chest: [-7.9, -10.5, 8.3], neck: [18, 0, 0], head: [-14, 10, 0],
        clavL: [6.8, 0.8, 24.5], armL: [-159.9, 39.8, -31.6], foreL: [-133.2, 1.5, 1.5],
        clavR: [5.3, -13.3, -30.6], armR: [-122.6, -27.2, 57.1], foreR: [-130.1, 2.3, -0.7],
        thighL: [-74, 15.8, 24.8], shinL: [72, 0, 0], footL: [-14, 0, 0],
        thighR: [-75.5, -16.5, -24], shinR: [75.8, 0, 0], footR: [-14, -0.7, 0.8],
      },
    },
    B: {
      root: { p: [-0.026, 0.382, -0.06], r: [-10, 4, 4] },
      j: {
        hips: [-6, -0.7, -12.7], spine: [-10, -5.2, 0], chest: [-2.2, 16.6, -14.2], neck: [-17, -17.2, -24.5], head: [-8.8, 28, 2.4],
        clavL: [-15.6, 18.1, 23.5], armL: [-143.2, 39.8, -42.4], foreL: [-118.7, -8.8, -0.7],
        clavR: [6.3, -5.9, -3.1], armR: [-130.3, -40.3, 38.9], foreR: [-117.2, -5.9, -1.5],
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
      root: { p: [-0.389, 0.248, 0.398], r: [-90, 90, 0] },
      j: {
        hips: [16, -6, 3.1], spine: [17.7, 10.9, 33.8], chest: [21.5, -2.2, 18.8], neck: [-14.5, 0, -1.5], head: [21.3, 0.8, 0.8],
        clavL: [-23.8, -22.2, 36.5], armL: [-117.7, 22.8, -36.2], foreL: [-78.7, -7.5, -0.7],
        clavR: [-2.2, 18.8, -27.4], armR: [-111, -26.5, 34], foreR: [-104.9, -3, 0.1],
        thighL: [-44.1, 0, 52.9], shinL: [13.1, 3.9, -3.7], footL: [-10.5, 1.5, 1.5],
        thighR: [-12, -8.9, -24], shinR: [49.5, -8.2, -1.5], footR: [-13.5, -1.5, 0],
      },
    },
    B: {
      root: { p: [-0.015, 0.222, 0.02], r: [-90, 180, 0] },
      j: {
        hips: [4.5, 13.6, 0], spine: [15.3, 9.8, 0], chest: [6, 9.8, 12.8], neck: [-12.5, 1.5, 0], head: [11.5, 1.5, 1.5],
        // The trapped arm reaches across to A's chest, which is what pulls it
        // straight; the free one is stacked under him where it can do nothing.
        clavL: [6.8, -3.7, 42.5], armL: [-88.7, 44, -15.7], foreL: [-31.2, 4.6, 0.8],
        clavR: [25.8, 22.7, -21.6], armR: [-50.3, -17.6, 27.2], foreR: [-59.8, 9.2, 6.9],
        thighL: [-12.2, 15.1, 13], shinL: [42.8, 0, 0], footL: [-12, 0, 0],
        thighR: [-16.9, -6, -6.5], shinR: [38, 0, 0], footR: [-12, 0, 0],
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
      root: { p: [0.053, 0.508, -0.257], r: [30, 0, 0] },
      j: {
        hips: [8, 12, -4.5], spine: [0.5, 10.5, 6], chest: [9.1, 15, 23.3], neck: [19.8, 6.8, -6.7], head: [-19.5, -2.2, 0],
        clavL: [3.6, -3.9, 44.6], armL: [-163.4, 0.8, -55], foreL: [-46.6, -11.1, -26.2],
        clavR: [-11, 18.8, -22.5], armR: [-91.2, -30.4, 34.5], foreR: [-55.6, 9.1, 12.1],
        thighL: [7.1, 29.9, 10.8], shinL: [96, 0, 0], footL: [20, 0, 0],
        thighR: [-0.3, -6.4, -12.2], shinR: [97.5, 0, 0], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [0.004, 0.293, 0.115], r: [-64, 180, 0] },
      j: {
        hips: [20.8, 6, -12], spine: [-1.7, -37.5, -30.7], chest: [-13.5, 12.1, 9.2], neck: [-31.5, 0, 0.8], head: [20, 0.8, 0],
        clavL: [18.8, -7.3, 36.3], armL: [-102.3, 33.2, -29.4], foreL: [-98.8, 20.4, 15.2],
        clavR: [0.8, 15.1, -15.1], armR: [-92.7, -24, 34], foreR: [-84, 0, 0],
        thighL: [-144, 8, 5.4], shinL: [126.8, -14.2, 13.6], footL: [-10, 0.8, -0.7],
        thighR: [-47.9, -5.1, -20.4], shinR: [149.8, -1.4, 9.3], footR: [-10, 0, 0],
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
        hips: [-35.5, -14.2, -12.7], spine: [33.3, -14.9, 10.5], chest: [32.1, -12, -2.2], neck: [27, 0, 0], head: [-28, 0, 0],
        clavL: [-0.7, 7.6, -44.1], armL: [-72.6, 31.1, -48.5], foreL: [-113.7, 0.1, 0],
        clavR: [-35.8, -2.8, -9], armR: [-77.9, -47.9, 36.3], foreR: [-116.4, 0, 0],
        thighL: [-56, 14, 20], shinL: [108, 0, 0], footL: [14, 0, 0],
        thighR: [-18, 8.8, -22], shinR: [101.8, 1.5, -1.5], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.157, 0.271, -0.011], r: [-90, 180, 8] },
      j: {
        hips: [12.3, 12, 6], spine: [-7.2, 7.5, 6], chest: [0.1, 6.1, 6], neck: [-35.4, -0.7, 0.1], head: [1.5, -27.5, 5.3],
        clavL: [-3.9, 15, 41.1], armL: [-152.9, 59.6, -54.6], foreL: [-95.4, -8.9, -3.7],
        clavR: [-23.6, -32.8, -14.6], armR: [-58.7, -19.7, 33], foreR: [-72, 0, 0],
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
      root: { p: [0.041, 0.349, -0.374], r: [50, 0, 0] },
      j: {
        hips: [-1.9, -11.2, -6], spine: [16, -0.7, -6], chest: [11.8, -14.2, -3], neck: [-43, -13.4, -8.8], head: [-26.5, 4.1, -16.2],
        clavL: [-35.3, -26.8, 6], armL: [-114.7, 101, 44.6], foreL: [-73.5, 21.3, 49.6],
        clavR: [37.7, 24, 11.5], armR: [-43.6, -52.5, -22.4], foreR: [-18.7, 9.3, -29],
        thighL: [11.8, 13.3, 21.2], shinL: [97.3, 0, 0], footL: [20, 0, 0],
        thighR: [3.6, -8, -10.5], shinR: [98.8, 0, -0.7], footR: [20, 0, 0.8],
      },
    },
    B: {
      root: { p: [0, 0.307, 0.171], r: [-56, 180, 0] },
      j: {
        hips: [21.3, 23.3, 18.1], spine: [-0.7, -20.9, -12.6], chest: [-6.4, -13.5, -13.5], neck: [-15.2, -0.7, -0.7], head: [16.8, 0.8, 0],
        clavL: [15.8, 13.5, 24], armL: [-133, 58.9, -16.6], foreL: [-123.7, 16.6, 52.6],
        clavR: [-12.6, -6.6, -33.8], armR: [-143.9, -7.2, 49.6], foreR: [-81.6, -8.1, -11.9],
        thighL: [-144.2, -6.6, -9.4], shinL: [91.5, -15.6, 14.5], footL: [-8.5, 0, 0],
        thighR: [-143.1, 2.5, 28.8], shinR: [87.7, 24, -27.7], footR: [-10, 0, 0],
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
      root: { p: [0.22, 0.51, 0.2], r: [16, 62, 0] },
      j: {
        hips: [-35.2, -3.7, 2.8], spine: [38.3, -14.3, 9.2], chest: [39.7, -27.5, 8.1],
        neck: [22, 6, -6], head: [-24, 0, 0], clavL: [-17.7, -24.2, -25.2],
        armL: [-81, 45.3, -44.5], foreL: [-98, 8, 6], clavR: [6.8, -33, -30.7],
        armR: [-47.5, -32.5, 31.3], foreR: [-111.2, 10.5, -6.5], thighL: [-64, 14, 18],
        shinL: [96, 0, 0], footL: [14, 0, 0], thighR: [-13, -47, -1.7],
        shinR: [77.3, 12, -12.7], footR: [18, 3, 0],
      },
    },
    B: {
      root: { p: [-0.13, 0.257, 0.01], r: [-90, 180, 0] },
      j: {
        hips: [22, -2, 6], spine: [-2, 0, 7.5], chest: [2.8, -11.5, 18],
        neck: [1.3, 46.5, 13.8], head: [32.3, 14.3, -6.7], clavL: [-19.7, -3.7, 17],
        armL: [-133.2, 23.5, -38], foreL: [-111.7, 9, 4], clavR: [5.8, -24, 15.3],
        armR: [-51, -32, 11], foreR: [-76, 6, -6], thighL: [-28, 6, 12],
        shinL: [46, 0, 0], footL: [-16, 6, 0], thighR: [-16, -6, -10],
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
      root: { p: [0.07, 0.564, 0.05], r: [6, 46, 0] },
      j: {
        hips: [25, 8, 6], spine: [42.8, -2, -14], chest: [34.8, -14.7, -4],
        neck: [14.8, 0, 0], head: [-14, 0, 0], clavL: [1.3, -24.4, -28.2],
        armL: [-81.4, 11, -35.5], foreL: [-96, 7.5, 4], clavR: [4, 10, 27.5],
        armR: [-105.7, 11.8, 53.8], foreR: [-100.2, 17.8, 25.8], thighL: [-22, 12, 62],
        shinL: [96, 0, 0], footL: [14, 0, 0], thighR: [-86.2, 10.1, -13.2],
        shinR: [54, 6, -3.7], footR: [10, 0, 0],
      },
    },
    B: {
      root: { p: [0.05, 0.269, 0.234], r: [-90, 180, 0] },
      j: {
        hips: [24.5, -8, -17.2], spine: [12, -5.9, -1.4], chest: [18.3, 26.3, 12.1],
        neck: [-20, 0, 0], head: [14, 0, -0.7], clavL: [-6.8, -41.2, 7.9],
        armL: [-151.3, 44.1, 11.6], foreL: [-122.1, 9.2, 7.6], clavR: [17.4, 23.3, -16.7],
        armR: [-186.6, 4.1, 24.6], foreR: [-92.9, 2.4, 0.1], thighL: [-17.1, -12.6, -10.1],
        shinL: [33.4, 0, 0], footL: [-14, 0, 0], thighR: [-29.8, -5.9, -1.6],
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
      root: { p: [0.27, 0.422, 0.26], r: [10, 104, 0] },
      j: {
        hips: [-42, -50, 6], spine: [45.2, -22.8, -1.1], chest: [44.8, -17.9, 8.9],
        neck: [16, 8, -6], head: [-26, 0, 0], clavL: [-15.5, -36, -17.7],
        armL: [-87.2, 42, -50], foreL: [-119.7, 5.8, 2.3], clavR: [18, -37, -9],
        armR: [-44, -33, 39.3], foreR: [-120, 4.5, -9.5], thighL: [-24, 8, 40],
        shinL: [34.5, 0, 0], footL: [10, 0, 0], thighR: [-12, -8, -40],
        shinR: [32, 1.5, -6], footR: [8.5, 0, 0],
      },
    },
    B: {
      root: { p: [-0.12, 0.277, 0], r: [-90, 180, 0] },
      j: {
        hips: [16, -7.5, 6], spine: [-2, -5.2, 6], chest: [8, -11.2, 12],
        neck: [-2.2, 42.9, 10.5], head: [24.3, 28.9, -12.6], clavL: [-25.3, -3.6, 17],
        armL: [-139.7, 27.8, -35.4], foreL: [-108.6, 1.6, 3.8], clavR: [4.6, -21, 7.4],
        armR: [-51.1, -36.2, 10.8], foreR: [-75.9, 6.2, -5.8], thighL: [-28, 6, 12],
        shinL: [46, 0, 0], footL: [-16, 0, 0], thighR: [-16, -6, -10],
        shinR: [35.5, 0, 0], footR: [-16, 0, 0],
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
      root: { p: [0.023, 0.327, -0.445], r: [-22, 8, 6] },
      j: {
        hips: [3, -6.7, -29.1], spine: [24, -16.5, 3], chest: [22, -5, 18],
        neck: [26, 0, 1.5], head: [-12, 11, 0], clavL: [-2.2, 2.4, 24.6],
        armL: [-128.4, 32.3, -50], foreL: [-86.9, -2.8, -9.7], clavR: [24.8, 21, -27.5],
        armR: [-97.7, -31.3, 3.2], foreR: [-129.6, -65.2, -46.4], thighL: [-77, 16.6, 27.3],
        shinL: [81.8, 0.8, 0], footL: [-14, 0, 0], thighR: [-77, -15, -25],
        shinR: [81, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0, 0.297, -0.05], r: [-16, 4, 4] },
      j: {
        hips: [-8, -19.5, -4.5], spine: [2.8, -15, -6], chest: [-5.7, -4.5, -46.5],
        neck: [-2.7, -6.7, -2.2], head: [13, -8, 0], clavL: [-21.6, 10.6, 19.9],
        armL: [-143.9, 14.7, -31.9], foreL: [-52.4, 2.3, -12.6], clavR: [6.6, 18.1, -36.5],
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
      root: { p: [0.004, 0.39, -0.409], r: [-26, 8, 8] },
      j: {
        hips: [-6, -12.7, -10.5], spine: [24, 0, 7.6], chest: [-13.9, -10.5, 0.1],
        neck: [25, 0, 0], head: [-21, 10, 0], clavL: [8.3, -0.7, 18.6],
        armL: [-164.4, 39.8, -35.3], foreL: [-134.7, 1.5, 1.5], clavR: [5.3, -12.5, -31.3],
        armR: [-122.6, -27.2, 57.1], foreR: [-135.3, 3.1, -0.7], thighL: [-74, 15.8, 24.8],
        shinL: [72, 0, 0], footL: [-14, -0.7, 0], thighR: [-75.5, -16.5, -25.5],
        shinR: [75.8, 0.8, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.026, 0.382, -0.062], r: [-10, 4, 4] },
      j: {
        hips: [-2, -2.2, -12.7], spine: [-11, -5.9, 2.3], chest: [3.3, 18.1, -12.7],
        neck: [-25.2, -21.7, -29], head: [-8.7, 27.2, 1.6], clavL: [-17.1, 18.8, 21.3],
        armL: [-143.9, 39.9, -40.8], foreL: [-124.7, -8.1, -0.7], clavR: [5.6, -8, -0.8],
        armR: [-130.3, -41, 35.2], foreR: [-123.2, -6.6, -1.5], thighL: [-52, 8, 14],
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
      root: { p: [0.172, 0.5, -0.145], r: [0, 24, 0] },
      j: {
        hips: [7.9, -2.2, 36], spine: [17.8, -18.7, 21.8], chest: [-6.5, -26.2, 3.8],
        neck: [12.5, 0, 2.3], head: [-10, 0, 0], clavL: [-17.6, -0.6, 39.1],
        armL: [-113.1, 57.4, 2.9], foreL: [-62.2, 1.7, -5.7], clavR: [33, -24, -7.4],
        armR: [-29.4, 4.8, 8.1], foreR: [-67.2, 50.5, 12.2], thighL: [-30.7, 20.5, 22.3],
        shinL: [104, 0, 0], footL: [10, 0, 0.8], thighR: [-21.5, 48.2, -20.5],
        shinR: [102.1, 2.3, -3.7], footR: [18, 0, -0.7],
      },
    },
    B: {
      root: { p: [-0.069, 0.265, 0.08], r: [-72, 156, -22] },
      j: {
        hips: [7, -0.7, 5.3], spine: [-3.2, 18.1, 36.1], chest: [24.9, 5.6, -1.5],
        neck: [-26, 0, 0], head: [14, 3, 7.5], clavL: [11.6, 18.9, -18.3],
        armL: [-88.7, 45.9, -17.5], foreL: [-93.7, -6.3, -3.5], clavR: [2.2, 10.2, -41.6],
        armR: [-28, 30.3, 2.8], foreR: [-24.8, 42.9, 18.3], thighL: [-79, 8, 18],
        shinL: [88, 0, 0], footL: [-14, 0, 0], thighR: [-68, -45.6, -29.2],
        shinR: [83.4, -14.1, 14.3], footR: [-14, 0, 0],
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
      root: { p: [0.042, 0.546, 0.075], r: [0, 0, 0] },
      j: {
        hips: [62.4, 10.5, -12], spine: [-15.7, 35.7, -32.4], chest: [44, -24.4, -7.8],
        neck: [15, 0, 0], head: [-7, 0, -3], clavL: [7, -17, -24.6],
        armL: [-80.3, 4.1, -31.9], foreL: [-86.3, 13.9, 7.1], clavR: [17.7, 2.3, 32.1],
        armR: [-82, -9, 31.5], foreR: [-108, 9.2, 8.5], thighL: [-9.9, 16.8, 85.8],
        shinL: [103, 0, 0], footL: [18, 0, 0], thighR: [-9.7, -4.4, -0.8],
        shinR: [103, 0, 0], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [0.042, 0.254, 0.234], r: [-90, 180, 0] },
      j: {
        hips: [18, -17, -6], spine: [-4, -0.7, -11.9], chest: [19.8, 11.3, 23.3],
        neck: [-17, 0, 0], head: [14, 0, 0], clavL: [-2, -36.7, 16.8],
        armL: [-164, 61.4, 1.1], foreL: [-113.1, 9.2, 6.1], clavR: [6.1, 10.6, -24.9],
        armR: [-212.8, 11, 20.8], foreR: [-84.5, 19.6, 5.3], thighL: [-27.6, -17.1, -18.4],
        shinL: [42.2, 0, 0.8], footL: [-14, 0, 0], thighR: [-35.1, -8.2, -2.4],
        shinR: [42.1, -0.7, -6], footR: [-14, 0, 0],
      },
    },
  }),

  SIDE_CONTROL_WORK: P('SIDE_CONTROL_WORK', {
    // A меняет бедро и вжимает плечо в челюсть; B ставит раму и
    // подтягивает колено, чтобы креветкой уйти.
    name: 'Сторона — смена бедра',
    variantOf: 'SIDE_CONTROL',
    A: {
      root: { p: [0.294, 0.293, 0.262], r: [8, 100, 0] },
      j: {
        hips: [-42, -17.2, -23.2], spine: [36.5, -19.6, 12.9], chest: [32.8, -28.7, 13.1],
        neck: [16.3, 7.5, 2.3], head: [-36, 0, -5.2], clavL: [-12.6, -23.1, -20.3],
        armL: [-90.6, 45.6, -49.6], foreL: [-121.9, 15.1, 13.6], clavR: [24.8, -17.9, -13.4],
        armR: [-44.7, -10.5, 36.4], foreR: [-147.5, 6.1, -8.1], thighL: [-45.1, -3.2, 9.8],
        shinL: [115.1, -9.7, 6.8], footL: [16.8, 0.8, 1.5], thighR: [-9.7, -19.6, -14.5],
        shinR: [89.3, 0.8, 2.3], footR: [20.8, 0.8, 3],
      },
    },
    B: {
      root: { p: [-0.09, 0.258, -0.06], r: [-90, 180, 0] },
      j: {
        hips: [16, -1.5, 6], spine: [-2, -29.2, 6], chest: [2, -3.7, 12],
        neck: [14.3, 46.6, 20.3], head: [40, 19.9, -2.1], clavL: [-12.5, -5.9, -4],
        armL: [-123.9, 22.5, -38.4], foreL: [-116.9, 9.1, 3.8], clavR: [9.2, -26.9, 4.4],
        armR: [-66.3, -37.7, 4.8], foreR: [-75.2, 5.4, -5.1], thighL: [-36.2, 6.8, 12.8],
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
      root: { p: [0, 0.79, -0.57], r: [0, -5, 0] },
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
      root: { p: [0.1, 0.805, 0.61], r: [0, 186, 0] },
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
      root: { p: [0, 0.81, -0.234], r: [0, 6, 0] },
      j: {
        hips: [-11.5, -10, -0.7], spine: [19.5, 3.5, -4.5], chest: [15.3, 0, 10.6],
        neck: [-24.3, 6.2, 7.9], head: [2, 0, 0.8], clavL: [22.7, -6.7, 23.8],
        armL: [-95.7, 43.6, 14.6], foreL: [-128.4, 15.2, 25.8], clavR: [21.4, 28.2, 18.8],
        armR: [-93.7, -33, 27.7], foreR: [-88, -0.7, 9.5], thighL: [-34, 12, 5.3],
        shinL: [48, 0, 0], footL: [-18, -8, 0], thighR: [16, -14, -6],
        shinR: [30, 0, 0], footR: [-46, 12, 0],
      },
    },
    B: {
      root: { p: [-0.118, 0.778, 0.281], r: [0, 186, 0] },
      j: {
        hips: [-10, -14.7, 6], spine: [15.8, -1.4, 0.8], chest: [5.8, 3, 5.4],
        neck: [7.8, -1.3, 0.3], head: [-11.4, 0, 1.6], clavL: [29.6, 2.3, 26.4],
        armL: [-84.6, 36.2, 8.5], foreL: [-95.9, -30.5, -33.6], clavR: [8.1, 0.2, 4.3],
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
      root: { p: [-0.06, 0.507, -0.357], r: [0, 0, 0] },
      j: {
        hips: [24, -24.7, 32.4], spine: [37.3, 12.9, 15.1], chest: [13.1, -7.4, 19.7],
        neck: [1, 0, 0], head: [-2.7, 0, 0], clavL: [30.9, -5.8, -25.8],
        armL: [-26.2, 12.7, 33.5], foreL: [-57.6, -13.2, -28.2], clavR: [-19.1, 38.1, 8.6],
        armR: [-86.9, -19.1, 35.2], foreR: [-34, 5.4, 21.9], thighL: [16.3, 9.1, 13.3],
        shinL: [92, 0, 0.8], footL: [24, 0, 0], thighR: [29.1, -15.7, -26.7],
        shinR: [92, 0, 0], footR: [24, 0, 0],
      },
    },
    B: {
      root: { p: [-0.001, 0.276, -0.04], r: [-84, 168, 0] },
      j: {
        hips: [18.3, 30, 12], spine: [10.1, 26.6, 15.9], chest: [6.5, 12.7, -26.7],
        neck: [-17.2, -0.7, 0], head: [10, 0.8, 0], clavL: [2.3, -0.7, -7.2],
        armL: [-99, 29.6, -30.4], foreL: [-75.4, 1.6, 1.6], clavR: [-35, 24.8, -20.1],
        armR: [-118, -34.7, 8.9], foreR: [-79, 19.1, 15.3], thighL: [-63.8, 16.1, 5.4],
        shinL: [149.1, -2.9, -10.7], footL: [-10, 0, 0], thighR: [-120.6, 23.9, 5.3],
        shinR: [144.8, 0.2, 11.7], footR: [-10, 0, 0],
      },
    },
  }),

  OPEN_GUARD_WORK: P('OPEN_GUARD_WORK', {
    // B выпрямляет ноги и отталкивает A от себя, дотягивая рукава;
    // A садится ниже и сбивает колени вниз.
    name: 'Открытый гард — толчок стопами',
    variantOf: 'OPEN_GUARD',
    A: {
      root: { p: [-0.053, 0.6, -0.538], r: [0, 0, 0] },
      j: {
        hips: [4.3, 6.1, -18.7], spine: [29.6, -8.2, -0.7], chest: [22, 1.5, 3.8],
        neck: [20.8, 0, 0], clavL: [0.8, -4.5, 18.4], armL: [-96.3, 35.9, -20.9],
        foreL: [-28.7, -6.7, 6.2], clavR: [-12.7, 35.3, -20.5], armR: [-87.3, -21.4, 25.6],
        foreR: [-40, -9, -4.4], thighL: [-30.5, 5, 10], shinL: [98, 1.5, 0],
        footL: [16, 0, 0], thighR: [-39.5, -8.7, -9.5], shinR: [74.8, 0, -3],
        footR: [-20, 0, 0],
      },
    },
    B: {
      root: { p: [0.015, 0.294, 0.066], r: [-78, 180, 0] },
      j: {
        hips: [32.8, -6, 0.8], spine: [6.8, -3.7, -17.2], chest: [6.8, 3, 3.8],
        neck: [-20, 0, 0], head: [12, 0, 0], clavL: [-1.4, -20.9, 3.1],
        armL: [-93.7, 27.1, -25.4], foreL: [-93.9, -5.1, -4.4], clavR: [-11.1, 19.5, -4.5],
        armR: [-84.9, -30.7, 32.3], foreR: [-90.5, -4.4, -4.4], thighL: [-95.7, 18.1, 14.3],
        shinL: [18.1, 1.6, 0.1], footL: [-24, 0, 0], thighR: [-101.5, -7.7, -11.2],
        shinR: [21.9, 5.3, 2.3], footR: [-20, 0, -3],
      },
    },
  }),

  KNEE_ON_BELLY_WORK: P('KNEE_ON_BELLY_WORK', {
    // A переносит колено дальше поперёк и шире ставит опорную ногу;
    // B ставит раму в колено и подбирает своё, чтобы креветкой уйти.
    name: 'Колено на животе — вес вниз',
    variantOf: 'KNEE_ON_BELLY',
    A: {
      root: { p: [0.058, 0.606, 0.071], r: [-6, 100, 0] },
      j: {
        hips: [-30.7, -20.2, 4], spine: [-4.3, -15.3, 45.7], chest: [-17.2, -2.2, 42.1],
        neck: [18.3, -0.7, -0.7], head: [-16, 0, 0], clavL: [5.4, 12.9, 10.3],
        armL: [-59.6, 17.9, -28.4], foreL: [-84.7, -0.7, -2.1], clavR: [-5.9, -17.9, 6.3],
        armR: [-56.7, -1.8, 38.6], foreR: [-50.8, 31, 24.2], thighL: [-108, 16, 22],
        shinL: [48, 0, 0], footL: [8, 0, 0], thighR: [-32.7, -22.2, -54.2],
        shinR: [30.7, 3.1, -19.5], footR: [-30, 0, 0],
      },
    },
    B: {
      root: { p: [-0.165, 0.253, 0.053], r: [-90, 180, 0] },
      j: {
        hips: [11.3, 55.6, -5.2], spine: [-15.5, -10.1, 15], chest: [5.3, 29.1, 26.3],
        neck: [-22, 0, 0], head: [20, -24, 0], clavL: [1.5, 21, 28.2],
        armL: [-100.1, 46.1, -24.6], foreL: [-95.7, -4.5, -4.4], clavR: [-22.3, -13.3, -32.8],
        armR: [-61.4, -23.1, 26.9], foreR: [-90, 0, 0], thighL: [-50, 6, 12],
        shinL: [68, 0.8, 0], footL: [-16, 0.8, 0], thighR: [-20, -6, -10],
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
      root: { p: [0.049, 0.582, -0.508], r: [10, 26, 0] },
      j: {
        hips: [8.3, 34.1, 25], spine: [47.1, 14.8, 12.8], chest: [42.8, -6, -1.5],
        neck: [15.3, 0.8, 1.5], head: [-15.7, 2.3, 0.8], clavL: [29.2, -20.3, 23.5],
        armL: [-39.5, 29.4, -41], foreL: [-73.1, 34.6, 32.3], clavR: [-14.2, 33.8, -31],
        armR: [-106.7, -11.6, 69.9], foreR: [-42.7, -22.2, -18.7], thighL: [-33, 10, 17],
        shinL: [96, 3, 0], footL: [11, 0, 3], thighR: [-44, -16, -16],
        shinR: [90, 3, -3], footR: [14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.044, 0.264, 0.07], r: [64, 176, 0] },
      j: {
        hips: [9, 15.8, 17.4], spine: [-34.8, 11.2, 30.3], chest: [-39.4, 31.4, -25],
        neck: [-28.7, 0, 0.8], head: [32, -0.7, 4.5], clavL: [1.7, 40.8, 20.1],
        armL: [-87.6, 28.9, -13.7], foreL: [-126, 0, 0], clavR: [35.3, -24.3, 8.9],
        armR: [-22.1, -0.2, 30.3], foreR: [-114, 3.8, 5.3], thighL: [47.5, 48.9, 43.4],
        shinL: [154.1, -2.8, 22.8], footL: [27.1, -0.7, -0.7], thighR: [24.9, 1.7, -52.9],
        shinR: [153.9, 27.8, -2.2], footR: [12, 0, 0],
      },
    },
  }),

  ARMBAR_WORK: P('ARMBAR_WORK', {
    // A сводит колени и поднимает таз; B доворачивает большой палец вверх
    // и тянется свободной рукой на замок — рука при этом остаётся прямой.
    name: 'Рычаг локтя — сведение колен',
    variantOf: 'ARMBAR',
    A: {
      root: { p: [-0.408, 0.241, 0.36], r: [-90, 90, 0] },
      j: {
        hips: [9.6, -6, 12.1], spine: [7.5, 24.1, 43.5], chest: [20, -5.1, 26.4],
        neck: [-10, 0, -2.2], head: [23.5, -1.5, 0], clavL: [-20.9, -20.1, 35.1],
        armL: [-110.2, 15.3, -38.4], foreL: [-88.2, -6, -0.7], clavR: [-5.2, 5.3, -21.4],
        armR: [-108.2, -14.5, 40], foreR: [-114.6, -1.5, 6.1], thighL: [-36.4, 1.5, 45.1],
        shinL: [21.6, 0.1, -2.2], footL: [-13.5, -1.5, -1.5], thighR: [-15.5, -6.7, -23.7],
        shinR: [34, -7.5, -1.5], footR: [-13.5, -1.5, -1.5],
      },
    },
    B: {
      root: { p: [-0.041, 0.23, -0.044], r: [-90, 180, 0] },
      j: {
        hips: [17.8, 0.9, 6], spine: [10.1, 27.6, 0], chest: [13.3, 6.6, 6.1],
        neck: [-1.2, 0.8, -2.2], head: [4.8, 0.8, -2.2], clavL: [19.3, 8.3, 41.4],
        armL: [-78.7, 49.8, -12], foreL: [-54.4, -5.9, 14.8], clavR: [26.6, 19.7, -23.1],
        armR: [-59.6, -19.9, 26.5], foreR: [-74, 8.5, 6.9], thighL: [-17.2, 18.1, 14.6],
        shinL: [58.3, 0, 0], footL: [-12, 0, 0], thighR: [-15.4, -6, -8],
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
      root: { p: [-0.007, 0.474, -0.304], r: [30, 0, 0] },
      j: {
        hips: [-4, 12, -15.7], spine: [6.5, 16.5, 24], chest: [0.8, 21, 18.8],
        neck: [11.8, 0.8, -7.5], head: [-11.5, -3.7, 0], clavL: [4.8, 0.6, 41.3],
        armL: [-169.2, -1.4, -70.2], foreL: [-47.3, 0.1, -13.4], clavR: [-6.5, 34.6, -27.7],
        armR: [-86.4, -28.9, 33], foreR: [-47.3, 15.8, 12.1], thighL: [14.6, 31.4, 16.1],
        shinL: [96, 0, 0], footL: [20, 0, 0], thighR: [1.9, -14.6, -18.9],
        shinR: [96, 0, 0], footR: [20, -1.5, 1.5],
      },
    },
    B: {
      root: { p: [0.064, 0.304, 0.115], r: [-58, 190, 0] },
      j: {
        hips: [28.8, 16, -10], spine: [-2.4, -34.3, -27.4], chest: [-8.5, 11.3, 2.4],
        neck: [-16, 0, 0], head: [14, 0, 0], clavL: [15.8, -9.6, 30.3],
        armL: [-114.1, 34.7, -27.1], foreL: [-112.5, 11.4, 3.9], clavR: [6.8, 19.6, -21.1],
        armR: [-110.7, -24, 28], foreR: [-104, 6, 6], thighL: [-142.5, 19.1, -0.8],
        shinL: [130, -9.7, 5.3], footL: [-10, 0, 0], thighR: [-45.9, -3.6, -21.2],
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
      root: { p: [0.36, 0.43, 0.253], r: [12, 116, 0] },
      j: {
        hips: [-35, -17.2, -11.2], spine: [39.1, -12.7, 6.8], chest: [37.9, -15, 10.6],
        neck: [30, 0, 0], head: [-34, 0, 0], clavL: [5.6, 6.9, -43.6],
        armL: [-86.1, 36.1, -48.5], foreL: [-126.9, 0, -0.7], clavR: [-33.8, 3.2, -1.5],
        armR: [-86.4, -59.6, 31.1], foreR: [-126.7, -6, -4.5], thighL: [-66, 14, 20],
        shinL: [118, 0, 0], footL: [14, 0, 0], thighR: [-15, 8.1, -16],
        shinR: [101.8, 1.5, -1.5], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.101, 0.264, -0.018], r: [-90, 180, 8] },
      j: {
        hips: [18.5, 8.8, 6], spine: [-11.7, 4.5, 6], chest: [2.3, 2.8, 6],
        neck: [-26.7, -0.7, 0.8], head: [-6.5, -26, 7.5], clavL: [-1, 15.8, 40.4],
        armL: [-135.9, 61.4, -42.9], foreL: [-87.1, -10.4, -1.5], clavR: [-21.8, -33.6, -15.6],
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
      root: { p: [0.041, 0.316, -0.379], r: [50, 0, 0] },
      j: {
        hips: [3.3, -5.2, -6], spine: [21.3, -6.7, -6], chest: [-0.2, -8.2, -3],
        neck: [-48.8, -31.4, -21.6], head: [-27.5, 2.6, -13.5], clavL: [-35.6, -25.2, 8.1],
        armL: [-117.4, 88.3, 43.8], foreL: [-85.8, 19.8, 48.1], clavR: [33.3, 26.9, 23.2],
        armR: [-55, -60.8, -26.9], foreR: [-10.7, -2, -16.3], thighL: [7, 26.8, 28.6],
        shinL: [117.8, 9, 0], footL: [20, 0, 0], thighR: [11.8, -8.7, -11.2],
        shinR: [98.8, 0.8, -0.7], footR: [20, 0, 0],
      },
    },
    B: {
      root: { p: [-0.03, 0.291, 0.18], r: [-48, 180, 0] },
      j: {
        hips: [15.6, 21.8, 23.3], spine: [-1, -25.4, -5.9], chest: [-16, -11.2, -10.4],
        neck: [-29.4, 0.8, 0.8], head: [27.3, 1.5, 0], clavL: [24.1, -3.7, 15],
        armL: [-144.2, 82.2, -9.3], foreL: [-125.2, 12.9, 56.2], clavR: [-6.6, -23.8, -33],
        armR: [-153.3, -16.2, 37.1], foreR: [-88.1, -6.6, -4.4], thighL: [-143.7, -22.3, -2.5],
        shinL: [95.9, -14.2, 16], footL: [-8.5, 1.5, 1.5], thighR: [-141.1, 5.3, 37.1],
        shinR: [85.4, 29.3, -17.2], footR: [-4, 6, 6],
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
      root: { p: [0.008, 0.365, -0.38], r: [-22, 8, 6] },
      j: {
        hips: [6, 9, -10.6], spine: [24, -12, 6], chest: [22, -3, 15],
        neck: [22.5, 0.8, 0], head: [-20, 14, 0], clavL: [4.5, -4.4, -1.6],
        armL: [-156.6, 34, -50], foreL: [-104.2, -1.3, 0.8], clavR: [7.5, 18.1, -17.7],
        armR: [-96.2, -46.8, 3.1], foreR: [-108.9, -56.1, -41.9], thighL: [-61.2, 12.8, 24.3],
        shinL: [84, 0, 0], footL: [-14, 0, 0], thighR: [-68.7, -30.7, -37],
        shinR: [84, -2.2, 0.8], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [0.03, 0.275, -0.026], r: [-16, 4, 4] },
      j: {
        hips: [0, -15, -4.5], spine: [-3.4, 1.4, -6], chest: [-1.3, 0.5, -50],
        neck: [5.8, 11.5, 0], head: [14, -8, 0], clavL: [-28.2, -4.3, 31.3],
        armL: [-129.3, 11, -37.1], foreL: [-56.1, -7.4, -13.3], clavR: [5.7, 18.4, -39.4],
        armR: [-85.5, -34.5, 32.1], foreR: [-71.9, 3.9, 3.9], thighL: [-64, 8, 14],
        shinL: [86, 0, 0], footL: [-10, 0, 0], thighR: [-64, -8, -14],
        shinR: [86, 0, 0], footR: [-10, 0, -0.7],
      },
    },
  }),

  RNC_WORK2: P('RNC_WORK2', {
    // A переставляет замок выше и заводит вторую руку глубже; B прячет
    // подбородок, вкручивается в душащую руку и упирается пятками.
    name: 'Удушение — перехват выше',
    variantOf: 'RNC',
    A: {
      root: { p: [-0.026, 0.407, -0.388], r: [-26, 8, 8] },
      j: {
        hips: [0, -6.7, -10.5], spine: [24, -6, 6], chest: [-1.4, -12, -1.4],
        neck: [26, 3, 0], head: [-22, 10, 0], clavL: [7.3, 1.6, 21.5],
        armL: [-158.8, 48.6, -25.6], foreL: [-119.6, 5.3, 6], clavR: [6.1, -13.3, -28.3],
        armR: [-132.6, -27.2, 62.9], foreR: [-122.3, 0.8, 0], thighL: [-66.7, 21.8, 27.1],
        shinL: [72, 0, 0], footL: [-14, 0, 0], thighR: [-67.5, -16.5, -24],
        shinR: [75.8, 0, 0], footR: [-14, 0, 0],
      },
    },
    B: {
      root: { p: [-0.026, 0.357, -0.06], r: [-10, 4, 4] },
      j: {
        hips: [2, 8.6, -12.7], spine: [-2, 0.8, -3.7], chest: [-1.5, 9.6, -15.7],
        neck: [-10, -13.7, -22.2], head: [-11.5, 24.8, 3.2], clavL: [-15.6, 18.9, 24.3],
        armL: [-134.7, 38.3, -43.1], foreL: [-105.9, -8, -0.7], clavR: [7.1, -1.4, -2.3],
        armR: [-119.5, -38.8, 39], foreR: [-105.2, -5.9, -1.5], thighL: [-62, 8, 14],
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
      root: { p: [0.165, 0.503, -0.11], r: [0, 24, 0] },
      j: {
        hips: [-9, -28.5, 18], spine: [26.8, -15, 26.3], chest: [1.8, -9.7, 19.1],
        neck: [15, 0, -0.7], head: [-16.7, 0, 0], clavL: [-20.2, 11.2, 34.2],
        armL: [-117.3, 67.5, 8.2], foreL: [-50, 7.7, -7.3], clavR: [24.8, -27.7, -12.7],
        armR: [-29.1, 2.7, -6.1], foreR: [-62.1, 40.7, 27.2], thighL: [-42.9, 12.3, 20.8],
        shinL: [112, 0, 0], footL: [10, 0, 0], thighR: [-16.2, 44, -13.7],
        shinR: [90.4, -2.2, -3.7], footR: [18, 0, 0],
      },
    },
    B: {
      root: { p: [-0.111, 0.284, 0.093], r: [-72, 156, -22] },
      j: {
        hips: [29, 13, 8.8], spine: [7.8, 30.8, 27.8], chest: [13.6, 0.3, -11.9],
        neck: [-8.7, 0, 0], head: [8, 0, 5.3], clavL: [1.7, 15.1, -21.3],
        armL: [-99.8, 55.2, -14.5], foreL: [-93.9, -6.4, -4.3], clavR: [2.7, 9.8, -38.8],
        armR: [-27.5, 43.9, 18.5], foreR: [-27.8, 32.4, 13.7], thighL: [-96, 8, 18],
        shinL: [98, 0, 0], footL: [-14, 0, 0], thighR: [-52, -41.1, -41.9],
        shinR: [75.4, -5.9, 0.8], footR: [-13.2, 0, 0],
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
        hips: [29.1, 22.5, 4.3], spine: [8.7, 37.6, -28.6], chest: [44.5, -12.6, -24.5],
        neck: [13.5, -3, 0], head: [-2.5, 0, 3], clavL: [4.7, -23, -38.9],
        armL: [-88.8, 13.1, -26.7], foreL: [-96, 4.8, -5.9], clavR: [10.1, 4.8, 43.5],
        armR: [-103.3, -9, 30], foreR: [-86.3, -5.8, 7], thighL: [-17.9, 23.6, 76.6],
        shinL: [112.3, 0.8, 2.3], footL: [20.3, 0.8, 2.3], thighR: [24.8, -27.7, -7.2],
        shinR: [83.8, -2.2, 0.8], footR: [18.8, 2.3, 0.8],
      },
    },
    B: {
      root: { p: [0.055, 0.259, 0.255], r: [-90, 180, 0] },
      j: {
        hips: [22, -22.5, -3], spine: [12.8, 13.3, -5.2], chest: [19.1, 13.8, 4.6],
        neck: [-8.7, 6, -1.5], head: [7.5, 0, 0], clavL: [0.8, -42.6, 14.4],
        armL: [-136.8, 44.9, 9.4], foreL: [-102.6, 18.2, 10.6], clavR: [18.9, 21.1, -21.9],
        armR: [-167.6, 1.1, 15.6], foreR: [-90.4, -2.8, -5.9], thighL: [-31.6, -15.6, -9.4],
        shinL: [49.4, 0, 0], footL: [-14, 1.5, 0], thighR: [-18.9, -6.7, -2.4],
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
      root: { p: [0.321, 0.299, 0.166], r: [10, 128, 0] },
      j: {
        hips: [-38, -46.2, -31.5], spine: [36.2, -8.5, 29.1], chest: [45.8, -11.4, 3.9],
        neck: [16.4, -2.2, 9.8], head: [-25.5, 0, 6], clavL: [-5.1, -37.4, -23.3],
        armL: [-76.9, 40.4, -48], foreL: [-132.6, 9.2, 7.6], clavR: [30.1, -35.1, -14.1],
        armR: [-26.4, -44.2, 28.2], foreR: [-120, 18.8, 0.2], thighL: [-41.4, -0.2, 3],
        shinL: [117.1, -16.4, 11.3], footL: [22, 4.5, 4.5], thighR: [-15.5, -25.6, -14.5],
        shinR: [109.8, 2.3, 2.3], footR: [20.1, 0.8, 3.8],
      },
    },
    B: {
      root: { p: [-0.105, 0.275, -0.03], r: [-90, 180, 0] },
      j: {
        hips: [20, -25.5, 12], spine: [0, -7.2, 6], chest: [14.5, -2.7, 12],
        neck: [8.8, 54.2, 6.1], head: [21.5, 33.4, -5.9], clavL: [-8.8, 0.1, 29],
        armL: [-123.7, 22.5, -27.9], foreL: [-80.1, 27.1, 19.6], clavR: [-8.8, -26.2, 9.7],
        armR: [-67.1, -40.7, 7.8], foreR: [-72.6, 7, -11.8], thighL: [-42, 6, 6],
        shinL: [60, 0, 0], footL: [-16, 0, 0], thighR: [-26, -6, -10],
        shinR: [44, 3, 3], footR: [-13, 3, 3],
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
