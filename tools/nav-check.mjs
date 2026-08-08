// Navigability check: floods the walkable space of every act's zone and
// reports whether the start, every camp, shrine, chest and the boss arena are
// all reachable. Scenery that quietly walls off the map is a silent killer.
import { chromium } from 'playwright';

const PORT = +(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8099);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 420 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
  timeout: 60000,
});

const out = await page.evaluate(() => {
  const g = window.__game;
  const results = [];
  for (let seedI = 0; seedI < 3; seedI++) {
    for (let act = 0; act < 5; act++) {
      g.newRun('ritter', 1000 + seedI * 37);
      g.loadAct(act);
      const z = g.zone;
      const R = 22; // player radius
      const step = 28;
      const half = z.half;
      const n = Math.ceil((half * 2) / step);
      const idx = (i, j) => j * n + i;
      const open = new Uint8Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = -half + i * step;
          const y = -half + j * step;
          open[idx(i, j)] = z.blocked(x, y, R) ? 0 : 1;
        }
      }
      // Flood from the start.
      const seen = new Uint8Array(n * n);
      const si = Math.round((z.start.x + half) / step);
      const sj = Math.round((z.start.y + half) / step);
      const stack = [[si, sj]];
      seen[idx(si, sj)] = 1;
      let reached = 0;
      while (stack.length) {
        const [i, j] = stack.pop();
        reached++;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const k = idx(a, b);
          if (seen[k] || !open[k]) continue;
          seen[k] = 1;
          stack.push([a, b]);
        }
      }
      let openCount = 0;
      for (let k = 0; k < open.length; k++) openCount += open[k];

      const canReach = (x, y) => {
        const i = Math.round((x + half) / step);
        const j = Math.round((y + half) / step);
        for (let dj = -2; dj <= 2; dj++) {
          for (let di = -2; di <= 2; di++) {
            const a = i + di;
            const b = j + dj;
            if (a < 0 || b < 0 || a >= n || b >= n) continue;
            if (seen[idx(a, b)]) return true;
          }
        }
        return false;
      };

      const unreachable = [];
      if (!canReach(z.bossArena.x, z.bossArena.y)) unreachable.push('bossArena');
      z.camps.forEach((c, i) => !canReach(c.x, c.y) && unreachable.push('camp' + i));
      z.shrines.forEach((c, i) => !canReach(c.x, c.y) && unreachable.push('shrine' + i));
      z.chests.forEach((c, i) => !canReach(c.x, c.y) && unreachable.push('chest' + i));

      results.push({
        act,
        seed: 1000 + seedI * 37,
        props: z.props.length,
        openPct: +((openCount / open.length) * 100).toFixed(1),
        reachedPctOfOpen: +((reached / openCount) * 100).toFixed(1),
        unreachable,
      });
    }
  }
  return results;
});

let bad = 0;
for (const r of out) {
  const fail = r.unreachable.length > 0 || r.reachedPctOfOpen < 92;
  if (fail) bad++;
  console.log((fail ? 'FAIL ' : 'ok   ') + JSON.stringify(r));
}
console.log(bad === 0 ? 'NAV OK' : `NAV PROBLEM in ${bad} zones`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
