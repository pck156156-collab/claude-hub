import * as Phaser from 'phaser';
import { W, H, GROUND_Y } from '../art/world.js';
import { pixelText } from '../font.js';
import { C } from '../palette.js';
import { sfx, stopBgm, unlockAudio } from '../sfx.js';

export class Title extends Phaser.Scene {
  constructor() {
    super('title');
  }

  create() {
    stopBgm();
    this.add.image(0, 0, 'sky').setOrigin(0);
    this.add.tileSprite(0, 70, W, 80, 'far').setOrigin(0);
    this.mid = this.add.tileSprite(0, 96, W, 110, 'mid').setOrigin(0);
    this.ground = this.add.tileSprite(0, GROUND_Y, W, 20, 'ground').setOrigin(0);
    this.add.image(300, GROUND_Y + 2, 'palm').setOrigin(0.5, 1);
    this.add.sprite(250, GROUND_Y - 4, 'tank', 'tank_0_0').setOrigin(0.5, 1);
    this.hero = this.add.sprite(120, GROUND_Y, 'player', 'r_stand_fwd_0').setOrigin(0.5, 1);

    pixelText(this, W / 2, 26, 'IRON RAID', { scale: 4, align: 'center', top: C.gold, bottom: C.fire2, shadow: C.redS });
    pixelText(this, W / 2, 70, 'STAGE 1 DEMO', { align: 'center', top: C.white, bottom: C.sky3 });
    this.press = pixelText(this, W / 2, 110, 'PRESS Z TO START', { align: 'center', scale: 1, top: C.gold, bottom: C.fire1 });
    pixelText(this, W / 2, 140, 'ARROWS MOVE  Z FIRE  X JUMP  C BOMB', { align: 'center', top: C.white, bottom: C.sky3 });
    pixelText(this, W / 2, 152, 'DOWN+X: DROP / LEAVE TANK   M SOUND', { align: 'center', top: C.white, bottom: C.sky3 });
    this.t = 0;

    const start = () => {
      if (this.starting) return;
      this.starting = true;
      unlockAudio();
      sfx.start();
      this.cameras.main.fadeOut(400);
      this.time.delayedCall(420, () => this.scene.start('game', {}));
    };
    this.input.keyboard.on('keydown-Z', start);
    this.input.keyboard.on('keydown-ENTER', start);
    this.input.keyboard.on('keydown-SPACE', start);
    this.input.on('pointerdown', start);
  }

  update(_t, dms) {
    this.t += dms / 1000;
    this.press.setVisible(Math.floor(this.t * 2.5) % 2 === 0);
    this.mid.tilePositionX += dms * 0.01;
    const f = Math.floor(this.t * 2) % 4;
    this.hero.setFrame(f === 3 ? 'r_stand_fwd_1' : 'r_idle_' + (f % 2));
  }
}
