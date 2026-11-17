import { QUALITY_PRESETS } from '../config.js';
import { STATE } from '../core/GameState.js';

const PAUSE_REASON = {
  esc: 'ESC 키로 일시정지했습니다.',
  blur: '게임 창이 포커스를 잃어 자동으로 일시정지했습니다.',
  hidden: '탭이 숨겨져 자동으로 일시정지했습니다.',
  restored: '그래픽 장치가 복구되었습니다. 계속하려면 아래 버튼을 누르세요.',
};

/**
 * 시작 화면 · 일시정지 화면 · 오류 화면. 게임 상태에 맞는 화면 하나만 보여 준다.
 * 그래픽 품질 선택 버튼은 시작 화면과 일시정지 화면에 같은 방식으로 들어간다.
 */
export class Menus {
  constructor({ onStart, onResume, onQuality }) {
    this.screens = {
      [STATE.TITLE]: document.getElementById('screen-title'),
      [STATE.PAUSED]: document.getElementById('screen-pause'),
      [STATE.ERROR]: document.getElementById('screen-error'),
    };
    this.pauseReason = document.getElementById('pause-reason');
    this.errorTitle = document.getElementById('error-title');
    this.errorText = document.getElementById('error-text');

    document.getElementById('btn-start').addEventListener('click', () => onStart());
    document.getElementById('btn-resume').addEventListener('click', () => onResume());

    this.qualityButtons = [];
    for (const group of document.querySelectorAll('.quality-group')) {
      for (const [level, preset] of Object.entries(QUALITY_PRESETS)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quality-option';
        btn.dataset.quality = level;
        btn.textContent = preset.label;
        btn.addEventListener('click', () => onQuality(level));
        group.appendChild(btn);
        this.qualityButtons.push(btn);
      }
    }
  }

  show(state, reason = '') {
    for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== state;
    if (state === STATE.PAUSED) this.pauseReason.textContent = PAUSE_REASON[reason] ?? '';
    const focusTarget = state === STATE.TITLE ? 'btn-start' : state === STATE.PAUSED ? 'btn-resume' : null;
    if (focusTarget) document.getElementById(focusTarget).focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  setQuality(level) {
    for (const btn of this.qualityButtons) btn.setAttribute('aria-pressed', String(btn.dataset.quality === level));
  }

  showError(title, text) {
    this.errorTitle.textContent = title;
    this.errorText.textContent = text;
  }
}
