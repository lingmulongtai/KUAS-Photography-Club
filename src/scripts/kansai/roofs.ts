import earcut from 'earcut';
import type {Point} from './coordinates';
type Face=(p:Point)=>number;
export type RoofVertex=[number,number,number];

function clip(poly:Point[],distance:Face){
  const out:Point[]=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[(i+poly.length-1)%poly.length],b=poly[i],da=distance(a),db=distance(b);
    if((da<=0)!==(db<=0)){
      const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
    }
    if(db<=0)out.push(b);
  }
  return out;
}

/** Intersect roof planes with the actual footprint, including re-entrant wings and courtyards. */
export function pitchedRoof(rings:Point[][],shape:string,eaves:number,rise:number,
  face:(a:RoofVertex,b:RoofVertex,c:RoofVertex)=>void,
  wall:(a:RoofVertex,b:RoofVertex,c:RoofVertex,d:RoofVertex)=>void, ridgeAngle?:number){
  const outline=rings[0];
  let dx=1,dy=0,longest=0;
  for(let i=0;i<outline.length;i++){
    const p=outline[i],q=outline[(i+1)%outline.length],x=q[0]-p[0],y=q[1]-p[1],len=Math.hypot(x,y);
    if(len>longest){longest=len;dx=x/len;dy=y/len;}
  }
  if(ridgeAngle!==undefined){dx=Math.cos(ridgeAngle);dy=Math.sin(ridgeAngle);}
  const along:Face=([x,y])=>x*dx+y*dy,across:Face=([x,y])=>y*dx-x*dy;
  const u=outline.map(along),v=outline.map(across),u0=Math.min(...u),u1=Math.max(...u),v0=Math.min(...v),v1=Math.max(...v);
  const width=Math.max(.01,v1-v0),length=Math.max(.01,u1-u0);
  const left:Face=p=>2*(across(p)-v0)/width,right:Face=p=>2*(v1-across(p))/width;
  let planes:Face[]=[left,right];
  if(shape==='skillion')planes=[p=>left(p)*.5];
  if(['hipped','half-hipped','pyramidal','mansard'].includes(shape)){
    const run=shape==='pyramidal'?length:Math.min(length,width)*(shape==='half-hipped'?.55:1);
    planes.push(p=>2*(along(p)-u0)/run,p=>2*(u1-along(p))/run);
  }
  if(shape==='gambrel'||shape==='mansard')planes=planes.flatMap(f=>[p=>1.7*f(p),p=>.55+.45*f(p)]);
  const pts=rings.flat(),holes:number[]=[];let end=outline.length;
  for(const ring of rings.slice(1)){holes.push(end);end+=ring.length;}
  const triangles=earcut(pts.flatMap(([x,y])=>[x,y]),holes);
  const point=(p:Point,f:Face):RoofVertex=>[p[0],p[1],eaves+rise*Math.max(0,f(p))];
  for(const f of planes){
    for(let i=0;i<triangles.length;i+=3){
      let polygon=[pts[triangles[i]],pts[triangles[i+1]],pts[triangles[i+2]]];
      for(const g of planes)if(g!==f&&polygon.length)polygon=clip(polygon,p=>f(p)-g(p));
      for(let j=1;j+1<polygon.length;j++)face(point(polygon[0],f),point(polygon[j],f),point(polygon[j+1],f));
    }
    for(const ring of rings)for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      let lo=0,hi=1;
      for(const g of planes){
        if(g===f)continue;
        const start=f(a)-g(a),finish=f(b)-g(b);
        if(start>0&&finish>0){hi=-1;break;}
        if(start>0)lo=Math.max(lo,start/(start-finish));
        if(finish>0)hi=Math.min(hi,start/(start-finish));
      }
      if(hi-lo<1e-7)continue;
      const lerp=(t:number):Point=>[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];
      const p=lerp(lo),q=lerp(hi);
      if(Math.max(f(p),f(q))>1e-5)wall([...p,eaves],[...q,eaves],point(q,f),point(p,f));
    }
  }
}
