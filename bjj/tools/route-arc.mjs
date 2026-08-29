// Choose the route and the correction together, not one after the other.
//
// via-pick judges a candidate route by the straight-line worst moment, with no
// arc on it — it has to, because the arc in the file was solved for whatever
// route the transition had before. Then arc-solve solves an arc for whatever
// route won. Both halves are sound and the pair of them is not: re-routing the
// whole graph on the pre-arc number and re-solving every arc made 43
// transitions better and 20 worse, and the only way to tell which was which
// was to measure the pair — route plus its own solved arc — against the pair
// that was there before.
//
// So this measures the pair. For each transition it takes the incumbent route
// and the best few alternatives, solves an arc for each one from cold, and
// keeps whichever ends up shallowest. It is slow — an arc solve per candidate
// — and it is meant for the handful of transitions that are still on the work
// list after everything cheaper has run.
//
//   node bjj/tools/route-arc.mjs --only 'SIDE_CONTROL>MOUNT' --routes 4
//
// Writes src/game/arcs.js, and keeps a copy of it beside itself while it runs:
// this drives arc-solve as a subprocess, and a subprocess that dies halfway
// leaves the file in whatever state it was in.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PairRig } from '../src/game/rig.js';
import { POSITION_IDS, WAYPOINT_IDS } from '../src/game/poses.js';
import { ARCS, VIAS } from '../src/game/arcs.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { JUDGE_STEPS as STEPS } from './grid.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ARCS_PATH = join(here, '../src/game/arcs.js');
const BACKUP = join(here, '../src/game/.arcs.backup.js');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const ONLY = (flag('only', '') || '').split(',').filter(Boolean);
const ROUTES = +flag('routes', 4);
const LOBES = flag('lobes', '3');
if (!ONLY.length) {
  console.error('name the transitions: --only "A>B,C>D"');
  process.exit(1);
}

const rig = new PairRig();
const overlap = new Overlap();
const READ = ['headTop', 'handL', 'handR', 'footL', 'footR', 'hips', 'chest'];
const TOGETHER = 0.30;

// The straight-line picture, used only to shortlist. The real judgement is the
// number that comes back from the child process after an arc has been solved.
function walk(from, to) {
  let worst = 0, apart = 0;
  for (let i = 1; i < STEPS - 1; i++) {
    rig.effort.A = rig.effort.B = 0;
    rig.slack.A = rig.slack.B = 0;
    rig.time = 0;
    rig.apply(from, to, i / (STEPS - 1), 0.016);
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

// Rewrite the VIAS block with one route changed. The arcs half of the file is
// left exactly as it is — arc-solve owns that half and this must not touch it.
function setRoute(key, route) {
  const src = readFileSync(ARCS_PATH, 'utf8');
  const m = /export const VIAS = \{\n([\s\S]*?)\n\};/.exec(src);
  const vias = {};
  for (const line of (m ? m[1] : '').split('\n')) {
    const kv = /^\s*'([^']+)':\s*'([^']+)',/.exec(line);
    if (kv) vias[kv[1]] = kv[2];
  }
  if (route) vias[key] = route; else delete vias[key];
  const body = Object.entries(vias).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `  '${k}': '${v}',`).join('\n');
  writeFileSync(ARCS_PATH, src.replace(m[0], `export const VIAS = {\n${body}\n};`));
}

// The post-arc number, from a process that has not imported arcs.js before.
// Re-importing it here would hand back the copy this process loaded at start.
function measureFresh(key) {
  const [from, to] = key.split('>');
  const code = `
    import { PairRig } from '${join(here, '../src/game/rig.js')}';
    import { Overlap } from '${join(here, '../src/game/collide.js')}';
    import { JUDGE_STEPS as S } from '${join(here, 'grid.mjs')}';
    const rig = new PairRig(), ov = new Overlap();
    let worst = 0;
    for (let i = 1; i < S - 1; i++) {
      rig.effort.A = rig.effort.B = 0; rig.slack.A = rig.slack.B = 0; rig.time = 0;
      rig.apply('${from}', '${to}', i / (S - 1), 0.016);
      const d = ov.measure(rig.skel.A, rig.skel.B).deepest;
      if (d > worst) worst = d;
    }
    console.log(worst);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  return parseFloat(r.stdout.trim());
}

function solve(key) {
  const r = spawnSync(process.execPath, [join(here, 'arc-solve.mjs'), '--write', '--fresh', '--only', key],
    { encoding: 'utf8', env: { ...process.env, ARC_LOBES: LOBES } });
  if (r.status !== 0) console.error(r.stdout, r.stderr);
  return r.status === 0;
}

copyFileSync(ARCS_PATH, BACKUP);
const poses = [...POSITION_IDS, ...WAYPOINT_IDS];
const TIMINGS = ['', '@early', '@late', '@mid+A', '@early+A', '@late+A', '@mid+B', '@early+B', '@late+B'];

for (const key of ONLY) {
  const [from, to] = key.split('>');
  const incumbent = VIAS[key] || null;
  console.log(`\n${key}   (now via ${incumbent || 'the straight line'})`);

  // Shortlist on the straight line, then measure the shortlist properly.
  const ranked = [];
  const keep = VIAS[key];
  for (const p of poses) {
    if (p === from || p === to) continue;
    for (const at of TIMINGS) {
      VIAS[key] = p + at;
      const m = walk(from, to);
      if (m.apart > TOGETHER) continue;
      ranked.push({ route: p + at, pre: m.worst });
    }
  }
  delete VIAS[key];
  ranked.push({ route: null, pre: walk(from, to).worst });
  if (keep) VIAS[key] = keep; else delete VIAS[key];
  ranked.sort((a, b) => a.pre - b.pre);

  const tried = new Set();
  const shortlist = [];
  if (incumbent !== undefined) shortlist.push(incumbent);
  tried.add(String(incumbent));
  for (const r of ranked) {
    if (shortlist.length >= ROUTES) break;
    if (tried.has(String(r.route))) continue;
    tried.add(String(r.route));
    shortlist.push(r.route);
  }

  let best = null;
  for (const route of shortlist) {
    setRoute(key, route);
    if (!solve(key)) continue;
    const worst = measureFresh(key);
    console.log(`  ${(route || 'straight').padEnd(24)} ${(worst * 100).toFixed(0).padStart(3)}cm`);
    if (!best || worst < best.worst) {
      best = { route, worst, file: readFileSync(ARCS_PATH, 'utf8') };
    }
  }
  if (best) {
    writeFileSync(ARCS_PATH, best.file);
    console.log(`  -> ${best.route || 'the straight line'} at ${(best.worst * 100).toFixed(0)}cm`);
  } else {
    copyFileSync(BACKUP, ARCS_PATH);
    console.log('  -> nothing solved; left as it was');
  }
}
unlinkSync(BACKUP);
console.log('\ndone — run blend-check');
