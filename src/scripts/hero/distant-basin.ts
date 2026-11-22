import * as THREE from 'three';
import type {loadBuildings} from './buildings-data';
import {prepareSteps} from './task-yield';
import {loadBinary} from './data';
import type {Env} from './env';
import {BUILDINGS_BOX} from './geo';
import {buildSouthOverview,overviewBatch,type OverviewBuilding} from './south-overview';

type Survey=Awaited<ReturnType<typeof loadBuildings>>;

export function* horizonBlockSteps(survey:Survey){
  const blocks:OverviewBuilding[]=[];
  let processed=0;
  for(const b of survey.boxes){
    if(b.h>=12 || Math.max(b.w,b.d)>=24)blocks.push([b.x,b.z,b.w,b.d,b.h,b.angle,b.ground]);
    if(++processed%4096===0)yield;
  }
  for(const p of survey.polys){
    let w=Infinity,n=Infinity,e=-Infinity,s=-Infinity;
    for(let i=0;i<p.ring.length;i+=2){
      w=Math.min(w,p.ring[i]);e=Math.max(e,p.ring[i]);n=Math.min(n,p.ring[i+1]);s=Math.max(s,p.ring[i+1]);
    }
    if(p.h>=12 || Math.max(e-w,s-n)>=24)blocks.push([(w+e)/2,(n+s)/2,e-w,s-n,p.h,0,p.ground]);
    if(++processed%1024===0)yield;
  }
  return blocks;
}

export function horizonBatches(env:Env,bytes:Uint8Array<ArrayBuffer>){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const count=view.getUint32(0,true),batches:THREE.InstancedMesh[]=[];
  let offset=4;
  try{
    if(!count || count>32)throw Error('Invalid Kyoto horizon header');
    for(let i=0;i<count;i++){
      const instances=view.getUint32(offset,true),start=offset+20;
      if(!instances || instances>(bytes.length-start)/64)throw Error('Truncated Kyoto horizon');
      const batch=overviewBatch(env,0).mesh;batches.push(batch);
      batch.instanceMatrix=new THREE.InstancedBufferAttribute(new Float32Array(bytes.buffer,bytes.byteOffset+start,instances*16),16);
      batch.count=instances;
      const box=new THREE.Vector3(view.getFloat32(offset+4,true),view.getFloat32(offset+8,true),view.getFloat32(offset+12,true));
      batch.boundingSphere=new THREE.Sphere(box,view.getFloat32(offset+16,true));
      offset=start+instances*64;
    }
    if(offset!==bytes.byteLength)throw Error('Unexpected Kyoto horizon length');
    return batches;
  }catch(error){
    for(const b of batches){b.geometry.dispose();b.dispose();(b.material as THREE.Material).dispose();}
    throw error;
  }
}

/** Keep Kyoto's measured skyline on the horizon after individual houses become subpixel. */
export function distantBasin(env:Env,scene:THREE.Scene,ground:(x:number,z:number)=>number,
  prepare:(model:THREE.Object3D)=>Promise<unknown>){
  const detail=new THREE.Group(),horizon=new THREE.Group();
  detail.name='kyoto-basin-detail';horizon.name='kyoto-basin-horizon';
  horizon.visible=false;
  scene.add(detail,horizon);
  const surveys:Survey[]=[];
  let building=false,ready=false,requested=false;
  let archived=false,reading=true;
  // Start after the core survey is available, ahead of the first trip outside Kyoto.
  // If the baked data cannot be read, the original surveys below still build the same skyline.
  void loadBinary('kansai/kyoto-horizon.bin.gz','low').then(async bytes=>{
    const batches=horizonBatches(env,bytes);
    try{
      await prepare(batches[0]);
      horizon.add(...batches);
      archived=ready=true;surveys.length=0;
    }catch(error){
      for(const b of batches){b.geometry.dispose();b.dispose();(b.material as THREE.Material).dispose();}
      throw error;
    }
  }).catch(error=>console.warn('Using live surveys for the Kyoto horizon',error)).finally(()=>{reading=false;});
  async function build(){
    if(building)return;
    building=true;
    try{
      while(surveys.length){
        const blocks=await prepareSteps(horizonBlockSteps(surveys[0]));
        const {mesh}=await buildSouthOverview(env,blocks,ground);
        await prepare(mesh);
        horizon.add(mesh);
        surveys.shift();
      }
      ready=true;
    }finally{building=false;}
  }
  return {detail,register(data:Survey){if(!archived){surveys.push(data);ready=false;}},update(x:number,z:number,focal:number){
    const [w,n,e,s]=BUILDINGS_BOX;
    const distance=Math.hypot(Math.max(w-x,0,x-e),Math.max(n-z,0,z-s));
    const cutoff=Math.max(19000,focal*18);
    if(distance>cutoff*.65 && !ready && !requested && !reading){
      requested=true;
      void build().catch(error=>console.warn('Distant Kyoto skyline unavailable',error)).finally(()=>{requested=false;});
    }
    const far=ready && distance>cutoff*(horizon.visible ? .92 : 1);
    horizon.visible=far;
    detail.visible=!far;
    return far;
  }};
}
