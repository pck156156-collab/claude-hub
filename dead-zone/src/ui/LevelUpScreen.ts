import { RARITY_INFO } from '../upgrades/UpgradeData';
import { UpgradeChoice } from '../upgrades/UpgradeManager';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** 무기 보상 카드 하나 */
export interface WeaponOffer {
  id: string;
  name: string;
  role: string;
  /** 카드 테두리 색 */
  color: string;
  label: string;
  /** [항목, 값, 비교 ('up' | 'down' | '')] */
  stats: [string, string, string][];
  /** 버튼 (예: "슬롯 1 교체 (AR-12)") */
  actions: { label: string; value: string }[];
}

/**
 * 보상 선택 화면 (레벨업 강화 · 총기 보상 · 근접 무기 보상 공용).
 * - 강화: 카드 클릭 또는 1 · 2 · 3 키
 * - 무기: 카드의 버튼(슬롯 교체 · 장착) 또는 "획득하지 않음"
 * 화면이 뜬 직후 잠깐은 입력을 받지 않고(연타 오입력 방지), 한 번 고르면 잠가서 중복 적용을 막는다.
 * ESC 로 닫을 수 없다.
 */
export class LevelUpScreen {
  private readonly root = $('screen-levelup');
  private readonly cardsEl = $('lv-cards');
  private readonly titleEl = document.querySelector('#screen-levelup .lv-title') as HTMLElement;
  private readonly subEl = document.querySelector('#screen-levelup .lv-sub') as HTMLElement;
  private readonly hintEl = $('lv-hint');
  private readonly equippedEl = $('lv-equipped');
  private readonly declineEl = $('lv-decline');
  private choices: UpgradeChoice[] = [];
  private mode: 'upgrade' | 'offer' = 'upgrade';
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
  /** 무기 보상 결정: (무기 ID, 버튼 값) 또는 거절 (null) */
  onOffer: ((id: string | null, value: string | null) => void) | null = null;

  constructor() {
    this.declineEl.addEventListener('click', () => this.decide(null, null, this.declineEl));
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get currentMode(): 'upgrade' | 'offer' {
    return this.mode;
  }

  /** 레벨업 강화 카드 */
  show(level: number, choices: UpgradeChoice[], remaining: number): void {
    this.mode = 'upgrade';
    this.choices = choices;
    this.titleEl.textContent = 'LEVEL UP!';
    this.subEl.innerHTML = '';
    this.subEl.append('레벨 ', bold(String(level)), ' · 강화를 하나 선택하세요', remaining > 0 ? ` (남은 보상 ${remaining}개)` : '');
    this.hintEl.hidden = false;
    this.equippedEl.hidden = true;
    this.declineEl.hidden = true;
    this.open(choices.map((c, i) => this.card(c, i)));
  }

  /** 무기 보상 카드 */
  showOffer(title: string, subtitle: string, offers: WeaponOffer[], equipped: string, remaining: number): void {
    this.mode = 'offer';
    this.choices = [];
    this.titleEl.textContent = title;
    this.subEl.textContent = subtitle + (remaining > 0 ? ` (남은 보상 ${remaining}개)` : '');
    this.hintEl.hidden = true;
    this.equippedEl.hidden = false;
    this.equippedEl.innerHTML = equipped;
    this.declineEl.hidden = false;
    this.open(offers.map((o) => this.offerCard(o)));
  }

  hide(): void {
    this.root.hidden = true;
    window.clearTimeout(this.timer);
    this.locked = true;
  }

  /** 숫자 키 선택 (0부터) — 강화 카드에서만 */
  select(index: number): void {
    if (this.mode !== 'upgrade' || !this.ready()) return;
    const choice = this.choices[index];
    if (!choice) return;
    this.lock(this.cardsEl.children[index] as HTMLElement);
    this.timer = window.setTimeout(() => this.onChoose?.(choice), this.feedbackMs);
  }

  private open(cards: HTMLElement[]): void {
    this.locked = false;
    this.cardsEl.classList.remove('locked');
    this.cardsEl.replaceChildren(...cards);
    this.root.hidden = false;
    this.armedAt = performance.now() + this.armDelayMs;
    this.cardsEl.classList.add('arming');
    window.setTimeout(() => this.cardsEl.classList.remove('arming'), this.armDelayMs);
  }

  private ready(): boolean {
    // 막 나타난 화면: 연타 입력 무시
    return !this.locked && this.visible && performance.now() >= this.armedAt;
  }

  private lock(chosen: HTMLElement | null): void {
    this.locked = true;
    this.cardsEl.classList.add('locked');
    chosen?.classList.add('chosen');
  }

  private decide(id: string | null, value: string | null, el: HTMLElement): void {
    if (this.mode !== 'offer' || !this.ready()) return;
    this.lock(el.closest('.card') as HTMLElement | null);
    el.classList.add('chosen');
    this.timer = window.setTimeout(() => this.onOffer?.(id, value), this.feedbackMs);
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
    b.append(
      span('key', String(i + 1)), span('rarity', r.label), span('icon', c.def.icon), span('name', c.def.name),
      levelLine(c.currentLevel, c.nextLevel, maxText), para('desc', c.def.description),
    );
    const eff = span('effect', c.def.format(c.nextLevel));
    if (now) {
      const s = document.createElement('s');
      s.textContent = `${now} → `;
      eff.prepend(s);
    }
    b.append(eff);
    b.addEventListener('click', () => this.select(i));
    return b;
  }

  private offerCard(o: WeaponOffer): HTMLElement {
    const el = document.createElement('div');
    el.className = 'card offer';
    el.style.setProperty('--rc', o.color);
    el.dataset.id = o.id;
    el.append(span('rarity', o.label), span('name', o.name), para('desc', o.role));
    const dl = document.createElement('dl');
    dl.className = 'stats';
    for (const [k, v, cmp] of o.stats) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      if (cmp) dd.className = cmp;
      dl.append(dt, dd);
    }
    el.append(dl);
    const actions = document.createElement('div');
    actions.className = 'actions';
    for (const a of o.actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'act';
      btn.textContent = a.label;
      btn.dataset.value = a.value;
      btn.addEventListener('click', () => this.decide(o.id, a.value, btn));
      actions.append(btn);
    }
    el.append(actions);
    return el;
  }
}

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function para(cls: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  return p;
}

function bold(text: string): HTMLElement {
  const b = document.createElement('b');
  b.id = 'lv-level';
  b.textContent = text;
  return b;
}

function levelLine(cur: number, next: number, max: string): HTMLSpanElement {
  const s = span('lvl', '');
  const a = document.createElement('b');
  a.textContent = String(cur);
  const b = document.createElement('b');
  b.textContent = String(next);
  s.append('Lv ', a, ' → ', b, ` / ${max}`);
  return s;
}
