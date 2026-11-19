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
    speedLimitFactor: 1.0, // 고속 조향각 제한: 접지 한계 횡가속도의 몇 배까지 요구할지
    speedLimitMargin: 0.02, // 고속 조향각 제한에 더하는 여유각 (rad)
    steerSpeedInitial: 3.0, // 키를 막 눌렀을 때 조향 입력이 차오르는 속도 (1/s) — 짧은 탭 = 미세 조향
    steerSpeed: 5.0, // 계속 누르고 있을 때의 최대 속도 (1/s)
    steerRampTime: 0.3, // 초기 속도 → 최대 속도로 바뀌는 데 걸리는 누름 시간 (s)
    highSpeedSteerRate: 0.55, // 최고속도에서 조향 입력 속도 배율 (고속 과민 반응 방지)
    returnSpeed: 7, // 키를 떼면 조향이 중앙으로 돌아오는 속도 (1/s)
    responseExponent: 1.25, // 입력 → 조향각 응답 곡선 (1 = 직선, 클수록 중앙이 섬세)
    counterSteerGain: 1.0, // 미끄러지는 쪽으로 조향할 때 추가로 허용하는 조향각 (슬립각 배율)
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
    powerOversteer: 0, // 미끄러지는 중 가속 시 뒷바퀴 접지력 감소 비율 (드리프트 모드에서 사용)
  },

  /** 핸드브레이크 / 드리프트 */
  handbrake: {
    rearGripFactor: 0.32, // 드리프트 접지력: 핸드브레이크 시 뒷바퀴 접지력 배율
    deceleration: 4.5, // 핸드브레이크 제동력
    minSpeed: 4, // 이 속도 이하에서는 핸드브레이크가 접지력에 영향 없음
    fullSpeed: 10, // 이 속도 이상에서 최대 효과
    engageRate: 8, // 접지력이 떨어지는 속도 (지수 보간, 1/s → 약 0.12초)
    recoveryRate: 2.5, // 해제 후 접지력 회복 속도 (지수 보간, 1/s → 약 0.4초)
    recoverySlowAtSlip: 0.5, // 크게 미끄러지는 중에는 회복 속도를 이 배율로 늦춤 (튕김 방지)
    yawKick: 4,
    driftHoldGrip: 0.72, // 드리프트 유지 조작(미끄러짐 + 가속 + 조향) 중 뒷바퀴 접지력 목표 (1 = 정상)
    counterGripReturn: 0.35, // 반대 조향을 끝까지 했을 때 유지 접지력에서 정상 쪽으로 되돌리는 비율 (각도 조절 감도) // 핸드브레이크 중 조향 방향 회전 유도 토크 (rad/s², 접지 감소량에 비례)
  },

  /** 안정화 (무한 회전 방지) */
  stability: {
    maxYawRate: 2.3, // rad/s
    yawDamping: 0.6,
    yawAssist: 4, // 조향 의도 추종 강도: 조향각이 요구하는 요레이트로 끌어당기는 정도 (1/s)
    yawIntentGripScale: 0.95, // 의도 요레이트 상한 = 이 배율 × 접지 한계 횡가속 / 속도
    handbrakeAssistScale: 0.15, // 핸드브레이크 중 의도 추종 배율 (차가 돌아갈 여지)
    driftHoldAssistScale: 0.3, // 드리프트 유지 조작(미끄러짐 + 가속 + 조향) 중 보정 배율
    driftAngleHold: 2.5, // 카운터스티어 중 차체 회전을 진행 방향 회전에 맞추는 강도 (1/s) — 드리프트 각도 유지
    maxSlipAngle: 0.85, // 차체 슬립각 목표 상한 (rad, ≈49°)
    slipSoftRange: 0.3, // 상한보다 이만큼 앞에서부터 완만하게 복원 시작 (rad)
    slipRecovery: 25, // 복원 토크 강도 (2차로 증가하므로 경계에서 튀지 않음)
    slipYawDamping: 3, // 슬립을 키우는 방향의 회전에 대한 추가 감쇠
    hardSlipAngle: 1.13, // 절대 넘지 않는 슬립각 (rad, ≈65°)
    recoveryAssist: 2.2, // 큰 미끄러짐을 진행 방향 쪽으로 정렬하는 속도 (1/s, 속력 유지)
    recoverySlipStart: 0.05, // 이 슬립각(rad, ≈3°) 이하에는 정렬 보정을 하지 않음 (일반 코너링은 타이어가 처리)
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
    wallPivotSpeed: 4.5, // 벽에 막혀 정지해도 이 속도로 움직이는 것처럼 조향이 먹게 함 (끼임 방지, m/s)
    wallAlignRate: 1.2, // 조향 없이 벽을 밀 때 차체를 벽면 방향으로 돌리는 속도 (rad/s)
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

/**
 * 차량 외형 (시각 전용 — 물리와 분리). 색상·재질을 바꾸려면 여기만 수정한다.
 * 이후 차량 선택/AI 차량은 이 객체를 복제해 bodyColor 등만 바꿔 쓰면 된다.
 */
export const CAR_APPEARANCE = {
  bodyColor: 0xa8101c, // 메탈릭 레드
  paint: { metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.25 },
  trimColor: 0x111214, // 범퍼 하단·디퓨저·창틀
  glassColor: 0x0b1117,
  rimColor: 0x2a2d32, // 휠 (건메탈)
  caliperColor: 0xe8b21c,
  headlightColor: 0xf3f7ff,
  taillight: { idle: 1.3, brake: 5.5 }, // 후미등 발광 세기 (평상시 / 제동)
  reverseLight: { off: 0, on: 3.2 },
};

/** 렌더링 공통 설정 (품질별 값은 QUALITY_PRESETS) */
export const RENDER_CONFIG = {
  exposure: 0.82,
};

/**
 * 그래픽 품질 옵션. '높음' = 3단계 그래픽 기준.
 * 전환 시 오브젝트를 다시 만들지 않고 해상도·그림자·표시 개수·효과량만 바꾼다.
 */
export const QUALITY_PRESETS = {
  low: {
    label: '낮음',
    maxPixelRatio: 1,
    renderScale: 0.75, // CSS 해상도 대비 렌더 해상도
    shadowMapSize: 1024,
    shadowRange: 40, // 차량 주변 그림자 반경 (m)
    vegetationDistance: 160, // 트랙에서 이 거리 안의 나무·관목만 표시 (m)
    vegetationShadows: false,
    staticShadows: false, // 시설물·타이어벽 그림자
    crowdFraction: 0.35,
    effectsScale: 0.5, // 연기·배기 생성량 배율
    hudBlur: false, // HUD 배경 흐림(합성 비용 큼)
  },
  medium: {
    label: '보통',
    maxPixelRatio: 1.25,
    renderScale: 1,
    shadowMapSize: 2048,
    shadowRange: 55,
    vegetationDistance: 450,
    vegetationShadows: false,
    staticShadows: true,
    crowdFraction: 0.7,
    effectsScale: 0.75,
    hudBlur: true,
  },
  high: {
    label: '높음',
    maxPixelRatio: 1.75,
    renderScale: 1,
    shadowMapSize: 2048,
    shadowRange: 70,
    vegetationDistance: Infinity,
    vegetationShadows: true,
    staticShadows: true,
    crowdFraction: 1,
    effectsScale: 1,
    hudBlur: true,
  },
};
export const DEFAULT_QUALITY = 'high';

/** R 키 차량 복구 */
export const RECOVERY_CONFIG = {
  sampleInterval: 0.25, // 안전 지점 기록 주기 (s)
  maxLateral: 5, // 도로 중심에서 이 거리 안일 때만 안전 (도로 반폭 7m)
  maxSlipAngle: 0.3, // 미끄러지는 중에는 기록하지 않음 (rad)
  minForwardSpeed: 2, // 트랙 진행 방향으로 달리고 있을 때만 (m/s)
  minHeadingAlign: 0.8, // 차체 방향과 트랙 방향의 내적
  wallCooldown: 1.0, // 벽 충돌 후 이 시간 동안은 기록하지 않음 (s)
  backOffSamples: 3, // 기록 지점보다 이만큼(×2m) 뒤로 복구
};

/** 서킷 설정. 컨트롤 포인트(x, z)를 잇는 닫힌 곡선으로 트랙을 만든다. */
export const TRACK_CONFIG = {
  roadWidth: 14,
  runoffWidth: 6, // 도로 가장자리 ~ 가드레일 사이의 잔디 여유 공간
  sampleSpacing: 2, // 트랙 중심선 샘플 간격 (m)
  curbWidth: 1.2,
  curbCurvatureThreshold: 0.009, // 이 곡률(1/반경) 이상인 코너에 연석 배치
  cornerCurvatureThreshold: 0.008, // 코너 번호·표지판 배치 기준 (반경 125m 미만)
  tireWallRadius: 75, // 이 반경 미만 코너의 바깥쪽에는 타이어 방호벽
  finishLineOffset: 10, // 출발 위치에서 결승선까지 샘플 수 (×2m)
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
  baseFov: 64,
  maxFovBoost: 5, // 최고속도에서 늘어나는 시야각 (과도한 원근 왜곡 방지)
  distance: 5.8,
  distanceAtSpeed: 0.4, // 고속에서 추가로 멀어지는 거리 (가속 시 차가 작아지지 않게)
  height: 2.35,
  lookAhead: 5,
  lookHeight: 1.0,
  yawSharpness: 4, // 카메라 방향 보간 강도 (낮을수록 급조향 시 회전 지연이 큼)
  positionSharpness: 12,
  impactSmoothing: 10, // 차량 이동량 보간 강도: 충돌 등 급변만 흡수 (높을수록 즉각)
  lookSharpness: 14,
  fovSharpness: 3,
  velocityFollow: 0.55, // 드리프트 시 차체 방향 대신 실제 진행 방향을 따라가는 비율
  velocityFollowMinSpeed: 3, // 이 속도 미만에서는 진행 방향 무시 (정지·저속 안정화)
  velocityFollowFullSpeed: 12,
  maxYawLag: 1.0, // 카메라 방향이 목표에서 벌어질 수 있는 최대 각도 (rad)
  maxYawSpeed: 2.0, // 카메라 방향 회전 속도 상한 (rad/s) — 스핀·급격한 드리프트에서 급회전 방지
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
  exhaust: {
    maxParticles: 80,
    spawnRate: 16, // 배기구당 초당 최대 생성 수
    lifeMin: 0.35,
    lifeMax: 0.7,
    startSize: 0.14,
    endSize: 0.7,
    maxAlpha: 0.16, // 과장되지 않도록 옅게
    color: 0x9a9ea5,
    fadeSpeedStart: 8, // 이 속도부터 배기 연기 감소 (m/s)
    fadeSpeedEnd: 26,
    idleAmount: 0.12, // 정지 공회전 시 아주 옅은 배기
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
  treeCount: 1100,
  bushCount: 650,
  cloudCount: 14,
  seed: 20261117,
};
