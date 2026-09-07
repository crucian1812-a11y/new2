// What the player has actually drilled.
//
// The ladder answers "who can you beat"; this answers "what can you do". A
// technique you have taken to the mat six times in a row is not the same
// technique as one you have read the label of, and until now the game had no
// way to say so: every move in the graph was worth exactly its `base` to
// everybody, forever, and the only thing that ever changed was which belt was
// standing in front of you.
//
// One level per edge of the position graph, zero to three, and the level is
// the round of its drill you have passed — see drills.js. So the number is
// earned by doing the thing, under the conditions the drill names, and not by
// spending time in a menu.
//
// The bonus is deliberately small and it is one lever, not four. A drilled
// move is more likely to work; it does not also cost less, go faster or hit
// harder. Four small multipliers on the same press compound into a stat block,
// and this game is decided by which position you are in — the note on
// Fighter's attributes says so, and it is the same rule here.
//
// How small is a measurement, not a taste. tools/human-check.mjs takes a
// --skill level and plays the ladder with it, two hundred matches a belt, with
// the same late hand it always uses:
//
//        bonus     white   blue  purple  black
//     none (0%)      70%    46%     38%     7%
//     three (15%)    75%    53%     39%    13%
//     +30%           78%    62%     47%    14%
//     +45%           81%    68%     56%    18%
//
// Five per cent a round is the row that ships: drilling is worth having —
// nearly double against the black belt — and the ladder still runs one way at
// both ends. Ten stops being a bonus and starts being a belt: it hands a
// drilled player the blue belt on the terms an undrilled one gets the white.
// Fifteen is not a difficulty setting any more.
export const SKILL_MAX = 3;
export const SKILL_STEP = 0.05;

// A move's name in the store. The graph has no ids — an edge is the three
// facts that select it — so those three facts are the key. `to` is left out on
// purpose: two edges never share a from/role/dir, and if one ever did, the
// player has drilled "up from mount", which is what they would call it too.
export const keyOf = (tr) => `${tr.from}|${tr.role}|${tr.dir}`;

// The store. Kept in localStorage beside the ladder's own progress, and like
// it, missing storage is not an error: a player in a private window is a
// player at level zero everywhere, which is where everybody starts.
const SAVE = 'bjj.skills';

export class Skills {
  constructor(load = true) {
    this.at = new Map();
    if (load) this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(SAVE);
      if (!raw) return;
      const o = JSON.parse(raw);
      for (const k in o) {
        const v = o[k] | 0;
        if (v > 0) this.at.set(k, Math.min(SKILL_MAX, v));
      }
    } catch { /* no store, or somebody else's data in it */ }
  }

  save() {
    try {
      const o = {};
      for (const [k, v] of this.at) o[k] = v;
      localStorage.setItem(SAVE, JSON.stringify(o));
    } catch { /* private window */ }
  }

  level(tr) {
    return tr ? (this.at.get(keyOf(tr)) || 0) : 0;
  }

  // A round passed. Never downwards: a drill you fail today does not take away
  // what you did last week, because the thing you did last week still happened.
  raise(tr, level) {
    const k = keyOf(tr);
    const was = this.at.get(k) || 0;
    if (level <= was) return false;
    this.at.set(k, Math.min(SKILL_MAX, level));
    this.save();
    return true;
  }

  // Everything drilled at all, for the menu's counter.
  get drilled() {
    let n = 0;
    for (const v of this.at.values()) if (v > 0) n++;
    return n;
  }

  // What a match multiplies a chance by. The one place this reaches the fight.
  bonus(tr) {
    return 1 + SKILL_STEP * this.level(tr);
  }
}

// A store that knows nothing, for the tools and for the AI's side of the mat.
// The opponent does not drill: he is a belt, and the belt is his skill.
export const NO_SKILL = { level: () => 0, bonus: () => 1, raise: () => false, drilled: 0, save() {} };
