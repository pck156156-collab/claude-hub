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

export const WEAPON_CONFIG = {
  rifle: {
    id: 'rifle',
    name: 'M-17 자동소총',
    magazineSize: 30,
    /** 초당 발사 수 */
    fireRate: 8,
    reloadTime: 1.8,
    projectileSpeed: 60,
    range: 45,
    damage: 20,
    /** 탄 퍼짐 (도). 0 이면 완전히 조준선 그대로 */
    spreadDeg: 0.8,
    /** 빈 탄창에서 방아쇠를 다시 당기면 자동 재장전 */
    autoReloadOnEmpty: true,
    /**
     * 총구 위치 (캐릭터 로컬, 조준 자세 기준). three.js 규약상 정면 +z 일 때 캐릭터의 오른쪽은 -x.
     * 소총을 오른쪽 어깨에 견착하므로 x 는 음수. 캐릭터 모델(PlayerModel)의 총 위치와 일치해야 한다.
     */
    muzzleOffset: { x: -0.12, y: 1.32, z: 1.05 },
  },
};

export const PROJECTILE_CONFIG = {
  /** 동시에 존재할 수 있는 최대 투사체 수 (풀 크기) */
  poolSize: 64,
  tracerLength: 2.2,
  tracerWidth: 0.08,
};

export const TARGET_CONFIG = {
  maxHealth: 100,
  radius: 0.45,
  height: 2.0,
  respawnDelay: 3,
  /** 연습 표적 위치 (x, z) */
  positions: [
    [6, -12], [-8, -16], [14, -4], [-12, 7.5], [10, 14], [-4, 18], [22, 16], [-20, -12.5],
  ] as [number, number][],
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
  aimLookAhead: 1.0,
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

export const AUDIO_CONFIG = {
  masterVolume: 0.35,
};

export const RENDER_CONFIG = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  /** 그림자 카메라가 덮는 반경 (플레이어 중심) */
  shadowRadius: 32,
  exposure: 1.15,
};
