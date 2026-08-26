// Every surface in the game is generated here at load. No image files, which
// keeps the whole build small enough to open over a phone connection with no
// loading bar worth the name.
//
// Each texture is packed the same way: RGB is a tangent-space normal, A is a
// multiplier on the albedo. One sample gives the shader both the relief and the
// tonal variation, which matters more on a phone than the extra memory costs.

function noise2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695041;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = noise2(xi, yi, seed), b = noise2(xi + 1, yi, seed);
  const c = noise2(xi, yi + 1, seed), d = noise2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, seed, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += smoothNoise(x * f, y * f, seed + i * 31) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return s;
}

// Turn a height field into the packed normal+albedo image the shaders expect.
function pack(size, height, tint, strength) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const d = height[((y - 1 + size) % size) * size + x];
      const u = height[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      out[i * 4] = ((nx / len) * 0.5 + 0.5) * 255;
      out[i * 4 + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out[i * 4 + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      out[i * 4 + 3] = Math.max(0, Math.min(255, tint[i] * 255));
    }
  }
  return out;
}

// Kimono cotton: a coarse basket weave, two threads over two, with the pearl
// weave's characteristic diagonal drift and a scattering of slubs where the
// yarn thickened.
export function giWeave(size = 256) {
  const h = new Float32Array(size * size);
  const t = new Float32Array(size * size);
  const period = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const gx = Math.floor(x / period) % 2;
      const gy = Math.floor(y / period) % 2;
      const warp = Math.sin(((x % period) / period) * Math.PI);
      const weft = Math.sin(((y % period) / period) * Math.PI);
      // Whichever thread is on top at this cell gets the full height.
      const over = gx === gy;
      let v = over ? warp * 0.85 + weft * 0.2 : weft * 0.85 + warp * 0.2;
      v += fbm(x / 9, y / 9, 7, 3) * 0.28;
      // Slubs: rare thick spots in the yarn.
      const slub = smoothNoise(x / 23, y / 23, 91);
      if (slub > 0.86) v += (slub - 0.86) * 3.2;
      h[i] = v;
      t[i] = 0.78 + v * 0.22 + (fbm(x / 40, y / 40, 3, 2) - 0.5) * 0.14;
    }
  }
  return { size, data: pack(size, h, t, 3.4) };
}

// Skin: pores at one scale, a slow blotch at another, and the faint sheen
// breakup that stops a limb reading as a plastic tube under a hard key light.
export function skinTex(size = 256) {
  const h = new Float32Array(size * size);
  const t = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const pore = fbm(x / 2.2, y / 2.2, 17, 2);
      const blotch = fbm(x / 26, y / 26, 41, 3);
      h[i] = pore * 0.35 + blotch * 0.3;
      t[i] = 0.9 + (blotch - 0.5) * 0.3 + (pore - 0.5) * 0.08;
    }
  }
  return { size, data: pack(size, h, t, 1.5) };
}

// Competition tatami: a puzzle-mat surface, rice-straw grain running one way,
// with the panel seams that give the eye its scale reference on the ground.
export function tatamiTex(size = 512) {
  const h = new Float32Array(size * size);
  const t = new Float32Array(size * size);
  const panel = size / 2; // two mats across the texture, tiled by the shader
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // Straw grain, alternating direction per panel like real tatami laid out.
      const px = Math.floor(x / panel), py = Math.floor(y / panel);
      const along = (px + py) % 2 === 0 ? y : x;
      const grain = Math.sin(along * 1.9) * 0.5 + 0.5;
      let v = grain * 0.45 + fbm(x / 3, y / 3, 5, 2) * 0.4;
      // Seams.
      const sx = Math.min(x % panel, panel - 1 - (x % panel));
      const sy = Math.min(y % panel, panel - 1 - (y % panel));
      const seam = Math.min(sx, sy);
      let tone = 0.94 + (v - 0.5) * 0.16;
      if (seam < 3) {
        v -= (3 - seam) * 0.9;
        tone -= (3 - seam) * 0.11;
      }
      // Scuffs from a thousand shrimping drills.
      const scuff = fbm(x / 55, y / 30, 61, 3);
      tone *= 1 - Math.max(0, scuff - 0.62) * 0.5;
      h[i] = v;
      t[i] = tone;
    }
  }
  return { size, data: pack(size, h, t, 2.0) };
}

export function uploadPacked(gl, texFn, tex) {
  const { size, data } = texFn;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}
