import { EFFECTS_CONFIG } from '../config.js';
import { TireSmoke } from './TireSmoke.js';
import { smoothstep } from '../utils/math.js';

/**
 * 배기 효과: 가속 페달을 밟을 때(특히 저·중속) 배기구에서 옅은 연기.
 * 드리프트 연기와 별도 풀(개수 상한)을 사용해 서로 간섭하지 않는다.
 */
export class ExhaustEffects {
  constructor(scene, config = EFFECTS_CONFIG.exhaust) {
    this.config = config;
    this.particles = new TireSmoke(scene, config);
    this.acc = new Map();
    this.spawnScale = 1; // 그래픽 품질에 따른 생성량 배율
  }

  setViewport(heightPx, fovDeg) {
    this.particles.setViewport(heightPx, fovDeg);
  }

  update(dt, vehicles) {
    if (dt > 0) for (const v of vehicles) this.emitFor(dt, v);
    this.particles.update(dt);
  }

  emitFor(dt, v) {
    const c = this.config;
    const outlets = v.model.exhaustOutlets;
    if (!outlets) return;
    const spd = v.speed;
    const accel = v.throttleInput * (1 - smoothstep(c.fadeSpeedStart, c.fadeSpeedEnd, spd));
    const amount = Math.max(accel, spd < 1 ? c.idleAmount : 0);
    let acc = this.acc.get(v) ?? 0;
    if (amount <= 0.01) {
      this.acc.set(v, 0);
      return;
    }
    acc += c.spawnRate * this.spawnScale * amount * outlets.length * dt;
    const root = v.model.root;
    const h = root.rotation.y;
    const sH = Math.sin(h);
    const cH = Math.cos(h);
    let k = 0;
    while (acc >= 1) {
      acc -= 1;
      const o = outlets[k++ % outlets.length];
      // 로컬(x = 왼쪽, z = 앞) → 월드: 앞(sH, cH), 왼쪽(cH, -sH)
      const x = root.position.x + sH * o.z + cH * o.x;
      const z = root.position.z + cH * o.z - sH * o.x;
      const back = 1.2 + Math.random() * 0.8;
      const jitter = () => (Math.random() - 0.5) * 0.5;
      this.particles.emit(
        x, o.y, z,
        -sH * back + v.velocity.x * 0.6 + jitter(), 0.25 + Math.random() * 0.25, -cH * back + v.velocity.z * 0.6 + jitter(),
        0.4 + 0.6 * amount,
      );
    }
    this.acc.set(v, acc);
  }
}
