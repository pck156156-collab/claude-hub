// Tank (player slug), enemy APC, helicopter and the stage-1 boss ship.
import { C } from '../palette.js';
import { rect, dot, ellipse, circle, line, poly, buildSheet, buildImage } from '../gfx.js';

function treads(ctx, x, y, w, h, phase, body, wheel) {
  rect(ctx, x, y, w, h, C.gunS);
  rect(ctx, x + 1, y + 1, w - 2, 1, C.gun);
  for (let i = -1; i < w / 4 + 1; i++) {
    const tx = x + ((i * 4 + phase) % w + w) % w;
    rect(ctx, tx, y, 2, 1, C.gunL);
    rect(ctx, tx, y + h - 1, 2, 1, C.gun);
  }
  const n = Math.floor(w / 9);
  for (let i = 0; i < n; i++) {
    const cx = x + 5 + i * ((w - 10) / (n - 1));
    circle(ctx, cx, y + h / 2, 3, wheel);
    dot(ctx, Math.round(cx), Math.round(y + h / 2), body);
  }
}

export function buildVehicles(scene) {
  // ---------------- player tank "Bulldog" (56x40, faces right)
  const tank = [];
  for (let f = 0; f < 3; f++) {
    for (const dmg of [0, 1]) {
      tank.push({
        name: `tank_${f}_${dmg}`,
        draw(ctx) {
          treads(ctx, 4, 28, 48, 10, f * 2, C.oliveS, C.gun);
          poly(ctx, [[6, 28], [8, 18], [48, 18], [52, 24], [52, 28]], C.olive);
          rect(ctx, 8, 18, 40, 2, C.oliveL);
          rect(ctx, 8, 25, 44, 3, C.oliveS);
          rect(ctx, 12, 21, 30, 2, C.red);
          ellipse(ctx, 27, 15, 11, 6, C.olive);
          ellipse(ctx, 25, 13, 8, 3, C.oliveL);
          rect(ctx, 16, 17, 22, 2, C.oliveS);
          rect(ctx, 37, 12, 17, 4, C.gun); // cannon
          rect(ctx, 37, 12, 17, 1, C.gunL);
          rect(ctx, 52, 11, 3, 6, C.gunS);
          rect(ctx, 21, 7, 8, 3, C.oliveS); // hatch
          if (dmg) {
            rect(ctx, 14, 19, 4, 3, C.outline);
            rect(ctx, 40, 22, 3, 3, C.outline);
            rect(ctx, 30, 10, 3, 2, C.outline);
          }
        },
      });
    }
  }
  buildSheet(scene, 'tank', 56, 40, tank);
  // Vulcan gun: pivot at left-middle, drawn pointing right.
  buildImage(scene, 'vulcan', 16, 6, (ctx) => {
    rect(ctx, 1, 1, 13, 4, C.gun);
    rect(ctx, 1, 1, 13, 1, C.gunL);
    rect(ctx, 12, 0, 3, 6, C.gunS);
  });

  // ---------------- enemy APC (64x36, faces right; flipped in game)
  const apc = [];
  for (let f = 0; f < 2; f++) {
    for (const dmg of [0, 1, 2]) {
      apc.push({
        name: `apc_${f}_${dmg}`,
        draw(ctx) {
          const body = dmg === 2 ? C.gunS : C.grey;
          const bodyS = dmg === 2 ? C.outline : C.greyS;
          poly(ctx, [[3, 28], [6, 12], [46, 12], [58, 20], [60, 28]], body);
          rect(ctx, 6, 12, 40, 2, dmg === 2 ? C.gun : C.greyL);
          rect(ctx, 4, 24, 56, 4, bodyS);
          rect(ctx, 10, 16, 6, 4, C.outline); // windows
          rect(ctx, 20, 16, 6, 4, C.outline);
          rect(ctx, 30, 6, 12, 7, body); // turret
          rect(ctx, 42, 8, 16, 3, C.gun);
          for (const wx of [12, 30, 48]) {
            circle(ctx, wx, 29, 6, C.gunS);
            circle(ctx, wx, 29, 3, C.gun);
            const a = f * Math.PI / 4;
            line(ctx, wx - Math.cos(a) * 3, 29 - Math.sin(a) * 3, wx + Math.cos(a) * 3, 29 + Math.sin(a) * 3, C.gunL, 1);
          }
          if (dmg >= 1) {
            rect(ctx, 36, 14, 4, 3, C.outline);
            rect(ctx, 8, 20, 3, 3, C.outline);
            dot(ctx, 50, 16, C.fire1);
          }
        },
      });
    }
  }
  buildSheet(scene, 'apc', 64, 36, apc);

  // ---------------- enemy helicopter (72x36, faces right)
  const heli = [];
  for (let f = 0; f < 3; f++) {
    heli.push({
      name: `heli_${f}`,
      draw(ctx) {
        const rl = [34, 20, 8][f];
        rect(ctx, 36 - rl, 2, rl * 2, 2, C.gunS);
        rect(ctx, 34, 3, 4, 6, C.gun);
        poly(ctx, [[2, 16], [26, 14], [26, 20], [2, 19]], C.greyS); // tail boom
        rect(ctx, 0, 10, 4, 9, C.greyS);
        const tr = [[0, 8, 4, 12], [-2, 12, 6, 4], [0, 10, 4, 8]][f];
        rect(ctx, tr[0], tr[1], tr[2], tr[3], C.gunL);
        ellipse(ctx, 40, 18, 18, 9, C.grey);
        ellipse(ctx, 38, 20, 16, 6, C.greyS);
        ellipse(ctx, 50, 15, 7, 5, C.glass);
        rect(ctx, 47, 12, 4, 2, C.white);
        rect(ctx, 26, 29, 30, 2, C.gunS); // skids
        line(ctx, 32, 26, 30, 29, C.gunS, 1);
        line(ctx, 48, 26, 50, 29, C.gunS, 1);
        rect(ctx, 44, 24, 10, 3, C.gun); // gun pod
        rect(ctx, 30, 14, 6, 3, C.red);
      },
    });
  }
  buildSheet(scene, 'heli', 72, 36, heli);

  // ---------------- boss "Greybaikal" gunboat (faces left toward the player)
  buildImage(scene, 'boss_hull', 176, 96, (ctx) => {
    poly(ctx, [[2, 58], [174, 58], [168, 92], [22, 92]], C.greyS); // hull
    rect(ctx, 4, 58, 170, 3, C.grey);
    rect(ctx, 20, 72, 150, 3, C.red); // waterline stripe
    for (let i = 0; i < 7; i++) circle(ctx, 40 + i * 18, 66, 2, C.outline); // portholes
    poly(ctx, [[60, 58], [70, 22], [150, 22], [160, 58]], C.grey); // superstructure
    rect(ctx, 70, 22, 80, 3, C.greyL);
    for (let i = 0; i < 5; i++) rect(ctx, 78 + i * 14, 30, 8, 5, C.glass);
    rect(ctx, 118, 4, 8, 18, C.greyS); // mast
    rect(ctx, 112, 8, 20, 2, C.greyS);
    dot(ctx, 131, 7, C.red);
    rect(ctx, 136, 10, 12, 12, C.gunS); // funnel
    rect(ctx, 136, 10, 12, 3, C.red);
  });
  // Armour plates that cover the engine (fall off in phase 2).
  buildImage(scene, 'boss_armor', 44, 32, (ctx) => {
    rect(ctx, 0, 0, 44, 32, C.gun);
    rect(ctx, 0, 0, 44, 2, C.gunL);
    for (const [x, y] of [[3, 4], [39, 4], [3, 27], [39, 27], [21, 4], [21, 27]]) rect(ctx, x, y, 2, 2, C.gunL);
    line(ctx, 4, 16, 40, 16, C.gunS, 2);
    rect(ctx, 8, 9, 28, 3, C.gold);
    rect(ctx, 8, 20, 28, 3, C.gold);
  });
  const core = [];
  for (let f = 0; f < 2; f++) {
    core.push({
      name: `core_${f}`,
      draw(ctx) {
        rect(ctx, 0, 0, 40, 28, C.gunS);
        circle(ctx, 20, 14, 10, C.fire3);
        circle(ctx, 20, 14, f ? 8 : 7, C.fire2);
        circle(ctx, 20, 14, f ? 5 : 4, C.fire1);
        circle(ctx, 20, 14, 2, C.fire0);
        line(ctx, 2, 3, 38, 3, C.gun, 2);
        line(ctx, 2, 25, 38, 25, C.gun, 2);
      },
    });
  }
  buildSheet(scene, 'boss_core', 40, 28, core);
  // Deck cannon: pivot on the right, barrel points left-up.
  buildImage(scene, 'boss_cannon', 40, 20, (ctx) => {
    ellipse(ctx, 28, 12, 10, 7, C.greyS);
    rect(ctx, 22, 16, 16, 4, C.gunS);
    poly(ctx, [[0, 4], [22, 8], [22, 13], [0, 9]], C.gun);
    rect(ctx, 0, 3, 3, 7, C.gunS);
  });
  const door = [];
  for (let f = 0; f < 3; f++) {
    door.push({
      name: `door_${f}`,
      draw(ctx) {
        rect(ctx, 0, 0, 16, 20, C.outline);
        const h = [20, 10, 2][f];
        rect(ctx, 0, 0, 16, h, C.greyS);
        rect(ctx, 0, h - 1, 16, 1, C.greyL);
      },
    });
  }
  buildSheet(scene, 'boss_door', 16, 20, door);
}
