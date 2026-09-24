import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';  // for .glb models from Blender

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141c);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(6, 5, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x303030, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(5, 10, 4);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x3f7f4a }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Player: WASD / arrow keys to move.
const player = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 8, 16), new THREE.MeshStandardMaterial({ color: 0x3a8ee6 }));
player.position.y = 1;
player.castShadow = true;
scene.add(player);

const pickups = [];
for (let i = 0; i < 8; i++) {
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0x553300 }));
  const a = (i / 8) * Math.PI * 2;
  gem.position.set(Math.cos(a) * 6, 0.8, Math.sin(a) * 6);
  scene.add(gem);
  pickups.push(gem);
}

const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const v = 5 * dt;
  if (keys.has('w') || keys.has('arrowup')) player.position.z -= v;
  if (keys.has('s') || keys.has('arrowdown')) player.position.z += v;
  if (keys.has('a') || keys.has('arrowleft')) player.position.x -= v;
  if (keys.has('d') || keys.has('arrowright')) player.position.x += v;

  for (const gem of pickups) {
    if (!gem.visible) continue;
    gem.rotation.y += dt * 2;
    if (gem.position.distanceTo(player.position) < 1) gem.visible = false;
  }
  controls.update();
  renderer.render(scene, camera);
});
window.gameState = { collected: () => pickups.filter((g) => !g.visible).length };
