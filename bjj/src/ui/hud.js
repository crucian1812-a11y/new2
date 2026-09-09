// The overlay. A second canvas in 2D on top of the WebGL one, because the
// interface is text and thin lines and those are the two things Canvas2D is
// still better at than a shader.
//
// The layout is a broadcast scorebug plus two thumb zones, and the whole thing
// obeys one rule: nothing important may sit where a thumb will be. On a phone
// in landscape the bottom corners are covered by hands for the entire match,
// so the score lives at the top and the transition ring is drawn around the
// thumb rather than under it.

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif';

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
    if (match.state !== 'ready' && !opts.drill && !opts.promo) {
      this._scorebug(match);
      this._positionBar(match);
    }
    if (match.state === 'live' || match.state === 'sub') {
      this._ring(match, input);
      this._stick(input);
    }
    // Points, said out loud. Not on a drill: a drill has no score, and a pill
    // announcing four points for a rep would be announcing a number the room
    // does not keep.
    if (opts.punch && !opts.drill && match.state !== 'ready') this._punch(opts.punch);
    if (match.deny && match.attempt) this._denyPrompt(match);
    if (match.state === 'sub') this._sub(match);
    this._events(match, dt, !!opts.promo);
    if (match.state === 'ready') {
      if (opts.screen === 'gym') this._gym(opts);
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
    else if (match.state === 'over') this._result(match);
    // The first minute's coach, above everything except the result card.
    if (opts.tutorial) {
      if (opts.tutorial.done) this._tutorialDone();
      else if (match.state === 'live' || match.state === 'sub') this._tutorial(opts.tutorial);
    }
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
      c.fillText('STAMINA · POSTURE', i === 0 ? bx : bx + bw, y + 48);
    }
  }

  _positionBar(m) {
    const c = this.ctx;
    const pose = m.pose();
    const y = 76;
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
      if (on && !threat && tr) {
        c.beginPath();
        c.arc(x, y, rr + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * tr.base);
        c.strokeStyle = 'rgba(255,255,255,0.34)';
        c.lineWidth = 2;
        c.stroke();
      }

      arrow(c, x, y, dx, dy, on ? '#fff' : 'rgba(255,255,255,0.2)', R * 0.15);

      // And what it pays. The whole economy is "arrive somewhere worth points
      // and hold it three seconds", and the ring was the one place a player
      // looks and the one place that never mentioned it.
      if (on && !threat && tr && tr.points > 0) {
        c.font = `800 11px ${FONT}`;
        c.fillStyle = '#ffd166';
        c.textAlign = 'center';
        // On the far side of the button from the name, or the two land on each
        // other: for the left and right buttons dy is 0, so both wanted the
        // same four pixels above the circle.
        c.fillText(`+${tr.points}`, x, dy > 0 ? y - rr - 5 : y + rr + 14);
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
        wrapText(c, threat ? 'ЗАЩИТА' : tr.name, x, ly, 100, 10);
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
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.textAlign = 'center';
    c.fillText('ЗАХВАТ', cx, cy);
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
      const by = 108;
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
      c.fillText(e.text, 16, y);
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
    const left = Math.max(20, this.w * 0.05);
    const mw = Math.min(236, this.w * 0.37);
    const top = Math.min(Math.max(46, this.h * 0.14), 96);
    const rowH = 28, pitch = 32;
    // Two doors before anything else: the fight, and the room where you drill
    // it. They sit above the ladder because the ladder is a setting for one of
    // them and not for the other.
    const modeY = top + 18, modeH = 26;
    const modeW = (mw - 8) / 2;
    const beltY = modeY + modeH + 26;
    const timeY = beltY + 5 * pitch + 12;
    const timeH = 24;
    const startY = timeY + timeH + 12;
    const startH = 34;
    const cw = (mw - 12) / 3;
    return {
      left, mw, top, rowH, pitch, beltY, timeY, timeH, startY, startH, modeY, modeH,
      mode: (i) => ({ x: left + i * (modeW + 8), y: modeY, w: modeW, h: modeH }),
      belt: (i) => ({ x: left, y: beltY + i * pitch, w: mw, h: rowH }),
      time: (t) => ({ x: left + TIMES_ORDER.indexOf(t) * (cw + 6), y: timeY, w: cw, h: timeH }),
      start: { x: left, y: startY, w: mw, h: startH },
    };
  }

  // What a tap on the title card meant: a belt, a match length, or the start
  // of the fight. Null — empty glass — is the start too.
  menuHit(p) {
    if (!p) return null;
    const L = this.menuLayout();
    for (let i = 0; i < 2; i++) if (inside(p, L.mode(i))) return { kind: 'mode', value: i ? 'gym' : 'fight' };
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

  _title(opts) {
    const c = this.ctx;
    // A gradient off the bottom rather than a wash over everything: there is a
    // fighter standing behind this now, and the point of him is to be seen.
    const g = c.createLinearGradient(0, this.h * 0.28, 0, this.h);
    g.addColorStop(0, 'rgba(4,6,10,0)');
    g.addColorStop(0.42, 'rgba(4,6,10,0.55)');
    g.addColorStop(1, 'rgba(4,6,10,0.94)');
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);

    const L = this.menuLayout();
    const sel = opts.selection || { belt: 0, time: 5 };
    const belts = opts.belts || [];
    const times = opts.times || TIMES_ORDER;
    const rank = opts.progress ? opts.progress.rank : 0;
    const rec = opts.progress && (opts.progress.wins || opts.progress.losses)
      ? ` · ${opts.progress.wins}—${opts.progress.losses}` : '';

    // Brand, with the belt you have earned riding the same line.
    c.textAlign = 'left';
    c.fillStyle = '#fff';
    c.font = `800 ${Math.round(Math.min(32, this.w * 0.046))}px ${FONT}`;
    c.fillText('JIU-JITSU', L.left, L.top - 16);
    c.font = `600 10px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillText(`позиционная борьба · твой пояс: ${(opts.mine || 'white').toUpperCase()}${rec}`,
      L.left, L.top + 4);

    // The two doors. The fight is where the ladder is climbed; the room is
    // where a move is drilled until it works. Both are always open — nothing
    // in the gym is locked behind a belt, because a beginner is exactly who
    // needs it.
    const gym = opts.gym || { drilled: 0, total: 0 };
    for (let i = 0; i < 2; i++) {
      const r = L.mode(i);
      const on = (opts.screen === 'gym') === (i === 1);
      roundRect(c, r.x, r.y, r.w, r.h, 6);
      c.fillStyle = on ? 'rgba(255,209,102,0.92)' : 'rgba(8,11,17,0.58)';
      c.fill();
      c.strokeStyle = on ? 'rgba(255,209,102,0.92)' : 'rgba(255,255,255,0.14)';
      c.lineWidth = 1;
      c.stroke();
      c.font = `800 12px ${FONT}`;
      c.fillStyle = on ? '#1a1203' : 'rgba(255,255,255,0.82)';
      c.textAlign = 'center';
      c.fillText(i ? 'ЗАЛ' : 'БОЙ', r.x + r.w / 2, r.y + r.h / 2);
      c.textAlign = 'left';
    }

    // The difficulty ladder. Locked rungs — past the one you have earned — are
    // dimmed and answer nothing; the rest pick the man you fight next.
    c.font = `700 9px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.42)';
    c.fillText('СЛОЖНОСТЬ', L.left, L.beltY - 12);
    for (let i = 0; i < belts.length; i++) {
      const b = belts[i];
      const r = L.belt(i);
      const locked = !opts.forced && i > rank;
      const on = sel.belt === i;
      c.globalAlpha = locked ? 0.38 : 1;
      roundRect(c, r.x, r.y, r.w, r.h, 6);
      c.fillStyle = on ? 'rgba(20,28,40,0.86)' : 'rgba(8,11,17,0.58)';
      c.fill();
      c.strokeStyle = on ? 'rgba(255,209,102,0.72)' : 'rgba(255,255,255,0.12)';
      c.lineWidth = on ? 1.5 : 1;
      c.stroke();
      // The belt's colour, the same dot the scorebug wears.
      c.fillStyle = rgb(b.col);
      c.beginPath();
      c.arc(r.x + 14, r.y + r.h / 2, 6, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.28)';
      c.lineWidth = 1;
      c.stroke();
      c.font = `700 11px ${FONT}`;
      c.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.8)';
      // The colour on its own, without the word «ПОЯС» after it. The row is
      // 236 pixels wide on a phone and it now carries four things — the belt's
      // dot, its name, the record against the man and the man — and the first
      // draft of this had «ПУРПУРНЫЙ ПОЯС 2—2РАФАЭЛ» running into itself. The
      // dot beside it and the header above it already say these are belts.
      c.fillText(b.label, r.x + 28, r.y + r.h / 2);
      // What you have done to this man, and he to you. Only once there is
      // something to say: five rows of «0—0» on a fresh install is a scoreboard
      // for a career that has not started.
      const rec = (opts.records && opts.records[i]) || [0, 0];
      if (rec[0] || rec[1]) {
        const at = r.x + 28 + c.measureText(b.label).width + 8;
        const tail = locked ? 'ЗАКРЫТО' : b.man;
        c.font = `600 10px ${FONT}`;
        const room = r.x + r.w - 10 - c.measureText(tail).width - 8;
        c.font = `600 9px ${FONT}`;
        const line = `${rec[0]}—${rec[1]}`;
        // And only where it fits. A name is the row's own, a record is a note
        // beside it, and a note that overlaps what it is a note about is worse
        // than no note.
        if (at + c.measureText(line).width < room) {
          c.fillStyle = rec[0] > rec[1] ? 'rgba(79,212,138,0.75)'
            : rec[1] > rec[0] ? 'rgba(255,106,85,0.75)' : 'rgba(255,255,255,0.4)';
          c.fillText(line, at, r.y + r.h / 2 + 1);
        }
      }
      c.textAlign = 'right';
      if (locked) {
        c.font = `600 9px ${FONT}`;
        c.fillStyle = 'rgba(255,255,255,0.45)';
        c.fillText('ЗАКРЫТО', r.x + r.w - 10, r.y + r.h / 2);
      } else {
        c.font = `600 10px ${FONT}`;
        c.fillStyle = on ? '#ffd166' : 'rgba(255,255,255,0.5)';
        c.fillText(b.man, r.x + r.w - 10, r.y + r.h / 2);
      }
      c.textAlign = 'left';
    }
    c.globalAlpha = 1;

    // The match length — the one number that changes the shape of the fight
    // without touching the fight itself.
    c.font = `700 9px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.42)';
    c.fillText('РЕГЛАМЕНТ', L.left, L.timeY - 10);
    for (const t of times) {
      const r = L.time(t);
      const on = sel.time === t;
      roundRect(c, r.x, r.y, r.w, r.h, 5);
      c.fillStyle = on ? 'rgba(255,209,102,0.92)' : 'rgba(8,11,17,0.58)';
      c.fill();
      c.strokeStyle = on ? 'rgba(255,209,102,0.92)' : 'rgba(255,255,255,0.12)';
      c.lineWidth = 1;
      c.stroke();
      c.font = `700 11px ${FONT}`;
      c.fillStyle = on ? '#1a1203' : 'rgba(255,255,255,0.8)';
      c.textAlign = 'center';
      c.fillText(`${t} МИН`, r.x + r.w / 2, r.y + r.h / 2);
      c.textAlign = 'left';
    }

    // The start, and the one rule a new player needs underneath it.
    const s = L.start;
    roundRect(c, s.x, s.y, s.w, s.h, 8);
    c.fillStyle = 'rgba(255,209,102,0.92)';
    c.fill();
    c.font = `800 15px ${FONT}`;
    c.fillStyle = '#1a1203';
    c.textAlign = 'center';
    c.fillText('В БОЙ', s.x + s.w / 2, s.y + s.h / 2);
    c.textAlign = 'left';
    c.font = `600 10px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText('очки — за +N на кольце, если удержать 3 секунды', L.left, s.y + s.h + 16);
  }

  /* ---------------------------------------------------------------- зал */

  // The drill list. Six at a time and paged, rather than a scrolling list:
  // scrolling inside a canvas overlay means writing momentum, bounds and a
  // scrollbar by hand, and every one of those is a place for a tap to be eaten
  // — which is the bug the ring's own layout function exists to prevent. Six
  // rows and a "next" is the same information with none of that.
  GYM_ROWS = 6;

  gymLayout() {
    const left = Math.max(20, this.w * 0.05);
    const mw = Math.min(300, this.w * 0.46);
    const top = Math.min(Math.max(46, this.h * 0.14), 96);
    const rowH = 30, pitch = 34;
    const listY = top + 26;
    const footY = listY + this.GYM_ROWS * pitch + 8;
    const fw = (mw - 8) / 2;
    return {
      left, mw, top, rowH, pitch, listY, footY,
      row: (i) => ({ x: left, y: listY + i * pitch, w: mw, h: rowH }),
      more: { x: left, y: footY, w: fw, h: 26 },
      back: { x: left + fw + 8, y: footY, w: fw, h: 26 },
    };
  }

  gymHit(p) {
    if (!p) return null;
    const L = this.gymLayout();
    if (inside(p, L.more)) return { kind: 'more' };
    if (inside(p, L.back)) return { kind: 'back' };
    for (let i = 0; i < this.GYM_ROWS; i++) if (inside(p, L.row(i))) return { kind: 'drill', value: i };
    return null;
  }

  _gym(opts) {
    const c = this.ctx;
    const g = c.createLinearGradient(0, this.h * 0.2, 0, this.h);
    g.addColorStop(0, 'rgba(4,6,10,0.2)');
    g.addColorStop(0.4, 'rgba(4,6,10,0.72)');
    g.addColorStop(1, 'rgba(4,6,10,0.96)');
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);

    const L = this.gymLayout();
    const list = opts.gymList || [];
    const gym = opts.gym || { drilled: 0, total: 0, page: 0, pages: 1 };

    c.textAlign = 'left';
    c.fillStyle = '#fff';
    c.font = `800 ${Math.round(Math.min(26, this.w * 0.038))}px ${FONT}`;
    c.fillText('ЗАЛ', L.left, L.top - 16);
    c.font = `600 10px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillText(`отработка приёмов · освоено ${gym.drilled} из ${gym.total}`, L.left, L.top + 2);

    for (let i = 0; i < this.GYM_ROWS; i++) {
      const d = list[i];
      const r = L.row(i);
      roundRect(c, r.x, r.y, r.w, r.h, 6);
      c.fillStyle = 'rgba(8,11,17,0.62)';
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.12)';
      c.lineWidth = 1;
      c.stroke();
      if (!d) continue;
      c.font = `700 11px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.fillText(d.name, r.x + 10, r.y + r.h / 2 - 5);
      c.font = `600 9px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillText(`${d.from} · ${d.round}`, r.x + 10, r.y + r.h / 2 + 8);
      // Three dots: the rounds passed. A drill is a ladder of three and the
      // level is which rung you are standing on, so three marks say it without
      // a word.
      for (let k = 0; k < 3; k++) {
        const on = d.level > k;
        c.beginPath();
        c.arc(r.x + r.w - 14 - k * 12, r.y + r.h / 2, 4, 0, Math.PI * 2);
        c.fillStyle = on ? '#ffd166' : 'rgba(255,255,255,0.16)';
        c.fill();
      }
    }

    for (const [rect, label] of [[L.more, `ЕЩЁ · ${gym.page + 1}/${gym.pages}`], [L.back, 'НАЗАД']]) {
      roundRect(c, rect.x, rect.y, rect.w, rect.h, 6);
      c.fillStyle = 'rgba(8,11,17,0.62)';
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.16)';
      c.lineWidth = 1;
      c.stroke();
      c.font = `700 10px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.82)';
      c.textAlign = 'center';
      c.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
      c.textAlign = 'left';
    }
  }

  // The banner over a drill in progress. It takes the scorebug's place rather
  // than sitting under it: a drill has no score, no clock and no advantages,
  // and drawing three empty ones would say the opposite.
  drillExit() {
    // Top left, which in a drill is the one corner nothing else wants: the
    // scorebug is not drawn, and both bottom corners are under a thumb for the
    // whole session. It first sat bottom right and landed on the ring's own
    // label for the button underneath it.
    return { x: 16, y: 16, w: 62, h: 22 };
  }

  drillExitHit(p) {
    return !!p && inside(p, this.drillExit());
  }

  _drillBar(d) {
    const c = this.ctx;
    const w = Math.min(560, this.w - 28);
    const x = (this.w - w) / 2;
    roundRect(c, x, 8, w, 42, 8);
    c.fillStyle = 'rgba(6,9,14,0.78)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.lineWidth = 1;
    c.stroke();

    c.textAlign = 'left';
    c.font = `800 13px ${FONT}`;
    c.fillStyle = '#fff';
    c.fillText(d.name, x + 12, 22);
    c.font = `600 9px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText(`${d.from} · ${d.round} · нужно ${d.need} из ${d.reps}`, x + 12, 37);

    // Six pips, filled as the attempts go by. Green landed, red not; the ones
    // still to come are hollow, so the row reads as "how much of this is left"
    // as well as "how it is going".
    for (let i = 0; i < d.reps; i++) {
      const px = x + w - 14 - (d.reps - 1 - i) * 15;
      c.beginPath();
      c.arc(px, 26, 5, 0, Math.PI * 2);
      const r = d.marks[i];
      c.fillStyle = r === 'hit' ? 'rgba(110,220,140,0.95)'
        : r ? 'rgba(230,110,110,0.85)' : 'rgba(255,255,255,0.14)';
      c.fill();
    }

    // The line the round is about, under the banner and out of the way of both
    // thumbs.
    c.textAlign = 'center';
    c.font = `600 11px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.62)';
    c.fillText(d.hint, this.w / 2, 62);
    c.textAlign = 'left';

    const b = this.drillExit();
    roundRect(c, b.x, b.y, b.w, b.h, 6);
    c.fillStyle = 'rgba(8,11,17,0.62)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 1;
    c.stroke();
    c.font = `700 10px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.textAlign = 'center';
    c.fillText('ВЫЙТИ', b.x + b.w / 2, b.y + b.h / 2);
    c.textAlign = 'left';
  }

  // What a finished round says. Two buttons, because after a drill there are
  // exactly two things anybody wants: again, or something else.
  drillOverLayout() {
    const w = Math.min(320, this.w * 0.6);
    const x = (this.w - w) / 2;
    const y = this.h * 0.5 - 40;
    const bw = (w - 10) / 2;
    return {
      x, y, w, h: 120,
      again: { x, y: y + 78, w: bw, h: 30 },
      back: { x: x + bw + 10, y: y + 78, w: bw, h: 30 },
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
    c.fillStyle = 'rgba(3,5,9,0.66)';
    c.fillRect(0, 0, this.w, this.h);
    const L = this.drillOverLayout();
    roundRect(c, L.x, L.y, L.w, L.h, 10);
    c.fillStyle = 'rgba(9,13,20,0.94)';
    c.fill();
    c.strokeStyle = d.passed ? 'rgba(255,209,102,0.6)' : 'rgba(255,255,255,0.14)';
    c.lineWidth = 1;
    c.stroke();

    c.textAlign = 'center';
    c.font = `800 18px ${FONT}`;
    c.fillStyle = d.passed ? '#ffd166' : 'rgba(255,255,255,0.9)';
    c.fillText(d.passed ? 'СДАНО' : 'НЕ СДАНО', L.x + L.w / 2, L.y + 26);
    c.font = `600 11px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillText(`${d.hits} из ${d.reps} · нужно ${d.need}`, L.x + L.w / 2, L.y + 48);
    c.font = `600 10px ${FONT}`;
    c.fillStyle = d.raised ? '#ffd166' : 'rgba(255,255,255,0.45)';
    c.fillText(d.note, L.x + L.w / 2, L.y + 66);

    for (const [rect, label] of [[L.again, 'ЕЩЁ РАЗ'], [L.back, 'В ЗАЛ']]) {
      roundRect(c, rect.x, rect.y, rect.w, rect.h, 7);
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.2)';
      c.lineWidth = 1;
      c.stroke();
      c.font = `700 11px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
    }
    c.textAlign = 'left';
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
    c.font = `800 ${size}px ${FONT}`;
    const room = Math.min(w - 40, 460);
    const got = c.measureText(title).width;
    if (got > room) {
      size = Math.max(14, Math.floor(size * room / got));
      c.font = `800 ${size}px ${FONT}`;
    }
    const titleY = by - 22 - size / 2;
    c.fillStyle = '#fff';
    c.fillText(title, w / 2, titleY);

    // And what kind of moment this is, above it — measured off the title's own
    // size, because the first version put it at a fixed offset and the two
    // lines landed on top of each other.
    c.font = `700 10px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText(p.champion ? 'ЛЕСТНИЦА ПРОЙДЕНА' : 'НОВЫЙ ПОЯС', w / 2, titleY - size / 2 - 12);

    // Who it came off, and who is next. Two short lines under the band,
    // because a belt with nobody's name on it is a trophy for nothing.
    c.font = `600 12px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.72)';
    c.fillText(`выиграл у ${p.beatOf}`, w / 2, by + bh + 28);
    c.font = `600 11px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.fillText(p.champion ? 'дальше некого' : `дальше — ${p.nextMan}`, w / 2, by + bh + 48);
    c.globalAlpha = 1;

    // The way out, and it appears exactly when it starts working.
    if (p.t > 0.8) {
      c.font = `600 11px ${FONT}`;
      c.fillStyle = '#ffd166';
      c.globalAlpha = 0.5 + 0.5 * Math.sin(this.pulse * 3);
      c.fillText('КОСНИСЬ, ЧТОБЫ ПРОДОЛЖИТЬ', w / 2, h - 34);
      c.globalAlpha = 1;
    }
    c.textAlign = 'left';
  }

  _result(m) {
    const c = this.ctx;
    c.fillStyle = 'rgba(4,6,10,0.78)';
    c.fillRect(0, 0, this.w, this.h);
    c.textAlign = 'center';

    // The разбор. Read once, off the tape the match kept of itself, and held
    // for as long as the card is up — debrief() walks the whole tape and this
    // card is drawn sixty times a second.
    //
    // It is here rather than on a screen of its own because a card that says
    // only who won is a card nobody reads twice, and because the thing a
    // beaten player wants is not a tutorial, it is the answer to "what did I
    // do". Three lines, each one a fact about this match and a fix.
    if (this._dbTape !== m.tape) { this._dbTape = m.tape; this._db = m.debrief(); }
    const lines = (this._db && this._db.lines) || [];
    const extra = lines.length ? lines.length * 15 + 14 : 0;
    const base = this.h / 2 - extra / 2;
    const win = m.winner === null ? 'НИЧЬЯ' : `${m.f[m.winner].name.toUpperCase()}`;
    c.fillStyle = m.winner === 0 ? '#4fd48a' : m.winner === 1 ? '#ff6a55' : '#fff';
    c.font = `800 28px ${FONT}`;
    c.fillText(win, this.w / 2, base - 24);
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.font = `600 13px ${FONT}`;
    const by = { submission: 'победа сдачей', points: 'победа по очкам', advantages: 'победа по преимуществам', draw: '' };
    c.fillText(by[m.winBy] || '', this.w / 2, base + 2);
    c.font = `700 16px ${FONT}`;
    c.fillStyle = '#fff';
    c.fillText(`${m.f[0].points} — ${m.f[1].points}`, this.w / 2, base + 30);
    // What the win was worth. A result card that says only who won is a card
    // nobody reads twice; this one says which belt was in front of you and
    // which one is next, because that is the whole of the career mode.
    const r = this.result;
    if (r) {
      c.font = `600 11px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.66)';
      const line = r.champion && r.won ? `ты прошёл всю лестницу — ${r.beat} belt взят`
        : r.climbed ? `${r.beat} belt взят  ·  следующий: ${r.next}`
        : r.won ? `${r.beat} belt взят`
        : `${r.beat} belt — ещё раз`;
      c.fillText(line, this.w / 2, base + 48);
    }
    // Разбор: what this match was, in the game's own numbers.
    if (lines.length) {
      const ly = base + 76;
      c.strokeStyle = 'rgba(255,255,255,0.12)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(this.w / 2 - 90, ly - 12);
      c.lineTo(this.w / 2 + 90, ly - 12);
      c.stroke();
      c.font = `600 11px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < lines.length; i++) c.fillText(lines[i], this.w / 2, ly + i * 15);
    }
    c.font = `600 12px ${FONT}`;
    c.fillStyle = '#ffd166';
    c.globalAlpha = 0.55 + 0.45 * Math.sin(this.pulse * 3);
    c.fillText(r && !r.won ? 'КОСНИСЬ, ЧТОБЫ ПОПРОБОВАТЬ СНОВА' : 'КОСНИСЬ, ЧТОБЫ ВЫЙТИ НА СЛЕДУЮЩЕГО',
      this.w / 2, base + 70 + extra);
    c.globalAlpha = 1;
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
