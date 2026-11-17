import * as THREE from 'three';
import { SIMULATION, VEHICLE_CONFIG, CAR_APPEARANCE, RENDER_CONFIG } from '../config.js';
import { Input } from './Input.js';
import { Track } from '../world/Track.js';
import { Environment } from '../world/Environment.js';
import { Vehicle } from '../vehicle/Vehicle.js';
import { PlayerController } from '../vehicle/PlayerController.js';
import { ChaseCamera } from '../camera/ChaseCamera.js';
import { HUD } from '../ui/HUD.js';
import { DriftEffects } from '../effects/DriftEffects.js';
import { ExhaustEffects } from '../effects/ExhaustEffects.js';
import { buildFacilities } from '../world/Facilities.js';

/**
 * 게임 루트.
 * - 렌더링은 requestAnimationFrame, 주행 계산은 고정 시간 간격(1/120초) 누적 방식
 *   → 60Hz / 144Hz / 프레임 드랍 상황에서도 같은 입력이면 같은 주행 결과
 * - 차량은 { vehicle, controller } 목록으로 관리 → 이후 AI 차량을 addVehicle 로 추가
 */
export class Game {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CONFIG.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER_CONFIG.exposure;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 5000);

    this.track = new Track();
    this.scene.add(this.track.mesh);
    this.facilities = buildFacilities(this.track);
    this.scene.add(this.facilities.group);
    this.environment = new Environment(this.scene, this.renderer, this.track, { exclusions: this.facilities.exclusions });

    this.input = new Input(window);
    this.vehicles = [];
    this.startPose = this.track.getStartPose();

    this.player = this.addVehicle(
      new Vehicle({ config: VEHICLE_CONFIG, appearance: CAR_APPEARANCE }),
      new PlayerController(this.input),
      this.startPose,
    );

    this.effects = new DriftEffects(this.scene, this.track);
    this.exhaust = new ExhaustEffects(this.scene);
    this.effects.setViewport(this.renderer.domElement.height, this.camera.fov);
    this.vehicleList = this.vehicles.map((e) => e.vehicle);

    this.chaseCamera = new ChaseCamera(this.camera);
    this.chaseCamera.snap(this.player.vehicle.position, this.player.vehicle.heading);
    this.hud = new HUD();

    this.input.onPress('KeyR', () => this.resetPlayer());
    window.addEventListener('resize', () => this.onResize());

    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.frame = this.frame.bind(this);
  }

  addVehicle(vehicle, controller, pose) {
    vehicle.reset(pose);
    this.scene.add(vehicle.model.root);
    const entry = { vehicle, controller };
    this.vehicles.push(entry);
    this.vehicleList = this.vehicles.map((e) => e.vehicle);
    return entry;
  }

  resetPlayer() {
    const v = this.player.vehicle;
    v.reset(this.startPose);
    this.effects.resetVehicle(v);
    this.chaseCamera.snap(v.position, v.heading);
  }

  start() {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(Math.max((now - this.lastTime) / 1000, 0), SIMULATION.maxFrameDelta);
    this.lastTime = now;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  }

  update(dt) {
    const step = SIMULATION.fixedTimeStep;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= step && steps < SIMULATION.maxSubSteps) {
      for (const { vehicle, controller } of this.vehicles) {
        vehicle.step(step, controller.update(step, vehicle), this.track);
      }
      this.accumulator -= step;
      steps++;
    }
    // 과도한 지연 시 밀린 계산을 버려 '죽음의 나선'을 방지
    if (steps === SIMULATION.maxSubSteps) this.accumulator = Math.min(this.accumulator, step);
    const alpha = this.accumulator / step;
    for (const { vehicle } of this.vehicles) vehicle.updateVisual(alpha, dt);

    const pv = this.player.vehicle;
    const root = pv.model.root;
    this.chaseCamera.update(
      dt, root.position, root.rotation.y, pv.speed / pv.config.engine.maxSpeed, pv.velocity, pv.forwardSpeed,
    );
    const viewH = this.renderer.domElement.height;
    this.effects.setViewport(viewH, this.camera.fov);
    this.exhaust.setViewport(viewH, this.camera.fov);
    this.effects.update(dt, this.vehicleList);
    this.exhaust.update(dt, this.vehicleList);
    this.environment.update(root.position);
    this.hud.update(pv, dt);
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
