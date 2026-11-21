import * as THREE from 'three';
import type {PolyBuilding} from './buildings-data';
import type {Part} from './landmarks';
import {block} from './compound-models';

// The simplified runtime polygons preserve these PLATEAU outlines, but quantize the platform sheds to 4 m.
const survey=[
  {id:'26100-bldg-2050012',bounds:[-5180.1,2654.4,-5116.3,2719.8],height:13.9},
  {id:'26100-bldg-2005345',bounds:[-5148.8,2700.3,-5138.2,2806],height:10.4},
  {id:'26100-bldg-2005344',bounds:[-5135.2,2700.7,-5123.2,2786.5],height:10.7},
  {id:'26100-bldg-2005323',bounds:[-5162,2719.5,-5150.4,2897.8],height:6.7},
];
const concrete:Part['color']=[.28,.27,.24],steel:Part['color']=[.24,.25,.24],silver:Part['color']=[.38,.39,.38];
const glass:Part['color']=[.045,.085,.10],tactile:Part['color']=[.48,.35,.10];

function slab(parts:Part[],ring:Float32Array,base:number,depth:number,color:Part['color']){
  const points:THREE.Vector2[]=[];
  for(let i=0;i<ring.length;i+=2)points.push(new THREE.Vector2(ring[i],-ring[i+1]));
  const geo=new THREE.ExtrudeGeometry(new THREE.Shape(points),{depth,bevelEnabled:false});
  parts.push({geo:geo.rotateX(-Math.PI/2).translate(0,base,0),color,glow:.12});
}

function crossSection(ring:Float32Array,z:number){
  let left=Infinity,right=-Infinity;
  for(let i=0,j=ring.length-2;i<ring.length;j=i,i+=2){
    if((ring[i+1]>z)===(ring[j+1]>z))continue;
    const x=ring[i]+(ring[j]-ring[i])*(z-ring[i+1])/(ring[j+1]-ring[i+1]);
    left=Math.min(left,x);right=Math.max(right,x);
  }
  return {left,right,x:(left+right)/2};
}

/** Surveyed plan and heights, with three open island platforms below the bridge concourse.
 * The diagram establishes access and levels. Bay spacing and finishes are illustrative.
 * https://www.hankyu.co.jp/station/pdf/map/katsura.pdf */
export function katsuraStation(polys:PolyBuilding[],ground:(x:number,z:number)=>number){
  const parts:Part[]=[],replaced=new Set<PolyBuilding>();
  for(const p of polys){
    const r=p.ring;
    if(r[0]< -5190||r[0]> -5110||r[1]<2650||r[1]>2905)continue;
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(let i=0;i<r.length;i+=2){
      bounds[0]=Math.min(bounds[0],r[i]);bounds[1]=Math.min(bounds[1],r[i+1]);
      bounds[2]=Math.max(bounds[2],r[i]);bounds[3]=Math.max(bounds[3],r[i+1]);
    }
    const record=survey.find(s=>s.bounds.every((v,i)=>Math.abs(v-bounds[i])<1.2));
    if(!record)continue;
    replaced.add(p);
    const [west,north,east,south]=bounds,base=ground(r[0],r[1])+p.ground;
    const top=base+record.height;
    if(record===survey[0]){
      slab(parts,r,base+6.8,.65,concrete);
      slab(parts,r,base+7.45,top-base-7.8,glass);
      slab(parts,r,top-.35,.35,silver);
      // Keep the running tracks open under the second-floor ticket hall.
      for(const z of [north+4,south-5]){
        const section=crossSection(r,z);
        for(const x of [section.left+1,section.right-1])block(parts,.9,6.8,.9,x,base+3.4,z,steel);
      }
      for(const x of [west+2,east-3])block(parts,3.3,7,4,x,base+3.5,north+4,concrete);
      continue;
    }
    slab(parts,r,base,.95,concrete);
    slab(parts,r,top-.26,.26,silver);
    for(let z=north+4;z<south-2;z+=12){
      const {x,left,right}=crossSection(r,z);
      const h=top-base-1.21;
      block(parts,.26,h,.30,x,base+.95+h/2,z,steel);
      const width=right-left;
      block(parts,width-.2,.20,.32,x,top-.36,z,steel);
    }
    for(let z=north+1;z<south-1;z+=6){
      const end=Math.min(z+6,south-1),a=crossSection(r,z),b=crossSection(r,end);
      for(const key of ['left','right'] as const){
        const offset=key==='left'?.65:-.65,dx=b[key]-a[key];
        const geo=new THREE.BoxGeometry(.28,.045,Math.hypot(dx,end-z));
        geo.rotateY(Math.atan2(dx,end-z)).translate((a[key]+b[key])/2+offset,base+.98,(z+end)/2);
        parts.push({geo,color:tactile,glow:.12});
      }
    }
    // Stairs ascend along each island into the adjoining concourse footprint.
    for(let i=0;i<24;i++){
      const z=north+14-i*.54,{x}=crossSection(r,z);
      const h=(i+1)*.245;
      block(parts,2.3,h,.56,x,base+.95+h/2,z,concrete);
    }
  }
  return {parts,replaced,complete:replaced.size===survey.length};
}
