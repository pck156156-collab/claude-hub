// Tiny pixel-art drawing kit. Everything draws on integer pixels with no smoothing,
// then frames are packed into Phaser textures with named frames.
import { C, hex } from './palette.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function dot(ctx, x, y, color) {
  rect(ctx, x, y, 1, 1, color);
}

// Filled ellipse drawn row by row (no anti-aliasing).
export function ellipse(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.01))));
    ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

export function circle(ctx, cx, cy, r, color) {
  ellipse(ctx, cx, cy, r, r, color);
}

// Thick line by stamping squares along a Bresenham path.
export function line(ctx, x0, y0, x1, y1, color, t = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const o = Math.floor(t / 2);
  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect(x0 - o, y0 - o, t, t);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Scanline polygon fill.
export function poly(ctx, pts, color) {
  ctx.fillStyle = color;
  const ys = pts.map((p) => p[1]);
  const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.round(xs[i]), b = Math.round(xs[i + 1]);
      if (b > a) ctx.fillRect(a, y, b - a, 1);
    }
  }
}

// Make alpha fully on/off and add a 1px outline around opaque pixels.
export function finish(ctx, w, h, outlineColor = C.outline) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
  if (outlineColor) {
    const [r, g, b] = hex(outlineColor);
    const src = new Uint8ClampedArray(d);
    const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src[(y * w + x) * 4 + 3]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (a(x, y)) continue;
        if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) {
          const i = (y * w + x) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Draw `src` canvas rotated by `angle` (radians) around (px, py), nearest-neighbour.
export function drawRotated(ctx, src, angle, px, py, dx = px, dy = py) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(dx, dy);
  ctx.rotate(angle);
  ctx.drawImage(src, -px, -py);
  ctx.restore();
}

/**
 * Build a texture from a list of frames.
 * frames: [{ name, draw(ctx, w, h), outline?: color|null }]
 */
export function buildSheet(scene, key, fw, fh, frames, { outline = C.outline } = {}) {
  const cols = Math.min(frames.length, 16);
  const rows = Math.ceil(frames.length / cols);
  const [sheet, sctx] = makeCanvas(fw * cols, fh * rows);
  frames.forEach((f, i) => {
    const [c, ctx] = makeCanvas(fw, fh);
    f.draw(ctx, fw, fh);
    finish(ctx, fw, fh, f.outline === undefined ? outline : f.outline);
    sctx.drawImage(c, (i % cols) * fw, Math.floor(i / cols) * fh);
  });
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, sheet);
  frames.forEach((f, i) => tex.add(f.name, 0, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh));
  return tex;
}

// Single-image texture.
export function buildImage(scene, key, w, h, draw, { outline = C.outline } = {}) {
  const [c, ctx] = makeCanvas(w, h);
  draw(ctx, w, h);
  if (outline !== false) finish(ctx, w, h, outline);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, c);
  return c;
}

// Deterministic random so generated art is identical every run.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
