import * as Phaser from 'phaser';
import { buildHumans } from '../art/humans.js';
import { buildVehicles } from '../art/vehicles.js';
import { buildWorld } from '../art/world.js';

// Generates every texture procedurally, then goes to the title screen.
export class Boot extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    buildWorld(this);
    buildHumans(this);
    buildVehicles(this);
    this.scene.start(new URLSearchParams(location.search).has('play') ? 'game' : 'title');
  }
}
