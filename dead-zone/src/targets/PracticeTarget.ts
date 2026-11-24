import * as THREE from 'three';
import { TARGET_CONFIG } from '../config/GameConfig';
import { Damageable, HitInfo, HitShape } from '../combat/Damageable';
import { bullseyeTexture } from '../world/textures';

export type TargetEvent = 'hit' | 'destroyed' | 'respawned';

/** 모든 표적이 공유하는 지오메트리 · 재질 (한 번만 생성) */
class TargetAssets {
  readonly geometries: Record<string, THREE.BufferGeometry>;
  readonly materials: Record<string, THREE.MeshStandardMaterial>;
  readonly barBg: THREE.SpriteMaterial;
  readonly barFill: THREE.SpriteMaterial;

  constructor() {
    const board = new THREE.Shape();
    // 사람 상반신 실루엣 합판 (폭 0.8, 높이 1.1)
    board.moveTo(-0.4, 0);
    board.lineTo(0.4, 0);
    board.lineTo(0.4, 0.62);
    board.quadraticCurveTo(0.38, 0.74, 0.2, 0.76);
    board.lineTo(0.12, 0.8);
    board.quadraticCurveTo(0.17, 1.08, 0, 1.1);
    board.quadraticCurveTo(-0.17, 1.08, -0.12, 0.8);
    board.lineTo(-0.2, 0.76);
    board.quadraticCurveTo(-0.38, 0.74, -0.4, 0.62);
    board.closePath();
    const boardGeo = new THREE.ExtrudeGeometry(board, { depth: 0.04, bevelEnabled: false }).translate(0, 0, -0.02);
    this.geometries = {
      base: new THREE.BoxGeometry(0.9, 0.3, 0.6),
      post: new THREE.BoxGeometry(0.09, 0.95, 0.09),
      brace: new THREE.BoxGeometry(0.05, 0.6, 0.05),
      board: boardGeo,
      eye: new THREE.CircleGeometry(0.2, 24),
    };
    this.materials = {
      base: new THREE.MeshStandardMaterial({ color: 0x7d7a73, roughness: 0.95 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.9 }),
      board: new THREE.MeshStandardMaterial({ color: 0xc8b58c, roughness: 0.85 }),
      eye: new THREE.MeshStandardMaterial({ map: bullseyeTexture(), roughness: 0.8 }),
    };
    this.barBg = new THREE.SpriteMaterial({ color: 0x111111, transparent: true, opacity: 0.7, depthTest: false, toneMapped: false });
    this.barFill = new THREE.SpriteMaterial({ color: 0xffffff, depthTest: false, toneMapped: false });
  }

  dispose(): void {
    for (const g of Object.values(this.geometries)) g.dispose();
    for (const m of Object.values(this.materials)) { m.map?.dispose(); m.dispose(); }
    this.barBg.dispose();
    this.barFill.dispose();
  }
}

let shared: TargetAssets | null = null;
let users = 0;

/**
 * 연습용 표적: 콘크리트 받침 + 기둥 + 사람 모양 합판.
 * Damageable 을 구현하므로 무기 시스템은 좀비와 똑같이 이 대상에게 피해를 준다.
 * 피격: 흰 섬광 + 맞은 방향으로 흔들림 / 파괴: 합판이 사라지고 일정 시간 뒤 재생성.
 * (콘크리트 받침은 남아서 이동 충돌을 유지한다)
 */
export class PracticeTarget implements Damageable {
  readonly root = new THREE.Group();
  readonly hitShape: HitShape;
  readonly maxHealth = TARGET_CONFIG.maxHealth;
  readonly material = 'wood' as const;
  health = TARGET_CONFIG.maxHealth;
  alive = true;
  respawnTimer = 0;
  /** 누적 통계 */
  hits = 0;
  destroyedCount = 0;

  private readonly pivot = new THREE.Group();
  private readonly flashMats: THREE.MeshStandardMaterial[];
  private flash = 0;
  /** 흔들림 (스프링): 맞은 방향으로 기울었다가 복귀 */
  private tiltX = 0; private tiltZ = 0; private tiltVX = 0; private tiltVZ = 0;
  private spawnScale = 1;
  private readonly bar: THREE.Group;
  private readonly barFill: THREE.Sprite;
  private barTimer = 0;
  private readonly assets: TargetAssets;
  private readonly tmp = new THREE.Vector3();

  onEvent: ((target: PracticeTarget, e: TargetEvent, hit?: HitInfo) => void) | null = null;

  constructor(x: number, z: number, facing: number) {
    if (!shared) shared = new TargetAssets();
    users++;
    this.assets = shared;
    const A = this.assets;
    this.hitShape = { x, z, radius: TARGET_CONFIG.radius, yMin: 0.3, yMax: TARGET_CONFIG.height };
    this.root.position.set(x, 0, z);
    this.root.rotation.y = facing;

    const base = new THREE.Mesh(A.geometries.base, A.materials.base);
    base.position.y = 0.15;
    base.castShadow = base.receiveShadow = true;
    this.root.add(base);

    // 피격 섬광은 표적마다 따로 (재질 복제)
    const board = A.materials.board.clone();
    const wood = A.materials.wood.clone();
    const eye = A.materials.eye.clone();
    this.flashMats = [board, wood, eye];
    for (const m of this.flashMats) m.emissive = new THREE.Color(0xffffff);

    this.pivot.position.y = 0.3;
    this.root.add(this.pivot);
    const post = new THREE.Mesh(A.geometries.post, wood);
    post.position.y = 0.47;
    const brace1 = new THREE.Mesh(A.geometries.brace, wood);
    brace1.position.set(0.25, 0.25, -0.1);
    brace1.rotation.z = 0.7;
    const brace2 = brace1.clone();
    brace2.position.x = -0.25;
    brace2.rotation.z = -0.7;
    const boardMesh = new THREE.Mesh(A.geometries.board, board);
    boardMesh.position.y = 0.6;
    const eyeMesh = new THREE.Mesh(A.geometries.eye, eye);
    eyeMesh.position.set(0, 1.0, 0.022);
    const eyeBack = eyeMesh.clone();
    eyeBack.position.z = -0.022;
    eyeBack.rotation.y = Math.PI;
    for (const m of [post, brace1, brace2, boardMesh, eyeMesh]) { m.castShadow = true; m.receiveShadow = true; }
    this.pivot.add(post, brace1, brace2, boardMesh, eyeMesh, eyeBack);

    // 체력 바 (카메라를 향하는 스프라이트, 피격 후 잠시 표시)
    this.bar = new THREE.Group();
    this.bar.position.y = 2.25;
    const bg = new THREE.Sprite(A.barBg);
    bg.scale.set(0.92, 0.1, 1);
    this.barFill = new THREE.Sprite(A.barFill.clone());
    this.barFill.center.set(0, 0.5);
    this.barFill.position.x = -0.44;
    this.barFill.scale.set(0.88, 0.06, 1);
    bg.renderOrder = this.barFill.renderOrder = 20;
    this.bar.add(bg, this.barFill);
    this.bar.visible = false;
    this.root.add(this.bar);
  }

  canBeHit(): boolean {
    return this.alive;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  takeDamage(hit: HitInfo): void {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - hit.damage);
    this.hits++;
    this.flash = 1;
    this.barTimer = 2.5;
    // 맞은 방향으로 기울이기 (로컬 좌표로 변환)
    const inv = -this.root.rotation.y;
    const lx = hit.direction.x * Math.cos(inv) + hit.direction.z * Math.sin(inv);
    const lz = -hit.direction.x * Math.sin(inv) + hit.direction.z * Math.cos(inv);
    this.tiltVX += lz * 3.2;
    this.tiltVZ -= lx * 3.2;
    this.onEvent?.(this, 'hit', hit);
    if (this.health <= 0) {
      this.alive = false;
      this.destroyedCount++;
      this.respawnTimer = TARGET_CONFIG.respawnDelay;
      this.pivot.visible = false;
      this.bar.visible = false;
      this.onEvent?.(this, 'destroyed', hit);
    }
  }

  /** 게임 로직 스텝: 재생성 타이머 */
  step(dt: number): void {
    if (this.alive) return;
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) this.respawn();
  }

  respawn(): void {
    this.alive = true;
    this.health = this.maxHealth;
    this.pivot.visible = true;
    this.spawnScale = 0;
    this.tiltX = this.tiltZ = this.tiltVX = this.tiltVZ = 0;
    this.onEvent?.(this, 'respawned');
  }

  /** 시각 효과 (렌더 프레임마다) */
  update(dt: number): void {
    // 스프링 흔들림
    const k = 120;
    const c = 9;
    this.tiltVX += (-k * this.tiltX - c * this.tiltVX) * dt;
    this.tiltVZ += (-k * this.tiltZ - c * this.tiltVZ) * dt;
    this.tiltX += this.tiltVX * dt;
    this.tiltZ += this.tiltVZ * dt;
    this.pivot.rotation.set(this.tiltX, 0, this.tiltZ);

    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 9);
    for (const m of this.flashMats) m.emissiveIntensity = this.flash * 1.4;

    if (this.spawnScale < 1) {
      this.spawnScale = Math.min(1, this.spawnScale + dt * 3);
      const s = easeOutBack(this.spawnScale);
      this.pivot.scale.set(1, s, 1);
    }

    if (this.barTimer > 0 && this.alive) {
      this.barTimer -= dt;
      this.bar.visible = this.health < this.maxHealth;
      const r = this.health / this.maxHealth;
      this.barFill.scale.x = Math.max(0.001, 0.88 * r);
      (this.barFill.material as THREE.SpriteMaterial).color.setHSL(0.33 * r, 0.85, 0.5);
    } else {
      this.bar.visible = false;
    }
  }

  /** 파괴 효과를 낼 중심점 */
  center(out: THREE.Vector3 = this.tmp): THREE.Vector3 {
    return out.set(this.root.position.x, 1.0, this.root.position.z);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.flashMats) m.dispose();
    (this.barFill.material as THREE.Material).dispose();
    users--;
    if (users <= 0 && shared) { shared.dispose(); shared = null; }
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
