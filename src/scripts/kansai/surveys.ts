import type {Cesium3DTile, Cesium3DTileContent, CesiumWidget} from 'cesium';
import {C} from './engine';
import type {Point, Box} from './coordinates';
import {inBox} from './coordinates';
import type {Architecture} from './architecture';
import {surveyMaterial} from './survey-material';

type SurveyLayer={kind:string;lod:number;pref:string;file:string};
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

export async function attachSurveys(widget:CesiumWidget,onFailure:()=>void,initialPref:string,architecture:Architecture){
  const res=await fetch('/kansai/surveys/index.json'); if(!res.ok)throw Error('Survey catalogue');
  const {layers}=await res.json() as {layers:SurveyLayer[]};
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
  // Keep nearby prefectures resident. Cesium selects visible child tiles across the border.
  const queue=[...layers].sort((a,b)=>Number(b.pref===initialPref)-Number(a.pref===initialPref));
  async function loadNext(){
    for(let layer=queue.shift();layer;layer=queue.shift()){
    try {
      const tiles=await C.Cesium3DTileset.fromUrl('/kansai/surveys/'+layer.file,{
        maximumScreenSpaceError:3,enableCollision:true,cacheBytes:32*1024*1024,maximumCacheOverflowBytes:48*1024*1024,
      });
      if(widget.isDestroyed()) {tiles.destroy();return;}
      if(layer.kind==='bldg'||layer.kind==='brid')tiles.customShader=layer.kind==='bldg'&&layer.lod===1?material.shader:material.detailed;
      if(layer.kind==='bldg'){
        tiles.tileVisible.addEventListener((tile:Cesium3DTile)=>{if(tile.content.ready)visible.set(tile.content,layer.lod);});
        tiles.tileUnload.addEventListener((tile:Cesium3DTile)=>visible.delete(tile.content));
      }
      tiles.tileFailed.addEventListener(onFailure);
      scene.primitives.add(tiles);
    }catch{onFailure();}
    }
  }
  const ready=Promise.all(Array.from({length:3},loadNext));
  return {contains:(p:Point)=>mask.contains(p)||architecture.contains(p),get revision(){return revision+architecture.revision;},ready,
    updatePhoto(target:Point,altitude:number){
      if([...last.values()].includes(1))void material.update(target,altitude);
    },
    dispose(){remove();architecture.dispose();material.dispose();}};
}
export type Surveys=Awaited<ReturnType<typeof attachSurveys>>;
