import * as THREE from 'three';
import { CAMERA_CONFIG } from '../config/GameConfig';
import { damp } from '../core/random';
import { Occluder } from '../world/World';

/**
 * 고정 방향 쿼터뷰 카메라 (원근).
 * - 월드 기준 방위각 · 내려다보는 각도가 고정 → 조준 방향이 바뀌어도 카메라는 회전하지 않는다
 * - 캐릭터(보간된 렌더 위치)를 부드럽게 추적하고, 조준 방향으로 화면을 살짝 밀어 앞을 더 보여 준다
 * - 캐릭터를 가리는 건물은 반투명하게 만든다
 */
export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** 카메라가 바라보는 지면 위 지점 */
  readonly focus = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly lookAhead = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly ray = new THREE.Ray();
  private readonly hit = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly probes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  /** 화면 흔들림 세기 (폭발 · 보스 강타), 빠르게 감쇠 */
  private shakeAmount = 0;
  private shakeTime = 0;

  /** 화면 흔들림 추가 (최대 0.5) */
  shake(amount: number): void {
    this.shakeAmount = Math.min(0.5, Math.max(this.shakeAmount, amount));
  }

  constructor(aspect: number) {
    const c = CAMERA_CONFIG;
    this.camera = new THREE.PerspectiveCamera(c.fov, aspect, 0.5, 200);
    const pitch = THREE.MathUtils.degToRad(c.pitchDeg);
    const yaw = THREE.MathUtils.degToRad(c.yawDeg);
    // 초점에서 카메라까지의 방향: 방위각 yaw, 고도 pitch
    this.offset.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(c.distance);
  }

  /** 순간 이동 (시작 · 리스폰) */
  snap(target: THREE.Vector3): void {
    this.focus.set(target.x, 0, target.z);
    this.lookAhead.set(0, 0, 0);
    this.shakeAmount = 0;
    this.apply();
  }

  /**
   * @param target 캐릭터 렌더 위치
   * @param aimDirX/aimDirZ 조준 방향 (정규화)
   * @param aimStrength 0~1 (조준점이 가까우면 덜 민다)
   */
  update(dt: number, target: THREE.Vector3, aimDirX: number, aimDirZ: number, aimStrength: number): void {
    const c = CAMERA_CONFIG;
    this.desiredLook.set(aimDirX, 0, aimDirZ).multiplyScalar(c.aimLookAhead * aimStrength);
    this.lookAhead.lerp(this.desiredLook, damp(c.lookAheadSharpness, dt));
    const k = damp(c.followSharpness, dt);
    this.focus.x += (target.x + this.lookAhead.x - this.focus.x) * k;
    this.focus.z += (target.z + this.lookAhead.z - this.focus.z) * k;
    this.focus.y = 0;
    this.shakeTime += dt;
    this.shakeAmount *= Math.exp(-7 * dt);
    if (this.shakeAmount < 0.005) this.shakeAmount = 0;
    this.apply();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 카메라와 캐릭터 사이를 가리는 건물을 반투명하게.
   * 머리 · 가슴 · 발 세 지점으로 레이를 쏴서 하나라도 가리면 대상.
   */
  updateOcclusion(dt: number, character: THREE.Vector3, occluders: Occluder[]): void {
    const c = CAMERA_CONFIG;
    const camPos = this.camera.position;
    this.probes[0].set(character.x, 1.7, character.z);
    this.probes[1].set(character.x, 1.0, character.z);
    this.probes[2].set(character.x, 0.2, character.z);
    for (const o of occluders) {
      let blocked = false;
      for (const p of this.probes) {
        const dist = this.tmp.subVectors(p, camPos).length();
        this.ray.set(camPos, this.tmp.multiplyScalar(1 / dist));
        if (this.ray.intersectBox(o.box, this.hit) && this.hit.distanceTo(camPos) < dist - 0.3) { blocked = true; break; }
      }
      const target = blocked ? c.occluderOpacity : 1;
      const prev = o.opacity;
      o.opacity += (target - o.opacity) * damp(c.occluderFadeSpeed, dt);
      if (Math.abs(o.opacity - target) < 0.005) o.opacity = target;
      if (o.opacity === prev) continue;
      const transparent = o.opacity < 0.999;
      for (const m of o.materials) {
        m.opacity = o.opacity;
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.needsUpdate = true;
        }
        // 반투명일 때 깊이를 쓰지 않아야 뒤의 캐릭터가 보인다
        m.depthWrite = !transparent;
      }
    }
  }

  private readonly lookPoint = new THREE.Vector3();

  private apply(): void {
    // 캐릭터 몸통 높이를 바라봐야 화면 중앙에 캐릭터가 온다
    this.lookPoint.set(this.focus.x, 1.0, this.focus.z);
    this.camera.position.copy(this.lookPoint).add(this.offset);
    if (this.shakeAmount > 0) {
      const t = this.shakeTime * 40;
      const k = this.shakeAmount;
      this.lookPoint.x += Math.sin(t * 1.3) * k;
      this.lookPoint.y += Math.sin(t * 1.7 + 1) * k * 0.6;
      this.lookPoint.z += Math.cos(t * 1.1) * k;
    }
    this.camera.lookAt(this.lookPoint);
    this.camera.updateMatrixWorld();
  }
}
