// Item icons.
//
// Diablo II's inventory was a big part of why the game felt like it had loot
// in it. Every base item was a painted little object — a blade with a fuller
// down the middle, a grip with the leather wrap showing, rivets around a
// shield rim — sitting in a dark grid cell. You could tell an axe from a
// sword from across the screen without reading a word.
//
// So these are illustrations, not glyphs. Each is baked once into its own
// canvas and cached, which means the drawing can afford real detail: every
// icon gets a contour, a lit side and a shadow side under the same key light
// the world uses, and a specular streak whose shape is what separates
// polished steel from oiled wood from tarnished bronze.
//
// The rarity colour is not painted over the item as a wash — that turns every
// unique into a stained silhouette. It goes into the metal's own highlight
// and into the cell behind it, so a rare longsword still reads as a
// longsword, only richer.

import { makeCanvas, ctxOf } from './textures.js';
import { css, mixc, PAL, hex } from './palette.js';
import { TAU } from '../core/math.js';

// The same lamp as the world: up and to the left.
const LIT = -0.62;

const CONTOUR = 'rgba(9,8,10,0.92)';

const cache = new Map();

// ---------------------------------------------------------------------------
// Material helpers
// ---------------------------------------------------------------------------

/** Runs a contour around whatever the last path was, then fills it. */
function inked(ctx, fill, lw = 2) {
  ctx.strokeStyle = CONTOUR;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * A steel gradient across the given axis. Steel is not a smooth ramp — it has
 * a dark body, one narrow near-white streak where the light grazes it, and a
 * sharp fall to black on the far side. That streak is the entire difference
 * between "metal" and "grey plastic".
 */
function steelFill(ctx, x0, y0, x1, y1, tint) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  // Pitched dark on purpose. Steel that runs bright-to-mid reads as chrome —
  // a clean modern icon. Diablo II's armour was mostly in shadow with one
  // small hot spot, which is what made it look like iron that had been
  // outdoors.
  const base = tint ? mixc(mixc(PAL.steel, [0, 0, 0], 0.3), tint, 0.24) : mixc(PAL.steel, [0, 0, 0], 0.3);
  g.addColorStop(0, css(mixc(PAL.steelDark, [6, 6, 9], 0.62)));
  g.addColorStop(0.3, css(mixc(PAL.steelDark, [6, 6, 9], 0.3)));
  g.addColorStop(0.48, css(base));
  g.addColorStop(0.58, css(mixc(PAL.steel, tint || [255, 255, 255], 0.22)));
  g.addColorStop(0.64, css(tint ? mixc([242, 238, 226], tint, 0.4) : [238, 240, 244]));
  g.addColorStop(0.74, css(base));
  g.addColorStop(1, css(mixc(PAL.steelDark, [6, 6, 9], 0.7)));
  return g;
}

/**
 * A tile of pitting and fine scratches, laid over every finished icon and
 * clipped to what was actually drawn. Without it the gradients are perfectly
 * smooth and the whole set reads as vector art; a hand-painted icon has dirt
 * in it. Baked once and reused by all of them.
 */
let wearTile = null;
function getWearTile() {
  if (wearTile) return wearTile;
  wearTile = makeCanvas(64, 64);
  const w = ctxOf(wearTile);
  // Pitting: a spray of dark and light specks.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 10000) / 10000;
  };
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 64;
    const y = rnd() * 64;
    const r = 0.3 + rnd() * 0.9;
    const dark = rnd() < 0.62;
    w.fillStyle = dark ? `rgba(0,0,0,${(0.1 + rnd() * 0.3).toFixed(3)})` : `rgba(255,250,238,${(0.05 + rnd() * 0.16).toFixed(3)})`;
    w.beginPath();
    w.arc(x, y, r, 0, TAU);
    w.fill();
  }
  // Scratches: short diagonal strokes, mostly along the light direction.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 64;
    const y = rnd() * 64;
    const len = 3 + rnd() * 12;
    const a = -0.9 + rnd() * 0.5;
    w.strokeStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.24)' : 'rgba(255,252,244,0.2)';
    w.lineWidth = 0.5 + rnd() * 0.6;
    w.beginPath();
    w.moveTo(x, y);
    w.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    w.stroke();
  }
  return wearTile;
}

function woodFill(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, css(mixc(PAL.wood, [0, 0, 0], 0.45)));
  g.addColorStop(0.4, css(PAL.wood));
  g.addColorStop(0.6, css(PAL.woodLight));
  g.addColorStop(1, css(mixc(PAL.wood, [0, 0, 0], 0.3)));
  return g;
}

function leatherFill(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, css(PAL.leatherDark));
  g.addColorStop(0.45, css(PAL.leather));
  g.addColorStop(0.62, css(mixc(PAL.leather, [220, 190, 150], 0.45)));
  g.addColorStop(1, css(mixc(PAL.leatherDark, [0, 0, 0], 0.4)));
  return g;
}

/** A domed rivet. Two of these on a strap sell more than any amount of shading. */
function rivet(ctx, x, y, r, tint) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = css(mixc(PAL.steelDark, [0, 0, 0], 0.3));
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * LIT * 0.4, y - r * 0.35, r * 0.55, 0, TAU);
  ctx.fillStyle = css(tint ? mixc(PAL.steelLight, tint, 0.4) : PAL.steelLight);
  ctx.fill();
}

/** A cut gem: dark body, a bright facet, and one white sparkle. */
function gem(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.8, y - r * 0.2);
  ctx.lineTo(x + r * 0.5, y + r * 0.9);
  ctx.lineTo(x - r * 0.5, y + r * 0.9);
  ctx.lineTo(x - r * 0.8, y - r * 0.2);
  ctx.closePath();
  inked(ctx, css(mixc(color, [0, 0, 0], 0.45)), 1.6);
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.8);
  ctx.lineTo(x + r * 0.5, y - r * 0.1);
  ctx.lineTo(x, y + r * 0.5);
  ctx.lineTo(x - r * 0.5, y - r * 0.1);
  ctx.closePath();
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.28, y - r * 0.3, r * 0.2, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
}

/** Leather grip binding: diagonal bands with a shadow line between each. */
function gripWrap(ctx, x, yTop, yBot, halfW) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - halfW, yTop, halfW * 2, yBot - yTop);
  ctx.clip();
  ctx.fillStyle = leatherFill(ctx, x - halfW, 0, x + halfW, 0);
  ctx.fillRect(x - halfW, yTop, halfW * 2, yBot - yTop);
  ctx.strokeStyle = 'rgba(12,9,7,0.55)';
  ctx.lineWidth = 1.1;
  for (let y = yTop - halfW * 2; y < yBot + halfW * 2; y += 3.4) {
    ctx.beginPath();
    ctx.moveTo(x - halfW - 2, y);
    ctx.lineTo(x + halfW + 2, y - halfW * 1.6);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.rect(x - halfW, yTop, halfW * 2, yBot - yTop);
  ctx.strokeStyle = CONTOUR;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// The items
// ---------------------------------------------------------------------------
//
// All drawn into a 64x64 box, upright, roughly filling it. Upright and
// centred is what makes a grid of them scan: D2's icons never tilted for
// style, they tilted only when the object itself was asymmetric.

const DRAW = {
  sword(ctx, tint) {
    // Blade: a long tapered kite with a fuller down the centre.
    ctx.beginPath();
    ctx.moveTo(32, 3);
    ctx.lineTo(38, 14);
    ctx.lineTo(37, 40);
    ctx.lineTo(27, 40);
    ctx.lineTo(26, 14);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 26, 0, 38, 0, tint), 2);
    // The fuller — a groove, so it is a dark line with a lit lip above it.
    ctx.strokeStyle = 'rgba(10,12,16,0.55)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(32, 9);
    ctx.lineTo(32, 38);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236,242,250,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30.4, 10);
    ctx.lineTo(30.4, 37);
    ctx.stroke();

    // Crossguard
    ctx.beginPath();
    ctx.moveTo(16, 41);
    ctx.lineTo(48, 41);
    ctx.lineTo(46, 46);
    ctx.lineTo(18, 46);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 0, 41, 0, 46, tint), 2);
    rivet(ctx, 21, 43.5, 1.7, tint);
    rivet(ctx, 43, 43.5, 1.7, tint);

    gripWrap(ctx, 32, 46, 57, 4);

    // Pommel
    ctx.beginPath();
    ctx.arc(32, 59, 4.6, 0, TAU);
    inked(ctx, steelFill(ctx, 28, 55, 36, 63, tint), 2);
  },

  mace(ctx, tint) {
    // A war hammer, not a ball on a stick: a flat striking face on one side
    // and a curved beak on the other. The asymmetry is the whole read — a
    // symmetric blob at icon size is indistinguishable from a torch or a pin.
    ctx.beginPath();
    ctx.rect(29, 24, 6, 34);
    inked(ctx, woodFill(ctx, 29, 0, 35, 0), 2);
    ctx.strokeStyle = 'rgba(20,14,9,0.5)';
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(30.5 + i * 1.6, 25);
      ctx.lineTo(30.5 + i * 1.6, 56);
      ctx.stroke();
    }

    // Langets: the steel straps that pin the head to the shaft.
    ctx.beginPath();
    ctx.rect(28, 24, 8, 9);
    inked(ctx, steelFill(ctx, 28, 0, 36, 0, tint), 1.5);
    rivet(ctx, 32, 29, 1.6, tint);

    // Striking head, left, with a bevelled face.
    ctx.beginPath();
    ctx.moveTo(12, 12);
    ctx.lineTo(30, 10);
    ctx.lineTo(30, 26);
    ctx.lineTo(12, 24);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 12, 10, 30, 26, tint), 2);
    ctx.beginPath();
    ctx.rect(12, 12, 4, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,11,14,0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(17, 11);
    ctx.lineTo(17, 24.5);
    ctx.stroke();

    // Beak, right, tapering to a point.
    ctx.beginPath();
    ctx.moveTo(34, 11);
    ctx.quadraticCurveTo(50, 12, 54, 22);
    ctx.quadraticCurveTo(46, 20, 34, 25);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 34, 11, 52, 25, tint), 2);

    // Top spike.
    ctx.beginPath();
    ctx.moveTo(28, 11);
    ctx.lineTo(32, 3);
    ctx.lineTo(36, 11);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 28, 3, 36, 11, tint), 1.6);

    gripWrap(ctx, 32, 36, 54, 4);
    ctx.beginPath();
    ctx.arc(32, 58, 3.6, 0, TAU);
    inked(ctx, steelFill(ctx, 28, 54, 36, 62, tint), 1.8);
  },

  bow(ctx, tint) {
    // Limbs: two arcs meeting at a thicker riser, so it recurves.
    ctx.strokeStyle = CONTOUR;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(24, 6);
    ctx.quadraticCurveTo(46, 20, 40, 32);
    ctx.quadraticCurveTo(46, 44, 24, 58);
    ctx.stroke();
    ctx.strokeStyle = woodFill(ctx, 22, 0, 44, 0);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(24, 6);
    ctx.quadraticCurveTo(46, 20, 40, 32);
    ctx.quadraticCurveTo(46, 44, 24, 58);
    ctx.stroke();
    // Grain along the belly of the limb.
    ctx.strokeStyle = 'rgba(226,200,160,0.28)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(25, 8);
    ctx.quadraticCurveTo(44, 20, 38.5, 32);
    ctx.quadraticCurveTo(44, 44, 25, 56);
    ctx.stroke();
    // String
    ctx.strokeStyle = 'rgba(228,222,202,0.85)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(24, 6);
    ctx.lineTo(24, 58);
    ctx.stroke();
    // Grip wrap and arrow rest
    ctx.save();
    ctx.translate(40, 32);
    gripWrap(ctx, 0, -8, 8, 3.4);
    ctx.restore();
    if (tint) {
      ctx.beginPath();
      ctx.arc(24, 6, 2.2, 0, TAU);
      ctx.fillStyle = css(tint);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(24, 58, 2.2, 0, TAU);
      ctx.fill();
    }
  },

  staff(ctx, tint) {
    ctx.beginPath();
    ctx.rect(29, 18, 6, 44);
    inked(ctx, woodFill(ctx, 29, 0, 35, 0), 2);
    // Knots in the wood.
    ctx.fillStyle = 'rgba(24,16,10,0.5)';
    for (const y of [28, 41, 53]) {
      ctx.beginPath();
      ctx.ellipse(32, y, 2.2, 1.2, 0, 0, TAU);
      ctx.fill();
    }
    // Claw prongs holding the stone.
    ctx.strokeStyle = CONTOUR;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(26, 22);
    ctx.quadraticCurveTo(24, 14, 28, 10);
    ctx.moveTo(38, 22);
    ctx.quadraticCurveTo(40, 14, 36, 10);
    ctx.stroke();
    ctx.strokeStyle = steelFill(ctx, 24, 0, 40, 0, tint);
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(26, 22);
    ctx.quadraticCurveTo(24, 14, 28, 10);
    ctx.moveTo(38, 22);
    ctx.quadraticCurveTo(40, 14, 36, 10);
    ctx.stroke();
    gem(ctx, 32, 12, 8, tint ? mixc(PAL.amber, tint, 0.5) : PAL.amber);
    gripWrap(ctx, 32, 34, 46, 4);
  },

  shield(ctx, tint) {
    // Heater shield: square shoulders falling to a point.
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(12, 8);
      ctx.lineTo(52, 8);
      ctx.quadraticCurveTo(52, 42, 32, 60);
      ctx.quadraticCurveTo(12, 42, 12, 8);
      ctx.closePath();
    };
    path();
    inked(ctx, steelFill(ctx, 12, 8, 52, 50, tint), 2.2);
    // The face is curved, so the left third is lit and the right falls off.
    ctx.save();
    path();
    ctx.clip();
    const cg = ctx.createLinearGradient(12, 0, 52, 0);
    cg.addColorStop(0, 'rgba(255,255,255,0.16)');
    cg.addColorStop(0.3, 'rgba(255,255,255,0.04)');
    cg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, 64, 64);
    // Order cross
    ctx.fillStyle = 'rgba(18,17,20,0.88)';
    ctx.fillRect(28, 14, 8, 32);
    ctx.fillRect(18, 22, 28, 8);
    ctx.restore();
    // Rim band with rivets
    ctx.save();
    path();
    ctx.clip();
    ctx.strokeStyle = css(mixc(PAL.steelDark, tint || [0, 0, 0], 0.3));
    ctx.lineWidth = 5;
    path();
    ctx.stroke();
    ctx.restore();
    for (const [rx, ry] of [[16, 12], [48, 12], [16, 30], [48, 30], [32, 55]]) {
      rivet(ctx, rx, ry, 2, tint);
    }
    // Boss
    ctx.beginPath();
    ctx.arc(32, 26, 5.4, 0, TAU);
    inked(ctx, steelFill(ctx, 27, 21, 37, 31, tint), 1.8);
  },

  book(ctx, tint) {
    // Cover
    ctx.beginPath();
    ctx.rect(14, 8, 34, 48);
    inked(ctx, leatherFill(ctx, 14, 0, 48, 0), 2);
    // Page block down the right edge, drawn as stacked lines.
    ctx.beginPath();
    ctx.rect(44, 11, 6, 42);
    inked(ctx, css(PAL.bone), 1.4);
    ctx.strokeStyle = 'rgba(90,82,64,0.6)';
    ctx.lineWidth = 0.8;
    for (let y = 13; y < 53; y += 2.6) {
      ctx.beginPath();
      ctx.moveTo(44.5, y);
      ctx.lineTo(49.5, y);
      ctx.stroke();
    }
    // Spine bands
    ctx.fillStyle = 'rgba(14,10,7,0.55)';
    for (const y of [18, 32, 46]) ctx.fillRect(14, y, 34, 3);
    // Clasp
    ctx.beginPath();
    ctx.rect(40, 26, 10, 8);
    inked(ctx, steelFill(ctx, 0, 26, 0, 34, tint), 1.6);
    rivet(ctx, 45, 30, 1.8, tint);
    gem(ctx, 28, 30, 7, tint ? mixc(PAL.amber, tint, 0.55) : PAL.amber);
  },

  helm(ctx, tint) {
    // Great helm: a drum with a domed crown and a flat-ish face.
    ctx.beginPath();
    ctx.moveTo(15, 24);
    ctx.quadraticCurveTo(15, 6, 32, 6);
    ctx.quadraticCurveTo(49, 6, 49, 24);
    ctx.lineTo(47, 52);
    ctx.quadraticCurveTo(32, 60, 17, 52);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 15, 6, 49, 40, tint), 2.2);
    // Eye slits — the single most recognisable thing about a great helm.
    ctx.fillStyle = 'rgba(6,6,9,0.95)';
    ctx.fillRect(19, 27, 12, 5);
    ctx.fillRect(33, 27, 12, 5);
    // Breath holes
    ctx.fillStyle = 'rgba(8,8,11,0.7)';
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.beginPath();
        ctx.arc(25 + i * 5, 40 + j * 5, 1.2, 0, TAU);
        ctx.fill();
      }
    }
    // Reinforcing cross
    ctx.fillStyle = 'rgba(20,22,28,0.5)';
    ctx.fillRect(30, 8, 4, 44);
    ctx.fillRect(17, 21, 30, 3.5);
    rivet(ctx, 32, 12, 2, tint);
    rivet(ctx, 20, 48, 1.8, tint);
    rivet(ctx, 44, 48, 1.8, tint);
    // Crown highlight
    ctx.beginPath();
    ctx.ellipse(26, 15, 6, 8, -0.4, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
  },

  chest(ctx, tint) {
    // A breastplate reads as body armour only if it has a body's proportions:
    // a neck notch cut out of the top, arm holes bitten out of the sides, a
    // chest wider than the waist, and a skirt hanging below. The previous
    // version had a straight silhouette with two round caps and came out
    // looking like a lampshade.
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(26, 11); // left of the neck
      ctx.quadraticCurveTo(20, 12, 16, 20); // over the shoulder
      ctx.quadraticCurveTo(13, 30, 19, 34); // down and under the arm hole
      ctx.lineTo(22, 44); // in to the waist
      ctx.lineTo(42, 44);
      ctx.lineTo(45, 34);
      ctx.quadraticCurveTo(51, 30, 48, 20);
      ctx.quadraticCurveTo(44, 12, 38, 11);
      ctx.quadraticCurveTo(32, 15, 26, 11); // the neck notch
      ctx.closePath();
    };
    body();
    inked(ctx, steelFill(ctx, 15, 12, 49, 44, tint), 2.2);

    // Pectoral swell: two soft highlights either side of the sternum, which
    // is what makes the plate look pressed over a chest rather than flat.
    ctx.save();
    body();
    ctx.clip();
    for (const [cx, a] of [[25, 0.3], [39, 0.12]]) {
      const rg = ctx.createRadialGradient(cx, 24, 1, cx, 26, 13);
      rg.addColorStop(0, `rgba(255,255,255,${a})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(14, 10, 36, 36);
    }
    // Arm-hole shadows, bitten out of each side.
    ctx.fillStyle = 'rgba(6,6,9,0.5)';
    ctx.beginPath();
    ctx.ellipse(16, 24, 4, 9, 0.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(48, 24, 4, 9, -0.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Sternum ridge
    ctx.strokeStyle = 'rgba(10,11,14,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(32, 16);
    ctx.lineTo(32, 43);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236,242,250,0.4)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(30.6, 17);
    ctx.lineTo(30.6, 42);
    ctx.stroke();

    // Neck rim: a rolled edge catching the light.
    ctx.strokeStyle = css(mixc(PAL.steelLight, tint || [255, 255, 255], 0.3));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(26, 11.5);
    ctx.quadraticCurveTo(32, 15.5, 38, 11.5);
    ctx.stroke();

    // Fauld: two bands hanging off the waist, each narrower than the last.
    for (let i = 0; i < 2; i++) {
      const y = 44 + i * 7;
      ctx.beginPath();
      ctx.moveTo(22 + i * 2, y);
      ctx.lineTo(42 - i * 2, y);
      ctx.lineTo(40 - i * 2, y + 7);
      ctx.lineTo(24 + i * 2, y + 7);
      ctx.closePath();
      inked(ctx, steelFill(ctx, 0, y, 0, y + 7, tint), 1.6);
    }
    rivet(ctx, 21, 21, 1.8, tint);
    rivet(ctx, 43, 21, 1.8, tint);
  },

  glove(ctx, tint) {
    // The first attempt drew the finger lames as a grid of separate bricks
    // and came out as a waffle. Fingers have to be one continuous mass with
    // grooves cut into it — the silhouette of a hand is what the eye is
    // matching against, not the plating.
    const hand = () => {
      ctx.beginPath();
      ctx.moveTo(19, 44);
      ctx.lineTo(19, 20);
      ctx.quadraticCurveTo(19, 9, 25, 9); // fingertips, rounded over
      ctx.lineTo(41, 9);
      ctx.quadraticCurveTo(47, 9, 47, 20);
      ctx.lineTo(47, 44);
      ctx.closePath();
    };
    hand();
    inked(ctx, steelFill(ctx, 19, 10, 47, 44, tint), 2.2);

    // Three grooves splitting the mass into four fingers, plus a knuckle
    // line across them — deep shadow with a lit lip on the light side.
    ctx.save();
    hand();
    ctx.clip();
    for (let f = 1; f < 4; f++) {
      const x = 19 + f * 7;
      ctx.strokeStyle = 'rgba(8,8,11,0.72)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, 30);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(230,238,248,0.32)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x - 1.3, 11);
      ctx.lineTo(x - 1.3, 29);
      ctx.stroke();
    }
    for (const y of [17, 24]) {
      ctx.strokeStyle = 'rgba(8,8,11,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(19, y);
      ctx.lineTo(47, y);
      ctx.stroke();
    }
    // Knuckle domes across the top of the metacarpal plate.
    ctx.restore();
    for (let f = 0; f < 4; f++) rivet(ctx, 22.5 + f * 7, 32, 2, tint);

    // Thumb, angled off the left side — the detail that fixes handedness.
    ctx.beginPath();
    ctx.moveTo(19, 30);
    ctx.quadraticCurveTo(10, 32, 9, 40);
    ctx.quadraticCurveTo(9, 45, 15, 44);
    ctx.lineTo(19, 40);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 9, 30, 19, 44, tint), 1.8);

    // Flared cuff
    ctx.beginPath();
    ctx.moveTo(17, 44);
    ctx.lineTo(49, 44);
    ctx.lineTo(52, 58);
    ctx.lineTo(14, 58);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 14, 44, 52, 58, tint), 2);
    ctx.strokeStyle = 'rgba(10,11,14,0.45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(15.5, 51);
    ctx.lineTo(50.5, 51);
    ctx.stroke();
    rivet(ctx, 22, 54, 1.8, tint);
    rivet(ctx, 42, 54, 1.8, tint);
  },

  boot(ctx, tint) {
    // Sabaton in profile, toe to the right. The previous version had a shin
    // and a foot of nearly the same width, which read as a trapezoid. A boot
    // needs the L: a narrow leg, a definite ankle, and a foot that juts well
    // past it — plus a dark sole running the whole length underneath.
    ctx.beginPath();
    ctx.moveTo(20, 10);
    ctx.lineTo(36, 10);
    ctx.lineTo(35, 32); // taper in towards the ankle
    ctx.lineTo(22, 32);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 20, 10, 36, 32, tint), 2);

    // Foot: heel behind the leg, instep rising, long pointed toe.
    ctx.beginPath();
    ctx.moveTo(17, 34);
    ctx.lineTo(36, 34);
    ctx.quadraticCurveTo(48, 38, 55, 48); // the instep out to the toe
    ctx.lineTo(55, 53);
    ctx.lineTo(15, 53);
    ctx.quadraticCurveTo(13, 42, 17, 34); // back of the heel
    ctx.closePath();
    inked(ctx, steelFill(ctx, 15, 34, 55, 53, tint), 2.2);

    // Instep lames, fanning towards the toe the way the real plates do.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(17, 34);
    ctx.lineTo(36, 34);
    ctx.quadraticCurveTo(48, 38, 55, 48);
    ctx.lineTo(55, 53);
    ctx.lineTo(15, 53);
    ctx.closePath();
    ctx.clip();
    for (let i = 0; i < 4; i++) {
      const x = 33 + i * 6;
      ctx.strokeStyle = 'rgba(8,8,11,0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, 34 + i * 3.4);
      ctx.lineTo(x - 3, 53);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(228,236,246,0.28)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x - 1.5, 35 + i * 3.4);
      ctx.lineTo(x - 4.5, 53);
      ctx.stroke();
    }
    ctx.restore();

    // Sole
    ctx.beginPath();
    ctx.moveTo(14, 53);
    ctx.lineTo(56, 53);
    ctx.lineTo(55, 58);
    ctx.lineTo(15, 58);
    ctx.closePath();
    inked(ctx, leatherFill(ctx, 0, 53, 0, 58), 1.8);

    // Cuff roll at the top of the greave
    ctx.beginPath();
    ctx.rect(18, 7, 20, 6);
    inked(ctx, leatherFill(ctx, 18, 0, 38, 0), 1.6);
    rivet(ctx, 24, 22, 1.8, tint);
    rivet(ctx, 32, 22, 1.8, tint);
    rivet(ctx, 20, 46, 1.8, tint);
  },

  ring(ctx, tint) {
    // Drawn as an ellipse seen at an angle, with the band's inner wall visible
    // — a flat circle reads as a washer.
    ctx.beginPath();
    ctx.ellipse(32, 36, 15, 18, 0, 0, TAU);
    ctx.strokeStyle = CONTOUR;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = steelFill(ctx, 17, 20, 47, 52, tint || PAL.gold);
    ctx.lineWidth = 6;
    ctx.stroke();
    // Inner shadow so the hole has depth.
    ctx.beginPath();
    ctx.ellipse(32, 36, 11, 14, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(8,7,6,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Highlight on the upper-left of the band only.
    ctx.beginPath();
    ctx.ellipse(32, 36, 15, 18, 0, Math.PI * 0.95, Math.PI * 1.5);
    ctx.strokeStyle = 'rgba(255,248,224,0.6)';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    gem(ctx, 32, 16, 8, tint || PAL.amber);
  },

  amulet(ctx, tint) {
    // Chain
    ctx.strokeStyle = CONTOUR;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(16, 8);
    ctx.quadraticCurveTo(32, 30, 48, 8);
    ctx.stroke();
    ctx.strokeStyle = css(mixc(PAL.gold, tint || PAL.gold, 0.5));
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(16, 8);
    ctx.quadraticCurveTo(32, 30, 48, 8);
    ctx.stroke();
    // Individual links, so it is a chain and not a wire.
    ctx.fillStyle = css(mixc(PAL.gold, [255, 240, 200], 0.4));
    for (let t = 0.08; t < 0.95; t += 0.11) {
      const x = (1 - t) * (1 - t) * 16 + 2 * (1 - t) * t * 32 + t * t * 48;
      const y = (1 - t) * (1 - t) * 8 + 2 * (1 - t) * t * 30 + t * t * 8;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, TAU);
      ctx.fill();
    }
    // Setting
    ctx.beginPath();
    ctx.moveTo(24, 26);
    ctx.lineTo(40, 26);
    ctx.lineTo(44, 44);
    ctx.lineTo(32, 58);
    ctx.lineTo(20, 44);
    ctx.closePath();
    inked(ctx, steelFill(ctx, 20, 26, 44, 58, tint || PAL.gold), 2);
    gem(ctx, 32, 40, 10, tint ? mixc(PAL.amber, tint, 0.55) : PAL.amber);
  },
};

// ---------------------------------------------------------------------------
// Baking
// ---------------------------------------------------------------------------

/**
 * The rarity tint that goes into the metal. Common items get none at all —
 * plain steel is the baseline the others are read against, and tinting
 * everything would leave nothing to compare.
 */
function tintFor(rarity) {
  switch (rarity) {
    case 'magic':
      return hex('#7f9dff');
    case 'rare':
      return hex('#f2d24a');
    case 'unique':
      return hex('#c8863a');
    case 'set':
      return hex('#4ad46a');
    default:
      return null;
  }
}

/**
 * Returns a cached 64x64 canvas for an icon/rarity pair. There are eleven
 * icons and five rarities, so the cache tops out at fifty-five little
 * canvases — cheap enough to hold forever, and it means a bag full of loot
 * costs eleven blits rather than eleven hundred path operations.
 */
export function getItemIcon(icon, rarity = 'common') {
  const key = icon + ':' + rarity;
  let c = cache.get(key);
  if (c) return c;
  c = makeCanvas(64, 64);
  const ctx = ctxOf(c);
  const fn = DRAW[icon] || DRAW.sword;
  ctx.save();
  fn(ctx, tintFor(rarity));
  ctx.restore();

  // Wear and a floor shadow, both clipped to the item itself so nothing
  // leaks into the empty corners of the cell.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = 0.55;
  ctx.drawImage(getWearTile(), 0, 0);
  // A last gradient down the whole icon: everything is a little darker at the
  // bottom, which sits the object in the cell instead of floating it.
  ctx.globalAlpha = 1;
  const sh = ctx.createLinearGradient(0, 20, 0, 64);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(4,4,7,0.42)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, 64, 64);
  ctx.restore();

  cache.set(key, c);
  return c;
}

/** Draws a baked icon centred on (x, y) at the given box size. */
export function drawItemIcon(ctx, item, x, y, size) {
  const c = getItemIcon(item.icon, item.rarity);
  ctx.drawImage(c, x - size / 2, y - size / 2, size, size);
}
