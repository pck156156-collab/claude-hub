import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 사각형 면: p0 좌하, p1 우하, p2 좌상, p3 우상 (보는 사람 기준). 앞면이 보는 사람을 향한다.
 * uv = { u0, v0, u1, v1 }
 */
export function quadGeometry(p0, p1, p2, p3, uv = { u0: 0, v0: 0, u1: 1, v1: 1 }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p3], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([uv.u0, uv.v0, uv.u1, uv.v0, uv.u0, uv.v1, uv.u1, uv.v1], 2));
  geo.setIndex([0, 1, 2, 1, 3, 2]);
  geo.computeVertexNormals();
  return geo;
}

/** 수직 판(표지판·광고판). normal = 판이 바라보는 수평 방향(보는 사람 쪽) */
export function boardGeometry(center, normal, width, height, uv) {
  const rx = normal.z; // 보는 사람(−normal 방향을 봄)의 오른쪽
  const rz = -normal.x;
  const hw = width / 2;
  const hh = height / 2;
  const c = (sx, sy) => [center.x + rx * hw * sx, center.y + hh * sy, center.z + rz * hw * sx];
  return quadGeometry(c(-1, -1), c(1, -1), c(-1, 1), c(1, 1), uv);
}

/** 재질별로 지오메트리를 모았다가 한 번에 병합 → 재질당 draw call 1개 */
export class GeometryBuckets {
  constructor() {
    this.buckets = new Map();
  }

  add(key, geometry) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(g);
  }

  /** 상자: 로컬(가로 w, 높이 h, 깊이 d)을 matrix 로 배치 */
  box(key, w, h, d, matrix) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(matrix);
    this.add(key, g);
  }

  build(materials, { castShadow = true, receiveShadow = true, name = 'Merged' } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, list] of this.buckets) {
      const mesh = new THREE.Mesh(mergeGeometries(list), materials[key]);
      mesh.name = `${name}:${key}`;
      mesh.castShadow = castShadow && key !== 'glass' && key !== 'banner' && key !== 'sign';
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    return group;
  }
}

/** 위치·Y 회전·크기 목록으로 InstancedMesh 생성 */
export function instanced(geometry, material, items, { castShadow = true, receiveShadow = true, name } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(items.length, 1));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.rotY ?? 0);
    p.set(it.x, it.y, it.z);
    s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
    mesh.setMatrixAt(i, m.compose(p, q, s));
    if (it.color !== undefined) mesh.setColorAt(i, new THREE.Color(it.color));
  });
  mesh.count = items.length;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.computeBoundingSphere();
  if (name) mesh.name = name;
  return mesh;
}
