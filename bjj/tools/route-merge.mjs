// Stitch several route searches into one arcs.js.
//
// `arc-all` shards `arc-solve` across the cores and `route-arc` has no such
// thing, which matters more than it sounds: route-arc solves an arc per
// candidate route from cold, eleven minutes each, so nine transitions at four
// candidates is most of a working day on one core and under two hours on four.
//
// It cannot be sharded the way arc-all is. arc-solve writes its answer to a
// `--out` file and reads nothing it writes; route-arc *tries* a route by
// writing it into arcs.js and solving against that, so two of them in one tree
// would be reading each other's guesses. So each search gets a copy of the
// tree and its own TMPDIR (the crash-guard's backup lives there and is a fixed
// name), and this puts the answers back together:
//
//   for i in 0 1 2 3; do mkdir -p $W/sh$i/tmp && cp -r bjj $W/sh$i/; done
//   ( cd $W/sh0 && TMPDIR=$W/sh0/tmp node bjj/tools/route-arc.mjs --only 'A>B,C>D' & )
//   ...
//   node bjj/tools/route-merge.mjs --write \
//     $W/sh0/bjj/src/game/arcs.js 'A>B,C>D' $W/sh1/bjj/src/game/arcs.js 'E>F' ...
//
// Two maps move, not one. arc-all merges the arcs and takes the vias from any
// child because it never changes them; a route search changes precisely the
// vias, so a merge that copied arc-all would keep every new arc and throw away
// every route that earned it — a file that is internally wrong and that
// nothing in the battery would call a lie, because every arc in it is a real
// arc for some route.
//
// A key can also be absent from either map: no waypoint, or no correction
// needed. Absence is an answer and it is carried over like any other.
//
//   node bjj/tools/route-merge.mjs FILE 'KEYS' [FILE 'KEYS' ...]   report
//   node bjj/tools/route-merge.mjs --write ...                     and write it
//   node bjj/tools/route-merge.mjs --self-check                    prove it round-trips
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ARCS_PATH = join(here, '../src/game/arcs.js');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const SELF = args.includes('--self-check');
const rest = args.filter((a) => !a.startsWith('--'));

// The two maps, each as a map from key to the exact text that defines it, so
// what lands is what a solver wrote rather than something re-serialised.
const VIA_RE = /^ {2}'([^']+)': '[^']*',$/gm;
const ARC_RE = /^ {2}'([^']+)': \[\n[\s\S]*?^ {2}\],$/gm;

function split(src) {
  const vAt = src.indexOf('export const VIAS = {');
  const aAt = src.indexOf('export const ARCS = {');
  if (vAt < 0 || aAt < 0 || aAt < vAt) throw new Error('not an arcs.js: one of the two maps is missing');
  const vHead = src.slice(0, vAt + 'export const VIAS = {\n'.length);
  const vBody = src.slice(vHead.length, src.lastIndexOf('};', aAt));
  const between = src.slice(src.lastIndexOf('};', aAt), aAt + 'export const ARCS = {\n'.length);
  const aBody = src.slice(aAt + 'export const ARCS = {\n'.length, src.lastIndexOf('};'));
  const tail = src.slice(src.lastIndexOf('};'));
  const grab = (body, re) => {
    const out = new Map();
    let m; re.lastIndex = 0;
    while ((m = re.exec(body))) out.set(m[1], m[0]);
    return out;
  };
  return { vHead, between, tail, vias: grab(vBody, VIA_RE), arcs: grab(aBody, ARC_RE) };
}

// Alphabetical, the way arc-solve writes it, so a sharded run and a single one
// leave the same file and the diff is only what actually moved.
const order = (m) => [...m.keys()].sort((a, b) => (a < b ? -1 : 1));
const build = (base) =>
  base.vHead + order(base.vias).map((k) => base.vias.get(k)).join('\n') + '\n' +
  base.between + order(base.arcs).map((k) => base.arcs.get(k)).join('\n') + '\n' + base.tail;

// Does taking nothing from anybody give back exactly the file we started with?
// If it does not, the parse is losing something and no merge below is worth
// reading. Cheap enough to run on every merge rather than only when asked.
const baseSrc = readFileSync(ARCS_PATH, 'utf8');
const base = split(baseSrc);
if (build(base) !== baseSrc) {
  console.error('the parse does not round-trip arcs.js — refusing to merge');
  process.exit(1);
}
console.log(`arcs.js round-trips: ${base.vias.size} vias, ${base.arcs.size} arcs`);
if (SELF) process.exit(0);

if (!rest.length || rest.length % 2) {
  console.error('name each shard and what it owned: FILE "A>B,C>D" FILE "E>F" ...');
  process.exit(1);
}

let moved = 0, dropped = 0;
for (let i = 0; i < rest.length; i += 2) {
  const shard = split(readFileSync(rest[i], 'utf8'));
  for (const key of rest[i + 1].split(',').map((s) => s.trim()).filter(Boolean)) {
    for (const [name, mine, theirs] of [['via', base.vias, shard.vias], ['arc', base.arcs, shard.arcs]]) {
      const had = mine.has(key), has = theirs.has(key);
      if (has) { if (mine.get(key) !== theirs.get(key)) moved++; mine.set(key, theirs.get(key)); }
      else if (had) { mine.delete(key); dropped++; console.log(`  ${key}  ${name} dropped`); }
    }
    const via = base.vias.get(key);
    console.log(`  ${key.padEnd(30)} ${via ? via.trim().split(': ')[1].replace(/[',]/g, '') : 'straight line'}`);
  }
}

console.log(`\n${moved} entr(ies) moved, ${dropped} dropped`);
if (WRITE) { writeFileSync(ARCS_PATH, build(base)); console.log('wrote src/game/arcs.js'); }
else console.log('nothing written (pass --write)');
