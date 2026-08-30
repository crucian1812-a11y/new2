// Touch input, built around the control idea the UFC games settled on: one
// thumb carries your base, the other thumb throws and denies.
//
// Left half of the screen is a floating stick. Standing, it walks; on the
// ground it is weight and hip position, and it feeds directly into whether a
// transition lands. Right half is a flick pad: a swipe is a direction, a tap
// is a grip fight, a press-and-hold is a defensive frame. Nothing is a button
// you have to find, because on a phone in landscape your thumbs are already
// where they are going to be and they cannot see what is under them.
//
// The flick fires the moment the swipe passes its threshold rather than on
// release. Waiting for the finger to lift costs about 120 ms, and in a game
// whose whole defence is a 400 ms denial window that is most of the window.

const FLICK_MIN = 26; // CSS px before a drag counts as a direction
const TAP_MAX = 18; // CSS px of slop still counted as a tap
const TAP_TIME = 260; // ms

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.pointers = new Map();
    this.stick = { active: false, x: 0, y: 0, mag: 0, ox: 0, oy: 0, id: -1 };
    this.stickRadius = 58;

    this.flick = null; // consumed by the game each frame
    this.tap = false;
    this.hold = false;
    this.drag = null; // { x, y, dx, dy } while a right-hand drag is live
    this.dragId = -1;

    this.keys = new Set();
    this.keyFlickBuffer = [];
    this.enabled = true;
    this.anyPress = false;

    const o = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this._down(e), o);
    canvas.addEventListener('pointermove', (e) => this._move(e), o);
    canvas.addEventListener('pointerup', (e) => this._up(e), o);
    canvas.addEventListener('pointercancel', (e) => this._up(e), o);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.reset());
  }

  reset() {
    this.pointers.clear();
    this.keys.clear();
    this.stick.active = false;
    this.stick.mag = 0;
    this.stick.x = this.stick.y = 0;
    this.hold = false;
    this.drag = null;
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    // Guarded: a synthetic PointerEvent — which is what tools/thumb.mjs sends
    // through this class — has no active pointer behind it, and asking to
    // capture one throws NotFoundError out of the middle of the handler.
    try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* not a real finger */ }
    const p = this._pos(e);
    this.anyPress = true;
    const leftHalf = p.x < this.canvas.clientWidth * 0.44;
    if (leftHalf && !this.stick.active) {
      this.stick.active = true;
      this.stick.id = e.pointerId;
      this.stick.ox = p.x;
      this.stick.oy = p.y;
      this.stick.x = this.stick.y = this.stick.mag = 0;
      this.pointers.set(e.pointerId, { role: 'stick' });
      return;
    }
    this.pointers.set(e.pointerId, {
      role: 'flick', x0: p.x, y0: p.y, x: p.x, y: p.y, t0: performance.now(), fired: false,
    });
    this.dragId = e.pointerId;
    this.drag = { x: p.x, y: p.y, dx: 0, dy: 0, sx: p.x, sy: p.y };
  }

  _move(e) {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    e.preventDefault();
    const p = this._pos(e);
    if (rec.role === 'stick') {
      let dx = p.x - this.stick.ox;
      let dy = p.y - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > this.stickRadius) {
        // Drag the origin along instead of clamping. A clamped stick loses the
        // fighter's heading the moment a thumb travels, which on a phone it
        // always does.
        this.stick.ox += (dx / d) * (d - this.stickRadius);
        this.stick.oy += (dy / d) * (d - this.stickRadius);
        dx = p.x - this.stick.ox;
        dy = p.y - this.stick.oy;
      }
      this.stick.x = dx / this.stickRadius;
      this.stick.y = dy / this.stickRadius;
      this.stick.mag = Math.min(1, Math.hypot(this.stick.x, this.stick.y));
      return;
    }
    rec.x = p.x;
    rec.y = p.y;
    if (this.drag && this.dragId === e.pointerId) {
      this.drag.x = p.x;
      this.drag.y = p.y;
      this.drag.dx = p.x - this.drag.sx;
      this.drag.dy = p.y - this.drag.sy;
    }
    if (rec.fired) return;
    const dx = p.x - rec.x0;
    const dy = p.y - rec.y0;
    if (Math.hypot(dx, dy) >= FLICK_MIN) {
      rec.fired = true;
      this.flick = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down' : 'up');
    }
  }

  _up(e) {
    const rec = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!rec) return;
    if (rec.role === 'stick') {
      this.stick.active = false;
      this.stick.x = this.stick.y = this.stick.mag = 0;
      return;
    }
    if (this.dragId === e.pointerId) {
      this.dragId = -1;
      this.drag = null;
    }
    if (!rec.fired) {
      const dt = performance.now() - rec.t0;
      const d = Math.hypot(rec.x - rec.x0, rec.y - rec.y0);
      if (d < TAP_MAX && dt < TAP_TIME) this.tap = true;
    }
  }

  _key(e, down) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (!down) return;
    const map = {
      arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
      i: 'up', k: 'down', j: 'left', l: 'right',
    };
    if (map[k]) {
      this.flick = map[k];
      e.preventDefault();
    }
    if (k === ' ') {
      this.tap = true;
      e.preventDefault();
    }
    this.anyPress = true;
  }

  // Called once a frame, after the game has read what it needs.
  endFrame() {
    this.flick = null;
    this.tap = false;
    let kx = 0, ky = 0;
    if (this.keys.has('a')) kx -= 1;
    if (this.keys.has('d')) kx += 1;
    if (this.keys.has('w')) ky -= 1;
    if (this.keys.has('s')) ky += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      this.stick.x = kx / l;
      this.stick.y = ky / l;
      this.stick.mag = 1;
    } else if (!this.stick.active) {
      this.stick.x = this.stick.y = this.stick.mag = 0;
    }
    this.hold = this.keys.has('shift') || [...this.pointers.values()].some(
      (r) => r.role === 'flick' && !r.fired && performance.now() - r.t0 > TAP_TIME
    );
  }
}
