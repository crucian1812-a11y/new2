// The match.
//
// One position at a time, one contested transition at a time. Everything the
// player does is one of four things: try a transition, deny theirs, fight for
// grips, or spend stamina holding a frame. That is a small verb set on purpose
// — a phone gives you two thumbs and no buttons you can look at — but the
// position graph makes it deep, because the same flick means a sweep from
// bottom half guard and a back take from bottom side control.
//
// Scoring is the IBJJF sheet: 2 for a takedown or a sweep, 3 for a guard pass,
// 4 for mount or back, and only after the position has been held for three
// seconds. Letting go early gets you an advantage, which is exactly what it is
// worth.

import { POSES } from './poses.js';
import { optionsFor, TRANSITIONS, SUB_KIND, POINTS_TO_HOLD, SUB_TIMEOUT, GRIP_LOSS } from './positions.js';
import { clamp, lerp } from '../core/m4.js';

export const MATCH_TIME = 300;

const DENY_WINDOW = 0.44; // seconds the defender has to read and answer

export class Fighter {
  constructor(name, opts = {}) {
    this.name = name;
    this.giCol = opts.giCol || new Float32Array([0.86, 0.87, 0.85]);
    this.beltCol = opts.beltCol || new Float32Array([0.05, 0.05, 0.06]);
    this.skinCol = opts.skinCol || new Float32Array([0.62, 0.44, 0.33]);
    this.stamina = 100;
    this.posture = 100;
    this.points = 0;
    this.advantages = 0;
    this.flash = 0;
    // Attributes, 0..1. They are small multipliers on purpose: a match should
    // be decided by which position you are in, not by a stat block.
    this.strength = opts.strength ?? 0.5;
    this.technique = opts.technique ?? 0.5;
    this.cardio = opts.cardio ?? 0.5;
  }
  get gassed() {
    return this.stamina < 25;
  }
}

export class Match {
  constructor(fighters, opts = {}) {
    this.f = fighters;
    this.position = 'STANDING';
    this.prevPosition = 'STANDING';
    this.blend = 1; // 0 = prevPosition, 1 = position
    this.blendSpeed = 4;
    // Role A of the paired pose is always the better position; who is playing
    // it changes every time somebody sweeps.
    this.roleOf = ['A', 'B'];
    this.time = opts.time ?? MATCH_TIME;
    this.limit = this.time;
    this.state = 'ready'; // ready | live | sub | over
    this.attempt = null;
    this.deny = null;
    this.sub = null;
    this.cool = [0, 0];
    this.hold = null; // pending points
    this.events = [];
    this.winner = null;
    this.subLog = [];
    // The funnel every attempt goes through, submissions counted apart.
    //
    // `subLog` says what happened inside a lock; this says how often anybody
    // got into one and where the others went. Between them they answer the
    // question the finish rate cannot: is the fight ending in taps because
    // submissions are strong, or because there are so many of them?
    this.tally = { tries: 0, denied: 0, failed: 0, landed: 0,
                   subTries: 0, subDenied: 0, subFailed: 0, subLanded: 0 };
    this.winBy = null;
    this.origin = [0, 0, 0];
    this.yaw = 0;
    this.intensity = 0;
    this.gripAdv = [0, 0]; // won grip exchanges, decays
    this.driveOf = [0, 0]; // how hard each of them is leaning in, this frame
    this.onEvent = opts.onEvent || (() => {});
    this.stallTimer = 0;
  }

  /* ------------------------------------------------------------ queries - */

  pose() {
    return POSES[this.position];
  }

  // 'top' or 'bottom' from the point of view of the transition table. In
  // standing and clinch nobody is on top, and the table registers those edges
  // under both keys, so answering 'top' there is correct and not a fudge.
  tagOf(i) {
    const p = POSES[this.position];
    if (!p.top) return 'top';
    return this.roleOf[i] === p.top ? 'top' : 'bottom';
  }

  isDominant(i) {
    const p = POSES[this.position];
    return !!p.top && this.roleOf[i] === p.top;
  }

  options(i) {
    if (this.state !== 'live' || this.attempt || this.cool[i] > 0) return {};
    return optionsFor(this.position, this.tagOf(i));
  }

  other(i) {
    return i === 0 ? 1 : 0;
  }

  /* ------------------------------------------------------------- actions */

  // A direction from one of the two players. Returns what it was used for, so
  // the UI can say something.
  input(i, dir) {
    if (this.state === 'over') return null;

    // Answering a threat always beats starting one. If a transition is coming
    // at you and you flick, that flick is a denial attempt, full stop —
    // otherwise the defence is impossible to perform under pressure.
    if (this.attempt && this.attempt.defender === i) {
      return this._tryDeny(i, dir);
    }
    if (this.state === 'sub') return this._subInput(i, dir);
    if (this.state !== 'live' || this.attempt || this.cool[i] > 0) return null;

    const tr = optionsFor(this.position, this.tagOf(i))[dir];
    if (!tr) return null;
    const me = this.f[i];
    if (me.stamina < tr.cost * 0.35) {
      this.emit(`${me.name}: нет сил`, 'warn');
      return null;
    }
    return this._start(i, tr);
  }

  _start(i, tr) {
    const me = this.f[i];
    this.tally.tries++;
    if (tr.sub) this.tally.subTries++;
    me.stamina = clamp(me.stamina - tr.cost * 0.45, 0, 100);
    this.attempt = {
      tr,
      by: i,
      defender: this.other(i),
      t: 0,
      denied: false,
      denyOpen: !!tr.deny,
      resolved: false,
    };
    this.deny = tr.deny
      ? { dir: tr.deny, t: 0, window: DENY_WINDOW, by: this.other(i) }
      : null;
    this.emit(`${me.name}: ${tr.name}`, 'attempt');
    return tr;
  }

  _tryDeny(i, dir) {
    const a = this.attempt;
    if (!a || !this.deny || this.deny.t > this.deny.window) return null;
    if (dir !== this.deny.dir) {
      // A wrong read costs you: you have committed weight the wrong way.
      this.f[i].stamina = clamp(this.f[i].stamina - 5, 0, 100);
      this.f[i].posture = clamp(this.f[i].posture - 4, 0, 100);
      this.deny = null;
      this.emit(`${this.f[i].name}: не угадал`, 'warn');
      return 'deny-miss';
    }
    a.denied = true;
    this.deny = null;
    this.f[i].advantages += 0; // denial is its own reward, not a score
    this.emit(`${this.f[i].name}: защитился`, 'deny');
    return 'deny';
  }

  // The tap on the right pad: a grip fight. Wins tilt the next transition.
  grip(i) {
    if (this.state !== 'live' || this.cool[i] > 0) return null;
    const me = this.f[i];
    const you = this.f[this.other(i)];
    if (me.stamina < 6) return null;
    me.stamina -= 4;
    const mine = 0.5 + (me.technique - you.technique) * 0.45 + (me.stamina - you.stamina) / 320;
    if (Math.random() < clamp(mine, 0.12, 0.88)) {
      this.gripAdv[i] = clamp(this.gripAdv[i] + 0.34, 0, 1);
      you.posture = clamp(you.posture - 7, 0, 100);
      return 'win';
    }
    this.gripAdv[this.other(i)] = clamp(this.gripAdv[this.other(i)] + 0.2, 0, 1);
    return 'lose';
  }

  /* ---------------------------------------------------------------- tick */

  update(dt, control) {
    if (this.state === 'ready' || this.state === 'over') return;
    this.time = Math.max(0, this.time - dt);

    for (let i = 0; i < 2; i++) this.cool[i] = Math.max(0, this.cool[i] - dt);
    for (let i = 0; i < 2; i++) this.gripAdv[i] = Math.max(0, this.gripAdv[i] - dt * 0.16);

    this.blend = Math.min(1, this.blend + dt * this.blendSpeed);
    this._stamina(dt, control);

    if (this.state === 'sub') this._subUpdate(dt);
    else this._liveUpdate(dt);

    this._drift(dt, control);
    this._score(dt);

    for (const f of this.f) f.flash = Math.max(0, f.flash - dt * 3);

    if (this.time <= 0 && this.state !== 'over') this._timeUp();
  }

  _liveUpdate(dt) {
    const a = this.attempt;
    if (!a) {
      this.intensity = lerp(this.intensity, 0.1, dt * 2);
      this.stallTimer += dt;
      return;
    }
    this.stallTimer = 0;
    if (this.deny) {
      this.deny.t += dt;
      if (this.deny.t > this.deny.window) this.deny = null;
    }
    a.t += dt;
    this.intensity = lerp(this.intensity, 1, dt * 6);
    const dur = a.tr.time;
    if (a.t < dur) {
      // The blend towards the destination runs while the attempt is live, so a
      // contested pass looks contested: bodies already halfway there, and then
      // either arriving or snapping back.
      this.blend = Math.min(0.82, a.t / dur);
      this.prevPosition = this.position;
      this.pending = a.tr.to;
      return;
    }
    this._resolve(a);
  }

  _resolve(a) {
    const tr = a.tr;
    const me = this.f[a.by];
    const you = this.f[a.defender];
    this.attempt = null;
    this.pending = null;
    this.deny = null;

    if (a.denied) {
      this.tally.denied++;
      if (tr.sub) this.tally.subDenied++;
      this._snapBack(a.by, 0.65);
      me.stamina = clamp(me.stamina - tr.cost * 0.3, 0, 100);
      me.posture = clamp(me.posture - 6, 0, 100);
      you.advantages += tr.big ? 1 : 0;
      if (tr.big) this.emit(`${you.name}: преимущество`, 'adv');
      return;
    }

    const p = this.chanceOf(tr, a.by);

    me.stamina = clamp(me.stamina - tr.cost * 0.55, 0, 100);

    if (Math.random() > p) {
      this.tally.failed++;
      if (tr.sub) this.tally.subFailed++;
      // A choke that misses is a choke the other man has turned into.
      //
      // Losing the back has to cost something, or a failed submission is free
      // and the man on top simply tries again: with the set-up required and
      // nothing charged for missing, the fight parked in back control for
      // nearly half the clock and hunted a choke it could not have. The
      // defender comes out through his own escape from the position, the same
      // way he does when he strips the grip.
      if (tr.sub && Math.random() < 0.4) {
        const out = this._escapeFrom(this.position);
        if (out) {
          me.posture = clamp(me.posture - 8, 0, 100);
          this.cool[a.by] = 0.8;
          this.emit(`${you.name}: вывернулся`, 'escape');
          this.goTo(out, a.defender);
          return;
        }
      }
      this._snapBack(a.by, 0.8);
      me.posture = clamp(me.posture - 8, 0, 100);
      this.emit(`${me.name}: не прошло`, 'fail');
      return;
    }

    this.tally.landed++;
    if (tr.sub) this.tally.subLanded++;
    this.goTo(tr, a.by);
  }

  // The odds of a transition landing, right now.
  //
  // Factored out of `_resolve` so the AI can ask before it commits. It used to
  // be unable to: a move was worth its gain times the table's nominal rate, so
  // nobody ever waited for a better moment, and the measurement showed it —
  // submissions were being attempted on men whose posture was still at 46 out
  // of 100 on average and at 81 in the top tenth, with the attacker's grip
  // advantage sitting at 0.02. Nothing in the game required the set-up and
  // nothing in the AI performed it.
  chanceOf(tr, by) {
    const me = this.f[by];
    const you = this.f[this.other(by)];
    // Base rate from the technique, then the things the player actually
    // controls: stamina, posture, grips, and how hard they were driving with
    // the left thumb when it went off.
    let p = tr.base;
    p *= 0.75 + me.technique * 0.5;
    p *= 0.72 + (me.stamina / 100) * 0.5;
    p *= 1 + this.gripAdv[by] * 0.35;
    p /= 0.78 + (you.stamina / 100) * 0.42;
    p *= 1 + (1 - you.posture / 100) * 0.4;
    // The attacker's drive, not player one's. `this.drive` was whatever the
    // left thumb of fighter zero happened to be doing, and it was added to
    // whoever attempted — which in a simulated match is the wrong man half the
    // time.
    p += (this.driveOf[by] || 0) * 0.12;
    // A submission is not a position, and it is not taken from a man who is
    // still together. This is the difference between a choke and a pass: you
    // pass a guard on the way past somebody, you finish a man you have already
    // broken. Cold, on full posture and with no grips on him, a submission is
    // worth less than a third of its nominal rate; set up, it is worth more
    // than its nominal rate.
    if (tr.sub) p *= 0.3 + 0.5 * (1 - you.posture / 100) + 0.35 * this.gripAdv[by];
    return clamp(p, 0.05, 0.95);
  }

  // Where the man underneath goes when he gets out. Any of his own escapes
  // from the position, picked at random.
  //
  // It used to be the first one the table happened to list, which from back
  // control is always turning to turtle — and from turtle the man on top takes
  // the back again for four points, so a survived choke fed a two-position
  // loop that owned a third of the clock. The graph offers him two ways out;
  // both should happen.
  _escapeFrom(from) {
    const outs = TRANSITIONS.filter(
      (t) => t.from === from && t.role === 'bottom' && t.becomes === 'bottom');
    return outs.length ? outs[(Math.random() * outs.length) | 0] : null;
  }

  _snapBack(by, cool) {
    this.prevPosition = this.position;
    this.blend = 0;
    this.blendSpeed = 4.5;
    this.cool[by] = cool;
  }

  // Arrive somewhere. This is the only place the position, the roles and the
  // pending score change, which is what keeps sweeps from quietly corrupting
  // whose points are whose.
  goTo(tr, by) {
    const me = this.f[by];
    const you = this.f[this.other(by)];
    this.prevPosition = this.position;
    this.position = tr.to;
    this.blend = 0;
    this.blendSpeed = 1 / Math.max(0.22, tr.time * 0.55);

    if (tr.swap) {
      this.roleOf = [this.roleOf[1], this.roleOf[0]];
    }
    // The destination pose decides who is role A; make sure the person who did
    // the work is the one holding it.
    const destTop = POSES[tr.to].top;
    if (destTop && tr.becomes !== 'bottom') {
      this.roleOf[by] = destTop;
      this.roleOf[this.other(by)] = destTop === 'A' ? 'B' : 'A';
    } else if (tr.becomes === 'bottom' && destTop) {
      this.roleOf[by] = destTop === 'A' ? 'B' : 'A';
      this.roleOf[this.other(by)] = destTop;
    }

    you.posture = clamp(you.posture - (tr.big ? 22 : 12), 0, 100);
    me.posture = clamp(me.posture + 6, 0, 100);
    this.cool[by] = 0.3;
    this.cool[this.other(by)] = 0.18;
    you.flash = 1;

    if (tr.sub) {
      this._startSub(by, tr);
      return;
    }

    if (tr.points > 0) {
      this.hold = { by, points: tr.points, t: 0, pos: tr.to, note: tr.note || tr.name };
    } else {
      this.hold = null;
    }
    this.emit(`${me.name}: ${tr.name}`, tr.big ? 'big' : 'move');
    this.onEvent({ kind: 'position', by, tr });
  }

  /* ---------------------------------------------------------- submission */

  _startSub(by, tr) {
    const kind = POSES[tr.to].submission;
    this.state = 'sub';
    this.sub = {
      kind,
      spec: SUB_KIND[kind],
      attacker: by,
      defender: this.other(by),
      meter: 0.12,
      phase: 0,
      escapeDir: 'left',
      escapeT: 0,
      lowT: 0,
      sinceEscape: 9,
      strip: 0,
      age: 0,
      from: tr.from,
      lastTap: 0,
      // A ledger, so the race can be taken apart afterwards instead of argued
      // about. Eight numbers per submission, and they answer the one question
      // the finish rate cannot: did the attacker finish this, or did it finish
      // itself while he held on?
      run: 0,
      led: { creep: 0, taps: 0, escapes: 0, misses: 0, nTight: 0, nSlip: 0, nEsc: 0, nMiss: 0 },
    };
    this.hold = null;
    this.emit(`${this.f[by].name}: ${tr.name}!`, 'sub');
    this.onEvent({ kind: 'submission', by, tr });
  }

  _subInput(i, dir) {
    const s = this.sub;
    if (!s) return null;
    if (i === s.defender) {
      if (dir === s.escapeDir) {
        // A tight submission is harder to get out of than a loose one.
        //
        // Without this the escape is worth a flat 0.145 however deep the choke
        // is, and the two sides of the fight stop being comparable: the
        // defence scales with the belt — a black belt reads the right direction
        // three times as often as a white belt — while the attack only scales
        // through hitting the beat. The ranking came out backwards. White belts
        // submitted each other in every match; black belts never finished
        // anybody at all.
        //
        // The attacker's skill is what drives the meter up, so making the
        // escape cost more as the meter rises is what puts his skill on the
        // same footing as the defender's.
        //
        // And with what he has left. Two men of equal skill in a meter race
        // decide it by a hair — the whole balance flipped from "everybody gets
        // finished" to "nobody ever does" on a fifth of a second of pacing —
        // because nothing in it changed as the fight went on. Gas does: a fresh
        // man fights out of a choke, a man three minutes and four scrambles in
        // does not, and that is both true of the sport and a mechanism with
        // some slack in it.
        const left = 0.65 + 0.35 * (this.f[i].stamina / 100);
        // An escape winds up; it is not granted by the press.
        //
        // The attacker's tightening is paced by the beat — about one a second —
        // and the defender's was not paced at all, so the whole race came down
        // to who could press faster. Gating the defender instead, with a window
        // or a cooldown, only swapped one clock for another: two fifths of a
        // second either way flipped the black belt from never being finished to
        // almost always, because the gate beat against the clock that rotates
        // the escape direction. A ramp has no beat to resonate with. Mashing
        // earns a fraction each time; waiting for the moment earns all of it.
        const wound = Math.min(1, s.sinceEscape / 0.9);
        s.sinceEscape = 0;
        const off = 0.145 * wound * left * (1 - 0.55 * s.meter);
        s.led.escapes += Math.min(off, s.meter);
        s.led.nEsc++;
        s.meter = clamp(s.meter - off, 0, 1.2);
        // And the grip itself comes apart. Knocking the meter down is not how
        // anybody actually gets out of a choke — the arm is stripped, one hand
        // fight at a time — and without that the only exits were driving the
        // meter to nothing, which never happened, and the thirteen-second
        // timeout. So every submission that locked on finished, at every belt.
        // Three good escapes take the grip off him.
        s.strip += wound * left;
        this.f[i].stamina = clamp(this.f[i].stamina - s.spec.escapeCost * 0.16, 0, 100);
        // A new direction to find, and a moment to re-set before he can go
        // again. Without the pause the defender gets a fresh direction the
        // instant he lands one and can escape twice a second, while the
        // attacker's tightening is paced by the beat at about once a second —
        // which is why the better the belt, the less anybody was ever finished.
        s.escapeT = 999;
        s.escapeCool = 0.7;
        return 'escape';
      }
      // A wrong escape wastes the defender's air and, more to the point, his
      // wind-up: he has committed the movement in the wrong direction and has
      // to gather himself again. That is what makes reading the position worth
      // anything — without it a miss cost nothing but a tenth of a second and
      // every belt escaped at the same rate.
      //
      // It does not tighten the choke for him. At two flicks a second the old
      // penalty was worth more than the attacker's own work, so a white belt's
      // defence was actively feeding the submission and every one of their
      // matches ended in a tap.
      this.f[i].stamina = clamp(this.f[i].stamina - 4, 0, 100);
      s.sinceEscape = 0;
      s.led.misses += 0.008;
      s.led.nMiss++;
      s.meter = clamp(s.meter + 0.008, 0, 1.2);
      return 'escape-miss';
    }
    return null;
  }

  // The attacker's tap. Timed against the pulsing ring: on the beat it
  // tightens, off the beat it costs.
  subTap(i) {
    const s = this.sub;
    if (!s || i !== s.attacker) return null;
    const inWindow = s.phase > 0.64 && s.phase < 0.86;
    const me = this.f[i];
    if (inWindow) {
      const grip = 1 - GRIP_LOSS * Math.min(1, s.strip / 7);
      // Pressure is continuous or it is nothing.
      //
      // A single squeeze was worth the same whether it followed nine others or
      // followed a miss, and that is the reason the attack would not scale with
      // the belt: hitting the beat half the time got a white belt half of a
      // black belt's meter, and half was plenty. It should get him much less
      // than half, because a choke let off between cranks is a choke the other
      // man breathes in. Six on the trot is a finish; alternating never builds.
      //
      // Broken by his own mistiming and nothing else. Resetting it on the
      // defender's escape as well sounds right and empties the idea: a good
      // defender escapes about once a second and the attacker cranks about
      // twice, so nobody ever reached three in a row and the bonus may as well
      // not have existed. This is a measure of the attacker's rhythm, and only
      // he can break it.
      s.run++;
      // Half again at six on the trot, and the height is measured. At 0.8 the
      // black belt's attack outran his opponent's defence and he finished 97%
      // of his matches — further from the target than before the rhythm
      // existed; at 0.3 he finished 63% and the clock inside a lock went back
      // up at every belt, because submissions that cannot close are submissions
      // that sit there. At 0.5 the black belt comes in under both targets at
      // once, which nothing in this game had managed before.
      const rhythm = 1 + Math.min(1, s.run / 6) * 0.5;
      const w = (0.040 + me.strength * s.spec.strengthWeight * 0.09) * grip * rhythm;
      s.led.taps += w;
      s.led.nTight++;
      s.meter = clamp(s.meter + w, 0, 1.2);
      me.stamina = clamp(me.stamina - 2.5, 0, 100);
      s.phase = 0;
      return 'tight';
    }
    me.stamina = clamp(me.stamina - 5, 0, 100);
    s.led.taps -= Math.min(0.012, s.meter);
    s.led.nSlip++;
    s.meter = clamp(s.meter - 0.012, 0, 1.2);
    // And it costs him the grip.
    //
    // This is where the attacker's timing finally weighs as much as the
    // defender's reading. A white belt hits the window about half as often as a
    // black belt and used to land nearly as many squeezes anyway, because a
    // miss cost him a hundredth of the meter and nothing else — the attack
    // barely scaled with the belt while the defence scaled with it hard, and
    // the finish rate came out the same at both ends. Cranking at the wrong
    // moment is how a choke is lost in the first place, so a slip loosens it
    // exactly as a defender's escape does, and the loosening feeds back through
    // GRIP_LOSS into everything he does next.
    //
    // Not tried and rejected: leaving the beat running through a miss. It
    // rewards mashing instead of punishing it — the AI simply presses again a
    // tenth of a second later and walks its way into the window, and the white
    // belt's finish rate went *up*.
    s.strip += 0.35;
    s.run = 0;
    s.phase = 0;
    return 'slip';
  }

  // Every submission that started, and how it went, in the order they
  // happened. Nothing in the game reads it; `tools/sim-check.mjs` does, and it
  // is the difference between "87% of matches end in a tap" — which says a
  // number is wrong — and knowing which term in the race is wrong.
  _logSub(how) {
    const s = this.sub;
    if (!s) return;
    this.subLog.push({
      how, kind: s.kind, from: s.from, seconds: s.age, meter: s.meter, strip: s.strip, ...s.led,
    });
  }

  _subUpdate(dt) {
    const s = this.sub;
    const att = this.f[s.attacker];
    const def = this.f[s.defender];
    this.intensity = 1;

    s.age += dt;
    s.sinceEscape += dt;
    s.phase = (s.phase + dt * 1.15) % 1;
    s.escapeT += dt;
    if (s.escapeT > 1.4) {
      s.escapeT = 0;
      const dirs = ['up', 'down', 'left', 'right'];
      s.escapeDir = dirs[(Math.random() * 4) | 0];
    }

    // The creep. A submission that is on tightens by itself; the defender's
    // job is to outpace it, and doing that costs more than holding it does.
    // "A submission that is on tightens by itself" is what the comment above
    // has always said, and the arithmetic below never did it: the creep was the
    // same at a meter of nought as at nine tenths. So a choke that was nearly
    // finished was no more dangerous than one just applied, and against a
    // defender who reads the escape well — which is what a high belt is — it
    // could never close. Depth now feeds itself, which is both what the comment
    // promised and what makes a good attacker finish.
    // How much of the grip he still has.
    //
    // `strip` was only ever a threshold: seven good escapes and the submission
    // broke, and until then it changed nothing at all. That put a cliff exactly
    // where the typical fight lands — a white belt gets eight escapes off in a
    // ten second choke and a black belt eleven, so one side of the cliff
    // finished 98% of its submissions and the other 34%, on a difference of
    // three escapes. A choke with one hand stripped off it is not the same
    // choke, and saying so turns the cliff into a slope: every escape that
    // lands takes something off the attacker's work, right away, instead of
    // paying out only at the seventh.
    const grip = 1 - GRIP_LOSS * Math.min(1, s.strip / 7);
    const deep = 1 + 0.9 * s.meter;
    // Small on purpose. Measured against the rest of the race, the passive
    // creep used to be worth as much per second as everything the attacker did
    // — so a submission finished itself in about nine seconds whoever had
    // applied it, and a white belt's sloppy choke was as good as a black
    // belt's. It decides fights that are already going one way; it does not
    // fight them.
    const creep = deep * grip * s.spec.rate * 0.17
      * (0.7 + att.strength * s.spec.strengthWeight)
      * (0.75 + (1 - def.stamina / 100) * 0.7);
    s.led.creep += creep * dt;
    s.meter = clamp(s.meter + creep * dt, 0, 1.2);
    def.stamina = clamp(def.stamina - dt * 3.2, 0, 100);
    att.stamina = clamp(att.stamina - dt * 2.2, 0, 100);
    def.posture = clamp(def.posture - dt * 8, 0, 100);

    if (s.meter >= s.spec.tapAt) {
      this._logSub('tap');
      this._finish(s.attacker, 'submission');
      return;
    }
    if (s.meter <= 0.02) s.lowT += dt;
    else s.lowT = 0;
    if (s.lowT > 1.2 || s.strip >= 7 || s.age > SUB_TIMEOUT) {
      // Broken. The attacker has burned a lot of gas for nothing.
      //
      // Where the defender comes out matters more than it looks. Putting him
      // back where the attack started means surviving a choke buys him
      // nothing: the man on his back still has it, still has the same best
      // move, and takes it again a second later. Nine tenths of every match
      // ended in a tap for that reason — not because the submissions were
      // strong, but because there were so many of them.
      //
      // A grip that has been stripped is a position that has been improved, so
      // he comes out through his own escape from it — the graph already knows
      // which one that is. A submission that merely timed out leaves things
      // where they were.
      const stripped = s.strip >= 7;
      this._logSub(stripped ? 'stripped' : s.lowT > 1.2 ? 'emptied' : 'timeout');
      const out = stripped ? this._escapeFrom(s.from) : null;
      this.state = 'live';
      this.sub = null;
      this.cool[s.attacker] = 0.9;
      att.stamina = clamp(att.stamina - 12, 0, 100);
      if (out) {
        // Through his own escape from the position, scored and re-roled by the
        // one place that does either.
        this.goTo(out, s.defender);
      } else {
        this.prevPosition = this.position;
        this.position = s.from;
        this.blend = 0;
        this.blendSpeed = 2.2;
      }
      this.emit(`${def.name}: вышел из захвата`, 'escape');
      this.onEvent({ kind: 'escape' });
    }
  }

  /* ------------------------------------------------------- score & clock */

  _score(dt) {
    if (!this.hold) return;
    const { by } = this.hold;
    // The clock runs while the other one is trying to get out — that is the
    // whole point of the three seconds. It only stops if they actually get out.
    if (!this.isDominant(by) || this.position !== this.hold.pos) {
      // They gave it up before the three seconds were out. That is what an
      // advantage is for.
      this.f[by].advantages += 1;
      this.emit(`${this.f[by].name}: преимущество`, 'adv');
      this.hold = null;
      return;
    }
    this.hold.t += dt;
    if (this.hold.t >= POINTS_TO_HOLD) {
      this.f[by].points += this.hold.points;
      this.emit(`${this.f[by].name}: +${this.hold.points} (${this.hold.note})`, 'points');
      this.onEvent({ kind: 'points', by, points: this.hold.points });
      this.hold = null;
    }
  }

  _stamina(dt, control) {
    for (let i = 0; i < 2; i++) {
      const f = this.f[i];
      const dominant = this.isDominant(i);
      const busy = this.attempt && this.attempt.by === i;
      // Being on top is rest; being under someone is not. That asymmetry is
      // the reason position is worth points in the first place.
      // Measured against what the fight actually spends. A minute of purple
      // belt costs the pair about 370 points in attempts alone and used to
      // return 234, so both men were flat on the floor thirty seconds in and
      // stayed there — which turned every cost check in the AI into a veto,
      // and is why the man on the bottom of back control never once tried to
      // get out. These rates let a fighter sustain about eight attempts a
      // minute, which is roughly what a five-minute match looks like.
      let rate = dominant ? 7.7 : this.isDominant(this.other(i)) ? 2.0 : 5.9;
      rate *= 0.7 + f.cardio * 0.7;
      if (busy) rate = 0;
      if (this.state === 'sub') rate = 0;
      const drive = control && control[i] ? control[i].drive : 0;
      f.stamina = clamp(f.stamina + rate * dt - drive * dt * 5, 0, 100);
      // Posture comes back slowly, and only when nobody is doing anything to
      // you.
      const pr = dominant ? 9 : 3.5;
      if (!this.attempt && this.state !== 'sub') {
        f.posture = clamp(f.posture + pr * dt, 0, 100);
      }
    }
  }

  // Standing, the left thumb walks the pair around the mat; on the ground it
  // is weight, and it only nudges the tangle. Either way the fight has to stay
  // on the mat, which is the referee's job and here is a clamp.
  _drift(dt, control) {
    const p = POSES[this.position];
    const c0 = control && control[0];
    if (!c0) return;
    const speed = p.ground ? 0.22 : 1.35;
    this.origin[0] = clamp(this.origin[0] + c0.mx * speed * dt, -4.6, 4.6);
    this.origin[2] = clamp(this.origin[2] + c0.mz * speed * dt, -4.6, 4.6);
    if (!p.ground) this.yaw += c0.turn * dt * 0.9;
    else this.yaw += c0.turn * dt * 0.2;
    this.drive = c0.drive;
    for (let i = 0; i < 2; i++) this.driveOf[i] = (control[i] && control[i].drive) || 0;
  }

  _timeUp() {
    const [a, b] = this.f;
    let w = null, by = 'points';
    if (a.points !== b.points) w = a.points > b.points ? 0 : 1;
    else if (a.advantages !== b.advantages) {
      w = a.advantages > b.advantages ? 0 : 1;
      by = 'advantages';
    } else {
      by = 'draw';
    }
    this._finish(w, by);
  }

  _finish(w, by) {
    this.state = 'over';
    this.winner = w;
    this.winBy = by;
    this.attempt = null;
    this.deny = null;
    if (by === 'submission') {
      this.emit(`${this.f[w].name} — ПОБЕДА СДАЧЕЙ`, 'win');
    } else if (by === 'draw') {
      this.emit('НИЧЬЯ', 'win');
    } else {
      this.emit(`${this.f[w].name} — победа по ${by === 'points' ? 'очкам' : 'преимуществам'}`, 'win');
    }
    this.onEvent({ kind: 'end', winner: w, by });
  }

  start() {
    this.state = 'live';
    this.emit('COMBATE', 'big');
  }

  emit(text, kind) {
    this.events.unshift({ text, kind, t: 0 });
    if (this.events.length > 6) this.events.pop();
  }
}
