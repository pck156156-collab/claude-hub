import * as THREE from 'three';
import { Random } from '../core/random';

/** 절차적 캔버스 텍스처. 외부 이미지 없이 바닥 · 건물 · 소품 질감을 만든다. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Random, count: number, light: string, dark: string, maxSize = 2) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng.chance(0.5) ? light : dark;
    const s = rng.range(0.5, maxSize);
    ctx.fillRect(rng.range(0, w), rng.range(0, h), s, s);
  }
}

function blotches(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Random, count: number, color: string, minR: number, maxR: number) {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const r = rng.range(minR, maxR);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function cracks(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Random, count: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = rng.range(0, w);
    let y = rng.range(0, h);
    let a = rng.range(0, Math.PI * 2);
    ctx.lineWidth = rng.range(0.6, 1.6);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = rng.int(4, 12);
    for (let s = 0; s < steps; s++) {
      a += rng.range(-0.7, 0.7);
      x += Math.cos(a) * rng.range(4, 14);
      y += Math.sin(a) * rng.range(4, 14);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** 콘크리트 바닥 (보도 · 광장) */
export function concreteTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Random(11);
  ctx.fillStyle = '#6f6d68';
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, rng, 40, 'rgba(40,38,34,0.22)', 20, 90);
  blotches(ctx, S, S, rng, 25, 'rgba(150,145,135,0.15)', 20, 70);
  speckle(ctx, S, S, rng, 9000, 'rgba(160,156,148,0.35)', 'rgba(30,30,28,0.35)');
  // 슬래브 이음매
  ctx.strokeStyle = 'rgba(35,33,30,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(S, i * 128); ctx.stroke();
  }
  cracks(ctx, S, S, rng, 14, 'rgba(25,24,22,0.6)');
  return toTexture(c);
}

/** 아스팔트 도로 */
export function asphaltTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Random(23);
  ctx.fillStyle = '#3a3a3c';
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, rng, 50, 'rgba(20,20,22,0.3)', 15, 80);
  blotches(ctx, S, S, rng, 20, 'rgba(90,88,84,0.15)', 15, 60);
  speckle(ctx, S, S, rng, 14000, 'rgba(120,120,118,0.4)', 'rgba(10,10,12,0.45)', 1.6);
  cracks(ctx, S, S, rng, 22, 'rgba(12,12,12,0.7)');
  // 땜질 자국
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = 'rgba(24,24,26,0.55)';
    ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(30, 90), rng.range(20, 60));
  }
  return toTexture(c);
}

/** 거칠기 맵 (밝을수록 거침) */
export function roughnessNoise(seed: number, base = 200): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = new Random(seed);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, rng, 30, 'rgba(60,60,60,0.5)', 10, 50);
  speckle(ctx, S, S, rng, 3000, 'rgba(255,255,255,0.3)', 'rgba(0,0,0,0.3)');
  return toTexture(c, 1, false);
}

export interface FacadeTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

/**
 * 건물 외벽: 층별 창문, 일부 깨진 창, 그을음.
 * 한 장에 4개 층 × 4개 창. 건물 크기에 맞춰 반복한다.
 */
export function facadeTexture(seed: number, wall: string, trim: string): FacadeTextures {
  const W = 256;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const [ec, ectx] = canvas(W, H);
  const rng = new Random(seed);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, rng, 3000, 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.15)');
  const floors = 4;
  const cols = 4;
  const fh = H / floors;
  const cw = W / cols;
  for (let f = 0; f < floors; f++) {
    // 층 구분 띠
    ctx.fillStyle = trim;
    ctx.fillRect(0, f * fh + fh - 6, W, 6);
    for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * 0.18;
      const y = f * fh + fh * 0.2;
      const w = cw * 0.64;
      const h = fh * 0.55;
      const r = rng.next();
      ctx.fillStyle = trim;
      ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      if (r < 0.35) {
        // 깨진 창: 검은 구멍 + 유리 조각
        ctx.fillStyle = '#0b0c0d';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(120,140,150,0.5)';
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x + w * rng.range(0.2, 0.6), y); ctx.lineTo(x, y + h * rng.range(0.3, 0.7));
        ctx.fill();
      } else if (r < 0.45) {
        // 판자로 막은 창
        ctx.fillStyle = '#4a3a28';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#2c2216';
        for (let p = 0; p < 3; p++) {
          ctx.beginPath(); ctx.moveTo(x, y + (p + 0.5) * h / 3); ctx.lineTo(x + w, y + (p + 0.5) * h / 3); ctx.stroke();
        }
      } else {
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, '#26323a');
        g.addColorStop(1, '#151b20');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + w * 0.1, y + 2, w * 0.2, h - 4);
        // 아주 드물게 불 켜진 창 (생존자의 흔적)
        if (r > 0.97) {
          ectx.fillStyle = '#d9a35a';
          ectx.fillRect(x, y, w, h);
          ctx.fillStyle = '#7a5a30';
          ctx.fillRect(x, y, w, h);
        }
      }
    }
  }
  // 그을음 · 얼룩
  blotches(ctx, W, H, rng, 6, 'rgba(10,10,10,0.35)', 20, 70);
  for (let i = 0; i < 8; i++) {
    const x = rng.range(0, W);
    const g = ctx.createLinearGradient(x, 0, x, H);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, rng.range(3, 10), H);
  }
  const map = toTexture(c);
  const emissive = toTexture(ec);
  return { map, emissive };
}

/** 나무 상자 판자 */
export function crateTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const rng = new Random(5);
  ctx.fillStyle = '#7b5d3a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#6e5232' : '#84633e';
    ctx.fillRect(0, i * 32 + 2, S, 28);
  }
  speckle(ctx, S, S, rng, 800, 'rgba(255,230,190,0.12)', 'rgba(30,20,10,0.25)');
  ctx.strokeStyle = '#4a361f';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, S - 6, S - 6);
  ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(S - 6, S - 6); ctx.stroke();
  return toTexture(c);
}

/** 녹슨 금속 (드럼통 · 차량 부식) */
export function rustTexture(seed: number, base: string): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const rng = new Random(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  blotches(ctx, S, S, rng, 18, 'rgba(110,55,20,0.55)', 6, 26);
  blotches(ctx, S, S, rng, 10, 'rgba(50,25,10,0.5)', 4, 14);
  speckle(ctx, S, S, rng, 900, 'rgba(160,90,40,0.4)', 'rgba(20,10,5,0.35)');
  return toTexture(c);
}

/** 바닥 데칼 (핏자국 · 기름 얼룩 · 탄 자국) */
export function decalTexture(kind: 'stain' | 'scorch' | 'blood'): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const rng = new Random(kind === 'stain' ? 3 : kind === 'scorch' ? 8 : 13);
  const color = kind === 'stain' ? 'rgba(10,10,12,0.35)' : kind === 'scorch' ? 'rgba(8,6,5,0.45)' : 'rgba(70,8,8,0.55)';
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, kind === 'blood' ? 34 : 22);
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d;
    const r = rng.range(8, kind === 'blood' ? 18 : 34);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(0.7, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 경고 줄무늬 (노랑 · 검정) */
export function hazardTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#1a1a1a';
  for (let i = -S; i < S * 2; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0); ctx.lineTo(i + 16, 0); ctx.lineTo(i + 16 - S, S); ctx.lineTo(i - S, S);
    ctx.fill();
  }
  const rng = new Random(4);
  speckle(ctx, S, S, rng, 600, 'rgba(255,255,255,0.1)', 'rgba(0,0,0,0.3)');
  return toTexture(c);
}

/** 연습 표적 과녁 */
export function bullseyeTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const rings = ['#f2efe6', '#c0262b', '#f2efe6', '#c0262b', '#f2efe6', '#c0262b'];
  rings.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - i * 10, 0, Math.PI * 2);
    ctx.fill();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
