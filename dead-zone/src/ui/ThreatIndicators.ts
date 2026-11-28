import * as THREE from 'three';
import { Zombie, ZombieState } from '../enemies/Zombie';

const MAX = 6;

/**
 * 화면 밖 위협 방향 표시: 화면 가장자리에 작은 화살표 (보스 = 빨강, 엘리트 = 금색, 폭발 준비 = 주황).
 * 화면 안에 보이는 적은 표시하지 않는다. DOM 6개를 재사용.
 */
export class ThreatIndicators {
  private readonly els: HTMLDivElement[] = [];
  private readonly v = new THREE.Vector3();
  /** 이번 프레임에 표시한 수 (테스트) */
  shown = 0;

  constructor(parent: HTMLElement) {
    const layer = document.createElement('div');
    layer.className = 'threat-layer';
    parent.appendChild(layer);
    for (let i = 0; i < MAX; i++) {
      const el = document.createElement('div');
      el.className = 'threat';
      el.style.display = 'none';
      layer.appendChild(el);
      this.els.push(el);
    }
  }

  update(zombies: readonly Zombie[], camera: THREE.Camera, width: number, height: number): void {
    let n = 0;
    for (const z of zombies) {
      if (n >= MAX) break;
      if (!z.alive || z.state === ZombieState.Spawn) continue;
      const kind = z.stats.kind === 'boss' ? 'boss' : z.stats.elite ? 'elite' : z.special === 'prime' ? 'prime' : null;
      if (!kind) continue;
      this.v.set(z.position.x, 1, z.position.z).project(camera);
      const behind = this.v.z > 1;
      let x = behind ? -this.v.x : this.v.x;
      let y = behind ? -this.v.y : this.v.y;
      if (!behind && Math.abs(x) < 0.95 && Math.abs(y) < 0.92) continue; // 화면 안: 표시 안 함
      // 화면 가장자리로 밀어냄
      const k = 1 / Math.max(Math.abs(x) / 0.93, Math.abs(y) / 0.88, 1e-3);
      x *= k; y *= k;
      const sx = (x * 0.5 + 0.5) * width;
      const sy = (-y * 0.5 + 0.5) * height;
      const ang = Math.atan2(-y, x);
      const el = this.els[n++];
      el.style.display = '';
      el.className = `threat ${kind}`;
      el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -50%) rotate(${ang.toFixed(3)}rad)`;
    }
    for (let i = n; i < MAX; i++) this.els[i].style.display = 'none';
    this.shown = n;
  }

  clear(): void {
    for (const el of this.els) el.style.display = 'none';
    this.shown = 0;
  }
}
