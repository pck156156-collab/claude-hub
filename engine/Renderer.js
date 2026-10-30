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

// 단색 사각형/원으로 엔티티를 그리는 간단한 컴포넌트.
export class Shape {
  constructor({ color = '#fff', shape = 'rect' } = {}) {
    this.entity = null;
    this.color = color;
    this.shape = shape;
  }

  render(r) {
    const e = this.entity;
    if (this.shape === 'circle') {
      const c = e.center;
      r.circle(c.x, c.y, Math.min(e.size.x, e.size.y) / 2, this.color);
    } else {
      r.rect(e.pos.x, e.pos.y, e.size.x, e.size.y, this.color);
    }
  }
}
