import * as THREE from 'three';
import { EFFECTS_CONFIG, PLAYER_CONFIG, WEAPON_CONFIG } from '../config/GameConfig';
import { clamp, damp, wrapAngle } from '../core/random';
import { GUNS, GunId, MELEE, MeleeId, MeleeStyle } from '../weapons/WeaponData';

/** 애니메이션에 필요한 상태 (게임 로직 → 시각 계층, 한 방향) */
export interface PlayerVisualState {
  position: THREE.Vector3;
  aimYaw: number;
  velocity: THREE.Vector3;
  /** 조준 자세 유지 여부 (사격 중 · 최근 사격) */
  aiming: boolean;
  reloading: boolean;
  reloadProgress: number;
  /** 들고 있는 총 · 교체 전 총 · 교체 진행도(0~1, 교체 중 아니면 -1) */
  gunId: GunId;
  switchFrom: GunId | null;
  switchProgress: number;
  /** 근접 무기 · 휘두르기 진행도(0~1, 아니면 -1) · 그 무기 · 타격 순간 비율 */
  meleeId: MeleeId;
  meleeProgress: number;
  swingId: MeleeId;
  swingHitFraction: number;
}

/** 총기 모델: 총구는 모두 같은 위치(GUN_TIP_Z), 손 위치 · 탄창 위치만 다르다 */
interface GunModel {
  group: THREE.Group;
  mag: THREE.Mesh;
  grip: THREE.Vector3;
  support: THREE.Vector3;
  magwell: THREE.Vector3;
}

interface MeleeModel {
  group: THREE.Group;
  /** 들고 있지 않을 때 위치 (상체 좌표) · 회전 */
  holsterPos: THREE.Vector3;
  holsterRot: THREE.Euler;
}

// ── 치수 (단위: m). 발바닥 = y 0
const HIP_H = 0.92;
const THIGH = 0.44;
const SHIN = 0.42;
const UPPER_ARM = 0.335;
const FOREARM = 0.33;
/** 상체 기준 소총 위치: 총구 = muzzleOffset 이 되도록 맞춘다 */
const MUZ = WEAPON_CONFIG.muzzleOffset;
const GUN_TIP_Z = 0.72;
const GUN_POS = new THREE.Vector3(MUZ.x, MUZ.y - HIP_H, MUZ.z - GUN_TIP_Z);
/** 상체 회전 (조준 자세에서 왼쪽 어깨가 앞으로) */
const CHEST_TWIST = -0.35;
const ZERO = new THREE.Vector3();

const COLORS = {
  jacket: 0x4b5437, vest: 0x2a2d2e, pants: 0x34404f, boots: 0x2b2118, skin: 0xc79878, glove: 0x1e1e1e,
  cap: 0x7a2a1f, pack: 0x6d5c3c, gunMetal: 0x1f2124, gunFurniture: 0x5e533f, strap: 0x1b1c1c,
};

/**
 * 절차적 사람형 캐릭터 + 절차적 애니메이션.
 * 게임 로직과 분리된 순수 시각 계층: update() 는 상태를 읽기만 하고 아무것도 바꾸지 않는다.
 * - 하체: 이동 방향으로 비틀고 걷기 주기에 맞춰 다리를 휘두름. 낮은 발이 항상 지면에 닿도록 높이 보정
 * - 상체: 조준 방향 고정. 소총은 상체에, 두 팔은 IK 로 총을 잡음
 * - 사격 반동 · 조준/대기 자세 전환 · 재장전 (탄창 교체) 동작
 */
export class PlayerModel {
  readonly root = new THREE.Group();
  private readonly pelvis = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly chest = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly gun = new THREE.Group();
  private readonly gunModels = {} as Record<GunId, GunModel>;
  private readonly meleeModels = {} as Record<MeleeId, MeleeModel>;
  private shownGun: GunId = 'ar12';
  private shownMelee: MeleeId = 'knife';
  private gunMag!: THREE.Mesh;
  private readonly handMag: THREE.Mesh;
  private meleeBlend = 0;
  private readonly legs: { thigh: THREE.Group; knee: THREE.Group; foot: THREE.Mesh }[] = [];
  private readonly arms: ArmRig[] = [];
  private readonly aimMarker: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  // 애니메이션 상태
  private phase = 0;
  private walkBlend = 0;
  private hipTwist = 0;
  private legDir = 1;
  private aimBlend = 0;
  private recoil = 0;
  private time = 0;
  private reloadBlend = 0;
  private lastReload = 0;
  /** 재장전 중 빈 탄창이 떨어지는 순간 1회 호출 */
  onMagazineDrop: ((worldPos: THREE.Vector3, yaw: number) => void) | null = null;

  // 재사용 임시 객체
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly m4 = new THREE.Matrix4();
  private readonly kHandguard = new THREE.Vector3();
  private readonly kMagwell = new THREE.Vector3();
  private readonly kMagLow = new THREE.Vector3();
  private readonly kPouch = new THREE.Vector3();
  private readonly kHand = new THREE.Vector3();
  private readonly kElbow = new THREE.Vector3();
  private readonly kPole = new THREE.Vector3();
  private readonly kShoulder = new THREE.Vector3();
  /** 손이 손잡이에 닿지 못한 거리 (m) */
  readonly handGap = { left: 0, right: 0 };
  private readonly kMeleeHand = new THREE.Vector3();
  private readonly kMeleeDir = new THREE.Vector3();
  private readonly reloadKeys: [number, THREE.Vector3][] = [0, 0.16, 0.3, 0.48, 0.66, 0.78, 0.9, 1].map((t) => [t, this.kHandguard]);

  constructor() {
    this.root.name = 'player';
    const mat = (color: number, rough = 0.85, metal = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
      this.materials.push(m);
      return m;
    };
    const M = {
      jacket: mat(COLORS.jacket), vest: mat(COLORS.vest, 0.7), pants: mat(COLORS.pants), boots: mat(COLORS.boots, 0.6),
      skin: mat(COLORS.skin, 0.7), glove: mat(COLORS.glove, 0.6), cap: mat(COLORS.cap, 0.9), pack: mat(COLORS.pack, 0.95),
      gunMetal: mat(COLORS.gunMetal, 0.45, 0.7), gunFurniture: mat(COLORS.gunFurniture, 0.8), strap: mat(COLORS.strap, 0.9),
    };
    const geo = <T extends THREE.BufferGeometry>(g: T): T => { this.geometries.push(g); return g; };
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    const box = (w: number, h: number, d: number) => geo(new THREE.BoxGeometry(w, h, d));
    const capsule = (r: number, len: number) => geo(new THREE.CapsuleGeometry(r, len, 4, 10));

    this.root.add(this.pelvis, this.upper);
    this.pelvis.position.y = HIP_H;
    this.upper.position.y = HIP_H;

    // ── 하체: 골반 + 다리 2개
    mesh(box(0.34, 0.16, 0.2), M.pants, this.pelvis, 0, 0.0, 0);
    mesh(box(0.36, 0.05, 0.22), M.strap, this.pelvis, 0, 0.08, 0); // 벨트
    mesh(box(0.1, 0.12, 0.08), M.pack, this.pelvis, 0.15, 0.02, 0.06); // 탄창 파우치 (왼쪽 허리)
    for (const side of [1, -1]) {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.1, -0.04, 0);
      this.pelvis.add(thigh);
      mesh(capsule(0.075, THIGH - 0.1), M.pants, thigh, 0, -THIGH / 2, 0);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      thigh.add(knee);
      mesh(capsule(0.065, SHIN - 0.16), M.pants, knee, 0, -SHIN / 2 + 0.03, 0);
      mesh(box(0.11, 0.08, 0.06), M.vest, knee, 0, -0.02, 0.05); // 무릎 보호대
      const foot = mesh(box(0.12, 0.1, 0.27), M.boots, knee, 0, -SHIN - (HIP_H - 0.04 - THIGH - SHIN) + 0.05, 0.055);
      this.legs.push({ thigh, knee, foot });
    }

    // ── 상체: 가슴(비틀림) · 머리 · 배낭
    this.upper.add(this.chest);
    this.chest.rotation.y = CHEST_TWIST;
    mesh(box(0.38, 0.5, 0.22), M.jacket, this.chest, 0, 0.3, 0);
    mesh(box(0.4, 0.34, 0.26), M.vest, this.chest, 0, 0.34, 0.005); // 방탄조끼
    for (const x of [-0.11, 0, 0.11]) mesh(box(0.09, 0.12, 0.05), M.pack, this.chest, x, 0.26, 0.15); // 조끼 파우치
    mesh(box(0.32, 0.38, 0.16), M.pack, this.chest, 0, 0.36, -0.19); // 배낭
    mesh(box(0.3, 0.1, 0.14), M.strap, this.chest, 0, 0.58, -0.19); // 침낭
    mesh(geo(new THREE.CylinderGeometry(0.055, 0.06, 0.08, 10)), M.skin, this.chest, 0, 0.58, 0); // 목
    this.head.position.set(0, 0.7, 0);
    this.chest.add(this.head);
    // 머리는 가슴 비틀림을 되돌려 정면(조준 방향)을 본다
    this.head.rotation.y = -CHEST_TWIST * 0.8;
    mesh(geo(new THREE.SphereGeometry(0.115, 16, 12)), M.skin, this.head, 0, 0, 0).scale.set(1, 1.1, 1.05);
    const cap = mesh(geo(new THREE.SphereGeometry(0.122, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), M.cap, this.head, 0, 0.02, -0.005);
    cap.scale.set(1, 0.85, 1.05);
    mesh(box(0.2, 0.02, 0.12), M.cap, this.head, 0, 0.035, 0.12); // 모자 챙: 바라보는 방향 표시
    mesh(box(0.2, 0.05, 0.03), M.strap, this.head, 0, -0.005, 0.105); // 고글 밴드
    mesh(box(0.08, 0.035, 0.02), M.gunMetal, this.head, 0.045, -0.005, 0.12); // 고글 렌즈
    mesh(box(0.08, 0.035, 0.02), M.gunMetal, this.head, -0.045, -0.005, 0.12);

    // ── 총기 5종 (상체 기준, 비틀림 없음 → 항상 조준 방향). 보이는 것만 visible
    this.gun.position.copy(GUN_POS);
    this.upper.add(this.gun);
    const M2 = {
      ...M,
      wood: mat(0x6e4a2c, 0.75), olive: mat(0x3f4a2c, 0.8), polymer: mat(0x2b2d2f, 0.6), shell: mat(0x9b2a20, 0.6),
      steel: mat(0xb9bec4, 0.3, 0.85), red: mat(0x9e1c17, 0.55), handle: mat(0x3a2a1c, 0.8), tape: mat(0x22252a, 0.95),
    };
    const cyl = (r: number, len: number) => geo(new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2));
    const gunModel = (id: GunId, build: (g: THREE.Group) => THREE.Mesh, grip: number[], support: number[], magwell: number[]) => {
      const g = new THREE.Group();
      g.visible = false;
      this.gun.add(g);
      const mag = build(g);
      this.gunModels[id] = { group: g, mag, grip: new THREE.Vector3(...grip), support: new THREE.Vector3(...support), magwell: new THREE.Vector3(...magwell) };
    };
    // AR-12: 기존 자동소총
    gunModel('ar12', (g) => {
      mesh(box(0.065, 0.11, 0.42), M.gunMetal, g, 0, 0, 0.1);
      mesh(box(0.07, 0.085, 0.27), M.gunFurniture, g, 0, -0.005, 0.44);
      mesh(cyl(0.016, 0.18), M.gunMetal, g, 0, 0.012, GUN_TIP_Z - 0.09).castShadow = false;
      mesh(box(0.035, 0.035, 0.05), M.gunMetal, g, 0, 0.012, GUN_TIP_Z - 0.02);
      mesh(box(0.055, 0.12, 0.26), M.gunFurniture, g, 0, -0.03, -0.22);
      mesh(box(0.04, 0.11, 0.05), M.gunFurniture, g, 0, -0.1, -0.02).rotation.x = -0.35;
      mesh(box(0.05, 0.05, 0.11), M.gunMetal, g, 0, 0.085, 0.06);
      mesh(box(0.012, 0.05, 0.01), M.gunMetal, g, 0, 0.065, GUN_TIP_Z - 0.18);
      mesh(box(0.02, 0.02, 0.5), M.strap, g, 0.04, -0.06, 0.05);
      const mag = mesh(box(0.045, 0.17, 0.08), M.gunMetal, g, 0, -0.12, 0.13);
      mag.rotation.x = 0.22;
      return mag;
    }, [0, -0.075, 0.03], [0, -0.05, 0.3], [0.02, -0.14, 0.13]);
    // P9 권총: 짧은 총, 두 손으로 앞으로 뻗어 잡음
    gunModel('p9', (g) => {
      mesh(box(0.042, 0.055, 0.21), M2.polymer, g, 0, 0.012, 0.615); // 슬라이드
      mesh(box(0.038, 0.035, 0.17), M.gunMetal, g, 0, -0.028, 0.605); // 프레임
      mesh(box(0.038, 0.11, 0.05), M2.polymer, g, 0, -0.085, 0.545).rotation.x = -0.22; // 손잡이
      mesh(box(0.008, 0.016, 0.008), M.gunMetal, g, 0, 0.046, GUN_TIP_Z - 0.02); // 가늠쇠
      mesh(box(0.02, 0.012, 0.012), M.gunMetal, g, 0, 0.046, 0.53);
      const mag = mesh(box(0.032, 0.035, 0.04), M.gunMetal, g, 0, -0.15, 0.53);
      return mag;
    }, [0, -0.085, 0.545], [0.035, -0.095, 0.56], [0, -0.16, 0.53]);
    // Viper SMG: 짧고 각진 몸통, 긴 탄창, 앞손잡이
    gunModel('viper', (g) => {
      mesh(box(0.06, 0.09, 0.32), M2.polymer, g, 0, 0, 0.38);
      mesh(box(0.055, 0.065, 0.1), M.gunMetal, g, 0, 0.005, 0.6);
      mesh(cyl(0.014, 0.1), M.gunMetal, g, 0, 0.01, GUN_TIP_Z - 0.05);
      mesh(box(0.035, 0.09, 0.04), M2.polymer, g, 0, -0.085, 0.27).rotation.x = -0.3; // 손잡이
      mesh(box(0.03, 0.08, 0.035), M2.polymer, g, 0, -0.08, 0.47); // 앞손잡이
      mesh(box(0.012, 0.012, 0.22), M.gunMetal, g, 0.022, 0.015, 0.11); // 접이식 개머리
      mesh(box(0.012, 0.012, 0.22), M.gunMetal, g, -0.022, 0.015, 0.11);
      mesh(box(0.05, 0.07, 0.012), M.gunMetal, g, 0, -0.01, 0.0);
      mesh(box(0.04, 0.04, 0.08), M.gunMetal, g, 0, 0.065, 0.36); // 조준기
      const mag = mesh(box(0.032, 0.22, 0.045), M.gunMetal, g, 0, -0.15, 0.44);
      mag.rotation.x = 0.08;
      return mag;
    }, [0, -0.09, 0.27], [0, -0.115, 0.47], [0, -0.06, 0.44]);
    // Bulldog 샷건: 긴 총열 + 튜브 탄창 + 나무 펌프 · 개머리
    gunModel('bulldog', (g) => {
      mesh(box(0.07, 0.1, 0.26), M.gunMetal, g, 0, 0, 0.07);
      mesh(cyl(0.024, 0.5), M.gunMetal, g, 0, 0.022, 0.47);
      mesh(cyl(0.02, 0.44), M.gunMetal, g, 0, -0.03, 0.42);
      mesh(box(0.068, 0.06, 0.17), M2.wood, g, 0, -0.03, 0.31); // 펌프
      mesh(box(0.058, 0.13, 0.3), M2.wood, g, 0, -0.035, -0.2);
      mesh(box(0.04, 0.1, 0.05), M2.wood, g, 0, -0.09, -0.02).rotation.x = -0.4;
      mesh(box(0.01, 0.015, 0.01), M.gunMetal, g, 0, 0.05, GUN_TIP_Z - 0.02); // 비드
      const mag = mesh(box(0.024, 0.024, 0.065), M2.shell, g, 0.0, -0.07, 0.11); // 장전 중인 산탄
      return mag;
    }, [0, -0.08, -0.02], [0, -0.065, 0.31], [0, -0.08, 0.11]);
    // Titan LMG: 두꺼운 몸통, 옆 탄통, 손잡이, 접은 양각대
    gunModel('titan', (g) => {
      mesh(box(0.09, 0.13, 0.46), M2.olive, g, 0, 0, 0.1);
      mesh(box(0.075, 0.075, 0.24), M.gunMetal, g, 0, 0.01, 0.46); // 총열 덮개
      mesh(cyl(0.02, 0.14), M.gunMetal, g, 0, 0.012, GUN_TIP_Z - 0.07);
      mesh(box(0.045, 0.04, 0.05), M.gunMetal, g, 0, 0.012, GUN_TIP_Z - 0.02);
      mesh(box(0.02, 0.06, 0.16), M.gunMetal, g, 0, 0.11, 0.15); // 손잡이 기둥
      mesh(box(0.03, 0.02, 0.18), M.gunMetal, g, 0, 0.14, 0.15);
      mesh(box(0.07, 0.13, 0.25), M2.olive, g, 0, -0.03, -0.22);
      mesh(box(0.045, 0.1, 0.05), M2.polymer, g, 0, -0.1, -0.03).rotation.x = -0.35;
      mesh(box(0.012, 0.012, 0.26), M.gunMetal, g, 0.02, -0.04, 0.48); // 양각대
      mesh(box(0.012, 0.012, 0.26), M.gunMetal, g, -0.02, -0.04, 0.48);
      mesh(box(0.012, 0.12, 0.012), M.strap, g, 0.0, -0.02, 0.32).rotation.x = 0.4; // 탄띠
      const mag = mesh(box(0.11, 0.13, 0.14), M2.olive, g, 0.07, -0.1, 0.12); // 탄통
      return mag;
    }, [0, -0.09, -0.03], [0, -0.07, 0.3], [0.07, -0.08, 0.12]);
    this.setGunModel('ar12');
    this.handMag = mesh(box(0.045, 0.17, 0.08), M.gunMetal, this.upper);
    this.handMag.visible = false;

    // ── 근접 무기 4종 (길이 방향 +Y, 손잡이 끝이 원점). 들고 있지 않을 때는 허리 · 등에
    const meleeModel = (id: MeleeId, holster: number[], rot: number[], build: (g: THREE.Group) => void) => {
      const g = new THREE.Group();
      g.visible = false;
      build(g);
      this.upper.add(g);
      this.meleeModels[id] = { group: g, holsterPos: new THREE.Vector3(...holster), holsterRot: new THREE.Euler(...rot) };
    };
    meleeModel('knife', [0.21, 0.02, 0.08], [Math.PI + 0.2, 0, 0.1], (g) => {
      mesh(box(0.03, 0.1, 0.03), M2.handle, g, 0, 0.05, 0);
      mesh(box(0.07, 0.014, 0.034), M.gunMetal, g, 0, 0.105, 0);
      const blade = mesh(box(0.01, 0.17, 0.034), M2.steel, g, 0, 0.195, 0);
      blade.scale.set(1, 1, 1);
      mesh(box(0.009, 0.04, 0.02), M2.steel, g, 0, 0.29, -0.006); // 끝
    });
    meleeModel('machete', [0.21, -0.02, -0.04], [Math.PI + 0.1, 0, 0.12], (g) => {
      mesh(box(0.032, 0.13, 0.034), M2.handle, g, 0, 0.065, 0);
      mesh(box(0.012, 0.44, 0.065), M2.steel, g, 0, 0.35, 0.006);
      mesh(box(0.012, 0.1, 0.08), M2.steel, g, 0, 0.53, 0.014); // 넓은 끝
    });
    meleeModel('bat', [0.08, 0.25, -0.27], [0.1, 0, 2.5], (g) => {
      mesh(geo(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 10)), M2.handle, g, 0, 0.012, 0); // 손잡이 끝
      mesh(geo(new THREE.CylinderGeometry(0.02, 0.018, 0.2, 10)), M2.tape, g, 0, 0.11, 0); // 그립 테이프
      mesh(geo(new THREE.CylinderGeometry(0.045, 0.021, 0.58, 12)), M2.wood, g, 0, 0.5, 0);
      mesh(geo(new THREE.SphereGeometry(0.045, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), M2.wood, g, 0, 0.79, 0); // 둥근 타격부
    });
    meleeModel('axe', [0.06, 0.25, -0.27], [0.1, 0, -2.5], (g) => {
      mesh(geo(new THREE.CylinderGeometry(0.019, 0.021, 0.72, 10)), M2.wood, g, 0, 0.36, 0);
      mesh(box(0.03, 0.1, 0.06), M2.red, g, 0, 0.67, 0);
      const blade = mesh(box(0.012, 0.16, 0.13), M2.steel, g, 0, 0.66, 0.085); // 도끼날
      blade.rotation.x = 0.08;
      mesh(box(0.014, 0.05, 0.1), M2.red, g, 0, 0.67, -0.07); // 반대쪽 곡괭이
    });
    this.setMeleeModel('knife');

    // ── 팔 (IK 로 매 프레임 배치)
    const upperG = geo(new THREE.CylinderGeometry(0.058, 0.05, 1, 10));
    const foreG = geo(new THREE.CylinderGeometry(0.05, 0.042, 1, 10));
    const jointG = geo(new THREE.SphereGeometry(0.055, 10, 8));
    const handG = geo(new THREE.BoxGeometry(0.075, 0.085, 0.1));
    const shoulderG = geo(new THREE.SphereGeometry(0.075, 10, 8));
    for (const side of [1, -1]) {
      mesh(shoulderG, M.jacket, this.chest, side * 0.2, 0.5, 0);
      this.arms.push({
        upper: mesh(upperG, M.jacket, this.upper),
        fore: mesh(foreG, M.jacket, this.upper),
        elbow: mesh(jointG, M.jacket, this.upper),
        hand: mesh(handG, M.glove, this.upper),
        side,
      });
    }

    // ── 바닥 방향 표시 (조준 방향을 가리키는 원 + 화살표)
    const ringGeo = geo(aimMarkerGeometry());
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    this.materials.push(ringMat);
    this.aimMarker = new THREE.Mesh(ringGeo, ringMat);
    this.aimMarker.position.y = 0.02;
    this.aimMarker.renderOrder = 2;
    this.root.add(this.aimMarker);

    this.update(0, {
      position: new THREE.Vector3(), aimYaw: 0, velocity: new THREE.Vector3(), aiming: false, reloading: false, reloadProgress: 0,
      gunId: 'ar12', switchFrom: null, switchProgress: -1, meleeId: 'knife', meleeProgress: -1, swingId: 'knife', swingHitFraction: 0.3,
    });
  }

  private hurt = 0;
  private deathT = -1;
  private readonly hurtColor = new THREE.Color(0xff2a1a);

  /** 피격: 몸이 붉게 번쩍임 */
  flashHurt(): void {
    this.hurt = 1;
  }

  /** 사망 시작 / 해제 */
  setDead(dead: boolean): void {
    this.deathT = dead ? 0 : -1;
    // 부활: 쓰러질 때 기울인 회전(x · z)과 높이를 모두 되돌린다
    if (!dead) { this.root.rotation.set(0, this.root.rotation.y, 0); this.root.position.y = 0; this.hurt = 0; this.applyHurt(); }
  }

  private applyHurt(): void {
    for (const m of this.materials) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.isMeshStandardMaterial) { sm.emissive.copy(this.hurtColor); sm.emissiveIntensity = this.hurt * this.hurt * 0.45; }
    }
  }

  /** 사격 1회: 반동 충격 (총기별 세기) */
  kick(gun: GunId): void {
    const k = GUNS[gun]?.recoil ?? EFFECTS_CONFIG.recoilKick;
    this.recoil = Math.min(this.recoil + k, k * 1.6);
    this.aimBlend = Math.max(this.aimBlend, 0.85);
  }

  private setGunModel(id: GunId): void {
    if (this.gunModels[this.shownGun]) this.gunModels[this.shownGun].group.visible = false;
    this.shownGun = id;
    this.gunModels[id].group.visible = true;
    this.gunMag = this.gunModels[id].mag;
  }

  private setMeleeModel(id: MeleeId): void {
    if (this.meleeModels[this.shownMelee]) this.meleeModels[this.shownMelee].group.visible = false;
    this.shownMelee = id;
    this.meleeModels[id].group.visible = true;
  }

  update(dt: number, s: PlayerVisualState): void {
    this.time += dt;
    this.root.position.set(s.position.x, 0, s.position.z);
    this.root.rotation.y = s.aimYaw;
    if (this.hurt > 0) { this.hurt = Math.max(0, this.hurt - dt * 7); this.applyHurt(); }
    if (this.deathT >= 0) {
      // 사망: 무릎이 꺾이며 옆으로 쓰러짐 (이동 애니메이션 정지)
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.7);
      const e = 1 - Math.pow(1 - k, 3);
      this.root.rotation.set(0, s.aimYaw, 0);
      this.root.rotateZ(e * 1.45);
      this.root.position.y = e * 0.15;
      this.aimMarker.visible = false;
      s = { ...s, velocity: ZERO, aiming: false, reloading: false };
    } else {
      // 살아 있는 동안은 항상 똑바로 선 자세 (사망 연출의 기울기가 남지 않게)
      this.root.rotation.set(0, s.aimYaw, 0);
      this.root.position.y = 0;
      this.aimMarker.visible = true;
    }

    // ── 이동 방향 → 하체 비틀림 · 걷기 주기
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    const sinY = Math.sin(s.aimYaw);
    const cosY = Math.cos(s.aimYaw);
    // 조준 기준 로컬 속도 (z 앞, x 왼쪽)
    const lz = s.velocity.x * sinY + s.velocity.z * cosY;
    const lx = s.velocity.x * cosY - s.velocity.z * sinY;
    const moveTarget = clamp(speed / PLAYER_CONFIG.moveSpeed, 0, 1);
    this.walkBlend += (moveTarget - this.walkBlend) * damp(10, dt);
    let twistTarget = 0;
    if (speed > 0.3) {
      const rel = Math.atan2(lx, lz);
      // 옆걸음은 앞을 향해, 뒤로 걸을 때는 뒷걸음질
      if (Math.abs(rel) <= 1.75) { this.legDir = 1; twistTarget = clamp(rel, -1.1, 1.1); }
      else { this.legDir = -1; twistTarget = clamp(wrapAngle(rel - Math.PI), -1.1, 1.1); }
    }
    this.hipTwist += (twistTarget - this.hipTwist) * damp(12, dt);
    this.pelvis.rotation.y = this.hipTwist;
    this.phase += (speed * dt / 0.78) * Math.PI * this.legDir;

    const amp = 0.55 * this.walkBlend;
    const kneeAmp = 0.95 * this.walkBlend;
    const sole: number[] = [];
    this.legs.forEach((leg, i) => {
      const ph = this.phase + i * Math.PI;
      // 정지 시 짝다리 대기 자세
      const idle = (1 - this.walkBlend) * (i === 0 ? 0.05 : -0.04);
      const a = -Math.sin(ph) * amp + idle; // 엉덩이 (음수 = 앞으로)
      const lift = Math.max(0, Math.cos(ph) * this.legDir); // 다리를 앞으로 옮기는 구간에서 무릎을 굽힘
      const k = lift * kneeAmp + 0.05 + (1 - this.walkBlend) * 0.03;
      leg.thigh.rotation.x = a;
      leg.knee.rotation.x = k;
      // 발목: 발바닥이 지면과 거의 평행하도록
      leg.foot.rotation.x = -(a + k) * 0.85;
      // 발바닥 높이 계산 (엉덩이 관절 기준 2D)
      const ankleY = -THIGH * Math.cos(a) - SHIN * Math.cos(a + k);
      sole.push(HIP_H - 0.04 + ankleY - (HIP_H - 0.04 - THIGH - SHIN));
    });
    // 낮은 발이 항상 지면(y=0)에 닿도록 몸 전체 높이를 보정
    const drop = Math.min(sole[0], sole[1]);
    const bob = -drop;
    this.pelvis.position.y = HIP_H + bob;
    const breathe = Math.sin(this.time * 2.1) * 0.006 * (1 - this.walkBlend);
    this.upper.position.y = HIP_H + bob + breathe;
    // 상체: 이동 시 진행 방향으로 살짝 기울고 걸음에 따라 흔들림
    this.upper.rotation.x = (lz / PLAYER_CONFIG.moveSpeed) * 0.08;
    this.upper.rotation.z = -(lx / PLAYER_CONFIG.moveSpeed) * 0.06 + Math.sin(this.phase) * 0.02 * this.walkBlend;

    // ── 근접 · 교체 상태
    const melee = s.meleeProgress >= 0;
    this.meleeBlend += ((melee ? 1 : 0) - this.meleeBlend) * damp(melee ? 30 : 10, dt);
    if (s.meleeId !== this.shownMelee && !melee) this.setMeleeModel(s.meleeId);
    if (melee && this.shownMelee !== s.swingId) this.setMeleeModel(s.swingId);
    // 교체: 앞 절반은 이전 총을 내리고, 뒤 절반은 새 총을 올림
    let dip = 0;
    if (s.switchProgress >= 0) {
      const want = s.switchProgress < 0.5 && s.switchFrom ? s.switchFrom : s.gunId;
      if (want !== this.shownGun) this.setGunModel(want);
      dip = Math.sin(s.switchProgress * Math.PI);
    } else if (s.gunId !== this.shownGun) {
      this.setGunModel(s.gunId);
    }

    // ── 조준 / 대기 자세 전환
    const wantAim = s.aiming && !s.reloading && !melee && s.switchProgress < 0 ? 1 : 0;
    this.aimBlend += (wantAim - this.aimBlend) * damp(wantAim > this.aimBlend ? 22 : 4, dt);

    // ── 반동: 사격 순간 뒤로 밀렸다가 빠르게 복귀
    this.recoil *= Math.exp(-EFFECTS_CONFIG.recoilRecovery * dt);

    // ── 재장전 동작 진행도
    const rp = s.reloading ? s.reloadProgress : 0;
    this.reloadBlend += ((s.reloading ? 1 : 0) - this.reloadBlend) * damp(14, dt);
    if (s.reloading && this.lastReload < 0.32 && rp >= 0.32) this.dropMagazine();
    this.lastReload = rp;

    // 총: 대기 자세는 총구를 아래로, 재장전 중에는 옆으로 기울여 탄창 쪽을 보여 줌,
    // 교체 중에는 아래로 내렸다 올리고, 근접 공격 중에는 오른쪽 아래로 비켜 든다
    const low = Math.max(1 - this.aimBlend, this.meleeBlend);
    const rw = this.reloadBlend * envelope(rp, 0.12, 0.88);
    const mb = this.meleeBlend;
    this.gun.position.set(
      GUN_POS.x + low * 0.04 + rw * 0.05 - mb * 0.06,
      GUN_POS.y - low * 0.1 - rw * 0.06 - dip * 0.28 - mb * 0.08,
      GUN_POS.z + GUNS[this.shownGun].holdZ - this.recoil - low * 0.05 - rw * 0.08 - dip * 0.15 - mb * 0.12,
    );
    this.gun.rotation.set(low * 0.55 - this.recoil * 1.1 - rw * 0.2 + dip * 0.9 + mb * 0.3, low * 0.25 + rw * 0.1 + mb * 0.3, rw * 0.55 + dip * 0.4);
    let chestYaw = CHEST_TWIST * (0.55 + 0.45 * this.aimBlend);
    this.chest.rotation.x = -this.recoil * 0.4;

    // ── 근접 휘두르기 경로 (상체 좌표): 손 위치 · 무기 방향
    const meleePose = melee ? meleePath(MELEE[s.swingId].style, s.meleeProgress, s.swingHitFraction, this.kMeleeHand, this.kMeleeDir) : null;
    if (meleePose !== null) chestYaw += meleePose * 0.45;
    this.chest.rotation.y = chestYaw;
    this.gun.updateMatrix();
    this.chest.updateMatrix();

    // ── 탄창 표시
    const magOut = s.reloading && rp > 0.32 && rp < 0.8;
    const magInHand = s.reloading && rp > 0.48 && rp < 0.8;
    this.gunMag.visible = !magOut;
    this.handMag.visible = magInHand;

    // ── 팔 IK
    const right = this.arms[1];
    const left = this.arms[0];
    const gm = this.gunModels[this.shownGun];
    const grip = this.gunPoint(gm.grip.x, gm.grip.y, gm.grip.z, this.v1);
    this.solveArm(right, this.shoulder(-1, this.kShoulder), grip, -1);
    const mm = this.meleeModels[this.shownMelee];
    if (meleePose !== null) {
      // 왼손이 근접 무기를 쥐고 경로를 따라 휘두름. 무기는 실제 손 위치에 붙인다
      const handPos = this.solveArm(left, this.shoulder(1, this.kShoulder), this.kMeleeHand, 1);
      mm.group.position.copy(handPos);
      mm.group.quaternion.setFromUnitVectors(this.up, this.kMeleeDir);
    } else {
      const leftTarget = this.leftHandTarget(s.reloading ? rp : -1, this.v2);
      this.solveArm(left, this.shoulder(1, this.kShoulder), leftTarget, 1);
      if (magInHand) {
        this.handMag.position.copy(leftTarget).add(this.v4.set(0, 0.06, 0));
        this.handMag.rotation.copy(this.gun.rotation);
      }
      mm.group.position.copy(mm.holsterPos);
      mm.group.rotation.copy(mm.holsterRot);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }

  /** 소총 로컬 좌표 → 상체(upper) 좌표 */
  private gunPoint(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(x, y, z).applyMatrix4(this.gun.matrix);
  }

  /** 어깨 관절 위치 (상체 좌표). side 1 = 왼쪽 */
  private shoulder(side: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(side * 0.2, 0.5, 0).applyMatrix4(this.chest.matrix);
  }

  /** 왼손 목표: 평소엔 총열 덮개, 재장전 중에는 탄창 → 허리 파우치 → 탄창 삽입 */
  private leftHandTarget(p: number, out: THREE.Vector3): THREE.Vector3 {
    const gm = this.gunModels[this.shownGun];
    const handguard = this.gunPoint(gm.support.x, gm.support.y, gm.support.z, this.kHandguard);
    if (p < 0) return out.copy(handguard);
    const magwell = this.gunPoint(gm.magwell.x, gm.magwell.y, gm.magwell.z, this.kMagwell);
    const magLow = this.gunPoint(gm.magwell.x, gm.magwell.y - 0.16, gm.magwell.z, this.kMagLow);
    // 허리 파우치 (왼쪽 허리, 상체 좌표)
    const pouch = this.kPouch.set(0.15, -0.05, 0.1);
    const keys = this.reloadKeys;
    keys[0][1] = handguard; keys[1][1] = magwell; keys[2][1] = magLow; keys[3][1] = pouch;
    keys[4][1] = magLow; keys[5][1] = magwell; keys[6][1] = handguard; keys[7][1] = handguard;
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, a] = keys[i];
      const [t1, b] = keys[i + 1];
      if (p <= t1) {
        const t = smooth((p - t0) / (t1 - t0));
        return out.lerpVectors(a, b, t);
      }
    }
    return out.copy(handguard);
  }

  /** 2관절 IK: 어깨 S → 손 T, 팔꿈치는 아래 · 바깥쪽 */
  private solveArm(arm: ArmRig, S: THREE.Vector3, T: THREE.Vector3, side: number): THREE.Vector3 {
    const a = UPPER_ARM;
    const b = FOREARM;
    const toT = this.v4.subVectors(T, S);
    let d = toT.length();
    // 손이 목표(손잡이)에 닿지 못한 거리 (0 이면 정확히 잡음) — 테스트 · 디버그용
    this.handGap[side > 0 ? 'left' : 'right'] = Math.max(0, d - (a + b - 0.002));
    const u = toT.multiplyScalar(1 / (d || 1));
    d = clamp(d, 0.05, a + b - 0.002);
    const hand = this.kHand.copy(S).addScaledVector(u, d);
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    // 팔꿈치 방향 힌트: 아래 + 바깥
    const pole = this.kPole.set(side * 0.7, -1, -0.2);
    pole.addScaledVector(u, -pole.dot(u)).normalize();
    const elbow = this.kElbow.copy(S).addScaledVector(u, a * cosA).addScaledVector(pole, a * sinA);
    placeLimb(arm.upper, S, elbow, this.up);
    placeLimb(arm.fore, elbow, hand, this.up);
    arm.elbow.position.copy(elbow);
    arm.hand.position.copy(hand);
    arm.hand.quaternion.setFromRotationMatrix(this.m4.extractRotation(this.gun.matrix));
    return hand;
  }

  private dropMagazine(): void {
    if (!this.onMagazineDrop) return;
    const gm = this.gunModels[this.shownGun];
    const p = this.gunPoint(gm.magwell.x, gm.magwell.y - 0.06, gm.magwell.z, new THREE.Vector3());
    this.root.updateMatrixWorld();
    this.upper.localToWorld(p);
    this.onMagazineDrop(p, this.root.rotation.y);
  }
}

interface ArmRig {
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  elbow: THREE.Mesh;
  hand: THREE.Mesh;
  side: number;
}

const limbDir = new THREE.Vector3();
/** 원통 메시를 두 점 사이에 배치 (Y축 = 길이 방향) */
function placeLimb(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, up: THREE.Vector3): void {
  const dir = limbDir.subVectors(b, a);
  const len = dir.length();
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(up, dir.multiplyScalar(1 / (len || 1)));
  mesh.scale.set(1, len, 1);
}

function smooth(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** 0 → 1 (a 까지 올라감) → 유지 → 0 (b 이후 내려감) */
function envelope(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p < a) return smooth(p / a);
  if (p > b) return smooth((1 - p) / (1 - b));
  return 1;
}

/** 캐릭터 발밑 원 + 정면 화살표 (조준 방향 표시) */
function aimMarkerGeometry(): THREE.BufferGeometry {
  const ring = new THREE.RingGeometry(0.62, 0.68, 40);
  ring.rotateX(-Math.PI / 2);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.16, 0, 0.74, 0.16, 0, 0.74, 0, 0, 1.0], 3));
  tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  tri.setIndex([0, 2, 1]);
  const r = ring.toNonIndexed();
  const t = tri.toNonIndexed();
  const pos = new Float32Array(r.getAttribute('position').array.length + t.getAttribute('position').array.length);
  pos.set(r.getAttribute('position').array as Float32Array, 0);
  pos.set(t.getAttribute('position').array as Float32Array, r.getAttribute('position').array.length);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ring.dispose(); tri.dispose(); r.dispose(); t.dispose();
  return g;
}

/**
 * 근접 무기 휘두르기 경로 (상체 좌표, 정면 +z, 캐릭터 왼쪽 +x).
 * p: 진행도 0~1, h: 타격 판정 순간 비율. 타격 순간에 무기가 정확히 정면을 지나도록 맞춘다.
 * outHand: 왼손 목표 위치, outDir: 무기 길이 방향(정규화). 반환값: 가슴 비틀기 각도 (수평 휘두르기)
 */
function meleePath(style: MeleeStyle, p: number, h: number, outHand: THREE.Vector3, outDir: THREE.Vector3): number {
  // 0 → 준비(w) → 타격(h) → 끝(e) → 복귀
  const w = Math.max(0.06, h - 0.2);
  const e = Math.min(0.94, h + 0.22);
  const seg = (a: number, b: number, c: number, d: number): number => {
    // 시작 a(=휴식) → b(준비 끝) → 0(타격) → c(휘두름 끝) → d(휴식)
    if (p < w) return a + (b - a) * smooth(p / w);
    if (p < h) return b + (0 - b) * ((p - w) / (h - w));
    if (p < e) return 0 + (c - 0) * ((p - h) / (e - h));
    return c + (d - c) * smooth((p - e) / (1 - e));
  };
  switch (style) {
    case 'stab': {
      // 찌르기: 뒤로 당겼다가 정면으로 쭉
      const k = seg(0.35, 0.9, -0.15, 0.4); // 1 = 뒤로, 0 = 최대로 뻗음
      outHand.set(0.12 * k + 0.02, 0.38 + 0.04 * k, 0.6 - 0.62 * k);
      outDir.set(0, -0.05, 1).normalize();
      return 0;
    }
    case 'chop': {
      // 내려치기: 머리 위에서 정면 아래로. phi 0 = 수평 정면, 음수 = 위, 양수 = 아래
      const phi = seg(-0.6, -2.0, 0.9, -0.4);
      outHand.set(0.06, 0.48 - Math.sin(phi) * 0.4, 0.12 + Math.cos(phi) * 0.4);
      outDir.set(0, -Math.sin(phi), Math.cos(phi)).normalize();
      return 0;
    }
    case 'swing':
    case 'slash':
    default: {
      // 수평 베기 · 휘두르기: 왼쪽 뒤에서 오른쪽 앞으로 (theta 0 = 정면)
      const wide = style === 'swing';
      const th = seg(0.7, wide ? 1.9 : 1.6, wide ? -1.7 : -1.4, -0.3);
      const r = wide ? 0.46 : 0.5;
      const y = wide ? 0.36 : 0.44;
      outHand.set(Math.sin(th) * r, y, Math.cos(th) * r + 0.05);
      outDir.set(Math.sin(th), wide ? 0.05 : -0.08, Math.cos(th)).normalize();
      return th;
    }
  }
}
