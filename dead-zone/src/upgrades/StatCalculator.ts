import { PLAYER_CONFIG, PROGRESSION_CONFIG, WEAPON_CONFIG } from '../config/GameConfig';
import { UPGRADES } from './UpgradeData';

/** 강화로 바뀌는 플레이어 · 무기 능력치 */
export interface PlayerStats {
  damage: number;
  fireRate: number;
  magazineSize: number;
  reloadTime: number;
  /** 추가 관통 수 (0 = 첫 좀비에서 멈춤) */
  pierce: number;
  critChance: number;
  critMultiplier: number;
  moveSpeed: number;
  maxHealth: number;
  /** 받는 피해 감소율 0~1 */
  damageReduction: number;
  pickupRadius: number;
  xpMultiplier: number;
}

/** 강화 없는 기본 능력치 (설정 파일 값, 절대 수정하지 않음) */
export function baseStats(): PlayerStats {
  const w = WEAPON_CONFIG.rifle;
  return {
    damage: w.damage,
    fireRate: w.fireRate,
    magazineSize: w.magazineSize,
    reloadTime: w.reloadTime,
    pierce: 0,
    critChance: 0,
    critMultiplier: PROGRESSION_CONFIG.critMultiplier,
    moveSpeed: PLAYER_CONFIG.moveSpeed,
    maxHealth: PLAYER_CONFIG.maxHealth,
    damageReduction: 0,
    pickupRadius: PROGRESSION_CONFIG.pickupRadius,
    xpMultiplier: 1,
  };
}

/** 능력치 상 · 하한 (기본값 대비) */
export const STAT_LIMITS = {
  fireRateMaxMultiplier: 1.8,
  reloadTimeMinMultiplier: 0.35,
  moveSpeedMaxMultiplier: 1.6,
  damageReductionMax: 0.6,
  critChanceMax: 0.5,
  pickupRadiusMaxMultiplier: 3,
};

/**
 * 기본 능력치 + 강화 레벨 → 현재 능력치.
 * 같은 강화는 "기본값 × (1 + 레벨 × 수치)" 로 합산한다.
 * 매번 기본값에서 다시 계산하므로 강화를 여러 번 해도 배율이 곱해져 폭증하지 않는다.
 */
export function computeStats(levels: ReadonlyMap<string, number>): PlayerStats {
  const b = baseStats();
  const sum: Record<string, number> = {};
  for (const u of UPGRADES) {
    const lv = levels.get(u.id) ?? 0;
    if (lv <= 0 || u.instant) continue;
    sum[u.effect] = (sum[u.effect] ?? 0) + lv * u.value;
  }
  const s = (k: string) => sum[k] ?? 0;
  const L = STAT_LIMITS;
  return {
    damage: b.damage * (1 + s('damagePct')),
    fireRate: Math.min(b.fireRate * L.fireRateMaxMultiplier, b.fireRate * (1 + s('fireRatePct'))),
    magazineSize: Math.round(b.magazineSize * (1 + s('magazinePct'))),
    reloadTime: Math.max(b.reloadTime * L.reloadTimeMinMultiplier, b.reloadTime * (1 - s('reloadTimePct'))),
    pierce: Math.floor(s('pierce')),
    critChance: Math.min(L.critChanceMax, s('critChance')),
    critMultiplier: b.critMultiplier,
    moveSpeed: Math.min(b.moveSpeed * L.moveSpeedMaxMultiplier, b.moveSpeed * (1 + s('moveSpeedPct'))),
    maxHealth: b.maxHealth + s('maxHealth'),
    damageReduction: Math.min(L.damageReductionMax, s('damageReduction')),
    pickupRadius: Math.min(b.pickupRadius * L.pickupRadiusMaxMultiplier, b.pickupRadius * (1 + s('pickupRadiusPct'))),
    xpMultiplier: 1 + s('xpGainPct'),
  };
}
