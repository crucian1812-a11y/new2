// Drives the real game in a headless Chromium with Poco X7 Pro-ish metrics.
//   node tools/play.mjs <outPrefix> [--script boot|fight|full] [--w..] [--h..]
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const prefix = args[0] || '/tmp/shot';
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const SCRIPT = flag('script', 'boot');
const W = +flag('w', 904);
const H = +flag('h', 407);
const DPR = +flag('dpr', 3);
const PORT = +flag('port', 8099);

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: DPR,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 15; 24122RKC7G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 5).join('\n')}`));

const shot = async (name) => {
  await page.screenshot({ path: `${prefix}-${name}.png` });
};

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
// Wait for the loader to finish.
await page.waitForFunction(() => document.getElementById('loader')?.classList.contains('hidden'), null, {
  timeout: 60000,
}).catch(() => logs.push('[warn] loader did not hide in time'));
await page.waitForTimeout(700);
await shot('menu');

// Instrument an FPS probe.
await page.evaluate(() => {
  window.__fps = { frames: 0, start: performance.now(), worst: 0, last: performance.now() };
  const tick = () => {
    const n = performance.now();
    const d = n - window.__fps.last;
    window.__fps.last = n;
    if (window.__fps.frames > 5) window.__fps.worst = Math.max(window.__fps.worst, d);
    window.__fps.frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const tap = async (x, y) => {
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(120);
};

// Start a run as the knight.
await page.evaluate(() => window.__game.newRun('ritter', 12345));
await page.waitForTimeout(1400);
await shot('start');

async function holdStick(dx, dy, ms) {
  const cx = W * 0.2;
  const cy = H * 0.72;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

if (SCRIPT === 'fight' || SCRIPT === 'full') {
  // Teleport monsters next to the player and swing at them.
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.spawnMonster(g.act.monsters[i % g.act.monsters.length], g.player.x + Math.cos(a) * 170, g.player.y + Math.sin(a) * 170, {
        elite: i === 0,
      });
    }
  });
  await page.waitForTimeout(600);
  await shot('monsters');

  // Primary attack via keyboard.
  for (let i = 0; i < 14; i++) {
    await page.keyboard.down('f');
    await page.waitForTimeout(180);
    await page.keyboard.up('f');
    await page.waitForTimeout(90);
  }
  await shot('combat');

  await page.evaluate(() => (window.__game.player.level = 12));
  await page.evaluate(() => window.__game.recompute());
  await page.keyboard.press('2');
  await page.waitForTimeout(400);
  await shot('skill2');
  await page.keyboard.press('3');
  await page.waitForTimeout(500);
  await shot('skill3');
  await page.keyboard.press('4');
  await page.waitForTimeout(500);
  await shot('skill4');

  // Bag
  await page.keyboard.press('i');
  await page.waitForTimeout(400);
  await shot('bag');
  await page.keyboard.press('i');
  await page.waitForTimeout(200);
}

if (SCRIPT === 'full') {
  // Walk through all five acts, killing the quota by script and beating bosses.
  const report = [];
  for (let act = 0; act < 5; act++) {
    const info = await page.evaluate(async (actIdx) => {
      const g = window.__game;
      const out = { act: actIdx, name: g.act.name };
      // Grant the kill quota, then walk into the arena.
      g.kills = g.killQuota;
      g.player.level = Math.min(40, 6 + actIdx * 7);
      g.recompute();
      g.player.hp = g.stats.maxLife;
      g.player.x = g.zone.bossArena.x;
      g.player.y = g.zone.bossArena.y + 200;
      return out;
    }, act);
    await page.waitForTimeout(900);
    await shot('act' + (act + 1));
    // Kill the boss.
    const bossOk = await page.evaluate(() => {
      const g = window.__game;
      if (!g.boss) return false;
      g.damageMonster(g.boss, g.boss.maxHp * 2, {});
      return true;
    });
    report.push({ ...info, bossSpawned: bossOk });
    await page.waitForTimeout(900);
    await shot('act' + (act + 1) + '-boss');
    // Step into the portal.
    await page.evaluate(() => {
      const g = window.__game;
      if (g.portal) {
        g.player.x = g.portal.x;
        g.player.y = g.portal.y;
        g.portal.t = 2;
      }
    });
    await page.waitForTimeout(1200);
  }
  await shot('victory');
  logs.push('ACTS: ' + JSON.stringify(report));
}

const stats = await page.evaluate(() => {
  const f = window.__fps;
  const g = window.__game;
  return {
    avgFps: +(f.frames / ((performance.now() - f.start) / 1000)).toFixed(1),
    worstFrameMs: +f.worst.toFixed(1),
    renderScale: +window.__renderer.renderScale.toFixed(2),
    state: g.state,
    act: g.actIndex,
    level: g.player?.level,
    hp: Math.round(g.player?.hp),
    monsters: g.monsters.length,
    kills: g.kills,
    inventory: g.player?.inventory.length,
  };
});

console.log(JSON.stringify({ stats, logs: logs.slice(0, 40) }, null, 2));
await browser.close();
