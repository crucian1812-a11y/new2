// Steady-state benchmark at pinned quality tiers, after warm-up.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const W = +flag('w', 904);
const H = +flag('h', 407);
const DPR = +flag('dpr', 3);
const PORT = +flag('port', 8099);
const ACT = +flag('act', 0);
const MOBS = +flag('mobs', 12);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: DPR,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
  timeout: 60000,
});
await page.evaluate(
  ([act, mobs]) => {
    const g = window.__game;
    g.newRun('ritter', 12345);
    if (act) g.loadAct(act);
    g.player.level = 20;
    g.recompute();
    for (let i = 0; i < mobs; i++) {
      const a = (i / mobs) * Math.PI * 2;
      g.spawnMonster(g.act.monsters[i % g.act.monsters.length], g.player.x + Math.cos(a) * (200 + i * 12), g.player.y + Math.sin(a) * (200 + i * 12), {});
    }
  },
  [ACT, MOBS]
);
// Warm the chunk cache and let the props bake.
await page.waitForTimeout(2500);

const run = async (quality, scale) => {
  const r = await page.evaluate(
    async ([q, s]) => {
      const R = window.__renderer;
      R.adaptQuality = () => {};
      R.quality = q;
      R.targetScale = s;
      R.renderScale = s;
      R.w = R.h = 0;
      R.resize();
      await new Promise((res) => setTimeout(res, 700));
      const t0 = performance.now();
      let frames = 0;
      let worst = 0;
      let last = t0;
      await new Promise((res) => {
        const tick = () => {
          const n = performance.now();
          if (frames > 3) worst = Math.max(worst, n - last);
          last = n;
          frames++;
          if (n - t0 > 3000) res();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return {
        fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1),
        worstMs: +worst.toFixed(1),
        px: R.w * R.h,
      };
    },
    [quality, scale]
  );
  console.log(`quality ${quality}  scale ${scale.toFixed(2)}  ->  ${r.fps} fps   worst ${r.worstMs}ms   ${(r.px / 1000) | 0}kpx`);
  return r;
};

for (const q of [2, 1, 0]) {
  for (const s of [1.0, 0.75, 0.55]) {
    await run(q, s);
  }
}

await browser.close();
