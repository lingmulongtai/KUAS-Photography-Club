import {cityFootprint,facadeKind,type StreetBuilding} from './city-footprint';
import {classifyRings,type VectorTileFeature} from '@mapbox/vector-tile';
import {lonLat,inPolygon,tileMetresPerDegree,type Point,type Ring} from './coordinates';
import {Mesh,building,tree,noise,strip,type XYZ,type RGB,type PackedMesh} from './mesh';
import {modelSources,type BuildingTag} from './sources';
import {drawGround,roadWidth} from './ground';
import {roofSurvey,matchRoof,drawSurveyedRoof,surveyFits} from './surveyed-roofs';
import {hyogoHeights} from './lidar';
import {regionalHeights} from './building-heights';
import {railStructure} from './rail';
import {insideSacredFootprint,sacredForZ16,type SacredSite} from './sacred-sites';
import {bridgeClearance,drawBridgePolyline,drawRailPolyline} from './transport-mesh';
import {drawSetaBridges,isSetaDeck,type VerticalDatum} from './seta-bridge';
import {combineTileMeshes,type TileGeometry} from './tile-geometry';
import {toLocal} from '../hero/geo';


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

export interface TileRequest {datum?:VerticalDatum;includeTrees?:boolean;id:number;x:number;y:number;elevations:Float64Array<ArrayBuffer>}
export interface CompiledTile {center:Point;geometry?:TileGeometry;locations:Point[];city?:StreetBuilding[];facades?:number[][];sacred?:SacredSite[]}

export function tileCompiler(){
  let data:Promise<[Awaited<ReturnType<typeof modelSources>>,Awaited<ReturnType<typeof regionalHeights>>]>|undefined;
  return async({x,y,elevations,includeTrees=true,datum='ellipsoid'}:TileRequest):Promise<CompiledTile>=>{
    data??=Promise.all([modelSources(),regionalHeights()]).catch(error=>{data=undefined;throw error;});
    const [sources,heightSources]=await data;
    const nw=lonLat(x,y,16),se=lonLat(x+1,y+1,16),[west,north]=nw,[east,south]=se;
    const key=(x>>4)+'/'+(y>>4), center:Point=[(west+east)/2,(north+south)/2];
    const slot=(y%16)*16+x%16;
    const corners:Point[]=[nw,se,[west,south],[east,north]];

    const ground=terrainSampler(elevations,west,south,east,north);
    const [tile,fields,tags,canopy,surfaces,edges,lidar,heightsByBuilding,survey,sacredSites]=await Promise.all([sources.network(x,y),sources.fields(key,slot),sources.tags(key,slot),
      includeTrees?sources.canopy(corners):null,sources.surfaces(x>>1,y>>1),sources.edges(x,y),
      hyogoHeights(x,y),heightSources(x,y,corners),roofSurvey(x>>4,y>>4),
      datum==='orthometric'?sacredForZ16(x,y):Promise.resolve([] as SacredSite[])]);
    const [mx,my]=tileMetresPerDegree(center[1]);
    const local=([lon,lat]:Point):Point=>[(lon-center[0])*mx,(lat-center[1])*my];
    const here=([lon,lat]:Point)=>lon>=west&&lon<east&&lat>south&&lat<=north;
    const xyz=(p:Point,h:number):XYZ=>[...local(p),h];
    const meshes:PackedMesh[]=[],locations:Point[]=[],groundMesh=new Mesh((east-west)*mx,(north-south)*my);
    const inWater=drawGround(groundMesh,x,y,surfaces,edges,ground,xyz);
    const city:StreetBuilding[]=[],facades:number[][]=[];
    const occupied=new Map<number,Ring[][]>();
    const bin=(v:number)=>Math.max(0,Math.min(7,Math.floor(v*8)));
    const col=(p:Point)=>bin((p[0]-west)/(east-west)),row=(p:Point)=>bin((p[1]-south)/(north-south));
    const appendBuilding=(rings:Ring[],p:Point,tag?:BuildingTag,solid=false,highRise=false,shed=false)=>{
      const projected=rings.map(r=>openRing(r).map(local)).filter(r=>r.length>=3);
      if(!projected.length)return;
      const size=area(projected[0]);if(size<1)return;
      if(datum==='orthometric' && sacredSites.length){
        const lp=toLocal(p[1],p[0]);
        if(sacredSites.some(s=>insideSacredFootprint(lp.x,lp.z,s)))return;
      }
      if(includeTrees){
        const cols=rings[0].map(col),rows=rings[0].map(row);
        for(let j=Math.min(...rows);j<=Math.max(...rows);j++)for(let i=Math.min(...cols);i<=Math.max(...cols);i++){
          const k=j*8+i;if(!occupied.has(k))occupied.set(k,[]);occupied.get(k)!.push(rings);
        }
      }
      const style=noise(Math.round(p[0]*1e6),Math.round(p[1]*1e6));
      const mapped=tag?.height&&tag.height>0?tag.height:undefined;
      const measured=()=>tag?.part?undefined:lidar(rings);
      const inferred=highRise?Math.max(32,18+Math.sqrt(size)*.4):shed?3.2+style*1.1:solid?Math.min(33,8+Math.sqrt(size)*.24):size>360?8+style*3:5.6+style*2.2;
      const block=heightsByBuilding.block(p);
      const fallback=block&&block>0&&!shed?Math.max(inferred*.5,Math.min(inferred*2,(inferred+block)/2)):inferred;
      const height=mapped??measured()??(tag?.levels?tag.levels*3.1:undefined)??(shed?undefined:heightsByBuilding.predicted(rings))??fallback;
      const base=ground(p),minimum=tag?.minHeight??(tag?.minLevel??0)*3.1;
      if(height<=minimum)return;
      const roofShape=tag?.roof??(!solid&&!shed&&size<320?(style>.65?'hipped':'gabled'):'flat');
      const ridge=['gabled','hipped','half-hipped','gambrel','pyramidal','mansard','skillion'].includes(roofShape)?
        Math.min(height*.38,tag?.roofHeight??(tag?.roofLevels?tag.roofLevels*2:Math.sqrt(size)*.14)):0;
      const low=minimum?base+minimum:Math.min(base,...rings[0].map(ground))-.5;
      const measuredRoof=survey && !tag?.part && !minimum ? matchRoof(survey,rings[0],x>>4,y>>4) : undefined;
      const kind=facadeKind(solid,size,height,tag?.use,shed);
      if(datum==='orthometric' && !minimum && rings.length===1 && !measuredRoof?.[6].length){
        const profile=measuredRoof && surveyFits(measuredRoof,mapped)?measuredRoof:undefined;
        const pitch=profile?.[7];
        let eaves=height-ridge,rh=ridge;
        let type:0|1|2=roofShape.includes('hip')?2:1;
        if(pitch){
          eaves=pitch[2]*.5;rh=pitch[3]*.5;type=pitch[0]===0?1:2;
        }else if(profile){
          eaves=profile[4]*.5;
          rh=roofShape==='flat'?0:Math.min((profile[5]-profile[4])*.5,eaves*.32);
        }
        const inferredHouse=!pitch && !tag?.roof && (kind&3)===0;
        const roof=inferredHouse?undefined:{type:rh?type:0 as const,rh};
        const roofHeight=inferredHouse?(profile?profile[4]*.5:height):eaves+rh*.5;
        const record=cityFootprint(rings[0],roofHeight,base,kind,roof,pitch?-pitch[1]*Math.PI/256:undefined);
        // Kyoto extrudes irregular flat outlines. Retain the surveyed roof planes of an irregular pitched house.
        const simple=pitch || !tag?.roof || ['flat','gabled','hipped'].includes(tag.roof);
        if(simple && record && ('x' in record || rh===0 || inferredHouse)){city.push(record);return;}
      }
      const mesh=new Mesh((east-west)*mx,(north-south)*my);
      if(datum==='orthometric')mesh.wallDatum=base;
      if(!measuredRoof || !drawSurveyedRoof(mesh,projected,measuredRoof,base,low,style,x>>4,y>>4,local,roofShape,mapped)){
        building(mesh,projected,base+minimum,base+height-ridge,ridge,style,roofShape,low);
      }
      const instance=mesh.buffers(String(locations.length));if(instance){meshes.push(instance);locations.push(p);if(datum==='orthometric')facades.push([kind,Math.round(style*65535),Math.round(height*4)]);}
    };
    // Keep tagged parts separate from parent footprints (e.g. towers over station podiums).
    const relevant=tags.flatMap(tag=>tag.polygons.filter(r=>r[0]?.some(([lon,lat])=>lon>=west-.003&&lon<=east+.003&&lat>=south-.003&&lat<=north+.003))
      .map(rings=>({tag,rings,point:midpoint(rings[0])})));
    const outlines=relevant.filter(row=>!row.tag.part),parts=relevant.filter(row=>row.tag.part);
    const taggedHeight=(tag:BuildingTag)=>tag.height??(tag.levels===undefined?0:tag.levels*3.1);
    const matchedSolid=new Set<string>(),matchedHighRise=new Set<string>();
    const buildings=tile?.layers.BldA;
    for(let i=0;i<(buildings?.length??0);i++){
      const f=buildings!.feature(i),code=Number(f.properties.vt_code);
      const isSolid=code===3102||code===3103||code===3112,isHighRise=code===3103,isShed=code===3111;
      for(const rings of polygons(f,x,y,16)){
        const p=midpoint(rings[0]);if(!here(p))continue;
        const row=outlines.find(r=>inPolygon(p,r.rings)||inPolygon(r.point,rings));
        // Model an attributed outline once, even when GSI split it at a tile edge.
        if(row){if(isSolid)matchedSolid.add(row.tag.id);if(isHighRise)matchedHighRise.add(row.tag.id);continue;}
        if(parts.some(r=>inPolygon(p,r.rings)))continue;
        appendBuilding(rings,p,undefined,isSolid,isHighRise,isShed);
      }
    }
    for(const row of relevant){
      if(!here(row.point))continue;
      // A station outline may repeat the full tower height. Its podium and towers
      // are represented by their individual parts in both near and distant views.
      if(!row.tag.part && parts.some(part=>inPolygon(part.point,row.rings)
        && taggedHeight(part.tag)>=.95*taggedHeight(row.tag)))continue;
      const isSolid=matchedSolid.has(row.tag.id)||(row.tag.levels!==undefined&&row.tag.levels>3)||(row.tag.height!==undefined&&row.tag.height>=13)||(row.tag.use!==undefined&&row.tag.use>=2);
      appendBuilding(row.rings,row.point,row.tag,isSolid,matchedHighRise.has(row.tag.id),false);
    }
    const karahashi=y===25964&&(x===57508||x===57509);
    const bounds:[number,number,number,number]=[west,south,east,north];
    if(karahashi)drawSetaBridges(groundMesh,bounds,local,datum,ground);
    const roadLayer=tile?.layers.RdCL;
    if(roadLayer)for(let i=0;i<roadLayer.length;i++){
      const f=roadLayer.feature(i),props=f.properties;
      const code=Number(props.vt_code);
      const clearance=bridgeClearance(Number(props.vt_lvorder??0),Number(props.vt_motorway??0)===1,String(props.vt_rdctg??''));
      const width=roadWidth(props.vt_rnkwidth);
      const skip=karahashi&&code===2703?isSetaDeck:undefined;
      for(const line of f.loadGeometry()){
        const pts=line.map(v=>lonLat(x+v.x/f.extent,y+v.y/f.extent,16));
        drawBridgePolyline(groundMesh,pts,bounds,ground,xyz,{width,clearance,skip});
      }
    }
    const trackPoints:Point[]=[];
    const trackLayer=tile?.layers.RailTrCL;
    if(trackLayer)for(let i=0;i<trackLayer.length;i++){
      const f=trackLayer.feature(i),props=f.properties,code=Number(props.vt_code);
      if(code>=2820&&code<2830)continue; // Aerial ropeways/cableways are not steel ballast tracks.
      const structure=railStructure('RailTrCL',code,String(props.vt_railstate??''));
      if(structure==='hidden')continue;
      const shinkansen=code>=2840&&code<2850,monorail=code>=2830&&code<2840,tram=code>=2810&&code<2820;
      const lvorder=Number(props.vt_lvorder??0);
      for(const line of f.loadGeometry()){
        const pts=line.map(v=>lonLat(x+v.x/f.extent,y+v.y/f.extent,16));
        for(const p of pts)if(here(p))trackPoints.push(p);
        drawRailPolyline(groundMesh,pts,bounds,ground,xyz,{raised:structure==='raised',doubleTrack:false,shinkansen,monorail,tram,lvorder});
      }
    }
    const railLayer=tile?.layers.RailCL;
    if(railLayer)for(let i=0;i<railLayer.length;i++){
      const f=railLayer.feature(i),props=f.properties;
      if(String(props.vt_rtcode??'')==='索道')continue;
      const structure=railStructure('RailCL',Number(props.vt_code),String(props.vt_railstate??''));
      if(structure==='hidden')continue;
      const doubleTrack=String(props.vt_sngldbl??'').includes('複線');
      const lvorder=Number(props.vt_lvorder??0);
      for(const line of f.loadGeometry()){
        const pts=line.map(v=>lonLat(x+v.x/f.extent,y+v.y/f.extent,16));
        if(pts.length<2)continue;
        // Skip routes already modelled track-by-track in RailTrCL to avoid double-stacking.
        const mid=pts[Math.floor(pts.length/2)];
        if(trackPoints.some(t=>Math.abs(t[0]-mid[0])<.00022&&Math.abs(t[1]-mid[1])<.00018))continue;
        drawRailPolyline(groundMesh,pts,bounds,ground,xyz,{raised:structure==='raised',doubleTrack,shinkansen:false,monorail:false,tram:false,lvorder});
      }
    }
    if(datum!=='orthometric')for(const f of fields){
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
    if(canopy)for(let i=0;i<side;i++)for(let j=0;j<side;j++){
      const ix=x*side+i,iy=y*side+j,seed=noise(ix,iy);
      const p=lonLat(x+(i+.1+.8*noise(ix+17,iy))/side,y+(j+.1+.8*noise(ix,iy+31))/side,16);
      if(seed>canopy(p)*.96||inWater(p)||occupied.get(row(p)*8+col(p))?.some(r=>inPolygon(p,r)))continue;
      const [px,py]=local(p);tree(groundMesh,px,py,ground(p),noise(iy,ix+6));
    }
    const terrain=groundMesh.buffers();if(terrain)meshes.push(terrain);
    return {center,locations,...(datum==='orthometric'?{city,facades,...(sacredSites.length?{sacred:sacredSites}:{})}:{}),geometry:combineTileMeshes(meshes)};
  };
}
