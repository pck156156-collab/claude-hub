import * as Phaser from 'phaser';
import { sfx } from '../sfx.js';

// Enemy infantry. kind: 'rifle' | 'knife' | 'grenadier'. state: 'idle' (chatting) or 'attack'.
export class Soldier extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, kind = 'rifle', state = 'attack') {
    super(scene, x, y, 'soldier', 'chat_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(15);
    this.body.setSize(12, 30).setOffset(14, 14);
    this.kind = kind;
    this.state = state;
    this.t = Math.random() * 2;
    this.stateT = 0;
    this.hp = 1;
    this.dead = false;
    this.isEnemy = true;
    this.facing = -1;
    this.actT = 1 + Math.random() * 1.2;
    this.animT = Math.random() * 8;
    this.keepDist = kind === 'grenadier' ? 120 : 90 + Math.random() * 50;
  }

  hitRect() {
    const b = this.body;
    return new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
  }

  alert() {
    if (this.state === 'idle') this.setState2('alert');
  }

  setState2(s) {
    this.state = s;
    this.stateT = 0;
    if (s === 'alert') {
      if (this.body.blocked.down) this.body.setVelocityY(-110);
      this.body.setVelocityX(0);
    }
  }

  hurt(dmg, kind = 'shot') {
    if (this.dead) return false;
    this.hp -= dmg;
    if (this.hp > 0) return true;
    this.dead = true;
    this.deathKind = kind;
    this.stateT = 0;
    sfx.scream();
    this.scene.addScore(kind === 'melee' ? 200 : 100, this.x, this.y - 40);
    this.scene.onEnemyKilled(this);
    if (kind === 'blast') {
      this.setFrame('hurt_0');
      this.body.checkCollision.none = true;
      this.body.setVelocity((Math.random() - 0.5) * 80 - this.facing * 40, -230);
      this.body.setAngularVelocity?.(0);
      this.spin = (Math.random() < 0.5 ? -1 : 1) * 600;
    } else {
      this.body.setVelocityX(-this.facing * 20);
    }
    return true;
  }

  update(dt) {
    const s = this.scene;
    this.t += dt;
    this.stateT += dt;
    if (this.dead) {
      if (this.deathKind === 'blast') {
        this.angle += this.spin * dt;
      } else {
        const i = Math.min(5, Math.floor(this.stateT * 12));
        this.setFrame(`die_${i}`);
        if (this.body.blocked.down) this.body.setVelocityX(0);
      }
      if (this.stateT > 0.8) this.setVisible(Math.floor(this.stateT * 14) % 2 === 0);
      if (this.stateT > 1.3 || this.y > 300) this.destroy();
      return;
    }
    if (this.y > 230) {
      // fell into the sea
      s.splash(this.x);
      this.destroy();
      return;
    }
    const p = s.player.tank || s.player;
    const dx = p.x - this.x;
    const dist = Math.abs(dx);
    const ground = this.body.blocked.down || this.body.touching.down;
    const face = (d) => { this.facing = d; this.setFlipX(d < 0); };

    switch (this.state) {
      case 'idle':
        face(this.facing);
        this.setFrame(`chat_${Math.floor(this.t * 2) % 2}`);
        this.body.setVelocityX(0);
        if (dist < 150 && !s.player.dead) this.setState2('alert');
        break;
      case 'alert':
        face(Math.sign(dx) || -1);
        this.setFrame('alert_0');
        if (this.stateT > 0.5 && ground) this.setState2('attack');
        break;
      case 'flee': {
        const d = -Math.sign(dx) || 1;
        face(d);
        this.body.setVelocityX(d * 70);
        this.animT += dt * 14;
        this.setFrame(`flee_${Math.floor(this.animT) % 8}`);
        if (this.stateT > 0.9) this.setState2('attack');
        break;
      }
      case 'shoot':
        this.body.setVelocityX(0);
        face(Math.sign(dx) || -1);
        this.setFrame(`${this.crouchShot ? 'c' : ''}shoot_${this.stateT > 0.25 && this.stateT < 0.33 ? 1 : 0}`);
        if (!this.fired && this.stateT > 0.25) {
          this.fired = true;
          const my = this.y - (this.crouchShot ? 16 : 21);
          const ty = p.y - (s.player.tank ? 18 : s.player.crouch ? 12 : 22);
          const vx = Math.sign(dx) * 110;
          const vy = Phaser.Math.Clamp(((ty - my) / Math.max(40, dist)) * 110, -40, 40);
          s.spawnEnemyBullet(this.x + this.facing * 19, my, vx, vy);
          sfx.enemyShot();
        }
        if (this.stateT > 0.5) this.setState2('attack');
        break;
      case 'slash':
        this.body.setVelocityX(0);
        this.setFrame(`knife_${this.stateT > 0.18 ? 1 : 0}`);
        if (!this.fired && this.stateT > 0.18) {
          this.fired = true;
          const r = s.player.tank ? s.player.tank.hitRect() : s.player.hitRect();
          const reach = new Phaser.Geom.Rectangle(this.x + (this.facing > 0 ? 0 : -22), this.y - 30, 22, 24);
          if (Phaser.Geom.Intersects.RectangleToRectangle(reach, r)) {
            if (s.player.tank) s.player.tank.hurt(1);
            else s.player.kill();
          }
          sfx.knife();
        }
        if (this.stateT > 0.45) this.setState2('attack');
        break;
      case 'throw':
        this.body.setVelocityX(0);
        face(Math.sign(dx) || -1);
        this.setFrame(`throw_${Math.min(2, Math.floor(this.stateT / 0.15))}`);
        if (!this.fired && this.stateT > 0.3) {
          this.fired = true;
          const tt = 0.9 + Math.random() * 0.3;
          const g = s.physics.world.gravity.y;
          const vx = Phaser.Math.Clamp(dx / tt, -160, 160);
          const vy = (p.y - 10 - (this.y - 34) - 0.5 * g * tt * tt) / tt;
          s.spawnGrenade(this.x + this.facing * 6, this.y - 34, vx, Math.max(-320, vy), false);
          sfx.throw();
        }
        if (this.stateT > 0.5) this.setState2('attack');
        break;
      case 'attack':
      default: {
        if (s.player.dead) {
          this.body.setVelocityX(0);
          this.setFrame(`chat_${Math.floor(this.t * 2) % 2}`);
          break;
        }
        face(Math.sign(dx) || -1);
        this.actT -= dt;
        let move = 0;
        if (this.kind === 'knife') {
          move = Math.sign(dx) * 78;
          if (dist < 20 && Math.abs(p.y - this.y) < 24) { this.fired = false; this.setState2('slash'); break; }
        } else {
          if (dist > this.keepDist + 20) move = Math.sign(dx) * 48;
          else if (dist < this.keepDist - 40) move = -Math.sign(dx) * 40;
        }
        // walk onto the screen first, and never back off past its edges
        const cam = s.cameras.main;
        const right = cam.scrollX + cam.width - 24;
        if (this.x > right) move = -60;
        else if (this.x > right - 8 && move > 0) move = 0;
        if (this.x < cam.scrollX + 16 && move < 0) move = 0;
        this.body.setVelocityX(move);
        this.animT += dt * (this.kind === 'knife' ? 16 : 11);
        const inView = this.x < right;
        if (move) this.setFrame(`${this.kind === 'knife' ? 'k' : ''}walk_${Math.floor(this.animT) % 8}`);
        else this.setFrame(this.kind === 'knife' ? 'kwalk_0' : 'shoot_0');
        if (this.actT <= 0 && inView && ground && this.kind !== 'knife') {
          this.fired = false;
          this.actT = 1.6 + Math.random() * 1.6;
          if (this.kind === 'grenadier') this.setState2('throw');
          else {
            this.crouchShot = Math.random() < 0.35;
            this.setState2('shoot');
          }
        }
      }
    }
  }
}
