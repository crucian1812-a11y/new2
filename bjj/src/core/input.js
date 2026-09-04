// Touch input, built around the control idea the UFC games settled on: one
// thumb carries your base, the other thumb throws and denies.
//
// Left half of the screen is a floating stick. Standing, it walks; on the
// ground it is weight and hip position, and it feeds directly into whether a
// transition lands. Right half is a flick pad: a swipe from anywhere on it is a
// direction, and a tap on empty space is a grip fight — your thumbs are already
// where they are going to be and they cannot see what is under them.
//
// A tap that lands **on** one of the ring's four buttons is that button, and
// that is not a convenience. The ring is drawn as four labelled circles with a
// price written on each; for the whole life of this game the only thing that
// pressed one was a swipe, so a player who tapped the button marked «+4» —
// which is what a person does with something that looks like a button — fought
// for a grip instead, in silence, and scored nothing all match. Every tool that
// has ever played this game swiped, so the battery could not see it. The hit
// test lives next to the drawing, in hud.ringDir, so the two cannot drift.
//
// A press-and-hold was described here as a defensive frame for a long time and
// never existed: `hold` and `drag` were computed every frame and read by
// nothing, all the way down to the pointer bookkeeping that fed them. A field
// in the hot path that nobody reads is a promise to whoever reads this file
// next, so they are gone. If a frame is wanted it is a mechanic to design and
// measure, not a flag to switch on.
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
    // Where the tap landed, so the game can ask the HUD whether it was on a
    // button. Null for a tap that came from the keyboard.
    this.tapAt = null;
    // A tap on the stick's half, kept apart from a flick-pad tap: the left
    // half is the stick while a thumb drags on it, but a quick press that never
    // travelled is a tap, and the menu on the title card lives on that side.
    this.tapLeft = false;

    this.keys = new Set();
    this.keyFlickBuffer = [];
    this.enabled = true;
    this.anyPress = false;
    // Where the last press began, so the game can tell a press on the
    // full-screen button from the same tap it starts a match with.
    this.pressAt = null;

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
    this.pressAt = { x: p.x, y: p.y };
    const leftHalf = p.x < this.canvas.clientWidth * 0.44;
    if (leftHalf && !this.stick.active) {
      this.stick.active = true;
      this.stick.id = e.pointerId;
      this.stick.ox = p.x;
      this.stick.oy = p.y;
      this.stick.x = this.stick.y = this.stick.mag = 0;
      this.pointers.set(e.pointerId, { role: 'stick', t0: performance.now(), x0: p.x, y0: p.y });
      return;
    }
    this.pointers.set(e.pointerId, {
      role: 'flick', x0: p.x, y0: p.y, x: p.x, y: p.y, t0: performance.now(), fired: false,
    });
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
      // A quick press on the stick's half that never travelled is a tap, not a
      // hold: the left half is the stick while a thumb is dragging, and a tap
      // is how the title card's menu is pressed. A pointer that was cancelled
      // (or a thumb that did travel) is still a stick, and stays silent.
      const p = this._pos(e);
      if (e.type === 'pointerup'
        && Math.hypot(p.x - rec.x0, p.y - rec.y0) < TAP_MAX
        && performance.now() - rec.t0 < TAP_TIME) {
        this.tap = true;
        this.tapLeft = true;
        this.tapAt = { x: p.x, y: p.y };
      }
      return;
    }
    if (!rec.fired) {
      const dt = performance.now() - rec.t0;
      const d = Math.hypot(rec.x - rec.x0, rec.y - rec.y0);
      if (d < TAP_MAX && dt < TAP_TIME) {
        this.tap = true;
        this.tapAt = { x: rec.x, y: rec.y };
      }
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
      this.tapAt = null;
      e.preventDefault();
    }
    this.anyPress = true;
  }

  // Called once a frame, after the game has read what it needs.
  endFrame() {
    this.flick = null;
    this.tap = false;
    this.tapAt = null;
    this.tapLeft = false;
    this.pressAt = null;
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
  }
}
