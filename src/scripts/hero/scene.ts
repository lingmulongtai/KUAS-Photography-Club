import * as THREE from 'three';
import type { Demo } from '../gl/stage';
import { createEnv } from './env';
import { KYOTO, directionFrom, jstMinutes, jstParts, localSiderealAngle, moonPosition, sunPosition } from './astro';
import { createLook, kelvin, lookAt, phaseName, windowsLit } from './palette';
import type { Box } from './geo';
import { loadBinary, loadJSON, loadTexture, type TerrainMeta } from './data';
import { createHeroLoading, type HeroLoadingCallbacks } from './loading';
import { createFrameQueue } from './frame-queue';
import { loadHeightfield, type Heightfield } from './heightfield';
import { buildTerrain, normalTexture } from './terrain';
import {createGroundRelief} from './ground-relief';
import { initialNormals } from './initial-normals';
import { normalMapBytes } from './normal-map';
import { applySouthernNightLights } from './southern-night-lights';
import { buildCelestial, buildSkyDome } from './sky';
import { createPost } from './post';
import { createPanoramaCity } from './panorama-city';
import { loadBuildings } from './buildings-data';
import { buildingCutout } from './building-cutout';
import { buildCity, buildCityAsync } from './buildings';
import { SHADOW_LAYER, createSunShadow } from './shadow';
import { buildLamps } from './lights';
import { buildCars } from './cars';
import { buildRoadField } from './roads';
import { BUILDINGS_BOX, CAMPUS_CENTER } from './geo';
import { buildBeacons, buildLandmarks } from './landmarks';
import { buildWaterAsync } from './water';
import { createLabels, type HeroTrip } from './labels';
import { createForest } from './trees';
import { buildMeteors } from './meteors';
import { buildCampus, campusTreeSpots } from './campus';
import { buildClouds } from './clouds';
import { createCloudBlur } from './cloud-blur';
import { createCloudHistory } from './cloud-history';
import {createCloudClock,createCloudMotion} from './cloud-weather';
import { createLookRotation, createViewZoom, mountLookControls, wheelZoomRatio } from './look-controls';
import {createKamoChannel,kamoMask} from './kamo-channel';
import {buildBridges} from './bridges';
import { createBuildingMask } from './vegetation-mask';
import type { Woodland } from './woodland';
import { buildWoodlandTexture } from './woodland-texture';
import { decodeTreeCover } from './tree-cover';
import { infrastructureMask } from './forest-infrastructure';
import { buildDaimonji, fireClearing } from './daimonji';
import { landmarkOrbit } from './landmark-orbit';
import { createIntroCameraMotion } from './intro-camera';
import { createSharedPhotoSlot } from './shared-photo';
import { VIEWS, type ViewDef, type HeroView } from './views';
import type { SpotId } from '../../data/spots';
export type { HeroView } from './views';
import { buildOcclusion } from './building-occlusion';
import { buildIslands } from './islands';
import { islandMask } from './island-mask';
import { LINE, loadLines } from './lines-data';
import { withoutTunnels } from './tunnels';
import {createRegionalLoader,regionAt,regionInView,type CityRegion} from './regional-loader';
import {replacesHeianFootprint} from './heian-shrine';
import {replacesNijoFootprint,replacesNijoBox} from './nijo-castle';
import {replacesKyotoStation} from './kyoto-station';
import {kawaramachiFacades} from './kawaramachi-facades';
import {gionStreetscape} from './gion-streetscape';
import {buildKameokaCampus,isKameokaBuilding,KAMEOKA_CENTER} from './kameoka-campus';
import {kameokaClearing} from './kameoka-grounds';
import {buildRailways} from './railways';
import {buildAircraft} from './aircraft';
import {buildSouthOverview,type OverviewBuilding} from './south-overview';
import type {RailwayRoute} from './railway-path';
import {createNearbyPhotos,type PhotoSheet} from './nearby-photos';
import {moveExplorer} from './free-explore';
import {climateOf,seasonWeights,type Season} from './seasons';
import {buildSnow} from './season-effects';
import {philosopherCherries} from './philosopher-cherries';
import {buildKiyomizuBeam} from './kiyomizu-beam';
import {replacesInari,inariClearing} from './fushimi-inari';
import {replacesByodoin,BYODOIN_CENTER} from './byodoin';

export interface HeroStatus {
  minutes: number;
  altitude: number;
  phase: string;
  kelvin: number | null;
  moonAge: number;
}

export interface HeroOptions extends HeroLoadingCallbacks {
  lang?: 'ja' | 'en';
  /** Date to render for this frame. */
  now: () => Date;
  /** Cumulative minutes explicitly travelled by a time preset, excluding the live clock. */
  cloudTravelMinutes?:()=>number;
  quality: number;
  trips?: HeroTrip[];
  onStatus?: (s: HeroStatus) => void;
  /** Called once after the final scene has been submitted, including on the fence fallback. */
  onFrameSubmitted?: () => void;
  /** A neighbouring area is loading; all navigation remains available. */
  onAreaLoading?:(loading:boolean)=>void;
  onExplore?:(exploring:boolean)=>void;
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
const REGIONAL_PHOTOS: { key: 'arashiyama' | 'higashiyama'; views: HeroView[] }[] = [
  { key: 'arashiyama', views: ['arashiyama','togetsukyo'] },
  { key: 'higashiyama', views: ['shogunzuka', 'kiyomizu','yasaka'] },
];

export function createHero(
  renderer: THREE.WebGLRenderer,
  el: HTMLElement,
  opts: HeroOptions,
): Demo & { burst(n: number): void; flyTo(to: 'campus' | HeroView): void;setSeason(season:Season):void; setExploring(enabled:boolean):void; setTouchMove(forward:number,side:number,up:number,fast:boolean):void; readonly exploring:boolean; readonly mode: HeroMode; readonly view: HeroView; readonly orbiting:boolean } {
  const env = createEnv();
  const scene = new THREE.Scene();
  // the near plane sits as far out as the closest views allow: depth precision in the city 5 km
  // away depends on it, and too little of it makes neighbouring rooftops flicker
  const camera = new THREE.PerspectiveCamera(40, 1, 20, 60000);
  const aircraft=buildAircraft(env);scene.add(aircraft.mesh);
  const sky = buildSkyDome(env);
  const celestial = buildCelestial(env, opts.quality);
  const meteors = buildMeteors(opts.quality);
  // ?clouds=<seed> pins the visit's weather so a sky can be reproduced in QA
  const cloudSeed=Number(new URLSearchParams(location.search).get('clouds'));
  const clouds = buildClouds(env, Number.isInteger(cloudSeed)&&cloudSeed>0?cloudSeed:undefined, opts.quality, climateOf('auto',jstParts(opts.now()).month));
  const cloudClock=createCloudClock();
  const cloudMotion=createCloudMotion();
  const cloudBlur=createCloudBlur(renderer,camera,clouds.mesh);
  const cloudHistory = createCloudHistory(renderer, camera, clouds.mesh);
  renderer.domElement.addEventListener('webglcontextrestored', clouds.restored);
  renderer.domElement.addEventListener('webglcontextrestored', cloudHistory.restored);
  scene.add(sky.mesh, celestial.group, meteors.group, clouds.mesh);
  const post = createPost(renderer, scene, camera, opts.quality > 0.75 ? 4 : 2);
  const frameQueue = createFrameQueue(renderer.getContext());
  renderer.domElement.addEventListener('webglcontextrestored', frameQueue.restored);
  const shadow = createSunShadow(renderer, scene, env, opts.quality > 0.75 ? 4096 : 2048);
  const casts = (o: THREE.Object3D) => o.traverse((c) => (c as THREE.Mesh).isMesh && c.layers.enable(SHADOW_LAYER));
  const look = createLook();

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  const pointLayers: { uScale: { value: number }; uDpr: { value: number } }[] = [];
  const snow=buildSnow(env,opts.quality);scene.add(snow.points);
  let labels: ReturnType<typeof createLabels> | null = null;
  let campusModel: THREE.Mesh | null = null;
  /** Pixels per metre at 1 m distance, so point lights can size themselves. */
  const updatePointScale = () => {
    const k = (height * pixelRatio) / (2 * Math.tan((camera.fov * RAD) / 2));
    for (const u of pointLayers) { u.uScale.value = k; u.uDpr.value = pixelRatio; }
    pxPerM = k;
    snow.uniforms.uSnowScale.value=k;
  };
  let pxPerM = 1000;
  let lastT = 0;
  const campus = new THREE.Vector3(CAMPUS_CENTER.x, 40, CAMPUS_CENTER.z);
  let view: HeroView = 'shogunzuka';
  let mode: HeroMode = 'city';
  let VIEW: ViewDef = VIEWS.shogunzuka;
  const eye = new THREE.Vector3(VIEW.eye.x, 260, VIEW.eye.z);
  let groundAt: ((x: number, z: number) => number) | null = null;
  let travelBounds:Box=[-34000,-19000,13000,20000];
  let orbitObstruction: ((x:number,z:number)=>number) | undefined;
  let terrainRecenter: ((c: { x: number; z: number },anchored?:boolean) => void) | null = null;
  let terrainRecenterAsync: ((c: { x: number; z: number }) => void) | null = null;
  let cancelTerrainRecenter: (() => void) | null = null;
  let ensureRegionalPhoto: ((v: HeroView)=>void) | null = null;
  let ensureCityRegion:((center:{x:number;z:number},bearing?:number)=>void)|null=null;
  let prefetchCityRegion:((center:{x:number;z:number},target?:HeroView)=>void)|null=null;
  let plantTreesAsync: ((eye: { x: number; z: number }, bearing: number) => void) | null = null;
  let followForest: ((eye: { x: number; z: number }, bearing: number) => void) | null = null;
  let cancelTreePlanting: (() => void) | null = null;
  let startGroundRelief: (() => void) | undefined;
  let updateGroundRelief: ((x:number,z:number) => void) | undefined;
  let driveCars: ((dt: number) => void) | null = null;
  /** Cities whose roofs switch to stepped blocks near the camera. */
  const cityLods = new Set<ReturnType<typeof buildCity>>();
  let panoramaCity: ReturnType<typeof createPanoramaCity> | undefined;
  const eyeOf = (v: ViewDef) => new THREE.Vector3(v.eye.x, (groundAt ? groundAt(v.ref.x, v.ref.z) : 40) + v.above, v.eye.z);
  const landscapeCenter = (v: ViewDef) => v.orbit?.center ?? v.eye;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loading = createHeroLoading(opts, 10);
  // A task boundary lets the intro paint and accept input between expensive setup steps.
  const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  (async () => {
    const metadata = loading.track(loadJSON<TerrainMeta>('terrain.json'));
    const prepare = (object: THREE.Object3D) => post.prepare(object).catch(error => {
      console.warn('Panorama shaders will compile on first draw', error);
    });
    const cloudProgram = prepare(clouds.mesh);
    const meta = await metadata;
    const wideFile = opts.quality >= .75 && meta.aerialWide.high ? meta.aerialWide.high.file : meta.aerialWide.file;
    const elevation = loading.track(loadHeightfield(meta));
    const normalGrids = [meta.far, meta.near];
    if (meta.arashiyama) normalGrids.push(meta.arashiyama.elevation);
    if (meta.outer && meta.aerialOuter) normalGrids.push(meta.outer);
    const normals = elevation.then(hf => initialNormals(hf, normalGrids));
    const treeCover = loading.track(loadBinary('tree-cover.bin').then(decodeTreeCover).catch(error => {
      console.warn('Regional tree cover unavailable; using mapped woods and aerial imagery', error);
      return null;
    }));
    // Start once for every viewpoint. The first frame can still proceed on a slow connection.
    const nightLights = Promise.all([normals, loadBinary('southern-night-lights.bin')])
      .then(([maps, bytes]) => { applySouthernNightLights(bytes, [meta.far, meta.outer], maps); return true; })
      .catch(error => { console.warn('Southern road lighting unavailable', error); return false; });
    // The base imagery can fail before normal generation is joined below.
    void normals.catch(() => {});
    const [hf, wide, outer] = await Promise.all([elevation, loading.track(loadTexture(wideFile, aniso)),
      loading.track(meta.aerialOuter ? loadTexture(opts.quality<.75?meta.aerialOuter.mobile.file:meta.aerialOuter.file,aniso)
        .catch(error=>{console.warn('Outer imagery unavailable; retaining Kyoto imagery',error);return null;}) : Promise.resolve(null))]);
    // Download the city while normals and terrain are prepared, rather than
    // starting a second network waterfall after that CPU work.
    const waterFiles=[...(meta.arashiyama?[meta.arashiyama.water.file]:[]),'water-kamo.json.gz'];
    const cityData=Promise.all([loading.track(loadTexture(meta.aerialCity.file, aniso)), loading.track(loadBuildings()), loading.track(withoutTunnels(loadLines(waterFiles))), loading.track(loadBinary('woodland.json.gz'))]);
    // Join the original promise below; attach a handler now for an early failure.
    void cityData.catch(()=>{});
    travelBounds=hf.bounds;
    groundAt = (x, z) => hf.height(x, z);
    eye.copy(eyeOf(VIEW));
    campus.y = hf.height(campus.x, campus.z) + 14;
    const regions = REGIONAL_PHOTOS.flatMap((r) => {
      const m = meta[r.key];
      return m ? [{ ...r, meta: m }] : [];
    });
    const maps = await normals;
    const textureFor = (grid: typeof meta.far) => normalTexture(grid, maps[grid.file]);
    const normalFar = textureFor(meta.far);
    const normalNear = textureFor(meta.near);
    const regionalNormal = meta.arashiyama ? textureFor(meta.arashiyama.elevation) : undefined;
    const outerNormal = outer && meta.outer ? textureFor(meta.outer) : undefined;
    void nightLights.then(ready => {
      if (!ready) return;
      normalFar.needsUpdate = true;
      if (outerNormal) outerNormal.needsUpdate = true;
    });
    await yieldToBrowser();
    const terrain = buildTerrain(env, hf, VIEW.eye, {
      aerialWide: wide,
      aerialWideBox: meta.aerialWide.box,
      aerialCity: null,
      aerialCityBox: meta.aerialCity.box,
      normalFar,
      normalFarBox: meta.far.box,
      normalNear,
      normalNearBox: meta.near.box,
      regional: meta.arashiyama && regionalNormal ? {box:meta.arashiyama.box,normal:regionalNormal} : undefined,
      outer: outer && meta.outer && outerNormal ? {box:meta.outer.box,normal:outerNormal,photo:outer} : undefined,
      // The regional base is composited first; local imagery stays sharper on top.
      photos: [meta.far.box,...regions.map((r) => r.meta.box)],
    }, opts.quality > 0.75 ? 640 : 400);
    const regionalPhotos: (Promise<unknown> | undefined)[] = [];
    // Tennozan and Arashiyama are disjoint, so reuse one sampler to stay within
    // WebGL's minimum texture-unit limit rather than adding a fourth photo slot.
    const sharedPhoto=regions.findIndex(r=>r.key==='arashiyama');
    const sharedSlot=meta.tennozan&&sharedPhoto>=0?createSharedPhotoSlot(
      async()=>({photo:await loadTexture(opts.quality<.75?meta.tennozan!.mobile.file:meta.tennozan!.file,aniso),box:meta.tennozan!.box}),
      value=>terrain.setPhoto(sharedPhoto+1,value?.photo??null,value?.box),
      error=>console.warn('Tennozan imagery unavailable',error),
    ):null;
    ensureRegionalPhoto = (v) => regions.forEach((r, i) => {
      if (!r.views.includes(v) || regionalPhotos[i]) return;
      const file=opts.quality<.75?r.meta.mobile.file:r.meta.file;
      regionalPhotos[i]=loadTexture(file,aniso).then(photo=>{
        if(i===sharedPhoto&&sharedSlot)sharedSlot.setFallback({photo,box:r.meta.box});
        else terrain.setPhoto(i+1,photo,r.meta.box);
      }).catch(error=>{regionalPhotos[i]=undefined;console.warn(`${r.key} imagery unavailable`,error);});
    });
    const osakaPhotos=createNearbyPhotos(
      async()=> (await loadJSON<{photos:PhotoSheet[]}>('photos-osaka.json')).photos,
      async sheet=>({photo:await loadTexture(opts.quality<.75?sheet.mobile.file:sheet.file,aniso),box:sheet.box}),
      photo=>sharedSlot?.setOverride(photo),value=>value.photo.dispose(),
      error=>console.warn('Close Osaka imagery unavailable; retaining regional photo',error),
    );
    const ensurePhotos=ensureRegionalPhoto;
    ensureRegionalPhoto = v => {
      ensurePhotos(v);
      sharedSlot?.select(v==='tennozan'||v==='osakaSkyline');
    };
    ensureRegionalPhoto(view);
    terrainRecenter = terrain.recenter;
    terrainRecenterAsync = center => { void terrain.recenterAsync(center, () => shadow.invalidate()); };
    cancelTerrainRecenter = terrain.cancelRecenter;
    // Prepare other viewpoints only when visited. Warming all six after startup
    // blocks scrolling and evicts earlier meshes from the four-entry terrain cache.
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 500));
    scene.add(terrain.mesh);
    casts(terrain.mesh);
    shadow.invalidate();
    await yieldToBrowser();
    const [cityPhoto, buildings, lines, woodlandBytes] = await cityData;
    const channel=createKamoChannel(lines,(x,z)=>hf.height(x,z));
    terrain.setChannel(channel,kamoMask(channel));
    const bridges=buildBridges(env,hf,lines,channel);
    scene.add(bridges.mesh);casts(bridges.mesh);shadow.invalidate();
    await yieldToBrowser();
    const streetGround=Object.create(hf) as Heightfield;
    streetGround.height=bridges.heightAt;
    const woodlandData = JSON.parse(new TextDecoder().decode(woodlandBytes)) as {polygons: Woodland[]};
    const cover = await treeCover;
    const woodlandRaster = buildWoodlandTexture(woodlandData.polygons, meta.aerialWide.box, cover, renderer.capabilities.maxTextureSize);
    await yieldToBrowser();
    terrain.uniforms.uWoodland.value = woodlandRaster.texture;
    terrain.uniforms.uWoodlandBox.value.set(...woodlandRaster.box);
    terrain.uniforms.uWoodlandOn.value = 1;
    terrain.uniforms.uAerialCity.value = cityPhoto;
    terrain.uniforms.uCityOn.value = 1;
    const lite = opts.quality < 0.75;
    scene.add(buildKiyomizuBeam(env,(x,z)=>hf.height(x,z)));
    const eyes = Object.values(VIEWS).map((v) => v.eye);
    const kawaramachi = kawaramachiFacades(buildings,hf), gion = gionStreetscape(buildings,hf);
    const landmarks = buildLandmarks(env, hf,[...kawaramachi.parts,...gion.parts]);
    const replacements = [{p:landmarks.positions.kyotoTower,w:52,d:40},{p:landmarks.positions.goldenPavilion,w:25,d:25},{p:landmarks.positions.kiyomizuHall,w:40,d:48},{p:landmarks.positions.ryoanji,w:29,d:30},
      {p:landmarks.positions.tojiKondo,w:47,d:32},{p:landmarks.positions.tojiKodo,w:48,d:29},{p:landmarks.positions.tojiJikido,w:42,d:33},
      {p:{x:2095.62,z:-1314.07},w:28,d:17}];
    const replaced = (x:number,z:number) => replacesInari(x,z)||replacesNijoBox(x,z)||replacements.some(({p,w,d})=>Math.abs(x-p.x)<w/2 && Math.abs(z-p.z)<d/2);
    const hojo=landmarks.positions.ryoanji;
    const hojoBox:Box=[hojo.x-14.5,hojo.z-15.5,hojo.x+14.5,hojo.z+10.5];
    const modeledBuildings = {...buildings,polys:buildings.polys.filter(p=>!replacesHeianFootprint(p.ring)&&!replacesNijoFootprint(p.ring)&&!replacesKyotoStation(p.ring)).flatMap(p=>buildingCutout(p,hojoBox,(x,z)=>hf.height(x,z))).filter(p=>{
      let x=0,z=0;for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}
      return !replaced(x/(p.ring.length/2),z/(p.ring.length/2));
    })};
    await yieldToBrowser();
    const city = await buildCityAsync(env, hf, modeledBuildings, (b) =>
      !replaced(b.x,b.z) && (!lite || b.w * b.d > 90 || b.h > 12 || eyes.some((e) => Math.hypot(b.x - e.x, b.z - e.z) < 3000) || Math.hypot(b.x - campus.x, b.z - campus.z) < 1200),
      opts.quality,
      () => true,
      (b) => kawaramachi.dressed.has(b) || gion.dressed.has(b),
      VIEWS.shogunzuka.eye,
    );
    if (!city) throw new Error('Initial city preparation cancelled');
    await yieldToBrowser();
    const builtSize = lite ? 1024 : 2048;
    const coreBuilt = buildOcclusion(buildings, BUILDINGS_BOX, builtSize);
    env.uBuilt.value = coreBuilt;
    env.uBuiltBox.value.set(...BUILDINGS_BOX);
    env.uBuiltTexel.value = (BUILDINGS_BOX[2] - BUILDINGS_BOX[0]) / builtSize;
    env.uBuiltOn.value = 1;
    const buildingsMask = createBuildingMask(buildings.boxes, buildings.polys);
    let outerExcluded:(x:number,z:number)=>boolean=()=>false;
    const forestMaskBox=regions.reduce<Box>((a,{meta:{box:b}})=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),
      Math.max(a[2],b[2]),Math.max(a[3],b[3])],BUILDINGS_BOX);
    const roadsAndWater = infrastructureMask(lines, forestMaskBox);
    await yieldToBrowser();
    scene.add(buildDaimonji(env,hf));
    // the water mask is too coarse for garden islands, so they are tested on their outlines
    const island = islandMask(lines.filter((f) => f.kind === LINE.waterHole).map((f) => f.pts));
    const garden=landmarks.positions.ryoanji;
    const rockGarden=(x:number,z:number)=>Math.abs(x-garden.x)<14 && z-garden.z>10 && z-garden.z<22;
    const waterArea=islandMask(lines.filter(f=>f.kind===LINE.water).map(f=>f.pts));
    const cherries=philosopherCherries((x,z)=>hf.height(x,z),(x,z)=>buildingsMask(x,z)||waterArea(x,z));
    let cultivated:((x:number,z:number)=>boolean)|undefined;
    const forest = createForest(env, hf, opts.quality, [
      { photo: cityPhoto.image as HTMLImageElement, box: meta.aerialCity.box },
      { photo: wide.image as HTMLImageElement, box: meta.aerialWide.box },
      ...(outer && meta.aerialOuter ? [{ photo: outer.image as HTMLImageElement, box: meta.aerialOuter.box }] : []),
    ], (x,z) => woodlandRaster.sample(x,z) || (island(x,z) ? 1 : 0),
    (x,z) => !!cultivated?.(x,z) || buildingsMask(x,z) || outerExcluded(x,z) || rockGarden(x,z) || inariClearing(x,z) ||
      replacesByodoin(x,z) || (roadsAndWater(x,z) && !island(x,z)) || fireClearing(x,z),
    [...campusTreeSpots(hf),...cherries], !cover);
    const refreshForest = () => {
      void forest.refreshExclusions().then(() => shadow.invalidate()).catch(error => console.warn('Forest update failed', error));
    };
    orbitObstruction = (x,z) => {
      const center=landscapeCenter(VIEW);
      const canopy=Math.hypot(x-center.x,z-center.z)>24 && forest.contains(x,z);
      return hf.height(x,z)+(canopy?24:4);
    };
    await forest.plantAsync(landscapeCenter(VIEW), VIEW.bearing);
    const planted = (work: Promise<void> | undefined) => {
      void work?.then(() => shadow.invalidate()).catch(error => console.warn('Forest planting failed',error));
    };
    plantTreesAsync = (eye,bearing) => planted(forest.plantAsync(eye,bearing));
    followForest = (eye,bearing) => planted(forest.follow(eye,bearing));
    cancelTreePlanting = forest.cancelPlant;
    scene.add(forest.group);
    campusModel = buildCampus(env, hf).mesh;
    scene.add(campusModel);
    casts(campusModel);
    scene.add(city.group, landmarks.mesh);
    if (city.overview) scene.add(city.overview);
    panoramaCity = createPanoramaCity(city.overview ? [city.group, city.overview] : [city.group],
      eyeOf(VIEWS.shogunzuka), { position: terrain.position, river: channel.box });
    scene.add(panoramaCity.group);
    casts(city.group);
    cityLods.add(city);
    casts(landmarks.mesh);
    shadow.invalidate();
    const tops = [landmarks.positions.kyotoTower.clone().setY(landmarks.positions.kyotoTower.y + 131.5)];
    scene.add(buildBeacons(env, tops));

    terrain.uniforms.uRoads.value = buildRoadField(renderer, lines, opts.quality > 0.75 ? 4096 : 2048).texture;
    await yieldToBrowser();
    terrain.uniforms.uRoadBox.value.set(...BUILDINGS_BOX);
    terrain.uniforms.uRoadsOn.value = 1;
    const water = await buildWaterAsync(env, hf, lines, terrain.uniforms,lite?28:18,channel,false,()=>true);
    if (water) scene.add(water);
    scene.add(buildIslands(env, hf, lines));
    labels = createLabels(el, hf, (id) => opts.onAction?.(id), opts.avoid, opts.trips, opts.lang);
    const lamps = buildLamps(env, streetGround, lines, opts.quality);
    const cars = buildCars(env, streetGround, lines, opts.quality);
    driveCars = cars.update;
    pointLayers.push(lamps.uniforms, cars.uniforms);
    scene.add(lamps.points, cars.group);
    updatePointScale();
    // Submit the initial city's materials together while the last startup jobs run.
    // Neighbouring cities still compile only when a visitor travels there.
    const scenePrograms = prepare(scene);
    // Neighbouring basins are intentionally absent from the initial transfer. At most
    // one additional city is alive, and switching destinations never queues all four.
    let regionalDrive:((dt:number)=>void)|null=null;
    let railDrive:((dt:number)=>void)|null=null;
    void loadBinary('railways.json.gz').then(bytes=>{
      const railways=buildRailways(env,(x,z)=>hf.height(x,z),(JSON.parse(new TextDecoder().decode(bytes)) as {routes:RailwayRoute[]}).routes);
      scene.add(railways.group);railDrive=railways.update;shadow.invalidate();
    }).catch(error=>console.warn('Railway scenery unavailable',error));
    driveCars=(dt)=>{cars.update(dt);regionalDrive?.(dt);railDrive?.(dt);};
    const overviews:Awaited<ReturnType<typeof buildSouthOverview>>[]=[];
    let detailBox:Box|null=null;
    const setOverviewDetail=(box:Box|null)=>{
      detailBox=box;
      for(const overview of overviews)overview.setDetailBox(box);
    };
    const disposeGroup=(group:THREE.Object3D)=>{
      const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
      group.traverse(o=>{const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;
        geometries.add(mesh.geometry);
        for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material);
        if(mesh.userData.depthMaterial)materials.add(mesh.userData.depthMaterial);
      });
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
    };
    const regionLoader=createRegionalLoader(async(r:CityRegion)=>{
      const results=await Promise.allSettled([loadBuildings(r.buildings.meta,r.buildings.file),
        withoutTunnels(loadLines(undefined,r.lines.file,r.lines.box,r.lines.q)),loadTexture(lite?r.photo.mobile.file:r.photo.file,aniso)] as const);
      const [b,l,p]=results;
      if(b.status==='rejected'||l.status==='rejected'||p.status==='rejected'){
        if(p.status==='fulfilled')p.value.dispose();
        throw results.find(result=>result.status==='rejected')!.reason;
      }
      return {buildings:b.value,lines:l.value,photo:p.value,dispose:()=>p.value.dispose()};
    },async(r,data,current,releasePrevious)=>{
      const group=new THREE.Group();group.name=`region-${r.id}`;
      const step=async()=>{await yieldToBrowser();if(!current())throw new Error('Region superseded');};
      let campusNormal:THREE.Texture|null=null;
      let road!:ReturnType<typeof buildRoadField>,built!:THREE.Texture;
      let city:ReturnType<typeof buildCity>,lamps:ReturnType<typeof buildLamps>,traffic:ReturnType<typeof buildCars>;
      let mask:ReturnType<typeof createBuildingMask>,infrastructure:ReturnType<typeof infrastructureMask>;
      try {
      const detailedCampus=r.id==='kameoka-campus';
      const polys=detailedCampus?data.buildings.polys.filter(p=>{
        let x=0,z=0;for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}return !isKameokaBuilding(x/(p.ring.length/2),z/(p.ring.length/2));
      }):data.buildings.polys;
      const filteredPolys=polys.filter(p=>{let x=0,z=0;for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}return !replacesByodoin(x/(p.ring.length/2),z/(p.ring.length/2));});
      await step();
      const preparedCity=await buildCityAsync(env,hf,{...data.buildings,polys:filteredPolys},b=>!replacesByodoin(b.x,b.z)&&(!detailedCampus||!isKameokaBuilding(b.x,b.z))&&(!lite||b.w*b.d>65||b.h>10),opts.quality,current);
      if(!preparedCity)throw new Error('Region superseded');
      city=preparedCity;
      group.add(city.group);
      await step();
      const wideWater=r.id==='tennozan'||r.id==='osaka';
      const waterEdge=wideWater?(lite?80:60):(lite?36:24);
      const water=await buildWaterAsync(env,hf,data.lines,terrain.uniforms,waterEdge,undefined,r.id==='yamashina'||wideWater,current);
      if(!water)throw new Error('Region superseded');
      group.add(water);
      group.add(buildIslands(env,hf,data.lines));
      await step();
      if(detailedCampus){
        const campus=buildKameokaCampus(env,hf);group.add(campus);casts(campus);
        if(meta.kameokaCampus) {
          const grid = meta.kameokaCampus.elevation;
          campusNormal = normalTexture(grid, await normalMapBytes(hf, grid));
        }
      }
      await step();
      lamps=buildLamps(env,hf,data.lines,lite ? .4 : .7,true);group.add(lamps.points);
      traffic=buildCars(env,hf,data.lines,lite ? .25 : .45);group.add(traffic.group);
      await step();
      road=buildRoadField(renderer,data.lines,lite?2048:4096,r.box);
      await step();
      built=buildOcclusion(data.buildings,r.box,builtSize,coreBuilt);
      await step();
      mask=createBuildingMask(data.buildings.boxes,data.buildings.polys);
      infrastructure=infrastructureMask(data.lines,r.box);
      await step();
      } catch(error) {
        disposeGroup(group);road?.dispose();built?.dispose();campusNormal?.dispose();
        throw error;
      }
      const detailedCampus=r.id==='kameoka-campus';
      releasePrevious();
      const oldNormal=terrain.uniforms.uRegionalNormal.value,oldNormalBox=terrain.uniforms.uRegionalBox.value.clone(),oldNormalOn=terrain.uniforms.uRegionalOn.value;
      let forestMaskChanged=false;
      const release=(releaseData=true)=>{
        setOverviewDetail(null);
        cityLods.delete(city);
        regionalDrive=null;scene.remove(group);disposeGroup(group);
        for(const layer of [lamps.uniforms,traffic.uniforms]){const i=pointLayers.indexOf(layer);if(i>=0)pointLayers.splice(i,1);}
        terrain.uniforms.uRegionRoadsOn.value=0;
        terrain.uniforms.uRegionRoads.value=wide;
        terrain.setPhoto(0,null);
        env.uBuilt.value=coreBuilt;env.uRegionBuiltTexel.value=0;
        outerExcluded=()=>false;
        if(forestMaskChanged)refreshForest();
        road.dispose();built.dispose();if(releaseData)data.dispose();shadow.invalidate();
        if(campusNormal){terrain.uniforms.uRegionalNormal.value=oldNormal;terrain.uniforms.uRegionalBox.value.copy(oldNormalBox);
          terrain.uniforms.uRegionalOn.value=oldNormalOn;campusNormal.dispose();}
      };
      try {
      if(campusNormal && meta.kameokaCampus){terrain.uniforms.uRegionalNormal.value=campusNormal;
        terrain.uniforms.uRegionalBox.value.set(...meta.kameokaCampus.box);terrain.uniforms.uRegionalOn.value=1;}
      terrain.uniforms.uRegionRoads.value=road.texture;
      terrain.uniforms.uRegionRoadBox.value.set(...r.box);
      terrain.uniforms.uRegionRoadsOn.value=1;
      terrain.setPhoto(0,data.photo,r.photo.box);
      env.uBuilt.value=built;env.uRegionBuiltBox.value.set(...r.box);
      env.uRegionBuiltTexel.value=(r.box[2]-r.box[0])/builtSize;
      outerExcluded=(x,z)=>mask(x,z)||infrastructure(x,z)||(detailedCampus&&(isKameokaBuilding(x,z)||kameokaClearing(x-KAMEOKA_CENTER.x,z-KAMEOKA_CENTER.z)));
      forestMaskChanged=true;
      refreshForest();
      regionalDrive=traffic.update;
      pointLayers.push(lamps.uniforms,traffic.uniforms);updatePointScale();
      scene.add(group);casts(city.group);cityLods.add(city);shadow.invalidate();
      setOverviewDetail(r.box);
      } catch(error) {release(false);throw error;}
      return ()=>release();
    },error=>console.warn('Neighbouring Kyoto area unavailable; retaining terrain',error));
    const regionManifest=await loading.track(loadJSON<{regions:CityRegion[]}>('regions.json')
      .catch(error=>{console.warn('Neighbouring Kyoto index unavailable',error);return {regions:[]};}));
    let lastAreaRequest:{id:string|null;retry?:ReturnType<typeof setTimeout>}|undefined;
    let lastPhotoX=0,lastPhotoZ=0;
    ensureCityRegion=(center,bearing)=>{
      let region=bearing===undefined?regionAt(regionManifest.regions,center):regionInView(regionManifest.regions,center,bearing);
      if(region?.id==='kameoka'&&meta.kameokaCampus&&Math.hypot(center.x-KAMEOKA_CENTER.x,center.z-KAMEOKA_CENTER.z)<1300)
        region={...region,id:'kameoka-campus',photo:meta.kameokaCampus};
      if(region?.id==='uji'&&meta.byodoin&&Math.hypot(center.x-BYODOIN_CENTER.x,center.z-BYODOIN_CENTER.z)<2000)
        region={...region,id:'uji-detail',photo:meta.byodoin};
      const id=region?.id??null;
      const changed=lastAreaRequest?.id!==id;
      if(changed || bearing===undefined || (id==='osaka' && Math.hypot(center.x-lastPhotoX,center.z-lastPhotoZ)>=600)){
        sharedSlot?.select(id==='tennozan');
        void osakaPhotos.update(id==='osaka'?center:null);
        lastPhotoX=center.x;lastPhotoZ=center.z;
      }
      if(!changed)return;
      clearTimeout(lastAreaRequest?.retry);
      const request:NonNullable<typeof lastAreaRequest>={id};
      lastAreaRequest=request;
      let delay=5000;
      const attempt=()=>{
        opts.onAreaLoading?.(!!region&&id!==regionLoader.id);
        void regionLoader.request(region).finally(()=>{
          if(request!==lastAreaRequest)return;
          opts.onAreaLoading?.(false);
          if(region && regionLoader.id!==id){
            request.retry=setTimeout(attempt,delay);
            delay=Math.min(30000,delay*2);
          }
        });
      };
      attempt();
    };
    prefetchCityRegion=(center,target)=>{
      const next=target==='tennozan'||target==='osakaSkyline'
        ?regionManifest.regions.find(r=>r.id==='osaka'):regionAt(regionManifest.regions,center);
      if(next)regionLoader.prefetch(next);
      if(next?.id==='osaka')void osakaPhotos.prefetch(center);
    };
    ensureCityRegion(landscapeCenter(VIEW));
    prefetchCityRegion(landscapeCenter(VIEW),view);
    await Promise.all([cloudProgram, scenePrograms]);
    loading.built();
    startGroundRelief=() => idle(() => {
      const ground=(x:number,z:number)=>hf.height(x,z);
      const relief=createGroundRelief(env,terrain.uniforms,ground,(x,z)=>channel.bed(x,z,ground(x,z)),refreshForest);
      scene.add(relief.group);
      cultivated=relief.containsField;
      updateGroundRelief=relief.update;
    });
    for(const area of ['south','osaka','north'])idle(()=>{
      void loadBinary(`buildings-${area}-lod.json.gz`).then(async bytes=>{
        const data=JSON.parse(new TextDecoder().decode(bytes)) as {buildings:OverviewBuilding[];towers?:OverviewBuilding[]};
        const overview=await buildSouthOverview(env,data.buildings,(x,z)=>hf.height(x,z));
        overview.mesh.name=`${area}-overview`;
        overview.setDetailBox(detailBox);overviews.push(overview);scene.add(overview.mesh);
        if(data.towers){
          // Osaka's tallest measured towers exceed the detailed city's height encoding.
          const skyline=await buildSouthOverview(env,data.towers,(x,z)=>hf.height(x,z));
          scene.add(skyline.mesh);
        }
      }).catch(error=>console.warn(`City overview unavailable: ${area}`,error));
    });
  })().catch((err) => { console.error('Kyoto data failed to load', err); loading.fail(err); });

  let lastStatus = '';

  let season:Season='auto';
  function applyTime(date: Date, t: number) {
    const sun = sunPosition(date);
    const alt = sun.altitude / RAD;
    lookAt(alt, look);
    const minutes = jstMinutes(date);
    env.uTime.value = t;
    const weights=seasonWeights(season,jstParts(date).month);
    clouds.setClimate(climateOf(season,jstParts(date).month));
    env.uSpring.value=weights.spring;env.uAutumn.value=weights.autumn;env.uSnow.value=weights.snow;
    snow.points.visible=weights.snow>0;
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
    // moonlight brightens much faster than the lit fraction grows (a full moon is ~10× a half
    // moon): under a full moon only the brighter stars show and the Milky Way fades; with the
    // moon new or down the sky fills with faint stars
    const moonlight = Math.pow(moon.illumination, 2) * moonUp;
    env.uStars.value = dark * (1.3 - 0.65 * moonlight);
    celestial.setSidereal(localSiderealAngle(date, KYOTO.lon));

    renderer.toneMappingExposure = look.exposure;
    // after dusk the threshold drops below the lamps and windows, so every light (the far towns
    // included) glows by its own brightness; by day and at sunset only the brightest highlights pass
    const night = THREE.MathUtils.smoothstep(look.city, .55, 1);
    post.bloom.strength = look.bloom * (1 + .12 * look.city + .7 * night);
    post.bloom.radius = .5 + .18 * look.city;
    post.bloom.threshold = THREE.MathUtils.lerp(.85, .12, night);
    // by day and at sunset the sun and the sky round it glow with all their light, so the setting
    // sun spreads into a big soft glow; at night only the light above the low threshold glows
    post.bloomWhole.value = 1 - night;
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
  const introCamera = createIntroCameraMotion();
  const zoom = createViewZoom();
  let baseFov = camera.fov;
  const updateZoom = () => { camera.fov = zoom.fov(baseFov); camera.updateProjectionMatrix(); updatePointScale(); };
  const lookDrag = rotation.state;
  const stopIntroCamera = () => {
    const offset = introCamera.stop();
    lookDrag.yaw += offset.yaw;
    lookDrag.pitch += offset.pitch;
  };
  // Let manual input take over at the angle the visitor was already seeing.
  const heroControls = el.closest<HTMLElement>('.hero') ?? el;
  heroControls.addEventListener('pointerdown', stopIntroCamera, true);
  heroControls.addEventListener('keydown', event => {
    if (['Enter', ' ', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd', 'q', 'e'].includes(event.key)) stopIntroCamera();
  }, true);
  let exploring=false,freeBearing=0,freePitch=0,lastInput=performance.now(),nextAreaCheck=0;
  const freePosition=new THREE.Vector3(),freeCenter=new THREE.Vector3();
  const keys=new Set<string>();
  const touchMove={forward:0,side:0,up:0,fast:false};
  const clearKeys=()=>{ keys.clear(); touchMove.forward=touchMove.side=touchMove.up=0; touchMove.fast=false; };
  window.addEventListener('blur',clearKeys);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearKeys();});
  el.addEventListener('keydown',e=>{
    if(!exploring||e.ctrlKey||e.metaKey||e.altKey||(e.target as Element).closest('button,a,input,select,textarea'))return;
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){
      e.preventDefault();keys.add(e.code);
    }
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  el.addEventListener('wheel',e=>{
    if(!exploring)return;
    if(e.ctrlKey||e.metaKey) {
      e.preventDefault();
      zoom.pinch(wheelZoomRatio(e.deltaY,e.deltaMode,height));updateZoom();return;
    }
    if((e.target as Element).closest('button,a,input,select,textarea'))return;
    e.preventDefault();const amount=Math.max(-1,Math.min(1,-e.deltaY/160));
    moveExplorer(freePosition,freeBearing+lookDrag.yaw,amount,0,amount*.35,.1,true,groundAt??(()=>40),travelBounds);
  },{passive:false});
  const ray = new THREE.Raycaster();
  const resetLook = mountLookControls(el, rotation, (e) => {
    const r = el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2), camera);
    if (ray.ray.direction.y > .01) meteors.burst(1);
  },()=>!flight,()=>!exploring&&(mode==='campus'||!!VIEW.orbit),(ratio)=>{ zoom.pinch(ratio); updateZoom(); },()=>exploring);

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
  const ORBIT = { radius: 230, height: 165, start: 25 * RAD, speed: 0.03 };
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
    const b = (focus + (VIEW.bearing-focus)*framing + drift + lookDrag.yaw + introCamera.offset.yaw) * RAD;
    const p = THREE.MathUtils.clamp(VIEW.pitch + lookDrag.pitch + introCamera.offset.pitch, -80, 89) * RAD;
    out.pos.copy(eye);
    out.target.set(eye.x + Math.sin(b) * Math.cos(p) * 1000, eye.y + Math.sin(p) * 1000, eye.z - Math.cos(b) * Math.cos(p) * 1000);
    return out;
  }

  function campusPose(t: number, out = pose) {
    const a = ORBIT.start - (opts.reducedMotion ? 0 : (t - modeSince) * ORBIT.speed) + lookDrag.yaw * RAD;
    out.target.copy(campus).setY(campus.y);
    // A spherical orbit reaches an overhead view without passing through the ground.
    const elevation = THREE.MathUtils.clamp(Math.atan2(ORBIT.height, ORBIT.radius) / RAD + lookDrag.pitch, 5, 89) * RAD;
    // Portrait framing keeps all four wings in view. On wide screens the campus sits
    // to the left of its information card rather than disappearing underneath it.
    const framing=Math.max(1,1/Math.max(.45,camera.aspect));
    const distance = Math.hypot(ORBIT.radius, ORBIT.height)*framing;
    const radius = Math.cos(elevation) * distance;
    out.pos.set(campus.x + Math.sin(a) * radius, out.target.y + Math.sin(elevation) * distance, campus.z - Math.cos(a) * radius);
    const offset=THREE.MathUtils.smoothstep(camera.aspect,1.3,1.7)*40;
    out.target.x-=Math.cos(a)*offset;out.target.z-=Math.sin(a)*offset;
    return out;
  }

  /** Region the sun shadows cover for a view: the city out in front of it. */
  function shadowRegion(_v: ViewDef, e: THREE.Vector3) {
    return new THREE.Box3(new THREE.Vector3(e.x - 7000, 0, e.z - 7000), new THREE.Vector3(e.x + 7000, 900, e.z + 7000));
  }

  /** Fly to the campus, or to one of the viewpoints over the city. */
  function flyTo(target: 'campus' | HeroView, t: number) {
    stopIntroCamera();
    const fromExplorer=exploring?{pos:camera.position.clone(),target:lastTarget.clone()}:null;
    if(exploring){exploring=false;clearKeys();el.removeAttribute('tabindex');env.uHighlight.value=mode==='campus'?1:0;opts.onExplore?.(false);}
    zoom.reset();
    updateZoom();
    const to: HeroMode = target === 'campus' ? 'campus' : 'city';
    const nextView = target === 'campus' ? view : target;
    ensureCityRegion?.(target==='campus'?CAMPUS_CENTER:landscapeCenter(VIEWS[nextView]));
    if(target!=='campus')prefetchCityRegion?.(landscapeCenter(VIEWS[nextView]),nextView);
    if (!fromExplorer && !flight && mode === to && (to === 'campus' || nextView === view)) {
      resetLook();
      opts.onMode?.(to,false);
      opts.onMode?.(to,true);
      return;
    }
    cancelTerrainRecenter?.();
    cancelTreePlanting?.();
    const blank = () => ({ pos: new THREE.Vector3(), target: new THREE.Vector3() });
    const from = fromExplorer ?? (flight ? { pos: camera.position.clone(), target: lastTarget.clone() } : mode === 'city' ? cityPose(t, blank()) : campusPose(t, blank()));
    resetLook();
    const seconds = opts.flightSeconds ?? 5;
    modeSince = t + seconds;
    const viewChanged = nextView !== view;
    const locationChanged = viewChanged || mode !== to || !!flight || !!fromExplorer;
    if (viewChanged) {
      view = nextView;
      VIEW = VIEWS[view];
      eye.copy(eyeOf(VIEW));
      ensureRegionalPhoto?.(view);
    }
    const region =
      to === 'campus'
        ? new THREE.Box3(new THREE.Vector3(campus.x - 700, 0, campus.z - 700), new THREE.Vector3(campus.x + 700, 200, campus.z + 700))
        : shadowRegion(VIEW, eye);
    shadow.setRegion(region);
    labels?.filter(to === 'campus' ? ['kuas', 'arashiyama', 'atago', 'nijo', 'tower', 'kinkaku'] : null);

    if (opts.reducedMotion) {
      // the stage clock stands still under reduced motion: cut straight to the new view
      if (locationChanged) {
        const center = to === 'campus' ? CAMPUS_CENTER : landscapeCenter(VIEW);
        terrainRecenter?.(center);
        plantTreesAsync?.(center, VIEW.bearing);
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
    if (opts.reducedMotion) stopIntroCamera();
    else introCamera.step(dt, loading.canDraw && !document.documentElement.classList.contains('hero-intro-open') && !flight && !exploring && mode === 'city' && view === 'shogunzuka', false);
    rotation.step(dt, opts.reducedMotion ?? false);
    const now=performance.now(),inputDt=Math.min(.1,(now-lastInput)/1000);lastInput=now;
    if(exploring){
      const pressed=(...codes:string[])=>codes.some(code=>keys.has(code))?1:0;
      const axis=(value:number)=>Math.max(-1,Math.min(1,value));
      moveExplorer(freePosition,freeBearing+lookDrag.yaw,axis(pressed('KeyW','ArrowUp')-pressed('KeyS','ArrowDown')+touchMove.forward),
        axis(pressed('KeyD','ArrowRight')-pressed('KeyA','ArrowLeft')+touchMove.side),axis(pressed('KeyE')-pressed('KeyQ')+touchMove.up),inputDt,!!pressed('ShiftLeft','ShiftRight')||touchMove.fast,groundAt??(()=>40),travelBounds);
      camera.position.copy(freePosition);const yaw=(freeBearing+lookDrag.yaw)*RAD,pitch=THREE.MathUtils.clamp(freePitch+lookDrag.pitch,-85,85)*RAD;
      lastTarget.set(freePosition.x+Math.sin(yaw)*Math.cos(pitch)*1000,freePosition.y+Math.sin(pitch)*1000,freePosition.z-Math.cos(yaw)*Math.cos(pitch)*1000);
      followForest?.(freePosition,yaw/RAD);
      if(now>=nextAreaCheck){
        ensureCityRegion?.(freePosition,yaw/RAD);
        nextAreaCheck=now+250;
      }
      if(freeCenter.distanceTo(freePosition)>600){
        freeCenter.copy(freePosition);terrainRecenterAsync?.(freePosition);
        prefetchCityRegion?.({x:freePosition.x+Math.sin(yaw)*1200,z:freePosition.z-Math.cos(yaw)*1200});
        shadow.setRegion(shadowRegion(VIEW,freePosition));
      }
    }else if (flight) {
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
        plantTreesAsync?.(center, VIEW.bearing);
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
    updateGroundRelief?.(camera.position.x,camera.position.z);
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
    let roofsChanged = false;
    const panorama = mode === 'city' && view === 'shogunzuka' && !flight && !exploring && camera.fov >= baseFov * .82;
    for (const c of cityLods) roofsChanged = c.updateLod(camera.position, panorama ? pxPerM : 0) || roofsChanged;
    if (roofsChanged) shadow.invalidate();
  }

  const forward = new THREE.Vector3();
  let clock = 0;
  let maxDpr = 1;
  let lowered = false;
  let slow = 0;
  let firstDrawAt: number | undefined;
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
    setSeason(value){season=value;},
    setTouchMove(forward,side,up,fast){
      const axis=(value:number)=>exploring&&Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0;
      touchMove.forward=axis(forward);touchMove.side=axis(side);touchMove.up=axis(up);touchMove.fast=exploring&&fast;
    },
    setExploring(enabled){
      if(exploring===enabled)return;
      stopIntroCamera();
      if(enabled){
        flight=null;resetLook();freePosition.copy(camera.position);freeCenter.copy(freePosition);
        terrainRecenter?.(freePosition,true);shadow.invalidate();
        const d=lastTarget.clone().sub(camera.position).normalize();freeBearing=Math.atan2(d.x,-d.z)/RAD;freePitch=Math.asin(d.y)/RAD;
        ensureCityRegion?.(freePosition,freeBearing);nextAreaCheck=performance.now()+250;
        exploring=true;env.uHighlight.value=1;el.tabIndex=0;el.focus({preventScroll:true});opts.onExplore?.(true);
      }else flyTo(mode==='campus'?'campus':view,clock);
    },
    get exploring(){return exploring;},
    get mode() {
      return flight ? flight.to : mode;
    },
    get view() {
      return view;
    },
    get orbiting() { return !!VIEW.orbit; },
    t0: 0,
    resize(w, h, d) {
      maxDpr = d;
      width = w;
      height = h;
      camera.aspect = w / h;
      // about 68° across on a wide screen: Kyoto Tower and Toji on the left to Nijo Castle and Atago on the right
      baseFov = THREE.MathUtils.clamp((2 * Math.atan(Math.tan(34 * RAD) / camera.aspect)) / RAD, 36, 66);
      updateZoom();
      setResolution(Math.min(d, pixelRatio < maxDpr && pixelRatio > 0 && lowered ? pixelRatio : d));
    },
    render(t) {
      // The poster covers startup. Avoid rendering an invisible, incomplete scene
      // while the page is already usable; draw once after the complete scene is built.
      if (!loading.canDraw || !frameQueue.available()) return;
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      clock = t;
      const date=opts.now();
      applyTime(date, t);
      const travel = opts.cloudTravelMinutes?.() ?? 0;
      const cloudSeconds=cloudClock.step(travel,dt,opts.reducedMotion);
      const cloudFrame=cloudMotion.step(cloudSeconds,dt,clouds.weather.wind,opts.reducedMotion);
      clouds.uniforms.uWind.value.set(cloudFrame.seconds*clouds.weather.wind[0],cloudFrame.seconds*clouds.weather.wind[1]);
      placeCamera(t, dt);
      clouds.prepareField(renderer,camera.position);
      if (dt > 0) driveCars?.(dt);
      if (dt > 0 && !opts.reducedMotion) aircraft.update(dt);
      const half = Math.atan(Math.tan((camera.fov * RAD) / 2) * camera.aspect);
      camera.getWorldDirection(forward);
      const az = Math.atan2(forward.x, -forward.z);
      const top = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)) + camera.fov * RAD / 2;
      meteors.update(t, dt, camera.position, { az, half, top }, Math.min(1, env.uStars.value), pxPerM);
      const renderScene = () => post.render(t);
      const draw = () => {
        // An unusually wide view can clip a nearby occluder at the corners of the near plane.
        const nearCorner = camera.near * Math.hypot(1, 1 / camera.projectionMatrix.elements[0], 1 / camera.projectionMatrix.elements[5]);
        if (panoramaCity && mode === 'city' && view === 'shogunzuka' && !flight && !exploring && nearCorner < 100)
          panoramaCity.render(camera, renderScene);
        else renderScene();
      };
      const steadySky = mode === 'city' && view === 'shogunzuka' && !flight && !exploring &&
        cloudFrame.blur[0] === 0 && cloudFrame.blur[1] === 0;
      if (!steadySky) cloudHistory.invalidate();
      if (!steadySky || !cloudHistory.render(Math.round(width * pixelRatio), Math.round(height * pixelRatio),
        clouds.weather, travel, date.getTime(), draw, dt)) {
        cloudBlur.render(cloudFrame.blur, width, height, pixelRatio, draw);
      }
      frameQueue.submitted();
      opts.onFrameSubmitted?.();
      labels?.update(camera, width, height);
      loading.frame();
      if(startGroundRelief){startGroundRelief();startGroundRelief=undefined;}
      clouds.warmField(renderer,camera.position,post.prepare);
      // keep the frame rate up on slower devices by rendering fewer pixels
      if (dt > 0 && pixelRatio > .75) {
        const now = performance.now();
        firstDrawAt ??= now;
        slow = dt > 0.034 ? slow + 1 : Math.max(0, slow - 1);
        // Faster submissions reach 45 samples earlier. Let the opening panorama settle at its requested density.
        const openingPanorama = steadySky && now - firstDrawAt < 8000;
        if (slow > 45 && !openingPanorama) {
          slow = 0;
          lowered = true;
          setResolution(Math.max(.75, pixelRatio - 0.25));
        }
      }
    },
  };
}
