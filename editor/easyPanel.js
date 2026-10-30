import { prefabs } from './project.js';
import { h } from './inspector.js';

// 쉬운 모드(어린이용) "꾸미기" 패널. 코드나 숫자 대신 색깔·크기 버튼·슬라이더만 보여준다.
const COLORS = ['#ff4d6d', '#ff8a3d', '#ffd84a', '#5cf2a0', '#4fc3f7', '#4f7cff', '#c17bff', '#ff8fc8', '#7a5236', '#3b3f58', '#ffffff', '#222222'];
const BACKGROUNDS = ['#9bd7ff', '#ffd6e8', '#fff3b0', '#c8f7c5', '#1b1f3b', '#14141c', '#ffb385', '#d9c2ff'];

// 컴포넌트 속성 중 아이들이 만져도 되는 것만 슬라이더로 노출한다.
const SLIDERS = {
  PlayerController: [
    { key: 'speed', label: '🏃 빠르기', min: 60, max: 320, left: '느리게', right: '빠르게' },
    { key: 'jump', label: '🦘 점프 높이', min: 300, max: 800, left: '낮게', right: '높게' },
  ],
  Patrol: [{ key: 'speed', label: '👣 움직이는 빠르기', min: 0, max: 160, left: '멈춤', right: '빠르게' }],
  Spring: [{ key: 'power', label: '🍄 튕기는 힘', min: 400, max: 1200, left: '약하게', right: '세게' }],
  Collectible: [{ key: 'score', label: '⭐ 점수', min: 1, max: 10, left: '1점', right: '10점' }],
};

export function renderEasyPanel(root, editor) {
  root.replaceChildren();
  const d = editor.selected;
  if (d) renderObject(root, editor, d);
  else renderStage(root, editor);
}

function swatches(colors, current, onPick) {
  return h('div', { class: 'swatches' }, colors.map((c) => h('button', {
    class: `swatch-btn ${c.toLowerCase() === (current || '').toLowerCase() ? 'active' : ''}`,
    style: `background:${c}`,
    title: c,
    'aria-label': `색깔 ${c}`,
    onclick: () => onPick(c),
  })));
}

function renderObject(root, editor, d) {
  const p = prefabs[d.prefab] || {};
  const rerender = () => { editor.commit(); renderEasyPanel(root, editor); editor.sceneView.draw(); };

  root.append(h('div', { class: 'easy-card head' },
    h('div', { class: 'big-emoji', style: d.emoji ? '' : `background:${d.color}` }, d.emoji || ''),
    h('div', {}, h('div', { class: 'title' }, p.label || d.name), p.tip ? h('div', { class: 'tip' }, p.tip) : null)));

  // 이모지가 없는 블록만 색을 바꿀 수 있다.
  if (!d.emoji) {
    root.append(h('div', { class: 'easy-card' }, h('div', { class: 'label' }, '🎨 색깔'),
      swatches(COLORS, d.color, (c) => { d.color = c; rerender(); })));
  }

  const g = editor.project.settings.grid;
  const resize = (dw, dh) => {
    const bottom = d.y + d.h;
    d.w = Math.max(4, Math.min(g * 20, d.w + dw));
    d.h = Math.max(4, Math.min(g * 20, d.h + dh));
    d.y = bottom - d.h; // 바닥에 붙어 있도록 아래쪽을 기준으로 키운다
    rerender();
  };
  root.append(h('div', { class: 'easy-card' },
    h('div', { class: 'label' }, '📏 크기'),
    h('div', { class: 'size-grid' },
      h('span', {}, '가로'),
      h('button', { class: 'big-btn', onclick: () => resize(-g / 2, 0) }, '➖'),
      h('button', { class: 'big-btn', onclick: () => resize(g / 2, 0) }, '➕'),
      h('span', {}, '세로'),
      h('button', { class: 'big-btn', onclick: () => resize(0, -g / 2) }, '➖'),
      h('button', { class: 'big-btn', onclick: () => resize(0, g / 2) }, '➕'))));

  for (const [type, sliders] of Object.entries(SLIDERS)) {
    const props = d.components?.[type];
    if (!props) continue;
    for (const s of sliders) {
      const input = h('input', {
        type: 'range', min: s.min, max: s.max, step: 1, value: props[s.key],
        oninput: () => { props[s.key] = Number(input.value); },
        onchange: () => editor.commit(),
      });
      root.append(h('div', { class: 'easy-card' },
        h('div', { class: 'label' }, s.label),
        input,
        h('div', { class: 'range-labels' }, h('span', {}, s.left), h('span', {}, s.right))));
    }
  }

  root.append(h('button', { class: 'big-btn danger wide', onclick: () => editor.deleteEntity(d) }, '🗑️ 이거 지우기'));
}

function renderStage(root, editor) {
  const s = editor.scene;
  const p = editor.project;
  root.append(
    h('div', { class: 'easy-card' }, h('div', { class: 'tip' }, '✋ 옮기기 도구로 화면에 있는 걸 누르면 색깔과 크기를 바꿀 수 있어요.')),
    h('div', { class: 'easy-card' }, h('div', { class: 'label' }, '🌈 배경 색깔'),
      swatches(BACKGROUNDS, s.background, (c) => { s.background = c; editor.commit(); renderEasyPanel(root, editor); })),
  );
  const name = h('input', {
    class: 'big-input', value: p.name, maxlength: 30,
    oninput: () => { p.name = name.value; editor.refreshTitle(); },
    onchange: () => editor.commit(),
  });
  root.append(h('div', { class: 'easy-card' }, h('div', { class: 'label' }, '✏️ 게임 이름'), name));
}
