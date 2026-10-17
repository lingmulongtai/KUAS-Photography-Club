import {CampusBuilder,CM} from './campus-architecture.ts';
import * as THREE from 'three';
import {refineWaterSurface} from './water-surface.ts';
import {KAMEOKA_FIELDS,KAMEOKA_TENNIS} from './kameoka-sports.ts';

const WALKS=[[[0,-285],[0,-210],[0,-140],[0,-75],[-15,-25],[-30,30],[-45,120]],
  [[-170,-75],[-80,-75],[0,-75],[75,-75]], [[-15,-260],[30,-260]],
  [[0,-200],[45,-200],[90,-150]], [[0,-140],[40,-140]], [[0,-95],[35,-95]],
  [[-15,-25],[25,-25]], [[-45,30],[-93,30]], [[-45,120],[30,140],[75,140]]] as const;
type Ring=readonly (readonly [number,number])[];
const FIELDS:Ring[]=[...Object.values(KAMEOKA_FIELDS),KAMEOKA_TENNIS];

function insideOrNear(ring:Ring,u:number,v:number){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],c=ring[i],dx=c[0]-a[0],dz=c[1]-a[1];
    if((a[1]>v)!==(c[1]>v)&&u<(c[0]-a[0])*(v-a[1])/(c[1]-a[1])+a[0])inside=!inside;
    const t=Math.max(0,Math.min(1,((u-a[0])*dx+(v-a[1])*dz)/(dx*dx+dz*dz)));
    if(Math.hypot(u-a[0]-dx*t,v-a[1]-dz*t)<4)return true;
  }return inside;
}

export function kameokaClearing(u:number,v:number){
  if(FIELDS.some(ring=>insideOrNear(ring,u,v)))return true;
  for(const path of WALKS)for(let i=1;i<path.length;i++){
    const a=path[i-1],c=path[i],dx=c[0]-a[0],dz=c[1]-a[1];
    const t=Math.max(0,Math.min(1,((u-a[0])*dx+(v-a[1])*dz)/(dx*dx+dz*dz)));
    if(Math.hypot(u-a[0]-dx*t,v-a[1]-dz*t)<6)return true;
  }return false;
}

/** Subdivided mapped surfaces follow the real hillside, including the edge embankments.
 * No broad, centre-height platform can intersect the DEM or float over its lower edge.
 * Circulation widths and painted tennis lines are illustrative, not measured plans. */
export function kameokaGrounds(hf:{height(x:number,z:number):number},center:{x:number;z:number}){
  const b=new CampusBuilder(0,center,0);
  const ground=(u:number,v:number)=>hf.height(center.x+u,center.z+v);
  const surface=(ring:Ring,material:typeof CM[keyof typeof CM])=>{
    const input=ring.map(([x,y])=>new THREE.Vector2(x,y));
    const refined=refineWaterSurface(input,THREE.ShapeUtils.triangulateShape(input,[]),3,40000);
    for(const triangle of refined.triangles){
      const [a,c,d]=triangle.map(i=>{const p=refined.points[i];return [p.x,ground(p.x,p.y)+.2,p.y] as [number,number,number];});
      if((c[2]-a[2])*(d[0]-a[0])-(c[0]-a[0])*(d[2]-a[2])>0)b.triangle(a,c,d,material);
      else b.triangle(a,d,c,material);
    }
  };
  b.part('terraced-pedestrian-walks',()=>{
    for(const path of WALKS)for(let i=1;i<path.length;i++){
      const a=path[i-1],c=path[i],len=Math.hypot(c[0]-a[0],c[1]-a[1]),nx=-(c[1]-a[1])/len,nz=(c[0]-a[0])/len,n=Math.ceil(len/5);
      for(let j=0;j<n;j++){
        const point=(t:number,side:number):[number,number,number]=>{
          const u=a[0]+(c[0]-a[0])*t+nx*side,v=a[1]+(c[1]-a[1])*t+nz*side;return [u,ground(u,v)+.07,v];
        };
        b.quad(point(j/n,-2.6),point(j/n,2.6),point((j+1)/n,2.6),point((j+1)/n,-2.6),CM.paving);
      }
    }
    // The broad cross-campus steps lead up the eastern slope to Tokushikan.
    const a:[number,number,number]=[65,ground(65,-75)+.18,-75],c:[number,number,number]=[79,ground(79,-75)+.18,-75];
    if(c[1]<a[1]-.15)b.stairs(c,a,10,Math.max(2,Math.ceil((a[1]-c[1])/.18)));
    else if(c[1]>a[1]+.15)b.stairs(a,c,10,Math.max(2,Math.ceil((c[1]-a[1])/.18)));
    else b.box(65,79,-80,-70,a[1]-.1,a[1],CM.paving);
  });
  for(const [name,ring] of Object.entries(KAMEOKA_FIELDS))b.part(`sports-${name}`,()=>surface(ring,CM.sportsGround));
  b.part('tennis-painted-area',()=>surface(KAMEOKA_TENNIS,CM.leaves));
  return b.geometry();
}
