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
// Not the game's own page.
//
// `index.html` starts the render loop, and a ScriptProcessorNode — which is
// what the tap on the master output below is — runs on the main thread. With
// WebGL drawing on the same thread it starves, and the same UI click measured
// -21 dBFS on one run and -73 on the next. A bare directory listing on the
// same origin loads the module, serves the pack, and renders nothing.
await page.goto(`http://127.0.0.1:${PORT}/bjj/assets/`, { waitUntil: 'domcontentloaded' });

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
      // Fired several times inside the window, not once. The probe cannot miss
      // a sound it renders, but a headless browser renders in bursts and can
      // hand back a block that happens to fall between two of them; four
      // firings and the loudest sample of all of them is a floor test that
      // does not depend on that luck.
      for (let k = 0; k < 4; k++) {
        fn();
        await new Promise((r) => setTimeout(r, ms / 4));
      }
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

    // The room first, before anything else has sounded.
    //
    // It used to be measured after the twelve one-shots, and the last of them
    // — a whoosh, nearly a second long, fired four times — was still ringing:
    // the bed read -10 dBFS against a true -30, and every event was then
    // judged against a room twenty decibels too loud.
    await new Promise((r) => setTimeout(r, 1200));
    const room = await level(() => {}, 500, false);

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
  //
  // Asked for, and counted — not listened to. The tap on the master output
  // measures the sampled half fine and is useless on this one: everything
  // synthesised is *scheduled*, and a ScriptProcessor in a headless build
  // hands back silent input buffers for scheduled sources often enough that
  // the same bell measured -8 dBFS and -80 on consecutive runs. A source that
  // fed the probe directly measured silence too, which is how it was pinned on
  // the probe rather than on the game. So the question this half asks is the
  // one it can answer: with the pack refused, does every event still build the
  // oscillators and buffers it is supposed to build?
  const real = window.fetch;
  window.fetch = (u, ...rest) =>
    String(u).includes('/assets/audio/') ? Promise.reject(new Error('offline'))
                                         : real.call(window, u, ...rest);
  const { Audio: Audio2 } = await import('/bjj/src/core/audio.js?offline=' + Math.random());
  const a2 = new Audio2();
  a2.start();
  await new Promise((r) => setTimeout(r, 1500));
  let built = 0;
  const osc = a2.ctx.createOscillator.bind(a2.ctx);
  const src = a2.ctx.createBufferSource.bind(a2.ctx);
  a2.ctx.createOscillator = () => { built++; return osc(); };
  a2.ctx.createBufferSource = () => { built++; return src(); };
  const fallback = { samples: Object.keys(a2.sfx).length, events: {} };
  for (const [name, fn] of [
    ['thud', () => a2.thud(1)], ['cloth', () => a2.cloth(1)], ['whistle', () => a2.whistle()],
    ['bell', () => a2.bell()], ['tap', () => a2.tap()], ['click', () => a2.click()],
    ['confirm', () => a2.confirm()], ['timer', () => a2.timer()],
  ]) {
    built = 0;
    fn();
    fallback.events[name] = built;
  }
  await a2.ctx.close();
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

// And too loud is a fault as well as too quiet. Nothing should reach the top of
// the scale on its own: the room, the music and two or three of these play at
// once, and a one-shot that peaks at 0 dBFS by itself is a one-shot that
// crackles in company. Both of the levels raised earlier in this project were
// raised on a meter that was reading twenty decibels low, and they came out at
// +1 dBFS.
const HOT = Math.pow(10, -1 / 20);
for (const [name, peak] of Object.entries(result.events)) {
  const silent = peak <= HEARD;
  // The swell is the room, so it is not judged against the room.
  const quiet = !silent && name !== 'swell' && peak < result.room * 1.4;
  const hot = peak > HOT;
  if (silent || quiet || hot) problems++;
  console.log(`${silent || quiet || hot ? '!' : ' '} ${name.padEnd(10)} peak ${db(peak).padStart(6)} dBFS` +
    (silent ? '   silent' : quiet ? '   lost under the crowd' : hot ? '   clips against everything else' : ''));
}

console.log(`  the room on its own       ${db(result.room).padStart(6)} dBFS`);
if (result.room <= HEARD) { console.log('! the crowd bed is silent'); problems++; }

console.log(`  a music track under it    ${db(result.music).padStart(6)} dBFS`);
if (result.music <= HEARD) { console.log('! no music reached the output'); problems++; }

console.log(`  muted                     ${db(result.muted).padStart(6)} dBFS`);
if (result.muted > HEARD) { console.log('! mute does not mute'); problems++; }

console.log(`\n  with the pack unreachable — ${fallback.samples} samples, synthesis only:`);
for (const [name, built] of Object.entries(fallback.events)) {
  const ok = built > 0;
  if (!ok) problems++;
  console.log(`${ok ? ' ' : '!'}   ${name.padEnd(8)} ${built} source(s) built`);
}
if (fallback.samples) { console.log('! samples decoded despite the network being refused'); problems++; }

if (errors.length) {
  problems += errors.length;
  for (const e of errors) console.log(`! page error: ${e}`);
}

console.log(problems ? `\n${problems} problem(s)` : '\nevery sound the game asks for reaches the output');
process.exit(problems ? 1 : 0);
