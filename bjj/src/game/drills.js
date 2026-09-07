// The room where you do the same thing sixty times.
//
// A match is one pass at everything; a drill is everything at one thing. The
// game had no way to practise a move — you met the back take for the first
// time in the middle of a fight with a purple belt on you, missed it, and the
// position was gone for two minutes. That is not how anybody learns a
// technique and it is not how anybody learns a game either.
//
// A drill is one edge of the position graph, put in front of you over and over
// from the position it starts in, with the clock off and the score gone. Three
// rounds, and they are the three stages of how a technique is actually taught:
//
//   на месте     the partner stands there. You are learning where the button
//                is and what the move looks like when it works.
//   с защитой    the partner defends and does nothing else. Now the grip
//                fight and the posture matter, because a denied move is a
//                denied move whatever your chance was.
//   в спарринге  the partner is the belt you picked, whole. He attacks back,
//                and landing the thing you came to practise now costs you the
//                position you were holding to practise it from.
//
// The round you pass is the level you carry into a real match — see skills.js.
// Nothing else is carried: no points, no fatigue, no record. The mat is the
// same mat and the man is the same man, but the drill never touches the
// ladder.
//
// This file is presentation and bookkeeping only, the same rule tutorial.js
// runs on: it puts the pair where the drill starts, it counts what the player
// did through the same doors a real match uses, and it never reaches inside
// the match to change a rule or fake a result.

import { TRANSITIONS } from './positions.js';
import { POSES } from './poses.js';
import { SKILL_MAX } from './skills.js';

// The three rounds. `partner` is what the other man is allowed to do.
export const ROUNDS = [
  { id: 'still', title: 'НА МЕСТЕ', partner: 'none',
    hint: 'Партнёр стоит. Разбери движение.' },
  { id: 'deny', title: 'С ЗАЩИТОЙ', partner: 'defend',
    hint: 'Партнёр защищается. Ломай стойку и бери захват.' },
  { id: 'spar', title: 'В СПАРРИНГЕ', partner: 'full',
    hint: 'Партнёр работает целиком. Найди момент.' },
];

// Eight attempts a round, three of them landed.
//
// The first numbers here were six and four, and drill-check said no: the
// hardest move in the graph is worth 0.36 cold, which through the match's own
// chance function is about two attempts in five, and four of six at that rate
// comes off less than a third of the time. A drill you fail two times in three
// while doing everything right is not a drill, it is a slot machine.
//
// Three of eight instead, and the same three every round — what changes
// between rounds is the man in front of you, which is the whole point. The
// tool reports the pass rate of every drill in every round and the line is
// that the cooperative round comes off nine times in ten.
export const REPS = 8;
export const NEED = [3, 3, 3];

// Except on the moves the graph itself calls long shots. The back take out of
// closed guard is worth 0.24 cold and the note beside it in positions.js says
// so in words: "the one thing from here that is worth four points and almost
// never works". Asking for three of those is asking for something the move
// does not do, and drill-check measured it — 10% of sparring rounds passed,
// against 72% across the rest. Two, on anything under three tenths.
export const LONG_SHOT = 0.3;
export const needFor = (tr, round) => NEED[round] - (tr.base < LONG_SHOT ? 1 : 0);

// How much the partner is giving you: the posture he holds, and the grips he
// lets you have.
//
// A cooperative uke is not a rule change and it does not need one. Posture is
// already the match's own word for how broken the man you are working on is,
// and grip advantage is its word for who has got hold of whom; the chance
// function reads both, gently for an ordinary move and hard for a four-point
// position or a submission. That is not a quirk to work around — it is the
// difference between drilling a snap-down and drilling an armbar, and it is
// why a submission drill has to start from a partner who has given you the
// setup. The drill is about the finish; the sparring round is where you have
// to earn the setup yourself, and there both numbers are the fight's own.
//
// Without the grips the armbar drill measured zero passes in a hundred at
// every round, which is the tool doing its job: the fiction says you finish a
// man you have already broken, and a drill that will not break him for you is
// asking for something the game does not allow.
export const POSTURE = [20, 55, 100];
export const GRIP = [1, 0.7, 0];

// Every edge is drillable, including the ones you are on the wrong end of:
// the escape from the back is a technique in exactly the way the back take is,
// and it is the one a beginner needs first.
//
// The order is the graph's own, which is the order a fight walks through
// them — standing, clinch, guard, the passes, the top positions, the
// submissions — so the list reads like a syllabus rather than a dump.
export const DRILLS = TRANSITIONS.map((tr, i) => ({ tr, i }));

// What to put in front of the player first.
//
// Least drilled first, and inside that the graph's own order. Not "the ones
// you fail most", which was the first idea and needs a match history the game
// only has after somebody has already played — this works on a fresh install,
// which is where a training mode is worth the most.
//
// And not "the most valuable first", which was the second idea and looked
// broken on the screen: it opens the room with four rows in a row all called
// «Выход на спину», because the graph has four ways to take a back and they
// are all worth four points. The graph's order walks standing, clinch, guard,
// the passes, the top positions, the submissions — a page of it is a page of
// one part of the fight, which is what a syllabus is.
export function drillOrder(skills) {
  return DRILLS.slice().sort((a, b) => {
    const la = skills.level(a.tr), lb = skills.level(b.tr);
    if (la !== lb) return la - lb;
    return a.i - b.i;
  });
}

// Which of the two men has to be the player for this drill to be the player's
// drill. Standing and the clinch belong to both, and the table says so by
// registering those edges under 'any'.
function roleFor(tr) {
  const p = POSES[tr.from];
  if (!p || !p.top || tr.role === 'any') return null;
  return tr.role === 'top' ? p.top : (p.top === 'A' ? 'B' : 'A');
}

export class Drill {
  constructor(entry, round = 0, skills = null) {
    this.tr = entry.tr;
    this.round = Math.max(0, Math.min(ROUNDS.length - 1, round));
    this.skills = skills;
    this.tries = 0;
    this.hits = 0;
    this.phase = 'set';   // set | live | beat | done
    this.beat = 0;
    this.passed = false;
    this.raised = false;
    this.live = null;     // the attempt of ours that is in flight
    this.last = null;     // 'hit' | 'miss' | 'denied', for the banner
    // One mark an attempt, in order, so the banner can draw the round as a row
    // of pips rather than as two numbers that have to be read.
    this.marks = [];
  }

  get need() { return needFor(this.tr, this.round); }
  get left() { return REPS - this.tries; }
  // Still winnable? Once the misses outnumber what is left, the round is lost
  // and there is no reason to make somebody sit through the rest of it.
  get alive() { return this.hits + this.left >= this.need; }

  // Put the pair where the drill starts. Called at the top and after every
  // attempt, and it is a reset rather than a rewind: the point of a drill is
  // that the twentieth rep starts exactly where the first one did.
  reset(match) {
    const want = roleFor(this.tr);
    if (want) match.roleOf = want === 'A' ? ['A', 'B'] : ['B', 'A'];
    match.roleShown = match.roleOf.slice();
    match.position = this.tr.from;
    match.prevPosition = this.tr.from;
    match.blend = 1;
    match.blendTo = 1;
    match.pending = null;
    match.queued = null;
    match.buffer = null;
    match.attempt = null;
    match.deny = null;
    match.sub = null;
    match.hold = null;
    match.landing = false;
    match.cool = [0, 0];
    match.posT = 0;
    match.stallTimer = 0;
    match.paid = [new Set(), new Set()];
    match.gripAdv = [0, 0];
    match.gripFight = [0, 0];
    // Nobody is out of breath at the start of a rep. A drill that runs a man
    // down over six attempts measures his cardio, and the ladder already has a
    // place for that.
    for (const f of match.f) { f.stamina = 100; f.posture = 100; f.points = 0; f.advantages = 0; }
    match.f[1].posture = POSTURE[this.round];
    match.gripAdv[0] = GRIP[this.round];
    match.state = 'live';
    match.winner = null;
    match.winBy = null;
    this.live = null;
  }

  // Whether the partner's flick should be let through this round. A defending
  // partner answers threats and starts nothing, and the honest way to say that
  // is by what the flick is *for* at the moment it is thrown, not by teaching
  // the AI a second personality.
  letThrough(match) {
    const p = ROUNDS[this.round].partner;
    if (p === 'full') return true;
    if (p === 'none') return false;
    return !!(match.attempt && match.attempt.defender === 1 && match.deny);
  }

  // Does the partner get to move at all this round?
  get partnerThinks() { return ROUNDS[this.round].partner !== 'none'; }

  update(dt, match) {
    if (this.phase === 'done') return;
    // The sparring partner can catch you. That costs an attempt and nothing
    // else: ending the round on it was the first rule here, and drill-check
    // said the triangle drill then passed zero times in a hundred — the man on
    // top of your closed guard submits you long before you have had three
    // goes, and a drill that ends the first time the partner wins is not a
    // drill, it is a match with a worse scoreboard.
    if (match.state === 'over') {
      this.tries++;
      this.marks.push('miss');
      this.last = 'miss';
      this.live = null;
      this.phase = 'beat';
      this.beat = 0.9;
      return;
    }

    if (this.phase === 'beat') {
      this.beat -= dt;
      if (this.beat <= 0) {
        if (this.tries >= REPS || !this.alive) this._finish();
        else { this.reset(match); this.phase = 'set'; }
      }
      return;
    }

    // Ours, in flight. Anything else — the partner attacking in the sparring
    // round, or a press of ours at some other button — is the fight happening
    // around the drill and is none of the drill's business.
    if (!this.live && match.attempt && match.attempt.by === 0 && match.attempt.tr === this.tr) {
      this.live = match.attempt;
      this.phase = 'live';
      return;
    }
    if (this.live && match.attempt !== this.live) {
      const landed = match.position === this.tr.to;
      this.tries++;
      if (landed) { this.hits++; this.last = 'hit'; }
      else this.last = this.live.denied ? 'denied' : 'miss';
      this.marks.push(this.last);
      this.live = null;
      this.phase = 'beat';
      // Long enough to watch it land, short enough not to be a wait.
      this.beat = landed ? 1.1 : 0.8;
      return;
    }

    // The sparring partner can take the position out from under the drill. It
    // is not a failed attempt — the player never pressed — so it costs nothing
    // but the reset it needs.
    if (!this.live && match.position !== this.tr.from && !match.attempt) {
      this.phase = 'beat';
      this.beat = 0.7;
      this.last = null;
    }
  }

  _finish() {
    this.phase = 'done';
    this.passed = this.hits >= this.need;
    if (this.passed && this.skills) {
      this.raised = this.skills.raise(this.tr, Math.min(SKILL_MAX, this.round + 1));
    }
  }
}
