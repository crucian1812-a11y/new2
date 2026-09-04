// The first minute.
//
// A scripted match for somebody who has never thrown a hip bump. A coach walks
// the player through the four verbs the whole game is built from — hold base,
// make a transition, fight for a grip, deny an attack — with the opponent
// standing there and not attacking until the defence step, so nothing is lost
// to pressure while the player is still finding the controls.
//
// It runs the real Match through the real input, so what the player learns is
// what the game is. The tutorial is presentation only: it reads the same state
// the HUD draws, and when the defence step needs an attack it drives the
// opponent through the same `input` door the player meets in a real match. It
// never reaches into the match to change a rule.

import { optionsFor } from './positions.js';

// One entry per verb, in the order a player meets them. `highlight` names the
// control the coach points at, which the HUD turns into a pulsing mark.
const STEPS = [
  {
    id: 'base',
    title: 'БАЗА',
    text: 'Левый палец держит базу — положи его слева и не убирай.',
    highlight: 'base',
  },
  {
    id: 'move',
    title: 'ПЕРЕХОД',
    text: 'Правым пальцем свайпни кнопку на кольце — это переход.',
    highlight: 'ring',
  },
  {
    id: 'grip',
    title: 'ЗАХВАТ',
    text: 'Коснись центра кольца, где написано «ЗАХВАТ».',
    highlight: 'grip',
  },
  {
    id: 'defend',
    title: 'ЗАЩИТА',
    text: 'Соперник атакует. Свайпни стрелку ЗАЩИТЫ, пока она горит.',
    highlight: 'deny',
  },
];

export class Tutorial {
  constructor() {
    this.i = 0;
    this.t = 0;          // time inside the current step
    this.hold = 0;       // how long the current condition has been satisfied
    this.saw = false;    // the one-shot gesture was seen, remembered past the prompt
    this.armed = false;  // the coach's opponent has an attack in flight
    this.attackDelay = 0;// wait before re-arming a defence that went unanswered
    this.done = false;
  }

  get step() { return STEPS[this.i] || null; }

  // The defence step's attack. The opponent is driven through the same door a
  // player would be, with a move that carries an answer, so the lesson is a
  // real read rather than a script. Any position the earlier steps can leave
  // the pair in offers the opponent a denyable move, so no reset is needed.
  _arm(match) {
    if (this.armed || match.attempt || match.state !== 'live') return;
    // The coach's partner does not gas out mid-lesson; the point is the read.
    match.f[1].stamina = 100;
    const opts = optionsFor(match.position, match.tagOf(1));
    for (const dir of ['up', 'down', 'left', 'right']) {
      if (opts[dir] && opts[dir].deny) {
        match.input(1, dir);
        this.armed = true;
        return;
      }
    }
  }

  // `did` is what the player's thumbs actually did this frame: `stick` held,
  // `moved` a transition started, `gripped` a grip fight, `denied` a denial.
  update(dt, match, did) {
    if (this.done) return;
    const s = STEPS[this.i];
    this.t += dt;

    if (s.id === 'defend') {
      this._arm(match);
      if (did.denied) { this._next(); return; }
      // The attack came and went without an answer — it landed, or failed on
      // its own. Let the player see the result, then go again.
      if (this.armed && !match.attempt && !match.deny) {
        this.attackDelay += dt;
        if (this.attackDelay > 1.2) {
          this.armed = false;
          this.attackDelay = 0;
        }
      }
      return;
    }

    // A flick or a tap is one frame, so it is remembered the moment it
    // happens: it must not be lost because the prompt was still up. Base is
    // not latched — it is a hold, not a gesture.
    if (s.id === 'move' && did.moved) this.saw = true;
    else if (s.id === 'grip' && did.gripped) this.saw = true;

    // A beat to read the prompt before it can be satisfied, so the coach's
    // words are not skipped by a thumb that was already on its way.
    if (this.t < 0.7) return;

    const ok = s.id === 'base' ? did.stick : this.saw;
    if (ok) this.hold += dt; else this.hold = 0;
    if (this.hold >= 0.3) this._next();
  }

  _next() {
    this.i++;
    this.t = 0;
    this.hold = 0;
    this.saw = false;
    this.armed = false;
    this.attackDelay = 0;
    if (this.i >= STEPS.length) this.done = true;
  }
}
