import * as THREE from 'three';
import { CombatSystem } from '../combat/CombatSystem';
import { BulletSpec, ProjectileSystem } from './Projectile';
import { ShotEvent } from './Weapon';
import { GUNS } from './WeaponData';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * 사격 방식 모듈: 방아쇠 1회(ShotEvent) → 탄 N발(투사체).
 * - 퍼짐 = 총기 기본 퍼짐 + 이동 중 퍼짐 × 이동 속도 비율
 * - 산탄: 부채꼴 안에 고르게 나누고 약간 흔든다. 산탄 한 알마다 공격 ID 를 따로 발급 → 각각 유효한 공격
 */
export class GunShooter {
  /** 0~1: 플레이어 이동 속도 비율 (Game 이 매 스텝 설정) */
  moveRatio = 0;
  random: () => number = Math.random;
  /** 누적 탄 수 (테스트) */
  bullets = 0;
  private readonly spec: BulletSpec = {
    origin: new THREE.Vector3(), direction: new THREE.Vector3(), speed: 0, range: 0, damage: 0, pierce: 0, sourceId: '', attackId: 0,
    knockback: 0, falloffStart: 999, falloffEnd: 999, minFalloff: 1, tracerColor: 0xffffff, tracerWidth: 0.08, elapsed: 0,
  };

  constructor(private readonly projectiles: ProjectileSystem, private readonly combat: CombatSystem) {}

  fire(shot: ShotEvent): void {
    const st = shot.stats;
    const def = GUNS[st.id];
    const spec = this.spec;
    spec.origin.copy(shot.origin);
    spec.speed = st.projectileSpeed;
    spec.range = st.range;
    spec.damage = st.damage;
    spec.pierce = st.pierce;
    spec.sourceId = st.id;
    spec.knockback = st.knockback;
    spec.falloffStart = st.falloffStart;
    spec.falloffEnd = st.falloffEnd;
    spec.minFalloff = st.minFalloff;
    spec.tracerColor = def.tracerColor;
    spec.tracerWidth = def.tracerWidth;
    spec.elapsed = shot.elapsed;
    const spread = THREE.MathUtils.degToRad(st.spreadDeg + st.moveSpreadDeg * Math.min(1, Math.max(0, this.moveRatio)));
    const n = Math.max(1, st.pellets);
    const cone = THREE.MathUtils.degToRad(st.pelletConeDeg);
    for (let i = 0; i < n; i++) {
      let angle = (this.random() * 2 - 1) * spread;
      if (n > 1) {
        // 부채꼴을 n 칸으로 나눠 각 칸 안에서 무작위 → 고르게 퍼지되 매번 조금씩 다름
        const slot = cone / n;
        angle += -cone / 2 + slot * (i + 0.5) + (this.random() - 0.5) * slot * 0.8;
      }
      spec.direction.copy(shot.direction).applyAxisAngle(UP, angle);
      spec.attackId = this.combat.nextAttackId();
      this.projectiles.spawn(spec);
      this.bullets++;
    }
  }
}
