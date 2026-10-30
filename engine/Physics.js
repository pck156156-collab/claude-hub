import { Vec2 } from './Vec2.js';
import { Component } from './Entity.js';

export function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// 움직이는 물체. 정적 물체(solid 태그)와 축별로 충돌을 해소한다.
export class Body extends Component {
  constructor({ gravity = true, friction = 0, maxFall = 900 } = {}) {
    super();
    this.vel = new Vec2();
    this.gravity = gravity;
    this.friction = friction;
    this.maxFall = maxFall;
    this.onGround = false;
    this.touching = { left: false, right: false, top: false, bottom: false };
  }
}

export class PhysicsWorld {
  constructor({ gravity = 1800 } = {}) {
    this.gravity = gravity;
  }

  step(dt, entities) {
    const solids = entities.filter((e) => e.alive && e.is('solid'));
    for (const e of entities) {
      const body = e.get(Body);
      if (!body || !e.alive) continue;

      if (body.gravity) body.vel.y = Math.min(body.vel.y + this.gravity * dt, body.maxFall);
      if (body.friction) body.vel.x *= Math.max(0, 1 - body.friction * dt);

      body.touching = { left: false, right: false, top: false, bottom: false };

      // 축을 분리해서 이동하면 모서리에 걸리는 문제 없이 간단히 해소된다.
      e.pos.x += body.vel.x * dt;
      for (const s of solids) {
        if (s === e || !overlaps(e, s)) continue;
        if (body.vel.x > 0) { e.pos.x = s.left - e.size.x; body.touching.right = true; }
        else if (body.vel.x < 0) { e.pos.x = s.right; body.touching.left = true; }
        body.vel.x = 0;
      }

      e.pos.y += body.vel.y * dt;
      for (const s of solids) {
        if (s === e || !overlaps(e, s)) continue;
        if (body.vel.y > 0) { e.pos.y = s.top - e.size.y; body.touching.bottom = true; }
        else if (body.vel.y < 0) { e.pos.y = s.bottom; body.touching.top = true; }
        body.vel.y = 0;
      }
      body.onGround = body.touching.bottom;
    }
  }
}
