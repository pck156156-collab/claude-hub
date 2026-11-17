import { QUALITY_PRESETS, DEFAULT_QUALITY } from '../config.js';

const STORAGE_KEY = 'project-velocity.quality';

/**
 * 그래픽 품질 적용. 오브젝트를 다시 만들지 않고 이미 있는 것의 설정만 바꾼다.
 *  - 렌더 해상도: renderer.setPixelRatio
 *  - 그림자: 해상도·범위 / 식생·시설물 그림자 on/off (castShadow 는 재컴파일 없이 바뀜)
 *  - 환경 표시 거리: 거리순 정렬된 InstancedMesh 의 count
 *  - 관중 표시 비율, 연기·배기 생성량, HUD 배경 흐림
 */
export class QualityManager {
  constructor(game) {
    this.game = game;
    this.level = loadLevel();
    this.listeners = [];
  }

  get preset() {
    return QUALITY_PRESETS[this.level];
  }

  set(level) {
    if (!QUALITY_PRESETS[level]) return;
    this.level = level;
    try {
      localStorage.setItem(STORAGE_KEY, level);
    } catch {
      /* 저장소를 쓸 수 없는 환경이면 이번 세션에만 적용 */
    }
    this.apply();
    for (const fn of this.listeners) fn(level);
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  apply() {
    const q = this.preset;
    const g = this.game;
    g.renderer.setPixelRatio(this.pixelRatio());
    g.renderer.setSize(window.innerWidth, window.innerHeight);

    g.environment.setShadowQuality(q.shadowMapSize, q.shadowRange);
    g.environment.setVegetationDistance(q.vegetationDistance);
    g.environment.setVegetationShadows(q.vegetationShadows);

    for (const name of ['Facilities', 'TireWalls', 'ConcreteWalls', 'TrackSigns']) {
      const obj = g.scene.getObjectByName(name);
      obj?.traverse((o) => {
        if (!o.isMesh) return;
        if (o.userData.defaultCastShadow === undefined) o.userData.defaultCastShadow = o.castShadow;
        o.castShadow = q.staticShadows && o.userData.defaultCastShadow;
      });
    }
    for (const m of g.facilities.crowdMeshes) {
      if (m.userData.fullCount === undefined) m.userData.fullCount = m.count;
      m.count = Math.round(m.userData.fullCount * q.crowdFraction);
    }
    g.effects.spawnScale = q.effectsScale;
    g.exhaust.spawnScale = q.effectsScale;
    document.body.classList.toggle('no-blur', !q.hudBlur);
    document.body.dataset.quality = this.level;
    g.requestRender?.();
  }

  pixelRatio() {
    const q = this.preset;
    return Math.min(window.devicePixelRatio || 1, q.maxPixelRatio) * q.renderScale;
  }
}

function loadLevel() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && QUALITY_PRESETS[v]) return v;
  } catch {
    /* 무시 */
  }
  return DEFAULT_QUALITY;
}
