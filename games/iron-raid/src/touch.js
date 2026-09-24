// On-screen buttons for touch devices. They press the same virtual keys the game reads.
const BUTTONS = [
  { id: 'left', label: '◀', area: 'pad', col: 1, row: 2 },
  { id: 'right', label: '▶', area: 'pad', col: 3, row: 2 },
  { id: 'up', label: '▲', area: 'pad', col: 2, row: 1 },
  { id: 'down', label: '▼', area: 'pad', col: 2, row: 3 },
  { id: 'bomb', label: 'BOMB', area: 'act', col: 1, row: 1 },
  { id: 'jump', label: 'JUMP', area: 'act', col: 2, row: 2 },
  { id: 'fire', label: 'FIRE', area: 'act', col: 1, row: 2 },
];

export function setupTouch() {
  if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;
  const style = document.createElement('style');
  style.textContent = `
    .ir-touch { position: fixed; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); display: grid;
      grid-template-columns: repeat(3, 52px); grid-template-rows: repeat(3, 52px); gap: 6px; z-index: 10;
      touch-action: none; user-select: none; -webkit-user-select: none; }
    .ir-touch.pad { left: 16px; }
    .ir-touch.act { right: 16px; grid-template-columns: repeat(2, 64px); grid-template-rows: repeat(2, 64px); }
    .ir-touch button { font: 700 12px/1 ui-monospace, monospace; color: #fff3b0; background: rgba(27,27,34,.55);
      border: 2px solid rgba(255,213,79,.6); border-radius: 10px; touch-action: none; }
    .ir-touch button.on { background: rgba(200,57,43,.75); }
  `;
  document.head.appendChild(style);
  const areas = {};
  for (const a of ['pad', 'act']) {
    areas[a] = document.createElement('div');
    areas[a].className = `ir-touch ${a}`;
    document.body.appendChild(areas[a]);
  }
  for (const b of BUTTONS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = b.label;
    el.setAttribute('aria-label', b.id);
    el.style.gridColumn = b.col;
    el.style.gridRow = b.row;
    const set = (on) => (e) => {
      e.preventDefault();
      el.classList.toggle('on', on);
      const v = window.__IR && window.__IR.virtual;
      if (v) v[b.id] = on;
    };
    el.addEventListener('pointerdown', set(true));
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointercancel', set(false));
    el.addEventListener('pointerleave', set(false));
    areas[b.area].appendChild(el);
  }
}
