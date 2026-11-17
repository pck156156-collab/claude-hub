import * as THREE from 'three';
import { CAMERA_CONFIG } from '../config.js';
import { clamp, damp, lerp, lerpAngle } from '../utils/math.js';

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
    this.position.copy(this._desired);
    this.lookTarget.copy(this._look);
    this.camera.fov = this.config.baseFov;
    this.camera.updateProjectionMatrix();
    this.apply();
  }

  update(dt, target, heading, speedRatio) {
    const c = this.config;
    this.yaw = lerpAngle(this.yaw, heading, damp(c.yawSharpness, dt));
    this.speedRatio = lerp(this.speedRatio, clamp(speedRatio, 0, 1), damp(c.fovSharpness, dt));
    this.computeDesired(target, this.yaw, this.speedRatio);
    this.position.lerp(this._desired, damp(c.positionSharpness, dt));
    this.lookTarget.lerp(this._look, damp(c.lookSharpness, dt));

    const fov = c.baseFov + c.maxFovBoost * this.speedRatio;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.apply();
  }

  apply() {
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookTarget);
  }
}
