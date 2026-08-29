// Pose lint. Runs the rig headless — no browser, no GPU — and asks of every
// paired pose the questions a person would ask looking at it:
//
//   is anybody through the mat?
//   is a hand somewhere an arm cannot reach?
//   are the two of them actually touching, or acting at a distance?
//   is either of them inside the other?
//
// Eyeballing fifteen poses in a contact sheet catches the gross errors. This
// catches the ones that only show up from the other side of the camera.

import { PairRig } from '../src/game/rig.js';
import { POSES } from '../src/game/poses.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { GRIP_POINTS } from '../src/render/body.js';
import { m4point, v3 } from '../src/core/m4.js';
import { violations } from '../src/game/intent.js';

const MAT_Y = 0.05;
const _t = v3();
// Shoulder to wrist on the rest skeleton, the same number rig.js uses.
const ARM = 0.52;
const rig = new PairRig();
const overlap = new Overlap();
// Knees are in the list because half the contact in this sport is a knee:
// knee on belly, a knee cutting through, a knee wedged in a hip.
const READ = [
  'headTop', 'handL', 'handR', 'footL', 'footR', 'hips', 'chest', 'shinL', 'shinR',
];

let problems = 0;
const rows = [];

for (const id of Object.keys(POSES)) {
  rig.effort.A = rig.effort.B = 0;
  rig.slack.A = rig.slack.B = 0;
  rig.time = 0;
  rig.applyAt(id, id, 1, 0.016);

  const info = { id, notes: [] };
  const pos = {};
  for (const role of ['A', 'B']) {
    const sk = rig.skel[role];
    pos[role] = {};
    for (const b of READ) {
      const m = sk.world[BONE_INDEX[b]];
      pos[role][b] = [m[12], m[13], m[14]];
    }
    // Through the floor. A little is fine — a shoulder digs into foam — but a
    // hip 8 cm under the mat is a pose nobody authored on purpose.
    for (const b of READ) {
      const y = pos[role][b][1];
      if (y < MAT_Y - 0.075) {
        info.notes.push(`${role}.${b} under the mat by ${((MAT_Y - y) * 100).toFixed(0)}cm`);
      }
    }
    // Is the hand on the thing it is holding?
    //
    // This is the claim the whole grip system exists to make — a hand on a
    // lapel stays on the lapel for the length of a pass — and nothing measured
    // it. Two different faults hide behind one number, so both are named:
    //
    //   out of reach  the pose asks for a grip the arm cannot make. The rig is
    //                 right to let go; the pose is what is wrong.
    //   loose         the target is within reach and the hand is not on it.
    //
    for (const g of POSES[id].grips || []) {
      if (g.role !== role) continue;
      const def = GRIP_POINTS[g.point];
      if (!def) continue;
      const other = rig.skel[g.self ? role : role === 'A' ? 'B' : 'A'];
      m4point(_t, other.world[BONE_INDEX[def[0]]], def[1]);
      const sh = sk.world[BONE_INDEX[g.hand === 'L' ? 'armL' : 'armR']];
      const h = sk.world[BONE_INDEX[g.hand === 'L' ? 'handL' : 'handR']];
      const reach = Math.hypot(sh[12] - _t[0], sh[13] - _t[1], sh[14] - _t[2]) / ARM;
      const gap = Math.hypot(h[12] - _t[0], h[13] - _t[1], h[14] - _t[2]);
      if (reach > 1.0) {
        info.notes.push(`${role}.hand${g.hand} cannot reach the ${g.point} it holds ` +
          `(${(reach * 100).toFixed(0)}% of the arm)`);
      } else if (gap > 0.06) {
        info.notes.push(`${role}.hand${g.hand} is ${(gap * 100).toFixed(0)}cm off the ${g.point} ` +
          `it holds, and could reach it (${(reach * 100).toFixed(0)}%)`);
      }
      info.grip = Math.max(info.grip || 0, reach > 1.0 ? 0 : gap);
    }

    // Arms that had to straighten to reach their grip.
    for (const [hand, sh] of [['handL', 'armL'], ['handR', 'armR']]) {
      const a = sk.world[BONE_INDEX[sh]];
      const h = sk.world[BONE_INDEX[hand]];
      const d = Math.hypot(h[12] - a[12], h[13] - a[13], h[14] - a[14]);
      // A joint lock straightens an arm on purpose; that is the technique.
      if (d > 0.515 && POSES[id].submission !== 'joint') {
        info.notes.push(`${role}.${hand} at full stretch (${(d * 100).toFixed(0)}cm)`);
      }
    }
  }

  // Contact. Two people in a grappling position are never more than a forearm
  // apart at their closest point; if they are, the pose is two solos.
  let closest = 1e9;
  for (const b of READ) {
    for (const c of READ) {
      const d = dist(pos.A[b], pos.B[c]);
      if (d < closest) closest = d;
    }
  }
  // Standing is the one pose where they are meant to be apart.
  if (closest > 0.34 && id !== 'STANDING') {
    info.notes.push(`no contact — closest pair is ${(closest * 100).toFixed(0)}cm`);
  }

  // Interpenetration, properly. Both bodies are covered by capsules down the
  // bones and every pair is tested. The old version compared two chest points
  // and passed everything, which is how fifteen poses shipped with limbs up to
  // 21 cm inside each other.
  const ov = overlap.measure(rig.skel.A, rig.skel.B);
  info.overlap = ov.deepest;
  // Contact the pose itself asked for is judged more loosely.
  //
  // A guillotine is an arm around a head — the pose says so in its own `hold`,
  // "the head is under the arm, that is the whole technique" — and a capsule
  // model has no way to represent an arm around anything: a forearm at the
  // throat and a head are two solids reading eight centimetres into each other
  // however carefully the pose is authored. Where the author has declared that
  // two parts must be near each other, they are allowed to be inside each other
  // rather further than parts that have no business touching at all.
  const declared = new Set();
  for (const h of POSES[id].hold || []) {
    if (h.of && h.near) declared.add([h.of, h.near].sort().join('|'));
  }
  const pair = ov.where && ov.where.replace(' in ', '|').split('|').sort().join('|');
  const limit = declared.has(pair) ? 0.12 : 0.08;
  if (ov.deepest > limit) {
    info.notes.push(`${(ov.deepest * 100).toFixed(0)}cm of ${ov.where} — a limb is inside a body`);
  }

  // Is it still the position it says it is? See intent.js — this catches the
  // failure the overlap number cannot, which is a pose that fixed its
  // collisions by quietly becoming a different position.
  for (const v of violations(rig.skel, POSES[id].hold, 0.04)) {
    info.notes.push(`not ${id} any more — ${v.why}`);
  }

  info.closest = closest;
  rows.push(info);
  problems += info.notes.length;
}

for (const r of rows) {
  const tag = r.notes.length ? '!' : ' ';
  console.log(
    `${tag} ${r.id.padEnd(15)} contact ${(r.closest * 100).toFixed(0).padStart(3)}cm` +
    `   deepest overlap ${(r.overlap * 100).toFixed(0).padStart(3)}cm`
  );
  for (const n of r.notes) console.log(`      · ${n}`);
}
// Does fatigue move the man?
//
// The rig carries three channels on top of the authored pose: effort, which is
// what he is doing this second; slack, which is his posture gone; and gas,
// which is what three minutes have done to him. Only the third is fatigue, and
// it is the one that has to be visible without a HUD bar — heavier breathing
// that does not stop when he stops, shoulders that lift with it, arms carried
// lower.
//
// Measured here rather than on screen because here it is exact. A frame
// comparison could not tell the feature from the renderer's own noise: see the
// note in tools/smoke.mjs.
const gasMove = (() => {
  let T = 3.0;
  const at = (gas) => {
    rig.effort.A = rig.effort.B = 0.2;
    rig.slack.A = rig.slack.B = 0;
    rig.gas.A = rig.gas.B = gas;
    rig.time = T;
    rig.invalidate('MOUNT');
    rig.applyAt('MOUNT', 'MOUNT', 1, 0.016);
    return READ.concat(['clavL', 'clavR', 'armL', 'armR', 'neck'])
      .map((b) => { const m = rig.skel.A.world[BONE_INDEX[b]]; return [m[12], m[13], m[14]]; });
  };
  // Over a whole breath, not at one instant of it: the two men are in phase at
  // the top of the cycle whatever their gas, and a reading taken there says
  // fatigue does nothing.
  let sum = 0, worst = 0, n = 0;
  for (let k = 0; k < 12; k++) {
    T = 3.0 + k * 0.11;
    const fresh = at(0), spent = at(1);
    for (let i = 0; i < fresh.length; i++) {
      const d = Math.hypot(fresh[i][0] - spent[i][0], fresh[i][1] - spent[i][1], fresh[i][2] - spent[i][2]);
      sum += d; n++;
      if (d > worst) worst = d;
    }
  }
  return { mean: sum / n, worst };
})();
const gasOk = gasMove.worst > 0.02 && gasMove.mean > 0.006;
if (!gasOk) problems++;
console.log(
  `${gasOk ? ' ' : '!'} fatigue moves the man ` +
  `${(gasMove.mean * 100).toFixed(1)}cm on average, ${(gasMove.worst * 100).toFixed(1)}cm at the most, ` +
  'with effort and posture held'
);

/* --------------------------------------------- what the live layers cost */

// The step planner and the inertia depend on the frame before, so every tool
// that measures geometry switches them off — otherwise the number depends on
// how the tool happened to step. That leaves a gap between what is judged and
// what is played, and a gap nobody measures is a gap that grows.
//
// So: hold each of the busy positions for six seconds, with the live layers on
// and off, and compare the deepest moment. The cost is what the player sees
// that the judge does not.
{
  const STEP = 1 / 60;
  const run = (live) => {
    rig.live = live;
    rig.heldId = null;
    rig.effort.A = rig.effort.B = 0.3;
    rig.slack.A = rig.slack.B = 0;
    rig.time = 0;
    rig.origin[0] = 0; rig.origin[2] = 0;
    let worst = 0;
    for (let i = 0; i < 360; i++) {
      rig.hold(POSE, STEP);
      const d = overlap.measure(rig.skel.A, rig.skel.B).deepest;
      if (i > 30 && d > worst) worst = d;
    }
    return worst;
  };
  let POSE = 'MOUNT';
  let worstCost = 0;
  const parts = [];
  for (const id of ['MOUNT', 'SIDE_CONTROL', 'BACK', 'CLOSED_GUARD', 'HALF_GUARD']) {
    POSE = id;
    const off = run(false), on = run(true);
    worstCost = Math.max(worstCost, on - off);
    parts.push(`${id} ${(off * 100).toFixed(0)}→${(on * 100).toFixed(0)}`);
  }
  rig.live = true;
  const ok = worstCost < 0.035;
  if (!ok) problems++;
  console.log(`${ok ? ' ' : '!'} living costs ${(worstCost * 100).toFixed(1)}cm of depth at worst  (${parts.join(', ')})`);
}

/* ------------------------------------------------- does a throw have weight? */

// A transition used to be a smoothstep: the same acceleration as deceleration,
// a symmetric bell. That is the curve of something being carried. A body that
// throws another body gathers, goes, and arrives, and the arrival is a stop
// with a drop in it.
//
// Measured on the hips of the man who ends up on top: where in the transition
// his speed peaks, and how far he settles after it ends.
{
  const STEP = 1 / 60;
  const LEN = 0.55;                     // about what the sim gives a big move
  const shots = [['CLOSED_GUARD', 'MOUNT'], ['SIDE_CONTROL', 'MOUNT'], ['STANDING', 'CLINCH']];
  let worstPeak = 0;
  for (const [from, to] of shots) {
    rig.heldId = null;
    rig.lag = false;                    // one thing at a time
    rig.origin[0] = 0; rig.origin[2] = 0;
    rig.time = 0;
    rig.live = true;
    rig.apply(from, to, 0, STEP);
    const speeds = [];
    let last = null;
    const n = Math.round(LEN / STEP);
    for (let i = 0; i <= n + 24; i++) {
      const t = Math.min(1, (i * STEP) / LEN);
      rig.apply(from, to, t, STEP);
      const m = rig.skel.A.world[BONE_INDEX.hips];
      const p = [m[12], m[13], m[14]];
      if (last) speeds.push({ t, v: Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) / STEP });
      last = p;
    }
    rig.lag = true;
    let peak = speeds[0];
    for (const s2 of speeds) if (s2.v > peak.v) peak = s2;
    // How long he spends gathering: the stretch at the start where he is
    // moving at less than a fifth of his fastest.
    let gather = 0;
    for (const s2 of speeds) { if (s2.v < peak.v * 0.2) gather = s2.t; else break; }
    worstPeak = Math.max(worstPeak, peak.t);
    console.log(`  ${from} → ${to}: gathers for ${(gather * 100).toFixed(0)}%, ` +
      `fastest at ${(peak.t * 100).toFixed(0)}% of the way`);
  }
  // A settle at the end was tried here and taken out: see the note in rig.js.
  // It cost three centimetres of the other man at the moment the two of them
  // are closest, and the impact already has a camera impulse behind it.
  const ok = worstPeak < 0.45;
  if (!ok) problems++;
  console.log(`${ok ? ' ' : '!'} a throw gathers and then goes, rather than easing both ways`);
}

/* ------------------------------------------------------ does anything lag? */

// A skeleton where every bone arrives exactly when the pose says is a
// slideshow of positions. Soft parts do not: a head follows the shoulders it
// sits on, a forearm swings after the elbow.
//
// Measured by swinging the pair sideways and watching what the head and the
// hands do that they would not do if the pose were the whole story — the same
// run twice, once with the lag on and once with it off, and the difference in
// degrees. Then the body is stopped and the same difference has to fall away,
// because a spring that does not settle is a wobble.
{
  const STEP = 1 / 60;
  const run = (lag) => {
    rig.lag = lag;
    // Only the lag is under test: the step planner would otherwise end the two
    // runs with the feet in different places and leave a difference that never
    // decays, which reads as a spring that does not settle.
    rig.walk = false;
    rig.heldId = null;
    rig.origin[0] = 0; rig.origin[2] = 0;
    rig.vel[0] = 0; rig.vel[2] = 0;
    rig.time = 0;
    for (const role of ['A', 'B']) {
      for (const b in rig.inert[role]) rig.inert[role][b].set = false;
    }
    const out = [];
    for (let i = 0; i < 200; i++) {
      const t = i * STEP;
      // A metre and a half a second, side to side, then still.
      rig.origin[0] = t < 2 ? Math.sin(t * 4.2) * 0.36 : Math.sin(2 * 4.2) * 0.36;
      rig.hold('STANDING', STEP);
      const row = {};
      for (const b of ['head', 'handL', 'handR']) {
        const m = rig.skel.A.world[BONE_INDEX[b]];
        row[b] = [m[12], m[13], m[14]];
      }
      out.push(row);
    }
    return out;
  };
  const on = run(true);
  const off = run(false);
  rig.lag = true;
  rig.walk = true;
  const diff = (i) => Math.max(...['head', 'handL', 'handR'].map((b) =>
    Math.hypot(on[i][b][0] - off[i][b][0], on[i][b][1] - off[i][b][1], on[i][b][2] - off[i][b][2])));
  let moving = 0;
  for (let i = 30; i < 120; i++) moving = Math.max(moving, diff(i));
  // Whether it settles is asked of the spring itself, not of the skeleton.
  // The two runs end a few millimetres apart whatever the spring does, because
  // a hand that starts a frame slightly rotated hands the grip solver a
  // different elbow — that is hysteresis in the IK, not a wobble in the lag.
  let left = 0;
  for (const role of ['A', 'B']) {
    for (const b in rig.inert[role]) {
      left = Math.max(left, Math.abs(rig.inert[role][b].rx), Math.abs(rig.inert[role][b].rz));
    }
  }
  // Not zero, because he is never actually still: the hold loop keeps working
  // the position and a breath is a movement. What matters is that it is a
  // fraction of a degree rather than the six the spring is allowed, which is
  // what a spring that does not come back would sit at.
  const ok = moving > 0.012 && moving < 0.10 && left < 1.5;
  if (!ok) problems++;
  console.log(`${ok ? ' ' : '!'} soft parts lag: ${(moving * 100).toFixed(1)}cm behind the pose while ` +
    `he is moved about, and ${left.toFixed(2)}° left in the springs once he is still`);
}

/* --------------------------------------------------------- does he walk? */

// Standing, the pair drifts around the mat at over a metre a second, and until
// now the feet went with it: the whole fighter was translated, so a foot on the
// ground travelled at exactly the speed of the man. The footstep sound has been
// playing over that for two rounds of work — every forty centimetres, over a
// step that never happened.
//
// What a planted foot does is stay where it is. This walks the pair sideways
// for four seconds and watches the feet: how fast the slower one is moving at
// each instant (that is the one taking the weight) and how much of the time
// each foot is within a centimetre of where it was.
{
  const SPEED = 1.35;          // what match.js's _drift does when standing
  const STEP = 1 / 60;
  const prev = {};
  const speeds = [];
  let still = 0, frames = 0;
  rig.effort.A = rig.effort.B = 0.15;
  rig.slack.A = rig.slack.B = 0;
  rig.time = 0;
  rig.origin[0] = 0; rig.origin[2] = 0;
  rig.heldId = null;
  for (let i = 0; i < 240; i++) {
    rig.origin[0] += SPEED * STEP;
    rig.hold('STANDING', STEP);
    const now = {};
    for (const b of ['footL', 'footR']) {
      const m = rig.skel.A.world[BONE_INDEX[b]];
      now[b] = [m[12], m[13], m[14]];
    }
    if (i > 30) {
      const v = ['footL', 'footR'].map((b) =>
        Math.hypot(now[b][0] - prev[b][0], now[b][2] - prev[b][2]) / STEP);
      speeds.push(Math.min(v[0], v[1]));
      frames += 2;
      for (const s2 of v) if (s2 < 0.15) still++;
    }
    Object.assign(prev, now);
  }
  speeds.sort((a, b) => a - b);
  const median = speeds[speeds.length >> 1];
  const planted = still / frames;
  const ok = median < 0.15 && planted > 0.35;
  if (!ok) problems++;
  console.log(`${ok ? ' ' : '!'} standing, the supporting foot moves ` +
    `${median.toFixed(2)} m/s and a foot is planted ${(planted * 100).toFixed(0)}% of the time ` +
    `(the pair travels at ${SPEED})`);
}

// And the third man, who crosses the mat more than either of them.
{
  const { Referee } = await import('../src/game/referee.js');
  const ref = new Referee();
  const STEP = 1 / 60;
  const origin = [0, 0, 0];
  const prev = {};
  const speeds = [];
  let still = 0, frames = 0;
  for (let i = 0; i < 300; i++) {
    origin[0] += 0.9 * STEP;
    ref.update(STEP, 'live', false, origin, 0.7);
    const now = {};
    for (const b of ['footL', 'footR']) {
      const m = ref.skel.world[BONE_INDEX[b]];
      now[b] = [m[12], m[13], m[14]];
    }
    if (i > 60) {
      const v = ['footL', 'footR'].map((b) =>
        Math.hypot(now[b][0] - prev[b][0], now[b][2] - prev[b][2]) / STEP);
      speeds.push(Math.min(v[0], v[1]));
      frames += 2;
      for (const s2 of v) if (s2 < 0.15) still++;
    }
    Object.assign(prev, now);
  }
  speeds.sort((a, b) => a - b);
  const median = speeds[speeds.length >> 1];
  const ok = median < 0.15 && still / frames > 0.35;
  if (!ok) problems++;
  console.log(`${ok ? ' ' : '!'} the referee walks too: supporting foot ${median.toFixed(2)} m/s, ` +
    `planted ${((still / frames) * 100).toFixed(0)}% of the time`);
}

/* ------------------------------------------------------- does the hold loop? */

// A held position is most of a match, and what the rig does with it is a cycle:
// out to a variant, back, out to the next one, back. A cycle with a fixed
// period and a fixed reach is a metronome, and ten seconds of mount is long
// enough to hear it.
//
// "Sounds like a metronome" is not a number, so here is one: hold the position
// for forty seconds, watch six joints, and take the autocorrelation of what
// they do. A loop that repeats itself exactly scores 1.00 at its own period.
// Anything that varies — the reach, the time out, the time back — scores less,
// and how much less is how much of the repeat a player would notice.
{
  const WATCH = ['handL', 'handR', 'hips', 'head', 'footL', 'shinR'];
  const STEP = 0.05, SPAN = 40;
  const loopy = (id) => {
    const n = Math.round(SPAN / STEP);
    const sig = [];
    rig.heldId = null;
    rig.effort.A = rig.effort.B = 0.25;
    rig.slack.A = rig.slack.B = 0;
    rig.time = 0;
    for (let i = 0; i < n; i++) {
      rig.hold(id, STEP);
      const row = [];
      for (const role of ['A', 'B']) {
        for (const b of WATCH) {
          const m = rig.skel[role].world[BONE_INDEX[b]];
          row.push(m[12], m[13], m[14]);
        }
      }
      sig.push(row);
    }
    // Mean-removed, then correlated against itself at every lag from two
    // seconds up. The breath rides on top of all of this and is its own short
    // cycle; two seconds is past it.
    const w = sig[0].length;
    const mean = new Float64Array(w);
    for (const row of sig) for (let k = 0; k < w; k++) mean[k] += row[k] / sig.length;
    for (const row of sig) for (let k = 0; k < w; k++) row[k] -= mean[k];
    let energy = 0;
    for (const row of sig) for (let k = 0; k < w; k++) energy += row[k] * row[k];
    let peak = 0, at = 0;
    for (let lag = Math.round(2 / STEP); lag < sig.length / 2; lag++) {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i + lag < sig.length; i++) {
        for (let k = 0; k < w; k++) {
          dot += sig[i][k] * sig[i + lag][k];
          na += sig[i][k] * sig[i][k];
          nb += sig[i + lag][k] * sig[i + lag][k];
        }
      }
      const r = dot / (Math.sqrt(na * nb) || 1);
      if (r > peak) { peak = r; at = lag * STEP; }
    }
    return { peak, at, energy };
  };
  // The five the match actually lives in.
  let worstLoop = 0;
  for (const id of ['MOUNT', 'SIDE_CONTROL', 'BACK', 'CLOSED_GUARD', 'HALF_GUARD']) {
    const { peak, at } = loopy(id);
    if (peak > worstLoop) worstLoop = peak;
    console.log(`  ${id.padEnd(13)} repeats itself ${(peak * 100).toFixed(0)}% at ${at.toFixed(1)}s`);
  }
  const ok = worstLoop < 0.92;
  if (!ok) problems++;
  console.log(`${ok ? ' ' : '!'} the worst hold repeats itself ${(worstLoop * 100).toFixed(0)}%` +
    ' (a metronome is 100)');
}

/* ------------------------------------------------------------ the third man */

// The referee is not a paired pose and cannot be checked like one — there is
// nobody for him to overlap except the two people he is watching, which is
// exactly the thing worth checking. Plus the two facts that make a standing
// figure a standing figure: his feet are on the mat and his head is over them.
{
  const { Referee, REFEREE_POSES } = await import('../src/game/referee.js');
  const ref = new Referee();
  for (const name of Object.keys(REFEREE_POSES)) {
    ref.pose = ref.from = name;
    ref.blend = 1;
    ref.placed = true;
    ref.x = 0; ref.z = 0; ref.yaw = 0;
    ref.update(0.5, 'live', name === 'crouch', [0, 0, 0], 0);
    const foot = Math.min(ref.skel.world[BONE_INDEX.footL][13], ref.skel.world[BONE_INDEX.footR][13]);
    const head = ref.skel.world[BONE_INDEX.headTop][13];
    const up = head - foot;
    const ok = Math.abs(foot - 0.05) < 0.035 && up > (name === 'crouch' ? 0.9 : 1.4);
    if (!ok) problems++;
    console.log(`${ok ? ' ' : '!'} referee ${name.padEnd(7)} feet at ${(foot * 100).toFixed(0)}cm, ` +
      `${(up * 100).toFixed(0)}cm from sole to crown`);
  }
  // And where he actually stands, against the fight he is watching. He is
  // placed off the pair's own frame, so this is the same number wherever the
  // fight has drifted to.
  ref.placed = false;
  ref.update(0.5, 'live', true, [0, 0, 0], 0);
  // The pair goes back to the middle of the mat: an earlier section walks it
  // five metres sideways, and a referee measured against a fight that is not
  // there is measuring the mat.
  rig.origin[0] = 0; rig.origin[2] = 0;
  rig.effort.A = rig.effort.B = 0; rig.slack.A = rig.slack.B = 0; rig.time = 0;
  rig.applyAt('MOUNT', 'MOUNT', 1, 0.016);
  let near = 9;
  for (const role of ['A', 'B']) {
    const d = overlap.measure(rig.skel[role], ref.skel);
    if (d.deepest > 0) near = -d.deepest;
    for (const b of READ) {
      const m = rig.skel[role].world[BONE_INDEX[b]];
      for (const c of READ) {
        const n = ref.skel.world[BONE_INDEX[c]];
        near = Math.min(near, Math.hypot(m[12] - n[12], m[13] - n[13], m[14] - n[14]));
      }
    }
  }
  const clear = near > 0.5;
  if (!clear) problems++;
  console.log(`${clear ? ' ' : '!'} referee stands ${(near * 100).toFixed(0)}cm clear of the fight`);
}

console.log(problems ? `\n${problems} problem(s)` : '\nall poses clean');
process.exit(problems > 0 ? 1 : 0);

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
