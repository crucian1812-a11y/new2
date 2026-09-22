// The title card, as pictures instead of a man standing there.
//
// What was here before was a rendered fighter breathing in front of the menu,
// and the argument for him was that everything else on that screen moves, so he
// must not be a photograph. That was the right fix for the wrong thing: the
// problem with the first screen of this game was never that the man was still —
// it was that one man standing in an empty hall says nothing about jiu-jitsu. A player asked for pictures about the sport instead, and he is
// right: a title card is a poster, and a poster of a fight is a position, not a
// portrait.
//
// So the screen is a gallery. Six plates, each one a real position out of the
// game's own library — closed guard, the armbar, the triangle, the back, mount,
// kimura — held perfectly still, framed like a print and captioned with the
// position's own name. Every few seconds the page turns.
//
// Three things make this cheap and honest.
//
// It ships no artwork. The same rule the club marks are drawn under (see
// marks.js): there are no image files in this game, because the whole download
// is under a megabyte and one readable photograph is not. A plate is a pose id,
// three camera angles and a caption — about forty bytes of intent — and the
// picture is made by the renderer that is already there.
//
// It invents no poses. The pair is posed by `PairRig` from `POSES`, exactly the
// way tools/pose-check.mjs poses it and exactly the way the match plays it. A
// title card that drew its own guard would be a second definition of a guard,
// and this project has paid for that mistake before. What pose-relax solves and
// pose-check judges is what the poster shows.
//
// And it does not animate. The plate is posed once, the rig's clock is never
// stepped, and no breath, no spring and no camera drift touches it — a picture
// that trembles is a photograph with a bug in it. What moves on this screen is
// the page: one plate dissolves out, the next dissolves in. `poster-check`
// measures both halves of that sentence — the frame is dead still, and the
// screen never holds one picture longer than it should.

import { PairRig } from './rig.js';
import { POSES } from './poses.js';
import { v3 } from '../core/m4.js';

// The plates.
//
// Each one is a position, an angle to look at it from and a lens. What is *not*
// here is where the camera stands: a distance authored by hand is a distance
// that cuts a foot off the moment a pose is re-solved, and poses in this project
// move under their tools all the time. The tripod is computed from the pair's
// own size every time a plate is shown (see `frame`), so a plate cannot go
// stale — the same rule the match camera runs on, which exists because the
// alternative was hands falling out of frame.
//
//   orbit  which side it is seen from, in degrees; 0 looks down +z
//   elev   how high the camera is, in degrees above the pair's middle
//   fov    the lens, in degrees. Long is a poster, wide is a security camera
//
// The six are chosen to be six different pictures rather than six positions: a
// pair of legs wrapped round a waist, a man bent over a straightened arm, a
// triangle of legs round a head, a back take, a mount seen from the mat, a
// shoulder lock from above. Somebody who has never trained should be able to
// tell them apart at a glance on a phone, which is the whole job of this screen.
//
// The angles are solved rather than chosen — `tools/plate-solve.mjs` walks the
// circle round each pair, photographs it at every bearing and judges the frames
// on the same numbers poster-check does. What is written here is what came back
// from that, scores and all, with one rule on top of the score: no two plates
// may be taken from within forty degrees of the same bearing. A gallery shot
// from one side of the mat is one picture six times, and nothing a single plate
// is measured on could ever say so. The rule costs a tenth of a point and moves
// two of the six.
export const PLATES = [
  { pose: 'CLOSED_GUARD', orbit: 140, elev: 16, fov: 31 },   // 3.20
  { pose: 'ARMBAR', orbit: 40, elev: 7, fov: 33 },           // 3.00
  { pose: 'TRIANGLE', orbit: 85, elev: 38, fov: 32 },        // 3.43
  { pose: 'BACK', orbit: 235, elev: 30, fov: 32 },           // 3.33
  { pose: 'MOUNT', orbit: 280, elev: 38, fov: 31 },          // 3.12
  { pose: 'KIMURA', orbit: 0, elev: 26, fov: 33 },           // 3.08
];

// How long a picture is up, and how long the page takes to turn. A plate has to
// be up long enough to be read — a position is a puzzle and the caption is
// underneath it — and the turn has to be short enough that the screen is never
// mostly blank. Six seconds and half of one, which puts a blank page in front of
// somebody for 8% of the time they are choosing a belt.
export const HOLD = 6.0;
export const TURN_OUT = 0.34;
export const TURN_IN = 0.46;
export const CYCLE = HOLD + TURN_OUT + TURN_IN;

// The window a picture is composed into.
//
// Not the frame: the frame has a menu down the left of it. The title card is a
// column of belts, match lengths and a start button in its left third (see
// hud.menuLayout), a brand across the top and a caption along the bottom, and a
// guard pass behind any of those is neither a picture nor a menu. So a plate is
// framed into what is left — a window in normalised device coordinates, x and y
// from -1 to 1 — and the camera is built to put the pair in *that* rather than
// in the middle of the glass.
//
// The number that matters is how much of the window the pair fills: 1 is a
// crop, and the match camera's own framing rule leaves a fifth of the picture as
// air round a tangle. A poster is tighter than a broadcast frame, because
// nothing is about to move out of it.
const WINDOW = { x0: -0.14, x1: 0.99, y0: -0.80, y1: 0.86 };
const FILL = 0.88;
// And how near the camera is ever allowed to get. See the note in `frame`.
const MIN_DIST = 2.2;

export class Gallery {
  constructor(aspect) {
    this.rig = new PairRig();
    // No inertia, no effort, no life: the springs in the rig exist so a body
    // arrives somewhere over a few frames, and this body is never going
    // anywhere. Same switches tools/pose-check.mjs sets before it measures a
    // pose, and for the same reason — what is on the screen has to be the pose
    // and not the moment.
    this.rig.live = false;
    this.rig.effort.A = this.rig.effort.B = 0;
    this.rig.slack.A = this.rig.slack.B = 0;
    // The camera the renderer is handed. A plain object rather than the game's
    // Camera: that one drifts, breathes and shakes on purpose, and all three are
    // wrong for a photograph.
    this.camera = { eye: v3(0, 1.4, 3), at: v3(0, 0.6, 0), fov: 0.6 };
    this.focus = v3(0, 0.6, 0);
    this.i = -1;
    this.t = 0;
    // The shape of the glass. Landscape on a phone is about 2.1:1 and a laptop
    // is 1.6:1, and the same picture cannot be framed for both without knowing
    // which it is on.
    this.aspect = aspect > 0 ? aspect : 16 / 9;
    // Whether the page behind the blank one has already been turned.
    this.turned = false;
    // 1 is the picture, 0 is a blank page. The renderer mixes the whole frame
    // towards the ground colour with it.
    this.page = 1;
    this.show(0);
  }

  get plate() { return PLATES[this.i]; }

  // What the caption says. Out of the pose library rather than written here,
  // so a position that is renamed is renamed on the poster too.
  get caption() { return POSES[this.plate.pose].name; }

  get skel() { return this.rig.skel; }

  // The glass changed shape: the browser was resized, or the phone was turned.
  // Every plate is framed for the window it is in, so the shot has to be built
  // again — and it is the only thing about a plate that ever changes.
  resize(aspect) {
    if (aspect > 0 && Math.abs(aspect - this.aspect) > 0.001) this.frame(aspect);
    return this;
  }

  // Put a plate up. Poses the pair, then builds the shot around what the pose
  // turned out to be.
  show(i) {
    this.i = ((i % PLATES.length) + PLATES.length) % PLATES.length;
    const id = this.plate.pose;
    this.rig.rewind();
    this.rig.invalidate(id);
    this.rig.applyAt(id, id, 1, 1 / 60);
    this.frame();
    return this;
  }

  // The tripod, from the pair rather than from taste.
  //
  // Everything here is computed from the pose and the shape of the glass, and
  // nothing is authored. A distance written by hand is a distance that cuts a
  // foot off the next time a pose is re-solved — and poses in this project move
  // under their tools every round. It is also the only way a plate can be right
  // on both a phone held sideways at 2.2:1 and a laptop at 1.6:1: the same six
  // pictures, framed for the window each of them actually has.
  //
  // Two steps. How far back: the smallest distance at which every bone of both
  // men is inside the window. Then where to stand: the camera trucks sideways
  // and up until the middle of the pair is in the middle of the window — a
  // truck rather than a pan, so the picture is composed off-centre without the
  // shot being crooked.
  frame(aspect) {
    if (aspect > 0) this.aspect = aspect;
    const { orbit, elev, fov } = this.plate;
    const f = (fov * Math.PI) / 180;
    const tanY = Math.tan(f / 2);
    const tanX = tanY * this.aspect;
    const a = (orbit * Math.PI) / 180, e = (elev * Math.PI) / 180;
    // The camera's own three axes. Forward is the way it looks, which is the
    // opposite of where it stands.
    const dx = Math.sin(a) * Math.cos(e), dy = Math.sin(e), dz = Math.cos(a) * Math.cos(e);
    const rx = Math.cos(a), rz = -Math.sin(a);
    // Up, from forward and right: the shot is never rolled, so this is just the
    // cross product of the two.
    const ux = -(-dy) * rz, uy = (-dx) * rz - (-dz) * rx, uz = (-dy) * rx;
    const bones = [];
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const sk of [this.rig.skel.A, this.rig.skel.B]) {
      for (const w of sk.world) { bones.push([w[12], w[13], w[14]]); cx += w[12]; cy += w[13]; cz += w[14]; n++; }
    }
    cx /= n; cy /= n; cz /= n;

    // Where a bone falls, seen from d metres away with the camera trucked by
    // (sr, su): sideways, up, and how far in front of the lens it is.
    const span = (d, sr = 0, su = 0) => {
      const ex = cx + dx * d + rx * sr + ux * su;
      const ey = cy + dy * d + uy * su;
      const ez = cz + dz * d + rz * sr + uz * su;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, near = Infinity;
      for (const b of bones) {
        const px = b[0] - ex, py = b[1] - ey, pz = b[2] - ez;
        const w = -(px * dx + py * dy + pz * dz);
        if (w < near) near = w;
        if (w < 0.12) continue;
        const u = (px * rx + pz * rz) / w;
        const v = (px * ux + py * uy + pz * uz) / w;
        if (u < u0) u0 = u;
        if (u > u1) u1 = u;
        if (v < v0) v0 = v;
        if (v > v1) v1 = v;
      }
      return { u0, u1, v0, v1, near };
    };

    // How far back it has to stand. The test is monotone in the distance — step
    // back and everything shrinks — so a bisection finds the nearest distance
    // that holds the pair, and the nearest one is the one with the most man in
    // the picture.
    const wantU = ((WINDOW.x1 - WINDOW.x0) / 2) * tanX * FILL;
    const wantV = ((WINDOW.y1 - WINDOW.y0) / 2) * tanY * FILL;
    const fits = (d, sr, su) => {
      const s = span(d, sr, su);
      if (!(s.near > 0.3)) return false;
      return (s.u1 - s.u0) / 2 <= wantU && (s.v1 - s.v0) / 2 <= wantV;
    };
    // How far back, and how far across, solved together.
    //
    // They are not independent: trucking the camera sideways puts one man
    // nearer the lens than he was, and a body nearer the lens is a bigger body,
    // so the distance that held the pair before the truck does not hold it
    // afterwards. The first version of this solved the distance on a centred
    // camera and then moved it, and the judge caught the difference — a foot
    // over the edge of the window on the squarer glass, on exactly the plate
    // where one man's legs reach furthest towards the camera. So the two are
    // iterated: fit, truck, fit again from where the camera now is.
    let d = MIN_DIST, sr = 0, su = 0;
    for (let pass = 0; pass < 4; pass++) {
      let lo = 0.6, hi = 26;
      for (let i = 0; i < 44; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid, sr, su)) hi = mid; else lo = mid;
      }
      // Never a fish-eye. A metre and a half from a shoulder is a lens nothing
      // is photographed with: the near arm is twice the far one and the whole
      // picture reads as a mistake rather than as a position. When the window
      // could hold more than that, the picture is simply smaller.
      d = Math.max(MIN_DIST, hi);
      const s = span(d, sr, su);
      sr += ((s.u0 + s.u1) / 2 - ((WINDOW.x0 + WINDOW.x1) / 2) * tanX) * d;
      su += ((s.v0 + s.v1) / 2 - ((WINDOW.y0 + WINDOW.y1) / 2) * tanY) * d;
    }
    // Never underground: a hall camera can be low, and a hall camera in the
    // floor is a black picture with a mat edge across it. The whole camera goes
    // up rather than just the eye — lifting one end of it would turn the shot
    // by however much the floor was in the way, and quietly undo the framing
    // the four passes above just solved. Nothing reaches this at the moment;
    // the lowest plate stands 0.6 m off the mat, and «зал» in poster-check
    // watches that number.
    const lift = Math.max(0, 0.22 - (cy + uy * su + dy * d));
    this.focus[0] = cx; this.focus[1] = cy; this.focus[2] = cz;
    this.camera.at[0] = cx + rx * sr + ux * su;
    this.camera.at[1] = cy + uy * su + lift;
    this.camera.at[2] = cz + rz * sr + uz * su;
    this.camera.eye[0] = this.camera.at[0] + dx * d;
    this.camera.eye[1] = this.camera.at[1] + dy * d;
    this.camera.eye[2] = this.camera.at[2] + dz * d;
    this.camera.fov = f;
    this.dist = d;
    return this;
  }

  // The page turn. The only thing on this screen that moves.
  update(dt) {
    this.t += dt;
    if (this.t < HOLD) { this.page = 1; return; }
    if (this.t < HOLD + TURN_OUT) {
      const u = (this.t - HOLD) / TURN_OUT;
      this.page = 1 - u * u * (3 - 2 * u);
      return;
    }
    if (this.t < CYCLE) {
      // The swap happens on the blank page, so nothing is ever seen changing.
      if (!this.turned) { this.turned = true; this.show(this.i + 1); }
      const u = (this.t - HOLD - TURN_OUT) / TURN_IN;
      this.page = u * u * (3 - 2 * u);
      return;
    }
    this.t = 0;
    this.page = 1;
    this.turned = false;
  }

  // Straight to a plate, for a tool that wants to photograph one.
  at(i) {
    this.t = 0;
    this.page = 1;
    this.turned = false;
    return this.show(i);
  }
}
