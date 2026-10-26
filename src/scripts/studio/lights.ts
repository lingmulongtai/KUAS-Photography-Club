import * as THREE from 'three';
import { cameraEV } from './optics';
import type { World } from './world';
import type { Text } from './i18n';

/**
 * The photographer's own light: a flash on the camera (manual power or TTL) and up to
 * three lights placed on the floor plan. Light is set in real units (a flash's guide
 * number, a lamp's lux at 1 m) and converted to the scene's units, which are scaled so
 * that an irradiance of π exposes a grey card correctly at the scene's EV.
 */

export type FlashMode = 'off' | 'ttl' | 'manual';
export type LightKind = 'soft' | 'spot';
export type LightColor = 'day' | 'warm' | 'red' | 'blue';

export interface LightSpec {
  id: number;
  kind: LightKind;
  x: number;
  z: number;
  /** Brightness in stops: lux at 1 m = 1000 × 2^level. */
  level: number;
  color: LightColor;
}

/** Guide number of the flash at ISO 100, in metres. */
export const GUIDE_NUMBER = 36;
/** Fastest shutter speed the flash syncs at. */
export const SYNC = 1 / 250;
export const MAX_LIGHTS = 3;
export const LIGHT_COLORS: Record<LightColor, [string, Text]> = {
  day: ['#fff1e0', { ja: '昼光', en: 'Daylight' }],
  warm: ['#ffb06a', { ja: '電球色', en: 'Tungsten' }],
  red: ['#ff3a3a', { ja: '赤', en: 'Red' }],
  blue: ['#3d6dff', { ja: '青', en: 'Blue' }],
};

const E_REF = Math.PI;
const luxToScene = (lux: number, ev: number) => (lux * E_REF) / (2.5 * 2 ** ev);

export interface FlashState {
  mode: FlashMode;
  /** Manual power (1, 1/2 … 1/128). */
  power: number;
  /** Flash exposure compensation for TTL, in stops. */
  fec: number;
  curtain: 'front' | 'rear';
}

export interface FlashResult {
  /** Power the flash fired at (0..1), or 0 when off. */
  power: number;
  /** TTL wanted more than full power: the subject is too far. */
  short: boolean;
  /** The shutter is faster than the sync speed. */
  overSync: boolean;
  /** Distance the flash reaches at full power with these settings (m). */
  reach: number;
}

interface Slot {
  light: THREE.SpotLight;
  body: THREE.Group;
  face: THREE.MeshBasicMaterial;
  spec: LightSpec | null;
}

export class Lighting {
  readonly flash = new THREE.SpotLight('#fff6ec', 0, 0, 0.9, 0.35, 2);
  readonly slots: Slot[] = [];
  state: FlashState = { mode: 'off', power: 1 / 4, fec: 0, curtain: 'front' };
  result: FlashResult = { power: 0, short: false, overSync: false, reach: 0 };
  private nextId = 1;
  private flashIntensity = 0;

  constructor(private world: World) {
    const scene = world.scene;
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(1024, 1024);
    this.flash.shadow.bias = -0.0004;
    this.flash.shadow.camera.near = 0.05;
    scene.add(this.flash, this.flash.target);
    // the lights exist from the start (switched off), so adding one never recompiles shaders
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = new THREE.SpotLight('#ffffff', 0, 0, 0.6, 0.9, 2);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0004;
      light.shadow.camera.near = 0.1;
      const { body, face } = stand();
      body.visible = false;
      scene.add(light, light.target, body);
      this.slots.push({ light, body, face, spec: null });
    }
    world.subframeHooks.push((i, n) => this.subframe(i, n));
  }

  get lights() {
    return this.slots.flatMap((s) => (s.spec ? [s.spec] : []));
  }

  add(partial: Partial<LightSpec> = {}) {
    const slot = this.slots.find((s) => !s.spec);
    if (!slot) return null;
    slot.spec = { id: this.nextId++, kind: 'soft', x: -1.2, z: 1.2, level: 1, color: 'day', ...partial };
    slot.body.visible = true;
    return slot.spec;
  }

  remove(id: number) {
    const slot = this.slots.find((s) => s.spec?.id === id);
    if (!slot) return;
    slot.spec = null;
    slot.light.intensity = 0;
    slot.body.visible = false;
  }

  clear() {
    for (const s of this.slots) if (s.spec) this.remove(s.spec.id);
  }

  update(id: number, patch: Partial<LightSpec>) {
    const slot = this.slots.find((s) => s.spec?.id === id);
    if (slot?.spec) Object.assign(slot.spec, patch);
  }

  /**
   * Set every light for the next picture. `subject` is where the lights aim,
   * `distance` how far the subject is from the camera.
   */
  apply(camera: THREE.PerspectiveCamera, subject: THREE.Vector3, distance: number, shot: { N: number; t: number; iso: number }, ambientStops: number) {
    const ev = this.world.ev;
    for (const s of this.slots) {
      const spec = s.spec;
      if (!spec) continue;
      const soft = spec.kind === 'soft';
      const h = soft ? Math.max(1.5, subject.y + 0.7) : Math.max(1.9, subject.y + 1.1);
      s.light.position.set(spec.x, h, spec.z);
      s.light.target.position.copy(subject);
      s.light.angle = soft ? 0.75 : 0.32;
      s.light.penumbra = soft ? 1 : 0.3;
      s.light.shadow.radius = soft ? 9 : 1.5;
      s.light.color.set(LIGHT_COLORS[spec.color][0]);
      // coloured gels let less light through
      const gel = spec.color === 'red' || spec.color === 'blue' ? 0.35 : 1;
      s.light.intensity = luxToScene(1000 * 2 ** spec.level, ev) * gel;
      s.body.position.set(spec.x, h, spec.z);
      s.body.lookAt(subject);
      s.body.userData.setKind?.(spec.kind);
      // the face of the lamp glows in proportion to its output
      s.face.color.set(LIGHT_COLORS[spec.color][0]).multiplyScalar(Math.min(60, s.light.intensity * (soft ? 0.5 : 2)));
    }

    // the flash sits on the camera's hot shoe and points where the lens points
    const st = this.state;
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    this.flash.position.copy(camera.position).addScaledVector(up, 0.11);
    this.flash.target.position.copy(this.flash.position).add(fwd);
    this.flash.angle = Math.min(1.2, THREE.MathUtils.degToRad(camera.fov) * 0.75 * Math.max(1, camera.aspect));
    const isoK = shot.iso / 100;
    const reach = (GUIDE_NUMBER * Math.sqrt(isoK)) / shot.N;
    // above the sync speed the flash pulses (high-speed sync) and loses power
    const overSync = shot.t < SYNC - 1e-6;
    const hss = overSync ? shot.t / SYNC : 1;
    let power = 0;
    let short = false;
    if (st.mode === 'manual') power = st.power;
    else if (st.mode === 'ttl') {
      // full exposure from the flash alone needs this much power…
      const need = (distance * distance * shot.N * shot.N) / (GUIDE_NUMBER * GUIDE_NUMBER * isoK) / hss;
      // …less when the ambient light already exposes the subject (balanced fill flash)
      const ambient = 2 ** Math.min(2, ambientStops);
      const fill = ambient >= 1 ? 0.35 : 1 - 0.65 * ambient;
      power = need * fill * 2 ** st.fec;
      short = power > 1;
      power = Math.min(1, Math.max(1 / 256, power));
    }
    this.result = { power: st.mode === 'off' ? 0 : power, short, overSync, reach: reach * Math.sqrt(hss) };
    // flash energy is a fixed amount of light, so its scene intensity scales with 1/t
    this.flashIntensity = st.mode === 'off' ? 0 : (power * hss * E_REF * GUIDE_NUMBER * GUIDE_NUMBER) / 2 ** ev / Math.max(shot.t, 1e-4);
    this.flash.intensity = this.flashIntensity;
  }

  /** The flash fires in only the first (front curtain) or last (rear curtain) subframe. */
  private subframe(i: number, n: number) {
    if (!this.flashIntensity) return;
    const fire = this.state.curtain === 'front' ? i === 0 : i === n - 1;
    this.flash.intensity = fire ? this.flashIntensity * n : 0;
  }
}

/** A light on a stand: a softbox (or a small reflector for a spot) whose face glows. */
function stand() {
  const body = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: '#1c1e21', roughness: 0.6, metalness: 0.3 });
  const face = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const soft = new THREE.Group();
  const box = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.1, 0.32, 8, 1, true).rotateX(-Math.PI / 2), black);
  box.material.side = THREE.DoubleSide;
  const softFace = new THREE.Mesh(new THREE.CircleGeometry(0.42, 8), face);
  softFace.position.z = 0.16;
  soft.add(box, softFace);
  const spot = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.07, 0.22, 16, 1, true).rotateX(-Math.PI / 2), black);
  const spotFace = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), face);
  spotFace.position.z = 0.1;
  spot.add(can, spotFace);
  body.add(soft, spot);
  body.userData.setKind = (k: LightKind) => {
    soft.visible = k === 'soft';
    spot.visible = k === 'spot';
  };
  return { body, face };
}

/** Exposure in stops that the scene's ambient light gives with these settings (for TTL's fill balance). */
export const ambientStops = (world: World, shot: { N: number; t: number; iso: number }) => world.ev - cameraEV(shot.N, shot.t, shot.iso);
