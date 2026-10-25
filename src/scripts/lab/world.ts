import * as THREE from 'three';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BACKDROPS, canvasTexture, loadHdr, loadPanorama, type Backdrop, type BackdropId } from './assets';
import { buildSubject, type Subject, type SubjectId } from './subjects';
import type { Exposable } from './pipeline';

export interface WorldOptions {
  backdrop: BackdropId;
  subject: SubjectId;
  /** A tunnel of vermilion torii behind the subject (Fushimi Inari). */
  torii?: boolean;
  /** A spinning paper pinwheel beside the subject, for shutter speed. */
  pinwheel?: boolean;
  /** Falling leaves, for shutter speed. */
  leaves?: boolean;
  /** A modelled white studio sweep instead of the panorama (looks right from any viewpoint). */
  cyclorama?: boolean;
}

const envCache = new WeakMap<THREE.WebGLRenderer, Map<string, THREE.Texture>>();

/** The photo set: a real panorama projected onto the ground, a subject on a plinth, and props. */
export class World implements Exposable {
  readonly scene = new THREE.Scene();
  ev = 13;
  gain = 1;
  backdrop: Backdrop;
  subject: Subject | null = null;
  ready: Promise<void>;
  /** Called after the backdrop or the subject changes. */
  onChange: (() => void) | null = null;
  private renderer: THREE.WebGLRenderer;
  private sky: GroundedSkybox | null = null;
  private skyUniforms = { skyGain: { value: 1 }, lift: { value: 1 } };
  private sun = new THREE.DirectionalLight('#ffffff', 2);
  private pinwheel: THREE.Group | null = null;
  private leaves: THREE.InstancedMesh | null = null;
  private leafSeeds: Float32Array | null = null;
  private dummy = new THREE.Object3D();
  private subjectToken = 0;
  private backdropToken = 0;

  constructor(renderer: THREE.WebGLRenderer, private opts: WorldOptions) {
    this.renderer = renderer;
    this.backdrop = BACKDROPS[opts.backdrop];
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#20242a');

    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.01;
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -2.2;
    sc.right = sc.top = 2.2;
    sc.near = 0.5;
    sc.far = 14;
    this.scene.add(sun, sun.target);

    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.42 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.002;
    catcher.receiveShadow = true;
    this.scene.add(catcher);

    if (opts.torii) this.scene.add(toriiTunnel());
    if (opts.cyclorama) this.scene.add(cyclorama());
    if (opts.pinwheel) {
      this.pinwheel = pinwheel();
      this.scene.add(this.pinwheel);
    }
    if (opts.leaves) this.makeLeaves();
    this.ready = Promise.all([this.setBackdrop(opts.backdrop), this.setSubject(opts.subject)]).then(() => undefined);
  }

  /** Show or hide the panorama (top views draw a plain floor instead). */
  set skyVisible(v: boolean) {
    if (this.sky) this.sky.visible = v && !this.opts.cyclorama;
  }

  get moving() {
    return !!this.pinwheel || !!(this.leaves && this.leaves.visible);
  }

  async setBackdrop(id: BackdropId) {
    const token = ++this.backdropToken;
    const b = BACKDROPS[id];
    const [pano, hdr] = await Promise.all([loadPanorama(id), loadHdr(id)]);
    if (token !== this.backdropToken) return;
    this.backdrop = b;
    this.ev = b.ev;
    let byRenderer = envCache.get(this.renderer);
    if (!byRenderer) envCache.set(this.renderer, (byRenderer = new Map()));
    let env = byRenderer.get(b.file);
    if (!env) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      env = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
      byRenderer.set(b.file, env);
    }
    const yaw = 2 * Math.PI * b.center - Math.PI / 2;
    this.scene.environment = env;
    this.scene.environmentIntensity = b.env;
    this.scene.environmentRotation.set(0, yaw + Math.PI / 2, 0);
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
    }
    const sky = new GroundedSkybox(pano, b.height, 60, 96);
    const mat = sky.material as THREE.MeshBasicMaterial;
    mat.depthWrite = true;
    this.skyUniforms.skyGain.value = b.sky;
    this.skyUniforms.lift.value = b.highlights;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.skyUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float skyGain; uniform float lift;\nvoid main() {')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float hl = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
          diffuseColor.rgb *= skyGain * (1. + lift * pow(smoothstep(.5, 1., hl), 3.));`,
        );
    };
    sky.position.y = b.height;
    sky.rotation.y = yaw;
    this.sky = sky;
    sky.visible = !this.opts.cyclorama;
    this.scene.add(sky);
    this.sun.color.set(b.sun.color);
    this.sun.intensity = b.sun.intensity;
    this.sun.position.set(...b.sun.dir).normalize().multiplyScalar(7);
    this.sun.position.y += 0.6;
    if (this.leaves) {
      this.leaves.visible = !!b.leaves;
      if (b.leaves) (this.leaves.material as THREE.MeshStandardMaterial).color.set(b.leaves);
    }
    this.onChange?.();
  }

  async setSubject(id: SubjectId) {
    const token = ++this.subjectToken;
    const s = await buildSubject(id);
    if (token !== this.subjectToken) return;
    if (this.subject) this.scene.remove(this.subject.group);
    this.subject = s;
    this.scene.add(s.group);
    this.sun.target.position.copy(s.focus).setY(s.focus.y * 0.6);
    if (this.pinwheel) {
      this.pinwheel.position.copy(s.focus).add(new THREE.Vector3(0.3, -0.22, -0.16));
      if (id === 'camera') this.pinwheel.position.copy(s.focus).add(new THREE.Vector3(0.16, 0.02, -0.05));
      if (id === 'stilllife' || id === 'chess') this.pinwheel.position.set(0.3, 0.98, -0.12);
      if (id === 'mannequin') this.pinwheel.position.set(0.42, 1.2, 0.2);
      this.pinwheel.scale.setScalar(id === 'camera' ? 0.5 : id === 'bust' || id === 'horse' ? 0.7 : 1);
      this.pinwheel.userData.stick.scale.y = this.pinwheel.position.y / this.pinwheel.scale.y;
    }
    this.onChange?.();
  }

  step(time: number) {
    if (this.pinwheel) this.pinwheel.userData.wheel.rotation.z = -time * Math.PI * 2 * 4;
    const leaves = this.leaves;
    const seeds = this.leafSeeds;
    if (leaves && seeds && leaves.visible) {
      const d = this.dummy;
      for (let i = 0; i < leaves.count; i++) {
        const k = i * 6;
        const fall = 0.45 + seeds[k] * 0.35;
        const y = 2.8 - ((time * fall + seeds[k + 1] * 2.8) % 2.8);
        const sway = Math.sin(time * (1.2 + seeds[k + 2]) + seeds[k + 3] * 6.28);
        d.position.set(seeds[k + 4] * 2.6 - 1.3 + sway * 0.18, y, seeds[k + 5] * 2.4 - 2.3 + Math.cos(time + i) * 0.08);
        d.rotation.set(time * (1 + seeds[k]) * 2 + i, time * 1.3 + seeds[k + 3] * 6, sway * 0.8);
        d.updateMatrix();
        leaves.setMatrixAt(i, d.matrix);
      }
      leaves.instanceMatrix.needsUpdate = true;
    }
  }

  private makeLeaves() {
    const tex = canvasTexture(128, 128, (g) => {
      g.translate(64, 64);
      g.fillStyle = '#fff';
      g.beginPath();
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? 26 : 60;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.95);
      }
      g.fill();
      g.fillRect(-3, 20, 6, 44);
    });
    const mat = new THREE.MeshStandardMaterial({ color: '#c8432a', alphaMap: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
    const count = 110;
    const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.05, 0.05), mat, count);
    leaves.castShadow = true;
    leaves.frustumCulled = false;
    const seeds = new Float32Array(count * 6);
    let s = 7;
    for (let i = 0; i < seeds.length; i++) {
      s = (s * 16807) % 2147483647;
      seeds[i] = s / 2147483647;
    }
    for (let i = 0; i < count; i++) {
      const c = new THREE.Color().setHSL(0.02 + seeds[i * 6 + 2] * 0.07, 0.75, 0.38 + seeds[i * 6 + 3] * 0.15);
      leaves.setColorAt(i, c);
    }
    this.leaves = leaves;
    this.leafSeeds = seeds;
    this.scene.add(leaves);
    this.step(0);
  }
}

/** A white studio sweep: floor curving up into a back wall, with two softboxes. */
function cyclorama() {
  const g = new THREE.Group();
  const shape: THREE.Vector2[] = [];
  const R = 1.2;
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    shape.push(new THREE.Vector2(-3 - Math.sin(a) * R, R - Math.cos(a) * R));
  }
  const pts = [new THREE.Vector2(4, 0), ...shape, new THREE.Vector2(-3 - R, 4)];
  const sweep = new THREE.BufferGeometry();
  const W = 9;
  const pos: number[] = [];
  const idx: number[] = [];
  pts.forEach((p) => pos.push(-W / 2, p.y, p.x, W / 2, p.y, p.x));
  for (let i = 0; i < pts.length - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  sweep.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sweep.setIndex(idx);
  sweep.computeVertexNormals();
  const paper = new THREE.Mesh(sweep, new THREE.MeshStandardMaterial({ color: '#e9e7e3', roughness: 0.95, side: THREE.DoubleSide }));
  paper.receiveShadow = true;
  g.add(paper);
  const frame = new THREE.MeshStandardMaterial({ color: '#202326', roughness: 0.5, metalness: 0.4 });
  const glow = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  for (const s of [-1, 1]) {
    const box = new THREE.Group();
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.12, 0.35, 8, 1, true), frame);
    back.rotation.x = Math.PI / 2;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 8), glow);
    face.position.z = 0.18;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.8, 8), frame);
    pole.position.y = -0.9;
    box.add(back, face, pole);
    box.position.set(s * 1.5, 1.8, 0.9);
    box.lookAt(0, 1.3, 0);
    g.add(box);
  }
  return g;
}

/** Paper pinwheel on a bamboo stick; `userData.wheel` spins. */
function pinwheel() {
  const g = new THREE.Group();
  const wheel = new THREE.Group();
  const colors = ['#e2382b', '#f2c230', '#2a7fd0', '#2fa36b'];
  colors.forEach((c, i) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.075, 0);
    shape.lineTo(0.075, 0.075);
    shape.lineTo(0, 0);
    const geo = new THREE.ShapeGeometry(shape);
    const pos = geo.getAttribute('position');
    for (let j = 0; j < pos.count; j++) pos.setZ(j, pos.getX(j) * pos.getY(j) * 3.2);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, side: THREE.DoubleSide }));
    m.rotation.z = (i * Math.PI) / 2;
    m.castShadow = true;
    wheel.add(m);
  });
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), new THREE.MeshStandardMaterial({ color: '#f4efe6' }));
  wheel.add(pin);
  wheel.position.z = 0.012;
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 8), new THREE.MeshStandardMaterial({ color: '#b99a5c', roughness: 0.6 }));
  stick.geometry.translate(0, -0.5, 0);
  stick.castShadow = true;
  g.add(wheel, stick);
  g.userData.wheel = wheel;
  g.userData.stick = stick;
  return g;
}

/** A tunnel of vermilion gates, 0.9 m apart, starting 2.2 m behind the subject. */
function toriiTunnel(count = 34, start = -2.2, spacing = 0.9) {
  const red: THREE.BufferGeometry[] = [];
  const black: THREE.BufferGeometry[] = [];
  const W = 1.7;
  const H = 2.45;
  for (const s of [-1, 1]) {
    red.push(new THREE.CylinderGeometry(0.085, 0.095, H - 0.25, 20).translate((s * W) / 2, (H - 0.25) / 2 + 0.25, 0));
    black.push(new THREE.CylinderGeometry(0.11, 0.115, 0.25, 20).translate((s * W) / 2, 0.125, 0));
  }
  red.push(new THREE.BoxGeometry(W + 0.5, 0.11, 0.1).translate(0, H - 0.47, 0));
  red.push(new THREE.BoxGeometry(W + 0.55, 0.12, 0.13).translate(0, H - 0.16, 0));
  // kasagi: the black top beam, curving up at the ends
  const kasagi = new THREE.BoxGeometry(W + 0.95, 0.11, 0.18, 24, 1, 1);
  const kp = kasagi.getAttribute('position');
  for (let i = 0; i < kp.count; i++) {
    const x = kp.getX(i) / ((W + 0.95) / 2);
    kp.setY(i, kp.getY(i) + x * x * x * x * 0.1);
  }
  kasagi.computeVertexNormals();
  black.push(kasagi.translate(0, H - 0.04, 0));
  red.push(new THREE.BoxGeometry(0.08, 0.3, 0.06).translate(0, H - 0.32, 0));
  const g = new THREE.Group();
  const vermilion = new THREE.MeshStandardMaterial({ color: '#e0401c', roughness: 0.55 });
  const lacquer = new THREE.MeshStandardMaterial({ color: '#1b1612', roughness: 0.45 });
  for (const [geos, mat] of [[red, vermilion], [black, lacquer]] as const) {
    const mesh = new THREE.InstancedMesh(mergeGeometries(geos), mat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, m.makeTranslation(0, 0, start - i * spacing));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}
