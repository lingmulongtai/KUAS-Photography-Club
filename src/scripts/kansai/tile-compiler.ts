import {classifyRings,type VectorTileFeature} from '@mapbox/vector-tile';
import {lonLat,inPolygon,tileMetresPerDegree,type Point,type Ring} from './coordinates';
import {Mesh,building,tree,noise,strip,type XYZ,type RGB,type PackedMesh} from './mesh';
import {modelSources,type BuildingTag} from './sources';
import {drawGround,roadWidth} from './ground';
import {hyogoHeights} from './lidar';
import {regionalHeights} from './building-heights';
import {railStructure} from './rail';
import {drawSetaBridges,isSetaDeck} from './seta-bridge';
import {combineTileMeshes,type TileGeometry} from './tile-geometry';


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
function terrainSampler(elevations:Float64Array,west:number,south:number,east:number,north:number){
  const n=12;
  return ([x,y]:Point)=>{
    const u=Math.max(0,Math.min(n-1e-6,(x-west)/(east-west)*n));
    const v=Math.max(0,Math.min(n-1e-6,(y-south)/(north-south)*n));
    const i=Math.floor(u),j=Math.floor(v),k=j*(n+1)+i;
    const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
    return lerp(lerp(elevations[k],elevations[k+1],u-i),
      lerp(elevations[k+n+1],elevations[k+n+2],u-i),v-j);
  };
}

export interface TileRequest {id:number;x:number;y:number;elevations:Float64Array<ArrayBuffer>}
export interface CompiledTile {center:Point;geometry?:TileGeometry;locations:Point[]}

export function tileCompiler(){
  let data:Promise<[Awaited<ReturnType<typeof modelSources>>,Awaited<ReturnType<typeof regionalHeights>>]>|undefined;
  return async({x,y,elevations}:TileRequest):Promise<CompiledTile>=>{
    data??=Promise.all([modelSources(),regionalHeights()]).catch(error=>{data=undefined;throw error;});
    const [sources,heightSources]=await data;
    const nw=lonLat(x,y,16),se=lonLat(x+1,y+1,16),[west,north]=nw,[east,south]=se;
    const key=(x>>4)+'/'+(y>>4), center:Point=[(west+east)/2,(north+south)/2];
    const slot=(y%16)*16+x%16;
    const corners:Point[]=[nw,se,[west,south],[east,north]];

    const ground=terrainSampler(elevations,west,south,east,north);
    const [tile,fields,tags,canopy,surfaces,edges,lidar,heightsByBuilding]=await Promise.all([sources.network(x,y),sources.fields(key,slot),sources.tags(key,slot),
      sources.canopy(corners),sources.surfaces(x>>1,y>>1),sources.edges(x,y),
      hyogoHeights(x,y),heightSources(x,y,corners)]);
    const [mx,my]=tileMetresPerDegree(center[1]);
    const local=([lon,lat]:Point):Point=>[(lon-center[0])*mx,(lat-center[1])*my];
    const here=([lon,lat]:Point)=>lon>=west&&lon<east&&lat>south&&lat<=north;
    const xyz=(p:Point,h:number):XYZ=>[...local(p),h];
    const meshes:PackedMesh[]=[],locations:Point[]=[],groundMesh=new Mesh((east-west)*mx,(north-south)*my);
    const inWater=drawGround(groundMesh,x,y,surfaces,edges,ground,xyz);
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
      const measured=()=>tag?.part?undefined:lidar(rings);
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
      const instance=mesh.buffers(String(locations.length));if(instance){meshes.push(instance);locations.push(p);}
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
        const p=midpoint(rings[0]);if(!here(p))continue;
        const row=outlines.find(r=>inPolygon(p,r.rings)||inPolygon(r.point,rings));
        // Model an attributed outline once, even when GSI split it at a tile edge.
        if(row){matched.add(row.tag.id);continue;}
        if(parts.some(r=>inPolygon(p,r.rings)))continue;
        appendBuilding(rings,p,undefined,Number(f.properties.vt_code)===3102);
      }
    }
    for(const row of relevant){
      if(!here(row.point))continue;
      // A station outline may repeat the full tower height. Its podium and towers
      // are represented by their individual parts in both near and distant views.
      if(!row.tag.part && parts.some(part=>inPolygon(part.point,row.rings)
        && taggedHeight(part.tag)>=.95*taggedHeight(row.tag)))continue;
      appendBuilding(row.rings,row.point,row.tag,matched.has(row.tag.id)&&row.tag.levels!==undefined&&row.tag.levels>3);
    }
    const karahashi=y===25964&&(x===57508||x===57509);
    if(karahashi)drawSetaBridges(groundMesh,[west,south,east,north],local);
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
            const p=midpoint(geo);if(!here(p))continue;
            if(karahashi&&road&&Number(props.vt_code)===2703&&isSetaDeck(p))continue;
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
      if(seed>canopy(p)*.96||inWater(p)||occupied.get(row(p)*8+col(p))?.some(r=>inPolygon(p,r)))continue;
      const [px,py]=local(p);tree(groundMesh,px,py,ground(p),noise(iy,ix+6));
    }
    const terrain=groundMesh.buffers();if(terrain)meshes.push(terrain);
    return {center,locations,geometry:combineTileMeshes(meshes)};
  };
}
