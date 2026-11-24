/**
 * 지면(XZ 평면) 기반 2D 충돌 시스템.
 * - 장애물은 회전 가능한 직사각형(OBB) 또는 원으로 표현하고, 높이를 가진다.
 * - 캐릭터: 원 vs 장애물 밀어내기 (미끄러지며 이동)
 * - 투사체: 선분 vs 장애물 레이캐스트 (발사 높이보다 낮은 장애물은 넘어간다)
 * - 균일 격자로 후보 장애물만 검사한다.
 */

export interface BoxCollider {
  kind: 'box';
  x: number;
  z: number;
  /** 로컬 절반 크기 */
  hx: number;
  hz: number;
  /** Y축 회전 (three.js rotation.y 와 같은 방향) */
  rot: number;
  height: number;
  cos: number;
  sin: number;
}

export interface CircleCollider {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
  height: number;
}

export type Collider = BoxCollider | CircleCollider;

export interface RayHit {
  /** 선분 위 비율 0~1 */
  t: number;
  x: number;
  z: number;
  /** 표면 법선 (XZ) */
  nx: number;
  nz: number;
  collider: Collider;
}

export interface PushResult {
  hit: boolean;
  /** 마지막으로 밀어낸 방향 (XZ) */
  nx: number;
  nz: number;
}

const CELL = 8;

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private grid = new Map<number, Collider[]>();
  private stamp = new Map<Collider, number>();
  private query = 0;
  /** 이동 가능한 영역 경계 (원점 중심 정사각형 절반 크기) */
  bound = Infinity;

  addBox(x: number, z: number, w: number, d: number, rot: number, height: number): BoxCollider {
    const c: BoxCollider = { kind: 'box', x, z, hx: w / 2, hz: d / 2, rot, height, cos: Math.cos(rot), sin: Math.sin(rot) };
    this.insert(c);
    return c;
  }

  addCircle(x: number, z: number, r: number, height: number): CircleCollider {
    const c: CircleCollider = { kind: 'circle', x, z, r, height };
    this.insert(c);
    return c;
  }

  /**
   * 원(캐릭터)을 장애물 밖으로 밀어낸다. pos 를 직접 수정한다.
   * 여러 장애물이 겹친 모서리에서도 안정되도록 몇 번 반복한다.
   */
  resolveCircle(pos: { x: number; z: number }, radius: number, out: PushResult): PushResult {
    out.hit = false;
    out.nx = 0;
    out.nz = 0;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const candidates = this.candidates(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
      for (const c of candidates) {
        if (c.kind === 'circle') {
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const min = c.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const nx = d2 > 1e-12 ? dx / d : 1;
          const nz = d2 > 1e-12 ? dz / d : 0;
          pos.x = c.x + nx * min;
          pos.z = c.z + nz * min;
          out.hit = true;
          out.nx = nx;
          out.nz = nz;
          moved = true;
        } else {
          // 월드 → 박스 로컬
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const lx = dx * c.cos - dz * c.sin;
          const lz = dx * c.sin + dz * c.cos;
          if (Math.abs(lx) >= c.hx + radius || Math.abs(lz) >= c.hz + radius) continue;
          const cx = Math.max(-c.hx, Math.min(c.hx, lx));
          const cz = Math.max(-c.hz, Math.min(c.hz, lz));
          const px = lx - cx;
          const pz = lz - cz;
          const d2 = px * px + pz * pz;
          let nlx: number;
          let nlz: number;
          let nlxPos: number;
          let nlzPos: number;
          if (d2 > 1e-12) {
            if (d2 >= radius * radius) continue;
            const d = Math.sqrt(d2);
            nlx = px / d;
            nlz = pz / d;
            nlxPos = cx + nlx * radius;
            nlzPos = cz + nlz * radius;
          } else {
            // 중심이 박스 안: 가장 얕은 축으로 밀어낸다
            const penX = c.hx - Math.abs(lx);
            const penZ = c.hz - Math.abs(lz);
            if (penX < penZ) {
              nlx = Math.sign(lx) || 1;
              nlz = 0;
              nlxPos = nlx * (c.hx + radius);
              nlzPos = lz;
            } else {
              nlx = 0;
              nlz = Math.sign(lz) || 1;
              nlxPos = lx;
              nlzPos = nlz * (c.hz + radius);
            }
          }
          // 로컬 → 월드
          pos.x = c.x + nlxPos * c.cos + nlzPos * c.sin;
          pos.z = c.z - nlxPos * c.sin + nlzPos * c.cos;
          out.hit = true;
          out.nx = nlx * c.cos + nlz * c.sin;
          out.nz = -nlx * c.sin + nlz * c.cos;
          moved = true;
        }
      }
      // 맵 경계
      const b = this.bound - radius;
      if (pos.x > b) { pos.x = b; out.hit = true; out.nx = -1; out.nz = 0; moved = true; }
      if (pos.x < -b) { pos.x = -b; out.hit = true; out.nx = 1; out.nz = 0; moved = true; }
      if (pos.z > b) { pos.z = b; out.hit = true; out.nx = 0; out.nz = -1; moved = true; }
      if (pos.z < -b) { pos.z = -b; out.hit = true; out.nx = 0; out.nz = 1; moved = true; }
      if (!moved) break;
    }
    return out;
  }

  /**
   * 선분 (x0,z0)→(x1,z1) 이 높이 y 에서 처음 부딪히는 장애물.
   * 높이가 y 보다 낮은 장애물은 무시한다 (총알이 위로 지나감).
   */
  raycast(x0: number, z0: number, x1: number, z1: number, y: number, out: RayHit): RayHit | null {
    let best: RayHit | null = null;
    let bestT = 1;
    const candidates = this.candidates(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
    const dx = x1 - x0;
    const dz = z1 - z0;
    for (const c of candidates) {
      if (c.height < y) continue;
      if (c.kind === 'circle') {
        const t = segmentCircle(x0, z0, dx, dz, c.x, c.z, c.r);
        if (t !== null && t < bestT) {
          bestT = t;
          const hx = x0 + dx * t;
          const hz = z0 + dz * t;
          const nl = Math.hypot(hx - c.x, hz - c.z) || 1;
          out.t = t; out.x = hx; out.z = hz;
          out.nx = (hx - c.x) / nl; out.nz = (hz - c.z) / nl;
          out.collider = c;
          best = out;
        }
      } else {
        const ox = x0 - c.x;
        const oz = z0 - c.z;
        const lx0 = ox * c.cos - oz * c.sin;
        const lz0 = ox * c.sin + oz * c.cos;
        const ldx = dx * c.cos - dz * c.sin;
        const ldz = dx * c.sin + dz * c.cos;
        const r = slab(lx0, lz0, ldx, ldz, c.hx, c.hz);
        if (r && r.t < bestT) {
          bestT = r.t;
          out.t = r.t;
          out.x = x0 + dx * r.t;
          out.z = z0 + dz * r.t;
          out.nx = r.nx * c.cos + r.nz * c.sin;
          out.nz = -r.nx * c.sin + r.nz * c.cos;
          out.collider = c;
          best = out;
        }
      }
    }
    // 맵 외곽 경계도 투사체를 막는다
    if (Number.isFinite(this.bound)) {
      const b = this.bound;
      const tests: [number, number, number][] = [
        [dx > 0 ? (b - x0) / dx : -1, -1, 0],
        [dx < 0 ? (-b - x0) / dx : -1, 1, 0],
        [dz > 0 ? (b - z0) / dz : -1, 0, -1],
        [dz < 0 ? (-b - z0) / dz : -1, 0, 1],
      ];
      for (const [t, nx, nz] of tests) {
        if (t >= 0 && t < bestT) {
          bestT = t;
          out.t = t; out.x = x0 + dx * t; out.z = z0 + dz * t;
          out.nx = nx; out.nz = nz;
          out.collider = BOUNDARY;
          best = out;
        }
      }
    }
    return best;
  }

  /** 점이 장애물과 겹치는지 (배치 검사용) */
  overlapsCircle(x: number, z: number, radius: number): boolean {
    const p = { x, z };
    const r: PushResult = { hit: false, nx: 0, nz: 0 };
    this.resolveCircle(p, radius, r);
    return r.hit;
  }

  private insert(c: Collider): void {
    this.colliders.push(c);
    const ext = c.kind === 'circle' ? c.r : Math.hypot(c.hx, c.hz);
    for (const key of this.cellKeys(c.x - ext, c.z - ext, c.x + ext, c.z + ext)) {
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(c);
    }
  }

  private readonly scratch: Collider[] = [];

  private candidates(minX: number, minZ: number, maxX: number, maxZ: number): Collider[] {
    const out = this.scratch;
    out.length = 0;
    const q = ++this.query;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const list = this.grid.get(key(gx, gz));
        if (!list) continue;
        for (const c of list) {
          if (this.stamp.get(c) === q) continue;
          this.stamp.set(c, q);
          out.push(c);
        }
      }
    }
    return out;
  }

  private *cellKeys(minX: number, minZ: number, maxX: number, maxZ: number): Generator<number> {
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++) {
      for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) yield key(gx, gz);
    }
  }
}

/** 맵 경계를 나타내는 가상 장애물 */
export const BOUNDARY: CircleCollider = { kind: 'circle', x: 0, z: 0, r: 0, height: Infinity };

function key(gx: number, gz: number): number {
  return (gx + 512) * 1024 + (gz + 512);
}

/** 선분(원점 o, 방향 d, t∈[0,1]) 과 원의 첫 교차 t */
export function segmentCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, r: number): number | null {
  const fx = ox - cx;
  const fz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return null;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0; // 시작점이 이미 안쪽
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

const slabOut = { t: 0, nx: 0, nz: 0 };

/** 원점 중심 박스(±hx, ±hz) 와 선분의 첫 교차 (로컬 좌표) */
function slab(ox: number, oz: number, dx: number, dz: number, hx: number, hz: number) {
  let tMin = 0;
  let tMax = 1;
  let nx = 0;
  let nz = 0;
  if (Math.abs(ox) <= hx && Math.abs(oz) <= hz) {
    // 시작점이 이미 박스 안
    slabOut.t = 0;
    slabOut.nx = -Math.sign(dx) || 0;
    slabOut.nz = dx === 0 ? -Math.sign(dz) : 0;
    return slabOut;
  }
  if (Math.abs(dx) < 1e-12) {
    if (Math.abs(ox) > hx) return null;
  } else {
    let t1 = (-hx - ox) / dx;
    let t2 = (hx - ox) / dx;
    let n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tMin) { tMin = t1; nx = n; nz = 0; }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (Math.abs(dz) < 1e-12) {
    if (Math.abs(oz) > hz) return null;
  } else {
    let t1 = (-hz - oz) / dz;
    let t2 = (hz - oz) / dz;
    let n = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; n = 1; }
    if (t1 > tMin) { tMin = t1; nx = 0; nz = n; }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  slabOut.t = tMin;
  slabOut.nx = nx;
  slabOut.nz = nz;
  return slabOut;
}
