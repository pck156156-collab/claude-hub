// 2D 벡터. 대부분의 연산은 새 벡터를 반환하고, set/addSelf 등 *Self 메서드만 자신을 수정한다.
export class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x, y) { this.x = x; this.y = y; return this; }
  clone() { return new Vec2(this.x, this.y); }

  add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
  scale(s) { return new Vec2(this.x * s, this.y * s); }
  addSelf(v) { this.x += v.x; this.y += v.y; return this; }

  dot(v) { return this.x * v.x + this.y * v.y; }
  length() { return Math.hypot(this.x, this.y); }
  normalize() {
    const len = this.length();
    return len === 0 ? new Vec2() : this.scale(1 / len);
  }

  static lerp(a, b, t) { return new Vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
}
