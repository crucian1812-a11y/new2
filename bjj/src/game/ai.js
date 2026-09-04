// The opponent.
//
// It plays through exactly the same door the player does — flicks, taps, and a
// left thumb — so anything it can do the player can do and anything it cannot,
// neither can they. That constraint is worth more than any amount of cleverness
// behind it: an AI with private access to the sim always ends up feeling like
// it is cheating, because it is.
//
// What difficulty changes is reaction time and the quality of the read, not the
// rules. A white belt takes 600 ms to notice a pass and guesses the denial; a
// black belt takes 190 ms and mostly guesses right.

import { optionsFor } from './positions.js';
import { POSES } from './poses.js';
import { rand, randInt } from './rng.js';
import { CHAIN_AFTER } from './match.js';

const LEVELS = {
  white: { react: 0.62, read: 0.24, aggression: 0.5, patience: 1.5, tapSkill: 0.4 },
  blue: { react: 0.46, read: 0.4, aggression: 0.62, patience: 1.15, tapSkill: 0.58 },
  purple: { react: 0.34, read: 0.55, aggression: 0.72, patience: 0.9, tapSkill: 0.72 },
  brown: { react: 0.26, read: 0.66, aggression: 0.8, patience: 0.75, tapSkill: 0.82 },
  black: { react: 0.19, read: 0.78, aggression: 0.88, patience: 0.6, tapSkill: 0.92 },
};

// How much the AI wants to be in each position — [on top, underneath]. The
// two numbers are the entire strategy, and they have to be two numbers: a
// position is not worth anything on its own, only worth something to whoever
// is holding it. Rate mount as a single value and the AI happily dives under
// somebody to "reach" it.
// Standing was rated below every position on the mat, including the ones you
// are underneath, so nobody ever chose to disengage and nothing ever brought
// them back up: measured over a hundred and twenty matches the fight spent 1.5%
// of the clock on its feet. It fell over in the first four seconds and stayed
// there.
//
// On your feet you are not under anybody and a takedown is worth two, so it
// belongs above every bottom number and below every good top one. That one
// change is what makes disengaging a real option from the bottom and keeps it a
// bad one from the top, which is how it reads in a real match.
const VALUE = {
  STANDING: [5.0, 5.0], CLINCH: [5.5, 5.5], TURTLE: [4.5, 1.4],
  OPEN_GUARD: [5, 3.4], CLOSED_GUARD: [4.2, 3.8], HALF_GUARD: [6, 2.8],
  SIDE_CONTROL: [7.5, 1.4], KNEE_ON_BELLY: [8, 0.9], MOUNT: [9.5, 0.5],
  BACK: [10.5, 0.3],
  RNC: [14, 0], ARMBAR: [13, 0], TRIANGLE: [13, 0], KIMURA: [12, 0], GUILLOTINE: [11, 0],
};

// Where a transition leaves the person who ran it. This mirrors what the match
// does when it arrives, and it has to keep mirroring it — an AI valuing the
// wrong side of a position is an AI that sweeps itself.
function valueAfter(tr, match) {
  const v = VALUE[tr.to] || [4, 4];
  const destTop = POSES[tr.to].top;
  if (!destTop) return (v[0] + v[1]) / 2;
  return tr.becomes === 'bottom' ? v[1] : v[0];
}

function valueHere(match, i) {
  const v = VALUE[match.position] || [4, 4];
  if (!POSES[match.position].top) return (v[0] + v[1]) / 2;
  return match.isDominant(i) ? v[0] : v[1];
}

// Where the ring's beat is tight, copied from match.js. The AI aims at it, so
// the two have to agree; if they ever stop agreeing the belts stop meaning
// anything and nothing else says so.
const SUB_WINDOW = [0.64, 0.86];

export class AI {
  constructor(index, level = 'blue') {
    this.i = index;
    this.level = LEVELS[level] || LEVELS.blue;
    this.levelName = level;
    this.think = 0.4;
    this.reactTimer = -1;
    this.reactDir = null;
    this.subTapTimer = 0;
    this.subWant = 0.74;
    // How long since he last committed to something.
    //
    // `patience` is how long he thinks between decisions, and doubling it did
    // nothing to the pace because most decisions were already coming out as
    // "attack": the fight fired a transition every four seconds and held a
    // position for twelve, where a real one commits a handful of times in five
    // minutes and spends the rest setting up. This is the gap between
    // commitments, and it is a separate thing from how often he looks.
    //
    // Only the opponent has it. A cooldown the player can feel is a cooldown
    // that reads as the game not listening, and the point of the AI going
    // through the same door is that it can be slower without the door changing.
    // Nobody dives in off the whistle.
    //
    // The match opened with a takedown or a guard pull inside a second and a
    // half, because the first thing this loop ever did was pick the best move
    // on the board and take it. A real one opens with ten or twenty seconds of
    // hands: collar, sleeve, posture, and only then somebody commits. Starting
    // the commitment clock part-wound is the whole of it, and it is where most
    // of the standing time in a match actually comes from.
    this.commit = 7 + rand() * 7;
    this.control = { mx: 0, mz: 0, turn: 0, drive: 0 };
    this.wander = rand() * 10;
  }

  // The best move on the board right now, or null when there is nothing worth
  // doing. Factored out of the decision loop so the chain below can ask the
  // same question the ordinary decision does — the answer is a direction,
  // because the only thing either path does with it is hand it to `input`.
  _best(match) {
    const me = match.f[this.i];
    const opts = optionsFor(match.position, match.tagOf(this.i));
    const keys = Object.keys(opts);
    if (!keys.length) return null;
    const here = valueHere(match, this.i);
    let best = null, bestScore = -1e9;
    for (const k of keys) {
      const tr = opts[k];
      const gain = valueAfter(tr, match) - here;
      // Expected value, honestly computed: what it is worth times how likely
      // it is, minus what it costs when there is not much gas left.
      //
      // "How likely it is" used to be the table's nominal rate, which is the
      // same number in every position the fight has ever been in — so nobody
      // ever waited for a better moment, and submissions were attempted on men
      // whose posture was still at 46 out of 100. The live chance is what the
      // match can actually compute; how much of it a fighter sees is his belt.
      // A black belt reads the moment and waits for it; a white belt sees the
      // move and takes it.
      const live = match.chanceOf(tr, this.i);
      const seen = tr.base + (live - tr.base) * this.level.read;
      // The floor under the odds is lower for a submission, because a
      // submission is the one move whose value is so large that any floor at
      // all makes it worth taking cold: at 0.4 a choke on a fully postured man
      // still outscored everything on the board, so the read above changed
      // nothing and the fight parked in back control hunting it. At 0.15 a
      // cold one is worth a quarter of a set-up one and the black belt waits.
      const floor = tr.sub ? 0.15 : 0.4;
      let s = gain * (floor + seen) + tr.points * 0.5;
      s -= tr.cost * (me.stamina < 40 ? 0.09 : 0.03);
      if (me.stamina < tr.cost * 0.5) s -= 8;
      s *= 0.75 + this.level.aggression * 0.5;
      s += (rand() - 0.5) * 2.4 * (1.3 - this.level.read);
      if (s > bestScore) {
        bestScore = s;
        best = tr;
      }
    }
    return best ? { tr: best, score: bestScore } : null;
  }

  update(dt, match, onFlick, onTap) {
    const me = match.f[this.i];
    this.wander += dt;

    // Left thumb. Standing it circles and closes distance; on the ground it
    // leans into whatever it is trying to do.
    const ground = POSES[match.position].ground;
    const push = match.attempt && match.attempt.by === this.i ? 0.8 : 0.15;
    this.control.mx = ground ? 0 : Math.sin(this.wander * 0.5) * 0.5;
    this.control.mz = ground ? 0 : Math.cos(this.wander * 0.37) * 0.3;
    this.control.turn = ground ? 0 : Math.sin(this.wander * 0.21) * 0.4;
    this.control.drive = me.stamina > 30 ? push : 0;

    if (match.state === 'over') return;

    /* --- answering a threat --------------------------------------------- */
    const threat = match.attempt && match.attempt.defender === this.i && match.deny;
    if (threat) {
      if (this.reactTimer < 0) {
        this.reactTimer = this.level.react * (0.7 + rand() * 0.6);
        // The read. On a hit it answers correctly; on a miss it picks any
        // other direction, which is worse than doing nothing — as it should be.
        const right = rand() < this.level.read * (0.6 + me.posture / 250);
        const dirs = ['up', 'down', 'left', 'right'].filter((d) => d !== match.deny.dir);
        this.reactDir = right ? match.deny.dir : dirs[randInt(3)];
      }
      this.reactTimer -= dt;
      if (this.reactTimer <= 0 && this.reactDir) {
        onFlick(this.reactDir);
        this.reactDir = null;
      }
      return;
    }
    this.reactTimer = -1;

    /* --- the submission game -------------------------------------------- */
    if (match.state === 'sub') {
      const s = match.sub;
      this.subTapTimer -= dt;
      if (s.attacker === this.i) {
        // How often he catches the beat, stated rather than derived.
        //
        // It used to be an error width — `want` drawn around the middle of the
        // window with a spread of (1 - tapSkill) — and that made the ladder
        // saturate. By purple the spread was already narrower than the window,
        // so purple, brown and black all hit essentially every beat while
        // their defence went on improving, and the middle belts came out with
        // an attack far ahead of anything opposite it: purple finished 97% of
        // his matches. Skill is a hit rate, and a hit rate is what this says.
        // The ladder is measured, not chosen. It has to clear two things at
        // once: every belt under 85% of matches ending in a tap, and a black
        // belt still finishing far more than a white one against the same
        // opponent. At a white-belt hit rate of 0.53 nobody at the bottom
        // could finish anything (white 13%); at 0.69 the bottom finished
        // almost everything again (white 91%). 0.58 is where all four belts
        // come in under target and the fight still ends in a tap often enough
        // to be jiu-jitsu.
        const hit = 0.32 + this.level.tapSkill * 0.652;
        if (this.subTapTimer <= 0 && s.phase >= this.subWant) {
          onTap();
          this.subTapTimer = 0.12;
          this.subWant = rand() < hit
            ? SUB_WINDOW[0] + rand() * (SUB_WINDOW[1] - SUB_WINDOW[0])
            : rand() < 0.5
              ? rand() * SUB_WINDOW[0]
              : SUB_WINDOW[1] + rand() * (1 - SUB_WINDOW[1]);
        }
      } else if (this.subTapTimer <= 0) {
        // The defence has a rhythm too, and it is the same rhythm: an escape
        // winds up over about nine tenths of a second, so pressing sooner
        // spends the wind-up for a fraction of it. A belt is worth two things
        // here — reading which way to go, and waiting until the way is worth
        // going. Mashing is what a white belt does, and it is what mashing
        // should get him.
        const err = (1 - this.level.tapSkill) * 0.75;
        const want = 0.85 - rand() * err;
        if (s.sinceEscape < want) return;
        const right = rand() < this.level.read;
        const dirs = ['up', 'down', 'left', 'right'];
        onFlick(right ? s.escapeDir : dirs[randInt(4)]);
        this.subTapTimer = 0.12;
      }
      return;
    }

    /* --- choosing something to do --------------------------------------- */
    this.think -= dt;
    this.commit -= dt;
    if (this.think > 0 || match.state !== 'live') return;

    if (match.attempt) {
      // Chaining. During the last third of our own attack the next move is
      // pre-loaded, the way a player pre-loads a follow-up: it rides the
      // landing and fires the moment the position is there, with no pause in
      // between — which is the pressure a real opponent applies and the thing
      // that makes one. Only our own attack, only once it is all but decided,
      // and not every time: a grappler who chains everything telegraphs
      // everything. Someone else's attempt is none of our business until it
      // lands.
      if (match.attempt.by !== this.i) return;
      if (match.attempt.t < match.attempt.tr.time * CHAIN_AFTER) return;
      // Not gated on `commit`: a chain is a continuation of the move already
      // committed to, not a new commitment, and `commit` was just re-armed the
      // moment that move fired. Gated instead on chance and on the board still
      // having a next step worth taking — a grappler who chains everything
      // telegraphs everything, and a chain into a bad idea is a bad idea made
      // earlier.
      if (rand() < 0.5) return;
      const best = this._best(match);
      if (!best) return;
      // The same reserve as below: a man who is winning can wait, and a chain
      // is a commitment made earlier, so it asks for the same tank.
      const reserve = match.isDominant(this.i) ? 20 : 8;
      if (me.stamina - best.tr.cost * 0.45 < reserve) return;
      this.think = this.level.patience * (0.6 + rand() * 0.8);
      this.commit = 5.0 * (1.3 - this.level.aggression * 0.6) * (0.7 + rand() * 0.6);
      onFlick(best.tr.dir);
      return;
    }

    this.think = this.level.patience * (0.6 + rand() * 0.8);
    const best = this._best(match);

    // Keep something in the tank.
    //
    // Without this the fight settles at nought: the only brake on attacking was
    // being unable to afford it, so both men spent down to the floor and stayed
    // there — thirty seconds in, every cost check in this function became a
    // veto and the man underneath stopped trying to get out at all. Raising
    // recovery does not help, because the extra is spent the moment it arrives.
    //
    // A man who is winning can wait; a man who is losing cannot, and spends
    // what he has left. That is the whole of pacing, and it is one line.
    const reserve = match.isDominant(this.i) ? 20 : 8;
    if (best && me.stamina - best.tr.cost * 0.45 < reserve) {
      if (rand() < 0.3) onTap();
      return;
    }

    // Not yet. He has just committed to something and is working, not firing.
    // The grip fight is what he does in between, and it is what the set-up
    // actually is.
    if (this.commit > 0) {
      if (rand() < 0.85) onTap();
      return;
    }

    // Sitting still is a real option when everything on offer is a bad idea —
    // and it is not sitting still, it is a grip fight, which is what breaks
    // the other man's posture and buys the moment the move needed. Since the
    // scores above now fall when the moment is wrong, this is the branch that
    // performs the set-up, and it takes it nearly every time rather than half.
    if (!best || best.score < (match.isDominant(this.i) ? 0.4 : -2.5)) {
      if (rand() < 0.85) onTap();
      return;
    }
    // The same wait whatever he just did. Letting a submission come round twice
    // as fast read as sensible — the moment passes — and it turned two matches
    // in three into a tap: with the entry cheap to retry, back control became a
    // man hunting the same choke over and over instead of a position.
    this.commit = 7.0 * (1.3 - this.level.aggression * 0.6) * (0.7 + rand() * 0.6);
    onFlick(best.tr.dir);
  }
}

export const AI_LEVELS = Object.keys(LEVELS);
