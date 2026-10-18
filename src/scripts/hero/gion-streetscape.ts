import * as THREE from 'three';
import type {Part} from './landmarks';
import type {BoxBuilding,PolyBuilding} from './buildings-data';

const AXIS=[[1416.7,-16.33],[1398.57,127.85],[1381.56,236.5]];
/** OSM Hanamikoji axis: a gently bending street, not a rectangular regeneration area. */
export function gionStreetPoint(x:number,z:number){
  let best={x:0,z:0,distance:Infinity};
  for(let i=1;i<AXIS.length;i++){
    const a=AXIS[i-1],b=AXIS[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    const q={x:a[0]+dx*t,z:a[1]+dz*t,distance:0};q.distance=Math.hypot(x-q.x,z-q.z);if(q.distance<best.distance)best=q;
  }return best;
}
function outline(b:BoxBuilding){
  const r:number[]=[],c=Math.cos(b.angle),s=Math.sin(b.angle);
  for(const [x,z] of [[-1,-1],[1,-1],[1,1],[-1,1]])r.push(b.x+c*x*b.w/2-s*z*b.d/2,b.z+s*x*b.w/2+c*z*b.d/2);
  return new Float32Array(r);
}

/** Keep every measured building. Only street-facing edges of low teahouses receive
 * timber screens, deep eaves and upper windows; dimensions/joinery are illustrative. */
export function gionStreetscape(data:{boxes:BoxBuilding[];polys:PolyBuilding[]},hf:{height(x:number,z:number):number}){
  const parts:Part[]=[],fronts:{x:number;z:number;distance:number}[]=[];
  for(const source of [...data.polys,...data.boxes.filter(b=>b.x>1330&&b.x<1490&&b.z>-50&&b.z<265)]){
    if(source.h>16||source.h<4)continue;
    const r='ring' in source?source.ring:outline(source);
    if(r[0]<1300||r[0]>1520||r[1]<-80||r[1]>290)continue;
    const base=hf.height('ring' in source?r[0]:source.x,'ring' in source?r[1]:source.z)+source.ground;
    let area=0;for(let i=0;i<r.length;i+=2){const j=(i+2)%r.length;area+=r[i]*r[j+1]-r[j]*r[i+1];}
    for(let i=0;i<r.length;i+=2){
      const j=(i+2)%r.length,a=area>0?i:j,b=area>0?j:i;
      const ax=r[a],az=r[a+1],bx=r[b],bz=r[b+1],len=Math.hypot(bx-ax,bz-az);
      if(len<3||len>45)continue;
      const x=(ax+bx)/2,z=(az+bz)/2,q=gionStreetPoint(x,z),nx=(bz-az)/len,nz=-(bx-ax)/len;
      if(z< -15||z>237||q.distance<3||q.distance>22||((q.x-x)*nx+(q.z-z)*nz)/q.distance<.7)continue;
      fronts.push({x,z,distance:q.distance});
      const wall:Part['color']=z<25?[.25,.043,.025]:[.15,.082,.04];
      const face=(u0:number,u1:number,y0:number,y1:number,color:Part['color'],offset=.15,glow=.1)=>{
        const point=(u:number,y:number)=>[ax+(bx-ax)*u+nx*offset,base+y,az+(bz-az)*u+nz*offset];
        const a=point(u0,y0),b=point(u1,y0),c=point(u1,y1),d=point(u0,y1),geo=new THREE.BufferGeometry();
        geo.setAttribute('position',new THREE.Float32BufferAttribute([...a,...d,...b,...b,...d,...c],3));geo.computeVertexNormals();parts.push({geo,color,glow});
      };
      const floor=Math.min(4.2,source.h*.45),upper=Math.min(source.h-1,floor+2.6);
      face(0,1,.2,source.h-.4,wall);
      face(.03,.97,.6,floor-.35,[.023,.022,.017],.18,.14);
      face(.04,.96,floor+.5,upper,[.028,.036,.034],.18,.3);
      const n=Math.ceil(len/.65);
      for(let k=0;k<=n;k++){
        const u=k/n,half=.065/len;
        face(Math.max(0,u-half),Math.min(1,u+half),.4,floor-.2,wall,.24);
      }
      for(let k=0;k<=Math.ceil(len/2.4);k++){
        const u=k/Math.ceil(len/2.4),half=.09/len;
        face(Math.max(0,u-half),Math.min(1,u+half),floor+.3,upper+.1,wall,.24);
      }
      const eave=new THREE.BoxGeometry(len+.3,.22,1.35);eave.rotateY(-Math.atan2(bz-az,bx-ax));eave.translate(x+nx*.5,base+floor,z+nz*.5);
      parts.push({geo:eave,color:[.055,.052,.044],glow:.1});
      const lantern=new THREE.CylinderGeometry(.23,.23,.6,8);lantern.translate(ax+(bx-ax)*.16+nx*.5,base+2.5,az+(bz-az)*.16+nz*.5);
      parts.push({geo:lantern,color:[.48,.23,.1],glow:3});
    }
  }
  return {parts,fronts};
}
