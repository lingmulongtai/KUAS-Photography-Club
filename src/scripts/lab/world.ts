import * as THREE from 'three';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BACKDROPS, canvasTexture, loadHdr, loadPanorama, type Backdrop, type BackdropId } from './assets';
import { buildSubject, type Subject, type SubjectId } from './subjects';
import { isLowPower, type Exposable } from './pipeline';
import { FlowerField } from './studio/flowers';
import { StarSky } from './studio/stars';

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

type PrepareHook = (camera: THREE.PerspectiveCamera, open: number, close: number, pxAngle: number) => void;

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
  /** The sun (or a street lamp) itself: the panorama's JPEG clips it, so it is drawn again at full strength. */
  private sunDisc: THREE.Mesh | null = null;
  private skyUniforms = { skyGain: { value: 1 }, lift: { value: 1 } };
  private sun = new THREE.DirectionalLight('#ffffff', 2);
  private pinwheel: THREE.Group | null = null;
  private leaves: THREE.InstancedMesh | null = null;
  private leafSeeds: Float32Array | null = null;
  private dummy = new THREE.Object3D();
  private subjectToken = 0;
  private backdropToken = 0;
  private sweep: THREE.Group | null = null;
  flowers: FlowerField | null = null;
  private snow: THREE.InstancedMesh | null = null;
  private snowSeeds: Float32Array | null = null;
  stars: StarSky | null = null;
  /** The brightest light in the panorama, for lens flare and the polariser. */
  flareSource: { dir: THREE.Vector3; power: number } | null = null;
  /** Called once per picture (the studio's lights and flash, the night sky). */
  readonly prepareHooks: PrepareHook[] = [];
  readonly subframeHooks: ((i: number, n: number) => void)[] = [];
  /** 0..1: how strongly a polarising filter darkens the blue sky. */
  private plUniforms = { plDir: { value: new THREE.Vector3(0, 1, 0) }, plAmt: { value: 0 } };

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
    if (opts.cyclorama) {
      this.sweep = cyclorama();
      this.scene.add(this.sweep);
    }
    if (opts.pinwheel) {
      this.pinwheel = pinwheel();
      this.scene.add(this.pinwheel);
    }
    if (opts.leaves) this.makeLeaves();
    this.ready = Promise.all([this.setBackdrop(opts.backdrop), this.setSubject(opts.subject)]).then(() => undefined);
  }

  /** Show or hide the panorama (top views draw a plain floor instead). */
  set skyVisible(v: boolean) {
    if (this.sky) this.sky.visible = v && !this.opts.cyclorama && (this.backdrop.kind ?? 'pano') === 'pano';
    if (this.sunDisc) this.sunDisc.visible = !!this.sky?.visible && this.sunDisc.userData.on;
  }

  get moving() {
    return (
      !!(this.pinwheel && this.pinwheel.visible) ||
      !!(this.leaves && this.leaves.visible) ||
      !!(this.snow && this.snow.visible) ||
      !!(this.flowers && this.flowers.group.visible) ||
      !!this.subject?.group.userData.step
    );
  }

  set pinwheelVisible(v: boolean) {
    if (this.pinwheel) this.pinwheel.visible = v;
  }

  /** How strongly a polariser darkens the sky (0..1). */
  set polarizer(v: number) {
    this.plUniforms.plAmt.value = v;
  }

  prepare(camera: THREE.PerspectiveCamera, open: number, close: number, pxAngle: number) {
    for (const h of this.prepareHooks) h(camera, open, close, pxAngle);
  }

  subframe(i: number, n: number) {
    for (const h of this.subframeHooks) h(i, n);
  }

  async setBackdrop(id: BackdropId) {
    const token = ++this.backdropToken;
    const b = BACKDROPS[id];
    const kind = b.kind ?? 'pano';
    const loaded = kind === 'stars' ? null : await Promise.all([loadPanorama(id), loadHdr(id)]);
    if (token !== this.backdropToken) return;
    this.backdrop = b;
    this.ev = b.ev;
    const yaw = 2 * Math.PI * b.center - Math.PI / 2;
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      this.sky = null;
    }
    this.flareSource = null;
    if (this.sunDisc) this.sunDisc.visible = this.sunDisc.userData.on = false;
    if (loaded) {
      const [pano, hdr] = loaded;
      let byRenderer = envCache.get(this.renderer);
      if (!byRenderer) envCache.set(this.renderer, (byRenderer = new Map()));
      let env = byRenderer.get(b.file);
      if (!env) {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        env = pmrem.fromEquirectangular(hdr).texture;
        pmrem.dispose();
        byRenderer.set(b.file, env);
      }
      this.scene.environment = env;
      this.scene.environmentIntensity = b.env;
      this.scene.environmentRotation.set(0, yaw + Math.PI / 2, 0);
      const sky = new GroundedSkybox(pano, b.height, 60, 96);
      const mat = sky.material as THREE.MeshBasicMaterial;
      mat.depthWrite = true;
      this.skyUniforms.skyGain.value = b.sky;
      this.skyUniforms.lift.value = b.highlights;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.skyUniforms, this.plUniforms);
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'varying vec3 vSkyDir;\nvoid main() {')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSkyDir = (modelMatrix * vec4(position, 1.)).xyz - cameraPosition;');
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', 'uniform float skyGain; uniform float lift; uniform vec3 plDir; uniform float plAmt; varying vec3 vSkyDir;\nvoid main() {')
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            float hl = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
            diffuseColor.rgb *= skyGain * (1. + lift * pow(smoothstep(.5, 1., hl), 3.));
            if (plAmt > 0.) {
              // a polariser darkens blue sky most at 90 degrees from the sun
              vec3 sd = normalize(vSkyDir);
              float c = dot(sd, plDir);
              float blue = smoothstep(.0, .25, diffuseColor.b - diffuseColor.r) * smoothstep(-.05, .15, sd.y);
              diffuseColor.rgb *= 1. - plAmt * .7 * (1. - c * c) * blue;
            }`,
          );
      };
      sky.position.y = b.height;
      sky.rotation.y = yaw;
      sky.userData.isSky = true;
      this.sky = sky;
      sky.visible = !this.opts.cyclorama && kind === 'pano';
      this.scene.add(sky);
      const peak = brightest(hdr);
      if (peak) {
        // the sky sphere maps u to a direction as SphereGeometry does (mirrored in z by
        // GroundedSkybox), then turns by `yaw`
        const dir = new THREE.Vector3(-Math.cos(2 * Math.PI * peak.u) * Math.cos(peak.lat), Math.sin(peak.lat), -Math.sin(2 * Math.PI * peak.u) * Math.cos(peak.lat));
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        if (peak.lat > -0.05) this.flareSource = { dir, power: peak.power };
        this.plUniforms.plDir.value.copy(dir);
        // a real sun or lamp is a small point far brighter than the sky around it
        if (peak.lat > -0.05 && peak.power > 2000 && sky.visible) {
          const disc = this.sunDisc ?? (this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), new THREE.MeshBasicMaterial({ depthWrite: false })));
          const centre = new THREE.Vector3(0, b.height, 0);
          disc.position.copy(centre).addScaledVector(dir, 55);
          disc.lookAt(centre);
          (disc.material as THREE.MeshBasicMaterial).color.setRGB(...peak.rgb).multiplyScalar(b.sky * Math.min(400, peak.power * 0.006));
          disc.userData.on = disc.visible = true;
          if (!disc.parent) this.scene.add(disc);
        }
      }
    } else {
      this.scene.environment = null;
    }
    this.scene.background = new THREE.Color(kind === 'room' ? '#0b0c0e' : '#20242a');
    // the paper sweep of the dark studio
    if (kind === 'room' && !this.sweep) {
      this.sweep = cyclorama(false);
      this.scene.add(this.sweep);
    }
    if (this.sweep) this.sweep.visible = kind === 'room' || !!this.opts.cyclorama;
    if (kind === 'stars' && !this.stars) {
      this.stars = new StarSky();
      this.scene.add(this.stars.group);
      this.prepareHooks.push((_c, open, close, px) => this.stars?.group.visible && this.stars.prepare(open, close, px));
    }
    if (this.stars) this.stars.group.visible = kind === 'stars';
    if (id === 'flowers' && !this.flowers) {
      this.flowers = new FlowerField(isLowPower());
      this.scene.add(this.flowers.group);
    }
    if (this.flowers) this.flowers.group.visible = id === 'flowers';
    if (b.snow && !this.snow) this.makeSnow();
    if (this.snow) this.snow.visible = !!b.snow;
    this.sun.color.set(b.sun.color);
    this.sun.intensity = b.sun.intensity;
    const sunDir = b.sun.auto && this.flareSource ? this.flareSource.dir.clone().setY(Math.max(0.12, this.flareSource.dir.y)).normalize() : new THREE.Vector3(...b.sun.dir).normalize();
    this.sun.position.copy(sunDir).multiplyScalar(7);
    this.sun.position.y += 0.6;
    this.sun.position.add(this.sun.target.position);
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
    this.flowers?.step(time);
    this.subject?.group.userData.step?.(time);
    if (this.snow?.visible) this.stepSnow(time);
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

  /** Snowflakes drifting down in front of the subject. */
  private makeSnow() {
    const tex = canvasTexture(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.5, 'rgba(255,255,255,.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    });
    const count = 600;
    const mat = new THREE.MeshBasicMaterial({ color: '#f4f7ff', alphaMap: tex, transparent: true, depthWrite: false });
    const snow = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.012, 0.012), mat, count);
    snow.frustumCulled = false;
    const seeds = new Float32Array(count * 4);
    let s = 5;
    for (let i = 0; i < seeds.length; i++) {
      s = (s * 16807) % 2147483647;
      seeds[i] = s / 2147483647;
    }
    this.snow = snow;
    this.snowSeeds = seeds;
    this.scene.add(snow);
  }

  private stepSnow(time: number) {
    const snow = this.snow!;
    const seeds = this.snowSeeds!;
    const d = this.dummy;
    const cam = this.snowCenter;
    for (let i = 0; i < snow.count; i++) {
      const k = i * 4;
      const fall = 0.5 + seeds[k] * 0.4;
      const y = 3.2 - ((time * fall + seeds[k + 1] * 3.2) % 3.2);
      const drift = Math.sin(time * (0.8 + seeds[k + 2]) + seeds[k + 3] * 6.28) * 0.12;
      d.position.set(cam.x + (seeds[k + 2] - 0.5) * 6 + drift, y, cam.z + (seeds[k + 3] - 0.5) * 6);
      d.quaternion.copy(this.snowFacing);
      d.scale.setScalar(0.6 + seeds[k] * 0.9);
      d.updateMatrix();
      snow.setMatrixAt(i, d.matrix);
    }
    snow.instanceMatrix.needsUpdate = true;
  }

  /** Where the snow falls around, and how the flakes face (towards the camera). */
  snowCenter = new THREE.Vector3();
  snowFacing = new THREE.Quaternion();

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
function cyclorama(softboxes = true) {
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
  paper.userData.occludes = true;
  if (!softboxes) return g;
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

/** The brightest spot of an HDR panorama: where it is and how much brighter than the average. */
function brightest(tex: THREE.DataTexture) {
  const img = tex.image as { data: ArrayLike<number>; width: number; height: number };
  const { data, width: w, height: h } = img;
  if (!data || !w) return null;
  const half = data instanceof Uint16Array;
  const read = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const step = 4;
  let best = 0;
  let bi = 0;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * step;
      const l = 0.2126 * read(i) + 0.7152 * read(i + 1) + 0.0722 * read(i + 2);
      sum += l;
      n++;
      if (l > best) {
        best = l;
        bi = y * w + x;
      }
    }
  }
  const x = bi % w;
  const y = Math.floor(bi / w);
  const rgb = [read(bi * step), read(bi * step + 1), read(bi * step + 2)];
  const top = Math.max(...rgb, 1e-6);
  // HDRLoader keeps the file's top row first; v runs up the texture
  const v = 1 - (y + 0.5) / h;
  return {
    u: (x + 0.5) / w,
    lat: (v - 0.5) * Math.PI,
    power: best / Math.max(1e-6, sum / n),
    rgb: rgb.map((c) => c / top) as [number, number, number],
  };
}
