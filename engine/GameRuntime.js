import { Scene } from './Scene.js';
import { Entity } from './Entity.js';
import { Body, overlaps } from './Physics.js';
import { Shape } from './Renderer.js';
import { behaviors } from './behaviors.js';

// 에디터 데이터(JSON) 한 개를 런타임 엔티티로 만든다.
export function buildEntity(data) {
  const e = new Entity({ x: data.x, y: data.y, w: data.w, h: data.h, tags: data.tags || [] });
  e.name = data.name || `Entity${e.id}`;
  e.z = data.z || 0;
  if (data.visible !== false) e.add(new Shape({ color: data.color || '#ffffff', shape: data.shape || 'rect' }));
  for (const [type, props] of Object.entries(data.components || {})) {
    const def = behaviors[type];
    if (!def) continue;
    const c = def.create({ ...props }, e);
    if (c) e.add(c);
  }
  e.body = e.get(Body);
  return e;
}

// 프로젝트의 씬 하나를 실행하는 씬. 수집/위험/목표 규칙과 점수, 재시작, 씬 이동을 처리한다.
export class GameScene extends Scene {
  constructor(project, sceneIndex = 0, { score = 0, log = null } = {}) {
    super();
    this.project = project;
    this.sceneIndex = sceneIndex;
    this.data = project.scenes[sceneIndex];
    this.startScore = score;
    this.score = score;
    this.log = log || ((msg) => console.log(msg));
    this.state = 'play';
    this.timer = 0;
    this.time = 0;
  }

  enter() {
    const settings = this.project.settings || {};
    this.physics.gravity = settings.gravity ?? 1800;
    this.background = this.data.background || '#14141c';

    for (const d of this.data.entities) this.spawn(buildEntity(d));
    this.player = this.findByTag('player')[0] || null;
    if (this.player) this.player.z = Math.max(this.player.z, 5);

    this.bounds = computeBounds(this.data.entities);
    this.camera.bounds = this.bounds;
    if (this.player) this.camera.follow(this.player);
    else this.camera.pos.set(this.bounds.x, this.bounds.y);

    const scene = this;
    this.api = {
      get input() { return scene.input; },
      get time() { return scene.time; },
      get score() { return scene.score; },
      set score(v) { scene.score = v; },
      dt: 0,
      engine: this.engine,
      scene: this,
      find: (name) => this.entities.find((e) => e.alive && e.name === name) || null,
      findByTag: (tag) => this.findByTag(tag),
      log: (msg) => this.log(String(msg)),
      restart: () => this.restart(),
      goto: (name) => this.goto(name),
    };
  }

  restart() {
    this.engine.setScene(new GameScene(this.project, this.sceneIndex, { score: this.startScore, log: this.log }));
  }

  goto(name) {
    const idx = typeof name === 'number' ? name : this.project.scenes.findIndex((s) => s.name === name);
    if (idx < 0 || idx >= this.project.scenes.length) {
      this.state = 'win';
      return;
    }
    this.engine.setScene(new GameScene(this.project, idx, { score: this.score, log: this.log }));
  }

  update(dt) {
    const { input, engine } = this;
    this.api.dt = dt;
    this.time += dt;
    if (input.wasPressed('KeyP')) engine.paused = !engine.paused;
    if (input.wasPressed('KeyR')) return this.restart();

    if (this.state === 'win') {
      if (input.wasPressed('Space', 'Enter')) {
        const start = Math.max(0, this.project.scenes.findIndex((s) => s.name === this.project.settings?.startScene));
        this.engine.setScene(new GameScene(this.project, start, { log: this.log }));
      }
      return;
    }

    super.update(dt);

    if (this.state === 'dead') {
      this.timer -= dt;
      if (this.timer <= 0) this.restart();
      return;
    }

    const p = this.player;
    if (!p || !p.alive) return;

    for (const item of this.findByTag('collectible')) {
      if (!overlaps(p, item)) continue;
      item.destroy();
      this.score += item.scoreValue ?? 1;
      this.burst(item.center, '#ffd84a', 8);
      engine.synth.beep({ freq: 880, toFreq: 1320, duration: 0.08, type: 'triangle' });
    }

    for (const h of this.findByTag('hazard')) {
      if (!overlaps(p, h)) continue;
      if (h.is('stompable') && p.body && p.body.vel.y > 0 && p.bottom - h.top < 8) {
        h.destroy();
        p.body.vel.y = -360;
        this.burst(h.center, '#c17bff', 12);
        engine.synth.beep({ freq: 200, toFreq: 80, duration: 0.15 });
      } else {
        return this.die();
      }
    }

    if (p.top > this.bounds.y + this.bounds.h + 64) return this.die();

    const goal = this.findByTag('goal').find((g) => overlaps(p, g));
    if (goal) {
      engine.synth.beep({ freq: 523, toFreq: 1046, duration: 0.3, type: 'triangle' });
      this.goto(goal.nextScene || this.sceneIndex + 1);
    }
  }

  die() {
    this.state = 'dead';
    this.timer = 0.8;
    const c = this.player.center;
    this.player.destroy();
    this.burst(c, '#7fd1ff', 20);
    this.camera.target = null;
    this.camera.shake(5, 0.3);
    this.engine.synth.beep({ freq: 400, toFreq: 60, duration: 0.4, type: 'sawtooth' });
  }

  burst(c, color, n) {
    for (let i = 0; i < n; i++) this.spawn(new Particle(c.x, c.y, color));
  }

  renderUI(r) {
    r.text(this.data.name, 8, 8, { size: 12 });
    r.text(`★ ${this.score}`, 8, 24, { size: 12, color: '#ffd84a' });
    if (this.engine.paused) r.text('일시정지', r.width / 2, r.height / 2 - 8, { size: 16, align: 'center' });
    if (this.state === 'win') {
      r.rect(0, 0, r.width, r.height, 'rgba(0,0,0,0.6)');
      r.text('클리어!', r.width / 2, r.height / 2 - 30, { size: 28, align: 'center', color: '#5cf2a0' });
      r.text(`점수: ${this.score}`, r.width / 2, r.height / 2 + 6, { size: 14, align: 'center', color: '#ffd84a' });
      r.text('Space 키로 다시 시작', r.width / 2, r.height / 2 + 30, { size: 12, align: 'center' });
    }
  }
}

class Particle extends Entity {
  constructor(x, y, color) {
    super({ x, y, w: 2, h: 2 });
    this.vx = (Math.random() * 2 - 1) * 120;
    this.vy = -Math.random() * 180;
    this.life = 0.5;
    this.color = color;
    this.z = 10;
  }
  update(dt) {
    this.vy += 600 * dt;
    this.pos.x += this.vx * dt;
    this.pos.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.destroy();
  }
  render(r) { r.rect(this.pos.x, this.pos.y, 2, 2, this.color); }
}

export function computeBounds(entities) {
  if (!entities.length) return { x: 0, y: 0, w: 1, h: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of entities) {
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + e.w);
    y1 = Math.max(y1, e.y + e.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
