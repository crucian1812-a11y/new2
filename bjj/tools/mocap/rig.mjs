// A capture rig that costs nothing: the game films itself.
//
// Before anybody carries tripods into a gym, the question is how many cameras
// a grapple needs before a markerless tracker can see it at all. That is
// measurable here, because the game already holds fifteen tangles of two
// bodies and knows every joint of both to the millimetre.
//
// So: stand N virtual cameras round the mat, shoot the same pose from each,
// and write down the exact view-projection matrix of every shot plus the true
// world position of every joint. The tracker then gets the pictures and
// nothing else, and its answer is compared against what the renderer knew.
//
//   node bjj/tools/mocap/rig.mjs MOUNT out/ [--cams 8] [--w 720 --h 720] [--ring 3.2]
//
// The director is switched off and the camera driven by hand: the shot has to
// be the same shot the matrix describes, and the game's camera breathes.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
import { mkdirSync, writeFileSync } from 'fs';

const argv = process.argv.slice(2);
const pose = argv[0] || 'MOUNT';
const out = argv[1] || 'shoot';
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? +argv[i + 1] : d; };
const CAMS = flag('cams', 8);
const W = flag('w', 720), H = flag('h', 720);
const RING = flag('ring', 3.2);
const HIGH = flag('high', 2);
const NOREF = argv.includes('--noref');      // how many of the N sit high, on a balcony
const PORT = +(process.env.PORT || 8099);
const BLEND = (() => {
  const i = argv.indexOf('--blend');
  return i >= 0 ? argv[i + 1] : null;   // FROM,TO,t
})();

mkdirSync(out, { recursive: true });

// The joints a pose tracker reports, in this rig's names. A bone's world
// matrix holds its own head, so `foreL` is the left elbow and `handL` the left
// wrist — the joint, not the middle of the limb.
const JOINTS = ['head', 'armL', 'armR', 'foreL', 'foreR', 'handL', 'handR',
  'hips', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/bjj/index.html`, { waitUntil: 'load' });
await page.waitForTimeout(2600);

// Hold everything still: full resolution, no breathing, no director.
await page.evaluate(() => {
  const b = window.__bjj;
  b.quality(1);
  b.still(0);
  b.camera.update = () => {};
  document.getElementById('ui').style.display = 'none';
});

if (BLEND) {
  const [from, to, t] = BLEND.split(',');
  await page.evaluate(([f, g, tt]) => { window.__bjj.match().start(); window.__bjj.setBlend(f, g, +tt); }, [from, to, t]);
} else {
  await page.evaluate((p) => { window.__bjj.match().start(); window.__bjj.setPose(p); }, pose);
}
await page.waitForTimeout(1200);

// Where the pair actually is, so the ring is centred on it rather than on the
// middle of the mat.
const truth = await page.evaluate((names) => {
  const b = window.__bjj, o = {};
  for (const role of ['A', 'B']) {
    o[role] = {};
    for (const n of names) {
      const m = b.rig.skel[role].world[b.BONE_INDEX[n]];
      o[role][n] = [m[12], m[13], m[14]];
    }
  }
  return o;
}, JOINTS);

const all = [...Object.values(truth.A), ...Object.values(truth.B)];
const mid = [0, 1, 2].map((i) => all.reduce((s, p) => s + p[i], 0) / all.length);

const shots = [];
for (let k = 0; k < CAMS; k++) {
  const a = (k / CAMS) * Math.PI * 2;
  const high = k >= CAMS - HIGH;
  // A tripod at chest height three metres out, or a camera up on the balcony.
  const eye = high
    ? [mid[0] + Math.sin(a) * RING * 0.7, 3.1, mid[2] + Math.cos(a) * RING * 0.7]
    : [mid[0] + Math.sin(a) * RING, 1.25, mid[2] + Math.cos(a) * RING];
  const at = [mid[0], mid[1], mid[2]];
  // Frame the pair, do not frame the hall. The first version stood the cameras
  // at a fixed forty degrees and the two of them took a third of the picture;
  // a tracker given a person 300 pixels tall is being asked a different
  // question from the one a real shoot asks. The angle is computed from how
  // far the pair actually reaches, with a quarter of slack.
  const d = Math.hypot(eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]);
  const reach = Math.max(...all.map((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2])));
  const fov = Math.min(70, Math.max(18, (2 * Math.atan((reach * 1.35) / d) * 180) / Math.PI));
  await page.evaluate(([e, t, f]) => {
    const c = window.__bjj.camera;
    c.eye[0] = e[0]; c.eye[1] = e[1]; c.eye[2] = e[2];
    c.at[0] = t[0]; c.at[1] = t[1]; c.at[2] = t[2];
    c.fovDeg = f; c.fov = (f * Math.PI) / 180;
  }, [eye, at, fov]);
  // The referee is a third clean standing body in shot, and a tracker asked
  // for four people finds him before it finds the second man in a tangle. He
  // belongs in the picture and not in this measurement, so he can be sent to
  // the other end of the hall.
  if (NOREF) await page.evaluate(() => { const r = window.__bjj.referee; r.x = 40; r.z = 40; });
  await page.waitForTimeout(260);
  const name = `cam${String(k).padStart(2, '0')}`;
  await page.locator('#gl').screenshot({ path: `${out}/${name}.png` });
  const info = await page.evaluate(() => {
    const r = window.__bjj.renderer;
    return { vp: Array.from(r.viewProj), w: r.sceneW, h: r.sceneH };
  });
  shots.push({ name, eye, at, fov, ...info, high });
  console.log(`${name}  eye ${eye.map((v) => v.toFixed(2)).join(' ')}  ${info.w}x${info.h}`);
}

writeFileSync(`${out}/rig.json`, JSON.stringify({
  pose: BLEND || pose, joints: JOINTS, truth, shots,
}, null, 1));
console.log(`wrote ${out}/rig.json`);
await browser.close();
