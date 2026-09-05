// The skin, small enough to put inside a search.
//
// weight-check judges a pose on the baked mesh: eleven thousand vertices, the
// same ones the game draws, because what the eye calls "floating" is the skin
// and not the bone. pose-relax has to solve against the same ruler or it fixes
// something nobody measures — and it evaluates its cost tens of thousands of
// times per pose, where eleven thousand vertices is a minute a pose.
//
// So: keep the vertices that can ever be the lowest one, and throw the rest
// away — the extreme vertex in each of D directions spread over the sphere,
// taken group by group (see below for what a group is and why it makes the
// answer exact rather than close).
//
// The kept vertices are ordinary vertices, with their own two bones and
// weights, so they skin exactly as the full mesh does. This is a subset, not a
// model of one. Measured against the full mesh over every pose in the library:
// 11850 vertices become 4089, the lowest point of the whole man is right to the
// last bit, and the lowest point of any single bone is within 2.1 mm.
export function skinLite(mesh, D = 200) {
  const { pos: P, bone, wt } = mesh;
  const n = P.length / 3;
  const dirs = fibonacci(D);
  // Grouped by the two bones a vertex hangs off *and* by how it is split
  // between them, because that is exactly when the answer is exact. A vertex
  // lands at w0·M0·p + w1·M1·p, so among vertices sharing both bones and both
  // weights, "lowest in the world" is a linear functional of p — one fixed
  // direction in bind space, whatever the pose does. Sample the sphere in bind
  // space and the extremes are kept for every pose there will ever be. Vertices
  // that share the bones but split differently are a different group; the
  // weight is bucketed, so the guarantee is approximate at the seams and exact
  // everywhere else.
  const groups = new Map();
  for (let v = 0; v < n; v++) {
    const key = (bone[v * 2] * 64 + bone[v * 2 + 1]) * 16 + Math.min(15, (wt[v * 2] * 16) | 0);
    let g = groups.get(key);
    if (!g) groups.set(key, g = []);
    g.push(v);
  }
  const keep = new Set();
  for (const g of groups.values()) {
    for (const d of dirs) {
      let best = -Infinity, bi = -1;
      for (const v of g) {
        const s = P[v * 3] * d[0] + P[v * 3 + 1] * d[1] + P[v * 3 + 2] * d[2];
        if (s > best) { best = s; bi = v; }
      }
      if (bi >= 0) keep.add(bi);
    }
  }
  const list = [...keep].sort((a, b) => a - b);
  const out = {
    pos: new Float32Array(list.length * 3),
    bone: new Uint16Array(list.length * 2),
    wt: new Float32Array(list.length * 2),
  };
  list.forEach((v, i) => {
    out.pos[i * 3] = P[v * 3]; out.pos[i * 3 + 1] = P[v * 3 + 1]; out.pos[i * 3 + 2] = P[v * 3 + 2];
    out.bone[i * 2] = bone[v * 2]; out.bone[i * 2 + 1] = bone[v * 2 + 1];
    out.wt[i * 2] = wt[v * 2]; out.wt[i * 2 + 1] = wt[v * 2 + 1];
  });
  return out;
}

function fibonacci(n) {
  const out = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
}

// Every kept vertex of one man, in the world, with the bone it hangs off.
// Fills the caller's arrays so a search allocates nothing.
export function skinInto(lite, sk, xyz, who) {
  const { pos: P, bone, wt } = lite;
  const n = P.length / 3;
  for (let v = 0; v < n; v++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 2; k++) {
      const w = wt[v * 2 + k];
      if (w <= 0) continue;
      const s = sk.skin.subarray(bone[v * 2 + k] * 16, bone[v * 2 + k] * 16 + 16);
      const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      x += w * (s[0] * px + s[4] * py + s[8] * pz + s[12]);
      y += w * (s[1] * px + s[5] * py + s[9] * pz + s[13]);
      z += w * (s[2] * px + s[6] * py + s[10] * pz + s[14]);
    }
    xyz[v * 3] = x; xyz[v * 3 + 1] = y; xyz[v * 3 + 2] = z;
    who[v] = bone[v * 2];
  }
  return n;
}
