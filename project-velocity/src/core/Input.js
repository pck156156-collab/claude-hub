// 브라우저 기본 동작(스크롤, F3 찾기 등)을 막을 게임 키
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'Space', 'Escape', 'F3', 'Enter',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

/**
 * 키보드 상태 관리. 눌린 키를 Set 으로 보관해 동시 입력을 지원한다.
 * KeyboardEvent.code 를 사용하므로 한/영 입력 상태와 무관하게 동작한다.
 * reset(): 일시정지·재개·복구 시 이전에 눌려 있던 키 상태를 버린다.
 */
export class Input {
  constructor(target = window) {
    this.target = target;
    this.down = new Set();
    this.pressHandlers = new Map();

    this._onKeyDown = (e) => {
      if (GAME_KEYS.has(e.code) && !isTypingTarget(e.target)) e.preventDefault();
      if (!e.repeat && !this.down.has(e.code)) {
        const handlers = this.pressHandlers.get(e.code);
        if (handlers) handlers.forEach((fn) => fn(e));
      }
      this.down.add(e.code);
    };
    this._onKeyUp = (e) => {
      this.down.delete(e.code);
    };
    // 창이 포커스를 잃으면 keyup 이 오지 않으므로 모든 키를 해제
    this._onBlur = () => this.reset();

    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  isDown(...codes) {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** 키를 처음 눌렀을 때 한 번만 호출 (키 반복 무시) */
  onPress(code, fn) {
    if (!this.pressHandlers.has(code)) this.pressHandlers.set(code, []);
    this.pressHandlers.get(code).push(fn);
  }

  /** 눌려 있던 모든 키 상태 초기화 */
  reset() {
    this.down.clear();
  }

  dispose() {
    this.target.removeEventListener('keydown', this._onKeyDown);
    this.target.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.pressHandlers.clear();
    this.down.clear();
  }
}

function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
