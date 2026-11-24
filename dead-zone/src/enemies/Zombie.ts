import * as THREE from 'three';
import { NAV_CONFIG, ZombieStats } from '../config/GameConfig';
import { Damageable, HitInfo, HitShape } from '../combat/Damageable';
import { wrapAngle } from '../core/random';
import { CollisionWorld, PushResult, RayHit } from '../world/Collision';
import { NavGrid } from '../world/NavGrid';

export enum ZombieState {
  Spawn = 'spawn',
  Chase = 'chase',
  Attack = 'attack',
  Hit = 'hit',
  Dead = 'dead',
}

/** 좀비가 공격할 수 있는 대상 (플레이어). 향후 동료 · 바리케이드도 같은 형태로 추가 가능 */
export interface AttackTarget {
  readonly position: THREE.Vector3;
  readonly radius: number;
  isAlive(): boolean;
  /** 실제로 피해가 들어갔으면 true (무적 시간 중이면 false) */
  receiveAttack(hit: HitInfo): boolean;
}

/** 한 스텝에 좀비가 참고하는 공용 정보 */
export interface ZombieContext {
  target: AttackTarget;
  nav: NavGrid;
  collision: CollisionWorld;
  time: number;
}

let nextId = 1;
const ray: RayHit = { t: 0, x: 0, z: 0, nx: 0, nz: 0, collider: null as never };
const push: PushResult = { hit: false, nx: 0, nz: 0 };
const dir = { x: 0, z: 0 };
const hitInfo: HitInfo = { damage: 0, point: new THREE.Vector3(), direction: new THREE.Vector3(), sourceId: '' };

/**
 * 좀비 1마리의 게임 상태 + 상태 기반 AI (Spawn → Chase ⇄ Attack / Hit → Dead).
 * 화면 표시는 ZombieRenderer 가 이 상태를 읽어서 그린다.
 * 객체는 ZombieManager 가 풀로 재사용한다 (reset).
 */
export class Zombie implements Damageable {
  id = 0;
  stats!: ZombieStats;
  readonly position = new THREE.Vector3();
  readonly prevPosition = new THREE.Vector3();
  yaw = 0;
  prevYaw = 0;
  health = 0;
  state = ZombieState.Spawn;
  stateTime = 0;
  /** 이번 스텝 실제 이동 속도 (애니메이션용) */
  moveSpeed = 0;
  /** 다음 공격까지 남은 시간 */
  attackCooldown = 0;
  /** 이번 공격의 판정을 이미 처리했는지 (판정은 공격당 한 번) */
  attackResolved = false;
  /** 마지막 공격 판정 결과 (테스트 · 디버그) */
  lastAttackLanded = false;
  /** 피격 섬광 0~1 */
  flash = 0;
  /** 피격 반동 (애니메이션용, 맞은 방향 로컬) */
  hitKick = 0;
  /** 외형 변화용 시드 */
  variant = 0;
  /** 사망 후 경과 시간 */
  deadTime = 0;
  /** 시체 정리 시작 (가라앉기) */
  sinking = false;
  readonly hitShape: HitShape = { x: 0, z: 0, radius: 0.45, yMin: 0.2, yMax: 1.75 };
  readonly material = 'flesh' as const;

  private knockX = 0;
  private knockZ = 0;
  private holding = false;
  private losTimer = 0;
  private hasLos = false;
  private stuckTimer = 0;
  private sidestep = 0;
  private sidestepTimer = 0;
  private lastHitReact = -10;
  /** 좀비 자신의 시간 (피격 반응 간격 계산용) */
  private clock = 0;

  get maxHealth(): number {
    return this.stats.maxHealth;
  }

  get radius(): number {
    return this.stats.radius;
  }

  get alive(): boolean {
    return this.state !== ZombieState.Dead;
  }

  /** 풀에서 꺼낼 때 초기화 */
  reset(stats: ZombieStats, x: number, z: number, yaw: number): void {
    this.id = nextId++;
    this.stats = stats;
    this.position.set(x, 0, z);
    this.prevPosition.copy(this.position);
    this.yaw = this.prevYaw = yaw;
    this.health = stats.maxHealth;
    this.state = ZombieState.Spawn;
    this.stateTime = 0;
    this.moveSpeed = 0;
    this.attackCooldown = 0;
    this.attackResolved = false;
    this.lastAttackLanded = false;
    this.flash = 0;
    this.hitKick = 0;
    this.variant = Math.random();
    this.deadTime = 0;
    this.sinking = false;
    this.knockX = this.knockZ = 0;
    this.holding = false;
    this.losTimer = Math.random() * NAV_CONFIG.lineOfSightInterval; // 좀비마다 검사 시점 분산
    this.hasLos = false;
    this.stuckTimer = 0;
    this.sidestep = 0;
    this.sidestepTimer = 0;
    this.lastHitReact = -10;
    this.syncHitShape();
  }

  canBeHit(): boolean {
    if (this.state === ZombieState.Dead) return false;
    // 땅에서 반쯤 올라온 뒤부터 맞는다
    return this.state !== ZombieState.Spawn || this.stateTime > this.stats.spawnTime * 0.35;
  }

  /** 총알 피해. 사망한 좀비는 무시 (중복 · 추가 피해 방지) */
  takeDamage(hit: HitInfo): void {
    const time = this.clock;
    if (!this.canBeHit()) return;
    this.health = Math.max(0, this.health - hit.damage);
    this.flash = 1;
    this.hitKick = 1;
    const k = this.stats.knockback;
    this.knockX += hit.direction.x * k;
    this.knockZ += hit.direction.z * k;
    if (this.health <= 0) {
      this.setState(ZombieState.Dead);
      return;
    }
    // 추적 중일 때만 짧게 경직. 연속 피격 시 상태가 계속 바뀌어 떨리지 않도록 간격을 둔다.
    // 공격 동작은 끊지 않는다 (공격 중 맞아도 위협이 유지되도록)
    if ((this.state === ZombieState.Chase) && time - this.lastHitReact > this.stats.hitStunTime + 0.2) {
      this.lastHitReact = time;
      this.setState(ZombieState.Hit);
    }
  }

  step(dt: number, ctx: ZombieContext): void {
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;
    this.clock += dt;
    this.stateTime += dt;
    this.flash = Math.max(0, this.flash - dt * 8);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (this.state === ZombieState.Dead) {
      this.deadTime += dt;
      this.moveSpeed = 0;
      // 넉백 여운만 반영 (쓰러지며 밀림)
      this.applyKnockback(dt, ctx.collision);
      return;
    }

    const s = this.stats;
    const t = ctx.target;
    const dx = t.position.x - this.position.x;
    const dz = t.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const toTarget = Math.atan2(dx, dz);
    let mvx = 0;
    let mvz = 0;

    switch (this.state) {
      case ZombieState.Spawn:
        if (this.stateTime >= s.spawnTime) this.setState(ZombieState.Chase);
        break;

      case ZombieState.Hit:
        if (this.stateTime >= s.hitStunTime) this.setState(ZombieState.Chase);
        break;

      case ZombieState.Attack: {
        // 공격 중에는 이동하지 않고 천천히 대상을 향해 돈다
        this.turnToward(toTarget, s.turnSpeed * 0.5, dt);
        if (!this.attackResolved && this.stateTime >= s.attackWindup) {
          this.attackResolved = true;
          this.lastAttackLanded = this.resolveAttack(t, dist, toTarget);
        }
        if (this.stateTime >= s.attackDuration) this.setState(ZombieState.Chase);
        break;
      }

      case ZombieState.Chase: {
        if (!t.isAlive()) break;
        // 공격 시작: 사거리보다 조금 안쪽 + 쿨다운 완료 (경계에서 상태가 깜빡이지 않도록 여유)
        if (dist <= s.attackRange * 0.9 && this.attackCooldown <= 0) {
          this.setState(ZombieState.Attack);
          this.attackCooldown = s.attackInterval;
          break;
        }
        // 너무 가까우면 멈춰서 기다림 (히스테리시스: 1.0 안쪽에서 멈추고 1.25 밖에서 다시 이동)
        const contact = s.radius + t.radius;
        if (this.holding) { if (dist > contact + 0.45) this.holding = false; }
        else if (dist < contact + 0.2) this.holding = true;
        if (this.holding) {
          this.turnToward(toTarget, s.turnSpeed, dt);
          break;
        }
        if (this.chooseDirection(dt, ctx, dx, dz, dist)) {
          mvx = dir.x * s.moveSpeed;
          mvz = dir.z * s.moveSpeed;
          // 이동 방향을 바라보되, 가까워지면 플레이어를 바라봄
          const face = dist < 4 && this.hasLos ? toTarget : Math.atan2(dir.x, dir.z);
          this.turnToward(face, s.turnSpeed, dt);
        }
        break;
      }
    }

    // 이동 + 넉백 + 장애물 충돌
    this.position.x += mvx * dt;
    this.position.z += mvz * dt;
    this.applyKnockback(dt, ctx.collision);
    this.moveSpeed = Math.hypot(this.position.x - this.prevPosition.x, this.position.z - this.prevPosition.z) / dt;

    // 막힘 감지 → 옆으로 비켜 감
    if (this.state === ZombieState.Chase && !this.holding && (mvx !== 0 || mvz !== 0)) {
      if (this.moveSpeed < s.moveSpeed * 0.3) this.stuckTimer += dt;
      else this.stuckTimer = Math.max(0, this.stuckTimer - dt);
      if (this.stuckTimer > NAV_CONFIG.stuckTime) {
        this.stuckTimer = 0;
        this.sidestep = Math.random() < 0.5 ? -1 : 1;
        this.sidestepTimer = 0.6;
      }
    }
    if (this.sidestepTimer > 0) this.sidestepTimer -= dt;
  }

  /** 분리 처리 · 충돌 후 판정 형태 갱신 */
  syncHitShape(): void {
    this.hitShape.x = this.position.x;
    this.hitShape.z = this.position.z;
  }

  setState(next: ZombieState): void {
    if (this.state === ZombieState.Dead) return;
    this.state = next;
    this.stateTime = 0;
    if (next === ZombieState.Attack) { this.attackResolved = false; this.lastAttackLanded = false; }
    if (next === ZombieState.Chase) this.holding = false;
  }

  /** 공격 판정 순간: 살아 있고, 사거리 안이고, 정면 범위 안일 때만 피해 */
  private resolveAttack(t: AttackTarget, dist: number, toTarget: number): boolean {
    const s = this.stats;
    if (this.state !== ZombieState.Attack || !t.isAlive()) return false;
    if (dist > s.attackRange) return false;
    if (Math.abs(wrapAngle(toTarget - this.yaw)) > THREE.MathUtils.degToRad(s.attackArcDeg)) return false;
    hitInfo.damage = s.attackDamage;
    hitInfo.point.copy(t.position).setY(1.1);
    hitInfo.direction.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    hitInfo.sourceId = `zombie:${s.id}`;
    return t.receiveAttack(hitInfo);
  }

  /** 이동 방향 결정: 직선 시야가 열려 있으면 직진, 아니면 흐름장 경로 */
  private chooseDirection(dt: number, ctx: ZombieContext, dx: number, dz: number, dist: number): boolean {
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = NAV_CONFIG.lineOfSightInterval;
      this.hasLos = this.lineOfSight(ctx.collision, ctx.target.position, dist);
    }
    let ok: boolean;
    if (this.hasLos) {
      dir.x = dx / (dist || 1);
      dir.z = dz / (dist || 1);
      ok = true;
    } else {
      ok = ctx.nav.direction(this.position.x, this.position.z, dir);
      if (!ok) { dir.x = dx / (dist || 1); dir.z = dz / (dist || 1); ok = true; }
    }
    if (this.sidestepTimer > 0) {
      // 진행 방향의 옆으로 비켜 가기
      const sx = -dir.z * this.sidestep;
      const sz = dir.x * this.sidestep;
      const nx = dir.x * 0.4 + sx;
      const nz = dir.z * 0.4 + sz;
      const l = Math.hypot(nx, nz);
      dir.x = nx / l;
      dir.z = nz / l;
    }
    return ok;
  }

  /** 좀비 몸 폭(좌우 두 선)으로 플레이어까지 막힘 없는지 */
  private lineOfSight(collision: CollisionWorld, p: THREE.Vector3, dist: number): boolean {
    if (dist < 0.01) return true;
    const ux = (p.x - this.position.x) / dist;
    const uz = (p.z - this.position.z) / dist;
    const off = this.stats.radius * 0.9;
    for (const sgn of [-1, 1]) {
      const ox = -uz * off * sgn;
      const oz = ux * off * sgn;
      if (collision.raycast(this.position.x + ox, this.position.z + oz, p.x + ox, p.z + oz, 0.05, ray)) return false;
    }
    return true;
  }

  private applyKnockback(dt: number, collision: CollisionWorld): void {
    if (this.knockX !== 0 || this.knockZ !== 0) {
      this.position.x += this.knockX * dt;
      this.position.z += this.knockZ * dt;
      const decay = Math.exp(-12 * dt);
      this.knockX *= decay;
      this.knockZ *= decay;
      if (Math.abs(this.knockX) + Math.abs(this.knockZ) < 0.01) this.knockX = this.knockZ = 0;
    }
    collision.resolveCircle(this.position, this.stats.radius, push);
    this.position.y = 0;
  }

  private turnToward(target: number, speed: number, dt: number): void {
    const d = wrapAngle(target - this.yaw);
    const maxStep = speed * dt;
    this.yaw = wrapAngle(this.yaw + Math.max(-maxStep, Math.min(maxStep, d)));
  }
}
