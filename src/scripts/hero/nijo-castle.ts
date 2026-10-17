import type {Part} from './landmarks';
import {block} from './compound-models.ts';
import {roof} from './temple-models.ts';

const wood:Part['color']=[.16,.1,.048],tile:Part['color']=[.06,.064,.058];
export function replacesNinomaru(ring:Float32Array){
  const b=[Infinity,Infinity,-Infinity,-Infinity];
  for(let i=0;i<ring.length;i+=2){b[0]=Math.min(b[0],ring[i]);b[1]=Math.min(b[1],ring[i+1]);b[2]=Math.max(b[2],ring[i]);b[3]=Math.max(b[3],ring[i+1]);}
  return [-935.2,-1183.45,-818.68,-1045.05].every((v,i)=>Math.abs(v-b[i])<2);
}

/** Six staggered Ninomaru halls, not one extruded office-like footprint. Positions fit
 * the measured combined roof outline and the castle's official visitor floor plan. */
export function nijoCastle(){
  const sites:Record<string,{x:number;z:number;parts:Part[]}>={};
  const hall=(w:number,d:number,h:number)=>{
    const p:Part[]=[];const eave=h*.46;
    block(p,w*.85,1.5,d*.85,0,.75,0,[.25,.23,.18]);
    block(p,w*.68,eave-1.5,d*.65,0,(eave+1.5)/2,0,[.48,.43,.32]);
    for(const side of [-1,1]){
      for(let i=0;i<=7;i++){
        const x=(i/7-.5)*w*.75;
        block(p,.26,eave,.28,x,eave/2,side*d*.35,wood);
        if(i<7)block(p,w*.75/7-.3,eave*.5,.15,x+w*.75/14,eave*.48,side*d*.33,[.035,.027,.018]);
      }
      block(p,w*.82,.2,1.25,0,1.6,side*d*.36,wood);
    }
    roof(p,w,d,h-eave,eave,0,tile);
    return p;
  };
  for(const [name,x,z,w,d,h] of [
    ['tozamurai',-838,-1074,38,40,19],['shikidai',-864,-1084,24,19,13],
    ['ohiroma',-890,-1098,34,33,17],['sotetsu',-902,-1120,10,22,8],
    ['kuroshoin',-920,-1139,28,29,13],['shiroshoin',-923,-1169,23,28,11],
  ] as const)sites[`ninomaru-${name}`]={x,z,parts:hall(w,d,h)};
  // Enclosed, low connecting walks along the staggered edge of the halls.
  for(const [i,x,z,w,d] of [[0,-854,-1081,18,6],[1,-879,-1090,14,7],[2,-914,-1127,22,6],[3,-932,-1155,5,27]] as const)
    sites[`ninomaru-walk${i}`]={x,z,parts:hall(w,d,6.5)};
  const porch=hall(13,12,9);
  // A restrained gilded crest over the projecting carriage entrance.
  block(porch,4,.45,.3,0,7.8,4.4,[.48,.31,.07],.25);
  sites['ninomaru-carriagePorch']={x:-828,z:-1049,parts:porch};
  return sites;
}
