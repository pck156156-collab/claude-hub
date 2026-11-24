import { LevelSystem } from './LevelSystem';

/**
 * 경험치 획득 규칙: 결정 값 × 경험치 배율(강화) → 레벨 시스템.
 * 좀비 · 무기 시스템과는 이벤트(처치 → 결정 생성, 결정 도착 → collect)로만 연결된다.
 */
export class ExperienceSystem {
  readonly levels = new LevelSystem();
  multiplier = 1;
  /** 소수점 경험치 누적 (배율 때문에 생기는 끝수를 버리지 않음) */
  private fraction = 0;

  onLevelUp: ((levelsGained: number) => void) | null = null;

  reset(): void {
    this.levels.reset();
    this.multiplier = 1;
    this.fraction = 0;
  }

  /** 결정 획득 */
  collect(baseXp: number): void {
    const exact = baseXp * this.multiplier + this.fraction;
    const whole = Math.floor(exact + 1e-9);
    this.fraction = exact - whole;
    const ups = this.levels.add(whole);
    if (ups > 0) this.onLevelUp?.(ups);
  }
}
