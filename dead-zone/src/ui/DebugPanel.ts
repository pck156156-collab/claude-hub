/** F3 디버그 패널: FPS · 위치 · 투사체 수 · 렌더 통계 (0.25초마다 갱신) */
export class DebugPanel {
  private readonly el = document.getElementById('debug') as HTMLElement;
  private frames = 0;
  private acc = 0;
  private worst = 0;
  fps = 0;
  frameMs = 0;
  worstMs = 0;

  get visible(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  /** 매 프레임 호출해 FPS 측정 (패널이 숨겨져 있어도 측정) */
  tick(dt: number, rows: () => [string, string][]): void {
    this.frames++;
    this.acc += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.acc < 0.25) return;
    this.fps = this.frames / this.acc;
    this.frameMs = (this.acc / this.frames) * 1000;
    this.worstMs = this.worst * 1000;
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
    if (this.el.hidden) return;
    const frag = document.createDocumentFragment();
    for (const [k, v] of rows()) {
      const a = document.createElement('span');
      a.textContent = k;
      const b = document.createElement('span');
      b.textContent = v;
      frag.append(a, b);
    }
    this.el.replaceChildren(frag);
  }
}
