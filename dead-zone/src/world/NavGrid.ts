import { NAV_CONFIG } from '../config/GameConfig';
import { CollisionWorld } from './Collision';

const SQRT2 = Math.SQRT2;
// 8방향 이웃 (dx, dz, 비용)
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/**
 * 경량 경로 탐색: 맵을 1단위 격자로 나누고 (장애물 + 여유 반경이 닿는 칸은 막힘),
 * 플레이어 위치에서 출발하는 다익스트라 "흐름장"을 주기적으로 한 번만 계산한다.
 * 모든 좀비는 자기 칸에서 거리값이 줄어드는 이웃 쪽으로 이동 → 좀비 수와 무관한 비용.
 */
export class NavGrid {
  readonly size: number;
  readonly cell = NAV_CONFIG.cellSize;
  readonly origin: number;
  /** 1 = 막힘 */
  readonly blocked: Uint8Array;
  /** 목표(플레이어)까지 경로 거리. 도달 불가 = Infinity */
  readonly dist: Float32Array;
  private readonly heap: Int32Array;
  private readonly heapKey: Float32Array;
  private heapSize = 0;
  private targetCell = -1;
  /** 마지막 흐름장 계산 시간 (ms, 디버그) */
  lastBuildMs = 0;
  builds = 0;

  constructor(collision: CollisionWorld) {
    const half = collision.bound;
    this.size = Math.ceil((half * 2) / this.cell);
    this.origin = -half;
    const n = this.size * this.size;
    this.blocked = new Uint8Array(n);
    this.dist = new Float32Array(n).fill(Infinity);
    this.heap = new Int32Array(n * 8);
    this.heapKey = new Float32Array(n * 8);
    for (let iz = 0; iz < this.size; iz++) {
      for (let ix = 0; ix < this.size; ix++) {
        const [x, z] = this.center(ix, iz);
        if (collision.overlapsCircle(x, z, NAV_CONFIG.clearance)) this.blocked[iz * this.size + ix] = 1;
      }
    }
  }

  get freeRatio(): number {
    let free = 0;
    for (const b of this.blocked) if (!b) free++;
    return free / this.blocked.length;
  }

  center(ix: number, iz: number): [number, number] {
    return [this.origin + (ix + 0.5) * this.cell, this.origin + (iz + 0.5) * this.cell];
  }

  cellIndex(x: number, z: number): number {
    const ix = Math.floor((x - this.origin) / this.cell);
    const iz = Math.floor((z - this.origin) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size) return -1;
    return iz * this.size + ix;
  }

  isFree(x: number, z: number): boolean {
    const i = this.cellIndex(x, z);
    return i >= 0 && !this.blocked[i];
  }

  /** 경로 거리 (도달 불가면 Infinity) */
  pathDistance(x: number, z: number): number {
    const i = this.cellIndex(x, z);
    return i < 0 ? Infinity : this.dist[i];
  }

  /** 목표 위치가 다른 칸으로 바뀌었을 때만 흐름장 재계산. force 면 무조건 */
  update(tx: number, tz: number, force = false): boolean {
    let start = this.cellIndex(tx, tz);
    if (start < 0) return false;
    if (this.blocked[start]) start = this.nearestFree(start);
    if (start < 0 || (!force && start === this.targetCell)) return false;
    this.targetCell = start;
    const t0 = performance.now();
    this.build(start);
    this.lastBuildMs = performance.now() - t0;
    this.builds++;
    return true;
  }

  /**
   * 위치에서 목표 쪽으로 가는 방향 (정규화). 이웃 중 거리값이 가장 작은 칸의 중심을 향한다.
   * 대각선은 양옆 칸이 모두 열려 있을 때만 (모서리 끼임 방지).
   * 반환값 false = 경로 없음
   */
  direction(x: number, z: number, out: { x: number; z: number }): boolean {
    let i = this.cellIndex(x, z);
    if (i < 0) return false;
    if (this.blocked[i] || !Number.isFinite(this.dist[i])) {
      // 장애물에 밀려 막힌 칸 위에 있으면 가장 가까운 열린 칸으로
      const j = this.nearestFree(i);
      if (j < 0) return false;
      const [cx, cz] = this.center(j % this.size, Math.floor(j / this.size));
      return normalize(cx - x, cz - z, out);
    }
    const s = this.size;
    const ix = i % s;
    const iz = (i - ix) / s;
    let best = -1;
    let bestD = this.dist[i];
    for (const [dx, dz] of DIRS) {
      const nx = ix + dx;
      const nz = iz + dz;
      if (nx < 0 || nz < 0 || nx >= s || nz >= s) continue;
      const n = nz * s + nx;
      if (this.blocked[n]) continue;
      if (dx !== 0 && dz !== 0 && (this.blocked[iz * s + nx] || this.blocked[nz * s + ix])) continue;
      if (this.dist[n] < bestD) { bestD = this.dist[n]; best = n; }
    }
    if (best < 0) return false; // 목표 칸
    const [cx, cz] = this.center(best % s, Math.floor(best / s));
    return normalize(cx - x, cz - z, out);
  }

  /** 가까운 열린 칸 (나선형 탐색) */
  nearestFree(i: number): number {
    const s = this.size;
    const ix = i % s;
    const iz = Math.floor(i / s);
    for (let r = 1; r < 6; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = ix + dx;
          const nz = iz + dz;
          if (nx < 0 || nz < 0 || nx >= s || nz >= s) continue;
          const n = nz * s + nx;
          if (this.blocked[n]) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = n; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * 다익스트라 (8방향). 핫 루프라 배열 구조 분해 없이 평탄한 오프셋 표를 쓴다.
   */
  private build(start: number): void {
    const s = this.size;
    const dist = this.dist;
    const blocked = this.blocked;
    const cell = this.cell;
    dist.fill(Infinity);
    dist[start] = 0;
    this.heapSize = 0;
    this.push(start, 0);
    const h = this.heap;
    const k = this.heapKey;
    while (this.heapSize > 0) {
      const cur = h[0];
      const d = k[0];
      this.popTop();
      if (d > dist[cur]) continue;
      const ix = cur % s;
      const iz = (cur - ix) / s;
      const left = ix > 0, right = ix < s - 1, up = iz > 0, down = iz < s - 1;
      // 직교 이웃
      if (right && !blocked[cur + 1]) this.relax(cur + 1, d + cell);
      if (left && !blocked[cur - 1]) this.relax(cur - 1, d + cell);
      if (down && !blocked[cur + s]) this.relax(cur + s, d + cell);
      if (up && !blocked[cur - s]) this.relax(cur - s, d + cell);
      // 대각선: 양옆이 모두 열려 있을 때만 (모서리 끼임 방지)
      const dc = d + cell * SQRT2;
      if (right && down && !blocked[cur + s + 1] && !blocked[cur + 1] && !blocked[cur + s]) this.relax(cur + s + 1, dc);
      if (right && up && !blocked[cur - s + 1] && !blocked[cur + 1] && !blocked[cur - s]) this.relax(cur - s + 1, dc);
      if (left && down && !blocked[cur + s - 1] && !blocked[cur - 1] && !blocked[cur + s]) this.relax(cur + s - 1, dc);
      if (left && up && !blocked[cur - s - 1] && !blocked[cur - 1] && !blocked[cur - s]) this.relax(cur - s - 1, dc);
    }
  }

  private relax(n: number, nd: number): void {
    if (nd < this.dist[n]) {
      this.dist[n] = nd;
      this.push(n, nd);
    }
  }

  /** 힙 최상단 제거 */
  private popTop(): void {
    const h = this.heap;
    const k = this.heapKey;
    const n = --this.heapSize;
    const lastNode = h[n];
    const lastKey = k[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= lastKey) break;
      h[i] = h[c];
      k[i] = k[c];
      i = c;
    }
    h[i] = lastNode;
    k[i] = lastKey;
  }

  private push(node: number, key: number): void {
    let i = this.heapSize++;
    const h = this.heap;
    const k = this.heapKey;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      h[i] = h[p];
      k[i] = k[p];
      i = p;
    }
    h[i] = node;
    k[i] = key;
  }
}

function normalize(x: number, z: number, out: { x: number; z: number }): boolean {
  const l = Math.hypot(x, z);
  if (l < 1e-6) return false;
  out.x = x / l;
  out.z = z / l;
  return true;
}
