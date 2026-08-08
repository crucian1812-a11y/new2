// Fires every skill of every class, and every boss ability, at a live world
// and reports any exception. These paths are easy to leave untested.
import { chromium } from 'playwright';

const PORT = +(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8099);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (
  await browser.newContext({ viewport: { width: 904, height: 407 }, deviceScaleFactor: 2, hasTouch: true })
).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + ' | ' + (e.stack || '').split('\n')[1]));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text());
});

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
  timeout: 60000,
});

const results = [];

for (const cls of ['ritter', 'jaegerin', 'hexer']) {
  for (let act = 0; act < 5; act++) {
    const r = await page.evaluate(
      async ([c, a]) => {
        const g = window.__game;
        g.newRun(c, 4242 + a);
        g.loadAct(a);
        g.player.level = 40;
        g.recompute();
        g.player.hp = g.stats.maxLife;
        g.player.resource = g.stats.maxResource;
        const out = { cls: c, act: a, used: [], failed: [] };
        // Something to shoot at.
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * Math.PI * 2;
          g.spawnMonster(g.act.monsters[i % g.act.monsters.length], g.player.x + Math.cos(ang) * 150, g.player.y + Math.sin(ang) * 150, { elite: i === 0 });
        }
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        for (const id of g.cls.skills) {
          try {
            g.player.cds = {};
            g.player.resource = g.stats.maxResource;
            g.player.anim = 'idle';
            g.player.animDur = 0;
            const ok = g.useSkill(id);
            out.used.push(id + (ok ? '' : ':refused'));
          } catch (e) {
            out.failed.push(id + ': ' + e.message);
          }
          await wait(420);
        }
        // Potion, dash-through-death, shrine, chest.
        try {
          g.drinkPotion();
          if (g.zone.shrines[0]) g.useShrine(g.zone.shrines[0]);
          if (g.zone.chests[0]) g.openChest(g.zone.chests[0]);
        } catch (e) {
          out.failed.push('world: ' + e.message);
        }
        await wait(300);
        return out;
      },
      [cls, act]
    );
    results.push(r);
  }
}

// Every boss and every ability.
for (const bossAct of [0, 1, 2, 3, 4]) {
  const r = await page.evaluate(
    async (a) => {
      const g = window.__game;
      g.newRun('ritter', 777 + a);
      g.loadAct(a);
      g.player.level = 40;
      g.recompute();
      g.kills = g.killQuota;
      g.player.x = g.zone.bossArena.x;
      g.player.y = g.zone.bossArena.y + 150;
      const out = { boss: g.act.boss, act: a, abilities: [], failed: [] };
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      await wait(400);
      if (!g.boss) {
        out.failed.push('boss did not spawn');
        return out;
      }
      for (const ab of g.boss.def.abilities || []) {
        try {
          g.bossAbility(g.boss, ab);
          out.abilities.push(ab);
        } catch (e) {
          out.failed.push(ab + ': ' + e.message);
        }
        await wait(700);
      }
      // Phase 3 behaviour, then kill it and take the portal.
      g.boss.hp = g.boss.maxHp * 0.2;
      await wait(600);
      g.damageMonster(g.boss, 1e9, {});
      await wait(600);
      out.bossDead = g.bossDead;
      out.portal = !!g.portal;
      if (g.portal) {
        g.player.x = g.portal.x;
        g.player.y = g.portal.y;
        g.portal.t = 2;
        await wait(900);
      }
      out.nextAct = g.actIndex;
      out.state = g.state;
      return out;
    },
    bossAct
  );
  results.push(r);
}

let bad = 0;
for (const r of results) {
  if (r.failed?.length) bad++;
  console.log(JSON.stringify(r));
}
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.slice(0, 12).join('\n') : 'no page errors');
console.log(bad === 0 && errors.length === 0 ? 'SKILLS OK' : 'SKILLS PROBLEM');
await browser.close();
process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
