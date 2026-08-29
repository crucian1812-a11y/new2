// A thumb, so the game is measured against a person and not only against
// itself.
//
// `sim-check` plays the AI against the AI four hundred times and reports the
// shape of the match. Every number in it is a number about balance. None of
// them is a number about playing: whether the denial window is long enough for
// a hand, whether the beat inside a submission can be hit by somebody who is
// not reading `s.phase` off the object, whether the four labels round the
// thumb are enough to act on. The game has never been measured with a finger
// on it.
//
// So: a scripted thumb, on the real page, through the real input class — the
// events it sends land in the same `pointerdown` handler a phone produces, and
// everything downstream of that is the game. It sees only what the HUD draws:
// the four labels and their colour, the denial arrow, the escape arrow, the
// pulsing ring. It does not read the position graph, the transition table or
// the phase of anything.
//
// What makes it a person rather than a second AI is that it is late and it is
// imprecise:
//
//   --react    ms between a prompt appearing and the thumb starting to move
//   --jitter   spread on that, one sigma
//   --beat     sigma on the tap that has to land on the beat, in ms
//
// It taps the beat by anticipating it, not by reacting to it — the window is
// 190 ms wide and no one reacts inside that — which is what a player does with
// a rhythm they can see.
//
//   node bjj/tools/thumb.mjs                       three 90-second matches
//   node bjj/tools/thumb.mjs --matches 6 --belt white
//   node bjj/tools/thumb.mjs --play random         the floor: a thumb that reads nothing
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.
// A match is played in real time — there is no fast-forwarding a measurement
// whose whole subject is human timing — so three of them take five minutes.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const CFG = {
  matches: +flag('matches', 3),
  seconds: +flag('seconds', 90),
  belt: flag('belt', 'blue'),
  react: +flag('react', 220),
  jitter: +flag('jitter', 60),
  beat: +flag('beat', 90),
  play: flag('play', 'label'),
  // The beat, on its own. A submission happens when the fight produces one,
  // and in a ninety-second match against a blue belt it often does not happen
  // at all — two full matches produced none. Waiting for one in real time to
  // measure a 190 ms window is an hour to answer a question that takes a
  // minute: this puts the pair into a submission, lets the thumb work it, and
  // does it again the moment it ends.
  drill: +flag('drill', 0),
};
const PORT = +(process.env.PORT || 8099);

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  // The last three matter here and nowhere else in the toolbox: this is the
  // only tool that watches a match play out over minutes, and an unfocused
  // headless page has its animation frames throttled to a crawl. A thumb
  // measured against a match running at a tenth of speed is measuring nothing.
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
         '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
         '--disable-backgrounding-occluded-windows'],
});
// A small window on purpose. Nothing here looks at the picture, and the
// software renderer is what sets how fast the match plays out: at 900x420 it
// manages four and a half frames a second, at 480x220 nearer eight, and the
// difference is minutes of waiting per match.
const ctx = await browser.newContext({ viewport: { width: 480, height: 220 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html?belt=${CFG.belt}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__bjj && window.__stats, null, { timeout: 60000 });

console.log(`${CFG.matches} match(es) of ${CFG.seconds}s against a ${CFG.belt} belt` +
  `, thumb: ${CFG.react}±${CFG.jitter} ms, beat ±${CFG.beat} ms, reading ${CFG.play}\n`);

const out = await page.evaluate((cfg) => new Promise((done) => {
  const ui = document.getElementById('ui');
  let pid = 100;
  const send = (type, x, y, id) => ui.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: false,
  }));
  // Where a right thumb sits on a phone held sideways: past the middle, low.
  const rx = () => ui.clientWidth * 0.78;
  const ry = () => ui.clientHeight * 0.6;
  const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  function tap() {
    const id = ++pid, x = rx(), y = ry();
    send('pointerdown', x, y, id);
    send('pointerup', x, y, id);
  }
  function flick(dir) {
    const id = ++pid, x = rx(), y = ry(), v = VEC[dir];
    send('pointerdown', x, y, id);
    send('pointermove', x + v[0] * 44, y + v[1] * 44, id);
    send('pointerup', x + v[0] * 44, y + v[1] * 44, id);
  }
  // The left thumb, held. It carries base and drive and it does not let go:
  // that is what the hand does, and drive is in the chance of everything.
  function leftThumb() {
    const id = 7, x = ui.clientWidth * 0.2, y = ui.clientHeight * 0.6;
    send('pointerdown', x, y, id);
    send('pointermove', x, y - 50, id);
  }

  // Gaussian, because human timing error is not a box.
  let spare = null;
  function gauss(sigma) {
    if (spare !== null) { const v = spare; spare = null; return v * sigma; }
    let u = 0, v = 0, s = 0;
    do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const f = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * f;
    return u * f * sigma;
  }
  const late = () => (cfg.react + gauss(cfg.jitter)) / 1000;   // match seconds

  // Time, as the match counts it.
  //
  // Every delay below is in match seconds, not wall seconds, and the two are
  // not the same here: dt is capped at 50 ms and this browser's software
  // renderer takes 130 to 220 ms a frame, so the match runs at about a
  // quarter of real time. A reaction measured against the wall would be four
  // frames of the game instead of one, and the denial window — 0.44 match
  // seconds — would look impossible when on a phone at sixty frames it is not.
  // On real hardware the two clocks are the same clock.
  let gt = 0, prevClock = null;

  const st = {
    matches: [], hit: 0, miss: 0, denies: 0, denied: 0, blind: 0, escapes: 0,
    tries: 0, landed: 0, subTries: 0, subLanded: 0, grips: 0, flicksIgnored: 0,
    ignoredSub: 0, ignoredBusy: 0, ignoredCool: 0, ignoredTired: 0, ignoredNothing: 0, fps: 0,
  };
  let m = null, patched = null, cur = null;
  function patch(match) {
    const oi = match.input.bind(match);
    match.input = (i, dir) => {
      // What the option was before the call, so an ignored flick can say why.
      const had = match.state === 'live' && !match.attempt ? match.options(0)[dir] : null;
      const tired = had && match.f[0].stamina < had.cost * 0.35;
      const r = oi(i, dir);
      if (i === 0) {
        if (r === 'deny') { st.denies++; st.denied++; }
        else if (r === 'deny-miss') st.denies++;
        else if (r === 'escape') st.escapes++;
        else if (r && typeof r === 'object') { st.tries++; if (r.sub) st.subTries++; }
        else if (!r) {
          st.flicksIgnored++;
          if (match.state === 'sub') st.ignoredSub++;
          else if (match.attempt) st.ignoredBusy++;
          else if (match.cool[0] > 0) st.ignoredCool++;
          else if (tired) st.ignoredTired++;
          else st.ignoredNothing++;
        }
      }
      return r;
    };
    const ot = match.subTap.bind(match);
    match.subTap = (i) => {
      const r = ot(i);
      if (i === 0) { if (r === 'tight') st.hit++; else if (r === 'slip') st.miss++; }
      return r;
    };
    const og = match.grip.bind(match);
    match.grip = (i) => { if (i === 0) st.grips++; return og(i); };
    const oe = match.onEvent;
    match.onEvent = (e) => {
      if (e.kind === 'position' && e.by === 0) { st.landed++; if (e.tr && e.tr.sub) st.subLanded++; }
      return oe(e);
    };
  }

  // ------------------------------------------------------------- the thumb

  const T0 = performance.now();
  // A hard stop, so a thumb that has got itself stuck reports what it has
  // rather than hanging the tool.
  // Generous, because a match second is not a wall second here: dt is capped
  // at 50 ms and this browser misses that cap by a mile — a software
  // rasteriser draws six frames a second, so the match clock runs at about a
  // fifth of real time, and slower again with something else on the box. The
  // report prints the rate it actually got.
  const DEADLINE = cfg.matches * (cfg.seconds * 7 + 40) * 1000;
  let plan = null;          // { at, do }
  let seenAttempt = null;   // the attempt this thumb has already answered
  let nextMove = 0;         // when it will next start something of its own
  let nextEscape = 0;
  let aim = null;           // the phase this beat will be tapped at
  let started = 0;
  let armed = false;

  function pick(match) {
    const opts = match.options(0);
    const dirs = Object.keys(opts);
    if (cfg.play === 'random') {
      const all = ['up', 'down', 'left', 'right'];
      return all[(Math.random() * 4) | 0];
    }
    if (!dirs.length) return null;
    // The stamina bar is on screen, and a player who has watched it empty once
    // stops throwing moves he cannot pay for. Without this the thumb spent
    // two flicks in three on "нет сил" — which is a fact about a thumb that
    // does not look, not about the game.
    const afford = dirs.filter((d) => match.f[0].stamina > opts[d].cost * 0.6);
    if (!afford.length) return null;
    // What the ring actually shows: a red circle is a submission, a yellow one
    // is worth four points, the rest are white. Nothing here knows what any of
    // them does.
    const red = afford.filter((d) => opts[d].sub);
    const yellow = afford.filter((d) => opts[d].big && !opts[d].sub);
    const rest = afford.filter((d) => !opts[d].sub && !opts[d].big);
    const bag = red.length && Math.random() < 0.55 ? red
              : yellow.length && Math.random() < 0.7 ? yellow
              : rest.length ? rest : afford;
    return bag[(Math.random() * bag.length) | 0];
  }

  function step() {
    const now = performance.now();
    if (now - T0 > DEADLINE) { st.stuck = true; done(st); return; }
    const match = window.__bjj.match();
    if (match !== patched) { patch(match); patched = match; }
    m = match;

    if (m.state === 'live' || m.state === 'sub') {
      if (prevClock !== null && m.time < prevClock) gt += prevClock - m.time;
      prevClock = m.time;
    }
    if (plan && gt >= plan.at) { const p = plan; plan = null; p.do(); }

    st.saw = `${m.state} ${m.time.toFixed(0)}s ${m.position}`;
    st.fps = window.__stats ? window.__stats.fps : 0;
    if (cfg.drill && st.hit + st.miss >= cfg.drill) { done(st); return; }
    if (m.state === 'ready' || m.state === 'over') {
      if (m.state === 'over' && cur) {
        st.rate = (cur.clock - m.time) / ((now - cur.at) / 1000);
        st.matches.push({ ...cur, winner: m.winner, by: m.winBy,
          score: [m.f[0].points, m.f[1].points], adv: [m.f[0].advantages, m.f[1].advantages] });
        cur = null;
        if (!cfg.drill && st.matches.length >= cfg.matches) { done(st); return; }
      }
      // The one thing still measured against the wall: nothing is running.
      if (now > started + 900) { started = now; armed = false; prevClock = null; tap(); }
      requestAnimationFrame(step);
      return;
    }

    if (!armed) {
      // The clock, shortened. Everything else about the match is untouched;
      // this is how many seconds of it are played.
      armed = true;
      m.time = cfg.seconds;
      cur = { at: now, clock: m.time };
      leftThumb();
    }

    // 1. Somebody is coming at you. Nothing else matters while the arrow is up.
    if (m.attempt && m.attempt.defender === 0 && m.deny && m.attempt !== seenAttempt) {
      seenAttempt = m.attempt;
      // What the HUD shows him, which is not always the answer: flattened, the
      // prompt says only that something is coming. Read now, thrown later —
      // if it changes during the reaction, the hand is already committed.
      const seen = m.visibleDeny(0);
      if (!seen) st.blind++;
      const dir = seen || ['up', 'down', 'left', 'right'][(Math.random() * 4) | 0];
      plan = { at: gt + late(), do: () => m.input(0, dir) };
    } else if (cfg.drill && m.state === 'live' && !m.attempt && !plan) {
      // Straight to the lock. This reaches past `input` into the sim the same
      // way the art tooling's setPose does, and for the same reason: the thing
      // being measured is downstream of getting there.
      const tr = Object.values(m.options(0)).find((o) => o.sub);
      if (tr) { m.position = tr.from; m._startSub(0, tr); }
      else { m.prevPosition = m.position = 'MOUNT'; m.blend = 1; }
    } else if (m.state === 'sub' && m.sub) {
      const s = m.sub;
      if (s.attacker === 0) {
        // Anticipate the beat, in the game's own time and not the wall's.
        //
        // The first version scheduled the tap in milliseconds from now, and it
        // hit the window nought times out of ten — not because the window is
        // hard but because `phase` advances with the frame's dt, and under a
        // software renderer at twenty frames a second the wall runs half again
        // as fast as the match. The thumb's error is a human's, so it belongs
        // where the human's rhythm is: --beat milliseconds converted into
        // phase at the rate the ring actually pulses. On a phone at sixty
        // frames the two are the same thing.
        if (aim === null && s.phase < 0.5) {
          aim = Math.min(0.99, Math.max(0.05, 0.75 + gauss(cfg.beat) * 0.00115));
        }
        if (aim !== null && s.phase >= aim) { aim = null; m.subTap(0); }
      } else if (gt > nextEscape) {
        nextEscape = gt + 0.38;
        const dir = cfg.play === 'random'
          ? ['up', 'down', 'left', 'right'][(Math.random() * 4) | 0]
          : s.escapeDir;
        plan = { at: gt + late(), do: () => m.input(0, dir) };
      }
    } else if (m.state === 'live' && !m.attempt && gt > nextMove && !plan) {
      // Its own turn. A hand does not fire four times a second.
      nextMove = gt + 0.7 + Math.random() * 0.7;
      const dir = pick(m);
      plan = { at: gt + late(), do: () => { if (dir) flick(dir); else tap(); } };
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}), CFG);

await browser.close();

/* ------------------------------------------------------------------ report */

const beats = out.hit + out.miss;
const hitRate = beats ? out.hit / beats : 0;
const won = out.matches.filter((r) => r.winner === 0).length;
const tapped = out.matches.filter((r) => r.winner === 0 && r.by === 'submission').length;
const lostToTap = out.matches.filter((r) => r.winner === 1 && r.by === 'submission').length;

if (out.stuck) console.log(`  ! the thumb ran out of time — last seen: ${out.saw}`);
console.log(`  the page ran at ${out.fps} fps` +
  (out.rate ? `, the match clock at ${out.rate.toFixed(2)}x real time` : '') +
  (out.fps < 20 ? ' — slow enough that the timing above is worth less than it looks' : ''));
console.log('  the thumb, over ' + out.matches.length + ' match(es):');
console.log(`    beats     ${out.hit} on, ${out.miss} off` +
  `${beats ? `  (${(hitRate * 100).toFixed(0)}%)` : '  (never in a submission)'}`);
console.log(`    denials   ${out.denied} of ${out.denies} answered in time` +
  `  (${out.blind} of them thrown blind, with his posture gone)`);
console.log(`    escapes   ${out.escapes} flicks that were the way out`);
console.log(`    moves     ${out.tries} started, ${out.landed} landed` +
  `, ${out.subTries} of them submissions`);
console.log(`    ignored   ${out.flicksIgnored} flicks the game had no use for` +
  `  (${out.ignoredSub} mid-submission, ${out.ignoredBusy} during somebody's attempt` +
  `, ${out.ignoredCool} on cooldown, ${out.ignoredTired} no strength left` +
  `, ${out.ignoredNothing} nothing that way)`);
for (const r of out.matches) {
  console.log(`    ${r.winner === 0 ? 'won ' : r.by === 'draw' ? 'drew' : 'lost'} by ${r.by}` +
    `  ${r.score[0]}:${r.score[1]} (adv ${r.adv[0]}:${r.adv[1]})`);
}

// A thumb that never got into a submission has not measured the beat, and
// saying "0%" would be a lie about the game rather than a fact about it.
if (beats >= 8) {
  check(hitRate > 0.5 && hitRate < 0.8, 'the beat is hittable by a hand, and not free',
    `${(hitRate * 100).toFixed(0)}% of ${beats}`);
} else {
  console.log(`  (only ${beats} beats: not enough to judge the window)`);
}
check(out.denies === 0 || out.denied / out.denies > 0.25,
  'the denial window is long enough to answer', `${out.denied}/${out.denies}`);
// And the other end of it, which is not a failure but is a fact about the
// game: the prompt names the direction, so a thumb that is watching for
// nothing else answers every one of them. A black belt reads the same threat
// right about seven times in ten. Whoever is playing is a better defender than
// the best opponent in the game, and that is worth knowing before anybody
// concludes the AI is weak.
if (out.denies >= 6 && out.denied / out.denies > 0.9) {
  console.log(`  note: ${out.denied} of ${out.denies} denials answered — the prompt answers itself` +
    ' for a player who is only watching for it');
}
// In a drill there is no game to play: the pair is put into a lock and the
// thumb works it, so nothing here started, landed or was ignored.
if (!CFG.drill) {
  check(out.tries > 0 && out.landed > 0, 'the thumb can make something happen',
    `${out.landed} of ${out.tries}`);
  check(out.flicksIgnored < out.tries, 'most flicks mean something', `${out.flicksIgnored} ignored`);
}
console.log(`  won ${won} of ${out.matches.length}, ${tapped} by submission, lost ${lostToTap} to one`);

if (errors.length) for (const e of errors) check(false, 'page error', e);
console.log(fail ? `\n${fail} problem(s)` : '\nthe thumb can play the game');
process.exit(fail ? 1 : 0);
