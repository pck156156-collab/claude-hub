import * as THREE from 'three';
import { CAMERA_CONFIG, DEFAULT_QUALITY, PLAYER_CONFIG, QUALITY_PRESETS, QualityLevel, RENDER_CONFIG, SIMULATION, ZOMBIE_TYPES } from '../config/GameConfig';
import { GameCamera } from '../camera/GameCamera';
import { DamageableRegistry } from '../combat/Damageable';
import { AttackSpec, CombatSystem } from '../combat/CombatSystem';
import { Effects } from '../effects/Effects';
import { Player } from '../player/Player';
import { PlayerController } from '../player/PlayerController';
import { PlayerModel } from '../player/PlayerModel';
import { Zombie, ZombieState } from '../enemies/Zombie';
import { ZombieManager } from '../enemies/ZombieManager';
import { ZombieRenderer } from '../enemies/ZombieRenderer';
import { DamageNumbers } from '../ui/DamageNumbers';
import { ThreatIndicators } from '../ui/ThreatIndicators';
import { EnemyProjectiles } from '../enemies/EnemyProjectiles';
import { EnemyTelegraphs } from '../enemies/EnemyTelegraphs';
import { BossDirector } from '../enemies/BossDirector';
import { BOSS_CONFIG, BOSS_CHOICES, BOSS_REWARD, BossReward, ELITE_REWARD } from '../enemies/EnemyData';
import { GameSettings, loadSettings, saveSettings } from './Settings';
import { DIFFICULTIES } from '../config/GameConfig';
import { slamRadius } from '../enemies/EnemyBehaviors';
import { DebugPanel } from '../ui/DebugPanel';
import { GameUI, LoadoutSlot } from '../ui/GameUI';
import { ProjectileSystem } from '../weapons/Projectile';
import { Weapon } from '../weapons/Weapon';
import { GunShooter } from '../weapons/GunShooter';
import { MeleeSystem } from '../weapons/MeleeSystem';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { GUNS, GunId, MASTERY, MELEE, MeleeId } from '../weapons/WeaponData';
import { RewardQueue } from '../progression/RewardQueue';
import { World } from '../world/World';
import { WaveSystem, formatTime } from '../waves/WaveSystem';
import { ExperienceOrbs } from '../items/ExperienceOrb';
import { ExperienceSystem } from '../progression/ExperienceSystem';
import { PlayerStats, computeGunStats, computeMeleeStats } from '../upgrades/StatCalculator';
import { RARITY_INFO, UPGRADES, UpgradeContext } from '../upgrades/UpgradeData';
import { UpgradeManager } from '../upgrades/UpgradeManager';
import { LevelUpScreen, WeaponOffer } from '../ui/LevelUpScreen';
import { AudioManager } from './AudioManager';
import { RecordResult, RecordSet, Records } from './Records';
import { InputManager } from './InputManager';

/** levelup: 보상 선택 중 (강화 · 총기 · 근접 무기; 게임 로직 정지, 렌더 · UI 입력만 유지). gameover 가 항상 우선 */
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
  /** 무기 슬롯 (총기 2 · 근접 1) · 숙련도 */
  readonly weapons: WeaponSystem;
  /** 공통 피해 처리 (총기 · 근접) */
  readonly combat = new CombatSystem();
  /** 사격 방식 (산탄 분배 · 퍼짐) */
  readonly shooter: GunShooter;
  /** 근접 공격 (F) */
  readonly melee: MeleeSystem;
  /** 보상 대기열 (강화 → 총기 → 근접) */
  readonly rewards = new RewardQueue();
  readonly registry = new DamageableRegistry();
  /** 현재 들고 있는 총 (이전 단계 코드 · 테스트 호환) */
  get weapon(): Weapon {
    return this.weapons.current;
  }
  readonly zombies: ZombieManager;
  readonly zombieRenderer: ZombieRenderer;
  /** 스피터 독성 투사체 */
  readonly enemyShots: EnemyProjectiles;
  /** 적 공격 위험 범위 표시 */
  readonly telegraphs: EnemyTelegraphs;
  /** 보스 등장 관리 (5웨이브마다) */
  readonly bosses = new BossDirector();
  /** 데미지 숫자 (DOM 풀) */
  readonly damageNumbers: DamageNumbers;
  /** 화면 밖 위협 방향 표시 (보스 · 엘리트 · 폭발 준비) */
  readonly threats: ThreatIndicators;
  /** 주변 좀비 울음 · 탱커 발소리 타이머 */
  private groanTimer = 2;
  /** 명중 효과 · 사격 효과 횟수 (테스트: 판정과 효과 연결 확인) */
  hitFx = 0;
  shotsFx = 0;
  /** 설정 (난이도 · 화면 흔들림 · 데미지 숫자) */
  readonly settings: GameSettings = loadSettings();
  /** 보스 보상 선택 기록 · 엘리트 보상 기록 (테스트 · 디버그) */
  readonly bossChoices: string[] = [];
  eliteRewards = 0;
  private lastEliteReward = -1e9;
  /** 흡혈 회복 예산 (초당 최대 LIFESTEAL_PER_SEC) */
  private lifestealBudget = LIFESTEAL_PER_SEC;
  private stepTimer = 0;
  /** 보스 처치 보상 (향후 희귀 무기 · 특별 강화). 지급 직후 호출 */
  onBossDefeated: ((reward: BossReward) => void) | null = null;
  lastBossReward: BossReward | null = null;
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
  private readonly gunSpec: AttackSpec = {
    attackId: 0, sourceId: '', kind: 'gun', damage: 0, critChance: 0, critMultiplier: 2, knockback: 0,
    point: new THREE.Vector3(), direction: new THREE.Vector3(),
  };
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
  get critRandom(): () => number { return this.combat.random; }
  set critRandom(fn: () => number) { this.combat.random = fn; }
  /** 누적 치명타 수 (디버그 · 테스트) */
  get critHits(): number { return this.combat.stats.crits; }
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
    this.weapons = new WeaponSystem(this.player);
    this.projectiles = new ProjectileSystem(this.scene, this.world.collision, this.registry);
    this.shooter = new GunShooter(this.projectiles, this.combat);
    this.melee = new MeleeSystem(this.weapons, this.registry, this.world.collision, this.combat);
    this.effects = new Effects(this.scene);

    this.zombies = new ZombieManager(this.world.collision, this.registry, this.player);
    this.zombieRenderer = new ZombieRenderer(this.scene, ZOMBIE_TYPES.walker.appearance);
    this.enemyShots = new EnemyProjectiles(this.scene, this.world.collision, this.player);
    this.telegraphs = new EnemyTelegraphs(this.scene);
    this.damageNumbers = new DamageNumbers(document.getElementById('app') ?? document.body);
    this.threats = new ThreatIndicators(document.getElementById('app') ?? document.body);
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
    this.world.setQuality(q.shadowMapSize, q.streetLights, q.decor, q.fireLights);
    this.effects.setDensity(q.particles);
    this.damageNumbers.limit = q.damageNumbers;
    document.getElementById('app')?.classList.toggle('post', q.post);
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
        this.lifestealBudget = Math.min(LIFESTEAL_PER_SEC, this.lifestealBudget + LIFESTEAL_PER_SEC * step);
        // 이동 중 퍼짐: 기본 이동 속도 대비 현재 속도
        this.shooter.moveRatio = this.player.speed / PLAYER_CONFIG.moveSpeed;
        this.player.muzzleZOffset = GUNS[this.weapons.currentId].holdZ;
        this.weapons.update(step, this.controller.fire, this.melee.busy);
        this.melee.step(step, { x: this.player.position.x, z: this.player.position.z, yaw: this.player.aimYaw });
        this.projectiles.step(step);
        this.zombies.step(step, this.time, this.gameCamera.camera);
        this.enemyShots.step(step);
        this.bosses.step(step, this.zombies, this.gameCamera.camera, !this.player.dead);
        // 경험치 결정 흡수 → 경험치 (레벨업은 아래에서 상태 전환)
        this.orbs.step(step, this.player.position.x, this.player.position.z, this.upgrades.stats.pickupRadius, (v) => { this.experience.collect(v); this.audio.pickup(); });
        if (this.melee.busy && this.player.dead) this.melee.reset();
        this.time += step;
        if (this.state === 'playing') this.waves.step(step); // 이 스텝에 죽었으면 시간 정지
        this.accumulator -= step;
        // 레벨업: 게임 오버가 아닐 때만. 이후 스텝은 멈춘다 (while 조건)
        if (this.state === 'playing' && this.rewards.length > 0 && !this.player.dead) this.enterLevelUp();
      }
      alpha = this.state === 'playing' ? this.accumulator / step : 1;
      if (this.state === 'playing') this.updateAmbientAudio(dt);
    } else if (this.state === 'gameover') {
      // 로직(이동 · 사격 · 좀비 AI · 생성)은 멈추고, 쓰러지는 연출만 진행
      if (this.gameOverDelay > 0) {
        this.gameOverDelay -= dt;
        if (this.gameOverDelay <= 0 && this.lastRun) {
          this.ui.showGameOver(this.lastRun.run, this.lastRun.result, { level: this.experience.levels.level, upgrades: this.upgrades.ownedCount, weapons: this.loadoutText() });
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
      // 난이도: 판을 시작할 때 적용 (판 중에는 바뀌지 않음)
      this.zombies.setMode(DIFFICULTIES[this.settings.difficulty]);
      this.records.setMode(this.settings.difficulty);
      this.waves.reset(); // 웨이브 1 알림 + 난이도 적용
    }
  }

  /** 다시 시작: 페이지 새로고침 없이 이번 판 상태를 모두 초기화 */
  restart(): void {
    // 강화 · 경험치 먼저 초기화 → 기본 능력치(최대 체력 100 등) 복원 뒤 부활
    this.levelUp.hide();
    this.rewards.clear();
    this.upgrades.reset();
    this.experience.reset();
    this.orbs.reset();
    this.combat.reset();
    // 무기: 기본 장비(AR-12 · P9 · 나이프) · 숙련도 · 탄약 초기화
    this.weapons.reset();
    this.melee.reset();
    this.player.revive(this.world.spawnPoint);
    this.model.setDead(false);
    this.projectiles.clear();
    this.effects.clear();
    this.zombies.reset();
    this.enemyShots.clear();
    this.telegraphs.clear();
    this.bosses.reset();
    this.lastBossReward = null;
    this.ui.setBoss(null);
    this.ui.hideAlert();
    this.damageNumbers.clear();
    this.audio.setMood('calm');
    this.hitFx = 0;
    this.shotsFx = 0;
    this.bossChoices.length = 0;
    this.eliteRewards = 0;
    this.lastEliteReward = -1e9;
    this.lifestealBudget = LIFESTEAL_PER_SEC;
    this.threats.clear();
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
    this.ui.setLoadout(this.loadoutSlots(), this.meleeSlot());
  }

  /** 보상 시작: 로직 정지 + 대기열 맨 앞 보상 화면 */
  private enterLevelUp(): void {
    this.state = 'levelup';
    this.audio.levelUp();
    this.input.reset();
    this.weapon.releaseTrigger();
    this.accumulator = 0;
    this.ui.hideWaveBanner();
    this.showNextReward();
  }

  /** 대기열 맨 앞 보상을 보여 준다. 고를 것이 없는 보상은 건너뛰고, 다 끝나면 재개 */
  private showNextReward(): void {
    for (;;) {
      const r = this.rewards.current;
      if (!r || this.player.dead) { this.rewards.clear(); this.resumeFromLevelUp(); return; }
      const remaining = this.rewards.length - 1;
      if (r.kind === 'upgrade') {
        const choices = this.upgrades.rollChoices(this.upgradeContext());
        if (choices.length > 0) { this.levelUp.show(r.level, choices, remaining); return; }
      } else if (r.kind === 'boss') {
        this.showBossOffer(remaining); return;
      } else if (r.kind === 'gun') {
        const offers = this.weapons.gunOffers();
        if (offers.length > 0) { this.showGunOffer(offers, r.level, remaining); return; }
      } else {
        const offers = this.weapons.meleeOffers();
        if (offers.length > 0) { this.showMeleeOffer(offers, r.level, remaining); return; }
      }
      this.rewards.complete(); // 고를 것이 없음 → 다음 보상
    }
  }

  /** 카드 선택 확정 (화면 · 키 입력 공통). 선택마다 한 번만 호출된다 */
  chooseUpgrade(id: string): void {
    if (this.state !== 'levelup' || this.rewards.current?.kind !== 'upgrade') return;
    this.upgrades.apply(id);
    this.rewards.complete();
    this.showNextReward();
  }

  /**
   * 무기 보상 결정. 총기: value = 교체할 슬롯 ("0" | "1"), 근접: value = "equip". id 가 null 이면 거절.
   */
  decideWeaponReward(id: string | null, value: string | null): void {
    const r = this.rewards.current;
    if (this.state !== 'levelup' || !r || r.kind === 'upgrade') return;
    if (r.kind === 'boss') {
      this.rewards.complete(); // 먼저 완료 처리 → 보상이 두 번 지급되지 않음
      this.applyBossChoice(id ?? 'heal');
      this.showNextReward();
      return;
    }
    if (id && r.kind === 'gun' && (value === '0' || value === '1')) {
      const old = GUNS[this.weapons.slots[Number(value) as 0 | 1]].name;
      if (this.weapons.equipGun(id as GunId, Number(value) as 0 | 1)) this.ui.toast(`${GUNS[id as GunId].name} 장착 (${old} 해제)`);
    } else if (id && r.kind === 'melee') {
      const old = MELEE[this.weapons.meleeId].name;
      if (this.weapons.equipMelee(id as MeleeId)) this.ui.toast(`${MELEE[id as MeleeId].name} 장착 (${old} 해제)`);
    }
    this.rewards.complete();
    this.showNextReward();
  }

  /** 보스 처치 보상 선택지 (체력 회복 · 숙련도 · 추가 강화 중 하나) */
  private showBossOffer(remaining: number): void {
    const R = BOSS_CHOICES;
    const w = this.weapons;
    const offers: WeaponOffer[] = [
      {
        id: 'heal', name: '응급 수혈', role: `체력 ${R.heal} 회복 (최대 체력까지)`, color: '#6fcf5a', label: '회복',
        stats: [['현재 체력', `${Math.ceil(this.player.health)} / ${this.player.maxHealth}`, ''], ['회복 후', `${Math.min(this.player.maxHealth, Math.ceil(this.player.health + R.heal))}`, 'up']],
        actions: [{ label: '선택', value: 'pick' }],
      },
      {
        id: 'mastery', name: '전투 경험', role: `장착한 총기 2종 숙련도 +${R.gunMastery} · 근접 +${R.meleeMastery}`, color: '#f0b03a', label: '숙련도',
        stats: [
          [GUNS[w.slots[0]].name, `Lv ${w.gunMastery.level(w.slots[0])}`, ''],
          [GUNS[w.slots[1]].name, `Lv ${w.gunMastery.level(w.slots[1])}`, ''],
          [MELEE[w.meleeId].name, `Lv ${w.meleeMastery.level(w.meleeId)}`, ''],
        ],
        actions: [{ label: '선택', value: 'pick' }],
      },
      {
        id: 'upgrade', name: '추가 강화', role: '강화 카드를 한 번 더 선택합니다', color: '#a855f7', label: '강화',
        stats: [['보유 강화', `${this.upgrades.ownedCount}종`, '']],
        actions: [{ label: '선택', value: 'pick' }],
      },
    ];
    this.levelUp.showOffer('BOSS REWARD', '보스 처치 보상 · 하나를 고르세요 (1 · 2 · 3 키)', offers, '', remaining, false);
  }

  private applyBossChoice(id: string): void {
    const R = BOSS_CHOICES;
    const w = this.weapons;
    if (id === 'mastery') {
      for (const g of w.slots) w.addMastery('gun', g, R.gunMastery);
      w.addMastery('melee', w.meleeId, R.meleeMastery);
      this.ui.toast('보스 보상: 숙련도 경험치 획득');
    } else if (id === 'upgrade') {
      this.rewards.addUpgrade(this.experience.levels.level);
      this.ui.toast('보스 보상: 추가 강화 1회');
    } else {
      const healed = this.player.heal(R.heal);
      this.ui.toast(`보스 보상: 체력 +${Math.round(healed)}`);
    }
    this.bossChoices.push(id);
  }

  private showGunOffer(ids: GunId[], level: number, remaining: number): void {
    const w = this.weapons;
    const statOf = (id: GunId) => computeGunStats(GUNS[id], w.mods, w.gunMastery.bonus(id));
    const cur = w.slots.map(statOf);
    const offers: WeaponOffer[] = ids.map((id) => {
      const st = statOf(id);
      const best = (v: number, key: 'dps' | 'mag' | 'reload') => {
        const others = cur.map((c) => (key === 'dps' ? c.damage * c.pellets * c.fireRate : key === 'mag' ? c.magazineSize : c.reloadTime));
        const better = key === 'reload' ? v < Math.min(...others) : v > Math.max(...others);
        const worse = key === 'reload' ? v > Math.max(...others) : v < Math.min(...others);
        return better ? 'up' : worse ? 'down' : '';
      };
      const dps = st.damage * st.pellets * st.fireRate;
      return {
        id, name: GUNS[id].name, role: GUNS[id].role, color: '#e0452f', label: `Lv ${w.gunMastery.level(id)} 숙련`,
        stats: [
          ['피해', st.pellets > 1 ? `${round1(st.damage)} × ${st.pellets}` : round1(st.damage), ''],
          ['발사 속도', `${round1(st.fireRate)}/초 · ${st.auto ? '자동' : '반자동'}`, ''],
          ['초당 화력', String(Math.round(dps)), best(dps, 'dps')],
          ['탄창', String(st.magazineSize), best(st.magazineSize, 'mag')],
          ['재장전', `${st.reloadTime.toFixed(1)}초`, best(st.reloadTime, 'reload')],
          ['사거리', GUNS[id].rangeLabel, ''],
        ],
        actions: [0, 1].map((slot) => ({ label: `슬롯 ${slot + 1} 교체 (${GUNS[w.slots[slot]].name} 해제)`, value: String(slot) })),
      };
    });
    const eq = w.slots.map((id, i) => {
      const c = cur[i];
      return `<b>[${i + 1}] ${GUNS[id].name}</b> 피해 ${c.pellets > 1 ? `${round1(c.damage)}×${c.pellets}` : round1(c.damage)} · ${round1(c.fireRate)}/초 · 초당 ${Math.round(c.damage * c.pellets * c.fireRate)} · 탄창 ${c.magazineSize} · 장전 ${c.reloadTime.toFixed(1)}초`;
    }).join('<br>');
    this.levelUp.showOffer('NEW FIREARM', `레벨 ${level} 보상 · 새 총기를 장착할 슬롯을 고르세요`, offers, `현재 장착 — ${eq}`, remaining);
  }

  private showMeleeOffer(ids: MeleeId[], level: number, remaining: number): void {
    const w = this.weapons;
    const statOf = (id: MeleeId) => computeMeleeStats(MELEE[id], w.mods, w.meleeMastery.bonus(id));
    const cur = statOf(w.meleeId);
    const cmp = (v: number, c: number, lowerBetter = false) => (v === c ? '' : (v > c) !== lowerBetter ? 'up' : 'down');
    const offers: WeaponOffer[] = ids.map((id) => {
      const st = statOf(id);
      return {
        id, name: MELEE[id].name, role: MELEE[id].role, color: '#ffb347', label: `Lv ${w.meleeMastery.level(id)} 숙련`,
        stats: [
          ['피해', round1(st.damage), cmp(st.damage, cur.damage)],
          ['공격 간격', `${st.interval.toFixed(2)}초`, cmp(st.interval, cur.interval, true)],
          ['사거리', st.range.toFixed(1), cmp(st.range, cur.range)],
          ['공격 각도', `${st.arcDeg}°`, cmp(st.arcDeg, cur.arcDeg)],
          ['최대 대상', `${st.maxTargets}마리`, cmp(st.maxTargets, cur.maxTargets)],
          ['넉백', st.knockback.toFixed(1), cmp(st.knockback, cur.knockback)],
        ],
        actions: [{ label: `장착 (${MELEE[w.meleeId].name} 해제)`, value: 'equip' }],
      };
    });
    const eq = `<b>[F] ${MELEE[w.meleeId].name}</b> 피해 ${round1(cur.damage)} · 간격 ${cur.interval.toFixed(2)}초 · 사거리 ${cur.range.toFixed(1)} · ${cur.arcDeg}° · 최대 ${cur.maxTargets}마리`;
    this.levelUp.showOffer('NEW MELEE WEAPON', `레벨 ${level} 보상 · 근접 무기를 교체하거나 거절하세요`, offers, `현재 장착 — ${eq}`, remaining);
  }

  /** 결과 화면용 장착 무기 요약 */
  private loadoutText(): string {
    const w = this.weapons;
    return `${GUNS[w.slots[0]].name} · ${GUNS[w.slots[1]].name} · ${MELEE[w.meleeId].name}`;
  }

  private resumeFromLevelUp(): void {
    this.levelUp.hide();
    this.setState('playing');
  }

  private upgradeContext(): UpgradeContext {
    return { health: this.player.health, maxHealth: this.player.maxHealth, level: (id) => this.upgrades.level(id) };
  }

  /** 강화 보정값 → 실제 시스템에 반영 (무기 최종 능력치는 무기 기본값에서 다시 계산) */
  private applyStats(st: PlayerStats): void {
    this.weapons.setMods(st);
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
    this.enemyShots.dispose();
    this.telegraphs.dispose();
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
    this.weapons.addGunListener({
      onFire: (shot) => {
        const def = GUNS[shot.stats.id];
        this.shooter.fire(shot); // 산탄 · 퍼짐 → 투사체
        this.lastShotTime = this.time;
        this.spread = Math.min(1, this.spread + 0.35 * (def.recoil / 0.09));
        this.eject.copy(shot.origin).addScaledVector(shot.direction, -0.72);
        this.eject.y += 0.05;
        this.effects.muzzleFlash(shot.origin, Math.atan2(shot.direction.x, shot.direction.z), this.eject, def.flashScale, def.id === 'bulldog', def.fx.flashTime);
        this.model.kick(def.id);
        // 화면 반동: 그릴 때만 적용 (조준 계산에는 영향 없음), 쿼터뷰라 아주 약하게
        this.gameCamera.kick(shot.direction.x, shot.direction.z, def.fx.shake);
        if (def.id === 'bulldog') this.gameCamera.shake(0.04);
        this.audio.gunshot(def.id);
        this.shotsFx++;
      },
      onReloadStart: () => this.audio.reload(this.weapon.stats.reloadTime),
      onDryFire: () => this.audio.click(0.7),
    });

    // 투사체 명중 → 공통 피해 처리
    this.projectiles.onImpact = (e) => {
      if (e.target) {
        const sp = this.gunSpec;
        const m = this.weapons.mods;
        sp.attackId = e.attackId;
        sp.sourceId = e.sourceId;
        sp.damage = e.damage;
        sp.critChance = m.critChance;
        sp.critMultiplier = m.critMultiplier;
        sp.knockback = e.knockback;
        sp.point.copy(e.point);
        sp.direction.copy(e.direction);
        this.combat.apply(e.target, sp);
      } else {
        this.effects.impactSurface(e.point, e.normal, GUNS[e.sourceId as GunId]?.fx.impactScale ?? 1);
        if (Math.hypot(e.point.x - this.player.position.x, e.point.z - this.player.position.z) < 18) this.audio.ricochet();
      }
    };

    // 공통 피해 결과: 이펙트 · 숙련도 · 처치 · 흡혈
    this.combat.onHit = (r) => {
      const melee = r.spec.kind === 'melee';
      // 피해가 실제로 들어간 경우에만 여기로 온다 → 명중 효과 · 숫자 · 소리는 판정과 항상 일치
      this.hitFx++;
      if (melee) {
        const heavy = r.spec.knockback >= 4;
        this.effects.meleeHit(r.spec.point, r.spec.direction, heavy);
        this.audio.meleeHit(r.spec.sourceId, r.crit);
        if (heavy) this.gameCamera.shake(r.spec.sourceId === 'axe' ? 0.09 : 0.07);
      } else {
        this.effects.impactFlesh(r.spec.point, r.spec.direction, GUNS[r.spec.sourceId as GunId]?.fx.impactScale ?? 1);
      }
      if (r.crit) this.effects.critSpark(r.spec.point);
      const boss = r.target instanceof Zombie && r.target.stats.kind === 'boss';
      if (this.settings.damageNumbers) this.damageNumbers.add(r.spec.point.x, r.spec.point.y + 0.6 + (boss ? 2 : 0), r.spec.point.z, r.dealt, r.crit ? 'crit' : boss ? 'boss' : melee ? 'melee' : 'normal', r.target);
      this.weapons.addMastery(r.spec.kind, r.spec.sourceId, r.dealt);
      if (r.target instanceof Zombie) this.zombies.notifyDamaged(r.target);
      if (r.killed && melee && this.weapons.meleeStats.lifesteal > 0) {
        // 흡혈: 초당 회복 상한 (근접 속도 + 흡혈 조합이 무적이 되지 않게)
        const amount = Math.min(this.weapons.meleeStats.lifesteal, this.lifestealBudget);
        if (amount > 0) { this.player.heal(amount); this.lifestealBudget -= amount; }
      }
      if (!r.killed) {
        this.ui.flashHit(false, r.crit);
        if (!melee) this.audio.hit(r.crit);
      }
    };

    this.melee.onSwingStart = (id) => this.audio.swing(id);
    this.melee.onSwingHit = (o, range, arc) => {
      const def = MELEE[this.melee.swingId];
      this.effects.meleeArc(o.x, o.z, o.yaw, range, arc, def.trailColor, def.style);
    };
    this.weapons.gunMastery.onLevelUp = (id, lv) => this.ui.toast(`${GUNS[id as GunId].name} 숙련도 Lv.${lv} — 피해 +${(lv - 1) * 5}%`);
    this.weapons.meleeMastery.onLevelUp = (id, lv) => this.ui.toast(`${MELEE[id as MeleeId].name} 숙련도 Lv.${lv} — 피해 +${(lv - 1) * 5}%`);
    this.experience.onLevelUp = (ups) => {
      const lv = this.experience.levels;
      for (let l = lv.level - ups + 1; l <= lv.level; l++) this.rewards.addLevel(l);
      lv.pending = 0; // 보상은 대기열이 관리
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
      this.dropXp(z);
      this.effects.zombieDeath(z.position);
      this.effects.killPop(z.position, z.stats.appearance.scale, z.stats.elite);
      this.audio.bodyFall();
      this.ui.flashHit(true);
      this.ui.setKills(this.zombies.kills);
      if (z.stats.kind === 'boss') this.rewardBoss(z);
      else if (z.stats.elite) this.rewardElite(z);
    };
    this.zombies.onSpawned = (z) => {
      if (z.stats.elite) { this.ui.toast(`⚠ ${z.stats.name} 출현!`); this.audio.eliteStinger(); }
    };
    this.bosses.onSpawn = (boss, wave, index) => {
      this.ui.showAlert(boss.stats.name, index > 1 ? `WAVE ${wave} · 강화 보스 (${index}번째)` : `WAVE ${wave} · 보스 등장`, 'boss');
      this.audio.bossAppear();
      this.effects.dustBurst(boss.position, 3);
      this.gameCamera.shake(0.25);
    };
    this.zombies.events = {
      canSpit: () => this.enemyShots.canFire(),
      spit: (z, x, y, zz, dx, dz, speed, radius, damage) => {
        if (this.enemyShots.fire(x, y, zz, dx, dz, speed, radius, damage, (z.stats.ranged?.range ?? 12) + 2, `zombie:${z.stats.id}`)) this.audio.spit();
      },
      emit: (type, z, value = 0) => this.onEnemyEvent(type, z, value),
    };
    this.enemyShots.onImpact = (x, y, z) => this.effects.toxicSplash(x, y, z);
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
      this.audio.setMood('gameover');
    };

    this.waves.onWaveStart = (params) => {
      this.zombies.setDifficulty(params);
      this.ui.showWaveBanner(params.wave);
      this.bosses.onWave(params.wave, this.zombies);
    };

    this.input.onPointerMove = (x, y) => this.ui.moveCursor(x, y);
    this.input.onPress('KeyR', () => {
      if (this.state === 'playing' && !this.melee.busy && !this.weapons.switching) this.weapon.requestReload();
    });
    // 근접 공격: 누를 때마다 한 번 (키 반복은 InputManager 가 무시)
    this.input.onPress('KeyF', () => { if (this.state === 'playing' && !this.player.dead) this.melee.tryAttack(); });
    this.input.onWheel = () => {
      if (this.state === 'playing' && this.weapons.cycle(this.melee.busy)) this.audio.weaponSwitch();
    };
    this.input.onPress('Escape', () => {
      if (this.state === 'playing') this.pause('ESC 키로 일시정지했습니다.');
    });
    this.input.onPress('F3', () => this.debug.toggle());
    // 숫자 1 · 2 · 3: 플레이 중에는 총기 슬롯, 보상 화면에서는 강화 카드
    ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].forEach((code) => {
      const n = Number(code.slice(-1)) - 1;
      this.input.onPress(code, () => {
        if (this.state === 'levelup') this.levelUp.select(n);
        else if (this.state === 'playing' && n < 2 && this.weapons.selectSlot(n as 0 | 1, this.melee.busy)) this.audio.weaponSwitch();
      });
    });
    this.levelUp.onChoose = (choice) => this.chooseUpgrade(choice.def.id);
    this.levelUp.onOffer = (id, value) => this.decideWeaponReward(id, value);
    this.upgrades.onStatsChanged = (st) => this.applyStats(st);
    this.upgrades.onInstantEffect = (def) => {
      if (def.effect === 'heal') this.player.heal(def.value);
      if (def.effect === 'maxHealth') this.player.heal(def.value); // 강인함: 최대 체력 +20 과 함께 20 회복
    };
    this.input.onPress('KeyM', () => { this.audio.muted = !this.audio.muted; this.ui.setAudioSettings(this.audio.settings); this.ui.toast(this.audio.muted ? '소리 끔' : '소리 켬'); });

    this.ui.onStart = () => this.beginPlay();
    this.ui.onResume = () => this.beginPlay();
    this.ui.onRestart = () => this.restart();
    this.ui.onQuality = (level) => this.setQuality(level);
    this.ui.onVolume = (kind, v) => this.audio.setVolume(kind, v);
    this.ui.onMute = (m) => { this.audio.muted = m; };
    this.ui.setAudioSettings(this.audio.settings);
    // 설정: 난이도는 다음 판 시작부터, 흔들림 · 데미지 숫자는 즉시
    const save = () => { saveSettings(this.settings); this.ui.setGameSettings(this.settings); };
    this.ui.onDifficulty = (id) => { if (this.state === 'playing' || this.state === 'levelup') return; this.settings.difficulty = id; save(); };
    this.ui.onShake = (v) => { this.settings.shake = v; this.gameCamera.shakeScale = v; save(); };
    this.ui.onDamageNumbers = (on) => { this.settings.damageNumbers = on; if (!on) this.damageNumbers.clear(); save(); };
    this.gameCamera.shakeScale = this.settings.shake;
    this.ui.setGameSettings(this.settings);

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

  /**
   * 주변 소리 · 배경음 분위기 (프레임마다):
   * - 가까운 좀비 하나가 가끔 울음 (전체 간격 + AudioManager 중복 제한 → 여러 마리라도 동시에 몰리지 않음)
   * - 가까이 움직이는 탱커의 발소리
   * - 배경음 분위기: 보스 생존 → 보스전, 적이 많으면 전투, 아니면 평상시
   */
  private updateAmbientAudio(dt: number): void {
    const p = this.player.position;
    this.groanTimer -= dt;
    this.stepTimer -= dt;
    let near: Zombie | null = null;
    let nd = 1e9;
    let tank: Zombie | null = null;
    let td = 1e9;
    for (const z of this.zombies.zombies) {
      if (!z.alive || z.state === ZombieState.Spawn) continue;
      const d = Math.abs(z.position.x - p.x) + Math.abs(z.position.z - p.z);
      if (d < nd && z.stats.kind !== 'boss') { nd = d; near = z; }
      if (z.stats.kind === 'tank' && z.moveSpeed > 0.3 && d < td) { td = d; tank = z; }
    }
    if (this.groanTimer <= 0) {
      this.groanTimer = 1.8 + Math.random() * 2.2;
      if (near && nd < 18) {
        const pitch = near.stats.kind === 'runner' ? 1.5 : near.stats.kind === 'tank' ? 0.65 : near.stats.kind === 'exploder' ? 0.85 : 1;
        this.audio.zombieGroan(pitch, Math.max(0, 1 - nd / 18));
      }
    }
    if (tank && td < 14 && this.stepTimer <= 0) {
      this.stepTimer = 0.62;
      this.audio.tankStep(Math.max(0.2, 1 - td / 14));
    }
    const boss = this.zombies.boss;
    const alive = this.zombies.aliveCount;
    this.audio.setMood(boss ? 'boss' : alive > 10 ? 'combat' : 'calm');
    this.audio.update(dt, Math.min(1, alive / 30));
  }

  /** 생존 목표 패널: 다음 웨이브까지 · 다음 보스 · 현재 목표 · 최고 기록 */
  private updateObjective(bossAlive: boolean): void {
    const w = this.waves.wave;
    const c = BOSS_CONFIG;
    const nextBoss = w < c.firstWave ? c.firstWave : c.firstWave + Math.ceil((w + 1 - c.firstWave) / c.every) * c.every;
    const goal = bossAlive ? `보스 처치 — ${this.zombies.boss?.stats.name ?? ''}` : this.waves.time < 120 ? '조작에 익숙해지며 레벨을 올리세요' : `WAVE ${nextBoss} 보스에 대비하세요`;
    this.ui.setObjective({
      next: formatTime(this.waves.remaining),
      boss: bossAlive ? '보스 전투 중' : `WAVE ${nextBoss} (${nextBoss - w}웨이브 후)`,
      goal,
      best: formatTime(this.records.best.time),
      difficulty: DIFFICULTIES[this.settings.difficulty].label,
    });
  }

  /** 처치 경험치: 일반 경험치 결정으로 떨어뜨림. 큰 경험치(엘리트 · 보스)는 여러 개로 나눠 흩뿌림 */
  private dropXp(z: Zombie): void {
    const xp = z.stats.xp;
    if (xp <= 30) { this.orbs.spawn(z.position.x, z.position.z, xp); return; }
    const n = Math.min(10, Math.ceil(xp / 30));
    const r = 0.5 + z.stats.radius;
    let left = xp;
    for (let i = 0; i < n; i++) {
      const v = i === n - 1 ? left : Math.floor(xp / n);
      left -= v;
      const a = (i / n) * Math.PI * 2 + z.variant * 6;
      this.orbs.spawn(z.position.x + Math.sin(a) * r * (0.6 + (i % 2) * 0.4), z.position.z + Math.cos(a) * r * (0.6 + (i % 2) * 0.4), v);
    }
  }

  /** 엘리트 처치 추가 보상: 체력 조금 + 탄창 채움 (쿨다운 동안은 경험치만) */
  private rewardElite(z: Zombie): void {
    if (this.time - this.lastEliteReward < ELITE_REWARD.cooldown || this.player.dead) {
      this.ui.toast(`${z.stats.name} 처치 — 경험치 ${z.stats.xp}`);
      return;
    }
    this.lastEliteReward = this.time;
    this.eliteRewards++;
    const healed = this.player.heal(ELITE_REWARD.heal);
    if (ELITE_REWARD.refillAmmo) for (const id of this.weapons.slots) { const g = this.weapons.gun(id); if (!g.reloading) g.ammo = g.stats.magazineSize; }
    this.ui.toast(`${z.stats.name} 처치 — 경험치 ${z.stats.xp} · 체력 +${Math.round(healed)} · 탄창 보충`);
    this.audio.pickup();
  }

  /** 보스 처치 보상: 경험치(결정으로 이미 떨어짐) + 체력 회복(최대 체력까지) + 알림 + 확장 훅 */
  private rewardBoss(z: Zombie): void {
    this.audio.bossDeath();
    const healed = this.player.heal(BOSS_REWARD.heal);
    const reward: BossReward = { xp: z.stats.xp, heal: healed, items: [...BOSS_REWARD.items] };
    // 추가 선택 보상: 통합 보상 대기열에 1회 (레벨업 · 무기 보상과 같은 화면 흐름)
    if (!this.player.dead) this.rewards.addBoss(this.experience.levels.level);
    this.lastBossReward = reward;
    this.ui.showAlert('BOSS DEFEATED', `${z.stats.name} 처치 · 경험치 +${reward.xp} · 체력 +${Math.round(healed)}`, 'defeat');
    this.effects.bossRoar(z.position, 0xffc060);
    this.onBossDefeated?.(reward);
  }

  /** 적 특수 행동 사건 → 이펙트 · 사운드 · 화면 흔들림 */
  private onEnemyEvent(type: string, z: Zombie, value: number): void {
    const d = Math.hypot(z.position.x - this.player.position.x, z.position.z - this.player.position.z);
    const near = Math.max(0, 1 - d / 28);
    switch (type) {
      case 'prime': this.audio.primeWarning(z.stats.explode?.primeTime ?? 1.2); break;
      case 'dash': if (near > 0.3) this.audio.runnerScreech(); break;
      case 'spitWindup': if (near > 0.2) this.audio.spitterCharge(); break;
      case 'chargePrep': this.audio.bossChargePrep(z.stats.boss?.chargeWindup ?? 1.2); break;
      case 'explode':
        this.effects.explosion(z.position, z.stats.explode?.radius ?? 4);
        this.audio.explosion();
        this.gameCamera.shake(0.4 * near);
        break;
      case 'slam':
        this.effects.groundSlam(z.position, slamRadius(z), z.phase >= 2 ? 0xff2a40 : 0xff5a30);
        this.audio.thud(1.2);
        this.gameCamera.shake(0.45 * near);
        break;
      case 'bossSwing':
        this.effects.shockwave(z.position.x + Math.sin(z.yaw) * 2, z.position.z + Math.cos(z.yaw) * 2, 2.2, 0xffa060, 0.3, 0.6);
        this.audio.thud(0.6);
        this.gameCamera.shake((value ? 0.3 : 0.15) * near);
        break;
      case 'roar': this.audio.roar(false); break;
      case 'chargeStart': this.audio.thud(0.5); break;
      case 'chargeHit': this.gameCamera.shake(0.35); break;
      case 'chargeWall':
        this.effects.dustBurst(z.position, z.stats.radius * 2);
        this.effects.shockwave(z.position.x, z.position.z, 3, 0xffc080, 0.35, 0.5);
        this.audio.thud(1);
        this.gameCamera.shake(0.3 * near);
        break;
      case 'phase2':
        this.effects.bossRoar(z.position, 0xff2a40);
        this.audio.roar(true);
        this.ui.showAlert(z.stats.name, 'PHASE 2 — 분노', 'phase');
        this.gameCamera.shake(0.3);
        break;
    }
  }

  /** 시각 계층 갱신 + 렌더 (로직 상태는 읽기만 한다) */
  private renderFrame(dt: number, alpha: number, draw = true): void {
    const p = this.player;
    const pos = p.interpolatedPosition(alpha, this.renderPos);
    const yaw = p.interpolatedYaw(alpha);
    const aiming = this.controller.fire || this.time - this.lastShotTime < 1.2;
    const w = this.weapons;
    const m = this.melee;
    this.model.update(dt, {
      position: pos, aimYaw: yaw, velocity: p.velocity, aiming,
      reloading: this.weapon.reloading, reloadProgress: this.weapon.reloadProgress,
      gunId: w.currentId, switchFrom: w.switchFrom, switchProgress: w.switchProgress,
      meleeId: w.meleeId, meleeProgress: m.progress, swingId: m.swingId,
      swingHitFraction: m.swingDuration > 0 ? m.swingHitTime / m.swingDuration : 0.35,
    });

    if (dt > 0) {
      const strength = Math.min(1, Math.max(0, (p.aimDistance - 2) / 8));
      this.gameCamera.update(dt, pos, Math.sin(yaw), Math.cos(yaw), strength);
    }
    this.gameCamera.updateOcclusion(dt > 0 ? dt : 1, pos, this.world.occluders);
    this.world.updateShadow(this.gameCamera.focus);
    this.world.update(dt, this.gameCamera.focus);

    this.projectiles.render(alpha);
    this.zombieRenderer.update(dt, this.zombies.zombies, alpha, this.gameCamera.camera);
    this.enemyShots.render(alpha);
    this.telegraphs.update(dt, this.zombies.zombies, this.zombies.context);
    const boss = this.zombies.boss;
    this.ui.setBoss(boss ? { name: boss.stats.name, health: boss.health, maxHealth: boss.maxHealth, phase: boss.phase } : null);
    this.updateObjective(boss !== null);
    if (this.state === 'playing') this.threats.update(this.zombies.zombies, this.gameCamera.camera, window.innerWidth, window.innerHeight);
    else this.threats.clear();
    this.effects.update(dt, this.gameCamera.camera);

    this.ui.setWaveStatus(this.waves.wave, this.waves.time, this.zombies.aliveCount);
    const lv = this.experience.levels;
    this.ui.setXp(lv.level, lv.xp, lv.required);
    this.ui.setUpgrades(this.upgradeSummary());
    this.orbs.render();
    this.spread *= Math.exp(-6 * dt);
    const cur = this.weapon;
    this.ui.update(dt, {
      health: p.health, maxHealth: p.maxHealth, ammo: cur.ammo, magazineSize: cur.stats.magazineSize, weaponName: cur.stats.name,
      reloading: cur.reloading, reloadProgress: cur.reloadProgress, spread: this.spread,
    });
    this.ui.setLoadout(this.loadoutSlots(), this.meleeSlot());

    this.damageNumbers.update(dt, this.gameCamera.camera, window.innerWidth, window.innerHeight);
    if (draw) {
      this.gameCamera.applyShake();
      this.renderer.render(this.scene, this.gameCamera.camera);
      this.gameCamera.restoreShake();
    }
  }

  /** HUD 총기 슬롯 2칸 */
  private loadoutSlots(): LoadoutSlot[] {
    const w = this.weapons;
    return w.slots.map((id, i) => {
      const g = w.gun(id);
      const lv = w.gunMastery.level(id);
      const active = i === w.active;
      return {
        name: GUNS[id].name, ammo: g.reloading ? '재장전' : `${g.ammo}/${g.stats.magazineSize}`,
        mastery: `숙련 Lv${lv}${lv > 1 ? ` (+${(lv - 1) * 5}%)` : ''}`, active,
        state: g.reloading ? 'reloading' : 'idle',
        bar: g.reloading ? g.reloadProgress : active && w.switching ? 1 - (w.switchProgress < 0 ? 1 : w.switchProgress) : w.gunMastery.progress(id) * (lv < MASTERY.maxLevel ? 1 : 0),
      };
    });
  }

  /** HUD 근접 칸 */
  private meleeSlot(): LoadoutSlot {
    const w = this.weapons;
    const m = this.melee;
    const lv = w.meleeMastery.level(w.meleeId);
    const ready = m.cooldown <= 0 && !m.busy;
    return {
      name: MELEE[w.meleeId].name, ammo: m.busy ? '공격 중' : ready ? '준비' : `${m.cooldown.toFixed(1)}초`,
      mastery: `숙련 Lv${lv}${lv > 1 ? ` (+${(lv - 1) * 5}%)` : ''}`, active: false,
      state: ready ? 'ready' : 'cooldown', bar: ready ? 1 : 1 - m.cooldownRatio,
    };
  }

  private debugRows(): [string, string][] {
    const p = this.player;
    const info = this.renderer.info;
    return [
      ['FPS', `${this.debug.fps.toFixed(0)} (${this.debug.frameMs.toFixed(1)}ms, 최악 ${this.debug.worstMs.toFixed(0)}ms)`],
      ['CPU 시간', `${this.cpuMs.toFixed(2)}ms / 프레임`],
      ['그래픽', `${QUALITY_PRESETS[this.quality].label} · 그림자 ${this.renderer.shadowMap.enabled ? 'ON' : 'OFF'}${this.resLock ? ' · 해상도 고정' : ''}`],
      ['GPU', this.gpuName],
      ['상태', `${this.state} · 난이도 ${DIFFICULTIES[this.settings.difficulty].label} · 보상 대기 ${this.rewards.length}`],
      ['무기', `${GUNS[this.weapons.currentId].name} (${this.weapons.slots.map((id) => GUNS[id].name).join(' / ')}) · ${MELEE[this.weapons.meleeId].name}`],
      ['위치', `${p.position.x.toFixed(2)}, ${p.position.z.toFixed(2)}`],
      ['속도', `${p.speed.toFixed(2)} / 벽 ${p.touchingWall ? '접촉' : '-'}`],
      ['조준 각도', `${THREE.MathUtils.radToDeg(p.aimYaw).toFixed(1)}° (${p.aimDistance.toFixed(1)}m)`],
      ['탄약', `${this.weapon.ammo}/${this.weapon.stats.magazineSize}${this.weapon.reloading ? ' 재장전' : ''}`],
      ['발사 누적', String(this.weapon.shotsFired)],
      ['투사체', `${this.projectiles.activeCount} / 풀 ${this.projectiles.capacity}`],
      ['파티클', String(this.effects.particleCount)],
      ['체력', `${p.health}/${p.maxHealth}${p.invulnerable > 0 ? ' 무적' : ''} · 받은 피해 ${p.damageTaken} · 막힘 ${p.blockedHits}`],
      ['레벨', `${this.experience.levels.level} · ${this.experience.levels.xp}/${this.experience.levels.required} XP · 대기 ${this.experience.levels.pending} · 결정 ${this.orbs.count}개(${this.orbs.totalValue}XP)`],
      ['총기 능력치', (() => { const st = this.weapon.stats; return `${st.name}: 피해 ${st.damage.toFixed(1)}${st.pellets > 1 ? `×${st.pellets}` : ''} · 연사 ${st.fireRate.toFixed(1)} · 탄창 ${st.magazineSize} · 장전 ${st.reloadTime.toFixed(2)}s · 관통 ${st.pierce} · 치명 ${Math.round(this.weapons.mods.critChance * 100)}%`; })()],
      ['근접 능력치', (() => { const st = this.weapons.meleeStats; return `${MELEE[this.weapons.meleeId].name}: 피해 ${st.damage.toFixed(1)} · 간격 ${st.interval.toFixed(2)}s · 사거리 ${st.range.toFixed(2)} · ${st.arcDeg}° · ${st.maxTargets}마리 · 넉백 ${st.knockback.toFixed(1)}`; })()],
      ['웨이브', `${this.waves.wave} (${formatTime(this.waves.time)}) · 간격 ${this.zombies.difficulty.spawnInterval}s · 상한 ${this.zombies.difficulty.maxAlive} · 체력 ×${this.zombies.difficulty.healthMultiplier}`],
      ['좀비', `생존 ${this.zombies.aliveCount} · 시체 ${this.zombies.corpseCount} · 처치 ${this.zombies.kills} · 생성 ${this.zombies.spawned} · 화면 밖 ${this.zombieRenderer.culled}`],
      ['적 종류', (['runner', 'spitter', 'tank', 'exploder'] as const).map((k) => `${k} ${this.zombies.aliveOf(k)}`).join(' · ') + ` · 엘리트 ${this.zombies.eliteAlive} · 보스 ${this.zombies.boss ? `${Math.ceil(this.zombies.boss.health)} P${this.zombies.boss.phase}` : '-'}`],
      ['적 투사체', `${this.enemyShots.activeCount} (발사 ${this.enemyShots.stats.fired} · 명중 ${this.enemyShots.stats.hitPlayer} · 벽 ${this.enemyShots.stats.hitWall})`],
      ['분리 검사', `${this.zombies.separationPairs}쌍 / 스텝 (격자)`],
      ['AI 시간', `${this.zombies.aiMs.toFixed(3)}ms / 스텝 · 경로 ${this.zombies.nav.lastBuildMs.toFixed(2)}ms (${this.zombies.nav.builds}회)`],
      ['렌더 배율', `${this.pixelRatio.toFixed(2)} (${this.renderer.domElement.width}×${this.renderer.domElement.height})`],
      ['드로우콜', String(info.render.calls)],
      ['삼각형', info.render.triangles.toLocaleString()],
      ['카메라', `${CAMERA_CONFIG.pitchDeg}° / ${CAMERA_CONFIG.distance}m`],
    ];
  }
}

const QUALITY_KEY = 'project-dead-zone.quality';
/** 흡혈 초당 최대 회복량 */
const LIFESTEAL_PER_SEC = 12;

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

function round1(v: number): string {
  return String(Math.round(v * 10) / 10);
}
