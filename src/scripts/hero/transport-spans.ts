import * as THREE from 'three';
import type {Env} from './env';
import {ENV_GLSL} from './env';
import {yieldTask} from './task-yield';
import {bridgeFrame, type Bridge} from './bridges';
import {RAIL_BALLAST} from './rail-ballast';

export interface TransportSpan {kind:'road'|'rail';width:number;level:number;points:[number,number][]}
interface Segment {x:number;z:number;ux:number;uz:number;length:number;width:number;y:number;rise:number}
const cell=(i:number,j:number)=>i*4096+j;

/** Only lift traffic running along the mapped deck. Surface traffic passing under it stays on its road. */
function roadIndex(){
  const bins=new Map<number,Segment[]>();
  return {
    add(s:Segment){
      const bx=s.x+s.ux*s.length,bz=s.z+s.uz*s.length,w=s.width/2;
      for(let i=Math.floor((Math.min(s.x,bx)-w)/64);i<=Math.floor((Math.max(s.x,bx)+w)/64);i++){
        for(let j=Math.floor((Math.min(s.z,bz)-w)/64);j<=Math.floor((Math.max(s.z,bz)+w)/64);j++){
          const key=cell(i,j); if(!bins.has(key))bins.set(key,[]); bins.get(key)!.push(s);
        }
      }
    },
    heightAt(x:number,z:number,dx:number,dz:number){
      let y=-Infinity;
      const segments=bins.get(cell(Math.floor(x/64),Math.floor(z/64)));
      if(segments)for(const s of segments){
        if(Math.abs(dx*s.ux+dz*s.uz)<.88)continue;
        const rx=x-s.x,rz=z-s.z,t=rx*s.ux+rz*s.uz;
        if(t<0||t>s.length||Math.abs(rx*s.uz-rz*s.ux)>s.width/2+.3)continue;
        y=Math.max(y,s.y+s.rise*t/s.length);
      }
      return y;
    }
  };
}

type Batch={position:number[];color:number[];index:number[]};
const slate=[.105,.116,.126], concrete=[.25,.24,.215], railTop=[.28,.26,.21];
/** One geographic batch per visible tile. Heights approximate the alignment between surveyed plan positions. */
export async function buildTransportSpans(env:Env,source:TransportSpan[],ground:(x:number,z:number)=>number,custom:Bridge[]){
  const group=new THREE.Group(); group.name='mapped-bridges-and-viaducts';
  const roads=roadIndex(), batches=new Map<number,Batch>();
  const material=new THREE.ShaderMaterial({uniforms:env,side:THREE.DoubleSide,
    vertexShader:`attribute vec3 aColor; varying vec3 vWorld;varying vec3 vColor;
      void main(){vWorld=position;vColor=aColor;gl_Position=projectionMatrix*viewMatrix*vec4(position,1.);}`,
    fragmentShader:`${ENV_GLSL} varying vec3 vWorld;varying vec3 vColor;
      void main(){vec3 n=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
      gl_FragColor=vec4(applyHaze(shade(vColor,n,vWorld,1.),vec3(0.),vWorld),1.);}`});
  const replacements=[...custom,{x:-7461,z:-1029,angle:84.2,length:158,width:13}]; // Togetsukyo has a dedicated model.
  let deadline=performance.now()+5;
  for(const path of source){
    if(performance.now()>deadline){await yieldTask();deadline=performance.now()+5;}
    const p=path.points,rail=path.kind==='rail',w=path.width/2;
    const cum=[0];
    for(let i=1;i<p.length;i++)cum.push(cum[i-1]+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
    const total=cum[cum.length-1];if(total<4)continue;
    const clearance=(rail?6:4.2)+Math.min(2,Math.max(0,path.level-1))*2;
    const ends=[ground(...p[0]),ground(...p[p.length-1])];
    const deck=(x:number,z:number,d:number)=>{
      const lift=Math.min(clearance,Math.min(d,total-d)*.11);
      const chord=ends[0]+(ends[1]-ends[0])*d/total;
      return Math.max(ground(x,z),total<220?chord:-Infinity)+lift+.2;
    };
    for(let i=1;i<p.length;i++){
      const [ax,az]=p[i-1],[bx,bz]=p[i],len=cum[i]-cum[i-1];if(len<.01)continue;
      const ux=(bx-ax)/len,uz=(bz-az)/len,steps=Math.ceil(len/38);
      for(let j=0;j<steps;j++){
        const off=len*j/steps,length=len/steps,x=ax+ux*off,z=az+uz*off,d=cum[i-1]+off;
        const cx=x+ux*length/2,cz=z+uz*length/2;
        if(!rail&&replacements.some(b=>{
          if(Math.abs(cx-b.x)>220||Math.abs(cz-b.z)>220)return false;
          const q=bridgeFrame(b,cx,cz);
          return Math.abs(q.along)<b.length/2+5&&Math.abs(q.across)<b.width/2+2;
        }))continue;
        const key=cell(Math.floor(cx/5500),Math.floor(cz/5500));
        let batch=batches.get(key);if(!batch){batch={position:[],color:[],index:[]};batches.set(key,batch);}
        const {position,color,index}=batch,h=deck(x,z,d),end=deck(x+ux*length,z+uz*length,d+length);
        if(!rail)roads.add({x,z,ux,uz,length,width:path.width,y:h,rise:end-h});
        // Extrude the slab and the raised parapets. A dark ballast bed and two steel strips distinguish railway decks.
        const strip=(lo:number,low:number,hi:number,high:number,tint:number[])=>{
          const k=position.length/3;
          for(const t of [0,1])for(const [offset,dy] of [[lo,low],[hi,high]]){
            position.push(x+ux*length*t-uz*offset,h+(end-h)*t+dy,z+uz*length*t+ux*offset);
            color.push(...tint);
          }
          index.push(k,k+1,k+2,k+2,k+1,k+3);
        };
        strip(-w,0,w,0,rail?RAIL_BALLAST:slate);
        for(const side of [-1,1]){
          strip(side*w,-.85,side*w,.65,concrete);
          strip(side*w,.65,side*(w-.22),.65,concrete);
          if(rail)strip(side*.62,.08,side*.79,.08,railTop);
        }
        strip(w,-.85,-w,-.85,concrete);
        // One pier per 30 m of continuous alignment, including a central support on short spans.
        const pier=Math.ceil((d-total/2)/30)*30+total/2;
        if(pier>=d && pier<d+length && Math.min(pier,total-pier)>6){
          const px=x+ux*(pier-d),pz=z+uz*(pier-d),top=h+(end-h)*(pier-d)/length-.8,base=ground(px,pz)-.35;
          if(top>base+.4){
            const k=position.length/3;
            for(const y of [base,top])for(const [along,across] of [[-.7,-w*.48],[.7,-w*.48],[.7,w*.48],[-.7,w*.48]]){
              position.push(px+ux*along-uz*across,y,pz+uz*along+ux*across);color.push(...concrete);
            }
            for(let n=0;n<4;n++){const m=(n+1)%4;index.push(k+n,k+m,k+n+4,k+n+4,k+m,k+m+4);}
          }
        }
      }
    }
  }
  for(const {position,color,index} of batches.values()){
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
    g.setAttribute('aColor',new THREE.Float32BufferAttribute(color,3));
    g.setIndex(index);g.computeBoundingSphere(); group.add(new THREE.Mesh(g,material));
  }
  return {group,heightAt:roads.heightAt};
}
