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
  // No time smoothing: the default averages each bin over about a fifth of a
  // second, which flattens a decaying probe tone into the noise around it and
  // makes a sixty-decibel difference read as four.
  an.smoothingTimeConstant = 0;
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

  // Level in dB at one frequency, read from the three bins around it. A wider
  // band, or an average, buries the answer: the drum and the wind put a floor
  // across the spectrum that both readings would end up measuring instead.
  const levelAt = (target) => {
    const f = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(f);
    const hz = audio.ctx.sampleRate / 2 / f.length;
    const c = Math.round(target / hz);
    let peak = -200;
    for (let i = Math.max(0, c - 1); i <= Math.min(f.length - 1, c + 1); i++) {
      if (f[i] > peak) peak = f[i];
    }
    return +peak.toFixed(2);
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

  // The one-shots the acts' beds throw into the dark.
  const ambient = ['gull', 'crow', 'owl', 'wolf', 'drip', 'frog', 'creakIron', 'creakWood', 'iceGroan', 'farThunder', 'heartbeat', 'step'];
  out.ambient = {};
  for (const n of ambient) {
    audio.play(n, { vol: 1 });
    out.ambient[n] = await sample(340);
    audio._lastPlay.clear(); // `step` throttles itself
  }

  // Every act's bed, alone: score and effects muted so only the air is left.
  const music = audio.musicBus.gain.value;
  audio.musicBus.gain.value = 0;
  out.beds = {};
  for (const b of ['coast', 'forest', 'bog', 'castle', 'grove']) {
    audio.setAmbience(b);
    await new Promise((r) => setTimeout(r, 700));
    out.beds[b] = await sample(700);
  }
  audio.setAmbience(null);
  audio.musicBus.gain.value = music;
  await new Promise((r) => setTimeout(r, 900));

  // The same sound at the listener's feet and three screens away.
  audio.setListener(0, 0, 900);
  audio.play('bossRoar', { vol: 1, x: 0, y: 0 });
  out.near = await sample(500);
  audio.play('bossRoar', { vol: 1, x: 2700, y: 0 });
  out.far = await sample(500);

  // Bleeding out: the top of the mix should measurably go away. Driven through
  // the real game rather than by poking the mixer, because the running loop
  // owns the stress level and resets it whenever nobody is bleeding — the only
  // honest way to ask is to wound the hero. The score and the bed are held
  // silent meanwhile so the probe tone is the only thing up there.
  const loudest = async (ms, freq) => {
    let best = -200;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      best = Math.max(best, levelAt(freq));
      await new Promise((r) => setTimeout(r, 16));
    }
    return best;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const g = window.__game;
  g.newRun('ritter', 999);
  await wait(1200);
  g.monsters.length = 0;
  g.spawnTimer = 999;
  audio.musicBus.gain.value = 0;
  audio.bedBus.gain.value = 0;
  const hurt = async (frac, settleMs) => {
    g.player.hp = Math.max(1, g.stats.maxLife * frac);
    await wait(settleMs);
    // A held tone rather than a hiss: noise spreads its energy across every
    // bin of the analyser and lands near the floor whether it is filtered or
    // not, while a sine puts all of it in one bin where the filter's work is
    // impossible to miss.
    audio.tone({ freq: 9000, dur: 1.2, gain: 0.9, type: 'sine' });
    return loudest(800, 9000);
  };
  out.brightWell = await hurt(1, 900);
  out.brightDying = await hurt(0.03, 1800);
  g.player.hp = g.stats.maxLife;
  audio.musicBus.gain.value = music;
  audio.bedBus.gain.value = 0.9;
  await wait(600);
  // Give the analyser's 2048-sample window time to flush the previous sound
  // before checking that muting really is silent.
  audio.setMuted(true);
  await new Promise((r) => setTimeout(r, 250));
  out.mutedPeak = await sample(400);
  audio.setMuted(false);
  return out;
});

console.log(JSON.stringify(result, null, 2));
const quiet = (o) => Object.entries(o || {}).filter(([, v]) => !(v > 0.001)).map(([k]) => k);
const problems = [];
if (result.state !== 'running') problems.push('context not running');
if (!(result.musicPeak > 0.0005)) problems.push('no music');
for (const k of quiet(result.sfx)) problems.push(`silent effect: ${k}`);
for (const k of quiet(result.ambient)) problems.push(`silent ambient sound: ${k}`);
for (const [k, v] of Object.entries(result.beds || {})) {
  if (!(v > 0.0004)) problems.push(`silent bed: ${k}`);
}
// Three screens away should be a small fraction of underfoot, not a shade of it.
if (!(result.far < result.near * 0.5)) {
  problems.push(`distance does not attenuate (near ${result.near}, far ${result.far})`);
}
// Dying should cost the mix real high end — a few dB is noise, this is a wall.
if (!(result.brightDying < result.brightWell - 6)) {
  problems.push(`stress filter did not dull the mix (${result.brightWell} → ${result.brightDying} dB)`);
}
if (!(result.mutedPeak < 0.0005)) problems.push('muting is not silent');
for (const p of problems) console.log('FAIL ' + p);
const ok = problems.length === 0;
console.log(ok ? 'AUDIO OK' : 'AUDIO PROBLEM');
await browser.close();
process.exit(ok ? 0 : 1);
