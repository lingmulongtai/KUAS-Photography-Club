import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { press, setText, type Demo } from '../gl/stage';

const FRAME_H = 0.5; // keep head and shoulders (0.5 m) filling the frame height
const SENSOR_H = 0.024; // full-frame sensor height in metres
const SENSOR_DIAG = 0.04327;

/** Field of view for a full-frame focal length (mm). */
export const verticalFov = (mm: number) => 2 * Math.atan(SENSOR_H / 2 / (mm / 1000));
export const diagonalFov = (mm: number) => 2 * Math.atan(SENSOR_DIAG / 2 / (mm / 1000));
/** Distance that keeps FRAME_H filling the frame at this focal length. */
export const distanceFor = (mm: number) => FRAME_H / 2 / Math.tan(verticalFov(mm) / 2);

const sm = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const g2 = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);

/**
 * A plaster-cast head, sculpted by displacing a sphere: jaw, brow, eye sockets,
 * cheekbones, nose, lips and chin. Size in metres (about 23 cm chin to crown).
 */
function headGeometry() {
  const geo = new THREE.SphereGeometry(1, 160, 120);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let { x, y, z } = v;
    const front = sm(0.18, 0.62, z);
    const ax = Math.abs(x);
    let d = 0;
    // nose: a ridge that grows toward the tip, wider at the nostrils
    const along = Math.min(1, Math.max(0, (0.24 - y) / 0.46));
    const wx = 0.06 + 0.07 * along;
    d += 0.24 * along * Math.exp(-((x / wx) ** 2)) * sm(-0.32, -0.18, y);
    d += 0.05 * g2(x, y, 0, -0.17, 0.08, 0.07);
    // brow ridge and eye sockets with the eyes inside
    d += 0.05 * Math.exp(-(((y - 0.3) / 0.07) ** 2)) * Math.exp(-((x / 0.55) ** 2));
    d -= 0.075 * g2(ax, y, 0.3, 0.15, 0.14, 0.09);
    d += 0.04 * g2(ax, y, 0.3, 0.14, 0.07, 0.05);
    // cheekbones
    d += 0.04 * g2(ax, y, 0.46, -0.03, 0.15, 0.12);
    // lips, mouth line and chin
    d += 0.05 * g2(x, y, 0, -0.42, 0.2, 0.07);
    d -= 0.025 * g2(x, y, 0, -0.445, 0.19, 0.014);
    d += 0.08 * g2(x, y, 0, -0.73, 0.18, 0.1);
    d *= front;
    // jaw narrows toward the chin; skull is deeper at the back
    const jaw = sm(0.05, -0.85, y);
    x *= 1 - 0.3 * jaw;
    if (z < 0) z *= 1.1;
    else z *= 1 - 0.1 * jaw;
    const k = 1 + d;
    p.setXYZ(i, x * k * 0.078, y * k * 0.115, z * k * 0.098);
  }
  geo.computeVertexNormals();
  return geo;
}

function bustGeometry() {
  const ear = (side: number) => {
    const g = new THREE.SphereGeometry(1, 24, 16);
    g.scale(0.011, 0.03, 0.021);
    g.rotateY(side * 0.35);
    g.translate(side * 0.077, 0.004, -0.008);
    return g;
  };
  const neck = new THREE.CylinderGeometry(0.048, 0.056, 0.14, 40).translate(0, -0.135, -0.012);
  const chest = new THREE.SphereGeometry(1, 64, 32);
  chest.scale(0.2, 0.095, 0.105);
  chest.translate(0, -0.25, -0.01);
  const plinth = new THREE.BoxGeometry(0.2, 0.1, 0.15).translate(0, -0.38, -0.01);
  const parts = [headGeometry(), ear(1), ear(-1), neck, chest, plinth].map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    return n;
  });
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
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
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1714');
  const cam = new THREE.PerspectiveCamera(40, 1, 0.02, 80);

  const plaster = new THREE.MeshStandardMaterial({ color: '#ece6db', roughness: 0.82, metalness: 0 });
  const bust = new THREE.Mesh(bustGeometry(), plaster);
  bust.position.y = 1.5;
  scene.add(bust);

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ map: shojiTexture(), roughness: 0.95 }));
  wall.position.set(0, 2.2, -3.2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.86, 0);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.62, 32), new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.6 }));
  stand.position.set(0, 0.86 + 0.31, -0.01);
  scene.add(wall, floor, stand);

  const key = new THREE.DirectionalLight('#fff4e6', 2.8);
  key.position.set(-1.6, 3.2, 2.4);
  key.target = bust;
  const rim = new THREE.DirectionalLight('#cfe0ff', 1.4);
  rim.position.set(1.8, 2.6, -2);
  rim.target = bust;
  const fill = new THREE.HemisphereLight('#d9dde6', '#3a3028', 0.7);
  scene.add(key, rim, fill);

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

  const focus = new THREE.Vector3(0, bust.position.y - 0.06, 0);
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
