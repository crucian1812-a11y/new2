// Solve the arc of every transition.
//
// The poses are clean and the paths between them are not: a slerp from one
// valid tangle to another runs through invalid ones, and with the endpoints
// down to eight centimetres the worst moment in flight was twenty-nine. That is
// not a pose problem and no amount of work on either endpoint touches it.
//
// So each transition gets a waypoint: a correction that swells up over the
// blend and back to nothing at both ends, so neither endpoint is touched. It is
// where to push the two of them apart, how far to turn each of them, and a
// handful of joint angles.
//
// Pushing them apart alone was tried first and took the worst case from
// twenty-nine centimetres to twenty-eight, because a thigh rotating through a
// hip does not care how far apart the roots are. Adding the turn and the joints
// got it to twenty. The rest was the shape: one bump peaking halfway through
// cannot fix a collision at a third of the way and a different one at five
// sixths, and several transitions have exactly that, so the correction is two
// overlapping lobes — one weighted early, one late.
//
// The joints it is allowed to move are chosen by asking which ones are actually
// colliding, so the search is over a dozen numbers and not four hundred. Same
// pattern search and same capsules as the pose solver, with the size of the
// correction paid for so the answer stays as small as it can be: a transition
// takes half a second, and a fighter who visibly teleports apart in the middle
// of one is a worse bug than the arm he was avoiding.
//
// The search is warm-started from whatever arcs.js already holds, so a rerun
// refines rather than starting over, and --only solves named transitions and
// leaves the rest alone. Solving all of them takes the better part of an hour;
// adding one edge to the graph should not.
//
//   node bjj/tools/arc-solve.mjs                          report what it would do
//   node bjj/tools/arc-solve.mjs --write                  and write src/game/arcs.js
//   node bjj/tools/arc-solve.mjs --only A>B --write       just that one
//   node bjj/tools/arc-solve.mjs --fresh --write          ignore what is there

import { writeFileSync } from 'node:fs';
import { PairRig } from '../src/game/rig.js';
import { ARCS, VIAS } from '../src/game/arcs.js';
import { TRANSITIONS } from '../src/game/positions.js';
import { HOLD_LOOPS } from '../src/game/poses.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { SOLVE_STEPS } from './grid.mjs';

const WRITE = process.argv.includes('--write');
const FRESH = process.argv.includes('--fresh');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',')) : null;
})();
// See grid.mjs: this has to stay a refinement of what blend-check judges on.
const STEPS = SOLVE_STEPS;
const MAT_Y = 0.05;
// Contact is fine in flight too — they are still grappling. This is where a
// limb starts being inside a body.
const ALLOW = 0.05;
// How far the pair may be moved. Beyond about fifteen centimetres the fix is
// more visible than the fault.
// Overridable, because the seven transitions still on the work list are all the
// same accident — a thigh through a thigh, halfway across the body — and the
// question of how much room the correction needs is a measurement, not a
// constant. Widen them for a targeted run and look at the pictures.
const LIMIT = +(process.env.ARC_LIMIT || 0.16);
// How far a joint may be bent away from the straight blend, in degrees.
const BEND = +(process.env.ARC_BEND || 34);
// How far a fighter may be turned away from the straight blend, in degrees.
const TWIST = +(process.env.ARC_TWIST || 26);
// How many colliding bones get to move. Six was enough for everything that has
// come off the list so far.
const CULPRITS = +(process.env.ARC_BONES || 6);
// How many lobes a correction is made of. See the note in rig.js.
const LOBES = +(process.env.ARC_LOBES || 2);

const rig = new PairRig();
const overlap = new Overlap();
const READ = ['headTop', 'handL', 'handR', 'footL', 'footR', 'hips', 'chest'];

function measure(from, to) {
  let sum = 0, worst = 0, where = null;
  // eslint-disable-next-line no-unused-vars
  for (let i = 0; i < STEPS; i++) {
    const t = i / (STEPS - 1);
    rig.effort.A = rig.effort.B = 0;
    rig.slack.A = rig.slack.B = 0;
    rig.time = 0;
    rig.apply(from, to, t, 0.016);

    for (const p of overlap.all(rig.skel.A, rig.skel.B)) {
      const over = p.pen - ALLOW;
      if (over > 0) sum += over * over;
      if (p.pen > worst) { worst = p.pen; where = p.where; }
    }
    // Nobody goes through the mat on the way, either.
    for (const role of ['A', 'B']) {
      for (const b of READ) {
        const m = rig.skel[role].world[BONE_INDEX[b]];
        const under = MAT_Y - 0.06 - m[13];
        if (under > 0) sum += under * under * 3;
      }
    }
  }
  return { sum, worst, where };
}

// The graph's transitions, and the loops a held position runs inside itself.
// Both are slerps between two paired poses and both go through the middle, so
// both get an arc when the middle needs one.
const keys = [];
const seen = new Set();
for (const [from, to] of [
  ...TRANSITIONS.map((tr) => [tr.from, tr.to]),
  ...Object.entries(HOLD_LOOPS).flatMap(([pos, loop]) => loop.map((v) => [pos, v])),
]) {
  const key = `${from}>${to}`;
  if (from === to || seen.has(key)) continue;
  seen.add(key);
  keys.push(key);
}

// Which of them this run is actually solving. This has to be settled before
// anything is thrown away, and it was not: --fresh deleted the warm start for
// every key in the list and only afterwards did --only shorten the list, so
// every arc not named on the command line was written out empty. It happened
// twice — the second time to a file that had just taken an hour to fill — and
// both times the only symptom was the worst moment in flight going from 19 cm
// to 29 in the last line of the report.
const solving = new Set(keys.filter((key) => !ONLY || ONLY.has(key)));

// What is already there, and what the straight line looks like without it.
const WAS = new Set(Object.keys(ARCS));
const held = JSON.parse(JSON.stringify(ARCS));
if (FRESH) for (const key of solving) delete held[key];
const before = {};
for (const key of keys) {
  const [from, to] = key.split('>');
  delete ARCS[key];
  before[key] = measure(from, to).worst;
}
for (const key of Object.keys(held)) ARCS[key] = held[key];

// Anything not being solved this run keeps the arc it has, and is reported as
// it stands so the summary is still the whole picture.
const skipped = [];
for (const key of keys.slice()) {
  if (solving.has(key)) continue;
  const [from, to] = key.split('>');
  skipped.push({ key, before: before[key], after: measure(from, to).worst, arc: ARCS[key] || null });
  keys.splice(keys.indexOf(key), 1);
}

// Which joints are worth moving: the ones whose capsules are actually inside
// something. Searching all twenty-four of both fighters would be four hundred
// unknowns for a correction that only ever needs a few.
function culprits(from, to) {
  const count = new Map();
  for (let i = 1; i < STEPS - 1; i++) {
    const t = i / (STEPS - 1);
    rig.effort.A = rig.effort.B = 0;
    rig.slack.A = rig.slack.B = 0;
    rig.time = 0;
    rig.apply(from, to, t, 0.016);
    for (const p of overlap.all(rig.skel.A, rig.skel.B)) {
      if (p.pen < ALLOW) continue;
      // "A.thighR in B.hips" — both ends are candidates, and so is whatever
      // carries them, because a hip through a hip is fixed at the hip.
      const m = /^A\.(\w+) in B\.(\w+)$/.exec(p.where);
      if (!m) continue;
      count.set('A.' + m[1], (count.get('A.' + m[1]) || 0) + p.pen);
      count.set('B.' + m[2], (count.get('B.' + m[2]) || 0) + p.pen);
    }
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, CULPRITS);
  const out = [];
  for (const [name] of ranked) {
    const [role, bone] = name.split('.');
    out.push([role, bone]);
    // The parent too: rotating a shin out of something is often really a knee.
    const par = PARENT[bone];
    if (par && !out.some((o) => o[0] === role && o[1] === par)) out.push([role, par]);
  }
  return out;
}

const PARENT = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  armL: 'clavL', foreL: 'armL', handL: 'foreL',
  armR: 'clavR', foreR: 'armR', handR: 'foreR',
  shinL: 'thighL', footL: 'shinL', shinR: 'thighR', footR: 'shinR',
  thighL: 'hips', thighR: 'hips', clavL: 'chest', clavR: 'chest',
};

const results = [];
for (const key of keys) {
  const [from, to] = key.split('>');
  // Warm start: whatever is already stored for this transition, filled back out
  // to the dense form the search works in.
  const prev = held[key] || [];
  // How many bumps the correction is made of. Two is the shape everything in
  // the file was solved with; three is for a transition that goes wrong twice
  // on the way, which is what the last seven on the work list do. A warm start
  // across a change of count is not a warm start — the weights are a different
  // family — so change it with --fresh.
  const arc = Array.from({ length: LOBES }, (_, i) => {
    const p = prev[i] || {};
    const lobe = { p: [0, 0, 0], r: { A: [0, 0, 0], B: [0, 0, 0] }, j: { A: {}, B: {} } };
    if (p.p) lobe.p = p.p.slice();
    for (const role of ['A', 'B']) {
      if (p.r && p.r[role]) lobe.r[role] = p.r[role].slice();
      if (p.j && p.j[role]) for (const b in p.j[role]) lobe.j[role][b] = p.j[role][b].slice();
    }
    return lobe;
  });
  ARCS[key] = arc;

  const dofs = [];
  for (const lobe of arc) {
    for (let k = 0; k < 3; k++) {
      dofs.push({ get: () => lobe.p[k], set: (x) => { lobe.p[k] = x; }, limit: LIMIT, step: 0.05 });
    }
    for (const role of ['A', 'B']) {
      for (let k = 0; k < 3; k++) {
        const a = lobe.r[role];
        dofs.push({ get: () => a[k], set: (x) => { a[k] = x; }, limit: TWIST, step: 8 });
      }
    }
  }
  // Which joints get to move is decided from what is actually colliding, and
  // decided again after each pass, because moving one limb out of a body
  // reliably reveals the next one.
  const known = new Set();
  const addBones = () => {
    const want = culprits(from, to).map(([role, bone]) => [role, bone]);
    for (const lobe of arc) for (const role of ['A', 'B']) {
      for (const b in lobe.j[role]) want.push([role, b]);   // warm-started ones
    }
    for (const [role, bone] of want) {
      if (known.has(role + bone)) continue;
      known.add(role + bone);
      for (const lobe of arc) {
        const a = lobe.j[role][bone] || (lobe.j[role][bone] = [0, 0, 0]);
        for (let k = 0; k < 3; k++) {
          dofs.push({ get: () => a[k], set: (x) => { a[k] = x; }, limit: BEND, step: 9 });
        }
      }
    }
  };
  addBones();

  const size = () => {
    let m = 0;
    for (const lobe of arc) {
      m += lobe.p[0] * lobe.p[0] + lobe.p[1] * lobe.p[1] + lobe.p[2] * lobe.p[2];
      for (const role of ['A', 'B']) {
        for (const d of lobe.r[role]) m += (d / 90) * (d / 90);
        for (const b in lobe.j[role]) {
          for (const d of lobe.j[role][b]) m += (d / 90) * (d / 90);
        }
      }
    }
    return m;
  };
  // The peak matters more than the total. A correction that halves the average
  // and leaves one frame with a forearm through a skull has fixed nothing that
  // anybody will notice; the frame is what they see.
  const cost = () => {
    const m = measure(from, to);
    const over = Math.max(0, m.worst - ALLOW);
    return m.sum + over * over * 40 + size() * 0.7;
  };

  for (let round = 0; round < 3; round++) {
    if (round) addBones();
    let best = cost();
    let scale = 1;
    while (scale > 0.05) {
      let moved = false;
      for (const d of dofs) {
        for (const dir of [1, -1]) {
          const was = d.get();
          const next = was + dir * d.step * scale;
          if (Math.abs(next) > d.limit) continue;
          d.set(next);
          const now = cost();
          if (now < best - 1e-9) { best = now; moved = true; break; }
          d.set(was);
        }
      }
      if (!moved) scale *= 0.5;
    }
  }

  // Round, and drop anything too small to be worth carrying.
  for (const lobe of arc) {
    for (let k = 0; k < 3; k++) lobe.p[k] = Math.round(lobe.p[k] * 1000) / 1000;
    if (Math.hypot(lobe.p[0], lobe.p[1], lobe.p[2]) < 0.006) lobe.p = null;
    for (const role of ['A', 'B']) {
      const r = lobe.r[role].map((x) => Math.round(x * 10) / 10);
      if (Math.hypot(r[0], r[1], r[2]) < 1.0) delete lobe.r[role];
      else lobe.r[role] = r;
      for (const b in lobe.j[role]) {
        const d = lobe.j[role][b].map((x) => Math.round(x * 10) / 10);
        if (Math.hypot(d[0], d[1], d[2]) < 1.0) delete lobe.j[role][b];
        else lobe.j[role][b] = d;
      }
      if (!Object.keys(lobe.j[role]).length) delete lobe.j[role];
    }
    lobe.empty = !lobe.p && !lobe.r.A && !lobe.r.B && !lobe.j.A && !lobe.j.B;
  }
  if (arc.every((l) => l.empty)) delete ARCS[key];

  const after = measure(from, to);
  results.push({ key, before: before[key], after: after.worst, arc: ARCS[key] || null, where: after.where });
  process.stderr.write(`${key} ${(before[key] * 100).toFixed(0)} -> ${(after.worst * 100).toFixed(0)}cm\n`);
}

results.push(...skipped);
results.sort((a, b) => b.after - a.after);
for (const r of results) {
  const mark = r.after > 0.11 ? '!' : ' ';
  // A lobe read back from arcs.js is already sparse: p, r and j are each there
  // only if they carried anything.
  const bones = r.arc
    ? [...new Set(r.arc.flatMap((l) => Object.keys(l.j || {}).flatMap(
        (role) => Object.keys(l.j[role] || {}).map((b) => role + '.' + b))))]
    : [];
  console.log(
    `${mark} ${r.key.padEnd(28)} ${(r.before * 100).toFixed(0).padStart(3)}cm -> ` +
    `${(r.after * 100).toFixed(0).padStart(3)}cm   ` +
    (r.arc ? bones.join(' ') || 'shove only' : 'no waypoint needed')
  );
}
const worst = results.length ? results[0].after : 0;
console.log(`\nworst moment in flight: ${(worst * 100).toFixed(0)}cm`);

if (WRITE) {
  // Nothing this run was not asked to solve may lose the arc it came in with.
  // The two accidents above both ended in a file with forty arcs missing and a
  // cheerful "wrote 1 arcs" underneath, so the check is here rather than in a
  // comment: a run that would drop somebody else's work writes nothing.
  const lost = [...WAS].filter((key) => !solving.has(key) && !results.some((r) => r.key === key && r.arc));
  if (lost.length) {
    console.error(`\nrefusing to write: ${lost.length} arc(s) this run was not asked to touch would be lost`);
    console.error(lost.slice(0, 8).map((k) => `  ${k}`).join('\n'));
    process.exit(1);
  }
  const lobe = (l) => {
    const lj = l.j || {};
    const lr = l.r || {};
    const j = [];
    if (lj.A) j.push(`A: { ${Object.entries(lj.A).map(([b, d]) => `${b}: [${d.join(', ')}]`).join(', ')} }`);
    if (lj.B) j.push(`B: { ${Object.entries(lj.B).map(([b, d]) => `${b}: [${d.join(', ')}]`).join(', ')} }`);
    const rr = [];
    if (lr.A) rr.push(`A: [${lr.A.join(', ')}]`);
    if (lr.B) rr.push(`B: [${lr.B.join(', ')}]`);
    const body = [
      l.p ? `p: [${l.p.map((n) => n.toFixed(3)).join(', ')}]` : null,
      rr.length ? `r: { ${rr.join(', ')} }` : null,
      j.length ? `j: { ${j.join(', ')} }` : null,
    ].filter(Boolean).join(', ');
    return `{ ${body} }`;
  };
  const lines = results
    .filter((r) => r.arc)
    .sort((a2, b2) => (a2.key < b2.key ? -1 : 1))
    .map((r) => `  '${r.key}': [\n    ${r.arc.map(lobe).join(',\n    ')},\n  ],`);

  // The file has two halves and two owners: this tool writes the arcs,
  // via-pick.mjs writes the vias. Rebuilding the file from a template that only
  // knows about arcs deletes the other half — which is exactly what happened,
  // silently, and cost three transitions their curve. So the vias are written
  // back out as they were read in.
  const vias = Object.entries(VIAS)
    .sort((a2, b2) => (a2[0] < b2[0] ? -1 : 1))
    .map(([k, v]) => `  '${k}': '${v}',`)
    .join('\n');

  const src = `// Generated by bjj/tools/arc-solve.mjs — do not edit by hand.
//
// Two lobes per transition — one weighted towards the start of the blend, one
// towards the end, both zero at either end so neither authored pose is touched.
// Each carries where to push the pair apart (p, half to each fighter in
// opposite directions), how far to turn each of them (r), and a few joint
// angles (j). See rig.js for how they are applied and blend-check.mjs for what
// they are fixing.
//
// A transition whose straight line was already clear has no entry here.
//
// Generated by bjj/tools/via-pick.mjs.
//
// A transition listed here is a curve rather than a straight line: the pose
// named is the middle control point of a quadratic, pulled to half weight at
// the midpoint of the blend. These are the ones where no amount of shoving
// helps, because a limb has to travel around a body rather than through it.
export const VIAS = {
${vias}
};

export const ARCS = {
${lines.join('\n')}
};
`;
  writeFileSync(new URL('../src/game/arcs.js', import.meta.url), src);
  console.log(`\nwrote ${lines.length} arcs into src/game/arcs.js`);
}
