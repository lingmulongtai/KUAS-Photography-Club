import * as THREE from 'three';
import {lonLat,tileXY} from '../kansai/coordinates';
import {inflate,json} from '../kansai/sources';
import type {Env} from './env';
import {residentHouseBatch} from './buildings';
import {facadeKind} from '../kansai/city-footprint';
import type {PlacedHouse} from './panorama-blocks';
import {ORIGIN,M_PER_DEG_LAT,M_PER_DEG_LON,toLocal,type Box} from './geo';

type Tile={key:string;x:number;y:number};
type Batch={group:THREE.Group;batches:{mesh:Awaited<ReturnType<typeof residentHouseBatch>>;count:number}[];mask:THREE.DataTexture};
function dispose(batch:Batch){
  for(const {mesh} of batch.batches){mesh.geometry.dispose();mesh.material.dispose();}
  batch.mask.dispose();
}
const district=(x:number,y:number)=>x+'/'+y;

// A district draws its flat and pitched roofs from the same 8-byte footprint records.
export async function regionalNeighborhoods(scene:THREE.Scene,env:Env,ground:(x:number,z:number)=>number,
  lite:boolean,prepare:(model:THREE.Object3D)=>Promise<unknown>){
  const {tiles}=await json<{tiles:Record<string,number>}>('neighborhoods/index.json');
  const activeBox={value:new THREE.Vector4(1,1,0,0)};
  const loaded=new Map<string,Batch>(),pending=new Set<string>(),retry=new Map<string,number>();
  let wanted=new Map<string,Tile>(),previous='',next=0,near=new Set<string>(),ready=new Map<boolean,Promise<unknown>>();
  const maskFor=({x,y}:Tile,mask:THREE.DataTexture)=>{
    const data=mask.image.data as Uint8Array;
    for(let i=0;i<256;i++)data[i]=near.has('16/'+(x*16+i%16)+'/'+(y*16+(i>>4)))?255:0;
    mask.needsUpdate=true;
  };
  async function create(t:Tile){
    const res=await fetch('/kansai/neighborhoods/'+t.x+'-'+t.y+'.bin.gz');
    if(!res.ok)throw new Error('Roof survey '+res.status);
    const bytes=new Uint8Array(await inflate(new Uint8Array(await res.arrayBuffer())));
    if(!wanted.has(t.key))return;
    const count=tiles[t.key],data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(bytes.length!==count*8)throw new Error('Incomplete roof survey '+t.key);
    const roofs=[{houses:[] as PlacedHouse[],slots:[] as number[]},{houses:[] as PlacedHouse[],slots:[] as number[]}];
    // Scatter the prefix uniformly so far LOD retains streets throughout the district.
    let stride=1597;
    function gcd(a:number,b:number):number{return b?gcd(b,a%b):a;}
    while(gcd(stride,count)!==1)stride++;
    for(let i=0;i<count;i++){
      const k=((i*stride)%count)*8,u=data.getUint16(k,true)/65535,v=data.getUint16(k+2,true)/65535;
      const [lon,lat]=lonLat(t.x+u,t.y+v,12),{x,z}=toLocal(lat,lon);
      const h=bytes[k+6],w=bytes[k+4],d=bytes[k+5],base=ground(x,z);
      const kind=facadeKind(false,w*d,h),pitched=(kind&3)===0;
      const batch=roofs[Number(pitched)],angle=bytes[k+7]*Math.PI/256;
      const b={x,z,w,d,h,kind,angle,ground:0};
      batch.houses.push({b,y:base,seed:(u*71.31+v*13.17)%1});
      batch.slots.push(Math.min(15,Math.floor(v*16))*16+Math.min(15,Math.floor(u*16)));
      if(i%2048===2047){await new Promise(r=>setTimeout(r,0));if(!wanted.has(t.key))return;}
    }
    const mask=new THREE.DataTexture(new Uint8Array(256),16,16,THREE.RedFormat);
    mask.minFilter=mask.magFilter=THREE.NearestFilter;
    const batch:Batch={group:new THREE.Group(),batches:[],mask};
    batch.group.name='regional-neighborhood-'+t.key;
    try{
      for(const [i,{houses,slots}] of roofs.entries()){
        if(!houses.length)continue;
        const pitched=i===1;
        const mesh=await residentHouseBatch(env,houses,pitched,slots,mask,activeBox);
        batch.group.add(mesh);batch.batches.push({mesh,count:houses.length});
        if(!wanted.has(t.key)){dispose(batch);return;}
        if(!ready.has(pitched))ready.set(pitched,prepare(mesh).catch(error=>{ready.delete(pitched);throw error;}));
        await ready.get(pitched);
      }
      if(!wanted.has(t.key)){dispose(batch);return;}
      maskFor(t,mask);scene.add(batch.group);loaded.set(t.key,batch);
    }catch(error){dispose(batch);throw error;}
  }
  function setNear(keys:Set<string>){
    near=keys;
    for(const [key,b] of loaded){const t=wanted.get(key);if(t)maskFor(t,b.mask);}
  }
  function update(x:number,z:number,dirX:number,dirZ:number,now:number,detail:Box|null){
    if(now<next)return;
    next=now+.18;
    activeBox.value.set(...(detail??[1,1,0,0] as Box));
    const [tx,ty]=tileXY(ORIGIN.lon+x/M_PER_DEG_LON,ORIGIN.lat-z/M_PER_DEG_LAT,12);
    const heading=Math.atan2(dirX,-dirZ),signature=[Math.floor(tx*4),Math.floor(ty*4),Math.round(heading*5)].join('/');
    if(signature!==previous){
      previous=signature;
      const jobs:{t:Tile;score:number}[]=[];
      for(let j=-4;j<=4;j++)for(let i=-4;i<=4;i++){
        const a=Math.floor(tx)+i,b=Math.floor(ty)+j,key=district(a,b);
        if(!tiles[key])continue;
        const dx=a+.5-tx,dz=b+.5-ty,distance=Math.hypot(dx,dz);
        const forward=(dx*dirX+dz*dirZ)/Math.max(.01,distance);
        if(distance>(lite?2.7:3.65) || (distance>1.55 && forward<.15))continue;
        jobs.push({t:{key,x:a,y:b},score:distance*(1-.4*forward)});
      }
      wanted=new Map(jobs.sort((a,b)=>a.score-b.score).map(({t})=>[t.key,t]));
      for(const [key,b] of loaded)if(!wanted.has(key)){
        const [a,row]=key.split('/').map(Number);
        if(Math.hypot(a+.5-tx,row+.5-ty)<(lite?3.3:4.4)){b.group.visible=false;continue;}
        scene.remove(b.group);dispose(b);loaded.delete(key);
      }
      for(const key of wanted.keys()){const b=loaded.get(key);if(b){b.group.visible=true;maskFor(wanted.get(key)!,b.mask);}}
    }
    for(const t of wanted.values()){
      const batch=loaded.get(t.key);
      if(!batch)continue;
      const distance=Math.max(0,Math.hypot(t.x+.5-tx,t.y+.5-ty)-.65);
      for(const {mesh,count} of batch.batches)
        mesh.geometry.instanceCount=Math.max(1,Math.ceil(count/(1+distance*distance*(lite?2.2:1.4))));
    }
    for(const t of wanted.values()){
      if(pending.size>=2)break;
      if(loaded.has(t.key)||pending.has(t.key)||(retry.get(t.key)??0)>now)continue;
      pending.add(t.key);
      void create(t).catch(error=>{retry.set(t.key,performance.now()/1000+15);console.warn('Distant neighborhood unavailable',t.key,error);})
        .finally(()=>pending.delete(t.key));
    }
  }
  return {update,setNear};
}
