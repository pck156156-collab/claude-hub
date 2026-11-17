import * as THREE from 'three';
import { createCarModel } from './CarModel.js';
import { clamp, lerp, moveTowards, lerpAngle, smoothstep } from '../utils/math.js';

export const GEAR_DRIVE = 1;
export const GEAR_REVERSE = -1;

/**
 * 타이어 횡력 곡선: 슬립각이 peak 까지는 선형으로 증가하고,
 * 넘어서면 미끄럼 마찰(slidingFriction)까지 떨어진다. 반환값은 슬립 반대 방향의 가속도.
 */
function tireForce(slipAngle, maxForce, tires) {
  const x = slipAngle / tires.peakSlipAngle;
  const ax = Math.abs(x);
  const k = ax < 1 ? ax : lerp(1, tires.slidingFriction, smoothstep(1, tires.slideFalloff, ax));
  return -Math.sign(x) * maxForce * k;
}

/**
 * 아케이드용 간소화 자동차 물리 (2륜 자전거 모델 기반).
 *
 * 상태값:
 *   position — 월드 위치 (y=0 평면)
 *   heading  — 차체가 바라보는 방향 (rad). 앞 = (sin h, 0, cos h)
 *   velocity — 실제 진행 속도 벡터 (m/s). 차체 방향과 다를 수 있다 → 미끄러짐
 *   yawRate  — 요 각속도 (rad/s, + = 우회전). 회전 관성으로 서서히 변한다
 *
 * 매 스텝: 속도를 차체 기준 종/횡 성분으로 분해 → 엔진·제동·저항(종방향) →
 *   앞/뒤 타이어 슬립각으로 횡력 계산 → 횡가속·요 가속 적분 → 이동 + 가드레일 충돌
 *
 * 차체 기울기·바퀴 애니메이션은 updateVisual() 에서만 처리하며 물리 좌표에 영향을 주지 않는다.
 */
export class Vehicle {
  constructor({ config, appearance } = {}) {
    this.config = config;
    this.model = createCarModel(appearance);

    // ── 물리 상태 ──
    this.position = new THREE.Vector3();
    this.heading = 0;
    this.velocity = new THREE.Vector3();
    this.yawRate = 0;
    this.steerInput = 0; // 보간된 조향 입력 -1 ~ 1
    this.steerAngle = 0; // 실제 앞바퀴 조향각 (rad, + = 오른쪽)
    this.gear = GEAR_DRIVE;
    this.gearTimer = 0;
    this.rearGrip = 1; // 핸드브레이크에 의한 뒷바퀴 접지력 배율 (1 = 정상)

    // ── 파생 상태 (읽기 전용: HUD·카메라·효과에서 사용) ──
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.slipAngle = 0; // 차체 슬립각 (진행 방향과 차체 방향의 차이)
    this.rearSlipSpeed = 0; // 뒷차축 횡미끄러짐 속도
    this.rearSlipAngle = 0; // 뒷차축 슬립각 (rad)
    this.driftIntensity = 0; // 0 ~ 1
    this.longitudinalAccel = 0;
    this.lateralAccel = 0;
    this.onRoad = true;
    this.touchingWall = false;
    this.lastImpactSpeed = 0;
    this.braking = false;
    this.handbrakeOn = false;
    this.throttleInput = 0; // 배기 효과 연동용
    this.frontSpin = 0;
    this.rearSpin = 0;

    // ── 렌더 보간 / 차체 움직임 ──
    this.prevPosition = new THREE.Vector3();
    this.prevHeading = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.roll = 0;
    this.rollVel = 0;

    this.trackInfo = { index: 0, lateral: 0, rightX: 0, rightZ: 0 };
    this.trackHint = -1;
    this._probeInfo = { index: 0, lateral: 0, rightX: 0, rightZ: 0 };

    // 가드레일 충돌 검사점: 네 모서리 + 좌우 측면 중앙 (차체 기준 [전후, 좌우])
    const { halfWidth: hw, halfLength: hl } = config.dimensions;
    this.probes = [
      [hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [0, hw], [0, -hw],
    ];
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** 속도계 표시값: 실제 이동 속도 (드리프트 중에도 자연스럽게) */
  get speedKmh() {
    return this.speed * 3.6;
  }

  /** 위치·방향·속도·회전·조향·기어를 모두 초기화 */
  reset(pose) {
    this.position.copy(pose.position);
    this.heading = pose.heading;
    this.velocity.set(0, 0, 0);
    this.yawRate = 0;
    this.steerInput = 0;
    this.steerAngle = 0;
    this.gear = GEAR_DRIVE;
    this.gearTimer = 0;
    this.rearGrip = 1;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.slipAngle = 0;
    this.rearSlipSpeed = 0;
    this.rearSlipAngle = 0;
    this.driftIntensity = 0;
    this.longitudinalAccel = 0;
    this.lateralAccel = 0;
    this.braking = false;
    this.handbrakeOn = false;
    this.throttleInput = 0;
    this.touchingWall = false;
    this.lastImpactSpeed = 0;
    this.trackHint = pose.index ?? -1;
    this.onRoad = true;
    this.prevPosition.copy(this.position);
    this.prevHeading = this.heading;
    this.pitch = this.pitchVel = this.roll = this.rollVel = 0;
    this.updateVisual(1, 0);
  }

  step(dt, controls, track) {
    const c = this.config;
    const dim = c.dimensions;
    const eng = c.engine;
    const ty = c.tires;
    const st = c.steering;
    this.prevPosition.copy(this.position);
    this.prevHeading = this.heading;

    // ── 노면 판정 ─────────────────────────────────────────────
    const info = track.getInfo(this.position.x, this.position.z, this.trackInfo, this.trackHint);
    this.trackHint = info.index;
    // 노면 판정: 아스팔트 + 연석(있는 구간)을 도로로 본다 → 그래픽과 판정 일치
    const surfaceHalf = track.surfaceHalfWidth ? track.surfaceHalfWidth(info.index) : track.halfWidth;
    this.onRoad = Math.abs(info.lateral) <= surfaceHalf + c.surface.roadEdgeTolerance;

    // ── 속도 분해 (차체 기준: 종방향 vf, 횡방향 vl(+ = 오른쪽)) ──
    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    let vf = this.velocity.x * sinH + this.velocity.z * cosH;
    let vl = -this.velocity.x * cosH + this.velocity.z * sinH;
    const startVf = vf;
    const speed = Math.hypot(vf, vl);
    const absVf = Math.abs(vf);
    const { throttle, brake, handbrake } = controls;
    this.throttleInput = throttle;

    // ── 조향: 입력 보간 → 속도에 따른 최대 조향각 제한 ─────────
    const targetSteer = clamp(controls.steer, -1, 1);
    const returning = targetSteer === 0 || Math.sign(targetSteer) !== Math.sign(this.steerInput);
    this.steerInput = moveTowards(
      this.steerInput, targetSteer, (returning ? st.returnSpeed : st.steerSpeed) * dt,
    );
    const totalGrip = ty.frontGrip + ty.rearGrip;
    let maxAngle = Math.min(
      st.maxAngle,
      (st.speedLimitFactor * totalGrip * dim.wheelBase) / Math.max(absVf * absVf, 1e-3) + st.speedLimitMargin,
    );
    // 카운터스티어: 미끄러지는 쪽으로 조향할 때는 슬립각만큼 추가 조향 허용
    if (Math.abs(vl) > 0.5 && Math.sign(this.steerInput) === Math.sign(vl)) {
      maxAngle = Math.min(st.maxAngle, maxAngle + Math.abs(this.slipAngle));
    }
    if (vf < 0) maxAngle *= st.reverseAngleFactor; // 후진은 완만하게
    this.steerAngle = this.steerInput * maxAngle;

    // ── 종방향: 기어(전진/후진), 가속, 제동 ───────────────────
    const accelPedal = this.gear === GEAR_DRIVE ? throttle : brake;
    const brakePedal = this.gear === GEAR_DRIVE ? brake : throttle;
    this.braking = false;
    if (throttle > 0 && brake > 0) {
      vf = moveTowards(vf, 0, c.brakes.deceleration * dt);
      this.braking = absVf > eng.stopSpeed;
      this.gearTimer = 0;
    } else if (brakePedal > 0) {
      // 진행 반대 페달: 정지할 때까지 제동, 정지 후 계속 밟고 있으면 기어 전환
      vf = moveTowards(vf, 0, c.brakes.deceleration * brakePedal * dt);
      if (absVf > eng.stopSpeed) {
        this.braking = true;
        this.gearTimer = 0;
      } else {
        this.gearTimer += dt;
        if (this.gearTimer >= eng.gearChangeDelay) {
          this.gear = -this.gear;
          this.gearTimer = 0;
        }
      }
    } else if (accelPedal > 0) {
      this.gearTimer = 0;
      if (this.gear === GEAR_DRIVE) {
        if (vf < -eng.stopSpeed) vf = moveTowards(vf, 0, c.brakes.deceleration * dt);
        else {
          const r = clamp(vf / eng.maxSpeed, 0, 1);
          vf += eng.acceleration * (1 - eng.accelerationFalloff * r * r) * accelPedal * dt;
        }
      } else if (vf > eng.stopSpeed) {
        vf = moveTowards(vf, 0, c.brakes.deceleration * dt);
      } else {
        vf -= eng.reverseAcceleration * accelPedal * dt;
      }
    } else {
      this.gearTimer = 0;
    }

    // ── 자연 감속 (구름 저항 + 공기 저항 + 엔진 브레이크 + 노면) ──
    let decel = c.drag.rolling + c.drag.air * vf * vf;
    if (throttle === 0 && brake === 0) decel += c.drag.engineBraking;
    if (!this.onRoad) decel += c.surface.offRoadDrag;
    this.handbrakeOn = handbrake;
    if (handbrake) {
      decel += c.handbrake.deceleration;
      if (absVf > eng.stopSpeed) this.braking = true;
    }
    vf = moveTowards(vf, 0, decel * dt);
    if (!this.onRoad && Math.abs(vf) > c.surface.offRoadMaxSpeed) {
      vf = moveTowards(vf, Math.sign(vf) * c.surface.offRoadMaxSpeed, c.surface.offRoadDeceleration * dt);
    }
    vf = clamp(vf, -eng.maxReverseSpeed, eng.maxSpeed);

    // ── 핸드브레이크: 뒷바퀴 접지력 감소 / 해제 시 점진 회복 ─────
    const hb = c.handbrake;
    const hbEffect = handbrake ? smoothstep(hb.minSpeed, hb.fullSpeed, speed) : 0;
    const targetRearGrip = lerp(1, hb.rearGripFactor, hbEffect);
    this.rearGrip = moveTowards(
      this.rearGrip, targetRearGrip, (targetRearGrip < this.rearGrip ? hb.engageRate : hb.recoveryRate) * dt,
    );

    // ── 타이어 횡력 (슬립각 기반) ─────────────────────────────
    const surfaceGrip = this.onRoad ? 1 : c.surface.offRoadGripFactor;
    const a = dim.cgToFront;
    const b = dim.cgToRear;
    const r = this.yawRate;
    const sD = Math.sin(this.steerAngle);
    const cD = Math.cos(this.steerAngle);

    // 앞바퀴: 조향된 바퀴 방향 기준으로 슬립 계산 (후진에도 동일하게 성립)
    const vlf = vl + r * a;
    const frontLat = -vf * sD + vlf * cD;
    const frontLon = vf * cD + vlf * sD;
    const alphaF = Math.atan2(frontLat, Math.max(Math.abs(frontLon), ty.minSlipSpeed));
    const ff = tireForce(alphaF, ty.frontGrip * surfaceGrip, ty);

    const vlr = vl - r * b;
    const alphaR = Math.atan2(vlr, Math.max(absVf, ty.minSlipSpeed));
    const fr = tireForce(alphaR, ty.rearGrip * surfaceGrip * this.rearGrip, ty);

    const latAccel = ff * cD + fr;
    vf += -ff * sD * dt; // 앞바퀴 횡력의 종방향 성분 (코너링 저항)
    vl += latAccel * dt;

    let yawAccel = (a * ff * cD - b * fr) / dim.yawInertia;

    // ── 안정화: 요 감쇠 + 과도한 슬립각 복원 ──────────────────
    const sb = c.stability;
    yawAccel -= sb.yawDamping * r;
    const beta = Math.atan2(vl, Math.max(absVf, 1));
    const over = Math.abs(beta) - sb.maxSlipAngle;
    if (over > 0 && vf > 0) yawAccel += Math.sign(beta) * over * sb.slipRecovery;

    this.yawRate += yawAccel * dt;

    // 저속·후진: 기구학 조향으로 부드럽게 전환 (정지 시 회전 없음, 수치 안정)
    // 미끄러지는 중에는 종방향 속도가 작아도 전체 속도가 크므로 전체 속도 기준으로 판단
    const w = vf < 0 ? 0 : smoothstep(ty.dynamicBlendStart, ty.dynamicBlendEnd, speed);
    if (w < 1) {
      const kinematicYaw = (vf * Math.tan(this.steerAngle)) / dim.wheelBase;
      this.yawRate = lerp(kinematicYaw, this.yawRate, w);
      vl = lerp(vl * Math.exp(-ty.lowSpeedLateralDamping * dt), vl, w);
    }
    this.yawRate = clamp(this.yawRate, -sb.maxYawRate, sb.maxYawRate);

    // 아케이드 보정 (전진 중에만): 속력은 유지하고 진행 방향만 차체 쪽으로 회전시킨다
    //  1) 핸드브레이크를 놓으면 회복된 접지력만큼 미끄러짐을 빠르게 정리
    //  2) 최종 안전장치: 슬립각 상한(hardSlipAngle)을 절대 넘지 않음
    if (vf > 0) {
      const slip = Math.atan2(vl, vf);
      let newSlip = handbrake ? slip : slip * Math.exp(-sb.recoveryAssist * this.rearGrip * dt);
      newSlip = clamp(newSlip, -sb.hardSlipAngle, sb.hardSlipAngle);
      if (newSlip !== slip) {
        const spd = Math.hypot(vf, vl);
        vf = spd * Math.cos(newSlip);
        vl = spd * Math.sin(newSlip);
      }
    }

    // ── 월드 속도로 재조합 → 회전 → 이동 (구간 검사 + 가드레일 충돌) ──
    this.velocity.x = vf * sinH - vl * cosH;
    this.velocity.z = vf * cosH + vl * sinH;
    this.heading -= this.yawRate * dt;

    this.touchingWall = false;
    this.lastImpactSpeed = 0;
    const moveX = this.velocity.x * dt;
    const moveZ = this.velocity.z * dt;
    const pieces = Math.max(1, Math.ceil(Math.hypot(moveX, moveZ) / c.collision.maxMovePerCheck));
    for (let k = 0; k < pieces; k++) {
      this.position.x += moveX / pieces;
      this.position.z += moveZ / pieces;
      this.resolveWalls(track);
    }

    // ── 파생 상태값 ───────────────────────────────────────────
    const sN = Math.sin(this.heading);
    const cN = Math.cos(this.heading);
    this.forwardSpeed = this.velocity.x * sN + this.velocity.z * cN;
    this.lateralSpeed = -this.velocity.x * cN + this.velocity.z * sN;
    this.slipAngle = Math.atan2(this.lateralSpeed, Math.max(Math.abs(this.forwardSpeed), 1));
    const rearLat = this.lateralSpeed - this.yawRate * b;
    this.rearSlipSpeed = Math.abs(rearLat);
    this.rearSlipAngle = Math.abs(Math.atan2(rearLat, Math.max(Math.abs(this.forwardSpeed), ty.minSlipSpeed)));
    this.longitudinalAccel = (this.forwardSpeed - startVf) / dt;
    this.lateralAccel = latAccel;

    const spd = this.speed;
    const df = c.drift;
    const slip =
      smoothstep(df.slipAngleStart, df.slipAngleFull, this.rearSlipAngle) *
      smoothstep(df.minSlipSpeed, df.minSlipSpeed * 2, this.rearSlipSpeed) *
      smoothstep(3, 8, spd);
    const lock = handbrake && spd > hb.minSpeed ? 0.55 * smoothstep(hb.minSpeed, 14, spd) : 0;
    this.driftIntensity = Math.max(slip, lock);

    const roll = (this.forwardSpeed * dt) / dim.wheelRadius;
    this.frontSpin = (this.frontSpin + roll) % (Math.PI * 2);
    if (!(handbrake && spd > 0.5)) this.rearSpin = (this.rearSpin + roll) % (Math.PI * 2); // 핸드브레이크: 뒷바퀴 잠김
  }

  /**
   * 가드레일 충돌: 차체 6개 검사점의 트랙 횡거리로 침투를 찾고,
   * 가장 깊은 점 기준으로 위치를 밀어내고 충격량(반발·마찰·회전)을 적용한다.
   */
  resolveWalls(track) {
    const col = this.config.collision;
    const dim = this.config.dimensions;
    const I = dim.yawInertia;
    const limit = track.railOffset + 0.05; // 레일 안쪽 면 (레일은 railOffset+0.15 위치)
    const probe = this._probeInfo;

    for (let pass = 0; pass < 2; pass++) {
      const sH = Math.sin(this.heading);
      const cH = Math.cos(this.heading);
      let maxPen = 0;
      let nx = 0;
      let nz = 0;
      let rx = 0;
      let rz = 0;
      for (const [along, side] of this.probes) {
        // 차체 기준 → 월드: 앞(sH, cH), 오른쪽(-cH, sH). side + = 왼쪽
        const ox = sH * along + cH * side;
        const oz = cH * along - sH * side;
        track.getInfo(this.position.x + ox, this.position.z + oz, probe, this.trackHint);
        const pen = Math.abs(probe.lateral) - limit;
        if (pen > maxPen) {
          maxPen = pen;
          const s = Math.sign(probe.lateral);
          nx = probe.rightX * s; // 트랙 바깥쪽 법선
          nz = probe.rightZ * s;
          rx = ox;
          rz = oz;
        }
      }
      if (maxPen <= 0) return;

      this.touchingWall = true;
      this.position.x -= nx * (maxPen + 0.001);
      this.position.z -= nz * (maxPen + 0.001);

      // 접촉점 속도 = 선속도 + 각속도 × 반경. 각속도 w = dheading/dt = -yawRate
      let wAng = -this.yawRate;
      const px = rz; // perp(r) = (rz, -rx)
      const pz = -rx;
      const vcx = this.velocity.x + wAng * px;
      const vcz = this.velocity.z + wAng * pz;
      const vn = vcx * nx + vcz * nz;
      if (vn <= 0) continue; // 이미 벽에서 멀어지는 중

      const af = col.angularFactor;
      const rn = px * nx + pz * nz;
      const j = (-(1 + col.restitution) * vn) / (1 + (rn * rn) / I);
      this.velocity.x += j * nx;
      this.velocity.z += j * nz;
      wAng += ((j * rn) / I) * af;

      // 벽을 따라 미끄러지는 마찰 (법선 충격량에 비례해 제한)
      const tx = -nz;
      const tz = nx;
      const vt = (this.velocity.x + wAng * px) * tx + (this.velocity.z + wAng * pz) * tz;
      const rt = px * tx + pz * tz;
      let jt = -vt / (1 + (rt * rt) / I);
      const maxJt = col.friction * Math.abs(j);
      jt = clamp(jt, -maxJt, maxJt);
      this.velocity.x += jt * tx;
      this.velocity.z += jt * tz;
      wAng += ((jt * rt) / I) * af;

      // 진행 방향에 따른 속도 손실: 정면일수록 크게, 비스듬하면 작게
      const spd = Math.hypot(this.velocity.x, this.velocity.z) + 1e-6;
      const headOn = clamp(vn / (spd + vn), 0, 1);
      const keep = 1 - col.speedLoss * headOn;
      this.velocity.x *= keep;
      this.velocity.z *= keep;

      this.yawRate = clamp(-wAng, -this.config.stability.maxYawRate, this.config.stability.maxYawRate);
      this.lastImpactSpeed = Math.max(this.lastImpactSpeed, vn);
    }
  }

  /** alpha: 직전 물리 스텝과 현재 스텝 사이의 보간 비율 (렌더 프레임마다 호출) */
  updateVisual(alpha, dt) {
    const c = this.config;
    const bd = c.body;
    const m = this.model;
    m.root.position.lerpVectors(this.prevPosition, this.position, alpha);
    m.root.rotation.y = lerpAngle(this.prevHeading, this.heading, alpha);

    // 차체 움직임: 가속 → 앞 들림, 제동 → 앞 숙임, 코너 → 바깥쪽으로 롤 (스프링-댐퍼)
    const targetPitch = clamp(-this.longitudinalAccel * bd.pitchStrength, -bd.maxPitch, bd.maxPitch);
    const targetRoll = clamp(-this.lateralAccel * bd.rollStrength, -bd.maxRoll, bd.maxRoll);
    if (dt > 0) {
      const steps = Math.min(Math.ceil(dt / (1 / 120)), 12);
      const h = Math.min(dt, 0.1) / steps;
      for (let i = 0; i < steps; i++) {
        this.pitchVel += (bd.stiffness * (targetPitch - this.pitch) - bd.damping * this.pitchVel) * h;
        this.pitch += this.pitchVel * h;
        this.rollVel += (bd.stiffness * (targetRoll - this.roll) - bd.damping * this.rollVel) * h;
        this.roll += this.rollVel * h;
      }
    } else {
      this.pitch = this.roll = this.pitchVel = this.rollVel = 0;
    }
    m.setBodyTilt(clamp(this.pitch, -bd.maxPitch * 1.3, bd.maxPitch * 1.3), clamp(this.roll, -bd.maxRoll * 1.3, bd.maxRoll * 1.3));

    // 바퀴: 실제 조향각 + 저속이 아닐 때도 입력이 보이도록 약간 보정 (+ = 오른쪽 → rotation.y 음수)
    const visualSteer = this.steerAngle + this.steerInput * c.steering.visualAngleBoost;
    m.setWheelState(-clamp(visualSteer, -c.steering.maxAngle, c.steering.maxAngle), this.frontSpin, this.rearSpin);
    m.setBrakeLights(this.braking);
    m.setReverseLights(this.gear === GEAR_REVERSE);
  }
}
