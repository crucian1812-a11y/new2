// Item generation and the stat maths that hangs off it.

import { RNG } from '../core/rng.js';
import {
  ITEM_BASES,
  AFFIXES,
  UNIQUES,
  RARITIES,
  PREFIXES,
  SUFFIX_PLACES,
  SLOTS,
} from './content.js';
import { clamp, lerp } from '../core/math.js';

let uid = 1;

const STAT_LABELS = {
  might: 'Kraft',
  agility: 'Geschick',
  vigor: 'Zähigkeit',
  spirit: 'Geist',
  life: 'Leben',
  armor: 'Rüstung',
  dmgPct: 'Schaden',
  critChance: 'Kritische Trefferchance',
  critDmg: 'Kritischer Schaden',
  attackSpeed: 'Angriffstempo',
  moveSpeed: 'Lauftempo',
  lifeOnHit: 'Leben pro Treffer',
  resourceRegen: 'Ressourcen-Regeneration',
  thorns: 'Dornen',
  goldFind: 'Goldfund',
  coldRes: 'Kältewiderstand',
};

export function statLabel(k) {
  return STAT_LABELS[k] || k;
}

export function formatStat(k, v) {
  const pct = ['dmgPct', 'critChance', 'critDmg', 'attackSpeed', 'moveSpeed', 'goldFind', 'coldRes'];
  if (pct.includes(k)) return `+${(v * 100).toFixed(1).replace(/\.0$/, '')} % ${statLabel(k)}`;
  return `+${Math.round(v * 10) / 10} ${statLabel(k)}`;
}

function rollRarity(rng, luck = 1, forceMin = null) {
  const entries = Object.values(RARITIES).map((r) => ({
    ...r,
    w: r.id === 'common' ? r.w : r.w * luck,
  }));
  let pick = rng.weighted(entries).id;
  if (forceMin) {
    const order = ['common', 'magic', 'rare', 'unique'];
    if (order.indexOf(pick) < order.indexOf(forceMin)) pick = forceMin;
  }
  return pick;
}

/** Scales an affix roll by item level so late items feel meaningfully better. */
function affixValue(rng, affix, ilvl) {
  const [lo, hi] = affix.t;
  const scale = affix.pct ? 1 + ilvl * 0.028 : 1 + ilvl * 0.16;
  return rng.range(lo, hi) * scale;
}

export function makeItem(opts = {}) {
  const rng = opts.rng || new RNG(Date.now() ^ (uid * 2654435761));
  const ilvl = Math.max(1, Math.round(opts.ilvl ?? 1));
  const slotFilter = opts.slot;
  let rarity = opts.rarity || rollRarity(rng, opts.luck ?? 1, opts.minRarity);

  // Uniques only drop if one exists for this level.
  if (rarity === 'unique') {
    const pool = UNIQUES.filter(
      (u) => u.minLevel <= ilvl + 3 && (!slotFilter || ITEM_BASES.find((b) => b.id === u.base)?.slot === slotFilter)
    );
    if (!pool.length) rarity = 'rare';
    else {
      const u = rng.pick(pool);
      const base = ITEM_BASES.find((b) => b.id === u.base);
      const item = {
        uid: uid++,
        name: u.name,
        rarity: 'unique',
        slot: base.slot,
        base: base.id,
        icon: base.icon,
        ilvl,
        flavour: u.flavour,
        power: u.power,
        powerText: u.powerText,
        stats: { ...u.stats },
        dmg: base.dmg ? [Math.round(base.dmg[0] * (1 + ilvl * 0.3)), Math.round(base.dmg[1] * (1 + ilvl * 0.3))] : null,
        armorBase: base.armor ? Math.round(base.armor * (1 + ilvl * 0.28)) : 0,
      };
      item.value = 400 + ilvl * 90;
      return item;
    }
  }

  const bases = slotFilter ? ITEM_BASES.filter((b) => b.slot === slotFilter) : ITEM_BASES;
  const base = rng.pick(bases);
  const [minA, maxA] = RARITIES[rarity].affixes;
  const nAffix = rng.int(minA, maxA);

  const pool = [...AFFIXES];
  const stats = {};
  for (let i = 0; i < nAffix; i++) {
    if (!pool.length) break;
    const a = rng.weighted(pool);
    pool.splice(pool.indexOf(a), 1);
    stats[a.stat] = (stats[a.stat] || 0) + affixValue(rng, a, ilvl);
  }

  const qual = 1 + ilvl * 0.3;
  const item = {
    uid: uid++,
    rarity,
    slot: base.slot,
    base: base.id,
    icon: base.icon,
    ilvl,
    stats,
    dmg: base.dmg ? [Math.round(base.dmg[0] * qual), Math.round(base.dmg[1] * qual)] : null,
    armorBase: base.armor ? Math.round(base.armor * (1 + ilvl * 0.28)) : 0,
  };

  // Name
  if (rarity === 'common') {
    item.name = base.name;
  } else if (rarity === 'magic') {
    const key = Object.keys(stats)[0];
    const aff = AFFIXES.find((a) => a.stat === key);
    item.name = `${base.name} ${aff ? aff.name : 'der Nacht'}`;
  } else {
    item.name = `${rng.pick(PREFIXES)} ${base.name} ${rng.pick(SUFFIX_PLACES)}`;
  }

  item.value = Math.round(
    (10 + ilvl * 6) * (rarity === 'common' ? 1 : rarity === 'magic' ? 2.4 : 6.5)
  );
  return item;
}

/** Gold pile / item roll for a slain monster. */
export function rollDrop(rng, opts) {
  const { ilvl, luck = 1, boss = false, elite = false, chance = 0.16 } = opts;
  const out = [];
  const p = boss ? 1 : elite ? 0.72 : chance;
  const rolls = boss ? 4 : elite ? 2 : 1;
  for (let i = 0; i < rolls; i++) {
    if (rng.float() > p) continue;
    out.push(
      makeItem({
        rng,
        ilvl,
        luck: luck * (boss ? 3.2 : elite ? 1.9 : 1),
        minRarity: boss ? 'rare' : elite ? 'magic' : null,
      })
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stat aggregation
// ---------------------------------------------------------------------------

export function emptyEquipment() {
  const eq = {};
  for (const s of SLOTS) eq[s] = null;
  return eq;
}

/**
 * Rolls up class base + level growth + every equipped item into the derived
 * numbers combat actually reads.
 */
export function computeStats(cls, level, equipment, extra = {}) {
  const s = {
    might: cls.base.might + cls.perLevel.might * (level - 1),
    agility: cls.base.agility + cls.perLevel.agility * (level - 1),
    vigor: cls.base.vigor + cls.perLevel.vigor * (level - 1),
    spirit: cls.base.spirit + cls.perLevel.spirit * (level - 1),
    life: cls.base.life + cls.perLevel.life * (level - 1),
    armor: cls.base.armor + cls.perLevel.armor * (level - 1),
    dmgPct: 0,
    critChance: cls.critChance,
    critDmg: 0.5,
    attackSpeed: 0,
    moveSpeed: 0,
    lifeOnHit: 0,
    resourceRegen: 0,
    thorns: 0,
    goldFind: 0,
    coldRes: 0,
  };

  let wMin = cls.weaponDmg[0];
  let wMax = cls.weaponDmg[1];
  const powers = [];

  for (const slot of SLOTS) {
    const it = equipment[slot];
    if (!it) continue;
    if (it.dmg) {
      wMin = it.dmg[0];
      wMax = it.dmg[1];
    }
    if (it.armorBase) s.armor += it.armorBase;
    for (const k in it.stats) s[k] = (s[k] || 0) + it.stats[k];
    if (it.power) powers.push(it.power);
  }

  for (const k in extra) s[k] = (s[k] || 0) + extra[k];

  // Primary attributes feed the derived numbers.
  const primary =
    cls.id === 'ritter' ? s.might : cls.id === 'jaegerin' ? s.agility : s.spirit;

  const out = {
    ...s,
    powers,
    weaponMin: wMin,
    weaponMax: wMax,
    maxLife: Math.round(s.life + s.vigor * 9),
    damageMult: (1 + primary * 0.021) * (1 + s.dmgPct),
    critChanceTotal: clamp(s.critChance + s.agility * 0.0012, 0, 0.75),
    critDmgTotal: 1 + s.critDmg,
    attackSpeedMult: 1 + clamp(s.attackSpeed, 0, 1.2),
    moveSpeedTotal: cls.base.moveSpeed * (1 + clamp(s.moveSpeed, -0.5, 0.6)),
    armorTotal: Math.max(0, s.armor),
    maxResource: cls.resource.max + Math.round(s.spirit * 0.8),
  };
  return out;
}

/** Diminishing-returns mitigation, tuned so armour never trivialises damage. */
export function mitigation(armor, attackerLevel) {
  const k = 42 + attackerLevel * 11;
  return armor / (armor + k);
}

export function damageRange(stats) {
  return [
    Math.round(stats.weaponMin * stats.damageMult),
    Math.round(stats.weaponMax * stats.damageMult),
  ];
}

/** Simple score used to flag an upgrade with an arrow in the UI. */
export function itemScore(item, cls) {
  if (!item) return 0;
  let score = 0;
  const prim = cls.id === 'ritter' ? 'might' : cls.id === 'jaegerin' ? 'agility' : 'spirit';
  if (item.dmg) score += (item.dmg[0] + item.dmg[1]) * 2.2;
  score += (item.armorBase || 0) * 1.1;
  for (const k in item.stats) {
    const v = item.stats[k];
    const w =
      k === prim ? 6 : k === 'life' ? 0.5 : k === 'armor' ? 1.1 :
      k === 'dmgPct' ? 220 : k === 'critChance' ? 420 : k === 'critDmg' ? 90 :
      k === 'attackSpeed' ? 260 : k === 'moveSpeed' ? 160 : k === 'lifeOnHit' ? 4 : 2;
    score += v * w;
  }
  return Math.round(score);
}

export { lerp };
