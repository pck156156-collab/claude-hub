import * as Phaser from 'phaser';
import { sfx } from '../sfx.js';

// Tied-up prisoner. Freed by a shot or a touch, walks to the player, hands over an item, salutes, runs off.
export class Pow extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, item) {
    super(scene, x, y, 'pow', 'tied_0');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(14);
    this.body.setSize(14, 22).setOffset(13, 22);
    this.item = item;
    this.state = 'tied';
    this.t = Math.random();
    this.stateT = 0;
  }

  hitRect() {
    const b = this.body;
    return new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
  }

  get tied() {
    return this.state === 'tied';
  }

  free() {
    if (!this.tied) return;
    this.state = 'free';
    this.stateT = 0;
    this.body.setSize(12, 30).setOffset(14, 14);
    this.body.setVelocityY(-120);
    sfx.thanks();
    this.scene.onPowFreed(this);
  }

  update(dt) {
    const s = this.scene;
    this.t += dt;
    this.stateT += dt;
    const p = s.player.tank || s.player;
    switch (this.state) {
      case 'tied':
        this.setFrame(`tied_${Math.floor(this.t * 1.5) % 2}`);
        break;
      case 'free':
        this.setFrame('free_0');
        if (this.stateT > 0.5 && this.body.blocked.down) { this.state = 'walk'; this.stateT = 0; }
        break;
      case 'walk': {
        const dx = p.x - this.x;
        this.setFlipX(dx < 0);
        this.body.setVelocityX(Math.sign(dx) * 50);
        this.setFrame(`run_${Math.floor(this.stateT * 12) % 8}`);
        if (Math.abs(dx) < 22 || this.stateT > 1.2) {
          this.body.setVelocityX(0);
          this.state = 'give';
          this.stateT = 0;
          s.spawnItem(this.item, this.x + (this.flipX ? -10 : 10), this.y - 24);
        }
        break;
      }
      case 'give':
        this.setFrame('give_0');
        if (this.stateT > 0.45) { this.state = 'salute'; this.stateT = 0; }
        break;
      case 'salute':
        this.setFrame('salute_0');
        if (this.stateT > 0.6) { this.state = 'run'; this.stateT = 0; }
        break;
      case 'run':
        this.setFlipX(true);
        this.body.setVelocityX(-140);
        this.setFrame(`run_${Math.floor(this.stateT * 18) % 8}`);
        if (this.x < s.cameras.main.scrollX - 30) this.destroy();
        break;
    }
  }
}
