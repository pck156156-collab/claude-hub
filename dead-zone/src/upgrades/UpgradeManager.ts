import { PlayerStats, computeStats } from './StatCalculator';
import { RARITY_INFO, Rarity, UPGRADES, UPGRADE_BY_ID, UpgradeContext, UpgradeDef } from './UpgradeData';

export interface UpgradeChoice {
  def: UpgradeDef;
  /** 이번 카드에 표시된 희귀도 (지금은 강화 자체의 희귀도와 같음, 향후 등급별 효과 차이용) */
  rarity: Rarity;
  currentLevel: number;
  nextLevel: number;
}

/**
 * 강화 레벨 보관 · 무작위 선택지 생성 · 적용.
 * 능력치는 항상 computeStats(레벨) 로 기본값에서 다시 계산한다 (기본 능력치 보존).
 */
export class UpgradeManager {
  readonly levels = new Map<string, number>();
  stats: PlayerStats = computeStats(this.levels);
  /** 한 판 동안 선택한 순서 (HUD · 결과 화면) */
  readonly history: string[] = [];
  random: () => number = Math.random;

  /** 능력치가 바뀌면 호출 (무기 · 플레이어 · 경험치 시스템에 반영) */
  onStatsChanged: ((stats: PlayerStats) => void) | null = null;
  /** 즉시 효과 (회복 등) */
  onInstantEffect: ((def: UpgradeDef) => void) | null = null;

  level(id: string): number {
    return this.levels.get(id) ?? 0;
  }

  /** 획득한 강화 종류 수 */
  get ownedCount(): number {
    let n = 0;
    for (const v of this.levels.values()) if (v > 0) n++;
    return n;
  }

  reset(): void {
    this.levels.clear();
    this.history.length = 0;
    this.recompute();
  }

  /** 지금 선택할 수 있는 강화인지 (최대 레벨 · 조건) */
  isAvailable(def: UpgradeDef, ctx: UpgradeContext): boolean {
    if (this.level(def.id) >= def.maxLevel) return false;
    return def.condition ? def.condition(ctx) : true;
  }

  /**
   * 서로 다른 강화 n 개 추첨.
   * 1) 희귀도를 확률(70/25/5)로 먼저 뽑고 2) 그 등급에서 선택 가능한 강화 중 하나를 고른다.
   * 그 등급에 남은 강화가 없으면 다른 등급에서 고른다 → 최대 레벨 · 조건 불충족 카드는 절대 나오지 않음.
   */
  rollChoices(ctx: UpgradeContext, n = 3): UpgradeChoice[] {
    const pool = UPGRADES.filter((u) => this.isAvailable(u, ctx));
    const out: UpgradeChoice[] = [];
    while (out.length < n && pool.length > 0) {
      const rarity = this.rollRarity();
      let candidates = pool.filter((u) => u.rarity === rarity);
      if (candidates.length === 0) candidates = pool;
      const def = candidates[Math.floor(this.random() * candidates.length)];
      pool.splice(pool.indexOf(def), 1);
      const lv = this.level(def.id);
      out.push({ def, rarity: def.rarity, currentLevel: lv, nextLevel: lv + 1 });
    }
    return out;
  }

  /** 강화 적용: 레벨 +1 → 능력치 재계산 → 즉시 효과 */
  apply(id: string): void {
    const def = UPGRADE_BY_ID[id];
    if (!def) throw new Error(`unknown upgrade ${id}`);
    if (this.level(id) >= def.maxLevel) return;
    this.levels.set(id, this.level(id) + 1);
    this.history.push(id);
    this.recompute();
    this.onInstantEffect?.(def);
  }

  private recompute(): void {
    this.stats = computeStats(this.levels);
    this.onStatsChanged?.(this.stats);
  }

  private rollRarity(): Rarity {
    const entries = Object.entries(RARITY_INFO) as [Rarity, { weight: number }][];
    const total = entries.reduce((a, [, r]) => a + r.weight, 0);
    let x = this.random() * total;
    for (const [k, r] of entries) {
      if ((x -= r.weight) < 0) return k;
    }
    return 'common';
  }
}
