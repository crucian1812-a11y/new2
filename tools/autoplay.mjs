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

await page.evaluate(
  ([cls, speed]) => {
    const g = window.__game;
    g.newRun(cls, 20260808);
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
    const steer = (tx, ty, mag = 1) => {
      const dx = tx - g.player.x;
      const dy = (ty - g.player.y) * ISO_Y;
      const l = Math.hypot(dx, dy) || 1;
      bot.mx = dx / l;
      bot.my = dy / l;
      bot.mag = mag;
    };

    let think = 0;
    const tick = () => {
      requestAnimationFrame(tick);
      if (g.state === 'dead') {
        bot.deaths++;
        bot.log.push(`died in act ${g.actIndex + 1} at level ${g.player.level}`);
        // Same button a player would press.
        window.__hud.panel = null;
        const p = g.player;
        p.gold = Math.floor(p.gold * 0.5);
        p.alive = true;
        p.anim = 'idle';
        p.hp = g.stats.maxLife * 0.6;
        p.invuln = 2.5;
        p.x = g.zone.start.x;
        p.y = g.zone.start.y;
        g.monsters.length = 0;
        g.state = 'playing';
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

      // Unstick: commit to a sidestep for a while, otherwise the steering
      // immediately walks back into the same tree.
      if (bot.evade > 0) {
        bot.evade -= 1 / 60;
        bot.mx = Math.cos(bot.evadeA);
        bot.my = Math.sin(bot.evadeA);
        bot.mag = 1;
      }
      const moved = Math.hypot(p.x - bot.lastX, p.y - bot.lastY);
      bot.lastX = p.x;
      bot.lastY = p.y;
      if (moved < 0.5 && bot.mag > 0.1) {
        bot.stuckT += 1 / 60;
        if (bot.stuckT > 0.7) {
          bot.stuckT = 0;
          bot.evade = 0.9;
          bot.evadeA = Math.atan2(bot.my, bot.mx) + (Math.random() < 0.5 ? 1.3 : -1.3);
          bot.target = null;
        }
      } else bot.stuckT = 0;
    };
    requestAnimationFrame(tick);
  },
  [CLS, SPEED]
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
