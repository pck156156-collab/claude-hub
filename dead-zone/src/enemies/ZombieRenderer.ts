import * as THREE from 'three';
import { SPAWN_CONFIG, WAVE_CONFIG } from '../config/GameConfig';
import { clamp, damp, wrapAngle } from '../core/random';
import { Zombie, ZombieState } from './Zombie';

/** 동시에 그릴 수 있는 최대 좀비 수: 웨이브 상한 + 시체 */
const MAX = WAVE_CONFIG.limits.maxAlive + SPAWN_CONFIG.maxCorpses + 2;

interface PartDef {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** 좀비 1마리당 개수 (좌우 대칭 부위는 2) */
  perZombie: number;
  /** 색상 종류 */
  tint: 'skin' | 'shirt' | 'pants' | 'shoe' | 'eye';
  shadow: boolean;
}

/** 좀비별 애니메이션 상태 (시각 계층, 게임 로직에 영향 없음) */
interface AnimState {
  phase: number;
  walk: number;
  attack: number;
  hit: number;
  sway: number;
}

/**
 * 모든 좀비를 부위별 InstancedMesh 로 그린다 → 좀비 수와 무관하게 드로우콜 약 10회.
 * 지오메트리 · 재질은 전부 공유하고, 옷 색 · 피부색 · 피격 섬광은 인스턴스 색상으로 표현한다.
 * 숨겨진 뼈대(rig) 하나에 좀비마다 자세를 적용해 각 부위의 월드 행렬을 읽어 온다.
 */
export class ZombieRenderer {
  private readonly meshes = new Map<string, THREE.InstancedMesh>();
  private readonly parts: PartDef[];
  private readonly rig = buildRig();
  private readonly anim = new Map<number, AnimState>();
  private readonly color = new THREE.Color();
  private readonly white = new THREE.Color(1, 1, 1);
  private readonly bars: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly palette: { skin: THREE.Color[]; shirt: THREE.Color[]; pants: THREE.Color[] };
  private readonly disposables: { dispose(): void }[] = [];

  constructor(private readonly scene: THREE.Scene, appearance: { skin: number[]; shirts: number[]; pants: number[] }) {
    this.palette = {
      skin: appearance.skin.map((c) => new THREE.Color(c)),
      shirt: appearance.shirts.map((c) => new THREE.Color(c)),
      pants: appearance.pants.map((c) => new THREE.Color(c)),
    };
    const body = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.disposables.push(body, eyeMat);
    const geo = <T extends THREE.BufferGeometry>(g: T) => { this.disposables.push(g); return g; };
    this.parts = [
      { key: 'pelvis', geometry: geo(new THREE.BoxGeometry(0.32, 0.18, 0.2)), material: body, perZombie: 1, tint: 'pants', shadow: true },
      { key: 'thigh', geometry: geo(new THREE.CapsuleGeometry(0.075, 0.3, 3, 8).translate(0, -0.21, 0)), material: body, perZombie: 2, tint: 'pants', shadow: true },
      { key: 'shin', geometry: geo(new THREE.CapsuleGeometry(0.065, 0.28, 3, 8).translate(0, -0.2, 0)), material: body, perZombie: 2, tint: 'pants', shadow: true },
      { key: 'foot', geometry: geo(new THREE.BoxGeometry(0.11, 0.08, 0.24).translate(0, -0.04, 0.05)), material: body, perZombie: 2, tint: 'shoe', shadow: true },
      { key: 'torso', geometry: geo(torsoGeometry()), material: body, perZombie: 1, tint: 'shirt', shadow: true },
      { key: 'upperArm', geometry: geo(new THREE.CapsuleGeometry(0.058, 0.2, 3, 8).translate(0, -0.15, 0)), material: body, perZombie: 2, tint: 'shirt', shadow: true },
      { key: 'foreArm', geometry: geo(new THREE.CapsuleGeometry(0.048, 0.2, 3, 8).translate(0, -0.14, 0)), material: body, perZombie: 2, tint: 'skin', shadow: true },
      { key: 'hand', geometry: geo(new THREE.BoxGeometry(0.08, 0.11, 0.05).translate(0, -0.05, 0)), material: body, perZombie: 2, tint: 'skin', shadow: false },
      { key: 'head', geometry: geo(new THREE.SphereGeometry(0.12, 12, 10).scale(0.95, 1.12, 1.02)), material: body, perZombie: 1, tint: 'skin', shadow: true },
      { key: 'jaw', geometry: geo(new THREE.BoxGeometry(0.15, 0.05, 0.1).translate(0, -0.02, 0.03)), material: body, perZombie: 1, tint: 'skin', shadow: false },
      { key: 'eyes', geometry: geo(eyesGeometry()), material: eyeMat, perZombie: 1, tint: 'eye', shadow: false },
    ];
    for (const p of this.parts) {
      const mesh = new THREE.InstancedMesh(p.geometry, p.material, MAX * p.perZombie);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = p.shadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `zombie-${p.key}`;
      for (let i = 0; i < MAX * p.perZombie; i++) mesh.setColorAt(i, this.white);
      scene.add(mesh);
      this.meshes.set(p.key, mesh);
    }

    // 체력 바 (카메라를 향하는 판, 배경 + 채움 = 좀비당 2개)
    const barGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, toneMapped: false, transparent: true, opacity: 0.9 });
    this.disposables.push(barGeo, barMat);
    this.bars = new THREE.InstancedMesh(barGeo, barMat, MAX * 2);
    this.bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bars.frustumCulled = false;
    this.bars.renderOrder = 30;
    this.bars.count = 0;
    for (let i = 0; i < MAX * 2; i++) this.bars.setColorAt(i, this.white);
    scene.add(this.bars);
  }

  get drawCalls(): number {
    return this.parts.length + 1;
  }

  /** 렌더 프레임마다: 좀비 상태 → 자세 → 인스턴스 행렬 */
  update(dt: number, zombies: readonly Zombie[], alpha: number, camera: THREE.Camera): void {
    const counts = new Map<string, number>();
    for (const p of this.parts) counts.set(p.key, 0);
    let barCount = 0;
    camera.getWorldQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);

    // 사라진 좀비의 애니메이션 상태 정리
    if (this.anim.size > zombies.length * 2 + 8) {
      const live = new Set(zombies.map((z) => z.id));
      for (const id of this.anim.keys()) if (!live.has(id)) this.anim.delete(id);
    }

    for (const z of zombies) {
      let a = this.anim.get(z.id);
      if (!a) { a = { phase: z.variant * 10, walk: 0, attack: 0, hit: 0, sway: 0 }; this.anim.set(z.id, a); }
      this.pose(z, a, dt, alpha);
      this.rig.root.updateMatrixWorld(true);

      const flash = z.flash;
      for (const p of this.parts) {
        const mesh = this.meshes.get(p.key)!;
        const nodes = this.rig.nodes[p.key];
        let idx = counts.get(p.key)!;
        for (const n of nodes) {
          mesh.setMatrixAt(idx, n.matrixWorld);
          this.tint(p.tint, z, flash);
          mesh.setColorAt(idx, this.color);
          idx++;
        }
        counts.set(p.key, idx);
      }

      // 체력 바: 피해를 입은 살아 있는 좀비만
      if (z.alive && z.health < z.maxHealth) {
        const ratio = z.health / z.maxHealth;
        const w = 0.8;
        const base = this.v.lerpVectors(z.prevPosition, z.position, alpha).setY(2.05).addScaledVector(this.right, -w / 2);
        this.m.compose(base, this.q, this.s.set(w, 0.08, 1));
        this.bars.setMatrixAt(barCount, this.m);
        this.bars.setColorAt(barCount, this.color.setRGB(0.05, 0.05, 0.05));
        barCount++;
        this.m.compose(base.addScaledVector(this.right, 0.02), this.q, this.s.set((w - 0.04) * ratio, 0.05, 1));
        this.bars.setMatrixAt(barCount, this.m);
        this.bars.setColorAt(barCount, this.color.setHSL(0.02 + 0.1 * ratio, 0.85, 0.5));
        barCount++;
      }
    }

    for (const p of this.parts) {
      const mesh = this.meshes.get(p.key)!;
      mesh.count = counts.get(p.key)!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.bars.count = barCount;
    this.bars.instanceMatrix.needsUpdate = true;
    if (this.bars.instanceColor) this.bars.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.meshes.values()) { this.scene.remove(m); m.dispose(); }
    this.scene.remove(this.bars);
    this.bars.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private tint(kind: PartDef['tint'], z: Zombie, flash: number): void {
    const v = z.variant;
    const pick = (list: THREE.Color[], salt: number) => list[Math.floor(((v * 9973 + salt) % 1) * list.length) % list.length];
    switch (kind) {
      case 'skin': this.color.copy(pick(this.palette.skin, 0.13)); break;
      case 'shirt': this.color.copy(pick(this.palette.shirt, 0.41)); break;
      case 'pants': this.color.copy(pick(this.palette.pants, 0.77)); break;
      case 'shoe': this.color.setRGB(0.09, 0.08, 0.07); break;
      case 'eye': this.color.setRGB(1.0, 0.85, 0.35); if (!z.alive) this.color.setRGB(0.15, 0.12, 0.1); return;
    }
    if (!z.alive) this.color.multiplyScalar(0.7);
    // 피격 섬광: 흰색 쪽으로
    if (flash > 0) this.color.lerp(this.white, flash * 0.6).multiplyScalar(1 + flash * 0.8);
  }

  /** 좀비 상태 → 뼈대 자세 (절차적 애니메이션) */
  private pose(z: Zombie, a: AnimState, dt: number, alpha: number): void {
    const r = this.rig;
    const s = z.stats;
    const hunch = s.appearance.hunch;
    const pos = this.v.lerpVectors(z.prevPosition, z.position, alpha);
    const yaw = z.prevYaw + wrapAngle(z.yaw - z.prevYaw) * alpha;
    const t = performance.now() / 1000 + z.variant * 7;

    const moving = z.state === ZombieState.Chase ? clamp(z.moveSpeed / s.moveSpeed, 0, 1.2) : 0;
    a.walk += (moving - a.walk) * damp(8, dt);
    a.phase += (z.moveSpeed * dt / 0.55) * Math.PI;
    const attacking = z.state === ZombieState.Attack ? 1 : 0;
    a.attack += (attacking - a.attack) * damp(14, dt);
    a.hit = Math.max(a.hit * Math.exp(-10 * dt), z.hitKick);
    z.hitKick = 0;

    r.root.position.set(pos.x, 0, pos.z);
    r.root.rotation.set(0, yaw, 0);
    r.root.scale.setScalar(s.appearance.scale);

    // ── 생성: 땅속에서 기어 나옴
    let rise = 0;
    if (z.state === ZombieState.Spawn) {
      const k = clamp(z.stateTime / s.spawnTime, 0, 1);
      rise = (1 - easeOut(k)) * 1.7;
    }
    // ── 사망: 뒤로 쓰러진 뒤 가라앉음
    let fall = 0;
    let sink = 0;
    if (!z.alive) {
      fall = easeOutBounce(clamp(z.deadTime / 0.7, 0, 1));
      if (z.sinking) sink = clamp((z.deadTime - s.corpseTime) / 1.2, 0, 1) * 0.6;
    }

    const walk = a.walk;
    const ph = a.phase;
    // 다리: 한쪽 다리를 끄는 비대칭 걸음
    const swingL = Math.sin(ph) * 0.5 * walk;
    const swingR = Math.sin(ph + Math.PI) * 0.32 * walk;
    r.thighL.rotation.set(-swingL, 0, 0.04);
    r.thighR.rotation.set(-swingR, 0, -0.06);
    r.kneeL.rotation.x = Math.max(0, Math.cos(ph)) * 0.8 * walk + 0.12;
    r.kneeR.rotation.x = Math.max(0, Math.cos(ph + Math.PI)) * 0.35 * walk + 0.2;
    const bob = Math.abs(Math.sin(ph)) * 0.04 * walk;

    // 몸통: 구부정 + 비틀린 자세, 걸음에 따라 좌우로 흔들림
    a.sway = Math.sin(ph) * 0.12 * walk + Math.sin(t * 1.3) * 0.04;
    r.hips.position.y = 0.86 - 0.04 - bob - rise;
    r.spine.position.y = r.hips.position.y;
    const lunge = a.attack * attackCurve(z.state === ZombieState.Attack ? z.stateTime / s.attackWindup : 2);
    r.spine.rotation.set(hunch + lunge * 0.35 - a.hit * 0.35, Math.sin(t * 0.7) * 0.08, a.sway + 0.08);

    // 머리: 옆으로 꺾이고 까딱거림
    r.neck.rotation.set(-hunch * 0.7 + Math.sin(t * 2.3) * 0.08, 0.15 * Math.sin(t * 0.9), 0.32 + Math.sin(t * 1.7) * 0.06);

    // 팔: 앞으로 뻗은 채 흔들림, 공격 시 위로 들었다가 내려침
    const reach = 1.25 - 0.15 * walk;
    const armSwing = Math.sin(t * 3.1) * 0.12;
    const raise = a.attack * (lunge > 0 ? -0.9 * lunge + 0.6 : 0.6);
    r.shoulderL.rotation.set(-reach - armSwing - raise, 0, 0.12);
    r.shoulderR.rotation.set(-reach * 0.85 + armSwing - raise, 0, -0.2);
    r.elbowL.rotation.x = -0.25 - a.attack * 0.3;
    r.elbowR.rotation.x = -0.45 - a.attack * 0.3;

    // 생성 중: 팔을 허우적거림
    if (rise > 0) {
      r.shoulderL.rotation.x = -2.4 + Math.sin(t * 9) * 0.4;
      r.shoulderR.rotation.x = -2.2 + Math.sin(t * 8 + 1) * 0.4;
    }

    // 쓰러짐: 발 위치를 축으로 뒤로 넘어감
    r.fallPivot.rotation.x = -fall * (Math.PI / 2 - 0.12);
    r.fallPivot.position.y = fall * 0.12 - sink;
    if (fall > 0) {
      r.shoulderL.rotation.x = -2.6;
      r.shoulderR.rotation.x = -0.4;
      r.thighL.rotation.x = -0.25;
      r.thighR.rotation.x = 0.15;
    }
  }
}

interface Rig {
  root: THREE.Object3D;
  fallPivot: THREE.Object3D;
  hips: THREE.Object3D;
  spine: THREE.Object3D;
  neck: THREE.Object3D;
  thighL: THREE.Object3D; thighR: THREE.Object3D;
  kneeL: THREE.Object3D; kneeR: THREE.Object3D;
  shoulderL: THREE.Object3D; shoulderR: THREE.Object3D;
  elbowL: THREE.Object3D; elbowR: THREE.Object3D;
  nodes: Record<string, THREE.Object3D[]>;
}

/** 보이지 않는 뼈대: 각 부위 노드의 matrixWorld 가 인스턴스 행렬이 된다 */
function buildRig(): Rig {
  const o = (parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const n = new THREE.Object3D();
    n.position.set(x, y, z);
    parent.add(n);
    return n;
  };
  const root = new THREE.Object3D();
  const fallPivot = o(root);
  const hips = o(fallPivot, 0, 0.82, 0);
  const spine = o(fallPivot, 0, 0.82, 0);
  const pelvis = o(hips);
  const thighL = o(hips, 0.1, -0.05, 0);
  const thighR = o(hips, -0.1, -0.05, 0);
  const kneeL = o(thighL, 0, -0.42, 0);
  const kneeR = o(thighR, 0, -0.42, 0);
  const shinL = o(kneeL); const shinR = o(kneeR);
  const footL = o(kneeL, 0, -0.38, 0); const footR = o(kneeR, 0, -0.38, 0);
  const thighMeshL = o(thighL); const thighMeshR = o(thighR);
  const torso = o(spine, 0, 0.27, 0);
  const neck = o(spine, 0, 0.55, 0.02);
  const head = o(neck, 0, 0.13, 0.02);
  const jaw = o(head, 0, -0.09, 0.05);
  jaw.rotation.x = 0.3; // 벌어진 턱
  const eyes = o(head, 0, 0.02, 0.105);
  const shoulderL = o(spine, 0.21, 0.47, 0);
  const shoulderR = o(spine, -0.21, 0.47, 0);
  const upperL = o(shoulderL); const upperR = o(shoulderR);
  const elbowL = o(shoulderL, 0, -0.3, 0); const elbowR = o(shoulderR, 0, -0.3, 0);
  const foreL = o(elbowL); const foreR = o(elbowR);
  const handL = o(elbowL, 0, -0.28, 0); const handR = o(elbowR, 0, -0.28, 0);
  return {
    root, fallPivot, hips, spine, neck, thighL, thighR, kneeL, kneeR, shoulderL, shoulderR, elbowL, elbowR,
    nodes: {
      pelvis: [pelvis], thigh: [thighMeshL, thighMeshR], shin: [shinL, shinR], foot: [footL, footR],
      torso: [torso], upperArm: [upperL, upperR], foreArm: [foreL, foreR], hand: [handL, handR],
      head: [head], jaw: [jaw], eyes: [eyes],
    },
  };
}

/** 찢어진 셔츠 느낌: 아래가 넓고 어깨가 처진 몸통 */
function torsoGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.4, 0.52, 0.24, 2, 3, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const x = pos.getX(i);
    // 위로 갈수록 좁게, 오른쪽 어깨를 낮춤
    const k = 1 - Math.max(0, y) * 0.35;
    pos.setX(i, x * k);
    if (y > 0.2 && x < 0) pos.setY(i, y - 0.04);
    // 밑단을 들쭉날쭉하게 (찢어진 옷)
    if (y < -0.25) pos.setY(i, y + (Math.sin(x * 40) * 0.03));
  }
  g.computeVertexNormals();
  return g;
}

function eyesGeometry(): THREE.BufferGeometry {
  const a = new THREE.BoxGeometry(0.035, 0.02, 0.01).translate(0.04, 0, 0);
  const b = new THREE.BoxGeometry(0.035, 0.02, 0.01).translate(-0.04, 0, 0);
  const pos = [...(a.getAttribute('position').array as Float32Array), ...(b.getAttribute('position').array as Float32Array)];
  const idxA = [...(a.getIndex()!.array as Uint16Array)];
  const n = a.getAttribute('position').count;
  const idx = [...idxA, ...idxA.map((i) => i + n)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  a.dispose(); b.dispose();
  return g;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBounce(t: number): number {
  if (t < 0.75) return easeOut(t / 0.75) * 1.0;
  const k = (t - 0.75) / 0.25;
  return 1 - Math.sin(k * Math.PI) * 0.06;
}

/** 공격 동작: 0~1 예비 동작(뒤로 젖힘, 음수) → 1 이후 내려침(양수) */
function attackCurve(p: number): number {
  if (p < 1) return -0.6 * Math.sin(p * Math.PI * 0.5);
  return Math.max(0, 1 - (p - 1) * 0.8);
}
