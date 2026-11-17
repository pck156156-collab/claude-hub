import * as THREE from 'three';
import { createCarModel } from './CarModel.js';
import { clamp, lerp, moveTowards, lerpAngle, damp } from '../utils/math.js';

/**
 * 아케이드 주행 차량.
 *
 * 상태값 (서로 독립적으로 관리):
 *   position  — 월드 위치 (Vector3, y=0 평면 주행)
 *   heading   — 진행 방향 각도 (rad). 앞 방향 = (sin h, 0, cos h)
 *   velocity  — 월드 속도 벡터 (m/s). 차체 방향과 다를 수 있어 미끄러짐을 표현한다.
 *
 * step() 은 고정 시간 간격으로 호출되고, updateVisual() 은 렌더 프레임마다
 * 직전/현재 물리 상태를 보간해 모델에 반영한다.
 */
export class Vehicle {
  constructor({ config, color } = {}) {
    this.config = config;
    this.model = createCarModel({ color });

    this.position = new THREE.Vector3();
    this.heading = 0;
    this.velocity = new THREE.Vector3();

    this.steer = 0; // 부드럽게 보간된 조향값 -1 ~ 1
    this.forwardSpeed = 0; // 차체 기준 전진 속도 (후진 시 음수)
    this.lateralSpeed = 0;
    this.longitudinalAccel = 0;
    this.lateralAccel = 0;
    this.onRoad = true;
    this.touchingWall = false;
    this.braking = false;
    this.wheelSpin = 0;

    this.prevPosition = new THREE.Vector3();
    this.prevHeading = 0;
    this.visualPitch = 0;
    this.visualRoll = 0;
    this.trackInfo = { index: 0, lateral: 0, rightX: 0, rightZ: 0 };
  }

  /** 속도계 표시값: 실제 이동 속도 (드리프트 중에도 자연스럽게) */
  get speedKmh() {
    return Math.hypot(this.velocity.x, this.velocity.z) * 3.6;
  }

  /** 위치·방향·속도·조향을 모두 초기화 */
  reset(pose) {
    this.position.copy(pose.position);
    this.heading = pose.heading;
    this.velocity.set(0, 0, 0);
    this.steer = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.longitudinalAccel = 0;
    this.lateralAccel = 0;
    this.braking = false;
    this.touchingWall = false;
    this.prevPosition.copy(this.position);
    this.prevHeading = this.heading;
    this.visualPitch = 0;
    this.visualRoll = 0;
    this.updateVisual(1, 0);
  }

  step(dt, controls, track) {
    const c = this.config;
    this.prevPosition.copy(this.position);
    this.prevHeading = this.heading;

    // ── 노면 판정 ─────────────────────────────────────────────
    const info = track.getInfo(this.position.x, this.position.z, this.trackInfo);
    this.onRoad = Math.abs(info.lateral) <= track.halfWidth + c.roadEdgeTolerance;

    // ── 조향 입력 보간 (키를 눌러도 바퀴가 서서히 꺾임) ─────────
    const targetSteer = clamp(controls.steer, -1, 1);
    const returning = targetSteer === 0 || Math.sign(targetSteer) !== Math.sign(this.steer);
    this.steer = moveTowards(this.steer, targetSteer, (returning ? c.steerReturnRate : c.steerRate) * dt);

    // ── 속도를 차체 기준 전진/측면 성분으로 분해 ────────────────
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    let vf = this.velocity.x * sinH + this.velocity.z * cosH;
    let vl = -this.velocity.x * cosH + this.velocity.z * sinH; // + = 오른쪽
    const startVf = vf;

    const { throttle, brake, handbrake } = controls;
    const bothPressed = throttle > 0 && brake > 0;

    // ── 가속 / 제동 / 후진 ────────────────────────────────────
    if (bothPressed) {
      vf = moveTowards(vf, 0, c.brakeDeceleration * dt);
    } else if (throttle > 0) {
      if (vf >= -0.5) {
        const r = clamp(vf / c.maxSpeed, 0, 1);
        vf += c.acceleration * (1 - c.accelerationFalloff * r * r) * throttle * dt;
      } else {
        vf = moveTowards(vf, 0, c.brakeDeceleration * throttle * dt); // 후진 중 W = 제동
      }
    } else if (brake > 0) {
      if (vf > 0.5) vf = moveTowards(vf, 0, c.brakeDeceleration * brake * dt);
      else vf -= c.reverseAcceleration * brake * dt;
    }
    this.braking = bothPressed || handbrake || (brake > 0 && startVf > 0.5);

    // ── 자연 감속 (구름 저항 + 공기 저항 + 엔진 브레이크) ───────
    const absV = Math.abs(vf);
    let decel = c.rollingResistance + c.airDrag * absV * absV;
    if (throttle === 0 && brake === 0) decel += c.engineBraking;
    if (!this.onRoad) decel += c.offRoadDrag;
    if (handbrake) decel += c.handbrakeDeceleration;
    vf = moveTowards(vf, 0, decel * dt);

    // 도로 밖: 속도 상한까지 강하게 감속
    if (!this.onRoad && Math.abs(vf) > c.offRoadMaxSpeed) {
      vf = moveTowards(vf, Math.sign(vf) * c.offRoadMaxSpeed, c.offRoadDeceleration * dt);
    }
    vf = clamp(vf, -c.maxReverseSpeed, c.maxSpeed);

    // ── 측면 접지력 ───────────────────────────────────────────
    let grip = handbrake ? c.handbrakeGrip : c.lateralGrip;
    if (!this.onRoad) grip *= c.offRoadGripFactor;
    vl *= Math.exp(-grip * dt);

    // ── 선회: 속도에 비례 (정지 시 회전 불가), 고속에서 둔해짐 ───
    const speedAbs = Math.abs(vf);
    const lowSpeedFactor = Math.min(speedAbs / c.steerFullSpeed, 1);
    const highSpeedFactor = lerp(1, c.highSpeedSteerFactor, clamp(speedAbs / c.maxSpeed, 0, 1));
    let yawRate = this.steer * c.maxYawRate * lowSpeedFactor * highSpeedFactor * Math.sign(vf);
    if (handbrake && speedAbs > 2) yawRate *= c.handbrakeSteerBoost;
    const dYaw = yawRate * dt; // + = 우회전
    this.heading -= dYaw;

    // 속도 벡터는 차체 회전의 일부만 따라감 → 나머지는 미끄러짐(측면 속도)이 되어 접지력으로 소멸
    const align = handbrake ? c.handbrakeVelocityAlign : c.velocityAlign;
    const frameH = this.heading + dYaw * (1 - align);
    const sF = Math.sin(frameH);
    const cF = Math.cos(frameH);
    this.velocity.x = vf * sF - vl * cF;
    this.velocity.z = vf * cF + vl * sF;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // ── 가드레일 충돌 ─────────────────────────────────────────
    this.touchingWall = false;
    track.getInfo(this.position.x, this.position.z, info);
    const limit = track.railOffset - c.halfWidth;
    if (Math.abs(info.lateral) > limit) {
      const side = Math.sign(info.lateral);
      const nx = info.rightX * side;
      const nz = info.rightZ * side;
      const penetration = Math.abs(info.lateral) - limit;
      this.position.x -= nx * penetration;
      this.position.z -= nz * penetration;
      const vn = this.velocity.x * nx + this.velocity.z * nz;
      if (vn > 0) {
        this.velocity.x -= nx * vn * (1 + c.wallRestitution);
        this.velocity.z -= nz * vn * (1 + c.wallRestitution);
        const loss = 1 - Math.min(vn / c.maxSpeed, 1) * c.wallImpactLoss;
        this.velocity.x *= loss;
        this.velocity.z *= loss;
      }
      const scrape = Math.exp(-c.wallFriction * dt);
      this.velocity.x *= scrape;
      this.velocity.z *= scrape;
      this.touchingWall = true;
    }

    // ── 파생 상태값 ───────────────────────────────────────────
    const sN = Math.sin(this.heading);
    const cN = Math.cos(this.heading);
    this.forwardSpeed = this.velocity.x * sN + this.velocity.z * cN;
    this.lateralSpeed = -this.velocity.x * cN + this.velocity.z * sN;
    this.longitudinalAccel = (this.forwardSpeed - startVf) / dt;
    this.lateralAccel = this.forwardSpeed * yawRate;
    this.wheelSpin = (this.wheelSpin + (this.forwardSpeed * dt) / c.wheelRadius) % (Math.PI * 2);
  }

  /** alpha: 직전 물리 스텝과 현재 스텝 사이의 보간 비율 */
  updateVisual(alpha, dt) {
    const c = this.config;
    const m = this.model;
    m.root.position.lerpVectors(this.prevPosition, this.position, alpha);
    m.root.rotation.y = lerpAngle(this.prevHeading, this.heading, alpha);

    const targetPitch = clamp(-this.longitudinalAccel * c.visualPitchFactor, -0.05, 0.05);
    const targetRoll = clamp(-this.lateralAccel * c.visualRollFactor, -0.05, 0.05);
    const k = dt > 0 ? damp(6, dt) : 1;
    this.visualPitch = lerp(this.visualPitch, targetPitch, k);
    this.visualRoll = lerp(this.visualRoll, targetRoll, k);

    m.setBodyTilt(this.visualPitch, this.visualRoll);
    m.setWheelState(-this.steer * c.maxVisualSteerAngle, this.wheelSpin);
    m.setBrakeLights(this.braking);
  }
}
