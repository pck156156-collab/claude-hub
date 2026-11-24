/**
 * 강화(업그레이드) 데이터. 새 강화는 이 목록에 항목을 추가하고,
 * 능력치에 영향을 주면 StatCalculator 의 effect 처리에 한 줄을 더하면 된다.
 */

export type Rarity = 'common' | 'rare' | 'epic';

export const RARITY_INFO: Record<Rarity, { label: string; color: string; weight: number }> = {
  common: { label: '일반', color: '#9aa0a6', weight: 70 },
  rare: { label: '희귀', color: '#3d8bff', weight: 25 },
  epic: { label: '영웅', color: '#a855f7', weight: 5 },
};

/** 강화가 바꾸는 대상 */
export type EffectKind =
  | 'damagePct' | 'fireRatePct' | 'magazinePct' | 'reloadTimePct' | 'pierce' | 'critChance'
  | 'moveSpeedPct' | 'maxHealth' | 'heal' | 'damageReduction' | 'pickupRadiusPct' | 'xpGainPct';

export type UpgradeCategory = 'attack' | 'survival' | 'utility';

/** 선택 가능 조건 판단에 쓰는 현재 상황 */
export interface UpgradeContext {
  health: number;
  maxHealth: number;
  level(id: string): number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  /** 카드에 표시하는 한 줄 설명 */
  description: string;
  /** 짧은 기호 (카드 · HUD 아이콘) */
  icon: string;
  category: UpgradeCategory;
  rarity: Rarity;
  /** Infinity = 반복 획득 가능 */
  maxLevel: number;
  effect: EffectKind;
  /** 레벨당 효과 수치 (% 는 0.15 = 15%) */
  value: number;
  /** 즉시 효과(회복 등)만 있고 레벨이 능력치에 누적되지 않는 강화 */
  instant?: boolean;
  /** 선택 가능 조건 (없으면 항상 가능, 최대 레벨 검사는 별도) */
  condition?: (ctx: UpgradeContext) => boolean;
  /** 레벨 n 의 누적 효과 표시 (카드의 "현재 → 획득 후") */
  format: (level: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const UPGRADES: UpgradeDef[] = [
  // ── 공격
  {
    id: 'power-rounds', name: '강화 탄환', description: '총기 공격력이 증가합니다.', icon: '✦', category: 'attack',
    rarity: 'common', maxLevel: 5, effect: 'damagePct', value: 0.15, format: (l) => `공격력 +${pct(0.15 * l)}`,
  },
  {
    id: 'rapid-fire', name: '속사', description: '발사 속도가 빨라집니다.', icon: '»', category: 'attack',
    rarity: 'common', maxLevel: 5, effect: 'fireRatePct', value: 0.12, format: (l) => `발사 속도 +${pct(0.12 * l)}`,
  },
  {
    id: 'extended-mag', name: '대용량 탄창', description: '탄창 용량이 늘어납니다.', icon: '▥', category: 'attack',
    rarity: 'common', maxLevel: 5, effect: 'magazinePct', value: 0.2, format: (l) => `탄창 +${pct(0.2 * l)}`,
  },
  {
    id: 'quick-reload', name: '신속 재장전', description: '재장전 시간이 줄어듭니다.', icon: '↻', category: 'attack',
    rarity: 'common', maxLevel: 5, effect: 'reloadTimePct', value: 0.12, format: (l) => `재장전 시간 -${pct(0.12 * l)}`,
  },
  {
    id: 'piercing', name: '관통 탄환', description: '총알이 좀비를 추가로 관통합니다.', icon: '⇶', category: 'attack',
    rarity: 'epic', maxLevel: 3, effect: 'pierce', value: 1, format: (l) => `관통 +${l}마리`,
  },
  {
    id: 'critical', name: '치명타 강화', description: '치명타(피해 2배) 확률이 증가합니다.', icon: '✸', category: 'attack',
    rarity: 'rare', maxLevel: 5, effect: 'critChance', value: 0.05, format: (l) => `치명타 확률 ${Math.round(5 * l)}%`,
  },
  // ── 생존
  {
    id: 'swift', name: '신속', description: '이동 속도가 증가합니다.', icon: '➟', category: 'survival',
    rarity: 'common', maxLevel: 5, effect: 'moveSpeedPct', value: 0.1, format: (l) => `이동 속도 +${pct(0.1 * l)}`,
  },
  {
    id: 'toughness', name: '강인함', description: '최대 체력 +20, 현재 체력도 20 회복합니다.', icon: '♥', category: 'survival',
    rarity: 'rare', maxLevel: 5, effect: 'maxHealth', value: 20, format: (l) => `최대 체력 +${20 * l}`,
  },
  {
    id: 'first-aid', name: '응급 치료', description: '체력을 30 회복합니다. 반복 획득 가능.', icon: '✚', category: 'survival',
    rarity: 'common', maxLevel: Infinity, effect: 'heal', value: 30, instant: true,
    // 체력이 가득 차 있으면 등장하지 않음
    condition: (c) => c.health < c.maxHealth,
    format: () => '체력 30 회복',
  },
  {
    id: 'armor', name: '방탄 장비', description: '받는 피해가 줄어듭니다.', icon: '◈', category: 'survival',
    rarity: 'rare', maxLevel: 5, effect: 'damageReduction', value: 0.08, format: (l) => `받는 피해 -${pct(0.08 * l)}`,
  },
  // ── 유틸리티
  {
    id: 'magnet', name: '자석', description: '경험치 획득 범위가 넓어집니다.', icon: '⊛', category: 'utility',
    rarity: 'common', maxLevel: 5, effect: 'pickupRadiusPct', value: 0.25, format: (l) => `획득 범위 +${pct(0.25 * l)}`,
  },
  {
    id: 'xp-boost', name: '경험치 증폭', description: '획득 경험치가 증가합니다.', icon: '✧', category: 'utility',
    rarity: 'rare', maxLevel: 5, effect: 'xpGainPct', value: 0.15, format: (l) => `경험치 +${pct(0.15 * l)}`,
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
