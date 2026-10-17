import * as THREE from 'three';
import type {LineFeature} from './lines-data.ts';
import type {Box} from './geo.ts';

export const KAMO_BOX:Box=[450,-3600,1650,1500];
type Polygon={outer:Float32Array;holes:Float32Array[];box:Box};
const inside=(p:Float32Array,x:number,z:number)=>{
  let hit=false;
  for(let i=0,j=p.length-2;i<p.length;j=i,i+=2)
    if((p[i+1]>z)!==(p[j+1]>z)&&x<(p[j]-p[i])*(z-p[i+1])/(p[j+1]-p[i+1])+p[i])hit=!hit;
  return hit;
};

/** One gently descending water level across each cross-section. Shore DEM
 * samples include embankments and bridges, so they cannot define the water surface.
 */
export function createKamoChannel(lines:LineFeature[],ground:(x:number,z:number)=>number) {
  const box=KAMO_BOX,polygons:Polygon[]=[];
  const inBounds=(x:number,z:number)=>x>=box[0]&&x<=box[2]&&z>=box[1]&&z<=box[3];
  for(let i=0;i<lines.length;i++) {
    const f=lines[i];
    if(f.kind!==2||f.attr!==2)continue;
    const holes:Float32Array[]=[];
    while(i+1<lines.length&&lines[i+1].kind===3)holes.push(lines[++i].pts);
    let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
    for(let k=0;k<f.pts.length;k+=2) {
      x0=Math.min(x0,f.pts[k]);x1=Math.max(x1,f.pts[k]);
      z0=Math.min(z0,f.pts[k+1]);z1=Math.max(z1,f.pts[k+1]);
    }
    if(x1>=box[0]&&x0<=box[2]&&z1>=box[1]&&z0<=box[3])polygons.push({outer:f.pts,holes,box:[x0,z0,x1,z1]});
  }
  // The connected main river includes both delta branches. Independent canals
  // and garden ponds have their own levels and retain their original surfaces.
  const area=(p:Polygon)=>{
    let a=0;const r=p.outer;
    for(let i=0,j=r.length-2;i<r.length;j=i,i+=2)a+=r[j]*r[i+1]-r[i]*r[j+1];
    return Math.abs(a);
  };
  if(polygons.length) {
    const main=polygons.reduce((a,b)=>area(a)>area(b)?a:b);
    polygons.splice(0,polygons.length,main);
  }
  const owns=(ring:Float32Array)=>polygons.some(p=>p.outer===ring);
  const contains=(x:number,z:number)=>inBounds(x,z)&&polygons.some(p=>
    x>=p.box[0]&&x<=p.box[2]&&z>=p.box[1]&&z<=p.box[3]&&inside(p.outer,x,z)&&!p.holes.some(h=>inside(h,x,z)));
  const step=25,count=Math.round((box[3]-box[1])/step)+1,raw:number[]=[];
  for(let i=0;i<count;i++) {
    const z=box[1]+i*step,heights:number[]=[];
    for(let x=box[0];x<=box[2];x+=5)if(contains(x,z))heights.push(ground(x,z));
    heights.sort((a,b)=>a-b);
    raw.push(heights.length?heights[Math.floor((heights.length-1)*.2)]+.35:NaN);
  }
  // Fill occasional no-water slices from their neighbours, not from a raised road.
  for(let i=0;i<count;i++)if(!Number.isFinite(raw[i])) {
    let j=i-1,k=i+1;
    while(j>=0&&!Number.isFinite(raw[j]))j--;
    while(k<count&&!Number.isFinite(raw[k]))k++;
    raw[i]=j>=0&&k<count?raw[j]+(raw[k]-raw[j])*(i-j)/(k-j):j>=0?raw[j]:k<count?raw[k]:ground(1100,box[1]+i*step);
  }
  const levels=raw.map((_,i)=>{
    let sum=0,n=0;
    for(let j=Math.max(0,i-2);j<=Math.min(count-1,i+2);j++){sum+=raw[j];n++;}
    return sum/n;
  });
  for(let i=1;i<count;i++)levels[i]=Math.min(levels[i],levels[i-1]);
  const level=(z:number)=>{
    const f=Math.max(0,Math.min(count-1,(z-box[1])/step)),i=Math.min(count-2,Math.floor(f));
    return levels[i]+(levels[i+1]-levels[i])*(f-i);
  };
  const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
  const stability=(x:number,z:number)=>smooth(Math.min(z-box[1],box[3]-z)/200)*smooth(Math.min(x-box[0],box[2]-x)/40);
  const surface=(x:number,z:number,h:number)=>h+.4+(level(z)-h-.4)*stability(x,z);
  const bed=(x:number,z:number,h:number)=>contains(x,z)?Math.min(h,surface(x,z,h)-.6):h;
  return {box,polygons,owns,inBounds,contains,level,stability,surface,bed};
}

export type KamoChannel=ReturnType<typeof createKamoChannel>;

/** R=precise water mask, G=soft bank fringe. Rasterize once, never per frame. */
export function kamoMask(channel:KamoChannel) {
  const width=512,height=2176,[x0,z0,x1,z1]=channel.box;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);ctx.fillStyle='#fff';
  for(const p of channel.polygons) {
    ctx.beginPath();
    for(const ring of [p.outer,...p.holes]) {
      for(let i=0;i<ring.length;i+=2) {
        const x=(ring[i]-x0)/(x1-x0)*width,y=(ring[i+1]-z0)/(z1-z0)*height;
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  const water=ctx.getImageData(0,0,width,height).data;
  const blur=document.createElement('canvas');blur.width=width;blur.height=height;
  const bc=blur.getContext('2d')!;bc.fillStyle='#000';bc.fillRect(0,0,width,height);bc.filter='blur(3px)';bc.drawImage(canvas,0,0);
  const banks=bc.getImageData(0,0,width,height).data,data=new Uint8Array(width*height*4);
  for(let i=0;i<data.length;i+=4){data[i]=water[i];data[i+1]=banks[i];data[i+3]=255;}
  const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}
