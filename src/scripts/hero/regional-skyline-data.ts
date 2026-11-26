import {lonLat,tileXY,type Point} from '../kansai/coordinates';
import {roofSurvey,drawSurveyedRoof,type RoofRecord} from '../kansai/surveyed-roofs';
import {building,Mesh} from '../kansai/mesh';
import {facadeKind} from '../kansai/city-footprint';
import {inflate} from '../kansai/sources';
import {ORIGIN,M_PER_DEG_LAT,M_PER_DEG_LON,toLocal,type Box} from './geo';
import {inOsakaLandmarkMask} from './osaka-landmarks';
import {inAirportBuildingMask} from './airports-data';

type Row=[number,number,unknown,unknown,number[][]];
export type Heights=(centers:Float32Array<ArrayBuffer>)=>Promise<Float32Array<ArrayBuffer>>;
export type Request={x:number;y:number;legacy:Box[]};
export type Range={start:number;count:number;tile:string};
export type Skyline={
  positions:Float32Array<ArrayBuffer>;normals:Float32Array<ArrayBuffer>;uv:Float32Array<ArrayBuffer>;colors:Uint8Array<ArrayBuffer>;identity:Uint16Array<ArrayBuffer>;
  /** Rooftop aviation obstacle lights on tall towers (>=72 m): [localEast, localNorth, elevation] and [phase, pulseFlag]. */
  beaconPos:Float32Array<ArrayBuffer>;beaconMeta:Float32Array<ArrayBuffer>;
  ranges:Range[];center:{x:number;z:number};bounds:number[];
};

export async function compileSkyline({x,y,legacy}:Request,sample:Heights,cooperate:()=>Promise<boolean>):Promise<Skyline|null>{
  const [response,survey]=await Promise.all([fetch('/kansai/skyline/'+x+'-'+y+'.json.gz'),roofSurvey(x,y)]);
  if(!response.ok)throw new Error('Skyline survey '+response.status);
  const rows:Row[]=JSON.parse(new TextDecoder().decode(await inflate(new Uint8Array(await response.arrayBuffer()))));
  const [lon,lat]=lonLat(x+.5,y+.5,12),center=toLocal(lat,lon);
  const buildings:{polygons:Point[][];x:number;z:number;tile:string;height:number;min:number;style:number;roof?:RoofRecord}[]=[];
  const identity:number[]=[],beaconPos:number[]=[],beaconMeta:number[]=[],mesh=new Mesh(),ranges:Range[]=[],bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  let deadline=performance.now()+3;
  for(let i=0;i<rows.length;i++){
    const [height,min,,,rings]=rows[i];
    const polygons=rings.map(r=>{
      const ring:Point[]=[];
      for(let k=0;k<r.length;k+=2){
        const [lo,la]=lonLat(x+r[k]/16384,y+r[k+1]/16384,12),p=toLocal(la,lo);
        ring.push([p.x-center.x,center.z-p.z]);
      }
      return ring;
    });
    const ring=polygons[0];
    if(!ring?.length)continue;
    let w=Infinity,s=Infinity,e=-Infinity,n=-Infinity;
    for(const [px,py] of ring){w=Math.min(w,px);e=Math.max(e,px);s=Math.min(s,py);n=Math.max(n,py);}
    const px=center.x+(w+e)/2,pz=center.z-(s+n)/2;
    if(legacy.some(b=>px>=b[0]&&pz>=b[1]&&px<=b[2]&&pz<=b[3]))continue;
    if(inOsakaLandmarkMask(px,pz)||inAirportBuildingMask(px,pz))continue;
    const [tx,ty]=tileXY(ORIGIN.lon+px/M_PER_DEG_LON,ORIGIN.lat-pz/M_PER_DEG_LAT,16).map(Math.floor);
    let roof:RoofRecord|undefined;
    if(survey && !min){
      const r=rings[0];let w=Infinity,n=Infinity,e=-Infinity,s=-Infinity;
      for(let k=0;k<r.length;k+=2){w=Math.min(w,r[k]);e=Math.max(e,r[k]);n=Math.min(n,r[k+1]);s=Math.max(s,r[k+1]);}
      roof=survey(w,n,e,s);
    }
    buildings.push({roof,polygons,x:px,z:pz,tile:'16/'+tx+'/'+ty,height,min,style:((i*16807)%997)/997});
    bounds[0]=Math.min(bounds[0],w);bounds[1]=Math.min(bounds[1],s);
    bounds[3]=Math.max(bounds[3],e);bounds[4]=Math.max(bounds[4],n);
    if(performance.now()>deadline){if(!await cooperate())return null;deadline=performance.now()+3;}
  }
  if(!buildings.length)return null;
  const points=new Float32Array(buildings.length*2);
  buildings.forEach((b,i)=>{points[i*2]=b.x;points[i*2+1]=b.z;});
  const heights=await sample(points);
  if(!heights.length)return null;
  for(const [i,b] of buildings.entries()){
    const base=heights[i],start=mesh.positions.length/3;
    const local=([lo,la]:Point):Point=>{const p=toLocal(la,lo);return [p.x-center.x,center.z-p.z];};
    mesh.wallDatum=base;
    if(!b.roof || !drawSurveyedRoof(mesh,b.polygons,b.roof,base,base,b.style,x,y,local,'flat')){
      building(mesh,b.polygons,base+b.min,base+b.height,0,b.style,'flat',base+b.min);
    }
    bounds[2]=Math.min(bounds[2],base+b.min);bounds[5]=Math.max(bounds[5],base+b.height,base+(b.roof?Math.max(b.roof[5],b.roof[7]?b.roof[7][2]+b.roof[7][3]:0,...b.roof[6].map(t=>t[0]))*.5:0));
    const footprint=b.polygons[0];
    const area=Math.abs(footprint.reduce((sum,p,k)=>{const q=footprint[(k+1)%footprint.length];return sum+p[0]*q[1]-q[0]*p[1];},0))*.5;
    const kind=facadeKind(true,area,b.height);
    for(let j=start;j<mesh.positions.length/3;j++)identity.push(kind,Math.round(b.style*65535),Math.round(b.height*4));
    // Japanese aviation law obstacle lights (航空障害灯) on genuine high-rises >= 72 m (avoiding narrow annex fragments).
    if(b.height>=72 && area>=220 && !b.min){
      const topZ=base+b.height+2.0;
      const flash=b.height>=115?1:0;
      if(b.height>=145 && footprint.length>=3){
        // Two beacons on opposite roof corners only for major supertall skyscrapers >= 145 m.
        let minP=footprint[0],maxP=footprint[0];
        for(const p of footprint){
          if(p[0]+p[1]<minP[0]+minP[1])minP=p;
          if(p[0]+p[1]>maxP[0]+maxP[1])maxP=p;
        }
        const cx=(minP[0]+maxP[0])*.5,cy=(minP[1]+maxP[1])*.5;
        beaconPos.push(cx+(minP[0]-cx)*.82,cy+(minP[1]-cy)*.82,topZ);
        beaconMeta.push(b.style,flash);
        beaconPos.push(cx+(maxP[0]-cx)*.82,cy+(maxP[1]-cy)*.82,topZ);
        beaconMeta.push(b.style,flash);
      }else{
        let bx=0,by=0;
        for(const p of footprint){bx+=p[0];by+=p[1];}
        beaconPos.push(bx/footprint.length,by/footprint.length,topZ);
        beaconMeta.push(b.style,flash);
      }
    }
    ranges.push({start,count:mesh.positions.length/3-start,tile:b.tile});
    if(performance.now()>deadline){if(!await cooperate())return null;deadline=performance.now()+3;}
  }
  return {positions:new Float32Array(mesh.positions),normals:new Float32Array(mesh.normals),
    uv:new Float32Array(mesh.uv),colors:new Uint8Array(mesh.colors),identity:new Uint16Array(identity),
    beaconPos:new Float32Array(beaconPos),beaconMeta:new Float32Array(beaconMeta),ranges,bounds,center};
}
