// 이미지/오디오/JSON을 비동기로 미리 불러온다.
export class Assets {
  constructor() {
    this.images = new Map();
    this.sounds = new Map();
    this.data = new Map();
  }

  async load({ images = {}, sounds = {}, json = {} } = {}) {
    const jobs = [
      ...Object.entries(images).map(([k, src]) => loadImage(src).then((v) => this.images.set(k, v))),
      ...Object.entries(sounds).map(([k, src]) => loadSound(src).then((v) => this.sounds.set(k, v))),
      ...Object.entries(json).map(([k, src]) => fetch(src).then((r) => r.json()).then((v) => this.data.set(k, v))),
    ];
    await Promise.all(jobs);
    return this;
  }

  image(key) { return this.images.get(key); }
  json(key) { return this.data.get(key); }

  play(key, volume = 1) {
    const base = this.sounds.get(key);
    if (!base) return;
    const s = base.cloneNode();
    s.volume = volume;
    s.play().catch(() => {});
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}

function loadSound(src) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.oncanplaythrough = () => resolve(a);
    a.onerror = () => reject(new Error(`사운드 로드 실패: ${src}`));
    a.src = src;
  });
}
