import * as THREE from 'three';
import { CAMPUS_CENTER } from './geo.ts';

/** Metres in the campus drawing frame: u east, v south, y above the common ground floor.
 * The PLATEAU roof edges give the 1.58 degree rotation; its basement-inclusive LOD1 heights
 * are deliberately not used as the number of storeys. See docs/campus-architecture-2026-10-17.md.
 */
export const CAMPUS_YAW = -1.58 * Math.PI / 180;
export const CM = { wall:0, glass:1, concrete:2, roof:3, plant:4, metal:5, paving:6,
  brick:7, railing:8, timber:9, leaves:10, steel:11, white:12, lamp:13, lawn:14 } as const;
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
  readonly center:{x:number;z:number};
  readonly yaw:number;
  constructor(ground:number,center=CAMPUS_CENTER,yaw=CAMPUS_YAW) { this.ground=ground;this.center=center;this.yaw=yaw; }

  point([u,y,v]:P):P {
    const c=Math.cos(this.yaw),s=Math.sin(this.yaw);
    return [this.center.x+c*u-s*v,this.ground+y,this.center.z+s*u+c*v];
  }
  part(name:string,build:()=>void) {
    const start=this.materials.length;build();
    this.parts.push({name,start,count:this.materials.length-start});
  }
  quad(a:P,b:P,c:P,d:P,m:Material) {
    const edge=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const n=edge.cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a))).normalize();
    if(n.lengthSq()<.5)throw new Error('Degenerate campus surface');
    const ca=Math.cos(this.yaw),sa=Math.sin(this.yaw);
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
    if(Math.min(u1-u0,v1-v0,y1-y0)<1e-6)return;
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
  stairs(a:P,c:P,width:number,steps:number,m:Material=CM.concrete) {
    const len=Math.hypot(c[0]-a[0],c[2]-a[2]),sx=-(c[2]-a[2])/len,sz=(c[0]-a[0])/len;
    const at=(t:number,side:number,y:number):P=>[a[0]+(c[0]-a[0])*t+sx*side,y,a[2]+(c[2]-a[2])*t+sz*side];
    for(let i=0;i<steps;i++) {
      const y=a[1]+(c[1]-a[1])*(i+1)/steps,lower=y-(c[1]-a[1])/steps;
      const l=i/steps,r=(i+1)/steps;
      const p=at(l,-width/2,y),q=at(r,-width/2,y),s=at(r,width/2,y),t=at(l,width/2,y);
      bQuad(this,p,q,s,t,m);
      this.quad(t,p,at(l,-width/2,lower),at(l,width/2,lower),m);
      this.quad(p,q,at(r,-width/2,lower),at(l,-width/2,lower),m);
      this.quad(s,t,at(l,width/2,lower),at(r,width/2,lower),m);
    }
    for(const side of [-width/2+.12,width/2-.12]) {
      this.beam(at(0,side,a[1]-.2),at(1,side,c[1]-.2),.16,.32,CM.steel);
      this.rail(at(0,side,a[1]),at(1,side,c[1]));
    }
  }
  /** Four pitched sheets around a recessed, flat service court; no random rooftop boxes. */
  hip(u0:number,u1:number,v0:number,v1:number,eave:number,ridge:number,inset:number) {
    const a:P=[u0,eave,v0],b:P=[u1,eave,v0],c:P=[u1,eave,v1],d:P=[u0,eave,v1];
    const ia:P=[u0+inset,ridge,v0+inset],ib:P=[u1-inset,ridge,v0+inset],ic:P=[u1-inset,ridge,v1-inset],id:P=[u0+inset,ridge,v1-inset];
    this.quad(a,ia,ib,b,CM.roof);this.quad(b,ib,ic,c,CM.roof);
    this.quad(c,ic,id,d,CM.roof);this.quad(d,id,ia,a,CM.roof);
    this.box(u0+inset,u1-inset,v0+inset,v1-inset,eave-.15,eave+.05,CM.roof);
    this.quad(ia,[ia[0],eave,ia[2]],[ib[0],eave,ib[2]],ib,CM.roof);
    this.quad(ib,[ib[0],eave,ib[2]],[ic[0],eave,ic[2]],ic,CM.roof);
    this.quad(ic,[ic[0],eave,ic[2]],[id[0],eave,id[2]],id,CM.roof);
    this.quad(id,[id[0],eave,id[2]],[ia[0],eave,ia[2]],ia,CM.roof);
    for(const [p,q] of [[a,b],[b,c],[c,d],[d,a]] as [P,P][])this.beam(p,q,.16,.18,CM.metal);
  }
  /** Facade with real openings, recessed glazing, deep reveals and individual metal frames. */
  facade(a:[number,number],b:[number,number],y0:number,y1:number,windows:readonly [number,number,number,number][],m:Material=CM.brick,doors:readonly [number,number,number,number][]=[] ) {
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
    const p=(u:number,y:number,inset=0):P=>[a[0]+dx*u-dz*inset,y,a[1]+dz*u+dx*inset];
    // Subtract doors from both the masonry and the glazing, including window mullions.
    let openings=windows.map(w=>[...w] as [number,number,number,number]);
    for(const [l,r,lo,hi] of doors)openings=openings.flatMap(w=>{
      const a=Math.max(w[0],l),c=Math.min(w[1],r),bottom=Math.max(w[2],lo),top=Math.min(w[3],hi);
      if(a>=c||bottom>=top)return [w];
      return [[w[0],a,w[2],w[3]],[c,w[1],w[2],w[3]],[a,c,w[2],bottom],[a,c,top,w[3]]]
        .filter(o=>o[1]-o[0]>.001&&o[3]-o[2]>.001) as [number,number,number,number][];
    });
    const us=[0,len,...[...openings,...doors].flatMap(o=>[o[0],o[1]])].sort((a,b)=>a-b);
    const ys=[y0,y1,...[...openings,...doors].flatMap(o=>[o[2],o[3]])].sort((a,b)=>a-b);
    for(let i=0;i<us.length-1;i++)for(let j=0;j<ys.length-1;j++){
      const u=(us[i]+us[i+1])/2,y=(ys[j]+ys[j+1])/2;
      if(us[i+1]-us[i]<.001||ys[j+1]-ys[j]<.001)continue;
      if(doors.some(o=>u>o[0]&&u<o[1]&&y>o[2]&&y<o[3]))continue;
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

// Keep upward stair treads independent of the flight's compass direction.
function bQuad(b:CampusBuilder,a:P,c:P,d:P,e:P,m:Material) {
  const cross=(c[2]-a[2])*(d[0]-a[0])-(c[0]-a[0])*(d[2]-a[2]);
  if(cross>0)b.quad(a,c,d,e,m);else b.quad(e,d,c,a,m);
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
      const door: [number,number,number,number]=lo<0?[23.5,26.5,8,11.2]:[24.3,27.7,8,11.2];
      b.facade([hi,-56],[lo,-56],0,16,[[0,width,0,2.8],[1,width-1,4.1,6.8],[1,width-1,8.1,10.8],[1,width-1,12.1,14.8]],CM.brick,[door]);
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
      b.facade(a,c,0,16,wins,CM.brick,a[1]===v0&&c[1]===v0?[[5.3,8.7,8,11.2]]:[]);
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

/** West wing (2019), from the AIJ terrace survey and the contractor's courtyard photograph.
 * Deep third-floor recesses, a projecting fourth floor and external flights are geometry,
 * rather than a window texture on an undifferentiated extrusion.
 */
export function addWest(b:CampusBuilder) {
  b.part('west-terraced-envelope',()=>{
    for(const y of [0,4.5,9,13.5,18])b.box(-59,-24,-40,9,y-.25,y,CM.concrete);
    for(const [a,c,len] of [ [[-59,9],[-59,-40],49],[[-59,-40],[-24,-40],35],[[-24,9],[-59,9],35] ] as [[number,number],[number,number],number][]) {
      const wins:[number,number,number,number][]=[[1,len-1,.3,3.7]];
      for(const y of [4.5,9,13.5])wins.push([1,len-1,y+.8,y+2.9]);
      b.facade(a,c,0,18,wins,CM.brick,a[1]===-40&&c[1]===-40?[[22.5,25.5,9,12.2]]:[]);
    }
    // East-facing facade is set back by a different amount on each floor and terrace bay.
    for(const [y0,y1,u,v0,v1] of [[0,4.5,-24,-40,9],[4.5,9,-21,-40,9],
      [9,13.5,-23,-40,-29],[9,13.5,-13,-29,-15],[9,13.5,-23,-15,9],[13.5,18,-13,-40,9]]) {
      const len=v1-v0;
      b.facade([u,v0],[u,v1],y0,y1,[[.5,len-.5,y0+.25,y1-.35]]);
      b.box(-24,u,v0,v1,y0-.24,y0,CM.concrete);
      b.box(-24,u,v0,v1,y1-.24,y1,CM.concrete);
    }
    for(const [v,reverse] of [[-29,1],[-15,-1]])
      b.facade([reverse>0?-23:-13,v],[reverse>0?-13:-23,v],9,13.5,[[.5,9.5,9.4,13.1]]);
    for(const [y,v0,v1,u] of [[4.5,-40,-10,-19.5],[4.5,-10,9,-16],[9,-40,-29,-12],[9,-15,9,-12],[13.5,-40,9,-10.5]]) {
      b.box(-24,u,v0,v1,y-.25,y,CM.concrete);
      b.rail([u,y,v0],[u,y,v1]);
      b.rail([-24,y,v0],[u,y,v0]);b.rail([u,y,v1],[-24,y,v1]);
    }
    // Glazed lecture-room bay and the slim columns below the long upper cantilever.
    for(let v=-38;v<9;v+=8)b.box(-13.45,-13.05,v-.22,v+.22,0,13.5,CM.concrete);
    b.hip(-60.5,-11.5,-41.5,10.5,18,21.7,7);
  });
  b.part('west-courtyard-stairs-and-deck',()=>{
    // A continuous series of three external flights along the courtyard elevation.
    const x=-9.6;
    b.box(-16,x+1.05,-38,-36,1.25,1.5,CM.timber);
    b.rail([-16,1.5,-38],[x+1.05,1.5,-38]);
    b.rail([x+1.05,1.5,-38],[x+1.05,1.5,-36]);
    for(let f=0;f<3;f++) {
      const v=-36+f*14.3,y=[1.5,4.5,9][f],top=[4.5,9,13.5][f];
      b.stairs([x,y,v],[x,top,v+11],2.1,Math.round((top-y)/.167));
      b.box(x-1.05,x+1.05,v+11,v+14.3,top-.22,top,CM.concrete);
      b.rail([x-1.05,top,v+11],[x-1.05,top,v+14.3]);
      b.rail([x+1.05,top,v+11],[x+1.05,top,v+14.3]);
      b.box(-21,x+1.05,v+12,v+14.3,top-.22,top,CM.concrete);
    }
    // Timber amphitheatre beside the lawn, rising westward, with separate wide seat tiers.
    b.box(-24,-16,-39,8,-.1,1.5,CM.timber);
    for(let i=0;i<6;i++)b.box(-16+i*.72,-16+(i+1)*.72,-36,7,-.1,1.5-i*.25,CM.timber);
    for(const v of [-31,-17,0]){
      b.box(-23,-19,v,v+3,1.5,1.95,CM.wall);
      b.box(-22.8,-19.2,v+.2,v+2.8,1.95,2.25,CM.leaves);
    }
    // A restrained set of fixed terrace tables, visible in the construction photograph.
    for(const v of [-29,-21,-13,-5])for(const u of [-22,-18]){
      b.box(u-.65,u+.65,v-.65,v+.65,2.2,2.3,CM.metal);
      b.box(u-.08,u+.08,v-.08,v+.08,1.5,2.2,CM.steel);
    }
  });
}

/** South academic wings step back from the plaza. Only the narrow south-west residence
 * reaches eight storeys (KUAS Dormitory A: seven residential floors, all rooms south-facing).
 * The stair court is recessed into one connected building, with a four-storey central room.
 */
export function addSouth(b:CampusBuilder) {
  b.part('south-stepped-academic-wings',()=>{
    for(const [u0,u1,back] of [[-42,-9,61],[7,70,73]]) {
      for(let f=0;f<5;f++) {
        const y=f*4.4,front=f===0?22:f===1?28:30;
        const len=u1-u0;
        const wins:[number,number,number,number][]=[[1,len-1,y+(f<2?.3:1.1),y+(f<2?3.8:2.8)]];
        b.facade([u0,front],[u1,front],y,y+4.4,wins);
        b.facade([u1,back],[u0,back],y,y+4.4,[[1,len-1,y+1.1,y+2.8]]);
        b.facade([u1,front],[u1,back],y,y+4.4,[[1,back-front-1,y+.7,y+3.4]]);
        b.facade([u0,back],[u0,front],y,y+4.4,[[1,back-front-1,y+.7,y+3.4]]);
        b.box(u0,u1,front,back,y-.25,y,CM.concrete);
        b.box(u0,u1,front,back,y+4.15,y+4.4,CM.concrete);
      }
      for(const [y,front] of [[4.4,22],[8.8,25]]) {
        b.box(u0,u1,front,30,y-.25,y,CM.concrete);
        b.rail([u0,y,front],[u1,y,front]);
        b.rail([u0,y,30],[u0,y,front]);b.rail([u1,y,front],[u1,y,30]);
      }
      b.hip(u0-1,u1+1,29,back+1,22,24.8,6);
    }
    // Glazed winter gardens occupy the outer ends of the third-floor terrace.
    for(const [u0,u1] of [[-42,-30],[54,70]]) {
      b.facade([u0,22],[u1,22],8.8,13.2,[[.2,u1-u0-.2,9,13]]);
      b.facade([u1,22],[u1,30],8.8,13.2,[[.2,7.8,9,13]]);
      b.facade([u0,30],[u0,22],8.8,13.2,[[.2,7.8,9,13]]);
      b.box(u0,u1,22,30,13.05,13.3,CM.metal);
    }
    // The lower floors continue below the staircase. The south elevation is one
    // connected mass, rather than two towers with an empty slot between them.
    b.part('south-connected-central-building',()=>{
      b.box(-9,7,33.7,35.9,0,8.48,CM.brick);
      b.box(-9,7,45.4,73,0,13.2,CM.brick);
      for(let f=0;f<3;f++) {
        const y=f*4.4;
        b.facade([7,73.015],[-9,73.015],y,y+4.4,[[.8,15.2,y+.8,y+3.2]]);
      }
      // Four-floor room directly in front of the final stair landing; its roof
      // is the fifth-floor artificial-turf court, below the academic wing roofs.
      b.facade([-9,47.6],[7,47.6],13.2,17.6,[[.4,15.6,13.4,17.3]],CM.brick,[[6,10,13.2,16]]);
      b.facade([7,73],[-9,73],13.2,17.6,[[.8,15.2,14,16.4]]);
      for(const u of [-9,7])b.box(u-.08,u+.08,47.6,73,13.2,17.6,CM.brick);
      b.box(-9,7,47.6,73,17.4,17.6,CM.concrete);
      b.box(-8.8,6.8,47.8,72.8,17.6,17.65,CM.lawn);
      for(const u of [-8.85,6.85])b.rail([u,17.65,47.8],[u,17.65,72.8]);
      for(const v of [47.8,72.8])b.rail([-8.85,17.65,v],[6.85,17.65,v]);
    });
    // The east wing's clock is individual ticks and hands on the brick, not a signboard.
    const u=10.6,v=29.94,y=19.7,r=1.0;
    for(let i=0;i<12;i++) {
      const a=i*Math.PI/6;
      b.beam([u+Math.sin(a)*r,y+Math.cos(a)*r,v],[u+Math.sin(a)*r*.78,y+Math.cos(a)*r*.78,v],.07,.07,CM.steel);
    }
    b.beam([u,y,v],[u-.6,y+.3,v],.07,.07,CM.steel);
    b.beam([u,y,v],[u+.1,y+.75,v],.055,.055,CM.steel);
  });
  b.part('south-west-eight-storey-residence',()=>{
    const u0=-42,u1=-9,v0=61,v1=75;
    for(let f=0;f<8;f++) {
      const y=f*3.2;
      b.box(u0,u1,v0,v1,y-.2,y,CM.concrete);
      // Ten south-facing rooms, with deep balcony recesses and their privacy partitions.
      for(let room=0;room<10;room++){
        const a=u1-room*3.3,c=a-3.3;
        b.facade([a,v1-1.3],[c,v1-1.3],y,y+3.2,[[.2,3.1,y+.25,y+2.8]]);
        b.box(c,c+.12,v1-1.3,v1+.5,y,y+3.2,CM.brick);
        b.box(c,a,v1-1.3,v1+.5,y-.2,y,CM.concrete);
        b.rail([c,y,v1+.5],[a,y,v1+.5],false);
      }
      b.facade([u0,v0],[u1,v0],y,y+3.2,[[1,32,y+1.2,y+2.2]]);
      for(const u of [u0,u1])b.box(u-.1,u+.1,v0,v1,y,y+3.2,CM.brick);
    }
    b.hip(-43,-8,60,77,25.6,28.5,5);
    // Exposed glazed stair tower on the west end, as in the official dormitory photograph.
    b.facade([-42.2,74],[-42.2,62],0,25.6,[[.3,11.7,.3,25.3]]);
  });
}

/** Preserve the plaza-to-2F flight. User-confirmed 2F-to-3F stairs turn north
 * on both sides before returning south through the centre; the broad final
 * flight reaches the 4F room, not the fifth-floor roof. Dimensions are estimates.
 */
export function addSouthStairs(b:CampusBuilder) {
  b.part('south-grand-staircase',()=>{
    const broad=(v:number,y:number,rise:number,len:number,steps:number,solid:boolean)=>{
      b.stairs([-1,y,v],[-1,y+rise,v+len],6.8,steps);
      b.rail([-1,y,v],[-1,y+rise,v+len],false);
      if(solid)for(let i=0;i<steps;i++)
        b.box(y===0?-4.4:-9,y===0?2.4:7,v+i*len/steps,v+(i+1)*len/steps,-.1,y+(i+1)*rise/steps-.04,CM.brick);
    };
    // This first flight and landing retain the previously accepted coordinates.
    broad(22,0,4.4,9.5,27,true);
    b.box(-9,7,31.5,33.7,4.08,4.4,CM.concrete);
    // Two narrow stairs leave the second-floor landing toward the north.
    for(const u of [-6.5,4.5])b.stairs([u,4.4,33.7],[u,6.6,28.95],2.2,14);
    b.box(-7.6,5.6,26.75,28.95,6.28,6.6,CM.concrete);
    b.rail([-7.6,6.6,26.75],[5.6,6.6,26.75]);
    broad(28.95,6.6,2.2,4.75,14,false);
    b.box(-9,7,33.7,35.9,8.48,8.8,CM.concrete);
    broad(35.9,8.8,4.4,9.5,27,true);
    b.box(-9,7,45.4,47.6,12.88,13.2,CM.concrete);
    // Rails stop at the central walking opening into each floor.
    for(const [v,y] of [[33.7,4.4],[35.9,8.8],[47.6,13.2]]) {
      b.rail([-9,y,v],[-4.4,y,v]);b.rail([2.4,y,v],[7,y,v]);
    }
    b.box(-4.4,2.4,16,22,-.12,0,CM.paving);
  });
  b.part('south-plaza-amphitheatre-and-planters',()=>{
    for(const [u0,u1] of [[-41,-9],[7,69]]) {
      for(let i=0;i<6;i++)b.box(u0,u1,15+i,16+i,-.1,(i+1)*.25,CM.timber);
      b.box(u0,u1,21,22,-.1,1.5,CM.timber);
      for(let u=u0+4;u<u1-4;u+=15) {
        b.box(u,u+4,18.5,21,1,1.7,CM.wall);
        b.box(u+.2,u+3.8,18.7,20.8,1.7,2,CM.leaves);
      }
      for(let u=u0+3;u<u1-3;u+=15) {
        b.box(u,u+2.5,22.8,24.3,4.4,4.9,CM.wall);
        b.box(u+.1,u+2.4,22.9,24.2,4.9,5.2,CM.leaves);
      }
    }
  });
}

/** Centre plaza: lawn cut by the axial and diagonal paths, rather than trees planted through
 * the building facades. Positions follow the current official campus map and courtyard photo.
 */
export const CAMPUS_TREES:readonly [number,number][]=[
  [-48,-86],[-32,-86],[-16,-86],[24,-86],[42,-86],[61,-86],
  [76,-63],[76,-30],[76,-2],[76,28],[76,54],
  [-65,-32],[-65,0],[-65,30],[-65,58],[-51,80],[-5,80],[28,80],[60,80],
  [-7,-39],[23,-34],[-6,-15],[23,-3],[16,10],
];
export function addCourtyard(b:CampusBuilder) {
  b.part('centre-plaza-lawns-and-paths',()=>{
    b.box(-12,33,-54,14,-.12,.02,CM.lawn);
    // A four-metre axial path links the North entrance to the South staircase.
    b.box(3,7,-56,16,.025,.08,CM.paving);
    b.box(-2,3,10,16,.025,.08,CM.paving);
    // Two diagonal pedestrian paths cross the lawns and meet the side entrances.
    for(const [a,c] of [ [[-12,.08,-36],[33,.08,-12]], [[-12,.08,7],[33,.08,-38]] ] as [P,P][])
      b.beam(a,c,2.2,.08,CM.paving);
    for(const [u,v] of CAMPUS_TREES.slice(-5)) {
      b.box(u-.75,u+.75,v-.75,v+.75,.03,.09,CM.paving);
      b.box(u-.6,u+.6,v-.6,v+.6,.09,.11,CM.leaves);
    }
    // Campus benches and low, warm bollards stay beside the paths, clear of the stairs.
    for(const [u,v] of [[27,-29],[27,-20],[-8,-22],[-8,1]]) {
      b.box(u-.35,u+.35,v-1.2,v+1.2,.4,.5,CM.timber);
      for(const z of [v-.8,v+.8])b.box(u-.15,u+.15,z-.08,z+.08,0,.4,CM.steel);
    }
    for(const [u,v] of [[1,-44],[9,-22],[1,0],[9,12]]){
      b.box(u-.12,u+.12,v-.12,v+.12,0,.75,CM.metal);
      b.box(u-.13,u+.13,v-.13,v+.13,.6,.7,CM.lamp);
    }
  });
}

/** The one-storey Future Center by the west gate, identified by the official map's d.
 * Its irregular roof outline is PLATEAU 26100-bldg-194971; the common floor datum
 * avoids interpreting the basement-inclusive 8.7 m LOD1 height as multiple storeys.
 */
export function addFutureCenter(b:CampusBuilder) {
  b.part('future-center-west-gate',()=>{
    const ring:[number,number][]=[[-86.31,-68.59],[-83.86,-71.87],[-86.41,-73.78],[-85.96,-74.39],
      [-99.94,-84.85],[-106.42,-76.18],[-88.68,-62.91],[-85.11,-67.68]];
    for(let i=0;i<ring.length;i++) {
      const a=ring[i],c=ring[(i+1)%ring.length],len=Math.hypot(c[0]-a[0],c[1]-a[1]);
      b.facade(a,c,0,5.35,len>5?[[.8,len-.8,.8,4.2]]:[],CM.wall);
      b.beam([a[0],5.35,a[1]],[c[0],5.35,c[1]],.25,.2,CM.metal);
    }
    const outline=ring.map(([u,v])=>new THREE.Vector2(u,v));
    for(const t of THREE.ShapeUtils.triangulateShape(outline,[])) {
      const [a,c,d]=t.map(i=>[ring[i][0],5.45,ring[i][1]] as P);
      const up=(c[2]-a[2])*(d[0]-a[0])-(c[0]-a[0])*(d[2]-a[2]);
      if(up>0)b.quad(a,c,d,a,CM.roof);else b.quad(a,d,c,a,CM.roof);
    }
  });
}

export function campusArchitecture(ground:number) {
  const b=new CampusBuilder(ground);addNorthEast(b);addBridges(b);addWest(b);addSouth(b);addSouthStairs(b);addCourtyard(b);addFutureCenter(b);return b.geometry();
}
