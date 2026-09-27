// Bring transitions solved in other checkouts back into this arcs.js.
//
// route-arc solves one transition at a time and writes arcs.js as it goes —
// the route into VIAS, the correction into ARCS — so two of them cannot share
// a file, and at half an hour a transition a list of twenty-three is a night
// on one core. Run them in git worktrees instead, one per core, each with its
// own TMPDIR (the backup route-arc keeps lives in tmpdir()), and then take each
// transition's VIAS line and ARCS block from the checkout that solved it:
//
//   git worktree add --detach ../wt0 HEAD     (and wt1, wt2, …)
//   (cd ../wt0 && TMPDIR=$PWD/tmp node bjj/tools/route-arc.mjs --only 'A>B,C>D' --routes 6)
//   node bjj/tools/arcs-merge.mjs ../wt0:'A>B,C>D' ../wt1:'E>F'
//
// A transition the other checkout has no route or no arc for loses its own
// here too: that is what the solver decided. Nothing else in the file moves.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = new URL('../src/game/arcs.js', import.meta.url);

function section(src, name) {
  const head = `export const ${name} = {\n`;
  const i = src.indexOf(head) + head.length;
  return [i, src.indexOf('\n};', i)];
}
function vias(src) {
  const [i, j] = section(src, 'VIAS');
  const out = new Map();
  for (const line of src.slice(i, j).split('\n')) {
    const m = /^\s*'([^']+)': '[^']*',/.exec(line);
    if (m) out.set(m[1], line);
  }
  return out;
}
function arcs(src) {
  const [i, j] = section(src, 'ARCS');
  const out = new Map();
  for (const m of src.slice(i, j).matchAll(/^ {2}'([^']+)': \[\n[\s\S]*?^ {2}\],$/gm)) out.set(m[1], m[0]);
  return out;
}
function put(src, name, key, block, read) {
  const [i, j] = section(src, name);
  let body = src.slice(i, j);
  const have = read(src).get(key);
  if (have) {
    if (block) body = body.replace(have, block);
    else body = body.includes(have + '\n') ? body.replace(have + '\n', '') : body.replace('\n' + have, '');
  } else if (block) {
    body = body.trim() ? `${body}\n${block}` : block;
  }
  return src.slice(0, i) + body + src.slice(j);
}

let src = readFileSync(HERE, 'utf8');
for (const spec of process.argv.slice(2)) {
  const at = spec.indexOf(':');
  const dir = spec.slice(0, at), keys = spec.slice(at + 1).split(',').filter(Boolean);
  const other = readFileSync(join(dir, 'bjj/src/game/arcs.js'), 'utf8');
  const ov = vias(other), oa = arcs(other);
  for (const key of keys) {
    src = put(src, 'VIAS', key, ov.get(key), vias);
    src = put(src, 'ARCS', key, oa.get(key), arcs);
    console.log(`${key.padEnd(30)} ${ov.has(key) ? 'route' : 'straight'}, ${oa.has(key) ? 'arc' : 'no arc'}`);
  }
}
writeFileSync(HERE, src);
