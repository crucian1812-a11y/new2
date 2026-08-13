// The interface. Everything is drawn on the same canvas as the game so the
// frame is one picture — no DOM overlays fighting the art direction.

import { clamp01, TAU, fmtNum } from '../core/math.js';
import { css, mixc, hex, PAL } from '../render/palette.js';
import { CLASSES, SKILLS, SLOTS, xpForLevel, MAX_LEVEL } from '../game/content.js';
import { formatStat, damageRange, itemScore } from '../game/loot.js';
import { drawItemIcon } from '../render/icons.js';
import { audio } from '../core/audio.js';
import { renderActor } from '../render/actors.js';

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

/** Two-line deterministic RNG, just for laying out the title screen. */
class RNGLite {
  constructor(seed) {
    this.s = seed >>> 0;
  }
  f() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** Slot captions short enough to sit under a 46px cell. */
const SHORT_SLOT = {
  weapon: 'Waffe',
  offhand: 'Neben',
  head: 'Kopf',
  chest: 'Brust',
  hands: 'Hände',
  feet: 'Füße',
  ring: 'Ring',
  amulet: 'Amulett',
};

export class HUD {
  constructor(game, renderer, input) {
    this.game = game;
    this.r = renderer;
    this.input = input;
    this.panel = null; // null | 'bag' | 'menu' | 'skills'
    this.selected = null;
    this.buttons = [];
    this.scroll = 0;
    this.menuIndex = 0;
    this.pulse = 0;
    this.bagTab = 0;
    this.newItems = 0;
  }

  // -- helpers --------------------------------------------------------------

  get W() {
    return this.r.cssW;
  }
  get H() {
    return this.r.cssH;
  }
  /** CSS pixels -> screen backing-store pixels. The HUD draws on the sharp
   *  screen surface, not the chunky world buffer, so this is just the DPR. */
  get k() {
    return this.r.dpr;
  }

  btn(id, x, y, r, opts = {}) {
    this.buttons.push({ id, x, y, r, ...opts });
    return this.buttons[this.buttons.length - 1];
  }

  rect(id, x, y, w, h) {
    // Rect buttons are registered as a circle that covers them, plus an
    // explicit bounds check when consumed.
    this.buttons.push({ id, x: x + w / 2, y: y + h / 2, r: Math.max(w, h) / 2, box: { x, y, w, h }, pad: 1 });
  }

  hitRect(id) {
    return this.input.wasPressed(id);
  }

  // -- primitives -----------------------------------------------------------

  rr(ctx, x, y, w, h, r) {
    const k = this.k;
    ctx.beginPath();
    ctx.roundRect(x * k, y * k, w * k, h * k, r * k);
  }

  panelBg(ctx, x, y, w, h, opts = {}) {
    const k = this.k;
    ctx.save();
    this.rr(ctx, x, y, w, h, opts.radius ?? 10);
    const g = ctx.createLinearGradient(0, y * k, 0, (y + h) * k);
    g.addColorStop(0, 'rgba(20,21,26,0.96)');
    g.addColorStop(1, 'rgba(11,12,16,0.97)');
    ctx.fillStyle = opts.fill || g;
    ctx.fill();
    ctx.strokeStyle = opts.border || 'rgba(150,132,92,0.42)';
    ctx.lineWidth = 1.4 * k;
    ctx.stroke();
    // Inner hairline, the thing that makes UI feel machined rather than flat.
    this.rr(ctx, x + 2.5, y + 2.5, w - 5, h - 5, (opts.radius ?? 10) - 2);
    ctx.strokeStyle = 'rgba(255,240,210,0.06)';
    ctx.lineWidth = 1 * k;
    ctx.stroke();
    ctx.restore();
  }

  text(ctx, str, x, y, opts = {}) {
    const k = this.k;
    ctx.save();
    ctx.font = `${opts.weight || 600} ${(opts.size || 12) * k}px ${opts.serif ? SERIF : FONT}`;
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = opts.baseline || 'alphabetic';
    if (opts.stroke !== false) {
      ctx.lineWidth = (opts.strokeW || 3) * k;
      ctx.strokeStyle = opts.strokeColor || 'rgba(6,6,10,0.8)';
      ctx.lineJoin = 'round';
      ctx.strokeText(str, x * k, y * k);
    }
    ctx.fillStyle = opts.color ? css(opts.color) : '#e8e2d4';
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    ctx.fillText(str, x * k, y * k);
    ctx.restore();
  }

  measure(ctx, str, size, weight = 600) {
    ctx.save();
    ctx.font = `${weight} ${size * this.k}px ${FONT}`;
    const w = ctx.measureText(str).width / this.k;
    ctx.restore();
    return w;
  }

  // =========================================================================
  // Main draw
  // =========================================================================

  draw(dt) {
    const ctx = this.r.screenCtx;
    this.pulse += dt;
    this.buttons.length = 0;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const g = this.game;
    if (g.state === 'menu') {
      this.drawMenu(ctx);
    } else {
      this.drawLowHealth(ctx);
      this.drawStick(ctx);
      this.drawTopLeft(ctx);
      this.drawTopRight(ctx);
      this.drawSkillBar(ctx);
      this.drawBossBar(ctx);
      this.drawWaypoint(ctx);
      this.drawFirstHints(ctx, dt);
      this.drawMessages(ctx);
      if (this.panel === 'bag') this.drawBag(ctx);
      else if (this.panel === 'menu') this.drawPauseMenu(ctx);
      if (g.state === 'dead') this.drawDeath(ctx);
      if (g.state === 'victory') this.drawVictory(ctx);
    }

    ctx.restore();
    this.input.setButtons(this.buttons);
  }

  /**
   * The two things a new player needs, shown once at the start of a run and
   * dismissed the moment they demonstrate they already know.
   */
  drawFirstHints(ctx, dt) {
    const g = this.game;
    if (g.actIndex !== 0 || g.player.totalKills > 2) return;
    if (this.hintsDone) return;
    this.hintT = (this.hintT || 0) + dt;
    if (this.hintT > 14) {
      this.hintsDone = true;
      return;
    }
    const moved = this.input.move.mag > 0.2;
    if (moved) this.hintMoved = true;
    const fade = this.hintT < 1 ? this.hintT : this.hintT > 12 ? (14 - this.hintT) / 2 : 1;

    if (!this.hintMoved) {
      const x = this.W * 0.22;
      const y = this.H * 0.72;
      const pulse = 0.6 + 0.4 * Math.sin(this.pulse * 2.6);
      ctx.save();
      ctx.globalAlpha = fade * pulse * 0.8;
      ctx.strokeStyle = 'rgba(226,220,200,0.9)';
      ctx.lineWidth = 2 * this.k;
      ctx.setLineDash([6 * this.k, 6 * this.k]);
      ctx.beginPath();
      ctx.arc(x * this.k, y * this.k, 46 * this.k, 0, TAU);
      ctx.stroke();
      ctx.restore();
      this.text(ctx, 'Ziehen zum Gehen', x, y + 66, {
        size: 11,
        align: 'center',
        color: [222, 214, 194],
        alpha: fade,
      });
    }
    const lay = this.skillLayout();
    this.text(ctx, 'Angreifen', lay.primary.x, lay.primary.y - lay.primary.r - 8, {
      size: 10,
      align: 'center',
      color: [222, 214, 194],
      alpha: fade * 0.9,
    });
  }

  /** Blood at the edges of vision below a third health — the oldest tell there is. */
  drawLowHealth(ctx) {
    const g = this.game;
    if (!g.player || !g.player.alive) return;
    const frac = g.player.hp / g.stats.maxLife;
    if (frac > 0.34) return;
    const t = clamp01((0.34 - frac) / 0.34);
    const pulse = 0.55 + 0.45 * Math.sin(this.pulse * (3.4 + t * 3.6));
    const w = this.r.sw;
    const h = this.r.sh;
    ctx.save();
    ctx.globalAlpha = t * pulse * 0.72;
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.24, w * 0.5, h * 0.5, w * 0.72);
    grad.addColorStop(0, 'rgba(120,10,10,0)');
    grad.addColorStop(0.65, 'rgba(120,10,10,0.22)');
    grad.addColorStop(1, 'rgba(92,4,6,0.85)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // -- the stick ------------------------------------------------------------

  drawStick(ctx) {
    const st = this.input.stick;
    if (!st.active) return;
    const k = this.k;
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = 'rgba(226,220,200,0.9)';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.arc(st.ox * k, st.oy * k, this.input.stickRadius * k, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(232,226,206,0.55)';
    ctx.beginPath();
    ctx.arc(
      (st.ox + st.x * this.input.stickRadius) * k,
      (st.oy + st.y * this.input.stickRadius) * k,
      22 * k,
      0,
      TAU
    );
    ctx.fill();
    ctx.restore();
  }

  // -- top left: portrait, life, resource, xp -------------------------------

  drawTopLeft(ctx) {
    const g = this.game;
    const p = g.player;
    const s = g.stats;
    const k = this.k;
    const x = 10;
    const y = 8;
    const barW = Math.min(210, this.W * 0.30);
    const R = 25;

    // Portrait medallion
    ctx.save();
    ctx.beginPath();
    ctx.arc((x + R) * k, (y + R) * k, R * k, 0, TAU);
    const pg = ctx.createRadialGradient((x + R * 0.6) * k, (y + R * 0.5) * k, 2, (x + R) * k, (y + R) * k, R * k);
    pg.addColorStop(0, 'rgba(58,60,70,1)');
    pg.addColorStop(1, 'rgba(16,17,21,1)');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // The medallion shows the actual rig, turned to face the player, so the
    // portrait always matches the gear that is equipped.
    renderActor(
      ctx,
      p.look,
      {
        t: this.pulse,
        anim: p.alive ? 'idle' : 'die',
        animT: p.alive ? 0 : 1,
        facing: Math.PI / 2,
        speed: 0,
        phase: 0,
        flash: 0,
        alpha: 1,
      },
      // Positioned so the medallion frames a head-and-shoulders bust: the
      // feet sit well below the disc and the clip does the cropping.
      (x + R) * k,
      (y + R * 5.0) * k,
      R * 0.046 * k,
      null
    );
    // Vignette inside the medallion so the figure sits in it.
    const vg = ctx.createRadialGradient((x + R) * k, (y + R) * k, R * 0.35 * k, (x + R) * k, (y + R) * k, R * k);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(6,7,10,0.8)');
    ctx.fillStyle = vg;
    ctx.fillRect((x - 2) * k, (y - 2) * k, (R * 2 + 4) * k, (R * 2 + 4) * k);
    ctx.restore();
    ctx.strokeStyle = 'rgba(176,152,102,0.8)';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.arc((x + R) * k, (y + R) * k, R * k, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // Level badge
    this.text(ctx, String(p.level), x + R, y + R * 2 + 9, {
      size: 11,
      align: 'center',
      color: hex('#e6d3a0'),
      weight: 800,
    });

    const bx = x + R * 2 + 8;
    // Life bar
    const lifeFrac = clamp01(p.hp / s.maxLife);
    this.bar(ctx, bx, y + 5, barW, 13, lifeFrac, [hex('#c0281f'), hex('#6b1210')], {
      label: `${Math.ceil(p.hp)} / ${s.maxLife}`,
      glow: lifeFrac < 0.3,
    });
    // Resource bar
    const resFrac = clamp01(p.resource / s.maxResource);
    const rc = g.cls.resource.color;
    this.bar(ctx, bx, y + 21, barW * 0.86, 9, resFrac, [rc, mixc(rc, [0, 0, 0], 0.55)], {
      small: true,
    });
    // XP bar
    const need = xpForLevel(p.level);
    const xpFrac = p.level >= MAX_LEVEL ? 1 : clamp01(p.xp / need);
    this.bar(ctx, bx, y + 33, barW * 0.86, 4, xpFrac, [hex('#c8a94a'), hex('#7a6420')], { small: true });

    // Act + quota
    const questY = y + 50;
    this.text(ctx, g.act.name, x + 2, questY, { size: 11, color: hex('#cbbf9c'), serif: true });
    if (!g.bossSpawned) {
      const left = Math.max(0, g.killQuota - g.kills);
      this.text(
        ctx,
        left > 0 ? `Feinde bis zum Wächter: ${left}` : 'Der Weg zum Wächter ist frei',
        x + 2,
        questY + 14,
        { size: 10, color: left > 0 ? hex('#9aa0aa') : hex('#e0c070') }
      );
    } else if (g.portal) {
      this.text(ctx, 'Betritt das Tor', x + 2, questY + 14, { size: 10, color: hex('#8fe0c0') });
    }
    // Gold
    this.text(ctx, `⬤ ${fmtNum(p.gold)}`, x + 2, questY + 28, { size: 10, color: PAL.gold });
  }

  bar(ctx, x, y, w, h, frac, colors, opts = {}) {
    const k = this.k;
    ctx.save();
    this.rr(ctx, x, y, w, h, h * 0.45);
    ctx.fillStyle = 'rgba(8,9,12,0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.2 * k;
    ctx.stroke();
    if (frac > 0.001) {
      ctx.save();
      this.rr(ctx, x + 1, y + 1, Math.max(2, (w - 2) * frac), h - 2, (h - 2) * 0.45);
      const g = ctx.createLinearGradient(0, y * k, 0, (y + h) * k);
      g.addColorStop(0, css(mixc(colors[0], [255, 255, 255], 0.25)));
      g.addColorStop(0.45, css(colors[0]));
      g.addColorStop(1, css(colors[1]));
      ctx.fillStyle = g;
      ctx.fill();
      // Gloss
      this.rr(ctx, x + 1, y + 1, Math.max(2, (w - 2) * frac), (h - 2) * 0.42, (h - 2) * 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fill();
      ctx.restore();
    }
    if (opts.glow) {
      ctx.globalAlpha = 0.25 + 0.25 * Math.sin(this.pulse * 6);
      this.rr(ctx, x - 1, y - 1, w + 2, h + 2, h * 0.5);
      ctx.strokeStyle = css(hex('#ff5a4a'));
      ctx.lineWidth = 2 * k;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (opts.label && h >= 11) {
      this.text(ctx, opts.label, x + w / 2, y + h - 3, {
        size: h * 0.72,
        align: 'center',
        color: [240, 236, 226],
        strokeW: 2.6,
      });
    }
  }

  // -- top right: minimap + buttons -----------------------------------------

  drawTopRight(ctx) {
    const g = this.game;
    const k = this.k;
    const R = Math.min(46, this.H * 0.13);
    const cx = this.W - R - 12;
    const cy = R + 12;

    // Minimap disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx * k, cy * k, R * k, 0, TAU);
    ctx.fillStyle = 'rgba(10,12,15,0.72)';
    ctx.fill();
    ctx.save();
    ctx.clip();
    const zone = g.zone;
    const scale = (R * 0.92) / (zone.half * 0.62);
    const px = g.player.x;
    const py = g.player.y;
    const mx = (wx, wy) => (cx + (wx - px) * scale) * k;
    const my = (wx, wy) => (cy + (wy - py) * scale) * k;

    // Road
    ctx.strokeStyle = 'rgba(150,132,92,0.35)';
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    for (let i = 0; i < zone.road.length; i++) {
      const r = zone.road[i];
      if (i === 0) ctx.moveTo(mx(r.x, r.y), my(r.x, r.y));
      else ctx.lineTo(mx(r.x, r.y), my(r.x, r.y));
    }
    ctx.stroke();

    // Boss arena
    ctx.strokeStyle = 'rgba(210,90,60,0.6)';
    ctx.lineWidth = 1.6 * k;
    ctx.beginPath();
    ctx.arc(mx(zone.bossArena.x, 0), my(0, zone.bossArena.y), zone.bossArena.r * scale * k, 0, TAU);
    ctx.stroke();

    // Chests and shrines
    for (const s of zone.shrines) {
      if (s.used) continue;
      ctx.fillStyle = 'rgba(120,220,180,0.9)';
      ctx.beginPath();
      ctx.arc(mx(s.x, 0), my(0, s.y), 2.4 * k, 0, TAU);
      ctx.fill();
    }
    for (const c of zone.chests) {
      if (c.opened) continue;
      ctx.fillStyle = css(PAL.gold, 0.9);
      ctx.fillRect(mx(c.x, 0) - 2 * k, my(0, c.y) - 2 * k, 4 * k, 4 * k);
    }
    // Monsters
    for (const m of g.monsters) {
      ctx.fillStyle = m.boss ? 'rgba(255,90,60,1)' : m.elite ? 'rgba(240,170,60,0.95)' : 'rgba(210,70,60,0.8)';
      ctx.beginPath();
      ctx.arc(mx(m.x, 0), my(0, m.y), (m.boss ? 4.2 : m.elite ? 3 : 2) * k, 0, TAU);
      ctx.fill();
    }
    // Loot
    for (const d of g.drops) {
      if (d.kind !== 'item') continue;
      ctx.fillStyle = css(g.rarityColor(d.item.rarity), 0.95);
      ctx.beginPath();
      ctx.arc(mx(d.x, 0), my(0, d.y), 2.2 * k, 0, TAU);
      ctx.fill();
    }
    // Portal
    if (g.portal) {
      ctx.fillStyle = 'rgba(140,240,200,1)';
      ctx.beginPath();
      ctx.arc(mx(g.portal.x, 0), my(0, g.portal.y), 4 * k, 0, TAU);
      ctx.fill();
    }
    // Player
    ctx.fillStyle = '#f2ecdc';
    ctx.beginPath();
    ctx.moveTo(cx * k + Math.cos(g.player.facing) * 5 * k, cy * k + Math.sin(g.player.facing) * 5 * k);
    ctx.lineTo(cx * k + Math.cos(g.player.facing + 2.4) * 4 * k, cy * k + Math.sin(g.player.facing + 2.4) * 4 * k);
    ctx.lineTo(cx * k + Math.cos(g.player.facing - 2.4) * 4 * k, cy * k + Math.sin(g.player.facing - 2.4) * 4 * k);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(176,152,102,0.7)';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.arc(cx * k, cy * k, R * k, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // Buttons under the map
    const by = cy + R + 18;
    const bs = 17;
    this.iconButton(ctx, 'inventory', this.W - 30, by, bs, 'bag', this.newItems > 0);
    this.iconButton(ctx, 'menu', this.W - 30 - bs * 2.6, by, bs, 'menu', false);
  }

  iconButton(ctx, id, x, y, r, glyph, badge) {
    const k = this.k;
    const down = this.input.isDown(id);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x * k, y * k, r * k, 0, TAU);
    const g = ctx.createLinearGradient(0, (y - r) * k, 0, (y + r) * k);
    g.addColorStop(0, down ? 'rgba(72,66,52,0.95)' : 'rgba(38,38,44,0.9)');
    g.addColorStop(1, 'rgba(16,16,20,0.95)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(176,152,102,0.6)';
    ctx.lineWidth = 1.6 * k;
    ctx.stroke();
    ctx.translate(x * k, y * k);
    ctx.strokeStyle = '#ded5bd';
    ctx.fillStyle = '#ded5bd';
    ctx.lineWidth = 1.8 * k;
    const s = r * k * 0.5;
    if (glyph === 'bag') {
      ctx.strokeRect(-s * 0.85, -s * 0.5, s * 1.7, s * 1.4);
      ctx.beginPath();
      ctx.arc(0, -s * 0.5, s * 0.55, Math.PI, TAU);
      ctx.stroke();
    } else if (glyph === 'menu') {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-s, i * s * 0.65);
        ctx.lineTo(s, i * s * 0.65);
        ctx.stroke();
      }
    } else if (glyph === 'x') {
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, -s * 0.7);
      ctx.lineTo(s * 0.7, s * 0.7);
      ctx.moveTo(s * 0.7, -s * 0.7);
      ctx.lineTo(-s * 0.7, s * 0.7);
      ctx.stroke();
    }
    ctx.restore();
    if (badge) {
      ctx.save();
      ctx.fillStyle = '#d24a2a';
      ctx.beginPath();
      ctx.arc((x + r * 0.72) * k, (y - r * 0.72) * k, 5.5 * k, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    this.btn(id, x, y, r);
  }

  // -- skills ---------------------------------------------------------------

  skillLayout() {
    const W = this.W;
    const H = this.H;
    const big = Math.min(38, H * 0.105);
    const small = big * 0.72;
    const cx = W - big - 22;
    const cy = H - big - 22;
    return {
      primary: { x: cx, y: cy, r: big },
      s2: { x: cx - big * 2.15, y: cy - big * 0.15, r: small },
      s3: { x: cx - big * 1.62, y: cy - big * 1.72, r: small },
      s4: { x: cx - big * 0.05, y: cy - big * 2.2, r: small },
      potion: { x: cx - big * 3.05, y: cy - big * 1.5, r: small * 0.92 },
    };
  }

  drawSkillBar(ctx) {
    const g = this.game;
    const lay = this.skillLayout();
    const ids = g.cls.skills;
    const slots = [lay.primary, lay.s2, lay.s3, lay.s4];
    for (let i = 0; i < 4; i++) {
      const id = ids[i];
      const sk = SKILLS[id];
      const pos = slots[i];
      const unlocked = g.skillUnlocked(id);
      const cd = g.player.cds[id] || 0;
      const cdFrac = cd > 0 ? cd / sk.cd : 0;
      const noRes = sk.cost > g.player.resource;
      this.skillButton(ctx, 'skill' + (i + 1), pos.x, pos.y, pos.r, sk, {
        unlocked,
        cdFrac,
        cd,
        noRes,
        level: sk.unlock,
      });
    }
    // Potion
    const p = g.player;
    const pot = lay.potion;
    this.potionButton(ctx, pot.x, pot.y, pot.r, p.potions, p.potionCd / 11);
  }

  skillButton(ctx, id, x, y, r, sk, st) {
    const k = this.k;
    const down = this.input.isDown(id);
    ctx.save();
    // Body
    ctx.beginPath();
    ctx.arc(x * k, y * k, r * k, 0, TAU);
    const g = ctx.createRadialGradient(x * k, (y - r * 0.5) * k, r * 0.1 * k, x * k, y * k, r * k);
    if (!st.unlocked) {
      g.addColorStop(0, 'rgba(30,30,34,0.85)');
      g.addColorStop(1, 'rgba(12,12,16,0.9)');
    } else {
      g.addColorStop(0, down ? 'rgba(96,86,62,0.98)' : 'rgba(52,50,54,0.95)');
      g.addColorStop(1, 'rgba(16,16,20,0.96)');
    }
    ctx.fillStyle = g;
    ctx.fill();

    // Icon
    ctx.save();
    ctx.globalAlpha = st.unlocked ? (st.noRes || st.cdFrac > 0 ? 0.45 : 1) : 0.25;
    drawSkillGlyph(ctx, sk.icon, x * k, y * k, r * k * 0.92, sk.color);
    ctx.restore();

    // Cooldown sweep
    if (st.cdFrac > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x * k, y * k);
      ctx.arc(x * k, y * k, r * k, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - st.cdFrac), false);
      ctx.closePath();
      ctx.fillStyle = 'rgba(8,9,12,0.62)';
      ctx.fill();
      ctx.restore();
      if (st.cd > 0.35) {
        this.text(ctx, st.cd.toFixed(st.cd < 3 ? 1 : 0), x, y + r * 0.28, {
          size: r * 0.66,
          align: 'center',
          color: [232, 226, 208],
        });
      }
    }

    // Ring
    ctx.beginPath();
    ctx.arc(x * k, y * k, r * k, 0, TAU);
    ctx.strokeStyle = st.unlocked
      ? down
        ? 'rgba(255,222,150,0.95)'
        : 'rgba(176,152,102,0.75)'
      : 'rgba(90,86,80,0.5)';
    ctx.lineWidth = 2.2 * k;
    ctx.stroke();
    ctx.restore();

    if (!st.unlocked) {
      this.text(ctx, 'St. ' + st.level, x, y + r + 11, {
        size: 9,
        align: 'center',
        color: [140, 136, 128],
      });
    }
    this.btn(id, x, y, r, { disabled: !st.unlocked });
  }

  potionButton(ctx, x, y, r, count, cdFrac) {
    const k = this.k;
    const down = this.input.isDown('potion');
    const usable = count > 0 && cdFrac <= 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x * k, y * k, r * k, 0, TAU);
    const g = ctx.createRadialGradient(x * k, (y - r * 0.5) * k, 1, x * k, y * k, r * k);
    g.addColorStop(0, down ? 'rgba(110,40,40,0.95)' : 'rgba(52,30,30,0.95)');
    g.addColorStop(1, 'rgba(16,12,12,0.96)');
    ctx.fillStyle = g;
    ctx.fill();

    // Flask
    ctx.save();
    ctx.translate(x * k, y * k);
    const s = r * k * 0.05;
    ctx.globalAlpha = usable ? 1 : 0.4;
    ctx.fillStyle = css(hex('#8a2a22'));
    ctx.beginPath();
    ctx.moveTo(-3 * s * 1.6, -8 * s);
    ctx.lineTo(3 * s * 1.6, -8 * s);
    ctx.lineTo(3 * s * 1.6, -4 * s);
    ctx.quadraticCurveTo(9 * s, 2 * s, 7 * s, 8 * s);
    ctx.lineTo(-7 * s, 8 * s);
    ctx.quadraticCurveTo(-9 * s, 2 * s, -3 * s * 1.6, -4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(hex('#e04a3a'));
    ctx.beginPath();
    ctx.ellipse(0, 4 * s, 6.4 * s, 4 * s, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,220,200,0.35)';
    ctx.beginPath();
    ctx.ellipse(-2.6 * s, 0, 1.4 * s, 3.4 * s, 0.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (cdFrac > 0) {
      ctx.beginPath();
      ctx.moveTo(x * k, y * k);
      ctx.arc(x * k, y * k, r * k, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - cdFrac));
      ctx.closePath();
      ctx.fillStyle = 'rgba(8,9,12,0.6)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x * k, y * k, r * k, 0, TAU);
    ctx.strokeStyle = usable ? 'rgba(214,140,110,0.85)' : 'rgba(90,80,78,0.6)';
    ctx.lineWidth = 2 * k;
    ctx.stroke();
    ctx.restore();

    this.text(ctx, String(count), x + r * 0.72, y + r * 0.86, {
      size: 11,
      align: 'center',
      color: count > 0 ? [240, 230, 210] : [150, 120, 116],
      weight: 800,
    });
    this.btn('potion', x, y, r);
  }

  /**
   * A chevron pinned to the screen edge pointing at whatever matters next —
   * the boss arena once the quota is met, or the portal once it is open.
   * Without it players wander a 3000-unit map looking for the exit.
   */
  drawWaypoint(ctx) {
    const g = this.game;
    if (g.boss) return;
    let target = null;
    let label = '';
    let col = hex('#e0c070');
    if (g.portal) {
      target = g.portal;
      label = 'Tor';
      col = hex('#8fe0c0');
    } else if (g.kills >= g.killQuota && !g.bossSpawned) {
      target = g.zone.bossArena;
      label = 'Wächter';
    }
    if (!target) return;

    const p = g.player;
    const dx = target.x - p.x;
    const dy = (target.y - p.y) * 0.62;
    const distWorld = Math.hypot(target.x - p.x, target.y - p.y);
    if (distWorld < 260) return;
    const ang = Math.atan2(dy, dx);
    const k = this.k;
    const cx = this.W / 2;
    const cy = this.H / 2 + 8;
    // Push the marker out to an inset ellipse so it never sits under the HUD.
    const rx = this.W * 0.34;
    const ry = this.H * 0.3;
    const x = cx + Math.cos(ang) * rx;
    const y = cy + Math.sin(ang) * ry;
    const pulse = 0.75 + 0.25 * Math.sin(this.pulse * 3.4);

    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.translate(x * k, y * k);
    ctx.rotate(ang);
    ctx.fillStyle = css(col, 0.92);
    ctx.strokeStyle = 'rgba(8,8,12,0.8)';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(13 * k, 0);
    ctx.lineTo(-7 * k, -8 * k);
    ctx.lineTo(-3 * k, 0);
    ctx.lineTo(-7 * k, 8 * k);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    this.text(ctx, `${label} · ${Math.round(distWorld / 10)} m`, x, y + 20, {
      size: 10,
      align: 'center',
      color: col,
      alpha: pulse,
    });
  }

  // -- boss bar -------------------------------------------------------------

  drawBossBar(ctx) {
    const b = this.game.boss;
    if (!b || !b.alive) return;
    const w = Math.min(360, this.W * 0.46);
    const x = (this.W - w) / 2;
    const y = 12;
    this.text(ctx, b.name, this.W / 2, y - 1, {
      size: 13,
      align: 'center',
      color: hex('#e8c98a'),
      serif: true,
    });
    this.bar(ctx, x, y + 4, w, 12, clamp01(b.hp / b.maxHp), [hex('#b8241c'), hex('#4a0c0a')], {});
    // Phase pips
    const k = this.k;
    ctx.save();
    for (let i = 1; i < 3; i++) {
      const px = (x + w * (i === 1 ? 0.3 : 0.6)) * k;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1.6 * k;
      ctx.beginPath();
      ctx.moveTo(px, (y + 4) * k);
      ctx.lineTo(px, (y + 16) * k);
      ctx.stroke();
    }
    ctx.restore();
  }

  // -- messages -------------------------------------------------------------

  drawMessages(ctx) {
    const list = this.game.messages;
    if (!list.length) return;
    const m = list[list.length - 1];
    const k = clamp01(m.age / m.life);
    const a = k < 0.1 ? k / 0.1 : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    const y = this.H * 0.26;
    ctx.save();
    ctx.globalAlpha = a;
    this.text(ctx, m.title, this.W / 2, y, {
      size: Math.min(26, this.W * 0.045),
      align: 'center',
      color: hex('#e9dcb4'),
      serif: true,
      weight: 700,
      strokeW: 5,
    });
    if (m.sub) {
      this.text(ctx, m.sub, this.W / 2, y + 20, {
        size: Math.min(13, this.W * 0.024),
        align: 'center',
        color: hex('#a8a190'),
      });
    }
    ctx.restore();
  }

  // =========================================================================
  // Bag / character panel
  // =========================================================================

  drawBag(ctx) {
    const g = this.game;
    const p = g.player;
    const s = g.stats;
    const k = this.k;
    const W = this.W;
    const H = this.H;

    ctx.save();
    ctx.fillStyle = 'rgba(4,5,8,0.78)';
    ctx.fillRect(0, 0, this.r.sw, this.r.sh);
    ctx.restore();

    const pad = 8;
    const panelH = H - pad * 2;
    const leftW = Math.min(280, W * 0.38);
    this.panelBg(ctx, pad, pad, leftW, panelH);
    const rightX = pad + leftW + 8;
    const rightW = W - rightX - pad;
    this.panelBg(ctx, rightX, pad, rightW, panelH);

    // --- left: equipment + stats -----------------------------------------
    this.text(ctx, g.cls.name, pad + 10, pad + 18, { size: 14, serif: true, color: hex('#e6d3a0') });
    this.text(ctx, `Stufe ${p.level}`, pad + leftW - 10, pad + 18, {
      size: 12,
      align: 'right',
      color: hex('#a8a190'),
    });

    const cols = 4;
    const gx = pad + 10;
    const gy = pad + 30;
    const slotSize = Math.min(52, (leftW - 20 - (cols - 1) * 7) / cols, (panelH - 170) / 2.7);
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i];
      const cx = gx + (i % cols) * (slotSize + 7);
      const cy = gy + Math.floor(i / cols) * (slotSize + 17);
      this.itemCell(ctx, cx, cy, slotSize, p.equipment[slot], 'eq:' + slot, null);
      this.text(ctx, SHORT_SLOT[slot], cx + slotSize / 2, cy + slotSize + 10, {
        size: 8.5,
        align: 'center',
        color: p.equipment[slot] ? [176, 168, 150] : [110, 106, 98],
        stroke: false,
      });
    }

    const statsY = gy + 2 * (slotSize + 17) + 10;
    const dmg = damageRange(s);
    const lines = [
      ['Schaden', `${dmg[0]}–${dmg[1]}`],
      ['Leben', String(s.maxLife)],
      ['Rüstung', String(Math.round(s.armorTotal))],
      ['Krit.', `${(s.critChanceTotal * 100).toFixed(1)} %`],
      ['Krit-Schaden', `${Math.round(s.critDmgTotal * 100)} %`],
      ['Tempo', `${Math.round(s.attackSpeedMult * 100)} %`],
      ['Kraft / Geschick', `${Math.round(s.might)} / ${Math.round(s.agility)}`],
      ['Zähigkeit / Geist', `${Math.round(s.vigor)} / ${Math.round(s.spirit)}`],
    ];
    let ly = statsY;
    ctx.save();
    for (const [a, b] of lines) {
      if (ly > pad + panelH - 14) break;
      this.text(ctx, a, gx, ly, { size: 10.5, color: [150, 146, 136] });
      this.text(ctx, b, pad + leftW - 10, ly, { size: 10.5, align: 'right', color: [226, 220, 200] });
      ly += 14;
    }
    ctx.restore();

    // --- right: bag -------------------------------------------------------
    this.text(ctx, 'Beutel', rightX + 10, pad + 18, { size: 13, serif: true, color: hex('#e6d3a0') });
    this.text(ctx, `${p.inventory.length} / 40`, rightX + rightW - 176, pad + 18, {
      size: 10,
      align: 'right',
      color: p.inventory.length >= 38 ? hex('#e07a5a') : hex('#a8a190'),
    });
    this.text(ctx, `⬤ ${fmtNum(p.gold)}`, rightX + rightW - 126, pad + 18, {
      size: 10,
      align: 'right',
      color: PAL.gold,
    });
    this.textButton(ctx, 'sellJunk', rightX + rightW - 118, pad + 6, 82, 18, 'Graues verk.', { size: 9 });

    const cardH = 68;
    const cell = Math.min(46, (rightW - 24) / 8 - 6);
    const perRow = Math.max(4, Math.floor((rightW - 20) / (cell + 6)));
    const bx = rightX + 10;
    const by = pad + 28;
    const maxRows = Math.max(1, Math.floor((panelH - 44 - cardH) / (cell + 6)));
    const shown = Math.min(p.inventory.length, perRow * maxRows);
    for (let i = 0; i < shown; i++) {
      const it = p.inventory[i];
      const cx = bx + (i % perRow) * (cell + 6);
      const cy = by + Math.floor(i / perRow) * (cell + 6);
      this.itemCell(ctx, cx, cy, cell, it, 'inv:' + i, null, g.isUpgrade(it));
    }
    // Empty slots, so the bag reads as a container rather than a void.
    for (let i = shown; i < Math.min(perRow * maxRows, Math.max(shown + 6, perRow * 2)); i++) {
      const cx = bx + (i % perRow) * (cell + 6);
      const cy = by + Math.floor(i / perRow) * (cell + 6);
      ctx.save();
      this.rr(ctx, cx, cy, cell, cell, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.015)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,112,96,0.18)';
      ctx.lineWidth = 1 * this.k;
      ctx.stroke();
      ctx.restore();
    }

    // Selected item detail
    if (this.selected) {
      this.drawItemCard(ctx, this.selected, rightX + 10, pad + panelH - cardH - 8, rightW - 20, cardH);
    } else {
      this.text(
        ctx,
        p.inventory.length
          ? 'Gegenstand antippen zum Anlegen oder Verkaufen.'
          : 'Der Beutel ist leer. Erschlagenes lässt fallen.',
        rightX + 10,
        pad + panelH - 14,
        { size: 10, color: [128, 124, 116] }
      );
    }

    // Close
    this.iconButton(ctx, 'closePanel', W - 26, pad + 18, 14, 'x', false);
  }

  itemCell(ctx, x, y, size, item, id, placeholder, upgrade) {
    const k = this.k;
    const sel = this.selected && item && this.selected.uid === item.uid;
    ctx.save();
    this.rr(ctx, x, y, size, size, 5);
    ctx.fillStyle = 'rgba(16,17,21,0.9)';
    ctx.fill();
    ctx.strokeStyle = sel
      ? 'rgba(255,220,150,0.95)'
      : item
      ? css(this.game.rarityColor(item.rarity), 0.7)
      : 'rgba(90,84,72,0.4)';
    ctx.lineWidth = (sel ? 2.2 : 1.4) * k;
    ctx.stroke();
    if (item) {
      ctx.save();
      this.rr(ctx, x + 1, y + 1, size - 2, size - 2, 4);
      ctx.clip();
      const col = this.game.rarityColor(item.rarity);
      const g = ctx.createRadialGradient(
        (x + size / 2) * k,
        (y + size / 2) * k,
        0,
        (x + size / 2) * k,
        (y + size / 2) * k,
        size * k * 0.7
      );
      g.addColorStop(0, css(col, 0.22));
      g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x * k, y * k, size * k, size * k);
      ctx.restore();
      // The item sits large in its cell — Diablo II's icons nearly filled the
      // grid square, which is what let you read a bag at a glance instead of
      // squinting at a row of small symbols on big backgrounds.
      drawItemIcon(ctx, item, (x + size / 2) * k, (y + size / 2) * k, size * k * 0.92);
      if (upgrade) {
        ctx.fillStyle = '#5ad27a';
        ctx.beginPath();
        ctx.moveTo((x + size - 6) * k, (y + 4) * k);
        ctx.lineTo((x + size - 2) * k, (y + 10) * k);
        ctx.lineTo((x + size - 10) * k, (y + 10) * k);
        ctx.closePath();
        ctx.fill();
      }
    } else if (placeholder) {
      this.text(ctx, placeholder, x + size / 2, y + size / 2 + 3, {
        size: 8,
        align: 'center',
        color: [96, 92, 84],
        stroke: false,
      });
    }
    ctx.restore();
    this.rect(id, x, y, size, size);
  }

  drawItemCard(ctx, item, x, y, w, h) {
    const g = this.game;
    const col = g.rarityColor(item.rarity);
    this.panelBg(ctx, x, y, w, h, { border: css(col, 0.6) });
    this.text(ctx, item.name, x + 8, y + 15, { size: 11, color: col, weight: 700 });

    // Compare against what is currently in that slot.
    const equippedHere = g.player.equipment[item.slot];
    const isWorn = equippedHere === item;
    const delta = (now, was) => {
      if (isWorn || !equippedHere || now === was) return null;
      const d = Math.round(now - was);
      if (d === 0) return null;
      return { txt: (d > 0 ? '+' : '') + d, col: d > 0 ? hex('#6fd07a') : hex('#d07a6f') };
    };

    let ly = y + 28;
    if (item.dmg) {
      this.text(ctx, `${item.dmg[0]}–${item.dmg[1]} Schaden`, x + 8, ly, { size: 10, color: [220, 216, 200] });
      const d = delta(
        (item.dmg[0] + item.dmg[1]) / 2,
        equippedHere?.dmg ? (equippedHere.dmg[0] + equippedHere.dmg[1]) / 2 : 0
      );
      if (d) this.text(ctx, d.txt, x + 104, ly, { size: 10, color: d.col });
      ly += 12;
    }
    if (item.armorBase) {
      this.text(ctx, `${item.armorBase} Rüstung`, x + 8, ly, { size: 10, color: [220, 216, 200] });
      const d = delta(item.armorBase, equippedHere?.armorBase || 0);
      if (d) this.text(ctx, d.txt, x + 104, ly, { size: 10, color: d.col });
      ly += 12;
    }
    if (!isWorn && equippedHere) {
      const better = itemScore(item, g.cls) - itemScore(equippedHere, g.cls);
      this.text(ctx, better > 0 ? '▲ Verbesserung' : better < 0 ? '▼ Schlechter' : '= Gleichwertig', x + 8, ly, {
        size: 9.5,
        color: better > 0 ? hex('#6fd07a') : better < 0 ? hex('#a8a190') : [150, 146, 136],
      });
    }
    let sx = x + w * 0.42;
    let sy = y + 28;
    for (const key in item.stats) {
      if (sy > y + h - 6) break;
      this.text(ctx, formatStat(key, item.stats[key]), sx, sy, { size: 9.5, color: hex('#8fb4e8') });
      sy += 11;
    }
    if (item.powerText) {
      this.text(ctx, item.powerText, x + 8, y + h - 8, { size: 9.5, color: hex('#e0a45a') });
    }

    // Actions
    const equipped = Object.values(g.player.equipment).includes(item);
    const bw = 62;
    const bh = 20;
    const bx = x + w - bw - 8;
    if (equipped) {
      this.textButton(ctx, 'unequip', bx, y + h - bh - 6, bw, bh, 'Ablegen');
    } else {
      this.textButton(ctx, 'equipSel', bx, y + h - bh - 6, bw, bh, 'Anlegen');
      this.textButton(ctx, 'sellSel', bx - bw - 6, y + h - bh - 6, bw, bh, `Verk. ${item.value}`);
    }
  }

  textButton(ctx, id, x, y, w, h, label, opts = {}) {
    const k = this.k;
    const down = this.input.isDown(id);
    ctx.save();
    this.rr(ctx, x, y, w, h, 4);
    const g = ctx.createLinearGradient(0, y * k, 0, (y + h) * k);
    g.addColorStop(0, down ? 'rgba(96,84,58,0.95)' : opts.primary ? 'rgba(74,64,44,0.95)' : 'rgba(42,42,48,0.9)');
    g.addColorStop(1, 'rgba(16,16,20,0.95)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = opts.primary ? 'rgba(214,182,116,0.85)' : 'rgba(150,132,92,0.5)';
    ctx.lineWidth = 1.4 * k;
    ctx.stroke();
    ctx.restore();
    this.text(ctx, label, x + w / 2, y + h / 2 + (opts.size || 10) * 0.36, {
      size: opts.size || 10,
      align: 'center',
      color: opts.color || [230, 224, 206],
    });
    this.rect(id, x, y, w, h);
  }

  // =========================================================================
  // Menus
  // =========================================================================

  /**
   * A procedural title scene: moon over the Nehrung, three depths of pine
   * silhouette, snow on the wind. Baked once per viewport, then only the snow
   * moves.
   */
  menuBackdrop(ctx) {
    const k = this.k;
    const key = this.r.sw + 'x' + this.r.sh;
    if (this._menuKey !== key) {
      this._menuKey = key;
      const c = document.createElement('canvas');
      c.width = this.r.sw;
      c.height = this.r.sh;
      const g = c.getContext('2d');
      const W = this.r.sw;
      const H = this.r.sh;

      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#0a0d16');
      sky.addColorStop(0.45, '#141a26');
      sky.addColorStop(0.75, '#1d2029');
      sky.addColorStop(1, '#070810');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);

      // Moon and halo
      const mx = W * 0.87;
      const my = H * 0.17;
      const mr = Math.min(W, H) * 0.065;
      const halo = g.createRadialGradient(mx, my, 0, mx, my, mr * 7);
      halo.addColorStop(0, 'rgba(190,208,236,0.30)');
      halo.addColorStop(0.35, 'rgba(150,172,208,0.09)');
      halo.addColorStop(1, 'rgba(120,150,200,0)');
      g.fillStyle = halo;
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#dfe6f2';
      g.beginPath();
      g.arc(mx, my, mr, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(150,166,190,0.35)';
      g.beginPath();
      g.arc(mx - mr * 0.3, my + mr * 0.15, mr * 0.26, 0, TAU);
      g.arc(mx + mr * 0.35, my - mr * 0.3, mr * 0.16, 0, TAU);
      g.fill();

      // Three ridges of pines, back to front.
      const rng = new RNGLite(97);
      const ridge = (baseY, height, colour, count, jitter) => {
        g.fillStyle = colour;
        g.beginPath();
        g.moveTo(-10, H + 10);
        g.lineTo(-10, baseY);
        for (let i = 0; i <= count; i++) {
          const x = (i / count) * (W + 20) - 10;
          const h = height * (0.55 + rng.f() * 0.9);
          const w = h * 0.34 * (0.7 + rng.f() * 0.6);
          g.lineTo(x - w, baseY + jitter * (rng.f() - 0.5));
          // A ragged conifer edge rather than a clean triangle.
          const tiers = 5;
          for (let t = 0; t < tiers; t++) {
            const ty = baseY - (h * (t + 1)) / tiers;
            const tw = w * (1 - (t + 1) / (tiers + 0.6));
            g.lineTo(x - tw * 1.35, ty + h / tiers * 0.35);
            g.lineTo(x - tw, ty);
          }
          g.lineTo(x, baseY - h);
          for (let t = tiers - 1; t >= 0; t--) {
            const ty = baseY - (h * (t + 1)) / tiers;
            const tw = w * (1 - (t + 1) / (tiers + 0.6));
            g.lineTo(x + tw, ty);
            g.lineTo(x + tw * 1.35, ty + h / tiers * 0.35);
          }
          g.lineTo(x + w, baseY + jitter * (rng.f() - 0.5));
        }
        g.lineTo(W + 10, baseY);
        g.lineTo(W + 10, H + 10);
        g.closePath();
        g.fill();
      };
      ridge(H * 0.74, H * 0.30, '#1e2735', 13, 6);
      ridge(H * 0.86, H * 0.36, '#141b26', 10, 8);
      ridge(H * 1.0, H * 0.44, '#090d15', 8, 10);

      // Ground haze
      const haze = g.createLinearGradient(0, H * 0.6, 0, H);
      haze.addColorStop(0, 'rgba(90,110,140,0)');
      haze.addColorStop(0.6, 'rgba(80,100,132,0.10)');
      haze.addColorStop(1, 'rgba(60,76,104,0.02)');
      g.fillStyle = haze;
      g.fillRect(0, H * 0.6, W, H * 0.4);

      const vig = g.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, W * 0.8);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(2,3,6,0.85)');
      g.fillStyle = vig;
      g.fillRect(0, 0, W, H);

      this._menuBg = c;
    }
    ctx.drawImage(this._menuBg, 0, 0);

    // Snow on the wind, drawn live.
    const t = performance.now() / 1000;
    ctx.save();
    for (let i = 0; i < 150; i++) {
      const s = (i * 37.13) % 1;
      const depth = 0.35 + s * 0.65;
      const x = (((i * 97.7) % 1) * this.r.sw + t * 26 * depth + Math.sin(t * 0.7 + i) * 22 * depth) % (this.r.sw + 40);
      const y = (((i * 53.3) % 1) * this.r.sh + t * (34 + s * 60) * depth) % (this.r.sh + 40);
      ctx.globalAlpha = (0.18 + s * 0.42) * depth;
      ctx.fillStyle = '#e8f0fb';
      ctx.beginPath();
      ctx.arc(x - 20, y - 20, (0.6 + s * 1.3) * depth * k, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawMenu(ctx) {
    const W = this.W;
    const H = this.H;
    const k = this.k;

    this.menuBackdrop(ctx);

    const titleY = Math.max(40, H * 0.145);
    this.text(ctx, 'DER WEG DES RITTERS', W / 2, titleY, {
      size: Math.min(34, W * 0.052),
      align: 'center',
      color: hex('#e8d3a0'),
      serif: true,
      weight: 700,
      strokeW: 6,
    });
    this.text(ctx, 'Ostpreußen, im Jahr des Herrn 1409', W / 2, titleY + 20, {
      size: Math.min(13, W * 0.022),
      align: 'center',
      color: hex('#8e8878'),
    });

    // Class cards
    const ids = Object.keys(CLASSES);
    const cardW = Math.min(206, (W - 56) / 3);
    const gap = 10;
    const totalW = cardW * 3 + gap * 2;
    const sx = (W - totalW) / 2;
    const sy = titleY + 32;
    const cardH = Math.max(150, Math.min(H - sy - 66, 208));
    for (let i = 0; i < 3; i++) {
      const cls = CLASSES[ids[i]];
      const x = sx + i * (cardW + gap);
      const chosen = i === this.menuIndex;
      const hovered = this.input.isDown('cls:' + ids[i]);

      if (chosen) {
        // Warm bloom behind the selected card.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(
          (x + cardW / 2) * k,
          (sy + cardH / 2) * k,
          0,
          (x + cardW / 2) * k,
          (sy + cardH / 2) * k,
          cardW * k
        );
        g.addColorStop(0, 'rgba(146,116,58,0.30)');
        g.addColorStop(1, 'rgba(146,116,58,0)');
        ctx.fillStyle = g;
        ctx.fillRect((x - cardW) * k, (sy - cardH) * k, cardW * 3 * k, cardH * 3 * k);
        ctx.restore();
      }

      this.panelBg(ctx, x, sy, cardW, cardH, {
        border: chosen || hovered ? 'rgba(240,208,136,0.95)' : 'rgba(150,132,92,0.38)',
      });
      this.text(ctx, cls.name, x + cardW / 2, sy + 21, {
        size: 15,
        align: 'center',
        color: chosen ? hex('#f4e2b0') : hex('#c9bb96'),
        serif: true,
      });
      this.text(ctx, cls.subtitle, x + cardW / 2, sy + 35, {
        size: 9.5,
        align: 'center',
        color: [140, 136, 126],
      });

      const sigilY = sy + cardH * 0.42;
      drawClassSigil(ctx, ids[i], (x + cardW / 2) * k, sigilY * k, cardH * 0.17 * k);

      // The four skills this class will learn.
      const icons = cls.skills;
      const iw = 22;
      const ix = x + cardW / 2 - (icons.length * iw) / 2 + iw / 2;
      const iy = sy + cardH - 54;
      for (let s = 0; s < icons.length; s++) {
        const sk = SKILLS[icons[s]];
        ctx.save();
        ctx.globalAlpha = chosen ? 0.95 : 0.55;
        drawSkillGlyph(ctx, sk.icon, (ix + s * iw) * k, iy * k, 8.5 * k, sk.color);
        ctx.restore();
      }

      wrapText(this, ctx, cls.blurb, x + 11, sy + cardH - 34, cardW - 22, 11, {
        size: 9.5,
        color: chosen ? [188, 182, 168] : [150, 146, 138],
      });
      this.rect('cls:' + ids[i], x, sy, cardW, cardH);
    }

    // Buttons
    const by = Math.min(H - 40, sy + cardH + 12);
    const bw = 132;
    const bh = 30;
    if (this.game.hasSave()) {
      this.textButton(ctx, 'continue', W / 2 - bw - 6, by, bw, bh, 'Fortsetzen', { primary: true, size: 12 });
      this.textButton(ctx, 'newGame', W / 2 + 6, by, bw, bh, 'Neu beginnen', { size: 12 });
    } else {
      this.textButton(ctx, 'newGame', W / 2 - bw / 2, by, bw, bh, 'Beginnen', { primary: true, size: 12 });
    }
    this.textButton(ctx, 'toggleSound', W - 96, 12, 84, 22, audio.muted ? 'Ton: aus' : 'Ton: an', {
      size: 10,
    });
  }

  drawPauseMenu(ctx) {
    const W = this.W;
    const H = this.H;
    ctx.save();
    ctx.fillStyle = 'rgba(4,5,8,0.8)';
    ctx.fillRect(0, 0, this.r.sw, this.r.sh);
    ctx.restore();
    const w = Math.min(260, W * 0.5);
    const h = 190;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    this.panelBg(ctx, x, y, w, h);
    this.text(ctx, 'Pause', W / 2, y + 26, { size: 18, align: 'center', color: hex('#e6d3a0'), serif: true });
    const bw = w - 40;
    this.textButton(ctx, 'resume', x + 20, y + 42, bw, 26, 'Weiter', { primary: true, size: 11 });
    this.textButton(ctx, 'toggleSound', x + 20, y + 74, bw, 26, audio.muted ? 'Ton: aus' : 'Ton: an', { size: 11 });
    this.textButton(ctx, 'saveGame', x + 20, y + 106, bw, 26, 'Speichern', { size: 11 });
    this.textButton(ctx, 'quitRun', x + 20, y + 138, bw, 26, 'Zurück zum Titel', { size: 11 });
    const g = this.game;
    this.text(
      ctx,
      `Getötet: ${g.player.totalKills}   ·   Akt ${g.actIndex + 1}/5`,
      W / 2,
      y + h - 8,
      { size: 9.5, align: 'center', color: [130, 126, 118] }
    );
  }

  drawDeath(ctx) {
    const W = this.W;
    const H = this.H;
    ctx.save();
    ctx.fillStyle = 'rgba(30,4,4,0.55)';
    ctx.fillRect(0, 0, this.r.sw, this.r.sh);
    ctx.fillStyle = 'rgba(2,2,4,0.5)';
    ctx.fillRect(0, 0, this.r.sw, this.r.sh);
    ctx.restore();
    this.text(ctx, 'GEFALLEN', W / 2, H * 0.36, {
      size: Math.min(44, W * 0.075),
      align: 'center',
      color: hex('#b8241c'),
      serif: true,
      weight: 700,
      strokeW: 7,
    });
    this.text(ctx, 'Der Orden zählt einen Bruder weniger.', W / 2, H * 0.36 + 24, {
      size: 12,
      align: 'center',
      color: [160, 150, 140],
    });
    const bw = 150;
    this.textButton(ctx, 'respawn', W / 2 - bw - 6, H * 0.62, bw, 32, 'Wiederauferstehen', { primary: true, size: 12 });
    this.textButton(ctx, 'quitRun', W / 2 + 6, H * 0.62, bw, 32, 'Zum Titel', { size: 12 });
    this.text(
      ctx,
      'Wiederauferstehen kostet die Hälfte deines Goldes.',
      W / 2,
      H * 0.62 + 48,
      { size: 10, align: 'center', color: [128, 124, 116] }
    );
  }

  drawVictory(ctx) {
    const W = this.W;
    const H = this.H;
    ctx.save();
    const g = ctx.createRadialGradient(W * 0.5 * this.k, H * 0.4 * this.k, 10, W * 0.5 * this.k, H * 0.5 * this.k, W * this.k);
    g.addColorStop(0, 'rgba(60,48,24,0.7)');
    g.addColorStop(1, 'rgba(3,3,6,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.r.sw, this.r.sh);
    ctx.restore();
    this.text(ctx, 'DER HAIN SCHWEIGT', W / 2, H * 0.3, {
      size: Math.min(38, W * 0.062),
      align: 'center',
      color: hex('#e9dcb4'),
      serif: true,
      weight: 700,
      strokeW: 6,
    });
    const p = this.game.player;
    const lines = [
      'Perkūnas ist gefallen. Der Donner über der heiligen Eiche ist verstummt.',
      `Stufe ${p.level}   ·   ${p.totalKills} Feinde   ·   ${fmtNum(p.gold)} Gold`,
    ];
    let y = H * 0.3 + 26;
    for (const l of lines) {
      this.text(ctx, l, W / 2, y, { size: 12, align: 'center', color: [186, 178, 162] });
      y += 18;
    }
    const bw = 170;
    this.textButton(ctx, 'endless', W / 2 - bw - 6, H * 0.66, bw, 32, 'Die Ewige Jagd', { primary: true, size: 12 });
    this.textButton(ctx, 'quitRun', W / 2 + 6, H * 0.66, bw, 32, 'Zum Titel', { size: 12 });
  }

  // =========================================================================
  // Input handling
  // =========================================================================

  handleInput() {
    const inp = this.input;
    const g = this.game;

    if (g.state === 'menu') {
      const ids = Object.keys(CLASSES);
      for (let i = 0; i < ids.length; i++) {
        if (inp.wasPressed('cls:' + ids[i])) {
          this.menuIndex = i;
          audio.play('ui');
        }
      }
      if (inp.wasPressed('newGame')) {
        audio.play('uiBig');
        g.newRun(ids[this.menuIndex]);
      }
      if (inp.wasPressed('continue')) {
        audio.play('uiBig');
        if (!g.continueRun()) g.newRun(ids[this.menuIndex]);
      }
      if (inp.wasPressed('toggleSound')) {
        audio.setMuted(!audio.muted);
        audio.play('ui');
      }
      return;
    }

    if (inp.wasPressed('inventory')) {
      this.panel = this.panel === 'bag' ? null : 'bag';
      this.selected = null;
      this.newItems = 0;
      audio.play('ui');
    }
    if (inp.wasPressed('menu') || inp.wasPressed('closePanel')) {
      if (this.panel) {
        this.panel = null;
        this.selected = null;
      } else this.panel = 'menu';
      audio.play('ui');
    }

    if (this.panel === 'bag') {
      if (inp.wasPressed('sellJunk')) {
        g.sellJunk();
        this.selected = null;
      }
      for (let i = 0; i < g.player.inventory.length; i++) {
        if (inp.wasPressed('inv:' + i)) {
          this.selected = g.player.inventory[i];
          audio.play('ui');
        }
      }
      for (const slot of SLOTS) {
        if (inp.wasPressed('eq:' + slot)) {
          this.selected = g.player.equipment[slot];
          audio.play('ui');
        }
      }
      if (this.selected) {
        if (inp.wasPressed('equipSel')) {
          g.equip(this.selected);
          this.selected = null;
        }
        if (inp.wasPressed('sellSel')) {
          g.sellItem(this.selected);
          this.selected = null;
        }
        if (inp.wasPressed('unequip')) {
          const slot = Object.keys(g.player.equipment).find(
            (s) => g.player.equipment[s] === this.selected
          );
          if (slot) g.unequip(slot);
          this.selected = null;
        }
      }
    } else if (this.panel === 'menu') {
      if (inp.wasPressed('resume')) {
        this.panel = null;
        audio.play('ui');
      }
      if (inp.wasPressed('toggleSound')) {
        audio.setMuted(!audio.muted);
        audio.play('ui');
      }
      if (inp.wasPressed('saveGame')) {
        g.save();
        g.pushMessage('Gespeichert', '', 1.4);
        audio.play('ui');
      }
      if (inp.wasPressed('quitRun')) {
        g.save();
        g.state = 'menu';
        this.panel = null;
        audio.play('uiBig');
      }
    }

    if (g.state === 'dead') {
      if (inp.wasPressed('respawn')) g.respawnPlayer();
      if (inp.wasPressed('quitRun')) {
        g.state = 'menu';
        audio.play('uiBig');
      }
    }

    if (g.state === 'victory') {
      if (inp.wasPressed('endless')) {
        g.endless = true;
        g.difficulty *= 1.55;
        g.loadAct(0);
        g.state = 'playing';
        g.pushMessage('Die Ewige Jagd', 'Schwierigkeit ×' + g.difficulty.toFixed(1), 4);
      }
      if (inp.wasPressed('quitRun')) {
        g.state = 'menu';
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

export function drawSkillGlyph(ctx, kind, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  const s = r / 16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = css(color);
  ctx.fillStyle = css(color);
  ctx.lineWidth = 2.4 * s;
  switch (kind) {
    case 'slash':
      ctx.beginPath();
      ctx.arc(0, 2 * s, 10 * s, -2.5, -0.5);
      ctx.stroke();
      ctx.lineWidth = 1.4 * s;
      ctx.beginPath();
      ctx.arc(0, 4 * s, 13 * s, -2.4, -0.7);
      ctx.stroke();
      break;
    case 'shield':
      ctx.beginPath();
      ctx.moveTo(-9 * s, -9 * s);
      ctx.lineTo(9 * s, -9 * s);
      ctx.lineTo(9 * s, 2 * s);
      ctx.quadraticCurveTo(0, 12 * s, -9 * s, 2 * s);
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      ctx.moveTo(-13 * s, -2 * s);
      ctx.lineTo(-16 * s, -2 * s);
      ctx.moveTo(13 * s, -2 * s);
      ctx.lineTo(16 * s, -2 * s);
      ctx.stroke();
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, 10 * s, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 1.8 * s;
      ctx.beginPath();
      ctx.moveTo(0, -7 * s);
      ctx.lineTo(0, 7 * s);
      ctx.moveTo(-7 * s, 0);
      ctx.lineTo(7 * s, 0);
      ctx.stroke();
      break;
    case 'whirl':
      ctx.lineWidth = 2.2 * s;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(0, 0, 9 * s, a, a + 1.5);
        ctx.stroke();
      }
      break;
    case 'arrow':
      ctx.beginPath();
      ctx.moveTo(-11 * s, 6 * s);
      ctx.lineTo(9 * s, -8 * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(11 * s, -10 * s);
      ctx.lineTo(3 * s, -8 * s);
      ctx.lineTo(9 * s, -1 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'trap':
      ctx.beginPath();
      ctx.arc(0, 2 * s, 8 * s, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 1.6 * s;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8 * s, 2 * s + Math.sin(a) * 8 * s);
        ctx.lineTo(Math.cos(a) * 12 * s, 2 * s + Math.sin(a) * 12 * s);
        ctx.stroke();
      }
      break;
    case 'rain':
      ctx.lineWidth = 2 * s;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 6 * s - 3 * s, -11 * s);
        ctx.lineTo(i * 6 * s + 1 * s, 4 * s);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, 9 * s, 10 * s, 3.4 * s, 0, 0, TAU);
      ctx.stroke();
      break;
    case 'blink':
      ctx.lineWidth = 2.2 * s;
      ctx.beginPath();
      ctx.arc(-5 * s, 0, 6 * s, 0.6, 5.6);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(7 * s, 0, 6 * s, 0.6, 5.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    case 'shard':
      for (let i = 0; i < 3; i++) {
        const a = -1.9 + i * 0.55;
        ctx.save();
        ctx.rotate(a + 1.2);
        ctx.beginPath();
        ctx.moveTo(0, -11 * s);
        ctx.lineTo(3 * s, -3 * s);
        ctx.lineTo(0, 5 * s);
        ctx.lineTo(-3 * s, -3 * s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    case 'frost':
      ctx.lineWidth = 1.8 * s;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 11 * s, Math.sin(a) * 11 * s);
        ctx.moveTo(Math.cos(a) * 6 * s, Math.sin(a) * 6 * s);
        ctx.lineTo(Math.cos(a + 0.5) * 9 * s, Math.sin(a + 0.5) * 9 * s);
        ctx.moveTo(Math.cos(a) * 6 * s, Math.sin(a) * 6 * s);
        ctx.lineTo(Math.cos(a - 0.5) * 9 * s, Math.sin(a - 0.5) * 9 * s);
        ctx.stroke();
      }
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(2 * s, -12 * s);
      ctx.lineTo(-6 * s, 1 * s);
      ctx.lineTo(0 * s, 1 * s);
      ctx.lineTo(-3 * s, 12 * s);
      ctx.lineTo(7 * s, -2 * s);
      ctx.lineTo(1 * s, -2 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ward':
      ctx.beginPath();
      ctx.arc(0, 0, 10 * s, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(0, 0, 6 * s, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    default:
      ctx.beginPath();
      ctx.arc(0, 0, 8 * s, 0, TAU);
      ctx.stroke();
  }
  ctx.restore();
}

function drawClassSigil(ctx, id, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (id === 'ritter') {
    ctx.fillStyle = css(PAL.orderWhite, 0.9);
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, -r);
    ctx.lineTo(r * 0.62, -r);
    ctx.lineTo(r * 0.62, r * 0.25);
    ctx.quadraticCurveTo(0, r * 1.3, -r * 0.62, r * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(PAL.orderBlack, 0.9);
    ctx.fillRect(-r * 0.14, -r * 0.74, r * 0.28, r * 1.5);
    ctx.fillRect(-r * 0.5, -r * 0.14, r * 1.0, r * 0.28);
    ctx.fillRect(-r * 0.28, -r * 0.86, r * 0.56, r * 0.2);
    ctx.fillRect(-r * 0.28, r * 0.66, r * 0.56, r * 0.2);
  } else if (id === 'jaegerin') {
    ctx.strokeStyle = css(hex('#9fd0a8'), 0.9);
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.arc(-r * 0.2, 0, r, -1.35, 1.35);
    ctx.stroke();
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2 + Math.cos(-1.35) * r, Math.sin(-1.35) * r);
    ctx.lineTo(-r * 0.2 + Math.cos(1.35) * r, Math.sin(1.35) * r);
    ctx.stroke();
    ctx.strokeStyle = css(hex('#e8dfae'), 0.95);
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, 0);
    ctx.lineTo(r * 0.75, 0);
    ctx.stroke();
  } else {
    ctx.fillStyle = css(PAL.amber, 0.9);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const rr = i % 2 ? r * 0.55 : r;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(hex('#fff0c0'), 0.85);
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.2, r * 0.28, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function wrapText(hud, ctx, str, x, y, maxW, lineH, opts) {
  const words = str.split(' ');
  let line = '';
  let ly = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (hud.measure(ctx, test, opts.size) > maxW && line) {
      hud.text(ctx, line, x, ly, opts);
      line = w;
      ly += lineH;
    } else {
      line = test;
    }
  }
  if (line) hud.text(ctx, line, x, ly, opts);
}
