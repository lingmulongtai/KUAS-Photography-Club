import * as THREE from 'three';
import { Pipeline, type Viewport } from '../pipeline';
import type { Shot } from '../optics';
import type { World } from '../world';
import { closestFocus, filterById, lensById, lensCharacter, widest, type FilterId, type LensId } from './gear';

/**
 * The studio's camera: where the photographer stands (a point on the floor plan and a
 * height around the subject), where they look, and every setting on the body and lens.
 */

export type Hold = 'tripod' | 'hand' | 'ibis';
export type FocusMode = 'af' | 'mf';
/** Camera height relative to the subject. */
export type Angle = 'low' | 'level' | 'high';

export interface StudioSettings {
  lens: LensId;
  mm: number;
  N: number;
  t: number;
  iso: number;
  focusMode: FocusMode;
  /** Manual focus distance (m). */
  mf: number;
  hold: Hold;
  filter: FilterId;
  /** Polariser rotation, 0 (strongest) to 90°. */
  plAngle: number;
  peaking: boolean;
}

export const ANGLES: Record<Angle, number> = { low: -0.28, level: 0.03, high: 0.42 };
const SHAKE: Record<Hold, number> = { tripod: 0, hand: 1, ibis: 0.12 };

const logLerp = (a: number, b: number, k: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * k);
const angLerp = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class StudioCamera {
  readonly camera = new THREE.PerspectiveCamera(40, 1.5, 0.02, 400);
  readonly pipeline: Pipeline;
  settings: StudioSettings;
  /** Where the photographer stands, around the subject: heading (radians), distance (m), height angle. */
  place = { yaw: 0, dist: 2, angle: 'level' as Angle };
  private now = { yaw: 0, dist: 2, pitch: ANGLES.level, mm: 50, N: 4, focus: 2 };
  /** Extra look from dragging the picture. */
  look = { x: 0, y: 0 };
  /** Tap-to-focus point (0..1 on the picture, y down), or null to focus on the subject. */
  afPoint: { u: number; v: number } | null = null;
  /** Focus distance actually used in the last picture. */
  focus = 2;
  /** Wanted focus was closer than the lens can focus. */
  tooClose = false;
  /** Distance to whatever is under the AF point. */
  private afDistance: number | null = null;
  private afAge = 0;
  private ray = new THREE.Raycaster();

  constructor(renderer: THREE.WebGLRenderer, readonly world: World, init: Partial<StudioSettings> = {}) {
    this.pipeline = new Pipeline(renderer);
    this.settings = { lens: 'free', mm: 50, N: 4, t: 1 / 250, iso: 100, focusMode: 'af', mf: 3, hold: 'tripod', filter: 'none', plAngle: 0, peaking: false, ...init };
  }

  set(patch: Partial<StudioSettings>) {
    Object.assign(this.settings, patch);
  }

  get lens() {
    return lensById(this.settings.lens);
  }

  get filter() {
    return filterById(this.settings.filter);
  }

  /** The point the camera turns around: the subject's aim or focus point. */
  get aim() {
    const s = this.world.subject;
    return s?.aim ?? s?.focus ?? new THREE.Vector3(0, 1.2, 0);
  }

  /** Jump straight to the wanted place and settings (after changing scenes). */
  snap() {
    this.now.yaw = this.place.yaw;
    this.now.dist = this.place.dist;
    this.now.pitch = ANGLES[this.place.angle];
    this.now.mm = this.settings.mm;
    this.now.N = this.settings.N;
    this.afDistance = null;
  }

  /** Stand at a point of the floor plan, facing the subject. */
  standAt(x: number, z: number) {
    const a = this.aim;
    const dx = x - a.x;
    const dz = z - a.z;
    const horiz = Math.max(0.05, Math.hypot(dx, dz));
    this.place.yaw = Math.atan2(dx, dz);
    this.place.dist = horiz / Math.cos(ANGLES[this.place.angle]);
    this.look.x = 0;
  }

  /** Floor-plan position of the camera (now). */
  get floor() {
    return { x: this.camera.position.x, z: this.camera.position.z };
  }

  update(dt: number) {
    const k = dt ? Math.min(1, dt * 5) : 1;
    const n = this.now;
    const s = this.settings;
    n.yaw = angLerp(n.yaw, this.place.yaw, k);
    n.dist = logLerp(n.dist, this.place.dist, k);
    n.pitch += (ANGLES[this.place.angle] - n.pitch) * k;
    n.mm = logLerp(n.mm, s.mm, k);
    n.N = logLerp(n.N, s.N, k);
    const aim = this.aim;
    const yaw = n.yaw;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(n.pitch), Math.sin(n.pitch), Math.cos(yaw) * Math.cos(n.pitch));
    const cam = this.camera;
    cam.position.copy(aim).addScaledVector(dir, n.dist);
    if (cam.position.y < 0.06) cam.position.y = 0.06;
    cam.lookAt(aim);
    // dragging the picture turns the camera on the spot
    cam.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), this.look.x);
    cam.rotateX(this.look.y);
    cam.updateMatrixWorld();

    // focus: subject, a tapped point, or the focus ring
    let want: number;
    if (s.focusMode === 'mf') want = s.mf;
    else if (this.afPoint) {
      if (this.afDistance === null || ++this.afAge > 8) {
        this.afAge = 0;
        this.afDistance = this.pick(this.afPoint.u, this.afPoint.v) ?? this.afDistance;
      }
      want = this.afDistance ?? this.subjectDistance();
    } else want = this.subjectDistance();
    const closest = closestFocus(this.lens, s.mm);
    this.tooClose = want < closest * 0.98;
    want = Math.max(want, closest);
    n.focus = dt && s.focusMode === 'af' ? logLerp(n.focus, want, Math.min(1, dt * 9)) : want;
    this.focus = n.focus;
  }

  /** Distance along the view axis to the subject's focus point. */
  subjectDistance() {
    const subj = this.world.subject;
    const p = subj?.focus ?? this.aim;
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    return Math.max(0.03, p.clone().sub(this.camera.position).dot(fwd));
  }

  /** Straight-line distance to the subject's focus point. */
  distanceToSubject() {
    return (this.world.subject?.focus ?? this.aim).distanceTo(this.camera.position);
  }

  /** Distance to whatever is under a point of the picture (0..1, y down). */
  pick(u: number, v: number) {
    this.ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    // the panorama counts too: its ground is at its real distance, its sky far away
    const targets = this.world.scene.children.filter((o) => o.visible && (o instanceof THREE.Group || o instanceof THREE.Mesh));
    const hits = this.ray.intersectObjects(targets, true);
    const hit = hits.find((h) => {
      const m = h.object as THREE.Mesh;
      if (!m.visible || h.distance < 0.02) return false;
      let o: THREE.Object3D | null = m;
      while (o) {
        if (!o.visible) return false;
        o = o.parent;
      }
      const mat = m.material as THREE.Material;
      return !!mat && !mat.transparent && !(mat instanceof THREE.ShadowMaterial);
    });
    return hit ? hit.distance : null;
  }

  get shot(): Shot {
    const s = this.settings;
    const n = this.now;
    const lens = this.lens;
    const filter = this.filter;
    return {
      mm: n.mm,
      N: Math.max(n.N, widest(lens, n.mm) * 0.999),
      t: s.t,
      iso: s.iso,
      focus: this.focus,
      shake: SHAKE[s.hold],
      blades: lens.blades,
      peaking: s.peaking,
      bias: -filter.stops,
      lens: lensCharacter(lens, n.mm),
      filter: filter.effect ? { ...filter.effect, sat: filter.effect.sat * this.plStrength } : undefined,
      breathing: true,
    };
  }

  /** How much the polariser works at its current rotation (0..1). */
  get plStrength() {
    return this.filter.polarizer ? Math.cos(THREE.MathUtils.degToRad(this.settings.plAngle)) ** 2 : 0;
  }

  render(time: number, to: THREE.WebGLRenderTarget | null = null, viewport?: Viewport) {
    this.world.polarizer = this.plStrength;
    this.pipeline.render(this.world, this.camera, this.shot, time, viewport, to);
  }

  resize(w: number, h: number, dpr: number) {
    this.camera.aspect = w / h;
    this.pipeline.setSize(w * dpr, h * dpr);
  }
}
