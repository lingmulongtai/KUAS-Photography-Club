import type {CesiumWidget,Cesium3DTileContent,Cesium3DTile} from 'cesium';
import {C} from './engine';
import {lonLat,tileXY,type Point} from './coordinates';
import {json} from './sources';
import type {Surveys} from './surveys';

export async function distantModels(widget:CesiumWidget,surveys:Surveys){
  const {tiles}=await json<{tiles:string[]}>('skyline/index.json');
  const available=new Set(tiles),scene=widget.scene;
  const resident=new Map<string,InstanceType<typeof C.Cesium3DTileset>>(),pending=new Set<string>(),retry=new Map<string,number>();
  const spheres=new Map<string,InstanceType<typeof C.BoundingSphere>>();
  const batches=new WeakMap<Cesium3DTileContent,{point:Point;tile:string;shown:boolean}[]>();
  const refreshed=new WeakMap<Cesium3DTileContent,string>();
  let wanted=new Set<string>(),near:ReadonlySet<string>=new Set(),mask='',alive=true;
  let lastView='',lastDirection=new C.Cartesian3();
  function visible(tile:Cesium3DTile){
    const content=tile.content;
    if(!content.ready||refreshed.get(content)===mask)return;
    let rows=batches.get(content);
    if(!rows){
      rows=[];
      for(let i=0;i<content.featuresLength;i++){
        const feature=content.getFeature(i),point:Point=[feature.getProperty('lon'),feature.getProperty('lat')];
        rows.push({point,tile:tileXY(...point,16).map(Math.floor).join('/'),shown:true});
      }
      batches.set(content,rows);
    }
    for(let i=0;i<rows.length;i++){
      const row=rows[i],show=!near.has(row.tile)&&!surveys.contains(row.point);
      if(show!==row.shown){content.getFeature(i).show=show;row.shown=show;}
    }
    refreshed.set(content,mask);
  }
  async function pump(){
    while(alive&&pending.size<2){
      const key=[...wanted].find(k=>!resident.has(k)&&!pending.has(k)&&(retry.get(k)??0)<=Date.now());
      if(!key)return;
      pending.add(key);
      try{
        const model=await C.Cesium3DTileset.fromUrl('/kansai/skyline-mesh/'+key.replace('/','-')+'.json',{
          maximumScreenSpaceError:8,enableCollision:false,cacheBytes:6*1024*1024,maximumCacheOverflowBytes:4*1024*1024,
        });
        if(!alive||!wanted.has(key)||widget.isDestroyed()){model.destroy();continue;}
        model.tileVisible.addEventListener(visible);
        resident.set(key,model);scene.primitives.add(model);scene.requestRender();
      }catch(error){if(alive){if(!retry.has(key))console.warn('Distant buildings',key,error);retry.set(key,Date.now()+20000);}}
      finally{pending.delete(key);}
    }
  }
  return {
    update(target:Point,altitude:number,nearby:ReadonlySet<string>){
      near=nearby;mask=surveys.revision+':'+[...nearby].join(',');
      const [cx,cy]=tileXY(...target,12).map(Math.floor),far=altitude>55000;
      const signature=cx+'/'+cy+'/'+far,cam=scene.camera;
      if(lastView!==signature||C.Cartesian3.distance(cam.directionWC,lastDirection)>.025){
        lastView=signature;C.Cartesian3.clone(cam.directionWC,lastDirection);
        const view=cam.frustum.computeCullingVolume(cam.positionWC,cam.directionWC,cam.upWC);
        const entries:{key:string;distance:number}[]=[];
        if(!far)for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++){
          const x=cx+i,y=cy+j,key=x+'/'+y;if(!available.has(key))continue;
          let sphere=spheres.get(key);
          if(!sphere){
            const [w,n]=lonLat(x,y,12),[e,s]=lonLat(x+1,y+1,12);
            sphere=C.BoundingSphere.fromRectangle3D(C.Rectangle.fromDegrees(w,s,e,n));
            sphere.radius+=900;spheres.set(key,sphere);
          }
          if((i||j)&&view.computeVisibility(sphere)===C.Intersect.OUTSIDE)continue;
          entries.push({key,distance:i*i+j*j});
        }
        wanted=new Set(entries.sort((a,b)=>a.distance-b.distance).map(v=>v.key));
        for(const [k,model] of resident)if(!wanted.has(k)){scene.primitives.remove(model);resident.delete(k);}
      }
      void pump();void pump();
    },
    dispose(){alive=false;for(const model of resident.values())scene.primitives.remove(model);resident.clear();}
  };
}
