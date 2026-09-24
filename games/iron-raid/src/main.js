import * as Phaser from 'phaser';
import { W, H } from './art/world.js';
import { Boot } from './scenes/Boot.js';
import { Title } from './scenes/Title.js';
import { Game } from './scenes/Game.js';
import { Result } from './scenes/Result.js';
import { setupTouch } from './touch.js';

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  pixelArt: true,
  backgroundColor: '#0d0f14',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { y: 700 }, debug: false } },
  scene: [Boot, Title, Game, Result],
});

setupTouch();
