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
  for (const side of [-1, 1]) {
    s.box(0, 0.45, side * (half + 1.4), half * 2 + 2.8, 0.9, 0.25, 7);
    s.box(side * (half + 1.4), 0.45, 0, 0.25, 0.9, half * 2 + 2.8, 7);
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
  // it worth having: a cube hung over the middle of the mat with a screen on
  // each face. It costs twelve triangles and it is the thing that says the
  // event is being broadcast rather than held in a gym.
  s.box(0, 4.45, 0, 1.9, 1.15, 1.9, 2, false);
  for (const [dx, dz, sx, sz] of [[0, 1, 1.62, 0.02], [0, -1, 1.62, 0.02], [1, 0, 0.02, 1.62], [-1, 0, 0.02, 1.62]]) {
    s.box(dx * 0.97, 4.45, dz * 0.97, sx || 0.02, 0.82, sz || 0.02, 6);
  }
  s.box(0, 5.12, 0, 0.16, 0.2, 0.16, 2);
  for (const dz of [-0.55, 0.55]) s.box(0, 5.72, dz, 0.06, 1.2, 0.06, 2);

  // The truss overhead, which is what gives the key light somewhere to be.
  for (const side of [-1, 1]) {
    s.box(0, 6.2, side * 5.5, 26, 0.3, 0.3, 2);
    s.box(side * 5.5, 6.2, 0, 0.3, 0.3, 26, 2);
  }
  for (const [x, z] of [[-4.4, -4.4], [4.4, -4.4], [-4.4, 4.4], [4.4, 4.4], [0, -5.5], [0, 5.5]]) {
    s.box(x, 6.0, z, 0.55, 0.28, 0.55, 5); // the lamp housings, emissive
  }

  return s.build();
}

export const ARENA_AREA = AREA;
export const ARENA_HALF = AREA / 2 + SAFETY;

export function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
