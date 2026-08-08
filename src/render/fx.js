// Particles, floating numbers and one-shot visual flourishes.
// Everything lives in world space and is drawn through the renderer's
// transform, so sparks land on the ground where they should.

import { TAU, clamp01, lerp } from '../core/math.js';
import { css, mixc, PAL } from './palette.js';
import { rnd } from '../core/rng.js';
import { ISO_Y } from './renderer.js';

const MAX_PARTICLES = 900;

export class FX {
  constructor(renderer) {
    this.r = renderer;
    this.parts = [];
    this.texts = [];
    this.rings = [];
    this.beams = [];
    this.weather = [];
    this.weatherKind = null;
    this.weatherAmount = 0;
  }

  clear() {
    this.parts.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.beams.length = 0;
  }

  spawn(p) {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push(p);
  }

  // -- emitters -------------------------------------------------------------

  blood(x, y, z, dirX, dirY, amount = 12, color = PAL.blood) {
    for (let i = 0; i < amount; i++) {
      const a = Math.atan2(dirY, dirX) + rnd(-0.9, 0.9);
      const sp = rnd(60, 320);
      this.spawn({
        kind: 'blood',
        x,
        y,
        z: z + rnd(-6, 10),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6,
        vz: rnd(40, 210),
        life: rnd(0.4, 0.95),
        maxLife: 1,
        size: rnd(1.6, 4.4),
        color,
        grav: 620,
        drag: 1.6,
      });
    }
  }

  sparks(x, y, z, dirX, dirY, amount = 10, color = PAL.torchCore, speed = 300) {
    for (let i = 0; i < amount; i++) {
      const a = Math.atan2(dirY, dirX) + rnd(-1.1, 1.1);
      const sp = rnd(speed * 0.3, speed);
      this.spawn({
        kind: 'spark',
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6,
        vz: rnd(30, 190),
        life: rnd(0.18, 0.5),
        maxLife: 0.5,
        size: rnd(1.2, 2.8),
        color,
        grav: 420,
        drag: 2.4,
        glow: true,
      });
    }
  }

  embers(x, y, z, amount, color = PAL.torch, spread = 20) {
    for (let i = 0; i < amount; i++) {
      this.spawn({
        kind: 'ember',
        x: x + rnd(-spread, spread),
        y: y + rnd(-spread * 0.5, spread * 0.5),
        z: z + rnd(0, 10),
        vx: rnd(-14, 14),
        vy: rnd(-8, 8),
        vz: rnd(28, 74),
        life: rnd(0.7, 1.9),
        maxLife: 1.9,
        size: rnd(1.1, 2.6),
        color,
        grav: -12,
        drag: 0.7,
        glow: true,
        flick: true,
      });
    }
  }

  smoke(x, y, z, amount = 6, color = [70, 70, 78], spread = 12) {
    for (let i = 0; i < amount; i++) {
      this.spawn({
        kind: 'smoke',
        x: x + rnd(-spread, spread),
        y: y + rnd(-spread * 0.6, spread * 0.6),
        z: z + rnd(0, 8),
        vx: rnd(-16, 16),
        vy: rnd(-10, 10),
        vz: rnd(18, 46),
        life: rnd(0.8, 1.8),
        maxLife: 1.8,
        size: rnd(9, 22),
        grow: rnd(14, 32),
        color,
        grav: -6,
        drag: 1.1,
        alpha: 0.4,
      });
    }
  }

  dust(x, y, amount = 8) {
    for (let i = 0; i < amount; i++) {
      const a = rnd(0, TAU);
      const sp = rnd(30, 130);
      this.spawn({
        kind: 'smoke',
        x,
        y,
        z: rnd(0, 6),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6,
        vz: rnd(6, 30),
        life: rnd(0.35, 0.8),
        maxLife: 0.8,
        size: rnd(6, 14),
        grow: rnd(10, 22),
        color: [96, 92, 84],
        grav: -4,
        drag: 3.2,
        alpha: 0.3,
      });
    }
  }

  shards(x, y, z, amount, color, speed = 260) {
    for (let i = 0; i < amount; i++) {
      const a = rnd(0, TAU);
      const sp = rnd(speed * 0.4, speed);
      this.spawn({
        kind: 'shard',
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6,
        vz: rnd(60, 240),
        life: rnd(0.4, 1.0),
        maxLife: 1,
        size: rnd(2.4, 6),
        rot: rnd(0, TAU),
        spin: rnd(-12, 12),
        color,
        grav: 560,
        drag: 1.2,
        glow: true,
      });
    }
  }

  ring(x, y, opts = {}) {
    this.rings.push({
      x,
      y,
      r: opts.r0 ?? 8,
      r1: opts.r1 ?? 120,
      life: opts.life ?? 0.45,
      age: 0,
      color: opts.color || PAL.torchCore,
      width: opts.width ?? 5,
      glow: opts.glow ?? true,
      fill: opts.fill ?? false,
    });
  }

  beam(x0, y0, x1, y1, opts = {}) {
    this.beams.push({
      x0,
      y0,
      x1,
      y1,
      z0: opts.z0 ?? 0,
      z1: opts.z1 ?? 0,
      life: opts.life ?? 0.22,
      age: 0,
      color: opts.color || PAL.thunder,
      width: opts.width ?? 6,
      jagged: opts.jagged ?? false,
    });
  }

  /**
   * Damage on a target merges into the number already floating above it, so a
   * whirlwind reads as one rising total instead of a column of digits.
   */
  damage(owner, x, y, z, amount, opts = {}) {
    for (const t of this.texts) {
      if (t.owner === owner && t.age < 0.42) {
        t.value += amount;
        t.str = Math.round(t.value).toString();
        t.age = Math.min(t.age, 0.1);
        t.size = Math.min(t.baseSize * 1.5, t.size + 1.4);
        if (opts.crit) {
          t.crit = true;
          t.color = opts.color || t.color;
        }
        return;
      }
    }
    const size = opts.size ?? 15;
    this.texts.push({
      owner,
      value: amount,
      baseSize: size,
      x,
      y,
      z,
      str: Math.round(amount).toString(),
      life: opts.life ?? 0.95,
      age: 0,
      color: opts.color || [240, 236, 226],
      size,
      vx: rnd(-18, 18),
      vz: rnd(70, 110),
      crit: opts.crit || false,
      bold: false,
    });
    if (this.texts.length > 40) this.texts.shift();
  }

  text(x, y, z, str, opts = {}) {
    this.texts.push({
      x,
      y,
      z,
      str,
      life: opts.life ?? 0.95,
      age: 0,
      color: opts.color || [240, 236, 226],
      size: opts.size ?? 15,
      vx: opts.vx ?? rnd(-24, 24),
      vz: opts.vz ?? rnd(70, 110),
      crit: opts.crit || false,
      bold: opts.bold || false,
      levelUp: opts.levelUp || false,
    });
    if (this.texts.length > 60) this.texts.shift();
  }

  // -- weather --------------------------------------------------------------

  setWeather(kind, amount) {
    this.weatherKind = kind;
    this.weatherAmount = amount;
    this.weather.length = 0;
    const n = Math.round(amount * (kind === 'mist' ? 26 : 150));
    for (let i = 0; i < n; i++) {
      this.weather.push({
        x: Math.random(),
        y: Math.random(),
        z: Math.random(),
        s: Math.random(),
        p: Math.random() * TAU,
      });
    }
  }

  // -- update ---------------------------------------------------------------

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-(p.drag || 0) * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.vz -= (p.grav || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.28;
        p.vx *= 0.5;
        p.vy *= 0.5;
        if (p.kind === 'blood' && p.life > 0.15) p.life = Math.min(p.life, 0.18);
      }
      if (p.grow) p.size += p.grow * dt;
      if (p.spin) p.rot += p.spin * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age > r.life) this.rings.splice(i, 1);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.age += dt;
      if (b.age > b.life) this.beams.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.age += dt;
      if (t.age > t.life) {
        this.texts.splice(i, 1);
        continue;
      }
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      t.vz -= 130 * dt;
    }
  }

  // -- draw -----------------------------------------------------------------

  draw(dt) {
    const R = this.r;
    const ctx = R.ctx;
    const zoom = R.cam.zoom * R.pxScale;

    // Ground rings first — they belong to the floor.
    for (const r of this.rings) {
      const k = clamp01(r.age / r.life);
      const rad = lerp(r.r, r.r1, 1 - Math.pow(1 - k, 2.4));
      const alpha = (1 - k) * (1 - k);
      const sx = R.sx(r.x);
      const sy = R.sy(r.y);
      ctx.save();
      if (r.glow) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = css(r.color);
      ctx.lineWidth = r.width * zoom * (1 - k * 0.5);
      ctx.beginPath();
      ctx.ellipse(sx, sy, rad * zoom, rad * zoom * ISO_Y, 0, 0, TAU);
      ctx.stroke();
      if (r.fill) {
        ctx.globalAlpha = alpha * 0.22;
        ctx.fillStyle = css(r.color);
        ctx.fill();
      }
      ctx.restore();
      if (r.glow) R.emisCircle(r.x, r.y, rad * 0.6, r.color, alpha * 0.35);
    }

    // Particles
    let additive = false;
    ctx.save();
    for (const p of this.parts) {
      const sx = R.sx(p.x);
      const sy = R.sy(p.y, p.z);
      if (sx < -60 || sy < -60 || sx > R.w + 60 || sy > R.h + 60) continue;
      const t = clamp01(p.life / p.maxLife);
      const want = !!p.glow;
      if (want !== additive) {
        ctx.globalCompositeOperation = want ? 'lighter' : 'source-over';
        additive = want;
      }
      const size = p.size * zoom;
      if (p.kind === 'spark' || p.kind === 'ember') {
        const fl = p.flick ? 0.6 + 0.4 * Math.sin(p.life * 30) : 1;
        ctx.globalAlpha = t * fl;
        const c = mixc(p.color, [255, 250, 230], 1 - t);
        ctx.fillStyle = css(c);
        // Stretch along velocity so fast sparks streak.
        const vlen = Math.hypot(p.vx, p.vy * ISO_Y - p.vz) * 0.012 * zoom;
        ctx.beginPath();
        ctx.ellipse(
          sx,
          sy,
          Math.max(size * 0.5, vlen),
          size * 0.5,
          Math.atan2(p.vy * ISO_Y - p.vz, p.vx),
          0,
          TAU
        );
        ctx.fill();
      } else if (p.kind === 'blood') {
        ctx.globalAlpha = Math.min(1, t * 1.6);
        ctx.fillStyle = css(p.color);
        ctx.beginPath();
        ctx.ellipse(sx, sy, size, size * 0.72, 0, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'smoke') {
        ctx.globalAlpha = (p.alpha ?? 0.4) * t * t;
        ctx.drawImage(R.softDot(p.color), sx - size, sy - size, size * 2, size * 2);
      } else if (p.kind === 'shard') {
        ctx.globalAlpha = t;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.rot);
        ctx.fillStyle = css(mixc(p.color, [255, 255, 255], (1 - t) * 0.4));
        ctx.beginPath();
        ctx.moveTo(-size, 0);
        ctx.lineTo(0, -size * 0.42);
        ctx.lineTo(size, 0);
        ctx.lineTo(0, size * 0.42);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      if (p.glow && size > 1.4) R.emisCircle(p.x, p.y, p.size * 1.7, p.color, t * 0.5, p.z);
    }
    ctx.restore();

    // Beams (lightning, arrows in flight, chain links)
    for (const b of this.beams) {
      const k = clamp01(b.age / b.life);
      const alpha = 1 - k;
      const x0 = R.sx(b.x0);
      const y0 = R.sy(b.y0, b.z0);
      const x1 = R.sx(b.x1);
      const y1 = R.sy(b.y1, b.z1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';
      ctx.strokeStyle = css(b.color);
      ctx.lineWidth = b.width * zoom * (1 - k * 0.4);
      ctx.beginPath();
      if (b.jagged) {
        const segs = 8;
        ctx.moveTo(x0, y0);
        for (let i = 1; i < segs; i++) {
          const t = i / segs;
          const nx = -(y1 - y0);
          const ny = x1 - x0;
          const l = Math.hypot(nx, ny) || 1;
          const off = (Math.random() - 0.5) * 26 * zoom * Math.sin(t * Math.PI);
          ctx.lineTo(lerp(x0, x1, t) + (nx / l) * off, lerp(y0, y1, t) + (ny / l) * off);
        }
        ctx.lineTo(x1, y1);
      } else {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
      ctx.lineWidth = Math.max(1, b.width * zoom * 0.35);
      ctx.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(2) + ')';
      ctx.stroke();
      ctx.restore();
      R.emisCircle((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 40, b.color, alpha * 0.4, (b.z0 + b.z1) / 2);
    }
  }

  /** Numbers and shout text, drawn last so nothing hides them. */
  drawText() {
    const R = this.r;
    const ctx = R.ctx;
    const zoom = R.cam.zoom * R.pxScale;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = clamp01(t.age / t.life);
      const alpha = k < 0.12 ? k / 0.12 : 1 - Math.pow((k - 0.12) / 0.88, 2.2);
      const sx = R.sx(t.x);
      const sy = R.sy(t.y, t.z);
      const pop = t.crit ? 1 + Math.max(0, 0.5 - k * 3) : 1;
      const size = t.size * zoom * pop;
      ctx.globalAlpha = alpha;
      ctx.font = `${t.crit || t.bold ? '900' : '700'} ${size.toFixed(1)}px "Trebuchet MS", system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, size * 0.22);
      ctx.strokeStyle = 'rgba(6,6,10,0.85)';
      ctx.strokeText(t.str, sx, sy);
      ctx.fillStyle = css(t.color);
      ctx.fillText(t.str, sx, sy);
    }
    ctx.restore();
  }

  /** Snow, drifting leaves, ash or rain, drawn in screen space with parallax. */
  drawWeather(dt) {
    if (!this.weatherKind || !this.weather.length) return;
    const R = this.r;
    const ctx = R.ctx;
    const t = R.time;
    const W = R.w;
    const H = R.h;
    const camX = R.cam.x;
    const camY = R.cam.y;
    ctx.save();
    const kind = this.weatherKind;

    if (kind === 'mist') {
      ctx.globalCompositeOperation = 'source-over';
      for (const p of this.weather) {
        const depth = 0.3 + p.z * 0.7;
        const x = ((p.x * W * 1.6 - camX * depth * 0.35 + t * 12 * depth) % (W * 1.6)) - W * 0.3;
        const y = ((p.y * H * 1.4 - camY * depth * 0.2) % (H * 1.4)) - H * 0.2;
        const r = (60 + p.s * 130) * depth;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(150,178,186,${(0.05 + p.s * 0.05) * this.weatherAmount})`);
        g.addColorStop(1, 'rgba(150,178,186,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.restore();
      return;
    }

    for (const p of this.weather) {
      const depth = 0.35 + p.z * 0.65;
      let x;
      let y;
      let size;
      let alpha;
      let col;
      if (kind === 'snow') {
        const drift = Math.sin(t * 1.4 + p.p) * 26 * depth;
        x = mod(p.x * W - camX * depth * 0.6 + drift + t * 24 * depth, W + 80) - 40;
        y = mod(p.y * H + t * (70 + p.s * 90) * depth - camY * depth * 0.4, H + 80) - 40;
        size = (1.1 + p.s * 2.4) * depth * R.pxScale;
        alpha = (0.35 + p.s * 0.55) * depth;
        col = '234,244,255';
      } else if (kind === 'ash') {
        const drift = Math.sin(t * 0.9 + p.p) * 34 * depth;
        x = mod(p.x * W - camX * depth * 0.6 + drift + t * 34 * depth, W + 80) - 40;
        y = mod(p.y * H + t * (34 + p.s * 54) * depth - camY * depth * 0.4, H + 80) - 40;
        size = (0.9 + p.s * 2) * depth * R.pxScale;
        alpha = (0.25 + p.s * 0.45) * depth;
        col = p.s > 0.86 ? '255,168,92' : '128,124,118';
      } else if (kind === 'leaves') {
        const drift = Math.sin(t * 1.1 + p.p) * 60 * depth;
        x = mod(p.x * W - camX * depth * 0.6 + drift + t * 46 * depth, W + 80) - 40;
        y = mod(p.y * H + t * (52 + p.s * 66) * depth - camY * depth * 0.4, H + 80) - 40;
        size = (1.6 + p.s * 3.2) * depth * R.pxScale;
        alpha = (0.3 + p.s * 0.4) * depth;
        col = p.s > 0.6 ? '150,124,54' : '86,96,48';
      } else {
        // storm — hard slanted rain
        x = mod(p.x * W - camX * depth * 0.6 + t * 200 * depth, W + 80) - 40;
        y = mod(p.y * H + t * (900 + p.s * 500) * depth - camY * depth * 0.4, H + 80) - 40;
        size = (1 + p.s * 1.4) * depth * R.pxScale;
        alpha = (0.18 + p.s * 0.3) * depth;
        col = '176,196,224';
      }
      ctx.globalAlpha = alpha * this.weatherAmount;
      ctx.fillStyle = `rgb(${col})`;
      if (kind === 'storm') {
        ctx.fillRect(x, y, size * 0.7, size * 16);
      } else if (kind === 'leaves') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 2 + p.p);
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size * 0.5, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function mod(a, b) {
  return ((a % b) + b) % b;
}
