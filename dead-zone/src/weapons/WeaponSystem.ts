import { WEAPON_CONFIG } from '../config/GameConfig';
import { Mastery } from '../progression/Mastery';
import { MeleeStats, PlayerStats, computeGunStats, computeMeleeStats, computeStats } from '../upgrades/StatCalculator';
import { Weapon, WeaponListener, WeaponSocket } from './Weapon';
import { GUNS, GunId, LOADOUT, MASTERY, MELEE, MeleeId } from './WeaponData';

/**
 * 무기 슬롯 관리: 총기 슬롯 2개 + 근접 슬롯 1개, 교체, 획득, 숙련도, 최종 능력치 계산.
 * - 총기는 종류마다 Weapon 인스턴스를 하나씩 만들어 재사용한다 (교체 시 새 객체를 만들지 않음).
 *   탄약 · 발사 쿨다운은 인스턴스에 남아 있으므로 교체해도 유지된다.
 * - 해금(unlocked) 과 장착(slots) 을 구분한다: 한 번 바꾼 무기도 나중에 다시 얻을 수 있다.
 */
export class WeaponSystem {
  readonly guns = new Map<GunId, Weapon>();
  slots: [GunId, GunId] = [...LOADOUT.startGuns];
  active: 0 | 1 = 0;
  meleeId: MeleeId = LOADOUT.startMelee;
  readonly unlockedGuns = new Set<GunId>();
  readonly unlockedMelee = new Set<MeleeId>();
  readonly gunMastery = new Mastery(() => MASTERY.gunXp);
  readonly meleeMastery = new Mastery(() => MASTERY.meleeXp);
  /** 교체 중 남은 시간 (0 이면 교체 완료) */
  switchTimer = 0;
  /** 교체 직전 총기 (교체 애니메이션) */
  switchFrom: GunId | null = null;
  mods: PlayerStats = computeStats(new Map());
  meleeStats: MeleeStats = computeMeleeStats(MELEE[LOADOUT.startMelee], this.mods, 0);
  private readonly listeners: WeaponListener[] = [];

  /** 장착 무기가 바뀔 때 (HUD · 모델) */
  onLoadoutChanged: (() => void) | null = null;

  constructor(private readonly socket: WeaponSocket) {
    this.reset();
  }

  get current(): Weapon {
    return this.gun(this.slots[this.active]);
  }

  get currentId(): GunId {
    return this.slots[this.active];
  }

  get switching(): boolean {
    return this.switchTimer > 0;
  }

  /** 교체 진행도 0~1 (교체 중이 아니면 -1) */
  get switchProgress(): number {
    return this.switchTimer > 0 ? 1 - this.switchTimer / WEAPON_CONFIG.switchTime : -1;
  }

  addGunListener(l: WeaponListener): void {
    this.listeners.push(l);
    for (const w of this.guns.values()) w.addListener(l);
  }

  /** 총기 인스턴스 (없으면 한 번만 생성) */
  gun(id: GunId): Weapon {
    let w = this.guns.get(id);
    if (!w) {
      w = new Weapon(GUNS[id], this.socket);
      for (const l of this.listeners) w.addListener(l);
      w.applyStats(computeGunStats(GUNS[id], this.mods, this.gunMastery.bonus(id)));
      w.reset();
      this.guns.set(id, w);
    }
    return w;
  }

  /** 다시 시작: 기본 장비 · 숙련도 · 탄약 초기화 (강화 보정은 setMods 로 따로) */
  reset(): void {
    this.slots = [...LOADOUT.startGuns];
    this.active = 0;
    this.meleeId = LOADOUT.startMelee;
    this.unlockedGuns.clear();
    this.unlockedMelee.clear();
    for (const g of LOADOUT.startGuns) this.unlockedGuns.add(g);
    this.unlockedMelee.add(LOADOUT.startMelee);
    this.gunMastery.reset();
    this.meleeMastery.reset();
    this.switchTimer = 0;
    this.switchFrom = null;
    this.recompute();
    for (const w of this.guns.values()) w.reset();
    for (const id of this.slots) this.gun(id).reset();
    this.onLoadoutChanged?.();
  }

  /** 강화 보정값 변경 → 모든 무기 최종 능력치 재계산 */
  setMods(m: PlayerStats): void {
    this.mods = m;
    this.recompute();
  }

  /** 기본 능력치 + 강화 + 숙련도 → 최종 능력치 (항상 기본값에서 다시 계산) */
  recompute(): void {
    for (const [id, w] of this.guns) w.applyStats(computeGunStats(GUNS[id], this.mods, this.gunMastery.bonus(id)));
    this.meleeStats = computeMeleeStats(MELEE[this.meleeId], this.mods, this.meleeMastery.bonus(this.meleeId));
  }

  /**
   * 총기 슬롯 선택. 교체 중 · 근접 공격 중이면 무시.
   * 재장전 중이면 취소하고 남은 탄약을 그대로 둔다 (교체로 재장전 시간을 건너뛸 수 없음).
   */
  selectSlot(slot: 0 | 1, blocked: boolean): boolean {
    if (blocked || slot === this.active || this.switching) return false;
    const cur = this.current;
    cur.cancelReload();
    cur.releaseTrigger();
    this.switchFrom = cur.id;
    this.active = slot;
    this.switchTimer = WEAPON_CONFIG.switchTime;
    this.current.releaseTrigger();
    this.onLoadoutChanged?.();
    return true;
  }

  /** 마우스 휠: 다른 슬롯으로 */
  cycle(blocked: boolean): boolean {
    return this.selectSlot(this.active === 0 ? 1 : 0, blocked);
  }

  /**
   * @param trigger 좌클릭
   * @param blocked 근접 공격 중 (발사 · 교체 불가)
   */
  update(dt: number, trigger: boolean, blocked: boolean): void {
    if (this.switchTimer > 0) {
      this.switchTimer = Math.max(0, this.switchTimer - dt);
      if (this.switchTimer === 0) this.switchFrom = null;
    }
    const cur = this.current;
    for (const id of this.slots) {
      const w = this.gun(id);
      if (w === cur) w.update(dt, trigger, !this.switching && !blocked);
      else w.update(dt, false, false); // 들고 있지 않은 총: 발사 쿨다운만 흐름
    }
  }

  /** 새 총기 장착 (보상). 이미 장착한 총기는 불가. 새 총기는 탄창 가득 */
  equipGun(id: GunId, slot: 0 | 1): boolean {
    if (this.slots.includes(id)) return false;
    const old = this.gun(this.slots[slot]);
    old.cancelReload();
    old.releaseTrigger();
    this.slots[slot] = id;
    this.unlockedGuns.add(id);
    const w = this.gun(id);
    w.applyStats(computeGunStats(GUNS[id], this.mods, this.gunMastery.bonus(id)));
    w.reset();
    if (slot === this.active) {
      this.switchFrom = old.id;
      this.switchTimer = WEAPON_CONFIG.switchTime;
    }
    this.onLoadoutChanged?.();
    return true;
  }

  /** 새 근접 무기 장착 (기존 근접 무기와 교체) */
  equipMelee(id: MeleeId): boolean {
    if (id === this.meleeId) return false;
    this.meleeId = id;
    this.unlockedMelee.add(id);
    this.recompute();
    this.onLoadoutChanged?.();
    return true;
  }

  /** 총기 보상 후보: 보상 목록 중 지금 장착하지 않은 것 */
  gunOffers(): GunId[] {
    return LOADOUT.gunRewardPool.filter((id) => !this.slots.includes(id));
  }

  /** 근접 보상 후보: 보상 목록 중 지금 장착하지 않은 것 (예전에 바꾼 무기도 다시 등장) */
  meleeOffers(): MeleeId[] {
    return LOADOUT.meleeRewardPool.filter((id) => id !== this.meleeId);
  }

  /** 실제로 준 피해를 숙련도에 반영 (레벨이 오르면 능력치 재계산) */
  addMastery(kind: 'gun' | 'melee', id: string, dealt: number): void {
    const m = kind === 'gun' ? this.gunMastery : this.meleeMastery;
    const before = m.level(id);
    m.add(id, dealt);
    if (m.level(id) !== before) this.recompute();
  }
}
