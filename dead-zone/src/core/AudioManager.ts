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

  gunshot(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    // 날카로운 소음 + 저음 충격
    this.noiseBurst(t, 0.12, 2400, 0.9, 'lowpass', 0.6);
    this.noiseBurst(t, 0.04, 6000, 0.35, 'highpass', 0.2);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
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

  hit(): void {
    const c = this.ready();
    if (!c) return;
    this.noiseBurst(c.currentTime, 0.06, 900, 0.5, 'bandpass', 1.5);
  }

  breakTarget(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, 0.35, 700, 0.8, 'lowpass', 0.8);
    this.noiseBurst(t + 0.05, 0.25, 2200, 0.35, 'bandpass', 1);
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
