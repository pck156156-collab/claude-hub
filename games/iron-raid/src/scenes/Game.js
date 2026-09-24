import * as Phaser from 'phaser';
import { W, H, GROUND_Y } from '../art/world.js';
import { LEVEL } from '../level.js';
import { pixelText } from '../font.js';
import { C } from '../palette.js';
import { sfx, playBgm, stopBgm, toggleMute, unlockAudio } from '../sfx.js';
import { Player, WEAPONS } from '../objects/Player.js';
import { Soldier } from '../objects/Soldier.js';
import { Pow } from '../objects/Pow.js';
import { Tank } from '../objects/Tank.js';
import { Apc, Heli } from '../objects/Vehicles.js';
import { Boss } from '../objects/Boss.js';

const hit = (a, b) => Phaser.Geom.Intersects.RectangleToRectangle(a, b);

export class Game extends Phaser.Scene {
  constructor() {
    super('game');
  }

  init(data) {
    this.score = data.score || 0;
    this.lives = data.lives ?? 2; // extra lives after the current one
    this.rescued = 0;
  }

  create() {
    const L = LEVEL;
    this.physics.world.setBounds(0, -200, L.width, H + 400);
    this.cameras.main.setBounds(0, 0, L.width, H);
    this.cameras.main.setRoundPixels(true);
    this.scrollMax = L.width - W; // camera may not pass this (locks lower it)
    this.playerMaxX = L.groundEnd - 8;

    this.buildBackground();
    this.buildTerrain();

    this.enemies = [];
    this.pows = [];
    this.items = [];
    this.props = [];
    this.pBullets = [];
    this.eBullets = [];
    this.lobs = []; // grenades, shells, bombs (gravity)
    this.blasts = [];
    this.lockSpawns = null;

    // placed things
    L.pows.forEach(([x, item]) => this.pows.push(new Pow(this, x, GROUND_Y - 10, item)));
    L.soldiers.forEach(([x, kind, state, y]) => this.spawnSoldier(x, y || GROUND_Y - 2, kind, state));
    L.props.forEach(([type, x]) => this.addProp(type, x));
    this.tanks = [new Tank(this, L.tank, GROUND_Y - 4)];

    this.player = new Player(this, 60, GROUND_Y - 2);
    this.player.invuln = 1.5;

    // Down+jump on a roof drops through it.
    this.physics.add.collider(this.player, this.solids, (pl, so) => { pl.standingOn = so; }, (pl, so) => !(so.oneWay && pl.dropT > 0));
    this.physics.add.collider([...this.pows, ...this.tanks], this.solids);

    this.events_ = L.events.map((e) => ({ ...e, done: false }));
    this.boss = null;
    this.cleared = false;

    this.buildHud();
    this.setupInput();
    this.cameras.main.scrollX = 0;
    playBgm('stage');
    this.cameras.main.fadeIn(400);
    window.__IR = this; // debug/test handle
  }

  // ------------------------------------------------------------------ world
  buildBackground() {
    this.add.image(0, 0, 'sky').setOrigin(0).setScrollFactor(0).setDepth(-10);
    this.bgFar = this.add.tileSprite(0, 70, W, 80, 'far').setOrigin(0).setScrollFactor(0).setDepth(-9);
    this.bgMid = this.add.tileSprite(0, 96, W, 110, 'mid').setOrigin(0).setScrollFactor(0).setDepth(-8);
  }

  buildTerrain() {
    const L = LEVEL;
    this.solids = this.physics.add.staticGroup();
    const addSolid = (x, y, w, h, oneWay = false) => {
      const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0);
      this.physics.add.existing(r, true);
      if (oneWay) {
        r.oneWay = true;
        r.body.checkCollision.down = false;
        r.body.checkCollision.left = false;
        r.body.checkCollision.right = false;
      }
      this.solids.add(r);
      return r;
    };
    // ground and dock
    addSolid(0, GROUND_Y, L.groundEnd, 40);
    this.add.tileSprite(0, GROUND_Y, L.dockStart, 20, 'ground').setOrigin(0).setDepth(5);
    this.waterA = this.add.tileSprite(L.dockStart, GROUND_Y + 4, L.width - L.dockStart, 24, 'water_0').setOrigin(0).setDepth(4);
    this.waterFront = this.add.tileSprite(L.groundEnd, GROUND_Y + 6, L.width - L.groundEnd, 24, 'water_1').setOrigin(0).setDepth(12).setAlpha(0.9);
    this.add.tileSprite(L.dockStart, GROUND_Y, L.groundEnd - L.dockStart, 20, 'dock').setOrigin(0).setDepth(6);

    // scenery
    L.palms.forEach((x) => this.add.image(x, GROUND_Y + 2, 'palm').setOrigin(0.5, 1).setDepth(1));
    L.huts.forEach((x) => this.add.image(x + 36, GROUND_Y, 'hut').setOrigin(0.5, 1).setDepth(2));
    L.sandbags.forEach((x) => this.add.image(x, GROUND_Y + 1, 'sandbags').setOrigin(0.5, 1).setDepth(13));
    L.campfires.forEach((x) => this.add.image(x, GROUND_Y + 1, 'campfire').setOrigin(0.5, 1).setDepth(3));
    L.platforms.forEach(([x, y, w]) => addSolid(x, y, w, 6, true));
    L.crateStacks.forEach(([x, n]) => {
      for (let i = 0; i < n; i++) this.add.image(x, GROUND_Y - i * 16, 'crate').setOrigin(0, 1).setDepth(3);
      addSolid(x, GROUND_Y - n * 16, 16, n * 16);
    });
  }

  addProp(type, x) {
    const img = this.add.image(x, GROUND_Y + 1, type).setOrigin(0.5, 1).setDepth(8);
    img.hp = type === 'barrel' ? 3 : 4;
    img.kind = type;
    this.props.push(img);
  }

  // ------------------------------------------------------------------ HUD
  buildHud() {
    const d = 100;
    const t = (x, y, s, o = {}) => pixelText(this, x, y, s, o).setScrollFactor(0).setDepth(d);
    this.hud = {
      score: t(4, 2, '1UP 00000000', { maxLen: 13, top: C.white, bottom: C.sky3 }),
      lives: t(4, 12, '=3', { maxLen: 4, top: C.gold, bottom: C.goldS }),
      armsL: t(W / 2 - 34, 2, 'ARMS', { maxLen: 5, top: C.gold, bottom: C.goldS, align: 'center' }),
      arms: t(W / 2 - 34, 12, '~', { maxLen: 5, align: 'center' }),
      bombL: t(W / 2 + 18, 2, 'BOMB', { maxLen: 5, top: C.gold, bottom: C.goldS, align: 'center' }),
      bomb: t(W / 2 + 18, 12, '10', { maxLen: 5, align: 'center' }),
      pow: t(W - 4, 2, 'POW 0', { maxLen: 7, align: 'right', top: C.white, bottom: C.sky3 }),
      slug: t(W / 2 - 8, 22, '', { maxLen: 12, align: 'center', top: C.fire1, bottom: C.fire2 }),
    };
    this.banner = t(W / 2, 70, '', { maxLen: 16, scale: 2, align: 'center', top: C.gold, bottom: C.fire1, shadow: C.redS });
    this.bannerSub = t(W / 2, 92, '', { maxLen: 16, scale: 2, align: 'center', top: C.white, bottom: C.sky3, shadow: C.redS });
    this.bannerT = 0;
    this.goArrow = t(W - 40, 80, 'GO>', { maxLen: 4, scale: 2, top: C.gold, bottom: C.fire1 }).setVisible(false);
    this.goT = 0;
  }

  showBanner(text, sub = '', time = 1.6) {
    this.banner.setText(text);
    this.bannerSub.setText(sub);
    this.bannerT = time;
  }

  updateHud(dt) {
    const p = this.player;
    const h = this.hud;
    h.score.setText(`1UP ${String(this.score).padStart(8, '0')}`);
    h.lives.setText(`=${Math.max(0, this.lives)}`);
    if (p.tank) {
      h.armsL.setText('SLUG');
      h.arms.setText('#'.repeat(Math.max(0, p.tank.hp)) || '0');
      h.bombL.setText('SHELL');
      h.bomb.setText(String(p.tank.shells));
    } else {
      h.armsL.setText('ARMS');
      h.arms.setText(p.ammo === Infinity ? '~' : String(p.ammo));
      h.bombL.setText('BOMB');
      h.bomb.setText(String(p.bombs));
    }
    h.pow.setText(`POW ${this.rescued}`);
    this.bannerT -= dt;
    const show = this.bannerT > 0;
    this.banner.setVisible(show);
    this.bannerSub.setVisible(show);
    this.goT -= dt;
    this.goArrow.setVisible(this.goT > 0 && Math.floor(this.goT * 3) % 2 === 0);
    if (this.hintT > 0 && !p.tank) {
      this.hintT -= dt;
      h.slug.setText(Math.floor(this.hintT * 3) % 2 ? this.hint : '');
    } else h.slug.setText('');
  }

  // ------------------------------------------------------------------ input
  setupInput() {
    const kb = this.input.keyboard;
    this.keys = kb.addKeys({
      left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN',
      fire: 'Z', jump: 'X', bomb: 'C', mute: 'M', pause: 'P',
      a: 'A', d: 'D', w: 'W', s: 'S', j: 'J', k: 'K', l: 'L',
    });
    this.virtual = {}; // tests and touch can press keys here
    this.prev = {};
    kb.on('keydown', unlockAudio);
  }

  readInput() {
    const k = this.keys;
    const v = this.virtual;
    const cur = {
      left: k.left.isDown || k.a.isDown || !!v.left,
      right: k.right.isDown || k.d.isDown || !!v.right,
      up: k.up.isDown || k.w.isDown || !!v.up,
      down: k.down.isDown || k.s.isDown || !!v.down,
      fire: k.fire.isDown || k.j.isDown || !!v.fire,
      jump: k.jump.isDown || k.k.isDown || !!v.jump,
      bomb: k.bomb.isDown || k.l.isDown || !!v.bomb,
    };
    const inp = { ...cur };
    for (const n of ['fire', 'jump', 'bomb']) inp[`${n}Pressed`] = cur[n] && !this.prev[n];
    this.prev = cur;
    if (Phaser.Input.Keyboard.JustDown(k.mute)) toggleMute();
    return inp;
  }

  // ------------------------------------------------------------------ spawning
  spawnSoldier(x, y, kind, state = 'attack') {
    const s = new Soldier(this, x, y, kind, state);
    if (state === 'attack') s.facing = -1;
    this.physics.add.collider(s, this.solids);
    this.enemies.push(s);
    return s;
  }

  countSoldiers() {
    return this.enemies.filter((e) => e instanceof Soldier && !e.dead && e.active).length;
  }

  spawnFromRight(sp) {
    const cam = this.cameras.main;
    const x = cam.scrollX + W + 20;
    let e;
    if (sp.kind === 'apc') e = new Apc(this, x + 20, GROUND_Y - 2, sp.stopX);
    else if (sp.kind === 'heli') e = new Heli(this, x + 30, 30);
    else e = this.spawnSoldier(x, GROUND_Y - 2, sp.kind, 'attack');
    if (e instanceof Apc) { this.physics.add.collider(e, this.solids); this.enemies.push(e); }
    if (e instanceof Heli) this.enemies.push(e);
    return e;
  }

  spawnItem(type, x, y) {
    const key = type.length === 1 ? `item_${type}` : `item_${type}`;
    const it = this.physics.add.sprite(x, y, key, type.length === 1 ? '0' : undefined).setDepth(18);
    it.itemType = type;
    it.t = 0;
    it.body.setVelocity(0, -100);
    this.physics.add.collider(it, this.solids);
    this.items.push(it);
    return it;
  }

  spawnPlayerBullet(x, y, vx, vy, dmg) {
    const b = this.add.image(x, y, 'bullet').setDepth(18);
    b.vx = vx; b.vy = vy; b.dmg = dmg; b.life = 1.2;
    b.setRotation(Math.atan2(vy, vx));
    this.pBullets.push(b);
  }

  spawnRocket(x, y, dir) {
    const b = this.add.image(x, y, 'rocket').setDepth(18);
    b.dir = dir; b.speed = 60; b.vx = dir[0] * 60; b.vy = dir[1] * 60; b.dmg = 8; b.life = 2; b.rocket = true;
    b.setRotation(Math.atan2(dir[1], dir[0]));
    this.pBullets.push(b);
  }

  spawnCannonShell(x, y, f) {
    const b = this.add.image(x, y, 'bigshell').setDepth(18).setFlipX(f < 0);
    b.vx = f * 260; b.vy = 0; b.dmg = 10; b.life = 1.5; b.cannon = true;
    this.pBullets.push(b);
  }

  shotgunBlast(x, y, dir) {
    const img = this.add.sprite(x, y, 'sgblast', 'sg_0').setDepth(18);
    img.setOrigin(0.05, 0.5).setRotation(Math.atan2(dir[1], dir[0]));
    img.t = 0;
    this.blasts.push(img);
    // one-off damage in a box in front of the muzzle
    const len = 54, wid = 30;
    const r = dir[0]
      ? new Phaser.Geom.Rectangle(dir[0] > 0 ? x : x - len, y - wid / 2, len, wid)
      : new Phaser.Geom.Rectangle(x - wid / 2, dir[1] > 0 ? y : y - len, wid, len);
    this.damageArea(r, 6, 'shot');
  }

  spawnEnemyBullet(x, y, vx, vy) {
    const b = this.add.image(x, y, 'ebullet').setDepth(18);
    b.vx = vx; b.vy = vy; b.life = 4;
    this.eBullets.push(b);
  }

  spawnFireball(x, y) {
    const b = this.add.image(x, y, 'fireball').setDepth(18).setFlipX(true);
    b.vx = -150; b.vy = 0; b.life = 4; b.fire = true;
    this.eBullets.push(b);
    sfx.rocket();
  }

  spawnGrenade(x, y, vx, vy, friendly) {
    const g = this.add.image(x, y, 'grenade').setDepth(18);
    Object.assign(g, { vx, vy, friendly, bounces: friendly ? 1 : 0, kind: 'grenade', spin: vx > 0 ? 720 : -720 });
    this.lobs.push(g);
  }

  spawnEnemyShell(x, y, vx, vy) {
    const g = this.add.image(x, y, 'shell').setDepth(18);
    Object.assign(g, { vx, vy, friendly: false, bounces: 0, kind: 'shell', spin: 0 });
    this.lobs.push(g);
  }

  spawnBomb(x, y) {
    const g = this.add.image(x, y, 'bomb').setDepth(18);
    Object.assign(g, { vx: 0, vy: 20, friendly: false, bounces: 0, kind: 'bomb', spin: 0 });
    this.lobs.push(g);
  }

  // ------------------------------------------------------------------ effects
  explode(x, y, size = 's', { radius = 24, dmg = 6, hurtsPlayer = false, friendly = true } = {}) {
    const key = size === 'l' ? 'boom_l' : 'boom_s';
    const n = size === 'l' ? 10 : 8;
    const s = this.add.sprite(x, y, key, '0').setDepth(30);
    let f = 0;
    this.time.addEvent({
      delay: 55, repeat: n - 1,
      callback: () => { f += 1; if (f >= n) s.destroy(); else s.setFrame(String(f)); },
    });
    if (size === 'l') { sfx.bigBoom(); this.cameras.main.shake(250, 0.01); } else sfx.boom();
    if (radius > 0) {
      const r = new Phaser.Geom.Rectangle(x - radius, y - radius, radius * 2, radius * 2);
      if (friendly) this.damageArea(r, dmg, 'blast');
      if (hurtsPlayer) this.hurtPlayerArea(r);
    }
  }

  puff(x, y) {
    const s = this.add.sprite(x, y, 'smoke', '0').setDepth(29).setAlpha(0.85);
    this.tweens.add({ targets: s, y: y - 20, alpha: 0, duration: 700, onUpdate: (tw) => s.setFrame(String(Math.min(3, Math.floor(tw.progress * 4)))), onComplete: () => s.destroy() });
  }

  spark(x, y) {
    const s = this.add.sprite(x, y, 'spark', '0').setDepth(29);
    this.time.delayedCall(40, () => s.setFrame('1'));
    this.time.delayedCall(80, () => s.setFrame('2'));
    this.time.delayedCall(120, () => s.destroy());
  }

  splash(x) {
    const s = this.add.sprite(x, GROUND_Y + 6, 'splash', '0').setOrigin(0.5, 1).setDepth(13);
    let f = 0;
    this.time.addEvent({ delay: 70, repeat: 4, callback: () => { f += 1; if (f >= 5) s.destroy(); else s.setFrame(String(f)); } });
  }

  debris(x, y, n, key = 'debris') {
    for (let i = 0; i < n; i++) {
      const d = this.add.image(x, y, key).setDepth(28);
      const vx = (Math.random() - 0.5) * 200, vy = -100 - Math.random() * 180;
      this.tweens.add({ targets: d, x: x + vx * 0.8, duration: 800 });
      this.tweens.add({ targets: d, y: { value: y + 120, ease: (t) => t * t * 1.6 - t * 0.6 + (vy / 400) * t * (1 - t) }, angle: 360, duration: 800, onComplete: () => d.destroy() });
    }
  }

  addScore(n, x, y) {
    this.score += n;
    if (x !== undefined && n >= 500) {
      const t = pixelText(this, x, y, String(n), { maxLen: 6, align: 'center', top: C.gold, bottom: C.fire1 }).setDepth(40);
      this.tweens.add({ targets: t, y: y - 16, alpha: 0, duration: 900, onComplete: () => t.destroy() });
    }
  }

  // ------------------------------------------------------------------ damage
  targets() {
    const list = this.enemies.filter((e) => e.active && !e.dead);
    if (this.boss && !this.boss.dead && this.boss.active === true) list.push(this.boss);
    return list;
  }

  damageArea(r, dmg, kind) {
    for (const e of this.targets()) if (hit(r, e.hitRect())) e.hurt(dmg, kind);
    for (const p of this.pows) if (p.active && p.tied && hit(r, p.hitRect())) p.free();
    for (const pr of this.props) if (pr.active && hit(r, pr.getBounds())) this.hurtProp(pr, dmg);
  }

  hurtPlayerArea(r) {
    const p = this.player;
    if (p.dead) return;
    if (p.tank) { if (hit(r, p.tank.hitRect())) p.tank.hurt(1); } else if (hit(r, p.hitRect())) p.kill();
    for (const t of this.tanks) if (t.active && !t.driver && hit(r, t.hitRect())) t.hurt(1);
  }

  hurtProp(pr, dmg) {
    pr.hp -= dmg;
    this.spark(pr.x, pr.y - 8);
    if (pr.hp > 0) return;
    pr.destroy();
    if (pr.kind === 'barrel') {
      this.time.delayedCall(60, () => this.explode(pr.x, pr.y - 10, 's', { radius: 26, dmg: 8, hurtsPlayer: true }));
    } else {
      this.debris(pr.x, pr.y - 8, 6, 'chip');
      if (Math.random() < 0.6) this.spawnItem(Math.random() < 0.5 ? 'gem' : 'food', pr.x, pr.y - 10);
      this.addScore(100);
    }
  }

  findMeleeTarget(p) {
    const reach = new Phaser.Geom.Rectangle(p.facing > 0 ? p.x - 4 : p.x - 22, p.y - 30, 26, 30);
    return this.enemies.find((e) => e instanceof Soldier && e.active && !e.dead && hit(reach, e.hitRect()));
  }

  onEnemyKilled(e) {
    // nearby soldiers sometimes panic
    for (const o of this.enemies) {
      if (o !== e && o instanceof Soldier && !o.dead && o.state === 'attack' && Math.abs(o.x - e.x) < 60 && Math.random() < 0.3) o.setState2('flee');
    }
  }

  onPowFreed() {
    this.rescued += 1;
  }

  onPlayerHit() {
    this.cameras.main.shake(150, 0.006);
  }

  respawnPlayer() {
    if (this.lives <= 0) {
      this.gameOver();
      return;
    }
    this.lives -= 1;
    const cam = this.cameras.main;
    this.player.reset(cam.scrollX + 70, 20);
    this.player.invuln = 2.5;
  }

  gameOver() {
    if (this.over) return;
    this.over = true;
    stopBgm();
    this.player.setVisible(false);
    this.player.body.enable = false;
    this.showBanner('GAME OVER', '', 999);
    this.continueT = 9.99;
    this.contText = pixelText(this, W / 2, 110, 'CONTINUE? 9', { maxLen: 12, scale: 2, align: 'center' }).setScrollFactor(0).setDepth(101);
  }

  onBossDefeated() {
    this.bossDefeatedAt = this.time.now;
  }

  // ------------------------------------------------------------------ main loop
  update(time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 1 / 30);
    const inp = this.readInput();

    if (this.over) {
      this.continueT -= dt;
      this.contText.setText(`CONTINUE? ${Math.max(0, Math.floor(this.continueT))}`);
      if (inp.firePressed) {
        this.over = false;
        this.contText.destroy();
        this.score = 0;
        this.lives = 2;
        this.bannerT = 0;
        this.player.reset(this.cameras.main.scrollX + 70, 20);
        this.player.invuln = 2.5;
        playBgm(this.boss && this.boss.active ? 'boss' : 'stage');
      } else if (this.continueT <= 0) {
        this.scene.start('title');
      }
      this.updateHud(dt);
      return;
    }

    const p = this.player;
    p.update(dt, inp);
    for (const t of this.tanks) {
      if (!t.active) continue;
      t.update(dt, t.driver ? inp : null);
      if (!t.driver && !p.dead && !p.tank && t.dying < 0 && t.noEnter <= 0 && p.body.velocity.y > 0 && hit(p.hitRect(), t.hitRect())) t.enter(p);
    }
    this.tanks = this.tanks.filter((t) => t.active);

    const cam = this.cameras.main;
    const near = (o) => o.x > cam.scrollX - 80 && o.x < cam.scrollX + W + 80;
    for (const e of this.enemies) if (e.active && (near(e) || e.dead)) e.update(dt);
    this.enemies = this.enemies.filter((e) => e.active);
    for (const pw of this.pows) if (pw.active && near(pw)) pw.update(dt);
    this.pows = this.pows.filter((pw) => pw.active);
    if (this.boss) {
      this.boss.update(dt);
      if (this.boss.gone && !this.cleared) this.missionComplete();
    }

    // touching a prisoner frees him
    if (!p.dead) {
      const pr = p.tank ? p.tank.hitRect() : p.hitRect();
      for (const pw of this.pows) if (pw.tied && hit(pr, pw.hitRect())) pw.free();
    }

    this.updateProjectiles(dt);
    this.updateItems(dt);
    this.updateEvents(dt);
    this.updateCamera(dt);
    this.updateHud(dt);

    this.waterA.tilePositionX += dt * 10;
    this.waterFront.tilePositionX -= dt * 16;
    if (Math.floor(time / 300) % 2) this.waterA.setTexture('water_1'); else this.waterA.setTexture('water_0');

    if (this.cleared) {
      this.clearT += dt;
      if (this.clearT > 4.5 && !this.leaving) {
        this.leaving = true;
        this.cameras.main.fadeOut(600);
        this.time.delayedCall(650, () => this.scene.start('result', { score: this.score, rescued: this.rescued }));
      }
    }
  }

  updateProjectiles(dt) {
    const cam = this.cameras.main;
    const off = (b) => b.x < cam.scrollX - 30 || b.x > cam.scrollX + W + 30 || b.y < -40 || b.y > H + 30;
    const targets = this.targets();

    // player bullets
    for (const b of this.pBullets) {
      if (b.rocket) {
        b.speed = Math.min(320, b.speed + 700 * dt);
        b.vx = b.dir[0] * b.speed;
        b.vy = b.dir[1] * b.speed;
        if (Math.random() < dt * 30) this.puff(b.x - b.dir[0] * 6, b.y - b.dir[1] * 6);
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const r = new Phaser.Geom.Rectangle(b.x - 3, b.y - 2, 6, 4);
      let used = false;
      for (const e of targets) {
        if (!e.dead && hit(r, e.hitRect())) {
          e.hurt(b.dmg, b.rocket || b.cannon ? 'blast' : 'shot');
          used = true;
          break;
        }
      }
      if (!used && this.boss && !this.boss.dead && this.boss.active === true && this.boss.shellRects().some((q) => hit(r, q))) { used = true; sfx.clank(); }
      if (!used) for (const pw of this.pows) if (pw.tied && hit(r, pw.hitRect())) { pw.free(); used = true; break; }
      if (!used) for (const pr of this.props) if (pr.active && hit(r, pr.getBounds())) { this.hurtProp(pr, b.dmg); used = true; break; }
      if (!used && b.y >= GROUND_Y && b.x < LEVEL.groundEnd) used = true;
      if (used) {
        if (b.rocket || b.cannon) this.explode(b.x, b.y, 's', { radius: b.cannon ? 22 : 16, dmg: b.cannon ? 6 : 3 });
        else { this.spark(b.x, b.y); if (!b.cannon) sfx.hit(); }
      }
      if (used || b.life <= 0 || off(b)) { b.destroy(); b.dead = true; }
    }
    this.pBullets = this.pBullets.filter((b) => !b.dead);

    // enemy bullets
    const p = this.player;
    for (const b of this.eBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const r = new Phaser.Geom.Rectangle(b.x - 2, b.y - 2, 4, 4);
      let used = false;
      if (!p.dead) {
        if (p.tank && hit(r, p.tank.hitRect())) { p.tank.hurt(1); used = true; } else if (!p.tank && hit(r, p.hitRect())) used = p.kill() || p.invuln > 0;
      }
      if (b.y >= GROUND_Y + 2 && b.x < LEVEL.groundEnd) used = true;
      if (used || b.life <= 0 || off(b)) { b.destroy(); b.dead = true; }
    }
    this.eBullets = this.eBullets.filter((b) => !b.dead);

    // lobbed things
    const g = this.physics.world.gravity.y;
    for (const o of this.lobs) {
      o.vy += g * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.angle += o.spin * dt;
      let boom = false;
      const r = new Phaser.Geom.Rectangle(o.x - 3, o.y - 3, 6, 6);
      if (o.friendly) {
        for (const e of targets) if (!e.dead && hit(r, e.hitRect())) boom = true;
      } else if (!p.dead) {
        const pr = p.tank ? p.tank.hitRect() : p.hitRect();
        if (hit(r, pr)) boom = true;
      }
      if (o.y >= GROUND_Y - 2) {
        if (o.x > LEVEL.groundEnd) { this.splash(o.x); o.destroy(); o.dead = true; continue; }
        o.y = GROUND_Y - 2;
        if (o.bounces > 0) { o.bounces -= 1; o.vy = -120; o.vx *= 0.6; } else boom = true;
      }
      if (boom) {
        this.explode(o.x, o.y - 4, 's', {
          radius: o.kind === 'bomb' ? 18 : 22,
          dmg: o.friendly ? 6 : 0,
          friendly: o.friendly,
          hurtsPlayer: !o.friendly,
        });
        o.destroy();
        o.dead = true;
      } else if (off(o) && o.y > 0) { o.destroy(); o.dead = true; }
    }
    this.lobs = this.lobs.filter((o) => !o.dead);

    for (const s of this.blasts) {
      s.t += dt;
      const f = Math.floor(s.t / 0.05);
      if (f > 3) { s.destroy(); s.dead = true; } else s.setFrame(`sg_${f}`);
    }
    this.blasts = this.blasts.filter((s) => !s.dead);
  }

  updateItems(dt) {
    const p = this.player;
    for (const it of this.items) {
      it.t += dt;
      if (it.itemType.length === 1) it.setFrame(String(Math.floor(it.t * 4) % 2));
      if (it.t > 12) it.setVisible(Math.floor(it.t * 10) % 2 === 0);
      if (it.t > 15) { it.destroy(); continue; }
      if (p.dead || it.t < 0.25) continue;
      const pr = p.tank ? p.tank.hitRect() : p.hitRect();
      if (!hit(pr, it.getBounds())) continue;
      const type = it.itemType;
      const weapon = { B: 'rifle', S: 'shotgun', R: 'rocket' }[type];
      if (weapon && !p.tank) {
        if (p.weapon === weapon) p.ammo += WEAPONS[weapon].ammo; else p.setWeapon(weapon);
        this.showBanner(WEAPONS[weapon].name + '!', '', 1.2);
        sfx.weapon();
      } else if (weapon && p.tank) {
        continue; // leave weapons for when you get out
      } else if (type === 'G') {
        if (p.tank) p.tank.shells += 10; else p.bombs += 10;
        sfx.pickup();
      } else {
        this.addScore(type === 'gem' ? 1000 : 500, it.x, it.y - 10);
        sfx.pickup();
      }
      this.addScore(weapon ? 0 : 0);
      it.destroy();
    }
    this.items = this.items.filter((it) => it.active);
  }

  updateEvents(dt) {
    const p = this.player.tank || this.player;
    for (const ev of this.events_) {
      if (ev.done || p.x < ev.x) continue;
      ev.done = true;
      switch (ev.type) {
        case 'banner':
          this.showBanner(ev.text, ev.sub, 2.2);
          sfx.start();
          break;
        case 'hint':
          this.hint = ev.text;
          this.hintT = 3;
          break;
        case 'wave':
          ev.spawns.forEach((sp) => this.time.delayedCall(sp.t * 1000, () => this.spawnFromRight(sp)));
          break;
        case 'lock': {
          this.scrollMax = ev.scroll;
          const lock = { remaining: ev.spawns.length, list: [] };
          this.lockSpawns = lock;
          ev.spawns.forEach((sp) => this.time.delayedCall(sp.t * 1000, () => {
            lock.list.push(this.spawnFromRight(sp));
            lock.remaining -= 1;
          }));
          break;
        }
        case 'boss':
          this.scrollMax = LEVEL.bossScroll;
          this.bossLockPending = true;
          break;
      }
    }
    // release a lock once everything spawned is dead
    const lock = this.lockSpawns;
    if (lock && lock.remaining === 0 && lock.list.every((e) => !e.active || e.dead)) {
      this.lockSpawns = null;
      this.scrollMax = LEVEL.width - W;
      this.goT = 3;
    }
    if (this.bossLockPending && Math.abs(this.cameras.main.scrollX - LEVEL.bossScroll) < 2) {
      this.bossLockPending = false;
      this.boss = new Boss(this, LEVEL.bossX, GROUND_Y + 4);
      this.boss.start();
    }
  }

  updateCamera(dt) {
    const cam = this.cameras.main;
    const p = this.player.tank || this.player;
    const target = Math.min(p.x - W * 0.4, this.scrollMax);
    if (target > cam.scrollX) cam.scrollX = Math.min(target, cam.scrollX + Math.max(1, (target - cam.scrollX) * 8 * dt));
    this.bgFar.tilePositionX = cam.scrollX * 0.15;
    this.bgMid.tilePositionX = cam.scrollX * 0.45;
  }

  missionComplete() {
    this.cleared = true;
    this.clearT = 0;
    this.player.won = !this.player.tank;
    this.showBanner('MISSION 1', 'COMPLETE!', 999);
    sfx.start();
  }
}
