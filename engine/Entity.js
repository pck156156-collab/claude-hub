import { Vec2 } from './Vec2.js';

let nextId = 1;

// 게임 오브젝트. 위치/크기와 컴포넌트를 가지며, 필요한 동작은 컴포넌트나 update 오버라이드로 붙인다.
export class Entity {
  constructor({ x = 0, y = 0, w = 16, h = 16, tags = [] } = {}) {
    this.id = nextId++;
    this.pos = new Vec2(x, y);
    this.size = new Vec2(w, h);
    this.tags = new Set(tags);
    this.components = new Map();
    this.scene = null;
    this.alive = true;
    this.z = 0;
  }

  get left() { return this.pos.x; }
  get right() { return this.pos.x + this.size.x; }
  get top() { return this.pos.y; }
  get bottom() { return this.pos.y + this.size.y; }
  get center() { return new Vec2(this.pos.x + this.size.x / 2, this.pos.y + this.size.y / 2); }

  add(component) {
    component.entity = this;
    this.components.set(component.constructor, component);
    component.onAdd?.();
    return this;
  }

  get(Type) { return this.components.get(Type); }
  has(Type) { return this.components.has(Type); }
  is(tag) { return this.tags.has(tag); }

  destroy() { this.alive = false; }

  update(dt, ctx) {
    for (const c of this.components.values()) c.update?.(dt, ctx);
  }

  render(r) {
    for (const c of this.components.values()) c.render?.(r);
  }
}

// 컴포넌트 기본 클래스. update(dt, ctx)/render(renderer)를 선택적으로 구현한다.
export class Component {
  constructor() { this.entity = null; }
}
