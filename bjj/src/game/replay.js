// The replay: the moment the match was decided, shown again, slower, from
// another side of the mat.
//
// A match here ends with a card. The card says who won and by what, and it is
// right — but the thing that decided it happened four seconds before the card
// and at full speed, and a player who was pressing buttons while it happened
// did not see it. A broadcast shows that moment again. So does this.
//
// What is kept is what the renderer draws, not what the sim decided: the
// world matrices of the three skeletons, the camera, and the handful of
// numbers the frame is lit and scored with. Replaying the sim instead would
// need the AI, the rng and the player's thumbs to come out the same a second
// time, and they would not. The skinning matrices are not kept: they are the
// world matrices times the inverse bind, which is the same for every skeleton
// in the game, and are recomputed when a frame is shown.
//
// Buffers of one shape. The ring holds the last eight seconds and is
// overwritten as the match goes on. A clip is a copy of a few seconds out of
// it, cut while they are still there:
//
//   points   the move that scored, cut when the points are paid — three
//            seconds after the move, and the move that decided a points win
//            can be two minutes old by the time the bell goes. One per
//            fighter, the latest; the winner's is the one that plays.
//   entry    the lock going on, cut a moment after it did. A finishing lock
//            is fought for eleven seconds in the middle of replay-check's
//            matches and thirteen at the ninetieth percentile, so by the tap
//            the entry has left the ring — and the last five seconds of a
//            submission are two men straining, which is not what anybody
//            wants to see twice.
//
// So a submission is shown in two pieces with a cut between them, the way a
// broadcast shows one: the lock going on, then the tap.
//
// Memory: 26 bones × 16 floats × 3 skeletons is 5 KB a frame. At sixty frames
// a second of match time the ring and the clips are about 1300 frames, six and
// a half megabytes, allocated once.

import { BONE_COUNT } from '../render/skeleton.js';
import { m4mul } from '../core/m4.js';

const SKELS = 3;
const MAT = BONE_COUNT * 16;
const FRAME = SKELS * MAT;
// time, eye xyz, at xyz, fov, who wears A, who wears B, flash ×2, gas ×2,
// crowd, spot, score ×2, clock.
const INFO = 18;
export const HZ = 60;
const RING_S = 8;
// The windows, in match seconds around the moment.
const MOVE = [1.5, 1.5];     // a scoring move: before it lands, after
const LOCK = [1.2, 0.8];     // a submission going on
const TAP = [1.0];           // and before the tap; the tail runs after it

// How the moment is shown.
export const RATE = 0.5;       // half speed
// Round the pair from where the live camera was, and a step in: the reverse
// angle, which is the one a broadcast cuts to for a replay. It was seventy
// degrees first, a side-on look, and replay-check put the referee inside the
// pair's box on every frame of it — he stands 110° round from the live lens so
// as to be out of *its* way, and seventy degrees round is exactly behind the
// fight. Swept: 40° to 120° all have him in it (47-100% of frames), 0-20° and
// 140-180° never do, and 0-20° is the shot the player just watched. 150° is
// the middle of the clean band; ×0.92 fills the frame with the pair a little
// more than live (44% against 40%) and crops a limb on 0.1% of frames, where
// ×0.8 crops on 3-4%. An object so replay-check can sweep both.
export const SHOT = { turn: (150 * Math.PI) / 180, closer: 0.92 };
// The live picture is held this long after the bell before the replay takes
// it, so the tap, the whistle and the referee's arms are in the clip too.
export const TAIL = 0.8;
// A frame to frame jump bigger than this is a cut or a change of who wears
// which skeleton, and is shown as a cut rather than blended through.
const JUMP = 0.5;

class Tape {
  constructor(seconds) {
    this.cap = Math.ceil(seconds * HZ);
    this.world = new Float32Array(this.cap * FRAME);
    this.info = new Float32Array(this.cap * INFO);
    this.clear();
  }

  clear() {
    this.head = 0;    // where the next frame goes
    this.count = 0;
  }

  // Frame k counted from the oldest one kept.
  slot(k) {
    return (this.head - this.count + k + this.cap * 2) % this.cap;
  }

  time(k) { return this.info[this.slot(k) * INFO]; }
  get first() { return this.count ? this.time(0) : 0; }
  get last() { return this.count ? this.time(this.count - 1) : 0; }

  push() {
    const s = this.head;
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);
    return s;
  }

  // Everything from t0 to t1 of another tape, oldest first, after whatever
  // is here already.
  append(src, t0, t1) {
    for (let k = 0; k < src.count && this.count < this.cap; k++) {
      const t = src.time(k);
      if (t < t0 || t > t1) continue;
      const from = src.slot(k), to = this.push();
      this.world.set(src.world.subarray(from * FRAME, (from + 1) * FRAME), to * FRAME);
      this.info.set(src.info.subarray(from * INFO, (from + 1) * INFO), to * INFO);
    }
  }

  copyFrom(src, t0, t1) {
    this.clear();
    this.append(src, t0, t1);
  }

  // The last frame at or before t, counted from the oldest.
  find(t) {
    let lo = 0, hi = this.count - 1;
    if (hi < 0 || t <= this.time(0)) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.time(mid) <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
}

// What the renderer is handed for one skeleton: the two arrays it reads.
function shownSkeleton() {
  return {
    world: Array.from({ length: BONE_COUNT }, () => new Float32Array(16)),
    skin: new Float32Array(MAT),
  };
}

export class Replay {
  // `invBind` is any skeleton's: the rest skeleton is the same for all three.
  constructor(invBind) {
    this.invBind = invBind;
    this.ring = new Tape(RING_S);
    const move = MOVE[0] + MOVE[1] + 0.2;
    this.clips = [new Tape(move), new Tape(move)];
    this.entry = new Tape(LOCK[0] + LOCK[1] + 0.2);
    // What plays: a points clip as it is, or the entry and the tap together.
    this.show = new Tape(LOCK[0] + LOCK[1] + TAP[0] + TAIL + 0.4);
    this.cutting = null;   // a clip waiting for the rest of itself to be recorded
    this.segments = [];
    this.clock = 0;
    this.marks = [];   // { kind, by, t }
    this.phase = 'rec';
    this.skel = [shownSkeleton(), shownSkeleton(), shownSkeleton()];
    this.camera = { eye: new Float32Array(3), at: new Float32Array(3), fov: 1 };
    this.shown = { ia: 0, ib: 1, flash: [0, 0], gas: [0, 0], crowd: 0, spot: 0, score: [0, 0], clock: 0 };
    this._m = new Float32Array(16);
    this.play = null;
  }

  // A new match: nothing in it is worth showing yet.
  reset() {
    this.ring.clear();
    for (const c of this.clips) c.clear();
    this.entry.clear();
    this.show.clear();
    this.cutting = null;
    this.segments = [];
    this.clock = 0;
    this.marks.length = 0;
    this.phase = 'rec';
    this.play = null;
    this.tail = 0;
  }

  // One frame of the live match, after it has been posed and framed. `dt` is
  // the sim's own step, so slow motion is kept as the sim lived it and a
  // frozen sim adds nothing.
  record(dt, skels, camera, f) {
    if (this.phase !== 'rec' && this.phase !== 'tail') return;
    if (!(dt > 0)) return;
    this.clock += dt;
    if (this.ring.count && this.clock - this.ring.last < 1 / HZ - 1e-4) return;
    const r = this.ring, s = r.push();
    for (let j = 0; j < SKELS; j++) {
      const w = skels[j].world;
      for (let i = 0; i < BONE_COUNT; i++) r.world.set(w[i], s * FRAME + j * MAT + i * 16);
    }
    const o = s * INFO, I = r.info;
    I[o] = this.clock;
    I[o + 1] = camera.eye[0]; I[o + 2] = camera.eye[1]; I[o + 3] = camera.eye[2];
    I[o + 4] = camera.at[0]; I[o + 5] = camera.at[1]; I[o + 6] = camera.at[2];
    I[o + 7] = camera.fov;
    I[o + 8] = f.ia; I[o + 9] = f.ib;
    I[o + 10] = f.flash[0]; I[o + 11] = f.flash[1];
    I[o + 12] = f.gas[0]; I[o + 13] = f.gas[1];
    I[o + 14] = f.crowd; I[o + 15] = f.spot;
    I[o + 16] = f.score[0] + f.score[1] * 1000;
    I[o + 17] = f.clock;
    if (this.cutting && this.clock >= this.cutting.t1) {
      this.cutting.into.copyFrom(this.ring, this.cutting.t0, this.cutting.t1);
      this.cutting = null;
    }
  }

  // Something happened that might be the moment. A move landing is noted; a
  // score cuts the clip for whoever scored around the move that earned it; a
  // lock going on cuts its own once the next moment of it has been recorded.
  mark(kind, by) {
    this.marks.push({ kind, by, t: this.clock });
    if (this.marks.length > 64) this.marks.shift();
    if (kind === 'submission') {
      this.entry.clear();
      this.cutting = { into: this.entry, t0: this.clock - LOCK[0], t1: this.clock + LOCK[1] };
    }
    if (kind !== 'points') return;
    const move = this._lastMove(by, this.clock);
    const at = move != null ? move : this.clock - 3;
    this.clips[by].copyFrom(this.ring, at - MOVE[0], Math.min(this.clock, at + MOVE[1]));
  }

  _lastMove(by, before) {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      if (m.kind === 'position' && m.by === by && m.t <= before && m.t >= before - 6) return m.t;
    }
    return null;
  }

  // The bell. What is worth showing is decided now, and shown after the tail.
  // Returns whether there will be a replay: a draw, an advantages decision and
  // a win whose points left no clip have no single moment to show.
  end(winner, by) {
    this.phase = 'none';
    this.segments = [];
    if (winner == null || by === 'draw' || by === 'advantages') return false;
    if (by === 'submission') {
      let lock = null;
      for (let i = this.marks.length - 1; i >= 0; i--) {
        if (this.marks[i].kind === 'submission') { lock = this.marks[i].t; break; }
      }
      const t1 = this.clock + TAIL;
      const tap = this.clock - TAP[0];
      // A quick tap is one piece, from the lock to the tap. A long fight is
      // two: the lock going on, cut, and the last second before the tap.
      if (lock == null || lock + LOCK[1] >= tap) {
        this.segments = [[lock != null ? lock - LOCK[0] : tap, t1]];
      } else {
        this.segments = [[lock - LOCK[0], lock + LOCK[1]], [tap, t1]];
      }
    } else {
      const clip = this.clips[winner];
      if (clip.count < HZ) return false;
      this.segments = [[clip.first, clip.last]];
    }
    this.phase = 'tail';
    this.tail = 0;
    return true;
  }

  // Wall-clock time after the bell. Returns true on the frame the replay
  // should take the picture.
  tick(real) {
    if (this.phase !== 'tail') return false;
    this.tail += real;
    if (this.tail < TAIL) return false;
    this._begin();
    return true;
  }

  // Everything that plays, into one tape, while it is all still there — the
  // ring is overwritten by the next match. The segments keep the match's own
  // clock, so the tape is in time order with a gap where the cut is.
  _begin() {
    const show = this.show;
    show.clear();
    // Each piece from whichever tape has it: judged by its middle, because a
    // window's ends are asked for in match seconds and a tape's ends are
    // wherever the nearest frame fell.
    const has = (tape, t) => tape.count && t >= tape.first && t <= tape.last;
    for (const [t0, t1] of this.segments) {
      const mid = (t0 + t1) / 2;
      const from = [this.entry, ...this.clips].find((c) => has(c, mid)) || this.ring;
      show.append(from, t0, t1);
    }
    this.source = show;
    if (show.count < 2) { this.phase = 'none'; return; }
    // Trimmed to what was actually kept.
    this.segments = this.segments
      .map(([a, b]) => [Math.max(a, show.first), Math.min(b, show.last)])
      .filter(([a, b]) => b > a);
    this.window = [show.first, show.last];
    this.length = this.segments.reduce((n, [a, b]) => n + b - a, 0);
    this.phase = 'play';
    this.play = { seg: 0, t: this.segments[0][0], done: 0, turn: this._pickTurn() };
  }

  // Which way round. The referee stands where he does to stay out of the live
  // camera's way, and the reverse angle can end up looking through him. Both
  // directions are tried against where he is in the first frame and
  // the one that leaves him further off the line to the pair is taken.
  _pickTurn() {
    const src = this.source, s = src.slot(0), I = src.info, o = s * INFO;
    const at = [I[o + 4], I[o + 5], I[o + 6]];
    const hips = src.world.subarray(s * FRAME + 2 * MAT, s * FRAME + 2 * MAT + 16);
    const ref = [hips[12], hips[14]];
    let best = SHOT.turn, clear = -1;
    for (const turn of [SHOT.turn, -SHOT.turn]) {
      const eye = this._turned([I[o + 1], I[o + 2], I[o + 3]], at, turn);
      // Distance of the referee from the segment eye→at, on the floor.
      const dx = at[0] - eye[0], dz = at[2] - eye[2];
      const L = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((ref[0] - eye[0]) * dx + (ref[1] - eye[2]) * dz) / L));
      const d = Math.hypot(eye[0] + dx * u - ref[0], eye[2] + dz * u - ref[1]);
      if (d > clear + 0.05) { clear = d; best = turn; }
    }
    return best;
  }

  _turned(eye, at, turn) {
    const c = Math.cos(turn), s = Math.sin(turn);
    const k = SHOT.closer;
    const x = (eye[0] - at[0]) * k, z = (eye[2] - at[2]) * k;
    return [at[0] + x * c - z * s, at[1] + (eye[1] - at[1]) * k, at[2] + x * s + z * c];
  }

  get playing() { return this.phase === 'play'; }
  // Between the bell and the replay, and during it: the result waits.
  get holding() { return this.phase === 'tail' || this.phase === 'play'; }
  get progress() {
    if (!this.play) return 1;
    return Math.min(1, this.play.done / Math.max(1e-3, this.length));
  }

  skip() {
    if (this.phase === 'tail' || this.phase === 'play') this.phase = 'none';
    this.play = null;
  }

  // Advance by wall-clock time and pose everything the renderer will be
  // handed. Returns false once the window has run out.
  step(real) {
    if (this.phase !== 'play') return false;
    const p = this.play;
    p.t += real * RATE;
    p.done += real * RATE;
    while (p.t > this.segments[p.seg][1]) {
      const over = p.t - this.segments[p.seg][1];
      if (++p.seg >= this.segments.length) { this.phase = 'none'; this.play = null; return false; }
      p.t = this.segments[p.seg][0] + over;
    }
    this._sample(p.t);
    return true;
  }

  // Show one instant, as a fraction of the whole replay (a tool uses this to
  // hold a frame of it).
  at(u) {
    const p = this.play;
    if (!p) return;
    let left = u * this.length;
    p.done = left;
    for (p.seg = 0; p.seg < this.segments.length - 1; p.seg++) {
      const [a, b] = this.segments[p.seg];
      if (left <= b - a) break;
      left -= b - a;
    }
    p.t = Math.min(this.segments[p.seg][1], this.segments[p.seg][0] + left);
    this._sample(p.t);
  }

  _sample(t) {
    const src = this.source;
    const k = src.find(t);
    const k2 = Math.min(src.count - 1, k + 1);
    const a = src.slot(k), b = src.slot(k2);
    const ta = src.time(k), tb = src.time(k2);
    let u = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 0;
    const I = src.info, oa = a * INFO, ob = b * INFO;
    // A cut or a swap between the two frames: no blending through it.
    const eyeJump = Math.hypot(I[oa + 1] - I[ob + 1], I[oa + 2] - I[ob + 2], I[oa + 3] - I[ob + 3]);
    if (eyeJump > JUMP || I[oa + 8] !== I[ob + 8]) u = u < 0.5 ? 0 : 1;
    const W = src.world;
    for (let j = 0; j < SKELS; j++) {
      const sk = this.skel[j];
      const pa = a * FRAME + j * MAT, pb = b * FRAME + j * MAT;
      const jump = Math.hypot(W[pa + 12] - W[pb + 12], W[pa + 13] - W[pb + 13], W[pa + 14] - W[pb + 14]);
      const v = jump > JUMP ? (u < 0.5 ? 0 : 1) : u;
      for (let i = 0; i < BONE_COUNT; i++) {
        const m = sk.world[i];
        for (let e = 0; e < 16; e++) m[e] = W[pa + i * 16 + e] * (1 - v) + W[pb + i * 16 + e] * v;
        m4mul(this._m, m, this.invBind[i]);
        sk.skin.set(this._m, i * 16);
      }
    }
    const L = (o) => I[oa + o] * (1 - u) + I[ob + o] * u;
    const eye = [L(1), L(2), L(3)], at = [L(4), L(5), L(6)];
    const e2 = this._turned(eye, at, this.play ? this.play.turn : SHOT.turn);
    this.camera.eye.set(e2);
    this.camera.at.set(at);
    this.camera.fov = L(7);
    const n = u < 0.5 ? oa : ob;
    const sh = this.shown;
    sh.ia = I[n + 8]; sh.ib = I[n + 9];
    sh.flash[0] = L(10); sh.flash[1] = L(11);
    sh.gas[0] = L(12); sh.gas[1] = L(13);
    sh.crowd = L(14); sh.spot = L(15);
    sh.score[0] = I[n + 16] % 1000; sh.score[1] = Math.floor(I[n + 16] / 1000);
    sh.clock = I[n + 17];
  }
}
