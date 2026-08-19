// Head check: does a head actually turn, and does what is on it stay on it?
//
// A head is eight pixels across in the game and it is still the first thing
// anybody looks at. Three things about it are claims, and all three were false
// at some point this week in a way that looked almost right in a screenshot:
//
//   1. The features live on the skull, so they travel round it as the figure
//      turns and go out of sight when it turns away. The old face was painted
//      at a fixed offset from the head's centre — and at a *negative* offset,
//      so the eyes drifted the wrong way as the head turned.
//   2. The hair is a cap on that same sphere, and a cap has to be drawn at
//      every heading. Closing its outline with an arc chosen by eye rather
//      than from the geometry dropped the hair off the back of every head
//      pointed between about two hundred and three hundred degrees.
//   3. A beard hangs off the chin and is plainly visible from the front. Fading
//      it by how squarely its own surface faces the camera hid it from exactly
//      the angle it matters most, because a beard's surface points downwards
//      and the camera looks down at it.
//
// So the rig is rendered with hair and beard forced to colours nothing else in
// the palette comes near, and the pixels are counted.
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
  const { renderActor, poseHumanoid, headFrame } = await import('/src/render/actors.js');
  const { LOOKS } = await import('/src/game/content.js');

  const S = 6;
  const W = 340;
  const H = 260;
  const CX = W / 2;
  const CY = 70;
  const BG = [255, 0, 255];
  // Hair and beard in colours the rest of the figure cannot produce, so a
  // pixel count is unambiguous.
  const HAIR = [0, 90, 255];
  const BEARD = [255, 40, 0];

  const base = LOOKS.hexer;
  const rig = { ...base, hair: HAIR, hairLight: HAIR, hairLen: 0.5, beard: BEARD, beardLen: 1 };
  const p0 = poseHumanoid({ t: 0, anim: 'idle', animT: 0, facing: 0, speed: 0, phase: 0, turn: 0, seed: 0 }, base.build || {});
  const headZ = p0.head[2];

  const near = (d, i, c, tol) =>
    Math.abs(d[i] - c[0]) < tol && Math.abs(d[i + 1] - c[1]) < tol && Math.abs(d[i + 2] - c[2]) < tol;

  const shot = (def, facing) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'rgb(255,0,255)';
    ctx.fillRect(0, 0, W, H);
    // `lookAt` pins the head's heading to the body's, so the idle drift of the
    // neck cannot move the answer.
    renderActor(
      ctx,
      def,
      { t: 0, anim: 'idle', animT: 0, facing, speed: 0, phase: 0, turn: 0, seed: 0, lookAt: facing },
      CX,
      headZ * S + CY,
      S,
      null
    );
    return ctx.getImageData(0, 0, W, H).data;
  };

  // Everything is measured inside the head's own box, and only on pixels well
  // inside the silhouette, so the near-black contour round the outside is not
  // mistaken for an eye.
  const BOXW = 78;
  const BOXH = 90;
  const scan = (d) => {
    const isBg = (x, y) => near(d, (y * W + x) * 4, BG, 12);
    let darkN = 0;
    let darkSumX = 0;
    let hair = 0;
    let beard = 0;
    for (let y = Math.max(6, CY - BOXH * 0.6); y < CY + BOXH * 0.7; y++) {
      for (let x = CX - BOXW; x < CX + BOXW; x++) {
        const i = (y * W + x) * 4;
        if (isBg(x, y)) continue;
        if (near(d, i, HAIR, 70)) hair++;
        if (near(d, i, BEARD, 70)) beard++;
        // The face is the band from the brow to the mouth. Below that is the
        // hollow of the throat, which is dark from every angle including the
        // back of the head — counting it as face made a head turned away look
        // like it still had one.
        if (y > CY + BOXH * 0.34) continue;
        const lum = d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1;
        // Only near-neutral darks count as face. The shadow between two locks
        // of hair is dark too, and it is bright blue here — without this the
        // hair's own partings get counted as eyes.
        const chroma = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        if (lum < 72 && chroma < 30) {
          // Five pixels clear of the outline in every direction.
          if (isBg(x - 5, y) || isBg(x + 5, y) || isBg(x, y - 5) || isBg(x, y + 5)) continue;
          darkN++;
          darkSumX += x - CX;
        }
      }
    }
    return { darkN, darkX: darkN ? darkSumX / darkN : 0, hair, beard };
  };

  const res = { headings: [] };
  const N = 24;
  for (let i = 0; i < N; i++) {
    const facing = (i / N) * Math.PI * 2;
    res.headings.push({ deg: Math.round((facing * 180) / Math.PI), ...scan(shot(rig, facing)) });
  }
  // Facing 0 is straight to the right of the screen, PI straight to the left.
  res.right = scan(shot(rig, 0));
  res.left = scan(shot(rig, Math.PI));
  res.toward = scan(shot(rig, Math.PI / 2));
  res.away = scan(shot(rig, -Math.PI / 2));
  res.noBeard = scan(shot({ ...rig, beard: undefined }, Math.PI / 2));

  // The head's edge, checked against the geometry rather than against the
  // picture.
  //
  // The silhouette of any linear map of a sphere is the ring of points square
  // to the directions that map collapses — its kernel. So the kernel is read
  // straight out of `hp` by probing it with the three basis vectors, and every
  // point `silhouette()` hands back must be perpendicular to it. Deriving the
  // kernel rather than assuming one keeps this honest whatever scaling `hp`
  // carries.
  //
  // Nothing in a screenshot catches this. The error is symmetric, so the
  // picture stays plausible while every cap closed along that ring — hair, a
  // cowl, a helmet's brow band — is closed along the wrong line.
  let edgeWorst = 0;
  for (let i = 0; i < 16; i++) {
    const facing = (i / 16) * Math.PI * 2;
    const F = headFrame([0, 0], 1, Math.cos(facing), Math.sin(facing));
    const o = F.hp(0, 0, 0);
    const col = (a, b, c) => {
      const q = F.hp(a, b, c);
      return [q[0] - o[0], q[1] - o[1]];
    };
    const m = [col(1, 0, 0), col(0, 1, 0), col(0, 0, 1)];
    // Kernel of the 2x3 map: the cross product of its two rows.
    const r0 = [m[0][0], m[1][0], m[2][0]];
    const r1 = [m[0][1], m[1][1], m[2][1]];
    const kern = [
      r0[1] * r1[2] - r0[2] * r1[1],
      r0[2] * r1[0] - r0[0] * r1[2],
      r0[0] * r1[1] - r0[1] * r1[0],
    ];
    const kl = Math.hypot(...kern) || 1;
    for (const n of F.silhouette()) {
      const dot = (n[0] * kern[0] + n[1] * kern[1] + n[2] * kern[2]) / kl;
      edgeWorst = Math.max(edgeWorst, Math.abs(dot));
    }
  }
  res.edgeWorst = edgeWorst;
  return res;
});

await browser.close();

const fails = [];
const say = (ok, name, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) fails.push(name);
};

// 1. The features travel round the skull with it.
say(
  out.right.darkX > 3 && out.left.darkX < -3,
  'the face turns with the head',
  `eyes sit ${out.right.darkX.toFixed(1)}px right of centre facing right, ${out.left.darkX.toFixed(1)}px facing left`
);

// 2. Nothing of the face survives on the back of the head.
say(
  out.away.darkN < out.toward.darkN * 0.3,
  'no face on the back of the head',
  `${out.away.darkN} dark px facing away vs ${out.toward.darkN} facing the camera`
);

// 3. The hair cap is drawn at every heading.
const hairs = out.headings.map((h) => h.hair);
const maxHair = Math.max(...hairs);
const worst = out.headings.reduce((a, b) => (a.hair < b.hair ? a : b));
say(
  worst.hair > maxHair * 0.18,
  'hair covers the head at every heading',
  `thinnest at ${worst.deg}° with ${worst.hair} px, against ${maxHair} at best`
);

// 4. A beard shows from the front, which is the only angle a player sees most.
say(
  out.toward.beard > 150 && out.noBeard.beard < 20,
  'a beard reads head-on',
  `${out.toward.beard} px of beard facing the camera, ${out.noBeard.beard} without one`
);

// 5. The silhouette the code walks is the head's actual outline.
say(
  out.edgeWorst < 0.01,
  'the head knows where its own edge is',
  `silhouette ring is ${(out.edgeWorst * 100).toFixed(2)}% out of square with the view, over 16 headings`
);

console.log(fails.length ? `${fails.length} head claim(s) not met` : 'the head turns, keeps its hair, and wears its edge and its beard');
process.exit(fails.length ? 1 : 0);
