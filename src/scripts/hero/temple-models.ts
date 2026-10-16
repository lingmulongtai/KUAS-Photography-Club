import * as THREE from 'three';
import type { Part } from './landmarks';

const wood: Part['color'] = [.12,.065,.028], roofColor: Part['color'] = [.055,.06,.057], gold: Part['color'] = [.67,.45,.09];
const box = (parts:Part[],w:number,h:number,d:number,x:number,y:number,z:number,color=wood,glow=.25) => {
  const geo=new THREE.BoxGeometry(w,h,d);geo.translate(x,y,z);parts.push({geo,color,glow});
};

/** Eight-sided eave rings: curved corners and an overhanging fascia, not a pyramid. */
export function roof(parts:Part[],w:number,d:number,h:number,y:number,z=0,color=roofColor) {
  const points:number[][]=[];
  const outline=[[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
  const profile=[[1,0],[.94,.035],[.82,.16],[.65,.39],[.43,.7],[.28,1]];
  for (const [scale,height] of profile) for (const [x,v] of outline) {
    const turn=x!==0&&v!==0?.3*Math.max(0,(scale-.8)/.2):0;
    points.push([x*w*.5*scale,y+h*height+turn,z+v*d*.5*(height===1?.018:scale)]);
  }
  const vertices:number[]=[];
  for (let ring=0;ring<profile.length-1;ring++) for(let i=0;i<8;i++) {
    const a=ring*8+i,b=ring*8+(i+1)%8,c=a+8,e=b+8;
    for(const index of [a,c,b,b,c,e])vertices.push(...points[index]);
  }
  // Close the upper ring. The ridge alone leaves the middle of the roof open from above.
  const top=(profile.length-1)*8;
  for(let i=0;i<8;i++) vertices.push(0,y+h,z,...points[top+(i+1)%8],...points[top+i]);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
  parts.push({geo,color,glow:.2});
  box(parts,w,.22,d,0,y-.11,z,color,.2);
  box(parts,w*.3,.28,.35,0,y+h,z,color,.3);
}

/** Three distinct storeys, gold upper walls, dark openings and a roof phoenix. */
export function goldenPavilion():Part[] {
  const parts:Part[]=[];
  box(parts,13,.5,12,0,.25,0,[.23,.22,.18]);
  for (const [y,w,d,wall,h] of [[.5,11.2,10.4,wood,3.1],[4,10.6,9.8,gold,2.6],[7.5,7.8,7.8,gold,2.7]] as [number,number,number,Part['color'],number][]) {
    box(parts,w,.25,d,0,y,0,wall,.7);
    box(parts,w,h*.58,d,0,y+h*.45,0,wall,.6);
    for(const side of [-1,1]) {
      for(let x=-w*.4;x<=w*.41;x+=w/5) {
        box(parts,.22,h,.22,x,y+h*.5,side*d*.51,wall,.7);
        box(parts,w/5-.28,h*.5,.16,x+w/10,y+h*.55,side*d*.515,[.018,.025,.021],.1);
      }
      for(let z=-d*.4;z<=d*.41;z+=d/5) box(parts,.22,h,.22,side*w*.51,y+h*.5,z,wall,.7);
      box(parts,w,.16,.18,0,y+h*.18,side*d*.54,wall,.55);
    }
    roof(parts,w*1.35,d*1.35,1.35,y+h);
  }
  // Stylized wings and crest retain the pavilion's recognizable finial at low polygon cost.
  const body=new THREE.SphereGeometry(.3,8,6);body.scale(1,.7,1.6);body.translate(0,11.75,0);parts.push({geo:body,color:gold,glow:.7});
  for(const side of [-1,1]) {
    const wing=new THREE.BoxGeometry(1.2,.1,.5);wing.rotateZ(side*.4);wing.translate(side*.55,11.9,0);parts.push({geo:wing,color:gold,glow:.7});
  }
  box(parts,.12,.8,.12,0,11.6,0,gold,.7);
  return parts;
}

/** Simplified Shishinden: OSM way/554905814's 43 x 35 m footprint and nine front bays.
 * Roof height and small details are illustrative, rather than a survey reconstruction. */
export function shishinden():Part[] {
  const parts:Part[]=[];
  const timber:Part['color']=[.2,.12,.065], shutters:Part['color']=[.035,.032,.025];
  box(parts,38,1.4,29,0,.7,0,[.24,.21,.17],.1);
  box(parts,32,5.5,23,0,4.5,0,timber,.15);
  for (const side of [-1,1]) {
    for(let bay=0;bay<=9;bay++) {
      const x=-16+bay*32/9;
      box(parts,.5,7,.5,x,4.9,side*13,timber,.2);
      if(bay<9) box(parts,32/9-.6,3.7,.2,x+16/9,4.4,side*11.6,shutters,.1);
    }
    for(let z=-9;z<=9;z+=4.5) box(parts,.5,7,.5,side*17,4.9,z,timber,.2);
  }
  roof(parts,43,35,9,8);
  for(let step=0;step<5;step++) box(parts,6,.28,1.3,0,.14+step*.28,18-step*1.1,timber,.15);
  return parts;
}

/** Ryoan-ji's Hojo and south-facing rock garden. Footprint follows OSM way/374564926;
 * timber details and the fifteen stones are illustrative, not a measured reconstruction. */
export function ryoanji():Part[] {
  const parts:Part[]=[];
  const plaster:Part['color']=[.49,.45,.35], dark:Part['color']=[.045,.035,.024];
  box(parts,25,1.2,21,0,.6,-3,wood,.15);
  box(parts,21,4.8,17,0,3.5,-3,plaster,.15);
  for(const side of [-1,1]) {
    for(let i=0;i<=8;i++) {
      const x=-11+i*2.75;
      box(parts,.25,5.8,.25,x,3.8,-3+side*9.5,wood,.2);
      if(i<8) box(parts,2.3,3.3,.18,x+1.375,3.2,-3+side*8.6,dark,.1);
    }
    for(const z of [-10,-6,-2,2,6]) box(parts,.25,5.8,.25,side*11.8,3.8,z,wood,.2);
  }
  box(parts,25,.18,2,0,1.3,8,wood,.2); // veranda facing the garden
  roof(parts,28,24,5,6.8,-3);
  box(parts,25,.25,10,0,.125,16,[.5,.47,.39],.08);
  box(parts,26,1.8,.45,0,.9,21.2,[.26,.19,.12],.1);
  for(const side of [-1,1]) box(parts,.45,1.8,11,side*12.8,.9,16,[.26,.19,.12],.1);
  // Five groups, fifteen stones. Avoid thin unfiltered gravel lines that shimmer at distance.
  const groups=[[-9,15,5],[-4,18,2],[0,13.5,3],[5.5,17.5,2],[9,14,3]];
  for(const [x,z,n] of groups) {
    const moss=new THREE.CylinderGeometry(1.6,1.6,.16,12);moss.scale(1,1,.58);moss.translate(x,.3,z);
    parts.push({geo:moss,color:[.085,.13,.045],glow:.05});
    for(let i=0;i<n;i++) {
      const stone=new THREE.IcosahedronGeometry(.45+(i%2)*.18,0);
      stone.scale(1,.8+(i%3)*.35,.65);stone.rotateY(i*1.7);
      stone.translate(x+(i-(n-1)/2)*.6,.55+(i%3)*.13,z+Math.sin(i*2)*.4);
      parts.push({geo:stone,color:[.19,.18,.15],glow:.08});
    }
  }
  return parts;
}

/** Main hall and its cantilevered stage, supported by eighteen timber columns. */
export function kiyomizuHall():Part[] {
  const parts:Part[]=[];
  for(let row=0;row<3;row++) for(let i=0;i<6;i++) {
    const x=-14+i*5.6,z=-5+row*6;
    box(parts,.75,13,.75,x,6.5,z,wood,.28);
    box(parts,1.3,.6,1.3,x,.3,z,[.24,.23,.2],.1);
  }
  for(const y of [3,7,11]) {
    for(const z of [-5,1,7])box(parts,30,.4,.4,0,y,z,wood,.2);
    for(let x=-14;x<=14;x+=5.6)box(parts,.4,.4,15,x,y,1,wood,.2);
  }
  for(let i=0;i<26;i++)box(parts,1.18,.3,18,-15+i*1.2,13.15,1,[.24,.13,.062],.35);
  for(let x=-15;x<=15;x+=2.5)box(parts,.18,1.25,.18,x,13.9,10,wood,.4);
  for(const y of [13.6,14.45])box(parts,31,.18,.18,0,y,10,wood,.4);
  for(const side of [-1,1]) {
    for(let z=-7;z<=9;z+=2.5)box(parts,.18,1.25,.18,side*15,13.9,z,wood,.4);
    box(parts,.18,.18,18,side*15,14.45,1,wood,.4);
  }
  box(parts,32,5,16,0,15.7,-14,[.095,.055,.026],.3);
  for(let x=-15;x<=15;x+=3) {
    box(parts,.4,6,.4,x,16,-5.7,wood,.4);
    box(parts,2.4,3.6,.2,x,16,-5.5,[.025,.022,.015],.15);
  }
  roof(parts,40,25,6.5,19,-13);
  roof(parts,35,8,1.8,18,-3);
  return parts;
}
/** Togetsukyo's measured axis and width, with timber rails and exposed piers. */
export function togetsukyo():Part[] {
  const parts:Part[]=[];
  const length=152.5,width=11;
  for(let i=0;i<32;i++) {
    const z=-length/2+(i+.5)*length/32;
    const y=.4+.55*(1-(z/(length/2))**2);
    box(parts,width,.5,length/32+.04,0,y,z,[.17,.18,.17],.1);
    for(const side of [-1,1]) {
      box(parts,.18,1.2,.18,side*width*.48,y+.85,z,[.16,.085,.038],.18);
      box(parts,.18,.18,length/32+.1,side*width*.48,y+1.35,z,[.18,.1,.045],.2);
      box(parts,.14,.14,length/32+.1,side*width*.48,y+.7,z,[.18,.1,.045],.2);
    }
  }
  for(const z of [-55,-27,0,27,55]) {
    box(parts,9,1,2,0,-.7,z,[.15,.16,.15],.1);
    for(const x of [-3.5,3.5])box(parts,1.4,8,2.6,x,-4,z,[.22,.21,.19],.1);
  }
  return parts;
}
