import { LOADOUT } from '../weapons/WeaponData';

export type RewardKind = 'upgrade' | 'gun' | 'melee';

export interface Reward {
  kind: RewardKind;
  /** 이 보상을 준 레벨 */
  level: number;
}

const ORDER: Record<RewardKind, number> = { upgrade: 0, gun: 1, melee: 2 };

/**
 * 보상 대기열: 레벨업 강화 · 총기 보상 · 근접 무기 보상을 하나의 줄로 관리한다.
 * 같은 레벨에서는 강화 → 총기 → 근접 순서, 여러 레벨이 한꺼번에 오르면 낮은 레벨부터.
 * 화면에는 항상 맨 앞 보상 하나만 표시하고, 처리하면 다음으로 넘어간다.
 */
export class RewardQueue {
  readonly items: Reward[] = [];

  get length(): number {
    return this.items.length;
  }

  get current(): Reward | undefined {
    return this.items[0];
  }

  clear(): void {
    this.items.length = 0;
  }

  /** 레벨 하나에 도달 → 그 레벨의 보상들 추가 */
  addLevel(level: number): void {
    this.items.push({ kind: 'upgrade', level });
    if (LOADOUT.gunRewardLevels.includes(level)) this.items.push({ kind: 'gun', level });
    if (LOADOUT.meleeRewardLevels.includes(level)) this.items.push({ kind: 'melee', level });
    this.items.sort((a, b) => a.level - b.level || ORDER[a.kind] - ORDER[b.kind]);
  }

  /** 맨 앞 보상 처리 완료 */
  complete(): Reward | undefined {
    return this.items.shift();
  }
}
