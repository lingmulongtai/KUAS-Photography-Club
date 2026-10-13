import * as THREE from 'three';
import type { Demo } from '../gl/stage';
import { createEnv } from './env';
import { KYOTO, directionFrom, jstMinutes, localSiderealAngle, moonPosition, sunPosition } from '../kyoto/astro';
import { createLook, kelvin, lookAt, phaseName, windowsLit } from './palette';
import { PLACES } from './geo';
import { loadJSON, loadTexture, type TerrainMeta } from './data';
import { loadHeightfield } from './heightfield';
import { buildTerrain, normalTexture } from './terrain';
import { buildCelestial, buildSkyDome } from './sky';
import { createPost } from './post';
import { loadBuildings } from './buildings-data';
import { buildCity } from './buildings';
import { SHADOW_LAYER, createSunShadow } from './shadow';
import { loadLines } from './lines-data';
import { buildLamps, buildTraffic, roadGlowTexture } from './lights';
import { BUILDINGS_BOX } from './geo';
import { buildBeacons, buildLandmarks } from './landmarks';
import { buildWater } from './water';
import { createLabels } from './labels';
import { buildTrees } from './trees';
import { buildMeteors } from './meteors';

export interface HeroStatus {
  minutes: number;
  altitude: number;
  phase: string;
  kelvin: number | null;
  moonAge: number;
}

export interface HeroOptions {
  /** Date to render for this frame. */
  now: () => Date;
  quality: number;
  onStatus?: (s: HeroStatus) => void;
  onReady?: () => void;
  /** A pin with an action was pressed (the campus). */
  onAction?: (id: string) => void;
}

const RAD = Math.PI / 180;

/**
 * The view from Shogunzuka Seiryuden, looking west over the city: from just in front of the
 * stage and a little above it, so the temple grounds stay out of frame and the slope below
 * is all forest.
 */
const BEARING = 265;
export const VIEW = {
  eye: {
    x: PLACES.shogunzuka.x + Math.sin((BEARING * Math.PI) / 180) * 120,
    z: PLACES.shogunzuka.z - Math.cos((BEARING * Math.PI) / 180) * 120,
    /** metres above the ground at the stage */
    above: 44,
  },
  bearing: BEARING,
  pitch: -5,
};

export function createHero(renderer: THREE.WebGLRenderer, el: HTMLElement, opts: HeroOptions): Demo & { burst(n: number): void } {
  const env = createEnv();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 8, 60000);
  const sky = buildSkyDome(env);
  const celestial = buildCelestial(env, opts.quality);
  const meteors = buildMeteors(opts.quality);
  scene.add(sky.mesh, celestial.group, meteors.group);
  const post = createPost(renderer, scene, camera, opts.quality > 0.75 ? 4 : 2);
  const shadow = createSunShadow(renderer, scene, env, opts.quality > 0.75 ? 4096 : 2048);
  const casts = (o: THREE.Object3D) => o.traverse((c) => (c as THREE.Mesh).isMesh && c.layers.enable(SHADOW_LAYER));
  const look = createLook();

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  const pointLayers: { uScale: { value: number } }[] = [];
  let labels: ReturnType<typeof createLabels> | null = null;
  /** Pixels per metre at 1 m distance, so point lights can size themselves. */
  const updatePointScale = () => {
    const k = (height * pixelRatio) / (2 * Math.tan((camera.fov * RAD) / 2));
    for (const u of pointLayers) u.uScale.value = k;
    pxPerM = k;
  };
  let pxPerM = 1000;
  let lastT = 0;
  const eye = new THREE.Vector3(VIEW.eye.x, 260, VIEW.eye.z);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  (async () => {
    const meta = await loadJSON<TerrainMeta>('terrain.json');
    const [hf, wide] = await Promise.all([loadHeightfield(meta), loadTexture(meta.aerialWide.file, aniso)]);
    eye.y = hf.height(PLACES.shogunzuka.x, PLACES.shogunzuka.z) + VIEW.eye.above;
    const terrain = buildTerrain(env, hf, VIEW.eye, {
      aerialWide: wide,
      aerialWideBox: meta.aerialWide.box,
      aerialCity: null,
      aerialCityBox: meta.aerialCity.box,
      normalFar: normalTexture(hf, meta.far),
      normalFarBox: meta.far.box,
      normalNear: normalTexture(hf, meta.near),
      normalNearBox: meta.near.box,
    }, opts.quality > 0.75 ? 640 : 400);
    scene.add(terrain.mesh);
    casts(terrain.mesh);
    shadow.invalidate();
    const [cityPhoto, buildings] = await Promise.all([loadTexture(meta.aerialCity.file, aniso), loadBuildings()]);
    terrain.uniforms.uAerialCity.value = cityPhoto;
    terrain.uniforms.uCityOn.value = 1;
    const city = buildCity(env, hf, buildings);
    const landmarks = buildLandmarks(env, hf);
    const trees = buildTrees(env, hf, cityPhoto.image as HTMLImageElement, meta.aerialCity.box, VIEW.eye, opts.quality);
    scene.add(trees.group);
    scene.add(city.group, landmarks.mesh);
    casts(city.group);
    casts(landmarks.mesh);
    shadow.invalidate();
    const tops = [landmarks.positions.kyotoTower.clone().setY(landmarks.positions.kyotoTower.y + 131.5)];
    scene.add(buildBeacons(env, tops));

    const lines = await loadLines();
    terrain.uniforms.uRoadGlow.value = roadGlowTexture(lines, opts.quality > 0.75 ? 4096 : 2048);
    terrain.uniforms.uRoadBox.value.set(...BUILDINGS_BOX);
    scene.add(buildWater(env, hf, lines));
    labels = createLabels(el, hf, (id) => opts.onAction?.(id));
    const lamps = buildLamps(env, hf, lines, opts.quality);
    const traffic = buildTraffic(env, hf, lines, opts.quality);
    pointLayers.push(lamps.uniforms, traffic.uniforms);
    scene.add(lamps.points, traffic.points);
    updatePointScale();
    opts.onReady?.();
  })().catch((err) => console.error('Kyoto data failed to load', err));

  let lastStatus = '';
  const target = new THREE.Vector3();

  function applyTime(date: Date, t: number) {
    const sun = sunPosition(date);
    const alt = sun.altitude / RAD;
    lookAt(alt, look);
    const minutes = jstMinutes(date);
    env.uTime.value = t;
    env.uSunDir.value.set(...directionFrom(sun));
    shadow.update(env.uSunDir.value);
    env.uZenith.value.copy(look.zenith);
    env.uMid.value.copy(look.mid);
    env.uHorizon.value.copy(look.horizon);
    env.uGlow.value.copy(look.glow).multiplyScalar(look.glowAmt);
    const sunVisible = THREE.MathUtils.smoothstep(alt, -1.2, 1.2);
    env.uSunLight.value.copy(look.sun).multiplyScalar(look.sunAmt * sunVisible);
    env.uCloudLight.value.copy(look.cloud).multiplyScalar(look.cloudAmt);
    env.uCity.value = look.city;
    env.uLit.value = windowsLit(minutes);
    env.uVenus.value = THREE.MathUtils.smoothstep(alt, -8, -2) * (1 - THREE.MathUtils.smoothstep(alt, 1, 5));

    const moon = moonPosition(date);
    env.uMoonDir.value.set(...directionFrom(moon));
    const moonUp = THREE.MathUtils.smoothstep(moon.altitude, -0.02, 0.03);
    const dark = look.stars;
    sky.uniforms.uMoonVis.value = moonUp * (0.3 + 0.7 * dark);
    sky.uniforms.uMoonIllum.value = moon.illumination;
    env.uMoonLight.value.setRGB(0.5, 0.58, 0.78).multiplyScalar(0.07 * moon.illumination * moonUp * dark);
    env.uStars.value = dark * (1 - 0.35 * moon.illumination * moonUp);
    celestial.setSidereal(localSiderealAngle(date, KYOTO.lon));

    renderer.toneMappingExposure = look.exposure;
    post.bloom.strength = look.bloom;

    const status: HeroStatus = { minutes, altitude: alt, phase: phaseName(alt, minutes), kelvin: kelvin(alt), moonAge: moon.age };
    const key = `${Math.floor(minutes)}|${status.phase}`;
    if (key !== lastStatus) {
      lastStatus = key;
      opts.onStatus?.(status);
    }
  }

  function placeCamera() {
    const b = VIEW.bearing * RAD;
    const p = VIEW.pitch * RAD;
    camera.position.copy(eye);
    target.set(eye.x + Math.sin(b) * Math.cos(p), eye.y + Math.sin(p), eye.z - Math.cos(b) * Math.cos(p));
    camera.lookAt(target);
    sky.mesh.position.copy(camera.position);
    celestial.group.position.copy(camera.position);
  }

  // tap the sky for a shooting star
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    const ndcY = 1 - ((e.clientY - r.top) / r.height) * 2;
    const elev = VIEW.pitch * RAD + ndcY * (camera.fov * RAD) / 2;
    if (elev > 0.01 && !(e.target as HTMLElement).closest('button')) meteors.burst(1);
  });

  return {
    /** Send a few shooting stars at once. */
    burst: (n: number) => meteors.burst(n),
    t0: 0,
    resize(w, h, d) {
      width = w;
      height = h;
      camera.aspect = w / h;
      // about 68° across on a wide screen: Kyoto Tower and Toji on the left to Nijo Castle and Atago on the right
      camera.fov = THREE.MathUtils.clamp((2 * Math.atan(Math.tan(34 * RAD) / camera.aspect)) / RAD, 36, 66);
      camera.updateProjectionMatrix();
      pixelRatio = d;
      renderer.setPixelRatio(d);
      renderer.setSize(width, height, false);
      post.setSize(width, height, d);
      celestial.starUniforms.uDpr.value = d;
      meteors.spriteUniforms.uDpr.value = d;
      updatePointScale();
    },
    render(t) {
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      applyTime(opts.now(), t);
      placeCamera();
      const half = Math.atan(Math.tan((camera.fov * RAD) / 2) * camera.aspect);
      meteors.update(t, dt, camera.position, { az: VIEW.bearing * RAD, half, top: (VIEW.pitch * RAD) + (camera.fov * RAD) / 2 }, env.uStars.value, pxPerM);
      post.render(t);
      labels?.update(camera, width, height);
    },
  };
}
