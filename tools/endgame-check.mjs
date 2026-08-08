// Verifies the two endings: the victory screen after Perkūnas, and the
// Eternal Hunt loop that restarts the campaign at higher difficulty.
import { chromium } from 'playwright';

const PORT = +(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8099);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await (
  await browser.newContext({ viewport: { width: 904, height: 407 }, deviceScaleFactor: 2, hasTouch: true })
).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, { timeout: 60000 });

const out = await page.evaluate(async () => {
  const g = window.__game;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const res = {};

  g.newRun('hexer', 31337);
  g.loadAct(4);
  g.player.level = 38;
  g.recompute();
  g.kills = g.killQuota;
  g.player.x = g.zone.bossArena.x;
  g.player.y = g.zone.bossArena.y + 120;
  await wait(500);
  res.finalBossSpawned = !!g.boss;
  if (g.boss) g.damageMonster(g.boss, 1e9, {});
  await wait(600);
  res.portalIsLast = g.portal?.last === true;
  if (g.portal) {
    g.player.x = g.portal.x;
    g.player.y = g.portal.y;
    g.portal.t = 2;
  }
  await wait(900);
  res.stateAfterFinalBoss = g.state;

  // Eternal Hunt, as the victory screen's button triggers it.
  g.endless = true;
  g.difficulty *= 1.55;
  g.loadAct(0);
  g.state = 'playing';
  await wait(700);
  res.endlessAct = g.actIndex;
  res.endlessDifficulty = +g.difficulty.toFixed(2);
  const m = g.spawnMonster(g.act.monsters[0], g.player.x + 200, g.player.y, {});
  res.endlessMonsterHp = m ? m.maxHp : 0;

  // And that a loop of the last act in endless mode wraps rather than ending.
  g.loadAct(4);
  g.kills = g.killQuota;
  g.player.x = g.zone.bossArena.x;
  g.player.y = g.zone.bossArena.y + 120;
  await wait(500);
  if (g.boss) g.damageMonster(g.boss, 1e9, {});
  await wait(600);
  res.endlessPortalIsLast = g.portal?.last === true;
  if (g.portal) {
    g.player.x = g.portal.x;
    g.player.y = g.portal.y;
    g.portal.t = 2;
  }
  await wait(900);
  res.wrappedToAct = g.actIndex;
  res.wrappedDifficulty = +g.difficulty.toFixed(2);
  res.stateAtEnd = g.state;
  return res;
});

console.log(JSON.stringify(out, null, 2));
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
const ok =
  out.finalBossSpawned &&
  out.portalIsLast &&
  out.stateAfterFinalBoss === 'victory' &&
  out.endlessAct === 0 &&
  out.endlessDifficulty > 1 &&
  out.endlessMonsterHp > 0 &&
  out.endlessPortalIsLast === false &&
  out.wrappedToAct === 0 &&
  out.wrappedDifficulty > out.endlessDifficulty &&
  out.stateAtEnd === 'playing' &&
  errors.length === 0;
console.log(ok ? 'ENDGAME OK' : 'ENDGAME PROBLEM');
await browser.close();
process.exit(ok ? 0 : 1);
