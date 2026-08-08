// Plays the game for real: a bot drives the same input path a thumb would,
// so this verifies balance and completability, not just that code runs.
//   node tools/autoplay.mjs <outPrefix> [--class ritter] [--acts 5] [--budget 150]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const prefix = args[0] || '/tmp/auto';
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const CLS = flag('class', 'ritter');
const ACTS = +flag('acts', 5);
const START_ACT = +flag('startAct', 0);
const START_LEVEL = +flag('startLevel', 0);
const BUDGET = +flag('budget', 150); // seconds of wall time per act
const W = +flag('w', 904);
const H = +flag('h', 407);
const DPR = +flag('dpr', 3);
const PORT = +flag('port', 8099);
const SPEED = +flag('speed', 1);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: DPR,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '').split('\n')[1]));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text());
});

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
  timeout: 60000,
});

// Expose the loot factory so a mid-campaign start can be geared realistically.
await page.evaluate(async () => {
  const loot = await import('/src/game/loot.js');
  const { RNG } = await import('/src/core/rng.js');
  const rng = new RNG(4242);
  window.__makeItem = (o) => loot.makeItem({ rng, ...o });
});

await page.evaluate(
  ([cls, speed, startAct, startLevel]) => {
    const g = window.__game;
    g.newRun(cls, 20260808);
    if (startLevel) {
      // Kit the character out the way a real run would have by this point.
      g.player.level = startLevel;
      g.recompute();
      for (const slot of ['weapon', 'offhand', 'head', 'chest', 'hands', 'feet', 'ring', 'amulet']) {
        const it = window.__makeItem({ ilvl: startLevel, slot, minRarity: 'rare' });
        if (it) g.equip(it, true);
      }
      g.recompute();
      g.player.hp = g.stats.maxLife;
      g.player.resource = g.stats.maxResource;
    }
    if (startAct) g.loadAct(startAct);
    const inp = window.__input;

    // Bot state, driven from the game loop through the normal input surface.
    const bot = {
      mx: 0,
      my: 0,
      mag: 0,
      deaths: 0,
      stuckT: 0,
      evade: 0,
      evadeA: 0,
      lastX: 0,
      lastY: 0,
      log: [],
    };
    window.__bot = bot;

    inp.update = function () {
      this.move.x = bot.mx;
      this.move.y = bot.my;
      this.move.mag = bot.mag;
    };

    const ISO_Y = 0.62;

    // --- coarse grid pathfinding ------------------------------------------
    // Reactive steering walks into every concave obstacle it meets, so the bot
    // plans a route over a walkability grid rebuilt once per act.
    const STEP = 40;
    const grid = { act: -1, n: 0, open: null, half: 0 };
    const buildGrid = () => {
      const z = g.zone;
      const half = z.half;
      const n = Math.ceil((half * 2) / STEP);
      const open = new Uint8Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          open[j * n + i] = z.blocked(-half + i * STEP, -half + j * STEP, 26) ? 0 : 1;
        }
      }
      grid.act = g.actIndex;
      grid.n = n;
      grid.open = open;
      grid.half = half;
    };

    const cellOf = (v) => Math.round((v + grid.half) / STEP);
    const worldOf = (i) => -grid.half + i * STEP;

    const findPath = (tx, ty) => {
      if (grid.act !== g.actIndex || !grid.open) buildGrid();
      const n = grid.n;
      const open = grid.open;
      const idx = (i, j) => j * n + i;
      const clampC = (v) => Math.max(0, Math.min(n - 1, v));
      const si = clampC(cellOf(g.player.x));
      const sj = clampC(cellOf(g.player.y));
      let ti = clampC(cellOf(tx));
      let tj = clampC(cellOf(ty));
      // Nudge an unreachable goal to the nearest open cell.
      if (!open[idx(ti, tj)]) {
        let best = null;
        let bd = 1e9;
        for (let r = 1; r < 8 && !best; r++) {
          for (let dj = -r; dj <= r; dj++) {
            for (let di = -r; di <= r; di++) {
              const a = clampC(ti + di);
              const b = clampC(tj + dj);
              if (!open[idx(a, b)]) continue;
              const d = di * di + dj * dj;
              if (d < bd) {
                bd = d;
                best = [a, b];
              }
            }
          }
        }
        if (best) [ti, tj] = best;
      }
      const prev = new Int32Array(n * n).fill(-1);
      const seen = new Uint8Array(n * n);
      const q = [idx(si, sj)];
      seen[q[0]] = 1;
      let head = 0;
      const goal = idx(ti, tj);
      while (head < q.length) {
        const cur = q[head++];
        if (cur === goal) break;
        const ci = cur % n;
        const cj = (cur / n) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const a = ci + di;
          const b = cj + dj;
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const k = idx(a, b);
          if (seen[k] || !open[k]) continue;
          seen[k] = 1;
          prev[k] = cur;
          q.push(k);
        }
      }
      if (!seen[goal]) return null;
      const out = [];
      let cur = goal;
      while (cur !== -1 && cur !== idx(si, sj)) {
        out.push({ x: worldOf(cur % n), y: worldOf((cur / n) | 0) });
        cur = prev[cur];
      }
      out.reverse();
      return out;
    };

    const steerRaw = (tx, ty, mag = 1) => {
      const dx = tx - g.player.x;
      const dy = (ty - g.player.y) * ISO_Y;
      const a = Math.atan2(dy, dx);
      bot.mx = Math.cos(a);
      bot.my = Math.sin(a);
      bot.mag = mag;
    };

    // Steers along a planned route, replanning when the goal moves or stalls.
    const steer = (tx, ty, mag = 1) => {
      const p = g.player;
      const near = Math.hypot(tx - p.x, ty - p.y) < 180;
      if (near) {
        bot.path = null;
        steerRaw(tx, ty, mag);
        return;
      }
      const moved = !bot.goal || Math.hypot(bot.goal.x - tx, bot.goal.y - ty) > 140;
      if (moved || !bot.path || bot.replan <= 0) {
        bot.goal = { x: tx, y: ty };
        bot.path = findPath(tx, ty);
        bot.replan = 2.5;
      }
      bot.replan -= 1 / 60;
      const path = bot.path;
      if (!path || !path.length) {
        steerRaw(tx, ty, mag);
        return;
      }
      while (path.length > 1 && Math.hypot(path[0].x - p.x, path[0].y - p.y) < STEP * 1.2) path.shift();
      steerRaw(path[0].x, path[0].y, mag);
    };

    let think = 0;
    const tick = () => {
      requestAnimationFrame(tick);
      if (g.state === 'dead') {
        bot.deaths++;
        bot.log.push(`died in act ${g.actIndex + 1} at level ${g.player.level}`);
        // Exactly what the "Wiederauferstehen" button does.
        window.__hud.panel = null;
        g.respawnPlayer();
        return;
      }
      if (g.state !== 'playing') return;
      const p = g.player;

      // Potion when hurt.
      if (p.hp < g.stats.maxLife * 0.45) g.drinkPotion();

      // Nearest live monster.
      let best = null;
      let bestD = 1e9;
      for (const m of g.monsters) {
        if (!m.alive) continue;
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }

      const skills = g.cls.skills;
      // Once the quota is met, only swat what is genuinely in the way.
      const engageRange = g.kills >= g.killQuota || g.portal ? 300 : 900;
      if (best && bestD < engageRange) {
        const reach = (best.radius || 20) + 60;
        if (bestD > reach) steer(best.x, best.y, 1);
        else {
          bot.mag = 0;
          p.facing = Math.atan2(best.y - p.y, best.x - p.x);
        }
        // Cycle through everything that is off cooldown.
        for (let i = skills.length - 1; i >= 0; i--) {
          if (g.canUse(skills[i])) {
            if (i === 0 && bestD > reach + 40 && g.cls.id === 'ritter') continue;
            g.useSkill(skills[i]);
            break;
          }
        }
      } else {
        // Head for loot, then the arena.
        let drop = null;
        let dd = 1e9;
        for (const d of g.drops) {
          if (d.picked) continue;
          const dist = Math.hypot(d.x - p.x, d.y - p.y);
          if (dist < 520 && dist < dd) {
            dd = dist;
            drop = d;
          }
        }
        if (g.portal) steer(g.portal.x, g.portal.y, 1);
        else if (drop) steer(drop.x, drop.y, 1);
        else if (g.kills >= g.killQuota) steer(g.zone.bossArena.x, g.zone.bossArena.y, 1);
        else {
          // Sweep the road looking for camps.
          think -= 1 / 60;
          if (think <= 0 || !bot.target) {
            think = 2.5;
            const road = g.zone.road;
            let pick = null;
            let pd = 1e9;
            for (const c of g.zone.camps) {
              if (c.triggered) continue;
              const d = Math.hypot(c.x - p.x, c.y - p.y);
              if (d < pd) {
                pd = d;
                pick = c;
              }
            }
            if (!pick) pick = road[Math.floor(Math.random() * road.length)];
            bot.target = pick;
          }
          steer(bot.target.x, bot.target.y, 1);
        }
      }

      // If the route still fails to produce motion, force a replan and, after
      // long enough, pick a different objective entirely.
      const moved = Math.hypot(p.x - bot.lastX, p.y - bot.lastY);
      bot.lastX = p.x;
      bot.lastY = p.y;
      if (moved < 0.6 && bot.mag > 0.1) {
        bot.stuckT += 1 / 60;
        if (bot.stuckT > 1.0) {
          bot.replan = 0;
          bot.path = null;
        }
        if (bot.stuckT > 5) {
          bot.stuckT = 0;
          bot.target = null;
          bot.goal = null;
          bot.mx = Math.cos(Math.random() * Math.PI * 2);
          bot.my = Math.sin(Math.random() * Math.PI * 2);
        }
      } else {
        bot.stuckT = 0;
      }
    };
    requestAnimationFrame(tick);
  },
  [CLS, SPEED, START_ACT, START_LEVEL]
);

const snapshot = () =>
  page.evaluate(() => {
    const g = window.__game;
    return {
      state: g.state,
      act: g.actIndex,
      actName: g.act?.name,
      kills: g.kills,
      quota: g.killQuota,
      level: g.player.level,
      hp: Math.round(g.player.hp),
      maxHp: g.stats.maxLife,
      gold: g.player.gold,
      inv: g.player.inventory.length,
      boss: g.boss ? Math.round((g.boss.hp / g.boss.maxHp) * 100) + '%' : null,
      bossDead: g.bossDead,
      portal: !!g.portal,
      deaths: window.__bot.deaths,
      monsters: g.monsters.length,
      fps: +(1000 / window.__renderer.frameMs).toFixed(1),
      scale: +window.__renderer.renderScale.toFixed(2),
      q: window.__renderer.quality,
    };
  });

const report = [];
let lastAct = -1;
const t0 = Date.now();
let actStart = Date.now();

for (let i = 0; i < 400 * ACTS; i++) {
  await page.waitForTimeout(1000);
  const s = await snapshot();
  if (s.act !== lastAct) {
    if (lastAct >= 0) {
      report.push({ act: lastAct + 1, seconds: Math.round((Date.now() - actStart) / 1000), ...prev });
      await page.screenshot({ path: `${prefix}-act${lastAct + 1}-end.png` });
    }
    lastAct = s.act;
    actStart = Date.now();
    await page.screenshot({ path: `${prefix}-act${s.act + 1}-start.png` });
  }
  if (s.boss) await page.screenshot({ path: `${prefix}-act${s.act + 1}-boss.png` });
  var prev = s;
  if (i % 15 === 0) console.log(JSON.stringify(s));
  if (s.state === 'victory') {
    console.log('VICTORY after', Math.round((Date.now() - t0) / 1000), 's');
    await page.screenshot({ path: `${prefix}-victory.png` });
    break;
  }
  if ((Date.now() - actStart) / 1000 > BUDGET) {
    console.log(`!! act ${s.act + 1} exceeded budget`, JSON.stringify(s));
    break;
  }
  if (s.act >= ACTS) break;
}

console.log('REPORT', JSON.stringify(report, null, 1));
console.log('FINAL', JSON.stringify(await snapshot()));
if (errors.length) console.log('ERRORS', errors.slice(0, 10));
await browser.close();
