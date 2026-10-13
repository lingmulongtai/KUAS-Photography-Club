import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { press, setText, type Demo } from '../gl/stage';

const FRAME_H = 0.36; // keep the head and the top of the shoulders (36 cm) filling the frame height
const SENSOR_H = 0.024; // full-frame sensor height in metres
const SENSOR_DIAG = 0.04327;

/** Field of view for a full-frame focal length (mm). */
export const verticalFov = (mm: number) => 2 * Math.atan(SENSOR_H / 2 / (mm / 1000));
export const diagonalFov = (mm: number) => 2 * Math.atan(SENSOR_DIAG / 2 / (mm / 1000));
/** Distance that keeps FRAME_H filling the frame at this focal length. */
export const distanceFor = (mm: number) => FRAME_H / 2 / Math.tan(verticalFov(mm) / 2);

/** The head scan: a bust facing +z, about 8.6 × 7.9 × 5.2 units. 0.05 m per unit makes the shoulders 43 cm wide. */
const HEAD_URL = '/models/head/head.glb';
const HEAD_NORMAL_URL = '/models/head/normal.jpg';
const HEAD_SCALE = 0.05;
const HEAD_HALF_H = 3.97 * HEAD_SCALE;

/** Load the scanned bust and dress it as a white plaster cast. */
async function loadBust(maxAniso: number) {
  const [{ GLTFLoader }, normal] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    new THREE.TextureLoader().loadAsync(HEAD_NORMAL_URL),
  ]);
  const gltf = await new GLTFLoader().loadAsync(HEAD_URL);
  normal.flipY = false;
  normal.anisotropy = maxAniso;
  const plaster = new THREE.MeshPhysicalMaterial({
    color: '#efe9df',
    roughness: 0.62,
    metalness: 0,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.4, 0.4),
    sheen: 0.35,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color('#fff2e2'),
  });
  const bust = new THREE.Group();
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = new THREE.Mesh(o.geometry, plaster);
    m.castShadow = true;
    m.receiveShadow = true;
    bust.add(m);
  });
  bust.scale.setScalar(HEAD_SCALE);
  return bust;
}

/** Shoji screens behind the bust, to show how the background grows with focal length. */
function shojiTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#efe6d2';
  g.fillRect(0, 0, c.width, c.height);
  const panelW = c.width / 8;
  for (let p = 0; p < 8; p++) {
    const x0 = p * panelW;
    g.fillStyle = '#3b2a1c';
    g.fillRect(x0, 0, 14, c.height);
    g.fillRect(x0 + panelW - 14, 0, 14, c.height);
    g.fillStyle = '#5a4130';
    for (let i = 1; i < 3; i++) g.fillRect(x0 + (panelW / 3) * i - 3, 0, 6, c.height);
    for (let j = 1; j < 6; j++) g.fillRect(x0, (c.height / 6) * j - 3, panelW, 6);
  }
  g.fillStyle = '#2c1f15';
  g.fillRect(0, c.height - 70, c.width, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    const shade = 70 + ((i * 37) % 30);
    g.fillStyle = `rgb(${shade + 20},${shade},${shade - 22})`;
    g.fillRect(i * 128, 0, 128, 1024);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(i * 128, 0, 3, 1024);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = 8;
  return tex;
}

export interface FocalState {
  mm: number;
  distance: number;
  diagonal: number;
}

/**
 * The same bust photographed at different focal lengths from the distance that keeps it
 * the same size in the frame. Close up with a wide lens the nose grows and the ears
 * disappear; far away with a telephoto the face flattens and the background looms.
 */
export function createFocal(renderer: THREE.WebGLRenderer, el: HTMLElement, onChange?: (s: FocalState) => void): Demo {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1714');
  const cam = new THREE.PerspectiveCamera(40, 1, 0.02, 80);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.16;
  pmrem.dispose();

  // the bust's base sits on a small socle on a pedestal
  const BUST_Y = 1.45;
  const baseY = BUST_Y - HEAD_HALF_H;
  const stone = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.55 });
  const socle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.17), new THREE.MeshStandardMaterial({ color: '#d9d2c6', roughness: 0.7 }));
  socle.position.set(0, baseY - 0.025, 0.005);
  const standH = baseY - 0.05;
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.3, standH, 0.3), stone);
  stand.position.set(0, standH / 2, 0);
  socle.castShadow = socle.receiveShadow = true;
  stand.receiveShadow = true;

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ map: shojiTexture(), roughness: 0.95 }));
  wall.position.set(0, 2.2, -3.2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(wall, floor, stand, socle);

  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  loadBust(aniso)
    .then((bust) => {
      bust.position.y = BUST_Y;
      scene.add(bust);
    })
    .catch((err) => console.warn('Could not load the head scan', err));

  // Rembrandt-style key from the front left, a cool rim from behind, soft fill
  const focus = new THREE.Vector3(0, BUST_Y + HEAD_HALF_H + 0.035 - FRAME_H / 2, 0.04);
  const key = new THREE.DirectionalLight('#fff1e0', 3.4);
  key.position.set(-2.3, 2.7, 1.3);
  key.target.position.copy(focus);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 3;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.002;
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -0.32;
  sc.right = sc.top = 0.32;
  sc.near = 1.5;
  sc.far = 4.5;
  const rim = new THREE.DirectionalLight('#cfe0ff', 1.6);
  rim.position.set(1.8, 2.4, -2);
  rim.target.position.copy(focus);
  const fill = new THREE.HemisphereLight('#d9dde6', '#3a3028', 0.2);
  scene.add(key, key.target, rim, rim.target, fill);

  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-mm]'));
  const slider = document.getElementById(el.dataset.slider ?? '') as HTMLInputElement | null;
  const readout = el.querySelector('[data-readout]');
  const MIN = 14;
  const MAX = 300;
  const toSlider = (mm: number) => Math.round((1000 * Math.log(mm / MIN)) / Math.log(MAX / MIN));
  const fromSlider = (v: number) => MIN * Math.pow(MAX / MIN, v / 1000);
  let mm = 50;
  let target = 50;
  let ptrX = 0;
  let ptrY = 0;
  let last = '';
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      target = Number(b.dataset.mm);
      press(buttons, b);
    }),
  );
  slider?.addEventListener('input', () => {
    target = fromSlider(Number(slider.value));
    buttons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
  });
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    ptrX = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptrY = 1 - ((e.clientY - r.top) / r.height) * 2;
  });
  el.addEventListener('pointerleave', () => (ptrX = ptrY = 0));

  let yaw = 0;
  let pitch = 0;

  return {
    t0: 0,
    resize(w, h) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    },
    render(t, dt) {
      const k = dt ? Math.min(1, dt * 3) : 1;
      mm = Math.exp(Math.log(mm) + (Math.log(target) - Math.log(mm)) * k);
      yaw += (ptrX * 0.45 + Math.sin(t * 0.25) * 0.12 - yaw) * k;
      pitch += (ptrY * 0.12 - pitch) * k;
      const d = distanceFor(mm);
      cam.fov = (verticalFov(mm) * 180) / Math.PI;
      cam.updateProjectionMatrix();
      cam.position.set(focus.x + Math.sin(yaw) * d, focus.y + Math.sin(pitch) * d, focus.z + Math.cos(yaw) * d);
      cam.lookAt(focus);
      renderer.render(scene, cam);
      if (slider && document.activeElement !== slider) slider.value = String(toSlider(mm));
      const diag = (diagonalFov(mm) * 180) / Math.PI;
      const label = `${Math.round(mm)}mm · 画角 ${diag.toFixed(diag < 20 ? 1 : 0)}° · 距離 ${d < 1 ? d.toFixed(2) : d.toFixed(1)}m`;
      if (label !== last) {
        last = label;
        setText(readout, label);
        onChange?.({ mm, distance: d, diagonal: diag });
      }
    },
  };
}
