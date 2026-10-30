import { defaultProps } from '../engine/behaviors.js';

let uid = 0;
export const newId = () => `e${Date.now().toString(36)}${(uid++).toString(36)}`;

// 팔레트에 나오는 프리팹. 타일 칠하기 브러시로도 쓰인다.
// label은 쉬운 모드(어린이용) 이름, tip은 쉬운 모드에서 보여줄 설명.
export const prefabs = {
  wall: { label: '땅', name: 'Ground', color: '#7a5236', components: ['Solid'], tip: '밟고 설 수 있어요' },
  player: { label: '주인공', name: 'Player', emoji: '😊', color: '#7fd1ff', inset: [1, 1, 1, 0], components: ['Body', 'PlayerController'], tip: '내가 움직이는 캐릭터예요 (하나만!)' },
  star: { label: '별', name: 'Star', emoji: '⭐', color: '#ffd84a', shape: 'circle', inset: [3, 3, 3, 3], components: ['Collectible'], tip: '모으면 점수가 올라가요' },
  spike: { label: '가시', name: 'Spike', color: '#ff4d6d', shape: 'spike', inset: [0, 8, 0, 0], components: ['Hazard'], tip: '닿으면 처음부터 다시!' },
  enemy: { label: '괴물', name: 'Enemy', emoji: '👾', color: '#c17bff', inset: [2, 2, 2, 0], components: ['Body', 'Patrol', ['Hazard', { stompable: true }]], tip: '위에서 밟으면 물리칠 수 있어요' },
  spring: { label: '점프대', name: 'Spring', emoji: '🍄', color: '#ff8a3d', inset: [1, 2, 1, 0], components: ['Spring'], tip: '밟으면 높이 튀어 올라요' },
  goal: { label: '깃발', name: 'Goal', emoji: '🚩', color: '#5cf2a0', components: ['Goal'], tip: '닿으면 다음 단계로 가요' },
  mover: { label: '움직이는 발판', name: 'Mover', color: '#4f7cff', components: ['Solid', 'Script'], tip: '왔다 갔다 움직여요' },
  empty: { label: '빈 오브젝트', name: 'Object', color: '#ffffff', components: [], proOnly: true },
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
    emoji: p.emoji || '',
    visible: true,
    tags: [],
    components,
  };
}

export function createScene(name) {
  return { name, background: '#9bd7ff', entities: [] };
}

// 처음 실행했을 때 보여줄 작은 예제 레벨.
export function createDefaultProject() {
  const g = 16;
  const scene = createScene('1단계');
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
    '# P     S  ##########   ^^^  #',
    '##############################',
  ];
  const map = { '#': 'wall', '*': 'star', '^': 'spike', E: 'enemy', F: 'goal', P: 'player', S: 'spring' };
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (map[ch]) scene.entities.push(instantiate(map[ch], x, y, g));
  }));
  return {
    format: 1,
    name: '나의 첫 게임',
    settings: { width: 480, height: 270, gravity: 1800, grid: g, startScene: '1단계' },
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
