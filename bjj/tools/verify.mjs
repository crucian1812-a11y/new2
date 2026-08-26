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
  ['baked fighter', 'asset-check.mjs', ['bjj/assets/fighter.bin']],
  ['title-screen hero', 'asset-check.mjs', ['bjj/assets/hero.bin']],
  ['match simulation', 'sim-check.mjs', ['400']],
];
if (withBrowser) steps.push(['browser smoke', 'smoke.mjs', []]);

let failed = 0;
for (const [name, script, args] of steps) {
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(process.execPath, [join(here, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} step(s) failed` : '\neverything green');
process.exit(failed ? 1 : 0);
