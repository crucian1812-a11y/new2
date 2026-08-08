// Every surface in the game is baked here, from noise, at load time.
// The trick that keeps it from looking like flat plastic: each material is
// generated as a *height field* first, then lit with a real surface normal so
// grit, cracks, moss clumps and cobbles catch light the way relief does.

import { fbmTile, ridgedTile, worleyTile } from './noise.js';
import { clamp01, smoothstep } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { css, mixc, ramp, hex } from './palette.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctxOf(canvas, alpha = true) {
  return canvas.getContext('2d', { alpha, willReadFrequently: false });
}

// ---------------------------------------------------------------------------
// Relief-lit material baker
// ---------------------------------------------------------------------------

const SUN = (() => {
  const v = [-0.42, -0.68, 0.6];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

/**
 * cfg = {
 *   size, freq (integer noise cells across the tile — required for seamlessness),
 *   height(u,v,F) -> 0..1,
 *   color(h,u,v,F) -> [r,g,b],
 *   bump, ambient, diffuse, spec, specPow, aoStrength,
 *   ambientColor, sunColor
 * }
 */
export function bakeMaterial(cfg) {
  const size = cfg.size || 256;
  const F = cfg.freq || 6;
  const bump = cfg.bump ?? 2.2;
  const ambient = cfg.ambient ?? 0.55;
  const diffuse = cfg.diffuse ?? 0.7;
  const spec = cfg.spec ?? 0;
  const specPow = cfg.specPow ?? 24;
  const aoStrength = cfg.aoStrength ?? 0.35;
  const ambientColor = cfg.ambientColor || [0.72, 0.8, 1.0];
  const sunColor = cfg.sunColor || [1.0, 0.93, 0.82];

  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * F;
    for (let x = 0; x < size; x++) {
      H[y * size + x] = cfg.height((x / size) * F, v, F);
    }
  }

  const canvas = makeCanvas(size, size);
  const ctx = ctxOf(canvas, false);
  const img = ctx.createImageData(size, size);
  const d = img.data;

  // Wrapped neighbour lookup keeps the lighting seamless too.
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = H[i];
      const dhx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
      const dhy = (at(x, y + 1) - at(x, y - 1)) * 0.5;

      let nx = -dhx * bump * size * 0.02;
      let ny = -dhy * bump * size * 0.02;
      const nl = Math.hypot(nx, ny, 1);
      nx /= nl;
      ny /= nl;
      const nz = 1 / nl;

      const ndl = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);

      // Cheap cavity AO: low spots and high curvature go dark.
      const curv = clamp01(0.5 + (at(x + 2, y) + at(x - 2, y) + at(x, y + 2) + at(x, y - 2)) * 0.25 - h);
      const ao = 1 - aoStrength * (1 - clamp01(h * 0.55 + 0.45)) - aoStrength * 0.5 * curv;

      const albedo = cfg.color(h, (x / size) * F, (y / size) * F, F);

      let r = albedo[0] * (ambient * ambientColor[0] + diffuse * ndl * sunColor[0]) * ao;
      let g = albedo[1] * (ambient * ambientColor[1] + diffuse * ndl * sunColor[1]) * ao;
      let b = albedo[2] * (ambient * ambientColor[2] + diffuse * ndl * sunColor[2]) * ao;

      if (spec > 0) {
        // Blinn-Phong against a straight-up viewer.
        const hx = SUN[0] * 0.5;
        const hy = SUN[1] * 0.5;
        const hz = (SUN[2] + 1) * 0.5;
        const hl = Math.hypot(hx, hy, hz);
        const nh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
        const s = Math.pow(nh, specPow) * spec * 255;
        r += s;
        g += s * 0.98;
        b += s * 0.92;
      }

      const o = i * 4;
      d[o] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// Material library
// ---------------------------------------------------------------------------

const C = {
  sandWet: hex('#5c5344'),
  sandDry: hex('#b6a582'),
  sandPale: hex('#d6c9a8'),
  amberFleck: hex('#e8a53a'),
  ice: hex('#b9cfe0'),
  iceDeep: hex('#5c7f96'),
  iceBright: hex('#e8f4ff'),
  snow: hex('#dfe8f2'),
  mossDark: hex('#2c3a24'),
  moss: hex('#4a5c30'),
  mossLight: hex('#6e7f3c'),
  soil: hex('#3a2c1e'),
  soilLight: hex('#5b452c'),
  needle: hex('#3b3a22'),
  mud: hex('#3d3024'),
  mudWet: hex('#241c14'),
  peat: hex('#211a13'),
  peatLight: hex('#3a2c1c'),
  sphagnum: hex('#5c6b32'),
  sphagnumRed: hex('#6e3a25'),
  bogWater: hex('#141d1c'),
  stone: hex('#6e6a63'),
  stoneDark: hex('#3c3a37'),
  stoneLight: hex('#918b80'),
  granite: hex('#5a5b60'),
  leaf: hex('#6a4a24'),
  leafDark: hex('#3d2a15'),
  leafRed: hex('#7a3c1e'),
  bark: hex('#42342a'),
};

/** Small deterministic value hash used for fleck placement. */
function h21(x, y) {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export const MATERIALS = {
  // --- Act I: the amber coast -------------------------------------------
  sand: {
    freq: 6,
    bump: 2.4,
    spec: 0.05,
    aoStrength: 0.4,
    height: (u, v, F) => {
      const grain = fbmTile(u * 8, v * 8, F * 8, 3) * 0.5 + 0.5;
      const dune = fbmTile(u, v, F, 4) * 0.5 + 0.5;
      const ripple = 0.5 + 0.5 * Math.sin((v * 5 + fbmTile(u, v, F, 2) * 3) * Math.PI);
      const w = worleyTile(u * 5, v * 5, F * 5);
      const pebble = smoothstep(0.34, 0.06, w.f1) * 0.55;
      return clamp01(dune * 0.42 + ripple * 0.14 + grain * 0.22 + pebble * 0.5);
    },
    color: (h, u, v, F) => {
      const dune = fbmTile(u * 1.4, v * 1.4, F, 3) * 0.5 + 0.5;
      let c = ramp(
        [
          [0, C.sandWet],
          [0.4, mixc(C.sandWet, C.sandDry, 0.6)],
          [0.68, C.sandDry],
          [1, C.sandPale],
        ],
        clamp01(h * 0.65 + dune * 0.45)
      );
      const w = worleyTile(u * 5, v * 5, F * 5);
      if (w.f1 < 0.22) c = mixc(c, hex('#8b8271'), 0.55 - w.f1);
      // Amber chips glittering in the grit.
      const f = h21(Math.floor(u * 90), Math.floor(v * 90));
      if (f > 0.9965) c = mixc(c, C.amberFleck, 0.9);
      else if (f > 0.992) c = mixc(c, C.amberFleck, 0.35);
      return c;
    },
  },

  ice: {
    freq: 4,
    bump: 0.9,
    spec: 0.32,
    specPow: 80,
    ambient: 0.62,
    aoStrength: 0.18,
    height: (u, v, F) => {
      const crack = ridgedTile(u * 1.3, v * 1.3, F * 1.3, 4);
      const base = fbmTile(u * 1.6, v * 1.6, F * 1.6, 4) * 0.5 + 0.5;
      const grain = fbmTile(u * 10, v * 10, F * 10, 2) * 0.5 + 0.5;
      // Only the sharpest ridges become fractures; the rest stays glassy.
      return clamp01(0.35 + base * 0.34 + grain * 0.08 - smoothstep(0.86, 1.0, crack) * 0.5);
    },
    color: (h, u, v, F) => {
      const crack = ridgedTile(u * 1.3, v * 1.3, F * 1.3, 4);
      const deep = fbmTile(u * 0.9, v * 0.9, F, 3) * 0.5 + 0.5;
      const frost = fbmTile(u * 6 + 15, v * 6, F * 6, 3) * 0.5 + 0.5;
      let c = mixc(C.iceDeep, C.ice, clamp01(deep * 1.15));
      // Wind-scoured frost bloom over dark lagoon ice.
      c = mixc(c, C.iceBright, smoothstep(0.52, 0.85, frost) * 0.7);
      c = mixc(c, hex('#33566d'), smoothstep(0.88, 1.0, crack) * 0.75);
      // Trapped bubbles.
      const f = h21(Math.floor(u * 120), Math.floor(v * 120));
      if (f > 0.997) c = mixc(c, [236, 246, 255], 0.85);
      return c;
    },
  },

  snow: {
    freq: 5,
    bump: 2.0,
    spec: 0.2,
    specPow: 46,
    ambient: 0.66,
    aoStrength: 0.34,
    height: (u, v, F) => {
      const drift = fbmTile(u, v, F, 4) * 0.5 + 0.5;
      // Wind ripples running across the drifts.
      const ripple = 0.5 + 0.5 * Math.sin((u * 3.2 + v * 1.1 + fbmTile(u, v, F, 3) * 4) * Math.PI);
      const crust = worleyTile(u * 9, v * 9, F * 9);
      const grain = fbmTile(u * 22, v * 22, F * 22, 2) * 0.5 + 0.5;
      return clamp01(drift * 0.52 + ripple * 0.16 + smoothstep(0.3, 0.06, crust.f1) * 0.2 + grain * 0.18);
    },
    color: (h, u, v, F) => {
      const blue = fbmTile(u * 1.5, v * 1.5, F, 3) * 0.5 + 0.5;
      let c = mixc(hex('#8ea3ba'), C.snow, clamp01(h * 1.1 + blue * 0.35));
      c = mixc(c, hex('#f4f9ff'), clamp01(h - 0.62) * 1.5);
      // Ice crystals catching the light.
      const f = h21(Math.floor(u * 170), Math.floor(v * 170));
      if (f > 0.9965) c = [255, 255, 255];
      else if (f > 0.991) c = mixc(c, [255, 255, 255], 0.55);
      return c;
    },
  },

  // --- Act II: Rominten forest -------------------------------------------
  moss: {
    freq: 5,
    bump: 2.4,
    aoStrength: 0.55,
    ambient: 0.6,
    height: (u, v, F) => {
      // Clumps only appear where the large-scale patch mask says so, which
      // stops the whole tile turning into uniform bubble-wrap.
      const patch = fbmTile(u * 1.3, v * 1.3, F, 4) * 0.5 + 0.5;
      const clump = worleyTile(u * 2.2, v * 2.2, F * 2.2);
      const clump2 = worleyTile(u * 5.5 + 3, v * 5.5, F * 5.5);
      const soft = fbmTile(u * 2.5, v * 2.5, F * 2.5, 4) * 0.5 + 0.5;
      const fine = fbmTile(u * 20, v * 20, F * 20, 2) * 0.5 + 0.5;
      const mound = smoothstep(0.6, 0.08, clump.f1) * smoothstep(0.42, 0.66, patch);
      const pebble = smoothstep(0.28, 0.05, clump2.f1) * smoothstep(0.58, 0.34, patch);
      return clamp01(soft * 0.4 + mound * 0.45 + pebble * 0.22 + fine * 0.16);
    },
    color: (h, u, v, F) => {
      const patch = fbmTile(u * 1.3, v * 1.3, F, 4) * 0.5 + 0.5;
      const tone = fbmTile(u * 3.5 + 9, v * 3.5, F * 3.5, 3) * 0.5 + 0.5;
      let c = ramp(
        [
          [0, hex('#0f150c')],
          [0.3, C.mossDark],
          [0.58, C.moss],
          [0.8, C.mossLight],
          [1, hex('#93a151')],
        ],
        clamp01(h * 0.55 + patch * 0.35 + tone * 0.22)
      );
      // Bare earth where the moss thins out.
      c = mixc(c, mixc(C.soil, C.soilLight, tone), smoothstep(0.5, 0.24, patch) * 0.85);
      const nx = u * 24 + v * 9;
      const ny = v * 24 - u * 5;
      const nd = Math.abs(Math.sin(nx * 1.7) * Math.cos(ny * 0.9));
      if (nd > 0.982) c = mixc(c, C.needle, 0.65);
      return c;
    },
  },

  forestFloor: {
    freq: 5,
    bump: 2.6,
    aoStrength: 0.48,
    height: (u, v, F) => {
      const leaves = worleyTile(u * 7, v * 7, F * 7);
      const soil = fbmTile(u * 2, v * 2, F * 2, 4) * 0.5 + 0.5;
      const root = ridgedTile(u * 1.2, v * 1.2, F * 1.2, 3);
      return clamp01(soil * 0.35 + smoothstep(0.4, 0.05, leaves.f1) * 0.35 + smoothstep(0.8, 1, root) * 0.5 + 0.08);
    },
    color: (h, u, v, F) => {
      const leaves = worleyTile(u * 7, v * 7, F * 7);
      const t = h21(Math.floor(u * 7 + leaves.f1 * 3), Math.floor(v * 7));
      let c = mixc(C.soil, C.soilLight, fbmTile(u * 3, v * 3, F * 3, 3) * 0.5 + 0.5);
      if (leaves.f1 < 0.35) {
        const leafCol = t < 0.32 ? C.leafDark : t < 0.72 ? C.leaf : C.leafRed;
        c = mixc(c, leafCol, smoothstep(0.35, 0.08, leaves.f1) * 0.85);
      }
      c = mixc(c, C.mossDark, clamp01(fbmTile(u * 2.2, v * 2.2, F * 2, 3) * 0.7) * 0.5);
      return c;
    },
  },

  trail: {
    freq: 6,
    bump: 2.0,
    spec: 0.08,
    aoStrength: 0.45,
    height: (u, v, F) => {
      const rut = fbmTile(u * 3, v * 1.2, F * 3, 4) * 0.5 + 0.5;
      const grit = fbmTile(u * 14, v * 14, F * 14, 2) * 0.5 + 0.5;
      const w = worleyTile(u * 6, v * 6, F * 6);
      return clamp01(rut * 0.5 + grit * 0.22 + smoothstep(0.3, 0.05, w.f1) * 0.4);
    },
    ambient: 0.66,
    color: (h, u, v, F) => {
      const wet = fbmTile(u * 1.5, v * 1.5, F, 3) * 0.5 + 0.5;
      const dust = fbmTile(u * 4 + 6, v * 4, F * 4, 3) * 0.5 + 0.5;
      let c = mixc(C.mud, hex('#6a5136'), clamp01(h * 0.7 + wet * 0.5));
      c = mixc(c, hex('#8a704c'), clamp01(h - 0.55) * 1.5 * dust);
      // Wheel ruts hold water and go near-black.
      c = mixc(c, C.mudWet, smoothstep(0.42, 0.16, h) * 0.85);
      return c;
    },
  },

  // --- Act III: the great bog ---------------------------------------------
  peat: {
    freq: 5,
    bump: 2.4,
    spec: 0.22,
    specPow: 30,
    ambient: 0.5,
    aoStrength: 0.55,
    height: (u, v, F) => {
      const hummock = fbmTile(u * 1.6, v * 1.6, F, 4) * 0.5 + 0.5;
      const fibre = fbmTile(u * 18, v * 6, F * 18, 2) * 0.5 + 0.5;
      const pool = smoothstep(0.42, 0.3, hummock);
      return clamp01(hummock * 0.65 + fibre * 0.18 - pool * 0.4);
    },
    color: (h, u, v, F) => {
      const hummock = fbmTile(u * 1.6, v * 1.6, F, 4) * 0.5 + 0.5;
      let c = mixc(C.peat, C.peatLight, clamp01(h * 1.1));
      const sph = fbmTile(u * 4 + 11, v * 4 - 3, F * 4, 3) * 0.5 + 0.5;
      if (sph > 0.58) c = mixc(c, sph > 0.74 ? C.sphagnumRed : C.sphagnum, (sph - 0.58) * 2.1);
      c = mixc(c, C.bogWater, smoothstep(0.42, 0.26, hummock) * 0.9);
      return c;
    },
  },

  bogWater: {
    freq: 4,
    bump: 0.8,
    spec: 0.55,
    specPow: 70,
    ambient: 0.42,
    aoStrength: 0.15,
    height: (u, v, F) => 0.5 + fbmTile(u * 3, v * 3, F * 3, 3) * 0.3,
    color: (h, u, v, F) => {
      const murk = fbmTile(u * 2, v * 2, F * 2, 4) * 0.5 + 0.5;
      return mixc(hex('#0b1214'), hex('#1d2e2c'), clamp01(murk * 1.3));
    },
  },

  // --- Act IV: the Ordensburg ---------------------------------------------
  flagstone: {
    freq: 4,
    bump: 3.2,
    spec: 0.12,
    aoStrength: 0.5,
    height: (u, v, F) => {
      // Structured slabs: a jittered brick grid with worn bevels.
      const rowH = 0.5;
      const row = Math.floor(v / rowH);
      const off = (row % 2) * 0.25 + h21(row, 7) * 0.2;
      const cellW = 0.66;
      const cu = (u + off) / cellW;
      const ci = Math.floor(cu);
      const fu = cu - ci;
      const fv = v / rowH - row;
      const edge = Math.min(
        smoothstep(0, 0.09, fu),
        smoothstep(0, 0.09, 1 - fu),
        smoothstep(0, 0.12, fv),
        smoothstep(0, 0.12, 1 - fv)
      );
      const wear = fbmTile(u * 6, v * 6, F * 6, 4) * 0.5 + 0.5;
      const chip = fbmTile(u * 14, v * 14, F * 14, 2) * 0.5 + 0.5;
      const slabH = 0.55 + h21(ci, row) * 0.14;
      return clamp01(edge * slabH + wear * 0.14 + chip * 0.08);
    },
    color: (h, u, v, F) => {
      const rowH = 0.5;
      const row = Math.floor(v / rowH);
      const off = (row % 2) * 0.25 + h21(row, 7) * 0.2;
      const ci = Math.floor((u + off) / 0.66);
      const tone = h21(ci * 1.7, row * 3.1);
      const warm = h21(ci * 5.3 + 2, row * 1.9);
      let c = mixc(C.stoneDark, C.stone, 0.3 + tone * 0.7);
      // Marienburg brick-and-stone: some slabs run warm and reddish.
      if (warm > 0.72) c = mixc(c, hex('#6d4c3a'), (warm - 0.72) * 1.6);
      else if (warm < 0.22) c = mixc(c, hex('#4a5158'), 0.45);
      c = mixc(c, C.stoneLight, clamp01(h - 0.6) * 1.3);
      const grime = fbmTile(u * 3, v * 3, F * 3, 4) * 0.5 + 0.5;
      c = mixc(c, hex('#241f1a'), smoothstep(0.55, 0.2, grime) * 0.55);
      const mossy = fbmTile(u * 5 + 20, v * 5, F * 5, 3) * 0.5 + 0.5;
      if (mossy > 0.66 && h < 0.5) c = mixc(c, C.mossDark, (mossy - 0.66) * 2);
      return c;
    },
  },

  cobble: {
    freq: 4,
    bump: 3.6,
    aoStrength: 0.6,
    ambient: 0.6,
    height: (u, v, F) => {
      // Warped domain so the stones are laid irregularly, not on a lattice.
      const wu = u * 1.6 + fbmTile(u, v, F, 3) * 0.35;
      const wv = v * 1.6 + fbmTile(u + 7, v + 3, F, 3) * 0.35;
      const w = worleyTile(wu, wv, F * 1.6);
      const dome = Math.pow(smoothstep(0.62, 0.04, w.f1), 0.7);
      const grit = fbmTile(u * 18, v * 18, F * 18, 2) * 0.5 + 0.5;
      const gap = smoothstep(0.16, 0.0, w.edge);
      return clamp01(dome * 0.86 + grit * 0.1 - gap * 0.35);
    },
    color: (h, u, v, F) => {
      const wu = u * 1.6 + fbmTile(u, v, F, 3) * 0.35;
      const wv = v * 1.6 + fbmTile(u + 7, v + 3, F, 3) * 0.35;
      const w = worleyTile(wu, wv, F * 1.6);
      const id = h21(Math.floor(wu * 3.1 + w.f1 * 11), Math.floor(wv * 2.7));
      // Baltic fieldstone: greys, warm browns, the odd reddish granite.
      let base = mixc(C.granite, C.stone, id);
      if (id > 0.78) base = mixc(base, hex('#6b5344'), 0.6);
      else if (id < 0.2) base = mixc(base, hex('#454b52'), 0.7);
      let c = mixc(base, C.stoneDark, smoothstep(0.24, 0.66, w.f1) * 0.9);
      c = mixc(c, C.stoneLight, clamp01(h - 0.62) * 1.5);
      // Mud and moss packed into the joints.
      c = mixc(c, hex('#22201a'), smoothstep(0.12, 0.0, w.edge) * 0.8);
      const mossy = fbmTile(u * 4 + 21, v * 4, F * 4, 3) * 0.5 + 0.5;
      if (mossy > 0.7) c = mixc(c, C.mossDark, (mossy - 0.7) * 1.5 * smoothstep(0.2, 0.02, w.edge));
      return c;
    },
  },

  // --- Act V: the sacred grove --------------------------------------------
  grove: {
    freq: 5,
    bump: 2.8,
    aoStrength: 0.5,
    ambient: 0.68,
    height: (u, v, F) => {
      const root = ridgedTile(u * 1.1, v * 1.1, F, 4);
      const soil = fbmTile(u * 3, v * 3, F * 3, 4) * 0.5 + 0.5;
      const leaf = worleyTile(u * 8, v * 8, F * 8);
      return clamp01(soil * 0.32 + smoothstep(0.72, 1, root) * 0.55 + smoothstep(0.36, 0.05, leaf.f1) * 0.3);
    },
    color: (h, u, v, F) => {
      const root = ridgedTile(u * 1.1, v * 1.1, F, 4);
      let c = mixc(hex('#332720'), hex('#54432e'), fbmTile(u * 2, v * 2, F * 2, 3) * 0.5 + 0.5);
      c = mixc(c, C.bark, smoothstep(0.74, 1, root) * 0.8);
      const leaf = worleyTile(u * 8, v * 8, F * 8);
      if (leaf.f1 < 0.3) c = mixc(c, C.leafRed, smoothstep(0.3, 0.05, leaf.f1) * 0.5);
      const glow = fbmTile(u * 3 + 40, v * 3, F * 3, 3) * 0.5 + 0.5;
      if (glow > 0.76) c = mixc(c, hex('#4a3a6a'), (glow - 0.76) * 1.6);
      return c;
    },
  },
};

const materialCache = new Map();

export function getMaterial(name, size = 256) {
  const key = name + ':' + size;
  let c = materialCache.get(key);
  if (!c) {
    const cfg = MATERIALS[name];
    if (!cfg) throw new Error('Unknown material ' + name);
    c = bakeMaterial({ ...cfg, size });
    materialCache.set(key, c);
  }
  return c;
}

const patternCache = new Map();
export function getPattern(ctx, name, size = 256) {
  const key = name + ':' + size;
  let p = patternCache.get(key);
  if (!p) {
    p = ctx.createPattern(getMaterial(name, size), 'repeat');
    patternCache.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Masks & overlays
// ---------------------------------------------------------------------------

/** Soft organic blob mask, used to splat one material over another. */
export function bakeBlobMask(size, seed) {
  const canvas = makeCanvas(size, size);
  const ctx = ctxOf(canvas);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const F = 4;
  const off = (seed % 97) * 3.7;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * F;
      const v = (y / size) * F;
      const n = fbmTile(u + off, v + off, F, 4) * 0.5 + 0.5;
      const cx = x / size - 0.5;
      const cy = y / size - 0.5;
      const r = Math.hypot(cx, cy) * 2;
      const a = clamp01((1 - smoothstep(0.35, 1.0, r)) * (0.35 + n * 1.1) - 0.12);
      const o = (y * size + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = 255;
      d[o + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Animated-looking caustic sheet for water surfaces. */
export function bakeCaustics(size = 256) {
  const canvas = makeCanvas(size, size);
  const ctx = ctxOf(canvas);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const F = 5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * F;
      const v = (y / size) * F;
      const w = worleyTile(u, v, F);
      const line = Math.pow(clamp01(1 - w.edge * 6), 3);
      const n = clamp01(fbmTile(u * 2, v * 2, F * 2, 3) * 0.5 + 0.5);
      const a = clamp01(line * 0.85 * (0.4 + n));
      const o = (y * size + x) * 4;
      d[o] = 210;
      d[o + 1] = 235;
      d[o + 2] = 255;
      d[o + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Soft cloud sheet for drifting ground fog. */
export function bakeFogSheet(size = 256, seed = 1) {
  const canvas = makeCanvas(size, size);
  const ctx = ctxOf(canvas);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const F = 3;
  const off = seed * 13.3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * F;
      const v = (y / size) * F;
      let n = fbmTile(u + off, v + off, F, 5) * 0.5 + 0.5;
      n = clamp01((n - 0.42) * 2.1);
      const o = (y * size + x) * 4;
      d[o] = 255;
      d[o + 1] = 255;
      d[o + 2] = 255;
      d[o + 3] = n * n * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Fine film grain tile, composited over the finished frame. */
export function bakeGrain(size = 128) {
  const canvas = makeCanvas(size, size);
  const ctx = ctxOf(canvas);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rng = new RNG(0x9a71c3);
  for (let i = 0; i < size * size; i++) {
    const g = 128 + (rng.float() - 0.5) * 90;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Radial light falloff sprite — one bake, reused for every light in the game. */
export function bakeLightSprite(size = 256, softness = 1) {
  const canvas = makeCanvas(size, size);
  const ctx = ctxOf(canvas);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    // Inverse-square-ish falloff, softened so it reads painterly not clinical.
    const a = Math.pow(1 - t, 2.0 + softness) * (1 - t * 0.15);
    g.addColorStop(t, `rgba(255,255,255,${a.toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** Soft elliptical contact shadow. */
export function bakeShadowSprite(size = 128) {
  const canvas = makeCanvas(size, size);
  const ctx = ctxOf(canvas);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.72)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.78, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** Blood splat decal. */
export function bakeBloodDecal(seed, size = 96) {
  const canvas = makeCanvas(size, size);
  const ctx = ctxOf(canvas);
  const rng = new RNG(seed);
  const cx = size / 2;
  const cy = size / 2;
  const blobs = rng.int(5, 9);
  for (let i = 0; i < blobs; i++) {
    const a = rng.float() * Math.PI * 2;
    const r = rng.range(0, size * 0.28);
    const rr = rng.range(size * 0.06, size * 0.2);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.8;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, 'rgba(96,14,16,0.95)');
    g.addColorStop(0.6, 'rgba(62,10,12,0.7)');
    g.addColorStop(1, 'rgba(40,6,8,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rr, rr * rng.range(0.6, 1), rng.float() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Flung droplets.
  for (let i = 0; i < rng.int(6, 14); i++) {
    const a = rng.float() * Math.PI * 2;
    const r = rng.range(size * 0.2, size * 0.46);
    const rr = rng.range(1, 3.4);
    ctx.fillStyle = `rgba(70,10,12,${rng.range(0.3, 0.8).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, rr, rr * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

/** Scorch / frost / arcane ground decal used by spells. */
export function bakeScorchDecal(color, seed, size = 128) {
  const canvas = makeCanvas(size, size);
  const ctx = ctxOf(canvas);
  const rng = new RNG(seed);
  const cx = size / 2;
  const cy = size / 2;
  for (let i = 0; i < 10; i++) {
    const a = rng.float() * Math.PI * 2;
    const r = rng.range(0, size * 0.16);
    const rr = rng.range(size * 0.16, size * 0.34);
    const g = ctx.createRadialGradient(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0, cx + Math.cos(a) * r, cy + Math.sin(a) * r, rr);
    g.addColorStop(0, css(color, 0.5));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}
