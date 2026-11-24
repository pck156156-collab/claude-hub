import './style.css';
import WebGL from 'three/examples/jsm/capabilities/WebGL.js';
import { Game } from './core/Game';

function showFatal(text: string): void {
  const screen = document.getElementById('screen-error');
  const msg = document.getElementById('error-text');
  document.getElementById('screen-start')?.setAttribute('hidden', '');
  if (screen && msg) {
    msg.textContent = text;
    screen.hidden = false;
  }
}

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

if (!WebGL.isWebGL2Available()) {
  showFatal('이 브라우저 또는 그래픽 드라이버가 WebGL2 를 지원하지 않습니다. 최신 Chrome · Edge · Firefox 에서 실행하거나 하드웨어 가속을 켜 주세요.');
} else {
  try {
    const game = new Game(canvas);
    game.start();
    // 테스트 · 디버그용 접근
    (window as unknown as { __game: Game }).__game = game;
    if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
  } catch (err) {
    console.error(err);
    showFatal(`게임을 초기화하지 못했습니다: ${(err as Error).message}`);
  }
}
