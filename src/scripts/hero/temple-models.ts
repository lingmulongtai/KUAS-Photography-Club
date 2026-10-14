import * as THREE from 'three';
import type { Part } from './landmarks';

const wood: Part['color'] = [.12,.065,.028], roofColor: Part['color'] = [.055,.06,.057], gold: Part['color'] = [.67,.45,.09];
const box = (parts:Part[],w:number,h:number,d:number,x:number,y:number,z:number,color=wood,glow=.25) => {
  const geo=new THREE.BoxGeometry(w,h,d);geo.translate(x,y,z);parts.push({geo,color,glow});
};

/** Eight-sided eave rings: curved corners and an overhanging fascia, not a pyramid. */
function roof(parts:Part[],w:number,d:number,h:number,y:number,z=0) {
  const points:number[][]=[];
  const outline=[[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
  for (const [scale,height] of [[1,0],[.72,.32],[.28,1]]) for (const [x,v] of outline) {
    points.push([x*w*.5*scale,y+h*height+(height===0&&x!==0&&v!==0?.3:0),z+v*d*.5*scale]);
  }
  const vertices:number[]=[];
  for (let ring=0;ring<2;ring++) for(let i=0;i<8;i++) {
    const a=ring*8+i,b=ring*8+(i+1)%8,c=a+8,e=b+8;
    for(const index of [a,c,b,b,c,e])vertices.push(...points[index]);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
  parts.push({geo,color:roofColor,glow:.2});
  box(parts,w,.3,d,0,y-.15,z,roofColor,.2);
  box(parts,w*.3,.28,.35,0,y+h,z,roofColor,.3);
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
