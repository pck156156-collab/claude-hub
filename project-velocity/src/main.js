import './style.css';
import { Game } from './core/Game.js';

const app = document.getElementById('app');

try {
  const game = new Game(app);
  game.start();
  // 개발 모드에서만 콘솔 디버깅용으로 노출
  if (import.meta.env.DEV) window.__game = game;
} catch (err) {
  console.error(err);
  const msg = document.createElement('div');
  msg.className = 'fatal';
  msg.textContent = 'WebGL을 초기화할 수 없습니다. 최신 브라우저에서 하드웨어 가속을 켜고 다시 시도해 주세요.';
  document.body.appendChild(msg);
}
