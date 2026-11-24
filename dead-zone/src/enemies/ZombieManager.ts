import * as THREE from 'three';
import { NAV_CONFIG, SPAWN_CONFIG, ZOMBIE_TYPES, ZombieStats } from '../config/GameConfig';
import { DamageableRegistry } from '../combat/Damageable';
import { CollisionWorld } from '../world/Collision';
import { NavGrid } from '../world/NavGrid';
import { AttackTarget, Zombie, ZombieContext, ZombieState } from './Zombie';

/**
 * 좀비 집단 관리: 테스트용 생성(일정 간격), AI 갱신, 좀비끼리 겹침 방지, 시체 정리, 객체 풀.
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
  /** false 면 자동 생성 중지 (테스트 · 디버그) */
  spawningEnabled = true;
  /** 생성 위치 선택용 난수 (테스트에서 고정 가능) */
  random: () => number = Math.random;

  constructor(
    private readonly collision: CollisionWorld,
    private readonly registry: DamageableRegistry,
    target: AttackTarget,
  ) {
    this.nav = new NavGrid(collision);
    this.ctx = { target, nav: this.nav, collision, time: 0 };
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
    this.spawnTimer = SPAWN_CONFIG.firstDelay;
    this.navTimer = 0;
    this.nav.update(this.ctx.target.position.x, this.ctx.target.position.z, true);
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
        if (this.aliveCount < SPAWN_CONFIG.maxAlive) {
          if (this.trySpawn(ZOMBIE_TYPES.walker, camera)) this.spawnTimer += SPAWN_CONFIG.interval;
          else { this.spawnMisses++; this.spawnTimer = 0.25; } // 자리가 없으면 잠시 후 재시도
        } else {
          this.spawnTimer = 0; // 자리가 나면 바로 생성
        }
      }
    }

    // AI
    for (const z of this.zombies) {
      const wasAlive = z.alive;
      z.step(dt, this.ctx);
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
    this.kills++;
    this.registry.remove(z); // 죽은 좀비는 더 이상 총알 판정 대상이 아님
    this.onKilled?.(z);
  }

  /**
   * 생성 위치: 플레이어로부터 일정 거리 밖, 카메라 화면 밖, 이동 가능한 칸, 플레이어까지 경로가 있는 곳.
   * 조건을 만족하는 곳이 없으면 생성하지 않는다 (화면 안이나 장애물 안에 갑자기 나타나지 않음).
   */
  private trySpawn(stats: ZombieStats, camera: THREE.Camera): boolean {
    const p = this.ctx.target.position;
    const c = SPAWN_CONFIG;
    for (let attempt = 0; attempt < 40; attempt++) {
      const a = this.random() * Math.PI * 2;
      const d = c.minDistance + this.random() * (c.maxDistance - c.minDistance);
      const x = p.x + Math.sin(a) * d;
      const z = p.z + Math.cos(a) * d;
      if (Math.abs(x) > this.collision.bound - 1 || Math.abs(z) > this.collision.bound - 1) continue;
      if (!this.nav.isFree(x, z)) continue;
      if (this.collision.overlapsCircle(x, z, stats.radius + 0.1)) continue;
      const path = this.nav.pathDistance(x, z);
      if (!Number.isFinite(path) || path > d * 2.5) continue;
      if (this.onScreen(x, z, camera)) continue;
      if (this.zombies.some((o) => o.alive && Math.hypot(o.position.x - x, o.position.z - z) < 1.2)) continue;
      this.spawnAt(x, z, stats);
      return true;
    }
    return false;
  }

  /** 지정 위치에 좀비 생성 (생성 조건 검사 없음: 테스트 · 디버그 · 향후 이벤트용) */
  spawnAt(x: number, z: number, stats: ZombieStats = ZOMBIE_TYPES.walker): Zombie {
    const p = this.ctx.target.position;
    const zb = this.pool.pop() ?? new Zombie();
    zb.reset(stats, x, z, Math.atan2(p.x - x, p.z - z));
    this.zombies.push(zb);
    this.registry.add(zb);
    this.spawned++;
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

  /** 좀비끼리 · 좀비와 플레이어가 겹치지 않도록 밀어냄 (플레이어는 밀리지 않음 → 조작감 유지) */
  private separate(): void {
    const list = this.zombies;
    const target = this.ctx.target;
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (!b.alive) continue;
          const dx = b.position.x - a.position.x;
          const dz = b.position.z - a.position.z;
          const min = a.radius + b.radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 1e-4;
          const nx = d2 > 1e-8 ? dx / d : Math.cos(a.id);
          const nz = d2 > 1e-8 ? dz / d : Math.sin(a.id);
          const pen = (min - d) * 0.5;
          // 공격 중인 좀비는 덜 밀림 (공격 자세 유지)
          const wa = a.state === ZombieState.Attack ? 0.3 : 1;
          const wb = b.state === ZombieState.Attack ? 0.3 : 1;
          const sum = wa + wb;
          a.position.x -= nx * pen * 2 * (wa / sum);
          a.position.z -= nz * pen * 2 * (wa / sum);
          b.position.x += nx * pen * 2 * (wb / sum);
          b.position.z += nz * pen * 2 * (wb / sum);
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
      if (z.deadTime >= z.stats.corpseTime + 1.2) {
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
