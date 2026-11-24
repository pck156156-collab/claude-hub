import * as THREE from 'three';
import { RENDER_CONFIG, WORLD_CONFIG } from '../config/GameConfig';
import { Random } from '../core/random';
import { CollisionWorld } from './Collision';
import { PropFactory } from './props';
import { StaticBatch, worldUV } from './StaticBatch';
import { asphaltTexture, concreteTexture, decalTexture, facadeTexture, roughnessNoise } from './textures';

/** 카메라 시야를 가릴 수 있는 건물. GameCamera 가 투명도를 조절한다. */
export interface Occluder {
  box: THREE.Box3;
  materials: THREE.MeshStandardMaterial[];
  opacity: number;
}

const HALF = WORLD_CONFIG.size / 2;
const ROAD = WORLD_CONFIG.roadWidth / 2;
const WALK = ROAD + WORLD_CONFIG.sidewalkWidth;

/**
 * 테스트 맵: 교차로가 있는 폐허 도시 블록 (100×100).
 * - 모든 바닥은 y=0 평면 (캐릭터 발 높이와 정확히 일치)
 * - 건물 · 차량 · 장애물은 CollisionWorld 에 충돌체로 등록
 * - 중앙 교차로와 도로는 넓게 비워 이동 공간을 확보
 */
export class World {
  readonly root = new THREE.Group();
  readonly collision = new CollisionWorld();
  readonly occluders: Occluder[] = [];
  readonly sun: THREE.DirectionalLight;
  readonly spawnPoint = new THREE.Vector3(0, 0, 4);
  private readonly rng = new Random(WORLD_CONFIG.seed);
  private readonly batch = new StaticBatch();
  private readonly props: PropFactory;
  private readonly disposables: { dispose(): void }[] = [];

  /**
   * @param reserved 소품을 두지 않을 자리 (x, z, 반경): 시작 지점 · 표적 위치 등
   */
  constructor(scene: THREE.Scene, private readonly reserved: [number, number, number][] = []) {
    this.root.name = 'world';
    scene.add(this.root);
    this.collision.bound = HALF - WORLD_CONFIG.boundaryThickness;
    this.props = new PropFactory(this.batch, this.collision, this.rng);

    this.sun = this.buildLighting(scene);
    this.buildGround();
    this.buildMarkings();
    this.buildBoundary();
    this.buildBuildings();
    this.buildStreetFurniture();
    this.buildObstacles();
    this.buildDecals();
    this.buildSkyline();

    this.batch.build(this.root, 'props');
  }

  /** 그림자 카메라를 플레이어 주변에 맞춘다 (텍셀 단위로 맞춰 그림자 떨림 방지) */
  updateShadow(focus: THREE.Vector3): void {
    const r = RENDER_CONFIG.shadowRadius;
    const texel = (r * 2) / RENDER_CONFIG.shadowMapSize;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    const dir = this.sunDirection;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + dir.x * 60, dir.y * 60, fz + dir.z * 60);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      }
    });
    for (const d of this.disposables) d.dispose();
    this.root.removeFromParent();
  }

  private readonly sunDirection = new THREE.Vector3(-0.55, 1, 0.42).normalize();

  private buildLighting(scene: THREE.Scene): THREE.DirectionalLight {
    scene.background = new THREE.Color(0x5d6468);
    scene.fog = new THREE.Fog(0x5d6468, 42, 105);
    const hemi = new THREE.HemisphereLight(0xb4c0ca, 0x5a5044, 1.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffdcb0, 3.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(RENDER_CONFIG.shadowMapSize, RENDER_CONFIG.shadowMapSize);
    const r = RENDER_CONFIG.shadowRadius;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 140 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.disposables.push({ dispose: () => { scene.remove(hemi, sun, sun.target); sun.dispose(); hemi.dispose(); } });
    return sun;
  }

  private buildGround(): void {
    const concrete = concreteTexture();
    concrete.repeat.set(160 / 8, 160 / 8);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.95, color: 0xaaa9a5 }),
    );
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.root.add(ground);

    const asphalt = asphaltTexture();
    const rough = roughnessNoise(7, 215);
    const asphaltMat = new THREE.MeshStandardMaterial({
      map: asphalt, roughnessMap: rough, roughness: 1, color: 0xc8c8c8,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    // 도로 두 개 (X축 · Z축), 외곽 벽 밖까지 이어진다
    const L = 160;
    const roadX = new THREE.PlaneGeometry(L, ROAD * 2).rotateX(-Math.PI / 2);
    const roadZ = new THREE.PlaneGeometry(ROAD * 2, L).rotateX(-Math.PI / 2);
    for (const g of [roadX, roadZ]) {
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 10, pos.getZ(i) / 10);
    }
    for (const g of [roadX, roadZ]) {
      const m = new THREE.Mesh(g, asphaltMat);
      m.position.y = 0.004;
      m.receiveShadow = true;
      m.name = 'road';
      this.root.add(m);
    }

    // 연석 (도로와 보도 경계, 바닥과 같은 높이에 칠한 띠)
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x8f8b83, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const strip = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (const s of [-1, 1]) {
      for (const [a, b] of [[-L / 2, -ROAD], [ROAD, L / 2]]) {
        const len = b - a;
        const c = (a + b) / 2;
        this.batch.add(strip, curbMat, c, 0.006, s * (ROAD + 0.2), 0, 0, 0, len, 1, 0.4, { cast: false });
        this.batch.add(strip, curbMat, s * (ROAD + 0.2), 0.006, c, 0, 0, 0, 0.4, 1, len, { cast: false });
      }
    }
  }

  private buildMarkings(): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xd6d3c8, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xc89a2a, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const y = 0.008;
    const L = 80;
    const rng = this.rng;
    const mark = (mat: THREE.Material, x: number, z: number, w: number, d: number) => {
      // 일부 차선은 닳아서 끊어져 있다
      if (rng.chance(0.08)) return;
      this.batch.add(plane, mat, x, y, z, 0, 0, 0, w, 1, d, { cast: false });
    };
    for (const axis of [0, 1]) {
      for (const dir of [-1, 1]) {
        // 교차로(중앙 ±WALK) 밖 구간
        const start = WALK + 1;
        // 중앙 이중 황색선
        for (let t = start; t < L; t += 4) {
          for (const off of [-0.18, 0.18]) {
            const along = dir * (t + 2);
            if (axis === 0) mark(yellow, along, off, 4, 0.14);
            else mark(yellow, off, along, 0.14, 4);
          }
        }
        // 차로 점선 (양쪽)
        for (let t = start; t < L; t += 5) {
          for (const off of [-ROAD / 2, ROAD / 2]) {
            const along = dir * (t + 1.5);
            if (axis === 0) mark(white, along, off, 3, 0.14);
            else mark(white, off, along, 0.14, 3);
          }
        }
        // 가장자리 실선
        for (let t = start; t < L; t += 4) {
          for (const off of [-(ROAD - 0.4), ROAD - 0.4]) {
            const along = dir * (t + 2);
            if (axis === 0) mark(white, along, off, 4, 0.14);
            else mark(white, off, along, 0.14, 4);
          }
        }
        // 횡단보도
        const cw = WALK - 1.2;
        for (let k = -ROAD + 0.9; k < ROAD - 0.5; k += 1.1) {
          if (axis === 0) mark(white, dir * cw, k, 2.2, 0.55);
          else mark(white, k, dir * cw, 0.55, 2.2);
        }
        // 정지선
        if (axis === 0) mark(white, dir * (cw + 1.6), -dir * ROAD / 2, 0.35, ROAD - 0.6);
        else mark(white, dir * ROAD / 2, dir * (cw + 1.6), ROAD - 0.6, 0.35);
      }
    }
  }

  /** 맵 외곽: 콘크리트 장벽 + 철조망 기둥. 실제 이동 제한은 CollisionWorld.bound 가 담당 */
  private buildBoundary(): void {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x86837c, roughness: 0.95, map: concreteTexture() });
    (wallMat.map as THREE.Texture).repeat.set(1, 0.4);
    const metal = this.props.mats.metal;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const post = new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6);
    const wire = new THREE.CylinderGeometry(0.015, 0.015, 1, 4).rotateZ(Math.PI / 2);
    const t = WORLD_CONFIG.boundaryThickness;
    const H = WORLD_CONFIG.boundaryHeight;
    const seg = 4;
    for (let side = 0; side < 4; side++) {
      for (let a = -HALF; a < HALF; a += seg) {
        const c = a + seg / 2;
        const h = H + this.rng.range(-0.25, 0.1);
        // 도로가 나가는 자리는 무너진 바리케이드
        const onRoad = Math.abs(c) < ROAD + 1;
        const hh = onRoad ? 1.4 : h;
        const [x, z, w, d] = side === 0 ? [c, -HALF + t / 2, seg - 0.06, t] : side === 1 ? [c, HALF - t / 2, seg - 0.06, t]
          : side === 2 ? [-HALF + t / 2, c, t, seg - 0.06] : [HALF - t / 2, c, t, seg - 0.06];
        this.batch.add(box, onRoad ? this.props.mats.hazard : wallMat, x, hh / 2, z, 0, 0, 0, w, hh, d);
        if (!onRoad) {
          for (const k of [-1.9, 0]) {
            const px = side < 2 ? x + k : x;
            const pz = side < 2 ? z : z + k;
            this.batch.add(post, metal, px, h + 0.7, pz, 0, 0, 0, 1, 1, 1, { cast: false });
          }
          for (const wy of [0.35, 0.8, 1.25]) {
            this.batch.add(wire, metal, x, h + wy, z, 0, side < 2 ? 0 : Math.PI / 2, 0, seg, 1, 1, { cast: false });
          }
        }
      }
    }
  }

  private buildBuildings(): void {
    const palette: [string, string][] = [
      ['#7d7468', '#57504a'], ['#6a6f73', '#45494d'], ['#8a7058', '#5a4636'], ['#6d6a5e', '#4a473e'], ['#5f5a55', '#3d3a37'],
    ];
    const defs: { x: number; z: number; w: number; d: number; h: number; damage: number }[] = [
      { x: 35, z: 36, w: 20, d: 14, h: 15, damage: 0.5 },
      { x: 15, z: 41, w: 9, d: 10, h: 8, damage: 0.3 },
      { x: -37, z: 31, w: 14, d: 20, h: 19, damage: 0.7 },
      { x: -38, z: -38, w: 16, d: 14, h: 12, damage: 0.4 },
      { x: -18, z: -42, w: 10, d: 8, h: 7, damage: 0.8 },
      { x: 37, z: -30, w: 14, d: 18, h: 17, damage: 0.6 },
      { x: 18, z: -42, w: 10, d: 7, h: 6, damage: 0.2 },
    ];
    defs.forEach((d, i) => this.building(d.x, d.z, d.w, d.d, d.h, d.damage, palette[i % palette.length], 100 + i));

    // 무너진 건물 터 (낮은 벽과 잔해) — 시야를 가리지 않는 엄폐 지형
    this.ruin(-20, 30, 12, 9);
    this.ruin(24, -20, 9, 8);
  }

  /**
   * 파손된 건물: 폭 방향을 여러 기둥으로 나눠 높이를 다르게 → 무너진 윤곽.
   * 각 건물은 자기 재질을 가져서 카메라를 가릴 때 개별로 반투명 처리된다.
   */
  private building(x: number, z: number, w: number, d: number, h: number, damage: number, colors: [string, string], seed: number): void {
    const rng = new Random(seed);
    const facade = facadeTexture(seed, colors[0], colors[1]);
    const facadeMat = new THREE.MeshStandardMaterial({
      map: facade.map, emissiveMap: facade.emissive, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.92,
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 1 });
    const batch = new StaticBatch();
    const tile = 12; // 텍스처 한 장 = 가로 4칸 · 세로 4층 = 12단위

    const alongX = w >= d;
    const span = alongX ? w : d;
    const cols = Math.max(2, Math.round(span / 3));
    const colW = span / cols;
    // 한쪽 끝이 크게 무너진 형태: 손상도에 따라 높이를 깎는다
    const collapseSide = rng.chance(0.5) ? 1 : -1;
    let maxH = 0;
    for (let i = 0; i < cols; i++) {
      const t = i / (cols - 1);
      const edge = collapseSide > 0 ? t : 1 - t;
      const loss = damage * Math.pow(edge, 1.6) * h * 0.75 + (rng.chance(damage * 0.5) ? rng.range(0, 3) : 0);
      const ch = Math.max(3, Math.round((h - loss) * 2) / 2);
      maxH = Math.max(maxH, ch);
      const offset = -span / 2 + colW * (i + 0.5);
      const cx = alongX ? x + offset : x;
      const cz = alongX ? z : z + offset;
      const cw = alongX ? colW + 0.01 : w;
      const cd = alongX ? d : colW + 0.01;
      const g = new THREE.BoxGeometry(cw, ch, cd).translate(cx, ch / 2, cz);
      worldUV(g, tile, tile);
      batch.addMatrix(g, facadeMat, new THREE.Matrix4());
      // 지붕 마감 / 부서진 단면
      const broken = ch < h - 0.5;
      batch.add(new THREE.BoxGeometry(1, 1, 1), broken ? darkMat : roofMat, cx, ch + 0.12, cz, 0, 0, 0, cw + (broken ? 0 : 0.3), 0.25, cd + (broken ? 0 : 0.3));
      if (broken) {
        // 철근
        for (let k = 0; k < 3; k++) {
          batch.add(new THREE.CylinderGeometry(0.035, 0.035, 1, 4), this.props.mats.rust,
            cx + rng.range(-cw / 2, cw / 2) * 0.9, ch + 0.5, cz + rng.range(-cd / 2, cd / 2) * 0.9,
            rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4), 1, rng.range(0.6, 1.3), 1, { cast: false });
        }
      } else if (rng.chance(0.25)) {
        // 옥상 설비
        batch.add(new THREE.BoxGeometry(1, 1, 1), this.props.mats.metal, cx, ch + 0.7, cz, 0, 0, 0, 1.4, 1, 1.2);
      }
    }
    batch.build(this.root, 'building');

    // 무너진 쪽 바닥에 잔해
    const ex = alongX ? x + (collapseSide * span) / 2 : x;
    const ez = alongX ? z : z + (collapseSide * span) / 2;
    const toCenter = Math.hypot(ex, ez);
    const inward = 2.2;
    this.props.rubble(ex - (ex / toCenter) * inward, ez - (ez / toCenter) * inward, 2.2 + damage * 1.5, 18 + Math.round(damage * 20));

    this.collision.addBox(x, z, w, d, 0, maxH);
    this.occluders.push({
      box: new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - d / 2), new THREE.Vector3(x + w / 2, maxH + 0.4, z + d / 2)),
      materials: [facadeMat, roofMat, darkMat],
      opacity: 1,
    });
  }

  /** 무너진 건물 터: 높이가 제각각인 벽 조각 + 잔해 */
  private ruin(x: number, z: number, w: number, d: number): void {
    const mat = this.props.mats.concrete;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const walls: [number, number, number, number][] = [
      [x, z - d / 2, w, 0.4], [x, z + d / 2, w, 0.4], [x - w / 2, z, 0.4, d], [x + w / 2, z, 0.4, d],
    ];
    for (const [cx, cz, ww, dd] of walls) {
      const horizontal = ww > dd;
      const len = horizontal ? ww : dd;
      const pieces = Math.round(len / 1.5);
      for (let i = 0; i < pieces; i++) {
        if (this.rng.chance(0.35)) continue; // 뚫린 부분
        const h = this.rng.range(0.6, 2.4);
        const off = -len / 2 + (i + 0.5) * (len / pieces);
        const px = horizontal ? cx + off : cx;
        const pz = horizontal ? cz : cz + off;
        const pw = horizontal ? len / pieces : 0.4;
        const pd = horizontal ? 0.4 : len / pieces;
        this.batch.add(box, mat, px, h / 2, pz, 0, 0, 0, pw, h, pd);
        this.collision.addBox(px, pz, pw, pd, 0, h);
      }
    }
    this.props.rubble(x + 1, z - 0.5, 2.5, 26);
    this.props.rubble(x - 2.5, z + 2, 1.6, 12, true);
  }

  private streetLights: THREE.PointLight[] = [];

  private buildStreetFurniture(): void {
    // 도로를 따라 양쪽 보도에 가로등. 일부는 꺼지거나 기울어짐
    const states: ('on' | 'off' | 'broken')[] = ['on', 'off', 'broken', 'on', 'off', 'off', 'on', 'broken'];
    let k = 0;
    const lightPositions: THREE.Vector3[] = [];
    for (const along of [-40, -24, 24, 40]) {
      for (const side of [-1, 1]) {
        const off = side * (ROAD + 1.0);
        const state = states[k++ % states.length];
        // X축 도로
        const p1 = this.props.streetLight(along, off, side > 0 ? -Math.PI / 2 : Math.PI / 2, state);
        if (p1) lightPositions.push(p1);
        const state2 = states[(k + 3) % states.length];
        // Z축 도로
        const p2 = this.props.streetLight(off, along, side > 0 ? Math.PI : 0, state2);
        if (p2) lightPositions.push(p2);
      }
    }
    // 그림자 없는 점광원 (성능상 일부만)
    for (const p of lightPositions.slice(0, RENDER_CONFIG.streetLightCount)) {
      const l = new THREE.PointLight(0xffc27a, 18, 13, 1.6);
      l.position.copy(p);
      this.root.add(l);
      this.streetLights.push(l);
    }
  }

  /** 차량 · 방호벽 · 드럼통 · 상자 배치. 중앙 교차로와 표적 주변은 비워 둔다 */
  private buildObstacles(): void {
    const p = this.props;
    // 도로 위 버려진 차량 (차선 방향을 따라 약간 틀어짐)
    p.car(-30, -2.8, 0.12, { paint: 0 });
    p.car(-17, 3.2, Math.PI + 0.3, { wrecked: true });
    p.car(28, 2.6, Math.PI - 0.08);
    p.car(38, -3.4, 0.5, { wrecked: true, paint: 4 });
    p.car(-3, 29, Math.PI / 2 + 0.2);
    p.car(3.4, -27, -Math.PI / 2 - 0.35, { wrecked: true });
    p.car(-2.6, -40, Math.PI / 2);
    p.truck(2.4, 40, Math.PI / 2 + 0.06);

    // 주차장 (좌하단 블록)
    for (let i = 0; i < 4; i++) {
      if (i === 2) continue;
      p.car(-34 + i * 3.4, -22, Math.PI / 2 + this.rng.range(-0.1, 0.1), { wrecked: this.rng.chance(0.5) });
    }
    p.car(-14, -27, 0.9, { wrecked: true });

    // 검문소: 교차로 북동쪽 방호벽 라인 (중간에 틈)
    p.barrierLine(11, 7.5, 23, 7.5, 3);
    p.barrierLine(-24, -8, -12, -8, 0);
    p.barrierLine(-8, -23, -8, -33, 0);
    p.barrierLine(8, 22, 8, 32, 3);
    p.sandbags(17, -11, 0.1, 4.2);
    p.sandbags(-12, 15, Math.PI / 2, 3.6);

    // 드럼통
    p.drumCluster(20, 26, 4);
    p.drumCluster(-27, 18, 3);
    p.drumCluster(28, -13, 3);
    p.drumCluster(-29, -30, 4);
    p.drumCluster(12, -33, 2);
    p.drum(-10, 10, true);

    // 상자 더미
    p.crateStack(25, 21, 0.2, [[0, 1, 2], [0, 1]]);
    p.crateStack(-30, 12, -0.3, [[0, 1], [0]]);
    p.crateStack(30, -20, 0, [[0, 1, 2], [1]]);
    p.crateStack(-24, -15, 0.6, [[0]]);
    p.crateStack(14, 30, 1.2, [[0, 1]]);
    p.pallet(-26, 12, 0.4);
    p.pallet(23, -24, 1.1);

    // 흩어진 작은 잔해 (충돌 없음)
    for (let i = 0; i < 70; i++) {
      const x = this.rng.range(-46, 46);
      const z = this.rng.range(-46, 46);
      if (this.isReserved(x, z, 1) || this.collision.overlapsCircle(x, z, 0.8)) continue;
      p.clutter(x, z);
    }
  }

  private isReserved(x: number, z: number, margin: number): boolean {
    if (Math.hypot(x - this.spawnPoint.x, z - this.spawnPoint.z) < 5 + margin) return true;
    return this.reserved.some(([rx, rz, r]) => Math.hypot(x - rx, z - rz) < r + margin);
  }

  private buildDecals(): void {
    const kinds: ('stain' | 'scorch' | 'blood')[] = ['stain', 'scorch', 'blood'];
    const mats = kinds.map((k) => new THREE.MeshStandardMaterial({
      map: decalTexture(k), transparent: true, depthWrite: false, roughness: k === 'stain' ? 0.25 : 0.9,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 26; i++) {
      const k = i % 3;
      const s = this.rng.range(1.2, k === 1 ? 3.2 : 2.6);
      this.batch.add(plane, mats[k], this.rng.range(-46, 46), 0.01, this.rng.range(-46, 46), 0, this.rng.range(0, 6.28), 0, s, 1, s, { cast: false });
    }
  }

  /** 맵 밖 먼 건물 실루엣 (충돌 없음, 안개 속 배경) */
  private buildSkyline(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3e4245, roughness: 1 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 40; i++) {
      const side = i % 4;
      const a = this.rng.range(-70, 70);
      const off = this.rng.range(HALF + 6, HALF + 22);
      if (Math.abs(a) < ROAD + 2) continue;
      const [x, z] = side === 0 ? [a, -off] : side === 1 ? [a, off] : side === 2 ? [-off, a] : [off, a];
      const w = this.rng.range(6, 14);
      const h = this.rng.range(8, 30);
      this.batch.add(box, mat, x, h / 2, z, 0, 0, 0, w, h, this.rng.range(6, 14), { cast: false, receive: false });
    }
  }
}
