// Boot: bake the world's textures, wire input and audio, run the loop.

import { Renderer } from './render/renderer.js';
import { FX } from './render/fx.js';
import { seedNoise } from './render/noise.js';
import { warmProps } from './render/props.js';
import { getMaterial } from './render/textures.js';
import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import { Game, tickTimers } from './game/game.js';
import { HUD } from './ui/hud.js';
import { ACTS } from './game/content.js';
import { loadSettings, saveSettings } from './core/save.js';

const canvas = document.getElementById('game');
const loader = document.getElementById('loader');
const loaderBar = document.getElementById('loaderBar');
const loaderText = document.getElementById('loaderText');
const rotateHint = document.getElementById('rotate');

let renderer;
let input;
let fx;
let game;
let hud;

function setProgress(p, label) {
  if (loaderBar) loaderBar.style.width = Math.round(p * 100) + '%';
  if (loaderText && label) loaderText.textContent = label;
}

/** Yields to the browser so the loading bar actually paints. */
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  seedNoise(0x5eed1409);

  renderer = new Renderer(canvas);
  input = new Input(canvas);
  fx = new FX(renderer);
  game = new Game(renderer, input, fx);
  hud = new HUD(game, renderer, input);

  // Bake the ground materials for every act up front. On a phone this is a
  // second or two once, rather than a stutter every time you cross a border.
  const mats = [];
  for (const act of ACTS) {
    mats.push(act.terrain.base);
    for (const l of act.terrain.layers) mats.push(l.mat);
  }
  const unique = [...new Set(mats)];
  for (let i = 0; i < unique.length; i++) {
    setProgress((i / unique.length) * 0.62, 'Земля Восточной Пруссии …');
    await nextFrame();
    getMaterial(unique[i], 256);
  }

  // And the props of the first two acts, so nothing hitches in the opening
  // minutes; the rest bake lazily on first sight.
  const propNames = new Set();
  for (const act of ACTS.slice(0, 2)) {
    for (const p of act.props) propNames.add(p.name);
    for (const l of act.landmarks) propNames.add(l);
  }
  const arr = [...propNames];
  for (let i = 0; i < arr.length; i++) {
    setProgress(0.62 + (i / arr.length) * 0.34, 'Сосны, камни, руины …');
    await nextFrame();
    warmProps([arr[i]]);
  }

  setProgress(1, 'Готово');
  await nextFrame();
  loader.classList.add('hidden');

  const settings = loadSettings();
  if (settings.muted) audio.setMuted(true);

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  onResize();

  // Audio can only start from a user gesture.
  const unlock = () => {
    audio.init();
    if (settings.muted) audio.setMuted(true);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // Full screen on first tap makes the phone experience far better.
  canvas.addEventListener(
    'pointerdown',
    () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    },
    { once: true }
  );

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing') {
      hud.panel = 'menu';
      game.save();
    }
  });

  window.__game = game;
  window.__hud = hud;
  window.__renderer = renderer;
  window.__input = input;
  window.__fx = fx;

  requestAnimationFrame(loop);
}

function onResize() {
  renderer.w = renderer.h = 0;
  renderer.resize();
  const portrait = window.innerHeight > window.innerWidth * 1.05;
  if (rotateHint) rotateHint.classList.toggle('show', portrait && window.innerWidth < 620);
  // Diablo II framed the hero large — he was a good tenth of the screen
  // height, close enough that his armour read. A wider view makes a phone
  // screen a map rather than a fight.
  const base = Math.min(window.innerWidth, window.innerHeight * 1.9);
  renderer.cam.zoom = clampZoom(base / 680);
}

function clampZoom(z) {
  return Math.max(0.85, Math.min(1.7, z));
}

let last = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (dt <= 0) dt = 1 / 60;

  renderer.adaptQuality(dt);
  tickTimers(dt);

  hud.handleInput();

  const paused = hud.panel === 'menu' || hud.panel === 'bag';
  if (!paused) {
    game.update(dt);
  } else {
    game.time += dt;
    fx.update(dt * 0.25);
    input.update();
  }

  if (game.state === 'menu') {
    renderer.beginFrame(dt);
    renderer.presentWorld();
  } else {
    game.draw(dt);
  }
  hud.draw(dt);

  audio.update(dt, game.state === 'playing' ? game.tension : 0);
  input.endFrame();

  if (audio.muted !== lastMuted) {
    lastMuted = audio.muted;
    saveSettings({ muted: lastMuted });
  }
}

let lastMuted = false;

boot().catch((e) => {
  console.error(e);
  if (loaderText) loaderText.textContent = 'Ошибка загрузки: ' + e.message;
});
