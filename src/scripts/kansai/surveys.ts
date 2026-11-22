import type {Cesium3DTile, Cesium3DTileContent, CesiumWidget} from 'cesium';
import {C} from './engine';
import type {Point, Box} from './coordinates';
import {SurveyCoverage} from './survey-coverage';
import type {Architecture} from './architecture';
import {surveyMaterial} from './survey-material';

type SurveyLayer={kind:string;lod:number;pref:string;url:string;preparedUrl?:string;bounds:Box};


export async function attachSurveys(widget:CesiumWidget,onFailure:()=>void,initial:Point,architecture:Architecture){
  const res=await fetch('/kansai/surveys/regions.json'); if(!res.ok)throw Error('Survey catalogue');
  const layers=await res.json() as SurveyLayer[];
  const material=surveyMaterial(widget);
  const scene=widget.scene,coverage=new SurveyCoverage();
  let visible=new Map<Cesium3DTileContent,number>(),hasVisible=false,lastArchitecture=-1;
  const remove=scene.postRender.addEventListener(()=>{
    const changed=lastArchitecture!==architecture.revision;
    const rings=changed?architecture.rings():undefined;
    if(rings){lastArchitecture=architecture.revision;material.setMasks(rings);}
    if(coverage.apply(visible,rings,architecture.contains))scene.requestRender();
    hasVisible=visible.size>0;visible=new Map();
  });
  const resident=new Map<SurveyLayer,InstanceType<typeof C.Cesium3DTileset>>();
  const pending=new Set<SurveyLayer>(),retry=new Map<SurveyLayer,number>();
  let wanted=new Set<SurveyLayer>(),alive=true,lastTarget:Point|undefined,lastAltitude=-1;
  async function load(layer:SurveyLayer){
    pending.add(layer);
    try {
      const options={maximumScreenSpaceError:4,enableCollision:false,cacheBytes:24*1024*1024,maximumCacheOverflowBytes:24*1024*1024};
      const prepared=layer.preparedUrl&&C.FeatureDetection.supportsBasis(scene);
      const tiles=prepared?await C.Cesium3DTileset.fromUrl(layer.preparedUrl!,options)
        .catch(()=>C.Cesium3DTileset.fromUrl(layer.url,options)):await C.Cesium3DTileset.fromUrl(layer.url,options);
      if(!alive||widget.isDestroyed()||!wanted.has(layer)) {tiles.destroy();return;}
      if(layer.kind==='bldg'||layer.kind==='brid')tiles.customShader=layer.kind==='bldg'?material.shader:material.detailed;
      if(layer.kind==='bldg'){
        tiles.tileVisible.addEventListener((tile:Cesium3DTile)=>{
          if(!tile.content.ready)return;
          // The Expo archive depicts the fair itself; municipal shells can predate construction.
          const archived=layer.url.includes('/27999_osaka-shi_city_2025_');
          visible.set(tile.content,archived?4:layer.lod);
        });
        tiles.tileUnload.addEventListener((tile:Cesium3DTile)=>visible.delete(tile.content));
      }
      tiles.tileFailed.addEventListener(onFailure);
      retry.delete(layer);resident.set(layer,tiles);scene.primitives.add(tiles);scene.requestRender();
    }catch{retry.set(layer,Date.now()+30000);if(alive&&wanted.has(layer))onFailure();}
    finally{pending.delete(layer);}
  }
  async function pump(){
    while(alive&&pending.size<3){
      const layer=[...wanted].find(l=>!resident.has(l)&&!pending.has(l)&&(retry.get(l)??0)<=Date.now());
      if(!layer)return;
      await load(layer);
    }
  }
  function plan(target:Point,altitude:number){
    // A detailed municipal tile outside this range contributes subpixel façades.
    // The far building layer remains on the globe while sources change or stream.
    if(lastTarget&&Math.abs(target[0]-lastTarget[0])<.002&&Math.abs(target[1]-lastTarget[1])<.002
      && Math.abs(altitude-lastAltitude)<150&&!retry.size)return;
    lastTarget=target;lastAltitude=altitude;
    const radius=Math.min(14500,Math.max(5000,altitude*3.5));
    const distances=layers.map(layer=>{
      const [w,s,e,n]=layer.bounds;
      return {layer,d:Math.hypot(91500*Math.max(w-target[0],0,target[0]-e),111000*Math.max(s-target[1],0,target[1]-n))};
    });
    wanted=new Set(distances.filter(v=>altitude<40000&&v.d<radius*(resident.has(v.layer)?1.3:1))
      .sort((a,b)=>a.d-b.d||b.layer.lod-a.layer.lod).map(v=>v.layer));
    for(const [layer,tiles] of resident)if(!wanted.has(layer)){
      scene.primitives.remove(tiles);resident.delete(layer);
    }
    return Promise.all(Array.from({length:3},pump));
  }
  const ready=plan(initial,1000);
  return {contains:(p:Point)=>coverage.contains(p)||architecture.contains(p),get revision(){return coverage.revision+architecture.revision;},ready,
    landmarkRings:architecture.intersecting,get landmarkRevision(){return architecture.revision;},
    updatePhoto(target:Point,altitude:number){
      material.selectCity(target);
      void plan(target,altitude);
      if(altitude<10500&&hasVisible)void material.update(target,altitude);
    },
    dispose(){alive=false;remove();architecture.dispose();material.dispose();}};
}
export type Surveys=Awaited<ReturnType<typeof attachSurveys>>;
