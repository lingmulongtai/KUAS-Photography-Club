import * as THREE from 'three';
import { CAMPUS_CENTER } from './geo.ts';

/** Metres in the campus drawing frame: u east, v south, y above the common ground floor.
 * The PLATEAU roof edges give the 1.58 degree rotation; its basement-inclusive LOD1 heights
 * are deliberately not used as the number of storeys. See docs/campus-architecture-2026-10-17.md.
 */
export const CAMPUS_YAW = -1.58 * Math.PI / 180;
export const CM = { wall:0, glass:1, concrete:2, roof:3, plant:4, metal:5, paving:6,
  brick:7, railing:8, timber:9, leaves:10, steel:11, white:12, lamp:13 } as const;
type P = [number,number,number];
type Material = typeof CM[keyof typeof CM];
export type CampusPart = { name:string; start:number; count:number };

/** A single, static, merged mesh. Small architectural elements share the same draw call. */
export class CampusBuilder {
  positions:number[]=[];
  normals:number[]=[];
  materials:number[]=[];
  cells:number[]=[];
  parts:CampusPart[]=[];
  readonly ground:number;
  constructor(ground:number) { this.ground=ground; }

  point([u,y,v]:P):P {
    const c=Math.cos(CAMPUS_YAW),s=Math.sin(CAMPUS_YAW);
    return [CAMPUS_CENTER.x+c*u-s*v,this.ground+y,CAMPUS_CENTER.z+s*u+c*v];
  }
  part(name:string,build:()=>void) {
    const start=this.materials.length;build();
    this.parts.push({name,start,count:this.materials.length-start});
  }
  quad(a:P,b:P,c:P,d:P,m:Material) {
    const edge=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const n=edge.cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a))).normalize();
    if(n.lengthSq()<.5)throw new Error('Degenerate campus surface');
    const ca=Math.cos(CAMPUS_YAW),sa=Math.sin(CAMPUS_YAW);
    const normal=[ca*n.x-sa*n.z,n.y,sa*n.x+ca*n.z];
    // Physical face coordinates keep bricks and glazing stable on vertical and inclined faces.
    const horizontal=Math.abs(n.y)>.8;
    const along=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize();
    for(const p of [a,b,c,a,c,d]) {
      this.positions.push(...this.point(p));this.normals.push(...normal);this.materials.push(m);
      this.cells.push(horizontal?p[0]:p[0]*along.x+p[2]*along.z,horizontal?p[2]:p[1]);
    }
  }
  box(u0:number,u1:number,v0:number,v1:number,y0:number,y1:number,m:Material) {
    this.quad([u0,y0,v0],[u0,y1,v0],[u1,y1,v0],[u1,y0,v0],m);
    this.quad([u1,y0,v1],[u1,y1,v1],[u0,y1,v1],[u0,y0,v1],m);
    this.quad([u0,y0,v1],[u0,y1,v1],[u0,y1,v0],[u0,y0,v0],m);
    this.quad([u1,y0,v0],[u1,y1,v0],[u1,y1,v1],[u1,y0,v1],m);
    this.quad([u0,y1,v0],[u0,y1,v1],[u1,y1,v1],[u1,y1,v0],m);
    this.quad([u0,y0,v1],[u0,y0,v0],[u1,y0,v0],[u1,y0,v1],m);
  }
  /** Rectangular beam between arbitrary endpoints, including inclined stair stringers. */
  beam(a:P,b:P,width:number,depth:number,m:Material) {
    const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),d=q.clone().sub(p).normalize();
    const side=(Math.abs(d.y)>.999?new THREE.Vector3(1,0,0):new THREE.Vector3(-d.z,0,d.x)).normalize().multiplyScalar(width/2);
    const up=new THREE.Vector3().crossVectors(d,side).normalize().multiplyScalar(depth/2);
    const corners=(v:THREE.Vector3)=>[v.clone().add(side).add(up),v.clone().sub(side).add(up),
      v.clone().sub(side).sub(up),v.clone().add(side).sub(up)].map(v=>v.toArray() as P);
    const x=corners(p),y=corners(q);
    this.quad(x[3],x[2],x[1],x[0],m);this.quad(y[0],y[1],y[2],y[3],m);
    for(let i=0;i<4;i++)this.quad(x[i],x[(i+1)%4],y[(i+1)%4],y[i],m);
  }
  rail(a:P,b:P,glass=true) {
    const len=Math.hypot(b[0]-a[0],b[2]-a[2]),n=Math.ceil(len/1.5);
    const at=(t:number,h:number):P=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t+h,a[2]+(b[2]-a[2])*t];
    this.beam(at(0,1.1),at(1,1.1),.065,.065,CM.metal);
    for(let i=0;i<=n;i++)this.beam(at(i/n,0),at(i/n,1.1),.055,.055,CM.metal);
    if(glass)for(let i=0;i<n;i++)this.quad(at(i/n+.012,.12),at((i+1)/n-.012,.12),at((i+1)/n-.012,1.03),at(i/n+.012,1.03),CM.railing);
    else for(const h of [.35,.7])this.beam(at(0,h),at(1,h),.035,.035,CM.metal);
  }
  /** Four pitched sheets around a recessed, flat service court; no random rooftop boxes. */
  hip(u0:number,u1:number,v0:number,v1:number,eave:number,ridge:number,inset:number) {
    const a:P=[u0,eave,v0],b:P=[u1,eave,v0],c:P=[u1,eave,v1],d:P=[u0,eave,v1];
    const ia:P=[u0+inset,ridge,v0+inset],ib:P=[u1-inset,ridge,v0+inset],ic:P=[u1-inset,ridge,v1-inset],id:P=[u0+inset,ridge,v1-inset];
    this.quad(a,ia,ib,b,CM.roof);this.quad(b,ib,ic,c,CM.roof);
    this.quad(c,ic,id,d,CM.roof);this.quad(d,id,ia,a,CM.roof);
    this.box(u0+inset,u1-inset,v0+inset,v1-inset,eave-.2,eave,CM.roof);
    this.quad(ia,[ia[0],eave,ia[2]],[ib[0],eave,ib[2]],ib,CM.roof);
    this.quad(ib,[ib[0],eave,ib[2]],[ic[0],eave,ic[2]],ic,CM.roof);
    this.quad(ic,[ic[0],eave,ic[2]],[id[0],eave,id[2]],id,CM.roof);
    this.quad(id,[id[0],eave,id[2]],[ia[0],eave,ia[2]],ia,CM.roof);
    for(const [p,q] of [[a,b],[b,c],[c,d],[d,a]] as [P,P][])this.beam(p,q,.16,.18,CM.metal);
  }
  /** Facade with real openings, recessed glazing, deep reveals and individual metal frames. */
  facade(a:[number,number],b:[number,number],y0:number,y1:number,openings:readonly [number,number,number,number][],m:Material=CM.brick) {
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
    const p=(u:number,y:number,inset=0):P=>[a[0]+dx*u-dz*inset,y,a[1]+dz*u+dx*inset];
    const us=[0,len,...openings.flatMap(o=>[o[0],o[1]])].sort((a,b)=>a-b);
    const ys=[y0,y1,...openings.flatMap(o=>[o[2],o[3]])].sort((a,b)=>a-b);
    for(let i=0;i<us.length-1;i++)for(let j=0;j<ys.length-1;j++){
      const u=(us[i]+us[i+1])/2,y=(ys[j]+ys[j+1])/2;
      if(us[i+1]-us[i]<.001||ys[j+1]-ys[j]<.001)continue;
      const glass=openings.some(o=>u>o[0]&&u<o[1]&&y>o[2]&&y<o[3]);
      const inset=glass?.3:0;
      this.quad(p(us[i],ys[j+1],inset),p(us[i+1],ys[j+1],inset),p(us[i+1],ys[j],inset),p(us[i],ys[j],inset),glass?CM.glass:m);
    }
    for(const [l,r,bottom,top] of openings){
      this.quad(p(l,bottom),p(l,bottom,.3),p(l,top,.3),p(l,top),CM.concrete);
      this.quad(p(r,top),p(r,top,.3),p(r,bottom,.3),p(r,bottom),CM.concrete);
      this.quad(p(l,top),p(l,top,.3),p(r,top,.3),p(r,top),CM.concrete);
      this.quad(p(r,bottom),p(r,bottom,.3),p(l,bottom,.3),p(l,bottom),CM.concrete);
      const bays=Math.ceil((r-l)/1.35);
      for(let k=0;k<=bays;k++)this.beam(p(l+(r-l)*k/bays,bottom,.25),p(l+(r-l)*k/bays,top,.25),.065,.065,CM.metal);
      if(top-bottom>5)for(let y=bottom+4;y<top;y+=4)this.beam(p(l,y,.25),p(r,y,.25),.09,.09,CM.metal);
    }
  }
  geometry() {
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(this.positions,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(this.normals,3));
    g.setAttribute('aMat',new THREE.Float32BufferAttribute(this.materials,1));
    g.setAttribute('aCell',new THREE.Float32BufferAttribute(this.cells,2));
    g.computeBoundingSphere();g.userData.parts=this.parts;
    return g;
  }
}

/** Kyoto City 2013 1/400 plans and 1/500 elevations: 120 x 24 m North, 33 x 45 m East,
 * four 4 m storeys. Glazed ends, irregular street openings and an open central entrance.
 */
export function addNorthEast(b:CampusBuilder) {
  b.part('north-envelope',()=>{
    const windows:[number,number,number,number][]=[
      [0,56,0,2.6],[64,120,0,2.6],
      [9,15,4,6.7],[25,32,4,6.7],[40,47,4,6.7],[72,111,4,6.7],
      [4,32,8,9.2],[52,68,8,9.2],[112,120,8,9.2],
      [16,48,12.4,13.8],[72,111,12.4,13.8],
      [28,32,4,14.4],[56,64,2.6,14.4],[96,100,4,14.4],
    ];
    for(const [lo,hi] of [[0,56],[64,120]]) {
      const cut=windows.filter(w=>w[1]>lo&&w[0]<hi).map(([a,c,y,z])=>[Math.max(a,lo)-lo,Math.min(c,hi)-lo,y,z] as [number,number,number,number]);
      b.facade([lo-52,-80],[hi-52,-80],0,16,cut);
    }
    // The middle 8 m is an open ground-floor passage, not a solid LOD1 prism.
    for(const [lo,hi] of [[-52,4],[12,68]]) {
      const width=hi-lo;
      b.facade([hi,-56],[lo,-56],0,16,[[0,width,0,2.8],[1,width-1,4.1,6.8],[1,width-1,8.1,10.8],[1,width-1,12.1,14.8]]);
      b.box(lo,hi,-80,-56,-.3,0,CM.concrete);
      for(const y of [4,8,12,16])b.box(lo,hi,-80,-56,y-.24,y,CM.concrete);
    }
    for(const [u,reverse] of [[-52,1],[68,-1]]) {
      b.facade([u,reverse===1?-56:-80],[u,reverse===1?-80:-56],0,16,[[1,14,.1,15.6],[16,23,.1,2.8]]);
    }
    // Lightwell walls and stacked bridges around the central entrance.
    b.facade([4,-80],[4,-56],0,16,[[1,21,.2,3.7],[1,21,4.2,7.7],[1,21,8.2,11.7],[1,21,12.2,15.7]]);
    b.facade([12,-56],[12,-80],0,16,[[1,21,.2,3.7],[1,21,4.2,7.7],[1,21,8.2,11.7],[1,21,12.2,15.7]]);
    for(const y of [4,8,12]) {
      b.box(4,12,-60,-56,y-.35,y,CM.concrete);
      b.facade([12,-56],[4,-56],y,y+3.2,[[.1,7.9,y+.15,y+3]]);
      b.rail([4,y,-60],[12,y,-60],false);
    }
    b.hip(-53.5,4,-81.5,-54.5,16,20,8);
    b.hip(12,69.5,-81.5,-54.5,16,20,8);
    b.box(4,12,-60,-54.5,15.7,16,CM.roof);
  });
  b.part('east-envelope',()=>{
    // Structural north edge is 17.5 m beyond the North building's south face.
    const u0=35,u1=68,v0=-38.5,v1=6.5;
    for(const [a,c,len] of [ [[u0,v0],[u1,v0],33],[[u1,v0],[u1,v1],45],[[u1,v1],[u0,v1],33],[[u0,v1],[u0,v0],45] ] as [[number,number],[number,number],number][]) {
      const wins:[number,number,number,number][]=[];
      wins.push([1,len-1,.15,3.65]);
      for(const y of [4,8,12])wins.push([1,len-1,y+.75,y+2.5]);
      if(len===45)wins.push([4,12,4,11.7]);
      b.facade(a,c,0,16,wins);
    }
    for(const y of [0,4,8,12,16])b.box(u0,u1,v0,v1,y-.25,y,CM.concrete);
    b.hip(u0-1.5,u1+1.5,v0-1.5,v1+1.5,16,19.6,7);
    // Courtyard balconies, with a continuous thin fascia and individual guardrail posts.
    for(const y of [4,8,12]){
      b.box(32.8,35,-37,5,y-.22,y,CM.concrete);
      b.rail([32.8,y,-37],[32.8,y,5]);
    }
  });
}

/** Third-floor links: straight North–East and diagonal North–West. Their open undercrofts
 * are essential: PLATEAU LOD1 incorrectly extrudes these bridge footprints from the ground.
 * Widths/diagonal endpoints use the surveyed roof outlines; elevations use the 3F plan.
 */
export function addBridges(b:CampusBuilder) {
  const bridge=(name:string,a:P,c:P,width:number)=>b.part(name,()=>{
    const len=Math.hypot(c[0]-a[0],c[2]-a[2]),sx=-(c[2]-a[2])/len,sz=(c[0]-a[0])/len;
    const p=(t:number,side:number,h:number):P=>[a[0]+(c[0]-a[0])*t+sx*side,a[1]+(c[1]-a[1])*t+h,a[2]+(c[2]-a[2])*t+sz*side];
    b.beam(p(0,0,-.2),p(1,0,-.2),width,.4,CM.concrete);
    b.beam(p(0,0,3.45),p(1,0,3.45),width+.45,.25,CM.metal);
    for(const side of [-width/2,width/2]) {
      const n=Math.ceil(len/1.5);
      for(let i=0;i<n;i++){
        const l=i/n,r=(i+1)/n;
        const q=[p(l,side,.25),p(r,side,.25),p(r,side,3.25),p(l,side,3.25)];
        if(side<0)q.reverse();
        b.quad(q[0],q[1],q[2],q[3],CM.glass);
      }
      for(let i=0;i<=n;i++)b.beam(p(i/n,side,0),p(i/n,side,3.4),.09,.09,CM.white);
      for(const h of [.15,1.1,3.3])b.beam(p(0,side,h),p(1,side,h),.08,.09,CM.white);
      b.beam(p(0,side,-.42),p(1,side,-.42),.17,.32,CM.steel);
    }
  });
  bridge('north-east-link',[42,8,-56],[42,8,-38.5],4.4);
  bridge('north-west-link',[-21,8,-56],[-35,9,-40],3.0);
}

export function campusArchitecture(ground:number) {
  const b=new CampusBuilder(ground);addNorthEast(b);addBridges(b);return b.geometry();
}
