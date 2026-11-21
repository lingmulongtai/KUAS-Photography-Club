import type {Cartographic,CesiumWidget,GeometryInstance} from 'cesium';
import {classifyRings,type VectorTileFeature} from '@mapbox/vector-tile';
import {C} from './engine';
import {lonLat,inPolygon,type Point,type Ring} from './coordinates';
import {Mesh,building,tree,noise,strip,type XYZ,type RGB} from './mesh';
import type {BuildingTag,ModelSources} from './sources';
import type {Surveys} from './surveys';
import {localAppearance} from './material';
import {drawGround,roadWidth} from './ground';
import {hyogoHeights} from './lidar';
import type {HeightSources} from './building-heights';
import {railStructure} from './rail';

function openRing(r:Ring):Ring {
  if(r.length<2)return r;
  const a=r[0],b=r[r.length-1];
  return a[0]===b[0]&&a[1]===b[1]?r.slice(0,-1):r;
}
export function midpoint(r:Ring):Point {
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(const [x,y] of r){west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);}
  return [(west+east)/2,(south+north)/2];
}
function area(r:Ring){
  return Math.abs(r.reduce((sum,[x,y],i)=>{const q=r[(i+1)%r.length];return sum+x*q[1]-y*q[0];},0))/2;
}
function polygons(f:VectorTileFeature,x:number,y:number,z:number):Ring[][]{
  return classifyRings(f.loadGeometry()).map(group=>group.map(r=>openRing(r.map(p=>lonLat(x+p.x/f.extent,y+p.y/f.extent,z)))));
}
async function heights(widget:CesiumWidget,west:number,south:number,east:number,north:number){
  const n=12,points:Cartographic[]=[];
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)
    points.push(C.Cartographic.fromDegrees(west+(east-west)*i/n,south+(north-south)*j/n));
  if(widget.terrainProvider.availability)await C.sampleTerrainMostDetailed(widget.terrainProvider,points);
  else for(const p of points)p.height=widget.scene.globe.getHeight(p)??0;
  return ([x,y]:Point)=>{
    const u=Math.max(0,Math.min(n-1e-6,(x-west)/(east-west)*n));
    const v=Math.max(0,Math.min(n-1e-6,(y-south)/(north-south)*n));
    const i=Math.floor(u),j=Math.floor(v),k=j*(n+1)+i;
    const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
    return lerp(lerp(points[k].height||0,points[k+1].height||0,u-i),
      lerp(points[k+n+1].height||0,points[k+n+2].height||0,u-i),v-j);
  };
}

export async function buildTile(widget:CesiumWidget,sources:ModelSources,heightSources:HeightSources,x:number,y:number,owner:(p:Point)=>string|undefined){
  const nw=lonLat(x,y,16),se=lonLat(x+1,y+1,16),[west,north]=nw,[east,south]=se;
  const key=(x>>4)+'/'+(y>>4), center:Point=[(west+east)/2,(north+south)/2];
  const slot=(y%16)*16+x%16;
  const corners:Point[]=[nw,se,[west,south],[east,north]];
  const inHyogo=[center,...corners].some(p=>owner(p)==='28');
  const [tile,fields,tags,canopy,ground,surfaces,edges,lidar,heightsByBuilding]=await Promise.all([sources.network(x,y),sources.fields(key,slot),sources.tags(key,slot),
    sources.canopy(corners),heights(widget,west,south,east,north),sources.surfaces(x>>1,y>>1),sources.edges(x,y),
    inHyogo?hyogoHeights(x,y):undefined,heightSources(x,y,corners)]);
  const cos=Math.cos(center[1]*Math.PI/180),mx=111319.5*cos/Math.sqrt(1-.00669438*(1-cos*cos)),my=110946;
  const local=([lon,lat]:Point):Point=>[(lon-center[0])*mx,(lat-center[1])*my];
  const here=([lon,lat]:Point)=>lon>=west&&lon<east&&lat>south&&lat<=north;
  const xyz=(p:Point,h:number):XYZ=>[...local(p),h];
  const instances:GeometryInstance[]=[],locations:Point[]=[],groundMesh=new Mesh((east-west)*mx,(north-south)*my);
  const {waterPrimitive,inWater}=drawGround(groundMesh,x,y,surfaces,edges,ground,xyz,owner);
  const occupied=new Map<number,Ring[][]>();
  const bin=(v:number)=>Math.max(0,Math.min(7,Math.floor(v*8)));
  const col=(p:Point)=>bin((p[0]-west)/(east-west)),row=(p:Point)=>bin((p[1]-south)/(north-south));
  const appendBuilding=(rings:Ring[],p:Point,tag?:BuildingTag,solid=false)=>{
    const projected=rings.map(r=>openRing(r).map(local)).filter(r=>r.length>=3);
    if(!projected.length)return;
    const size=area(projected[0]);if(size<1)return;
    const cols=rings[0].map(col),rows=rings[0].map(row);
    for(let j=Math.min(...rows);j<=Math.max(...rows);j++)for(let i=Math.min(...cols);i<=Math.max(...cols);i++){
      const k=j*8+i;if(!occupied.has(k))occupied.set(k,[]);occupied.get(k)!.push(rings);
    }
    const style=noise(Math.round(p[0]*1e6),Math.round(p[1]*1e6));
    const mapped=tag?.height&&tag.height>0?tag.height:undefined;
    const measured=()=>!tag?.part&&owner(p)==='28'?lidar?.(rings):undefined;
    const inferred=solid?Math.min(33,8+Math.sqrt(size)*.24):size>360?8+style*3:5.6+style*2.2;
    const block=heightsByBuilding.block(p);
    const fallback=block&&block>0?Math.max(inferred*.5,Math.min(inferred*2,(inferred+block)/2)):inferred;
    const height=mapped??measured()??(tag?.levels?tag.levels*3.1:undefined)??heightsByBuilding.predicted(rings)??fallback;
    const base=ground(p),minimum=tag?.minHeight??(tag?.minLevel??0)*3.1;
    if(height<=minimum)return;
    const roofShape=tag?.roof??(!solid&&size<320?(style>.65?'hipped':'gabled'):'flat');
    const ridge=['gabled','hipped','half-hipped','gambrel','pyramidal','mansard','skillion'].includes(roofShape)?
      Math.min(height*.38,tag?.roofHeight??(tag?.roofLevels?tag.roofLevels*2:Math.sqrt(size)*.14)):0;
    const mesh=new Mesh((east-west)*mx,(north-south)*my),low=minimum?base+minimum:Math.min(base,...rings[0].map(ground))-.5;
    building(mesh,projected,base+minimum,base+height-ridge,ridge,style,roofShape,low);
    const instance=mesh.instance(String(locations.length));if(instance){instances.push(instance);locations.push(p);}
  };
  // Keep tagged parts separate from parent footprints (e.g. towers over station podiums).
  const relevant=tags.flatMap(tag=>tag.polygons.filter(r=>r[0]?.some(([lon,lat])=>lon>=west-.003&&lon<=east+.003&&lat>=south-.003&&lat<=north+.003))
    .map(rings=>({tag,rings,point:midpoint(rings[0])})));
  const outlines=relevant.filter(row=>!row.tag.part),parts=relevant.filter(row=>row.tag.part);
  const taggedHeight=(tag:BuildingTag)=>tag.height??(tag.levels===undefined?0:tag.levels*3.1);
  const matched=new Set<string>();
  const buildings=tile?.layers.BldA;
  for(let i=0;i<(buildings?.length??0);i++){
    const f=buildings!.feature(i);
    for(const rings of polygons(f,x,y,16)){
      const p=midpoint(rings[0]);if(!here(p)||!owner(p))continue;
      const row=outlines.find(r=>inPolygon(p,r.rings)||inPolygon(r.point,rings));
      // Model an attributed outline once, even when GSI split it at a tile edge.
      if(row){matched.add(row.tag.id);continue;}
      if(parts.some(r=>inPolygon(p,r.rings)))continue;
      appendBuilding(rings,p,undefined,Number(f.properties.vt_code)===3102);
    }
  }
  for(const row of relevant){
    if(!here(row.point)||!owner(row.point))continue;
    // A station outline may repeat the full tower height. Its podium and towers
    // are represented by their individual parts in both near and distant views.
    if(!row.tag.part && parts.some(part=>inPolygon(part.point,row.rings)
      && taggedHeight(part.tag)>=.95*taggedHeight(row.tag)))continue;
    appendBuilding(row.rings,row.point,row.tag,matched.has(row.tag.id)&&row.tag.levels!==undefined&&row.tag.levels>3);
  }
  for(const name of ['RdCL','RailCL','RailTrCL']){
    const layer=tile?.layers[name];if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      const f=layer.feature(i),props=f.properties;
      const structure=railStructure(name,Number(props.vt_code),String(props.vt_railstate));
      if(structure==='hidden')continue;
      const road=name==='RdCL',raised=road||structure==='raised';
      const width=road?roadWidth(props.vt_rnkwidth):name==='RailCL'?4.6:2.6;
      for(const line of f.loadGeometry()){
        let distance=0;
        for(let j=1;j<line.length;j++){
          const geo=[line[j-1],line[j]].map(v=>lonLat(x+v.x/f.extent,y+v.y/f.extent,16));
          const p=midpoint(geo);if(!here(p)||!owner(p))continue;
          const lift=raised?6.8:name==='RailTrCL'?.8:.55;
          const a=xyz(geo[0],ground(geo[0])+lift),b=xyz(geo[1],ground(geo[1])+lift);
          strip(groundMesh,a,b,width,road?[99,100,98]:[55,52,47],raised?.9:.28);
          if(!road){
            const top=(v:XYZ):XYZ=>[v[0],v[1],v[2]+.11];
            for(const offset of [-.55,.55])strip(groundMesh,top(a),top(b),.13,[158,157,150],0,offset);
          }
          const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
          if(raised&&len>0){
            for(let t=32-distance;t<len;t+=32){
              const u=t/len,px=a[0]+(b[0]-a[0])*u,py=a[1]+(b[1]-a[1])*u,h=a[2]+(b[2]-a[2])*u-1;
              const w=Math.min(width*.32,2);
              strip(groundMesh,[px-w,py,h],[px+w,py,h],1.4,[135,131,121],lift);
            }
          }
          distance=(distance+len)%32;
        }
      }
    }
  }
  for(const f of fields){
      for(const rings of polygons(f,x>>4,y>>4,12)){
        const p=midpoint(rings[0]);if(!owner(p))continue;
        const color:RGB=f.properties.kind===1?[128,128,84]:[141,119,81];
        // Trace the real bunds above the aerial image so field crops retain their photographed colour.
        for(const ring of rings)for(let j=0;j<ring.length;j++){
          const a=ring[j],b=ring[(j+1)%ring.length];
          strip(groundMesh,xyz(a,ground(a)+.55),xyz(b,ground(b)+.55),1.15,color,.4);
        }
      }
  }
  const side=28;
  for(let i=0;i<side;i++)for(let j=0;j<side;j++){
    const ix=x*side+i,iy=y*side+j,seed=noise(ix,iy);
    const p=lonLat(x+(i+.1+.8*noise(ix+17,iy))/side,y+(j+.1+.8*noise(ix,iy+31))/side,16);
    if(seed>canopy(p)*.96||!owner(p)||inWater(p)||occupied.get(row(p)*8+col(p))?.some(r=>inPolygon(p,r)))continue;
    const [px,py]=local(p);tree(groundMesh,px,py,ground(p),noise(iy,ix+6));
  }
  const terrain=groundMesh.instance();if(terrain)instances.push(terrain);
  const primitive=instances.length?new C.Primitive({geometryInstances:instances,
    modelMatrix:C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(...center)),
    appearance:localAppearance(x,y),
    asynchronous:false,allowPicking:false,compressVertices:false,vertexCacheOptimize:false}):undefined;
  let applied=-1;
  return {primitive,waterPrimitive,releaseMaterial(){primitive?.appearance.material?.destroy();},buildings:locations.length,refresh(surveys:Surveys){
    if(!primitive?.ready||surveys.revision===applied)return;
    for(let i=0;i<locations.length;i++){
      const attr=primitive.getGeometryInstanceAttributes(String(i));
      const value=surveys.contains(locations[i])?0:1;
      if(attr.show[0]!==value)attr.show=new Uint8Array([value]);
    }
    applied=surveys.revision;
  }};
}
