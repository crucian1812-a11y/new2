// Sprite baking with SDF lighting.
//
// Every prop in this game is a flat bitmap: a pine, a boulder and a ruined
// wall are all painted by hand into a canvas and then blitted. Painting them
// carries the form well enough while the light stays where the painter put it
// — upper left, always — but the world does not oblige. A brazier burning to
// the right of a rock lights the rock's left side, because that is the side
// the paint says is lit, and the eye reads the rock as a sticker.
//
// The fix is the one the offline renderers use: recover a surface from the
// silhouette, and light it.
//
//   1. A signed distance field is built from the sprite's own alpha — an exact
//      Euclidean transform, so every pixel knows how far it is from the edge
//      of the shape it belongs to.
//   2. That distance becomes a height: a rounded bevel that climbs steeply at
//      the silhouette and flattens out inside. The interior stays flat on
//      purpose. The paint in there is the artist's shading and it is better
//      than anything a distance field can invent; what the field adds is the
//      turn of the surface at the rim, which is exactly where the paint has
//      nothing to say.
//   3. The gradient of that height is a normal, and a normal can be lit.
//
// Two things are baked from it, both once per sprite, never per frame:
//
//   * a sculpt pass — form shading and cavity darkening from the house key
//     light, composited straight into the sprite's own pixels;
//   * a directional basis — four small greyscale layers holding the surface's
//     response to light arriving from screen +x, -x, +y and -y. Because
//     N·L is linear in L, any light direction is two of those four blended by
//     the light's own components, which is how a static bitmap ends up
//     turning to face a torch that did not exist when it was baked.
//
// Nothing here runs during play. The bake happens when a prop is first asked
// for, and the frame cost afterwards is two blits.

import { clamp01, clamp } from '../core/math.js';
import { makeCanvas, ctxOf } from './textures.js';

// The house key light, in screen space: up and to the left, the direction
// every prop in props.js is painted as if lit from, and the direction the
// actors' rigs default to. z is the part of it pointing at the camera.
export const KEY_LIGHT = (() => {
  const v = [-0.6, -0.78, 0.62];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

// Layers are baked at a reduced resolution and stretched back over the sprite
// when drawn. Shading is low frequency — it is the one thing in the picture
// that survives being blurry — and a quarter-size layer costs a sixteenth of
// the memory. This caps the long edge of a layer.
const LAYER_MAX = 96;

// And the fields themselves are built no larger than this. Past a couple of
// hundred pixels a silhouette's shading has nothing left to say that a smaller
// grid does not already say.
const FIELD_MAX = 160;

// ---------------------------------------------------------------------------
// Distance transform
// ---------------------------------------------------------------------------

/**
 * Felzenszwalb & Huttenlocher's exact distance transform, one dimension at a
 * time. It walks a lower envelope of parabolas, which sounds worse than it is:
 * the whole thing is O(n) per row, so a 300x300 sprite is transformed in about
 * a tenth of a millisecond and the result is exact — no chamfer approximation,
 * no diagonal artefacts creeping into the normals.
 */
function edt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

const INF = 1e12;

/**
 * Squared distance from every pixel to the nearest zero of `mask`.
 * `mask[i]` non-zero means "seed here"; the result is in squared pixels.
 */
function edt2d(mask, w, h) {
  const d2 = new Float32Array(w * h);
  const n = Math.max(w, h);
  const f = new Float32Array(n);
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = mask[row + x] ? 0 : INF;
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) d2[row + x] = d[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d2[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) d2[y * w + x] = d[y];
  }
  return d2;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * Reads a sprite's alpha and derives everything the lighting needs from it.
 *
 * Returns { w, h, down, alpha, dist, height, nx, ny, cavity, inside } where
 * `dist` is the distance in pixels from each pixel to the outside of the
 * silhouette, `height` is the bevel built on it, `nx`/`ny` are the two
 * interesting components of the surface normal (z is recovered as
 * sqrt(1 - x² - y²)) and `cavity` is positive in creases and folds.
 *
 * The fields are built at a capped resolution — `down` is how many sprite
 * pixels one field pixel stands for. Nothing that comes out of here is
 * high-frequency: it is all shading, and shading is the one thing in a picture
 * that can be blurry without anyone noticing. A full-grown oak has its field
 * built at a quarter of the pixels and the bake costs a quarter as much.
 *
 * opts:
 *   field   longest edge of the field grid (default FIELD_MAX)
 *   bevel   px the surface takes to turn from edge-on to flat
 *   dome    how much of a broad, whole-shape roundness to mix in (0..1)
 *   relief  how hard the height gradient bends the normal
 */
export function sdfFields(canvas, opts = {}) {
  const sw = canvas.width;
  const sh = canvas.height;
  const down = Math.max(1, Math.ceil(Math.max(sw, sh) / (opts.field ?? FIELD_MAX)));
  const w = Math.max(1, Math.ceil(sw / down));
  const h = Math.max(1, Math.ceil(sh / down));
  const n = w * h;
  let src = canvas;
  if (down > 1) {
    src = makeCanvas(w, h);
    const c = ctxOf(src);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(canvas, 0, 0, w, h);
  }
  const ctx = src.getContext('2d', { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, w, h).data;

  const alpha = new Float32Array(n);
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3] / 255;
    alpha[i] = a;
    // Anything the eye would call solid counts as inside. The half-covered
    // pixels along an antialiased edge are the boundary itself.
    inside[i] = a >= 0.5 ? 1 : 0;
  }

  // Seeds are the pixels *outside* the shape, so the transform measures how
  // deep into the shape every pixel sits. A shape touching the canvas border
  // would otherwise be treated as continuing past it, so the border counts as
  // outside too.
  const seeds = new Uint8Array(n);
  let any = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside[i] || x === 0 || y === 0 || x === w - 1 || y === h - 1) seeds[i] = 1;
      else any = 1;
    }
  }
  const dist = new Float32Array(n);
  if (any) {
    const d2 = edt2d(seeds, w, h);
    for (let i = 0; i < n; i++) {
      // The sub-pixel correction: an edge pixel that is 80% covered has its
      // true boundary 0.3px further out than the binary mask says.
      dist[i] = inside[i] ? Math.sqrt(d2[i]) - 0.5 + alpha[i] : 0;
      if (dist[i] < 0) dist[i] = 0;
    }
  }

  // -- height ---------------------------------------------------------------
  const bevel = opts.bevel ?? Math.max(3, Math.min(9, Math.round(Math.min(w, h) * 0.12)));
  const domeAmt = opts.dome ?? 0.28;
  // The broad term rounds the whole mass rather than just its rim; on a
  // boulder it is the difference between a lit edge and a lit stone.
  const domeR = Math.max(bevel * 2, Math.min(w, h) * 0.42);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = dist[i];
    if (d <= 0) continue;
    const t = clamp01(d / bevel);
    // A quarter circle: steep where it meets the silhouette, flat inside.
    const rim = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
    const broad = clamp01(d / domeR);
    height[i] = rim * (1 - domeAmt) + broad * domeAmt;
  }

  // -- normals --------------------------------------------------------------
  const relief = (opts.relief ?? 1) * bevel * 0.55;
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (dist[i] <= 0) continue;
      const l = height[i - (x > 0 ? 1 : 0)];
      const r = height[i + (x < w - 1 ? 1 : 0)];
      const u = height[i - (y > 0 ? w : 0)];
      const d = height[i + (y < h - 1 ? w : 0)];
      // Height rises towards the interior, so the surface tilts away from it:
      // the slope is negated to point out of the shape.
      const gx = -(r - l) * 0.5 * relief;
      const gy = -(d - u) * 0.5 * relief;
      // sqrt rather than Math.hypot: this runs on every pixel of every sprite
      // in the game, and hypot's overflow guard costs several times the
      // arithmetic it protects.
      const len = Math.sqrt(gx * gx + gy * gy + 1);
      nx[i] = gx / len;
      ny[i] = gy / len;
    }
  }

  // -- cavity ---------------------------------------------------------------
  // Height against a blurred copy of itself. Where a pixel sits below its own
  // neighbourhood it is in a crease, and creases are where dirt and shadow
  // collect — the grime that keeps a shape from looking extruded.
  const cavity = new Float32Array(n);
  const blurred = boxBlur(height, w, h, Math.max(2, Math.round(bevel * 0.9)));
  for (let i = 0; i < n; i++) {
    if (dist[i] <= 0) continue;
    cavity[i] = clamp01((blurred[i] - height[i]) * 2.4);
  }

  return { w, h, sw, sh, down, alpha, inside, dist, height, nx, ny, cavity, bevel };
}

/** Separable box blur over a float field. Two passes, radius in pixels. */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const norm = 1 / (r * 2 + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum * norm;
      sum += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum * norm;
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

/**
 * How much of the lighting a pixel is allowed to receive.
 *
 * Everything baked here is drawn *over* the sprite, into the world buffer,
 * where the ground is the backdrop. A layer whose alpha reached the very edge
 * of the silhouette would spill a bright or dark fringe onto the ground
 * beside it — and after the layer is stretched back up from quarter size, that
 * fringe is several pixels wide. So the coverage is pulled in from the edge.
 * The distance field, which is the whole point of this file, makes that an
 * expression rather than a morphological pass.
 */
function coverage(f, i) {
  const e = f.emissive ? 1 - f.emissive[i] : 1;
  return clamp01(f.dist[i] - 0.7) * f.alpha[i] * e;
}

/**
 * Holds the lighting off anything that is its own light source. A brazier's
 * flame and an idol's amber are painted into the emissive buffer as well as
 * the sprite, and shading a flame is nonsense — it does not have a lit side.
 */
export function dampEmissive(f, canvas) {
  if (!canvas) return f;
  let src = canvas;
  if (canvas.width !== f.w || canvas.height !== f.h) {
    src = makeCanvas(f.w, f.h);
    const c = ctxOf(src);
    c.imageSmoothingEnabled = true;
    c.drawImage(canvas, 0, 0, f.w, f.h);
  }
  const ctx = src.getContext('2d', { willReadFrequently: true });
  const px = ctx.getImageData(0, 0, f.w, f.h).data;
  const e = new Float32Array(f.w * f.h);
  for (let i = 0; i < e.length; i++) {
    const o = i * 4;
    const luma = (px[o] * 0.299 + px[o + 1] * 0.587 + px[o + 2] * 0.114) / 255;
    e[i] = clamp01((px[o + 3] / 255) * luma * 1.6);
  }
  f.emissive = e;
  return f;
}

// ---------------------------------------------------------------------------
// The sculpt pass
// ---------------------------------------------------------------------------

/**
 * Lights the recovered surface with the house key light and composites the
 * result into the sprite itself. This is the part that survives even when a
 * device is too slow for anything dynamic: the prop is simply better shaded
 * than it was, in the direction the rest of the art already agrees on.
 *
 * `overlay` is the blend: it doubles the backdrop where the layer is white
 * and halves it where the layer is black, which on this game's dark palette
 * gives a real terminator instead of a wash of grey.
 */
export function applySculpt(canvas, f, opts = {}) {
  const strength = opts.strength ?? 0.6;
  const gain = opts.gain ?? 1.35;
  const cav = opts.cavity ?? 0.55;
  const [lx, ly] = KEY_LIGHT;

  // The shading term per field pixel, and how much of it each pixel is owed.
  const shade = new Float32Array(f.w * f.h);
  const weight = new Float32Array(f.w * f.h);
  for (let i = 0; i < shade.length; i++) {
    const cov = coverage(f, i);
    if (cov <= 0.004) continue;
    // N·L with the flat interior removed: a pixel whose normal points at the
    // camera lands on neutral grey and the paint under it is left alone.
    shade[i] = clamp(f.nx[i] * lx + f.ny[i] * ly - f.cavity[i] * cav, -1, 1) * gain;
    weight[i] = cov * strength;
  }

  // Blended straight into the sprite's own pixels rather than composited as a
  // layer. Canvas would have to pick an alpha for the layer and then blend the
  // two, which fattens antialiased edges and leaves a grey halo a fraction of
  // a pixel wide all round the silhouette; doing the arithmetic here touches
  // the colour and nothing else, and the alpha channel comes out bit for bit
  // the way the prop was painted.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, f.sw, f.sh);
  const d = img.data;
  const fw = f.w;
  const inv = 1 / f.down;

  // One row of the sprite at a time, so the vertical half of the interpolation
  // is done once per row instead of once per pixel, and both fields are read
  // through the same four corner weights.
  for (let y = 0; y < f.sh; y++) {
    const fy = clamp((y + 0.5) * inv - 0.5, 0, f.h - 1);
    const y0 = fy | 0;
    const y1 = y0 + 1 < f.h ? y0 + 1 : y0;
    const ty = fy - y0;
    const rowA = y0 * fw;
    const rowB = y1 * fw;
    for (let x = 0; x < f.sw; x++) {
      const o = (y * f.sw + x) * 4;
      const a = d[o + 3];
      if (!a) continue;
      const fx = clamp((x + 0.5) * inv - 0.5, 0, fw - 1);
      const x0 = fx | 0;
      const x1 = x0 + 1 < fw ? x0 + 1 : x0;
      const tx = fx - x0;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const iA = rowA + x0;
      const iB = rowA + x1;
      const iC = rowB + x0;
      const iD = rowB + x1;
      const wgt =
        (weight[iA] * w00 + weight[iB] * w10 + weight[iC] * w01 + weight[iD] * w11) * (a / 255);
      if (wgt <= 0.004) continue;
      const s = clamp01(
        0.5 + (shade[iA] * w00 + shade[iB] * w10 + shade[iC] * w01 + shade[iD] * w11) * 0.5
      );
      d[o] = overlay(d[o], s, wgt);
      d[o + 1] = overlay(d[o + 1], s, wgt);
      d[o + 2] = overlay(d[o + 2], s, wgt);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** `overlay` of a 0..1 source over an 0..255 backdrop, mixed by `k`. */
function overlay(b8, s, k) {
  const b = b8 / 255;
  const o = b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
  return (b + (o - b) * k) * 255;
}

// ---------------------------------------------------------------------------
// The directional basis
// ---------------------------------------------------------------------------

/**
 * Four layers: the surface's response to light coming from screen +x, -x, +y
 * and -y. Each is grey where the surface is edge-on to that direction, white
 * where it faces into it and black where it faces away, so blending one of
 * them at `|L.x|` and one at `|L.y|` reconstructs N·L for any direction in the
 * plane — two blits, no per-pixel work, no shader.
 *
 * They are baked small. The long edge is capped at LAYER_MAX, which puts a
 * full-grown pine's four layers at about 60 kilobytes together.
 */
function write(data, o, v, a) {
  data[o] = v;
  data[o + 1] = v;
  data[o + 2] = v;
  data[o + 3] = a;
}

export function bakeShadeBasis(f, opts = {}) {
  const gain = opts.gain ?? 1.5;
  const w = f.w;
  const h = f.h;
  const down = Math.max(1, Math.ceil(Math.max(w, h) / (opts.max ?? LAYER_MAX)));
  const lw = Math.max(1, Math.ceil(w / down));
  const lh = Math.max(1, Math.ceil(h / down));

  const canvases = [makeCanvas(lw, lh), makeCanvas(lw, lh), makeCanvas(lw, lh), makeCanvas(lw, lh)];
  const ctxs = canvases.map((c) => ctxOf(c));
  const imgs = ctxs.map((c) => c.createImageData(lw, lh));
  const data = imgs.map((im) => im.data);
  let live = 0;

  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      // Average the block this layer pixel stands for, weighted by how much
      // of it is allowed to be lit at all.
      let sx = 0;
      let sy = 0;
      let sa = 0;
      let count = 0;
      for (let by = y * down; by < Math.min(h, (y + 1) * down); by++) {
        for (let bx = x * down; bx < Math.min(w, (x + 1) * down); bx++) {
          const i = by * w + bx;
          const cov = coverage(f, i);
          sx += f.nx[i] * cov;
          sy += f.ny[i] * cov;
          sa += cov;
          count++;
        }
      }
      if (!count || sa <= 0.004) continue;
      const nx = (sx / sa) * gain;
      const ny = (sy / sa) * gain;
      const a = Math.round(clamp01(sa / count) * 255);
      if (a > 2) live++;
      const o = (y * lw + x) * 4;
      const vx = Math.round(clamp01(0.5 + nx * 0.5) * 255);
      const vy = Math.round(clamp01(0.5 + ny * 0.5) * 255);
      // The negative layers are the positive ones reflected about mid grey,
      // which is what makes "light from the other side" a blit rather than a
      // second bake.
      write(data[0], o, vx, a);
      write(data[1], o, 255 - vx, a);
      write(data[2], o, vy, a);
      write(data[3], o, 255 - vy, a);
    }
  }
  if (!live) return null;
  for (let k = 0; k < 4; k++) ctxs[k].putImageData(imgs[k], 0, 0);
  return { xp: canvases[0], xn: canvases[1], yp: canvases[2], yn: canvases[3] };
}

/** Mirrors a basis for a horizontally flipped sprite: +x and -x trade places. */
export function flipShadeBasis(shade) {
  if (!shade) return null;
  const mirror = (src) => {
    const c = makeCanvas(src.width, src.height);
    const cc = ctxOf(c);
    cc.translate(src.width, 0);
    cc.scale(-1, 1);
    cc.drawImage(src, 0, 0);
    return c;
  };
  return { xp: mirror(shade.xn), xn: mirror(shade.xp), yp: mirror(shade.yp), yn: mirror(shade.yn) };
}

/**
 * The whole bake, for a sprite that has already been trimmed to its content:
 * sculpt the pixels, then hand back the basis to light them with later.
 * Sprites too small to carry shading are left exactly as they were.
 */
export function bakeSpriteLighting(canvas, opts = {}) {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 12 || h < 12) return null;
  const f = sdfFields(canvas, opts);
  dampEmissive(f, opts.emissive);
  applySculpt(canvas, f, opts);
  return bakeShadeBasis(f, opts);
}
