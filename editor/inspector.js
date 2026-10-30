import { behaviors, defaultProps } from '../engine/behaviors.js';

// 작은 DOM 헬퍼
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

// 값 하나를 편집하는 입력 필드. onInput은 값이 바뀔 때마다, commit은 편집이 끝났을 때 호출된다.
function field(label, type, value, onInput, commit, extra = {}) {
  let input;
  if (type === 'bool') {
    input = h('input', { type: 'checkbox', onchange: () => { onInput(input.checked); commit(); } });
    input.checked = !!value;
  } else if (type === 'select') {
    input = h('select', { onchange: () => { onInput(input.value); commit(); } },
      extra.options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  } else if (type === 'code') {
    input = h('textarea', {
      class: 'code', spellcheck: 'false', rows: 14,
      oninput: () => onInput(input.value),
      onchange: commit,
      onkeydown: (e) => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const s = input.selectionStart;
        input.setRangeText('  ', s, input.selectionEnd, 'end');
        onInput(input.value);
      },
    });
    input.value = value ?? '';
  } else {
    const num = type === 'number';
    input = h('input', {
      type: type === 'color' ? 'color' : num ? 'number' : 'text',
      step: num ? 'any' : undefined,
      oninput: () => {
        if (num && input.value === '') return;
        onInput(num ? Number(input.value) : input.value);
      },
      onchange: commit,
    });
    input.value = value ?? '';
  }
  input.dataset.label = label;
  return h('label', { class: `field ${type === 'code' ? 'wide' : ''}` }, h('span', {}, label), input);
}

export class Inspector {
  constructor(root, editor) {
    this.root = root;
    this.editor = editor;
  }

  render() {
    this.root.replaceChildren();
    const sel = this.editor.selected;
    if (sel) this.renderEntity(sel);
    else this.renderSettings();
  }

  // 씬 뷰에서 드래그 중일 때 위치/크기 입력만 갱신한다.
  refreshValues() {
    const sel = this.editor.selected;
    if (!sel) return;
    for (const key of ['x', 'y', 'w', 'h']) {
      const el = this.root.querySelector(`[data-key="${key}"] input`);
      if (el && document.activeElement !== el) el.value = sel[key];
    }
  }

  renderEntity(d) {
    const ed = this.editor;
    const upd = (key) => (v) => { d[key] = v; ed.onEntityEdited(key); };
    const commit = () => ed.commit();

    const base = h('section', { class: 'panel-section' },
      h('h3', {}, '오브젝트'),
      field('이름', 'text', d.name, upd('name'), commit),
      h('div', { class: 'row' },
        tagged('x', field('X', 'number', d.x, upd('x'), commit)),
        tagged('y', field('Y', 'number', d.y, upd('y'), commit))),
      h('div', { class: 'row' },
        tagged('w', field('너비', 'number', d.w, upd('w'), commit)),
        tagged('h', field('높이', 'number', d.h, upd('h'), commit))),
      h('div', { class: 'row' },
        field('색상', 'color', d.color, upd('color'), commit),
        field('모양', 'select', d.shape, upd('shape'), commit, { options: [['rect', '사각형'], ['circle', '원']] })),
      h('div', { class: 'row' },
        field('Z 순서', 'number', d.z || 0, upd('z'), commit),
        field('보이기', 'bool', d.visible !== false, upd('visible'), commit)),
      field('태그 (쉼표 구분)', 'text', (d.tags || []).join(', '),
        (v) => { d.tags = v.split(',').map((t) => t.trim()).filter(Boolean); }, commit),
    );
    this.root.append(base);

    for (const [type, props] of Object.entries(d.components || {})) {
      const def = behaviors[type];
      if (!def) continue;
      const sec = h('section', { class: 'panel-section component' },
        h('h3', {}, def.label, h('small', {}, type),
          h('button', { class: 'icon', title: '컴포넌트 제거', onclick: () => {
            delete d.components[type];
            ed.commit();
            this.render();
            ed.sceneView.draw();
          } }, '✕')));
      for (const f of def.fields) {
        const set = (v) => { props[f.key] = v; };
        if (f.type === 'scene') {
          const opts = [['', '(다음 순서)'], ...ed.project.scenes.map((s) => [s.name, s.name])];
          sec.append(field(f.label, 'select', props[f.key] ?? '', set, commit, { options: opts }));
        } else {
          sec.append(field(f.label, f.type, props[f.key] ?? f.default, set, commit));
        }
      }
      this.root.append(sec);
    }

    const available = Object.keys(behaviors).filter((t) => !d.components?.[t]);
    if (available.length) {
      const select = h('select', {}, h('option', { value: '' }, '컴포넌트 추가…'),
        available.map((t) => h('option', { value: t }, behaviors[t].label)));
      select.addEventListener('change', () => {
        if (!select.value) return;
        d.components = d.components || {};
        d.components[select.value] = defaultProps(select.value);
        ed.commit();
        this.render();
        ed.sceneView.draw();
      });
      this.root.append(h('section', { class: 'panel-section' }, select));
    }
  }

  renderSettings() {
    const ed = this.editor;
    const p = ed.project;
    const s = ed.scene;
    const commit = () => ed.commit();
    const redraw = () => ed.sceneView.draw();

    this.root.append(
      h('p', { class: 'hint' }, '오브젝트를 선택하면 속성을 편집할 수 있습니다.'),
      h('section', { class: 'panel-section' },
        h('h3', {}, '씬 설정'),
        field('씬 이름', 'text', s.name, (v) => {
          const old = s.name;
          s.name = v;
          ed.renameSceneRefs(old, v);
          ed.refreshScenes();
        }, commit),
        field('배경색', 'color', s.background, (v) => { s.background = v; redraw(); }, commit),
      ),
      h('section', { class: 'panel-section' },
        h('h3', {}, '프로젝트 설정'),
        field('게임 이름', 'text', p.name, (v) => { p.name = v; ed.refreshTitle(); }, commit),
        h('div', { class: 'row' },
          field('화면 너비', 'number', p.settings.width, (v) => { p.settings.width = v; redraw(); }, commit),
          field('화면 높이', 'number', p.settings.height, (v) => { p.settings.height = v; redraw(); }, commit)),
        h('div', { class: 'row' },
          field('중력', 'number', p.settings.gravity, (v) => { p.settings.gravity = v; }, commit),
          field('격자 크기', 'number', p.settings.grid, (v) => { if (v > 0) { p.settings.grid = v; redraw(); } }, commit)),
        field('시작 씬', 'select', p.settings.startScene, (v) => { p.settings.startScene = v; }, commit,
          { options: p.scenes.map((sc) => [sc.name, sc.name]) }),
      ),
    );
  }
}

function tagged(key, el) {
  el.dataset.key = key;
  return el;
}
