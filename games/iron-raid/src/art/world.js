// Backgrounds, terrain, props, projectiles, effects and items.
import { C } from '../palette.js';
import { rect, dot, ellipse, circle, line, poly, buildSheet, buildImage, rng } from '../gfx.js';
import { drawText } from '../font.js';

export const W = 384;
export const H = 216;
export const GROUND_Y = 196;

function palm(ctx, x, base, h, lean, r, cols) {
  const [trunk, trunkS, leaf, leafS] = cols;
  for (let i = 0; i < h; i++) {
    const tx = x + Math.round(lean * (i / h) ** 2);
    rect(ctx, tx - 2, base - i, 4, 1, i % 4 === 0 ? trunkS : trunk);
  }
  const topX = x + lean, topY = base - h;
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k - 2.5) * 0.62 + (r() - 0.5) * 0.2;
    const len = 14 + r() * 6;
    const ex = topX + Math.cos(a) * len, ey = topY + Math.sin(a) * len * 0.6 + 6;
    line(ctx, topX, topY, (topX + ex) / 2, Math.min(topY, ey) - 3, leaf, 3);
    line(ctx, (topX + ex) / 2, Math.min(topY, ey) - 3, ex, ey, leafS, 2);
  }
  circle(ctx, topX, topY + 2, 2, trunkS);
}

function hut(ctx, x, base, w, h, r) {
  rect(ctx, x + 3, base - h, w - 6, h, C.wood);
  for (let i = 0; i < w - 6; i += 4) rect(ctx, x + 3 + i, base - h, 1, h, C.woodS);
  rect(ctx, x + w / 2 - 4, base - 14, 8, 14, C.outline); // door
  rect(ctx, x + 7, base - h + 6, 6, 5, C.outline);
  poly(ctx, [[x - 4, base - h + 2], [x + w / 2, base - h - 14], [x + w + 4, base - h + 2]], C.thatch);
  for (let i = 0; i < w + 8; i += 3) line(ctx, x - 4 + i, base - h + 2, x + w / 2, base - h - 14 + r() * 3, C.thatchS, 1);
  rect(ctx, x - 4, base - h + 1, w + 8, 2, C.thatchS);
}

export function buildWorld(scene) {
  // ---------------- sky (static, banded)
  buildImage(scene, 'sky', W, H, (ctx) => {
    const bands = [C.sky0, C.sky1, C.sky2, C.sky3];
    for (let i = 0; i < 4; i++) rect(ctx, 0, i * 30, W, 30, bands[i]);
    for (let i = 0; i < 4; i++) for (let x = 0; x < W; x += 2) dot(ctx, x + (i % 2), (i + 1) * 30 - 1, bands[Math.min(3, i + 1)]);
    rect(ctx, 0, 120, W, H - 120, C.sky3);
    const r = rng(7);
    for (let k = 0; k < 6; k++) {
      const cx = r() * W, cy = 20 + r() * 60, s = 6 + r() * 8;
      for (let j = 0; j < 4; j++) ellipse(ctx, cx + j * s * 0.8, cy + (j % 2) * 2, s, s * 0.5, C.white);
      rect(ctx, cx - s, cy + s * 0.3, s * 4, 2, C.sky3);
    }
    circle(ctx, 320, 34, 12, C.fire0);
  }, { outline: false });

  // ---------------- far islands + sea (parallax 0.2), 512 wide tile
  buildImage(scene, 'far', 512, 80, (ctx) => {
    const r = rng(11);
    rect(ctx, 0, 56, 512, 24, C.sea);
    for (let i = 0; i < 40; i++) rect(ctx, r() * 512, 58 + r() * 20, 6 + r() * 10, 1, C.seaL);
    for (let k = 0; k < 5; k++) {
      const cx = 40 + k * 105 + r() * 30, w = 26 + r() * 30, h = 8 + r() * 14;
      ellipse(ctx, cx, 56, w, h, C.far);
      ellipse(ctx, cx + w * 0.3, 56, w * 0.6, h * 0.7, C.farS);
    }
    rect(ctx, 0, 55, 512, 1, C.seaL);
  }, { outline: false });

  // ---------------- mid layer: palms and far huts (parallax 0.5)
  buildImage(scene, 'mid', 512, 110, (ctx) => {
    const r = rng(23);
    const cols = [C.mid, C.mid, '#4d8068', '#335a4a'];
    rect(ctx, 0, 96, 512, 14, '#4d8068');
    for (let i = 0; i < 9; i++) palm(ctx, 20 + i * 58 + r() * 20, 100, 44 + r() * 26, (r() - 0.5) * 20, r, cols);
    for (let i = 0; i < 3; i++) {
      const x = 60 + i * 170;
      rect(ctx, x, 78, 36, 20, '#335a4a');
      poly(ctx, [[x - 4, 80], [x + 18, 66], [x + 40, 80]], '#2a4a3d');
    }
  }, { outline: false });

  // ---------------- ground tile (64 x 20): sand top, dirt below
  buildImage(scene, 'ground', 64, 20, (ctx) => {
    const r = rng(5);
    rect(ctx, 0, 0, 64, 20, C.dirt);
    rect(ctx, 0, 0, 64, 6, C.sand);
    rect(ctx, 0, 5, 64, 2, C.sandS);
    for (let i = 0; i < 16; i++) rect(ctx, r() * 64, 8 + r() * 11, 2 + r() * 3, 1, C.dirtS);
    for (let i = 0; i < 10; i++) dot(ctx, r() * 64, 1 + r() * 3, C.sandS);
  }, { outline: false });

  // ---------------- dock planks (32 x 20) and water (64 x 24)
  buildImage(scene, 'dock', 32, 20, (ctx) => {
    rect(ctx, 0, 0, 32, 5, C.wood);
    rect(ctx, 0, 0, 32, 1, C.woodL);
    for (let x = 0; x < 32; x += 8) rect(ctx, x, 0, 1, 5, C.woodS);
    rect(ctx, 3, 5, 4, 15, C.woodS);
    rect(ctx, 19, 5, 4, 15, C.woodS);
  }, { outline: false });
  for (let f = 0; f < 2; f++) {
    buildImage(scene, `water_${f}`, 64, 24, (ctx) => {
      rect(ctx, 0, 0, 64, 24, C.sea);
      rect(ctx, 0, 10, 64, 14, C.seaD);
      for (let x = 0; x < 64; x += 16) {
        rect(ctx, x + f * 8, 1, 7, 1, C.seaL);
        rect(ctx, x + 4 + f * 4, 6, 5, 1, C.seaL);
      }
    }, { outline: false });
  }

  // ---------------- props
  const r = rng(99);
  buildImage(scene, 'hut', 72, 72, (ctx) => hut(ctx, 8, 72, 56, 42, r));
  buildImage(scene, 'palm', 48, 90, (ctx) => palm(ctx, 22, 90, 70, 8, rng(3), [C.trunk, C.trunkS, C.leaf, C.leafS]));
  buildImage(scene, 'sandbags', 40, 14, (ctx) => {
    for (let i = 0; i < 4; i++) ellipse(ctx, 5 + i * 10, 10, 5, 3, C.khaki);
    for (let i = 0; i < 3; i++) ellipse(ctx, 10 + i * 10, 5, 5, 3, C.khakiS);
  });
  buildImage(scene, 'crate', 16, 16, (ctx) => {
    rect(ctx, 0, 0, 16, 16, C.wood);
    rect(ctx, 0, 0, 16, 2, C.woodL);
    line(ctx, 1, 1, 14, 14, C.woodS, 2);
    rect(ctx, 0, 0, 2, 16, C.woodS);
    rect(ctx, 14, 0, 2, 16, C.woodS);
  });
  buildImage(scene, 'barrel', 14, 18, (ctx) => {
    rect(ctx, 0, 0, 14, 18, C.red);
    rect(ctx, 0, 0, 4, 18, C.redS);
    rect(ctx, 0, 4, 14, 2, C.gunS);
    rect(ctx, 0, 12, 14, 2, C.gunS);
    rect(ctx, 5, 7, 5, 4, C.gold);
  });
  buildImage(scene, 'campfire', 20, 12, (ctx) => {
    line(ctx, 2, 11, 18, 7, C.trunkS, 2);
    line(ctx, 2, 7, 18, 11, C.trunk, 2);
    ellipse(ctx, 10, 6, 4, 5, C.fire1);
    ellipse(ctx, 10, 7, 2, 3, C.fire0);
  });

  // ---------------- projectiles
  buildImage(scene, 'bullet', 6, 3, (ctx) => { rect(ctx, 0, 0, 6, 3, C.fire1); rect(ctx, 2, 1, 4, 1, C.fire0); }, { outline: false });
  buildImage(scene, 'ebullet', 5, 5, (ctx) => { circle(ctx, 2, 2, 2, C.fire2); dot(ctx, 2, 2, C.fire0); });
  buildImage(scene, 'shell', 7, 7, (ctx) => { circle(ctx, 3, 3, 3, C.gunS); dot(ctx, 2, 2, C.gunL); });
  buildImage(scene, 'bigshell', 10, 6, (ctx) => { ellipse(ctx, 5, 3, 4, 2, C.gun); rect(ctx, 0, 2, 3, 2, C.fire1); });
  buildImage(scene, 'grenade', 6, 7, (ctx) => { ellipse(ctx, 3, 4, 2, 3, C.oliveS); rect(ctx, 2, 0, 2, 2, C.gun); });
  buildImage(scene, 'bomb', 8, 12, (ctx) => { ellipse(ctx, 4, 6, 3, 5, C.gunS); rect(ctx, 1, 0, 6, 2, C.gun); });
  buildImage(scene, 'rocket', 12, 5, (ctx) => {
    rect(ctx, 2, 1, 8, 3, C.greyL);
    rect(ctx, 9, 1, 3, 3, C.red);
    rect(ctx, 0, 0, 3, 5, C.gun);
  });
  buildImage(scene, 'fireball', 12, 8, (ctx) => {
    ellipse(ctx, 7, 4, 5, 3, C.fire2);
    ellipse(ctx, 8, 4, 3, 2, C.fire1);
    dot(ctx, 9, 4, C.fire0);
    rect(ctx, 0, 3, 3, 2, C.fire2);
  }, { outline: false });
  const blast = [];
  for (let f = 0; f < 4; f++) {
    blast.push({
      name: `sg_${f}`,
      outline: null,
      draw(ctx) {
        const k = 1 - f / 4;
        const rr = rng(40 + f);
        for (let i = 0; i < 26; i++) {
          const t = rr();
          const x = 4 + t * 50;
          const y = 14 + (rr() - 0.5) * t * 22;
          const s = Math.max(1, Math.round((1 - t) * 5 * k + 1));
          rect(ctx, x, y, s, s, t < 0.3 ? C.fire0 : t < 0.6 ? C.fire1 : C.fire2);
        }
      },
    });
  }
  buildSheet(scene, 'sgblast', 56, 28, blast);

  // ---------------- explosions
  const explosion = (key, size, n, seed) => {
    const frames = [];
    for (let f = 0; f < n; f++) {
      frames.push({
        name: `${f}`,
        draw(ctx) {
          const r2 = rng(seed);
          const c = size / 2;
          const t = f / (n - 1);
          const R = c * (0.35 + 0.65 * Math.sqrt(t));
          const blobs = 9;
          for (let i = 0; i < blobs; i++) {
            const a = r2() * Math.PI * 2, d = r2() * R * 0.55;
            const br = R * (0.35 + r2() * 0.3);
            const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d - t * c * 0.3;
            if (t > 0.45) {
              circle(ctx, x, y, br, t > 0.8 ? C.smokeL : C.smoke);
              if (t < 0.8) circle(ctx, x, y, br * 0.5, C.fire3);
            } else {
              circle(ctx, x, y, br, C.fire2);
              circle(ctx, x, y, br * 0.7, C.fire1);
              circle(ctx, x - 1, y - 1, br * 0.4, C.fire0);
            }
          }
          if (t < 0.2) circle(ctx, c, c, R * 0.6, C.white);
          if (t > 0.85) {
            // holes as the smoke dissipates
            for (let i = 0; i < 20; i++) ctx.clearRect(Math.round(r2() * size), Math.round(r2() * size), 3, 3);
          }
        },
      });
    }
    buildSheet(scene, key, size, size, frames, { outline: C.fire3 });
  };
  explosion('boom_s', 32, 8, 3);
  explosion('boom_l', 64, 10, 8);

  const smoke = [];
  for (let f = 0; f < 4; f++) smoke.push({ name: `${f}`, draw: (ctx) => { circle(ctx, 8, 8, 3 + f, f < 2 ? C.smoke : C.smokeL); } });
  buildSheet(scene, 'smoke', 16, 16, smoke, { outline: null });
  const spark = [];
  for (let f = 0; f < 3; f++) {
    spark.push({
      name: `${f}`,
      draw(ctx) {
        const s = [2, 4, 3][f];
        rect(ctx, 5 - s, 5, s * 2 + 1, 1, C.fire0);
        rect(ctx, 5, 5 - s, 1, s * 2 + 1, C.fire0);
        if (f === 1) rect(ctx, 4, 4, 3, 3, C.fire1);
      },
    });
  }
  buildSheet(scene, 'spark', 11, 11, spark, { outline: null });
  const splash = [];
  for (let f = 0; f < 5; f++) {
    splash.push({
      name: `${f}`,
      draw(ctx) {
        const h = [6, 14, 18, 12, 4][f];
        for (let i = -3; i <= 3; i++) rect(ctx, 16 + i * 4, 30 - h + Math.abs(i) * 3, 2, h - Math.abs(i) * 3, i % 2 ? C.seaL : C.white);
      },
    });
  }
  buildSheet(scene, 'splash', 32, 32, splash, { outline: null });
  buildImage(scene, 'debris', 4, 4, (ctx) => rect(ctx, 0, 0, 4, 4, C.gun), { outline: false });
  buildImage(scene, 'chip', 4, 3, (ctx) => rect(ctx, 0, 0, 4, 3, C.woodS), { outline: false });

  // ---------------- items
  const crate = (key, letter, color) => {
    const frames = [];
    for (let f = 0; f < 2; f++) {
      frames.push({
        name: `${f}`,
        draw(ctx) {
          rect(ctx, 1, 1, 16, 15, f ? C.woodL : C.wood);
          rect(ctx, 1, 1, 16, 2, C.woodL);
          rect(ctx, 1, 13, 16, 3, C.woodS);
          rect(ctx, 4, 4, 10, 9, color);
          drawText(ctx, letter, 6, 5, { top: C.white, outline: null });
        },
      });
    }
    buildSheet(scene, key, 18, 17, frames);
  };
  crate('item_B', 'B', C.red);
  crate('item_S', 'S', C.blue);
  crate('item_R', 'R', C.olive);
  crate('item_G', 'G', C.gunS);
  buildImage(scene, 'item_food', 14, 10, (ctx) => {
    ellipse(ctx, 6, 5, 5, 4, C.fire1);
    ellipse(ctx, 5, 4, 3, 2, C.gold);
    rect(ctx, 10, 3, 4, 2, C.cloth);
  });
  buildImage(scene, 'item_gem', 10, 10, (ctx) => {
    poly(ctx, [[5, 0], [10, 4], [5, 10], [0, 4]], C.glass);
    poly(ctx, [[5, 0], [7, 4], [5, 8], [3, 4]], C.white);
  });
  buildImage(scene, 'arrow_in', 14, 16, (ctx) => {
    drawText(ctx, 'IN', 1, 0, { top: C.gold, outline: null });
    poly(ctx, [[2, 9], [12, 9], [7, 15]], C.red);
  });
}
