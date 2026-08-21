// Touch-first input. A floating stick on the left half of the screen, round
// buttons on the right that the HUD registers each frame, and a full keyboard
// and mouse fallback so the game is playable on a desktop too.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.buttons = new Map(); // id -> {x, y, r} in CSS pixels
    this.down = new Set();
    this.justDown = new Set();
    this.justUp = new Set();
    this.pointers = new Map(); // pointerId -> {role, buttonId, x, y}
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, mag: 0 };
    this.move = { x: 0, y: 0, mag: 0 };
    this.tap = null; // {x, y} in CSS pixels, consumed by the game
    this.pointerCss = { x: 0, y: 0 };
    this.keys = new Set();
    this.enabled = true;
    this.stickRadius = 62;
    this.leftZone = 0.5;

    const opts = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    canvas.addEventListener('pointermove', (e) => this.onMove(e), opts);
    canvas.addEventListener('pointerup', (e) => this.onUp(e), opts);
    canvas.addEventListener('pointercancel', (e) => this.onUp(e), opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.down.clear();
      this.pointers.clear();
      this.stick.active = false;
    });
  }

  setButtons(list) {
    this.buttons.clear();
    for (const b of list) this.buttons.set(b.id, b);
  }

  hitButton(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const [id, b] of this.buttons) {
      if (b.disabled) continue;
      if (b.box) {
        // Rectangular controls test their real bounds; a bounding circle would
        // swallow taps meant for the button next to them.
        const p = 4;
        if (x < b.box.x - p || x > b.box.x + b.box.w + p) continue;
        if (y < b.box.y - p || y > b.box.y + b.box.h + p) continue;
        const d = Math.hypot(x - b.x, y - b.y);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
        continue;
      }
      const d = Math.hypot(x - b.x, y - b.y);
      const r = b.r * (b.pad || 1.18);
      if (d < r && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  press(id) {
    if (!this.down.has(id)) this.justDown.add(id);
    this.down.add(id);
  }

  release(id) {
    if (this.down.has(id)) this.justUp.add(id);
    this.down.delete(id);
  }

  onDown(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    const x = e.clientX;
    const y = e.clientY;
    this.pointerCss.x = x;
    this.pointerCss.y = y;
    const hit = this.hitButton(x, y);
    if (hit) {
      this.pointers.set(e.pointerId, { role: 'button', buttonId: hit, x, y });
      this.press(hit);
      return;
    }
    if (x < window.innerWidth * this.leftZone && !this.stick.active) {
      this.stick.active = true;
      this.stick.id = e.pointerId;
      this.stick.ox = x;
      this.stick.oy = y;
      this.stick.x = 0;
      this.stick.y = 0;
      this.stick.mag = 0;
      this.pointers.set(e.pointerId, { role: 'stick', x, y });
      return;
    }
    this.pointers.set(e.pointerId, { role: 'tap', x, y, t: performance.now() });
    this.tap = { x, y };
    this.press('worldTap');
  }

  onMove(e) {
    if (!this.enabled) return;
    const p = this.pointers.get(e.pointerId);
    this.pointerCss.x = e.clientX;
    this.pointerCss.y = e.clientY;
    if (!p) return;
    e.preventDefault();
    p.x = e.clientX;
    p.y = e.clientY;
    if (p.role === 'stick') {
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const d = Math.hypot(dx, dy);
      const R = this.stickRadius;
      if (d > R) {
        // Drag the origin along so the stick never feels stuck at the edge.
        this.stick.ox += (dx / d) * (d - R);
        this.stick.oy += (dy / d) * (d - R);
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      this.stick.x = dx / R;
      this.stick.y = dy / R;
      this.stick.mag = Math.min(1, d / R);
    } else if (p.role === 'tap') {
      this.tap = { x: e.clientX, y: e.clientY };
    }
  }

  onUp(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (p.role === 'button') this.release(p.buttonId);
    if (p.role === 'stick') {
      this.stick.active = false;
      this.stick.x = this.stick.y = this.stick.mag = 0;
    }
    if (p.role === 'tap') this.release('worldTap');
    this.pointers.delete(e.pointerId);
  }

  onKey(e, isDown) {
    const k = e.key.toLowerCase();
    if (isDown) this.keys.add(k);
    else this.keys.delete(k);
    const map = {
      '1': 'skill1',
      '2': 'skill2',
      '3': 'skill3',
      '4': 'skill4',
      q: 'potion',
      ' ': 'dash',
      e: 'interact',
      i: 'inventory',
      c: 'character',
      escape: 'menu',
    };
    const act = map[k];
    if (act) {
      if (isDown) this.press(act);
      else this.release(act);
      e.preventDefault();
    }
    if (k === 'f' || k === 'j') {
      if (isDown) this.press('attack');
      else this.release('attack');
    }
  }

  /** Called once per frame, after the game has read the state. */
  update() {
    // Keyboard movement folds into the same vector as the stick.
    let kx = 0;
    let ky = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) kx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) kx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) ky -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) ky += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      this.move.x = kx / l;
      this.move.y = ky / l;
      this.move.mag = 1;
    } else if (this.stick.active && this.stick.mag > 0.08) {
      const l = Math.hypot(this.stick.x, this.stick.y) || 1;
      this.move.x = this.stick.x / l;
      this.move.y = this.stick.y / l;
      this.move.mag = this.stick.mag;
    } else {
      this.move.x = this.move.y = this.move.mag = 0;
    }
  }

  endFrame() {
    this.justDown.clear();
    this.justUp.clear();
    this.tap = null;
  }

  isDown(id) {
    return this.down.has(id);
  }
  wasPressed(id) {
    return this.justDown.has(id);
  }
  wasReleased(id) {
    return this.justUp.has(id);
  }
}
