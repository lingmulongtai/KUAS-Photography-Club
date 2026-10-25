import * as THREE from 'three';
import { cameraEV, distanceFor, type Shot } from './optics';
import { Pipeline, type PipelineOptions, type Viewport } from './pipeline';
import type { World } from './world';

export interface RigSettings {
  mm: number;
  N: number;
  t: number;
  iso: number;
  /** Focus distance (m); null focuses on the subject. */
  focus: number | null;
  crop: number;
  /** 'dolly' keeps the subject the same size by moving; 'fixed' stays at `distance`. */
  mode: 'dolly' | 'fixed';
  distance: number;
  /** Height (m) that fills the frame in dolly mode; null uses the subject's. */
  frame: number | null;
  yaw: number;
  /** Added to the subject's own pitch. */
  pitch: number;
  shake: number;
  blades: number;
  peaking: boolean;
  zebra: boolean;
  bias: number;
  /** Ignore the exposure settings and always expose correctly (for lessons that are not about exposure). */
  autoExpose: boolean;
}

export const DEFAULT_SETTINGS: RigSettings = {
  mm: 50,
  N: 4,
  t: 1 / 250,
  iso: 100,
  focus: null,
  crop: 1,
  mode: 'dolly',
  distance: 3,
  frame: null,
  yaw: 0,
  pitch: 0,
  shake: 0,
  blades: 9,
  peaking: false,
  zebra: false,
  bias: 0,
  autoExpose: false,
};

const logLerp = (a: number, b: number, k: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * k);

/** A photographer: where the camera stands, what it is set to, and the picture it takes. */
export class Rig {
  readonly camera = new THREE.PerspectiveCamera(40, 1.5, 0.05, 220);
  readonly pipeline: Pipeline;
  /** What the controls ask for. */
  readonly target: RigSettings;
  /** Smoothed values actually used. */
  readonly now: RigSettings;
  /** Extra look-around from the pointer, in radians. */
  look = { x: 0, y: 0 };
  /** Point the camera aims at; defaults to the subject's focus point. */
  aim: THREE.Vector3 | null = null;
  private w = 2;
  private h = 2;
  private aimNow = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(renderer: THREE.WebGLRenderer, readonly world: World, init: Partial<RigSettings> = {}, options?: PipelineOptions) {
    this.pipeline = new Pipeline(renderer, options);
    this.target = { ...DEFAULT_SETTINGS, ...init };
    this.now = { ...this.target };
  }

  set(patch: Partial<RigSettings>) {
    Object.assign(this.target, patch);
  }

  /** Jump to the target values without easing. */
  snap() {
    Object.assign(this.now, this.target);
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.pipeline.setSize(w * dpr, h * dpr);
  }

  /** Distance from the camera to the subject's focus point with the current settings. */
  subjectDistance(s: RigSettings = this.now) {
    const subj = this.world.subject;
    if (s.mode === 'fixed') return s.distance;
    return distanceFor(s.mm, s.frame ?? subj?.frame ?? 0.5, s.crop);
  }

  get shot(): Shot {
    const n = this.now;
    return {
      mm: n.mm,
      N: n.N,
      t: n.t,
      iso: n.iso,
      focus: n.focus ?? this.autoFocus(),
      crop: n.crop,
      shake: n.shake,
      blades: n.blades,
      peaking: n.peaking,
      zebra: n.zebra,
      bias: n.autoExpose ? cameraEV(n.N, n.t, n.iso) - this.world.ev : n.bias,
    };
  }

  /** Distance along the view axis to the subject's focus point. */
  autoFocus() {
    const subj = this.world.subject;
    if (!subj) return this.subjectDistance();
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    return Math.max(0.1, subj.focus.clone().sub(this.camera.position).dot(fwd));
  }

  /** Ease towards the targets and place the camera. */
  update(dt: number) {
    const k = dt ? Math.min(1, dt * 4) : 1;
    const a = this.now;
    const b = this.target;
    a.mm = logLerp(a.mm, b.mm, k);
    a.N = logLerp(a.N, b.N, k);
    a.distance = logLerp(a.distance, b.distance, k);
    a.crop = logLerp(a.crop, b.crop, k);
    a.yaw += (b.yaw - a.yaw) * k;
    a.pitch += (b.pitch - a.pitch) * k;
    a.bias += (b.bias - a.bias) * k;
    if (b.focus === null) a.focus = null;
    else a.focus = a.focus === null ? b.focus : logLerp(a.focus, b.focus, k);
    a.frame = b.frame === null ? null : a.frame === null ? b.frame : a.frame + (b.frame - a.frame) * k;
    a.t = b.t;
    a.iso = b.iso;
    a.mode = b.mode;
    a.shake = b.shake;
    a.blades = b.blades;
    a.peaking = b.peaking;
    a.zebra = b.zebra;
    a.autoExpose = b.autoExpose;

    const subj = this.world.subject;
    const aim = this.aim ?? subj?.aim ?? subj?.focus ?? new THREE.Vector3(0, 1.4, 0);
    if (!dt) this.aimNow.copy(aim);
    else this.aimNow.lerp(aim, k);
    const d = this.subjectDistance();
    const yaw = a.yaw + this.look.x;
    const pitch = (subj?.pitch ?? 0) + a.pitch + this.look.y;
    this.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(this.aimNow).addScaledVector(this.dir, d);
    if (this.camera.position.y < 0.12) this.camera.position.y = 0.12;
    this.camera.lookAt(this.aimNow);
  }

  render(time: number, dt: number, viewport?: Viewport, to: THREE.WebGLRenderTarget | null = null, clip?: Viewport) {
    this.update(dt);
    this.pipeline.render(this.world, this.camera, this.shot, time, viewport, to, clip);
  }

  /** Focus distance to whatever is under the canvas point (0..1, y down). */
  pickFocus(u: number, v: number) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    const hits = ray.intersectObjects(this.world.subject ? [this.world.subject.group] : [], true);
    const hit = hits[0];
    if (!hit) return null;
    return hit.point.distanceTo(this.camera.position);
  }

  get size() {
    return { w: this.w, h: this.h };
  }
}

/** Drag on `el` to look around the subject a little. */
export function dragLook(el: HTMLElement, rig: Rig, range = { x: 0.6, y: 0.25 }) {
  let start: { x: number; y: number; lx: number; ly: number; id: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button, input, select, a, [data-no-drag]')) return;
    start = { x: e.clientX, y: e.clientY, lx: rig.look.x, ly: rig.look.y, id: e.pointerId };
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || start.id !== e.pointerId) return;
    const r = el.getBoundingClientRect();
    rig.look.x = Math.max(-range.x, Math.min(range.x, start.lx - ((e.clientX - start.x) / r.width) * 2));
    rig.look.y = Math.max(-range.y, Math.min(range.y, start.ly + ((e.clientY - start.y) / r.height) * 0.8));
  });
  const end = () => (start = null);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
