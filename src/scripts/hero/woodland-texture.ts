import * as THREE from 'three';
import type { Box } from './geo';
import type { Woodland } from './woodland';

/** One shared raster keeps ground shading and O(1) tree placement consistent. */
export function buildWoodlandTexture(polygons: Woodland[], box: Box) {
  const size=2048, canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  const sx=size/(box[2]-box[0]),sz=size/(box[3]-box[1]);
  ctx.setTransform(sx,0,0,sz,-box[0]*sx,-box[1]*sz);
  ctx.fillStyle='white';
  for(const polygon of polygons) {
    ctx.beginPath();
    for(const ring of [...polygon.outer,...polygon.holes]) {
      ctx.moveTo(...ring[0]);
      for(const p of ring.slice(1)) ctx.lineTo(...p);
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  const pixels=ctx.getImageData(0,0,size,size).data;
  const coverage=new Uint8Array(size*size);
  for(let i=0;i<coverage.length;i++) coverage[i]=pixels[i*4+3];
  const texture=new THREE.CanvasTexture(canvas);
  // The shader uses increasing world z as texture v; canvas rows already do that.
  texture.flipY=false;
  texture.generateMipmaps=false;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;
  const contains=(x:number,z:number)=>{
    const ix=Math.floor((x-box[0])*sx),iz=Math.floor((z-box[1])*sz);
    return ix>=0&&iz>=0&&ix<size&&iz<size&&coverage[iz*size+ix]>127;
  };
  return {texture,contains};
}
