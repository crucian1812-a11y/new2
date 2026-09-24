// Does the cloth the baker builds face out of the man?
//
// The baker makes three pieces of the gi from nothing — the belt, the skirt
// under it and the collar — as rows of vertices joined into triangles, and a
// triangle faces whichever way its corners are wound. The fighters are drawn
// from both sides, so a piece wound the wrong way is not missing: it is there,
// lit from inside the man, with its occlusion baked into the jacket behind it.
// The belt was like that and the collar was like that, on both fighters, from
// the day each was written. A white belt came out as dark as a black one; the
// lapel's shading was tuned by eye and by gi-check against a strip that was
// lit backwards.
//
// This reads the baked files and asks the stored normals directly. Out means
// away from the body's own vertical axis:
//
//   пояс     the back half of the belt (the front carries the knot and the
//            ends, which are slabs with a back face each, so half of theirs
//            face in by right)
//   ворот    both strips of the collar, which lie on the chest
//
// Every one of those vertices has to face out.
//
//   node bjj/tools/cloth-check.mjs

import { readFileSync } from 'fs';
import { decodeFighter } from '../src/render/asset.js';

const FILES = ['bjj/assets/fighter.bin', 'bjj/assets/fighter-b.bin'];

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

for (const file of FILES) {
  const m = decodeFighter(readFileSync(file).buffer.slice(0));
  const facing = (keep) => {
    let out = 0, n = 0;
    for (let v = 0; v < m.mat.length; v++) {
      if (!keep(v)) continue;
      const x = m.pos[v * 3], z = m.pos[v * 3 + 2];
      const r = Math.hypot(x, z);
      if (r < 1e-3) continue;
      n++;
      if ((m.nrm[v * 3] * x + m.nrm[v * 3 + 2] * z) / r > 0) out++;
    }
    return { out, n };
  };
  const name = file.split('/').pop();
  const belt = facing((v) => m.mat[v] === 3 && m.pos[v * 3 + 2] < -0.02);
  check(belt.n > 0 && belt.out === belt.n, `${name}: пояс faces out`,
    `${belt.out} of ${belt.n} vertices on the back half`);
  const collar = facing((v) => m.mat[v] === 4);
  check(collar.n > 0 && collar.out === collar.n, `${name}: ворот faces out`,
    `${collar.out} of ${collar.n} vertices`);
}
console.log(fail ? `\n${fail} check(s) failed` : '\nthe cloth faces out');
process.exitCode = fail ? 1 : 0;
