/** DOM 오버레이 HUD: 속도계 (오른쪽 하단). 제목·조작 안내는 index.html 의 정적 요소. */
export class HUD {
  constructor(root = document) {
    this.speedEl = root.getElementById('speed-value');
    this.barEl = root.getElementById('speed-bar-fill');
    this.gearEl = root.getElementById('gear');
    this.lastSpeed = -1;
    this.lastGear = '';
  }

  update(vehicle) {
    const kmh = Math.round(vehicle.speedKmh);
    if (kmh !== this.lastSpeed) {
      this.speedEl.textContent = String(kmh);
      const max = vehicle.config.engine.maxSpeed * 3.6;
      this.barEl.style.transform = `scaleX(${Math.min(kmh / max, 1).toFixed(3)})`;
      this.lastSpeed = kmh;
    }
    const gear = vehicle.gear < 0 ? 'R' : kmh === 0 ? 'N' : 'D';
    if (gear !== this.lastGear) {
      this.gearEl.textContent = gear;
      this.lastGear = gear;
    }
  }
}
