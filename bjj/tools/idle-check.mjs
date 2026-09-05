// Which arcs are not paying for themselves.
//
// STANDING>STANDING_WORK corrected a blend that had nothing to correct — 0cm
// to 0cm in the solver's own log — and cost seven and a half teleports a
// minute, because it moves the pair in the one pose where the step planner
// picks a foot's landing spot. arc-solve has a check meant to catch exactly
// that (the empty arc wins if it is no worse) but it compares four numbers and
// not the fifth, so an arc kept for a hair of sink survives it.
//
// This asks the question directly and without a search: for every arc in the
// file, walk the blend with it and without it, and report the ones the graph
// would not miss. Cheap — two walks a blend, no solving.
//
// The line is two millimetres, the same one arc-solve now drops an arc at: an
// arc has to buy something a person could see. It is a check and not a report
// because what an idle arc costs is invisible to everything else here — a
// blend it does not change is a blend blend-check reads as fine.
//
//   node bjj/tools/idle-check.mjs
import { readFileSync } from 'node:fs';
import { PairRig } from '../src/game/rig.js';
import { ARCS } from '../src/game/arcs.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { HOLD_LOOPS } from '../src/game/poses.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { decodeFighter } from '../src/render/asset.js';
import { skinLite, skinInto } from './skin-lite.mjs';
import { JUDGE_STEPS as STEPS } from './grid.mjs';

const MAT_Y = 0.05;
const load = (n) => { const r = readFileSync(new URL(`../assets/${n}`, import.meta.url));
  return decodeFighter(r.buffer.slice(r.byteOffset, r.byteOffset + r.length)); };
const LITE = { A: skinLite(load('fighter.bin')), B: skinLite(load('fighter-b.bin')) };
const MAXV = Math.max(LITE.A.pos.length, LITE.B.pos.length) / 3;
const _xyz = new Float64Array(MAXV * 3), _who = new Uint16Array(MAXV);
const LOW = ['handL','handR','footL','footR','hips','shinL','shinR','chest','head'];
function sink(sk) { let best = -9;
  for (const mk of ['A','B']) { const n = skinInto(LITE[mk], sk, _xyz, _who);
    let lo = 9; for (let v = 0; v < n; v++) if (_xyz[v*3+1] < lo) lo = _xyz[v*3+1];
    if (lo > best) best = lo; }
  return MAT_Y - best; }

const rig = new PairRig(); rig.live = false;
const overlap = new Overlap();
function walk(from, to) {
  let worst = 0, sunk = 0; const low = new Array(STEPS);
  for (let i = 0; i < STEPS; i++) {
    rig.effort.A = rig.effort.B = 0; rig.slack.A = rig.slack.B = 0; rig.rewind();
    rig.applyAt(from, to, i / (STEPS - 1), 0.016);
    const d = overlap.measure(rig.skel.A, rig.skel.B).deepest;
    if (d > worst) worst = d;
    for (const r of ['A','B']) { const s = sink(rig.skel[r]); if (s > sunk) sunk = s; }
    let lo = Infinity;
    for (const r of ['A','B']) for (const b of LOW) lo = Math.min(lo, rig.skel[r].world[BONE_INDEX[b]][13]);
    low[i] = lo;
  }
  let lift = 0;
  for (let i = 1; i < STEPS - 1; i++) {
    const base = low[0] + (low[STEPS-1] - low[0]) * (i / (STEPS - 1));
    if (low[i] - base > lift) lift = low[i] - base;
  }
  return { worst, sunk, lift };
}

const keys = []; const seen = new Set();
for (const [from,to] of [...TRANSITIONS.flatMap(tr=>visualEnds(tr).map(to=>[tr.from,to])),
  ...Object.entries(HOLD_LOOPS).flatMap(([p,l])=>l.map(v=>[p,v]))]) {
  const k = `${from}>${to}`; if (from===to||seen.has(k)) continue; seen.add(k); keys.push([from,to,k]); }

const idle = [];
for (const [from,to,k] of keys) {
  if (!ARCS[k]) continue;
  const withIt = walk(from, to);
  const keep = ARCS[k]; delete ARCS[k];
  const without = walk(from, to);
  ARCS[k] = keep;
  const E = 0.002;   // two millimetres: below that an arc is buying nothing
  const buys = (withIt.worst < without.worst - E) || (withIt.sunk < without.sunk - E) ||
               (withIt.lift < without.lift - E);
  const costs = (withIt.worst > without.worst + E) || (withIt.sunk > without.sunk + E) ||
                (withIt.lift > without.lift + E);
  if (!buys) idle.push({ k, withIt, without, costs });
}
const cm = (x) => (x*100).toFixed(1).padStart(5);
const n = keys.filter(([,,k]) => ARCS[k]).length;
console.log(`\n${n} arcs in the file, ${idle.length} of them buy nothing\n`);
console.log(`${idle.length ? 'FAIL' : 'ok  '} every arc pays for itself  ` +
  `${idle.length} of ${n} change nothing anybody measures by 2mm`);
if (!idle.length) { console.log('\nnothing is being carried for free'); process.exit(0); }
console.log();
console.log('  transition                       overlap w/ w/o    mat w/ w/o     lift w/ w/o');
for (const r of idle) console.log(`  ${r.k.padEnd(32)}${cm(r.withIt.worst)}${cm(r.without.worst)}  ` +
  `${cm(r.withIt.sunk)}${cm(r.without.sunk)}  ${cm(r.withIt.lift)}${cm(r.without.lift)}` +
  (r.costs ? '   ← and makes something worse' : ''));

process.exitCode = 1;
