import { PhysicsWorld } from './Physics.js';
import { Camera } from './Camera.js';

// 엔티티 묶음 + 물리 + 카메라. 게임은 Scene을 상속해 enter/update/render를 확장한다.
export class Scene {
  constructor() {
    this.entities = [];
    this.engine = null;
    this.physics = new PhysicsWorld();
    this.camera = null;
    this.background = '#14141c';
  }

  // 엔진이 씬을 시작할 때 호출.
  _attach(engine) {
    this.engine = engine;
    this.camera = new Camera(engine.width, engine.height);
  }

  get input() { return this.engine.input; }

  enter() {}
  exit() {}

  spawn(entity) {
    entity.scene = this;
    this.entities.push(entity);
    entity.onSpawn?.();
    return entity;
  }

  findByTag(tag) { return this.entities.filter((e) => e.alive && e.is(tag)); }

  update(dt) {
    const ctx = { input: this.input, scene: this, engine: this.engine };
    for (const e of this.entities) if (e.alive) e.update(dt, ctx);
    this.physics.step(dt, this.entities);
    this.entities = this.entities.filter((e) => e.alive);
    this.camera.update(dt);
  }

  render(r) {
    r.clear(this.background);
    r.beginWorld(this.camera);
    const sorted = [...this.entities].sort((a, b) => a.z - b.z);
    for (const e of sorted) e.render(r);
    r.beginScreen();
    this.renderUI(r);
  }

  renderUI(_r) {}
}
