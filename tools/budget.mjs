// A performance budget that does not need a GPU.
//
// There is no GPU in the container this game is built in — no /dev/dri, no
// PCI display device, four CPU cores. So every frame-rate number available
// here comes from a software rasteriser and none of them mean anything about
// a phone. Measuring harder does not help; the machine cannot answer the
// question.
//
// What it *can* answer exactly is what the frame costs, and on a mobile
// tile-based GPU the cost that bites first is not triangles — it is draw
// calls, because each one is a pipeline state change the tiler cannot batch
// away. Those counters are hardware-independent: the same scene submits the
// same number of draws whether it renders in one millisecond or four hundred.
//
// So this holds the build to a budget instead of to a stopwatch. The numbers
// below are a judgement, not a measurement — they are what a mid-range phone
// from around 2020 handles comfortably in WebGL2 — and they are deliberately
// conservative. Failing them does not prove the game is slow; it proves it
// has stopped being obviously safe, which is the point at which the number
// from a real device has to be asked for.
export const BUDGET = {
  draws: 170,
  primitives: 260_000,
  textureMB: 96,
  bufferMB: 48,
};

export function report(p) {
  const rows = [
    ['draw calls', p.draws, BUDGET.draws, (v) => `${v}`],
    ['primitives', p.tris, BUDGET.primitives, (v) => `${(v / 1000).toFixed(0)}k`],
    ['texture memory', p.texmem / 1048576, BUDGET.textureMB, (v) => `${v.toFixed(1)} MB`],
    ['buffer memory', p.bufmem / 1048576, BUDGET.bufferMB, (v) => `${v.toFixed(1)} MB`],
  ];
  let over = 0;
  for (const [name, got, cap, fmt] of rows) {
    const bad = got > cap;
    if (bad) over++;
    console.log(
      `  ${bad ? 'OVER' : 'ok  '} ${name.padEnd(16)} ${fmt(got).padStart(9)}  of ${fmt(cap)}` +
        `  (${((got / cap) * 100).toFixed(0)}% of budget)`
    );
  }
  console.log(`  visible objects: ${p.objects}`);
  return over;
}
