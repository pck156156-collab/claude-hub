import * as THREE from 'three';

export type DamageKind = 'normal' | 'crit' | 'melee' | 'boss';

interface Num {
  el: HTMLDivElement;
  active: boolean;
  x: number; y: number; z: number;
  age: number;
  life: number;
  value: number;
  kind: DamageKind;
  /** 같은 대상 · 같은 순간 피해를 합치기 위한 키 */
  key: unknown;
  drift: number;
}

const POOL = 40;
/** 같은 대상의 피해를 하나로 합치는 시간 (샷건 산탄 8발 → 숫자 1개) */
const MERGE_TIME = 0.09;

/**
 * 데미지 숫자 (DOM 객체 풀). 피해가 실제로 들어간 순간(CombatSystem.onHit)에만 추가된다.
 * - 일반: 흰색 · 치명타: 노란색(크게, "!") · 근접: 주황색 · 보스: 붉은 테두리 큰 숫자
 * - 위로 떠오르며 사라짐 (0.7초). 같은 대상의 짧은 시간 내 피해는 합쳐서 표시
 * - 동시 표시 수 제한 (그래픽 품질). 넘치면 가장 오래된 숫자를 재사용
 */
export class DamageNumbers {
  private readonly layer: HTMLDivElement;
  private readonly nums: Num[] = [];
  private readonly v = new THREE.Vector3();
  /** 동시에 보이는 최대 개수 */
  limit = 28;
  /** 지금까지 추가 · 합친 횟수 (테스트) */
  stats = { added: 0, merged: 0, recycled: 0 };

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'dmg-layer';
    parent.appendChild(this.layer);
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.style.display = 'none';
      this.layer.appendChild(el);
      this.nums.push({ el, active: false, x: 0, y: 0, z: 0, age: 0, life: 0.7, value: 0, kind: 'normal', key: null, drift: 0 });
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const d of this.nums) if (d.active) n++;
    return n;
  }

  add(x: number, y: number, z: number, value: number, kind: DamageKind, key: unknown): void {
    // 1) 같은 대상에 방금 뜬 숫자가 있으면 합침
    for (const d of this.nums) {
      if (d.active && d.key === key && d.age < MERGE_TIME && (d.kind === kind || kind === 'crit')) {
        d.value += value;
        if (kind === 'crit') d.kind = 'crit';
        this.render(d);
        this.stats.merged++;
        return;
      }
    }
    // 2) 빈 자리 (제한 수 안에서), 없으면 가장 오래된 숫자 재사용
    let slot: Num | null = null;
    let active = 0;
    let oldest: Num | null = null;
    for (const d of this.nums) {
      if (d.active) { active++; if (!oldest || d.age > oldest.age) oldest = d; } else if (!slot) slot = d;
    }
    if (!slot || active >= this.limit) { slot = oldest!; this.stats.recycled++; }
    slot.active = true;
    slot.x = x + (Math.random() - 0.5) * 0.3;
    slot.y = y;
    slot.z = z + (Math.random() - 0.5) * 0.3;
    slot.age = 0;
    slot.life = kind === 'crit' || kind === 'boss' ? 0.85 : 0.7;
    slot.value = value;
    slot.kind = kind;
    slot.key = key;
    slot.drift = (Math.random() - 0.5) * 30;
    slot.el.style.display = '';
    this.render(slot);
    this.stats.added++;
  }

  private render(d: Num): void {
    const v = Math.max(1, Math.round(d.value));
    d.el.textContent = d.kind === 'crit' ? `${v}!` : String(v);
    d.el.className = `dmg ${d.kind}`;
  }

  /** 렌더 프레임마다: 화면 위치 · 떠오름 · 투명도 */
  update(dt: number, camera: THREE.Camera, width: number, height: number): void {
    for (const d of this.nums) {
      if (!d.active) continue;
      d.age += dt;
      if (d.age >= d.life) { d.active = false; d.el.style.display = 'none'; d.key = null; continue; }
      const k = d.age / d.life;
      this.v.set(d.x, d.y + k * 0.9, d.z).project(camera);
      if (this.v.z > 1) { d.el.style.display = 'none'; continue; }
      d.el.style.display = '';
      const sx = (this.v.x * 0.5 + 0.5) * width + d.drift * k;
      const sy = (-this.v.y * 0.5 + 0.5) * height;
      // 처음 짧게 커졌다가 줄어들며 사라짐
      const pop = k < 0.15 ? 1 + (1 - k / 0.15) * 0.5 : 1;
      d.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      d.el.style.opacity = String(k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
    }
  }

  clear(): void {
    for (const d of this.nums) { d.active = false; d.key = null; d.el.style.display = 'none'; }
  }
}
