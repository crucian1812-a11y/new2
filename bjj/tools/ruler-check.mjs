// Do the solver and the judge measure the same mat?
//
// blend-check reads the real baked skin to ask how far a fighter is through the
// tatami. arc-solve cannot — it evaluates its cost tens of thousands of times —
// so it reads tools/mat-model.mjs instead: a segment from each bone to its
// child, minus a radius that fades along it. Two rulers, and every time this
// project has had two rulers it has spent a round chasing a number the solver
// could not see. The nine-number table that mat-model replaced was out by
// twelve centimetres and nobody knew until somebody subtracted.
//
// So this subtracts. Same blends blend-check judges, same grid, same choice of
// baked man; at every sample it asks both rulers how deep the pair is and keeps
// the difference. The model is allowed to be wrong — it is a straight limb
// standing in for a torso — it is not allowed to be wrong in a way nobody has
// written down.
//
//   node bjj/tools/ruler-check.mjs           the whole graph
//   node bjj/tools/ruler-check.mjs --bones   and which bone is lying
import { readFileSync } from 'node:fs';
import { PairRig } from '../src/game/rig.js';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { HOLD_LOOPS, POSES } from '../src/game/poses.js';
import { BONES, BONE_INDEX } from '../src/render/skeleton.js';
import { decodeFighter } from '../src/render/asset.js';
import { skinLite, skinInto } from './skin-lite.mjs';
import { JUDGE_STEPS } from './grid.mjs';
import { MAT_Y, SUNK, skinUnder } from './mat-model.mjs';

const BONES_TOO = process.argv.includes('--bones');
const STEPS = JUDGE_STEPS;

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// The mean disagreement the model is allowed. Not zero and not near it: the
// chest is a torso approximated by a straight limb and it is out by eleven
// centimetres in its own tail. Three is the line the plan set when the model
// replaced the table, and it is the number that says "the solver is solving
// what the judge is judging".
const LINE = 0.03;

const loadMesh = (name) => {
  const raw = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  return decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
};
const LITE = { A: skinLite(loadMesh('fighter.bin')), B: skinLite(loadMesh('fighter-b.bin')) };
const MAXV = Math.max(LITE.A.pos.length, LITE.B.pos.length) / 3;
const _xyz = new Float64Array(MAXV * 3), _who = new Uint16Array(MAXV);

// The real thing, exactly as blend-check asks it: the lowest baked vertex on
// this skeleton, judged on whichever of the two baked men sits higher, because
// either of them can be in either role and they differ by three and a half
// centimetres at the point that touches the mat.
//
// `perBone` comes back filled from the same pass on the winning mesh, so the
// bone table below is about the same body as the headline number.
const _bone = new Float64Array(BONES.length);
function realUnder(sk) {
  let best = -9, bestMk = null;
  for (const mk of ['A', 'B']) {
    const n = skinInto(LITE[mk], sk, _xyz, _who);
    let lo = 9;
    for (let v = 0; v < n; v++) if (_xyz[v * 3 + 1] < lo) lo = _xyz[v * 3 + 1];
    if (lo > best) { best = lo; bestMk = mk; }
  }
  if (BONES_TOO) {
    _bone.fill(9);
    const n = skinInto(LITE[bestMk], sk, _xyz, _who);
    for (let v = 0; v < n; v++) {
      const y = _xyz[v * 3 + 1];
      if (y < _bone[_who[v]]) _bone[_who[v]] = y;
    }
  }
  return MAT_Y - best;
}

// The model, exactly as arc-solve's cost term asks it: the deepest of the
// fifteen segments.
function modelUnder(sk) {
  let d = -9;
  for (const b of SUNK) {
    const u = skinUnder(sk, b);
    if (u > d) d = u;
  }
  return d;
}

const BLENDS = [
  ...TRANSITIONS.flatMap((tr) => visualEnds(tr).map(
    (to) => ({ from: tr.from, to, kind: 'transition' }))),
  ...Object.entries(HOLD_LOOPS).flatMap(([pos, loop]) =>
    loop.map((v) => ({ from: pos, to: v, kind: 'hold' }))),
];

const rig = new PairRig();
rig.live = false;

const diffs = [];
const rows = [];
// Per bone: how far the model's answer for that bone is from the lowest real
// skin hanging off it. Only filled with --bones; it costs a second pass.
const boneErr = new Map();
const seen = new Set();

for (const tr of BLENDS) {
  const key = `${tr.from}>${tr.to}`;
  if (tr.from === tr.to || seen.has(key)) continue;
  seen.add(key);

  let worst = 0, at = 0, model = 0, real = 0;
  for (let i = 0; i < STEPS; i++) {
    const t = i / (STEPS - 1);
    // Fresh every sample, for the reason blend-check gives: the rig integrates
    // breathing off its own clock, and a measurement that depends on how many
    // frames came before it is not a measurement.
    rig.effort.A = rig.effort.B = 0;
    rig.slack.A = rig.slack.B = 0;
    rig.rewind();
    rig.applyAt(tr.from, tr.to, t, 0.016);

    for (const role of ['A', 'B']) {
      const sk = rig.skel[role];
      const r = realUnder(sk);
      const m = modelUnder(sk);
      diffs.push(Math.abs(m - r));
      if (Math.abs(m - r) > worst) { worst = Math.abs(m - r); at = t; model = m; real = r; }
      if (BONES_TOO) {
        for (const b of SUNK) {
          const bi = BONE_INDEX[b];
          if (bi === undefined || _bone[bi] > 8) continue;   // no skin claimed it
          const e = Math.abs(skinUnder(sk, b) - (MAT_Y - _bone[bi]));
          const acc = boneErr.get(b) || { sum: 0, n: 0, worst: 0 };
          acc.sum += e; acc.n++; if (e > acc.worst) acc.worst = e;
          boneErr.set(b, acc);
        }
      }
    }
  }
  rows.push({ key, kind: tr.kind, worst, at, model, real });
}

diffs.sort((a, b) => a - b);
const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
const p90 = diffs[Math.floor(diffs.length * 0.9)];
const worst = diffs[diffs.length - 1];
const cm = (x) => (x * 100).toFixed(1);

console.log(`\n${seen.size} blends, ${diffs.length} pairs of readings\n`);
check(mean < LINE, 'the solver and the judge measure the same mat',
  `${cm(mean)}cm apart on average, ${cm(p90)} at the ninetieth, ${cm(worst)} at worst (line ${cm(LINE)})`);

rows.sort((a, b) => b.worst - a.worst);
console.log('\n     where they disagree most:');
for (const r of rows.slice(0, 8)) {
  console.log(`       ${r.key.padEnd(34)} ${cm(r.worst).padStart(5)}cm at t=${r.at.toFixed(2)}` +
    `   model ${cm(r.model).padStart(5)}, skin ${cm(r.real).padStart(5)}`);
}

if (BONES_TOO) {
  console.log('\n     bone        mean    worst');
  const list = [...boneErr.entries()].sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n);
  for (const [b, a] of list) {
    console.log(`     ${b.padEnd(10)} ${cm(a.sum / a.n).padStart(5)}cm ${cm(a.worst).padStart(6)}cm`);
  }
} else {
  console.log('\n     --bones says which segment is doing the lying');
}

console.log(`\n${fail ? `${fail} check(s) failed` : 'one mat, one ruler'}`);
process.exitCode = fail ? 1 : 0;
