// Posture check: does the rig carry its own weight?
//
// `gait-check` already proves the feet do not skate, which is the arithmetic
// of the walk. This is about everything above the feet — the things that make
// a figure read as a body rather than a puppet on a stick, and every one of
// which is invisible in a still frame and unmistakable in motion:
//
//   counter-rotation  the pelvis and the shoulders wind against each other
//                     across the waist, because the arm that swings forward
//                     belongs to the opposite leg
//   pelvic drop       the hip on the unsupported side falls away, because
//                     nothing is under it
//   head carriage     the head travels less than the hips do, because the
//                     neck spends the whole cycle paying the bob back
//   foot roll         the foot lands on its heel and leaves off its toe
//   contrapposto      standing, the weight drifts from one leg to the other:
//                     the loaded hip rides high and the free knee unlocks
//   banking           a body turning hard leans into the turn
//   head lead         the head goes where it is looking, not where the feet
//                     are pointed
//
// Each is one signed number over a sampled cycle, so a sign flipped anywhere
// in the pose — which is exactly the sort of change that still looks like a
// walk — fails here instead of shipping.
import { chromium } from 'playwright';

const PORT = +(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8099);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 420 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
  timeout: 60000,
});

const out = await page.evaluate(async () => {
  const { poseHumanoid } = await import('/src/render/actors.js');
  const { LOOKS, MOB_LOOKS } = await import('/src/game/content.js');
  const rigs = [
    ...Object.entries(LOOKS),
    ...Object.entries(MOB_LOOKS).filter(([, v]) => (v.plan || 'humanoid') === 'humanoid'),
  ];

  const N = 48;
  const results = [];
  for (const [name, def] of rigs) {
    const build = def.build || {};
    const walk = [];
    for (let i = 0; i < N; i++) {
      const phase = (i / N) * Math.PI * 2;
      walk.push(poseHumanoid({ t: 3, anim: 'idle', animT: 0, speed: 1, phase, facing: 0 }, build));
    }

    // --- counter-rotation ---------------------------------------------------
    // Each girdle's rotation is the sideways offset of its left point: the
    // twist carries it forward or back along the character's own x axis.
    let cross = 0;
    let magS = 0;
    let magP = 0;
    for (const p of walk) {
      const sh = p.shoulderL[0] - p.chest[0];
      const hp = p.hipL[0] - p.hip[0];
      cross += sh * hp;
      magS += sh * sh;
      magP += hp * hp;
    }
    const counter = magS > 1e-9 && magP > 1e-9 ? cross / Math.sqrt(magS * magP) : 0;

    // --- pelvic drop --------------------------------------------------------
    // Sampled where the left foot is planted and the right is in the air.
    let drop = 0;
    let dropN = 0;
    for (const p of walk) {
      const lDown = p.footL[2] < 0.4;
      const rDown = p.footR[2] < 0.4;
      if (lDown && !rDown) {
        drop += p.hipL[2] - p.hipR[2];
        dropN++;
      } else if (rDown && !lDown) {
        drop += p.hipR[2] - p.hipL[2];
        dropN++;
      }
    }
    drop = dropN ? drop / dropN : 0;

    // --- head carriage ------------------------------------------------------
    const span = (f) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of walk) {
        const v = f(p);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return hi - lo;
    };
    const headSpan = span((p) => p.head[2]);
    const hipSpan = span((p) => p.hip[2]);

    // --- foot roll ----------------------------------------------------------
    // Through one leg's stance the ankle must start toes-up and end heel-up,
    // and cross flat exactly once on the way.
    let heelStrike = 0;
    let toeOff = 0;
    let crossings = 0;
    let prev = null;
    for (let i = 0; i < N; i++) {
      const phase = (i / N) * Math.PI; // the left leg's stance is 0..pi
      const p = poseHumanoid({ t: 3, anim: 'idle', animT: 0, speed: 1, phase, facing: 0 }, build);
      if (i === 0) heelStrike = p.ankleL;
      if (i === N - 1) toeOff = p.ankleL;
      if (prev !== null && Math.sign(prev) !== Math.sign(p.ankleL)) crossings++;
      prev = p.ankleL;
    }

    // --- contrapposto -------------------------------------------------------
    // Over the slow standing cycle the loaded hip must change sides, and the
    // knee that is bent must always be the one with no weight on it.
    let swapped = false;
    let firstSign = 0;
    let wrongKnee = 0;
    let stands = 0;
    for (let i = 0; i < 24; i++) {
      const t = i * 1.1;
      const p = poseHumanoid({ t, anim: 'idle', animT: 0, speed: 0, phase: 0, facing: 0 }, build);
      const high = Math.sign(p.hipL[2] - p.hipR[2]);
      if (Math.abs(p.hipL[2] - p.hipR[2]) < 0.5) continue;
      stands++;
      if (!firstSign) firstSign = high;
      else if (high !== firstSign) swapped = true;
      // The bent knee sits further forward of its own hip.
      const bendL = p.kneeL[0] - p.hipL[0];
      const bendR = p.kneeR[0] - p.hipR[0];
      // Loaded side is the high hip; its knee must be the straighter one.
      if (high > 0 ? bendL > bendR : bendR > bendL) wrongKnee++;
    }

    // --- banking ------------------------------------------------------------
    const bank = (turn) =>
      poseHumanoid({ t: 3, anim: 'idle', animT: 0, speed: 1, phase: 0, facing: 0, turn }, build);
    const bankL = bank(4).chest[1] - bank(4).hip[1];
    const bankR = bank(-4).chest[1] - bank(-4).hip[1];

    // --- head lead ----------------------------------------------------------
    const look = (a) =>
      poseHumanoid({ t: 3, anim: 'idle', animT: 0, speed: 1, phase: 0, facing: 0, lookAt: a }, build)
        .headYaw;

    results.push({
      name,
      counter: +counter.toFixed(3),
      drop: +drop.toFixed(2),
      headSpan: +headSpan.toFixed(2),
      hipSpan: +hipSpan.toFixed(2),
      heelStrike: +heelStrike.toFixed(3),
      toeOff: +toeOff.toFixed(3),
      crossings,
      swapped,
      stands,
      wrongKnee,
      bankL: +bankL.toFixed(2),
      bankR: +bankR.toFixed(2),
      lookL: +look(0.8).toFixed(2),
      lookR: +look(-0.8).toFixed(2),
    });
  }
  return results;
});

await browser.close();

let failed = 0;
const fail = (n, msg) => {
  failed++;
  console.log(`FAIL ${n}: ${msg}`);
};

for (const r of out) {
  // Wound against each other, not with each other. -1 is perfect opposition;
  // anything at or above zero means the girdles turn together, which is the
  // marching-toy walk this exists to prevent.
  if (!(r.counter < -0.5)) fail(r.name, `pelvis and shoulders are not counter-rotating (${r.counter})`);
  // The unsupported hip falls; if this comes out positive the tilt is
  // propping up the leg that is in the air.
  if (!(r.drop > 0.6)) fail(r.name, `the unsupported hip does not drop (${r.drop})`);
  if (!(r.headSpan < r.hipSpan * 0.75)) fail(r.name, `the head rides as hard as the hips (${r.headSpan} vs ${r.hipSpan})`);
  if (!(r.heelStrike > 0.15)) fail(r.name, `the foot does not land on its heel (${r.heelStrike})`);
  if (!(r.toeOff < -0.3)) fail(r.name, `the foot does not leave off its toe (${r.toeOff})`);
  if (r.crossings !== 1) fail(r.name, `the ankle crosses flat ${r.crossings} times in one stance, not once`);
  if (!r.swapped) fail(r.name, `standing, the weight never changes legs (${r.stands} samples)`);
  if (r.wrongKnee > 0) fail(r.name, `the bent knee is on the loaded leg in ${r.wrongKnee} of ${r.stands} samples`);
  // Leaning into the turn: opposite signs, and neither of them nothing.
  if (!(r.bankL * r.bankR < 0 && Math.abs(r.bankL) > 0.4)) fail(r.name, `does not bank into a turn (${r.bankL} / ${r.bankR})`);
  if (!(r.lookL > 0.4 && r.lookR < -0.4)) fail(r.name, `the head does not follow what it is looking at (${r.lookL} / ${r.lookR})`);
}

const worstCounter = Math.max(...out.map((r) => r.counter));
const leastDrop = Math.min(...out.map((r) => r.drop));
const worstCarry = Math.max(...out.map((r) => r.headSpan / r.hipSpan));
console.log(`${out.length} humanoid rigs walked through a full cycle`);
console.log(`counter-rotation worst ${worstCounter} (want < -0.5)`);
console.log(`pelvic drop least ${leastDrop} units, head carries ${(worstCarry * 100) | 0}% of the hip's rise at worst`);
console.log(failed ? `${failed} posture fault(s)` : 'every rig carries its own weight');
process.exit(failed ? 1 : 0);
