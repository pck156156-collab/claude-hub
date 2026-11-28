/**
 * 적 종류 데이터 (6단계: 특수 좀비 · 엘리트 · 보스) + 웨이브별 등장 규칙.
 * 밸런스(능력치 · 등장 비율 · 동시 출현 상한 · 보스 성장)는 이 파일만 고치면 된다.
 * 일반 좀비(워커)는 기존 GameConfig.ZOMBIE_TYPES.walker 를 그대로 사용한다.
 */
import { EnemyKind, ZOMBIE_TYPES, ZombieStats } from '../config/GameConfig';

const walker = ZOMBIE_TYPES.walker;

export const ENEMY_TYPES: Record<EnemyKind, ZombieStats> = {
  walker,

  // ── 러너: 빠른 추적 · 짧은 가속 · 빠른 공격. 방향 전환은 곡선(steerRate)이라 옆으로 피할 수 있다
  runner: {
    ...walker,
    id: 'runner', name: '러너', kind: 'runner', attackType: 'melee',
    maxHealth: 60, moveSpeed: 4.5, attackDamage: 8, attackRange: 1.35, attackInterval: 0.8,
    attackWindup: 0.22, attackDuration: 0.5, attackArcDeg: 70, radius: 0.34,
    hitStunTime: 0.2, knockback: 3, knockbackResistance: 0.05, statusResistance: 0,
    turnSpeed: 7, steerRate: 5.5, mass: 0.8, spawnTime: 0.8, xp: 15,
    abilities: ['빠른 추적', '짧은 가속 (돌진 전 웅크림)'],
    dash: { minDist: 2.6, maxDist: 8, prepTime: 0.3, time: 0.65, speedMul: 1.5, turnRate: 1.8, cooldown: 3.5 },
    appearance: {
      scale: 0.95, hunch: 0.55, gait: 'run',
      skin: [0x9aa39a, 0xa3a896, 0x8f9a92], shirts: [0x6b2320, 0x2b3c52, 0x50523a], pants: [0x2a2c30, 0x3a3328],
      build: { torso: [0.8, 1, 0.78], limb: 0.72, head: 0.95, shoulder: 0.88, belly: 0, bellyZ: 0 },
      eye: 0xff5a3a,
    },
  },

  // ── 탱커: 느림 · 높은 체력 · 강한 공격. 예비 동작이 길고 바닥에 공격 범위가 표시된다
  tank: {
    ...walker,
    id: 'tank', name: '탱커', kind: 'tank', attackType: 'melee',
    maxHealth: 500, moveSpeed: 1.4, attackDamage: 25, attackRange: 2.1, attackInterval: 1.8,
    attackWindup: 0.95, attackDuration: 1.55, attackArcDeg: 55, radius: 0.68,
    hitStunTime: 0.15, knockback: 1, knockbackResistance: 0.8, statusResistance: 0.85,
    turnSpeed: 2.4, steerRate: 0, mass: 3.5, telegraph: true, spawnTime: 1.6, corpseTime: 4, xp: 40,
    abilities: ['높은 체력', '넉백 저항 80%', '강한 내려치기 (바닥 범위 표시)'],
    appearance: {
      scale: 1.4, hunch: 0.22, gait: 'stomp',
      skin: [0x6d6a78, 0x75707a, 0x666a70], shirts: [0x2c2a2a, 0x3b3530], pants: [0x26282a, 0x30302c],
      build: { torso: [1.45, 1.1, 1.35], limb: 1.7, leg: 1.6, head: 0.9, shoulder: 1.45, belly: 0.8, bellyZ: 0.04 },
      eye: 0xffb030,
    },
  },

  // ── 스피터: 거리 유지 · 독성 투사체 · 공격 후 자리 이동 · 가까우면 후퇴
  spitter: {
    ...walker,
    id: 'spitter', name: '스피터', kind: 'spitter', attackType: 'ranged',
    maxHealth: 90, moveSpeed: 1.8, attackDamage: 12, attackRange: 12, attackInterval: 2.5,
    attackWindup: 0.65, attackDuration: 1, attackArcDeg: 0, radius: 0.4,
    knockbackResistance: 0.1, statusResistance: 0, turnSpeed: 4, steerRate: 0, mass: 1, xp: 25,
    abilities: ['원거리 독성 투사체', '거리 유지 · 후퇴'],
    ranged: { range: 12, preferMin: 7, preferMax: 10.5, retreatDist: 5, windup: 0.65, recover: 0.35, projectileSpeed: 11, projectileRadius: 0.28, repositionTime: 1.3 },
    appearance: {
      scale: 1, hunch: 0.45, gait: 'lurch',
      skin: [0x9ea85a, 0xa8b064, 0x93a052], shirts: [0x3d4a2a, 0x463c28], pants: [0x2a2e22, 0x33301f],
      build: { torso: [0.88, 1, 0.9], limb: 0.85, head: 1.1, shoulder: 0.95, belly: 0, bellyZ: 0 },
      glow: 0x7dff3a, eye: 0xc8ff40,
    },
  },

  // ── 폭발 좀비: 접근 → 준비(경고) → 폭발. 총으로 먼저 처치하면 폭발하지 않는다
  exploder: {
    ...walker,
    id: 'exploder', name: '폭발 좀비', kind: 'exploder', attackType: 'explode',
    maxHealth: 120, moveSpeed: 2.4, attackDamage: 30, attackRange: 2.2, attackInterval: 99,
    radius: 0.5, knockbackResistance: 0.15, statusResistance: 0.2, turnSpeed: 4, mass: 1.3, xp: 25,
    abilities: ['근접 시 1.2초 후 자폭 (반경 4)', '먼저 처치하면 폭발 없음'],
    explode: { trigger: 2.2, radius: 4, primeTime: 1.2, damage: 30, primeSpeedMul: 0.35 },
    appearance: {
      scale: 1.05, hunch: 0.2, gait: 'waddle',
      skin: [0xa07a66, 0x9a7060, 0xa8806a], shirts: [0x4a3a30, 0x3a2f2a], pants: [0x2c2622, 0x33291f],
      build: { torso: [1.25, 0.95, 1.3], limb: 1.15, head: 0.88, shoulder: 1.15, belly: 1.5, bellyZ: 0.1 },
      glow: 0xff7a1a, eye: 0xffd040,
    },
  },

  // ── 보스: THE ABOMINATION
  boss: {
    ...walker,
    id: 'boss', name: 'THE ABOMINATION', kind: 'boss', attackType: 'boss',
    maxHealth: 3000, moveSpeed: 1.8, attackDamage: 35, attackRange: 3.3, attackInterval: 1.6,
    radius: 1.25, hitStunTime: 0, knockback: 0, knockbackResistance: 1, statusResistance: 1,
    turnSpeed: 2.2, steerRate: 2.4, mass: 12, spawnTime: 2.4, corpseTime: 6, xp: 300,
    abilities: ['A 근접 강타', 'B 돌진', 'C 지면 강타', '체력 50% 이하 2페이즈'],
    boss: {
      meleeRange: 3.3, meleeArcDeg: 50, meleeWindup: 0.8, meleeRecover: 0.7, meleeInterval: 1.6,
      chargeMinDist: 5.5, chargeMaxDist: 22, chargeDistance: 18, chargeSpeed: 12, chargeWindup: 1.2,
      chargeLock: 0.4, chargeTurnRate: 0.12, chargeCooldown: 8, chargeDamageMul: 1.2, chargeRecover: 0.9, chargeWallRecover: 1.6,
      slamRadius: 5, slamTrigger: 4.2, slamWindup: 1.35, slamCooldown: 7, slamDamageMul: 0.9, slamRecover: 1.0,
      patternGap: 0.6,
      phase2: { threshold: 0.5, cooldownMul: 0.7, windupMul: 0.85, speedMul: 1.15, chargeCooldown: 5, slamRadiusMul: 1.3, roarTime: 1.4 },
    },
    appearance: {
      scale: 2.3, hunch: 0.32, gait: 'boss',
      skin: [0x7a4a40], shirts: [0x5a2e2a], pants: [0x3a2420],
      build: { torso: [1.5, 1.15, 1.4], limb: 1.9, leg: 1.7, head: 0.85, shoulder: 1.5, belly: 1.6, bellyZ: -0.13 },
      glow: 0xff7a1a, eye: 0xffa020,
    },
  },
};

/** 엘리트: 기존 종류의 강화 변형 (AI 는 원래 종류 그대로) */
export const ELITE_CONFIG = {
  health: 3,
  damage: 1.5,
  speed: 1.1,
  xp: 5,
  /** 남은 넉백 저항의 이 비율만큼 더해짐 (워커 0 → 0.5, 탱커 0.8 → 0.9) */
  knockbackResistanceGain: 0.5,
  statusResistanceGain: 0.4,
  scale: 1.18,
  fromWave: 7,
  chance: { base: 0.05, perWave: 0.005, max: 0.12 },
  /** 동시에 살아 있을 수 있는 엘리트 수 */
  maxAlive: 2,
  maxAliveLate: 3,
  lateWave: 12,
  kinds: ['walker', 'runner', 'tank', 'spitter', 'exploder'] as EnemyKind[],
  color: 0xffc23a,
};

const eliteCache = new Map<ZombieStats, ZombieStats>();

/** 엘리트 능력치 (같은 기본 능력치에는 같은 객체를 돌려줌 → 외형 · 팔레트 캐시 재사용) */
export function makeElite(base: ZombieStats): ZombieStats {
  const hit = eliteCache.get(base);
  if (hit) return hit;
  const c = ELITE_CONFIG;
  const e: ZombieStats = {
    ...base,
    id: `${base.id}-elite`,
    name: `엘리트 ${base.name}`,
    elite: true,
    maxHealth: Math.round(base.maxHealth * c.health),
    attackDamage: +(base.attackDamage * c.damage).toFixed(2),
    moveSpeed: +(base.moveSpeed * c.speed).toFixed(3),
    xp: base.xp * c.xp,
    knockbackResistance: +(base.knockbackResistance + (1 - base.knockbackResistance) * c.knockbackResistanceGain).toFixed(3),
    statusResistance: +(base.statusResistance + (1 - base.statusResistance) * c.statusResistanceGain).toFixed(3),
    explode: base.explode ? { ...base.explode, damage: +(base.explode.damage * c.damage).toFixed(2) } : undefined,
    appearance: { ...base.appearance, scale: base.appearance.scale * c.scale },
    abilities: [...base.abilities, '엘리트: 체력 3배 · 피해 1.5배 · 경험치 5배'],
  };
  if (eliteCache.size > 64) eliteCache.clear();
  eliteCache.set(base, e);
  return e;
}

/** 웨이브 체력 · 속도 배율을 적용한 능력치 (보스 제외) */
export function scaleForWave(base: ZombieStats, healthMul: number, speedMul: number): ZombieStats {
  return {
    ...base,
    maxHealth: Math.round(base.maxHealth * healthMul),
    moveSpeed: +(base.moveSpeed * speedMul).toFixed(3),
  };
}

/**
 * 웨이브별 등장 규칙 (데이터).
 * - unlock: 이 웨이브부터 등장 (이후 웨이브에도 계속 등장)
 * - weight: 생성 1회마다 종류를 고르는 가중치 = base + perWave × (웨이브 - unlock), 최대 max
 * - cap: 동시에 살아 있을 수 있는 수 = base + perWave × (웨이브 - unlock), 최대 max
 *   (빠른 좀비 · 스피터 · 탱커 · 폭발 좀비가 한꺼번에 몰리지 않도록)
 */
export const SPAWN_TABLE: Record<Exclude<EnemyKind, 'boss'>, { unlock: number; weight: { base: number; perWave: number; max: number }; cap: { base: number; perWave: number; max: number } }> = {
  walker: { unlock: 1, weight: { base: 1, perWave: 0, max: 1 }, cap: { base: 999, perWave: 0, max: 999 } },
  // 러너: 도망칠 수 없을 만큼 몰리지 않도록 상한 6
  runner: { unlock: 2, weight: { base: 0.2, perWave: 0.025, max: 0.38 }, cap: { base: 2, perWave: 0.4, max: 6 } },
  spitter: { unlock: 3, weight: { base: 0.13, perWave: 0.015, max: 0.26 }, cap: { base: 2, perWave: 0.3, max: 5 } },
  tank: { unlock: 4, weight: { base: 0.07, perWave: 0.01, max: 0.15 }, cap: { base: 1, perWave: 0.2, max: 3 } },
  exploder: { unlock: 6, weight: { base: 0.1, perWave: 0.015, max: 0.2 }, cap: { base: 2, perWave: 0.25, max: 4 } },
};

/** 종류별 최소 생성 거리 추가 (폭발 좀비가 가까이에서 생기지 않도록) */
export const SPAWN_EXTRA_DISTANCE: Partial<Record<EnemyKind, number>> = { exploder: 5, tank: 2 };

export function spawnWeight(kind: Exclude<EnemyKind, 'boss'>, wave: number): number {
  const r = SPAWN_TABLE[kind];
  if (wave < r.unlock) return 0;
  return Math.min(r.weight.max, r.weight.base + r.weight.perWave * (wave - r.unlock));
}

export function spawnCap(kind: Exclude<EnemyKind, 'boss'>, wave: number): number {
  const r = SPAWN_TABLE[kind];
  if (wave < r.unlock) return 0;
  return Math.min(r.cap.max, Math.floor(r.cap.base + r.cap.perWave * (wave - r.unlock)));
}

export function eliteChance(wave: number): number {
  const c = ELITE_CONFIG;
  if (wave < c.fromWave) return 0;
  return Math.min(c.chance.max, c.chance.base + c.chance.perWave * (wave - c.fromWave));
}

/** 독성 투사체 전체 제한 (스피터 여러 마리가 동시에 쏟아붓지 않도록) */
export const SPIT_LIMITS = {
  /** 동시에 날아가는 투사체 최대 수 */
  maxInFlight: 4,
  /** 서로 다른 스피터의 발사 사이 최소 간격 (초) */
  minGap: 0.4,
  /** 준비 중 경직 등으로 발사하지 못한 예약이 풀리는 시간 */
  reserveTimeout: 1.2,
};

/** 보스 등장 · 성장 · 보스 웨이브 조정 */
export const BOSS_CONFIG = {
  firstWave: 5,
  every: 5,
  /** 웨이브 시작 → 등장까지 (웨이브 알림과 겹치지 않게) */
  spawnDelay: 2.8,
  /** 이전 보스가 살아 있어 대기 중인 보스: 이전 보스 처치 후 이 시간 뒤 등장 */
  queuedDelay: 4,
  /** n 번째 보스: 체력 × (1 + health × (n-1)), 피해 × (1 + damage × (n-1)) */
  growth: { health: 0.6, damage: 0.15, maxHealthMul: 4, maxDamageMul: 2 },
  /** 보스 생성 거리 (플레이어 기준). 화면 안이어도 되며, 주변이 넓은 곳만 */
  minDistance: 13,
  maxDistance: 20,
  clearance: 2.6,
  /** 보스가 살아 있는 동안 일반 좀비 생성 조정 */
  aliveMaxMul: 0.6,
  intervalMul: 1.4,
};

/** n 번째 보스 능력치 */
export function bossStats(index: number): ZombieStats {
  const base = ENEMY_TYPES.boss;
  const g = BOSS_CONFIG.growth;
  const n = Math.max(1, index) - 1;
  const hm = Math.min(g.maxHealthMul, 1 + g.health * n);
  const dm = Math.min(g.maxDamageMul, 1 + g.damage * n);
  return {
    ...base,
    id: index > 1 ? `boss-${index}` : 'boss',
    maxHealth: Math.round(base.maxHealth * hm),
    attackDamage: +(base.attackDamage * dm).toFixed(2),
  };
}

/**
 * 보스 처치 보상. 경험치는 처치 시 일반 경험치 결정으로 떨어진다 (stats.xp).
 * items 는 향후 희귀 무기 · 특별 강화 보상을 넣을 자리.
 */
export interface BossReward {
  xp: number;
  heal: number;
  items: { kind: 'weapon' | 'upgrade'; id: string }[];
}

export const BOSS_REWARD: Omit<BossReward, 'xp'> = { heal: 30, items: [] };

/** 보스 처치 후 선택 보상 (기존 보상 — 경험치 300 · 체력 30 — 에 더해 하나 선택) */
export const BOSS_CHOICES = {
  /** 응급 수혈: 체력 회복량 */
  heal: 50,
  /** 전투 경험: 장착 총기 2종 각각 · 근접 무기 숙련도 경험치 */
  gunMastery: 1200,
  meleeMastery: 500,
};

/** 엘리트 처치 추가 보상 (경험치 5배는 그대로). 짧은 시간에 반복해서 받지 않도록 쿨다운 */
export const ELITE_REWARD = {
  heal: 10,
  /** 장착 총기 2종 탄창을 가득 채움 (재장전 중이 아닌 총만) */
  refillAmmo: true,
  cooldown: 15,
};
