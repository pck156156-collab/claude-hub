// 키보드/마우스 입력. 프레임 단위로 "이번 프레임에 눌림/떼어짐"을 구분한다.
export class Input {
  constructor(target = window, canvas = null) {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: 0, y: 0, down: false, pressed: false };

    this._listeners = [];
    const on = (el, type, fn) => {
      el.addEventListener(type, fn);
      this._listeners.push([el, type, fn]);
    };

    on(target, 'keydown', (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    on(target, 'keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    on(target, 'blur', () => this.down.clear());

    if (canvas) {
      on(canvas, 'mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
        this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
      });
      on(canvas, 'mousedown', () => { this.mouse.down = true; this.mouse.pressed = true; });
      on(window, 'mouseup', () => { this.mouse.down = false; });
    }
  }

  // 등록한 이벤트 리스너를 모두 해제한다.
  dispose() {
    for (const [el, type, fn] of this._listeners) el.removeEventListener(type, fn);
    this._listeners = [];
  }

  isDown(...codes) { return codes.some((c) => this.down.has(c)); }
  wasPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }
  wasReleased(...codes) { return codes.some((c) => this.released.has(c)); }

  // 수평 축 입력: -1, 0, 1
  axisX() {
    return (this.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (this.isDown('ArrowLeft', 'KeyA') ? 1 : 0);
  }

  // 엔진이 매 고정 업데이트 후 호출한다.
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.pressed = false;
  }
}
