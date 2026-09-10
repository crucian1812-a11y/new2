// Which transitions are the pair turning as one.
//
// A sweep is not two men rotating; it is one tangle rolling over. The rig
// interpolates each root's attitude on its own and walks the two positions
// towards each other in straight lines, and the question this answers is where
// that description is furthest from what is happening: if both roots turn a
// long way and turn the same way, the movement is a roll and the straight line
// between the two positions cuts the corner.
//
// It is a report and not a check. Nothing here has a line to pass; it names
// the seven transitions where a shared frame would be worth trying — which was
// tried, and measured worse. See PLAN.md, «Общий кадр пары на свипе».
//
//   node bjj/tools/roll-check.mjs
import { POSES } from '../src/game/poses.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { qEuler, qMul, quat } from '../src/core/m4.js';

const conj = (o, a) => { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; o[3] = a[3]; return o; };
const deg = (q) => (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
const _a = quat(), _b = quat(), _c = quat(), _d = quat();

// What one root does between two poses: q1 · conj(q0).
function turn(id0, id1, role) {
  qEuler(_a, ...POSES[id0][role].root.r);
  qEuler(_b, ...POSES[id1][role].root.r);
  qMul(_c, _b, conj(_d, _a));
  return quat(_c[0], _c[1], _c[2], _c[3]);
}

const rows = [];
const seen = new Set();
for (const tr of TRANSITIONS) {
  for (const to of visualEnds(tr)) {
    const key = `${tr.from}>${to}`;
    if (tr.from === to || seen.has(key)) continue;
    seen.add(key);
    const RA = turn(tr.from, to, 'A'), RB = turn(tr.from, to, 'B');
    qMul(_c, RB, conj(_d, RA));
    rows.push({ key, a: deg(RA), b: deg(RB), apart: deg(_c) });
  }
}
rows.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b));

console.log('transition                     A turns  B turns   they differ by');
for (const r of rows.slice(0, 14)) {
  console.log(`${r.key.padEnd(30)}${r.a.toFixed(0).padStart(6)}°${r.b.toFixed(0).padStart(9)}°` +
    `${r.apart.toFixed(0).padStart(14)}°`);
}
const rolls = rows.filter((r) => Math.min(r.a, r.b) > 40);
const together = rolls.filter((r) => r.apart < 60);
console.log(`\n${rows.length} transitions, ${rolls.length} turn a root more than 40°, ` +
  `${together.length} of those turn both of them nearly the same way:`);
console.log(`     ${together.map((r) => r.key).join(', ')}`);
