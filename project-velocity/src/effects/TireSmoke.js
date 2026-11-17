import * as THREE from 'three';

/**
 * 타이어 연기 파티클. 고정 크기 풀(ring buffer)을 쓰는 단일 Points 드로우콜.
 * 생성 수가 상한을 넘으면 가장 오래된 입자를 재사용한다.
 */
export class TireSmoke {
  constructor(scene, config) {
    this.config = config;
    const n = config.maxParticles;
    this.count = n;
    this.next = 0;
    this.alive = 0;

    this.positions = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    this.alphas = new Float32Array(n);
    this.velocities = new Float32Array(n * 3);
    this.ages = new Float32Array(n);
    this.lives = new Float32Array(n);
    this.strength = new Float32Array(n);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: createPuffTexture() },
        uColor: { value: new THREE.Color(config.color) },
        uScale: { value: 500 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(-mv.z, 0.1) : 0.0;
          vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  /** 화면 높이(px)와 시야각에 맞춰 파티클 크기를 월드 단위(m)로 유지 */
  setViewport(heightPx, fovDeg) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(x, y, z, vx, vy, vz, strength) {
    const c = this.config;
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = vx;
    this.velocities[i * 3 + 1] = vy;
    this.velocities[i * 3 + 2] = vz;
    this.ages[i] = 0;
    this.lives[i] = c.lifeMin + Math.random() * (c.lifeMax - c.lifeMin);
    this.strength[i] = strength;
    this.sizes[i] = c.startSize;
    this.alphas[i] = 0.0001;
  }

  update(dt) {
    const c = this.config;
    const drag = Math.exp(-1.6 * dt);
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.alphas[i] <= 0) continue;
      const age = (this.ages[i] += dt);
      const t = age / this.lives[i];
      if (t >= 1) {
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      alive++;
      const k = i * 3;
      this.velocities[k] *= drag;
      this.velocities[k + 1] = this.velocities[k + 1] * drag + 0.5 * dt; // 천천히 상승
      this.velocities[k + 2] *= drag;
      this.positions[k] += this.velocities[k] * dt;
      this.positions[k + 1] += this.velocities[k + 1] * dt;
      this.positions[k + 2] += this.velocities[k + 2] * dt;
      this.sizes[i] = c.startSize + (c.endSize - c.startSize) * Math.sqrt(t);
      const fadeIn = Math.min(age / 0.12, 1);
      this.alphas[i] = Math.max(c.maxAlpha * this.strength[i] * fadeIn * Math.pow(1 - t, 1.6), 0.0001);
    }
    this.alive = alive;
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  clear() {
    this.alphas.fill(0);
    this.sizes.fill(0);
    this.alive = 0;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}

function createPuffTexture() {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(canvas);
}
