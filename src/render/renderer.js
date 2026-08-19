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
import { GLStage } from './gl.js';

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

// How far the baked directional shading is allowed to push a prop around.
// Past about 0.8 the overlay starts eating the painted detail underneath and
// props read as shrink-wrapped; this is the point where the form arrives and
// the paint survives.
const SHADE_STRENGTH = 0.62;

export class Renderer {
  constructor(canvas) {
    // Two surfaces. `screen` is the real canvas at device resolution and is
    // where the HUD draws; `world` is the small buffer everything in the game
    // world is painted into, then upscaled onto the screen with smoothing off.
    this.canvas = canvas;
    this.screen = canvas;
    this.screenCtx = ctxOf(canvas, false);

    // The GPU finishing stage needs a surface of its own — a canvas can hold
    // a 2D context or a WebGL one, never both — so it gets a sibling behind
    // this one, and #game keeps the HUD and the input handling. If the stage
    // fails to start, nothing below ever asks for it again.
    // ?nogl on the URL forces the Canvas2D path, so the two can be compared
    // on a real device without a rebuild.
    const noGL = typeof window !== 'undefined' && /[?&]nogl\b/.test(window.location.search);
    // The GL surface is never added to the page. An earlier version put it
    // behind #game as a sibling and the world came out black on real
    // hardware even though the framebuffer read back correct — the browser
    // was not compositing the WebGL canvas into the page. Keeping it purely
    // in memory and blitting the result onto the same 2D canvas the HUD uses
    // sidesteps that entirely: nothing has to be composited but #game, and
    // drawing a WebGL canvas into a 2D context is well defined.
    this.glCanvas = noGL ? null : makeCanvas(1, 1);
    this.gl = this.glCanvas ? new GLStage(this.glCanvas) : null;
    if (this.gl && !this.gl.ok) this.glCanvas = null;
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
    // The fog is built here, at the light map's resolution, so the two can be
    // multiplied together without resampling either.
    this.fogCanvas = makeCanvas(1, 1);
    this.fogCtx = ctxOf(this.fogCanvas, false);
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
    this.prevLights = [];
    this.water = null;
    this.rooms = null;
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
    this.fogCanvas.width = lw;
    this.fogCanvas.height = lh;
    this._fogPattern = null;
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

  /**
   * The lagoon.
   *
   * Painted from the same shoreline function the zone stops the player at, so
   * the line you can see and the line you can walk to are the same line — the
   * one thing that makes water read as water rather than as a texture painted
   * on the floor. Everything is built along that curve: wet sand landward of
   * it, a band of foam breathing in and out over it, the water darkening as it
   * goes out, caustics drifting across the whole surface, three swells further
   * out, and the moon laid down it in broken pieces.
   */
  setWater(water) {
    this.water = water;
  }

  drawWater() {
    const W = this.water;
    if (!W) return;
    const ctx = this.ctx;
    const t = this.time;
    const cfg = W.cfg || {};
    const shallow = cfg.shallow || [30, 60, 68];
    const deep = cfg.deep || [10, 26, 36];
    const foam = cfg.foam || [206, 226, 230];

    // Sample the shore across a little more than the visible height, in world
    // space, so the curve is right however the camera is placed.
    const y0 = this.cam.y - this.viewH * 0.75;
    const y1 = this.cam.y + this.viewH * 0.75;
    const steps = 26;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const wy = lerp(y0, y1, i / steps);
      // A slow swell breathing over the shoreline itself.
      const surge = Math.sin(wy * 0.004 + t * 0.55) * 9 + Math.sin(wy * 0.011 - t * 0.9) * 4;
      pts.push([this.sx(W.shoreX(wy) + surge), this.sy(wy), wy]);
    }
    if (pts[0][0] > this.w + 40 && pts[pts.length - 1][0] > this.w + 40) return;

    const edge = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    };

    // Wet sand: the ground just inland of the water, darkened and glossy.
    ctx.save();
    edge();
    ctx.lineWidth = 26 * this.cam.zoom * this.pxScale;
    ctx.strokeStyle = css(mixc(shallow, [10, 9, 8], 0.45), 0.35);
    ctx.stroke();
    ctx.restore();

    // The water body: everything seaward of the curve.
    ctx.save();
    edge();
    ctx.lineTo(this.w + 60, pts[pts.length - 1][1]);
    ctx.lineTo(this.w + 60, -60);
    ctx.lineTo(pts[0][0], pts[0][1]);
    ctx.closePath();
    ctx.clip();

    const g = ctx.createLinearGradient(pts[0][0], 0, pts[0][0] + this.w * 0.9, 0);
    g.addColorStop(0, css(shallow));
    g.addColorStop(0.35, css(mixc(shallow, deep, 0.55)));
    g.addColorStop(1, css(deep));
    ctx.fillStyle = g;
    ctx.fillRect(-10, -60, this.w + 80, this.h + 120);

    // The far water lifts towards the sky it is reflecting. Without it the
    // lagoon is a flat slab of colour with a coast drawn on one side.
    const sky = ctx.createLinearGradient(0, -60, 0, this.h);
    sky.addColorStop(0, css(mixc(shallow, this.ambience.sky || [40, 50, 70], 0.5), 0.55));
    sky.addColorStop(0.55, css(shallow, 0.12));
    sky.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sky;
    ctx.fillRect(-10, -60, this.w + 80, this.h + 120);

    // Caustics, drifting seaward, squashed by the projection like everything
    // else that lies on the ground.
    if (this.quality >= 1) {
      if (!this._causticPattern) this._causticPattern = ctx.createPattern(this.caustics, 'repeat');
      const sc = 2.2 * this.cam.zoom * this.pxScale;
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.5;
      ctx.translate((this.sx(t * 5) % (256 * sc)) - 256 * sc, (this.sy(-t * 3) % (256 * sc)) - 256 * sc);
      ctx.scale(sc, sc * ISO_Y);
      ctx.fillStyle = this._causticPattern;
      const ww = (this.w * 3) / sc;
      const hh = (this.h * 3) / (sc * ISO_Y);
      ctx.fillRect(0, 0, ww, hh);
      ctx.restore();
    }

    // Swells further out: the same curve pushed seaward and phase-shifted, so
    // they run parallel to the beach the way real sets do.
    ctx.lineCap = 'round';
    for (let k = 1; k <= 3; k++) {
      const off = k * 34 * this.cam.zoom * this.pxScale;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const wob = Math.sin(pts[i][2] * 0.009 + t * (1.1 + k * 0.3) + k) * 7 * this.cam.zoom * this.pxScale;
        const x = pts[i][0] + off + wob;
        if (i === 0) ctx.moveTo(x, pts[i][1]);
        else ctx.lineTo(x, pts[i][1]);
      }
      ctx.strokeStyle = css(foam, 0.3 / k);
      ctx.lineWidth = (2.4 - k * 0.4) * this.cam.zoom * this.pxScale;
      ctx.stroke();
    }

    // The moon on the water, in broken pieces rather than a mirror.
    const moon = this.ambience.rim || [190, 205, 220];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const wy = lerp(y0, y1, ((i * 0.618) % 1));
      const sway = Math.sin(wy * 0.02 + t * 1.7 + i) * 26;
      const x = this.sx(W.shoreX(wy) + 120 + ((i * 97) % 260) + sway);
      const y = this.sy(wy);
      const a = 0.22 + 0.3 * Math.abs(Math.sin(t * 1.3 + i * 2.1));
      const w2 = (7 + ((i * 13) % 11)) * this.cam.zoom * this.pxScale;
      ctx.fillStyle = css(moon, a);
      ctx.fillRect(x, y, w2, Math.max(1, 1.2 * this.cam.zoom * this.pxScale));
    }
    ctx.restore();
    ctx.restore();

    // Foam at the waterline: a bright, uneven band that breathes with the
    // swell, plus a thin lip of spray landward of it.
    ctx.save();
    const breathe = 0.55 + 0.45 * Math.sin(t * 0.8);
    edge();
    ctx.strokeStyle = css(foam, 0.5 + 0.28 * breathe);
    ctx.lineWidth = (3.4 + 3 * breathe) * this.cam.zoom * this.pxScale;
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const wob = Math.sin(pts[i][2] * 0.017 - t * 1.4) * 5 * this.cam.zoom * this.pxScale;
      const x = pts[i][0] - 5 * this.cam.zoom * this.pxScale + wob;
      if (i === 0) ctx.moveTo(x, pts[i][1]);
      else ctx.lineTo(x, pts[i][1]);
    }
    ctx.strokeStyle = css(foam, 0.3 * breathe);
    ctx.lineWidth = 1.4 * this.cam.zoom * this.pxScale;
    ctx.stroke();
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

  setRooms(rooms) {
    this.rooms = rooms && rooms.length ? rooms : null;
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

    const k = 0.5; // lightmap is half-resolution

    // Roofs. Painted into the ambient before any light is added, so a roofed
    // hall keeps whatever the braziers and the hero's torch put into it and
    // nothing else — walk through the doorway and the sky goes out. Drawn as
    // a multiply so it takes the sky away rather than laying grey over it, and
    // with a soft border so the eaves shade rather than cut.
    if (this.rooms) {
      lc.save();
      lc.globalCompositeOperation = 'multiply';
      for (const r of this.rooms) {
        const x0 = this.sx(r.x - r.w / 2) * k;
        const x1 = this.sx(r.x + r.w / 2) * k;
        const y0 = this.sy(r.y - r.h / 2) * k;
        const y1 = this.sy(r.y + r.h / 2) * k;
        if (x1 < 0 || y1 < 0 || x0 > lw || y0 > lh) continue;
        const g = lc.createLinearGradient(x0, y0, x0, y1);
        const dark = 'rgba(26,24,30,1)';
        g.addColorStop(0, 'rgba(70,66,76,1)');
        g.addColorStop(0.18, dark);
        g.addColorStop(0.82, dark);
        g.addColorStop(1, 'rgba(58,54,64,1)');
        lc.fillStyle = g;
        lc.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      lc.restore();
    }

    lc.globalCompositeOperation = 'lighter';
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

  buildBloom() {
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

  }

  renderBloom() {
    this.buildBloom();
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

  /**
   * Parallax sheets of ground haze, lit by the frame's own lights.
   *
   * Fog you can see is fog with light in it. Laid over the picture as a flat
   * grey veil — which is what this used to be — it reads as a dirty window;
   * what it should do is catch the torch, so the air near a fire glows and the
   * air out in the dark stays a cold suggestion.
   *
   * So the sheets are drawn into a half-resolution buffer over black, that
   * buffer is multiplied by the light map, and the result is *added* to the
   * frame. Multiplying against black keeps the arithmetic honest — a
   * translucent buffer would let the blend spill the light map itself into the
   * gaps — and adding is what scattered light does: it lifts the blacks near a
   * source and leaves everything else alone.
   */
  drawFog() {
    const amb = this.ambience;
    if (amb.fogAmount <= 0) return;
    const ctx = this.ctx;
    const zoom = this.cam.zoom * this.pxScale;
    const fw = this.fogCanvas.width;
    const fh = this.fogCanvas.height;
    const k = fw / this.w;
    const f = this.fogCtx;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.fillStyle = '#000';
    f.fillRect(0, 0, fw, fh);

    const sheets = this.quality >= 2 ? 2 : 1;
    for (let i = 0; i < sheets; i++) {
      const sheet = this.tintedSheet(this.fogSheets[i], amb.fog, 'fog' + i);
      const par = i ? 0.5 : 0.3;
      const sc = (i ? 2.6 : 4.2) * zoom * k;
      const px = (-this.cam.x * par * zoom + this.time * (i ? 13 : 7)) * k;
      const py = (-this.cam.y * par * zoom * ISO_Y + this.time * (i ? 5 : 2.5)) * k;
      f.save();
      f.globalAlpha = amb.fogAmount * (i ? 1 : 1.5);
      f.translate(px % (sheet.width * sc), py % (sheet.height * sc * 0.7));
      f.scale(sc, sc * 0.7);
      f.fillStyle = f.createPattern(sheet, 'repeat');
      const ww = (fw * 2) / sc;
      const hh = (fh * 2) / (sc * 0.7);
      f.fillRect(-ww, -hh, ww * 2, hh * 2);
      f.restore();
    }

    // On the GPU path the fog is handed over exactly like this — unlit — and
    // the shader multiplies it by the light it computes per pixel. Only the
    // Canvas2D path has to light it here, against the half-resolution light
    // map, and leave a little of the unlit sheet behind so haze in the far
    // dark does not disappear altogether.
    if (this.glLive) return;

    f.globalCompositeOperation = 'multiply';
    f.globalAlpha = 0.86;
    f.drawImage(this.lightCanvas, 0, 0, fw, fh);
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, 0, 0, this.w, this.h);
    ctx.restore();
  }

  /** True when the GPU stage is doing the lighting and the grade. */
  get glLive() {
    return !!(this.gl && this.gl.ok);
  }

  /**
   * Everything that happens to the frame after the last sprite is drawn.
   *
   * On the GPU path this only prepares the buffers the shader will read — the
   * fog sheet and the blurred bloom — and the lighting, the fog's own light,
   * the bloom, the contrast, the grade and the vignette all happen once, per
   * pixel, in `presentWorld`. On the Canvas2D path it is the old chain of
   * full-resolution composites, kept working because the GPU stage is allowed
   * to fail at any moment and because ?nogl has to stay a fair comparison.
   */
  composite() {
    if (this.glLive) {
      this.drawFog();
      this.buildBloom();
      return;
    }
    this.renderLightmap();
    this.compositeLight();
    this.renderBloom();
    this.drawFog();
  }

  /** The grade, on the Canvas2D path only — the shader does its own. */
  finish() {
    if (!this.glLive) this.drawVignetteAndGrade();
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
  drawScaled(spr, x, y, swayPx = 0, alpha = 1, relight = false) {
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
    if (relight) this.relightSprite(spr, x, y, dx, dy, spr.w, spr.h, alpha);
    return true;
  }

  /**
   * Relights a baked sprite from the light that is actually near it.
   *
   * The sprite carries four small greyscale layers — its surface's response to
   * light arriving from screen +x, -x, +y and -y — recovered from a distance
   * field at bake time (see sdf.js). N·L is linear in L, so the response to
   * any direction is one horizontal layer at |L.x| and one vertical layer at
   * |L.y|, blended over the sprite in `overlay`. Two blits, and a rock that
   * was painted lit from the upper left turns to face a torch.
   *
   * `dx`/`dy`/`w`/`h` are the rectangle the sprite was drawn into, so the
   * shading lands on exactly the pixels the sprite did.
   */
  relightSprite(spr, x, y, dx, dy, w, h, alpha = 1) {
    const shade = spr.shade;
    if (!shade || this.quality < 1) return;
    const [kx, ky] = this.keyLightDir(x, y);
    const len = Math.hypot(kx, ky);
    if (len < 1e-3) return;
    const ux = kx / len;
    const uy = ky / len;
    // The vector's length is how much light is falling here — the zone's sun
    // alone is a little over half of it, a torch at arm's length is well past
    // one. A prop out in the dark gets a whisper of shaping; a prop beside the
    // fire gets the full turn.
    const power = clamp01(0.45 + len * 0.55) * alpha * SHADE_STRENGTH;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.imageSmoothingEnabled = true;
    if (Math.abs(ux) > 0.06) {
      ctx.globalAlpha = power * Math.abs(ux);
      ctx.drawImage(ux > 0 ? shade.xp : shade.xn, dx, dy, w, h);
    }
    if (Math.abs(uy) > 0.06) {
      ctx.globalAlpha = power * Math.abs(uy);
      ctx.drawImage(uy > 0 ? shade.yp : shade.yn, dx, dy, w, h);
    }
    ctx.restore();
  }

  /**
   * The black silhouette of a sprite, baked once and kept.
   *
   * Every prop in the world was standing on nothing: a pine, a boulder and a
   * slab of ice all met the ground with no shadow at all, which is what made
   * them read as stickers on the mud rather than objects resting in it. The
   * figures got their shadows last pass; this is the same idea for everything
   * that does not move, and because props never change it is one bake per
   * sprite for the whole session.
   */
  shadowOf(spr) {
    if (spr.__shadow !== undefined) return spr.__shadow;
    const src = spr.canvas;
    if (!src || !src.width || !src.height) {
      spr.__shadow = null;
      return null;
    }
    const c = makeCanvas(src.width, src.height);
    const cc = ctxOf(c);
    cc.drawImage(src, 0, 0);
    // Keep the alpha, throw away the colour.
    cc.globalCompositeOperation = 'source-in';
    cc.fillStyle = '#000';
    cc.fillRect(0, 0, c.width, c.height);
    spr.__shadow = c;
    return c;
  }

  /**
   * Lays a prop's silhouette on the ground, sheared away from the key light
   * and squashed onto the floor plane — the same transform the actors use, so
   * a tree and a knight agree about where the sun is.
   */
  drawSpriteShadow(spr, x, y, alpha = 0.34) {
    const sh = this.shadowOf(spr);
    if (!sh) return;
    const sun = this.ambience.sunDir || [-0.5, -0.75];
    const len = Math.hypot(sun[0], sun[1]) || 1;
    const shear = (-sun[0] / len) * 0.8;
    const ctx = this.ctx;
    const bx = this.sx(x);
    const by = this.sy(y);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(bx, by);
    // Shear turns height into ground distance; the squash flattens it.
    ctx.transform(1, 0, shear, 0.42, 0, 0);
    ctx.drawImage(sh, -spr.ox, -spr.oy);
    ctx.restore();
  }

  /**
   * Screen-space direction from a world point towards the brightest light
   * near it, blended with the zone's own sun so a figure standing in the
   * open is still lit from somewhere. This is what a per-actor highlight
   * follows.
   */
  keyLightDir(wx, wy) {
    const sun = this.ambience.sunDir || [-0.5, -0.75];
    let bx = sun[0] * 0.55;
    let by = sun[1] * 0.55;
    const ox = this.sx(wx);
    const oy = this.sy(wy);
    const lights = this.prevLights && this.prevLights.length ? this.prevLights : this.lights;
    for (const L of lights) {
      const dx = this.sx(L.x) - ox;
      const dy = this.sy(L.y) - oy;
      const d = Math.hypot(dx, dy);
      if (d < 1) continue;
      const r = L.r * this.cam.zoom * this.pxScale;
      if (d > r) continue;
      // Nearer and stronger lights win, and the falloff matches the lightmap.
      const w = L.i * (1 - d / r) * (1 - d / r);
      bx += (dx / d) * w;
      by += (dy / d) * w;
    }
    return [bx, by];
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
    if (opts.relight) this.relightSprite(spr, x, y, dx, dy, w, h, opts.alpha ?? 1);
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

    if (this.glLive) {
      // Hand the frame to the GPU, along with everything it needs to light
      // and finish it: the unlit fog sheet, the emissive buffer sharp and
      // blurred, the light list and the roofs in world-buffer pixels, and the
      // zone's ambient and grade. The result is blitted onto the same 2D
      // canvas the HUD uses — see the note by `glCanvas` for why it is never
      // added to the page itself.
      const ls = [];
      for (const L of this.lights) {
        const r = L.r * this.cam.zoom * this.pxScale;
        const x = this.sx(L.x);
        const y = this.sy(L.y);
        if (x + r < 0 || y + r < 0 || x - r > this.w || y - r > this.h) continue;
        ls.push({ x, y, r, color: L.color, i: L.i });
      }
      // Brightest first, since the shader only takes sixteen.
      ls.sort((a, b) => b.i - a.i);

      const rooms = [];
      if (this.rooms) {
        for (const r of this.rooms) {
          const x0 = this.sx(r.x - r.w / 2);
          const x1 = this.sx(r.x + r.w / 2);
          const y0 = this.sy(r.y - r.h / 2);
          const y1 = this.sy(r.y + r.h / 2);
          if (x1 < 0 || y1 < 0 || x0 > this.w || y0 > this.h) continue;
          rooms.push({ x: (x0 + x1) * 0.5, y: (y0 + y1) * 0.5, hw: (x1 - x0) * 0.5, hh: (y1 - y0) * 0.5 });
        }
      }

      const amb = this.ambience;
      const a0 = amb.ambient.map((v) => (v / 255) * amb.ambientStrength * 1.35);
      const a1 = amb.ambient.map((v) => (v / 255) * amb.ambientStrength * 0.78);
      // The shader runs at the world buffer's resolution, not the screen's.
      // The frame is a chunky-pixel picture that gets blown up with sampling
      // off no matter what, so shading it at device resolution is three to
      // nine times the fragments for a result that is then thrown through a
      // nearest-neighbour upscale anyway — and it puts the ordered dither on
      // device pixels, where it is invisible, instead of on world pixels,
      // where it is the whole point. It also means `renderScale` still buys
      // what it is supposed to buy when a device is struggling: the adaptive
      // quality tier now scales the lighting too.
      const done = this.gl.present(this.world, this.w, this.h, ls, {
        fog: this.fogCanvas,
        emissive: this.emisCanvas,
        bloom: this.blurA,
        rooms,
        ambient: [a0, a1],
        grade: amb.grade.map((v) => v / 255),
        gradeSky: amb.sky.map((v) => v / 255),
        gradeAmount: amb.gradeAmount,
        fogAmount: amb.fogAmount > 0 ? 1 : 0,
        bloomAmount: this.quality >= 2 ? 0.6 : 0.45,
        contrast: this.quality >= 1 ? 0.42 : 0,
        overbright: this.quality >= 1 ? 0.07 : 0,
        relief: 1.8,
        levels: 26,
        time: this.time,
      });
      if (done) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.glCanvas, 0, 0, this.w, this.h, 0, 0, this.sw, this.sh);
        return;
      }
      // The stage gave up mid-frame; the world buffer is still unlit, so light
      // it the slow way before it goes to the screen rather than showing a
      // frame with no lighting in it at all.
      this.compositeCPU();
    }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.world, 0, 0, this.w, this.h, 0, 0, this.sw, this.sh);
  }

  /** The Canvas2D finishing chain, also used if the GPU stage gives up. */
  compositeCPU() {
    this.renderLightmap();
    this.compositeLight();
    this.renderBloom();
    this.drawFog();
    this.drawVignetteAndGrade();
  }

  beginFrame(dt) {
    this.time += dt;
    // The frame's lights are collected between here and the lightmap pass, but
    // the sprites are painted in the middle of that window: when a prop asks
    // what is lighting it, a spell going off beside it has not been added yet.
    // So the relight reads the previous frame's list, which is complete — and
    // at sixty frames a second it is a sixtieth of a second out of date, which
    // is less than the flicker on a torch.
    const spent = this.prevLights;
    this.prevLights = this.lights;
    this.lights = spent;
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
