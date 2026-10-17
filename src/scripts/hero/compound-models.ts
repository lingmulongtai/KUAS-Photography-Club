import * as THREE from 'three';
import type {Part} from './landmarks';
import {roof} from './temple-models.ts';

type Color=Part['color'];
const timber:Color=[.11,.055,.025],plaster:Color=[.43,.39,.3],tile:Color=[.045,.049,.045];
export function block(parts:Part[],w:number,h:number,d:number,x:number,y:number,z:number,color:Color,glow=.12) {
  const geo=new THREE.BoxGeometry(w,h,d);geo.translate(x,y,z);parts.push({geo,color,glow});
}

/** Roof-outline dimensions, a raised plinth, timber bays and deep eaves. Small joinery is
 * illustrative; the Toji dimensions/positions use the measured PLATEAU hall outlines. */
export function templeHall(w:number,d:number,h:number,doubleRoof=false):Part[] {
  const parts:Part[]=[];
  const wallH=h*(doubleRoof ? .55 : .64),base=1.2;
  block(parts,w*.85,base,d*.85,0,base/2,0,[.22,.21,.18]);
  block(parts,w*.71,wallH-base,d*.69,0,(wallH+base)/2,0,plaster);
  const bays=Math.max(5,Math.round(w/5));
  for(const side of [-1,1]){
    for(let i=0;i<=bays;i++){
      const x=(i/bays-.5)*w*.77;
      block(parts,.38,wallH,.42,x,wallH/2,side*d*.37,timber);
      block(parts,1.05,.32,1.3,x,wallH-.15,side*d*.38,timber);
      if(i<bays)block(parts,w*.77/bays-.5,wallH*.54,.25,x+w*.77/bays/2,wallH*.42,side*d*.352,[.026,.023,.018]);
    }
    block(parts,w*.79,.32,.4,0,wallH*.83,side*d*.375,timber);
    block(parts,w*.83,.22,1.25,0,base+.12,side*d*.38,timber);
    for(let i=0;i<6;i++)block(parts,.4,wallH,.38,side*w*.38,wallH/2,(i/5-.5)*d*.74,timber);
  }
  if(doubleRoof){
    roof(parts,w,d,h*.18,wallH,0,tile);
    block(parts,w*.54,h*.12,d*.47,0,wallH+h*.15,0,plaster);
    for(const side of [-1,1])for(let i=0;i<7;i++)
      block(parts,w*.06,h*.065,.22,(i-3)*w*.077,wallH+h*.16,side*d*.237,[.028,.025,.019]);
    roof(parts,w*.8,d*.84,h*.23,wallH+h*.22,0,tile);
  }else roof(parts,w,d,h-wallH,wallH,0,tile);
  // Broad south entrance stairs; the front remains recognisable at an orbiting distance.
  for(let i=0;i<5;i++)block(parts,w*.25,base*(i+1)/5,1.1,0,base*(i+1)/10,d*.425+(4-i)*.8,[.24,.23,.2]);
  return parts;
}
