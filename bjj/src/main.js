// Boot, the frame loop, and the wiring between the four things that do not
// otherwise know about each other: input, the match, the rig, and the renderer.

import { Renderer } from './render/renderer.js';
import { buildFighterMesh } from './render/body.js';
import { PairRig } from './game/rig.js';
import { Match, Fighter, MATCH_TIME } from './game/match.js';
import { AI } from './game/ai.js';
import { Camera } from './game/camera.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { HUD } from './ui/hud.js';
import { POSES } from './game/poses.js';
import { clamp, v3 } from './core/m4.js';

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
const meshes = buildFighterMesh(rig.skel.A);
const gpuA = renderer.makeFighterGPU(meshes);
const gpuB = renderer.makeFighterGPU(meshes);

const input = new Input(uiCanvas);
const hud = new HUD(uiCanvas);
const audio = new Audio();
const camera = new Camera();

const LEVEL = new URLSearchParams(location.search).get('belt') || 'blue';

let match, ai;
function newMatch() {
  const you = new Fighter('ВЫ', {
    giCol: new Float32Array([0.88, 0.89, 0.87]),
    beltCol: new Float32Array([0.04, 0.04, 0.05]),
    skinCol: new Float32Array([0.60, 0.42, 0.31]),
    technique: 0.55, strength: 0.5, cardio: 0.55,
  });
  const opp = new Fighter('СОПЕРНИК', {
    giCol: new Float32Array([0.06, 0.14, 0.42]),
    beltCol: new Float32Array([0.32, 0.06, 0.05]),
    skinCol: new Float32Array([0.52, 0.36, 0.26]),
    technique: 0.55, strength: 0.55, cardio: 0.5,
  });
  match = new Match([you, opp], { time: MATCH_TIME, onEvent: onMatchEvent });
  ai = new AI(1, LEVEL);
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
    audio.beep(880, 0.1);
    audio.swell(0.4, 1.2);
  } else if (e.kind === 'submission') {
    camera.cut(Math.random() < 0.5 ? -1 : 1);
    audio.swell(0.8, 2.4);
    audio.cloth(1);
  } else if (e.kind === 'escape') {
    audio.swell(0.5, 1.4);
  } else if (e.kind === 'end') {
    audio.whistle();
    audio.swell(1, 3);
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

function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = raw;

  // Adaptive resolution. The scene is cheap but a five year old phone is
  // cheaper; drop internal resolution before dropping frames.
  state.frameAvg = state.frameAvg * 0.94 + raw * 1000 * 0.06;
  if (state.frameAvg > 22 && state.quality > 0.62) {
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
      audio.whistle();
    } else if (match.state === 'over') {
      newMatch();
      match.start();
      audio.whistle();
    }
  }

  if (input.flick) {
    const r = match.input(0, input.flick);
    if (r === 'deny') audio.beep(520, 0.09, 'triangle', 0.2);
    else if (r === 'escape') audio.cloth(0.7);
    else if (r) audio.cloth(0.5);
  }
  if (input.tap) {
    if (match.state === 'sub' && match.sub.attacker === 0) {
      const r = match.subTap(0);
      audio.beep(r === 'tight' ? 660 : 190, 0.07, 'square', 0.14);
    } else {
      const r = match.grip(0);
      if (r) audio.cloth(r === 'win' ? 0.9 : 0.4);
    }
  }

  /* --- AI --------------------------------------------------------------- */
  // The art tooling freezes the sim so a pose can be photographed without the
  // AI walking out of frame mid-shutter.
  if (window.__frozen) {
    rig.apply(match.position, match.position, 1, dt);
    drawFrame(now);
    requestAnimationFrame(frame);
    return;
  }
  ai.update(dt, match,
    (dir) => match.input(1, dir),
    () => (match.state === 'sub' && match.sub.attacker === 1 ? match.subTap(1) : match.grip(1)));

  /* --- sim -------------------------------------------------------------- */
  const c0 = control0();
  match.update(dt, [c0, ai.control]);
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
  }

  const from = match.prevPosition;
  const to = match.pending || match.position;
  rig.apply(from, to, match.blend, dt);

  /* --- draw ------------------------------------------------------------- */
  drawFrame(now);
  input.endFrame();

  window.__stats = {
    fps: Math.round(1000 / state.frameAvg),
    quality: +state.quality.toFixed(2),
    position: match.position,
    state: match.state,
    score: [match.f[0].points, match.f[1].points],
    time: Math.round(match.time),
  };
  requestAnimationFrame(frame);
}

function drawFrame(now) {
  const dt = 1 / 60;
  const ha = rig.skel.A.world[0];
  const hb = rig.skel.B.world[0];
  focus[0] = (ha[12] + hb[12]) / 2;
  focus[1] = (ha[13] + hb[13]) / 2;
  focus[2] = (ha[14] + hb[14]) / 2;
  const mode = match.state === 'sub' ? 'sub' : POSES[match.position].ground ? 'ground' : 'stand';
  camera.update(dt, focus, mode, match.intensity);

  const fa = match.f[match.roleOf.indexOf('A')];
  const fb = match.f[match.roleOf.indexOf('B')];
  renderer.render({
    camera,
    time: now / 1000,
    focus,
    fighters: [
      { skeleton: rig.skel.A, gpu: gpuA, giCol: fa.giCol, beltCol: fa.beltCol, skinCol: fa.skinCol, flash: fa.flash },
      { skeleton: rig.skel.B, gpu: gpuB, giCol: fb.giCol, beltCol: fb.beltCol, skinCol: fb.skinCol, flash: fb.flash },
    ],
  });
  hud.draw(match, input, 1 / 60, { level: LEVEL });
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
  rig, renderer, camera, POSES,
  // Freeze on one paired pose. Used by the art tooling; also the quickest way
  // to check a pose by hand from the console.
  setPose: (id) => {
    window.__frozen = true;
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
  play: () => { window.__frozen = false; },
};
