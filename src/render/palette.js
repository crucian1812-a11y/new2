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
  bone: hex('#b9ae95'),
  boneDark: hex('#6f6650'),
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

// The rules this table follows, which are the ones that make a scene read as
// Diablo II rather than as a dark modern game:
//
//   * Ambient is dim and desaturated. What you see away from a fire should be
//     a muddy near-monochrome, not a blue-lit night. Saturated colour is
//     reserved for the light sources, so a torch reads as the only warm thing
//     in the frame.
//   * Fog stays almost off. D2 had no volumetric haze — its depth came from
//     falling to black at the edges of the light, and a grey veil over the
//     whole picture is what makes a scene look washed instead of gloomy.
//   * The grade pulls towards earth: ochre, umber, dried blood. Even the ice
//     act is a warm-grey, because a cold-blue grade instantly reads as
//     moonlit fantasy rather than as this game's grime.
export const AMBIENCE = {
  coast: {
    // Frisches Haff at dusk — grey ice under a sky the colour of wet sand
    ambient: [58, 56, 54],
    ambientStrength: 0.5,
    sky: hex('#14131a'),
    fog: hex('#4a4740'),
    fogAmount: 0.07,
    grade: hex('#8a7a5c'),
    gradeAmount: 0.2,
    sunDir: [-0.5, -0.7],
    rim: hex('#b9c3cc'),
    weather: 'snow',
    weatherAmount: 0.45,
  },
  forest: {
    ambient: [48, 50, 38],
    ambientStrength: 0.46,
    sky: hex('#0e1210'),
    fog: hex('#39402e'),
    fogAmount: 0.1,
    grade: hex('#6e7442'),
    gradeAmount: 0.2,
    sunDir: [-0.4, -0.8],
    rim: hex('#b6b98e'),
    weather: 'leaves',
    weatherAmount: 0.35,
  },
  bog: {
    ambient: [42, 46, 40],
    ambientStrength: 0.42,
    sky: hex('#0b0f0d'),
    fog: hex('#37423a'),
    fogAmount: 0.16,
    grade: hex('#5f7048'),
    gradeAmount: 0.2,
    sunDir: [-0.3, -0.9],
    rim: hex('#9fc4a4'),
    weather: 'mist',
    weatherAmount: 0.55,
  },
  castle: {
    ambient: [56, 48, 42],
    ambientStrength: 0.44,
    sky: hex('#100c0a'),
    fog: hex('#463a30'),
    fogAmount: 0.09,
    grade: hex('#9c6a38'),
    gradeAmount: 0.22,
    sunDir: [-0.6, -0.6],
    rim: hex('#ffcf9a'),
    weather: 'ash',
    weatherAmount: 0.5,
  },
  grove: {
    ambient: [54, 44, 46],
    ambientStrength: 0.44,
    sky: hex('#120c12'),
    fog: hex('#463448'),
    fogAmount: 0.11,
    grade: hex('#8a4f5e'),
    gradeAmount: 0.22,
    sunDir: [-0.4, -0.8],
    rim: hex('#caa0c0'),
    weather: 'storm',
    weatherAmount: 0.7,
  },
};
