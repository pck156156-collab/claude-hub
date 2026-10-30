import { Component } from './Entity.js';
import { Body, overlaps } from './Physics.js';
import { Shape } from './Renderer.js';

// 에디터에서 붙일 수 있는 컴포넌트 목록.
// fields는 인스펙터 UI와 기본값을, create는 런타임 컴포넌트 생성을 정의한다.

// 코요테 타임 + 점프 버퍼 + 가변 점프 높이를 갖춘 플랫포머 조작.
export class PlayerController extends Component {
  constructor({ speed = 160, jump = 520 } = {}) {
    super();
    this.speed = speed;
    this.jumpSpeed = jump;
    this.accel = speed * 9;
    this.coyote = 0;
    this.buffer = 0;
    this.facing = 1;
  }

  update(dt, { input, engine }) {
    const body = this.entity.get(Body);
    if (!body) return;
    const dir = input.axisX();
    if (dir) this.facing = dir;

    const delta = dir * this.speed - body.vel.x;
    body.vel.x += Math.sign(delta) * Math.min(Math.abs(delta), this.accel * dt);

    this.coyote = body.onGround ? 0.1 : this.coyote - dt;
    this.buffer = input.wasPressed('Space', 'KeyW', 'ArrowUp') ? 0.12 : this.buffer - dt;

    if (this.buffer > 0 && this.coyote > 0) {
      body.vel.y = -this.jumpSpeed;
      this.buffer = 0;
      this.coyote = 0;
      engine.synth.beep({ freq: 300, toFreq: 600, duration: 0.12 });
    }
    if (body.vel.y < 0 && !input.isDown('Space', 'KeyW', 'ArrowUp')) body.vel.y *= 0.85;
  }

  render(r) {
    const e = this.entity;
    if (e.get(Shape)?.emoji) return;
    const eyeX = this.facing > 0 ? e.right - 5 : e.left + 2;
    r.rect(eyeX, e.top + 4, 3, 3, '#14141c');
  }
}

// 벽이나 낭떠러지를 만나면 방향을 바꾼다.
export class Patrol extends Component {
  constructor({ speed = 50 } = {}) {
    super();
    this.dir = 1;
    this.speed = speed;
  }

  update(_dt, { scene }) {
    const e = this.entity;
    const body = e.get(Body);
    if (!body) return;
    if (body.touching.left) this.dir = 1;
    if (body.touching.right) this.dir = -1;
    if (body.onGround) {
      const x = this.dir > 0 ? e.right : e.left - 1;
      const probe = { left: x, right: x + 1, top: e.bottom + 1, bottom: e.bottom + 2 };
      if (!scene.findByTag('solid').some((s) => overlaps(probe, s))) this.dir *= -1;
    }
    body.vel.x = this.dir * this.speed;
  }
}

// 사용자 스크립트. 코드는 { start(self, game), update(self, dt, game) } 객체를 반환한다.
export class Script extends Component {
  constructor({ code = '' } = {}) {
    super();
    this.code = code;
    this.hooks = null;
    this.failed = false;
  }

  fail(scene, phase, err) {
    this.failed = true;
    scene.log?.(`[스크립트 오류] ${this.entity.name} (${phase}): ${err.message}`, 'error');
  }

  update(dt, { scene }) {
    if (this.failed) return;
    const api = scene.api;
    if (!this.hooks) {
      try {
        this.hooks = new Function(this.code)() || {};
        this.hooks.start?.(this.entity, api);
      } catch (err) {
        return this.fail(scene, 'start', err);
      }
    }
    try {
      this.hooks.update?.(this.entity, dt, api);
    } catch (err) {
      this.fail(scene, 'update', err);
    }
  }
}

export const DEFAULT_SCRIPT = `// self: 이 오브젝트 (self.pos, self.size, self.body, self.destroy())
// game: { input, dt, time, score, find(name), findByTag(tag), log(msg), restart(), goto(sceneName) }
return {
  start(self, game) {
    this.originX = self.pos.x;
  },
  update(self, dt, game) {
    // 예: 좌우로 왕복
    self.pos.x = this.originX + Math.sin(game.time * 2) * 32;
  },
};
`;

export const behaviors = {
  Solid: {
    label: '고체 (충돌 벽)',
    fields: [],
    create: (_p, e) => { e.tags.add('solid'); },
  },
  Body: {
    label: '물리 바디',
    fields: [
      { key: 'gravity', label: '중력 적용', type: 'bool', default: true },
      { key: 'friction', label: '마찰', type: 'number', default: 0 },
    ],
    create: (p) => new Body({ gravity: p.gravity, friction: p.friction }),
  },
  PlayerController: {
    label: '플레이어 조작',
    fields: [
      { key: 'speed', label: '이동 속도', type: 'number', default: 160 },
      { key: 'jump', label: '점프 힘', type: 'number', default: 520 },
    ],
    create: (p, e) => { e.tags.add('player'); return new PlayerController(p); },
  },
  Patrol: {
    label: '순찰 이동',
    fields: [{ key: 'speed', label: '속도', type: 'number', default: 50 }],
    create: (p) => new Patrol(p),
  },
  Collectible: {
    label: '수집 아이템',
    fields: [{ key: 'score', label: '점수', type: 'number', default: 1 }],
    create: (p, e) => { e.tags.add('collectible'); e.scoreValue = p.score; },
  },
  Hazard: {
    label: '위험 요소',
    fields: [{ key: 'stompable', label: '밟아서 처치 가능', type: 'bool', default: false }],
    create: (p, e) => { e.tags.add('hazard'); if (p.stompable) e.tags.add('stompable'); },
  },
  Spring: {
    label: '점프대',
    fields: [{ key: 'power', label: '튕기는 힘', type: 'number', default: 750 }],
    create: (p, e) => { e.tags.add('spring'); e.springPower = p.power; },
  },
  Goal: {
    label: '목표 지점',
    fields: [{ key: 'next', label: '다음 씬 (비우면 다음 순서)', type: 'scene', default: '' }],
    create: (p, e) => { e.tags.add('goal'); e.nextScene = p.next; },
  },
  Script: {
    label: '스크립트',
    fields: [{ key: 'code', label: '코드', type: 'code', default: DEFAULT_SCRIPT }],
    create: (p) => new Script(p),
  },
};

export function defaultProps(type) {
  const props = {};
  for (const f of behaviors[type].fields) props[f.key] = f.default;
  return props;
}
