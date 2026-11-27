import { AUDIO_CONFIG } from '../config/GameConfig';

/**
 * Web Audio 로 즉석 합성하는 효과음 (외부 음원 없음).
 * 브라우저 정책상 첫 클릭 이후에만 소리를 낼 수 있으므로 unlock() 을 사용자 입력에서 호출한다.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = AUDIO_CONFIG.masterVolume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /**
   * 총성. pitch: 높을수록 가볍고 짧은 소리 (권총 · SMG), body: 저음 충격 크기 (샷건 · LMG)
   */
  gunshot(pitch = 1, body = 0.7): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const len = 0.12 / Math.sqrt(pitch);
    // 날카로운 소음 + 저음 충격
    this.noiseBurst(t, len, 2400 * pitch, 0.9, 'lowpass', 0.6);
    this.noiseBurst(t, 0.04, 6000 * pitch, 0.35, 'highpass', 0.2);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(45 * pitch, t + len * 0.85);
    g.gain.setValueAtTime(body, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.14);
  }

  click(pitch = 1): void {
    const c = this.ready();
    if (!c) return;
    this.noiseBurst(c.currentTime, 0.03, 3000 * pitch, 0.5, 'bandpass', 3);
  }

  reload(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t + 0.05, 0.04, 1800, 0.4, 'bandpass', 2); // 탄창 분리
    this.noiseBurst(t + 1.25, 0.05, 1500, 0.55, 'bandpass', 2); // 삽입
    this.noiseBurst(t + 1.55, 0.04, 2600, 0.5, 'bandpass', 3); // 장전 손잡이
  }

  /** 근접 휘두르는 바람 소리 (무거운 무기일수록 낮고 김) */
  swing(weight = 1): void {
    const c = this.ready();
    if (!c) return;
    this.noiseBurst(c.currentTime, 0.12 + 0.1 * weight, 900 / weight, 0.35, 'bandpass', 0.9);
  }

  /** 근접 명중 */
  meleeHit(heavy: boolean): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, heavy ? 0.16 : 0.08, heavy ? 500 : 1200, 0.8, 'lowpass', 1.2);
  }

  /** 총기 교체 */
  weaponSwitch(): void {
    this.click(0.8);
  }

  hit(): void {
    const c = this.ready();
    if (!c) return;
    this.noiseBurst(c.currentTime, 0.06, 900, 0.5, 'bandpass', 1.5);
  }

  /** 좀비가 쓰러지는 소리 */
  bodyFall(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t + 0.15, 0.3, 400, 0.8, 'lowpass', 0.8);
    this.noiseBurst(t, 0.25, 900, 0.3, 'bandpass', 1.5);
  }

  /** 플레이어 피격 */
  hurt(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.25);
    this.noiseBurst(t, 0.12, 600, 0.6, 'lowpass', 1);
  }

  /** 폭발 좀비 폭발: 큰 저음 + 잡음 */
  explosion(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, 0.7, 700, 1.2, 'lowpass', 0.7);
    this.noiseBurst(t, 0.15, 3000, 0.4, 'bandpass', 0.8);
    this.tone(t, 'sine', 90, 30, 1.0, 0.6);
  }

  /** 보스 지면 강타 · 돌진 충돌: 묵직한 쿵 */
  thud(weight = 1): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'sine', 70 * (1.2 - weight * 0.2), 28, 0.9 * weight, 0.45);
    this.noiseBurst(t, 0.35, 300, 0.7 * weight, 'lowpass', 0.8);
  }

  /** 보스 포효 · 강타 준비 (pitch 낮을수록 크고 거친 소리) */
  roar(big = false): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const len = big ? 1.3 : 0.6;
    this.tone(t, 'sawtooth', big ? 120 : 150, big ? 55 : 80, big ? 0.35 : 0.2, len);
    this.tone(t, 'square', big ? 61 : 76, big ? 40 : 50, big ? 0.12 : 0.07, len);
    this.noiseBurst(t, len, 500, big ? 0.5 : 0.3, 'bandpass', 1.2);
  }

  /** 스피터 침 뱉기 */
  spit(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, 0.18, 1400, 0.45, 'bandpass', 3);
    this.tone(t, 'triangle', 420, 160, 0.15, 0.16);
  }

  /** 폭발 좀비 준비 · 엘리트 등장 등 경고음 */
  warn(pitch = 1): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'square', 880 * pitch, 860 * pitch, 0.06, 0.12);
    this.tone(t + 0.16, 'square', 880 * pitch, 860 * pitch, 0.06, 0.12);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, vol: number, dur: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  private ready(): AudioContext | null {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private noiseBurst(t: number, dur: number, freq: number, vol: number, type: BiquadFilterType, q: number): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
