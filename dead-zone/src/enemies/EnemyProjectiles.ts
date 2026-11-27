import * as THREE from 'three';
import { HitInfo } from '../combat/Damageable';
import { CollisionWorld, RayHit, segmentCircle } from '../world/Collision';
import { SPIT_LIMITS } from './EnemyData';
import { AttackTarget } from './Zombie';

interface Spit {
  active: boolean;
  x: number; y: number; z: number;
  px: number; pz: number;
  dx: number; dz: number;
  speed: number;
  radius: number;
  damage: number;
  traveled: number;
  range: number;
  sourceId: string;
  age: number;
}

const CAPACITY = 16;

/**
 * 스피터의 독성 투사체 (객체 풀 + InstancedMesh).
 * - 직선 비행, 장애물(벽 · 건물)을 통과하지 않음 (이동 구간 전체를 레이캐스트)
 * - 플레이어와 닿으면 피해를 주고 사라짐 (무적 시간 중이어도 사라짐)
 * - 표시: 빛나는 독 덩어리 + 진행 반대쪽으로 늘어난 꼬리 + 바닥 그림자(위치 · 방향 확인용)
 * - 동시 비행 수 · 발사 간격 제한 (SPIT_LIMITS): 여러 마리가 한꺼번에 쏟아붓지 않도록
 */
export class EnemyProjectiles {
  private readonly pool: Spit[] = [];
  private readonly ball: THREE.InstancedMesh;
  private readonly trail: THREE.InstancedMesh;
  private readonly shadow: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly ray: RayHit = { t: 0, x: 0, z: 0, nx: 0, nz: 0, collider: null as never };
  private readonly hit: HitInfo = { damage: 0, point: new THREE.Vector3(), direction: new THREE.Vector3(), sourceId: '' };
  private lastFire = -10;
  /** 발사 예약 (준비 동작 시작 시점에 자리 확보 → 준비 중인 스피터 수까지 제한). 오래된 예약은 만료 */
  private readonly reservations: number[] = [];
  private clock = 0;
  private readonly disposables: { dispose(): void }[] = [];
  /** 통계 (테스트 · 디버그) */
  stats = { fired: 0, hitPlayer: 0, hitWall: 0, expired: 0, denied: 0 };

  /** 충돌 지점 (이펙트): 벽이면 wall=true */
  onImpact: ((x: number, y: number, z: number, wall: boolean) => void) | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly collision: CollisionWorld, private readonly target: AttackTarget) {
    for (let i = 0; i < CAPACITY; i++) {
      this.pool.push({ active: false, x: 0, y: 0, z: 0, px: 0, pz: 0, dx: 0, dz: 1, speed: 0, radius: 0.25, damage: 0, traveled: 0, range: 0, sourceId: '', age: 0 });
    }
    const ballGeo = new THREE.IcosahedronGeometry(1, 1);
    const ballMat = new THREE.MeshBasicMaterial({ color: 0x9dff4a, toneMapped: false });
    const trailGeo = new THREE.ConeGeometry(1, 1, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    const trailMat = new THREE.MeshBasicMaterial({ color: 0x6fe830, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const shadowGeo = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x2c5a10, transparent: true, opacity: 0.55, depthWrite: false });
    this.disposables.push(ballGeo, ballMat, trailGeo, trailMat, shadowGeo, shadowMat);
    this.ball = this.instanced(ballGeo, ballMat, 'spit-ball');
    this.trail = this.instanced(trailGeo, trailMat, 'spit-trail');
    this.trail.renderOrder = 5;
    this.shadow = this.instanced(shadowGeo, shadowMat, 'spit-shadow');
    this.shadow.renderOrder = 2;
  }

  private instanced(g: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(g, mat, CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.name = name;
    this.scene.add(mesh);
    return mesh;
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.active) n++;
    return n;
  }

  /**
   * 새 공격을 시작해도 되는지 확인하고 자리를 예약한다.
   * (비행 중 + 준비 중) 수가 maxInFlight 미만이고, 직전 예약과 minGap 이상 떨어져 있어야 한다.
   * 예약 순서대로 발사되므로 실제 발사 간격도 minGap 이상이 된다.
   */
  canFire(): boolean {
    while (this.reservations.length && this.clock - this.reservations[0] > SPIT_LIMITS.reserveTimeout) this.reservations.shift();
    const last = this.reservations.length ? this.reservations[this.reservations.length - 1] : this.lastFire;
    const ok = this.activeCount + this.reservations.length < SPIT_LIMITS.maxInFlight && this.clock - Math.max(last, this.lastFire) >= SPIT_LIMITS.minGap;
    if (!ok) { this.stats.denied++; return false; }
    this.reservations.push(this.clock);
    return true;
  }

  fire(x: number, y: number, z: number, dx: number, dz: number, speed: number, radius: number, damage: number, range: number, sourceId: string): boolean {
    this.reservations.shift(); // 가장 오래된 예약 사용
    const p = this.pool.find((o) => !o.active);
    if (!p) return false;
    p.active = true;
    p.x = p.px = x; p.y = y; p.z = p.pz = z;
    p.dx = dx; p.dz = dz;
    p.speed = speed; p.radius = radius; p.damage = damage;
    p.traveled = 0; p.range = range; p.sourceId = sourceId; p.age = 0;
    this.lastFire = this.clock;
    this.stats.fired++;
    return true;
  }

  step(dt: number): void {
    this.clock += dt;
    const t = this.target;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.px = p.x; p.pz = p.z;
      p.age += dt;
      let move = p.speed * dt;
      let expire = false;
      if (p.traveled + move >= p.range) { move = p.range - p.traveled; expire = true; }
      const x1 = p.x + p.dx * move;
      const z1 = p.z + p.dz * move;
      // 장애물: 같은 높이에서 이동 구간 레이캐스트
      const wall = this.collision.raycast(p.x, p.z, x1, z1, p.y, this.ray);
      const wallT = wall ? this.ray.t : Infinity;
      // 플레이어: 선분 vs 원 (플레이어 반경 + 투사체 반경)
      const pt = t.isAlive() ? segmentCircle(p.x, p.z, x1 - p.x, z1 - p.z, t.position.x, t.position.z, t.radius + p.radius) : null;
      if (pt !== null && pt <= wallT) {
        const hx = p.x + (x1 - p.x) * pt;
        const hz = p.z + (z1 - p.z) * pt;
        const h = this.hit;
        h.damage = p.damage;
        h.point.set(hx, p.y, hz);
        h.direction.set(p.dx, 0, p.dz);
        h.sourceId = p.sourceId;
        t.receiveAttack(h);
        this.stats.hitPlayer++;
        p.active = false;
        this.onImpact?.(hx, p.y, hz, false);
        continue;
      }
      if (wall) {
        const hx = p.x + (x1 - p.x) * wallT;
        const hz = p.z + (z1 - p.z) * wallT;
        this.stats.hitWall++;
        p.active = false;
        this.onImpact?.(hx, p.y, hz, true);
        continue;
      }
      p.x = x1; p.z = z1;
      p.traveled += move;
      if (expire) {
        p.active = false;
        this.stats.expired++;
        this.onImpact?.(p.x, 0.05, p.z, true); // 바닥에 떨어짐
      }
    }
  }

  render(alpha: number): void {
    let n = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      const x = p.px + (p.x - p.px) * alpha;
      const z = p.pz + (p.z - p.pz) * alpha;
      const wob = 1 + Math.sin(p.age * 30) * 0.08;
      this.q.identity();
      this.m.compose(this.v.set(x, p.y, z), this.q, this.s.setScalar(p.radius * wob));
      this.ball.setMatrixAt(n, this.m);
      // 꼬리: 진행 반대 방향으로 길게
      this.q.setFromAxisAngle(this.up, Math.atan2(p.dx, p.dz));
      const len = Math.min(1.6, 0.3 + p.traveled * 0.5);
      this.m.compose(this.v.set(x, p.y, z), this.q, this.s.set(p.radius * 0.85, p.radius * 0.85, len));
      this.trail.setMatrixAt(n, this.m);
      // 바닥 그림자: 높이와 관계없이 지면 위치를 보여 줌
      this.q.identity();
      this.m.compose(this.v.set(x, 0.03, z), this.q, this.s.set(p.radius * 1.4, 1, p.radius * 1.4));
      this.shadow.setMatrixAt(n, this.m);
      n++;
    }
    for (const mesh of [this.ball, this.trail, this.shadow]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
    this.lastFire = -10;
    this.reservations.length = 0;
    this.stats = { fired: 0, hitPlayer: 0, hitWall: 0, expired: 0, denied: 0 };
    this.render(1);
  }

  dispose(): void {
    for (const mesh of [this.ball, this.trail, this.shadow]) { this.scene.remove(mesh); mesh.dispose(); }
    for (const d of this.disposables) d.dispose();
  }
}
