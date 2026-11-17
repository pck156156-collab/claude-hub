import * as THREE from 'three';
import { mulberry32 } from '../utils/math.js';

// 외부 이미지 없이 Canvas 로 절차적 텍스처를 생성한다.
// 같은 텍스처를 여러 재질이 공유하도록 결과를 캐시한다.

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, { srgb = true, repeat = true, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = anisotropy;
  return t;
}

/** 픽셀 단위 밝기 노이즈 */
function grain(ctx, w, h, amount, rand, speckChance = 0, speckAmount = 0) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let n = (rand() - 0.5) * amount;
    if (speckChance && rand() < speckChance) n += (rand() - 0.5) * speckAmount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/** 세로 방향으로 이음매 없이 반복되도록 부드러운 얼룩을 그린다 */
function blotches(ctx, w, h, count, rand, minR, maxR, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = minR + rand() * (maxR - minR);
    const col = rand() < 0.5 ? '255,255,255' : '0,0,0';
    const a = alpha * (0.4 + rand() * 0.6);
    for (const oy of [-h, 0, h]) {
      for (const ox of [-w, 0, w]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${col},${a})`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
}

/**
 * 아스팔트 도로. 가로(u) = 도로 폭 14m, 세로(v) = 진행 방향 16m.
 * 경계 실선(약간 마모), 중앙 점선, 주행 라인 고무 자국 포함.
 */
export function createAsphaltTexture() {
  return cached('asphalt', () => {
    const W = 512;
    const H = 1024;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const rand = mulberry32(7);
    ctx.fillStyle = '#3c3d41';
    ctx.fillRect(0, 0, W, H);
    blotches(ctx, W, H, 220, rand, 25, 110, 0.05);
    // 주행 라인의 고무 자국 (두 줄)
    for (const [u0, u1] of [[0.22, 0.4], [0.6, 0.78]]) {
      const g = ctx.createLinearGradient(u0 * W, 0, u1 * W, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.09)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(u0 * W, 0, (u1 - u0) * W, H);
    }
    grain(ctx, W, H, 24, rand, 0.035, 70);
    // 도로 표시 (살짝 마모된 흰색)
    ctx.fillStyle = 'rgba(238,236,228,0.93)';
    ctx.fillRect(W * 0.02, 0, W * 0.022, H);
    ctx.fillRect(W * 0.958, 0, W * 0.022, H);
    ctx.fillRect(W * 0.494, 0, W * 0.012, H * 0.5);
    ctx.fillStyle = 'rgba(40,40,44,0.35)';
    for (let i = 0; i < 1600; i++) {
      const lx = [W * 0.02, W * 0.958, W * 0.494][i % 3];
      const lw = i % 3 === 2 ? W * 0.012 : W * 0.022;
      ctx.fillRect(lx + rand() * lw, rand() * H, 1 + rand() * 2, 1 + rand() * 3);
    }
    return toTexture(c);
  });
}

/** 아스팔트 미세 요철(범프맵) — 반복 주기를 색상 텍스처와 다르게 써서 반복감을 줄인다 */
export function createAsphaltBumpTexture() {
  return cached('asphaltBump', () => {
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const rand = mulberry32(19);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, S, S, 60, rand, 6, 30, 0.12);
    grain(ctx, S, S, 90, rand);
    return toTexture(c, { srgb: false });
  });
}

/** 연석: 진행 방향 2m 간격 빨강/흰색 (v 1 = 4m), 가장자리 음영 */
export function createCurbTexture() {
  return cached('curb', () => {
    const c = makeCanvas(64, 128);
    const ctx = c.getContext('2d');
    const rand = mulberry32(3);
    ctx.fillStyle = '#c8241f';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#efefe9';
    ctx.fillRect(0, 64, 64, 64);
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.18)');
    g.addColorStop(0.15, 'rgba(0,0,0,0)');
    g.addColorStop(0.85, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 128);
    grain(ctx, 64, 128, 14, rand);
    return toTexture(c);
  });
}

/** 잔디: 풀잎 획 + 노이즈 */
export function createGrassTexture() {
  return cached('grass', () => {
    const S = 512;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const rand = mulberry32(11);
    ctx.fillStyle = '#5a8a38';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, S, S, 70, rand, 20, 90, 0.07);
    const greens = ['#4f7c2f', '#679a42', '#5e8f3a', '#71a34b', '#4a742c', '#7aa651'];
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 16000; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const len = 2 + rand() * 5;
      const ang = -Math.PI / 2 + (rand() - 0.5) * 1.2;
      ctx.strokeStyle = greens[(rand() * greens.length) | 0];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    grain(ctx, S, S, 16, rand);
    return toTexture(c);
  });
}

/** 결승선 체커 (가로 16칸 × 세로 2줄) */
export function createCheckerTexture() {
  return cached('checker', () => {
    const c = makeCanvas(512, 64);
    const ctx = c.getContext('2d');
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f2f2ee';
        ctx.fillRect(x * 32, y * 32, 32, 32);
      }
    }
    grain(ctx, 512, 64, 18, mulberry32(5));
    return toTexture(c, { repeat: false });
  });
}

/** 콘크리트 방호벽: 2m 마다 이음매 */
export function createConcreteTexture() {
  return cached('concrete', () => {
    const S = 256;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const rand = mulberry32(23);
    ctx.fillStyle = '#b9b8b2';
    ctx.fillRect(0, 0, S, S);
    blotches(ctx, S, S, 40, rand, 10, 50, 0.08);
    grain(ctx, S, S, 22, rand);
    ctx.fillStyle = 'rgba(60,60,60,0.45)';
    ctx.fillRect(0, 0, S, 3);
    return toTexture(c);
  });
}

/** 철망 펜스 (알파 테스트용) */
export function createFenceTexture() {
  return cached('fence', () => {
    const S = 128;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = '#c3c7cc';
    ctx.lineWidth = 3;
    const step = S / 4;
    for (let k = -4; k <= 8; k++) {
      ctx.beginPath();
      ctx.moveTo(k * step, 0);
      ctx.lineTo(k * step + S, S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(k * step, S);
      ctx.lineTo(k * step + S, 0);
      ctx.stroke();
    }
    return toTexture(c);
  });
}

/** 가상의 스폰서 광고 (실제 브랜드 아님) — 1024×1024 아틀라스, 8행 × (8:1 비율) */
export const BANNER_SLOTS = [
  { text: 'PROJECT VELOCITY', bg: '#f4f4f0', fg: '#c4141f', stripe: '#c4141f' },
  { text: 'APEX LUBRICANTS', bg: '#141414', fg: '#ffd21f', stripe: '#ffd21f' },
  { text: 'NOVA TYRES', bg: '#1846b8', fg: '#ffffff', stripe: '#6fb4ff' },
  { text: 'GRIDLINE ENERGY', bg: '#b7f23a', fg: '#101010', stripe: '#101010' },
  { text: 'TURBO-X', bg: '#d61d2b', fg: '#ffffff', stripe: '#ffffff' },
  { text: 'KERB & CO', bg: '#ffcc00', fg: '#111111', stripe: '#111111' },
  { text: 'SKYLINE AERO', bg: '#0f1d3d', fg: '#e8f0ff', stripe: '#3fa0ff' },
  { text: 'FINISH LINE FM', bg: '#5b2a9e', fg: '#ffffff', stripe: '#ff7ad9' },
];

export function createBannerAtlas() {
  return cached('banners', () => {
    const W = 1024;
    const R = 128;
    const c = makeCanvas(W, R * BANNER_SLOTS.length);
    const ctx = c.getContext('2d');
    BANNER_SLOTS.forEach((b, i) => {
      const y = i * R;
      ctx.fillStyle = b.bg;
      ctx.fillRect(0, y, W, R);
      ctx.fillStyle = b.stripe;
      ctx.beginPath();
      ctx.moveTo(0, y + R);
      ctx.lineTo(70, y);
      ctx.lineTo(110, y);
      ctx.lineTo(40, y + R);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(W, y);
      ctx.lineTo(W - 70, y + R);
      ctx.lineTo(W - 110, y + R);
      ctx.lineTo(W - 40, y);
      ctx.fill();
      ctx.fillStyle = b.fg;
      ctx.font = 'italic 900 78px "Arial Black", "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.text, W / 2, y + R / 2 + 4, W - 260);
    });
    const t = toTexture(c, { repeat: false });
    return t;
  });
}

/** 아틀라스의 i 번째 광고가 차지하는 v 범위 (flipY 기준: 캔버스 위쪽 = v 1) */
export function bannerV(slot) {
  const n = BANNER_SLOTS.length;
  return { v0: 1 - (slot + 1) / n, v1: 1 - slot / n };
}

/**
 * 트랙 표지판 아틀라스: 4열 × 4행 (각 256×128)
 * 0 쉐브론 ◀  1 쉐브론 ▶  2~4 거리 150/100/50  5~12 코너 번호 T1~T8  13 PIT  14 SLOW  15 예비
 */
export const SIGN = { CHEVRON_LEFT: 0, CHEVRON_RIGHT: 1, DIST_150: 2, DIST_100: 3, DIST_50: 4, TURN_1: 5, PIT: 13, SLOW: 14 };

export function createSignAtlas() {
  return cached('signs', () => {
    const SW = 256;
    const SH = 128;
    const c = makeCanvas(SW * 4, SH * 4);
    const ctx = c.getContext('2d');
    const slot = (i) => [(i % 4) * SW, Math.floor(i / 4) * SH];
    const font = (px) => `900 ${px}px "Arial Black", Arial, sans-serif`;

    for (const [i, dir] of [[0, -1], [1, 1]]) {
      const [x, y] = slot(i);
      ctx.fillStyle = '#d4161f';
      ctx.fillRect(x, y, SW, SH);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 16;
      ctx.lineJoin = 'miter';
      for (let k = 0; k < 3; k++) {
        const cx = x + 60 + k * 68;
        ctx.beginPath();
        ctx.moveTo(cx - dir * 22, y + 24);
        ctx.lineTo(cx + dir * 22, y + SH / 2);
        ctx.lineTo(cx - dir * 22, y + SH - 24);
        ctx.stroke();
      }
    }
    ['150', '100', '50'].forEach((txt, k) => {
      const [x, y] = slot(2 + k);
      ctx.fillStyle = '#f5f5f2';
      ctx.fillRect(x, y, SW, SH);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 8;
      ctx.strokeRect(x + 8, y + 8, SW - 16, SH - 16);
      ctx.fillStyle = '#111';
      ctx.font = font(78);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, x + SW / 2, y + SH / 2 + 4);
    });
    for (let k = 0; k < 8; k++) {
      const [x, y] = slot(5 + k);
      ctx.fillStyle = '#12224a';
      ctx.fillRect(x, y, SW, SH);
      ctx.fillStyle = '#ffd21f';
      ctx.fillRect(x, y + SH - 14, SW, 14);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(72);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`T${k + 1}`, x + SW / 2, y + SH / 2 - 4);
    }
    {
      const [x, y] = slot(13);
      ctx.fillStyle = '#1846b8';
      ctx.fillRect(x, y, SW, SH);
      ctx.fillStyle = '#fff';
      ctx.font = font(76);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PIT', x + SW / 2, y + SH / 2 + 4);
    }
    {
      const [x, y] = slot(14);
      ctx.fillStyle = '#ffd21f';
      ctx.fillRect(x, y, SW, SH);
      ctx.fillStyle = '#111';
      ctx.font = font(64);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SLOW', x + SW / 2, y + SH / 2 + 4);
    }
    return toTexture(c, { repeat: false });
  });
}

/** 표지판 아틀라스 슬롯의 uv 사각형 */
export function signUV(i) {
  const col = i % 4;
  const row = Math.floor(i / 4);
  return { u0: col / 4, u1: (col + 1) / 4, v0: 1 - (row + 1) / 4, v1: 1 - row / 4 };
}

/** 라이트 글로우 (가산 혼합 스프라이트용) */
export function createGlowTexture() {
  return cached('glow', () => {
    const S = 64;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return toTexture(c, { repeat: false });
  });
}

/** 구름 스프라이트 */
export function createCloudTexture() {
  return cached('cloud', () => {
    const W = 512;
    const H = 256;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const rand = mulberry32(31);
    for (let i = 0; i < 26; i++) {
      const x = W * (0.18 + rand() * 0.64);
      const y = H * (0.45 + (rand() - 0.5) * 0.3);
      const r = 40 + rand() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(250,252,255,0.3)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return toTexture(c, { repeat: false });
  });
}
