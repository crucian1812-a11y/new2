// Per-stage frame profiler. Wraps renderer/game methods and reports the
// average cost of each in milliseconds.
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
await page.evaluate(() => window.__game.newRun('ritter', 12345));
await page.waitForTimeout(800);

const result = await page.evaluate(async () => {
  const R = window.__renderer;
  const G = window.__game;
  const times = {};
  const wrap = (obj, name, label) => {
    const orig = obj[name].bind(obj);
    obj[name] = (...a) => {
      const t = performance.now();
      const r = orig(...a);
      times[label] = (times[label] || 0) + (performance.now() - t);
      return r;
    };
  };
  wrap(R, 'drawGround', 'ground');
  wrap(R, 'drawWetSheen', 'wetSheen');
  wrap(R, 'drawDecals', 'decals');
  wrap(R, 'flushQueue', 'sprites');
  wrap(R, 'renderLightmap', 'lightmap');
  wrap(R, 'compositeLight', 'compositeLight');
  wrap(R, 'renderBloom', 'bloom');
  wrap(R, 'drawFog', 'fog');
  wrap(R, 'drawVignetteAndGrade', 'vignette');
  wrap(G, 'queueProps', 'queueProps');
  wrap(G, 'queueEntities', 'queueEntities');
  wrap(G, 'drawGroundEffects', 'groundFX');
  wrap(G.fx, 'draw', 'particles');
  wrap(G.fx, 'drawWeather', 'weather');
  wrap(G.fx, 'drawText', 'text');
  wrap(G, 'update', 'update');
  wrap(window.__hud, 'draw', 'hud');

  const t0 = performance.now();
  let frames = 0;
  await new Promise((res) => {
    const tick = () => {
      frames++;
      if (performance.now() - t0 > 4000) res();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const total = performance.now() - t0;
  const out = { frames, totalMs: +total.toFixed(0), fps: +(frames / (total / 1000)).toFixed(1), stages: {} };
  for (const k in times) out.stages[k] = +(times[k] / frames).toFixed(2);
  out.propsInView = G.zone.props.length;
  out.renderScale = R.renderScale;
  out.backing = R.w + 'x' + R.h;
  return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
