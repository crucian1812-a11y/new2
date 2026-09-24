// Stepping in a stance.
//
// gait.js is a walk: a cycle driven by distance, heel down, roll off the ball,
// hips turning with it, and every step landing ahead of the man in the
// direction he faces. That is right for the walk onto the mat and wrong for
// everything that happens once the fight has started, because nobody in it is
// walking forwards. The two fighters drift and circle in their stance, facing
// each other; the referee keeps his distance facing the fight, so his travel
// is mostly sideways. A forward walk run sideways lands each step "ahead" —
// which, sideways, is the far side of the other foot — and the pair rig's own
// planner left a foot where it was until the body had dragged it thirty
// centimetres and then flung it past the body's travel. Measured
// (tools/stance-check.mjs): feet crossed by up to 29 cm, splayed 40 cm wider
// than the stance, a foot in the air at 6.7 m/s, and a man who stopped stayed
// crossed.
//
// A stance is kept rather than walked. Each foot has a home — where the pose
// puts it this frame — and the stepper's only job is to keep the planted foot
// near it:
//
//   when      a foot goes when it has fallen more than a few centimetres
//             behind where its home is heading, the one furthest behind
//             first; when everything has stopped, whatever is still off its
//             home by more than a couple of centimetres is stepped back to it,
//             so a man who stops is standing in his stance and not in a lunge
//   where     to its home, led by how fast that home is moving, and never
//             across the other foot: along the line through the hips a left
//             foot stays to the left of the right one by at least GAP
//   how       one foot at a time, low and quick, in a time that grows with
//             the distance — a shuffle, not a stride
//   turning   a planted foot keeps the heading it was put down with; the body
//             turning over it is a reason to step, like being left behind is
//
// The heading and everything about the pose's foot other than where it stands
// are the caller's; this returns where each sole is on the mat, how high it is
// lifted and which way it points.

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export const SHUFFLE = {
  TRIG: 0.085,     // m behind its target before a foot goes, while moving
  SETTLE: 0.025,   // and once everything has stopped
  STILL: 0.25,     // s of stillness before settling
  LOOK: 0.10,      // s of the home's travel a step lands ahead of it by
  GAP: 0.10,       // m the feet keep between them across the hips
  TURN: 0.45,      // rad a planted foot may be turned under the body before it steps
  T_MIN: 0.17,     // s in the air, a short step
  T_PER: 0.55,     // and how much longer per metre
  T_MAX: 0.30,
  LIFT: 0.055,     // m at the top of a full step
};

export class Shuffle {
  constructor(cfg = SHUFFLE) {
    this.cfg = cfg;
    this.feet = [0, 1].map(() => ({
      g: [0, 0], yaw: 0, air: false, u: 0, T: 0.2,
      from: [0, 0], fromYaw: 0, to: [0, 0], lift: 0,
      home: [0, 0], homeYaw: 0, hv: [0, 0], set: false,
    }));
    this.still = 0;
    this.landed = false;
  }

  // Forget where the feet were: the next update plants them on their homes.
  reset() { for (const f of this.feet) f.set = false; }

  // Take over feet that are already standing somewhere — from a walk, say —
  // rather than snapping them to where the pose would have them.
  plant(i, x, z, yaw) {
    const f = this.feet[i];
    f.g[0] = x; f.g[1] = z; f.yaw = yaw;
    f.home[0] = x; f.home[1] = z; f.homeYaw = yaw;
    f.hv[0] = f.hv[1] = 0; f.air = false; f.lift = 0; f.set = true;
  }

  // `homes` is [[x, z, heading], [x, z, heading]] for the left and the right
  // foot, where the pose puts each this frame; `left` is the unit vector of the
  // hips' own left on the mat.
  update(dt, homes, left) {
    const c = this.cfg;
    this.landed = false;
    const k = dt > 0 ? Math.min(1, dt * 12) : 1;
    let moving = false;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], h = homes[i];
      if (!f.set) {
        f.g[0] = h[0]; f.g[1] = h[1]; f.yaw = h[2];
        f.home[0] = h[0]; f.home[1] = h[1]; f.homeYaw = h[2];
        f.hv[0] = f.hv[1] = 0; f.air = false; f.set = true;
      }
      // How fast the home is going, smoothed: it is what a step leads by, and
      // read off one frame it is as noisy as the pose.
      if (dt > 0) {
        f.hv[0] += ((h[0] - f.home[0]) / dt - f.hv[0]) * k;
        f.hv[1] += ((h[1] - f.home[1]) / dt - f.hv[1]) * k;
      }
      f.home[0] = h[0]; f.home[1] = h[1]; f.homeYaw = h[2];
      if (Math.hypot(f.hv[0], f.hv[1]) > 0.05) moving = true;
    }
    this.still = moving ? 0 : this.still + dt;

    // Which side of the other each foot belongs on, read off the homes.
    const side = Math.sign((homes[0][0] - homes[1][0]) * left[0] + (homes[0][1] - homes[1][1]) * left[1]) || 1;
    // Where the home will be when the foot comes down, `ahead` seconds from
    // now, plus a little: a step lands under the body and slightly ahead of
    // it, and a foot in the air aims at where its home is going to be rather
    // than chasing where it is — chased, a stance widening under a referee
    // going down into his crouch had a foot flying at 4 m/s.
    const target = (out, i, ahead) => {
      const f = this.feet[i], o = this.feet[1 - i];
      out[0] = f.home[0] + f.hv[0] * (ahead + c.LOOK);
      out[1] = f.home[1] + f.hv[1] * (ahead + c.LOOK);
      // Not across the other foot, wherever that one is standing.
      const s = i === 0 ? side : -side;
      const across = ((out[0] - o.g[0]) * left[0] + (out[1] - o.g[1]) * left[1]) * s;
      if (across < c.GAP) {
        out[0] += left[0] * s * (c.GAP - across);
        out[1] += left[1] * s * (c.GAP - across);
      }
      return out;
    };

    const air = this.feet.findIndex((f) => f.air);
    if (air >= 0) {
      const f = this.feet[air];
      f.u = Math.min(1, f.u + dt / f.T);
      // Re-aimed as it goes, so a step still lands under a body that changed
      // its mind, but only as fast as the foot could plausibly follow.
      target(f.to, air, (1 - f.u) * f.T);
      const s = smooth(f.u);
      f.g[0] = f.from[0] + (f.to[0] - f.from[0]) * s;
      f.g[1] = f.from[1] + (f.to[1] - f.from[1]) * s;
      f.yaw = f.fromYaw + wrap(f.homeYaw - f.fromYaw) * s;
      const d = Math.hypot(f.to[0] - f.from[0], f.to[1] - f.from[1]);
      f.lift = Math.min(c.LIFT, 0.012 + d * 0.22) * Math.sin(Math.PI * f.u);
      if (f.u >= 1) { f.air = false; f.lift = 0; this.landed = true; }
    } else {
      const t = [0, 0];
      let pick = -1, worst = 0;
      const limit = moving ? c.TRIG : this.still > c.STILL ? c.SETTLE : Infinity;
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        target(t, i, 0);
        const e = Math.hypot(t[0] - f.g[0], t[1] - f.g[1]);
        const turned = Math.abs(wrap(f.homeYaw - f.yaw));
        const score = Math.max(e / limit, turned / c.TURN);
        if (score > 1 && score > worst) { worst = score; pick = i; }
      }
      if (pick >= 0) {
        const f = this.feet[pick];
        // The time in the air from how far it has to go, which itself depends
        // on the time in the air: twice round settles it.
        f.T = c.T_MIN;
        for (let k = 0; k < 2; k++) {
          target(f.to, pick, f.T);
          const d = Math.hypot(f.to[0] - f.g[0], f.to[1] - f.g[1]);
          f.T = Math.min(c.T_MAX, c.T_MIN + c.T_PER * d);
        }
        target(f.to, pick, f.T);
        f.from[0] = f.g[0]; f.from[1] = f.g[1]; f.fromYaw = f.yaw;
        f.u = 0;
        f.air = true;
      }
    }
  }
}
