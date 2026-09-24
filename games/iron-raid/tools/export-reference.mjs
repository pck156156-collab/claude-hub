// Dump every placeholder texture the game generates as PNG (+ Phaser JSON-hash atlas for
// multi-frame textures) into content-reference/, plus spec/textures.json.
// These files are the exact format content/ accepts: copy one, redraw it, list it in the manifest.
// Usage: node games/iron-raid/tools/export-reference.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const GAME = new URL('..', import.meta.url);
const REF = new URL('content-reference/', GAME);
const SPEC = new URL('spec/', GAME);

// Origin (pivot) each texture is drawn with in the game, as fractions of the frame.
export const ORIGINS = {
  player: [0.5, 1], soldier: [0.5, 1], pow: [0.5, 1], tank: [0.5, 1], apc: [0.5, 1],
  heli: [0.5, 0.5], vulcan: [0.1, 0.5], boss_hull: [0, 0], boss_armor: [0, 0], boss_core: [0, 0],
  boss_cannon: [0.7, 0.6], boss_door: [0, 0], sky: [0, 0], far: [0, 0], mid: [0, 0], ground: [0, 0],
  dock: [0, 0], water_0: [0, 0], water_1: [0, 0], hut: [0.5, 1], palm: [0.5, 1], sandbags: [0.5, 1],
  crate: [0, 1], barrel: [0.5, 1], campfire: [0.5, 1], sgblast: [0.05, 0.5], splash: [0.5, 1],
};

rmSync(REF, { recursive: true, force: true });
mkdirSync(new URL('sprites/', REF), { recursive: true });
mkdirSync(SPEC, { recursive: true });

const server = await createServer({ logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage();
await page.goto(`${server.resolvedUrls.local[0]}games/iron-raid/`);
await page.waitForFunction(() => window.__IR_KEYS && window.game.scene.isActive('title'), null, { timeout: 20000 });
const dump = await page.evaluate(() => window.__IR_KEYS.map((key) => {
  const tex = window.game.textures.get(key);
  const src = tex.getSourceImage();
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  const frames = tex.getFrameNames().map((n) => { const f = tex.get(n); return { n, x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight }; });
  return { key, w: src.width, h: src.height, png: c.toDataURL('image/png'), frames };
}));
await browser.close();
await server.close();

const spec = {};
const manifest = { version: 1, sprites: {}, sfx: {}, bgm: {} };
for (const t of dump) {
  const file = `sprites/${t.key}.png`;
  writeFileSync(new URL(file, REF), Buffer.from(t.png.split(',')[1], 'base64'));
  const origin = ORIGINS[t.key] || [0.5, 0.5];
  if (t.frames.length) {
    const atlas = {
      frames: Object.fromEntries(t.frames.map((f) => [f.n, {
        frame: { x: f.x, y: f.y, w: f.w, h: f.h }, rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h },
      }])),
      meta: { app: 'iron-raid export-reference', image: `${t.key}.png`, size: { w: t.w, h: t.h }, scale: '1', origin },
    };
    writeFileSync(new URL(`sprites/${t.key}.json`, REF), JSON.stringify(atlas, null, 1));
    manifest.sprites[t.key] = { image: file, atlas: `sprites/${t.key}.json` };
    spec[t.key] = { frameWidth: t.frames[0].w, frameHeight: t.frames[0].h, origin, frames: t.frames.map((f) => f.n) };
  } else {
    manifest.sprites[t.key] = { image: file };
    spec[t.key] = { width: t.w, height: t.h, origin };
  }
}
writeFileSync(new URL('manifest.example.json', REF), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(new URL('textures.json', SPEC), JSON.stringify(spec, null, 1) + '\n');
console.log(`exported ${dump.length} textures -> ${REF.pathname}`);
