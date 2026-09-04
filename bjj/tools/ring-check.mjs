// Can the ring be pressed the way it looks like it should be?
//
// The ring is four labelled circles around the right thumb, each with what it
// pays written on it. It looks exactly like four buttons, and for the whole
// life of this game it was not: the only gesture that pressed one was a swipe
// across the right-hand side, and a tap on the button marked «+4» started a
// grip fight instead, in silence.
//
// Nothing in the battery could catch that, because everything that plays this
// game swipes — thumb.mjs sends pointerdown, pointermove, pointerup, and
// human-check calls match.input directly. A person taps. That is the whole of
// the bug, and it cost a player every match he played.
//
// So this measures the geometry that a tap has to land in, on the screens the
// game is actually held on, against the four things that make a button a
// button:
//
//   · its middle is inside its own target, on every screen
//   · the four targets never touch, so a tap is never ambiguous
//   · the middle of the ring, where the thumb rests to fight for grips,
//     belongs to nobody
//   · the target is at least as wide as a thumb, and the whole ring is on the
//     glass
//
//   node bjj/tools/ring-check.mjs          the phones
//   node bjj/tools/ring-check.mjs --table  every size, with numbers

import { HUD } from '../src/ui/hud.js';

const TABLE = process.argv.includes('--table');
let fail = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// Landscape, because the game refuses to run in portrait and says so. The list
// is what people hold: a small phone, two common ones, a big one, a tablet, and
// a desktop window at the extremes of the clamp on the ring's size.
const SCREENS = [
  ['iPhone SE', 667, 375],
  ['iPhone 13', 844, 390],
  ['Pixel 7', 892, 412],
  ['iPhone Pro Max', 932, 430],
  ['iPad mini', 1024, 768],
  ['desktop', 1440, 820],
  ['tiny', 480, 260],
];
const DIRS = ['up', 'down', 'left', 'right'];
const VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// The HUD only wants a 2D context in its constructor, and none of the geometry
// touches it. Nothing here draws.
const hudFor = (w, h) => {
  const hud = new HUD({ getContext: () => ({}) });
  hud.w = w;
  hud.h = h;
  hud.dpr = 1;
  return hud;
};

const rows = [];
let missed = 0, ambiguous = 0, stolen = 0, small = Infinity, offGlass = 0;
for (const [name, w, h] of SCREENS) {
  const hud = hudFor(w, h);
  const { R, cx, cy, rr } = hud.ringLayout();
  const grab = R * 0.55;
  small = Math.min(small, grab * 2);

  for (const dir of DIRS) {
    const [dx, dy] = VEC[dir];
    const x = cx + dx * R, y = cy + dy * R;
    // Its own middle presses it.
    if (hud.ringDir(x, y) !== dir) missed++;
    // And so does anywhere a thumb might land inside the target.
    for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const t = (a / 8) * Math.PI * 2;
      const px = x + Math.cos(t) * grab * 0.9, py = y + Math.sin(t) * grab * 0.9;
      if (hud.ringDir(px, py) !== dir) ambiguous++;
    }
    // On the glass, label and all: the label sits rr + 14 outside the circle.
    if (x - rr < 0 || x + rr > w || y - rr - 14 < 0 || y + rr + 14 > h) offGlass++;
  }
  // The thumb's own resting place is not a button.
  if (hud.ringDir(cx, cy) !== null) stolen++;
  rows.push({ name, w, h, R: R.toFixed(1), grab: (grab * 2).toFixed(0), cx: cx.toFixed(0), cy: cy.toFixed(0) });
}

if (TABLE) {
  console.log('     screen           R    target  centre');
  for (const r of rows) {
    console.log(`     ${r.name.padEnd(15)} ${String(r.R).padStart(4)}  ${String(r.grab).padStart(4)}px  ${r.cx},${r.cy}`);
  }
  console.log('');
}

check(missed === 0, 'a tap in the middle of a button presses that button',
  `${SCREENS.length} screens x 4 buttons`);
check(ambiguous === 0, 'and anywhere inside its target, with no overlap',
  `${ambiguous} of ${SCREENS.length * 32} probes landed on the wrong button`);
check(stolen === 0, 'the middle of the ring is still the grip fight',
  `${stolen} screens where a grip tap would fire a move`);
// Apple asks for 44 CSS px, Android for 48 dp. The drawn circle is 26 to 40
// across, which is why the target is not the circle.
check(small >= 44, 'the target is at least as wide as a thumb',
  `smallest ${small.toFixed(0)}px across`);
check(offGlass === 0, 'the whole ring is on the glass, labels included',
  `${offGlass} buttons off the edge`);

console.log(fail ? `\n${fail} check(s) failed` : '\nthe ring is a ring of buttons');
process.exitCode = fail ? 1 : 0;
