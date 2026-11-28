import { QUALITY_PRESETS, QualityLevel, WAVE_CONFIG } from '../config/GameConfig';
import { RecordResult, RecordSet } from '../core/Records';
import { formatTime } from '../waves/WaveSystem';

/**
 * DOM 기반 HUD: 체력 · 탄약 · 무기 이름 · 조준 커서 · 화면 전환.
 * 값이 바뀔 때만 DOM 을 갱신해 불필요한 레이아웃 계산을 피한다.
 */
export interface UIState {
  health: number;
  maxHealth: number;
  ammo: number;
  magazineSize: number;
  weaponName: string;
  reloading: boolean;
  reloadProgress: number;
  /** 최근 사격에 따른 커서 벌어짐 0~1 */
  spread: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** HUD 무기 칸 하나 */
export interface LoadoutSlot {
  name: string;
  /** 탄약 "28/30" · 근접은 "준비" 등 */
  ammo: string;
  /** 숙련도 표시 */
  mastery: string;
  active: boolean;
  state: 'idle' | 'reloading' | 'ready' | 'cooldown';
  /** 아래 막대 0~1 (재장전 · 쿨다운 진행) */
  bar: number;
}

export class GameUI {
  private readonly app = $('app');
  private readonly hpText = $('hp-text');
  private readonly hpFill = $('hp-fill');
  private readonly ammoBox = document.querySelector('.ammo') as HTMLElement;
  private readonly ammoCurrent = $('ammo-current');
  private readonly ammoMax = $('ammo-max');
  private readonly weaponName = $('weapon-name');
  private readonly pips = $('ammo-pips');
  private readonly reloadHint = $('reload-hint');
  private readonly crosshair = $('crosshair');
  private readonly reloadCircle = this.crosshair.querySelector('.ch-reload circle') as SVGCircleElement;
  private readonly screens = { start: $('screen-start'), pause: $('screen-pause'), gameover: $('screen-gameover'), error: $('screen-error') };
  private readonly healthBox = document.querySelector('.health') as HTMLElement;
  private readonly vignette = $('damage-vignette');
  private readonly killsBox = document.querySelector('.kills') as HTMLElement;
  private readonly killCount = $('kill-count');
  private readonly aliveCount = $('alive-count');
  private readonly waveNum = $('wave-num');
  private readonly surviveTime = $('survive-time');
  private readonly waveProgress = $('wave-progress');
  private readonly banner = $('wave-banner');
  private readonly bannerNum = $('wb-num');
  private readonly xpLevel = $('xp-level');
  private readonly xpFill = $('xp-fill');
  private readonly xpText = $('xp-text');
  private readonly upgradeList = $('upgrade-list');
  private readonly slotEls = [$('slot-0'), $('slot-1'), $('melee-slot')];
  private readonly toastEl = $('toast');
  private readonly bossHud = $('boss-hud');
  private readonly bossName = $('boss-name');
  private readonly bossPhase = $('boss-phase');
  private readonly bossFill = $('boss-fill');
  private readonly bossTrail = $('boss-trail');
  private readonly bossHp = $('boss-hp');
  private readonly alertEl = $('alert-banner');
  private readonly alertTitle = $('ab-title');
  private readonly alertSub = $('ab-sub');
  private readonly pauseReason = $('pause-reason');
  private readonly last: Partial<Record<string, unknown>> = {};
  private pipEls: HTMLElement[] = [];
  private hitTimer = 0;

  onStart: (() => void) | null = null;
  onQuality: ((level: QualityLevel) => void) | null = null;
  private readonly qualityButtons: HTMLButtonElement[] = [];
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  /** 소리 설정 변경 (슬라이더 · 음소거) */
  onVolume: ((kind: 'master' | 'sfx' | 'music', value: number) => void) | null = null;
  onMute: ((muted: boolean) => void) | null = null;

  constructor() {
    $('btn-start').addEventListener('click', () => this.onStart?.());
    $('btn-resume').addEventListener('click', () => this.onResume?.());
    $('btn-restart').addEventListener('click', () => this.onRestart?.());
    for (const el of document.querySelectorAll<HTMLInputElement>('[data-vol]')) {
      el.addEventListener('input', () => this.onVolume?.(el.dataset.vol as 'master' | 'sfx' | 'music', Number(el.value) / 100));
      el.addEventListener('keydown', (e) => e.stopPropagation());
    }
    for (const el of document.querySelectorAll<HTMLInputElement>('[data-mute]')) el.addEventListener('change', () => this.onMute?.(el.checked));
    for (const group of document.querySelectorAll('.quality-group')) {
      for (const [level, preset] of Object.entries(QUALITY_PRESETS)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'q-btn';
        b.dataset.quality = level;
        b.textContent = preset.label;
        b.addEventListener('click', () => this.onQuality?.(level as QualityLevel));
        group.appendChild(b);
        this.qualityButtons.push(b);
      }
    }
  }

  /** 소리 설정 화면 값 동기화 (시작 · 일시정지 화면 양쪽) */
  setAudioSettings(st: { master: number; sfx: number; music: number; muted: boolean }): void {
    for (const el of document.querySelectorAll<HTMLInputElement>('[data-vol]')) el.value = String(Math.round(st[el.dataset.vol as 'master' | 'sfx' | 'music'] * 100));
    for (const el of document.querySelectorAll<HTMLInputElement>('[data-mute]')) el.checked = st.muted;
  }

  showScreen(name: 'start' | 'pause' | 'gameover' | 'error' | null, reason = ''): void {
    // 레벨업 화면은 LevelUpScreen 이 따로 관리
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== name;
    this.app.classList.toggle('playing', name === null);
    if (name === 'pause') this.pauseReason.textContent = reason;
    if (name === 'start') $('btn-start').focus({ preventScroll: true });
    if (name === 'pause') $('btn-resume').focus({ preventScroll: true });
    if (name === 'gameover') $('btn-restart').focus({ preventScroll: true });
  }

  setKills(n: number): void {
    this.killCount.textContent = String(n);
    if (n > 0) restartAnimation(this.killsBox, 'bump');
  }

  /** 플레이어 피격: 화면 가장자리 붉은 섬광 + 체력 패널 흔들림 */
  hurt(): void {
    restartAnimation(this.vignette, 'flash');
    restartAnimation(this.healthBox, 'hurt');
  }

  /** 웨이브 · 생존 시간 · 생존 좀비 수 (값이 바뀔 때만 DOM 갱신) */
  setWaveStatus(wave: number, seconds: number, alive: number): void {
    this.set('wave', wave, (v) => (this.waveNum.textContent = String(v)));
    this.set('time', Math.floor(seconds), () => (this.surviveTime.textContent = formatTime(seconds)));
    this.set('alive', alive, (v) => (this.aliveCount.textContent = String(v)));
    const progress = Math.round(((seconds % WAVE_CONFIG.duration) / WAVE_CONFIG.duration) * 200) / 2;
    this.set('waveProgress', progress, (v) => (this.waveProgress.style.width = `${v}%`));
  }

  /** 장착 무기 표시 (총기 2 · 근접 1). 바뀐 값만 DOM 갱신 */
  setLoadout(slots: LoadoutSlot[], melee: LoadoutSlot): void {
    const all = [...slots, melee];
    all.forEach((d, i) => {
      const el = this.slotEls[i];
      this.set(`slot${i}`, `${d.name}|${d.ammo}|${d.mastery}|${d.active}|${d.state}`, () => {
        (el.querySelector('.s-name') as HTMLElement).textContent = d.name;
        (el.querySelector('.s-ammo') as HTMLElement).textContent = d.ammo;
        (el.querySelector('.s-mastery') as HTMLElement).textContent = d.mastery;
        el.classList.toggle('active', d.active);
        el.classList.toggle('reloading', d.state === 'reloading');
        el.classList.toggle('ready', d.state === 'ready');
      });
      const bar = Math.round(d.bar * 100);
      this.set(`slotbar${i}`, bar, (v) => ((el.querySelector('.s-bar') as HTMLElement).style.width = `${v}%`));
    });
  }

  /** 화면 아래 짧은 알림 (숙련도 상승 · 무기 획득) */
  toast(text: string): void {
    this.toastEl.textContent = text;
    restartAnimation(this.toastEl, 'show');
  }

  /** 보스 체력바 (화면 상단). null 이면 숨김 */
  setBoss(info: { name: string; health: number; maxHealth: number; phase: number } | null): void {
    if (!info) {
      this.set('boss', null, () => { this.bossHud.hidden = true; });
      return;
    }
    const ratio = Math.max(0, info.health / info.maxHealth);
    this.set('boss', `${info.name}|${Math.ceil(info.health)}|${info.phase}`, () => {
      this.bossHud.hidden = false;
      this.bossName.textContent = info.name;
      this.bossPhase.textContent = info.phase >= 2 ? 'PHASE 2 · 분노' : '';
      this.bossHud.classList.toggle('p2', info.phase >= 2);
      this.bossFill.style.width = `${ratio * 100}%`;
      this.bossTrail.style.width = `${ratio * 100}%`;
      this.bossHp.textContent = `${Math.ceil(info.health).toLocaleString()} / ${info.maxHealth.toLocaleString()}`;
    });
  }

  /** 화면 상단 큰 알림 (보스 등장 · 페이즈 전환 · 보스 처치) */
  showAlert(title: string, sub: string, kind: 'boss' | 'phase' | 'defeat' = 'boss'): void {
    this.alertTitle.textContent = title;
    this.alertSub.textContent = sub;
    this.alertEl.classList.remove('boss', 'phase', 'defeat');
    this.alertEl.classList.add(kind);
    restartAnimation(this.alertEl, 'show');
  }

  hideAlert(): void {
    this.alertEl.classList.remove('show');
  }

  /** 레벨 · 경험치 게이지 */
  setXp(level: number, xp: number, required: number): void {
    this.set('xpLevel', level, (v) => (this.xpLevel.textContent = String(v)));
    this.set('xpText', `${xp}/${required}`, () => {
      this.xpText.textContent = `${xp} / ${required} XP`;
      this.xpFill.style.width = `${Math.min(100, (100 * xp) / required)}%`;
    });
  }

  /** 보유 강화 아이콘 목록 (아이콘 · 레벨 · 희귀도 색) */
  setUpgrades(items: { icon: string; name: string; level: number; color: string; label: string }[]): void {
    const key = items.map((i) => `${i.name}${i.level}`).join('|');
    this.set('upgrades', key, () => {
      this.upgradeList.replaceChildren(...items.map((i) => {
        const li = document.createElement('li');
        li.style.setProperty('--rc', i.color);
        li.title = `${i.name} Lv ${i.level} — ${i.label}`;
        li.textContent = i.icon;
        const b = document.createElement('b');
        b.textContent = String(i.level);
        li.appendChild(b);
        return li;
      }));
    });
  }

  /** 화면 중앙 "WAVE n / SURVIVE!" 알림 (CSS 애니메이션으로 나타났다 사라짐) */
  showWaveBanner(wave: number): void {
    this.bannerNum.textContent = String(wave);
    restartAnimation(this.banner, 'show');
  }

  hideWaveBanner(): void {
    this.banner.classList.remove('show');
  }

  showGameOver(run: RecordSet, rec: RecordResult, extra: { level: number; upgrades: number; weapons?: string }): void {
    $('go-weapons').textContent = extra.weapons ? `장착 무기 — ${extra.weapons}` : '';
    $('go-level').textContent = String(extra.level);
    $('go-upgrades').textContent = `${extra.upgrades}종`;
    $('go-time').textContent = formatTime(run.time);
    $('go-wave').textContent = String(run.wave);
    $('go-kills').textContent = String(run.kills);
    $('go-time-new').hidden = !rec.newTime;
    $('go-wave-new').hidden = !rec.newWave;
    $('go-kills-new').hidden = !rec.newKills;
    $('go-best').textContent = `최고 기록 — 생존 ${formatTime(rec.best.time)} · 웨이브 ${rec.best.wave} · 처치 ${rec.best.kills}`;
    this.hideWaveBanner();
    this.showScreen('gameover');
  }

  setQuality(level: QualityLevel): void {
    for (const b of this.qualityButtons) b.setAttribute('aria-pressed', String(b.dataset.quality === level));
  }

  showError(text: string): void {
    $('error-text').textContent = text;
    this.showScreen('error');
  }

  /** 피격 표시 (명중 · 파괴) */
  flashHit(kill: boolean, crit = false): void {
    this.hitTimer = kill ? 0.3 : crit ? 0.18 : 0.12;
    this.crosshair.classList.add('hit');
    this.crosshair.classList.toggle('kill', kill);
    this.crosshair.classList.toggle('crit', crit);
  }

  /**
   * 조준 커서 보조 표시(탄 퍼짐 · 재장전 원 · 명중 표시) 위치.
   * 마우스 이벤트에서 바로 호출되므로 게임 프레임이 낮아도 지연되지 않는다.
   * 가운데 십자선 자체는 운영체제 커서(CSS cursor)로 그려 지연이 전혀 없다.
   */
  moveCursor(x: number, y: number): void {
    this.crosshair.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  update(dt: number, s: UIState): void {
    this.set('spread', Math.round(s.spread * 8), (v) => this.crosshair.style.setProperty('--spread', `${v}px`));
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.crosshair.classList.remove('hit', 'kill', 'crit');
    }

    this.set('hp', `${s.health}/${s.maxHealth}`, () => {
      this.hpText.textContent = `${Math.ceil(s.health)} / ${s.maxHealth}`;
      this.hpFill.style.width = `${(100 * s.health) / s.maxHealth}%`;
      const low = s.health > 0 && s.health <= s.maxHealth * 0.3;
      this.healthBox.classList.toggle('low', low);
      this.vignette.classList.toggle('low', low);
    });
    this.set('weapon', s.weaponName, (v) => (this.weaponName.textContent = v));
    this.set('mag', s.magazineSize, (v) => {
      this.ammoMax.textContent = String(v);
      this.pips.replaceChildren();
      // 탄창이 큰 총(LMG 100발)은 탄 표시 줄을 생략
      this.pipEls = v > 50 ? [] : Array.from({ length: v }, () => this.pips.appendChild(document.createElement('i')));
    });
    this.set('ammo', s.ammo + s.magazineSize * 10000, () => {
      const v = s.ammo;
      this.ammoCurrent.textContent = String(v);
      this.ammoBox.classList.toggle('low', v > 0 && v <= s.magazineSize * 0.25);
      this.ammoBox.classList.toggle('empty', v === 0);
      this.pipEls.forEach((el, i) => el.classList.toggle('spent', i >= v));
      this.crosshair.classList.toggle('empty', v === 0);
    });
    const hint = s.reloading ? 'reloading' : s.ammo === 0 ? 'empty' : s.ammo <= s.magazineSize * 0.25 ? 'low' : '';
    this.set('hint', hint, (v) => {
      this.reloadHint.textContent = v === 'reloading' ? '재장전 중…' : v === 'empty' ? '탄약 없음 — R 재장전' : v === 'low' ? '탄약 부족 — R 재장전' : '';
      this.reloadHint.classList.toggle('reloading', v === 'reloading');
    });
    this.set('reloading', s.reloading, (v) => this.crosshair.classList.toggle('reloading', v));
    if (s.reloading) {
      this.reloadCircle.style.strokeDashoffset = String(119.4 * (1 - s.reloadProgress));
    }
  }

  private set<T>(key: string, value: T, apply: (v: T) => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }
}

/** CSS 애니메이션 클래스를 떼었다 붙여 처음부터 다시 재생 */
function restartAnimation(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
