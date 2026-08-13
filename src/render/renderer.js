// The renderer. A 2.5D painter's-algorithm pipeline built on Canvas2D:
//
//   1. ground      chunked, composited from relief-lit tileable materials
//   2. decals      blood, scorch, footprints (multiply)
//   3. shadows     soft contact ellipses
//   4. sprites     y-sorted props, actors, loot, effects
//   5. lightmap    ambient + every torch/spell, multiplied over the scene,
//                  then re-added at low alpha for warm overbright
//   6. bloom       emissive-only buffer, blurred by successive downsampling
//   7. atmosphere  drifting fog sheets, weather, vignette, grade, grain
//
// Everything scales with `renderScale`, which drops automatically if the
// device can't hold the frame budget.

import { clamp, clamp01, lerp, damp, TAU } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { css, mixc, AMBIENCE } from './palette.js';
import {
  makeCanvas,
  ctxOf,
  getMaterial,
  bakeLightSprite,
  bakeShadowSprite,
  bakeFogSheet,
  bakeGrain,
  bakeCaustics,
} from './textures.js';
import { warpFbm, fbm } from './noise.js';

// A true 2:1 dimetric squash — one step down in y for every two across, the
// same projection Diablo II's tiles were built on. The old 0.62 was a
// compromise that read as "camera slightly tilted from overhead"; 0.5 is the
// angle the eye recognises as isometric.
export const ISO_Y = 0.5;

// The world is drawn into a buffer about this wide and then blown up with
// nearest-neighbour sampling, so the picture lands on chunky, stable pixels
// instead of a smooth gradient soup. Diablo II ran at 640x480; this is the
// same idea sized for a widescreen phone.
// 720 was too coarse once the figures had armour worth looking at: a knight
// stood about forty-five pixels tall, which is fewer than the plates he is
// wearing. This keeps a visible pixel grid — the grid is the point — while
// giving a character enough pixels to be a body rather than a suggestion.
const WORLD_PIXEL_WIDTH = 1200;

const CHUNK = 384; // world units per terrain chunk
const CHUNK_CACHE = 28;

export class Renderer {
  constructor(canvas) {
    // Two surfaces. `screen` is the real canvas at device resolution and is
    // where the HUD draws; `world` is the small buffer everything in the game
    // world is painted into, then upscaled onto the screen with smoothing off.
    this.canvas = canvas;
    this.screen = canvas;
    this.screenCtx = ctxOf(canvas, false);
    this.world = makeCanvas(1, 1);
    this.ctx = ctxOf(this.world, false);
    this.sw = 1;
    this.sh = 1;

    this.cam = { x: 0, y: 0, zoom: 1, shakeX: 0, shakeY: 0 };
    this.shake = 0;
    this.shakeDecay = 6;

    this.renderScale = 1;
    this.targetScale = 1;
    this.quality = 2; // 0 lean, 1 normal, 2 everything
    this.w = 1;
    this.h = 1;
    this.cssW = 1;
    this.cssH = 1;
    this.dpr = 1;

    this.lightCanvas = makeCanvas(1, 1);
    this.lightCtx = ctxOf(this.lightCanvas, false);
    this.emisCanvas = makeCanvas(1, 1);
    this.emisCtx = ctxOf(this.emisCanvas);
    this.blurA = makeCanvas(1, 1);
    this.blurACtx = ctxOf(this.blurA);
    this.blurB = makeCanvas(1, 1);
    this.blurBCtx = ctxOf(this.blurB);

    this.lightSprite = bakeLightSprite(256, 1);
    this.lightSpriteHard = bakeLightSprite(256, 0.2);
    this.shadowSprite = bakeShadowSprite(128);
    this.grain = bakeGrain(128);
    this.caustics = bakeCaustics(256);
    this.fogSheets = [bakeFogSheet(256, 1), bakeFogSheet(256, 7)];
    this.tintCache = new Map();

    this.chunks = new Map();
    this.chunkOrder = [];
    this.scratch = makeCanvas(CHUNK, CHUNK);
    this.scratchCtx = ctxOf(this.scratch);

    this.lights = [];
    this.queue = [];
    this.decals = [];
    this.time = 0;
    this.ambience = AMBIENCE.forest;
    this.terrain = null;
    this.frameMs = 16;

    this.resize();
  }

  // -- setup ---------------------------------------------------------------

  setAmbience(name) {
    this.ambience = AMBIENCE[name] || AMBIENCE.forest;
  }

  /**
   * terrain = { base, layers: [{mat, scale, threshold, softness}], wet }
   * Chunks are rebuilt when this changes.
   */
  setTerrain(terrain) {
    this.terrain = terrain;
    this.chunks.clear();
    this.chunkOrder.length = 0;
  }

  resize() {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;

    // The screen surface stays sharp — the HUD is drawn on it directly.
    const sw = Math.max(320, Math.round(cssW * dpr));
    const sh = Math.max(200, Math.round(cssH * dpr));
    if (sw !== this.sw || sh !== this.sh) {
      this.sw = sw;
      this.sh = sh;
      this.screen.width = sw;
      this.screen.height = sh;
      this.screen.style.width = cssW + 'px';
      this.screen.style.height = cssH + 'px';
      this.screenCtx.imageSmoothingEnabled = false;
    }

    // The world buffer is sized so one of its pixels is a whole number of
    // screen pixels wherever that is possible — a fractional ratio is what
    // makes upscaled pixel art shimmer as the camera moves.
    const want = WORLD_PIXEL_WIDTH * this.renderScale;
    const step = Math.max(1, Math.round(sw / want));
    this.worldPixel = step;
    const w = Math.max(320, Math.round(sw / step));
    const h = Math.max(200, Math.round(sh / step));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.world.width = w;
    this.world.height = h;
    this.ctx.imageSmoothingQuality = 'low';

    const lw = Math.max(2, Math.round(w * 0.5));
    const lh = Math.max(2, Math.round(h * 0.5));
    this.lightCanvas.width = lw;
    this.lightCanvas.height = lh;
    this.emisCanvas.width = lw;
    this.emisCanvas.height = lh;
    this.blurA.width = Math.max(2, Math.round(w * 0.16));
    this.blurA.height = Math.max(2, Math.round(h * 0.16));
    this.blurB.width = this.blurA.width;
    this.blurB.height = this.blurA.height;
  }

  /**
   * Keeps the frame budget by giving up, in order: the wide bloom halo, the
   * film grain, the second fog sheet, the wet sheen, and finally resolution.
   * A phone that can afford all of it gets all of it.
   */
  adaptQuality(dt) {
    const ms = dt * 1000;
    this.frameMs = lerp(this.frameMs, ms, 0.05);
    this.qualityTimer = (this.qualityTimer || 0) + dt;
    if (this.qualityTimer < 0.5) return;
    this.qualityTimer = 0;

    // Give up a little sharpness before giving up the atmosphere, then the
    // atmosphere before dropping to a genuinely low resolution.
    if (this.frameMs > 30) {
      if (this.targetScale > 0.8) this.targetScale = clamp(this.targetScale - 0.08, 0.8, 1);
      else if (this.quality > 0) this.quality--;
      else this.targetScale = clamp(this.targetScale - 0.08, 0.5, 1);
    } else if (this.frameMs < 15) {
      if (this.targetScale < 0.8) this.targetScale = clamp(this.targetScale + 0.05, 0.5, 1);
      else if (this.quality < 2) this.quality++;
      else this.targetScale = clamp(this.targetScale + 0.05, 0.5, 1);
    }
    if (Math.abs(this.targetScale - this.renderScale) > 0.04) {
      this.renderScale = this.targetScale;
      this.w = this.h = 0;
      this.resize();
    }
  }

  // -- camera --------------------------------------------------------------

  get viewW() {
    return this.w / (this.cam.zoom * this.pxScale);
  }
  get viewH() {
    return this.h / (this.cam.zoom * this.pxScale);
  }

  /** World → screen (in backing-store pixels). */
  sx(wx) {
    return (wx - this.cam.x + this.cam.shakeX) * this.cam.zoom * this.pxScale + this.w * 0.5;
  }
  sy(wy, z = 0) {
    return (
      (wy - this.cam.y + this.cam.shakeY) * ISO_Y * this.cam.zoom * this.pxScale -
      z * this.cam.zoom * this.pxScale +
      this.h * 0.5
    );
  }
  /** World units → world-buffer pixels. */
  get pxScale() {
    return this.dpr / (this.worldPixel || 1);
  }

  /** Screen (CSS px) → world. */
  toWorld(cssX, cssY) {
    const px = cssX * this.pxScale;
    const py = cssY * this.pxScale;
    return {
      x: (px - this.w * 0.5) / (this.cam.zoom * this.pxScale) + this.cam.x,
      y: (py - this.h * 0.5) / (ISO_Y * this.cam.zoom * this.pxScale) + this.cam.y,
    };
  }

  addShake(amount) {
    this.shake = Math.min(this.shake + amount, 34);
  }

  updateCamera(tx, ty, dt) {
    this.cam.x = damp(this.cam.x, tx, 7, dt);
    this.cam.y = damp(this.cam.y, ty, 7, dt);
    this.shake = Math.max(0, this.shake - this.shakeDecay * this.shake * dt - 2 * dt);
    const s = this.shake;
    if (s > 0.01) {
      this.cam.shakeX = (Math.random() - 0.5) * s;
      this.cam.shakeY = (Math.random() - 0.5) * s * 0.7;
    } else {
      this.cam.shakeX = this.cam.shakeY = 0;
    }
  }

  // -- terrain -------------------------------------------------------------

  chunkKey(cx, cy) {
    return cx + ',' + cy;
  }

  getChunk(cx, cy) {
    const key = this.chunkKey(cx, cy);
    let c = this.chunks.get(key);
    if (c) return c;
    c = this.buildChunk(cx, cy);
    this.chunks.set(key, c);
    this.chunkOrder.push(key);
    while (this.chunkOrder.length > CHUNK_CACHE) {
      const old = this.chunkOrder.shift();
      this.chunks.delete(old);
    }
    return c;
  }

  buildChunk(cx, cy) {
    const t = this.terrain;
    const canvas = makeCanvas(CHUNK, CHUNK);
    const ctx = ctxOf(canvas, false);
    const ox = cx * CHUNK;
    const oy = cy * CHUNK;
    const rng = new RNG(`chunk:${cx}:${cy}:${t ? t.base : 'x'}`);

    // Base coat — the pattern is offset so neighbouring chunks line up.
    const baseMat = getMaterial(t ? t.base : 'moss', 256);
    ctx.save();
    const p = ctx.createPattern(baseMat, 'repeat');
    ctx.fillStyle = p;
    ctx.translate(-(((ox % 256) + 256) % 256), -(((oy % 256) + 256) % 256));
    ctx.fillRect(0, 0, CHUNK + 256, CHUNK + 256);
    ctx.restore();

    // Splat layers.
    if (t && t.layers) {
      for (const layer of t.layers) {
        this.splatLayer(ctx, layer, ox, oy);
      }
    }

    // Large-scale value variation: soft dark pools and lit rises.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const step = 48;
    for (let y = 0; y < CHUNK; y += step) {
      for (let x = 0; x < CHUNK; x += step) {
        const n = warpFbm((ox + x) * 0.0014, (oy + y) * 0.0014, 1.6, 4);
        const v = clamp01(0.5 + n * 0.9);
        const a = (1 - v) * 0.42;
        if (a < 0.02) continue;
        const g = ctx.createRadialGradient(x + step / 2, y + step / 2, 0, x + step / 2, y + step / 2, step * 1.4);
        g.addColorStop(0, `rgba(24,26,32,${a.toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - step, y - step, step * 3, step * 3);
      }
    }
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let y = 0; y < CHUNK; y += step) {
      for (let x = 0; x < CHUNK; x += step) {
        const n = fbm((ox + x) * 0.0022 + 40, (oy + y) * 0.0022, 3);
        const a = clamp01(n) * 0.13;
        if (a < 0.02) continue;
        const g = ctx.createRadialGradient(x + step / 2, y + step / 2, 0, x + step / 2, y + step / 2, step * 1.3);
        g.addColorStop(0, `rgba(150,160,175,${a.toFixed(3)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - step, y - step, step * 3, step * 3);
      }
    }
    ctx.restore();

    // Scattered ground litter baked straight in — cheap density, no draw cost.
    // Diablo II's floors were never smooth: every tile carried pebbles, grit
    // and hairline cracks, and that high-frequency mess is most of why the
    // ground read as ground rather than as a painted backdrop. Each stone is
    // drawn as a lit pair — a dark base with a paler cap offset towards the
    // key light — so even a three-pixel pebble has a top and a side.
    ctx.save();
    for (let i = 0; i < 420; i++) {
      const x = rng.float() * CHUNK;
      const y = rng.float() * CHUNK;
      const r = rng.range(0.8, 3.4);
      const rot = rng.float() * TAU;
      const squash = rng.range(0.45, 0.9);
      ctx.globalAlpha = rng.range(0.2, 0.55);
      ctx.fillStyle = 'rgba(16,14,12,1)';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * squash, rot, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = rng.range(0.18, 0.5);
      ctx.fillStyle = 'rgba(178,172,156,1)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.3, y - r * 0.42, r * 0.66, r * squash * 0.6, rot, 0, TAU);
      ctx.fill();
    }

    // Hairline cracks and dead stalks.
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      let x = rng.float() * CHUNK;
      let y = rng.float() * CHUNK;
      let a = rng.float() * TAU;
      ctx.strokeStyle = `rgba(14,12,11,${rng.range(0.18, 0.44).toFixed(3)})`;
      ctx.lineWidth = rng.range(0.6, 1.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = rng.int(2, 6);
      for (let k = 0; k < segs; k++) {
        a += rng.range(-0.7, 0.7);
        x += Math.cos(a) * rng.range(3, 11);
        y += Math.sin(a) * rng.range(3, 11) * 0.6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // A fixed grain baked into the chunk rather than laid over the screen.
    // Baking it means the speckle belongs to the ground and stays put as the
    // camera moves; a screen-space grain slides across the world and reads as
    // dirt on the lens instead of texture underfoot.
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.34;
    const gp = ctx.createPattern(this.grain, 'repeat');
    ctx.translate(-(((ox % 128) + 128) % 128), -(((oy % 128) + 128) % 128));
    ctx.fillStyle = gp;
    ctx.fillRect(0, 0, CHUNK + 128, CHUNK + 128);
    ctx.restore();

    return canvas;
  }

  splatLayer(ctx, layer, ox, oy) {
    const s = this.scratchCtx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, CHUNK, CHUNK);

    const step = 14;
    const scale = layer.scale || 0.0022;
    const thr = layer.threshold ?? 0.05;
    const soft = layer.softness ?? 0.35;
    let any = false;
    for (let y = -step; y < CHUNK + step; y += step) {
      for (let x = -step; x < CHUNK + step; x += step) {
        const n = warpFbm((ox + x) * scale + (layer.offset || 0), (oy + y) * scale, 1.5, 4);
        // A steep curve on the mask. Diablo II's terrain transitions were
        // tile edges, not airbrushed fades — where sand meets rock there is a
        // line. Squaring the coverage keeps a broad solid interior and pulls
        // the falloff into a narrow band at the rim.
        const cov = clamp01((n - thr) / soft);
        const a = cov * cov * (3 - 2 * cov);
        if (a <= 0.02) continue;
        any = true;
        const r = step * 1.7;
        const g = s.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${(a * 0.98).toFixed(3)})`);
        g.addColorStop(0.55, `rgba(255,255,255,${(a * 0.8).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        s.fillStyle = g;
        s.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    if (!any) return;

    s.globalCompositeOperation = 'source-in';
    const mat = getMaterial(layer.mat, 256);
    s.save();
    s.fillStyle = s.createPattern(mat, 'repeat');
    s.translate(-(((ox % 256) + 256) % 256), -(((oy % 256) + 256) % 256));
    s.fillRect(0, 0, CHUNK + 256, CHUNK + 256);
    s.restore();
    s.globalCompositeOperation = 'source-over';

    ctx.drawImage(this.scratch, 0, 0);
  }

  drawGround() {
    const ctx = this.ctx;
    const zoom = this.cam.zoom * this.pxScale;
    const halfW = this.w * 0.5;
    const halfH = this.h * 0.5;
    const viewHalfW = halfW / zoom;
    const viewHalfH = halfH / (zoom * ISO_Y);
    const cx0 = Math.floor((this.cam.x - viewHalfW) / CHUNK);
    const cx1 = Math.floor((this.cam.x + viewHalfW) / CHUNK);
    const cy0 = Math.floor((this.cam.y - viewHalfH) / CHUNK);
    const cy1 = Math.floor((this.cam.y + viewHalfH) / CHUNK);

    ctx.save();
    // No resampling on the ground: a smoothed chunk turns the grit back into
    // the mud it was baked to replace.
    ctx.imageSmoothingEnabled = false;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = this.getChunk(cx, cy);
        const x = this.sx(cx * CHUNK);
        const y = this.sy(cy * CHUNK);
        const w = CHUNK * zoom + 1;
        const h = CHUNK * ISO_Y * zoom + 1;
        ctx.drawImage(c, x, y, w, h);
      }
    }
    ctx.restore();
  }

  /** Slow-drifting caustic sheen — reads as damp, glistening ground. */
  drawWetSheen() {
    if (!this.terrain || !this.terrain.wet || this.quality < 2) return;
    const ctx = this.ctx;
    const zoom = this.cam.zoom * this.pxScale;
    if (!this._causticPattern) this._causticPattern = ctx.createPattern(this.caustics, 'repeat');
    const t = this.time;
    const sc = 1.6 * zoom;
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = this.terrain.wet;
    ctx.translate(this.sx(t * 7) % (256 * sc), this.sy(-t * 5) % (256 * sc));
    ctx.scale(sc, sc * ISO_Y);
    ctx.fillStyle = this._causticPattern;
    const ww = (this.w * 2) / sc;
    const hh = (this.h * 2) / (sc * ISO_Y);
    ctx.fillRect(-ww, -hh, ww * 2, hh * 2);
    ctx.restore();
  }

  // -- decals --------------------------------------------------------------

  addDecal(canvas, x, y, scale, alpha, rot = 0, life = Infinity) {
    this.decals.push({ canvas, x, y, scale, alpha, rot, life, age: 0 });
    if (this.decals.length > 220) this.decals.shift();
  }

  drawDecals(dt) {
    const ctx = this.ctx;
    const zoom = this.cam.zoom * this.pxScale;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.age += dt;
      if (d.age > d.life) {
        this.decals.splice(i, 1);
        continue;
      }
      const fade = d.life === Infinity ? 1 : clamp01(1 - d.age / d.life);
      const sx = this.sx(d.x);
      const sy = this.sy(d.y);
      if (sx < -200 || sy < -200 || sx > this.w + 200 || sy > this.h + 200) continue;
      ctx.globalAlpha = d.alpha * fade;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(d.rot);
      ctx.scale(zoom * d.scale, zoom * d.scale * ISO_Y);
      ctx.drawImage(d.canvas, -d.canvas.width / 2, -d.canvas.height / 2);
      ctx.restore();
    }
    ctx.restore();
  }

  clearDecals() {
    this.decals.length = 0;
  }

  // -- lights --------------------------------------------------------------

  addLight(x, y, r, color, intensity = 1, hard = false) {
    this.lights.push({ x, y, r, color, i: intensity, hard });
  }

  tintedLight(color, hard) {
    const key = (hard ? 'h' : 's') + color[0] + ',' + color[1] + ',' + color[2];
    let c = this.tintCache.get(key);
    if (!c) {
      const src = hard ? this.lightSpriteHard : this.lightSprite;
      c = makeCanvas(src.width, src.height);
      const cc = ctxOf(c);
      cc.drawImage(src, 0, 0);
      cc.globalCompositeOperation = 'source-in';
      cc.fillStyle = css(color);
      cc.fillRect(0, 0, c.width, c.height);
      this.tintCache.set(key, c);
    }
    return c;
  }

  renderLightmap() {
    const lc = this.lightCtx;
    const lw = this.lightCanvas.width;
    const lh = this.lightCanvas.height;
    const amb = this.ambience;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1;

    // Ambient sky light, slightly graded top-to-bottom.
    const g = lc.createLinearGradient(0, 0, 0, lh);
    const a0 = amb.ambient.map((v) => v * amb.ambientStrength * 1.35);
    const a1 = amb.ambient.map((v) => v * amb.ambientStrength * 0.78);
    g.addColorStop(0, css(a0));
    g.addColorStop(1, css(a1));
    lc.fillStyle = g;
    lc.fillRect(0, 0, lw, lh);

    lc.globalCompositeOperation = 'lighter';
    const k = 0.5; // lightmap is half-resolution
    for (const L of this.lights) {
      const sx = this.sx(L.x) * k;
      const sy = this.sy(L.y) * k;
      const r = L.r * this.cam.zoom * this.pxScale * k;
      if (sx + r < 0 || sy + r < 0 || sx - r > lw || sy - r > lh) continue;
      lc.globalAlpha = clamp01(L.i);
      const spr = this.tintedLight(L.color, L.hard);
      lc.drawImage(spr, sx - r, sy - r * 0.86, r * 2, r * 1.72);
    }
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'source-over';
  }

  compositeLight() {
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.lightCanvas, 0, 0, this.w, this.h);
    if (this.quality >= 1) {
      // A little overbright so a torch feels hot rather than merely revealing.
      // Kept low: pushed further it blows the character out to a white blob,
      // and losing the armour's shading is a bad trade for a warmer glow.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.07;
      ctx.drawImage(this.lightCanvas, 0, 0, this.w, this.h);
    }
    ctx.restore();
  }

  // -- bloom ---------------------------------------------------------------

  renderBloom() {
    const a = this.blurACtx;
    const b = this.blurBCtx;
    const aw = this.blurA.width;
    const ah = this.blurA.height;
    a.setTransform(1, 0, 0, 1, 0, 0);
    a.clearRect(0, 0, aw, ah);
    a.imageSmoothingEnabled = true;
    a.drawImage(this.emisCanvas, 0, 0, aw, ah);

    // Two ping-pong blur passes via slight offsets — cheap, and it looks like
    // a real lens glow rather than a box blur.
    for (let pass = 0; pass < 2; pass++) {
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.clearRect(0, 0, aw, ah);
      b.globalAlpha = 0.25;
      const o = 1 + pass * 1.6;
      b.drawImage(this.blurA, -o, 0, aw, ah);
      b.drawImage(this.blurA, o, 0, aw, ah);
      b.drawImage(this.blurA, 0, -o, aw, ah);
      b.drawImage(this.blurA, 0, o, aw, ah);
      a.clearRect(0, 0, aw, ah);
      a.globalAlpha = 1;
      a.drawImage(this.blurB, 0, 0);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(this.emisCanvas, 0, 0, this.w, this.h);
    ctx.globalAlpha = 0.72;
    ctx.drawImage(this.blurA, 0, 0, this.w, this.h);
    if (this.quality >= 2) {
      // Wide halo — the expensive one, first to go when frames get tight.
      ctx.globalAlpha = 0.42;
      ctx.drawImage(this.blurA, -this.w * 0.03, -this.h * 0.03, this.w * 1.06, this.h * 1.06);
    }
    ctx.restore();
  }

  // -- atmosphere ----------------------------------------------------------

  /** Pre-tinted copy of a white sheet, cached per colour. */
  tintedSheet(sheet, color, key) {
    const k = key + ':' + color.join(',');
    let c = this.tintCache.get(k);
    if (!c) {
      c = makeCanvas(sheet.width, sheet.height);
      const cc = ctxOf(c);
      cc.drawImage(sheet, 0, 0);
      cc.globalCompositeOperation = 'source-in';
      cc.fillStyle = css(color);
      cc.fillRect(0, 0, c.width, c.height);
      this.tintCache.set(k, c);
    }
    return c;
  }

  /** Parallax sheets of ground haze. Sells depth more than anything else. */
  drawFog() {
    const amb = this.ambience;
    if (amb.fogAmount <= 0) return;
    const ctx = this.ctx;
    const zoom = this.cam.zoom * this.pxScale;
    const sheets = this.quality >= 2 ? 2 : 1;
    for (let i = 0; i < sheets; i++) {
      const sheet = this.tintedSheet(this.fogSheets[i], amb.fog, 'fog' + i);
      const par = i ? 0.5 : 0.3;
      const sc = (i ? 2.6 : 4.2) * zoom;
      const px = -this.cam.x * par * zoom + this.time * (i ? 13 : 7);
      const py = -this.cam.y * par * zoom * ISO_Y + this.time * (i ? 5 : 2.5);
      ctx.save();
      ctx.globalAlpha = amb.fogAmount * (i ? 0.42 : 0.6);
      ctx.translate(px % (sheet.width * sc), py % (sheet.height * sc * 0.7));
      ctx.scale(sc, sc * 0.7);
      ctx.fillStyle = ctx.createPattern(sheet, 'repeat');
      const ww = (this.w * 2) / sc;
      const hh = (this.h * 2) / (sc * 0.7);
      ctx.fillRect(-ww, -hh, ww * 2, hh * 2);
      ctx.restore();
    }
  }

  /**
   * One baked sheet carrying the vignette, the lifted-black film curve and the
   * zone's colour grade. Rebuilt only when the viewport or the act changes,
   * so the finishing pass costs a single blit instead of four.
   */
  buildGradeSheet() {
    const amb = this.ambience;
    const key = `${this.w}x${this.h}:${amb.grade.join(',')}:${amb.sky.join(',')}`;
    if (this._gradeKey === key) return;
    this._gradeKey = key;
    const c = makeCanvas(this.w, this.h);
    const g = ctxOf(c);
    // Grade + lifted black, painted as one translucent wash.
    const lg = g.createLinearGradient(0, 0, 0, this.h);
    lg.addColorStop(0, css(mixc(amb.grade, amb.sky, 0.45), amb.gradeAmount * 0.85));
    lg.addColorStop(1, css(mixc(amb.sky, amb.grade, 0.3), amb.gradeAmount * 0.55));
    g.fillStyle = lg;
    g.fillRect(0, 0, this.w, this.h);
    // Vignette
    const rg = g.createRadialGradient(
      this.w * 0.5,
      this.h * 0.46,
      Math.min(this.w, this.h) * 0.26,
      this.w * 0.5,
      this.h * 0.5,
      Math.max(this.w, this.h) * 0.76
    );
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(0.62, 'rgba(6,4,3,0.16)');
    rg.addColorStop(1, 'rgba(4,3,2,0.52)');
    g.fillStyle = rg;
    g.fillRect(0, 0, this.w, this.h);
    this.gradeSheet = c;
  }

  drawVignetteAndGrade() {
    const ctx = this.ctx;

    // Contrast, by compositing the frame over itself in overlay. Blending a
    // picture with itself this way pushes everything below mid-grey darker
    // and everything above it lighter — an S-curve for the cost of one blit.
    //
    // This is what the picture was missing against Diablo II. Every value in
    // the frame sat in the middle: no true black in the corners away from the
    // light, no hot highlight on the metal near it. D2's frames used the
    // whole range, and the range is what makes a torch feel like the only
    // thing holding the dark off.
    if (this.quality >= 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.42;
      ctx.drawImage(this.world, 0, 0);
      ctx.restore();
    }

    this.buildGradeSheet();
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.gradeSheet, 0, 0);
    ctx.restore();

    if (this.quality >= 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.05;
      if (!this._grainPattern) this._grainPattern = ctx.createPattern(this.grain, 'repeat');
      ctx.translate((Math.random() * 128) | 0, (Math.random() * 128) | 0);
      ctx.fillStyle = this._grainPattern;
      ctx.fillRect(-128, -128, this.w + 256, this.h + 256);
      ctx.restore();
    }
  }

  // -- sprite queue --------------------------------------------------------

  /** Adds a draw callback sorted by world Y (painter's algorithm). */
  push(y, fn, bias = 0) {
    this.queue.push({ y: y + bias, fn });
  }

  flushQueue() {
    this.queue.sort((a, b) => a.y - b.y);
    for (const item of this.queue) item.fn(this.ctx, this);
    this.queue.length = 0;
  }

  drawShadow(x, y, rx, alpha = 1) {
    const ctx = this.ctx;
    const zoom = this.cam.zoom * this.pxScale;
    const sx = this.sx(x);
    const sy = this.sy(y);
    const w = rx * 2 * zoom;
    const h = rx * 2 * zoom * 0.44;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.shadowSprite, sx - w / 2, sy - h / 2, w, h);
    ctx.restore();
  }

  /**
   * Blits a prop already scaled to the current zoom, 1:1, no resampling.
   * `swayPx` is an integer horizontal nudge — enough to read as wind without
   * forcing a filtered transform.
   */
  drawScaled(spr, x, y, swayPx = 0, alpha = 1) {
    const ctx = this.ctx;
    const dx = Math.round(this.sx(x) - spr.ox + swayPx);
    const dy = Math.round(this.sy(y) - spr.oy);
    if (dx > this.w || dy > this.h || dx + spr.w < 0 || dy + spr.h < 0) return false;
    if (alpha >= 0.999) {
      ctx.drawImage(spr.canvas, dx, dy);
    } else {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(spr.canvas, dx, dy);
      ctx.restore();
    }
    return true;
  }

  /** Screen-space bounds of a pre-scaled sprite placed at a world point. */
  spriteBounds(spr, x, y) {
    const dx = this.sx(x) - spr.ox;
    const dy = this.sy(y) - spr.oy;
    return { x: dx, y: dy, w: spr.w, h: spr.h };
  }

  drawScaledEmissive(spr, x, y, swayPx = 0) {
    if (!spr.emissive) return;
    const ctx = this.emisCtx;
    const k = 0.5;
    ctx.drawImage(
      spr.emissive,
      (this.sx(x) - spr.ox + swayPx) * k,
      (this.sy(y) - spr.oy) * k,
      spr.w * k,
      spr.h * k
    );
  }

  /** Draws a baked prop sprite anchored at its base. */
  drawSprite(spr, x, y, opts = {}) {
    const ctx = opts.ctx || this.ctx;
    const zoom = this.cam.zoom * this.pxScale * (opts.scale || 1);
    const sx = this.sx(x);
    const sy = this.sy(y, opts.z || 0);
    const w = spr.w * zoom;
    const h = spr.h * zoom;
    const dx = sx - spr.ox * zoom;
    const dy = sy - spr.oy * zoom;
    if (dx > this.w + 80 || dy > this.h + 80 || dx + w < -80 || dy + h < -80) return false;
    ctx.save();
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    if (opts.sway) {
      ctx.translate(sx, sy);
      ctx.transform(1, 0, opts.sway, 1, 0, 0);
      ctx.translate(-sx, -sy);
    }
    ctx.drawImage(spr.canvas, dx, dy, w, h);
    ctx.restore();
    return true;
  }

  drawSpriteEmissive(spr, x, y, opts = {}) {
    if (!spr.emissive) return;
    const ctx = this.emisCtx;
    const k = 0.5;
    const zoom = this.cam.zoom * this.pxScale * (opts.scale || 1);
    const sx = this.sx(x) * k;
    const sy = this.sy(y, opts.z || 0) * k;
    const w = spr.w * zoom * k;
    const h = spr.h * zoom * k;
    ctx.save();
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.drawImage(spr.emissive, sx - spr.ox * zoom * k, sy - spr.oy * zoom * k, w, h);
    ctx.restore();
  }

  /**
   * A soft radial dot, baked once per colour. Building a gradient per particle
   * per frame was, measurably, one of the most expensive things in the engine.
   */
  softDot(color) {
    const key = 'dot' + color[0] + ',' + color[1] + ',' + color[2];
    let c = this.tintCache.get(key);
    if (!c) {
      c = makeCanvas(64, 64);
      const cc = ctxOf(c);
      const g = cc.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, css(color, 1));
      g.addColorStop(0.45, css(color, 0.55));
      g.addColorStop(1, css(color, 0));
      cc.fillStyle = g;
      cc.fillRect(0, 0, 64, 64);
      this.tintCache.set(key, c);
    }
    return c;
  }

  /** Emissive-buffer helpers used by spell FX. */
  emisCircle(x, y, r, color, alpha, z = 0) {
    if (alpha <= 0.01) return;
    const ctx = this.emisCtx;
    const k = 0.5;
    const sx = this.sx(x) * k;
    const sy = this.sy(y, z) * k;
    const rr = r * this.cam.zoom * this.pxScale * k;
    if (rr < 0.6) return;
    if (sx + rr < 0 || sy + rr < 0 || sx - rr > this.emisCanvas.width || sy - rr > this.emisCanvas.height) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.softDot(color), sx - rr, sy - rr, rr * 2, rr * 2);
    ctx.restore();
  }

  // -- frame ---------------------------------------------------------------

  /**
   * Blows the world buffer up onto the screen with sampling switched off, so
   * every world pixel lands as a hard little square. Called once the world is
   * finished and before the HUD, which draws straight onto the screen.
   */
  presentWorld() {
    const ctx = this.screenCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.world, 0, 0, this.w, this.h, 0, 0, this.sw, this.sh);
  }

  beginFrame(dt) {
    this.time += dt;
    this.lights.length = 0;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(this.ambience.sky);
    ctx.fillRect(0, 0, this.w, this.h);
    this.emisCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.emisCtx.globalCompositeOperation = 'source-over';
    this.emisCtx.globalAlpha = 1;
    this.emisCtx.clearRect(0, 0, this.emisCanvas.width, this.emisCanvas.height);
  }
}
