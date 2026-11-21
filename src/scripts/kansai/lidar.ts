import {rasterPixels} from './raster';
import {inPolygon,tileXY,type Point,type Ring} from './coordinates';
import {json} from './sources';

// GSJ seamless elevation PNG uses signed 24-bit centimetres. Transparent samples are void.
export function elevation(data:ImageData,index:number){
  if(data.data[index+3]===0)return;
  const rgb=data.data[index]*65536+data.data[index+1]*256+data.data[index+2];
  return (rgb>=8388608?rgb-16777216:rgb)*.01;
}
type Pair={surface:ImageData;ground:ImageData};
const pairs=new Map<string,Promise<Pair|undefined>>();
let masks:Promise<Record<string,string>>|undefined;
async function read(layer:string,x:number,y:number,signal:AbortSignal){
  const res=await fetch('https://tiles.gsj.jp/tiles/elev/'+layer+'/17/'+y+'/'+x+'.png',{signal});
  if(!res.ok)throw Error('Elevation '+res.status);
  const bitmap=await createImageBitmap(await res.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
  return rasterPixels(bitmap);
}
function pair(x:number,y:number){
  const key=x+'/'+y,existing=pairs.get(key);if(existing)return existing;
  const signal=AbortSignal.timeout(6500);
  const request=Promise.all([read('hyogodsm',x,y,signal),read('hyogodem',x,y,signal)])
    .then(([surface,ground])=>({surface,ground})).catch(()=>{pairs.delete(key);return undefined;});
  pairs.set(key,request);
  if(pairs.size>140)pairs.delete(pairs.keys().next().value!);
  return request;
}
export async function hyogoHeights(x:number,y:number){
  const startX=x*2,startY=y*2;
  masks??=json<Record<string,string>>('lidar-coverage.json').catch(error=>{masks=undefined;throw error;});
  const index=await masks;
  const local=await Promise.all([0,1,2,3].map(i=>{
    const tx=startX+(i%2),ty=startY+(i>>1),mask=index[(tx>>5)+'/'+(ty>>5)];
    const bit=(ty%32)*32+(tx%32),offset=(bit>>3)*2;
    return mask && (parseInt(mask.slice(offset,offset+2),16)&(1<<(bit%8))) ? pair(tx,ty) : undefined;
  }));
  return (rings:Ring[])=>{
    const outline=rings[0],xs=outline.map(p=>p[0]),ys=outline.map(p=>p[1]);
    const w=Math.min(...xs),e=Math.max(...xs),s=Math.min(...ys),n=Math.max(...ys);
    const values:number[]=[],visited=new Set<number>();
    for(let i=0;i<5;i++)for(let j=0;j<5;j++){
      const p:Point=[w+(e-w)*(i+.5)/5,s+(n-s)*(j+.5)/5];if(!inPolygon(p,rings))continue;
      const [fx,fy]=tileXY(...p,17),col=Math.floor(fx)-startX,row=Math.floor(fy)-startY;
      if(col<0||row<0||col>1||row>1)continue;
      const samples=local[row*2+col];if(!samples)continue;
      const k=4*(Math.floor((fy%1)*256)*256+Math.floor((fx%1)*256));
      const pixel=(row*2+col)*262144+k;
      if(visited.has(pixel))continue;
      visited.add(pixel);
      const top=elevation(samples.surface,k),base=elevation(samples.ground,k);
      if(top===undefined||base===undefined)continue;
      const delta=top-base;if(delta>=2&&delta<=330)values.push(delta);
    }
    if(values.length<3)return;
    values.sort((a,b)=>a-b);return values[Math.floor(values.length*.55)];
  };
}
