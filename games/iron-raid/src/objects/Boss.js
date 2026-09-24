import * as Phaser from 'phaser';
import { sfx, playBgm, stopBgm } from '../sfx.js';

// Stage 1 boss: the "Greybaikal" gunboat.
// Phase 1: shoot the armour plates. Phase 2: the engine core is exposed and it gets angrier.
export class Boss {
  constructor(scene, x, waterY) {
    this.scene = scene;
    this.x = x; // left edge of the hull
    this.baseY = waterY - 72; // top of the hull image when surfaced
    this.y = this.baseY + 90; // starts submerged
    this.isEnemy = true;
    this.big = true;
    this.dead = false;
    this.active = false;
    this.phase = 1;
    this.armorHp = 60;
    this.coreHp = 80;
    this.t = 0;
    this.cannonT = 2;
    this.doorT = 3;
    this.fireT = 2;
    this.flash = 0;
    this.deathT = 0;

    const d = 9;
    this.hull = scene.add.image(0, 0, 'boss_hull').setOrigin(0, 0).setDepth(d);
    this.core = scene.add.sprite(0, 0, 'boss_core', 'core_0').setOrigin(0, 0).setDepth(d + 0.1);
    this.armor = [0, 1].map(() => scene.add.image(0, 0, 'boss_armor').setOrigin(0, 0).setDepth(d + 0.2));
    this.cannon = scene.add.image(0, 0, 'boss_cannon').setOrigin(0.7, 0.6).setDepth(d + 0.3);
    this.door = scene.add.sprite(0, 0, 'boss_door', 'door_0').setOrigin(0, 0).setDepth(d + 0.1);
    this.parts = [this.hull, this.core, ...this.armor, this.cannon, this.door];
    this.place();
  }

  place() {
    const { x, y } = this;
    this.hull.setPosition(x, y);
    this.core.setPosition(x + 30, y + 44);
    if (!this.armorFell) {
      this.armor[0].setPosition(x + 22, y + 40);
      this.armor[1].setPosition(x + 58, y + 40);
    }
    this.cannon.setPosition(x + 112, y + 16);
    this.door.setPosition(x + 94, y + 38);
  }

  start() {
    this.active = 'rising';
    sfx.alarm();
    stopBgm();
    this.scene.showBanner('WARNING!');
    this.scene.cameras.main.shake(2000, 0.006);
    this.scene.tweens.add({
      targets: this,
      y: this.baseY,
      duration: 2400,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.active = true;
        playBgm('boss');
      },
    });
  }

  hitRect() {
    if (this.phase === 1) return new Phaser.Geom.Rectangle(this.x + 22, this.y + 40, 80, 32);
    return new Phaser.Geom.Rectangle(this.x + 30, this.y + 44, 40, 28);
  }

  // Armoured parts of the silhouette (not in front of the weak spot): bullets stop here with a clank.
  shellRects() {
    return [
      new Phaser.Geom.Rectangle(this.x + 64, this.y + 18, 104, 22),
      new Phaser.Geom.Rectangle(this.x + 106, this.y + 40, 62, 40),
    ];
  }

  hurt(dmg) {
    if (this.dead || this.active !== true) return false;
    this.flash = 0.05;
    if (this.phase === 1) {
      this.armorHp -= dmg;
      if (this.armorHp <= 0) this.breakArmor();
    } else {
      this.coreHp -= dmg;
      if (this.coreHp <= 0) this.die();
    }
    return true;
  }

  breakArmor() {
    const s = this.scene;
    this.phase = 2;
    this.armorFell = true;
    s.explode(this.x + 60, this.y + 56, 'l', { radius: 0 });
    s.addScore(5000, this.x + 60, this.y + 30);
    this.armor.forEach((a, i) => {
      s.tweens.add({ targets: a, y: a.y + 90, x: a.x - 20 + i * 30, angle: i ? 40 : -40, duration: 900, ease: 'Quad.easeIn', onComplete: () => { s.splash(a.x + 20); a.destroy(); } });
    });
    this.cannonT = 1;
    this.fireT = 1.5;
  }

  die() {
    const s = this.scene;
    this.dead = true;
    this.deathT = 0;
    stopBgm();
    s.addScore(20000, this.x + 60, this.y + 20);
    s.onBossDefeated();
  }

  update(dt) {
    const s = this.scene;
    this.t += dt;
    this.place();
    this.core.setFrame(`core_${Math.floor(this.t * (this.phase === 2 ? 10 : 3)) % 2}`);
    this.flash -= dt;
    const tintables = [this.hull, this.core, ...this.armor.filter((a) => a.active)];
    tintables.forEach((p) => (this.flash > 0 ? p.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL) : p.clearTint()));

    if (this.dead) {
      this.deathT += dt;
      if (this.deathT < 2.6 && Math.random() < dt * 12) {
        s.explode(this.x + 20 + Math.random() * 140, this.y + 20 + Math.random() * 50, Math.random() < 0.3 ? 'l' : 's', { radius: 0 });
      }
      if (this.deathT > 2.2) this.y += dt * 40;
      if (this.deathT > 2.2 && Math.random() < dt * 6) s.splash(this.x + Math.random() * 170);
      if (this.deathT > 4.5) {
        this.parts.forEach((p) => p.active && p.destroy());
        this.gone = true;
      }
      return;
    }
    if (this.active !== true) return;

    const p = s.player.tank || s.player;
    // aim the deck cannon at the player
    const ang = Math.atan2(p.y - 30 - this.cannon.y, p.x - this.cannon.x);
    this.cannon.setRotation(Phaser.Math.Clamp(ang - Math.PI, -0.9, 0.5));

    this.cannonT -= dt;
    if (this.cannonT <= 0) {
      this.cannonT = this.phase === 1 ? 2.8 : 1.8;
      const g = s.physics.world.gravity.y;
      const n = this.phase === 1 ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const tt = 1.0 + i * 0.25;
        const tx = p.x + (i - (n - 1) / 2) * 34;
        const sx = this.cannon.x - 26, sy = this.cannon.y - 8;
        s.spawnEnemyShell(sx, sy, (tx - sx) / tt, (p.y - 6 - sy - 0.5 * g * tt * tt) / tt);
      }
      sfx.cannon();
    }

    if (this.phase === 1) {
      this.doorT -= dt;
      const open = this.doorT < 0.6 ? (this.doorT < 0.3 ? 2 : 1) : 0;
      this.door.setFrame(`door_${open}`);
      if (this.doorT <= 0) {
        this.doorT = 5;
        if (s.countSoldiers() < 3) {
          const sol = s.spawnSoldier(this.x + 102, this.y + 56, Math.random() < 0.5 ? 'rifle' : 'knife', 'attack');
          sol.body.setVelocity(-250, -210);
        }
      }
    } else {
      this.door.setFrame('door_0');
      this.fireT -= dt;
      if (this.fireT <= 0) {
        this.fireT = 2.4;
        for (let i = 0; i < 3; i++) {
          s.time.delayedCall(i * 220, () => {
            if (this.dead) return;
            s.spawnFireball(this.x + 30, this.y + 58);
          });
        }
      }
      if (Math.random() < dt * 6) s.puff(this.x + 40 + Math.random() * 60, this.y + 30);
    }
  }
}
