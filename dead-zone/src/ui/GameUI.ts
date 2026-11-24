import { QUALITY_PRESETS, QualityLevel } from '../config/GameConfig';

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
  private readonly pauseReason = $('pause-reason');
  private readonly last: Partial<Record<string, unknown>> = {};
  private pipEls: HTMLElement[] = [];
  private hitTimer = 0;

  onStart: (() => void) | null = null;
  onQuality: ((level: QualityLevel) => void) | null = null;
  private readonly qualityButtons: HTMLButtonElement[] = [];
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;

  constructor() {
    $('btn-start').addEventListener('click', () => this.onStart?.());
    $('btn-resume').addEventListener('click', () => this.onResume?.());
    $('btn-restart').addEventListener('click', () => this.onRestart?.());
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

  showScreen(name: 'start' | 'pause' | 'gameover' | 'error' | null, reason = ''): void {
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

  showGameOver(kills: number, seconds: number): void {
    $('go-kills').textContent = String(kills);
    const m = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    $('go-time').textContent = `${m}:${String(sec).padStart(2, '0')}`;
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
  flashHit(kill: boolean): void {
    this.hitTimer = kill ? 0.3 : 0.12;
    this.crosshair.classList.add('hit');
    this.crosshair.classList.toggle('kill', kill);
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
      if (this.hitTimer <= 0) this.crosshair.classList.remove('hit', 'kill');
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
      this.pipEls = Array.from({ length: v }, () => this.pips.appendChild(document.createElement('i')));
    });
    this.set('ammo', s.ammo, (v) => {
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
