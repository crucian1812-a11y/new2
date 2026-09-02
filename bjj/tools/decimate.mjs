// Fewer triangles for the same man.
//
// The opponent arrives from Mixamo at 46 314 triangles against the first
// fighter's 29 865, and he is drawn three times a frame — shadow, outline, lit
// — so he alone is 139 000 of the frame's 326 000. Nothing about him needs that
// many: he is 1.78 m tall, on a phone, at three metres.
//
// Garland–Heckbert, in the half-edge form: every collapse moves one vertex onto
// another one that already exists, so every attribute the format carries — the
// UV, the two bone indices, the weight, the material, the baked occlusion —
// belongs to a vertex that was authored rather than to one this invented. That
// is the whole reason for the restriction. A quadric that solves for the
// optimal position gives a slightly smaller error and would have to make up
// skin weights at that position, and made-up weights on a joint are how a limb
// ends up welded to the wrong bone.
//
// What is never collapsed:
//
//   - a vertex on a material boundary. The shader picks skin, gi, belt, hair
//     and eye by an integer per vertex, and a collapse across that line drags
//     one material's vertex into the middle of another's triangle.
//   - a vertex on a mesh boundary — a hem, a cuff, the rim of an eyelid. There
//     is no triangle on the other side to hold the shape, and the silhouette
//     of a gi is mostly hems.
//   - anything that would turn a triangle inside out. Checked per collapse
//     against the normals the triangles had before it.

const EPS = 1e-12;

// Q is a symmetric 4x4 kept as its 10 distinct entries.
function planeQ(a, b, c, out) {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz);
  if (len < EPS) return 0;
  nx /= len; ny /= len; nz /= len;
  const d = -(nx * a[0] + ny * a[1] + nz * a[2]);
  out[0] = nx * nx; out[1] = nx * ny; out[2] = nx * nz; out[3] = nx * d;
  out[4] = ny * ny; out[5] = ny * nz; out[6] = ny * d;
  out[7] = nz * nz; out[8] = nz * d;
  out[9] = d * d;
  return len / 2;                                   // the triangle's area
}

function quadricAt(Q, o, x, y, z) {
  return Q[o] * x * x + 2 * Q[o + 1] * x * y + 2 * Q[o + 2] * x * z + 2 * Q[o + 3] * x
       + Q[o + 4] * y * y + 2 * Q[o + 5] * y * z + 2 * Q[o + 6] * y
       + Q[o + 7] * z * z + 2 * Q[o + 8] * z
       + Q[o + 9];
}

// `keep` is one multiplier per vertex on the cost of removing it: above one
// means "spend somewhere else first", below one means "spend here". Omit it and
// nothing changes.
//
// Garland–Heckbert on its own prices a collapse by the curvature it destroys,
// which is the right rule for a model viewer and the wrong one for a game with
// a camera at three metres. A scalp is smooth, dense and curved, so every
// collapse on it is expensive and it survives whole: two thirds of the second
// fighter's vertices are his head. A foot is flat and faceted, so collapses
// there are cheap and it is flattened into a wedge — fifty-one vertices and
// seventy triangles for two of them. budget-check measures the two shares that
// say so: what each part takes of the screen across real matches, and what it
// takes of the mesh.
export function decimate(mesh, targetTris, keep = null) {
  const pos = Float32Array.from(mesh.pos);
  const idx = Array.from(mesh.idx);
  const n = pos.length / 3;
  const nTri = idx.length / 3;

  // Quadrics, area-weighted.
  const Q = new Float64Array(n * 10);
  const tri = [0, 0, 0].map(() => [0, 0, 0]);
  const q = new Float64Array(10);
  const triNrm = new Float32Array(nTri * 3);
  const alive = new Uint8Array(nTri).fill(1);
  for (let t = 0; t < nTri; t++) {
    for (let c = 0; c < 3; c++) {
      const v = idx[t * 3 + c] * 3;
      tri[c][0] = pos[v]; tri[c][1] = pos[v + 1]; tri[c][2] = pos[v + 2];
    }
    const area = planeQ(tri[0], tri[1], tri[2], q);
    if (!area) { alive[t] = 0; continue; }
    triNrm[t * 3] = q[3] === undefined ? 0 : 0;      // filled below
    for (let c = 0; c < 3; c++) {
      const o = idx[t * 3 + c] * 10;
      for (let k = 0; k < 10; k++) Q[o + k] += q[k] * area;
    }
  }
  // The normals themselves, for the flip test.
  const nrmOf = (t, out) => {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    out[0] = e1y * e2z - e1z * e2y;
    out[1] = e1z * e2x - e1x * e2z;
    out[2] = e1x * e2y - e1y * e2x;
    return Math.hypot(out[0], out[1], out[2]);
  };
  const tmp = [0, 0, 0];
  for (let t = 0; t < nTri; t++) {
    const l = nrmOf(t, tmp);
    if (l > EPS) { triNrm[t * 3] = tmp[0] / l; triNrm[t * 3 + 1] = tmp[1] / l; triNrm[t * 3 + 2] = tmp[2] / l; }
  }

  // Who touches what.
  const tris = Array.from({ length: n }, () => []);
  for (let t = 0; t < nTri; t++) {
    if (!alive[t]) continue;
    for (let c = 0; c < 3; c++) tris[idx[t * 3 + c]].push(t);
  }

  // Locked: material seams and open boundaries.
  const locked = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    let m = -1;
    for (const t of tris[v]) {
      for (let c = 0; c < 3; c++) {
        const w = mesh.mat[idx[t * 3 + c]];
        if (m < 0) m = w;
        else if (w !== m) { locked[v] = 1; break; }
      }
      if (locked[v]) break;
    }
  }
  // A vertex on an open edge may move, but only along the edge it is on.
  //
  // Nailing them down outright was the first rule and it is far too strong for
  // this character. An open edge is an edge with one triangle: a hem, a cuff,
  // the rim of an eyelid — and every border of every hair card. Measured on the
  // opponent, 8740 of his 11441 hair vertices are on one, which is thirty per
  // cent of his whole mesh locked before the thinner has looked at it, on a head
  // that look-check has never once caught large enough to measure.
  //
  // What the rule is protecting is the *curve* of the border, and a collapse
  // from one boundary vertex onto another it shares an open edge with keeps that
  // curve: the border stays where it was, with one fewer vertex describing it.
  // What it must not do is drag the border inwards onto the surface, or pull a
  // surface vertex out onto the border, and both of those are collapses between
  // a boundary vertex and an interior one.
  const edgeMate = new Map();
  {
    const seen = new Map();
    for (let t = 0; t < nTri; t++) {
      if (!alive[t]) continue;
      for (let c = 0; c < 3; c++) {
        const a = idx[t * 3 + c], b = idx[t * 3 + (c + 1) % 3];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        seen.set(k, (seen.get(k) || 0) + 1);
      }
    }
    for (const [k, count] of seen) {
      if (count !== 1) continue;
      const [a, b] = k.split(',').map(Number);
      if (!edgeMate.has(a)) edgeMate.set(a, new Set());
      if (!edgeMate.has(b)) edgeMate.set(b, new Set());
      edgeMate.get(a).add(b);
      edgeMate.get(b).add(a);
    }
  }
  // A corner of a border — three or more open edges meeting — is a feature and
  // stays. Two is a point along a curve and may slide; one is a dangling edge
  // and there is nothing sensible to slide it to.
  // And sliding along it has to cost what it deforms.
  //
  // A boundary vertex's quadric is the sum of its own few triangles' planes, and
  // on a flat hair card every one of them is the same plane — so moving along
  // the border is free by that measure, and the first run of the rule above
  // took the surface from 3 mm out to 42. What is missing is the plane the
  // border itself lies in: for every open edge, a plane through it and
  // perpendicular to the triangle that owns it. Garland and Heckbert put it
  // there for exactly this, weighted well above the surface terms, and it is
  // what lets a border shorten along a straight run and stops it cutting a
  // corner.
  {
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (const [v, mates] of edgeMate) {
      for (const w of mates) {
        if (w < v) continue;                          // each edge once
        // A third point off the edge, in the direction of the edge's own
        // triangle normal: the plane through the edge and perpendicular to the
        // surface. Any triangle sharing both ends will do — an open edge has
        // exactly one.
        let t = -1;
        for (const k of tris[v]) {
          if (!alive[k]) continue;
          const i0 = idx[k * 3], i1 = idx[k * 3 + 1], i2 = idx[k * 3 + 2];
          if (i0 === w || i1 === w || i2 === w) { t = k; break; }
        }
        if (t < 0) continue;
        const l = nrmOf(t, tmp);
        if (l < EPS) continue;
        a[0] = pos[v * 3]; a[1] = pos[v * 3 + 1]; a[2] = pos[v * 3 + 2];
        b[0] = pos[w * 3]; b[1] = pos[w * 3 + 1]; b[2] = pos[w * 3 + 2];
        c[0] = a[0] + tmp[0] / l; c[1] = a[1] + tmp[1] / l; c[2] = a[2] + tmp[2] / l;
        if (!planeQ(a, b, c, q)) continue;
        // Weighted by the edge's own length squared, so a long border matters
        // more than a stray sliver, and then by a constant that puts it well
        // above the surface terms it competes with.
        const el = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const wgt = el * el * 260;
        for (const o of [v * 10, w * 10]) for (let k = 0; k < 10; k++) Q[o + k] += q[k] * wgt;
      }
    }
  }

  const allowed = (v, w) => {
    if (locked[v]) return false;
    const ev = edgeMate.get(v);
    if (!ev) return !edgeMate.has(w);          // interior onto interior only
    return ev.size === 2 && ev.has(w);
  };

  // Candidate collapses: v disappears into w.
  const cost = (v, w) =>
    quadricAt(Q, v * 10, pos[w * 3], pos[w * 3 + 1], pos[w * 3 + 2]) * (keep ? keep[v] : 1);
  const heap = [];
  const push = (c, v, w) => {
    heap.push({ c, v, w });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].c <= heap[i].c) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < heap.length && heap[l].c < heap[s].c) s = l;
        if (r < heap.length && heap[r].c < heap[s].c) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };
  const neighbours = (v) => {
    const out = new Set();
    for (const t of tris[v]) {
      if (!alive[t]) continue;
      for (let c = 0; c < 3; c++) if (idx[t * 3 + c] !== v) out.add(idx[t * 3 + c]);
    }
    return out;
  };
  const gone = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    if (locked[v]) continue;
    for (const w of neighbours(v)) if (allowed(v, w)) push(cost(v, w), v, w);
  }

  // Would this collapse turn anything inside out?
  const flips = (v, w) => {
    const keep = pos[v * 3], keep1 = pos[v * 3 + 1], keep2 = pos[v * 3 + 2];
    pos[v * 3] = pos[w * 3]; pos[v * 3 + 1] = pos[w * 3 + 1]; pos[v * 3 + 2] = pos[w * 3 + 2];
    let bad = false;
    for (const t of tris[v]) {
      if (!alive[t]) continue;
      const has = idx[t * 3] === w || idx[t * 3 + 1] === w || idx[t * 3 + 2] === w;
      if (has) continue;                             // this one is about to vanish
      const l = nrmOf(t, tmp);
      if (l < EPS) { bad = true; break; }
      const d = (tmp[0] / l) * triNrm[t * 3] + (tmp[1] / l) * triNrm[t * 3 + 1] + (tmp[2] / l) * triNrm[t * 3 + 2];
      if (d < 0.2) { bad = true; break; }
    }
    pos[v * 3] = keep; pos[v * 3 + 1] = keep1; pos[v * 3 + 2] = keep2;
    return bad;
  };

  let live = nTri;
  for (let t = 0; t < nTri; t++) if (!alive[t]) live--;
  let worst = 0;
  while (live > targetTris && heap.length) {
    const { c, v, w } = pop();
    if (gone[v] || gone[w] || !allowed(v, w)) continue;
    // Lazy: the cost was computed before some neighbour moved.
    const now = cost(v, w);
    if (now > c * 1.0001 + 1e-12) { push(now, v, w); continue; }
    if (!neighbours(v).has(w)) continue;
    if (flips(v, w)) continue;

    gone[v] = 1;
    worst = Math.max(worst, Math.sqrt(Math.max(0, now)));
    pos[v * 3] = pos[w * 3]; pos[v * 3 + 1] = pos[w * 3 + 1]; pos[v * 3 + 2] = pos[w * 3 + 2];
    for (let k = 0; k < 10; k++) Q[w * 10 + k] += Q[v * 10 + k];
    for (const t of tris[v]) {
      if (!alive[t]) continue;
      const a = idx[t * 3], b = idx[t * 3 + 1], cc = idx[t * 3 + 2];
      if (a === w || b === w || cc === w) { alive[t] = 0; live--; continue; }
      for (let k = 0; k < 3; k++) if (idx[t * 3 + k] === v) idx[t * 3 + k] = w;
      tris[w].push(t);
      const l = nrmOf(t, tmp);
      if (l > EPS) {
        triNrm[t * 3] = tmp[0] / l; triNrm[t * 3 + 1] = tmp[1] / l; triNrm[t * 3 + 2] = tmp[2] / l;
      }
    }
    // The border the collapsed vertex was on is now one link shorter: whatever
    // it was joined to across the open edge is joined to w instead, or the
    // border would fall apart into two loose ends.
    if (edgeMate.has(v)) {
      for (const m2 of edgeMate.get(v)) {
        if (m2 === w) continue;
        edgeMate.get(m2).delete(v);
        edgeMate.get(m2).add(w);
        if (!edgeMate.has(w)) edgeMate.set(w, new Set());
        edgeMate.get(w).add(m2);
      }
      if (edgeMate.has(w)) edgeMate.get(w).delete(v);
      edgeMate.delete(v);
    }
    for (const x of neighbours(w)) {
      if (allowed(w, x)) push(cost(w, x), w, x);
      if (allowed(x, w)) push(cost(x, w), x, w);
    }
  }

  // Compact: keep the vertices something still points at.
  const remap = new Int32Array(n).fill(-1);
  const outIdx = [];
  for (let t = 0; t < nTri; t++) {
    if (!alive[t]) continue;
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    for (const v of [a, b, c]) if (remap[v] < 0) remap[v] = 0;
    outIdx.push(a, b, c);
  }
  let count = 0;
  for (let v = 0; v < n; v++) if (remap[v] === 0) remap[v] = count++;
  const take = (src, size) => {
    const out = new Float32Array(count * size);
    for (let v = 0; v < n; v++) {
      if (remap[v] < 0) continue;
      for (let k = 0; k < size; k++) out[remap[v] * size + k] = src[v * size + k];
    }
    return out;
  };
  return {
    pos: take(mesh.pos, 3), nrm: take(mesh.nrm, 3), uv: take(mesh.uv, 2),
    bone: take(mesh.bone, 2), wt: take(mesh.wt, 2), mat: take(mesh.mat, 1),
    ao: mesh.ao ? take(mesh.ao, 1) : null,
    idx: outIdx.map((v) => remap[v]),
    count,
    worst,
  };
}

// How far the new surface sits from the old one, in millimetres: for a sample
// of the original's vertices, the distance to the nearest point on any of the
// new triangles. This is the number that says whether a decimation is honest —
// a triangle count on its own says nothing about whether he is still the same
// man.
export function deviation(before, after, samples = 4000) {
  const grid = new Map();
  const CELL = 0.03;
  const key = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  const tris = after.idx.length / 3;
  for (let t = 0; t < tris; t++) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++) {
      const v = after.idx[t * 3 + c] * 3;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], after.pos[v + k]);
        hi[k] = Math.max(hi[k], after.pos[v + k]);
      }
    }
    for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) {
      for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++) {
        for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++) {
          const k = `${x},${y},${z}`;
          let b = grid.get(k);
          if (!b) grid.set(k, b = []);
          b.push(t);
        }
      }
    }
  }
  // Point to triangle, the standard region walk written out flat.
  const dist2 = (px, py, pz, t) => {
    const a = after.idx[t * 3] * 3, b = after.idx[t * 3 + 1] * 3, c = after.idx[t * 3 + 2] * 3;
    const ax = after.pos[a], ay = after.pos[a + 1], az = after.pos[a + 2];
    const abx = after.pos[b] - ax, aby = after.pos[b + 1] - ay, abz = after.pos[b + 2] - az;
    const acx = after.pos[c] - ax, acy = after.pos[c + 1] - ay, acz = after.pos[c + 2] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    let u = 0, v = 0;
    if (d1 > 0 || d2 > 0) {
      const a00 = abx * abx + aby * aby + abz * abz;
      const a01 = abx * acx + aby * acy + abz * acz;
      const a11 = acx * acx + acy * acy + acz * acz;
      const det = a00 * a11 - a01 * a01;
      if (Math.abs(det) > EPS) {
        u = (a11 * d1 - a01 * d2) / det;
        v = (a00 * d2 - a01 * d1) / det;
        if (u < 0) { u = 0; v = Math.max(0, Math.min(1, d2 / Math.max(a11, EPS))); }
        else if (v < 0) { v = 0; u = Math.max(0, Math.min(1, d1 / Math.max(a00, EPS))); }
        else if (u + v > 1) {
          const s = (a11 - a01 - d2 + d1) / Math.max(a00 - 2 * a01 + a11, EPS);
          u = Math.max(0, Math.min(1, s));
          v = 1 - u;
        }
      }
    }
    const qx = ax + abx * u + acx * v, qy = ay + aby * u + acy * v, qz = az + abz * u + acz * v;
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  };
  const nV = before.pos.length / 3;
  const step = Math.max(1, Math.floor(nV / samples));
  let worst = 0, sum = 0, seen = 0;
  for (let v = 0; v < nV; v += step) {
    const px = before.pos[v * 3], py = before.pos[v * 3 + 1], pz = before.pos[v * 3 + 2];
    let best = Infinity;
    for (let r = 0; r <= 3 && best === Infinity; r++) {
      for (let z = -r; z <= r; z++) {
        for (let y = -r; y <= r; y++) {
          for (let x = -r; x <= r; x++) {
            const b = grid.get(key(px + x * CELL, py + y * CELL, pz + z * CELL));
            if (!b) continue;
            for (const t of b) best = Math.min(best, dist2(px, py, pz, t));
          }
        }
      }
    }
    if (!isFinite(best)) continue;
    const d = Math.sqrt(best);
    worst = Math.max(worst, d);
    sum += d;
    seen++;
  }
  return { worst, mean: seen ? sum / seen : 0, seen };
}
