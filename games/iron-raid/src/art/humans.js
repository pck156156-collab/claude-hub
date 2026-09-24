// Procedural chibi soldiers. One parametric drawer makes the player, enemy
// soldiers and prisoners; frames are packed per character into named frames.
import { C } from '../palette.js';
import { rect, dot, ellipse, line, makeCanvas, drawRotated, buildSheet } from '../gfx.js';

export const HW = 40; // frame width
export const HH = 44; // frame height
const HX = 20; // hip x
const FEET = 43;

export const PAL = {
  player: {
    skin: C.skin, skinS: C.skinS, top: C.olive, topS: C.oliveS, pants: C.khaki, pantsS: C.khakiS,
    boot: C.hair, head: 'bandana', band: C.red, bandS: C.redS, hair: C.hair,
  },
  enemy: {
    skin: C.skin, skinS: C.skinS, top: C.grey, topS: C.greyS, pants: C.greyS, pantsS: '#2c3540',
    boot: '#2a2622', head: 'helmet', helm: C.greyS, helmL: C.grey,
  },
  pow: {
    skin: C.skinS, skinS: C.skinD, top: C.skinS, topS: C.skinD, pants: C.cloth, pantsS: C.clothS,
    boot: C.skinD, head: 'pow', hair: C.hair,
  },
};

/**
 * o: { pal, legs: 'stand'|'run'|'jump'|'crouch'|'sit', phase, aim: 'fwd'|'up'|'down'|'none'|
 *      'handsup'|'throw0'|'throw1'|'throw2'|'knife0'|'knife1'|'salute'|'tied'|'chat0'|'chat1'|'give'|'alert',
 *      gun: 'pistol'|'rifle'|'big'|null, flash, bob }
 */
export function drawHuman(ctx, o) {
  const p = o.pal;
  const crouch = o.legs === 'crouch' || o.legs === 'sit';
  const hipY = (crouch ? FEET - 7 : FEET - 12) + (o.bob || 0);
  const shY = hipY - 10; // shoulder line
  const headY = shY - 7; // head centre

  // ---- legs (back leg first, darker)
  const leg = (fx, fy, kx, ky, dark) => {
    const col = dark ? p.pantsS : p.pants;
    line(ctx, HX + (dark ? -1 : 1), hipY, kx, ky, col, 3);
    line(ctx, kx, ky, fx, fy - 1, col, 3);
    rect(ctx, fx - 2, fy - 2, 5, 3, p.boot);
  };
  if (o.legs === 'run') {
    const t = o.phase * Math.PI * 2;
    const a = Math.sin(t);
    const f1 = [HX + Math.round(6 * a), FEET - Math.round(3 * Math.max(0, Math.cos(t)))];
    const f2 = [HX - Math.round(6 * a), FEET - Math.round(3 * Math.max(0, -Math.cos(t)))];
    leg(f2[0], f2[1], (HX + f2[0]) / 2 + 2, hipY + 5, true);
    leg(f1[0], f1[1], (HX + f1[0]) / 2 + 2, hipY + 5, false);
  } else if (o.legs === 'jump') {
    leg(HX - 3, FEET - 2, HX + 1, hipY + 5, true);
    leg(HX + 5, FEET - 4, HX + 6, hipY + 3, false);
  } else if (o.legs === 'crouch') {
    leg(HX - 4, FEET, HX - 6, hipY + 3, true);
    leg(HX + 6, FEET, HX + 7, hipY + 1, false);
  } else if (o.legs === 'sit') {
    line(ctx, HX, hipY + 1, HX + 9, FEET - 1, p.pantsS, 3);
    line(ctx, HX + 1, hipY + 2, HX + 11, FEET - 1, p.pants, 3);
    rect(ctx, HX + 9, FEET - 2, 4, 3, p.boot);
  } else {
    leg(HX - 3, FEET, HX - 2, hipY + 6, true);
    leg(HX + 3, FEET, HX + 3, hipY + 6, false);
  }

  // ---- torso
  rect(ctx, HX - 5, shY, 11, hipY - shY + 1, p.top);
  rect(ctx, HX - 5, shY, 3, hipY - shY + 1, p.topS);
  rect(ctx, HX - 5, hipY - 1, 11, 2, p.pantsS);
  if (p.head === 'bandana') {
    // vest pockets
    rect(ctx, HX + 1, shY + 3, 3, 3, p.topS);
    dot(ctx, HX + 2, shY + 3, C.oliveL);
  }
  if (p.head === 'helmet') {
    line(ctx, HX - 4, shY + 1, HX + 4, hipY - 2, p.topS, 1); // strap
  }
  if (o.aim === 'tied') {
    line(ctx, HX - 5, shY + 3, HX + 5, shY + 5, C.woodS, 1);
    line(ctx, HX - 5, shY + 6, HX + 5, shY + 8, C.woodS, 1);
  }

  // ---- back arm for poses that show both arms
  const back = [HX - 3, shY + 2];
  if (o.aim === 'handsup') line(ctx, back[0], back[1], HX - 7, headY - 9, p.topS, 3);

  // ---- head
  const hx = HX + 1;
  ellipse(ctx, hx, headY, 7, 7, p.skin);
  ellipse(ctx, hx - 2, headY + 1, 4, 5, p.skinS);
  ellipse(ctx, hx + 1, headY, 5, 6, p.skin);
  if (p.head === 'bandana') {
    ellipse(ctx, hx - 1, headY - 3, 7, 4, p.hair);
    rect(ctx, hx - 7, headY - 4, 15, 3, p.band);
    rect(ctx, hx - 7, headY - 2, 15, 1, p.bandS);
    const flap = o.legs === 'run' ? Math.round(Math.sin(o.phase * Math.PI * 4)) : 0;
    line(ctx, hx - 7, headY - 3, hx - 12, headY - 1 + flap, p.band, 2);
    line(ctx, hx - 7, headY - 2, hx - 11, headY + 2 + flap, p.bandS, 2);
  } else if (p.head === 'helmet') {
    ellipse(ctx, hx, headY - 3, 8, 5, p.helm);
    rect(ctx, hx - 8, headY - 1, 17, 2, p.helm);
    rect(ctx, hx - 4, headY - 7, 7, 2, p.helmL);
    rect(ctx, hx + 7, headY - 1, 3, 1, p.helm);
  } else if (p.head === 'pow') {
    ellipse(ctx, hx - 3, headY - 1, 4, 5, p.hair);
    ellipse(ctx, hx + 2, headY + 4, 5, 3, p.hair);
    rect(ctx, hx + 2, headY + 2, 4, 1, C.skinD);
  }
  // eye (+ open mouth when alert)
  const eyeX = hx + 4;
  rect(ctx, eyeX, headY - 1, 1, 2, C.outline);
  if (o.aim === 'alert' || o.aim === 'handsup') {
    rect(ctx, eyeX - 1, headY - 2, 3, 3, C.white);
    rect(ctx, eyeX, headY - 1, 1, 1, C.outline);
    rect(ctx, eyeX, headY + 3, 2, 2, C.redS);
  }

  // ---- front arm / weapon
  const sh = [HX + 1, shY + 2];
  const gunLen = o.gun === 'rifle' ? 13 : o.gun === 'big' ? 14 : 8;
  const flash = (x, y, dir) => {
    const [dx, dy] = dir;
    rect(ctx, x - 2 + dx * 2, y - 2 + dy * 2, 5, 5, C.fire1);
    rect(ctx, x - 1 + dx * 2, y - 1 + dy * 2, 3, 3, C.fire0);
    dot(ctx, x + dx * 5, y + dy * 5, C.fire0);
  };
  switch (o.aim) {
    case 'fwd': {
      const y = sh[1] + 1;
      line(ctx, sh[0], sh[1], HX + 5, y, p.top, 3);
      rect(ctx, HX + 4, y - 1, 3, 3, p.skin);
      if (o.gun) {
        rect(ctx, HX + 5, y - 2, gunLen, 3, C.gun);
        rect(ctx, HX + 5, y - 2, gunLen, 1, C.gunL);
        rect(ctx, HX + 6, y + 1, 2, 3, C.gunS);
        if (o.gun === 'rifle' || o.gun === 'big') rect(ctx, HX + 3, y - 1, 3, 2, C.gunS);
        if (o.gun === 'big') rect(ctx, HX + 12, y + 1, 4, 3, C.gunS);
        if (o.flash) flash(HX + 5 + gunLen + 1, y - 1, [1, 0]);
      }
      break;
    }
    case 'up': {
      const x = HX + 7;
      line(ctx, sh[0], sh[1], x, sh[1] - 2, p.top, 3);
      rect(ctx, x - 1, sh[1] - 4, 3, 3, p.skin);
      if (o.gun) {
        rect(ctx, x - 1, sh[1] - 4 - gunLen, 3, gunLen, C.gun);
        rect(ctx, x - 1, sh[1] - 4 - gunLen, 1, gunLen, C.gunL);
        if (o.flash) flash(x, sh[1] - 6 - gunLen, [0, -1]);
      }
      break;
    }
    case 'down': {
      const x = HX + 4;
      line(ctx, sh[0], sh[1], x, sh[1] + 5, p.top, 3);
      rect(ctx, x - 1, sh[1] + 5, 3, 3, p.skin);
      if (o.gun) {
        rect(ctx, x - 1, sh[1] + 7, 3, gunLen, C.gun);
        if (o.flash) flash(x, sh[1] + 8 + gunLen, [0, 1]);
      }
      break;
    }
    case 'throw0':
      line(ctx, sh[0], sh[1], HX - 6, sh[1] - 4, p.top, 3);
      rect(ctx, HX - 9, sh[1] - 7, 4, 4, C.oliveS);
      break;
    case 'throw1':
      line(ctx, sh[0], sh[1], HX + 1, headY - 9, p.top, 3);
      rect(ctx, HX, headY - 12, 4, 4, C.oliveS);
      break;
    case 'throw2':
      line(ctx, sh[0], sh[1], HX + 9, sh[1] - 3, p.top, 3);
      rect(ctx, HX + 8, sh[1] - 5, 3, 3, p.skin);
      break;
    case 'knife0':
      line(ctx, sh[0], sh[1], HX - 3, sh[1] - 5, p.top, 3);
      rect(ctx, HX - 5, sh[1] - 11, 2, 7, C.gunL);
      break;
    case 'knife1':
      line(ctx, sh[0], sh[1], HX + 8, sh[1] + 2, p.top, 3);
      rect(ctx, HX + 8, sh[1], 3, 3, p.skin);
      rect(ctx, HX + 11, sh[1] + 1, 8, 2, C.gunL);
      rect(ctx, HX + 11, sh[1] + 1, 8, 1, C.white);
      break;
    case 'handsup':
      line(ctx, sh[0], sh[1], HX + 7, headY - 9, p.top, 3);
      rect(ctx, HX + 6, headY - 12, 3, 3, p.skin);
      break;
    case 'salute':
      line(ctx, sh[0], sh[1], HX + 7, shY - 1, p.top, 3);
      line(ctx, HX + 7, shY - 1, HX + 5, headY - 4, p.skin, 2);
      break;
    case 'give':
      line(ctx, sh[0], sh[1], HX + 9, sh[1] + 1, p.top, 3);
      rect(ctx, HX + 9, sh[1] - 1, 3, 3, p.skin);
      break;
    case 'chat0':
      line(ctx, sh[0], sh[1], HX + 4, sh[1] + 6, p.top, 3);
      rect(ctx, HX + 4, sh[1] + 6, 3, 3, p.skin);
      break;
    case 'chat1':
      line(ctx, sh[0], sh[1], HX + 7, sh[1] - 3, p.top, 3);
      rect(ctx, HX + 7, sh[1] - 5, 3, 3, p.skin);
      break;
    case 'alert':
      line(ctx, sh[0], sh[1], HX + 8, sh[1] - 6, p.top, 3);
      rect(ctx, HX + 8, sh[1] - 8, 3, 3, p.skin);
      break;
    case 'tied':
    case 'none':
    default:
      line(ctx, sh[0], sh[1], HX + 2, hipY - 2, p.top, 3);
      rect(ctx, HX + 1, hipY - 2, 3, 3, p.skin);
  }
}

// A human frame, optionally rotated around the feet (for death falls).
function frame(name, o, angle = 0, drop = 0) {
  return {
    name,
    draw(ctx) {
      if (!angle) {
        ctx.translate(0, drop);
        drawHuman(ctx, o);
        return;
      }
      const [c, cx] = makeCanvas(HW, HH);
      drawHuman(cx, o);
      drawRotated(ctx, c, angle, HX, FEET, HX, FEET + drop);
    },
  };
}

const RUN_N = 8;

export function buildHumans(scene) {
  // ---------------- player
  const pl = PAL.player;
  const pf = [];
  for (const gun of ['pistol', 'rifle', 'big']) {
    const g = gun[0];
    for (const aim of ['fwd', 'up']) {
      for (const fl of [0, 1]) {
        pf.push(frame(`${g}_stand_${aim}_${fl}`, { pal: pl, legs: 'stand', aim, gun, flash: fl }));
        pf.push(frame(`${g}_crouch_${aim}_${fl}`, { pal: pl, legs: 'crouch', aim: 'fwd', gun, flash: fl }));
        for (let i = 0; i < RUN_N; i++) {
          const phase = i / RUN_N;
          pf.push(frame(`${g}_run_${aim}_${fl}_${i}`, { pal: pl, legs: 'run', phase, aim, gun, flash: fl, bob: -Math.round(Math.abs(Math.sin(phase * Math.PI * 2))) }));
        }
      }
    }
    for (const aim of ['fwd', 'up', 'down']) {
      for (const fl of [0, 1]) pf.push(frame(`${g}_jump_${aim}_${fl}`, { pal: pl, legs: 'jump', aim, gun, flash: fl }));
    }
    for (let b = 0; b < 2; b++) pf.push(frame(`${g}_idle_${b}`, { pal: pl, legs: 'stand', aim: 'fwd', gun, bob: b }));
  }
  for (const legs of ['stand', 'crouch', 'jump']) {
    for (let i = 0; i < 3; i++) pf.push(frame(`throw_${legs}_${i}`, { pal: pl, legs, aim: `throw${i}` }));
    for (let i = 0; i < 2; i++) pf.push(frame(`knife_${legs}_${i}`, { pal: pl, legs, aim: `knife${i}` }));
  }
  const dieAngles = [0, -0.35, -0.8, -1.2, -1.57, -1.57];
  dieAngles.forEach((a, i) => pf.push(frame(`die_${i}`, { pal: pl, legs: 'stand', aim: 'handsup' }, a, i > 3 ? 0 : 0)));
  pf.push(frame('win_0', { pal: pl, legs: 'stand', aim: 'salute' }));
  pf.push(frame('win_1', { pal: pl, legs: 'jump', aim: 'handsup' }));
  buildSheet(scene, 'player', HW, HH, pf);

  // ---------------- enemy soldier
  const en = PAL.enemy;
  const ef = [];
  for (let i = 0; i < 2; i++) ef.push(frame(`chat_${i}`, { pal: en, legs: 'stand', aim: `chat${i}`, bob: i }));
  ef.push(frame('alert_0', { pal: en, legs: 'jump', aim: 'alert' }));
  for (let i = 0; i < RUN_N; i++) {
    const phase = i / RUN_N;
    const bob = -Math.round(Math.abs(Math.sin(phase * Math.PI * 2)));
    ef.push(frame(`walk_${i}`, { pal: en, legs: 'run', phase, aim: 'fwd', gun: 'rifle', bob }));
    ef.push(frame(`flee_${i}`, { pal: en, legs: 'run', phase, aim: 'handsup', bob }));
    ef.push(frame(`kwalk_${i}`, { pal: en, legs: 'run', phase, aim: 'knife0', bob }));
  }
  for (const fl of [0, 1]) {
    ef.push(frame(`shoot_${fl}`, { pal: en, legs: 'stand', aim: 'fwd', gun: 'rifle', flash: fl }));
    ef.push(frame(`cshoot_${fl}`, { pal: en, legs: 'crouch', aim: 'fwd', gun: 'rifle', flash: fl }));
  }
  for (let i = 0; i < 3; i++) ef.push(frame(`throw_${i}`, { pal: en, legs: 'stand', aim: `throw${i}` }));
  for (let i = 0; i < 2; i++) ef.push(frame(`knife_${i}`, { pal: en, legs: 'stand', aim: `knife${i}` }));
  ef.push(frame('hurt_0', { pal: en, legs: 'jump', aim: 'handsup' }));
  dieAngles.forEach((a, i) => ef.push(frame(`die_${i}`, { pal: en, legs: 'stand', aim: 'handsup' }, a)));
  buildSheet(scene, 'soldier', HW, HH, ef);

  // ---------------- prisoner (POW)
  const pw = PAL.pow;
  const wf = [];
  for (let i = 0; i < 2; i++) wf.push(frame(`tied_${i}`, { pal: pw, legs: 'sit', aim: 'tied', bob: i }));
  wf.push(frame('free_0', { pal: pw, legs: 'jump', aim: 'handsup' }));
  for (let i = 0; i < RUN_N; i++) {
    const phase = i / RUN_N;
    wf.push(frame(`run_${i}`, { pal: pw, legs: 'run', phase, aim: 'none', bob: -Math.round(Math.abs(Math.sin(phase * Math.PI * 2))) }));
  }
  wf.push(frame('give_0', { pal: pw, legs: 'stand', aim: 'give' }));
  wf.push(frame('salute_0', { pal: pw, legs: 'stand', aim: 'salute' }));
  buildSheet(scene, 'pow', HW, HH, wf);
}
