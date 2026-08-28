// Is a sound pack usable, and where does it lie?
//
// A folder of .ogg files says nothing about itself. The names promise a
// referee's whistle and a ten-second crowd loop; whether the whistle is
// audible at match volume, whether the loop actually loops, and whether the
// "stereo" file is two copies of the same mono channel are all questions with
// numbers behind them, and all three have been wrong in packs before.
//
// The decoder is the browser's, deliberately. Chromium is what will decode
// these on the phone, `decodeAudioData` is the call the game will make, and a
// file that only some other library can open is not a file this game can play.
//
//   node bjj/tools/audio-check.mjs                 the whole pack
//   node bjj/tools/audio-check.mjs sfx/round_bell  one file, in detail
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = new URL('../assets/audio/', import.meta.url).pathname;
const PORT = +(process.env.PORT || 8099);
const ONLY = process.argv[2] || null;

// What the game plays at. Every level below is quoted at this gain, because
// "peaks at -0.3 dBFS" is not an answer to "will the tap be heard over the
// crowd" — the crowd bed sits at 0.1 and the master at 0.5.
const MASTER = 0.5;
// A one-shot has to clear the room. The crowd bed in core/audio.js runs at
// roughly -26 dBFS after its own gain; anything quieter than this against the
// master is a sound the player will not hear during a match.
const AUDIBLE = -30;
// Two hundredths of a second of near-silence at the head of a one-shot is a
// hundredth of a second of lateness on every impact in the game.
const LATENCY = 0.02;
const SILENT = -60;

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.ogg') || e.endsWith('.mp3') || e.endsWith('.wav')) files.push(p);
  }
})(ROOT);
files.sort();

const wanted = files.filter((f) => !ONLY || relative(ROOT, f).includes(ONLY));
if (!wanted.length) {
  console.error(`no audio under assets/audio${ONLY ? ` matching ${ONLY}` : ''}`);
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'domcontentloaded' });

const rows = [];
for (const f of wanted) {
  const url = '/bjj/assets/audio/' + relative(ROOT, f).split('\\').join('/');
  const r = await page.evaluate(measure, { url, silent: SILENT });
  r.file = relative(ROOT, f);
  r.bytes = statSync(f).size;
  // The container's own rate, not the one the browser handed back.
  // decodeAudioData resamples to the context, so every file in a 32 kHz pack
  // comes out saying 44100 and the pack's own manifest looks like a lie.
  Object.assign(r, container(f));
  rows.push(r);
}
await browser.close();

// ------------------------------------------------------------- the report

const db = (v) => (v <= 0 ? -Infinity : 20 * Math.log10(v));
const at = (v) => db(v * MASTER);
const n = (v) => (v === -Infinity ? ' -inf' : v.toFixed(1).padStart(5));

let problems = 0;
for (const r of rows) {
  const notes = [];
  if (r.error) {
    notes.push(`the browser cannot decode it: ${r.error}`);
  } else {
    const loop = /_loop|_loop_/.test(r.file);
    if (r.peak === 0) notes.push('silent');
    else if (at(r.peak) < AUDIBLE) {
      notes.push(`peaks at ${n(at(r.peak))} dBFS at match volume — under the crowd`);
    }
    if (r.clipped > 8) notes.push(`${r.clipped} samples clipped`);
    if (Math.abs(r.dc) > 0.01) notes.push(`DC offset ${r.dc.toFixed(3)} — a click on every start`);
    if (!loop && r.lead > LATENCY) {
      notes.push(`${(r.lead * 1000).toFixed(0)}ms of silence before it starts — that is late`);
    }
    // A loop is judged at its seam: the last sample runs into the first, and a
    // step between them is a tick once per lap, forever.
    if (loop && r.seam > 0.06) notes.push(`seam jumps ${r.seam.toFixed(2)} — audible tick each lap`);
    if (r.channels === 2 && r.identical) notes.push('“stereo” is two copies of one channel — half the bytes are free');
  }
  problems += notes.length;
  console.log(
    `${notes.length ? '!' : ' '} ${r.file.padEnd(32)}` +
    (r.error ? '  —' :
      `${r.dur.toFixed(2).padStart(6)}s ${String(r.srcChannels || r.channels)}ch ` +
      `${String(r.srcRate || r.rate).padStart(5)}Hz` +
      `  peak ${n(at(r.peak))}  rms ${n(at(r.rms))} dBFS` +
      `  ${(r.bytes / 1024).toFixed(0).padStart(4)}KB`)
  );
  for (const t of notes) console.log(`      · ${t}`);
}

const total = rows.reduce((s, r) => s + r.bytes, 0);
const oneShots = rows.filter((r) => !r.error && !/_loop/.test(r.file) && r.dur < 4);
console.log(
  `\n${rows.length} files, ${(total / 1024).toFixed(0)}KB` +
  `  ·  ${oneShots.length} one-shots preloadable at ${(oneShots.reduce((s, r) => s + r.bytes, 0) / 1024).toFixed(0)}KB`
);
console.log(problems ? `${problems} problem(s)` : 'the whole pack is usable as it stands');
process.exitCode = problems ? 1 : 0;

// The Vorbis identification header, which is the first packet of the first
// page: 0x01 "vorbis", version, channels, then the rate as a little-endian
// 32-bit int. Twelve bytes of parsing to avoid quoting the decoder's opinion
// of a file back as if it were the file's.
function container(path) {
  if (!path.endsWith('.ogg')) return {};
  const b = readFileSync(path);
  const i = b.indexOf(Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]));  // \x01vorbis
  if (i < 0) return {};
  return { srcChannels: b[i + 11], srcRate: b.readUInt32LE(i + 12) };
}

// ------------------------------------------------------- in the browser

async function measure({ url, silent }) {
  const res = await fetch(url);
  if (!res.ok) return { error: `${res.status}` };
  const bytes = await res.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let buf;
  try {
    buf = await ctx.decodeAudioData(bytes);
  } catch (e) {
    ctx.close();
    return { error: String(e.message || e) };
  }
  const ch = [];
  for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
  const len = buf.length;

  let peak = 0, sum = 0, sq = 0, clipped = 0;
  for (const d of ch) {
    for (let i = 0; i < len; i++) {
      const v = d[i], a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += v;
      sq += v * v;
    }
  }
  const count = len * ch.length;
  const rms = Math.sqrt(sq / count);
  const dc = sum / count;

  // Where the sound actually begins, on the loudest channel.
  const floor = Math.pow(10, silent / 20);
  let lead = 0;
  for (let i = 0; i < len; i++) {
    let a = 0;
    for (const d of ch) a = Math.max(a, Math.abs(d[i]));
    if (a > floor) { lead = i / buf.sampleRate; break; }
  }

  // The seam of a loop: how far the signal has to jump to get from the last
  // sample back to the first, measured against the material's own level so a
  // quiet bed and a loud one are judged the same way.
  let seam = 0;
  for (const d of ch) seam = Math.max(seam, Math.abs(d[len - 1] - d[0]));
  seam = rms > 0 ? seam / (rms * 4) : 0;

  let identical = false;
  if (ch.length === 2) {
    identical = true;
    for (let i = 0; i < len; i += 37) {
      if (Math.abs(ch[0][i] - ch[1][i]) > 1e-6) { identical = false; break; }
    }
  }

  const out = { dur: buf.duration, rate: buf.sampleRate, channels: buf.numberOfChannels,
                peak, rms, dc, clipped, lead, seam, identical };
  ctx.close();
  return out;
}
