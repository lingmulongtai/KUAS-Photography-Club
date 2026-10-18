import * as THREE from 'three';
import type {Part} from './landmarks';
import type {BoxBuilding,PolyBuilding} from './buildings-data';

const styles=[
  {id:'takashimaya',bounds:[723.55,-6.63,885.4,130.96],floors:8,stone:[.46,.39,.31]},
  {id:'garden',bounds:[910.51,-9.39,967.51,51.05],floors:8,stone:[.3,.31,.3]},
  {id:'northeast',bounds:[909.85,-56.19,940.06,-31.46],floors:9,stone:[.19,.2,.19]},
  {id:'northwest',bounds:[865.93,-55.8,880.87,-34.09],floors:9,stone:[.35,.32,.28]},
  {id:'opa',bounds:[820.85,-122.05,881.02,-73.76],floors:9,stone:[.34,.31,.28]},
  {id:'t8',bounds:[627.05,-.52,669.85,85.06],floors:7,stone:[.35,.34,.3]},
  {id:'northwest-neighbour1',bounds:[812.29,-64.21,840.8,-28.81],floors:6,stone:[.36,.34,.3]},
  {id:'northwest-neighbour2',bounds:[851.92,-60.77,869.01,-30.18],floors:8,stone:[.3,.29,.27]},
  {id:'northwest-neighbour3',bounds:[838.46,-59.89,849.2,-29.58],floors:5,stone:[.39,.35,.29]},
];

function bounds(r:Float32Array){
  const b=[Infinity,Infinity,-Infinity,-Infinity];for(let i=0;i<r.length;i+=2){b[0]=Math.min(b[0],r[i]);b[1]=Math.min(b[1],r[i+1]);b[2]=Math.max(b[2],r[i]);b[3]=Math.max(b[3],r[i+1]);}return b;
}
function outline(b:BoxBuilding){
  const r:number[]=[];const c=Math.cos(b.angle),s=Math.sin(b.angle);
  for(const [x,z] of [[-1,-1],[1,-1],[1,1],[-1,1]])r.push(b.x+c*x*b.w/2-s*z*b.d/2,b.z+s*x*b.w/2+c*z*b.d/2);
  return new Float32Array(r);
}

/** Add fixed architectural divisions to the original measured footprints and heights.
 * This preserves all setbacks and roads; facade bays are illustrative, without fake ads. */
export function kawaramachiFacades(data:{boxes:BoxBuilding[];polys:PolyBuilding[]},hf:{height(x:number,z:number):number}){
  const parts:Part[]=[],sites:string[]=[];
  for(const source of [...data.polys,...data.boxes.filter(b=>b.x>600&&b.x<980&&b.z>-140&&b.z<150)]){
    const ring='ring' in source?source.ring:outline(source),b=bounds(ring);
    const style=styles.find(s=>s.bounds.every((v,i)=>Math.abs(v-b[i])<2));if(!style)continue;
    sites.push(style.id);
    const base=hf.height('ring' in source?ring[0]:source.x,'ring' in source?ring[1]:source.z)+source.ground;
    const floor=source.h/style.floors;
    let area=0;for(let i=0;i<ring.length;i+=2){const j=(i+2)%ring.length;area+=ring[i]*ring[j+1]-ring[j]*ring[i+1];}
    for(let i=0;i<ring.length;i+=2){
      const j=(i+2)%ring.length;
      const ax=ring[area>0?i:j],az=ring[(area>0?i:j)+1],bx=ring[area>0?j:i],bz=ring[(area>0?j:i)+1];
      const len=Math.hypot(bx-ax,bz-az);if(len<1.5)continue;
      const nx=(bz-az)/len,nz=-(bx-ax)/len;
      const face=(u0:number,u1:number,y0:number,y1:number,color:Part['color'],offset=.12,glow=.12)=>{
        const a=[ax+(bx-ax)*u0+nx*offset,base+y0,az+(bz-az)*u0+nz*offset],d=[a[0],base+y1,a[2]];
        const b=[ax+(bx-ax)*u1+nx*offset,base+y0,az+(bz-az)*u1+nz*offset],c=[b[0],base+y1,b[2]];
        const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([...a,...d,...b,...b,...d,...c],3));geo.computeVertexNormals();parts.push({geo,color,glow});
      };
      face(0,1,.6,source.h-.3,style.stone as Part['color']);
      for(let row=0;row<style.floors;row++){
        const y=row*floor;
        face(.01,.99,y+floor*.25,y+floor*.8,[.028,.05,.063],.16,.6);
        face(0,1,y+floor*.85,y+floor*.98,style.stone as Part['color'],.2);
      }
      const bays=Math.max(1,Math.ceil(len/(style.id==='takashimaya'?4.4:3.2)));
      for(let col=0;col<=bays;col++){
        const u=col/bays,half=Math.min(.18/len,.05);
        face(Math.max(0,u-half),Math.min(1,u+half),.6,source.h-.3,style.stone as Part['color'],.22);
      }
      // Deep ground-level canopy on the broad department-store / commercial faces.
      if(len>10){
        const geo=new THREE.BoxGeometry(len,.32,1.6);geo.rotateY(-Math.atan2(bz-az,bx-ax));
        geo.translate((ax+bx)/2+nx*.55,base+floor*.87,(az+bz)/2+nz*.55);
        parts.push({geo,color:[.19,.2,.19],glow:.1});
      }
    }
  }
  return {parts,sites};
}
