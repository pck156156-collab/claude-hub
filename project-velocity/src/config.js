// ─────────────────────────────────────────────────────────────
// Project Velocity — 게임 설정값
// 주행 특성·트랙·카메라 수치를 한곳에서 조정할 수 있도록 분리했다.
// 단위: 거리 m, 속도 m/s, 가속도 m/s², 각속도 rad/s
// ─────────────────────────────────────────────────────────────

/** 물리 시뮬레이션 고정 시간 간격 (프레임 속도와 무관한 주행 계산용) */
export const SIMULATION = {
  fixedTimeStep: 1 / 120,
  maxFrameDelta: 0.1, // 탭 전환 등으로 프레임이 길어졌을 때 폭주 방지
  maxSubSteps: 10, // 한 프레임에 계산할 최대 물리 스텝 수 (초과분은 버림)
};

/**
 * 기본 스포츠카 주행 설정. 향후 차량별로 복제·수정해 사용할 수 있다.
 * 타이어 힘은 질량으로 나눈 가속도(m/s²) 단위로 다룬다.
 */
export const VEHICLE_CONFIG = {
  /** 차체 치수 (충돌 형태·요 관성 계산에 사용) */
  dimensions: {
    halfWidth: 0.95,
    halfLength: 2.2,
    wheelBase: 2.7,
    cgToFront: 1.38, // 무게중심 → 앞차축
    cgToRear: 1.32, // 무게중심 → 뒷차축
    wheelRadius: 0.36,
    yawInertia: 1.9, // 회전 관성 / 질량 (m²). 클수록 회전 반응이 묵직해짐
  },

  /** 가속 / 최고속도 / 후진 */
  engine: {
    maxSpeed: 62, // ≈ 223 km/h
    acceleration: 13, // 저속 구간 가속력
    accelerationFalloff: 0.6, // 최고속도에 가까워질수록 가속이 줄어드는 비율
    reverseAcceleration: 7,
    maxReverseSpeed: 12, // ≈ 43 km/h
    stopSpeed: 0.4, // 이 속도 미만이면 정지로 간주
    gearChangeDelay: 0.25, // 정지 후 페달을 계속 밟고 있어야 전진↔후진이 바뀌는 시간
  },

  /** 브레이크 성능 */
  brakes: {
    deceleration: 24,
  },

  /** 자연 감속 (관성 주행) */
  drag: {
    rolling: 0.6,
    air: 0.0008, // 감속 = air × v²
    engineBraking: 1.2, // 가속·브레이크 모두 떼었을 때 추가 감속
  },

  /** 조향 */
  steering: {
    maxAngle: 0.6, // 최대 조향각 (rad, ≈34°) — 저속에서 사용
    speedLimitFactor: 1.2, // 고속 조향각 제한: 접지 한계 횡가속도의 몇 배까지 요구할지
    speedLimitMargin: 0.03, // 고속 조향각 제한에 더하는 여유각 (rad)
    steerSpeed: 4.5, // 조향 입력이 차오르는 속도 (1/s)
    returnSpeed: 6, // 키를 떼면 조향이 중앙으로 돌아오는 속도 (1/s)
    reverseAngleFactor: 0.6, // 후진 시 조향각 배율
    visualAngleBoost: 0.1, // 고속에서도 앞바퀴 조향이 보이도록 더하는 시각용 각도
  },

  /** 타이어 접지력 (일반 주행) */
  tires: {
    frontGrip: 10.5, // 앞차축 최대 횡가속도 기여 (m/s²)
    rearGrip: 12, // 뒷차축 — 앞보다 높게 해서 기본적으로 안정적(약한 언더스티어)
    peakSlipAngle: 0.14, // 이 슬립각까지는 접지력이 선형 증가 (rad, ≈8°)
    slidingFriction: 0.78, // 한계를 넘어 미끄러질 때 남는 접지력 비율
    slideFalloff: 3, // 슬립각이 peak 의 몇 배일 때 미끄럼 마찰로 완전히 떨어지는지
    minSlipSpeed: 1, // 슬립각 계산 시 최소 종방향 속도 (저속 수치 안정)
    dynamicBlendStart: 2, // 이 속도 이하: 기구학 조향 (저속 안정)
    dynamicBlendEnd: 6, // 이 속도 이상: 타이어 동역학
    lowSpeedLateralDamping: 12,
  },

  /** 핸드브레이크 / 드리프트 */
  handbrake: {
    rearGripFactor: 0.3, // 드리프트 접지력: 핸드브레이크 시 뒷바퀴 접지력 배율
    deceleration: 4.5, // 핸드브레이크 제동력
    minSpeed: 4, // 이 속도 이하에서는 핸드브레이크가 접지력에 영향 없음
    fullSpeed: 10, // 이 속도 이상에서 최대 효과
    engageRate: 6, // 접지력이 떨어지는 속도 (배율/s)
    recoveryRate: 1.2, // 해제 후 접지력이 회복되는 속도 (배율/s)
  },

  /** 안정화 (무한 회전 방지) */
  stability: {
    maxYawRate: 2.2, // rad/s
    yawDamping: 0.6,
    maxSlipAngle: 0.8, // 차체 슬립각 상한 (rad, ≈46°) — 넘으면 복원 토크
    slipRecovery: 60,
    hardSlipAngle: 1.13, // 절대 넘지 않는 슬립각 (rad, ≈65°)
    recoveryAssist: 1.6, // 핸드브레이크 해제 시 진행 방향을 차체 쪽으로 정렬하는 속도 (1/s, 속력 유지)
  },

  /** 드리프트 판정 (효과·HUD 연동용) */
  drift: {
    slipAngleStart: 0.17, // 뒷바퀴 슬립각 (rad, ≈10°) — 효과 시작 (일반 한계 코너링은 제외)
    slipAngleFull: 0.4, // 효과 최대 (≈23°)
    minSlipSpeed: 2, // 이 횡미끄러짐 속도(m/s) 미만은 무시 (저속 오검출 방지)
  },

  /** 노면 */
  surface: {
    roadEdgeTolerance: 0.6, // 도로 경계에서 이 거리까지는 도로로 판정
    offRoadMaxSpeed: 20, // ≈ 72 km/h
    offRoadDeceleration: 28,
    offRoadDrag: 1.5,
    offRoadGripFactor: 0.75,
  },

  /** 가드레일 충돌 */
  collision: {
    restitution: 0.2, // 튕겨나는 정도
    friction: 0.35, // 벽을 긁을 때의 마찰 (법선 충격량 대비)
    speedLoss: 0.35, // 정면 충돌 시 추가 속도 손실 비율 (비스듬할수록 작아짐)
    angularFactor: 0.6, // 충돌 시 차체 회전 반응 배율
    maxMovePerCheck: 0.5, // 이동 구간 검사 간격 (m) — 고속 관통 방지
  },

  /** 차체 움직임 (시각 효과 전용 — 물리 좌표에 영향 없음) */
  body: {
    pitchStrength: 0.0045, // 가감속 1 m/s² 당 피치 (rad)
    rollStrength: 0.003, // 횡가속 1 m/s² 당 롤 (rad)
    maxPitch: 0.06,
    maxRoll: 0.075,
    stiffness: 70, // 서스펜션 스프링
    damping: 10, // 서스펜션 감쇠
  },
};

/** 서킷 설정. 컨트롤 포인트(x, z)를 잇는 닫힌 곡선으로 트랙을 만든다. */
export const TRACK_CONFIG = {
  roadWidth: 14,
  runoffWidth: 6, // 도로 가장자리 ~ 가드레일 사이의 잔디 여유 공간
  sampleSpacing: 2, // 트랙 중심선 샘플 간격 (m)
  curbWidth: 1.2,
  curbCurvatureThreshold: 0.009, // 이 곡률(1/반경) 이상인 코너에 연석 배치
  controlPoints: [
    [-300, -200],
    [0, -220],
    [250, -200],
    [335, -110],
    [315, 30],
    [230, 90],
    [160, 150],
    [165, 240],
    [225, 290],
    [250, 345],
    [220, 395],
    [140, 410],
    [-100, 345],
    [-205, 230],
    [-190, 130],
    [-245, 55],
    [-325, 0],
    [-360, -120],
  ],
};

/** 3인칭 추적 카메라 설정 */
export const CAMERA_CONFIG = {
  baseFov: 62,
  maxFovBoost: 14, // 최고속도에서 늘어나는 시야각
  distance: 7.4,
  distanceAtSpeed: 1.2, // 고속에서 추가로 멀어지는 거리
  height: 2.9,
  lookAhead: 4.5,
  lookHeight: 1.3,
  yawSharpness: 4, // 카메라 방향 보간 강도 (낮을수록 급조향 시 회전 지연이 큼)
  positionSharpness: 12,
  lookSharpness: 14,
  fovSharpness: 3,
  velocityFollow: 0.55, // 드리프트 시 차체 방향 대신 실제 진행 방향을 따라가는 비율
  velocityFollowMinSpeed: 3, // 이 속도 미만에서는 진행 방향 무시 (정지·저속 안정화)
  velocityFollowFullSpeed: 12,
  maxYawLag: 1.0, // 카메라 방향이 목표에서 벌어질 수 있는 최대 각도 (rad)
};

/** 드리프트 시각 효과 (개수 상한으로 성능 보호) */
export const EFFECTS_CONFIG = {
  smoke: {
    maxParticles: 260,
    spawnRate: 42, // 바퀴당 초당 최대 생성 수
    lifeMin: 1.0,
    lifeMax: 1.8,
    startSize: 0.9,
    endSize: 4.2,
    maxAlpha: 0.42,
    color: 0xe9e9e9,
    offRoadFactor: 0.5, // 잔디 위에서의 연기 양 배율
  },
  skidMarks: {
    maxSegments: 1600,
    width: 0.26,
    minSegmentLength: 0.3,
    threshold: 0.25, // driftIntensity 가 이 값 이상일 때 자국 생성
    maxAlpha: 0.6,
  },
};

/** 조명·환경 설정 */
export const ENVIRONMENT_CONFIG = {
  sunElevation: 38,
  sunAzimuth: 145,
  groundSize: 2600,
  treeCount: 900,
  seed: 20261117,
};
