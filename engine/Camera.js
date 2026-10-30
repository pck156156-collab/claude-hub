import { Vec2 } from './Vec2.js';

// 대상을 부드럽게 따라가고, 월드 경계 밖은 보여주지 않는 카메라.
export class Camera {
  constructor(width, height) {
    this.pos = new Vec2();
    this.width = width;
    this.height = height;
    this.target = null;
    this.smoothing = 8;
    this.bounds = null; // { x, y, w, h }
    this.shakeTime = 0;
    this.shakeMag = 0;
  }

  follow(entity, { snap = true } = {}) {
    this.target = entity;
    if (snap) this.pos = this.desired();
  }

  shake(magnitude = 4, time = 0.2) {
    this.shakeMag = magnitude;
    this.shakeTime = time;
  }

  desired() {
    const c = this.target.center;
    let x = c.x - this.width / 2;
    let y = c.y - this.height / 2;
    if (this.bounds) {
      const b = this.bounds;
      // 월드가 화면보다 작은 축은 가운데 정렬한다.
      x = b.w <= this.width ? b.x + (b.w - this.width) / 2 : Math.max(b.x, Math.min(x, b.x + b.w - this.width));
      y = b.h <= this.height ? b.y + (b.h - this.height) / 2 : Math.max(b.y, Math.min(y, b.y + b.h - this.height));
    }
    return new Vec2(x, y);
  }

  update(dt) {
    if (this.target) {
      const t = 1 - Math.exp(-this.smoothing * dt);
      this.pos = Vec2.lerp(this.pos, this.desired(), t);
    }
    if (this.shakeTime > 0) this.shakeTime -= dt;
  }

  offset() {
    let x = Math.round(this.pos.x);
    let y = Math.round(this.pos.y);
    if (this.shakeTime > 0) {
      x += Math.round((Math.random() * 2 - 1) * this.shakeMag);
      y += Math.round((Math.random() * 2 - 1) * this.shakeMag);
    }
    return { x, y };
  }
}
