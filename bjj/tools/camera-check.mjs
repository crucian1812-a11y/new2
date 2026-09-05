// Can you see what is happening?
//
// The camera is a broadcast camera: it sits low on the ground and frames with a
// long lens, on the argument that from up high a guard pass is two white shapes.
// Nothing has ever checked what that lens actually contains. A player reported
// it plainly — "камера слишком близко подъезжает и не понятно какой приём сейчас
// происходит" — and there was no number in the project that could agree or
// disagree with him.
//
// So this plays real matches, drives the rig and the camera exactly as main.js
// does, and projects both men into the frame every sixtieth of a second:
//
//   в кадре   how much of the two bodies is inside the picture
//   заполнение how much of the frame's height the pair takes up. Under a fifth
//             is a security camera; over one is a crop.
//   срез      a joint outside the frame, and which one
//   линза     a joint closer than the near plane — a body through the lens
//   рефери    the third man between the lens and the fight. He is meant to be
//             150 degrees round from the camera's own bearing and never in
//             front of it, but he *walks* there at 1.3 m/s through a spring:
//             every time the camera cuts he has to stroll round the fight, and
//             on the way he is exactly where he must not be. He wears black,
//             so when it happens the frame is a black rectangle. Nothing in
//             this file knew he existed.
//   внутри    the eye actually inside somebody, which is not the same question:
//             the lens test projects bone origins, and a chest's skin reaches
//             21 cm from the chest bone, so the camera can be a comfortable
//             15 cm from every joint in the picture and still be standing
//             inside the man. A player sent a screenshot of back control that
//             is one solid black rectangle, and every check in this file passed
//             on it. This one asks the capsules collide.js is built from.
//
//   node bjj/tools/camera-check.mjs             20 matches
//   node bjj/tools/camera-check.mjs 40 --where  broken down by shot
//   node bjj/tools/camera-check.mjs --spread    the distribution

import { Match, Fighter, MATCH_TIME } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { PairRig } from '../src/game/rig.js';
import { Camera } from '../src/game/camera.js';
import { BONES, BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { Referee } from '../src/game/referee.js';
import { POSES } from '../src/game/poses.js';
import { m4, m4mul, m4perspective, m4lookAt } from '../src/core/m4.js';
import { seedRandom } from '../src/game/rng.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const N = +(args[0] > 0 ? args[0] : 20);
const WHERE = args.includes('--where');
const SPREAD = args.includes('--spread');
// The same capsules collide.js is built from, for measuring how near the lens
// gets to a body rather than to a bone.
const CAPS = [
  ['hips', 'spine', 0.190, 0.184], ['spine', 'chest', 0.186, 0.212],
  ['chest', 'neck', 0.212, 0.112], ['neck', 'head', 0.066, 0.078],
  ['head', 'headTop', 0.098, 0.086],
  ['armL', 'foreL', 0.085, 0.076], ['foreL', 'handL', 0.078, 0.070],
  ['armR', 'foreR', 0.085, 0.076], ['foreR', 'handR', 0.078, 0.070],
  ['thighL', 'shinL', 0.122, 0.100], ['shinL', 'footL', 0.095, 0.075],
  ['thighR', 'shinR', 0.122, 0.100], ['shinR', 'footR', 0.095, 0.075],
];
const inside = new Overlap();
const referee = new Referee();
const SEED = seedRandom(flag('seed') !== null ? Number(flag('seed')) | 0 : 20260904);
// A phone in landscape, which is the only way this game runs. The second is a
// small tablet, where the frame is squarer and the vertical is tighter still.
const ASPECT = +flag('aspect', 844 / 390);
const NEAR = 0.08;   // the renderer's own near plane

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NAMES = BONES.map((b) => b[0]);
const DT = 1 / 60;
const view = m4(), proj = m4(), vp = m4();

function play(level, s) {
  const m = new Match([new Fighter('вы'), new Fighter('соперник')], { time: MATCH_TIME });
  const a = new AI(0, level), b = new AI(1, level);
  const rig = new PairRig();
  rig.live = true;
  const cam = new Camera();
  m.start();

  for (let t = 0; t < MATCH_TIME + 1 && m.state !== 'over'; t += DT) {
    a.update(DT, m, (d) => m.input(0, d), () =>
      (m.state === 'sub' && m.sub.attacker === 0 ? m.subTap(0) : m.grip(0)));
    b.update(DT, m, (d) => m.input(1, d), () =>
      (m.state === 'sub' && m.sub.attacker === 1 ? m.subTap(1) : m.grip(1)));
    m.update(DT, [a.control, b.control]);

    rig.origin[0] = m.origin[0];
    rig.origin[2] = m.origin[2];
    rig.yaw = m.yaw;
    for (const [role, idx] of [['A', m.roleShown.indexOf('A')], ['B', m.roleShown.indexOf('B')]]) {
      const f = m.f[idx];
      const working = (m.attempt && m.attempt.by === idx)
        || (m.state === 'sub' && m.sub.attacker === idx);
      const held = m.state === 'sub' && m.sub.defender === idx;
      rig.effort[role] = clamp(
        (working ? 0.9 : 0) + (held ? 0.75 : 0) + m.intensity * 0.25 + (1 - f.stamina / 100) * 0.3, 0, 1.2);
      rig.slack[role] = clamp(1 - f.posture / 100, 0, 1);
      rig.gas[role] = clamp(1 - f.stamina / 100, 0, 1);
      rig.fight[role] = m.gripFight[idx];
    }
    const from = m.prevPosition;
    const to = m.pending || m.position;
    if (from === to && m.blend >= 1) rig.hold(to, DT);
    else rig.apply(from, to, m.blend, DT);

    // The camera, driven the way main.js drives it — the same three lines.
    const ha = rig.skel.A.world[0], hb = rig.skel.B.world[0];
    const focus = [(ha[12] + hb[12]) / 2, (ha[13] + hb[13]) / 2, (ha[14] + hb[14]) / 2];
    const mode = m.state === 'sub' ? 'sub' : POSES[m.position].ground ? 'ground' : 'stand';
    // The same three lines main.js uses, spread included.
    let spread = 0;
    for (const role of ['A', 'B']) {
      const sk = rig.skel[role];
      for (let i = 0; i < sk.world.length; i++) {
        const w = sk.world[i];
        const d = Math.hypot(w[12] - focus[0], w[13] - focus[1], w[14] - focus[2]);
        if (d > spread) spread = d;
      }
    }
    cam.update(DT, focus, mode, m.intensity, spread);

    m4perspective(proj, cam.fov, ASPECT, NEAR, 70);
    m4lookAt(view, cam.eye, cam.at, [0, 1, 0]);
    m4mul(vp, proj, view);

    // The third man, driven exactly as main.js drives him.
    referee.update(DT, m.state, POSES[m.position].ground, m.origin, cam.orbit);
    {
      const ex = cam.eye[0], ez = cam.eye[2];
      const fx = focus[0], fz = focus[2];
      const tox = fx - ex, toz = fz - ez;
      const rx = referee.x - ex, rz = referee.z - ez;
      const toLen = Math.hypot(tox, toz) || 1;
      const rLen = Math.hypot(rx, rz) || 1;
      // In front of the lens rather than beside it: nearer than the fight and
      // within a quarter of the way across the picture from the middle of it.
      const cos = (tox * rx + toz * rz) / (toLen * rLen);
      const off = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (rLen < toLen && off < (cam.fov * ASPECT) / 4) s.refIn++;
    }

    // How close the lens is to the nearest body, measured to the surface and
    // not to a joint. "Inside somebody" is the extreme of this and it turns out
    // never to happen in an AI match; the complaint a player actually makes —
    // "камера слишком близко подъезжает" — is the tail of this distribution,
    // and until now there was no number for it.
    {
      let near = 9;
      for (const role of ['A', 'B']) {
        const sk = rig.skel[role];
        for (const [a, b, r0, r1] of CAPS) {
          const p = sk.world[BONE_INDEX[a]], q = sk.world[BONE_INDEX[b]];
          const ax = p[12], ay = p[13], az = p[14];
          const ex = q[12] - ax, ey = q[13] - ay, ez = q[14] - az;
          const l2 = ex * ex + ey * ey + ez * ez;
          const u = l2 > 1e-9
            ? Math.max(0, Math.min(1, ((cam.eye[0] - ax) * ex + (cam.eye[1] - ay) * ey + (cam.eye[2] - az) * ez) / l2))
            : 0;
          const d = Math.hypot(cam.eye[0] - (ax + ex * u), cam.eye[1] - (ay + ey * u), cam.eye[2] - (az + ez * u))
            - (r0 + (r1 - r0) * u);
          if (d < near) near = d;
        }
      }
      if (near < s.nearest) { s.nearest = near; s.nearestWhere = mode + ', ' + m.position; }
      if (near < 0.35) s.tooClose++;
    }

    // Is the eye inside anybody? Same capsules the collision solver uses.
    for (const role of ['A', 'B']) {
      if (inside.contains(rig.skel[role], cam.eye).length) { s.inside++; break; }
    }

    let minX = 9, maxX = -9, minY = 9, maxY = -9, out = 0, lens = 0, n = 0;
    let headsIn = 0;
    for (const role of ['A', 'B']) {
      const sk = rig.skel[role];
      for (let i = 0; i < NAMES.length; i++) {
        const w = sk.world[i];
        const x = w[12], y = w[13], z = w[14];
        const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
        const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
        const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
        n++;
        if (cw <= NEAR) { lens++; out++; continue; }
        const nx = cx / cw, ny = cy / cw;
        if (nx < minX) minX = nx;
        if (nx > maxX) maxX = nx;
        if (ny < minY) minY = ny;
        if (ny > maxY) maxY = ny;
        if (nx < -1 || nx > 1 || ny < -1 || ny > 1) {
          out++;
          s.byBone[NAMES[i]] = (s.byBone[NAMES[i]] || 0) + 1;
        } else if (NAMES[i] === 'head') headsIn++;
      }
    }
    // Fill: how much of the frame's height the pair takes. 2 is the whole of
    // normalised device space, so this is a fraction of the picture.
    const fill = (maxY - minY) / 2;
    const wide = (maxX - minX) / 2;
    s.frames++;
    s.fill += fill;
    s.out += out / n;
    if (lens) s.lens++;
    if (out) s.cropped++;
    if (headsIn < 2) s.headOut++;
    if (fill > 1) s.tall++;
    if (fill < 0.2 && wide < 0.35) s.small++;
    s.fills.push(fill);
    const k = s.modes[mode] || (s.modes[mode] = { frames: 0, fill: 0, cropped: 0, headOut: 0, out: 0 });
    k.frames++; k.fill += fill; k.out += out / n;
    if (out) k.cropped++;
    if (headsIn < 2) k.headOut++;
    if (fill > s.worstFill) { s.worstFill = fill; s.worstAt = `${mode}, ${m.position}`; }
  }
}

const s = {
  frames: 0, fill: 0, out: 0, lens: 0, inside: 0, refIn: 0, tooClose: 0, nearest: 9, nearestWhere: '', cropped: 0, headOut: 0, tall: 0, small: 0,
  fills: [], byBone: {}, modes: {}, worstFill: 0, worstAt: '',
};
const t0 = Date.now();
for (let i = 0; i < N; i++) play(['white', 'blue', 'purple', 'black'][i % 4], s);
const ms = Date.now() - t0;
const pct = (v) => ((v / s.frames) * 100).toFixed(1);

console.log(`${N} matches, ${(s.frames / 3600).toFixed(1)} minutes at ${ASPECT.toFixed(2)}:1, ${ms}ms\n`);

if (SPREAD) {
  s.fills.sort((a, b) => a - b);
  const q = (p) => s.fills[Math.min(s.fills.length - 1, Math.floor(s.fills.length * p))];
  console.log('     how much of the frame height the pair fills:');
  for (const p of [0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
    console.log(`       ${(p * 100).toFixed(0).padStart(3)}%  ${(q(p) * 100).toFixed(0)}% of the frame`);
  }
  console.log('');
}
if (WHERE) {
  console.log('     shot      frames   fill   срезано   голова за кадром');
  for (const k in s.modes) {
    const v = s.modes[k];
    console.log(`     ${k.padEnd(9)} ${String(Math.round(v.frames / 60)).padStart(5)}s  ` +
      `${((v.fill / v.frames) * 100).toFixed(0).padStart(4)}%  ` +
      `${((v.cropped / v.frames) * 100).toFixed(0).padStart(6)}%  ` +
      `${((v.headOut / v.frames) * 100).toFixed(0).padStart(10)}%`);
  }
  const rows = Object.entries(s.byBone).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('\n     what falls out of frame: ' + rows.map(([k, v]) => `${k} ${v}`).join(', '));
  console.log('');
}

console.log(`     the pair fills ${((s.fill / s.frames) * 100).toFixed(0)}% of the frame on average, ` +
  `worst ${(s.worstFill * 100).toFixed(0)}% (${s.worstAt})`);
console.log(`     something is out of frame ${pct(s.cropped)}% of the time, ` +
  `${((s.out / s.frames) * 100).toFixed(1)}% of joints on average\n`);

console.log(`     the lens comes within ${(s.nearest * 100).toFixed(0)}cm of a body at its closest (${s.nearestWhere}),\n` +
  `     and is inside 35cm of one on ${pct(s.tooClose)}% of frames\n`);
check(s.lens === 0, 'no body ever comes through the lens', `${s.lens} frames`);
check(+pct(s.refIn) < 1, 'the referee keeps out of the shot',
  `he is in front of the lens on ${pct(s.refIn)}% of frames, ${s.refIn} of ${s.frames}`);
check(+pct(s.inside) < 0.5, 'and the camera is never standing inside one',
  `${pct(s.inside)}% of frames, ${s.inside} of ${s.frames}`);
check(pct(s.headOut) < 5, 'both heads are in the picture',
  `a head is out of frame ${pct(s.headOut)}% of the time`);
check(pct(s.tall) < 10, 'the pair fits in the frame',
  `taller than the picture on ${pct(s.tall)}% of frames`);
check(pct(s.small) < 5, 'and is not a distant smudge',
  `under a fifth of the frame on ${pct(s.small)}%`);

console.log(fail ? `\n${fail} check(s) failed` : '\nyou can see what is happening');
process.exitCode = fail ? 1 : 0;
