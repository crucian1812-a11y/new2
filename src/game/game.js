// The game itself: entities, combat, the five acts, and the loop that runs
// them. Rendering lives in ../render, data lives in ./content.

import {
  ACTS,
  CLASSES,
  SKILLS,
  MONSTERS,
  BOSSES,
  LOOKS,
  MOB_LOOKS,
  xpForLevel,
  MAX_LEVEL,
} from './content.js';
import { Zone } from './worldgen.js';
import { makeItem, rollDrop, computeStats, mitigation, emptyEquipment, itemScore } from './loot.js';
import { RNG, rnd, rndInt, chance } from '../core/rng.js';
import {
  clamp,
  clamp01,
  lerp,
  damp,
  dist,
  dist2,
  TAU,
  angleDelta,
  angleTowards,
  inCone,
} from '../core/math.js';
import { renderActor } from '../render/actors.js';
import { getProp, getScaledProp } from '../render/props.js';
import { PAL, hex, css, mixc } from '../render/palette.js';
import { bakeBloodDecal, bakeScorchDecal } from '../render/textures.js';
import { ISO_Y } from '../render/renderer.js';
import { audio } from '../core/audio.js';
import { save, load, clearSave } from '../core/save.js';
import { drawItemIcon } from '../render/icons.js';

const BAG_SIZE = 40;
const POTION_HEAL = 0.36;
const POTION_CD = 11;

export class Game {
  constructor(renderer, input, fx) {
    this.r = renderer;
    this.input = input;
    this.fx = fx;
    this.state = 'menu'; // menu | playing | dead | victory | paused
    this.time = 0;
    this.hitStop = 0;
    this.rng = new RNG(1);
    this.bloodDecals = [0, 1, 2, 3].map((i) => bakeBloodDecal(1000 + i));
    this.scorch = bakeScorchDecal([40, 30, 20], 7);
    this.monsters = [];
    this.projectiles = [];
    this.ground = [];
    this.drops = [];
    this.corpses = [];
    this.messages = [];
    this.tension = 0;
    this.paused = false;
    this.difficulty = 1;
    this.endless = false;
    this.log = [];
  }

  // =========================================================================
  // Run lifecycle
  // =========================================================================

  newRun(classId, seed = Date.now()) {
    const cls = CLASSES[classId];
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.classId = classId;
    this.cls = cls;
    this.player = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      facing: -Math.PI / 2,
      anim: 'idle',
      animT: 0,
      animDur: 0,
      phase: 0,
      speed01: 0,
      level: 1,
      xp: 0,
      gold: 0,
      potions: 5,
      maxPotions: 5,
      potionCd: 0,
      hp: 1,
      resource: 0,
      cds: {},
      buffs: {},
      equipment: emptyEquipment(),
      inventory: [],
      radius: 22,
      size: 88,
      invuln: 0,
      dashT: 0,
      dashVX: 0,
      dashVY: 0,
      flash: 0,
      attackChain: 0,
      channel: null,
      alive: true,
      look: LOOKS[cls.look],
      statPoints: 0,
      bonus: {},
      kills: 0,
      totalKills: 0,
    };
    // A starting weapon so the first act isn't bare-handed.
    const startWeapon = makeItem({
      rng: this.rng,
      ilvl: 1,
      slot: 'weapon',
      rarity: 'magic',
    });
    this.equip(startWeapon, true);
    this.recompute();
    this.player.hp = this.stats.maxLife;
    this.player.resource = cls.resource.id === 'zorn' ? 0 : this.stats.maxResource;

    this.actIndex = 0;
    this.endless = false;
    this.difficulty = 1;
    this.loadAct(0);
    this.state = 'playing';
    this.pushMessage(ACTS[0].name, ACTS[0].subtitle, 4.5);
    this.logLine(ACTS[0].intro);
  }

  loadAct(index) {
    clearTimers();
    const act = ACTS[index];
    this.actIndex = index;
    this.act = act;
    this.zone = new Zone(act, index, (this.seed + index * 7919) >>> 0);
    this.r.setAmbience(act.ambience);
    this.r.setTerrain(act.terrain);
    this.r.clearDecals();
    this.fx.clear();
    this.fx.setWeather(
      { snow: 'snow', leaves: 'leaves', mist: 'mist', ash: 'ash', storm: 'storm' }[
        ({ coast: 'snow', forest: 'leaves', bog: 'mist', castle: 'ash', grove: 'storm' })[act.ambience]
      ],
      { coast: 0.55, forest: 0.4, bog: 0.85, castle: 0.5, grove: 0.75 }[act.ambience]
    );
    audio.setKey(act.key);

    this.monsters.length = 0;
    this.projectiles.length = 0;
    this.ground.length = 0;
    this.drops.length = 0;
    this.corpses.length = 0;

    this.player.x = this.zone.start.x;
    this.player.y = this.zone.start.y;
    this.player.facing = -Math.PI / 2;
    this.r.cam.x = this.player.x;
    this.r.cam.y = this.player.y;

    this.killQuota = Math.round(act.quota * (this.endless ? 1.3 : 1));
    this.kills = 0;
    this.bossSpawned = false;
    this.bossDead = false;
    this.boss = null;
    this.portal = null;
    this.spawnTimer = 1.5;
    this.actProgress = 0;
  }

  logLine(text) {
    this.log.push({ text, t: this.time });
    if (this.log.length > 40) this.log.shift();
  }

  pushMessage(title, sub, dur = 3) {
    this.messages.push({ title, sub, life: dur, age: 0 });
  }

  // =========================================================================
  // Character
  // =========================================================================

  recompute() {
    this.stats = computeStats(this.cls, this.player.level, this.player.equipment, this.player.bonus);
    this.player.hp = Math.min(this.player.hp, this.stats.maxLife);
    this.player.resource = Math.min(this.player.resource, this.stats.maxResource);
    // Keep the drawn weapon matching what's equipped.
    const w = this.player.equipment.weapon;
    const look = { ...LOOKS[this.cls.look] };
    if (w) {
      const map = { sword: 'sword', falchion: 'sword', warhammer: 'mace', bow: 'bow', staff: 'staff' };
      look.weapon = map[w.base] || look.weapon;
      if (look.weapon === 'bow') look.weaponHand = 'L';
      else look.weaponHand = 'R';
    }
    const off = this.player.equipment.offhand;
    if (off) look.offhand = off.base === 'tome' ? 'orb' : 'shield';

    // Armour you can see. The rig already knows how to draw a great helm, a
    // kettle hat, a hood, plate, mail and a robe — the item bases are named
    // after exactly those, so equipping a piece swaps the drawing rather than
    // only moving a number in the stat panel. Finding a helmet should change
    // what your character looks like; that is half of why loot is worth
    // picking up.
    const eq = this.player.equipment;
    if (eq.head) look.helm = eq.head.base;
    if (eq.chest) look.torso = eq.chest.base === 'robe' ? 'robe' : eq.chest.base;

    // The best piece you are wearing tints the metal, so a rare set of plate
    // reads warmer than a common one at a glance, on the character and not
    // just in the bag.
    const RANK = { common: 0, magic: 1, rare: 2, set: 3, unique: 4 };
    const TINTS = {
      magic: hex('#8fa4e8'),
      rare: hex('#e8d089'),
      set: hex('#7fd08f'),
      unique: hex('#d2a068'),
    };
    let best = null;
    for (const slot of ['chest', 'head', 'hands', 'feet']) {
      const it = eq[slot];
      if (it && (!best || RANK[it.rarity] > RANK[best.rarity])) best = it;
    }
    const tint = best && TINTS[best.rarity];
    if (tint) {
      const c = { ...look.colors };
      for (const k of ['metal', 'metalLight', 'metalDark', 'arms', 'armsLight', 'armsDark']) {
        if (c[k]) c[k] = mixc(c[k], tint, k.endsWith('Dark') ? 0.18 : 0.32);
      }
      look.colors = c;
    }

    this.player.look = look;
  }

  equip(item, silent = false) {
    if (!item) return;
    const p = this.player;
    const prev = p.equipment[item.slot];
    p.equipment[item.slot] = item;
    const idx = p.inventory.indexOf(item);
    if (idx >= 0) p.inventory.splice(idx, 1);
    if (prev) p.inventory.push(prev);
    this.recompute();
    if (!silent) {
      audio.play('ui');
      this.logLine(`Angelegt: ${item.name}`);
    }
  }

  unequip(slot) {
    const p = this.player;
    const it = p.equipment[slot];
    if (!it) return;
    p.equipment[slot] = null;
    p.inventory.push(it);
    this.recompute();
    audio.play('ui');
  }

  /** Sells every common item in the bag; the bag fills fast otherwise. */
  sellJunk() {
    const p = this.player;
    let gold = 0;
    let n = 0;
    for (let i = p.inventory.length - 1; i >= 0; i--) {
      const it = p.inventory[i];
      if (it.rarity !== 'common' && it.rarity !== 'magic') continue;
      if (this.isUpgrade(it)) continue;
      gold += it.value;
      n++;
      p.inventory.splice(i, 1);
    }
    if (n) {
      p.gold += gold;
      audio.play('coin');
      this.pushMessage(`Продано вещей: ${n}`, `+${gold} золота`, 1.8);
    }
    return n;
  }

  sellItem(item) {
    const p = this.player;
    const i = p.inventory.indexOf(item);
    if (i < 0) return;
    p.inventory.splice(i, 1);
    p.gold += item.value;
    audio.play('coin');
  }

  isUpgrade(item) {
    const cur = this.player.equipment[item.slot];
    return itemScore(item, this.cls) > itemScore(cur, this.cls);
  }

  gainXp(amount) {
    const p = this.player;
    if (p.level >= MAX_LEVEL) {
      p.gold += Math.round(amount * 0.5);
      return;
    }
    p.xp += amount;
    while (p.level < MAX_LEVEL && p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level++;
      p.statPoints += 1;
      this.recompute();
      p.hp = this.stats.maxLife;
      p.potions = Math.min(p.maxPotions, p.potions + 1);
      audio.play('levelUp');
      this.fx.ring(p.x, p.y, { r0: 10, r1: 220, life: 0.9, color: PAL.holy, width: 9 });
      this.fx.embers(p.x, p.y, 20, 40, PAL.holy, 40);
      // Replace any level text still on screen so a double level-up doesn't
      // print two overlapping banners.
      for (let i = this.fx.texts.length - 1; i >= 0; i--) {
        if (this.fx.texts[i].levelUp) this.fx.texts.splice(i, 1);
      }
      this.fx.text(p.x, p.y, 96, 'УРОВЕНЬ ' + p.level, {
        color: PAL.holy,
        size: 22,
        bold: true,
        life: 1.6,
        vz: 40,
        levelUp: true,
      });
      this.pushMessage('Уровень ' + p.level, this.unlockedSkillName(p.level) || 'Твоя сила растёт', 2.6);
      this.r.addShake(8);
    }
  }

  unlockedSkillName(level) {
    for (const id of this.cls.skills) {
      if (SKILLS[id].unlock === level) return 'Новое умение: ' + SKILLS[id].name;
    }
    return null;
  }

  skillUnlocked(id) {
    return this.player.level >= SKILLS[id].unlock;
  }

  // =========================================================================
  // Monsters
  // =========================================================================

  monsterLevel() {
    const a = this.act.levelRange;
    const t = clamp01(this.kills / Math.max(1, this.killQuota));
    const byAct = lerp(a[0], a[1], t);
    // The act sets the floor, the player's own level the ceiling. Without the
    // cap an under-levelled player meets monsters eight tiers above them.
    // The player's own level is the ceiling and it wins even over the act's
    // floor — falling behind must never mean facing enemies nine tiers up.
    return Math.max(1, Math.round(Math.min(byAct, this.player.level + 3)));
  }

  spawnMonster(defId, x, y, opts = {}) {
    const def = MONSTERS[defId] || BOSSES[defId];
    if (!def) return null;
    const lvl = opts.level ?? this.monsterLevel();
    // Polynomial, not exponential. An exponent here looks fine at level 5 and
    // one-shots the player at level 20.
    const t = lvl - 1;
    const hpScale = (1 + 0.34 * t + 0.013 * t * t) * this.difficulty;
    const dmgScale = (1 + 0.16 * t + 0.0042 * t * t) * this.difficulty;
    const elite = opts.elite && !def.boss;
    const m = {
      def,
      id: defId,
      name: def.name,
      x,
      y,
      z: 0,
      vx: 0,
      vy: 0,
      facing: rnd(0, TAU),
      anim: 'idle',
      animT: 0,
      animDur: 0,
      phase: rnd(0, TAU),
      speed01: 0,
      level: lvl,
      maxHp: Math.round(def.life * hpScale * (elite ? 3.4 : 1) * (def.boss ? 0.42 : 1)),
      hp: 0,
      dmg: def.dmg * dmgScale * (elite ? 1.35 : 1),
      armor: def.armor * (1 + 0.14 * t),
      speed: def.speed * (elite ? 1.1 : 1) * (opts.speedMul ?? 1),
      radius: def.radius * (elite ? 1.22 : 1),
      size: def.size * (elite ? 1.24 : 1),
      xp: Math.round(def.xp * (1 + 0.9 * t) * (elite ? 3.2 : 1)),
      attackCd: 0,
      windup: 0,
      windupMax: 0,
      state: 'idle',
      target: null,
      flash: 0,
      stun: 0,
      slow: 0,
      slowTime: 0,
      root: 0,
      bleed: 0,
      knockX: 0,
      knockY: 0,
      elite,
      boss: !!def.boss,
      look: MOB_LOOKS[def.look],
      alive: true,
      wander: rnd(0, TAU),
      wanderT: 0,
      abilityCd: 2.5,
      abilityIndex: 0,
      lungeT: 0,
      lungeVX: 0,
      lungeVY: 0,
      phaseNum: 1,
      aggro: false,
    };
    m.hp = m.maxHp;
    if (elite) {
      m.name = eliteName(this.rng, def.name);
      m.look = { ...m.look, rim: PAL.amber };
    }
    this.monsters.push(m);
    return m;
  }

  spawnCamp(camp) {
    camp.triggered = true;
    const pool = this.act.monsters;
    for (let i = 0; i < camp.count; i++) {
      const a = (i / camp.count) * TAU + rnd(-0.3, 0.3);
      const d = rnd(30, camp.r * 0.8);
      const x = camp.x + Math.cos(a) * d;
      const y = camp.y + Math.sin(a) * d;
      if (this.zone.blocked(x, y, 24)) continue;
      this.spawnMonster(this.rng.pick(pool), x, y, { elite: camp.elite && i === 0 });
    }
  }

  spawnBoss() {
    const b = BOSSES[this.act.boss];
    const arena = this.zone.bossArena;
    this.bossSpawned = true;
    const range = this.act.levelRange;
    const m = this.spawnMonster(this.act.boss, arena.x, arena.y - 120, {
      level: Math.round(clamp(this.player.level + 1, range[0], range[1])),
    });
    // A full flask belt: the fight should be decided by play, not by supply.
    this.player.potions = this.player.maxPotions;
    m.aggro = true;
    this.boss = m;
    audio.play('bossRoar');
    this.r.addShake(26);
    this.fx.ring(m.x, m.y, { r0: 20, r1: 460, life: 1.4, color: b.light?.color || PAL.blood, width: 14 });
    this.fx.shards(m.x, m.y, 40, 40, b.light?.color || PAL.blood, 420);
    this.pushMessage(b.name, b.title, 4.5);
    this.logLine(`${b.name} erhebt sich.`);
  }

  // =========================================================================
  // Combat
  // =========================================================================

  playerAttackRoll(coef) {
    const s = this.stats;
    const base = rnd(s.weaponMin, s.weaponMax) * s.damageMult * coef;
    const crit = Math.random() < s.critChanceTotal;
    return { dmg: base * (crit ? s.critDmgTotal : 1), crit };
  }

  damageMonster(m, amount, opts = {}) {
    if (!m.alive) return 0;
    const mit = mitigation(m.armor, this.player.level);
    let dmg = amount * (1 - mit);
    if (m.stun > 0) dmg *= 1.15;
    dmg = Math.max(1, dmg);
    m.hp -= dmg;
    m.flash = 1;
    m.aggro = true;

    const s = this.stats;
    if (s.lifeOnHit > 0 && !opts.noLeech) {
      this.player.hp = Math.min(this.stats.maxLife, this.player.hp + s.lifeOnHit);
    }
    if (this.cls.resource.onHit && !opts.noResource) {
      this.player.resource = Math.min(
        this.stats.maxResource,
        this.player.resource + this.cls.resource.onHit
      );
    }

    const col = opts.crit ? [255, 214, 120] : [246, 240, 228];
    this.fx.damage(m, m.x + rnd(-6, 6), m.y, m.size * 0.7 + rnd(0, 14), dmg, {
      color: col,
      size: opts.crit ? 21 : 15,
      crit: opts.crit,
      life: opts.crit ? 1.15 : 0.85,
    });

    if (opts.knock) {
      const a = opts.angle ?? Math.atan2(m.y - this.player.y, m.x - this.player.x);
      const kb = opts.knock * (m.boss ? 0.12 : m.elite ? 0.5 : 1);
      m.knockX += Math.cos(a) * kb;
      m.knockY += Math.sin(a) * kb;
    }
    if (opts.stun && !m.boss) m.stun = Math.max(m.stun, opts.stun);
    if (opts.slow) {
      m.slow = Math.max(m.slow, opts.slow);
      m.slowTime = Math.max(m.slowTime, opts.slowTime || 2);
    }
    if (opts.root && !m.boss) m.root = Math.max(m.root, opts.root);

    const ang = opts.angle ?? Math.atan2(m.y - this.player.y, m.x - this.player.x);
    this.fx.blood(m.x, m.y, m.size * 0.5, Math.cos(ang), Math.sin(ang), opts.crit ? 18 : 9, opts.bloodColor || PAL.blood);
    if (opts.sparkColor) this.fx.sparks(m.x, m.y, m.size * 0.5, Math.cos(ang), Math.sin(ang), 8, opts.sparkColor);
    // A hot flash exactly where the blow landed.
    this.fx.spawn({
      kind: 'ember',
      x: m.x - Math.cos(ang) * m.radius * 0.6,
      y: m.y - Math.sin(ang) * m.radius * 0.6,
      z: m.size * 0.5,
      vx: 0,
      vy: 0,
      vz: 0,
      life: opts.crit ? 0.2 : 0.12,
      maxLife: opts.crit ? 0.2 : 0.12,
      size: opts.crit ? 13 : 8,
      color: opts.crit ? [255, 226, 170] : [255, 244, 226],
      grav: 0,
      drag: 0,
      glow: true,
    });

    audio.play(opts.crit ? 'crit' : m.def.hitSound || 'hitFlesh');
    this.hitStop = Math.max(this.hitStop, opts.crit ? 0.075 : 0.038);
    this.r.addShake(opts.crit ? 6 : 2.4);

    // Unique item powers.
    if (this.stats.powers.includes('chainLightning') && !opts.chained && Math.random() < 0.28) {
      this.chainLightning(m, dmg * 0.42);
    }
    if (opts.crit && this.stats.powers.includes('bleed')) {
      m.bleed = Math.max(m.bleed, 3);
      m.bleedDmg = dmg * 0.16;
    }

    if (m.hp <= 0) this.killMonster(m, ang);
    return dmg;
  }

  chainLightning(from, dmg) {
    let hops = 0;
    let src = from;
    for (const m of this.monsters) {
      if (hops >= 2) break;
      if (m === from || !m.alive) continue;
      if (dist2(src.x, src.y, m.x, m.y) > 260 * 260) continue;
      this.fx.beam(src.x, src.y, m.x, m.y, {
        z0: src.size * 0.5,
        z1: m.size * 0.5,
        color: PAL.thunder,
        width: 4,
        jagged: true,
        life: 0.2,
      });
      this.damageMonster(m, dmg, { chained: true, noLeech: true, sparkColor: PAL.thunder });
      src = m;
      hops++;
    }
  }

  killMonster(m, ang = 0) {
    if (!m.alive) return;
    m.alive = false;
    m.anim = 'die';
    m.animT = 0;
    m.deathT = 0;
    this.corpses.push(m);
    const i = this.monsters.indexOf(m);
    if (i >= 0) this.monsters.splice(i, 1);

    this.kills++;
    this.player.kills++;
    this.player.totalKills++;
    this.gainXp(m.xp);
    audio.play('monsterDie');
    this.fx.blood(m.x, m.y, m.size * 0.4, Math.cos(ang), Math.sin(ang), 22);
    this.r.addDecal(
      this.bloodDecals[rndInt(0, 3)],
      m.x + rnd(-8, 8),
      m.y + rnd(-6, 6),
      (m.size / 70) * rnd(0.8, 1.3),
      0.85,
      rnd(0, TAU),
      Infinity
    );

    if (this.stats.powers.includes('amberBurst')) {
      this.fx.shards(m.x, m.y, m.size * 0.4, 10, PAL.amber, 300);
      for (const o of this.monsters) {
        if (dist2(o.x, o.y, m.x, m.y) < 150 * 150) {
          this.damageMonster(o, this.stats.weaponMax * this.stats.damageMult * 0.4, { noLeech: true });
        }
      }
    }

    // Loot
    const ilvl = m.level;
    const gold = Math.round(rnd(4, 12) * ilvl * (m.boss ? 22 : m.elite ? 5 : 1) * (1 + this.stats.goldFind));
    this.dropGold(m.x, m.y, gold);
    const items = rollDrop(this.rng, {
      ilvl,
      luck: 1,
      boss: m.boss,
      elite: m.elite,
      chance: 0.15,
    });
    for (const it of items) this.dropItem(m.x + rnd(-30, 30), m.y + rnd(-24, 24), it);

    if (m.boss) {
      this.bossDead = true;
      this.boss = null;
      this.r.addShake(30);
      this.fx.ring(m.x, m.y, { r0: 20, r1: 520, life: 1.6, color: PAL.holy, width: 16 });
      audio.play('legendary');
      this.onBossDefeated(m);
    }
  }

  onBossDefeated(m) {
    const last = this.actIndex >= ACTS.length - 1;
    this.pushMessage(
      last && !this.endless ? 'Перкунас пал' : m.name + ' повержен',
      last && !this.endless ? 'Роща молчит.' : 'Открывается путь.',
      4
    );
    this.portal = {
      x: m.x,
      y: m.y + 90,
      t: 0,
      last: last && !this.endless,
    };
    audio.play('portal');
    this.logLine(`${m.name} besiegt.`);
    this.save();
  }

  dropGold(x, y, amount) {
    if (amount <= 0) return;
    this.drops.push({
      kind: 'gold',
      amount,
      x: x + rnd(-16, 16),
      y: y + rnd(-12, 12),
      z: 30,
      vz: rnd(90, 170),
      vx: rnd(-70, 70),
      vy: rnd(-50, 50),
      age: 0,
      picked: false,
    });
  }

  dropItem(x, y, item) {
    this.drops.push({
      kind: 'item',
      item,
      x,
      y,
      z: 40,
      vz: rnd(110, 190),
      vx: rnd(-90, 90),
      vy: rnd(-60, 60),
      age: 0,
      picked: false,
    });
    if (item.rarity === 'unique') audio.play('legendary');
    else if (item.rarity === 'rare') audio.play('loot');
  }

  damagePlayer(amount, source) {
    const p = this.player;
    if (!p.alive || p.invuln > 0) return;
    const s = this.stats;
    let dmg = amount * (1 - mitigation(s.armorTotal, source ? source.level : p.level));

    if (p.buffs.ward && p.buffs.ward.t > 0) {
      const absorbed = dmg * (p.buffs.ward.absorb || 0.5);
      dmg -= absorbed;
      if (source) {
        this.damageMonster(source, absorbed * (p.buffs.ward.reflect || 0.5), {
          noLeech: true,
          sparkColor: PAL.amber,
        });
      }
    }
    if (s.powers.includes('bulwark') && p.hp / s.maxLife < 0.35) dmg *= 0.5;

    dmg = Math.max(1, dmg);
    p.hp -= dmg;
    p.flash = 1;
    p.invuln = 0.24;
    this.r.addShake(Math.min(16, 3 + dmg * 0.12));
    this.hitStop = Math.max(this.hitStop, 0.05);
    audio.play('hurt');
    this.fx.text(p.x, p.y, 90, '-' + Math.round(dmg), { color: [255, 110, 96], size: 15 });
    this.fx.blood(p.x, p.y, 40, rnd(-1, 1), rnd(-1, 1), 8);

    if (s.thorns > 0 && source) {
      this.damageMonster(source, s.thorns, { noLeech: true, noResource: true });
    }
    if (s.powers.includes('frostNova') && Math.random() < 0.3) {
      this.fx.ring(p.x, p.y, { r0: 10, r1: 180, life: 0.5, color: PAL.frost, width: 7 });
      for (const m of this.monsters) {
        if (dist2(m.x, m.y, p.x, p.y) < 180 * 180) {
          this.damageMonster(m, s.weaponMax * s.damageMult * 0.5, { slow: 0.6, slowTime: 3, noLeech: true });
        }
      }
    }
    if (this.cls.resource.onTakeHit) {
      p.resource = Math.min(s.maxResource, p.resource + this.cls.resource.onTakeHit);
    }

    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.anim = 'die';
      p.animT = 0;
      this.state = 'dead';
      audio.play('death');
      this.r.addShake(20);
      this.logLine('Ты пал.');
    }
  }

  // =========================================================================
  // Skills
  // =========================================================================

  aimAngle() {
    // Aim at the nearest monster in front, otherwise the movement direction.
    const p = this.player;
    let best = null;
    let bestScore = Infinity;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = dist(p.x, p.y, m.x, m.y);
      if (d > 560) continue;
      const a = Math.atan2(m.y - p.y, m.x - p.x);
      const off = Math.abs(angleDelta(p.facing, a));
      const score = d * (1 + off * 0.85);
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
    if (best) return Math.atan2(best.y - p.y, best.x - p.x);
    return p.facing;
  }

  aimPoint(range) {
    const p = this.player;
    let best = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = dist(p.x, p.y, m.x, m.y);
      if (d < bestD && d < range * 1.15) {
        bestD = d;
        best = m;
      }
    }
    if (best) return { x: best.x, y: best.y };
    const a = p.facing;
    return { x: p.x + Math.cos(a) * range * 0.7, y: p.y + Math.sin(a) * range * 0.7 };
  }

  canUse(id) {
    const sk = SKILLS[id];
    const p = this.player;
    if (!this.skillUnlocked(id)) return false;
    if ((p.cds[id] || 0) > 0) return false;
    if (sk.cost > p.resource) return false;
    if (p.anim === 'dash' || p.anim === 'die') return false;
    if (p.animDur > 0 && p.anim !== 'idle' && sk.kind !== 'channel') return false;
    return true;
  }

  useSkill(id) {
    const sk = SKILLS[id];
    const p = this.player;
    if (!this.canUse(id)) return false;
    p.resource -= sk.cost;
    p.cds[id] = sk.cd;
    const ang = this.aimAngle();
    p.facing = ang;

    const speedMul = this.stats.attackSpeedMult;

    switch (sk.kind) {
      case 'melee': {
        p.attackChain = 1 - p.attackChain;
        this.setAnim(p, p.attackChain ? 'attack' : 'attack2', 0.52 / speedMul);
        p.pendingHit = { skill: id, at: sk.windup / speedMul, angle: ang };
        audio.play('swing');
        break;
      }
      case 'projectile': {
        this.setAnim(p, sk.anim, 0.42 / speedMul);
        p.pendingHit = { skill: id, at: sk.windup / speedMul, angle: ang };
        audio.play(sk.glow ? 'cast' : 'swing');
        break;
      }
      case 'dashAttack': {
        this.setAnim(p, 'dash', sk.dashTime);
        p.dashT = sk.dashTime;
        p.dashSkill = id;
        p.dashVX = Math.cos(ang) * (sk.dashDist / sk.dashTime);
        p.dashVY = Math.sin(ang) * (sk.dashDist / sk.dashTime);
        p.dashHits = new Set();
        p.invuln = Math.max(p.invuln, sk.dashTime * 0.8);
        audio.play('dash');
        break;
      }
      case 'ground': {
        this.setAnim(p, 'cast', 0.5);
        const pt = { x: p.x, y: p.y };
        this.ground.push({
          kind: 'consecrate',
          x: pt.x,
          y: pt.y,
          r: sk.radius,
          life: sk.duration,
          age: 0,
          tick: 0,
          tickRate: sk.tick,
          coef: sk.coef,
          heal: sk.heal,
          color: sk.color,
          owner: 'player',
        });
        audio.play('holy');
        this.fx.ring(pt.x, pt.y, { r0: 10, r1: sk.radius, life: 0.6, color: sk.color, width: 8 });
        break;
      }
      case 'channel': {
        p.channel = { id, t: 0 };
        this.setAnim(p, 'attack', 0.4 / speedMul);
        break;
      }
      case 'cone': {
        this.setAnim(p, 'cast', 0.5);
        audio.play('frost');
        const hit = [];
        for (const m of this.monsters) {
          if (inCone(p.x, p.y, ang, sk.arc, sk.range, m.x, m.y, m.radius)) hit.push(m);
        }
        for (const m of hit) {
          const roll = this.playerAttackRoll(sk.coef);
          this.damageMonster(m, roll.dmg, {
            crit: roll.crit,
            slow: sk.slow,
            slowTime: sk.slowTime,
            sparkColor: sk.color,
            bloodColor: PAL.frost,
            angle: ang,
          });
        }
        for (let i = 0; i < 34; i++) {
          const a = ang + rnd(-sk.arc, sk.arc);
          const d = rnd(20, sk.range);
          this.fx.spawn({
            kind: 'spark',
            x: p.x + Math.cos(a) * d,
            y: p.y + Math.sin(a) * d,
            z: rnd(10, 60),
            vx: Math.cos(a) * rnd(120, 320),
            vy: Math.sin(a) * rnd(120, 320) * 0.6,
            vz: rnd(-10, 40),
            life: rnd(0.25, 0.6),
            maxLife: 0.6,
            size: rnd(2, 5),
            color: PAL.frost,
            grav: 60,
            drag: 2,
            glow: true,
          });
        }
        break;
      }
      case 'strike': {
        this.setAnim(p, 'cast', 0.45);
        const pt = this.aimPoint(420);
        audio.play('cast');
        this.ground.push({
          kind: 'telegraph',
          x: pt.x,
          y: pt.y,
          r: sk.radius,
          life: sk.delay,
          age: 0,
          color: sk.color,
          onEnd: () => {
            audio.play('thunder');
            this.r.addShake(14);
            this.fx.beam(pt.x, pt.y - 10, pt.x, pt.y, {
              z0: 900,
              z1: 0,
              color: sk.color,
              width: 14,
              jagged: true,
              life: 0.28,
            });
            this.fx.ring(pt.x, pt.y, { r0: 12, r1: sk.radius * 1.3, life: 0.5, color: sk.color, width: 9 });
            this.fx.sparks(pt.x, pt.y, 6, 0, -1, 26, sk.color, 460);
            for (const m of this.monsters) {
              if (dist2(m.x, m.y, pt.x, pt.y) < sk.radius * sk.radius) {
                const roll = this.playerAttackRoll(sk.coef);
                this.damageMonster(m, roll.dmg, {
                  crit: roll.crit,
                  sparkColor: sk.color,
                  knock: 120,
                  angle: Math.atan2(m.y - pt.y, m.x - pt.x),
                });
              }
            }
          },
        });
        break;
      }
      case 'trap': {
        this.setAnim(p, 'cast', 0.4);
        const a = p.facing;
        this.ground.push({
          kind: 'trap',
          x: p.x + Math.cos(a) * 90,
          y: p.y + Math.sin(a) * 90,
          r: sk.radius,
          life: sk.duration,
          age: 0,
          armed: true,
          coef: sk.coef,
          root: sk.root,
          color: sk.color,
        });
        audio.play('ui');
        break;
      }
      case 'rain': {
        this.setAnim(p, 'cast', 0.5);
        const pt = this.aimPoint(460);
        this.ground.push({
          kind: 'rain',
          x: pt.x,
          y: pt.y,
          r: sk.radius,
          life: sk.duration,
          age: 0,
          tick: 0,
          tickRate: sk.tick,
          coef: sk.coef,
          color: sk.color,
        });
        audio.play('cast');
        break;
      }
      case 'blink': {
        const a = ang;
        const tx = p.x + Math.cos(a) * sk.dist;
        const ty = p.y + Math.sin(a) * sk.dist;
        this.fx.ring(p.x, p.y, { r0: 6, r1: 90, life: 0.35, color: sk.color, width: 5 });
        this.fx.smoke(p.x, p.y, 20, 10, [60, 120, 100], 18);
        const [nx, ny] = this.zone.resolve(tx, ty, p.radius);
        p.x = nx;
        p.y = ny;
        p.invuln = Math.max(p.invuln, 0.35);
        this.fx.ring(p.x, p.y, { r0: 6, r1: 110, life: 0.4, color: sk.color, width: 6 });
        audio.play('dash');
        // Volley outward
        for (let i = 0; i < sk.volley; i++) {
          const va = a + (i - (sk.volley - 1) / 2) * 0.22;
          this.fireProjectile({
            x: p.x,
            y: p.y,
            z: 42,
            angle: va,
            speed: 820,
            range: 520,
            coef: sk.coef,
            color: sk.color,
            radius: 11,
            pierce: 1,
            kind: 'arrow',
          });
        }
        break;
      }
      case 'ward': {
        this.setAnim(p, 'cast', 0.5);
        p.buffs.ward = { t: sk.duration, absorb: sk.absorb, reflect: sk.reflect };
        this.fx.ring(p.x, p.y, { r0: 10, r1: 90, life: 0.6, color: sk.color, width: 8 });
        audio.play('holy');
        break;
      }
    }
    return true;
  }

  /** Fires the actual damage of a wind-up skill when its windup elapses. */
  resolvePendingHit() {
    const p = this.player;
    const ph = p.pendingHit;
    if (!ph) return;
    p.pendingHit = null;
    const sk = SKILLS[ph.skill];
    const ang = ph.angle;

    if (sk.kind === 'melee') {
      let any = false;
      for (const m of this.monsters) {
        if (!m.alive) continue;
        if (inCone(p.x, p.y, ang, sk.arc / 2, sk.range + m.radius, m.x, m.y, m.radius)) {
          const roll = this.playerAttackRoll(sk.coef);
          this.damageMonster(m, roll.dmg, {
            crit: roll.crit,
            knock: sk.knock,
            angle: Math.atan2(m.y - p.y, m.x - p.x),
          });
          any = true;
        }
      }
      // The crescent the blade cut through the air.
      this.fx.slash(p.x, p.y, 44, ang, sk.range * 0.92, {
        arc: sk.arc,
        dir: p.attackChain ? 1 : -1,
        color: sk.color,
        life: 0.26,
        thickness: 0.34,
      });
      if (!any) audio.play('swing', { vol: 0.6 });
    } else if (sk.kind === 'projectile') {
      const n = sk.count || 1;
      for (let i = 0; i < n; i++) {
        const a = ang + (n > 1 ? (i - (n - 1) / 2) * (sk.spread || 0.2) : 0);
        this.fireProjectile({
          x: p.x,
          y: p.y,
          z: 46,
          angle: a,
          speed: sk.speed,
          range: sk.range,
          coef: sk.coef,
          color: sk.color,
          radius: sk.radius,
          pierce: sk.pierce || 0,
          glow: sk.glow,
          kind: sk.glow ? 'shard' : 'arrow',
        });
      }
    }
  }

  fireProjectile(o) {
    this.projectiles.push({
      x: o.x,
      y: o.y,
      z: o.z ?? 40,
      vx: Math.cos(o.angle) * o.speed,
      vy: Math.sin(o.angle) * o.speed,
      angle: o.angle,
      travelled: 0,
      range: o.range,
      coef: o.coef,
      color: o.color,
      radius: o.radius ?? 10,
      pierce: o.pierce ?? 0,
      hit: new Set(),
      glow: o.glow,
      kind: o.kind || 'arrow',
      hostile: !!o.hostile,
      dmg: o.dmg,
      owner: o.owner,
      life: o.life ?? 4,
    });
  }

  setAnim(e, anim, dur) {
    e.anim = anim;
    e.animT = 0;
    e.animDur = dur;
  }

  // =========================================================================
  // Update
  // =========================================================================

  update(dt) {
    if (this.state !== 'playing') {
      // Still animate the death pose and the world behind the overlay.
      this.time += dt;
      this.updateVisualOnly(dt);
      return;
    }
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.12;
    }
    this.time += dt;

    this.updatePlayer(dt);
    this.updateMonsters(dt);
    this.updateProjectiles(dt);
    this.updateGround(dt);
    this.updateDrops(dt);
    this.updateCorpses(dt);
    this.updateActFlow(dt);
    this.fx.update(dt);

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      m.age += dt;
      if (m.age > m.life) this.messages.splice(i, 1);
    }

    // Tension drives the music.
    let near = 0;
    for (const m of this.monsters) {
      if (!m.aggro) continue;
      const d = dist2(m.x, m.y, this.player.x, this.player.y);
      if (d < 700 * 700) near += m.boss ? 6 : m.elite ? 2 : 1;
    }
    this.tension = clamp01(near / 7) * (this.boss ? 1 : 0.85);
    if (this.boss) this.tension = 1;
  }

  updateVisualOnly(dt) {
    this.fx.update(dt);
    const p = this.player;
    if (!p) return;
    this.updateCorpses(dt);
    if (p.anim === 'die') {
      p.animT = Math.min(1, p.animT + dt * 1.6);
    }
    for (const m of this.messages) m.age += dt;
  }

  updatePlayer(dt) {
    const p = this.player;
    const inp = this.input;
    if (!p.alive) return;

    p.invuln = Math.max(0, p.invuln - dt);
    p.flash = Math.max(0, p.flash - dt * 6);
    p.potionCd = Math.max(0, p.potionCd - dt);
    for (const k in p.cds) p.cds[k] = Math.max(0, p.cds[k] - dt);
    for (const k in p.buffs) {
      const b = p.buffs[k];
      b.t -= dt;
      if (b.t <= 0) delete p.buffs[k];
    }

    // Resource
    const res = this.cls.resource;
    const regen = res.regen + this.stats.resourceRegen;
    p.resource = clamp(p.resource + regen * dt, 0, this.stats.maxResource);

    // Animation clock
    if (p.animDur > 0) {
      p.animT += dt / p.animDur;
      if (p.pendingHit && p.animT >= p.pendingHit.at / p.animDur) this.resolvePendingHit();
      if (p.animT >= 1) {
        p.animT = 0;
        p.animDur = 0;
        p.anim = 'idle';
        if (p.pendingHit) this.resolvePendingHit();
      }
    }

    // Dash movement
    if (p.dashT > 0) {
      p.dashT -= dt;
      const [nx, ny] = this.zone.resolve(p.x + p.dashVX * dt, p.y + p.dashVY * dt, p.radius);
      p.x = nx;
      p.y = ny;
      this.fx.smoke(p.x, p.y, 8, 2, [120, 120, 130], 10);
      if (p.dashSkill) {
        const sk = SKILLS[p.dashSkill];
        for (const m of this.monsters) {
          if (!m.alive || p.dashHits.has(m)) continue;
          if (dist2(m.x, m.y, p.x, p.y) < (sk.radius + m.radius) * (sk.radius + m.radius)) {
            p.dashHits.add(m);
            const roll = this.playerAttackRoll(sk.coef);
            this.damageMonster(m, roll.dmg, {
              crit: roll.crit,
              knock: sk.knock,
              stun: sk.stun,
              angle: Math.atan2(m.y - p.y, m.x - p.x),
              sparkColor: PAL.steelLight,
            });
          }
        }
      }
      if (p.dashT <= 0) {
        p.dashSkill = null;
        p.anim = 'idle';
        p.animDur = 0;
      }
      p.speed01 = 1;
      p.phase += dt * 12;
      return;
    }

    // Movement
    inp.update();
    const mv = inp.move;
    const busy = p.animDur > 0 && (p.anim === 'attack' || p.anim === 'attack2' || p.anim === 'thrust');
    const slowFactor = busy ? 0.4 : 1;
    const spd = this.stats.moveSpeedTotal * slowFactor;
    if (mv.mag > 0.05) {
      // Screen-space input mapped into the squashed world.
      const wx = mv.x;
      const wy = mv.y / ISO_Y;
      const l = Math.hypot(wx, wy) || 1;
      const dx = (wx / l) * spd * mv.mag;
      const dy = (wy / l) * spd * mv.mag;
      p.vx = damp(p.vx, dx, 16, dt);
      p.vy = damp(p.vy, dy, 16, dt);
      if (!busy) p.facing = angleTowards(p.facing, Math.atan2(dy, dx), dt * 16);
    } else {
      p.vx = damp(p.vx, 0, 18, dt);
      p.vy = damp(p.vy, 0, 18, dt);
    }
    const [nx, ny] = this.zone.resolve(p.x + p.vx * dt, p.y + p.vy * dt, p.radius);
    p.x = nx;
    p.y = ny;

    const sp = Math.hypot(p.vx, p.vy) / this.stats.moveSpeedTotal;
    p.speed01 = clamp01(sp);
    p.phase += dt * (5 + p.speed01 * 8);
    if (p.speed01 > 0.35) audio.play('step', { vol: 0.5 });

    // Channelled skill (whirlwind)
    if (p.channel) {
      const sk = SKILLS[p.channel.id];
      if (!inp.isDown('skill' + (this.cls.skills.indexOf(p.channel.id) + 1)) || p.resource <= 0) {
        p.channel = null;
        p.anim = 'idle';
        p.animDur = 0;
      } else {
        p.channel.t += dt;
        p.resource = Math.max(0, p.resource - sk.costPerSec * dt);
        p.facing += dt * 14;
        p.animT = (p.animT + dt * 3) % 1;
        p.anim = 'attack';
        p.animDur = 1;
        if (!p.channel.tick) p.channel.tick = 0;
        p.channel.tick -= dt;
        if (p.channel.tick <= 0) {
          p.channel.tick = sk.tick;
          audio.play('swing', { vol: 0.5 });
          this.fx.ring(p.x, p.y, { r0: sk.radius * 0.6, r1: sk.radius, life: 0.2, color: sk.color, width: 4 });
          for (const m of this.monsters) {
            if (!m.alive) continue;
            if (dist2(m.x, m.y, p.x, p.y) < (sk.radius + m.radius) ** 2) {
              const roll = this.playerAttackRoll(sk.coef);
              this.damageMonster(m, roll.dmg, {
                crit: roll.crit,
                knock: sk.knock,
                angle: Math.atan2(m.y - p.y, m.x - p.x),
              });
            }
          }
        }
      }
    }

    // Skill buttons
    const skills = this.cls.skills;
    for (let i = 0; i < skills.length; i++) {
      const id = skills[i];
      const btn = 'skill' + (i + 1);
      const sk = SKILLS[id];
      const held = inp.isDown(btn);
      const pressed = inp.wasPressed(btn);
      if (sk.kind === 'channel') {
        if (pressed && this.canUse(id)) this.useSkill(id);
      } else if (i === 0 ? held : pressed) {
        this.useSkill(id);
      }
    }
    if (inp.isDown('attack')) this.useSkill(skills[0]);

    // Potion
    if (inp.wasPressed('potion')) this.drinkPotion();

    // Pick up loot by walking over it, and by tapping it.
    if (inp.tap) {
      const w = this.r.toWorld(inp.tap.x, inp.tap.y);
      for (const d of this.drops) {
        if (d.picked) continue;
        if (dist2(d.x, d.y, w.x, w.y) < 70 * 70 && dist2(d.x, d.y, p.x, p.y) < 340 * 340) {
          this.pickup(d);
          break;
        }
      }
    }
  }

  drinkPotion() {
    const p = this.player;
    if (p.potions <= 0 || p.potionCd > 0 || !p.alive) return;
    if (p.hp >= this.stats.maxLife) return;
    p.potions--;
    p.potionCd = POTION_CD;
    const heal = this.stats.maxLife * POTION_HEAL;
    p.hp = Math.min(this.stats.maxLife, p.hp + heal);
    audio.play('potion');
    this.fx.text(p.x, p.y, 96, '+' + Math.round(heal), { color: [120, 240, 150], size: 16 });
    this.fx.ring(p.x, p.y, { r0: 8, r1: 70, life: 0.5, color: hex('#4ad27a'), width: 5 });
  }

  pickup(d) {
    if (d.picked) return;
    d.picked = true;
    if (d.kind === 'gold') {
      this.player.gold += d.amount;
      audio.play('coin');
    } else {
      // A full bag melts its least valuable piece rather than refusing loot.
      if (this.player.inventory.length >= BAG_SIZE) {
        let worst = null;
        for (const it of this.player.inventory) if (!worst || it.value < worst.value) worst = it;
        if (worst && worst.value < d.item.value) {
          this.sellItem(worst);
          this.fx.text(this.player.x, this.player.y, 104, `Сума полна — ${worst.name} продан`, {
            color: [200, 176, 120],
            size: 11,
            life: 1.8,
          });
        } else {
          this.player.gold += d.item.value;
          this.fx.text(d.x, d.y, 40, `Сума полна — ${d.item.value} золота`, {
            color: PAL.gold,
            size: 11,
            life: 1.5,
          });
          audio.play('coin');
          return;
        }
      }
      this.player.inventory.push(d.item);
      audio.play(d.item.rarity === 'unique' ? 'legendary' : 'loot');
      this.fx.text(d.x, d.y, 40, d.item.name, {
        color: this.rarityColor(d.item.rarity),
        size: 12,
        life: 1.6,
        vz: 46,
      });
      if (this.isUpgrade(d.item) && this.player.inventory.length < 40) {
        this.equip(d.item, true);
        this.fx.text(this.player.x, this.player.y, 110, 'Надето лучшее', {
          color: [180, 220, 255],
          size: 12,
          life: 1.6,
        });
      }
    }
  }

  rarityColor(r) {
    return PAL.rarity[r] || PAL.rarity.common;
  }

  updateMonsters(dt) {
    const p = this.player;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      m.flash = Math.max(0, m.flash - dt * 5);
      m.stun = Math.max(0, m.stun - dt);
      m.root = Math.max(0, m.root - dt);
      m.slowTime = Math.max(0, m.slowTime - dt);
      if (m.slowTime <= 0) m.slow = 0;
      if (m.bleed > 0) {
        m.bleed -= dt;
        m.bleedTick = (m.bleedTick || 0) - dt;
        if (m.bleedTick <= 0) {
          m.bleedTick = 0.5;
          this.damageMonster(m, m.bleedDmg || 2, { noLeech: true });
          if (!m.alive) continue;
        }
      }

      const d = dist(m.x, m.y, p.x, p.y);
      if (!m.aggro && d < (m.boss ? 900 : 560)) {
        m.aggro = true;
        if (m.def.sound && Math.random() < 0.3) audio.play(m.def.sound);
      }

      // Knockback decay
      m.x += m.knockX * dt;
      m.y += m.knockY * dt;
      m.knockX = damp(m.knockX, 0, 9, dt);
      m.knockY = damp(m.knockY, 0, 9, dt);

      if (m.animDur > 0) {
        m.animT += dt / m.animDur;
        if (m.animT >= 1) {
          m.animT = 0;
          m.animDur = 0;
          m.anim = 'idle';
        }
      }

      if (m.stun > 0) {
        m.speed01 = 0;
        m.anim = 'hit';
        m.animT = clamp01(1 - m.stun / 1.5);
        continue;
      }

      m.attackCd = Math.max(0, m.attackCd - dt);
      if (m.boss) m.abilityCd = Math.max(0, m.abilityCd - dt);

      // Wind-up resolution
      if (m.windup > 0) {
        m.windup -= dt;
        if (m.windup <= 0) this.monsterStrike(m);
        m.speed01 = 0;
        continue;
      }

      if (m.lungeT > 0) {
        m.lungeT -= dt;
        const [lx, ly] = this.zone.resolve(m.x + m.lungeVX * dt, m.y + m.lungeVY * dt, m.radius);
        m.x = lx;
        m.y = ly;
        m.speed01 = 1;
        m.phase += dt * 14;
        if (d < m.radius + p.radius + 14) {
          this.damagePlayer(m.dmg * 1.2, m);
          m.lungeT = 0;
        }
        continue;
      }

      let mvx = 0;
      let mvy = 0;
      const ai = m.def.ai;
      const spd = m.speed * (1 - m.slow) * (m.root > 0 ? 0 : 1);

      if (!m.aggro) {
        // Idle wander
        m.wanderT -= dt;
        if (m.wanderT <= 0) {
          m.wanderT = rnd(1.5, 4);
          m.wander = rnd(0, TAU);
          if (chance(0.4)) m.wander = null;
        }
        if (m.wander !== null) {
          mvx = Math.cos(m.wander) * spd * 0.28;
          mvy = Math.sin(m.wander) * spd * 0.28;
        }
      } else if (m.boss) {
        this.bossAI(m, dt, d);
        continue;
      } else if (ai === 'ranged' || ai === 'caster') {
        const want = m.def.attackRange * 0.72;
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        if (d > want * 1.15) {
          mvx = Math.cos(a) * spd;
          mvy = Math.sin(a) * spd;
        } else if (d < want * 0.62) {
          mvx = -Math.cos(a) * spd * 0.9;
          mvy = -Math.sin(a) * spd * 0.9;
        } else {
          // Strafe so they don't stand still like targets.
          mvx = Math.cos(a + Math.PI / 2) * spd * 0.5 * Math.sign(Math.sin(m.phase));
          mvy = Math.sin(a + Math.PI / 2) * spd * 0.5 * Math.sign(Math.sin(m.phase));
        }
        m.facing = angleTowards(m.facing, a, dt * 6);
        if (d < m.def.attackRange && m.attackCd <= 0) this.beginAttack(m);
      } else if (ai === 'charger') {
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        m.facing = angleTowards(m.facing, a, dt * 7);
        if (d > 300) {
          mvx = Math.cos(a) * spd;
          mvy = Math.sin(a) * spd;
        } else if (d > m.def.attackRange && m.attackCd <= 0) {
          // Circle, then lunge.
          const side = Math.sign(Math.sin(m.phase * 0.7 + m.wander));
          mvx = Math.cos(a) * spd * 0.7 + Math.cos(a + (Math.PI / 2) * side) * spd * 0.6;
          mvy = Math.sin(a) * spd * 0.7 + Math.sin(a + (Math.PI / 2) * side) * spd * 0.6;
          if (d < 220 && chance(dt * 1.4)) this.beginAttack(m);
        } else if (m.attackCd <= 0) {
          this.beginAttack(m);
        } else {
          mvx = -Math.cos(a) * spd * 0.5;
          mvy = -Math.sin(a) * spd * 0.5;
        }
      } else {
        // melee / swarm
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        m.facing = angleTowards(m.facing, a, dt * 8);
        if (d > m.def.attackRange * 0.85) {
          mvx = Math.cos(a) * spd;
          mvy = Math.sin(a) * spd;
          // Spread out so they don't stack into one pixel.
          for (const o of this.monsters) {
            if (o === m || !o.alive) continue;
            const dd = dist2(o.x, o.y, m.x, m.y);
            const rr = (o.radius + m.radius) * 1.15;
            if (dd < rr * rr && dd > 1) {
              const dl = Math.sqrt(dd);
              mvx += ((m.x - o.x) / dl) * spd * 0.55;
              mvy += ((m.y - o.y) / dl) * spd * 0.55;
            }
          }
        } else if (m.attackCd <= 0) {
          this.beginAttack(m);
        }
      }

      if (mvx || mvy) {
        const [mx, my] = this.zone.resolve(m.x + mvx * dt, m.y + mvy * dt, m.radius);
        m.x = mx;
        m.y = my;
        m.speed01 = clamp01(Math.hypot(mvx, mvy) / m.speed);
        m.phase += dt * (4 + m.speed01 * 9);
        if (m.anim === 'idle') m.facing = angleTowards(m.facing, Math.atan2(mvy, mvx), dt * 8);
      } else {
        m.speed01 = damp(m.speed01, 0, 10, dt);
      }
    }
  }

  beginAttack(m) {
    m.windup = m.def.windup;
    m.windupMax = m.def.windup;
    m.attackCd = m.def.attackCd * rnd(0.85, 1.2);
    this.setAnim(m, 'attack', m.def.windup + 0.35);
    const p = this.player;
    m.facing = Math.atan2(p.y - m.y, p.x - m.x);
    if (m.def.ai === 'charger' && m.def.lunge) {
      m.pendingLunge = true;
    }
  }

  monsterStrike(m) {
    const p = this.player;
    const d = dist(m.x, m.y, p.x, p.y);
    const def = m.def;
    if (def.ai === 'ranged') {
      this.fireProjectile({
        x: m.x,
        y: m.y,
        z: m.size * 0.55,
        angle: Math.atan2(p.y - m.y, p.x - m.x),
        speed: def.projSpeed || 560,
        range: def.attackRange * 1.4,
        coef: 1,
        dmg: m.dmg,
        color: hex('#d8cfa8'),
        radius: 10,
        hostile: true,
        owner: m,
        kind: 'bolt',
      });
      audio.play('swing', { vol: 0.7 });
      return;
    }
    if (def.ai === 'caster') {
      const target = { x: p.x, y: p.y };
      this.ground.push({
        kind: 'telegraph',
        x: target.x,
        y: target.y,
        r: 84,
        life: 0.7,
        age: 0,
        color: PAL.bogfire,
        hostile: true,
        onEnd: () => {
          this.fx.ring(target.x, target.y, { r0: 10, r1: 100, life: 0.4, color: PAL.bogfire, width: 7 });
          this.fx.sparks(target.x, target.y, 6, 0, -1, 18, PAL.bogfire, 320);
          audio.play('fire');
          if (dist2(p.x, p.y, target.x, target.y) < 100 * 100) this.damagePlayer(m.dmg, m);
        },
      });
      return;
    }
    if (m.pendingLunge) {
      m.pendingLunge = false;
      const a = Math.atan2(p.y - m.y, p.x - m.x);
      m.lungeT = 0.26;
      m.lungeVX = Math.cos(a) * (def.lunge / 0.26);
      m.lungeVY = Math.sin(a) * (def.lunge / 0.26);
      audio.play('growl', { vol: 0.7 });
      return;
    }
    if (d < def.attackRange + p.radius) {
      this.damagePlayer(m.dmg, m);
      this.fx.sparks(p.x, p.y, 40, Math.cos(m.facing), Math.sin(m.facing), 8, PAL.blood, 220);
    } else {
      audio.play('swing', { vol: 0.5 });
    }
  }

  // -- boss AI ---------------------------------------------------------------

  bossAI(m, dt, d) {
    const p = this.player;
    const a = Math.atan2(p.y - m.y, p.x - m.x);
    m.facing = angleTowards(m.facing, a, dt * 4);
    const spd = m.speed * (1 - m.slow);
    const hpFrac = m.hp / m.maxHp;
    m.phaseNum = hpFrac > 0.6 ? 1 : hpFrac > 0.3 ? 2 : 3;

    if (m.abilityCd <= 0 && m.def.abilities?.length) {
      const list = m.def.abilities;
      const ability = list[m.abilityIndex % list.length];
      m.abilityIndex++;
      m.abilityCd = lerp(7, 3.4, (m.phaseNum - 1) / 2) * rnd(0.85, 1.15);
      this.bossAbility(m, ability);
      return;
    }

    if (d > m.def.attackRange * 0.8) {
      const mvx = Math.cos(a) * spd;
      const mvy = Math.sin(a) * spd;
      const [mx, my] = this.zone.resolve(m.x + mvx * dt, m.y + mvy * dt, m.radius);
      m.x = mx;
      m.y = my;
      m.speed01 = 1;
      m.phase += dt * 9;
    } else {
      m.speed01 = damp(m.speed01, 0, 8, dt);
      if (m.attackCd <= 0) this.beginAttack(m);
    }
  }

  bossAbility(m, kind) {
    const p = this.player;
    switch (kind) {
      case 'slam': {
        this.setAnim(m, 'roar', 1.0);
        const tx = p.x;
        const ty = p.y;
        this.ground.push({
          kind: 'telegraph',
          x: tx,
          y: ty,
          r: 190,
          life: 0.85,
          age: 0,
          color: PAL.amberDeep,
          hostile: true,
          onEnd: () => {
            audio.play('thunder');
            this.r.addShake(20);
            this.fx.ring(tx, ty, { r0: 20, r1: 240, life: 0.6, color: PAL.amber, width: 12 });
            this.fx.shards(tx, ty, 10, 22, PAL.amber, 380);
            this.fx.dust(tx, ty, 20);
            if (dist2(p.x, p.y, tx, ty) < 200 * 200) this.damagePlayer(m.dmg * 1.5, m);
          },
        });
        break;
      }
      case 'shards': {
        this.setAnim(m, 'cast', 0.9);
        const n = 10 + m.phaseNum * 3;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + rnd(-0.1, 0.1);
          this.fireProjectile({
            x: m.x,
            y: m.y,
            z: m.size * 0.5,
            angle: a,
            speed: 320,
            range: 700,
            dmg: m.dmg * 0.6,
            color: PAL.amber,
            radius: 14,
            hostile: true,
            owner: m,
            glow: true,
            kind: 'shard',
          });
        }
        audio.play('cast');
        break;
      }
      case 'howl': {
        this.setAnim(m, 'roar', 1.1);
        audio.play('bossRoar', { vol: 0.7 });
        this.fx.ring(m.x, m.y, { r0: 20, r1: 420, life: 0.8, color: hex('#ff8a4a'), width: 10 });
        this.r.addShake(12);
        // Calls the pack.
        for (let i = 0; i < 2 + m.phaseNum; i++) {
          const a = rnd(0, TAU);
          const x = m.x + Math.cos(a) * 340;
          const y = m.y + Math.sin(a) * 340;
          const w = this.spawnMonster('wolf', x, y, { level: m.level - 2 });
          if (w) {
            w.aggro = true;
            this.fx.ring(x, y, { r0: 4, r1: 60, life: 0.4, color: hex('#ff8a4a'), width: 4 });
          }
        }
        break;
      }
      case 'leap': {
        this.setAnim(m, 'attack', 0.9);
        const tx = p.x;
        const ty = p.y;
        this.ground.push({
          kind: 'telegraph',
          x: tx,
          y: ty,
          r: 150,
          life: 0.6,
          age: 0,
          color: hex('#ff6a3c'),
          hostile: true,
          onEnd: () => {
            m.x = tx;
            m.y = ty;
            audio.play('thunder', { vol: 0.7 });
            this.r.addShake(16);
            this.fx.dust(tx, ty, 24);
            this.fx.ring(tx, ty, { r0: 16, r1: 190, life: 0.5, color: hex('#ff6a3c'), width: 9 });
            if (dist2(p.x, p.y, tx, ty) < 160 * 160) this.damagePlayer(m.dmg * 1.3, m);
          },
        });
        break;
      }
      case 'bogNova': {
        this.setAnim(m, 'cast', 1.1);
        const rings = 2 + m.phaseNum;
        for (let k = 0; k < rings; k++) {
          const delay = k * 0.45;
          setTimeoutSafe(this, delay, () => {
            const r = 120 + k * 130;
            this.fx.ring(m.x, m.y, { r0: r - 40, r1: r + 40, life: 0.5, color: PAL.bogfire, width: 12 });
            audio.play('frost', { vol: 0.6 });
            const dd = dist(p.x, p.y, m.x, m.y);
            if (Math.abs(dd - r) < 62) this.damagePlayer(m.dmg * 0.8, m);
          });
        }
        break;
      }
      case 'summon': {
        this.setAnim(m, 'roar', 1.0);
        const pool = this.act.monsters;
        for (let i = 0; i < 2 + m.phaseNum; i++) {
          const a = rnd(0, TAU);
          const x = m.x + Math.cos(a) * rnd(200, 340);
          const y = m.y + Math.sin(a) * rnd(200, 340);
          const s = this.spawnMonster(this.rng.pick(pool), x, y, { level: m.level - 3 });
          if (s) {
            s.aggro = true;
            this.fx.ring(x, y, { r0: 4, r1: 70, life: 0.5, color: PAL.bogfire, width: 5 });
            this.fx.smoke(x, y, 10, 8, [40, 80, 70], 20);
          }
        }
        audio.play('cast');
        break;
      }
      case 'charge': {
        this.setAnim(m, 'dash', 0.9);
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        m.lungeT = 0.55;
        m.lungeVX = Math.cos(a) * 900;
        m.lungeVY = Math.sin(a) * 900;
        audio.play('dash');
        break;
      }
      case 'swordRing': {
        this.setAnim(m, 'roar', 1.0);
        const n = 12;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          this.fireProjectile({
            x: m.x,
            y: m.y,
            z: m.size * 0.45,
            angle: a,
            speed: 280,
            range: 640,
            dmg: m.dmg * 0.7,
            color: PAL.steelLight,
            radius: 15,
            hostile: true,
            owner: m,
            glow: true,
            kind: 'shard',
          });
        }
        audio.play('swing');
        break;
      }
      case 'lightning': {
        this.setAnim(m, 'roar', 1.2);
        audio.play('cast');
        for (let i = 0; i < 4 + m.phaseNum; i++) {
          const a = rnd(0, TAU);
          const d = rnd(0, 320);
          const tx = p.x + Math.cos(a) * d;
          const ty = p.y + Math.sin(a) * d;
          this.ground.push({
            kind: 'telegraph',
            x: tx,
            y: ty,
            r: 96,
            life: 0.75 + i * 0.12,
            age: 0,
            color: PAL.thunder,
            hostile: true,
            onEnd: () => {
              audio.play('thunder', { vol: 0.6 });
              this.fx.beam(tx, ty, tx, ty, {
                z0: 1200,
                z1: 0,
                color: PAL.thunder,
                width: 12,
                jagged: true,
                life: 0.25,
              });
              this.fx.ring(tx, ty, { r0: 10, r1: 120, life: 0.45, color: PAL.thunder, width: 8 });
              this.r.addShake(8);
              if (dist2(p.x, p.y, tx, ty) < 100 * 100) this.damagePlayer(m.dmg * 0.9, m);
            },
          });
        }
        break;
      }
    }
  }

  updateProjectiles(dt) {
    const p = this.player;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const b = this.projectiles[i];
      const stepX = b.vx * dt;
      const stepY = b.vy * dt;
      b.x += stepX;
      b.y += stepY;
      b.travelled += Math.hypot(stepX, stepY);
      b.life -= dt;

      if (b.glow) {
        this.fx.spawn({
          kind: 'ember',
          x: b.x,
          y: b.y,
          z: b.z,
          vx: rnd(-12, 12),
          vy: rnd(-8, 8),
          vz: rnd(-8, 12),
          life: 0.3,
          maxLife: 0.3,
          size: rnd(1.4, 3),
          color: b.color,
          grav: 0,
          drag: 2,
          glow: true,
        });
      }

      let dead = b.travelled > b.range || b.life <= 0 || !this.zone.inBounds(b.x, b.y);

      if (b.hostile) {
        if (dist2(b.x, b.y, p.x, p.y) < (b.radius + p.radius) ** 2) {
          this.damagePlayer(b.dmg, b.owner);
          this.fx.sparks(b.x, b.y, b.z, -b.vx, -b.vy, 8, b.color, 200);
          dead = true;
        }
      } else {
        for (const m of this.monsters) {
          if (!m.alive || b.hit.has(m)) continue;
          if (dist2(b.x, b.y, m.x, m.y) < (b.radius + m.radius) ** 2) {
            b.hit.add(m);
            const roll = this.playerAttackRoll(b.coef);
            this.damageMonster(m, roll.dmg, {
              crit: roll.crit,
              angle: b.angle,
              knock: 40,
              sparkColor: b.glow ? b.color : null,
            });
            this.fx.sparks(b.x, b.y, b.z, -b.vx, -b.vy, 6, b.color, 180);
            if (b.pierce <= 0) {
              dead = true;
              break;
            }
            b.pierce--;
          }
        }
      }

      if (!dead && this.zone.blocked(b.x, b.y, b.radius * 0.4)) {
        this.fx.sparks(b.x, b.y, b.z, -b.vx, -b.vy, 5, b.color, 140);
        dead = true;
      }
      if (dead) this.projectiles.splice(i, 1);
    }
  }

  updateGround(dt) {
    const p = this.player;
    for (let i = this.ground.length - 1; i >= 0; i--) {
      const g = this.ground[i];
      g.age += dt;
      if (g.kind === 'telegraph') {
        if (g.age >= g.life) {
          if (g.onEnd) g.onEnd();
          this.ground.splice(i, 1);
        }
        continue;
      }
      if (g.age >= g.life) {
        this.ground.splice(i, 1);
        continue;
      }
      if (g.kind === 'consecrate') {
        g.tick -= dt;
        if (g.tick <= 0) {
          g.tick = g.tickRate;
          for (const m of this.monsters) {
            if (!m.alive) continue;
            if (dist2(m.x, m.y, g.x, g.y) < g.r * g.r) {
              const roll = this.playerAttackRoll(g.coef);
              this.damageMonster(m, roll.dmg, { crit: roll.crit, noResource: true, sparkColor: PAL.holy });
            }
          }
          if (dist2(p.x, p.y, g.x, g.y) < g.r * g.r) {
            this.player.hp = Math.min(this.stats.maxLife, this.player.hp + this.stats.maxLife * g.heal);
          }
        }
        if (chance(dt * 14)) {
          const a = rnd(0, TAU);
          const d = Math.sqrt(Math.random()) * g.r;
          this.fx.embers(g.x + Math.cos(a) * d, g.y + Math.sin(a) * d, 1, PAL.holy, 4);
        }
      } else if (g.kind === 'rain') {
        g.tick -= dt;
        if (g.tick <= 0) {
          g.tick = g.tickRate;
          for (const m of this.monsters) {
            if (!m.alive) continue;
            if (dist2(m.x, m.y, g.x, g.y) < g.r * g.r) {
              const roll = this.playerAttackRoll(g.coef);
              this.damageMonster(m, roll.dmg, { crit: roll.crit, noResource: true });
            }
          }
          audio.play('swing', { vol: 0.28 });
        }
        for (let k = 0; k < 3; k++) {
          const a = rnd(0, TAU);
          const d = Math.sqrt(Math.random()) * g.r;
          const x = g.x + Math.cos(a) * d;
          const y = g.y + Math.sin(a) * d;
          this.fx.spawn({
            kind: 'shard',
            x,
            y,
            z: 320,
            vx: 0,
            vy: 0,
            vz: -700,
            life: 0.5,
            maxLife: 0.5,
            size: 4,
            rot: Math.PI / 2,
            spin: 0,
            color: g.color,
            grav: 0,
            drag: 0,
          });
        }
      } else if (g.kind === 'trap') {
        if (!g.armed) continue;
        for (const m of this.monsters) {
          if (!m.alive) continue;
          if (dist2(m.x, m.y, g.x, g.y) < (g.r + m.radius) ** 2) {
            g.armed = false;
            g.life = Math.min(g.life, g.age + 0.4);
            const roll = this.playerAttackRoll(g.coef);
            this.damageMonster(m, roll.dmg, {
              crit: roll.crit,
              root: g.root,
              sparkColor: PAL.steelLight,
            });
            this.fx.sparks(g.x, g.y, 8, 0, -1, 14, PAL.steelLight, 260);
            audio.play('hitArmor');
            break;
          }
        }
      }
    }
  }

  updateDrops(dt) {
    const p = this.player;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.z > 0 || d.vz !== 0) {
        d.vz -= 900 * dt;
        d.z += d.vz * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vx = damp(d.vx, 0, 6, dt);
        d.vy = damp(d.vy, 0, 6, dt);
        if (d.z <= 0) {
          d.z = 0;
          d.vz = 0;
          d.vx = 0;
          d.vy = 0;
        }
      }
      const dd = dist2(d.x, d.y, p.x, p.y);
      // Gold vacuums to the player; items must be stepped on or tapped.
      if (d.kind === 'gold' && dd < 170 * 170 && d.z <= 0) {
        const a = Math.atan2(p.y - d.y, p.x - d.x);
        const s = 340;
        d.x += Math.cos(a) * s * dt;
        d.y += Math.sin(a) * s * dt;
      }
      const pickR = d.kind === 'gold' ? 34 : 40;
      if (dd < pickR * pickR && d.z <= 2) this.pickup(d);
      if (d.picked || d.age > 240) this.drops.splice(i, 1);
    }
  }

  updateCorpses(dt) {
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.deathT += dt;
      c.animT = clamp01(c.deathT * 1.7);
      c.anim = 'die';
      if (c.deathT > 7) this.corpses.splice(i, 1);
    }
  }

  updateActFlow(dt) {
    const p = this.player;
    const z = this.zone;

    // Camp triggers
    for (const c of z.camps) {
      if (c.triggered) continue;
      if (dist2(p.x, p.y, c.x, c.y) < 720 * 720) this.spawnCamp(c);
    }

    // Trickle spawns so the world never feels empty
    // Once the quota is met the countryside goes quiet, so the way to the
    // boss is a march rather than an endless treadmill.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.kills < this.killQuota) {
      this.spawnTimer = lerp(4.5, 2.2, clamp01(this.kills / this.killQuota));
      const alive = this.monsters.length;
      const cap = 11 + this.actIndex;
      if (alive < cap && !this.boss) {
        const pos = z.randomSpawn(this.rng, p.x, p.y, 620);
        if (pos) {
          this.spawnMonster(this.rng.pick(this.act.monsters), pos.x, pos.y, {
            elite: chance(0.09),
          });
        }
      }
    }

    // Shrines
    for (const s of z.shrines) {
      if (s.used) continue;
      if (dist2(p.x, p.y, s.x, s.y) < 62 * 62) this.useShrine(s);
    }
    for (const c of z.chests) {
      if (c.opened) continue;
      if (dist2(p.x, p.y, c.x, c.y) < 62 * 62) this.openChest(c);
    }

    // Boss gate
    const arena = z.bossArena;
    const inArena = dist2(p.x, p.y, arena.x, arena.y) < arena.r * arena.r;
    if (inArena && !this.bossSpawned) {
      if (this.kills >= this.killQuota) {
        this.spawnBoss();
      } else if (!this._gateWarned || this.time - this._gateWarned > 6) {
        this._gateWarned = this.time;
        this.pushMessage(
          'Путь прегражден',
          `Ещё ${this.killQuota - this.kills} врагов должны пасть`,
          2.4
        );
      }
    }

    // Portal to the next act
    if (this.portal) {
      this.portal.t += dt;
      if (chance(dt * 22)) {
        this.fx.embers(this.portal.x, this.portal.y, 1, this.portal.last ? PAL.holy : PAL.bogfire, 26);
      }
      if (this.portal.t > 1.2 && dist2(p.x, p.y, this.portal.x, this.portal.y) < 60 * 60) {
        this.enterPortal();
      }
    }
  }

  useShrine(s) {
    s.used = true;
    const p = this.player;
    audio.play('holy');
    this.fx.ring(s.x, s.y, { r0: 8, r1: 180, life: 0.8, color: PAL.holy, width: 8 });
    const dur = 26;
    if (s.kind === 'heal') {
      p.hp = this.stats.maxLife;
      p.potions = p.maxPotions;
      this.pushMessage('Источник Ордена', 'Исцелён полностью', 2.2);
    } else if (s.kind === 'might') {
      p.buffs.might = { t: dur };
      p.bonus.dmgPct = (p.bonus.dmgPct || 0) + 0.35;
      this.recompute();
      setTimeoutSafe(this, dur, () => {
        p.bonus.dmgPct -= 0.35;
        this.recompute();
      });
      this.pushMessage('Алтарь силы', '+35 % урона', 2.2);
    } else if (s.kind === 'haste') {
      p.buffs.haste = { t: dur };
      p.bonus.attackSpeed = (p.bonus.attackSpeed || 0) + 0.4;
      p.bonus.moveSpeed = (p.bonus.moveSpeed || 0) + 0.25;
      this.recompute();
      setTimeoutSafe(this, dur, () => {
        p.bonus.attackSpeed -= 0.4;
        p.bonus.moveSpeed -= 0.25;
        this.recompute();
      });
      this.pushMessage('Алтарь спешки', '+40 % темпа', 2.2);
    } else {
      p.buffs.ward = { t: dur, absorb: 0.4, reflect: 0.4 };
      this.pushMessage('Алтарь защиты', 'Урон поглощается', 2.2);
    }
  }

  openChest(c) {
    c.opened = true;
    audio.play('chest');
    this.fx.sparks(c.x, c.y, 30, 0, -1, 22, PAL.gold, 260);
    this.fx.ring(c.x, c.y, { r0: 6, r1: 90, life: 0.5, color: PAL.gold, width: 5 });
    const n = rndInt(2, 3);
    for (let i = 0; i < n; i++) {
      this.dropItem(
        c.x + rnd(-40, 40),
        c.y + rnd(-30, 30),
        makeItem({ rng: this.rng, ilvl: this.monsterLevel() + 1, luck: 2.4, minRarity: 'magic' })
      );
    }
    this.dropGold(c.x, c.y, Math.round(rnd(60, 160) * (this.actIndex + 1)));
  }

  enterPortal() {
    const last = this.portal.last;
    this.portal = null;
    audio.play('portal');
    if (last) {
      this.state = 'victory';
      this.save();
      return;
    }
    if (this.actIndex >= ACTS.length - 1) {
      // Endless loop: harder Prussia, again.
      this.endless = true;
      this.difficulty *= 1.55;
      this.loadAct(0);
      this.pushMessage('Вечная охота', 'Сложность ×' + this.difficulty.toFixed(1), 4);
    } else {
      this.loadAct(this.actIndex + 1);
      this.pushMessage(this.act.name, this.act.subtitle, 4.5);
      this.logLine(this.act.intro);
    }
    this.player.hp = Math.min(this.stats.maxLife, this.player.hp + this.stats.maxLife * 0.4);
    this.player.potions = this.player.maxPotions;
    this.save();
  }

  /**
   * Death is a setback, not a dead end. The field is cleared but the boss is
   * kept and reset to full — wiping it from `monsters` while `boss` still
   * pointed at it used to strand the act with no way to finish.
   */
  respawnPlayer() {
    const p = this.player;
    p.gold = Math.floor(p.gold * 0.5);
    p.alive = true;
    p.anim = 'idle';
    p.animT = 0;
    p.animDur = 0;
    p.pendingHit = null;
    p.channel = null;
    p.dashT = 0;
    p.dashSkill = null;
    p.flash = 0;
    p.hp = this.stats.maxLife * 0.6;
    p.resource = this.cls.resource.id === 'zorn' ? 0 : this.stats.maxResource;
    p.potions = Math.max(2, p.potions);
    p.invuln = 3;
    p.buffs = {};
    const boss = this.boss;
    if (boss && boss.alive) {
      // Come back at the arena's edge: a two-minute walk back is a punishment
      // nobody enjoys, and the fight itself is the interesting part.
      const a = this.zone.bossArena;
      p.x = a.x;
      p.y = a.y + a.r * 0.85;
    } else {
      p.x = this.zone.start.x;
      p.y = this.zone.start.y;
    }
    p.vx = p.vy = 0;
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      if (this.monsters[i] !== boss) this.monsters.splice(i, 1);
    }
    this.projectiles.length = 0;
    this.ground.length = 0;
    clearTimers();

    if (boss && boss.alive) {
      // Partial heal, not a full reset: dying costs you ground without
      // erasing the fight, so an under-levelled player can still grind it out.
      boss.hp = Math.min(boss.maxHp, boss.hp + boss.maxHp * 0.25);
      boss.x = this.zone.bossArena.x;
      boss.y = this.zone.bossArena.y;
      boss.aggro = false;
      boss.windup = 0;
      boss.lungeT = 0;
      boss.stun = 0;
      boss.abilityCd = 4;
      boss.knockX = boss.knockY = 0;
    } else if (this.bossSpawned && !this.bossDead) {
      // The boss is gone but the act is unfinished — let it be summoned again.
      this.bossSpawned = false;
      this.boss = null;
    }

    this.spawnTimer = 3;
    this.state = 'playing';
    this.pushMessage('Восставший', 'Путь продолжается', 2.4);
    audio.play('holy');
    this.logLine('Ты восстал у путевого камня.');
  }

  // =========================================================================
  // Save
  // =========================================================================

  save() {
    if (!this.player) return;
    save({
      v: 3,
      seed: this.seed,
      classId: this.classId,
      actIndex: this.actIndex,
      difficulty: this.difficulty,
      endless: this.endless,
      p: {
        level: this.player.level,
        xp: this.player.xp,
        gold: this.player.gold,
        potions: this.player.potions,
        equipment: this.player.equipment,
        inventory: this.player.inventory.slice(0, 60),
        totalKills: this.player.totalKills,
        statPoints: this.player.statPoints,
      },
    });
  }

  hasSave() {
    const d = load();
    return d && d.v === 3;
  }

  continueRun() {
    const d = load();
    if (!d || d.v !== 3) return false;
    this.newRun(d.classId, d.seed);
    const p = this.player;
    p.level = d.p.level;
    p.xp = d.p.xp;
    p.gold = d.p.gold;
    p.potions = d.p.potions ?? p.maxPotions;
    p.equipment = d.p.equipment || emptyEquipment();
    p.inventory = d.p.inventory || [];
    p.totalKills = d.p.totalKills || 0;
    p.statPoints = d.p.statPoints || 0;
    this.difficulty = d.difficulty || 1;
    this.endless = !!d.endless;
    this.recompute();
    p.hp = this.stats.maxLife;
    p.resource = this.cls.resource.id === 'zorn' ? 0 : this.stats.maxResource;
    this.loadAct(d.actIndex || 0);
    this.state = 'playing';
    this.pushMessage(this.act.name, this.act.subtitle, 3.5);
    return true;
  }

  abandon() {
    clearSave();
  }

  // =========================================================================
  // Draw
  // =========================================================================

  draw(dt) {
    const R = this.r;
    const p = this.player;
    if (!p) return;

    R.updateCamera(p.x, p.y - 40, dt);
    R.beginFrame(dt);
    R.drawGround();
    R.drawWetSheen();
    R.drawDecals(dt);
    this.drawGroundEffects();

    // Ambient prop lights
    for (const L of this.zone.lights) {
      const fl = L.flicker ? 1 + Math.sin(R.time * 9 + L.phase) * 0.09 + Math.sin(R.time * 23 + L.phase) * 0.05 : 1;
      if (Math.abs(L.x - R.cam.x) > R.viewW || Math.abs(L.y - R.cam.y) > R.viewH * 1.4) continue;
      R.addLight(L.x, L.y - (L.z || 0) / ISO_Y, L.r * fl, L.color, L.i * fl);
    }
    // The hero carries his own light — this is what makes the dark readable.
    const heroLight = this.classId === 'hexer' ? PAL.amber : this.classId === 'jaegerin' ? hex('#ffcf9a') : PAL.torch;
    R.addLight(p.x, p.y - 20, 620, heroLight, 0.95 + Math.sin(R.time * 7) * 0.04);
    R.addLight(p.x, p.y - 20, 1100, this.r.ambience.rim, 0.2);

    this.queueProps();
    this.queueEntities();
    R.flushQueue();

    this.fx.draw(dt);
    R.renderLightmap();
    R.compositeLight();
    R.renderBloom();
    R.drawFog();
    this.fx.drawWeather(dt);
    R.drawVignetteAndGrade();
    this.fx.drawText();
    R.presentWorld();
  }

  queueProps() {
    const R = this.r;
    const cam = R.cam;
    const zoom = R.cam.zoom * R.pxScale;
    const vw = R.viewW * 0.5 + 260;
    const vh = R.viewH * 0.5 + 420;
    const p = this.player;
    // Where the player's chest sits on screen, for the occlusion test.
    const hx = R.sx(p.x);
    const hy = R.sy(p.y) - p.size * 0.5 * zoom;

    for (const pr of this.zone.props) {
      if (Math.abs(pr.x - cam.x) > vw) continue;
      if (pr.y - cam.y < -vh || pr.y - cam.y > vh) continue;
      const spr = getScaledProp(pr.name, pr.variant, zoom, pr.flip || 0);

      // Anything tall standing between the camera and the hero fades out, so
      // a pine or a brazier can never hide the fight.
      let want = 1;
      if (pr.y > p.y && spr.h > 60 * zoom) {
        const b = R.spriteBounds(spr, pr.x, pr.y);
        if (hx > b.x && hx < b.x + b.w && hy > b.y && hy < b.y + b.h) want = 0.34;
      }
      pr.fade = pr.fade === undefined ? want : damp(pr.fade, want, 12, 1 / 60);

      R.push(pr.y, (ctx, r) => {
        // No per-frame shadow blit: the bake already carries contact darkening.
        const swayPx = pr.sway ? Math.round(Math.sin(r.time * 0.9 + pr.phase) * pr.sway * 1.6) : 0;
        r.drawScaled(spr, pr.x, pr.y, swayPx, pr.fade);
        if (spr.emissive) r.drawScaledEmissive(spr, pr.x, pr.y, swayPx);
      });
    }
  }

  queueEntities() {
    const R = this.r;
    const p = this.player;

    // Shrines and chests
    for (const s of this.zone.shrines) {
      R.push(s.y, (ctx, r) => this.drawShrine(ctx, r, s));
    }
    for (const c of this.zone.chests) {
      R.push(c.y, (ctx, r) => this.drawChest(ctx, r, c));
    }

    // Corpses under everything living
    for (const c of this.corpses) {
      R.push(c.y - 1, (ctx, r) => this.drawActorEntity(ctx, r, c, true));
    }

    for (const d of this.drops) {
      R.push(d.y, (ctx, r) => this.drawDrop(ctx, r, d));
    }

    for (const m of this.monsters) {
      if (Math.abs(m.x - R.cam.x) > R.viewW * 0.5 + 300) continue;
      if (Math.abs(m.y - R.cam.y) > R.viewH * 0.5 + 400) continue;
      R.push(m.y, (ctx, r) => this.drawActorEntity(ctx, r, m, false));
    }

    if (p.alive || p.anim === 'die') {
      R.push(p.y, (ctx, r) => this.drawPlayer(ctx, r));
    }

    for (const b of this.projectiles) {
      R.push(b.y, (ctx, r) => this.drawProjectile(ctx, r, b));
    }

    if (this.portal) {
      R.push(this.portal.y, (ctx, r) => this.drawPortal(ctx, r));
    }
  }

  drawPlayer(ctx, R) {
    const p = this.player;
    const s = (p.size / 100) * R.cam.zoom * R.pxScale;
    R.drawShadow(p.x, p.y, 26, 0.75);
    const st = {
      t: R.time,
      anim: p.anim,
      animT: p.animT,
      facing: p.facing,
      speed: p.speed01,
      phase: p.phase,
      flash: p.flash,
      alpha: p.invuln > 0 && p.alive ? 0.7 + 0.3 * Math.sin(R.time * 40) : 1,
    };
    renderActor(ctx, p.look, st, R.sx(p.x), R.sy(p.y), s, (x, y, r, c, a) =>
      this.emis(R, x, y, r, c, a)
    );
    if (p.buffs.ward) {
      const k = clamp01(p.buffs.ward.t / 2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.28 * Math.min(1, k + 0.4);
      ctx.strokeStyle = css(PAL.amber);
      ctx.lineWidth = 3 * R.cam.zoom * R.pxScale;
      ctx.beginPath();
      ctx.ellipse(R.sx(p.x), R.sy(p.y) - 42 * s, 38 * s, 52 * s, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
      R.emisCircle(p.x, p.y, 46, PAL.amber, 0.25, 40);
    }
  }

  emis(R, sx, sy, r, color, alpha) {
    const ctx = R.emisCtx;
    const k = 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(sx * k, sy * k, 0, sx * k, sy * k, r * k);
    g.addColorStop(0, css(color, 1));
    g.addColorStop(0.45, css(color, 0.5));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx * k, sy * k, r * k, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawActorEntity(ctx, R, m, isCorpse) {
    const zoom = R.cam.zoom * R.pxScale;
    const s = (m.size / 100) * zoom;
    const fade = isCorpse ? clamp01(1 - (m.deathT - 5) / 2) : 1;
    if (fade <= 0) return;
    R.drawShadow(m.x, m.y, m.radius * 1.1, 0.6 * fade);

    const st = {
      t: R.time,
      anim: m.anim,
      animT: m.animT,
      facing: m.facing,
      speed: m.speed01,
      phase: m.phase,
      flash: m.flash,
      alpha: (m.def.ghostly ? 0.88 : 1) * fade,
    };
    renderActor(ctx, m.look, st, R.sx(m.x), R.sy(m.y), s, (x, y, r, c, a) =>
      this.emis(R, x, y, r, c, a * fade)
    );

    if (isCorpse) return;

    // Wind-up telegraph: a growing arc where the blow will land.
    if (m.windup > 0 && m.windupMax > 0) {
      const k = 1 - m.windup / m.windupMax;
      const rr = (m.def.attackRange + m.radius) * zoom;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 + 0.4 * k;
      ctx.strokeStyle = css(hex('#ff6a4a'));
      ctx.lineWidth = 3 * zoom;
      ctx.beginPath();
      ctx.ellipse(
        R.sx(m.x),
        R.sy(m.y),
        rr,
        rr * ISO_Y,
        0,
        m.facing - 0.6 - (1 - k) * 0.5,
        m.facing + 0.6 + (1 - k) * 0.5
      );
      ctx.stroke();
      ctx.restore();
    }

    // Health bar for elites and anything hurt
    const hurt = m.hp < m.maxHp;
    if ((m.elite || hurt) && !m.boss) {
      const w = Math.max(34, m.radius * 2.4) * zoom;
      const h = 5 * zoom;
      const x = R.sx(m.x) - w / 2;
      const y = R.sy(m.y) - (m.size + 18) * zoom;
      ctx.save();
      ctx.fillStyle = 'rgba(8,8,10,0.66)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      const frac = clamp01(m.hp / m.maxHp);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, m.elite ? '#f0a53a' : '#c8342e');
      g.addColorStop(1, m.elite ? '#a2600f' : '#6d1512');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w * frac, h);
      ctx.restore();
      if (m.elite) {
        ctx.save();
        ctx.font = `${(9 * zoom).toFixed(1)}px "Trebuchet MS", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(240,180,90,0.9)';
        ctx.fillText(m.name, R.sx(m.x), y - 4 * zoom);
        ctx.restore();
      }
    }
  }

  drawProjectile(ctx, R, b) {
    const zoom = R.cam.zoom * R.pxScale;
    const x = R.sx(b.x);
    const y = R.sy(b.y, b.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(b.vy * ISO_Y, b.vx));
    if (b.kind === 'arrow' || b.kind === 'bolt') {
      ctx.strokeStyle = css(PAL.wood);
      ctx.lineWidth = 2.2 * zoom;
      ctx.beginPath();
      ctx.moveTo(-16 * zoom, 0);
      ctx.lineTo(8 * zoom, 0);
      ctx.stroke();
      ctx.fillStyle = css(PAL.steelLight);
      ctx.beginPath();
      ctx.moveTo(8 * zoom, -2.6 * zoom);
      ctx.lineTo(16 * zoom, 0);
      ctx.lineTo(8 * zoom, 2.6 * zoom);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(220,214,196,0.8)';
      ctx.beginPath();
      ctx.moveTo(-16 * zoom, 0);
      ctx.lineTo(-22 * zoom, -3.4 * zoom);
      ctx.lineTo(-13 * zoom, 0);
      ctx.lineTo(-22 * zoom, 3.4 * zoom);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'lighter';
      const r = b.radius * zoom;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.6);
      g.addColorStop(0, css([255, 255, 255], 0.95));
      g.addColorStop(0.35, css(b.color, 0.9));
      g.addColorStop(1, css(b.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 2.1, r * 0.9, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    if (b.glow) R.emisCircle(b.x, b.y, b.radius * 2.4, b.color, 0.8, b.z);
  }

  drawGroundEffects() {
    const R = this.r;
    const ctx = R.ctx;
    const zoom = R.cam.zoom * R.pxScale;
    for (const g of this.ground) {
      const x = R.sx(g.x);
      const y = R.sy(g.y);
      const rr = g.r * zoom;
      const k = clamp01(g.age / g.life);
      if (g.kind === 'telegraph') {
        ctx.save();
        ctx.globalAlpha = 0.3 + 0.25 * Math.sin(g.age * 22);
        ctx.strokeStyle = css(g.color);
        ctx.lineWidth = 3 * zoom;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * ISO_Y, 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = css(g.color);
        ctx.beginPath();
        ctx.ellipse(x, y, rr * k, rr * k * ISO_Y, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (g.kind === 'consecrate') {
        const fade = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.16 * fade;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, rr);
        grad.addColorStop(0, css(g.color, 0.5));
        grad.addColorStop(0.7, css(g.color, 0.22));
        grad.addColorStop(1, css(g.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * ISO_Y, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.5 * fade;
        ctx.strokeStyle = css(g.color);
        ctx.lineWidth = 2.4 * zoom;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * ISO_Y, 0, 0, TAU);
        ctx.stroke();
        // A slowly turning cross inscribed in the ring, kept faint so it reads
        // as consecrated ground rather than a wireframe.
        ctx.globalAlpha = 0.14 * fade;
        ctx.lineWidth = 1.4 * zoom;
        for (let i = 0; i < 4; i++) {
          const a = R.time * 0.28 + (i / 4) * TAU;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * rr * 0.35, y + Math.sin(a) * rr * 0.35 * ISO_Y);
          ctx.lineTo(x + Math.cos(a) * rr * 0.94, y + Math.sin(a) * rr * 0.94 * ISO_Y);
          ctx.stroke();
        }
        ctx.restore();
        R.emisCircle(g.x, g.y, g.r * 0.7, g.color, 0.18 * fade);
      } else if (g.kind === 'trap') {
        ctx.save();
        ctx.globalAlpha = g.armed ? 0.75 : 0.3;
        ctx.strokeStyle = css(g.color);
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath();
        ctx.ellipse(x, y, rr * 0.5, rr * 0.5 * ISO_Y, 0, 0, TAU);
        ctx.stroke();
        const teeth = 10;
        for (let i = 0; i < teeth; i++) {
          const a = (i / teeth) * TAU;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * rr * 0.5, y + Math.sin(a) * rr * 0.5 * ISO_Y);
          ctx.lineTo(x + Math.cos(a) * rr * 0.3, y + Math.sin(a) * rr * 0.3 * ISO_Y);
          ctx.stroke();
        }
        ctx.restore();
      } else if (g.kind === 'rain') {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = css(g.color);
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * ISO_Y, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawDrop(ctx, R, d) {
    const zoom = R.cam.zoom * R.pxScale;
    const x = R.sx(d.x);
    const y = R.sy(d.y, d.z);
    const bob = Math.sin(R.time * 3 + d.x * 0.05) * 2 * zoom;
    if (d.kind === 'gold') {
      R.drawShadow(d.x, d.y, 10, 0.4);
      ctx.save();
      ctx.fillStyle = css(PAL.gold);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(x + (i - 1) * 4 * zoom, y + bob - i * 1.5 * zoom, 5 * zoom, 3 * zoom, 0, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,240,180,0.7)';
      ctx.beginPath();
      ctx.ellipse(x - 1.5 * zoom, y + bob - 3.5 * zoom, 2.4 * zoom, 1.2 * zoom, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      R.emisCircle(d.x, d.y, 16, PAL.gold, 0.28, d.z);
      return;
    }
    const col = this.rarityColor(d.item.rarity);
    R.drawShadow(d.x, d.y, 12, 0.4);
    // Beam of light — the Diablo tell that something good is on the ground.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beamH = (d.item.rarity === 'unique' ? 210 : d.item.rarity === 'rare' ? 150 : 96) * zoom;
    const g = ctx.createLinearGradient(x, y, x, y - beamH);
    g.addColorStop(0, css(col, 0.5));
    g.addColorStop(0.4, css(col, 0.2));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    const bw = 13 * zoom;
    ctx.beginPath();
    ctx.moveTo(x - bw, y);
    ctx.lineTo(x - bw * 0.4, y - beamH);
    ctx.lineTo(x + bw * 0.4, y - beamH);
    ctx.lineTo(x + bw, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    drawItemIcon(ctx, d.item, x, y + bob - 8 * zoom, 30 * zoom);
    R.emisCircle(d.x, d.y, 26, col, 0.45, d.z + 10);
  }

  drawShrine(ctx, R, s) {
    const zoom = R.cam.zoom * R.pxScale;
    const x = R.sx(s.x);
    const y = R.sy(s.y);
    R.drawShadow(s.x, s.y, 26, 0.55);
    // A stone pillar with a bowl
    ctx.save();
    ctx.fillStyle = css(hex('#3f4349'));
    ctx.beginPath();
    ctx.moveTo(x - 16 * zoom, y);
    ctx.lineTo(x - 11 * zoom, y - 52 * zoom);
    ctx.lineTo(x + 11 * zoom, y - 52 * zoom);
    ctx.lineTo(x + 16 * zoom, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(hex('#5b6068'));
    ctx.beginPath();
    ctx.ellipse(x, y - 52 * zoom, 18 * zoom, 6 * zoom, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (!s.used) {
      const col =
        s.kind === 'heal' ? hex('#4ad27a') : s.kind === 'might' ? hex('#d24a2a') : s.kind === 'haste' ? hex('#4ad2c8') : PAL.amber;
      const pulse = 0.7 + 0.3 * Math.sin(R.time * 3);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.8 * pulse;
      const g = ctx.createRadialGradient(x, y - 58 * zoom, 0, x, y - 58 * zoom, 22 * zoom);
      g.addColorStop(0, css(col, 0.95));
      g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y - 58 * zoom, 22 * zoom, 0, TAU);
      ctx.fill();
      ctx.restore();
      R.addLight(s.x, s.y, 200, col, 0.55 * pulse);
      R.emisCircle(s.x, s.y, 22, col, 0.6 * pulse, 58);
    }
  }

  drawChest(ctx, R, c) {
    const spr = getProp('crate', (Math.abs(Math.round(c.x)) % 4));
    R.drawShadow(c.x, c.y, 26, 0.5);
    R.drawSprite(spr, c.x, c.y, { scale: 0.85, alpha: c.opened ? 0.75 : 1 });
    if (!c.opened) {
      const pulse = 0.6 + 0.4 * Math.sin(R.time * 2.4 + c.x);
      R.addLight(c.x, c.y, 130, PAL.gold, 0.35 * pulse);
      R.emisCircle(c.x, c.y, 20, PAL.gold, 0.3 * pulse, 30);
    }
  }

  drawPortal(ctx, R) {
    const zoom = R.cam.zoom * R.pxScale;
    const pt = this.portal;
    const x = R.sx(pt.x);
    const y = R.sy(pt.y);
    const grow = clamp01(pt.t / 1.2);
    const h = 150 * zoom * grow;
    const w = 62 * zoom * grow;
    const col = pt.last ? PAL.holy : PAL.bogfire;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const k = 1 - i / 4;
      ctx.globalAlpha = 0.28 * k;
      ctx.fillStyle = css(col);
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.5, w * k, h * 0.5 * k, Math.sin(R.time * 0.7 + i) * 0.06, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = css([255, 255, 255], 0.7);
    ctx.lineWidth = 2 * zoom;
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.5, w, h * 0.5, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    R.addLight(pt.x, pt.y, 380, col, 1.1);
    R.emisCircle(pt.x, pt.y, 70, col, 0.7, 60);
  }
}

// ---------------------------------------------------------------------------

const ELITE_PREFIX = ['Кровавый', 'Древний', 'Проклятый', 'Закованный', 'Бешеный', 'Стылый'];
function eliteName(rng, base) {
  // Kept short on purpose: long names collide above a pack of elites.
  return `${rng.pick(ELITE_PREFIX)} ${base}`;
}

/** A timer that respects the game loop rather than wall-clock time. */
const pendingTimers = [];
export function setTimeoutSafe(game, delay, fn) {
  pendingTimers.push({ t: delay, fn });
}
/** Drops anything still queued — called whenever the world is replaced. */
export function clearTimers() {
  pendingTimers.length = 0;
}
export function tickTimers(dt) {
  for (let i = pendingTimers.length - 1; i >= 0; i--) {
    pendingTimers[i].t -= dt;
    if (pendingTimers[i].t <= 0) {
      const f = pendingTimers[i].fn;
      pendingTimers.splice(i, 1);
      try {
        f();
      } catch (e) {
        console.error(e);
      }
    }
  }
}

/** Compact vector icon for an item, used on the ground and in the bags. */
export function drawItemGlyph(ctx, item, x, y, size, color) {
  const s = size / 16;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const metal = css(PAL.steelLight);
  const dark = css(PAL.steelDark);
  const wood = css(PAL.wood);
  switch (item.icon) {
    case 'sword':
      ctx.strokeStyle = metal;
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.moveTo(-7 * s, 8 * s);
      ctx.lineTo(7 * s, -8 * s);
      ctx.stroke();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 2.4 * s;
      ctx.beginPath();
      ctx.moveTo(-9 * s, 2 * s);
      ctx.lineTo(-2 * s, 9 * s);
      ctx.stroke();
      break;
    case 'mace':
      ctx.strokeStyle = wood;
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.moveTo(-7 * s, 8 * s);
      ctx.lineTo(3 * s, -3 * s);
      ctx.stroke();
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.arc(5 * s, -6 * s, 5 * s, 0, TAU);
      ctx.fill();
      break;
    case 'bow':
      ctx.strokeStyle = wood;
      ctx.lineWidth = 2.6 * s;
      ctx.beginPath();
      ctx.arc(0, 0, 8 * s, -1.9, 1.9);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230,226,208,0.8)';
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      ctx.moveTo(Math.cos(-1.9) * 8 * s, Math.sin(-1.9) * 8 * s);
      ctx.lineTo(Math.cos(1.9) * 8 * s, Math.sin(1.9) * 8 * s);
      ctx.stroke();
      break;
    case 'staff':
      ctx.strokeStyle = wood;
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.moveTo(-5 * s, 9 * s);
      ctx.lineTo(4 * s, -5 * s);
      ctx.stroke();
      ctx.fillStyle = css(PAL.amber);
      ctx.beginPath();
      ctx.arc(5 * s, -7 * s, 4 * s, 0, TAU);
      ctx.fill();
      break;
    case 'shield':
      ctx.fillStyle = css(color);
      ctx.beginPath();
      ctx.moveTo(-7 * s, -8 * s);
      ctx.lineTo(7 * s, -8 * s);
      ctx.lineTo(7 * s, 2 * s);
      ctx.quadraticCurveTo(0, 10 * s, -7 * s, 2 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(18,18,22,0.8)';
      ctx.fillRect(-1.4 * s, -6 * s, 2.8 * s, 12 * s);
      ctx.fillRect(-5 * s, -1.4 * s, 10 * s, 2.8 * s);
      break;
    case 'book':
      ctx.fillStyle = css(PAL.leather);
      ctx.fillRect(-7 * s, -8 * s, 14 * s, 16 * s);
      ctx.fillStyle = css(PAL.linen);
      ctx.fillRect(-5 * s, -6 * s, 10 * s, 12 * s);
      break;
    case 'helm':
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(-7 * s, -2 * s);
      ctx.quadraticCurveTo(-7 * s, -9 * s, 0, -9 * s);
      ctx.quadraticCurveTo(7 * s, -9 * s, 7 * s, -2 * s);
      ctx.lineTo(7 * s, 6 * s);
      ctx.quadraticCurveTo(0, 10 * s, -7 * s, 6 * s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(10,10,14,0.85)';
      ctx.fillRect(-6 * s, -1 * s, 12 * s, 2.4 * s);
      break;
    case 'chest':
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(-8 * s, -7 * s);
      ctx.lineTo(8 * s, -7 * s);
      ctx.lineTo(6 * s, 8 * s);
      ctx.lineTo(-6 * s, 8 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.4 * s;
      ctx.beginPath();
      ctx.moveTo(0, -7 * s);
      ctx.lineTo(0, 8 * s);
      ctx.stroke();
      break;
    case 'glove':
      ctx.fillStyle = css(PAL.leather);
      ctx.fillRect(-6 * s, -3 * s, 12 * s, 10 * s);
      ctx.fillRect(-6 * s, -8 * s, 3 * s, 6 * s);
      ctx.fillRect(-1.5 * s, -9 * s, 3 * s, 7 * s);
      ctx.fillRect(3 * s, -8 * s, 3 * s, 6 * s);
      break;
    case 'boot':
      ctx.fillStyle = css(PAL.leatherDark);
      ctx.beginPath();
      ctx.moveTo(-4 * s, -8 * s);
      ctx.lineTo(2 * s, -8 * s);
      ctx.lineTo(3 * s, 4 * s);
      ctx.lineTo(8 * s, 5 * s);
      ctx.lineTo(8 * s, 8 * s);
      ctx.lineTo(-4 * s, 8 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ring':
      ctx.strokeStyle = css(PAL.gold);
      ctx.lineWidth = 2.6 * s;
      ctx.beginPath();
      ctx.arc(0, 2 * s, 6 * s, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = css(color);
      ctx.beginPath();
      ctx.arc(0, -6 * s, 3.2 * s, 0, TAU);
      ctx.fill();
      break;
    case 'amulet':
      ctx.strokeStyle = css(PAL.gold);
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.arc(0, -2 * s, 7 * s, 0.25, Math.PI - 0.25);
      ctx.stroke();
      ctx.fillStyle = css(PAL.amber);
      ctx.beginPath();
      ctx.ellipse(0, 5 * s, 4 * s, 5 * s, 0, 0, TAU);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = css(color);
      ctx.fillRect(-6 * s, -6 * s, 12 * s, 12 * s);
  }
  ctx.restore();
}
