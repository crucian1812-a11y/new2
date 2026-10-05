// Write into a pose the limb the rig already builds for it.
//
// seam-check found poses whose gripping arm (or planted leg) is one thing in
// poses.js and another after the rig is done with it: the grip's two-bone
// solve takes the hand from where the pose has it, sometimes a quarter of a
// metre away, to where it holds. At exactly t = 0 that solve lands on one
// side of the shoulder–hand line; a thousandth of the way into any blend it
// lands on the other, because the line it measures the elbow's side across is
// nearly the authored upper arm itself and the smallest movement turns it
// round (HANDOFF, «Из круга, где поза оказалась на шве»).
//
// The pose that pose-check judged is the one at t = 0, and it is the one worth
// keeping. So this does not search anything: it reads the limb the rig built
// at t = 0 — after the grips, the feet and the hinge clean-up — and writes its
// angles into the pose. At t = 0 nothing moves; the grip solve now starts
// from where it ends, the line is the limb's own, and the paths out of the
// pose start on the branch the pose was judged on.
//
//   node bjj/tools/seam-bake.mjs SIDE_CONTROL:B:L:arm OPEN_GUARD:A:R:arm ...
//   node bjj/tools/seam-bake.mjs SIDE_CONTROL:B:L:arm:SIDE_CONTROL_WORK
//   node bjj/tools/seam-bake.mjs ... --write
//
// A limb is POSE:ROLE:SIDE:arm|leg, and with a fifth field the limb is read a
// thousandth of the way towards that pose instead of at t = 0 — the branch
// every path out of the pose is on, which is what the game shows. Which of
// the two to keep is a measurement, not a rule: at side control the branch
// judged at t = 0 has B's shoulder turned 117°, past what a shoulder turns,
// and baking it put hinge-check's shoulders from 431 to 1037.
//
// A limb is POSE:ROLE:SIDE:arm|leg[:VIA]. A mirror (_X) is built from its base, so
// it is baked through the base.

import { readFileSync, writeFileSync } from 'node:fs';
import { PairRig } from '../src/game/rig.js';
import { POSES } from '../src/game/poses.js';
import { BONE_INDEX, quatFromMat } from '../src/render/skeleton.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { HOLD_LOOPS } from '../src/game/poses.js';

const WRITE = process.argv.includes('--write');
const LIMBS = process.argv.slice(2).filter((a) => !a.startsWith('-')).map((a) => {
  const [id, role, s, kind, via] = a.split(':');
  if (!POSES[id] || !['A', 'B'].includes(role) || !['L', 'R'].includes(s) || !['arm', 'leg'].includes(kind)) {
    console.error(`not a limb: ${a}  (POSE:ROLE:SIDE:arm|leg)`);
    process.exit(2);
  }
  if (POSES[id].mirrorOf) {
    console.error(`${id} is a mirror of ${POSES[id].mirrorOf}: bake the base`);
    process.exit(2);
  }
  if (via && !POSES[via]) {
    console.error(`no pose ${via} to lean towards: ${a}`);
    process.exit(2);
  }
  return { id, role, s, via, bones: kind === 'arm' ? ['arm' + s, 'fore' + s] : ['thigh' + s, 'shin' + s] };
});
if (!LIMBS.length) {
  console.error('usage: seam-bake.mjs POSE:ROLE:SIDE:arm|leg ... [--write]');
  process.exit(2);
}

const rig = new PairRig();
rig.live = false;

function at(from, to, t) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.rewind();
  rig.applyAt(from, to, t, 0.016);
}
const head = (role, bone) => {
  const w = rig.skel[role].world[BONE_INDEX[bone]];
  return [w[12], w[13], w[14]];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// qEuler builds Ry·Rx·Rz; the same inverse pose-relax and waypoint-from use,
// with the same choice between the two angle sets that name one rotation.
function eulerYXZ(q) {
  const [x, y, z, w] = q;
  const m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z), m12 = 2 * (y * z - w * x);
  const m02 = 2 * (x * z + w * y), m22 = 1 - 2 * (x * x + y * y), m00 = 1 - 2 * (y * y + z * z);
  const m20 = 2 * (x * z - w * y);
  const ax = Math.asin(Math.max(-1, Math.min(1, -m12)));
  let ay, az;
  if (Math.abs(m12) > 0.9999) { ay = Math.atan2(-m20, m00); az = 0; }
  else { ay = Math.atan2(m02, m22); az = Math.atan2(m10, m11); }
  const d = 180 / Math.PI;
  const wrap = (a) => ((a + 540) % 360) - 180;
  const one = [ax * d, ay * d, az * d];
  const two = [wrap(180 - one[0]), wrap(one[1] + 180), wrap(one[2] + 180)];
  const off = (e) => Math.abs(e[1]) + Math.abs(e[2]);
  return off(two) < off(one) ? two : one;
}

// The blends that leave or reach a pose, and the furthest any bone of this
// limb moves in their first thousandth — what seam-check reports.
const BLENDS = [
  ...TRANSITIONS.flatMap((tr) => visualEnds(tr).map((to) => [tr.from, to])),
  ...Object.entries(HOLD_LOOPS).flatMap(([pos, loop]) => loop.map((v) => [pos, v])),
];
const ends = (id) => {
  const ids = [id, ...Object.keys(POSES).filter((k) => POSES[k].mirrorOf === id)];
  const out = [], seen = new Set();
  for (const [from, to] of BLENDS) {
    const key = `${from}>${to}`;
    if (from === to || seen.has(key)) continue;
    seen.add(key);
    if (ids.includes(from)) out.push([from, to, 0, 0.001]);
    if (ids.includes(to)) out.push([from, to, 1, 0.999]);
  }
  return out;
};
const ALL_BONES = Object.keys(BONE_INDEX);
function seam(id) {
  let worst = 0, where = '';
  for (const [from, to, t0, t1] of ends(id)) {
    at(from, to, t0);
    const a = {};
    for (const role of ['A', 'B']) for (const b of ALL_BONES) a[role + b] = head(role, b);
    at(from, to, t1);
    for (const role of ['A', 'B']) {
      for (const b of ALL_BONES) {
        const d = dist(a[role + b], head(role, b));
        if (d > worst) { worst = d; where = `${role}.${b} on ${from}>${to}`; }
      }
    }
  }
  return { worst, where };
}

const cm = (m) => (m * 100).toFixed(1);
const changed = new Set();
for (const id of new Set(LIMBS.map((l) => l.id))) {
  const mine = LIMBS.filter((l) => l.id === id);
  const before = seam(id);
  // What the pose is at t = 0, every joint of both men, to hold the bake to.
  at(id, id, 1);
  const was = {};
  for (const role of ['A', 'B']) for (const b of ALL_BONES) was[role + b] = head(role, b);
  const q = [0, 0, 0, 1];
  for (const l of mine) {
    // The branch the pose is judged on, or the one every path out of it is
    // on — a thousandth of the way towards a neighbour.
    if (l.via) at(id, l.via, 0.001);
    else at(id, id, 1);
    const sk = rig.skel[l.role];
    for (const bone of l.bones) {
      q.splice(0, 4, ...sk.local[BONE_INDEX[bone]]);
      POSES[id][l.role].j[bone] = eulerYXZ(q).map((v) => Math.round(v * 10) / 10);
    }
  }
  rig.invalidate(id);
  at(id, id, 1);
  let moved = 0, movedWhere = '';
  for (const role of ['A', 'B']) {
    for (const b of ALL_BONES) {
      const d = dist(was[role + b], head(role, b));
      if (d > moved) { moved = d; movedWhere = `${role}.${b}`; }
    }
  }
  const after = seam(id);
  console.log(
    `${id.padEnd(16)} ${mine.map((l) => l.role + '.' + l.bones[0]).join(' ')}   ` +
    `pose moved ${cm(moved)} cm (${movedWhere})   ` +
    `seam ${cm(before.worst)} -> ${cm(after.worst)} cm  ${after.worst > 0.05 ? after.where : ''}`,
  );
  changed.add(id);
}

if (WRITE) {
  const path = new URL('../src/game/poses.js', import.meta.url);
  let src = readFileSync(path, 'utf8');
  for (const id of changed) src = writePose(src, id);
  writeFileSync(path, src);
  console.log(`\nwrote ${changed.size} pose(s) into src/game/poses.js`);
}

// The same in-place rewrite pose-relax and seat-solve do: numbers only, every
// comment and the file's shape left alone.
function writePose(src, id) {
  const start = src.indexOf(`  ${id}: P('${id}', {`);
  if (start < 0) return src;
  const end = brace(src, src.indexOf('{', start));
  let block = src.slice(start, end);
  for (const role of ['A', 'B']) {
    const rs = block.indexOf(`\n    ${role}: {`);
    if (rs < 0) continue;
    const re = brace(block, block.indexOf('{', rs));
    let sec = block.slice(rs, re);
    const P = POSES[id][role];
    for (const bone of Object.keys(P.j)) {
      const rx = new RegExp(`(\\b${bone}: )\\[[^\\]]*\\]`);
      if (rx.test(sec)) sec = sec.replace(rx, `$1[${P.j[bone].map(n1).join(', ')}]`);
    }
    block = block.slice(0, rs) + sec + block.slice(re);
  }
  return src.slice(0, start) + block + src.slice(end);
}
function n1(v) { return (Math.round(v * 10) / 10).toString(); }
function brace(s, i) {
  let d = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) return k + 1; }
  }
  return s.length;
}
