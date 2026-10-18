import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {CampusBuilder,CM} from './campus-architecture.ts';
import {KAMEOKA_ROOFS} from './kameoka-campus-layout.ts';
import {createCampusMesh} from './campus';
import type {Env} from './env';
import {kameokaGrounds} from './kameoka-grounds.ts';

export const KAMEOKA_CENTER={x:-18824.8865,z:1105.346};
type Ground={height(x:number,z:number):number};
type P=[number,number,number];
type Material=typeof CM[keyof typeof CM];
export const KAMEOKA_BUILDINGS=[
  {id:'kofukan',u:30,v:-260,w:59,d:69}, {id:'kusufukan',u:45,v:-200,w:39,d:57},
  {id:'gakushikan',u:40,v:-140,w:25,d:28}, {id:'dormitory',u:35,v:-95,w:28,d:34},
  {id:'ryokufukan',u:90,v:-150,w:30,d:60}, {id:'tokushikan',u:105,v:-75,w:48,d:65},
  {id:'yushinkan',u:-80,v:-75,w:35,d:55}, {id:'bio',u:-155,v:-65,w:20,d:80},
  {id:'hobunkan',u:145,v:-170,w:25,d:65}, {id:'oick',u:160,v:-195,w:18,d:25},
  {id:'library',u:41,v:-19,w:53,d:60}, {id:'hakuun',u:-14,v:-174,w:36,d:52},
  {id:'universityHall',u:-35,v:-105,w:25,d:30}, {id:'gym',u:-93,v:57,w:42,d:109},
  {id:'clubhouse',u:-53,v:91,w:38,d:44},
] as const;

/** Five building outlines are mapped. The others are approximate placements from the
 * official illustrated map (15–25 m uncertainty), not architectural survey dimensions. */
export function isKameokaBuilding(x:number,z:number){
  const u=x-KAMEOKA_CENTER.x,v=z-KAMEOKA_CENTER.z;
  return KAMEOKA_BUILDINGS.some(b=>Math.abs(u-b.u)<b.w/2+10&&Math.abs(v-b.v)<b.d/2+10);
}

function flatRoof(b:CampusBuilder,ring:readonly (readonly [number,number])[],y:number,m:Material=CM.roof){
  const contour=ring.map(p=>new THREE.Vector2(...p));
  for(const t of THREE.ShapeUtils.triangulateShape(contour,[])){
    let [a,c,d]=t.map(i=>[ring[i][0],y,ring[i][1]] as P);
    if((c[2]-a[2])*(d[0]-a[0])-(c[0]-a[0])*(d[2]-a[2])<0)[c,d]=[d,c];
    b.quad(a,c,d,a,m);
  }
}
function shell(b:CampusBuilder,ring:readonly (readonly [number,number])[],floors:number,storey=3.8,m:Material=CM.white,y0=0){
  const r=ring.map(p=>[...p] as [number,number]);
  let area=0;for(let i=0;i<r.length;i++){const q=r[(i+1)%r.length];area+=r[i][0]*q[1]-q[0]*r[i][1];}
  if(area<0)r.reverse();
  const top=y0+floors*storey;
  for(let i=0;i<r.length;i++){
    const a=r[i],c=r[(i+1)%r.length],len=Math.hypot(c[0]-a[0],c[1]-a[1]);
    const wins:[number,number,number,number][]=[];
    const bays=Math.max(1,Math.floor(len/3.3));
    if(len>2)for(let f=0;f<floors;f++)for(let j=0;j<bays;j++){
      const bay=len/bays;wins.push([j*bay+.4,(j+1)*bay-.4,y0+f*storey+.8,y0+f*storey+storey-.65]);
    }
    b.facade(a,c,y0,top,wins,m);
    // A deep footing meets the sloping ground; each facility has its own floor datum.
    if(y0===0)b.facade(a,c,-5,y0,[],CM.concrete);
    b.beam([a[0],top+.12,a[1]],[c[0],top+.12,c[1]],.45,.3,CM.metal);
  }
  flatRoof(b,r,top+.2);
}
const rect=(w:number,d:number):[number,number][]=>[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];

/** Static architecture with the same recessed glazing, frames and rails as Uzumasa.
 * Individually grounded buildings preserve the campus's terraced hillside. */
export function kameokaArchitecture(hf:Ground){
  const geometries:THREE.BufferGeometry[]=[],facilities:{id:string;ground:number;start:number;count:number}[]=[];
  let vertex=0;
  const facility=(id:string,u:number,v:number,build:(b:CampusBuilder)=>void)=>{
    const center={x:KAMEOKA_CENTER.x+u,z:KAMEOKA_CENTER.z+v},ground=hf.height(center.x,center.z)+.18;
    const b=new CampusBuilder(ground,center,0);b.part(id,()=>build(b));const geo=b.geometry();
    facilities.push({id,ground,start:vertex,count:geo.getAttribute('position').count});vertex+=geo.getAttribute('position').count;geometries.push(geo);
  };
  const mapped=(id:keyof typeof KAMEOKA_ROOFS,u:number,v:number,floors:number,m:Material,extra?:(b:CampusBuilder)=>void)=>
    facility(id,u,v,b=>{shell(b,KAMEOKA_ROOFS[id].map(([x,z])=>[x-u,z-v] as [number,number]),floors,3.8,m);extra?.(b);});
  mapped('kofukan',30,-260,2,CM.brick,b=>{
    // Projecting glazed gable entrance, visible above the curved low hall.
    b.facade([-23,-6],[-23,6],0,9,[[.7,11.3,.5,8.8]],CM.brick);
    b.quad([-30,8,-7],[-23,12.5,0],[-23,8,7],[-30,8,-7],CM.glass);
    b.quad([-30,8,-7],[-30,8,7],[-23,12.5,0],[-30,8,-7],CM.glass);
    b.beam([-30,8,-7],[-23,12.5,0],.22,.22,CM.metal);b.beam([-23,12.5,0],[-30,8,7],.22,.22,CM.metal);
  });
  mapped('kusufukan',45,-200,2,CM.white,b=>{
    b.box(-20,-17,-19,19,3.8,4.1,CM.concrete);b.rail([-20,4.1,-19],[-20,4.1,19],false);
    for(const z of [-18,-6,6,18])b.box(-20,-19,z-.2,z+.2,0,8,CM.white);
  });
  facility('gakushikan',40,-140,b=>{
    shell(b,rect(25,28),2,3.8,CM.white,3.8);
    b.box(-12.5,12.5,-14,14,3.55,3.8,CM.concrete);
    for(const u of [-10,0,10])for(const v of [-11,11])b.box(u-.4,u+.4,v-.4,v+.4,-2,3.8,CM.concrete);
    b.box(5,12,2,13,-3,3.8,CM.white);b.box(-16,0,-3,3,3.5,3.8,CM.concrete);b.rail([-16,3.8,-3],[0,3.8,-3],false);
  });
  facility('dormitory',35,-95,b=>{
    for(const side of [-1,1]){const u=side*10.5;shell(b,rect(7,34).map(([x,z])=>[x+u,z]),3,3.3,CM.white);}
    shell(b,[[-14,10],[14,10],[14,17],[-14,17]],3,3.3,CM.white);
  });
  facility('ryokufukan',90,-150,b=>{
    shell(b,rect(20,60),2,3.8,CM.white);shell(b,[[10,-30],[27,-30],[27,-14],[10,-14]],2,3.8,CM.white);
  });
  facility('tokushikan',105,-75,b=>{
    shell(b,rect(28,65),3,3.8,CM.white);
    // The raised cylindrical centre and colonnaded entrance are its defining silhouette.
    const n=24,r=10,ring=Array.from({length:n},(_,i)=>[-14+Math.cos(i*2*Math.PI/n)*r,Math.sin(i*2*Math.PI/n)*r] as [number,number]);
    shell(b,ring,5,3.65,CM.white);
    for(const v of [-8,8])b.beam([-25,0,v],[-25,5,v],.7,.7,CM.concrete);
    b.box(-26,-17,-11,11,4.8,5.2,CM.concrete);b.stairs([-38,-2,0],[-26,0,0],13,12);
  });
  facility('yushinkan',-80,-75,b=>{
    shell(b,rect(35,55),3,3.5,CM.brick);
    b.facade([-21,-7],[-21,7],0,13,[[.7,13.3,.5,12]],CM.brick);
    for(let i=0;i<12;i++){
      const z0=-9+i*1.5,z1=z0+1.5,y0=13.8-.013*z0*z0,y1=13.8-.013*z1*z1;
      b.quad([-23,y0,z0],[-23,y1,z1],[-15,y1,z1],[-15,y0,z0],CM.roof);
    }
    b.box(-25,-17,-9,9,3.7,4,CM.concrete);b.stairs([-34,-2,0],[-25,0,0],10,12);
  });
  facility('bio',-155,-65,b=>{
    shell(b,rect(20,80),11,3.55,CM.wall);
    b.box(-14,-10,-12,12,3.3,3.6,CM.metal);b.beam([-14,0,-10],[-14,3.3,-10],.45,.45,CM.concrete);
    b.beam([-14,0,10],[-14,3.3,10],.45,.45,CM.concrete);
    // Alternating half-flights, not a single impossible full-height ramp.
    for(let f=0;f<10;f++){
      const y=f*3.55;
      b.stairs([11.7,y,35],[11.7,y+1.775,40.5],2.4,11);
      b.box(10.3,15.5,40.5,42.5,y+1.575,y+1.775,CM.concrete);
      b.stairs([14.1,y+1.775,40.5],[14.1,y+3.55,35],2.4,11);
      b.box(10.3,15.5,33,35,y+3.35,y+3.55,CM.concrete);
    }
  });
  facility('hobunkan',145,-170,b=>{
    shell(b,rect(25,65),2,4.1,CM.terracotta);
    b.box(-15,-12,-29,-17,3.9,4.1,CM.concrete);b.stairs([-23,-2,-23],[-15,0,-23],7,13,CM.terracotta);
    // Curved window heads and the projecting arched entrance canopy.
    for(let j=0;j<12;j++){
      const v0=-7+j*14/12,v1=v0+14/12,h0=10.4-.04*v0*v0,h1=10.4-.04*v1*v1;
      b.quad([-18,h0,v0],[-18,h1,v1],[-12,h1,v1],[-12,h0,v0],CM.roof);
    }
    for(const v of [-6,6])b.beam([-17,0,v],[-17,8,v],.65,.65,CM.concrete);
  });
  facility('oick',160,-195,b=>shell(b,rect(18,25),1,4.4,CM.terracotta));
  mapped('library',41,-19,2,CM.white,b=>{
    b.box(7,20,-24,-10,7.6,11.4,CM.white);b.box(-29,-20,-12,8,3.8,4.2,CM.metal);
    b.stairs([-47,-3,-2],[-29,0,-2],18,18,CM.terracotta);
    for(const v of [-10,6])b.beam([-29,-2,v],[-29,3.8,v],.6,.6,CM.concrete);
  });
  mapped('hakuun',-14,-174,2,CM.white);
  facility('universityHall',-35,-105,b=>shell(b,rect(25,30),2,4,CM.white));
  facility('gym',-93,57,b=>{
    // OSM's long outline combines a full-width arena with a narrow southern annex.
    shell(b,[[-21,-50],[21,-50],[21,8],[-21,8]],1,11,CM.brick);
    shell(b,[[4,8],[20,8],[20,59],[4,59]],2,3.8,CM.white);
    for(let i=0;i<16;i++){
      const u0=-23+i*46/16,u1=u0+46/16,y0=11.3+3.5*Math.sin(Math.PI*(u0+23)/46),y1=11.3+3.5*Math.sin(Math.PI*(u1+23)/46);
      b.quad([u0,y0,-51],[u0,y0,9],[u1,y1,9],[u1,y1,-51],CM.roof);
      b.quad([u0,11.2,-51],[u0,y0,-51],[u1,y1,-51],[u1,11.2,-51],CM.brick);
      b.quad([u1,11.2,9],[u1,y1,9],[u0,y0,9],[u0,11.2,9],CM.brick);
    }
    b.stairs([-15,-2,-62],[-15,0,-50],10,12);
  });
  facility('clubhouse',-53,91,b=>{
    for(const u of [-15,15])shell(b,rect(8,44).map(([x,z])=>[x+u,z]),2,3.3,CM.white);
    shell(b,[[-19,14],[19,14],[19,22],[-19,22]],2,3.3,CM.white);
  });
  const geometry=mergeGeometries(geometries)!;geometries.forEach(g=>g.dispose());geometry.userData.facilities=facilities;
  return geometry;
}

export function buildKameokaCampus(env:Env,hf:Ground){
  const parts=[kameokaArchitecture(hf),kameokaGrounds(hf,KAMEOKA_CENTER)];
  const geo=mergeGeometries(parts)!;parts.forEach(g=>g.dispose());
  return createCampusMesh({...env,uHighlight:{value:1}},geo);
}
