// Are the club's marks actually going to read?
//
//   node bjj/tools/mark-check.mjs [--dump out/]
//
// A crest is the one thing in this project that cannot be checked by looking at
// the game, because by the time it is in the game it is nine pixels tall on a
// phone and every failure looks the same: a smudge. So it is measured here, in
// four passes that each catch a different way of being wrong.
//
//   the alphabet  — a letter that has no glyph, or two letters with the same one
//   the atlas     — ink that is too thin to survive a mipmap, cells that bleed
//   the mat       — a crest that crosses the boundary line or leaves the mat
//   the kimono    — a patch that has drifted onto skin, a collar, or thin air
//
// --dump also writes the atlas and a plan of the mat, because no number says
// whether the helmet looks like a helmet.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GLYPHS, glyph } from '../src/render/glyphs.js';
import { markAtlas, cellRect, CELLS, SCORE_GLYPHS, scoreCellRects, scoreAdvances, PAL, MAT_MARKS, ARENA_MARKS, MARK_TEXT, fitPatches } from '../src/render/marks.js';
import { ARENA_AREA, ARENA_HALF } from '../src/render/arena.js';
import { decodeFighter } from '../src/render/asset.js';
import { atlasToPNG, encodePNG } from './png.mjs';

const args = process.argv.slice(2);
const dump = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null;

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/* ------------------------------------------------------------- the alphabet */

// Rasterise a glyph on its own, with an implementation deliberately unlike the
// one in marks.js: a checker that shares the code it checks agrees with itself
// for free.
function glyphMask(ch, N = 40) {
  const [adv, strokes] = glyph(ch);
  const mask = new Uint8Array(N * N);
  const sx = N / Math.max(adv, 0.5), sy = N / 1.5;
  for (const line of strokes) {
    const p = line.map(([x, y]) => [x * sx, N - (y + 0.25) * sy]);
    for (let i = 0; i < Math.max(1, p.length - 1); i++) {
      const a = p[i], b = p[i + 1] || p[i];
      const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
      for (let k = 0; k <= steps; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / steps, y = a[1] + ((b[1] - a[1]) * k) / steps;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ix = Math.round(x) + dx, iy = Math.round(y) + dy;
          if (ix >= 0 && ix < N && iy >= 0 && iy < N) mask[iy * N + ix] = 1;
        }
      }
    }
  }
  return mask;
}

const used = new Set([...Object.values(MARK_TEXT).join('')]);
const missing = [...used].filter((c) => !GLYPHS[c] && !GLYPHS[c.toUpperCase()]);
check(missing.length === 0, 'every letter on every mark has a glyph',
  missing.length ? `missing ${missing.join(' ')}` : `${used.size} distinct characters`);

{
  let out = 0;
  for (const ch of Object.keys(GLYPHS)) {
    const [adv, strokes] = GLYPHS[ch];
    for (const line of strokes) for (const [x, y] of line) {
      if (x < -0.06 || x > adv + 0.06 || y < -0.32 || y > 1.12) out++;
    }
  }
  check(out === 0, 'no glyph leaves its own box', `${out} stray points`);
}

{
  // Two glyphs that rasterise the same are a typo in the font — К drawn as X,
  // И drawn as N — and the crest would carry it silently.
  const keys = Object.keys(GLYPHS).filter((c) => c !== ' ');
  const masks = new Map(keys.map((c) => [c, glyphMask(c)]));
  const twins = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (GLYPHS[keys[i]] === GLYPHS[keys[j]]) continue;   // deliberate aliases
      const a = masks.get(keys[i]), b = masks.get(keys[j]);
      let diff = 0, ink = 0;
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) diff++;
        if (a[k] || b[k]) ink++;
      }
      if (diff / Math.max(1, ink) < 0.12) twins.push(`${keys[i]}/${keys[j]}`);
    }
  }
  check(twins.length === 0, 'no two letters draw the same shape', twins.join(' ') || `${keys.length} checked`);
}

/* ----------------------------------------------------------------- the atlas */

const atlas = markAtlas();
const A = atlas.size;
{
  const again = markAtlas();
  let same = again.data.length === atlas.data.length;
  for (let i = 0; same && i < atlas.data.length; i++) same = again.data[i] === atlas.data[i];
  check(same, 'the atlas builds identically twice', `${A}×${A}`);
}

// The atlas is stored GL-side up; the cell table is top-down. Read it back the
// way the shader will, so a flip that got lost shows up here and not on the mat.
function cellPixels(name) {
  const [ru, rv, rw, rh] = cellRect(name);
  const w = Math.round(rw * A), h = Math.round(rh * A);
  const x0 = Math.round(ru * A), y0 = Math.round(rv * A);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * A + x0 + x) * 4;
      const d = ((h - 1 - y) * w + x) * 4;   // back to top-down
      for (let k = 0; k < 4; k++) out[d + k] = atlas.data[s + k];
    }
  }
  return { w, h, px: out };
}

function erode(mask, w, h, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ix = x + dx, iy = y + dy;
          if (ix < 0 || iy < 0 || ix >= w || iy >= h || !mask[iy * w + ix]) { keep = 0; break; }
        }
      }
      out[y * w + x] = keep;
    }
  }
  return out;
}

const palette = Object.values(PAL);
let rimTotal = 0, rimSoftTotal = 0;
for (const name of Object.keys(CELLS)) {
  const { w, h, px } = cellPixels(name);
  const mask = new Uint8Array(w * h);
  let ink = 0, border = 0;
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] / 255;
    if (a > 0.5) { mask[i] = 1; ink++; }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) border += px[(y * w + x) * 4 + 3] > 4 ? 1 : 0;
  }
  const eroded = erode(mask, w, h, 1);
  const thick = eroded.reduce((a, b) => a + b, 0);
  const cover = ink / (w * h);
  check(cover > 0.05 && cover < 0.96, `${name}: the cell carries a mark`, `${(cover * 100).toFixed(1)}% ink`);
  // Antialiasing has to be measured on the edges and nowhere else. A patch is
  // a solid rectangle with a thin rim, and asking what fraction of all its ink
  // is partial answers a question about its area, not about its edges.
  let rim = 0, rimSoft = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || eroded[i]) continue;
    rim++;
    if (px[i * 4 + 3] < 250) rimSoft++;
  }
  // A straight edge that happens to fall on a texel boundary is exactly opaque
  // and that is correct, so the per-cell bar is only that antialiasing happens
  // at all; whether curves are actually smooth is asked of the atlas as a whole
  // below, where the roundels dominate.
  check(rim > 0 && rimSoft > 0, `${name}: the edges are resolved, not stepped`,
    `${((rimSoft / Math.max(1, rim)) * 100).toFixed(0)}% of the outline is partial`);
  rimTotal += rim; rimSoftTotal += rimSoft;
  // Mip level two averages four texels together. Ink that does not survive an
  // erosion of one is ink that will not survive being walked away from.
  check(thick / Math.max(1, ink) > 0.45, `${name}: nothing is drawn as a hairline`,
    `${((thick / Math.max(1, ink)) * 100).toFixed(0)}% of ink is 3+ texels thick`);
  // A cell whose artwork touches its edge bleeds into its neighbour as soon as
  // the sampler picks a mipmap.
  check(border === 0, `${name}: the cell has a clear border`, `${border} texels at the edge`);

  // Colour. Every solid area should be one of the club's colours; a fifth
  // colour in the top of the histogram means something was authored by hand.
  const hist = new Map();
  const key = (i) => {
    const a = px[i * 4 + 3] / 255;
    return a < 0.985 ? null : [0, 1, 2].map((k) => Math.round((px[i * 4 + k] / a / 255) * 16)).join(',');
  };
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const k = key(i);
      // Only the inside of a solid counts. The one-texel ramp where ink meets
      // bone is opaque and is neither colour, and counting it would report the
      // club's palette as a gradient.
      if (!k || [i - 1, i + 1, i - w, i + w].some((j) => key(j) !== k)) continue;
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  const top = [...hist].sort((p, q) => q[1] - p[1]).slice(0, 6);
  const strays = top.filter(([key]) => {
    const c = key.split(',').map((v) => (+v) / 16);
    return !palette.some((p) => Math.max(...p.map((v, k) => Math.abs(v - c[k]))) < 0.07);
  });
  check(strays.length === 0, `${name}: only club colours in the solids`,
    strays.length ? strays.map(([k, n]) => `${k}×${n}`).join(' ') : `${top.length} solid tones`);
}

check(rimSoftTotal / Math.max(1, rimTotal) > 0.3, 'curved edges across the atlas are smooth',
  `${((rimSoftTotal / Math.max(1, rimTotal)) * 100).toFixed(0)}% of all outlines are partial`);

/* ---------------------------------------------------------- the scoreboard */

// The jumbotron's type (Г2). The shader maps a digit's value to its index in
// SCORE_GLYPHS, so the strip has to be the digits in order; then each cell is
// read back off the atlas the way the shader reads it and asked whether it is
// the glyph it claims to be — against an independent rasterisation, so a cell
// that drew the wrong digit is caught here rather than on the board.
{
  check(SCORE_GLYPHS === '0123456789:', 'the scoreboard strip is the digits in order',
    `"${SCORE_GLYPHS}"`);

  // The board lays the line out in fixed cells — the widest digit's advance —
  // so a tick changes one cell and never re-centres its neighbours. If a digit
  // ever got wider than the cell, it would bleed into the next one.
  {
    const adv = scoreAdvances();               // the colon is the last entry
    const widest = Math.max(...adv.slice(0, 10));
    check(ARENA_MARKS.score.cell >= widest, 'the scoreboard cell fits every digit',
      `cell ${ARENA_MARKS.score.cell} ≥ widest ${widest}`);
    check(ARENA_MARKS.score.colon >= adv[10], 'the colon keeps its own narrower cell',
      `colon ${ARENA_MARKS.score.colon} ≥ ${adv[10]}`);
  }

  // Read one score cell back, top-down, exactly as the shader will see it.
  const readCell = (rect) => {
    const [ru, rv, rw, rh] = rect;
    const w = Math.round(rw * A), h = Math.round(rh * A);
    const x0 = Math.round(ru * A), y0 = Math.round(rv * A);
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((y0 + y) * A + x0 + x) * 4;
        const d = ((h - 1 - y) * w + x) * 4;
        for (let k = 0; k < 4; k++) px[d + k] = atlas.data[s + k];
      }
    }
    return { w, h, px };
  };
  // Binarise to a mask and crop to the ink's own bounding box, then scale to a
  // fixed grid — the cell and the reference are drawn at different stroke
  // weights and sizes, and the shape is the part that has to agree.
  const shape = (mask, w, h, N = 24) => {
    let x0 = w, x1 = 0, y0 = h, y1 = 0, any = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      any = true;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!any) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const out = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const sx0 = x0 + (i * bw) / N, sx1 = x0 + ((i + 1) * bw) / N;
      const sy0 = y0 + (j * bh) / N, sy1 = y0 + ((j + 1) * bh) / N;
      let sum = 0, cnt = 0;
      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
          if (y < 0 || y >= h || x < 0 || x >= w) continue;
          sum += mask[y * w + x]; cnt++;
        }
      }
      out[j * N + i] = cnt ? sum / cnt : 0;
    }
    return out;
  };
  const sim = (a, b) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return 1 - d / a.length;
  };

  const cells = scoreCellRects();
  const refs = [];
  for (const ch of SCORE_GLYPHS) {
    const N = 40;
    const m = glyphMask(ch, N);
    refs.push(shape(m, N, N));
  }
  let inkBad = 0, borderBad = 0, twin = 0, misread = [];
  const cellShapes = [];
  for (let i = 0; i < cells.length; i++) {
    const { w, h, px } = readCell(cells[i]);
    const mask = new Uint8Array(w * h);
    let ink = 0;
    for (let j = 0; j < w * h; j++) { if (px[j * 4 + 3] > 127) { mask[j] = 1; ink++; } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) borderBad += px[(y * w + x) * 4 + 3] > 4 ? 1 : 0;
    }
    const cover = ink / (w * h);
    if (cover <= 0.03 || cover >= 0.9) inkBad++;
    const sh = shape(mask, w, h);
    cellShapes.push({ ch: SCORE_GLYPHS[i], sh });
    if (!sh) { misread.push(SCORE_GLYPHS[i]); continue; }
    // Which reference does this cell look most like?
    let best = -1, bestS = -1;
    for (let r = 0; r < refs.length; r++) {
      if (!refs[r]) continue;
      const s = sim(sh, refs[r]);
      if (s > bestS) { bestS = s; best = r; }
    }
    if (best !== i) misread.push(`${SCORE_GLYPHS[i]}→${SCORE_GLYPHS[best]}@${bestS.toFixed(2)}`);
  }
  check(inkBad === 0, 'every scoreboard glyph has ink', `${cells.length - inkBad}/${cells.length} cells`);
  check(borderBad === 0, 'the scoreboard cells have a clear border', `${borderBad} edge texels`);
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cellShapes[i].sh, b = cellShapes[j].sh;
      if (!a || !b || a.length !== b.length) continue;
      if (sim(a, b) > 0.985) twin++;
    }
  }
  check(twin === 0, 'no two scoreboard glyphs draw the same shape', `${cells.length} cells`);
  check(misread.length === 0, 'each scoreboard cell reads as its own digit',
    misread.length ? misread.join(' ') : '0-9 and :');
}

/* ------------------------------------------------------------------ the mat */

{
  const { crest, corner, edge } = MAT_MARKS;
  const line = ARENA_AREA / 2;                     // the painted boundary
  const crestR = crest.size / 2;
  check(crestR < line - 0.5, 'the crest stays inside the competition square',
    `${crest.size} m across, line at ${line} m`);

  const cLo = corner.at - corner.size / 2, cHi = corner.at + corner.size / 2;
  check(cLo > line + 0.15, 'the corner roundels clear the boundary line',
    `nearest edge ${cLo.toFixed(2)} m, line at ${line} m`);
  check(cHi < ARENA_HALF - 0.1, 'the corner roundels stay on the mat',
    `outer edge ${cHi.toFixed(2)} m, mat ends at ${ARENA_HALF} m`);

  const eLo = edge.at - edge.height / 2, eHi = edge.at + edge.height / 2;
  check(eLo > line + 0.15 && eHi < ARENA_HALF - 0.05, 'the edge lettering sits in the safety border',
    `${eLo.toFixed(2)}..${eHi.toFixed(2)} m`);
  // The edge strip runs along one side; the corner roundels sit at the ends of
  // the same side. If they meet, the mat reads as a jumble sale.
  const strip = edge.len / 2;
  const gap = corner.at - corner.size / 2 - strip;
  check(gap > 0.2, 'the lettering and the corner marks do not touch',
    `${gap.toFixed(2)} m of clear mat between them`);
  // The strip's own band overlapping a roundel is a second way to collide.
  const bandOverlap = Math.min(eHi, cHi) - Math.max(eLo, cLo);
  check(gap > 0.2 || bandOverlap < 0, 'no mark overlaps another', `bands overlap ${bandOverlap.toFixed(2)} m`);
}

/* --------------------------------------------------------------- the kimono */

// Every fighter in the game, not just the first one. The patches are placed in
// body UV, which every bake shares, but the body under that UV is a different
// man each time: what is a 19 cm patch on one chest is another size on the next,
// and a rectangle that clears one jacket's collar may sit on top of another's.
const fighters = ['bjj/assets/fighter.bin', 'bjj/assets/fighter-b.bin'].filter((f) => existsSync(f));
if (!fighters.length) {
  console.log('no baked fighter on disk — skipping the patch checks');
}
for (const path of fighters) {
  console.log(`--- patches on ${path.split('/').pop()}`);
  const raw = readFileSync(path);
  const m = decodeFighter(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  const n = m.pos.length / 3;

  const NAMES = ['skin', 'jacket', 'trousers', 'belt', 'collar', 'hair', 'face', 'eye', 'lashes'];

  // Triangles of the garment, in UV. A patch is drawn wherever the shader finds
  // cloth under the rectangle, so the question is not how many vertices are
  // nearby — a seven-centimetre patch on a jacket meshed at two centimetres has
  // six, and that is fine — but whether cloth covers the whole rectangle.
  const tris = [];
  for (let t = 0; t < m.idx.length; t += 3) {
    const v = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
    const uv = v.map((k) => [m.uv[k * 2], m.uv[k * 2 + 1]]);
    // A triangle spanning the wrap seam covers half the body in UV and would
    // swallow every test point put to it.
    const spread = Math.max(...uv.map((q) => q[0])) - Math.min(...uv.map((q) => q[0]));
    if (spread > 1.0) continue;
    tris.push({ uv, mat: m.mat[v[0]] });
  }
  const inTri = (q, uv) => {
    const [A0, B0, C0] = uv;
    const d = (B0[1] - C0[1]) * (A0[0] - C0[0]) + (C0[0] - B0[0]) * (A0[1] - C0[1]);
    if (Math.abs(d) < 1e-12) return false;
    const w0 = ((B0[1] - C0[1]) * (q[0] - C0[0]) + (C0[0] - B0[0]) * (q[1] - C0[1])) / d;
    const w1 = ((C0[1] - A0[1]) * (q[0] - C0[0]) + (A0[0] - C0[0]) * (q[1] - C0[1])) / d;
    return w0 >= -0.002 && w1 >= -0.002 && w0 + w1 <= 1.002;
  };

  // The rectangles the game will actually use: the layout after it has been
  // fitted to this body. Checking the authored numbers instead would be
  // checking the wrong thing — and the measurement below is this tool's own,
  // taken over a different window, so agreeing with the fitter is a result and
  // not an arrangement.
  for (const p of fitPatches(m)) {
    const label = `${p.cell} @ u ${p.u.toFixed(2)} v ${p.v.toFixed(2)}`;
    // Sample the rectangle and ask what is under each point.
    const N = 7;
    let covered = 0, total = 0;
    const under = new Map();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const q = [p.u + ((i / (N - 1)) * 2 - 1) * p.du * 0.94,
          p.v + ((j / (N - 1)) * 2 - 1) * p.dv * 0.94];
        total++;
        let cloth = false;
        for (const tr of tris) {
          if (!inTri(q, tr.uv)) continue;
          under.set(tr.mat, (under.get(tr.mat) || 0) + 1);
          if (tr.mat === 1 || tr.mat === 2) cloth = true;
        }
        if (cloth) covered++;
      }
    }
    check(covered / total > 0.95, `${label}: cloth under all of it`,
      `${((covered / total) * 100).toFixed(0)}% of the patch is on jacket or trousers`);
    // A belt or a collar under the rectangle is cloth too, and would take the
    // patch: half a crest wrapped over a lapel is what this catches.
    const clash = [...under.keys()].filter((k) => k === 3 || k === 4);
    check(clash.length === 0, `${label}: no belt or collar underneath`,
      [...under].map(([k, c]) => `${NAMES[k]}:${c}`).join(' ') || 'nothing');

    // How big is it, on the body, in centimetres?
    //
    // The UV is angular, so a rectangle in it is not a rectangle in metres, and
    // the honest conversion is the mesh's own edges: for every triangle edge
    // under the patch, how far does the surface travel per unit of u, and per
    // unit of v. The median of those is the local scale of the map. Summing
    // vertex to vertex instead reads 64 cm for a 20 cm patch, because the
    // vertices of a jacket zig-zag between its outer and inner faces.
    const at = (v) => [m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]];
    const scale = (want) => {
      // As local as the mesh allows: widen the window only until there are
      // enough edges to take a median of, because the scale of the map is not
      // the same on the middle of the back as on the ribs.
      for (const grow of [1.0, 1.4, 1.8, 2.4]) {
        const set = new Set();
        for (let v = 0; v < n; v++) {
          if (m.mat[v] !== 1 && m.mat[v] !== 2) continue;
          if (Math.abs(m.uv[v * 2] - p.u) <= p.du * grow && Math.abs(m.uv[v * 2 + 1] - p.v) <= p.dv * grow) set.add(v);
        }
        const perU = [], perV = [];
        for (let t = 0; t < m.idx.length; t += 3) {
          for (const [x, y] of [[0, 1], [1, 2], [2, 0]]) {
            const va = m.idx[t + x], vb = m.idx[t + y];
            if (!set.has(va) || !set.has(vb)) continue;
            const [x0, y0, z0] = at(va), [x1, y1, z1] = at(vb);
            const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
            const du = Math.abs(m.uv[va * 2] - m.uv[vb * 2]);
            const dv = Math.abs(m.uv[va * 2 + 1] - m.uv[vb * 2 + 1]);
            if (du > 0.02 && dv < du * 0.25) perU.push(d / du);
            if (dv > 0.02 && du < dv * 0.25) perV.push(d / dv);
          }
        }
        const list = want === 'u' ? perU : perV;
        if (list.length >= 20 || grow === 2.4) {
          return list.length ? list.sort((x, y) => x - y)[list.length >> 1] : 0;
        }
      }
      return 0;
    };
    const wide = scale('u') * 2 * p.du;
    const tall = scale('v') * 2 * p.dv;

    check(wide > 0.04 && wide < 0.34 && tall > 0.02 && tall < 0.34,
      `${label}: a patch, not a billboard`,
      `${(wide * 100).toFixed(0)}×${(tall * 100).toFixed(0)} cm on the body`);

    // The cell is a picture with an aspect ratio and the patch is a rectangle
    // on a body with another one. Where they differ the crest is stretched, and
    // a stretched crest is a wrong crest.
    const [, , cw, ch] = cellRect(p.cell);
    const want = cw / ch;
    const got = wide / Math.max(tall, 1e-6);
    check(Math.abs(got / want - 1) < 0.14, `${label}: not stretched`,
      `cell ${want.toFixed(2)}, on the body ${got.toFixed(2)}`);

    // Which way does it face?
    //
    // "Chest patch" is a claim about a direction, and the UV cannot be read for
    // one: u 0.60 sounds like the front of the chest and is in fact the side of
    // the ribs, because this jacket's V-neck is wide and pushes anything that
    // has to miss the collar around towards the armpit. So the normals of the
    // cloth under the rectangle are averaged and the answer is measured in
    // degrees off the way the fighter looks.
    //
    // Measured over triangles and weighted by their area, not over vertices.
    // Counting vertices makes the answer a fact about the tessellation: a
    // decimator takes its triangles out of the flat places first, so thinning
    // the mesh emptied the flat outside of the thigh, left the curved edges of
    // the same patch, and swung the average 130 degrees without one millimetre
    // of cloth having moved. What the patch is printed on is an area.
    let fx = 0, fz = 0, fn = 0;
    for (let t = 0; t < m.idx.length; t += 3) {
      const va = m.idx[t], vb = m.idx[t + 1], vc = m.idx[t + 2];
      if (m.mat[va] !== 1 && m.mat[va] !== 2) continue;
      const cu = (m.uv[va * 2] + m.uv[vb * 2] + m.uv[vc * 2]) / 3;
      const cv = (m.uv[va * 2 + 1] + m.uv[vb * 2 + 1] + m.uv[vc * 2 + 1]) / 3;
      if (Math.abs(cu - p.u) > p.du || Math.abs(cv - p.v) > p.dv) continue;
      const a = va * 3, b = vb * 3, c = vc * 3;
      const e1 = [m.pos[b] - m.pos[a], m.pos[b + 1] - m.pos[a + 1], m.pos[b + 2] - m.pos[a + 2]];
      const e2 = [m.pos[c] - m.pos[a], m.pos[c + 1] - m.pos[a + 1], m.pos[c + 2] - m.pos[a + 2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const ar = Math.hypot(cr[0], cr[1], cr[2]) / 2;
      if (!(ar > 0)) continue;
      // The triangle's own normal rather than the average of its corners': a
      // corner normal is shared with whatever else touches that vertex, and on
      // the rim of a patch that is cloth outside it.
      fx += (cr[0] / (2 * ar)) * ar;
      fz += (cr[2] / (2 * ar)) * ar;
      fn++;
    }
    if (fn) {
      // A bearing: 0 is straight ahead, 180 straight behind, +90 the wearer's
      // own left. A thigh patch sits on the outside of the leg and is supposed
      // to point sideways; saying so in the layout is what makes this a check
      // rather than a coincidence.
      const away = (Math.atan2(fx, fz) * 180) / Math.PI;
      const off = Math.abs(((away - p.face + 540) % 360) - 180);
      check(off < 45, `${label}: faces where it is meant to`,
        `${away.toFixed(0)}° off the nose, wanted ${p.face}°`);
    }

    // The UV seam runs down the fighter's left side. A patch straddling it is
    // torn in half, and half of it is drawn on the other side of the body.
    const seam = Math.PI * 1.1;
    check(Math.abs(p.u) + p.du < seam, `${label}: clear of the UV seam`,
      `${(Math.abs(p.u) + p.du).toFixed(2)} against ${seam.toFixed(2)}`);
  }
}

/* --------------------------------------------------------- will it be read? */

// The smallest lettering on each mark, in millimetres on the real object and
// then in pixels at the framing the game actually uses: a phone held sideways,
// 900 device pixels tall, a 34° lens two and a half metres away. Below about
// six pixels a letter is a grey smear and the mark would be better without it.
{
  const px = (metres, dist = 2.5) => (metres * 900) / (2 * dist * Math.tan((34 * Math.PI) / 360));
  const rows = [
    ['mat crest, ring lettering', (0.115 / 2.08) * MAT_MARKS.crest.size, 3.0],
    ['mat corner, academy name', (0.135 / 2.08) * MAT_MARKS.corner.size, 4.5],
    ['mat edge, wordmark', (0.62 / 2.0) * MAT_MARKS.edge.height, 4.0],
    ['back patch, ARES', (0.26 / 2.16) * 0.26, 2.5],
    ['back patch, club line', (0.115 / 2.16) * 0.26, 2.5],
    // Out in the hall. The wordmark is drawn in a canvas two units tall with a
    // 0.62-unit cap, so the cap is 31% of however tall it is printed; the
    // crest's ring lettering is the same fraction the mat's is.
    ['hoardings, wordmark', (0.62 / 2.0) * ARENA_MARKS.board.height, ARENA_MARKS.board.dist],
    // The jumbotron carries the score now (Г2), so what has to be readable on
    // it is a digit, not the crest. A digit's cap height is the type size.
    ['jumbotron, score digits', ARENA_MARKS.score.cap, ARENA_MARKS.score.dist],
  ];
  for (const [what, cap, dist] of rows) {
    const p = px(cap, dist);
    check(p > 6, `${what} is large enough to read`,
      `${(cap * 1000).toFixed(0)} mm → ${p.toFixed(0)} px at ${dist} m`);
  }
}

/* ------------------------------------------------------------------ pictures */

if (dump) {
  mkdirSync(dump, { recursive: true });
  writeFileSync(join(dump, 'marks.png'), atlasToPNG(A, atlas.data, [0.82, 0.82, 0.80]));

  // A plan of the mat, straight down, at four centimetres to the pixel. This is
  // the shader's arithmetic done again on the CPU: if the two ever disagree the
  // picture is the one that is wrong, but it is the only way to see the whole
  // layout at once — the game's camera is two metres from the fighters and can
  // never show it.
  const P = 900, half = ARENA_HALF;
  const img = new Uint8Array(P * P * 4);
  const sample = (name, q) => {
    const [ru, rv, rw, rh] = cellRect(name);
    if (q[0] < 0 || q[0] > 1 || q[1] < 0 || q[1] > 1) return null;
    // Straight into the atlas, in the atlas's own orientation: v runs up, row
    // zero is the bottom, exactly as the sampler sees it. Flipping here as well
    // — which is what the first version of this did, reasoning about the PNG
    // instead of about the texture — reads every mark out of a neighbouring
    // cell, upside down, and the plan comes out as somebody else's mat.
    const x = Math.min(A - 1, Math.round((ru + q[0] * rw) * A));
    const y = Math.min(A - 1, Math.round((rv + q[1] * rh) * A));
    const i = (y * A + x) * 4;
    return [atlas.data[i] / 255, atlas.data[i + 1] / 255, atlas.data[i + 2] / 255, atlas.data[i + 3] / 255];
  };
  const { crest, corner, edge } = MAT_MARKS;
  for (let j = 0; j < P; j++) {
    for (let i = 0; i < P; i++) {
      const x = ((i + 0.5) / P - 0.5) * 2 * half;
      const z = ((j + 0.5) / P - 0.5) * 2 * half;
      const inArea = Math.max(Math.abs(x), Math.abs(z)) <= ARENA_AREA / 2;
      // The albedo the renderer actually sets, so the plan is not prettier
      // than the mat. Lighting is not simulated: this is a plan, not a render.
      let c = inArea ? [0.043, 0.105, 0.245] : [0.40, 0.235, 0.045];
      const over = (s) => { if (s) c = c.map((v, k) => v * (1 - s[3]) + s[k]); };
      over(sample('aresRound', [x / crest.size + 0.5, 0.5 - z / crest.size]));
      const rx = x - Math.sign(x) * corner.at, rz = z - Math.sign(z) * corner.at;
      over(sample('olavoRound', [rx / corner.size + 0.5, 0.5 - rz / corner.size]));
      const onX = Math.abs(x) > Math.abs(z);
      const along = onX ? -z * Math.sign(x) : x * Math.sign(z);
      const across = onX ? Math.abs(x) : Math.abs(z);
      over(sample('wordmark', [along / edge.len + 0.5, 0.5 - (across - edge.at) / edge.height]));
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (Math.abs(d - ARENA_AREA / 2) < 0.05) c = [0.86, 0.87, 0.86];
      const o = (j * P + i) * 4;
      for (let k = 0; k < 3; k++) img[o + k] = Math.round(Math.min(1, c[k]) * 255);
      img[o + 3] = 255;
    }
  }
  writeFileSync(join(dump, 'mat-plan.png'), encodePNG(P, P, img));
  console.log(`\nwrote ${join(dump, 'marks.png')} and ${join(dump, 'mat-plan.png')}`);
}

console.log(fail ? `\n${fail} check(s) failed` : '\nmarks are clean');
process.exit(fail ? 1 : 0);
