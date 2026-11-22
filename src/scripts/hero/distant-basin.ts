import * as THREE from 'three';
import type {loadBuildings} from './buildings-data';
import type {Env} from './env';
import {BUILDINGS_BOX} from './geo';
import {buildSouthOverview,type OverviewBuilding} from './south-overview';

/** Keep Kyoto's measured skyline on the horizon after individual houses become subpixel. */
export function distantBasin(env:Env,scene:THREE.Scene,ground:(x:number,z:number)=>number,
  prepare:(model:THREE.Object3D)=>Promise<unknown>){
  type Survey=Awaited<ReturnType<typeof loadBuildings>>;
  const detail=new THREE.Group(),horizon=new THREE.Group();
  detail.name='kyoto-basin-detail';horizon.name='kyoto-basin-horizon';
  horizon.visible=false;
  scene.add(detail,horizon);
  const surveys:Survey[]=[];
  let building=false,ready=false,requested=false;
  async function build(){
    if(building)return;
    building=true;
    try{
      while(surveys.length){
        const survey=surveys[0],blocks:OverviewBuilding[]=[];
        let processed=0;
        for(const b of survey.boxes){
          if(b.h>=12 || Math.max(b.w,b.d)>=24)blocks.push([b.x,b.z,b.w,b.d,b.h,b.angle,b.ground]);
          if(++processed%4096===0)await new Promise(resolve=>setTimeout(resolve,0));
        }
        for(const p of survey.polys){
          let w=Infinity,n=Infinity,e=-Infinity,s=-Infinity;
          for(let i=0;i<p.ring.length;i+=2){
            w=Math.min(w,p.ring[i]);e=Math.max(e,p.ring[i]);n=Math.min(n,p.ring[i+1]);s=Math.max(s,p.ring[i+1]);
          }
          if(p.h>=12 || Math.max(e-w,s-n)>=24)blocks.push([(w+e)/2,(n+s)/2,e-w,s-n,p.h,0,p.ground]);
          if(++processed%1024===0)await new Promise(resolve=>setTimeout(resolve,0));
        }
        const {mesh}=await buildSouthOverview(env,blocks,ground);
        await prepare(mesh);
        horizon.add(mesh);
        surveys.shift();
      }
      ready=true;
    }finally{building=false;}
  }
  return {detail,register(data:Survey){surveys.push(data);ready=false;},update(x:number,z:number,focal:number){
    const [w,n,e,s]=BUILDINGS_BOX;
    const distance=Math.hypot(Math.max(w-x,0,x-e),Math.max(n-z,0,z-s));
    const cutoff=Math.max(19000,focal*18);
    if(distance>cutoff*.65 && !ready && !requested){
      requested=true;
      void build().catch(error=>console.warn('Distant Kyoto skyline unavailable',error)).finally(()=>{requested=false;});
    }
    const far=ready && distance>cutoff*(horizon.visible ? .92 : 1);
    horizon.visible=far;
    detail.visible=!far;
    return far;
  }};
}
