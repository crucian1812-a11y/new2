// The room. One static mesh, built once.
//
// The art direction is a real competition hall shot for television: the mat is
// the only brightly lit thing in the building, the crowd is a dark mass with
// a few catchlights in it, and everything else falls off into haze. That is
// cheap to render and it is also what the reference actually looks like, which
// is the useful kind of coincidence.

const AREA = 8;   // the competition square, metres
const SAFETY = 3; // the safety border around it

class Static {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.mat = [];
    this.idx = [];
  }
  v(p, n, u, m) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u[0], u[1]);
    this.mat.push(m);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  // Axis-aligned box, only the faces that can be seen.
  box(cx, cy, cz, sx, sy, sz, m, skipBottom = true) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    const f = [
      [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
    ];
    if (!skipBottom) f.push([[x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [0, -1, 0]]);
    for (const [a, b, c, d, n] of f) {
      const ia = this.v(a, n, [0, 0], m);
      const ib = this.v(b, n, [1, 0], m);
      const ic = this.v(c, n, [1, 1], m);
      const id = this.v(d, n, [0, 1], m);
      this.quad(ia, ib, ic, id);
    }
  }
  build() {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      uv: new Float32Array(this.uv),
      mat: new Float32Array(this.mat),
      idx: new Uint32Array(this.idx),
      count: this.idx.length,
    };
  }
}

export function buildArena(rand = mulberry(20260826)) {
  const s = new Static();
  const half = AREA / 2 + SAFETY;

  // The mat, one grid of quads so the vertex shader has something to work with
  // for the seam highlight and so the ground is not one enormous triangle pair
  // fighting the depth buffer at grazing angles.
  const N = 14;
  const base = s.pos.length / 3;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = -half + (i / N) * half * 2;
      const z = -half + (j / N) * half * 2;
      s.v([x, 0.05, z], [0, 1, 0], [x, z], 0);
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = base + j * (N + 1) + i;
      s.quad(a, a + 1, a + N + 2, a + N + 1);
    }
  }

  // The lip of the mat, so it reads as 5 cm of foam and not a decal.
  for (const [sx, sz, cx, cz] of [
    [half * 2, 0.05, 0, half], [half * 2, 0.05, 0, -half],
    [0.05, half * 2, half, 0], [0.05, half * 2, -half, 0],
  ]) {
    s.box(cx, 0.025, cz, sx || 0.05, 0.05, sz || 0.05, 1);
  }

  // The hall floor, well outside the mat, dark and matte.
  const F = 30;
  const fb = s.pos.length / 3;
  s.v([-F, 0, -F], [0, 1, 0], [0, 0], 1);
  s.v([F, 0, -F], [0, 1, 0], [1, 0], 1);
  s.v([F, 0, F], [0, 1, 0], [1, 1], 1);
  s.v([-F, 0, F], [0, 1, 0], [0, 1], 1);
  s.quad(fb, fb + 1, fb + 2, fb + 3);

  // Barrier hoardings around the mat: the dark band every broadcast frame has
  // between the athletes and the crowd.
  // Material 7 and not 2: these are the lit sponsor boards, and they are the
  // only ring of colour between a white mat and a black crowd. Without them
  // the hall has no horizon and the whole frame reads as two men in a void.
  // With a gap in the near side for the referee's table, which is how a mat
  // actually looks and, less nobly, the only way anything in the working ring
  // outside the boards is ever seen from a camera at head height.
  const GAP = 3.6;
  const runLen = (half * 2 + 2.8 - GAP) / 2;
  for (const side of [-1, 1]) {
    s.box(side * (half + 1.4), 0.45, 0, 0.25, 0.9, half * 2 + 2.8, 7);
  }
  s.box(0, 0.45, half + 1.4, half * 2 + 2.8, 0.9, 0.25, 7);
  for (const dx of [-1, 1]) {
    s.box(dx * (GAP / 2 + runLen / 2), 0.45, -(half + 1.4), runLen, 0.9, 0.25, 7);
  }

  // Tiered stands. Boxes, deliberately — at this distance and this light level
  // the silhouette is the only thing that survives, and a silhouette is free.
  for (const side of [-1, 1]) {
    for (let row = 0; row < 7; row++) {
      const d = half + 3.2 + row * 1.15;
      const y = 0.35 + row * 0.55;
      s.box(0, y / 2, side * d, 30, y, 1.15, 3);
      s.box(side * d, y / 2, 0, 1.15, y, 30, 3);
      // The crowd itself: torsos, jittered, never quite in a row.
      for (let i = 0; i < 26; i++) {
        const t = (i - 12.5) * 1.15 + (rand() - 0.5) * 0.5;
        if (Math.abs(t) > 14) continue;
        const h = 0.72 + rand() * 0.22;
        s.box(t, y + h / 2, side * (d - 0.15 + (rand() - 0.5) * 0.2), 0.5, h, 0.4, 4);
        s.box(side * (d - 0.15 + (rand() - 0.5) * 0.2), y + h / 2, t, 0.4, h, 0.5, 4);
      }
    }
  }

  // The jumbotron. Lifted from the generated arena, which had little else in
  // it worth having: a cube with a screen on each face, hung from the truss
  // and showing the same numbers the broadcast scorebug does. It costs twelve
  // triangles and it is the thing that says the event is being broadcast
  // rather than held in a gym.
  //
  // It used to hang over the middle of the mat, and the broadcast camera
  // never saw it: at 4.45 m it sits forty degrees above a camera that looks
  // down at the mat from head height, so the whole cube lived out of frame
  // and the score it now carries would have been invisible. It hangs over the
  // far side instead — just in front of the far truss bar, over the safety
  // border — where the wide shot frames it whole, above the fighters, against
  // the dark stands. A scoreboard nobody can see is decoration; this one is
  // in the frame.
  s.box(0, 3.0, -5.5, 2.2, 1.3, 2.2, 2, false);
  // The screens sit a touch proud of the frame (1.12 against a 1.1 half), the
  // way the original cube's did — flush, they fall behind the frame's face and
  // the depth buffer swallows them whole.
  for (const [dx, dz, sx, sz] of [[0, 1, 1.9, 0.02], [0, -1, 1.9, 0.02], [1, 0, 0.02, 1.9], [-1, 0, 0.02, 1.9]]) {
    s.box(dx * 1.12, 3.0, -5.5 + dz * 1.12, sx || 0.02, 0.92, sz || 0.02, 6);
  }
  // The hanger: a plate on the cube's top and one rod up to the truss bar,
  // which runs straight overhead here.
  s.box(0, 3.78, -5.5, 0.5, 0.12, 0.5, 2);
  s.box(0, 4.82, -5.5, 0.12, 1.96, 0.12, 2);

  // The truss overhead, which is what gives the key light somewhere to be.
  for (const side of [-1, 1]) {
    s.box(0, 6.2, side * 5.5, 26, 0.3, 0.3, 2);
    s.box(side * 5.5, 6.2, 0, 0.3, 0.3, 26, 2);
  }
  for (const [x, z] of [[-4.4, -4.4], [4.4, -4.4], [-4.4, 4.4], [4.4, 4.4], [0, -5.5], [0, 5.5]]) {
    s.box(x, 6.0, z, 0.55, 0.28, 0.55, 5); // the lamp housings, emissive
  }

  matside(s, half);
  return s.build();
}

export const ARENA_AREA = AREA;
export const ARENA_HALF = AREA / 2 + SAFETY;


// What is round the edge of a mat, and it is not nothing.
//
// A sent arena was measured against this hall and turned down — 141 boxes
// against the 7656 triangles built here, and five of its eight textures
// carrying somebody else's tournament name (see art/packs/README.md). What it
// did have was a list: the referee's table, the judges' desks, a podium, the
// medals, the speakers, the LED ribbon. Those are boxes, and boxes this file
// already knows how to make — so they are built here, at our own scale, and
// the only thing on them that carries a name carries the club's.
//
// Everything lives in the ring between the sponsor boards at 8.4 m and the
// stands at 10.2 m, which is where it stands in a real hall and, usefully, is
// also where the camera never goes.
function matside(s, half) {
  const R = half + 1.9;   // the working ring, just outside the boards

  // The referee's table, in the gap in the boards and close enough in to be
  // seen through it.
  const rt = -(half + 1.05);
  s.box(0, 0.74, rt, 2.2, 0.07, 0.75, 8);
  for (const dx of [-0.95, 0.95]) s.box(dx, 0.37, rt, 0.08, 0.74, 0.08, 2);
  s.box(0, 0.46, rt - 0.75, 0.5, 0.06, 0.5, 8);
  s.box(0, 0.72, rt - 0.98, 0.5, 0.5, 0.06, 8);
  s.box(0.55, 0.83, rt, 0.34, 0.12, 0.24, 6);   // a screen, lit like the jumbotron

  // Two judges, one either side of him, each with a monitor. They sit behind
  // the boards, which is where they sit.
  for (const dx of [-2.6, 2.6]) {
    s.box(dx, 0.72, -R - 0.2, 1.1, 0.06, 0.6, 8);
    for (const k of [-0.45, 0.45]) s.box(dx + k, 0.36, -R - 0.2, 0.07, 0.72, 0.07, 2);
    s.box(dx, 0.9, -R - 0.35, 0.42, 0.28, 0.04, 6);
  }

  // The podium, in the far corner, three steps and the middle one highest.
  const px = R - 1.2, pz = R - 0.6;
  for (const [dx, h] of [[-0.62, 0.22], [0, 0.42], [0.62, 0.14]]) {
    s.box(px + dx, h / 2, pz, 0.58, h, 0.58, 8);
  }

  // The medal rack beside it: a frame, and the medals on their ribbons.
  s.box(px - 1.7, 0.6, pz, 0.06, 1.2, 0.06, 2);
  s.box(px - 2.6, 0.6, pz, 0.06, 1.2, 0.06, 2);
  s.box(px - 2.15, 1.2, pz, 0.96, 0.06, 0.06, 2);
  for (let i = 0; i < 5; i++) {
    const x = px - 2.5 + i * 0.18;
    s.box(x, 1.02, pz, 0.03, 0.3, 0.01, 1);     // the ribbon
    s.box(x, 0.85, pz, 0.08, 0.08, 0.02, 9);    // and the medal
  }

  // Water and a medical kit on the near side, where the corners sit.
  s.box(-R + 0.6, 0.35, R - 0.8, 0.5, 0.7, 0.4, 8);
  for (let i = 0; i < 4; i++) s.box(-R + 0.45 + i * 0.1, 0.79, R - 0.8, 0.06, 0.18, 0.06, 6);
  s.box(-R + 1.4, 0.16, R - 0.8, 0.4, 0.32, 0.28, 1);

  // Speakers on stands at the four corners, aimed in.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.box(sx * (R - 0.2), 1.05, sz * (R - 0.2), 0.06, 2.1, 0.06, 2);
    s.box(sx * (R - 0.2), 2.3, sz * (R - 0.2), 0.42, 0.6, 0.34, 2);
  }

  // The LED ribbon along the top of the boards. It is the one thing out here
  // that carries lettering, and the lettering is the club's own — the same
  // wordmark the mat is printed with, read off the same atlas.
  for (const side of [-1, 1]) {
    s.box(0, 0.99, side * (half + 1.4), half * 2 + 2.8, 0.18, 0.28, 10);
    s.box(side * (half + 1.4), 0.99, 0, 0.28, 0.18, half * 2 + 2.8, 10);
  }
}

export function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
