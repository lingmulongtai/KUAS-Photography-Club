import type {Part} from './landmarks';
import {block} from './compound-models.ts';
import {roof} from './temple-models.ts';

const red:Part['color']=[.47,.065,.025],white:Part['color']=[.58,.55,.45],green:Part['color']=[.055,.14,.085];
export const HEIAN_CENTER={x:2095.4,z:-1380};
/** Match measured shrine/administration roofs, without clearing the neighbourhood. */
export function replacesHeianFootprint(ring:Float32Array){
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(let i=0;i<ring.length;i+=2){bounds[0]=Math.min(bounds[0],ring[i]);bounds[1]=Math.min(bounds[1],ring[i+1]);
    bounds[2]=Math.max(bounds[2],ring[i]);bounds[3]=Math.max(bounds[3],ring[i+1]);}
  return [[2025.06,-1445.8,2163.91,-1338.19],[2063.32,-1485.94,2132.2,-1438.22],[2081.86,-1322.18,2109.37,-1305.96],
    [2109.19,-1380.08,2164.25,-1302.1],[2163.02,-1372.9,2198.9,-1289.59]]
    .some(b=>b.every((v,i)=>Math.abs(v-bounds[i])<2));
}

/** Official precinct plan, aligned to the PLATEAU main compound and Otenmon outlines.
 * Courtyards remain open; roof curves and timber detail are illustrative low-poly work. */
export function heianShrine():Part[]{
  const parts:Part[]=[];
  const place=(x:number,z:number,build:()=>void)=>{const start=parts.length;build();for(const p of parts.slice(start))p.geo.translate(x,0,z);};
  const hall=(w:number,d:number,h:number)=>{
    block(parts,w*.86,1.1,d*.86,0,.55,0,[.25,.24,.2]);
    block(parts,w*.74,h*.43,d*.67,0,1.1+h*.215,0,white);
    for(const side of [-1,1])for(let i=0;i<=8;i++){
      const x=(i/8-.5)*w*.8;
      block(parts,.32,h*.63,.36,x,h*.315,side*d*.36,red);
      block(parts,.8,.22,1.1,x,h*.62,side*d*.37,red);
      if(i<8)block(parts,w*.1-.4,h*.33,.14,x+w*.05,h*.28+1,side*d*.34,[.07,.045,.025]);
    }
    for(const side of [-1,1])block(parts,w*.83,.3,.3,0,h*.55,side*d*.37,red);
    roof(parts,w,d,h*.36,h*.64,0,green);
  };
  const corridor=(w:number,d:number)=>{
    block(parts,w,.35,d,0,.18,0,[.3,.29,.25]);
    const length=Math.max(w,d),n=Math.ceil(length/4);
    for(let i=0;i<=n;i++)for(const side of [-1,1]){
      const p=(i/n-.5)*length;
      block(parts,.22,3.1,.22,w>d?p:side*w*.38,1.8,w>d?side*d*.38:p,red);
    }
    roof(parts,w,d,1.3,3.4,0,green);
  };
  // Daigokuden, towers and the north/south perimeter of the two courts.
  place(0,-52,()=>hall(42,25,15.7));
  for(const side of [-1,1]){
    place(side*57,-20,()=>{hall(18,17,15.1);roof(parts,18,17,2.1,7,0,green);});
    place(side*44,-52,()=>corridor(46,6));
    place(side*65,-36,()=>corridor(6,32));
    place(side*65,25,()=>corridor(6,90));
    place(side*42,66,()=>corridor(46,7));
    place(side*20,58,()=>corridor(6,16));
    place(side*51,26,()=>hall(15,31,10.5));
  }
  // The east-side fused source roof contains Kaguraden, walks and administration.
  // Split its office-like extrusion into the hall above and lower service wings.
  for(const [x,z,w,d,h] of [[81,28,26,42,9.6],[85.6,64,35.8,38,9.6],[93,82,17,17,6]]){
    const start=parts.length;place(x,z,()=>hall(w,d,h));
    for(const p of parts.slice(start))if(p.color===green)p.color=[.1,.115,.1];
  }
  // Inner sanctuary and its short enclosing walks, behind the outer prayer hall.
  place(0,-91,()=>hall(58,25,12.5));
  for(const side of [-1,1])place(side*32,-84,()=>corridor(5,39));
  place(0,-65,()=>corridor(64,6));
  // Otenmon: a real open lower passage below a two-storey, double-eaved gate.
  place(.22,65.93,()=>{
    block(parts,26,1.2,15,0,.6,0,[.29,.28,.24]);
    for(const side of [-1,1])for(const x of [-10,-3.4,3.4,10])block(parts,.5,6.8,.5,x,4.6,side*5,red);
    roof(parts,27.29,15.79,2.3,7,0,green);
    block(parts,19,5.1,9.5,0,11.3,0,white);
    for(const side of [-1,1])for(let i=-3;i<=3;i++){
      block(parts,.3,5.1,.35,i*2.9,11.3,side*4.9,red);
      if(i<3)block(parts,2.35,2.8,.18,i*2.9+1.45,11.4,side*4.8,[.07,.04,.025]);
    }
    roof(parts,24,14,4.8,14.1,0,green);
  });
  // Ryubidan is raised only at the back of the otherwise unobstructed gravel court.
  block(parts,116,.45,36,0,.225,-25,[.36,.33,.27]);
  return parts;
}
