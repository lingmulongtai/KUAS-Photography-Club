import type {CesiumWidget} from 'cesium';
import {C} from './engine';
import {tileXY,lonLat,type Point} from './coordinates';
import {buildTile} from './model-tile';
import {tileQueue} from './tile-queue';
import type {Surveys} from './surveys';
import type {distantModels} from './skyline';

export function attachModels(widget:CesiumWidget,surveys:Surveys,distant:Awaited<ReturnType<typeof distantModels>>,
  update:(count:number)=>void){
  const queue=tileQueue();
  const scene=widget.scene,resident=new Map<string,Awaited<ReturnType<typeof buildTile>>>(),pending=new Set<string>();
  const prepared=new Map<string,Awaited<ReturnType<typeof buildTile>>>();
  let wanted=new Map<string,Point>(),alive=true,previous='',timer=0,readyCount=-1;
  const retry=new Map<string,number>();
  let nextPlan=0,maskStart=0;
  function visibleTarget(){
    const ray=scene.camera.getPickRay(new C.Cartesian2(scene.canvas.clientWidth/2,scene.canvas.clientHeight/2));
    const position=ray&&scene.globe.pick(ray,scene);if(!position)return;
    const geo=C.Cartographic.fromCartesian(position);
    return [C.Math.toDegrees(geo.longitude),C.Math.toDegrees(geo.latitude)] as Point;
  }
  function plan(){
    const target=visibleTarget();if(!target)return;
    const [tx,ty]=tileXY(...target,16), cx=Math.floor(tx),cy=Math.floor(ty);
    const altitude=scene.camera.positionCartographic.height;
    void surveys.updatePhoto(target,altitude);
    const near=new Set<string>();
    for(const [key,tile] of resident)if(tile.primitive?.ready)near.add(key);
    if(near.size!==readyCount){readyCount=near.size;update(readyCount);}
    distant.update(target,altitude,near);
    const overview=altitude>10500;
    const radius=altitude<600?2:altitude<1700?3:4;
    const signature=cx+'/'+cy+'/'+radius+'/'+overview;
    if(previous===signature)return;previous=signature;
    const entries:{k:string;p:Point;distance:number}[]=[];
    if(!overview)for(let j=-radius;j<=radius;j++)for(let i=-radius;i<=radius;i++){
      const x=cx+i,y=cy+j,p:Point=[x,y];
      const bounds=[lonLat(x,y,16),lonLat(x+1,y+1,16)];
      // Include coastal slivers even when the centre of this tile is open water.
      if(bounds[1][0]<134.1||bounds[0][0]>136.6||bounds[1][1]>36||bounds[0][1]<33.7)continue;
      entries.push({k:x+'/'+y,p,distance:(x+.5-tx)**2+(y+.5-ty)**2});
    }
    wanted=new Map(entries.sort((a,b)=>a.distance-b.distance).map(item=>[item.k,item.p]));
    for(const [key,tile] of resident)if(!wanted.has(key)){
      tile.releaseMaterial();if(tile.primitive)scene.primitives.remove(tile.primitive);
      resident.delete(key);
    }
    retry.clear();pump();
  }
  function schedule(){
    if(!alive||timer)return;
    timer=window.setTimeout(()=>{timer=0;pump();},35);
  }
  function pump(){
    if(!alive)return;
    for(const [key,p] of wanted){
      if(pending.size+prepared.size>=3)break;
      if(resident.has(key)||prepared.has(key)||pending.has(key)||(retry.get(key)??0)>Date.now())continue;
      pending.add(key);
      void buildTile(widget,queue,...p).then(tile=>{
        if(!alive||!wanted.has(key)){tile.releaseMaterial();tile.primitive?.destroy();return;}
        prepared.set(key,tile);
        scene.requestRender();
      }).catch(error=>{
        if(!retry.has(key))console.warn('Regional model tile',key,error);
        retry.set(key,Date.now()+20000);
      }).finally(()=>{pending.delete(key);schedule();});
    }
  }
  const stop=scene.postRender.addEventListener(()=>{
    const now=performance.now();
    if(now>=nextPlan){
      nextPlan=now+100;plan();
    }
    // Submit at most one new vertex buffer between frames as neighboring jobs finish together.
    for(const [key,tile] of prepared){
      prepared.delete(key);schedule();
      if(!wanted.has(key)){tile.releaseMaterial();tile.primitive?.destroy();continue;}
      if(tile.primitive)scene.primitives.add(tile.primitive);
      resident.set(key,tile);
      scene.requestRender();
      break;
    }
    const until=performance.now()+2,tiles=Array.from(resident.values());
    for(let i=0;i<tiles.length;i++){
      const index=(maskStart+i)%tiles.length;
      if(!tiles[index].refresh(surveys,until))continue;
      maskStart=(index+1)%tiles.length;
      scene.requestRender();break;
    }
  });
  const poll=window.setInterval(()=>{plan();pump();},3000);
  return ()=>{alive=false;stop();queue.dispose();clearInterval(poll);clearTimeout(timer);distant.dispose();surveys.dispose();
    for(const tile of prepared.values()){tile.releaseMaterial();tile.primitive?.destroy();}prepared.clear();
    for(const tile of resident.values())tile.releaseMaterial();resident.clear();};
}
