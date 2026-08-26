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

    this._scorebug(match);
    this._positionBar(match);
    if (match.state === 'live' || match.state === 'sub') {
      this._ring(match, input);
      this._stick(input);
    }
    if (match.deny && match.attempt) this._denyPrompt(match);
    if (match.state === 'sub') this._sub(match);
    this._events(match, dt);
    if (match.state === 'ready') this._title(opts);
    if (match.state === 'over') this._result(match);
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
  _ring(m, input) {
    const c = this.ctx;
    const opts = m.options(0);
    // The ring scales with the screen and is pinned far enough off the bottom
    // that the lowest label still lands on glass. On a short landscape phone
    // that margin is the whole difference between readable and cropped.
    const R = clampN(Math.min(this.w, this.h) * 0.17, 44, 66);
    const cx = this.w - (R + 52);
    const cy = this.h - (R + 46);

    c.save();
    c.globalAlpha = m.attempt ? 0.35 : 1;
    for (const dir of ['up', 'down', 'left', 'right']) {
      const tr = opts[dir];
      const [dx, dy] = DIR_VEC[dir];
      const x = cx + dx * R;
      const y = cy + dy * R;
      const on = !!tr;

      const rr = R * 0.3;
      c.beginPath();
      c.arc(x, y, rr, 0, Math.PI * 2);
      c.fillStyle = on ? 'rgba(10,14,20,0.72)' : 'rgba(10,14,20,0.3)';
      c.fill();
      c.strokeStyle = on
        ? tr.sub ? 'rgba(255,110,90,0.9)' : tr.big ? 'rgba(255,209,102,0.85)' : 'rgba(255,255,255,0.5)'
        : 'rgba(255,255,255,0.12)';
      c.lineWidth = on ? 2 : 1;
      c.stroke();

      arrow(c, x, y, dx, dy, on ? '#fff' : 'rgba(255,255,255,0.2)', R * 0.15);

      if (on) {
        c.font = `600 9px ${FONT}`;
        c.fillStyle = 'rgba(255,255,255,0.82)';
        c.textAlign = 'center';
        const ly = dy > 0 ? y + rr + 12 : y - rr - 8;
        wrapText(c, tr.name, x, ly, 100, 10);
      }
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
      const by = 96;
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
      c.fillText(a.tr.name.toUpperCase(), cx, by + 12);
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
  _denyPrompt(m) {
    const c = this.ctx;
    const d = m.deny;
    if (d.by !== 0) return;
    const left = 1 - d.t / d.window;
    const cx = this.w / 2;
    const cy = this.h / 2 + 10;
    const [dx, dy] = DIR_VEC[d.dir];
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
    arrow(c, 0, 0, dx, dy, '#fff', 16);
    c.restore();

    c.globalAlpha = 1;
    c.textAlign = 'center';
    c.font = `700 11px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillText('ЗАЩИТА — СВАЙП', cx, cy + 62);
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
      // Defender: a direction to escape, changing before it can be spammed.
      const [dx, dy] = DIR_VEC[s.escapeDir];
      c.beginPath();
      c.arc(cx, cy, 40, 0, Math.PI * 2);
      c.fillStyle = 'rgba(8,10,16,0.7)';
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.2)';
      c.lineWidth = 3;
      c.stroke();
      arrow(c, cx, cy, dx, dy, '#fff', 15);
      c.font = `700 10px ${FONT}`;
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.fillText('СВАЙП, ЧТОБЫ ВЫЙТИ', cx, cy + 58);
    }
  }

  /* -------------------------------------------------------------- chrome */

  _events(m, dt) {
    const c = this.ctx;
    c.textAlign = 'left';
    let y = this.h - 24;
    for (const e of m.events) {
      e.t += dt;
      const a = Math.max(0, 1 - Math.max(0, e.t - 2.6) / 1.2);
      if (a <= 0) continue;
      c.globalAlpha = a;
      c.font = `600 11px ${FONT}`;
      c.fillStyle = COLORS[e.kind] || 'rgba(255,255,255,0.75)';
      c.fillText(e.text, 16, y);
      y -= 16;
    }
    c.globalAlpha = 1;
  }

  _title(opts) {
    const c = this.ctx;
    c.fillStyle = 'rgba(4,6,10,0.72)';
    c.fillRect(0, 0, this.w, this.h);
    c.textAlign = 'center';
    c.fillStyle = '#fff';
    c.font = `800 30px ${FONT}`;
    c.fillText('JIU-JITSU', this.w / 2, this.h / 2 - 34);
    c.font = `600 12px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillText('позиционная борьба · 5 минут · IBJJF', this.w / 2, this.h / 2 - 10);
    c.font = `600 12px ${FONT}`;
    c.fillStyle = '#ffd166';
    const p = 0.55 + 0.45 * Math.sin(this.pulse * 3);
    c.globalAlpha = p;
    c.fillText('КОСНИСЬ ЭКРАНА', this.w / 2, this.h / 2 + 26);
    c.globalAlpha = 1;
    c.font = `500 10px ${FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.fillText(
      'левый палец — база и перемещение · правый — свайп для перехода, тап для захвата',
      this.w / 2, this.h / 2 + 54
    );
    if (opts.level) {
      c.fillText(`соперник: ${opts.level} belt`, this.w / 2, this.h / 2 + 70);
    }
  }

  _result(m) {
    const c = this.ctx;
    c.fillStyle = 'rgba(4,6,10,0.78)';
    c.fillRect(0, 0, this.w, this.h);
    c.textAlign = 'center';
    const win = m.winner === null ? 'НИЧЬЯ' : `${m.f[m.winner].name.toUpperCase()}`;
    c.fillStyle = m.winner === 0 ? '#4fd48a' : m.winner === 1 ? '#ff6a55' : '#fff';
    c.font = `800 28px ${FONT}`;
    c.fillText(win, this.w / 2, this.h / 2 - 24);
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.font = `600 13px ${FONT}`;
    const by = { submission: 'победа сдачей', points: 'победа по очкам', advantages: 'победа по преимуществам', draw: '' };
    c.fillText(by[m.winBy] || '', this.w / 2, this.h / 2 + 2);
    c.font = `700 16px ${FONT}`;
    c.fillStyle = '#fff';
    c.fillText(`${m.f[0].points} — ${m.f[1].points}`, this.w / 2, this.h / 2 + 30);
    c.font = `600 12px ${FONT}`;
    c.fillStyle = '#ffd166';
    c.globalAlpha = 0.55 + 0.45 * Math.sin(this.pulse * 3);
    c.fillText('КОСНИСЬ, ЧТОБЫ НАЧАТЬ ЗАНОВО', this.w / 2, this.h / 2 + 62);
    c.globalAlpha = 1;
  }
}

const COLORS = {
  points: '#ffd166', big: '#ffd166', sub: '#ff6a55', win: '#fff',
  deny: '#7fa6ff', adv: '#c9a227', warn: 'rgba(255,255,255,0.45)',
  fail: 'rgba(255,255,255,0.45)', escape: '#4fd48a',
};

const tau = (p) => -Math.PI / 2 + Math.PI * 2 * p;
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);

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
