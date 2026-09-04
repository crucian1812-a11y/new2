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

// Framing is done with the lens, not the tripod.
//
// The obvious way to get closer is to move the camera in, and on the ground it
// does not work: the pair is a metre and a half wide and a camera at mat height
// two metres out is already inside somebody's legs. Pulling in to 2.05 put the
// near fighter through the near plane, which is how this was learned.
//
// So the tripod stays where it can see, and the shot is framed with a longer
// lens. A fifty degree field at two and a half metres covers two and a half
// metres of mat, and two people lying in it fill a quarter of the frame — the
// look of a security camera. Thirty-four degrees covers a metre and a half,
// which is the pair and a hand's breadth around them, and a long lens is what
// a broadcast camera at the edge of a mat actually has on it.
// How much room the pair gets inside the frame. 1.25 means the two of them,
// measured from the point the camera is aimed at, may take four fifths of the
// half-height — the rest is the margin a broadcast frame leaves round a tangle
// so that the hands are still in it.
const FRAME_MARGIN = 1.25;
// The widest the lens goes before the tripod has to move instead. Past about
// fifty degrees the mat curves and the two of them start to look far away.
const FOV_MAX = 50;
const DEG = Math.PI / 180;

const SHOTS = {
  // The title card: low, close and off the shoulder, the way a promo still is
  // framed. Nothing is happening yet, so the shot has to do the work.
  hero: { dist: 2.9, height: 1.06, aimY: 1.06, fov: 32 },
  stand: { dist: 4.1, height: 1.52, aimY: 1.06, fov: 36 },
  ground: { dist: 2.6, height: 1.0, aimY: 0.44, fov: 34 },
  sub: { dist: 2.35, height: 0.82, aimY: 0.38, fov: 30 },
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
    this._shot = null;
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

  // `spread` is how far the pair reaches from the point being aimed at, in
  // metres. Without it the camera frames by the shot alone and has no idea what
  // is in front of it: measured over forty-five minutes of match, the pair
  // filled 79% of the frame's height on average, stood taller than the picture
  // on one frame in six, and inside a submission — the moment the whole game is
  // about reading — it filled 113% and something was out of frame on *every*
  // frame. What fell out was hands, fingers and forearms, which is the technique
  // itself. A player put it plainly: "камера слишком близко подъезжает и не
  // понятно какой приём сейчас происходит".
  update(dt, focus, mode, intensity, spread = 0) {
    this.t += dt;
    const s = SHOTS[mode] || SHOTS.ground;

    // Drift. Slow, never quite periodic, and it stops during a held cut so the
    // cut reads as a different camera rather than the same one wandering.
    if (this.cutHold > 0) this.cutHold -= dt;
    else this.targetOrbit += dt * 0.07 * (Math.sin(this.t * 0.11) > 0 ? 1 : -1);
    this.orbit = lerp(this.orbit, this.targetOrbit, 1 - Math.pow(0.02, dt));

    // A change of shot is a cut, not a dolly.
    //
    // Easing between them looked like the camera operator running: the title
    // card's close portrait unwound into the standing wide over about two
    // seconds, and going to the mat did the same in reverse. A broadcast
    // director cuts between cameras, and the shots here are cameras. Only the
    // small adjustments — pushing in as the effort rises — are eased.
    let wantDist = s.dist - intensity * 0.18;
    let wantFov = s.fov - intensity * 2.5;
    // Framed on what is actually there. The shot says how close and how long the
    // lens is; this only ever opens it, never tightens it, so the look of each
    // shot is the look it was written with and the camera simply refuses to cut
    // the fight in half.
    if (spread > 0.01) {
      const need = 2 * Math.atan((spread * FRAME_MARGIN) / Math.max(0.6, this.dist)) / DEG;
      wantFov = Math.max(wantFov, Math.min(FOV_MAX, need));
      // And when even the widest lens cannot hold them, the tripod goes back.
      wantDist = Math.max(wantDist, (spread * FRAME_MARGIN) / Math.tan((FOV_MAX / 2) * DEG));
    }
    if (this._shot !== mode) {
      this._shot = mode;
      this.dist = wantDist;
      this.height = s.height;
      this.aimY = s.aimY;
      this.fovDeg = wantFov;
    } else {
      const k = 1 - Math.pow(0.004, dt);
      this.dist = lerp(this.dist, wantDist, k);
      this.height = lerp(this.height, s.height, k);
      this.aimY = lerp(this.aimY, s.aimY, k);
      this.fovDeg = lerp(this.fovDeg, wantFov, k);
    }

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
