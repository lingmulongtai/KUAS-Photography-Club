import * as THREE from 'three';
import type {Part} from './landmarks';
import {block} from './compound-models.ts';
import {roof} from './temple-models.ts';

const red:Part['color']=[.55,.065,.025],tile:Part['color']=[.025,.031,.033],white:Part['color']=[.62,.59,.48],stone:Part['color']=[.25,.24,.21];
/** OSM roof outlines, west-facing axis; heights and joinery are visual approximations.
 * https://inari.jp/trip/map01/ */
export const INARI_BUILDINGS=[
  {id:'romon',x:1200.43,z:4045.76,w:29.36,d:11.44,angle:86.51,height:14},
  {id:'gehaiden',x:1219.84,z:4044.37,w:16.91,d:12.52,angle:86.50,height:9},
  {id:'naihaiden',x:1250.71,z:4042.54,w:21.61,d:16.16,angle:86.96,height:10},
  {id:'honden',x:1264.71,z:4041.23,w:16.24,d:13.33,angle:86.94,height:11},
  {id:'okusha',x:1467.09,z:4111.97,w:14.04,d:7.53,angle:172.14,height:7},
] as const;
/** OSM footways 260121328 / 377968455, two separate 2 m-wide routes. */
export const INARI_PATHS=[
  [[1392.11,4062.74],[1399.90,4073.66],[1415.70,4097.08],[1421.70,4103.99],[1427.28,4109.12],[1439.74,4114.08],[1452.65,4114.40]],
  [[1392.11,4062.74],[1423.37,4089.55],[1429.91,4101.71],[1437.83,4111.11],[1444.05,4112.50],[1452.71,4112.17],[1452.65,4114.40]],
] as const;
export function replacesInari(x:number,z:number) {
  return INARI_BUILDINGS.some(b=>{
    const a=b.angle*Math.PI/180,dx=x-b.x,dz=z-b.z;
    return Math.abs(dx*Math.cos(a)+dz*Math.sin(a))<b.w/2+1&&Math.abs(-dx*Math.sin(a)+dz*Math.cos(a))<b.d/2+1;
  });
}
export function inariClearing(x:number,z:number) {
  if(replacesInari(x,z))return true;
  return INARI_PATHS.some(path=>path.slice(1).some((b,i)=>{
    const a=path[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<2;
  }));
}
function hall(w:number,d:number,h:number,open=false):Part[] {
  const p:Part[]=[];block(p,w*.86,.7,d*.86,0,.35,0,stone);
  if(!open)block(p,w*.72,h*.5,d*.65,0,h*.3+.7,0,white);
  for(const side of [-1,1])for(let i=0;i<=6;i++) {
    const x=(i/6-.5)*w*.8;block(p,.3,h*.62,.32,x,h*.31+.7,side*d*.37,red,.5);
    if(!open&&i<6)block(p,w*.8/6-.35,h*.32,.14,x+w*.8/12,h*.25+.7,side*d*.35,[.055,.035,.022]);
  }
  for(const side of [-1,1]) {
    block(p,w*.9,.3,.35,0,h*.62+.7,side*d*.37,red,.5);
    block(p,w*.9,.18,.55,0,.85,side*d*.39,red,.4);
  }
  roof(p,w,d,h*.31,h*.62+.7,0,tile);
  for(let i=0;i<4;i++)block(p,w*.24,.15*(i+1),.6,0,.075*(i+1),d*.44+(3-i)*.45,stone);
  return p;
}
function gate():Part[] {
  const p:Part[]=[];
  for(const side of [-1,1]) {
    for(const z of [-3.7,0,3.7])block(p,.65,6.5,.65,side*5,3.25,z,red,.5);
    block(p,4,5.4,6,side*9,2.7,0,red,.5);
    roof(p,10,5,1.5,4,0,tile);for(const {geo} of p.slice(-3))geo.translate(side*8,0,0);
  }
  block(p,13,.6,8.8,0,6.2,0,red,.6);block(p,10,3.5,6.5,0,8.2,0,white);
  for(const x of [-5,-2.5,0,2.5,5])for(const side of [-1,1])block(p,.3,4,.35,x,8.4,side*3.4,red,.6);
  for(const side of [-1,1]) {
    block(p,13,.17,.2,0,7.3,side*4.4,red,.6);
    for(let i=0;i<19;i++)block(p,.12,.9,.13,(i-9)*.68,6.85,side*4.4,red,.5);
    for(const x of [-3.75,-1.25,1.25,3.75])block(p,1.5,1.5,.14,x,8.6,side*3.3,[.05,.035,.02]);
  }
  roof(p,16,11.44,3.5,10.5,0,tile);
  block(p,1.5,2.2,.15,0,8.9,3.6,[.04,.035,.025],.4);
  return p;
}
function torii(w:number,h:number):Part[] {
  const p:Part[]=[];
  for(const side of [-1,1]) {
    const post=new THREE.CylinderGeometry(w*.035,w*.044,h*.88,8);post.translate(side*w*.32,h*.44,0);p.push({geo:post,color:red,glow:.3});
    block(p,w*.1,h*.12,w*.11,side*w*.32,h*.06,0,tile);
  }
  block(p,w*.91,h*.065,w*.085,0,h*.65,0,red,.3);
  block(p,w,h*.08,w*.13,0,h*.91,0,red,.3);
  block(p,w*1.04,h*.04,w*.15,0,h*.97,0,tile);
  block(p,w*.1,h*.17,w*.04,0,h*.77,w*.07,[.03,.025,.02]);
  return p;
}
export function fushimiInari(ground:(x:number,z:number)=>number):Part[] {
  const all:Part[]=[];
  const place=(p:Part[],x:number,z:number,angle:number)=>{
    for(const part of p)part.geo.rotateY(angle).translate(x,ground(x,z)+.08,z);all.push(...p);
  };
  for(const b of INARI_BUILDINGS)place(b.id==='romon'?gate():hall(b.w,b.d,b.height,b.id==='gehaiden'),b.x,b.z,-b.angle*Math.PI/180);
  for(const x of [1158,1178])place(torii(9,8),x,4048,-86.5*Math.PI/180);
  for(const path of INARI_PATHS) {
    const total=path.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b[0]-path[i][0],b[1]-path[i][1]),0);
    let distance=0,next=4;
    for(let i=1;i<path.length;i++) {
      const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      while(next<=distance+length&&next<total-4) {
        const t=(next-distance)/length;place(torii(2.9,3.4),a[0]+dx*t,a[1]+dz*t,Math.atan2(dx,dz));
        next+=1.6;
      }
      distance+=length;
    }
  }
  return all;
}
