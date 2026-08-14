// Turns individual render stages off one at a time to find what actually
// costs frame time (JS timers lie — canvas work is deferred to flush).
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
await page.waitForTimeout(600);

const measure = async (label, setup) => {
  const fps = await page.evaluate(
    async ([code, ms]) => {
      // eslint-disable-next-line no-new-func
      new Function(code)();
      await new Promise((r) => setTimeout(r, 250));
      const t0 = performance.now();
      let frames = 0;
      await new Promise((res) => {
        const tick = () => {
          frames++;
          if (performance.now() - t0 > ms) res();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return +(frames / ((performance.now() - t0) / 1000)).toFixed(1);
    },
    [setup, 2200]
  );
  console.log(label.padEnd(30), fps, 'fps');
  return fps;
};

const noop = 'function(){}';
await measure('baseline', '');
await measure('no props', 'window.__savedProps = window.__game.zone.props; window.__game.zone.props = [];');
await measure('props back', 'window.__game.zone.props = window.__savedProps;');
await measure('no sprite relight', 'window.__renderer.relightSprite = ' + noop + ';');
await measure('no composite light', 'window.__renderer.compositeLight = ' + noop + ';');
await measure('no bloom', 'window.__renderer.renderBloom = ' + noop + ';');
await measure('no fog', 'window.__renderer.drawFog = ' + noop + ';');
await measure('no vignette/grain', 'window.__renderer.drawVignetteAndGrade = ' + noop + ';');
await measure('no wet sheen', 'window.__renderer.drawWetSheen = ' + noop + ';');
await measure('no weather', 'window.__game.fx.drawWeather = ' + noop + ';');
await measure('no hud', 'window.__hud.draw = function(){ this.buttons.length=0; };');
await measure('no ground', 'window.__renderer.drawGround = ' + noop + ';');
await measure('no sprites', 'window.__renderer.flushQueue = function(){ this.queue.length = 0; };');
await measure('renderScale 0.5', 'window.__renderer.targetScale=0.5;window.__renderer.renderScale=0.5;window.__renderer.w=0;window.__renderer.resize();');

await browser.close();
