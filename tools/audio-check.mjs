// Verifies the synthesised audio actually produces signal, by tapping the
// master bus with an analyser and measuring RMS while sounds play.
import { chromium } from 'playwright';

const PORT = +(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8099);

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: 900, height: 420 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
  timeout: 60000,
});

const result = await page.evaluate(async () => {
  const mod = await import('/src/core/audio.js');
  const audio = mod.audio;
  audio.init();
  if (!audio.ctx) return { error: 'no AudioContext' };
  if (audio.ctx.state === 'suspended') await audio.ctx.resume();

  const an = audio.ctx.createAnalyser();
  an.fftSize = 2048;
  audio.master.connect(an);
  const buf = new Float32Array(an.fftSize);

  const rms = () => {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  };

  const sample = async (ms) => {
    let peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      peak = Math.max(peak, rms());
      await new Promise((r) => setTimeout(r, 16));
    }
    return +peak.toFixed(5);
  };

  const out = { state: audio.ctx.state, ready: audio.ready };
  // Music bed alone (drone + wind + drum).
  audio.update(0.016, 0.9);
  out.musicPeak = await sample(900);

  const names = ['swing', 'hitFlesh', 'crit', 'thunder', 'levelUp', 'legendary', 'bossRoar', 'potion'];
  out.sfx = {};
  for (const n of names) {
    audio.play(n, { vol: 1 });
    out.sfx[n] = await sample(420);
  }
  // Give the analyser's 2048-sample window time to flush the previous sound
  // before checking that muting really is silent.
  audio.setMuted(true);
  await new Promise((r) => setTimeout(r, 250));
  out.mutedPeak = await sample(400);
  audio.setMuted(false);
  return out;
});

console.log(JSON.stringify(result, null, 2));
const ok =
  result.state === 'running' &&
  result.musicPeak > 0.0005 &&
  Object.values(result.sfx || {}).every((v) => v > 0.001) &&
  result.mutedPeak < 0.0005;
console.log(ok ? 'AUDIO OK' : 'AUDIO PROBLEM');
await browser.close();
process.exit(ok ? 0 : 1);
