/** 브라우저 기본 동작(스크롤 등)을 막을 게임 키 */
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'Digit1', 'Digit2', 'Digit3', 'Space', 'F3', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * 키보드 · 마우스 상태 관리.
 * - 눌린 키를 Set 으로 보관해 동시 입력을 지원한다 (KeyboardEvent.code 기준 → 한/영 상태 무관).
 * - 마우스 위치는 캔버스 기준 정규화 좌표(NDC, -1~1)로 보관한다.
 * - 창 포커스를 잃으면 keyup/mouseup 이 오지 않으므로 모든 입력을 해제한다.
 */
export class InputManager {
  readonly keys = new Set<string>();
  /** 캔버스 기준 NDC 좌표 */
  readonly mouseNdc = { x: 0, y: 0 };
  /** 화면 픽셀 좌표 (커서 UI 용) */
  readonly mouseScreen = { x: 0, y: 0 };
  mouseInside = false;
  leftButton = false;
  /** 마우스가 움직이는 즉시 호출 (게임 프레임을 기다리지 않음 → 커서 UI 지연 없음) */
  onPointerMove: ((x: number, y: number) => void) | null = null;
  /** 마우스 휠 (deltaY 부호: +1 아래, -1 위). 한 번 굴릴 때 한 번만 */
  onWheel: ((dir: number) => void) | null = null;
  private lastWheel = 0;

  private pressHandlers = new Map<string, Array<() => void>>();
  private readonly element: HTMLElement;
  private readonly listeners: Array<[EventTarget, string, EventListener]> = [];

  constructor(element: HTMLElement) {
    this.element = element;
    this.mouseScreen.x = window.innerWidth / 2;
    this.mouseScreen.y = window.innerHeight / 2;

    this.on(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (GAME_KEYS.has(ev.code)) ev.preventDefault();
      if (!ev.repeat && !this.keys.has(ev.code)) this.pressHandlers.get(ev.code)?.forEach((fn) => fn());
      this.keys.add(ev.code);
    });
    this.on(window, 'keyup', (e) => this.keys.delete((e as KeyboardEvent).code));

    this.on(window, 'pointermove', (e) => this.updatePointer(e as PointerEvent));
    this.on(element, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      this.updatePointer(ev);
      if (ev.button === 0) this.leftButton = true;
    });
    this.on(window, 'pointerup', (e) => {
      if ((e as PointerEvent).button === 0) this.leftButton = false;
    });
    this.on(element, 'contextmenu', (e) => e.preventDefault());
    this.on(element, 'wheel', (e) => {
      const ev = e as WheelEvent;
      ev.preventDefault();
      // 터치패드처럼 작은 이벤트가 연달아 올 때 한 번으로 묶음
      const now = performance.now();
      if (Math.abs(ev.deltaY) < 1 || now - this.lastWheel < 120) return;
      this.lastWheel = now;
      this.onWheel?.(Math.sign(ev.deltaY));
    });
    this.on(document, 'mouseleave', () => (this.mouseInside = false));
    this.on(window, 'blur', () => this.reset());
    this.on(document, 'visibilitychange', () => {
      if (document.hidden) this.reset();
    });
  }

  isDown(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** 키를 처음 눌렀을 때 한 번만 호출 (키 반복 무시) */
  onPress(code: string, fn: () => void): void {
    const list = this.pressHandlers.get(code) ?? [];
    list.push(fn);
    this.pressHandlers.set(code, list);
  }

  /** 눌려 있던 모든 입력 해제 (포커스 해제 · 일시정지 시) */
  reset(): void {
    this.keys.clear();
    this.leftButton = false;
  }

  dispose(): void {
    for (const [target, type, fn] of this.listeners) target.removeEventListener(type, fn);
    this.listeners.length = 0;
    this.pressHandlers.clear();
    this.reset();
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    this.mouseScreen.x = e.clientX;
    this.mouseScreen.y = e.clientY;
    this.mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.mouseInside = true;
    this.onPointerMove?.(e.clientX, e.clientY);
  }

  private on(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.listeners.push([target, type, fn]);
  }
}
