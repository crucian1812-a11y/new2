// Gait check: does a planted foot stay where it was put?
//
// A walk cycle driven by a timer has no relationship to how fast the figure is
// actually travelling, so its feet skate over the ground — the one thing about
// a moving character that everybody sees and nobody can name. The fix is to
// advance the phase by distance covered and swing the leg through exactly that
// distance, and the fix is only correct if the two agree exactly: change the
// stride on one side and the feet start sliding again, in a way that looks
// almost right in a screenshot and wrong in motion.
//
// So this measures it. Walk each rig forward through one full cycle at the
// stride the game uses, sample where the foot is in *world* space while it is
// on the ground, and report how far it drifts across a stance. A perfectly
// planted foot drifts zero; a foot that ignores the ground drifts a whole
// stride.
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
  const { poseHumanoid, strideChar } = await import('/src/render/actors.js');
  const { LOOKS, MOB_LOOKS } = await import('/src/game/content.js');
  const rigs = { ...LOOKS, ...MOB_LOOKS };
  const res = {};

  for (const [name, def] of Object.entries(rigs)) {
    if (def.plan && def.plan !== 'humanoid') continue;
    const build = def.build || {};
    const stride = strideChar(build);
    const N = 240;
    // Peak-to-peak drift of the foot's world position within each stance.
    let worst = 0;
    let lo = Infinity;
    let hi = -Infinity;
    let down = false;
    for (let i = 0; i <= N; i++) {
      const phase = (i / N) * Math.PI * 2;
      const bodyX = (i / N) * stride;
      const p = poseHumanoid({ t: 0, anim: 'idle', animT: 0, facing: 0, speed: 1, phase }, build);
      const world = bodyX + p.footL[0];
      const onGround = p.footL[2] < 0.5;
      if (onGround) {
        // Skip the first and last sample of a stance: the foot is landing or
        // leaving and is allowed to be moving then.
        if (down) {
          lo = Math.min(lo, world);
          hi = Math.max(hi, world);
        }
        down = true;
      } else if (down) {
        if (hi > lo) worst = Math.max(worst, hi - lo);
        lo = Infinity;
        hi = -Infinity;
        down = false;
      }
    }
    if (hi > lo) worst = Math.max(worst, hi - lo);
    res[name] = { stride: +stride.toFixed(1), drift: +((worst / stride) * 100).toFixed(1) };
  }
  return res;
});

await browser.close();

console.log(JSON.stringify(out, null, 2));
// A foot that ignored the ground entirely would drift a full stride, 100%.
// Everything here lands in single digits; the bar is set where a rig whose
// stride no longer matches its cycle cannot pass.
const MAX = 12;
let failed = 0;
for (const [name, r] of Object.entries(out)) {
  if (!(r.drift <= MAX)) {
    failed++;
    console.log(`FAIL ${name}: foot slides ${r.drift}% of its ${r.stride}-unit stride while planted`);
  }
}
console.log(`${Object.keys(out).length} rigs walked; worst slip ${Math.max(...Object.values(out).map((r) => r.drift))}%`);
console.log(failed ? `${failed} rig(s) skating` : 'every planted foot stays where it was put');
process.exit(failed ? 1 : 0);
