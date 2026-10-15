import type { LineFeature } from './lines-data';
import type { Box } from './geo';

/** A one-time CPU mask prevents historical woodland from planting across today's rivers/roads. */
export function infrastructureMask(lines: LineFeature[], box: Box) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2048;
  const ctx = canvas.getContext('2d', {willReadFrequently:true})!;
  const sx = 2048 / (box[2] - box[0]), sz = 2048 / (box[3] - box[1]);
  ctx.setTransform(sx,0,0,sz,-box[0]*sx,-box[1]*sz);
  ctx.strokeStyle = ctx.fillStyle = 'white'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const path = (f: LineFeature) => {
    ctx.moveTo(f.pts[0],f.pts[1]);
    for (let i=2;i<f.pts.length;i+=2) ctx.lineTo(f.pts[i],f.pts[i+1]);
  };
  for (let n=0;n<lines.length;n++) {
    const f=lines[n];
    if (f.kind !== 0 && f.kind !== 1 && f.kind !== 2) continue;
    ctx.beginPath(); path(f);
    if (f.kind === 2) {
      ctx.closePath();
      while (n+1<lines.length && lines[n+1].kind===3) {path(lines[++n]);ctx.closePath();}
      ctx.fill('evenodd');
      // Half a mask pixel of clearance keeps partially covered banks free of tree trunks.
      ctx.lineWidth = Math.max(1/sx,1/sz);ctx.stroke();
    }
    else {ctx.lineWidth = (f.kind === 1 ? 6 : [6,8,12,18,26][Math.min(4,f.attr&15)]) + 8;ctx.stroke();}
  }
  const pixels=ctx.getImageData(0,0,2048,2048).data;
  return (x:number,z:number) => {
    const ix=Math.floor((x-box[0])*sx),iz=Math.floor((z-box[1])*sz);
    return ix>=0&&iz>=0&&ix<2048&&iz<2048&&pixels[(iz*2048+ix)*4+3]>80;
  };
}
