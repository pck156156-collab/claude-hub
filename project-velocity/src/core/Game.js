import * as THREE from 'three';
import { SIMULATION, VEHICLE_CONFIG, CAR_APPEARANCE, RENDER_CONFIG } from '../config.js';
import { Input } from './Input.js';
import { GameState, STATE } from './GameState.js';
import { QualityManager } from './QualityManager.js';
import { SafePointTracker } from './SafePointTracker.js';
import { Track } from '../world/Track.js';
import { Environment } from '../world/Environment.js';
import { buildFacilities } from '../world/Facilities.js';
import { Vehicle } from '../vehicle/Vehicle.js';
import { PlayerController } from '../vehicle/PlayerController.js';
import { ChaseCamera } from '../camera/ChaseCamera.js';
import { HUD } from '../ui/HUD.js';
import { Menus } from '../ui/Menus.js';
import { DebugPanel } from '../ui/DebugPanel.js';
import { DriftEffects } from '../effects/DriftEffects.js';
import { ExhaustEffects } from '../effects/ExhaustEffects.js';

/**
 * 게임 루트.
 * - 상태: title(시작 화면) → playing ⇄ paused, 그래픽 장치 손실 시 error. 물리는 playing 에서만 진행
 * - 렌더링은 requestAnimationFrame, 주행 계산은 고정 시간 간격(1/120초) 누적 방식
 *   → 60Hz / 144Hz / 프레임 드랍 상황에서도 같은 입력이면 같은 주행 결과
 * - 상태가 바뀔 때마다 키 입력·누적 시간을 비워, 재개 직후 물리가 튀거나 이전 입력이 남지 않게 한다
 * - 차량은 { vehicle, controller, safePoints } 목록으로 관리 → 이후 AI 차량을 addVehicle 로 추가
 */
export class Game {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER_CONFIG.exposure;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);

    this.track = new Track();
    this.scene.add(this.track.mesh);
    this.facilities = buildFacilities(this.track);
    this.scene.add(this.facilities.group);
    this.environment = new Environment(this.scene, this.renderer, this.track, { exclusions: this.facilities.exclusions });

    this.input = new Input(window);
    this.vehicles = [];
    this.startPose = this.track.getStartPose();

    this.effects = new DriftEffects(this.scene, this.track);
    this.exhaust = new ExhaustEffects(this.scene);

    this.player = this.addVehicle(
      new Vehicle({ config: VEHICLE_CONFIG, appearance: CAR_APPEARANCE }),
      new PlayerController(this.input),
      this.startPose,
    );

    this.chaseCamera = new ChaseCamera(this.camera);
    this.chaseCamera.snap(this.player.vehicle.position, this.player.vehicle.heading);
    this.hud = new HUD();
    this.debug = new DebugPanel();

    this.state = new GameState(STATE.TITLE);
    this.quality = new QualityManager(this);
    this.menus = new Menus({
      onStart: () => this.startRace(),
      onResume: () => this.resume(),
      onQuality: (level) => this.quality.set(level),
    });
    this.quality.onChange((level) => this.menus.setQuality(level));
    this.menus.setQuality(this.quality.level);
    this.quality.apply();

    this.time = 0; // 주행 시간 (playing 상태에서만 증가)
    this.titleAngle = 0;
    this.lastCollision = { time: -Infinity, speed: 0 };
    this.lastRecovery = null;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.needsRender = true;
    this.rafId = 0;
    this.frame = this.frame.bind(this);

    this.bindEvents();
    this.state.onChange((next, prev, reason) => this.onStateChange(next, prev, reason));
    this.onStateChange(STATE.TITLE, null, '');
  }

  // ───────────────────────────── 이벤트 ─────────────────────────────

  bindEvents() {
    const inp = this.input;
    inp.onPress('KeyR', () => this.state.is(STATE.PLAYING) && this.recoverPlayer());
    inp.onPress('Escape', () => {
      if (this.state.is(STATE.PLAYING)) this.pause('esc');
      else if (this.state.is(STATE.PAUSED)) this.resume();
    });
    inp.onPress('Enter', () => {
      if (this.state.is(STATE.TITLE)) this.startRace();
      else if (this.state.is(STATE.PAUSED)) this.resume();
    });
    inp.onPress('F3', () => this.debug.toggle());

    this._listeners = [
      [window, 'resize', () => this.onResize()],
      [window, 'blur', () => this.pause('blur')],
      [document, 'visibilitychange', () => document.hidden && this.pause('hidden')],
      [this.renderer.domElement, 'webglcontextlost', (e) => this.onContextLost(e)],
      [this.renderer.domElement, 'webglcontextrestored', () => this.onContextRestored()],
    ];
    for (const [target, type, fn] of this._listeners) target.addEventListener(type, fn);
  }

  // ───────────────────────────── 상태 전환 ─────────────────────────────

  startRace() {
    if (!this.state.is(STATE.TITLE)) return;
    this.resetVehicle(this.player, this.startPose);
    this.player.safePoints.reset(this.startPose.index);
    this.time = 0;
    this.state.set(STATE.PLAYING);
  }

  pause(reason) {
    if (this.state.is(STATE.PLAYING)) this.state.set(STATE.PAUSED, reason);
  }

  resume() {
    if (this.state.is(STATE.PAUSED)) this.state.set(STATE.PLAYING);
  }

  onStateChange(next, prev, reason) {
    document.body.dataset.state = next;
    // 상태가 바뀌면 이전 키 입력과 일시정지 동안의 시간을 모두 버린다
    this.input.reset();
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.menus.show(next, reason);
    this.requestRender();
  }

  // ───────────────────────────── 차량 ─────────────────────────────

  addVehicle(vehicle, controller, pose) {
    vehicle.reset(pose);
    this.scene.add(vehicle.model.root);
    const entry = { vehicle, controller, safePoints: new SafePointTracker(this.track) };
    entry.safePoints.reset(pose.index ?? -1);
    this.vehicles.push(entry);
    this.vehicleList = this.vehicles.map((e) => e.vehicle);
    return entry;
  }

  resetVehicle(entry, pose) {
    const v = entry.vehicle;
    v.reset(pose);
    this.effects.resetVehicle(v);
    if (entry === this.player) {
      this.chaseCamera.snap(v.position, v.heading);
      this.hud.reset();
      this.input.reset();
      this.accumulator = 0;
    }
  }

  /** R 키: 최근 안전 지점(없으면 출발 위치)에 트랙 방향으로 복구 */
  recoverPlayer() {
    const entry = this.player;
    const pose = entry.safePoints.getRecoveryPose(this.startPose);
    this.resetVehicle(entry, pose);
    this.lastRecovery = { index: pose.index, fromSafePoint: pose !== this.startPose, time: this.time };
  }

  // ───────────────────────────── 루프 ─────────────────────────────

  start() {
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  frame(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);
    const realDt = Math.max((now - this.lastTime) / 1000, 0);
    this.lastTime = now;
    const dt = Math.min(realDt, SIMULATION.maxFrameDelta);
    this.debug.countFrame(realDt);

    switch (this.state.current) {
      case STATE.PLAYING:
        this.update(dt);
        this.render();
        break;
      case STATE.TITLE:
        this.updateTitle(dt);
        this.render();
        break;
      default:
        // 일시정지·오류: 물리 정지, 필요할 때만 다시 그림(창 크기 변경·품질 변경)
        if (this.needsRender) this.render();
    }
    this.debug.update(realDt, () => this.debugRows());
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
  }

  requestRender() {
    this.needsRender = true;
  }

  /** 주행 업데이트 (playing). 테스트에서 직접 호출할 수 있다 */
  update(dt) {
    this.time += dt;
    const step = SIMULATION.fixedTimeStep;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= step && steps < SIMULATION.maxSubSteps) {
      for (const { vehicle, controller } of this.vehicles) {
        vehicle.step(step, controller.update(step, vehicle), this.track);
      }
      const pv = this.player.vehicle;
      if (pv.touchingWall) {
        const recent = this.time - this.lastCollision.time < 0.3;
        this.lastCollision = { time: this.time, speed: Math.max(pv.lastImpactSpeed, recent ? this.lastCollision.speed : 0) };
      }
      this.accumulator -= step;
      steps++;
    }
    // 과도한 지연 시 밀린 계산을 버려 '죽음의 나선'을 방지
    if (steps === SIMULATION.maxSubSteps) this.accumulator = Math.min(this.accumulator, step);
    const alpha = this.accumulator / step;
    for (const entry of this.vehicles) {
      entry.vehicle.updateVisual(alpha, dt);
      entry.safePoints.update(dt, entry.vehicle);
    }

    const pv = this.player.vehicle;
    const root = pv.model.root;
    this.chaseCamera.update(
      dt, root.position, root.rotation.y, pv.speed / pv.config.engine.maxSpeed, pv.velocity, pv.forwardSpeed,
    );
    this.updateEffects(dt, root.position);
    this.hud.update(pv, dt);
  }

  /** 시작 화면: 물리 없이 차량 주위를 천천히 도는 카메라 */
  updateTitle(dt) {
    const v = this.player.vehicle;
    this.titleAngle += dt * 0.18;
    const a = v.heading + 2.4 + this.titleAngle;
    this.camera.position.set(v.position.x + Math.sin(a) * 7.8, 2.6, v.position.z + Math.cos(a) * 7.8);
    this.camera.lookAt(v.position.x, 0.7, v.position.z);
    if (this.camera.fov !== 50) {
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
    }
    this.updateEffects(dt, v.position);
  }

  updateEffects(dt, focus) {
    const viewH = this.renderer.domElement.height;
    this.effects.setViewport(viewH, this.camera.fov);
    this.exhaust.setViewport(viewH, this.camera.fov);
    this.effects.update(dt, this.vehicleList);
    this.exhaust.update(this.state.is(STATE.PLAYING) ? dt : 0, this.vehicleList);
    this.environment.update(focus);
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.quality.pixelRatio());
    this.renderer.setSize(w, h);
    this.requestRender();
  }

  // ───────────────────────────── 그래픽 장치 손실 ─────────────────────────────

  onContextLost(e) {
    e.preventDefault(); // 복구 가능하도록
    this.stateBeforeError = this.state.current;
    this.state.set(STATE.ERROR, 'contextlost');
    this.menus.showError(
      '그래픽 장치 연결이 끊어졌습니다',
      '드라이버 재시작이나 메모리 부족으로 WebGL 이 중단되었습니다. 잠시 후 자동으로 복구를 시도합니다. 계속 이 화면이면 페이지를 새로 고쳐 주세요.',
    );
  }

  onContextRestored() {
    this.quality.apply();
    this.state.set(this.stateBeforeError === STATE.TITLE ? STATE.TITLE : STATE.PAUSED, 'restored');
  }

  // ───────────────────────────── 디버그 ─────────────────────────────

  debugRows() {
    const v = this.player.vehicle;
    const deg = (r) => `${(r * 57.2958).toFixed(1)}°`;
    const pct = (x) => `${Math.round(x * 100)}%`;
    const t = this.track;
    const lat = v.trackInfo.lateral;
    const surface = Math.abs(lat) <= t.halfWidth ? '아스팔트' : Math.abs(lat) <= t.surfaceHalfWidth(v.trackInfo.index) ? '연석' : '잔디';
    const grip = v.frontGripUse > 1 && v.rearGripUse > 1 ? '네 바퀴 미끄러짐'
      : v.rearGripUse > 1 ? '뒷바퀴 미끄러짐(오버스티어)'
        : v.frontGripUse > 1 ? '앞바퀴 미끄러짐(언더스티어)' : '접지';
    const sinceHit = this.time - this.lastCollision.time;
    const c = this.player.controller.controls;
    const info = this.renderer.info.render;
    const sp = this.player.safePoints;
    return [
      ['상태', `${this.state.current}  품질 ${this.quality.preset.label}`],
      ['FPS', `${this.debug.fps.toFixed(0)}  (${this.debug.frameMs.toFixed(1)} ms)  draw ${info.calls} / tri ${(info.triangles / 1000).toFixed(0)}k`],
      ['속도', `${v.speedKmh.toFixed(1)} km/h  기어 ${v.gear > 0 ? 'D' : 'R'}`],
      ['종/횡 속도', `${v.forwardSpeed.toFixed(2)} / ${v.lateralSpeed.toFixed(2)} m/s`],
      ['조향', `입력 ${v.steerInput.toFixed(2)}  앞바퀴 ${deg(v.steerAngle)}  요 ${v.yawRate.toFixed(2)} rad/s`],
      ['페달', `가속 ${c.throttle} 브레이크 ${c.brake} 핸드브레이크 ${c.handbrake ? 'ON' : 'off'}`],
      ['드리프트', `${v.driftIntensity > 0.25 ? 'DRIFT' : '-'}  강도 ${v.driftIntensity.toFixed(2)}  슬립각 ${deg(v.slipAngle)}`],
      ['타이어', `${grip}`],
      ['  앞/뒤', `슬립 ${deg(v.frontSlipAngle)} / ${deg(v.rearTireSlipAngle)}  사용률 ${pct(v.frontGripUse)} / ${pct(v.rearGripUse)}  뒤 접지 ×${v.rearGrip.toFixed(2)}`],
      ['노면', `${v.onRoad ? 'ON ROAD' : 'OFF ROAD'}  ${surface}  횡 ${lat.toFixed(1)} m`],
      ['충돌', v.touchingWall ? `접촉 중 ${(this.lastCollision.speed * 3.6).toFixed(0)} km/h${v.wallAssist ? '  (탈출 보조)' : ''}`
        : Number.isFinite(sinceHit) ? `${sinceHit.toFixed(1)}초 전  ${(this.lastCollision.speed * 3.6).toFixed(0)} km/h` : '없음'],
      ['복구 지점', sp.index >= 0 ? `#${sp.index}` : '출발 위치'],
    ];
  }

  // ───────────────────────────── 정리 ─────────────────────────────

  /** 리소스 해제 (개발 서버 핫 리로드·페이지 이탈 시) */
  dispose() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    for (const [target, type, fn] of this._listeners) target.removeEventListener(type, fn);
    this.input.dispose();
    const textures = new Set();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        for (const value of Object.values(m)) if (value && value.isTexture) textures.add(value);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture) textures.add(u.value);
        m.dispose();
      }
    });
    textures.forEach((t) => t.dispose());
    this.scene.environment?.dispose();
    this.scene.traverse((o) => o.shadow?.map?.dispose()); // 그림자 맵 렌더 타깃
    this.environment.envTarget?.dispose(); // 하늘 반사(PMREM) 렌더 타깃
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
