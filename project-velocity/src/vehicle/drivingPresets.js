import { VEHICLE_CONFIG } from '../config.js';

/**
 * 주행 모드 프리셋. 별도 물리 엔진 없이 같은 Vehicle 물리에 들어가는 설정값만 덮어쓴다.
 * 아케이드 = VEHICLE_CONFIG 그대로 (기본값).
 */
export const DRIVING_PRESETS = {
  arcade: {
    label: '아케이드',
    description: '빠른 조향 반응과 높은 안정성. 키보드로 다루기 쉽고 드리프트도 쉽게 걸립니다.',
    overrides: {},
  },
  sport: {
    label: '스포츠',
    description: '자세 보정이 줄고 속도에 따른 조향 한계가 뚜렷합니다. 코너 앞에서 속도를 줄여야 합니다.',
    overrides: {
      dimensions: { yawInertia: 2.15 }, // 회전 관성↑ → 묵직한 차체
      drag: { engineBraking: 0.8 }, // 관성 주행이 더 길게
      steering: { speedLimitFactor: 0.85, speedLimitMargin: 0.012, steerSpeed: 4.4, highSpeedSteerRate: 0.45 },
      tires: { frontGrip: 10.2, rearGrip: 11.3, slidingFriction: 0.74 },
      handbrake: { rearGripFactor: 0.4, recoveryRate: 2.2, yawKick: 2.2, driftHoldGrip: 1 },
      stability: { yawAssist: 2, driftHoldAssistScale: 0.5, driftAngleHold: 1.2, recoveryAssist: 1.1, slipRecovery: 20 },
    },
  },
  drift: {
    label: '드리프트',
    description: '뒷바퀴 접지력이 낮아 드리프트 진입이 쉽고, 가속과 카운터스티어로 오래 유지할 수 있습니다.',
    overrides: {
      steering: { counterSteerGain: 1.05, steerSpeed: 5.4 },
      tires: { rearGrip: 10.6, slidingFriction: 0.86, powerOversteer: 0.2 },
      handbrake: { rearGripFactor: 0.24, engageRate: 10, recoveryRate: 2.0, minSpeed: 3, yawKick: 5, driftHoldGrip: 0.7, counterGripReturn: 0.7 },
      stability: {
        maxYawRate: 2.5, yawAssist: 2.6, handbrakeAssistScale: 0.1, driftHoldAssistScale: 0.12, driftAngleHold: 2.2,
        maxSlipAngle: 1.0, hardSlipAngle: 1.22, recoveryAssist: 1.8, slipRecovery: 22,
      },
    },
  },
};

export const DEFAULT_DRIVING_MODE = 'arcade';

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v;
  }
  return out;
}

const cache = new Map();

/** 프리셋이 적용된 차량 설정 (같은 이름이면 같은 객체를 돌려준다) */
export function buildVehicleConfig(mode) {
  const key = DRIVING_PRESETS[mode] ? mode : DEFAULT_DRIVING_MODE;
  if (!cache.has(key)) cache.set(key, Object.freeze(merge(VEHICLE_CONFIG, DRIVING_PRESETS[key].overrides)));
  return cache.get(key);
}
