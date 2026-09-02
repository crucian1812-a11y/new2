// Everything that has to stay green, in one command.
//
//   node bjj/tools/verify.mjs            # logic only, no browser needed
//   node bjj/tools/verify.mjs --browser  # plus a real frame on a real GPU path
//
// The first two checks are pure modules and take under a second, which is the
// point: pose work and balance work both get a fast answer.

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const withBrowser = process.argv.includes('--browser');

const steps = [
  ['pose lint', 'pose-check.mjs', []],
  ['transition lint', 'blend-check.mjs', []],
  // Whether the bodies themselves are possible. It was written, it was used to
  // find eighty-five joints outside human range, and it was never added here —
  // so when the measure inside it turned out to be reading a roll nothing
  // controls, nothing was watching.
  ['joints', 'joint-check.mjs', []],
  ['baked fighter', 'asset-check.mjs', ['bjj/assets/fighter.bin']],
  ['the opponent', 'asset-check.mjs', ['bjj/assets/fighter-b.bin']],
  // Where the triangles went, against where the camera looks. Forty seconds,
  // because it skins two meshes through the real camera over real matches; the
  // cheaper question — does the surface survive thinning — asset-check already
  // asks, and it was the only one being asked.
  ['the budget', 'budget-check.mjs', []],
  ['club marks', 'mark-check.mjs', []],
  ['match simulation', 'sim-check.mjs', ['400']],
  ['the way out', 'escape-check.mjs', ['240']],
  ['how it flows', 'flow-check.mjs', ['40']],
];
if (withBrowser) {
  steps.push(['browser smoke', 'smoke.mjs', []]);
  steps.push(['sound', 'sound-check.mjs', []]);
  steps.push(['the cost of a frame', 'frame-check.mjs', []]);
  steps.push(['how it reads', 'look-check.mjs', []]);
}
// Not in the battery, on purpose, and both are worth running by hand:
//
//   node bjj/tools/net-check.mjs     a minute, because it measures a minute
//   node bjj/tools/thumb.mjs         several, because it plays matches in real
//                                    time — the whole subject is human timing
//                                    and there is no fast-forwarding it

let failed = 0;
for (const [name, script, args] of steps) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(process.execPath, [join(here, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} step(s) failed` : '\neverything green');
process.exit(failed ? 1 : 0);
