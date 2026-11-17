import { EFFECTS_CONFIG } from '../config.js';
import { TireSmoke } from './TireSmoke.js';
import { SkidMarks } from './SkidMarks.js';

const REAR_WHEELS = [
  { side: 0.86, along: -1.32 },
  { side: -0.86, along: -1.32 },
];

/**
 * 차량의 실제 미끄러짐 상태(driftIntensity)를 읽어 뒷바퀴에서 연기·스키드 마크를 만든다.
 * 렌더 프레임마다 호출되며, 생성량은 시간 기반(초당 생성 수)이라 프레임 속도와 무관하다.
 */
export class DriftEffects {
  constructor(scene, track, config = EFFECTS_CONFIG) {
    this.config = config;
    this.track = track;
    this._info = { index: 0, lateral: 0, rightX: 0, rightZ: 0 };
    this.smoke = new TireSmoke(scene, config.smoke);
    this.skids = new SkidMarks(scene, config.skidMarks);
    this.tracked = new Map(); // vehicle → { trails, spawnAcc }
  }

  setViewport(heightPx, fovDeg) {
    this.smoke.setViewport(heightPx, fovDeg);
  }

  stateFor(vehicle) {
    let s = this.tracked.get(vehicle);
    if (!s) {
      s = { trails: REAR_WHEELS.map(() => this.skids.createTrail()), spawnAcc: [0, 0] };
      this.tracked.set(vehicle, s);
    }
    return s;
  }

  /** 차량 리셋 시 해당 차량의 자국 연결을 끊는다 */
  resetVehicle(vehicle) {
    const s = this.stateFor(vehicle);
    s.trails.forEach((t) => (t.active = false));
    s.spawnAcc.fill(0);
  }

  update(dt, vehicles) {
    for (const v of vehicles) this.updateVehicle(dt, v);
    this.smoke.update(dt);
    this.skids.update();
  }

  updateVehicle(dt, v) {
    const s = this.stateFor(v);
    const root = v.model.root;
    const h = root.rotation.y;
    const sH = Math.sin(h);
    const cH = Math.cos(h);
    const intensity = v.driftIntensity;
    const sc = this.config.smoke;

    REAR_WHEELS.forEach((w, i) => {
      // 차체 기준 [전후 along, 좌우 side(+ = 왼쪽)] → 월드
      const x = root.position.x + sH * w.along + cH * w.side;
      const z = root.position.z + cH * w.along - sH * w.side;

      // 바퀴별 노면 판정: 스키드 마크는 아스팔트 위에만, 잔디에서는 연기만 약하게
      // 연석도 포함 (노면 판정과 같은 폭). 연석 위에서는 자국을 살짝 높여 묻히지 않게
      const info = this.track.getInfo(x, z, this._info, v.trackHint);
      const lat = Math.abs(info.lateral);
      const onAsphalt = lat <= this.track.surfaceHalfWidth(info.index) + 0.1;
      this.skids.addPoint(s.trails[i], x, z, onAsphalt ? intensity : 0, lat > this.track.halfWidth ? 0.072 : 0.045);
      const smokeAmount = onAsphalt ? intensity : intensity * sc.offRoadFactor;

      if (smokeAmount > 0.05 && dt > 0) {
        s.spawnAcc[i] += sc.spawnRate * smokeAmount * dt;
        while (s.spawnAcc[i] >= 1) {
          s.spawnAcc[i] -= 1;
          const r = () => (Math.random() - 0.5) * 1.6;
          this.smoke.emit(
            x + r() * 0.2, 0.3, z + r() * 0.2,
            v.velocity.x * 0.25 + r(), 0.4 + Math.random() * 0.4, v.velocity.z * 0.25 + r(),
            Math.min(0.35 + smokeAmount * 0.65, 1),
          );
        }
      } else {
        s.spawnAcc[i] = 0;
      }
    });
  }
}
