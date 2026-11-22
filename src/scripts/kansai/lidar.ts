import {rasterPixels} from './raster';
import {inPolygon,tileXY,type Point,type Ring} from './coordinates';
import {cache,inflate,json} from './sources';

// GSJ seamless elevation PNG uses signed 24-bit centimetres. Transparent samples are void.
export function elevation(data:ImageData,index:number){
  if(data.data[index+3]===0)return;
  const rgb=data.data[index]*65536+data.data[index+1]*256+data.data[index+2];
  return (rgb>=8388608?rgb-16777216:rgb)*.01;
}
type HeightTile=(pixel:number)=>number|undefined;
const pairs=new Map<string,Promise<HeightTile|undefined>>();
let localPacks:Promise<Set<string>>|undefined;
const archive=cache(12,async key=>{
  const response=await fetch('/kansai/kobe-street-heights/'+key+'.bin');
  if(!response.ok)throw Error('Street height archive '+response.status);
  return new Uint8Array(await response.arrayBuffer());
});

const localTile=cache(140,async key=>{
  const [x,y]=key.split('/').map(Number);
  const name=(x>>2)+'-'+(y>>2);
  localPacks??=json<string[]>('kobe-street-heights/index.json').then(names=>new Set(names))
    .catch(error=>{localPacks=undefined;throw error;});
  if(!(await localPacks).has(name))return;
  const bytes=await archive(name),index=new DataView(bytes.buffer),slot=(y%4)*4+x%4;
  const start=index.getUint32(slot*4,true),end=index.getUint32((slot+1)*4,true);
  if(end===start)return;
  const values=new DataView(await inflate(bytes.subarray(start,end)));
  if(values.byteLength!==256*256*2)throw Error('Incomplete street height tile');
  return (pixel:number)=>values.getUint16(pixel*2,true)*.01;
});
let masks:Promise<Record<string,string>>|undefined;
async function read(layer:string,x:number,y:number,signal:AbortSignal){
  const res=await fetch('https://tiles.gsj.jp/tiles/elev/'+layer+'/17/'+y+'/'+x+'.png',{signal});
  if(!res.ok)throw Error('Elevation '+res.status);
  const bitmap=await createImageBitmap(await res.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
  return rasterPixels(bitmap);
}
function remoteTile(x:number,y:number){
  const key=x+'/'+y,existing=pairs.get(key);if(existing)return existing;
  const signal=AbortSignal.timeout(6500);
  const request=Promise.all([read('hyogodsm',x,y,signal),read('hyogodem',x,y,signal)])
    .then(([surface,ground])=>(pixel:number)=>{
      const top=elevation(surface,pixel*4),base=elevation(ground,pixel*4);
      return top===undefined||base===undefined?undefined:top-base;
    }).catch(()=>{pairs.delete(key);return undefined;});
  pairs.set(key,request);
  if(pairs.size>140)pairs.delete(pairs.keys().next().value!);
  return request;
}
export async function hyogoHeights(x:number,y:number){
  const startX=x*2,startY=y*2;
  masks??=json<Record<string,string>>('lidar-coverage.json').catch(error=>{masks=undefined;throw error;});
  const index=await masks;
  const local=await Promise.all([0,1,2,3].map(async i=>{
    const tx=startX+(i%2),ty=startY+(i>>1),mask=index[(tx>>5)+'/'+(ty>>5)];
    const bit=(ty%32)*32+(tx%32),offset=(bit>>3)*2;
    if(!mask || !(parseInt(mask.slice(offset,offset+2),16)&(1<<(bit%8))))return;
    // The port archive has native centimetre values. Use the two source rasters elsewhere or on a failed read.
    return await localTile(tx+'/'+ty).catch(()=>undefined) ?? remoteTile(tx,ty);
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
      const k=Math.floor((fy%1)*256)*256+Math.floor((fx%1)*256);
      const pixel=(row*2+col)*65536+k;
      if(visited.has(pixel))continue;
      visited.add(pixel);
      const delta=samples(k);
      if(delta!==undefined && delta>=2 && delta<=330)values.push(delta);
    }
    if(values.length<3)return;
    values.sort((a,b)=>a-b);return values[Math.floor(values.length*.55)];
  };
}
