import * as THREE from 'three';
import { BuildDef, SPAWN_CONFIG, WAVE_CONFIG, ZombieStats } from '../config/GameConfig';
import { clamp, damp, wrapAngle } from '../core/random';
import { ELITE_CONFIG } from './EnemyData';
import { Zombie, ZombieState } from './Zombie';

/** 기본 체형 (워커) */
const DEFAULT_BUILD: BuildDef = { torso: [1, 1, 1], limb: 1, head: 1, shoulder: 1, belly: 0, bellyZ: 0 };
type Palette = { skin: THREE.Color[]; shirt: THREE.Color[]; pants: THREE.Color[]; glow: THREE.Color; eye: THREE.Color };

/** 동시에 그릴 수 있는 최대 좀비 수: 웨이브 상한 + 시체 */
const MAX = WAVE_CONFIG.limits.maxAlive + SPAWN_CONFIG.maxCorpses + 2;

interface PartDef {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** 좀비 1마리당 개수 (좌우 대칭 부위는 2) */
  perZombie: number;
  /** 색상 종류 */
  tint: 'skin' | 'shirt' | 'pants' | 'shoe' | 'eye' | 'glow' | 'bone' | 'aura';
  shadow: boolean;
  /** 이 부위를 그릴 좀비 (없으면 전부) */
  only?: (z: Zombie) => boolean;
  /** 체형 배율 축 */
  build?: 'torso' | 'limb' | 'leg' | 'head' | 'belly';
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
  private readonly palettes = new Map<ZombieStats['appearance'], Palette>();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly partScale = new THREE.Vector3();
  private readonly gold = new THREE.Color(ELITE_CONFIG.color);
  /** 이번 프레임에 화면 밖이라 그리지 않은 좀비 수 (디버그) */
  culled = 0;
  private readonly disposables: { dispose(): void }[] = [];
  /** 애니메이션 시계 (게임이 멈추면 같이 멈춤) */
  private clock = 0;

  constructor(private readonly scene: THREE.Scene, appearance: ZombieStats['appearance']) {
    this.palette(appearance);
    const body = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const auraMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.disposables.push(body, eyeMat, auraMat);
    const hasBelly = (z: Zombie) => (z.stats.appearance.build?.belly ?? 0) > 0;
    const hasGlow = (z: Zombie) => z.stats.appearance.glow !== undefined;
    const geo = <T extends THREE.BufferGeometry>(g: T) => { this.disposables.push(g); return g; };
    this.parts = [
      { key: 'pelvis', geometry: geo(new THREE.BoxGeometry(0.32, 0.18, 0.2)), material: body, perZombie: 1, tint: 'pants', shadow: true },
      { key: 'thigh', geometry: geo(new THREE.CapsuleGeometry(0.075, 0.3, 3, 8).translate(0, -0.21, 0)), material: body, perZombie: 2, tint: 'pants', shadow: true, build: 'leg' },
      { key: 'shin', geometry: geo(new THREE.CapsuleGeometry(0.065, 0.28, 3, 8).translate(0, -0.2, 0)), material: body, perZombie: 2, tint: 'pants', shadow: true, build: 'leg' },
      { key: 'foot', geometry: geo(new THREE.BoxGeometry(0.11, 0.08, 0.24).translate(0, -0.04, 0.05)), material: body, perZombie: 2, tint: 'shoe', shadow: true, build: 'leg' },
      { key: 'torso', geometry: geo(torsoGeometry()), material: body, perZombie: 1, tint: 'shirt', shadow: true, build: 'torso' },
      { key: 'upperArm', geometry: geo(new THREE.CapsuleGeometry(0.058, 0.2, 3, 8).translate(0, -0.15, 0)), material: body, perZombie: 2, tint: 'shirt', shadow: true, build: 'limb' },
      { key: 'foreArm', geometry: geo(new THREE.CapsuleGeometry(0.048, 0.2, 3, 8).translate(0, -0.14, 0)), material: body, perZombie: 2, tint: 'skin', shadow: true, build: 'limb' },
      { key: 'hand', geometry: geo(new THREE.BoxGeometry(0.08, 0.11, 0.05).translate(0, -0.05, 0)), material: body, perZombie: 2, tint: 'skin', shadow: false, build: 'limb' },
      { key: 'head', geometry: geo(new THREE.SphereGeometry(0.12, 12, 10).scale(0.95, 1.12, 1.02)), material: body, perZombie: 1, tint: 'skin', shadow: true, build: 'head' },
      { key: 'jaw', geometry: geo(new THREE.BoxGeometry(0.15, 0.05, 0.1).translate(0, -0.02, 0.03)), material: body, perZombie: 1, tint: 'skin', shadow: false, build: 'head' },
      { key: 'eyes', geometry: geo(eyesGeometry()), material: eyeMat, perZombie: 1, tint: 'eye', shadow: false, build: 'head' },
      // ── 특수 좀비 전용 부위 (해당 종류만 인스턴스를 쓴다)
      // 부푼 배 (폭발 좀비) · 굽은 등 혹 (보스) · 두꺼운 배 (탱커)
      { key: 'belly', geometry: geo(new THREE.SphereGeometry(0.2, 14, 10)), material: body, perZombie: 1, tint: 'skin', shadow: true, only: hasBelly, build: 'belly' },
      // 발광 부위: 스피터 독 주머니 · 폭발 좀비 고름 · 보스 등 균열
      { key: 'glow', geometry: geo(new THREE.SphereGeometry(0.07, 10, 8)), material: eyeMat, perZombie: 4, tint: 'glow', shadow: false, only: hasGlow },
      // 보스 뼈 가시
      { key: 'spike', geometry: geo(new THREE.ConeGeometry(0.05, 0.26, 6).translate(0, 0.12, 0)), material: body, perZombie: 6, tint: 'bone', shadow: true, only: (z) => z.stats.kind === 'boss' },
      // 엘리트 발밑 빛 고리
      { key: 'aura', geometry: geo(new THREE.RingGeometry(0.42, 0.62, 32).rotateX(-Math.PI / 2).translate(0, 0.025, 0)), material: auraMat, perZombie: 1, tint: 'aura', shadow: false, only: (z) => z.stats.elite && z.alive },
    ];
    for (const p of this.parts) {
      const mesh = new THREE.InstancedMesh(p.geometry, p.material, MAX * p.perZombie);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = p.shadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `zombie-${p.key}`;
      if (p.key === 'aura') mesh.renderOrder = 3;
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
    this.clock += dt;
    const counts = new Map<string, number>();
    for (const p of this.parts) counts.set(p.key, 0);
    let barCount = 0;
    camera.getWorldQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    this.culled = 0;

    // 사라진 좀비의 애니메이션 상태 정리
    if (this.anim.size > zombies.length * 2 + 8) {
      const live = new Set(zombies.map((z) => z.id));
      for (const id of this.anim.keys()) if (!live.has(id)) this.anim.delete(id);
    }

    for (const z of zombies) {
      if (z.exploded) continue; // 자폭: 남는 몸 없음
      const sc = z.stats.appearance.scale;
      // 화면 밖 좀비는 자세 계산 · 그리기 생략 (그림자가 끊기지 않도록 여유 반경)
      this.sphere.center.set(z.position.x, 1 * sc, z.position.z);
      this.sphere.radius = 2.6 * sc + 1.5;
      if (!this.frustum.intersectsSphere(this.sphere)) { this.culled++; continue; }
      let a = this.anim.get(z.id);
      if (!a) { a = { phase: z.variant * 10, walk: 0, attack: 0, hit: 0, sway: 0 }; this.anim.set(z.id, a); }
      this.pose(z, a, dt, alpha);
      this.rig.root.updateMatrixWorld(true);

      const flash = z.flash;
      const build = z.stats.appearance.build ?? DEFAULT_BUILD;
      for (const p of this.parts) {
        if (p.only && !p.only(z)) continue;
        const mesh = this.meshes.get(p.key)!;
        const nodes = this.rig.nodes[p.key];
        let idx = counts.get(p.key)!;
        const scaled = p.build ? this.buildScale(p.build, build, z) : null;
        for (let ni = 0; ni < nodes.length; ni++) {
          const n = nodes[ni];
          if (p.key === 'glow' && ni >= this.glowCount(z)) break;
          if (scaled) mesh.setMatrixAt(idx, this.m.copy(n.matrixWorld).scale(scaled));
          else mesh.setMatrixAt(idx, n.matrixWorld);
          this.tint(p.tint, z, flash, ni);
          mesh.setColorAt(idx, this.color);
          idx++;
        }
        counts.set(p.key, idx);
      }

      // 체력 바: 피해를 입은 좀비 · 엘리트(항상, 금색 테두리). 보스는 화면 상단 대형 바
      const elite = z.stats.elite;
      if (z.alive && z.stats.kind !== 'boss' && (elite || z.health < z.maxHealth)) {
        const ratio = Math.min(1, Math.max(0, z.health / z.maxHealth));
        const w = elite ? 1.2 : 0.8;
        const h = elite ? 0.13 : 0.08;
        const base = this.v.lerpVectors(z.prevPosition, z.position, alpha).setY(2.05 * sc + 0.1).addScaledVector(this.right, -w / 2);
        this.m.compose(base, this.q, this.s.set(w, h, 1));
        this.bars.setMatrixAt(barCount, this.m);
        this.bars.setColorAt(barCount, elite ? this.color.copy(this.gold).multiplyScalar(0.55) : this.color.setRGB(0.05, 0.05, 0.05));
        barCount++;
        this.m.compose(base.addScaledVector(this.right, 0.025), this.q, this.s.set((w - 0.05) * ratio, h - 0.04, 1));
        this.bars.setMatrixAt(barCount, this.m);
        this.bars.setColorAt(barCount, elite ? this.color.setRGB(1, 0.78, 0.2) : this.color.setHSL(0.02 + 0.1 * ratio, 0.85, 0.5));
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

  /** 종류별 색 팔레트 (외형 객체당 한 번만 만든다) */
  private palette(ap: ZombieStats['appearance']): Palette {
    let p = this.palettes.get(ap);
    if (!p) {
      p = {
        skin: ap.skin.map((c) => new THREE.Color(c)),
        shirt: ap.shirts.map((c) => new THREE.Color(c)),
        pants: ap.pants.map((c) => new THREE.Color(c)),
        glow: new THREE.Color(ap.glow ?? 0xffffff),
        eye: new THREE.Color(ap.eye ?? 0xffd959),
      };
      this.palettes.set(ap, p);
    }
    return p;
  }

  /** 부위별 체형 배율 (로컬 축) */
  private buildScale(axis: NonNullable<PartDef['build']>, b: BuildDef, z: Zombie): THREE.Vector3 | null {
    const v = this.partScale;
    switch (axis) {
      case 'torso': return b.torso[0] === 1 && b.torso[1] === 1 && b.torso[2] === 1 ? null : v.set(b.torso[0], b.torso[1], b.torso[2]);
      case 'limb': return b.limb === 1 ? null : v.set(b.limb, 1, b.limb);
      case 'leg': { const l = b.leg ?? b.limb; return l === 1 ? null : v.set(l, 1, l); }
      case 'head': return b.head === 1 ? null : v.setScalar(b.head);
      case 'belly': {
        const k = b.belly * this.bellyPulse(z);
        return v.set(k * 1.05, k, k);
      }
    }
  }

  /** 폭발 좀비: 숨 쉬듯 부풀고, 폭발 준비 중에는 빠르게 크게 맥동 */
  private bellyPulse(z: Zombie): number {
    if (z.stats.kind !== 'exploder') return 1;
    const prime = z.state === ZombieState.Special ? clamp(z.specialTime / (z.stats.explode?.primeTime ?? 1), 0, 1) : 0;
    return 1 + Math.sin(this.clock * (3 + prime * 22) + z.variant * 6) * (0.04 + prime * 0.1) + prime * 0.22;
  }

  private glowCount(z: Zombie): number {
    switch (z.stats.kind) {
      case 'spitter': return 2;
      case 'exploder': return 4;
      case 'boss': return 4;
      default: return 0;
    }
  }

  private tint(kind: PartDef['tint'], z: Zombie, flash: number, index = 0): void {
    const v = z.variant;
    const pal = this.palette(z.stats.appearance);
    const pick = (list: THREE.Color[], salt: number) => list[Math.floor(((v * 9973 + salt) % 1) * list.length) % list.length];
    switch (kind) {
      case 'skin': this.color.copy(pick(pal.skin, 0.13)); break;
      case 'shirt': this.color.copy(pick(pal.shirt, 0.41)); if (z.stats.elite) this.color.lerp(this.gold, 0.45); break;
      case 'pants': this.color.copy(pick(pal.pants, 0.77)); break;
      case 'shoe': this.color.setRGB(0.09, 0.08, 0.07); break;
      case 'bone': this.color.setRGB(0.82, 0.78, 0.66); break;
      case 'aura': {
        const k = 0.6 + 0.4 * Math.sin(this.clock * 4 + v * 5);
        this.color.copy(this.gold).multiplyScalar(k);
        return;
      }
      case 'eye':
        if (!z.alive) { this.color.setRGB(0.15, 0.12, 0.1); return; }
        this.color.copy(z.stats.elite ? this.gold : pal.eye).multiplyScalar(z.stats.elite ? 1.6 : 1);
        if (z.stats.kind === 'boss' && z.phase >= 2) this.color.setRGB(2.2, 0.25, 0.15);
        return;
      case 'glow': {
        if (!z.alive) { this.color.copy(pal.glow).multiplyScalar(0.15); return; }
        let k = 0.75 + 0.25 * Math.sin(this.clock * 3 + index * 1.7 + v * 4);
        if (z.stats.kind === 'exploder' && z.state === ZombieState.Special) {
          const prime = clamp(z.specialTime / (z.stats.explode?.primeTime ?? 1), 0, 1);
          k = 1 + prime * 2.2 * (0.5 + 0.5 * Math.sin(this.clock * (10 + prime * 30)));
        }
        if (z.stats.kind === 'spitter' && z.special === 'spit') k = 1.6 + Math.sin(this.clock * 30) * 0.4;
        this.color.copy(pal.glow).multiplyScalar(k);
        if (z.stats.kind === 'boss' && z.phase >= 2) this.color.setRGB(2.4 * k, 0.2 * k, 0.15 * k);
        if (flash > 0) this.color.lerp(this.white, flash * 0.5);
        return;
      }
    }
    if (!z.alive) this.color.multiplyScalar(0.7);
    // 피격 섬광: 흰색 쪽으로
    if (flash > 0) this.color.lerp(this.white, flash * 0.6).multiplyScalar(1 + flash * 0.8);
  }

  /** 좀비 상태 → 뼈대 자세 (절차적 애니메이션, 종류별 걸음 · 공격 동작) */
  private pose(z: Zombie, a: AnimState, dt: number, alpha: number): void {
    const r = this.rig;
    const s = z.stats;
    const ap = s.appearance;
    const gait = ap.gait ?? 'shamble';
    const b = ap.build ?? DEFAULT_BUILD;
    const hunch = ap.hunch;
    const pos = this.v.lerpVectors(z.prevPosition, z.position, alpha);
    const yaw = z.prevYaw + wrapAngle(z.yaw - z.prevYaw) * alpha;
    const t = this.clock + z.variant * 7;
    const sp = z.special;
    const special = z.state === ZombieState.Special;

    const moving = z.state === ZombieState.Chase || (special && z.moveSpeed > 0.3) ? clamp(z.moveSpeed / Math.max(0.5, s.moveSpeed), 0, 1.4) : 0;
    a.walk += (moving - a.walk) * damp(8, dt);
    // 걸음 주기: 보폭(다리 길이 × 크기)에 맞춤 → 큰 몸은 느리고 무겁게, 러너는 빠르게
    const stride = (gait === 'run' ? 0.62 : gait === 'stomp' ? 0.5 : 0.55) * ap.scale;
    a.phase += (z.moveSpeed * dt / stride) * Math.PI;
    const attacking = z.state === ZombieState.Attack ? 1 : 0;
    a.attack += (attacking - a.attack) * damp(14, dt);
    a.hit = Math.max(a.hit * Math.exp(-10 * dt), z.hitKick);
    z.hitKick = 0;

    r.root.position.set(pos.x, 0, pos.z);
    r.root.rotation.set(0, yaw, 0);
    r.root.scale.setScalar(ap.scale);
    // 체형: 어깨 · 골반 폭
    r.shoulderL.position.x = 0.21 * b.shoulder;
    r.shoulderR.position.x = -0.21 * b.shoulder;
    r.thighL.position.x = 0.1 * Math.max(1, b.torso[0] * 0.9);
    r.thighR.position.x = -0.1 * Math.max(1, b.torso[0] * 0.9);
    r.shoulderL.position.y = r.shoulderR.position.y = 0.47 * b.torso[1];
    r.neck.position.y = 0.55 * b.torso[1];
    r.belly.position.set(0, 0.2 * b.torso[1], b.bellyZ + (b.bellyZ >= 0 ? 0.08 : -0.06));
    this.placeExtras(z, b);

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
      fall = easeOutBounce(clamp(z.deadTime / (s.kind === 'boss' ? 1.2 : 0.7), 0, 1));
      if (z.sinking) sink = clamp((z.deadTime - s.corpseTime) / 1.2, 0, 1) * 0.6;
    }

    const walk = a.walk;
    const ph = a.phase;
    let swingL: number; let swingR: number; let kneeL: number; let kneeR: number; let bob: number; let lean = 0; let swayAmp = 0.12;
    if (gait === 'run') {
      // 러너: 대칭 큰 보폭, 앞으로 숙인 달리기
      swingL = Math.sin(ph) * 0.85 * walk;
      swingR = Math.sin(ph + Math.PI) * 0.85 * walk;
      kneeL = Math.max(0, Math.cos(ph)) * 1.3 * walk + 0.15;
      kneeR = Math.max(0, Math.cos(ph + Math.PI)) * 1.3 * walk + 0.15;
      bob = Math.abs(Math.sin(ph)) * 0.07 * walk;
      lean = 0.3 * walk;
      swayAmp = 0.05;
    } else if (gait === 'stomp' || gait === 'boss') {
      // 탱커 · 보스: 짧은 보폭, 쿵쿵 내려앉는 무거운 걸음, 좌우로 크게 흔들림
      swingL = Math.sin(ph) * 0.38 * walk;
      swingR = Math.sin(ph + Math.PI) * 0.38 * walk;
      kneeL = Math.max(0, Math.cos(ph)) * 0.55 * walk + 0.2;
      kneeR = Math.max(0, Math.cos(ph + Math.PI)) * 0.55 * walk + 0.2;
      bob = Math.pow(Math.abs(Math.sin(ph)), 0.5) * 0.06 * walk;
      swayAmp = 0.2;
    } else if (gait === 'waddle') {
      // 폭발 좀비: 뒤뚱뒤뚱
      swingL = Math.sin(ph) * 0.35 * walk;
      swingR = Math.sin(ph + Math.PI) * 0.35 * walk;
      kneeL = Math.max(0, Math.cos(ph)) * 0.4 * walk + 0.12;
      kneeR = Math.max(0, Math.cos(ph + Math.PI)) * 0.4 * walk + 0.12;
      bob = Math.abs(Math.sin(ph)) * 0.03 * walk;
      swayAmp = 0.3;
    } else {
      // 워커 · 스피터: 한쪽 다리를 끄는 비대칭 걸음
      swingL = Math.sin(ph) * 0.5 * walk;
      swingR = Math.sin(ph + Math.PI) * 0.32 * walk;
      kneeL = Math.max(0, Math.cos(ph)) * 0.8 * walk + 0.12;
      kneeR = Math.max(0, Math.cos(ph + Math.PI)) * 0.35 * walk + 0.2;
      bob = Math.abs(Math.sin(ph)) * 0.04 * walk;
    }
    r.thighL.rotation.set(-swingL - lean * 0.3, 0, 0.04);
    r.thighR.rotation.set(-swingR - lean * 0.3, 0, -0.06);
    r.kneeL.rotation.x = kneeL;
    r.kneeR.rotation.x = kneeR;

    // 몸통: 구부정 + 비틀린 자세, 걸음에 따라 좌우로 흔들림
    a.sway = Math.sin(ph) * swayAmp * walk + Math.sin(t * 1.3) * 0.04;
    let crouch = 0;
    let spineX = hunch + lean;
    let neckX = -hunch * 0.7 + Math.sin(t * 2.3) * 0.08;
    let shake = 0;
    r.hips.position.y = 0.86 - 0.04 - bob - rise;
    const lunge = a.attack * attackCurve(z.state === ZombieState.Attack ? z.stateTime / s.attackWindup : 2);
    // 탱커: 예비 동작 동안 크게 뒤로 젖힘 (내려치기 예고)
    const heavy = gait === 'stomp' ? 1.8 : 1;
    spineX += lunge * 0.35 * heavy - a.hit * 0.35;

    // 팔: 앞으로 뻗은 채 흔들림, 공격 시 위로 들었다가 내려침
    const reach = gait === 'run' ? 0.2 : gait === 'stomp' ? 0.55 : 1.25 - 0.15 * walk;
    const armSwing = Math.sin(t * 3.1) * 0.12;
    const raise = a.attack * (lunge > 0 ? -0.9 * lunge + 0.6 : 0.6) * heavy;
    let shL = -reach - armSwing - raise;
    let shR = -reach * 0.85 + armSwing - raise;
    let shLz = 0.12;
    let shRz = -0.2;
    let elL = -0.25 - a.attack * 0.3;
    let elR = -0.45 - a.attack * 0.3;
    if (gait === 'run') {
      // 달리기 팔치기
      shL = Math.sin(ph + Math.PI) * 1.0 * walk - 0.3 - raise;
      shR = Math.sin(ph) * 1.0 * walk - 0.3 - raise;
      elL = elR = -1.2;
    }

    // ── 종류별 특수 동작
    if (special) {
      const st = z.specialTime;
      switch (sp) {
        case 'dashPrep': crouch = 0.12; spineX += 0.35; shL = shR = 0.5; break; // 웅크림 (돌진 예고)
        case 'dash': spineX += 0.25; break;
        case 'spit': {
          // 고개를 뒤로 젖혔다가 앞으로 토해냄
          const w = s.ranged?.windup ?? 0.6;
          const k = st < w ? -Math.sin((st / w) * Math.PI * 0.5) : Math.max(0, 1 - (st - w) * 4);
          neckX += k < 0 ? k * 0.9 : k * 0.7;
          spineX += k < 0 ? k * 0.4 : k * 0.35;
          shL = shR = -0.6;
          break;
        }
        case 'prime': {
          // 폭발 준비: 팔을 벌리고 부들부들 떪
          const k = clamp(st / (s.explode?.primeTime ?? 1), 0, 1);
          shake = 0.03 + k * 0.08;
          shL = -1.6; shR = -1.6; shLz = 0.9; shRz = -0.9; elL = elR = -0.2;
          neckX = -0.4;
          break;
        }
        case 'melee': {
          // 보스 A: 오른팔을 높이 들었다가 휘두름
          const w = this.bossWindup(z, 'melee');
          const k = st < w ? st / w : 1 + (st - w) * 3;
          if (k < 1) { shR = -2.8 * easeOut(k); shRz = -0.5; spineX -= 0.25 * k; elR = -0.6; }
          else { const f = clamp(k - 1, 0, 1); shR = -2.8 + 3.6 * easeOut(f); shRz = -0.5 + 0.9 * f; spineX += 0.4 * (1 - f * 0.5); elR = -0.2; }
          break;
        }
        case 'slam': {
          // 보스 C: 양팔을 머리 위로 → 바닥 내려치기
          const w = this.bossWindup(z, 'slam');
          if (st < w) { const k = easeOut(st / w); shL = shR = -3.0 * k; shLz = 0.3 * k; shRz = -0.3 * k; spineX -= 0.35 * k; elL = elR = -0.4; crouch = -0.05 * k; }
          else { const f = clamp((st - w) * 5, 0, 1); shL = shR = -3.0 + 2.2 * f; spineX += 0.75 * f; crouch = 0.22 * f; elL = elR = -0.1; }
          break;
        }
        case 'chargePrep': {
          // 보스 B 준비: 몸을 낮추고 앞발을 긁음
          crouch = 0.2;
          spineX += 0.55;
          shL = shR = 0.9; shLz = 0.4; shRz = -0.4;
          r.thighL.rotation.x = -0.6 + Math.sin(t * 9) * 0.25;
          neckX = -0.5;
          break;
        }
        case 'charge':
          spineX += 0.6; shL = shR = 1.0; shLz = 0.25; shRz = -0.25; neckX = -0.6;
          break;
        case 'recover':
          spineX += 0.75; shL = shR = 0.1; neckX = 0.3; crouch = 0.1; shake = 0.01;
          break;
        case 'roar':
          // 2페이즈 전환: 양팔을 벌리고 하늘을 향해 포효
          shL = shR = -2.0; shLz = 1.0; shRz = -1.0; spineX = -0.3; neckX = -0.9; shake = 0.04;
          break;
      }
    }
    // 보스 2페이즈: 더 숙이고 떨림
    if (s.kind === 'boss' && z.phase >= 2 && z.alive) shake = Math.max(shake, 0.008);

    r.hips.position.y -= crouch;
    r.spine.position.y = r.hips.position.y;
    const jitter = shake > 0 ? Math.sin(t * 61) * shake : 0;
    r.spine.rotation.set(spineX, Math.sin(t * 0.7) * 0.08, a.sway + 0.08 + jitter);
    // 머리: 옆으로 꺾이고 까딱거림
    r.neck.rotation.set(neckX, 0.15 * Math.sin(t * 0.9), (gait === 'run' ? 0.1 : 0.32) + Math.sin(t * 1.7) * 0.06);
    r.shoulderL.rotation.set(shL, 0, shLz);
    r.shoulderR.rotation.set(shR, 0, shRz);
    r.elbowL.rotation.x = elL;
    r.elbowR.rotation.x = elR;

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

  private bossWindup(z: Zombie, kind: 'melee' | 'slam'): number {
    const b = z.stats.boss;
    if (!b) return 1;
    const w = kind === 'melee' ? b.meleeWindup : b.slamWindup;
    return w * (z.phase >= 2 ? b.phase2.windupMul : 1);
  }

  /** 발광 부위 · 가시 위치 (종류마다 다름, 공유 뼈대라 매번 설정) */
  private placeExtras(z: Zombie, b: BuildDef): void {
    const g = this.rig.glows;
    const ty = b.torso[1];
    switch (z.stats.kind) {
      case 'spitter':
        // 목 앞 독 주머니 2개
        g[0].parent !== this.rig.neck && this.rig.neck.add(g[0]);
        g[1].parent !== this.rig.neck && this.rig.neck.add(g[1]);
        g[0].position.set(0.05, -0.02, 0.1); g[0].scale.setScalar(1.25);
        g[1].position.set(-0.06, -0.05, 0.08); g[1].scale.setScalar(0.95);
        break;
      case 'exploder': {
        // 부푼 배 표면의 고름 4개
        const bz = b.bellyZ + 0.08;
        const R = 0.2 * b.belly * this.bellyPulse(z);
        const spots: [number, number, number, number][] = [[0.2, 0.25, 1, 1.4], [-0.35, 0.05, 1, 1.1], [0.1, -0.3, 1, 1.2], [-0.05, 0.45, 0.9, 0.9]];
        for (let i = 0; i < 4; i++) {
          if (g[i].parent !== this.rig.spine) this.rig.spine.add(g[i]);
          const [ax, ay, , sc] = spots[i];
          g[i].position.set(ax * R * 1.05, 0.2 * ty + ay * R, bz + R * Math.sqrt(Math.max(0.05, 1 - ax * ax - ay * ay)) * 0.98);
          g[i].scale.setScalar(sc * 1.4);
        }
        break;
      }
      case 'boss': {
        // 혹(등) 표면: 뼈 가시 6개 + 빛나는 균열 4개
        const R = 0.2 * b.belly;
        const cy = 0.2 * ty;
        const cz = b.bellyZ - 0.06;
        const sp = this.rig.spikes;
        for (let i = 0; i < sp.length; i++) {
          const d = SPIKE_DIRS[i];
          sp[i].position.set(d.x * R * 1.05, cy + d.y * R, cz + d.z * R * 0.95);
          sp[i].quaternion.setFromUnitVectors(UP, d);
          sp[i].scale.setScalar(i < 3 ? 1.5 : 1.1);
        }
        for (let i = 0; i < 4; i++) {
          if (g[i].parent !== this.rig.spine) this.rig.spine.add(g[i]);
          const d = GLOW_DIRS[i];
          g[i].position.set(d.x * R * 1.04, cy + d.y * R * 0.98, cz + d.z * R * 0.93);
          g[i].scale.set(0.7, 1.4, 0.7);
        }
        break;
      }
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const SPIKE_DIRS = [
  [0, 0.75, -0.65], [0.45, 0.6, -0.65], [-0.45, 0.6, -0.65], [0.2, 0.15, -1], [-0.25, 0.05, -1], [0, -0.4, -0.9],
].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
const GLOW_DIRS = [
  [0.15, 0.35, -0.92], [-0.18, 0.15, -0.97], [0.3, -0.15, -0.94], [-0.05, -0.3, -0.95],
].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());

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
  belly: THREE.Object3D;
  glows: THREE.Object3D[];
  spikes: THREE.Object3D[];
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
  const belly = o(spine, 0, 0.2, 0.1);
  const glows = [o(spine), o(spine), o(spine), o(spine)];
  // 보스 가시: 등 · 어깨를 따라 (몸통 기준 위치, 체형 배율은 몸통과 함께 적용되지 않으므로 넉넉히 바깥에)
  // 보스 가시 (위치는 체형에 맞춰 placeExtras 에서)
  const spikes = [o(spine), o(spine), o(spine), o(spine), o(spine), o(spine)];
  return {
    root, fallPivot, hips, spine, neck, thighL, thighR, kneeL, kneeR, shoulderL, shoulderR, elbowL, elbowR, belly, glows, spikes,
    nodes: {
      pelvis: [pelvis], thigh: [thighMeshL, thighMeshR], shin: [shinL, shinR], foot: [footL, footR],
      torso: [torso], upperArm: [upperL, upperR], foreArm: [foreL, foreR], hand: [handL, handR],
      head: [head], jaw: [jaw], eyes: [eyes],
      belly: [belly], glow: glows, spike: spikes, aura: [root],
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
