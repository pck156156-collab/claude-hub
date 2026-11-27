import * as THREE from 'three';
import { PROGRESSION_CONFIG } from '../config/GameConfig';

/**
 * 경험치 결정 (풀 + InstancedMesh). 결정 수와 관계없이 드로우콜 2회 (결정 + 바닥 빛).
 * - 생성: 평소에는 처치마다 항상 새 결정을 만든다. 결정이 mergeStartCount 이상 쌓였을 때만
 *   근처(mergeRadius)의 대기 중 결정에 값을 합치고, 상한을 넘으면 가장 가까운 결정에 합친다.
 *   → 화면의 결정 수는 제한되지만 총 경험치는 줄지 않는다.
 * - 획득 범위 안에 들어오면 플레이어 쪽으로 가속하며 끌려가고, 도착하면 collect 호출.
 * - 화면 밖 결정도 그대로 남는다 (사라지지 않음). 로직은 고정 스텝에서만 움직이므로 일시정지 중에는 멈춘다.
 */
export class ExperienceOrbs {
  readonly capacity = PROGRESSION_CONFIG.maxOrbs;
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  private readonly value: Float32Array;
  private readonly speed: Float32Array;
  private readonly seed: Float32Array;
  private readonly active: Uint8Array;
  private readonly attracted: Uint8Array;
  private readonly crystals: THREE.InstancedMesh;
  private readonly glows: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private clock = 0;
  count = 0;
  /** 병합 횟수 · 획득 경험치 (테스트 · 디버그) */
  merges = 0;
  collected = 0;

  constructor(private readonly scene: THREE.Scene) {
    const n = this.capacity;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.value = new Float32Array(n);
    this.speed = new Float32Array(n);
    this.seed = new Float32Array(n);
    this.active = new Uint8Array(n);
    this.attracted = new Uint8Array(n);

    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x5ff6ff, emissive: 0x22e6ff, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.1, toneMapped: false,
    });
    this.crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.16, 0).scale(1, 1.5, 1), crystalMat, n);
    this.crystals.castShadow = false;
    this.crystals.frustumCulled = false;
    this.crystals.count = 0;
    this.crystals.renderOrder = 3;

    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0x34e8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), glowMat, n);
    this.glows.frustumCulled = false;
    this.glows.count = 0;
    this.glows.renderOrder = 2;
    for (const mesh of [this.crystals, this.glows]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
    }
  }

  /** 남아 있는 결정의 경험치 합 */
  get totalValue(): number {
    let t = 0;
    for (let i = 0; i < this.capacity; i++) if (this.active[i]) t += this.value[i];
    return t;
  }

  reset(): void {
    this.active.fill(0);
    this.attracted.fill(0);
    this.count = 0;
    this.merges = 0;
    this.collected = 0;
    this.crystals.count = 0;
    this.glows.count = 0;
  }

  spawn(x: number, z: number, value: number): void {
    // 1) 결정이 많이 쌓였을 때만 근처의 대기 중 결정과 병합
    const r2 = this.count >= PROGRESSION_CONFIG.mergeStartCount ? PROGRESSION_CONFIG.mergeRadius ** 2 : -1;
    let nearest = -1;
    let nd = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < nd) { nd = d; nearest = i; }
      if (d < r2 && !this.attracted[i]) {
        this.value[i] += value;
        this.merges++;
        return;
      }
    }
    // 2) 빈 슬롯. 다른 결정과 겹쳐 하나처럼 보이지 않도록 살짝 떨어진 자리에 놓는다
    const [sx, sz] = this.freeSpot(x, z);
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i]) continue;
      this.active[i] = 1;
      this.attracted[i] = 0;
      this.x[i] = sx;
      this.z[i] = sz;
      this.value[i] = value;
      this.speed[i] = 0;
      this.seed[i] = Math.random() * 10;
      this.count++;
      return;
    }
    // 3) 가득 참: 가장 가까운 결정에 합침 (경험치 손실 없음)
    if (nearest >= 0) {
      this.value[nearest] += value;
      this.merges++;
    }
  }

  /** (x, z) 근처에서 기존 결정과 0.45 이상 떨어진 자리 (못 찾으면 원래 자리) */
  private freeSpot(x: number, z: number): [number, number] {
    const min2 = 0.45 * 0.45;
    const clear = (px: number, pz: number) => {
      for (let i = 0; i < this.capacity; i++) {
        if (this.active[i] && (this.x[i] - px) ** 2 + (this.z[i] - pz) ** 2 < min2) return false;
      }
      return true;
    };
    if (clear(x, z)) return [x, z];
    const a0 = Math.random() * Math.PI * 2;
    for (const r of [0.5, 0.8]) {
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k / 8) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (clear(px, pz)) return [px, pz];
      }
    }
    return [x, z];
  }

  /** 게임 로직 스텝 */
  step(dt: number, px: number, pz: number, pickupRadius: number, collect: (value: number) => void): void {
    this.clock += dt;
    const c = PROGRESSION_CONFIG;
    const pr2 = pickupRadius * pickupRadius;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      const dx = px - this.x[i];
      const dz = pz - this.z[i];
      const d2 = dx * dx + dz * dz;
      if (!this.attracted[i]) {
        if (d2 > pr2) continue;
        this.attracted[i] = 1;
        this.speed[i] = 2;
      }
      const d = Math.sqrt(d2);
      this.speed[i] = Math.min(c.absorbSpeed, this.speed[i] + c.absorbAcceleration * dt);
      const move = this.speed[i] * dt;
      if (d - move <= c.collectDistance) {
        const v = this.value[i];
        this.active[i] = 0;
        this.attracted[i] = 0;
        this.count--;
        this.collected += v;
        collect(v);
        continue;
      }
      this.x[i] += (dx / d) * move;
      this.z[i] += (dz / d) * move;
    }
  }

  /** 렌더 (로직 시간 기준으로 흔들림 → 일시정지 중에는 멈춤) */
  render(): void {
    let k = 0;
    const t = this.clock;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      const v = this.value[i];
      const size = Math.min(2.2, 0.8 + Math.sqrt(v / 10) * 0.35);
      const bob = 0.42 + Math.sin(t * 3 + this.seed[i]) * 0.08;
      this.e.set(0, t * 2 + this.seed[i], 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(this.x[i], bob * (this.attracted[i] ? 1.6 : 1), this.z[i]), this.q, this.s.set(size, size, size));
      this.crystals.setMatrixAt(k, this.m);
      this.q.identity();
      const g = size * 1.1 * (0.9 + Math.sin(t * 4 + this.seed[i]) * 0.1);
      this.m.compose(this.p.set(this.x[i], 0.03, this.z[i]), this.q, this.s.set(g, 1, g));
      this.glows.setMatrixAt(k, this.m);
      k++;
    }
    this.crystals.count = k;
    this.glows.count = k;
    this.crystals.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.crystals, this.glows]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      mesh.dispose();
    }
  }
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
