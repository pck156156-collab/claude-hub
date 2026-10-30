import { Engine } from '../engine/Engine.js';
import { TouchControls } from '../engine/TouchControls.js';
import { GameScene } from '../engine/GameRuntime.js';
import { prefabs, instantiate, createDefaultProject, createScene, History, newId } from './project.js';
import { SceneView, isTyping } from './sceneView.js';
import { Inspector, h } from './inspector.js';
import { loadEngineSources, bundleEngine, buildGameHtml } from './exporter.js';
import { renderEasyPanel } from './easyPanel.js';

const STORAGE_KEY = 'hub-engine:project';
const MODE_KEY = 'hub-engine:mode';
const $ = (sel) => document.querySelector(sel);

class Editor {
  constructor() {
    this.project = this.loadAutosave() || createDefaultProject();
    this.sceneIndex = 0;
    this.selectedId = null;
    this.easy = readMode() !== 'pro';
    this.tool = this.easy ? 'paint' : 'select';
    this.brush = 'wall';
    this.playedOnce = false;
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
    document.body.classList.toggle('easy', this.easy);
    this.refreshAll();
    this.log('에디터 준비 완료. 왼쪽 프리팹을 골라 칠하기(B)로 레벨을 그리고 ▶ 실행(F5)으로 테스트하세요.', 'ok');
  }

  // 쉬운 모드(어린이용) ↔ 전문가 모드
  setMode(easy) {
    this.easy = easy;
    document.body.classList.toggle('easy', easy);
    try { localStorage.setItem(MODE_KEY, easy ? 'easy' : 'pro'); } catch { /* 무시 */ }
    this.refreshAll();
    requestAnimationFrame(() => this.sceneView.resize());
  }

  renderPanel() {
    if (this.easy) renderEasyPanel($('#easy-panel'), this);
    else this.inspector.render();
  }

  // 쉬운 모드 아래쪽 도우미: 무엇을 하면 되는지 단계별로 알려준다.
  updateHelper(message, type = '') {
    const ents = this.scene.entities;
    const has = (c) => ents.some((d) => d.components?.[c]);
    const steps = [
      { text: '🧱 땅 그리기', done: ents.filter((d) => d.components?.Solid).length >= 3, hint: '왼쪽에서 "땅"을 고르고 화면에 쓱쓱 그려 보세요!' },
      { text: '😊 주인공 놓기', done: has('PlayerController'), hint: '"주인공"을 골라 땅 위에 콕 놓아 보세요.' },
      { text: '🚩 깃발 놓기', done: has('Goal'), hint: '"깃발"을 놓으면 거기가 도착 지점이에요.' },
      { text: '⭐ 별·괴물 놓기', done: has('Collectible') || has('Hazard'), hint: '별이나 괴물, 가시를 놓아서 재미있게 만들어요.' },
      { text: '▶ 놀아 보기', done: this.playedOnce, hint: '위쪽 초록색 "▶ 놀이하기" 버튼을 눌러 보세요!' },
    ];
    const current = steps.find((st) => !st.done);
    $('#helper-steps').replaceChildren(...steps.map((st) => h('li', { class: st.done ? 'done' : st === current ? 'current' : '' }, (st.done ? '✅ ' : '') + st.text)));
    const msg = $('#helper-message');
    msg.className = `helper-message ${message ? type : current ? '' : 'ok'}`;
    msg.textContent = message || (current ? current.hint : '🎉 멋진 게임이에요! 새 단계(＋)를 만들거나 "🎁 게임 파일 만들기"로 친구에게 보여 주세요.');
  }

  // 쉬운 모드에서는 도우미가, 전문가 모드에서는 콘솔이 알려준다.
  say(message, type = '') {
    if (this.easy) this.updateHelper(message, type);
    this.log(message, type);
  }

  removePlayers() {
    const s = this.scene;
    s.entities = s.entities.filter((d) => !d.components?.PlayerController);
  }

  // ---- 상태 ----
  get scene() { return this.project.scenes[this.sceneIndex]; }
  get selected() { return this.scene.entities.find((d) => d.id === this.selectedId) || null; }

  select(d) {
    this.selectedId = d ? d.id : null;
    this.refreshHierarchy();
    this.renderPanel();
    this.sceneView.draw();
  }

  // 변경 사항을 실행 취소 기록과 자동 저장에 반영한다.
  commit() {
    const snap = JSON.stringify(this.project);
    this.history.push(snap);
    try { localStorage.setItem(STORAGE_KEY, snap); } catch { /* 저장 공간 없음: 무시 */ }
    this.refreshHierarchy();
    this.refreshScenes();
    this.updateHelper();
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

  refreshInspectorValues() { if (!this.easy) this.inspector.refreshValues(); }

  // ---- 패널 ----
  refreshAll() {
    this.refreshTitle();
    this.refreshScenes();
    this.refreshPalette();
    this.refreshHierarchy();
    this.refreshTools();
    this.renderPanel();
    this.updateHelper();
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
    const entries = Object.entries(prefabs).filter(([, p]) => !(this.easy && p.proOnly));
    $('#palette').replaceChildren(...entries.map(([key, p]) => h('button', {
      class: key === this.brush && this.tool === 'paint' ? 'active' : '',
      title: this.easy ? p.tip : `${p.label} — 칠하기 브러시로 선택 (더블클릭: 화면 중앙에 배치)`,
      onclick: () => { this.brush = key; this.setTool('paint'); },
      ondblclick: () => this.placeAtCenter(key),
    },
    p.emoji
      ? h('span', { class: 'emoji' }, p.emoji)
      : h('span', { class: `swatch ${p.shape || ''}`, style: `background:${p.color};${p.shape === 'circle' ? 'border-radius:50%' : ''}` }),
    p.label)));
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
    this.refreshPalette();
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
    if (key === 'player') this.removePlayers();
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
    this.renderPanel();
  }

  duplicateSelected() {
    const d = this.selected;
    if (!d || d.components?.PlayerController) return;
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

  uniqueSceneName() {
    const names = new Set(this.project.scenes.map((s) => s.name));
    let n = this.project.scenes.length + 1;
    while (names.has(`${n}단계`)) n++;
    return `${n}단계`;
  }

  addScene() {
    const s = createScene(this.uniqueSceneName());
    this.project.scenes.push(s);
    this.commit();
    this.switchScene(this.project.scenes.length - 1);
  }

  duplicateScene(i) {
    const copy = structuredClone(this.project.scenes[i]);
    copy.name = this.uniqueSceneName();
    copy.entities.forEach((d) => { d.id = newId(); });
    this.project.scenes.splice(i + 1, 0, copy);
    this.commit();
    this.switchScene(i + 1);
  }

  deleteScene(i) {
    if (this.project.scenes.length === 1) return this.say('단계(씬)는 최소 한 개 있어야 해요.', 'error');
    const s = this.project.scenes[i];
    if (!confirm(`"${s.name}"을(를) 지울까요? (↩️ 되돌리기로 다시 살릴 수 있어요)`)) return;
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
    if (!confirm('처음부터 새로 만들까요?\n지금 만든 게임은 사라져요. (먼저 "💾 저장"을 누르면 파일로 남길 수 있어요)')) return;
    this.project = createDefaultProject();
    this.sceneIndex = 0;
    this.selectedId = null;
    this.commit();
    this.refreshAll();
    this.say('새 게임을 시작했어요! 🎉', 'ok');
  }

  saveFile() {
    download(`${safeName(this.project.name)}.json`, JSON.stringify(this.project, null, 2), 'application/json');
    this.say('💾 저장했어요! 다운로드 폴더에 파일이 생겼어요.', 'ok');
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
        this.say(`📂 "${file.name}" 을(를) 불러왔어요.`, 'ok');
      } catch (err) {
        this.say(`이 파일은 열 수 없어요 😢 (${err.message})`, 'error');
      }
    };
    input.click();
  }

  async exportGame() {
    try {
      const code = bundleEngine(await loadEngineSources());
      download(`${safeName(this.project.name)}.html`, buildGameHtml(this.project, code), 'text/html');
      this.say('🎁 게임 파일을 만들었어요! 다운로드된 파일을 더블클릭하면 바로 놀 수 있어요.', 'ok');
    } catch (err) {
      this.say(`게임 파일을 만들지 못했어요 😢 (${err.message})`, 'error');
    }
  }

  // ---- 실행 ----
  togglePlay() {
    if (this.engine) this.stop();
    else this.play();
  }

  play() {
    if (!this.scene.entities.some((d) => d.components?.PlayerController)) {
      return this.say('😊 주인공이 없어요! 왼쪽에서 "주인공"을 골라 화면에 놓아 주세요.', 'error');
    }
    document.activeElement?.blur();
    const { width, height } = this.project.settings;
    const overlay = $('#game-overlay');
    overlay.hidden = false;
    document.body.classList.add('playing');
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
    if (this.easy || matchMedia('(pointer: coarse)').matches) this.touch = new TouchControls(this.engine.input, $('#touch-area'));
    this.playedOnce = true;
    const btn = $('[data-action="play"]');
    this._playLabel = btn.innerHTML;
    btn.innerHTML = '<span class="easy-only tb"><i>⏹️</i>그만하기</span><span class="pro-only">■ 정지</span>';
    btn.classList.add('running');
    this.log(`"${this.scene.name}" 실행`, 'ok');
  }

  stop() {
    if (!this.engine) return;
    this.engine.destroy();
    this.engine = null;
    this.touch?.destroy();
    this.touch = null;
    this.updateHelper();
    window.removeEventListener('resize', this._fit);
    $('#game-overlay').hidden = true;
    document.body.classList.remove('playing');
    const btn = $('[data-action="play"]');
    btn.innerHTML = this._playLabel;
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
      stop: () => this.stop(),
      mode: () => this.setMode(!this.easy),
      'zoom-in': () => this.sceneView.zoomAt(1.25),
      'zoom-out': () => this.sceneView.zoomAt(0.8),
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

function readMode() {
  try { return localStorage.getItem(MODE_KEY); } catch { return null; }
}

const safeName = (s) => (s || 'game').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'game';

window.editor = new Editor();
