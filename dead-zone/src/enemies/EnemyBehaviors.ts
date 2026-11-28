import * as THREE from 'three';
import { RayHit } from '../world/Collision';
import { DangerZone, EnemyBehavior, MoveInfo, Zombie, ZombieContext, ZombieState, emptyZone } from './Zombie';

/**
 * 종류별 특수 행동 모듈. 공통 AI(Zombie: 생성 · 추적 · 경로 · 피격 · 사망)는 그대로 쓰고
 * 각 모듈은 "추적 중 무엇을 시작하는가"와 "특수 행동 단계"만 정의한다.
 * 위험 범위(zone)는 바닥 표시와 피해 판정에 똑같이 쓰인다.
 */

const tmpDir = { x: 0, z: 0 };
const zoneTmp = emptyZone();
const ray: RayHit = { t: 0, x: 0, z: 0, nx: 0, nz: 0, collider: null as never };

// ─────────────────────────────────────────── 러너
const runner: EnemyBehavior = {
  interruptible: true,
  chase(z, _dt, _ctx, m) {
    const d = z.stats.dash!;
    // 일정 거리 + 시야 + 쿨다운 → 짧게 웅크린 뒤 가속
    if (z.cdA <= 0 && z.hasLos && m.dist >= d.minDist && m.dist <= d.maxDist) {
      z.setSpecial('dashPrep');
      return true;
    }
    return false;
  },
  special(z, dt, ctx, m) {
    const s = z.stats;
    const d = s.dash!;
    if (z.special === 'dashPrep') {
      // 반응 시간: 웅크리며 플레이어를 노려봄 (거의 정지)
      z.turnToward(m.toTarget, s.turnSpeed, dt);
      z.heading = z.yaw;
      m.mvx = Math.sin(z.yaw) * s.moveSpeed * 0.2;
      m.mvz = Math.cos(z.yaw) * s.moveSpeed * 0.2;
      if (z.specialTime >= d.prepTime) { z.setSpecial('dash'); ctx.events.emit('dash', z); }
      return;
    }
    // 가속: 방향 전환이 느려서 옆으로 피하면 지나쳐 간다
    z.steerHeading(m.toTarget, d.turnRate, dt);
    z.turnToward(z.heading, 12, dt);
    const sp = s.moveSpeed * d.speedMul;
    m.mvx = Math.sin(z.heading) * sp;
    m.mvz = Math.cos(z.heading) * sp;
    if (m.dist <= s.attackRange * 0.9 && z.attackCooldown <= 0) {
      z.cdA = d.cooldown;
      z.startAttack();
      return;
    }
    if (z.specialTime >= d.time || (z.blocked && z.specialTime > 0.15)) {
      z.cdA = d.cooldown;
      z.endSpecial();
    }
  },
};

// ─────────────────────────────────────────── 스피터
const spitter: EnemyBehavior = {
  interruptible: true,
  chase(z, dt, ctx, m) {
    const s = z.stats;
    const r = s.ranged!;
    // 시야가 없거나 멀면 기본 추적으로 접근
    if (!z.hasLos || m.dist > r.preferMax + 0.5) return false;
    z.turnToward(m.toTarget, s.turnSpeed, dt);
    // 사거리 안 + 쿨다운 + 전체 발사 제한 → 공격 준비
    if (z.attackCooldown <= 0 && m.dist <= r.range && ctx.events.canSpit()) {
      z.attackCooldown = s.attackInterval;
      z.setSpecial('spit');
      ctx.events.emit('spitWindup', z);
      return true;
    }
    // 거리 유지: 너무 가까우면 후퇴, 적정 거리면 옆으로 이동 (공격 후 재배치)
    const ux = m.dx / (m.dist || 1);
    const uz = m.dz / (m.dist || 1);
    let back = 0;
    if (m.dist < r.retreatDist) back = 1;
    else if (m.dist < r.preferMin) back = 0.45;
    const strafe = z.strafeTimer > 0 ? 0.75 : 0.25;
    let vx = -ux * back + -uz * z.strafeDir * strafe;
    let vz = -uz * back + ux * z.strafeDir * strafe;
    const l = Math.hypot(vx, vz);
    if (l > 1e-3) { vx /= l; vz /= l; }
    const sp = s.moveSpeed * (back >= 1 ? 1 : 0.6);
    m.mvx = vx * sp;
    m.mvz = vz * sp;
    // 벽에 막히면 반대쪽으로
    if (z.blocked && z.moveSpeed < sp * 0.3) z.strafeDir *= -1;
    return true;
  },
  special(z, dt, ctx, m) {
    const s = z.stats;
    const r = s.ranged!;
    z.turnToward(m.toTarget, s.turnSpeed, dt);
    if (!z.hitDone && z.specialTime >= r.windup) {
      z.hitDone = true;
      // 발사 순간의 플레이어 위치로 직선 발사 (예측 없음 → 움직이면 피할 수 있음)
      const sc = s.appearance.scale;
      const ox = z.position.x + Math.sin(z.yaw) * 0.35 * sc;
      const oz = z.position.z + Math.cos(z.yaw) * 0.35 * sc;
      const tx = ctx.target.position.x - ox;
      const tz = ctx.target.position.z - oz;
      const l = Math.hypot(tx, tz) || 1;
      ctx.events.spit(z, ox, 1.25 * sc, oz, tx / l, tz / l, r.projectileSpeed, r.projectileRadius, s.attackDamage);
    }
    if (z.specialTime >= r.windup + r.recover) {
      z.strafeDir = Math.random() < 0.5 ? -1 : 1;
      z.strafeTimer = r.repositionTime;
      z.endSpecial();
    }
  },
};

// ─────────────────────────────────────────── 폭발 좀비
function explodeZone(z: Zombie, out: DangerZone): DangerZone {
  const e = z.stats.explode!;
  out.shape = 'circle';
  out.x = z.position.x;
  out.z = z.position.z;
  out.radius = e.radius;
  out.half = 0;
  out.yaw = 0;
  out.progress = Math.min(1, z.specialTime / e.primeTime);
  out.mode = 'warn';
  out.color = 0xff7a1a;
  return out;
}

const exploder: EnemyBehavior = {
  interruptible: false,
  chase(z, _dt, ctx, m) {
    const e = z.stats.explode!;
    if (m.dist <= e.trigger && ctx.target.isAlive()) {
      z.setSpecial('prime');
      ctx.events.emit('prime', z);
      return true;
    }
    return false;
  },
  special(z, dt, ctx, m) {
    const s = z.stats;
    const e = s.explode!;
    // 준비: 느리게 따라오며 부풀고 빛남. 범위 밖으로 벗어나면 피할 수 있다
    z.pathDirection(ctx, m, tmpDir);
    m.mvx = tmpDir.x * s.moveSpeed * e.primeSpeedMul;
    m.mvz = tmpDir.z * s.moveSpeed * e.primeSpeedMul;
    z.turnToward(m.toTarget, s.turnSpeed, dt);
    if (z.specialTime >= e.primeTime) {
      const zone = explodeZone(z, zoneTmp);
      const hit = z.strike(ctx.target, zone, e.damage);
      ctx.events.emit('explode', z, hit ? 1 : 0);
      z.selfDestruct(); // 폭발 후 제거 (다른 좀비는 피해 없음 → 연쇄 폭발 없음)
      m.mvx = m.mvz = 0;
    }
  },
  zone(z, _ctx, out) {
    if (z.state !== ZombieState.Special || z.special !== 'prime') return false;
    explodeZone(z, out);
    return true;
  },
};

// ─────────────────────────────────────────── 보스: THE ABOMINATION
function bp(z: Zombie) {
  return z.stats.boss!;
}
function p2(z: Zombie): boolean {
  return z.phase >= 2;
}
function cool(z: Zombie, t: number): number {
  return t * (p2(z) ? bp(z).phase2.cooldownMul : 1);
}
function wind(z: Zombie, t: number): number {
  return t * (p2(z) ? bp(z).phase2.windupMul : 1);
}
/** 지면 강타 반경 (2페이즈 증가). 표시와 판정이 같은 함수 사용 */
export function slamRadius(z: Zombie): number {
  return bp(z).slamRadius * (p2(z) ? bp(z).phase2.slamRadiusMul : 1);
}
/** 보스 이동 속도 (2페이즈 소폭 증가) */
function bossSpeed(z: Zombie): number {
  return z.stats.moveSpeed * (p2(z) ? bp(z).phase2.speedMul : 1);
}
function chargeHalfWidth(z: Zombie, ctx: ZombieContext): number {
  return z.stats.radius + ctx.target.radius;
}

function bossZone(z: Zombie, ctx: ZombieContext, out: DangerZone): boolean {
  if (z.state !== ZombieState.Special) return false;
  const b = bp(z);
  out.x = z.position.x;
  out.z = z.position.z;
  out.yaw = z.yaw;
  out.mode = 'warn';
  out.color = p2(z) ? 0xff2a40 : 0xff4020;
  switch (z.special) {
    case 'melee':
      if (z.hitDone) return false;
      out.shape = 'sector';
      out.radius = b.meleeRange;
      out.half = THREE.MathUtils.degToRad(b.meleeArcDeg);
      out.progress = Math.min(1, z.specialTime / wind(z, b.meleeWindup));
      return true;
    case 'slam':
      if (z.hitDone) return false;
      out.shape = 'circle';
      out.radius = slamRadius(z);
      out.half = 0;
      out.progress = Math.min(1, z.specialTime / wind(z, b.slamWindup));
      return true;
    case 'chargePrep':
      // 직선 길이 = 보스 중심 이동 거리 + 몸이 닿는 거리 (끝에서도 몸에 닿으면 피해이므로)
      out.shape = 'lane';
      out.half = chargeHalfWidth(z, ctx);
      out.radius = z.lockLen + out.half;
      out.progress = Math.min(1, z.specialTime / wind(z, b.chargeWindup));
      return true;
    case 'charge':
      out.shape = 'lane';
      out.yaw = z.heading;
      out.half = chargeHalfWidth(z, ctx);
      out.radius = Math.max(0, z.lockLen - z.travel) + out.half;
      out.progress = 1;
      out.mode = 'active';
      return z.lockLen - z.travel > 0.2;
  }
  return false;
}

/** 돌진 경로 길이: 앞쪽 장애물까지 (몸 반경만큼 여유) */
function chargeLength(z: Zombie, ctx: ZombieContext): number {
  const b = bp(z);
  const fx = Math.sin(z.yaw);
  const fz = Math.cos(z.yaw);
  const x1 = z.position.x + fx * b.chargeDistance;
  const z1 = z.position.z + fz * b.chargeDistance;
  let len = b.chargeDistance;
  if (ctx.collision.raycast(z.position.x, z.position.z, x1, z1, 0.6, ray)) len = b.chargeDistance * ray.t;
  return Math.max(0, len - z.stats.radius * 0.5);
}

const boss: EnemyBehavior = {
  interruptible: false,
  chase(z, _dt, ctx, m) {
    const b = bp(z);
    if (tryPhase2(z, ctx)) return true;
    if (z.cdGap > 0) return bossMove(z, _dt, ctx, m);
    const slamR = b.slamTrigger * (p2(z) ? b.phase2.slamRadiusMul : 1);
    if (m.dist <= b.meleeRange * 0.9 && z.cdA <= 0) {
      // 가까우면 근접. 지면 강타가 준비됐으면 가끔 강타로 섞음
      if (z.cdC <= 0 && Math.random() < 0.35) startSlam(z, ctx);
      else { z.setSpecial('melee'); }
      return true;
    }
    if (m.dist <= slamR && z.cdC <= 0) {
      startSlam(z, ctx);
      return true;
    }
    if (z.cdB <= 0 && z.hasLos && m.dist >= b.chargeMinDist && m.dist <= b.chargeMaxDist) {
      z.setSpecial('chargePrep');
      z.lockLen = chargeLength(z, ctx);
      ctx.events.emit('chargePrep', z);
      return true;
    }
    return bossMove(z, _dt, ctx, m);
  },
  special(z, dt, ctx, m) {
    const s = z.stats;
    const b = bp(z);
    const t = ctx.target;
    m.mvx = m.mvz = 0;
    // 공격 준비 · 회복 중에 체력이 50% 아래로 내려가도 바로 전환 (돌진 중에는 돌진이 끝난 뒤)
    if (z.special !== 'charge' && z.special !== 'roar' && tryPhase2(z, ctx)) return;
    switch (z.special) {
      case 'roar':
        // 페이즈 전환 연출: 제자리에서 포효 (공격 없음)
        if (z.specialTime >= b.phase2.roarTime) { z.cdGap = 0.4; z.endSpecial(); }
        return;

      case 'melee': {
        // 패턴 A: 준비(팔 들기) → 강타 → 회복
        const w = wind(z, b.meleeWindup);
        if (z.specialTime < w * 0.7) z.turnToward(m.toTarget, s.turnSpeed * 0.8, dt);
        if (!z.hitDone && z.specialTime >= w) {
          const zone = bossZone(z, ctx, zoneTmp) ? zoneTmp : null;
          z.hitDone = true;
          const hit = zone ? z.strike(t, zone, s.attackDamage) : false;
          ctx.events.emit('bossSwing', z, hit ? 1 : 0);
        }
        if (z.specialTime >= w + cool(z, b.meleeRecover)) {
          z.cdA = cool(z, b.meleeInterval);
          z.cdGap = cool(z, b.patternGap);
          z.endSpecial();
        }
        return;
      }

      case 'slam': {
        // 패턴 C: 양팔을 들어 올림(바닥 원 표시) → 내려침 → 회복
        const w = wind(z, b.slamWindup);
        if (!z.hitDone && z.specialTime >= w) {
          const zone = bossZone(z, ctx, zoneTmp) ? zoneTmp : null;
          z.hitDone = true;
          const hit = zone ? z.strike(t, zone, s.attackDamage * b.slamDamageMul) : false;
          ctx.events.emit('slam', z, hit ? 1 : 0);
        }
        if (z.specialTime >= w + cool(z, b.slamRecover)) {
          z.cdC = cool(z, b.slamCooldown);
          z.cdGap = cool(z, b.patternGap);
          z.endSpecial();
        }
        return;
      }

      case 'chargePrep': {
        // 패턴 B 준비: 플레이어를 따라 방향을 잡다가 마지막 chargeLock 초는 방향 고정
        const w = wind(z, b.chargeWindup);
        if (z.specialTime < w - b.chargeLock) {
          z.turnToward(m.toTarget, 2.6, dt);
          z.lockLen = chargeLength(z, ctx);
        }
        if (z.specialTime >= w) {
          z.heading = z.yaw;
          z.travel = 0;
          z.setSpecial('charge');
          ctx.events.emit('chargeStart', z);
        }
        return;
      }

      case 'charge': {
        // 돌진: 방향 전환은 아주 조금만. 장애물에 부딪히거나 거리를 다 가면 종료
        z.steerHeading(m.toTarget, b.chargeTurnRate, dt);
        z.yaw = z.heading;
        m.mvx = Math.sin(z.heading) * b.chargeSpeed;
        m.mvz = Math.cos(z.heading) * b.chargeSpeed;
        z.travel += z.specialTime > dt * 1.5 ? z.moveSpeed * dt : b.chargeSpeed * dt;
        if (!z.hitDone && t.isAlive() && m.dist <= chargeHalfWidth(z, ctx) + 0.1) {
          z.hitDone = true;
          hitTmp.radius = m.dist + 1; // 몸이 닿은 순간 = 판정
          hitTmp.x = z.position.x; hitTmp.z = z.position.z;
          if (z.strike(t, hitTmp, s.attackDamage * b.chargeDamageMul)) ctx.events.emit('chargeHit', z);
        }
        const wall = z.specialTime > 0.12 && z.blocked && z.moveSpeed < b.chargeSpeed * 0.5;
        // 거리를 다 가거나, 플레이어 등에 막혀 예정 시간을 넘기면 종료
        const timeout = z.specialTime > z.lockLen / b.chargeSpeed + 0.5;
        if (wall || z.travel >= z.lockLen || timeout) {
          z.aux = wall ? b.chargeWallRecover : b.chargeRecover;
          if (wall) ctx.events.emit('chargeWall', z);
          z.setSpecial('recover');
        }
        return;
      }

      case 'recover':
        // 돌진 후 회복 (빈틈)
        if (z.specialTime >= cool(z, z.aux)) {
          z.cdB = p2(z) ? b.phase2.chargeCooldown : b.chargeCooldown;
          z.cdGap = cool(z, b.patternGap);
          z.endSpecial();
        }
        return;

      default:
        z.endSpecial();
    }
  },
  zone(z, ctx, out) {
    return bossZone(z, ctx, out);
  },
};

/** 2페이즈 전환: 체력 50% 이하에서 단 한 번 (짧은 포효 연출) */
function tryPhase2(z: Zombie, ctx: ZombieContext): boolean {
  if (z.phase !== 1 || z.health > z.maxHealth * bp(z).phase2.threshold) return false;
  z.phase = 2;
  z.phaseShifts++;
  z.setSpecial('roar');
  ctx.events.emit('phase2', z);
  return true;
}

const hitTmp: DangerZone = { ...emptyZone(), shape: 'circle' };

function startSlam(z: Zombie, ctx: ZombieContext): void {
  z.setSpecial('slam');
  ctx.events.emit('roar', z, 0);
}

/** 보스 기본 이동: 곡선 추적 (2페이즈 속도 증가) */
function bossMove(z: Zombie, dt: number, ctx: ZombieContext, m: MoveInfo): boolean {
  const s = z.stats;
  const contact = s.radius + ctx.target.radius + 0.3;
  if (m.dist < contact) {
    z.turnToward(m.toTarget, s.turnSpeed, dt);
    m.mvx = m.mvz = 0;
    return true;
  }
  z.pathDirection(ctx, m, tmpDir);
  const want = Math.atan2(tmpDir.x, tmpDir.z);
  const diff = z.steerHeading(want, s.steerRate, dt);
  const k = Math.max(0.35, Math.cos(Math.min(Math.PI / 2, Math.abs(diff))));
  const sp = bossSpeed(z) * k;
  m.mvx = Math.sin(z.heading) * sp;
  m.mvz = Math.cos(z.heading) * sp;
  z.turnToward(m.dist < 6 && z.hasLos ? m.toTarget : z.heading, s.turnSpeed, dt);
  return true;
}

/** 종류 → 행동 모듈 (워커 · 탱커는 공통 근접 AI 만 사용) */
export const ENEMY_BEHAVIORS: Partial<Record<string, EnemyBehavior>> = {
  runner,
  spitter,
  exploder,
  boss,
};

/** 지금 표시할 위험 범위 (행동 모듈 범위 + 탱커 등 일반 공격 범위) */
export function dangerZone(z: Zombie, ctx: ZombieContext, out: DangerZone): boolean {
  if (!z.alive) return false;
  const b = ENEMY_BEHAVIORS[z.stats.kind];
  if (b?.zone && b.zone(z, ctx, out)) return true;
  return z.meleeZone(out);
}
