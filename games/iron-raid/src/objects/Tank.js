import * as Phaser from 'phaser';
import { sfx } from '../sfx.js';

// The player's slug. Jump into it; Z = vulcan (aims with up/down), C = cannon, Down+X = bail out.
export class Tank extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'tank', 'tank_0_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(19);
    this.body.setSize(44, 30).setOffset(6, 10);
    this.vulcan = scene.add.image(x, y, 'vulcan').setOrigin(0.1, 0.5).setDepth(21);
    this.arrow = scene.add.image(x, y - 50, 'arrow_in').setDepth(22);
    this.hp = 3;
    this.maxHp = 3;
    this.shells = 10;
    this.facing = 1;
    this.angleV = 0; // vulcan angle in radians (0 = right)
    this.fireCd = 0;
    this.cannonCd = 0;
    this.treadT = 0;
    this.hurtT = 0;
    this.dying = -1;
    this.driver = null;
    this.noEnter = 0;
    this.t = 0;
  }

  hitRect() {
    const b = this.body;
    return new Phaser.Geom.Rectangle(b.x + 2, b.y + 4, b.width - 4, b.height - 4);
  }

  get onGround() {
    return this.body.blocked.down || this.body.touching.down;
  }

  enter(player) {
    if (this.driver || this.dying >= 0) return;
    this.driver = player;
    player.tank = this;
    player.setVisible(false);
    player.body.enable = false;
    this.facing = player.facing;
    this.angleV = this.facing > 0 ? 0 : Math.PI;
    sfx.enter();
    this.scene.showBanner('SLUG ON!');
  }

  exit() {
    const p = this.driver;
    if (!p) return;
    this.driver = null;
    p.tank = null;
    p.body.enable = true;
    p.setVisible(true);
    p.setPosition(this.x, this.y - 32);
    p.body.setVelocity(0, -230);
    p.invuln = Math.max(p.invuln, 0.8);
    this.noEnter = 1.2; // don't fall straight back in
  }

  hurt(n = 1) {
    if (this.dying >= 0 || this.hurtT > 0) return false;
    this.hp -= n;
    this.hurtT = 0.5;
    sfx.clank();
    if (this.hp <= 0) {
      this.hp = 0;
      this.dying = 0;
      this.scene.showBanner('SLUG DANGER!');
    }
    return true;
  }

  update(dt, inp) {
    const s = this.scene;
    this.t += dt;
    this.hurtT -= dt;
    this.noEnter = (this.noEnter || 0) - dt;
    this.fireCd -= dt;
    this.cannonCd -= dt;
    const dmg = this.hp < this.maxHp ? 1 : 0;
    this.arrow.setVisible(!this.driver && this.dying < 0 && Math.floor(this.t * 3) % 2 === 0);
    this.arrow.setPosition(this.x, this.y - 48);

    if (this.dying >= 0) {
      this.dying += dt;
      this.setTint(Math.floor(this.dying * 12) % 2 ? 0xff6655 : 0xffffff);
      if (this.driver && inp && inp.down && inp.jumpPressed) this.exit();
      if (this.dying > 1.2) {
        const had = this.driver;
        if (had) {
          this.exit();
          had.invuln = 0;
          had.kill();
        }
        s.explode(this.x, this.y - 16, 'l', { radius: 34, dmg: 10, hurtsPlayer: false });
        this.vulcan.destroy();
        this.arrow.destroy();
        this.destroy();
        return;
      }
      if (!this.driver) this.body.setVelocityX(0);
      if (!this.driver) return;
    } else {
      this.setTint(this.hurtT > 0 && Math.floor(this.hurtT * 20) % 2 ? 0xff9988 : 0xffffff);
    }

    if (!this.driver) {
      this.body.setVelocityX(0);
      this.setFrame(`tank_0_${dmg}`);
      this.placeVulcan();
      return;
    }

    // driving
    let vx = 0;
    if (inp.left) { vx = -1; this.facing = -1; }
    if (inp.right) { vx = 1; this.facing = 1; }
    this.body.setVelocityX(vx * 80);
    if (inp.down && inp.jumpPressed) { this.exit(); return; }
    if (inp.jumpPressed && this.onGround) this.body.setVelocityY(-210);

    const cam = s.cameras.main;
    const minX = cam.scrollX + 22;
    const maxX = Math.min(cam.scrollX + cam.width - 22, s.playerMaxX);
    if (this.x < minX) this.x = minX;
    if (this.x > maxX) this.x = maxX;

    // vulcan aim: rotate toward the held direction
    let target = this.facing > 0 ? 0 : Math.PI;
    if (inp.up) target = -Math.PI / 2;
    else if (inp.down && !this.onGround) target = Math.PI / 2;
    const diff = Phaser.Math.Angle.Wrap(target - this.angleV);
    const step = 9 * dt;
    this.angleV += Math.abs(diff) < step ? diff : Math.sign(diff) * step;

    if (inp.fire && this.fireCd <= 0) {
      this.fireCd = 0.075;
      const [mx, my] = this.vulcanTip();
      const j = (Math.random() - 0.5) * 0.1;
      s.spawnPlayerBullet(mx, my, Math.cos(this.angleV + j) * 420, Math.sin(this.angleV + j) * 420, 1);
      sfx.vulcan();
    }
    if (inp.bombPressed && this.shells > 0 && this.cannonCd <= 0) {
      this.shells -= 1;
      this.cannonCd = 0.5;
      s.spawnCannonShell(this.x + this.facing * 30, this.y - 26, this.facing);
      sfx.cannon();
      s.cameras.main.shake(80, 0.004);
    }

    if (vx) this.treadT += dt * 14;
    this.setFlipX(this.facing < 0);
    this.setFrame(`tank_${Math.floor(this.treadT) % 3}_${dmg}`);
    this.placeVulcan();
    this.driver.setPosition(this.x, this.y);
  }

  placeVulcan() {
    this.vulcan.setPosition(this.x - this.facing * 2, this.y - 32);
    this.vulcan.setRotation(this.angleV);
  }

  vulcanTip() {
    return [this.x - this.facing * 2 + Math.cos(this.angleV) * 14, this.y - 32 + Math.sin(this.angleV) * 14];
  }
}
