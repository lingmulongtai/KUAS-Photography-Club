import earcut from 'earcut';
import {pitchedRoof} from './roofs';
import type {Point} from './coordinates';

export type XYZ=[number,number,number];
export type RGB=[number,number,number];
export class Mesh {
  positions:number[]=[]; normals:number[]=[]; colors:number[]=[];
  uv:number[]=[];
  wallCode=128;
  wallDatum=0;
  surfaceType: 'land'|'wall'|'roof'='land';
  constructor(private width=1,private depth=1){}
  triangle(a:XYZ,b:XYZ,c:XYZ,color:RGB){
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz);
    if(len<1e-8)return;
    this.positions.push(...a,...b,...c);
    for(const [x,y,z] of [a,b,c]){
      this.normals.push(nx/len,ny/len,nz/len);
      this.colors.push(...color,this.surfaceType==='roof'?255:this.surfaceType==='wall'?this.wallCode:0);
      if(this.surfaceType==='roof')this.uv.push(x/this.width+.5,y/this.depth+.5);
      else this.uv.push((-ny*x+nx*y)/len,z-(this.surfaceType==='wall'?this.wallDatum:0));
    }
  }
  quad(a:XYZ,b:XYZ,c:XYZ,d:XYZ,color:RGB){this.triangle(a,b,c,color);this.triangle(a,c,d,color);}
  surface(rings:XYZ[][],color:RGB){
    const points=rings.flat(),holes:number[]=[];let count=rings[0].length;
    for(const ring of rings.slice(1)){holes.push(count);count+=ring.length;}
    const indices=earcut(points.flatMap(([x,y])=>[x,y]),holes);
    for(let i=0;i<indices.length;i+=3)this.triangle(points[indices[i]],points[indices[i+1]],points[indices[i+2]],color);
  }
  buffers(id?:string){
    if(!this.positions.length)return;
    return {id,positions:new Float64Array(this.positions),normals:new Float32Array(this.normals),
      colors:new Uint8Array(this.colors),uv:new Float32Array(this.uv)};
  }
}
export type PackedMesh=NonNullable<ReturnType<Mesh['buffers']>>;
export function noise(x:number,y:number){
  let n=Math.imul(x|0,0x165667b1)^Math.imul(y|0,0x27d4eb2d);
  n=Math.imul(n^(n>>>15),0x85ebca77);return ((n^(n>>>13))>>>0)/4294967296;
}
export function withZ(p:Point,z:number):XYZ{return [p[0],p[1],z];}
export function strip(m:Mesh,a:XYZ,b:XYZ,width:number,color:RGB,depth=0,offset=0){
  const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);
  if(l<.05)return;
  const point=(p:XYZ,t:number,d=0):XYZ=>[p[0]-dy/l*t,p[1]+dx/l*t,p[2]-d];
  const s=offset-width/2,t=offset+width/2;
  m.quad(point(a,s),point(b,s),point(b,t),point(a,t),color);
  if(depth){
    const edge=color.map(v=>Math.round(v*.73)) as RGB;
    m.quad(point(a,s,depth),point(b,s,depth),point(b,s),point(a,s),edge);
    m.quad(point(b,t,depth),point(a,t,depth),point(a,t),point(b,t),edge);
  }
}
// Neutral concrete, painted render, brick and stone. Use one repeatable finish per footprint.
const walls:RGB[]=[[154,151,144],[128,131,130],[173,163,146],[136,115,103],[160,165,161],[182,177,166]];
const roofs:RGB[]=[[80,84,85],[97,94,88],[74,83,91],[114,99,88],[73,81,78]];
/** Winding is normalized in east/north coordinates, including courtyard walls. */
export function building(m:Mesh,rings:Point[][],floor:number,eaves:number,ridge:number,style:number,roofShape:string,wallBase=floor,ridgeAngle?:number){
  if(!rings[0]?.length || eaves<=floor)return;
  const wall=walls[Math.min(walls.length-1,Math.floor(style*walls.length))];
  const roof=roofs[Math.min(4,Math.floor(style*5))];
  m.surfaceType='wall';
  for(let k=0;k<rings.length;k++){
    const r=rings[k];
    const twiceArea=r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0);
    if((twiceArea>0)!==(k===0))r.reverse();
    for(let i=0;i<r.length;i++){
      const a=r[i],b=r[(i+1)%r.length];
      m.quad(withZ(a,wallBase),withZ(b,wallBase),withZ(b,eaves),withZ(a,eaves),wall);
    }
  }
  if(ridge>0){
    pitchedRoof(rings,roofShape,eaves,ridge,(a,b,c)=>{m.surfaceType='roof';m.triangle(a,b,c,roof);},
      (a,b,c,d)=>{m.surfaceType='wall';m.quad(a,b,c,d,wall);},ridgeAngle);
  }else{
    m.surfaceType='roof';m.surface(rings.map(r=>r.map(v=>withZ(v,eaves))),roof);
  }
}
export function tree(m:Mesh,x:number,y:number,z:number,seed:number){
  const h=6+11*seed,r=2.6+3*seed;
  const crown:RGB=[49+Math.floor(seed*24),77+Math.floor(seed*32),49+Math.floor(seed*10)];
  const trunk:RGB=[87,70,54];
  const broad=seed>.18;
  const ring=(j:number,size:number,elevation:number):XYZ=>[x+r*size*Math.cos(j*Math.PI/3+seed),
    y+r*size*Math.sin(j*Math.PI/3+seed),z+h*elevation];
  for(let i=0;i<6;i++){
    m.quad(ring(i,.08,0),ring(i+1,.08,0),ring(i+1,.055,.39),ring(i,.055,.39),trunk);
    const bottom=ring(i,.58,.28),next=ring(i+1,.58,.28),middle=ring(i,1,.52),middleNext=ring(i+1,1,.52);
    m.quad(bottom,next,middleNext,middle,crown);
    const upper=ring(i,broad?.69:.44,broad?.83:.72),upperNext=ring(i+1,broad?.69:.44,broad?.83:.72);
    m.quad(middle,middleNext,upperNext,upper,crown);
    m.triangle(upper,upperNext,[x+r*.12,y,z+h],crown);
  }
}
