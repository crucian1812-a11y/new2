// Where the triangles went, against where the camera looks.
//
// Both fighters are decimated to twenty thousand triangles and the number that
// judged it was the distance from the old surface to the new one — honest about
// whether the shape survived, silent about whether the budget went anywhere
// worth spending it. It did not. Garland–Heckbert prices a collapse by the
// curvature it destroys, so a smooth, dense, curved thing is expensive to
// simplify and a flat blocky one is cheap: the scalp survives and the foot is
// flattened into a wedge. That is the right rule for a model viewer and the
// wrong one for a game with a fixed camera at three metres, where the head is
// a thumbnail and the feet are on the mat in half the positions.
//
// So this measures the two halves of the question and divides them:
//
//   share of the screen   the projected area of each part's triangles, summed
//                         over sampled frames of real matches, through the real
//                         camera — the same shots, the same orbit drift, the
//                         same push-in on intensity
//   share of the mesh     the vertices bound to that part
//
// A part whose vertex share is much larger than its screen share is carrying
// detail nobody can see. One much smaller is the part that reads as a block.
//
//   node bjj/tools/budget-check.mjs            8 matches, both fighters
//   node bjj/tools/budget-check.mjs 40         more of them

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Match, Fighter, MATCH_TIME } from '../src/game/match.js';
import { AI } from '../src/game/ai.js';
import { POSES } from '../src/game/poses.js';
import { PairRig } from '../src/game/rig.js';
import { Camera } from '../src/game/camera.js';
import { decodeFighter } from '../src/render/asset.js';
import { BONE_INDEX } from '../src/render/skeleton.js';
import { m4, m4mul, m4perspective, m4lookAt } from '../src/core/m4.js';
import { seedRandom } from '../src/game/rng.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const N = +(process.argv[2] > 0 ? process.argv[2] : 8);
const flag = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
};
seedRandom(flag('seed') !== null ? Number(flag('seed')) | 0 : (Date.now() & 0x7fffffff));

// A phone held upright, which is what the game is for. The absolute numbers
// scale with this and the shares do not, and the shares are the subject.
const W = 720, H = 1280;
// Every twentieth frame, and every third triangle of it. The camera drifts and
// the pose moves, so consecutive frames are nearly the same picture; and the
// question is a ratio between two shares, which a third of the triangles
// answers to a tenth of a percent. Both together are the difference between
// five seconds and five minutes.
const EVERY = 20;
const STRIDE = 3;

// The body, in the pieces a person would name. Every bone that carries skin is
// in exactly one of them.
const GROUPS = {
  head: ['head', 'headTop', 'neck'],
  torso: ['hips', 'spine', 'chest', 'clavL', 'clavR'],
  arms: ['armL', 'foreL', 'armR', 'foreR'],
  hands: ['handL', 'fingL', 'handLTip', 'handR', 'fingR', 'handRTip'],
  legs: ['thighL', 'shinL', 'thighR', 'shinR'],
  feet: ['footL', 'toeL', 'footR', 'toeR'],
};
const GROUP_OF = {};
for (const g of Object.keys(GROUPS)) {
  for (const b of GROUPS[g]) if (BONE_INDEX[b] !== undefined) GROUP_OF[BONE_INDEX[b]] = g;
}

function load(name) {
  const raw = readFileSync(join(root, 'assets', name));
  const m = decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  const n = m.pos.length / 3;
  const verts = {};
  for (const g of Object.keys(GROUPS)) verts[g] = 0;
  for (let v = 0; v < n; v++) {
    const g = GROUP_OF[m.bone[v * 2]];
    if (g) verts[g]++;
  }
  // The group a triangle belongs to is the group of its first vertex, the same
  // way the decimator's locks are per vertex. A triangle that straddles two is
  // rare and its area is small.
  const tri = new Uint8Array(m.count / 3);
  const gi = Object.keys(GROUPS);
  for (let t = 0; t < m.count / 3; t++) {
    const g = GROUP_OF[m.bone[m.idx[t * 3] * 2]];
    tri[t] = g ? gi.indexOf(g) + 1 : 0;
  }
  return { m, n, verts, tri, name };
}

// One skinned vertex, through the two bones the format carries.
function skin(mesh, skel, v, out) {
  const { pos, bone, wt } = mesh;
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 2; k++) {
    const w = wt[v * 2 + k];
    if (w <= 0) continue;
    const s = skel.skin.subarray(bone[v * 2 + k] * 16, bone[v * 2 + k] * 16 + 16);
    const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
    x += w * (s[0] * px + s[4] * py + s[8] * pz + s[12]);
    y += w * (s[1] * px + s[5] * py + s[9] * pz + s[13]);
    z += w * (s[2] * px + s[6] * py + s[10] * pz + s[14]);
  }
  out[0] = x; out[1] = y; out[2] = z;
}

const proj = m4(), view = m4(), viewProj = m4();
const _a = new Float64Array(3), _b = new Float64Array(3), _c = new Float64Array(3);
const _pa = new Float64Array(2), _pb = new Float64Array(2), _pc = new Float64Array(2);

function toScreen(p, out) {
  const cw = viewProj[3] * p[0] + viewProj[7] * p[1] + viewProj[11] * p[2] + viewProj[15];
  if (cw <= 0.001) return false;
  const cx = viewProj[0] * p[0] + viewProj[4] * p[1] + viewProj[8] * p[2] + viewProj[12];
  const cy = viewProj[1] * p[0] + viewProj[5] * p[1] + viewProj[9] * p[2] + viewProj[13];
  out[0] = ((cx / cw) * 0.5 + 0.5) * W;
  out[1] = ((cy / cw) * 0.5 + 0.5) * H;
  return true;
}

// The projected area of the triangles facing us, clipped to the viewport by
// dropping anything whose centre is off it. Back faces are dropped by the sign
// of the winding, so the far side of a body is not counted twice — that is what
// the depth buffer does and this is the cheapest honest stand-in for it.
function accumulate(fighter, skel, area) {
  const { m, tri } = fighter;
  const gi = Object.keys(GROUPS);
  for (let t = 0; t < m.count / 3; t += STRIDE) {
    const g = tri[t];
    if (!g) continue;
    skin(m, skel, m.idx[t * 3], _a);
    skin(m, skel, m.idx[t * 3 + 1], _b);
    skin(m, skel, m.idx[t * 3 + 2], _c);
    if (!toScreen(_a, _pa) || !toScreen(_b, _pb) || !toScreen(_c, _pc)) continue;
    const ux = _pb[0] - _pa[0], uy = _pb[1] - _pa[1];
    const vx = _pc[0] - _pa[0], vy = _pc[1] - _pa[1];
    const cross = ux * vy - uy * vx;
    if (cross <= 0) continue;                       // back facing
    const mx = (_pa[0] + _pb[0] + _pc[0]) / 3;
    const my = (_pa[1] + _pb[1] + _pc[1]) / 3;
    if (mx < 0 || mx >= W || my < 0 || my >= H) continue;
    area[gi[g - 1]] += cross * 0.5 * STRIDE;
  }
}

/* --------------------------------------------------------------------- run */

const you = load('fighter.bin');
const opp = load('fighter-b.bin');
const rig = new PairRig();
const camera = new Camera();
const area = { you: {}, opp: {} };
for (const g of Object.keys(GROUPS)) { area.you[g] = 0; area.opp[g] = 0; }
const focus = new Float64Array(3);

let frames = 0;
const t0 = Date.now();
for (const level of ['white', 'blue', 'purple', 'black']) {
  for (let i = 0; i < Math.ceil(N / 4); i++) {
    const match = new Match([new Fighter('вы'), new Fighter('соперник')], { time: MATCH_TIME });
    const a = new AI(0, level), b = new AI(1, level);
    match.start();
    rig.heldId = null;
    camera.targetOrbit = 0.7;
    camera.orbit = 0.7;
    const dt = 1 / 60;
    let f = 0;
    for (let t = 0; t < MATCH_TIME && match.state !== 'over'; t += dt) {
      a.update(dt, match, (d) => match.input(0, d), () =>
        (match.state === 'sub' && match.sub.attacker === 0 ? match.subTap(0) : match.grip(0)));
      b.update(dt, match, (d) => match.input(1, d), () =>
        (match.state === 'sub' && match.sub.attacker === 1 ? match.subTap(1) : match.grip(1)));
      match.update(dt, [a.control, b.control]);
      rig.origin[0] = match.origin[0];
      rig.origin[2] = match.origin[2];
      rig.apply(match.prevPosition, match.pending || match.position, match.blend, dt);

      const ha = rig.skel.A.world[0], hb = rig.skel.B.world[0];
      focus[0] = (ha[12] + hb[12]) / 2;
      focus[1] = (ha[13] + hb[13]) / 2;
      focus[2] = (ha[14] + hb[14]) / 2;
      const mode = match.state === 'sub' ? 'sub' : POSES[match.position].ground ? 'ground' : 'stand';
      camera.update(dt, focus, mode, match.intensity);

      if (f++ % EVERY) continue;
      m4perspective(proj, camera.fov, W / H, 0.08, 70);
      m4lookAt(view, camera.eye, camera.at, [0, 1, 0]);
      m4mul(viewProj, proj, view);
      // Which mesh each man is wearing, looked up the way main.js looks it up.
      const ia = match.roleShown.indexOf('A');
      accumulate(ia === 0 ? you : opp, rig.skel.A, ia === 0 ? area.you : area.opp);
      accumulate(ia === 0 ? opp : you, rig.skel.B, ia === 0 ? area.opp : area.you);
      frames++;
    }
  }
}
const runs = Math.ceil(N / 4) * 4;

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

console.log(`${runs} matches, ${frames} frames sampled at ${W}x${H} in ${Date.now() - t0}ms\n`);

const rows = [];
for (const [who, fighter] of [['you', you], ['opp', opp]]) {
  const totalA = Object.values(area[who]).reduce((s, x) => s + x, 0) || 1;
  const totalV = Object.values(fighter.verts).reduce((s, x) => s + x, 0) || 1;
  for (const g of Object.keys(GROUPS)) {
    const screen = area[who][g] / totalA;
    const mesh = fighter.verts[g] / totalV;
    rows.push({ who, g, screen, mesh, ratio: mesh / Math.max(screen, 1e-6), verts: fighter.verts[g] });
  }
}
rows.sort((x, y) => y.ratio - x.ratio);

{
  console.log('     who  part      verts   of mesh   of screen   mesh/screen');
  for (const r of rows) {
    console.log(`     ${r.who.padEnd(4)} ${r.g.padEnd(8)} ${String(r.verts).padStart(6)}` +
      `   ${(r.mesh * 100).toFixed(1).padStart(5)}%   ${(r.screen * 100).toFixed(1).padStart(6)}%` +
      `   ${r.ratio.toFixed(2).padStart(8)}x`);
  }
  console.log('');
}

// A hand has to close.
//
// The floor below says a hand needs enough triangles to be a hand; this says
// those triangles have to be able to move. They could not: the hand was two
// bones, the palm and a tip, and closing it rotated the tip alone — six per
// cent of the hand's vertices travelling six millimetres, while the other
// ninety-four rode the palm rigidly. Both sources ship a full finger skeleton
// and the bake folded all fifteen bones of it onto the palm.
//
// Measured by posing the pair, letting the grips run, and then wiping the curl
// the grip solve asked for and posing again: the difference is the hand
// closing and nothing else. Held against the palm's own frame, so an arm that
// moved because the IK reached differently does not count as a finger.
{
  const HAND = ['handL', 'fingL', 'handLTip', 'handR', 'fingR', 'handRTip']
    .map((b) => BONE_INDEX[b]).filter((i) => i !== undefined);
  const realSolve = rig._solveGrips.bind(rig);
  const skinTo = (mesh, skel, v, out) => skin(mesh, skel, v, out);
  const rows2 = [];
  for (const [who, fighter] of [['you', you], ['opp', opp]]) {
    const { m } = fighter;
    const verts = [];
    for (let v = 0; v < m.pos.length / 3; v++) if (HAND.includes(m.bone[v * 2])) verts.push(v);
    const grab = (curl) => {
      rig._solveGrips = curl ? realSolve
        : (list) => { realSolve(list); for (const k in rig.curl) rig.curl[k] = 0; };
      rig.effort.A = rig.effort.B = 0;
      rig.slack.A = rig.slack.B = 0;
      rig.rewind();
      rig.invalidate('MOUNT');
      rig.applyAt('MOUNT', 'MOUNT', 1, 0.016);
      const palm = rig.skel.A.world[BONE_INDEX.handL];
      const out = new Float64Array(verts.length * 3);
      const p = new Float64Array(3);
      for (let k = 0; k < verts.length; k++) {
        skinTo(m, rig.skel.A, verts[k], p);
        out[k * 3] = p[0] - palm[12];
        out[k * 3 + 1] = p[1] - palm[13];
        out[k * 3 + 2] = p[2] - palm[14];
      }
      return out;
    };
    const openHand = grab(0);
    const shut = grab(1);
    rig._solveGrips = realSolve;
    let moved = 0, worst = 0;
    for (let k = 0; k < verts.length; k++) {
      const d = Math.hypot(shut[k * 3] - openHand[k * 3],
        shut[k * 3 + 1] - openHand[k * 3 + 1], shut[k * 3 + 2] - openHand[k * 3 + 2]);
      if (d > 0.002) moved++;
      if (d > worst) worst = d;
    }
    rows2.push({ who, share: verts.length ? moved / verts.length : 0, worst });
  }
  // A third of the hand, and two and a half centimetres at the fingertips.
  //
  // The distance is smaller than it was and means something different. It used
  // to be measured from a flat hand, because a hand holding nothing was flat —
  // 8.7 degrees at the knuckles, a plank — so "closing" covered the whole
  // travel from board to fist and the fingertips moved 7.4 cm. A hand at rest
  // is a hand now, so this is the last stretch from relaxed to gripping, which
  // is the stretch a player actually sees change when a grip lands.
  const closes = rows2.every((r) => r.share > 0.33 && r.worst > 0.025);
  check(
    closes,
    'and it closes',
    rows2.map((r) => `${r.who} ${(r.share * 100).toFixed(0)}% of the hand moves, ` +
      `furthest ${(r.worst * 100).toFixed(1)}cm`).join('; ')
  );

  // And it is not flat when it is holding nothing.
  //
  // This is the one the screenshot caught and no number did: the moment the
  // fingers became separate geometry, every hand not on a grip stood open and
  // splayed, and the referee spent the match at the edge of the mat with two
  // claws. Measured at the knuckle — the angle between the palm and the finger
  // row — on the referee, who never holds anything at all and is therefore the
  // one who shows it.
  {
    const { Referee } = await import('../src/game/referee.js');
    const ref = new Referee();
    for (let i = 0; i < 60; i++) ref.update(1 / 60, 'live', true, [0, 0, 0], 0.7);
    const at = (b) => {
      const m = ref.skel.world[BONE_INDEX[b]];
      return [m[12], m[13], m[14]];
    };
    const bend = (side) => {
      const a = at('hand' + side), b = at('fing' + side), c = at('hand' + side + 'Tip');
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const ul = Math.hypot(...u), vl = Math.hypot(...v);
      return Math.acos(Math.min(1, Math.max(-1,
        (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (ul * vl)))) * 180 / Math.PI;
    };
    const l = bend('L'), r = bend('R');
    check(
      l > 12 && r > 12,
      'a hand holding nothing is still a hand',
      `the referee carries ${l.toFixed(0)} and ${r.toFixed(0)} degrees at the knuckles`
    );
  }
}

// A hand has to be a hand.
//
// This is the one place the ratio above is the wrong question, and the answer
// has to say so. By its share of the picture a hand deserves about one per cent
// of the mesh; five fingers and a thumb are fine structure that needs a floor
// of triangles to exist at all, however small it is on screen. Six hundred for
// the pair is where a hand stops reading as a mitten, and the opponent's were
// at five hundred and twenty-one before the decimator was told about them —
// nothing in the mesh is locked on a hand, so it was the cheapest thing in the
// body to spend and it got spent.
const handTris = { you: 0, opp: 0 };
for (const [who, fighter] of [['you', you], ['opp', opp]]) {
  const gi = Object.keys(GROUPS).indexOf('hands') + 1;
  for (let t = 0; t < fighter.m.count / 3; t++) if (fighter.tri[t] === gi) handTris[who]++;
}
check(
  handTris.you >= 600 && handTris.opp >= 600,
  'a hand has enough geometry to be a hand',
  `you ${handTris.you} triangles across the pair, opp ${handTris.opp}, floor 600`
);

// And nothing is hollowed out below the room it takes up. A third is the line:
// a torso is a large smooth surface and can carry fewer vertices per pixel than
// a knuckle without anybody noticing, but a part at a tenth of its share is a
// part that has been flattened into a wedge.
const thin = rows.filter((r) => r.ratio < 0.3);
check(
  thin.length === 0,
  'nothing is emptied out below its share of the screen',
  thin.map((r) => `${r.who}/${r.g} ${r.ratio.toFixed(2)}x`).join(', ') || 'worst is ' +
    `${rows[rows.length - 1].who}/${rows[rows.length - 1].g} at ${rows[rows.length - 1].ratio.toFixed(2)}x`
);

// Named, measured, and known to be off — the same second tier blend-check and
// sim-check use, because neither of these is fixable from here.
//
// The heads have now been attacked from three sides and the answer is that
// they cost what the sources cost. Weighting them down: at 0.06 it freed a
// ninth of the head and moved the surface 8 mm instead of 3, because only the
// unlocked half can move at all. Unlocking the other half: 8804 of the
// opponent's head vertices sit on an open edge — every border of every hair
// card — and letting a border slide along itself freed 581 of them, not 8804.
// That is the lesson worth keeping: **a lock says what is forbidden, not what
// would move.** The rest are permitted and expensive, because Garland-Heckbert
// prices curvature and a head is nothing but curvature.
//
// What is left is not a thinner setting. It is a head with fewer polygons in
// the FBX, which is art rather than tooling.
//
// Fighter A's feet are seventy triangles in the FBX, before anything here has
// run. There is no thinning to undo.
// Hands and feet are excluded: they are over their share of the picture because
// this file argues above that they should be, and a report that read that back
// as a finding would be quoting itself.
for (const r of rows.filter((x) => x.ratio > 2.5 && x.g !== 'hands' && x.g !== 'feet')) {
  console.log(`     ${r.who}/${r.g} is ${(r.mesh * 100).toFixed(0)}% of the mesh for ` +
    `${(r.screen * 100).toFixed(0)}% of the screen, and it is the source's shape`);
}
console.log("     fighter A's feet are 70 triangles in the FBX, before any thinning runs");

console.log(fail ? `\n${fail} check(s) failed` : '\nthe budget is where the camera is');
process.exitCode = fail ? 1 : 0;
