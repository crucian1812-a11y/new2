// Loading a baked fighter.
//
// The file is written by tools/bake-fighter.mjs and holds exactly the vertex
// format the skinning shader already consumes, so a baked character is a
// drop-in replacement for the procedural one — nothing downstream of here knows
// which it got.
//
// Quantised on purpose: positions to 16 bits inside the mesh's own bounding
// box, normals to bytes, one weight byte per vertex because the second weight
// is whatever is left. That is about a third of the size of the float version
// and the difference is invisible on a 1.7 m body at arm's length.

const MAGIC = 0x464a4a42; // 'BJJF' little-endian

export async function loadFighter(url) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return decodeFighter(await res.arrayBuffer());
}

export function decodeFighter(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a baked fighter');
  const version = dv.getUint16(4, true);
  if (version !== 1 && version !== 2) throw new Error(`fighter asset version ${version} not supported`);
  const n = dv.getUint32(8, true);
  const idxCount = dv.getUint32(12, true);
  const minX = dv.getFloat32(16, true), minY = dv.getFloat32(20, true), minZ = dv.getFloat32(24, true);
  const maxX = dv.getFloat32(28, true), maxY = dv.getFloat32(32, true), maxZ = dv.getFloat32(36, true);
  const uvMax = dv.getFloat32(40, true);

  let o = 48;
  const pos = new Float32Array(n * 3);
  const sx = (maxX - minX) / 65535, sy = (maxY - minY) / 65535, sz = (maxZ - minZ) / 65535;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = minX + dv.getUint16(o, true) * sx;
    pos[i * 3 + 1] = minY + dv.getUint16(o + 2, true) * sy;
    pos[i * 3 + 2] = minZ + dv.getUint16(o + 4, true) * sz;
    o += 6;
  }
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    nrm[i] = dv.getInt8(o) / 127;
    o += 1;
  }
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n * 2; i++) {
    uv[i] = (dv.getInt16(o, true) / 32767) * uvMax;
    o += 2;
  }
  const bone = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    bone[i * 2] = dv.getUint8(o);
    bone[i * 2 + 1] = dv.getUint8(o + 1);
    o += 2;
  }
  const wt = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const w = dv.getUint8(o) / 255;
    wt[i * 2] = w;
    wt[i * 2 + 1] = 1 - w;
    o += 1;
  }
  const mat = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mat[i] = dv.getUint8(o);
    o += 1;
  }
  // Baked ambient occlusion, from version 2 on. A version 1 file — one still
  // sitting in somebody's cache — loads and is lit exactly as it was, which is
  // the whole reason the old version is still read rather than rejected.
  const ao = new Float32Array(n);
  if (version >= 2) {
    for (let i = 0; i < n; i++) {
      ao[i] = dv.getUint8(o) / 255;
      o += 1;
    }
  } else {
    ao.fill(1);
  }
  const idx = new Uint16Array(idxCount);
  for (let i = 0; i < idxCount; i++) {
    idx[i] = dv.getUint16(o, true);
    o += 2;
  }
  return { pos, nrm, uv, bone, wt, mat, ao, idx, count: idxCount };
}
