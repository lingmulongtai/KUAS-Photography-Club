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
const TOWER = toLocal(34.9875524, 135.7593295); // 京都タワー
const SENKOJI = toLocal(35.0157751, 135.6655983); // OSM node/4323065493: 大悲閣千光寺
const ATAGO = toLocal(35.0600453, 135.6342851); // 愛宕山（地図の地点と共通）
const KINKAKU = toLocal(35.0395092, 135.7284548); // OSM way/403406106: 舎利殿の建物

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
  gion: spotOrbit('gion',360,220,210,8),
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
} satisfies Record<string, ViewDef>;

export type HeroView = keyof typeof VIEWS;
export type HeroDestination = 'campus' | HeroView;
export const PANORAMA_VIEWS = ['shogunzuka','daimonji','arashiyama','atago'] as const satisfies readonly HeroView[];

export function spotDestination(id: SpotId): HeroDestination {
  if (id==='kuas') return 'campus';
  if (id==='arashiyama') return 'togetsukyo';
  if (id==='daimonji') return 'daimonjiFirebed';
  return id;
}
