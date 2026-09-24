import * as Phaser from 'phaser';
import { W } from '../art/world.js';
import { pixelText } from '../font.js';
import { C } from '../palette.js';
import { sfx } from '../sfx.js';

export class Result extends Phaser.Scene {
  constructor() {
    super('result');
  }

  create({ score = 0, rescued = 0 }) {
    this.cameras.main.setBackgroundColor(C.outline);
    const bonus = rescued * 1000;
    const lines = [
      ['MISSION 1 COMPLETE!', 24, 2, C.gold, C.fire1],
      [`SCORE      ${String(score).padStart(8, '0')}`, 70, 1, C.white, C.sky3],
      [`POW RESCUED  ${rescued} * 1000`, 86, 1, C.white, C.sky3],
      [`TOTAL      ${String(score + bonus).padStart(8, '0')}`, 106, 1, C.gold, C.goldS],
      ['THANK YOU FOR PLAYING THE DEMO!', 140, 1, C.white, C.sky3],
      ['PRESS Z', 170, 1, C.gold, C.fire1],
    ];
    lines.forEach(([s, y, scale, top, bottom], i) => {
      const t = pixelText(this, W / 2, y, s, { scale, align: 'center', top, bottom }).setVisible(false);
      this.time.delayedCall(300 + i * 400, () => { t.setVisible(true); sfx.pickup(); });
    });
    this.time.delayedCall(2800, () => {
      const back = () => this.scene.start('title');
      this.input.keyboard.once('keydown-Z', back);
      this.input.once('pointerdown', back);
    });
    window.__IR_RESULT = { score, rescued };
  }
}
