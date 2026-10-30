// 태블릿/휴대폰용 화면 버튼(◀ ▶ 점프). 누르는 동안 해당 키가 눌린 것으로 처리한다.
export class TouchControls {
  constructor(input, container) {
    this.input = input;
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.style.cssText = 'display:flex;justify-content:space-between;width:100%;max-width:720px;gap:12px;user-select:none;-webkit-user-select:none;touch-action:none;';
    const left = document.createElement('div');
    left.style.cssText = 'display:flex;gap:12px;';
    left.append(this.button('◀', 'ArrowLeft'), this.button('▶', 'ArrowRight'));
    this.root.append(left, this.button('⤒ 점프', 'Space', true));
    container.append(this.root);
  }

  button(label, code, wide = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `min-width:${wide ? 120 : 72}px;height:64px;font-size:26px;border-radius:16px;border:2px solid #ffffff33;background:#ffffff1a;color:#fff;touch-action:none;cursor:pointer;`;
    const down = (e) => {
      e.preventDefault();
      this.input.virtualDown(code);
      b.style.background = '#ffffff40';
      // 손가락이 버튼 밖으로 살짝 벗어나도 계속 눌린 상태를 유지한다.
      try { b.setPointerCapture(e.pointerId); } catch { /* 지원하지 않는 환경 */ }
    };
    const up = (e) => { e.preventDefault(); this.input.virtualUp(code); b.style.background = '#ffffff1a'; };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  destroy() { this.root.remove(); }
}
