import * as Phaser from 'phaser';
import { sfx } from '../sfx.js';

const GUN = { pistol: 'p', rifle: 'r', shotgun: 'b', rocket: 'b' };
export const WEAPONS = {
  pistol: { name: 'PISTOL', ammo: Infinity },
  rifle: { name: 'HEAVY RIFLE', ammo: 200 },
  shotgun: { name: 'SCATTER GUN', ammo: 30 },
  rocket: { name: 'ROCKET', ammo: 30 },
};
const SPEED = 72;
const CROUCH_SPEED = 30;
const JUMP_V = -250;

export class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y) {
    super(scene, x, y, 'player', 'p_idle_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(20);
    this.body.setSize(12, 30).setOffset(14, 14);
    this.reset(x, y);
  }

  reset(x, y) {
    this.setPosition(x, y);
    this.body.enable = true;
    this.body.setVelocity(0, 0);
    this.setVisible(true).setAlpha(1).setAngle(0);
    this.facing = 1;
    this.weapon = 'pistol';
    this.ammo = Infinity;
    this.bombs = 10;
    this.dead = false;
    this.deadT = 0;
    this.invuln = 0;
    this.fireCd = 0;
    this.holdT = 0;
    this.action = null;
    this.actionT = 0;
    this.runT = 0;
    this.flashT = 0;
    this.idleT = 0;
    this.aim = 'fwd';
    this.crouch = false;
    this.tank = null;
    this.won = false;
    this.dropT = 0;
    this.standingOn = null;
  }

  get onGround() {
    return this.body.blocked.down || this.body.touching.down;
  }

  hitRect() {
    const b = this.body;
    return new Phaser.Geom.Rectangle(b.x + 2, b.y + 2, b.width - 4, b.height - 2);
  }

  setWeapon(w) {
    this.weapon = w;
    this.ammo = WEAPONS[w].ammo;
  }

  kill() {
    if (this.dead || this.invuln > 0 || this.won) return false;
    this.dead = true;
    this.deadT = 0;
    this.tank = null;
    this.body.setVelocity(-this.facing * 40, -120);
    sfx.die();
    this.scene.onPlayerHit();
    return true;
  }

  // Where bullets leave the gun, in world space.
  muzzle() {
    const f = this.facing;
    const g = GUN[this.weapon];
    const len = g === 'p' ? 8 : g === 'r' ? 13 : 14;
    if (this.aim === 'up') return [this.x + f * 7, this.y - 29 - len];
    if (this.aim === 'down') return [this.x + f * 4, this.y - 4];
    if (this.crouch) return [this.x + f * (6 + len), this.y - 16];
    return [this.x + f * (6 + len), this.y - 21];
  }

  update(dt, inp) {
    const s = this.scene;
    if (this.won) {
      this.body.setVelocityX(0);
      this.setFrame(`win_${Math.floor(this.deadT * 3) % 2}`);
      this.deadT += dt;
      return;
    }
    if (this.dead) {
      this.deadT += dt;
      const i = Math.min(5, Math.floor(this.deadT * 10));
      this.setFrame(`die_${i}`);
      if (this.onGround) this.body.setVelocityX(0);
      if (this.deadT > 0.9) this.setVisible(Math.floor(this.deadT * 12) % 2 === 0);
      if (this.deadT > 1.6) s.respawnPlayer();
      return;
    }
    if (this.invuln > 0) {
      this.invuln -= dt;
      this.setAlpha(Math.floor(this.invuln * 16) % 2 ? 0.35 : 1);
      if (this.invuln <= 0) this.setAlpha(1);
    }
    if (this.tank) return; // the tank drives

    this.fireCd -= dt;
    this.flashT -= dt;
    this.actionT -= dt;
    if (this.actionT <= 0) this.action = null;

    const ground = this.onGround;
    // movement
    let vx = 0;
    this.crouch = inp.down && ground;
    if (inp.left) { vx -= 1; this.facing = -1; }
    if (inp.right) { vx += 1; this.facing = 1; }
    const speed = this.crouch ? CROUCH_SPEED : SPEED;
    this.body.setVelocityX(vx * speed);
    this.dropT -= dt;
    const onRoof = ground && this.standingOn && this.standingOn.oneWay;
    if (inp.jumpPressed && onRoof && inp.down) this.dropT = 0.25;
    else if (inp.jumpPressed && ground) this.body.setVelocityY(this.crouch ? JUMP_V * 0.8 : JUMP_V);
    if (!ground) this.standingOn = null;

    // keep inside the camera view
    const cam = s.cameras.main;
    const minX = cam.scrollX + 8;
    const maxX = Math.min(cam.scrollX + cam.width - 8, s.playerMaxX);
    if (this.x < minX) { this.x = minX; this.body.setVelocityX(Math.max(0, this.body.velocity.x)); }
    if (this.x > maxX) { this.x = maxX; this.body.setVelocityX(Math.min(0, this.body.velocity.x)); }

    // aim
    this.aim = inp.up ? 'up' : inp.down && !ground ? 'down' : 'fwd';
    if (this.crouch) this.aim = 'fwd';

    // body size for crouching
    if (this.crouch) this.body.setSize(12, 20).setOffset(14, 24);
    else this.body.setSize(12, 30).setOffset(14, 14);

    // shooting
    this.holdT = inp.fire ? this.holdT + dt : 0;
    const auto = this.weapon === 'rifle' ? inp.fire : inp.fire && this.holdT > 0.25;
    if ((inp.firePressed || auto) && this.fireCd <= 0 && this.action !== 'throw') this.fire(inp.firePressed);
    if (inp.bombPressed && this.bombs > 0 && this.action !== 'throw') this.throwGrenade();

    this.pickFrame(dt, ground, vx);
  }

  fire(tap) {
    const s = this.scene;
    const f = this.facing;
    const target = s.findMeleeTarget(this);
    if (target) {
      this.action = 'knife';
      this.actionT = 0.22;
      this.fireCd = 0.22;
      sfx.knife();
      target.hurt(10, 'melee');
      return;
    }
    const [mx, my] = this.muzzle();
    const dir = this.aim === 'up' ? [0, -1] : this.aim === 'down' ? [0, 1] : [f, 0];
    switch (this.weapon) {
      case 'pistol':
        s.spawnPlayerBullet(mx, my, dir[0] * 380, dir[1] * 380, 1);
        this.fireCd = tap ? 0.1 : 0.2;
        sfx.pistol();
        break;
      case 'rifle': {
        const j = (Math.random() - 0.5) * 0.12;
        const a = Math.atan2(dir[1], dir[0]) + j;
        const off = (Math.random() - 0.5) * 4;
        s.spawnPlayerBullet(mx + (dir[1] ? off : 0), my + (dir[0] ? off : 0), Math.cos(a) * 420, Math.sin(a) * 420, 1);
        this.fireCd = 0.07;
        sfx.rifle();
        break;
      }
      case 'shotgun':
        s.shotgunBlast(mx, my, dir);
        this.fireCd = 0.45;
        sfx.shotgun();
        break;
      case 'rocket':
        s.spawnRocket(mx, my, dir);
        this.fireCd = 0.35;
        sfx.rocket();
        break;
    }
    this.flashT = 0.06;
    if (this.weapon !== 'pistol') {
      this.ammo -= 1;
      if (this.ammo <= 0) this.setWeapon('pistol');
    }
  }

  throwGrenade() {
    this.bombs -= 1;
    this.action = 'throw';
    this.actionT = 0.3;
    sfx.throw();
    this.scene.time.delayedCall(90, () => {
      if (this.dead || this.tank) return;
      this.scene.spawnGrenade(this.x + this.facing * 6, this.y - (this.crouch ? 20 : 32), this.facing * 115 + this.body.velocity.x * 0.3, -190, true);
    });
  }

  pickFrame(dt, ground, vx) {
    const g = GUN[this.weapon];
    const legs = !ground ? 'jump' : this.crouch ? 'crouch' : vx ? 'run' : 'stand';
    this.setFlipX(this.facing < 0);
    if (this.action === 'throw' || this.action === 'knife') {
      const l = legs === 'run' ? 'stand' : legs;
      if (this.action === 'throw') this.setFrame(`throw_${l}_${Math.min(2, Math.floor((0.3 - this.actionT) / 0.1))}`);
      else this.setFrame(`knife_${l}_${this.actionT > 0.14 ? 0 : 1}`);
      return;
    }
    const fl = this.flashT > 0 ? 1 : 0;
    if (legs === 'run') {
      this.runT += dt * 12;
      this.setFrame(`${g}_run_${this.aim === 'up' ? 'up' : 'fwd'}_${fl}_${Math.floor(this.runT) % 8}`);
      this.idleT = 0;
    } else if (legs === 'jump') {
      this.setFrame(`${g}_jump_${this.aim}_${fl}`);
    } else if (legs === 'crouch') {
      this.setFrame(`${g}_crouch_fwd_${fl}`);
    } else if (this.aim === 'up' || fl) {
      this.setFrame(`${g}_stand_${this.aim === 'up' ? 'up' : 'fwd'}_${fl}`);
    } else {
      this.idleT += dt;
      this.setFrame(`${g}_idle_${Math.floor(this.idleT * 2.5) % 2}`);
    }
  }
}
