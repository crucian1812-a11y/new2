// Is a pack of paired animation any use?
//
//   node bjj/tools/clip-check.mjs BJJ_WOW_Master_84clips.glb [--frames 9] [--all]
//   node bjj/tools/clip-check.mjs Animations/RootMotion/          (a folder of FBX)
//
// Paired grappling animation is the thing this project cannot buy: two bodies
// in contact, moving together. So when a pack of it arrives the question is not
// whether the clip names look right — they always do — but whether the motion
// survives the same measurements the game's own fifteen poses had to survive.
// Those are on record: worst interpenetration 8 cm in a held pose, 21 cm in the
// worst moment of a transition, nobody through the mat.
//
// This puts an imported clip through the same instruments:
//
//   floor      how far the lowest joint is below the mat
//   flat       whether a figure is a paper doll — every joint in one plane
//   crossed    a knee on the wrong side of its own hip
//   inside     the deepest interpenetration, after retargeting onto our rig,
//              measured by the same collide.js the pose solver uses
//   apart      how far the two of them are from touching at all
//   still      how far the least busy limb travels, measured against its own
//              pelvis so walking about does not count as moving
//
// A clip that passes is a gift. A clip that fails is the failure this project
// already paid for once — fifteen poses written as angles with no feedback,
// bodies up to 21 cm inside each other — and importing it would be paying twice.

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { statSync } from 'fs';
import { encodePNG } from './png.mjs';
import { Skeleton, BONES, BONE_INDEX } from '../src/render/skeleton.js';
import { Overlap } from '../src/game/collide.js';
import { rootFromHips, aimAll } from './retarget.mjs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('-'));
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? +argv[i + 1] : d; };
const FRAMES = flag('frames', 9);
const ALL = argv.includes('--all');
const DUMP = argv.includes('--dump') ? argv[argv.indexOf('--dump') + 1] : null;
if (!file) {
  console.error('usage: clip-check.mjs <pack.glb | folder of FBX> [--frames 9] [--all] [--dump out/]');
  process.exit(2);
}

// A pack is a GLB scene or a folder of per-fighter FBX. Everything below is
// the same either way: the front-end hands over the joint positions of two
// fighters at a moment, and the measurements do not care where they came from.
const front = statSync(file).isDirectory() ? './clips-fbx.mjs' : './clips-glb.mjs';
const src = (await import(front)).openPack(file);
const MAT_Y = src.matY;
const restAt = src.rest();

// Their leg against ours, so a pack authored at another scale still lands on
// this skeleton the right size.
const theirLeg = (() => {
  const hip = restAt('A', 'LeftUpLeg'), knee = restAt('A', 'LeftLeg'), foot = restAt('A', 'LeftFoot');
  if (!hip || !knee || !foot) return null;
  const d = (a, b) => Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
  return d(hip, knee) + d(knee, foot);
})();
const ourLeg = Math.abs(BONES[BONE_INDEX.shinL][2][1]) + Math.abs(BONES[BONE_INDEX.footL][2][1]);
const SCALE = theirLeg ? ourLeg / theirLeg : 1;

// Before any clip is measured: is the figure a person?
//
// This is the cheapest question in the file and the one that decides most of
// the others. A grown man's spine, hips to head, is about two thirds of his
// leg. A rig whose torso is longer than its leg cannot be retargeted onto a
// human skeleton without either the reach or the contact going wrong, and
// contact is the whole sport.
const proportions = (() => {
  const d = (a, b) => {
    const A = restAt('A', a), B = restAt('A', b);
    return A && B ? Math.hypot(A[12] - B[12], A[13] - B[13], A[14] - B[14]) : 0;
  };
  const spine = d('Hips', 'Spine') + d('Spine', 'Spine1') + d('Spine1', 'Spine2') +
    d('Spine2', 'Neck') + d('Neck', 'Head');
  const leg = d('LeftUpLeg', 'LeftLeg') + d('LeftLeg', 'LeftFoot');
  const arm = d('LeftArm', 'LeftForeArm') + d('LeftForeArm', 'LeftHand');
  const ourSpine = ['spine', 'chest', 'neck', 'head']
    .reduce((t, b) => t + Math.abs(BONES[BONE_INDEX[b]][2][1]), 0);
  return { spine, leg, arm, ratio: leg ? spine / leg : 0, ours: ourSpine / ourLeg };
})();

const JOINTS = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
];

const overlap = new Overlap();
const skel = { A: new Skeleton(), B: new Skeleton() };

// One figure, at one instant, on our skeleton.
function put(role, at) {
  const posOf = (n) => {
    const m = at(role, n);
    return m ? [m[12] * SCALE, (m[13] - MAT_Y) * SCALE, m[14] * SCALE] : null;
  };
  const sk = skel[role];
  const hips = at(role, 'Hips');
  if (!hips) return null;
  rootFromHips(sk, hips);
  sk.pose();
  const p = posOf('Hips');
  sk.rootPos[0] = p[0]; sk.rootPos[1] = p[1]; sk.rootPos[2] = p[2];
  sk.pose();
  aimAll(sk, posOf);
  sk.pose();
  return posOf;
}

// A figure whose every joint lies in one plane is not a body, it is a cardboard
// cut-out: the thinnest extent of the joint cloud, in the direction that
// extent is smallest.
function flatness(pts) {
  let c = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
  // Cheap stand-in for the smallest principal axis: the thinnest of the three
  // world axes, which for a figure lying on its back is the vertical one and is
  // exactly the direction a paper doll is flat in.
  const spread = [0, 1, 2].map((k) => {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p[k] - c[k]); hi = Math.max(hi, p[k] - c[k]); }
    return hi - lo;
  });
  return Math.min(...spread);
}

// A knee that has crossed to the other side of its own hip, measured in the
// pelvis's own frame so it holds however the fighter is turned. This is the
// error the overhead camera was added to catch: a mount with both knees on one
// side of the man underneath.
function crossed(posOf) {
  const hips = posOf('Hips');
  const l = posOf('LeftUpLeg'), r = posOf('RightUpLeg');
  if (!hips || !l || !r) return 0;
  const ax = [l[0] - r[0], l[1] - r[1], l[2] - r[2]];
  const len = Math.hypot(...ax) || 1;
  for (let k = 0; k < 3; k++) ax[k] /= len;
  let worst = 0;
  // The hip itself is not needed — the measurement is the knee's offset along
  // the hip-to-hip axis, and which side it is supposed to be on is the sign.
  for (const [knee, sign] of [[posOf('LeftLeg'), 1], [posOf('RightLeg'), -1]]) {
    if (!knee) continue;
    const d = (knee[0] - hips[0]) * ax[0] + (knee[1] - hips[1]) * ax[1] + (knee[2] - hips[2]) * ax[2];
    // Negative means the knee is on the far side of the pelvis from its own hip.
    if (d * sign < 0) worst = Math.max(worst, -d * sign);
  }
  return worst;
}

// A limb that never moves.
//
// A position is made by what the limbs do in it, and a clip whose legs hold
// their standing rest pose for its whole length is not a mount, it is a
// standing figure lowered until its feet are through the mat. Measured against
// the fighter's own pelvis, so a clip that only slides its root about counts
// as still — which is what one pack did with every ground position it shipped.
function travel(r, role, posOf, start, first) {
  const hips = posOf('Hips');
  if (!hips) return;
  for (const limb of ['LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']) {
    const p = posOf(limb);
    if (!p) continue;
    const rel = [p[0] - hips[0], p[1] - hips[1], p[2] - hips[2]];
    const key = `${role}.${limb}`;
    if (first) { start[key] = rel; start[key + '!'] = 0; continue; }
    const s0 = start[key];
    if (!s0) continue;
    const d = Math.hypot(rel[0] - s0[0], rel[1] - s0[1], rel[2] - s0[2]);
    if (d > start[key + '!']) start[key + '!'] = d;
  }
}

// How faithfully the transfer lands, before anything it produces is believed.
//
// Every number below is measured on our skeleton, not theirs, so a broken
// retarget would show up as somebody else's clip being wrong. The check is the
// obvious one: after aiming, how far is each of our joints from the joint it
// was aimed at? A few centimetres is the difference in limb lengths between
// the two rigs. Ten would mean the tool is measuring its own bug.
const fidelity = { sum: 0, n: 0, worst: 0, at: '' };
function checkTransfer(role, posOf) {
  const sk = skel[role];
  const pairs = [
    ['Head', 'head'], ['LeftHand', 'handL'], ['RightHand', 'handR'],
    ['LeftFoot', 'footL'], ['RightFoot', 'footR'], ['LeftLeg', 'shinL'], ['Spine2', 'chest'],
  ];
  for (const [theirs, ours] of pairs) {
    const a = posOf(theirs);
    if (!a) continue;
    const m = sk.world[BONE_INDEX[ours]];
    const d = Math.hypot(a[0] - m[12], a[1] - m[13], a[2] - m[14]);
    fidelity.sum += d; fidelity.n++;
    if (d > fidelity.worst) { fidelity.worst = d; fidelity.at = `${role}_${theirs}`; }
  }
}

const rows = [];
for (const clip of src.clips()) {
  const r = { name: clip.name, seconds: clip.seconds, floor: 0, flat: Infinity, cross: 0, inside: 0, apart: 0, jam: Infinity, still: Infinity, where: '' };
  // Where each limb starts, in its own pelvis's frame, so the travel below is
  // the limb moving and not the fighter walking.
  const start = {};
  for (let f = 0; f < FRAMES; f++) {
    const t = (clip.seconds * f) / Math.max(1, FRAMES - 1);
    const at = src.frame(clip.index, t);
    const pos = { A: put('A', at), B: put('B', at) };
    if (!pos.A || !pos.B) continue;
    for (const role of ['A', 'B']) {
      const pts = JOINTS.map(pos[role]).filter(Boolean);
      for (const p of pts) r.floor = Math.max(r.floor, -p[1]);
      r.flat = Math.min(r.flat, flatness(pts));
      r.cross = Math.max(r.cross, crossed(pos[role]));
      travel(r, role, pos[role], start, f === 0);
    }
    checkTransfer('A', pos.A);
    checkTransfer('B', pos.B);
    const ov = overlap.measure(skel.A, skel.B);
    if (ov.deepest > r.inside) { r.inside = ov.deepest; r.where = ov.where; }
    // How close the two skeletons come, joint to joint. Crude on purpose: it
    // needs no capsules, no radii and no retarget, so it says the same thing
    // about any rig. Two joint centres 5 cm apart are two limbs occupying the
    // same flesh; two figures whose nearest joints never come within 30 cm are
    // not grappling, they are shadow-boxing.
    let near = Infinity;
    for (const a of JOINTS.map(pos.A).filter(Boolean)) {
      for (const b of JOINTS.map(pos.B).filter(Boolean)) {
        near = Math.min(near, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    }
    r.apart = Math.max(r.apart, near);
    r.jam = Math.min(r.jam, near);
  }
  for (const k of Object.keys(start)) if (k.endsWith('!')) r.still = Math.min(r.still, start[k]);
  if (!Number.isFinite(r.still)) r.still = 0;
  rows.push(r);
}

const cm = (v) => (v * 100).toFixed(0).padStart(4);
console.log(`${src.label}  ${rows.length} clips, ${FRAMES} frames each, mat at y=${MAT_Y.toFixed(3)}, scale ${SCALE.toFixed(3)}\n`);
console.log('clip                                 secs  floor  flat  cross   jam  apart  still  inside*');
const shown = ALL ? rows : rows.slice().sort((a, b) => a.jam - b.jam).slice(0, 14);
for (const r of shown) {
  console.log(
    `${r.name.padEnd(36)}${r.seconds.toFixed(1).padStart(5)}  ${cm(r.floor)}  ${cm(r.flat)}  ${cm(r.cross)}  ` +
    `${cm(r.jam)}  ${cm(r.apart)}  ${cm(r.still)}   ${cm(r.inside)}`
  );
}
if (!ALL) console.log('\n(the fourteen most jammed; --all for every clip)');

console.log(
  `transfer onto our rig: ${(fidelity.sum / Math.max(1, fidelity.n) * 100).toFixed(1)} cm mean joint error, ` +
  `worst ${(fidelity.worst * 100).toFixed(0)} cm at ${fidelity.at}` +
  `\n  (the two rigs differ in limb length; anything under about 5 cm means the numbers below are the clip's, not the importer's)`
);

const stat = (key) => {
  const v = rows.map((r) => r[key]).sort((a, b) => a - b);
  return { med: v[v.length >> 1], worst: v[v.length - 1], best: v[0] };
};
const ins = stat('inside'), flo = stat('floor'), fla = stat('flat'), jam = stat('jam'), cro = stat('cross');
const sti = stat('still');
console.log(`
the rig itself: spine ${(proportions.spine * SCALE * 100).toFixed(0)} cm against a leg of ${(proportions.leg * SCALE * 100).toFixed(0)} cm ` +
  `— a ratio of ${proportions.ratio.toFixed(2)} where this game's skeleton, and a person, sit at ${proportions.ours.toFixed(2)}
`);
console.log(`             median  worst
floor        ${cm(flo.med)}   ${cm(flo.worst)} cm     below the mat surface
flat         ${cm(fla.med)}   ${cm(fla.best)} cm     thinnest a figure gets; a real body is never under 20
crossed      ${cm(cro.med)}   ${cm(cro.worst)} cm     a knee past the far side of its own hip
jam          ${cm(jam.med)}   ${cm(jam.best)} cm     closest two joint centres come; under 5 is one limb inside another
still        ${cm(sti.med)}   ${cm(sti.best)} cm     how far the least busy limb travels against its own hips
inside*      ${cm(ins.med)}   ${cm(ins.worst)} cm     * after transfer, so an upper bound, not a verdict
`);
// The bar is the one the game's own poses already clear, and it is measured
// with the three instruments that do not care whose rig it is.
const clean = rows.filter((r) => r.floor < 0.03 && r.flat > 0.15 && r.cross < 0.02 && r.jam > 0.05 && r.still > 0.02);
console.log(`${clean.length} of ${rows.length} clips clear what the game already demands of a still pose.`);
if (clean.length) console.log('  ' + clean.map((r) => r.name).join('\n  '));


/* ------------------------------------------------------------------ pictures */

// Stick figures, three views, straight out of the pack's own joint positions.
//
// Numbers decide, but a number cannot be argued with and a picture can be
// checked. Front, side and overhead — and overhead is the one that catches what
// nothing else does, which is why the pose tooling grew a top view in the first
// place.
if (DUMP) {
  mkdirSync(DUMP, { recursive: true });
  const BONES_DRAW = [
    ['Hips', 'Spine'], ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'], ['Neck', 'Head'],
    ['Spine2', 'LeftShoulder'], ['LeftShoulder', 'LeftArm'], ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'],
    ['Spine2', 'RightShoulder'], ['RightShoulder', 'RightArm'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
    ['Hips', 'LeftUpLeg'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'],
    ['Hips', 'RightUpLeg'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'],
  ];
  const W = 360, H = 300, PAD = 24;
  const named = argv.includes('--clip') ? [argv[argv.indexOf('--clip') + 1]] : null;
  const wanted = named
    ? named.map((n) => src.clips().find((c) => c.name === n)).filter(Boolean)
    // No clip named: the three most jammed, which are the ones worth looking at.
    : rows.slice().sort((a, b) => a.jam - b.jam).slice(0, 3)
        .map((r) => src.clips().find((c) => c.name === r.name)).filter(Boolean);

  for (const clip of wanted) {
    const at = src.frame(clip.index, clip.seconds / 2);
    const posOf = (role) => (n) => {
      const m = at(role, n);
      return m ? [m[12], m[13] - MAT_Y, m[14]] : null;
    };
    const img = new Uint8Array(W * 3 * H * 4).fill(18);
    for (let i = 3; i < img.length; i += 4) img[i] = 255;
    const px = (x, y, c) => {
      if (x < 0 || y < 0 || x >= W * 3 || y >= H) return;
      const o = (y * W * 3 + x) * 4;
      img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2];
    };
    const line = (a, b, c) => {
      const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let i = 0; i <= n; i++) {
        const x = a[0] + ((b[0] - a[0]) * i) / n, y = a[1] + ((b[1] - a[1]) * i) / n;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) px(Math.round(x) + dx, Math.round(y) + dy, c);
      }
    };
    // One scale for all three views, so the figures are comparable.
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const role of ['A', 'B']) {
      for (const [a] of BONES_DRAW) {
        const p = posOf(role)(a);
        if (!p) continue;
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      }
    }
    const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1.2);
    const s = (Math.min(W, H) - PAD * 2) / span;
    const VIEWS = [
      ['front', (p) => [p[0], p[1]]],
      ['side', (p) => [p[2], p[1]]],
      ['top', (p) => [p[0], p[2]]],
    ];
    VIEWS.forEach(([, project], vi) => {
      const ox = vi * W + W / 2, oy = H - PAD;
      const mid = [(lo[0] + hi[0]) / 2, 0, (lo[2] + hi[2]) / 2];
      const to = (p) => {
        const [u, v] = project([p[0] - mid[0], p[1], p[2] - mid[2]]);
        return [ox + u * s, vi === 2 ? H / 2 + v * s : oy - v * s];
      };
      // The mat, where the view shows it.
      if (vi < 2) line([vi * W + PAD, oy], [vi * W + W - PAD, oy], [70, 70, 78]);
      for (const [role, col] of [['A', [244, 150, 30]], ['B', [90, 170, 255]]]) {
        const get = posOf(role);
        for (const [a, b] of BONES_DRAW) {
          const pa = get(a), pb = get(b);
          if (pa && pb) line(to(pa), to(pb), col);
        }
      }
    });
    const path = join(DUMP, `${clip.name}.png`);
    writeFileSync(path, encodePNG(W * 3, H, img));
    console.log(`wrote ${path}  (front · side · overhead, at ${(clip.seconds / 2).toFixed(1)}s)`);
  }
}
