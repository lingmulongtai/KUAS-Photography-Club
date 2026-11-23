import {toLocal} from './geo.ts';

/** Seasonal scenery, not a flowering forecast or a tree inventory: well-known cherry
 * viewing grounds take a large share of their broadleaf trees, and wild yamazakura
 * dot every broadleaf hillside. Centres are approximate site centres (OpenStreetMap). */
const GROVES:[lat:number,lon:number,radius:number,share:number][]=[
  [35.0035,135.7815,260,.6],   // 円山公園
  [35.0125,135.7850,450,.45],  // 岡崎・琵琶湖疏水
  [35.0230,135.7945,500,.3],   // 哲学の道・南禅寺
  [34.9948,135.7850,320,.35],  // 清水寺
  [35.0254,135.7621,650,.25],  // 京都御苑
  [35.0142,135.7481,280,.35],  // 二条城
  [35.0330,135.7270,160,.7],   // 平野神社
  [35.0310,135.7137,220,.5],   // 仁和寺
  [34.9806,135.7478,200,.3],   // 東寺
  [35.0130,135.6770,900,.35],  // 嵐山
  [34.9510,135.8196,450,.5],   // 醍醐寺
  [34.9985,135.8140,650,.4],   // 山科疏水
  [34.9320,135.7640,350,.4],   // 伏見十石舟
  [34.8860,135.6740,700,.6],   // 背割堤
  [34.6873,135.5262,700,.45],  // 大阪城公園
  [34.7015,135.5170,600,.5],   // 毛馬桜之宮公園
  [34.8094,135.5320,800,.35],  // 万博記念公園
  [34.6851,135.8430,1000,.3],  // 奈良公園
];
const WILD=.1;
const groves=GROVES.map(([lat,lon,radius,share])=>({...toLocal(lat,lon),radius,share}));

/** Fraction of broadleaf crowns in flower at a point in spring. */
export function cherryShare(x:number,z:number){
  let share=WILD;
  for(const g of groves){
    const d=Math.hypot(x-g.x,z-g.z);
    if(d>=g.radius)continue;
    const t=Math.min(1,Math.max(0,(g.radius-d)/(g.radius*.4)));
    share=Math.max(share,g.share*t*t*(3-2*t));
  }
  return share;
}

/** Stable per-tree pick, independent of the planting order. */
export function cherryPick(x:number,z:number){
  const s=Math.sin(x*12.9898+z*78.233)*43758.5453;
  return s-Math.floor(s);
}

