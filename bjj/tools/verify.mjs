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
  // Whether the solver and the judge measure the same mat. blend-check reads
  // the real baked skin; arc-solve cannot afford to and reads a fitted model
  // of it. Two rulers is how this project lost a round to a nine-number table
  // that was out by twelve centimetres, and nothing subtracted one from the
  // other until this existed.
  ['one mat, one ruler', 'ruler-check.mjs', []],
  // And whether every arc in that file is earning its place. An arc that
  // changes nothing is invisible to blend-check — a blend it does not move
  // is a blend that reads fine — and it is not free: STANDING>STANDING_WORK
  // corrected 0cm to 0cm and cost seven and a half teleports a minute.
  ['every arc pays', 'idle-check.mjs', []],
  // Whether the bodies themselves are possible. It was written, it was used to
  // find eighty-five joints outside human range, and it was never added here —
  // so when the measure inside it turned out to be reading a roll nothing
  // controls, nothing was watching.
  ['joints', 'joint-check.mjs', []],
  // Whether a pose holds itself up: where the weight is, what is resting on
  // what, and whether anybody is inside the mat or hanging above it. pose-check
  // asks whether the bodies are possible; this asks whether they are standing.
  ['weight', 'weight-check.mjs', []],
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
  // And whether the bodies shake. Everything above measures the plan — the
  // poses, the path between them, whether the blend parameter jumps. None of it
  // had ever looked at where a knee was on two consecutive frames.
  ['shake', 'shake-check.mjs', ['12']],
  // And whether the shot contains the fight. The camera framed by the shot
  // alone and had no idea what was in front of it: inside a submission the pair
  // filled 113% of the frame and something was cropped on every single frame.
  ['the shot', 'camera-check.mjs', ['12']],
  // Whether a person can win. Everything above this line measures the game
  // against itself, and the game against itself was balanced while the half a
  // human plays was impossible: the AI never reads the prompt on the screen,
  // so nothing here noticed that the window to answer an attack was shorter
  // than a hand.
  ['a hand on it', 'human-check.mjs', ['120']],
  // And whether what the game says about the match afterwards is true.
  ['the разбор', 'tape-check.mjs', ['120']],
  // Whether the ring can be pressed the way it looks like it can. Everything
  // that plays this game swipes, so nothing here could see that a tap on the
  // button marked «+4» fought for a grip instead.
  ['the ring is buttons', 'ring-check.mjs', []],
];
if (withBrowser) {
  steps.push(['browser smoke', 'smoke.mjs', []]);
  steps.push(['sound', 'sound-check.mjs', []]);
  steps.push(['the cost of a frame', 'frame-check.mjs', []]);
  steps.push(['how it reads', 'look-check.mjs', []]);
  steps.push(['a tap on a button', 'tap-check.mjs', []]);
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
