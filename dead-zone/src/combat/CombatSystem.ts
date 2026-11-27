import * as THREE from 'three';
import { Damageable, HitInfo } from './Damageable';

/** 공격 1회 (총알 한 알 · 근접 한 번 휘두르기) 의 피해 명세 */
export interface AttackSpec {
  attackId: number;
  /** 무기 ID (숙련도 · 통계) */
  sourceId: string;
  kind: 'gun' | 'melee';
  damage: number;
  critChance: number;
  critMultiplier: number;
  knockback: number;
  point: THREE.Vector3;
  direction: THREE.Vector3;
}

export interface HitResult {
  target: Damageable;
  spec: AttackSpec;
  /** 실제로 깎인 체력 (남은 체력까지만, 숙련도 기준) */
  dealt: number;
  crit: boolean;
  killed: boolean;
}

/**
 * 총기 · 근접 공통 피해 처리: 치명타 판정 → 대상 피해 (넉백 · 사망 판정은 대상이) → 결과 이벤트.
 * 사격(투사체) · 근접(부채꼴 판정)은 각자 모듈에서 대상을 찾고 여기로 넘긴다.
 * 공격 ID 는 nextAttackId() 로 발급하며, 같은 ID 로는 한 대상에 한 번만 피해가 들어간다.
 */
export class CombatSystem {
  private attackCounter = 0;
  private readonly hit: HitInfo = { damage: 0, point: new THREE.Vector3(), direction: new THREE.Vector3(), sourceId: '', attackId: 0, knockback: 0 };
  private readonly result: HitResult = { target: null as never, spec: null as never, dealt: 0, crit: false, killed: false };
  /** 치명타 판정용 난수 (테스트에서 고정 가능) */
  random: () => number = Math.random;
  /** 누적 통계 */
  stats = { hits: 0, crits: 0, damage: 0 };

  /** 피해가 들어간 뒤 호출 (이펙트 · 숙련도 · 처치 처리) */
  onHit: ((r: HitResult) => void) | null = null;

  nextAttackId(): number {
    return ++this.attackCounter;
  }

  reset(): void {
    this.stats = { hits: 0, crits: 0, damage: 0 };
  }

  /** 피해 적용. 피해가 들어가지 않았으면 (이미 맞은 공격 ID · 죽은 대상) null */
  apply(target: Damageable, spec: AttackSpec): HitResult | null {
    if (!target.canBeHit()) return null;
    const crit = spec.critChance > 0 && this.random() < spec.critChance;
    const h = this.hit;
    h.damage = spec.damage * (crit ? spec.critMultiplier : 1);
    h.point.copy(spec.point);
    h.direction.copy(spec.direction);
    h.sourceId = spec.sourceId;
    h.attackId = spec.attackId;
    h.knockback = spec.knockback;
    const before = target.health;
    target.takeDamage(h);
    const dealt = before - target.health;
    if (dealt <= 0) return null;
    const r = this.result;
    r.target = target;
    r.spec = spec;
    r.dealt = dealt;
    r.crit = crit;
    r.killed = !target.canBeHit() && target.health <= 0;
    this.stats.hits++;
    if (crit) this.stats.crits++;
    this.stats.damage += dealt;
    this.onHit?.(r);
    return r;
  }
}
