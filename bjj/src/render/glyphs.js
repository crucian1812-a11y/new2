// A stroke font, drawn here rather than loaded.
//
// The club marks carry lettering in two alphabets, and every other way of
// getting it costs something this project has decided not to pay:
//
//   - a font file is a download, and the whole game is 455 KB;
//   - canvas 2D with a system font renders differently on every phone, and
//     Cyrillic most of all — the mark would not be the same mark twice;
//   - and neither one can be measured in node, which is where the checks live.
//
// So each glyph is a handful of polylines in a box one unit tall, stroked with
// a round pen. That is a signwriter's alphabet rather than a typeface, which
// happens to be exactly the register a club crest wants.
//
// The box: x runs from 0 to the glyph's advance, y from 0 at the baseline to 1
// at the cap height. A few letters dip below the baseline on purpose (У, Д, Q).

// Points along an ellipse, in degrees, so a bowl reads as a bowl and not as a
// polygon. Ten segments per half turn is past the point where more shows.
function arc(cx, cy, rx, ry, a0, a1, n = 12) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + (a1 - a0) * (i / n)) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

// Latin capitals. Condensed — 0.62 wide against a cap height of 1 — because
// every string here is a name on a crest, and crest lettering is narrow.
const LATIN = {
  A: [0.62, [[[0.02, 0], [0.31, 1], [0.60, 0]], [[0.135, 0.34], [0.485, 0.34]]]],
  B: [0.62, [
    [[0.10, 0], [0.10, 1]],
    [[0.10, 1], [0.33, 1], ...arc(0.33, 0.755, 0.21, 0.245, 90, -90), [0.10, 0.51]],
    [[0.10, 0.51], [0.35, 0.51], ...arc(0.35, 0.255, 0.24, 0.255, 90, -90), [0.10, 0]],
  ]],
  C: [0.62, [arc(0.33, 0.5, 0.28, 0.5, 55, 305, 16)]],
  D: [0.64, [[[0.10, 0], [0.10, 1], [0.30, 1], ...arc(0.30, 0.5, 0.28, 0.5, 90, -90), [0.30, 0], [0.10, 0]]]],
  E: [0.60, [[[0.56, 1], [0.10, 1], [0.10, 0], [0.56, 0]], [[0.10, 0.50], [0.46, 0.50]]]],
  F: [0.58, [[[0.56, 1], [0.10, 1], [0.10, 0]], [[0.10, 0.52], [0.46, 0.52]]]],
  G: [0.66, [[...arc(0.33, 0.5, 0.28, 0.5, 40, 300, 16), [0.61, 0.16], [0.61, 0.36], [0.40, 0.36]]]],
  H: [0.64, [[[0.10, 0], [0.10, 1]], [[0.54, 0], [0.54, 1]], [[0.10, 0.50], [0.54, 0.50]]]],
  I: [0.30, [[[0.15, 0], [0.15, 1]]]],
  J: [0.56, [[[0.50, 1], [0.50, 0.26], ...arc(0.30, 0.26, 0.20, 0.26, 0, -165, 8)]]],
  K: [0.62, [[[0.10, 0], [0.10, 1]], [[0.56, 1], [0.13, 0.44], [0.58, 0]]]],
  L: [0.56, [[[0.10, 1], [0.10, 0], [0.54, 0]]]],
  M: [0.72, [[[0.06, 0], [0.06, 1], [0.35, 0.30], [0.64, 1], [0.64, 0]]]],
  N: [0.64, [[[0.10, 0], [0.10, 1], [0.54, 0], [0.54, 1]]]],
  O: [0.66, [arc(0.33, 0.5, 0.28, 0.5, 0, 360, 22)]],
  P: [0.60, [[[0.10, 0], [0.10, 1], [0.33, 1], ...arc(0.33, 0.745, 0.22, 0.255, 90, -90), [0.10, 0.49]]]],
  Q: [0.66, [arc(0.33, 0.5, 0.28, 0.5, 0, 360, 22), [[0.34, 0.20], [0.68, -0.18]]]],
  R: [0.62, [
    [[0.10, 0], [0.10, 1], [0.33, 1], ...arc(0.33, 0.745, 0.22, 0.255, 90, -90), [0.10, 0.49]],
    [[0.34, 0.49], [0.58, 0]],
  ]],
  // Written out point by point rather than as two arcs. Two arcs joined at the
  // waist is the obvious construction and it is the wrong one: the tangents do
  // not meet, and the letter comes out as a Ƨ with a kink in it.
  S: [0.62, [[
    [0.54, 0.78], [0.46, 0.94], [0.30, 1.00], [0.14, 0.94], [0.09, 0.78],
    [0.16, 0.63], [0.36, 0.55], [0.50, 0.45], [0.54, 0.29],
    [0.46, 0.10], [0.28, 0.03], [0.12, 0.09], [0.06, 0.22],
  ]]],
  T: [0.62, [[[0.02, 1], [0.60, 1]], [[0.31, 1], [0.31, 0]]]],
  U: [0.64, [[[0.10, 1], [0.10, 0.28], ...arc(0.33, 0.28, 0.23, 0.28, 180, 360, 12), [0.56, 1]]]],
  V: [0.62, [[[0.02, 1], [0.31, 0], [0.60, 1]]]],
  W: [0.80, [[[0.02, 1], [0.21, 0], [0.40, 0.68], [0.59, 0], [0.78, 1]]]],
  X: [0.62, [[[0.04, 0], [0.58, 1]], [[0.04, 1], [0.58, 0]]]],
  Y: [0.62, [[[0.04, 1], [0.31, 0.50], [0.58, 1]], [[0.31, 0.50], [0.31, 0]]]],
  Z: [0.62, [[[0.06, 1], [0.56, 1], [0.06, 0], [0.58, 0]]]],
  // Narrow, deliberately: a zero the same width as an O is the same shape as
  // an O, and on a scoreboard that is a bug rather than a style.
  '0': [0.50, [arc(0.25, 0.5, 0.19, 0.5, 0, 360, 20)]],
  '1': [0.40, [[[0.08, 0.78], [0.24, 1], [0.24, 0]]]],
  '2': [0.60, [[...arc(0.31, 0.72, 0.23, 0.26, 170, -30, 12), [0.08, 0], [0.56, 0]]]],
  '3': [0.60, [[...arc(0.30, 0.735, 0.22, 0.245, 165, -60, 10), [0.30, 0.5], ...arc(0.30, 0.255, 0.24, 0.255, 60, -180, 12)]]],
  '4': [0.62, [[[0.42, 0], [0.42, 1], [0.04, 0.30], [0.58, 0.30]]]],
  '5': [0.60, [[[0.54, 1], [0.14, 1], [0.10, 0.56], ...arc(0.31, 0.29, 0.25, 0.29, 80, -150, 12)]]],
  '6': [0.62, [[...arc(0.32, 0.62, 0.26, 0.38, 60, 200, 10), [0.06, 0.30], ...arc(0.32, 0.30, 0.26, 0.30, 180, -180, 16)]]],
  '7': [0.58, [[[0.06, 1], [0.54, 1], [0.20, 0]]]],
  '8': [0.62, [arc(0.32, 0.735, 0.22, 0.245, 0, 360, 16), arc(0.32, 0.26, 0.26, 0.26, 0, 360, 16)]],
  '9': [0.62, [[...arc(0.32, 0.70, 0.26, 0.30, -120, 180, 16), [0.58, 0.70], ...arc(0.32, 0.38, 0.26, 0.38, 20, -120, 10)]]],
};

// Cyrillic. Half of it is the Latin shape under another name — К is K and Р is
// P — and the rest is its own. Sharing the geometry rather than copying it is
// not thrift: it is the only way a change to O reaches О as well.
const SHARED = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X' };

const CYRILLIC = {
  Б: [0.60, [
    [[0.10, 1], [0.10, 0]],
    [[0.10, 1], [0.52, 1]],
    [[0.10, 0.52], [0.34, 0.52], ...arc(0.34, 0.26, 0.24, 0.26, 90, -90), [0.10, 0]],
  ]],
  Г: [0.56, [[[0.10, 0], [0.10, 1], [0.54, 1]]]],
  Д: [0.68, [
    [[0.05, -0.17], [0.05, 0.13], [0.63, 0.13], [0.63, -0.17]],
    [[0.15, 0.13], [0.23, 1], [0.52, 1], [0.52, 0.13]],
  ]],
  Ж: [0.86, [[[0.43, 0], [0.43, 1]], [[0.06, 1], [0.43, 0.5], [0.06, 0]], [[0.80, 1], [0.43, 0.5], [0.80, 0]]]],
  З: [0.60, [[...arc(0.30, 0.745, 0.23, 0.255, 165, -70, 10), [0.30, 0.5], ...arc(0.30, 0.255, 0.25, 0.255, 70, -175, 12)]]],
  И: [0.64, [[[0.10, 1], [0.10, 0], [0.54, 1], [0.54, 0]]]],
  Й: [0.64, [[[0.10, 1], [0.10, 0], [0.54, 1], [0.54, 0]], arc(0.32, 1.02, 0.15, 0.14, 200, 340, 6)]],
  Л: [0.64, [[[0.03, 0], [0.17, 0.86], [0.21, 1], [0.56, 1], [0.56, 0]]]],
  П: [0.64, [[[0.10, 0], [0.10, 1], [0.54, 1], [0.54, 0]]]],
  У: [0.64, [[[0.04, 1], [0.33, 0.32]], [[0.62, 1], [0.19, -0.26]]]],
  Ф: [0.74, [[[0.37, 1.02], [0.37, -0.02]], arc(0.37, 0.55, 0.30, 0.30, 0, 360, 20)]],
  Ц: [0.68, [[[0.10, 1], [0.10, 0.13], [0.54, 0.13], [0.54, 1]], [[0.54, 0.13], [0.62, 0.13], [0.62, -0.17]]]],
  Ч: [0.62, [[[0.52, 0], [0.52, 1]], [[0.10, 1], [0.10, 0.52], [0.52, 0.52]]]],
  Ш: [0.82, [[[0.08, 1], [0.08, 0], [0.74, 0], [0.74, 1]], [[0.41, 1], [0.41, 0]]]],
  Щ: [0.88, [[[0.08, 1], [0.08, 0], [0.74, 0], [0.74, 1]], [[0.41, 1], [0.41, 0]], [[0.74, 0], [0.82, 0], [0.82, -0.17]]]],
  Ы: [0.76, [
    [[0.08, 1], [0.08, 0]], [[0.66, 1], [0.66, 0]],
    [[0.08, 0.52], [0.32, 0.52], ...arc(0.32, 0.26, 0.22, 0.26, 90, -90), [0.08, 0]],
  ]],
  Ь: [0.56, [[[0.10, 1], [0.10, 0]], [[0.10, 0.52], [0.30, 0.52], ...arc(0.30, 0.26, 0.22, 0.26, 90, -90), [0.10, 0]]]],
  Э: [0.62, [[...arc(0.30, 0.5, 0.28, 0.5, 125, -125, 16)], [[0.16, 0.5], [0.46, 0.5]]]],
  Ю: [0.78, [[[0.10, 1], [0.10, 0]], [[0.10, 0.5], [0.24, 0.5]], arc(0.50, 0.5, 0.26, 0.5, 0, 360, 20)]],
  Я: [0.62, [
    [[0.54, 0], [0.54, 1], [0.31, 1], ...arc(0.31, 0.745, 0.22, 0.255, 90, 270), [0.54, 0.49]],
    [[0.30, 0.49], [0.06, 0]],
  ]],
};

const PUNCT = {
  ' ': [0.32, []],
  '-': [0.46, [[[0.06, 0.44], [0.40, 0.44]]]],
  '·': [0.30, [[[0.15, 0.46], [0.15, 0.46]]]],   // a dot is a zero-length stroke
  '.': [0.26, [[[0.13, 0.03], [0.13, 0.03]]]],
  ',': [0.26, [[[0.15, 0.05], [0.06, -0.16]]]],
  "'": [0.24, [[[0.12, 1.0], [0.12, 0.74]]]],
  '/': [0.52, [[[0.04, -0.06], [0.48, 1.06]]]],
  '&': [0.70, [[[0.62, 0], [0.20, 0.62], ...arc(0.31, 0.80, 0.16, 0.20, 180, -60, 8), ...arc(0.33, 0.26, 0.27, 0.26, 65, -120, 10), [0.66, 0.40]]]],
  // Two dots, one above the other, at the two heights a scoreboard colon sits:
  // it separates minutes from seconds, not a sentence.
  ':': [0.30, [[[0.15, 0.72], [0.15, 0.72]], [[0.15, 0.28], [0.15, 0.28]]]],
};

export const GLYPHS = { ...LATIN, ...CYRILLIC, ...PUNCT };
for (const [cyr, lat] of Object.entries(SHARED)) GLYPHS[cyr] = GLYPHS[lat];

// Everything downstream asks for a string, not a character, and a missing glyph
// has to be loud: a crest that silently drops a letter is worse than one that
// refuses to build.
export function glyph(ch) {
  const g = GLYPHS[ch] || GLYPHS[ch.toUpperCase()];
  if (!g) throw new Error(`no glyph for ${JSON.stringify(ch)} (U+${ch.codePointAt(0).toString(16).toUpperCase()})`);
  return g;
}

// Width of a string in cap heights, tracking included. The layout code needs
// this before it can centre anything.
export function textWidth(str, tracking = 0.08) {
  let w = 0;
  for (const ch of str) w += glyph(ch)[0] + tracking;
  return str.length ? w - tracking : 0;
}

// The pen path for a string, laid out from the origin along +x, each stroke a
// polyline in the same units as the glyph box.
export function textStrokes(str, tracking = 0.08) {
  const out = [];
  let x = 0;
  for (const ch of str) {
    const [adv, strokes] = glyph(ch);
    for (const s of strokes) out.push(s.map(([px, py]) => [px + x, py]));
    x += adv + tracking;
  }
  return out;
}
