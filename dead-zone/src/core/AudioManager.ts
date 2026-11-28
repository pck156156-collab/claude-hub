import { AUDIO_CONFIG } from '../config/GameConfig';

/** 사용자가 바꾸는 소리 설정 (브라우저에 저장) */
export interface AudioSettings {
  /** 전체 0~1 */
  master: number;
  /** 효과음 0~1 */
  sfx: number;
  /** 배경음 · 환경음 0~1 */
  music: number;
  muted: boolean;
}

/** 배경음 분위기 단계 */
export type MusicMood = 'calm' | 'combat' | 'boss' | 'gameover';

const SETTINGS_KEY = 'project-dead-zone.audio';

/**
 * 게임 전체 소리 관리 (Web Audio 로 즉석 합성, 외부 음원 파일 없음).
 *
 * 구조: 각 소리 → 효과음 버스 / 배경음 버스 → 전체 볼륨 → 출력
 * - 브라우저 정책: AudioContext 는 사용자 입력(시작 버튼) 안에서 unlock() 할 때 처음 만든다. 그 전에는 아무 소리도 내지 않는다.
 * - 중복 제한: 소리 종류(key)마다 최소 재생 간격 · 동시 재생 수, 전체 동시 효과음 수(MAX_VOICES) 제한.
 *   좀비가 많아도 울음소리 · 탄착음이 한꺼번에 쌓이지 않는다. 막힌 횟수는 stats.blocked 에 기록.
 * - 일시정지: suspend() 로 오디오 장치를 멈추고, 재개 시 unlock() 으로 다시 켠다.
 * - 배경음: 바람(필터를 거친 잡음 + 느린 변화) · 먼 환경음(무작위 간격) · 긴장감 있는 저음 화음 ·
 *   보스전 박동(베이스 + 북). 분위기(setMood)에 따라 층별 볼륨을 천천히 바꾼다.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  readonly settings: AudioSettings = loadSettings();
  /** 재생 · 차단 통계 (테스트 · 디버그) */
  readonly stats = { played: {} as Record<string, number>, blocked: {} as Record<string, number> };
  private readonly lastPlay = new Map<string, number>();
  private readonly voices: { key: string; end: number }[] = [];

  // ── 배경음 층
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private bossGain: GainNode | null = null;
  private musicStarted = false;
  mood: MusicMood = 'calm';
  /** 전투 긴장도 0~1 (살아 있는 적 수 등) */
  private tension = 0;
  private windTimer = 0;
  private ambienceTimer = 6;
  private chordTimer = 0;
  private chordIndex = 0;
  private nextBeat = 0;
  private beatIndex = 0;

  get muted(): boolean {
    return this.settings.muted;
  }

  set muted(v: boolean) {
    this.settings.muted = v;
    this.applyVolumes();
    saveSettings(this.settings);
  }

  /** 설정 변경 (시작 · 일시정지 화면의 슬라이더) */
  setVolume(kind: 'master' | 'sfx' | 'music', value: number): void {
    this.settings[kind] = Math.max(0, Math.min(1, value));
    this.applyVolumes();
    saveSettings(this.settings);
  }

  /** 오디오 장치가 실제로 동작 중인지 */
  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** 동시에 재생 중인 효과음 수 */
  get activeVoices(): number {
    this.pruneVoices();
    return this.voices.length;
  }

  /** 사용자 입력 안에서 호출 (시작 · 재개 버튼). 처음이면 AudioContext 생성, 멈춰 있으면 다시 켬 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.applyVolumes();
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master * AUDIO_CONFIG.masterVolume, t, 0.03);
    this.sfxBus!.gain.setTargetAtTime(s.sfx, t, 0.03);
    this.musicBus!.gain.setTargetAtTime(s.music * AUDIO_CONFIG.musicVolume, t, 0.03);
  }

  // ───────────────────────────────────────── 중복 재생 제한

  private pruneVoices(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].end <= now) this.voices.splice(i, 1);
  }

  /**
   * 재생 허가: 같은 소리는 minGap 초 안에 다시 재생하지 않고, 동시에 maxSame 개까지만.
   * 전체 동시 효과음이 MAX_VOICES 를 넘으면 중요하지 않은 소리(important=false)는 막는다.
   */
  private gate(key: string, dur: number, minGap: number, maxSame: number, important = false): AudioContext | null {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.settings.muted) return null;
    const now = c.currentTime;
    this.pruneVoices();
    const last = this.lastPlay.get(key) ?? -1e9;
    let same = 0;
    for (const v of this.voices) if (v.key === key) same++;
    if (now - last < minGap || same >= maxSame || (!important && this.voices.length >= AUDIO_CONFIG.maxVoices)) {
      this.stats.blocked[key] = (this.stats.blocked[key] ?? 0) + 1;
      return null;
    }
    this.lastPlay.set(key, now);
    this.voices.push({ key, end: now + dur });
    this.stats.played[key] = (this.stats.played[key] ?? 0) + 1;
    return c;
  }

  // ───────────────────────────────────────── 총기

  /**
   * 총성 (총기별 합성):
   * 권총 = 짧고 날카로운 "탁", SMG = 가볍고 빠른 "틱", 돌격소총 = 균형 잡힌 "탕",
   * 샷건 = 묵직한 "쾅" + 긴 잔향, 기관총 = 두꺼운 저음 "둥" + 기계음
   */
  gunshot(id: string): void {
    const recipe = GUN_SOUNDS[id] ?? GUN_SOUNDS.ar12;
    const c = this.gate(`gun:${id}`, recipe.len + 0.05, recipe.minGap, recipe.maxSame, true);
    if (!c) return;
    const t = c.currentTime;
    const r = recipe;
    this.noiseBurst(t, r.len, r.crackFreq, r.crack, 'lowpass', 0.6);
    this.noiseBurst(t, 0.035, r.snapFreq, r.snap, 'highpass', 0.3);
    this.tone(t, 'triangle', r.thump, r.thump * 0.3, r.body, r.len * 0.9);
    if (r.tail > 0) this.noiseBurst(t + 0.02, r.tail, 380, r.body * 0.35, 'lowpass', 0.5); // 잔향 (샷건 · LMG)
    if (r.mech > 0) this.noiseBurst(t + 0.03, 0.025, 3800, r.mech, 'bandpass', 5); // 노리쇠 기계음
  }

  click(pitch = 1): void {
    const c = this.gate('click', 0.05, 0.06, 2);
    if (!c) return;
    this.noiseBurst(c.currentTime, 0.03, 3000 * pitch, 0.5, 'bandpass', 3);
  }

  /** 재장전 (총기별 장전 시간에 맞춘 소리 3단계) */
  reload(duration = 1.8): void {
    const c = this.gate('reload', duration, 0.2, 1);
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t + 0.05, 0.04, 1800, 0.4, 'bandpass', 2); // 탄창 분리
    this.noiseBurst(t + duration * 0.68, 0.05, 1500, 0.55, 'bandpass', 2); // 삽입
    this.noiseBurst(t + duration * 0.86, 0.04, 2600, 0.5, 'bandpass', 3); // 장전 손잡이
  }

  /** 근접 휘두르기 (무기별: 나이프 짧고 높게 · 방망이 · 도끼 낮고 길게) */
  swing(id: string): void {
    const w = MELEE_SOUNDS[id] ?? MELEE_SOUNDS.knife;
    const c = this.gate('swing', w.swingLen, 0.08, 2, true);
    if (!c) return;
    const t = c.currentTime;
    // 휙: 밴드패스 주파수가 위로 쓸려 올라감
    const src = this.noiseSource(c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(w.swingFreq * 0.5, t + w.swingDelay);
    f.frequency.exponentialRampToValueAtTime(w.swingFreq * 1.6, t + w.swingDelay + w.swingLen);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(w.swingVol, t + w.swingDelay + w.swingLen * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + w.swingDelay + w.swingLen);
    src.connect(f).connect(g).connect(this.sfxBus!);
    src.start(t, Math.random());
    src.stop(t + w.swingDelay + w.swingLen + 0.05);
  }

  /** 근접 명중: 나이프 = 가벼운 찌름, 마체테 = 베는 소리, 방망이 = 둔탁한 강타, 도끼 = 무거운 찍기 */
  meleeHit(id: string, crit = false): void {
    const w = MELEE_SOUNDS[id] ?? MELEE_SOUNDS.knife;
    const c = this.gate('meleeHit', 0.3, 0.04, 3, true);
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, w.hitLen, w.hitFreq, w.hitVol, 'lowpass', 1.2);
    if (w.thump > 0) this.tone(t, 'sine', w.thump, w.thump * 0.4, w.hitVol * 0.8, w.hitLen * 1.4);
    if (w.slice > 0) this.noiseBurst(t, 0.05, 4200, w.slice, 'highpass', 0.7);
    if (crit) this.tone(t + 0.01, 'square', 1500, 1100, 0.06, 0.09);
  }

  /** 총기 교체 */
  weaponSwitch(): void {
    const c = this.gate('switch', 0.1, 0.08, 1);
    if (!c) return;
    this.noiseBurst(c.currentTime, 0.03, 2400, 0.45, 'bandpass', 3);
    this.noiseBurst(c.currentTime + 0.07, 0.03, 1700, 0.35, 'bandpass', 3);
  }

  /** 적 명중 (탄이 살에 박히는 소리). 치명타는 높은 금속성 소리 추가 */
  hit(crit = false): void {
    const c = this.gate('hit', 0.08, 0.035, 3);
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, 0.06, 900, 0.5, 'bandpass', 1.5);
    if (crit) this.tone(t, 'square', 1800, 1300, 0.05, 0.08);
  }

  /** 장애물 탄착 (튕기는 소리, 자주 나므로 강하게 제한) */
  ricochet(): void {
    const c = this.gate('ricochet', 0.12, 0.09, 2);
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, 0.04, 2600, 0.18, 'bandpass', 2);
    if (Math.random() < 0.3) this.tone(t, 'sine', 2400 + Math.random() * 1500, 900, 0.025, 0.14);
  }

  /** 좀비가 쓰러지는 소리 */
  bodyFall(): void {
    const c = this.gate('bodyFall', 0.5, 0.06, 3);
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t + 0.15, 0.3, 400, 0.8, 'lowpass', 0.8);
    this.noiseBurst(t, 0.25, 900, 0.3, 'bandpass', 1.5);
  }

  /** 플레이어 피격 */
  hurt(): void {
    const c = this.gate('hurt', 0.25, 0.12, 1, true);
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'sawtooth', 180, 70, 0.35, 0.22);
    this.noiseBurst(t, 0.12, 600, 0.6, 'lowpass', 1);
  }

  /** 경험치 결정 흡수 (짧고 높은 소리, 연속이면 조금씩 높아짐) */
  pickup(): void {
    const c = this.gate('pickup', 0.08, 0.05, 2);
    if (!c) return;
    const n = (this.stats.played.pickup ?? 0) % 5;
    this.tone(c.currentTime, 'sine', 1200 + n * 90, 1700 + n * 90, 0.05, 0.07);
  }

  /** 레벨업 (상승 화음) */
  levelUp(): void {
    const c = this.gate('levelUp', 0.6, 0.3, 1, true);
    if (!c) return;
    const t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.07, 'triangle', f, f, 0.08, 0.35));
  }

  // ───────────────────────────────────────── 좀비 · 보스

  /** 일반 좀비 울음 (근처 좀비 중 하나가 가끔: 전체 1.6초에 한 번, 동시 2개까지) */
  zombieGroan(pitch = 1, near = 1): void {
    const c = this.gate('groan', 1.2, 1.6, 2);
    if (!c) return;
    const t = c.currentTime;
    const f = (85 + Math.random() * 40) * pitch;
    const len = 0.7 + Math.random() * 0.5;
    const vol = 0.06 + 0.1 * near;
    // 목이 긁히는 소리: 톱니파 + 저역 필터, 음높이가 흔들리며 내려감
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 1.25, t + len * 0.3);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + len);
    const lfo = c.createOscillator();
    lfo.frequency.value = 7 + Math.random() * 5;
    const lfoGain = c.createGain();
    lfoGain.gain.value = f * 0.06;
    lfo.connect(lfoGain).connect(o.frequency);
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 600;
    filt.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(filt).connect(g).connect(this.sfxBus!);
    o.start(t); lfo.start(t);
    o.stop(t + len + 0.05); lfo.stop(t + len + 0.05);
    this.noiseBurst(t, len * 0.8, 500, vol * 0.6, 'bandpass', 2);
  }

  /** 러너가 가속할 때 날카로운 비명 */
  runnerScreech(): void {
    const c = this.gate('screech', 0.45, 0.5, 1);
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'sawtooth', 520, 900, 0.07, 0.35, 1400);
    this.noiseBurst(t, 0.35, 2200, 0.12, 'bandpass', 3);
  }

  /** 탱커 발소리 (가까운 탱커만, 쿵) */
  tankStep(near: number): void {
    const c = this.gate('tankStep', 0.25, 0.3, 2);
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'sine', 62, 38, 0.25 * near, 0.22);
    this.noiseBurst(t, 0.12, 240, 0.2 * near, 'lowpass', 0.7);
  }

  /** 스피터 발사 준비 (꾸르륵 차오르는 소리) */
  spitterCharge(): void {
    const c = this.gate('spitCharge', 0.6, 0.25, 2);
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'sine', 140, 420, 0.06, 0.55);
    for (let i = 0; i < 4; i++) this.noiseBurst(t + i * 0.12, 0.05, 700 + i * 200, 0.1, 'bandpass', 6);
  }

  /** 스피터 침 뱉기 */
  spit(): void {
    const c = this.gate('spit', 0.2, 0.15, 2, true);
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, 0.18, 1400, 0.45, 'bandpass', 3);
    this.tone(t, 'triangle', 420, 160, 0.15, 0.16);
  }

  /** 폭발 좀비 준비 경고 (점점 빨라지는 삐 소리, 준비 시간 동안) */
  primeWarning(duration: number): void {
    const c = this.gate('prime', duration, 0.2, 2, true);
    if (!c) return;
    const t = c.currentTime;
    let at = 0;
    let gap = 0.28;
    let i = 0;
    while (at < duration - 0.05) {
      this.tone(t + at, 'square', 900 + i * 60, 880 + i * 60, 0.05, 0.06);
      at += gap;
      gap = Math.max(0.07, gap * 0.78);
      i++;
    }
  }

  /** 짧은 경고음 (이전 단계 호환) */
  warn(pitch = 1): void {
    const c = this.gate('warn', 0.3, 0.2, 1);
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'square', 880 * pitch, 860 * pitch, 0.06, 0.12);
    this.tone(t + 0.16, 'square', 880 * pitch, 860 * pitch, 0.06, 0.12);
  }

  /** 엘리트 등장 (금속성 상승음) */
  eliteStinger(): void {
    const c = this.gate('elite', 0.8, 0.5, 1, true);
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'sawtooth', 220, 440, 0.07, 0.5, 1800);
    this.tone(t + 0.05, 'sawtooth', 277, 554, 0.05, 0.5, 1800);
    this.noiseBurst(t, 0.5, 5000, 0.06, 'highpass', 0.5);
  }

  /** 폭발 좀비 폭발 */
  explosion(): void {
    const c = this.gate('explosion', 0.8, 0.05, 3, true);
    if (!c) return;
    const t = c.currentTime;
    this.noiseBurst(t, 0.7, 700, 1.2, 'lowpass', 0.7);
    this.noiseBurst(t, 0.15, 3000, 0.4, 'bandpass', 0.8);
    this.tone(t, 'sine', 90, 30, 1.0, 0.6);
  }

  /** 묵직한 쿵 (보스 강타 · 돌진 충돌) */
  thud(weight = 1): void {
    const c = this.gate('thud', 0.45, 0.06, 3, true);
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'sine', 70 * (1.2 - weight * 0.2), 28, 0.9 * weight, 0.45);
    this.noiseBurst(t, 0.35, 300, 0.7 * weight, 'lowpass', 0.8);
  }

  /** 보스 포효 (big = 등장 · 2페이즈) */
  roar(big = false): void {
    const c = this.gate(big ? 'roarBig' : 'roar', big ? 1.3 : 0.6, 0.3, 1, true);
    if (!c) return;
    const t = c.currentTime;
    const len = big ? 1.3 : 0.6;
    this.tone(t, 'sawtooth', big ? 120 : 150, big ? 55 : 80, big ? 0.35 : 0.2, len, 900);
    this.tone(t, 'square', big ? 61 : 76, big ? 40 : 50, big ? 0.12 : 0.07, len, 600);
    this.noiseBurst(t, len, 500, big ? 0.5 : 0.3, 'bandpass', 1.2);
  }

  /** 보스 등장: 포효 + 낮은 북 3번 */
  bossAppear(): void {
    this.roar(true);
    const c = this.gate('bossAppear', 1.5, 2, 1, true);
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 3; i++) this.tone(t + 0.25 + i * 0.4, 'sine', 55, 32, 0.6, 0.5);
  }

  /** 보스 돌진 준비: 낮게 차오르는 으르렁 + 발 긁기 */
  bossChargePrep(duration: number): void {
    const c = this.gate('chargePrep', duration, 0.5, 1, true);
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'sawtooth', 70, 160, 0.16, duration, 700);
    for (let i = 0; i < 3; i++) this.noiseBurst(t + 0.15 + i * 0.3, 0.12, 600, 0.25, 'lowpass', 1);
  }

  /** 보스 사망: 길게 꺼지는 포효 + 땅울림 */
  bossDeath(): void {
    const c = this.gate('bossDeath', 2.4, 1, 1, true);
    if (!c) return;
    const t = c.currentTime;
    this.tone(t, 'sawtooth', 160, 40, 0.3, 2.0, 800);
    this.tone(t, 'square', 80, 25, 0.1, 2.0, 500);
    this.noiseBurst(t + 0.6, 1.4, 260, 0.8, 'lowpass', 0.6);
    this.tone(t + 0.7, 'sine', 50, 25, 0.8, 1.2);
  }

  // ───────────────────────────────────────── 배경음 · 환경음

  private startMusic(): void {
    const c = this.ctx!;
    if (this.musicStarted) return;
    this.musicStarted = true;
    const bus = this.musicBus!;
    // 바람: 반복 잡음 → 밴드패스 (주파수 · 볼륨이 천천히 변함)
    const wind = c.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = c.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.7;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(bus);
    wind.start();
    // 긴장감 있는 저음 화음 (톱니파 4개, 약한 저역 필터)
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 320;
    this.padFilter.Q.value = 0.8;
    this.padGain = c.createGain();
    this.padGain.gain.value = 0;
    this.padFilter.connect(this.padGain).connect(bus);
    for (let i = 0; i < 4; i++) {
      const o = c.createOscillator();
      o.type = i < 2 ? 'sawtooth' : 'triangle';
      o.frequency.value = CHORDS[0][i];
      o.detune.value = (i % 2 ? 7 : -7);
      const g = c.createGain();
      g.gain.value = i < 2 ? 0.12 : 0.18;
      o.connect(g).connect(this.padFilter);
      o.start();
      this.padOscs.push(o);
    }
    // 보스전 층 (박동은 update 에서 예약)
    this.bossGain = c.createGain();
    this.bossGain.gain.value = 0;
    this.bossGain.connect(bus);
    this.nextBeat = c.currentTime + 0.5;
    this.setMood(this.mood, true);
  }

  /** 분위기 전환 (층별 볼륨을 천천히 바꿈) */
  setMood(mood: MusicMood, force = false): void {
    if (this.mood === mood && !force) return;
    this.mood = mood;
    const c = this.ctx;
    if (!c || !this.padGain) return;
    const t = c.currentTime;
    const pad = mood === 'gameover' ? 0.05 : mood === 'boss' ? 0.22 : 0.12 + this.tension * 0.1;
    const boss = mood === 'boss' ? 0.55 : 0;
    const wind = mood === 'boss' ? 0.08 : 0.16;
    this.padGain.gain.setTargetAtTime(pad, t, 1.2);
    this.bossGain!.gain.setTargetAtTime(boss, t, mood === 'boss' ? 0.8 : 1.5);
    this.windGain!.gain.setTargetAtTime(wind, t, 2);
    this.padFilter!.frequency.setTargetAtTime(mood === 'boss' ? 520 : 320, t, 1.5);
  }

  /**
   * 매 프레임: 바람 변화 · 먼 환경음 · 화음 전환 · 보스 박동 예약.
   * @param tension 0~1 (살아 있는 적 수 기반). 화음 볼륨에 살짝 반영
   */
  update(dt: number, tension: number): void {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.musicStarted) return;
    const t = c.currentTime;
    this.tension += (Math.max(0, Math.min(1, tension)) - this.tension) * Math.min(1, dt * 0.5);
    // 바람: 3~6초마다 새 목표로 천천히
    this.windTimer -= dt;
    if (this.windTimer <= 0) {
      this.windTimer = 3 + Math.random() * 3;
      this.windFilter!.frequency.setTargetAtTime(250 + Math.random() * 500, t, 2.5);
      const base = this.mood === 'boss' ? 0.06 : 0.1;
      this.windGain!.gain.setTargetAtTime(base + Math.random() * 0.1, t, 2.5);
    }
    // 화음: 8초마다 다음 화음 (반복이 귀에 거슬리지 않도록 느리게)
    this.chordTimer -= dt;
    if (this.chordTimer <= 0) {
      this.chordTimer = 8;
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      const chord = CHORDS[this.chordIndex];
      this.padOscs.forEach((o, i) => o.frequency.setTargetAtTime(chord[i], t, 1.5));
      if (this.mood === 'calm' || this.mood === 'combat') this.padGain!.gain.setTargetAtTime(0.1 + this.tension * 0.12, t, 2);
    }
    // 먼 환경음: 9~20초 간격
    this.ambienceTimer -= dt;
    if (this.ambienceTimer <= 0) {
      this.ambienceTimer = 9 + Math.random() * 11;
      this.distantSound();
    }
    // 보스전 박동: 105 BPM, 0.2초 앞까지 예약
    if (this.mood === 'boss') {
      const beat = 60 / 105 / 2;
      while (this.nextBeat < t + 0.2) {
        this.bossBeat(this.nextBeat, this.beatIndex++);
        this.nextBeat += beat;
      }
    } else {
      this.nextBeat = t + 0.1;
      this.beatIndex = 0;
    }
  }

  /** 먼 배경 소리: 무너지는 소리 · 금속 삐걱임 · 먼 울부짖음 중 하나 */
  private distantSound(): void {
    const c = this.ctx!;
    const t = c.currentTime;
    const bus = this.musicBus!;
    const k = Math.floor(Math.random() * 3);
    if (k === 0) {
      this.noiseBurst(t, 1.6, 180, 0.35, 'lowpass', 0.5, bus);
    } else if (k === 1) {
      this.tone(t, 'sine', 300 + Math.random() * 200, 180 + Math.random() * 80, 0.05, 1.4, 900, bus);
    } else {
      this.tone(t, 'sawtooth', 260, 140, 0.04, 2.2, 500, bus);
    }
  }

  private bossBeat(at: number, i: number): void {
    const c = this.ctx!;
    const bus = this.bossGain!;
    const step = i % 8;
    // 북: 1 · 4 · 7 박
    if (step === 0 || step === 3 || step === 6) this.tone(at, 'sine', 90, 38, 0.7, 0.28, 0, bus);
    // 베이스: 반음 내려가는 불안한 진행
    const bass = [55, 55, 52, 55, 49, 55, 52, 46][step];
    this.tone(at, 'sawtooth', bass, bass, 0.12, 0.22, 380, bus);
    // 하이햇 (작게)
    if (step % 2 === 1) this.noiseBurst(at, 0.04, 6000, 0.05, 'highpass', 0.6, bus);
    void c;
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  // ───────────────────────────────────────── 합성 도구

  private noiseSource(c: AudioContext): AudioBufferSourceNode {
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    return src;
  }

  private noiseBurst(t: number, dur: number, freq: number, vol: number, type: BiquadFilterType, q: number, out?: AudioNode): void {
    const c = this.ctx!;
    const src = this.noiseSource(c);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out ?? this.sfxBus!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  /** 음높이가 f0 → f1 로 변하는 음 (lowpass > 0 이면 저역 필터) */
  private tone(t: number, type: OscillatorType, f0: number, f1: number, vol: number, dur: number, lowpass = 0, out?: AudioNode): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node: AudioNode = o;
    if (lowpass > 0) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node = node.connect(f);
    }
    node.connect(g).connect(out ?? this.sfxBus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

/** 총기별 총성 재료 */
const GUN_SOUNDS: Record<string, { len: number; crackFreq: number; crack: number; snapFreq: number; snap: number; thump: number; body: number; tail: number; mech: number; minGap: number; maxSame: number }> = {
  p9: { len: 0.09, crackFreq: 3400, crack: 0.75, snapFreq: 7000, snap: 0.45, thump: 210, body: 0.35, tail: 0, mech: 0.12, minGap: 0.03, maxSame: 3 },
  viper: { len: 0.06, crackFreq: 3000, crack: 0.55, snapFreq: 7500, snap: 0.3, thump: 230, body: 0.22, tail: 0, mech: 0.08, minGap: 0.03, maxSame: 4 },
  ar12: { len: 0.12, crackFreq: 2400, crack: 0.9, snapFreq: 6000, snap: 0.35, thump: 150, body: 0.7, tail: 0.12, mech: 0.1, minGap: 0.03, maxSame: 4 },
  bulldog: { len: 0.22, crackFreq: 1500, crack: 1.1, snapFreq: 4200, snap: 0.3, thump: 95, body: 1.15, tail: 0.5, mech: 0, minGap: 0.05, maxSame: 2 },
  titan: { len: 0.15, crackFreq: 1900, crack: 1.0, snapFreq: 5200, snap: 0.3, thump: 115, body: 0.95, tail: 0.25, mech: 0.16, minGap: 0.03, maxSame: 4 },
};

/** 근접 무기별 소리 재료 */
const MELEE_SOUNDS: Record<string, { swingFreq: number; swingLen: number; swingVol: number; swingDelay: number; hitFreq: number; hitLen: number; hitVol: number; thump: number; slice: number }> = {
  knife: { swingFreq: 2600, swingLen: 0.1, swingVol: 0.25, swingDelay: 0.02, hitFreq: 1800, hitLen: 0.06, hitVol: 0.5, thump: 0, slice: 0.25 },
  machete: { swingFreq: 1700, swingLen: 0.2, swingVol: 0.35, swingDelay: 0.06, hitFreq: 1300, hitLen: 0.1, hitVol: 0.7, thump: 0, slice: 0.35 },
  bat: { swingFreq: 700, swingLen: 0.28, swingVol: 0.42, swingDelay: 0.08, hitFreq: 520, hitLen: 0.16, hitVol: 0.9, thump: 120, slice: 0 },
  axe: { swingFreq: 560, swingLen: 0.3, swingVol: 0.42, swingDelay: 0.18, hitFreq: 420, hitLen: 0.2, hitVol: 1.0, thump: 90, slice: 0.2 },
};

/** 배경 화음 (단조 · 불안한 진행, Hz) */
const CHORDS = [
  [55, 65.4, 82.4, 110],
  [51.9, 65.4, 77.8, 103.8],
  [49, 61.7, 73.4, 98],
  [46.2, 58.3, 69.3, 92.5],
];

function loadSettings(): AudioSettings {
  const d: AudioSettings = { master: 1, sfx: 1, music: 0.7, muted: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      for (const k of ['master', 'sfx', 'music'] as const) if (typeof v[k] === 'number') d[k] = Math.max(0, Math.min(1, v[k]));
      if (typeof v.muted === 'boolean') d.muted = v.muted;
    }
  } catch { /* 저장소 접근 불가 */ }
  return d;
}

function saveSettings(s: AudioSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* 무시 */ }
}
