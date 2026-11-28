/**
 * 모든 밸런스 · 조작 · 연출 수치를 한곳에 모은다.
 * 테스트 후 값을 바꿀 때는 이 파일만 수정하면 된다.
 */

export const SIMULATION = {
  /** 게임 로직 고정 시간 간격 (초). 렌더는 이 사이를 보간한다. */
  fixedTimeStep: 1 / 120,
  /** 프레임이 크게 늦어져도 한 번에 처리할 최대 시간 (탭 복귀 시 순간이동 방지) */
  maxFrameDelta: 0.1,
};

export const WORLD_CONFIG = {
  /** 플레이 가능한 맵 크기 (가로·세로). 원점 중심. */
  size: 100,
  /** 외곽 벽 두께 */
  boundaryThickness: 1.2,
  boundaryHeight: 2.6,
  roadWidth: 12,
  sidewalkWidth: 3,
  /** 난수 시드: 같은 시드면 항상 같은 맵 */
  seed: 1337,
};

export const PLAYER_CONFIG = {
  radius: 0.42,
  /** 최대 이동 속도 (단위/초) */
  moveSpeed: 6.2,
  /** 가속 (단위/초²): 0 → 최고속도까지 약 0.1초 */
  acceleration: 60,
  /** 감속 (단위/초²): 최고속도 → 정지까지 약 0.08초 */
  deceleration: 80,
  /** 이 속도 미만이고 입력이 없으면 즉시 정지 */
  stopEpsilon: 0.05,
  maxHealth: 100,
  /** 피격 후 무적 시간 (초): 여러 좀비가 동시에 때려도 이 시간 동안은 한 번만 피해 */
  invulnerableTime: 0.4,
  /**
   * 캐릭터 회전이 조준점을 따라가는 속도. 0 = 즉시 (커서와 발사 방향이 항상 정확히 일치).
   * 값을 주면 부드럽게 돌지만 빠르게 마우스를 휘두를 때 그만큼 조준이 늦어진다.
   */
  aimTurnSharpness: 0,
  /** 조준점이 캐릭터에서 이 거리보다 가까우면 방향을 바꾸지 않는다 */
  minAimDistance: 0.9,
  /** 이동 반대 방향 조준 시 이동 속도 배율 (1 = 감속 없음) */
  backpedalSpeedFactor: 1,
};

/**
 * 모든 무기 공통 설정. 무기별 능력치는 weapons/WeaponData.ts 에 있다.
 */
export const WEAPON_CONFIG = {
  /**
   * 총구 위치 (캐릭터 로컬, 조준 자세 기준). three.js 규약상 정면 +z 일 때 캐릭터의 오른쪽은 -x.
   * 총을 오른쪽 어깨에 견착하므로 x 는 음수. 모든 총기 모델은 총구가 이 위치에 오도록 만든다.
   */
  muzzleOffset: { x: -0.12, y: 1.32, z: 1.05 },
  /** 탄창을 다 쓰면 자동으로 재장전 (false 면 R 키로만) */
  autoReloadOnEmpty: true,
  /** 총기 교체 시간 (초) */
  switchTime: 0.35,
  /** 반자동 총기: 발사 간격이 이만큼 남았을 때 누른 클릭은 기억했다가 쏜다 (초) */
  semiAutoBuffer: 0.12,
};

export const PROJECTILE_CONFIG = {
  /** 동시에 존재할 수 있는 최대 투사체 수 (풀 크기) */
  poolSize: 128,
  tracerLength: 2.2,
  tracerWidth: 0.08,
};

/**
 * 좀비 종류별 능력치. 새 종류(빠른 · 탱커 · 원거리 좀비)는 같은 형태로 항목만 추가하면 된다.
 * 외형 차이는 appearance (색상 · 크기 · 자세) 로 표현한다.
 */
/** 적 종류 (6단계: 특수 좀비 · 보스) */
export type EnemyKind = 'walker' | 'runner' | 'tank' | 'spitter' | 'exploder' | 'boss';
/** 공격 방식: 근접 / 원거리 투사체 / 자폭 / 보스 패턴 */
export type AttackType = 'melee' | 'ranged' | 'explode' | 'boss';
/** 걸음걸이 (애니메이션) */
export type Gait = 'shamble' | 'run' | 'stomp' | 'waddle' | 'lurch' | 'boss';

/** 체형: 부위별 굵기 배율 (절차적 메시 하나를 종류마다 다르게 늘림) */
export interface BuildDef {
  /** 몸통 [폭, 높이, 두께] */
  torso: [number, number, number];
  /** 팔다리 굵기 */
  limb: number;
  /** 다리 굵기 (없으면 limb) */
  leg?: number;
  head: number;
  /** 어깨 폭 배율 */
  shoulder: number;
  /** 배 · 혹 크기 (0 = 없음) */
  belly: number;
  /** 배 위치 z (+ 앞 / - 등) */
  bellyZ: number;
}

/** 러너: 짧은 가속 */
export interface DashParams { minDist: number; maxDist: number; prepTime: number; time: number; speedMul: number; turnRate: number; cooldown: number }
/** 스피터: 원거리 독성 투사체 */
export interface RangedParams {
  range: number; preferMin: number; preferMax: number; retreatDist: number;
  windup: number; recover: number; projectileSpeed: number; projectileRadius: number; repositionTime: number;
}
/** 폭발 좀비 */
export interface ExplodeParams { trigger: number; radius: number; primeTime: number; damage: number; primeSpeedMul: number }
/** 보스 패턴 */
export interface BossParams {
  meleeRange: number; meleeArcDeg: number; meleeWindup: number; meleeRecover: number; meleeInterval: number;
  chargeMinDist: number; chargeMaxDist: number; chargeDistance: number; chargeSpeed: number; chargeWindup: number;
  chargeLock: number; chargeTurnRate: number; chargeCooldown: number; chargeDamageMul: number; chargeRecover: number; chargeWallRecover: number;
  slamRadius: number; slamTrigger: number; slamWindup: number; slamCooldown: number; slamDamageMul: number; slamRecover: number;
  /** 패턴 사이 최소 간격 */
  patternGap: number;
  phase2: { threshold: number; cooldownMul: number; windupMul: number; speedMul: number; chargeCooldown: number; slamRadiusMul: number; roarTime: number };
}

export interface ZombieStats {
  id: string;
  name: string;
  kind: EnemyKind;
  attackType: AttackType;
  /** 엘리트 변형 여부 */
  elite: boolean;
  /** 상태 이상(경직) 저항 0~1. 경직 시간이 (1-값) 배, 1 이면 경직 없음 */
  statusResistance: number;
  /** 좀비끼리 밀어낼 때의 무게 (클수록 덜 밀림) */
  mass: number;
  /** 이동 방향 회전 속도 (rad/s). 0 = 즉시 방향 전환(워커), 값이 있으면 곡선으로 방향을 바꿈 */
  steerRate: number;
  /** 근접 공격 예비 동작 중 바닥에 공격 범위 표시 */
  telegraph: boolean;
  /** 특수 능력 설명 (UI · 디버그) */
  abilities: string[];
  dash?: DashParams;
  ranged?: RangedParams;
  explode?: ExplodeParams;
  boss?: BossParams;
  maxHealth: number;
  /** 이동 속도 (단위/초) */
  moveSpeed: number;
  /** 공격 1회 피해 */
  attackDamage: number;
  /** 공격 사거리: 좀비 중심 ~ 플레이어 중심 거리 */
  attackRange: number;
  /** 공격 시작 간격 (초) */
  attackInterval: number;
  /** 공격 시작 → 실제 피해 판정까지 (예비 동작) */
  attackWindup: number;
  /** 공격 전체 동작 시간 (판정 후 회복 포함) */
  attackDuration: number;
  /** 판정 순간 플레이어가 좀비 정면 기준 이 각도(도) 안에 있어야 피해 */
  attackArcDeg: number;
  radius: number;
  /** 피격 경직 시간 */
  hitStunTime: number;
  /** 넉백 속도 (단위/초, 빠르게 감쇠). 무기에 넉백 값이 없을 때 쓰는 기본값 */
  knockback: number;
  /** 넉백 저항 0~1 (향후 엘리트 · 보스용. 1 = 밀리지 않음, 강한 넉백 경직도 무시) */
  knockbackResistance: number;
  /** 회전 속도 (rad/s) */
  turnSpeed: number;
  /** 땅에서 기어 나오는 시간 */
  spawnTime: number;
  /** 사망 후 시체가 남는 시간 → 이후 가라앉아 제거 */
  corpseTime: number;
  /** 처치 시 떨어뜨리는 경험치 */
  xp: number;
  appearance: {
    scale: number; hunch: number; skin: number[]; shirts: number[]; pants: number[];
    build?: BuildDef; gait?: Gait;
    /** 발광 부위 색 (독 주머니 · 고름 · 균열) */
    glow?: number;
    /** 눈 색 */
    eye?: number;
  };
}

export const ZOMBIE_TYPES: Record<string, ZombieStats> = {
  walker: {
    id: 'walker',
    name: '워커',
    kind: 'walker',
    attackType: 'melee',
    elite: false,
    statusResistance: 0,
    mass: 1,
    steerRate: 0,
    telegraph: false,
    abilities: [],
    maxHealth: 100,
    moveSpeed: 2.2,
    attackDamage: 10,
    attackRange: 1.5,
    attackInterval: 1.2,
    attackWindup: 0.45,
    attackDuration: 0.85,
    attackArcDeg: 75,
    radius: 0.4,
    hitStunTime: 0.18,
    knockback: 2.6,
    knockbackResistance: 0,
    turnSpeed: 5,
    spawnTime: 1.0,
    corpseTime: 3.5,
    xp: 10,
    appearance: {
      scale: 1,
      hunch: 0.38,
      skin: [0x7f8c6b, 0x8a8f73, 0x76836a, 0x8d8a72],
      shirts: [0x2f3431, 0x3b2f2a, 0x2a3039, 0x3a3a34, 0x452826],
      pants: [0x22252a, 0x2b2923, 0x1f2a2e],
    },
  },
};

/** 테스트용 좀비 생성 (일정 간격). 난이도 증가 · 웨이브는 3단계 */
/**
 * 좀비 생성 공통 설정. 생성 간격 · 동시 상한 · 능력치 배율은 웨이브(WAVE_CONFIG)가 정한다.
 */
export const SPAWN_CONFIG = {
  firstDelay: 3,
  /** 웨이브 시스템이 없을 때의 기본값 (웨이브 1 과 같게) */
  interval: 2,
  maxAlive: 15,
  /** 플레이어로부터 생성 거리 범위 */
  minDistance: 18,
  maxDistance: 34,
  /** 남아 있을 수 있는 시체 최대 수 (넘으면 오래된 것부터 정리) */
  maxCorpses: 10,
  /** 카메라 화면 밖으로 인정하는 정규화 좌표 여유 */
  offscreenMargin: 1.08,
};

/** 웨이브 1회분 난이도 */
export interface WaveParams {
  wave: number;
  /** 생성 간격 (초) */
  spawnInterval: number;
  /** 동시에 살아 있을 수 있는 좀비 수 */
  maxAlive: number;
  /** 좀비 체력 배율 */
  healthMultiplier: number;
  /** 좀비 이동 속도 배율 */
  speedMultiplier: number;
}

/**
 * 웨이브: 60초마다 자동 전환. 1~5 웨이브는 표의 값, 6웨이브부터는 완만한 계산식 + 상한.
 * 4단계(성장 시스템)가 들어오면 다시 조정할 예정.
 */
export const WAVE_CONFIG = {
  duration: 60,
  table: [
    { spawnInterval: 2.0, maxAlive: 15, healthMultiplier: 1.0, speedMultiplier: 1.0 },
    { spawnInterval: 1.7, maxAlive: 20, healthMultiplier: 1.15, speedMultiplier: 1.0 },
    { spawnInterval: 1.4, maxAlive: 25, healthMultiplier: 1.3, speedMultiplier: 1.03 },
    { spawnInterval: 1.1, maxAlive: 30, healthMultiplier: 1.45, speedMultiplier: 1.06 },
    { spawnInterval: 0.9, maxAlive: 35, healthMultiplier: 1.6, speedMultiplier: 1.1 },
  ],
  /** 6웨이브 이후: 웨이브마다 생성 간격 ×0.95, 상한 +2, 체력 +0.08, 속도 +0.02 */
  after: { intervalFactor: 0.95, maxAliveStep: 2, healthStep: 0.08, speedStep: 0.02 },
  /** 상한 (플레이 불가능해지지 않도록) */
  limits: { minInterval: 0.55, maxAlive: 50, maxHealthMultiplier: 2.6, maxSpeedMultiplier: 1.25 },
  /** 웨이브 알림 표시 시간 (초) */
  bannerTime: 2.6,
};

/** 웨이브 번호(1부터) → 난이도 */
export function waveParams(wave: number): WaveParams {
  const w = Math.max(1, Math.floor(wave));
  const t = WAVE_CONFIG.table;
  if (w <= t.length) return { wave: w, ...t[w - 1] };
  const last = t[t.length - 1];
  const n = w - t.length;
  const a = WAVE_CONFIG.after;
  const l = WAVE_CONFIG.limits;
  return {
    wave: w,
    spawnInterval: Math.max(l.minInterval, +(last.spawnInterval * Math.pow(a.intervalFactor, n)).toFixed(3)),
    maxAlive: Math.min(l.maxAlive, last.maxAlive + a.maxAliveStep * n),
    healthMultiplier: Math.min(l.maxHealthMultiplier, +(last.healthMultiplier + a.healthStep * n).toFixed(2)),
    speedMultiplier: Math.min(l.maxSpeedMultiplier, +(last.speedMultiplier + a.speedStep * n).toFixed(2)),
  };
}

/** 경험치 · 레벨 · 강화 */
export const PROGRESSION_CONFIG = {
  /** 레벨 n → n+1 필요 경험치 (레벨 1~5) */
  xpTable: [30, 45, 65, 90, 120],
  /** 레벨 6 이후: 120 + 40·k + 4·k² (k = 레벨 - 5) → 164, 216, 276, 344, 420 ... */
  xpLinear: 40,
  xpQuadratic: 4,
  /** 기본 경험치 획득 범위 (플레이어 중심 반경) */
  pickupRadius: 2.5,
  /** 결정이 끌려오는 최고 속도 (단위/초) */
  absorbSpeed: 12,
  /** 끌려올 때 가속 (단위/초²) */
  absorbAcceleration: 40,
  /** 이 거리 안에 들어오면 획득 */
  collectDistance: 0.55,
  /** 동시에 존재할 수 있는 결정 수. 넘으면 가까운 결정과 병합 (경험치 손실 없음) */
  maxOrbs: 160,
  /**
   * 결정이 이 개수 이상 쌓였을 때만 근처 결정과 병합 (성능용).
   * 그 전에는 처치할 때마다 항상 새 결정이 보인다.
   */
  mergeStartCount: 120,
  /** 새 결정이 이 거리 안의 결정과 합쳐짐 */
  mergeRadius: 1.2,
  /** 치명타 피해 배율 */
  critMultiplier: 2,
  /** 레벨업 카드 수 */
  choices: 3,
};

/** 레벨 → 다음 레벨까지 필요 경험치 (밸런스 조정용으로 분리) */
export function xpToNextLevel(level: number): number {
  const t = PROGRESSION_CONFIG.xpTable;
  if (level <= t.length) return t[Math.max(0, level - 1)];
  const k = level - t.length;
  return Math.round(t[t.length - 1] + PROGRESSION_CONFIG.xpLinear * k + PROGRESSION_CONFIG.xpQuadratic * k * k);
}

/** 경로 탐색 (격자 + 흐름장) */
export const NAV_CONFIG = {
  /** 격자 칸 크기 */
  cellSize: 1,
  /** 칸이 막혔다고 볼 장애물 여유 반경 (좀비 반경 + 여유) */
  clearance: 0.5,
  /** 흐름장 재계산 주기 (초). 플레이어가 다른 칸으로 옮기면 이 주기로 갱신 */
  refreshInterval: 0.25,
  /** 직선 시야 검사 주기 (초, 좀비마다 엇갈려서) */
  lineOfSightInterval: 0.2,
  /** 거의 움직이지 못한 채 이 시간이 지나면 옆으로 비켜 감 */
  stuckTime: 0.7,
};

export const CAMERA_CONFIG = {
  fov: 42,
  /** 지면 기준 내려다보는 각도 (도) */
  pitchDeg: 50,
  /** 월드 기준 고정 방위각 (도). 45 = 대각선 쿼터뷰 */
  yawDeg: 45,
  distance: 17.5,
  /** 캐릭터 추적 부드러움 (클수록 즉각적) */
  followSharpness: 9,
  /** 조준 방향으로 화면을 살짝 미는 거리 (0 이면 항상 정중앙) */
  aimLookAhead: 0,
  lookAheadSharpness: 4,
  /** 캐릭터를 가리는 건물을 반투명하게 할 때의 불투명도 */
  occluderOpacity: 0.3,
  occluderFadeSpeed: 8,
};

export const EFFECTS_CONFIG = {
  sparkPoolSize: 360,
  debrisPoolSize: 260,
  casingPoolSize: 40,
  muzzleFlashTime: 0.05,
  /** 총기 반동 시각 효과 (단위) */
  recoilKick: 0.09,
  recoilRecovery: 18,
};

/**
 * 그래픽 품질 단계. 시작 화면 · 일시정지 화면에서 바꿀 수 있고 브라우저에 기억된다.
 * - shadowMapSize: 0 이면 그림자 끔
 * - streetLights: 가로등 점광원 수 (광원 하나마다 화면 전체 계산량 증가)
 * - maxPixelRatio: 렌더 배율 상한 (픽셀 수 = 배율²)
 */
export const QUALITY_PRESETS = {
  // particles: 시각 파티클 양 배율 · decor: 판정 없는 장식(잔해 · 얼룩 · 먼 실루엣) 표시 거리(0 = 숨김)
  // post: 화면 후처리(비네트 · 색 보정) · fireLights: 불타는 드럼통 조명 수 · damageNumbers: 동시 데미지 숫자 수
  high: { label: '높음', shadowMapSize: 2048, streetLights: 3, maxPixelRatio: 1.5, particles: 1, decor: 80, post: true, fireLights: 3, damageNumbers: 36 },
  medium: { label: '보통', shadowMapSize: 1024, streetLights: 1, maxPixelRatio: 1.0, particles: 0.75, decor: 45, post: true, fireLights: 2, damageNumbers: 28 },
  low: { label: '낮음', shadowMapSize: 0, streetLights: 0, maxPixelRatio: 0.85, particles: 0.45, decor: 0, post: false, fireLights: 0, damageNumbers: 18 },
} as const;
export type QualityLevel = keyof typeof QUALITY_PRESETS;
export const DEFAULT_QUALITY: QualityLevel = 'medium';

export const AUDIO_CONFIG = {
  masterVolume: 0.35,
  /** 배경음 · 환경음 기본 크기 (효과음보다 작게) */
  musicVolume: 0.55,
  /** 동시에 재생할 수 있는 효과음 수 (넘으면 중요하지 않은 소리는 생략) */
  maxVoices: 24,
};

export const RENDER_CONFIG = {
  /** 고해상도 화면에서도 이 배율까지만 렌더 (픽셀 수가 배율² 로 늘어남) */
  maxPixelRatio: 1.5,
  /**
   * 동적 해상도: 평균 FPS 가 lowFps 아래로 떨어지면 렌더 배율을 단계적으로 낮추고,
   * highFps 이상이 오래 유지되면 다시 올린다. 조작 반응성(프레임)을 화질보다 우선한다.
   */
  dynamicResolution: { enabled: true, lowFps: 50, highFps: 58, minPixelRatio: 0.75, step: 0.25 },
  /** 가로등 점광원 수 (광원 하나마다 모든 표면의 계산 비용이 늘어난다) */
  streetLightCount: 3,
  shadowMapSize: 2048,
  /** 그림자 카메라가 덮는 반경 (플레이어 중심) */
  shadowRadius: 32,
  exposure: 1.15,
};
