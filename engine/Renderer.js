// Canvas 2D 래퍼. 월드 좌표 그리기(카메라 적용)와 화면 좌표 UI 그리기를 지원한다.
export class Renderer {
  constructor(canvas, { pixelArt = true } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = !pixelArt;
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  clear(color = '#000') {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  beginWorld(camera) {
    const { x, y } = camera ? camera.offset() : { x: 0, y: 0 };
    this.ctx.setTransform(1, 0, 0, 1, -x, -y);
  }

  beginScreen() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); }

  rect(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  circle(x, y, r, color) {
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  image(img, x, y, w = img.width, h = img.height, { flipX = false } = {}) {
    if (!flipX) return this.ctx.drawImage(img, x, y, w, h);
    this.ctx.save();
    this.ctx.translate(x + w, y);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(img, 0, 0, w, h);
    this.ctx.restore();
  }

  text(str, x, y, { color = '#fff', size = 16, align = 'left', font = 'monospace' } = {}) {
    this.ctx.fillStyle = color;
    this.ctx.font = `${size}px ${font}`;
    this.ctx.textAlign = align;
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(str, x, y);
  }
}

// 사각형/원/가시 모양 또는 이모지 하나를 (x, y, w, h) 상자에 맞춰 그린다. 에디터와 게임이 함께 쓴다.
export function drawShape(r, x, y, w, h, { color = '#fff', shape = 'rect', emoji = '' } = {}) {
  const ctx = r.ctx;
  if (emoji) {
    const size = Math.min(w, h);
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(emoji, x + w / 2, y + h / 2 + size * 0.08);
    return;
  }
  ctx.fillStyle = color;
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'spike') {
    const n = Math.max(1, Math.round(w / Math.max(4, h)));
    const sw = w / n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(x + i * sw, y + h);
      ctx.lineTo(x + i * sw + sw / 2, y);
      ctx.lineTo(x + (i + 1) * sw, y + h);
    }
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

// 엔티티를 단색 도형이나 이모지로 그리는 컴포넌트.
export class Shape {
  constructor({ color = '#fff', shape = 'rect', emoji = '' } = {}) {
    this.entity = null;
    this.color = color;
    this.shape = shape;
    this.emoji = emoji;
  }

  render(r) {
    const e = this.entity;
    drawShape(r, e.pos.x, e.pos.y, e.size.x, e.size.y, this);
  }
}
