import * as THREE from 'three';
import { segmentCircle } from '../world/Collision';

/** 피해 1회에 대한 정보. 무기 → 대상으로 전달된다. */
export interface HitInfo {
  damage: number;
  /** 피격 지점 (월드) */
  point: THREE.Vector3;
  /** 투사체 진행 방향 (정규화) */
  direction: THREE.Vector3;
  /** 공격한 무기 ID (향후 무기별 효과 · 통계용) */
  sourceId: string;
}

/** 피격 판정 형태: 지면 위 원기둥 */
export interface HitShape {
  x: number;
  z: number;
  radius: number;
  yMin: number;
  yMax: number;
}

/**
 * 총알 피해를 받을 수 있는 모든 대상(좀비, 향후 파괴 가능한 오브젝트)이 구현하는 인터페이스.
 * 무기 시스템은 이 인터페이스만 알고 구체적인 대상 종류는 모른다.
 */
export interface Damageable {
  readonly hitShape: HitShape;
  readonly health: number;
  readonly maxHealth: number;
  /** 현재 피격 가능한지 (파괴되어 재생성 대기 중이면 false) */
  canBeHit(): boolean;
  takeDamage(hit: HitInfo): void;
  /** 피격 시 이펙트 종류 */
  readonly material: 'wood' | 'flesh' | 'metal';
}

export interface DamageableHit {
  target: Damageable;
  t: number;
}

/** 피해 가능한 대상 목록과 투사체 판정 */
export class DamageableRegistry {
  private readonly items: Damageable[] = [];
  private readonly result: DamageableHit = { target: null as unknown as Damageable, t: 0 };

  add(d: Damageable): void {
    this.items.push(d);
  }

  remove(d: Damageable): void {
    const i = this.items.indexOf(d);
    if (i >= 0) this.items.splice(i, 1);
  }

  get count(): number {
    return this.items.length;
  }

  /** 선분이 높이 y 에서 처음 맞히는 대상 */
  raycast(x0: number, z0: number, x1: number, z1: number, y: number): DamageableHit | null {
    let best: DamageableHit | null = null;
    let bestT = Infinity;
    const dx = x1 - x0;
    const dz = z1 - z0;
    for (const d of this.items) {
      if (!d.canBeHit()) continue;
      const s = d.hitShape;
      if (y < s.yMin || y > s.yMax) continue;
      const t = segmentCircle(x0, z0, dx, dz, s.x, s.z, s.radius);
      if (t !== null && t < bestT) {
        bestT = t;
        this.result.target = d;
        this.result.t = t;
        best = this.result;
      }
    }
    return best;
  }
}
