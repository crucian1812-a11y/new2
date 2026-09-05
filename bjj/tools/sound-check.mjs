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
    //
    // Two channels, not one. Everything in this file used to read channel 0 and
    // call it the output, which was true while every sound in the game came out
    // of the middle. A sound with a place in it does not: the whole claim of a
    // pan is that the two channels differ, and a probe that can only see the
    // left one cannot tell a grip on the far side of the mat from a quiet one.
    const probe = a.ctx.createScriptProcessor(4096, 2, 2);
    let peak = 0, peakL = 0, peakR = 0;
    // A running power sum, for the reverb tail below. Peak is the right
    // instrument for a one-shot and the wrong one for a hall: a tail is quiet
    // by definition, and it is its duration — its energy — that says "room"
    // rather than "recording played dry".
    let energy = 0;
    probe.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0);
      const r = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l;
      for (let i = 0; i < l.length; i++) {
        const a0 = Math.abs(l[i]), b0 = Math.abs(r[i]);
        if (a0 > peakL) peakL = a0;
        if (b0 > peakR) peakR = b0;
        const v = Math.max(a0, b0);
        if (v > peak) peak = v;
        energy += l[i] * l[i] + r[i] * r[i];
      }
      for (let c = 0; c < e.outputBuffer.numberOfChannels; c++) e.outputBuffer.getChannelData(c).fill(0);
    };
    a.master.connect(probe);
    probe.connect(a.ctx.destination);

    const once = async (fn, ms, quiet) => {
      // Quiet the room first: the crowd bed is always running and would answer
      // for every one-shot in the list.
      const before = a.crowdGain.gain.value;
      if (quiet) a.crowdGain.gain.value = 0;
      await new Promise((r) => setTimeout(r, 120));
      peak = 0; peakL = 0; peakR = 0;
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

    // The same, keeping the two channels apart. A pan is a claim about the
    // difference between them, and nothing else in this file could see it.
    // Flat rather than nested: the level() above takes the loudest of four
    // passes of four firings, and that is right for "is this audible at all"
    // and wrong here. A pan is a ratio, and a maximum taken over passes takes
    // the two channels' maxima from different passes — which reported a hard-
    // panned slam as dead centre while a probe firing the same sound in one
    // stretch measured it nine to one.
    const sides = async (fn) => {
      // The best-separated of three passes, and separation is the quantity under
      // test — the same logic level() uses for loudness, for the same reason.
      // A headless browser renders the graph in bursts, and a burst that lands
      // across two firings mixes the two channels' peaks together and reports a
      // hard-panned slam as nearly centred. One pass read 80% and the next 5%
      // with nothing changed.
      let best = { l: 0, r: 0 }, sep = -1;
      for (let k = 0; k < 3; k++) {
        const before = a.crowdGain.gain.value;
        a.crowdGain.gain.value = 0;
        // Long enough for the whoosh above — nearly a second, fired four times —
        // to be out of the room before anything here is measured.
        await new Promise((r) => setTimeout(r, 600));
        peakL = 0; peakR = 0;
        for (let j = 0; j < 5; j++) { fn(); await new Promise((r) => setTimeout(r, 160)); }
        await new Promise((r) => setTimeout(r, 250));
        a.crowdGain.gain.value = before;
        const d = Math.abs(peakL - peakR) / Math.max(1e-9, peakL + peakR);
        if (d > sep) { sep = d; best = { l: peakL, r: peakR }; }
      }
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

    // Does a sound know where it is?
    //
    // The listener is put where the ground shot puts it — three metres back,
    // looking at the middle — and the same thud is fired from two metres to
    // either side of the middle. If the pan works, each one is louder on its
    // own side; if it does not, the two readings are the same number twice.
    a.listen([0, 1.2, 3], [0, 0.5, 0]);
    const left = await sides(() => a.thud(1, [-2, 0.3, 0]));
    const right = await sides(() => a.thud(1, [2, 0.3, 0]));

    // And how far. The same sound at the middle of the mat and at eight metres
    // out, which is the far corner of the square: the rolloff is gentle by
    // design, so this asks for a difference rather than for a number.
    const near = await sides(() => a.thud(1, [0, 0.3, 0]));
    const far = await sides(() => a.thud(1, [0, 0.3, -8]));

    // Breathing. Fresh against spent, on the same fighter, with the room
    // quieted — and then the same call while nothing is being asked of it, to
    // check that a breath is a breath and not a tone that never stops.
    // One breath at a time, and the exhale, which is the louder half.
    //
    // The first version drove it at a frame's interval with the schedule forced
    // open, which fires ninety overlapping breaths in a second: both a fresh
    // man and a spent one saturate, and the answer came back 0.8x — a man
    // working flat out quieter than one at rest. Firing them one at a time,
    // far enough apart to decay, is the same question asked so that the answer
    // means something.
    const breathLoud = async (work, gas) => {
      const before = a.crowdGain.gain.value;
      a.crowdGain.gain.value = 0;
      await new Promise((r) => setTimeout(r, 200));
      peak = 0;
      let want = 0;
      for (let k = 0; k < 6; k++) {
        a.breathAt[0] = 0;
        a.breathIn[0] = false;              // the exhale
        want = Math.max(want, a.breathe(0, work, gas, [0, 1.0, 0]));
        await new Promise((r) => setTimeout(r, 700));
      }
      a.crowdGain.gain.value = before;
      return { heard: peak, want };
    };
    const breathFresh = await breathLoud(0.1, 0);
    const breathSpent = await breathLoud(0.9, 1);

    // The hall. A slam has a tail when there is a room around the mat, and the
    // tail is the room: measure the power left after the sample itself has
    // gone, once with the hall and once with the send shut off. The difference
    // is the reverb, and nothing else.
    const hallTail = async (on) => {
      const crowd = a.crowdGain.gain.value;
      a.crowdGain.gain.value = 0;
      const send = a.reverbSend.gain.value;
      if (!on) a.reverbSend.gain.value = 0;
      await new Promise((r) => setTimeout(r, 500));   // settle
      for (let k = 0; k < 3; k++) { a.tap(1, [0, 0.3, 0]); await new Promise((r) => setTimeout(r, 500)); }
      await new Promise((r) => setTimeout(r, 450));   // the sample (0.31 s) is over
      energy = 0;
      await new Promise((r) => setTimeout(r, 1200));  // the hall rings on
      const got = energy;
      a.crowdGain.gain.value = crowd;
      a.reverbSend.gain.value = send;
      return got;
    };
    const hallWet = await hallTail(true);
    const hallDry = await hallTail(false);

    let music = 0;
    if (waitForPack) {
      await a.track('match');
      await new Promise((r) => setTimeout(r, 3000));
      music = await level(() => {}, 800);
    }

    // Does the music lean in with the fight?
    //
    // Asked of what the game schedules, not of the output, for the reason this
    // file already gives about the breath: the drive is a slow lean — a second
    // and a half of smoothing on a track that is thirty decibels down — and a
    // burst probe cannot separate it from its own floor. The game either asks
    // for a louder, brighter track when the pair is working or it does not.
    a.drive(0);
    const calm = { gain: a.driveWant, tone: a.toneWant };
    a.drive(1);
    const hard = { gain: a.driveWant, tone: a.toneWant };
    a.drive(0);

    a.setMuted(true);
    const muted = await level(() => a.bell(), 300, true, 2);
    a.setMuted(false);

    const out = {
      loaded: a.loaded, samples: Object.keys(a.sfx).length, events, room, music, muted,
      left, right, near, far, breathFresh, breathSpent, hallWet, hallDry, calm, hard,
    };
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

// Does a sound know which side of the mat it is on?
//
// Loudest on its own side, and by enough to hear. Two metres either side of the
// middle with the ear three metres back is about fifty degrees of separation,
// which a stereo panner puts several decibels apart; a tenth of the level is a
// margin that a change of sign would fail and a slightly weaker pan would not.
const bias = (x) => (x.l + x.r > 0 ? (x.l - x.r) / (x.l + x.r) : 0);
const bl = bias(result.left), br = bias(result.right);
const panned = bl > 0.1 && br < -0.1;
if (!panned) problems++;
console.log(`${panned ? ' ' : '!'} a sound knows which side it is on   ` +
  `two metres left ${(bl * 100).toFixed(0)}% to the left ear, ` +
  `two metres right ${(-br * 100).toFixed(0)}% to the right`);

// And how far away. Eight metres out is the far corner of the square.
const nearL = Math.max(result.near.l, result.near.r);
const farL = Math.max(result.far.l, result.far.r);
const fades = farL > HEARD && farL < nearL * 0.85;
if (!fades) problems++;
console.log(`${fades ? ' ' : '!'} and how far away it is              ` +
  `${db(nearL)} dBFS in the middle, ${db(farL)} at eight metres`);

// Breathing: there at all, and louder when he is spent than when he is fresh.
// The gap is what carries the information — a breath that does not change is a
// hiss, and the one thing it is for is telling the player the other man is
// done without a bar on the HUD.
// Breathing, in two halves, because one probe cannot answer both.
//
// That it is there at all is a question about the output, and the tap answers
// it. How much deeper it gets is not: a breath is quiet by design — it runs
// under everything for the whole match — and at fifty decibels down it is close
// enough to this probe's own floor that the same pair of readings came back
// 5.3x on one run and 0.7x on the next. That is the burst-rendering problem
// this file already documents for the synthesised fallback, and the answer here
// is the same one: ask the game what it scheduled. The depth of a breath is a
// number the game computes, and it either computes a bigger one for a man with
// nothing left or it does not.
const breathes = result.breathSpent.heard > HEARD;
if (!breathes) problems++;
console.log(`${breathes ? ' ' : '!'} two men breathe                     ` +
  `${db(result.breathSpent.heard)} dBFS at the output`);
const harder = result.breathSpent.want > result.breathFresh.want * 1.5;
if (!harder) problems++;
console.log(`${harder ? ' ' : '!'} and harder when the tank is empty   ` +
  `${(result.breathSpent.want / Math.max(result.breathFresh.want, 1e-9)).toFixed(1)}x deeper as scheduled`);
// Under the room, not beside it. This runs continuously for the whole match.
const under = result.breathSpent.heard < result.room * 1.2;
if (!under) problems++;
console.log(`${under ? ' ' : '!'} and sits under the room             ` +
  `${db(result.breathSpent.heard)} against a room at ${db(result.room)}`);

// The music follows the fight. A track that plays at one level through a stall
// and a scramble alike is scoring nothing; what the ear reads as effort is
// mostly brightness, so the filter carries more of it than the fader does.
const leans = result.hard.gain > result.calm.gain * 1.2;
if (!leans) problems++;
console.log(`${leans ? ' ' : '!'} the music leans in                 ` +
  `${result.calm.gain.toFixed(2)} -> ${result.hard.gain.toFixed(2)} of the fader`);
const opens = result.hard.tone > result.calm.tone * 4;
if (!opens) problems++;
console.log(`${opens ? ' ' : '!'} and opens up                       ` +
  `${(result.calm.tone / 1000).toFixed(1)} -> ${(result.hard.tone / 1000).toFixed(1)} kHz`);

// The hall rings. After the tap's own sample has gone, the reverb keeps the
// room alive; with the send off, the same window is silence. The ratio is the
// claim — a tail ten times the dry floor is a room, and a slam with no hall
// leaves nothing behind it.
const hall = result.hallWet > result.hallDry * 10;
if (!hall) problems++;
console.log(`${hall ? ' ' : '!'} the hall rings                     ` +
  `tail power ${result.hallWet.toExponential(1)} wet, ${result.hallDry.toExponential(1)} with the hall off`);

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
