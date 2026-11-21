import {tileMetresPerDegree,type Box,type Point} from './coordinates';
import {Mesh,type RGB,type XYZ} from './mesh';

// Mapped bridge ends, published construction spans, and median GSI ground levels 5 m up each approach.
// Otsu Civil Engineering Office, 2023, figures 2, 6 and 12. The east footway is a separate structure.
const crossings:{west:Point;east:Point;width:number;spans:number[];banks:Point;approaches:Point;walkway:boolean}[]=[
  {west:[135.9049509,34.9733849],east:[135.9054889,34.9732521],width:15,spans:[17.25,17.25,17.25],
    banks:[88.19,88.19],approaches:[5.2,5.8],walkway:false},
  {west:[135.9057801,34.9731784],east:[135.9075769,34.9727382],width:14,spans:[23.5,25,25,25,25,25,23.5],
    banks:[88.25,88.17],approaches:[5.0,3.15],walkway:true},
];
const girder:RGB=[99,76,62],rail:RGB=[175,130,72],post:RGB=[162,120,65],bronze:RGB=[54,82,78];
const asphalt:RGB=[85,86,84],walk:RGB=[146,141,131],concrete:RGB=[132,128,116];
const geoid=37.5414; // GSI Geoid 2024 at 34.973 N, 135.9064 E.
const scale=tileMetresPerDegree(34.973);

// Only the two Karahashi bridge centre lines are replaced. Connecting streets and other bridges stay in the road network.
export function isSetaDeck(p:Point){
  return crossings.some(({west,east})=>{
    const dx=(east[0]-west[0])*scale[0],dy=(east[1]-west[1])*scale[1];
    const x=(p[0]-west[0])*scale[0],y=(p[1]-west[1])*scale[1],len=Math.hypot(dx,dy);
    const along=(x*dx+y*dy)/len;
    return along>=-7&&along<=len+7&&Math.abs(x*dy-y*dx)/len<2.8;
  });
}

export function drawSetaBridges(mesh:Mesh,[w,s,e,n]:Box,local:(p:Point)=>Point){
  for(const bridge of crossings){
    const {west,east,spans,width,approaches,banks}=bridge;
    if(e<west[0]-.00012||w>east[0]+.00012||n<east[1]-.00015||s>west[1]+.00015)continue;
    const length=spans.reduce((a,b)=>a+b,0),half=width/2;
    const [ax,ay]=local(west),[bx,by]=local(east),distance=Math.hypot(bx-ax,by-ay);
    const leftX=(ay-by)/distance,leftY=(bx-ax)/distance;
    // Split longitudinal runs once at the z16 seam. A post is always owned by just one tile.
    const lo=(w-west[0])/(east[0]-west[0])*length,hi=(e-west[0])/(east[0]-west[0])*length;
    function point(d:number,left:number,height:number):XYZ{
      const t=d/length;
      return [ax+(bx-ax)*t+leftX*left,ay+(by-ay)*t+leftY*left,
        geoid+banks[0]+t*(banks[1]-banks[0])+.18+height];
    }
    function beam(a:number,b:number,right:number,left:number,base:number,top:number,color:RGB){
      const start=Math.max(lo,a),end=Math.min(hi,b);
      if(start>=end)return;
      const ar=point(start,right,top),al=point(start,left,top),br=point(end,right,top),bl=point(end,left,top);
      const ur=point(start,right,base),ul=point(start,left,base),vr=point(end,right,base),vl=point(end,left,base);
      mesh.quad(ar,br,bl,al,color);mesh.quad(ur,ul,vl,vr,color);
      mesh.quad(ur,vr,br,ar,color);mesh.quad(ul,al,bl,vl,color);
      if(start===a)mesh.quad(ur,ar,al,ul,color);
      if(end===b)mesh.quad(vr,vl,bl,br,color);
    }
    function turned(d:number,left:number,profile:Point[],color:RGB){
      if(d<lo||d>=hi)return;
      const around=(i:number,[h,r]:Point)=>point(d+Math.cos(i*Math.PI/4)*r,left+Math.sin(i*Math.PI/4)*r,h);
      for(let j=1;j<profile.length;j++)for(let i=0;i<8;i++){
        mesh.quad(around(i,profile[j-1]),around(i+1,profile[j-1]),around(i+1,profile[j]),around(i,profile[j]),color);
      }
    }
    const stations=[0];
    for(const span of spans)stations.push(stations.at(-1)!+span);
    beam(-approaches[0],length+approaches[1],-half,half,-.28,0,asphalt);
    for(const d of stations.slice(1,-1)){
      beam(d-.52,d+.52,-half+.5,half-.5,-1.9,-1.05,concrete);
      for(const side of [-.72,0,.72])turned(d,side*half,[[-9,.52],[-1.85,.52]],concrete);
    }
    const extra=bridge.walkway?length-16.8:length;
    for(const side of [-1,1]){
      const edge=side*half;
      beam(0,length,Math.min(edge*.65,edge),Math.max(edge*.65,edge),0,.14,walk);
      beam(0,length,edge*.97-.15,edge*.97+.15,-1.08,-.26,girder);
      const pathEnd=side===1?extra:length;
      function railing(start:number,end:number,offset:number){
        for(const h of [.43,.98])beam(start,end,offset-.075,offset+.075,h,h+.13,rail);
        for(let d=start+.95;d<end;d+=2.1)beam(d-.085,d+.085,offset-.08,offset+.08,.14,1.04,post);
      }
      const offset=side*(half-.18);
      railing(0,pathEnd,offset);
      if(pathEnd<length){
        beam(extra,length,half,half+3,-.45,.14,walk);
        railing(extra,length,offset+3);
        beam(extra-.09,extra+.09,offset,offset+3,.98,1.11,rail);
        beam(extra-.09,extra+.09,offset,offset+3,.43,.56,rail);
        for(const d of [length-14.5,length])turned(d,half+1.5,[[-9,.42],[-.45,.42]],concrete);
      }
      for(const d of stations){
        const left=offset+(side===1&&bridge.walkway&&d===length?3:0);
        turned(d,left,[[.1,.28],[1.04,.26],[1.08,.23]],rail);
        // The published finial measures 866 mm high with a 423 mm base and a 380 mm bulb.
        turned(d,left,[[1.08,.2115],[1.13,.2115],[1.14,.200],[1.29,.200],[1.30,.207],
          [1.34,.207],[1.35,.200],[1.49,.200],[1.52,.208],[1.57,.196],[1.60,.09],
          [1.64,.085],[1.68,.145],[1.75,.185],[1.82,.19],[1.88,.15],[1.92,.038],[1.946,.006]],bronze);
      }
    }
    for(const offset of [-3,0,3])beam(0,length,offset-.13,offset+.13,-1.1,-.26,girder);
    for(let d=2;d<length;d+=9)beam(d,Math.min(d+4,length),-.065,.065,.013,.016,[201,182,121]);
  }
}
