import * as THREE from 'three';
import { DIFFICULTIES, DifficultyDef, EnemyKind, NAV_CONFIG, SPAWN_CONFIG, WaveParams, ZOMBIE_TYPES, ZombieStats, waveParams } from '../config/GameConfig';
import { BOSS_CONFIG, ELITE_CONFIG, ENEMY_TYPES, SPAWN_EXTRA_DISTANCE, SPAWN_TABLE, bossStats, eliteChance, makeElite, scaleForWave, spawnCap, spawnWeight } from './EnemyData';
import { ENEMY_BEHAVIORS } from './EnemyBehaviors';
import { DamageableRegistry } from '../combat/Damageable';
import { CollisionWorld } from '../world/Collision';
import { NavGrid } from '../world/NavGrid';
import { AttackTarget, EnemyEvents, Zombie, ZombieContext, ZombieState } from './Zombie';

type SpawnKind = Exclude<EnemyKind, 'boss'>;
const SPAWN_KINDS = Object.keys(SPAWN_TABLE) as SpawnKind[];

/** 행동 모듈이 게임에 알릴 곳이 없을 때 (테스트 등) */
const NO_EVENTS: EnemyEvents = { canSpit: () => true, spit: () => {}, emit: () => {} };

/** 이 거리보다 먼 좀비는 AI 를 절반 빈도(60Hz)로 갱신 (화면 밖이라 차이가 보이지 않음) */
const FAR_AI_DISTANCE = 30;
/** 분리 격자 칸 크기: 가장 큰 쌍(보스 1.25 + 탱커 엘리트 0.8)의 반경 합보다 크게 */
const SEPARATION_CELL = 2.6;

/**
 * 좀비 집단 관리: 웨이브 난이도에 따른 생성, AI 갱신, 좀비끼리 겹침 방지, 시체 정리, 객체 풀.
 * - 경로 탐색 흐름장은 플레이어 칸이 바뀔 때만, 최대 NAV_CONFIG.refreshInterval 주기로 갱신
 * - 죽은 좀비는 피해 판정 목록에서 빠지고 일정 시간 뒤 풀로 돌아간다 (시체 무한 누적 없음)
 */
export class ZombieManager {
  readonly zombies: Zombie[] = [];
  private readonly pool: Zombie[] = [];
  readonly nav: NavGrid;
  kills = 0;
  spawned = 0;
  private spawnTimer: number = SPAWN_CONFIG.firstDelay;
  private navTimer = 0;
  private readonly ctx: ZombieContext;
  private readonly ndc = new THREE.Vector3();
  /** 마지막 AI 갱신 비용 (ms, 디버그) */
  aiMs = 0;
  /** 생성 지점을 못 찾아 미룬 횟수 (디버그) */
  spawnMisses = 0;

  onKilled: ((z: Zombie) => void) | null = null;
  onSpawned: ((z: Zombie) => void) | null = null;
  /** 폭발 좀비가 자폭해 사라짐 (처치 아님: 경험치 · 처치 수 없음) */
  onSelfDestruct: ((z: Zombie) => void) | null = null;
  /** 종류별 생성 수 (테스트 · 디버그) */
  readonly spawnedByKind: Record<string, number> = {};
  /** 처치한 엘리트 · 보스 수 */
  eliteKills = 0;
  bossKills = 0;
  /** false 면 자동 생성 중지 (테스트 · 디버그) */
  spawningEnabled = true;
  /** 생성 위치 선택용 난수 (테스트에서 고정 가능) */
  random: () => number = Math.random;
  /** 현재 웨이브 난이도 (생성 간격 · 상한 · 능력치 배율) */
  difficulty: WaveParams = waveParams(1);
  private scaledStats: ZombieStats = ZOMBIE_TYPES.walker;
  /** 현재 웨이브 배율을 적용한 종류별 능력치 */
  private readonly scaledKinds: Partial<Record<EnemyKind, ZombieStats>> = {};
  private stepIndex = 0;
  /** 마지막 생성 간격 기록 (테스트 · 디버그) */
  readonly spawnTimes: number[] = [];

  constructor(
    private readonly collision: CollisionWorld,
    private readonly registry: DamageableRegistry,
    target: AttackTarget,
  ) {
    this.nav = new NavGrid(collision);
    this.ctx = { target, nav: this.nav, collision, time: 0, events: NO_EVENTS, behaviors: ENEMY_BEHAVIORS };
  }

  /** 특수 행동이 사건(사격 · 폭발 · 보스 패턴)을 알릴 곳 */
  set events(e: EnemyEvents) {
    this.ctx.events = e;
  }

  /** 행동 모듈 · 위험 범위 계산용 공용 정보 (읽기 전용으로 사용) */
  get context(): ZombieContext {
    return this.ctx;
  }

  /** 살아 있는 보스 (없으면 null) */
  get boss(): Zombie | null {
    for (const z of this.zombies) if (z.alive && z.stats.kind === 'boss') return z;
    return null;
  }

  /** 종류별 살아 있는 수 */
  aliveOf(kind: EnemyKind): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive && z.stats.kind === kind) n++;
    return n;
  }

  get eliteAlive(): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive && z.stats.elite) n++;
    return n;
  }

  get aliveCount(): number {
    let n = 0;
    for (const z of this.zombies) if (z.alive) n++;
    return n;
  }

  get corpseCount(): number {
    return this.zombies.length - this.aliveCount;
  }

  /** 다시 시작: 모든 좀비 제거 · 처치 수 · 생성 타이머 초기화 */
  reset(): void {
    for (const z of this.zombies) this.release(z);
    this.zombies.length = 0;
    this.kills = 0;
    this.spawned = 0;
    this.eliteKills = 0;
    this.bossKills = 0;
    for (const k of Object.keys(this.spawnedByKind)) delete this.spawnedByKind[k];
    this.spawnTimer = SPAWN_CONFIG.firstDelay;
    this.navTimer = 0;
    this.spawnTimes.length = 0;
    this.setDifficulty(waveParams(1));
    this.nav.update(this.ctx.target.position.x, this.ctx.target.position.z, true);
  }

  /**
   * 웨이브 난이도 적용. 이미 살아 있는 좀비는 그대로 두고 (갑자기 강해지거나 사라지지 않음)
   * 이후 생성되는 좀비부터 새 체력 · 속도를 가진다.
   */
  setDifficulty(params: WaveParams): void {
    this.difficulty = params;
    const base = ZOMBIE_TYPES.walker;
    this.scaledStats = this.withMode(scaleForWave(base, params.healthMultiplier, params.speedMultiplier));
    this.scaledKinds.walker = this.scaledStats;
    for (const k of SPAWN_KINDS) if (k !== 'walker') this.scaledKinds[k] = this.withMode(scaleForWave(ENEMY_TYPES[k], params.healthMultiplier, params.speedMultiplier));
    // 첫 생성 대기 중이 아니면, 남은 대기 시간이 새 간격보다 길지 않게
    if (this.spawned > 0 && this.spawnTimer > params.spawnInterval) this.spawnTimer = params.spawnInterval;
  }

  /** 난이도 (적 피해 · 생성량 · 특수 비율). 판 시작 때 정하고 판 중에는 바꾸지 않는다 */
  mode: DifficultyDef = DIFFICULTIES.normal;

  setMode(def: DifficultyDef): void {
    this.mode = def;
    this.setDifficulty(this.difficulty);
  }

  /** 난이도 피해 배율 적용 (근접 · 원거리 · 폭발) */
  private withMode(st: ZombieStats): ZombieStats {
    const k = this.mode.enemyDamage;
    if (k === 1) return st;
    return {
      ...st,
      attackDamage: +(st.attackDamage * k).toFixed(2),
      explode: st.explode ? { ...st.explode, damage: +(st.explode.damage * k).toFixed(2) } : undefined,
    };
  }

  /** 현재 웨이브 기준 좀비 능력치 */
  get currentStats(): ZombieStats {
    return this.scaledStats;
  }

  /** 현재 웨이브 기준 종류별 능력치 (엘리트 변형 선택) */
  statsFor(kind: SpawnKind, elite = false): ZombieStats {
    const base = this.scaledKinds[kind] ?? this.withMode(scaleForWave(ENEMY_TYPES[kind], this.difficulty.healthMultiplier, this.difficulty.speedMultiplier));
    return elite ? makeElite(base) : base;
  }

  /** 보스가 살아 있으면 일반 좀비 수 · 생성 간격 조정 */
  get effectiveMaxAlive(): number {
    const base = Math.round(this.difficulty.maxAlive * this.mode.maxAlive);
    return this.boss ? Math.max(4, Math.floor(base * BOSS_CONFIG.aliveMaxMul)) : base;
  }

  get effectiveInterval(): number {
    const base = this.difficulty.spawnInterval * this.mode.spawnInterval;
    return this.boss ? base * BOSS_CONFIG.intervalMul : base;
  }

  /**
   * 이번 생성의 종류: 해금된 종류의 가중치로 무작위 선택, 동시 출현 상한에 걸린 종류는 제외.
   * 웨이브 7 이후 일정 확률로 엘리트 (동시 엘리트 수 제한).
   */
  pickSpawn(): ZombieStats {
    const wave = this.difficulty.wave;
    let total = 0;
    const weights: number[] = [];
    for (const k of SPAWN_KINDS) {
      let w = spawnWeight(k, wave) * (k === 'walker' ? 1 : this.mode.specialWeight);
      if (w > 0 && k !== 'walker' && this.aliveOf(k) >= spawnCap(k, wave)) w = 0;
      weights.push(w);
      total += w;
    }
    let r = this.random() * total;
    let kind: SpawnKind = 'walker';
    for (let i = 0; i < SPAWN_KINDS.length; i++) {
      r -= weights[i];
      if (r <= 0 && weights[i] > 0) { kind = SPAWN_KINDS[i]; break; }
    }
    const maxElite = wave >= ELITE_CONFIG.lateWave ? ELITE_CONFIG.maxAliveLate : ELITE_CONFIG.maxAlive;
    const elite = ELITE_CONFIG.kinds.includes(kind) && this.eliteAlive < maxElite && this.random() < eliteChance(wave) * this.mode.eliteChance;
    return this.statsFor(kind, elite);
  }

  /** 종류를 지정해 생성 (위치 지정: 조건 검사 없음 · 테스트 · 디버그) */
  spawnKind(kind: EnemyKind, x: number, z: number, opts: { elite?: boolean; bossIndex?: number } = {}): Zombie {
    const stats = kind === 'boss' ? bossStats(opts.bossIndex ?? 1) : this.statsFor(kind, opts.elite);
    return this.spawnAt(x, z, stats);
  }

  /**
   * 보스 생성: 안전한 위치(플레이어에서 BOSS_CONFIG.minDistance 이상, 주변이 넓고 경로가 있는 곳).
   * 이미 살아 있는 보스가 있으면 생성하지 않는다 (null). 화면 안이어도 되며 땅에서 천천히 올라온다.
   */
  spawnBoss(index: number, camera: THREE.Camera): Zombie | null {
    if (this.boss) return null;
    const stats = this.withMode(bossStats(index));
    const c = BOSS_CONFIG;
    const p = this.ctx.target.position;
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 120; attempt++) {
      const a = this.random() * Math.PI * 2;
      const d = c.minDistance + this.random() * (c.maxDistance - c.minDistance);
      const x = p.x + Math.sin(a) * d;
      const z = p.z + Math.cos(a) * d;
      if (Math.abs(x) > this.collision.bound - c.clearance || Math.abs(z) > this.collision.bound - c.clearance) continue;
      if (!this.nav.isFree(x, z)) continue;
      if (this.collision.overlapsCircle(x, z, c.clearance)) continue;
      const path = this.nav.pathDistance(x, z);
      if (!Number.isFinite(path) || path > d * 2) continue;
      // 화면 안에 보이는 쪽을 약간 선호 (등장 연출이 보이도록), 경로가 직선에 가까울수록 선호
      const score = (this.onScreen(x, z, camera) ? 1 : 0) - (path / d) + this.random() * 0.5;
      if (score > bestScore) { bestScore = score; best = [x, z]; }
    }
    if (!best) return null;
    return this.spawnAt(best[0], best[1], stats);
  }

  /** 게임 로직 스텝 (고정 간격) */
  step(dt: number, time: number, camera: THREE.Camera, allowSpawn = true): void {
    const t0 = performance.now();
    this.ctx.time = time;
    const target = this.ctx.target;

    // 흐름장 갱신 (플레이어가 다른 칸으로 옮겼을 때만, 주기 제한)
    this.navTimer -= dt;
    if (this.navTimer <= 0) {
      if (this.nav.update(target.position.x, target.position.z)) this.navTimer = NAV_CONFIG.refreshInterval;
    }

    // 생성
    if (allowSpawn && this.spawningEnabled) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        if (this.aliveCount - (this.boss ? 1 : 0) < this.effectiveMaxAlive) {
          if (this.trySpawn(this.pickSpawn(), camera)) {
            this.spawnTimer += this.effectiveInterval;
            this.spawnTimes.push(time);
            if (this.spawnTimes.length > 200) this.spawnTimes.shift();
          }
          else { this.spawnMisses++; this.spawnTimer = 0.25; } // 자리가 없으면 잠시 후 재시도
        } else {
          this.spawnTimer = 0; // 자리가 나면 바로 생성
        }
      }
    }

    // AI: 가까운 좀비는 매 스텝, 먼 좀비는 두 스텝에 한 번 (dt 2배로)
    this.stepIndex++;
    const odd = (this.stepIndex & 1) === 1;
    for (const z of this.zombies) {
      const wasAlive = z.alive;
      const far = z.alive && Math.abs(z.position.x - target.position.x) + Math.abs(z.position.z - target.position.z) > FAR_AI_DISTANCE * 1.2;
      if (far) {
        if (((z.id & 1) === 1) !== odd) continue; // 좀비마다 번갈아 → 부하 분산
        z.step(dt * 2, this.ctx);
      } else {
        z.step(dt, this.ctx);
      }
      if (wasAlive && !z.alive) this.handleDeath(z);
    }

    this.separate();
    for (const z of this.zombies) z.syncHitShape();
    this.cleanupCorpses();
    this.aiMs = this.aiMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  /** 총알 피해 후 호출: 이번에 죽었으면 처치 처리 */
  notifyDamaged(z: Zombie): void {
    if (!z.alive && z.deadTime === 0 && !this.countedDeaths.has(z.id)) this.handleDeath(z);
  }

  private readonly countedDeaths = new Set<number>();

  private handleDeath(z: Zombie): void {
    if (this.countedDeaths.has(z.id)) return;
    this.countedDeaths.add(z.id);
    if (z.exploded) {
      // 자폭: 처치가 아니므로 처치 수 · 경험치 없음
      this.registry.remove(z);
      this.onSelfDestruct?.(z);
      return;
    }
    this.kills++;
    if (z.stats.elite) this.eliteKills++;
    if (z.stats.kind === 'boss') this.bossKills++;
    this.registry.remove(z); // 죽은 좀비는 더 이상 총알 판정 대상이 아님
    this.onKilled?.(z);
  }

  /**
   * 생성 위치 선택:
   * 1) 필수 조건 — 플레이어에서 일정 거리 밖, 맵 안, 이동 가능한 칸, 장애물과 겹치지 않음,
   *    플레이어까지 경로가 있음, 카메라 화면 밖, 다른 좀비와 겹치지 않음
   * 2) 조건을 만족하는 후보 여러 개 중 점수가 높은 곳:
   *    - 좀비가 적은 방향 우선 → 여러 방향에서 고르게 접근 (한쪽에서만 몰려오지 않음)
   *    - 플레이어가 달려가는 정면 바로 앞은 피함 → 피할 수 없는 상황 방지
   *    - 너무 멀지도 가깝지도 않은 거리 선호, 약간의 무작위성으로 매번 다른 위치
   * 조건을 만족하는 곳이 없으면 생성하지 않는다 (화면 안이나 장애물 안에 갑자기 나타나지 않음).
   */
  private trySpawn(stats: ZombieStats, camera: THREE.Camera): boolean {
    const target = this.ctx.target;
    const p = target.position;
    const c = SPAWN_CONFIG;
    const v = target.velocity;
    const speed = v ? Math.hypot(v.x, v.z) : 0;
    let bestScore = -Infinity;
    let bx = 0;
    let bz = 0;
    let found = 0;
    for (let attempt = 0; attempt < 60 && found < 8; attempt++) {
      const a = this.random() * Math.PI * 2;
      const minD = c.minDistance + (SPAWN_EXTRA_DISTANCE[stats.kind] ?? 0);
      const d = minD + this.random() * (c.maxDistance - minD);
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const x = p.x + dx * d;
      const z = p.z + dz * d;
      if (Math.abs(x) > this.collision.bound - 1 || Math.abs(z) > this.collision.bound - 1) continue;
      if (!this.nav.isFree(x, z)) continue;
      if (this.collision.overlapsCircle(x, z, stats.radius + 0.1)) continue;
      const path = this.nav.pathDistance(x, z);
      if (!Number.isFinite(path) || path > d * 2.5) continue;
      if (this.onScreen(x, z, camera)) continue;
      if (this.zombies.some((o) => o.alive && Math.hypot(o.position.x - x, o.position.z - z) < 1.2)) continue;
      found++;
      // 같은 방향(±40°)에 이미 있는 좀비 수
      let crowd = 0;
      for (const o of this.zombies) {
        if (!o.alive) continue;
        const ox = o.position.x - p.x;
        const oz = o.position.z - p.z;
        const ol = Math.hypot(ox, oz) || 1;
        if ((ox * dx + oz * dz) / ol > 0.77) crowd++;
      }
      let score = -crowd * 0.8 - Math.abs(d - 24) * 0.08 + this.random() * 1.2;
      if (speed > 1 && v) {
        const ahead = (v.x * dx + v.z * dz) / speed;
        if (ahead > 0.85) score -= 2.5;
      }
      if (score > bestScore) { bestScore = score; bx = x; bz = z; }
    }
    if (found === 0) return false;
    this.spawnAt(bx, bz, stats);
    return true;
  }

  /** 지정 위치에 좀비 생성 (생성 조건 검사 없음: 테스트 · 디버그 · 향후 이벤트용) */
  spawnAt(x: number, z: number, stats: ZombieStats = this.scaledStats): Zombie {
    const p = this.ctx.target.position;
    const zb = this.pool.pop() ?? new Zombie();
    zb.reset(stats, x, z, Math.atan2(p.x - x, p.z - z));
    this.zombies.push(zb);
    this.registry.add(zb);
    this.spawned++;
    this.spawnedByKind[stats.kind] = (this.spawnedByKind[stats.kind] ?? 0) + 1;
    if (stats.elite) this.spawnedByKind.elite = (this.spawnedByKind.elite ?? 0) + 1;
    this.onSpawned?.(zb);
    return zb;
  }

  /** 발끝과 머리 높이 둘 다 화면 밖이어야 화면 밖으로 인정 */
  private onScreen(x: number, z: number, camera: THREE.Camera): boolean {
    const m = SPAWN_CONFIG.offscreenMargin;
    for (const y of [0, 1.8]) {
      this.ndc.set(x, y, z).project(camera);
      if (this.ndc.z < 1 && Math.abs(this.ndc.x) < m && Math.abs(this.ndc.y) < m) return true;
    }
    return false;
  }

  /** 분리 처리용 격자 (칸 크기 = 가장 큰 두 몸 반경 합 이상 → 주변 3×3 칸만 검사) */
  private readonly grid = new Map<number, Zombie[]>();
  private readonly gridPool: Zombie[][] = [];
  /** 마지막 분리 처리에서 검사한 쌍 수 (디버그 · 테스트) */
  separationPairs = 0;

  private gridKey(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  /**
   * 좀비끼리 · 좀비와 플레이어가 겹치지 않도록 밀어냄 (플레이어는 밀리지 않음 → 조작감 유지).
   * 8단계: 모든 쌍(n²) 대신 격자 이웃만 검사. 결과(밀어내는 양)는 이전과 같다.
   */
  private separate(): void {
    const list = this.zombies;
    const target = this.ctx.target;
    const cell = SEPARATION_CELL;
    this.separationPairs = 0;
    for (let iter = 0; iter < 2; iter++) {
      // 격자 채우기
      for (const arr of this.grid.values()) { arr.length = 0; this.gridPool.push(arr); }
      this.grid.clear();
      for (const z of list) {
        if (!z.alive) continue;
        const key = this.gridKey(Math.floor(z.position.x / cell), Math.floor(z.position.z / cell));
        let arr = this.grid.get(key);
        if (!arr) { arr = this.gridPool.pop() ?? []; this.grid.set(key, arr); }
        arr.push(z);
      }
      for (const a of list) {
        if (!a.alive) continue;
        const cx = Math.floor(a.position.x / cell);
        const cz = Math.floor(a.position.z / cell);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const arr = this.grid.get(this.gridKey(cx + ox, cz + oz));
            if (!arr) continue;
            for (const b of arr) {
              if (b.id <= a.id) continue; // 쌍마다 한 번
              this.separationPairs++;
              const dx = b.position.x - a.position.x;
              const dz = b.position.z - a.position.z;
              const min = a.radius + b.radius;
              const d2 = dx * dx + dz * dz;
              if (d2 >= min * min) continue;
              const d = Math.sqrt(d2) || 1e-4;
              const nx = d2 > 1e-8 ? dx / d : Math.cos(a.id);
              const nz = d2 > 1e-8 ? dz / d : Math.sin(a.id);
              const pen = (min - d) * 0.5;
              // 공격 중인 좀비 · 무거운 좀비(탱커 · 보스)는 덜 밀림
              const wa = (a.state === ZombieState.Attack || a.state === ZombieState.Special ? 0.3 : 1) / a.stats.mass;
              const wb = (b.state === ZombieState.Attack || b.state === ZombieState.Special ? 0.3 : 1) / b.stats.mass;
              const sum = wa + wb;
              a.position.x -= nx * pen * 2 * (wa / sum);
              a.position.z -= nz * pen * 2 * (wa / sum);
              b.position.x += nx * pen * 2 * (wb / sum);
              b.position.z += nz * pen * 2 * (wb / sum);
            }
          }
        }
        // 플레이어와 겹침
        const dx = a.position.x - target.position.x;
        const dz = a.position.z - target.position.z;
        const min = a.radius + target.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && target.isAlive()) {
          const d = Math.sqrt(d2) || 1e-4;
          a.position.x = target.position.x + (dx / d) * min;
          a.position.z = target.position.z + (dz / d) * min;
        }
      }
      // 밀려서 벽에 박히지 않도록
      for (const z of list) if (z.alive) this.collision.resolveCircle(z.position, z.radius, this.push);
    }
  }

  private readonly push = { hit: false, nx: 0, nz: 0 };

  /** 시체: corpseTime 뒤 가라앉아 제거. 시체가 너무 많으면 오래된 것부터 먼저 정리 */
  private cleanupCorpses(): void {
    let corpses = 0;
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      if (z.alive) continue;
      corpses++;
      if (corpses > SPAWN_CONFIG.maxCorpses && !z.sinking) { z.sinking = true; z.deadTime = Math.max(z.deadTime, z.stats.corpseTime); }
      if (z.deadTime >= z.stats.corpseTime) z.sinking = true;
      if (z.deadTime >= z.stats.corpseTime + (z.exploded ? 0 : 1.2)) {
        this.zombies.splice(i, 1);
        this.release(z);
      }
    }
  }

  private release(z: Zombie): void {
    this.registry.remove(z);
    this.countedDeaths.delete(z.id);
    this.pool.push(z);
  }
}
