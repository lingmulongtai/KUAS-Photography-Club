import type { PolyBuilding } from './buildings-data';
import type { Box } from './geo';

/** Subtract a model's rectangular footprint without deleting a connected neighbouring wing. */
export function buildingCutout(building:PolyBuilding, box:Box, height:(x:number,z:number)=>number=()=>0):PolyBuilding[] {
  const ring=building.ring;
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(let i=0;i<ring.length;i+=2){minX=Math.min(minX,ring[i]);maxX=Math.max(maxX,ring[i]);minZ=Math.min(minZ,ring[i+1]);maxZ=Math.max(maxZ,ring[i+1]);}
  if(maxX<=box[0]||minX>=box[2]||maxZ<=box[1]||minZ>=box[3]) return [building];
  const ground=(r:ArrayLike<number>)=>{
    let x=0,z=0;for(let i=0;i<r.length;i+=2){x+=r[i];z+=r[i+1];}
    return height(x/(r.length/2),z/(r.length/2));
  };
  const originalGround=ground(ring)+building.ground;
  const clip=(input:number[],axis:number,edge:number,sign:number)=>{
    const out:number[]=[];
    for(let i=0;i<input.length;i+=2){
      const j=(i+input.length-2)%input.length;
      const a=[input[j],input[j+1]], b=[input[i],input[i+1]];
      const da=(a[axis]-edge)*sign, db=(b[axis]-edge)*sign;
      if((da>=0)!==(db>=0)){
        const t=da/(da-db);out.push(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);
      }
      if(db>=0)out.push(...b);
    }
    return out;
  };
  const parts:PolyBuilding[]=[];
  let inside=Array.from(ring);
  for(const [axis,edge,sign] of [[0,box[0],1],[0,box[2],-1],[1,box[1],1],[1,box[3],-1]]) {
    const outside=clip(inside,axis,edge,-sign);
    let area=0;
    for(let i=0;i<outside.length;i+=2){const j=(i+2)%outside.length;area+=outside[i]*outside[j+1]-outside[j]*outside[i+1];}
    if(Math.abs(area)>.5) parts.push({...building,ring:new Float32Array(outside),ground:originalGround-ground(outside)});
    inside=clip(inside,axis,edge,sign);
    if(!inside.length)break;
  }
  return parts;
}
