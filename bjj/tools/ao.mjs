// How much of the sky each vertex can see, computed once and baked into the file.
//
// The renderer's ambient term is a hemisphere — bright from the ceiling, the
// mat's colour from below — and until now every vertex got all of it. That is
// what makes a face read as a mannequin at the distance this game is played:
// an eye socket is a two-centimetre cavity, and a cavity is dark for one
// reason only, which is that most of the room cannot see into it. No amount of
// drawing features onto the skin replaces that, and the geometry was already
// there — nobody was asking it the question.
//
// So the question is asked here, offline, once per character: from each vertex,
// throw rays over the hemisphere around its normal and count how many get out.
// Binary, with a reach of a quarter of a metre — long enough for a brow to
// shade a socket, an arm to shade an armpit and a chin to shade a throat,
// short enough that a man standing straight does not occlude his own knees.
//
// Baked in the bind pose, which is the usual compromise: an armpit that opens
// when the arm comes up stays as dark as it was when it was closed. For a head
// — which is rigid, and which is what this was written for — it is exact.

// A uniform grid over the triangles, so a ray only tests what is near it.
function grid(pos, idx, cell) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[i + k]);
      hi[k] = Math.max(hi[k], pos[i + k]);
    }
  }
  for (let k = 0; k < 3; k++) { lo[k] -= cell; hi[k] += cell; }
  const dim = [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k] - lo[k]) / cell)));
  const buckets = new Array(dim[0] * dim[1] * dim[2]);
  const at = (x, y, z) => (z * dim[1] + y) * dim[0] + x;
  for (let t = 0; t < idx.length; t += 3) {
    const tl = [Infinity, Infinity, Infinity], th = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++) {
      const v = idx[t + c] * 3;
      for (let k = 0; k < 3; k++) {
        tl[k] = Math.min(tl[k], pos[v + k]);
        th[k] = Math.max(th[k], pos[v + k]);
      }
    }
    const a = [0, 1, 2].map((k) => Math.max(0, Math.floor((tl[k] - lo[k]) / cell)));
    const b = [0, 1, 2].map((k) => Math.min(dim[k] - 1, Math.floor((th[k] - lo[k]) / cell)));
    for (let z = a[2]; z <= b[2]; z++) {
      for (let y = a[1]; y <= b[1]; y++) {
        for (let x = a[0]; x <= b[0]; x++) {
          const k = at(x, y, z);
          (buckets[k] || (buckets[k] = [])).push(t);
        }
      }
    }
  }
  return { lo, dim, cell, buckets, at };
}

// Möller–Trumbore, any hit, front and back faces alike: a shell whose winding
// disagrees with itself in a few places still occludes.
function hits(pos, idx, t, ox, oy, oz, dx, dy, dz, maxT) {
  const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
  const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
  const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const tx = ox - pos[a], ty = oy - pos[a + 1], tz = oz - pos[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return s > 1e-5 && s < maxT;
}

// Walk the grid along the ray and stop at the first triangle in the way.
function blocked(g, pos, idx, o, d, maxT) {
  const { lo, dim, cell, buckets, at } = g;
  const c = [0, 1, 2].map((k) => Math.floor((o[k] - lo[k]) / cell));
  for (let k = 0; k < 3; k++) if (c[k] < 0 || c[k] >= dim[k]) return false;
  const step = [0, 0, 0], tMax = [0, 0, 0], tDelta = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) { step[k] = 0; tMax[k] = Infinity; tDelta[k] = Infinity; continue; }
    step[k] = d[k] > 0 ? 1 : -1;
    const edge = lo[k] + (c[k] + (d[k] > 0 ? 1 : 0)) * cell;
    tMax[k] = (edge - o[k]) / d[k];
    tDelta[k] = cell / Math.abs(d[k]);
  }
  for (let guard = 0; guard < 4096; guard++) {
    const b = buckets[at(c[0], c[1], c[2])];
    if (b) for (let i = 0; i < b.length; i++) {
      if (hits(pos, idx, b[i], o[0], o[1], o[2], d[0], d[1], d[2], maxT)) return true;
    }
    const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    if (tMax[k] > maxT) return false;
    c[k] += step[k];
    if (c[k] < 0 || c[k] >= dim[k]) return false;
    tMax[k] += tDelta[k];
  }
  return false;
}

export function vertexAO(pos, nrm, idx, opts = {}) {
  const RAYS = opts.rays || 32;
  const REACH = opts.reach || 0.25;
  const n = pos.length / 3;
  const g = grid(pos, idx, opts.cell || 0.04);
  const ao = new Float32Array(n);

  // Cosine-distributed directions on the hemisphere, from a golden-angle
  // spiral rather than from a random generator: the same character bakes to
  // the same file twice, and a tool that has to be re-run to be believed is
  // not a measurement.
  const dirs = [];
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < RAYS; i++) {
    const z = Math.sqrt((i + 0.5) / RAYS);      // cosine weighting
    const r = Math.sqrt(1 - z * z);
    const a = i * GOLD;
    dirs.push([Math.cos(a) * r, Math.sin(a) * r, z]);
  }

  const o = [0, 0, 0], d = [0, 0, 0];
  for (let v = 0; v < n; v++) {
    let nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-6) { ao[v] = 1; continue; }
    nx /= nl; ny /= nl; nz /= nl;
    // A frame around the normal, built from whichever axis is least like it.
    let ux = 0, uy = 0, uz = 0;
    if (Math.abs(nx) < 0.7) { ux = 1; } else { uy = 1; }
    let tx = uy * nz - uz * ny, ty = uz * nx - ux * nz, tz = ux * ny - uy * nx;
    const tl = Math.hypot(tx, ty, tz);
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    // Off the surface by a hair, or every ray starts inside its own triangle.
    o[0] = pos[v * 3] + nx * 1e-3;
    o[1] = pos[v * 3 + 1] + ny * 1e-3;
    o[2] = pos[v * 3 + 2] + nz * 1e-3;
    let open = 0;
    for (let i = 0; i < RAYS; i++) {
      const dd = dirs[i];
      d[0] = tx * dd[0] + bx * dd[1] + nx * dd[2];
      d[1] = ty * dd[0] + by * dd[1] + ny * dd[2];
      d[2] = tz * dd[0] + bz * dd[1] + nz * dd[2];
      if (!blocked(g, pos, idx, o, d, REACH)) open++;
    }
    ao[v] = open / RAYS;
  }
  return ao;
}
