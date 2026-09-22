// Is this the shape of a person?
//
// A player looked at the title card and said the figure was wrong, and nothing
// in this toolbox could say whether he was right. Everything here measures what
// a body *does* — where its weight is, what it intersects, how far a joint
// folds — and nothing measures what it *is*. So a baked character can be a
// barrel with arms and every number in the battery stays green.
//
// Two rulers, both borrowed rather than invented:
//
//   сегменты   bone lengths as fractions of stature, against the table this
//              project already trusts for segment *masses* — Winter, via
//              Drillis & Contini. Shoulder height 0.818 H, hip 0.530, knee
//              0.285, and the limb lengths that follow from them.
//   ширины     the silhouette's breadth at four heights, on the baked skin and
//              on the torso alone. Arms hanging beside a body are part of the
//              silhouette and are not part of the torso, and a measure that
//              cannot tell them apart says a man is as wide as his elbows.
//
// The number the eye actually reads is the last one: **the taper**. A person
// goes from 0.259 H across the shoulders to about 0.180 at the waist, which is
// a ratio of one and a half. That ratio is what makes a figure read as an
// athlete rather than as a bag, and it is the one this found at 0.97 — a man
// wider at the waist than at the shoulders.
//
// Measured on a man standing still, in the stance below.
//
// That stance used to be the title card's: a fighter stood there and this
// measured him where he was looked at. The title card is a gallery of positions
// now (see gallery.js) and nobody stands on it any more, so the stance moved in
// here — it is the ruler's own, the way a tailor stands a man up to measure
// him, and it is the only thing in the project that uses it.
//
// The bind pose was tried instead, on the argument that it is the shape the
// asset is actually built in and the space the reshaper solves in. It is a
// different ruler and it reads differently — the taper comes out 1.60 on one
// fighter and 1.25 on the other, against 1.34 and 1.38 here — because a bind
// pose has the arms out and the spine dead straight, and a breadth across a
// straight spine is not the breadth a table of standing men is written about.
// Changing rulers mid-round would also have meant re-solving the reshape
// against the new one, which is a re-bake of both characters for no gain in
// truth.
//
//   node bjj/tools/figure-check.mjs          both fighters, the table
//   node bjj/tools/figure-check.mjs --bands  every band, not just the four
import { readFileSync } from 'node:fs';
import { Skeleton, BONE_INDEX, poseToQuats, HAND_REST, TIP_REST } from '../src/render/skeleton.js';
import { decodeFighter } from '../src/render/asset.js';
import { skinLite, skinInto } from './skin-lite.mjs';

const BANDS = process.argv.includes('--bands');

// A person, in fractions of his own height. Drillis & Contini as Winter prints
// them: the heights are from the floor, the breadths are across the body.
const MAN = {
  shoulderH: 0.818, hipH: 0.530, kneeH: 0.285, ankleH: 0.039,
  upperArm: 0.188, foreArm: 0.145, thigh: 0.245, shank: 0.246,
  // Breadths. Biacromial across the shoulders, bitrochanteric across the hips,
  // and the waist between them — the one number here that is a judgement
  // rather than a landmark, because a waist is where a body is narrowest and
  // not where a bone is.
  shoulderW: 0.259, chestW: 0.230, waistW: 0.180, hipW: 0.191,
};
// What the eye reads, and the reason this file exists.
const TAPER = MAN.shoulderW / MAN.waistW;   // 1.44

// The stance a man is measured in. Weight on his right, the free knee soft, the
// shoulder line counter to the hips — a person standing, rather than a figure
// squared up, because a squared-up figure is a mirror of itself and no standing
// human is. What it is *not* is a fighting stance: a man bent forward at the
// hips reads a chest breadth as a waist.
const STAND_STILL = {
  root: { p: [0, 0.961, 0], r: [0, 0, 0] },
  j: {
    fingL: [-HAND_REST, 0, 0], handLTip: [-TIP_REST, 0, 0],
    fingR: [-HAND_REST, 0, 0], handRTip: [-TIP_REST, 0, 0],
    hips: [-4, 5, -6],
    spine: [6, -3, 4], chest: [3, -4, 3], neck: [-5, 3, -1], head: [3, 7, 2],
    clavL: [0, 0, 8], armL: [-17, 11, -13], foreL: [-38, 0, 0], handL: [-9, 2, 0],
    clavR: [-2, 0, -6], armR: [-9, -8, 10], foreR: [-23, 0, 0], handR: [-5, -2, 0],
    thighL: [-9, 9, 7], shinL: [16, 0, 0], footL: [-7, 0, 0],
    thighR: [-3, -4, -3], shinR: [5, 0, 0], footR: [-2, 0, 0],
  },
};

// Which bones make a torso. Everything else on a standing man — the arms
// hanging beside him, the legs — is silhouette and not trunk.
const TORSO = new Set(['hips', 'spine', 'chest', 'neck', 'clavL', 'clavR'].map((b) => BONE_INDEX[b]));

const load = (name) => {
  const raw = readFileSync(new URL(`../assets/${name}`, import.meta.url));
  return decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
};

let bad = 0;
const say = (ok, name, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${text}`);
  if (!ok) bad++;
};

const rows = [];
for (const file of ['fighter.bin', 'fighter-b.bin']) {
  const mesh = load(file);
  const lite = skinLite(mesh);
  const n = lite.pos.length / 3;
  // Torso membership off the same weights the skinning uses, so what this
  // calls a trunk is what the renderer bends as one.
  const isTorso = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (TORSO.has(lite.bone[i * 4 + k] | 0)) w += lite.wt[i * 4 + k];
    isTorso[i] = w > 0.6 ? 1 : 0;
  }

  // Stood up, on the ruler's own stance.
  const sk = new Skeleton();
  poseToQuats(sk.local, STAND_STILL);
  sk.rootPos[0] = 0;
  sk.rootPos[1] = STAND_STILL.root.p[1];
  sk.rootPos[2] = 0;
  sk.pose();
  sk.finishSkin();

  const xyz = new Float64Array(n * 3);
  const who = new Uint16Array(n);
  const cnt = skinInto(lite, sk, xyz, who);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < cnt; i++) {
    const y = xyz[i * 3 + 1];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  const H = hi - lo;

  // A breadth at a height, on the trunk or on everything.
  const widthAt = (frac, trunkOnly) => {
    const y0 = lo + H * frac - 0.018, y1 = lo + H * frac + 0.018;
    let xlo = Infinity, xhi = -Infinity, k = 0;
    for (let i = 0; i < cnt; i++) {
      if (trunkOnly && !isTorso[i]) continue;
      const y = xyz[i * 3 + 1];
      if (y < y0 || y > y1) continue;
      const x = xyz[i * 3];
      if (x < xlo) xlo = x;
      if (x > xhi) xhi = x;
      k++;
    }
    return k ? (xhi - xlo) / H : null;
  };

  const p = (b) => { const m = sk.world[BONE_INDEX[b]]; return [m[12], m[13], m[14]]; };
  const seg = (a, b) => {
    const u = p(a), v = p(b);
    return Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) / H;
  };

  const w = {
    shoulder: widthAt(0.82, true), chest: widthAt(0.72, true),
    waist: widthAt(0.63, true), hip: widthAt(0.55, true),
  };
  const taper = w.shoulder / w.waist;
  rows.push({ file, H, w, taper, seg: {
    upperArm: seg('armL', 'foreL'), foreArm: seg('foreL', 'handL'),
    thigh: seg('thighL', 'shinL'), shank: seg('shinL', 'footL'),
  } });

  console.log();
  console.log(`=== ${file}   ${(H * 100).toFixed(1)} cm tall`);
  const line = (label, got, want) => {
    const off = ((got / want - 1) * 100);
    console.log(`  ${label.padEnd(10)} ${got.toFixed(3)} H   человек ${want.toFixed(3)}   ` +
      `${off > 0 ? '+' : ''}${off.toFixed(0)}%`);
  };
  line('плечи', w.shoulder, MAN.shoulderW);
  line('грудь', w.chest, MAN.chestW);
  line('талия', w.waist, MAN.waistW);
  line('таз', w.hip, MAN.hipW);
  console.log(`  ${'сужение'.padEnd(10)} ${taper.toFixed(2)}     человек ${TAPER.toFixed(2)}`);
  line('плечо', seg('armL', 'foreL'), MAN.upperArm);
  line('предплечье', seg('foreL', 'handL'), MAN.foreArm);
  line('бедро', seg('thighL', 'shinL'), MAN.thigh);
  line('голень', seg('shinL', 'footL'), MAN.shank);
  if (BANDS) {
    for (let f = 0.30; f <= 0.88; f += 0.02) {
      const t = widthAt(f, true), a = widthAt(f, false);
      if (t) console.log(`    ${(f * 100).toFixed(0)}%  trunk ${(t * H * 100).toFixed(1)}cm  all ${(a * H * 100).toFixed(1)}cm`);
    }
  }
}

console.log();
// The lines. The taper is the one worth failing on: it is what a person sees,
// it has a textbook value, and a body that does not have it is not a body of a
// different build — it is a bag.
//
// One and a quarter rather than one and a half: these are men in a thick
// cotton jacket, and a gi fills a waist in a way a vest does not. The textbook
// ratio is the target, not the line.
for (const r of rows) {
  say(r.taper >= 1.25, 'сужение',
    `${r.file}: ${r.taper.toFixed(2)} from the shoulders to the waist ` +
    `(человек ${TAPER.toFixed(2)}, line 1.25)`);
}
for (const r of rows) {
  const off = Math.abs(r.w.shoulder / MAN.shoulderW - 1);
  say(off <= 0.15, 'плечи',
    `${r.file}: ${r.w.shoulder.toFixed(3)} H across the shoulders ` +
    `(человек ${MAN.shoulderW.toFixed(3)}, line ±15%)`);
}
console.log();
console.log('a figure is judged on what it is, not on what it does');
if (bad) process.exitCode = 1;
