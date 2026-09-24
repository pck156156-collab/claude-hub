// Automated playthrough: holds right, shoots, jumps, and screenshots along the way.
// Usage: node games/iron-raid/playtest.mjs <outdir> [--god] [--seconds 150]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args[0] || 'playtest-out';
const god = args.includes('--god');
const si = args.indexOf('--seconds');
const seconds = si >= 0 ? Number(args[si + 1]) : 150;
mkdirSync(out, { recursive: true });

const server = await createServer({ logLevel: 'silent' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}games/iron-raid/?play`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1152, height: 648 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('favicon.ico') && errors.push(`${r.status()} ${r.url()}`));
await page.goto(url);
await page.waitForFunction(() => window.__IR && window.__IR.player, null, { timeout: 15000 });

const state = () => page.evaluate(() => {
  const s = window.__IR;
  if (!s || !s.player || !s.sys.isActive()) return { scene: window.game.scene.getScenes(true).map((x) => x.sys.settings.key).join(','), result: window.__IR_RESULT || null };
  const p = s.player;
  return {
    x: Math.round((p.tank || p).x), y: Math.round((p.tank || p).y), cam: Math.round(s.cameras.main.scrollX),
    score: s.score, lives: s.lives, dead: p.dead, tank: !!p.tank, weapon: p.weapon, ammo: p.ammo, bombs: p.bombs,
    enemies: s.enemies.filter((e) => !e.dead).length, rescued: s.rescued, lock: !!s.lockSpawns,
    lockList: s.lockSpawns ? s.lockSpawns.list.filter((e) => e.active && !e.dead).map((e) => `${e.kind}@${Math.round(e.x)},${Math.round(e.y)}:${e.state}`).join(' ') : '',
    boss: s.boss ? { phase: s.boss.phase, armor: s.boss.armorHp, core: s.boss.coreHp, dead: s.boss.dead } : null,
    over: !!s.over, cleared: !!s.cleared, result: window.__IR_RESULT || null,
    scene: window.game.scene.getScenes(true).map((x) => x.sys.settings.key).join(','),
  };
});

let shot = 0;
const snap = async (tag) => { await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-${tag}.png` }); };

const wi = args.indexOf('--warp');
if (wi >= 0) {
  const wx = Number(args[wi + 1]);
  await page.evaluate((wx) => {
    const s = window.__IR;
    s.events_.forEach((e) => { if (e.x < wx && e.type !== 'boss') e.done = true; });
    s.enemies.forEach((e) => { if (e.x < wx + 100) e.destroy(); });
    s.player.x = wx;
    s.cameras.main.scrollX = wx - 150;
  }, wx);
}
await snap('start');
const t0 = Date.now();
let lastSnap = 0;
let i = 0;
while ((Date.now() - t0) / 1000 < seconds) {
  i += 1;
  const phase = i % 20;
  await page.evaluate(({ phase, god }) => {
    const s = window.__IR;
    if (!s || !s.virtual || !s.sys.isActive()) return;
    const v = s.virtual;
    if (god && s.player) s.player.invuln = Math.max(s.player.invuln, 0.2);
    if (god && s.player && s.player.tank) s.player.tank.hp = 3;
    v.right = true;
    v.left = false;
    v.down = false;
    v.jump = phase === 5 || phase === 6;
    if (s.lockSpawns || (s.boss && !s.boss.dead)) {
      const p = s.player.tank || s.player;
      const cam = s.cameras.main;
      const foes = s.enemies.filter((e) => !e.dead && e.active && e.x > cam.scrollX && e.x < cam.scrollX + 384);
      const near = foes.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
      if (near) {
        const dx = near.x - p.x;
        v.right = dx > 0;
        v.left = dx < 0;
        // hold position when at a comfortable range, just keep facing
        if (Math.abs(dx) > 30 && Math.abs(dx) < 90 && phase % 3) { v.right = false; v.left = false; }
        // get off roofs when the target is below
        if (near.y - p.y > 20 && phase % 4 === 0) { v.down = true; v.jump = true; }
      } else v.right = true;
    }
    v.fire = phase % 2 === 0;
    v.up = phase >= 12 && phase < 15;
    v.bomb = phase === 10;
    if (s.over) v.fire = phase % 2 === 0;
  }, { phase, god });
  await page.waitForTimeout(100);
  const el = (Date.now() - t0) / 1000;
  if (el - lastSnap > 8) {
    lastSnap = el;
    const st = await state();
    console.log(JSON.stringify({ t: Math.round(el), ...st }));
    await snap(`t${Math.round(el)}`);
    if (st.scene === 'result' || st.result) break;
  }
}
const final = await state();
console.log('FINAL', JSON.stringify(final));
await snap('end');
await browser.close();
await server.close();
if (errors.length) {
  console.error('ERRORS:\n' + [...new Set(errors)].join('\n'));
  process.exit(1);
}
