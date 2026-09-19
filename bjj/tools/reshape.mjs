// Give the baked man a waist.
//
// A player looked at the title card and said the figure was wrong. He was, and
// nothing in this toolbox could have told him so: everything here measures what
// a body *does* — where its weight is, what it intersects, how far a joint
// folds — and nothing measured what it *is*. `figure-check` does now, and what
// it found is not subtle:
//
//   fighter.bin   shoulders 0.249 H   a man is 0.259
//                 waist     0.256 H   a man is 0.180
//
// He is wider at the waist than at the shoulders. A person tapers from one to
// the other by a factor of about one and a half, and that ratio is most of what
// makes a silhouette read as an athlete rather than as a bag; this one was at
// 0.97. It is the source character, not the rig: the same measurement on the
// second fighter reads 1.10, which is better and still not a person.
//
// So the trunk is squeezed, as a pass in the baker rather than a hand edit of
// the asset — the .bin is a build product, the FBX is the source, and a shape
// fixed in the product would be undone by the next bake. The baker reproduces
// the shipped asset byte for byte, so this pass is the whole of the difference.
//
// Four things make it safe:
//
//   - it runs before the decimator and before the occlusion bake, so the
//     triangles that are thrown away are thrown away from the shape that
//     ships, and the light that is baked is baked into it;
//   - it scales about the trunk's own centre line at each height rather than
//     about the origin, so a belly comes in rather than the whole man sliding;
//   - it is weighted by how much of a vertex belongs to the trunk, taken from
//     the same skin weights the renderer bends with, so there is no seam to
//     tear at the shoulder or the hip — a sleeve vertex is untouched, a lapel
//     vertex moves fully, and the ones between move partly;
//   - and the profile goes to one outside the trunk's own range, so nothing
//     happens to a knee or a skull.
//
// The targets are a person's breadths with a jacket's allowance on them: a gi
// is a centimetre of stiff cotton a side and a waist in one is not a waist in a
// vest. Written here rather than in the baker because they are anatomy, and the
// baker is about bones and bind matrices.
export const TARGET = [
  // fraction of stature, wanted breadth as a fraction of stature
  [0.88, null],   // the neck and above: untouched
  [0.82, 0.262],  // across the shoulders
  [0.72, 0.238],  // the chest
  [0.63, 0.198],  // the waist
  [0.55, 0.208],  // the hips
  [0.45, null],   // the thighs and below: untouched
];

// Which bones make a trunk. The same set figure-check measures on, because a
// pass that shapes one thing and a judge that measures another is how this
// project has lost a round before.
export const TRUNK = ['hips', 'spine', 'chest', 'neck', 'clavL', 'clavR'];

// Smoothstep between two knots, so the squeeze has no corner in it. A corner in
// the profile is a crease across the jacket, and a crease that is not a fold is
// the thing the fold measure exists to find.
const ease = (t) => t * t * (3 - 2 * t);

// `mesh` is the baker's FINAL: pos, nrm, bone, wt, idx. `boneIndex` maps a name
// to its slot. Returns what it did, for the log.
export function reshape(mesh, boneIndex) {
  const { pos, bone, wt, idx } = mesh;
  const n = pos.length / 3;
  const trunk = new Set(TRUNK.map((b) => boneIndex[b]));

  // How much of each vertex is trunk, and where the man is.
  const w = new Float64Array(n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 4; k++) if (trunk.has(bone[i * 4 + k] | 0)) s += wt[i * 4 + k];
    w[i] = Math.min(1, s);
    const y = pos[i * 3 + 1];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const H = hi - lo;

  // The trunk's own breadth and centre at a height, which is what the scale is
  // computed against and scaled about.
  const BANDS = 64;
  const half = (0.5 / BANDS) * 1.6;
  const band = (f) => {
    const y0 = lo + H * (f - half), y1 = lo + H * (f + half);
    let xlo = Infinity, xhi = -Infinity, zlo = Infinity, zhi = -Infinity, k = 0;
    for (let i = 0; i < n; i++) {
      if (w[i] < 0.6) continue;
      const y = pos[i * 3 + 1];
      if (y < y0 || y > y1) continue;
      const x = pos[i * 3], z = pos[i * 3 + 2];
      if (x < xlo) xlo = x;
      if (x > xhi) xhi = x;
      if (z < zlo) zlo = z;
      if (z > zhi) zhi = z;
      k++;
    }
    return k ? { width: (xhi - xlo) / H, cx: (xhi + xlo) / 2, cz: (zhi + zlo) / 2 } : null;
  };

  // The scale at each knot: what it is now against what it should be.
  const knots = [];
  for (const [f, want] of TARGET) {
    if (want == null) { knots.push([f, 1, null]); continue; }
    const b = band(f);
    knots.push([f, b ? want / b.width : 1, b]);
  }
  knots.sort((a, b) => a[0] - b[0]);

  const scaleAt = (f) => {
    if (f <= knots[0][0] || f >= knots[knots.length - 1][0]) return 1;
    for (let i = 0; i < knots.length - 1; i++) {
      const [f0, s0] = knots[i], [f1, s1] = knots[i + 1];
      if (f >= f0 && f <= f1) return s0 + (s1 - s0) * ease((f - f0) / (f1 - f0));
    }
    return 1;
  };
  // And where the trunk's middle is at that height, so the squeeze comes in
  // towards him rather than towards the origin.
  const centreAt = (f) => {
    let best = null, bestD = 9;
    for (const [kf, , b] of knots) {
      if (!b) continue;
      const d = Math.abs(kf - f);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best || { cx: 0, cz: 0 };
  };

  let moved = 0, worst = 0;
  for (let i = 0; i < n; i++) {
    if (w[i] < 0.001) continue;
    const f = (pos[i * 3 + 1] - lo) / H;
    const s = 1 + (scaleAt(f) - 1) * w[i];
    if (Math.abs(s - 1) < 1e-6) continue;
    const c = centreAt(f);
    const x = pos[i * 3], z = pos[i * 3 + 2];
    const nx = c.cx + (x - c.cx) * s;
    const nz = c.cz + (z - c.cz) * s;
    const d = Math.hypot(nx - x, nz - z);
    if (d > worst) worst = d;
    moved += d > 0.001 ? 1 : 0;
    pos[i * 3] = nx;
    pos[i * 3 + 2] = nz;
  }

  // Normals, from the triangles the vertices now make. A non-uniform scale
  // does not carry a normal with it, and a stale normal on a squeezed waist is
  // a light that says the belly is still round.
  const nrm = mesh.nrm;
  nrm.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const o of [a, b, c]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; }
  }
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1;
    nrm[o] /= l; nrm[o + 1] /= l; nrm[o + 2] /= l;
  }

  return {
    height: H,
    moved,
    worst,
    knots: knots.filter((k) => k[2]).map(([f, s, b]) => ({
      at: f, was: b.width, scale: s, now: b.width * s,
    })),
  };
}
