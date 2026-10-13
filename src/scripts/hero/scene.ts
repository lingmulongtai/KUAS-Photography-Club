import * as THREE from 'three';
import type { Demo } from '../gl/stage';
import { createEnv } from './env';
import { KYOTO, directionFrom, jstMinutes, localSiderealAngle, moonPosition, sunPosition } from './astro';
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
import { BUILDINGS_BOX, CAMPUS_CENTER } from './geo';
import { buildBeacons, buildLandmarks } from './landmarks';
import { buildWater } from './water';
import { createLabels } from './labels';
import { buildTrees } from './trees';
import { buildMeteors } from './meteors';
import { buildCampus, campusTreeSpots } from './campus';

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
  /** The camera started moving to (or arrived at) a view. */
  onMode?: (mode: HeroMode, arrived: boolean) => void;
  reducedMotion?: boolean;
  /** Length of the flight to the campus, seconds. */
  flightSeconds?: number;
  /** Screen areas (stage pixels) the place pins should keep out of, such as the headline. */
  avoid?: () => { x: number; y: number; w: number; h: number }[];
}

export type HeroMode = 'city' | 'campus';

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

export function createHero(renderer: THREE.WebGLRenderer, el: HTMLElement, opts: HeroOptions): Demo & { burst(n: number): void; flyTo(to: HeroMode): void; readonly mode: HeroMode } {
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
  let campusModel: THREE.Mesh | null = null;
  /** Pixels per metre at 1 m distance, so point lights can size themselves. */
  const updatePointScale = () => {
    const k = (height * pixelRatio) / (2 * Math.tan((camera.fov * RAD) / 2));
    for (const u of pointLayers) u.uScale.value = k;
    pxPerM = k;
  };
  let pxPerM = 1000;
  let lastT = 0;
  const campus = new THREE.Vector3(CAMPUS_CENTER.x, 40, CAMPUS_CENTER.z);
  const eye = new THREE.Vector3(VIEW.eye.x, 260, VIEW.eye.z);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  (async () => {
    const meta = await loadJSON<TerrainMeta>('terrain.json');
    const [hf, wide] = await Promise.all([loadHeightfield(meta), loadTexture(meta.aerialWide.file, aniso)]);
    eye.y = hf.height(PLACES.shogunzuka.x, PLACES.shogunzuka.z) + VIEW.eye.above;
    campus.y = hf.height(campus.x, campus.z) + 14;
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
    const lite = opts.quality < 0.75;
    const city = buildCity(env, hf, buildings, (b) =>
      !lite || b.w * b.d > 90 || b.h > 12 || Math.hypot(b.x - eye.x, b.z - eye.z) < 3500 || Math.hypot(b.x - campus.x, b.z - campus.z) < 1200,
    );
    const landmarks = buildLandmarks(env, hf);
    const trees = buildTrees(env, hf, cityPhoto.image as HTMLImageElement, meta.aerialCity.box, VIEW.eye, opts.quality, campusTreeSpots(hf));
    scene.add(trees.group);
    campusModel = buildCampus(env, hf, buildings).mesh;
    scene.add(campusModel);
    casts(campusModel);
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
    labels = createLabels(el, hf, (id) => opts.onAction?.(id), opts.avoid);
    const lamps = buildLamps(env, hf, lines, opts.quality);
    const traffic = buildTraffic(env, hf, lines, opts.quality);
    pointLayers.push(lamps.uniforms, traffic.uniforms);
    scene.add(lamps.points, traffic.points);
    updatePointScale();
    opts.onReady?.();
  })().catch((err) => console.error('Kyoto data failed to load', err));

  let lastStatus = '';

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

  /* ---------- camera: the view from Shogunzuka, and a flight to the campus ---------- */

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  el.addEventListener('pointermove', (e) => {
    // hold still while the pointer is on a pin, so it doesn't slide away from the cursor
    if ((e.target as HTMLElement).closest('.hero-pin')) return;
    const r = el.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.ty = 1 - ((e.clientY - r.top) / r.height) * 2;
  });
  el.addEventListener('pointerleave', () => {
    pointer.tx = 0;
    pointer.ty = 0;
  });

  let mode: HeroMode = 'city';
  let modeSince = 0;
  let flight: { to: HeroMode; t: number; dur: number; p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; p3: THREE.Vector3 } | null = null;
  env.uCampus.value.set(CAMPUS_CENTER.x, CAMPUS_CENTER.z);
  const ORBIT = { radius: 640, height: 150, start: 112 * RAD, speed: 0.03 };
  const pose = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  function cityPose(t: number, out = pose) {
    const drift = opts.reducedMotion ? 0 : Math.sin(t * 0.05) * 0.8;
    const b = (VIEW.bearing + drift + pointer.x * 1.6) * RAD;
    const p = (VIEW.pitch + pointer.y * 0.6) * RAD;
    out.pos.copy(eye);
    out.target.set(eye.x + Math.sin(b) * Math.cos(p) * 1000, eye.y + Math.sin(p) * 1000, eye.z - Math.cos(b) * Math.cos(p) * 1000);
    return out;
  }

  function campusPose(t: number, out = pose) {
    const a = ORBIT.start - (opts.reducedMotion ? 0 : (t - modeSince) * ORBIT.speed) + pointer.x * 0.08;
    out.pos.set(campus.x + Math.sin(a) * ORBIT.radius, campus.y + ORBIT.height + pointer.y * 25, campus.z - Math.cos(a) * ORBIT.radius);
    // aim a little above the campus so the mountains behind stay in frame
    out.target.copy(campus).setY(campus.y + 45);
    return out;
  }

  function flyTo(to: HeroMode, t: number) {
    if (mode === to && !flight) return;
    const from = flight ? { pos: camera.position.clone(), target: lastTarget.clone() } : mode === 'city' ? cityPose(t, { pos: new THREE.Vector3(), target: new THREE.Vector3() }) : campusPose(t, { pos: new THREE.Vector3(), target: new THREE.Vector3() });
    const seconds = opts.reducedMotion ? 0.01 : opts.flightSeconds ?? 5;
    modeSince = t + seconds;
    const end = to === 'city' ? cityPose(t, { pos: new THREE.Vector3(), target: new THREE.Vector3() }) : campusPose(modeSince, { pos: new THREE.Vector3(), target: new THREE.Vector3() });
    const p0 = from.pos;
    const p3 = end.pos;
    const lift = new THREE.Vector3(0, 260, 0);
    flight = {
      to,
      t: 0,
      dur: seconds,
      p0,
      t0: from.target,
      p1: p0.clone().lerp(p3, 0.3).add(lift),
      p2: p0.clone().lerp(p3, 0.75).add(lift.multiplyScalar(0.7)),
      p3,
    };
    shadow.setRegion(
      to === 'campus'
        ? new THREE.Box3(new THREE.Vector3(campus.x - 2600, 0, campus.z - 2600), new THREE.Vector3(campus.x + 2600, 450, campus.z + 2600))
        : new THREE.Box3(new THREE.Vector3(-7500, 0, -6000), new THREE.Vector3(3200, 450, 6000)),
    );
    labels?.filter(to === 'campus' ? ['kuas', 'arashiyama', 'atago', 'nijo', 'tower', 'kinkaku'] : null);
    opts.onMode?.(to, false);
  }

  const lastTarget = new THREE.Vector3();
  const bez = new THREE.Vector3();
  function placeCamera(t: number, dt: number) {
    const k = dt ? Math.min(1, dt * 1.5) : 1;
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.dur);
      const e = ease(flight.t);
      const u = 1 - e;
      bez.copy(flight.p0).multiplyScalar(u * u * u)
        .addScaledVector(flight.p1, 3 * u * u * e)
        .addScaledVector(flight.p2, 3 * u * e * e)
        .addScaledVector(flight.p3, e * e * e);
      const end = flight.to === 'city' ? cityPose(t) : campusPose(Math.max(t, modeSince));
      // look ahead a little sooner than we move
      const te = ease(Math.min(1, flight.t * 1.2));
      lastTarget.copy(flight.t0).lerp(end.target, te);
      camera.position.copy(bez);
      const h = flight.to === 'campus' ? THREE.MathUtils.smoothstep(flight.t, 0.4, 1) : 1 - THREE.MathUtils.smoothstep(flight.t, 0, 0.5);
      env.uHighlight.value = h;
      if (flight.t >= 1) {
        mode = flight.to;
        flight = null;
        modeSince = t;
        opts.onMode?.(mode, true);
      }
    } else {
      const p = mode === 'city' ? cityPose(t) : campusPose(t);
      camera.position.copy(p.pos);
      lastTarget.copy(p.target);
    }
    camera.lookAt(lastTarget);
    const detail = env.uHighlight.value > 0.02;
    if (campusModel && campusModel.visible !== detail) {
      campusModel.visible = detail;
      env.uCampusDetail.value = detail ? 1 : 0;
      shadow.invalidate();
    }
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

  let clock = 0;
  return {
    /** Send a few shooting stars at once. */
    burst: (n: number) => meteors.burst(n),
    /** Fly to the campus or back to the view from Shogunzuka. */
    flyTo: (to: HeroMode) => flyTo(to, clock),
    get mode() {
      return flight ? flight.to : mode;
    },
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
      clock = t;
      applyTime(opts.now(), t);
      placeCamera(t, dt);
      const half = Math.atan(Math.tan((camera.fov * RAD) / 2) * camera.aspect);
      meteors.update(t, dt, camera.position, { az: VIEW.bearing * RAD, half, top: (VIEW.pitch * RAD) + (camera.fov * RAD) / 2 }, env.uStars.value, pxPerM);
      post.render(t);
      labels?.update(camera, width, height);
    },
  };
}
