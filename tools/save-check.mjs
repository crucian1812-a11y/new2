// Verifies a run survives a page reload: progress, save, reload, continue,
// and confirm level, gear, gold and act all came back.
import { chromium } from 'playwright';

const PORT = +(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8099);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 904, height: 407 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const ready = () =>
  page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
    timeout: 60000,
  });

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
await ready();

const before = await page.evaluate(async () => {
  const g = window.__game;
  g.newRun('hexer', 5150);
  g.loadAct(2);
  g.player.level = 17;
  g.player.gold = 12345;
  g.recompute();
  // Some real loot in the bags and on the body.
  const { makeItem } = await import('/src/game/loot.js');
  const { RNG } = await import('/src/core/rng.js');
  const rng = new RNG(9);
  for (let i = 0; i < 6; i++) g.player.inventory.push(makeItem({ rng, ilvl: 18, minRarity: 'magic' }));
  g.equip(makeItem({ rng, ilvl: 18, slot: 'chest', rarity: 'rare' }), true);
  g.player.totalKills = 321;
  g.save();
  return {
    level: g.player.level,
    gold: g.player.gold,
    act: g.actIndex,
    cls: g.classId,
    inv: g.player.inventory.length,
    chest: g.player.equipment.chest?.name,
    armor: Math.round(g.stats.armorTotal),
    kills: g.player.totalKills,
  };
});

// Full reload, as if the tab had been closed.
await page.reload({ waitUntil: 'load' });
await ready();

const after = await page.evaluate(() => {
  const g = window.__game;
  const had = g.hasSave();
  const ok = g.continueRun();
  return {
    hadSave: had,
    continued: ok,
    level: g.player.level,
    gold: g.player.gold,
    act: g.actIndex,
    cls: g.classId,
    inv: g.player.inventory.length,
    chest: g.player.equipment.chest?.name,
    armor: Math.round(g.stats.armorTotal),
    kills: g.player.totalKills,
    state: g.state,
    hp: Math.round(g.player.hp),
  };
});

console.log('before', JSON.stringify(before));
console.log('after ', JSON.stringify(after));

const keys = ['level', 'gold', 'act', 'cls', 'inv', 'chest', 'armor', 'kills'];
const mismatched = keys.filter((k) => String(before[k]) !== String(after[k]));
const ok =
  after.hadSave && after.continued && after.state === 'playing' && after.hp > 0 && mismatched.length === 0 && !errors.length;
if (mismatched.length) console.log('MISMATCH:', mismatched.join(', '));
if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
console.log(ok ? 'SAVE OK' : 'SAVE PROBLEM');
await browser.close();
process.exit(ok ? 0 : 1);
