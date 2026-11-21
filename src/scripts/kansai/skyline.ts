import type {CesiumWidget,GeometryInstance} from 'cesium';
import {C} from './engine';
import {lonLat,tileXY,type Point} from './coordinates';
import {Mesh,building,noise} from './mesh';
import {midpoint} from './model-tile';
import {inflate,json} from './sources';
import type {Surveys} from './surveys';

type SkylineRow=[height:number,minimum:number,source:number,part:number,rings:number[][]];
async function makeDistrict(widget:CesiumWidget,x:number,y:number){
  const response=await fetch('/kansai/skyline/'+x+'-'+y+'.json.gz');
  if(!response.ok)throw Error('Skyline '+response.status);
  const rows:SkylineRow[]=JSON.parse(new TextDecoder().decode(await inflate(new Uint8Array(await response.arrayBuffer()))));
  const origin=lonLat(x+.5,y+.5,12),radians=origin[1]*Math.PI/180;
  const cos=Math.cos(radians),mx=111319.5*cos/Math.sqrt(1-.00669438*(1-cos*cos));
  const shapes=rows.map(row=>{
    const rings=row[4].map(flat=>{
      const ring:Point[]=[];
      for(let i=0;i<flat.length;i+=2)ring.push(lonLat(x+flat[i]/16384,y+flat[i+1]/16384,12));
      return ring;
    });
    const centre=midpoint(rings[0]);
    const tile=tileXY(...centre,16).map(Math.floor).join('/');
    return {rings,centre,height:row[0],min:row[1],tile};
  });
  const points=shapes.map(f=>C.Cartographic.fromDegrees(...f.centre));
  if(widget.terrainProvider.availability)await C.sampleTerrain(widget.terrainProvider,11,points);
  const instances:GeometryInstance[]=[],locations:{point:Point;tile:string;id:string}[]=[];
  for(let i=0;i<shapes.length;i++){
    const {rings,centre,height,min,tile}=shapes[i],base=points[i].height??0;
    const local=rings.map(r=>r.map(p=>[(p[0]-origin[0])*mx,(p[1]-origin[1])*110946] as Point));
    const m=new Mesh();
    building(m,local,base+min,base+Math.max(height,min+.2),0,noise(i,x+y),'flat',min?base+min:base-2);
    // Distant buildings use opaque vertex colours, without a second set of façade textures.
    for(let j=3;j<m.colors.length;j+=4)m.colors[j]=255;
    const id=String(i),instance=m.instance(id);
    if(instance){instances.push(instance);locations.push({point:centre,tile,id});}
  }
  const primitive=instances.length?new C.Primitive({geometryInstances:instances,
    modelMatrix:C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(...origin)),
    appearance:new C.PerInstanceColorAppearance({flat:false,translucent:false}),
    asynchronous:false,allowPicking:false,compressVertices:false}):undefined;
  let revision='',shown=new Uint8Array(locations.length).fill(1);
  return {primitive,refresh(surveys:Surveys,near:ReadonlySet<string>,signature:string){
    if(!primitive?.ready || revision===signature)return;
    revision=signature;
    for(let i=0;i<locations.length;i++){
      const {point,tile,id}=locations[i],value=near.has(tile)||surveys.contains(point)?0:1;
      if(value!==shown[i]){
        primitive.getGeometryInstanceAttributes(id).show=new Uint8Array([value]);
        shown[i]=value;
      }
    }
  }};
}

export async function distantModels(widget:CesiumWidget,surveys:Surveys){
  const {tiles}=await json<{tiles:string[]}>('skyline/index.json'),available=new Set(tiles);
  const resident=new Map<string,Awaited<ReturnType<typeof makeDistrict>>>(),pending=new Set<string>(),retry=new Map<string,number>();
  let wanted:string[]=[],signature='',alive=true;
  function pump(){
    if(!alive)return;
    for(const key of wanted){
      if(pending.size>=2)break;
      if(resident.has(key)||pending.has(key)||(retry.get(key)??0)>Date.now())continue;
      pending.add(key);
      const [x,y]=key.split('/').map(Number);
      void makeDistrict(widget,x,y).then(d=>{
        if(!alive||!wanted.includes(key)){d.primitive?.destroy();return;}
        if(d.primitive)widget.scene.primitives.add(d.primitive);resident.set(key,d);widget.scene.requestRender();
      }).catch(()=>retry.set(key,Date.now()+30000)).finally(()=>{pending.delete(key);if(alive)window.setTimeout(pump,40);});
    }
  }
  return {
    update(target:Point,altitude:number,near:Set<string>){
      const [cx,cy]=tileXY(...target,12).map(Math.floor),far=altitude>55000;
      const view=cx+'/'+cy+'/'+far;
      if(view!==signature){
        signature=view;
        const keys:{key:string;distance:number}[]=[];
        if(!far)for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++){
          const key=(cx+i)+'/'+(cy+j);if(available.has(key))keys.push({key,distance:i*i+j*j});
        }
        wanted=keys.sort((a,b)=>a.distance-b.distance).map(k=>k.key);
        for(const [key,d] of resident)if(!wanted.includes(key)){
          if(d.primitive)widget.scene.primitives.remove(d.primitive);resident.delete(key);
        }
      }
      pump();
      const mask=surveys.revision+':'+[...near].join(',');
      for(const d of resident.values())d.refresh(surveys,near,mask);
    },
    dispose(){alive=false;}
  };
}
