import { defaultProps } from '../engine/behaviors.js';

let uid = 0;
export const newId = () => `e${Date.now().toString(36)}${(uid++).toString(36)}`;

// 팔레트에 나오는 프리팹. 타일 칠하기 브러시로도 쓰인다.
export const prefabs = {
  wall: { label: '벽', name: 'Wall', color: '#3b3f58', components: ['Solid'] },
  player: { label: '플레이어', name: 'Player', color: '#7fd1ff', inset: [2, 2, 2, 0], components: ['Body', 'PlayerController'] },
  star: { label: '별', name: 'Star', color: '#ffd84a', shape: 'circle', inset: [4, 4, 4, 4], components: ['Collectible'] },
  spike: { label: '가시', name: 'Spike', color: '#ff5470', inset: [2, 8, 2, 0], components: ['Hazard'] },
  enemy: { label: '적', name: 'Enemy', color: '#c17bff', inset: [2, 4, 2, 0], components: ['Body', 'Patrol', ['Hazard', { stompable: true }]] },
  goal: { label: '깃발', name: 'Goal', color: '#5cf2a0', inset: [4, -16, 4, 0], components: ['Goal'] },
  mover: { label: '움직이는 발판', name: 'Mover', color: '#8a93c9', components: ['Solid', 'Script'] },
  empty: { label: '빈 오브젝트', name: 'Object', color: '#ffffff', components: [] },
};

// 격자 칸(cx, cy)에 프리팹 인스턴스를 만든다. inset은 [왼, 위, 오른, 아래] 여백.
export function instantiate(key, cx, cy, grid) {
  const p = prefabs[key];
  const [l, t, r, b] = p.inset || [0, 0, 0, 0];
  const components = {};
  for (const c of p.components) {
    const [type, override] = Array.isArray(c) ? c : [c, {}];
    components[type] = { ...defaultProps(type), ...override };
  }
  return {
    id: newId(),
    name: p.name,
    prefab: key,
    x: cx * grid + l,
    y: cy * grid + t,
    w: grid - l - r,
    h: grid - t - b,
    z: 0,
    color: p.color,
    shape: p.shape || 'rect',
    visible: true,
    tags: [],
    components,
  };
}

export function createScene(name) {
  return { name, background: '#14141c', entities: [] };
}

// 처음 실행했을 때 보여줄 작은 예제 레벨.
export function createDefaultProject() {
  const g = 16;
  const scene = createScene('Level 1');
  const rows = [
    '##############################',
    '#                            #',
    '#                            #',
    '#                  *         #',
    '#                #####       #',
    '#            *               #',
    '#          #####          F  #',
    '#                       #### #',
    '#   *                        #',
    '#  ###          E            #',
    '# P        ##########   ^^^  #',
    '##############################',
  ];
  const map = { '#': 'wall', '*': 'star', '^': 'spike', E: 'enemy', F: 'goal', P: 'player' };
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (map[ch]) scene.entities.push(instantiate(map[ch], x, y, g));
  }));
  return {
    format: 1,
    name: '새 게임',
    settings: { width: 480, height: 270, gravity: 1800, grid: g, startScene: 'Level 1' },
    scenes: [scene],
  };
}

// 스냅샷 기반 실행 취소/다시 실행.
export class History {
  constructor(limit = 200) {
    this.undoStack = [];
    this.redoStack = [];
    this.limit = limit;
  }

  push(snapshot) {
    if (this.undoStack[this.undoStack.length - 1] === snapshot) return;
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length < 2) return null;
    this.redoStack.push(this.undoStack.pop());
    return this.undoStack[this.undoStack.length - 1];
  }

  redo() {
    const s = this.redoStack.pop();
    if (s) this.undoStack.push(s);
    return s ?? null;
  }
}
