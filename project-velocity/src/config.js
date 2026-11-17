// ─────────────────────────────────────────────────────────────
// Project Velocity — 게임 설정값
// 주행 특성·트랙·카메라 수치를 한곳에서 조정할 수 있도록 분리했다.
// 단위: 거리 m, 속도 m/s, 가속도 m/s², 각속도 rad/s
// ─────────────────────────────────────────────────────────────

/** 물리 시뮬레이션 고정 시간 간격 (프레임 속도와 무관한 주행 계산용) */
export const SIMULATION = {
  fixedTimeStep: 1 / 120,
  maxFrameDelta: 0.1, // 탭 전환 등으로 프레임이 길어졌을 때 폭주 방지
};

/** 기본 스포츠카 주행 설정. 향후 차량별로 복제·수정해 사용할 수 있다. */
export const VEHICLE_CONFIG = {
  // 가속 / 최고속도
  maxSpeed: 62, // ≈ 223 km/h
  acceleration: 13, // 저속 구간 가속력
  accelerationFalloff: 0.6, // 최고속도에 가까워질수록 가속이 줄어드는 비율
  // 제동 / 후진
  brakeDeceleration: 30,
  reverseAcceleration: 7,
  maxReverseSpeed: 12, // ≈ 43 km/h
  // 자연 감속 (관성 주행)
  rollingResistance: 0.6,
  airDrag: 0.0008, // 감속 = airDrag × v²
  engineBraking: 1.2, // 가속·브레이크 모두 떼었을 때 추가 감속
  // 조향
  maxYawRate: 1.8, // 최대 선회 각속도
  steerFullSpeed: 7, // 이 속도 미만에서는 속도에 비례해 선회량 감소 (제자리 회전 방지)
  highSpeedSteerFactor: 0.45, // 최고속도에서의 선회량 배율
  steerRate: 5, // 조향 입력이 차오르는 속도 (1/s)
  steerReturnRate: 8, // 조향이 중앙으로 돌아오는 속도 (1/s)
  maxVisualSteerAngle: 0.5, // 앞바퀴가 꺾여 보이는 최대 각도
  // 접지력
  lateralGrip: 9, // 측면 미끄러짐 감쇠율 (높을수록 레일 위를 달리듯)
  velocityAlign: 0.85, // 선회 시 속도 벡터가 차체 방향을 따라가는 비율
  // 핸드브레이크
  handbrakeGrip: 1.6,
  handbrakeVelocityAlign: 0.25,
  handbrakeDeceleration: 5,
  handbrakeSteerBoost: 1.3,
  // 노면
  roadEdgeTolerance: 0.6, // 도로 경계에서 이 거리까지는 도로로 판정
  offRoadMaxSpeed: 20, // ≈ 72 km/h
  offRoadDeceleration: 28,
  offRoadDrag: 1.5,
  offRoadGripFactor: 0.75,
  // 가드레일 충돌
  wallRestitution: 0.25,
  wallImpactLoss: 0.5,
  wallFriction: 0.8,
  // 차체 치수 / 시각 효과
  halfWidth: 1.0,
  wheelRadius: 0.36,
  visualPitchFactor: 0.004,
  visualRollFactor: 0.0012,
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
  yawSharpness: 4.5, // 카메라 방향 보간 강도
  positionSharpness: 12,
  lookSharpness: 14,
  fovSharpness: 3,
};

/** 조명·환경 설정 */
export const ENVIRONMENT_CONFIG = {
  sunElevation: 38,
  sunAzimuth: 145,
  groundSize: 2600,
  treeCount: 900,
  seed: 20261117,
};
