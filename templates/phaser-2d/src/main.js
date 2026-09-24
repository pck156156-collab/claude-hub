import * as Phaser from 'phaser';
import heroUrl from '../../../assets/generated/demo-hero/demo-hero_0.png';

const W = 800;
const H = 450;

class Play extends Phaser.Scene {
  constructor() {
    super('play');
  }

  preload() {
    this.load.image('hero', heroUrl);
  }

  create() {
    // Placeholder textures drawn in code; swap for real art via this.load.image.
    const g = this.add.graphics();
    g.fillStyle(0x4caf50).fillRect(0, 0, 64, 24).generateTexture('ground', 64, 24).clear();
    g.fillStyle(0xffd54f).fillCircle(10, 10, 10).generateTexture('coin', 20, 20).destroy();

    this.platforms = this.physics.add.staticGroup();
    for (let x = 32; x < W + 32; x += 64) this.platforms.create(x, H - 12, 'ground');
    [[200, 320], [420, 250], [640, 180]].forEach(([x, y]) => {
      this.platforms.create(x, y, 'ground');
      this.platforms.create(x + 64, y, 'ground');
    });

    this.player = this.physics.add.sprite(80, H - 120, 'hero').setScale(0.6);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.platforms);

    this.coins = this.physics.add.group({ allowGravity: false });
    [[232, 280], [452, 210], [672, 140], [560, 400], [320, 400]].forEach(([x, y]) => this.coins.create(x, y, 'coin'));

    this.score = 0;
    this.scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '24px', color: '#fff' });
    this.physics.add.overlap(this.player, this.coins, (_p, coin) => {
      coin.destroy();
      this.score += 10;
      this.scoreText.setText(`Score: ${this.score}`);
      if (this.coins.countActive() === 0) this.scoreText.setText(`Clear! Score: ${this.score}`);
    });

    this.keys = this.input.keyboard.createCursorKeys();
  }

  update() {
    const { left, right, up, space } = this.keys;
    const speed = 220;
    if (left.isDown) this.player.setVelocityX(-speed);
    else if (right.isDown) this.player.setVelocityX(speed);
    else this.player.setVelocityX(0);

    const onGround = this.player.body.blocked.down || this.player.body.touching.down;
    if ((up.isDown || space.isDown) && onGround) this.player.setVelocityY(-460);
  }
}

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: '#1d2330',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { y: 900 } } },
  scene: Play,
});
