// Art direction for "Der Weg des Ritters" — a cold, painterly Baltic gothic
// palette. Everything in the game samples from here so the whole thing reads
// as one picture instead of a pile of coloured shapes.

export const rgb = (r, g, b) => [r, g, b];

export function css([r, g, b], a = 1) {
  return a >= 1
    ? `rgb(${r | 0},${g | 0},${b | 0})`
    : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export function mixc(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shade(c, f) {
  return [c[0] * f, c[1] * f, c[2] * f];
}

export function addc(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Multi-stop colour ramp. stops = [[t, [r,g,b]], ...] sorted by t. */
export function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1].slice();
  const last = stops[stops.length - 1];
  if (t >= last[0]) return last[1].slice();
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const k = (t - a[0]) / (b[0] - a[0] || 1e-6);
      return mixc(a[1], b[1], k);
    }
  }
  return last[1].slice();
}

/** Converts a hex string to [r,g,b]. */
export function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Core palette
// ---------------------------------------------------------------------------

export const PAL = {
  // Light sources
  torch: hex('#ff9a3c'),
  torchCore: hex('#ffd9a0'),
  moon: hex('#8fb4e8'),
  amber: hex('#ffb64a'),
  amberDeep: hex('#c9761a'),
  holy: hex('#ffe9b8'),
  bogfire: hex('#7ff0c0'),
  thunder: hex('#c9d8ff'),
  blood: hex('#8e1f21'),
  bloodDark: hex('#3d0d10'),
  frost: hex('#a8dcf0'),

  // Materials
  steel: hex('#8a94a3'),
  steelDark: hex('#3b424e'),
  steelLight: hex('#cfd8e4'),
  gold: hex('#c9a227'),
  leather: hex('#5a3d28'),
  leatherDark: hex('#2e1f15'),
  linen: hex('#d8d2c2'),
  cloth: hex('#6b5f52'),
  bone: hex('#ded3ba'),
  boneDark: hex('#8d8267'),
  wood: hex('#4a3524'),
  woodLight: hex('#7a5c3c'),

  // Order colours
  orderWhite: hex('#e9e6dc'),
  orderBlack: hex('#171a20'),

  // Rarity
  rarity: {
    common: hex('#c8c8c8'),
    magic: hex('#6f8cff'),
    rare: hex('#f2d24a'),
    unique: hex('#c07a2e'),
    set: hex('#31c74f'),
  },
};

// ---------------------------------------------------------------------------
// Per-act ambience: this is what makes each zone feel like a different place.
// ---------------------------------------------------------------------------

export const AMBIENCE = {
  coast: {
    // Frisches Haff at dusk — cold amber light over grey ice
    ambient: [54, 64, 82],
    ambientStrength: 0.66,
    sky: hex('#2b3446'),
    fog: hex('#5f708c'),
    fogAmount: 0.2,
    grade: hex('#7f9ccb'),
    gradeAmount: 0.16,
    sunDir: [-0.5, -0.7],
    rim: hex('#a8c8ff'),
    weather: 'snow',
    weatherAmount: 0.5,
  },
  forest: {
    ambient: [38, 50, 44],
    ambientStrength: 0.54,
    sky: hex('#141d1a'),
    fog: hex('#3d5346'),
    fogAmount: 0.28,
    grade: hex('#5f8f6a'),
    gradeAmount: 0.14,
    sunDir: [-0.4, -0.8],
    rim: hex('#9fd0a8'),
    weather: 'leaves',
    weatherAmount: 0.35,
  },
  bog: {
    ambient: [34, 44, 56],
    ambientStrength: 0.48,
    sky: hex('#10161f'),
    fog: hex('#3b5560'),
    fogAmount: 0.4,
    grade: hex('#4fd6b0'),
    gradeAmount: 0.12,
    sunDir: [-0.3, -0.9],
    rim: hex('#7ff0c0'),
    weather: 'mist',
    weatherAmount: 0.8,
  },
  castle: {
    ambient: [42, 42, 54],
    ambientStrength: 0.48,
    sky: hex('#0d0f14'),
    fog: hex('#4a4a58'),
    fogAmount: 0.24,
    grade: hex('#b08050'),
    gradeAmount: 0.13,
    sunDir: [-0.6, -0.6],
    rim: hex('#ffcf9a'),
    weather: 'ash',
    weatherAmount: 0.5,
  },
  grove: {
    ambient: [46, 40, 60],
    ambientStrength: 0.5,
    sky: hex('#1a1226'),
    fog: hex('#5a4a72'),
    fogAmount: 0.28,
    grade: hex('#a679ff'),
    gradeAmount: 0.15,
    sunDir: [-0.4, -0.8],
    rim: hex('#d8b6ff'),
    weather: 'storm',
    weatherAmount: 0.7,
  },
};
