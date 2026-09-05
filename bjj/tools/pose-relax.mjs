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
// How far the skin hangs below each of those bones. The sole is measured on the
// baked mesh (8.3 cm under the ankle bone); the rest are the capsule radii
// collide.js gives them, which is the same shape the collision term uses.
const SKIN_BELOW = {
  headTop: 0.086, handL: 0.070, handR: 0.070, footL: 0.083, footR: 0.083,
  hips: 0.190, chest: 0.212, shinL: 0.100, shinR: 0.100,
};

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
    for (const b of READ) {
      const m = rig.skel[role].world[BONE_INDEX[b]];
      const under = MAT_Y - (m[13] - (SKIN_BELOW[b] || 0));
      if (under > worst) { worst = under; where = `${role}.${b}`; }
    }
  }
  return { worst, where };
}

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

function balance(A, B) {
  const pts = [];
  let mx = 0, mz = 0, m = 0;
  for (const sk of [A, B]) {
    for (const [a, b, r0, r1, w] of CAPS) {
      const p = sk.world[BONE_INDEX[a]], q = sk.world[BONE_INDEX[b]];
      mx += ((p[12] + q[12]) / 2) * w;
      mz += ((p[14] + q[14]) / 2) * w;
      m += w;
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const y = p[13] + (q[13] - p[13]) * t;
        const r = r0 + (r1 - r0) * t;
        if (y - r <= MAT_Y + 0.04) {
          pts.push([p[12] + (q[12] - p[12]) * t, p[14] + (q[14] - p[14]) * t]);
        }
      }
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

function cost(id) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.time = 0;
  rig.apply(id, id, 1, 0.016);
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
  // The offsets are how far the skin reaches below each bone's own centre,
  // taken from the capsules collide.js is built from and from the sole
  // measurement for the feet.
  for (const sk of [A, B]) {
    for (const b of READ) {
      const m = sk.world[BONE_INDEX[b]];
      const under = MAT_Y - (m[13] - (SKIN_BELOW[b] || 0));
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
  const out = balance(A, B);
  if (out > 0.12) c += (out - 0.12) * (out - 0.12) * 30;

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
  const before = cost(id).pen;
  const matBefore = underMat();
  relax(id);
  const after = cost(id).pen;
  const matAfter = underMat();
  const mark = after.worst > 0.08 || matAfter.worst > 0.03 ? '!' : ' ';
  console.log(
    `${mark} ${id.padEnd(16)} overlap ${(before.worst * 100).toFixed(0).padStart(3)} -> ` +
    `${(after.worst * 100).toFixed(0).padStart(3)}cm   under the mat ` +
    `${(matBefore.worst * 100).toFixed(0).padStart(3)} -> ${(matAfter.worst * 100).toFixed(0).padStart(3)}cm ` +
    `${matAfter.worst > 0.03 ? matAfter.where : ''} ${after.worst > 0.05 ? after.where : ''}`
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

