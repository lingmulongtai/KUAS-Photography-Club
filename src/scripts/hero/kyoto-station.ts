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
  wing(-140,-85,-43,-19,59.8);
  wing(-85,-40,13,24,42);
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
  // North entrance and the approximately 150 m space frame above the concourse.
  // https://www.obayashi.co.jp/chronicle/works/21900.html
  const v = (x:number,y:number,z:number) => new THREE.Vector3(x,y,z);
  for(let i=0;i<=15;i++){
    const x=-85+i*10;
    for(let j=0;j<6;j++){
      const z=-43+j*11, y=roofY(x,z), next=roofY(x,z+11);
      beam(v(x,y,z),v(x,next,z+11),.38);
      beam(v(x,y-1.8,z),v(x,next,z+11),.24);
      if(i<15)beam(v(x,y,z),v(x+10,roofY(x+10,z),z),.28);
    }
    beam(v(x,7,-43),v(x,roofY(x,-43),-43),.38);
  }
  for(let y=8;y<47;y+=4.5)block(p,150,.28,.45,-10,y,-43,metal);
  // Visible from the plaza through the glazing: terraces, galleries and the skyway parapets.
  for(const y of [12,19,26,33]){
    block(p,23,1.1,39,54,y,2,stone);
    block(p,.35,1.4,39,42.5,y+1,2,metal);
  }
  for(const z of [19,23])block(p,205,1.3,.18,-32,46,z,metal);
  return p;
}

// Profile shared by the steel and glass so the panes meet the frame at every bay.
const roofY=(x:number,z:number)=>47.5+3.2*Math.sin(Math.PI*(x+85)/150)+7.8*Math.sin((z+43)/66*Math.PI*.58);

/** One transparent surface for the north curtain wall and roof, with no duplicate internal faces. */
export function stationGlazing(){
  const vertices:number[]=[];
  type P=[number,number,number];
  const quad=(a:P,b:P,c:P,d:P)=>vertices.push(...a,...b,...c,...a,...c,...d);
  for(let i=0;i<15;i++){
    const x=-85+i*10, end=x+10;
    quad([x,7,-43.2],[x,roofY(x,-43),-43.2],[end,roofY(end,-43),-43.2],[end,7,-43.2]);
    for(let j=0;j<6;j++){
      const z=-43+j*11, next=z+11;
      quad([x,roofY(x,z),z],[x,roofY(x,next),next],[end,roofY(end,next),next],[end,roofY(end,z),z]);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals();
  return geometry;
}

/** The survey draws its plaza layers in flat display colours: white kerbs and
 * paving, mid-grey carriageway and a bright planting green. Classify them so
 * they can take the same asphalt and paving as the terrain's street field. */
export function plazaSurface(source:{name:string;color:{r:number;g:number;b:number}}){
  if(!source.name.startsWith('Plaza-'))return 0;
  const {r,g,b}=source.color;
  if(g>r*1.3&&g>b*1.3)return 3;
  return r+g+b>2.1?2:1;
}
