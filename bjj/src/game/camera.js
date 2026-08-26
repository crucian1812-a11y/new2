// The broadcast camera.
//
// Not a chase camera. Grappling has no forward direction to chase — the two of
// them barely move across the mat — so the interesting variable is the angle
// you see the tangle from, and that changes with the position, not with the
// player's input.
//
// Standing, it sits high and wide, the way a hall camera does. On the ground it
// drops to mat level and comes in, because from up there a guard pass is two
// white shapes and from down here it is a person being taken apart. Big moments
// get a cut: a new angle, chosen on the far side of the action, held for a
// couple of seconds and then eased back to the working shot.

import { v3, v3set, v3lerp, lerp } from '../core/m4.js';

const SHOTS = {
  // The title card: low, close and off the shoulder, the way a promo still is
  // framed. Nothing is happening yet, so the shot has to do the work.
  hero: { dist: 2.75, height: 1.05, aimY: 0.98, fov: 38 },
  stand: { dist: 4.6, height: 1.85, aimY: 1.05, fov: 52 },
  ground: { dist: 2.45, height: 0.82, aimY: 0.40, fov: 55 },
  sub: { dist: 1.85, height: 0.56, aimY: 0.34, fov: 46 },
};

export class Camera {
  constructor() {
    this.eye = v3(0, 2, 5);
    this.at = v3(0, 1, 0);
    this.fov = (52 * Math.PI) / 180;
    this.orbit = 0.7;
    this.targetOrbit = 0.7;
    this.dist = 4.6;
    this.height = 1.85;
    this.aimY = 1.0;
    this.fovDeg = 52;
    this.shake = 0;
    this.cutHold = 0;
    this.t = 0;
    this._focus = v3(0, 0, 0);
  }

  // A cut: jump to a new orbit angle on the other side of the action and hold
  // it. `side` biases which way, so a sweep to the left is seen from the left.
  cut(side = 0) {
    const away = this.targetOrbit + Math.PI * (0.55 + Math.random() * 0.5) * (side >= 0 ? 1 : -1);
    this.targetOrbit = away;
    this.orbit = away;
    this.cutHold = 2.2;
  }

  impulse(a) {
    this.shake = Math.min(1, this.shake + a);
  }

  update(dt, focus, mode, intensity) {
    this.t += dt;
    const s = SHOTS[mode] || SHOTS.ground;

    // Drift. Slow, never quite periodic, and it stops during a held cut so the
    // cut reads as a different camera rather than the same one wandering.
    if (this.cutHold > 0) this.cutHold -= dt;
    else this.targetOrbit += dt * 0.07 * (Math.sin(this.t * 0.11) > 0 ? 1 : -1);
    this.orbit = lerp(this.orbit, this.targetOrbit, 1 - Math.pow(0.02, dt));

    const k = 1 - Math.pow(0.004, dt);
    this.dist = lerp(this.dist, s.dist - intensity * 0.35, k);
    this.height = lerp(this.height, s.height, k);
    this.aimY = lerp(this.aimY, s.aimY, k);
    this.fovDeg = lerp(this.fovDeg, s.fov, k);

    v3lerp(this._focus, this._focus, focus, 1 - Math.pow(0.001, dt));

    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake;
    // Handheld: two incommensurate frequencies, so it never loops visibly.
    const hx = Math.sin(this.t * 1.7) * 0.012 + Math.sin(this.t * 4.3) * 0.005;
    const hy = Math.cos(this.t * 1.3) * 0.010 + Math.sin(this.t * 3.1) * 0.004;

    const a = this.orbit;
    v3set(
      this.eye,
      this._focus[0] + Math.sin(a) * this.dist + hx + (Math.random() - 0.5) * sh * 0.16,
      this.height + hy + (Math.random() - 0.5) * sh * 0.12,
      this._focus[2] + Math.cos(a) * this.dist + hx * 0.5
    );
    v3set(this.at, this._focus[0] + hx * 0.4, this.aimY + hy * 0.4, this._focus[2]);
    this.fov = (this.fovDeg * Math.PI) / 180;
  }
}
