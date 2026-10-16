import { GYOEN_OUTLINE } from '../../data/kyotogyoen.ts';

type Point={x:number;z:number};
const cross=(x:number,z:number,u:number,v:number)=>x*v-z*u;

/** Split a road at a restricted park boundary; never join exterior fragments across its interior. */
export function trafficSegments(pts:Float32Array, boundary:readonly Point[]=GYOEN_OUTLINE):Float32Array[] {
  const xs=boundary.map(p=>p.x),zs=boundary.map(p=>p.z);
  const bounds=[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(let i=0;i<pts.length;i+=2){minX=Math.min(minX,pts[i]);maxX=Math.max(maxX,pts[i]);minZ=Math.min(minZ,pts[i+1]);maxZ=Math.max(maxZ,pts[i+1]);}
  if(maxX<bounds[0]||minX>bounds[2]||maxZ<bounds[1]||minZ>bounds[3])return [pts];
  const inside=(x:number,z:number)=>{
    let hit=false;
    for(let i=0,j=boundary.length-1;i<boundary.length;j=i++){
      const a=boundary[j],b=boundary[i],dx=b.x-a.x,dz=b.z-a.z;
      if(Math.abs(cross(x-a.x,z-a.z,dx,dz))<1e-5 && (x-a.x)*(x-b.x)+(z-a.z)*(z-b.z)<=1e-5)return false;
      if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)hit=!hit;
    }
    return hit;
  };
  const parts:Float32Array[]=[];
  let current:number[]=[],cut=false;
  const flush=()=>{if(current.length>=4)parts.push(new Float32Array(current));current=[];};
  for(let i=0;i<pts.length-2;i+=2){
    const ax=pts[i],az=pts[i+1],dx=pts[i+2]-ax,dz=pts[i+3]-az;
    const length2=dx*dx+dz*dz;if(length2<1e-10)continue;
    const cuts=[0,1];
    for(let j=0;j<boundary.length;j++){
      const a=boundary[j],b=boundary[(j+1)%boundary.length],ex=b.x-a.x,ez=b.z-a.z;
      const den=cross(dx,dz,ex,ez);
      if(Math.abs(den)>1e-9){
        const t=cross(a.x-ax,a.z-az,ex,ez)/den,u=cross(a.x-ax,a.z-az,dx,dz)/den;
        if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);
      } else if(Math.abs(cross(a.x-ax,a.z-az,dx,dz))<1e-5){
        for(const p of [a,b]){const t=((p.x-ax)*dx+(p.z-az)*dz)/length2;if(t>0&&t<1)cuts.push(t);}
      }
    }
    cuts.sort((a,b)=>a-b);
    for(let j=0;j<cuts.length-1;j++){
      const a=cuts[j],b=cuts[j+1];if(b-a<1e-8)continue;
      if(inside(ax+dx*(a+b)/2,az+dz*(a+b)/2)){cut=true;flush();continue;}
      const x=ax+dx*a,z=az+dz*a;
      if(current.length&&Math.hypot(current.at(-2)!-x,current.at(-1)!-z)>1e-4)flush();
      if(!current.length)current.push(x,z);
      current.push(ax+dx*b,az+dz*b);
    }
  }
  flush();
  return cut?parts:[pts];
}
