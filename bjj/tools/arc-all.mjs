// The whole graph of arcs, four at a time.
//
// arc-solve searches one transition at a time and takes about three minutes
// over it, which over sixty-one transitions and twenty hold loops is most of an
// afternoon — long enough that a round of pose work either waits for it or
// invalidates it half way through. The search over one transition is not worth
// parallelising, but the transitions do not know about each other at all: each
// is a blend between two poses, solved from a warm start, and the answer for
// one never depends on the answer for another.
//
// So: quarter the list, run four solvers, stitch the four files together. Each
// child writes a complete arcs.js of its own — its own quarter solved and the
// other three as they came in — so the merge is textual and takes each block
// from the child that owned it. Nothing is re-serialised and nothing is
// re-formatted; the file that lands is a file arc-solve wrote.
//
//   node bjj/tools/arc-all.mjs            report what it would do
//   node bjj/tools/arc-all.mjs --write    and write src/game/arcs.js
//   node bjj/tools/arc-all.mjs --jobs 2   fewer children (default: the cores)
//   node bjj/tools/arc-all.mjs --only A>B,C>D --write   just those

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { TRANSITIONS, visualEnds } from '../src/game/positions.js';
import { HOLD_LOOPS } from '../src/game/poses.js';

const WRITE = process.argv.includes('--write');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',')) : null;
})();
const JOBS = (() => {
  const i = process.argv.indexOf('--jobs');
  return Math.max(1, i >= 0 && process.argv[i + 1] ? +process.argv[i + 1] : cpus().length);
})();

// The same list arc-solve builds, in the same order, so a shard names keys the
// child agrees exist.
const keys = [];
const seen = new Set();
for (const [from, to] of [
  ...TRANSITIONS.flatMap((tr) => visualEnds(tr).map((to) => [tr.from, to])),
  ...Object.entries(HOLD_LOOPS).flatMap(([pos, loop]) => loop.map((v) => [pos, v])),
]) {
  const key = `${from}>${to}`;
  if (from === to || seen.has(key)) continue;
  seen.add(key);
  keys.push(key);
}

const solvingKeys = ONLY ? keys.filter((k) => ONLY.has(k)) : keys;

// Round-robin rather than blocks: a transition out of the stance costs several
// times what a hold loop does, and the expensive ones sit together in the list.
const shards = Array.from({ length: JOBS }, () => []);
solvingKeys.forEach((k, i) => shards[i % JOBS].push(k));

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'arc-all-'));
const solver = join(here, 'arc-solve.mjs');
const target = join(here, '..', 'src', 'game', 'arcs.js');

console.log(`${solvingKeys.length} transitions, ${JOBS} at a time\n`);
const t0 = Date.now();

const runs = shards.filter((s2) => s2.length).map((shard, i) => new Promise((done, fail) => {
  const out = join(dir, `arcs-${i}.js`);
  const args = [solver, '--only', shard.join(','), '--write', '--out', out];
  const child = spawn(process.execPath, args, { env: process.env });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  child.on('error', fail);
  child.on('close', (code) => {
    if (code !== 0) return fail(new Error(`shard ${i} exited ${code}\n${log}`));
    done({ shard, out, log });
  });
}));

const results = await Promise.all(runs);
if (!results.length) {
  console.log('nothing to solve — --only matched no transition');
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
for (const r of results) {
  for (const line of r.log.split('\n')) {
    if (line.trim() && !line.startsWith('wrote ')) console.log(line);
  }
}

// Each child wrote the whole file. Take the header and the vias from the first
// — every child read the same ones — and each arc block from the child that
// solved it. A key nobody wrote is a key with no arc, and stays out.
function blocks(src) {
  const at = src.indexOf('export const ARCS = {');
  const body = src.slice(src.indexOf('\n', at) + 1, src.lastIndexOf('};'));
  const out = new Map();
  const re = /^ {2}'([^']+)': \[\n([\s\S]*?)^ {2}\],$/gm;
  let m;
  while ((m = re.exec(body))) out.set(m[1], m[0]);
  return out;
}
const first = readFileSync(results[0].out, 'utf8');
const head = first.slice(0, first.indexOf('export const ARCS = {') + 'export const ARCS = {\n'.length);
// Every child read the same arcs.js, so any one of them carries the keys this
// run did not solve exactly as they came in; the solved ones are taken from the
// child that owned them.
const merged = blocks(first);
for (const r of results) {
  const own = blocks(readFileSync(r.out, 'utf8'));
  for (const k of r.shard) {
    if (own.has(k)) merged.set(k, own.get(k));
    else merged.delete(k);
  }
}
// Alphabetical, the way arc-solve writes it, so a sharded run and a single
// one leave the same file and the diff is only what actually moved.
const order = [...merged.keys()].sort((a, b) => (a < b ? -1 : 1));
const src = head + order.map((k) => merged.get(k)).join('\n') + '\n};\n';

console.log(`\n${order.length} arcs, ${((Date.now() - t0) / 60000).toFixed(1)} minutes`);
if (WRITE) {
  writeFileSync(target, src);
  console.log(`wrote src/game/arcs.js`);
} else {
  console.log('nothing written (pass --write)');
}
rmSync(dir, { recursive: true, force: true });
