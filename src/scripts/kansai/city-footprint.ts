import {CLASS, USAGE, type BoxBuilding, type PolyBuilding} from '../hero/buildings-data.ts';
import {toLocal} from '../hero/geo.ts';
import type {Ring} from './coordinates';

/** The regional survey has footprint class and height, but often no recorded use. */
export function facadeKind(solid:boolean, area:number, height:number){
  if(!solid && height<=12 && area<320)return CLASS.wooden | USAGE.house<<2;
  if(height<4.5 && area<60)return CLASS.shed;
  return CLASS.sturdy | USAGE.unknown<<2;
}

export type StreetBuilding=BoxBuilding|PolyBuilding;

/** Fit the same oriented boxes used in Kyoto. Concave outlines stay polygons. */
export function cityFootprint(ring:Ring, h:number, ground:number, kind:number, roof?:BoxBuilding['roof'], ridgeAngle?:number):StreetBuilding|null{
  const points=ring.map(([lon,lat])=>toLocal(lat,lon));
  const origin=points[0];
  if(points.length<3)return null;
  let area=0,longest=0,angle=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    area+=(a.x-origin.x)*(b.z-origin.z)-(b.x-origin.x)*(a.z-origin.z);
    const dx=b.x-a.x,dz=b.z-a.z,len=dx*dx+dz*dz;
    if(len>longest){angle=Math.atan2(dz,dx);longest=len;}
  }
  if(ridgeAngle!==undefined)angle=ridgeAngle;
  const c=Math.cos(angle),s=Math.sin(angle);
  let left=Infinity,right=-Infinity,back=Infinity,front=-Infinity;
  for(const p of points){
    const x=p.x-origin.x,z=p.z-origin.z,u=x*c+z*s,v=-x*s+z*c;
    left=Math.min(left,u);right=Math.max(right,u);back=Math.min(back,v);front=Math.max(front,v);
  }
  let w=right-left,d=front-back;
  if(Math.abs(area)*.5>=.86*w*d && Math.max(w,d)<=63.75 && Math.min(w,d)>=1){
    const u=(left+right)*.5,v=(back+front)*.5;
    if(d>w && ridgeAngle===undefined){[w,d]=[d,w];angle+=Math.PI/2;}
    return {x:origin.x+c*u-s*v,z:origin.z+s*u+c*v,w,d,angle,h,ground,kind,roof};
  }
  return {ring:Float32Array.from(points.flatMap(p=>[p.x,p.z])),h,ground,kind};
}
