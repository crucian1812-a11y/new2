// Which pose to curve a transition through.
//
// A waypoint that swells in the middle can shove two bodies apart; it cannot
// route a limb around one. Taking side control from the back means a leg has to
// come out from between the other man's and travel round him, and every point
// on the straight line between those two tangles has it going through him — so
// the answer is not a bigger shove, it is a different path.
//
// The library already contains fifteen tangles that people actually get into,
// and for most of these the way round is one of them. This tries every pose as
// the middle control point of a quadratic and keeps the one that helps most,
// which is both cheaper and more honest than authoring an in-between by hand:
// if none of them helps, it says so and the transition keeps its straight line.
//
//   node bjj/tools/via-pick.mjs            report
//   node bjj/tools/via-pick.mjs --write    write VIAS into src/game/arcs.js

import { readFileSync, writeFileSync } from 'node:fs';
import { PairRig } from '../src/game/rig.js';
import { POSITION_IDS, WAYPOINT_IDS } from '../src/game/poses.js';
import { ARCS, VIAS } from '../src/game/arcs.js';
import { TRANSITIONS, visualTo } from '../src/game/positions.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { JUDGE_STEPS } from './grid.mjs';

const WRITE = process.argv.includes('--write');
// The routes as they stand, to tell afterwards which ones this run changed.
const WAS = { ...VIAS };
// Which transitions to reconsider. The default is all of them; --only names a
// few, which is what you want after arc-solve has run and left one or two it
// could not straighten — a curve is a bigger change than a shove and is worth
// spending only where the shove failed.
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',')) : null;
})();
// The same grid blend-check judges on — thirteen stepped over the very
// crossings this tool exists to route around. See grid.mjs.
const STEPS = JUDGE_STEPS;
// Only transitions this bad are worth bending; below it the straight line is
// fine and a curve is a change nobody asked for.
const TRIGGER = 0.11;
// And a curve has to actually pay for itself.
const GAIN = 0.02;
// How far apart the two of them may drift on the way. Without this every
// transition picks STANDING, because standing solves interpenetration perfectly
// by having the two fighters half a metre apart — which on the way from mount
// to half guard reads as both of them being yanked to their feet and put back.
const TOGETHER = 0.30;
const READ = ['headTop', 'handL', 'handR', 'footL', 'footR', 'hips', 'chest'];

const rig = new PairRig();
// Measuring the path, not a performance of it: the step planner and the
// inertia both depend on the frame before, and stepping a transition in
// forty-one jumps is not a frame before anything.
rig.live = false;
const overlap = new Overlap();

function walk(from, to) {
  let worst = 0, apart = 0;
  for (let i = 1; i < STEPS - 1; i++) {
    rig.effort.A = rig.effort.B = 0;
    rig.slack.A = rig.slack.B = 0;
    rig.time = 0;
    rig.applyAt(from, to, i / (STEPS - 1), 0.016);
    const ov = overlap.measure(rig.skel.A, rig.skel.B);
    if (ov.deepest > worst) worst = ov.deepest;

    let closest = 1e9;
    for (const a of READ) {
      const ma = rig.skel.A.world[BONE_INDEX[a]];
      for (const b of READ) {
        const mb = rig.skel.B.world[BONE_INDEX[b]];
        const d = Math.hypot(ma[12] - mb[12], ma[13] - mb[13], ma[14] - mb[14]);
        if (d < closest) closest = d;
      }
    }
    if (closest > apart) apart = closest;
  }
  return { worst, apart };
}

const keys = [];
const seen = new Set();
for (const tr of TRANSITIONS) {
  // `visualTo`, not `to`: a sweep's blend runs to the mirror of its
  // destination, and a bridge and roll is exactly the kind of path a swelling
  // shove cannot solve — the two of them have to go round each other.
  const key = `${tr.from}>${visualTo(tr)}`;
  if (tr.from === visualTo(tr) || seen.has(key)) continue;
  seen.add(key);
  keys.push(key);
}

// Positions, plus the waypoints authored for exactly this. A held position's
// working variant is the same tangle with a hip moved, so routing through one
// is routing through the pose you are already at — twenty more candidates that
// cannot help and can win by noise.
const poses = [...POSITION_IDS, ...WAYPOINT_IDS];
// A transition this run is not reconsidering keeps the curve it has. Writing
// out only what was chosen this time would drop the rest — the same accident
// arc-solve had twice.
const chosen = {};
for (const key of keys) if (ONLY && !ONLY.has(key) && VIAS[key]) chosen[key] = VIAS[key];

for (const key of keys) {
  if (ONLY && !ONLY.has(key)) continue;
  const [from, to] = key.split('>');
  delete VIAS[key];
  // And the arc comes off too, for the length of the comparison.
  //
  // The arc in the file was solved against whatever route this transition had
  // when arc-solve last ran, so leaving it on measures every candidate route
  // through a correction shaped for a different one. With it on, the two
  // routes that are in the file right now both came out as "no pose helps" —
  // their own incumbent among them — because the incumbent's arc was fighting
  // them. Which way to go is a question about the path; the arc is what is
  // added afterwards.
  const arc = ARCS[key];
  delete ARCS[key];
  const straight = walk(from, to).worst;
  if (straight < TRIGGER) { if (arc) ARCS[key] = arc; continue; }

  let best = null, bestWorst = straight;
  for (const p of poses) {
    if (p === from || p === to) continue;
    // Each candidate is tried three times: leaning through the middle, and the
    // same pose biting a third of the way in or two thirds. Ranking the
    // candidates for the nine that were left said their worst moment is at
    // 0.6-0.72 of the blend, and a bump that peaks at 0.5 is two thirds gone
    // by then. See VIA_PLAN in rig.js.
    for (const at of ['', '@early', '@late', '@mid+A', '@early+A', '@late+A',
                      '@mid+B', '@early+B', '@late+B']) {
      VIAS[key] = p + at;
      const m = walk(from, to);
      if (m.apart > TOGETHER) continue;   // they came apart on the way
      // Strictly the best, and the margin applied once at the end. Applied
      // between candidates it hid better routes behind worse ones: whichever
      // came first held the lead until something beat it by two centimetres,
      // so KNEE_ON_BELLY>MOUNT kept a 23 cm route while a 22 cm one was
      // measured three candidates later and thrown away.
      if (m.worst < bestWorst) { bestWorst = m.worst; best = p + at; }
    }
  }
  if (arc) ARCS[key] = arc;
  if (best && bestWorst > straight - GAIN) best = null;   // not worth a curve
  if (best) {
    VIAS[key] = best;
    chosen[key] = best;
    console.log(
      `  ${key.padEnd(28)} ${(straight * 100).toFixed(0).padStart(3)}cm -> ` +
      `${(bestWorst * 100).toFixed(0).padStart(3)}cm   via ${best}`
    );
  } else {
    delete VIAS[key];
    console.log(`! ${key.padEnd(28)} ${(straight * 100).toFixed(0).padStart(3)}cm   no pose helps`);
  }
}

console.log(`\n${Object.keys(chosen).length} transitions curved`);

if (WRITE) {
  const path = new URL('../src/game/arcs.js', import.meta.url);
  let src = readFileSync(path, 'utf8');

  // A transition whose route changed loses its arc.
  //
  // The arc was solved against the old path, and on the new one it pulls the
  // pair towards where nobody is any more: giving SIDE_CONTROL>HALF_GUARD a
  // curve and leaving its old arc in place took it from 19 cm to 22, past the
  // line. Better a transition with no correction — that is only as bad as the
  // straight line — than one carrying somebody else's. arc-solve puts it back:
  //   node bjj/tools/arc-solve.mjs --write --fresh --only <keys>
  const moved = [...new Set([...Object.keys(WAS), ...Object.keys(chosen)])]
    .filter((k) => WAS[k] !== chosen[k]);
  // Built from a plain string, not a template literal: `\[` and `\s` inside
  // one are not escapes at all, they are the letters, and the pattern this
  // used to build — `[[sS]*?` — matched nothing an arc has ever contained. It
  // dropped no arcs and said nothing, which is the worst of the three
  // possible behaviours.
  for (const k of moved) {
    const lit = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp("\\n  '" + lit + "': \\[[\\s\\S]*?\\n  \\],");
    if (!re.test(src) && ARCS[k]) console.log(`  (${k} had an arc and it was not found to drop)`);
    src = src.replace(re, '');
  }
  if (moved.length) {
    console.log(
      `\ndropped the arc of ${moved.length} transition(s) whose route changed — ` +
      `re-solve them:\n  node bjj/tools/arc-solve.mjs --write --fresh --only ${moved.join(',')}`
    );
  }
  const body = Object.entries(chosen)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `  '${k}': '${v}',`)
    .join('\n');
  const block = `// Generated by bjj/tools/via-pick.mjs.
//
// A transition listed here is a curve rather than a straight line: the pose
// named is the middle control point of a quadratic, pulled to half weight at
// the midpoint of the blend. These are the ones where no amount of shoving
// helps, because a limb has to travel around a body rather than through it.
export const VIAS = {
${body}
};`;
  src = src.replace(/(\/\/ Generated by bjj\/tools\/via-pick\.mjs[\s\S]*?\n\};|export const VIAS = \{[\s\S]*?\};)/, block);
  writeFileSync(path, src);
  console.log(`wrote ${Object.keys(chosen).length} vias into src/game/arcs.js`);
}
