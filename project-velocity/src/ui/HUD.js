import { damp } from '../utils/math.js';

const GAUGE_MAX_KMH = 240;
const FAST_KMH = 190;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 속도계 HUD (우측 하단). 제목·조작 안내는 index.html 의 정적 요소.
 * - 표시 숫자는 실제 속도를 부드럽게 따라감 (깜빡임 방지)
 * - 게이지 색: 저속 청록 → 중속 호박색 → 고속 빨강, 190km/h 이상 강조 효과
 * - DOM 갱신은 값이 바뀔 때만 수행
 */
export class HUD {
  constructor(root = document) {
    this.panel = root.getElementById('hud-speed');
    this.speedEl = root.getElementById('speed-value');
    this.gearEl = root.getElementById('gear');
    this.display = 0;
    this.lastShown = -1;
    this.lastGear = '';
    this.lastFast = false;
    this.buildTicks(root.getElementById('gauge-ticks'));
  }

  buildTicks(g) {
    if (!g) return;
    const cx = 110;
    const cy = 118;
    for (let kmh = 0; kmh <= GAUGE_MAX_KMH; kmh += 20) {
      const a = Math.PI - (kmh / GAUGE_MAX_KMH) * Math.PI;
      const major = kmh % 60 === 0;
      const r0 = major ? 72 : 76;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', (cx + Math.cos(a) * r0).toFixed(1));
      line.setAttribute('y1', (cy - Math.sin(a) * r0).toFixed(1));
      line.setAttribute('x2', (cx + Math.cos(a) * 82).toFixed(1));
      line.setAttribute('y2', (cy - Math.sin(a) * 82).toFixed(1));
      if (major) line.setAttribute('class', 'major');
      g.appendChild(line);
      if (major) {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', (cx + Math.cos(a) * 62).toFixed(1));
        t.setAttribute('y', (cy - Math.sin(a) * 62).toFixed(1));
        t.textContent = String(kmh);
        g.appendChild(t);
      }
    }
  }

  /** 속도 비율(0~1)에 따른 게이지 색 */
  static colorFor(r) {
    let hue;
    if (r < 0.5) hue = 190;
    else if (r < 0.75) hue = 190 - ((r - 0.5) / 0.25) * 148; // → 42 (호박색)
    else hue = 42 - ((r - 0.75) / 0.25) * 50; // → -8 (빨강)
    return `hsl(${((hue % 360) + 360) % 360} 95% 58%)`;
  }

  update(vehicle, dt = 1 / 60) {
    const actual = vehicle.speedKmh;
    this.display += (actual - this.display) * damp(10, dt);
    if (Math.abs(actual - this.display) < 0.05) this.display = actual;
    const shown = Math.round(this.display);
    if (shown !== this.lastShown) {
      this.speedEl.textContent = String(shown);
      const r = Math.min(this.display / GAUGE_MAX_KMH, 1);
      const style = this.panel.style;
      style.setProperty('--spd', r.toFixed(3));
      style.setProperty('--spd-color', HUD.colorFor(r));
      const fast = shown >= FAST_KMH;
      if (fast !== this.lastFast) {
        this.panel.classList.toggle('is-fast', fast);
        this.lastFast = fast;
      }
      this.lastShown = shown;
    }
    const kmh = Math.round(actual);
    const gear = vehicle.gear < 0 ? 'R' : kmh === 0 ? 'N' : 'D';
    if (gear !== this.lastGear) {
      this.gearEl.textContent = gear;
      this.gearEl.classList.toggle('is-reverse', gear === 'R');
      this.gearEl.classList.toggle('is-neutral', gear === 'N');
      this.lastGear = gear;
    }
  }
}
