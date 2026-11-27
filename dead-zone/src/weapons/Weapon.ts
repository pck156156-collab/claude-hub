import * as THREE from 'three';
import { WEAPON_CONFIG } from '../config/GameConfig';
import { GunDef, GunId } from './WeaponData';

/** 총기 최종 능력치 (기본값 + 강화 + 숙련도 → StatCalculator.computeGunStats) */
export interface WeaponStats {
  id: GunId;
  name: string;
  damage: number;
  pellets: number;
  fireRate: number;
  auto: boolean;
  magazineSize: number;
  reloadTime: number;
  projectileSpeed: number;
  range: number;
  spreadDeg: number;
  moveSpreadDeg: number;
  pelletConeDeg: number;
  falloffStart: number;
  falloffEnd: number;
  minFalloff: number;
  knockback: number;
  /** 추가 관통 수 (강화) */
  pierce: number;
  autoReloadOnEmpty: boolean;
}

/** 무기를 들고 있는 대상이 제공하는 총구 정보 (플레이어 · 향후 다른 사수) */
export interface WeaponSocket {
  getMuzzle(outPos: THREE.Vector3, outDir: THREE.Vector3): void;
}

/** 방아쇠 1회분 발사 (산탄은 GunShooter 가 여러 발로 나눈다) */
export interface ShotEvent {
  origin: THREE.Vector3;
  /** 조준 방향 (퍼짐 적용 전) */
  direction: THREE.Vector3;
  stats: WeaponStats;
  /** 이번 스텝 안에서 발사 시점 이후 이미 흐른 시간 (저프레임에서도 탄 간격 유지) */
  elapsed: number;
}

export interface WeaponListener {
  onFire?(shot: ShotEvent, weapon: Weapon): void;
  onReloadStart?(weapon: Weapon): void;
  onReloadEnd?(weapon: Weapon): void;
  onReloadCancel?(weapon: Weapon): void;
  onDryFire?(weapon: Weapon): void;
}

/** 무기 데이터 → 강화가 없는 최종 능력치 형태 */
export function statsFromDef(def: GunDef): WeaponStats {
  return {
    id: def.id, name: def.name, damage: def.damage, pellets: def.pellets, fireRate: def.fireRate, auto: def.auto,
    magazineSize: def.magazineSize, reloadTime: def.reloadTime, projectileSpeed: def.projectileSpeed, range: def.range,
    spreadDeg: def.spreadDeg, moveSpreadDeg: def.moveSpreadDeg, pelletConeDeg: def.pelletConeDeg,
    falloffStart: def.falloffStart, falloffEnd: def.falloffEnd, minFalloff: def.minFalloff, knockback: def.knockback,
    pierce: 0, autoReloadOnEmpty: WEAPON_CONFIG.autoReloadOnEmpty,
  };
}

/**
 * 총기 1정의 상태 머신: 발사 간격 · 탄약 · 재장전 · 자동/반자동.
 * 총기마다 인스턴스가 하나씩 있어 탄약 · 쿨다운이 따로 보존된다 (교체해도 유지).
 * 투사체를 직접 만들지 않고 onFire 이벤트만 낸다.
 */
export class Weapon {
  ammo: number;
  reloading = false;
  reloadTimer = 0;
  /** 다음 발사까지 남은 시간 (음수면 발사 가능, 누적 보정용) */
  private cooldown = 0;
  private triggerWasDown = false;
  /** 반자동: 발사 간격 직전에 누른 클릭을 기억 */
  private queuedShot = false;
  private readonly listeners: WeaponListener[] = [];
  private readonly shot: ShotEvent;
  /** 누적 발사 수 (테스트 · 디버그용) */
  shotsFired = 0;
  /** 현재 능력치 (기본값 + 강화 + 숙련도). 기본값은 def 에 보존 */
  stats: WeaponStats;

  constructor(readonly def: GunDef, private readonly socket: WeaponSocket) {
    this.stats = statsFromDef(def);
    this.ammo = def.magazineSize;
    this.shot = { origin: new THREE.Vector3(), direction: new THREE.Vector3(), stats: this.stats, elapsed: 0 };
  }

  get id(): GunId {
    return this.def.id;
  }

  addListener(l: WeaponListener): void {
    this.listeners.push(l);
  }

  get fireInterval(): number {
    return 1 / this.stats.fireRate;
  }

  /** 재장전 진행도 0~1 */
  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadTimer / this.stats.reloadTime : 0;
  }

  /** 다음 발사까지 남은 비율 0~1 (HUD) */
  get cooldownRatio(): number {
    return Math.max(0, Math.min(1, this.cooldown / this.fireInterval));
  }

  requestReload(): boolean {
    if (this.reloading || this.ammo >= this.stats.magazineSize) return false;
    this.reloading = true;
    this.reloadTimer = this.stats.reloadTime;
    for (const l of this.listeners) l.onReloadStart?.(this);
    return true;
  }

  /** 재장전 취소: 남은 탄약은 그대로 (교체 · 근접 공격 시) */
  cancelReload(): void {
    if (!this.reloading) return;
    this.reloading = false;
    this.reloadTimer = 0;
    for (const l of this.listeners) l.onReloadCancel?.(this);
  }

  /**
   * @param triggerDown 방아쇠 (좌클릭)
   * @param allowFire 교체 · 근접 공격 중이면 false (재장전 · 쿨다운은 계속 진행)
   */
  update(dt: number, triggerDown: boolean, allowFire = true): void {
    const pressed = triggerDown && !this.triggerWasDown;
    this.triggerWasDown = triggerDown;

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.ammo = this.stats.magazineSize;
        for (const l of this.listeners) l.onReloadEnd?.(this);
      }
    }

    this.cooldown -= dt;
    if (!allowFire) {
      this.queuedShot = false;
      if (this.cooldown < 0) this.cooldown = 0;
      return;
    }

    if (!this.stats.auto) {
      // 반자동: 클릭당 1발. 간격이 거의 끝났을 때 누른 클릭은 기억했다가 쏜다
      if (pressed) {
        if (this.ammo <= 0 && !this.reloading) {
          for (const l of this.listeners) l.onDryFire?.(this);
          if (this.stats.autoReloadOnEmpty) this.requestReload();
        } else if (this.cooldown <= WEAPON_CONFIG.semiAutoBuffer) {
          this.queuedShot = true;
        }
      }
      if (this.queuedShot && this.cooldown <= 0 && !this.reloading && this.ammo > 0) {
        this.queuedShot = false;
        this.fireOne(-this.cooldown);
        this.cooldown = Math.max(0, this.cooldown) + this.fireInterval;
      }
      if (this.reloading) this.queuedShot = false;
      if (this.cooldown < 0) this.cooldown = 0;
      if (this.ammo === 0 && this.stats.autoReloadOnEmpty) this.requestReload();
      return;
    }

    if (!triggerDown || this.reloading) {
      // 방아쇠를 놓은 동안 발사 가능 상태가 쌓이지 않도록
      if (this.cooldown < 0) this.cooldown = 0;
      return;
    }

    if (this.ammo <= 0) {
      if (pressed) {
        for (const l of this.listeners) l.onDryFire?.(this);
        if (this.stats.autoReloadOnEmpty) this.requestReload();
      }
      if (this.cooldown < 0) this.cooldown = 0;
      return;
    }

    // 한 스텝에 여러 발이 나갈 수 있다 (저프레임) — 각 탄은 늦은 만큼 앞으로 진행시킨다
    while (this.cooldown <= 0 && this.ammo > 0) {
      this.fireOne(-this.cooldown);
      this.cooldown += this.fireInterval;
    }
    if (this.cooldown < 0) this.cooldown = 0;
    // 마지막 탄을 쏘면 방아쇠와 상관없이 바로 스스로 재장전
    if (this.ammo === 0 && this.stats.autoReloadOnEmpty) this.requestReload();
  }

  /**
   * 최종 능력치 적용. 탄창이 커지면 늘어난 만큼 탄을 채워 주고, 줄면 넘치는 탄을 버린다.
   * 발사 간격 · 재장전 시간은 다음 발사 · 다음 재장전부터 반영된다.
   */
  applyStats(next: WeaponStats): void {
    const oldMag = this.stats.magazineSize;
    this.stats = next;
    this.shot.stats = next;
    const diff = next.magazineSize - oldMag;
    if (!this.reloading) this.ammo = Math.max(0, Math.min(next.magazineSize, this.ammo + Math.max(0, diff)));
    else this.ammo = Math.min(this.ammo, next.magazineSize);
  }

  /** 새로 얻었거나 다시 시작: 탄창 가득 · 재장전 취소 */
  reset(): void {
    this.ammo = this.stats.magazineSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.triggerWasDown = false;
    this.queuedShot = false;
    this.shotsFired = 0;
  }

  /** 입력 상태만 초기화 (일시정지 해제 · 교체 등) */
  releaseTrigger(): void {
    this.triggerWasDown = false;
    this.queuedShot = false;
  }

  private fireOne(elapsed: number): void {
    this.ammo--;
    this.shotsFired++;
    const s = this.shot;
    this.socket.getMuzzle(s.origin, s.direction);
    s.elapsed = elapsed;
    for (const l of this.listeners) l.onFire?.(s, this);
  }
}
