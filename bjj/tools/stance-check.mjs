// Do they step like people while they fight?
//
// gait-check holds the walk onto the mat to a gait lab, and it is a walk. What
// the player watches for five minutes is not that: it is two men in their
// stance being moved round the mat by his left thumb, and a referee keeping
// his distance from them. Neither is walking forwards. The pair drift and
// circle; the referee faces the fight, so nearly all his travel is sideways —
// and both were stepping with rules made for going forwards: a foot left where
// it was until the body had dragged it thirty centimetres, then flung ahead of
// where the body was going. Sideways, ahead of the body is the far side of the
// other foot. A player named it in one sentence: the steps in the fight are
// bad, the walk on is fine.
//
// So this drives both the way a match does and reads the feet the way you see
// them from the stands:
//
//   крест    the feet never cross: along the line through the hips, the left
//            foot stays at least 6 cm to the left of the right one
//   шпагат   and never splay: the feet no more than 25 cm further apart than
//            the stance they started in
//   стойка   a second after the thumb lets go, each man is back in his stance
//            — each foot within 5 cm of where his pose puts it
//   шаг      a foot in the air moves no faster than 4 m/s — a step, not a
//            flick — and one foot is always on the mat
//
// The pair is driven by a scripted thumb through the moves a player makes —
// forward, sideways (which also turns them), back, the other side, let go —
// against an opponent who does not steer. The referee is driven through what
// the fight does to him: it moves off, the camera cuts to the other side, the
// camera drifts round, the fight shuffles back and forth under him.
//
//   node bjj/tools/stance-check.mjs
//   node bjj/tools/stance-check.mjs --rows   and the numbers phase by phase

import { Match, Fighter, MATCH_TIME, thumb } from '../src/game/match.js';
import { PairRig } from '../src/game/rig.js';
import { Referee } from '../src/game/referee.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { SHUFFLE } from '../src/game/shuffle.js';

// SHUFFLE='{"TRIG":0.06}' tries other numbers without editing shuffle.js.
if (process.env.SHUFFLE) Object.assign(SHUFFLE, JSON.parse(process.env.SHUFFLE));

const DT = 1 / 60;
const ROWS = process.argv.includes('--rows');
const CROSS = 0.06, SPLAY = 0.25, HOME = 0.05, FLICK = 4.0;

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const P = (sk, b) => { const w = sk.world[BONE_INDEX[b]]; return [w[12], w[13], w[14]]; };
// How far the feet stand from where the pose puts them, read off the stance
// stepper that keeps them.
const offHome = (sh) => Math.max(...sh.feet.map((f) => Math.hypot(f.g[0] - f.home[0], f.g[1] - f.home[1])));

// One body's feet, frame after frame: how they sit across the hips, how far
// apart, how fast each is moving, and whether both are up at once.
function feetReader() {
  const last = {};
  const r = { latMin: 9, spreadMax: 0, flick: 0, bothUp: 0, frames: 0 };
  r.read = (sk, left, homes) => {
    const w = sk.world[BONE_INDEX.hips];
    // The hips' own left, which is the rig's +x — or the way the walker faces,
    // when the pelvis is turning with his steps and would swing the line.
    const lx = left ? left[0] : w[0], lz = left ? left[1] : w[2];
    const fl = P(sk, 'footL'), fr = P(sk, 'footR');
    const lat = (fl[0] - fr[0]) * lx + (fl[2] - fr[2]) * lz;
    const spread = Math.hypot(fl[0] - fr[0], fl[2] - fr[2]);
    // How much wider than the stance the pose asks for this frame — a
    // referee's crouch is meant to be wider than his standing.
    const wider = homes ? spread - Math.hypot(homes[0][0] - homes[1][0], homes[0][1] - homes[1][1]) : 0;
    let up = 0;
    for (const [s, f] of [['L', fl], ['R', fr]]) {
      const v = last[s] ? Math.hypot(f[0] - last[s][0], f[2] - last[s][2]) / DT : 0;
      last[s] = f;
      r.flick = Math.max(r.flick, v);
      // In the air past 0.15 m/s, pose-check's line for a planted foot: under
      // it is the knee's hinge clamp settling a millimetre a frame, not a step.
      if (v > 0.15) up++;
    }
    r.frames++;
    return { lat, spread, wider, up };
  };
  return r;
}

/* ------------------------------------------------------------ the pair */

const SCRIPT = [
  ['stand', 0.8, [0, 0]],
  ['forward', 1.5, [0, -1]],
  ['sideways', 2.0, [1, 0]],
  ['back', 1.5, [0, 1]],
  ['the other side', 2.0, [-1, 0]],
  ['let go', 1.5, [0, 0]],
];
{
  const m = new Match([new Fighter('a'), new Fighter('b')], { time: MATCH_TIME });
  const rig = new PairRig();
  rig.live = true;
  m.start();
  const rd = { A: feetReader(), B: feetReader() };
  const idle = {};
  const worst = { A: {}, B: {} };
  let t = 0, bothUp = 0;
  for (const [name, secs, [sx, sy]] of SCRIPT) {
    const phase = { A: { latMin: 9, spreadMax: 0, flick: 0 }, B: { latMin: 9, spreadMax: 0, flick: 0 } };
    for (let s = 0; s < secs; s += DT, t += DT) {
      const mag = sx || sy ? +(process.env.MAG || 1) : 0;
      // The left thumb, exactly as main.js maps it.
      const c0 = thumb(sx, sy, mag, rig.yaw, false);
      m.update(DT, [c0, { mx: 0, mz: 0, turn: 0, drive: 0 }]);
      rig.origin[0] = m.origin[0]; rig.origin[2] = m.origin[2]; rig.yaw = m.yaw;
      const from = m.prevPosition, to = m.pending || m.position;
      if (from === to && m.blend >= 1) rig.hold(to, DT); else rig.apply(from, to, m.blend, DT);
      for (const role of ['A', 'B']) {
        const f = rd[role].read(rig.skel[role]);
        if (name === 'stand' && s > secs - 0.1) idle[role] = f;
        const ph = phase[role];
        ph.latMin = Math.min(ph.latMin, f.lat);
        ph.spreadMax = Math.max(ph.spreadMax, f.spread);
        if (name === 'let go' && s > 1.0) ph.home = Math.max(ph.home || 0, offHome(rig.feet[role]));
        if (t > 0.1 && f.up > 1) bothUp++;
      }
      for (const role of ['A', 'B']) phase[role].flick = rd[role].flick;
    }
    for (const role of ['A', 'B']) {
      const ph = phase[role], w = worst[role];
      w.latMin = Math.min(w.latMin ?? 9, ph.latMin);
      w.splay = Math.max(w.splay ?? 0, ph.spreadMax - idle[role].spread);
      if (ph.home !== undefined) w.home = ph.home;
      if (ROWS) {
        console.log(`     ${role} ${name.padEnd(15)} feet across ${ph.latMin.toFixed(2)} m at least, apart ${ph.spreadMax.toFixed(2)} at most` +
          `${ph.home !== undefined ? `, off the stance ${ph.home.toFixed(2)}` : ''}`);
      }
    }
  }
  const lat = Math.min(worst.A.latMin, worst.B.latMin);
  const splay = Math.max(worst.A.splay, worst.B.splay);
  const home = Math.max(worst.A.home, worst.B.home);
  const flick = Math.max(rd.A.flick, rd.B.flick);
  console.log(`\n     the pair, moved by the thumb: stance ${idle.A.spread.toFixed(2)} m apart, ${idle.A.lat.toFixed(2)} across the hips`);
  check(lat >= CROSS, 'крест: the feet never cross', `${(lat * 100).toFixed(0)} cm across the hips at the closest (want ${CROSS * 100})`);
  check(splay <= SPLAY, 'шпагат: and never splay', `${(splay * 100).toFixed(0)} cm wider than the stance at worst (want ${SPLAY * 100})`);
  check(home <= HOME, 'стойка: back in the stance a second after the thumb lets go',
    `${(home * 100).toFixed(0)} cm off it (want ${HOME * 100})`);
  check(flick <= FLICK && bothUp === 0, 'шаг: a step, not a flick, and one foot down',
    `fastest foot ${flick.toFixed(1)} m/s (want ${FLICK}), both up on ${bothUp} frames`);
}

/* --------------------------------------------------------- the referee */

// He does two things, and each is held to its own. Keeping his place he steps
// in his stance, and everything above applies. Going somewhere he walks, which
// gait-check holds to a gait lab — so here only what went wrong: he walked
// sideways, facing the fight while he went round it, and a forward walk run
// sideways crosses its feet. Walking, he faces where he is going.
const SCENES = [
  ['the fight moves off', (t, o) => { o.x += (t < 4 ? 0.9 : 0) * DT; }],
  ['the camera cuts', (t, o, i) => { if (i === 60) o.cam += 2.2; }],
  ['the camera drifts round', (t, o) => { o.cam += (t > 1 && t < 5 ? 0.35 : 0) * DT; }],
  ['the fight shuffles', (t, o) => { o.x = 0.4 * Math.sin(t * 1.3); o.z = 0.3 * Math.sin(t * 0.9); }],
  ['the fight goes down', (t, o) => { o.ground = (t > 1 && t < 4) || t > 5.5; o.x = t > 2 && t < 3 ? (t - 2) * 0.6 : o.x; }],
];
{
  console.log('\n     the referee');
  let lat = 9, splay = 0, flick = 0, both = 0, home = 0, walkFrames = 0, sideways = 0, worstSide = 0;
  const worstAt = {};
  for (const [name, drive] of SCENES) {
    const ref = new Referee();
    const o = { x: 0, z: 0, cam: 0.7, ground: false };
    const origin = [0, 0, 0];
    const rd = feetReader();
    let idle = null, sFlick = 0, walked = 0;
    const ph = { latMin: 9, spreadMax: 0, wider: 0, home: 0 };
    let last = null;
    const T = 9;
    for (let i = 0; i < T * 60; i++) {
      const t = i * DT;
      drive(t, o, i);
      origin[0] = o.x; origin[2] = o.z;
      ref.update(DT, 'live', o.ground, origin, o.cam);
      const left = [Math.cos(ref.yaw), -Math.sin(ref.yaw)];
      const before = rd.flick;
      const f = rd.read(ref.skel, left, ref.mode === 'stance' ? ref.shuffle.feet.map((q) => q.home) : null);
      const root = [ref.x, ref.z];
      const v = last ? Math.hypot(root[0] - last[0], root[1] - last[1]) / DT : 0;
      const dir = last && v > 1e-4 ? [(root[0] - last[0]) / (v * DT), (root[1] - last[1]) / (v * DT)] : null;
      last = root;
      if (i === 30) idle = f;
      if (i < 30) continue;
      ph.latMin = Math.min(ph.latMin, f.lat);
      if (ref.mode === 'walk') {
        walked++;
        rd.flick = before;
        if (v > 0.5 && dir) {
          walkFrames++;
          const off = Math.abs(Math.asin(Math.max(-1, Math.min(1, dir[0] * left[0] + dir[1] * left[1])))) * 180 / Math.PI;
          if (off > 25) sideways++;
          if (off > worstSide) { worstSide = off; worstAt.side = name; }
        }
        continue;
      }
      sFlick = rd.flick;
      ph.spreadMax = Math.max(ph.spreadMax, f.spread);
      ph.wider = Math.max(ph.wider, f.wider);
      if (f.up > 1) both++;
      // Settled at the end: nothing has moved him for the last seconds of
      // every scene but the shuffle.
      if (t > T - 1 && name !== 'the fight shuffles' && !o.ground) ph.home = Math.max(ph.home, offHome(ref.shuffle));
    }
    if (ROWS) {
      console.log(`     ${name.padEnd(24)} feet across ${ph.latMin.toFixed(2)} m at least; in his stance apart ${ph.spreadMax.toFixed(2)} at most, ` +
        `off it ${ph.home.toFixed(2)} at the end, fastest foot ${sFlick.toFixed(1)} m/s; walking ${(walked * DT).toFixed(1)} s`);
    }
    if (ph.latMin < lat) { lat = ph.latMin; worstAt.lat = name; }
    if (ph.wider > splay) { splay = ph.wider; worstAt.splay = name; }
    if (ph.home > home) { home = ph.home; worstAt.home = name; }
    if (sFlick > flick) { flick = sFlick; worstAt.flick = name; }
  }
  check(lat >= CROSS, 'крест: his feet never cross', `${(lat * 100).toFixed(0)} cm across at the closest (${worstAt.lat}; want ${CROSS * 100})`);
  check(splay <= SPLAY, 'шпагат: and in his stance never splay', `${(splay * 100).toFixed(0)} cm wider than his pose asks (${worstAt.splay || '—'}; want ${SPLAY * 100})`);
  check(home <= HOME, 'стойка: and he ends up standing in it', `${(home * 100).toFixed(0)} cm off it (${worstAt.home || '—'}; want ${HOME * 100})`);
  check(flick <= FLICK && both === 0, 'шаг: in his stance a step, not a flick, and one foot down',
    `fastest foot ${flick.toFixed(1)} m/s (${worstAt.flick || '—'}; want ${FLICK}), both up on ${both} frames`);
  check(walkFrames > 0 && sideways / walkFrames <= 0.05, 'ходьба: walking, he faces where he is going',
    `${(sideways / Math.max(1, walkFrames) * 100).toFixed(0)}% of ${walkFrames} walking frames more than 25° off it, worst ${worstSide.toFixed(0)}° (${worstAt.side || '—'}; want 5%)`);
}

console.log(fail ? `\n${fail} check(s) failed` : '\nthey step like people');
process.exitCode = fail ? 1 : 0;
