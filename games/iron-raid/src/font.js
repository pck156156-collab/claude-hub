// 5x7 pixel font rendered into canvas textures. '~' draws an infinity sign.
import { C } from './palette.js';

const G = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110',
  1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111',
  3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010',
  5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110',
  7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00010 00100 00000 00100',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  ',': '00000 00000 00000 00000 01100 00100 01000',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '*': '00000 10001 01010 00100 01010 10001 00000',
  '/': '00001 00010 00010 00100 01000 01000 10000',
  '=': '00000 00000 11111 00000 11111 00000 00000',
  '~': '00000 00000 01010 10101 01010 00000 00000',
  '>': '01000 00100 00010 00001 00010 00100 01000',
  '<': '00010 00100 01000 10000 01000 00100 00010',
  "'": '00100 00100 01000 00000 00000 00000 00000',
  '#': '00000 11110 11110 11110 11110 11110 00000',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};
const GLYPHS = Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.split(' ')]));

export const GLYPH_W = 6;
export const GLYPH_H = 7;

export function textWidth(str, scale = 1) {
  return (str.length * GLYPH_W - 1) * scale;
}

/**
 * Draw text on a 2D context. Colors: top/bottom give a two-tone gradient look.
 * An outline (1px * scale) is drawn around every glyph.
 */
export function drawText(ctx, str, x, y, { scale = 1, top = C.white, bottom = null, outline = C.outline, shadow = null } = {}) {
  const s = scale;
  const glyphPass = (ox, oy, colorFn) => {
    [...str.toUpperCase()].forEach((ch, i) => {
      const g = GLYPHS[ch] || GLYPHS['?'];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          if (g[r][c] !== '1') continue;
          ctx.fillStyle = colorFn(r);
          ctx.fillRect(x + (i * GLYPH_W + c) * s + ox, y + r * s + oy, s, s);
        }
      }
    });
  };
  if (shadow) glyphPass(Math.ceil(s / 2), s, () => shadow);
  if (outline) {
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
      glyphPass(ox * Math.max(1, s / 2 | 0), oy * Math.max(1, s / 2 | 0), () => outline);
    }
  }
  glyphPass(0, 0, (r) => (bottom && r >= 4 ? bottom : top));
}

/**
 * A text object backed by its own canvas texture, redrawn on setText.
 * Returns a Phaser Image with a setText(str) method.
 */
export function pixelText(scene, x, y, str, opts = {}) {
  const maxLen = opts.maxLen || Math.max(str.length, 12);
  const s = opts.scale || 1;
  const w = textWidth('X'.repeat(maxLen), s) + 4 * s + 2;
  const h = GLYPH_H * s + 4 * s + 2;
  const key = `txt_${Phaser_uid()}`;
  const tex = scene.textures.createCanvas(key, w, h);
  const img = scene.add.image(x, y, key).setOrigin(0, 0);
  img.pxOpts = opts;
  img.setText = (t) => {
    t = String(t);
    if (img.currentText === t) return img;
    img.currentText = t;
    const ctx = tex.context;
    ctx.clearRect(0, 0, w, h);
    const tw = textWidth(t, s);
    let tx = 2 * s;
    if (opts.align === 'center') tx = Math.round((w - tw) / 2);
    if (opts.align === 'right') tx = w - tw - 2 * s;
    drawText(ctx, t, tx, 2 * s, opts);
    tex.refresh();
    return img;
  };
  // Keep the visible anchor where the caller asked for it.
  if (opts.align === 'center') img.setOrigin(0.5, 0);
  if (opts.align === 'right') img.setOrigin(1, 0);
  img.once('destroy', () => scene.textures.remove(key));
  img.setText(str);
  return img;
}

let uid = 0;
function Phaser_uid() {
  uid += 1;
  return uid;
}
