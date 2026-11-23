import * as THREE from 'three';
import type { Demo } from '../gl/stage';
import { createEnv } from './env';
import { KYOTO, directionFrom, jstMinutes, jstParts, localSiderealAngle, moonPosition, sunPosition } from './astro';
import { createLook, kelvin, lookAt, phaseName, windowsLit } from './palette';
import {toLocal,type Box} from './geo';
import {EXPO} from '../../data/kansai-outings';
import { loadBinary, loadJSON, loadTexture, type TerrainMeta } from './data';
import { createHeroLoading, type HeroLoadingCallbacks } from './loading';
import { createFrameQueue } from './frame-queue';
import { loadHeightfield, type Heightfield } from './heightfield';
import { buildTerrain, normalTexture } from './terrain';
import {prepareRegionBuffers} from './region-upload';
import {uploadPhoto} from './upload-photo';
import {createGroundRelief} from './ground-relief';
import { initialNormals } from './initial-normals';
import { normalMapBytes } from './normal-map';
import { applySouthernNightLights } from './southern-night-lights';
import { buildCelestial, buildSkyDome } from './sky';
import { createPost } from './post';
import { createPanoramaCity } from './panorama-city';
import { loadBuildings } from './buildings-data';
import { buildingCutout } from './building-cutout';
import { buildCity, buildCityAsync, buildCitySteps, buildResidentCity, prepareCityMaterials } from './buildings';
import { SHADOW_LAYER, createSunShadow } from './shadow';
import {prepareSteps} from './task-yield';
import { buildLampsSteps,type buildLamps } from './lights';
import { buildCarsSteps,type buildCars } from './cars';
import { buildRoadField } from './roads';
import { BUILDINGS_BOX, CAMPUS_CENTER } from './geo';
import { buildBeacons, buildLandmarks } from './landmarks';
import { biwaSurface, buildWaterAsync, waterSteps } from './water';
import { createLabels, type HeroTrip } from './labels';
import { createForest } from './trees';
import { buildMeteors } from './meteors';
import { buildCampus, campusTreeSpots } from './campus';
import { buildClouds } from './clouds';
import { cloudVolumeScale, createCloudBlur } from './cloud-blur';
import { createCloudHistory } from './cloud-history';
import {createCloudClock,createCloudMotion} from './cloud-weather';
import { createLookRotation, createViewZoom, mountLookControls, wheelZoomRatio } from './look-controls';
import {createKamoChannel,kamoMask} from './kamo-channel';
import {buildBridges} from './bridges';
import {buildTransportSpans,type TransportSpan} from './transport-spans';
import { createBuildingMaskAsync, type createBuildingMask } from './vegetation-mask';
import type { Woodland } from './woodland';
import { buildWoodlandTexture } from './woodland-texture';
import { decodeTreeCover } from './tree-cover';
import { infrastructureMask } from './forest-infrastructure';
import { buildDaimonji, fireClearing } from './daimonji';
import { landmarkOrbit } from './landmark-orbit';
import { createIntroCameraMotion } from './intro-camera';
import { createSharedPhotoSlot } from './shared-photo';
import { VIEWS, flightLift, openingPanorama, viewBelowClouds, type ViewDef, type HeroView } from './views';
import { openingPriorities } from './opening-priority';
import type { SpotId } from '../../data/spots';
export type { HeroView } from './views';
import { buildOcclusion, occlusionFile, occlusionTexture } from './building-occlusion';
import { buildIslands } from './islands';
import { islandMask } from './island-mask';
import { LINE, loadLines } from './lines-data';
import {todaijiClearing} from './todaiji-grounds';
import { withoutTunnels } from './tunnels';
import {createRegionalLoader,regionAt,regionInView,type CityRegion} from './regional-loader';
import {replacesHeianFootprint} from './heian-shrine';
import {replacesNijoFootprint,replacesNijoBox} from './nijo-castle';
import {replacesKyotoStation} from './kyoto-station';
import stationMatches from '../../data/kyoto-station-replacements.json';
import {kawaramachiFacades} from './kawaramachi-facades';
import {gionStreetscape} from './gion-streetscape';
import {buildKameokaCampus,isKameokaBuilding,KAMEOKA_CENTER} from './kameoka-campus';
import {kameokaClearing} from './kameoka-grounds';
import {buildRailways} from './railways';
import {buildAircraft} from './aircraft';
import {distantBasin} from './distant-basin';
import {buildSouthOverview,type OverviewBuilding} from './south-overview';
import type {RailwayRoute} from './railway-path';
import {containsPhoto,createNearbyPhotos,type PhotoSheet} from './nearby-photos';
import {moveExplorer} from './free-explore';
import {climateOf,seasonWeights,type Season} from './seasons';
import {buildSnow} from './season-effects';
import {philosopherCherries} from './philosopher-cherries';
import {buildKiyomizuBeam} from './kiyomizu-beam';
import {replacesInari,inariClearing} from './fushimi-inari';
import {createTrafficView} from './traffic-view';
import {katsuraStation} from './katsura-station';
import {replacesByodoin,BYODOIN_CENTER} from './byodoin';
import {inRing,type Ring} from '../kansai/coordinates';
import {json as kansaiJson} from '../kansai/sources';
import {buildSacredGeometry,sacredMaterial} from '../kansai/sacred-models';
import {sacredForBox,sacredMatcher,type SacredSite} from '../kansai/sacred-sites';

export interface HeroStatus {
  minutes: number;
  altitude: number;
  phase: string;
  kelvin: number | null;
  moonAge: number;
}

export interface HeroOptions extends HeroLoadingCallbacks {
  lang?: 'ja' | 'en';
  requestedOpening?: string | null;
  previousOpening?: string | null;
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
  { key: 'higashiyama', views: ['shogunzuka','inariRidge','kiyomizu','yasaka'] },
];

export function createHero(
  renderer: THREE.WebGLRenderer,
  el: HTMLElement,
  opts: HeroOptions,
): Demo & { burst(n: number): void; flyTo(to: 'campus' | HeroView): void;setSeason(season:Season):void; setLanguage(lang: 'ja' | 'en'): void; setExploring(enabled:boolean):void; setTouchMove(forward:number,side:number,up:number,fast:boolean):void; readonly exploring:boolean; readonly mode: HeroMode; readonly view: HeroView; readonly orbiting:boolean } {
  // Reading shader diagnostic logs synchronously can drain the GPU queue on the first district draw.
  if(import.meta.env.PROD)renderer.debug.checkShaderErrors=false;
  const env = createEnv();
  const scene = new THREE.Scene();
  // Light counts are part of Three's program cache key, including custom terrain shaders.
  const landmarkLights={sun:new THREE.DirectionalLight(0),sky:new THREE.HemisphereLight(0,0)};
  scene.add(landmarkLights.sun,landmarkLights.sky);
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
  const cloudBlur=createCloudBlur(renderer,camera,clouds.mesh,opts.quality);
  const cloudHistory = createCloudHistory(renderer, camera, clouds.mesh);
  renderer.domElement.addEventListener('webglcontextrestored', clouds.restored);
  renderer.domElement.addEventListener('webglcontextrestored', cloudBlur.restored);
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
  let labelLanguage = opts.lang ?? 'ja';
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
  let regional:Awaited<ReturnType<typeof import('./regional-ground').regionalGround>> | undefined;
  const regionalDirection=new THREE.Vector3();
  let activeRegionBox:Box|null=null;
  let regionalCity:Awaited<ReturnType<typeof import('./regional-city').regionalCity>>|undefined;
  const expoAnchor=toLocal(EXPO.lat,EXPO.lon);
  let expo:ReturnType<typeof import('./regional-expo').expoGrounds>|undefined;
  const prepare = (object: THREE.Object3D) => post.prepare(object).catch(error => {
    console.warn('Scene shaders will compile on first draw', error);
  });
  let preparingExpo=false,retryExpoAt=0;
  let updateFireworks:ReturnType<typeof import('./regional-fireworks').regionalFireworks>|undefined;
  let updateBasinLod:(()=>void)|undefined;
  let ensureRegionalGround:(()=>Promise<void>)|undefined;
  let flightRequest=0;
  let travelBounds:Box=[-34000,-19000,13000,20000];
  let orbitObstruction: ((x:number,z:number)=>number) | undefined;
  let terrainRecenter: ((c: { x: number; z: number },anchored?:boolean) => void) | null = null;
  let cancelTerrainRecenter: (() => void) | null = null;
  let ensureRegionalPhoto: ((v: HeroView)=>void) | null = null;
  let ensureCityRegion:((center:{x:number;z:number},bearing?:number)=>Promise<void>|undefined)|null=null;
  let prefetchCityRegion:((center:{x:number;z:number},target?:HeroView)=>void)|null=null;
  let plantTreesAsync: ((eye: { x: number; z: number }, bearing: number) => void) | null = null;
  let followForest: ((eye: { x: number; z: number }, bearing: number) => void) | null = null;
  let cancelTreePlanting: (() => void) | null = null;
  let updateGroundRelief: ((x:number,z:number) => void) | undefined;
  let updateStation: (() => void) | undefined;
  let driveCars: ((dt: number) => void) | null = null;
  let warmRegionalOnInteract: (() => void) | undefined;
  /** Cities whose roofs switch to stepped blocks near the camera. */
  const cityLods = new Set<ReturnType<typeof buildCity>>();
  let panoramaCity: ReturnType<typeof createPanoramaCity> | undefined;
  const eyeOf = (v: ViewDef) => new THREE.Vector3(v.eye.x, (groundAt ? groundAt(v.ref.x, v.ref.z) : 40) + v.above, v.eye.z);
  const currentView = (id: HeroView) => {
    const ref=VIEWS[id].ref;
    return viewBelowClouds(id,groundAt?.(ref.x,ref.z)??40,clouds.weather.base);
  };
  const landscapeCenter = (v: ViewDef) => v.orbit?.center ?? v.eye;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let heroOpened = false;
  let upgradeOrder = 0;
  const postOpenUpgrades: { priority: number; order: number; task: () => Promise<void> }[] = [];
  let runningUpgrades = false;
  const drainPostOpenUpgrades = () => {
    if (!heroOpened || runningUpgrades) return;
    runningUpgrades = true;
    void (async () => {
      try {
        while (postOpenUpgrades.length) {
          let best = 0;
          for (let i = 1; i < postOpenUpgrades.length; i++) {
            const a = postOpenUpgrades[i], b = postOpenUpgrades[best];
            if (a.priority < b.priority || (a.priority === b.priority && a.order < b.order)) best = i;
          }
          const { task } = postOpenUpgrades.splice(best, 1)[0];
          try { await task(); }
          catch (error) { console.warn('Background texture upgrade skipped', error); }
        }
      } finally {
        runningUpgrades = false;
        if (postOpenUpgrades.length) drainPostOpenUpgrades();
      }
    })();
  };
  const schedulePostOpenUpgrade = (task: () => Promise<void>, priority = 1) => {
    postOpenUpgrades.push({ priority, order: upgradeOrder++, task });
    if (heroOpened) drainPostOpenUpgrades();
  };
  const loading = createHeroLoading({
    ...opts,
    onReady: () => {
      heroOpened = true;
      opts.onReady?.();
      setTimeout(drainPostOpenUpgrades, 0);
    },
  }, 16, 1);
  // A task boundary lets the intro paint and accept input between expensive setup steps.
  const yieldToBrowser = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  (async () => {
    // Launch every fixed-path startup download immediately at T=0 in parallel with terrain.json.
    const lite = opts.quality < 0.75;
    const builtSize = lite ? 1024 : 2048;
    const coverageFor=(file:string)=>loadBinary(occlusionFile(file,builtSize)).then(
      bytes=>bytes.length===builtSize*builtSize?bytes:null,()=>null);
    const forestBits=(file:string,lake=false)=>loadBinary('forest-masks/'+file.replace(/\.bin$/,lake?'-lake.bin':'.bin')).catch(()=>null);
    const metadata = loading.track(loadJSON<TerrainMeta>('terrain.json'));
    const cityRegions=loading.track(loadJSON<{regions:CityRegion[]}>('regions.json')
      .catch(error=>{console.warn('Neighbouring Kyoto index unavailable',error);return {regions:[]};}));
    const treeCover = loading.track(loadBinary('tree-cover.bin').then(decodeTreeCover).catch(error => {
      console.warn('Regional tree cover unavailable; using mapped woods and aerial imagery', error);
      return null;
    }));
    const nightLightsBytes = loadBinary('southern-night-lights.bin').catch(error => {
      console.warn('Southern road lighting unavailable', error);
      return null;
    });
    const coreBuildings = loading.track(loadBuildings());
    const woodlandRaw = loading.track(loadBinary('woodland.json.gz'));
    const elevatedData = loadBinary('transport-spans.json.gz');
    const railwaysData = loadBinary('railways.json.gz');
    const cityCoverage = coverageFor('buildings.bin');
    const coreForestBits = forestBits('lines.bin');
    const landmarkCatalogPromise = kansaiJson<{id:string;lon:number;lat:number;rings:Ring[]}[]>('landmarks/index.json').catch(() => []);
    const coreSacredPromise = sacredForBox(BUILDINGS_BOX);
    // A resident skyline and the corresponding detailed streets share one survey decode.
    const buildingCache=new Map<string,ReturnType<typeof loadBuildings>>();
    const loadRegionalBuildings=(region:CityRegion,priority?:RequestPriority)=>{
      const file=region.buildings.file;
      if(region.id!=='south'&&region.id!=='yamashina')return loadBuildings(region.buildings.meta,file,priority);
      let result=buildingCache.get(file);
      if(!result){
        result=loadBuildings(region.buildings.meta,file,priority).catch(error=>{buildingCache.delete(file);throw error;});
        buildingCache.set(file,result);
      }
      return result;
    };
    const fetchSurvey=(id:string,priority?:RequestPriority)=>cityRegions.then(async index=>{
      const region=index.regions.find(r=>r.id===id);
      return region?{region,buildings:await loadRegionalBuildings(region,priority)}:null;
    });
    const overviewFiles = Object.fromEntries((['south','osaka','north','tamba'] as const).map(area => [
      area, loadBinary(`buildings-${area}-lod.json.gz`).catch(error => {
        console.warn(`City overview unavailable: ${area}`, error);
        return null;
      }),
    ])) as Record<'south'|'osaka'|'north'|'tamba', Promise<Uint8Array | null>>;
    for(const pending of [elevatedData,railwaysData])void pending.catch(()=>{});
    const earlyPrograms: Promise<unknown>[] = [
      ...[sky.mesh, celestial.group, meteors.group, snow.points, aircraft.mesh, clouds.mesh, clouds.columnMesh, cloudBlur.compositeMesh, cloudHistory.compositeMesh].map(prepare),
    ];
    const warmProgram = (object: THREE.Object3D) => { earlyPrograms.push(prepare(object)); };
    let eastTexture: Promise<THREE.Texture> | undefined;
    let eastBackdrop: { photo: THREE.Texture; box: Box } | null = null;
    let eastPhotoUpgraded = lite;
    let applyEastBackdrop: ((photo: THREE.Texture, box: Box) => void) | undefined;
    const ensureEastBackdrop = (priority?: RequestPriority) => cityRegions.then(index => {
      const region = index.regions.find(r => r.id === 'yamashina');
      if (!region) return null;
      const progressive = !lite && !heroOpened;
      const file = lite || progressive ? region.photo.mobile.file : region.photo.file;
      eastTexture ??= loadTexture(file, aniso, priority).then(photo => {
        eastBackdrop = { photo, box: region.photo.box };
        applyEastBackdrop?.(photo, region.photo.box);
        if (progressive && !eastPhotoUpgraded) {
          eastPhotoUpgraded = true;
          schedulePostOpenUpgrade(async () => {
            const full = await loadTexture(region.photo.file, aniso, 'low');
            await uploadPhoto(renderer, full, () => true);
            const prev = eastBackdrop?.photo;
            eastBackdrop = { photo: full, box: region.photo.box };
            eastTexture = Promise.resolve(full);
            applyEastBackdrop?.(full, region.photo.box);
            if (prev && prev !== full) prev.dispose();
          }, 0);
        }
        return photo;
      }).catch(error => { eastTexture = undefined; throw error; });
      return eastTexture;
    }).catch(error => { console.warn('Eastern basin imagery unavailable', error); return null; });

    const meta = await metadata;
    const fullWideFile = opts.quality >= .75 && meta.aerialWide.high ? meta.aerialWide.high.file : meta.aerialWide.file;
    const initialWideFile = meta.aerialWide.file;
    const elevation = loading.track(loadHeightfield(meta));
    const normalGrids = [meta.far, meta.near];
    if (meta.arashiyama) normalGrids.push(meta.arashiyama.elevation);
    if (meta.outer && meta.aerialOuter) normalGrids.push(meta.outer);
    const normals = elevation.then(hf => initialNormals(hf, normalGrids));
    const nightLights = Promise.all([normals, nightLightsBytes])
      .then(([maps, bytes]) => {
        if (!bytes) return false;
        applySouthernNightLights(bytes, [meta.far, meta.outer], maps);
        return true;
      })
      .catch(error => { console.warn('Southern road lighting unavailable', error); return false; });
    void normals.catch(() => {});

    // Start all meta-dependent imagery and transport downloads immediately alongside elevation.
    // Load the compact/mobile WebP tier first for fast opening, then upgrade to full resolution after hero:ready.
    const widePromise = loading.track(loadTexture(initialWideFile, aniso));
    const fullOuterFile = lite ? 'kansai/basin-mobile.webp' : 'kansai/basin.webp';
    const initialOuterFile = 'kansai/basin-mobile.webp';
    const outerPromise = loading.track(meta.aerialOuter
      ? loadTexture(initialOuterFile, aniso)
          .catch(error => { console.warn('Outer imagery unavailable; retaining Kyoto imagery', error); return null; })
      : Promise.resolve(null));
    const waterFiles=[...(meta.arashiyama?[meta.arashiyama.water.file]:[]),'water-kamo.json.gz'];
    const atlas=meta.aerialBasin;
    const targetBasinVariant=atlas && (renderer.capabilities.maxTextureSize < 4096 ? atlas.mobile : lite ? atlas.compact : atlas);
    const initialBasinVariant=atlas ? atlas.mobile : undefined;
    const citySheet={id:'city',box:meta.aerialCity.box,uv:[0,0,1,1] as Box};
    const basinPhoto=loading.track(initialBasinVariant
      ? loadTexture(initialBasinVariant.file,aniso).then(texture=>({texture,sheets:initialBasinVariant.sheets,atlas:true})).catch(async()=>{
          return {texture:await loadTexture(meta.aerialCity.file,aniso),sheets:[citySheet],atlas:false};
        })
      : loadTexture(meta.aerialCity.file,aniso).then(texture=>({texture,sheets:[citySheet],atlas:false})));
    const linesPromise = loading.track(withoutTunnels(loadLines(waterFiles)));
    const basinTransport=meta.basinTransport?loadLines(undefined,meta.basinTransport.file,meta.basinTransport.box,meta.basinTransport.q)
      .catch(error=>{console.warn('Basin street network unavailable',error);return [];}):Promise.resolve([]);
    const cityData=Promise.all([basinPhoto, coreBuildings, linesPromise, woodlandRaw]);
    // Join the original promise below; attach a handler now for an early failure.
    void cityData.catch(()=>{});

    const [hf, wide, outer] = await Promise.all([elevation, widePromise, outerPromise]);
    travelBounds=hf.bounds;
    groundAt = (x, z) => hf.height(x, z);
    view=openingPanorama(groundAt,clouds.weather.base,opts.previousOpening??null,opts.requestedOpening??null);
    VIEW=currentView(view);
    const priorities=openingPriorities(VIEW);
    // Start only the surrounding resident surveys actually visible in the opening foreground right away.
    let southSurveyPromise: ReturnType<typeof fetchSurvey> | undefined;
    const getSouthSurvey = (priority?: RequestPriority) => southSurveyPromise ??= fetchSurvey('south', priority);
    let eastSurveyPromise: ReturnType<typeof fetchSurvey> | undefined;
    const getEastSurvey = (priority?: RequestPriority) => eastSurveyPromise ??= fetchSurvey('yamashina', priority);
    let eastFillPromise: ReturnType<typeof loadBuildings> | undefined;
    const getEastFill = (priority?: RequestPriority) => eastFillPromise ??= loadBuildings('buildings-yamashina-basin.json', 'buildings-yamashina-basin.bin', priority);
    const westSurveyPromises: Partial<Record<'otokuni' | 'otokuni-tennozan', Promise<Awaited<ReturnType<typeof loadBuildings>> | null>>> = {};
    const getWestSurvey = (name: 'otokuni' | 'otokuni-tennozan', priority?: RequestPriority) =>
      westSurveyPromises[name] ??= loadBuildings(`buildings-${name}.json`, `buildings-${name}.bin`, priority).catch(error => {
        console.warn(`Western basin survey unavailable: ${name}`, error);
        return null;
      });
    if (priorities.south === 'opening') void getSouthSurvey().catch(() => {});
    if (priorities.yamashina === 'opening') void getEastSurvey().catch(() => {});
    if (priorities.yamashinaBasin === 'opening') void getEastFill().catch(() => {});
    if (priorities.otokuni === 'opening') void getWestSurvey('otokuni');
    if (priorities.otokuniTennozan === 'opening') void getWestSurvey('otokuni-tennozan');
    const openingEastBackdrop = priorities.eastBackdrop === 'opening' ? ensureEastBackdrop() : Promise.resolve(null);
    eye.copy(eyeOf(VIEW));
    if(view!=='shogunzuka')shadow.setRegion(shadowRegion(VIEW,eye));
    campus.y = hf.height(campus.x, campus.z) + 14;
    const regions = REGIONAL_PHOTOS.flatMap((r) => {
      const m = meta[r.key];
      return m ? [{ ...r, meta: m }] : [];
    });
    const maps = await normals;
    await nightLights;
    const textureFor = (grid: typeof meta.far) => normalTexture(grid, maps[grid.file]);
    const normalFar = textureFor(meta.far);
    const normalNear = textureFor(meta.near);
    const regionalNormal = meta.arashiyama ? textureFor(meta.arashiyama.elevation) : undefined;
    const outerNormal = outer && meta.outer ? textureFor(meta.outer) : undefined;
    await yieldToBrowser();
    const basin=await basinPhoto;
    const terrain = buildTerrain(env, hf, VIEW.eye, {
      aerialWide: wide,
      aerialWideBox: meta.aerialWide.box,
      aerialCity: basin.texture,
      sheets: basin.sheets,
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
    let tennozanSlot: ReturnType<typeof createSharedPhotoSlot<Sheet>> | null = null;
    const sharedSlot=meta.tennozan&&sharedPhoto>=0?(tennozanSlot=createSharedPhotoSlot(
      async()=>{
        const progressive=!lite&&!heroOpened;
        const photo=await loadTexture(lite||progressive?meta.tennozan!.mobile.file:meta.tennozan!.file,aniso);
        if(progressive){
          schedulePostOpenUpgrade(async()=>{
            const full=await loadTexture(meta.tennozan!.file,aniso,'low');
            await uploadPhoto(renderer,full,()=>true);
            tennozanSlot?.setChosen({photo:full,box:meta.tennozan!.box});
            photo.dispose();
          },0);
        }
        return {photo,box:meta.tennozan!.box};
      },
      value=>terrain.setPhoto(sharedPhoto+1,value?.photo??null,value?.box),
      error=>console.warn('Tennozan imagery unavailable',error),
    )):null;
    const loadViewRegionalPhotos = (v: HeroView) => {
      const pending: Promise<unknown>[] = [];
      regions.forEach((r, i) => {
        if (!r.views.includes(v)) return;
        let job = regionalPhotos[i];
        if (!job) {
          const progressive=!lite&&!heroOpened;
          const file=lite||progressive?r.meta.mobile.file:r.meta.file;
          job=loadTexture(file,aniso).then(photo=>{
            if(i===sharedPhoto&&sharedSlot)sharedSlot.setFallback({photo,box:r.meta.box});
            else terrain.setPhoto(i+1,photo,r.meta.box);
            if(progressive){
              schedulePostOpenUpgrade(async()=>{
                const full=await loadTexture(r.meta.file,aniso,'low');
                await uploadPhoto(renderer,full,()=>true);
                if(i===sharedPhoto&&sharedSlot)sharedSlot.setFallback({photo:full,box:r.meta.box});
                else terrain.setPhoto(i+1,full,r.meta.box);
                photo.dispose();
              },0);
            }
          }).catch(error=>{regionalPhotos[i]=undefined;console.warn(`${r.key} imagery unavailable`,error);});
          regionalPhotos[i]=job;
        }
        pending.push(job);
      });
      return Promise.all(pending);
    };
    type Sheet={photo:THREE.Texture;box:Box};
    let localPhoto:Sheet|null=null,regionalPhoto:Sheet|null=null;
    const closePhotos=createNearbyPhotos(
      async()=> (await loadJSON<{photos:PhotoSheet[]}>('photos-osaka.json')).photos,
      async sheet=>({photo:await loadTexture(lite?sheet.mobile.file:sheet.file,aniso),box:sheet.box}),
      photo=>{localPhoto=photo;sharedSlot?.setOverride(localPhoto??regionalPhoto);},value=>value.photo.dispose(),
      error=>console.warn('Close transport imagery unavailable; retaining regional photo',error),
      meta.otokuni?[meta.otokuni]:[],
    );
    ensureRegionalPhoto = v => {
      void loadViewRegionalPhotos(v);
      sharedSlot?.select(v==='tennozan');
    };
    const openingRegionalPhoto = loadViewRegionalPhotos(view);
    sharedSlot?.select(view==='tennozan');
    // Queue progressive high-res base terrain upgrades in visual priority order after opening local imagery.
    if (basin.atlas && targetBasinVariant && initialBasinVariant && targetBasinVariant !== initialBasinVariant) {
      schedulePostOpenUpgrade(async () => {
        const full = await loadTexture(targetBasinVariant.file, aniso, 'low');
        await uploadPhoto(renderer, full, () => true);
        terrain.setAerialCity(full, targetBasinVariant.sheets);
      }, 1);
    }
    if (fullWideFile !== initialWideFile) {
      schedulePostOpenUpgrade(async () => {
        const full = await loadTexture(fullWideFile, aniso, 'low');
        await uploadPhoto(renderer, full, () => true);
        terrain.setAerialWide(full);
      }, 2);
    }
    if (outer && fullOuterFile !== initialOuterFile) {
      schedulePostOpenUpgrade(async () => {
        const full = await loadTexture(fullOuterFile, aniso, 'low');
        await uploadPhoto(renderer, full, () => true);
        terrain.setOuterPhoto(full);
      }, 3);
    }
    const inKyoto=(p:{x:number;z:number})=>p.x>=hf.bounds[0] && p.z>=hf.bounds[1] && p.x<=hf.bounds[2] && p.z<=hf.bounds[3];
    terrainRecenter = (center,anchored=false)=>{
      if(inKyoto(center))void terrain.recenterAsync(center,()=>shadow.invalidate(),anchored);
      else terrain.cancelRecenter();
    };
    cancelTerrainRecenter = terrain.cancelRecenter;
    scene.add(terrain.mesh);
    casts(terrain.mesh);
    shadow.invalidate();
    // Compile the heavy terrain shader immediately in the background while JS builds city and forest.
    warmProgram(terrain.mesh);
    let lakeReady:Promise<boolean>|undefined;
    const ensureLake=()=>lakeReady??=biwaSurface(env,terrain.uniforms).then(async lake=>{
      await prepare(lake);
      scene.add(lake);
      return true;
    }).catch(error=>{lakeReady=undefined;console.warn('Lake survey unavailable',error);return false;});
    const openingLake = priorities.biwa === 'opening' ? ensureLake() : Promise.resolve(false);
    loading.step();
    await yieldToBrowser();
    const [, buildings, lines, woodlandBytes] = await cityData;
    const basinLod=distantBasin(env,scene,(x,z)=>hf.height(x,z),prepare);
    basinLod.register(buildings);
    updateBasinLod=()=>{
      const far=basinLod.update(camera.position.x,camera.position.z,pxPerM);
      terrain.setDistant(far && !inKyoto(camera.position));
    };
    const channel=createKamoChannel(lines,(x,z)=>hf.height(x,z));
    terrain.setChannel(channel,kamoMask(channel));
    const bridges=buildBridges(env,hf,lines,channel);
    basinLod.detail.add(bridges.mesh);casts(bridges.mesh);shadow.invalidate();warmProgram(bridges.mesh);
    await yieldToBrowser();
    const streetGround=Object.create(hf) as Heightfield;
    streetGround.height=bridges.heightAt;
    const spans=await elevatedData.then(bytes=>{
      const {paths}=JSON.parse(new TextDecoder().decode(bytes)) as {paths:TransportSpan[]};
      return buildTransportSpans(env,paths,(x,z)=>hf.height(x,z),bridges.bridges);
    }).catch(error=>{console.warn('Mapped elevated transport unavailable',error);return null;});
    if(spans){basinLod.detail.add(spans.group);warmProgram(spans.group);}
    const roadHeight=(x:number,z:number,dx:number,dz:number)=>{
      const mapped=spans?.heightAt(x,z,dx,dz)??-Infinity;
      return Math.max(mapped,bridges.deckAt(x,z,dx,dz));
    };
    const woodlandData = JSON.parse(new TextDecoder().decode(woodlandBytes)) as {polygons: Woodland[]};
    const cover = await treeCover;
    const woodlandRaster = buildWoodlandTexture(woodlandData.polygons, meta.aerialWide.box, cover, renderer.capabilities.maxTextureSize);
    await yieldToBrowser();
    terrain.uniforms.uWoodland.value = woodlandRaster.texture;
    terrain.uniforms.uWoodlandBox.value.set(...woodlandRaster.box);
    terrain.uniforms.uWoodlandOn.value = 1;
    scene.add(buildKiyomizuBeam(env,(x,z)=>hf.height(x,z)));
    const eyes = Object.values(VIEWS).map(v=>v.eye).filter(p=>p.x>=BUILDINGS_BOX[0]-3000 && p.z>=BUILDINGS_BOX[1]-3000 && p.x<=BUILDINGS_BOX[2]+3000 && p.z<=BUILDINGS_BOX[3]+3000);
    const kawaramachi = kawaramachiFacades(buildings,hf), gion = gionStreetscape(buildings,hf);
    const katsura=katsuraStation(buildings.polys,(x,z)=>hf.height(x,z));
    const landmarks = buildLandmarks(env, hf,[...kawaramachi.parts,...gion.parts,...katsura.parts]);
    const landmarkCatalog = await landmarkCatalogPromise;
    const isCatalogLandmark = (s: SacredSite) => landmarkCatalog.some(r =>
      Math.abs(r.lon - s.lon) < 0.008 && Math.abs(r.lat - s.lat) < 0.007 && r.rings.some(ring => inRing([s.lon, s.lat], ring)),
    );
    const kyotoSacredMat = sacredMaterial(env);
    const replacements = [{p:landmarks.positions.kyotoTower,w:52,d:40},{p:landmarks.positions.goldenPavilion,w:25,d:25},{p:landmarks.positions.kiyomizuHall,w:40,d:48},{p:landmarks.positions.ryoanji,w:29,d:30},
      {p:landmarks.positions.tojiKondo,w:47,d:32},{p:landmarks.positions.tojiKodo,w:48,d:29},{p:landmarks.positions.tojiJikido,w:42,d:33},
      {p:{x:2095.62,z:-1314.07},w:28,d:17}];
    const replaced = (x:number,z:number) => replacesInari(x,z)||replacesNijoBox(x,z)||replacements.some(({p,w,d})=>Math.abs(x-p.x)<w/2 && Math.abs(z-p.z)<d/2);
    const sacredExcludedCore = (s: SacredSite) => {
      if (replaced(s.x, s.z) || isCatalogLandmark(s) || replacesByodoin(s.x, s.z)) return true;
      // Keep hand-modeled Kyoto compounds (Heian, Imperial Palace, Nijo, Toji/Yasaka/Kiyomizu pagodas) intact.
      if (s.x >= 2015 && s.x <= 2210 && s.z >= -1495 && s.z <= -1275) return true;
      if (s.x >= 125 && s.x <= 395 && s.z >= -2638 && s.z <= -2175) return true;
      if (s.x >= -1160 && s.x <= -510 && s.z >= -1460 && s.z <= -870) return true;
      for (const id of ['toji', 'yasaka', 'kiyomizu', 'heianTorii'] as const) {
        const p = landmarks.positions[id];
        if (p && Math.hypot(s.x - p.x, s.z - p.z) < 28) return true;
      }
      return false;
    };
    const coreSacred = (await coreSacredPromise).filter(s => !sacredExcludedCore(s));
    const replacesCoreSacred = sacredMatcher(coreSacred);
    const hojo=landmarks.positions.ryoanji;
    const hojoBox:Box=[hojo.x-14.5,hojo.z-15.5,hojo.x+14.5,hojo.z+10.5];
    const modeledBuildings = {...buildings,polys:buildings.polys.filter(p=>!katsura.replaced.has(p)&&!replacesHeianFootprint(p.ring)&&!replacesNijoFootprint(p.ring)&&!replacesKyotoStation(p.ring)).flatMap(p=>buildingCutout(p,hojoBox,(x,z)=>hf.height(x,z))).filter(p=>{
      let x=0,z=0;for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}
      const cx=x/(p.ring.length/2),cz=z/(p.ring.length/2);
      return !replaced(cx,cz)&&!replacesCoreSacred(cx,cz);
    })};
    await yieldToBrowser();
    const city = await buildCityAsync(env, hf, modeledBuildings, (b) =>
      !replaced(b.x,b.z) && !replacesCoreSacred(b.x,b.z) && (!lite || b.w * b.d > 90 || b.h > 12 || eyes.some((e) => Math.hypot(b.x - e.x, b.z - e.z) < 3000) || Math.hypot(b.x - campus.x, b.z - campus.z) < 1200),
      opts.quality,
      () => true,
      (b) => kawaramachi.dressed.has(b) || gion.dressed.has(b),
      VIEWS.shogunzuka.eye,
      new Set([...stationMatches.boxes.map(([i]) => buildings.boxes[i]), ...stationMatches.polys.map(([i]) => buildings.polys[i])]),
    );
    if (!city) throw new Error('Initial city preparation cancelled');
    const coreSacredGeo = buildSacredGeometry(coreSacred, (x, z) => hf.height(x, z));
    if (coreSacredGeo) {
      const sacredMesh = new THREE.Mesh(coreSacredGeo, kyotoSacredMat);
      sacredMesh.name = 'kyoto-sacred-buildings';
      basinLod.detail.add(sacredMesh);
      casts(sacredMesh);
      warmProgram(sacredMesh);
    }
    warmProgram(city.group);
    if (city.overview) warmProgram(city.overview);
    warmProgram(landmarks.mesh);
    warmProgram(landmarks.glazing);
    const streetPrograms=prepareCityMaterials(city.materials,prepare);
    city.fallback.name = 'Station district fallback';
    panoramaCity = createPanoramaCity(city.overview ? [city.group, city.overview] : [city.group],
      eyeOf(VIEWS.shogunzuka), { position: terrain.position, river: channel.box });
    scene.add(panoramaCity.group);
    if(view==='shogunzuka'){
      city.updateLod(eyeOf(VIEW),pxPerM);
      panoramaCity.prepare();
    }
    loading.step();
    await yieldToBrowser();
    const coverage = await cityCoverage;
    const coreBuilt = coverage ? occlusionTexture(coverage, builtSize) : buildOcclusion(buildings, BUILDINGS_BOX, builtSize);
    env.uBuilt.value = coreBuilt;
    env.uBuiltBox.value.set(...BUILDINGS_BOX);
    env.uBuiltTexel.value = (BUILDINGS_BOX[2] - BUILDINGS_BOX[0]) / builtSize;
    env.uBuiltOn.value = 1;
    const buildingsMask = await createBuildingMaskAsync(buildings.boxes, buildings.polys,yieldToBrowser);
    let outerExcluded:(x:number,z:number)=>boolean=()=>false;
    const forestMaskBox=regions.reduce<Box>((a,{meta:{box:b}})=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),
      Math.max(a[2],b[2]),Math.max(a[3],b[3])],BUILDINGS_BOX);
    const roadsAndWater = infrastructureMask(lines, forestMaskBox,await coreForestBits);
    await yieldToBrowser();
    scene.add(buildDaimonji(env,hf));
    // the water mask is too coarse for garden islands, so they are tested on their outlines
    const island = islandMask(lines.filter((f) => f.kind === LINE.waterHole).map((f) => f.pts));
    const garden=landmarks.positions.ryoanji;
    const rockGarden=(x:number,z:number)=>Math.abs(x-garden.x)<14 && z-garden.z>10 && z-garden.z<22;
    const waterArea=islandMask(lines.filter(f=>f.kind===LINE.water).map(f=>f.pts));
    const cherries=philosopherCherries((x,z)=>hf.height(x,z),(x,z)=>buildingsMask(x,z)||waterArea(x,z));
    let cultivated:((x:number,z:number)=>boolean)|undefined;
    const forestTerrain={
      get bounds(){return regional?.bounds??hf.bounds;},
      height:(x:number,z:number)=>regional?regional.ground(x,z):hf.height(x,z),
      normal:hf.normal.bind(hf),
    };
    const forest = createForest(env, forestTerrain, opts.quality, [
      { photo: basin.texture.image as HTMLImageElement, box: meta.aerialCity.box, uv:basin.sheets[0].uv },
      { photo: wide.image as HTMLImageElement, box: meta.aerialWide.box },
      ...(outer && meta.aerialOuter ? [{ photo: outer.image as HTMLImageElement, box: meta.aerialOuter.box }] : []),
    ], (x,z) => {
      const b=woodlandRaster.box;
      if(x>=b[0] && x<b[2] && z>=b[1] && z<b[3])return woodlandRaster.sample(x,z) || (island(x,z)?1:0);
      return regional?.canopy(x,z)??0;
    },
    (x,z) => !!cultivated?.(x,z) || regionalCity?.excludesTree(x,z)===true || todaijiClearing(x,z) || buildingsMask(x,z) || outerExcluded(x,z) || rockGarden(x,z) || inariClearing(x,z) ||
      replacesByodoin(x,z) || (roadsAndWater(x,z) && !island(x,z)) || fireClearing(x,z),
    [...campusTreeSpots(hf),...cherries], !cover);
    let forestRefreshPending=false;
    const refreshForest = () => {
      if(forestRefreshPending)return;
      forestRefreshPending=true;
      queueMicrotask(()=>{
        forestRefreshPending=false;
        void forest.refreshExclusions().then(() => shadow.invalidate()).catch(error => console.warn('Forest update failed', error));
      });
    };
    orbitObstruction = (x,z) => {
      const center=landscapeCenter(VIEW);
      const canopy=Math.hypot(x-center.x,z-center.z)>24 && forest.contains(x,z);
      return hf.height(x,z)+(canopy?24:4);
    };
    // Start initial ground relief (nearby paddies/banks) right after forest setup so it fetches while roads/water build.
    const groundRelief = createGroundRelief(env, terrain.uniforms,
      (x, z) => groundAt ? groundAt(x, z) : hf.height(x, z),
      (x, z) => channel.bed(x, z, hf.height(x, z)),
      refreshForest, prepare, () => Boolean(regional));
    scene.add(groundRelief.group);
    cultivated = groundRelief.containsField;
    updateGroundRelief = groundRelief.update;
    const initialRelief = groundRelief.prepareInitial(VIEW.eye.x, VIEW.eye.z).catch(error => {
      console.warn('Opening ground detail unavailable', error);
    });
    await forest.plantAsync(landscapeCenter(VIEW), VIEW.bearing);
    loading.step();
    const planted = (work: Promise<void> | undefined) => {
      void work?.then(() => shadow.invalidate()).catch(error => console.warn('Forest planting failed',error));
    };
    plantTreesAsync = (eye,bearing) => {if(regional || inKyoto(eye))planted(forest.plantAsync(eye,bearing));};
    followForest = (eye,bearing) => {if(regional || inKyoto(eye))planted(forest.follow(eye,bearing));};
    cancelTreePlanting = forest.cancelPlant;
    scene.add(forest.group);
    warmProgram(forest.group);
    campusModel = buildCampus(env, hf).mesh;
    scene.add(campusModel);
    casts(campusModel);
    warmProgram(campusModel);
    basinLod.detail.add(city.group);
    scene.add(landmarks.mesh,landmarks.glazing);
    const station = landmarks.positions.kyotoStation;
    let stationDetail: Awaited<ReturnType<typeof import('./station-detail').loadStationDetail>> | undefined;
    let stationLoading = false;
    let retryStationAt = 0;
    updateStation = () => {
      const distanceSq = camera.position.distanceToSquared(station);
      if (stationDetail) {
        const group = stationDetail.group;
        const range = group.visible ? 1450 : 1100;
        const visible = distanceSq <= range * range;
        if (visible !== group.visible) {
          group.visible = visible;
          landmarks.showStationFallback(!visible);
          city.fallback.visible = !visible;
          shadow.invalidate();
        }
        if (distanceSq > 2600 * 2600) {
          scene.remove(group);
          stationDetail.dispose();
          stationDetail = undefined;
        }
      } else if (distanceSq < 1250 * 1250 && !stationLoading && performance.now() >= retryStationAt) {
        stationLoading = true;
        void import('./station-detail').then(m => m.loadStationDetail(env, hf, station, lite)).then(detail => {
          stationDetail = detail;
          detail.group.visible = false;
          scene.add(detail.group);
          updateStation?.();
        }).catch(error => {
          retryStationAt = performance.now() + 30000;
          console.warn('Kyoto Station detail failed to load', error);
        }).finally(() => { stationLoading = false; });
      }
    };
    if (city.overview) basinLod.detail.add(city.overview);
    casts(city.group);
    cityLods.add(city);
    casts(landmarks.mesh);
    shadow.invalidate();
    const tops = [landmarks.positions.kyotoTower.clone().setY(landmarks.positions.kyotoTower.y + 131.5)];
    scene.add(buildBeacons(env, tops));

    const transportLines=await basinTransport;
    const roadBox:Box=[...BUILDINGS_BOX];
    if(transportLines.length&&meta.basinTransport)roadBox[3]=meta.basinTransport.box[3];
    const fieldSize=Math.min(renderer.capabilities.maxTextureSize,lite?2048:4096);
    terrain.uniforms.uRoads.value=buildRoadField(renderer,lines.concat(transportLines),fieldSize,roadBox,true).texture;
    await yieldToBrowser();
    terrain.uniforms.uRoadBox.value.set(...roadBox);
    terrain.uniforms.uRoadsOn.value = 1;
    const water = await buildWaterAsync(env, hf, lines, terrain.uniforms,lite?28:18,channel,false,()=>true);
    if (water) { scene.add(water); warmProgram(water); }
    const islands = buildIslands(env, hf, lines);
    scene.add(islands);
    warmProgram(islands);
    labels = createLabels(el, hf, (id) => opts.onAction?.(id), opts.avoid, opts.trips, labelLanguage);
    const lamps = await prepareSteps(buildLampsSteps(env,streetGround,lines,opts.quality));
    const cars = await prepareSteps(buildCarsSteps(env,hf,lines,opts.quality,roadHeight));
    pointLayers.push(lamps.uniforms, cars.uniforms);
    scene.add(lamps.points, cars.group);
    warmProgram(lamps.points);
    warmProgram(cars.group);
    updatePointScale();
    loading.step();
    // Catch any remaining lightweight scene materials after earlier parallel shader prepares.
    const scenePrograms = prepare(scene);
    // Neighbouring basins are intentionally absent from the initial transfer. At most
    // one additional city is alive, and switching destinations never queues all four.
    let regionalDrive:typeof cars.update|null=null;
    let railDrive:((dt:number)=>void)|null=null;
    const railwaysReady = railwaysData.then(bytes=>{
      const routes=(JSON.parse(new TextDecoder().decode(bytes)) as {routes:RailwayRoute[]}).routes;
      const railways=buildRailways(env,(x,z)=>hf.height(x,z),routes,katsura.complete,transportLines,
        transportLines.length?meta.basinTransport?.trackBox:undefined);
      scene.add(railways.group);railDrive=railways.update;shadow.invalidate();
      return prepare(railways.group);
    }).catch(error=>{console.warn('Railway scenery unavailable',error);});
    const trafficView=new THREE.Frustum(),trafficProjection=new THREE.Matrix4(),streetView=createTrafficView();
    driveCars=(dt)=>{
      camera.updateMatrixWorld();
      trafficProjection.copy(camera.projectionMatrix);
      // Include the glow of headlights centred just outside the viewport.
      trafficProjection.elements[0]/=1+24/Math.max(1,width);
      trafficProjection.elements[5]/=1+24/Math.max(1,height);
      streetView.update(camera,trafficProjection);
      trafficView.setFromProjectionMatrix(trafficProjection.multiply(camera.matrixWorldInverse));
      cars.update(dt,trafficView,streetView.contains);regionalDrive?.(dt,trafficView,streetView.contains);railDrive?.(dt);
    };
    const overviews:((region:CityRegion|null)=>void)[]=[];
    let detailRegion:CityRegion|null=null;
    const installOverview=(item:{mesh:THREE.Object3D;setDetailBox(box:Box|null):void},parent:THREE.Object3D=scene)=>{
      const update=(region:CityRegion|null)=>item.setDetailBox(region?.box??null);
      update(detailRegion);overviews.push(update);parent.add(item.mesh);
      return ()=>{
        const i=overviews.indexOf(update);
        if(i>=0)overviews.splice(i,1);
        parent.remove(item.mesh);
        disposeGroup(item.mesh);
      };
    };
    const setOverviewDetail=(region:CityRegion|null)=>{
      detailRegion=region;
      // These two resident surveys are removed footprint by footprint at bake time.
      // Their bounding boxes also contain streets outside the survey.
      activeRegionBox=region && region.id!=='south' && region.id!=='yamashina'?region.box:null;
      for(const update of overviews)update(region);
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
    // Reuse the regional photo slot for the eastern basin between detailed regions.
    // Keep its texture alive while a different region temporarily owns that slot.
    let districtBase:Sheet|null=null;
    applyEastBackdrop=(photo,box)=>{
      if((!detailRegion && !districtBase) || detailRegion?.id==='yamashina')terrain.setPhoto(0,photo,box);
    };
    const loadRegionalPhoto=async(r:CityRegion)=>{
      const progressive=r.id!=='yamashina'&&!lite&&!heroOpened;
      const file=lite||progressive?r.photo.mobile.file:r.photo.file;
      if(r.id!=='yamashina')return {photo:await loadTexture(file,aniso),upgradeFile:progressive?r.photo.file:null};
      const photo=await (eastTexture??=loadTexture(file,aniso).then(loaded=>{
        eastBackdrop={photo:loaded,box:r.photo.box};
        if(!detailRegion && !districtBase)terrain.setPhoto(0,loaded,r.photo.box);
        return loaded;
      }).catch(error=>{eastTexture=undefined;throw error;}));
      return {photo,upgradeFile:null as string|null};
    };
    const regionLoader=createRegionalLoader(async(r:CityRegion)=>{
      const lakeRemainder=r.id==='yamashina' && await ensureLake()?'kansai/yamashina-lake-remainder.json.gz':undefined;
      const results=await Promise.allSettled([loadRegionalBuildings(r),
        withoutTunnels(loadLines(lakeRemainder,r.lines.file,r.lines.box,r.lines.q)),loadRegionalPhoto(r),coverageFor(r.buildings.file),forestBits(r.lines.file,Boolean(lakeRemainder))] as const);
      const [b,l,p,coverage,forest]=results;
      let livePhoto=p.status==='fulfilled'?p.value.photo:null;
      const upgradeFile=p.status==='fulfilled'?p.value.upgradeFile:null;
      const disposePhoto=()=>{if(livePhoto&&r.id!=='yamashina')livePhoto.dispose();};
      if(b.status==='rejected'||l.status==='rejected'||p.status==='rejected'){
        disposePhoto();
        throw results.find(result=>result.status==='rejected')!.reason;
      }
      return {
        buildings:b.value,lines:l.value,photo:p.value.photo,upgradeFile,
        setPhoto(next:THREE.Texture){livePhoto=next;},
        forest:forest.status==='fulfilled'?forest.value:null,
        coverage:coverage.status==='fulfilled'?coverage.value:null,
        dispose:disposePhoto,
      };
    },async(r,data,current,releasePrevious)=>{
      const group=new THREE.Group();group.name=`region-${r.id}`;
      const step=async()=>{
        if(loading.canDraw)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
        else await yieldToBrowser();
        if(!current())throw new Error('Region superseded');
      };
      let campusNormal:THREE.Texture|null=null;
      let road!:ReturnType<typeof buildRoadField>,built!:THREE.Texture;
      let city:ReturnType<typeof buildCity>,lamps:ReturnType<typeof buildLamps>,traffic:ReturnType<typeof buildCars>;
      let mask:ReturnType<typeof createBuildingMask>,infrastructure:ReturnType<typeof infrastructureMask>;
      try {
      const detailedCampus=r.id==='kameoka-campus';
      const regionSacred=(await sacredForBox(r.box)).filter(s=>!replacesByodoin(s.x,s.z)&&!isCatalogLandmark(s)&&(!detailedCampus||!isKameokaBuilding(s.x,s.z)));
      const replacesRegionSacred=sacredMatcher(regionSacred);
      const polys=detailedCampus?data.buildings.polys.filter(p=>{
        let x=0,z=0;for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}return !isKameokaBuilding(x/(p.ring.length/2),z/(p.ring.length/2));
      }):data.buildings.polys;
      const filteredPolys=polys.filter(p=>{let x=0,z=0;for(let i=0;i<p.ring.length;i+=2){x+=p.ring[i];z+=p.ring[i+1];}const cx=x/(p.ring.length/2),cz=z/(p.ring.length/2);return !replacesByodoin(cx,cz)&&!replacesRegionSacred(cx,cz);});
      await step();
      city=await prepareSteps(buildCitySteps(env,hf,{...data.buildings,polys:filteredPolys},b=>!replacesByodoin(b.x,b.z)&&!replacesRegionSacred(b.x,b.z)&&(!detailedCampus||!isKameokaBuilding(b.x,b.z))&&(!lite||r.id==='tennozan'||r.id==='yamashina'||b.w*b.d>65||b.h>10),opts.quality),step);
      group.add(city.group);
      const regionSacredGeo=buildSacredGeometry(regionSacred,(x,z)=>hf.height(x,z));
      if(regionSacredGeo){
        const sacredMesh=new THREE.Mesh(regionSacredGeo,sacredMaterial(env));
        sacredMesh.name=`region-${r.id}-sacred`;
        group.add(sacredMesh);
        casts(sacredMesh);
      }
      await step();
      const wideWater=r.id==='tennozan'||r.id==='osaka';
      const waterEdge=wideWater?(lite?80:60):(lite?36:24);
      const water=await prepareSteps(waterSteps(env,hf,data.lines,terrain.uniforms,waterEdge,undefined,r.id==='yamashina'||wideWater),step);
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
      lamps=await prepareSteps(buildLampsSteps(env,hf,data.lines,lite ? .4 : .7,true),step);group.add(lamps.points);
      traffic=await prepareSteps(buildCarsSteps(env,hf,data.lines,lite ? .25 : .45,roadHeight),step);group.add(traffic.group);
      await step();
      road=buildRoadField(renderer,data.lines,lite?2048:4096,r.box);
      await step();
      const programs=prepare(group);
      built=data.coverage?occlusionTexture(data.coverage,builtSize,coreBuilt):buildOcclusion(data.buildings,r.box,builtSize,coreBuilt);
      await step();
      mask=await createBuildingMaskAsync(data.buildings.boxes,data.buildings.polys,step);
      infrastructure=infrastructureMask(data.lines,r.box,data.forest);
      await programs;
      await prepareRegionBuffers(renderer,camera,group,current);
      await step();
      } catch(error) {
        disposeGroup(group);road?.dispose();built?.dispose();campusNormal?.dispose();
        throw error;
      }
      const detailedCampus=r.id==='kameoka-campus';
      releasePrevious();
      const oldNormal=terrain.uniforms.uRegionalNormal.value,oldNormalBox=terrain.uniforms.uRegionalBox.value.clone(),oldNormalOn=terrain.uniforms.uRegionalOn.value;
      let forestMaskChanged=false,released=false;
      const release=(releaseData=true)=>{
        released=true;
        setOverviewDetail(null);
        cityLods.delete(city);
        regionalDrive=null;scene.remove(group);disposeGroup(group);
        for(const layer of [lamps.uniforms,traffic.uniforms]){const i=pointLayers.indexOf(layer);if(i>=0)pointLayers.splice(i,1);}
        terrain.uniforms.uRegionRoadsOn.value=0;
        terrain.uniforms.uRegionRoads.value=terrain.uniforms.uAerialWide.value;
        terrain.uniforms.uRegionClose.value=0;
        const backdrop=districtBase??eastBackdrop;
        terrain.setPhoto(0,backdrop?.photo??null,backdrop?.box);
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
      if(data.upgradeFile){
        const upgradeFile=data.upgradeFile,initialPhoto=data.photo;
        schedulePostOpenUpgrade(async()=>{
          if(released)return;
          const full=await loadTexture(upgradeFile,aniso,'low');
          if(released){full.dispose();return;}
          await uploadPhoto(renderer,full,()=>!released);
          if(released){full.dispose();return;}
          data.setPhoto(full);
          terrain.setPhoto(0,full,r.photo.box);
          initialPhoto.dispose();
        },0);
      }
      terrain.uniforms.uRegionClose.value=(detailedCampus||r.id==='uji-detail')?1:0;
      env.uBuilt.value=built;env.uRegionBuiltBox.value.set(...r.box);
      env.uRegionBuiltTexel.value=(r.box[2]-r.box[0])/builtSize;
      outerExcluded=(x,z)=>mask(x,z)||infrastructure(x,z)||(detailedCampus&&(isKameokaBuilding(x,z)||kameokaClearing(x-KAMEOKA_CENTER.x,z-KAMEOKA_CENTER.z)));
      forestMaskChanged=true;
      refreshForest();
      regionalDrive=traffic.update;
      pointLayers.push(lamps.uniforms,traffic.uniforms);updatePointScale();
      scene.add(group);casts(city.group);cityLods.add(city);shadow.invalidate();
      setOverviewDetail(r);
      } catch(error) {release(false);throw error;}
      return ()=>release();
    },error=>console.warn('Neighbouring Kyoto area unavailable; retaining terrain',error));
    const regionManifest=await cityRegions;
    const easternBasin=regionManifest.regions.find(r=>r.id==='yamashina');
    const eastBackdropReady=openingEastBackdrop.then(photo=>{
      if(photo && easternBasin && !detailRegion && !districtBase)terrain.setPhoto(0,photo,easternBasin.photo.box);
    });
    let lastAreaRequest:{id:string|null;retry?:ReturnType<typeof setTimeout>}|undefined;
    let lastPhotoX=0,lastPhotoZ=0,lastCloseArea:string|null=null;
    ensureCityRegion=(center,bearing)=>{
      let region=bearing===undefined?regionAt(regionManifest.regions,center):regionInView(regionManifest.regions,center,bearing);
      if(region?.id==='kameoka'&&meta.kameokaCampus&&Math.hypot(center.x-KAMEOKA_CENTER.x,center.z-KAMEOKA_CENTER.z)<1300)
        region={...region,id:'kameoka-campus',photo:meta.kameokaCampus};
      if(region?.id==='uji'&&meta.byodoin&&Math.hypot(center.x-BYODOIN_CENTER.x,center.z-BYODOIN_CENTER.z)<2000)
        region={...region,id:'uji-detail',photo:meta.byodoin};
      const id=region?.id??null;
      const changed=lastAreaRequest?.id!==id;
      const closeArea=meta.otokuni&&containsPhoto(meta.otokuni.box,center)?'otokuni':id==='osaka'?'osaka':null;
      if(changed || closeArea!==lastCloseArea || bearing===undefined || (closeArea && Math.hypot(center.x-lastPhotoX,center.z-lastPhotoZ)>=600)){
        sharedSlot?.select(id==='tennozan');
        void closePhotos.update(closeArea?center:null);
        lastCloseArea=closeArea;
        lastPhotoX=center.x;lastPhotoZ=center.z;
      }
      if(!changed)return;
      clearTimeout(lastAreaRequest?.retry);
      const request:NonNullable<typeof lastAreaRequest>={id};
      lastAreaRequest=request;
      let delay=5000;
      const attempt=()=>{
        opts.onAreaLoading?.(!!region&&id!==regionLoader.id);
        return regionLoader.request(region).finally(()=>{
          if(request!==lastAreaRequest)return;
          opts.onAreaLoading?.(false);
          if(region && regionLoader.id!==id){
            request.retry=setTimeout(attempt,delay);
            delay=Math.min(30000,delay*2);
          }
        });
      };
      return attempt();
    };
    prefetchCityRegion=(center)=>{
      const next=regionAt(regionManifest.regions,center);
      if(next)regionLoader.prefetch(next);
      if(next?.id==='osaka'||(meta.otokuni&&containsPhoto(meta.otokuni.box,center)))void closePhotos.prefetch(center);
    };
    let southSampleRemove: (() => void) | undefined;
    let southOuterRemove: (() => void) | undefined;
    let southOuterBuildings: OverviewBuilding[] | undefined;
    let southResidentInstalled = false;
    let otokuniTennozanMask: ((x: number, z: number) => boolean) | null = null;
    const clearSouthSample = () => {
      southResidentInstalled = true;
      southSampleRemove?.();
      southSampleRemove = undefined;
    };
    const refineSouthOuter = async (mask: (x: number, z: number) => boolean) => {
      otokuniTennozanMask = mask;
      const source = southOuterBuildings;
      if (!source) return;
      southOuterBuildings = undefined;
      const filtered = source.filter(([x, z]) => !mask(x, z));
      const next = await buildSouthOverview(env, filtered, (x, z) => hf.height(x, z));
      next.mesh.name = 'south-overview';
      southOuterRemove?.();
      southOuterRemove = installOverview(next);
    };

    const residentYield = () => loading.canDraw ? new Promise<void>(resolve => requestAnimationFrame(() => resolve())) : yieldToBrowser();
    let residentSouthJob: Promise<boolean> | undefined;
    const ensureResidentSouth = (priority?: RequestPriority) => residentSouthJob ??= getSouthSurvey(priority).then(async survey=>{
      if(!survey)return false;
      const skyline=await buildResidentCity(env,hf,survey.buildings,survey.region.box,residentYield);
      skyline.mesh.name='southern-basin-buildings';
      await prepare(skyline.mesh);
      basinLod.register(survey.buildings);
      installOverview(skyline,basinLod.detail);
      clearSouthSample();
      return true;
    }).catch(error=>{console.warn('Southern survey unavailable; using sampled skyline',error);return false;});
    let residentEastJob: Promise<void> | undefined;
    const ensureResidentEast = (priority?: RequestPriority) => residentEastJob ??= getEastSurvey(priority).then(async survey=>{
      if(!survey)return;
      const skyline=await buildResidentCity(env,hf,survey.buildings,undefined,residentYield);
      skyline.mesh.name='yamashina-survey';
      await prepare(skyline.mesh);
      const update=(region:CityRegion|null)=>{skyline.mesh.visible=region?.id!=='yamashina';};
      basinLod.register(survey.buildings);
      update(detailRegion);overviews.push(update);basinLod.detail.add(skyline.mesh);
    }).catch(error=>console.warn('Yamashina survey unavailable',error));
    let residentEastFillJob: Promise<void> | undefined;
    const ensureResidentEastFill = (priority?: RequestPriority) => residentEastFillJob ??= getEastFill(priority).then(async data=>{
      // These footprints have no detailed counterpart on either side of the ward edge.
      const skyline=await buildResidentCity(env,hf,data,undefined,residentYield);
      skyline.mesh.name='yamashina-basin';
      await prepare(skyline.mesh);
      basinLod.register(data);basinLod.detail.add(skyline.mesh);
    }).catch(error=>console.warn('Yamashina basin outlines unavailable',error));
    const residentWestJobs: Partial<Record<'otokuni' | 'otokuni-tennozan', Promise<((x: number, z: number) => boolean) | null>>> = {};
    const ensureResidentWest = (name: 'otokuni' | 'otokuni-tennozan', priority?: RequestPriority) =>
      residentWestJobs[name] ??= getWestSurvey(name, priority).then(async data=>{
        if(!data)return null;
        const sampledRoofMask=name==='otokuni-tennozan'?await createBuildingMaskAsync(data.boxes,data.polys,residentYield):null;
        const skyline=await buildResidentCity(env,hf,data,undefined,residentYield);
        skyline.mesh.name=name;
        await prepare(skyline.mesh);
        if(name==='otokuni-tennozan'){
          // Only these footprints have a counterpart in the detailed confluence survey.
          // The southern ward rectangle also covers Muko but supplies no houses there.
          const update=(region:CityRegion|null)=>{skyline.mesh.visible=region?.id!=='tennozan';};
          update(detailRegion);overviews.push(update);
        }
        basinLod.register(data);basinLod.detail.add(skyline.mesh);
        if(sampledRoofMask)await refineSouthOuter(sampledRoofMask);
        return sampledRoofMask;
      }).catch(error=>{
        console.warn(`Western basin roofs unavailable: ${name}`,error);
        return null;
      });
    const openingSurveys: Promise<unknown>[] = [];
    if (priorities.south === 'opening') openingSurveys.push(ensureResidentSouth());
    if (priorities.otokuni === 'opening') openingSurveys.push(ensureResidentWest('otokuni'));
    if (priorities.otokuniTennozan === 'opening') openingSurveys.push(ensureResidentWest('otokuni-tennozan'));
    if (priorities.yamashina === 'opening') openingSurveys.push(ensureResidentEast());
    if (priorities.yamashinaBasin === 'opening') openingSurveys.push(ensureResidentEastFill());
    const deferredSurveys: { tier: typeof priorities.south; run: () => Promise<unknown> }[] = [
      { tier: priorities.south, run: () => ensureResidentSouth('low') },
      { tier: priorities.otokuni, run: () => ensureResidentWest('otokuni', 'low') },
      { tier: priorities.otokuniTennozan, run: () => ensureResidentWest('otokuni-tennozan', 'low') },
      { tier: priorities.yamashina, run: () => ensureResidentEast('low') },
      { tier: priorities.yamashinaBasin, run: () => ensureResidentEastFill('low') },
      { tier: priorities.eastBackdrop, run: () => ensureEastBackdrop('low') },
      { tier: priorities.biwa, run: () => ensureLake() },
    ];
    for (const item of deferredSurveys) {
      if (item.tier === 'afterOpen') schedulePostOpenUpgrade(async () => { await item.run(); }, 4);
    }
    const warmDeferredSurveys = () => {
      for (const item of deferredSurveys) {
        if (item.tier !== 'opening') void item.run();
      }
    };
    const openingRegion=ensureCityRegion(landscapeCenter(VIEW));
    prefetchCityRegion(landscapeCenter(VIEW),view);
    const skylinesReady = Promise.all([
      openingRegion, openingRegionalPhoto, eastBackdropReady, openingLake, railwaysReady, initialRelief,
      ...openingSurveys,
      loadOverview('south'), loadOverview('osaka'), loadOverview('north'), loadOverview('tamba'),
    ]).then(() => loading.step());
    const shadersReady = Promise.all([...earlyPrograms, scenePrograms, streetPrograms]).then(() => loading.step());
    await Promise.all([skylinesReady, shadersReady]);
    loading.built();
    let regionalLoad:Promise<void>|undefined;
    ensureRegionalGround=()=>regionalLoad??=import('./regional-ground')
      .then(async({regionalGround})=>{
        const legacy=[BUILDINGS_BOX,...(await cityRegions).regions.map(r=>r.box)];
        return regionalGround(scene,env,hf,aniso,legacy,(base,detail)=>{
          districtBase=base;
          if(!detailRegion){
            const backdrop=base??eastBackdrop;
            terrain.setPhoto(0,backdrop?.photo??null,backdrop?.box);
          }
          regionalPhoto=detail??base;sharedSlot?.setOverride(localPhoto??regionalPhoto);
        },prepare,(photo,needed)=>uploadPhoto(renderer,photo,needed));
      })
      .then(result=>{
        regional=result;
        void import('./regional-fireworks').then(({regionalFireworks})=>{
          updateFireworks=regionalFireworks(scene,env,result.ground,!!opts.reducedMotion,prepare);
        }).catch(error=>console.warn('Regional fireworks unavailable',error));
        // moveExplorer keeps a 500 m safety margin inside its camera bounds.
        const [w,n,e,s]=result.bounds;
        travelBounds=[w-500,n-500,e+500,s+500];
        groundAt=result.ground;
        terrain.uniforms.uTerrainBounds.value.set(...result.bounds);
        terrain.uniforms.uSurveyOn.value=1;
        void Promise.all([cityRegions,import('./regional-city')]).then(([index,module])=>
          module.regionalCity(scene,env,landmarkLights,result.ground,[BUILDINGS_BOX,...index.regions.map(r=>r.box)],lite,prepare,shadow.invalidate)
        ).then(city=>{
          regionalCity=city;
          const p=camera.position;
          const insideCore=p.x>=BUILDINGS_BOX[0]&&p.x<=BUILDINGS_BOX[2]&&p.z>=BUILDINGS_BOX[1]&&p.z<=BUILDINGS_BOX[3];
          if(!insideCore)refreshForest();
        }).catch(error=>console.warn('Regional city index unavailable',error));
      }).catch(error=>{regionalLoad=undefined;console.warn('Regional terrain unavailable',error);});
    // Defer the 10 MB outer five-prefecture ground and off-frustum surveys until interaction or navigation,
    // so opening the initial panorama only fetches and builds what lies ahead of the camera.
    warmRegionalOnInteract = () => {
      warmRegionalOnInteract = undefined;
      warmDeferredSurveys();
      void ensureRegionalGround?.();
    };
    async function loadOverview(area:'south'|'osaka'|'north'|'tamba') {
      try {
        const bytes=await overviewFiles[area];
        if(!bytes)return;
        const data=JSON.parse(new TextDecoder().decode(bytes)) as {buildings:OverviewBuilding[];towers?:OverviewBuilding[];residentCount?:number};
        if(area==='south'){
          const southSample=data.residentCount?data.buildings.slice(0,data.residentCount):[];
          const outerSample=data.residentCount?data.buildings.slice(data.residentCount):data.buildings;
          if(priorities.south==='opening')await ensureResidentSouth();
          if(!southResidentInstalled&&southSample.length){
            const sample=await buildSouthOverview(env,southSample,(x,z)=>hf.height(x,z));
            sample.mesh.name='south-resident-overview';
            if(southResidentInstalled)disposeGroup(sample.mesh);
            else southSampleRemove=installOverview(sample);
          }
          if(priorities.otokuniTennozan==='opening')await ensureResidentWest('otokuni-tennozan');
          const mask=otokuniTennozanMask;
          const outerBuildings=mask?outerSample.filter(([x,z])=>!mask(x,z)):outerSample;
          const overview=await buildSouthOverview(env,outerBuildings,(x,z)=>hf.height(x,z));
          overview.mesh.name='south-overview';
          southOuterRemove=installOverview(overview);
          if(!mask){
            southOuterBuildings=outerSample;
            if(otokuniTennozanMask)await refineSouthOuter(otokuniTennozanMask);
          }
          return;
        }
        const overview=await buildSouthOverview(env,data.buildings,(x,z)=>hf.height(x,z));
        overview.mesh.name=`${area}-overview`;
        installOverview(overview);
        if(data.towers){
          // Osaka's tallest measured towers exceed the detailed city's height encoding.
          const skyline=await buildSouthOverview(env,data.towers,(x,z)=>hf.height(x,z));
          scene.add(skyline.mesh);
        }
      } catch(error){console.warn(`City overview unavailable: ${area}`,error);}
    }
  })().catch((err) => { console.error('Kyoto data failed to load', err); loading.fail(err); });

  let lastStatus = '';

  let season:Season='auto';
  const SUMMER_ZENITH=new THREE.Color('#0a44b8');
  const SUMMER_MID=new THREE.Color('#3288e0');
  const SUMMER_HORIZON=new THREE.Color('#c8e8fa');
  const SUMMER_DUSK_HORIZON=new THREE.Color('#ff8446');
  function applyTime(date: Date, t: number) {
    const sun = sunPosition(date);
    const alt = sun.altitude / RAD;
    lookAt(alt, look);
    const minutes = jstMinutes(date);
    env.uTime.value = t;
    const weights=seasonWeights(season,jstParts(date).month);
    const previousBase=clouds.weather.base;
    clouds.setClimate(climateOf(season,jstParts(date).month));
    const adjustedView=previousBase!==clouds.weather.base ? currentView(view) : VIEW;
    if(adjustedView.above!==VIEW.above){
      VIEW=adjustedView;
      eye.copy(eyeOf(VIEW));
      if(flight?.to==='city'){
        flight.p3.copy(eye);
        shapeFlightArc(flight);
      }
      if(!exploring && (flight?.to??mode)==='city'){
        terrainRecenter?.(eye);
        plantTreesAsync?.(eye,VIEW.bearing);
        ensureCityRegion?.(eye);
        shadow.setRegion(shadowRegion(VIEW,eye));
      }
    }
    env.uSpring.value=weights.spring;env.uSummer.value=weights.summer;env.uAutumn.value=weights.autumn;env.uSnow.value=weights.snow;
    snow.points.visible=weights.snow>0;
    const summerDay=weights.summer*THREE.MathUtils.smoothstep(alt,4,20);
    const summerDusk=weights.summer*THREE.MathUtils.smoothstep(alt,-4,3)*(1-THREE.MathUtils.smoothstep(alt,6,18));
    env.uSunDir.value.set(...directionFrom(sun));
    env.uZenith.value.copy(look.zenith);
    env.uMid.value.copy(look.mid);
    env.uHorizon.value.copy(look.horizon);
    if(summerDay>0){
      env.uZenith.value.lerp(SUMMER_ZENITH,.64*summerDay);
      env.uMid.value.lerp(SUMMER_MID,.52*summerDay);
      env.uHorizon.value.lerp(SUMMER_HORIZON,.40*summerDay);
    }
    if(summerDusk>0){
      env.uHorizon.value.lerp(SUMMER_DUSK_HORIZON,.28*summerDusk);
    }
    env.uGlow.value.copy(look.glow).multiplyScalar(look.glowAmt);
    const directSun = look.sunAmt * THREE.MathUtils.smoothstep(alt, -1.2, 1.2) * (1 + .18 * summerDay);
    env.uSunLight.value.copy(look.sun).multiplyScalar(directSun);
    shadow.update(env.uSunDir.value, directSun);
    env.uCloudLight.value.copy(look.cloud).multiplyScalar(look.cloudAmt * (1 + .24 * summerDay));
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

    renderer.toneMappingExposure = look.exposure * (1 + .05 * summerDay);
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
  heroControls.addEventListener('pointerdown', () => { stopIntroCamera(); warmRegionalOnInteract?.(); }, true);
  heroControls.addEventListener('keydown', event => {
    if (['Enter', ' ', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd', 'q', 'e'].includes(event.key)) {
      stopIntroCamera();
      warmRegionalOnInteract?.();
    }
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

  function shapeFlightArc({p0,p1,p2,p3}:NonNullable<typeof flight>) {
    const lift=flightLift(p0.y,p3.y,p0.distanceTo(p3),clouds.weather.base);
    p1.lerpVectors(p0,p3,.3).y+=lift;
    p2.lerpVectors(p0,p3,.75).y+=lift*.7;
  }

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
    warmRegionalOnInteract?.();
    const request=++flightRequest;
    if(target.startsWith('region-') && !regional && ensureRegionalGround){
      opts.onAreaLoading?.(true);
      void ensureRegionalGround().then(()=>{
        opts.onAreaLoading?.(false);
        if(regional && request===flightRequest)flyTo(target,clock);
      });
      return;
    }
    stopIntroCamera();
    const fromExplorer=exploring?{pos:camera.position.clone(),target:lastTarget.clone()}:null;
    if(exploring){exploring=false;clearKeys();el.removeAttribute('tabindex');env.uHighlight.value=mode==='campus'?1:0;opts.onExplore?.(false);}
    zoom.reset();
    updateZoom();
    const to: HeroMode = target === 'campus' ? 'campus' : 'city';
    const nextView = target === 'campus' ? view : target;
    const destination=currentView(nextView);
    ensureCityRegion?.(target==='campus'?CAMPUS_CENTER:landscapeCenter(destination));
    if(target!=='campus')prefetchCityRegion?.(landscapeCenter(destination),nextView);
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
      VIEW = destination;
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
    flight = {
      to,
      t: 0,
      dur: seconds,
      p0,
      t0: from.target,
      p1: new THREE.Vector3(),
      p2: new THREE.Vector3(),
      p3,
      regrow: locationChanged,
    };
    shapeFlightArc(flight);
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
        freeCenter.copy(freePosition);terrainRecenter?.(freePosition,true);
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
    updateStation?.();
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
    setLanguage(language) {
      labelLanguage = language;
      labels?.setLanguage(language);
    },
    setTouchMove(forward,side,up,fast){
      const axis=(value:number)=>exploring&&Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0;
      touchMove.forward=axis(forward);touchMove.side=axis(side);touchMove.up=axis(up);touchMove.fast=exploring&&fast;
    },
    setExploring(enabled){
      if(exploring===enabled)return;
      if(enabled)warmRegionalOnInteract?.();
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
      updateBasinLod?.();
      updateFireworks?.(camera,dt,pxPerM);
      const regionalTime=performance.now()/1000;
      regional?.update(camera.position.x,camera.position.z,camera.position.y,regionalTime,flight?.p3);
      const detailEye=flight?.p3??camera.position;
      if(regionalCity){
        camera.getWorldDirection(regionalDirection);
        const horizontal=Math.hypot(regionalDirection.x,regionalDirection.z)||1;
        regionalCity.update(detailEye.x,detailEye.z,regionalDirection.x/horizontal,regionalDirection.z/horizontal,regionalTime,activeRegionBox,camera.position);
      }
      const expoDistance=Math.hypot(camera.position.x-expoAnchor.x,camera.position.z-expoAnchor.z);
      if(expoDistance<4800 && !expo && !preparingExpo && regionalTime>=retryExpoAt){
        preparingExpo=true;
        void import('./regional-expo').then(({expoGrounds})=>{expo=expoGrounds(scene,camera,renderer,prepare);})
          .catch(error=>{retryExpoAt=performance.now()/1000+20;console.warn('Expo archive unavailable',error);})
          .finally(()=>{preparingExpo=false;});
      }
      if(expo && expoDistance>7000){expo.dispose();expo=undefined;}
      else if(expo){camera.updateMatrixWorld();expo.update();}
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
      const steadySky = mode === 'city' && !flight &&
        cloudFrame.blur[0] === 0 && cloudFrame.blur[1] === 0;
      const fullPanorama = steadySky && view === 'shogunzuka' && !exploring;
      const cloudRatio = pixelRatio * (fullPanorama ? 1 : cloudVolumeScale(opts.quality));
      if (!steadySky) cloudHistory.invalidate();
      if (!steadySky || !cloudHistory.render(Math.round(width * cloudRatio), Math.round(height * cloudRatio),
        clouds.weather, travel, date.getTime(), draw, dt)) {
        cloudBlur.render(cloudFrame.blur, width, height, pixelRatio, draw);
      }
      frameQueue.submitted();
      opts.onFrameSubmitted?.();
      labels?.update(camera, width, height);
      loading.frame();
      // keep the frame rate up on slower devices by rendering fewer pixels
      if (dt > 0 && pixelRatio > .75) {
        const now = performance.now();
        firstDrawAt ??= now;
        slow = dt > 0.034 ? slow + 1 : Math.max(0, slow - 1);
        // Faster submissions reach 45 samples earlier. Let the opening panorama settle at its requested density.
        const openingPanorama = fullPanorama && now - firstDrawAt < 8000;
        if (slow > 45 && !openingPanorama) {
          slow = 0;
          lowered = true;
          setResolution(Math.max(.75, pixelRatio - 0.25));
        }
      }
    },
  };
}
