import type {Box,Point} from './coordinates';
import {Mesh,strip,type RGB,type XYZ} from './mesh';

const ASPHALT:RGB=[88,90,88];
const WALK:RGB=[144,140,131];
const CONCRETE:RGB=[136,133,124];
const PARAPET:RGB=[150,147,138];
const PIER:RGB=[124,121,112];
const BALLAST:RGB=[98,92,83];
const SLEEPER_BED:RGB=[66,57,49];
const RAIL_STEEL:RGB=[172,174,169];
const TRAM_BED:RGB=[86,86,84];

export function clipSegment(a:Point,b:Point,box:Box):[Point,Point]|undefined{
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

/** Determine realistic bridge clearance above ground/water from GSI attributes.
 * Level-0 stream/river bridges clear the channel cleanly instead of jumping 6.8 m. */
export function bridgeClearance(lvorder:number,motorway:boolean,rdctg:string){
  const express=motorway||rdctg.includes('高速');
  if(lvorder>=2)return 10.4;
  if(lvorder>=1||express)return 6.2;
  return 1.35;
}

/** Draw an oriented concrete pier aligned perpendicular to the span tangent (ux, uy). */
function orientedPier(mesh:Mesh,cx:number,cy:number,ux:number,uy:number,topZ:number,bottomZ:number,spanWidth:number){
  const height=topZ-bottomZ;
  if(height<.35)return;
  const along=Math.min(1.5,Math.max(.85,spanWidth*.11));
  const across=Math.min(spanWidth*.72,Math.max(1.2,spanWidth-.8));
  const nx=-uy,ny=ux;
  const p=(a:number,b:number,z:number):XYZ=>[cx+ux*a+nx*b,cy+uy*a+ny*b,z];
  // Split wide bridges into twin columns; narrow spans get one central pier.
  const columns=spanWidth>=10?[-across*.33,across*.33]:[0];
  const colW=spanWidth>=10?Math.min(1.8,across*.24):across;
  const ha=along*.5,hc=colW*.5;
  for(const off of columns){
    const c0=off-hc,c1=off+hc;
    const b0=p(-ha,c0,bottomZ),b1=p(ha,c0,bottomZ),b2=p(ha,c1,bottomZ),b3=p(-ha,c1,bottomZ);
    const t0=p(-ha,c0,topZ),t1=p(ha,c0,topZ),t2=p(ha,c1,topZ),t3=p(-ha,c1,topZ);
    mesh.quad(b0,b1,t1,t0,PIER);
    mesh.quad(b1,b2,t2,t1,PIER);
    mesh.quad(b2,b3,t3,t2,PIER);
    mesh.quad(b3,b0,t0,t3,PIER);
  }
  if(spanWidth>=10){
    const capTop=topZ,capBot=Math.max(bottomZ,topZ-.85),hb=across*.5;
    const b0=p(-ha,-hb,capBot),b1=p(ha,-hb,capBot),b2=p(ha,hb,capBot),b3=p(-ha,hb,capBot);
    const t0=p(-ha,-hb,capTop),t1=p(ha,-hb,capTop),t2=p(ha,hb,capTop),t3=p(-ha,hb,capTop);
    mesh.quad(b0,b1,t1,t0,CONCRETE);
    mesh.quad(b1,b2,t2,t1,CONCRETE);
    mesh.quad(b2,b3,t3,t2,CONCRETE);
    mesh.quad(b3,b0,t0,t3,CONCRETE);
    mesh.quad(b0,b3,b2,b1,CONCRETE);
  }
}

function onTileEdge(p:Point,bounds:Box,eps=1.5e-5){
  return p[0]<=bounds[0]+eps||p[0]>=bounds[2]-eps||p[1]<=bounds[1]+eps||p[1]>=bounds[3]-eps;
}

export interface BridgeOptions {
  width:number;
  clearance:number;
  skip?:(p:Point)=>boolean;
  /** True when the start/end node connects to another bridge/viaduct span in the same tile (never plunge to ground!). */
  startConnected?:boolean;
  endConnected?:boolean;
  /** Optional target clearance at a connected joint so level changes (e.g. lvorder 1 -> 2) grade smoothly. */
  startClearance?:number;
  endClearance?:number;
  /** True if a point sits over water (prevent bridges ending over water from diving into the river). */
  isWater?:(p:Point)=>boolean;
}

export function drawBridgePolyline(
  mesh:Mesh,
  rawPoints:Point[],
  bounds:Box,
  ground:(p:Point)=>number,
  xyz:(p:Point,h:number)=>XYZ,
  options:BridgeOptions,
){
  if(rawPoints.length<2)return;
  const {width,clearance,skip,startConnected=false,endConnected=false,startClearance,endClearance,isWater}=options;
  const elevated=clearance>2.5;
  const segments:{a:Point;b:Point;len:number;start:number}[]=[];
  let total=0;
  for(let j=1;j<rawPoints.length;j++){
    const clipped=clipSegment(rawPoints[j-1],rawPoints[j],bounds);
    if(!clipped)continue;
    const [a,b]=clipped;
    if(skip?.([(a[0]+b[0])*.5,(a[1]+b[1])*.5]))continue;
    const pa=xyz(a,0),pb=xyz(b,0),len=Math.hypot(pb[0]-pa[0],pb[1]-pa[1]);
    if(len<.1)continue;
    segments.push({a,b,len,start:total});
    total+=len;
  }
  if(!segments.length)return;
  const first=segments[0].a,last=segments[segments.length-1].b;
  const edgeMargin=elevated?4.5e-5:2e-5;
  // Only ramp down to ground at truly free dry-land abutments — never at tile edges, connected viaduct joints, or over water!
  const startFree=!startConnected && !onTileEdge(first,bounds,edgeMargin) && !onTileEdge(rawPoints[0],bounds,edgeMargin) && !isWater?.(first);
  const endFree=!endConnected && !onTileEdge(last,bounds,edgeMargin) && !onTileEdge(rawPoints[rawPoints.length-1],bounds,edgeMargin) && !isWater?.(last);
  const startG=ground(first),endG=ground(last);
  const rampLen=Math.min(elevated?Math.max(20,clearance*4.2):10,total*.38);
  const blendLen=Math.min(24,total*.45);
  // Subdivide segments at ramp crests so even 2-point spans reach full elevated clearance across the middle.
  const splitMarks:number[]=[];
  if(rampLen>0){
    if(startFree)splitMarks.push(rampLen);
    if(endFree&&total-rampLen>rampLen+.5)splitMarks.push(total-rampLen);
  }
  if(blendLen>0){
    if(startConnected && startClearance!==undefined && Math.abs(startClearance-clearance)>.2)splitMarks.push(blendLen);
    if(endConnected && endClearance!==undefined && Math.abs(endClearance-clearance)>.2)splitMarks.push(total-blendLen);
  }
  splitMarks.sort((a,b)=>a-b);
  const subdivided:{a:Point;b:Point;len:number;start:number}[]=[];
  for(const seg of segments){
    const cuts=splitMarks.filter(m=>m>seg.start+.25&&m<seg.start+seg.len-.25);
    if(!cuts.length){subdivided.push(seg);continue;}
    let curA=seg.a,curStart=seg.start;
    for(const m of cuts){
      const t=(m-seg.start)/seg.len;
      const mid:Point=[seg.a[0]+(seg.b[0]-seg.a[0])*t,seg.a[1]+(seg.b[1]-seg.a[1])*t];
      subdivided.push({a:curA,b:mid,len:m-curStart,start:curStart});
      curA=mid;curStart=m;
    }
    subdivided.push({a:curA,b:seg.b,len:seg.start+seg.len-curStart,start:curStart});
  }
  const smooth=(t:number)=>t*t*(3-2*t);
  const deckZ=(p:Point,dist:number)=>{
    const g=ground(p);
    const chord=total>0&&total<650?startG+(endG-startG)*(dist/total):-Infinity;
    let lift=clearance;
    if(startConnected && startClearance!==undefined && blendLen>0 && dist<blendLen){
      lift=startClearance+(clearance-startClearance)*smooth(dist/blendLen);
    }
    if(endConnected && endClearance!==undefined && blendLen>0 && total-dist<blendLen){
      lift=endClearance+(lift-endClearance)*smooth((total-dist)/blendLen);
    }
    if(rampLen>0){
      const touch=.28;
      if(startFree&&dist<rampLen)lift=touch+(lift-touch)*smooth(dist/rampLen);
      if(endFree&&total-dist<rampLen)lift=Math.min(lift,touch+(lift-touch)*smooth((total-dist)/rampLen));
    }
    return Math.max(g,chord)+lift;
  };
  const half=width*.5,parapetW=width>=8?.38:.24,parapetH=elevated?.78:.62,deckDepth=elevated?.85:.48;
  const walkW=width>=8?Math.min(1.6,width*.14):0;
  const pierStep=elevated?30:24;
  let nextPier=pierStep*.5;
  for(const seg of subdivided){
    const za=deckZ(seg.a,seg.start),zb=deckZ(seg.b,seg.start+seg.len);
    const a=xyz(seg.a,za),b=xyz(seg.b,zb);
    const ux=(b[0]-a[0])/seg.len,uy=(b[1]-a[1])/seg.len;
    // Main carriageway slab & concrete underside fascia
    strip(mesh,a,b,width,ASPHALT,deckDepth);
    // Sidewalks on arterial / medium-wide bridges
    if(walkW>0){
      const walkA:XYZ=[a[0],a[1],a[2]+.1],walkB:XYZ=[b[0],b[1],b[2]+.1];
      for(const side of [-1,1])strip(mesh,walkA,walkB,walkW,WALK,.1,side*(half-parapetW-walkW*.5));
    }
    // Raised concrete parapets / railings on both edges
    const topA:XYZ=[a[0],a[1],a[2]+parapetH],topB:XYZ=[b[0],b[1],b[2]+parapetH];
    for(const side of [-1,1]){
      strip(mesh,topA,topB,parapetW,PARAPET,parapetH,side*(half-parapetW*.5));
    }
    // Oriented piers underneath elevated spans or longer river crossings
    if(elevated||total>=18){
      while(nextPier<seg.start+seg.len){
        const u=(nextPier-seg.start)/seg.len;
        const lon=seg.a[0]+(seg.b[0]-seg.a[0])*u,lat=seg.a[1]+(seg.b[1]-seg.a[1])*u;
        const px=a[0]+(b[0]-a[0])*u,py=a[1]+(b[1]-a[1])*u,pz=a[2]+(b[2]-a[2])*u-deckDepth;
        const gBase=ground([lon,lat])-.5;
        if(pz-gBase>.45)orientedPier(mesh,px,py,ux,uy,pz,gBase,width);
        nextPier+=pierStep;
      }
    }
  }
}

export interface RailOptions {
  raised:boolean;
  doubleTrack:boolean;
  shinkansen:boolean;
  monorail:boolean;
  tram:boolean;
  lvorder:number;
  startConnected?:boolean;
  endConnected?:boolean;
}

export function drawRailPolyline(
  mesh:Mesh,
  rawPoints:Point[],
  bounds:Box,
  ground:(p:Point)=>number,
  xyz:(p:Point,h:number)=>XYZ,
  options:RailOptions,
){
  if(rawPoints.length<2)return;
  const {raised,doubleTrack,shinkansen,monorail,tram,lvorder,startConnected=false,endConnected=false}=options;
  const lift=monorail?7.2:raised?6.0+Math.max(0,lvorder-1)*3.6:tram?.38:.48;
  const bedWidth=monorail?2.4:doubleTrack?(raised?8.2:5.8):shinkansen?(raised?4.8:3.4):tram?2.2:(raised?3.8:2.85);
  const deckDepth=monorail?1.15:raised?.92:tram?.1:.26;
  const gauge=shinkansen?1.435:1.067;
  const railHalf=gauge*.5;
  const trackOffsets=doubleTrack?[-1.55,1.55]:[0];
  const segments:{p0:Point;p1:Point;len:number;start:number}[]=[];
  let total=0;
  for(let j=1;j<rawPoints.length;j++){
    const clipped=clipSegment(rawPoints[j-1],rawPoints[j],bounds);
    if(!clipped)continue;
    const [p0,p1]=clipped;
    const pa=xyz(p0,0),pb=xyz(p1,0),len=Math.hypot(pb[0]-pa[0],pb[1]-pa[1]);
    if(len<.1)continue;
    segments.push({p0,p1,len,start:total});
    total+=len;
  }
  if(!segments.length)return;
  const railEdge=raised?4.5e-5:1.5e-5;
  const startFree=!startConnected && !onTileEdge(segments[0].p0,bounds,railEdge) && !onTileEdge(rawPoints[0],bounds,railEdge);
  const endFree=!endConnected && !onTileEdge(segments[segments.length-1].p1,bounds,railEdge) && !onTileEdge(rawPoints[rawPoints.length-1],bounds,railEdge);
  const rampLen=(raised&&!monorail)?Math.min(26,total*.35):0;
  const splitMarks:number[]=[];
  if(rampLen>0){
    if(startFree)splitMarks.push(rampLen);
    if(endFree&&total-rampLen>rampLen+.5)splitMarks.push(total-rampLen);
  }
  const subdivided:{p0:Point;p1:Point;len:number;start:number}[]=[];
  for(const seg of segments){
    const cuts=splitMarks.filter(m=>m>seg.start+.25&&m<seg.start+seg.len-.25);
    if(!cuts.length){subdivided.push(seg);continue;}
    let curA=seg.p0,curStart=seg.start;
    for(const m of cuts){
      const t=(m-seg.start)/seg.len;
      const mid:Point=[seg.p0[0]+(seg.p1[0]-seg.p0[0])*t,seg.p0[1]+(seg.p1[1]-seg.p0[1])*t];
      subdivided.push({p0:curA,p1:mid,len:m-curStart,start:curStart});
      curA=mid;curStart=m;
    }
    subdivided.push({p0:curA,p1:seg.p1,len:seg.start+seg.len-curStart,start:curStart});
  }
  const smooth=(t:number)=>t*t*(3-2*t);
  const railLift=(dist:number)=>{
    if(rampLen<=0)return lift;
    const surface=.48;
    let h=lift;
    if(startFree&&dist<rampLen)h=surface+(lift-surface)*smooth(dist/rampLen);
    if(endFree&&total-dist<rampLen)h=Math.min(h,surface+(lift-surface)*smooth((total-dist)/rampLen));
    return h;
  };
  let distance=0;
  for(const seg of subdivided){
    const {p0,p1,len,start}=seg;
    const g0=ground(p0),g1=ground(p1);
    const a=xyz(p0,g0+railLift(start)),b=xyz(p1,g1+railLift(start+len));
    const ux=(b[0]-a[0])/len,uy=(b[1]-a[1])/len;
    if(monorail){
      strip(mesh,a,b,bedWidth,CONCRETE,deckDepth);
      for(const side of [-1,1]){
        strip(mesh,[a[0],a[1],a[2]+.45],[b[0],b[1],b[2]+.45],.24,PARAPET,.45,side*(bedWidth*.5-.12));
      }
    }else if(raised){
      // Concrete viaduct deck, parapet/sound walls, ballast & steel rails
      strip(mesh,a,b,bedWidth,CONCRETE,deckDepth);
      const wallH=shinkansen?1.25:.72,wallW=.32;
      for(const side of [-1,1]){
        strip(mesh,[a[0],a[1],a[2]+wallH],[b[0],b[1],b[2]+wallH],wallW,PARAPET,wallH,side*(bedWidth*.5-wallW*.5));
      }
      const bedA:XYZ=[a[0],a[1],a[2]+.06],bedB:XYZ=[b[0],b[1],b[2]+.06];
      strip(mesh,bedA,bedB,Math.max(1.8,bedWidth-wallW*2-.2),BALLAST,0);
      const topA:XYZ=[a[0],a[1],a[2]+.14],topB:XYZ=[b[0],b[1],b[2]+.14];
      for(const center of trackOffsets){
        strip(mesh,[a[0],a[1],a[2]+.09],[b[0],b[1],b[2]+.09],gauge+.55,SLEEPER_BED,0,center);
        for(const side of [-railHalf,railHalf])strip(mesh,topA,topB,.13,RAIL_STEEL,0,center+side);
      }
    }else{
      // Surface track: ballast shoulder, dark sleeper band, twin bright steel rails
      strip(mesh,a,b,bedWidth,tram?TRAM_BED:BALLAST,deckDepth);
      const sleeperA:XYZ=[a[0],a[1],a[2]+.04],sleeperB:XYZ=[b[0],b[1],b[2]+.04];
      const railA:XYZ=[a[0],a[1],a[2]+.1],railB:XYZ=[b[0],b[1],b[2]+.1];
      for(const center of trackOffsets){
        if(!tram)strip(mesh,sleeperA,sleeperB,gauge+.55,SLEEPER_BED,0,center);
        for(const side of [-railHalf,railHalf])strip(mesh,railA,railB,.13,RAIL_STEEL,0,center+side);
      }
    }
    if(raised||monorail){
      const pierStep=monorail?26:28;
      for(let t=pierStep-distance;t<len;t+=pierStep){
        const u=t/len;
        const lon=p0[0]+(p1[0]-p0[0])*u,lat=p0[1]+(p1[1]-p0[1])*u;
        const px=a[0]+(b[0]-a[0])*u,py=a[1]+(b[1]-a[1])*u,pz=a[2]+(b[2]-a[2])*u-deckDepth;
        const gBase=ground([lon,lat])-.5;
        if(pz-gBase>.5)orientedPier(mesh,px,py,ux,uy,pz,gBase,bedWidth);
      }
      distance=(distance+len)%pierStep;
    }
  }
}
