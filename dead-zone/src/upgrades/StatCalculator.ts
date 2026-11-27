import { PLAYER_CONFIG, PROGRESSION_CONFIG } from '../config/GameConfig';
import { WeaponStats, statsFromDef } from '../weapons/Weapon';
import { GunDef, MeleeDef } from '../weapons/WeaponData';
import { UPGRADES } from './UpgradeData';

/**
 * 강화로 바뀌는 "보정값" (무기와 무관). 실제 무기 능력치는
 * computeGunStats / computeMeleeStats 가 무기 기본값 + 이 보정값 + 숙련도로 계산한다.
 */
export interface PlayerStats {
  // ── 총기 (모든 총기 공통)
  gunDamagePct: number;
  fireRatePct: number;
  magazinePct: number;
  reloadTimePct: number;
  pierce: number;
  critChance: number;
  critMultiplier: number;
  // ── 근접 (근접 무기에만)
  meleeDamagePct: number;
  meleeRangePct: number;
  meleeSpeedPct: number;
  meleeKnockbackPct: number;
  /** 근접 처치 시 회복량 */
  meleeLifesteal: number;
  // ── 생존 · 유틸
  moveSpeed: number;
  maxHealth: number;
  /** 받는 피해 감소율 0~1 */
  damageReduction: number;
  pickupRadius: number;
  xpMultiplier: number;
}

/** 능력치 상 · 하한 (무기 기본값 대비 배율) */
export const STAT_LIMITS = {
  fireRateMaxMultiplier: 1.8,
  reloadTimeMinMultiplier: 0.35,
  moveSpeedMaxMultiplier: 1.6,
  damageReductionMax: 0.6,
  critChanceMax: 0.5,
  pickupRadiusMaxMultiplier: 3,
  meleeIntervalMinMultiplier: 0.5,
  meleeRangeMaxMultiplier: 1.5,
  meleeKnockbackMaxMultiplier: 2,
};

/**
 * 강화 레벨 → 보정값. 같은 강화는 레벨 × 수치로 합산하고, 매번 0 에서 다시 계산한다
 * (현재 값에 배율을 거듭 곱하지 않음).
 */
export function computeStats(levels: ReadonlyMap<string, number>): PlayerStats {
  const sum: Record<string, number> = {};
  for (const u of UPGRADES) {
    const lv = levels.get(u.id) ?? 0;
    if (lv <= 0 || u.instant) continue;
    sum[u.effect] = (sum[u.effect] ?? 0) + lv * u.value;
  }
  const s = (k: string) => sum[k] ?? 0;
  const L = STAT_LIMITS;
  const baseSpeed = PLAYER_CONFIG.moveSpeed;
  const basePick = PROGRESSION_CONFIG.pickupRadius;
  return {
    gunDamagePct: s('damagePct'),
    fireRatePct: s('fireRatePct'),
    magazinePct: s('magazinePct'),
    reloadTimePct: s('reloadTimePct'),
    pierce: Math.floor(s('pierce')),
    critChance: Math.min(L.critChanceMax, s('critChance')),
    critMultiplier: PROGRESSION_CONFIG.critMultiplier,
    meleeDamagePct: s('meleeDamagePct'),
    meleeRangePct: s('meleeRangePct'),
    meleeSpeedPct: s('meleeSpeedPct'),
    meleeKnockbackPct: s('meleeKnockbackPct'),
    meleeLifesteal: s('meleeLifesteal'),
    moveSpeed: Math.min(baseSpeed * L.moveSpeedMaxMultiplier, baseSpeed * (1 + s('moveSpeedPct'))),
    maxHealth: PLAYER_CONFIG.maxHealth + s('maxHealth'),
    damageReduction: Math.min(L.damageReductionMax, s('damageReduction')),
    pickupRadius: Math.min(basePick * L.pickupRadiusMaxMultiplier, basePick * (1 + s('pickupRadiusPct'))),
    xpMultiplier: 1 + s('xpGainPct'),
  };
}

/**
 * 총기 최종 능력치 = 총기 기본값 × (1 + 일반 강화 + 숙련도 보너스).
 * 순서: ① 기본값 ② 강화 · 숙련도 합산(가산) ③ 상 · 하한. 숙련도는 피해에만 적용.
 */
export function computeGunStats(def: GunDef, m: PlayerStats, masteryBonus: number): WeaponStats {
  const b = statsFromDef(def);
  const L = STAT_LIMITS;
  return {
    ...b,
    damage: b.damage * (1 + m.gunDamagePct + masteryBonus),
    fireRate: Math.min(b.fireRate * L.fireRateMaxMultiplier, b.fireRate * (1 + m.fireRatePct)),
    magazineSize: Math.round(b.magazineSize * (1 + m.magazinePct)),
    reloadTime: Math.max(b.reloadTime * L.reloadTimeMinMultiplier, b.reloadTime * (1 - m.reloadTimePct)),
    pierce: m.pierce,
  };
}

export interface MeleeStats {
  damage: number;
  interval: number;
  range: number;
  arcDeg: number;
  maxTargets: number;
  knockback: number;
  /** 동작 길이 · 타격 순간 (간격 단축에 맞춰 같이 빨라짐) */
  duration: number;
  hitTime: number;
  lifesteal: number;
}

/** 근접 최종 능력치 = 근접 기본값 × (1 + 근접 강화 + 숙련도). 총기 강화는 적용하지 않는다 */
export function computeMeleeStats(def: MeleeDef, m: PlayerStats, masteryBonus: number): MeleeStats {
  const L = STAT_LIMITS;
  const speed = Math.max(L.meleeIntervalMinMultiplier, 1 - m.meleeSpeedPct);
  return {
    damage: def.damage * (1 + m.meleeDamagePct + masteryBonus),
    interval: def.interval * speed,
    range: def.range * Math.min(L.meleeRangeMaxMultiplier, 1 + m.meleeRangePct),
    arcDeg: def.arcDeg,
    maxTargets: def.maxTargets,
    knockback: def.knockback * Math.min(L.meleeKnockbackMaxMultiplier, 1 + m.meleeKnockbackPct),
    duration: def.duration * speed,
    hitTime: def.hitTime * speed,
    lifesteal: m.meleeLifesteal,
  };
}
