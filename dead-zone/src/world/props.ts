import * as THREE from 'three';
import { Random } from '../core/random';
import { StaticBatch } from './StaticBatch';
import { CollisionWorld } from './Collision';
import { crateTexture, hazardTexture, rustTexture } from './textures';

/**
 * 폐허 도시 소품: 버려진 차량, 콘크리트 장애물, 드럼통, 상자, 가로등, 잔해.
 * 모두 StaticBatch 로 합쳐지고 필요한 경우 충돌체를 등록한다.
 */
export class PropFactory {
  readonly mats: Record<string, THREE.MeshStandardMaterial>;
  private readonly geo: Record<string, THREE.BufferGeometry>;
  private readonly carPaints: THREE.MeshStandardMaterial[];

  constructor(private readonly batch: StaticBatch, private readonly collision: CollisionWorld, private readonly rng: Random) {
    const rust = rustTexture(31, '#6a6a66');
    this.mats = {
      concrete: new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 }),
      concreteDark: new THREE.MeshStandardMaterial({ color: 0x6a6862, roughness: 0.95 }),
      hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.8 }),
      crate: new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.9 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x3c4043, roughness: 0.55, metalness: 0.6 }),
      rust: new THREE.MeshStandardMaterial({ map: rust, roughness: 0.85, metalness: 0.3 }),
      drumRed: new THREE.MeshStandardMaterial({ map: rustTexture(41, '#7b2a22'), roughness: 0.7, metalness: 0.35 }),
      drumBlue: new THREE.MeshStandardMaterial({ map: rustTexture(42, '#26476b'), roughness: 0.7, metalness: 0.35 }),
      drumYellow: new THREE.MeshStandardMaterial({ map: rustTexture(43, '#9b7f22'), roughness: 0.7, metalness: 0.35 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1b2429, roughness: 0.15, metalness: 0.5 }),
      lampOn: new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffc870, emissiveIntensity: 2.4 }),
      lampOff: new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 0.4 }),
      headlight: new THREE.MeshStandardMaterial({ color: 0xcfd2d0, roughness: 0.2, metalness: 0.3 }),
      taillight: new THREE.MeshStandardMaterial({ color: 0x5a0d0d, roughness: 0.3 }),
      trash: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.35 }),
      cone: new THREE.MeshStandardMaterial({ color: 0xc8541c, roughness: 0.7 }),
      sandbag: new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x6b5135, roughness: 0.9 }),
    };
    this.carPaints = [0x6d1f1c, 0x2c3e50, 0x8c8c84, 0x3f4f2a, 0xa08a52, 0x1f1f22, 0x5b6770].map(
      (c, i) => new THREE.MeshStandardMaterial({ color: c, map: rustTexture(60 + i, '#b8b8b8'), roughness: 0.6, metalness: 0.45 }),
    );
    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
      cylLow: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
      drum: new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16),
      drumRing: new THREE.CylinderGeometry(0.31, 0.31, 0.05, 16),
      wheel: new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14).rotateX(Math.PI / 2),
      tire: new THREE.TorusGeometry(0.3, 0.12, 8, 14).rotateX(Math.PI / 2),
      rock: new THREE.DodecahedronGeometry(0.5, 0),
      bag: new THREE.DodecahedronGeometry(0.4, 1),
      cone: new THREE.ConeGeometry(0.22, 0.6, 10),
      jersey: jerseyGeometry(),
      carBody: carBodyGeometry(),
      carCabin: carCabinGeometry(),
    };
  }

  private box(mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rx = 0, ry = 0, rz = 0) {
    this.batch.add(this.geo.box, mat, x, y, z, rx, ry, rz, w, h, d);
  }

  /** 지역 좌표(lx, lz) 를 회전 ry 기준 월드 좌표로 */
  private static local(x: number, z: number, ry: number, lx: number, lz: number): [number, number] {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    return [x + lx * c + lz * s, z - lx * s + lz * c];
  }

  /** 버려진 승용차. 길이 방향 = 로컬 X */
  car(x: number, z: number, ry: number, opts: { wrecked?: boolean; paint?: number } = {}) {
    const r = this.rng;
    const paint = this.carPaints[opts.paint ?? r.int(0, this.carPaints.length - 1)];
    const wrecked = opts.wrecked ?? r.chance(0.4);
    const tiltZ = wrecked ? r.range(-0.06, 0.06) : 0;
    const tiltX = wrecked ? r.range(-0.04, 0.04) : 0;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, wrecked ? -0.08 : 0, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, ry, tiltZ)),
      new THREE.Vector3(1, 1, 1),
    );
    const part = (g: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, sx = 1, sy = 1, sz = 1, rx = 0, rry = 0, rz = 0) => {
      const lm = new THREE.Matrix4().compose(
        new THREE.Vector3(px, py, pz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, rry, rz)),
        new THREE.Vector3(sx, sy, sz),
      );
      this.batch.addMatrix(g, mat, new THREE.Matrix4().multiplyMatrices(m, lm));
    };
    part(this.geo.carBody, paint, 0, 0, 0);
    part(this.geo.carCabin, this.mats.glass, 0, 0, 0);
    // 지붕 (찌그러진 차는 낮게)
    const roofY = wrecked && r.chance(0.5) ? 1.33 : 1.43;
    part(this.geo.box, paint, -0.25, roofY, 0, 1.75, 0.06, 1.5);
    // 바퀴 (부서진 차는 일부 없음)
    for (const [wx, wz] of [[1.3, 0.82], [1.3, -0.82], [-1.35, 0.82], [-1.35, -0.82]]) {
      if (wrecked && r.chance(0.3)) continue;
      part(this.geo.wheel, this.mats.rubber, wx, 0.36, wz);
    }
    // 전조등 · 후미등 · 범퍼
    for (const s of [1, -1]) {
      part(this.geo.box, this.mats.headlight, 2.12, 0.72, s * 0.62, 0.06, 0.12, 0.34);
      part(this.geo.box, this.mats.taillight, -2.12, 0.78, s * 0.64, 0.06, 0.12, 0.3);
    }
    part(this.geo.box, this.mats.metal, 2.18, 0.42, 0, 0.12, 0.18, 1.7);
    part(this.geo.box, this.mats.metal, -2.18, 0.45, 0, 0.12, 0.18, 1.7);
    if (wrecked) {
      // 떨어진 문짝 · 잔해
      const [dx, dz] = PropFactory.local(x, z, ry, r.range(-1, 1), r.chance(0.5) ? 1.6 : -1.6);
      this.box(paint, dx, 0.04, dz, 1.1, 0.06, 0.8, 0, ry + r.range(-0.5, 0.5), 0);
    }
    this.collision.addBox(x, z, 4.45, 1.95, ry, 1.45);
  }

  /** 화물 트럭: 큰 엄폐물 */
  truck(x: number, z: number, ry: number) {
    const [cx, cz] = PropFactory.local(x, z, ry, 3.3, 0);
    const [bx, bz] = PropFactory.local(x, z, ry, -1.0, 0);
    // 운전석
    this.box(this.carPaints[3], cx, 1.25, cz, 2.0, 1.9, 2.3, 0, ry, 0);
    this.box(this.mats.glass, ...addLocal(x, z, ry, 4.31, 0, 1.6), 0.04, 0.8, 2.0, 0, ry, 0);
    // 화물칸
    this.box(this.mats.rust, bx, 1.75, bz, 6.4, 2.9, 2.4, 0, ry, 0);
    this.box(this.mats.metal, bx, 0.3, bz, 6.4, 0.25, 2.2, 0, ry, 0);
    for (const lx of [3.6, 1.2, -3.2]) {
      for (const s of [1, -1]) {
        const [wx, wz] = PropFactory.local(x, z, ry, lx, s * 1.0);
        this.batch.add(this.geo.wheel, this.mats.rubber, wx, 0.4, wz, 0, ry, 0, 1.15, 1.15, 1);
      }
    }
    this.collision.addBox(cx, cz, 2.1, 2.35, ry, 2.2);
    this.collision.addBox(bx, bz, 6.5, 2.45, ry, 3.2);
  }

  /** 콘크리트 방호벽 (저지 배리어). 길이 방향 = 로컬 X */
  barrier(x: number, z: number, ry: number, hazard = false) {
    const lean = this.rng.range(-0.03, 0.03);
    this.batch.add(this.geo.jersey, hazard ? this.mats.hazard : this.mats.concrete, x, 0, z, lean, ry, 0);
    this.collision.addBox(x, z, 3.0, 0.62, ry, 0.82);
  }

  barrierLine(x0: number, z0: number, x1: number, z1: number, gapEvery = 0) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 3.05));
    const ry = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      if (gapEvery && i % gapEvery === gapEvery - 1) continue;
      const t = (i + 0.5) / n;
      this.barrier(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, ry + this.rng.range(-0.04, 0.04), i % 3 === 0);
    }
  }

  /** 드럼통. 일부는 넘어져 있다 */
  drum(x: number, z: number, tipped = false) {
    const r = this.rng;
    const mat = r.pick([this.mats.drumRed, this.mats.drumBlue, this.mats.drumYellow, this.mats.rust]);
    if (tipped) {
      const ry = r.range(0, Math.PI);
      this.batch.add(this.geo.drum, mat, x, 0.3, z, 0, ry, Math.PI / 2);
      this.collision.addBox(x, z, 0.9, 0.62, ry, 0.62);
    } else {
      this.batch.add(this.geo.drum, mat, x, 0.45, z, 0, r.range(0, 6), 0);
      for (const y of [0.25, 0.65]) this.batch.add(this.geo.drumRing, this.mats.metal, x, y, z);
      this.batch.add(this.geo.cylLow, this.mats.metal, x, 0.905, z, 0, 0, 0, 0.58, 0.012, 0.58);
      this.collision.addCircle(x, z, 0.32, 0.92);
    }
  }

  drumCluster(x: number, z: number, count: number) {
    const r = this.rng;
    const placed: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const px = x + r.range(-1, 1);
        const pz = z + r.range(-1, 1);
        if (placed.every(([qx, qz]) => Math.hypot(px - qx, pz - qz) > 0.68)) {
          placed.push([px, pz]);
          this.drum(px, pz, false);
          break;
        }
      }
    }
    if (r.chance(0.6)) this.drum(x + r.range(1.4, 1.9), z + r.range(-0.5, 0.5), true);
  }

  /** 나무 상자 더미 */
  crateStack(x: number, z: number, ry: number, layout: number[][]) {
    // layout[층] = 로컬 X 칸 목록
    const s = 1.0;
    let maxW = 0;
    layout.forEach((row, level) => {
      for (const col of row) {
        const [px, pz] = PropFactory.local(x, z, ry, col * s, 0);
        const jitter = this.rng.range(-0.12, 0.12);
        this.box(this.mats.crate, px, s / 2 + level * s, pz, s * 0.98, s * 0.98, s * 0.98, 0, ry + jitter, 0);
      }
      maxW = Math.max(maxW, row.length);
    });
    const cols = layout[0];
    const minC = Math.min(...cols);
    const maxC = Math.max(...cols);
    const [cx, cz] = PropFactory.local(x, z, ry, ((minC + maxC) / 2) * s, 0);
    this.collision.addBox(cx, cz, (maxC - minC + 1) * s + 0.05, s + 0.1, ry, layout.length * s);
  }

  /** 나무 팔레트 */
  pallet(x: number, z: number, ry: number) {
    for (let i = -2; i <= 2; i++) {
      const [px, pz] = PropFactory.local(x, z, ry, i * 0.26, 0);
      this.box(this.mats.wood, px, 0.13, pz, 0.2, 0.03, 1.1, 0, ry, 0);
    }
    for (const s of [-0.45, 0, 0.45]) {
      const [px, pz] = PropFactory.local(x, z, ry, 0, s);
      this.box(this.mats.wood, px, 0.06, pz, 1.2, 0.1, 0.12, 0, ry, 0);
    }
  }

  /** 가로등. 반환값: 불이 켜진 경우 전구 위치 */
  streetLight(x: number, z: number, armDir: number, state: 'on' | 'off' | 'broken'): THREE.Vector3 | null {
    const tilt = state === 'broken' ? 0.22 : 0;
    const h = 6.2;
    // 기울어진 가로등은 전체를 하나의 변환으로
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, armDir, tilt * 0.5)),
      new THREE.Vector3(1, 1, 1),
    );
    const part = (g: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number, sx: number, sy: number, sz: number, rz = 0) => {
      const lm = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz));
      this.batch.addMatrix(g, mat, new THREE.Matrix4().multiplyMatrices(m, lm));
    };
    part(this.geo.cylLow, this.mats.concreteDark, 0, 0.25, 0, 0.5, 0.5, 0.5);
    part(this.geo.cyl, this.mats.metal, 0, h / 2, 0, 0.16, h, 0.16);
    part(this.geo.cyl, this.mats.metal, 0.9, h - 0.15, 0, 0.09, 1.9, 0.09, Math.PI / 2 - 0.12);
    part(this.geo.box, this.mats.metal, 1.75, h - 0.1, 0, 0.7, 0.16, 0.34);
    part(this.geo.box, state === 'on' ? this.mats.lampOn : this.mats.lampOff, 1.75, h - 0.2, 0, 0.56, 0.05, 0.26);
    this.collision.addCircle(x, z, 0.26, h);
    if (state !== 'on') return null;
    const p = new THREE.Vector3(1.75, h - 0.35, 0).applyMatrix4(m);
    return p;
  }

  /** 잔해 더미 (콘크리트 덩어리 + 철근) */
  rubble(x: number, z: number, radius: number, count: number, collide = true) {
    const r = this.rng;
    for (let i = 0; i < count; i++) {
      const a = r.range(0, Math.PI * 2);
      const d = Math.sqrt(r.next()) * radius;
      const s = r.range(0.25, 0.75) * (1 - (d / radius) * 0.5);
      this.batch.add(this.geo.rock, r.chance(0.7) ? this.mats.concrete : this.mats.concreteDark,
        x + Math.cos(a) * d, s * 0.3, z + Math.sin(a) * d, r.range(0, 3), r.range(0, 3), r.range(0, 3), s * 1.3, s * 0.8, s);
    }
    for (let i = 0; i < Math.ceil(count / 6); i++) {
      this.batch.add(this.geo.cylLow, this.mats.rust, x + r.range(-radius, radius) * 0.6, 0.4, z + r.range(-radius, radius) * 0.6,
        r.range(-0.8, 0.8), 0, r.range(-0.8, 0.8), 0.04, r.range(0.8, 1.6), 0.04, { cast: false });
    }
    if (collide) this.collision.addCircle(x, z, radius * 0.55, 0.6);
  }

  /** 작은 장식 (충돌 없음): 타이어, 쓰레기봉투, 꼬깔, 파편 */
  clutter(x: number, z: number) {
    const r = this.rng;
    const k = r.next();
    if (k < 0.3) {
      this.batch.add(this.geo.tire, this.mats.rubber, x, 0.12, z, r.range(-0.2, 0.2), 0, r.range(-0.2, 0.2));
    } else if (k < 0.55) {
      for (let i = 0; i < r.int(1, 3); i++) {
        this.batch.add(this.geo.bag, this.mats.trash, x + r.range(-0.5, 0.5), 0.22, z + r.range(-0.5, 0.5), r.range(0, 3), r.range(0, 3), 0, 1, 0.65, 0.9);
      }
    } else if (k < 0.75) {
      const fallen = r.chance(0.5);
      this.batch.add(this.geo.cone, this.mats.cone, x, fallen ? 0.2 : 0.3, z, fallen ? Math.PI / 2 : 0, r.range(0, 6), 0);
    } else {
      for (let i = 0; i < 4; i++) {
        this.batch.add(this.geo.rock, this.mats.concreteDark, x + r.range(-0.6, 0.6), 0.05, z + r.range(-0.6, 0.6), r.range(0, 3), r.range(0, 3), 0, 0.3, 0.15, 0.25);
      }
    }
  }

  /** 모래주머니 벽 (낮은 엄폐물) */
  sandbags(x: number, z: number, ry: number, length: number) {
    const n = Math.round(length / 0.62);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < n - (row === 2 ? 1 : 0); i++) {
        const lx = (i - (n - 1) / 2) * 0.62 + (row % 2) * 0.31;
        const [px, pz] = PropFactory.local(x, z, ry, lx, 0);
        this.batch.add(this.geo.bag, this.mats.sandbag, px, 0.13 + row * 0.22, pz, 0, ry + this.rng.range(-0.15, 0.15), 0, 0.85, 0.34, 0.6);
      }
    }
    this.collision.addBox(x, z, n * 0.62, 0.6, ry, 0.7);
  }
}

function addLocal(x: number, z: number, ry: number, lx: number, y: number, lz: number): [number, number, number] {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return [x + lx * c + lz * s, y, z - lx * s + lz * c];
}

/** 저지 배리어 단면을 길이 3 으로 돌출 */
function jerseyGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0);
  s.lineTo(0.3, 0);
  s.lineTo(0.3, 0.08);
  s.lineTo(0.17, 0.3);
  s.lineTo(0.1, 0.82);
  s.lineTo(-0.1, 0.82);
  s.lineTo(-0.17, 0.3);
  s.lineTo(-0.3, 0.08);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false });
  g.translate(0, 0, -1.5);
  g.rotateY(Math.PI / 2); // 길이 방향을 X 로
  return g;
}

/** 승용차 차체 측면 실루엣을 폭 1.8 로 돌출 (길이 방향 X, 앞 = +X) */
function carBodyGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-2.2, 0.28);
  s.lineTo(2.15, 0.28);
  s.lineTo(2.22, 0.55);
  s.lineTo(2.12, 0.86);
  s.lineTo(0.95, 0.98);
  s.lineTo(-1.6, 0.98);
  s.lineTo(-2.18, 0.92);
  s.lineTo(-2.25, 0.6);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.8, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 });
  g.translate(0, 0, -0.9);
  return g;
}

/** 유리 캐빈 (앞유리 · 옆창 · 뒷유리) */
function carCabinGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-1.55, 0.97);
  s.lineTo(0.9, 0.97);
  s.lineTo(0.35, 1.42);
  s.lineTo(-1.1, 1.42);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.56, bevelEnabled: false });
  g.translate(0, 0, -0.78);
  return g;
}
