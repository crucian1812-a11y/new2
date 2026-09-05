// Is the skin torn anywhere?
//
// Everything else here measures where a body is: how deep two of them overlap,
// how far a limb is off the mat, how fast a joint moved. Nothing asked whether
// the surface itself is being pulled apart, and a player found two places at
// once that nobody had a number for — "выросты пошли от кистей", splinters off
// the knuckles, and a sail of trouser strung between the thighs that nobody
// had even mentioned because it reads as shadow until the legs open.
//
// Two measures, because they catch different faults:
//
//   area   a triangle many times its bind area is a sheet being stretched —
//          the crotch web, 118 square centimetres of it in BACK_WORK.
//   edge   a triangle drawn out into a needle gains area modestly and reads as
//          a spike. The hands measured 7x on area, which sounds small, and 6.2x
//          on an edge with the longest at 43mm — half the width of the hand.
//
// The edge one is the one that matches what the eye calls a growth, and it was
// only found because the area version disagreed with the picture.
//
//   node bjj/tools/skin-check.mjs           poses, both fighters
//   node bjj/tools/skin-check.mjs --grip    and with the hands closed
import { readFileSync } from 'node:fs';
import { PairRig } from '../src/game/rig.js';
import { POSES } from '../src/game/poses.js';
import { Skeleton, BONES, BONE_INDEX, HAND_GRIP, TIP_GRIP } from '../src/render/skeleton.js';
import { quat, qEuler, qMul } from '../src/core/m4.js';
import { decodeFighter } from '../src/render/asset.js';

const GRIP = process.argv.includes('--grip');
const NAMES = BONES.map((b) => b[0]);
let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// Two lines each, the way blend-check has them: one you may not ship past and
// one that puts it on the work list.
//
// The work-list lines come from what the two fixed faults measure now — the
// hands 3.8x on an edge, the worst sheet 29 square centimetres — so anything
// worse than that is something nobody has looked at. The ship lines are set
// above what is left, because what is left is not a fault of the same kind:
// a trouser crotch between a deeply folded thigh and the pelvis stretches in
// linear blend skinning however the weights are arranged, and that is a
// smoothing pass over the weights, not a sewing mistake. Named in the work
// list with its number rather than hidden under a line drawn to fit it.
const EDGE = 5.0, EDGE_FAIL = 25;
const AREA_CM2 = 45, AREA_FAIL = 80;

const load = (n) => {
  const r = readFileSync(new URL(`../assets/${n}`, import.meta.url));
  return decodeFighter(r.buffer.slice(r.byteOffset, r.byteOffset + r.length));
};
const MESH = { A: load('fighter.bin'), B: load('fighter-b.bin') };
const area = (p, i, j, k) => {
  const ax = p[j*3]-p[i*3], ay = p[j*3+1]-p[i*3+1], az = p[j*3+2]-p[i*3+2];
  const bx = p[k*3]-p[i*3], by = p[k*3+1]-p[i*3+1], bz = p[k*3+2]-p[i*3+2];
  return Math.hypot(ay*bz-az*by, az*bx-ax*bz, ax*by-ay*bx) * 0.5;
};
const edge = (p, a, b) => Math.hypot(p[a*3]-p[b*3], p[a*3+1]-p[b*3+1], p[a*3+2]-p[b*3+2]);
function skinAll(m, sk, out) {
  const n = m.pos.length / 3;
  for (let v = 0; v < n; v++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 2; k++) {
      const w = m.wt[v*2+k]; if (w <= 0) continue;
      const s = sk.skin.subarray(m.bone[v*2+k]*16, m.bone[v*2+k]*16+16);
      const px = m.pos[v*3], py = m.pos[v*3+1], pz = m.pos[v*3+2];
      x += w*(s[0]*px+s[4]*py+s[8]*pz+s[12]);
      y += w*(s[1]*px+s[5]*py+s[9]*pz+s[13]);
      z += w*(s[2]*px+s[6]*py+s[10]*pz+s[14]);
    }
    out[v*3] = x; out[v*3+1] = y; out[v*3+2] = z;
  }
}
// Bind, measured rather than assumed: the file's positions are the bind pose,
// but skinning them through an identity skeleton is what the posed numbers are
// compared against, so both sides go through the same code.
const BIND = {}, BINDA = {}, WORK = {};
for (const r of ['A', 'B']) {
  const m = MESH[r];
  const sk = new Skeleton(); sk.pose();
  BIND[r] = new Float64Array(m.pos.length);
  skinAll(m, sk, BIND[r]);
  BINDA[r] = new Float64Array(m.idx.length / 3);
  for (let t = 0; t < BINDA[r].length; t++)
    BINDA[r][t] = area(BIND[r], m.idx[t*3], m.idx[t*3+1], m.idx[t*3+2]);
  WORK[r] = new Float64Array(m.pos.length);
}

const rig = new PairRig(); rig.live = false;
let worstArea = { v: 0 }, worstEdge = { v: 0 };
const scan = (role, label) => {
  const m = MESH[role], p = WORK[role];
  for (let t = 0; t < BINDA[role].length; t++) {
    const tri = [m.idx[t*3], m.idx[t*3+1], m.idx[t*3+2]];
    const b = BINDA[role][t];
    if (b > 1e-9) {
      const a = area(p, tri[0], tri[1], tri[2]);
      if (a / b > 6 && a > worstArea.v) worstArea = { v: a, ratio: a/b, label,
        bones: [...new Set(tri.map(x => m.bone[x*2]))].map(x => NAMES[x]).join('+') };
    }
    for (const [x, y] of [[0,1],[1,2],[2,0]]) {
      const e0 = edge(BIND[role], tri[x], tri[y]);
      if (e0 < 1e-6) continue;
      const r = edge(p, tri[x], tri[y]) / e0;
      if (r > worstEdge.v) worstEdge = { v: r, label, mm: edge(p, tri[x], tri[y]) * 1000,
        bones: [NAMES[m.bone[tri[x]*2]], NAMES[m.bone[tri[y]*2]]].join('->') };
    }
  }
};

for (const id of Object.keys(POSES)) {
  rig.rewind(); rig.applyAt(id, id, 1, 0.016);
  for (const role of ['A', 'B']) { skinAll(MESH[role], rig.skel[role], WORK[role]); scan(role, id); }
}
// And the hands closed, which is where a match spends its time and which no
// pose on its own reaches.
if (GRIP) {
  const _q = quat();
  const add = (sk, b, x) => { const i = BONE_INDEX[b]; if (i === undefined) return;
    qEuler(_q, x, 0, 0); qMul(sk.local[i], sk.local[i], _q); };
  for (const role of ['A', 'B']) {
    const sk = new Skeleton();
    for (const b of ['fingL', 'fingR']) add(sk, b, -HAND_GRIP);
    for (const b of ['handLTip', 'handRTip']) add(sk, b, -TIP_GRIP);
    sk.pose();
    skinAll(MESH[role], sk, WORK[role]);
    scan(role, 'a closed hand');
  }
}

console.log(`\n${Object.keys(POSES).length} poses x 2 fighters${GRIP ? ', plus a hand at full grip' : ''}\n`);
check(worstEdge.v < EDGE_FAIL, 'no edge is drawn out into a spike',
  `worst ${worstEdge.v.toFixed(1)}x (${worstEdge.bones}) in ${worstEdge.label}, ` +
  `${worstEdge.mm.toFixed(0)}mm long (work list ${EDGE}x, cannot ship ${EDGE_FAIL}x)`);
check(worstArea.v * 1e4 < AREA_FAIL, 'no triangle is stretched into a sheet',
  worstArea.v ? `worst ${(worstArea.v*1e4).toFixed(0)}cm2 at ${worstArea.ratio.toFixed(0)}x (${worstArea.bones}) in ${worstArea.label} ` +
                `(work list ${AREA_CM2}cm2, cannot ship ${AREA_FAIL}cm2)`
              : 'nothing past six times its bind area');
const work = [];
if (worstEdge.v >= EDGE) work.push(`${worstEdge.bones} in ${worstEdge.label} at ${worstEdge.v.toFixed(1)}x`);
if (worstArea.v * 1e4 >= AREA_CM2) work.push(`${worstArea.bones} in ${worstArea.label} at ${(worstArea.v*1e4).toFixed(0)}cm2`);
if (work.length) console.log(`\n     work list: ${work.join('; ')}`);
console.log(`\n${fail ? `${fail} check(s) failed` : 'the skin holds together'}`);
process.exitCode = fail ? 1 : 0;
