import { instantiate } from './project.js';

const HANDLE = 8;

// 씬 편집 캔버스: 격자, 이동/확대, 선택·드래그·크기 조절, 타일 칠하기/지우기.
export class SceneView {
  constructor(canvas, editor) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.editor = editor;
    this.cam = { x: -32, y: -32, zoom: 2 };
    this.drag = null;
    this.hoverCell = null;
    this.spaceDown = false;

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mouseleave', () => { this.hoverCell = null; this.draw(); });
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping()) this.spaceDown = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.dpr = dpr;
    this.draw();
  }

  get grid() { return this.editor.project.settings.grid || 16; }
  get scene() { return this.editor.scene; }

  toWorld(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / this.cam.zoom + this.cam.x,
      y: (e.clientY - r.top) / this.cam.zoom + this.cam.y,
    };
  }

  cellAt(p) { return { cx: Math.floor(p.x / this.grid), cy: Math.floor(p.y / this.grid) }; }

  // 위에 그려진(z가 높고 나중에 추가된) 엔티티부터 찾는다.
  entityAt(p) {
    const list = this.sortedEntities();
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (p.x >= d.x && p.x < d.x + d.w && p.y >= d.y && p.y < d.y + d.h) return d;
    }
    return null;
  }

  sortedEntities() {
    return this.scene.entities.map((d, i) => [d, i]).sort((a, b) => (a[0].z || 0) - (b[0].z || 0) || a[1] - b[1]).map((x) => x[0]);
  }

  snap(v) { return this.editor.snap ? Math.round(v / this.grid) * this.grid : Math.round(v); }

  onDown(e) {
    const p = this.toWorld(e);
    if (e.button === 1 || e.button === 2 || this.spaceDown) {
      this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
      return;
    }
    if (e.button !== 0) return;
    const tool = this.editor.tool;

    if (tool === 'paint') {
      this.drag = { mode: 'paint', changed: false };
      this.paintAt(p);
      return;
    }
    if (tool === 'erase') {
      this.drag = { mode: 'erase', changed: false };
      this.eraseAt(p);
      return;
    }

    const sel = this.editor.selected;
    if (sel && Math.abs(p.x - (sel.x + sel.w)) * this.cam.zoom < HANDLE && Math.abs(p.y - (sel.y + sel.h)) * this.cam.zoom < HANDLE) {
      this.drag = { mode: 'resize', target: sel, changed: false };
      return;
    }
    const hit = this.entityAt(p);
    this.editor.select(hit);
    if (hit) this.drag = { mode: 'move', target: hit, ox: p.x - hit.x, oy: p.y - hit.y, changed: false };
  }

  onMove(e) {
    const p = this.toWorld(e);
    if (e.target === this.canvas) {
      this.hoverCell = this.cellAt(p);
      this.editor.setStatus(`x ${Math.floor(p.x)}, y ${Math.floor(p.y)}  ·  칸 ${this.hoverCell.cx}, ${this.hoverCell.cy}  ·  ${Math.round(this.cam.zoom * 100)}%`);
    }
    const d = this.drag;
    if (!d) return this.editor.tool !== 'select' && this.draw();

    if (d.mode === 'pan') {
      this.cam.x = d.cx - (e.clientX - d.sx) / this.cam.zoom;
      this.cam.y = d.cy - (e.clientY - d.sy) / this.cam.zoom;
    } else if (d.mode === 'move') {
      const nx = this.snap(p.x - d.ox);
      const ny = this.snap(p.y - d.oy);
      if (nx !== d.target.x || ny !== d.target.y) {
        d.target.x = nx;
        d.target.y = ny;
        d.changed = true;
        this.editor.refreshInspectorValues();
      }
    } else if (d.mode === 'resize') {
      const t = d.target;
      const nw = Math.max(1, this.snap(p.x) - t.x);
      const nh = Math.max(1, this.snap(p.y) - t.y);
      if (nw !== t.w || nh !== t.h) {
        t.w = nw;
        t.h = nh;
        d.changed = true;
        this.editor.refreshInspectorValues();
      }
    } else if (d.mode === 'paint') {
      this.paintAt(p);
    } else if (d.mode === 'erase') {
      this.eraseAt(p);
    }
    this.draw();
  }

  onUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.changed) this.editor.commit();
    if (d.mode === 'paint' || d.mode === 'erase') this.editor.refreshHierarchy();
  }

  paintAt(p) {
    const { cx, cy } = this.cellAt(p);
    const key = this.editor.brush;
    const g = this.grid;
    const exists = this.scene.entities.some((d) => d.prefab === key && Math.floor(d.x / g) === cx && Math.floor((d.y + d.h - 1) / g) === cy);
    if (exists) return;
    this.scene.entities.push(instantiate(key, cx, cy, g));
    this.drag.changed = true;
    this.draw();
  }

  eraseAt(p) {
    const hit = this.entityAt(p);
    if (!hit) return;
    this.scene.entities.splice(this.scene.entities.indexOf(hit), 1);
    if (this.editor.selected === hit) this.editor.select(null);
    this.drag.changed = true;
    this.draw();
  }

  onWheel(e) {
    e.preventDefault();
    const before = this.toWorld(e);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.cam.zoom = Math.min(16, Math.max(0.25, this.cam.zoom * factor));
    const after = this.toWorld(e);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.draw();
  }

  focus(d) {
    const r = this.canvas.getBoundingClientRect();
    this.cam.x = d.x + d.w / 2 - r.width / 2 / this.cam.zoom;
    this.cam.y = d.y + d.h / 2 - r.height / 2 / this.cam.zoom;
    this.draw();
  }

  draw() {
    const { ctx, cam } = this;
    const dpr = this.dpr || 1;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    const scene = this.scene;
    if (!scene) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = scene.background || '#14141c';
    ctx.fillRect(0, 0, W, H);

    ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
    ctx.imageSmoothingEnabled = false;

    // 격자
    const g = this.grid;
    if (this.editor.showGrid && g * cam.zoom >= 4) {
      const x0 = Math.floor(cam.x / g) * g;
      const y0 = Math.floor(cam.y / g) * g;
      const x1 = cam.x + W / cam.zoom;
      const y1 = cam.y + H / cam.zoom;
      ctx.lineWidth = 1 / cam.zoom;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      for (let x = x0; x <= x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let y = y0; y <= y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.beginPath();
      ctx.moveTo(0, y0); ctx.lineTo(0, y1);
      ctx.moveTo(x0, 0); ctx.lineTo(x1, 0);
      ctx.stroke();
    }

    for (const d of this.sortedEntities()) {
      ctx.globalAlpha = d.visible === false ? 0.35 : 1;
      ctx.fillStyle = d.color || '#fff';
      if (d.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(d.x + d.w / 2, d.y + d.h / 2, Math.min(d.w, d.h) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(d.x, d.y, d.w, d.h);
      }
      if (d.components?.Script) {
        ctx.fillStyle = '#ffffffaa';
        ctx.font = `${8}px monospace`;
        ctx.fillText('{}', d.x + 1, d.y + 8);
      }
    }
    ctx.globalAlpha = 1;

    // 게임 화면 크기 미리보기 (플레이어 기준)
    const player = scene.entities.find((d) => d.components?.PlayerController);
    if (player && this.editor.showViewport) {
      const { width, height } = this.editor.project.settings;
      ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom]);
      ctx.strokeStyle = 'rgba(127,209,255,0.35)';
      ctx.lineWidth = 1 / cam.zoom;
      ctx.strokeRect(player.x + player.w / 2 - width / 2, player.y + player.h / 2 - height / 2, width, height);
      ctx.setLineDash([]);
    }

    // 브러시 미리보기
    if (this.editor.tool !== 'select' && this.hoverCell) {
      const { cx, cy } = this.hoverCell;
      ctx.lineWidth = 1 / cam.zoom;
      ctx.strokeStyle = this.editor.tool === 'erase' ? '#ff5470' : '#ffffffaa';
      ctx.strokeRect(cx * g, cy * g, g, g);
    }

    const sel = this.editor.selected;
    if (sel && scene.entities.includes(sel)) {
      ctx.lineWidth = 2 / cam.zoom;
      ctx.strokeStyle = '#4da3ff';
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      const hs = HANDLE / cam.zoom;
      ctx.fillStyle = '#4da3ff';
      ctx.fillRect(sel.x + sel.w - hs / 2, sel.y + sel.h - hs / 2, hs, hs);
    }
  }
}

export function isTyping() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
