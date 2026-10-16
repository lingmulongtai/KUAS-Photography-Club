import * as THREE from 'three';
import type { Demo } from '../gl/stage';
import { createEnv } from './env';
import { KYOTO, directionFrom, jstMinutes, jstParts, localSiderealAngle, moonPosition, sunPosition } from './astro';
import { createLook, kelvin, lookAt, phaseName, windowsLit } from './palette';
import type { Box } from './geo';
import { loadBinary, loadJSON, loadTexture, type TerrainMeta } from './data';
import { loadHeightfield } from './heightfield';
import { buildTerrain, normalTexture } from './terrain';
import { buildCelestial, buildSkyDome } from './sky';
import { createPost } from './post';
import { loadBuildings } from './buildings-data';
import { buildCity } from './buildings';
import { SHADOW_LAYER, createSunShadow } from './shadow';
import { buildLamps } from './lights';
import { buildCars } from './cars';
import { buildRoadField } from './roads';
import { BUILDINGS_BOX, CAMPUS_CENTER } from './geo';
import { buildBeacons, buildLandmarks } from './landmarks';
import { buildWater } from './water';
import { createLabels, type HeroTrip } from './labels';
import { createForest } from './trees';
import { buildMeteors } from './meteors';
import { buildCampus, campusTreeSpots } from './campus';
import { buildClouds, coverForDay } from './clouds';
import { createLookRotation, mountLookControls } from './look-controls';
import { createBuildingMask } from './vegetation-mask';
import type { Woodland } from './woodland';
import { buildWoodlandTexture } from './woodland-texture';
import { infrastructureMask } from './forest-infrastructure';
import { buildDaimonji, fireClearing } from './daimonji';
import { landmarkOrbit } from './landmark-orbit';
import { VIEWS, PANORAMA_VIEWS, type ViewDef, type HeroView } from './views';
import type { SpotId } from '../../data/spots';
export type { HeroView } from './views';
import { buildOcclusion } from './building-occlusion';
import { buildIslands } from './islands';
import { islandMask } from './island-mask';
import { LINE, loadLines } from './lines-data';

export interface HeroStatus {
  minutes: number;
  altitude: number;
  phase: string;
  kelvin: number | null;
  moonAge: number;
}

export interface HeroOptions {
  lang?: 'ja' | 'en';
  /** Date to render for this frame. */
  now: () => Date;
  quality: number;
  trips?: HeroTrip[];
  onStatus?: (s: HeroStatus) => void;
  onReady?: () => void;
  /** A map destination was selected. */
  onAction?: (id: SpotId) => void;
  /** The camera started moving to (or arrived at) a view. */
  onMode?: (mode: HeroMode, arrived: boolean) => void;
  reducedMotion?: boolean;
  /** Let the camera drift slowly over the city (off on touch screens, where it makes fine detail shimmer). */
  drift?: boolean;
  /** Length of the flight to the campus, seconds. */
  flightSeconds?: number;
  /** Screen areas (stage pixels) the place pins should keep out of, such as the headline. */
  avoid?: () => { x: number; y: number; w: number; h: number }[];
}

export type HeroMode = 'city' | 'campus';

const RAD = Math.PI / 180;

/** Sharper local photos and the views that look over them; each loads when one of its views is first chosen. */
const REGIONAL_PHOTOS: { key: 'arashiyama' | 'higashiyama'; views: HeroView[]; seasonal: boolean }[] = [
  // photographed with the woods leafless or in autumn colour
  { key: 'arashiyama', views: ['arashiyama','togetsukyo'], seasonal: true },
  { key: 'higashiyama', views: ['shogunzuka', 'kiyomizu','yasaka'], seasonal: false },
];

export function createHero(
  renderer: THREE.WebGLRenderer,
  el: HTMLElement,
  opts: HeroOptions,
): Demo & { burst(n: number): void; flyTo(to: 'campus' | HeroView): void; setElevation(overhead:boolean):void; readonly mode: HeroMode; readonly view: HeroView; readonly orbiting:boolean } {
  const env = createEnv();
  const scene = new THREE.Scene();
  // the near plane sits as far out as the closest views allow: depth precision in the city 5 km
  // away depends on it, and too little of it makes neighbouring rooftops flicker
  const camera = new THREE.PerspectiveCamera(40, 1, 20, 60000);
  const sky = buildSkyDome(env);
  const celestial = buildCelestial(env, opts.quality);
  const meteors = buildMeteors(opts.quality);
  const clouds = buildClouds(env);
  scene.add(sky.mesh, celestial.group, meteors.group, clouds.mesh);
  const post = createPost(renderer, scene, camera, 2);
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
  let view: HeroView = 'shogunzuka';
  let VIEW: ViewDef = VIEWS.shogunzuka;
  const eye = new THREE.Vector3(VIEW.eye.x, 260, VIEW.eye.z);
  let groundAt: ((x: number, z: number) => number) | null = null;
  let orbitObstruction: ((x:number,z:number)=>number) | undefined;
  let terrainRecenter: ((c: { x: number; z: number }) => void) | null = null;
  let ensureRegionalPhoto: ((v: HeroView)=>void) | null = null;
  let plantTrees: ((eye: { x: number; z: number }, bearing: number) => void) | null = null;
  let driveCars: ((dt: number) => void) | null = null;
  const eyeOf = (v: ViewDef) => new THREE.Vector3(v.eye.x, (groundAt ? groundAt(v.ref.x, v.ref.z) : 40) + v.above, v.eye.z);
  const landscapeCenter = (v: ViewDef) => v.orbit?.center ?? v.eye;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  (async () => {
    const meta = await loadJSON<TerrainMeta>('terrain.json');
    const wideFile = opts.quality >= .75 && meta.aerialWide.high ? meta.aerialWide.high.file : meta.aerialWide.file;
    const [hf, wide] = await Promise.all([loadHeightfield(meta), loadTexture(wideFile, aniso)]);
    groundAt = (x, z) => hf.height(x, z);
    eye.copy(eyeOf(VIEW));
    campus.y = hf.height(campus.x, campus.z) + 14;
    const regions = REGIONAL_PHOTOS.flatMap((r) => {
      const m = meta[r.key];
      return m ? [{ ...r, meta: m }] : [];
    });
    const terrain = buildTerrain(env, hf, VIEW.eye, {
      aerialWide: wide,
      aerialWideBox: meta.aerialWide.box,
      aerialCity: null,
      aerialCityBox: meta.aerialCity.box,
      normalFar: normalTexture(hf, meta.far),
      normalFarBox: meta.far.box,
      normalNear: normalTexture(hf, meta.near),
      normalNearBox: meta.near.box,
      regional: meta.arashiyama ? {box:meta.arashiyama.box,normal:normalTexture(hf,meta.arashiyama.elevation)} : undefined,
      photos: regions.map((r) => r.meta.box),
    }, opts.quality > 0.75 ? 640 : 400);
    const regionalPhotos: (Promise<unknown> | undefined)[] = [];
    const detailedPhotos: (THREE.Texture | undefined)[] = [];
    let updateForestPhoto:((photo:THREE.Texture,i:number)=>void) | undefined;
    ensureRegionalPhoto = (v) => regions.forEach((r, i) => {
      if (!r.views.includes(v) || regionalPhotos[i]) return;
      const file=opts.quality<.75?r.meta.mobile.file:r.meta.file;
      regionalPhotos[i]=loadTexture(file,aniso).then(photo=>{
        detailedPhotos[i]=photo;
        terrain.setPhoto(i,photo);
        updateForestPhoto?.(photo,i);
      }).catch(error=>{regionalPhotos[i]=undefined;console.warn(`${r.key} imagery unavailable`,error);});
    });
    ensureRegionalPhoto(view);
    terrainRecenter = terrain.recenter;
    // Warm only the scenic views. Map destinations are prepared when visited,
    // so adding places does not make phones build every terrain mesh at startup.
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 500));
    const pending = PANORAMA_VIEWS.map(id=>VIEWS[id]).filter((v) => v !== VIEW);
    const prepNext = () => {
      const v = pending.shift();
      if (!v) return;
      terrain.prepare(landscapeCenter(v));
      idle(prepNext);
    };
    idle(prepNext);
    scene.add(terrain.mesh);
    casts(terrain.mesh);
    shadow.invalidate();
    const [cityPhoto, buildings, lines, woodlandBytes] = await Promise.all([loadTexture(meta.aerialCity.file, aniso), loadBuildings(), loadLines(meta.arashiyama?.water.file), loadBinary('woodland.json.gz')]);
    const woodlandData = JSON.parse(new TextDecoder().decode(woodlandBytes)) as {polygons: Woodland[]};
    const woodlandRaster = buildWoodlandTexture(woodlandData.polygons, meta.aerialWide.box);
    const forestArea = woodlandRaster.contains;
    terrain.uniforms.uWoodland.value = woodlandRaster.texture;
    terrain.uniforms.uWoodlandOn.value = 1;
    terrain.uniforms.uAerialCity.value = cityPhoto;
    terrain.uniforms.uCityOn.value = 1;
    const lite = opts.quality < 0.75;
    const eyes = Object.values(VIEWS).map((v) => v.eye);
    const landmarks = buildLandmarks(env, hf);
    const replacements = [{p:landmarks.positions.kyotoTower,w:52,d:40},{p:landmarks.positions.goldenPavilion,w:25,d:25},{p:landmarks.positions.kiyomizuHall,w:40,d:48}];
    const replaced = (x:number,z:number) => replacements.some(({p,w,d})=>Math.abs(x-p.x)<w/2 && Math.abs(z-p.z)<d/2);
    const modeledBuildings = {...buildings,polys:buildings.polys.filter(p=>{
      let x=0,z=0;for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}
      return !replaced(x/(p.ring.length/2),z/(p.ring.length/2));
    })};
    const city = buildCity(env, hf, modeledBuildings, (b) =>
      !replaced(b.x,b.z) && (!lite || b.w * b.d > 90 || b.h > 12 || eyes.some((e) => Math.hypot(b.x - e.x, b.z - e.z) < 3000) || Math.hypot(b.x - campus.x, b.z - campus.z) < 1200),
    );
    const builtSize = lite ? 1024 : 2048;
    env.uBuilt.value = buildOcclusion(buildings, BUILDINGS_BOX, builtSize);
    env.uBuiltBox.value.set(...BUILDINGS_BOX);
    env.uBuiltTexel.value = (BUILDINGS_BOX[2] - BUILDINGS_BOX[0]) / builtSize;
    env.uBuiltOn.value = 1;
    const buildingsMask = createBuildingMask(buildings.boxes, buildings.polys);
    const forestMaskBox=regions.reduce<Box>((a,{meta:{box:b}})=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),
      Math.max(a[2],b[2]),Math.max(a[3],b[3])],BUILDINGS_BOX);
    const roadsAndWater = infrastructureMask(lines, forestMaskBox);
    scene.add(buildDaimonji(env,hf));
    // the water mask is too coarse for garden islands, so they are tested on their outlines
    const island = islandMask(lines.filter((f) => f.kind === LINE.waterHole).map((f) => f.pts));
    const forest = createForest(env, hf, cityPhoto.image as HTMLImageElement, meta.aerialCity.box, opts.quality, campusTreeSpots(hf), { photo: wide.image as HTMLImageElement, box: meta.aerialWide.box }, (x,z) => buildingsMask(x,z) || (roadsAndWater(x,z) && !island(x,z)) || fireClearing(x,z), (x,z) => forestArea(x,z) || island(x,z));
    const forestPhoto=(photo:THREE.Texture,i:number)=>{
      forest.setRegionalPhoto(photo.image as HTMLImageElement,regions[i].meta.box,regions[i].seasonal);
      shadow.invalidate();
    };
    updateForestPhoto=forestPhoto;
    detailedPhotos.forEach((photo,i)=>photo&&forestPhoto(photo,i));
    orbitObstruction = (x,z) => {
      const center=landscapeCenter(VIEW);
      const canopy=Math.hypot(x-center.x,z-center.z)>24 && forest.contains(x,z);
      return hf.height(x,z)+(canopy?24:4);
    };
    forest.plant(landscapeCenter(VIEW), VIEW.bearing);
    plantTrees = forest.plant;
    scene.add(forest.group);
    campusModel = buildCampus(env, hf, buildings).mesh;
    scene.add(campusModel);
    casts(campusModel);
    scene.add(city.group, landmarks.mesh);
    casts(city.group);
    casts(landmarks.mesh);
    shadow.invalidate();
    const tops = [landmarks.positions.kyotoTower.clone().setY(landmarks.positions.kyotoTower.y + 131.5)];
    scene.add(buildBeacons(env, tops));

    terrain.uniforms.uRoads.value = buildRoadField(renderer, lines, opts.quality > 0.75 ? 4096 : 2048).texture;
    terrain.uniforms.uRoadBox.value.set(...BUILDINGS_BOX);
    terrain.uniforms.uRoadsOn.value = 1;
    scene.add(buildWater(env, hf, lines, terrain.uniforms,lite?28:18), buildIslands(env, hf, lines));
    labels = createLabels(el, hf, (id) => opts.onAction?.(id), opts.avoid, opts.trips, opts.lang);
    const lamps = buildLamps(env, hf, lines, opts.quality);
    const cars = buildCars(env, hf, lines, opts.quality);
    driveCars = cars.update;
    pointLayers.push(lamps.uniforms, cars.uniforms);
    scene.add(lamps.points, cars.group);
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
    const ymd = jstParts(date);
    clouds.uniforms.uCover.value = coverForDay(ymd.year, ymd.month, ymd.day);

    renderer.toneMappingExposure = look.exposure;
    post.bloom.strength = look.bloom;
    post.grade.value = THREE.MathUtils.smoothstep(alt, -6, 8);

    const status: HeroStatus = { minutes, altitude: alt, phase: phaseName(alt, minutes), kelvin: kelvin(alt), moonAge: moon.age };
    const key = `${Math.floor(minutes)}|${status.phase}`;
    if (key !== lastStatus) {
      lastStatus = key;
      opts.onStatus?.(status);
    }
  }

  /* ---------- camera: the view from Shogunzuka, and a flight to the campus ---------- */

  const rotation = createLookRotation();
  const lookDrag = rotation.state;
  const ray = new THREE.Raycaster();
  const resetLook = mountLookControls(el, rotation, (e) => {
    const r = el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), camera);
    if (ray.ray.direction.y > .01) meteors.burst(1);
  },()=>!flight,()=>mode==='campus'||!!VIEW.orbit);

  let mode: HeroMode = 'city';
  let modeSince = 0;
  let flight: {
    to: HeroMode;
    t: number;
    dur: number;
    p0: THREE.Vector3;
    t0: THREE.Vector3;
    p1: THREE.Vector3;
    p2: THREE.Vector3;
    p3: THREE.Vector3;
    /** re-centre the terrain and re-plant the trees for the new view at the top of the arc */
    regrow: boolean;
  } | null = null;
  env.uCampus.value.set(CAMPUS_CENTER.x, CAMPUS_CENTER.z);
  const ORBIT = { radius: 640, height: 150, start: 112 * RAD, speed: 0.03 };
  const pose = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  function cityPose(t: number, out = pose) {
    if (VIEW.orbit) {
      const p = landmarkOrbit(VIEW.orbit,eye,lookDrag.yaw,lookDrag.pitch,groundAt ?? (()=>40),orbitObstruction);
      out.pos.set(p.pos.x,p.pos.y,p.pos.z);
      out.target.set(p.target.x,p.target.y,p.target.z);
      return out;
    }
    const drift = opts.reducedMotion || opts.drift === false ? 0 : Math.sin(t * 0.05) * 0.8;
    const focus=VIEW.focusBearing??VIEW.bearing;
    const framing=THREE.MathUtils.clamp(camera.aspect/1.35,.35,1);
    const b = (focus + (VIEW.bearing-focus)*framing + drift + lookDrag.yaw) * RAD;
    const p = THREE.MathUtils.clamp(VIEW.pitch + lookDrag.pitch, -80, 89) * RAD;
    out.pos.copy(eye);
    out.target.set(eye.x + Math.sin(b) * Math.cos(p) * 1000, eye.y + Math.sin(p) * 1000, eye.z - Math.cos(b) * Math.cos(p) * 1000);
    return out;
  }

  function campusPose(t: number, out = pose) {
    const a = ORBIT.start - (opts.reducedMotion ? 0 : (t - modeSince) * ORBIT.speed) + lookDrag.yaw * RAD;
    out.target.copy(campus).setY(campus.y + 45);
    // A spherical orbit reaches an overhead view without passing through the ground.
    const elevation = THREE.MathUtils.clamp(Math.atan2(ORBIT.height - 45, ORBIT.radius) / RAD + lookDrag.pitch, 5, 89) * RAD;
    const distance = Math.hypot(ORBIT.radius, ORBIT.height - 45);
    const radius = Math.cos(elevation) * distance;
    out.pos.set(campus.x + Math.sin(a) * radius, out.target.y + Math.sin(elevation) * distance, campus.z - Math.cos(a) * radius);
    return out;
  }

  /** Region the sun shadows cover for a view: the city out in front of it. */
  function shadowRegion(_v: ViewDef, e: THREE.Vector3) {
    return new THREE.Box3(new THREE.Vector3(e.x - 7000, 0, e.z - 7000), new THREE.Vector3(e.x + 7000, 900, e.z + 7000));
  }

  /** Fly to the campus, or to one of the viewpoints over the city. */
  function flyTo(target: 'campus' | HeroView, t: number) {
    const to: HeroMode = target === 'campus' ? 'campus' : 'city';
    const nextView = target === 'campus' ? view : target;
    if (!flight && mode === to && (to === 'campus' || nextView === view)) {
      resetLook();
      opts.onMode?.(to,false);
      opts.onMode?.(to,true);
      return;
    }
    const blank = () => ({ pos: new THREE.Vector3(), target: new THREE.Vector3() });
    const from = flight ? { pos: camera.position.clone(), target: lastTarget.clone() } : mode === 'city' ? cityPose(t, blank()) : campusPose(t, blank());
    resetLook();
    const seconds = opts.flightSeconds ?? 5;
    modeSince = t + seconds;
    const viewChanged = nextView !== view;
    const locationChanged = viewChanged || mode !== to || !!flight;
    if (viewChanged) {
      view = nextView;
      VIEW = VIEWS[view];
      eye.copy(eyeOf(VIEW));
      ensureRegionalPhoto?.(view);
    }
    const region =
      to === 'campus'
        ? new THREE.Box3(new THREE.Vector3(campus.x - 2600, 0, campus.z - 2600), new THREE.Vector3(campus.x + 2600, 450, campus.z + 2600))
        : shadowRegion(VIEW, eye);
    shadow.setRegion(region);
    labels?.filter(to === 'campus' ? ['kuas', 'arashiyama', 'atago', 'nijo', 'tower', 'kinkaku'] : null);

    if (opts.reducedMotion) {
      // the stage clock stands still under reduced motion: cut straight to the new view
      if (locationChanged) {
        const center = to === 'campus' ? CAMPUS_CENTER : landscapeCenter(VIEW);
        terrainRecenter?.(center);
        plantTrees?.(center, VIEW.bearing);
        shadow.invalidate();
      }
      flight = null;
      mode = to;
      modeSince = t;
      env.uHighlight.value = to === 'campus' ? 1 : 0;
      opts.onMode?.(to, false);
      opts.onMode?.(to, true);
      return;
    }

    const end = to === 'city' ? cityPose(t, blank()) : campusPose(modeSince, blank());
    const p0 = from.pos;
    const p3 = end.pos;
    // arc higher for longer hops
    const lift = new THREE.Vector3(0, 160 + Math.min(p0.distanceTo(p3) * 0.06, 420), 0);
    flight = {
      to,
      t: 0,
      dur: seconds,
      p0,
      t0: from.target,
      p1: p0.clone().lerp(p3, 0.3).add(lift),
      p2: p0.clone().lerp(p3, 0.75).add(lift.multiplyScalar(0.7)),
      p3,
      regrow: locationChanged,
    };
    opts.onMode?.(to, false);
  }

  const lastTarget = new THREE.Vector3();
  const bez = new THREE.Vector3();
  function placeCamera(t: number, dt: number) {
    rotation.step(dt, opts.reducedMotion ?? false);
    if (flight) {
      flight.t = opts.reducedMotion ? 1 : Math.min(1, flight.t + dt / flight.dur);
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
      if (flight.regrow && flight.t >= 0.5) {
        flight.regrow = false;
        const center = flight.to === 'campus' ? CAMPUS_CENTER : landscapeCenter(VIEW);
        terrainRecenter?.(center);
        plantTrees?.(center, VIEW.bearing);
        shadow.invalidate();
      }
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
    clouds.mesh.position.x = camera.position.x;
    clouds.mesh.position.z = camera.position.z;
    clouds.uniforms.uWind.value.set(t * 0.0009, t * 0.0003);
  }

  const forward = new THREE.Vector3();
  let clock = 0;
  let maxDpr = 1;
  let lowered = false;
  let slow = 0;
  function setResolution(d: number) {
    pixelRatio = d;
    renderer.setPixelRatio(d);
    renderer.setSize(width, height, false);
    post.setSize(width, height, d);
    celestial.starUniforms.uDpr.value = d;
    meteors.spriteUniforms.uDpr.value = d;
    updatePointScale();
  }

  return {
    /** Send a few shooting stars at once. */
    burst: (n: number) => meteors.burst(n),
    /** Fly to the campus or back to the view from Shogunzuka. */
    flyTo: (to: 'campus' | HeroView) => flyTo(to, clock),
    get mode() {
      return flight ? flight.to : mode;
    },
    get view() {
      return view;
    },
    get orbiting() { return !!VIEW.orbit; },
    setElevation(overhead) {
      rotation.stop();
      let base=Math.atan2(ORBIT.height-45,ORBIT.radius)/RAD;
      if ((flight?.to??mode)==='city') {
        if (!VIEW.orbit) return;
        const c=VIEW.orbit.center, y=(groundAt?.(c.x,c.z)??40)+VIEW.orbit.targetHeight;
        base=Math.atan2(eye.y-y,Math.hypot(eye.x-c.x,eye.z-c.z))/RAD;
      }
      lookDrag.pitch=overhead ? 89-base : 0;
    },
    t0: 0,
    resize(w, h, d) {
      maxDpr = d;
      width = w;
      height = h;
      camera.aspect = w / h;
      // about 68° across on a wide screen: Kyoto Tower and Toji on the left to Nijo Castle and Atago on the right
      camera.fov = THREE.MathUtils.clamp((2 * Math.atan(Math.tan(34 * RAD) / camera.aspect)) / RAD, 36, 66);
      camera.updateProjectionMatrix();
      setResolution(Math.min(d, pixelRatio < maxDpr && pixelRatio > 0 && lowered ? pixelRatio : d));
    },
    render(t) {
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      clock = t;
      applyTime(opts.now(), t);
      placeCamera(t, dt);
      if (dt > 0) driveCars?.(dt);
      const half = Math.atan(Math.tan((camera.fov * RAD) / 2) * camera.aspect);
      camera.getWorldDirection(forward);
      const az = Math.atan2(forward.x, -forward.z);
      const top = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)) + camera.fov * RAD / 2;
      meteors.update(t, dt, camera.position, { az, half, top }, env.uStars.value, pxPerM);
      post.render(t);
      labels?.update(camera, width, height);
      // keep the frame rate up on slower devices by rendering fewer pixels
      if (dt > 0) {
        slow = dt > 0.034 ? slow + 1 : Math.max(0, slow - 1);
        if (slow > 45 && pixelRatio > .75) {
          slow = 0;
          lowered = true;
          setResolution(Math.max(.75, pixelRatio - 0.25));
        }
      }
    },
  };
}
