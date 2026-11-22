import type {Box,Point,Ring} from './coordinates';

/** Clip just the overlapping part of a large footprint when a surveyed hall is resident. */
export function landmarkCutout(rings:Ring[],center:Point,scale:Point,tile:Box){
  if(!rings.length)return;
  const limits:Box=[Infinity,Infinity,-Infinity,-Infinity];
  const lines=rings.map(r=>r.map(([lon,lat])=>{
    const x=(lon-center[0])*scale[0],y=(lat-center[1])*scale[1];
    limits[0]=Math.min(limits[0],x);limits[1]=Math.min(limits[1],y);
    limits[2]=Math.max(limits[2],x);limits[3]=Math.max(limits[3],y);
    return [x,y] as Point;
  }));
  const west=Math.max(tile[0],limits[0])-1,south=Math.max(tile[1],limits[1])-1;
  const width=Math.min(tile[2],limits[2])+1-west,height=Math.min(tile[3],limits[3])+1-south;
  if(width<=0||height<=0)return;
  const canvas=document.createElement('canvas');
  canvas.width=Math.min(768,Math.max(2,Math.ceil(width*2)));canvas.height=Math.min(768,Math.max(2,Math.ceil(height*2)));
  const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#f00';ctx.strokeStyle='#f00';ctx.lineWidth=1;
  for(const line of lines){
    ctx.beginPath();
    line.forEach(([x,y],index)=>{
      const px=(x-west)*canvas.width/width,py=(south+height-y)*canvas.height/height;
      if(index===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    });
    ctx.closePath();ctx.fill();ctx.stroke();
  }
  return {canvas,extent:[west,south,width,height]};
}
