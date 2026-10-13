import * as THREE from 'three';
import type { Demo } from '../gl/stage';
import { createEnv } from './env';
import { KYOTO, directionFrom, jstMinutes, jstParts, localSiderealAngle, moonPosition, sunPosition } from './astro';
import { createLook, kelvin, lookAt, phaseName, windowsLit } from './palette';
import { VIEW } from './layout';
import { buildTerrain, daimonjiLit } from './terrain';
import { buildCity, setPointScale } from './city';
import { buildCampusBeacon, buildLandmarks } from './landmarks';
import { buildRiver } from './water';
import { buildCelestial, buildSkyDome } from './sky';
import { buildClouds, coverForDay } from './clouds';
import { createPost } from './post';
import { SHADOW_LAYER, createSunShadow } from './shadow';

export interface KyotoStatus {
  minutes: number;
  altitude: number;
  phase: string;
  kelvin: number | null;
  moonAge: number;
  moonUp: boolean;
  fire: boolean;
}

export interface KyotoClock {
  /** Date to render for this frame. */
  now(): Date;
}

export interface KyotoOptions {
  clock: KyotoClock;
  quality: number;
  /** Where the campus beacon lands on screen (pixels), or null when it is off screen. */
  onCampus?: (p: { x: number; y: number } | null) => void;
  onStatus?: (s: KyotoStatus) => void;
}

const RAD = Math.PI / 180;

export function createKyoto(renderer: THREE.WebGLRenderer, el: HTMLElement, opts: KyotoOptions): Demo {
  const env = createEnv();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 6000);

  const terrain = buildTerrain(env, opts.quality > 0.75 ? 300 : 200);
  const city = buildCity(env, opts.quality);
  const landmarks = buildLandmarks(env);
  const river = buildRiver(env);
  const sky = buildSkyDome(env);
  const celestial = buildCelestial(env, opts.quality);
  const clouds = buildClouds(env);
  const beacon = buildCampusBeacon(env);
  scene.add(sky.mesh, celestial.group, terrain.mesh, city.group, landmarks, river, clouds.mesh, beacon.points);

  for (const caster of [terrain.mesh, city.group, landmarks]) {
    caster.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.layers.enable(SHADOW_LAYER);
    });
  }
  const shadow = createSunShadow(renderer, scene, env, opts.quality > 0.75 ? 3072 : 2048);
  const post = createPost(renderer, scene, camera);
  const look = createLook();
  const tmp = new THREE.Vector3();
  const target = new THREE.Vector3();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.ty = 1 - ((e.clientY - r.top) / r.height) * 2;
  });
  el.addEventListener('pointerleave', () => {
    pointer.tx = 0;
    pointer.ty = 0;
  });

  let width = 1;
  let height = 1;
  let dpr = 0;
  let lastStatus = '';
  let slowFrames = 0;
  let campusSeen = '';

  function applyTime(date: Date, t: number, dt: number) {
    const sun = sunPosition(date);
    const alt = sun.altitude / RAD;
    lookAt(alt, look);
    const minutes = jstMinutes(date);
    const ymd = jstParts(date);

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
    env.uFogDensity.value = minutes < 9 * 60 && minutes > 4 * 60 ? 0.001 : minutes > 13 * 60 && alt > 4 ? 0.0006 : 0.0008;

    const moon = moonPosition(date);
    env.uMoonDir.value.set(...directionFrom(moon));
    const moonUp = THREE.MathUtils.smoothstep(moon.altitude, -0.02, 0.03);
    const dark = look.stars;
    sky.uniforms.uMoonVis.value = moonUp * (0.3 + 0.7 * dark);
    sky.uniforms.uMoonIllum.value = moon.illumination;
    env.uMoonLight.value.setRGB(0.5, 0.58, 0.78).multiplyScalar(0.07 * moon.illumination * moonUp * dark);
    env.uStars.value = dark * (1 - 0.35 * moon.illumination * moonUp);

    clouds.uniforms.uCover.value = coverForDay(ymd.year, ymd.month, ymd.day);
    clouds.uniforms.uWind.value.x += dt * 0.004;
    clouds.uniforms.uWind.value.y += dt * 0.0015;

    const fire = daimonjiLit(ymd.month, ymd.day, minutes);
    terrain.fire.value = fire ? 1 : 0;
    celestial.setSidereal(localSiderealAngle(date, KYOTO.lon));
    sky.update(t, dt, env.uStars.value);

    renderer.toneMappingExposure = look.exposure;
    post.bloom.strength = look.bloom + (fire ? 0.3 : 0);

    const status: KyotoStatus = {
      minutes,
      altitude: alt,
      phase: phaseName(alt, minutes),
      kelvin: kelvin(alt),
      moonAge: moon.age,
      moonUp: moon.altitude > 0,
      fire,
    };
    const key = `${Math.floor(minutes)}|${status.phase}|${status.kelvin}|${status.moonAge.toFixed(1)}|${fire}`;
    if (key !== lastStatus) {
      lastStatus = key;
      opts.onStatus?.(status);
    }
  }

  function placeCamera(t: number, dt: number) {
    const k = dt ? Math.min(1, dt * 1.5) : 1;
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    const c = VIEW.camera;
    camera.position.set(c.x + Math.sin(t * 0.021) * 5, c.y + Math.sin(t * 0.033) * 1.2, c.z + Math.sin(t * 0.017) * 7);
    target.set(
      VIEW.target.x + Math.sin(t * 0.019) * 18,
      VIEW.target.y + pointer.y * 14,
      VIEW.target.z + Math.cos(t * 0.015) * 12 - pointer.x * 40,
    );
    camera.lookAt(target);
    sky.mesh.position.copy(camera.position);
    celestial.group.position.copy(camera.position);
    clouds.mesh.position.x = camera.position.x;
    clouds.mesh.position.z = camera.position.z;
  }

  function projectCampus() {
    if (!opts.onCampus) return;
    tmp.copy(beacon.position).project(camera);
    const visible = tmp.z < 1 && Math.abs(tmp.x) < 0.96 && Math.abs(tmp.y) < 0.9;
    const p = visible ? { x: ((tmp.x + 1) / 2) * width, y: ((1 - tmp.y) / 2) * height } : null;
    const key = p ? `${Math.round(p.x)},${Math.round(p.y)}` : 'off';
    if (key !== campusSeen) {
      campusSeen = key;
      opts.onCampus(p);
    }
  }

  function setResolution(next: number) {
    dpr = next;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    post.setSize(width, height, dpr);
    setPointScale(scene, (height * dpr) / (2 * Math.tan((camera.fov * RAD) / 2)));
    celestial.starUniforms.uDpr.value = dpr;
  }

  return {
    t0: 40,
    resize(w, h, d) {
      width = w;
      height = h;
      const aspect = w / h;
      camera.aspect = aspect;
      camera.fov = THREE.MathUtils.clamp((2 * Math.atan(Math.tan(27 * RAD) / aspect)) / RAD, 36, 68);
      camera.updateProjectionMatrix();
      setResolution(dpr ? Math.min(dpr, d) : d);
    },
    render(t, dt) {
      applyTime(opts.clock.now(), t, dt);
      placeCamera(t, dt);
      post.render(t);
      projectCampus();
      // keep the frame rate up on slower devices by rendering fewer pixels
      if (dt > 0) {
        slowFrames = dt > 0.034 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
        if (slowFrames > 45 && dpr > 0.75) {
          slowFrames = 0;
          setResolution(Math.max(0.75, dpr - 0.25));
        }
      }
    },
  };
}
