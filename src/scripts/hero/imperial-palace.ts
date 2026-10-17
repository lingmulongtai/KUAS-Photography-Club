import type {Part} from './landmarks';
import {block,templeHall} from './compound-models.ts';
import {roof} from './temple-models.ts';

type Site={parts:Part[];x:number;z:number;rotY?:number};
const plaster:Part['color']=[.44,.4,.31],wood:Part['color']=[.13,.073,.035],bark:Part['color']=[.07,.047,.028];

/** GSI roof outlines aligned with the Imperial Household Agency precinct plan.
 * Hall positions are approximate (10–20 m); low roof heights are illustrative. */
export function imperialPalace():Record<string,Site>{
  const sites:Record<string,Site>={};
  for(const [name,x,z,w,d,h] of [
    ['seiryoden',200,-2320,30,27,10],['kogosho',275,-2325,22,25,9],
    ['gakumonjo',276,-2362,24,25,9],['otsunegoten',282,-2435,48,45,10.5],
    ['northResidence',245,-2577,48,52,9],['shunkoden',320.6,-2286.2,18,15,8],
  ] as const){
    const parts=templeHall(w,d,h);
    // Cypress bark roofs, rather than the grey tiles used on the Toji models.
    for(const p of parts)if(p.color[0]===.045)p.color=bark;
    sites[name]={x,z,parts};
  }
  const gate=(w:number,d:number,h:number)=>{
    const parts:Part[]=[];
    for(const side of [-1,1])for(const x of [-w*.35,w*.35])block(parts,.4,h*.63,.4,x,h*.315,side*d*.24,wood);
    block(parts,w*.65,h*.51,.23,0,h*.255,d*.15,wood);
    roof(parts,w,d,h*.37,h*.63,0,bark);
    return parts;
  };
  for(const [name,x,z,w,d,h,rotY] of [
    ['kenreimon',241.6,-2186.1,12,11,8,0],['jomeimon',241.2,-2209.6,21.5,13,8.5,0],
    ['kenshunmon',378.2,-2223,15,11,8,Math.PI/2],['gishumon',144,-2339.9,15,10,8,Math.PI/2],
    ['seishomon',138.2,-2464.4,13,10,7,Math.PI/2],['kogomon',137,-2606.8,12,9,7,Math.PI/2],
    ['sakuheimon',264.9,-2623.3,14,10,8,0],
  ] as const)sites[name]={x,z,parts:gate(w,d,h),rotY};
  // Split walls at the gates. Short independently grounded spans follow the gentle slope.
  const wall=(name:string,x0:number,z0:number,x1:number,z1:number)=>{
    const length=Math.hypot(x1-x0,z1-z0),n=Math.ceil(length/30);
    for(let i=0;i<n;i++){
      const x=x0+(x1-x0)*(i+.5)/n,z=z0+(z1-z0)*(i+.5)/n,w=length/n;
      const parts:Part[]=[];
      block(parts,w,5,.7,0,.3,0,plaster);
      roof(parts,w+1.2,1.8,.45,2.8,0,bark);
      sites[`${name}${i}`]={x,z,parts,rotY:-Math.atan2(z1-z0,x1-x0)};
    }
  };
  wall('southWest',137,-2186,235,-2186);wall('southEast',248,-2186,384,-2186);
  wall('eastSouth',384,-2186,383.4,-2215);wall('eastNorth',383.2,-2231,378,-2627);
  wall('northWest',136,-2627,257,-2627);wall('northEast',273,-2627,378,-2627);
  for(const [z0,z1] of [[-2627,-2614],[-2599,-2472],[-2457,-2348],[-2332,-2186]])wall(`west${z0}`,137,z0,137,z1);
  // The south court has low vermilion walks rather than a solid roof over the garden.
  for(const side of [-1,1]){
    const parts:Part[]=[];
    for(let i=0;i<=12;i++)block(parts,.2,3,.2,0,1.5,-31+i*62/12,[.38,.055,.025]);
    roof(parts,4,66,1.2,3,0,bark);
    sites[`southWalk${side}`]={x:241.2+side*38,z:-2241,parts};
  }
  return sites;
}
