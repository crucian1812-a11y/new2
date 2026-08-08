// Every tree, rock, ruin and wreck in the game is drawn here with vector
// operations and cached as a bitmap. Nothing is downloaded.
//
// House rules that keep this out of "shiny plastic" territory:
//   * no pure blacks, no pure whites, no fully saturated fills;
//   * every silhouette is broken up with noise, never a clean primitive;
//   * three tonal layers minimum — core shadow, mid, and a cold rim light
//     on the upper-left, matching the world's key light;
//   * a grime/AO pass at the base so objects sit *in* the ground.

import { RNG } from '../core/rng.js';
import { makeCanvas, ctxOf } from './textures.js';
import { css, mixc, hex, PAL } from './palette.js';
import { TAU, clamp01, lerp } from '../core/math.js';

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/** Jagged organic closed path — the antidote to circles and rectangles. */
function organicPath(ctx, cx, cy, rx, ry, rng, spikes = 11, rough = 0.22, squash = 1) {
  ctx.beginPath();
  const pts = [];
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * TAU;
    const r = 1 + (rng.float() - 0.5) * 2 * rough;
    pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r * squash]);
  }
  ctx.moveTo((pts[0][0] + pts[spikes - 1][0]) / 2, (pts[0][1] + pts[spikes - 1][1]) / 2);
  for (let i = 0; i < spikes; i++) {
    const p = pts[i];
    const n = pts[(i + 1) % spikes];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2);
  }
  ctx.closePath();
}

/** Tapered limb / trunk / branch, drawn as a closed curve. */
function limbPath(ctx, x0, y0, x1, y1, w0, w1, bow = 0) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (x0 + x1) / 2 + nx * bow;
  const my = (y0 + y1) / 2 + ny * bow;
  const mw = (w0 + w1) * 0.5;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * w0, y0 + ny * w0);
  ctx.quadraticCurveTo(mx + nx * mw, my + ny * mw, x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
  ctx.quadraticCurveTo(mx - nx * mw, my - ny * mw, x0 - nx * w0, y0 - ny * w0);
  ctx.closePath();
}

function vgrad(ctx, y0, y1, stops) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [t, c, a] of stops) g.addColorStop(t, css(c, a ?? 1));
  return g;
}

/** Sprinkles subtle value noise inside the current clip so fills gain texture. */
function grainPass(ctx, rng, amount = 0.1, count = 220, box) {
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  for (let i = 0; i < count; i++) {
    const x = box.x + rng.float() * box.w;
    const y = box.y + rng.float() * box.h;
    const r = rng.range(0.6, 2.6);
    const v = rng.float() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${(rng.float() * amount).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.5, 1.4), rng.float() * TAU, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Edge light. Takes what has been drawn so far, keeps only the sliver that
 * sticks out on the upper-left, and paints it in the moon's colour. This one
 * pass is most of what separates "flat cut-out" from "lit object".
 */
function applyRim(ctx, w, h, color, alpha, dx = 2.5, dy = 3) {
  const tmp = makeCanvas(w, h);
  const t = ctxOf(tmp);
  t.drawImage(ctx.canvas, 0, 0);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = css(color);
  t.fillRect(0, 0, w, h);
  t.globalCompositeOperation = 'destination-out';
  t.drawImage(ctx.canvas, dx, dy);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

/** A drooping conifer branch: needle tufts threaded along a bowed curve. */
function drawFrond(ctx, x0, y0, ang, len, rng, colFn, opts = {}) {
  const steps = opts.steps ?? 13;
  const droop = opts.droop ?? 0.55;
  const baseR = opts.baseR ?? len * 0.17;
  const tipR = opts.tipR ?? len * 0.035;
  const pts = [];
  let x = x0;
  let y = y0;
  let a = ang;
  for (let i = 0; i < steps; i++) {
    a += droop / steps;
    x += Math.cos(a) * (len / steps);
    y += Math.sin(a) * (len / steps);
    pts.push([x + rng.range(-1.5, 1.5), y + rng.range(-1.5, 1.5)]);
  }
  // Tip first so the thick base overlaps it — reads as depth.
  for (let i = steps - 1; i >= 0; i--) {
    const t = i / (steps - 1);
    const [px, py] = pts[i];
    const r = lerp(baseR, tipR, t);
    organicPath(ctx, px, py, r * 1.25, r * 0.85, rng, 8, 0.34);
    ctx.fillStyle = colFn(t, i);
    ctx.fill();
  }
  // Needle fringe along the underside of the branch.
  ctx.save();
  ctx.lineWidth = 1.05;
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const [px, py] = pts[i];
    const n = Math.round(lerp(7, 2, t));
    for (let k = 0; k < n; k++) {
      const na = a + rng.range(-1.5, 1.5);
      const nl = lerp(len * 0.1, len * 0.03, t) * rng.range(0.5, 1.2);
      ctx.strokeStyle = colFn(clamp01(t + 0.18), i);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl + nl * 0.3);
      ctx.stroke();
    }
  }
  ctx.restore();
  return pts;
}

/** Contact darkening where an object meets the ground. */
function baseAO(ctx, cx, baseY, rx) {
  const g = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, rx);
  g.addColorStop(0, 'rgba(6,8,10,0.55)');
  g.addColorStop(0.5, 'rgba(6,8,10,0.28)');
  g.addColorStop(1, 'rgba(6,8,10,0)');
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(1, 0.34);
  ctx.translate(-cx, -baseY);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, baseY, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Sprite record
// ---------------------------------------------------------------------------

/**
 * Finds the opaque bounding box. Baked sprites carry a lot of empty margin
 * (a pine is mostly sky), and blitting those transparent pixels every frame
 * is the single most expensive thing the renderer does — so we cut them off.
 */
function contentBounds(canvas) {
  const c = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  const data = new Uint32Array(c.getImageData(0, 0, w, h).data.buffer);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      // Alpha is the top byte on little-endian, which every target is.
      if (data[row + x] >>> 24 > 3) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1 };
}

function sprite(w, h, ox, oy, draw, opts = {}) {
  let canvas = makeCanvas(w, h);
  const ctx = ctxOf(canvas);
  let emissive = opts.emissive ? makeCanvas(w, h) : null;
  const ectx = emissive ? ctxOf(emissive) : null;
  const lights = [];
  draw(ctx, ectx, lights);

  const b = contentBounds(canvas);
  if (b && (b.x1 - b.x0 < w - 4 || b.y1 - b.y0 < h - 4)) {
    const nw = b.x1 - b.x0 + 1;
    const nh = b.y1 - b.y0 + 1;
    const trimmed = makeCanvas(nw, nh);
    ctxOf(trimmed).drawImage(canvas, -b.x0, -b.y0);
    canvas = trimmed;
    if (emissive) {
      const te = makeCanvas(nw, nh);
      ctxOf(te).drawImage(emissive, -b.x0, -b.y0);
      emissive = te;
    }
    for (const L of lights) {
      L.x -= b.x0;
      L.y -= b.y0;
    }
    ox -= b.x0;
    oy -= b.y0;
    w = nw;
    h = nh;
  }

  return {
    canvas,
    emissive,
    ox,
    oy,
    w,
    h,
    lights,
    radius: opts.radius ?? 0,
    solid: opts.solid ?? false,
    sway: opts.sway ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

function drawPine(rng, opts = {}) {
  const H = opts.h ?? rng.range(178, 244);
  const W = H * 0.62;
  const w = Math.ceil(W);
  const h = Math.ceil(H + 16);
  const dead = opts.dead ?? false;
  const snowy = opts.snowy ?? false;

  return sprite(w, h, w / 2, h - 8, (ctx, _e, lights) => {
    const cx = w / 2;
    const baseY = h - 10;
    baseAO(ctx, cx, baseY, W * 0.4);

    // Trunk
    const trunkTop = baseY - H * 0.94;
    ctx.save();
    limbPath(ctx, cx + rng.range(-3, 3), baseY + 4, cx + rng.range(-7, 7), trunkTop, H * 0.05, H * 0.013, rng.range(-7, 7));
    ctx.fillStyle = vgrad(ctx, trunkTop, baseY, [
      [0, hex('#4a3a2c')],
      [0.5, hex('#33281e')],
      [1, hex('#1d1712')],
    ]);
    ctx.fill();
    ctx.restore();

    // Bark striations
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 34; i++) {
      const t = rng.float();
      const y = lerp(baseY, trunkTop, t);
      const halfW = lerp(H * 0.05, H * 0.014, t);
      const x = cx + rng.range(-halfW, halfW) * 0.85;
      ctx.strokeStyle = rng.bool() ? 'rgba(20,15,11,0.7)' : 'rgba(120,96,70,0.28)';
      ctx.lineWidth = rng.range(0.7, 2.1);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-2, 2), y - rng.range(8, 26));
      ctx.stroke();
    }
    ctx.restore();

    if (dead) {
      // Bare branches only.
      for (let i = 0; i < 10; i++) {
        const t = rng.range(0.25, 0.95);
        const y = lerp(baseY, trunkTop, t);
        const dir = rng.sign();
        const len = lerp(W * 0.42, W * 0.14, t) * rng.range(0.6, 1.2);
        ctx.strokeStyle = 'rgba(40,32,25,0.95)';
        ctx.lineWidth = lerp(5, 1.6, t);
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.quadraticCurveTo(cx + dir * len * 0.6, y - len * 0.2, cx + dir * len, y - len * rng.range(0.3, 0.7));
        ctx.stroke();
      }
      return;
    }

    // Canopy. Real drooping branches rather than stacked cones: a back layer
    // in near-black, then a front layer that catches the key light.
    const tiers = Math.round(rng.range(10, 13));
    const deepC = hex('#0b120e');
    const darkC = hex('#17251a');
    const midC = hex('#2b4526');
    const litC = hex('#526f33');
    const tipC = hex('#84994a');

    const canopyBase = baseY - H * 0.13;
    const canopyTop = trunkTop + H * 0.04;

    const frondCol = (tier, t, side, back) => {
      let c = mixc(deepC, darkC, clamp01(t * 1.6));
      c = mixc(c, midC, clamp01(t * 1.15) * (0.45 + tier * 0.55));
      if (back) return css(mixc(c, deepC, 0.62));
      c = mixc(c, litC, clamp01(t - 0.22) * (side < 0 ? 1.0 : 0.34) * (0.35 + tier * 0.75));
      if (side < 0) c = mixc(c, tipC, clamp01(t - 0.6) * 1.25 * tier);
      return css(c);
    };

    for (let pass = 0; pass < 2; pass++) {
      const back = pass === 0;
      for (let i = 0; i < tiers; i++) {
        const tt = i / (tiers - 1);
        const y = lerp(canopyBase, canopyTop, tt) + (back ? -H * 0.015 : 0);
        const spread = lerp(W * 0.54, W * 0.07, Math.pow(tt, 0.78));
        const count = Math.max(2, Math.round(lerp(back ? 4 : 6, 2, tt)));
        for (let k = 0; k < count; k++) {
          const side = k % 2 === 0 ? -1 : 1;
          const spin = (k / count) * 0.5 + rng.float() * 0.2;
          const len = spread * rng.range(back ? 0.6 : 0.84, back ? 0.86 : 1.14);
          ctx.save();
          if (side < 0) {
            ctx.translate(cx, 0);
            ctx.scale(-1, 1);
            ctx.translate(-cx, 0);
          }
          drawFrond(
            ctx,
            cx + rng.range(-3, 3),
            y + rng.range(-H * 0.014, H * 0.014),
            -0.42 + spin * 0.5,
            len,
            rng,
            (t) => frondCol(tt, t, side, back),
            {
              baseR: len * (0.2 - tt * 0.045),
              tipR: len * 0.028,
              droop: rng.range(0.62, 1.05),
              steps: 11,
            }
          );
          ctx.restore();
        }
      }
    }

    // Leader spike
    ctx.save();
    limbPath(ctx, cx, canopyTop + H * 0.04, cx + rng.range(-4, 4), trunkTop - H * 0.05, H * 0.02, 1.2, rng.range(-3, 3));
    ctx.fillStyle = css(mixc(darkC, midC, 0.6));
    ctx.fill();
    ctx.restore();

    if (snowy) {
      // Snow settles on the upper face of each tier, never underneath.
      ctx.save();
      for (let i = 0; i < tiers; i++) {
        const tt = i / (tiers - 1);
        const y = lerp(canopyBase, canopyTop, tt);
        const spread = lerp(W * 0.5, W * 0.07, Math.pow(tt, 0.78));
        for (let k = 0; k < 4; k++) {
          const x = cx + rng.range(-spread, spread) * 0.85;
          organicPath(ctx, x, y - H * 0.008, rng.range(6, 20), rng.range(2.5, 6), rng, 9, 0.45);
          ctx.fillStyle = `rgba(214,229,244,${rng.range(0.35, 0.8).toFixed(2)})`;
          ctx.fill();
        }
      }
      ctx.restore();
    }

    applyRim(ctx, w, h, snowy ? PAL.frost : PAL.moon, snowy ? 0.4 : 0.3, 2.5, 3.5);
  }, { radius: 16, solid: true, sway: 0.5 });
}

function drawBirch(rng) {
  const H = rng.range(168, 226);
  const W = H * 0.8;
  const w = Math.ceil(W * 1.35);
  const h = Math.ceil(H * 1.12);
  return sprite(w, h, w / 2, h - 10, (ctx) => {
    const cx = w / 2;
    const baseY = h - 10;
    baseAO(ctx, cx, baseY, W * 0.3);

    const trunkTop = baseY - H * 0.72;
    const lean = rng.range(-14, 14);
    ctx.save();
    limbPath(ctx, cx, baseY + 3, cx + lean, trunkTop, H * 0.026, H * 0.012, rng.range(-8, 8));
    ctx.fillStyle = vgrad(ctx, trunkTop, baseY, [
      [0, hex('#d9d6cb')],
      [0.35, hex('#c3c0b4')],
      [0.8, hex('#8f8c80')],
      [1, hex('#57544b')],
    ]);
    ctx.fill();
    // Dark birch scars
    ctx.clip();
    for (let i = 0; i < 26; i++) {
      const t = rng.float();
      const y = lerp(baseY, trunkTop, t);
      const x = lerp(cx, cx + lean, t) + rng.range(-12, 12);
      ctx.fillStyle = `rgba(26,24,22,${rng.range(0.4, 0.9).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(2, 9), rng.range(1, 2.6), rng.range(-0.2, 0.2), 0, TAU);
      ctx.fill();
    }
    // Shaded right edge
    const sg = ctx.createLinearGradient(cx - W * 0.05, 0, cx + W * 0.05, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0.12)');
    sg.addColorStop(0.55, 'rgba(0,0,0,0)');
    sg.addColorStop(1, 'rgba(20,18,16,0.5)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Branches + thin autumn canopy
    const canopyY = trunkTop - H * 0.02;
    for (let i = 0; i < 7; i++) {
      const dir = rng.sign();
      const y = trunkTop + rng.range(0, H * 0.16);
      ctx.strokeStyle = 'rgba(90,86,76,0.85)';
      ctx.lineWidth = rng.range(1.2, 2.6);
      ctx.beginPath();
      ctx.moveTo(cx + lean, y);
      ctx.quadraticCurveTo(cx + lean + dir * W * 0.2, y - H * 0.05, cx + lean + dir * W * 0.36, y - H * 0.14);
      ctx.stroke();
    }
    // Thin autumn canopy: hundreds of small leaves rather than a few blobs,
    // so the birch keeps its airy, see-through quality.
    const leafDark = hex('#3f4020');
    const leafMid = hex('#7d7331');
    const leafLit = hex('#c4ac48');
    const centres = [];
    for (let i = 0; i < 14; i++) {
      const a = rng.float() * TAU;
      const rr = Math.sqrt(rng.float());
      centres.push([
        cx + lean + Math.cos(a) * W * 0.4 * rr,
        canopyY - H * 0.07 + Math.sin(a) * H * 0.13 * rr,
        rng.range(14, 30),
      ]);
    }
    for (const [x, y, r] of centres) {
      ctx.save();
      organicPath(ctx, x, y + r * 0.2, r, r * 0.7, rng, 11, 0.36);
      ctx.fillStyle = css(leafDark, 0.5);
      ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < 460; i++) {
      const c = centres[(rng.float() * centres.length) | 0];
      const a = rng.float() * TAU;
      const rr = rng.float() * 1.15;
      const x = c[0] + Math.cos(a) * c[2] * rr;
      const y = c[1] + Math.sin(a) * c[2] * 0.72 * rr;
      const up = clamp01(1 - (y - (canopyY - H * 0.2)) / (H * 0.3));
      ctx.fillStyle = css(mixc(leafDark, mixc(leafMid, leafLit, up), rng.float()), rng.range(0.35, 0.95));
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(2, 5), rng.range(1.4, 3), rng.float() * TAU, 0, TAU);
      ctx.fill();
    }
    applyRim(ctx, w, h, PAL.moon, 0.24, 2, 3);
  }, { radius: 12, solid: true, sway: 0.9 });
}

function drawOak(rng, opts = {}) {
  const H = opts.h ?? rng.range(186, 236);
  const W = H * 0.82;
  const w = Math.ceil(W * 1.5);
  const h = Math.ceil(H * 1.32);
  const sacred = opts.sacred ?? false;
  return sprite(w, h, w / 2, h - 14, (ctx, ectx, lights) => {
    const cx = w / 2;
    const baseY = h - 14;
    baseAO(ctx, cx, baseY, W * 0.34);

    // Root flare
    ctx.save();
    ctx.fillStyle = css(hex('#241c14'));
    for (let i = 0; i < 7; i++) {
      const a = lerp(-0.4, Math.PI + 0.4, i / 6) + rng.range(-0.2, 0.2);
      const len = W * rng.range(0.1, 0.2);
      limbPath(ctx, cx, baseY - H * 0.06, cx + Math.cos(a) * len * 1.4, baseY + Math.abs(Math.sin(a)) * 6, H * 0.03, H * 0.012, 4);
      ctx.fill();
    }
    ctx.restore();

    // Trunk
    const forkY = baseY - H * 0.44;
    ctx.save();
    limbPath(ctx, cx, baseY, cx + rng.range(-10, 10), forkY, H * 0.075, H * 0.05, rng.range(-8, 8));
    ctx.fillStyle = vgrad(ctx, forkY, baseY, [
      [0, hex('#584634')],
      [0.45, hex('#3b2f22')],
      [1, hex('#1f1913')],
    ]);
    ctx.fill();
    ctx.clip();
    for (let i = 0; i < 60; i++) {
      const y = rng.range(forkY, baseY);
      const x = cx + rng.range(-H * 0.08, H * 0.08);
      ctx.strokeStyle = rng.bool() ? 'rgba(18,14,10,0.8)' : 'rgba(140,112,80,0.22)';
      ctx.lineWidth = rng.range(0.8, 2.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + rng.range(-4, 4), y - 14, x + rng.range(-6, 6), y - rng.range(20, 60));
      ctx.stroke();
    }
    ctx.restore();

    // Boughs, remembered so leaf mass can hang off them.
    const cy = forkY - H * 0.2;
    const boughs = 6;
    const tips = [];
    for (let i = 0; i < boughs; i++) {
      const a = lerp(-2.6, -0.55, i / (boughs - 1)) + rng.range(-0.16, 0.16);
      const len = H * rng.range(0.26, 0.42);
      const tx = cx + Math.cos(a) * len;
      const ty = forkY + Math.sin(a) * len * 0.9;
      ctx.save();
      limbPath(ctx, cx, forkY, tx, ty, H * 0.035, H * 0.012, rng.range(-12, 12));
      ctx.fillStyle = css(hex('#33291d'));
      ctx.fill();
      ctx.restore();
      tips.push([tx, ty]);
      // Secondary twigs reaching into the crown.
      for (let k = 0; k < 3; k++) {
        const a2 = a + rng.range(-0.7, 0.7);
        const l2 = len * rng.range(0.3, 0.55);
        const x2 = tx + Math.cos(a2) * l2;
        const y2 = ty + Math.sin(a2) * l2 * 0.9;
        ctx.save();
        limbPath(ctx, tx, ty, x2, y2, H * 0.014, H * 0.005, rng.range(-8, 8));
        ctx.fillStyle = css(hex('#2b2318'));
        ctx.fill();
        ctx.restore();
        tips.push([x2, y2]);
      }
    }

    // Canopy: leaf masses clustered around the twig tips, dark underside up
    // to a lit crest, so the crown has a top and a bottom.
    const dark = sacred ? hex('#141026') : hex('#101709');
    const mid = sacred ? hex('#2e2750') : hex('#22331a');
    const lit = sacred ? hex('#5f5296') : hex('#3f5525');
    const hot = sacred ? hex('#8e7bd0') : hex('#65763a');

    const clusters = [];
    for (const [tx, ty] of tips) {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        clusters.push([
          tx + rng.range(-W * 0.1, W * 0.1),
          ty + rng.range(-H * 0.1, H * 0.06),
          rng.range(W * 0.085, W * 0.17),
        ]);
      }
    }
    // Painter order: lowest (furthest under) first.
    clusters.sort((a, b) => b[1] - a[1]);

    for (const [x, y, r] of clusters) {
      const up = clamp01(1 - (y - (cy - H * 0.26)) / (H * 0.46));
      const left = clamp01(0.5 - (x - cx) / (W * 0.9));
      ctx.save();
      organicPath(ctx, x, y + r * 0.24, r * 1.02, r * 0.78, rng, 13, 0.32);
      ctx.fillStyle = css(dark, 0.95);
      ctx.fill();
      ctx.restore();
      ctx.save();
      organicPath(ctx, x - r * 0.09, y - r * 0.06, r * 0.86, r * 0.62, rng, 13, 0.34);
      ctx.fillStyle = css(mixc(mid, lit, up * 0.75 + left * 0.3), 0.92);
      ctx.fill();
      ctx.restore();
      if (up > 0.5) {
        ctx.save();
        organicPath(ctx, x - r * 0.2, y - r * 0.26, r * 0.5, r * 0.32, rng, 11, 0.38);
        ctx.fillStyle = css(mixc(lit, hot, (up - 0.5) * 1.6 * (0.4 + left)), 0.7);
        ctx.fill();
        ctx.restore();
      }
    }

    // Individual leaves biting into the silhouette.
    ctx.save();
    for (let i = 0; i < 620; i++) {
      const c = clusters[(rng.float() * clusters.length) | 0];
      const a = rng.float() * TAU;
      const rr = 0.82 + rng.float() * 0.4;
      const x = c[0] + Math.cos(a) * c[2] * rr;
      const y = c[1] + Math.sin(a) * c[2] * 0.78 * rr;
      const up = clamp01(1 - (y - (cy - H * 0.26)) / (H * 0.46));
      ctx.fillStyle = css(mixc(dark, mixc(lit, hot, up * 0.6), rng.float() * (0.35 + up * 0.75)), rng.range(0.45, 1));
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(2, 5.5), rng.range(1.3, 3.2), rng.float() * TAU, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // A couple of gaps where the sky shows through the crown.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      const x = cx + rng.range(-W * 0.32, W * 0.32);
      const y = cy + rng.range(-H * 0.14, H * 0.14);
      organicPath(ctx, x, y, rng.range(8, 22), rng.range(6, 16), rng, 9, 0.4);
      ctx.fill();
    }
    ctx.restore();

    applyRim(ctx, w, h, sacred ? hex('#d8b6ff') : PAL.moon, 0.3, 2.5, 3.5);

    if (sacred && ectx) {
      // Votive lights hung in the branches of the holy oak.
      for (let i = 0; i < 6; i++) {
        const x = cx + rng.range(-W * 0.35, W * 0.35);
        const y = cy + rng.range(-H * 0.1, H * 0.22);
        ectx.fillStyle = 'rgba(255,190,110,0.95)';
        ectx.beginPath();
        ectx.arc(x, y, 3.2, 0, TAU);
        ectx.fill();
        ctx.fillStyle = 'rgba(255,206,140,0.9)';
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, TAU);
        ctx.fill();
        lights.push({ x, y, r: 90, color: PAL.torch, i: 0.55, flicker: 0.35 });
      }
    }
  }, { radius: 26, solid: true, sway: 0.35, emissive: opts.sacred });
}

function drawDeadTree(rng) {
  const H = rng.range(150, 214);
  const W = H * 0.8;
  const w = Math.ceil(W);
  const h = Math.ceil(H + 14);
  return sprite(w, h, w / 2, h - 8, (ctx) => {
    const cx = w / 2;
    const baseY = h - 10;
    baseAO(ctx, cx, baseY, W * 0.26);
    const col = hex('#2a241d');
    const lit = hex('#6b6152');

    const branch = (x, y, a, len, wdt, depth) => {
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      ctx.save();
      limbPath(ctx, x, y, x2, y2, wdt, wdt * 0.55, rng.range(-len * 0.12, len * 0.12));
      ctx.fillStyle = css(col);
      ctx.fill();
      ctx.strokeStyle = css(lit, 0.28);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      if (depth <= 0 || len < 12) return;
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        branch(x2, y2, a + rng.range(-0.75, 0.75), len * rng.range(0.55, 0.76), wdt * 0.58, depth - 1);
      }
    };
    branch(cx, baseY, -Math.PI / 2 + rng.range(-0.15, 0.15), H * 0.36, H * 0.035, 4);
  }, { radius: 10, solid: true, sway: 0.6 });
}

// ---------------------------------------------------------------------------
// Rocks, ruins, structures
// ---------------------------------------------------------------------------

function drawRock(rng, opts = {}) {
  const S = opts.s ?? rng.range(52, 112);
  const w = Math.ceil(S * 1.5);
  const h = Math.ceil(S * 1.25);
  const mossy = opts.mossy ?? false;
  const amber = opts.amber ?? false;
  return sprite(w, h, w / 2, h - S * 0.12, (ctx, ectx, lights) => {
    const cx = w / 2;
    const baseY = h - S * 0.14;
    baseAO(ctx, cx, baseY, S * 0.65);

    const base = amber ? hex('#5a4630') : hex('#3e4045');
    const light = amber ? hex('#a9834a') : hex('#767a82');
    const dark = amber ? hex('#1e1710') : hex('#191b1f');

    // Silhouette
    ctx.save();
    organicPath(ctx, cx, baseY - S * 0.36, S * 0.62, S * 0.42, rng, 10, 0.26);
    ctx.fillStyle = css(dark);
    ctx.fill();
    ctx.clip();

    // Facets — flat-ish planes catching the key light differently
    const facets = rng.int(5, 8);
    for (let i = 0; i < facets; i++) {
      const a0 = (i / facets) * TAU + rng.range(-0.2, 0.2);
      const a1 = a0 + TAU / facets + rng.range(0, 0.3);
      const fx = cx + Math.cos((a0 + a1) / 2) * S * 0.16;
      const fy = baseY - S * 0.36 + Math.sin((a0 + a1) / 2) * S * 0.13;
      ctx.beginPath();
      ctx.moveTo(cx + rng.range(-8, 8), baseY - S * 0.36 + rng.range(-8, 8));
      ctx.lineTo(fx + Math.cos(a0) * S * 0.7, fy + Math.sin(a0) * S * 0.5);
      ctx.lineTo(fx + Math.cos(a1) * S * 0.7, fy + Math.sin(a1) * S * 0.5);
      ctx.closePath();
      // Light contribution from the upper-left key.
      const nrm = Math.cos((a0 + a1) / 2 - (-2.2));
      const t = clamp01(0.5 + nrm * 0.5);
      ctx.fillStyle = css(mixc(dark, light, t * t * 0.95), 0.95);
      ctx.fill();
    }

    // Chipped sub-facets break up the big planes.
    for (let i = 0; i < 14; i++) {
      const a = rng.float() * TAU;
      const rr = rng.float();
      const x = cx + Math.cos(a) * S * 0.5 * rr;
      const y = baseY - S * 0.36 + Math.sin(a) * S * 0.34 * rr;
      const r = rng.range(S * 0.05, S * 0.16);
      organicPath(ctx, x, y, r, r * rng.range(0.5, 0.9), rng, 6, 0.3);
      const nrm = Math.cos(a - -2.2);
      ctx.fillStyle = css(mixc(dark, light, clamp01(0.5 + nrm * 0.5) * 0.85), rng.range(0.2, 0.5));
      ctx.fill();
    }

    // Cracks
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = css(dark);
    for (let i = 0; i < 6; i++) {
      ctx.lineWidth = rng.range(0.7, 1.8);
      ctx.beginPath();
      let x = cx + rng.range(-S * 0.5, S * 0.5);
      let y = baseY - S * 0.36 + rng.range(-S * 0.3, S * 0.3);
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += rng.range(-S * 0.16, S * 0.16);
        y += rng.range(-S * 0.12, S * 0.12);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Lichen — pale crusty blotches, the thing that makes stone look old.
    for (let i = 0; i < 22; i++) {
      const a = rng.float() * TAU;
      const rr = Math.sqrt(rng.float());
      const x = cx + Math.cos(a) * S * 0.55 * rr;
      const y = baseY - S * 0.4 + Math.sin(a) * S * 0.36 * rr;
      const r = rng.range(S * 0.02, S * 0.09);
      organicPath(ctx, x, y, r, r * 0.75, rng, 9, 0.42);
      const pale = rng.bool(0.6) ? hex('#7d8a72') : hex('#9a9276');
      ctx.fillStyle = css(pale, rng.range(0.1, 0.34));
      ctx.fill();
    }

    // Underside shadow so it doesn't read as a floating pebble.
    const ug = ctx.createLinearGradient(0, baseY - S * 0.5, 0, baseY);
    ug.addColorStop(0, 'rgba(0,0,0,0)');
    ug.addColorStop(1, 'rgba(6,7,9,0.6)');
    ctx.fillStyle = ug;
    ctx.fillRect(0, 0, w, h);

    grainPass(ctx, rng, 0.3, 900, { x: 0, y: 0, w, h });
    ctx.restore();

    applyRim(ctx, w, h, PAL.moon, 0.26, 2.5, 3);

    if (mossy) {
      // Moss creeps over the upper face in patches, not as one flat decal.
      ctx.save();
      for (let i = 0; i < 26; i++) {
        const x = cx + rng.range(-S * 0.5, S * 0.42);
        const y = baseY - S * 0.62 + rng.range(-S * 0.12, S * 0.22);
        const r = rng.range(S * 0.04, S * 0.15);
        organicPath(ctx, x, y, r, r * rng.range(0.35, 0.6), rng, 10, 0.45);
        ctx.fillStyle = css(mixc(hex('#26361c'), hex('#5c7434'), rng.float()), rng.range(0.25, 0.7));
        ctx.fill();
      }
      ctx.restore();
    }
    if (amber && ectx) {
      // Amber veins glowing in the boulder.
      for (let i = 0; i < 5; i++) {
        const x = cx + rng.range(-S * 0.4, S * 0.4);
        const y = baseY - S * 0.36 + rng.range(-S * 0.25, S * 0.25);
        const r = rng.range(3, 8);
        ctx.fillStyle = css(PAL.amber, 0.85);
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.7, rng.float() * TAU, 0, TAU);
        ctx.fill();
        ectx.fillStyle = css(PAL.amber, 0.9);
        ectx.beginPath();
        ectx.ellipse(x, y, r * 1.2, r * 0.9, 0, 0, TAU);
        ectx.fill();
      }
      lights.push({ x: cx, y: baseY - S * 0.36, r: S * 2.2, color: PAL.amber, i: 0.5, flicker: 0.12 });
    }
  }, { radius: S * 0.42, solid: true, emissive: opts.amber });
}

function drawRuinWall(rng, opts = {}) {
  const W = opts.w ?? rng.range(150, 250);
  const H = opts.h ?? rng.range(100, 180);
  const w = Math.ceil(W);
  const h = Math.ceil(H + 30);
  return sprite(w, h, w / 2, h - 12, (ctx) => {
    const baseY = h - 14;
    baseAO(ctx, w / 2, baseY, W * 0.55);

    const brickH = 22;
    const rows = Math.floor(H / brickH);
    // Broken top profile
    const topAt = (x) => {
      const t = x / W;
      return baseY - H * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 7 + rng.seed % 7)) * (0.6 + 0.4 * Math.sin(t * 3.1)));
    };

    for (let r = 0; r < rows; r++) {
      const y = baseY - r * brickH;
      const off = (r % 2) * 24;
      for (let x = -24 + off; x < W; x += 48) {
        const bw = 46 + rng.range(-3, 3);
        const bh = brickH - 2;
        const topY = topAt(x + bw / 2);
        if (y - bh < topY) continue;
        const tone = rng.range(0.25, 0.85);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + rng.range(0, 2), y);
        ctx.lineTo(x + bw + rng.range(-2, 1), y - rng.range(0, 1.5));
        ctx.lineTo(x + bw + rng.range(-2, 1), y - bh);
        ctx.lineTo(x + rng.range(0, 2), y - bh + rng.range(-1, 1));
        ctx.closePath();
        const g = ctx.createLinearGradient(x, y - bh, x + bw, y);
        g.addColorStop(0, css(mixc(hex('#6b6459'), hex('#8b8478'), tone)));
        g.addColorStop(1, css(mixc(hex('#33302b'), hex('#5a544b'), tone)));
        ctx.fillStyle = g;
        ctx.fill();
        // Top bevel highlight
        ctx.strokeStyle = 'rgba(200,205,215,0.16)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x + 1, y - bh + 1);
        ctx.lineTo(x + bw - 1, y - bh + 1);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Mortar grime and moss wash. `source-atop` keeps it inside the masonry —
    // `multiply` would paint clouds over the empty sky above the broken top.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 40; i++) {
      const x = rng.range(0, W);
      const y = rng.range(baseY - H, baseY);
      const r = rng.range(14, 46);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rng.bool() ? '60,70,45' : '40,38,34'},0.4)`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();

    // Rubble at the foot
    for (let i = 0; i < 14; i++) {
      const x = rng.range(-6, W + 6);
      const y = baseY + rng.range(-4, 8);
      ctx.save();
      organicPath(ctx, x, y, rng.range(5, 16), rng.range(3, 8), rng, 8, 0.3);
      ctx.fillStyle = css(mixc(hex('#302d29'), hex('#7a746a'), rng.float()), 0.95);
      ctx.fill();
      ctx.restore();
    }
  }, { radius: W * 0.28, solid: true });
}

function drawBrazier(rng) {
  const w = 150;
  const h = 250;
  return sprite(w, h, w / 2, h - 10, (ctx, ectx, lights) => {
    const cx = w / 2;
    const baseY = h - 12;
    baseAO(ctx, cx, baseY, 54);

    // Wrought-iron tripod with a cross-brace
    const legTop = baseY - 118;
    ctx.lineCap = 'round';
    for (const dx of [-1, 0.15, 1]) {
      ctx.strokeStyle = css(hex('#191b1f'));
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(cx + dx * 34, baseY);
      ctx.quadraticCurveTo(cx + dx * 20, baseY - 62, cx + dx * 26, legTop);
      ctx.stroke();
      ctx.strokeStyle = css(hex('#4a4e57'), 0.55);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + dx * 34 - 2, baseY);
      ctx.quadraticCurveTo(cx + dx * 20 - 2, baseY - 62, cx + dx * 26 - 2, legTop);
      ctx.stroke();
    }
    ctx.strokeStyle = css(hex('#20232a'));
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(cx, baseY - 52, 30, 9, 0, 0, TAU);
    ctx.stroke();

    // Bowl
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - 50, baseY - 124);
    ctx.quadraticCurveTo(cx, baseY - 80, cx + 50, baseY - 124);
    ctx.lineTo(cx + 56, baseY - 140);
    ctx.quadraticCurveTo(cx, baseY - 122, cx - 56, baseY - 140);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - 56, 0, cx + 56, 0);
    g.addColorStop(0, css(hex('#5f636d')));
    g.addColorStop(0.35, css(hex('#33363d')));
    g.addColorStop(0.75, css(hex('#212429')));
    g.addColorStop(1, css(hex('#14161a')));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    // Rivets along the rim
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const x = lerp(cx - 52, cx + 52, t);
      const y = baseY - 136 + Math.sin(t * Math.PI) * 5;
      ctx.fillStyle = 'rgba(126,132,142,0.5)';
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, TAU);
      ctx.fill();
    }

    // Coal bed
    for (let i = 0; i < 30; i++) {
      const x = cx + rng.range(-46, 46);
      const y = baseY - 134 + rng.range(-5, 6);
      const t = rng.float();
      ctx.fillStyle = css(mixc(hex('#2d1409'), PAL.torchCore, t * t * t), 0.96);
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(3, 8), rng.range(2, 5), 0, 0, TAU);
      ctx.fill();
    }
    // Flame tongues
    for (let i = 0; i < 7; i++) {
      const x = cx + rng.range(-32, 32);
      const hgt = rng.range(26, 74);
      const y0 = baseY - 138;
      ctx.beginPath();
      ctx.moveTo(x - rng.range(6, 13), y0);
      ctx.quadraticCurveTo(x + rng.range(-9, 9), y0 - hgt * 0.55, x + rng.range(-5, 5), y0 - hgt);
      ctx.quadraticCurveTo(x + rng.range(-6, 12), y0 - hgt * 0.5, x + rng.range(6, 13), y0);
      ctx.closePath();
      const fg = ctx.createLinearGradient(0, y0, 0, y0 - hgt);
      fg.addColorStop(0, css(PAL.torchCore, 0.85));
      fg.addColorStop(0.45, css(PAL.torch, 0.6));
      fg.addColorStop(1, css(hex('#8d3a12'), 0));
      ctx.fillStyle = fg;
      ctx.fill();
      if (ectx) {
        ectx.fillStyle = fg;
        ectx.fill();
      }
    }
    if (ectx) {
      const eg = ectx.createRadialGradient(cx, baseY - 150, 0, cx, baseY - 150, 42);
      eg.addColorStop(0, css(PAL.torchCore, 0.55));
      eg.addColorStop(0.4, css(PAL.torch, 0.3));
      eg.addColorStop(1, css(PAL.torch, 0));
      ectx.fillStyle = eg;
      ectx.fillRect(cx - 46, baseY - 196, 92, 92);
    }
    lights.push({ x: cx, y: baseY - 150, r: 360, color: PAL.torch, i: 1.05, flicker: 1 });
  }, { radius: 30, solid: true, emissive: true });
}

/** Cross pattée — the Order's mark, arms flaring outward from the centre. */
function crossPattee(ctx, cx, cy, arm, thin, thick) {
  ctx.beginPath();
  for (let q = 0; q < 4; q++) {
    const a = (q * Math.PI) / 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Local arm: from (thin/2 at centre) flaring to (thick/2 at the tip).
    const pts = [
      [thin * 0.5, -thin * 0.5],
      [arm, -thick * 0.5],
      [arm, thick * 0.5],
      [thin * 0.5, thin * 0.5],
    ];
    let first = true;
    for (const [px, py] of pts) {
      const x = cx + px * ca - py * sa;
      const y = cy + px * sa + py * ca;
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill('nonzero');
}

function drawBanner(rng, opts = {}) {
  const w = 96;
  const h = 236;
  const white = opts.white ?? true;
  return sprite(w, h, w * 0.32, h - 8, (ctx) => {
    const px = w * 0.32;
    const baseY = h - 10;
    baseAO(ctx, px, baseY, 30);
    // Pole
    const pg = ctx.createLinearGradient(px - 5, 0, px + 5, 0);
    pg.addColorStop(0, css(hex('#6a5136')));
    pg.addColorStop(0.5, css(hex('#3a2c1e')));
    pg.addColorStop(1, css(hex('#1d160f')));
    ctx.fillStyle = pg;
    ctx.fillRect(px - 5, baseY - 306, 10, 306);
    // Finial
    ctx.fillStyle = css(PAL.gold, 0.85);
    ctx.beginPath();
    ctx.moveTo(px, baseY - 326);
    ctx.lineTo(px + 7, baseY - 308);
    ctx.lineTo(px, baseY - 300);
    ctx.lineTo(px - 7, baseY - 308);
    ctx.closePath();
    ctx.fill();
    // Crossbar the cloth hangs from
    ctx.fillStyle = css(hex('#2f2418'));
    ctx.fillRect(px - 4, baseY - 300, 78, 7);

    // Cloth
    const top = baseY - 294;
    const bot = baseY - 96;
    const right = px + 74;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px - 2, top);
    ctx.lineTo(right, top + 5);
    ctx.quadraticCurveTo(right - 9, (top + bot) / 2, right + 3, bot - 8);
    ctx.quadraticCurveTo(px + 32, bot + 14, px - 2, bot);
    ctx.closePath();
    const g = ctx.createLinearGradient(px, 0, right, 0);
    if (white) {
      g.addColorStop(0, css(hex('#7d7a70')));
      g.addColorStop(0.35, css(PAL.orderWhite));
      g.addColorStop(0.75, css(hex('#b3afa2')));
      g.addColorStop(1, css(hex('#6e6c64')));
    } else {
      g.addColorStop(0, css(hex('#2c0e10')));
      g.addColorStop(0.4, css(hex('#7a262a')));
      g.addColorStop(1, css(hex('#280c0e')));
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();

    const bx = px + 36;
    const by = (top + bot) / 2;
    if (white) {
      ctx.fillStyle = css(PAL.orderBlack, 0.92);
      crossPattee(ctx, bx, by, 46, 13, 34);
    } else {
      ctx.fillStyle = css(hex('#d8cfa8'), 0.85);
      crossPattee(ctx, bx, by, 42, 12, 30);
    }

    // Folds: vertical shadow bands with a soft edge.
    for (let i = 0; i < 7; i++) {
      const x = px + rng.range(2, 70);
      const fw = rng.range(5, 16);
      const fg = ctx.createLinearGradient(x, 0, x + fw, 0);
      fg.addColorStop(0, 'rgba(255,255,255,0.06)');
      fg.addColorStop(0.5, `rgba(18,16,14,${rng.range(0.1, 0.28).toFixed(2)})`);
      fg.addColorStop(1, 'rgba(255,255,255,0.05)');
      ctx.fillStyle = fg;
      ctx.fillRect(x, top - 4, fw, bot - top + 24);
    }
    // Weathering
    for (let i = 0; i < 14; i++) {
      const x = px + rng.range(0, 74);
      const y = rng.range(top, bot);
      const r = rng.range(8, 26);
      const sg = ctx.createRadialGradient(x, y, 0, x, y, r);
      sg.addColorStop(0, `rgba(64,54,38,${rng.range(0.08, 0.24).toFixed(2)})`);
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();

    // Tattered lower edge
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9; i++) {
      const y = lerp(bot - 34, bot + 12, rng.float());
      ctx.beginPath();
      ctx.moveTo(right + 8, y);
      ctx.lineTo(px + rng.range(20, 56), y + rng.range(4, 18));
      ctx.lineTo(right + 8, y + rng.range(10, 26));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    applyRim(ctx, w, h, PAL.moon, 0.2, 2, 2.5);
  }, { radius: 8, solid: false, sway: 1.4 });
}

function drawWreck(rng) {
  const w = 420;
  const h = 260;
  return sprite(w, h, w / 2, h - 20, (ctx) => {
    const baseY = h - 26;
    baseAO(ctx, w / 2, baseY, 170);
    // Hull, canted over
    ctx.save();
    ctx.translate(w / 2, baseY);
    ctx.rotate(-0.16);
    ctx.beginPath();
    ctx.moveTo(-170, 0);
    ctx.quadraticCurveTo(-150, -70, -60, -86);
    ctx.lineTo(110, -78);
    ctx.quadraticCurveTo(170, -66, 158, 4);
    ctx.quadraticCurveTo(20, 34, -170, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -90, 0, 20);
    g.addColorStop(0, css(hex('#4c3a26')));
    g.addColorStop(0.6, css(hex('#2e2317')));
    g.addColorStop(1, css(hex('#171109')));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // Planking
    for (let y = -84; y < 20; y += 11) {
      ctx.strokeStyle = `rgba(18,13,8,0.6)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-180, y);
      ctx.quadraticCurveTo(0, y + 8, 180, y);
      ctx.stroke();
      ctx.strokeStyle = `rgba(150,124,88,0.13)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-180, y + 2);
      ctx.quadraticCurveTo(0, y + 10, 180, y + 2);
      ctx.stroke();
    }
    // Hole in the hull
    ctx.globalCompositeOperation = 'destination-out';
    organicPath(ctx, 30, -30, 42, 30, rng, 10, 0.35);
    ctx.fill();
    ctx.restore();

    // Broken mast
    ctx.save();
    ctx.translate(w / 2 - 30, baseY - 70);
    ctx.rotate(-0.5);
    ctx.fillStyle = css(hex('#3b2c1c'));
    ctx.fillRect(-7, -150, 14, 150);
    ctx.beginPath();
    ctx.moveTo(-7, -150);
    ctx.lineTo(0, -172);
    ctx.lineTo(7, -150);
    ctx.closePath();
    ctx.fill();
    // Shred of sail
    ctx.fillStyle = 'rgba(190,184,168,0.35)';
    ctx.beginPath();
    ctx.moveTo(7, -140);
    ctx.quadraticCurveTo(60, -120, 44, -60);
    ctx.quadraticCurveTo(30, -84, 7, -76);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Ribs poking out
    for (let i = 0; i < 6; i++) {
      const x = w / 2 + lerp(-140, 120, i / 5) + rng.range(-10, 10);
      ctx.strokeStyle = css(hex('#2a2015'));
      ctx.lineWidth = rng.range(5, 9);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, baseY - 10);
      ctx.quadraticCurveTo(x + rng.range(-14, 14), baseY - 60, x + rng.range(-24, 24), baseY - rng.range(80, 130));
      ctx.stroke();
    }
    // Ice piled against the windward side.
    for (let i = 0; i < 10; i++) {
      const x = w / 2 + rng.range(-190, -60);
      const y = baseY + rng.range(-14, 10);
      organicPath(ctx, x, y, rng.range(10, 30), rng.range(4, 12), rng, 8, 0.3);
      ctx.fillStyle = css(mixc(hex('#6d8598'), hex('#cfe0ee'), rng.float()), rng.range(0.4, 0.85));
      ctx.fill();
    }
    applyRim(ctx, w, h, PAL.moon, 0.34, 3, 3.5);
  }, { radius: 92, solid: true });
}

function drawIdol(rng, opts = {}) {
  const w = 110;
  const h = 250;
  const lit = opts.lit ?? false;
  return sprite(w, h, w / 2, h - 8, (ctx, ectx, lights) => {
    const cx = w / 2;
    const baseY = h - 10;
    baseAO(ctx, cx, baseY, 34);
    // Carved log
    ctx.save();
    limbPath(ctx, cx, baseY, cx + rng.range(-6, 6), baseY - 210, 22, 18, rng.range(-6, 6));
    const g = ctx.createLinearGradient(cx - 24, 0, cx + 24, 0);
    g.addColorStop(0, css(hex('#5d4830')));
    g.addColorStop(0.4, css(hex('#3a2c1c')));
    g.addColorStop(1, css(hex('#1d160e')));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    for (let i = 0; i < 30; i++) {
      const y = baseY - rng.range(0, 210);
      ctx.strokeStyle = 'rgba(16,12,8,0.6)';
      ctx.lineWidth = rng.range(0.7, 2);
      ctx.beginPath();
      ctx.moveTo(cx - 24, y);
      ctx.lineTo(cx + 24, y + rng.range(-3, 3));
      ctx.stroke();
    }
    ctx.restore();
    // Face: carved brow, hollow eyes, slit mouth
    const fy = baseY - 172;
    ctx.fillStyle = 'rgba(12,9,6,0.9)';
    ctx.beginPath();
    ctx.ellipse(cx - 8, fy, 5.5, 4, 0, 0, TAU);
    ctx.ellipse(cx + 8, fy, 5.5, 4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(90,72,50,0.55)';
    ctx.fillRect(cx - 18, fy - 12, 36, 5);
    ctx.fillStyle = 'rgba(12,9,6,0.85)';
    ctx.fillRect(cx - 11, fy + 18, 22, 4);
    // Antler crown
    ctx.strokeStyle = css(PAL.bone, 0.8);
    ctx.lineWidth = 3;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + dir * 8, baseY - 206);
      ctx.quadraticCurveTo(cx + dir * 34, baseY - 226, cx + dir * 26, baseY - 250);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + dir * 22, baseY - 224);
      ctx.lineTo(cx + dir * 40, baseY - 234);
      ctx.stroke();
    }
    if (lit && ectx) {
      ectx.fillStyle = css(PAL.bogfire, 0.9);
      ectx.beginPath();
      ectx.ellipse(cx - 8, fy, 8, 6, 0, 0, TAU);
      ectx.ellipse(cx + 8, fy, 8, 6, 0, 0, TAU);
      ectx.fill();
      ctx.fillStyle = css(PAL.bogfire, 0.9);
      ctx.beginPath();
      ctx.ellipse(cx - 8, fy, 4, 3, 0, 0, TAU);
      ctx.ellipse(cx + 8, fy, 4, 3, 0, 0, TAU);
      ctx.fill();
      lights.push({ x: cx, y: fy, r: 200, color: PAL.bogfire, i: 0.7, flicker: 0.5 });
    }
  }, { radius: 14, solid: true, emissive: opts.lit });
}

function drawReeds(rng) {
  const w = 130;
  const h = 150;
  return sprite(w, h, w / 2, h - 6, (ctx) => {
    const cx = w / 2;
    const baseY = h - 8;
    for (let i = 0; i < 26; i++) {
      const x = cx + rng.range(-52, 52);
      const len = rng.range(50, 132);
      const bend = rng.range(-24, 24);
      ctx.strokeStyle = css(mixc(hex('#3e4028'), hex('#8a875a'), rng.float()), rng.range(0.5, 0.95));
      ctx.lineWidth = rng.range(1.1, 2.4);
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + bend * 0.4, baseY - len * 0.6, x + bend, baseY - len);
      ctx.stroke();
      if (rng.bool(0.3)) {
        ctx.fillStyle = css(hex('#4a3a22'), 0.85);
        ctx.beginPath();
        ctx.ellipse(x + bend, baseY - len - 5, 2.6, 8, bend * 0.01, 0, TAU);
        ctx.fill();
      }
    }
  }, { radius: 0, solid: false, sway: 2.2 });
}

function drawGrassTuft(rng) {
  const w = 60;
  const h = 46;
  return sprite(w, h, w / 2, h - 3, (ctx) => {
    const cx = w / 2;
    const baseY = h - 4;
    for (let i = 0; i < 14; i++) {
      const x = cx + rng.range(-20, 20);
      const len = rng.range(10, 34);
      const bend = rng.range(-12, 12);
      ctx.strokeStyle = css(mixc(hex('#2c3a1e'), hex('#6c7a36'), rng.float()), rng.range(0.5, 0.9));
      ctx.lineWidth = rng.range(0.9, 1.9);
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.quadraticCurveTo(x + bend * 0.3, baseY - len * 0.6, x + bend, baseY - len);
      ctx.stroke();
    }
  }, { radius: 0, solid: false, sway: 2.6 });
}

function drawBones(rng) {
  const w = 110;
  const h = 70;
  return sprite(w, h, w / 2, h - 8, (ctx) => {
    baseAO(ctx, w / 2, h - 10, 34);
    for (let i = 0; i < 7; i++) {
      const x = rng.range(18, w - 18);
      const y = rng.range(h - 34, h - 8);
      const a = rng.float() * Math.PI;
      const len = rng.range(14, 34);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = css(mixc(PAL.boneDark, PAL.bone, rng.float()), 0.95);
      ctx.beginPath();
      ctx.roundRect(-len / 2, -2.6, len, 5.2, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-len / 2, 0, 4, 0, TAU);
      ctx.arc(len / 2, 0, 4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // A skull
    const sx = w / 2 + rng.range(-16, 16);
    const sy = h - 22;
    ctx.fillStyle = css(PAL.bone, 0.96);
    ctx.beginPath();
    ctx.ellipse(sx, sy, 13, 11, rng.range(-0.3, 0.3), 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,16,12,0.85)';
    ctx.beginPath();
    ctx.ellipse(sx - 5, sy - 1, 3.4, 3.8, 0, 0, TAU);
    ctx.ellipse(sx + 5, sy - 1, 3.4, 3.8, 0, 0, TAU);
    ctx.fill();
    ctx.fillRect(sx - 2, sy + 5, 4, 4);
  }, { radius: 0, solid: false });
}

/** A hanse trade crate, seen slightly from above. Smashable for loot. */
function drawCrate(rng) {
  const w = 130;
  const h = 120;
  return sprite(w, h, w / 2, h - 8, (ctx) => {
    const cx = w / 2;
    const baseY = h - 10;
    baseAO(ctx, cx, baseY, 46);
    const bw = 84;
    const bh = 66;
    const lidD = 15; // apparent depth of the top face
    const top = baseY - bh;

    // Front face
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - bw / 2, top, bw, bh);
    const g = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
    g.addColorStop(0, css(hex('#6b5033')));
    g.addColorStop(0.4, css(hex('#4a3722')));
    g.addColorStop(1, css(hex('#241b11')));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // Vertical planks with gaps
    for (let i = 1; i < 5; i++) {
      const x = cx - bw / 2 + (i * bw) / 5;
      ctx.strokeStyle = 'rgba(14,10,6,0.65)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + rng.range(-1.5, 1.5), baseY);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(150,120,84,0.14)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 2, top);
      ctx.lineTo(x + 2, baseY);
      ctx.stroke();
    }
    // Grain
    for (let i = 0; i < 40; i++) {
      const y = rng.range(top, baseY);
      ctx.strokeStyle = `rgba(20,14,9,${rng.range(0.06, 0.2).toFixed(2)})`;
      ctx.lineWidth = rng.range(0.6, 1.6);
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, y);
      ctx.lineTo(cx + bw / 2, y + rng.range(-2, 2));
      ctx.stroke();
    }
    ctx.restore();

    // Top face
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - bw / 2, top);
    ctx.lineTo(cx - bw / 2 + 9, top - lidD);
    ctx.lineTo(cx + bw / 2 + 9, top - lidD);
    ctx.lineTo(cx + bw / 2, top);
    ctx.closePath();
    const tg = ctx.createLinearGradient(0, top - lidD, 0, top);
    tg.addColorStop(0, css(hex('#8a6941')));
    tg.addColorStop(1, css(hex('#5b442a')));
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.clip();
    for (let i = 1; i < 5; i++) {
      const x = cx - bw / 2 + (i * bw) / 5;
      ctx.strokeStyle = 'rgba(16,11,7,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + 9, top - lidD);
      ctx.stroke();
    }
    ctx.restore();

    // Iron bands and corner brackets
    ctx.fillStyle = css(hex('#2c2f35'));
    ctx.fillRect(cx - bw / 2 - 2, top + bh * 0.22, bw + 4, 7);
    ctx.fillRect(cx - bw / 2 - 2, top + bh * 0.72, bw + 4, 7);
    ctx.fillStyle = 'rgba(140,148,160,0.25)';
    ctx.fillRect(cx - bw / 2 - 2, top + bh * 0.22, bw + 4, 2);
    ctx.fillRect(cx - bw / 2 - 2, top + bh * 0.72, bw + 4, 2);
    for (const sx of [cx - bw / 2 - 2, cx + bw / 2 - 5]) {
      ctx.fillStyle = css(hex('#24272c'));
      ctx.fillRect(sx, top, 7, bh);
    }
    // Rivets
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = 'rgba(160,166,176,0.35)';
      ctx.beginPath();
      ctx.arc(cx - bw / 2 + 2 + (i * bw) / 7, top + bh * 0.22 + 3.5, 1.8, 0, TAU);
      ctx.fill();
    }
    applyRim(ctx, w, h, PAL.moon, 0.22, 2, 2.5);
  }, { radius: 34, solid: true });
}

function drawStandingStone(rng) {
  const H = rng.range(116, 164);
  const w = Math.ceil(H * 0.58);
  const h = Math.ceil(H + 20);
  return sprite(w, h, w / 2, h - 10, (ctx, ectx, lights) => {
    const cx = w / 2;
    const baseY = h - 12;
    baseAO(ctx, cx, baseY, w * 0.42);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.26, baseY);
    ctx.lineTo(cx - w * 0.2 + rng.range(-6, 6), baseY - H * 0.86);
    ctx.lineTo(cx + rng.range(-8, 8), baseY - H);
    ctx.lineTo(cx + w * 0.22 + rng.range(-6, 6), baseY - H * 0.8);
    ctx.lineTo(cx + w * 0.27, baseY);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - w * 0.3, 0, cx + w * 0.3, 0);
    g.addColorStop(0, css(hex('#4e5359')));
    g.addColorStop(0.42, css(hex('#2f3338')));
    g.addColorStop(1, css(hex('#15181b')));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = `rgba(20,22,26,${rng.range(0.15, 0.5).toFixed(2)})`;
      ctx.lineWidth = rng.range(0.8, 2.4);
      const y = baseY - rng.range(0, H);
      ctx.beginPath();
      ctx.moveTo(cx - w, y);
      ctx.lineTo(cx + w, y + rng.range(-14, 14));
      ctx.stroke();
    }
    ctx.restore();
    // Carved runes: vertical staves with angular branches. Geometry is built
    // once, then stroked three times — groove, glow, and bloom.
    const strokes = [];
    const runes = rng.int(4, 6);
    for (let i = 0; i < runes; i++) {
      const y = baseY - H * (0.26 + 0.52 * (i / runes));
      const x = cx + rng.range(-8, 8);
      strokes.push([x, y - 11, x, y + 11]);
      const arms = rng.int(2, 3);
      for (let k = 0; k < arms; k++) {
        const ay = y - 9 + ((k + 0.5) * 20) / arms + rng.range(-2, 2);
        const dir = rng.sign();
        strokes.push([x, ay, x + dir * rng.range(7, 12), ay + rng.range(-8, 8)]);
      }
    }
    const traceRunes = (c2, style, lw) => {
      c2.strokeStyle = style;
      c2.lineWidth = lw;
      c2.lineCap = 'round';
      c2.beginPath();
      for (const [x0, y0, x1, y1] of strokes) {
        c2.moveTo(x0, y0);
        c2.lineTo(x1, y1);
      }
      c2.stroke();
    };
    traceRunes(ctx, 'rgba(9,11,15,0.9)', 5);
    traceRunes(ctx, css(PAL.thunder, 0.34), 1.8);
    if (ectx) traceRunes(ectx, css(PAL.thunder, 0.4), 2.6);
    lights.push({ x: cx, y: baseY - H * 0.5, r: 150, color: PAL.thunder, i: 0.22, flicker: 0.25 });
  }, { radius: w * 0.26, solid: true, emissive: true });
}

function drawIceFloe(rng) {
  const S = rng.range(80, 150);
  const w = Math.ceil(S * 1.6);
  const h = Math.ceil(S * 0.9);
  return sprite(w, h, w / 2, h - 10, (ctx) => {
    const cx = w / 2;
    const cy = h - S * 0.34;
    ctx.save();
    organicPath(ctx, cx, cy, S * 0.7, S * 0.3, rng, 9, 0.22);
    const g = ctx.createLinearGradient(0, cy - S * 0.3, 0, cy + S * 0.3);
    g.addColorStop(0, css(hex('#dbe9f4')));
    g.addColorStop(0.55, css(hex('#9fb9cc')));
    g.addColorStop(1, css(hex('#54718a')));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = 'rgba(60,90,110,0.4)';
      ctx.lineWidth = rng.range(0.8, 2);
      ctx.beginPath();
      let x = cx + rng.range(-S * 0.5, S * 0.5);
      let y = cy + rng.range(-S * 0.2, S * 0.2);
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += rng.range(-S * 0.2, S * 0.2);
        y += rng.range(-S * 0.1, S * 0.1);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    applyRim(ctx, w, h, PAL.frost, 0.5, 2, 2.5);
  }, { radius: S * 0.4, solid: false });
}

function drawStump(rng) {
  const w = 100;
  const h = 80;
  return sprite(w, h, w / 2, h - 8, (ctx) => {
    const cx = w / 2;
    const baseY = h - 10;
    baseAO(ctx, cx, baseY, 36);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - 30, baseY);
    ctx.lineTo(cx - 26, baseY - 40);
    ctx.lineTo(cx + 26, baseY - 42);
    ctx.lineTo(cx + 30, baseY);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - 30, 0, cx + 30, 0);
    g.addColorStop(0, css(hex('#4a3826')));
    g.addColorStop(0.5, css(hex('#2f2417')));
    g.addColorStop(1, css(hex('#191309')));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    // Cut face with rings
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, baseY - 41, 28, 10, 0, 0, TAU);
    ctx.fillStyle = css(hex('#8a6a44'));
    ctx.fill();
    ctx.clip();
    for (let r = 26; r > 1; r -= 3.4) {
      ctx.strokeStyle = `rgba(60,42,24,${(0.2 + Math.random() * 0.3).toFixed(2)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(cx + rng.range(-1, 1), baseY - 41, r, r * 0.36, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    // Moss skirt
    ctx.fillStyle = 'rgba(52,72,36,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY - 4, 34, 9, 0, 0, TAU);
    ctx.fill();
  }, { radius: 24, solid: true });
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const PROP_DEFS = {
  pine: (rng) => drawPine(rng, {}),
  pineSnowy: (rng) => drawPine(rng, { snowy: true }),
  pineDead: (rng) => drawPine(rng, { dead: true }),
  birch: (rng) => drawBirch(rng),
  oak: (rng) => drawOak(rng, {}),
  oakSacred: (rng) => drawOak(rng, { sacred: true, h: 300 }),
  deadTree: (rng) => drawDeadTree(rng),
  rock: (rng) => drawRock(rng, {}),
  rockMossy: (rng) => drawRock(rng, { mossy: true }),
  rockAmber: (rng) => drawRock(rng, { amber: true }),
  ruinWall: (rng) => drawRuinWall(rng, {}),
  ruinWallTall: (rng) => drawRuinWall(rng, { w: 200, h: 240 }),
  brazier: (rng) => drawBrazier(rng),
  banner: (rng) => drawBanner(rng, { white: true }),
  bannerRed: (rng) => drawBanner(rng, { white: false }),
  wreck: (rng) => drawWreck(rng),
  idol: (rng) => drawIdol(rng, {}),
  idolLit: (rng) => drawIdol(rng, { lit: true }),
  reeds: (rng) => drawReeds(rng),
  grass: (rng) => drawGrassTuft(rng),
  bones: (rng) => drawBones(rng),
  crate: (rng) => drawCrate(rng),
  standingStone: (rng) => drawStandingStone(rng),
  iceFloe: (rng) => drawIceFloe(rng),
  stump: (rng) => drawStump(rng),
};

const VARIANTS = 6;
const propCache = new Map();

export function getProp(name, variant = 0) {
  const key = name + ':' + (variant % VARIANTS);
  let s = propCache.get(key);
  if (!s) {
    const def = PROP_DEFS[name];
    if (!def) throw new Error('Unknown prop ' + name);
    s = def(new RNG(name + '#' + (variant % VARIANTS)));
    propCache.set(key, s);
  }
  return s;
}

/** Pre-bakes a list of props so nothing hitches mid-fight. */
export function warmProps(names) {
  for (const n of names) for (let v = 0; v < VARIANTS; v++) getProp(n, v);
}

export const PROP_VARIANTS = VARIANTS;

// ---------------------------------------------------------------------------
// Zoom-resolved copies
// ---------------------------------------------------------------------------
//
// Props never change size during play, so resampling them every frame is pure
// waste. We keep one copy per variant already scaled to the current zoom and
// blit it 1:1 — which in software rasterisation is several times cheaper than
// a filtered scale, and free on a GPU.

const scaledCache = new Map();
let scaledZoom = -1;

export function getScaledProp(name, variant, zoom, flip = 0) {
  if (Math.abs(zoom - scaledZoom) > 0.015) {
    scaledCache.clear();
    scaledZoom = zoom;
  }
  const key = name + ':' + (variant % VARIANTS) + ':' + flip;
  let s = scaledCache.get(key);
  if (s) return s;
  const src = getProp(name, variant);
  const w = Math.max(1, Math.round(src.w * zoom));
  const h = Math.max(1, Math.round(src.h * zoom));
  const blit = (source) => {
    const c = makeCanvas(w, h);
    const cc = ctxOf(c);
    cc.imageSmoothingQuality = 'high';
    if (flip) {
      cc.translate(w, 0);
      cc.scale(-1, 1);
    }
    cc.drawImage(source, 0, 0, w, h);
    return c;
  };
  s = {
    canvas: blit(src.canvas),
    emissive: src.emissive ? blit(src.emissive) : null,
    ox: flip ? w - src.ox * zoom : src.ox * zoom,
    oy: src.oy * zoom,
    w,
    h,
    lights: src.lights,
    radius: src.radius,
    solid: src.solid,
    sway: src.sway,
  };
  scaledCache.set(key, s);
  return s;
}

export function clearScaledProps() {
  scaledCache.clear();
  scaledZoom = -1;
}
