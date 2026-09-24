// Validate content/manifest.json against spec/textures.json before running the game.
// Checks file existence, PNG size, atlas frame names and frame sizes, and audio names/formats.
// Usage: node games/iron-raid/tools/check-content.mjs [content-dir]
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME = fileURLToPath(new URL('..', import.meta.url));
const dir = resolve(process.argv[2] || resolve(GAME, 'content'));
const spec = JSON.parse(readFileSync(resolve(GAME, 'spec/textures.json'), 'utf8'));
const TILE_KEYS = new Set(['far', 'mid', 'ground', 'dock', 'water_0', 'water_1']);
const SFX = ['pistol', 'rifle', 'shotgun', 'rocket', 'vulcan', 'cannon', 'enemyShot', 'boom', 'bigBoom', 'hit', 'clank',
  'knife', 'throw', 'pickup', 'weapon', 'scream', 'die', 'thanks', 'enter', 'alarm', 'start'];
const BGM = ['stage', 'boss'];
const AUDIO_EXT = new Set(['.ogg', '.mp3', '.wav', '.m4a']);

const errors = [];
const ok = [];
const err = (m) => errors.push(m);

function pngSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

const manifestPath = resolve(dir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`no manifest at ${manifestPath}`);
  process.exit(1);
}
const m = JSON.parse(readFileSync(manifestPath, 'utf8'));

for (const [key, e] of Object.entries(m.sprites || {})) {
  const s = spec[key];
  if (!s) { err(`sprites.${key}: unknown texture key`); continue; }
  const img = resolve(dir, e.image || '');
  if (!e.image || !existsSync(img)) { err(`sprites.${key}: image not found (${e.image})`); continue; }
  let size;
  try { size = pngSize(img); } catch (x) { err(`sprites.${key}: ${x.message}`); continue; }
  if (size.colorType !== 6 && size.colorType !== 3) err(`sprites.${key}: PNG should be RGBA (or indexed with transparency)`);
  if (s.frames) {
    if (!e.atlas) { err(`sprites.${key}: needs "atlas" (${s.frames.length} frames)`); continue; }
    const ap = resolve(dir, e.atlas);
    if (!existsSync(ap)) { err(`sprites.${key}: atlas not found (${e.atlas})`); continue; }
    const atlas = JSON.parse(readFileSync(ap, 'utf8'));
    const frames = atlas.frames || {};
    const missing = s.frames.filter((n) => !frames[n]);
    if (missing.length) err(`sprites.${key}: missing ${missing.length} frames, e.g. ${missing.slice(0, 6).join(', ')}`);
    for (const n of s.frames) {
      const f = frames[n];
      if (!f) continue;
      const src = f.sourceSize || f.frame;
      if (src.w !== s.frameWidth || src.h !== s.frameHeight) { err(`sprites.${key}: frame "${n}" is ${src.w}x${src.h}, expected ${s.frameWidth}x${s.frameHeight}`); break; }
      const r = f.frame;
      if (r.x + r.w > size.w || r.y + r.h > size.h) { err(`sprites.${key}: frame "${n}" lies outside the ${size.w}x${size.h} image`); break; }
    }
    if (!errors.some((x) => x.startsWith(`sprites.${key}:`))) ok.push(`${key} (${s.frames.length} frames)`);
  } else {
    const wOk = TILE_KEYS.has(key) || size.w === s.width;
    if (!wOk || size.h !== s.height) err(`sprites.${key}: image is ${size.w}x${size.h}, expected ${TILE_KEYS.has(key) ? `any x ${s.height}` : `${s.width}x${s.height}`}`);
    else ok.push(key);
  }
}

const audio = (group, names, entries) => {
  for (const [name, file] of Object.entries(entries || {})) {
    if (!names.includes(name)) { err(`${group}.${name}: unknown name (valid: ${names.join(', ')})`); continue; }
    const p = resolve(dir, file);
    if (!existsSync(p)) { err(`${group}.${name}: file not found (${file})`); continue; }
    if (!AUDIO_EXT.has(extname(p).toLowerCase())) { err(`${group}.${name}: use .ogg, .mp3, .wav or .m4a`); continue; }
    ok.push(`${group}.${name}`);
  }
};
audio('sfx', SFX, m.sfx);
audio('bgm', BGM, m.bgm);

console.log(`checked ${manifestPath}`);
if (ok.length) console.log(`OK (${ok.length}): ${ok.join(', ')}`);
if (errors.length) {
  console.log(`\nPROBLEMS (${errors.length}) — these fall back to the built-in placeholder:`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log(ok.length ? 'all entries valid' : 'manifest is empty: the game uses built-in placeholders');
