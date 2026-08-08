// Zone generation. Each act is a bounded region with a wandering road, a
// handful of clearings, camps of monsters, a shrine or two, and a boss arena
// at the far end. Everything derives from the act seed so a run is repeatable.

import { RNG } from '../core/rng.js';
import { warpFbm, fbm } from '../render/noise.js';
import { clamp01, dist, TAU, lerp, smoothstep } from '../core/math.js';
import { getProp, PROP_VARIANTS } from '../render/props.js';

export class Zone {
  constructor(act, actIndex, seed) {
    this.act = act;
    this.actIndex = actIndex;
    this.seed = seed;
    this.rng = new RNG(seed);
    this.size = act.size;
    this.half = act.size / 2;
    this.props = [];
    this.spawnPoints = [];
    this.camps = [];
    this.shrines = [];
    this.chests = [];
    this.lights = [];
    this.start = { x: 0, y: 0 };
    this.bossArena = { x: 0, y: 0, r: 460 };
    this.portal = null;
    this.generate();
  }

  inBounds(x, y) {
    return Math.abs(x) < this.half - 60 && Math.abs(y) < this.half - 60;
  }

  /** Distance from the walkable road network — used to keep paths clear. */
  roadDist(x, y) {
    let best = Infinity;
    for (let i = 1; i < this.road.length; i++) {
      const a = this.road[i - 1];
      const b = this.road[i];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const l2 = abx * abx + aby * aby || 1;
      const t = clamp01(((x - a.x) * abx + (y - a.y) * aby) / l2);
      const d = Math.hypot(x - (a.x + abx * t), y - (a.y + aby * t));
      if (d < best) best = d;
    }
    return best;
  }

  generate() {
    const rng = this.rng;
    const S = this.size;
    const H = this.half;

    // --- the road: a wandering spine from the south edge to the boss ------
    this.start = { x: rng.range(-H * 0.3, H * 0.3), y: H - 320 };
    const end = { x: rng.range(-H * 0.35, H * 0.35), y: -H + 420 };
    this.bossArena = { x: end.x, y: end.y, r: 430 };

    const road = [{ ...this.start }];
    const steps = 9;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const wob = Math.sin(t * 5.3 + rng.float() * 3) * H * 0.36 * (1 - Math.abs(t - 0.5));
      road.push({
        x: lerp(this.start.x, end.x, t) + wob + rng.range(-90, 90),
        y: lerp(this.start.y, end.y, t) + rng.range(-70, 70),
      });
    }
    road[road.length - 1] = { ...end };
    this.road = road;

    // --- scatter props ----------------------------------------------------
    const props = this.act.props;
    const totalW = props.reduce((a, p) => a + p.w, 0);
    // Density is driven by a big noise field so the zone has thickets and
    // open ground instead of an even sprinkle.
    // Density is deliberately sparse: a wall of trees both hides the fight and
    // eats the frame budget in overdraw.
    const target = Math.round((S * S) / 12000);
    let attempts = 0;
    const placed = [];
    while (placed.length < target && attempts < target * 8) {
      attempts++;
      const x = rng.range(-H + 40, H - 40);
      const y = rng.range(-H + 40, H - 40);
      const density = clamp01(warpFbm(x * 0.0011, y * 0.0011, 1.7, 4) * 0.9 + 0.5);
      if (rng.float() > Math.pow(density, 3.2) * 1.9) continue;

      const rd = this.roadDist(x, y);
      if (rd < 105) continue;
      if (dist(x, y, this.bossArena.x, this.bossArena.y) < this.bossArena.r + 40) continue;
      if (dist(x, y, this.start.x, this.start.y) < 240) continue;

      let pick = null;
      let r = rng.float() * totalW;
      for (const p of props) {
        r -= p.w;
        if (r <= 0) {
          pick = p;
          break;
        }
      }
      if (!pick) pick = props[0];
      const variant = rng.int(0, PROP_VARIANTS - 1);
      const spr = getProp(pick.name, variant);
      const scale = 1;

      // Keep props from stacking: solids get their full radius, everything
      // else just a minimum breathing distance.
      let clash = false;
      const myR = spr.radius * scale;
      for (const q of placed) {
        const need = spr.solid && q.solid ? (myR + q.r) * 0.9 : 46;
        if (Math.abs(q.y - y) > need) continue;
        if (dist(x, y, q.x, q.y) < need) {
          clash = true;
          break;
        }
      }
      if (clash) continue;

      placed.push({
        name: pick.name,
        variant,
        x,
        y,
        scale,
        r: spr.radius * scale,
        solid: spr.solid,
        sway: spr.sway * rng.range(0.6, 1.4),
        phase: rng.float() * TAU,
        flip: rng.bool() ? 1 : 0,
      });
    }
    this.props = placed;

    // --- landmarks along the road ----------------------------------------
    const lm = this.act.landmarks || [];
    for (let i = 1; i < road.length - 1; i++) {
      if (!rng.bool(0.55) || !lm.length) continue;
      const a = road[i];
      const ang = rng.float() * TAU;
      const d = rng.range(130, 200);
      const name = rng.pick(lm);
      const variant = rng.int(0, PROP_VARIANTS - 1);
      const spr = getProp(name, variant);
      this.props.push({
        name,
        variant,
        x: a.x + Math.cos(ang) * d,
        y: a.y + Math.sin(ang) * d,
        scale: 1,
        r: spr.radius,
        solid: spr.solid,
        sway: 0,
        phase: 0,
        landmark: true,
      });
    }

    // Props that carry their own light source.
    for (const p of this.props) {
      const spr = getProp(p.name, p.variant);
      if (spr.lights && spr.lights.length) {
        for (const L of spr.lights) {
          this.lights.push({
            x: p.x + (L.x - spr.ox) * p.scale,
            y: p.y - 6,
            z: (spr.oy - L.y) * p.scale,
            r: L.r * p.scale,
            color: L.color,
            i: L.i,
            flicker: L.flicker || 0,
            phase: rng.float() * TAU,
          });
        }
      }
    }

    // --- camps ------------------------------------------------------------
    const campCount = 6 + this.actIndex;
    for (let i = 0; i < campCount; i++) {
      const t = (i + 0.6) / campCount;
      const idx = Math.min(road.length - 2, Math.floor(t * (road.length - 1)));
      const a = road[idx];
      const ang = rng.float() * TAU;
      const d = rng.range(120, 330);
      const x = a.x + Math.cos(ang) * d;
      const y = a.y + Math.sin(ang) * d;
      if (!this.inBounds(x, y)) continue;
      if (dist(x, y, this.bossArena.x, this.bossArena.y) < this.bossArena.r + 120) continue;
      this.camps.push({
        x,
        y,
        r: rng.range(150, 230),
        count: rng.int(3, 6),
        elite: rng.bool(0.34),
        triggered: false,
      });
    }

    // --- shrines and chests ----------------------------------------------
    for (let i = 0; i < 3 + this.actIndex; i++) {
      const idx = rng.int(1, road.length - 2);
      const a = road[idx];
      const ang = rng.float() * TAU;
      const d = rng.range(170, 380);
      const x = a.x + Math.cos(ang) * d;
      const y = a.y + Math.sin(ang) * d;
      if (!this.inBounds(x, y)) continue;
      if (rng.bool(0.45)) {
        this.shrines.push({ x, y, used: false, kind: rng.pick(['might', 'haste', 'ward', 'heal']) });
      } else {
        this.chests.push({ x, y, opened: false });
      }
    }

    // Boss arena: ring it with landmarks so it reads as a place.
    const ringName = this.act.landmarks[this.act.landmarks.length - 1];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 0.2;
      const x = this.bossArena.x + Math.cos(a) * this.bossArena.r * 0.92;
      const y = this.bossArena.y + Math.sin(a) * this.bossArena.r * 0.92 * 0.9;
      if (!this.inBounds(x, y)) continue;
      const variant = rng.int(0, PROP_VARIANTS - 1);
      const spr = getProp(ringName, variant);
      this.props.push({
        name: ringName,
        variant,
        x,
        y,
        scale: 1.05,
        r: spr.radius,
        solid: spr.solid,
        sway: 0,
        phase: 0,
      });
      if (spr.lights) {
        for (const L of spr.lights) {
          this.lights.push({
            x: x + (L.x - spr.ox),
            y: y - 6,
            z: spr.oy - L.y,
            r: L.r,
            color: L.color,
            i: L.i,
            flicker: L.flicker || 0,
            phase: rng.float() * TAU,
          });
        }
      }
    }

    // Sort for painter's algorithm; props never move so once is enough.
    this.props.sort((a, b) => a.y - b.y);
  }

  /** Free-roaming spawn position at least `minDist` from the player. */
  randomSpawn(rng, px, py, minDist = 620, maxTries = 40) {
    for (let i = 0; i < maxTries; i++) {
      const a = rng.float() * TAU;
      const d = rng.range(minDist, minDist + 520);
      const x = px + Math.cos(a) * d;
      const y = py + Math.sin(a) * d;
      if (!this.inBounds(x, y)) continue;
      if (dist(x, y, this.bossArena.x, this.bossArena.y) < this.bossArena.r) continue;
      if (this.blocked(x, y, 26)) continue;
      return { x, y };
    }
    return null;
  }

  blocked(x, y, r) {
    for (const p of this.props) {
      if (!p.solid) continue;
      if (Math.abs(p.y - y) > 260) continue;
      if (dist(x, y, p.x, p.y) < p.r + r) return true;
    }
    return false;
  }

  /** Pushes a circle out of any solid prop it overlaps. Returns [x, y]. */
  resolve(x, y, r) {
    for (let pass = 0; pass < 2; pass++) {
      for (const p of this.props) {
        if (!p.solid) continue;
        if (Math.abs(p.y - y) > 300) continue;
        const dx = x - p.x;
        const dy = y - p.y;
        const rr = p.r + r;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          x = p.x + (dx / d) * rr;
          y = p.y + (dy / d) * rr;
        }
      }
    }
    const H = this.half - 40;
    if (x < -H) x = -H;
    if (x > H) x = H;
    if (y < -H) y = -H;
    if (y > H) y = H;
    return [x, y];
  }
}
