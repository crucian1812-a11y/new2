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
import { optionsFor, visualTo, TRANSITIONS, DIRS, SUB_KIND, POINTS_TO_HOLD, SUB_TIMEOUT, GRIP_LOSS } from './positions.js';
import { clamp, lerp } from '../core/m4.js';
import { rand, randInt, pick } from './rng.js';

export const MATCH_TIME = 300;

const DENY_WINDOW = 0.44; // seconds the defender has to read and answer
// How long the fight may go without getting anywhere before the referee says
// something, and how often he says it after that.
//
// "Without getting anywhere" and not "without anybody trying". The timer used
// to reset on every attempt, which meant a man on top could fail the same pass
// eight times in a row and never be called for it — and that is exactly the
// shape stalling takes. It resets when the position actually changes now, so
// what it counts is progress. Twenty-five seconds is generous: a position that
// is going somewhere changes hands well inside it.
export const STALL_CALL = 20;
const STALL_AGAIN = 8;
// Posture at or above this and you can see which way it is coming; below it
// you know only that it is coming. See visibleDeny.
//
// Set from the distribution, not from taste: over ten thousand denial prompts
// across the four belts, the defender's posture at the moment the prompt goes
// up has a median of 67 to 84 and a lower quartile of 24 to 42. At 45 the
// arrow was hidden for a quarter of prompts in the sim and for none at all in
// front of a player, because a player who denies everything is never under
// enough pressure to lose his posture — the thumb answered 35 of 35 with the
// gate in. At 70 it is hidden about half the time, and the loop closes: miss
// one, get flattened, see less, miss more.
const DENY_READ = 70;
// How long a press waits for the game to be ready for it. See input().
const BUFFER_HOLD = 0.5;

// The competition square is eight metres, so its edge is four from the middle.
// A second and a bit outside it is a referee noticing rather than a referee
// twitching, and coming back at a metre and a half a second is a walk.
const MAT_HALF = 4;
const OUT_PATIENCE = 1.2;
const RECALL_SPEED = 1.5;

// How long a submission can be on before the man in it stops being able to
// read the way out, in seconds. See visibleEscape.
//
// Two and a bit seconds is about four honest chances: a hand answers the arrow
// in front of it roughly every third of a second and needs a fifth of a second
// to move. Chosen by sweeping it against tools/escape-check.mjs rather than by
// taste — at 1.0 the hand gets out of 37% of what a blue belt puts on it and
// 4% of a black belt's, which is a mini-game nobody survives; at 3.0 it is 82%
// and 33%, which is one nobody loses to at the bottom of the ladder. At 2.2 it
// is 72% and 22%, which puts a player's defence beside the AI's own — the sim
// has AI defenders stripping the grip in 63 to 94% of locks — and leaves the
// belts meaning something on this half of the game: your first opponents can
// be survived and the last one mostly cannot.
const GRIP_READ = 2.2;

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
    this.blend = 1; // 0 = prevPosition, 1 = position (or `pending`, in flight)
    this.blendSpeed = 4;
    // Where the blend is going, which is not always forwards.
    //
    // An attempt runs the pair 82% of the way to its destination, and both
    // outcomes used to break the picture: arriving reset `blend` to 0 and
    // replayed the same blend from the top, and failing pointed `prevPosition`
    // at `position` so the bodies cut back to the pose they left. flow-check
    // counted 117 of those jumps in an average match, the worst the whole
    // length of a blend. Neither is a small artefact — the eye reads a body
    // that returns to where it has already been as the game glitching.
    //
    // So the blend has a direction. Arriving carries the parameter it already
    // has and finishes it; failing runs the same parameter back down to zero
    // over a third of a second, which is what giving up on a position looks
    // like from the outside.
    this.blendTo = 1;
    this.pending = null;
    // A transition waiting for the picture to finish unwinding before it runs.
    this.queued = null;
    // A press the game could not use yet. See input().
    this.buffer = null;
    // Role A of the paired pose is always the better position; who is playing
    // it changes every time somebody sweeps.
    this.roleOf = ['A', 'B'];
    // Who each man is *drawn* as, which lags roleOf across a sweep.
    //
    // A sweep blends to the mirror of its destination and the roles change
    // hands on arrival, and those two have to happen in the same frame or the
    // picture jumps: the mirror only renders the same as the base pose once the
    // blend is all the way there. The sim needs the new roles at once — the
    // three-second count and the escape rule both read isDominant — so roleOf
    // flips on arrival as it always did, and this holds the old assignment for
    // the tenth of a second it takes the blend to land.
    this.roleShown = ['A', 'B'];
    this.landing = false;
    this.time = opts.time ?? MATCH_TIME;
    this.limit = this.time;
    this.state = 'ready'; // ready | live | sub | over
    this.attempt = null;
    this.deny = null;
    this.sub = null;
    this.cool = [0, 0];
    // How long each cooldown was when it started, so the ring can draw how much
    // of it is left rather than guessing against a constant. They run from 0.18
    // after somebody else's move to 0.9 after a submission comes apart, and a
    // sweep drawn against a flat third of a second sat full and then jumped.
    this.coolFull = [0.3, 0.3];
    this.hold = null; // pending points
    this.posT = 0;    // seconds in the current position, however it was reached
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
    // Out of bounds, and being walked back in. See _drift.
    this.outT = 0;
    this.recall = false;
    this.yaw = 0;
    this.intensity = 0;
    // Which positions each of them has already been paid for, this time round.
    //
    // The sheet says a position scores once: to score mount again you have to
    // lose it and take it back, and stepping from mount to the back and rolling
    // down again is one possession, not three. Without that the graph pays for
    // a loop — mount to back is worth four and back to mount is free and almost
    // certain — and the fight farmed it: back was being paid twelve times in a
    // match, mount seven, and the two of them were thirty of the thirty-four
    // points on the board. A scoreboard reading 51:41 is not a scoreboard.
    //
    // A man's slate is wiped the moment he is not on top any more, which is
    // exactly the escape the sheet is asking for.
    this.paid = [new Set(), new Set()];
    this.gripAdv = [0, 0]; // won grip exchanges, decays
    // A hand thrown at the other man's collar, and the half-second it takes to
    // throw it and come back. The grip fight happens two hundred and fifty
    // times in a match and until now the only trace of it was an arc in the
    // corner of the HUD: the hands themselves did nothing, in a sport where
    // hands fighting for cloth is the most continuously visible thing there is.
    this.gripFight = [0, 0];
    this.driveOf = [0, 0]; // how hard each of them is leaning in, this frame
    this.onEvent = opts.onEvent || (() => {});
    this.stallTimer = 0;
    this.stalls = 0;
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
    // And what he can pay for.
    //
    // This used to hand back everything the graph offers and let the press find
    // out: the ring drew four bright labels, one of them cost more than he had
    // left, and flicking it produced a line of text and nothing else. Measured
    // across forty matches it was 15% of every label the ring put up — and the
    // moves it hits are the expensive ones, which are the ones worth points.
    // The ring already knows how to draw "there, but not yet"; it was never
    // told that this was one of those.
    const all = optionsFor(this.position, this.tagOf(i));
    const out = {};
    for (const dir in all) if (this.f[i].stamina >= all[dir].cost * 0.35) out[dir] = all[dir];
    return out;
  }

  // What this role has from here, whether or not it can be pressed yet.
  //
  // The ring used to be drawn from `options` alone, so for the third of a
  // second of cooldown after every transition all four labels went dark and
  // came back — the player was reading a blank ring for eight per cent of the
  // match with nothing saying why. The names are worth showing while they are
  // recharging; what changes is whether they look pressable.
  preview(i) {
    if (this.state !== 'live') return {};
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
    if (this.state !== 'live') return null;

    // A press the game cannot use *yet* is remembered, not thrown away.
    //
    // Two things block a flick for a moment and both used to swallow it in
    // silence: your own attempt still in flight, and the cooldown after the
    // last one. Measured with a scripted thumb playing real matches, nineteen
    // of its fifty-seven attacking flicks went nowhere for the first reason —
    // a third of everything the hand did. The ring dims while it happens,
    // which says "not yet", and the game then answered "no" anyway.
    //
    // Half a second, which is the fighting-game convention and is short for a
    // reason: a flick thrown at the start of a one-second throw was meant for
    // a fight that no longer exists, and replaying it there would be a second
    // kind of lie. Late presses land; early ones expire.
    const blocked = this.attempt || this.cool[i] > 0;
    const tr = optionsFor(this.position, this.tagOf(i))[dir];
    if (!tr) return null;
    if (blocked) {
      this.buffer = { i, dir, t: 0 };
      return 'queued';
    }
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
      // When the picture started moving, which is not when the clock did: the
      // last move may still be landing or unwinding, and taking the blend over
      // mid-flight is the cut this field exists to avoid.
      vis: null,
    };
    // Deliberately not touching blendTo here. A new attempt can be fired while
    // the last failed one is still unwinding, and forcing the blend forwards
    // again ran the picture all the way into a position the fight never
    // entered — and then left it there, because the attempt that owned the
    // picture had already been replaced. The unwind finishes on its own, and
    // _liveUpdate takes the blend over when there is a blend to take over.
    // The decoy is drawn once, here, so a narrowed read is a stable pair to
    // choose between rather than two arrows that swap places every frame.
    this.deny = tr.deny
      ? {
        dir: tr.deny, t: 0, window: DENY_WINDOW, by: this.other(i),
        decoy: pick(DIRS.filter((d) => d !== tr.deny)),
      }
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

  // What the man being attacked can actually see coming.
  //
  // The prompt used to name the direction outright, and tools/thumb.mjs showed
  // what that is worth: a scripted hand answered twenty-three denial prompts
  // out of twenty-three and both matches finished 2:0 with not one submission
  // attempted by either man. A 0.44 s window is twice a human's reaction, so
  // if the answer is written on the screen the defence is free and nothing the
  // opponent does can ever land.
  //
  // Posture is what pays for it. Upright, you read the attack and the arrow is
  // there; flattened, you know it is coming and not where — which is what
  // being flattened is, and it gives the posture bar a meaning on the player's
  // side of the screen for the first time.
  //
  // Deliberately not a stamina cost, which was tried first: it fell on the AI
  // in proportion to how often it denies, so the high belts drained themselves
  // holding frames and the ladder flattened — white beat blue 63% of the time
  // and black 63%, against 45% and 90% before. This costs the AI nothing at
  // all: the AI has never read the prompt, it reads `level.read`.
  // What the defender can read: the direction, a pair to choose between, or
  // nothing but four arrows.
  //
  // This used to be all or nothing, and the nothing swallowed the game. Two
  // gates hid the arrow — being underneath, and having lost your posture — and
  // each was reasonable on its own. Together, measured with a thumb on the real
  // page, twenty-five of twenty-eight prompts came up blind, which is a coin
  // flip between four doors, and the loop had no floor: go blind, get passed,
  // lose more posture, go blinder. It lost every match it played, 0:11, 2:7,
  // 2:11, while landing 47% of its own attacks — it could attack and it could
  // not defend.
  //
  // So the gates narrow the read instead of closing it. Underneath and
  // flattened is still worse than upright and level, which is the point of
  // both, but the worst case is one guess in two rather than one in four, and
  // a player who reads well is rewarded for it at every level of pressure.
  denyRead(i) {
    if (!this.deny || !this.attempt || this.attempt.defender !== i) return null;
    let doors = 0;
    // Underneath, you do not see him wind up.
    if (this.isDominant(this.attempt.by)) doors++;
    // Flattened, you are not reading anything.
    if (this.f[i].posture < DENY_READ) doors++;
    if (doors === 0) return [this.deny.dir];
    if (doors === 1) return [this.deny.dir, this.deny.decoy];
    return DIRS.slice();
  }

  // The one direction, when it is the one direction. Kept because the sure
  // case is what most of the HUD and the thumb ask about.
  visibleDeny(i) {
    const r = this.denyRead(i);
    return r && r.length === 1 ? r[0] : null;
  }


  // And the same question for the man in the lock: can he see the way out?
  //
  // Written after the drill that finally put the thumb underneath. A hand with
  // a human's delay, doing nothing but reading the arrow, escaped **six locks
  // out of six** in three and a half seconds each — the defensive half of the
  // submission was a cutscene with a swipe in it, exactly as the denial prompt
  // was before it got this same treatment.
  //
  // The rule is the shape of the fix that worked there: not a cost, which
  // always lands on whoever uses the mechanic most, but a fact about the
  // position. Early in a lock there is still room and you can feel where it
  // is; once it is sunk you are guessing, and guessing is one direction in
  // four. `GRIP_READ` is where "still room" ends, on the same meter the ring
  // is drawn from, so what the player sees and what the rule reads are the
  // same number.
  //
  // It costs the AI nothing — like the denial prompt, the AI never read this,
  // it rolls its own `read` against its belt — so the belt ladder in sim-check
  // does not move and cannot be used to judge it. Only the thumb can.
  visibleEscape(i) {
    const s = this.sub;
    if (!s || s.defender !== i) return null;
    return s.age < GRIP_READ ? s.escapeDir : null;
  }

  // The tap on the right pad: a grip fight. Wins tilt the next transition.
  grip(i) {
    if (this.state !== 'live' || this.cool[i] > 0) return null;
    const me = this.f[i];
    const you = this.f[this.other(i)];
    if (me.stamina < 6) return null;
    me.stamina -= 4;
    this.gripFight[i] = 1;
    const mine = 0.5 + (me.technique - you.technique) * 0.45 + (me.stamina - you.stamina) / 320;
    if (rand() < clamp(mine, 0.12, 0.88)) {
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
    this.posT += dt;

    for (let i = 0; i < 2; i++) this.cool[i] = Math.max(0, this.cool[i] - dt);
    for (let i = 0; i < 2; i++) this.gripAdv[i] = Math.max(0, this.gripAdv[i] - dt * 0.16);
    for (let i = 0; i < 2; i++) this.gripFight[i] = Math.max(0, this.gripFight[i] - dt / 0.55);

    if (this.blend < this.blendTo) {
      this.blend = Math.min(this.blendTo, this.blend + dt * this.blendSpeed);
    } else if (this.blend > this.blendTo) {
      this.blend = Math.max(this.blendTo, this.blend - dt * this.blendSpeed);
    }
    // A retreat that has arrived is simply the position being held again, and
    // the hold loop only runs when the two ends of the blend are the same pose.
    // A sweep that has finished travelling to the mirror: swap the two of them
    // over in the one frame where doing so changes nothing on screen.
    if (this.landing && this.blend >= 1) {
      this.landing = false;
      this.pending = null;
      this.prevPosition = this.position;
      this.roleShown = [this.roleOf[0], this.roleOf[1]];
    }
    if (this.blendTo === 0 && this.blend <= 0 && this.pending) {
      this.pending = null;
      this.prevPosition = this.position;
      this.blend = 1;
      this.blendTo = 1;
      this.landing = false;
      this._flushQueued();
    }
    // The buffered press, once whatever was in its way has gone.
    if (this.buffer) {
      this.buffer.t += dt;
      const b = this.buffer;
      if (b.t > BUFFER_HOLD) this.buffer = null;
      else if (this.state === 'live' && !this.attempt && this.cool[b.i] <= 0) {
        this.buffer = null;
        this.input(b.i, b.dir);
      }
    }

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
      this._stall();
      return;
    }
    if (this.deny) {
      this.deny.t += dt;
      if (this.deny.t > this.deny.window) this.deny = null;
    }
    a.t += dt;
    this.intensity = lerp(this.intensity, 1, dt * 6);
    const dur = a.tr.time;
    if (a.t < dur) {
      // Let the last move finish before starting the next one.
      //
      // A transition can be fired while the pair is still landing in the
      // position it just reached, or still unwinding out of one that failed,
      // and taking the blend over at that moment threw away whatever was left:
      // the bodies were 85% of the way somewhere and the next frame had them at
      // the start of a different journey. The attempt's own clock keeps
      // running through the wait, so nothing is lost but the cut — the picture
      // simply sets off a beat later and travels at the same rate.
      const settled = !this.pending && (this.prevPosition === this.position || this.blend >= 1);
      if (a.vis === null) {
        if (!settled) return;
        a.vis = a.t;
      }
      // The blend towards the destination runs while the attempt is live, so a
      // contested pass looks contested: bodies already halfway there, and then
      // either arriving or snapping back.
      this.blend = Math.min(0.82, (a.t - a.vis) / dur);
      this.prevPosition = this.position;
      this.pending = visualTo(a.tr, this.roleOf[a.by]);
      this.blendTo = 1;
      return;
    }
    this._resolve(a);
  }

  // The referee's one job, and the field that has been counting it since the
  // first version of this file without anybody reading the number.
  //
  // A position held with nothing being attempted from it is free: the man on
  // top rests at five and a half stamina a second and the clock runs out. That
  // is not a tactic the sheet rewards — it is stalling, and a referee stops it.
  // So after twelve quiet seconds he says so, and says it again every eight
  // after that, and the man in the better position pays for the silence
  // because it is worth more to him.
  _stall() {
    if (this.stallTimer < STALL_CALL) return;
    this.stallTimer = STALL_CALL - STALL_AGAIN;
    const top = this.isDominant(0) ? 0 : this.isDominant(1) ? 1 : -1;
    this.stalls++;

    // The second call is the one with teeth.
    //
    // A referee who only ever says "work" is a referee nobody has to listen to,
    // and the fight had learned that: measured over a hundred and twenty
    // matches it spent 1.5% of the clock on its feet, which is to say it fell
    // to the floor in the first four seconds of the first round and never stood
    // up again. Standing, the clinch, both takedowns, the break and the
    // technical stand-up — a quarter of the graph — were scenery.
    //
    // So he stands them up, which is what he does. It costs the man on top the
    // position he was sitting on, which is the point: sitting on one is what
    // the call is for.
    if (this.stalls >= 2 && POSES[this.position].ground) {
      // Not in the middle of something. Standing them up while a blend is
      // still running throws away however much of it was left, and the timer
      // is still counting, so waiting a fraction of a second costs nothing.
      if (this.pending || (this.prevPosition !== this.position && this.blend < 1)) {
        this.stalls = 1;
        this.stallTimer = STALL_CALL - 0.5;
        return;
      }
      this.stalls = 0;
      this.hold = null;
      this.paid = [new Set(), new Set()];
      this.prevPosition = this.position;
      this.position = 'STANDING';
      this.pending = null;
      this.landing = false;
      this.blend = 0;
      this.blendTo = 1;
      this.blendSpeed = 1.4;
      // Roles are deliberately not *reset*. Standing has no top, so they decide
      // nothing there — but they decide which body is which, and resetting them
      // exchanged the two men in a single frame on the way up.
      //
      // They do have to be brought back into step. Standing them up in the
      // middle of a sweep's landing cancels the landing, and roleShown is
      // holding the assignment from before it — left there it stays a frame
      // behind for the rest of the match.
      this.roleShown = [this.roleOf[0], this.roleOf[1]];
      this.cool = [0.5, 0.5];
      this.coolFull = [0.5, 0.5];
      this.emit('судья: в стойку', 'warn');
      this.onEvent({ kind: 'standup' });
      return;
    }

    if (top < 0) {
      this.emit('судья: работайте', 'warn');
    } else {
      this.f[top].stamina = clamp(this.f[top].stamina - 9, 0, 100);
      this.emit(`судья: ${this.f[top].name}, работай`, 'warn');
    }
    this.onEvent({ kind: 'stall', on: top });
  }

  _resolve(a) {
    const tr = a.tr;
    const me = this.f[a.by];
    const you = this.f[a.defender];
    this.attempt = null;
    this.deny = null;
    // `pending` is deliberately left alone here: it is how goTo and _snapBack
    // tell that there is a blend already in flight to pick up or to unwind.

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

    if (rand() > p) {
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
      if (tr.sub && rand() < 0.4) {
        const out = this._escapeFrom(this.position);
        if (out) {
          me.posture = clamp(me.posture - 8, 0, 100);
          this.emit(`${you.name}: вывернулся`, 'escape');
          // Unwind out of the attack first, then leave. Going straight from
          // "four fifths of the way into a choke" to "the start of a scramble
          // out of the back" is a cut of the whole blend, and it is also the
          // wrong story: he fights the choke off, and then he moves.
          //
          // Queued before the unwind is asked for, not after: an attempt whose
          // whole duration went on waiting for the previous move to land never
          // owns a blend, so there is nothing to unwind and _snapBack has to be
          // able to let the escape straight through. Set afterwards it was
          // stranded, and the escape vanished without a trace.
          this.queued = { tr: out, by: a.defender };
          this._snapBack(a.by, 0.8);
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
    // And so is a four-point position, more gently. You take a man's back when
    // he gives it to you, which is to say when he is already broken; you do
    // not stand up off a mount and walk round. Without this the gate above
    // pushed the fight the wrong way — the armbar from mount went cold, the
    // back take beside it did not, and back control's share of the clock went
    // up rather than down.
    else if (tr.big) p *= 0.55 + 0.3 * (1 - you.posture / 100) + 0.25 * this.gripAdv[by];
    // Nobody holds a man down forever.
    //
    // The man underneath is working the whole time he is under there — finding
    // the frames, feeling where the weight is — and the longer it goes on the
    // better his chance of getting out. Nothing in the graph said so, and back
    // control became a place the fight moved into and did not leave: everyone
    // took it from mount, nobody lost it, and it owned a third of the clock at
    // three belts out of four. This is the pressure that was missing, and it
    // only bites when a position drags.
    if (!this.isDominant(by)) p *= 1 + Math.min(1, this.posT / 25) * 0.6;
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
    return pick(outs);
  }

  // A transition that did not come off. The pair is most of the way to
  // somewhere else, and it has to come back — over about a third of a second,
  // not between two frames. `pending` stays until it lands, because it is the
  // far end of the blend the pair is still on.
  _snapBack(by, cool) {
    if (this.pending && this.pending !== this.position) {
      this.blendTo = 0;
      this.blendSpeed = Math.max(this.blend, 0.05) / 0.35;
    } else {
      this.pending = null;
      this.prevPosition = this.position;
      this.blend = 1;
      this.blendTo = 1;
      this._flushQueued();
    }
    this._cool(by, cool);
  }

  _cool(i, secs) {
    this.cool[i] = secs;
    this.coolFull[i] = secs;
  }

  // A transition parked behind an unwind, once the unwind is done — or at once,
  // if there was never anything to unwind.
  _flushQueued() {
    if (!this.queued) return;
    const q = this.queued;
    this.queued = null;
    this.goTo(q.tr, q.by);
  }

  // Arrive somewhere. This is the only place the position, the roles and the
  // pending score change, which is what keeps sweeps from quietly corrupting
  // whose points are whose.
  goTo(tr, by) {
    this.posT = 0;
    this.stallTimer = 0;
    this.stalls = 0;
    const me = this.f[by];
    const you = this.f[this.other(by)];
    // Pick up the blend the attempt already ran rather than replaying it. The
    // pair is 82% of the way to exactly this pose; starting again from zero is
    // the single most visible break in the game.
    // Which pose the picture is actually heading for. It depends on the role
    // the attacker is holding *now*, before anything below reassigns it — out
    // of the stance either man can shoot and only one of the two answers is a
    // change of places.
    const dest = visualTo(tr, this.roleOf[by]);
    const carrying = this.pending === dest && this.prevPosition !== this.pending;
    // A blend that is still travelling to the mirror keeps travelling. Cutting
    // the far end over to the unmirrored pose here is a swap of both bodies in
    // one frame, which is the thing the mirror exists to stop.
    const landing = carrying && dest !== tr.to;
    if (!carrying) {
      this.prevPosition = this.position;
      this.blend = 0;
    }
    if (!landing) this.pending = null;
    this.landing = landing;
    const shownBefore = [this.roleOf[0], this.roleOf[1]];
    this.blendTo = 1;
    this.position = tr.to;
    this.blendSpeed = 1 / Math.max(0.22, tr.time * 0.55);

    // `swap` used to be here, on seven edges, and it never did anything: every
    // one of them lands somewhere with a top, and the two lines below assign
    // both roles outright a moment later. Removed with the `mirror` flag it sat
    // beside — the exchange is real, but it is these two lines that make it.
    //
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

    // Held back until the blend lands, when the mirror and the base pose are
    // the same picture and the exchange costs nothing.
    this.roleShown = landing ? shownBefore : [this.roleOf[0], this.roleOf[1]];

    you.posture = clamp(you.posture - (tr.big ? 22 : 12), 0, 100);
    me.posture = clamp(me.posture + 6, 0, 100);
    this._cool(by, 0.3);
    this._cool(this.other(by), 0.18);
    you.flash = 1;

    if (tr.sub) {
      this._startSub(by, tr);
      return;
    }

    // Whoever is not on top has escaped whatever he was under, so everything
    // he was holding is his to win again.
    for (let i = 0; i < 2; i++) if (!this.isDominant(i)) this.paid[i].clear();

    if (tr.points > 0 && !this.paid[by].has(tr.to)) {
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
      s.escapeDir = dirs[randInt(4)];
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
      this._cool(s.attacker, 0.9);
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
      this.paid[by].add(this.hold.pos);
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

    // The referee's one job, and until now nobody did it.
    //
    // The mat is an eight-metre square and the drift was clamped at 4.6, which
    // is not a rule, it is a wall: a thumb held in one direction walks the pair
    // into it in six seconds and the fight goes on there. The AI never does
    // this — sim-check measures 0.0% of the clock off the square — but a hand
    // does it immediately, and the first run of the thumb that counted found
    // **85% of the match** being fought outside the competition area with both
    // men pinned against the clamp.
    //
    // So the sport's own rule: out of the square, and the referee stops them
    // and restarts in the middle in the position they were in. Nothing about
    // the fight itself changes — no points, no reset of the position, the
    // clock keeps running — the pair is simply walked back, and while they are
    // being walked back the left thumb does not steer.
    const out = Math.max(Math.abs(this.origin[0]), Math.abs(this.origin[2]));
    if (this.recall) {
      const d = Math.hypot(this.origin[0], this.origin[2]);
      const step = Math.min(d, RECALL_SPEED * dt);
      if (d > 1e-4) {
        this.origin[0] -= (this.origin[0] / d) * step;
        this.origin[2] -= (this.origin[2] / d) * step;
      }
      if (d - step < 1.6) this.recall = false;
      return;
    }
    this.outT = out > MAT_HALF ? this.outT + dt : 0;
    if (this.outT > OUT_PATIENCE) {
      this.outT = 0;
      this.recall = true;
      this.emit('СТОП — В ЦЕНТР', 'ref');
      this.onEvent({ kind: 'recall' });
      return;
    }
    // On the ground the left thumb is weight, not a throttle.
    //
    // It used to translate the pair at 0.22 m/s down there as well, and nothing
    // plants a contact in a ground position — the step planner only runs
    // standing, and says so: "on the ground the pose owns the feet completely".
    // So every point touching the tatami moved at exactly the drift speed:
    // measured at 0.22 m/s for the shoulder, hip and knee of a man lying on his
    // back, which is a body being slid across the mat rather than one moving on
    // it. Ice, in one number.
    //
    // What the thumb is *for* down there is already written down and already
    // wired: weight and hip pressure, which is `drive`, and it goes straight
    // into whether a transition lands. Taking the translation away costs the
    // ground game nothing it was using and takes the skating with it.
    const speed = p.ground ? 0 : 1.35;
    if (speed) {
      this.origin[0] = clamp(this.origin[0] + c0.mx * speed * dt, -4.6, 4.6);
      this.origin[2] = clamp(this.origin[2] + c0.mz * speed * dt, -4.6, 4.6);
    }
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
    this.queued = null;
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
