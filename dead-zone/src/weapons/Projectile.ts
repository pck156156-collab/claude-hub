import * as THREE from 'three';
import { PROJECTILE_CONFIG } from '../config/GameConfig';
import { Damageable, DamageableRegistry } from '../combat/Damageable';
import { CollisionWorld, RayHit } from '../world/Collision';

/** 탄 1발 발사 정보 (GunShooter 가 산탄마다 하나씩 만든다) */
/** 관통 후 남는 피해 비율 (8단계 밸런스) */
export const PIERCE_DAMAGE_KEEP = 0.7;

export interface BulletSpec {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  range: number;
  damage: number;
  pierce: number;
  sourceId: string;
  /** 공격 ID (산탄 한 알마다 다름) */
  attackId: number;
  knockback: number;
  /** 거리별 피해 감소 */
  falloffStart: number;
  falloffEnd: number;
  minFalloff: number;
  /** 궤적 색 · 굵기 */
  tracerColor: number;
  tracerWidth: number;
  /** 궤적 길이 (없으면 기본값) */
  tracerLength?: number;
  /** 저프레임 보정: 발사 후 이미 흐른 시간 */
  elapsed: number;
}

export interface ImpactEvent {
  point: THREE.Vector3;
  /** 표면 법선 (대상 피격이면 진행 반대 방향) */
  normal: THREE.Vector3;
  direction: THREE.Vector3;
  target: Damageable | null;
  /** 거리 감소가 적용된 피해 */
  damage: number;
  sourceId: string;
  attackId: number;
  knockback: number;
}

interface Projectile {
  active: boolean;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  traveled: number;
  range: number;
  damage: number;
  sourceId: string;
  attackId: number;
  knockback: number;
  falloffStart: number;
  falloffEnd: number;
  minFalloff: number;
  width: number;
  tracerLength: number;
  /** 남은 추가 관통 수 */
  pierceLeft: number;
  /** 이 탄이 이미 맞힌 대상 (같은 좀비에게 두 번 피해 주지 않음) */
  hits: Damageable[];
  /** 이번 스텝에 사라졌지만 마지막 위치까지 그리기 위한 플래그 */
  dying: boolean;
  mesh: THREE.Mesh;
}

/**
 * 투사체 시스템 (오브젝트 풀).
 * - 매 고정 스텝마다 이동 구간(선분)으로 장애물 · 피해 대상과 교차 검사 → 빠른 탄도 관통하지 않음
 * - 최대 사거리에 도달하거나 무언가에 맞으면 풀로 돌아간다
 * - 풀이 가득 차면 가장 오래된 탄을 재사용 → 투사체가 무한히 쌓이지 않음
 */
export class ProjectileSystem {
  private readonly pool: Projectile[] = [];
  private cursor = 0;
  private readonly hit: RayHit = { t: 0, x: 0, z: 0, nx: 0, nz: 0, collider: null as never };
  private readonly impact: ImpactEvent = {
    point: new THREE.Vector3(), normal: new THREE.Vector3(), direction: new THREE.Vector3(), target: null, damage: 0, sourceId: '', attackId: 0, knockback: 0,
  };
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly texture: THREE.CanvasTexture;
  /** 궤적 색별 재질 (총기마다 미리 만들어 두고 공유) */
  private readonly materials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly tmp = new THREE.Vector3();
  /** 누적 통계 (디버그 · 테스트) */
  stats = { spawned: 0, expired: 0, hitWorld: 0, hitTarget: 0, recycled: 0, pierced: 0 };

  onImpact: ((e: ImpactEvent) => void) | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly collision: CollisionWorld, private readonly targets: DamageableRegistry) {
    this.geometry = tracerGeometry();
    this.texture = tracerTexture();
    this.material = this.materialFor(0xffd28a);
    for (let i = 0; i < PROJECTILE_CONFIG.poolSize; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.pool.push({
        active: false, dying: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), dir: new THREE.Vector3(),
        speed: 0, traveled: 0, range: 0, damage: 0, sourceId: '', attackId: 0, knockback: 0, falloffStart: 999, falloffEnd: 999, minFalloff: 1, width: 0.08, tracerLength: 2.2,
        pierceLeft: 0, hits: [], mesh,
      });
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.active) n++;
    return n;
  }

  get capacity(): number {
    return this.pool.length;
  }

  /** 궤적 색 재질 (같은 색은 재사용) */
  materialFor(color: number): THREE.MeshBasicMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        map: this.texture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      });
      this.materials.set(color, m);
    }
    return m;
  }

  spawn(shot: BulletSpec): void {
    // 빈 슬롯을 찾고, 없으면 가장 오래된 탄을 재사용
    let p: Projectile | null = null;
    for (let k = 0; k < this.pool.length; k++) {
      const c = this.pool[(this.cursor + k) % this.pool.length];
      if (!c.active && !c.dying) { p = c; this.cursor = (this.cursor + k + 1) % this.pool.length; break; }
    }
    if (!p) {
      p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.pool.length;
      this.stats.recycled++;
    }
    p.active = true;
    p.dying = false;
    p.pos.copy(shot.origin);
    p.prev.copy(shot.origin);
    p.dir.copy(shot.direction).normalize();
    p.speed = shot.speed;
    p.range = shot.range;
    p.damage = shot.damage;
    p.sourceId = shot.sourceId;
    p.attackId = shot.attackId;
    p.knockback = shot.knockback;
    p.falloffStart = shot.falloffStart;
    p.falloffEnd = shot.falloffEnd;
    p.minFalloff = shot.minFalloff;
    p.width = shot.tracerWidth;
    p.tracerLength = shot.tracerLength ?? PROJECTILE_CONFIG.tracerLength;
    p.mesh.material = this.materialFor(shot.tracerColor);
    p.pierceLeft = shot.pierce;
    p.hits.length = 0;
    p.traveled = 0;
    this.stats.spawned++;
    // 저프레임에서 늦게 발사된 만큼 앞으로 진행
    if (shot.elapsed > 0) this.advance(p, shot.elapsed);
    p.prev.copy(shot.origin);
  }

  step(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.prev.copy(p.pos);
      this.advance(p, dt);
    }
  }

  /** 렌더: 이전 위치와 현재 위치 사이를 보간해 궤적을 그린다 */
  render(alpha: number): void {
    for (const p of this.pool) {
      const show = p.active || p.dying;
      p.mesh.visible = show;
      if (!show) continue;
      const head = this.tmp.lerpVectors(p.prev, p.pos, p.dying ? 1 : alpha);
      const traveled = Math.max(0.05, p.traveled - (p.dying ? 0 : (1 - alpha) * p.prev.distanceTo(p.pos)));
      const len = Math.min(p.tracerLength, traveled);
      p.mesh.position.copy(head);
      p.mesh.rotation.set(0, Math.atan2(p.dir.x, p.dir.z), 0);
      p.mesh.scale.set(p.width, p.width, len);
      // 사라진 탄은 마지막 구간을 한 프레임 그린 뒤 풀로 돌아간다
      if (p.dying) p.dying = false;
    }
  }

  clear(): void {
    for (const p of this.pool) { p.active = false; p.dying = false; p.mesh.visible = false; }
  }

  dispose(): void {
    for (const p of this.pool) this.scene.remove(p.mesh);
    this.geometry.dispose();
    this.texture.dispose();
    for (const m of this.materials.values()) m.dispose();
  }

  /**
   * 한 스텝 이동: 이동 구간(선분) 전체를 검사하므로 빠른 탄도 대상을 건너뛰지 않는다.
   * 관통이 남아 있으면 맞힌 대상을 기록하고 같은 구간의 나머지를 계속 검사한다.
   */
  private advance(p: Projectile, dt: number): void {
    let move = p.speed * dt;
    const remaining = p.range - p.traveled;
    let expire = false;
    if (move >= remaining) { move = remaining; expire = true; }
    const e = this.impact;
    for (let guard = 0; guard < 8; guard++) {
      const x0 = p.pos.x;
      const z0 = p.pos.z;
      const x1 = x0 + p.dir.x * move;
      const z1 = z0 + p.dir.z * move;
      const wall = this.collision.raycast(x0, z0, x1, z1, p.pos.y, this.hit);
      const wallT = wall ? wall.t : Infinity;
      const target = this.targets.raycast(x0, z0, x1, z1, p.pos.y, p.hits);
      if (target && target.t <= wallT) {
        const t = target.t;
        e.point.set(x0 + (x1 - x0) * t, p.pos.y, z0 + (z1 - z0) * t);
        e.normal.copy(p.dir).negate();
        e.target = target.target;
        this.stats.hitTarget++;
        if (p.pierceLeft > 0) {
          // 관통: 피해를 주고 계속 날아감
          p.pierceLeft--;
          p.hits.push(target.target);
          this.stats.pierced++;
          p.traveled += move * t;
          this.fillImpact(p, e);
          this.onImpact?.(e);
          // 관통할 때마다 다음 대상 피해 감소 (관통 + 고연사 조합의 수치 폭증 방지)
          p.damage *= PIERCE_DAMAGE_KEEP;
          p.traveled -= move * t;
          p.pos.copy(e.point);
          p.traveled += move * t;
          move *= 1 - t;
          continue;
        }
        p.hits.push(target.target);
        this.finish(p, e, move * t);
        return;
      }
      if (wall) {
        e.point.set(wall.x, p.pos.y, wall.z);
        e.normal.set(wall.nx, 0, wall.nz);
        e.target = null;
        this.stats.hitWorld++;
        this.finish(p, e, move * wall.t);
        return;
      }
      p.pos.set(x1, p.pos.y, z1);
      p.traveled += move;
      break;
    }
    if (expire) {
      p.active = false;
      p.dying = true;
      this.stats.expired++;
    }
  }

  private finish(p: Projectile, e: ImpactEvent, moved: number): void {
    p.pos.copy(e.point);
    p.traveled += moved;
    p.active = false;
    p.dying = true; // 이번 프레임은 맞은 지점까지 궤적을 그린다
    this.fillImpact(p, e);
    this.onImpact?.(e);
  }

  /** 거리별 피해 감소 (샷건: 가까우면 100%, 멀면 minFalloff 배) */
  private fillImpact(p: Projectile, e: ImpactEvent): void {
    e.direction.copy(p.dir);
    let k = 1;
    if (p.traveled > p.falloffStart) {
      const t = Math.min(1, (p.traveled - p.falloffStart) / Math.max(0.001, p.falloffEnd - p.falloffStart));
      k = 1 + (p.minFalloff - 1) * t;
    }
    e.damage = p.damage * k;
    e.sourceId = p.sourceId;
    e.attackId = p.attackId;
    e.knockback = p.knockback;
  }
}

/** 궤적: 머리가 원점, 꼬리가 -Z 방향으로 길이 1. 가로판 · 세로판 두 장을 교차 (어느 각도에서도 보임) */
function tracerGeometry(): THREE.BufferGeometry {
  const positions = [
    -0.5, 0, -1, 0.5, 0, -1, 0.5, 0, 0, -0.5, 0, 0,
    0, -0.5, -1, 0, 0.5, -1, 0, 0.5, 0, 0, -0.5, 0,
  ];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

/** 머리 쪽이 밝고 꼬리로 갈수록 사라지는 궤적 텍스처 */
function tracerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const along = ctx.createLinearGradient(0, 64, 0, 0); // canvas 위쪽 = v 1 = 머리
  along.addColorStop(0, 'rgba(255,170,60,0)');
  along.addColorStop(0.7, 'rgba(255,200,110,0.6)');
  along.addColorStop(1, 'rgba(255,250,220,1)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 16, 64);
  // 가로 방향 부드러운 가장자리
  ctx.globalCompositeOperation = 'destination-in';
  const across = ctx.createLinearGradient(0, 0, 16, 0);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 16, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
