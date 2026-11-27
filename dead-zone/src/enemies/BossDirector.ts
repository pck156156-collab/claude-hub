import * as THREE from 'three';
import { BOSS_CONFIG } from './EnemyData';
import { Zombie } from './Zombie';
import { ZombieManager } from './ZombieManager';

/**
 * 보스 등장 관리 (기존 웨이브 시스템의 웨이브 시작 이벤트에 연결).
 * - 5 · 10 · 15 · 20 … 웨이브 시작 때 보스 1마리 (웨이브마다 한 번만: handledWaves)
 * - 보스는 동시에 1마리만. 보스 웨이브가 왔는데 이전 보스가 살아 있으면 대기열에 넣고,
 *   이전 보스가 죽은 뒤 queuedDelay 초 후 등장 (대기열은 1개: 더 늦은 웨이브의 보스로 교체)
 * - n 번째 보스 웨이브일수록 체력 · 공격력 증가 (EnemyData.bossStats)
 * - 생성 위치는 ZombieManager.spawnBoss (플레이어와 떨어진 넓은 곳). 자리가 없으면 잠시 후 재시도
 */
export class BossDirector {
  /** 이미 처리한 보스 웨이브 (중복 생성 방지) */
  private readonly handledWaves = new Set<number>();
  /** 대기 중인 보스 웨이브 (없으면 0) */
  pendingWave = 0;
  private timer = 0;
  /** 등장 기록 (테스트 · 디버그) */
  readonly log: { wave: number; index: number; time: number; queued: boolean }[] = [];
  private queued = false;
  private clock = 0;

  onSpawn: ((boss: Zombie, wave: number, index: number) => void) | null = null;

  reset(): void {
    this.handledWaves.clear();
    this.pendingWave = 0;
    this.timer = 0;
    this.queued = false;
    this.clock = 0;
    this.log.length = 0;
  }

  static isBossWave(wave: number): boolean {
    const c = BOSS_CONFIG;
    return wave >= c.firstWave && (wave - c.firstWave) % c.every === 0;
  }

  /** n 번째 보스 (5웨이브 = 1, 10웨이브 = 2 …) */
  static bossIndex(wave: number): number {
    return Math.floor((wave - BOSS_CONFIG.firstWave) / BOSS_CONFIG.every) + 1;
  }

  /** 웨이브 시작 */
  onWave(wave: number, zombies: ZombieManager): void {
    if (!BossDirector.isBossWave(wave) || this.handledWaves.has(wave)) return;
    this.handledWaves.add(wave);
    this.pendingWave = Math.max(this.pendingWave, wave);
    this.queued = zombies.boss !== null;
    this.timer = this.queued ? BOSS_CONFIG.queuedDelay : BOSS_CONFIG.spawnDelay;
  }

  step(dt: number, zombies: ZombieManager, camera: THREE.Camera, allowed: boolean): void {
    this.clock += dt;
    if (!this.pendingWave) return;
    if (zombies.boss) {
      // 이전 보스가 살아 있음: 죽을 때까지 대기
      this.timer = BOSS_CONFIG.queuedDelay;
      this.queued = true;
      return;
    }
    this.timer -= dt;
    if (this.timer > 0 || !allowed) return;
    const wave = this.pendingWave;
    const index = BossDirector.bossIndex(wave);
    const boss = zombies.spawnBoss(index, camera);
    if (!boss) { this.timer = 0.5; return; } // 안전한 자리가 없으면 잠시 후 재시도
    this.pendingWave = 0;
    this.log.push({ wave, index, time: this.clock, queued: this.queued });
    this.queued = false;
    this.onSpawn?.(boss, wave, index);
  }
}
