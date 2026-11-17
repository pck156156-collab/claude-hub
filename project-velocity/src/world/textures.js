import * as THREE from 'three';
import { mulberry32 } from '../utils/math.js';

// 외부 이미지 없이 Canvas 로 절차적 텍스처를 생성한다.

function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function speckle(ctx, w, h, count, rand, colors, size = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    ctx.fillRect(rand() * w, rand() * h, size * rand() + 0.5, size * rand() + 0.5);
  }
}

/**
 * 아스팔트 도로 텍스처. 가로(u) = 도로 폭 방향, 세로(v) = 진행 방향 16m.
 * 양쪽 흰 실선 + 중앙 흰 점선(8m 칠함 / 8m 비움) 포함.
 */
export function createAsphaltTexture() {
  return canvasTexture(256, 512, (ctx, w, h) => {
    const rand = mulberry32(7);
    ctx.fillStyle = '#3b3c40';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, rand, ['#2f3033', '#46474b', '#525357', '#35363a'], 2);
    // 미세한 타이어 자국
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#111';
    ctx.fillRect(w * 0.22, 0, w * 0.1, h);
    ctx.fillRect(w * 0.68, 0, w * 0.1, h);
    ctx.globalAlpha = 1;
    // 경계 실선 (도로 폭 14m 기준 약 0.3m)
    ctx.fillStyle = '#ecebe6';
    ctx.fillRect(w * 0.02, 0, w * 0.022, h);
    ctx.fillRect(w * 0.958, 0, w * 0.022, h);
    // 중앙 점선
    ctx.fillRect(w * 0.494, 0, w * 0.012, h * 0.5);
  });
}

/** 연석 텍스처: 진행 방향 2m 간격의 빨강/흰색 줄무늬 (v 1 = 4m) */
export function createCurbTexture() {
  return canvasTexture(32, 64, (ctx, w, h) => {
    ctx.fillStyle = '#d42a24';
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = '#f2f2ee';
    ctx.fillRect(0, h / 2, w, h / 2);
  });
}

/** 잔디 텍스처 */
export function createGrassTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rand = mulberry32(11);
    ctx.fillStyle = '#5d8a3a';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 14000, rand, ['#557f34', '#679542', '#4f7630', '#6f9c49', '#5a8638'], 3);
  });
}
