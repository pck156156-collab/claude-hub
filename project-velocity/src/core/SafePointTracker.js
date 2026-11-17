import * as THREE from 'three';
import { RECOVERY_CONFIG } from '../config.js';

/**
 * 차량 복구용 안전 지점 기록 (차량마다 하나 — 이후 AI 차량에도 그대로 사용 가능).
 * 도로 위에서, 중앙 근처를, 트랙 진행 방향으로, 미끄러지지 않고, 최근 벽 충돌 없이 달릴 때만
 * 해당 트랙 샘플을 안전 지점으로 기록한다.
 * 복구 위치는 그 지점보다 조금 뒤의 도로 중앙(방호벽에서 약 13m) + 트랙 진행 방향.
 */
export class SafePointTracker {
  constructor(track, config = RECOVERY_CONFIG) {
    this.track = track;
    this.config = config;
    this.index = -1;
    this.timer = 0;
    this.sinceWall = Infinity;
  }

  reset(index = -1) {
    this.index = index;
    this.timer = 0;
    this.sinceWall = Infinity;
  }

  update(dt, vehicle) {
    this.sinceWall = vehicle.touchingWall ? 0 : this.sinceWall + dt;
    this.timer += dt;
    if (this.timer < this.config.sampleInterval) return;
    this.timer = 0;
    if (this.isSafe(vehicle)) this.index = vehicle.trackInfo.index;
  }

  isSafe(v) {
    const c = this.config;
    const info = v.trackInfo;
    const t = this.track.tangents[info.index];
    const align = Math.sin(v.heading) * t.x + Math.cos(v.heading) * t.z;
    return (
      v.onRoad &&
      this.sinceWall > c.wallCooldown &&
      Math.abs(info.lateral) < c.maxLateral &&
      Math.abs(v.slipAngle) < c.maxSlipAngle &&
      v.forwardSpeed > c.minForwardSpeed &&
      align > c.minHeadingAlign
    );
  }

  /** 복구 자세. 안전 지점이 없으면 fallback(출발 위치) */
  getRecoveryPose(fallback) {
    if (this.index < 0) return fallback;
    const n = this.track.count;
    const i = (this.index - this.config.backOffSamples + n) % n;
    const t = this.track.tangents[i];
    return {
      index: i,
      position: this.track.pointAt(i, 0, 0, new THREE.Vector3()),
      heading: Math.atan2(t.x, t.z),
    };
  }
}
