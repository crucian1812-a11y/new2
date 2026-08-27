// The club's marks: the crest on the tatami and the patches on the kimono.
//
// Both clubs' emblems are drawn here as vector artwork — filled contours and
// stroked polylines — and rasterised into one atlas at load. No image files, for
// the same reason nothing else in the game has any: the whole download is under
// half a megabyte and a logo PNG large enough to read on a three-metre mat is
// not.
//
// The atlas is stored PREMULTIPLIED. A patch is composited over cloth that is
// already lit, and premultiplied alpha is the only form that survives bilinear
// filtering and mipmapping without a dark halo around every letter.
//
// The marks belong to Ares (клуб единоборств «Арес») and to its affiliation,
// Olavo Abreu Brazilian Jiu-Jitsu. They are the reason this build exists: it is
// for the club, not a generic demo, and it is the one place where invented
// branding would have been worse than the real thing.

import { textStrokes, textWidth } from './glyphs.js';

// Every word that appears on the mat or on a kimono, in one place. The font is
// drawn rather than loaded, so a letter nobody thought about is not a fallback
// glyph — it is an exception at load. tools/mark-check.mjs walks this list
// against the alphabet before anything is rasterised.
export const MARK_TEXT = {
  club: 'КЛУБ ЕДИНОБОРСТВ',
  ares: 'ARES',
  affil: 'OLAVO ABREU',
  style: 'BRAZILIAN JIU-JITSU',
  sep: '·',
};

/* ------------------------------------------------------------------ palette */

// Sampled off the club's own artwork and then pulled a little towards the
// game's lighting: these are albedo values, not screen colours, and a mark that
// matches the print file exactly comes out too hot once the key light is on it.
export const PAL = {
  orange:   [0.937, 0.573, 0.114],
  orangeLo: [0.706, 0.365, 0.047],
  steel:    [0.639, 0.671, 0.694],
  steelLo:  [0.325, 0.345, 0.365],
  ink:      [0.055, 0.055, 0.066],
  bone:     [0.925, 0.925, 0.906],
  crimson:  [0.612, 0.106, 0.145],
  red:      [0.831, 0.125, 0.098],
};

/* --------------------------------------------------------------- the canvas */

// A float canvas in premultiplied RGBA, with a model-to-pixel transform so the
// artwork can be authored in sane units (a unit circle) instead of texels.
function canvas(w, h) {
  return { w, h, px: new Float32Array(w * h * 4), s: 1, ox: 0, oy: 0 };
}

// Model space is y-up and centred; the raster is y-down, top row first.
function view(cv, scale, cx = cv.w / 2, cy = cv.h / 2) {
  cv.s = scale; cv.ox = cx; cv.oy = cy;
  return cv;
}

const tx = (cv, p) => [cv.ox + p[0] * cv.s, cv.oy - p[1] * cv.s];

function blend(cv, i, cov, col, alpha) {
  const a = cov * alpha;
  if (a <= 0) return;
  const k = 1 - a;
  cv.px[i] = col[0] * a + cv.px[i] * k;
  cv.px[i + 1] = col[1] * a + cv.px[i + 1] * k;
  cv.px[i + 2] = col[2] * a + cv.px[i + 2] * k;
  cv.px[i + 3] = a + cv.px[i + 3] * k;
}

/* ------------------------------------------------------------- filled paths */

// Scanline fill, nonzero winding, four subsamples down and exact coverage
// across. Exact coverage across is what keeps a long shallow edge — the leg of
// an A, the taper of a blade — from turning into a staircase.
function fill(cv, contours, col, alpha = 1) {
  const paths = contours.map((c) => c.map((p) => tx(cv, p)));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const c of paths) for (const [x, y] of c) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const px0 = Math.max(0, Math.floor(x0)), px1 = Math.min(cv.w - 1, Math.ceil(x1));
  const py0 = Math.max(0, Math.floor(y0)), py1 = Math.min(cv.h - 1, Math.ceil(y1));
  if (px1 < px0 || py1 < py0) return;

  const SS = 4;
  const cov = new Float32Array(px1 - px0 + 1);
  const xs = [];
  for (let y = py0; y <= py1; y++) {
    cov.fill(0);
    for (let s = 0; s < SS; s++) {
      const sy = y + (s + 0.5) / SS;
      xs.length = 0;
      for (const c of paths) {
        for (let i = 0; i < c.length; i++) {
          const a = c[i], b = c[(i + 1) % c.length];
          if ((a[1] <= sy) === (b[1] <= sy)) continue;
          const t = (sy - a[1]) / (b[1] - a[1]);
          xs.push([a[0] + (b[0] - a[0]) * t, b[1] > a[1] ? 1 : -1]);
        }
      }
      if (!xs.length) continue;
      xs.sort((p, q) => p[0] - q[0]);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i][1];
        if (wind === 0) continue;
        span(cov, px0, px1, xs[i][0], xs[i + 1][0], 1 / SS);
      }
    }
    const row = y * cv.w;
    for (let i = 0; i < cov.length; i++) {
      if (cov[i] > 0.0005) blend(cv, (row + px0 + i) * 4, Math.min(1, cov[i]), col, alpha);
    }
  }
}

// Add a horizontal span's coverage, with the fractional ends done properly.
function span(cov, px0, px1, xa, xb, weight) {
  if (xb <= xa) return;
  const a = Math.max(xa, px0), b = Math.min(xb, px1 + 1);
  if (b <= a) return;
  const ia = Math.floor(a), ib = Math.floor(b - 1e-9);
  if (ia === ib) { cov[ia - px0] += (b - a) * weight; return; }
  cov[ia - px0] += (ia + 1 - a) * weight;
  for (let i = ia + 1; i < ib; i++) cov[i - px0] += weight;
  cov[ib - px0] += (b - ib) * weight;
}

/* ------------------------------------------------------------------ strokes */

// A round pen along a polyline, as a distance field. Strokes are how the
// lettering exists at all, so this is the hot path, and the shape of the hot
// path is the whole trick: one call per polyline, never one call per string.
// Measured against the bounding box of a whole line of arc-set type, the field
// costs sixty million distance evaluations and the atlas takes two and a half
// seconds to build; per letter-stroke it is a tenth of that and the result is
// identical.
function stroke(cv, lines, width, col, alpha = 1) {
  for (const line of lines) strokeOne(cv, line, width, col, alpha);
}

function strokeOne(cv, line, width, col, alpha) {
  if (!line.length) return;
  const hw = (width * cv.s) / 2;
  const p = line.map((q) => tx(cv, q));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of p) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const px0 = Math.max(0, Math.floor(x0 - hw - 1)), px1 = Math.min(cv.w - 1, Math.ceil(x1 + hw + 1));
  const py0 = Math.max(0, Math.floor(y0 - hw - 1)), py1 = Math.min(cv.h - 1, Math.ceil(y1 + hw + 1));
  const n = Math.max(1, p.length - 1);
  for (let y = py0; y <= py1; y++) {
    for (let x = px0; x <= px1; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      let d2 = Infinity;
      for (let i = 0; i < n; i++) {
        const a = p[i], b = p[i + 1] || p[i];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((cx - a[0]) * dx + (cy - a[1]) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = cx - a[0] - dx * t, ey = cy - a[1] - dy * t;
        const e = ex * ex + ey * ey;
        if (e < d2) d2 = e;
      }
      const cov = Math.min(1, Math.max(0, hw + 0.5 - Math.sqrt(d2)));
      if (cov > 0.002) blend(cv, (y * cv.w + x) * 4, cov, col, alpha);
    }
  }
}

/* ------------------------------------------------------- circles and rings */

function circlePts(cx, cy, r, n = 64) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

// Discs and rings are done on the radius rather than as polygons. A ring drawn
// as a sixty-four-sided polyline costs a distance field over the whole cell —
// the single most expensive thing in the atlas — and it is a circle: it has a
// closed form, and the closed form is also rounder.
function radial(cv, cx, cy, rOuter, band, col, alpha) {
  const c = tx(cv, [cx, cy]);
  const R = rOuter * cv.s, W = band * cv.s;
  const px0 = Math.max(0, Math.floor(c[0] - R - 1)), px1 = Math.min(cv.w - 1, Math.ceil(c[0] + R + 1));
  const py0 = Math.max(0, Math.floor(c[1] - R - 1)), py1 = Math.min(cv.h - 1, Math.ceil(c[1] + R + 1));
  for (let y = py0; y <= py1; y++) {
    const dy = y + 0.5 - c[1];
    for (let x = px0; x <= px1; x++) {
      const dx = x + 0.5 - c[0];
      const d = Math.sqrt(dx * dx + dy * dy);
      // A disc is the ring whose band reaches the middle, so one loop does both.
      const cov = Math.min(1, Math.max(0, Math.min(R - d, W === Infinity ? Infinity : d - (R - W)) + 0.5));
      if (cov > 0.002) blend(cv, (y * cv.w + x) * 4, cov, col, alpha);
    }
  }
}

const disc = (cv, cx, cy, r, col, alpha = 1) => radial(cv, cx, cy, r, Infinity, col, alpha);
// `r` is the centre line of the ring, as everywhere else in this file.
const ring = (cv, cx, cy, r, w, col, alpha = 1) => radial(cv, cx, cy, r + w / 2, w, col, alpha);

/* ---------------------------------------------------------------- lettering */

function text(cv, str, { x = 0, y = 0, size = 1, weight = 0.16, col = PAL.ink, align = 'center', tracking = 0.08, alpha = 1 }) {
  const w = textWidth(str, tracking) * size;
  const ox = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const lines = textStrokes(str, tracking).map((s) => s.map(([gx, gy]) => [ox + gx * size, y + gy * size]));
  stroke(cv, lines, weight * size, col, alpha);
  return w;
}

// The same lettering bent round a circle. `flip` puts it along the bottom, the
// way the bottom half of every roundel in the sport is set: still reading left
// to right, with the tops of the letters pointing at the middle.
function arcText(cv, str, { cx = 0, cy = 0, r = 1, size = 0.15, weight = 0.16, col = PAL.ink, tracking = 0.08, flip = false, alpha = 1 }) {
  const w = textWidth(str, tracking) * size;
  const lines = textStrokes(str, tracking).map((line) => line.map(([gx, gy]) => {
    const along = (gx * size - w / 2) / r;               // radians from the middle
    const rad = flip ? r - gy * size : r + gy * size;
    const a = flip ? -Math.PI / 2 + along : Math.PI / 2 - along;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  }));
  stroke(cv, lines, weight * size, col, alpha);
  return w / r;   // the angle it swept, which is what a caller needs to check
}

/* -------------------------------------------------------------- the artwork */

// Two points mirrored about x, for symmetric silhouettes authored once.
const mirrorY = (pts) => [...pts, ...pts.slice(0, -1).reverse().map(([x, y]) => [-x, y])];

// A Corinthian helmet, seen face on: dome, cheek plates, the crest above and
// the T of the face opening. It is the club's mark and it has to survive being
// forty pixels tall on a phone, so it is built from six shapes and carries no
// detail finer than the eye slot.
function helmet(cv, cx, cy, s) {
  const at = (p) => [cx + p[0] * s, cy + p[1] * s];
  // The crest goes down first, so it rises out of the dome instead of sitting
  // on top of it like a hat.
  const plume = [[-0.06, 0.40], [-0.12, 1.10], [0.04, 1.58], [0.26, 1.70], [0.38, 1.38], [0.30, 0.92], [0.20, 0.50]];
  fill(cv, [plume.map(at)], PAL.crimson);
  stroke(cv, [[...plume, plume[0]].map(at)], 0.06 * s, PAL.steel);

  const shell = mirrorY([
    [0, 1.02], [0.38, 0.92], [0.62, 0.68], [0.72, 0.32], [0.70, -0.10],
    [0.60, -0.46], [0.42, -0.84], [0.21, -1.02], [0, -1.08],
  ]);
  fill(cv, [shell.map(at)], PAL.bone);
  stroke(cv, [[...shell, shell[0]].map(at)], 0.06 * s, PAL.steel);

  // The brow band, which is what stops the shell reading as a bald head.
  fill(cv, [[[-0.675, 0.46], [0.675, 0.46], [0.705, 0.24], [-0.705, 0.24]].map(at)], PAL.orange);

  // The face opening: eye band across, nose ridge down. Negative space, drawn
  // as ink rather than cut out of the shell.
  const mask = [
    [-0.52, 0.22], [0.52, 0.22], [0.52, -0.10], [0.15, -0.10],
    [0.13, -0.86], [-0.13, -0.86], [-0.15, -0.10], [-0.52, -0.10],
  ];
  fill(cv, [mask.map(at)], PAL.ink);
  // Eyes. Slanted, because a level slot is a letterbox and a slanted one is a
  // face looking at you.
  for (const sx of [-1, 1]) {
    fill(cv, [[[sx * 0.46, 0.16], [sx * 0.22, 0.08], [sx * 0.22, -0.05], [sx * 0.46, -0.02]].map(at)], PAL.bone);
  }
}

// A sword whose blade is a lightning bolt, which is the club's other device.
// Authored pointing up with the hilt below the origin, then rotated by the
// caller; the pair of them cross behind the A.
function sword(cv, cx, cy, s, deg) {
  const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const at = ([x, y]) => [cx + (x * ca - y * sa) * s, cy + (x * sa + y * ca) * s];
  const blade = [
    [-0.13, -0.30], [0.13, -0.30], [0.04, 0.10], [0.20, 0.17],
    [-0.02, 0.58], [0.10, 0.64], [0.0, 1.08],
    [-0.10, 0.64], [0.02, 0.58], [-0.20, 0.17], [-0.04, 0.10],
  ];
  fill(cv, [blade.map(at)], PAL.steel);
  // An opaque colour, not black at half strength: a mark drawn with
  // transparency has as many colours as it has overlaps, and the check that
  // reads the club's palette back out of the atlas cannot tell those from a
  // mistake.
  stroke(cv, [[...blade, blade[0]].map(at)], 0.05 * s, PAL.steelLo);
  fill(cv, [[[-0.34, -0.30], [0.34, -0.30], [0.34, -0.43], [-0.34, -0.43]].map(at)], PAL.orange);
  fill(cv, [[[-0.07, -0.43], [0.07, -0.43], [0.07, -0.78], [-0.07, -0.78]].map(at)], PAL.orangeLo);
  fill(cv, [circlePts(0, -0.85, 0.11).map(at)], PAL.orange);
}

// The A of Ares: an angular capital with the helmet standing in its counter and
// the swords crossed behind it. The order is the drawing: swords first so they
// read as behind, the A over them, the helmet last so no leg cuts across it.
function aresMark(cv, cx, cy, s) {
  const at = ([x, y]) => [cx + x * s, cy + y * s];
  // Near horizontal, not near vertical. Upright swords behind an A come out of
  // the top of it like a pair of antennae; crossed at sixty degrees they read
  // as crossed swords and their tips clear the legs on both sides.
  sword(cv, cx, cy - 0.08 * s, s * 0.98, 62);
  sword(cv, cx, cy - 0.08 * s, s * 0.98, -62);

  const outer = [
    [-0.56, -0.54], [-0.22, 0.54], [0.22, 0.54], [0.56, -0.54],
    [0.27, -0.54], [0.20, -0.28], [-0.20, -0.28], [-0.27, -0.54],
  ];
  const counter = [[-0.16, -0.09], [0.16, -0.09], [0.0, 0.38]];
  fill(cv, [outer.map(at), counter.map(at)], PAL.orange);
  stroke(cv, [[...outer, outer[0]].map(at), [...counter, counter[0]].map(at)], 0.055 * s, PAL.steel);

  // Sized so the dome tops out level with the apex of the A and the chin sits
  // on the crossbar: the helmet stands in the counter rather than hiding the
  // letter it is standing in.
  helmet(cv, cx, cy + 0.24 * s, s * 0.27);
}

// Ares, as a roundel: the shape a mat crest wants, and the shape a shoulder
// patch wants, and the same artwork serves both.
function aresRoundel(px) {
  const cv = view(canvas(px, px), px / 2.08);
  ring(cv, 0, 0, 0.955, 0.045, PAL.orange);
  ring(cv, 0, 0, 0.885, 0.014, PAL.steel);
  // Light lettering, not dark. This roundel is printed on the competition area
  // and the competition area is deep blue: black type on it is a hole, and the
  // club's own print file — black on white — is the one thing that cannot be
  // copied across unchanged.
  arcText(cv, MARK_TEXT.club, { r: 0.745, size: 0.115, weight: 0.20, col: PAL.bone, tracking: 0.13 });
  arcText(cv, MARK_TEXT.ares, { r: 0.795, size: 0.185, weight: 0.21, col: PAL.bone, tracking: 0.18, flip: true });
  for (const sx of [-1, 1]) disc(cv, sx * 0.60, -0.545, 0.035, PAL.orange);
  aresMark(cv, 0, 0.03, 0.62);
  return cv;
}

// The affiliation. A white disc with a black ring, the anarchist A that the
// academy has used since it opened, and the two arcs of its name.
function olavoRoundel(px) {
  const cv = view(canvas(px, px), px / 2.08);
  disc(cv, 0, 0, 0.99, PAL.bone);
  // The black ring sits at the very rim, where the print has it. On the mat it
  // makes no difference; on a white kimono it is the entire difference between
  // a patch and a smudge, because a white disc on white cotton has no edge.
  ring(cv, 0, 0, 0.952, 0.075, PAL.ink);
  arcText(cv, MARK_TEXT.affil, { r: 0.755, size: 0.135, weight: 0.21, col: PAL.ink, tracking: 0.10 });
  arcText(cv, MARK_TEXT.style, { r: 0.795, size: 0.105, weight: 0.21, col: PAL.ink, tracking: 0.06, flip: true });
  disc(cv, 0, 0, 0.63, PAL.ink);
  ring(cv, 0, 0, 0.475, 0.155, PAL.red);
  const a = [
    [[-0.40, -0.44], [0.015, 0.52]],
    [[0.015, 0.52], [0.42, -0.44]],
    [[-0.55, -0.14], [0.58, -0.05]],
  ];
  stroke(cv, a, 0.20, PAL.ink);      // the black keyline the mark is cut from
  stroke(cv, a, 0.125, PAL.red);
  return cv;
}

// The back patch: a real piece of cloth with a border, because a mark floating
// on a white jacket reads as a decal and a bordered one reads as sewn on.
function aresPatch(w, h) {
  const cv = view(canvas(w, h), h / 2.16);
  const rx = 0.75, ry = 1.02, r = 0.15;
  const rounded = [];
  for (const [sx, sy, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
    for (let i = 0; i <= 6; i++) {
      const a = ((a0 + (i / 6) * 90) * Math.PI) / 180;
      rounded.push([sx * (rx - r) + r * Math.cos(a) * Math.sign(Math.cos(a) || sx) * 0 + r * Math.cos(a),
        sy * (ry - r) + r * Math.sin(a)]);
    }
  }
  // The corner arcs above are generated about the four corner centres.
  const box = [];
  for (const [cx2, cy2, a0] of [[rx - r, ry - r, 0], [-(rx - r), ry - r, 90], [-(rx - r), -(ry - r), 180], [rx - r, -(ry - r), 270]]) {
    for (let i = 0; i <= 6; i++) {
      const a = ((a0 + (i / 6) * 90) * Math.PI) / 180;
      box.push([cx2 + r * Math.cos(a), cy2 + r * Math.sin(a)]);
    }
  }
  fill(cv, [box], PAL.ink);
  stroke(cv, [[...box, box[0]]], 0.055, PAL.orange);
  aresMark(cv, 0, 0.30, 0.62);
  text(cv, MARK_TEXT.club, { x: 0, y: -0.55, size: 0.115, weight: 0.19, col: PAL.steel, tracking: 0.12 });
  text(cv, MARK_TEXT.ares, { x: 0, y: -0.90, size: 0.26, weight: 0.20, col: PAL.orange, tracking: 0.14 });
  return cv;
}

// One line of type, for the edge of the mat and for the thigh of the trousers.
function wordmark(w, h) {
  const cv = view(canvas(w, h), h / 2.0);
  const size = 0.62;
  const parts = [MARK_TEXT.club, MARK_TEXT.sep, MARK_TEXT.ares];
  const widths = parts.map((p, i) => textWidth(p, i === 2 ? 0.16 : 0.12) * size);
  const gap = 0.30;
  let x = -(widths.reduce((a, b) => a + b, 0) + gap * 2) / 2;
  parts.forEach((p, i) => {
    text(cv, p, {
      x: x + widths[i] / 2, y: -size / 2, size, weight: 0.185,
      col: i === 2 ? PAL.orange : PAL.ink, tracking: i === 2 ? 0.16 : 0.12,
    });
    x += widths[i] + gap;
  });
  return cv;
}

/* ------------------------------------------------------------------ the atlas */

// Where each mark lives, in texels of a 1024 atlas, top-left origin.
export const CELLS = {
  aresRound:  [0, 0, 512, 512],
  olavoRound: [512, 0, 512, 512],
  aresPatch:  [0, 512, 384, 512],
  wordmark:   [384, 512, 640, 128],
};
const ATLAS = 1024;

// Texture coordinates for a cell, after the vertical flip that makes the atlas
// GL-side up. Handed to the shader as uniforms rather than written into it
// twice, so the layout has exactly one home.
export function cellRect(name) {
  const [x, y, w, h] = CELLS[name];
  return [x / ATLAS, 1 - (y + h) / ATLAS, w / ATLAS, h / ATLAS];
}

export function markAtlas(scale = 1) {
  const S = Math.round(ATLAS * scale);
  const out = new Uint8Array(S * S * 4);
  const draw = {
    aresRound: (w, h) => aresRoundel(Math.min(w, h)),
    olavoRound: (w, h) => olavoRoundel(Math.min(w, h)),
    aresPatch,
    wordmark,
  };
  for (const [name, [x, y, w, h]] of Object.entries(CELLS)) {
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const cv = draw[name](cw, ch);
    for (let j = 0; j < ch; j++) {
      const dstRow = S - 1 - (Math.round(y * scale) + j);   // flip: GL v runs up
      if (dstRow < 0 || dstRow >= S) continue;
      for (let i = 0; i < cw; i++) {
        const src = (j * cw + i) * 4;
        const dst = (dstRow * S + Math.round(x * scale) + i) * 4;
        for (let k = 0; k < 4; k++) out[dst + k] = Math.max(0, Math.min(255, Math.round(cv.px[src + k] * 255)));
      }
    }
  }
  return { size: S, data: out };
}

/* --------------------------------------------------------------- placement */

// Where the marks go on the mat, in metres. The mat is the one surface the
// camera never leaves, so this is laid out like a real competition area: the
// club crest in the middle of the fighting square, the affiliation in the four
// corners of the safety border, the name along the edges.
export const MAT_MARKS = {
  crest: { size: 2.3 },                       // centred on the middle of the mat
  corner: { at: 5.55, size: 1.95 },           // ±at in x and z, inside the border
  edge: { at: 6.05, len: 5.4, height: 0.62 }, // the wordmark, one per side
};

// Where the patches go on the kimono, in the fighter's own body UV: u runs
// round the body (the front of the chest is +1.79, the middle of the back is
// -1.88), v is height in metres times eight. These numbers were measured off
// the baked mesh, not guessed — see tools/mark-check.mjs, which fails if a
// patch drifts onto skin, onto the collar, or off the jacket entirely.
// `face` is where the cloth under the patch actually points, as a bearing off
// the fighter's nose: 0 straight ahead, 180 straight behind, +90 his own left.
// It is not decoration — the checker measures the mesh normals and fails if a
// patch has slid round the body, which is exactly what the chest one did on the
// first attempt: u 0.60 reads like the middle of the chest and is the ribs.
export const GI_PATCHES = [
  { cell: 'aresPatch', u: -1.88, du: 0.77, v: 9.75, dv: 1.04, face: 180 },  // upper back, 19×26 cm
  { cell: 'olavoRound', u: 0.88, du: 0.20, v: 8.90, dv: 0.28, face: 30 },   // left chest, 7 cm
  { cell: 'wordmark', u: 0.30, du: 0.446, v: 5.05, dv: 0.11, face: 80 },    // left thigh, 15×3 cm
];
