import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Bucket {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
  castShadow: boolean;
  receiveShadow: boolean;
}

/**
 * 움직이지 않는 소품을 재질별로 하나의 메시로 합친다 → 드로우콜 감소.
 * add() 로 위치가 적용된 지오메트리를 모은 뒤 build() 로 씬에 추가한다.
 */
export class StaticBatch {
  private buckets = new Map<string, Bucket>();
  private readonly tmp = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  /**
   * geometry 는 복제되어 변환이 적용된다 (원본은 재사용 가능).
   * 모든 지오메트리는 같은 속성 구성(position/normal/uv)이어야 한다.
   */
  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number, y: number, z: number,
    rx = 0, ry = 0, rz = 0,
    sx = 1, sy = 1, sz = 1,
    shadows: { cast?: boolean; receive?: boolean } = {},
  ): void {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.tmp.compose(this.p.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    this.addMatrix(geometry, material, this.tmp, shadows);
  }

  addMatrix(geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4, shadows: { cast?: boolean; receive?: boolean } = {}): void {
    const cast = shadows.cast ?? true;
    const receive = shadows.receive ?? true;
    const key = `${material.uuid}|${cast}|${receive}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { material, geometries: [], castShadow: cast, receiveShadow: receive }));
    const g = normalize(geometry.clone());
    g.applyMatrix4(matrix);
    b.geometries.push(g);
  }

  build(parent: THREE.Object3D, name = 'static'): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geometries, false);
      for (const g of b.geometries) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.name = name;
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = b.receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

/** 병합 가능하도록 index 를 풀고 uv 가 없으면 채운다 */
function normalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  if (!ng.getAttribute('uv')) {
    const count = ng.getAttribute('position').count;
    ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  for (const name of Object.keys(ng.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') ng.deleteAttribute(name);
  }
  ng.morphAttributes = {};
  ng.clearGroups();
  return ng;
}

/**
 * 면 방향에 따라 월드 크기 기준 UV 를 부여한다 (텍스처가 늘어나지 않도록).
 * tile: 텍스처 한 장이 덮는 월드 크기.
 */
export function worldUV(g: THREE.BufferGeometry, tileU: number, tileV = tileU, offsetY = 0): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + offsetY;
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    if (ny > 0.7) uv.setXY(i, x / tileU, z / tileV);
    else if (nx > 0.7) uv.setXY(i, z / tileU, y / tileV);
    else uv.setXY(i, x / tileU, y / tileV);
  }
  uv.needsUpdate = true;
  return g;
}
