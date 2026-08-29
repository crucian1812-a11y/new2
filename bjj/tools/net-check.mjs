// What the first minute is like on a slow line.
//
// Everything else about the sound is measured on a machine with the whole pack
// already on disk and a loopback server serving it in microseconds. That is
// not the machine the game runs on. The pack is 1.4 MB, of which 1.06 MB is
// five music tracks, and a track is fetched only when it is wanted — so on a
// phone on mobile data the match theme starts downloading at the bell and
// arrives somewhere in the first exchange.
//
// `sound-check` proves the synthesised layer works when the pack is refused
// outright. It says nothing about the case that actually happens, which is the
// pack still coming down. This measures that case: the browser is throttled to
// a real mobile line and asked the two questions a player would notice.
//
//   how long until the page draws, and how many bytes it needed
//   how long until there is music, and how long the music is missing for
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.
//
//   node bjj/tools/net-check.mjs            1.5 Mbit/s, 300 ms
//   node bjj/tools/net-check.mjs --fast     8 Mbit/s, 80 ms, for comparison

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const FAST = process.argv.includes('--fast');
// A 3G line that is not having a good day, which is the line the game has to
// be usable on. --fast is the same run on a decent connection, for the sake of
// telling "slow because of the network" from "slow anyway".
const LINE = FAST
  ? { name: '8 Mbit/s, 80 ms', down: (8e6 / 8), latency: 80 }
  : { name: '1.5 Mbit/s, 300 ms', down: (1.5e6 / 8), latency: 300 };
// The bell, in the timeline below: the title card is up this long before the
// match starts, which is about as fast as anybody gets through it.
const BELL = 5;
const MINUTE = 45;
// Below this the output is silence rather than a quiet passage.
const HEARD = 0.004;

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function throttle(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: LINE.latency,
    downloadThroughput: LINE.down, uploadThroughput: LINE.down / 4,
  });
  return cdp;
}

console.log(`the line: ${LINE.name}\n`);

/* ------------------------------------------------------- the page itself */

// Bytes over the wire, not bytes on disk: what a phone waits for is the
// encoded length plus headers, and the first frame is the moment the loading
// card can go.
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await throttle(page);
  let bytes = 0;
  const each = new Map();
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  cdp.on('Network.responseReceived', (e) => each.set(e.requestId, e.response.url));

  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'commit' });
  // The game draws one frame before it takes the loading card down, and
  // __stats is written every frame after that.
  await page.waitForFunction(() => window.__stats, null, { timeout: 60000 });
  const drawn = (Date.now() - t0) / 1000;
  const atFrame = bytes;
  // And what the whole of it costs, so the first-frame figure has a scale.
  await page.waitForTimeout(3000);
  console.log(`  first frame at ${drawn.toFixed(1)}s after ${(atFrame / 1024).toFixed(0)} KB` +
    `; ${((bytes - atFrame) / 1024).toFixed(0)} KB more in the three seconds after it`);
  check(drawn < 12, 'the game draws before anybody gives up', `${drawn.toFixed(1)}s`);
  // The line moves 190 KB a second, so every 200 KB in front of the first
  // frame is another second of loading card. The opponent (768 KB) used to be
  // in there and is not any more; what is left is the code and the man on the
  // title card.
  check(atFrame < 1024 * 1024, 'the first frame does not wait for a megabyte',
    `${(atFrame / 1024).toFixed(0)} KB`);
  check(errors.length === 0, 'no errors on the way', errors.join(' / '));
  await page.close();
}

/* ------------------------------------------------------------- the sound */

// On a bare page, for the reason sound-check gives: a ScriptProcessorNode runs
// on the main thread and starves behind the render loop, and a starved probe
// reports silence that is not there.
{
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await throttle(page);
  await page.goto(`http://127.0.0.1:${PORT}/bjj/assets/`, { waitUntil: 'domcontentloaded' });

  const trace = await page.evaluate(async ({ bell, minute, heard }) => {
    const { Audio } = await import('/bjj/src/core/audio.js');
    const a = new Audio();
    a.start();
    if (!a.ctx) return { error: 'no AudioContext' };
    // The crowd is synthesised from the first gesture and never stops, so it
    // would answer for the music. This is a question about the music.
    a.crowdGain.gain.value = 0;

    const probe = a.ctx.createScriptProcessor(4096, 1, 1);
    let peak = 0;
    probe.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
      e.outputBuffer.getChannelData(0).fill(0);
    };
    a.master.connect(probe);
    probe.connect(a.ctx.destination);

    const t0 = Date.now();
    const at = () => (Date.now() - t0) / 1000;
    const samples = [];
    a.track('menu');
    let belled = false;
    while (at() < minute) {
      if (!belled && at() >= bell) { belled = true; a.track('match'); }
      peak = 0;
      await new Promise((r) => setTimeout(r, 100));
      samples.push([at(), peak]);
    }
    return { samples, packLoaded: a.loaded, heard };
  }, { bell: BELL, minute: MINUTE, heard: HEARD });

  if (trace.error) { check(false, trace.error); }
  else {
    const on = trace.samples.filter(([, p]) => p > HEARD);
    const first = on.length ? on[0][0] : null;
    // The longest run of silence that starts after the bell — before it, a
    // title card with no music is a title card, not a fault.
    let gap = 0, run = 0, gapAt = 0;
    for (const [t, p] of trace.samples) {
      if (p > HEARD) { run = 0; continue; }
      run += 0.1;
      if (t > BELL && run > gap) { gap = run; gapAt = t - run; }
    }
    console.log(`  first note at ${first === null ? 'never' : first.toFixed(1) + 's'}` +
      `, bell at ${BELL}s, pack ${trace.packLoaded ? 'in' : 'still coming'} at ${MINUTE}s`);
    check(first !== null && first < BELL + 2, 'there is music by the time the bell goes',
      first === null ? 'silence throughout' : `${first.toFixed(1)}s`);
    check(gap < 1.0, 'no hole in the sound after the bell',
      gap ? `${gap.toFixed(1)}s of silence from ${gapAt.toFixed(1)}s` : 'none');
  }
  if (errors.length) check(false, 'errors on the audio page', errors.join(' / '));
  await page.close();
}

await browser.close();
console.log(fail ? `\n${fail} problem(s)` : '\nthe first minute holds up on a slow line');
process.exit(fail ? 1 : 0);
