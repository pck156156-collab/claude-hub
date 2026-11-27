import * as THREE from 'three';
import { AttackSpec, CombatSystem } from '../combat/CombatSystem';
import { Damageable, DamageableRegistry } from '../combat/Damageable';
import { CollisionWorld, RayHit } from '../world/Collision';
import { WeaponSystem } from './WeaponSystem';
import { MeleeId } from './WeaponData';

/** 근접 공격 판정에 필요한 공격자 정보 */
export interface MeleeOrigin {
  x: number;
  z: number;
  /** 공격 방향 (조준 방향) */
  yaw: number;
}

interface Candidate {
  target: Damageable;
  dist: number;
  angle: number;
  score: number;
}

/**
 * 근접 공격 모듈 (F 키): 탄약 없이 조준 방향 부채꼴로 공격한다.
 * - 한 번 누를 때 한 번 (누르고 있어도 반복 공격하지 않음 — 키 눌림 순간에만 호출됨)
 * - 동작이 시작되면 hitTime 순간에 한 번 판정 → 애니메이션의 "맞는 순간" 과 일치
 * - 거리 · 각도(대상 몸 폭 포함) · 벽 차단 · 생존 · 최대 대상 수 확인, 가깝고 중심축에 가까운 순서
 * - 휘두르는 동안에는 총 발사 · 교체를 막는다 (WeaponSystem.update 의 blocked)
 */
export class MeleeSystem {
  /** 다음 공격까지 남은 시간 */
  cooldown = 0;
  /** 휘두르기 경과 시간 (-1 = 휘두르는 중 아님) */
  swingTime = -1;
  /** 이번 휘두르기의 무기 · 동작 길이 (시작 시 고정) */
  swingId: MeleeId = 'knife';
  swingDuration = 0;
  swingHitTime = 0;
  private hitDone = false;
  private attackId = 0;
  /** 누적 통계 (테스트) */
  swings = 0;
  lastTargets: Damageable[] = [];

  /** 판정 순간 (이펙트: 실제 판정 범위 표시) */
  onSwingHit: ((origin: MeleeOrigin, range: number, arcDeg: number, hits: number) => void) | null = null;
  onSwingStart: ((id: MeleeId) => void) | null = null;

  private readonly ray: RayHit = { t: 0, x: 0, z: 0, nx: 0, nz: 0, collider: null as never };
  private readonly candidates: Candidate[] = [];
  private readonly spec: AttackSpec = {
    attackId: 0, sourceId: '', kind: 'melee', damage: 0, critChance: 0, critMultiplier: 2, knockback: 0,
    point: new THREE.Vector3(), direction: new THREE.Vector3(),
  };

  constructor(
    private readonly weapons: WeaponSystem,
    private readonly registry: DamageableRegistry,
    private readonly collision: CollisionWorld,
    private readonly combat: CombatSystem,
  ) {}

  get busy(): boolean {
    return this.swingTime >= 0;
  }

  /** 휘두르기 진행도 0~1 (-1 = 아님) */
  get progress(): number {
    return this.swingTime < 0 ? -1 : Math.min(1, this.swingTime / this.swingDuration);
  }

  /** 다음 공격까지 남은 비율 (HUD 쿨다운 표시) */
  get cooldownRatio(): number {
    return Math.max(0, Math.min(1, this.cooldown / Math.max(0.001, this.weapons.meleeStats.interval)));
  }

  reset(): void {
    this.cooldown = 0;
    this.swingTime = -1;
    this.hitDone = false;
    this.swings = 0;
    this.lastTargets = [];
  }

  /** F 키를 누른 순간. 교체 중이거나 쿨다운이면 무시 */
  tryAttack(): boolean {
    if (this.busy || this.cooldown > 0 || this.weapons.switching) return false;
    const st = this.weapons.meleeStats;
    // 재장전 중이면 취소 (남은 탄약 유지)
    this.weapons.current.cancelReload();
    this.weapons.current.releaseTrigger();
    this.swingId = this.weapons.meleeId;
    this.swingTime = 0;
    this.swingDuration = st.duration;
    this.swingHitTime = st.hitTime;
    this.cooldown = st.interval;
    this.hitDone = false;
    this.attackId = this.combat.nextAttackId();
    this.swings++;
    this.onSwingStart?.(this.swingId);
    return true;
  }

  step(dt: number, origin: MeleeOrigin): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.swingTime < 0) return;
    this.swingTime += dt;
    if (!this.hitDone && this.swingTime >= this.swingHitTime) {
      this.hitDone = true;
      this.resolve(origin);
    }
    if (this.swingTime >= this.swingDuration) this.swingTime = -1;
  }

  /** 타격 판정: 범위 안 대상을 골라 공통 피해 처리로 넘긴다 */
  private resolve(o: MeleeOrigin): void {
    const st = this.weapons.meleeStats;
    const half = THREE.MathUtils.degToRad(st.arcDeg) / 2;
    const c = this.candidates;
    c.length = 0;
    for (const t of this.registry.all) {
      if (!t.canBeHit()) continue;
      const s = t.hitShape;
      const dx = s.x - o.x;
      const dz = s.z - o.z;
      const dist = Math.hypot(dx, dz);
      if (dist - s.radius > st.range) continue;
      // 각도: 대상 몸 폭만큼 여유를 둔다 (가장자리에 걸친 좀비도 맞음)
      const angle = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - o.yaw), Math.cos(Math.atan2(dx, dz) - o.yaw)));
      const widen = dist > 1e-3 ? Math.asin(Math.min(1, s.radius / dist)) : Math.PI;
      if (angle > half + widen) continue;
      // 벽 · 건물 뒤의 대상은 맞지 않음 (가슴 높이, 대상 몸 표면까지)
      if (dist > 0.3) {
        const reach = (dist - s.radius * 0.8) / dist;
        if (this.collision.raycast(o.x, o.z, o.x + dx * reach, o.z + dz * reach, 0.9, this.ray)) continue;
      }
      c.push({ target: t, dist, angle, score: dist + angle * 0.9 });
    }
    // 가까운 순서 + 공격 중심축에 가까울수록 우선
    c.sort((a, b) => a.score - b.score);
    const spec = this.spec;
    spec.attackId = this.attackId;
    spec.sourceId = this.swingId;
    spec.damage = st.damage;
    spec.critChance = this.weapons.mods.critChance;
    spec.critMultiplier = this.weapons.mods.critMultiplier;
    spec.knockback = st.knockback;
    this.lastTargets = [];
    let hits = 0;
    for (const cand of c) {
      if (hits >= st.maxTargets) break;
      const s = cand.target.hitShape;
      spec.direction.set(s.x - o.x, 0, s.z - o.z).normalize();
      spec.point.set(s.x - spec.direction.x * s.radius * 0.7, 1.1, s.z - spec.direction.z * s.radius * 0.7);
      if (this.combat.apply(cand.target, spec)) {
        hits++;
        this.lastTargets.push(cand.target);
      }
    }
    this.onSwingHit?.(o, st.range, st.arcDeg, hits);
  }
}
