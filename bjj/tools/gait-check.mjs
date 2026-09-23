// Does the walk onto the mat look like walking?
//
// intro-check asks whether the walkout is on the mat, out of the other man,
// and hands over cleanly. None of that says whether it is a walk: the version
// it passed for three rounds was a pose being slid along the mat with the feet
// dragged after it — pelvis frozen, the planted leg 45° behind the hip, the
// sole never once flat — and a player named it in one word, «выход».
//
// So this reads the walk the way a gait lab reads a person, and holds it to
// what a gait lab reports for an adult at an ordinary pace. Each line is a
// range, not a target, and each is read over the part of the walk that is
// actually walking (above two thirds of the top speed):
//
//   колено     peak bend in the swing 50–70°, nearly straight as the heel lands
//   бедро      thigh from 20–35° forward to 5–25° back
//   стопа      down heel first with the toes up 5–20°, flat for a good part of
//              the stance, off the ball with the heel up 20–45°
//   опора      the sole does not slide while it carries him, and one foot is
//              always down
//   таз        rises and falls 1.5–5 cm, turns 6–14° and drops 4–10° over a
//              stride
//   руки       swing 20–45° against the legs, not with them
//   мат        no bone of the foot under the tatami; the toe clears it in the
//              swing
//   темп       90–130 steps a minute at the top of the walk
//
//   node bjj/tools/gait-check.mjs           the walkout, both men
//   node bjj/tools/gait-check.mjs --frames  and the numbers frame by frame

import { Walkout, PHASES } from '../src/game/intro.js';
import { BONE_INDEX, BONES } from '../src/render/skeleton.js';
const BONE_NAMES = BONES.map((b) => b[0]);
import { GAIT } from '../src/game/gait.js';

// GAIT='{"AHEAD":0.5}' tries other numbers without editing gait.js.
if (process.env.GAIT) Object.assign(GAIT, JSON.parse(process.env.GAIT));

const FRAMES = process.argv.includes('--frames');
const DT = 1 / 60;
const MAT_Y = 0.05;

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const inside = (v, lo, hi) => v >= lo && v <= hi;
const P = (sk, b) => { const m = sk.world[BONE_INDEX[b]]; return [m[12], m[13], m[14]]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1,
  (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b))))) * 180 / Math.PI;
const R = 180 / Math.PI;

// Every frame of one man's walk, as the numbers a gait lab would chart.
function record(who) {
  const w = new Walkout();
  w.reset();
  const e = w[who];
  const fwd = e.forward;
  const along = (v) => v[0] * fwd[0] + v[2] * fwd[2];
  const rows = [];
  let lastRoot = null;
  // Every joint's acceleration over the whole walkout, the settle included —
  // the same measure shake-check calls a teleport past 1500 m/s².
  const hist = [];
  let worstAcc = 0, worstAt = '';
  while (!w.done) {
    w.update(DT);
    const sk = e.skel;
    const now = sk.world.map((m) => [m[12], m[13], m[14]]);
    hist.push(now);
    if (hist.length > 3) hist.shift();
    if (hist.length === 3) {
      for (let j = 0; j < now.length; j++) {
        const a = Math.hypot(...[0, 1, 2].map((k) => hist[2][j][k] - 2 * hist[1][j][k] + hist[0][j][k])) / (DT * DT);
        if (a > worstAcc) { worstAcc = a; worstAt = `${BONE_NAMES[j]} at t=${w.t.toFixed(2)}`; }
      }
    }
    if (w.t > PHASES.in) continue;
    const root = P(sk, 'hips');
    const r = { t: w.t, y: root[1], v: lastRoot ? Math.hypot(root[0] - lastRoot[0], root[2] - lastRoot[2]) / DT : 0 };
    lastRoot = root;
    r.feet = e.gait.feet.map((f) => ({ air: f.air, pitch: f.pitch, g: f.g.slice() }));
    for (const s of ['L', 'R']) {
      const th = P(sk, 'thigh' + s), sh = P(sk, 'shin' + s), ft = P(sk, 'foot' + s), toe = P(sk, 'toe' + s);
      const tv = sub(sh, th), sv = sub(ft, sh);
      r['knee' + s] = angle(tv, sv);
      r['hip' + s] = Math.atan2(along(tv), -tv[1]) * R;
      r['lo' + s] = Math.min(ft[1], toe[1]);
      r['toe' + s] = toe[1];
      const ua = sub(P(sk, 'fore' + s), P(sk, 'arm' + s));
      r['arm' + s] = Math.atan2(along(ua), -ua[1]) * R;
    }
    const lr = sub(P(sk, 'thighL'), P(sk, 'thighR'));
    const flat = Math.hypot(lr[0], lr[2]);
    r.turn = Math.atan2(along(lr), flat) * R;
    r.list = Math.atan2(lr[1], flat) * R;
    rows.push(r);
  }
  rows.worstAcc = worstAcc;
  rows.worstAt = worstAt;
  return rows;
}

const span = (xs) => Math.max(...xs) - Math.min(...xs);
const corr = (a, b) => {
  const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
};

for (const who of ['a', 'b']) {
  const rows = record(who);
  const top = Math.max(...rows.map((r) => r.v));
  // The walking part: from the first moment above two thirds of the top
  // speed to the last.
  const walk = rows.filter((r) => r.v > top * 0.66);
  console.log(`\n     ${who === 'a' ? 'A' : 'B'}: ${rows.length} frames, top speed ${top.toFixed(2)} m/s, ` +
    `${walk.length} of them walking`);

  // Knees: peak in each swing, and at each heel strike.
  const swingPeak = [], strike = [], mid = [];
  const hipFwd = [], hipBack = [];
  const heelUp = [], toesUp = [];
  let flatFrames = 0, stanceFrames = 0, slide = 0, bothUp = 0, dbl = 0, steps = 0;
  const walkT = [walk[0].t, walk[walk.length - 1].t];
  for (let k = 0; k < 2; k++) {
    const s = k ? 'R' : 'L';
    let cur = null;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], p = rows[i - 1];
      if (r.t < walkT[0] || r.t > walkT[1]) continue;
      const f = r.feet[k], pf = p.feet[k];
      if (f.air) {
        // Only swings that start inside the walk: one already half done when
        // the window opens would report half a peak.
        if (!pf.air) cur = { knee: 0 };
        if (cur) cur.knee = Math.max(cur.knee, r['knee' + s]);
      } else {
        stanceFrames++;
        if (Math.abs(f.pitch) < 3) flatFrames++;
        // The sole's reference point is the planted thing: it must not move.
        const d = Math.hypot(f.g[0] - pf.g[0], f.g[1] - pf.g[1]) / DT;
        if (!pf.air) slide = Math.max(slide, d);
        if (pf.air) {
          steps++;
          if (cur) swingPeak.push(cur.knee);
          cur = null;
          strike.push(r['knee' + s]);
          if (process.env.DEBUG) console.log('     strike', s, r.t.toFixed(2), r['knee' + s].toFixed(0), 'v', r.v.toFixed(2), 'hip', r['hip' + s].toFixed(0));
          toesUp.push(Math.max(f.pitch, pf.pitch));
        }
      }
      if (!f.air && pf.air === false && rows[i + 1] && rows[i + 1].feet[k].air) heelUp.push(-f.pitch);
      hipFwd.push(r['hip' + s]);
    }
  }
  for (const r of walk) {
    const up = r.feet.filter((f) => f.air).length;
    if (up === 2) bothUp++;
    if (up === 0) dbl++;
  }
  const hips = walk.map((r) => r.hipL).concat(walk.map((r) => r.hipR));
  const hmax = Math.max(...hips), hmin = Math.min(...hips);
  const pk = swingPeak.length ? Math.min(...swingPeak) : 0, pkHi = swingPeak.length ? Math.max(...swingPeak) : 0;
  check(swingPeak.length > 0 && pk >= 50 && pkHi <= 72, 'колено: the swing folds the knee like a step',
    `peak ${pk.toFixed(0)}–${pkHi.toFixed(0)}° over ${swingPeak.length} swings (50–70)`);
  const st = strike.length ? Math.max(...strike) : 99;
  check(st <= 15, 'колено: and lands on a nearly straight leg', `worst ${st.toFixed(0)}° at the heel strike (≤15)`);
  check(inside(hmax, 18, 38) && inside(-hmin, 5, 25), 'бедро: the thigh goes forward and back by a walk’s amount',
    `${hmax.toFixed(0)}° forward, ${(-hmin).toFixed(0)}° back (20–35, 5–25)`);
  const tu = toesUp.length ? Math.min(...toesUp) : 0;
  const hu = heelUp.length ? Math.min(...heelUp) : 0;
  check(tu >= 5 && Math.max(...toesUp) <= 22, 'стопа: down heel first', `toes up ${tu.toFixed(0)}–${Math.max(...toesUp).toFixed(0)}° at the strike (5–20)`);
  check(hu >= 18 && Math.max(...heelUp) <= 45, 'стопа: and off the ball', `heel up ${hu.toFixed(0)}–${Math.max(...heelUp).toFixed(0)}° at the lift (20–45)`);
  check(flatFrames / Math.max(1, stanceFrames) > 0.35, 'стопа: flat for a good part of the stance',
    `${(flatFrames / Math.max(1, stanceFrames) * 100).toFixed(0)}% of stance frames within 3° of flat`);
  check(slide < 0.02 && bothUp === 0, 'опора: the planted foot stays planted and one is always down',
    `slides at ${slide.toFixed(3)} m/s at most, both feet up on ${bothUp} frames, double support ${(dbl / walk.length * 100).toFixed(0)}%`);
  const bob = span(walk.map((r) => r.y)) * 100, turn = span(walk.map((r) => r.turn)), list = span(walk.map((r) => r.list));
  check(inside(bob, 1.5, 5), 'таз: rises and falls', `${bob.toFixed(1)} cm (1.5–5)`);
  check(inside(turn, 6, 14) && inside(list, 4, 10), 'таз: turns and tilts', `turn ${turn.toFixed(1)}°, drop ${list.toFixed(1)}° (6–14, 4–10)`);
  const arm = span(walk.map((r) => r.armL));
  const c = corr(walk.map((r) => r.armL), walk.map((r) => r.hipL));
  check(inside(arm, 18, 45) && c < -0.5, 'руки: swing against the legs', `${arm.toFixed(0)}° either way, ${c.toFixed(2)} against the same side’s thigh`);
  const lo = Math.min(...rows.map((r) => Math.min(r.loL, r.loR)));
  check(lo >= MAT_Y + 0.004, 'мат: no bone of the foot under the tatami', `lowest ${(lo * 100).toFixed(1)} cm (mat at ${MAT_Y * 100})`);
  const walkS = walkT[1] - walkT[0];
  const cadence = walkS > 0 ? steps / walkS * 60 : 0;
  check(inside(cadence, 90, 135), 'темп: a walker’s cadence', `${cadence.toFixed(0)} steps a minute (90–130)`);

  check(rows.worstAcc < 600, 'рывок: nothing jumps, start to handover',
    `worst ${rows.worstAcc.toFixed(0)} m/s² (${rows.worstAt}); a teleport is 1500, the swing foot of a real walk about 300`);

  if (FRAMES) {
    for (const r of rows.filter((_, i) => i % 3 === 0)) {
      console.log(`     ${r.t.toFixed(2)} v ${r.v.toFixed(2)} ${r.feet.map((f) => (f.air ? 'A' : '_')).join('')} ` +
        `knee ${r.kneeL.toFixed(0)}/${r.kneeR.toFixed(0)} hip ${r.hipL.toFixed(0)}/${r.hipR.toFixed(0)} ` +
        `pitch ${r.feet[0].pitch.toFixed(0)}/${r.feet[1].pitch.toFixed(0)} y ${r.y.toFixed(3)} turn ${r.turn.toFixed(1)} list ${r.list.toFixed(1)} arm ${r.armL.toFixed(0)}`);
    }
  }
}

// And the referee, who walks for the whole match and was on step.js's planter
// until this round: the sole rode the shin, 7° off flat on a planted foot in
// the middle and 15° at the ninetieth percentile. He is driven the way
// pose-check drives him — the fight moving off at 0.9 m/s and back at 0.6 —
// and he walks partly sideways, because he faces the fight and not where he is
// going, so only what a walk in any direction must do is held here.
{
  const { Referee } = await import('../src/game/referee.js');
  const ref = new Referee();
  const origin = [0, 0, 0];
  const FLAT = Math.atan2(-0.055, 0.15) * R;
  const last = {};
  let offFlat = [], both = 0, lo = 9, worst = 0, where = '', frames = 0, knee = 0;
  const hist = [];
  for (let i = 0; i < 900; i++) {
    origin[0] += (i < 300 ? 0.9 : i < 600 ? -0.6 : 0) * DT;
    ref.update(DT, 'live', i > 750, origin, 0.7);
    const sk = ref.skel;
    if (i < 30) continue;
    frames++;
    for (const s2 of ['L', 'R']) {
      const a = P(sk, 'foot' + s2), t = P(sk, 'toe' + s2);
      const v = last[s2] ? Math.hypot(a[0] - last[s2][0], a[2] - last[s2][2]) / DT : 0;
      last[s2] = a;
      if (v < 0.03) offFlat.push(Math.abs(Math.atan2(t[1] - a[1], Math.hypot(t[0] - a[0], t[2] - a[2])) * R - FLAT));
      lo = Math.min(lo, a[1], t[1]);
      const th = P(sk, 'thigh' + s2), sh = P(sk, 'shin' + s2);
      knee = Math.max(knee, angle(sub(sh, th), sub(a, sh)));
    }
    if (ref.gait.feet.every((f) => f.air)) both++;
    const now = sk.world.map((m) => [m[12], m[13], m[14]]);
    hist.push(now);
    if (hist.length > 3) hist.shift();
    if (hist.length === 3) {
      for (let j = 0; j < now.length; j++) {
        const acc = Math.hypot(...[0, 1, 2].map((k) => hist[2][j][k] - 2 * hist[1][j][k] + hist[0][j][k])) / (DT * DT);
        if (acc > worst) { worst = acc; where = `${BONE_NAMES[j]} at frame ${i}`; }
      }
    }
  }
  offFlat.sort((a, b) => a - b);
  const p90 = offFlat[Math.floor(offFlat.length * 0.9)];
  console.log(`\n     referee: ${frames} frames walking with the fight, stopping, crouching`);
  check(p90 < 3, 'судья: a planted foot is flat on the mat', `${p90.toFixed(1)}° off flat at the ninetieth percentile, over ${offFlat.length} planted foot-frames`);
  check(both === 0 && lo >= MAT_Y + 0.004, 'судья: one foot is always down, and none goes through the mat',
    `both feet up on ${both} frames, lowest foot bone ${(lo * 100).toFixed(1)} cm`);
  check(worst < 600, 'судья: nothing jumps', `worst ${worst.toFixed(0)} m/s² (${where})`);
}

// And the two of them on their feet in the fight. They do not walk — they
// shuffle, a foot at a time, on the pair rig's own planter (rig.js _step) —
// but the same thing was wrong under them: solved onto its spot on the mat,
// the leg carried the sole round with the shin, and a planted foot in the
// standing positions sat 7° off flat in the middle, 22° at the ninetieth
// percentile and 55° at worst, with a foot's bones up to two centimetres
// under the tatami. The foot now keeps the angle its pose gave it. Six
// minutes of AI against AI with a thumb circling the stick, standing frames
// only.
{
  const { Match, Fighter, MATCH_TIME } = await import('../src/game/match.js');
  const { AI } = await import('../src/game/ai.js');
  const { PairRig } = await import('../src/game/rig.js');
  const { POSES } = await import('../src/game/poses.js');
  const { seedRandom } = await import('../src/game/rng.js');
  const FLAT = Math.atan2(-0.055, 0.15) * R;
  const off = [];
  let lo = 9, frames = 0;
  for (let n = 0; n < 4; n++) {
    seedRandom(100 + n);
    const m = new Match([new Fighter('a'), new Fighter('b')], { time: MATCH_TIME });
    const a = new AI(0, 'blue'), b = new AI(1, 'blue');
    const rig = new PairRig();
    rig.live = true;
    m.start();
    const last = {};
    for (let t = 0; t < 90 && m.state !== 'over'; t += DT) {
      a.update(DT, m, (d) => m.input(0, d), () => m.grip(0));
      b.update(DT, m, (d) => m.input(1, d), () => m.grip(1));
      m.update(DT, [{ mx: Math.sin(t * 0.7), mz: Math.cos(t * 0.5), turn: 0, drive: 0.3 }, b.control]);
      rig.origin[0] = m.origin[0]; rig.origin[2] = m.origin[2]; rig.yaw = m.yaw;
      const from = m.prevPosition, to = m.pending || m.position;
      if (from === to && m.blend >= 1) rig.hold(to, DT); else rig.apply(from, to, m.blend, DT);
      if (POSES[m.position].ground || from !== to) { for (const k in last) delete last[k]; continue; }
      frames++;
      for (const role of ['A', 'B']) {
        const sk = rig.skel[role];
        for (const s2 of ['L', 'R']) {
          const f = P(sk, 'foot' + s2), tt = P(sk, 'toe' + s2);
          const key = role + s2;
          const v = last[key] ? Math.hypot(f[0] - last[key][0], f[2] - last[key][2]) / DT : 9;
          last[key] = f;
          if (v < 0.03) {
            off.push(Math.abs(Math.atan2(tt[1] - f[1], Math.hypot(tt[0] - f[0], tt[2] - f[2])) * R - FLAT));
            lo = Math.min(lo, f[1], tt[1]);
          }
        }
      }
    }
  }
  off.sort((x, y) => x - y);
  const p90 = off[Math.floor(off.length * 0.9)];
  console.log(`\n     the pair standing: ${frames} frames of ${4} matches`);
  check(p90 < 10 && off[off.length - 1] < 15, 'стойка: a planted foot keeps its pose’s angle to the mat',
    `${p90.toFixed(1)}° off flat at the ninetieth percentile, ${off[off.length - 1].toFixed(1)}° at worst`);
  check(lo >= MAT_Y + 0.004, 'стойка: and none goes through the mat', `lowest planted foot bone ${(lo * 100).toFixed(1)} cm`);
}

console.log(fail ? `\n${fail} check(s) failed` : '\nit is a walk');
process.exitCode = fail ? 1 : 0;
