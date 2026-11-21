import type {CesiumWidget,Cesium3DTileset,Model} from 'cesium';
import {C} from './engine';
import {inBox,inPolygon,type Box,type Point,type Ring} from './coordinates';
import {json} from './sources';

type Building={id:string;pref:string;lon:number;lat:number;file:string;rings:Ring[]};
export async function architecturalModels(widget:CesiumWidget){
  const catalogue=await json<Building[]>('landmarks/index.json');
  const records=catalogue.map(b=>({...b,centre:C.Cartesian3.fromDegrees(b.lon,b.lat),
    masks:b.rings.map(r=>{const xs=r.map(p=>p[0]),ys=r.map(p=>p[1]);
      return {r,box:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)] as Box};})}));
  const models=new Map<string,Model>(),active=new Set<string>(),loading=new Set<string>(),retry=new Map<string,number>();
  const layers=new Map<Cesium3DTileset,string>();
  const bins=new Map<string,typeof records[number]['masks']>();
  const hasMasks=new Set(records.filter(b=>b.masks.length).map(b=>b.pref));
  let revision=0,timer=0,alive=true;
  function syncMasks(){
    if(!alive||!C.ClippingPolygonCollection.isSupported(widget.scene))return;
    for(const [tiles,pref] of layers){
      const polygons=records.filter(b=>active.has(b.id)&&b.pref===pref)
        .flatMap(b=>b.masks.map(mask=>new C.ClippingPolygon({positions:C.Cartesian3.fromDegreesArray(mask.r.flat())})));
      tiles.clippingPolygons=new C.ClippingPolygonCollection({polygons});
    }
    widget.scene.requestRender();
  }
  function changed(){
    revision++;
    bins.clear();
    for(const b of records)if(active.has(b.id))for(const m of b.masks){
      for(let x=Math.floor(m.box[0]*250);x<=Math.floor(m.box[2]*250);x++)
        for(let y=Math.floor(m.box[1]*250);y<=Math.floor(m.box[3]*250);y++){
          const k=x+'/'+y;if(!bins.has(k))bins.set(k,[]);bins.get(k)!.push(m);
        }
    }
    clearTimeout(timer);timer=window.setTimeout(syncMasks,180);widget.scene.requestRender();
  }
  async function load(b:typeof records[number]){
    loading.add(b.id);
    try{
      const pt=C.Cartographic.fromDegrees(b.lon,b.lat);
      if(widget.terrainProvider.availability)await C.sampleTerrainMostDetailed(widget.terrainProvider,[pt]);
      const model=await C.Model.fromGltfAsync({url:b.file,
        modelMatrix:C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(b.lon,b.lat,pt.height||0)),
        upAxis:C.Axis.Y,forwardAxis:C.Axis.X,allowPicking:false});
      if(!alive||widget.isDestroyed()){model.destroy();return;}
      widget.scene.primitives.add(model);models.set(b.id,model);
      widget.scene.requestRender();
    }catch(error){retry.set(b.id,Date.now()+30000);console.warn('Architectural model',b.id,error);}
    finally{loading.delete(b.id);}
  }
  const stop=widget.scene.preRender.addEventListener(()=>{
    for(const b of records){
      const near=C.Cartesian3.distance(widget.camera.positionWC,b.centre)<(b.id==='station-district'?3200:6500);
      const model=models.get(b.id);
      if(model){
        model.show=near;
        if(near&&model.ready&&!active.has(b.id)){active.add(b.id);changed();}
        else if(!near&&active.delete(b.id))changed();
      }else if(near&&loading.size<3&&!loading.has(b.id)&&(retry.get(b.id)??0)<Date.now())void load(b);
    }
  });
  return {
    register(tiles:Cesium3DTileset,pref:string){if(hasMasks.has(pref)){layers.set(tiles,pref);if(active.size)changed();}},
    get revision(){return revision;},
    contains(p:Point){return bins.get(Math.floor(p[0]*250)+'/'+Math.floor(p[1]*250))?.some(m=>inBox(p,m.box)&&inPolygon(p,[m.r]))??false;},
    dispose(){alive=false;clearTimeout(timer);stop();}
  };
}
export type Architecture=Awaited<ReturnType<typeof architecturalModels>>;
