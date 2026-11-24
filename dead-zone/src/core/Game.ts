import * as THREE from 'three';
import { CAMERA_CONFIG, RENDER_CONFIG, SIMULATION, TARGET_CONFIG, WEAPON_CONFIG } from '../config/GameConfig';
import { GameCamera } from '../camera/GameCamera';
import { DamageableRegistry, HitInfo } from '../combat/Damageable';
import { Effects } from '../effects/Effects';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { PlayerModel } from '../player/PlayerModel';
import { PracticeTarget } from '../targets/PracticeTarget';
import { DebugPanel } from '../ui/DebugPanel';
import { GameUI } from '../ui/GameUI';
import { ProjectileSystem } from '../weapons/Projectile';
import { Weapon } from '../weapons/Weapon';
import { World } from '../world/World';
import { AudioManager } from './AudioManager';
import { InputManager } from './InputManager';

type State = 'start' | 'playing' | 'paused' | 'error';

/**
 * 게임 전체를 조립하고 루프를 돌린다.
 * - 게임 로직은 고정 시간 간격(SIMULATION.fixedTimeStep)으로 진행 → 프레임 속도와 무관
 * - 렌더는 마지막 두 로직 스텝 사이를 보간해 부드럽게 표시
 * - 각 시스템(이동 · 무기 · 투사체 · 카메라 · UI)은 서로를 직접 알지 않고 여기서 연결된다
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly world: World;
  readonly gameCamera: GameCamera;
  readonly input: InputManager;
  readonly player: Player;
  readonly model: PlayerModel;
  readonly controller: PlayerController;
  readonly weapon: Weapon;
  readonly registry = new DamageableRegistry();
  readonly targets: PracticeTarget[] = [];
  readonly projectiles: ProjectileSystem;
  readonly effects: Effects;
  readonly ui = new GameUI();
  readonly audio = new AudioManager();
  readonly debug = new DebugPanel();

  state: State = 'start';
  /** 누적 게임 시간 (로직 기준) */
  time = 0;
  private accumulator = 0;
  private lastFrame = -1;
  private rafId = 0;
  private running = false;
  private lastShotTime = -10;
  private spread = 0;
  private readonly renderPos = new THREE.Vector3();
  private readonly eject = new THREE.Vector3();
  private readonly hitInfo: HitInfo = { damage: 0, point: new THREE.Vector3(), direction: new THREE.Vector3(), sourceId: '' };
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CONFIG.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER_CONFIG.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.world = new World(this.scene, TARGET_CONFIG.positions.map(([x, z]) => [x, z, 1.5] as [number, number, number]));
    this.gameCamera = new GameCamera(window.innerWidth / window.innerHeight);
    this.input = new InputManager(canvas);

    this.player = new Player(this.world.spawnPoint);
    this.model = new PlayerModel();
    this.scene.add(this.model.root);
    this.controller = new PlayerController(this.input);
    this.weapon = new Weapon(WEAPON_CONFIG.rifle, this.player);
    this.projectiles = new ProjectileSystem(this.scene, this.world.collision, this.registry);
    this.effects = new Effects(this.scene);

    this.createTargets();
    this.wireEvents();
    this.gameCamera.snap(this.player.position);
    this.world.updateShadow(this.player.position);
    this.ui.showScreen('start');
    this.renderFrame(0, 1);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      const dt = this.lastFrame < 0 ? 0 : Math.min((now - this.lastFrame) / 1000, SIMULATION.maxFrameDelta);
      this.lastFrame = now;
      this.advance(dt);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.lastFrame = -1;
  }

  /** 한 프레임 진행 (테스트에서도 직접 호출 가능). draw=false 면 화면 그리기만 생략 */
  advance(frameDt: number, draw = true): void {
    const dt = Math.min(frameDt, SIMULATION.maxFrameDelta);
    let alpha = 1;
    if (this.state === 'playing') {
      const step = SIMULATION.fixedTimeStep;
      const cmd = this.controller.update(this.gameCamera.camera);
      this.accumulator += dt;
      while (this.accumulator >= step) {
        this.player.step(step, cmd, this.world.collision);
        this.weapon.update(step, this.controller.fire);
        this.projectiles.step(step);
        for (const t of this.targets) t.step(step);
        this.time += step;
        this.accumulator -= step;
      }
      alpha = this.accumulator / step;
    }
    this.renderFrame(this.state === 'playing' ? dt : 0, alpha, draw);
    this.debug.tick(frameDt, () => this.debugRows());
  }

  beginPlay(): void {
    this.audio.unlock();
    this.setState('playing');
  }

  pause(reason: string): void {
    if (this.state !== 'playing') return;
    this.setState('paused', reason);
  }

  dispose(): void {
    this.stop();
    for (const fn of this.cleanups) fn();
    this.input.dispose();
    this.projectiles.dispose();
    this.effects.dispose();
    for (const t of this.targets) t.dispose();
    this.model.dispose();
    this.world.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }

  private setState(next: State, reason = ''): void {
    this.state = next;
    // 상태가 바뀔 때마다 눌려 있던 입력을 버리고, 쌓인 시간을 비운다 (재개 시 순간이동 방지)
    this.input.reset();
    this.weapon.releaseTrigger();
    this.accumulator = 0;
    this.lastFrame = -1;
    if (next === 'playing') this.ui.showScreen(null);
    else if (next === 'paused') { this.ui.showScreen('pause', reason); this.audio.suspend(); }
    else if (next === 'start') this.ui.showScreen('start');
  }

  private createTargets(): void {
    for (const [x, z] of TARGET_CONFIG.positions) {
      // 표적 정면이 맵 중앙을 향하도록
      const t = new PracticeTarget(x, z, Math.atan2(-x, -z));
      this.scene.add(t.root);
      this.registry.add(t);
      this.world.collision.addCircle(x, z, 0.5, 0.3); // 콘크리트 받침: 이동만 막고 총알은 지나감
      t.onEvent = (target, e, hit) => {
        if (e === 'destroyed' && hit) {
          this.effects.explodeTarget(target.center(), hit.direction);
          this.audio.breakTarget();
          this.ui.flashHit(true);
        }
      };
      this.targets.push(t);
    }
  }

  private wireEvents(): void {
    this.weapon.addListener({
      onFire: (shot) => {
        this.projectiles.spawn(shot);
        this.lastShotTime = this.time;
        this.spread = Math.min(1, this.spread + 0.35);
        this.eject.copy(shot.origin).addScaledVector(shot.direction, -0.72);
        this.eject.y += 0.05;
        this.effects.muzzleFlash(shot.origin, Math.atan2(shot.direction.x, shot.direction.z), this.eject);
        this.model.kick();
        this.audio.gunshot();
      },
      onReloadStart: () => this.audio.reload(),
      onDryFire: () => this.audio.click(0.7),
    });

    this.projectiles.onImpact = (e) => {
      if (e.target) {
        const h = this.hitInfo;
        h.damage = e.damage;
        h.point.copy(e.point);
        h.direction.copy(e.direction);
        h.sourceId = e.sourceId;
        const alive = e.target.canBeHit();
        e.target.takeDamage(h);
        this.effects.impactTarget(e.point, e.direction);
        if (alive && e.target.canBeHit()) {
          this.ui.flashHit(false);
          this.audio.hit();
        }
      } else {
        this.effects.impactSurface(e.point, e.normal);
      }
    };

    this.model.onMagazineDrop = (p, yaw) => {
      this.effects.debris.spawn({
        x: p.x, y: p.y, z: p.z, vx: Math.sin(yaw) * 0.6, vy: -0.5, vz: Math.cos(yaw) * 0.6,
        life: 3, size: 1, endScale: 1, gravity: 16, bounce: 0.25, spin: 6, shape: [0.045, 0.17, 0.08],
        color: new THREE.Color(0.12, 0.13, 0.14),
      });
    };

    this.input.onPress('KeyR', () => { if (this.state === 'playing') this.weapon.requestReload(); });
    this.input.onPress('Escape', () => {
      if (this.state === 'playing') this.pause('ESC 키로 일시정지했습니다.');
    });
    this.input.onPress('F3', () => this.debug.toggle());
    this.input.onPress('KeyM', () => (this.audio.muted = !this.audio.muted));

    this.ui.onStart = () => this.beginPlay();
    this.ui.onResume = () => this.beginPlay();

    const onBlur = () => this.pause('게임 창이 포커스를 잃어 일시정지했습니다.');
    const onVisibility = () => { if (document.hidden) this.pause('탭이 숨겨져 일시정지했습니다.'); };
    const onResize = () => {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CONFIG.maxPixelRatio));
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.gameCamera.resize(window.innerWidth / window.innerHeight);
      if (this.state !== 'playing') this.renderFrame(0, 1);
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      this.stop();
      this.ui.showError('그래픽 장치(WebGL)가 초기화되었습니다. 페이지를 새로고침해 주세요.');
      this.state = 'error';
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    this.canvas.addEventListener('webglcontextlost', onLost);
    this.cleanups.push(() => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      this.canvas.removeEventListener('webglcontextlost', onLost);
    });
  }

  /** 시각 계층 갱신 + 렌더 (로직 상태는 읽기만 한다) */
  private renderFrame(dt: number, alpha: number, draw = true): void {
    const p = this.player;
    const pos = p.interpolatedPosition(alpha, this.renderPos);
    const yaw = p.interpolatedYaw(alpha);
    const aiming = this.controller.fire || this.time - this.lastShotTime < 1.2;
    this.model.update(dt, {
      position: pos, aimYaw: yaw, velocity: p.velocity, aiming,
      reloading: this.weapon.reloading, reloadProgress: this.weapon.reloadProgress,
    });

    if (dt > 0) {
      const strength = Math.min(1, Math.max(0, (p.aimDistance - 2) / 8));
      this.gameCamera.update(dt, pos, Math.sin(yaw), Math.cos(yaw), strength);
    }
    this.gameCamera.updateOcclusion(dt > 0 ? dt : 1, pos, this.world.occluders);
    this.world.updateShadow(this.gameCamera.focus);

    this.projectiles.render(alpha);
    for (const t of this.targets) t.update(dt);
    this.effects.update(dt, this.gameCamera.camera);

    this.spread *= Math.exp(-6 * dt);
    const w = this.weapon;
    this.ui.update(dt, {
      health: p.health, maxHealth: p.maxHealth, ammo: w.ammo, magazineSize: w.stats.magazineSize, weaponName: w.stats.name,
      reloading: w.reloading, reloadProgress: w.reloadProgress, spread: this.spread,
    }, this.input.mouseScreen.x, this.input.mouseScreen.y);

    if (draw) this.renderer.render(this.scene, this.gameCamera.camera);
  }

  private debugRows(): [string, string][] {
    const p = this.player;
    const info = this.renderer.info;
    return [
      ['FPS', `${this.debug.fps.toFixed(0)} (${this.debug.frameMs.toFixed(1)}ms, 최악 ${this.debug.worstMs.toFixed(0)}ms)`],
      ['상태', this.state],
      ['위치', `${p.position.x.toFixed(2)}, ${p.position.z.toFixed(2)}`],
      ['속도', `${p.speed.toFixed(2)} / 벽 ${p.touchingWall ? '접촉' : '-'}`],
      ['조준 각도', `${THREE.MathUtils.radToDeg(p.aimYaw).toFixed(1)}° (${p.aimDistance.toFixed(1)}m)`],
      ['탄약', `${this.weapon.ammo}/${this.weapon.stats.magazineSize}${this.weapon.reloading ? ' 재장전' : ''}`],
      ['발사 누적', String(this.weapon.shotsFired)],
      ['투사체', `${this.projectiles.activeCount} / 풀 ${this.projectiles.capacity}`],
      ['파티클', String(this.effects.particleCount)],
      ['표적 파괴', String(this.targets.reduce((n, t) => n + t.destroyedCount, 0))],
      ['드로우콜', String(info.render.calls)],
      ['삼각형', info.render.triangles.toLocaleString()],
      ['카메라', `${CAMERA_CONFIG.pitchDeg}° / ${CAMERA_CONFIG.distance}m`],
    ];
  }
}
