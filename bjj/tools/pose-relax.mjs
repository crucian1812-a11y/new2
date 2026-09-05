// A solver for the paired poses.
//
// Fifteen tangles of two bodies were authored by typing joint angles into a
// file. That works for a solo pose — you can see a standing figure in your head
// — and it does not work at all for two people wrapped around each other, which
// is why the library shipped with forearms through skulls. Nobody can hold a
// hundred and twenty angles and a collision test in their head at once.
//
// So: keep the authored pose as the intent, and let a search make it true.
// Every angle and both root positions can move, by a bounded amount, and the
// cost says what "true" means — bodies out of each other, still touching, still
// on the mat, hands still able to reach their grips, and as close to what was
// authored as all of that allows. The bound is the important part. This is not
// free to invent a pose; it is free to fix one by twenty degrees a joint, and
// what comes out is recognisably the pose that went in.
//
// The search is pattern search — try each coordinate up and down at the current
// step, keep what helps, halve the step when nothing does. No gradients, because
// the cost is full of clamps and IK fades that have none, and no cleverness,
// because the whole thing runs in a couple of seconds.
//
//   node bjj/tools/pose-relax.mjs            report what it would do
//   node bjj/tools/pose-relax.mjs --write    and write it into poses.js

import { readFileSync, writeFileSync } from 'node:fs';
import { PairRig } from '../src/game/rig.js';
import { decodeFighter } from '../src/render/asset.js';
import { skinLite, skinInto } from './skin-lite.mjs';
import { POSES } from '../src/game/poses.js';
import { GRIP_POINTS } from '../src/render/body.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { intentCost } from '../src/game/intent.js';

const WRITE = process.argv.includes('--write');
const ONLY = process.argv.filter((a) => !a.startsWith('-') && POSES[a]);

const MAT_Y = 0.05;
// Two centimetres of squash is contact, not a collision: cloth and flesh give,
// and a pose with no overlap at all is a pose where nobody is touching anybody.
const ALLOW = 0.02;
// How far a joint and a root are allowed to move from what was authored.
const JOINT_LIMIT = +(process.env.JOINT_LIMIT || 22);
const ROOT_LIMIT = +(process.env.ROOT_LIMIT || 0.11);

const rig = new PairRig();
const overlap = new Overlap();
const READ = ['headTop', 'handL', 'handR', 'footL', 'footR', 'hips', 'chest', 'shinL', 'shinR'];

// ------------------------------------------------------- the skin, in a search
//
// Where the floor is and what a limb is resting on are both questions about the
// skin, and this used to answer them with a table of how far the skin hangs
// below each bone — nine numbers, most of them capsule radii, one of them the
// sole measured by hand. It was close enough to get the library onto the mat
// and not close enough to say which shin is floating: weight-check reads eleven
// thousand baked vertices and the table reads nine bones, and for a foot the
// two disagree by five centimetres, which is larger than the thing being
// measured.
//
// So the search reads the skin too. tools/skin-lite.mjs keeps the vertices that
// can ever be the lowest one — four thousand of eleven thousand, exact on the
// whole man and within two millimetres on any single bone — and they skin
// through the same matrices the renderer uses.
const loadMesh = (name) => {
  const raw = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  return decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
};
const LITE = { A: skinLite(loadMesh('fighter.bin')), B: skinLite(loadMesh('fighter-b.bin')) };
const MAXV = Math.max(LITE.A.pos.length, LITE.B.pos.length) / 3;
const SKIN = {
  A: { xyz: new Float64Array(MAXV * 3), who: new Uint16Array(MAXV), low: new Float64Array(26), lowV: new Int32Array(26), n: 0, lowest: 9 },
  B: { xyz: new Float64Array(MAXV * 3), who: new Uint16Array(MAXV), low: new Float64Array(26), lowV: new Int32Array(26), n: 0, lowest: 9 },
};
// Either baked fighter can stand in either role and they differ by up to three
// and a half centimetres where they touch the mat, so weight-check judges each
// role on the one that sits *higher* — the one that would float. The solver
// judges the same man, chosen once per pose rather than once per evaluation.
const MESH_FOR = { A: 'A', B: 'B' };
function pickMeshes(id) {
  rig.invalidate(id);
  rig.rewind();
  rig.apply(id, id, 1, 0.016);
  for (const role of ['A', 'B']) {
    let best = -9, pick = 'A';
    for (const mk of ['A', 'B']) {
      const s = SKIN[role];
      const n = skinInto(LITE[mk], rig.skel[role], s.xyz, s.who);
      let lo = 9;
      for (let v = 0; v < n; v++) if (s.xyz[v * 3 + 1] < lo) lo = s.xyz[v * 3 + 1];
      if (lo > best) { best = lo; pick = mk; }
    }
    MESH_FOR[role] = pick;
  }
}
function skinNow() {
  for (const role of ['A', 'B']) {
    const s = SKIN[role];
    s.n = skinInto(LITE[MESH_FOR[role]], rig.skel[role], s.xyz, s.who);
    s.low.fill(9); s.lowV.fill(-1); s.lowest = 9;
    for (let v = 0; v < s.n; v++) {
      const y = s.xyz[v * 3 + 1];
      if (y < s.lowest) s.lowest = y;
      const b = s.who[v];
      if (y < s.low[b]) { s.low[b] = y; s.lowV[b] = v; }
    }
  }
}

// ---------------------------------------------------------------- the cost

// The full penetration picture, not just the worst of it. Summing every pair
// is what stops the search trading one collision for another: pulling a thigh
// out of a thigh and into a shin leaves the deepest number flat and the sum
// unchanged, so a search on the maximum alone wanders forever.
function penetration(skA, skB) {
  const all = overlap.all(skA, skB);
  let sum = 0, worst = 0, where = null;
  for (const p of all) {
    const over = p.pen - ALLOW;
    if (over > 0) sum += over * over;
    if (p.pen > worst) { worst = p.pen; where = p.where; }
  }
  return { sum, worst, where };
}

// How far each joint may be turned from rest, in degrees. The generous end of
// what a healthy adult does; the same table joint-check judges the result by.
//
// Note what this can and cannot do. The search moves any one joint by at most
// JOINT_LIMIT degrees from where it was authored — that bound is the whole
// reason the solver returns the pose it was given rather than one it invented —
// so it can shave a joint that is a few degrees over and it cannot rescue the
// guillotine's hip, which is thirty-four degrees past what a hip does. Those
// have to be re-authored; this keeps the rest from drifting there.
const ROM_LIMIT = {
  spine: 50, chest: 50, neck: 75, head: 50,
  clavL: 45, clavR: 45,
  armL: 175, armR: 175,
  foreL: 155, foreR: 155,
  handL: 90, handR: 90,
  thighL: 145, thighR: 145,
  shinL: 155, shinR: 155,
  footL: 65, footR: 65,
};

// How far the deepest bit of skin is under the mat, for the report.
function underMat() {
  let worst = 0, where = '';
  for (const role of ['A', 'B']) {
    const s = SKIN[role];
    for (let b = 0; b < 26; b++) {
      if (s.low[b] > 8) continue;
      const under = MAT_Y - s.low[b];
      if (under > worst) { worst = under; where = `${role}.${BONE_NAME[b]}`; }
    }
  }
  return { worst, where };
}
const BONE_NAME = [];
for (const k in BONE_INDEX) BONE_NAME[BONE_INDEX[k]] = k;

// ------------------------------------------------------------ standing up

// The capsules, as collide.js has them, and the segment masses a body is made
// of (Winter). The pair is one system: it may lean on itself as much as it
// likes, but its weight together has to be over the ground it touches, or it
// is a photograph of two people falling.
const CAPS = [
  ['hips', 'spine', 0.190, 0.184, 0.142], ['spine', 'chest', 0.186, 0.212, 0.139],
  ['chest', 'neck', 0.212, 0.112, 0.216], ['neck', 'head', 0.066, 0.078, 0.020],
  ['head', 'headTop', 0.098, 0.086, 0.061],
  ['armL', 'foreL', 0.085, 0.076, 0.028], ['foreL', 'handL', 0.078, 0.070, 0.016],
  ['handL', 'fingL', 0.042, 0.038, 0.006],
  ['armR', 'foreR', 0.085, 0.076, 0.028], ['foreR', 'handR', 0.078, 0.070, 0.016],
  ['handR', 'fingR', 0.042, 0.038, 0.006],
  ['thighL', 'shinL', 0.122, 0.100, 0.100], ['shinL', 'footL', 0.095, 0.075, 0.0465],
  ['footL', 'toeL', 0.050, 0.034, 0.0145],
  ['thighR', 'shinR', 0.122, 0.100, 0.100], ['shinR', 'footR', 0.095, 0.075, 0.0465],
  ['footR', 'toeR', 0.050, 0.034, 0.0145],
];

// The base of support is the skin on the mat, not the capsules near it.
//
// This asked the capsules which of them reached the floor, and a capsule is
// fatter than the man inside it — the hips carry a radius of nineteen
// centimetres. So a torso a hand's breadth in the air counted as standing on
// the mat, the hull of "what is touching" swelled to cover the whole pair, and
// the term read zero where weight-check read twenty: the guillotine's pair
// leans a fifth of a metre outside anything it stands on and this said it was
// fine, every evaluation, for the whole round.
const ON_MAT = 0.03;
function balance(A, B) {
  const pts = [];
  let mx = 0, mz = 0, m = 0;
  for (const sk of [A, B]) {
    for (const [a, b, r0, r1, w] of CAPS) {
      const p = sk.world[BONE_INDEX[a]], q = sk.world[BONE_INDEX[b]];
      mx += ((p[12] + q[12]) / 2) * w;
      mz += ((p[14] + q[14]) / 2) * w;
      m += w;
    }
  }
  for (const role of ['A', 'B']) {
    const s = SKIN[role];
    for (let v = 0; v < s.n; v++) {
      if (s.xyz[v * 3 + 1] <= MAT_Y + ON_MAT) pts.push([s.xyz[v * 3], s.xyz[v * 3 + 2]]);
    }
  }
  if (pts.length < 3 || m <= 0) return 0;
  const c = [mx / m, mz / m];
  // Convex hull of what is on the mat, then how far outside it the weight is.
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  const h = lower.concat(upper);
  if (h.length < 3) return 0;
  let inside = true, best = 9;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    if (ex * (c[1] - a[1]) - ez * (c[0] - a[0]) < 0) inside = false;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * ex + (c[1] - a[1]) * ez) / l2)) : 0;
    best = Math.min(best, Math.hypot(a[0] + ex * t - c[0], a[1] + ez * t - c[1]));
  }
  return inside ? 0 : best;
}

// A head nobody is holding looks at the fight.
//
// Not always true, which is why it is conditional: in a choke from behind the
// head is being cranked and looking away is what is happening. The pose data
// says which — a grip on the neck, the back of the head or the head is a head
// under control — so this reads the rule off the poses instead of somebody
// assigning a direction to each by taste.
//
// Measured with tools/weight-check.mjs before it existed: the man doing knee on
// belly was looking 135 degrees away from the man he was kneeling on, the man
// taking the back 122, side control 103. A head aimed at nothing is the
// cheapest way to make a body look dead.
const HEAD_POINTS = ['neck', 'headBack', 'head', 'chin'];
function headHeld(id, role) {
  for (const g of POSES[id].grips || []) {
    if (g.role === role || g.self) continue;
    if (HEAD_POINTS.includes(g.point)) return true;
  }
  return false;
}
const LOOK_OK = 75;   // degrees off the other man before it starts to cost
function lookCost(id) {
  let c = 0;
  for (const role of ['A', 'B']) {
    if (headHeld(id, role)) continue;
    const sk = rig.skel[role];
    const other = rig.skel[role === 'A' ? 'B' : 'A'];
    const m = sk.world[BONE_INDEX.head];
    const o = other.world[BONE_INDEX.chest];
    const to = [o[12] - m[12], o[13] - m[13], o[14] - m[14]];
    const l = Math.hypot(to[0], to[1], to[2]) || 1;
    const d = (m[8] * to[0] + m[9] * to[1] + m[10] * to[2]) / l;
    const deg = (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
    if (deg > LOOK_OK) c += ((deg - LOOK_OK) / 45) * ((deg - LOOK_OK) / 45);
  }
  return c;
}

// A limb resting on nothing.
//
// Real bodies lie on something or are plainly lifted; the hand's breadth in
// between is what reads as a mannequin frozen mid-step. Measured with
// weight-check, the library had eighteen of them — a shin three centimetres
// over the mat with no floor under it and no other man either.
//
// Two things were wrong with the first version of this, and weight-check had
// both of them too. It measured capsules, which for a foot sit five centimetres
// below the sole, so the solver called "already down" what the measurer called
// "floating" and the count barely moved. And "nothing under it" meant "the
// other man has no point lower than this", which is a fact about the other man:
// a standing man's own feet are under his own shins, and every stance in the
// library read as two floating limbs because nobody asked.
//
// Now it is the column under the limb's lowest skin point — six centimetres
// wide, anything at least a centimetre lower, either man's skin, the limb's own
// excepted. The same question weight-check asks, on the same vertices.
// Solved past the line, not up to it. weight-check calls three centimetres
// "resting on the mat", and a tent that falls to zero exactly there leaves the
// search no reason to go further: after three rounds fifteen of the eighteen
// limbs left were sitting at 3.0 to 3.3, parked on the boundary. The solver's
// floor is a centimetre and a half, so what the measurer accepts has a
// centimetre and a half of margin under it.
const HOVER_LO = 0.015, HOVER_HI = 0.09;
const HOVER_R = 0.06, HOVER_GAP = 0.01;
const HOVER_SEEN = 0.03;   // where weight-check stops calling it resting
const HOVER_BONES = ['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR',
  'foreL', 'foreR', 'handL', 'handR', 'hips'];
const HOVER_IDX = HOVER_BONES.map((b) => BONE_INDEX[b]);
function underneath(s, x, y, z, skip) {
  const n = s.n, xyz = s.xyz, who = s.who;
  for (let v = 0; v < n; v++) {
    if (who[v] === skip) continue;
    if (xyz[v * 3 + 1] > y - HOVER_GAP) continue;
    const dx = xyz[v * 3] - x, dz = xyz[v * 3 + 2] - z;
    if (dx * dx + dz * dz <= HOVER_R * HOVER_R) return true;
  }
  return false;
}
function hoverCost(count = false) {
  let c = 0;
  for (const [me, you] of [['A', 'B'], ['B', 'A']]) {
    const s = SKIN[me], o = SKIN[you];
    for (const b of HOVER_IDX) {
      const low = s.low[b];
      if (low > 8) continue;
      const gap = low - MAT_Y;
      if (gap <= HOVER_LO || gap > HOVER_HI) continue;
      // The printed count is weight-check's question, not the solver's: it uses
      // the line the measurer draws so the two numbers can be read together,
      // while the cost keeps working below it for the margin.
      if (count && gap <= HOVER_SEEN) continue;
      const v = s.lowV[b];
      const x = s.xyz[v * 3], y = s.xyz[v * 3 + 1], z = s.xyz[v * 3 + 2];
      if (underneath(s, x, y, z, b) || underneath(o, x, y, z, -1)) continue;
      // A tent, not a step. The first shape of this was largest at the bottom
      // of the band and zero below it, so every gradient inside the band
      // pointed *up*: a search could only ever find "put it down" by stepping
      // over a cliff, and mostly it lifted instead. This falls to zero at both
      // ends, so a limb three centimetres up is pushed down and a limb eight
      // centimetres up is pushed clear, which is what the sentence says.
      const d = Math.min(gap - HOVER_LO, HOVER_HI - gap);
      c += count ? 1 : d * d;
    }
  }
  return c;
}

function cost(id) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  // The clock *and* the breath. The rig integrates its breathing phase rather
  // than reading it off the clock, so zeroing the clock alone left the phase
  // where the last evaluation had pushed it — and this evaluates a cost tens of
  // thousands of times, sixteen milliseconds of breath each. The chest wandered
  // through a full cycle every four hundred evaluations, which is a search
  // chasing its own wobble: every other tool in the battery already called
  // rewind() for exactly this reason and this one did not.
  rig.rewind();
  rig.apply(id, id, 1, 0.016);
  skinNow();
  const A = rig.skel.A, B = rig.skel.B;

  const pen = penetration(A, B);
  let c = pen.sum * 60;

  // What the position is. Weighted well above the collision term, because a
  // mount that is not a mount is a worse failure than a mount with a knee in
  // a rib, and the search will take the easy way out if it is allowed to.
  c += intentCost(rig.skel, POSES[id].hold) * 400;

  // And a body a person could be in.
  //
  // Nothing here asked whether the joints were possible, and the library has
  // places where they are not: the guillotine's bottom man has a hip flexed 179
  // degrees — the thigh folded flat against him and past — the armbar has a
  // collarbone turned 101, and the turtle has 84 degrees of chest on top of its
  // spine. All authored, all invisible to a cost made of collisions and intent,
  // because a body folded through itself can satisfy both.
  //
  // Measured as the total angle of each joint's own rotation, which is the one
  // number about a rotation that has no second reading — three authored angles
  // do, and tools/joint-check.mjs has the account of how much time that cost.
  for (const role of ['A', 'B']) {
    for (const bone in ROM_LIMIT) {
      const q = rig.skel[role].local[BONE_INDEX[bone]];
      const turn = 2 * Math.acos(Math.min(1, Math.abs(q[3]))) * (180 / Math.PI);
      const over = turn - ROM_LIMIT[bone];
      if (over > 0) c += over * over * 0.02;
    }
  }

  // Under the mat — measured to the skin, not to the bone.
  //
  // This used to compare bone positions with the mat and call it grounded, and
  // a bone is not what anybody sees. The sole sits 8.3 cm below the ankle bone
  // (measured on the baked fighter, tools/weight-check.mjs), so a foot bone
  // resting politely at 5 cm has its sole a hand's breadth inside the floor —
  // which is exactly what the library had: fifteen poses with a limb through
  // the mat, up to nineteen centimetres of it, held up at runtime by a clamp in
  // rig._ground that hauled the ankle back out every frame and folded the knee
  // to do it.
  //
  // It is the baked skin now rather than a table of offsets, bone by bone so
  // that a search fixing one leg still sees the other one. See SKIN above for
  // why nine hand-written numbers were not enough.
  for (const role of ['A', 'B']) {
    const s = SKIN[role];
    for (let b = 0; b < 26; b++) {
      if (s.low[b] > 8) continue;
      const under = MAT_Y - s.low[b];
      if (under > 0) c += under * under * 200;
    }
  }

  // And the weight over the ground.
  //
  // A pair is one system and it may lean on itself as much as it likes, but the
  // two of them together have to be over what they are standing on. Measured
  // with tools/weight-check.mjs, the library had poses as much as 85 cm out —
  // a photograph of two people falling over, which is what "unnatural" means
  // when nobody can say why.
  // Except for a waypoint, which is a moment of movement rather than a position
  // anybody holds: the middle of falling into a guard is a pair whose weight is
  // *supposed* to be outside its base, because that is what falling is.
  if (!POSES[id].waypoint) {
    const out = balance(A, B);
    if (out > 0.12) c += (out - 0.12) * (out - 0.12) * 30;
  }

  // And a head that is looking at something.
  c += lookCost(id) * 6;

  // And nothing hanging in the air an inch off the mat.
  c += hoverCost() * 80;

  // Still a grappling position and not two solos: the closest pair of read
  // points has to stay inside a forearm's length.
  const pos = {};
  for (const role of ['A', 'B']) {
    pos[role] = READ.map((b) => {
      const m = rig.skel[role].world[BONE_INDEX[b]];
      return [m[12], m[13], m[14]];
    });
  }
  let closest = 1e9;
  for (const a of pos.A) for (const b of pos.B) {
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d < closest) closest = d;
  }
  if (POSES[id].label !== 'STANDING') {
    const far = closest - 0.15;
    if (far > 0) c += far * far * 30;
  }

  // Hands that can still reach what they are gripping. Past 90% of reach the
  // rig starts fading the grip out, and a faded grip is a hand floating near a
  // lapel instead of holding it.
  for (const g of POSES[id].grips || []) {
    const sk = rig.skel[g.role];
    const other = rig.skel[g.self ? g.role : g.role === 'A' ? 'B' : 'A'];
    const def = GRIP_POINTS[g.point];
    if (!def) continue;
    const m = other.world[BONE_INDEX[def[0]]];
    const t = [
      m[0] * def[1][0] + m[4] * def[1][1] + m[8] * def[1][2] + m[12],
      m[1] * def[1][0] + m[5] * def[1][1] + m[9] * def[1][2] + m[13],
      m[2] * def[1][0] + m[6] * def[1][1] + m[10] * def[1][2] + m[14],
    ];
    const s = sk.world[BONE_INDEX[g.hand === 'L' ? 'armL' : 'armR']];
    const d = Math.hypot(t[0] - s[12], t[1] - s[13], t[2] - s[14]);
    const over = d - 0.42;
    if (over > 0) c += over * over * 90;
    // Past the arm's own length it is not a stretch, it is a grip the pose has
    // asked for and cannot have — the rig lets go, and a released grip is a
    // hand hanging in the air. Weighted to matter as much as a limb inside a
    // body, because it looks about as wrong.
    const impossible = d - 0.5;
    if (impossible > 0) c += impossible * impossible * 700;
  }

  // A straight arm. Nothing in grappling holds an arm locked out except an arm
  // that is being locked out, so outside a joint attack it always reads as the
  // rig having given up. pose-check calls it at 51.5 cm; this leaves a margin.
  if (POSES[id].submission !== 'joint') {
    for (const role of ['A', 'B']) {
      const sk = rig.skel[role];
      for (const [hand, sh] of [['handL', 'armL'], ['handR', 'armR']]) {
        const a = sk.world[BONE_INDEX[sh]];
        const h = sk.world[BONE_INDEX[hand]];
        const d = Math.hypot(h[12] - a[12], h[13] - a[13], h[14] - a[14]);
        const over = d - 0.485;
        if (over > 0) c += over * over * 120;
      }
    }
  }

  return { c, pen };
}

// ------------------------------------------------------------ the unknowns

// Every authored angle and both root positions, flattened. Bones are touched
// in place in POSES, so the rig sees the change with no plumbing at all — the
// pose cache has to be told, and that is the whole of the wiring.
function unknowns(id) {
  const u = [];
  for (const role of ['A', 'B']) {
    const P = POSES[id][role];
    for (const bone of Object.keys(P.j)) {
      for (let k = 0; k < 3; k++) {
        u.push({ role, bone, k, get: () => P.j[bone][k], set: (v) => { P.j[bone][k] = v; },
          orig: P.j[bone][k], limit: JOINT_LIMIT, scale: 1 });
      }
    }
    for (let k = 0; k < 3; k++) {
      u.push({ role, bone: 'root', k, get: () => P.root.p[k], set: (v) => { P.root.p[k] = v; },
        orig: P.root.p[k], limit: ROOT_LIMIT, scale: 0.005 });
    }
  }
  return u;
}

// A joint that has moved is a joint that no longer looks like what was drawn,
// so the search pays for every degree it spends.
function deviation(u) {
  let d = 0;
  for (const x of u) {
    const off = (x.get() - x.orig) / x.scale;
    d += off * off;
  }
  return d * 2.2e-5;
}

// The authored numbers of one pose, and putting them back.
function snapshot(id) {
  const P = POSES[id];
  const out = {};
  for (const role of ['A', 'B']) {
    out[role] = { p: P[role].root.p.slice(), r: P[role].root.r.slice(), j: {} };
    for (const b in P[role].j) out[role].j[b] = P[role].j[b].slice();
  }
  return out;
}
function restore(id, snap) {
  const P = POSES[id];
  for (const role of ['A', 'B']) {
    for (let i = 0; i < 3; i++) {
      P[role].root.p[i] = snap[role].p[i];
      P[role].root.r[i] = snap[role].r[i];
    }
    for (const b in snap[role].j) {
      for (let i = 0; i < 3; i++) P[role].j[b][i] = snap[role].j[b][i];
    }
  }
  rig.invalidate(id);
}

function relax(id) {
  const u = unknowns(id);
  rig.invalidate(id);
  let best = cost(id).c + deviation(u);

  let step = 6;
  while (step > 0.4) {
    let moved = false;
    for (const x of u) {
      for (const dir of [1, -1]) {
        const was = x.get();
        const next = was + dir * step * x.scale;
        if (Math.abs(next - x.orig) > x.limit) continue;
        x.set(next);
        rig.invalidate(id);
        const now = cost(id).c + deviation(u);
        if (now < best - 1e-9) {
          best = now;
          moved = true;
          break;
        }
        x.set(was);
      }
    }
    rig.invalidate(id);
    if (!moved) step *= 0.5;
  }
  return best;
}

// -------------------------------------------------------------------- run

const ids = (ONLY.length ? ONLY : Object.keys(POSES));
const changed = [];
for (const id of ids) {
  pickMeshes(id);
  const before = cost(id).pen;
  const matBefore = underMat();
  const balBefore = balance(rig.skel.A, rig.skel.B);
  const lookBefore = lookCost(id);
  const hovBefore = hoverCost();
  const hangBefore = hoverCost(true);
  // What the pose was, so a search that trades can be refused.
  //
  // The sixth time this project learns the same sentence. arc-solve has a
  // guard that says an answer may not be worse on any number anybody ships on;
  // pose-relax had none, and the moment a balance term joined its cost it
  // started paying for balance with overlap — turtle went from five
  // centimetres of overlap to nine and from two centimetres of weight outside
  // its base to twelve, and the total cost went down, which is exactly what a
  // total is for and exactly why a total is not enough.
  const undo = snapshot(id);
  relax(id);
  let after = cost(id).pen;
  let matAfter = underMat();
  let balAfter = balance(rig.skel.A, rig.skel.B);
  let lookAfter = lookCost(id);
  let hovAfter = hoverCost();
  let kept = false;
  // Half a centimetre of slack on each, and not because strictness is
  // uncomfortable: with an exact comparison the guard threw away the rear naked
  // choke's twenty-two centimetres of balance because its deepest overlap moved
  // by two millimetres. A trade that pays a millimetre for a hand's breadth is
  // the trade this solver exists to make; what the guard is for is the trade
  // that pays a centimetre for a centimetre and calls it progress.
  const SLACK = 0.005;
  if (after.worst > before.worst + SLACK || matAfter.worst > matBefore.worst + SLACK
      || balAfter > balBefore + 0.01 || lookAfter > lookBefore + 0.05
      || hovAfter > hovBefore + 0.0002) {
    restore(id, undo);
    after = cost(id).pen;
    matAfter = underMat();
    balAfter = balance(rig.skel.A, rig.skel.B);
    lookAfter = lookCost(id);
    hovAfter = hoverCost();
    kept = true;
  }
  const hangAfter = hoverCost(true);
  const mark = after.worst > 0.08 || matAfter.worst > 0.03 ? '!' : ' ';
  console.log(
    `${mark} ${id.padEnd(16)} overlap ${(before.worst * 100).toFixed(0).padStart(3)} -> ` +
    `${(after.worst * 100).toFixed(0).padStart(3)}cm   under the mat ` +
    `${(matBefore.worst * 100).toFixed(0).padStart(3)} -> ${(matAfter.worst * 100).toFixed(0).padStart(3)}cm ` +
    `weight out ${(balBefore * 100).toFixed(0).padStart(3)} -> ${(balAfter * 100).toFixed(0).padStart(3)}cm  ` +
    `hangs ${String(hangBefore).padStart(2)} -> ${String(hangAfter).padStart(2)}  ` +
    `${kept ? ' (kept what it had)' : ''}` +
    `${matAfter.worst > 0.03 ? ' ' + matAfter.where : ''}${after.worst > 0.05 ? ' ' + after.where : ''}`
  );
  changed.push(id);
}

if (WRITE) {
  const path = new URL('../src/game/poses.js', import.meta.url);
  let src = readFileSync(path, 'utf8');
  for (const id of changed) src = writePose(src, id);
  writeFileSync(path, src);
  console.log(`\nwrote ${changed.length} pose(s) into src/game/poses.js`);
}

// Rewrite the numbers in place, leaving every comment and every bit of the
// file's shape alone. A pose whose joints come from a shared constant is left
// alone too — there is nothing in it to rewrite.
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
    sec = sec.replace(/p: \[[^\]]*\]/, `p: [${P.root.p.map(n3).join(', ')}]`);
    for (const bone of Object.keys(P.j)) {
      const rx = new RegExp(`(\\b${bone}: )\\[[^\\]]*\\]`);
      if (rx.test(sec)) sec = sec.replace(rx, `$1[${P.j[bone].map(n1).join(', ')}]`);
    }
    block = block.slice(0, rs) + sec + block.slice(re);
  }
  return src.slice(0, start) + block + src.slice(end);
}

function n1(v) { return (Math.round(v * 10) / 10).toString(); }
function n3(v) { return (Math.round(v * 1000) / 1000).toString(); }

function brace(s, i) {
  let d = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) return k + 1; }
  }
  return s.length;
}

