import { RARITY_INFO } from '../upgrades/UpgradeData';
import { UpgradeChoice } from '../upgrades/UpgradeManager';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * 레벨업 강화 선택 화면. 카드를 클릭하거나 1 · 2 · 3 키로 선택한다.
 * 한 번 고르면 입력을 잠가서 같은 선택이 두 번 적용되지 않는다. ESC 로 닫을 수 없다.
 */
export class LevelUpScreen {
  private readonly root = $('screen-levelup');
  private readonly cardsEl = $('lv-cards');
  private readonly levelEl = $('lv-level');
  private readonly moreEl = $('lv-more');
  private choices: UpgradeChoice[] = [];
  private locked = true;
  private timer = 0;
  /** 선택 확정 후 다음 처리까지 보여 주는 피드백 시간 (ms) */
  feedbackMs = 260;
  /**
   * 화면이 뜬 직후 입력을 받지 않는 시간 (ms).
   * 사격하며 연타하던 클릭 · 키가 의도치 않게 카드를 고르는 것을 막는다.
   */
  armDelayMs = 450;
  private armedAt = 0;

  onChoose: ((choice: UpgradeChoice) => void) | null = null;

  get visible(): boolean {
    return !this.root.hidden;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  show(level: number, choices: UpgradeChoice[], remaining: number): void {
    this.choices = choices;
    this.locked = false;
    this.levelEl.textContent = String(level);
    this.moreEl.textContent = remaining > 0 ? ` (남은 선택 ${remaining}회)` : '';
    this.cardsEl.classList.remove('locked');
    this.cardsEl.replaceChildren(...choices.map((c, i) => this.card(c, i)));
    this.root.hidden = false;
    this.armedAt = performance.now() + this.armDelayMs;
    this.cardsEl.classList.add('arming');
    window.setTimeout(() => this.cardsEl.classList.remove('arming'), this.armDelayMs);
    (this.cardsEl.firstElementChild as HTMLElement | null)?.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
    window.clearTimeout(this.timer);
    this.locked = true;
  }

  /** 숫자 키 선택 (0부터) */
  select(index: number): void {
    if (this.locked || !this.visible) return;
    if (performance.now() < this.armedAt) return; // 막 나타난 화면: 연타 입력 무시
    const choice = this.choices[index];
    if (!choice) return;
    this.locked = true;
    this.cardsEl.classList.add('locked');
    this.cardsEl.children[index]?.classList.add('chosen');
    // 선택 피드백을 잠깐 보여 준 뒤 적용
    this.timer = window.setTimeout(() => this.onChoose?.(choice), this.feedbackMs);
  }

  private card(c: UpgradeChoice, i: number): HTMLButtonElement {
    const r = RARITY_INFO[c.rarity];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card';
    b.style.setProperty('--rc', r.color);
    b.dataset.id = c.def.id;
    const maxText = Number.isFinite(c.def.maxLevel) ? String(c.def.maxLevel) : '∞';
    const now = c.currentLevel > 0 && !c.def.instant ? c.def.format(c.currentLevel) : '';
    b.innerHTML = `
      <span class="key">${i + 1}</span>
      <span class="rarity"></span>
      <span class="icon"></span>
      <span class="name"></span>
      <span class="lvl">Lv <b>${c.currentLevel}</b> → <b>${c.nextLevel}</b> / ${maxText}</span>
      <p class="desc"></p>
      <span class="effect"></span>`;
    (b.querySelector('.rarity') as HTMLElement).textContent = r.label;
    (b.querySelector('.icon') as HTMLElement).textContent = c.def.icon;
    (b.querySelector('.name') as HTMLElement).textContent = c.def.name;
    (b.querySelector('.desc') as HTMLElement).textContent = c.def.description;
    const eff = b.querySelector('.effect') as HTMLElement;
    eff.textContent = c.def.format(c.nextLevel);
    if (now) {
      const s = document.createElement('s');
      s.textContent = `${now} → `;
      eff.prepend(s);
    }
    b.addEventListener('click', () => this.select(i));
    return b;
  }
}
