// What a frame costs, in the units a GPU charges for.
//
// The only thing anything measured about the frame was `smoke`'s "the loop is
// running", and even that was reading a frame rate computed from a dt capped
// at 50 ms — a number that could not fall below twenty however slow the page
// was. Meanwhile the hall grew a referee's table, a podium, a medal rack, four
// speakers and an LED ribbon, and the shader grew sweat, three life channels
// and two more decals. Nobody knew what any of it cost.
//
// Frame rate is the wrong instrument for that on this machine: it is drawn by
// SwiftShader on a shared box, so it measures the box. What does not depend on
// the box is what the frame asks the driver to do — how many draw calls, how
// many program switches, how many uniform uploads, how many triangles, and how
// they divide between the shadow pass, the scene and the bloom chain. Those
// numbers are the same on a phone, and they are the numbers that decide
// whether a phone can hold sixty.
//
// The counting is done by wrapping the WebGL2 context before the renderer ever
// sees it, so nothing in src/ knows it is being measured.
//
//   node bjj/tools/frame-check.mjs             the budget
//   node bjj/tools/frame-check.mjs --detail    and every call, by pass
//
// Needs CHROME_PATH and `python3 -m http.server 8099` at the repo root.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const PORT = +(process.env.PORT || 8099);
const DETAIL = process.argv.includes('--detail');

// The budget. Not a guess: these are what the frame measured when the budget
// was written, rounded up to the next round number, and the point of them is
// that adding something to the hall moves one of them and says so here.
// Measured: 11 draws, 7 program switches, 71 uniform uploads, 237k triangles
// and 12 framebuffer binds, in a live match with both baked fighters on the
// mat. The headroom is deliberate and small — enough that a prop or a uniform
// does not trip it, not enough to hide a third of a frame.
//
// The triangles are worth reading before raising: 76k of them are the two
// fighters in the shadow pass, and 160k is the scene — the same two fighters
// lit, the same two again as outlines, and 8k of hall. The men are the frame.
//
// The referee cost exactly what this predicted when it was written: 237k went
// to 326k, which is his 30k mesh drawn three times, and the budget was raised
// once, on purpose, with the number in hand. That is the whole point of having
// one.
const BUDGET = {
  draws: 16,        // draw calls in a frame
  programs: 10,     // program switches
  uniforms: 90,     // uniform uploads
  tris: 360000,     // triangles submitted, shadow pass included
  passes: 14,       // framebuffer switches
};

let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
         '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const ctx = await browser.newContext({ viewport: { width: 812, height: 375 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Before anything on the page runs.
await page.addInitScript(() => {
  const counts = () => ({ draws: 0, programs: 0, uniforms: 0, tris: 0, passes: 0, byPass: [] });
  let cur = counts();
  window.__frames = [];
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const gl = getContext.call(this, type, attrs);
    if (!gl || type !== 'webgl2' || gl.__watched) return gl;
    gl.__watched = true;
    const pass = () => {
      while (cur.byPass.length <= cur.passes) cur.byPass.push({ draws: 0, tris: 0, programs: 0 });
      return cur.byPass[cur.passes];
    };
    const wrap = (name, before) => {
      const f = gl[name];
      if (typeof f !== 'function') return;
      gl[name] = function (...a) { before(a); return f.apply(gl, a); };
    };
    wrap('drawElements', (a) => {
      cur.draws++; pass().draws++;
      if (a[1]) { cur.tris += a[1] / 3; pass().tris += a[1] / 3; }
    });
    wrap('drawArrays', (a) => {
      cur.draws++; pass().draws++;
      if (a[2]) { cur.tris += a[2] / 3; pass().tris += a[2] / 3; }
    });
    wrap('useProgram', () => { cur.programs++; pass().programs++; });
    wrap('bindFramebuffer', () => { cur.passes++; });
    for (const k of Object.keys(Object.getPrototypeOf(gl))) {
      if (/^uniform(\d|Matrix)/.test(k)) wrap(k, () => { cur.uniforms++; });
    }
    return gl;
  };
  // A frame is what happens between two animation-frame callbacks.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (cur.draws) { window.__frames.push(cur); if (window.__frames.length > 60) window.__frames.shift(); }
    cur = counts();
    return cb(t);
  });
});

await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__stats, null, { timeout: 60000 });
// Into a live match, which is the frame that has to hold up: two skinned
// bodies, their shadows, the hall and the whole bloom chain.
await page.evaluate(() => {
  const ui = document.getElementById('ui');
  for (const type of ['pointerdown', 'pointerup']) {
    ui.dispatchEvent(new PointerEvent(type, { pointerId: 3, clientX: 600, clientY: 250, bubbles: true }));
  }
});
await page.waitForTimeout(12000);

const { frames, stats } = await page.evaluate(() => ({ frames: window.__frames, stats: window.__stats }));
await browser.close();

if (!frames.length) {
  check(false, 'the frame was counted at all');
  process.exit(1);
}
// The median frame, not the mean: the first frames of a match build textures
// and upload meshes, and one of those would carry the whole report.
const mid = (k) => {
  const v = frames.map((f) => f[k]).sort((a, b) => a - b);
  return v[v.length >> 1];
};
const got = { draws: mid('draws'), programs: mid('programs'), uniforms: mid('uniforms'),
              tris: mid('tris'), passes: mid('passes') };

console.log(`  ${frames.length} frames counted, in a live match at ${stats.position}` +
  ` (${stats.fps} fps under software GL, which means nothing)\n`);
for (const [k, v] of Object.entries(got)) {
  const b = BUDGET[k];
  check(v <= b, `${k} within budget`, `${k === 'tris' ? (v / 1000).toFixed(0) + 'k' : v} of ${k === 'tris' ? (b / 1000) + 'k' : b}`);
}

if (DETAIL) {
  const f = frames[frames.length >> 1];
  console.log('\n  the median frame, pass by pass:');
  f.byPass.forEach((p, i) => {
    if (!p.draws) return;
    console.log(`    pass ${i}  ${String(p.draws).padStart(3)} draws  ` +
      `${(p.tris / 1000).toFixed(1).padStart(6)}k tris  ${p.programs} program switch(es)`);
  });
}

if (errors.length) for (const e of errors) check(false, 'page error', e);
console.log(fail ? `\n${fail} over budget` : '\nthe frame is inside its budget');
process.exit(fail ? 1 : 0);
