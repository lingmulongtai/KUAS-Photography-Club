import * as THREE from 'three';
import type {Part} from './landmarks';
import {block} from './compound-models.ts';

export const STATION_CENTER={x:-96.23,z:1957.7};
const stone:Part['color']=[.22,.225,.21],metal:Part['color']=[.3,.33,.34],glass:Part['color']=[.025,.05,.075];
export function replacesKyotoStation(ring:Float32Array){
  const b=[Infinity,Infinity,-Infinity,-Infinity];
  for(let i=0;i<ring.length;i+=2){b[0]=Math.min(b[0],ring[i]);b[1]=Math.min(b[1],ring[i+1]);b[2]=Math.max(b[2],ring[i]);b[3]=Math.max(b[3],ring[i+1]);}
  return [-335.2,1911.35,142.74,2004.04].every((v,i)=>Math.abs(v-b[i])<2);
}

/** Main building's mapped footprint, with the official 59.8 m skyline and 171-step
 * western grand stair. Facade divisions and space-frame members are simplified. */
export function kyotoStation():Part[]{
  const p:Part[]=[];
  const wing=(x0:number,x1:number,z0:number,z1:number,h:number)=>{
    const w=x1-x0,d=z1-z0,x=(x0+x1)/2,z=(z0+z1)/2;
    block(p,w,h,d,x,h/2,z,stone);
    for(const side of [-1,1]){
      const face=z+side*(d/2+.04);
      block(p,w-.6,h-5,.12,x,(h+3)/2,face,glass,.55);
      for(let col=0;col<=Math.floor(w/4);col++)block(p,.18,h-3,.2,x0+col*w/Math.floor(w/4),(h+3)/2,face+side*.08,metal);
      for(let row=1;row<h/4.3;row++)block(p,w,.4,.3,x,row*4.3,face+side*.12,stone);
    }
    block(p,w+1,1,d+1,x,h+.5,z,[.16,.18,.18]);
  };
  wing(-239,-140,-43,43,59.8);
  wing(-140,-40,-43,-19,59.8);
  wing(-140,-40,19,43,43);
  wing(65,239,-43,43,55);
  // Concourse at the south edge; keep the atrium open through the north frontage.
  wing(-35,65,27,43,12);
  block(p,104,1.1,14,15,11,-36,[.3,.32,.32]);
  for(const x of [-32,3,38,64])block(p,.7,10,.7,x,5,-37,metal);
  block(p,105,.45,55,15,.225,0,[.3,.29,.27]);
  // Grand staircase rises west: 35 m over 171 shallow treads, between building wings.
  for(let i=0;i<171;i++){
    const top=7+35*(i+1)/171,x=-35-105*(i+.5)/171;
    block(p,105/171+.005,top,25,x,top/2,0,[.25,.255,.245]);
  }
  block(p,10,.4,27,-140,42.2,0,[.25,.26,.25]);
  // Elevated skyway behind the central void and its slim supporting posts.
  block(p,205,1.2,4,-32,45,21,metal);
  for(const x of [-130,-80,-30,20,65])block(p,.6,43,.6,x,22.5,21,metal);
  const beam=(a:THREE.Vector3,b:THREE.Vector3,width=.25)=>{
    const delta=b.clone().sub(a),geo=new THREE.BoxGeometry(width,delta.length(),width);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize()));
    geo.translate(...a.clone().add(b).multiplyScalar(.5).toArray());p.push({geo,color:metal,glow:.08});
  };
  // A light grid follows the curved roof. Only its central strips are glazed, leaving
  // the valley and stairs visible between structural members from an elevated view.
  const height=(x:number)=>49.8+10*Math.sin(Math.PI*(x+140)/260);
  for(let x=-140;x<=120;x+=10)for(let z=-43;z<43;z+=10.75)
    beam(new THREE.Vector3(x,height(x),z),new THREE.Vector3(x,height(x),z+10.75));
  for(let z=-43;z<=43;z+=10.75)for(let x=-140;x<120;x+=10)
    beam(new THREE.Vector3(x,height(x),z),new THREE.Vector3(x+10,height(x+10),z));
  for(let x=-130;x<110;x+=20){
    const geo=new THREE.PlaneGeometry(19.7,10.3);geo.rotateX(-Math.PI/2);geo.translate(x+10,height(x+10)-.13,-36.6);
    p.push({geo,color:glass,glow:.1});
  }
  return p;
}
