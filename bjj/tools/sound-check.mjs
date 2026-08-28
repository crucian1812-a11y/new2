// Does the game actually make a sound?
//
// `audio-check` says the pack is good. That is a different claim from "the
// game plays it": a name misspelt in the table, a fetch relative to the wrong
// base, a method that falls through to the synthesiser because the sample it
// wanted never decoded — none of those throw, and all of them end with the
// game quietly sounding the way it did before the pack arrived.
//
// So this drives the real module in a real browser, waits for the pack, and
// then listens: a tap on the master output that accumulates a peak, and every
// event asked to prove it moved the needle. A method that produces silence, or
// one that never clears the crowd bed, is reported by name.
//
//   node bjj/tools/sound-check.mjs
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'domcontentloaded' });

const { result, fallback } = await page.evaluate(async () => {
  // One harness, used twice: once with the pack reachable and once with every
  // request for it refused. Both halves are measured the same way so the two
  // columns can be read against each other.
  async function probeAudio(Audio, waitForPack) {
    const a = new Audio();
    a.start();
    if (!a.ctx) return { error: 'no AudioContext in this browser' };

    // Wait for the pack, but not forever: the point of the fallback is that
    // the game works without it, so a timeout here is a result, not a crash.
    const t0 = Date.now();
    if (waitForPack) while (!a.loaded && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
    else await new Promise((r) => setTimeout(r, 2000));

    // Every sample that leaves the master, not a snapshot of it.
    //
    // An analyser polled from a timer misses one-shots: a headless browser has
    // no sound card pulling the graph at a steady rate, so it renders in
    // bursts, and a bell that lasts a second can begin and end between two
    // polls. It reported eleven of twelve events as silence while the game was
    // plainly making all of them. A tap on the output that accumulates a peak
    // cannot miss anything.
    const probe = a.ctx.createScriptProcessor(4096, 1, 1);
    let peak = 0;
    probe.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
      e.outputBuffer.getChannelData(0).fill(0);
    };
    a.master.connect(probe);
    probe.connect(a.ctx.destination);

    const once = async (fn, ms, quiet) => {
      // Quiet the room first: the crowd bed is always running and would answer
      // for every one-shot in the list.
      const before = a.crowdGain.gain.value;
      if (quiet) a.crowdGain.gain.value = 0;
      await new Promise((r) => setTimeout(r, 120));
      peak = 0;
      fn();
      await new Promise((r) => setTimeout(r, ms));
      const got = peak;
      if (quiet) a.crowdGain.gain.value = before;
      return got;
    };
    // Four passes and the loudest wins. A headless browser renders the graph in
    // bursts and the probe can miss a block, so a single reading of a one-shot
    // is a lower bound with a long tail: the same bell measured -8 dBFS and -31
    // on two consecutive runs. Repeating turns that into a number worth failing
    // a build over.
    const level = async (fn, ms = 700, quiet = true, passes = 4) => {
      let best = 0;
      for (let k = 0; k < passes; k++) best = Math.max(best, await once(fn, ms, quiet));
      return best;
    };

    const events = {};
    for (const [name, fn] of [
      ['thud', () => a.thud(1)],
      ['cloth', () => a.cloth(1)],
      ['step', () => a.step(1)],
      ['whistle', () => a.whistle()],
      ['bell', () => a.bell()],
      ['tap', () => a.tap()],
      ['lock', () => a.lock()],
      ['click', () => a.click()],
      ['confirm', () => a.confirm()],
      ['timer', () => a.timer()],
      ['whoosh', () => a.whoosh()],
    ]) events[name] = await level(fn);

    // The swell is the room getting louder, so it is measured with the room on.
    const room = await level(() => {}, 500, false);
    events.swell = await level(() => a.swell(0.9, 1.4), 900, false);

    let music = 0;
    if (waitForPack) {
      await a.track('match');
      await new Promise((r) => setTimeout(r, 3000));
      music = await level(() => {}, 800);
    }

    a.setMuted(true);
    const muted = await level(() => a.bell(), 300, true, 2);
    a.setMuted(false);

    const out = { loaded: a.loaded, samples: Object.keys(a.sfx).length, events, room, music, muted };
    // Close it, or the second half of this test runs beside a context that is
    // still mixing a crowd — and two live contexts in one headless tab is how
    // the readings started disagreeing with themselves by twenty decibels.
    probe.disconnect();
    await a.ctx.close();
    return out;
  }

  const { Audio } = await import('/bjj/src/core/audio.js');
  const result = await probeAudio(Audio, true);

  // And the same game with the pack unreachable.
  //
  // The module's whole claim is that a phone that cannot fetch a megabyte of
  // ogg still hears a match. That is a claim about a path nobody walks in
  // testing, so it is walked here: every request for a sample is refused and
  // the same events are asked for again.
  const real = window.fetch;
  window.fetch = (u, ...rest) =>
    String(u).includes('/assets/audio/') ? Promise.reject(new Error('offline'))
                                         : real.call(window, u, ...rest);
  const fallback = await probeAudio(Audio, false);
  window.fetch = real;

  return { result, fallback };
});
await browser.close();

if (result.error) {
  console.log(`! ${result.error}`);
  process.exit(1);
}

// A peak this small is the probe's own floor, not a sound.
const HEARD = 0.002;
// And being audible at all is not the bar. The crowd bed runs under everything
// for the whole match, so an event quieter than the room is an event the
// player never hears — which is what the first pass at the UI click was, six
// decibels under the crowd and reported as working.
const db = (v) => (v <= 0 ? '-inf' : (20 * Math.log10(v)).toFixed(1));

let problems = 0;
console.log(`  pack ${result.loaded ? 'loaded' : 'DID NOT load in 30s'} — ${result.samples}/20 samples decoded`);
if (!result.loaded || result.samples < 20) problems++;

for (const [name, peak] of Object.entries(result.events)) {
  const silent = peak <= HEARD;
  // The swell is the room, so it is not judged against the room.
  const quiet = !silent && name !== 'swell' && peak < result.room * 1.4;
  if (silent || quiet) problems++;
  console.log(`${silent || quiet ? '!' : ' '} ${name.padEnd(10)} peak ${db(peak).padStart(6)} dBFS` +
    (silent ? '   silent' : quiet ? '   lost under the crowd' : ''));
}

console.log(`  the room on its own       ${db(result.room).padStart(6)} dBFS`);
if (result.room <= HEARD) { console.log('! the crowd bed is silent'); problems++; }

console.log(`  a music track under it    ${db(result.music).padStart(6)} dBFS`);
if (result.music <= HEARD) { console.log('! no music reached the output'); problems++; }

console.log(`  muted                     ${db(result.muted).padStart(6)} dBFS`);
if (result.muted > HEARD) { console.log('! mute does not mute'); problems++; }

console.log(`\n  with the pack unreachable — ${fallback.samples} samples, synthesis only:`);
// This half is a liveness test, not a level test, and the difference is worth
// stating. Everything synthesised is *scheduled*, and a headless browser
// renders the graph in long bursts, so a scheduled envelope is partly mixed
// before the main thread's clock catches up and reads back ten to twenty
// decibels under what a real device plays. The crowd bed is a constant gain
// and is measured properly, which makes comparing the two here unfair in a
// direction that would fail honest sounds. So: does anything come out at all.
for (const name of ['thud', 'cloth', 'whistle', 'bell', 'swell']) {
  const ok = fallback.events[name] > HEARD;
  if (!ok) problems++;
  console.log(`${ok ? ' ' : '!'}   ${name.padEnd(8)} peak ${db(fallback.events[name]).padStart(6)} dBFS`);
}
console.log(`    the room                ${db(fallback.room).padStart(6)} dBFS`);
if (fallback.samples) { console.log('! samples decoded despite the network being refused'); problems++; }

if (errors.length) {
  problems += errors.length;
  for (const e of errors) console.log(`! page error: ${e}`);
}

console.log(problems ? `\n${problems} problem(s)` : '\nevery sound the game asks for reaches the output');
process.exit(problems ? 1 : 0);
