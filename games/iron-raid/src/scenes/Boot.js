import * as Phaser from 'phaser';
import { buildHumans } from '../art/humans.js';
import { buildVehicles } from '../art/vehicles.js';
import { buildWorld } from '../art/world.js';
import { loadSample, SFX_NAMES, BGM_NAMES } from '../sfx.js';

// External content lives next to the page: content/manifest.json lists files that
// replace the procedural placeholders. Anything missing or invalid keeps the placeholder.
export const CONTENT = './content/';
// Tiling textures: any width is fine, the height must match.
const TILE_KEYS = new Set(['far', 'mid', 'ground', 'dock', 'water_0', 'water_1']);

export class Boot extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    this.load.json('manifest', `${CONTENT}manifest.json`);
  }

  create() {
    // 1. Procedural placeholders for every texture the game uses.
    buildWorld(this);
    buildHumans(this);
    buildVehicles(this);

    window.__IR_KEYS = this.textures.getTextureKeys().filter((k) => !k.startsWith('__'));
    const report = { applied: [], rejected: [], audio: [], audioFailed: [] };
    window.__IR_CONTENT = report;
    const m = this.cache.json.get('manifest') || {};

    // 2. Queue sprite overrides under a temporary key.
    const pending = [];
    for (const [key, e] of Object.entries(m.sprites || {})) {
      if (!this.textures.exists(key)) { report.rejected.push({ key, reason: 'unknown texture key' }); continue; }
      if (!e || !e.image) { report.rejected.push({ key, reason: 'missing "image"' }); continue; }
      const tmp = `ext:${key}`;
      if (e.atlas) this.load.atlas(tmp, CONTENT + e.image, CONTENT + e.atlas);
      else this.load.image(tmp, CONTENT + e.image);
      pending.push(key);
    }
    this.load.on('loaderror', (file) => report.rejected.push({ key: String(file.key).replace(/^ext:/, ''), reason: `load failed: ${file.src}` }));

    // 3. Audio overrides decode in parallel.
    const audioJobs = [];
    const addAudio = (name, url) => audioJobs.push(loadSample(name, CONTENT + url)
      .then(() => report.audio.push(name))
      .catch((err) => report.audioFailed.push({ name, reason: String(err.message || err) })));
    for (const [name, url] of Object.entries(m.sfx || {})) {
      if (SFX_NAMES.includes(name)) addAudio(name, url); else report.audioFailed.push({ name, reason: 'unknown sfx name' });
    }
    for (const [name, url] of Object.entries(m.bgm || {})) {
      if (BGM_NAMES.includes(name)) addAudio(`bgm_${name}`, url); else report.audioFailed.push({ name, reason: 'unknown bgm name' });
    }

    this.load.once('complete', async () => {
      for (const key of pending) this.applyOverride(key, report);
      await Promise.all(audioJobs);
      if (report.applied.length || report.rejected.length || report.audio.length || report.audioFailed.length) {
        console.info('[content]', JSON.stringify(report));
      }
      for (const r of report.rejected) console.warn(`[content] kept placeholder for "${r.key}": ${r.reason}`);
      for (const r of report.audioFailed) console.warn(`[content] kept synth sound for "${r.name}": ${r.reason}`);
      this.scene.start(new URLSearchParams(location.search).has('play') ? 'game' : 'title');
    });
    this.load.start();
  }

  // Swap in a loaded texture if its frames match the placeholder's names and sizes.
  applyOverride(key, report) {
    const tmp = `ext:${key}`;
    if (!this.textures.exists(tmp)) return; // load error already reported
    const old = this.textures.get(key);
    const neu = this.textures.get(tmp);
    const reject = (reason) => { report.rejected.push({ key, reason }); this.textures.remove(tmp); };
    const oldNames = old.getFrameNames();
    if (oldNames.length) {
      const missing = oldNames.filter((n) => !neu.has(n));
      if (missing.length) return reject(`missing frames: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` (+${missing.length - 8})` : ''}`);
      const ref = old.get(oldNames[0]);
      const bad = oldNames.find((n) => { const f = neu.get(n); return f.realWidth !== ref.realWidth || f.realHeight !== ref.realHeight; });
      if (bad) { const f = neu.get(bad); return reject(`frame "${bad}" is ${f.realWidth}x${f.realHeight}, expected ${ref.realWidth}x${ref.realHeight}`); }
    } else {
      const a = old.get();
      const b = neu.get();
      const okW = TILE_KEYS.has(key) || a.width === b.width;
      if (!okW || a.height !== b.height) return reject(`image is ${b.width}x${b.height}, expected ${TILE_KEYS.has(key) ? `any x ${a.height}` : `${a.width}x${a.height}`}`);
    }
    this.textures.remove(key);
    this.textures.renameTexture(tmp, key);
    report.applied.push(key);
  }
}
