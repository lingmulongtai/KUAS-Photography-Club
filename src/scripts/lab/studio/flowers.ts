import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../assets';
import type { Subject } from '../subjects';

/**
 * A field of cosmos swaying in the wind, and one flower worth a macro lens in the middle.
 * Everything sways in the vertex shader, so a slow shutter blurs the petals.
 */

const COLORS = ['#f4a3c6', '#e05596', '#f8eef3', '#f6bfd6', '#c93a7d', '#fbe3ec'];

let petalTex: THREE.Texture | null = null;
/** A white petal with darker veins and a deeper base; tinted by the material or instance colour. */
function petalTexture() {
  petalTex ??= canvasTexture(128, 256, (g) => {
    const grad = g.createLinearGradient(0, 256, 0, 0);
    grad.addColorStop(0, '#b9a0ac');
    grad.addColorStop(0.25, '#f2eaee');
    grad.addColorStop(1, '#ffffff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 26; i++) {
      const x = 64 + (i - 13) * 4.4;
      g.strokeStyle = `rgba(150,110,130,${0.12 + Math.random() * 0.12})`;
      g.lineWidth = 0.8 + Math.random();
      g.beginPath();
      g.moveTo(64 + (x - 64) * 0.15, 256);
      g.quadraticCurveTo(64 + (x - 64) * 0.7, 140, x, 6 + Math.random() * 20);
      g.stroke();
    }
  });
  return petalTex;
}

/** One cosmos petal along +x in the xy plane: narrow at the base, three shallow teeth at the tip. */
function petalGeometry(len: number, width: number, cup: number, detail: number) {
  const s = new THREE.Shape();
  const w = width / 2;
  s.moveTo(0, 0);
  s.bezierCurveTo(len * 0.3, w * 0.5, len * 0.6, w * 1.1, len * 0.95, w);
  s.lineTo(len, w * 0.45);
  s.lineTo(len * 0.95, w * 0.22);
  s.lineTo(len * 1.01, 0);
  s.lineTo(len * 0.95, -w * 0.22);
  s.lineTo(len, -w * 0.45);
  s.lineTo(len * 0.95, -w);
  s.bezierCurveTo(len * 0.6, -w * 1.1, len * 0.3, -w * 0.5, 0, 0);
  const geo = new THREE.ShapeGeometry(s, detail);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // cup the petal upwards and give it a soft lengthwise fold
    pos.setZ(i, cup * (x / len) ** 2 * len + Math.abs(y) * 0.12);
    uv.setXY(i, y / width + 0.5, x / len);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Petals around the z axis, facing +z. */
function corolla(count: number, len: number, width: number, cup: number, detail: number, jitter = 0) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const p = petalGeometry(len * (1 + (Math.sin(i * 7.3) * jitter)), width, cup, detail);
    p.translate(len * 0.08, 0, 0);
    p.rotateZ((i / count) * Math.PI * 2 + Math.sin(i * 3.1) * jitter);
    parts.push(p);
  }
  return mergeGeometries(parts);
}

/** Add wind to a material: `weight` is a GLSL expression of the local `position` (0 at the root, 1 at the top). */
function sway(mat: THREE.Material, uniforms: { uTime: THREE.IUniform; uSway: THREE.IUniform }, weight: string) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uTime; uniform float uSway;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
        vec2 seed = vec2(0.);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          seed = instanceMatrix[3].xz;
        #endif
        float gust = .6 + .4 * sin(uTime * .37 + seed.x * .05);
        vec2 wind = vec2(sin(uTime * 1.3 + seed.x * .7 + seed.y * .3) + .4 * sin(uTime * 2.9 + seed.y * 1.1),
                         .5 * sin(uTime * 1.1 + seed.y * .5 + 1.)) * uSway * gust;
        mvPosition.xz += wind * (${weight});
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  return mat;
}

const rand = (() => {
  let s = 11;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
})();

export class FlowerField {
  readonly group = new THREE.Group();
  /** Where some of the flowers stand (x, z pairs), for the floor plan. */
  readonly dots: Float32Array;
  private uniforms = { uTime: { value: 0 }, uSway: { value: 0.012 } };

  constructor(low: boolean) {
    const count = low ? 1300 : 2800;
    const heads = new THREE.InstancedMesh(
      corolla(8, 0.034, 0.017, 0.35, 2).rotateX(-Math.PI / 2),
      sway(new THREE.MeshStandardMaterial({ map: petalTexture(), roughness: 0.55, side: THREE.DoubleSide }), this.uniforms, '1.'),
      count,
    );
    const discs = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.0085, 0.007, 0.006, 12).translate(0, 0.003, 0),
      sway(new THREE.MeshStandardMaterial({ color: '#e8b021', roughness: 0.8 }), this.uniforms, '1.'),
      count,
    );
    const stems = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.0018, 0.0026, 1, 5, 4).translate(0, 0.5, 0),
      sway(new THREE.MeshStandardMaterial({ color: '#5d8a3a', roughness: 0.7 }), this.uniforms, 'position.y * position.y'),
      count,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const color = new THREE.Color();
    let n = 0;
    this.dots = new Float32Array(Math.min(count, 700) * 2);
    while (n < count) {
      // denser towards the middle, with a clearing round the hero flower
      const r = 0.5 + 14 * Math.sqrt(rand()) * (0.35 + 0.65 * rand());
      const a = rand() * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (Math.hypot(x, z) < 0.45) continue;
      const h = 0.45 + rand() * 0.45;
      const s = 0.8 + rand() * 0.45;
      e.set((rand() - 0.5) * 1.1, rand() * Math.PI * 2, (rand() - 0.5) * 1.1);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(s, s, s));
      heads.setMatrixAt(n, m);
      discs.setMatrixAt(n, m);
      heads.setColorAt(n, color.set(COLORS[Math.floor(rand() * COLORS.length)]));
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      stems.setMatrixAt(n, m);
      if (n < this.dots.length / 2) this.dots.set([x, z], n * 2);
      n++;
    }
    for (const mesh of [heads, discs, stems]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.group.add(this.grass(low ? 3000 : 7000), meadow());
  }

  /** Thin blades of grass between the flowers. */
  private grass(count: number) {
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.0025, 0, 0, 0.0025, 0, 0, 0, 1, 0], 3));
    blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    const mesh = new THREE.InstancedMesh(
      blade,
      sway(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide }), this.uniforms, 'position.y * position.y * 1.4'),
      count,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = 0.15 + 9 * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      e.set((rand() - 0.5) * 0.7, rand() * Math.PI, (rand() - 0.5) * 0.7);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r), q, new THREE.Vector3(0.8 + rand() * 0.8, 0.08 + rand() * 0.22, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHSL(0.22 + rand() * 0.07, 0.4 + rand() * 0.2, 0.14 + rand() * 0.12));
    }
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  step(time: number) {
    this.uniforms.uTime.value = time;
  }
}

/** A disc of green meadow that fades into the panorama's ground. */
function meadow() {
  const map = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#4c6b2c';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
      const l = 22 + Math.random() * 22;
      g.fillStyle = `hsla(${80 + Math.random() * 30},45%,${l}%,.5)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 2 + Math.random() * 4);
    }
  });
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(30, 30);
  const alpha = canvasTexture(
    256,
    256,
    (g) => {
      const grad = g.createRadialGradient(128, 128, 60, 128, 128, 128);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(1, '#000');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    },
    false,
  );
  const mat = new THREE.MeshStandardMaterial({ map, alphaMap: alpha, transparent: true, roughness: 1, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(17, 64).rotateX(-Math.PI / 2), mat);
  disc.position.y = 0.004;
  disc.receiveShadow = true;
  disc.renderOrder = -1;
  return disc;
}

/** The flower to photograph: a pink cosmos with real-looking florets for a macro lens. */
export function heroFlower(): Subject {
  const g = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uSway: { value: 0.0018 } };
  const stemH = 0.62;
  const stem = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.01, stemH * 0.5, -0.01), new THREE.Vector3(0, stemH, 0.012)]), 24, 0.0024, 8),
    sway(new THREE.MeshStandardMaterial({ color: '#56853a', roughness: 0.6 }), uniforms, `pow(position.y / ${stemH.toFixed(2)}, 2.)`),
  );
  g.add(stem);
  // feathery cosmos leaves
  const leafMat = sway(new THREE.MeshStandardMaterial({ color: '#4f7f34', roughness: 0.65, side: THREE.DoubleSide }), uniforms, `pow(position.y / ${stemH.toFixed(2)}, 2.)`);
  for (let i = 0; i < 5; i++) {
    const y = 0.16 + i * 0.08;
    for (let k = 0; k < 5; k++) {
      const len = 0.05 - k * 0.006;
      const leaf = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0012, len, 4).translate(0, len / 2, 0), leafMat);
      leaf.position.set(0.004, y, 0);
      leaf.rotation.set(0.2 + k * 0.25, i * 2.4, 0.9 + k * 0.15);
      g.add(leaf);
    }
  }
  const head = new THREE.Group();
  const petals = new THREE.Mesh(
    corolla(8, 0.036, 0.018, 0.32, 8, 0.04),
    sway(new THREE.MeshPhysicalMaterial({ color: '#f2a1c4', map: petalTexture(), roughness: 0.5, sheen: 0.6, sheenColor: new THREE.Color('#ffd8ea'), side: THREE.DoubleSide }), uniforms, '1.'),
  );
  head.add(petals);
  // disc florets in a sunflower spiral, opening from the rim inwards
  const florets = 260;
  const floretGeo = new THREE.CylinderGeometry(0.00055, 0.00045, 0.0028, 6).rotateX(Math.PI / 2).translate(0, 0, 0.0014);
  const tipGeo = new THREE.SphereGeometry(0.00062, 6, 4);
  const fm = new THREE.InstancedMesh(floretGeo, sway(new THREE.MeshStandardMaterial({ color: '#e9a514', roughness: 0.7 }), uniforms, '1.'), florets);
  const tm = new THREE.InstancedMesh(tipGeo, sway(new THREE.MeshStandardMaterial({ color: '#f6d03a', roughness: 0.6 }), uniforms, '1.'), florets);
  const m = new THREE.Matrix4();
  const R = 0.0082;
  for (let i = 0; i < florets; i++) {
    const r = R * Math.sqrt((i + 0.5) / florets);
    const a = i * 2.39996;
    const dome = 0.0022 * (1 - (r / R) ** 2);
    const open = r / R > 0.55 ? 1.25 : 0.85;
    m.compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, dome), new THREE.Quaternion(), new THREE.Vector3(1, 1, open));
    fm.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, dome + 0.0028 * open), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    tm.setMatrixAt(i, m);
  }
  head.add(fm, tm);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R, 0.004, 0.004, 24).rotateX(Math.PI / 2), sway(new THREE.MeshStandardMaterial({ color: '#6d8e2e' }), uniforms, '1.'));
  base.position.z = -0.0015;
  head.add(base);
  head.position.set(0, stemH, 0.012);
  // face the camera's side, tipped up a little
  head.rotation.set(-0.5, 0.15, 0);
  g.add(head);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.updateMatrixWorld(true);
  const focus = new THREE.Vector3(0, 0, 0.003).applyMatrix4(head.matrixWorld);
  g.userData.step = (t: number) => (uniforms.uTime.value = t);
  return { id: 'flower', group: g, focus, frame: 0.12, pitch: 0.25 };
}
