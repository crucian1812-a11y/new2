// The overlay. A second canvas in 2D on top of the WebGL one, because the
// interface is text and thin lines and those are the two things Canvas2D is
// still better at than a shader.
//
// The layout is a broadcast scorebug plus two thumb zones, and the whole thing
// obeys one rule: nothing important may sit where a thumb will be. On a phone
// in landscape the bottom corners are covered by hands for the entire match,
// so the score lives at the top and the transition ring is drawn around the
// thumb rather than under it.

import { FEINT_BEFORE } from '../game/match.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif';
const OPPOSITE_DIR = { up: 'down', down: 'up', left: 'right', right: 'left' };

const DIR_VEC = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.pulse = 0;
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  draw(match, input, dt, opts = {}) {
    const c = this.ctx;
    this.pulse += dt;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.textBaseline = 'middle';

    // The scorebug belongs to a match in progress. On the title card it is
    // clutter across the fighter's head, announcing a score of nothing to
    // nothing.
    // A drill has no score, no clock and no advantages. Drawing the scorebug
    // over one would put three empty numbers where the thing being practised
    // is supposed to be.
    this.coachUp = !!(opts.tutorial && !opts.tutorial.done);
    // The replay has the screen to itself: no scorebug, no ring, no feed —
    // only the bars that say this is not live, and how long it has left.
    if (opts.replay && opts.replay.playing) {
      this._replay(opts.replay);
      this._fullscreen(opts);
      if (opts.veil && opts.veil.v > 0.002) {
        c.fillStyle = `rgba(2,4,8,${Math.min(1, opts.veil.v)})`;
        c.fillRect(0, 0, this.w, this.h);
      }
      return;
    }
    if (match.state !== 'ready' && !opts.drill && !opts.promo) {
      this._scorebug(match);
      this._positionBar(match);
    }
    if (match.state === 'live' || match.state === 'sub') {
      this._ring(match, input);
      this._stick(input);
      if (!opts.drill && !opts.walkout) this._pauseButton();
    }
    // Points, said out loud. Not on a drill: a drill has no score, and a pill
    // announcing four points for a rep would be announcing a number the room
    // does not keep.
    if (opts.punch && !opts.drill && match.state !== 'ready') this._punch(opts.punch);
    if (match.deny && match.attempt) this._denyPrompt(match);
    if (match.state === 'sub') this._sub(match);
    this._events(match, dt, !!opts.promo);
    // The menu is up while the match is waiting — but not while the two of them
    // are walking out to it. The state is still 'ready' all the way to the
    // bell, and a belt picker across a man crossing the mat is the clutter the
    // scorebug above was taken off the title card for.
    if (match.state === 'ready' && !opts.walkout) {
      if (opts.screen === 'gym') this._gym(opts);
      else if (opts.screen === 'fighter') this._fighter(opts);
      else this._title(opts);
    }
    if (opts.drill && (match.state === 'live' || match.state === 'sub')) this._drillBar(opts.drill);
    if (opts.drillOver) this._drillOver(opts.drillOver);
    // The belt first, and by itself. It comes before the разбор rather than on
    // top of it: the first version drew both, and the screenshot showed a
    // scorebug, a score, three lines of debrief and «КОСНИСЬ, ЧТОБЫ ВЫЙТИ НА
    // СЛЕДУЮЩЕГО» all reading through the ceremony at once. The scorecard is
    // still there — it is what the same press hands back.
    if (match.state === 'over') this.result = opts.result;
    if (opts.promo) this._promo(opts.promo);
    else if (match.state === 'over' && !opts.replay) this._result(match, opts);
    // The first minute's coach, above everything except the result card.
    if (opts.tutorial) {
      if (opts.tutorial.done) this._tutorialDone();
      else if (match.state === 'live' || match.state === 'sub') this._tutorial(opts.tutorial);
    }
    if (opts.paused) this._pause();
    // The full-screen button and its one-line hint, on every screen.
    this._fullscreen(opts);
    // The cut between screens: a fade from black that covers everything while
    // the title swaps for the fight and the fight for the result.
    if (opts.veil && opts.veil.v > 0.002) {
      c.fillStyle = `rgba(2,4,8,${Math.min(1, opts.veil.v)})`;
      c.fillRect(0, 0, this.w, this.h);
    }
  }

  /* ------------------------------------------------------------ scorebug */

  _scorebug(m) {
    const c = this.ctx;
    const w = this.w;
    const barW = Math.min(600, w - 28);
    const x = (w - barW) / 2;
    const y = 10;
    const h = 54;
    const mid = x + barW / 2;

    roundRect(c, x, y, barW, h, 8);
    c.fillStyle = 'rgba(6,8,12,0.82)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.09)';
    c.lineWidth = 1;
    c.stroke();

    // Clock, dead centre, because that is where a viewer's eye goes back to.
    const t = Math.max(0, m.time);
    c.textAlign = 'center';
    c.fillStyle = t < 30 ? '#ff6a55' : '#f2f3f5';
    c.font = `600 20px ${FONT}`;
    c.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, mid, y + 18);
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.font = `600 8px ${FONT}`;
    c.fillText('IBJJF · ADULTO', mid, y + 34);

    for (let i = 0; i < 2; i++) {
      const f = m.f[i];
      const s = i === 0 ? 1 : -1;      // +1 grows rightwards, -1 leftwards
      const edge = i === 0 ? x + 13 : x + barW - 13;
      c.textAlign = i === 0 ? 'left' : 'right';

      // Gi and belt, which is the only place either colour is named.
      const sw = i === 0 ? edge : edge - 22;
      c.fillStyle = rgb(f.giCol);
      roundRect(c, sw, y + 8, 22, 10, 2);
      c.fill();
      c.fillStyle = rgb(f.beltCol);
      c.fillRect(sw, y + 15, 22, 4);

      c.fillStyle = '#f2f3f5';
      c.font = `700 12px ${FONT}`;
      c.fillText(f.name.toUpperCase(), edge + s * 29, y + 14);

      // Points sit just inside the clock, adv tucked under them.
      const px = mid - s * 62;
      c.textAlign = 'center';
      c.font = `700 25px ${FONT}`;
      c.fillStyle = '#ffffff';
      c.fillText(String(f.points), px, y + 17);
      c.font = `600 9px ${FONT}`;
      c.fillStyle = f.advantages ? 'rgba(201,162,39,0.95)' : 'rgba(255,255,255,0.32)';
      c.fillText(`ADV ${f.advantages}`, px, y + 33);

      // Stamina over posture, spanning the name's column.
      const bw = Math.min(168, barW / 2 - 92);
      const bx = i === 0 ? edge : edge - bw;
      meter(c, bx, y + 30, bw, 5, f.stamina / 100, f.stamina < 25 ? '#ff9f43' : '#4fd48a', '#122019');
      meter(c, bx, y + 38, bw, 4, f.posture / 100, '#7fa6ff', '#151b2c');
      c.textAlign = i === 0 ? 'left' : 'right';
      c.font = `600 7px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.28)';
      c.fillText('ВЫНОСЛИВОСТЬ · ОСАНКА', i === 0 ? bx : bx + bw, y + 48);
    }
  }

  // Where the words about the fight go: the position's name, its English
  // name, the three-second count and the bar of an attempt in flight.
  //
  // They were a strip across the top middle, CSS pixels 64 to 132, and the
  // camera puts heads exactly there: measured across twenty matches a head was
  // under that strip on 71% of frames (tools/camera-check.mjs), and the
  // screenshots had «ЗАКРЫТЫЙ ГАРД» written across a face. Heads live between
  // 102 and 217 pixels down; the bottom of the screen has feet and mat and not
  // one head in 280 thousand frames. So the caption is a lower third, the way a
  // broadcast puts it — between the feed on the left and the ring on the
  // right. The first-minute coach owns the bottom middle while it talks, and
  // for those four steps the caption goes back up where it was.
  captionLayout() {
    return this.coachUp ? { y: 76, bar: 108 } : { y: this.h - 62, bar: this.h - 38 };
  }

  _positionBar(m) {
    const c = this.ctx;
    const pose = m.pose();
    const { y } = this.captionLayout();
    c.textAlign = 'center';
    c.font = `700 13px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillText(pose.name.toUpperCase(), this.w / 2, y);
    c.font = `600 9px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillText(pose.label, this.w / 2, y + 13);

    // The three-second count that turns a position into points. It sits beside
    // the position label rather than under it, because under it is where the
    // attempt bar goes and both are on screen at once more often than not.
    if (m.hold) {
      const p = m.hold.t / 3;
      const r = 14;
      const cx = this.w / 2 + 96;
      const cy = y + 5;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(255,255,255,0.14)';
      c.lineWidth = 3;
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      c.strokeStyle = '#ffd166';
      c.lineWidth = 3;
      c.stroke();
      c.fillStyle = '#ffd166';
      c.font = `700 13px ${FONT}`;
      c.fillText('+' + m.hold.points, cx, cy + 1);
    }
  }

  /* -------------------------------------------------------- control ring */

  // The four things you can do, drawn where your thumb already is. The names
  // are on screen at all times on purpose: a position graph you have to
  // memorise is a position graph nobody plays.
  // Where the four buttons of the ring are. One function, because the ring is
  // drawn from it and hit-tested from it, and a button you can see but cannot
  // press is exactly the bug this exists to prevent.
  ringLayout() {
    const R = clampN(Math.min(this.w, this.h) * 0.17, 44, 66);
    return { R, rr: R * 0.3, cx: this.w - (R + 52), cy: this.h - (R + 46) };
  }

  // Which button a tap landed on, if any.
  //
  // The ring is four labelled circles with a price written on each, and for the
  // whole life of this game the only way to press one was to swipe across the
  // right-hand side. A tap on the button marked «+4» fought for a grip instead,
  // in silence. Every tool that ever played the game swiped — thumb.mjs sends
  // pointerdown, move, up — so nothing in the battery could catch it, and a
  // person, who taps what looks like a button, scored nothing all match.
  //
  // The target is wider than the circle drawn: a thumb is about forty pixels
  // and the drawn circle is thirteen to twenty. Narrow enough that the four
  // never touch — they sit R apart, so anything under 0.7R is disjoint — and
  // that the middle, where the thumb rests to fight for grips, belongs to
  // nobody.
  ringDir(x, y) {
    const { R, cx, cy } = this.ringLayout();
    const grab = R * 0.55;
    for (const dir of ['up', 'down', 'left', 'right']) {
      const [dx, dy] = DIR_VEC[dir];
      if (Math.hypot(x - (cx + dx * R), y - (cy + dy * R)) <= grab) return dir;
    }
    return null;
  }

  _ring(m, input) {
    const c = this.ctx;
    const opts = m.options(0);
    // What is there, and separately what can be pressed. During the cooldown
    // after a move the two differ, and showing the first while dimming to the
    // second is the difference between "not yet" and a ring that has gone out.
    const shown = m.preview(0);
    const cool = m.cool[0] > 0 && !m.attempt;
    // And the third reason a button is dim: he cannot pay for any of them.
    // Cooldown and an empty tank looked the same — four dim buttons — so the
    // thumb kept pressing, and the only answer was a line in the corner of the
    // screen, «нет сил», stacked six deep. flow-check puts it at 5% of a match.
    const broke = m.state === 'live' && !m.attempt && !cool
      && Object.keys(shown).length > 0 && Object.keys(opts).length === 0;

    // Under a threat the ring is the defence, because that is what a press
    // does.
    //
    // It used to keep offering the four attacking moves while every flick was
    // being turned into a denial — the same gesture meaning something else,
    // decided by a state the player had not chosen and the ring did not
    // mention. Measured over forty matches it was 12% of every frame the ring
    // had a label on it, and under threat all of the labels lied at once.
    // The prompt in the middle of the screen said the truth; the thing under
    // the thumb said otherwise, and the thumb is where people look.
    const threat = !!(m.attempt && m.attempt.defender === 0);
    const read = threat ? (m.denyRead(0) || []) : null;
    // A press the game has heard and not used yet: the plain buffer, and a
    // chain parked on the attempt in flight (the next move, named while the
    // current one is still deciding). Both read as remembered, not ignored.
    const buffered = (m.buffer && m.buffer.i === 0 ? m.buffer.dir : null)
      || (m.attempt && m.attempt.chain && m.attempt.chain.i === 0 ? m.attempt.chain.dir : null);
    // The ring scales with the screen and is pinned far enough off the bottom
    // that the lowest label still lands on glass. On a short landscape phone
    // that margin is the whole difference between readable and cropped.
    const { R, cx, cy } = this.ringLayout();

    c.save();
    for (const dir of ['up', 'down', 'left', 'right']) {
      const tr = shown[dir];
      const [dx, dy] = DIR_VEC[dir];
      const x = cx + dx * R;
      const y = cy + dy * R;
      // On means "pressing this does something now". Under a threat that is the
      // directions he can read and nothing else; the rest of the time it is
      // whatever the graph offers from here.
      const on = threat ? read.includes(dir) : !!tr;
      const ready = threat ? on : (on && !!opts[dir]);
      const mine = buffered === dir;
      // The way back out of your own attack, while there still is one. The
      // opposite button is the feint (see _feint in match.js): bright, gold,
      // and named, because a move nobody is told about is a move nobody makes.
      const own = m.attempt && m.attempt.by === 0 ? m.attempt : null;
      const feintHere = !!own && dir === OPPOSITE_DIR[own.tr.dir] && own.t < own.tr.time * FEINT_BEFORE;
      if (feintHere) {
        c.globalAlpha = 1;
        const rr0 = R * 0.3;
        c.beginPath();
        c.arc(x, y, rr0, 0, Math.PI * 2);
        c.fillStyle = 'rgba(40,32,8,0.85)';
        c.fill();
        c.strokeStyle = '#ffd166';
        c.lineWidth = 2.5;
        c.stroke();
        arrow(c, x, y, dx, dy, '#ffd166', R * 0.15);
        c.font = `800 10px ${FONT}`;
        c.fillStyle = '#ffd166';
        c.textAlign = 'center';
        c.fillText('ФИНТ', x, dy > 0 ? y + rr0 + 12 : y - rr0 - 8);
        continue;
      }
      c.globalAlpha = (m.attempt && !threat ? 0.5 : 1) * (on && !ready ? 0.45 : 1);

      const rr = R * 0.3;
      c.beginPath();
      c.arc(x, y, rr, 0, Math.PI * 2);
      c.fillStyle = on ? 'rgba(10,14,20,0.72)' : 'rgba(10,14,20,0.3)';
      c.fill();
      c.strokeStyle = !on ? 'rgba(255,255,255,0.12)'
        : threat ? 'rgba(255,106,85,0.95)'
          : tr.sub ? 'rgba(255,110,90,0.9)' : tr.big ? 'rgba(255,209,102,0.85)' : 'rgba(255,255,255,0.5)';
      c.lineWidth = on ? 2 : 1;
      c.stroke();

      // How likely it is, as an arc round the button.
      //
      // Without this the ring showed a name and nothing else, and the obvious
      // way to play — press whatever is likeliest to work — scores exactly
      // zero: measured over 200 matches, 0.0 points and no wins at all. The
      // high percentages in this game are the retreats. Sitting to guard is
      // 95%, dropping back to side control is 90%, standing up out of turtle
      // is 85%, and every one of them is worth nothing. Points live between
      // 30 and 60. A player cannot find that out from four words.
      //
      // And it has to be the chance that decides, not the one in the table.
      // The arc drew `tr.base`, and the match rolls `chanceOf`, which carries
      // his posture, both men's stamina, the grips and — for a submission —
      // whether he has been broken yet. Measured over sixty matches the two
      // disagreed by a factor of three either way on submissions (0.31 to
      // 2.07 of what was drawn), which is exactly the lesson the game most
      // wants to teach: break him first, then finish. So the number on the
      // glass is the number the dice will use, and its colour says which side
      // of even it is on.
      const odds = on && !threat && tr ? m.chanceOf(tr, 0) : 0;
      if (on && !threat && tr) {
        c.beginPath();
        c.arc(x, y, rr + 3.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * odds);
        c.strokeStyle = oddsColour(odds);
        c.lineWidth = 3;
        c.stroke();
      }

      arrow(c, x, y, dx, dy, on ? '#fff' : 'rgba(255,255,255,0.2)', R * 0.15);

      // And what it pays, next to what it will take. The whole economy is
      // "arrive somewhere worth points and hold it three seconds", and the
      // ring was the one place a player looks and the one place that never
      // mentioned it. The chance goes beside it as a number: an arc alone was
      // two pixels nobody knew how to read.
      if (on && !threat && tr) {
        const pct = `${Math.round(odds * 100)}%`;
        c.font = `800 11px ${FONT}`;
        // On the far side of the button from the name, or the two land on each
        // other: for the left and right buttons dy is 0, so both wanted the
        // same four pixels above the circle.
        const py = dy > 0 ? y - rr - 5 : y + rr + 14;
        const head = tr.points > 0 ? `+${tr.points} ` : '';
        const wHead = c.measureText(head).width;
        const x0 = x - (wHead + c.measureText(pct).width) / 2;
        c.textAlign = 'left';
        c.fillStyle = '#ffd166';
        if (head) c.fillText(head, x0, py);
        c.fillStyle = oddsColour(odds);
        c.fillText(pct, x0 + wHead, py);
        c.textAlign = 'center';
      }

      // A press the game has heard and not used yet, so a flick during a throw
      // or a cooldown reads as remembered rather than as ignored.
      if (mine) {
        c.beginPath();
        c.arc(x, y, rr + 4, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(255,209,102,0.9)';
        c.lineWidth = 2;
        c.stroke();
      }

      if (on || (!threat && tr)) {
        c.font = `600 9px ${FONT}`;
        c.fillStyle = 'rgba(255,255,255,0.82)';
        c.textAlign = 'center';
        const ly = dy > 0 ? y + rr + 12 : y - rr - 8;
        // A dark halo under the name. The ring sits over the hoardings, and
        // grey nine-pixel text on a white band printed with the club's name
        // was two lines of lettering on top of each other.
        c.shadowColor = 'rgba(0,0,0,0.9)';
        c.shadowBlur = 4;
        wrapText(c, threat ? 'ЗАЩИТА' : tr.name, x, ly, 100, 10);
        c.shadowBlur = 0;
        c.shadowColor = 'transparent';
      }
    }
    c.globalAlpha = m.attempt && !threat ? 0.5 : 1;
    // How much of the cooldown is left, drawn round the ring itself: a dimmed
    // label says "not yet" and this says how long.
    if (cool) {
      c.beginPath();
      c.arc(cx, cy, R * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, m.cool[0] / m.coolFull[0]));
      c.strokeStyle = 'rgba(255,255,255,0.30)';
      c.lineWidth = 2;
      c.stroke();
    }
    // The centre: tap to fight for grips, and how that fight is going.
    c.beginPath();
    c.arc(cx, cy, R * 0.27, 0, Math.PI * 2);
    c.fillStyle = 'rgba(10,14,20,0.6)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1;
    c.stroke();
    c.font = `600 8px ${FONT}`;
    c.textAlign = 'center';
    if (broke) {
      // Where the thumb already is, and pulsing, because it is a state rather
      // than an event: it lasts until he has breathed.
      c.fillStyle = `rgba(255,159,67,${0.65 + 0.35 * Math.sin(this.pulse * 6)})`;
      c.fillText('НЕТ СИЛ', cx, cy);
    } else {
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.fillText('ЗАХВАТ', cx, cy);
    }
    if (m.gripAdv[0] > 0.02) {
      c.beginPath();
      c.arc(cx, cy, R * 0.35, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * m.gripAdv[0]);
      c.strokeStyle = '#4fd48a';
      c.lineWidth = 2.5;
      c.stroke();
    }
    if (m.gripAdv[1] > 0.02) {
      c.beginPath();
      c.arc(cx, cy, R * 0.42, -Math.PI / 2, -Math.PI / 2 - Math.PI * 2 * m.gripAdv[1], true);
      c.strokeStyle = 'rgba(255,110,90,0.8)';
      c.lineWidth = 2.5;
      c.stroke();
    }
    c.restore();

    // The attempt in flight, drawn as a bar filling towards resolution. It
    // goes under the position label rather than by the thumb: during an
    // attempt both players are watching the middle of the screen for the
    // denial prompt, and this is the thing that tells them what is coming.
    if (m.attempt) {
      const a = m.attempt;
      const bw = 190;
      const bx = this.w / 2 - bw / 2;
      // Clear of the position's two labels above it. At 96 the bar's top edge
      // sat in the descenders of the English one and the three-second ring
      // finished a pixel above it; there are four things stacked in this strip
      // and they were sharing forty pixels.
      const by = this.captionLayout().bar;
      c.fillStyle = 'rgba(6,8,12,0.8)';
      roundRect(c, bx, by, bw, 22, 5);
      c.fill();
      const p = Math.min(1, a.t / a.tr.time);
      c.fillStyle = a.by === 0 ? 'rgba(79,212,138,0.35)' : 'rgba(255,110,90,0.35)';
      roundRect(c, bx, by, bw * p, 22, 5);
      c.fill();
      c.font = `700 11px ${FONT}`;
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      // Over the bar, not over the ring. This read `cx`, which is the centre
      // of the control ring in the bottom corner, so on an 812-wide screen the
      // name of the move being attempted was drawn 290 pixels to the right of
      // the bar filling up underneath it, out over the hoardings.
      c.fillText(a.tr.name.toUpperCase(), bx + bw / 2, by + 12);
    }
  }

  _stick(input) {
    const s = input.stick;
    if (!s.active) return;
    const c = this.ctx;
    c.beginPath();
    c.arc(s.ox, s.oy, input.stickRadius, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 2;
    c.stroke();
    c.beginPath();
    c.arc(s.ox + s.x * input.stickRadius, s.oy + s.y * input.stickRadius, 20, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.24)';
    c.fill();
  }

  /* ----------------------------------------------------------- the reads */

  // The denial prompt. Big, central, and gone in under half a second — this is
  // the moment the match turns on and it has to be readable in peripheral
  // vision while you are looking at two bodies moving.
  /* ------------------------------------------------------------ the punch */

  // Where the score pill goes: under the position bar, across the middle,
  // clear of the deny circle at the centre of the glass and of both thumbs.
  punchLayout() {
    return { x: this.w / 2, y: 110, h: 26 };
  }

  // «+4 ПРОШЁЛ ГАРД».
  //
  // Three points for a sweep used to be a line of grey text in the bottom-left
  // corner, in the same size and the same place as «стоп» and «выход» — the
  // scoreboard changed by three and nothing on the screen said why. The
  // position graph already writes down what each move is called in the words a
  // coach would use («прошёл гард», «вышел на спину», «бросок»); the match
  // hands that note along with the points, and this is where it is said.
  //
  // It pops and it goes. The pop is a scale from 1.35 in a sixth of a second,
  // which is the length of the sound that plays with it; the going is the last
  // four tenths, drifting up as it fades, so the eye follows it off rather
  // than watching a box disappear.
  _punch(p) {
    const c = this.ctx;
    const L = this.punchLayout();
    const t = p.t;
    const pop = t < 0.16 ? 1.35 - 0.35 * (t / 0.16) : 1;
    const out = Math.max(0, (t - (PUNCH_LIFE - 0.4)) / 0.4);
    const a = 1 - out;
    if (a <= 0) return;

    const num = `+${p.n}`;
    const note = (p.note || '').toUpperCase();
    c.font = `800 20px ${FONT}`;
    const numW = c.measureText(num).width;
    c.font = `700 11px ${FONT}`;
    const noteW = note ? c.measureText(note).width : 0;
    const padW = 12;
    const w = numW + (note ? noteW + 10 : 0) + padW * 2;

    c.save();
    c.globalAlpha = a;
    c.translate(L.x, L.y - out * 14);
    c.scale(pop, pop);
    const col = p.mine ? '#4fd48a' : '#ff6a55';
    roundRect(c, -w / 2, -L.h / 2, w, L.h, L.h / 2);
    c.fillStyle = 'rgba(6,9,14,0.82)';
    c.fill();
    c.strokeStyle = col;
    c.lineWidth = 1.5;
    c.stroke();
    c.textAlign = 'left';
    c.fillStyle = col;
    c.font = `800 20px ${FONT}`;
    c.fillText(num, -w / 2 + padW, 1);
    if (note) {
      c.fillStyle = 'rgba(255,255,255,0.86)';
      c.font = `700 11px ${FONT}`;
      c.fillText(note, -w / 2 + padW + numW + 10, 1);
    }
    c.restore();
    c.globalAlpha = 1;
    c.textAlign = 'left';
  }

  _denyPrompt(m) {
    const c = this.ctx;
    const d = m.deny;
    if (d.by !== 0) return;
    const left = 1 - d.t / d.window;
    const cx = this.w / 2;
    const cy = this.h / 2 + 10;
    // How much of it he can read. See denyRead: one arrow when he can see the
    // wind-up and is still upright, two to choose between when he is underneath
    // or flattened, four when he is both.
    const read = m.denyRead(0) || [];
    const scale = 1 + (1 - left) * 0.5;

    c.save();
    c.globalAlpha = Math.min(1, left * 2.2);
    c.translate(cx, cy);
    c.scale(scale, scale);
    c.beginPath();
    c.arc(0, 0, 42, 0, Math.PI * 2);
    c.fillStyle = 'rgba(8,10,16,0.72)';
    c.fill();
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.stroke();
    c.beginPath();
    c.arc(0, 0, 42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    c.strokeStyle = '#ff6a55';
    c.stroke();
    if (read.length === 1) {
      const [dx, dy] = DIR_VEC[read[0]];
      arrow(c, 0, 0, dx, dy, '#fff', 16);
    } else {
      // The arrows he is choosing between, and only those. Two is a read; four
      // is the coin he is left with when he is both underneath and flattened.
      const bright = read.length <= 2;
      for (const dir of read) {
        const [ax, ay] = DIR_VEC[dir];
        arrow(c, ax * 18, ay * 18, ax, ay,
          bright ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.28)',
          bright ? 14 : 10);
      }
    }
    c.restore();

    c.globalAlpha = 1;
    c.textAlign = 'center';
    c.font = `700 11px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillText(
      read.length === 1 ? 'ЗАЩИТА — СВАЙП'
        : read.length === 2 ? 'ЗАЩИТА — ОДНА ИЗ ДВУХ'
          : 'ЗАЩИТА — УГАДАЙ СТОРОНУ',
      cx, cy + 62
    );
  }

  /* ------------------------------------------------------- submission UI */

  _sub(m) {
    const s = m.sub;
    if (!s) return;
    const c = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2 + 6;
    const mine = s.attacker === 0;

    // The meter. One bar, red towards the tap, and it is the same bar for both
    // players so neither has to learn a second display under pressure.
    const bw = Math.min(320, this.w - 80);
    const bx = cx - bw / 2;
    const by = cy - 86;
    c.fillStyle = 'rgba(6,8,12,0.85)';
    roundRect(c, bx - 6, by - 22, bw + 12, 46, 6);
    c.fill();
    c.font = `700 11px ${FONT}`;
    c.textAlign = 'center';
    c.fillStyle = mine ? '#4fd48a' : '#ff6a55';
    c.fillText(
      `${m.pose().name.toUpperCase()} — ${mine ? 'ДОЖИМАЙ' : 'ВЫХОДИ'}`,
      cx, by - 10
    );
    meter(c, bx, by, bw, 12, s.meter, mine ? '#ff9f43' : '#ff4d3d', '#1a1010');
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.beginPath();
    c.moveTo(bx + bw * 0.85, by - 2);
    c.lineTo(bx + bw * 0.85, by + 14);
    c.lineWidth = 1;
    c.stroke();

    if (mine) {
      // Attacker: a ring closing on a green arc. Tap on it and the choke
      // tightens; tap early and you lose the angle.
      const R = 46;
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(255,255,255,0.12)';
      c.lineWidth = 8;
      c.stroke();
      c.beginPath();
      c.arc(cx, cy, R, tau(0.64), tau(0.86));
      c.strokeStyle = 'rgba(79,212,138,0.9)';
      c.stroke();
      const a = tau(s.phase);
      c.beginPath();
      c.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 7, 0, Math.PI * 2);
      c.fillStyle = '#fff';
      c.fill();
      c.font = `700 12px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.fillText('ТАП', cx, cy);
    } else {
      // Defender: a direction to escape, changing before it can be spammed —
      // and only while the lock is shallow enough to feel the room in it. Once
      // it is sunk the circle is empty and the way out is a guess, which is
      // the same rule the denial prompt runs on. See visibleEscape.
      const seenOut = m.visibleEscape(0);
      c.beginPath();
      c.arc(cx, cy, 40, 0, Math.PI * 2);
      c.fillStyle = 'rgba(8,10,16,0.7)';
      c.fill();
      c.strokeStyle = seenOut ? 'rgba(255,255,255,0.2)' : 'rgba(255,120,90,0.35)';
      c.lineWidth = 3;
      c.stroke();
      if (seenOut) {
        const [dx, dy] = DIR_VEC[seenOut];
        arrow(c, cx, cy, dx, dy, '#fff', 15);
      } else {
        c.font = `700 20px ${FONT}`;
        c.fillStyle = 'rgba(255,255,255,0.5)';
        c.fillText('?', cx, cy + 7);
      }
      c.font = `700 10px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.fillText(seenOut ? 'СВАЙП, ЧТОБЫ ВЫЙТИ' : 'ВЫХОД — УГАДАЙ СТОРОНУ', cx, cy + 58);
    }
  }

  /* -------------------------------------------------------------- chrome */

  // The coach, for the first minute. A banner with the current lesson and a
  // pulsing mark on the control it is about, so the instruction sits where the
  // thumb already is rather than in a wall of text.
  _tutorial(t) {
    const c = this.ctx;
    const s = t.step;
    if (!s) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.pulse * 3.2);

    // The banner, bottom centre, clear of the ring and the event feed.
    const w = Math.min(470, this.w - 32);
    const x = (this.w - w) / 2;
    const y = this.h - 58;
    const h = 46;
    c.save();
    roundRect(c, x, y, w, h, 9);
    c.fillStyle = 'rgba(6,8,12,0.88)';
    c.fill();
    c.strokeStyle = `rgba(255,209,102,${0.3 + pulse * 0.55})`;
    c.lineWidth = 1.5;
    c.stroke();
    c.textAlign = 'center';
    c.font = `800 12px ${FONT}`;
    c.fillStyle = '#ffd166';
    c.fillText(`${t.i + 1}/4 · ${s.title}`, this.w / 2, y + 14);
    c.font = `600 11px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillText(s.text, this.w / 2, y + 34);
    c.restore();

    // The control the step is about, ringed where the thumb already is. The
    // defence step needs no mark — the deny prompt fills the middle of the
    // screen with the very arrow it is asking for.
    if (s.highlight === 'base') {
      const lx = this.w * 0.22, ly = this.h * 0.58, R = 46;
      c.beginPath();
      c.arc(lx, ly, R + 3 * pulse, 0, Math.PI * 2);
      c.strokeStyle = `rgba(127,166,255,${0.4 + pulse * 0.5})`;
      c.lineWidth = 3;
      c.stroke();
      c.font = `700 11px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.textAlign = 'center';
      c.fillText('БАЗА', lx, ly - R - 14);
    } else if (s.highlight === 'ring' || s.highlight === 'grip') {
      const { R, cx, cy } = this.ringLayout();
      const rr = s.highlight === 'grip' ? R * 0.34 : R * 0.72;
      c.beginPath();
      c.arc(cx, cy, rr + 3 * pulse, 0, Math.PI * 2);
      c.strokeStyle = `rgba(255,209,102,${0.4 + pulse * 0.5})`;
      c.lineWidth = 3;
      c.stroke();
    }
  }

  _tutorialDone() {
    const c = this.ctx;
    c.fillStyle = 'rgba(4,6,10,0.84)';
    c.fillRect(0, 0, this.w, this.h);
    c.textAlign = 'center';
    c.font = `800 26px ${FONT}`;
    c.fillStyle = '#4fd48a';
    c.fillText('ОБУЧЕНИЕ ПРОЙДЕНО', this.w / 2, this.h / 2 - 26);
    c.font = `600 13px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillText('база · переход · захват · защита — всё на месте', this.w / 2, this.h / 2 + 6);
    c.font = `600 12px ${FONT}`;
    c.fillStyle = '#ffd166';
    c.globalAlpha = 0.55 + 0.45 * Math.sin(this.pulse * 3);
    c.fillText('КОСНИСЬ — ВЫХОДИ НА НАСТОЯЩЕГО СОПЕРНИКА', this.w / 2, this.h / 2 + 40);
    c.globalAlpha = 1;
  }

  // `hush` keeps the feed running without showing it. The belt card wants the
  // screen to itself, and simply not calling this would stop the entries
  // ageing — so «ВЫ — победа по очкам» would be sitting in the corner, still
  // fresh, at whatever moment the player let the card go.
  _events(m, dt, hush = false) {
    const c = this.ctx;
    c.textAlign = 'left';
    let y = this.h - 24;
    for (const e of m.events) {
      e.t += dt;
      const a = Math.max(0, 1 - Math.max(0, e.t - 2.6) / 1.2);
      if (a <= 0 || hush) continue;
      c.globalAlpha = a;
      c.font = `600 11px ${FONT}`;
      c.fillStyle = COLORS[e.kind] || 'rgba(255,255,255,0.75)';
      c.fillText(e.n > 1 ? `${e.text} ×${e.n}` : e.text, 16, y);
      y -= 16;
    }
    c.globalAlpha = 1;
  }

  // The title-card menu: five belts, three match lengths, a start button. One
  // source of geometry for both drawing and hit-testing, the same rule the
  // control ring runs on — a button you can see but cannot press is exactly the
  // bug this exists to prevent. Everything sits in the left half, where the
  // stick is, so the hero on the right stays clear and a thumb can reach it.
  menuLayout() {
    const left = Math.max(22, this.w * 0.05);
    // A little narrower than it was (0.37 of the width), because the column
    // now sits on a panel fourteen pixels wider on each side, and the panel —
    // not the text — is what has to stay clear of the window the picture is
    // framed into (gallery.js, from 0.43 of the width).
    const mw = Math.min(236, this.w * 0.35);
    const top = Math.min(Math.max(50, this.h * 0.15), 96);
    // Two doors and the fighter's, as one segmented control: three tabs of
    // one bar read as one choice, three separate buttons read as three.
    const modeY = top + 18, modeH = 28;
    const modeW = mw / 3;
    const beltY = modeY + modeH + 24;
    // The rows take what the glass leaves. At a fixed 32 pixels a row the
    // column ran fifteen pixels off the bottom of a phone held sideways, and
    // the one line of rules under the start button was the part cut off.
    const tail = 16 + 24 + 12 + 36 + 24;
    const pitch = Math.max(20, Math.min(32, (this.h - 10 - beltY - tail) / 5));
    const rowH = pitch - 4;
    const timeY = beltY + 5 * pitch + 16;
    const timeH = 24;
    const startY = timeY + timeH + 12;
    const startH = 36;
    const cw = mw / 3;
    const py = Math.max(4, top - 54);
    return {
      left, mw, top, rowH, pitch, beltY, timeY, timeH, startY, startH, modeY, modeH,
      panel: { x: left - 14, y: py, w: mw + 28, h: Math.min(this.h - 6, startY + startH + 26) - py },
      mode: (i) => ({ x: left + i * modeW, y: modeY, w: modeW, h: modeH }),
      belt: (i) => ({ x: left, y: beltY + i * pitch, w: mw, h: rowH }),
      time: (t) => ({ x: left + TIMES_ORDER.indexOf(t) * cw, y: timeY, w: cw, h: timeH }),
      start: { x: left, y: startY, w: mw, h: startH },
    };
  }

  // What a tap on the title card meant: a belt, a match length, or the start
  // of the fight. Null — empty glass — is the start too.
  menuHit(p) {
    if (!p) return null;
    const L = this.menuLayout();
    for (let i = 0; i < 3; i++) if (inside(p, L.mode(i))) return { kind: 'mode', value: MODES[i] };
    if (inside(p, L.start)) return { kind: 'start' };
    for (let i = 0; i < 5; i++) if (inside(p, L.belt(i))) return { kind: 'belt', value: i };
    for (const t of TIMES_ORDER) if (inside(p, L.time(t))) return { kind: 'time', value: t };
    return null;
  }

  // The full-screen button, in the corner every screen shares. It is the one
  // control that belongs to the page rather than the match, so it sits clear
  // of the scorebug and the ring: top-right, where no thumb rests and where
  // the eye goes when it looks for a way out of the browser chrome.
  fsButton() {
    return { x: this.w - 24, y: 26, r: 21 };
  }

  fsHit(p) {
    if (!p) return false;
    const b = this.fsButton();
    return Math.hypot(p.x - b.x, p.y - b.y) <= b.r;
  }

  // Where the replay's bars are, so camera-check can ask whether a head is
  // under one.
  replayLayout() {
    const bar = Math.round(Math.min(40, this.h * 0.09));
    return { top: bar, bottom: this.h - bar };
  }

  _replay(r) {
    const c = this.ctx;
    const L = this.replayLayout();
    const bar = L.top;
    // Letterbox: the broadcast's own way of saying «this already happened».
    c.fillStyle = 'rgba(2,3,6,0.92)';
    c.fillRect(0, 0, this.w, bar);
    c.fillRect(0, L.bottom, this.w, this.h - L.bottom);
    // «ПОВТОР», with the red dot a broadcast puts on anything it is not
    // showing live — blinking, because a still dot reads as a light.
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.font = `800 13px ${FONT}`;
    const x = 16, y = bar / 2;
    c.fillStyle = `rgba(255,70,60,${0.55 + 0.45 * Math.round((Math.sin(this.pulse * 5) + 1) / 2)})`;
    c.beginPath();
    c.arc(x + 5, y, 4.5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#f2f3f5';
    c.fillText('ПОВТОР', x + 16, y);
    const tw = c.measureText('ПОВТОР').width;
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.font = `600 10px ${FONT}`;
    c.fillText('× 0.5', x + 16 + tw + 8, y);
    // How much is left, as a line along the bottom bar, and how to leave.
    const pw = this.w - 32;
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(16, L.bottom + 6, pw, 2);
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillRect(16, L.bottom + 6, pw * r.progress, 2);
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = `600 10px ${FONT}`;
    c.fillText('КОСНИСЬ — ДАЛЬШЕ', this.w / 2, L.bottom + (this.h - L.bottom) / 2 + 3);
  }

  _fullscreen(opts) {
    const c = this.ctx;
    const b = this.fsButton();
    const on = !!opts.fullscreen;

    c.save();
    c.beginPath();
    c.arc(b.x, b.y, 15, 0, Math.PI * 2);
    c.fillStyle = 'rgba(8,11,17,0.5)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 1;
    c.stroke();

    // Four corner brackets: hugged to the corners to mean "make it bigger",
    // pulled in to mean "bring it back". The glyph the whole web uses for
    // this, in thin lines.
    const m = on ? 6 : 9;
    const len = 7;
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    c.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = b.x + sx * m;
      const cy = b.y + sy * m;
      c.moveTo(cx - sx * len, cy);
      c.lineTo(cx, cy);
      c.lineTo(cx, cy - sy * len);
    }
    c.stroke();
    c.restore();

    // The one-line answer for a browser that refused the ask. Centred near
    // the bottom so it never fights the menu or the scorebug for attention.
    if (opts.fsHint) {
      c.save();
      c.font = `600 12px ${FONT}`;
      const w = c.measureText(opts.fsHint).width + 32;
      const x = (this.w - w) / 2;
      const y = this.h - 46;
      roundRect(c, x, y - 16, w, 32, 8);
      c.fillStyle = 'rgba(6,8,12,0.92)';
      c.fill();
      c.strokeStyle = 'rgba(255,209,102,0.6)';
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.textAlign = 'center';
      c.fillText(opts.fsHint, x + w / 2, y + 1);
      c.restore();
    }
  }

  /* --------------------------------------------------------- menu kit */

  // The pieces every menu screen is built of, so the title, the fighter and
  // the room are one design rather than three. Each draws, and none decides
  // where: the rectangles come from the layout functions, which the hit tests
  // read too.

  // Letter spacing, where the browser has it (Chrome 99, Safari 17): the
  // labels in caps are set wide, the way a broadcast sets them. Where it has
  // not, the same text at the default spacing.
  _track(px) {
    const c = this.ctx;
    if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
  }

  // The dimming behind a menu: the picture stays, the left third goes dark
  // enough that nothing in the hall reads through the panel's edge.
  _menuShade() {
    const c = this.ctx;
    const g = c.createLinearGradient(0, 0, this.w * 0.62, 0);
    g.addColorStop(0, 'rgba(3,5,9,0.72)');
    g.addColorStop(0.55, 'rgba(3,5,9,0.38)');
    g.addColorStop(1, 'rgba(3,5,9,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);
    const b = c.createLinearGradient(0, this.h * 0.55, 0, this.h);
    b.addColorStop(0, 'rgba(3,5,9,0)');
    b.addColorStop(1, 'rgba(3,5,9,0.7)');
    c.fillStyle = b;
    c.fillRect(0, 0, this.w, this.h);
  }

  // The panel the column sits on. Before it the rows sat straight on the
  // picture, and the boards' lettering ran through the middle of them.
  //
  // Baked once per size and copied after that: a blurred shadow is the most
  // expensive thing a 2D canvas does, the menu redraws every frame, and a
  // phone's canvas pays for the blur whether or not anything moved.
  _panel(r) {
    const key = `${Math.round(r.w)}x${Math.round(r.h)}@${this.dpr}`;
    const pad = 32;
    this._panels = this._panels || new Map();
    let cached = this._panels.get(key);
    if (!cached) {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil((r.w + pad * 2) * this.dpr);
      cv.height = Math.ceil((r.h + pad * 2) * this.dpr);
      const k = cv.getContext('2d');
      k.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const was = this.ctx;
      this.ctx = k;
      this._panelDraw({ x: pad, y: pad, w: r.w, h: r.h });
      this.ctx = was;
      if (this._panels.size > 12) this._panels.clear();
      cached = cv;
      this._panels.set(key, cv);
    }
    this.ctx.drawImage(cached, r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
  }

  _panelDraw(r) {
    const c = this.ctx;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 24;
    c.shadowOffsetY = 6;
    roundRect(c, r.x, r.y, r.w, r.h, 16);
    const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, 'rgba(16,20,30,0.90)');
    g.addColorStop(1, 'rgba(7,9,14,0.94)');
    c.fillStyle = g;
    c.fill();
    c.restore();
    roundRect(c, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 16);
    c.strokeStyle = 'rgba(255,255,255,0.07)';
    c.lineWidth = 1;
    c.stroke();
    // A gold rule along the top, fading out: the one accent the panel wears.
    const a = c.createLinearGradient(r.x, 0, r.x + r.w, 0);
    a.addColorStop(0, 'rgba(255,209,102,0)');
    a.addColorStop(0.2, 'rgba(255,209,102,0.85)');
    a.addColorStop(0.8, 'rgba(255,209,102,0.25)');
    a.addColorStop(1, 'rgba(255,209,102,0)');
    c.fillStyle = a;
    c.fillRect(r.x + 16, r.y, r.w - 32, 2);
  }

  // A belt, drawn as one: the colour, a sheen along it, the rank bar near the
  // tip (black on every belt but the black one, where it is red) and, when
  // there are any, the stripes of tape on the bar.
  _beltBar(x, y, w, h, col, stripes = 0) {
    const c = this.ctx;
    roundRect(c, x, y, w, h, Math.min(3, h / 2));
    c.fillStyle = rgb(col);
    c.fill();
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    c.fillStyle = g;
    c.fill();
    const dark = col[0] + col[1] + col[2] < 0.25;
    const bw = Math.max(8, w * 0.26), bx = x + w - bw - Math.max(3, w * 0.08);
    c.fillStyle = dark ? '#8a1410' : '#0b0b0c';
    c.fillRect(bx, y, bw, h);
    c.fillStyle = 'rgba(240,240,236,0.9)';
    for (let i = 0; i < stripes; i++) c.fillRect(bx + bw - 3 - i * 4, y, 2, h);
    roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, Math.min(3, h / 2));
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1;
    c.stroke();
  }

  // A padlock: the shackle and the body, drawn small.
  _lock(cx, cy, a = 0.45) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = `rgba(255,255,255,${a})`;
    c.fillStyle = `rgba(255,255,255,${a})`;
    c.lineWidth = 1.4;
    c.beginPath();
    c.arc(cx, cy - 2, 3.2, Math.PI, 0);
    c.lineTo(cx + 3.2, cy + 0.5);
    c.moveTo(cx - 3.2, cy + 0.5);
    c.lineTo(cx - 3.2, cy - 2);
    c.stroke();
    roundRect(c, cx - 4.8, cy, 9.6, 7, 1.5);
    c.fill();
    c.restore();
  }

  // A small-caps heading across the column, with a hairline carried on to
  // the panel's edge, so the column reads in sections.
  _section(x, y, w, text, col = 'rgba(255,255,255,0.46)') {
    const c = this.ctx;
    c.font = `800 9px ${FONT}`;
    this._track(1.4);
    c.textAlign = 'left';
    c.fillStyle = col;
    c.fillText(text, x, y);
    const tw = c.measureText(text).width;
    this._track(0);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(x + tw + 8, Math.round(y), Math.max(0, w - tw - 8), 1);
  }

  // A segmented control: one track, the chosen segment a gold pill in it.
  _segments(rects, labels, on, font = 11) {
    const c = this.ctx;
    const a = rects[0], z = rects[rects.length - 1];
    const track = { x: a.x, y: a.y, w: z.x + z.w - a.x, h: a.h };
    roundRect(c, track.x, track.y, track.w, track.h, track.h / 2);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.lineWidth = 1;
    c.stroke();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (i === on) {
        c.save();
        c.shadowColor = 'rgba(255,196,70,0.35)';
        c.shadowBlur = 10;
        roundRect(c, r.x + 2, r.y + 2, r.w - 4, r.h - 4, (r.h - 4) / 2);
        const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, '#ffe08f');
        g.addColorStop(1, '#f4bf45');
        c.fillStyle = g;
        c.fill();
        c.restore();
      } else if (i > 0 && i - 1 !== on) {
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(r.x, r.y + 7, 1, r.h - 14);
      }
      // The label shrinks until it fits its segment, rather than spilling
      // into the next one: «ТЯЖЁЛЫЙ» is wider than a quarter of a phone's
      // column at the size the others are set in.
      let px = font;
      this._track(0.8);
      do { c.font = `800 ${px}px ${FONT}`; } while (px-- > 7 && c.measureText(labels[i]).width > r.w - 10);
      c.fillStyle = i === on ? '#1a1203' : 'rgba(255,255,255,0.78)';
      c.textAlign = 'center';
      c.fillText(labels[i], r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      this._track(0);
    }
    c.textAlign = 'left';
  }

  // The button that does the thing: gold, lit from above, with a chevron.
  _primary(r, label) {
    const c = this.ctx;
    c.save();
    c.shadowColor = 'rgba(255,190,60,0.35)';
    c.shadowBlur = 16;
    c.shadowOffsetY = 3;
    roundRect(c, r.x, r.y, r.w, r.h, r.h / 2);
    const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, '#ffe39a');
    g.addColorStop(0.55, '#f7c64f');
    g.addColorStop(1, '#e0a52c');
    c.fillStyle = g;
    c.fill();
    c.restore();
    // The sheen, and a slow pulse along it so the one button that starts
    // something is the one that looks alive.
    c.save();
    roundRect(c, r.x, r.y, r.w, r.h, r.h / 2);
    c.clip();
    const hi = c.createLinearGradient(0, r.y, 0, r.y + r.h / 2);
    hi.addColorStop(0, 'rgba(255,255,255,0.32)');
    hi.addColorStop(1, 'rgba(255,255,255,0.04)');
    c.fillStyle = hi;
    c.fillRect(r.x, r.y, r.w, r.h / 2);
    c.restore();
    const t = (this.pulse * 0.35) % 1.6;
    if (t < 1) {
      c.save();
      roundRect(c, r.x, r.y, r.w, r.h, r.h / 2);
      c.clip();
      const sx = r.x - 60 + (r.w + 120) * t;
      const s = c.createLinearGradient(sx - 40, 0, sx + 40, 0);
      s.addColorStop(0, 'rgba(255,255,255,0)');
      s.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      s.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = s;
      c.fillRect(r.x, r.y, r.w, r.h);
      c.restore();
    }
    c.font = `900 14px ${FONT}`;
    this._track(2);
    c.fillStyle = '#1a1203';
    c.textAlign = 'center';
    c.fillText(label, r.x + r.w / 2 - 6, r.y + r.h / 2 + 0.5);
    const tw = c.measureText(label).width;
    this._track(0);
    const ax = r.x + r.w / 2 - 6 + tw / 2 + 12, ay = r.y + r.h / 2;
    c.strokeStyle = '#1a1203';
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(ax - 3, ay - 5);
    c.lineTo(ax + 2, ay);
    c.lineTo(ax - 3, ay + 5);
    c.stroke();
    c.textAlign = 'left';
  }

  // A plain button: the same shape as the primary, in glass.
  _ghost(r, label) {
    const c = this.ctx;
    roundRect(c, r.x, r.y, r.w, r.h, r.h / 2);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 1;
    c.stroke();
    c.font = `800 10px ${FONT}`;
    this._track(1.2);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.textAlign = 'center';
    c.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
    this._track(0);
    c.textAlign = 'left';
  }

  // A row of a list: glass, and when it is the chosen one a warmer glass, a
  // gold edge and a gold bar down its left side.
  _row(r, on, dim = false) {
    const c = this.ctx;
    roundRect(c, r.x, r.y, r.w, r.h, 8);
    if (on) {
      const g = c.createLinearGradient(r.x, 0, r.x + r.w, 0);
      g.addColorStop(0, 'rgba(255,209,102,0.16)');
      g.addColorStop(1, 'rgba(255,209,102,0.03)');
      c.fillStyle = g;
    } else {
      c.fillStyle = dim ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.045)';
    }
    c.fill();
    c.strokeStyle = on ? 'rgba(255,209,102,0.55)' : 'rgba(255,255,255,0.07)';
    c.lineWidth = 1;
    c.stroke();
    if (on) {
      roundRect(c, r.x + 3, r.y + 5, 3, r.h - 10, 1.5);
      c.fillStyle = '#ffd166';
      c.fill();
    }
  }

  // A face, at the size of a thumbnail: his skin, his hair over the crown,
  // and a ring round it.
  _face(cx, cy, r, skin, hair, on) {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.clip();
    const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.2, r * 0.2, cx, cy, r);
    g.addColorStop(0, srgb(skin.map((v) => v * 1.15)));
    g.addColorStop(1, srgb(skin.map((v) => v * 0.8)));
    c.fillStyle = g;
    c.fillRect(cx - r, cy - r, r * 2, r * 2);
    c.fillStyle = srgb(hair);
    c.beginPath();
    c.ellipse(cx, cy - r * 0.85, r * 1.05, r * 0.62, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.beginPath();
    c.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    c.strokeStyle = on ? 'rgba(255,209,102,0.9)' : 'rgba(255,255,255,0.22)';
    c.lineWidth = 1.5;
    c.stroke();
  }

  // A fighter's portrait: a bust on a badge the colour of his game.
  //
  // The men on the mat are two baked heads; a card can afford more than that,
  // and a list of twenty-four men needs it — so the portrait is drawn, not
  // rendered: shoulders in the kimono he wears, a neck, a head lit from the
  // upper left, his haircut (roster.js, `look`) and his beard if he has one,
  // brows set low the way a fighter's are. Baked once per man and size and
  // copied after that, like the panel.
  _avatar(x, y, s, face, on = false) {
    if (!face) return;
    const key = `${face.id}|${face.gi}|${Math.round(s)}|${this.dpr}`;
    this._avatars = this._avatars || new Map();
    let cv = this._avatars.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = Math.ceil(s * this.dpr);
      cv.height = Math.ceil(s * this.dpr);
      const k = cv.getContext('2d');
      k.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      drawPortrait(k, s, face);
      if (this._avatars.size > 96) this._avatars.clear();
      this._avatars.set(key, cv);
    }
    const c = this.ctx;
    const r = Math.max(4, s * 0.22);
    if (on) {
      c.save();
      c.shadowColor = 'rgba(255,200,80,0.55)';
      c.shadowBlur = 12;
      roundRect(c, x, y, s, s, r);
      c.fillStyle = '#ffd166';
      c.fill();
      c.restore();
    }
    c.drawImage(cv, x, y, s, s);
    roundRect(c, x + 0.5, y + 0.5, s - 1, s - 1, r);
    c.strokeStyle = on ? '#ffd166' : 'rgba(255,255,255,0.18)';
    c.lineWidth = on ? 2 : 1;
    c.stroke();
  }

  // A round button with a chevron, for the way back: in the header of every
  // screen that is not the title, where no screen size can push it off.
  _backButton(r) {
    const c = this.ctx;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.min(r.w, r.h) / 2 - 2;
    c.beginPath();
    c.arc(cx, cy, rad, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.fill();
    c.strokeStyle = 'rgba(255,209,102,0.55)';
    c.lineWidth = 1.2;
    c.stroke();
    c.strokeStyle = '#ffd166';
    c.lineWidth = 2.2;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(cx + 2, cy - 5.5);
    c.lineTo(cx - 3.5, cy);
    c.lineTo(cx + 2, cy + 5.5);
    c.stroke();
  }

  // The header back of a sub-screen: the button, where it sits.
  headBack(L) {
    return { x: L.left - 6, y: L.top - 44, w: 32, h: 32 };
  }

  // The brand across the top of the column: a word set wide, and under it
  // the belt you are wearing, as a belt.
  _brand(L, title, sub, beltCol, stripes, back = null) {
    const c = this.ctx;
    c.textAlign = 'left';
    if (back) this._backButton(back);
    const tx = back ? back.x + back.w + 8 : L.left;
    const size = Math.round(Math.min(26, this.w * 0.04));
    c.font = `900 ${size}px ${FONT}`;
    this._track(3);
    c.fillStyle = '#fff';
    c.fillText(title, tx, L.top - 27);
    const tw = c.measureText(title).width;
    this._track(0);
    if (beltCol) this._beltBar(tx, L.top - 13, Math.min(L.mw, tw + 18), 6, beltCol, stripes);
    else {
      c.fillStyle = '#ffd166';
      c.fillRect(tx, L.top - 12, 28, 3);
    }
    c.font = `700 10px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.58)';
    // Too long for the column, it loses its last clause rather than a word
    // in the middle of one; only a single clause too long is cut short.
    let s = sub;
    while (c.measureText(s).width > L.mw && s.includes(' · ')) s = s.slice(0, s.lastIndexOf(' · '));
    while (s.length > 4 && c.measureText(s).width > L.mw) s = s.slice(0, -2) + '…';
    c.fillText(s, L.left, L.top + 4);
  }

  _title(opts) {
    const c = this.ctx;
    this._menuShade();

    const L = this.menuLayout();
    const sel = opts.selection || { belt: 0, time: 5 };
    const belts = opts.belts || [];
    const times = opts.times || TIMES_ORDER;
    const rank = opts.progress ? opts.progress.rank : 0;
    const rec = opts.progress && (opts.progress.wins || opts.progress.losses)
      ? ` · ${opts.progress.wins}—${opts.progress.losses}` : '';
    this._panel(L.panel);

    // Brand, with the belt you have earned under it — as a belt, the one
    // thing on this screen that says where a career has got to.
    const mine = belts.find((b) => b.name === opts.mine);
    const who = opts.fighter ? `${opts.fighter.myName} · ${opts.fighter.myWeight.toLowerCase()} · ` : '';
    this._brand(L, 'JIU-JITSU', `${who}пояс: ${(opts.mineLabel || 'БЕЛЫЙ').toLowerCase()}${rec}`,
      mine ? mine.col : null, opts.progress ? Math.min(4, opts.progress.titles | 0) : 0);

    // The three doors. The fight is where the ladder is climbed, the room is
    // where a move is drilled until it works, and the fighter is who you are.
    // All always open — nothing in the gym is locked behind a belt, because a
    // beginner is exactly who needs it.
    const door = opts.screen === 'gym' ? 1 : opts.screen === 'fighter' ? 2 : 0;
    this._segments([0, 1, 2].map((i) => L.mode(i)), MODE_LABEL, door, 11);

    // The men. Locked rungs — past the one you have earned — are dimmed and
    // answer nothing; the rest pick the man you fight next. The ones in the
    // tournament's bracket carry their round (see cup.js), and the header says
    // whether the fight picked is the tournament's next one or sparring.
    const cup = opts.cup || null;
    this._section(L.left, L.beltY - 11, L.mw,
      !cup ? 'СЛОЖНОСТЬ' : cup.on ? `ТУРНИР · ${cup.round}` : 'СПАРРИНГ · ВНЕ ТУРНИРА',
      cup && !cup.on ? 'rgba(255,255,255,0.46)' : 'rgba(255,209,102,0.9)');
    for (let i = 0; i < belts.length; i++) {
      const b = belts[i];
      const r = L.belt(i);
      const locked = !opts.forced && i > rank;
      const on = sel.belt === i;
      const mid = r.y + r.h / 2;
      this._row(r, on, locked);
      c.globalAlpha = locked ? 0.42 : 1;
      // The belt's own colour, as a belt: the swatch a man ties on.
      this._beltBar(r.x + 12, mid - 3.5, 22, 7, b.col);
      c.font = `800 11px ${FONT}`;
      this._track(0.6);
      c.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.84)';
      c.textAlign = 'left';
      c.fillText(b.label, r.x + 42, mid + 0.5);
      let at = r.x + 42 + c.measureText(b.label).width + 8;
      this._track(0);
      // His round in the bracket: done, next, or still ahead — as a chip.
      const j = cup ? cup.rungs.indexOf(i) : -1;
      if (j >= 0 && !locked) {
        const done = j < cup.stage, next = j === cup.stage;
        const tag = done ? `${cup.rounds[j]} ✓` : cup.rounds[j];
        c.font = `900 8px ${FONT}`;
        const tw = c.measureText(tag).width + 10;
        roundRect(c, at, mid - 7, tw, 14, 7);
        c.fillStyle = done ? 'rgba(79,212,138,0.16)' : next ? 'rgba(255,209,102,0.2)' : 'rgba(255,255,255,0.06)';
        c.fill();
        c.fillStyle = done ? 'rgba(79,212,138,0.95)' : next ? '#ffd166' : 'rgba(255,255,255,0.5)';
        c.textAlign = 'center';
        c.fillText(tag, at + tw / 2, mid + 0.5);
        c.textAlign = 'left';
        at += tw + 6;
      }
      c.textAlign = 'right';
      if (locked) {
        this._lock(r.x + r.w - 16, mid - 2);
      } else {
        // And how he fights, under his name. Five men with five styles (see
        // STYLES in ai.js) are five different fights, and a player choosing
        // whom to face next should be able to read which.
        // His face, at the end of the row: the man, not the belt.
        const as = Math.min(r.h - 4, 24);
        this._avatar(r.x + r.w - 6 - as, mid - as / 2, as, b.face, on);
        const nx = r.x + r.w - 12 - as;
        // His style under his name where the row has room for both — and
        // not where the round's chip already reaches into it.
        c.font = `600 8px ${FONT}`;
        const styleW = b.style ? c.measureText(b.style).width : 0;
        const two = !!b.style && r.h >= 20 && at + 4 < nx - styleW;
        c.font = `800 10px ${FONT}`;
        c.fillStyle = on ? '#ffd166' : 'rgba(255,255,255,0.72)';
        c.fillText(b.man, nx, mid - (two ? 5 : 0));
        const manW = c.measureText(b.man).width + as + 6;
        if (two) {
          c.font = `600 8px ${FONT}`;
          c.fillStyle = on ? 'rgba(255,209,102,0.75)' : 'rgba(255,255,255,0.4)';
          c.fillText(b.style, nx, mid + 7);
        }
        // What you have done to this man, and he to you, once there is
        // something to say — and only where it fits between his name and
        // the chip.
        const rc = (opts.records && opts.records[i]) || [0, 0];
        if (rc[0] || rc[1]) {
          c.font = `700 9px ${FONT}`;
          const line = `${rc[0]}—${rc[1]}`;
          const lw = c.measureText(line).width;
          if (at + lw < r.x + r.w - 10 - manW - 8) {
            c.textAlign = 'left';
            c.fillStyle = rc[0] > rc[1] ? 'rgba(79,212,138,0.8)'
              : rc[1] > rc[0] ? 'rgba(255,106,85,0.8)' : 'rgba(255,255,255,0.42)';
            c.fillText(line, at, mid + 0.5);
          }
        }
      }
      c.textAlign = 'left';
      c.globalAlpha = 1;
    }

    // The match length — the one number that changes the shape of the fight
    // without touching the fight itself.
    this._section(L.left, L.timeY - 9, L.mw, 'РЕГЛАМЕНТ');
    this._segments(times.map((t) => L.time(t)), times.map((t) => `${t} МИН`), times.indexOf(sel.time), 10);

    // The start, named for what it starts: the round, or sparring. And the
    // one rule a new player needs underneath it, where it fits.
    this._primary(L.start, !cup ? 'В БОЙ' : cup.on ? cup.round : 'СПАРРИНГ');
    const hintY = L.start.y + L.start.h + 13;
    if (hintY < L.panel.y + L.panel.h - 4) {
      const hint = 'очки — за +N на кольце, если удержать 3 секунды';
      let px = 9;
      do { c.font = `600 ${px}px ${FONT}`; } while (px-- > 7 && c.measureText(hint).width > L.mw);
      c.fillStyle = 'rgba(255,255,255,0.46)';
      c.textAlign = 'center';
      c.fillText(hint, L.left + L.mw / 2, hintY);
      c.textAlign = 'left';
    }

    this._caption(opts);
  }

  // What the picture behind a menu is a picture of.
  //
  // A plate without a caption is decoration; with one it is the only place in
  // the game where somebody who has never trained is told the name of what he
  // is looking at, six times over, while he decides which belt to fight. The
  // words come from the pose library through the gallery — see gallery.js —
  // and they fade with the page, so the caption is never up over the picture
  // of something else.
  _caption(opts) {
    const c = this.ctx;
    if (!opts.plate) return;
    const alpha = Math.max(0, Math.min(1, opts.plate.page));
    const right = this.w - Math.max(18, this.w * 0.04);
    const base = this.h - 24;
    c.globalAlpha = alpha;
    c.textAlign = 'right';
    const cap = opts.plate.caption.toUpperCase();
    c.font = `900 ${Math.round(Math.min(20, this.w * 0.028))}px ${FONT}`;
    this._track(1.5);
    c.fillStyle = 'rgba(255,255,255,0.96)';
    c.fillText(cap, right, base);
    const wide = c.measureText(cap).width;
    this._track(0);
    const g = c.createLinearGradient(right - wide, 0, right, 0);
    g.addColorStop(0, 'rgba(255,209,102,0)');
    g.addColorStop(1, 'rgba(255,209,102,0.95)');
    c.fillStyle = g;
    c.fillRect(right - wide, base + 9, wide, 2);
    c.font = `800 9px ${FONT}`;
    this._track(2);
    c.fillStyle = 'rgba(255,209,102,0.8)';
    c.fillText('ПОЗИЦИЯ', right, base - 19);
    this._track(0);
    c.globalAlpha = 1;
    c.textAlign = 'left';
  }

  // The fighter: four weight classes across the top, the six men of the one
  // showing as cards with their portraits, what the chosen man is like, and
  // the three kimonos. The same column as the title menu, so the picture
  // behind it has the same window — and the picture is the point: it is the
  // pair from the ladder, drawn with the man and the kimono picked here, so a
  // tap on a card changes the body on the mat and not only a word.
  fighterLayout() {
    const M = this.menuLayout();
    const { left, mw, top } = M;
    const tabY = top + 18, tabH = 26;
    const tabW = mw / 4;
    const gridY = tabY + tabH + 10;
    const GAP = 6;
    const cardW = (mw - GAP * 2) / 3;
    // Two rows of three in what the glass leaves. Where it leaves too little
    // for a face anybody can read, the line about the chosen man goes first.
    const tailFull = 40 + 12 + 24 + 10 + 34 + 6;
    const tailShort = 12 + 24 + 10 + 34 + 6;
    let info = true;
    let cardH = (this.h - 10 - gridY - tailFull - GAP) / 2;
    if (cardH < 50) { info = false; cardH = (this.h - 10 - gridY - tailShort - GAP) / 2; }
    cardH = Math.max(40, Math.min(84, cardH));
    const infoY = gridY + cardH * 2 + GAP + 6;
    const giY = infoY + (info ? 40 : 0) + 12;
    const giH = 24;
    const giW = mw / 3;
    const backY = giY + giH + 10;
    return {
      left, mw, top, tabY, gridY, cardW, cardH, info, infoY, giY,
      panel: { x: M.panel.x, y: M.panel.y, w: M.panel.w, h: Math.min(this.h - 6, backY + 34 + 14) - M.panel.y },
      head: this.headBack(M),
      tab: (i) => ({ x: left + i * tabW, y: tabY, w: tabW, h: tabH }),
      card: (i) => ({ x: left + (i % 3) * (cardW + GAP), y: gridY + Math.floor(i / 3) * (cardH + GAP), w: cardW, h: cardH }),
      gi: (i) => ({ x: left + i * giW, y: giY, w: giW, h: giH }),
      back: { x: left, y: backY, w: mw, h: 34 },
    };
  }

  fighterHit(p, f) {
    if (!p || !f) return null;
    const L = this.fighterLayout();
    if (inside(p, L.head)) return { kind: 'back' };
    for (let i = 0; i < f.weights.length; i++) if (inside(p, L.tab(i))) return { kind: 'weight', value: f.weights[i].id };
    for (let i = 0; i < f.men.length; i++) if (inside(p, L.card(i))) return { kind: 'man', value: f.men[i].id };
    for (let i = 0; i < f.gis.length; i++) if (inside(p, L.gi(i))) return { kind: 'gi', value: f.gis[i].id };
    if (inside(p, L.back)) return { kind: 'back' };
    return null;
  }

  _fighter(opts) {
    const c = this.ctx;
    const f = opts.fighter;
    if (!f) return;
    this._menuShade();
    const L = this.fighterLayout();
    this._panel(L.panel);
    const tab = f.weights.find((w) => w.id === f.tab) || f.weights[0];
    this._brand(L, 'БОЕЦ', `${tab.label.toLowerCase()} · ${tab.limit} · турнир в своём весе`, null, 0, L.head);

    // The classes, as one control.
    this._segments(f.weights.map((_, i) => L.tab(i)), f.weights.map((w) => w.label),
      f.weights.findIndex((w) => w.id === f.tab), 10);

    // The men, as cards: his portrait, his name, his game.
    let picked = null;
    for (let i = 0; i < f.men.length; i++) {
      const m = f.men[i];
      const r = L.card(i);
      const on = m.id === f.mine;
      if (on) picked = m;
      roundRect(c, r.x, r.y, r.w, r.h, 10);
      if (on) {
        const g = c.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, 'rgba(255,209,102,0.2)');
        g.addColorStop(1, 'rgba(255,209,102,0.05)');
        c.fillStyle = g;
      } else c.fillStyle = 'rgba(255,255,255,0.045)';
      c.fill();
      c.strokeStyle = on ? 'rgba(255,209,102,0.8)' : 'rgba(255,255,255,0.08)';
      c.lineWidth = on ? 1.5 : 1;
      c.stroke();
      const nameH = r.h >= 56 ? 22 : 13;
      const s = Math.max(20, Math.min(r.w - 14, r.h - nameH - 10));
      this._avatar(r.x + (r.w - s) / 2, r.y + 5, s, m.face, on);
      c.textAlign = 'center';
      let px = 10;
      this._track(0.5);
      do { c.font = `800 ${px}px ${FONT}`; } while (px-- > 7 && c.measureText(m.name).width > r.w - 6);
      c.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.86)';
      c.fillText(m.name, r.x + r.w / 2, r.y + 5 + s + (nameH > 13 ? 8 : 7));
      this._track(0);
      if (nameH > 13) {
        let sp = 8;
        do { c.font = `700 ${sp}px ${FONT}`; } while (sp-- > 6 && c.measureText(m.style).width > r.w - 6);
        c.fillStyle = on ? 'rgba(255,209,102,0.9)' : 'rgba(255,255,255,0.46)';
        c.fillText(m.style, r.x + r.w / 2, r.y + 5 + s + 19);
      }
      c.textAlign = 'left';
    }

    // What the picked man is like: his game in words, and his three numbers
    // as bars — the same three a Fighter carries, so what is drawn is what
    // the match reads.
    const show = picked || f.men[0];
    if (show && L.info) {
      c.font = `700 9px ${FONT}`;
      c.fillStyle = picked ? 'rgba(255,209,102,0.9)' : 'rgba(255,255,255,0.5)';
      c.fillText(picked ? `${show.name.charAt(0)}${show.name.slice(1).toLowerCase()} — ${show.long}` : 'коснись, чтобы выбрать',
        L.left, L.infoY + 6);
      const bars = [['СИЛА', show.stats.strength], ['ТЕХНИКА', show.stats.technique], ['ДЫХАНИЕ', show.stats.cardio]];
      const bw = (L.mw - 16) / 3;
      for (let k = 0; k < 3; k++) {
        const x = L.left + k * (bw + 8), y = L.infoY + 21;
        c.font = `800 7px ${FONT}`;
        this._track(1);
        c.fillStyle = 'rgba(255,255,255,0.46)';
        c.fillText(bars[k][0], x, y);
        this._track(0);
        // Drawn from 0.3: every number in the roster is within a tenth of
        // one half, and a bar from zero would show six identical men.
        meter(c, x, y + 7, bw, 4, (bars[k][1] - 0.3) / 0.4, '#ffd166', 'rgba(255,255,255,0.1)');
      }
    }

    // The kimono: three chips of cloth, the one he wears ringed and ticked.
    this._section(L.left, L.giY - 10, L.mw, 'КИМОНО');
    for (let i = 0; i < f.gis.length; i++) {
      const k = f.gis[i];
      const r = L.gi(i);
      const on = k.id === f.gi;
      const cx = r.x + (i === 0 ? 0 : 3), cw = r.w - 3 - (i === 0 ? 0 : 3);
      roundRect(c, cx, r.y, cw, r.h, r.h / 2);
      c.fillStyle = on ? 'rgba(255,209,102,0.14)' : 'rgba(255,255,255,0.045)';
      c.fill();
      c.strokeStyle = on ? 'rgba(255,209,102,0.8)' : 'rgba(255,255,255,0.1)';
      c.lineWidth = on ? 1.5 : 1;
      c.stroke();
      const sx = cx + 12, sy = r.y + r.h / 2;
      c.beginPath();
      c.arc(sx, sy, 6, 0, Math.PI * 2);
      c.fillStyle = srgb(k.col);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = 1;
      c.stroke();
      if (on) {
        c.strokeStyle = k.col[0] > 0.5 ? '#1a1203' : '#fff';
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(sx - 2.8, sy);
        c.lineTo(sx - 0.6, sy + 2.2);
        c.lineTo(sx + 3, sy - 2.2);
        c.stroke();
      }
      let px = 9;
      do { c.font = `800 ${px}px ${FONT}`; } while (px-- > 7 && c.measureText(k.label).width > cw - 30);
      c.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.72)';
      c.fillText(k.label, sx + 11, sy + 0.5);
    }

    this._primary(L.back, 'ГОТОВО');
    this._caption(opts);
  }

  /* ---------------------------------------------------------------- зал */

  // The drill list. Six at a time and paged, rather than a scrolling list:
  // scrolling inside a canvas overlay means writing momentum, bounds and a
  // scrollbar by hand, and every one of those is a place for a tap to be eaten
  // — which is the bug the ring's own layout function exists to prevent. Six
  // rows and a "next" is the same information with none of that.
  GYM_ROWS = 6;

  // The same column as the title's, now: it was nearly half the width and
  // wider than the window the picture is framed into (gallery.js).
  gymLayout() {
    const M = this.menuLayout();
    const { left, mw, top } = M;
    const listY = top + 20;
    const tail = 10 + 30 + 14;
    const pitch = Math.max(30, Math.min(38, (this.h - 10 - listY - tail) / this.GYM_ROWS));
    const rowH = pitch - 4;
    const footY = listY + this.GYM_ROWS * pitch + 8;
    const fw = (mw - 8) / 2;
    return {
      left, mw, top, rowH, pitch, listY, footY,
      panel: { x: M.panel.x, y: M.panel.y, w: M.panel.w, h: Math.min(this.h - 6, footY + 30 + 14) - M.panel.y },
      head: this.headBack(M),
      row: (i) => ({ x: left, y: listY + i * pitch, w: mw, h: rowH }),
      more: { x: left, y: footY, w: fw, h: 30 },
      back: { x: left + fw + 8, y: footY, w: fw, h: 30 },
    };
  }

  gymHit(p) {
    if (!p) return null;
    const L = this.gymLayout();
    if (inside(p, L.head)) return { kind: 'back' };
    if (inside(p, L.more)) return { kind: 'more' };
    if (inside(p, L.back)) return { kind: 'back' };
    for (let i = 0; i < this.GYM_ROWS; i++) if (inside(p, L.row(i))) return { kind: 'drill', value: i };
    return null;
  }

  _gym(opts) {
    const c = this.ctx;
    this._menuShade();
    const L = this.gymLayout();
    this._panel(L.panel);
    const list = opts.gymList || [];
    const gym = opts.gym || { drilled: 0, total: 0, page: 0, pages: 1 };
    this._brand(L, 'ЗАЛ', `отработка приёмов · освоено ${gym.drilled} из ${gym.total}`, null, 0, L.head);

    for (let i = 0; i < this.GYM_ROWS; i++) {
      const d = list[i];
      const r = L.row(i);
      // The row whose move is the picture behind the list is the chosen one,
      // so the picture says which name it belongs to.
      const shown = !!d && i === opts.gymFeatured;
      this._row(r, shown, !d);
      if (!d) continue;
      const mid = r.y + r.h / 2;
      c.textAlign = 'left';
      c.font = `800 11px ${FONT}`;
      c.fillStyle = shown ? '#fff' : 'rgba(255,255,255,0.88)';
      c.fillText(d.name, r.x + 14, mid - 6);
      c.font = `600 9px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.46)';
      c.fillText(`${d.from} · ${d.round}`, r.x + 14, mid + 8);
      // Three marks: the rounds passed, as three stripes of tape — a drill
      // is a ladder of three, and a stripe is how a gym says you climbed one.
      for (let k = 0; k < 3; k++) {
        const on = d.level > k;
        roundRect(c, r.x + r.w - 16 - k * 9, mid - 7, 5, 14, 1.5);
        c.fillStyle = on ? '#ffd166' : 'rgba(255,255,255,0.12)';
        c.fill();
      }
    }

    this._ghost(L.more, `ЕЩЁ · ${gym.page + 1}/${gym.pages}`);
    this._ghost(L.back, 'НАЗАД');
    this._caption(opts);
  }

  // The banner over a drill in progress. It takes the scorebug's place rather
  // than sitting under it: a drill has no score, no clock and no advantages,
  // and drawing three empty ones would say the opposite.
  drillExit() {
    // Top left, which in a drill is the one corner nothing else wants: the
    // scorebug is not drawn, and both bottom corners are under a thumb for the
    // whole session. It first sat bottom right and landed on the ring's own
    // label for the button underneath it.
    return { x: 10, y: 12, w: 36, h: 36 };
  }

  drillExitHit(p) {
    return !!p && inside(p, this.drillExit());
  }

  _drillBar(d) {
    const c = this.ctx;
    const ex = this.drillExit();
    // Beside the way out, not over it: centred, the banner sat on top of the
    // exit button on any phone narrower than about seven hundred pixels.
    const x = Math.max((this.w - Math.min(560, this.w - 28)) / 2, ex.x + ex.w + 10);
    const w = Math.min(560, this.w - x - 14);
    this._panel({ x, y: 8, w, h: 44 });

    c.textAlign = 'left';
    c.font = `900 13px ${FONT}`;
    this._track(0.8);
    c.fillStyle = '#fff';
    c.fillText(d.name, x + 14, 23);
    this._track(0);
    c.font = `700 9px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.52)';
    c.fillText(`${d.from} · ${d.round} · нужно ${d.need} из ${d.reps}`, x + 14, 38);

    // Six pips, filled as the attempts go by. Green landed, red not; the ones
    // still to come are hollow, so the row reads as "how much of this is left"
    // as well as "how it is going".
    for (let i = 0; i < d.reps; i++) {
      const px = x + w - 16 - (d.reps - 1 - i) * 15;
      c.beginPath();
      c.arc(px, 30, 5, 0, Math.PI * 2);
      const r = d.marks[i];
      c.fillStyle = r === 'hit' ? 'rgba(110,220,140,0.95)'
        : r ? 'rgba(230,110,110,0.85)' : 'rgba(255,255,255,0.14)';
      c.fill();
    }

    // The line the round is about, under the banner and out of the way of both
    // thumbs.
    c.textAlign = 'center';
    c.font = `600 11px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.66)';
    c.fillText(d.hint, this.w / 2, 66);
    c.textAlign = 'left';

    // The way out, as the menu's own back button.
    this._backButton({ x: ex.x, y: ex.y, w: 36, h: 36 });
  }


  /* ---------------------------------------------------------- cards */

  // A card in the middle of the glass: the menu's panel, centred, over a
  // dimmed frame. The pause, the end of a drill and the result are all one.
  _cardBack(a = 0.66) {
    const c = this.ctx;
    c.fillStyle = `rgba(3,5,9,${a})`;
    c.fillRect(0, 0, this.w, this.h);
  }

  // The pause button, in the fight: under the scorebug on the left, the one
  // corner of a phone held sideways that no thumb and no number is using.
  pauseButton() {
    return { x: 10, y: 72, w: 36, h: 36 };
  }

  pauseButtonHit(p) {
    return !!p && inside(p, this.pauseButton());
  }

  _pauseButton() {
    const c = this.ctx;
    const b = this.pauseButton();
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    c.beginPath();
    c.arc(cx, cy, 15, 0, Math.PI * 2);
    c.fillStyle = 'rgba(8,11,17,0.55)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.88)';
    roundRect(c, cx - 5, cy - 6, 3.5, 12, 1.2);
    c.fill();
    roundRect(c, cx + 1.5, cy - 6, 3.5, 12, 1.2);
    c.fill();
  }

  pauseLayout() {
    const w = Math.min(300, this.w - 40);
    const h = 156;
    const x = (this.w - w) / 2, y = (this.h - h) / 2;
    return {
      panel: { x, y, w, h },
      resume: { x: x + 20, y: y + 62, w: w - 40, h: 36 },
      menu: { x: x + 20, y: y + 106, w: w - 40, h: 32 },
    };
  }

  pauseHit(p) {
    if (!p) return null;
    const L = this.pauseLayout();
    if (inside(p, L.resume)) return 'resume';
    if (inside(p, L.menu)) return 'menu';
    return null;
  }

  _pause() {
    const c = this.ctx;
    this._cardBack(0.6);
    const L = this.pauseLayout();
    this._panel(L.panel);
    c.textAlign = 'center';
    c.font = `900 20px ${FONT}`;
    this._track(3);
    c.fillStyle = '#fff';
    c.fillText('ПАУЗА', L.panel.x + L.panel.w / 2, L.panel.y + 28);
    this._track(0);
    c.font = `600 10px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText('выход в меню — бой не засчитывается', L.panel.x + L.panel.w / 2, L.panel.y + 46);
    this._primary(L.resume, 'ПРОДОЛЖИТЬ');
    this._ghost(L.menu, 'ВЫЙТИ В МЕНЮ');
  }

  // What a finished round says. Two buttons, because after a drill there are
  // exactly two things anybody wants: again, or something else.
  drillOverLayout() {
    const w = Math.min(320, this.w - 40);
    const x = (this.w - w) / 2;
    const h = 146;
    const y = (this.h - h) / 2;
    const bw = (w - 40 - 10) / 2;
    return {
      x, y, w, h,
      again: { x: x + 20, y: y + h - 50, w: bw, h: 34 },
      back: { x: x + 20 + bw + 10, y: y + h - 50, w: bw, h: 34 },
    };
  }

  drillOverHit(p) {
    if (!p) return null;
    const L = this.drillOverLayout();
    if (inside(p, L.again)) return { kind: 'again' };
    if (inside(p, L.back)) return { kind: 'back' };
    return null;
  }

  _drillOver(d) {
    const c = this.ctx;
    this._cardBack(0.66);
    const L = this.drillOverLayout();
    this._panel({ x: L.x, y: L.y, w: L.w, h: L.h });
    const mx = L.x + L.w / 2;
    c.textAlign = 'center';
    c.font = `900 20px ${FONT}`;
    this._track(3);
    c.fillStyle = d.passed ? '#ffd166' : 'rgba(255,255,255,0.92)';
    c.fillText(d.passed ? 'СДАНО' : 'НЕ СДАНО', mx, L.y + 28);
    this._track(0);
    // The attempts as the banner showed them: one pip each, green or not.
    const n = d.reps || 0;
    for (let i = 0; i < n; i++) {
      const px = mx - (n - 1) * 8 + i * 16;
      c.beginPath();
      c.arc(px, L.y + 50, 5, 0, Math.PI * 2);
      c.fillStyle = i < d.hits ? 'rgba(110,220,140,0.95)' : 'rgba(255,255,255,0.14)';
      c.fill();
    }
    c.font = `600 10px ${FONT}`;
    c.fillStyle = d.raised ? '#ffd166' : 'rgba(255,255,255,0.55)';
    c.fillText(`${d.hits} из ${d.reps} · нужно ${d.need} · ${d.note}`, mx, L.y + 70);
    c.textAlign = 'left';
    this._primary(L.again, 'ЕЩЁ РАЗ');
    this._ghost(L.back, 'В ЗАЛ');
  }

  // The result: who won and how, the two men face to face with the score
  // between them, what it meant for the tournament, the разбор, and two ways
  // on — the next fight, which any press still is, and the menu.
  resultLayout(rows = 3) {
    const w = Math.min(440, this.w - 32);
    const short = this.h < 360;
    const av = short ? 40 : 54;
    const lineH = 14;
    const need = 24 + 26 + 14 + 10 + av + 16 + 18 + 16 + rows * lineH + 12 + 36 + 18;
    const h = Math.min(this.h - 16, need);
    const x = (this.w - w) / 2, y = (this.h - h) / 2;
    const bw = (w - 40 - 10);
    return {
      panel: { x, y, w, h }, av, lineH, need,
      next: { x: x + 20 + bw * 0.34 + 10, y: y + h - 52, w: bw * 0.66, h: 36 },
      menu: { x: x + 20, y: y + h - 50, w: bw * 0.34, h: 32 },
    };
  }

  resultHit(p) {
    if (!p) return null;
    const L = this.resultLayout(this._dbLines || 3);
    if (inside(p, L.menu)) return 'menu';
    return 'next';
  }

  _result(m, opts = {}) {
    const c = this.ctx;
    this._cardBack(0.7);
    // The разбор. Read once, off the tape the match kept of itself, and held
    // for as long as the card is up — debrief() walks the whole tape and this
    // card is drawn sixty times a second.
    //
    // It is here rather than on a screen of its own because a card that says
    // only who won is a card nobody reads twice, and because the thing a
    // beaten player wants is not a tutorial, it is the answer to "what did I
    // do". Three lines, each one a fact about this match and a fix.
    if (this._dbTape !== m.tape) { this._dbTape = m.tape; this._db = m.debrief(); }
    const all = (this._db && this._db.lines) || [];
    const r = this.result;
    const gym = r && r.drill && r.drill.tries > 1 ? r.drill : null;
    // As many lines as the glass has room for.
    let rows = all.length + (gym ? 1 : 0);
    while (rows > 0 && this.resultLayout(rows).need > this.h - 16) rows--;
    const L = this.resultLayout(rows);
    this._dbLines = rows;
    this._panel(L.panel);
    const P = L.panel, mx = P.x + P.w / 2;
    let y = P.y + 26;

    c.textAlign = 'center';
    const word = m.winner === 0 ? 'ПОБЕДА' : m.winner === 1 ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ';
    c.font = `900 22px ${FONT}`;
    this._track(4);
    c.fillStyle = m.winner === 0 ? '#5fe09a' : m.winner === 1 ? '#ff7a64' : '#fff';
    c.fillText(word, mx, y);
    this._track(0);
    y += 20;
    const by = { submission: 'сдачей', points: 'по очкам', advantages: 'по преимуществам', draw: '' };
    c.font = `700 10px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.55)';
    const winner = m.winner === null ? '' : m.winner === 0 ? 'ты' : m.f[m.winner].name.toLowerCase();
    c.fillText(m.winner === null ? 'очки и преимущества поровну' : `${winner} — ${by[m.winBy] || ''}`, mx, y);
    y += 14;

    // Face to face, the score between them.
    const faces = opts.faces;
    const ay = y;
    const gap = Math.min(150, P.w * 0.36);
    if (faces) {
      this._avatar(mx - gap - L.av / 2, ay, L.av, faces[0], m.winner === 0);
      this._avatar(mx + gap - L.av / 2, ay, L.av, faces[1], m.winner === 1);
      c.font = `800 9px ${FONT}`;
      this._track(1);
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.fillText('ТЫ', mx - gap, ay + L.av + 11);
      c.fillText(m.f[1].name, mx + gap, ay + L.av + 11);
      this._track(0);
    }
    c.font = `900 ${L.av > 44 ? 34 : 28}px ${FONT}`;
    c.fillStyle = '#fff';
    c.fillText(`${m.f[0].points} : ${m.f[1].points}`, mx, ay + L.av / 2 + 2);
    const adv = m.f[0].advantages || m.f[1].advantages;
    if (adv) {
      c.font = `700 9px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillText(`преимущества ${m.f[0].advantages} : ${m.f[1].advantages}`, mx, ay + L.av / 2 + 24);
    }
    y = ay + L.av + 28;

    // What the win was worth, in the tournament the fight was for.
    if (r) {
      const beat = r.beatLabel || r.beat, next = r.nextLabel || r.next;
      const k = r.cup;
      const line = k && k.kind === 'title'
        ? (r.champion && !r.climbed ? `турнир чёрных поясов взят — выше некуда`
          : `турнир взят  ·  ты ${next} пояс`)
        : k && k.kind === 'next' ? `${k.round} взят  ·  дальше ${k.nextRound} — ${k.nextMan}`
        : k && k.kind === 'out' ? (k.size > 1 ? `вылет в ${k.round}е  ·  новый турнир с ${k.first}а` : `${k.round} проигран  ·  ещё раз`)
        : r.spar ? `спарринг  ·  в турнире ждёт ${r.cupRound} — ${r.cupMan}`
        : r.champion && r.won ? `ты прошёл всю лестницу — ${beat} пояс взят`
        : r.climbed ? `${beat} пояс взят  ·  следующий: ${next}`
        : r.won ? `${beat} пояс взят`
        : `${beat} пояс — ещё раз`;
      c.font = `800 10px ${FONT}`;
      const tw = Math.min(P.w - 30, c.measureText(line).width + 22);
      roundRect(c, mx - tw / 2, y - 9, tw, 18, 9);
      c.fillStyle = r.won ? 'rgba(255,209,102,0.16)' : 'rgba(255,255,255,0.07)';
      c.fill();
      c.fillStyle = r.won ? '#ffd166' : 'rgba(255,255,255,0.78)';
      c.fillText(line, mx, y + 0.5);
      y += 22;
    }

    // Разбор: what this match was, in the game's own numbers — and where to
    // go about it: the room next door has already put that move first.
    const lines = gym
      ? [`в зале: ${gym.name.toLowerCase()} — ${plural(gym.tries, 'заход', 'захода', 'заходов')} за бой`, ...all]
      : all.slice();
    if (rows > 0) {
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(P.x + 30, y - 4, P.w - 60, 1);
      y += 8;
      for (let i = 0; i < rows && i < lines.length; i++) {
        c.font = `600 10px ${FONT}`;
        c.fillStyle = gym && i === 0 ? 'rgba(255,209,102,0.85)' : 'rgba(255,255,255,0.78)';
        let t = lines[i];
        while (t.length > 4 && c.measureText(t).width > P.w - 30) t = t.slice(0, -2) + '…';
        c.fillText(t, mx, y + i * L.lineH);
      }
    }
    c.textAlign = 'left';

    const label = r && r.cup && r.cup.kind === 'out' && r.cup.size > 1 ? 'НОВЫЙ ТУРНИР'
      : r && !r.won ? 'ЕЩЁ РАЗ' : 'ДАЛЬШЕ';
    this._primary(L.next, label);
    this._ghost(L.menu, 'МЕНЮ');
  }

  // Where the belt is drawn, so a tool can read the picture at the pixel
  // instead of re-deriving this arithmetic and drifting from it — the same
  // reason the ring and the room hand out their layouts.
  promoLayout(roll = 1) {
    const bh = Math.round(Math.min(58, this.h * 0.13));
    const bw = Math.min(this.w - 32, 460) * roll;
    const bx = (this.w - bw) / 2;
    const by = this.h / 2 - bh / 2;
    const barW = Math.round(bh * 0.62);
    return {
      band: { x: bx, y: by, w: bw, h: bh },
      bar: { x: bx + bw - barW * 2.6, y: by, w: barW, h: bh },
    };
  }

  // The belt.
  //
  // Everything else on this screen is a number: points, time, a rank in a
  // list. A belt is not a number — it is the one thing anybody outside the
  // sport knows about it, and until now taking one was a grey half-line in the
  // corner of the result card. So it gets the whole screen, for as long as the
  // player wants to look at it, and it is drawn rather than written: a band of
  // its own colour across the frame with the black bar at the end of it, which
  // is the picture of a belt that needs no caption.
  //
  // Nothing here is a button. The press that dismisses it is any press, and
  // the prompt at the bottom shows up at the moment the press starts working
  // — main.js will not take a touch that lands inside the first eight tenths
  // of a second, because the bell, the roar and this card all arrive together
  // and a thumb still moving from the last exchange would wipe it away unseen.
  _promo(p) {
    const c = this.ctx;
    const w = this.w, h = this.h;
    // Two eases off the same clock: the band unrolls, and the words come up
    // behind it a beat later.
    const ease = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
    const roll = ease(p.t / 0.5);
    const said = ease((p.t - 0.28) / 0.5);

    c.fillStyle = 'rgba(3,5,9,0.82)';
    c.fillRect(0, 0, w, h);

    // A cone of light on the band, so the hall reads as a hall rather than as
    // a dark rectangle with a belt drawn on it.
    const mid = h * 0.5;
    const glow = c.createRadialGradient(w / 2, mid, 0, w / 2, mid, Math.max(w, h) * 0.55);
    glow.addColorStop(0, `rgba(${(p.col[0] * 255) | 0},${(p.col[1] * 255) | 0},${(p.col[2] * 255) | 0},0.22)`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);

    /* --- the band ------------------------------------------------------- */
    const L = this.promoLayout(roll);
    const { x: bx, y: by, w: bw, h: bh } = L.band;
    // It sits on something. Without the shadow the band is a progress bar.
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(bx + 3, by + 5, bw, bh);
    c.fillStyle = rgb(p.col);
    c.fillRect(bx, by, bw, bh);
    // Cloth: a highlight along the top edge and a shadow under it, which is
    // the whole of what makes a flat rectangle look like something woven.
    //
    // The highlight is scaled by the belt's own lightness rather than being a
    // fixed amount of white. Source-over is arithmetic, so this is a number
    // and not a taste: a flat 0.20 of white over the black belt's own
    // rgb(10,10,12) lifts its top edge to 59, six times the cloth under it,
    // while on blue it is a lift of half again. Scaled, the black belt's edge
    // comes out at 24 and the sheen stays a sheen on every colour. The card is
    // read at the pixel by smoke, on the band and on the bar both.
    const lum = 0.2126 * p.col[0] + 0.7152 * p.col[1] + 0.0722 * p.col[2];
    const hi = 0.05 + 0.17 * lum;
    const shade = c.createLinearGradient(0, by, 0, by + bh);
    shade.addColorStop(0, `rgba(255,255,255,${hi.toFixed(3)})`);
    shade.addColorStop(0.45, 'rgba(255,255,255,0.02)');
    shade.addColorStop(1, 'rgba(0,0,0,0.34)');
    c.fillStyle = shade;
    c.fillRect(bx, by, bw, bh);
    // Two rows of stitching down its length, the way a belt is actually sewn.
    c.strokeStyle = 'rgba(0,0,0,0.22)';
    c.lineWidth = 1;
    for (const f of [0.3, 0.7]) {
      c.beginPath();
      c.moveTo(bx, Math.round(by + bh * f) + 0.5);
      c.lineTo(bx + bw, Math.round(by + bh * f) + 0.5);
      c.stroke();
    }
    // The rank bar. Black on every belt but the black one, where it is red —
    // that is the IBJJF's own rule and the one detail a practitioner checks.
    if (bw > L.bar.w * 3.2) {
      c.fillStyle = p.belt === 'black' ? BAR_RED : BAR_BLACK;
      c.fillRect(L.bar.x, L.bar.y, L.bar.w, L.bar.h);
      c.fillStyle = 'rgba(255,255,255,0.10)';
      c.fillRect(L.bar.x, L.bar.y, L.bar.w, Math.round(bh * 0.16));
    }

    /* --- what it is ----------------------------------------------------- */
    c.textAlign = 'center';
    c.globalAlpha = said;

    // The name of the belt, as big as it goes. «КОРИЧНЕВЫЙ ПОЯС» is fourteen
    // letters and the screen is a phone held sideways, so the size is measured
    // against the text rather than picked and hoped for.
    const title = `${p.label} ПОЯС`;
    let size = Math.round(Math.min(34, h * 0.075));
    c.font = `900 ${size}px ${FONT}`;
    this._track(3);
    const room = Math.min(w - 40, 460);
    const got = c.measureText(title).width;
    if (got > room) {
      size = Math.max(14, Math.floor(size * room / got));
      c.font = `900 ${size}px ${FONT}`;
    }
    const titleY = by - 22 - size / 2;
    c.fillStyle = '#fff';
    c.fillText(title, w / 2, titleY);
    this._track(0);

    // And what kind of moment this is, above it — measured off the title's own
    // size, because the first version put it at a fixed offset and the two
    // lines landed on top of each other.
    c.font = `800 10px ${FONT}`;
    this._track(2.5);
    c.fillStyle = 'rgba(255,209,102,0.9)';
    c.fillText(p.champion ? 'ЛЕСТНИЦА ПРОЙДЕНА' : p.rounds > 1 ? 'ТУРНИР ВЗЯТ · НОВЫЙ ПОЯС' : 'НОВЫЙ ПОЯС',
      w / 2, titleY - size / 2 - 12);
    this._track(0);

    // Who it came off, and who is next. Two short lines under the band,
    // because a belt with nobody's name on it is a trophy for nothing.
    c.font = `600 12px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.72)';
    c.fillText(p.rounds > 1 ? `в финале — у ${p.beatOf}` : `выиграл у ${p.beatOf}`, w / 2, by + bh + 28);
    c.font = `600 11px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.fillText(p.champion ? 'дальше некого' : `следующий турнир: в финале — ${p.nextMan}`, w / 2, by + bh + 48);
    c.globalAlpha = 1;

    // The way out, and it appears exactly when it starts working.
    if (p.t > 0.8) {
      c.globalAlpha = 0.6 + 0.4 * Math.sin(this.pulse * 3);
      this._ghost({ x: w / 2 - 110, y: h - 50, w: 220, h: 30 }, 'КОСНИСЬ, ЧТОБЫ ПРОДОЛЖИТЬ');
      c.globalAlpha = 1;
      c.textAlign = 'center';
    }
    c.textAlign = 'left';
  }

}

// How long the score pill lives, in seconds. Shared with main.js, which is
// what clears it: the HUD draws what it is handed and never owns a timer.
export const PUNCH_LIFE = 1.5;

// The rank bar at the end of the belt: black on every belt but the black one,
// where the IBJJF makes it red. Named because smoke reads them off the card.
const BAR_BLACK = '#0b0d10';
const BAR_RED = '#8d1116';

const COLORS = {
  points: '#ffd166', big: '#ffd166', sub: '#ff6a55', win: '#fff',
  deny: '#7fa6ff', adv: '#c9a227', warn: 'rgba(255,255,255,0.45)',
  fail: 'rgba(255,255,255,0.45)', escape: '#4fd48a',
};

const tau = (p) => -Math.PI / 2 + Math.PI * 2 * p;
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
const TIMES_ORDER = [3, 5, 10];
const MODES = ['fight', 'gym', 'fighter'];
const MODE_LABEL = ['БОЙ', 'ЗАЛ', 'БОЕЦ'];
// A linear albedo as the eye sees it on the mat, for a swatch: the renderer
// lights and tone-maps what it is given, a canvas does not.
function srgb(c) {
  const g = (v) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2));
  return `rgb(${g(c[0])},${g(c[1])},${g(c[2])})`;
}
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

function rgb(c) {
  return `rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0})`;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function meter(c, x, y, w, h, v, fg, bg) {
  c.fillStyle = bg;
  roundRect(c, x, y, w, h, h / 2);
  c.fill();
  const f = Math.max(0, Math.min(1, v));
  if (f > 0.001) {
    c.fillStyle = fg;
    roundRect(c, x, y, Math.max(h, w * f), h, h / 2);
    c.fill();
  }
}

// Which side of even a chance is on: green for better than three in five,
// amber for a coin, red for worse than one in three.
function oddsColour(p) {
  return p >= 0.6 ? '#4fd48a' : p >= 0.35 ? '#ffd166' : '#ff6a55';
}

function arrow(c, x, y, dx, dy, col, s = 9) {
  c.save();
  c.translate(x, y);
  c.rotate(Math.atan2(dy, dx));
  c.beginPath();
  c.moveTo(s, 0);
  c.lineTo(-s * 0.55, -s * 0.7);
  c.lineTo(-s * 0.2, 0);
  c.lineTo(-s * 0.55, s * 0.7);
  c.closePath();
  c.fillStyle = col;
  c.fill();
  c.restore();
}

// Russian counts three ways and a result card is read once: «1 заход», «2
// захода», «5 заходов», and the teens are all the third form.
function plural(n, one, few, many) {
  const t = n % 100, u = n % 10;
  const w = t >= 11 && t <= 14 ? many : u === 1 ? one : u >= 2 && u <= 4 ? few : many;
  return `${n} ${w}`;
}

function wrapText(c, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  const lines = [];
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  const start = y - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => c.fillText(l, x, start + i * lh));
}

// The colour of each way of fighting, for the badge a portrait sits on.
const STYLE_HUE = {
  wrestler: ['#e0703f', '#5a1d0c'],
  guard: ['#36b3a5', '#0b3a36'],
  escape: ['#9a74e6', '#2a1652'],
  pressure: ['#5a86d4', '#13244a'],
  finisher: ['#d8445c', '#4a0c18'],
};

// The portrait itself, at size s, into a context of its own. Every measure is
// a fraction of s, so the same face reads at thirty pixels and at sixty.
function drawPortrait(c, s, f) {
  const P = (v) => v * s;
  const [hi, lo] = STYLE_HUE[f.style] || ['#6a7488', '#1a1f2b'];
  const r = Math.max(4, s * 0.22);
  c.save();
  roundRect(c, 0, 0, s, s, r);
  c.clip();
  // The badge: his game's colour, lit from above, with a fine diagonal grain.
  const bg = c.createRadialGradient(P(0.35), P(0.2), P(0.05), P(0.5), P(0.5), P(0.85));
  bg.addColorStop(0, hi);
  bg.addColorStop(1, lo);
  c.fillStyle = bg;
  c.fillRect(0, 0, s, s);
  c.strokeStyle = 'rgba(255,255,255,0.06)';
  c.lineWidth = Math.max(1, s * 0.02);
  for (let k = -s; k < s * 2; k += s * 0.12) {
    c.beginPath();
    c.moveTo(k, 0);
    c.lineTo(k - s, s);
    c.stroke();
  }

  const skin = f.skin, hair = f.hair;
  const tone = (col, m) => srgb([col[0] * m, col[1] * m, col[2] * m]);
  const look = f.look || 'crop';
  const beard = look.includes('beard');
  const cut = look.split('+')[0];

  // Hair that falls behind the head goes first.
  if (cut === 'long') {
    c.fillStyle = tone(hair, 1);
    roundRect(c, P(0.29), P(0.24), P(0.42), P(0.46), P(0.14));
    c.fill();
  }

  // The shoulders, in his kimono: lit across the top, the lapels crossing
  // into a V at the chest.
  const gi = f.gi || [0.88, 0.89, 0.87];
  const giG = c.createLinearGradient(0, P(0.68), 0, s);
  giG.addColorStop(0, tone(gi, 1.12));
  giG.addColorStop(1, tone(gi, 0.62));
  c.fillStyle = giG;
  c.beginPath();
  c.moveTo(P(0.02), s);
  c.bezierCurveTo(P(0.04), P(0.82), P(0.2), P(0.73), P(0.37), P(0.71));
  c.lineTo(P(0.63), P(0.71));
  c.bezierCurveTo(P(0.8), P(0.73), P(0.96), P(0.82), P(0.98), s);
  c.closePath();
  c.fill();
  // The neck, and the skin the lapels leave open.
  c.fillStyle = tone(skin, 0.82);
  c.fillRect(P(0.42), P(0.55), P(0.16), P(0.2));
  c.beginPath();
  c.moveTo(P(0.4), P(0.71));
  c.lineTo(P(0.6), P(0.71));
  c.lineTo(P(0.5), P(0.9));
  c.closePath();
  c.fill();
  // The lapels: a darker band on a white kimono, a lighter one on a dark.
  const light = gi[0] + gi[1] + gi[2] > 1.2;
  c.strokeStyle = light ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)';
  c.lineWidth = P(0.07);
  c.lineCap = 'butt';
  c.beginPath();
  c.moveTo(P(0.36), P(0.7));
  c.lineTo(P(0.52), P(1.0));
  c.moveTo(P(0.64), P(0.7));
  c.lineTo(P(0.48), P(1.0));
  c.stroke();

  // The head: an oval lit from the upper left, ears a shade darker.
  c.fillStyle = tone(skin, 0.78);
  for (const ex of [0.305, 0.695]) {
    c.beginPath();
    c.ellipse(P(ex), P(0.45), P(0.035), P(0.06), 0, 0, Math.PI * 2);
    c.fill();
  }
  const hg = c.createRadialGradient(P(0.43), P(0.33), P(0.03), P(0.5), P(0.43), P(0.26));
  hg.addColorStop(0, tone(skin, 1.22));
  hg.addColorStop(0.7, tone(skin, 0.98));
  hg.addColorStop(1, tone(skin, 0.74));
  c.fillStyle = hg;
  c.beginPath();
  c.ellipse(P(0.5), P(0.43), P(0.19), P(0.235), 0, 0, Math.PI * 2);
  c.fill();

  // The haircut, clipped to above a hairline that dips to the brow at the
  // middle.
  const hairFill = () => {
    c.save();
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(s, 0);
    c.lineTo(s, P(0.43));
    c.lineTo(P(0.7), P(0.43));
    c.quadraticCurveTo(P(0.5), P(0.25), P(0.3), P(0.43));
    c.lineTo(0, P(0.43));
    c.closePath();
    c.clip();
    c.beginPath();
    c.ellipse(P(0.5), P(0.42), P(0.205), P(0.25), 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  if (cut !== 'bald') {
    c.fillStyle = tone(hair, cut === 'buzz' ? 1.6 : 1.15);
    c.globalAlpha = cut === 'buzz' ? 0.7 : 1;
    hairFill();
    c.globalAlpha = 1;
  }
  if (cut === 'quiff') {
    c.fillStyle = tone(hair, 1.25);
    c.beginPath();
    c.ellipse(P(0.46), P(0.2), P(0.16), P(0.075), -0.25, 0, Math.PI * 2);
    c.fill();
  }
  if (cut === 'curly') {
    c.fillStyle = tone(hair, 1.2);
    for (let k = 0; k < 9; k++) {
      const a = Math.PI * (1.08 + k * 0.105);
      c.beginPath();
      c.arc(P(0.5) + Math.cos(a) * P(0.19), P(0.38) + Math.sin(a) * P(0.2), P(0.05), 0, Math.PI * 2);
      c.fill();
    }
  }
  if (cut === 'bald') {
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath();
    c.ellipse(P(0.44), P(0.27), P(0.07), P(0.035), -0.4, 0, Math.PI * 2);
    c.fill();
  }

  // The face: brows set low, eyes, a shadow under the nose, a mouth.
  const ink = tone(hair, 0.9);
  c.strokeStyle = ink;
  c.lineCap = 'round';
  c.lineWidth = Math.max(1, P(0.03));
  c.beginPath();
  c.moveTo(P(0.37), P(0.385));
  c.lineTo(P(0.46), P(0.4));
  c.moveTo(P(0.63), P(0.385));
  c.lineTo(P(0.54), P(0.4));
  c.stroke();
  c.fillStyle = 'rgba(20,14,12,0.9)';
  for (const ex of [0.425, 0.575]) {
    c.beginPath();
    c.ellipse(P(ex), P(0.435), P(0.022), P(0.016), 0, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = tone(skin, 0.7);
  c.beginPath();
  c.ellipse(P(0.5), P(0.5), P(0.03), P(0.014), 0, 0, Math.PI * 2);
  c.fill();
  if (beard) {
    c.save();
    c.beginPath();
    c.ellipse(P(0.5), P(0.43), P(0.195), P(0.24), 0, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = tone(hair, 1.1);
    c.globalAlpha = 0.92;
    c.beginPath();
    c.moveTo(P(0.28), P(0.46));
    c.quadraticCurveTo(P(0.36), P(0.56), P(0.5), P(0.545));
    c.quadraticCurveTo(P(0.64), P(0.56), P(0.72), P(0.46));
    c.lineTo(P(0.72), P(0.8));
    c.lineTo(P(0.28), P(0.8));
    c.closePath();
    c.fill();
    c.restore();
    c.globalAlpha = 1;
    c.strokeStyle = tone(skin, 0.6);
    c.lineWidth = Math.max(1, P(0.022));
    c.beginPath();
    c.moveTo(P(0.46), P(0.575));
    c.lineTo(P(0.54), P(0.575));
    c.stroke();
  } else {
    c.strokeStyle = tone(skin, 0.58);
    c.lineWidth = Math.max(1, P(0.022));
    c.beginPath();
    c.moveTo(P(0.455), P(0.565));
    c.quadraticCurveTo(P(0.5), P(0.575), P(0.545), P(0.565));
    c.stroke();
  }

  // And a dark fall-off at the bottom of the badge, so the shoulders sit in
  // it rather than being cut by its edge.
  const v = c.createLinearGradient(0, P(0.75), 0, s);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  c.fillStyle = v;
  c.fillRect(0, P(0.75), s, P(0.25));
  c.restore();
}
