import type {Cesium3DTile, Cesium3DTileContent, CesiumWidget} from 'cesium';
import {C} from './engine';
import type {Point, Box} from './coordinates';
import {inBox} from './coordinates';
import type {Architecture} from './architecture';
import {surveyMaterial} from './survey-material';

type SurveyLayer={kind:string;lod:number;pref:string;url:string;bounds:Box};
type RecordBox={box:Box;point:Point;id:number};
const cell=(x:number,y:number)=>x*100000+y;

class Footprints {
  bins=new Map<number,Box[]>();
  add(b:Box) {
    for(let x=Math.floor(b[0]*250);x<=Math.floor(b[2]*250);x++) for(let y=Math.floor(b[1]*250);y<=Math.floor(b[3]*250);y++){
      const k=cell(x,y);if(!this.bins.has(k))this.bins.set(k,[]);this.bins.get(k)!.push(b);
    }
  }
  contains(p:Point) {return this.bins.get(cell(Math.floor(p[0]*250),Math.floor(p[1]*250)))?.some(b=>inBox(p,b))??false;}
}

function footprintRecords(content:Cesium3DTileContent): RecordBox[] {
  const records:RecordBox[]=[];
  for(let i=0;i<content.featuresLength;i++){
    const f=content.getFeature(i);
    if(!f.hasProperty('_xmin')) break;
    const b:Box=[f.getProperty('_xmin'),f.getProperty('_ymin'),f.getProperty('_xmax'),f.getProperty('_ymax')];
    if(!b.every(Number.isFinite)||b[2]-b[0]>.08||b[3]-b[1]>.08)continue;
    records.push({box:b,point:[(b[0]+b[2])/2,(b[1]+b[3])/2],id:i});
  }
  // A survey tile may contain only a few buildings. Its bounding volume cannot
  // determine which mapped houses in the same neighbourhood it replaces.
  return records;
}

export async function attachSurveys(widget:CesiumWidget,onFailure:()=>void,initial:Point,architecture:Architecture){
  const res=await fetch('/kansai/surveys/regions.json'); if(!res.ok)throw Error('Survey catalogue');
  const layers=await res.json() as SurveyLayer[];
  const material=surveyMaterial(widget);
  const scene=widget.scene, records=new WeakMap<Cesium3DTileContent,RecordBox[]>();
  let visible=new Map<Cesium3DTileContent,number>(),last=new Map<Cesium3DTileContent,number>(),mask=new Footprints(),revision=0;
  let lastArchitecture=-1;
  const remove=scene.postRender.addEventListener(()=>{
    const changed=lastArchitecture!==architecture.revision;
    if(changed){lastArchitecture=architecture.revision;material.setMasks(architecture.rings());}
    if(changed||visible.size!==last.size || [...visible.keys()].some(t=>!last.has(t))){
      const next=new Footprints();
      for(const lod of [4,3,2,1,0]){
        const boxes:Box[]=[];
        for(const [content,level] of visible){
          if(lod!==level)continue;
          const rows=records.get(content)??footprintRecords(content);records.set(content,rows);
          for(const r of rows){
            const show=!next.contains(r.point)&&!architecture.contains(r.point);
            const feature=content.getFeature(r.id);
            if(feature.show!==show)feature.show=show;
            if(show)boxes.push(r.box);
          }
        }
        for(const box of boxes)next.add(box);
      }
      mask=next;revision++;
    }
    last=visible;visible=new Map();
  });
  const resident=new Map<SurveyLayer,InstanceType<typeof C.Cesium3DTileset>>();
  const pending=new Set<SurveyLayer>(),retry=new Map<SurveyLayer,number>();
  let wanted=new Set<SurveyLayer>(),alive=true,lastTarget:Point|undefined,lastAltitude=-1;
  async function load(layer:SurveyLayer){
    pending.add(layer);
    try {
      const tiles=await C.Cesium3DTileset.fromUrl(layer.url,{
        maximumScreenSpaceError:4,enableCollision:false,cacheBytes:24*1024*1024,maximumCacheOverflowBytes:24*1024*1024,
      });
      if(!alive||widget.isDestroyed()||!wanted.has(layer)) {tiles.destroy();return;}
      if(layer.kind==='bldg'||layer.kind==='brid')tiles.customShader=layer.kind==='bldg'&&layer.lod===1?material.shader:material.detailed;
      if(layer.kind==='bldg'){
        tiles.tileVisible.addEventListener((tile:Cesium3DTile)=>{
          if(!tile.content.ready)return;
          // The Expo archive depicts the fair itself; municipal shells can predate construction.
          const archived=tile.content.url?.includes('/27999_osaka-shi_city_2025_');
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
  return {contains:(p:Point)=>mask.contains(p)||architecture.contains(p),get revision(){return revision+architecture.revision;},ready,
    updatePhoto(target:Point,altitude:number){
      material.selectCity(target);
      void plan(target,altitude);
      if(altitude<10500&&[...last.values()].includes(1))void material.update(target,altitude);
    },
    dispose(){alive=false;remove();architecture.dispose();material.dispose();}};
}
export type Surveys=Awaited<ReturnType<typeof attachSurveys>>;
