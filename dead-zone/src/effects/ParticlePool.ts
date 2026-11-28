import * as THREE from 'three';

export interface ParticleSpawn {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  size: number;
  color: THREE.Color;
  gravity?: number;
  drag?: number;
  /** 바닥 반발 계수 (0 = 바닥에 붙음) */
  bounce?: number;
  /** 크기 변화: 수명 끝에서의 배율 */
  endScale?: number;
  /** 회전 속도 (rad/s) */
  spin?: number;
  /** 가로 · 세로 · 길이 비율 */
  shape?: [number, number, number];
  /** 진행 방향으로 늘이기 (불꽃) */
  stretch?: number;
}

/**
 * InstancedMesh 하나로 그리는 파티클 풀 (드로우콜 1회).
 * 빈 슬롯이 없으면 가장 오래된 파티클을 덮어쓰므로 개수가 항상 상한 안에 있다.
 */
export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private cursor = 0;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly life: Float32Array; private readonly maxLife: Float32Array;
  private readonly size: Float32Array; private readonly endScale: Float32Array;
  private readonly gravity: Float32Array; private readonly drag: Float32Array; private readonly bounce: Float32Array;
  private readonly rotX: Float32Array; private readonly rotY: Float32Array; private readonly spin: Float32Array;
  private readonly sx: Float32Array; private readonly sy: Float32Array; private readonly sz: Float32Array;
  private readonly stretch: Float32Array;
  private readonly alpha: THREE.InstancedBufferAttribute | null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private alive = 0;
  /** 카메라를 향하는 판 (연기) */
  private readonly billboard: boolean;

  constructor(capacity: number, geometry: THREE.BufferGeometry, material: THREE.Material, opts: { billboard?: boolean; castShadow?: boolean } = {}) {
    this.n = capacity;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.maxLife = f(); this.size = f(); this.endScale = f();
    this.gravity = f(); this.drag = f(); this.bounce = f();
    this.rotX = f(); this.rotY = f(); this.spin = f();
    this.sx = f(); this.sy = f(); this.sz = f(); this.stretch = f();
    this.billboard = !!opts.billboard;
    this.alpha = this.billboard ? new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1) : null;
    if (this.alpha) geometry.setAttribute('aAlpha', this.alpha);
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!opts.castShadow;
    this.mesh.count = 0;
    const black = new THREE.Color(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, black);
  }

  get activeCount(): number {
    return this.alive;
  }

  get capacity(): number {
    return this.n;
  }

  /** 그래픽 품질에 따른 파티클 양 (0~1). 시각 효과만 줄고 판정과는 무관 */
  density = 1;

  spawn(o: ParticleSpawn, essential = false): void {
    if (!essential && this.density < 1 && Math.random() > this.density) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx; this.vy[i] = o.vy; this.vz[i] = o.vz;
    this.life[i] = this.maxLife[i] = o.life;
    this.size[i] = o.size;
    this.endScale[i] = o.endScale ?? 0;
    this.gravity[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.bounce[i] = o.bounce ?? 0.3;
    this.rotX[i] = Math.random() * 6.28;
    this.rotY[i] = Math.random() * 6.28;
    this.spin[i] = o.spin ?? 0;
    const sh = o.shape ?? [1, 1, 1];
    this.sx[i] = sh[0]; this.sy[i] = sh[1]; this.sz[i] = sh[2];
    this.stretch[i] = o.stretch ?? 0;
    this.mesh.setColorAt(i, o.color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera): void {
    let alive = 0;
    let maxIndex = -1;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        continue;
      }
      alive++;
      maxIndex = i;
      const drag = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= drag; this.vz[i] *= drag; this.vy[i] = this.vy[i] * drag - this.gravity[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      const half = this.size[i] * this.sy[i] * 0.5;
      if (this.py[i] < half && this.gravity[i] > 0) {
        // 바닥 충돌: 튕기고 마찰로 감속
        this.py[i] = half;
        if (this.vy[i] < 0) this.vy[i] = -this.vy[i] * this.bounce[i];
        if (Math.abs(this.vy[i]) < 0.4) this.vy[i] = 0;
        this.vx[i] *= 0.82; this.vz[i] *= 0.82;
        this.spin[i] *= 0.8;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      const sc = this.size[i] * (1 + (this.endScale[i] - 1) * t);
      if (this.billboard) {
        this.q.copy(camera.quaternion);
        this.rotX[i] += this.spin[i] * dt;
        this.e.set(0, 0, this.rotX[i]);
        this.q.multiply(this.q2.setFromEuler(this.e));
        this.alpha!.setX(i, Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.08)) * (1 - t));
        this.s.set(sc, sc, sc);
      } else if (this.stretch[i] > 0) {
        this.v.set(this.vx[i], this.vy[i], this.vz[i]);
        const speed = this.v.length();
        if (speed > 1e-4) this.q.setFromUnitVectors(this.fwd, this.v.multiplyScalar(1 / speed));
        this.s.set(sc * this.sx[i], sc * this.sy[i], sc * this.sz[i] + speed * this.stretch[i]);
      } else {
        this.rotX[i] += this.spin[i] * dt;
        this.rotY[i] += this.spin[i] * dt * 0.7;
        this.e.set(this.rotX[i], this.rotY[i], 0);
        this.q.setFromEuler(this.e);
        this.s.set(sc * this.sx[i], sc * this.sy[i], sc * this.sz[i]);
      }
      this.m.compose(this.p.set(this.px[i], this.py[i], this.pz[i]), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.alive = alive;
    this.mesh.count = maxIndex + 1;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.alpha) this.alpha.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.mesh.count = 0;
    this.alive = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
