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
  /** 종류별 특수 행동 (러너 가속 · 스피터 사격 · 폭발 준비 · 보스 패턴). 세부 단계는 zombie.special */
  Special = 'special',
  Dead = 'dead',
}

/** 적 행동이 게임에 알리는 사건 (이펙트 · 사운드 · 알림). 피해 판정은 행동 모듈이 직접 한다 */
export type EnemyEventType =
  | 'explode' | 'prime' | 'slam' | 'bossSwing' | 'chargePrep' | 'chargeStart' | 'chargeHit' | 'chargeWall' | 'roar' | 'phase2' | 'spitWindup' | 'dash';

export interface EnemyEvents {
  /** 지금 독성 투사체를 쏠 수 있는지 (동시 투사체 수 · 발사 간격 제한) */
  canSpit(): boolean;
  spit(z: Zombie, x: number, y: number, zz: number, dx: number, dz: number, speed: number, radius: number, damage: number): void;
  emit(type: EnemyEventType, z: Zombie, value?: number): void;
}

/** 한 스텝 이동 계산에 쓰는 값 (행동 모듈과 공유) */
export interface MoveInfo {
  dx: number;
  dz: number;
  dist: number;
  toTarget: number;
  /** 결과: 이번 스텝 이동 속도 */
  mvx: number;
  mvz: number;
}

/**
 * 종류별 특수 행동 모듈. 공통 AI(Zombie) 위에 필요한 부분만 덧붙인다.
 * - chase: 추적 상태에서 먼저 호출. true 면 이번 스텝 이동을 모듈이 정함 (false 면 기본 추적)
 * - special: Special 상태 진행
 * - zone: 지금 표시할 위험 범위 (실제 피해 판정과 같은 값)
 */
export interface EnemyBehavior {
  chase?(z: Zombie, dt: number, ctx: ZombieContext, m: MoveInfo): boolean;
  special?(z: Zombie, dt: number, ctx: ZombieContext, m: MoveInfo): void;
  zone?(z: Zombie, ctx: ZombieContext, out: DangerZone): boolean;
  /** 강한 넉백으로 특수 행동이 끊기는지 */
  interruptible?: boolean;
}

/** 위험 범위: 바닥 표시와 피해 판정이 같은 값을 쓴다 */
export interface DangerZone {
  shape: 'circle' | 'sector' | 'lane';
  x: number;
  z: number;
  /** 원 · 부채꼴 반경, 직선 길이 */
  radius: number;
  /** 부채꼴: 정면 기준 반각 (rad) · 직선: 반폭 */
  half: number;
  yaw: number;
  /** 준비 진행 0~1 (표시용) */
  progress: number;
  /** 'warn' = 준비 중, 'active' = 진행 중 (돌진) */
  mode: 'warn' | 'active';
  color: number;
}

export function emptyZone(): DangerZone {
  return { shape: 'circle', x: 0, z: 0, radius: 0, half: 0, yaw: 0, progress: 0, mode: 'warn', color: 0xff3020 };
}

/** 플레이어 중심 (px, pz) 가 위험 범위 안인지. 바닥 표시와 같은 기준 */
export function zoneContains(zn: DangerZone, px: number, pz: number): boolean {
  const dx = px - zn.x;
  const dz = pz - zn.z;
  if (zn.shape === 'circle') return dx * dx + dz * dz <= zn.radius * zn.radius;
  if (zn.shape === 'sector') {
    const d = Math.hypot(dx, dz);
    if (d > zn.radius) return false;
    if (d < 1e-4) return true;
    return Math.abs(wrapAngle(Math.atan2(dx, dz) - zn.yaw)) <= zn.half;
  }
  const fx = Math.sin(zn.yaw);
  const fz = Math.cos(zn.yaw);
  const along = dx * fx + dz * fz;
  const lat = Math.abs(dx * fz - dz * fx);
  return along >= 0 && along <= zn.radius && lat <= zn.half;
}

/** 좀비가 공격할 수 있는 대상 (플레이어). 향후 동료 · 바리케이드도 같은 형태로 추가 가능 */
export interface AttackTarget {
  readonly position: THREE.Vector3;
  /** 이동 속도 (생성 위치를 정할 때 진행 방향을 피하는 데 사용, 선택) */
  readonly velocity?: THREE.Vector3;
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
  events: EnemyEvents;
  /** 종류별 행동 모듈 */
  behaviors: Partial<Record<string, EnemyBehavior>>;
}

let nextId = 1;
/** 이 넉백 속도 이상이면 공격 동작을 끊고 경직 */
const HEAVY_KNOCKBACK = 4;
/** 이보다 짧은 경직은 적용하지 않음 (초) */
const MIN_STUN = 0.05;
const ray: RayHit = { t: 0, x: 0, z: 0, nx: 0, nz: 0, collider: null as never };
const push: PushResult = { hit: false, nx: 0, nz: 0 };
const dir = { x: 0, z: 0 };
const moveInfo: MoveInfo = { dx: 0, dz: 0, dist: 0, toTarget: 0, mvx: 0, mvz: 0 };
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

  // ── 특수 행동 공용 상태 (행동 모듈이 사용)
  behavior: EnemyBehavior | null = null;
  /** 특수 행동 세부 단계 ('' = 없음) */
  special = '';
  specialTime = 0;
  /** 패턴별 쿨다운 (A · B · C) + 패턴 사이 간격 */
  cdA = 0;
  cdB = 0;
  cdC = 0;
  cdGap = 0;
  /** 이동 방향 (steerRate 가 있는 종류: 곡선 이동) */
  heading = 0;
  /** 보스 페이즈 (1 → 2, 한 번만) */
  phase = 1;
  phaseShifts = 0;
  /** 돌진 · 사격용 고정 값 */
  lockLen = 0;
  travel = 0;
  aux = 0;
  hitDone = false;
  strafeDir = 1;
  strafeTimer = 0;
  /** 자폭으로 사라졌는지 (처치 아님) */
  exploded = false;
  /** 마지막 이동에서 장애물에 막혔는지 */
  blocked = false;
  /** 이번 경직 시간 (상태 이상 저항 반영) */
  private stunTime = 0;

  private knockX = 0;
  private knockZ = 0;
  private holding = false;
  private losTimer = 0;
  /** 플레이어까지 직선 시야 (주기적으로 갱신) */
  hasLos = false;
  private stuckTimer = 0;
  private sidestep = 0;
  private sidestepTimer = 0;
  private lastHitReact = -10;
  /** 좀비 자신의 시간 (피격 반응 간격 계산용) */
  private clock = 0;
  /** 최근에 맞은 공격 ID (중복 피해 방지) */
  private readonly recentAttacks: number[] = [-1, -1, -1, -1, -1, -1, -1, -1];
  private recentIndex = 0;

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
    this.recentAttacks.fill(-1);
    this.recentIndex = 0;
    this.special = '';
    this.specialTime = 0;
    this.cdA = this.cdB = this.cdC = this.cdGap = 0;
    this.heading = yaw;
    this.phase = 1;
    this.phaseShifts = 0;
    this.lockLen = this.travel = this.aux = 0;
    this.hitDone = false;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = 0;
    this.exploded = false;
    this.blocked = false;
    this.stunTime = stats.hitStunTime;
    this.behavior = null;
    this.hitShape.radius = stats.radius + 0.05;
    this.hitShape.yMax = 1.75 * stats.appearance.scale;
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
    // 같은 공격(같은 공격 ID)으로는 한 번만 피해
    if (hit.attackId !== undefined) {
      if (this.recentAttacks.includes(hit.attackId)) return;
      this.recentAttacks[this.recentIndex] = hit.attackId;
      this.recentIndex = (this.recentIndex + 1) % this.recentAttacks.length;
    }
    this.health = Math.max(0, this.health - hit.damage);
    this.flash = 1;
    const resistK = Math.min(1, Math.max(0, this.stats.knockbackResistance ?? 0));
    // 피격 반동 연출: 넉백이 셀수록 크게 젖혀짐 (방망이 · 도끼). 넉백 저항만큼 줄어듦
    this.hitKick = Math.max(this.hitKick, Math.min(2, 0.7 + (hit.knockback ?? this.stats.knockback) * 0.2) * (1 - resistK * 0.7));
    const resist = Math.min(1, Math.max(0, this.stats.knockbackResistance ?? 0));
    const k = (hit.knockback ?? this.stats.knockback) * (1 - resist);
    this.knockX += hit.direction.x * k;
    this.knockZ += hit.direction.z * k;
    if (this.health <= 0) {
      // 폭발 준비 중이어도 처치되면 폭발하지 않고 일반 사망
      this.setState(ZombieState.Dead);
      return;
    }
    // 상태 이상 저항: 경직 시간 (1 - 저항) 배, 1 이면 경직 없음 (보스)
    const stunScale = 1 - Math.min(1, Math.max(0, this.stats.statusResistance));
    // 경직이 아주 짧으면(탱커 · 보스) 아예 끊기지 않음 → 무거운 적은 일반 피격에 움찔하지 않는다
    if (this.stats.hitStunTime * stunScale < MIN_STUN) return;
    // 강한 넉백(방망이 · 도끼): 공격 동작도 끊고 경직 (넉백 저항이 높으면 k 가 작아 경직 없음)
    const canInterrupt = this.state === ZombieState.Chase || this.state === ZombieState.Attack
      || (this.state === ZombieState.Special && this.behavior?.interruptible === true);
    if (k >= HEAVY_KNOCKBACK && canInterrupt) {
      this.lastHitReact = time;
      this.special = '';
      this.setState(ZombieState.Hit);
      this.stunTime = this.stats.hitStunTime * stunScale;
      this.stateTime = -0.15 * stunScale; // 경직 조금 더 길게
      return;
    }
    // 추적 중일 때만 짧게 경직. 연속 피격 시 상태가 계속 바뀌어 떨리지 않도록 간격을 둔다.
    // 공격 동작은 끊지 않는다 (공격 중 맞아도 위협이 유지되도록)
    if ((this.state === ZombieState.Chase) && time - this.lastHitReact > this.stats.hitStunTime + 0.2) {
      this.lastHitReact = time;
      this.setState(ZombieState.Hit);
      this.stunTime = this.stats.hitStunTime * stunScale;
    }
  }

  step(dt: number, ctx: ZombieContext): void {
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;
    this.clock += dt;
    this.stateTime += dt;
    this.flash = Math.max(0, this.flash - dt * 8);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.cdA > 0) this.cdA -= dt;
    if (this.cdB > 0) this.cdB -= dt;
    if (this.cdC > 0) this.cdC -= dt;
    if (this.cdGap > 0) this.cdGap -= dt;
    if (this.strafeTimer > 0) this.strafeTimer -= dt;
    this.specialTime += dt;

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
    if (!this.behavior) this.behavior = ctx.behaviors[s.kind] ?? null;
    const m = moveInfo;
    m.dx = dx; m.dz = dz; m.dist = dist; m.toTarget = toTarget; m.mvx = 0; m.mvz = 0;

    switch (this.state) {
      case ZombieState.Spawn:
        if (this.stateTime >= s.spawnTime) this.setState(ZombieState.Chase);
        break;

      case ZombieState.Hit:
        if (this.stateTime >= this.stunTime) this.setState(ZombieState.Chase);
        break;

      case ZombieState.Special:
        if (this.behavior?.special) {
          this.behavior.special(this, dt, ctx, m);
          mvx = m.mvx;
          mvz = m.mvz;
        } else {
          this.endSpecial();
        }
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
        this.refreshLos(dt, ctx, dist);
        // 종류별 행동이 먼저 (특수 공격 시작 · 거리 유지 등)
        if (this.behavior?.chase && this.behavior.chase(this, dt, ctx, m)) {
          mvx = m.mvx;
          mvz = m.mvz;
          break;
        }
        // 공격 시작: 사거리보다 조금 안쪽 + 쿨다운 완료 (경계에서 상태가 깜빡이지 않도록 여유)
        if (s.attackType === 'melee' && dist <= s.attackRange * 0.9 && this.attackCooldown <= 0) {
          this.startAttack();
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
        if (this.chooseDirection(ctx, dx, dz, dist)) {
          const sp = s.moveSpeed;
          if (s.steerRate > 0) {
            // 곡선 이동: 이동 방향이 steerRate 로만 돈다 → 급격한 방향 전환 없음 (러너 · 보스)
            const want = Math.atan2(dir.x, dir.z);
            const diff = this.steerHeading(want, s.steerRate, dt);
            // 크게 꺾어야 하면 감속 (미끄러지듯 도는 것 방지)
            const k = Math.max(0.35, Math.cos(Math.min(Math.PI / 2, Math.abs(diff))));
            mvx = Math.sin(this.heading) * sp * k;
            mvz = Math.cos(this.heading) * sp * k;
          } else {
            mvx = dir.x * sp;
            mvz = dir.z * sp;
            this.heading = Math.atan2(dir.x, dir.z);
          }
          // 이동 방향을 바라보되, 가까워지면 플레이어를 바라봄
          const face = dist < 4 && this.hasLos ? toTarget : Math.atan2(mvx, mvz);
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
    if ((this.state === ZombieState.Chase || this.state === ZombieState.Special) && !this.holding && (mvx !== 0 || mvz !== 0)) {
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
    if (next !== ZombieState.Special) this.special = '';
  }

  /** 일반 근접 공격 시작 (예비 동작 → 판정) */
  startAttack(): void {
    this.setState(ZombieState.Attack);
    this.attackCooldown = this.stats.attackInterval;
  }

  /** 특수 행동 단계 시작 */
  setSpecial(name: string): void {
    if (this.state !== ZombieState.Special) this.setState(ZombieState.Special);
    this.special = name;
    this.specialTime = 0;
    this.hitDone = false;
  }

  endSpecial(): void {
    this.special = '';
    this.setState(ZombieState.Chase);
  }

  /** 자폭: 처치가 아닌 제거 (경험치 · 처치 수 없음) */
  selfDestruct(): void {
    this.exploded = true;
    this.health = 0;
    this.special = '';
    this.setState(ZombieState.Dead);
    this.deadTime = this.stats.corpseTime;
    this.sinking = true;
    this.knockX = this.knockZ = 0;
  }

  /** 일반 공격의 위험 범위 (탱커처럼 telegraph 가 켜진 종류) */
  meleeZone(out: DangerZone): boolean {
    const s = this.stats;
    if (!s.telegraph || this.state !== ZombieState.Attack || this.attackResolved) return false;
    out.shape = 'sector';
    out.x = this.position.x;
    out.z = this.position.z;
    out.radius = s.attackRange;
    out.half = THREE.MathUtils.degToRad(s.attackArcDeg);
    out.yaw = this.yaw;
    out.progress = Math.min(1, this.stateTime / s.attackWindup);
    out.mode = 'warn';
    out.color = 0xff4020;
    return true;
  }

  /** 이동 방향(heading)을 최대 rate 로 want 쪽으로 돌린다. 남은 각도 차이를 돌려줌 */
  steerHeading(want: number, rate: number, dt: number): number {
    const d = wrapAngle(want - this.heading);
    const st = rate * dt;
    this.heading = wrapAngle(this.heading + Math.max(-st, Math.min(st, d)));
    return wrapAngle(want - this.heading);
  }

  /** 직선 시야 주기 갱신 (좀비마다 검사 시점 분산) */
  refreshLos(dt: number, ctx: ZombieContext, dist: number): void {
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = NAV_CONFIG.lineOfSightInterval;
      this.hasLos = this.lineOfSight(ctx.collision, ctx.target.position, dist);
    }
  }

  /** 플레이어 쪽 이동 방향 (시야가 열려 있으면 직진, 아니면 경로) → out 에 단위 벡터 */
  pathDirection(ctx: ZombieContext, m: MoveInfo, out: { x: number; z: number }): void {
    this.chooseDirection(ctx, m.dx, m.dz, m.dist);
    out.x = dir.x;
    out.z = dir.z;
  }

  /** 판정 순간: 위험 범위 안이면 피해 (보스 · 특수 공격 공통) */
  strike(t: AttackTarget, zone: DangerZone, damage: number): boolean {
    if (!t.isAlive() || !zoneContains(zone, t.position.x, t.position.z)) return false;
    hitInfo.damage = damage;
    hitInfo.point.copy(t.position).setY(1.1);
    const dx = t.position.x - this.position.x;
    const dz = t.position.z - this.position.z;
    const l = Math.hypot(dx, dz) || 1;
    hitInfo.direction.set(dx / l, 0, dz / l);
    hitInfo.sourceId = `zombie:${this.stats.id}`;
    return t.receiveAttack(hitInfo);
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
  private chooseDirection(ctx: ZombieContext, dx: number, dz: number, dist: number): boolean {
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
    this.blocked = push.hit;
    this.position.y = 0;
  }

  turnToward(target: number, speed: number, dt: number): void {
    const d = wrapAngle(target - this.yaw);
    const maxStep = speed * dt;
    this.yaw = wrapAngle(this.yaw + Math.max(-maxStep, Math.min(maxStep, d)));
  }
}
