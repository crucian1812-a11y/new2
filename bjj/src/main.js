// Boot, the frame loop, and the wiring between the four things that do not
// otherwise know about each other: input, the match, the rig, and the renderer.

import { Renderer } from './render/renderer.js';
import { buildFighterMesh } from './render/body.js';
import { loadFighter } from './render/asset.js';
import { PairRig } from './game/rig.js';
import { Skeleton, poseToQuats } from './render/skeleton.js';
import { Match, Fighter, MATCH_TIME } from './game/match.js';
import { AI } from './game/ai.js';
import { Camera } from './game/camera.js';
import { Referee } from './game/referee.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { HUD } from './ui/hud.js';
import { POSES } from './game/poses.js';
import { clamp, v3, qEuler } from './core/m4.js';

const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const loading = document.getElementById('loading');

const state = {
  quality: 1,
  frameAvg: 16.7,
  paused: false,
};

let renderer;
try {
  renderer = new Renderer(glCanvas);
} catch (e) {
  loading.textContent = 'Нужен WebGL2. Обнови браузер или включи аппаратное ускорение.';
  loading.classList.add('error');
  throw e;
}

const rig = new PairRig();

// The fighters come from a baked sculpt when one is present, and from the
// procedural body builder when it is not. The two produce the same vertex
// format on the same skeleton, so nothing past this point can tell them apart —
// and the game still runs, and still looks like itself, with the assets folder
// deleted.
let meshes = buildFighterMesh(rig.skel.A);
let gpuYou = renderer.makeFighterGPU(meshes);
// Two men, and until there were two characters this was one mesh drawn twice.
// The names matter: these belong to the fighters, not to the roles. A and B in
// the pose system are positions — whoever is on top is A — and they change
// hands several times a match, so a mesh held by role would swap bodies between
// the two men every time somebody swept.
let gpuOpp = gpuYou;
let bodySource = 'procedural';

let baked = null;
try {
  baked = await loadFighter(new URL('../assets/fighter.bin', import.meta.url).href);
  gpuYou = renderer.makeFighterGPU([baked]);
  gpuOpp = gpuYou;
  bodySource = `baked (${(baked.count / 3) | 0} tris)`;
} catch (e) {
  console.info('using the procedural body:', e.message);
}

// The opponent is a second character when there is one. He is optional on
// purpose: the game has to keep working with the assets folder deleted, and one
// man in two kimonos is a worse demo than two men, not a broken one.
//
// And he is not awaited. He is 768 KB, he is not on the title card, and he is
// not needed until the bell; awaiting him here put him in front of the first
// frame, which net-check measured as 11.3 seconds of loading card on a 1.5
// Mbit line against 1.5 MB of assets. Until he lands, `gpuOpp` is the same man
// in another gi, which is exactly what happens when the file is missing.
// Fetched here rather than from the first frame. Deferring it until after the
// loading card goes was tried, on the theory that it was sharing the pipe with
// the code and the first fighter; net-check says it is not — the first frame
// landed at 6.9 seconds either way — so it starts as early as it can.
loadFighter(new URL('../assets/fighter-b.bin', import.meta.url).href)
    .then((other) => {
      gpuOpp = renderer.makeFighterGPU([other]);
      bodySource += ` + opponent (${(other.count / 3) | 0} tris)`;
    })
    .catch((e) => console.info('the opponent is the same man in another gi:', e.message));

// The title-screen fighter.
//
// It used to be its own file: a static sculpt in a striking stance, bound
// rigidly to the root bone, on the reasoning that linear blend skinning
// degrades with the angle between the bind pose and the pose being played. That
// was true of the sculpt and it stopped being worth it the moment the match
// fighter became a properly rigged character — the title card was showing a
// visibly worse man than the game behind it, which is the wrong way round for
// the first thing anybody sees.
//
// So it is the match fighter, held in the game's own standing pose. A stance is
// a few degrees from the bind pose and skins cleanly — and it is the same mesh
// on the GPU, not a second upload of the same file: it used to fetch and
// re-upload fighter.bin a second time for the sake of one static figure.
let hero = null;
if (baked) {
  const skeleton = new Skeleton();
  poseToQuats(skeleton.local, POSES.STANDING.A);
  qEuler(skeleton.rootRot, 0, 26, 0);
  skeleton.rootPos[0] = 0.34;  // off centre, so the title has somewhere to sit
  skeleton.rootPos[1] = POSES.STANDING.A.root.p[1] + 0.05;
  skeleton.rootPos[2] = 0.1;
  skeleton.pose();
  skeleton.finishSkin();
  hero = {
    skeleton,
    gpu: gpuYou,
    giCol: new Float32Array([0.9, 0.905, 0.885]),
    beltCol: new Float32Array([0.035, 0.035, 0.04]),
    skinCol: new Float32Array([0.6, 0.42, 0.31]),
    flash: 0,
  };
}

const input = new Input(uiCanvas);
const hud = new HUD(uiCanvas);
const audio = new Audio();
const camera = new Camera();
// The third man. He is not part of the pair and never was — see referee.js.
const referee = new Referee();

// The ladder.
//
// Five belts of opponent were balanced and measured a work list ago, and
// nothing in the game ever showed anybody the second one: the belt came off
// the address bar and the match ended with "touch to start again". So: beat
// the man in front of you and the next one comes out, and the belt you have
// earned is the one you are wearing on the mat.
//
// Kept in localStorage, which can be missing, full, or refused outright in a
// private window; all three end with a player who starts at white, which is
// where everybody starts anyway.
const LADDER = ['white', 'blue', 'purple', 'brown', 'black'];
const BELT_COL = {
  white:  [0.90, 0.90, 0.88],
  blue:   [0.07, 0.16, 0.46],
  purple: [0.25, 0.10, 0.38],
  brown:  [0.20, 0.11, 0.06],
  black:  [0.04, 0.04, 0.05],
};
const SAVE = 'bjj.progress';
// The address bar still wins, and when it does nothing is written down: every
// tool in bjj/tools drives the game with ?belt=, and a measurement must not
// promote anybody.
const FORCED = new URLSearchParams(location.search).get('belt');

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.rank === 'number') {
        return { rank: Math.max(0, Math.min(LADDER.length - 1, p.rank | 0)),
                 wins: p.wins | 0, losses: p.losses | 0, champion: !!p.champion };
      }
    }
  } catch { /* no store, or somebody else's data in it */ }
  return { rank: 0, wins: 0, losses: 0, champion: false };
}
function saveProgress() {
  if (FORCED) return;
  try { localStorage.setItem(SAVE, JSON.stringify(progress)); } catch { /* private window */ }
}
const progress = loadProgress();
// Your own belt is the ladder you have climbed: beat the white belt and you
// are a blue belt yourself.
const myBelt = () => LADDER[Math.min(LADDER.length - 1, progress.rank)];
const oppBelt = () => FORCED || LADDER[progress.rank];
let lastResult = null;   // what the result card has to say

let match, ai;
function newMatch() {
  const you = new Fighter('ВЫ', {
    giCol: new Float32Array([0.88, 0.89, 0.87]),
    beltCol: new Float32Array(BELT_COL[myBelt()]),
    skinCol: new Float32Array([0.60, 0.42, 0.31]),
    technique: 0.55, strength: 0.5, cardio: 0.55,
  });
  const opp = new Fighter('СОПЕРНИК', {
    giCol: new Float32Array([0.06, 0.14, 0.42]),
    beltCol: new Float32Array(BELT_COL[oppBelt()]),
    skinCol: new Float32Array([0.52, 0.36, 0.26]),
    technique: 0.55, strength: 0.55, cardio: 0.5,
  });
  match = new Match([you, opp], { time: MATCH_TIME, onEvent: onMatchEvent });
  ai = new AI(1, oppBelt());
  rig.origin[0] = 0;
  rig.origin[2] = 0;
  rig.yaw = 0;
  camera.targetOrbit = 0.7;
  camera.orbit = 0.7;
}
newMatch();

function onMatchEvent(e) {
  if (e.kind === 'position') {
    audio.thud(e.tr.big ? 1 : 0.55);
    audio.cloth(0.8);
    camera.impulse(e.tr.big ? 0.8 : 0.35);
    if (e.tr.big) {
      camera.cut(e.tr.dir === 'left' ? -1 : 1);
      audio.swell(0.55);
    }
  } else if (e.kind === 'points') {
    referee.gesture('call', 1.1);
    audio.confirm();
    audio.swell(0.4, 1.2);
  } else if (e.kind === 'submission') {
    camera.cut(Math.random() < 0.5 ? -1 : 1);
    audio.lock();
    audio.swell(0.8, 2.4);
  } else if (e.kind === 'escape') {
    audio.cloth(0.9);
    audio.swell(0.5, 1.4);
  } else if (e.kind === 'end') {
    // Where the ladder moves. A win takes you up one and a loss takes nothing
    // away: this is a game about learning a position, and a career that
    // demotes you for losing to a black belt teaches nobody anything.
    referee.gesture('stop', 3.2);
    const beat = oppBelt();
    const won = e.winner === 0;
    if (won) progress.wins++; else progress.losses++;
    const climbed = won && !FORCED && progress.rank < LADDER.length - 1;
    if (won && !FORCED && progress.rank === LADDER.length - 1) progress.champion = true;
    if (climbed) progress.rank++;
    saveProgress();
    lastResult = { won, beat, next: oppBelt(), climbed, champion: progress.champion };
    audio.bell();
    audio.duck(0.2, 3.5);
    audio.swell(1, 3);
    // The room goes up for a tap and settles for a decision, which is what
    // actually happens in the hall.
    if (e.by === 'submission') audio.tap();
    audio.sting(e.winner === 0);
  }
}

/* -------------------------------------------------------------- viewport */

function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  renderer.resize(w, h, dpr, state.quality);
  hud.resize(w, h, dpr);
  document.body.classList.toggle('portrait', h > w);
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 120));
layout();

/* ------------------------------------------------------------ the frame */

const focus = v3(0, 0.5, 0);
let last = performance.now();
let started = false;

function control0() {
  // The left thumb, mapped into the two things the sim understands: where the
  // pair drifts, and how hard the player is driving.
  const s = input.stick;
  const ground = POSES[match.position].ground;
  const c = Math.cos(rig.yaw), sn = Math.sin(rig.yaw);
  const fx = s.x * s.mag;
  const fz = -s.y * s.mag;
  return {
    mx: fx * c + fz * sn,
    mz: -fx * sn + fz * c,
    turn: ground ? 0 : -s.x * s.mag * 0.6,
    drive: ground ? clamp(-s.y * s.mag, 0, 1) : s.mag * 0.35,
  };
}

// The bell, the whistle and the track that runs under the round. The bell is
// the hall's; the whistle is the referee's, and they are half a second apart
// because that is the order they happen in.
function startBell() {
  referee.gesture('call', 1.6);
  audio.bell();
  audio.duck(0.25, 2.2);
  setTimeout(() => audio.whistle(), 520);
  beeped = 0;
}

// The last minute is its own track, and the last ten seconds are counted out
// loud. `track` ignores a request for what is already playing, so this can be
// asked every frame without a flag.
let beeped = 0;
function clockSound() {
  if (match.state === 'ready') { audio.track('menu'); return; }
  if (match.state === 'over') return;
  audio.track(match.time <= 60 ? 'final' : 'match');
  const left = Math.ceil(match.time);
  if (left <= 10 && left > 0 && left !== beeped) {
    beeped = left;
    audio.timer();
  }
}

// A foot on the mat, when there is one.
//
// Tied to ground covered rather than to a timer: standing, the pair moves at
// something over a metre a second and a stride is about half of that, so a
// step every forty centimetres is two men circling. On the ground nobody
// steps, and the pack's two tatami samples are detuned against each other so a
// long exchange does not turn into a metronome.
let walked = 0;
const STRIDE = 0.4;
function footsteps(dt) {
  if (POSES[match.position].ground || match.state !== 'live') { walked = 0; return; }
  walked += Math.hypot(match.origin[0] - lastOrigin[0], match.origin[2] - lastOrigin[2]);
  lastOrigin[0] = match.origin[0];
  lastOrigin[2] = match.origin[2];
  if (walked >= STRIDE) {
    walked -= STRIDE;
    audio.step(0.5 + Math.random() * 0.3);
  }
}
const lastOrigin = [0, 0];

function frame(now) {
  // Two numbers, because they answer different questions. `elapsed` is how
  // long the last frame really took — that is what the resolution adapter and
  // the fps readout want. `dt` is how much of it the sim is allowed to
  // swallow, capped so that one long frame does not teleport the fight.
  //
  // They were the same number, and the readout was a lie: frameAvg was fed the
  // capped value, so it could never exceed 50 ms and the reported rate could
  // never fall below 20 fps. Under a software renderer at four and a half
  // frames a second it still said twenty-one, which is also why smoke's
  // "frame rate is sane" check could not fail.
  const elapsed = (now - last) / 1000;
  const raw = Math.min(0.05, elapsed);
  last = now;
  const dt = raw;

  // Adaptive resolution. The scene is cheap but a five year old phone is
  // cheaper; drop internal resolution before dropping frames.
  state.frameAvg = state.frameAvg * 0.94 + elapsed * 1000 * 0.06;
  // Not while something is measuring: a resolution change moves every pixel in
  // the frame and would swamp whatever was being compared.
  if (window.__still != null) { /* held */ } else if (state.frameAvg > 22 && state.quality > 0.62) {
    state.quality = Math.max(0.62, state.quality - 0.06);
    layout();
  } else if (state.frameAvg < 15 && state.quality < 1) {
    state.quality = Math.min(1, state.quality + 0.02);
    layout();
  }

  /* --- input ------------------------------------------------------------ */
  if (input.anyPress) {
    audio.start();
    input.anyPress = false;
    if (!started) {
      started = true;
      loading.classList.add('gone');
    }
    if (match.state === 'ready') {
      match.start();
      startBell();
    } else if (match.state === 'over') {
      newMatch();
      match.start();
      startBell();
    }
  }

  if (input.flick) {
    const r = match.input(0, input.flick);
    if (r === 'deny') audio.click();
    else if (r === 'escape') audio.cloth(0.7);
    else if (r) audio.cloth(0.5);
  }
  if (input.tap) {
    if (match.state === 'sub' && match.sub.attacker === 0) {
      const r = match.subTap(0);
      if (r === 'tight') audio.tap(0.45); else audio.click();
    } else {
      const r = match.grip(0);
      if (r) audio.cloth(r === 'win' ? 0.9 : 0.4);
    }
  }

  /* --- AI --------------------------------------------------------------- */
  // The art tooling freezes the sim so a pose can be photographed without the
  // AI walking out of frame mid-shutter.
  if (window.__frozen) {
    // A frozen blend, for photographing the middle of a transition. This is the
    // only way to look at the part of the animation nobody can see: the two
    // endpoints of a transition are both authored and both checked, and the
    // straight line between them is neither.
    const b = window.__blend;
    if (b) rig.apply(b.from, b.to, b.t, dt);
    else rig.hold(match.position, dt);
    drawFrame(now, dt);
    requestAnimationFrame(frame);
    return;
  }
  ai.update(dt, match,
    (dir) => match.input(1, dir),
    () => (match.state === 'sub' && match.sub.attacker === 1 ? match.subTap(1) : match.grip(1)));

  /* --- sim -------------------------------------------------------------- */
  const c0 = control0();
  match.update(dt, [c0, ai.control]);
  clockSound();
  footsteps(dt);
  rig.origin[0] = match.origin[0];
  rig.origin[2] = match.origin[2];
  rig.yaw = match.yaw;

  // Effort and slack drive the procedural life on top of the pose. Effort is
  // whoever is working; slack is whoever's posture has gone.
  for (const [role, idx] of [['A', match.roleOf.indexOf('A')], ['B', match.roleOf.indexOf('B')]]) {
    const f = match.f[idx];
    const working = (match.attempt && match.attempt.by === idx)
      || (match.state === 'sub' && match.sub.attacker === idx);
    const held = match.state === 'sub' && match.sub.defender === idx;
    rig.effort[role] = clamp(
      (working ? 0.9 : 0) + (held ? 0.75 : 0) + match.intensity * 0.25 + (1 - f.stamina / 100) * 0.3,
      0, 1.2
    );
    rig.slack[role] = clamp(1 - f.posture / 100, 0, 1);
    // Fatigue, its own channel: it starts at nothing and only goes one way,
    // and unlike effort it is still there when nobody is doing anything.
    // `__gas` is the measurement override: it lets a check drive fatigue on
    // its own, with stamina — and therefore effort, and therefore the pose —
    // held where it is. Without that the only measurable thing is "a tired man
    // looks different", which was already true before any of this.
    rig.gas[role] = window.__gas != null ? window.__gas : clamp(1 - f.stamina / 100, 0, 1);
  }

  const from = match.prevPosition;
  const to = match.pending || match.position;
  // Settled in a position, or on the way to one. A settled position is not a
  // still frame any more: it cycles through its own variants, which is where
  // three quarters of the match is spent.
  // Held still for measurement. Breathing and tremor are what make any two
  // frames of this game different from each other, so anything that wants to
  // compare two frames has to stop them first — see the fatigue check in
  // tools/smoke.mjs.
  if (window.__still != null) rig.time = window.__still;
  if (from === to && match.blend >= 1) rig.hold(to, dt);
  else rig.apply(from, to, match.blend, dt);

  /* --- draw ------------------------------------------------------------- */
  drawFrame(now, dt);
  input.endFrame();

  window.__stats = {
    fps: Math.round(1000 / state.frameAvg),
    quality: +state.quality.toFixed(2),
    position: match.position,
    state: match.state,
    body: bodySource,
    score: [match.f[0].points, match.f[1].points],
    time: Math.round(match.time),
  };
  requestAnimationFrame(frame);
}

// The referee's kit: a dark shirt and dark trousers rather than a kimono, and
// a black belt because the mesh has one and a referee is not going to be
// wearing a white one.
const REF_GI = new Float32Array([0.075, 0.08, 0.10]);
const REF_BELT = new Float32Array([0.03, 0.03, 0.04]);
const REF_SKIN = new Float32Array([0.55, 0.39, 0.30]);

const HERO_FOCUS = v3(0.34, 0.95, 0.1);

function drawFrame(now, real) {
  const dt = 1 / 60;
  // Here rather than in the sim, so he is also on the mat when the sim is
  // frozen for a photograph — which is the state half the art tooling runs in.
  // On the real clock, not the nominal one: at four frames a second a
  // sixtieth of a second per frame takes six seconds to stand him up.
  referee.update(real ?? dt, match.state, POSES[match.position].ground, match.origin, camera.orbit);

  // Before the bell, the screen belongs to one fighter and the empty mat.
  if (hero && match.state === 'ready') {
    camera.update(dt, HERO_FOCUS, 'hero', 0);
    renderer.render({ camera, time: now / 1000, focus: HERO_FOCUS, fighters: [hero] });
    hud.draw(match, input, 1 / 60, { level: oppBelt(), mine: myBelt(), progress, result: lastResult });
    return;
  }

  const ha = rig.skel.A.world[0];
  const hb = rig.skel.B.world[0];
  focus[0] = (ha[12] + hb[12]) / 2;
  focus[1] = (ha[13] + hb[13]) / 2;
  focus[2] = (ha[14] + hb[14]) / 2;
  const mode = match.state === 'sub' ? 'sub' : POSES[match.position].ground ? 'ground' : 'stand';
  // Held still too, and for the same reason: a camera that is still settling
  // moves every pixel, which swamps whatever the measurement was about.
  camera.update(window.__still != null ? 0 : dt, focus, mode, match.intensity);

  // Who is in which role, and therefore which skeleton each man is wearing this
  // second. Everything about a fighter — his kimono, his belt, his skin and now
  // his body — is looked up through this and never through the role.
  const ia = match.roleOf.indexOf('A');
  const ib = match.roleOf.indexOf('B');
  const fa = match.f[ia];
  const fb = match.f[ib];
  const body = (i) => (i === 0 ? gpuYou : gpuOpp);
  renderer.render({
    camera,
    time: now / 1000,
    focus,
    // A list, and it always was one: the renderer has never known how many
    // bodies are on the mat, and this is where the third one joins.
    fighters: [
      { skeleton: rig.skel.A, gpu: body(ia), giCol: fa.giCol, beltCol: fa.beltCol, skinCol: fa.skinCol,
        flash: fa.flash, gas: window.__gas != null ? window.__gas : clamp(1 - fa.stamina / 100, 0, 1) },
      { skeleton: rig.skel.B, gpu: body(ib), giCol: fb.giCol, beltCol: fb.beltCol, skinCol: fb.skinCol,
        flash: fb.flash, gas: window.__gas != null ? window.__gas : clamp(1 - fb.stamina / 100, 0, 1) },
      { skeleton: referee.skel, gpu: gpuYou, giCol: REF_GI, beltCol: REF_BELT, skinCol: REF_SKIN,
        flash: 0, gas: 0 },
    ],
  });
  hud.draw(match, input, 1 / 60, { level: oppBelt(), mine: myBelt(), progress, result: lastResult });
}

// One frame drawn before the loading card goes, so the first thing on screen is
// the mat and not a black rectangle.
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  loading.classList.add('ready');
});

// Debug hooks used by the tooling in bjj/tools; harmless in production.
window.__bjj = {
  match: () => match,
  rig, renderer, camera, referee, POSES,
  // Freeze on one paired pose. Used by the art tooling; also the quickest way
  // to check a pose by hand from the console.
  setPose: (id) => {
    window.__frozen = true;
    window.__blend = null;
    match.attempt = null;
    match.deny = null;
    match.pending = null;
    match.prevPosition = id;
    match.position = id;
    match.blend = 1;
    match.state = 'live';
    rig.effort.A = rig.effort.B = 0.05;
    rig.slack.A = rig.slack.B = 0;
  },
  // Stop the procedural life at one instant of it.
  still: (t) => { window.__still = t; },
  // Drive fatigue directly, with everything else held.
  gas: (v) => { window.__gas = v; },
  // Hold a transition at one moment of its blend.
  setBlend: (from, to, t) => {
    window.__frozen = true;
    window.__blend = { from, to, t };
    match.state = 'live';
    match.prevPosition = from;
    match.position = to;
    match.blend = t;
    rig.effort.A = rig.effort.B = 0.05;
    rig.slack.A = rig.slack.B = 0;
  },
  play: () => { window.__frozen = false; window.__blend = null; },
};
