import * as THREE from 'three';
import type {Part} from './landmarks';
import {block} from './compound-models.ts';
import {roof} from './temple-models.ts';
export const BYODOIN_CENTER={x:4397.88,z:12682.34};
const rotation=97.9*Math.PI/180;
const red:Part['color']=[.38,.075,.033],tile:Part['color']=[.055,.06,.056],white:Part['color']=[.5,.42,.27],gold:Part['color']=[.65,.43,.075];
/** Official overall dimensions: 47 m N–S, 35 m E–W, 13.5 m excluding phoenixes.
 * East-facing middle hall, north/south wing galleries and a west tail.
 * https://www.byodoin.or.jp/faq/byodoin/
 * Placement/axis: OSM way/100296031; small joinery is illustrative. */
export function phoenixHall():Part[] {
  const p:Part[]=[];
  block(p,17,.8,11,0,.4,0,[.29,.27,.21]);
  block(p,13,5,9,0,3.3,0,white,.35);
  for(const side of [-1,1])for(let i=0;i<=6;i++) {
    const x=(i-3)*2.1;block(p,.26,5.7,.28,x,3.6,side*4.8,red,.55);
    if(i<6)block(p,1.65,3.6,.1,x+1.05,3,side*4.55,[.035,.027,.019],.1);
  }
  for(const side of [-1,1]) {
    block(p,17,.2,.5,0,1,side*5.4,red,.4);
    block(p,16,.24,.3,0,5.7,side*5.2,red,.5);
  }
  // Lower encircling eaves and the taller hipped-gabled central roof.
  roof(p,20,15,1.7,5.8,0,tile);
  block(p,10.8,2.3,7.5,0,8.1,0,white,.4);
  for(const side of [-1,1])for(let i=0;i<7;i++)block(p,.22,2.1,.24,(i-3)*1.7,8.2,side*3.85,red,.5);
  roof(p,16.5,13,4.2,9.3,0,tile);
  const gallery=(x:number,z:number,w:number,d:number,h:number)=>{
    block(p,w,.24,d,x,1.4,z,red,.4);
    for(const side of [-1,1])for(let i=0;i<=Math.ceil(w/2);i++)block(p,.17,h,.17,x+(i/Math.ceil(w/2)-.5)*(w-.3),1.5+h/2,z+side*(d*.42),red,.45);
    if(d>w)for(const side of [-1,1])for(let i=1;i<Math.ceil(d/2);i++)block(p,.17,h,.17,x+side*w*.42,1.5+h/2,z+(i/Math.ceil(d/2)-.5)*d,red,.45);
    const start=p.length;roof(p,w+.8,d+.8,1.2,1.5+h,0,tile);
    for(const part of p.slice(start))part.geo.translate(x,0,z);
  };
  for(const side of [-1,1]) {
    gallery(side*13.3,0,12.6,3,2.3);
    // The forward return and two-tiered corner pavilion.
    for(const z of [2,4,6])gallery(side*20,z,4,2,2.3);
    block(p,4,2.2,4,side*20,4.6,8,red,.45);
    for(const [y,w,d,h] of [[3.8,7,6.5,1.5],[6.8,5.8,5.5,1.8]]) {
      const start=p.length;roof(p,w,d,h,y,0,tile,true);
      for(const part of p.slice(start))part.geo.translate(side*20,0,8);
    }
  }
  // A narrow, roofed rear gallery runs away from the pond.
  gallery(0,-13.55,3.6,19.6,2.5);
  // The paired gold phoenixes sit at the ends of the upper ridge.
  for(const side of [-1,1]) {
    const x=side*5;
    const body=new THREE.SphereGeometry(.22,8,5);body.scale(.8,1.2,1);body.translate(x,13.9,0);p.push({geo:body,color:gold,glow:.6});
    for(const wing of [-1,1]){const g=new THREE.BoxGeometry(.65,.06,.28);g.rotateZ(wing*.45);g.translate(x+wing*.3,14.1,0);p.push({geo:g,color:gold,glow:.6});}
    block(p,.08,.5,.09,x,13.7,0,gold,.6);
  }
  return p;
}
export function byodoinParts(ground:(x:number,z:number)=>number) {
  const p=phoenixHall(),{x,z}=BYODOIN_CENTER;
  for(const part of p)part.geo.rotateY(rotation).translate(x,ground(x,z)+.05,z);
  return p;
}
export function replacesByodoin(x:number,z:number) {
  const dx=x-BYODOIN_CENTER.x,dz=z-BYODOIN_CENTER.z;
  const u=dx*Math.cos(rotation)-dz*Math.sin(rotation),v=dx*Math.sin(rotation)+dz*Math.cos(rotation);
  return Math.abs(u)<24.5&&v>-25&&v<12;
}
