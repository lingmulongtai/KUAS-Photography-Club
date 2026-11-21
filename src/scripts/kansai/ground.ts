import type {VectorTile} from '@mapbox/vector-tile';
import {classifyRings} from '@mapbox/vector-tile';
import type {Point,Box} from './coordinates';
import {inPolygon,lonLat} from './coordinates';
import {Mesh,strip,type RGB,type XYZ} from './mesh';


export function roadWidth(rank:unknown){
  const label=String(rank??'');
  if(label.includes('19.5m以上'))return 23;
  if(label.startsWith('13m'))return 16;
  if(label.startsWith('5.5m'))return 8;
  if(label.startsWith('3m-'))return 4.5;
  return 2.4;
}
// Clip the parent z15 geometry to each z16 child, preserving courtyards and water holes.
function clipRing(ring:Point[],box:Box){
  for(let edge=0;edge<4;edge++){
    const axis=edge%2,bound=box[edge],sign=edge<2?1:-1;
    const out:Point[]=[];
    for(let i=0;i<ring.length;i++){
      const a=ring[(i+ring.length-1)%ring.length],b=ring[i];
      const ain=(a[axis]-bound)*sign>=0,bin=(b[axis]-bound)*sign>=0;
      if(ain!==bin){
        const t=(bound-a[axis])/(b[axis]-a[axis]);
        out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
      }
      if(bin)out.push(b);
    }
    ring=out;
  }
  return ring;
}
function clipSegment(a:Point,b:Point,box:Box):[Point,Point]|undefined{
  let start=0,end=1;
  for(let i=0;i<2;i++){
    const d=b[i]-a[i];
    if(!d){if(a[i]<box[i]||a[i]>box[i+2])return;continue;}
    const v=(box[i]-a[i])/d,w=(box[i+2]-a[i])/d;
    start=Math.max(start,Math.min(v,w));end=Math.min(end,Math.max(v,w));
  }
  if(start>=end)return;
  const at=(t:number):Point=>[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];
  return [at(start),at(end)];
}
export function drawGround(mesh:Mesh,x:number,y:number,source:VectorTile|undefined,edges:VectorTile|undefined,
  ground:(p:Point)=>number,xyz:(p:Point,h:number)=>XYZ,owner:(p:Point)=>string|undefined){
  const [w,n]=lonLat(x,y,16),[e,s]=lonLat(x+1,y+1,16),bounds:Box=[w,s,e,n];
  const water=source?.layers.WA;
  const waterAreas:Point[][][]=[];
  const at15=(p:{x:number;y:number},extent:number)=>lonLat((x>>1)+p.x/extent,(y>>1)+p.y/extent,15);
  if(water)for(let i=0;i<water.length;i++){
    const f=water.feature(i);
    for(const group of classifyRings(f.loadGeometry())){
      const rings=group.map(r=>clipRing(r.map(p=>at15(p,f.extent)),bounds));
      if(rings[0].length<3||!rings[0].some(owner))continue;
      waterAreas.push(rings);
    }
  }
  for(const name of ['RdCL','RvrCL','Cstline','RdEdg','WL']){
    const near=name==='RdEdg'||name==='WL',layer=(near?edges:source)?.layers[name];
    if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      const f=layer.feature(i),road=name==='RdCL',code=Number(f.properties.vt_code);
      const width=road?roadWidth(f.properties.vt_rnkwidth):name==='RvrCL'?1.9:name==='RdEdg'?.32:.62;
      const color:RGB=road?(code>=2720?[143,137,123]:[97,96,93]):name==='RdEdg'?[147,143,132]:code===5302?[130,128,109]:[85,109,111];
      for(const line of f.loadGeometry()){
        for(let j=1;j<line.length;j++){
          const convert=(p:{x:number;y:number})=>near?lonLat(x+p.x/f.extent,y+p.y/f.extent,16):at15(p,f.extent);
          const clipped=clipSegment(convert(line[j-1]),convert(line[j]),bounds);
          if(!clipped)continue;
          const [a,b]=clipped,p:Point=[(a[0]+b[0])/2,(a[1]+b[1])/2];
          if(!owner(p))continue;
          const lift=near?.43:road?.32:.25;
          strip(mesh,xyz(a,ground(a)+lift),xyz(b,ground(b)+lift),width,color);
        }
      }
    }
  }
  // The lake surface uses continuous aerial imagery across the near and distant views.
  return (p:Point)=>waterAreas.some(rings=>inPolygon(p,rings));
}
