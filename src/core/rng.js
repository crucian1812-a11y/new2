// Deterministic pseudo random numbers. Every visual and every dungeon is
// generated from a seed so a run can be reproduced exactly.

/** 32-bit string/number hash (FNV-ish + avalanche). */
export function hashSeed(input) {
  let h = 2166136261 >>> 0;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32 — small, fast, good enough for games. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = Date.now()) {
    this.seed = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    this.next = mulberry32(this.seed);
  }
  /** [0,1) */
  float() {
    return this.next();
  }
  /** [a,b) */
  range(a, b) {
    return a + this.next() * (b - a);
  }
  /** integer in [a,b] inclusive */
  int(a, b) {
    return Math.floor(a + this.next() * (b - a + 1));
  }
  bool(p = 0.5) {
    return this.next() < p;
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Fisher–Yates, in place. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
  /** Picks from [{w:number, ...}] by weight. */
  weighted(entries, weightKey = 'w') {
    let total = 0;
    for (const e of entries) total += e[weightKey] || 0;
    let r = this.next() * total;
    for (const e of entries) {
      r -= e[weightKey] || 0;
      if (r <= 0) return e;
    }
    return entries[entries.length - 1];
  }
  /** Approximate normal distribution (mean 0, sd 1) via 3 samples. */
  gauss() {
    return (this.next() + this.next() + this.next() - 1.5) * 1.1547;
  }
  /** Random point inside a unit disc. */
  disc() {
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(this.next());
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  fork(salt) {
    return new RNG(hashSeed(this.seed + ':' + salt));
  }
}

/** A global, non-deterministic RNG for cosmetic-only randomness (sparks etc). */
export const rand = () => Math.random();
export const rnd = (a, b) => a + Math.random() * (b - a);
export const rndInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;
