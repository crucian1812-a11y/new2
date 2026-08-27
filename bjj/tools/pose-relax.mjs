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

  // Under the mat.
  for (const sk of [A, B]) {
    for (const b of READ) {
      const m = sk.world[BONE_INDEX[b]];
      const under = MAT_Y - 0.02 - m[13];
      if (under > 0) c += under * under * 40;
    }
  }

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
  relax(id);
  const after = cost(id).pen;
  const mark = after.worst > 0.08 ? '!' : ' ';
  console.log(
    `${mark} ${id.padEnd(14)} ${(before.worst * 100).toFixed(0).padStart(3)}cm -> ` +
    `${(after.worst * 100).toFixed(0).padStart(3)}cm   ${after.worst > 0.05 ? after.where : ''}`
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

