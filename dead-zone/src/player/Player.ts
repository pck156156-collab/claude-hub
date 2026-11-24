import * as THREE from 'three';
import { PLAYER_CONFIG, WEAPON_CONFIG } from '../config/GameConfig';
import { damp, wrapAngle } from '../core/random';
import { CollisionWorld, PushResult } from '../world/Collision';

/** 플레이어에게 전달되는 한 스텝의 조작 의도 (입력 장치와 무관) */
export interface PlayerCommand {
  /** 월드 기준 이동 방향 (길이 0~1) */
  moveX: number;
  moveZ: number;
  /** 조준점 (월드, 총구 높이 평면) */
  aimPoint: THREE.Vector3;
  hasAim: boolean;
}

/**
 * 플레이어 게임 상태 (위치 · 속도 · 조준 방향 · 체력).
 * 화면 표시는 PlayerModel 이 담당하고, 여기서는 순수한 시뮬레이션만 한다.
 * 이동 방향과 조준 방향은 완전히 독립적이다.
 */
export class Player {
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** 조준(상체) 방향. rotation.y 와 같은 규약: 앞 = (sin, 0, cos) */
  aimYaw = 0;
  prevAimYaw = 0;
  /** 조준점까지의 수평 거리 */
  aimDistance = 10;
  health = PLAYER_CONFIG.maxHealth;
  readonly maxHealth = PLAYER_CONFIG.maxHealth;
  readonly radius = PLAYER_CONFIG.radius;
  touchingWall = false;
  private readonly push: PushResult = { hit: false, nx: 0, nz: 0 };

  constructor(spawn: THREE.Vector3) {
    this.teleport(spawn, Math.PI);
  }

  teleport(p: THREE.Vector3, yaw: number): void {
    this.position.set(p.x, 0, p.z);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.aimYaw = this.prevAimYaw = yaw;
  }

  step(dt: number, cmd: PlayerCommand, collision: CollisionWorld): void {
    const c = PLAYER_CONFIG;
    this.prevPosition.copy(this.position);
    this.prevAimYaw = this.aimYaw;

    // ── 이동: 목표 속도로 일정 가속/감속 (큰 관성 없음, 정지 시 미끄러짐 없음)
    let mx = cmd.moveX;
    let mz = cmd.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; } // 대각선 정규화
    const tx = mx * c.moveSpeed;
    const tz = mz * c.moveSpeed;
    const dvx = tx - this.velocity.x;
    const dvz = tz - this.velocity.z;
    const dv = Math.hypot(dvx, dvz);
    const accelerating = len > 0.01;
    const rate = (accelerating ? c.acceleration : c.deceleration) * dt;
    if (dv <= rate) {
      this.velocity.x = tx;
      this.velocity.z = tz;
    } else {
      this.velocity.x += (dvx / dv) * rate;
      this.velocity.z += (dvz / dv) * rate;
    }
    if (!accelerating && Math.hypot(this.velocity.x, this.velocity.z) < c.stopEpsilon) this.velocity.set(0, 0, 0);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // ── 충돌: 밀어낸 뒤 벽 안쪽 방향 속도를 제거 → 벽을 따라 미끄러진다
    collision.resolveCircle(this.position, this.radius, this.push);
    this.touchingWall = this.push.hit;
    if (this.push.hit) {
      const vn = this.velocity.x * this.push.nx + this.velocity.z * this.push.nz;
      if (vn < 0) {
        this.velocity.x -= vn * this.push.nx;
        this.velocity.z -= vn * this.push.nz;
      }
    }
    this.position.y = 0;

    // ── 조준: 총구선(캐릭터 중심에서 오른쪽으로 offset)이 조준점을 지나도록 회전
    if (cmd.hasAim) {
      const dx = cmd.aimPoint.x - this.position.x;
      const dz = cmd.aimPoint.z - this.position.z;
      const d = Math.hypot(dx, dz);
      this.aimDistance = d;
      if (d > c.minAimDistance) {
        const o = WEAPON_CONFIG.rifle.muzzleOffset.x;
        const target = Math.atan2(dx, dz) - Math.asin(Math.min(0.99, o / d));
        const k = c.aimTurnSharpness > 0 ? damp(c.aimTurnSharpness, dt) : 1;
        this.aimYaw = wrapAngle(this.aimYaw + wrapAngle(target - this.aimYaw) * k);
      }
    }
  }

  /**
   * 무기 소켓: 현재 조준 자세 기준 총구 위치와 발사 방향 (월드).
   * 발사 방향은 수평이며 캐릭터 정면 = 조준점 방향.
   */
  getMuzzle(outPos: THREE.Vector3, outDir: THREE.Vector3): void {
    const m = WEAPON_CONFIG.rifle.muzzleOffset;
    const s = Math.sin(this.aimYaw);
    const c = Math.cos(this.aimYaw);
    outPos.set(this.position.x + m.x * c + m.z * s, m.y, this.position.z - m.x * s + m.z * c);
    outDir.set(s, 0, c);
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** 렌더 보간 위치 */
  interpolatedPosition(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    return out.lerpVectors(this.prevPosition, this.position, alpha);
  }

  interpolatedYaw(alpha: number): number {
    return this.prevAimYaw + wrapAngle(this.aimYaw - this.prevAimYaw) * alpha;
  }
}
