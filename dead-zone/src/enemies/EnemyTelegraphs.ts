import * as THREE from 'three';
import { dangerZone } from './EnemyBehaviors';
import { DangerZone, Zombie, ZombieContext, emptyZone } from './Zombie';

interface Slot {
  outline: THREE.Mesh;
  fill: THREE.Mesh;
}

const MAX_ZONES = 14;

/**
 * 적 공격 위험 범위를 바닥에 그린다 (보스 패턴 · 폭발 준비 · 탱커 내려치기).
 * 범위 값은 EnemyBehaviors.dangerZone 에서 가져오며, 피해 판정(zoneContains)도 같은 값을 쓴다
 * → 표시된 범위 = 실제 피해 범위. "플레이어 중심이 범위 안이면 피해" 기준.
 * - 외곽선: 전체 범위
 * - 채움: 준비 진행도 (가득 차는 순간 판정)
 */
export class EnemyTelegraphs {
  private readonly slots: Slot[] = [];
  private readonly ring: THREE.BufferGeometry;
  private readonly disc: THREE.BufferGeometry;
  private readonly laneOutline: THREE.BufferGeometry;
  private readonly lane: THREE.BufferGeometry;
  private readonly sectorCache = new Map<number, { outline: THREE.BufferGeometry; fill: THREE.BufferGeometry }>();
  private readonly zone: DangerZone = emptyZone();
  private clock = 0;
  /** 이번 프레임에 그린 범위 (테스트 · 디버그) */
  readonly drawn: DangerZone[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.ring = new THREE.RingGeometry(0.955, 1, 64).rotateX(-Math.PI / 2);
    this.disc = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    // 직선: 로컬 z 0~1, x -1~1 (길이 · 반폭으로 늘림)
    this.lane = new THREE.PlaneGeometry(2, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.laneOutline = laneOutlineGeometry();
    for (let i = 0; i < MAX_ZONES; i++) {
      const mk = (g: THREE.BufferGeometry, order: number) => {
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          color: 0xff3020, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
        }));
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = order;
        scene.add(mesh);
        return mesh;
      };
      this.slots.push({ outline: mk(this.ring, 3), fill: mk(this.disc, 2) });
    }
  }

  update(dt: number, zombies: readonly Zombie[], ctx: ZombieContext): void {
    this.clock += dt;
    let n = 0;
    this.drawn.length = 0;
    for (const z of zombies) {
      if (n >= MAX_ZONES) break;
      if (!dangerZone(z, ctx, this.zone)) continue;
      this.draw(this.slots[n++], this.zone);
      this.drawn.push({ ...this.zone });
    }
    for (let i = n; i < MAX_ZONES; i++) { this.slots[i].outline.visible = false; this.slots[i].fill.visible = false; }
  }

  private draw(slot: Slot, zn: DangerZone): void {
    const { outline, fill } = slot;
    const om = outline.material as THREE.MeshBasicMaterial;
    const fm = fill.material as THREE.MeshBasicMaterial;
    om.color.setHex(zn.color);
    fm.color.setHex(zn.color);
    // 판정이 가까울수록 외곽선이 빠르게 깜빡임
    const blink = zn.mode === 'active' ? 0.6 : 0.55 + 0.45 * Math.abs(Math.sin(this.clock * (6 + zn.progress * 16)));
    om.opacity = 0.75 * blink;
    fm.opacity = zn.mode === 'active' ? 0.22 : 0.12 + 0.3 * zn.progress;
    const y = 0.035;
    outline.visible = fill.visible = true;
    outline.position.set(zn.x, y + 0.002, zn.z);
    fill.position.set(zn.x, y, zn.z);
    outline.rotation.set(0, zn.yaw, 0);
    fill.rotation.set(0, zn.yaw, 0);
    if (zn.shape === 'circle') {
      outline.geometry = this.ring;
      fill.geometry = this.disc;
      outline.scale.set(zn.radius, 1, zn.radius);
      // 채움이 바깥 원까지 자라는 순간 = 판정
      const r = Math.max(0.05, zn.radius * zn.progress);
      fill.scale.set(r, 1, r);
    } else if (zn.shape === 'sector') {
      const g = this.sector(zn.half);
      outline.geometry = g.outline;
      fill.geometry = g.fill;
      outline.scale.set(zn.radius, 1, zn.radius);
      const r = Math.max(0.05, zn.radius * zn.progress);
      fill.scale.set(r, 1, r);
    } else {
      outline.geometry = this.laneOutline;
      fill.geometry = this.lane;
      outline.scale.set(zn.half, 1, Math.max(0.01, zn.radius));
      const len = zn.mode === 'active' ? zn.radius : zn.radius * zn.progress;
      fill.scale.set(zn.half, 1, Math.max(0.01, len));
    }
  }

  /** 반각 half 의 부채꼴 (반지름 1, +z 정면). 각도별로 한 번만 만든다 */
  private sector(half: number) {
    const key = Math.round(half * 1000);
    let g = this.sectorCache.get(key);
    if (!g) {
      // RingGeometry 는 XY 평면 (각도 0 = +x). 눕히면 -90° 방향이 +z
      const start = -Math.PI / 2 - half;
      const outline = mergeOutline(new THREE.RingGeometry(0.955, 1, 40, 1, start, half * 2), half);
      const fill = new THREE.CircleGeometry(1, 40, start, half * 2).rotateX(-Math.PI / 2);
      g = { outline, fill };
      this.sectorCache.set(key, g);
    }
    return g;
  }

  clear(): void {
    for (const s of this.slots) { s.outline.visible = false; s.fill.visible = false; }
    this.drawn.length = 0;
  }

  dispose(): void {
    for (const s of this.slots) {
      for (const m of [s.outline, s.fill]) { this.scene.remove(m); (m.material as THREE.Material).dispose(); }
    }
    this.ring.dispose(); this.disc.dispose(); this.lane.dispose(); this.laneOutline.dispose();
    for (const g of this.sectorCache.values()) { g.outline.dispose(); g.fill.dispose(); }
  }
}

/** 직선 외곽선: 양옆 두 선 + 끝선 (로컬 x ±1, z 0~1) */
function laneOutlineGeometry(): THREE.BufferGeometry {
  const w = 0.045;
  const parts = [
    new THREE.PlaneGeometry(w, 1).rotateX(-Math.PI / 2).translate(-1 + w / 2, 0, 0.5),
    new THREE.PlaneGeometry(w, 1).rotateX(-Math.PI / 2).translate(1 - w / 2, 0, 0.5),
    new THREE.PlaneGeometry(2, 0.02).rotateX(-Math.PI / 2).translate(0, 0, 0.99),
  ];
  return merge(parts);
}

/** 부채꼴 외곽선: 바깥 호 + 양쪽 반지름 선 */
function mergeOutline(arc: THREE.RingGeometry, half: number): THREE.BufferGeometry {
  arc.rotateX(-Math.PI / 2);
  const w = 0.04;
  const sides = [-half, half].map((a) => new THREE.PlaneGeometry(w, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5).rotateY(a));
  return merge([arc, ...sides]);
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const geo = g.index ? g : g;
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    if (geo.index) for (let i = 0; i < geo.index.count; i++) idx.push(geo.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
