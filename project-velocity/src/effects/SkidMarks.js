import * as THREE from 'three';

/**
 * 스키드 마크. 미리 할당한 사각형 조각(segment) 버퍼를 링 버퍼로 재사용한다.
 * 상한(maxSegments)을 넘으면 가장 오래된 자국부터 덮어쓴다. 드로우콜 1개.
 */
export class SkidMarks {
  constructor(scene, config) {
    this.config = config;
    const n = config.maxSegments;
    this.max = n;
    this.written = 0;

    this.positions = new Float32Array(n * 4 * 3);
    this.colors = new Float32Array(n * 4 * 4); // RGBA (A = 진하기)
    const index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const v = i * 4;
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colorAttr);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);

    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x111111,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.dirty = false;
  }

  /** 바퀴 하나의 자국 추적 상태 */
  createTrail() {
    return { active: false, x: 0, z: 0, lx: 0, lz: 0, rx: 0, rz: 0, alpha: 0 };
  }

  /** 바퀴 위치(x, z)에 진하기 strength(0~1)로 자국을 이어 그린다. strength 0 이면 끊는다. */
  addPoint(trail, x, z, strength, y = 0.045) {
    const c = this.config;
    if (strength < c.threshold) {
      trail.active = false;
      return;
    }
    const alpha = c.maxAlpha * Math.min(strength, 1);
    if (!trail.active) {
      Object.assign(trail, { active: true, x, z, alpha });
      trail.lx = trail.rx = x;
      trail.lz = trail.rz = z;
      trail.fresh = true;
      return;
    }
    const dx = x - trail.x;
    const dz = z - trail.z;
    const len = Math.hypot(dx, dz);
    if (len < c.minSegmentLength) return;
    if (len > 4) {
      // 순간 이동(리셋 등): 이어 그리지 않음
      Object.assign(trail, { x, z, alpha });
      trail.fresh = true;
      return;
    }
    const hw = c.width / 2;
    const px = (-dz / len) * hw;
    const pz = (dx / len) * hw;
    const nlx = x + px;
    const nlz = z + pz;
    const nrx = x - px;
    const nrz = z - pz;
    if (trail.fresh) {
      trail.lx = trail.x + px;
      trail.lz = trail.z + pz;
      trail.rx = trail.x - px;
      trail.rz = trail.z - pz;
      trail.fresh = false;
    }

    const seg = this.written % this.max;
    const p = seg * 12;
    this.positions.set([trail.lx, y, trail.lz, trail.rx, y, trail.rz, nlx, y, nlz, nrx, y, nrz], p);
    const q = seg * 16;
    const a0 = trail.alpha;
    this.colors.set([1, 1, 1, a0, 1, 1, 1, a0, 1, 1, 1, alpha, 1, 1, 1, alpha], q);
    this.written++;
    this.dirty = true;

    Object.assign(trail, { x, z, lx: nlx, lz: nlz, rx: nrx, rz: nrz, alpha });
  }

  get segmentCount() {
    return Math.min(this.written, this.max);
  }

  update() {
    if (!this.dirty) return;
    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.segmentCount * 6);
    this.dirty = false;
  }

  clear() {
    this.written = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }
}
