import { MASTERY } from '../weapons/WeaponData';

/**
 * 무기별 숙련도: 그 무기로 실제로 깎은 체력을 누적해 레벨(1~5)을 정한다.
 * 무기를 교체해도 이번 판 동안은 유지되고, 다시 시작하면 초기화된다.
 * 보너스는 레벨당 +5% (Lv1 = 0%, Lv5 = +20%) 로 해당 무기의 기본 피해에 한 번만 더해진다.
 */
export class Mastery {
  private readonly damage = new Map<string, number>();

  /** 숙련도 레벨이 오른 순간 (무기 ID, 새 레벨) */
  onLevelUp: ((id: string, level: number) => void) | null = null;

  constructor(private readonly table: (id: string) => number[]) {}

  reset(): void {
    this.damage.clear();
  }

  points(id: string): number {
    return this.damage.get(id) ?? 0;
  }

  level(id: string): number {
    const xp = this.points(id);
    const t = this.table(id);
    let lv = 1;
    for (let i = 1; i < t.length && i < MASTERY.maxLevel; i++) if (xp >= t[i]) lv = i + 1;
    return lv;
  }

  /** 피해 보너스 (Lv1 0, Lv5 0.2) */
  bonus(id: string): number {
    return (this.level(id) - 1) * MASTERY.bonusPerLevel;
  }

  /** 다음 레벨까지 진행도 0~1 (최대 레벨이면 1) */
  progress(id: string): number {
    const lv = this.level(id);
    const t = this.table(id);
    if (lv >= MASTERY.maxLevel) return 1;
    const a = t[lv - 1];
    const b = t[lv];
    return Math.min(1, (this.points(id) - a) / (b - a));
  }

  add(id: string, dealt: number): void {
    if (dealt <= 0) return;
    const before = this.level(id);
    this.damage.set(id, this.points(id) + dealt);
    const after = this.level(id);
    if (after > before) this.onLevelUp?.(id, after);
  }
}
