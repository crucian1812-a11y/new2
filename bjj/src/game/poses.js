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
      root: { p: [0, 0.961, -0.66], r: [0, 0, 0] },
      j: { ...STANCE_SPINE, ...STANCE_ARMS, ...STANCE_LEGS },
    },
    B: {
      root: { p: [0, 0.961, 0.66], r: [0, 180, 0] },
      j: { ...STANCE_SPINE, ...STANCE_ARMS, ...STANCE_LEGS },
    },
    grips: [],
  }),

  CLINCH: P('CLINCH', {
    name: 'Клинч',
    label: 'CLINCH',
    points: 0, top: null, ground: false,
    A: {
      root: { p: [0.028, 0.979, -0.222], r: [0, 6, 0] },
      j: {
        hips: [-12.2, -16.5, 1.6], spine: [26.1, -0.7, 9.1], chest: [17.5, 14.3, -2.8], neck: [-10.7, -6.4, -6], head: [-2.5, 0.8, 0],
        clavL: [30.4, -7.1, 26.2], armL: [-106.6, 49.9, 14.8], foreL: [-144.9, 16.3, 23.8],
        clavR: [5.5, 13.4, 14.3], armR: [-73.1, -23.7, 18.2], foreR: [-64, 0, -4.9],
        thighL: [-5.3, 13.6, 2.4], shinL: [25.2, 1.5, 0.8], footL: [-21.6, -7.2, 3],
        thighR: [6.5, -12.4, -8.9], shinR: [23.3, -0.6, -2.2], footR: [-46, 13.5, 0.1],
      },
    },
    B: {
      root: { p: [-0.109, 0.931, 0.298], r: [0, 186, 0] },
      j: {
        hips: [-25.6, -14, -2.9], spine: [31.3, -0.6, 5.4], chest: [10.1, 10.6, 1.9], neck: [3.9, -4.2, -12.2], head: [-4.6, 0, 0.1],
        clavL: [17.2, -14, 24.9], armL: [-104.1, 33.9, 9.3], foreL: [-121.5, -32, -42.8],
        clavR: [0.9, -7.8, 8.1], armR: [-76.7, -24.5, 19.6], foreR: [-61.6, -2.2, 0.4],
        thighL: [-11.6, 13.6, 6.1], shinL: [44.6, 1.5, -2.2], footL: [-14.1, -8, -0.6],
        thighR: [0.4, -3.2, -17.1], shinR: [26.5, -5, 6.1], footR: [6.7, 19.1, 21.2],
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
      root: { p: [0.025, 0.469, -0.321], r: [0, 0, 0] },
      j: {
        hips: [13.8, -21.6, 25], spine: [40.8, 17.4, 7.6], chest: [13.7, -17.1, 4.9], neck: [4.9, -0.7, 3.1], head: [-13.1, -0.7, 4.5],
        clavL: [40.9, -10.8, -20.2], armL: [8.5, -10.2, 148.1], foreL: [-115.1, -7.3, 1.6],
        clavR: [-19.6, 36.8, 11.7], armR: [58.4, 46.2, -89.9], foreR: [-82, 0, 0.1],
        thighL: [41.9, 24.1, -0.2], shinL: [91.3, 4.5, -4.5], footL: [24, 0, 0],
        thighR: [32.3, -8.1, -43.2], shinR: [86.1, 6.9, -4.4], footR: [27.1, 1.6, 0.9],
      },
    },
    B: {
      root: { p: [-0.09, 0.242, -0.04], r: [-90, 180, 0] },
      j: {
        hips: [-3.1, 24.9, 10.9], spine: [14.7, 18.2, 43.8], chest: [-0.4, 6.2, -40.1], neck: [-16.3, 1.6, -0.7], head: [18.3, -2.2, -0.7],
        clavL: [1.5, 4.7, 11.6], armL: [11.6, -52.7, 11], foreL: [-66.2, 67.3, -65.5],
        clavR: [-33.3, 19, -15.3], armR: [22.7, 3.1, 7.6], foreR: [-72, 6.8, -2.1],
        thighL: [-47.7, 12.3, -10.3], shinL: [140.5, -7.1, -4.5], footL: [-9.2, 3.1, 2.3],
        thighR: [-116.7, 2.3, 0], shinR: [155.1, -4.9, 14.8], footR: [-10, -0.7, 0],
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
      root: { p: [-0.152, 0.615, -0.462], r: [0, 0, 0] },
      j: {
        hips: [23.8, -10.4, -18.6], spine: [22.7, -15.7, -11.2], chest: [19.4, -0.7, -3], neck: [-10, 0.8, -9.7],
        clavL: [7.7, -4.4, 23.1], armL: [65, 15.4, 111.2], foreL: [-90, 2.3, 2.3],
        clavR: [-15.6, 41.5, -16.6], armR: [-29.3, 49.5, -101.1], foreR: [-50.4, 78.9, -74.5],
        thighL: [-15.7, 6.6, 12.4], shinL: [100.3, -2.2, 2.3], footL: [19.8, 0, 0.8],
        thighR: [-32.1, -7.1, -13.2], shinR: [71.5, 6.8, -6], footR: [-20, -1.4, -0.7],
      },
    },
    B: {
      root: { p: [-0.037, 0.187, -0.02], r: [-78, 180, 0] },
      j: {
        hips: [-8.8, -14.9, 31.7], spine: [13.7, -17, -8.6], chest: [28.3, 1.6, -15.6], neck: [-24.2, -0.6, 0], head: [18.1, -0.7, 0.1],
        clavL: [-11.7, -13.3, 11.5], armL: [1, 102.7, -56.3], foreL: [-50.9, -0.1, 0],
        clavR: [-15.6, 11.4, -4.5], armR: [-24.7, -44.1, 29.1], foreR: [-44.7, 0, 0],
        thighL: [-98.6, 7.1, 9], shinL: [20.5, 21.4, 18.2], footL: [-20.1, -0.7, -0.7],
        thighR: [-108.9, -0.7, -7.3], shinR: [12.2, 1, -2.2], footR: [-18.4, 0, 0.8],
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
      root: { p: [0.173, 0.503, -0.079], r: [0, 24, 0] },
      j: {
        hips: [29.7, -23.2, 32.3], spine: [23.4, -3.6, 15.8], chest: [-7.6, -23.9, 16.8], neck: [11, 0, -0.7], head: [-7, 0, 0],
        clavL: [-20, 6, 8.1], armL: [-22.9, -12.4, -74.5], foreL: [-70.9, -2.2, 0.7],
        clavR: [35.5, -27.5, 0.3], armR: [-34.5, 0.5, -12.7], foreR: [-64.7, 38.5, 32],
        thighL: [-29, 21.3, 30.7], shinL: [104.8, 0, 0], footL: [10, 3, 0],
        thighR: [9.2, 36.8, -3.1], shinR: [97.1, 4.8, 5.5], footR: [12.8, -2.9, 0],
      },
    },
    B: {
      root: { p: [-0.077, 0.2, -0.041], r: [-72, 156, -22] },
      j: {
        hips: [-16.1, -21.6, 11.4], spine: [-2.3, 21.9, 40], chest: [18.2, 1.7, -21.6], neck: [-14.7, 7.5, 0.8], head: [13.3, 0.8, 6.1],
        clavL: [19.2, 12.2, -19.1], armL: [-85.5, 45.2, -15.1], foreL: [-110.6, -5.6, -4.3],
        clavR: [12.5, 15.4, -27.7], armR: [-20.9, 41.1, 8.2], foreR: [-51.7, 37.1, 15.3],
        thighL: [-81.3, 16.4, 22.6], shinL: [91, 0, 0.8], footL: [-14, 0, 0.8],
        thighR: [-51.4, -38.1, -22.3], shinR: [77.3, -5.1, 9.8], footR: [-14, 0.8, 0],
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
      root: { p: [0.297, 0.353, 0.295], r: [8, 100, 0] },
      j: {
        hips: [-69.4, -27.4, -24.7], spine: [21.5, -11.7, -1.6], chest: [28.8, -0.7, 20.5], neck: [21.9, 0.2, 3.3], head: [38.1, -17.1, 14.9],
        clavL: [-15.3, -28.3, -25.4], armL: [-85.2, 39.4, -47], foreL: [-120.1, 31.8, 15.4],
        clavR: [32.7, -27.5, 1.8], armR: [-31.7, -7.4, 56.3], foreR: [-112.2, 10.7, -7.1],
        thighL: [-36.4, -18, -27.5], shinL: [104.7, -4.3, 12.2], footL: [8.5, -9.7, -3.7],
        thighR: [-24.9, -5.2, -24.9], shinR: [80.6, 15.1, -13.5], footR: [15.6, 12.8, 0.1],
      },
    },
    B: {
      root: { p: [-0.169, 0.187, -0.022], r: [-90, 180, 0] },
      j: {
        hips: [3.3, -12.7, 6], spine: [14, 3.1, 3.8], chest: [37.5, -3.7, 19.6], neck: [-1.8, 58.2, -23.1], head: [5.9, 29.8, 14.8],
        clavL: [-11.8, -7.4, 39.7], armL: [-49.6, -61.4, 89.3], foreL: [-69.9, -66.2, 64.9],
        clavR: [-5.3, -0.4, 44.6], armR: [-89.7, -59.2, -9.2], foreR: [-88.2, 36, 3.6],
        thighL: [-15.1, 7.7, 10.6], shinL: [40.8, -5.2, -1.5], footL: [-15.2, 0.1, 2.3],
        thighR: [-18.1, 6.2, -9.8], shinR: [41.9, 11.4, 1.7], footR: [-6.8, 6.2, 3.3],
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
      root: { p: [0.023, 0.542, 0.061], r: [-6, 100, 0] },
      j: {
        hips: [-18.1, -123.9, 59.7], spine: [27.1, 24.6, 26.7], chest: [6.1, 22.4, 35], neck: [3.8, -42.6, 10.6], head: [-16.7, -14.2, 0],
        clavL: [-10.8, 28.7, 30.7], armL: [156.7, 97.9, 37.8], foreL: [-70, -2.2, 0],
        clavR: [-8.5, -17.7, 39.5], armR: [-63.5, -52, -29.7], foreR: [-74.2, -8.9, -0.8],
        thighL: [-80.7, -27.7, -5.1], shinL: [149.5, 23.3, -21], footL: [8, -0.7, 0],
        thighR: [-20.1, 24.8, -17.8], shinR: [37.6, 31.9, -23.7], footR: [14.1, -2.4, -9.9],
      },
    },
    B: {
      root: { p: [-0.226, 0.236, -0.002], r: [-90, 180, 0] },
      j: {
        hips: [9.3, 53.5, -9.7], spine: [-14.5, -33.5, 12.1], chest: [15.1, 9.2, 25.6], neck: [-13, -0.7, -2.9], head: [13.5, -23.9, -1.4],
        clavL: [0.6, 25.1, 37.7], armL: [-131.6, 34.4, 10], foreL: [-92.3, -4.5, -5.2],
        clavR: [-18, -16.8, -35.5], armR: [-166.3, 82.6, -4], foreR: [-94.3, 1.5, 0.8],
        thighL: [-34.6, 25.7, 12.1], shinL: [50.6, 4.5, -3], footL: [-16, 0, 0.8],
        thighR: [-20.7, -6, -10], shinR: [40.8, 0, -0.7], footR: [-16, 0, 0],
      },
    },
    // What the position is, and it took a player's screenshot to notice that
    // none of it was written down. The two lines here said the top man's hips
    // are high and near, which a man lying across another man also satisfies —
    // so the solver was free to leave his posting leg straight and abducted
    // fifty degrees, and the position on screen was a starfish with the right
    // label on it. Three sentences say the rest of it: the knee is on the
    // belly, the other foot is on the mat, and the knee over that foot is up.
    hold: [
      { of: 'A.hips', above: 'B.chest', by: 0.34 },
      { of: 'A.hips', near: 'B.chest', within: 0.32 },
      { of: 'A.shinL', near: 'B.chest', within: 0.24 },
      // And on it, not over it. `near` is measured across the mat, and that
      // was the gap: for as far back as the history goes the knee stood ninety
      // centimetres off the mat and the foot a hundred, and every line above
      // still held — the knee was «near» the chest, directly above it. A
      // player saw a man hanging in the air. The knee rests on a belly about a
      // third of a metre up, and the shin lies across it with the foot down by
      // the far hip. (Getting it there took turning the pelvis, not the leg:
      // see HANDOFF, the round where the knee went onto the belly.)
      { of: 'A.shinL', below: 0.46 },
      { of: 'A.footL', below: 0.34 },
      { of: 'A.footR', below: 0.145 },
      { of: 'A.shinR', above: 'A.footR', by: 0.20 },
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
      root: { p: [0.073, 0.566, 0.107], r: [0, 0, 0] },
      j: {
        hips: [41.6, 3.2, -17.2], spine: [6.9, 24.5, -25.2], chest: [36.4, -34.9, -1], neck: [22.6, 2.3, 0.1], head: [-10.6, 5.4, 1.6],
        clavL: [26.7, -12.2, -26.4], armL: [-37.6, -53.7, 57.7], foreL: [-111.4, 0, 0.8],
        clavR: [11.8, 8.1, 38.5], armR: [-90.3, -5.8, 38.4], foreR: [-108.7, 17.5, 11.7],
        thighL: [-40.5, -11.9, 82.4], shinL: [50.1, 40.7, -13.4], footL: [17.3, 1.5, 0],
        thighR: [-23, -35.9, -5.2], shinR: [71, -16.4, -8.9], footR: [16.6, 0, 0.8],
      },
    },
    B: {
      root: { p: [0.095, 0.228, 0.143], r: [-90, 180, 0] },
      j: {
        hips: [-9.1, -45.3, -0.7], spine: [1, -1.2, -29.8], chest: [14.8, 4.7, 29.7], neck: [-2, 2.3, -3], head: [11.8, 1.6, 3.1],
        clavL: [-1.4, -26, 15], armL: [-140.5, 31.5, -1.1], foreL: [-115, 22.3, 21.4],
        clavR: [0.4, 3.4, -15.8], armR: [-172.7, 20.2, 30.2], foreR: [-73, -12.5, -5.1],
        thighL: [-22.1, -24.3, -12.2], shinL: [31.4, 0, 6.8], footL: [-3.4, 3.1, -8.9],
        thighR: [-23, -13.3, 8.2], shinR: [34.1, -2.2, 1.7], footR: [-13.9, 0.8, 2.3],
      },
    },
    hold: [
      { of: 'A.hips', above: 'B.hips', by: 0.17 },
      { of: 'A.hips', near: 'B.hips', within: 0.17 },
      { straddle: 'B.chest', with: ['A.shinL', 'A.shinR'], by: 0.13 },
      // And both of his insteps are on the mat, which nothing said. The
      // straddle is satisfied just as well by a man kneeling in mid-air, and
      // that is what the library had: the whole top man resting on nobody but
      // the man he is sitting on, his lowest point 21 cm up and his ankles
      // *above* his knees — 78 and 59 against 50 and 26. A player photographed
      // it and called it a hanging pose, which is exactly what it was.
      //
      // The number is read off the library rather than invented: every pose
      // whose top man rests on the mat puts his ankles at 12 to 14 cm — that is
      // where this rig's sole sits on the floor: the sole is 8.3 cm under the ankle
      // bone and the mat is at 5, so 13.5 is the instep actually down.
      // There was a second variant of this position, MOUNT_WORK2, and it went
      // when the mount was put back on the mat. The straight line to it ran the
      // top man's right arm through the bottom man's right forearm — 5.5 cm of
      // overlap at one end, 6 at the other and 13 in the middle bare, 11 with
      // the best correction the solver could find, against an allowance of 8.5.
      // Five things were measured and none of them moved it: a wider arc, four
      // lobes, shortening the variant's departure (the line dips *deeper* at
      // half way, so a shorter path is a worse one), rederiving the variant from
      // the moved base, and routing the loop through the other variant. A
      // variant you cannot reach without hurting both men more than either end
      // does is not a variant. The cost is measured and it is two points of
      // self-repetition on the mount: 85% to 87%.
      { of: 'A.footL', below: 0.135 },
      { of: 'A.footR', below: 0.135 },
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
      root: { p: [-0.022, 0.292, -0.507], r: [-22, 8, 6] },
      j: {
        hips: [-14.8, 5.3, -3.5], spine: [28, -14.1, -14.2], chest: [22.3, 0, 38.4], neck: [25.1, 0.8, 3.8], head: [-11.2, 8.8, 0.8],
        clavL: [15.9, 3.2, 18.7], armL: [15.9, 31.8, -109.1], foreL: [-109.4, 0.8, 0],
        clavR: [1.6, 15.3, -6.3], armR: [177.1, -82.6, 70.2], foreR: [-73.5, 0.8, 0],
        thighL: [-92.3, 23.3, 17.7], shinL: [83.6, 9.9, -9.6], footL: [-16.1, 0, 0.1],
        thighR: [-66, -12.5, -37.4], shinR: [68, 3, -2.1], footR: [-11.6, 7.7, -5.8],
      },
    },
    B: {
      root: { p: [0.023, 0.296, -0.12], r: [-16, 4, 4] },
      j: {
        hips: [-32, -39.5, 1.5], spine: [21.1, -22.2, -5.2], chest: [-10.1, 7.7, -48.6], neck: [5.4, -20.9, -8.8], head: [19.5, -8.2, 3.8],
        clavL: [-1.2, 16.1, 41.9], armL: [129.1, 105, 6.6], foreL: [-126.4, -15, 11.3],
        clavR: [-8, 14.4, -42.7], armR: [57, 11, 57.1], foreR: [-138.3, 0, 0],
        thighL: [-62.6, 3.5, 16.3], shinL: [80.8, 0, -0.7], footL: [-10.7, 0.8, -0.7],
        thighR: [-66.4, 11.7, -0.5], shinR: [79.4, 8.4, -7.4], footR: [-11.4, 1.5, -3],
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
      root: { p: [-0.016, 0.536, -0.481], r: [10, 14, 0] },
      j: {
        hips: [-12, 7.6, 38.4], spine: [29.8, 23.5, 12.8], chest: [29.4, -2.4, -11.7], neck: [21.4, -4.5, 5.3], head: [-14.1, 0, 2.3],
        clavL: [32.3, -20.1, 3.8], armL: [-7, 13.5, -95.8], foreL: [-69.2, 4.5, -0.7],
        clavR: [-20, 28.6, -33.3], armR: [119.7, 31.5, -24.5], foreR: [-97.1, 0, -0.7],
        thighL: [-40, 4, 14], shinL: [104, 0, 0], footL: [8, 0, 0],
        thighR: [-4.8, -5.8, -6], shinR: [94.1, 0.1, 2.3], footR: [21.6, 6.1, 6.1],
      },
    },
    B: {
      root: { p: [-0.172, 0.334, 0.132], r: [64, 176, 0] },
      j: {
        hips: [-23.1, 21.8, 7.7], spine: [-3, 11.7, 20], chest: [-32, 34, -16.5], neck: [-12.4, 12, 21.8], head: [25.5, 3.8, 3],
        clavL: [10, 20.5, -36], armL: [-178.1, -81.7, -56.1], foreL: [-71.8, 0, 0],
        clavR: [28.3, -35, 0.2], armR: [-24.8, -4, 27.3], foreR: [-105.5, 2.3, 6.8],
        thighL: [77.9, 53.4, 65.4], shinL: [158.7, -7.2, 16.6], footL: [15.1, 2.3, 2.3],
        thighR: [52.3, -2.6, -73.8], shinR: [152.8, 34.6, -5.1], footR: [14.3, 2.3, 0.8],
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
      root: { p: [0.055, 0.287, -0.418], r: [-26, 8, 8] },
      j: {
        hips: [-2.2, -4.3, -11.9], spine: [26.3, -16.9, 3.1], chest: [-19, 5.4, 29.5], neck: [18, 0, 0], head: [-14.7, 10, 0],
        clavL: [12.2, -5.8, 42.7], armL: [39.2, -54.9, 83.5], foreL: [-103.4, -1.5, -12.7],
        clavR: [3.9, -21.2, -16.2], armR: [-51, 44.8, 23.7], foreR: [-73.3, 1.5, 0],
        thighL: [-84.4, 13.8, 27.1], shinL: [60.2, -2.8, 6.3], footL: [-13.1, -3.7, 3.8],
        thighR: [-79, -21.4, -34.3], shinR: [73, 8.5, -2.8], footR: [-14, 6.3, -11.1],
      },
    },
    B: {
      root: { p: [-0.079, 0.277, -0.052], r: [-10, 4, 4] },
      j: {
        hips: [-32.9, 3.1, -49.4], spine: [19.3, 1.7, 19.6], chest: [9.2, 22.7, 6.9], neck: [-23.6, -14, -44.4], head: [-15.3, 33.5, -4.2],
        clavL: [-25.2, 22, 22.2], armL: [-82, -129.2, 28.5], foreL: [-137.3, 0, 0],
        clavR: [5.6, -9.4, 2.3], armR: [-130.2, -41, 39.8], foreR: [-117.2, -5.8, -1.5],
        thighL: [-56.9, 25, -33.2], shinL: [93.8, 18.9, 18.8], footL: [-11.4, 9.9, 42.1],
        thighR: [-58, -3.4, -13.2], shinR: [87.5, 12, -12.7], footR: [-10, 0, 0],
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
      root: { p: [-0.409, 0.18, 0.462], r: [-90, 90, 0] },
      j: {
        hips: [-7.1, -7.4, 3.1], spine: [23.8, 11.8, 31.7], chest: [36.7, 3.2, 9.9], neck: [-3.9, 0.8, -0.7], head: [21.3, 0.8, 2.3],
        clavL: [-24.4, -12.3, 35.9], armL: [7, 9.6, -145.8], foreL: [-121.3, -2.2, 0],
        clavR: [0.1, 15.1, -27.3], armR: [-16.5, -22.3, 95.1], foreR: [-133.2, 0, 0],
        thighL: [-38.7, 12.8, 52.9], shinL: [5.7, 13, -2.9], footL: [-14.2, 2.3, 1.5],
        thighR: [-32.8, -28.1, -27.6], shinR: [35.5, -25.3, -4.3], footR: [-5.9, -20, -45.5],
      },
    },
    B: {
      root: { p: [0.023, 0.201, 0.012], r: [-90, 180, 0] },
      j: {
        hips: [-2.8, 24.4, -6], spine: [16.9, 10, 0], chest: [6.1, -2.1, 13.6], neck: [-9.4, 3, 1.5], head: [13, 0, 3],
        // The trapped arm reaches across to A's chest, which is what pulls it
        // straight; the free one is stacked under him where it can do nothing.
        clavL: [18.1, -5.7, 36.6], armL: [-97.5, 53.2, -14.1], foreL: [-35.5, 22.8, 4.8],
        clavR: [29.6, 24.2, -18.6], armR: [-50.3, -16.1, 25.7], foreR: [-61.3, 9.2, 8.4],
        thighL: [-24.1, 0.2, 6.3], shinL: [37.6, -11.2, -2.2], footL: [-10.4, -6, 0.1],
        thighR: [-9.3, -5.2, -8.7], shinR: [34.3, 2.3, -1.5], footR: [-12.7, 0.8, 0.8],
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
      root: { p: [0.054, 0.571, -0.328], r: [30, 0, 0] },
      j: {
        hips: [9.6, 19.5, 0.8], spine: [27.5, 13.5, 3.1], chest: [10.9, 19.5, 30.2], neck: [19.9, 9.2, -7.3], head: [-20.1, -2.1, 0],
        clavL: [-0.7, -11.2, 40.2], armL: [-146.9, 9.1, -43], foreL: [-78, -6.6, -20.9],
        clavR: [-7.6, 30.2, 0.1], armR: [35.9, -80.3, 59.5], foreR: [-66.5, -6.7, 0],
        thighL: [-4, 63.8, -16.9], shinL: [77.4, -0.7, 12.8], footL: [8.8, 2.3, -11.9],
        thighR: [-16.7, 32, -1.7], shinR: [69.8, -2.9, -0.7], footR: [-1.4, -25.2, -0.7],
      },
    },
    B: {
      root: { p: [-0.007, 0.202, 0.063], r: [-64, 180, 0] },
      j: {
        hips: [-21.9, -8.2, 12], spine: [-17.4, -41.1, -15.7], chest: [16.6, 16.7, -11.6], neck: [-31.5, 0, 0.8], head: [20, 0.8, 0.8],
        clavL: [18.9, -9.4, 30.4], armL: [39.9, -56.2, 74.6], foreL: [-83.7, 0.8, 0],
        clavR: [4.6, 26.4, -15.8], armR: [-92.7, -24, 34], foreR: [-84, 0, 3],
        thighL: [-137.2, -2.5, -0.6], shinL: [134.5, -24.6, 19.6], footL: [-10, 0.8, -0.7],
        thighR: [-38.8, 6.3, -16.6], shinR: [152.1, -10.4, 14.6], footR: [-10, 0, -1.5],
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
      // The man being choked is on his knees, and his insteps are on the mat.
      // Without this he held himself up on nothing but the legs around his
      // neck — lowest point 17 cm above the tatami. Same number as mount: the
      // sole is 8.3 cm under the ankle bone and the mat is at 5.
      { of: 'A.footL', below: 0.135 },
      { of: 'A.footR', below: 0.135 },
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
      root: { p: [0.34, 0.385, 0.316], r: [12, 116, 0] },
      j: {
        hips: [-47.5, -17, -22.4], spine: [46.2, -6.4, 11.3], chest: [43, -12.3, 1.5], neck: [43.6, -5.9, 5.3], head: [-21.2, -6, 0],
        clavL: [-2.8, -2.1, -44.7], armL: [53.6, 106.2, 22.4], foreL: [-61.4, -1.5, 3],
        clavR: [-23.3, 13.9, -11.9], armR: [49.9, 69.6, 81.7], foreR: [-68.7, -35.4, 33.5],
        thighL: [-76.1, -1.7, 5], shinL: [102.1, -1.4, 1.6], footL: [9.7, -0.7, 8.7],
        thighR: [-5.2, 14.8, -30.2], shinR: [102.6, 6.8, -1.5], footR: [6.9, 1.6, 9.1],
      },
    },
    B: {
      root: { p: [-0.157, 0.269, -0.067], r: [-90, 180, 8] },
      j: {
        hips: [17.6, 9.1, 6], spine: [-10.9, -7.5, 12], chest: [11.4, 3.1, -1.3], neck: [-34.6, -0.7, 0.1], head: [1.5, -27.5, 5.3],
        clavL: [27, 18.9, 35.2], armL: [-148.7, 65.2, -70.3], foreL: [-83.3, 1.7, 0.8],
        clavR: [-15.9, -35, -16], armR: [-56.3, -27.8, 28.5], foreR: [-72, 1.6, 0.8],
        thighL: [-41.9, 6, 11.3], shinL: [48.8, -0.7, -0.7], footL: [-15.2, 0, 0],
        thighR: [-31.3, -3.7, -10], shinR: [36, -0.7, 0], footR: [-16, 0, 0],
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
      root: { p: [0.071, 0.349, -0.348], r: [50, 0, 0] },
      j: {
        hips: [-7.1, -8.9, -6], spine: [32.6, -5.2, -6], chest: [-5.4, 0.2, 9.1], neck: [-18.7, -12.6, -13.2], head: [-25.7, 4.1, -15.4],
        clavL: [-30.6, -21.4, -6.4], armL: [-6.4, -56.8, 93.9], foreL: [-80.7, 0, 0],
        clavR: [38.6, 24.3, 1.8], armR: [-42, -71.8, -35.7], foreR: [-26.8, 0.5, -21.3],
        thighL: [17.9, 17.2, 22.7], shinL: [98.1, 0, 0], footL: [19.3, 0.8, 0],
        thighR: [9, -9.5, -13.5], shinR: [102.6, 0, -0.7], footR: [19.3, 0, -2.9],
      },
    },
    B: {
      root: { p: [-0.026, 0.303, 0.231], r: [-56, 180, 0] },
      j: {
        hips: [9.4, 27.1, 10.7], spine: [22.9, -31.2, -15.3], chest: [22.5, -4.4, -20.1], neck: [-15.1, -0.7, -0.7], head: [17.6, 0.8, 0.8],
        clavL: [25.3, 22.6, 18.2], armL: [62.1, -13.5, -137.6], foreL: [-80.6, 5.3, 2.3],
        clavR: [-22.6, -2.7, -33.7], armR: [26, -3.9, 86.1], foreR: [-71.9, 2.2, 0],
        thighL: [-129.8, -22.2, -8.6], shinL: [92.3, -9.6, 14.5], footL: [-8.5, 0, 0],
        thighR: [-133.3, -9.5, 16.8], shinR: [87.7, 15, -21.7], footR: [-10, 0, 0],
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
      root: { p: [0.202, 0.497, 0.173], r: [16, 62, 0] },
      j: {
        hips: [-24.7, 1.6, 17.1], spine: [31.8, -3, -5.1], chest: [15.7, -27.5, 7.4],
        neck: [35.6, 5.3, -5.2], head: [-24, 0, -0.7], clavL: [-18.3, -29.4, -24.3],
        armL: [-81.6, 42.4, -48.2], foreL: [-98.7, 8, 6], clavR: [25.7, -36.7, -12.6],
        armR: [-42.2, -29.3, 26.1], foreR: [-118.6, -2, -6.9], thighL: [-63.9, 13.3, 17.3],
        shinL: [96.8, -4.4, 5.3], footL: [11.1, 0.8, -0.7], thighR: [10.5, -47.5, 20.2],
        shinR: [88, 15.1, -5.8], footR: [-16.8, -18.5, -0.4],
      },
    },
    B: {
      root: { p: [-0.134, 0.255, 0.085], r: [-90, 180, 0] },
      j: {
        hips: [16, 6.3, 9.8], spine: [4, -10.4, 4.5], chest: [11.9, -14.3, 23.4],
        neck: [17.9, 60.3, 30.4], head: [31, 25, -0.7], clavL: [-12.1, 13.7, 20.8],
        armL: [-128.6, 28.8, -40.2], foreL: [-111.5, 7.5, 2.5], clavR: [7.3, -20.2, 20.6],
        armR: [-48.7, -28.2, 14], foreR: [-76, 6, -6], thighL: [-40, 6.8, 12],
        shinL: [46, 0, -0.7], footL: [-16, 6, 0], thighR: [-28, -4.5, -5.4],
        shinR: [26.5, 0, 0], footR: [-16, 0, 0],
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
      root: { p: [0.055, 0.513, 0.05], r: [6, 46, 0] },
      j: {
        hips: [13.9, 16.3, 4.5], spine: [33.1, -16.9, -4.9], chest: [39.3, -16.2, -3.9],
        neck: [15.6, 0, 0], head: [-14, 0, 0], clavL: [1.3, -24.4, -37.9],
        armL: [-77.6, 5, -40], foreL: [-98.2, 3.2, 1.1], clavR: [4, 10, 27.5],
        armR: [-105.7, 11.8, 53.8], foreR: [-100.2, 17.8, 25.8], thighL: [-20.4, 13.6, 65],
        shinL: [96, 0, 0], footL: [14, 0, 0], thighR: [-113.7, 13.3, -6.4],
        shinR: [39.2, 11.4, -10.3], footR: [2.7, -2.8, -0.7],
      },
    },
    B: {
      root: { p: [0.05, 0.237, 0.226], r: [-90, 180, 0] },
      j: {
        hips: [11.8, -5, -28.4], spine: [33, -8.1, 6.2], chest: [19.9, 27.1, 12.9],
        neck: [-20, 0, 0], head: [14, 0, -0.7], clavL: [-6.8, -41.2, 7.9],
        armL: [-151.3, 44.1, 11.6], foreL: [-122.1, 9.2, 7.6], clavR: [17.4, 23.3, -16.7],
        armR: [-192.6, 10.1, 18.6], foreR: [-92.9, 2.4, 0.1], thighL: [-17.1, -9.5, -11.5],
        shinL: [23.9, 3.1, 6.1], footL: [-2.7, 0.1, -4.3], thighR: [-28.9, -13.3, -3.1],
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
      root: { p: [0.289, 0.387, 0.287], r: [10, 104, 0] },
      j: {
        hips: [-49.4, -60.4, 6], spine: [45.4, -11.4, -8.4], chest: [42, -15.5, 0.8],
        neck: [30.5, 4.3, -2.2], head: [-19.2, -0.7, 2.3], clavL: [-15.3, -33.7, -20.6],
        armL: [-89.4, 41.3, -50.7], foreL: [-125.6, 10.4, 3.1], clavR: [23.3, -31.7, -11.2],
        armR: [-44, -33, 39.4], foreR: [-96.2, -2.1, -10.2], thighL: [-44.2, -1.7, 41.6],
        shinL: [28.6, 2.3, 0], footL: [10, 0, -2.2], thighR: [-34.3, 4.8, -48.1],
        shinR: [34.5, -5.9, 1], footR: [12.4, 1.5, 3.1],
      },
    },
    B: {
      root: { p: [-0.138, 0.245, 0.004], r: [-90, 180, 0] },
      j: {
        hips: [15.3, 0.1, 6], spine: [-2, 2.5, 5.3], chest: [13.3, -17, 16.6],
        neck: [1.6, 48.3, 7.5], head: [17.6, 32.1, -14.7], clavL: [-22.9, -2.8, 17],
        armL: [-135.9, 29.4, -35.4], foreL: [-110, 1.6, 3.8], clavR: [6.1, -21, 7.4],
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
      root: { p: [0.095, 0.269, -0.012], r: [-67.6, 111.9, 48.7] },
      j: {
        hips: [14.2, -0.5, 13.7], spine: [1.1, -3.2, -11], chest: [2.3, 5.1, -2.7],
        neck: [-24.4, 0, 0], head: [15.3, 0, 0], clavL: [-8.8, -19, 7.4],
        armL: [-80.3, 20.4, -18.8], foreL: [-78.2, -4.4, -3.7], handL: [-1.8, 0, 0],
        clavR: [-12.2, 10.9, -6.1], armR: [-72.3, -21.2, 28.2], foreR: [-80.2, -4.4, -3.7],
        handR: [-1.8, 0, 0.8], thighL: [-75.2, -161.6, -159.8], shinL: [31.1, -5.6, 4.2],
        footL: [-22.2, -1.2, 0.1], thighR: [-81.5, -164.1, 154.3], shinR: [29.6, 5.7, 1.8],
        footR: [-21.5, 1.4, 0.8],
      },
    },
    B: {
      root: { p: [-0.057, 0.569, -0.379], r: [0, 27, 0] },
      j: {
        hips: [14.8, -4.1, -28.8], spine: [11, -19.1, -11.3], chest: [6.6, -1.3, -2.8],
        neck: [3.6, 0, 0], clavL: [5.5, -9.1, 27.1], armL: [-84.4, 16.7, -10.9],
        foreL: [-45.2, -6.1, 9.4], handL: [-1.8, 0, 0], clavR: [-9.8, 31.9, -18.2],
        armR: [-73.8, -4.5, 27.7], foreR: [-48.5, 7.5, 1.7], handR: [-1.8, 0, 0.8],
        thighL: [-13.6, 6.3, -0.5], shinL: [82.7, 0.8, -5.2], footL: [18, 1.9, -2.4],
        thighR: [-26.9, -9.6, -16.2], shinR: [58.6, 5.3, -5.9], footR: [-19.2, 3, 0.1],
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
      root: { p: [-0.024, 0.23, -0.046], r: [-74.8, 82.3, 82.3] },
      j: {
        hips: [1.2, 16.3, 29.3], spine: [13, 23, 23.8], chest: [9.9, 6.3, -26.6],
        neck: [-14.9, 0.8, 0.8], head: [13, -0.5, -0.5], clavL: [7.3, -2.4, -1],
        armL: [-88.3, -4.1, 0], foreL: [-60.7, 1.1, 1], clavR: [-28.1, 18.8, -7.2],
        armR: [-75.6, 148.4, -164], foreR: [-82.3, 19.8, 17.5], thighL: [-46.9, 12.4, 26.4],
        shinL: [39.3, 176.9, 170.7], footL: [-5.1, 2.5, 1.5], thighR: [-63.3, -156.6, 171.9],
        shinR: [28.5, 170.3, -162.4], footR: [-6.7, -0.6, 0],
      },
    },
    B: {
      root: { p: [-0.013, 0.458, -0.307], r: [-2, 15.1, 15.1] },
      j: {
        hips: [11.7, -24.1, 23.5], spine: [27.9, 15.8, 3.3], chest: [18.5, -3, 10.2],
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
      root: { p: [0.005, 0.288, -0.359], r: [-22, 8, 6] },
      j: {
        hips: [-5.2, -2.2, -19.3], spine: [31.5, -3.7, 1.5], chest: [7.8, 6.3, 22.6],
        neck: [16.3, 0.8, 3.8], head: [-11.2, 11.8, -6], clavL: [14.3, 0.9, 42.7],
        armL: [19.1, 24.8, -113.4], foreL: [-130.6, 17.3, -3], clavR: [23.5, 16.2, -31.7],
        armR: [180.5, -141.6, 10], foreR: [-97.9, -1.5, -0.7], thighL: [-88.8, 16, 19.2],
        shinL: [45.3, -19.3, 3.9], footL: [-19.1, -2.9, 3.1], thighR: [-91.1, -24, -29.4],
        shinR: [79.5, 3.8, -2.9], footR: [-13.2, 0.8, -1.5],
      },
    },
    B: {
      root: { p: [0.012, 0.304, 0.003], r: [-16, 4, 4] },
      j: {
        hips: [-29.7, -51.6, -11.9], spine: [21.7, -20.8, -12.7], chest: [-0.4, -16.4, -45.6],
        neck: [17, -11.9, 0.1], head: [16, -2, 6], clavL: [-20.6, 4.9, 18.8],
        armL: [-29.6, -76.4, -39], foreL: [-114.3, 0, 1.5], clavR: [8.9, 16.7, -34.9],
        armR: [43, 3.1, 33.4], foreR: [-132.2, -3.7, 0], thighL: [-73.1, -2.5, 11.8],
        shinL: [85.3, -7.5, 14.3], footL: [-9.2, 0.8, 3], thighR: [-71.6, -1.7, -0.3],
        shinR: [69, -2.9, 3.1], footR: [-6.2, 9.2, -6.5],
      },
    },
  }),

  RNC_WORK: P('RNC_WORK', {
    // Сжатие: A подтягивает предплечья и уводит голову вниз, у B
    // выгибается спина и руки тянут захват от горла.
    name: 'Удушение — сжатие',
    variantOf: 'RNC',
    A: {
      root: { p: [-0.061, 0.381, -0.462], r: [-26, 8, 8] },
      j: {
        hips: [-6, -11.2, -12], spine: [34.6, 8.3, 18.2], chest: [-3.2, -6.7, 2.6],
        neck: [25, 0, 0], head: [-21, 10, 0], clavL: [-4.4, 5.3, 20.3],
        armL: [29.7, -19.9, 127.3], foreL: [-83.8, -2.2, -9], clavR: [-2, -4.1, -44.7],
        armR: [-6.8, -9.5, 92.7], foreR: [-96.6, 2.3, 3], thighL: [-82, 23.6, 30.9],
        shinL: [69.3, -22.2, 24.9], footL: [-18.4, -2.1, 0.1], thighR: [-66.4, -12.5, -32.2],
        shinR: [64.8, 33.9, -22.4], footR: [-16.2, 0, -3.6],
      },
    },
    B: {
      root: { p: [-0.086, 0.411, -0.068], r: [-10, 4, 4] },
      j: {
        hips: [-12.5, 17.3, -30.7], spine: [1, -4.3, 8.3], chest: [15.3, 21.3, -8.2],
        neck: [-19, -16.4, -41.6], head: [-1.7, 34.1, 10], clavL: [-14.7, 26.6, 9.4],
        armL: [-154, 40.8, -51.2], foreL: [-125.4, -24, -1.5], clavR: [-8.5, -13.1, 7.6],
        armR: [-139.9, -41, 36], foreR: [-121.7, 3.2, 0], thighL: [-66.2, 2.1, -4],
        shinL: [108.7, 9.8, -11.2], footL: [-2.3, 8.5, 9.2], thighR: [-53.5, -2, -20],
        shinR: [90.5, 6, -6], footR: [-10, 0, 0],
      },
    },
  }),

  HALF_GUARD_WORK: P('HALF_GUARD_WORK', {
    // A продавливает колено наружу и наваливается плечом; B ставит
    // раму и уходит на бок, поднимая щит коленом.
    name: 'Полугард — проход',
    variantOf: 'HALF_GUARD',
    A: {
      root: { p: [0.168, 0.487, -0.122], r: [0, 24, 0] },
      j: {
        hips: [37.3, -11, 41.3], spine: [13.7, -6.5, 13.1], chest: [5.9, -18.4, 17.5],
        neck: [12.5, 0, 2.3], head: [-10, 0, 0], clavL: [-17.3, -6.3, 34.8],
        armL: [-7.2, -5.8, -89], foreL: [-76.2, -0.7, 0.8], clavR: [34.8, -22.7, -26.1],
        armR: [-12.3, 47.9, -77.7], foreR: [-128, 15.1, -4.4], thighL: [-11.1, 4.8, 31.4],
        shinL: [107, 0, 0], footL: [10, 0, 0.8], thighR: [-52.1, 54.3, -21.9],
        shinR: [122.5, 4.8, -0.6], footR: [-2.7, -29, 0.3],
      },
    },
    B: {
      root: { p: [0.021, 0.209, 0.095], r: [-72, 156, -22] },
      j: {
        hips: [-11.6, 13.7, -22.3], spine: [-9.2, -8.6, 25.8], chest: [26.5, -0.9, -2.2],
        neck: [-24.5, 0, 0.8], head: [14, 3, 6.8], clavL: [12.6, 24.4, -29.1],
        armL: [21.3, -74.8, 97.5], foreL: [-102.6, 0, 0], clavR: [-2.9, 28.4, -30.8],
        armR: [-4.8, 26.8, -64.1], foreR: [-133.6, -6.7, 5.5], thighL: [-94.5, 11.5, 27.8],
        shinL: [88, 0, 0], footL: [-14, 0, 0], thighR: [-64.1, -29.8, -30.7],
        shinR: [82.7, -11.1, 4.6], footR: [-14, 0, 0.8],
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
      root: { p: [0.121, 0.527, 0.112], r: [0, 0, 0] },
      j: {
        hips: [57.2, -16.4, -33], spine: [-22.4, 27, -20.3], chest: [44.8, -21.2, 2.8],
        neck: [19.1, 5.7, -27.4], head: [-6.2, 0, -14.9], clavL: [13.8, -25.8, -6.4],
        armL: [-75.8, 17.7, -20.6], foreL: [-78.6, 14.1, 4.9], clavR: [20.1, -11.1, 32.3],
        armR: [-83.5, -11.1, 30.9], foreR: [-119.6, 19.2, 8.6], thighL: [-28.4, 4.9, 82.2],
        shinL: [71, 38.3, -29.2], footL: [17.7, 1.6, -5.1], thighR: [-16.3, -31.3, -14.2],
        shinR: [49.9, -12.6, 40.6], footR: [27.1, 11.3, -12.7],
      },
    },
    B: {
      root: { p: [0.106, 0.206, 0.25], r: [-90, 180, 0] },
      j: {
        hips: [-12.8, -49.8, -1.4], spine: [1.1, 8.6, -37.2], chest: [17.8, 4, 24.5],
        neck: [-2, 2.3, -3], head: [11.8, 1.6, 3.1], clavL: [2.8, -19.3, 6.4],
        armL: [-157.1, 67.6, -5.6], foreL: [-119, 0.3, 14.5], clavR: [4.9, 4.7, -27],
        armR: [-212, 14.1, 17.9], foreR: [-82.2, 21.1, 6.8], thighL: [-1.6, -49.3, -14.3],
        shinL: [16.4, -8.6, -1.8], footL: [-5.6, 6.2, -11.8], thighR: [-9.8, 50.9, 26.8],
        shinR: [15.7, 0.8, 5.3], footR: [-14, -6, -1.5],
      },
    },
  }),

  SIDE_CONTROL_WORK: P('SIDE_CONTROL_WORK', {
    // A меняет бедро и вжимает плечо в челюсть; B ставит раму и
    // подтягивает колено, чтобы креветкой уйти.
    name: 'Сторона — смена бедра',
    variantOf: 'SIDE_CONTROL',
    A: {
      root: { p: [0.339, 0.295, 0.3], r: [8, 100, 0] },
      j: {
        hips: [-60, -26, -23.8], spine: [29.2, -0.8, 10.1], chest: [36.7, -18.9, 14.8],
        neck: [-13.6, 10.8, 30.5], head: [-39, -12.7, -24.7], clavL: [-17.7, -26, -27.7],
        armL: [-5, -42.8, -0.8], foreL: [-72.7, 0.8, 0], clavR: [15.3, -41.9, -12.5],
        armR: [52.2, 12.5, -25.2], foreR: [-138.6, -2.9, 0], thighL: [-61.4, -21.1, -14.2],
        shinL: [119.1, -9.7, 5.3], footL: [10.9, 0, -4.5], thighR: [-31.3, 5.3, -35.3],
        shinR: [89.4, 15.9, -11.1], footR: [9, -2.8, 11.5],
      },
    },
    B: {
      root: { p: [-0.094, 0.246, -0.052], r: [-90, 180, 0] },
      j: {
        hips: [10.8, 4.5, 12], spine: [-2, -28.3, 0], chest: [13.3, -4.4, 18],
        neck: [21.2, 73.2, 5.3], head: [21.5, 32.8, 8.6], clavL: [-9.3, -11.1, -9.2],
        armL: [33.6, 15.2, -147.5], foreL: [-69.1, -0.7, 0], clavR: [11.7, -28.2, 5.3],
        armR: [-72.9, -44.4, 2.6], foreR: [-61.3, 1.9, -2.6], thighL: [-40.7, 6.8, 12.8],
        shinL: [52, -1.5, 0], footL: [-16, 0, 0], thighR: [-15.1, 0.9, -14.5],
        shinR: [32, 1.6, -6.7], footR: [-6.8, 1.6, 0],
      },
    },
  }),

  STANDING_WORK: P('STANDING_WORK', {
    // Оба меняют уровень и тянутся за захватом: передняя рука вперёд,
    // колени глубже, B заходит по кругу.
    name: 'Стойка — борьба за захват',
    variantOf: 'STANDING',
    A: {
      root: { p: [0, 0.944, -0.57], r: [0, -5, 0] },
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
      root: { p: [0.1, 0.959, 0.61], r: [0, 186, 0] },
      j: {
        hips: [-3, 8, -0.7], spine: [12, -6, 0], chest: [6, 6, 0],
        neck: [-2, 0, 0], clavL: [0, 0, 8], armL: [-62, 14, -13],
        foreL: [-92, 0, 0], handL: [-12, 0, 0], clavR: [6, 0, -12],
        armR: [-74, -16, 10], foreR: [-68, 0, 0], handR: [-18, 0, 0],
        thighL: [-21.2, 10, 5], shinL: [34, 0, 0], footL: [-12, -8, 0],
        thighR: [3, -12, -5], shinR: [26, -0.7, 0], footR: [-30, 10, 0],
      },
    },
  }),

  CLINCH_WORK: P('CLINCH_WORK', {
    // Пуммелинг: A вкручивает правую руку под плечо, B отвечает своей.
    // Головы меняются местами, ноги подшагивают.
    name: 'Клинч — перехват подхвата',
    variantOf: 'CLINCH',
    A: {
      root: { p: [0.027, 0.898, -0.249], r: [0, 6, 0] },
      j: {
        hips: [-11.5, -14.5, 4.7], spine: [13.5, -0.9, -10.3], chest: [13.1, 0, 6.3],
        neck: [-15.8, 4.2, 7.6], head: [3.6, -0.7, 0.8], clavL: [10.1, -19.9, 25.3],
        armL: [-40.9, -53.5, 104.1], foreL: [-111.3, 3, -0.7], clavR: [22.2, 27.5, 30.3],
        armR: [-95.2, -34.5, 26.2], foreR: [-88, -0.7, 8.1], thighL: [-22.5, 12, 6.1],
        shinL: [42.1, -0.7, 2.4], footL: [-20.9, -7.2, 0.8], thighR: [17.1, -10.2, -19.4],
        shinR: [28.6, 4.6, 0], footR: [-36.2, 15, 2.3],
      },
    },
    B: {
      root: { p: [-0.137, 0.901, 0.251], r: [0, 186, 0] },
      j: {
        hips: [-4, -16.2, 6.1], spine: [15.9, -1.3, -0.7], chest: [3.6, 3.8, 2.5],
        neck: [-0.3, -5, -7.6], head: [-10.6, 0.8, 0.9], clavL: [30.1, -10.4, 28.1],
        armL: [-86.6, 40.8, 11.6], foreL: [-105.9, -28.8, -35], clavR: [8.9, -8, 10.4],
        armR: [-93.3, -14.3, 27.1], foreR: [-76.4, -2.2, 1.6], thighL: [-29, 12, 7.6],
        shinL: [35.5, 0.8, 2.3], footL: [-20.1, -7.2, 0.8], thighR: [-9.1, -10.2, -25.4],
        shinR: [28.3, 1.5, -14.9], footR: [-42, 12.1, -2.2],
      },
    },
  }),

  CLOSED_GUARD_WORK: P('CLOSED_GUARD_WORK', {
    // A выпрямляется и вжимает бёдра вниз, B уходит на бок и подбирает
    // угол, перекрещивая ноги выше.
    name: 'Закрытый гард — осанка против угла',
    variantOf: 'CLOSED_GUARD',
    A: {
      root: { p: [-0.041, 0.536, -0.333], r: [0, 0, 0] },
      j: {
        hips: [30.1, -25.4, 42.3], spine: [27.6, 18.2, 14.5], chest: [14, -11, 25.9],
        neck: [0.3, 0, 0], head: [-1.9, 0, 0.8], clavL: [29.6, -14, -1],
        armL: [21, -10.2, 157.7], foreL: [-93.3, 1.6, 0], clavR: [-19, 36, 5.1],
        armR: [24, -74.8, 80.9], foreR: [-82.4, 0, 2.3], thighL: [15.7, 8.5, 16.5],
        shinL: [92, 1.5, 1.6], footL: [24.8, 0.8, 0.8], thighR: [36, -21.5, -19.8],
        shinR: [92.8, -0.7, 2.3], footR: [24.8, 1.5, 0.8],
      },
    },
    B: {
      root: { p: [-0.042, 0.24, -0.039], r: [-84, 168, 0] },
      j: {
        hips: [4.8, 25.6, -1.4], spine: [22.3, 23, 19.9], chest: [8.8, 9.1, -20.5],
        neck: [-17.2, -0.7, 0], head: [10, 0.8, 0], clavL: [1.5, 2.4, -7.2],
        armL: [21.5, -61.4, 44.4], foreL: [-78.2, 0, 0], clavR: [-34.2, 29.4, -19.3],
        armR: [14.7, 21.5, -7], foreR: [-73.7, 1.5, -1.4], thighL: [-29.9, 9.4, 4.8],
        shinL: [160.5, 7.7, -20.4], footL: [-10, 0.8, 0], thighR: [-110.8, 14.3, 2.3],
        shinR: [153.3, -1.9, 11.7], footR: [-9.2, 0.8, 0.8],
      },
    },
  }),

  OPEN_GUARD_WORK: P('OPEN_GUARD_WORK', {
    // B выпрямляет ноги и отталкивает A от себя, дотягивая рукава;
    // A садится ниже и сбивает колени вниз.
    name: 'Открытый гард — толчок стопами',
    variantOf: 'OPEN_GUARD',
    A: {
      root: { p: [-0.068, 0.581, -0.494], r: [0, 0, 0] },
      j: {
        hips: [-11.4, 0.2, -26.2], spine: [29.6, -5.2, -12.7], chest: [22, 5.3, 6.1],
        neck: [19.3, 0, 1.5], clavL: [0.8, -11.1, 18.5], armL: [-96.3, 41.2, -20.9],
        foreL: [-21.2, -11.1, 7], clavR: [-11.1, 41.3, -7.7], armR: [69.5, 11.6, -108.9],
        foreR: [-125.4, 34.6, 3.8], thighL: [-9.3, 21.2, 7.2], shinL: [97.5, 21.2, -14.9],
        footL: [20.9, -6.6, 1.7], thighR: [-9.4, -21.4, -17], shinR: [77.1, 1.5, -4.5],
        footR: [-20, 0, 0],
      },
    },
    B: {
      root: { p: [-0.012, 0.187, -0.001], r: [-78.0, 180.0, 0.0] },
      j: {
        hips: [-5.1, -16.4, 40.3], spine: [18.2, -37.6, -21.3], chest: [30.2, -1, -17.9],
        neck: [-24.2, -0.6, 0], head: [18.1, -0.7, 0.1], clavL: [-11.1, -25.4, 8.4],
        armL: [17.4, 34.9, 15.5], foreL: [-61.1, -0.4, -0.3], clavR: [-3.6, 24.5, -8.9],
        armR: [-22.7, -50, 31.9], foreR: [-58.9, 0, 0], thighL: [-85.5, 1.3, 9.1],
        shinL: [18.2, -16.8, 0.6], footL: [-22.1, -0.3, -0.3], thighR: [-100.7, -4, -9.2],
        shinR: [25.1, 28.6, -7], footR: [-19.2, 0, -1.1],
      },
    },
  }),

  KNEE_ON_BELLY_WORK: P('KNEE_ON_BELLY_WORK', {
    // A переносит колено дальше поперёк и шире ставит опорную ногу;
    // B ставит раму в колено и подбирает своё, чтобы креветкой уйти.
    name: 'Колено на животе — вес вниз',
    variantOf: 'KNEE_ON_BELLY',
    A: {
      root: { p: [0.029, 0.536, 0.062], r: [-6, 100, 0] },
      j: {
        hips: [-28.3, -131.1, 66.2], spine: [35.4, 24.6, 29.3], chest: [6.9, 23.1, 35.3],
        neck: [-0.4, -35.2, 6.1], head: [-20.5, -13.5, 0], clavL: [-5.6, 16.3, 41.1],
        armL: [161.1, 106.5, 40.5], foreL: [-68.9, -4.5, -0.8], clavR: [-9.5, -14.5, 41.9],
        armR: [-60.3, -65.6, -19.1], foreR: [-74, -2.9, 0], thighL: [-92.7, -34.4, -11.1],
        shinL: [148.8, 29.3, -19.5], footL: [8, -0.7, 0], thighR: [-14.9, 33.8, -3.6],
        shinR: [36.9, 12.4, -20.7], footR: [16.4, 6.6, -18.1],
      },
    },
    B: {
      root: { p: [-0.214, 0.236, 0.034], r: [-90, 180, 0] },
      j: {
        hips: [2.4, 61, -5.2], spine: [-13.1, -46.8, 15], chest: [18.9, 26.4, 36.9],
        neck: [-18.9, -1.5, -1.4], head: [19.3, -22.4, -0.7], clavL: [-6.8, 22.1, 37.7],
        armL: [-131.6, 35.2, 11.5], foreL: [-89.3, -3, -2.9], clavR: [-20.3, -13.8, -35.5],
        armR: [-23.9, -53.8, 131.2], foreR: [-127.3, 0.8, 0], thighL: [-45.9, 26.4, 15.1],
        shinL: [62.8, 3.1, -2.8], footL: [-18.1, -2.7, -17.1], thighR: [-18.5, -5.9, -5.5],
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
      root: { p: [0.054, 0.558, -0.519], r: [10, 26, 0] },
      j: {
        hips: [0.9, 38, 26.6], spine: [46.5, 2.8, 2.3], chest: [43, -14.1, 9.9],
        neck: [26.1, 7.6, -22.3], head: [-17, -8.8, -7.3], clavL: [25.5, -20.2, 27.3],
        armL: [-34.7, 25.8, -38.6], foreL: [-51.2, 33.2, 28.7], clavR: [-7, 37.7, -16.5],
        armR: [2.7, -70.7, -75.9], foreR: [-101, 9, -2.2], thighL: [-22.8, 1.2, 18.6],
        shinL: [97.6, 4.6, 3.1], footL: [12.6, 0.1, 3.8], thighR: [-66.4, -13.5, 7.4],
        shinR: [92.3, -13.3, 7.5], footR: [-9, -20, -5],
      },
    },
    B: {
      root: { p: [0.021, 0.296, 0.153], r: [64, 176, 0] },
      j: {
        hips: [10.6, -2.1, 28.7], spine: [-4, 9.8, 20.6], chest: [-29.6, 34.6, -15.2],
        neck: [-35.4, -0.7, 0.9], head: [31.4, -1.4, 4.7], clavL: [1.8, 42.4, -4.5],
        armL: [-93.9, 29.9, -11.2], foreL: [-125.2, -0.7, 4.6], clavR: [35.3, -25, 7.4],
        armR: [-18.3, -2.3, 27.4], foreR: [-110.9, 5.4, 6.9], thighL: [82.3, 43.8, 58],
        shinL: [158.6, -6.4, 16.9], footL: [33.2, 0.1, 0.1], thighR: [38.6, 2.7, -77.6],
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
      root: { p: [-0.419, 0.175, 0.401], r: [-90, 90, 0] },
      j: {
        hips: [-3.6, -6, 8.5], spine: [13.8, 18.5, 18.6], chest: [44.9, -4.8, 14.9],
        neck: [-3.9, 0.8, -0.7], head: [23.5, -1.5, 0.1], clavL: [-13.3, -20.8, 39],
        armL: [-32.8, -63.5, 86], foreL: [-99.2, 2.3, 0], clavR: [0.7, 0.5, -27.2],
        armR: [-107.9, -17.3, 37.2], foreR: [-115.1, -4.2, 5.6], thighL: [-42.2, -1.5, 52.1],
        shinL: [-0.3, -1.3, 0.1], footL: [-12.7, 0.1, -1.5], thighR: [-4.7, 8.5, -24.4],
        shinR: [35.8, 3.2, -2.9], footR: [-1.7, 3.9, -2.9],
      },
    },
    B: {
      root: { p: [-0.032, 0.196, -0.07], r: [-90, 180, 0] },
      j: {
        hips: [-4.4, 0.4, 3.9], spine: [18.6, 24.9, 2.4], chest: [24.8, 12.1, 16],
        neck: [-5.5, 4.6, -2.1], head: [4.1, 0.8, -2.2], clavL: [12.7, 3.2, 37.7],
        armL: [-79, 59.6, -11.9], foreL: [-35.2, -23.6, 16.4], clavR: [22.1, 19.7, -22.3],
        armR: [-63.3, -20.6, 25.9], foreR: [-76.2, 7.8, 3.2], thighL: [-15.3, 34.9, -0.1],
        shinL: [60.7, 12.8, -8.9], footL: [-11.2, 0.8, 0.8], thighR: [-3.2, 0.2, -6.2],
        shinR: [38.2, 2.4, -2.9], footR: [-13.2, 0.8, 0.8],
      },
    },
  }),

  TRIANGLE_WORK: P('TRIANGLE_WORK', {
    // B уходит на угол, подрезает голеностоп и тянет голову вниз;
    // A выпрямляется и уводит плечо от петли.
    name: 'Треугольник — угол и подтяг головы',
    variantOf: 'TRIANGLE',
    A: {
      root: { p: [-0.103, 0.318, -0.3], r: [30, 0, 0] },
      j: {
        hips: [-19, 11.3, -28.4], spine: [31.4, 12.9, 24.8], chest: [15.8, 21.2, 17.4],
        neck: [11.8, 0.8, -14.2], head: [-11.5, -3.7, 0], clavL: [3.5, 7.4, 29.4],
        armL: [-154.8, 22.7, -34.2], foreL: [-51.7, 1, 0.2], clavR: [-12.2, 26.6, 12.3],
        armR: [15.5, -84.3, 87.9], foreR: [-89.9, -7.4, -6.7], thighL: [-15.1, 71.2, 25.9],
        shinL: [93.8, -40.5, 42.8], footL: [11.1, -5.9, -8.2], thighR: [-69.2, -50.3, -61.4],
        shinR: [99.9, -30, 27.1], footR: [14.3, 1.5, 2.5],
      },
    },
    B: {
      root: { p: [0.117, 0.278, 0.119], r: [-58, 190, 0] },
      j: {
        hips: [12.3, 38.6, -39.1], spine: [-12.8, -25.2, -26.6], chest: [29.1, 25.7, 3.9],
        neck: [-14.5, 0, 0], head: [14, 2.3, 0], clavL: [12.3, 13.1, 38],
        armL: [-10.8, -13.4, 75.5], foreL: [-61.4, -4.4, 17.5], clavR: [5.3, 25.6, -33.8],
        armR: [-46.2, -9.1, 56.9], foreR: [-106.8, 0, 0], thighL: [-131.2, 9.4, -14.3],
        shinL: [152.7, -26.1, 15.1], footL: [2.1, 8.4, 3.9], thighR: [-24.7, -7.8, -7.6],
        shinR: [144.8, -5.1, 13.8], footR: [-6.2, 0.8, -1.5],
      },
    },
  }),

  KIMURA_WORK: P('KIMURA_WORK', {
    // A доворачивает кисть вверх по спине и наваливается; B тянет руку
    // вниз к своему поясу и вкручивается в него боком.
    name: 'Кимура — доворот кисти за спину',
    variantOf: 'KIMURA',
    A: {
      root: { p: [0.371, 0.403, 0.26], r: [12, 116, 0] },
      j: {
        hips: [-43.1, -9.6, -21.6], spine: [43, -14.8, 6.9], chest: [48.4, 1.5, 8.6],
        neck: [46.6, -2.2, 0], head: [-28, 0, 0], clavL: [10.9, 12.2, -39.7],
        armL: [62.3, 115.6, 19.8], foreL: [-71.2, 1.5, -0.7], clavR: [-17.8, 7.1, 0],
        armR: [40.3, 50, 56.8], foreR: [-75.5, -0.7, 0], thighL: [-80.2, 8.8, 11.1],
        shinL: [109.2, 5.3, 0.1], footL: [6.6, -3.7, 3.1], thighR: [-18.5, 14.1, -22.7],
        shinR: [106.3, 6.8, -6.7], footR: [19.6, 0, 0.8],
      },
    },
    B: {
      root: { p: [-0.116, 0.305, -0.003], r: [-90, 180, 8] },
      j: {
        hips: [5, -2.3, 6.8], spine: [2.6, 7, 0.8], chest: [11.4, 1.4, 6],
        neck: [-26.7, -0.7, 0.8], head: [-6.5, -26, 7.5], clavL: [30.7, 16.8, 27.7],
        armL: [-129.8, 57, -54.1], foreL: [-87.6, -14.1, -5.1], clavR: [-21.8, -38, -1.3],
        armR: [-68.7, -24.9, 31.5], foreR: [-84, 0, 0], thighL: [-42, 6, 12],
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
      root: { p: [0.041, 0.322, -0.379], r: [50, 0, 0] },
      j: {
        hips: [13.9, 6.1, -6], spine: [17.7, -13.3, -6], chest: [-9.2, 17.6, -3],
        neck: [-49.3, -18.3, -8.6], head: [-26, 1.1, -12.7], clavL: [0.6, -3.4, 18.9],
        armL: [44.2, -86.3, 134.5], foreL: [-72.3, 3, 3.1], clavR: [35.1, -2.2, 24.8],
        armR: [-168.7, -31.2, -6], foreR: [-72, 6.8, 0], thighL: [13.8, 26.8, 28.6],
        shinL: [117.8, 9, 0], footL: [20, 0, 0], thighR: [14.8, -8.7, -10.4],
        shinR: [98.8, 0.8, -0.7], footR: [20, -2.2, -0.7],
      },
    },
    B: {
      root: { p: [-0.03, 0.307, 0.195], r: [-48, 180, 0] },
      j: {
        hips: [-6, 36.2, 12.8], spine: [27.6, 9.9, 20.5], chest: [19.5, -33.6, -38.7],
        neck: [-28.6, 0.8, 0.8], head: [27.3, 1.5, -0.7], clavL: [38.5, -10.2, -14.7],
        armL: [92.5, 26.9, -103.9], foreL: [-46, 29.2, -2.2], clavR: [-17.7, -7.9, -18.4],
        armR: [-9.1, 12.4, 64.2], foreR: [-44.9, 8.3, 0], thighL: [-137.6, -28.9, -2.5],
        shinL: [97.4, -13.4, 16], footL: [-7.7, 2.3, 1.5], thighR: [-139.6, 0.1, 11.7],
        shinR: [84.7, 22.6, -11.2], footR: [-4, 6, 6],
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
      root: { p: [0.001, 0.38, -0.372], r: [-22, 8, 6] },
      j: {
        hips: [-13.4, -3, 4.5], spine: [42.8, 16.5, 11.3], chest: [16.8, 13.5, 22.6],
        neck: [22.7, 0.1, 0], head: [-19.2, 13.3, 0], clavL: [27.9, -21.6, 18.8],
        armL: [29.2, -22.4, 121.3], foreL: [-114.2, -9, -0.7], clavR: [11.5, 26.6, -27.3],
        armR: [27.4, 59.6, -95.4], foreR: [-94.1, 16.5, 14.3], thighL: [-71.6, 27.1, 36.4],
        shinL: [82.6, 2.4, -9.6], footL: [-18.4, -11.2, -15.5], thighR: [-35.4, -28.3, -85.4],
        shinR: [92.6, 34.8, -22.9], footR: [-13, 3.1, 3.2],
      },
    },
    B: {
      root: { p: [0.064, 0.286, 0.083], r: [-16, 4, 4] },
      j: {
        hips: [-19.5, -38.2, 15], spine: [-6.3, 24, -12.7], chest: [0.3, -0.2, -31.2],
        neck: [11.9, 1.2, -18.6], head: [23.8, -24.4, -0.7], clavL: [-12.8, -16.9, 30.1],
        armL: [127.7, 118.5, 34.7], foreL: [-93.6, 2.3, 0.8], clavR: [-1.8, -1, -45.2],
        armR: [-38.6, -37.4, 120.3], foreR: [-70.4, 0.8, 0.8], thighL: [-59.4, 5.9, 23.1],
        shinL: [79.3, -13.4, 7.6], footL: [-9.9, -1.5, 0.1], thighR: [-91.6, 8.7, -2.4],
        shinR: [112, -0.4, 4.1], footR: [12.1, -10.1, -16.1],
      },
    },
  }),

  RNC_WORK2: P('RNC_WORK2', {
    // A переставляет замок выше и заводит вторую руку глубже; B прячет
    // подбородок, вкручивается в душащую руку и упирается пятками.
    name: 'Удушение — перехват выше',
    variantOf: 'RNC',
    A: {
      root: { p: [-0.111, 0.385, -0.354], r: [-26, 8, 8] },
      j: {
        hips: [-10.4, 5.3, -6], spine: [44.5, -20.9, -14.9], chest: [14.4, -6.7, 9.3],
        neck: [38.4, 3, -0.7], head: [-17.3, 10, -0.7], clavL: [17.2, 0.1, 35.9],
        armL: [35.6, 9, 157.9], foreL: [-130.3, -18, 9.8], clavR: [-5.7, -34.9, -26.6],
        armR: [-18.9, 2.4, 97.2], foreR: [-91.5, 2.3, 3], thighL: [-76.1, 25, 31.8],
        shinL: [65.5, -7.4, -5.1], footL: [-13, -6.5, 7.1], thighR: [-75.5, -10.2, -38.2],
        shinR: [79.2, 4, 14.4], footR: [-1.7, 24.4, -24.5],
      },
    },
    B: {
      root: { p: [-0.011, 0.293, -0.042], r: [-10, 4, 4] },
      j: {
        hips: [-22, -18.9, -21.6], spine: [31.1, 0.3, 13.7], chest: [13.6, 36.1, 4],
        neck: [-24, -17.3, -39.8], head: [0.8, 26.6, 19.2], clavL: [-10.2, 26.5, 17.7],
        armL: [-154.3, 43.6, -38.9], foreL: [-150.2, -23.2, 6], clavR: [-5.5, -5.6, 4],
        armR: [-125.4, -37.2, 38.5], foreR: [-102.9, -7.3, -1.4], thighL: [-85.2, 2.1, 5.9],
        shinL: [77.1, 5.3, -8.2], footL: [-10, -5.1, 5.3], thighR: [-78.3, 4.3, -8.6],
        shinR: [76.4, 8.3, -11.1], footR: [-10, 0, 0],
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
      root: { p: [0.151, 0.517, -0.144], r: [0, 24, 0] },
      j: {
        hips: [43.5, -16.5, -1.5], spine: [33.9, -9.5, -10.2], chest: [-26.5, -29.7, 10.5],
        neck: [13.6, 0, -0.7], head: [-17.4, 0, 0.8], clavL: [-23.7, 1.5, 11.9],
        armL: [31.2, -40.3, -70], foreL: [-76, 0.8, 0.1], clavR: [29.2, 6.5, -4.1],
        armR: [-31.2, -35.9, 46.9], foreR: [-108.6, 1.6, 1.5], thighL: [-33.7, 22.3, 48],
        shinL: [123.3, -10.5, 9.1], footL: [10, 0, 0], thighR: [-7, 48.1, -15.6],
        shinR: [108, 9.9, -6.5], footR: [0.8, -8.2, 6.8],
      },
    },
    B: {
      root: { p: [-0.048, 0.305, 0.06], r: [-72, 156, -22] },
      j: {
        hips: [-9.9, -31, 62.1], spine: [3.6, 2.5, 49.9], chest: [1, -17.8, -46.7],
        neck: [-7.1, 0, -0.7], head: [8, 0, 5.3], clavL: [7.8, 17.6, -27],
        armL: [-11.2, -61.5, 52.5], foreL: [-103.7, 0, 0], clavR: [17.9, -1.9, -41.5],
        armR: [38.9, 1.1, -66.5], foreR: [-149.3, 9.8, -5.9], thighL: [-101.6, 12.7, 23.4],
        shinL: [95.1, 1.5, 0], footL: [-14, 0, 0], thighR: [-47.2, -23.4, -44.6],
        shinR: [107.2, -1.1, -17.8], footR: [-3.2, -22.3, -0.7],
      },
    },
  }),


  SIDE_CONTROL_WORK2: P('SIDE_CONTROL_WORK2', {
    // A обходит ногами к голове; B встаёт на мост и вкручивается внутрь,
    // отбирая место под подхват.
    name: 'Сторона — шаг на север-юг',
    variantOf: 'SIDE_CONTROL',
    A: {
      root: { p: [0.337, 0.36, 0.29], r: [10, 128, 0] },
      j: {
        hips: [-54.4, -52.7, -38.2], spine: [8.5, 0.6, 23.1], chest: [48.1, 0.8, 8.6],
        neck: [-0.6, -2.7, 10.3], head: [-25.5, 0, 6], clavL: [1.8, -38, -23.9],
        armL: [-10.9, -33.6, 7], foreL: [-72, 1.5, 0], clavR: [25, -36.5, 1.2],
        armR: [47.1, 12.9, -32.6], foreR: [-123.5, -3, 0], thighL: [-54.8, -20.9, -11.1],
        shinL: [118.1, -11.8, 6.8], footL: [22.8, 4.5, 3.8], thighR: [-31.8, -18.1, -18],
        shinR: [109.2, 9.1, 1.6], footR: [19.4, -0.7, 3.8],
      },
    },
    B: {
      root: { p: [-0.109, 0.245, -0.045], r: [-90, 180, 0] },
      j: {
        hips: [20, -15.7, 12], spine: [0, -13.2, 3.8], chest: [14.5, -1.9, 9.9],
        neck: [31.7, 65.1, -7.8], head: [-5.3, 45.6, -1.1], clavL: [14.5, -14.1, 30.1],
        armL: [37.9, -32.5, 131.9], foreL: [-50.8, -24, 1.5], clavR: [10.3, -33.7, 24.9],
        armR: [-40.4, 66, -106.8], foreR: [-93.7, 0, 0], thighL: [-41.2, 6.8, 6.8],
        shinL: [59.3, 0, 0], footL: [-16, 0, 0], thighR: [-32.7, 4.5, -4],
        shinR: [42.5, 12.2, -5.1], footR: [-9.7, 7.6, 0.2],
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
// A variant inherits what its position means.
//
// `hold` is read as POSES[id].hold and nothing else, so a variant that does not
// write its own declared nothing at all — and twenty of the thirty-eight poses
// are variants. They are the halves of the hold loops, which is where the fight
// spends most of its time and where a player's screenshots come from, and every
// one of them was free to drift into a different position with the right label
// on it. They are the same position as their base by construction; if one ever
// needs to say something different it writes its own and this leaves it alone.
for (const p of Object.values(POSES)) {
  if (!p.hold && p.variantOf && POSES[p.variantOf]) p.hold = POSES[p.variantOf].hold;
}

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
