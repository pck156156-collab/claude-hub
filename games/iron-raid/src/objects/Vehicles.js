import * as Phaser from 'phaser';
import { sfx } from '../sfx.js';

// Light armoured car: drives in, lobs shells and fires short machine-gun bursts.
export class Apc extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, stopX) {
    super(scene, x, y, 'apc', 'apc_0_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(16).setFlipX(true);
    this.body.setSize(56, 26).setOffset(4, 10);
    this.stopX = stopX;
    this.hp = 30;
    this.maxHp = 30;
    this.isEnemy = true;
    this.big = true;
    this.dead = false;
    this.t = 0;
    this.shellT = 1.5;
    this.gunT = 3;
    this.burst = 0;
    this.flash = 0;
  }

  hitRect() {
    const b = this.body;
    return new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
  }

  hurt(dmg) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.flash = 0.05;
    if (this.hp <= 0) {
      this.dead = true;
      this.scene.explode(this.x, this.y - 16, 'l', { radius: 30, dmg: 5, hurtsPlayer: false });
      this.scene.debris(this.x, this.y - 20, 8);
      this.scene.addScore(1500, this.x, this.y - 40);
      this.scene.onEnemyKilled(this);
      this.setFrame('apc_0_2');
      this.clearTint();
    }
    return true;
  }

  update(dt) {
    if (this.dead) {
      this.body.setVelocityX(0);
      if (Math.random() < dt * 3) this.scene.puff(this.x + (Math.random() - 0.5) * 30, this.y - 24);
      return;
    }
    const s = this.scene;
    this.t += dt;
    this.flash -= dt;
    if (this.flash > 0) this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else this.clearTint();
    const moving = this.x > this.stopX;
    this.body.setVelocityX(moving ? -40 : 0);
    const dmg = this.hp < this.maxHp / 2 ? 1 : 0;
    this.setFrame(`apc_${moving ? Math.floor(this.t * 8) % 2 : 0}_${dmg}`);
    if (dmg && Math.random() < dt * 4) s.puff(this.x + 10, this.y - 26);
    if (moving && this.x > s.cameras.main.scrollX + s.cameras.main.width) return;

    const p = s.player.tank || s.player;
    this.shellT -= dt;
    if (this.shellT <= 0) {
      this.shellT = 2.4;
      const tt = 1.1;
      const g = s.physics.world.gravity.y;
      const sx = this.x - 30, sy = this.y - 28;
      const vx = (p.x - sx) / tt;
      const vy = (p.y - 8 - sy - 0.5 * g * tt * tt) / tt;
      s.spawnEnemyShell(sx, sy, vx, vy);
      sfx.cannon();
    }
    this.gunT -= dt;
    if (this.gunT <= 0) {
      this.burst += 1;
      this.gunT = this.burst % 4 === 0 ? 2.8 : 0.14;
      s.spawnEnemyBullet(this.x - 30, this.y - 20, -130, 0);
      sfx.enemyShot();
    }
  }
}

// Attack helicopter: hovers above the player and drops bombs.
export class Heli extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'heli', 'heli_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setAllowGravity(false);
    this.setDepth(17).setFlipX(true);
    this.body.setSize(40, 20).setOffset(20, 8);
    this.hp = 18;
    this.isEnemy = true;
    this.big = true;
    this.dead = false;
    this.t = 0;
    this.bombT = 2;
    this.flash = 0;
  }

  hitRect() {
    const b = this.body;
    return new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
  }

  hurt(dmg) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.flash = 0.05;
    if (this.hp <= 0) {
      this.dead = true;
      this.clearTint();
      this.body.setAllowGravity(true);
      this.body.setVelocity(-30, -40);
      this.scene.addScore(2000, this.x, this.y - 20);
      this.scene.onEnemyKilled(this);
      sfx.boom();
      this.scene.explode(this.x, this.y, 's', { radius: 0 });
    }
    return true;
  }

  update(dt) {
    const s = this.scene;
    this.t += dt;
    this.setFrame(`heli_${Math.floor(this.t * 20) % 3}`);
    if (this.dead) {
      this.angle -= 120 * dt;
      if (Math.random() < dt * 10) s.puff(this.x, this.y);
      if (this.y > 180) {
        s.explode(this.x, this.y, 'l', { radius: 30, dmg: 5, hurtsPlayer: true });
        s.debris(this.x, this.y, 10);
        this.destroy();
      }
      return;
    }
    this.flash -= dt;
    if (this.flash > 0) this.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    else this.clearTint();
    const p = s.player.tank || s.player;
    const cam = s.cameras.main;
    const tx = Phaser.Math.Clamp(p.x + 30 + Math.sin(this.t * 0.8) * 50, cam.scrollX + 40, cam.scrollX + cam.width - 40);
    const ty = 46 + Math.sin(this.t * 2) * 6;
    this.body.setVelocity((tx - this.x) * 1.2, (ty - this.y) * 2);
    this.setAngle(Phaser.Math.Clamp(this.body.velocity.x * 0.15, -10, 10));
    this.bombT -= dt;
    if (this.bombT <= 0 && this.x < cam.scrollX + cam.width - 20) {
      this.bombT = 1.5;
      s.spawnBomb(this.x, this.y + 12);
    }
  }
}
