/**
 * 개발자 디버그 패널 (F3). 기본은 숨김.
 * FPS 는 항상 측정하고, 패널 내용은 보일 때만 초당 10회 갱신한다 (DOM 비용 최소화).
 */
export class DebugPanel {
  constructor() {
    this.el = document.getElementById('debug-panel');
    this.text = document.getElementById('debug-text');
    this.visible = false;
    this.fps = 0;
    this.frameMs = 0;
    this._frames = 0;
    this._time = 0;
    this._refresh = 0;
  }

  toggle() {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
    this._refresh = Infinity;
  }

  /** 실제 경과 시간(제한 전)으로 FPS 측정 */
  countFrame(realDt) {
    this._frames++;
    this._time += realDt;
    if (this._time >= 0.5) {
      this.fps = this._frames / this._time;
      this.frameMs = (this._time / this._frames) * 1000;
      this._frames = 0;
      this._time = 0;
    }
  }

  update(dt, getInfo) {
    if (!this.visible) return;
    this._refresh += dt;
    if (this._refresh < 0.1) return;
    this._refresh = 0;
    const rows = getInfo(this);
    // 한글 라벨은 고정폭 글꼴에서도 폭이 달라 공백 정렬이 어긋나므로 2열 그리드로 표시 (요소는 재사용)
    if (!this.cells || this.cells.length !== rows.length) {
      this.text.replaceChildren();
      this.cells = rows.map(() => {
        const k = document.createElement('span');
        const v = document.createElement('span');
        k.className = 'debug-key';
        this.text.append(k, v);
        return [k, v];
      });
    }
    rows.forEach(([key, value], i) => {
      const [k, v] = this.cells[i];
      if (k.textContent !== key) k.textContent = key;
      if (v.textContent !== value) v.textContent = value;
    });
  }
}
