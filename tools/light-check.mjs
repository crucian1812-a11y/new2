// Lighting check: does a baked sprite actually turn towards the light?
//
// The relight is four greyscale layers blended by a direction (see sdf.js).
// A sign flipped anywhere in that chain — in the height gradient, in the layer
// encoding, in the mirrored copy used for flipped props — produces a picture
// that still looks plausible at a glance and is lit from exactly the wrong
// side, which is the kind of mistake that survives for months because nobody
// can prove it from a screenshot.
//
// Comparing halves of the sprite does not work: a pine is fifty fronds and
// each one has a lit side and a shadow side, so the halves come out even no
// matter where the light is. What must hold is local. Light the sprite from
// the right, light it from the left, and subtract: every surface that faces
// right got brighter and every surface that faces left got darker. Those
// surfaces sit on the right and left of whatever shape they belong to — a
// whole boulder or one needle — so the difference image, weighted by distance
// from its own centre of mass, has to lean the same way as the light. That is
// one number per axis, it is scale-free, and it does not care what the
// silhouette looks like.
import { chromium } from 'playwright';

const PORT = +(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8099);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 420 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
  timeout: 60000,
});

const out = await page.evaluate(async () => {
  const props = await import('/src/render/props.js');
  const { flipShadeBasis } = await import('/src/render/sdf.js');
  const results = [];

  // The same two blits the renderer does, onto a flat mid grey so the only
  // thing in the picture is the shading.
  const relight = (spr, shade, ux, uy) => {
    const c = document.createElement('canvas');
    c.width = spr.w;
    c.height = spr.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, spr.w, spr.h);
    ctx.globalCompositeOperation = 'overlay';
    if (Math.abs(ux) > 0.06) {
      ctx.globalAlpha = 0.62 * Math.abs(ux);
      ctx.drawImage(ux > 0 ? shade.xp : shade.xn, 0, 0, spr.w, spr.h);
    }
    if (Math.abs(uy) > 0.06) {
      ctx.globalAlpha = 0.62 * Math.abs(uy);
      ctx.drawImage(uy > 0 ? shade.yp : shade.yn, 0, 0, spr.w, spr.h);
    }
    return ctx.getImageData(0, 0, spr.w, spr.h).data;
  };

  /**
   * How far the difference between two lightings leans along one axis, as a
   * number from -1 (entirely the wrong way) through 0 (no preference) to +1.
   * `axis` is 0 for x and 1 for y.
   */
  const lean = (a, b, w, h, axis) => {
    const d = new Float32Array(w * h);
    let sum = 0;
    let mass = 0;
    for (let i = 0; i < w * h; i++) {
      d[i] = (a[i * 4] - b[i * 4]) / 255;
      const m = Math.abs(d[i]);
      mass += m;
      sum += m * (axis ? (i / w) | 0 : i % w);
    }
    if (mass < 1e-6) return 0;
    const centre = sum / mass;
    let signed = 0;
    let total = 0;
    for (let i = 0; i < w * h; i++) {
      const p = (axis ? (i / w) | 0 : i % w) - centre;
      signed += d[i] * p;
      total += Math.abs(d[i] * p);
    }
    return total < 1e-6 ? 0 : signed / total;
  };

  for (const name of Object.keys(props.PROP_DEFS)) {
    for (const flip of [0, 1]) {
      const spr = props.getProp(name, 0);
      const shade = flip ? flipShadeBasis(spr.shade) : spr.shade;
      if (!shade) {
        results.push({ name, flip, skipped: true });
        continue;
      }
      const right = relight(spr, shade, 1, 0);
      const left = relight(spr, shade, -1, 0);
      const down = relight(spr, shade, 0, 1);
      const up = relight(spr, shade, 0, -1);
      results.push({
        name,
        flip,
        w: spr.w,
        h: spr.h,
        // Lit from the right minus lit from the left must lean right; lit from
        // below minus lit from above must lean down.
        x: +lean(right, left, spr.w, spr.h, 0).toFixed(3),
        y: +lean(down, up, spr.w, spr.h, 1).toFixed(3),
      });
    }
  }
  return results;
});

await browser.close();

// A solid shape leans past 0.5. A thicket of stalks leans less — its stalks
// are a pixel or two across, so the field blurs each one into its neighbours
// and the response comes out mushy rather than wrong — and the weakest of them
// still manages 0.17. A flipped sign would read about -0.5, so the bar is set
// where nothing correct can fail and nothing inverted can pass.
const MIN = 0.1;
let failed = 0;
let skipped = 0;
let worst = { name: '-', v: 1 };
for (const r of out) {
  if (r.skipped) {
    skipped++;
    continue;
  }
  const bad = [];
  if (!(r.x > MIN)) bad.push(`horizontal lean ${r.x}`);
  if (!(r.y > MIN)) bad.push(`vertical lean ${r.y}`);
  const low = Math.min(r.x, r.y);
  if (low < worst.v) worst = { name: r.name + (r.flip ? ' (flipped)' : ''), v: low };
  if (bad.length) {
    failed++;
    console.log(`FAIL ${r.name}${r.flip ? ' (flipped)' : ''} (${r.w}x${r.h}): ${bad.join(', ')}`);
  }
}
console.log(`${out.length - skipped} sprites lit from four sides, ${skipped} with no basis`);
console.log(`weakest response: ${worst.name} at ${worst.v}`);
console.log(failed ? `${failed} sprite(s) lit from the wrong side` : 'every sprite turns towards the light');
process.exit(failed ? 1 : 0);
