import { WAVE_CONFIG, WaveParams, waveParams } from '../config/GameConfig';

/**
 * 생존 시간과 웨이브 진행.
 * - 시간은 게임 로직 스텝(고정 간격)에서만 증가 → 일시정지 · 창 비활성 · 게임 오버 중에는 멈추고,
 *   프레임 속도와 무관하게 정확하다.
 * - 60초마다 자동으로 다음 웨이브. 남아 있는 좀비는 그대로 두고 난이도만 바뀐다.
 */
export class WaveSystem {
  /** 생존 시간 (초) */
  time = 0;
  wave = 1;
  params: WaveParams = waveParams(1);

  /** 웨이브가 바뀌는 순간 (시작 시 웨이브 1 포함) */
  onWaveStart: ((params: WaveParams) => void) | null = null;

  reset(): void {
    this.time = 0;
    this.wave = 1;
    this.params = waveParams(1);
    this.onWaveStart?.(this.params);
  }

  step(dt: number): void {
    this.time += dt;
    const w = Math.floor(this.time / WAVE_CONFIG.duration) + 1;
    if (w !== this.wave) {
      this.wave = w;
      this.params = waveParams(w);
      this.onWaveStart?.(this.params);
    }
  }

  /** 현재 웨이브가 끝나기까지 남은 시간 */
  get remaining(): number {
    return WAVE_CONFIG.duration - (this.time % WAVE_CONFIG.duration);
  }
}

/** 초 → "mm:ss" */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
