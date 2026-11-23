import { MAP_PLACES } from '../../data/kansai-outings.ts';
import { PLACES, toLocal } from './geo.ts';
import type { OrbitSite } from './landmark-orbit.ts';
import { KYOTO_TOWER_LOCATION, SPOTS, type SpotId } from '../../data/spots.ts';

const RAD = Math.PI / 180;

/** A place to look at Kyoto from. `ref` is where the ground height is taken; the eye floats `above` it. */
export interface ViewDef {
  ja: string;
  en: string;
  eye: { x: number; z: number };
  ref: { x: number; z: number };
  above: number;
  bearing: number;
  /** Centre a close landmark more tightly as the horizontal field narrows. */
  focusBearing?: number;
  /** Object-centred camera instead of turning at a fixed observation point. */
  orbit?: OrbitSite;
  pitch: number;
}

const ahead = (p: { x: number; z: number }, bearing: number, m: number) => ({
  x: p.x + Math.sin(bearing * RAD) * m,
  z: p.z - Math.cos(bearing * RAD) * m,
});

const KIYOMIZU = toLocal(34.9946668, 135.7849382); // 清水寺 本堂舞台
const DAIMONJI = toLocal(35.0230738, 135.804312); // 大文字山 火床
const INARI_EAST = toLocal(34.96358,135.79023); // Aerial view from the Yamashina side of Mt. Inari.
const TOWER = toLocal(KYOTO_TOWER_LOCATION.lat, KYOTO_TOWER_LOCATION.lon);
const SENKOJI = toLocal(35.0157751, 135.6655983); // OSM node/4323065493: 大悲閣千光寺
const ATAGO_RIDGE = toLocal(35.052699, 135.655073); // On the eastern flank, above the Katsura valley.
const KINKAKU = toLocal(35.0395092, 135.7284548); // OSM way/403406106: 舎利殿の建物
const KAMEOKA_RIDGE=toLocal(34.98287,135.55802); // South of the terrace, overlooking the campus and basin.
const CONFLUENCE=toLocal(34.873831,135.676099); // Look upstream over the three rivers towards Kyoto.
const HIKONE=toLocal(35.27645,136.25184); // 彦根城 天守 (public/kansai/landmarks/index.json hikone-keep)
const HIEI=toLocal(35.0616,135.8414); // 比叡山 山頂付近（京都・びわ湖を一望）
const TODAIJI=toLocal(34.6889931,135.83987322); // 東大寺 大仏殿 (public/kansai/landmarks/index.json todaiji)
const KASUGA=toLocal(34.6815749,135.8485364); // 春日大社 本殿 (public/kansai/landmarks/index.json kasuga-honden-1)

export const EXTRA_LANDMARKS = [
  { id: 'hikone', ja: '彦根城', en: 'Hikone Castle', lat: 35.27645, lon: 136.25184 },
  { id: 'hiei', ja: '比叡山', en: 'Mt. Hiei', lat: 35.0616, lon: 135.8414 },
  { id: 'todaiji', ja: '東大寺', en: 'Todai-ji', lat: 34.6889931, lon: 135.83987322 },
  { id: 'kasuga', ja: '春日大社', en: 'Kasuga Taisha', lat: 34.6815749, lon: 135.8485364 },
] as const;

/** Frame the named structure or area using the same centre as its map pin. */
function spotOrbit(id: SpotId, distance: number, above: number, bearing: number, targetHeight: number): ViewDef {
  const spot=SPOTS.find(s=>s.id===id)!;
  const center=toLocal(spot.lat,spot.lon);
  return {ja:spot.ja,en:spot.en,eye:ahead(center,bearing,distance),ref:center,above,
    bearing:(bearing+180)%360,pitch:-15,orbit:{center,targetHeight}};
}

// The same coordinate frame lets both the spot picker and free flight reach these places.
const represented = new Set(['kiyomizu','byodoin','philosopher','gyoen','arashiyama']);
export const REGIONAL_PLACES = MAP_PLACES.filter(p=>!represented.has(p.id));
type RegionalView = `region-${typeof MAP_PLACES[number]['id']}`;
const regionalViews=Object.fromEntries(REGIONAL_PLACES.map(p=>{
  const center=toLocal(p.lat,p.lon);
  const pitch='pitch' in p?p.pitch:-21;
  const targetHeight='targetHeight' in p?p.targetHeight:8;
  const distance=p.range*Math.cos(pitch*RAD);
  const eye=ahead(center,p.heading+180,distance);
  const view:ViewDef={ja:p.ja,en:p.en,ref:center,eye,bearing:p.heading,pitch,
    above:targetHeight-p.range*Math.sin(pitch*RAD),orbit:{center,targetHeight}};
  return ['region-'+p.id,view];
})) as Record<RegionalView,ViewDef>;

/** The viewpoints. Coordinates from OpenStreetMap; heights from the elevation data. */
export const VIEWS = {
  ...regionalViews,
  /** From just in front of the Shogunzuka stage, so the temple grounds stay out of frame. */
  shogunzuka: { ja: '将軍塚', en: 'Shogunzuka', eye: ahead(PLACES.shogunzuka, 265, 120), ref: PLACES.shogunzuka, above: 44, bearing: 265, pitch: -5 },
  inariRidge: { ja:'稲荷山・京都一望', en:'Mt. Inari / Kyoto panorama', eye:INARI_EAST, ref:INARI_EAST, above:612, bearing:314.7, pitch:-9.3 },
  /** The stage of Kiyomizu-dera, over the Otowa valley toward Kyoto Tower. */
  kiyomizu: { ja: '清水の舞台', en: 'Kiyomizu Stage', eye: ahead(KIYOMIZU, 130, 110), ref: KIYOMIZU, above: 48, bearing: 303, orbit: {center:KIYOMIZU,targetHeight:16}, pitch: -13 },
  /** Across the firebed towards the western skyline, with Kiyomizu on the left. */
  daimonji: { ja: '大文字山', en: 'Mt. Daimonji', eye: ahead(DAIMONJI, 80, 1704), ref: DAIMONJI, above: 834, bearing: 250.74, pitch: -8.55 },
  daimonjiFirebed: spotOrbit('daimonji',430,150,270,0),
  /** An exterior composition: the whole tower against the northern city and mountains. */
  tower: { ja: '京都タワー', en: 'Kyoto Tower', eye: ahead(TOWER, 180, 260), ref: TOWER, above: 112, bearing: 350, orbit: {center:TOWER,targetHeight:70}, pitch: -9 },
  arashiyama: { ja: '嵐山・大悲閣', en: 'Arashiyama', eye: ahead(SENKOJI, 82, 20), ref: SENKOJI, above: 105, bearing: 100, pitch: -7 },
  atago: { ja: '愛宕山', en: 'Mt. Atago', eye: ATAGO_RIDGE, ref: ATAGO_RIDGE, above: 542, bearing: 127.05, pitch: -5.36 },
  kinkaku: { ja: '金閣寺', en: 'Golden Pavilion', eye: ahead(KINKAKU, 220, 105), ref: KINKAKU, above: 27, bearing: 40, orbit: {center:KINKAKU,targetHeight:6}, pitch: -10 },
  station: spotOrbit('station',520,280,0,25),
  toji: spotOrbit('toji',300,180,180,22),
  yasaka: spotOrbit('yasaka',140,78,220,23),
  gion: spotOrbit('gion',260,150,210,6),
  kawaramachi: spotOrbit('kawaramachi',400,230,200,25),
  sanjo: spotOrbit('sanjo',180,120,180,8),
  gojo: spotOrbit('gojo',180,120,180,8),
  kamo: spotOrbit('kamo',380,230,180,4),
  nijo: spotOrbit('nijo',600,350,180,15),
  // OSM way/554905814: 紫宸殿; way/374564926: 龍安寺方丈.
  gosho: spotOrbit('gosho',450,270,180,8),
  heian: spotOrbit('heian',300,195,180,8),
  ryoanji: spotOrbit('ryoanji',110,65,180,7),
  togetsukyo: spotOrbit('arashiyama',330,160,180,8),
  kameoka:spotOrbit('kameoka',820,540,240,15),
  kameokaTerrace:{ja:'かめおか霧のテラス',en:'Kameoka Kiri Terrace',eye:KAMEOKA_RIDGE,ref:KAMEOKA_RIDGE,above:168,bearing:345.95,pitch:-7.72},
  tennozan:{ja:'天王山',en:'Mt. Tennozan',eye:CONFLUENCE,ref:CONFLUENCE,above:894,bearing:22.14,pitch:-8.34},
  sonobe:spotOrbit('sonobe',1100,650,180,8),
  yamashina:spotOrbit('yamashina',1000,650,180,8),
  fushimi:spotOrbit('fushimi',1100,650,180,8),
  inari:spotOrbit('inari',330,170,240,10),
  byodoin:spotOrbit('byodoin',200,95,95,7),
  philosopher:spotOrbit('philosopher',280,185,240,4),
  hikone:{ja:'彦根城',en:'Hikone Castle',eye:ahead(HIKONE,225,360),ref:HIKONE,above:125,bearing:45,pitch:-17,orbit:{center:HIKONE,targetHeight:22}},
  hiei:{ja:'比叡山',en:'Mt. Hiei',eye:ahead(HIEI,110,900),ref:HIEI,above:320,bearing:290,pitch:-16,orbit:{center:HIEI,targetHeight:12}},
  todaiji:{ja:'東大寺',en:'Todai-ji',eye:ahead(TODAIJI,185,340),ref:TODAIJI,above:120,bearing:5,pitch:-16,orbit:{center:TODAIJI,targetHeight:28}},
  kasuga:{ja:'春日大社',en:'Kasuga Taisha',eye:ahead(KASUGA,240,260),ref:KASUGA,above:95,bearing:60,pitch:-17,orbit:{center:KASUGA,targetHeight:10}},
} satisfies Record<string, ViewDef>;

export type HeroView = keyof typeof VIEWS;
export type HeroDestination = 'campus' | HeroView;
export const PANORAMA_VIEWS = ['shogunzuka','inariRidge','daimonji','arashiyama','atago','kameokaTerrace','tennozan'] as const satisfies readonly HeroView[];
export type PanoramaView = (typeof PANORAMA_VIEWS)[number];
const CLOUD_CLEARANCE=80;

/** Lower aerial views under a low deck. At Daimonji, keep the firebed in the same part of the frame. */
export function viewBelowClouds(id:HeroView, ground:number, cloudBase:number):ViewDef {
  const view=VIEWS[id];
  const above=cloudBase-CLOUD_CLEARANCE-ground;
  if(above>=view.above)return view;
  if(id==='atago'||id==='tennozan')return above>=CLOUD_CLEARANCE ? {...view,above} : view;
  if(id!=='daimonji')return view;
  const pinHeight=SPOTS.find(spot=>spot.id==='daimonji')!.above;
  if(above<=pinHeight)return view;
  const scale=(above-pinHeight)/(view.above-pinHeight);
  return {...view,above,eye:{
    x:view.ref.x+(view.eye.x-view.ref.x)*scale,
    z:view.ref.z+(view.eye.z-view.ref.z)*scale,
  }};
}

/** Select the actual opening eye before any view-centred geometry is prepared. */
export function openingPanorama(height:(x:number,z:number)=>number,cloudBase:number,previous:string|null,requested:string|null,random=Math.random):PanoramaView {
  const eligible=PANORAMA_VIEWS.filter(id=>{
    const v=VIEWS[id];
    const ground=height(v.ref.x,v.ref.z);
    return viewBelowClouds(id,ground,cloudBase).above<=cloudBase-CLOUD_CLEARANCE-ground;
  });
  // Previously shared Osaka panorama links now open the single Tennozan view.
  const linked=eligible.find(id=>id===(requested==='osakaSkyline'?'tennozan':requested));
  if(linked)return linked;
  const others=eligible.filter(id=>id!==(previous==='osakaSkyline'?'tennozan':previous));
  const choices=others.length?others:eligible;
  return choices[Math.floor(random()*choices.length)]??'shogunzuka';
}

/** Both inner controls of a cubic flight must clear the cloud deck too. */
export function flightLift(from:number,to:number,distance:number,cloudBase:number) {
  const lift=160+Math.min(distance*.06,420);
  if(Math.max(from,to)>=cloudBase)return lift;
  const ceiling=Math.max(from,to,cloudBase-CLOUD_CLEARANCE);
  return Math.min(lift,ceiling-(from*.7+to*.3),(ceiling-(from*.25+to*.75))/.7);
}

export function spotDestination(id: SpotId): HeroDestination {
  if (id==='kuas') return 'campus';
  if (id==='arashiyama') return 'togetsukyo';
  if (id==='daimonji') return 'daimonjiFirebed';
  return id;
}
