import { Engine } from '../engine/Engine.js';
import { GameScene } from '../engine/GameRuntime.js';
import { prefabs, instantiate, createDefaultProject, createScene, History, newId } from './project.js';
import { SceneView, isTyping } from './sceneView.js';
import { Inspector, h } from './inspector.js';
import { loadEngineSources, bundleEngine, buildGameHtml } from './exporter.js';

const STORAGE_KEY = 'hub-engine:project';
const $ = (sel) => document.querySelector(sel);

class Editor {
  constructor() {
    this.project = this.loadAutosave() || createDefaultProject();
    this.sceneIndex = 0;
    this.selectedId = null;
    this.tool = 'select';
    this.brush = 'wall';
    this.snap = true;
    this.showGrid = true;
    this.showViewport = true;
    this.history = new History();
    this.history.push(JSON.stringify(this.project));
    this.engine = null;

    this.sceneView = new SceneView($('#scene-canvas'), this);
    this.inspector = new Inspector($('#inspector'), this);

    this.bindToolbar();
    this.bindShortcuts();
    this.refreshAll();
    this.log('에디터 준비 완료. 왼쪽 프리팹을 골라 칠하기(B)로 레벨을 그리고 ▶ 실행(F5)으로 테스트하세요.', 'ok');
  }

  // ---- 상태 ----
  get scene() { return this.project.scenes[this.sceneIndex]; }
  get selected() { return this.scene.entities.find((d) => d.id === this.selectedId) || null; }

  select(d) {
    this.selectedId = d ? d.id : null;
    this.refreshHierarchy();
    this.inspector.render();
    this.sceneView.draw();
  }

  // 변경 사항을 실행 취소 기록과 자동 저장에 반영한다.
  commit() {
    const snap = JSON.stringify(this.project);
    this.history.push(snap);
    try { localStorage.setItem(STORAGE_KEY, snap); } catch { /* 저장 공간 없음: 무시 */ }
    this.refreshHierarchy();
    this.sceneView.draw();
  }

  restore(snapshot) {
    if (!snapshot) return;
    this.project = JSON.parse(snapshot);
    this.sceneIndex = Math.min(this.sceneIndex, this.project.scenes.length - 1);
    try { localStorage.setItem(STORAGE_KEY, snapshot); } catch { /* 무시 */ }
    this.refreshAll();
  }

  undo() { this.restore(this.history.undo()); }
  redo() { this.restore(this.history.redo()); }

  loadAutosave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const p = raw && JSON.parse(raw);
      return p?.scenes?.length ? p : null;
    } catch {
      return null;
    }
  }

  onEntityEdited(key) {
    this.sceneView.draw();
    if (key === 'name' || key === 'color') this.refreshHierarchy();
  }

  refreshInspectorValues() { this.inspector.refreshValues(); }

  // ---- 패널 ----
  refreshAll() {
    this.refreshTitle();
    this.refreshScenes();
    this.refreshPalette();
    this.refreshHierarchy();
    this.refreshTools();
    this.inspector.render();
    this.sceneView.draw();
  }

  refreshTitle() {
    $('#project-title').textContent = this.project.name;
    document.title = `${this.project.name} — Hub Engine`;
  }

  refreshScenes() {
    const list = $('#scene-list');
    list.replaceChildren(...this.project.scenes.map((s, i) => h('li', {
      class: i === this.sceneIndex ? 'selected' : '',
      onclick: () => this.switchScene(i),
    },
    h('span', { class: 'name' }, (s.name === this.project.settings.startScene ? '▸ ' : '') + s.name),
    h('span', { class: 'meta' }, String(s.entities.length)),
    h('span', { class: 'actions' },
      h('button', { class: 'icon', title: '복제', onclick: (e) => { e.stopPropagation(); this.duplicateScene(i); } }, '⧉'),
      h('button', { class: 'icon', title: '삭제', onclick: (e) => { e.stopPropagation(); this.deleteScene(i); } }, '✕')))));
  }

  refreshPalette() {
    $('#palette').replaceChildren(...Object.entries(prefabs).map(([key, p]) => h('button', {
      class: key === this.brush ? 'active' : '',
      title: `${p.label} — 칠하기 브러시로 선택 (더블클릭: 화면 중앙에 배치)`,
      onclick: () => { this.brush = key; this.setTool('paint'); this.refreshPalette(); },
      ondblclick: () => this.placeAtCenter(key),
    }, h('span', { class: 'swatch', style: `background:${p.color};${p.shape === 'circle' ? 'border-radius:50%' : ''}` }), p.label)));
  }

  refreshHierarchy() {
    const ents = this.scene.entities;
    $('#entity-count').textContent = `${ents.length}개`;
    $('#hierarchy').replaceChildren(...ents.map((d) => h('li', {
      class: d.id === this.selectedId ? 'selected' : '',
      onclick: () => this.select(d),
      ondblclick: () => this.sceneView.focus(d),
    },
    h('span', { class: 'swatch', style: `background:${d.color}` }),
    h('span', { class: 'name' }, d.name),
    h('span', { class: 'meta' }, Object.keys(d.components || {}).length ? '◆' : ''),
    h('span', { class: 'actions' },
      h('button', { class: 'icon', title: '삭제', onclick: (e) => { e.stopPropagation(); this.deleteEntity(d); } }, '✕')))));
    $('#hierarchy .selected')?.scrollIntoView({ block: 'nearest' });
  }

  refreshTools() {
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === this.tool));
    $('#scene-canvas').style.cursor = this.tool === 'select' ? 'default' : 'crosshair';
  }

  setTool(tool) {
    this.tool = tool;
    this.refreshTools();
    this.sceneView.draw();
  }

  setStatus(text) { $('#status').textContent = text; }

  log(msg, type = '') {
    const con = $('#console');
    const time = new Date().toLocaleTimeString();
    con.append(h('div', { class: `line ${type}` }, h('span', { class: 'time' }, time), msg));
    while (con.childElementCount > 300) con.firstChild.remove();
    con.scrollTop = con.scrollHeight;
  }

  // ---- 엔티티 ----
  placeAtCenter(key) {
    const c = this.sceneView.canvas.getBoundingClientRect();
    const cam = this.sceneView.cam;
    const g = this.project.settings.grid;
    const cx = Math.floor((cam.x + c.width / 2 / cam.zoom) / g);
    const cy = Math.floor((cam.y + c.height / 2 / cam.zoom) / g);
    const d = instantiate(key, cx, cy, g);
    this.scene.entities.push(d);
    this.setTool('select');
    this.commit();
    this.select(d);
  }

  deleteEntity(d) {
    const i = this.scene.entities.indexOf(d);
    if (i < 0) return;
    this.scene.entities.splice(i, 1);
    if (this.selectedId === d.id) this.selectedId = null;
    this.commit();
    this.inspector.render();
  }

  duplicateSelected() {
    const d = this.selected;
    if (!d) return;
    const copy = { ...structuredClone(d), id: newId(), x: d.x + this.project.settings.grid };
    this.scene.entities.push(copy);
    this.commit();
    this.select(copy);
  }

  // ---- 씬 ----
  switchScene(i) {
    this.sceneIndex = i;
    this.selectedId = null;
    this.refreshAll();
  }

  uniqueSceneName(base) {
    const names = new Set(this.project.scenes.map((s) => s.name));
    let n = this.project.scenes.length + 1;
    let name = `${base} ${n}`;
    while (names.has(name)) name = `${base} ${++n}`;
    return name;
  }

  addScene() {
    const s = createScene(this.uniqueSceneName('Level'));
    this.project.scenes.push(s);
    this.commit();
    this.switchScene(this.project.scenes.length - 1);
  }

  duplicateScene(i) {
    const copy = structuredClone(this.project.scenes[i]);
    copy.name = this.uniqueSceneName(copy.name.replace(/\s*\d+$/, '') || 'Level');
    copy.entities.forEach((d) => { d.id = newId(); });
    this.project.scenes.splice(i + 1, 0, copy);
    this.commit();
    this.switchScene(i + 1);
  }

  deleteScene(i) {
    if (this.project.scenes.length === 1) return this.log('씬은 최소 한 개 있어야 합니다.', 'error');
    const s = this.project.scenes[i];
    if (!confirm(`"${s.name}" 씬을 삭제할까요? (실행 취소 가능)`)) return;
    this.project.scenes.splice(i, 1);
    if (this.project.settings.startScene === s.name) this.project.settings.startScene = this.project.scenes[0].name;
    this.sceneIndex = Math.min(this.sceneIndex, this.project.scenes.length - 1);
    this.commit();
    this.switchScene(this.sceneIndex);
  }

  // 씬 이름이 바뀌면 시작 씬과 Goal 컴포넌트의 참조도 함께 바꾼다.
  renameSceneRefs(oldName, newName) {
    if (this.project.settings.startScene === oldName) this.project.settings.startScene = newName;
    for (const s of this.project.scenes) {
      for (const d of s.entities) {
        if (d.components?.Goal?.next === oldName) d.components.Goal.next = newName;
      }
    }
  }

  // ---- 파일 ----
  newProject() {
    if (!confirm('새 프로젝트를 만들까요? 저장하지 않은 내용은 사라집니다. (현재 프로젝트는 "저장"으로 파일에 보관하세요)')) return;
    this.project = createDefaultProject();
    this.sceneIndex = 0;
    this.selectedId = null;
    this.commit();
    this.refreshAll();
    this.log('새 프로젝트를 만들었습니다.', 'ok');
  }

  saveFile() {
    download(`${safeName(this.project.name)}.json`, JSON.stringify(this.project, null, 2), 'application/json');
    this.log('프로젝트 파일을 저장했습니다.', 'ok');
  }

  openFile() {
    const input = $('#file-input');
    input.value = '';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const p = JSON.parse(await file.text());
        if (!Array.isArray(p.scenes) || !p.scenes.length || !p.settings) throw new Error('프로젝트 형식이 아닙니다');
        this.project = p;
        this.sceneIndex = 0;
        this.selectedId = null;
        this.commit();
        this.refreshAll();
        this.log(`"${file.name}" 을(를) 열었습니다.`, 'ok');
      } catch (err) {
        this.log(`파일을 열 수 없습니다: ${err.message}`, 'error');
      }
    };
    input.click();
  }

  async exportGame() {
    try {
      const code = bundleEngine(await loadEngineSources());
      download(`${safeName(this.project.name)}.html`, buildGameHtml(this.project, code), 'text/html');
      this.log('게임을 HTML 파일 하나로 내보냈습니다. 더블클릭하면 브라우저에서 바로 실행됩니다.', 'ok');
    } catch (err) {
      this.log(`내보내기 실패: ${err.message}`, 'error');
    }
  }

  // ---- 실행 ----
  togglePlay() {
    if (this.engine) this.stop();
    else this.play();
  }

  play() {
    document.activeElement?.blur();
    const { width, height } = this.project.settings;
    const overlay = $('#game-overlay');
    overlay.hidden = false;
    const canvas = $('#game-canvas');
    const fit = () => {
      const r = overlay.getBoundingClientRect();
      const w = Math.min(r.width - 32, (r.height - 60) * (width / height));
      canvas.style.width = `${Math.max(100, w)}px`;
    };
    fit();
    this._fit = fit;
    window.addEventListener('resize', fit);

    const project = structuredClone(this.project);
    this.engine = new Engine(canvas, { width, height });
    this.engine.start(new GameScene(project, this.sceneIndex, { log: (m, t) => this.log(m, t) }));
    const btn = $('[data-action="play"]');
    btn.textContent = '■ 정지';
    btn.classList.add('running');
    this.log(`"${this.scene.name}" 실행`, 'ok');
  }

  stop() {
    if (!this.engine) return;
    this.engine.destroy();
    this.engine = null;
    window.removeEventListener('resize', this._fit);
    $('#game-overlay').hidden = true;
    const btn = $('[data-action="play"]');
    btn.textContent = '▶ 실행';
    btn.classList.remove('running');
    this.log('실행 정지');
  }

  // ---- 입력 바인딩 ----
  bindToolbar() {
    const actions = {
      new: () => this.newProject(),
      open: () => this.openFile(),
      save: () => this.saveFile(),
      export: () => this.exportGame(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      play: () => this.togglePlay(),
      'add-scene': () => this.addScene(),
      'clear-console': () => $('#console').replaceChildren(),
    };
    document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.action]?.()));
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    $('#opt-snap').addEventListener('change', (e) => { this.snap = e.target.checked; });
    $('#opt-grid').addEventListener('change', (e) => { this.showGrid = e.target.checked; this.sceneView.draw(); });
    $('#opt-viewport').addEventListener('change', (e) => { this.showViewport = e.target.checked; this.sceneView.draw(); });
  }

  bindShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (this.engine) {
        if (e.key === 'Escape' || e.key === 'F5') { e.preventDefault(); this.stop(); }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F5') { e.preventDefault(); return this.play(); }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return this.saveFile(); }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); return this.openFile(); }
      if (isTyping()) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? this.redo() : this.undo(); }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return this.redo(); }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); return this.duplicateSelected(); }
      if (mod) return;
      const sel = this.selected;
      switch (e.key) {
        case 'v': case 'V': return this.setTool('select');
        case 'b': case 'B': return this.setTool('paint');
        case 'e': case 'E': return this.setTool('erase');
        case 'f': case 'F': return sel && this.sceneView.focus(sel);
        case 'Delete': case 'Backspace': return sel && this.deleteEntity(sel);
        case 'Escape': return this.select(null);
      }
      // 방향키로 선택한 오브젝트를 한 칸(Shift: 1픽셀)씩 이동
      const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (sel && dirs[e.key]) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : this.project.settings.grid;
        sel.x += dirs[e.key][0] * step;
        sel.y += dirs[e.key][1] * step;
        this.commit();
        this.inspector.refreshValues();
      }
    });
  }
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s) => (s || 'game').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'game';

window.editor = new Editor();
