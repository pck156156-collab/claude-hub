import { Input } from './Input.js';
import { Renderer } from './Renderer.js';
import { Assets } from './Assets.js';
import { Synth } from './Synth.js';

// 고정 타임스텝 게임 루프. 프레임레이트와 무관하게 물리가 같은 결과를 낸다.
export class Engine {
  constructor(canvas, { width = 640, height = 360, fps = 60, pixelArt = true } = {}) {
    canvas.width = width;
    canvas.height = height;
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.step = 1 / fps;
    this.renderer = new Renderer(canvas, { pixelArt });
    this.input = new Input(window, canvas);
    this.assets = new Assets();
    this.synth = new Synth();
    this.scene = null;
    this.running = false;
    this.paused = false;
    this.time = 0;
    this.fps = 0;
    this._acc = 0;
    this._last = 0;
    this._frame = this._frame.bind(this);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._last = performance.now();
    });
  }

  setScene(scene) {
    this.scene?.exit();
    this.scene = scene;
    scene._attach(this);
    scene.enter();
  }

  start(scene) {
    if (scene) this.setScene(scene);
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; }

  _frame(now) {
    if (!this.running) return;
    // 탭 전환 등으로 시간이 크게 튀면 잘라서 "죽음의 나선"을 막는다.
    const elapsed = Math.min((now - this._last) / 1000, 0.25);
    this._last = now;
    if (elapsed > 0) this.fps = this.fps * 0.9 + (1 / elapsed) * 0.1;

    if (!this.paused) {
      this._acc += elapsed;
      while (this._acc >= this.step) {
        this.scene?.update(this.step);
        this.input.endFrame();
        this.time += this.step;
        this._acc -= this.step;
      }
    }
    this.scene?.render(this.renderer);
    requestAnimationFrame(this._frame);
  }
}
