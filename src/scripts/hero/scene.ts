import * as THREE from 'three';
import type { Demo } from '../gl/stage';
import { createEnv } from './env';
import { KYOTO, directionFrom, jstMinutes, jstParts, localSiderealAngle, moonPosition, sunPosition } from './astro';
import { createLook, kelvin, lookAt, phaseName, windowsLit } from './palette';
import type { Box } from './geo';
import { loadBinary, loadJSON, loadTexture, type TerrainMeta } from './data';
import { createHeroLoading, type HeroLoadingCallbacks } from './loading';
import { loadHeightfield, type Heightfield } from './heightfield';
import { buildTerrain, normalTexture } from './terrain';
import { buildCelestial, buildSkyDome } from './sky';
import { createPost } from './post';
import { loadBuildings } from './buildings-data';
import { buildingCutout } from './building-cutout';
import { buildCity, buildCityAsync } from './buildings';
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
import { buildClouds } from './clouds';
import { createCloudBlur } from './cloud-blur';
import {createCloudClock,createCloudMotion} from './cloud-weather';
import { createLookRotation, createViewZoom, mountLookControls, wheelZoomRatio } from './look-controls';
import {createKamoChannel,kamoMask} from './kamo-channel';
import {buildBridges} from './bridges';
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
import { withoutTunnels } from './tunnels';
import {createRegionalLoader,regionAt,type CityRegion} from './regional-loader';
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
const REGIONAL_PHOTOS: { key: 'arashiyama' | 'higashiyama'; views: HeroView[]; seasonal: boolean }[] = [
  // photographed with the woods leafless or in autumn colour
  { key: 'arashiyama', views: ['arashiyama','togetsukyo'], seasonal: true },
  { key: 'higashiyama', views: ['shogunzuka', 'kiyomizu','yasaka'], seasonal: false },
];

export function createHero(
  renderer: THREE.WebGLRenderer,
  el: HTMLElement,
  opts: HeroOptions,
): Demo & { burst(n: number): void; flyTo(to: 'campus' | HeroView): void;setSeason(season:Season):void; setExploring(enabled:boolean):void; setTouchMove(forward:number,side:number,up:number):void; readonly exploring:boolean; readonly mode: HeroMode; readonly view: HeroView; readonly orbiting:boolean } {
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
  scene.add(sky.mesh, celestial.group, meteors.group, clouds.mesh);
  const post = createPost(renderer, scene, camera, opts.quality > 0.75 ? 4 : 2);
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
  let orbitObstruction: ((x:number,z:number)=>number) | undefined;
  let terrainRecenter: ((c: { x: number; z: number }) => void) | null = null;
  let terrainRecenterAsync: ((c: { x: number; z: number }) => void) | null = null;
  let cancelTerrainRecenter: (() => void) | null = null;
  let ensureRegionalPhoto: ((v: HeroView)=>void) | null = null;
  let ensureCityRegion:((center:{x:number;z:number})=>void)|null=null;
  let plantTrees: ((eye: { x: number; z: number }, bearing: number) => void) | null = null;
  let plantTreesAsync: ((eye: { x: number; z: number }, bearing: number) => void) | null = null;
  let cancelTreePlanting: (() => void) | null = null;
  let driveCars: ((dt: number) => void) | null = null;
  /** Cities whose roofs switch to stepped blocks near the camera. */
  const cityLods = new Set<ReturnType<typeof buildCity>>();
  const eyeOf = (v: ViewDef) => new THREE.Vector3(v.eye.x, (groundAt ? groundAt(v.ref.x, v.ref.z) : 40) + v.above, v.eye.z);
  const landscapeCenter = (v: ViewDef) => v.orbit?.center ?? v.eye;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loading = createHeroLoading(opts, 9);
  // A task boundary lets the intro paint and accept input between expensive setup steps.
  const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  (async () => {
    const meta = await loading.track(loadJSON<TerrainMeta>('terrain.json'));
    const wideFile = opts.quality >= .75 && meta.aerialWide.high ? meta.aerialWide.high.file : meta.aerialWide.file;
    const [hf, wide, outer] = await Promise.all([loading.track(loadHeightfield(meta)), loading.track(loadTexture(wideFile, aniso)),
      loading.track(meta.aerialOuter ? loadTexture(opts.quality<.75?meta.aerialOuter.mobile.file:meta.aerialOuter.file,aniso)
        .catch(error=>{console.warn('Outer imagery unavailable; retaining Kyoto imagery',error);return null;}) : Promise.resolve(null))]);
    groundAt = (x, z) => hf.height(x, z);
    eye.copy(eyeOf(VIEW));
    campus.y = hf.height(campus.x, campus.z) + 14;
    const regions = REGIONAL_PHOTOS.flatMap((r) => {
      const m = meta[r.key];
      return m ? [{ ...r, meta: m }] : [];
    });
    await yieldToBrowser();
    const normalFar = normalTexture(hf, meta.far);
    await yieldToBrowser();
    const normalNear = normalTexture(hf, meta.near);
    await yieldToBrowser();
    const regionalNormal = meta.arashiyama ? normalTexture(hf, meta.arashiyama.elevation) : undefined;
    await yieldToBrowser();
    const outerNormal = outer && meta.outer ? normalTexture(hf, meta.outer) : undefined;
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
      photos: [...regions.map((r) => r.meta.box),meta.far.box],
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
    terrainRecenterAsync = center => { void terrain.recenterAsync(center, () => shadow.invalidate()); };
    cancelTerrainRecenter = terrain.cancelRecenter;
    // Warm only the scenic views. Map destinations are prepared when visited,
    // so adding places does not make phones build every terrain mesh at startup.
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 500));
    const pending = PANORAMA_VIEWS.map(id=>VIEWS[id]).filter((v) => v !== VIEW);
    const prepNext = () => {
      if (document.documentElement.classList.contains('hero-intro-open')) { setTimeout(prepNext, 250); return; }
      const v = pending.shift();
      if (!v) return;
      terrain.prepare(landscapeCenter(v));
      idle(prepNext);
    };
    idle(prepNext);
    scene.add(terrain.mesh);
    casts(terrain.mesh);
    shadow.invalidate();
    await yieldToBrowser();
    const waterFiles=[...(meta.arashiyama?[meta.arashiyama.water.file]:[]),'water-kamo.json.gz'];
    const [cityPhoto, buildings, lines, woodlandBytes] = await Promise.all([loading.track(loadTexture(meta.aerialCity.file, aniso)), loading.track(loadBuildings()), loading.track(withoutTunnels(loadLines(waterFiles))), loading.track(loadBinary('woodland.json.gz'))]);
    const channel=createKamoChannel(lines,(x,z)=>hf.height(x,z));
    terrain.setChannel(channel,kamoMask(channel));
    const bridges=buildBridges(env,hf,lines,channel);
    scene.add(bridges.mesh);casts(bridges.mesh);shadow.invalidate();
    await yieldToBrowser();
    const streetGround=Object.create(hf) as Heightfield;
    streetGround.height=bridges.heightAt;
    const woodlandData = JSON.parse(new TextDecoder().decode(woodlandBytes)) as {polygons: Woodland[]};
    const woodlandRaster = buildWoodlandTexture(woodlandData.polygons, meta.aerialWide.box);
    await yieldToBrowser();
    const forestArea = woodlandRaster.contains;
    terrain.uniforms.uWoodland.value = woodlandRaster.texture;
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
    const city = buildCity(env, hf, modeledBuildings, (b) =>
      !replaced(b.x,b.z) && (!lite || b.w * b.d > 90 || b.h > 12 || eyes.some((e) => Math.hypot(b.x - e.x, b.z - e.z) < 3000) || Math.hypot(b.x - campus.x, b.z - campus.z) < 1200),
      opts.quality,
      (b) => kawaramachi.dressed.has(b) || gion.dressed.has(b),
    );
    await yieldToBrowser();
    const builtSize = lite ? 1024 : 2048;
    env.uBuilt.value = buildOcclusion(buildings, BUILDINGS_BOX, builtSize);
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
    const forest = createForest(env, hf, cityPhoto.image as HTMLImageElement, meta.aerialCity.box, opts.quality, [...campusTreeSpots(hf),...cherries], { photo: wide.image as HTMLImageElement, box: meta.aerialWide.box }, (x,z) => buildingsMask(x,z) || outerExcluded(x,z) || rockGarden(x,z) || inariClearing(x,z) || replacesByodoin(x,z) || (roadsAndWater(x,z) && !island(x,z)) || fireClearing(x,z), (x,z) => forestArea(x,z) || island(x,z));
    const forestPhoto=(photo:THREE.Texture,i:number)=>{
      void forest.setRegionalPhoto(photo.image as HTMLImageElement,regions[i].meta.box,regions[i].seasonal)
        .then(()=>shadow.invalidate()).catch(error=>console.warn('Forest photo update failed',error));
    };
    updateForestPhoto=forestPhoto;
    detailedPhotos.forEach((photo,i)=>photo&&forestPhoto(photo,i));
    orbitObstruction = (x,z) => {
      const center=landscapeCenter(VIEW);
      const canopy=Math.hypot(x-center.x,z-center.z)>24 && forest.contains(x,z);
      return hf.height(x,z)+(canopy?24:4);
    };
    forest.plant(landscapeCenter(VIEW), VIEW.bearing);
    await yieldToBrowser();
    plantTrees = forest.plant;
    plantTreesAsync = (eye,bearing) => { void forest.plantAsync(eye,bearing).then(() => shadow.invalidate()); };
    cancelTreePlanting = forest.cancelPlant;
    scene.add(forest.group);
    campusModel = buildCampus(env, hf).mesh;
    scene.add(campusModel);
    casts(campusModel);
    scene.add(city.group, landmarks.mesh);
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
    scene.add(buildWater(env, hf, lines, terrain.uniforms,lite?28:18,channel), buildIslands(env, hf, lines));
    labels = createLabels(el, hf, (id) => opts.onAction?.(id), opts.avoid, opts.trips, opts.lang);
    const lamps = buildLamps(env, streetGround, lines, opts.quality);
    const cars = buildCars(env, streetGround, lines, opts.quality);
    driveCars = cars.update;
    pointLayers.push(lamps.uniforms, cars.uniforms);
    scene.add(lamps.points, cars.group);
    updatePointScale();
    // Neighbouring basins are intentionally absent from the initial transfer. At most
    // one additional city is alive, and switching destinations never queues all four.
    const coreBuilt=env.uBuilt.value;
    let regionalDrive:((dt:number)=>void)|null=null;
    let railDrive:((dt:number)=>void)|null=null;
    void loadBinary('railways.json.gz').then(bytes=>{
      const railways=buildRailways(env,(x,z)=>hf.height(x,z),(JSON.parse(new TextDecoder().decode(bytes)) as {routes:RailwayRoute[]}).routes);
      scene.add(railways.group);railDrive=railways.update;shadow.invalidate();
    }).catch(error=>console.warn('Railway scenery unavailable',error));
    driveCars=(dt)=>{cars.update(dt);regionalDrive?.(dt);railDrive?.(dt);};
    let southOverview:Awaited<ReturnType<typeof buildSouthOverview>>|null=null,detailBox:Box|null=null;
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
    },async(r,data,current)=>{
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
      group.add(buildWater(env,hf,data.lines,terrain.uniforms,lite?36:24,undefined,r.id==='yamashina'));
      group.add(buildIslands(env,hf,data.lines));
      await step();
      if(detailedCampus){
        const campus=buildKameokaCampus(env,hf);group.add(campus);casts(campus);
        if(meta.kameokaCampus)campusNormal=normalTexture(hf,meta.kameokaCampus.elevation);
      }
      await step();
      lamps=buildLamps(env,hf,data.lines,lite ? .4 : .7);group.add(lamps.points);
      traffic=buildCars(env,hf,data.lines,lite ? .25 : .45);group.add(traffic.group);
      await step();
      road=buildRoadField(renderer,data.lines,lite?2048:4096,r.box);
      await step();
      built=buildOcclusion(data.buildings,r.box,builtSize);
      await step();
      mask=createBuildingMask(data.buildings.boxes,data.buildings.polys);
      infrastructure=infrastructureMask(data.lines,r.box);
      await step();
      } catch(error) {
        disposeGroup(group);road?.dispose();built?.dispose();campusNormal?.dispose();
        throw error;
      }
      const detailedCampus=r.id==='kameoka-campus';
      const oldNormal=terrain.uniforms.uRegionalNormal.value,oldNormalBox=terrain.uniforms.uRegionalBox.value.clone(),oldNormalOn=terrain.uniforms.uRegionalOn.value;
      let forestPhotoChanged=false;
      const release=(releaseData=true)=>{
        detailBox=null;southOverview?.setDetailBox(null);
        cityLods.delete(city);
        regionalDrive=null;scene.remove(group);disposeGroup(group);
        for(const layer of [lamps.uniforms,traffic.uniforms]){const i=pointLayers.indexOf(layer);if(i>=0)pointLayers.splice(i,1);}
        terrain.uniforms.uRegionRoadsOn.value=0;
        terrain.uniforms.uRegionRoads.value=wide;
        terrain.setPhoto(regions.length,null);
        env.uBuilt.value=coreBuilt;env.uBuiltBox.value.set(...BUILDINGS_BOX);
        env.uBuiltTexel.value=(BUILDINGS_BOX[2]-BUILDINGS_BOX[0])/builtSize;
        outerExcluded=()=>false;
        if(forestPhotoChanged)void forest.setOuterPhoto(null,r.photo.box)
          .then(()=>shadow.invalidate()).catch(error=>console.warn('Forest photo update failed',error));
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
      terrain.setPhoto(regions.length,data.photo,r.photo.box);
      env.uBuilt.value=built;env.uBuiltBox.value.set(...r.box);
      env.uBuiltTexel.value=(r.box[2]-r.box[0])/builtSize;
      outerExcluded=(x,z)=>mask(x,z)||infrastructure(x,z)||(detailedCampus&&(isKameokaBuilding(x,z)||kameokaClearing(x-KAMEOKA_CENTER.x,z-KAMEOKA_CENTER.z)));
      forestPhotoChanged=true;
      void forest.setOuterPhoto(data.photo.image as HTMLImageElement,r.photo.box)
        .then(()=>shadow.invalidate()).catch(error=>console.warn('Forest photo update failed',error));
      regionalDrive=traffic.update;
      pointLayers.push(lamps.uniforms,traffic.uniforms);updatePointScale();
      scene.add(group);casts(city.group);cityLods.add(city);shadow.invalidate();
      detailBox=r.box;southOverview?.setDetailBox(detailBox);
      } catch(error) {release(false);throw error;}
      return ()=>release();
    },error=>console.warn('Neighbouring Kyoto area unavailable; retaining terrain',error));
    const regionManifest=await loading.track(loadJSON<{regions:CityRegion[]}>('regions.json')
      .catch(error=>{console.warn('Neighbouring Kyoto index unavailable',error);return {regions:[]};}));
    let areaRequest=0;
    ensureCityRegion=center=>{
      let region=regionAt(regionManifest.regions,center);
      if(region?.id==='kameoka'&&meta.kameokaCampus&&Math.hypot(center.x-KAMEOKA_CENTER.x,center.z-KAMEOKA_CENTER.z)<1300)
        region={...region,id:'kameoka-campus',photo:meta.kameokaCampus};
      if(region?.id==='uji'&&meta.byodoin&&Math.hypot(center.x-BYODOIN_CENTER.x,center.z-BYODOIN_CENTER.z)<2000)
        region={...region,id:'uji-detail',photo:meta.byodoin};
      const request=++areaRequest;
      opts.onAreaLoading?.(!!region&&region.id!==regionLoader.id);
      void regionLoader.request(region).finally(()=>{if(request===areaRequest)opts.onAreaLoading?.(false);});
    };
    ensureCityRegion(landscapeCenter(VIEW));
    loading.built();
    idle(()=>{void loadBinary('buildings-south-lod.json.gz').then(async bytes=>{
      const data=JSON.parse(new TextDecoder().decode(bytes)) as {buildings:OverviewBuilding[]};
      southOverview=await buildSouthOverview(env,data.buildings,(x,z)=>hf.height(x,z));
      southOverview.setDetailBox(detailBox);scene.add(southOverview.mesh);
    }).catch(error=>console.warn('Southern overview unavailable',error));});
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
  const zoom = createViewZoom();
  let baseFov = camera.fov;
  const updateZoom = () => { camera.fov = zoom.fov(baseFov); camera.updateProjectionMatrix(); updatePointScale(); };
  const lookDrag = rotation.state;
  let exploring=false,freeBearing=0,freePitch=0,lastInput=performance.now();
  const freePosition=new THREE.Vector3(),freeCenter=new THREE.Vector3();
  const keys=new Set<string>();
  const touchMove={forward:0,side:0,up:0};
  const clearKeys=()=>{ keys.clear(); touchMove.forward=touchMove.side=touchMove.up=0; };
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
    moveExplorer(freePosition,freeBearing+lookDrag.yaw,amount,0,amount*.35,.1,true,groundAt??(()=>40));
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
    const b = (focus + (VIEW.bearing-focus)*framing + drift + lookDrag.yaw) * RAD;
    const p = THREE.MathUtils.clamp(VIEW.pitch + lookDrag.pitch, -80, 89) * RAD;
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
    const fromExplorer=exploring?{pos:camera.position.clone(),target:lastTarget.clone()}:null;
    if(exploring){exploring=false;clearKeys();el.removeAttribute('tabindex');env.uHighlight.value=mode==='campus'?1:0;opts.onExplore?.(false);}
    zoom.reset();
    updateZoom();
    const to: HeroMode = target === 'campus' ? 'campus' : 'city';
    const nextView = target === 'campus' ? view : target;
    ensureCityRegion?.(target==='campus'?CAMPUS_CENTER:landscapeCenter(VIEWS[nextView]));
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
    const now=performance.now(),inputDt=Math.min(.1,(now-lastInput)/1000);lastInput=now;
    if(exploring){
      const pressed=(...codes:string[])=>codes.some(code=>keys.has(code))?1:0;
      const axis=(value:number)=>Math.max(-1,Math.min(1,value));
      moveExplorer(freePosition,freeBearing+lookDrag.yaw,axis(pressed('KeyW','ArrowUp')-pressed('KeyS','ArrowDown')+touchMove.forward),
        axis(pressed('KeyD','ArrowRight')-pressed('KeyA','ArrowLeft')+touchMove.side),axis(pressed('KeyE')-pressed('KeyQ')+touchMove.up),inputDt,!!pressed('ShiftLeft','ShiftRight'),groundAt??(()=>40));
      camera.position.copy(freePosition);const yaw=(freeBearing+lookDrag.yaw)*RAD,pitch=THREE.MathUtils.clamp(freePitch+lookDrag.pitch,-85,85)*RAD;
      lastTarget.set(freePosition.x+Math.sin(yaw)*Math.cos(pitch)*1000,freePosition.y+Math.sin(pitch)*1000,freePosition.z-Math.cos(yaw)*Math.cos(pitch)*1000);
      if(freeCenter.distanceTo(freePosition)>600){
        freeCenter.copy(freePosition);terrainRecenterAsync?.(freePosition);plantTreesAsync?.(freePosition,yaw/RAD);ensureCityRegion?.(freePosition);
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
    let roofsChanged = false;
    for (const c of cityLods) roofsChanged = c.updateLod(camera.position) || roofsChanged;
    if (roofsChanged) shadow.invalidate();
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
    setSeason(value){season=value;},
    setTouchMove(forward,side,up){
      const axis=(value:number)=>exploring&&Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0;
      touchMove.forward=axis(forward);touchMove.side=axis(side);touchMove.up=axis(up);
    },
    setExploring(enabled){
      if(exploring===enabled)return;
      if(enabled){
        flight=null;resetLook();freePosition.copy(camera.position);freeCenter.copy(freePosition);
        const d=lastTarget.clone().sub(camera.position).normalize();freeBearing=Math.atan2(d.x,-d.z)/RAD;freePitch=Math.asin(d.y)/RAD;
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
      // Do not render the unfinished 3D scene behind the opaque opening sequence. Skipping the
      // intro immediately restores partial rendering, while the completed scene still draws once
      // before reporting readiness.
      if (!loading.canDraw && document.documentElement.classList.contains('hero-intro-open')) return;
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      clock = t;
      const date=opts.now();
      applyTime(date, t);
      const cloudSeconds=cloudClock.step(opts.cloudTravelMinutes?.()??0,dt,opts.reducedMotion);
      const cloudFrame=cloudMotion.step(cloudSeconds,dt,clouds.weather.wind,opts.reducedMotion);
      clouds.uniforms.uWind.value.set(cloudFrame.seconds*clouds.weather.wind[0],cloudFrame.seconds*clouds.weather.wind[1]);
      placeCamera(t, dt);
      if (dt > 0) driveCars?.(dt);
      if (dt > 0 && !opts.reducedMotion) aircraft.update(dt);
      const half = Math.atan(Math.tan((camera.fov * RAD) / 2) * camera.aspect);
      camera.getWorldDirection(forward);
      const az = Math.atan2(forward.x, -forward.z);
      const top = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)) + camera.fov * RAD / 2;
      meteors.update(t, dt, camera.position, { az, half, top }, Math.min(1, env.uStars.value), pxPerM);
      cloudBlur.render(cloudFrame.blur,width,height,pixelRatio,()=>post.render(t));
      labels?.update(camera, width, height);
      loading.frame();
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
