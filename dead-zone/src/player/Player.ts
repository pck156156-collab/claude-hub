import * as THREE from 'three';
import { PLAYER_CONFIG, WEAPON_CONFIG } from '../config/GameConfig';
import { damp, wrapAngle } from '../core/random';
import { HitInfo } from '../combat/Damageable';
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
  /** 강화로 바뀌는 능력치 (기본값은 설정 파일) */
  maxHealth: number = PLAYER_CONFIG.maxHealth;
  moveSpeed: number = PLAYER_CONFIG.moveSpeed;
  /** 받는 피해 감소율 0~1 */
  damageReduction = 0;
  /** 남은 피격 무적 시간 */
  invulnerable = 0;
  dead = false;
  /** 누적 받은 피해 · 막힌 공격 수 (테스트 · 디버그) */
  damageTaken = 0;
  blockedHits = 0;
  /** 피해를 받은 순간 호출 (화면 효과 · 사운드) */
  onDamaged: ((hit: HitInfo) => void) | null = null;
  onDeath: (() => void) | null = null;
  readonly radius = PLAYER_CONFIG.radius;
  touchingWall = false;
  private readonly push: PushResult = { hit: false, nx: 0, nz: 0 };

  constructor(spawn: THREE.Vector3) {
    this.teleport(spawn, Math.PI);
  }

  isAlive(): boolean {
    return !this.dead;
  }

  /**
   * 좀비 공격 피해. 무적 시간 중이거나 이미 죽었으면 무시.
   * 여러 좀비가 같은 순간 때려도 첫 번째만 들어가고 나머지는 무적 시간에 막힌다.
   */
  receiveAttack(hit: HitInfo): boolean {
    if (this.dead) return false;
    if (this.invulnerable > 0) { this.blockedHits++; return false; }
    const dmg = hit.damage * (1 - this.damageReduction);
    this.health = Math.max(0, this.health - dmg);
    this.damageTaken += dmg;
    this.lastDamage = dmg;
    this.invulnerable = PLAYER_CONFIG.invulnerableTime;
    this.onDamaged?.(hit);
    if (this.health <= 0) {
      this.dead = true;
      this.velocity.set(0, 0, 0);
      this.onDeath?.();
    }
    return true;
  }

  /** 마지막으로 받은 실제 피해 (감소 적용 후) */
  lastDamage = 0;

  /** 회복 (최대 체력 초과 불가) */
  heal(amount: number): number {
    if (this.dead) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  /** 최대 체력 변경. 늘어난 만큼 현재 체력도 회복할지 선택 */
  setMaxHealth(max: number): void {
    this.maxHealth = max;
    this.health = Math.min(this.health, max);
  }

  /** 다시 시작 (능력치 기본값 복원은 강화 시스템이 reset 으로 처리) */
  revive(spawn: THREE.Vector3): void {
    this.health = this.maxHealth;
    this.invulnerable = 0;
    this.dead = false;
    this.damageTaken = 0;
    this.blockedHits = 0;
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
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.dead) return;

    // ── 이동: 목표 속도로 일정 가속/감속 (큰 관성 없음, 정지 시 미끄러짐 없음)
    let mx = cmd.moveX;
    let mz = cmd.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; } // 대각선 정규화
    const tx = mx * this.moveSpeed;
    const tz = mz * this.moveSpeed;
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
