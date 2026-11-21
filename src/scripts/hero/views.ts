import { PLACES, toLocal } from './geo.ts';
import type { OrbitSite } from './landmark-orbit.ts';
import { SPOTS, type SpotId } from '../../data/spots.ts';

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
const INARI_EAST = toLocal(34.9621,135.79716); // Aerial view from the Yamashina side of Mt. Inari.
const TOWER = toLocal(34.9875524, 135.7593295); // 京都タワー
const SENKOJI = toLocal(35.0157751, 135.6655983); // OSM node/4323065493: 大悲閣千光寺
const ATAGO = toLocal(35.0600453, 135.6342851); // 愛宕山（地図の地点と共通）
const KINKAKU = toLocal(35.0395092, 135.7284548); // OSM way/403406106: 舎利殿の建物
const KIRI_TERRACE=toLocal(34.9926914,135.5615125); // OSM viewpoint node/6855829264
// Kyoto Tourism Federation: https://www.kyoto-kankou.or.jp/info_search/9746
const TENNOZAN=toLocal(34.897931,135.679798); // 青木葉谷展望広場

/** Frame the named structure or area using the same centre as its map pin. */
function spotOrbit(id: SpotId, distance: number, above: number, bearing: number, targetHeight: number): ViewDef {
  const spot=SPOTS.find(s=>s.id===id)!;
  const center=toLocal(spot.lat,spot.lon);
  return {ja:spot.ja,en:spot.en,eye:ahead(center,bearing,distance),ref:center,above,
    bearing:(bearing+180)%360,pitch:-15,orbit:{center,targetHeight}};
}

/** The viewpoints. Coordinates from OpenStreetMap; heights from the elevation data. */
export const VIEWS = {
  /** From just in front of the Shogunzuka stage, so the temple grounds stay out of frame. */
  shogunzuka: { ja: '将軍塚', en: 'Shogunzuka', eye: ahead(PLACES.shogunzuka, 265, 120), ref: PLACES.shogunzuka, above: 44, bearing: 265, pitch: -5 },
  inariRidge: { ja:'稲荷山・京都一望', en:'Mt. Inari / Kyoto panorama', eye:INARI_EAST, ref:INARI_EAST, above:635, bearing:315.5, pitch:-7 },
  /** The stage of Kiyomizu-dera, over the Otowa valley toward Kyoto Tower. */
  kiyomizu: { ja: '清水の舞台', en: 'Kiyomizu Stage', eye: ahead(KIYOMIZU, 130, 110), ref: KIYOMIZU, above: 48, bearing: 303, orbit: {center:KIYOMIZU,targetHeight:16}, pitch: -13 },
  /** The fire bed of the great 大 on Daimonji-yama, the whole basin to the south-west. */
  daimonji: { ja: '大文字山', en: 'Mt. Daimonji', eye: ahead(DAIMONJI, 250, 18), ref: DAIMONJI, above: 8, bearing: 245, pitch: -6 },
  daimonjiFirebed: spotOrbit('daimonji',430,150,270,0),
  /** An exterior composition: the whole tower against the northern city and mountains. */
  tower: { ja: '京都タワー', en: 'Kyoto Tower', eye: ahead(TOWER, 180, 260), ref: TOWER, above: 112, bearing: 350, orbit: {center:TOWER,targetHeight:70}, pitch: -9 },
  arashiyama: { ja: '嵐山・大悲閣', en: 'Arashiyama', eye: ahead(SENKOJI, 82, 20), ref: SENKOJI, above: 32, bearing: 100, pitch: -4 },
  atago: { ja: '愛宕山', en: 'Mt. Atago', eye: ahead(ATAGO, 130, 60), ref: ATAGO, above: 75, bearing: 130, pitch: -7 },
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
  kameokaTerrace:{ja:'かめおか霧のテラス',en:'Kameoka Kiri Terrace',eye:KIRI_TERRACE,ref:KIRI_TERRACE,above:35,bearing:278,pitch:-9},
  tennozan:{ja:'天王山・三川合流',en:'Tennozan / Three Rivers',eye:TENNOZAN,ref:TENNOZAN,above:60,bearing:160,pitch:-12},
  osakaSkyline:{ja:'天王山・大阪遠景',en:'Tennozan / Osaka skyline',eye:TENNOZAN,ref:TENNOZAN,above:60,bearing:218,pitch:-6},
  sonobe:spotOrbit('sonobe',1100,650,180,8),
  yamashina:spotOrbit('yamashina',1000,650,180,8),
  fushimi:spotOrbit('fushimi',1100,650,180,8),
  inari:spotOrbit('inari',330,170,240,10),
  byodoin:spotOrbit('byodoin',200,95,95,7),
  philosopher:spotOrbit('philosopher',280,185,240,4),
} satisfies Record<string, ViewDef>;

export type HeroView = keyof typeof VIEWS;
export type HeroDestination = 'campus' | HeroView;
export const PANORAMA_VIEWS = ['shogunzuka','inariRidge','daimonji','arashiyama','atago','kameokaTerrace','tennozan','osakaSkyline'] as const satisfies readonly HeroView[];
export type PanoramaView = (typeof PANORAMA_VIEWS)[number];
const CLOUD_CLEARANCE=80;

/** Select the actual opening eye before any view-centred geometry is prepared. */
export function openingPanorama(height:(x:number,z:number)=>number,cloudBase:number,previous:string|null,requested:string|null,random=Math.random):PanoramaView {
  const eligible=PANORAMA_VIEWS.filter(id=>{
    const v=VIEWS[id];
    return height(v.ref.x,v.ref.z)+v.above+CLOUD_CLEARANCE<=cloudBase;
  });
  const linked=eligible.find(id=>id===requested);
  if(linked)return linked;
  // Tennozan has two bearings at one observation point. Give each place one
  // chance and avoid returning to the same mountain on consecutive visits.
  const places=new Map<string,PanoramaView[]>();
  for(const id of eligible){
    const eye=VIEWS[id].eye, key=`${eye.x},${eye.z}`;
    const views=places.get(key);
    if(views)views.push(id);
    else places.set(key,[id]);
  }
  const all=[...places.values()];
  const other=all.filter(group=>!group.some(id=>id===previous));
  const choices=other.length?other:all;
  if(!choices.length)return 'shogunzuka';
  const group=choices[Math.floor(random()*choices.length)];
  return group.length===1?group[0]:group[Math.floor(random()*group.length)];
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
