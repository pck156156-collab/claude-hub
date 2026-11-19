import * as THREE from 'three';
import { CAMERA_CONFIG } from '../config.js';
import { clamp, damp, lerp, lerpAngle, smoothstep, wrapAngle } from '../utils/math.js';

/**
 * 3인칭 추적 카메라.
 * 카메라 방향(yaw)이 차량 방향을 지수 보간으로 뒤따라가므로
 * 선회 시 차가 화면에서 살짝 돌아 보이고, 급격한 흔들림이 생기지 않는다.
 */
export class ChaseCamera {
  constructor(camera, config = CAMERA_CONFIG) {
    this.camera = camera;
    this.config = config;
    this.yaw = 0;
    this.speedRatio = 0;
    this.position = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    // 차량 기준 상대 오프셋을 보간한다. 절대 위치를 보간하면 속도÷positionSharpness 만큼
    // 카메라가 뒤처져(최고속도에서 약 5m) 가속할수록 차가 작아지는 문제가 있었다.
    this.offset = new THREE.Vector3();
    this.lookOffset = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    // 충격 완충: 차량 '속도'를 짧게 보간해 기준점을 이동시킨다.
    // 프레임당 이동 거리가 아니라 속도(이동 거리 ÷ 프레임 시간)를 보간하므로 프레임 간격이 들쭉날쭉해도
    // 카메라 거리가 떨리지 않는다. 일정 속도에서는 지연이 없고, 벽 충돌 같은 급변만 흡수한다.
    this.base = new THREE.Vector3();
    this.prevTarget = new THREE.Vector3();
    this.baseVelocity = new THREE.Vector3();
    this._delta = new THREE.Vector3();
  }

  computeDesired(target, yaw, speedRatio) {
    const c = this.config;
    const dist = c.distance + c.distanceAtSpeed * speedRatio;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    this._desired.set(target.x - fx * dist, target.y + c.height, target.z - fz * dist);
    this._look.set(target.x + fx * c.lookAhead, target.y + c.lookHeight, target.z + fz * c.lookAhead);
  }

  /** 즉시 차량 뒤로 이동 (시작 / 리셋 시) */
  snap(target, heading) {
    this.yaw = heading;
    this.speedRatio = 0;
    this.computeDesired(target, heading, 0);
    this.offset.subVectors(this._desired, target);
    this.lookOffset.subVectors(this._look, target);
    this.base.copy(target);
    this.prevTarget.copy(target);
    this.baseVelocity.set(0, 0, 0);
    this.position.copy(this._desired);
    this.lookTarget.copy(this._look);
    this.camera.fov = this.config.baseFov;
    this.camera.updateProjectionMatrix();
    this.apply();
  }

  /**
   * target: 차량 렌더 위치, heading: 차체 방향, speedRatio: 0~1,
   * velocity: 실제 진행 속도 벡터, forwardSpeed: 차체 기준 전진 속도
   */
  update(dt, target, heading, speedRatio, velocity, forwardSpeed) {
    const c = this.config;
    // 목표 방향: 차체 방향 + (드리프트 시) 실제 진행 방향 쪽으로 일부 이동
    // → 미끄러질 때 차가 화면 밖으로 밀려나지 않고, 정지·저속·후진에서는 차체 방향만 사용
    let targetYaw = heading;
    if (velocity && forwardSpeed > 0) {
      const spd = Math.hypot(velocity.x, velocity.z);
      const w = c.velocityFollow * smoothstep(c.velocityFollowMinSpeed, c.velocityFollowFullSpeed, spd);
      if (w > 0) targetYaw = lerpAngle(heading, Math.atan2(velocity.x, velocity.z), w);
    }
    // 회전 속도 상한: 스핀·급격한 드리프트에서도 카메라가 휙 돌지 않게 (지연 각도 제한이 최종 안전장치)
    const yawStep = wrapAngle(targetYaw - this.yaw) * damp(c.yawSharpness, dt);
    const maxStep = c.maxYawSpeed * dt;
    this.yaw += clamp(yawStep, -maxStep, maxStep);
    // 급격한 회전 시에도 목표에서 너무 멀어지지 않도록 지연 각도 제한
    const lag = wrapAngle(this.yaw - targetYaw);
    if (Math.abs(lag) > c.maxYawLag) this.yaw = targetYaw + Math.sign(lag) * c.maxYawLag;
    this.speedRatio = lerp(this.speedRatio, clamp(speedRatio, 0, 1), damp(c.fovSharpness, dt));
    this.computeDesired(target, this.yaw, this.speedRatio);
    this.offset.lerp(this._tmp.subVectors(this._desired, target), damp(c.positionSharpness, dt));
    this.lookOffset.lerp(this._tmp.subVectors(this._look, target), damp(c.lookSharpness, dt));
    this.followTarget(dt, target);
    this.position.addVectors(this.base, this.offset);
    this.lookTarget.addVectors(this.base, this.lookOffset);

    const fov = c.baseFov + c.maxFovBoost * this.speedRatio;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.apply();
  }

  followTarget(dt, target) {
    const c = this.config;
    const delta = this._delta.subVectors(target, this.prevTarget);
    this.prevTarget.copy(target);
    if (delta.lengthSq() > 100 || dt <= 0) {
      // 순간이동(복구 등) 또는 시간 정지: 완충 없이 바로 따라감
      this.base.copy(target);
      if (dt <= 0) return;
      this.baseVelocity.set(0, 0, 0);
      return;
    }
    this.baseVelocity.lerp(delta.divideScalar(dt), damp(c.impactSmoothing, dt));
    this.base.addScaledVector(this.baseVelocity, dt);
    this.base.lerp(target, damp(c.positionSharpness, dt));
  }

  apply() {
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookTarget);
  }
}
