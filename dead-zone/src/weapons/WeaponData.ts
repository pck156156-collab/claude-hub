/**
 * 무기 데이터 (총기 5종 · 근접 무기 4종 · 숙련도).
 * 무기를 추가하거나 밸런스를 바꿀 때는 이 파일만 고치면 된다.
 * 여기 값은 "기본 능력치"이며, 강화 · 숙련도는 StatCalculator 가 이 값에서 다시 계산한다.
 */

export type GunId = 'p9' | 'viper' | 'ar12' | 'bulldog' | 'titan';
export type MeleeId = 'knife' | 'machete' | 'bat' | 'axe';

export interface GunDef {
  id: GunId;
  name: string;
  /** 한 줄 특징 (보상 화면) */
  role: string;
  /** 탄 1발(산탄 1개) 피해 */
  damage: number;
  /** 1회 발사당 탄 수 (샷건 8) */
  pellets: number;
  /** 초당 발사 횟수 */
  fireRate: number;
  /** true = 누르고 있으면 연사, false = 클릭당 1발 */
  auto: boolean;
  magazineSize: number;
  reloadTime: number;
  projectileSpeed: number;
  range: number;
  /** 기본 탄 퍼짐 (±도) */
  spreadDeg: number;
  /** 최고 속도로 이동 중일 때 더해지는 퍼짐 (±도). 작을수록 이동 사격에 유리 */
  moveSpreadDeg: number;
  /** 산탄 부채꼴 전체 각도 (도) */
  pelletConeDeg: number;
  /** 거리별 피해 감소: falloffStart 까지 100%, falloffEnd 에서 minFalloff 배 */
  falloffStart: number;
  falloffEnd: number;
  minFalloff: number;
  /** 넉백 속도 (좀비 기준 단위/초) */
  knockback: number;
  /** 시각 반동 세기 (모델 뒤로 밀림, 단위) */
  recoil: number;
  /** 총구 화염 크기 배율 */
  flashScale: number;
  /** 궤적 색 · 굵기 */
  tracerColor: number;
  tracerWidth: number;
  /** 사운드: 높이 · 저음 크기 */
  soundPitch: number;
  soundBody: number;
  /** 사거리 표시용 등급 */
  rangeLabel: string;
  /**
   * 총을 몸 쪽으로 당겨 잡는 거리 (음수 = 몸 쪽). 짧은 총은 두 손이 손잡이에 닿도록 당긴다.
   * 총구 위치도 같이 움직이므로 탄은 항상 보이는 총구에서 나간다.
   */
  holdZ: number;
}

export const GUNS: Record<GunId, GunDef> = {
  p9: {
    id: 'p9', name: 'P9 권총', role: '높은 정확도 · 반자동 (클릭당 1발)',
    damage: 35, pellets: 1, fireRate: 3, auto: false, magazineSize: 15, reloadTime: 1.2,
    projectileSpeed: 70, range: 40, spreadDeg: 0.25, moveSpreadDeg: 0.6, pelletConeDeg: 0,
    falloffStart: 999, falloffEnd: 999, minFalloff: 1, knockback: 2.2, recoil: 0.05, flashScale: 0.7,
    tracerColor: 0xffe2a0, tracerWidth: 0.06, soundPitch: 1.35, soundBody: 0.45, rangeLabel: '중거리', holdZ: -0.45,
  },
  viper: {
    id: 'viper', name: 'Viper SMG', role: '매우 빠른 연사 · 이동 사격에 유리',
    damage: 15, pellets: 1, fireRate: 12, auto: true, magazineSize: 40, reloadTime: 1.6,
    projectileSpeed: 58, range: 32, spreadDeg: 3.2, moveSpreadDeg: 0.4, pelletConeDeg: 0,
    falloffStart: 999, falloffEnd: 999, minFalloff: 1, knockback: 1.2, recoil: 0.04, flashScale: 0.65,
    tracerColor: 0xfff0b0, tracerWidth: 0.05, soundPitch: 1.5, soundBody: 0.3, rangeLabel: '근 · 중거리', holdZ: -0.2,
  },
  ar12: {
    id: 'ar12', name: 'AR-12 돌격소총', role: '균형 잡힌 화력 · 중거리 전투',
    damage: 25, pellets: 1, fireRate: 8, auto: true, magazineSize: 30, reloadTime: 1.8,
    projectileSpeed: 60, range: 45, spreadDeg: 0.8, moveSpreadDeg: 1.4, pelletConeDeg: 0,
    falloffStart: 999, falloffEnd: 999, minFalloff: 1, knockback: 2.6, recoil: 0.09, flashScale: 1,
    tracerColor: 0xffd28a, tracerWidth: 0.08, soundPitch: 1, soundBody: 0.7, rangeLabel: '중 · 원거리', holdZ: 0,
  },
  bulldog: {
    id: 'bulldog', name: 'Bulldog 샷건', role: '산탄 8발 · 근거리 고화력 · 멀수록 약함',
    damage: 12, pellets: 8, fireRate: 1.2, auto: true, magazineSize: 8, reloadTime: 2.4,
    projectileSpeed: 55, range: 17, spreadDeg: 1, moveSpreadDeg: 1, pelletConeDeg: 26,
    falloffStart: 5, falloffEnd: 16, minFalloff: 0.4, knockback: 1.6, recoil: 0.17, flashScale: 1.6,
    tracerColor: 0xffb070, tracerWidth: 0.05, soundPitch: 0.7, soundBody: 1.1, rangeLabel: '근거리', holdZ: -0.04,
  },
  titan: {
    id: 'titan', name: 'Titan LMG', role: '탄창 100발 · 지속 화력 · 긴 재장전',
    damage: 20, pellets: 1, fireRate: 10, auto: true, magazineSize: 100, reloadTime: 4.0,
    projectileSpeed: 65, range: 45, spreadDeg: 2.8, moveSpreadDeg: 2.6, pelletConeDeg: 0,
    falloffStart: 999, falloffEnd: 999, minFalloff: 1, knockback: 2.4, recoil: 0.12, flashScale: 1.25,
    tracerColor: 0xffa860, tracerWidth: 0.09, soundPitch: 0.85, soundBody: 0.9, rangeLabel: '중 · 원거리', holdZ: 0,
  },
};

export type MeleeStyle = 'stab' | 'slash' | 'swing' | 'chop';

export interface MeleeDef {
  id: MeleeId;
  name: string;
  role: string;
  damage: number;
  /** 공격 간격 (초): 한 번 공격 후 다음 공격까지 */
  interval: number;
  /** 사거리 (플레이어 중심에서) */
  range: number;
  /** 공격 부채꼴 전체 각도 (도) */
  arcDeg: number;
  /** 한 번에 맞힐 수 있는 최대 좀비 수 */
  maxTargets: number;
  /** 넉백 속도 (단위/초). 4 이상이면 좀비의 공격 동작도 끊는다 */
  knockback: number;
  style: MeleeStyle;
  /** 동작 시간 비율: 휘두르기 전체 길이 · 타격 판정 순간 (초, 간격과 함께 강화로 줄어듦) */
  duration: number;
  hitTime: number;
  /** 궤적 색 */
  trailColor: number;
}

export const MELEE: Record<MeleeId, MeleeDef> = {
  knife: {
    id: 'knife', name: 'Combat Knife', role: '빠른 찌르기 · 좁은 범위 · 위기 대응',
    damage: 28, interval: 0.35, range: 1.6, arcDeg: 85, maxTargets: 2, knockback: 1.5,
    style: 'stab', duration: 0.26, hitTime: 0.09, trailColor: 0xdfe8ff,
  },
  machete: {
    id: 'machete', name: 'Machete', role: '균형 잡힌 넓은 베기',
    damage: 45, interval: 0.65, range: 2.1, arcDeg: 110, maxTargets: 3, knockback: 3,
    style: 'slash', duration: 0.42, hitTime: 0.17, trailColor: 0xcfe4ff,
  },
  bat: {
    id: 'bat', name: 'Baseball Bat', role: '넓은 휘두르기 · 최대 4마리 · 강한 넉백',
    damage: 35, interval: 0.9, range: 2.4, arcDeg: 125, maxTargets: 4, knockback: 6.5,
    style: 'swing', duration: 0.5, hitTime: 0.22, trailColor: 0xffd9a0,
  },
  axe: {
    id: 'axe', name: 'Fire Axe', role: '느리지만 강력한 내려치기',
    damage: 70, interval: 1.1, range: 1.9, arcDeg: 95, maxTargets: 2, knockback: 4.5,
    style: 'chop', duration: 0.62, hitTime: 0.33, trailColor: 0xffb0a0,
  },
};

/** 초기 장착 · 보상 대상 */
export const LOADOUT = {
  startGuns: ['ar12', 'p9'] as [GunId, GunId],
  startMelee: 'knife' as MeleeId,
  /** 이 레벨에 도달하면 총기 보상 */
  gunRewardLevels: [3, 6, 9],
  gunRewardPool: ['viper', 'bulldog', 'titan'] as GunId[],
  /** 이 레벨에 도달하면 근접 무기 보상 */
  meleeRewardLevels: [2, 5, 8],
  meleeRewardPool: ['machete', 'bat', 'axe'] as MeleeId[],
};

/**
 * 숙련도: 그 무기로 실제로 준 피해량(좀비에게 남아 있던 체력까지만)으로 오른다.
 * xp[i] = 레벨 i+1 이 되는 데 필요한 누적 피해. 보너스는 레벨당 +5% (Lv5 = +20%).
 */
export const MASTERY = {
  maxLevel: 5,
  gunXp: [0, 600, 1800, 4000, 8000],
  meleeXp: [0, 250, 750, 1700, 3400],
  bonusPerLevel: 0.05,
};
