// The replay after the bell: does it show the moment, and can you see it?
//
// replay.js keeps the last seconds of the match as the renderer drew them and
// shows the one that decided it again, at half speed, from the other side of
// the mat. Three things can go wrong with that and none of them shows up
// in a screenshot of one match:
//
//   что      the window is the wrong one — a points win replays four seconds
//            of hand fighting because the move that scored was older than the
//            ring, or a submission replays the walk back to the middle.
//   видно    the new angle is a worse picture than the live one: the referee
//            is now between the lens and the pair, a head is under the
//            letterbox bars, the lens is inside a body. The live camera was
//            measured into shape by camera-check; turning it round the pair
//            is a new camera, and it is measured here by the same rules.
//   верно    what is shown is not what was drawn. The skin is recomputed from
//            the kept world matrices, so a frame of the replay at a kept
//            instant has to be the live frame to the last float.
//
// Real matches, AI against AI, with the rig, the camera and the referee
// driven the way main.js drives them — camera-check's loop — and every
// finished match's replay played through frame by frame.
//
//   node bjj/tools/replay-check.mjs              24 matches
//   node bjj/tools/replay-check.mjs 40 --sweep   the turn and the step in, swept

import { Match, Fighter, MATCH_TIME } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { PairRig } from '../src/game/rig.js';
import { Camera } from '../src/game/camera.js';
import { BONE_INDEX, BONES } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { Referee } from '../src/game/referee.js';
import { HUD } from '../src/ui/hud.js';
import { POSES } from '../src/game/poses.js';
import { Replay, RATE, TAIL, SHOT } from '../src/game/replay.js';
import { m4, m4mul, m4perspective, m4lookAt } from '../src/core/m4.js';
import { seedRandom } from '../src/game/rng.js';

const args = process.argv.slice(2);
const N = +(args[0] > 0 ? args[0] : 24);
const SWEEP = args.includes('--sweep');
const ASPECT = 844 / 390;
const W = 844, H = W / ASPECT;
const NEAR = 0.08;
const REF_OVER = 0.25;   // camera-check's own line for «a referee in the fight»
const BARS = (() => {
  const hud = new HUD({ getContext: () => ({}) });
  hud.w = W; hud.h = H;
  return hud.replayLayout();
})();

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DT = 1 / 60;
const LEVELS = ['white', 'blue', 'purple', 'brown', 'black'];
const inside = new Overlap();

// One match, played to the bell and a little past it, with everything the
// live frame would have put on the tape. Returns the replay, ready to play,
// and what is needed to judge it.
function play(level, seed) {
  seedRandom(seed);
  const replay = new Replay(new PairRig().skel.A.invBind);
  const events = [];
  const m = new Match([new Fighter('вы'), new Fighter('соперник')], {
    time: MATCH_TIME,
    onEvent: (e) => {
      if (e.kind === 'position' || e.kind === 'points' || e.kind === 'submission') {
        replay.mark(e.kind, e.by);
        events.push({ kind: e.kind, by: e.by, t: replay.clock });
      } else if (e.kind === 'end') {
        events.push({ kind: 'end', winner: e.winner, by: e.by, t: replay.clock });
        replay.end(e.winner, e.by);
      }
    },
  });
  const a = new AI(0, level), b = new AI(1, level);
  const rig = new PairRig();
  rig.live = true;
  const cam = new Camera();
  const referee = new Referee();
  m.start();
  // A snapshot of one live frame, to hold the replay against.
  let snap = null;
  const want = 120 + (seed % 600);
  let frames = 0, after = 0;
  while (frames < (MATCH_TIME + 2) * 60) {
    frames++;
    if (m.state !== 'over') {
      a.update(DT, m, (d) => m.input(0, d), () =>
        (m.state === 'sub' && m.sub.attacker === 0 ? m.subTap(0) : m.grip(0)));
      b.update(DT, m, (d) => m.input(1, d), () =>
        (m.state === 'sub' && m.sub.attacker === 1 ? m.subTap(1) : m.grip(1)));
    }
    m.update(DT, [a.control, b.control]);
    rig.origin[0] = m.origin[0];
    rig.origin[2] = m.origin[2];
    rig.yaw = m.yaw;
    for (const [role, idx] of [['A', m.roleShown.indexOf('A')], ['B', m.roleShown.indexOf('B')]]) {
      const f = m.f[idx];
      const working = (m.attempt && m.attempt.by === idx) || (m.state === 'sub' && m.sub.attacker === idx);
      const held = m.state === 'sub' && m.sub.defender === idx;
      rig.effort[role] = clamp((working ? 0.9 : 0) + (held ? 0.75 : 0) + m.intensity * 0.25
        + (1 - f.stamina / 100) * 0.3, 0, 1.2);
      rig.slack[role] = clamp(1 - f.posture / 100, 0, 1);
      rig.gas[role] = clamp(1 - f.stamina / 100, 0, 1);
      rig.fight[role] = m.gripFight[idx];
    }
    const from = m.prevPosition, to = m.pending || m.position;
    if (from === to && m.blend >= 1) rig.hold(to, DT);
    else rig.apply(from, to, m.blend, DT);
    const ha = rig.skel.A.world[0], hb = rig.skel.B.world[0];
    const focus = [(ha[12] + hb[12]) / 2, (ha[13] + hb[13]) / 2, (ha[14] + hb[14]) / 2];
    const mode = m.state === 'sub' ? 'sub' : POSES[m.position].ground ? 'ground' : 'stand';
    let spread = 0;
    for (const role of ['A', 'B']) {
      for (const w of rig.skel[role].world) {
        const d = Math.hypot(w[12] - focus[0], w[13] - focus[1], w[14] - focus[2]);
        if (d > spread) spread = d;
      }
    }
    cam.update(DT, focus, mode, m.intensity, spread);
    referee.update(DT, m.state, POSES[m.position].ground, m.origin, cam.orbit);
    const ia = m.roleShown.indexOf('A'), ib = m.roleShown.indexOf('B');
    replay.record(DT, [rig.skel.A, rig.skel.B, referee.skel], cam, {
      ia, ib, flash: [0, 0], gas: [0, 0], crowd: 0, spot: 0,
      score: [m.f[0].points, m.f[1].points], clock: m.time,
    });
    // Fidelity, at one instant of the match: the frame just kept, read back
    // off the tape, against the skin that was actually drawn.
    if (frames === want && !snap && m.state !== 'over') {
      replay.source = replay.ring;
      replay.play = { t: replay.clock, turn: 0 };
      replay._sample(replay.ring.last);
      let e = 0;
      for (const [mine, shown] of [[rig.skel.A, replay.skel[0]], [rig.skel.B, replay.skel[1]], [referee.skel, replay.skel[2]]]) {
        for (let k = 0; k < mine.skin.length; k++) e = Math.max(e, Math.abs(mine.skin[k] - shown.skin[k]));
      }
      replay.play = null;
      snap = { e };
    }
    if (m.state === 'over') {
      after += DT;
      if (replay.tick(DT) || after > TAIL + 0.1) break;
    }
  }
  // How long the fight inside the lock lasted, for choosing the window.
  const lock = events.filter((e) => e.kind === 'submission').pop();
  const end = events.find((e) => e.kind === 'end');
  return { replay, events, snap, over: m.state === 'over', winBy: m.winBy, winner: m.winner,
    segments: replay.playing ? replay.segments.map((x) => x.slice()) : null, source: replay.source,
    sub: m.winBy === 'submission' && lock && end ? end.t - lock.t : null };
}

const view = m4(), proj = m4(), vp = m4();
function project(x, y, z) {
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (cw <= NEAR) return null;
  return [(vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / cw, (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / cw, cw];
}

// One frame of a picture — the replay's or, for comparison, the live one —
// judged by camera-check's rules.
function judge(eye, at, fov, skA, skB, ref, s) {
  m4perspective(proj, fov, ASPECT, NEAR, 70);
  m4lookAt(view, eye, at, [0, 1, 0]);
  m4mul(vp, proj, view);
  let minX = 9, maxX = -9, minY = 9, maxY = -9, heads = 0, out = 0, n = 0, under = false;
  for (const sk of [skA, skB]) {
    for (let i = 0; i < BONES.length; i++) {
      const w = sk.world[i];
      const p = project(w[12], w[13], w[14]);
      n++;
      if (!p) { out++; continue; }
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      if (p[0] < -1 || p[0] > 1 || p[1] < -1 || p[1] > 1) out++;
      else if (i === BONE_INDEX.head) {
        heads++;
        // Under a bar: the head's disc, a tenth of a metre, touching either.
        const py = (0.5 - p[1] * 0.5) * H;
        const r = (0.1 / p[2]) * proj[5] * 0.5 * H;
        if (py - r < BARS.top || py + r > BARS.bottom) under = true;
      }
    }
  }
  let rx0 = 9, rx1 = -9, ry0 = 9, ry1 = -9;
  for (const w of ref.world) {
    const p = project(w[12], w[13], w[14]);
    if (!p) continue;
    rx0 = Math.min(rx0, p[0]); rx1 = Math.max(rx1, p[0]);
    ry0 = Math.min(ry0, p[1]); ry1 = Math.max(ry1, p[1]);
  }
  const area = Math.max(0, rx1 - rx0) * Math.max(0, ry1 - ry0);
  const ix = Math.max(0, Math.min(rx1, maxX) - Math.max(rx0, minX));
  const iy = Math.max(0, Math.min(ry1, maxY) - Math.max(ry0, minY));
  // In front of the lens: nearer than the pair's middle and in the middle
  // half of the picture.
  const rh = ref.world[0];
  const rp = project(rh[12], rh[13], rh[14]);
  const dRef = Math.hypot(rh[12] - eye[0], rh[14] - eye[2]);
  const dPair = Math.hypot(at[0] - eye[0], at[2] - eye[2]);
  s.frames++;
  if (area > 0 && (ix * iy) / area > REF_OVER) s.refOver++;
  if (rp && dRef < dPair && Math.abs(rp[0]) < 0.5) s.refIn++;
  if (heads < 2) s.headOut++;
  if (under) s.headUnder++;
  if (out) s.cropped++;
  s.fill += (maxY - minY) / 2;
  let hit = false, near = false;
  for (const sk of [skA, skB]) {
    if (inside.contains(sk, eye).length) hit = true;
    // camera-check's «too close»: the lens within 35 cm of a body's surface.
    if (inside.contains(sk, eye, 0.35).length) near = true;
  }
  if (hit) s.inside++;
  if (near) s.near++;
}

const blank = () => ({ frames: 0, refOver: 0, refIn: 0, headOut: 0, headUnder: 0, cropped: 0, fill: 0, inside: 0, near: 0 });

// Played once; every shot is judged on the same tapes.
let played = null;
function run(n, shot) {
  Object.assign(SHOT, shot);
  if (!played) played = Array.from({ length: n }, (_, i) => play(LEVELS[i % LEVELS.length], 1000 + i * 7919));
  const s = blank(), live = blank();
  const res = { wins: 0, shown: 0, subs: 0, subsShown: 0, pts: 0, ptsShown: 0, hasMove: 0, hasTap: 0,
    walls: [], worst: 0, fidelity: 0, fidelityN: 0, lockT: [], cuts: 0 };
  for (const r of played) {
    if (!r.over) continue;
    const { replay, events } = r;
    const decided = r.winner != null && (r.winBy === 'submission' || r.winBy === 'points');
    if (decided) res.wins++;
    if (r.winBy === 'submission') res.subs++;
    if (r.winBy === 'points') res.pts++;
    if (r.snap) {
      res.fidelity = Math.max(res.fidelity, r.snap.e);
      res.fidelityN++;
    }
    if (!r.segments) continue;
    // Rewound, so the same match can be played again under another shot.
    replay.phase = 'play';
    replay.segments = r.segments.map((x) => x.slice());
    replay.source = r.source;
    replay.play = { seg: 0, t: r.segments[0][0], done: 0, turn: replay._pickTurn() };
    if (r.sub != null) res.lockT.push(r.sub);
    res.shown++;
    if (r.winBy === 'submission') res.subsShown++;
    if (r.winBy === 'points') res.ptsShown++;
    const inside = (t) => r.segments.some(([a, b]) => t >= a && t <= b);
    // What it is of. A points win has to contain the winner's move that
    // scored; a submission has to contain the lock going on or, if the fight
    // inside it was long, the end of it.
    const end = events.find((e) => e.kind === 'end');
    if (r.winBy === 'points') {
      const paid = events.filter((e) => e.kind === 'points' && e.by === r.winner).pop();
      const move = paid && events.filter((e) => e.kind === 'position' && e.by === r.winner && e.t <= paid.t).pop();
      if (move && inside(move.t)) res.hasMove++;
    } else if (r.winBy === 'submission') {
      // Both ends of it: the lock going on, and the tap.
      const lock = events.filter((e) => e.kind === 'submission' && e.t <= end.t).pop();
      if (end && inside(end.t - 0.05) && lock && inside(lock.t)) res.hasTap++;
      if (r.segments.length > 1) res.cuts++;
    }
    const wall = replay.length / RATE;
    res.walls.push(wall);
    // Played through, frame by frame, and each frame judged; and the live
    // camera's frame of the same instant, for the comparison.
    const liveCam = { eye: [0, 0, 0], at: [0, 0, 0] };
    while (replay.step(DT)) {
      judge(replay.camera.eye, replay.camera.at, replay.camera.fov, replay.skel[0], replay.skel[1], replay.skel[2], s);
      const src = replay.source, k = src.find(replay.play.t), o = src.slot(k) * 18;
      liveCam.eye = [src.info[o + 1], src.info[o + 2], src.info[o + 3]];
      liveCam.at = [src.info[o + 4], src.info[o + 5], src.info[o + 6]];
      judge(liveCam.eye, liveCam.at, src.info[o + 7], replay.skel[0], replay.skel[1], replay.skel[2], live);
    }
  }
  return { s, live, res };
}

const pct = (v, n) => (n ? (v / n) * 100 : 0).toFixed(1);
const table = (label, s) => console.log(`     ${label.padEnd(12)} ` +
  `${pct(s.refOver, s.frames).padStart(6)}% ${pct(s.refIn, s.frames).padStart(7)}% ` +
  `${pct(s.headOut, s.frames).padStart(7)}% ${pct(s.headUnder, s.frames).padStart(8)}% ` +
  `${pct(s.cropped, s.frames).padStart(7)}% ${pct(s.inside, s.frames).padStart(6)}% ${pct(s.near, s.frames).padStart(6)}% ` +
  `${((s.fill / Math.max(1, s.frames)) * 100).toFixed(0).padStart(6)}%`);
const HEAD = '     кадр         рефери  перед   голова  под      срез    внутри  ближе   пара\n' +
             '                  в паре  линзой  за кадр шторкой           тела   35 см   в кадре';

if (SWEEP) {
  console.log(HEAD);
  const degs = (process.env.DEGS || '0,20,40,60,80,100,120,140,160,180').split(',').map(Number);
  const closers = (process.env.CLOSERS || '0.8,1').split(',').map(Number);
  for (const deg of degs) {
    for (const closer of closers) {
      const { s, live } = run(N, { turn: (deg * Math.PI) / 180, closer });
      if (deg === degs[0] && closer === closers[0]) table('живая', live);
      table(`${deg}° ×${closer}`, s);
    }
  }
  process.exit(0);
}

const t0 = Date.now();
const { s, live, res } = run(N, {});
console.log(`${N} matches, ${res.wins} decided by points or a tap, ${Date.now() - t0}ms\n`);
console.log(HEAD);
table('живая', live);
table('повтор', s);
console.log('');
const walls = res.walls.slice().sort((a, b) => a - b);
const locks = res.lockT.slice().sort((a, b) => a - b);
if (locks.length) console.log(`     the fight inside a finishing lock lasts ${locks[locks.length >> 1].toFixed(1)}s in the middle, ` +
  `${locks[Math.floor(locks.length * 0.9)].toFixed(1)}s at the 90th percentile`);
console.log(`     a replay lasts ${walls.length ? walls[walls.length >> 1].toFixed(1) : '-'}s of wall clock in the middle, ` +
  `${walls.length ? walls[walls.length - 1].toFixed(1) : '-'}s at the longest\n`);

check(res.shown >= res.wins * 0.9, 'a win by points or by a tap gets its replay',
  `${res.shown} of ${res.wins} (${res.subsShown}/${res.subs} taps, ${res.ptsShown}/${res.pts} on points)`);
check(res.hasMove === res.ptsShown, 'a points win replays the move that scored',
  `${res.hasMove} of ${res.ptsShown}`);
check(res.hasTap === res.subsShown, 'a submission replays the lock going on and the tap',
  `${res.hasTap} of ${res.subsShown}, ${res.cuts} of them in two pieces`);
check(res.fidelityN > 0 && res.fidelity < 1e-5, 'a kept instant is shown as it was drawn',
  `largest skin difference ${res.fidelity.toExponential(1)} over ${res.fidelityN} snapshots`);
check(walls.length && walls[walls.length - 1] <= 8, 'and none of them outstays its welcome',
  `longest ${walls.length ? walls[walls.length - 1].toFixed(1) : '-'}s`);
// The picture, by camera-check's own lines — and no worse than the live
// camera on the same instants.
check(+pct(s.refOver, s.frames) < 15, 'the referee is not in the middle of the replay',
  `${pct(s.refOver, s.frames)}% of frames (live ${pct(live.refOver, live.frames)}%)`);
check(+pct(s.refIn, s.frames) < 1, 'nor in front of its lens', `${pct(s.refIn, s.frames)}%`);
check(+pct(s.headOut, s.frames) < 5, 'both heads are in the replay', `${pct(s.headOut, s.frames)}%`);
check(+pct(s.headUnder, s.frames) < 5, 'and not under its letterbox bars', `${pct(s.headUnder, s.frames)}%`);
check(+pct(s.inside, s.frames) < 0.5, 'and its camera is never inside a body', `${pct(s.inside, s.frames)}%`);
// Nor closer to one than the live camera gets: the reverse angle is the live
// one turned round the pair, and a pair spread along the live lens's axis
// puts one man right under the turned one.
check(+pct(s.near, s.frames) <= +pct(live.near, live.frames) + 2, 'nor closer to one than the live camera gets',
  `within 35 cm of a body on ${pct(s.near, s.frames)}% of frames, live ${pct(live.near, live.frames)}%`);

console.log(fail ? `\n${fail} check(s) failed` : '\nthe moment is shown, and you can see it');
process.exitCode = fail ? 1 : 0;
