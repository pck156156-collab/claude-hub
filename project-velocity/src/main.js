import './style.css';
import WebGL from 'three/examples/jsm/capabilities/WebGL.js';
import { Game } from './core/Game.js';

/** 실행할 수 없을 때 보여 주는 안내 화면 (원인과 해결 방법) */
function showFatal(title, steps, detail) {
  document.body.dataset.state = 'error';
  for (const id of ['screen-title', 'screen-pause']) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  const wrap = document.createElement('div');
  wrap.className = 'screen';
  wrap.setAttribute('role', 'alertdialog');
  const panel = document.createElement('div');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = title;
  const list = document.createElement('ol');
  list.className = 'howto fatal-steps';
  for (const s of steps) {
    const li = document.createElement('li');
    li.textContent = s;
    list.appendChild(li);
  }
  panel.append(h, list);
  if (detail) {
    const p = document.createElement('p');
    p.className = 'muted fatal-detail';
    p.textContent = `기술 정보: ${detail}`;
    panel.appendChild(p);
  }
  wrap.appendChild(panel);
  document.body.appendChild(wrap);
}

const WEBGL_STEPS = [
  'Chrome, Edge, Firefox 최신 버전에서 실행해 주세요.',
  '브라우저 설정에서 "하드웨어 가속 사용"을 켠 뒤 브라우저를 다시 시작해 주세요. (Chrome: 설정 → 시스템)',
  '그래픽 드라이버를 최신 버전으로 업데이트해 주세요.',
  '원격 데스크톱·가상 머신에서는 WebGL 이 꺼져 있을 수 있습니다.',
];

if (!WebGL.isWebGL2Available()) {
  showFatal('이 브라우저에서 3D 그래픽(WebGL 2)을 사용할 수 없습니다', WEBGL_STEPS);
} else {
  try {
    const game = new Game(document.getElementById('app'));
    game.start();
    // 개발 모드에서만 콘솔 디버깅용으로 노출
    if (import.meta.env.DEV) window.__game = game;
    // 개발 서버 핫 리로드 시 이전 게임의 리소스·이벤트 해제
    if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
  } catch (err) {
    console.error(err);
    showFatal('게임을 시작하지 못했습니다', WEBGL_STEPS, err?.message ?? String(err));
  }
}
