import * as THREE from 'three';

/** 무기 수치. config/GameConfig.ts 의 WEAPON_CONFIG 항목과 같은 형태 */
export interface WeaponStats {
  id: string;
  name: string;
  magazineSize: number;
  fireRate: number;
  reloadTime: number;
  projectileSpeed: number;
  range: number;
  damage: number;
  spreadDeg: number;
  autoReloadOnEmpty: boolean;
}

/** 무기를 들고 있는 대상이 제공하는 총구 정보 (플레이어 · 향후 다른 사수) */
export interface WeaponSocket {
  getMuzzle(outPos: THREE.Vector3, outDir: THREE.Vector3): void;
}

export interface ShotEvent {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  stats: WeaponStats;
  /** 이번 스텝 안에서 발사 시점 이후 이미 흐른 시간 (저프레임에서도 탄 간격 유지) */
  elapsed: number;
}

export interface WeaponListener {
  onFire?(shot: ShotEvent): void;
  onReloadStart?(): void;
  onReloadEnd?(): void;
  onDryFire?(): void;
}

/**
 * 총기 상태 머신: 발사 간격 · 탄약 · 재장전.
 * 투사체를 직접 만들지 않고 onFire 이벤트만 낸다 → 투사체 · 이펙트 · 사운드가 각자 구독.
 */
export class Weapon {
  ammo: number;
  reloading = false;
  reloadTimer = 0;
  /** 다음 발사까지 남은 시간 (음수면 발사 가능, 누적 보정용) */
  private cooldown = 0;
  private triggerWasDown = false;
  private readonly listeners: WeaponListener[] = [];
  private readonly shot: ShotEvent;
  private readonly tmpAxis = new THREE.Vector3(0, 1, 0);
  /** 누적 발사 수 (테스트 · 디버그용) */
  shotsFired = 0;

  constructor(readonly stats: WeaponStats, private readonly socket: WeaponSocket, private readonly random: () => number = Math.random) {
    this.ammo = stats.magazineSize;
    this.shot = { origin: new THREE.Vector3(), direction: new THREE.Vector3(), stats, elapsed: 0 };
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

  requestReload(): boolean {
    if (this.reloading || this.ammo >= this.stats.magazineSize) return false;
    this.reloading = true;
    this.reloadTimer = this.stats.reloadTime;
    for (const l of this.listeners) l.onReloadStart?.();
    return true;
  }

  update(dt: number, triggerDown: boolean): void {
    const pressed = triggerDown && !this.triggerWasDown;
    this.triggerWasDown = triggerDown;

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.reloadTimer = 0;
        this.ammo = this.stats.magazineSize;
        for (const l of this.listeners) l.onReloadEnd?.();
      }
    }

    this.cooldown -= dt;
    if (!triggerDown || this.reloading) {
      // 방아쇠를 놓은 동안 발사 가능 상태가 쌓이지 않도록
      if (this.cooldown < 0) this.cooldown = 0;
      return;
    }

    if (this.ammo <= 0) {
      if (pressed) {
        for (const l of this.listeners) l.onDryFire?.();
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

  /** 다시 시작: 탄창 가득 · 재장전 취소 */
  reset(): void {
    this.ammo = this.stats.magazineSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.triggerWasDown = false;
  }

  /** 상태 초기화 (일시정지 해제 등) */
  releaseTrigger(): void {
    this.triggerWasDown = false;
  }

  private fireOne(elapsed: number): void {
    this.ammo--;
    this.shotsFired++;
    const s = this.shot;
    this.socket.getMuzzle(s.origin, s.direction);
    if (this.stats.spreadDeg > 0) {
      const spread = THREE.MathUtils.degToRad(this.stats.spreadDeg) * (this.random() * 2 - 1);
      s.direction.applyAxisAngle(this.tmpAxis, spread);
    }
    s.elapsed = elapsed;
    for (const l of this.listeners) l.onFire?.(s);
  }
}
