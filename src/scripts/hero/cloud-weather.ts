import {rng} from './util.ts';
import type {Climate} from './seasons.ts';

/**
 * Cloud characters for the low layer:
 * 0 fair-weather cumulus, 1 a few small puffs, 2 a broken stratocumulus deck,
 * 3 towering cumulus (congestus), 4 cumulonimbus (summer thunderheads with anvils),
 * 5 a winter snow-cloud deck, low and grey.
 */
export const CLOUD_STYLES=['cumulus','fair','stratocumulus','congestus','cumulonimbus','snow'] as const;

/** How often each character turns up in each season (weights in CLOUD_STYLES order). */
const SEASON_STYLES:Record<Climate,number[]>={
  spring:[3,4,2,1,0,0],
  // thunderheads over the mountains are the summer sky in Kyoto
  summer:[2,2,0,2,4,0],
  // autumn is mostly clear, with mackerel skies (see `alto`)
  autumn:[2,5,2,0,0,0],
  winter:[0,3,3,0,0,4],
};

/**
 * Low-cloud cover inside a group of clouds, base and depth for each character. `clear` is the
 * share of the sky left as open gaps between groups, so the sky stays scattered, not crowded.
 */
const SHAPES=[
  {cover:[.36,.46],clear:[.55,.8],base:[1350,1600],depth:[900,1500]},
  {cover:[.28,.36],clear:[.5,.8],base:[1450,1750],depth:[450,800]},
  {cover:[.46,.56],clear:[.3,.55],base:[1250,1500],depth:[450,700]},
  {cover:[.32,.4],clear:[.65,.85],base:[1300,1550],depth:[2200,3400]},
  {cover:[.38,.46],clear:[.75,.9],base:[1200,1450],depth:[5800,6800]},
  {cover:[.56,.64],clear:[.1,.25],base:[850,1050],depth:[550,850]},
];

const pick=(random:()=>number,weights:number[])=>{
  let r=random()*weights.reduce((a,b)=>a+b,0);
  for(let i=0;i<weights.length;i++){r-=weights[i];if(r<0)return i;}
  return weights.length-1;
};

/**
 * Where the clouds drift, in field units per second along scene x (east) and z (south).
 * Over Japan the westerlies carry the weather from west to east; the heading wanders a little
 * either side of due east, and the winter jet stream drives the clouds faster than summer's.
 */
const WIND_SPEED:Record<Climate,[number,number]>={spring:[.0006,.001],summer:[.0004,.0007],autumn:[.0006,.001],winter:[.0008,.0012]};
function westerly(random:()=>number,climate:Climate) {
  const [lo,hi]=WIND_SPEED[climate],speed=lo+random()*(hi-lo);
  const heading=(random()-.5)*50*Math.PI/180;
  return [speed*Math.cos(heading),speed*Math.sin(heading)] as const;
}

/**
 * One weather character per visit and season; deterministic seeds make it reproducible in QA.
 * The seed also places the clouds, so the same character never lays out the same sky twice.
 */
export function cloudWeather(seed:number,climate:Climate='spring') {
  const random=rng(seed),style=pick(random,SEASON_STYLES[climate]);
  const shape=SHAPES[style],span=(r:number[])=>r[0]+random()*(r[1]-r[0]);
  const cover=span(shape.cover),clear=span(shape.clear),base=span(shape.base),top=base+span(shape.depth);
  // high layers: cirrus streaks ~8 km up and an altocumulus (mackerel) field ~4.5 km up
  const cirrus=style===5?0:style===1&&random()<.6?.5+random()*.5:random()<.4?random()*.8:0;
  const alto=style>=4?0:climate==='autumn'&&random()<.65?.5+random()*.5:random()<.25?.3+random()*.5:0;
  return {style,cover,clear,base,top,cirrus,alto,
    offset:[random()*256,random()*256] as const,
    wind:westerly(random,climate)};
}

export type CloudWeather=ReturnType<typeof cloudWeather>;

/** Continuous drift plus cumulative user-requested time travel, never the live clock. */
export function createCloudClock() {
  let previous=0,seconds=0;
  return {
    step(travelMinutes:number,dt:number,reducedMotion=false) {
      const delta=travelMinutes-previous;previous=travelMinutes;
      seconds+=delta*60+(reducedMotion?0:Math.max(0,Math.min(.2,dt)));
      return seconds;
    },
  };
}
