// Procedural noise used to bake every texture in the game.
// Simplex-flavoured gradient noise + fbm + ridged + worley + domain warp.

import { hashSeed } from '../core/rng.js';

const GRAD2 = new Float32Array(512);
const PERM = new Uint8Array(512);

function buildTables(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Deterministic shuffle from the seed.
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2 + rnd() * 0.02;
    GRAD2[i * 2] = Math.cos(a);
    GRAD2[i * 2 + 1] = Math.sin(a);
  }
}
buildTables(0x9e3779b9);

/** Re-seeds the shared noise tables. Call once per world seed. */
export function seedNoise(seed) {
  buildTables(typeof seed === 'number' ? seed : hashSeed(seed));
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Perlin-style gradient noise, output in about [-1, 1]. */
export function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X = xi & 255;
  const Y = yi & 255;

  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[X + PERM[Y]] & 255;
  const ba = PERM[X + 1 + PERM[Y]] & 255;
  const ab = PERM[X + PERM[Y + 1]] & 255;
  const bb = PERM[X + 1 + PERM[Y + 1]] & 255;

  const d1 = GRAD2[aa * 2] * xf + GRAD2[aa * 2 + 1] * yf;
  const d2 = GRAD2[ba * 2] * (xf - 1) + GRAD2[ba * 2 + 1] * yf;
  const d3 = GRAD2[ab * 2] * xf + GRAD2[ab * 2 + 1] * (yf - 1);
  const d4 = GRAD2[bb * 2] * (xf - 1) + GRAD2[bb * 2 + 1] * (yf - 1);

  const x1 = d1 + u * (d2 - d1);
  const x2 = d3 + u * (d4 - d3);
  return (x1 + v * (x2 - x1)) * 1.4;
}

/** Tileable gradient noise over a period of `period` cells. */
export function noise2Tile(x, y, period) {
  // Blend four wrapped samples so the result seams perfectly.
  const px = ((x % period) + period) % period;
  const py = ((y % period) + period) % period;
  const fx = px / period;
  const fy = py / period;
  const a = noise2(px, py);
  const b = noise2(px - period, py);
  const c = noise2(px, py - period);
  const d = noise2(px - period, py - period);
  const ab = a * (1 - fx) + b * fx;
  const cd = c * (1 - fx) + d * fx;
  return ab * (1 - fy) + cd * fy;
}

export function fbm(x, y, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function fbmTile(x, y, period, octaves = 5, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2Tile(x * freq, y * freq, period * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

export function ridged(x, y, octaves = 5, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq, y * freq));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    freq *= 2.02;
  }
  return sum / norm;
}

export function ridgedTile(x, y, period, octaves = 5, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2Tile(x * freq, y * freq, period * freq));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

/** Cellular / Worley noise. Returns distance to nearest feature point (tileable). */
export function worleyTile(x, y, period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  let best = 8;
  let second = 8;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = (((xi + ox) % period) + period) % period;
      const cy = (((yi + oy) % period) + period) % period;
      const h = PERM[(cx + PERM[cy & 255]) & 255];
      const h2 = PERM[(cy + PERM[(cx + 37) & 255]) & 255];
      const px = ox + h / 255;
      const py = oy + h2 / 255;
      const d = Math.hypot(px - xf, py - yf);
      if (d < best) {
        second = best;
        best = d;
      } else if (d < second) second = d;
    }
  }
  return { f1: best, f2: second, edge: second - best };
}

/** Domain-warped fbm — gives organic, marbled, non-repetitive structure. */
export function warpFbm(x, y, warp = 1.4, octaves = 5) {
  const qx = fbm(x, y, 3);
  const qy = fbm(x + 5.2, y + 1.3, 3);
  return fbm(x + warp * qx, y + warp * qy, octaves);
}

export function warpFbmTile(x, y, period, warp = 1.2, octaves = 5) {
  const qx = fbmTile(x, y, period, 3);
  const qy = fbmTile(x + 5.2, y + 1.3, period, 3);
  return fbmTile(x + warp * qx, y + warp * qy, period, octaves);
}
