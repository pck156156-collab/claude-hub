import * as THREE from 'three';
import { CAMERA_CONFIG, DEFAULT_QUALITY, QUALITY_PRESETS, QualityLevel, RENDER_CONFIG, SIMULATION, WEAPON_CONFIG, ZOMBIE_TYPES } from '../config/GameConfig';
import { GameCamera } from '../camera/GameCamera';
import { DamageableRegistry, HitInfo } from '../combat/Damageable';
import { Effects } from '../effects/Effects';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { PlayerModel } from '../player/PlayerModel';
import { Zombie } from '../enemies/Zombie';
import { ZombieManager } from '../enemies/ZombieManager';
import { ZombieRenderer } from '../enemies/ZombieRenderer';
import { DebugPanel } from '../ui/DebugPanel';
import { GameUI } from '../ui/GameUI';
import { ProjectileSystem } from '../weapons/Projectile';
import { Weapon } from '../weapons/Weapon';
import { World } from '../world/World';
import { WaveSystem, formatTime } from '../waves/WaveSystem';
import { ExperienceOrbs } from '../items/ExperienceOrb';
import { ExperienceSystem } from '../progression/ExperienceSystem';
import { PlayerStats } from '../upgrades/StatCalculator';
import { RARITY_INFO, UPGRADES, UpgradeContext } from '../upgrades/UpgradeData';
import { UpgradeManager } from '../upgrades/UpgradeManager';
import { LevelUpScreen } from '../ui/LevelUpScreen';
import { AudioManager } from './AudioManager';
import { RecordResult, RecordSet, Records } from './Records';
import { InputManager } from './InputManager';

/** levelup: 강화 선택 중 (게임 로직 정지, 렌더 · UI 입력만 유지). gameover 가 항상 우선 */
type State = 'start' | 'playing' | 'paused' | 'levelup' | 'gameover' | 'error';

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
  readonly zombies: ZombieManager;
  readonly zombieRenderer: ZombieRenderer;
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
  /** 생존 시간 · 웨이브 진행 */
  readonly waves = new WaveSystem();
  /** 경험치 · 레벨 */
  readonly experience = new ExperienceSystem();
  /** 강화 레벨 · 능력치 */
  readonly upgrades = new UpgradeManager();
  readonly orbs: ExperienceOrbs;
  readonly levelUp = new LevelUpScreen();
  /** 크리티컬 판정용 난수 (테스트에서 고정 가능) */
  critRandom: () => number = Math.random;
  /** 누적 치명타 수 (디버그 · 테스트) */
  critHits = 0;
  /** 개인 최고 기록 (localStorage) */
  readonly records = new Records();
  /** 첫 판이 시작되었는지 (시작 화면에서 처음 누를 때만 판을 새로 시작) */
  private runStarted = false;
  private lastRun: { run: RecordSet; result: RecordResult } | null = null;
  /** 이번 판 생존 시간 (WaveSystem 기준, 실제 진행된 게임 시간만) */
  get playTime(): number {
    return this.waves.time;
  }
  /** 사망 후 게임 오버 화면을 띄우기까지 남은 시간 (쓰러지는 동작을 보여 줌) */
  private gameOverDelay = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    // PCFSoft 보다 가벼운 PCF (그림자 가장자리 4배 샘플 → 1배)
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER_CONFIG.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.world = new World(this.scene);
    this.gameCamera = new GameCamera(window.innerWidth / window.innerHeight);
    this.input = new InputManager(canvas);

    this.player = new Player(this.world.spawnPoint);
    this.model = new PlayerModel();
    this.scene.add(this.model.root);
    this.controller = new PlayerController(this.input);
    this.weapon = new Weapon(WEAPON_CONFIG.rifle, this.player);
    this.projectiles = new ProjectileSystem(this.scene, this.world.collision, this.registry);
    this.effects = new Effects(this.scene);

    this.zombies = new ZombieManager(this.world.collision, this.registry, this.player);
    this.zombieRenderer = new ZombieRenderer(this.scene, ZOMBIE_TYPES.walker.appearance);
    this.orbs = new ExperienceOrbs(this.scene);
    this.wireEvents();
    this.upgrades.reset(); // 기본 능력치를 각 시스템에 적용
    this.gpuName = detectGpu(this.renderer);
    this.setQuality(loadQuality());
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
    const t0 = performance.now();
    this.step(frameDt, draw);
    // CPU 가 한 프레임에 쓴 시간 (그리기 명령 제출 포함, GPU 실행 시간은 포함 안 됨)
    this.cpuMs += (performance.now() - t0 - this.cpuMs) * 0.1;
    this.debug.tick(frameDt, () => this.debugRows());
    if (draw && this.state === 'playing') this.adaptResolution(frameDt);
  }

  quality: QualityLevel = DEFAULT_QUALITY;
  private gpuName = '';
  private cpuMs = 0;

  /** 그래픽 품질 변경 (즉시 적용, 오브젝트 재생성 없음) */
  setQuality(level: QualityLevel): void {
    const q = QUALITY_PRESETS[level];
    const shadowsBefore = this.renderer.shadowMap.enabled;
    this.quality = level;
    this.world.setQuality(q.shadowMapSize, q.streetLights);
    this.renderer.shadowMap.enabled = q.shadowMapSize > 0;
    if (shadowsBefore !== this.renderer.shadowMap.enabled) {
      // 그림자 켜기/끄기는 셰이더가 바뀌므로 재질을 다시 컴파일
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    this.maxRatio = Math.min(window.devicePixelRatio, q.maxPixelRatio);
    this.applyPixelRatio(this.maxRatio);
    this.resLock = 0;
    this.ui.setQuality(level);
    try { localStorage.setItem(QUALITY_KEY, level); } catch { /* 저장 불가 환경 무시 */ }
    if (this.state !== 'playing') this.renderFrame(0, 1);
  }

  private step(frameDt: number, draw: boolean): void {
    const dt = Math.min(frameDt, SIMULATION.maxFrameDelta);
    let alpha = 1;
    if (this.state === 'playing') {
      const step = SIMULATION.fixedTimeStep;
      const cmd = this.controller.update(this.gameCamera.camera);
      this.accumulator += dt;
      while (this.accumulator >= step && this.state === 'playing') {
        this.player.step(step, cmd, this.world.collision);
        this.weapon.update(step, this.controller.fire);
        this.projectiles.step(step);
        this.zombies.step(step, this.time, this.gameCamera.camera);
        // 경험치 결정 흡수 → 경험치 (레벨업은 아래에서 상태 전환)
        this.orbs.step(step, this.player.position.x, this.player.position.z, this.upgrades.stats.pickupRadius, (v) => this.experience.collect(v));
        this.time += step;
        if (this.state === 'playing') this.waves.step(step); // 이 스텝에 죽었으면 시간 정지
        this.accumulator -= step;
        // 레벨업: 게임 오버가 아닐 때만. 이후 스텝은 멈춘다 (while 조건)
        if (this.state === 'playing' && this.experience.levels.pending > 0 && !this.player.dead) this.enterLevelUp();
      }
      alpha = this.state === 'playing' ? this.accumulator / step : 1;
    } else if (this.state === 'gameover') {
      // 로직(이동 · 사격 · 좀비 AI · 생성)은 멈추고, 쓰러지는 연출만 진행
      if (this.gameOverDelay > 0) {
        this.gameOverDelay -= dt;
        if (this.gameOverDelay <= 0 && this.lastRun) {
          this.ui.showGameOver(this.lastRun.run, this.lastRun.result, { level: this.experience.levels.level, upgrades: this.upgrades.ownedCount });
        }
      }
    }
    const animate = this.state === 'playing' || this.state === 'gameover';
    this.renderFrame(animate ? dt : 0, alpha, draw);
  }

  beginPlay(): void {
    this.audio.unlock();
    this.setState('playing');
    if (!this.runStarted) {
      this.runStarted = true;
      this.waves.reset(); // 웨이브 1 알림 + 난이도 적용
    }
  }

  /** 다시 시작: 페이지 새로고침 없이 이번 판 상태를 모두 초기화 */
  restart(): void {
    // 강화 · 경험치 먼저 초기화 → 기본 능력치(최대 체력 100 등) 복원 뒤 부활
    this.levelUp.hide();
    this.upgrades.reset();
    this.experience.reset();
    this.orbs.reset();
    this.critHits = 0;
    this.player.revive(this.world.spawnPoint);
    this.model.setDead(false);
    this.weapon.reset();
    this.projectiles.clear();
    this.effects.clear();
    this.zombies.reset();
    this.time = 0;
    this.lastShotTime = -10;
    this.lastRun = null;
    this.spread = 0;
    this.gameOverDelay = 0;
    this.ui.setKills(0);
    this.gameCamera.snap(this.player.position);
    this.runStarted = false; // beginPlay 에서 웨이브 1 부터 다시
    this.beginPlay();
    // 다음 프레임을 기다리지 않고 HUD 를 바로 초기 상태로
    this.ui.setWaveStatus(this.waves.wave, this.waves.time, this.zombies.aliveCount);
    const lv = this.experience.levels;
    this.ui.setXp(lv.level, lv.xp, lv.required);
    this.ui.setUpgrades(this.upgradeSummary());
  }

  /** 레벨업 시작: 로직 정지 + 강화 카드 3장 */
  private enterLevelUp(): void {
    this.state = 'levelup';
    this.input.reset();
    this.weapon.releaseTrigger();
    this.accumulator = 0;
    this.ui.hideWaveBanner();
    this.showLevelUpChoices();
  }

  private showLevelUpChoices(): void {
    const lv = this.experience.levels;
    const choices = this.upgrades.rollChoices(this.upgradeContext());
    if (choices.length === 0) {
      // 고를 수 있는 강화가 하나도 없으면 (모두 최대) 기회를 소모하고 진행
      lv.pending = 0;
      this.resumeFromLevelUp();
      return;
    }
    // 이번 선택이 몇 레벨 달성분인지 (연속 레벨업이면 앞 레벨부터 차례로)
    this.levelUp.show(lv.level - lv.pending + 1, choices, lv.pending - 1);
  }

  /** 카드 선택 확정 (화면 · 키 입력 공통). 선택마다 한 번만 호출된다 */
  chooseUpgrade(id: string): void {
    if (this.state !== 'levelup') return;
    this.upgrades.apply(id);
    const lv = this.experience.levels;
    lv.pending = Math.max(0, lv.pending - 1);
    if (lv.pending > 0 && !this.player.dead) this.showLevelUpChoices();
    else this.resumeFromLevelUp();
  }

  private resumeFromLevelUp(): void {
    this.levelUp.hide();
    this.setState('playing');
  }

  private upgradeContext(): UpgradeContext {
    return { health: this.player.health, maxHealth: this.player.maxHealth, level: (id) => this.upgrades.level(id) };
  }

  /** 강화 능력치 → 실제 시스템에 반영 (기본값은 각 설정에 보존, 여기서는 현재값만 덮어씀) */
  private applyStats(st: PlayerStats): void {
    this.weapon.applyStats({ damage: st.damage, fireRate: st.fireRate, magazineSize: st.magazineSize, reloadTime: st.reloadTime, pierce: st.pierce });
    this.player.moveSpeed = st.moveSpeed;
    this.player.setMaxHealth(st.maxHealth);
    this.player.damageReduction = st.damageReduction;
    this.experience.multiplier = st.xpMultiplier;
  }

  private upgradeSummary(): { icon: string; name: string; level: number; color: string; label: string }[] {
    const out = [];
    for (const u of UPGRADES) {
      const l = this.upgrades.level(u.id);
      if (l > 0) out.push({ icon: u.icon, name: u.name, level: l, color: RARITY_INFO[u.rarity].color, label: u.format(l) });
    }
    return out;
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
    this.zombieRenderer.dispose();
    this.model.dispose();
    this.world.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }

  /** 현재 렌더 배율 (동적 해상도) */
  pixelRatio = Math.min(window.devicePixelRatio, RENDER_CONFIG.maxPixelRatio);
  private maxRatio = this.pixelRatio;
  private perfTime = 0;
  private perfFrames = 0;
  private perfGood = 0;
  /** 해상도를 낮춰도 FPS 가 안 오르면 (화면 크기가 병목이 아님) 한동안 낮추지 않는다 */
  private resLock = 0;
  private lastDrop: { from: number; fps: number } | null = null;
  fps = 0;

  private applyPixelRatio(r: number): void {
    this.pixelRatio = r;
    this.renderer.setPixelRatio(r);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  /** 1초마다 평균 FPS 를 보고 렌더 배율을 조절한다 */
  private adaptResolution(frameDt: number): void {
    const d = RENDER_CONFIG.dynamicResolution;
    if (!d.enabled || frameDt <= 0) return;
    this.perfTime += frameDt;
    this.perfFrames++;
    if (this.perfTime < 1) return;
    const fps = this.perfFrames / this.perfTime;
    this.fps = fps;
    this.perfTime = 0;
    this.perfFrames = 0;
    if (this.resLock > 0) this.resLock--;

    // 직전에 낮춘 효과 확인: 8% 도 안 좋아졌으면 되돌리고 30초간 낮추지 않음
    if (this.lastDrop) {
      const drop = this.lastDrop;
      this.lastDrop = null;
      if (fps < drop.fps * 1.08) {
        this.applyPixelRatio(drop.from);
        this.resLock = 30;
        return;
      }
    }
    if (fps < d.lowFps && this.pixelRatio > d.minPixelRatio && this.resLock === 0) {
      this.lastDrop = { from: this.pixelRatio, fps };
      this.applyPixelRatio(Math.max(d.minPixelRatio, this.pixelRatio - d.step));
      this.perfGood = 0;
    } else if (fps >= d.highFps && this.pixelRatio < this.maxRatio) {
      // 올릴 때는 신중하게: 5초 연속 여유가 있을 때만
      if (++this.perfGood >= 5) { this.applyPixelRatio(Math.min(this.maxRatio, this.pixelRatio + d.step)); this.perfGood = 0; }
    } else {
      this.perfGood = 0;
    }
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
    else if (next === 'gameover') this.ui.showScreen(null);
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
        // 치명타: 명중마다 판정 (관통 탄은 대상마다 따로)
        const st = this.upgrades.stats;
        const crit = st.critChance > 0 && this.critRandom() < st.critChance;
        if (crit) { h.damage *= st.critMultiplier; this.critHits++; }
        e.target.takeDamage(h);
        this.effects.impactFlesh(e.point, e.direction);
        if (crit) this.effects.critSpark(e.point);
        if (e.target instanceof Zombie) this.zombies.notifyDamaged(e.target);
        if (e.target.canBeHit()) {
          this.ui.flashHit(false, crit);
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

    // 좀비 처치 · 플레이어 피격 · 사망
    this.zombies.onKilled = (z) => {
      this.orbs.spawn(z.position.x, z.position.z, z.stats.xp);
      this.effects.zombieDeath(z.position);
      this.audio.bodyFall();
      this.ui.flashHit(true);
      this.ui.setKills(this.zombies.kills);
    };
    this.player.onDamaged = () => {
      this.ui.hurt();
      this.model.flashHurt();
      this.audio.hurt();
    };
    this.player.onDeath = () => {
      this.state = 'gameover';
      this.input.reset();
      this.weapon.releaseTrigger();
      this.model.setDead(true);
      this.gameOverDelay = 1.3;
      // 결과 확정 (시간은 이 순간 멈춤) + 최고 기록 저장
      const run: RecordSet = { time: this.waves.time, wave: this.waves.wave, kills: this.zombies.kills };
      this.lastRun = { run, result: this.records.submit(run) };
      this.ui.hideWaveBanner();
      this.ui.showScreen(null);
    };

    this.waves.onWaveStart = (params) => {
      this.zombies.setDifficulty(params);
      this.ui.showWaveBanner(params.wave);
    };

    this.input.onPointerMove = (x, y) => this.ui.moveCursor(x, y);
    this.input.onPress('KeyR', () => { if (this.state === 'playing') this.weapon.requestReload(); });
    this.input.onPress('Escape', () => {
      if (this.state === 'playing') this.pause('ESC 키로 일시정지했습니다.');
    });
    this.input.onPress('F3', () => this.debug.toggle());
    // 레벨업 카드: 숫자 1 · 2 · 3
    ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].forEach((code) => {
      this.input.onPress(code, () => { if (this.state === 'levelup') this.levelUp.select(Number(code.slice(-1)) - 1); });
    });
    this.levelUp.onChoose = (choice) => this.chooseUpgrade(choice.def.id);
    this.upgrades.onStatsChanged = (st) => this.applyStats(st);
    this.upgrades.onInstantEffect = (def) => {
      if (def.effect === 'heal') this.player.heal(def.value);
      if (def.effect === 'maxHealth') this.player.heal(def.value); // 강인함: 최대 체력 +20 과 함께 20 회복
    };
    this.input.onPress('KeyM', () => (this.audio.muted = !this.audio.muted));

    this.ui.onStart = () => this.beginPlay();
    this.ui.onResume = () => this.beginPlay();
    this.ui.onRestart = () => this.restart();
    this.ui.onQuality = (level) => this.setQuality(level);

    const onBlur = () => this.pause('게임 창이 포커스를 잃어 일시정지했습니다.');
    const onVisibility = () => { if (document.hidden) this.pause('탭이 숨겨져 일시정지했습니다.'); };
    const onResize = () => {
      this.maxRatio = Math.min(window.devicePixelRatio, QUALITY_PRESETS[this.quality].maxPixelRatio);
      this.pixelRatio = Math.min(this.pixelRatio, this.maxRatio);
      this.renderer.setPixelRatio(this.pixelRatio);
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
    this.zombieRenderer.update(dt, this.zombies.zombies, alpha, this.gameCamera.camera);
    this.effects.update(dt, this.gameCamera.camera);

    this.ui.setWaveStatus(this.waves.wave, this.waves.time, this.zombies.aliveCount);
    const lv = this.experience.levels;
    this.ui.setXp(lv.level, lv.xp, lv.required);
    this.ui.setUpgrades(this.upgradeSummary());
    this.orbs.render();
    this.spread *= Math.exp(-6 * dt);
    const w = this.weapon;
    this.ui.update(dt, {
      health: p.health, maxHealth: p.maxHealth, ammo: w.ammo, magazineSize: w.stats.magazineSize, weaponName: w.stats.name,
      reloading: w.reloading, reloadProgress: w.reloadProgress, spread: this.spread,
    });

    if (draw) this.renderer.render(this.scene, this.gameCamera.camera);
  }

  private debugRows(): [string, string][] {
    const p = this.player;
    const info = this.renderer.info;
    return [
      ['FPS', `${this.debug.fps.toFixed(0)} (${this.debug.frameMs.toFixed(1)}ms, 최악 ${this.debug.worstMs.toFixed(0)}ms)`],
      ['CPU 시간', `${this.cpuMs.toFixed(2)}ms / 프레임`],
      ['그래픽', `${QUALITY_PRESETS[this.quality].label} · 그림자 ${this.renderer.shadowMap.enabled ? 'ON' : 'OFF'}${this.resLock ? ' · 해상도 고정' : ''}`],
      ['GPU', this.gpuName],
      ['상태', this.state],
      ['위치', `${p.position.x.toFixed(2)}, ${p.position.z.toFixed(2)}`],
      ['속도', `${p.speed.toFixed(2)} / 벽 ${p.touchingWall ? '접촉' : '-'}`],
      ['조준 각도', `${THREE.MathUtils.radToDeg(p.aimYaw).toFixed(1)}° (${p.aimDistance.toFixed(1)}m)`],
      ['탄약', `${this.weapon.ammo}/${this.weapon.stats.magazineSize}${this.weapon.reloading ? ' 재장전' : ''}`],
      ['발사 누적', String(this.weapon.shotsFired)],
      ['투사체', `${this.projectiles.activeCount} / 풀 ${this.projectiles.capacity}`],
      ['파티클', String(this.effects.particleCount)],
      ['체력', `${p.health}/${p.maxHealth}${p.invulnerable > 0 ? ' 무적' : ''} · 받은 피해 ${p.damageTaken} · 막힘 ${p.blockedHits}`],
      ['레벨', `${this.experience.levels.level} · ${this.experience.levels.xp}/${this.experience.levels.required} XP · 대기 ${this.experience.levels.pending} · 결정 ${this.orbs.count}개(${this.orbs.totalValue}XP)`],
      ['강화 능력치', (() => { const st = this.upgrades.stats; return `피해 ${st.damage.toFixed(1)} · 연사 ${st.fireRate.toFixed(1)} · 탄창 ${st.magazineSize} · 장전 ${st.reloadTime.toFixed(2)}s · 관통 ${st.pierce} · 치명 ${Math.round(st.critChance * 100)}%`; })()],
      ['웨이브', `${this.waves.wave} (${formatTime(this.waves.time)}) · 간격 ${this.zombies.difficulty.spawnInterval}s · 상한 ${this.zombies.difficulty.maxAlive} · 체력 ×${this.zombies.difficulty.healthMultiplier}`],
      ['좀비', `생존 ${this.zombies.aliveCount} · 시체 ${this.zombies.corpseCount} · 처치 ${this.zombies.kills} · 생성 ${this.zombies.spawned}`],
      ['AI 시간', `${this.zombies.aiMs.toFixed(3)}ms / 스텝 · 경로 ${this.zombies.nav.lastBuildMs.toFixed(2)}ms (${this.zombies.nav.builds}회)`],
      ['렌더 배율', `${this.pixelRatio.toFixed(2)} (${this.renderer.domElement.width}×${this.renderer.domElement.height})`],
      ['드로우콜', String(info.render.calls)],
      ['삼각형', info.render.triangles.toLocaleString()],
      ['카메라', `${CAMERA_CONFIG.pitchDeg}° / ${CAMERA_CONFIG.distance}m`],
    ];
  }
}

const QUALITY_KEY = 'project-dead-zone.quality';

function loadQuality(): QualityLevel {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v && v in QUALITY_PRESETS) return v as QualityLevel;
  } catch { /* 저장소 접근 불가 */ }
  return DEFAULT_QUALITY;
}

/** 브라우저가 실제로 쓰는 그래픽 장치 이름 (소프트웨어 렌더링 여부 진단용) */
function detectGpu(renderer: THREE.WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(name).replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 48);
  } catch {
    return '알 수 없음';
  }
}
