// GPU stage check: does the shader composite the way Canvas2D does?
//
// The GL stage cannot be checked by screenshot — a headless browser does not
// composite a WebGL canvas into the picture it hands back — so this drives the
// shader directly with synthetic buffers and reads the framebuffer. Two things
// went wrong when the lighting moved onto the GPU, and both of them showed up
// in game as large saturated flares that drowned the lighting:
//
//   coverage   the emissive and bloom buffers are alpha-backed canvases, and a
//              canvas uploaded un-premultiplied hands over full-strength colour
//              with the coverage in the alpha channel alone. Reading .rgb and
//              dropping .a turned every soft radial spark into a flat disc at
//              full power.
//
//   monotonic  the overlay contrast curve is only defined on 0..1. Canvas2D
//              clamped every blend; the shader does not, and the curve's upper
//              branch turns over at 1.707 and dives — so an overbright channel
//              came out *darker* than a merely bright one, and since the three
//              channels crossed that point at different times a white-hot spell
//              turned into a coloured ring.
//
// Both are invisible in a still of a dark scene and obvious the moment
// something bright happens, which is the worst way for a bug to behave.
import { chromium } from 'playwright';

const PORT = +(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8099);

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 640, height: 400 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
  timeout: 60000,
});

const out = await page.evaluate(async () => {
  const { GLStage } = await import('/src/render/gl.js');
  const N = 32;
  const stage = new GLStage(document.createElement('canvas'));
  if (!stage.ok) return { skipped: 'no webgl2' };

  const mk = (fill) => {
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    if (fill) {
      const x = c.getContext('2d');
      x.fillStyle = fill;
      x.fillRect(0, 0, N, N);
    }
    return c;
  };
  /** A flat field of one colour laid down at `a` coverage — a spark, flattened. */
  const emissive = (a, color) => {
    const c = mk(null);
    const x = c.getContext('2d');
    x.globalAlpha = a;
    x.fillStyle = color;
    x.fillRect(0, 0, N, N);
    return c;
  };

  const fog = mk('#000');
  const blank = mk(null);

  // Average the middle of the frame: the film grain is a per-pixel hash and
  // averaging a block puts it back under the tolerance.
  const sample = () => {
    const gl = stage.gl;
    const px = new Uint8Array(7 * 7 * 4);
    gl.readPixels((N / 2 - 3) | 0, (N / 2 - 3) | 0, 7, 7, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const s = [0, 0, 0];
    for (let i = 0; i < 49; i++) for (let c = 0; c < 3; c++) s[c] += px[i * 4 + c];
    return s.map((v) => +(v / 49).toFixed(1));
  };

  const shoot = (world, emis, opts) => {
    const ok = stage.present(world, N, N, [], {
      fog,
      emissive: emis,
      bloom: blank,
      rooms: [],
      gradeAmount: 0,
      fogAmount: 0,
      overbright: 0,
      relief: 0,
      levels: 255,
      bloomWide: 0,
      time: 0,
      ...opts,
    });
    return ok ? sample() : null;
  };

  // --- coverage: a quarter-strength spark must land at a quarter strength ---
  const grey = mk('#404040');
  const flat = { ambient: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]], contrast: 0, bloomAmount: 1 };
  const dark = shoot(grey, blank, flat);
  const quarter = shoot(grey, emissive(0.25, 'rgb(255,60,20)'), flat);
  const full = shoot(grey, emissive(1, 'rgb(255,60,20)'), flat);

  // --- monotonic: more light out of the same pixel is never less light ------
  // Pushed deliberately past 1.0, which is where the contrast curve used to
  // turn over. Real frames get there with a torch and a spell in one place.
  const white = mk('#c0c0c0');
  const ramp = [];
  for (let i = 0; i <= 8; i++) {
    const a = i / 8;
    ramp.push({
      a,
      px: shoot(white, emissive(a, 'rgb(255,255,255)'), {
        ambient: [[1, 1, 1], [1, 1, 1]],
        contrast: 0.42,
        bloomAmount: 3,
      }),
    });
  }

  return { dark, quarter, full, ramp };
});

await browser.close();

if (out.skipped) {
  console.log(`skipped: ${out.skipped}`);
  process.exit(0);
}

let failed = 0;
const fail = (msg) => {
  failed++;
  console.log('FAIL ' + msg);
};

// The emissive term is added as rgb * a, so the lift over the unlit frame has
// to scale with coverage. Un-premultiplied colour with the alpha dropped makes
// both of these identical, which is the flare bug.
const lift = (a, b) => a.map((v, i) => v - b[i]);
const l25 = lift(out.quarter, out.dark);
const l100 = lift(out.full, out.dark);
const ratio = l100[0] / Math.max(l25[0], 0.5);
console.log(`spark at 25%: +${l25.join('/')}   at 100%: +${l100.join('/')}   ratio ${ratio.toFixed(2)}x`);
if (!(l25[0] > 4)) fail(`a quarter-strength spark barely registers (+${l25[0]})`);
if (!(ratio > 3.2 && ratio < 4.8)) fail(`coverage is not honoured: 4x the alpha gave ${ratio.toFixed(2)}x the light`);

// Every channel, up the whole ramp, must never go backwards. One step of the
// 255-level quantiser plus the grain is the tolerance.
let worst = 0;
for (let i = 1; i < out.ramp.length; i++) {
  for (let c = 0; c < 3; c++) {
    const drop = out.ramp[i - 1].px[c] - out.ramp[i].px[c];
    if (drop > worst) worst = drop;
    if (drop > 3) {
      fail(
        `brighter input, darker output: channel ${'rgb'[c]} fell ${drop.toFixed(1)} ` +
          `between coverage ${out.ramp[i - 1].a.toFixed(2)} and ${out.ramp[i].a.toFixed(2)}`
      );
    }
  }
}
console.log(
  `overbright ramp ${out.ramp.map((r) => r.px[0].toFixed(0)).join(' → ')} (worst backslide ${worst.toFixed(1)})`
);

console.log(failed ? `${failed} composite fault(s)` : 'the GPU stage composites cleanly');
process.exit(failed ? 1 : 0);
