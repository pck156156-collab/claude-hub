import * as THREE from 'three';
import { WEAPON_CONFIG } from '../config/GameConfig';
import { InputManager } from '../core/InputManager';
import { PlayerCommand } from './Player';

/**
 * 키보드 · 마우스 입력 → 플레이어 명령 변환.
 * - WASD 는 카메라 화면 기준 (W = 화면 위쪽) 으로 월드 방향을 계산한다.
 * - 마우스는 카메라에서 레이를 쏘아 총구 높이 평면과의 교차점을 조준점으로 쓴다.
 *   (지면이 아니라 총구 높이 평면을 쓰는 이유: 수평으로 날아가는 총알이
 *    화면상 커서 바로 위를 정확히 지나가게 하기 위해서)
 */
export class PlayerController {
  readonly command: PlayerCommand = { moveX: 0, moveZ: 0, aimPoint: new THREE.Vector3(), hasAim: false };
  /** 커서가 가리키는 지면 위치 (조준 표시용) */
  readonly groundPoint = new THREE.Vector3();
  fire = false;

  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WEAPON_CONFIG.rifle.muzzleOffset.y);
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(private readonly input: InputManager) {}

  /** 프레임마다 한 번: 현재 카메라 기준으로 이동 방향과 조준점 갱신 */
  update(camera: THREE.Camera): PlayerCommand {
    const i = this.input;
    const cmd = this.command;

    // 화면 위쪽 = 카메라 정면을 지면에 투영한 방향
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x); // 화면 오른쪽

    const up = (i.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (i.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    const side = (i.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (i.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    let mx = this.forward.x * up + this.right.x * side;
    let mz = this.forward.z * up + this.right.z * side;
    const len = Math.hypot(mx, mz);
    if (len > 1e-6) { mx /= len; mz /= len; } // 대각선도 같은 속도
    cmd.moveX = mx;
    cmd.moveZ = mz;

    this.ndc.set(i.mouseNdc.x, i.mouseNdc.y);
    this.raycaster.setFromCamera(this.ndc, camera);
    cmd.hasAim = this.raycaster.ray.intersectPlane(this.aimPlane, cmd.aimPoint) !== null;
    this.raycaster.ray.intersectPlane(this.groundPlane, this.groundPoint);

    this.fire = i.leftButton;
    return cmd;
  }
}
