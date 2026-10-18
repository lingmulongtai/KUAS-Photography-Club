import type {Part} from './landmarks';
import {block} from './compound-models.ts';
import {roof} from './temple-models.ts';
import * as THREE from 'three';

const wood:Part['color']=[.16,.1,.048],tile:Part['color']=[.06,.064,.058];
export const NIJO_REPLACEMENTS=[[-1076.98,-1178.75],[-1056.44,-1139.57],[-999.64,-1144.64],[-769.79,-1028.54],[-776.36,-960.11],[-1255.06,-1003.31],[-1060.1,-1201.85]];
export function replacesNijoBox(x:number,z:number){return NIJO_REPLACEMENTS.some(p=>Math.hypot(x-p[0],z-p[1])<3);}
export function replacesNijoFootprint(ring:Float32Array){
  if(replacesNinomaru(ring))return true;
  const b=[Infinity,Infinity,-Infinity,-Infinity];
  for(let i=0;i<ring.length;i+=2){b[0]=Math.min(b[0],ring[i]);b[1]=Math.min(b[1],ring[i+1]);b[2]=Math.max(b[2],ring[i]);b[3]=Math.max(b[3],ring[i+1]);}
  return [[-1107.63,-1202.11,-1045.02,-1155.91],[-1077.09,-1155.88,-1035.25,-1125.28],[-1009.39,-1151.21,-993.53,-1138.03],
    [-776.56,-1045.68,-763.55,-1012.15],[-793.13,-967.52,-766.01,-953.35],[-1261.39,-1010.33,-1248.74,-996.28],[-1073.07,-1208.21,-1048.66,-1196.04]]
    .some(target=>target.every((v,i)=>Math.abs(v-b[i])<2));
}
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
  // Honmaru's relocated residential halls surround a small open court. They are not
  // a reconstructed keep: only the two surviving south corner turrets stand tall.
  for(const [name,x,z,w,d,h] of [['west',-1094,-1178,27,36,14],['east',-1058,-1182,26,35,16.6],
    ['northLink',-1076,-1196,24,12,8],['northAnnex',-1060.1,-1201.85,24,11.5,7.4],['otsune',-1056.44,-1139.57,40.81,29.89,17.8]] as const)
    sites[`honmaru-${name}`]={x,z,parts:hall(w,d,h)};
  for(const side of [-1,1])block(sites['honmaru-otsune'].parts,31,.8,.3,0,4.8,side*10.5,[.48,.43,.32]);
  const gate=(w:number,d:number,h:number)=>{
    const p:Part[]=[];
    for(const side of [-1,1])for(const x of [-w*.38,w*.38])block(p,.45,h*.5,.45,x,h*.25,side*d*.3,wood);
    block(p,w*.85,h*.35,d*.72,0,h*.58,0,[.57,.54,.44]);
    roof(p,w,d,h*.25,h*.75,0,tile);return p;
  };
  sites.honmaruGate={x:-999.64,z:-1144.64,parts:gate(15,12.5,9.8)};
  const ote=gate(33.29,11.57,14);for(const p of ote)p.geo.rotateY(Math.PI/2-.052);
  sites.eastOteGate={x:-769.79,z:-1028.54,parts:ote};
  const turret=(w:number,d:number,h:number,curved:boolean)=>{
    const p:Part[]=[];
    block(p,w*.9,2,d*.9,0,1,0,[.23,.22,.19]);
    for(const [y,s,bodyH,roofH] of [[2,1,4.5,2.5],[8.5,.75,3.8,h-12.3]]){
      block(p,w*s*.77,bodyH,d*s*.76,0,y+bodyH/2,0,[.59,.57,.48]);
      for(const side of [-1,1])for(const x of [-w*s*.2,w*s*.2])block(p,.55,1.2,.12,x,y+bodyH*.55,side*d*s*.386,[.025,.025,.02]);
      roof(p,w*s,d*s,roofH,y+bodyH,0,tile);
    }
    if(curved){
      const arch=new THREE.CatmullRomCurve3([new THREE.Vector3(-3,9.3,d*.48),new THREE.Vector3(-1.5,9.7,d*.48),new THREE.Vector3(0,10.6,d*.48),new THREE.Vector3(1.5,9.7,d*.48),new THREE.Vector3(3,9.3,d*.48)]);
      p.push({geo:new THREE.TubeGeometry(arch,16,.17,4,false),color:tile,glow:.1});
    }else{
      const shape=new THREE.Shape();shape.moveTo(-2.8,9.1);shape.lineTo(0,11.3);shape.lineTo(2.8,9.1);shape.closePath();
      const geo=new THREE.ExtrudeGeometry(shape,{depth:.22,bevelEnabled:false});geo.translate(0,0,d*.43);
      p.push({geo,color:[.59,.57,.48],glow:.1});
    }
    for(const part of p)part.geo.rotateY(-.052);return p;
  };
  sites.southeastTurret={x:-774.16,z:-960.44,parts:turret(15.72,13.5,15.1,false)};
  sites.southwestTurret={x:-1255.06,z:-1003.31,parts:turret(11.98,13.45,15.3,true)};
  const wall:Part[]=[];block(wall,11,3,.8,0,1.5,0,[.46,.43,.35]);roof(wall,12,1.8,.6,3,0,tile);
  sites.turretLink={x:-787.4,z:-960.44,parts:wall};
  return sites;
}
