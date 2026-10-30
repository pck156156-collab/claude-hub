import { Engine, Scene, Entity, Component, Body, Shape, overlaps, parseTilemap } from '../../engine/index.js';
import { levels } from './levels.js';

const TILE = 16;

// 코요테 타임 + 점프 버퍼 + 가변 점프 높이로 조작감을 다듬은 플레이어 컨트롤러.
class PlayerController extends Component {
  constructor() {
    super();
    this.speed = 160;
    this.accel = 1400;
    this.jumpSpeed = 520;
    this.coyote = 0;
    this.buffer = 0;
    this.facing = 1;
  }

  update(dt, { input, engine }) {
    const body = this.entity.get(Body);
    const dir = input.axisX();
    if (dir) this.facing = dir;

    const target = dir * this.speed;
    const delta = target - body.vel.x;
    body.vel.x += Math.sign(delta) * Math.min(Math.abs(delta), this.accel * dt);

    this.coyote = body.onGround ? 0.1 : this.coyote - dt;
    this.buffer = input.wasPressed('Space', 'KeyW', 'ArrowUp') ? 0.12 : this.buffer - dt;

    if (this.buffer > 0 && this.coyote > 0) {
      body.vel.y = -this.jumpSpeed;
      this.buffer = 0;
      this.coyote = 0;
      engine.synth.beep({ freq: 300, toFreq: 600, duration: 0.12 });
    }
    // 점프 키를 일찍 떼면 낮게 뛴다.
    if (body.vel.y < 0 && !input.isDown('Space', 'KeyW', 'ArrowUp')) body.vel.y *= 0.85;
  }

  render(r) {
    const e = this.entity;
    r.rect(e.pos.x, e.pos.y, e.size.x, e.size.y, '#7fd1ff');
    const eyeX = this.facing > 0 ? e.right - 5 : e.left + 2;
    r.rect(eyeX, e.top + 4, 3, 3, '#14141c');
  }
}

// 벽이나 낭떠러지를 만나면 방향을 바꾸는 적.
class Patrol extends Component {
  constructor(speed = 50) {
    super();
    this.dir = 1;
    this.speed = speed;
  }

  update(_dt, { scene }) {
    const e = this.entity;
    const body = e.get(Body);
    if (body.touching.left) this.dir = 1;
    if (body.touching.right) this.dir = -1;
    if (body.onGround) {
      const probe = { left: this.dir > 0 ? e.right : e.left - 1, top: e.bottom + 1 };
      probe.right = probe.left + 1;
      probe.bottom = probe.top + 1;
      const ground = scene.findByTag('solid').some((s) => overlaps(probe, s));
      if (!ground) this.dir *= -1;
    }
    body.vel.x = this.dir * this.speed;
  }
}

class Bob extends Component {
  constructor() { super(); this.t = Math.random() * 6; this.baseY = null; }
  update(dt) {
    this.t += dt;
    if (this.baseY === null) this.baseY = this.entity.pos.y;
    this.entity.pos.y = this.baseY + Math.sin(this.t * 4) * 2;
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

const legend = {
  '#': (x, y, s) => new Entity({ x, y, w: s, h: s, tags: ['solid'] }).add(new Shape({ color: '#3b3f58' })),
  '*': (x, y, s) => new Entity({ x: x + 4, y: y + 4, w: s - 8, h: s - 8, tags: ['star'] })
    .add(new Bob()).add(new Shape({ color: '#ffd84a', shape: 'circle' })),
  '^': (x, y, s) => new Entity({ x: x + 2, y: y + s / 2, w: s - 4, h: s / 2, tags: ['hazard'] })
    .add(new Shape({ color: '#ff5470' })),
  'E': (x, y, s) => new Entity({ x: x + 2, y: y + 4, w: s - 4, h: s - 4, tags: ['hazard', 'enemy'] })
    .add(new Body()).add(new Patrol()).add(new Shape({ color: '#c17bff' })),
  'F': (x, y, s) => new Entity({ x: x + 4, y: y - s, w: 8, h: s * 2, tags: ['goal'] })
    .add(new Shape({ color: '#5cf2a0' })),
  'P': (x, y, s) => new Entity({ x: x + 2, y: y + 2, w: s - 4, h: s - 2, tags: ['player'] })
    .add(new Body()).add(new PlayerController()),
};

class LevelScene extends Scene {
  constructor(index, totalStars = 0) {
    super();
    this.index = index;
    this.totalStars = totalStars;
  }

  enter() {
    const map = parseTilemap(levels[this.index], legend, TILE);
    map.entities.forEach((e) => this.spawn(e));
    this.player = this.findByTag('player')[0];
    this.player.z = 5;
    this.starsLeft = this.findByTag('star').length;
    this.collected = 0;
    this.camera.bounds = { x: 0, y: 0, w: map.width, h: map.height };
    this.camera.follow(this.player);
    this.dead = false;
    this.timer = 0;
  }

  burst(x, y, color, n = 12) {
    for (let i = 0; i < n; i++) this.spawn(new Particle(x, y, color));
  }

  update(dt) {
    const { input, engine } = this;
    if (input.wasPressed('KeyP')) engine.paused = !engine.paused;
    if (input.wasPressed('KeyR')) return engine.setScene(new LevelScene(this.index, this.totalStars));

    if (this.dead) {
      this.timer -= dt;
      super.update(dt);
      if (this.timer <= 0) engine.setScene(new LevelScene(this.index, this.totalStars));
      return;
    }

    super.update(dt);
    const p = this.player;

    for (const star of this.findByTag('star')) {
      if (overlaps(p, star)) {
        star.destroy();
        this.collected++;
        this.starsLeft--;
        const c = star.center;
        this.burst(c.x, c.y, '#ffd84a', 8);
        engine.synth.beep({ freq: 880, toFreq: 1320, duration: 0.08, type: 'triangle' });
      }
    }

    // 적을 위에서 밟으면 처치, 그 외 위험 요소에 닿으면 사망.
    for (const h of this.findByTag('hazard')) {
      if (!overlaps(p, h)) continue;
      const body = p.get(Body);
      if (h.is('enemy') && body.vel.y > 0 && p.bottom - h.top < 8) {
        h.destroy();
        body.vel.y = -360;
        const c = h.center;
        this.burst(c.x, c.y, '#c17bff');
        engine.synth.beep({ freq: 200, toFreq: 80, duration: 0.15 });
      } else {
        return this.die();
      }
    }

    if (p.top > this.camera.bounds.h) return this.die();

    const goal = this.findByTag('goal')[0];
    if (goal && overlaps(p, goal)) {
      engine.synth.beep({ freq: 523, toFreq: 1046, duration: 0.3, type: 'triangle' });
      const next = this.index + 1;
      const total = this.totalStars + this.collected;
      engine.setScene(next < levels.length ? new LevelScene(next, total) : new EndScene(total));
    }
  }

  die() {
    this.dead = true;
    this.timer = 0.8;
    const c = this.player.center;
    this.player.destroy();
    this.burst(c.x, c.y, '#7fd1ff', 20);
    this.camera.target = null;
    this.camera.shake(5, 0.3);
    this.engine.synth.beep({ freq: 400, toFreq: 60, duration: 0.4, type: 'sawtooth' });
  }

  renderUI(r) {
    r.text(`스테이지 ${this.index + 1}/${levels.length}`, 8, 8, { size: 12 });
    r.text(`★ ${this.collected}  (남은 별 ${this.starsLeft})`, 8, 24, { size: 12, color: '#ffd84a' });
    r.text(`${Math.round(this.engine.fps)} FPS`, r.width - 8, 8, { size: 10, align: 'right', color: '#888' });
    if (this.engine.paused) r.text('일시정지', r.width / 2, r.height / 2 - 8, { size: 16, align: 'center' });
  }
}

class EndScene extends Scene {
  constructor(stars) { super(); this.stars = stars; }
  update() {
    if (this.input.wasPressed('Space', 'Enter')) this.engine.setScene(new LevelScene(0));
  }
  renderUI(r) {
    r.text('클리어!', r.width / 2, r.height / 2 - 30, { size: 28, align: 'center', color: '#5cf2a0' });
    r.text(`모은 별: ${this.stars}`, r.width / 2, r.height / 2 + 6, { size: 14, align: 'center', color: '#ffd84a' });
    r.text('Space 키로 다시 시작', r.width / 2, r.height / 2 + 30, { size: 12, align: 'center' });
  }
}

const engine = new Engine(document.getElementById('game'), { width: 480, height: 270 });
engine.start(new LevelScene(0));
