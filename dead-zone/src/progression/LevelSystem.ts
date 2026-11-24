import { xpToNextLevel } from '../config/GameConfig';

/**
 * 레벨과 경험치. 요구량을 넘으면 초과분을 다음 레벨로 이월하고,
 * 한 번에 여러 레벨이 오르면 그만큼 강화 선택 기회(pending)를 쌓는다.
 */
export class LevelSystem {
  level = 1;
  /** 현재 레벨에서 모은 경험치 */
  xp = 0;
  /** 아직 처리하지 않은 레벨업 (강화 선택 기회) */
  pending = 0;
  /** 이번 판 총 획득 경험치 */
  totalXp = 0;

  get required(): number {
    return xpToNextLevel(this.level);
  }

  reset(): void {
    this.level = 1;
    this.xp = 0;
    this.pending = 0;
    this.totalXp = 0;
  }

  /** 경험치 추가. 이번에 오른 레벨 수 반환 */
  add(amount: number): number {
    if (amount <= 0) return 0;
    this.xp += amount;
    this.totalXp += amount;
    let ups = 0;
    while (this.xp >= this.required) {
      this.xp -= this.required;
      this.level++;
      ups++;
    }
    this.pending += ups;
    return ups;
  }
}
